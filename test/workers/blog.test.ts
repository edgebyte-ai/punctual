import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPorts } from '../../src/index.js'
import { buildRouter } from '../../src/http/router.js'
import { createSession } from '../../src/core/domain/auth-flows.js'
import { csrfTokenFor, SESSION_COOKIE_NAME } from '../../src/core/domain/auth-service.js'
import type { BlogPost, EnginePorts } from '../../src/ports.js'

function harness(enabled = '1') {
  const ports = buildPorts({ ...env, BLOG_ENABLED: enabled })
  const app = buildRouter(ports, { async forEventType() { return [] } })
  return { ports, app, repos: ports.repositories({ consistency: 'bookmark' }) }
}
let sequence = 0
async function login(ports: EnginePorts, role: 'admin' | 'member' = 'admin') {
  const id = `blog-user-${++sequence}`
  const repos = ports.repositories({ consistency: 'bookmark' })
  await repos.users.create({ id, email: `${id}@example.test`, name: id, tz: 'UTC', slug: id,
    avatarKey: null, company: null, jobTitle: null, companyUrl: null, role })
  const { token, session } = await createSession({ repos, crypto: ports.crypto }, id, ports.clock.now())
  return { cookie: `${SESSION_COOKIE_NAME}=${token}`, csrf: await csrfTokenFor((value) => ports.crypto.hash(value), session.idHash) }
}
function form(cookie: string, fields: Record<string, string>): RequestInit {
  const body = new FormData()
  for (const [key, value] of Object.entries(fields)) body.set(key, value)
  return { method: 'POST', headers: { cookie }, body }
}
const draft = { title: 'Smog check news', slug: 'smog-check-news', excerpt: 'Latest advice', content: 'Bring your DMV notice.' }

describe('optional blog under real D1 and Workers', () => {
  beforeEach(async () => { await env.DB.prepare('DELETE FROM blog_posts').run() })
  it('enables only for BLOG_ENABLED=1 and disables every surface before any repository access', async () => {
    for (const enabled of ['', '0', 'true']) {
      const { ports } = harness(enabled)
      expect(ports.config.blogEnabled).toBe(false)
      const repositories = vi.fn(() => { throw new Error('disabled blog accessed D1') })
      const app = buildRouter({ ...ports, repositories }, { async forEventType() { return [] } })
      for (const path of ['/blog', '/blog/post', '/blog/post/confirm', '/api/blog', '/api/blog/post',
        '/dashboard/blog', '/dashboard/blog/new', '/dashboard/blog/id/edit', '/dashboard/blog/id/delete']) {
        expect((await app.request(path)).status, path).toBe(404)
        expect((await app.request(path, form('invalid', {}))).status, path).toBe(404)
      }
      expect(repositories).not.toHaveBeenCalled()
    }
  })

  it('requires a session and an instance admin on every dashboard route', async () => {
    const { ports, app, repos } = harness()
    const member = await login(ports, 'member')
    for (const path of ['/dashboard/blog', '/dashboard/blog/new', '/dashboard/blog/missing/edit']) {
      expect((await app.request(path)).headers.get('location')).toBe('/login')
      expect((await app.request(path, { headers: { cookie: member.cookie } })).headers.get('location')).toBe('/dashboard')
    }
    for (const path of ['/dashboard/blog', '/dashboard/blog/missing', '/dashboard/blog/missing/delete']) {
      expect((await app.request(path, form('', draft))).headers.get('location')).toBe('/login')
      expect((await app.request(path, form(member.cookie, { ...draft, csrf: member.csrf }))).headers.get('location')).toBe('/dashboard')
    }
    expect(await repos.blog.list()).toEqual([])
  })

  it('creates drafts, publishes/edits, unpublishes and deletes through the authenticated forms', async () => {
    const { ports, app, repos } = harness()
    const admin = await login(ports)
    const page = await app.request('/dashboard/blog', { headers: { cookie: admin.cookie } })
    expect(page.status).toBe(200)
    expect(await page.text()).toContain(`name="csrf" value="${admin.csrf}"`)
    expect(page.headers.get('cache-control')).toBe('no-store')
    expect((await app.request('/dashboard/blog', form(admin.cookie, { ...draft, csrf: admin.csrf }))).status).toBe(303)
    const saved = (await repos.blog.list())[0]!
    expect(saved.published).toBe(false)
    expect(saved.publishedAt).toBeNull()
    expect(await (await app.request('/api/blog')).json()).toEqual({ posts: [] })
    expect(await (await app.request('/blog')).text()).not.toContain(draft.title)
    expect((await app.request(`/api/blog/${saved.slug}`)).status).toBe(404)
    expect((await app.request(`/blog/${saved.slug}`)).status).toBe(404)
    expect((await app.request(`/dashboard/blog/${saved.id}/edit`, { headers: { cookie: admin.cookie } })).status).toBe(200)

    const published = { ...draft, csrf: admin.csrf, published: '1', title: 'Updated news', image: 'https://images.example.test/smog.jpg' }
    expect((await app.request(`/dashboard/blog/${saved.id}`, form(admin.cookie, published))).status).toBe(303)
    const list = await app.request('/api/blog')
    expect(list.headers.get('cache-control')).toBe('no-store')
    const expected = { id: saved.id, slug: saved.slug, title: published.title, excerpt: draft.excerpt,
      body: draft.content, image: published.image, updatedAt: new Date((await repos.blog.byId(saved.id))!.updatedAt).toISOString() }
    expect(await list.json()).toEqual({ posts: [expected] })
    expect(await (await app.request(`/api/blog/${saved.slug}`)).json()).toEqual({ post: expected })
    expect(await (await app.request(`/blog/${saved.slug}`)).text()).toContain('Updated news')
    expect((await repos.blog.byId(saved.id))!.publishedAt).not.toBeNull()

    expect((await app.request(`/dashboard/blog/${saved.id}`, form(admin.cookie, { ...draft, csrf: admin.csrf }))).status).toBe(303)
    expect((await app.request(`/api/blog/${saved.slug}`)).status).toBe(404)
    expect(await (await app.request('/api/blog')).json()).toEqual({ posts: [] })
    expect((await app.request(`/dashboard/blog/${saved.id}/delete`, form(admin.cookie, { csrf: admin.csrf }))).status).toBe(303)
    expect(await repos.blog.byId(saved.id)).toBeNull()
    expect((await app.request(`/dashboard/blog/${saved.id}/edit`, { headers: { cookie: admin.cookie } })).status).toBe(404)
    expect((await app.request(`/dashboard/blog/${saved.id}`, form(admin.cookie, { ...draft, csrf: admin.csrf }))).status).toBe(404)
  })

  it('rejects missing, forged and other-session CSRF tokens without mutating posts', async () => {
    const { ports, app, repos } = harness()
    const admin = await login(ports)
    const other = await login(ports)
    await app.request('/dashboard/blog', form(admin.cookie, { ...draft, csrf: admin.csrf }))
    const saved = (await repos.blog.list())[0]!
    for (const csrf of ['', 'forged', other.csrf]) {
      for (const path of ['/dashboard/blog', `/dashboard/blog/${saved.id}`, `/dashboard/blog/${saved.id}/delete`]) {
        expect((await app.request(path, form(admin.cookie, { ...draft, title: 'Unauthorized change', csrf }))).status).toBe(403)
      }
    }
    expect(await repos.blog.list()).toEqual([saved])
  })

  it('escapes stored text in public and editor HTML while returning plain text JSON', async () => {
    const { ports, app, repos } = harness()
    const admin = await login(ports)
    const content = '<script>alert(1)</script>\n</textarea><img src=x onerror=alert(2)>'
    await app.request('/dashboard/blog', form(admin.cookie, { ...draft, title: '<img src=x onerror=alert(3)>', content, published: '1', csrf: admin.csrf }))
    const saved = (await repos.blog.list())[0]!
    for (const path of ['/blog', `/blog/${saved.slug}`, `/dashboard/blog/${saved.id}/edit`]) {
      const res = await app.request(path, { headers: { cookie: admin.cookie } })
      const html = await res.text()
      expect(html).not.toContain('<script>alert(1)')
      expect(html).not.toContain('<img src=x')
      expect(html).toContain('&lt;img src=x')
    }
    const res = await app.request(`/api/blog/${saved.slug}`)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect((await res.json() as { post: { body: string } }).post.body).toBe(content)
  })

  it('keeps duplicate slug conflicts atomic and distinguishes storage errors', async () => {
    const { ports, app, repos } = harness()
    const admin = await login(ports)
    const created = await Promise.all([1, 2].map(() => app.request('/dashboard/blog', form(admin.cookie, { ...draft, csrf: admin.csrf }))))
    expect(created.map((r) => r.status).sort()).toEqual([303, 409])
    const first = (await repos.blog.list())[0]!
    await app.request('/dashboard/blog', form(admin.cookie, { ...draft, slug: 'another-post', csrf: admin.csrf }))
    const second = (await repos.blog.bySlug('another-post'))!
    expect((await app.request(`/dashboard/blog/${second.id}`, form(admin.cookie, { ...draft, csrf: admin.csrf }))).status).toBe(409)
    expect((await repos.blog.byId(second.id))!.slug).toBe('another-post')
    // A duplicate primary key is a storage/programming fault, not a slug conflict.
    await expect(repos.blog.create({ ...first, slug: 'new-slug' })).rejects.toThrow()
  })

  it('validates fields and HTTPS cover URLs and bounds request size', async () => {
    const { ports, app, repos } = harness()
    const admin = await login(ports)
    const invalid: Array<Record<string, string>> = [{ slug: '../unsafe' }, { title: '' }, { content: '' }, { content: 'x'.repeat(100_001) },
      { image: 'javascript:alert(1)' }, { image: 'http://example.test/image.jpg' }, { image: 'https://user:password@example.test/image.jpg' }]
    for (const bad of invalid) {
      expect((await app.request('/dashboard/blog', form(admin.cookie, { ...draft, ...bad, csrf: admin.csrf }))).status).toBe(400)
    }
    expect((await app.request('/dashboard/blog', form(admin.cookie, { ...draft, content: 'x'.repeat(512_001), csrf: admin.csrf }))).status).toBe(413)
    expect(await repos.blog.list()).toEqual([])
  })

  it('upgrades an initial blog table without losing existing posts', async () => {
    await env.DB.prepare('ALTER TABLE blog_posts DROP COLUMN image').run()
    await env.DB.prepare("INSERT INTO blog_posts (id,slug,title,content,created_at,updated_at) VALUES ('legacy','legacy','Legacy','Preserved content',0,0)").run()
    const upgrades = env.TEST_MIGRATIONS.filter((migration) => /^001[67]_blog/.test(migration.name))
    expect(upgrades).toHaveLength(2)
    for (const migration of upgrades) await env.DB.batch(migration.queries.map((query) => env.DB.prepare(query)))
    const { repos } = harness()
    expect(await repos.blog.byId('legacy')).toMatchObject({ title: 'Legacy', content: 'Preserved content', image: null })
  })

  it('bounds public listings but keeps every post available to its admin', async () => {
    const { app, repos } = harness()
    const rows: BlogPost[] = Array.from({ length: 101 }, (_, i) => ({ id: `post-${i}`, slug: `post-${i}`, title: `Post ${i}`,
      excerpt: '', content: 'Text', image: null, published: true, createdAt: i, updatedAt: i, publishedAt: i }))
    await env.DB.batch(rows.map((p) => env.DB.prepare('INSERT INTO blog_posts (id, slug, title, content, published, created_at, updated_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(p.id, p.slug, p.title, p.content, 1, p.createdAt, p.updatedAt, p.publishedAt)))
    expect((await (await app.request('/api/blog')).json() as { posts: unknown[] }).posts).toHaveLength(100)
    expect(await repos.blog.list()).toHaveLength(101)
    expect((await app.request('/api/blog/post-0')).status).toBe(200)
  })
})

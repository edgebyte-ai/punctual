import type { BlogPost } from '../../ports.js'
import type { User } from '../../core/domain/types.js'
import { escapeHtml, shellFoot, shellHead } from './booking.js'

function bodyText(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br>')
}

export function blogListPage(brandName: string, posts: BlogPost[]): string {
  const cards = posts.length
    ? posts.map((p) => `<article class="pu-card" style="margin:1rem 0">
  <h2><a href="/blog/${encodeURIComponent(p.slug)}">${escapeHtml(p.title)}</a></h2>
  <p>${bodyText(p.excerpt || p.content.slice(0, 180))}</p>
  <small>${new Date(p.publishedAt ?? p.updatedAt).toLocaleDateString()}</small>
</article>`).join('\n')
    : '<p>No posts yet.</p>'
  return shellHead({ title: `Blog · ${brandName}`, brandName, description: `News from ${brandName}`, canonical: '/blog' }) +
    `<main><p><a href="/">← ${escapeHtml(brandName)}</a></p><h1>Blog</h1>${cards}</main>` + shellFoot(false)
}

export function blogPostPage(brandName: string, post: BlogPost): string {
  return shellHead({ title: `${post.title} · ${brandName}`, brandName, description: post.excerpt, canonical: `/blog/${encodeURIComponent(post.slug)}` }) +
    `<main><p><a href="/blog">← Blog</a></p><article><h1>${escapeHtml(post.title)}</h1><p><small>${new Date(post.publishedAt ?? post.updatedAt).toLocaleDateString()}</small></p><div>${bodyText(post.content)}</div></article></main>` + shellFoot(false)
}

export function blogAdminPage(brandName: string, user: User, csrf: string, posts: BlogPost[], edit?: BlogPost): string {
  const form = `<section class="pu-card"><h2>${edit ? 'Edit post' : 'New post'}</h2>
<form method="post" action="${edit ? `/dashboard/blog/${encodeURIComponent(edit.id)}` : '/dashboard/blog'}">
<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
<label>Title <input name="title" required maxlength="200" value="${escapeHtml(edit?.title ?? '')}"></label>
<label>Slug <input name="slug" required maxlength="120" pattern="[a-z0-9-]+" value="${escapeHtml(edit?.slug ?? '')}"></label>
<label>Excerpt <textarea name="excerpt" maxlength="500">${escapeHtml(edit?.excerpt ?? '')}</textarea></label>
<label>Content <textarea name="content" required rows="14">${escapeHtml(edit?.content ?? '')}</textarea></label>
<label><input type="checkbox" name="published" value="1"${edit?.published ? ' checked' : ''}> Published</label>
<button type="submit">Save</button>${edit ? ' <a href="/dashboard/blog">Cancel</a>' : ''}</form></section>`
  const rows = posts.map((p) => `<tr><td>${escapeHtml(p.title)}</td><td>${p.published ? 'Published' : 'Draft'}</td><td><a href="/dashboard/blog/${encodeURIComponent(p.id)}/edit">Edit</a> <form style="display:inline" method="post" action="/dashboard/blog/${encodeURIComponent(p.id)}/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button type="submit">Delete</button></form></td></tr>`).join('')
  return shellHead({ title: `Blog admin · ${brandName}`, brandName }) +
    `<main><p>Signed in as ${escapeHtml(user.email)} · <a href="/dashboard">Dashboard</a></p><h1>Blog</h1>${form}<section class="pu-card"><h2>Posts</h2><table><tr><th>Title</th><th>Status</th><th>Actions</th></tr>${rows || '<tr><td colspan="3">No posts yet.</td></tr>'}</table></section></main>` + shellFoot(false)
}

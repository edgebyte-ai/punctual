-- Optional instance blog. The module is disabled unless BLOG_ENABLED=1.
-- Content is tenant-local in the same D1 as the self-hosted Punctual instance.

CREATE TABLE IF NOT EXISTS blog_posts (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  excerpt      TEXT NOT NULL DEFAULT '',
  content      TEXT NOT NULL DEFAULT '',
  published    INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  published_at INTEGER
);

CREATE INDEX IF NOT EXISTS blog_posts_published_idx
  ON blog_posts (published, published_at DESC, updated_at DESC);

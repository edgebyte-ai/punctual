-- Separate from table creation so databases that used the initial blog branch
-- (0012_blog.sql) also gain the cover image field without losing their posts.
ALTER TABLE blog_posts ADD COLUMN image TEXT;

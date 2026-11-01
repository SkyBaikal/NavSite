-- 004: 链接快捷别名
ALTER TABLE links ADD COLUMN alias TEXT;
CREATE INDEX IF NOT EXISTS idx_links_alias ON links(alias);

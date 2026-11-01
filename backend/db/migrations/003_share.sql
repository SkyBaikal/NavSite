-- 003: 空间分享（只读公开页）
ALTER TABLE spaces ADD COLUMN share_code TEXT;
ALTER TABLE spaces ADD COLUMN share_enabled INTEGER DEFAULT 0;

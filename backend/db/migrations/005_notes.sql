-- 005: 笔记（数字空间地基）+ 双向链接
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',        -- 逗号分隔
  is_public INTEGER NOT NULL DEFAULT 0, -- 数字花园公开位
  public_slug TEXT UNIQUE,              -- 公开 URL slug
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_space ON notes(space_id);
CREATE INDEX IF NOT EXISTS idx_notes_public ON notes(is_public) WHERE is_public = 1;
CREATE INDEX IF NOT EXISTS idx_notes_slug ON notes(public_slug);
-- 笔记间链接（双向图）：source 笔记引用 target 笔记
CREATE TABLE IF NOT EXISTS note_links (
  source_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  PRIMARY KEY (source_id, target_id)
);
CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target_id);

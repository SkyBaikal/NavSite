-- 内容集合：CMS 核心（字段模型 + 条目）
CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '📦',
  fields_json TEXT NOT NULL DEFAULT '[]',   -- [{key,label,type:'text|textarea|number|url|date',required}]
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS collection_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  data_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_citems_col ON collection_items(collection_id);

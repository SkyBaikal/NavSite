-- 001_init.sql : 核心表结构（业务 + 配置 + 事件）
PRAGMA journal_mode = WAL;

-- ===== 业务数据 =====
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  is_visible INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  icon_url TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  is_visible INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_links_cat ON links(category_id);

CREATE TABLE IF NOT EXISTS admin (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ===== 配置数据（一切皆配置）=====
CREATE TABLE IF NOT EXISTS spaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '🏠',
  layout_json TEXT NOT NULL DEFAULT '[]',
  theme_json TEXT NOT NULL DEFAULT '{}',
  switch_rule TEXT NOT NULL DEFAULT '{"mode":"manual"}',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS widgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  props_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- ===== 运行时 =====
CREATE TABLE IF NOT EXISTS user_state (
  widget_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (widget_id, key)
);

CREATE TABLE IF NOT EXISTS events_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

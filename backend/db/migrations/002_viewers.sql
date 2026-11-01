-- 只读账号表（viewer 角色）：只能浏览后台，不能写
CREATE TABLE IF NOT EXISTS admin_viewers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

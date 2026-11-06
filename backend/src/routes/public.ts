import { fireEvent } from '../services/automation.js';
import { Router } from 'express';
import { db } from '../database.js';
import { syncNoteLinks } from './admin.js';

export const publicRouter = Router();

// 速记笔记（前台笔记 widget 用，匿名可用）：限速+截断+强制私有
const quickFails = new Map<string, { n: number; until: number }>();
publicRouter.post('/notes/quick', (req, res) => {
  const ip = req.ip || 'unknown';
  const f = quickFails.get(ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return res.status(429).json({ code: 'RATE_LIMITED', message: '创建太频繁，请稍后再试' });
  f.n++; if (f.n >= 10) { f.until = Date.now() + 60_000; f.n = 0; }
  quickFails.set(ip, f);
  const { title, body, tags } = req.body || {};
  const t = String(title || '').trim().slice(0, 120) || '速记';
  const b = String(body || '').slice(0, 20000);
  if (!b.trim() && t === '速记') return res.status(400).json({ code: 'EMPTY', message: '内容不能为空' });
  const sid = (db.prepare('SELECT id FROM spaces ORDER BY id LIMIT 1').get() as any)?.id;
  if (!sid) return res.status(400).json({ code: 'NO_SPACE', message: '尚未创建空间' });
  const info = db.prepare('INSERT INTO notes (space_id, title, body, tags, is_public) VALUES (?, ?, ?, ?, 0)')
    .run(sid, t, b, String(tags || '').slice(0, 200));
  try { syncNoteLinks(info.lastInsertRowid as number, b); } catch {}
  fireEvent(db, 'note.quick', { title: t });
  res.json({ code: 'OK', data: { id: info.lastInsertRowid } });
});

// 站点设置
publicRouter.get('/site', (_req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const settings: Record<string, string> = {};
  for (const r of rows as any[]) settings[r.key] = r.value;
  res.json({ code: 'OK', data: settings });
});

// widget 状态读写（访客可写：单机个人站场景，状态即内容）
publicRouter.get('/widgets/:id/state', (req, res) => {
  const row = db.prepare('SELECT value_json FROM user_state WHERE widget_id = ? AND key = ?').get(req.params.id, String(req.query.key || 'note'));
  res.json({ code: 'OK', data: row ? JSON.parse(row.value_json) : null });
});
publicRouter.post('/widgets/:id/state', (req, res) => {
  if (!/^[a-z][a-z0-9_-]{0,31}$/i.test(req.params.id)) return res.status(400).json({ code: 'INVALID', message: 'widget id 不合法' });
  const { key = 'note', value = null } = req.body || {};
  if (req.body === undefined || !('value' in (req.body || {}))) return res.status(400).json({ code: 'INVALID', message: '缺少 value' });
  if (typeof key !== 'string' || key.length > 64) return res.status(400).json({ code: 'INVALID', message: 'key 不合法' });
  const serialized = JSON.stringify(value);
  if (serialized.length > 65536) return res.status(413).json({ code: 'TOO_LARGE', message: '单条 state 上限 64KB' });
  const k = String(key);
  db.prepare('INSERT INTO user_state (widget_id, key, value_json) VALUES (?, ?, ?) ON CONFLICT(widget_id, key) DO UPDATE SET value_json = excluded.value_json')
    .run(req.params.id, k, serialized);
  // habit 状态：同时记历史快照（按天累积，最多 120 天），供热力图
  if (k === 'habit' && value && typeof value === 'object' && value.date) {
    const histRow = db.prepare('SELECT value_json FROM user_state WHERE widget_id = ? AND key = ?').get(req.params.id, 'habit_history');
    const hist = histRow ? JSON.parse(histRow.value_json) : {};
    hist[value.date] = { done: value.done || {}, count: Object.values(value.done || {}).filter(Boolean).length };
    // 只保留最近 120 天
    const cutoff = Date.now() - 120 * 86400000;
    for (const d of Object.keys(hist)) {
      if (new Date(d).getTime() < cutoff) delete hist[d];
    }
    db.prepare('INSERT INTO user_state (widget_id, key, value_json) VALUES (?, ?, ?) ON CONFLICT(widget_id, key) DO UPDATE SET value_json = excluded.value_json')
      .run(req.params.id, 'habit_history', JSON.stringify(hist));
  }
  res.json({ code: 'OK' });
});
// 打卡历史（热力图数据）
publicRouter.get('/widgets/:id/history', (req, res) => {
  const row = db.prepare('SELECT value_json FROM user_state WHERE widget_id = ? AND key = ?').get(req.params.id, 'habit_history');
  res.json({ code: 'OK', data: row ? JSON.parse(row.value_json) : {} });
});

// 空间列表（含布局/主题）
publicRouter.get('/spaces', (_req, res) => {
  const rows = db.prepare(
    'SELECT id, name, icon, layout_json, theme_json, switch_rule, sort_order FROM spaces ORDER BY sort_order'
  ).all();
  res.json({ code: 'OK', data: rows });
});


// 外观自定义（公开读：前台注入）
publicRouter.get('/appearance', (_req, res) => {
  const get = (k: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get('appearance.' + k) as any)?.value || '';
  let engines: any = '';
  try { engines = JSON.parse(get('search_engines') || '""'); } catch {}
  res.json({ code: 'OK', data: {
    customCss: get('custom_css'),
    siteName: get('site_name'),
    footerText: get('footer_text'),
    searchPlaceholder: get('search_placeholder'),
    searchEngines: engines,
  } });
});

// ---- 入站 Webhook（手机快捷指令 / IFTTT / 脚本）----
// POST /api/hooks/:token  body: { text, action?: 'note'|'todo'|'link', title?, url? }
function getHookToken(): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'hooks_token'").get() as any;
  if (row?.value) return row.value;
  const t = require('crypto').randomBytes(16).toString('hex');
  db.prepare("INSERT INTO settings (key, value) VALUES ('hooks_token', ?)").run(t);
  return t;
}
function timingSafeStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const hookFails = new Map<string, { n: number; until: number }>();
publicRouter.post('/hooks/:token', (req, res) => {
  const ip = req.ip || 'unknown';
  const f = hookFails.get(ip);
  if (f && f.until > Date.now()) return res.status(429).json({ code: 'RATE_LIMITED' });
  const expected = (db.prepare("SELECT value FROM settings WHERE key = 'hooks_token'").get() as any)?.value;
  if (!expected || !timingSafeStr(String(req.params.token), expected)) {
    const rec = hookFails.get(ip) || { n: 0, until: 0 };
    rec.n++;
    if (rec.n >= 5) { rec.n = 0; rec.until = Date.now() + 600000; }
    hookFails.set(ip, rec);
    return res.status(401).json({ code: 'INVALID_TOKEN' });
  }
  const { text, action } = req.body || {};
  const t = String(text || '').trim().slice(0, 500);
  if (!t) return res.status(400).json({ code: 'INVALID', message: '需要 text' });
  const act = action === 'todo' || action === 'link' ? action : 'note';
  const now = Date.now();
  try {
    if (act === 'note') {
      const row = db.prepare("SELECT value_json FROM user_state WHERE widget_id = 'w11' AND key = 'note'").get() as any;
      const prev = row?.value_json ? String(row.value_json) : '';
      const stamp = new Date(now).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      const next = prev ? prev + '\n' + `[${stamp}] ${t}` : `[${stamp}] ${t}`;
      db.prepare("INSERT INTO user_state (widget_id, key, value_json) VALUES ('w11', 'note', ?) ON CONFLICT(widget_id, key) DO UPDATE SET value_json = excluded.value_json").run(next.slice(-20000));
    } else if (act === 'todo') {
      const row = db.prepare("SELECT value_json FROM user_state WHERE widget_id = 'w15' AND key = 'todos'").get() as any;
      let arr: any[] = [];
      try { arr = JSON.parse(row?.value_json || '[]'); } catch {}
      arr.push({ id: 'hk' + now.toString(36), text: t, done: false, at: now });
      db.prepare("INSERT INTO user_state (widget_id, key, value_json) VALUES ('w15', 'todos', ?) ON CONFLICT(widget_id, key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(arr.slice(-500)));
    } else {
      const u = String((req.body || {}).url || '').trim();
      if (!/^https?:\/\/[\w.-]+/.test(u)) return res.status(400).json({ code: 'INVALID', message: 'link 需要合法 url' });
      if (db.prepare('SELECT 1 FROM links WHERE url = ?').get(u)) return res.status(409).json({ code: 'DUPLICATE', message: '该链接已存在' });
      const cat = (db.prepare('SELECT id FROM categories ORDER BY sort_order LIMIT 1').get() as any)?.id;
      const max = (db.prepare('SELECT COALESCE(MAX(sort_order),0) m FROM links WHERE category_id = ?').get(cat) as any).m;
      db.prepare('INSERT INTO links (category_id, title, url, sort_order) VALUES (?, ?, ?, ?)').run(cat, t.slice(0, 100), u, max + 1);
    }
    db.prepare("INSERT INTO events_log (type, payload_json) VALUES ('hook.inbound', ?)").run(JSON.stringify({ action: act, text: t.slice(0, 100) }));
    res.json({ code: 'OK', action: act });
  } catch (e: any) {
    res.status(500).json({ code: 'ERROR', message: e.message });
  }
});

// ---- 速记流转：快速加链接 ----
publicRouter.post('/quick-link', (req, res) => {
  const { title, url, category_id } = req.body || {};
  const t = String(title || '').trim().slice(0, 100);
  const u = String(url || '').trim();
  if (!t || !/^https?:\/\/[\w.-]+/.test(u)) return res.status(400).json({ code: 'INVALID', message: '需要 title 与合法 url' });
  const cat = Number(category_id) || (db.prepare('SELECT id FROM categories ORDER BY sort_order LIMIT 1').get() as any)?.id;
  if (!cat) return res.status(400).json({ code: 'NO_CATEGORY' });
  const max = (db.prepare('SELECT COALESCE(MAX(sort_order),0) m FROM links WHERE category_id = ?').get(cat) as any).m;
  db.prepare("INSERT INTO links (category_id, title, url, sort_order) VALUES (?, ?, ?, ?)").run(cat, t, u, max + 1);
  res.json({ code: 'OK' });
});

// ---- 数字花园：公开笔记（只读）----
publicRouter.get('/garden', (_req, res) => {
  const rows = db.prepare("SELECT id, public_slug, title, tags, updated_at FROM notes WHERE is_public = 1 ORDER BY updated_at DESC").all();
  res.json({ code: 'OK', data: rows });
});
publicRouter.get('/garden/:slug', (req, res) => {
  const row = db.prepare("SELECT id, title, body, tags, updated_at FROM notes WHERE is_public = 1 AND public_slug = ?").get(String(req.params.slug)) as any;
  if (!row) return res.status(404).json({ code: 'NOT_FOUND', message: '笔记不存在或未公开' });
  // 反链（谁公开链接了我）
  const backlinks = db.prepare(`
    SELECT DISTINCT n.id, n.public_slug, n.title FROM note_links l
    JOIN notes n ON n.id = l.source_id AND n.is_public = 1
    WHERE l.target_id = ?`).all(row.id) as any[];
  // 出链（我公开链接了谁）
  const outlinks = db.prepare(`
    SELECT DISTINCT n.id, n.public_slug, n.title FROM note_links l
    JOIN notes n ON n.id = l.target_id AND n.is_public = 1
    WHERE l.source_id = ?`).all(row.id) as any[];
  res.json({ code: 'OK', data: { ...row, backlinks, outlinks } });
});

// ---- 快捷别名跳转：/a/:name → 302 ----
publicRouter.get('/alias/:name', (req, res) => {
  const name = String(req.params.name).toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(name)) return res.status(400).json({ code: 'INVALID' });
  const row = db.prepare('SELECT url FROM links WHERE alias = ? AND is_visible = 1').get(name) as any;
  if (!row) return res.status(404).json({ code: 'NOT_FOUND', message: '别名不存在' });
  db.prepare('UPDATE links SET clicks = clicks + 1 WHERE alias = ?').run(name);
  db.prepare("INSERT INTO events_log (type, payload_json) VALUES ('link.click', ?)").run(JSON.stringify({ linkId: (db.prepare('SELECT id FROM links WHERE alias = ?').get(name) as any)?.id }));
  res.redirect(302, row.url);
});

// ---- 只读分享页数据：/api/share/:code ----
publicRouter.get('/share/:code', (req, res) => {
  const sp = db.prepare('SELECT id, name, icon, layout_json, theme_json FROM spaces WHERE share_code = ? AND share_enabled = 1').get(String(req.params.code)) as any;
  if (!sp) return res.status(404).json({ code: 'NOT_FOUND', message: '分享不存在或已关闭' });
  const cats = db.prepare('SELECT id, name, icon, sort_order FROM categories WHERE is_visible = 1 ORDER BY sort_order').all() as any[];
  const linkStmt = db.prepare('SELECT id, category_id, title, url, description, icon_url, clicks FROM links WHERE is_visible = 1 AND category_id = ? ORDER BY CASE WHEN (SELECT value FROM settings WHERE key = ?) = ? THEN sort_order ELSE -clicks END, sort_order');
  for (const c of cats) c.links = linkStmt.all(c.id, 'hotFloat', 'off');
  res.json({ code: 'OK', data: { space: { id: sp.id, name: sp.name, icon: sp.icon, layout_json: sp.layout_json, theme_json: sp.theme_json }, categories: cats } });
});

// 分类+链接（前台可见的）
publicRouter.get('/categories', (_req, res) => {
  const cats = db.prepare('SELECT id, name, icon, sort_order FROM categories WHERE is_visible = 1 ORDER BY sort_order').all() as any[];
  const linkStmt = db.prepare('SELECT id, category_id, title, url, description, icon_url, clicks FROM links WHERE is_visible = 1 AND category_id = ? ORDER BY CASE WHEN (SELECT value FROM settings WHERE key = ?) = ? THEN sort_order ELSE -clicks END, sort_order');
  for (const c of cats) c.links = linkStmt.all(c.id, 'hotFloat', 'off');
  res.json({ code: 'OK', data: cats });
});

// 搜索
publicRouter.get('/links', (req, res) => {
  const kw = String(req.query.kw || '').trim();
  if (!kw) {
    // 无关键词：返回全部可见链接（供命令面板等使用）
    const all = db.prepare('SELECT id, category_id, title, url, description, icon_url, alias FROM links WHERE is_visible = 1 LIMIT 200').all();
    return res.json({ code: 'OK', data: all });
  }
  const like = `%${kw}%`;
  const rows = db.prepare(
    'SELECT id, category_id, title, url, description, icon_url, alias FROM links WHERE is_visible = 1 AND (title LIKE ? OR description LIKE ? OR url LIKE ? OR alias LIKE ?) LIMIT 50'
  ).all(like, like, like, like);
  res.json({ code: 'OK', data: rows });
});

// 点击计数
publicRouter.post('/links/:id/click', (req, res) => {
  db.prepare('UPDATE links SET clicks = clicks + 1 WHERE id = ?').run(req.params.id);
  db.prepare("INSERT INTO events_log (type, payload_json) VALUES ('link.click', ?)")
    .run(JSON.stringify({ linkId: Number(req.params.id) }));
  fireEvent(db, 'link.click', { linkId: Number(req.params.id) }); // 触发联动规则
  res.json({ code: 'OK' });
});

// ---- 全局内容搜索（链接+待办+速记+句子）----
publicRouter.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q || q.length > 64) return res.json({ code: 'OK', data: { links: [], notes: [] } });
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const links = db.prepare(`SELECT l.id, l.title, l.url, c.name AS category FROM links l LEFT JOIN categories c ON l.category_id = c.id WHERE l.is_visible = 1 AND (l.title LIKE ? OR l.url LIKE ? OR l.description LIKE ?) LIMIT 8`).all(like, like, like);
  let notes: any[] = [];
  try {
    const rows = db.prepare(`SELECT widget_id, key, value FROM user_state WHERE value LIKE ? LIMIT 20`).all(like);
    for (const r of rows as any[]) {
      try {
        const v = JSON.parse(r.value);
        const texts: string[] = [];
        const walk = (o: any) => { if (typeof o === 'string' && o.length < 200) texts.push(o); else if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') Object.values(o).forEach(walk); };
        walk(v);
        for (const t of texts) if (t.toLowerCase().includes(q.toLowerCase())) notes.push({ widget: r.widget_id, text: t.slice(0, 80) });
        if (notes.length >= 6) break;
      } catch {}
    }
  } catch {}
  res.json({ code: 'OK', data: { links, notes: notes.slice(0, 6) } });
});

// ---- 亮暗主题一键切换（写当前空间 theme_json 并 SSE 广播）----
publicRouter.post('/theme/toggle', (_req, res) => {
  const sp = db.prepare('SELECT id, theme_json FROM spaces ORDER BY id LIMIT 1').get() as any;
  if (!sp) return res.status(404).json({ code: 'NOT_FOUND' });
  let t: any = {};
  try { t = JSON.parse(sp.theme_json || '{}'); } catch {}
  const bg = String(t['color-bg'] || '#f7f4ee');
  // 亮度判断：暗色背景 → 切纸墨；浅色背景 → 切暗夜
  const isDark = bg.startsWith('#') && parseInt(bg.slice(1, 3), 16) < 80;
  const DARK = { 'color-bg':'#0d1117','color-card':'#161b22','color-ink':'#e6edf3','color-muted':'#8b949e','color-accent':'#58a6ff','color-line':'#30363d' };
  const LIGHT = { 'color-bg':'#f7f4ee','color-card':'#ffffff','color-ink':'#1a2332','color-muted':'#6b7280','color-accent':'#0f766e','color-line':'#e2ddd3' };
  const next = isDark ? LIGHT : DARK;
  db.prepare('UPDATE spaces SET theme_json = ? WHERE id = ?').run(JSON.stringify(next), sp.id);
  (globalThis as any).__spaceEvents?.emit('theme', { theme: isDark ? '纸墨（默认）' : '暗夜', tokens: next });
  res.json({ code: 'OK', data: { mode: isDark ? 'light' : 'dark', tokens: next } });
});

// ---- 最近访问（取最近 20 条 link.click 事件，去重映射到链接）----
publicRouter.get('/links/recent', (_req, res) => {
  const rows = db.prepare(`
    SELECT l.id, l.title, l.url, l.icon_url, MAX(e.id) AS last_eid
    FROM events_log e JOIN links l ON l.id = CAST(json_extract(e.payload_json, '$.linkId') AS INTEGER)
    WHERE e.type = 'link.click' AND l.is_visible = 1
    GROUP BY l.id ORDER BY last_eid DESC LIMIT 12`).all();
  res.json({ code: 'OK', data: rows });
});

// ---- 倒计时管理（存 settings，全站共享的日期列表）----
publicRouter.get('/countdowns', (_req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'countdowns'").get() as any;
  let list: any[] = [];
  try { list = JSON.parse(row?.value || '[]'); } catch {}
  res.json({ code: 'OK', data: list });
});
publicRouter.post('/countdowns', (req, res) => {
  const { title, date, action } = req.body || {};
  const row = db.prepare("SELECT value FROM settings WHERE key = 'countdowns'").get() as any;
  let list: any[] = [];
  try { list = JSON.parse(row?.value || '[]'); } catch {}
  if (action === 'delete') {
    list = list.filter((c: any) => c.id !== title);
  } else {
    if (!title || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ code: 'INVALID', message: 'title/date(YYYY-MM-DD) 必填' });
    if (list.length >= 20) return res.status(400).json({ code: 'LIMIT', message: '最多 20 个倒计时' });
    list.push({ id: Date.now().toString(36), title: String(title).slice(0, 40), date });
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('countdowns', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(list));
  res.json({ code: 'OK', data: list });
});

// ===== CMS 内容集合（公开只读）=====
const colStmt = {
  get listCols() { return db.prepare('SELECT id, name, icon, fields_json FROM collections ORDER BY id'); },
  get getCol() { return db.prepare('SELECT id, name, icon, fields_json FROM collections WHERE id = ?'); },
  get getColByName() { return db.prepare('SELECT id, name, icon, fields_json FROM collections WHERE name = ?'); },
  get items() { return db.prepare('SELECT id, data_json, sort_order, created_at FROM collection_items WHERE collection_id = ? ORDER BY sort_order, id DESC'); },
  get item() { return db.prepare('SELECT id, data_json, sort_order, created_at FROM collection_items WHERE id = ?'); },
};

publicRouter.options('/collections*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.status(204).end();
});
publicRouter.get('/collections', (req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); next(); }, (_req, res) => {
  const rows = colStmt.listCols.all() as any[];
  res.json({ code: 'OK', data: rows.map(r => ({ id: r.id, name: r.name, icon: r.icon, fields: JSON.parse(r.fields_json || '[]') })) });
});
publicRouter.get('/collections/:key/items', (req, res) => { res.setHeader('Access-Control-Allow-Origin', '*');
  const key = String(req.params.key || '');
  const col = /^\d+$/.test(key) ? colStmt.getCol.get(Number(key)) as any : colStmt.getColByName.get(key) as any;
  if (!col) return res.status(404).json({ code: 'NOT_FOUND', message: '集合不存在' });
  const items = (colStmt.items.all(col.id) as any[]).map(r => ({ id: r.id, ...JSON.parse(r.data_json || '{}'), _sort: r.sort_order, _created: r.created_at }));
  res.json({ code: 'OK', data: items });
});
publicRouter.get('/collections/:key/items/:id', (req, res) => { res.setHeader('Access-Control-Allow-Origin', '*');
  const col = colStmt.getCol.get(Number(req.params.key)) as any;
  const it = colStmt.item.get(Number(req.params.id)) as any;
  if (!col || !it || it.collection_id !== col.id) return res.status(404).json({ code: 'NOT_FOUND', message: '条目不存在' });
  res.json({ code: 'OK', data: { id: it.id, ...JSON.parse(it.data_json || '{}'), _created: it.created_at } });
});

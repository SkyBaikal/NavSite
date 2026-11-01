import { fireEvent } from '../services/automation.js';
import { Router } from 'express';
import { db } from '../database.js';

export const publicRouter = Router();

// 站点设置
publicRouter.get('/site', (_req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key] = r.value;
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
    const all = db.prepare('SELECT id, category_id, title, url, description, icon_url FROM links WHERE is_visible = 1 LIMIT 200').all();
    return res.json({ code: 'OK', data: all });
  }
  const like = `%${kw}%`;
  const rows = db.prepare(
    'SELECT id, category_id, title, url, description, icon_url FROM links WHERE is_visible = 1 AND (title LIKE ? OR description LIKE ? OR url LIKE ?) LIMIT 50'
  ).all(like, like, like);
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
    for (const r of rows) {
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

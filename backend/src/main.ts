import express from 'express';
import { migrate, db } from './database.js';
import { publicRouter } from './routes/public.js';
import { adminRouter, requireAdmin, requirePageLogin } from './routes/admin.js';
import { faviconRouter } from './services/favicon.js';
import { metaRouter } from './services/meta.js';
import { startScheduler } from './services/scheduler.js';
import { fireEvent, getRules, saveRules, ACTIONS as AUTO_ACTIONS, EVENTS as AUTO_EVENTS } from './services/automation.js';
import { previewRouter } from './services/preview.js';
import { rssRouter } from './services/rss.js';
import { weatherRouter } from './services/weather.js';
import { dailyshotRouter } from './services/dailyshot.js';
import { upstreamReport } from './services/upstream.js';
import { marketRouter } from './services/market.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

migrate();

// 首次启动初始化管理员与默认数据
const adminRow = db.prepare('SELECT id FROM admin').get();
if (!adminRow) {
  const bcryptMod = await import('bcryptjs');
  const bcrypt = (bcryptMod as any).default ?? bcryptMod;
  const user = process.env.ADMIN_USER || 'admin';
  const pass = process.env.ADMIN_PASS || 'admin123';
  db.prepare('INSERT INTO admin (id, username, password_hash) VALUES (1, ?, ?)')
    .run(user, bcrypt.hashSync(pass, 10));
  console.log(`[init] admin created: ${user}`);
}

const app = express();
app.disable('x-powered-by');

// ---- 安全响应头（工业级基线）----
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // CSP：self + 内联样式（本地注入的主题样式表）+ data: 图片 + blob:（PWA）
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "connect-src 'self'; font-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
  // widget 沙箱 iframe 需要 frame-ancestors 放行自身
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

app.use('/api', publicRouter);

// 登录预热/诊断端点（公开）：浏览器先 GET 一次拿 CF clearance，再 POST login，绕开 Bot Fight 对"冷 POST"的挑战
app.get('/api/healthz', (_req, res) => {
  res.json({ code: 'OK', source: 'navsite-origin', now: Date.now() });
});

// 会话诊断（公开）：回显浏览器是否携带会话 cookie——登录跳转 401 时定位用
app.get('/api/whoami', (req, res) => {
  const raw = req.headers.cookie || '';
  res.json({
    code: 'OK',
    data: {
      cookieHeaderPresent: !!raw,
      cookieNames: raw.split(';').map(s => s.trim().split('=')[0]).filter(Boolean),
      ua: (req.headers['user-agent'] || '').slice(0, 120),
    },
  });
});

// 外部依赖健康报告（公开，widget 用它显示"离线数据"角标）
app.get('/api/health/upstream', (_req, res) => {
  res.json({ code: 'OK', data: upstreamReport(), now: Date.now() });
});

// SSE：定时切空间事件推送
const spaceEvents = new EventEmitter();
(globalThis as any).__spaceEvents = spaceEvents;
startScheduler(db, () => null, (targetSpaceId: number) => spaceEvents.emit('switch', targetSpaceId));

// ---- 自动备份：每天 04:00 全量导出 data/backups/，保留 14 份 ----
import { startEventsRetention, pruneEventsLog } from './services/retention.js';
import { startBackupScheduler, listBackups, createBackup, pruneBackups } from './services/backup.js';
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
startBackupScheduler(db, DATA_DIR);
startEventsRetention(db); // events_log 自动轮转（每天 5 点）

app.get('/api/events/space', (_req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 5000\n\n');
  const onSwitch = (id: number) => res.write(`data: ${JSON.stringify({ type: 'switch', spaceId: id })}\n\n`);
  const onTheme = (payload: any) => res.write(`data: ${JSON.stringify({ type: 'theme', ...(typeof payload === 'string' ? { theme: payload } : payload) })}\n\n`);
  const onWidgets = (hidden: any) => res.write(`data: ${JSON.stringify({ type: 'widgets_changed', hidden })}\n\n`);
  const onNotify = (n: any) => res.write(`data: ${JSON.stringify({ type: 'notify', ...n })}\n\n`);
  spaceEvents.on('switch', onSwitch);
  spaceEvents.on('theme', onTheme);
  spaceEvents.on('widgets_changed', onWidgets);
  spaceEvents.on('notify', onNotify);
  _req.on('close', () => {
    spaceEvents.removeListener('switch', onSwitch);
    spaceEvents.removeListener('theme', onTheme);
    spaceEvents.removeListener('widgets_changed', onWidgets);
    spaceEvents.removeListener('notify', onNotify);
  });
});
app.use('/api', faviconRouter);
app.use('/api', metaRouter);
app.use('/api', previewRouter);
app.use('/api', rssRouter);
app.use('/api', weatherRouter);
app.use('/api', dailyshotRouter);
app.use('/api/admin', adminRouter);

// ---- 备份管理 ----
adminRouter.get('/backups', requireAdmin, (_req, res) => {
  res.json({ code: 'OK', data: listBackups(DATA_DIR) });
});
adminRouter.post('/backups', requireAdmin, (_req, res) => {
  const file = createBackup(db, DATA_DIR);
  const pruned = pruneBackups(DATA_DIR);
  res.json({ code: 'OK', data: { file, ...pruned } });
});
adminRouter.get('/backups/:name', requireAdmin, (req, res) => {
  const name = path.basename(req.params.name); // 防路径穿越
  if (!/^backup-[0-9T:-]+\.json$/.test(name)) return res.status(400).json({ code: 'INVALID', message: '非法文件名' });
  const file = path.join(DATA_DIR, 'backups', name);
  if (!fs.existsSync(file)) return res.status(404).json({ code: 'NOT_FOUND' });
  res.setHeader('Content-Disposition', `attachment; filename=${name}`);
  res.sendFile(file);
});
app.use(marketRouter);
import { widgetRuntimeRouter } from './services/market.js';
app.use(widgetRuntimeRouter);

// ---- 联动规则 API ----
adminRouter.get('/automation', requireAdmin, (_req, res) => {
  res.json({ code: 'OK', data: { rules: getRules(db), actions: AUTO_ACTIONS, events: AUTO_EVENTS } });
});
adminRouter.put('/automation', requireAdmin, (req, res) => {
  const rules = req.body?.rules;
  if (!Array.isArray(rules)) return res.status(400).json({ code: 'INVALID', message: 'rules 必须是数组' });
  saveRules(db, rules);
  res.json({ code: 'OK' });
});
adminRouter.post('/events/prune', requireAdmin, (req, res) => {
  const r = pruneEventsLog(db);
  res.json({ code: 'OK', data: r });
});
adminRouter.post('/automation/test', requireAdmin, (req, res) => {
  const { event, payload } = req.body || {};
  const fired = fireEvent(db, String(event || ''), payload || {});
  res.json({ code: 'OK', data: { fired } });
});

// 后台静态页（Express 托管，零 CDN）
// 后台静态页登录门槛（无效 session 只见 401 跳转页，不泄露源码）
app.use('/admin', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use('/admin', requirePageLogin);
app.use('/admin', express.static(path.join(__dirname, '../public'), { index: 'admin.html' }));

// 布局编辑器（同样有登录门槛）
app.use('/editor', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use('/editor', requirePageLogin);
app.use('/editor', express.static(path.join(__dirname, '../public'), { index: 'editor.html' }));

// 数字花园（公开，只读）
app.use('/garden', express.static(path.join(__dirname, '../public-garden'), { index: 'garden.html' }));

// 生产模式：托管前端构建产物
const distDir = path.join(__dirname, '../../frontend/dist');
app.use(express.static(distDir));

// ===== CMS 阅读页（详情/归档，纯后端渲染，零 CDN）=====
function mdRender(src: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const lines = String(src || '').split('\n');
  let html = '', inList = false, inCode = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line.startsWith('```')) {
      if (inCode) { html += '</code></pre>'; inCode = false; }
      else { html += '<pre><code>'; inCode = true; }
      continue;
    }
    if (inCode) { html += esc(raw) + '\n'; continue; }
    if (/^[-*] /.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += '<li>' + inline(line.slice(2)) + '</li>'; continue;
    }
    if (inList) { html += '</ul>'; inList = false; }
    const h = /^(#{1,4}) (.+)/.exec(line);
    if (h) { const lv = h[1].length; html += `<h${lv}>` + inline(h[2]) + `</h${lv}>`; continue; }
    if (!line.trim()) continue;
    html += '<p>' + inline(line) + '</p>';
  }
  if (inList) html += '</ul>';
  if (inCode) html += '</code></pre>';
  return html;
}
function pageShell(title: string, body: string, backLink = true): string {
  const t = title.replace(/</g, '&lt;');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${t} · NavSite</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;background:#0b0f17;color:#d7e3f4;line-height:1.75}
main{max-width:720px;margin:0 auto;padding:32px 20px 64px}
a{color:#7fb8ff;text-decoration:none}a:hover{text-decoration:underline}
.back{display:inline-block;margin-bottom:20px;font-size:14px;opacity:.75}
h1{font-size:1.7em;margin:.2em 0 .6em}
.meta{font-size:13px;opacity:.6;margin-bottom:24px}
pre{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:12px;overflow:auto;font-size:13px}
code{background:rgba(255,255,255,.08);border-radius:4px;padding:1px 5px;font-size:.92em}
pre code{background:none;padding:0}
blockquote{border-left:3px solid rgba(127,184,255,.4);margin:0;padding:2px 14px;opacity:.85;background:rgba(255,255,255,.03);border-radius:0 8px 8px 0}
.arch{list-style:none;padding:0}
.arch li{padding:10px 4px;border-bottom:1px solid rgba(255,255,255,.07);display:flex;justify-content:space-between;gap:12px}
.arch time{opacity:.5;font-size:13px;white-space:nowrap}
.empty{opacity:.55;text-align:center;padding:48px 0}
.card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:18px 20px;margin-bottom:14px}
@media(prefers-color-scheme:light){:root{color-scheme:light}body{background:#f6f7fa;color:#22303f}pre,code,.card{background:rgba(0,0,0,.04);border-color:rgba(0,0,0,.1)}blockquote{background:rgba(0,0,0,.03)}}
</style></head><body><main>
${backLink ? '<a class="back" href="/">&#8592; 返回首页</a>' : ''}
${body}
</main></body></html>`;
}
// 归档：/archive 与 /archive/:key
app.get(['/archive', '/archive/:key'], (req, res) => {
  const key = (req.params as any).key;
  const cols: any[] = key
    ? ([db.prepare('SELECT id, name, icon FROM collections WHERE name = ? OR id = ?').get(key, /^\d+$/.test(key) ? Number(key) : -1) as any].filter(Boolean))
    : (db.prepare('SELECT id, name, icon FROM collections ORDER BY id').all() as any[]);
  if (key && !cols[0]) return res.status(404).send(pageShell('404', '<div class="empty">集合不存在</div>', false));
  let body = '<h1>🗓️ 归档</h1>';
  for (const c of cols) {
    const items = db.prepare('SELECT id, data_json, created_at FROM collection_items WHERE collection_id = ? ORDER BY created_at DESC, id DESC').all(c.id) as any[];
    body += `<h2 style="margin-top:1.4em">${c.icon} ${c.name} <span style="font-size:.55em;opacity:.5">${items.length} 篇</span></h2>`;
    if (!items.length) { body += '<div class="empty">暂无内容</div>'; continue; }
    body += '<ul class="arch">' + items.map((it: any) => {
      const d = JSON.parse(it.data_json || '{}');
      const t = String(d.title || d.name || '（无标题）').replace(/</g, '&lt;');
      return `<li><a href="/c/${c.id}/${it.id}">${t}</a><time>${String(it.created_at).slice(0, 10)}</time></li>`;
    }).join('') + '</ul>';
  }
  res.send(pageShell('归档', body));
});
// 详情：/c/:key/:id
app.get('/c/:key/:id', (req, res) => {
  const col = db.prepare('SELECT id, name, icon, fields_json FROM collections WHERE name = ? OR id = ?').get(req.params.key, /^\d+$/.test(req.params.key) ? Number(req.params.key) : -1) as any;
  if (!col) return res.status(404).send(pageShell('404', '<div class="empty">集合不存在</div>', false));
  const it = db.prepare('SELECT * FROM collection_items WHERE id = ? AND collection_id = ?').get(Number(req.params.id), col.id) as any;
  if (!it) return res.status(404).send(pageShell('404', '<div class="empty">条目不存在</div>'));
  const data = JSON.parse(it.data_json || '{}');
  const fields = JSON.parse(col.fields_json || '[]') as any[];
  const title = String(data.title || data.name || '（无标题）');
  let body = `<h1>${title.replace(/</g, '&lt;')}</h1>
<div class="meta">${col.icon} ${col.name} · ${String(it.created_at).slice(0, 10)}</div>`;
  for (const f of fields) {
    if (f.key === 'title' || f.key === 'desc') continue;
    const v = data[f.key];
    if (v === undefined || v === '' || v === null) continue;
    const safe = String(v).replace(/</g, '&lt;');
    if (f.type === 'url' && /^https?:/.test(String(v))) { body += `<div class="meta">&#128279; <a href="${String(v).replace(/"/g, '&quot;')}" target="_blank" rel="noopener">${safe.slice(0, 80)}</a></div>`; continue; }
    if (f.type === 'textarea') { body += '<div class="card">' + mdRender(String(v)) + '</div>'; continue; }
    body += `<div class="meta">${f.label || f.key}：${safe}</div>`;
  }
  if (data.desc) body += '<div class="card">' + mdRender(String(data.desc)) + '</div>';
  body += `<p style="margin-top:36px"><a href="/archive/${col.id}">&#128197; 该集合全部内容 &#8594;</a></p>`;
  res.send(pageShell(title, body));
});

// ===== RSS 输出（全站/单集合）=====
function escXml(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function rssFeed(req: any, cols: any[]): string {
  const host = String(req.headers.host || 'localhost');
  const proto = String(req.headers['x-forwarded-proto'] || 'http');
  const base = proto + '://' + host;
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>\n' +
    '<title>NavSite 内容订阅</title><link>' + base + '/archive</link>' +
    '<description>NavSite 内容集合最新条目</description><language>zh-CN</language>\n';
  for (const c of cols) {
    const items = db.prepare('SELECT id, data_json, created_at FROM collection_items WHERE collection_id = ? ORDER BY created_at DESC, id DESC LIMIT 30').all(c.id) as any[];
    for (const it of items) {
      const d = JSON.parse(it.data_json || '{}');
      const t = String(d.title || d.name || '（无标题）');
      const url = base + '/c/' + c.id + '/' + it.id;
      const desc = String(d.desc || '').slice(0, 500);
      xml += '<item><title>' + escXml(c.name + '：' + t) + '</title>' +
        '<link>' + escXml(url) + '</link>' +
        '<guid>' + escXml(url) + '</guid>' +
        '<pubDate>' + new Date(String(it.created_at).replace(' ', 'T') + 'Z').toUTCString() + '</pubDate>' +
        (desc ? '<description>' + escXml(desc) + '</description>' : '') +
        '</item>\n';
    }
  }
  return xml + '</channel></rss>';
}
app.get(['/feed.xml', '/feed/:key.xml'], (req, res) => {
  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  const key = (req.params as any).key;
  let cols: any[] = [];
  if (key) {
    const c = db.prepare('SELECT id, name, icon FROM collections WHERE name = ? OR id = ?').get(key, /^\d+$/.test(key) ? Number(key) : -1) as any;
    if (!c) return res.status(404).type('text').send('collection not found');
    cols = [c];
  } else {
    cols = db.prepare('SELECT id, name, icon FROM collections ORDER BY id').all() as any[];
  }
  res.send(rssFeed(req, cols));
});

// SPA 兜底：非 /api 路径回 index.html
app.get(/^\/(?!api|admin|garden).*/, (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});


// 定时切空间调度器已在上文 spaceEvents 上启动

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`[navsite] listening on :${PORT}`));

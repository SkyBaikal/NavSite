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
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // CSP：self + 内联样式（本地注入的主题样式表）+ data: 图片 + blob:（PWA）
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "connect-src 'self'; font-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  // widget 沙箱 iframe 需要 frame-ancestors 放行自身
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
});

app.use(express.json({ limit: '2mb' }));

app.use('/api', publicRouter);

// 登录预热/诊断端点（公开）：浏览器先 GET 一次拿 CF clearance，再 POST login，绕开 Bot Fight 对"冷 POST"的挑战
app.get('/api/healthz', (_req, res) => {
  res.json({ code: 'OK', source: 'navsite-origin', now: Date.now() });
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
// SPA 兜底：非 /api 路径回 index.html
app.get(/^\/(?!api|admin|garden).*/, (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

// 定时切空间调度器已在上文 spaceEvents 上启动

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`[navsite] listening on :${PORT}`));

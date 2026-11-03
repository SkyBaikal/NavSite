import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { genSecret, verifyTotp, otpauthUri } from '../services/totp.js';
import { generateCaptcha, verifyCaptcha, consumeCaptcha } from '../services/captcha.js';
import crypto from 'node:crypto';
import { db } from '../database.js';
import { isSafeExternalUrl } from '../services/ssrf.js';

export const adminRouter = Router();
// 审计：挂 router 级，requireAdmin 之后的写操作自动落 events_log
adminRouter.use(auditTrail);

// ---- 简单签名 session ----
const SECRET = process.env.NAV_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE = 'nav_session';
const MAX_AGE = 7 * 24 * 3600 * 1000;

function sign(payload: string) {
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${mac}`;
}
function verify(token: string): { user: string } | null {
  const [p, mac] = token.split('.');
  if (!p || !mac) return null;
  const payload = Buffer.from(p, 'base64url').toString();
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  const data = JSON.parse(payload);
  if (Date.now() - data.iat > MAX_AGE) return null;
  return data;
}

// 登录限速（内存）
const fails = new Map<string, { n: number; until: number }>();
function rateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || 'unknown';
  const f = fails.get(ip);
  if (f && f.until > Date.now()) {
    if ((req.body as any)?.form) return res.redirect(303, '/admin?e=rate');
    return res.status(429).json({ code: 'RATE_LIMITED', message: '尝试过多，请稍后再试' });
  }
  next();
}

// 静态后台页面登录门槛：无效 session → 返回极简跳转页（不泄露后台源码）
export function requirePageLogin(req: Request, res: Response, next: NextFunction) {
  const raw = req.headers.cookie || '';
  const m = raw.match(new RegExp(`${COOKIE}=([^;]+)`));
  if (m && verify(decodeURIComponent(m[1]))) return next();
  res.status(401).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>401 · 请登录</title><style>
    body{background:#0b0e14;color:#e8eaf0;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0}
    .card{background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.09);border-radius:16px;padding:32px 40px;text-align:center;backdrop-filter:blur(18px)}
    input{display:block;margin:10px auto;padding:10px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.07);color:#e8eaf0;width:220px}
    button{margin-top:6px;padding:10px 28px;border:none;border-radius:8px;background:linear-gradient(135deg,#14b8a6,#0d9488);color:#04211d;font-weight:700;cursor:pointer}
    #msg{color:#f87171;font-size:12px;min-height:16px;margin-top:8px}
  </style></head><body><div class="card"><div style="font-size:40px">🔒</div>
  <p style="margin:8px 0 16px">NavSite 后台登录</p>
  <form method="POST" action="/api/admin/login" id="lform" onsubmit="try{sessionStorage.setItem('ns_u',document.getElementById('u').value);sessionStorage.setItem('ns_p',document.getElementById('p').value)}catch(_){}">
    <input type="hidden" name="form" value="1">
    <input id="u" name="username" placeholder="用户名" autocomplete="username">
    <input id="p" type="password" name="password" placeholder="密码" autocomplete="current-password">
    <input id="t" name="totp" placeholder="两步验证码（未开启留空）" inputmode="numeric" maxlength="6" style="display:none">
    <div id="capRow" style="display:none;margin:8px 0 2px"><div id="capBox" style="cursor:pointer;display:inline-block" title="点击刷新验证码" onclick="loadCap()"></div><input id="cap" name="captcha_token" type="hidden"><input id="capAns" name="captcha_answer" placeholder="图中 4 位数字" inputmode="numeric" maxlength="4" autocomplete="off" style="width:220px"></div>
    <button>登 录</button></form>
  <div id="msg"></div></div>
  <script data-cfasync="false">
let capToken='';
async function loadCap(){try{const r=await fetch('/api/admin/captcha',{cache:'no-store'});const d=await r.json();if(d.data&&d.data.enabled){document.getElementById('capRow').style.display='block';document.getElementById('capBox').innerHTML=d.data.svg;capToken=d.data.token;document.getElementById('cap').value=capToken;}else{document.getElementById('capRow').style.display='none';capToken='';}}catch(_){}}
(function(){
  const m=document.getElementById('msg');
  const e=new URLSearchParams(location.search).get('e');
  const msgs={totp:'请输入认证器中的 6 位两步验证码',bad:'账号或密码错误',cap:'验证码错误或已过期，已为您刷新，请重新输入',rate:'尝试过多，IP 已被锁定 10 分钟，请稍后再试'};
  if(e&&msgs[e]){m.textContent=msgs[e];if(e!=='totp')loadCap();if(e==='totp'){const t=document.getElementById('t');t.style.display='block';t.focus();
    try{const u=sessionStorage.getItem('ns_u');const p=sessionStorage.getItem('ns_p');if(u){document.getElementById('u').value=u;}if(p){document.getElementById('p').value=p;sessionStorage.removeItem('ns_p');sessionStorage.removeItem('ns_u');}}catch(_){}}}
  if(!e)loadCap();
  // 登录是原生表单导航，CF 挑战会自然呈现
})();
</script>
  </body></html>`);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const raw = req.headers.cookie || '';
  const m = raw.match(new RegExp(`${COOKIE}=([^;]+)`));
  if (m) {
    const data = verify(decodeURIComponent(m[1]));
    if (data) {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      // viewer 角色禁止一切写操作（读操作放行）
      if (parsed.role === 'viewer' && ['POST', 'PUT', 'DELETE'].includes(req.method) && !req.path.startsWith('/login') && !req.path.startsWith('/logout')) {
        return res.status(403).json({ code: 'FORBIDDEN', message: '只读账号无权执行写操作' });
      }
      (req as any).role = parsed.role || 'admin';
      return next();
    }
  }
  res.status(401).json({ code: 'UNAUTHORIZED', message: '请先登录' });
}

// ---- 操作审计：所有 admin 写操作（POST/PUT/DELETE 成功后）落 events_log ----
export function auditTrail(req: Request, res: Response, next: NextFunction) {
  if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return next();
  const orig = res.json.bind(res);
  res.json = (body: any) => {
    if (body?.code === 'OK' && !req.path.startsWith('/automation/test')) {
      try {
        db.prepare('INSERT INTO events_log (type, payload_json) VALUES (?, ?)').run(
          `audit.${req.method.toLowerCase()}:${req.path}`,
          JSON.stringify({ body: { ...(req.body || {}) }, at: new Date().toISOString() }).slice(0, 2000)
        );
      } catch { /* 审计失败不阻塞业务 */ }
    }
    return orig(body);
  };
  next();
}

// ---- 认证 ----
// ---- 图形验证码（登录防穷举）----
const captchaEnabled = () => (db.prepare("SELECT value FROM settings WHERE key = 'captcha_enabled'").get() as any)?.value !== 'off';
adminRouter.get('/captcha', rateLimit, (_req, res) => {
  if (!captchaEnabled()) return res.json({ code: 'OK', data: { enabled: false } });
  const ch = generateCaptcha(SECRET);
  res.json({ code: 'OK', data: { enabled: true, svg: ch.svg, token: ch.token } });
});

adminRouter.post('/login', rateLimit, (req, res) => {
  const { username, password } = req.body || {};
  // 查询两个账号表：admin（全权）+ viewer（只读）
  let row: any = db.prepare(`SELECT username, password_hash, 'admin' AS role FROM admin WHERE id = 1 AND username = ?`).get(username);
  let role = row?.role;
  if (!row) {
    try {
      const v = db.prepare('SELECT username, password_hash FROM admin_viewers WHERE username = ?').get(username) as any;
      if (v) { row = v; role = 'viewer'; }
    } catch { /* admin_viewers 表不存在则忽略 */ }
  }
  if (!row || role === undefined || !bcrypt.compareSync(String(password || ''), row.password_hash)) {
    const ip = req.ip || 'unknown';
    const f = fails.get(ip) || { n: 0, until: 0 };
    f.n++;
    if (f.n >= 5) { f.until = Date.now() + 10 * 60 * 1000; f.n = 0; }
    fails.set(ip, f);
    if (req.body && req.body.form) return res.redirect(303, '/admin?e=bad');
    res.status(401).json({ code: 'BAD_CREDENTIALS', message: '账号或密码错误' });
  }
  fails.delete(req.ip || 'unknown');
  // 图形验证码（在凭据验证后、2FA 前：防穷举；TOTP_REQUIRED 时不作废 token，二次提交免重输）
  if (captchaEnabled()) {
    const { captcha_token, captcha_answer } = req.body || {};
    if (!verifyCaptcha(SECRET, String(captcha_token || ''), String(captcha_answer || ''))) {
      if (req.body && req.body.form) return res.redirect(303, '/admin?e=cap');
      return res.status(401).json({ code: 'CAPTCHA_INVALID', message: '验证码错误或已过期，请刷新后重试' });
    }
  }
  // 2FA：admin 启用了 TOTP 则必须带有效验证码（viewer 不强制）
  if (role === 'admin') {
    const s = db.prepare("SELECT value FROM settings WHERE key = 'twofa.secret'").get() as any;
    if (s?.value) {
      const code = String((req.body || {}).totp || '').trim();
      if (!code) {
        if (req.body && req.body.form) return res.redirect(303, '/admin?e=totp');
        return res.status(401).json({ code: 'TOTP_REQUIRED', message: '请输入两步验证码' });
      }
      if (!verifyTotp(s.value, code)) {
        if (req.body && req.body.form) return res.redirect(303, '/admin?e=totp');
        return res.status(401).json({ code: 'TOTP_INVALID', message: '两步验证码错误' });
      }
    }
  }
  if (captchaEnabled()) consumeCaptcha(String((req.body || {}).captcha_token || ''));
  const token = sign(JSON.stringify({ user: row.username, role, iat: Date.now() }));
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=${MAX_AGE / 1000}`);
  if (req.body && req.body.form) {
    // 传统表单登录：303 原生导航重定向——cookie 由浏览器在真实导航中种下，不依赖 XHR Set-Cookie 链路
    return res.redirect(303, '/admin');
  }
  res.json({ code: 'OK', data: { user: row.username, role } });
});

// 只读账号管理（全权 admin 专用）
adminRouter.get('/viewers', requireAdmin, (_req, res) => {
  try { res.json({ code: 'OK', data: db.prepare('SELECT username, created_at FROM admin_viewers').all() }); }
  catch { res.json({ code: 'OK', data: [] }); }
});
adminRouter.post('/viewers', requireAdmin, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || String(password).length < 6) return res.status(400).json({ code: 'INVALID', message: '用户名必填，密码 ≥6 位' });
  try {
    db.prepare('INSERT INTO admin_viewers (username, password_hash) VALUES (?, ?)').run(String(username), bcrypt.hashSync(String(password), 10));
    res.json({ code: 'OK' });
  } catch (e: any) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ code: 'DUP', message: '用户名已存在' });
    throw e;
  }
});
// ===== 数据洞察仪表盘 =====
// ---- 链接健康检查：并发 HEAD/GET 体检可见链接（SSRF 校验 + 8s 超时）----

// ---- 数字空间：笔记 CRUD（含 [[双向链接]] 解析）----
function slugify(title: string): string {
  const base = title.trim().toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'note';
  let slug = base, n = 1;
  while (db.prepare('SELECT 1 FROM notes WHERE public_slug = ?').get(slug)) slug = `${base}-${n++}`;
  return slug;
}
function syncNoteLinks(noteId: number, body: string) {
  db.prepare('DELETE FROM note_links WHERE source_id = ?').run(noteId);
  const titles = [...new Set([...body.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1].trim()))].slice(0, 100);
  for (const t of titles) {
    const target = db.prepare('SELECT id FROM notes WHERE title = ?').get(t) as any;
    if (target && target.id !== noteId) {
      db.prepare('INSERT OR IGNORE INTO note_links (source_id, target_id) VALUES (?, ?)').run(noteId, target.id);
    }
  }
}
// ---- 入站 webhook token 管理 ----
function ensureHookToken(): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'hooks_token'").get() as any;
  if (row?.value) return String(row.value);
  const t = crypto.randomBytes(16).toString('hex');
  db.prepare("INSERT INTO settings (key, value) VALUES ('hooks_token', ?)").run(t);
  return t;
}
adminRouter.get('/hooks/token', requireAdmin, (_req, res) => {
  res.json({ code: 'OK', data: { token: ensureHookToken(), example: `curl -X POST <你的域名>/api/hooks/<token> -H 'Content-Type: application/json' -d '{"text":"随手记一句","action":"note"}'` } });
});
adminRouter.post('/hooks/rotate', requireAdmin, (_req, res) => {
  db.prepare("DELETE FROM settings WHERE key = 'hooks_token'").run();
  res.json({ code: 'OK', data: { token: ensureHookToken() } });
});

adminRouter.get('/notes', requireAdmin, (_req, res) => {
  const rows = db.prepare('SELECT id, title, tags, is_public, public_slug, length(body) AS size, created_at, updated_at FROM notes ORDER BY updated_at DESC').all();
  res.json({ code: 'OK', data: rows });
});
adminRouter.get('/notes/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(Number(req.params.id)) as any;
  if (!row) return res.status(404).json({ code: 'NOT_FOUND' });
  const backlinks = db.prepare('SELECT id, title, public_slug, is_public FROM notes n JOIN note_links l ON l.source_id = n.id WHERE l.target_id = ?').all(row.id);
  const outlinks = db.prepare('SELECT id, title, public_slug, is_public FROM notes n JOIN note_links l ON l.target_id = n.id WHERE l.source_id = ?').all(row.id);
  res.json({ code: 'OK', data: { ...row, backlinks, outlinks } });
});
adminRouter.post('/notes', requireAdmin, (req, res) => {
  const { title, body, tags, is_public, space_id } = req.body || {};
  const t = String(title || '').trim().slice(0, 120) || '无标题';
  const sid = Number(space_id) || (db.prepare('SELECT id FROM spaces ORDER BY id LIMIT 1').get() as any)?.id;
  if (!sid) return res.status(400).json({ code: 'INVALID', message: '无可用空间' });
  const slug = is_public ? slugify(t) : null;
  const info = db.prepare("INSERT INTO notes (space_id, title, body, tags, is_public, public_slug) VALUES (?, ?, ?, ?, ?, ?)")
    .run(sid, t, String(body || '').slice(0, 200000), String(tags || '').slice(0, 200), is_public ? 1 : 0, slug);
  syncNoteLinks(info.lastInsertRowid as number, String(body || ''));
  db.prepare("INSERT INTO events_log (type, payload_json) VALUES ('audit.post:/notes', ?)").run(JSON.stringify({ id: info.lastInsertRowid }));
  res.json({ code: 'OK', data: { id: info.lastInsertRowid, slug } });
});
adminRouter.put('/notes/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(Number(req.params.id)) as any;
  if (!row) return res.status(404).json({ code: 'NOT_FOUND' });
  const b = req.body || {};
  const title = b.title !== undefined ? String(b.title).trim().slice(0, 120) || '无标题' : row.title;
  const body = b.body !== undefined ? String(b.body).slice(0, 200000) : row.body;
  const tags = b.tags !== undefined ? String(b.tags).slice(0, 200) : row.tags;
  let isPublic = b.is_public !== undefined ? (b.is_public ? 1 : 0) : row.is_public;
  let slug = row.public_slug;
  if (isPublic && !slug) slug = slugify(title);
  if (!isPublic) slug = null;
  db.prepare("UPDATE notes SET title = ?, body = ?, tags = ?, is_public = ?, public_slug = ?, updated_at = datetime('now') WHERE id = ?")
    .run(title, body, tags, isPublic, slug, row.id);
  syncNoteLinks(row.id, body);
  res.json({ code: 'OK', data: { slug } });
});
adminRouter.delete('/notes/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM note_links WHERE source_id = ? OR target_id = ?').run(Number(req.params.id), Number(req.params.id));
  const info = db.prepare('DELETE FROM notes WHERE id = ?').run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ code: 'NOT_FOUND' });
  res.json({ code: 'OK' });
});
adminRouter.get('/notes-graph', requireAdmin, (_req, res) => {
  const nodes = db.prepare('SELECT id, title, is_public FROM notes').all();
  const edges = db.prepare('SELECT source_id, target_id FROM note_links').all();
  res.json({ code: 'OK', data: { nodes, edges } });
});

adminRouter.post('/healthcheck', requireAdmin, async (_req, res) => {
  const links = db.prepare('SELECT id, title, url FROM links WHERE is_visible = 1').all() as any[];
  const CONC = 6;
  const results: any[] = [];
  let idx = 0;
  async function checkOne(l: any) {
    const base = { id: l.id, title: l.title, url: l.url };
    let u: URL;
    try { u = new URL(l.url); } catch { return { ...base, ok: false, code: 0, note: 'URL 无效' }; }
    if (!/^https?:$/.test(u.protocol)) return { ...base, ok: false, code: 0, note: '协议不支持' };
    if (!isSafeExternalUrl(l.url)) return { ...base, ok: false, code: 0, note: '内网地址已拦截' };
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(l.url, { method: 'GET', redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'NavSite-HealthCheck/1.0' } });
      clearTimeout(t);
      return { ...base, ok: r.status < 400, code: r.status, note: r.status < 400 ? '正常' : 'HTTP ' + r.status };
    } catch (e: any) {
      return { ...base, ok: false, code: 0, note: e?.name === 'AbortError' ? '超时(8s)' : '连接失败' };
    }
  }
  async function worker() {
    while (idx < links.length) {
      const l = links[idx++];
      results.push(await checkOne(l));
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, links.length) }, worker));
  results.sort((a, b) => (a.ok === b.ok ? a.id - b.id : a.ok ? 1 : -1));
  const dead = results.filter(r => !r.ok).length;
  db.prepare("INSERT INTO events_log (type, payload_json) VALUES ('admin.healthcheck', ?)")
    .run(JSON.stringify({ total: links.length, dead }));
  res.json({ code: 'OK', data: { total: results.length, dead, results } });
});

adminRouter.get('/insights', requireAdmin, (_req, res) => {
  const top = db.prepare(`SELECT l.title, l.url, l.clicks, c.name AS category FROM links l LEFT JOIN categories c ON l.category_id = c.id WHERE l.clicks > 0 ORDER BY l.clicks DESC LIMIT 10`).all();
  const trend = db.prepare(`SELECT date(created_at) AS day, count(*) AS n FROM events_log WHERE type = 'link.click' AND created_at >= datetime('now', '-7 days') GROUP BY date(created_at) ORDER BY day`).all();
  const hours = db.prepare(`SELECT strftime('%H', created_at) AS h, count(*) AS n FROM events_log WHERE type = 'link.click' AND created_at >= datetime('now', '-30 days') GROUP BY h ORDER BY h`).all();
  const recent = db.prepare(`SELECT payload_json, created_at FROM events_log WHERE type = 'link.click' ORDER BY id DESC LIMIT 8`).all().map((r: any) => {
    try { const p = JSON.parse(r.payload_json); const l = db.prepare('SELECT title FROM links WHERE id = ?').get(p.linkId) as any; return { title: l?.title || `#${p.linkId}`, at: r.created_at }; } catch { return null; }
  }).filter(Boolean);
  const totalClicks = db.prepare('SELECT count(*) AS n FROM events_log WHERE type = \'link.click\'').get() as any;
  const activeLinks = db.prepare('SELECT count(DISTINCT payload_json) AS n FROM events_log WHERE type = \'link.click\'').get() as any;
  res.json({ code: 'OK', data: { top, trend, hours, recent, totalClicks: totalClicks?.n || 0, activeLinks: activeLinks?.n || 0 } });
});

// ===== 两步验证（TOTP）=====
adminRouter.get('/2fa/status', requireAdmin, (_req, res) => {
  const s = db.prepare("SELECT value FROM settings WHERE key = 'twofa.secret'").get() as any;
  res.json({ code: 'OK', data: { enabled: !!s?.value } });
});
adminRouter.post('/2fa/setup', requireAdmin, (_req, res) => {
  const secret = genSecret();
  db.prepare("INSERT INTO settings (key, value) VALUES ('twofa.pending', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(secret);
  const row = db.prepare('SELECT username FROM admin WHERE id = 1').get() as any;
  res.json({ code: 'OK', data: { secret, uri: otpauthUri(secret, row?.username || 'admin') } });
});
adminRouter.post('/2fa/enable', requireAdmin, (req, res) => {
  const pending = db.prepare("SELECT value FROM settings WHERE key = 'twofa.pending'").get() as any;
  if (!pending?.value) return res.status(400).json({ code: 'INVALID', message: '请先生成密钥' });
  if (!verifyTotp(pending.value, String((req.body || {}).code || ''))) {
    return res.status(400).json({ code: 'INVALID', message: '验证码错误，请重试' });
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('twofa.secret', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(pending.value);
  db.prepare("DELETE FROM settings WHERE key = 'twofa.pending'").run();
  try { db.prepare("INSERT INTO events_log (type, payload_json, created_at) VALUES ('audit.2fa.enable', ?, datetime('now','localtime'))").run(JSON.stringify({ detail: '两步验证已启用' })); } catch {}
  res.json({ code: 'OK' });
});
adminRouter.post('/2fa/disable', requireAdmin, (req, res) => {
  const s = db.prepare("SELECT value FROM settings WHERE key = 'twofa.secret'").get() as any;
  if (s?.value && !verifyTotp(s.value, String((req.body || {}).code || ''))) {
    return res.status(400).json({ code: 'INVALID', message: '验证码错误' });
  }
  db.prepare("DELETE FROM settings WHERE key IN ('twofa.secret','twofa.pending')").run();
  try { db.prepare("INSERT INTO events_log (type, payload_json, created_at) VALUES ('audit.2fa.disable', ?, datetime('now','localtime'))").run(JSON.stringify({ detail: '两步验证已关闭' })); } catch {}
  res.json({ code: 'OK' });
});

// ===== 修改管理员密码 =====
adminRouter.post('/password', requireAdmin, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) return res.status(400).json({ code: 'INVALID', message: '旧密码与新密码必填' });
  if (String(newPassword).length < 8) return res.status(400).json({ code: 'INVALID', message: '新密码至少 8 位' });
  const row = db.prepare('SELECT password_hash FROM admin WHERE id = 1').get() as any;
  if (!row || !bcrypt.compareSync(String(oldPassword), row.password_hash)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: '旧密码不正确' });
  }
  db.prepare('UPDATE admin SET password_hash = ? WHERE id = 1').run(bcrypt.hashSync(String(newPassword), 10));
  try { db.prepare("INSERT INTO events_log (type, payload_json, created_at) VALUES ('audit.password.change', ?, datetime('now','localtime'))").run(JSON.stringify({ detail: `管理员密码已修改（by ${ (req as any).user?.username || 'admin' }）` })); } catch {}
  res.json({ code: 'OK' });
});

adminRouter.delete('/viewers/:username', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM admin_viewers WHERE username = ?').run(req.params.username);
  res.json({ code: 'OK' });
});

adminRouter.post('/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=0`);
  res.json({ code: 'OK' });
});

adminRouter.get('/me', requireAdmin, (req, res) => {
  res.json({ code: 'OK', data: { user: (verify((req.headers.cookie || '').match(new RegExp(`${COOKIE}=([^;]+)`) || ['', ''])[1] || '') || {}).user } });
});

// ---- 分类 CRUD ----
adminRouter.get('/categories', requireAdmin, (_req, res) => {
  res.json({ code: 'OK', data: db.prepare('SELECT * FROM categories ORDER BY sort_order').all() });
});
adminRouter.post('/categories', requireAdmin, (req, res) => {
  const { name, icon = '', sort_order = 0 } = req.body || {};
  if (!name) return res.status(400).json({ code: 'INVALID', message: 'name 必填' });
  const r = db.prepare('INSERT INTO categories (name, icon, sort_order) VALUES (?, ?, ?)').run(name, icon, sort_order);
  res.status(201).json({ code: 'OK', data: { id: r.lastInsertRowid } });
});
adminRouter.put('/categories/:id', requireAdmin, (req, res) => {
  const c = db.prepare('SELECT id FROM categories WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ code: 'NOT_FOUND' });
  const { name, icon, sort_order, is_visible } = req.body || {};
  db.prepare('UPDATE categories SET name = COALESCE(?, name), icon = COALESCE(?, icon), sort_order = COALESCE(?, sort_order), is_visible = COALESCE(?, is_visible) WHERE id = ?')
    .run(name ?? null, icon ?? null, sort_order ?? null, is_visible ?? null, req.params.id);
  res.json({ code: 'OK' });
});
adminRouter.delete('/categories/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ code: 'OK' });
});
// 分类批量重排：{ orders: [{id, sort_order}] }
adminRouter.post('/categories/reorder', requireAdmin, (req, res) => {
  const orders = req.body?.orders;
  if (!Array.isArray(orders) || orders.length > 100) return res.status(400).json({ code: 'INVALID' });
  const tx = db.transaction((list: any[]) => {
    for (const o of list) {
      if (typeof o.id !== 'number' || typeof o.sort_order !== 'number') continue;
      db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?').run(o.sort_order, o.id);
    }
  });
  tx(orders);
  res.json({ code: 'OK', data: { updated: orders.length } });
});

// ---- 链接 CRUD ----
adminRouter.get('/links', requireAdmin, (_req, res) => {
  res.json({ code: 'OK', data: db.prepare('SELECT * FROM links ORDER BY category_id, sort_order').all() });
});
adminRouter.post('/links', requireAdmin, (req, res) => {
  const { category_id, title, url, description = '', icon_url = '', sort_order = 0 } = req.body || {};
  if (!category_id || !title || !url) return res.status(400).json({ code: 'INVALID', message: 'category_id/title/url 必填' });
  try {
    const r = db.prepare('INSERT INTO links (category_id, title, url, description, icon_url, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
      .run(category_id, title, url, description, icon_url, sort_order);
    res.status(201).json({ code: 'OK', data: { id: r.lastInsertRowid } });
  } catch (e: any) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ code: 'DUP_URL', message: '该链接已存在' });
    throw e;
  }
});
adminRouter.put('/links/:id', requireAdmin, (req, res) => {
  const l = db.prepare('SELECT id FROM links WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ code: 'NOT_FOUND' });
  const b = req.body || {};
  db.prepare(`UPDATE links SET category_id = COALESCE(?, category_id), title = COALESCE(?, title), url = COALESCE(?, url),
    description = COALESCE(?, description), icon_url = COALESCE(?, icon_url), sort_order = COALESCE(?, sort_order),
    is_visible = COALESCE(?, is_visible), updated_at = datetime('now') WHERE id = ?`)
    .run(b.category_id ?? null, b.title ?? null, b.url ?? null, b.description ?? null, b.icon_url ?? null, b.sort_order ?? null, b.is_visible ?? null, (b.alias ?? null) === null ? null : String(b.alias).trim().toLowerCase() || null, req.params.id);
  res.json({ code: 'OK' });
});
adminRouter.delete('/links/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM links WHERE id = ?').run(req.params.id);
  res.json({ code: 'OK' });
});
// 链接批量重排：{ orders: [{id, sort_order, category_id?}] }（拖拽排序/跨分类移动共用）
adminRouter.post('/links/reorder', requireAdmin, (req, res) => {
  const orders = req.body?.orders;
  if (!Array.isArray(orders) || orders.length > 500) return res.status(400).json({ code: 'INVALID' });
  const tx = db.transaction((list: any[]) => {
    for (const o of list) {
      if (typeof o.id !== 'number' || typeof o.sort_order !== 'number') continue;
      db.prepare('UPDATE links SET sort_order = ?, category_id = COALESCE(?, category_id), updated_at = datetime(\'now\') WHERE id = ?')
        .run(o.sort_order, o.category_id ?? null, o.id);
    }
  });
  tx(orders);
  res.json({ code: 'OK', data: { updated: orders.length } });
});

// ---- 空间 CRUD ----
// 给布局内每个 widget 分配稳定 id（wN 递增），联动规则/widget state 依赖它
function assignWidgetIds(layout: any[], existing: any[] = []): any[] {
  let maxId = 0;
  for (const w of existing) {
    const m = typeof w?.id === 'string' && /^w(\d+)$/.exec(w.id);
    if (m) maxId = Math.max(maxId, +m[1]);
  }
  return layout.map(w => {
    if (w.id) return w;
    maxId += 1;
    return { ...w, id: 'w' + maxId };
  });
}
function parseLayout(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}
adminRouter.get('/spaces', requireAdmin, (_req, res) => {
  res.json({ code: 'OK', data: db.prepare('SELECT * FROM spaces ORDER BY sort_order').all() });
});
adminRouter.post('/spaces', requireAdmin, (req, res) => {
  const { name, icon = '🏠', layout_json = [], theme_json = {}, switch_rule = { mode: 'manual' } } = req.body || {};
  if (!name) return res.status(400).json({ code: 'INVALID', message: 'name 必填' });
  // 兼容前端传字符串或对象：统一存为单层 JSON 字符串
  const norm = (v, dflt) => {
    if (v === undefined || v === null) return JSON.stringify(dflt);
    if (typeof v === 'string') { try { JSON.parse(v); return v; } catch { return JSON.stringify(dflt); } }
    return JSON.stringify(v);
  };
  const layout = assignWidgetIds(parseLayout(layout_json));
  const r = db.prepare('INSERT INTO spaces (name, icon, layout_json, theme_json, switch_rule) VALUES (?, ?, ?, ?, ?)')
    .run(name, icon, JSON.stringify(layout), norm(theme_json, {}), norm(switch_rule, { mode: 'manual' }));
  res.status(201).json({ code: 'OK', data: { id: r.lastInsertRowid } });
});
// ---- 空间分享：开启（生成 code）/ 关闭 ----
adminRouter.post('/spaces/:id/share', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const sp = db.prepare('SELECT id FROM spaces WHERE id = ?').get(id) as any;
  if (!sp) return res.status(404).json({ code: 'NOT_FOUND' });
  const code = crypto.randomBytes(6).toString('base64url');
  db.prepare('UPDATE spaces SET share_code = ?, share_enabled = 1 WHERE id = ?').run(code, id);
  res.json({ code: 'OK', data: { shareCode: code } });
});
adminRouter.delete('/spaces/:id/share', requireAdmin, (req, res) => {
  db.prepare('UPDATE spaces SET share_enabled = 0 WHERE id = ?').run(Number(req.params.id));
  res.json({ code: 'OK' });
});
adminRouter.put('/spaces/:id', requireAdmin, (req, res) => {
  const s = db.prepare('SELECT id FROM spaces WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ code: 'NOT_FOUND' });
  const b = req.body || {};
  const norm = (v, dflt) => {
    if (v === undefined) return null;
    if (typeof v === 'string') { try { JSON.parse(v); return v; } catch { return JSON.stringify(dflt); } }
    return JSON.stringify(v);
  };
  const prev = db.prepare('SELECT layout_json FROM spaces WHERE id = ?').get(req.params.id);
  const layout = assignWidgetIds(
    parseLayout(b.layout_json !== undefined ? b.layout_json : prev?.layout_json),
    parseLayout(prev?.layout_json),
  );
  db.prepare('UPDATE spaces SET name = COALESCE(?, name), icon = COALESCE(?, icon), layout_json = COALESCE(?, layout_json), theme_json = COALESCE(?, theme_json), switch_rule = COALESCE(?, switch_rule), sort_order = COALESCE(?, sort_order) WHERE id = ?')
    .run(b.name ?? null, b.icon ?? null, b.layout_json !== undefined ? JSON.stringify(layout) : null, norm(b.theme_json, {}), norm(b.switch_rule, { mode: 'manual' }), b.sort_order ?? null, req.params.id);
  res.json({ code: 'OK' });
});
adminRouter.delete('/spaces/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM spaces WHERE id = ?').run(req.params.id);
  res.json({ code: 'OK' });
});

// ---- widget 实例 ----
adminRouter.post('/widgets', requireAdmin, (req, res) => {
  const { space_id, type, props_json = {}, sort_order = 0 } = req.body || {};
  if (!space_id || !type) return res.status(400).json({ code: 'INVALID', message: 'space_id/type 必填' });
  const r = db.prepare('INSERT INTO widgets (space_id, type, props_json, sort_order) VALUES (?, ?, ?, ?)')
    .run(space_id, type, JSON.stringify(props_json), sort_order);
  res.status(201).json({ code: 'OK', data: { id: r.lastInsertRowid } });
});
adminRouter.put('/widgets/:id', requireAdmin, (req, res) => {
  const b = req.body || {};
  db.prepare('UPDATE widgets SET props_json = COALESCE(?, props_json), sort_order = COALESCE(?, sort_order), enabled = COALESCE(?, enabled) WHERE id = ?')
    .run(b.props_json === undefined ? null : JSON.stringify(b.props_json), b.sort_order ?? null, b.enabled ?? null, req.params.id);
  res.json({ code: 'OK' });
});
adminRouter.delete('/widgets/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM widgets WHERE id = ?').run(req.params.id);
  res.json({ code: 'OK' });
});

// ---- 设置 ----
adminRouter.get('/settings', requireAdmin, (_req, res) => {
  res.json({ code: 'OK', data: db.prepare('SELECT key, value FROM settings').all() });
});
adminRouter.put('/settings', requireAdmin, (req, res) => {
  const entries = Object.entries(req.body || {});
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const tx = db.transaction(() => { for (const [k, v] of entries) up.run(k, String(v)); });
  tx();
  res.json({ code: 'OK' });
});

// ---- 数据统计（全部本地事件流，零外部依赖）----


// ---- 外观/文案自定义（后台 → 前台遥控）----
const APPEARANCE_KEYS = ['custom_css', 'site_name', 'footer_text', 'search_placeholder', 'search_engines'];
adminRouter.get('/appearance', requireAdmin, (_req, res) => {
  const out = {};
  for (const k of APPEARANCE_KEYS) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('appearance.' + k) as any;
    out[k] = row?.value ?? '';
  }
  res.json({ code: 'OK', data: out });
});
adminRouter.put('/appearance', requireAdmin, (req, res) => {
  const b = req.body || {};
  for (const k of APPEARANCE_KEYS) {
    if (b[k] === undefined) continue;
    const v = String(b[k]).slice(0, k === 'custom_css' ? 100000 : 2000);
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run('appearance.' + k, v);
  }
  db.prepare("INSERT INTO events_log (type, payload_json) VALUES ('audit.appearance', ?)")
    .run(JSON.stringify({ keys: Object.keys(b).filter((k: string) => APPEARANCE_KEYS.includes(k)) }));
  res.json({ code: 'OK' });
});

// CSV 报表导出（链接清单+点击统计）
adminRouter.get('/export/links.csv', requireAdmin, (_req, res) => {
  const rows = db.prepare('SELECT l.id, l.title, l.url, c.name AS category, l.clicks, l.created_at FROM links l LEFT JOIN categories c ON c.id = l.category_id ORDER BY c.sort_order, l.sort_order').all() as any[];
  const esc = (s: any) => '"' + String(s ?? '').replace(/"/g, '""') + '"';
  const lines = ['\ufeff标题,URL,分类,点击次数,创建时间'];
  for (const r of rows) lines.push([esc(r.title), esc(r.url), esc(r.category), r.clicks ?? 0, esc(r.created_at)].join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="navsite-links.csv"');
  res.send(lines.join('\n'));
});

// 事件日志 CSV 导出
adminRouter.get('/export/events.csv', requireAdmin, (_req, res) => {
  const rows = db.prepare('SELECT type, payload_json, created_at FROM events_log ORDER BY id DESC LIMIT 5000').all() as any[];
  const esc = (s: any) => '"' + String(s ?? '').replace(/"/g, '""') + '"';
  const lines = ['\ufeff类型,载荷,时间'];
  for (const r of rows) lines.push([esc(r.type), esc(r.payload_json), esc(r.created_at)].join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="navsite-events.csv"');
  res.send(lines.join('\n'));
});

adminRouter.get('/stats', requireAdmin, (_req, res) => {
  // 点击 Top10（links.clicks 累计列）
  const topLinks = db.prepare('SELECT title, url, clicks FROM links WHERE clicks > 0 ORDER BY clicks DESC LIMIT 10').all();
  // 近 14 天每日 link.click 趋势
  const trend: { day: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const day = d.toISOString().slice(0, 10);
    const row = db.prepare(`SELECT count(*) AS c FROM events_log WHERE type = 'link.click' AND date(created_at) = ?`).get(day) as any;
    trend.push({ day, count: row?.c || 0 });
  }
  // 事件分布（最近 500 条）
  const eventDist = db.prepare(`SELECT type, count(*) AS c FROM events_log WHERE id > (SELECT MAX(id) - 500 FROM events_log) GROUP BY type ORDER BY c DESC LIMIT 12`).all();
  // 最近 20 条事件（实时流水）
  const recentEvents = db.prepare('SELECT type, payload_json, created_at FROM events_log ORDER BY id DESC LIMIT 20').all();
  // 总览
  const totals = {
    links: (db.prepare('SELECT count(*) AS c FROM links').get() as any).c,
    categories: (db.prepare('SELECT count(*) AS c FROM categories').get() as any).c,
    spaces: (db.prepare('SELECT count(*) AS c FROM spaces').get() as any).c,
    totalClicks: (db.prepare('SELECT coalesce(sum(clicks),0) AS c FROM links').get() as any).c,
    events: (db.prepare('SELECT count(*) AS c FROM events_log').get() as any).c,
    dbBytes: (db.prepare("SELECT page_count * page_size AS c FROM pragma_page_count(), pragma_page_size()").get() as any).c,
  };
  res.json({ code: 'OK', data: { topLinks, trend, eventDist, recentEvents, totals } });
});

// ---- widget 数据总览/管理（后台直管前台用户数据）----
// 全部 widget 的 user_state 一览（哪些模块存了什么数据、多大）
adminRouter.get('/widget-data', requireAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT u.widget_id, u.key, length(u.value_json) AS bytes
    FROM user_state u
    ORDER BY u.widget_id, u.key`).all();
  // countdowns 存 settings，也一并列出
  const cd = db.prepare("SELECT value FROM settings WHERE key = 'countdowns'").get() as any;
  const countdownCount = cd ? (JSON.parse(cd.value) as any[]).length : 0;
  res.json({ code: 'OK', data: { states: rows, countdownCount } });
});
// 清空某个 widget 的某项状态（保留 widget 本身）
adminRouter.delete('/widget-data/:widgetId/:key', requireAdmin, (req, res) => {
  const r = db.prepare('DELETE FROM user_state WHERE widget_id = ? AND key = ?').run(req.params.widgetId, req.params.key);
  if (r.changes === 0) return res.status(404).json({ code: 'NOT_FOUND', message: '无该状态' });
  db.prepare("INSERT INTO events_log (type, payload_json) VALUES ('audit.widget_data.clear', ?)")
    .run(JSON.stringify({ widgetId: req.params.widgetId, key: req.params.key, by: (req as any).user?.username || 'admin' }));
  res.json({ code: 'OK', cleared: r.changes });
});
// 清空全部倒计时
adminRouter.delete('/widget-data/countdowns', requireAdmin, (req, res) => {
  db.prepare("DELETE FROM settings WHERE key = 'countdowns'").run();
  db.prepare("INSERT INTO events_log (type, payload_json) VALUES ('audit.widget_data.clear', ?)")
    .run(JSON.stringify({ key: 'countdowns', by: (req as any).user?.username || 'admin' }));
  res.json({ code: 'OK' });
});

// ---- widget 运行时状态 ----
adminRouter.get('/widgets/:id/state', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT value_json FROM user_state WHERE widget_id = ? AND key = ?').get(req.params.id, String(req.query.key || 'note'));
  res.json({ code: 'OK', data: row ? JSON.parse(row.value_json) : null });
});
adminRouter.post('/widgets/:id/state', requireAdmin, (req, res) => {
  const { key = 'note', value = null } = req.body || {};
  db.prepare('INSERT INTO user_state (widget_id, key, value_json) VALUES (?, ?, ?) ON CONFLICT(widget_id, key) DO UPDATE SET value_json = excluded.value_json')
    .run(req.params.id, String(key), JSON.stringify(value));
  res.json({ code: 'OK' });
});

// ---- 书签导入（浏览器导出的 HTML）----
adminRouter.post('/import/bookmarks', requireAdmin, (req, res) => {
  const { html, defaultCategory = '导入书签' } = req.body || {};
  if (!html || typeof html !== 'string' || html.length > 5_000_000) {
    return res.status(400).json({ code: 'INVALID', message: '需要书签 HTML 内容（<5MB）' });
  }
  // 解析 <DT><H3>文件夹名</H3> 与 <DT><A href>标题</A>
  const items: { folder: string; title: string; url: string }[] = [];
  let folder = '';
  const re = /<h3[^>]*>([^<]+)<\/h3>|<a[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1] !== undefined) { folder = m[1].trim(); }
    else if (m[2]) {
      const url = m[2];
      if (!/^https?:\/\//i.test(url)) continue;
      items.push({ folder, title: (m[3] || url).trim().slice(0, 100), url });
    }
  }
  if (!items.length) return res.json({ code: 'OK', data: { imported: 0 } });

  // 建默认分类（或复用）
  let cat = db.prepare('SELECT id FROM categories WHERE name = ?').get(defaultCategory) as any;
  if (!cat) {
    const r = db.prepare('INSERT INTO categories (name, icon, sort_order) VALUES (?, ?, 999)').run(defaultCategory, '📥');
    cat = { id: Number(r.lastInsertRowid) };
  }
  const ins = db.prepare('INSERT OR IGNORE INTO links (category_id, title, url, description) VALUES (?, ?, ?, ?)');
  let imported = 0;
  const tx = db.transaction(() => {
    for (const it of items) {
      const r = ins.run(cat.id, it.title, it.url, it.folder ? `来自：${it.folder}` : '');
      imported += r.changes; // INSERT OR IGNORE 冲突时 changes 为 0
    }
  });
  tx();
  res.json({ code: 'OK', data: { imported, categoryId: cat.id, parsed: items.length } });
});

// ---- 导出 ----
// ---- 配置包商店 v0：内置精选包（一键应用主题到当前空间）----
const THEME_PACKS = [
  { id: 'obsidian', name: '曜石·玻璃拟态', icon: '🪨', desc: '深蓝黑底 + teal 霓虹 + 毛玻璃', tokens: { 'color-bg': '#0b0e14', 'color-card': 'rgba(255,255,255,.055)', 'color-ink': '#e8eaf0', 'color-muted': '#8b93a7', 'color-accent': '#2dd4bf', 'color-line': 'rgba(255,255,255,.09)', 'radius': '16px', 'gap': '16px' } },
  { id: 'paper', name: '纸墨·书卷', icon: '📜', desc: '米白纸感 + 墨色衬线', tokens: { 'color-bg': '#f7f4ee', 'color-card': '#ffffff', 'color-ink': '#1a2332', 'color-muted': '#6b7280', 'color-accent': '#0f766e', 'color-line': '#e2ddd3', 'radius': '12px', 'gap': '16px' } },
  { id: 'amber', name: '琥珀·暖夜', icon: '🍯', desc: '暖棕底 + 琥珀金强调', tokens: { 'color-bg': '#1c1410', 'color-card': 'rgba(245,158,11,.08)', 'color-ink': '#f5e9d9', 'color-muted': '#a89880', 'color-accent': '#f59e0b', 'color-line': 'rgba(245,158,11,.15)', 'radius': '14px', 'gap': '16px' } },
  { id: 'aurora', name: '极光·深紫', icon: '🌌', desc: '深紫底 + 粉紫渐变', tokens: { 'color-bg': '#12081f', 'color-card': 'rgba(167,139,250,.07)', 'color-ink': '#ede9fe', 'color-muted': '#9b8ab8', 'color-accent': '#e879f9', 'color-line': 'rgba(232,121,249,.15)', 'radius': '18px', 'gap': '14px' } },
];
adminRouter.get('/packs', requireAdmin, (_req, res) => {
  const cur = db.prepare('SELECT id FROM spaces ORDER BY sort_order LIMIT 1').get() as any;
  res.json({ code: 'OK', data: THEME_PACKS.map(p => ({ ...p, applied: false, targetSpace: cur?.id })) });
});
adminRouter.post('/packs/:id/apply', requireAdmin, (req, res) => {
  const pack = THEME_PACKS.find(p => p.id === req.params.id);
  if (!pack) return res.status(404).json({ code: 'NOT_FOUND' });
  const spaceId = Number(req.body?.spaceId) || (db.prepare('SELECT id FROM spaces ORDER BY sort_order LIMIT 1').get() as any)?.id;
  const sp = db.prepare('SELECT id FROM spaces WHERE id = ?').get(spaceId) as any;
  if (!sp) return res.status(404).json({ code: 'NOT_FOUND' });
  db.prepare('UPDATE spaces SET theme_json = ? WHERE id = ?').run(JSON.stringify(pack.tokens), spaceId);
  db.prepare("INSERT INTO events_log (type, payload_json) VALUES ('admin.pack.apply', ?)").run(JSON.stringify({ pack: pack.id, spaceId }));
  res.json({ code: 'OK', data: { pack: pack.id, spaceId } });
});

// ---- Obsidian 兼容全量导出（零依赖 store-zip）----
function crc32(buf: Buffer): number {
  let table = crcTable;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const crcTable = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function zipStore(files: { name: string; data: Buffer }[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(f.data.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    chunks.push(lh, nameBuf, f.data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(f.data.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(0, 42); ch.writeInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + f.data.length;
  }
  const cdStart = offset;
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([...chunks, cd, eocd]);
}
const yq = (s: string) => '"' + String(s || '').replace(/"/g, '""') + '"';

adminRouter.get('/export/obsidian', requireAdmin, (_req, res) => {
  const notes = db.prepare('SELECT * FROM notes ORDER BY updated_at DESC').all() as any[];
  const files: { name: string; data: Buffer }[] = [];
  const usedTitles = new Set<string>();
  for (const n of notes) {
    let fname = (n.title || '无标题').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '无标题';
    let k = 2; const base = fname;
    while (usedTitles.has(fname + '.md')) fname = `${base} ${k++}`;
    usedTitles.add(fname + '.md');
    const tags = String(n.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean);
    const fm = ['---', `title: ${yq(n.title)}`, `created: ${n.created_at}`, `updated: ${n.updated_at}`,
      `navsite-public: ${n.is_public ? 'true' : 'false'}`,
      ...(tags.length ? [`tags: [${tags.join(', ')}]`] : []), '---', ''].join('\n');
    files.push({ name: `Notes/${fname}.md`, data: Buffer.from(fm + n.body, 'utf8') });
  }
  // 待办（user_state w15 todos）
  const todoRow = db.prepare("SELECT value_json FROM user_state WHERE widget_id = 'w15' AND key = 'todos'").get() as any;
  if (todoRow) {
    let todos: any[] = [];
    try { todos = JSON.parse(todoRow.value_json); } catch {}
    const lines = ['# 待办存档', '', ...todos.map((t: any) => `- [${t.done ? 'x' : ' '}] ${t.text} (@ ${new Date(t.at).toISOString().slice(0, 10)})`)];
    files.push({ name: 'Tasks/todos.md', data: Buffer.from(lines.join('\n'), 'utf8') });
  }
  // 设置与链接快照（json）
  const dump = {
    exported_at: new Date().toISOString(), format: 'navsite-obsidian-bundle',
    categories: db.prepare('SELECT * FROM categories').all(),
    links: db.prepare('SELECT * FROM links').all(),
    spaces: db.prepare('SELECT id, name, sort_order FROM spaces').all(),
    settings: db.prepare("SELECT key FROM settings WHERE key NOT LIKE '%secret%' AND key NOT LIKE '%totp%' AND key NOT LIKE '%token%'").all(),
  };
  files.push({ name: 'navsite-snapshot.json', data: Buffer.from(JSON.stringify(dump, null, 2), 'utf8') });
  const zip = zipStore(files);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename=navsite-obsidian.zip');
  res.send(zip);
});

adminRouter.get('/export', requireAdmin, (_req, res) => {
  const dump = {
    exported_at: new Date().toISOString(),
    categories: db.prepare('SELECT * FROM categories').all(),
    links: db.prepare('SELECT * FROM links').all(),
    spaces: db.prepare('SELECT id, name, sort_order FROM spaces').all(),
    widgets: db.prepare('SELECT * FROM widgets').all(),
    settings: db.prepare("SELECT key FROM settings WHERE key NOT LIKE '%secret%' AND key NOT LIKE '%totp%' AND key NOT LIKE '%token%'").all(),
  };
  res.setHeader('Content-Disposition', 'attachment; filename=navsite-export.json');
  res.json(dump);
});

// ---- 导入（配置包恢复）----
// 模式 full=清空后重建（危险，需 confirm:true）；merge=按 URL 去重追加链接、空间跳过重名
adminRouter.post('/import', requireAdmin, (req, res) => {
  const dump = req.body?.dump;
  const mode = req.body?.mode === 'full' ? 'full' : 'merge';
  if (!dump || typeof dump !== 'object') return res.status(400).json({ code: 'INVALID', message: '需要 dump 对象' });
  if (mode === 'full' && req.body?.confirm !== true) return res.status(400).json({ code: 'CONFIRM_REQUIRED', message: 'full 模式需 confirm:true' });
  if (mode === 'full' && req.body?.confirm_text !== 'REPLACE ALL DATA') {
    return res.status(400).json({ code: 'CONFIRM_REQUIRED', message: 'full 模式需 confirm_text="REPLACE ALL DATA"' });
  }

  const stats = { categories: 0, links: 0, linksSkipped: 0, spaces: 0, spacesSkipped: 0, settings: 0 };
  const tx = db.transaction(() => {
    if (mode === 'full') {
      db.prepare('DELETE FROM links').run();
      db.prepare('DELETE FROM categories').run();
      db.prepare('DELETE FROM spaces').run();
      db.prepare('DELETE FROM widgets').run();
      db.prepare('DELETE FROM settings').run();
    }
    // 分类
    const insCat = db.prepare('INSERT INTO categories (name, icon, sort_order, is_visible) VALUES (?, ?, ?, COALESCE(?, 1))');
    const catIdMap = new Map<number, number>();
    for (const c of dump.categories || []) {
      const r = insCat.run(c.name, c.icon ?? '', c.sort_order ?? 0, c.is_visible ?? 1);
      catIdMap.set(c.id, Number(r.lastInsertRowid));
      stats.categories++;
    }
    // 链接（merge 按 URL 去重；full 直接灌）
    const insLink = db.prepare('INSERT INTO links (category_id, title, url, description, icon_url, sort_order, is_visible, clicks) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, 1), COALESCE(?, 0))');
    const exists = db.prepare('SELECT 1 FROM links WHERE url = ?');
    for (const l of dump.links || []) {
      if (mode === 'merge' && exists.get(l.url)) { stats.linksSkipped++; continue; }
      insLink.run(catIdMap.get(l.category_id) ?? l.category_id ?? null, l.title, l.url, l.description ?? null, l.icon_url ?? null, l.sort_order ?? 0, l.is_visible ?? 1, l.clicks ?? 0);
      stats.links++;
    }
    // 空间（merge 跳过重名）
    const insSpace = db.prepare('INSERT INTO spaces (name, icon, layout_json, theme_json, switch_rule, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
    const spaceExists = db.prepare('SELECT 1 FROM spaces WHERE name = ?');
    for (const s of dump.spaces || []) {
      let layout = s.layout_json;
      try { if (typeof layout === 'string') JSON.parse(layout); else layout = JSON.stringify(layout); } catch { layout = '[]'; }
      if (mode === 'merge' && spaceExists.get(s.name)) { stats.spacesSkipped++; continue; }
      insSpace.run(s.name, s.icon ?? '🏠', layout, s.theme_json ?? '{}', s.switch_rule ?? '{"mode":"manual"}', s.sort_order ?? 0);
      stats.spaces++;
    }
    // 设置
    const insSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const s of dump.settings || []) {
      if (!s.key) continue;
      insSetting.run(s.key, s.value);
      stats.settings++;
    }
  });
  tx();
  res.json({ code: 'OK', data: { mode, ...stats } });
});

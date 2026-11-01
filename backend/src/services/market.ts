import { Router } from 'express';
import { db } from '../database.js';
import { requireAdmin } from '../routes/admin.js';

export const marketRouter = Router();

// ---- 市场目录：内置 widget 清单（后续可扩展为远程 registry，本地兜底）----
const REGISTRY: any[] = [
  {
    id: 'searchbar', name: '搜索框', icon: '🔍', version: '1.0.0',
    desc: '多引擎搜索（百度/谷歌/Bing/必应/站内），支持 `关键词` 直达',
    author: 'navsite-core', builtin: true,
  },
  {
    id: 'clock', name: '时钟', icon: '🕐', version: '1.0.0',
    desc: '大字号数字时钟，秒级刷新', author: 'navsite-core', builtin: true,
  },
  {
    id: 'category', name: '分类卡片', icon: '📁', version: '1.0.0',
    desc: '渲染某个分类下的所有链接卡片，支持拖拽排序（登录后）', author: 'navsite-core', builtin: true,
  },
  {
    id: 'hitokoto', name: '一言', icon: '💬', version: '1.0.0',
    desc: '随机一句话（本地缓存兜底，断网可用）', author: 'navsite-core', builtin: true,
  },
  {
    id: 'quicknote', name: '速记便签', icon: '📝', version: '1.0.0',
    desc: '随手记一条，自动保存，支持跨天清空', author: 'navsite-core', builtin: true,
  },
  {
    id: 'habit', name: '习惯打卡', icon: '🔥', version: '1.1.0',
    desc: '每日打卡 + 连续天数 + 12 周 GitHub 风格热力图', author: 'navsite-core', builtin: true,
  },
  {
    id: 'rss', name: 'RSS 订阅', icon: '📰', version: '1.0.0',
    desc: '订阅任意 RSS 源，30 分钟缓存 + 断网回退 + 离线角标', author: 'navsite-core', builtin: true,
  },
  {
    id: 'weather', name: '天气', icon: '🌤️', version: '1.0.0',
    desc: '城市当前天气 + emoji，30 分钟缓存 + 断网回退', author: 'navsite-core', builtin: true,
  },
  {
    id: 'dailyshot', name: '每日一图', icon: '🖼️', version: '1.0.0',
    desc: 'Bing 每日壁纸 + 本地代理缓存 + 渐变字幕', author: 'navsite-core', builtin: true,
  },
];

// ---- manifest 校验 ----
function validateManifest(m: any): string[] {
  const errs: string[] = [];
  if (!m || typeof m !== 'object') return ['manifest 必须是 JSON 对象'];
  if (typeof m.id !== 'string' || !/^[a-z][a-z0-9_-]{1,31}$/.test(m.id)) errs.push('id：2-32 位小写字母数字-_，字母开头');
  if (typeof m.name !== 'string' || !m.name.trim()) errs.push('name：必填');
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(m.version)) errs.push('version：需 semver（如 1.0.0）');
  if (typeof m.desc !== 'string' || !m.desc.trim()) errs.push('desc：必填');
  if (m.icon && typeof m.icon !== 'string') errs.push('icon：需字符串');
  if (m.props !== undefined && typeof m.props !== 'object') errs.push('props：需对象');
  if (m.author !== undefined && typeof m.author !== 'string') errs.push('author：需字符串');
  return errs;
}

const installed = () => {
  try { return JSON.parse(db.prepare(`SELECT value FROM settings WHERE key='installed_widgets'`).get()?.value || '[]'); }
  catch { return []; }
};

// 市场目录（内置 + 已安装）
marketRouter.get('/api/market', (_req, res) => {
  const inst = installed();
  const builtins = REGISTRY.map(w => ({ ...w, installed: inst.some((i: any) => i.id === w.id) }));
  const thirdParty = inst.map((i: any) => ({ ...i, builtin: false, installed: true }));
  res.json({ code: 'OK', data: [...builtins, ...thirdParty] });
});

// 安装第三方 widget（manifest 校验 → 存 settings.installed_widgets）
marketRouter.post('/api/market/install', requireAdmin, (req, res) => {
  const m = req.body?.manifest;
  const errs = validateManifest(m);
  if (errs.length) return res.status(400).json({ code: 'INVALID', errors: errs });
  const inst = installed();
  if (REGISTRY.some(w => w.id === m.id)) return res.status(400).json({ code: 'CONFLICT', message: '与内置 widget id 冲突' });
  const dup = inst.findIndex((i: any) => i.id === m.id);
  const entry = {
    id: m.id, name: m.name, icon: m.icon || '🧩', version: m.version,
    desc: m.desc, author: m.author || 'unknown', props: m.props || {},
    installed_at: new Date().toISOString(),
  };
  if (dup >= 0) inst[dup] = entry; else inst.push(entry);
  db.prepare(`INSERT INTO settings (key, value) VALUES ('installed_widgets', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(JSON.stringify(inst));
  res.json({ code: 'OK', data: entry });
});

// 卸载
// 启停第三方 widget（disabled 只挡 runtime 执行，不卸载）
marketRouter.post('/api/market/toggle', requireAdmin, (req, res) => {
  const id = String(req.body?.id || '');
  const inst = installed();
  const it = inst.find((i: any) => i.id === id);
  if (!it) return res.status(404).json({ code: 'NOT_FOUND', message: 'widget 未安装' });
  it.disabled = !it.disabled;
  db.prepare(`UPDATE settings SET value = ? WHERE key = 'installed_widgets'`).run(JSON.stringify(inst));
  db.prepare(`INSERT INTO events_log (type, payload_json) VALUES (?, ?)`)
    .run('audit.market.toggle', JSON.stringify({ id, disabled: it.disabled }));
  res.json({ code: 'OK', data: { id, disabled: it.disabled } });
});

marketRouter.post('/api/market/uninstall', requireAdmin, (req, res) => {
  const id = req.body?.id;
  const inst = installed().filter((i: any) => i.id !== id);
  db.prepare(`UPDATE settings SET value = ? WHERE key = 'installed_widgets'`).run(JSON.stringify(inst));
  // 同时从当前空间布局里摘除
  try {
    for (const s of db.prepare('SELECT id, layout_json FROM spaces').all() as any[]) {
      let layout = JSON.parse(s.layout_json || '[]');
      const next = layout.filter((w: any) => w.type !== id);
      if (next.length !== layout.length) {
        db.prepare('UPDATE spaces SET layout_json = ? WHERE id = ?').run(JSON.stringify(next), s.id);
      }
    }
  } catch { /* 布局解析失败不阻塞卸载 */ }
  res.json({ code: 'OK' });
});

// ---- 沙箱化第三方 widget 运行时 ----
// 安全模型：iframe srcdoc + sandbox="allow-scripts"（无 same-origin → 拿不到 cookie/DOM/父页数据）
//           + postMessage 白名单 API（受控的 setState/getProps/toast）
const SANDBOX_TEMPLATE = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<div id="root"></div>
<script>
  const handlers = {
    setState: (v) => parent.postMessage({ __navsite: true, type: 'setState', id: __WIDGET_ID__, value: v }, '*'),
    getProps: () => __WIDGET_PROPS__,
    toast: (msg) => parent.postMessage({ __navsite: true, type: 'toast', id: __WIDGET_ID__, value: String(msg).slice(0, 200) }, '*'),
  };
  window.navsite = handlers;
  try {
    // 第三方代码在这里执行；code 由后台审核后存库
    (new Function('navsite', 'root', __WIDGET_CODE__))(handlers, document.getElementById('root'));
  } catch (e) {
    document.getElementById('root').textContent = '⚠️ widget 错误: ' + e.message;
  }
</script></body></html>`;

const trustedOrigins = new Set(['http://localhost:3000', 'http://localhost:8080', 'http://localhost:8081']);

export const widgetRuntimeRouter = Router();

// 获取某个已安装第三方 widget 的沙箱页面
widgetRuntimeRouter.get('/api/widget-runtime/:id', (req, res) => {
  const id = String(req.params.id);
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(id)) return res.status(400).json({ code: 'INVALID' });
  const inst = installed().find((i: any) => i.id === id);
  if (!inst) return res.status(404).json({ code: 'NOT_FOUND', message: 'widget 未安装' });
  if (inst.disabled) return res.status(403).json({ code: 'DISABLED', message: 'widget 已停用' });
  const code = inst.code || `root.innerHTML = '<div style="padding:16px;font-family:sans-serif">${inst.icon} ${inst.name}<br><small>${inst.desc}</small></div>';`;
  const html = SANDBOX_TEMPLATE
    .replace(/__WIDGET_ID__/g, JSON.stringify(id))
    .replace(/__WIDGET_PROPS__/g, JSON.stringify(inst.props || {}))
    .replace(/__WIDGET_CODE__/g, JSON.stringify(code));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'");
  res.send(html);
});

// 保存/更新第三方 widget 代码（admin）
widgetRuntimeRouter.post('/api/widget-runtime/:id/code', requireAdmin, (req, res) => {
  const id = String(req.params.id);
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(id)) return res.status(400).json({ code: 'INVALID' });
  const code = req.body?.code;
  if (typeof code !== 'string' || code.length > 64 * 1024) return res.status(400).json({ code: 'INVALID', message: 'code 需为 ≤64KB 的字符串' });
  const inst = installed();
  const idx = inst.findIndex((i: any) => i.id === id);
  if (idx < 0) return res.status(404).json({ code: 'NOT_FOUND' });
  inst[idx].code = code;
  inst[idx].code_updated_at = new Date().toISOString();
  db.prepare(`UPDATE settings SET value = ? WHERE key = 'installed_widgets'`).run(JSON.stringify(inst));
  res.json({ code: 'OK' });
});

// widget 前台事件上报（setState 持久化 / toast）— 公开（与 widget state 一致：状态即内容）
widgetRuntimeRouter.post('/api/widget-runtime/event', (req, res) => {
  const { id, type, value } = req.body || {};
  const inst = installed().find((i: any) => i.id === id);
  if (!inst) return res.status(404).json({ code: 'NOT_FOUND' });
  if (type === 'setState') {
    try {
      db.prepare(`INSERT INTO widgets (id, state_json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json`)
        .run(`thirdparty:${id}`, JSON.stringify({ value }));
    } catch { /* widgets 表结构不同则存 settings */ 
      db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
        .run(`widget_state:${id}`, JSON.stringify({ value }));
    }
    return res.json({ code: 'OK' });
  }
  if (type === 'toast') {
    db.prepare("INSERT INTO events_log (type, payload_json) VALUES ('widget.toast', ?)").run(JSON.stringify({ id, value }));
    return res.json({ code: 'OK' });
  }
  res.status(400).json({ code: 'INVALID', message: 'type 需为 setState|toast' });
});


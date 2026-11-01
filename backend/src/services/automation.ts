// 联动规则引擎：WHEN [事件] THEN [动作]
// 规则存在 settings 表 key = 'automation_rules'
// 格式: [{ id, when: {event, match?}, then: {action, params} }]

import { isSafeExternalUrl } from './ssrf.js';
import type Database from 'better-sqlite3';

export type Rule = {
  id: string;
  when: { event: string; match?: Record<string, any> };
  then: { action: string; params?: Record<string, any> };
};

export function getRules(db: Database.Database): Rule[] {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'automation_rules'").get() as any;
  try { return row ? JSON.parse(row.value) : []; } catch { return []; }
}

export function saveRules(db: Database.Database, rules: Rule[]) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('automation_rules', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(rules));
}

// 事件触发入口：匹配规则并执行动作
export function fireEvent(db: Database.Database, event: string, payload: Record<string, any> = {}): string[] {
  const fired: string[] = [];
  for (const rule of getRules(db)) {
    if (rule.when.event !== event) continue;
    if (rule.when.match) {
      const ok = Object.entries(rule.when.match).every(([k, v]) => payload[k] === v);
      if (!ok) continue;
    }
    if (executeAction(db, rule.then, payload)) fired.push(rule.id);
  }
  if (fired.length) {
    db.prepare('INSERT INTO events_log (type, payload_json) VALUES (?, ?)')
      .run(`rule.fired:${event}`, JSON.stringify({ rules: fired, payload }));
  }
  return fired;
}

function executeAction(db: Database.Database, then: Rule['then'], payload: Record<string, any>): boolean {
  const p = then.params || {};
  switch (then.action) {
    case 'switch_space':
      // 通过 SSE 通知前端
      db.prepare("INSERT INTO events_log (type, payload_json) VALUES ('action.switch_space', ?)")
        .run(JSON.stringify(p));
      globalThis.__spaceEvents?.emit('switch', p.spaceId);
      return true;
    case 'log':
      console.log('[automation]', p.message || JSON.stringify(payload));
      return true;
    case 'switch_theme':
      // 全站主题切换：写 settings.current_theme，前台 SSE 推送 theme 事件
      db.prepare("INSERT INTO settings (key, value) VALUES ('current_theme', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(JSON.stringify({ theme: p.theme || 'aurora' }));
      db.prepare("INSERT INTO events_log (type, payload_json) VALUES ('action.switch_theme', ?)")
        .run(JSON.stringify(p));
      globalThis.__spaceEvents?.emit('theme', p.theme || 'aurora');
      return true;
    case 'toggle_widget':
      // 显示/隐藏某类 widget：写 settings.widget_hidden（前台渲染时读取）
      {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'widget_hidden'").get() as any;
        let hidden: Record<string, boolean> = {};
        try { hidden = JSON.parse(row?.value || '{}'); } catch {}
        hidden[p.widgetType] = !!p.hidden;
        db.prepare("INSERT INTO settings (key, value) VALUES ('widget_hidden', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
          .run(JSON.stringify(hidden));
        db.prepare("INSERT INTO events_log (type, payload_json) VALUES ('action.toggle_widget', ?)")
          .run(JSON.stringify(p));
        globalThis.__spaceEvents?.emit('widgets_changed', hidden);
      }
      return true;
case 'toast':
      // 站内通知：写 events_log，前台 SSE notify 事件弹出 Toast
      db.prepare("INSERT INTO events_log (type, payload_json) VALUES ('action.notify', ?)")
        .run(JSON.stringify({ message: String(p.message || '').slice(0, 200), level: p.level || 'info' }));
      return true;
        case 'notify':
      // 通用手机推送：支持 Bark(iOS)/Server酱(微信) —— params: {channel:'bark'|'ftqq', key, title, body}
      {
        const channel = String(p.channel || 'bark');
        const title = encodeURIComponent(String(p.title || 'NavSite 通知'));
        const body = encodeURIComponent(String(p.body || JSON.stringify(payload)).slice(0, 200));
        const key = String(p.key || '');
        let url = '';
        if (channel === 'bark' && key) url = `https://api.day.app/${key}/${title}/${body}`;
        else if (channel === 'ftqq' && key) url = `https://sctapi.ftqq.com/${key}.send?title=${title}&desp=${body}`;
        if (!url || !isSafeExternalUrl(url)) return false;
        fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) })
          .then(r => { db.prepare("INSERT INTO events_log (type, payload_json) VALUES ('action.notify', ?)").run(JSON.stringify({ channel, status: r.status })); return r.status < 300; })
          .catch(() => { db.prepare("INSERT INTO events_log (type, payload_json) VALUES ('action.notify.error', ?)").run(JSON.stringify({ channel })); return false; });
        return true;
      }
    case 'webhook':
      // 外呼 Webhook：fire-and-forget POST（5s 超时，失败仅记日志）
      {
        const url = String(p.url || '');
        if (!/^https:\/\//.test(url)) return false; // 只允许 https 外呼
        if (!isSafeExternalUrl(url)) { console.warn('[automation] webhook 阻止内网地址:', url); return false; } // SSRF 防护
        fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: payload, params: p, ts: Date.now() }),
          signal: AbortSignal.timeout(5000),
        }).then(r => {
          db.prepare("INSERT INTO events_log (type, payload_json) VALUES ('action.webhook', ?)")
            .run(JSON.stringify({ url, status: r.status }));
        }).catch(e => {
          db.prepare("INSERT INTO events_log (type, payload_json) VALUES ('action.webhook.error', ?)")
            .run(JSON.stringify({ url, error: e.message }));
        });
        return true;
      }
    default:
      return false;
  }
}

// 可用动作清单（供编辑器展示）
export const ACTIONS = [
  { action: 'switch_space', label: '切换空间', params: ['spaceId'] },
  { action: 'log', label: '写日志', params: ['message'] },
  { action: 'switch_theme', label: '切换主题', params: ['theme'] },
  { action: 'toggle_widget', label: '显示/隐藏 Widget', params: ['widgetType', 'hidden'] },
  { action: 'notify', label: '站内通知', params: ['message', 'level'] },
  { action: 'webhook', label: 'Webhook (https)', params: ['url'] },
  { action: 'notify', label: '📱 手机推送 (Bark/Server酱)', params: ['channel', 'key', 'title', 'body'] },
];
export const EVENTS = [
  { event: 'link.click', label: '链接被点击' },
  { event: 'habit.checkin', label: '习惯打卡' },
  { event: 'schedule.trigger', label: '定时触发' },
  { event: 'space.switch', label: '空间切换' },
  { event: 'backup.created', label: '自动备份完成' },
];

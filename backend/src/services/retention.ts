// events_log 自动轮转：防无限增长
// 策略（双保险，任一触发即清理）：
//   1. 按条数：超过 MAX_ROWS 时删最老的（保留 MAX_ROWS 条）
//   2. 按时间：删除超过 RETAIN_DAYS 天的记录
// 每小时检查一次；admin 审计事件(audit.*)保留期更长（工业惯例：审计留痕 > 普通事件）

import type Database from 'better-sqlite3';

const MAX_ROWS = 20000;       // 硬上限（约 10MB）
const RETAIN_DAYS = 90;       // 普通事件保留 90 天
const AUDIT_RETAIN_DAYS = 365; // 审计事件保留 1 年

export function pruneEventsLog(db: Database.Database): { deleted: number } {
  const r1 = db.prepare(`DELETE FROM events_log WHERE id NOT IN (SELECT id FROM events_log ORDER BY id DESC LIMIT ?)`).run(MAX_ROWS);
  const r2 = db.prepare(`DELETE FROM events_log WHERE type NOT LIKE 'audit.%' AND created_at < datetime('now', ?)`).run(`-${RETAIN_DAYS} days`);
  const r3 = db.prepare(`DELETE FROM events_log WHERE type LIKE 'audit.%' AND created_at < datetime('now', ?)`).run(`-${AUDIT_RETAIN_DAYS} days`);
  const deleted = r1.changes + r2.changes + r3.changes;
  if (deleted > 0) console.log(`[events-retention] pruned ${deleted} rows`);
  return { deleted };
}

export function startEventsRetention(db: Database.Database, hour = 5) {
  let lastDay = '';
  setInterval(() => {
    try {
      const now = new Date();
      const day = now.toDateString();
      const hh = String(now.getHours()).padStart(2, '0');
      if (Number(hh) === hour && day !== lastDay) {
        lastDay = day;
        pruneEventsLog(db);
      }
    } catch (e) { console.warn('[events-retention] failed:', e); }
  }, 60 * 60_000).unref();
}

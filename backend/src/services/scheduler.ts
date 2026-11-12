import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from '../database.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 定时切换空间引擎：消费 spaces.switch_rule
// 规则格式: {"mode":"manual"} 或 {"mode":"schedule","items":[{"time":"09:00","spaceId":1},{"time":"22:00","spaceId":2}]}

export function startScheduler(db, getCurrentSpaceId, onSwitch) {
  let lastFired = '';
  setInterval(() => {
    try {
      const spaces = db.prepare('SELECT id, name, switch_rule FROM spaces').all();
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      for (const s of spaces) {
        let rule;
        try { rule = JSON.parse(s.switch_rule || '{}'); } catch { continue; }
        if (rule.mode !== 'schedule' || !Array.isArray(rule.items)) continue;
        for (const item of rule.items) {
          if (item.time === hhmm && item.spaceId) {
            const key = `${hhmm}-${item.spaceId}`;
            if (key === lastFired) continue; // 同一分钟不重复触发
            lastFired = key;
            onSwitch(item.spaceId, s.id);
            db.prepare("INSERT INTO events_log (type, payload_json) VALUES ('schedule.trigger', ?)")
              .run(JSON.stringify({ ruleSpaceId: s.id, targetSpaceId: item.spaceId, time: hhmm }));
          }
        }
      }
    } catch (e) {
      console.error('[scheduler]', e.message);
    }
  }, 30 * 1000); // 每 30 秒检查
}

  // 每周死链巡检（周一 09:00-09:30 窗口内触发一次）
  setInterval(async () => {
    try {
      const now = new Date();
      if (now.getDay() !== 1) return;
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      if (hhmm < '09:00' || hhmm > '09:30') return;
      const flag = path.join(DATA_DIR, '.linkcheck-week');
      const week = `${now.getFullYear()}-${now.getMonth() + 1}-${Math.ceil(now.getDate() / 7)}`;
      let last = '';
      try { last = fs.readFileSync(flag, 'utf8').trim(); } catch {}
      if (last === week) return;
      fs.writeFileSync(flag, week);
      const { execFileSync } = await import('node:child_process');
      execFileSync(process.execPath, [path.join(__dirname, '../tools/linkcheck.mjs')], { timeout: 120000 });
      console.log('[scheduler] weekly linkcheck done');
    } catch (e: any) { console.error('[scheduler/linkcheck]', e.message); }
  }, 5 * 60 * 1000);

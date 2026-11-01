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

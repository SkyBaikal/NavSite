// 自动备份引擎：每天定时把全量数据导出为 JSON 落盘 data/backups/
// 保留策略：默认保留最近 14 份，超量清理最旧
// 备份内容与 /api/admin/export 完全一致（逃生舱格式），可直接用于导入恢复
import fs from 'node:fs';
import path from 'node:path';

export function createBackup(db, dataDir) {
  const dump = {
    exported_at: new Date().toISOString(),
    kind: 'auto-backup',
    categories: db.prepare('SELECT * FROM categories').all(),
    links: db.prepare('SELECT * FROM links').all(),
    spaces: db.prepare('SELECT * FROM spaces').all(),
    widgets: db.prepare('SELECT * FROM widgets').all(),
    settings: db.prepare('SELECT * FROM settings').all(),
  };
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir, `backup-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(dump, null, 2));
  return file;
}

export function pruneBackups(dataDir, keep = 14) {
  const dir = path.join(dataDir, 'backups');
  if (!fs.existsSync(dir)) return { removed: 0 };
  const files = fs.readdirSync(dir).filter(f => f.startsWith('backup-') && f.endsWith('.json')).sort();
  const excess = files.slice(0, Math.max(0, files.length - keep));
  for (const f of excess) fs.unlinkSync(path.join(dir, f));
  return { removed: excess.length, kept: files.length - excess.length };
}

export function listBackups(dataDir) {
  const dir = path.join(dataDir, 'backups');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
    .sort().reverse()
    .map(f => {
      const st = fs.statSync(path.join(dir, f));
      return { file: f, size: st.size, created_at: st.mtime.toISOString() };
    });
}

export function startBackupScheduler(db, dataDir, hour = 4, minute = 0) {
  let lastDay = '';
  setInterval(() => {
    try {
      const now = new Date();
      const day = now.toDateString();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const target = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      if (hhmm === target && day !== lastDay) {
        lastDay = day;
        const file = createBackup(db, dataDir);
        const { removed } = pruneBackups(dataDir);
        db.prepare("INSERT INTO events_log (type, payload_json) VALUES ('backup.created', ?)")
          .run(JSON.stringify({ file, removed }));
        console.log(`[backup] created ${file} (pruned ${removed})`);
      }
    } catch (e) {
      console.error('[backup]', e.message);
    }
  }, 30 * 1000);
}

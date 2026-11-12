#!/usr/bin/env node
// 全站快照：DB(checkpoint 后单文件) + uploads/icons/previews + data 版本，打包 tar.gz
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const DATA = process.env.NAV_DATA_DIR || path.resolve(process.cwd(), '../data');
const OUT = path.join(DATA, 'snapshots');
fs.mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '');
// WAL checkpoint（单文件一致性）
const db = (await import('better-sqlite3')).default(path.join(DATA, 'nav.db'));
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
const file = path.join(OUT, `navsite-snapshot-${stamp}.tar.gz`);
const entries = ['nav.db', 'uploads', 'icons', 'previews'].filter(e => fs.existsSync(path.join(DATA, e)));
execSync(`tar -czf ${file} -C ${DATA} ${entries.join(' ')}`);
const size = (fs.statSync(file).size / 1024 / 1024).toFixed(2);
console.log(`snapshot: ${file} (${size} MB)`);
// 滚动保留 14 份
const snaps = fs.readdirSync(OUT).filter(f => f.startsWith('navsite-snapshot-')).sort();
while (snaps.length > 14) { const old = snaps.shift(); fs.unlinkSync(path.join(OUT, old)); console.log('pruned', old); }

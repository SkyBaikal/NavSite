#!/usr/bin/env node
// 死链巡检：检查 links 表全部书签 HTTP 状态，输出报告到 data/linkcheck-latest.json
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
const DATA = process.env.NAV_DATA_DIR || path.resolve(process.cwd(), '../data');
const db = new Database(path.join(DATA, 'nav.db'), { readonly: true });
const links = db.prepare('SELECT l.id, l.title, l.url FROM links l WHERE l.is_visible = 1').all();
const results = [];
for (const l of links) {
  let status = 0, ok = false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(l.url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'NavSite-LinkCheck/1.0' } });
    clearTimeout(t);
    status = r.status;
    ok = r.status < 400;
  } catch { ok = false; }
  results.push({ id: l.id, title: l.title, url: l.url, status, ok });
  console.log(ok ? '✓' : '✗', status || 'ERR', l.title);
}
const dead = results.filter(r => !r.ok);
fs.writeFileSync(path.join(DATA, 'linkcheck-latest.json'), JSON.stringify({ at: new Date().toISOString(), total: results.length, dead }, null, 2));
console.log(`\n${results.length - dead.length}/${results.length} ok, ${dead.length} dead → data/linkcheck-latest.json`);

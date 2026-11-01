import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../database.js';

export const faviconRouter = express.Router();

const ICON_DIR = path.join(DATA_DIR, 'icons');
fs.mkdirSync(ICON_DIR, { recursive: true });

// 内网地址黑名单（防 SSRF）
const BLOCKED = [
  /^localhost$/i, /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, /^0\./, /^\[::1\]$/, /\.local$/i, /^metadata\./i,
];

export function assertPublicHost(host) {
  if (!host || typeof host !== 'string' || host.length > 200) throw new Error('bad host');
  const h = host.toLowerCase();
  for (const re of BLOCKED) if (re.test(h)) throw new Error('blocked host');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) throw new Error('bad host format');
  return h;
}

async function fetchIcon(host) {
  // 依次尝试：favicon.ico → Google 不用（CDN）→ 直接抓首页解析 <link rel>
  const urls = [
    `https://${host}/favicon.ico`,
    `https://www.${host}/favicon.ico`,
  ];
  for (const u of urls) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      const res = await fetch(u, { signal: ctl.signal, redirect: 'follow' });
      clearTimeout(timer);
      if (!res.ok) continue;
      const type = res.headers.get('content-type') || '';
      if (!type.startsWith('image/')) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > 512 * 1024) continue;
      return { buf, type };
    } catch { /* try next */ }
  }
  // 抓首页解析 icon link
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    const res = await fetch(`https://${host}`, { signal: ctl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const html = (await res.text()).slice(0, 100_000);
      const m = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i);
      if (m) {
        const href = m[0].match(/href=["']([^"']+)["']/i)?.[1];
        if (href) {
          const iconUrl = href.startsWith('http') ? href : new URL(href, `https://${host}`).href;
          const res2 = await fetch(iconUrl, { signal: AbortSignal.timeout(5000) });
          if (res2.ok) {
            const type = res2.headers.get('content-type') || 'image/png';
            const buf = Buffer.from(await res2.arrayBuffer());
            if (buf.length > 0 && buf.length <= 512 * 1024) return { buf, type };
          }
        }
      }
    }
  } catch { /* give up */ }
  return null;
}

// GET /api/favicon?host=xxx  → 图片（本地缓存）
faviconRouter.get('/favicon', async (req, res) => {
  try {
    const host = assertPublicHost(String(req.query.host || ''));
    const safeName = crypto.createHash('sha256').update(host).digest('hex').slice(0, 24);
    const metaPath = path.join(ICON_DIR, `${safeName}.meta`);
    const iconPath = path.join(ICON_DIR, `${safeName}.img`);

    // 缓存有效期 7 天
    let serve = () => {
      const type = fs.readFileSync(metaPath, 'utf-8');
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'public, max-age=604800');
      res.send(fs.readFileSync(iconPath));
    };

    if (fs.existsSync(iconPath) && fs.existsSync(metaPath)) {
      const age = Date.now() - fs.statSync(iconPath).mtimeMs;
      if (age < 7 * 24 * 3600 * 1000) return serve();
    }

    const got = await fetchIcon(host);
    if (got) {
      fs.writeFileSync(iconPath, got.buf);
      fs.writeFileSync(metaPath, got.type);
      return serve();
    }
    res.status(404).end();
  } catch (e) {
    res.status(400).json({ code: 'INVALID', message: e.message });
  }
});

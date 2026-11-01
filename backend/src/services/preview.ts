// 站点预览服务：抓取页面 og:image / title，图片走本地缓存（零 CDN 直连）
// GET /api/preview?url=  → { title, description, image: /api/image?u=... }
// 缓存 meta 24h，图片缓存 7 天（与 favicon 一致）

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../database.js';
import { assertPublicHost } from './favicon.js';

export const previewRouter = Router();

const IMG_DIR = path.join(DATA_DIR, 'previews');
fs.mkdirSync(IMG_DIR, { recursive: true });

const metaCache = new Map<string, { at: number; data: any }>();
const META_TTL = 24 * 3600_000;
const IMG_TTL = 7 * 24 * 3600_000;

async function fetchText(url: string, limit = 300_000): Promise<string> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NavSiteBot/1.0)' },
    });
    const reader = res.body!.getReader();
    let text = '';
    while (text.length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value, { stream: true });
    }
    return text;
  } finally {
    clearTimeout(t);
  }
}

function extractMeta(html: string) {
  const unescape = (s: string) => s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'");
  const pick = (re: RegExp) => unescape(html.match(re)?.[1]?.trim() || '');
  return {
    title: pick(/<meta[^>]+property=["']og:site_title["'][^>]+content=["']([^"']+)/i)
        || pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)
        || pick(/<title[^>]*>([^<]+)<\/title>/i).slice(0, 120),
    description: pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i)
        || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i),
    image: pick(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)/i),
  };
}

previewRouter.get('/preview', async (req, res) => {
  const raw = String(req.query.url || '');
  let u: URL;
  try { u = new URL(raw.startsWith('http') ? raw : 'https://' + raw); } catch { return res.status(400).json({ code: 'INVALID' }); }
  try { assertPublicHost(u.hostname); } catch (e: any) { return res.status(403).json({ code: 'FORBIDDEN', message: e.message }); }

  const key = u.origin;
  const hit = metaCache.get(key);
  if (hit && Date.now() - hit.at < META_TTL) return res.json({ code: 'OK', data: hit.data });
  try {
    const meta = extractMeta(await fetchText(u.toString()));
    const data = { ...meta, image: meta.image ? `/api/image?u=${encodeURIComponent(new URL(meta.image, u).toString())}` : null };
    metaCache.set(key, { at: Date.now(), data });
    res.json({ code: 'OK', data });
  } catch {
    res.json({ code: 'OK', data: { title: u.hostname, description: '', image: null } });
  }
});

// 图片代理 + 磁盘缓存
previewRouter.get('/image', async (req, res) => {
  const raw = String(req.query.u || '');
  let u: URL;
  try { u = new URL(raw); } catch { return res.status(400).json({ code: 'INVALID' }); }
  try { assertPublicHost(u.hostname); } catch (e: any) { return res.status(403).json({ code: 'FORBIDDEN', message: e.message }); }
  const file = path.join(IMG_DIR, Buffer.from(u.toString()).toString('base64url').slice(0, 80) + '.img');
  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < IMG_TTL) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return fs.createReadStream(file).pipe(res);
  }
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 10000);
    const r = await fetch(u.toString(), { signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(t);
    if (!r.ok) throw new Error('upstream ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 5_000_000) throw new Error('too large');
    fs.writeFileSync(file, buf);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch (e: any) {
    res.status(502).json({ code: 'UPSTREAM', message: e.message });
  }
});

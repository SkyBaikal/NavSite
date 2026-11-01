import { Router } from 'express';
import { assertPublicHost } from './favicon.js';

export const metaRouter = Router();

// GET /api/fetch-title?url=...  抓取网页 <title>
metaRouter.get('/fetch-title', async (req, res) => {
  try {
    const u = String(req.query.url || '');
    const parsed = new URL(u);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅支持 http/https');
    assertPublicHost(parsed.hostname);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(u, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NavSiteBot/1.0)' } });
    clearTimeout(timer);
    if (!r.ok) throw new Error('目标返回 ' + r.status);
    const html = (await r.text()).slice(0, 100_000);
    const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    res.json({ code: 'OK', data: { title: m ? m[1].trim().slice(0, 100) : '' } });
  } catch (e) {
    res.json({ code: 'FAIL', message: e.message, data: { title: '' } });
  }
});

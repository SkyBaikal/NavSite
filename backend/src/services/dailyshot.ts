// 每日一图：代理 Bing 壁纸 API，图片落盘缓存（data/previews/）
// GET /api/dailyshot → { url: /api/image?u=..., title, copyright }
// 图片本身就是本地代理 URL，前端零外联

import { Router } from 'express';
import { trackedFetch } from './upstream.js';

export const dailyshotRouter = Router();

interface Shot { url: string; title: string; copyright: string }
let cache: { at: number; data: Shot } | null = null;
const TTL = 6 * 3600_000; // 6小时（Bing 每日更新，留点余量）

dailyshotRouter.get('/dailyshot', async (_req, res) => {
  if (cache && Date.now() - cache.at < TTL) return res.json({ code: 'OK', data: cache.data });
  try {
    const r = await trackedFetch('bing', 'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error('upstream ' + r.status);
    const j: any = await r.json();
    const img = j.images?.[0];
    if (!img?.url) throw new Error('no image');
    const full = img.url.startsWith('http') ? img.url : 'https://www.bing.com' + img.url;
    const data: Shot = {
      url: '/api/image?u=' + encodeURIComponent(full),
      title: img.title || '',
      copyright: (img.copyright || '').replace(/\s*\(.*?\)\s*$/, ''),
    };
    cache = { at: Date.now(), data };
    res.json({ code: 'OK', data });
  } catch (e: any) {
    if (cache) return res.json({ code: 'OK', data: cache.data });
    res.status(502).json({ code: 'UPSTREAM', message: e.message });
  }
});

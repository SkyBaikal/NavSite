// RSS 抓取服务：GET /api/rss?u=<feed url>
// 内存缓存 30 分钟，XML 用正则解析（零依赖），SSRF 防护复用 assertPublicHost

import { Router } from 'express';
import { trackedFetch } from './upstream.js';
import { assertPublicHost } from './favicon.js';

export const rssRouter = Router();

interface FeedItem { title: string; link: string; date: string }
const cache = new Map<string, { at: number; items: FeedItem[] }>();
const TTL = 30 * 60_000;

function unescape(s: string) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/<!\[CDATA\[|\]\]>/g, '');
}
function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? unescape(m[1]).trim() : '';
}

rssRouter.get('/rss', async (req, res) => {
  const raw = String(req.query.u || '');
  let u: URL;
  try { u = new URL(raw.startsWith('http') ? raw : 'https://' + raw); } catch { return res.status(400).json({ code: 'INVALID' }); }
  try { assertPublicHost(u.hostname); } catch (e: any) { return res.status(403).json({ code: 'FORBIDDEN', message: e.message }); }

  const hit = cache.get(u.toString());
  if (hit && Date.now() - hit.at < TTL) return res.json({ code: 'OK', data: hit.items });

  try {
    const r = await trackedFetch('rss:' + u.hostname, u.toString(), { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NavSiteBot/1.0)' } });
    if (!r.ok) throw new Error('upstream ' + r.status);
    const xml = await r.text();
    // RSS <item> 或 Atom <entry>
    const blocks = xml.match(/<(item|entry)[\s\S]*?<\/\1>/gi) || [];
    const items: FeedItem[] = blocks.slice(0, 20).map(b => ({
      title: tag(b, 'title') || '(无标题)',
      link: tag(b, 'link').replace(/^https?:\/\/\S+[\s\S]*$/, m => m.match(/^https?:\/\/\S+/)![0]) || (b.match(/<link[^>]*href=["']([^"']+)/i)?.[1] ?? ''),
      date: tag(b, 'pubDate') || tag(b, 'updated') || tag(b, 'published'),
    })).filter(i => i.title && i.link);
    cache.set(u.toString(), { at: Date.now(), items });
    res.json({ code: 'OK', data: items });
  } catch (e: any) {
    // 失败时回退过期缓存
    if (hit) return res.json({ code: 'OK', data: hit.items });
    res.status(502).json({ code: 'UPSTREAM', message: e.message });
  }
});

// 天气代理：GET /api/weather?city=<name>
// 走 wttr.in JSON 格式，内存缓存 30 分钟，SSRF 无关（固定上游域名）

import { Router } from 'express';
import { trackedFetch } from './upstream.js';

export const weatherRouter = Router();

interface Weather { city: string; temp: number; feels: number; desc: string; icon: string; humidity: number; }
const cache = new Map<string, { at: number; data: Weather | null }>();
const TTL = 30 * 60_000;

const ICONS: Record<string, string> = {
  '113': '☀️', '116': '⛅', '119': '☁️', '122': '☁️', '143': '🌫️',
  '176': '🌦️', '179': '🌨️', '182': '🌧️', '185': '🌧️',
  '200': '⛈️', '227': '🌨️', '230': '❄️', '248': '🌫️', '260': '🌫️',
  '263': '🌦️', '266': '🌦️', '281': '🌧️', '284': '🌧️',
  '293': '🌦️', '296': '🌦️', '299': '🌧️', '302': '🌧️', '305': '🌧️', '308': '🌧️',
  '320': '🌨️', '323': '🌨️', '326': '🌨️', '329': '❄️', '332': '❄️', '335': '❄️', '338': '❄️',
  '350': '🌧️', '353': '🌦️', '356': '🌧️', '359': '🌧️', '362': '🌨️', '365': '🌨️', '368': '🌨️', '371': '❄️',
  '374': '🌧️', '377': '🌧️', '386': '⛈️', '389': '⛈️', '392': '⛈️', '395': '❄️',
};

weatherRouter.get('/weather', async (req, res) => {
  const city = String(req.query.city || 'Beijing').slice(0, 60);
  const hit = cache.get(city);
  if (hit && Date.now() - hit.at < TTL) return res.json({ code: 'OK', data: hit.data });
  try {
    const r = await trackedFetch('wttr.in', `https://wttr.in/${encodeURIComponent(city)}?format=j1`, { headers: { 'User-Agent': 'curl/8.0' } });
    if (!r.ok) throw new Error('upstream ' + r.status);
    const j: any = await r.json();
    const cur = j.current_condition?.[0];
    if (!cur) throw new Error('no data');
    const data: Weather = {
      city: j.nearest_area?.[0]?.areaName?.[0]?.value || city,
      temp: +cur.temp_C, feels: +cur.FeelsLikeC,
      desc: cur.lang_zh?.[0]?.value || cur.weatherDesc?.[0]?.value || '',
      icon: ICONS[cur.weatherCode] || '🌡️',
      humidity: +cur.humidity,
    };
    cache.set(city, { at: Date.now(), data });
    res.json({ code: 'OK', data });
  } catch (e: any) {
    if (hit?.data) return res.json({ code: 'OK', data: hit.data });
    res.status(502).json({ code: 'UPSTREAM', message: e.message });
  }
});

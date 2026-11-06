import { Router, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../database.js';
import { requireAdmin } from './admin.js';

export const uploadRouter = Router();

const EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};
const MAGIC: Record<string, number[]> = {
  'image/jpeg': [0xFF, 0xD8, 0xFF],
  'image/png': [0x89, 0x50, 0x4E, 0x47],
  'image/gif': [0x47, 0x49, 0x46],
};
const MAX = 5 * 1024 * 1024; // 5MB

uploadRouter.post('/upload', requireAdmin, (req: Request, res: Response) => {
  const ctype = String(req.headers['content-type'] || '').split(';')[0].trim();
  if (!EXT[ctype]) return res.status(400).json({ code: 'BAD_TYPE', message: '仅支持 jpg/png/webp/gif/avif' });
  const chunks: Buffer[] = [];
  let size = 0;
  let aborted = false;
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > MAX) { aborted = true; try { res.status(400).json({ code: 'TOO_LARGE', message: '超过 5MB 限制' }); } catch {} req.destroy(); return; }
    chunks.push(c);
  });
  req.on('error', () => { if (!res.headersSent) res.status(400).json({ code: 'ABORTED', message: '上传中断或超过 5MB' }); });
  req.on('end', () => {
    if (aborted) return;
    const buf = Buffer.concat(chunks);
    // 魔数校验（jpeg/png/gif），webp/avif 由扩展名信任
    const magic = MAGIC[ctype];
    if (magic && !magic.every((b, i) => buf[i] === b)) return res.status(400).json({ code: 'BAD_FILE', message: '文件内容与图片类型不符' });
    fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
    const name = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + crypto.randomBytes(5).toString('hex') + EXT[ctype];
    fs.writeFileSync(path.join(DATA_DIR, 'uploads', name), buf);
    res.json({ code: 'OK', data: { url: '/uploads/' + name } });
  });
});

import crypto from 'node:crypto';

// ---- SVG 验证码（零依赖）----
// token = HMAC(secret, answer|window)；5 分钟窗口 + 单次使用黑名单 + 服务端校验。
// 前端只拿到扭曲 SVG，答案永不落地客户端。

const usedTokens = new Set<string>();
const MAX_USED = 500;
function markUsed(t: string) {
  if (usedTokens.size >= MAX_USED) {
    const first = usedTokens.values().next().value;
    if (first) usedTokens.delete(first);
  }
  usedTokens.add(t);
}
function isUsed(t: string) { return usedTokens.has(t); }

function hmac(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

let cachedSecret = '';
export function initCaptchaSecret(secret: string) { cachedSecret = secret; }

export interface CaptchaChallenge { svg: string; token: string; }

export function generateCaptcha(secret: string): CaptchaChallenge {
  const answer = String(crypto.randomInt(1000, 10000));
  const windowId = Math.floor(Date.now() / (5 * 60 * 1000));
  const token = hmac(secret || cachedSecret, `captcha:${answer}:${windowId}`);
  const chars = answer.split('');
  const W = 120, H = 44;
  // 每字符随机 位置/旋转/大小
  let glyphs = '';
  let x = 12;
  for (const ch of chars) {
    const y = 28 + crypto.randomInt(-4, 5);
    const rot = crypto.randomInt(-28, 29);
    const fs = 20 + crypto.randomInt(0, 8);
    glyphs += `<text x="${x}" y="${y}" transform="rotate(${rot} ${x} ${y})" font-size="${fs}" font-family="Georgia,serif" font-weight="700" fill="hsl(${crypto.randomInt(160, 200)},70%,65%)">${ch}</text>`;
    x += 25 + crypto.randomInt(-3, 4);
  }
  // 干扰线 + 噪点
  let noise = '';
  for (let i = 0; i < 4; i++) {
    noise += `<path d="M${crypto.randomInt(0, W)} ${crypto.randomInt(0, H)} Q ${crypto.randomInt(0, W)} ${crypto.randomInt(0, H)} ${crypto.randomInt(0, W)} ${crypto.randomInt(0, H)}" stroke="hsl(${crypto.randomInt(150, 220)},50%,45%)" stroke-width="1" fill="none" opacity="0.55"/>`;
  }
  for (let i = 0; i < 26; i++) {
    noise += `<circle cx="${crypto.randomInt(0, W)}" cy="${crypto.randomInt(0, H)}" r="${(crypto.randomInt(5, 20) / 10).toFixed(1)}" fill="hsl(${crypto.randomInt(150, 230)},45%,50%)" opacity="0.4"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" rx="8" fill="rgba(8,12,20,.6)"/>${noise}${glyphs}</svg>`;
  return { svg, token };
}

export function verifyCaptcha(secret: string, token: string, answer: string): boolean {
  if (!token || !answer) return false;
  const t = String(token);
  if (isUsed(t)) return false;
  const nowWin = Math.floor(Date.now() / (5 * 60 * 1000));
  // 当前窗 + 上一窗（边界宽容 5 分钟）
  const a = String(answer).trim();
  const expectNow = hmac(secret || cachedSecret, `captcha:${a}:${nowWin}`);
  const expectPrev = hmac(secret || cachedSecret, `captcha:${a}:${nowWin - 1}`);
  // 常量时间比较防时序侧信道
  const safeEq = (x: string, y: string) => x.length === y.length && crypto.timingSafeEqual(Buffer.from(x), Buffer.from(y));
  if (!safeEq(expectNow, t) && !safeEq(expectPrev, t)) return false;
  return true;
}
// 登录最终成功时作废 token（防重放）；TOTP_REQUIRED 中间态不作废
export function consumeCaptcha(token: string) { if (token) markUsed(token); }

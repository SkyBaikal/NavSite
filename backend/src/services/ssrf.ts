// SSRF 防护：统一的外呼 URL 校验（内网黑名单 + 协议白名单）
// favicon/rss/weather/webhook 全部走这里

const BLOCKED_HOST = [
  /^localhost$/i, /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, /^0\./, /^\[::1\]$/, /^\[::\]$/, /\.local$/i, /^metadata\./i,
  /^host\.docker\.internal$/i, /^gateway\.docker\.internal$/i,
];

export function isSafeExternalUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname;
  if (BLOCKED_HOST.some(re => re.test(host))) return false;
  // 纯数字/IPv6 ULA 补充
  if (/^(fe80:|fc|fd)/i.test(host)) return false;
  return true;
}

export function assertSafeExternalUrl(raw: string): void {
  if (!isSafeExternalUrl(raw)) throw new Error(`不安全的外呼地址: ${raw}`);
}

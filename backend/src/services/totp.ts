// TOTP (RFC 6238) 零依赖实现
import crypto from 'crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function genSecret(len = 20): string {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (const b of bytes) out += B32[b % 32];
  return out;
}

function b32decode(s: string): Buffer {
  let bits = '';
  for (const c of s.toUpperCase().replace(/=+$/, '')) {
    const idx = B32.indexOf(c);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totpCode(secret: string, timeStep = Math.floor(Date.now() / 30000)): string {
  const key = b32decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(timeStep / 2 ** 32), 0);
  buf.writeUInt32BE(timeStep % 2 ** 32, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[off] & 0x7f) << 24 | hmac[off+1] << 16 | hmac[off+2] << 8 | hmac[off+3]) % 1_000_000;
  return String(code).padStart(6, '0');
}

/** 校验：允许前后各 1 个时间窗（±30s 时钟漂移） */
export function verifyTotp(secret: string, code: string): boolean {
  const now = Math.floor(Date.now() / 30000);
  const c = String(code || '').trim();
  for (const w of [now - 1, now, now + 1]) if (totpCode(secret, w) === c) return true;
  return false;
}

/** otpauth:// URI 供手机验证器扫码/手输 */
export function otpauthUri(secret: string, account: string): string {
  return `otpauth://totp/NavSite:${encodeURIComponent(account)}?secret=${secret}&issuer=NavSite&algorithm=SHA1&digits=6&period=30`;
}

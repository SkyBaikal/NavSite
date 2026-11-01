// 外部依赖健康监控：每次外呼成功/失败记录时间戳
// GET /api/health/upstream → { wttr: {ok, lastOkAt}, bing: {...}, ... }
// widget 拿到 stale 数据时可显示"离线数据 @时间"角标

type Entry = { ok: boolean; lastOkAt: number; lastTryAt: number; lastError?: string };
const registry = new Map<string, Entry>();

export function upstreamTry(name: string): void {
  const e = registry.get(name) || { ok: false, lastOkAt: 0, lastTryAt: 0 };
  e.lastTryAt = Date.now();
  registry.set(name, e);
}
export function upstreamOk(name: string): void {
  const e = registry.get(name)!;
  e.ok = true;
  e.lastOkAt = Date.now();
  e.lastError = undefined;
}
export function upstreamFail(name: string, err: string): void {
  const e = registry.get(name)!;
  e.ok = false;
  e.lastError = String(err).slice(0, 200);
}

export function upstreamReport(): Record<string, Entry> {
  return Object.fromEntries(registry.entries());
}

// 包装 fetch：自动记录健康状态
export async function trackedFetch(name: string, url: string, init?: RequestInit, timeoutMs = 10000): Promise<Response> {
  upstreamTry(name);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: init?.signal ?? ac.signal });
    if (r.ok) upstreamOk(name); else upstreamFail(name, 'HTTP ' + r.status);
    return r;
  } catch (e: any) {
    upstreamFail(name, e.message);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

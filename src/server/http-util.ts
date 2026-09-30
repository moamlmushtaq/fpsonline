// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — small HTTP helpers shared by the server modules: JSON
// responses, bounded JSON body parsing, client IP resolution behind proxies and
// a sliding-window rate limiter. Node only; no framework.
// ─────────────────────────────────────────────────────────────────────────────

import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';

/** Maximum accepted JSON request body. */
export const JSON_BODY_LIMIT = 32 * 1024;

export type LogFn = (...a: unknown[]) => void;

/** An error that maps directly onto an HTTP response. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** Sends a JSON response (never cached). HEAD requests get headers only. */
export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | number> = {}): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(res.req?.method === 'HEAD' ? undefined : data);
}

/** Sends a short plain-text response. */
export function sendText(res: ServerResponse, status: number, text: string, headers: Record<string, string | number> = {}): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(res.req?.method === 'HEAD' ? undefined : text);
}

/**
 * Reads and parses a JSON body of at most `limit` bytes.
 * Throws HttpError 415 (wrong content type), 413 (too large) or 400 (malformed).
 */
export function readJsonBody(req: IncomingMessage, limit = JSON_BODY_LIMIT): Promise<unknown> {
  const type = String(req.headers['content-type'] ?? '').toLowerCase();
  if (!/^application\/json\s*(;|$)/.test(type)) return Promise.reject(new HttpError(415, 'unsupported_media_type'));
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) return Promise.reject(new HttpError(413, 'payload_too_large'));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const fail = (err: HttpError) => {
      if (done) return;
      done = true;
      req.removeListener('data', onData);
      // Stop buffering; the handler answers with `Connection: close` and Node drops the rest.
      req.pause();
      reject(err);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) return fail(new HttpError(413, 'payload_too_large'));
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.on('error', () => fail(new HttpError(400, 'bad_request')));
    req.on('aborted', () => fail(new HttpError(400, 'aborted')));
    req.on('end', () => {
      if (done) return;
      done = true;
      const text = Buffer.concat(chunks, size).toString('utf8');
      try {
        resolve(text.length ? JSON.parse(text) : null);
      } catch {
        reject(new HttpError(400, 'invalid_json'));
      }
    });
  });
}

function normalizeIp(addr: string): string {
  // IPv4-mapped IPv6 → plain IPv4 so the same client is one key.
  return addr.startsWith('::ffff:') ? addr.slice(7) : addr;
}

/** Headers set by hosting edges (Fly proxy, Cloudflare in front of Render) to the real client address. */
const CLIENT_IP_HEADERS = ['fly-client-ip', 'cf-connecting-ip', 'true-client-ip'] as const;

export interface ProxyTrust {
  /** Honor proxy headers at all (only enable behind a proxy you control / a PaaS edge). */
  trust: boolean;
  /**
   * Strict mode: the number of proxies in front of the server; the client IP is the
   * X-Forwarded-For entry that many hops from the right. 0 = platform mode (below).
   */
  hops?: number;
}

/**
 * The client's IP, used only for per-IP fairness limits (connection caps, login
 * rate limit) — never for authentication.
 *  • trust off: the socket address.
 *  • strict (hops ≥ 1): X-Forwarded-For[len - hops] — spoof-proof for a known proxy chain.
 *  • platform (hops 0): the edge's client-IP header (Fly-Client-IP, CF-Connecting-IP,
 *    True-Client-IP), else the left-most X-Forwarded-For entry. This favors identifying
 *    end users over spoof resistance: attributing every player to one edge IP would lock
 *    players out, whereas a spoofed header only lets one abuser dodge a per-IP limit
 *    (global limits still hold).
 */
export function clientIp(req: IncomingMessage, proxy: ProxyTrust): string {
  const socketIp = normalizeIp(req.socket.remoteAddress ?? 'unknown');
  if (!proxy.trust) return socketIp;
  const xffRaw = req.headers['x-forwarded-for'];
  const xff = (Array.isArray(xffRaw) ? xffRaw.join(',') : (xffRaw ?? ''))
    .split(',')
    .map((s) => s.trim())
    .filter((s) => isIP(s) !== 0);
  const hops = Math.max(0, Math.floor(proxy.hops ?? 0));
  if (hops > 0) return xff.length ? normalizeIp(xff[Math.max(0, xff.length - hops)]) : socketIp;
  for (const h of CLIENT_IP_HEADERS) {
    const v = req.headers[h];
    if (typeof v === 'string' && isIP(v.trim()) !== 0) return normalizeIp(v.trim());
  }
  return xff.length ? normalizeIp(xff[0]) : socketIp;
}

/**
 * Sliding-window limiter: at most `limit` hits per `windowMs` per key.
 * Memory is bounded: stale keys are pruned periodically and the key count is capped.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private calls = 0;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 50_000,
  ) {}

  /** Records an attempt. Returns 0 when allowed, else the ms until the next attempt would be allowed. */
  hit(key: string): number {
    const now = this.now();
    if (++this.calls % 256 === 0 || this.hits.size > this.maxKeys) this.prune(now);
    let list = this.hits.get(key);
    if (!list) {
      list = [];
      this.hits.set(key, list);
    }
    while (list.length && now - list[0] >= this.windowMs) list.shift();
    if (list.length >= this.limit) return Math.max(1, this.windowMs - (now - list[0]));
    list.push(now);
    return 0;
  }

  prune(now = this.now()): void {
    for (const [k, list] of this.hits) {
      if (!list.length || now - list[list.length - 1] >= this.windowMs) this.hits.delete(k);
    }
    // Pathological key churn (e.g. a spoofing flood): drop the oldest keys.
    if (this.hits.size > this.maxKeys) {
      let excess = this.hits.size - this.maxKeys;
      for (const k of this.hits.keys()) {
        if (excess-- <= 0) break;
        this.hits.delete(k);
      }
    }
  }

  get size(): number {
    return this.hits.size;
  }
}

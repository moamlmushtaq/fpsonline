// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — REST API under /api (see src/shared/protocol.ts):
//   GET  /api/status                         → { online, version, rooms, protocol }  (CORS: *)
//   POST /api/register { name, password, profile? } → AuthResponse
//   POST /api/login    { name, password }           → AuthResponse
//   GET  /api/profile  (Bearer)                     → { ok, profile }
//   PUT  /api/profile  (Bearer) { profile }         → { ok, profile }   (server-side merge)
//   POST /api/logout   (Bearer)                     → { ok }
//
// Status codes: 400 invalid input, 401 bad credentials / token, 409 name taken,
// 413 body > 32 KB, 415 non-JSON body, 429 rate limited (Retry-After header;
// body { ok:false, error:'server' }), 503 password hashing saturated.
// Only /api/status is CORS-enabled; everything else is same-origin.
// ─────────────────────────────────────────────────────────────────────────────

import type { IncomingMessage, ServerResponse } from 'node:http';
import { GAME_VERSION, PROTOCOL_VERSION } from '../shared/constants';
import type { AuthResponse } from '../shared/protocol';
import { TOKEN_RE, type AccountStore, type AuthResult } from './accounts';
import { clientIp, HttpError, readJsonBody, sendJson, type LogFn, type ProxyTrust, type RateLimiter } from './http-util';

export interface ApiContext {
  /** Live counters for /api/status. */
  status(): { online: number; rooms: number };
  accounts: AccountStore;
  /** Per-IP limiter shared by /api/register and /api/login. */
  authLimiter: RateLimiter;
  proxy: ProxyTrust;
  log: LogFn;
}

const CORS_STATUS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function authStatus(r: AuthResult): number {
  if (r.ok) return 200;
  switch (r.error) {
    case 'invalid':
      return 400;
    case 'bad_credentials':
      return 401;
    case 'name_taken':
      return 409;
    default:
      return 503;
  }
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return null;
  const m = /^Bearer\s+([0-9a-f]{64})\s*$/i.exec(h);
  const token = m ? m[1].toLowerCase() : null;
  return token && TOKEN_RE.test(token) ? token : null;
}

function field(body: unknown, key: string): unknown {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>)[key] : undefined;
}

function methodNotAllowed(res: ServerResponse, allow: string): void {
  sendJson(res, 405, { ok: false, error: 'method_not_allowed' }, { Allow: allow });
}

const UNAUTHORIZED: AuthResponse = { ok: false, error: 'bad_credentials' };

/** Handles every request whose path starts with /api/. Always responds. */
export async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string, ctx: ApiContext): Promise<void> {
  const method = req.method ?? 'GET';
  try {
    switch (pathname) {
      case '/api/status': {
        if (method === 'OPTIONS') {
          res.writeHead(204, CORS_STATUS);
          res.end();
          return;
        }
        if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(res, 'GET, HEAD, OPTIONS');
        const s = ctx.status();
        sendJson(res, 200, { online: s.online, version: GAME_VERSION, rooms: s.rooms, protocol: PROTOCOL_VERSION }, CORS_STATUS);
        return;
      }

      case '/api/register':
      case '/api/login': {
        if (method !== 'POST') return methodNotAllowed(res, 'POST');
        const wait = ctx.authLimiter.hit(clientIp(req, ctx.proxy));
        if (wait > 0) {
          sendJson(res, 429, { ok: false, error: 'server' } satisfies AuthResponse, { 'Retry-After': Math.ceil(wait / 1000) });
          return;
        }
        const body = await readJsonBody(req);
        const result =
          pathname === '/api/register'
            ? await ctx.accounts.register(field(body, 'name'), field(body, 'password'), field(body, 'profile'))
            : await ctx.accounts.login(field(body, 'name'), field(body, 'password'));
        const out: AuthResponse = result.ok ? { ok: true, token: result.token, profile: result.profile } : { ok: false, error: result.error };
        sendJson(res, authStatus(result), out);
        return;
      }

      case '/api/profile': {
        if (method !== 'GET' && method !== 'HEAD' && method !== 'PUT') return methodNotAllowed(res, 'GET, HEAD, PUT');
        const token = bearer(req);
        if (!token) return sendJson(res, 401, UNAUTHORIZED);
        if (method === 'PUT') {
          const body = await readJsonBody(req);
          const incoming = field(body, 'profile');
          if (!incoming || typeof incoming !== 'object') return sendJson(res, 400, { ok: false, error: 'invalid' } satisfies AuthResponse);
          const profile = ctx.accounts.putProfile(token, incoming);
          if (!profile) return sendJson(res, 401, UNAUTHORIZED);
          sendJson(res, 200, { ok: true, profile });
          return;
        }
        const profile = ctx.accounts.getProfile(token);
        if (!profile) return sendJson(res, 401, UNAUTHORIZED);
        sendJson(res, 200, { ok: true, profile });
        return;
      }

      case '/api/logout': {
        if (method !== 'POST') return methodNotAllowed(res, 'POST');
        const token = bearer(req);
        if (!token || !ctx.accounts.logout(token)) return sendJson(res, 401, UNAUTHORIZED);
        sendJson(res, 200, { ok: true });
        return;
      }

      default:
        sendJson(res, 404, { ok: false, error: 'not_found' });
        return;
    }
  } catch (err) {
    if (err instanceof HttpError) {
      // Unread request bodies (413) must not be parsed as the next request.
      sendJson(res, err.status, { ok: false, error: err.status === 400 ? 'invalid' : err.code }, err.status === 413 ? { Connection: 'close' } : {});
      return;
    }
    ctx.log('api error', pathname, err);
    sendJson(res, 500, { ok: false, error: 'server' } satisfies AuthResponse);
  }
}

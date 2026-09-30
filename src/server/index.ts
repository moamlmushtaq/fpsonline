// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Node game server entry.
//
// One HTTP server on $PORT (default 8080, host 0.0.0.0) that provides:
//   /ws          WebSocket endpoint → HostCore (the same host that runs in the
//                browser worker for offline play), driven by HostLoop at 60 Hz
//   /api/*       status + optional accounts (see api.ts / accounts.ts)
//   /healthz     'ok' for platform health checks
//   everything   production: static dist/client (static.ts)
//   else         dev (--dev): Vite dev middleware with HMR on the same server
//
// `startServer(opts)` is exported for tests and embedding; the module only
// auto-starts (reading env + argv, installing signal handlers) when it is the
// process entry point (`node dist/server/index.js`, `tsx src/server/index.ts`).
//
// Env: PORT, HOST, DATA_DIR (default ./data), CLIENT_DIR (default ./dist/client),
//      TRUST_PROXY=1 (client IP from edge headers / X-Forwarded-For; auto on Render/Fly),
//      PROXY_HOPS=N (strict: trust exactly N proxies in X-Forwarded-For),
//      MAX_ROOMS (default 64), MAX_CONNECTIONS (default 1000), MAX_CONN_PER_IP (16).
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import type { ViteDevServer } from 'vite';
import { GAME_VERSION, PROTOCOL_VERSION } from '../shared/constants';
import { HostCore } from '../shared/host/host-core';
import { getMap } from '../shared/maps/index';
import { NavGraph } from '../shared/sim/nav';
import { worldForMap } from '../shared/sim/game';
import { PVP_MAP_IDS } from '../shared/types';
import { AccountStore } from './accounts';
import { handleApi, type ApiContext } from './api';
import { RateLimiter, sendText, type LogFn, type ProxyTrust } from './http-util';
import { HostLoop } from './loop';
import { StaticServer } from './static';
import { WS_PATH, WsGateway } from './ws';

export interface ServerOptions {
  /** 0 = random free port. Default: $PORT or 8080. */
  port?: number;
  /** Bind address. Default: $HOST or 0.0.0.0. */
  host?: string;
  /** Vite dev middleware + HMR instead of static files. */
  dev?: boolean;
  /** Directory for accounts.json. Default: $DATA_DIR or ./data. */
  dataDir?: string;
  /** Built client directory. Default: $CLIENT_DIR, ./dist/client, or ../client next to the bundle. */
  clientDir?: string;
  /** Trust proxy headers for the client IP. Default: $TRUST_PROXY, or auto on Render / Fly. */
  trustProxy?: boolean;
  /** Strict proxy hop count (see http-util clientIp). Default: $PROXY_HOPS or 0 (platform mode). */
  proxyHops?: number;
  maxRooms?: number;
  maxConnections?: number;
  maxPerIp?: number;
  /** Login/register attempts per IP per minute (default 10). */
  authRateLimit?: number;
  /** Logger; false = silent. Default: console.log with a prefix. */
  log?: LogFn | false;
  /** Build collision worlds + nav graphs for every map before listening (default true). */
  prewarm?: boolean;
  /** Precompress static files in the background after listening (default true in production). */
  warmStatic?: boolean;
}

export interface RunningServer {
  readonly port: number;
  /** http://localhost:<port> */
  readonly url: string;
  readonly http: http.Server;
  readonly host: HostCore;
  readonly accounts: AccountStore;
  readonly gateway: WsGateway;
  readonly loop: HostLoop;
  /** Resolved client dir (production) or null (dev / not built). */
  readonly clientDir: string | null;
  /** Stops accepting, closes sockets, stops the loop, flushes accounts. Idempotent. */
  close(): Promise<void>;
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

function envInt(name: string): number | undefined {
  const v = process.env[name];
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : undefined;
}

function envFlag(name: string): boolean | undefined {
  const v = process.env[name];
  if (v === undefined || v === '') return undefined;
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';
}

/** First candidate directory that contains an index.html. */
function resolveClientDir(explicit: string | undefined): string | null {
  const candidates = explicit
    ? [explicit]
    : [process.env.CLIENT_DIR, path.resolve(process.cwd(), 'dist/client'), path.resolve(MODULE_DIR, '../client')].filter(
        (c): c is string => !!c,
      );
  for (const c of candidates) {
    const abs = path.resolve(c);
    if (existsSync(path.join(abs, 'index.html'))) return abs;
  }
  return null;
}

/** Builds every map's collision world and nav graph once (~150 ms each) so the first match doesn't hitch. */
function prewarmMaps(log: LogFn): void {
  const t0 = performance.now();
  for (const id of PVP_MAP_IDS) {
    const map = getMap(id);
    NavGraph.build(worldForMap(map), map);
  }
  worldForMap(getMap('range'));
  log(`maps ready in ${Math.round(performance.now() - t0)} ms`);
}

function splitUrl(raw: string | undefined): string {
  const url = raw ?? '/';
  const q = url.indexOf('?');
  const p = q >= 0 ? url.slice(0, q) : url;
  const h = p.indexOf('#');
  return h >= 0 ? p.slice(0, h) : p;
}

const NOT_BUILT_HTML = `<!doctype html><meta charset="utf-8"><title>HALCYON FRONT</title>
<body style="font:16px system-ui;background:#1b1917;color:#f3ece0;display:grid;place-items:center;height:100vh;margin:0">
<div><h1 style="font-weight:500">HALCYON FRONT server is running</h1><p>The client has not been built. Run <code>npm run build</code> (or <code>npm run dev</code>).</p></div>`;

export async function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const log: LogFn = opts.log === false ? () => {} : (opts.log ?? ((...a: unknown[]) => console.log('[halcyon]', ...a)));
  const dev = opts.dev ?? false;
  const port = opts.port ?? envInt('PORT') ?? 8080;
  const bindHost = opts.host ?? process.env.HOST ?? '0.0.0.0';
  const dataDir = path.resolve(opts.dataDir ?? process.env.DATA_DIR ?? path.join(process.cwd(), 'data'));
  const trustProxy = opts.trustProxy ?? envFlag('TRUST_PROXY') ?? !!(process.env.RENDER || process.env.FLY_APP_NAME);
  const proxy: ProxyTrust = { trust: trustProxy, hops: opts.proxyHops ?? envInt('PROXY_HOPS') ?? 0 };

  if (opts.prewarm !== false) prewarmMaps(log);

  const accounts = await AccountStore.open({ dataDir, log });
  const host = new HostCore({
    kind: 'online',
    accounts: accounts.hooks(),
    log,
    maxRooms: opts.maxRooms ?? envInt('MAX_ROOMS') ?? 64,
    seed: randomBytes(4).readUInt32LE(0),
  });

  let lastStallLog = -Infinity;
  const loop = new HostLoop(host, {
    onError: (err) => log('host update error', err),
    onStall: (lostMs) => {
      const now = performance.now();
      if (now - lastStallLog > 60_000) {
        lastStallLog = now;
        log(`event loop stalled; dropped ${Math.round(lostMs)} ms of simulation`);
      }
    },
  });

  const gateway = new WsGateway({
    host,
    proxy,
    maxConnections: opts.maxConnections ?? envInt('MAX_CONNECTIONS') ?? 1000,
    maxPerIp: opts.maxPerIp ?? envInt('MAX_CONN_PER_IP') ?? 16,
    log,
    onActivity: () => loop.wake(),
  });

  const apiCtx: ApiContext = {
    status: () => ({ online: host.onlineCount, rooms: host.roomCount }),
    accounts,
    authLimiter: new RateLimiter(opts.authRateLimit ?? 10, 60_000),
    proxy,
    log,
  };

  const clientDir = dev ? null : resolveClientDir(opts.clientDir);
  const statics = clientDir ? new StaticServer({ root: clientDir, log }) : null;
  let vite: ViteDevServer | null = null;

  const server = http.createServer();
  // Longer than typical proxy idle timeouts (Render/Fly ~60 s) to avoid 502s on reused connections.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 30_000;

  server.on('request', (req, res) => {
    const pathname = splitUrl(req.url);
    const fail = (err: unknown) => {
      log('request error', req.method, pathname, err);
      if (!res.headersSent) sendText(res, 500, 'Internal Server Error');
      else res.destroy();
    };
    try {
      if (pathname === '/healthz') {
        sendText(res, 200, 'ok');
        return;
      }
      if (pathname === '/api' || pathname.startsWith('/api/')) {
        handleApi(req, res, pathname, apiCtx).catch(fail);
        return;
      }
      if (vite) {
        vite.middlewares(req, res, () => sendText(res, 404, 'Not Found'));
        return;
      }
      if (statics) {
        statics.serve(req, res, pathname).catch(fail);
        return;
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : NOT_BUILT_HTML);
      } else sendText(res, 404, 'Not Found');
    } catch (err) {
      fail(err);
    }
  });

  server.on('upgrade', (req, socket, head) => {
    if (splitUrl(req.url) === WS_PATH) {
      gateway.handleUpgrade(req, socket, head);
      return;
    }
    // Dev: Vite's HMR socket shares this server and has its own 'upgrade' listener.
    const proto = String(req.headers['sec-websocket-protocol'] ?? '');
    if (vite && /vite-(hmr|ping)/.test(proto)) return;
    socket.destroy();
  });

  server.on('clientError', (err: NodeJS.ErrnoException, socket) => {
    if (err.code === 'ECONNRESET' || !socket.writable) {
      socket.destroy();
      return;
    }
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });

  if (dev) {
    // Dynamic import: vite is a dev dependency and external to the production bundle.
    const { createServer } = await import('vite');
    vite = await createServer({
      root: process.cwd(),
      appType: 'spa',
      server: { middlewareMode: true, hmr: { server } },
    });
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      server.once('error', onError);
      server.listen(port, bindHost, () => {
        server.off('error', onError);
        resolve();
      });
    });
  } catch (err) {
    // e.g. EADDRINUSE: release everything created so far before reporting.
    await gateway.close();
    await vite?.close().catch(() => {});
    await accounts.close();
    throw err;
  }
  server.on('error', (err) => log('http server error', err));

  loop.start();
  const actualPort = (server.address() as AddressInfo).port;

  log(`HALCYON FRONT v${GAME_VERSION} (protocol ${PROTOCOL_VERSION}) — ${dev ? 'development (Vite middleware + HMR)' : 'production'}`);
  log(`listening on http://${bindHost}:${actualPort}  ·  WebSocket ${WS_PATH}${dev ? `  ·  open http://localhost:${actualPort}` : ''}`);
  if (!dev) log(clientDir ? `client: ${clientDir}` : 'client: NOT BUILT (run `npm run build`) — serving API + WebSocket only');
  log(`accounts: ${accounts.file} (${accounts.size})${accounts.isPersistent ? '' : ' — IN MEMORY ONLY'}${trustProxy ? `  ·  client IPs from proxy headers (${proxy.hops ? `${proxy.hops} hop(s)` : 'platform mode'})` : ''}`);

  if (statics && opts.warmStatic !== false) {
    statics
      .warm()
      .then((n) => n && log(`precompressed ${n} static file(s)`))
      .catch((err) => log('static warm-up failed', err));
  }

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      server.close();
      server.closeIdleConnections();
      await gateway.close();
      loop.stop();
      await vite?.close().catch((err: unknown) => log('vite close failed', err));
      server.closeAllConnections();
      await accounts.close();
    })();
    return closing;
  };

  return {
    port: actualPort,
    url: `http://localhost:${actualPort}`,
    http: server,
    host,
    accounts,
    gateway,
    loop,
    clientDir,
    close,
  };
}

/** True when this module is the process entry point (not when imported by tests). */
function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const log: LogFn = (...a) => console.log('[halcyon]', ...a);
  let server: RunningServer;
  try {
    server = await startServer({ dev: process.argv.includes('--dev'), log });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    console.error('[halcyon] failed to start:', e.code === 'EADDRINUSE' ? `port already in use (${e.message})` : err);
    process.exit(1);
  }

  let stopping = false;
  const shutdown = (reason: string, code: number) => {
    if (stopping) {
      // Second Ctrl-C: don't make the developer wait.
      process.exit(code || 1);
    }
    stopping = true;
    log(`${reason} — shutting down`);
    setTimeout(() => {
      console.error('[halcyon] shutdown timed out, forcing exit');
      process.exit(1);
    }, 8000).unref();
    server.close().then(
      () => process.exit(code),
      (err) => {
        console.error('[halcyon] shutdown error', err);
        process.exit(1);
      },
    );
  };
  process.on('SIGTERM', () => shutdown('SIGTERM', 0));
  process.on('SIGINT', () => shutdown('SIGINT', 0));
  process.on('unhandledRejection', (err) => log('unhandled rejection', err));
  process.on('uncaughtException', (err) => {
    console.error('[halcyon] uncaught exception', err);
    // State may be inconsistent: persist accounts and let the platform restart us.
    shutdown('uncaught exception', 1);
  });
}

if (isMain()) void main();

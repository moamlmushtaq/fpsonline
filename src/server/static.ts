// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — production static file server for dist/client.
//
//  • Correct MIME types (incl. .wasm, .webmanifest, .woff2), nosniff.
//  • Weak ETag + Last-Modified with 304 revalidation.
//  • Cache policy: hashed Vite output under /assets/ is immutable for a year;
//    everything else (index.html, public/ files) is `no-cache` (revalidate).
//  • Brotli / gzip negotiated from Accept-Encoding; compressed buffers are
//    produced once (async, off the event loop) and cached in memory.
//  • SPA fallback: unknown extension-less / HTML-accepting paths get index.html.
//    Missing /assets/* files are a real 404 (never HTML for a script request).
//  • Path traversal safe: '..' segments rejected, resolved path (and its real
//    path, defeating symlinks) must stay inside the root, dotfiles hidden.
// ─────────────────────────────────────────────────────────────────────────────

import { createReadStream, promises as fsp, type Stats } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { sendText, type LogFn } from './http-util';

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

export const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
};

const COMPRESSIBLE_EXT = new Set([
  '.html', '.htm', '.js', '.mjs', '.cjs', '.css', '.json', '.map', '.webmanifest', '.xml', '.txt', '.svg', '.wasm', '.ico', '.ttf', '.otf', '.gltf',
]);

/** Files smaller than this are sent uncompressed (headers would eat the gain). */
const MIN_COMPRESS_BYTES = 1024;
/** Files larger than this are streamed from disk, uncached and uncompressed. */
const MAX_CACHED_FILE = 8 * 1024 * 1024;

export const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
export const CACHE_REVALIDATE = 'no-cache';

type Encoding = 'br' | 'gzip';

interface CachedFile {
  abs: string;
  size: number;
  mtimeMs: number;
  etag: string;
  lastModified: string;
  type: string;
  compressible: boolean;
  body: Buffer;
  enc: Partial<Record<Encoding, Promise<Buffer | null>>>;
}

export interface StaticServerOptions {
  /** Directory containing index.html + assets (e.g. dist/client). */
  root: string;
  log?: LogFn;
  /** Upper bound for cached bodies + compressed variants (default 96 MB). */
  maxCacheBytes?: number;
}

/** Picks the best supported encoding from an Accept-Encoding header (honors q=0). */
export function negotiateEncoding(header: string | string[] | undefined): Encoding | null {
  if (!header) return null;
  const raw = Array.isArray(header) ? header.join(',') : header;
  const q: Record<string, number> = {};
  for (const part of raw.split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (!name) continue;
    let weight = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(p);
      if (m) weight = Number(m[1]);
    }
    q[name] = Number.isFinite(weight) ? weight : 0;
  }
  const star = q['*'];
  const w = (n: string) => q[n] ?? (star !== undefined ? star : 0);
  if (w('br') > 0) return 'br';
  if (w('gzip') > 0) return 'gzip';
  return null;
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  const bare = etag.replace(/^W\//, '');
  return header.split(',').some((t) => t.trim().replace(/^W\//, '') === bare);
}

export class StaticServer {
  readonly root: string;
  private readonly log: LogFn;
  private readonly maxCacheBytes: number;
  private readonly cache = new Map<string, CachedFile>();
  private cacheBytes = 0;
  private realRoot: string | null = null;

  constructor(opts: StaticServerOptions) {
    this.root = path.resolve(opts.root);
    this.log = opts.log ?? (() => {});
    this.maxCacheBytes = opts.maxCacheBytes ?? 96 * 1024 * 1024;
  }

  /** Serves a GET/HEAD for `pathname` (already stripped of the query). Always responds. */
  async serve(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
      return;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      sendText(res, 400, 'Bad Request');
      return;
    }
    // Traversal / smuggling guards: NUL, backslashes and '..' segments are never legitimate.
    if (!decoded.startsWith('/') || decoded.includes('\0') || decoded.includes('\\')) {
      sendText(res, 400, 'Bad Request');
      return;
    }
    const segments = decoded.split('/');
    if (segments.some((s) => s === '..')) {
      sendText(res, 400, 'Bad Request');
      return;
    }
    const hidden = segments.some((s) => s.startsWith('.') && s !== '.well-known' && s !== '.' && s !== '');
    if (!hidden) {
      const rel = decoded.endsWith('/') ? `${decoded}index.html` : decoded;
      const file = await this.lookup(rel);
      if (file) return this.send(req, res, file, decoded.startsWith('/assets/') ? CACHE_IMMUTABLE : CACHE_REVALIDATE);
    }
    // Not found: real 404 for asset-like requests, SPA fallback for navigations.
    const last = segments[segments.length - 1] ?? '';
    const hasExt = /\.[A-Za-z0-9]{1,12}$/.test(last);
    const acceptsHtml = String(req.headers.accept ?? '').includes('text/html');
    if (hidden || decoded.startsWith('/assets/') || (hasExt && !acceptsHtml)) {
      sendText(res, 404, 'Not Found');
      return;
    }
    const index = await this.lookup('/index.html');
    if (!index) {
      sendText(res, 404, 'Not Found');
      return;
    }
    // Vite builds with base './', so a nested fallback URL (/room/ABCDE) would resolve
    // './assets/…' against /room/. A <base href="/"> keeps relative URLs rooted.
    const nested = decoded.lastIndexOf('/') > 0;
    return this.send(req, res, nested ? await this.withBase(index) : index, CACHE_REVALIDATE);
  }

  /** Precompresses every compressible file under the root (background warm-up). */
  async warm(maxFiles = 2000): Promise<number> {
    let n = 0;
    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (n >= maxFiles || e.name.startsWith('.')) continue;
        const childRel = `${rel}/${e.name}`;
        if (e.isDirectory()) await walk(path.join(dir, e.name), childRel);
        else if (e.isFile() && COMPRESSIBLE_EXT.has(path.extname(e.name).toLowerCase())) {
          const f = await this.lookup(childRel);
          if (f && f.size >= MIN_COMPRESS_BYTES) {
            n++;
            await Promise.all([this.encoded(f, 'br'), this.encoded(f, 'gzip')]);
          }
        }
      }
    };
    await walk(this.root, '');
    return n;
  }

  /** Resolves a root-relative path to a cached regular file inside the root, or null. */
  private async lookup(rel: string): Promise<CachedFile | null> {
    const abs = path.join(this.root, rel);
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) return null;
    let st: Stats;
    try {
      st = await fsp.stat(abs);
    } catch {
      return null;
    }
    if (st.isDirectory()) return this.lookup(path.posix.join(rel, 'index.html'));
    if (!st.isFile()) return null;
    const hit = this.cache.get(abs);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
    if (hit) this.evict(hit);
    // Symlinks must not escape the root.
    try {
      this.realRoot ??= await fsp.realpath(this.root);
      const real = await fsp.realpath(abs);
      if (real !== this.realRoot && !real.startsWith(this.realRoot + path.sep)) return null;
    } catch {
      return null;
    }
    const ext = path.extname(abs).toLowerCase();
    const base: Omit<CachedFile, 'body'> = {
      abs,
      size: st.size,
      mtimeMs: st.mtimeMs,
      etag: `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`,
      lastModified: st.mtime.toUTCString(),
      type: MIME_TYPES[ext] ?? 'application/octet-stream',
      compressible: COMPRESSIBLE_EXT.has(ext),
      enc: {},
    };
    if (st.size > MAX_CACHED_FILE) return { ...base, body: Buffer.alloc(0), size: st.size };
    let body: Buffer;
    try {
      body = await fsp.readFile(abs);
    } catch {
      return null;
    }
    const entry: CachedFile = { ...base, body, size: body.length };
    this.remember(entry);
    return entry;
  }

  private remember(f: CachedFile): void {
    if (this.cacheBytes + f.size > this.maxCacheBytes) {
      // Rare (a huge client build): start over rather than track LRU order.
      this.cache.clear();
      this.cacheBytes = 0;
    }
    this.cache.set(f.abs, f);
    this.cacheBytes += f.size;
  }

  private evict(f: CachedFile): void {
    if (this.cache.get(f.abs) === f) {
      this.cache.delete(f.abs);
      this.cacheBytes -= f.size;
    }
  }

  /** Compressed variant (cached promise; null if not worth it). */
  private encoded(f: CachedFile, enc: Encoding): Promise<Buffer | null> {
    if (!f.compressible || f.size < MIN_COMPRESS_BYTES || f.body.length !== f.size) return Promise.resolve(null);
    let p = f.enc[enc];
    if (!p) {
      const work =
        enc === 'br'
          ? brotli(f.body, {
              params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
                [zlib.constants.BROTLI_PARAM_SIZE_HINT]: f.size,
                [zlib.constants.BROTLI_PARAM_MODE]: f.type.startsWith('font/') ? zlib.constants.BROTLI_MODE_FONT : zlib.constants.BROTLI_MODE_TEXT,
              },
            })
          : gzip(f.body, { level: 9 });
      p = work.then(
        (buf) => {
          if (buf.length >= f.size) return null;
          this.cacheBytes += buf.length;
          return buf;
        },
        (err) => {
          this.log('compression failed', f.abs, err);
          return null;
        },
      );
      f.enc[enc] = p;
    }
    return p;
  }

  /** index.html with <base href="/"> injected (cached per index version). */
  private readonly baseCache = new WeakMap<CachedFile, CachedFile>();
  private async withBase(index: CachedFile): Promise<CachedFile> {
    const cached = this.baseCache.get(index);
    if (cached) return cached;
    const html = index.body.toString('utf8');
    if (/<base\s/i.test(html) || !/<head[^>]*>/i.test(html)) return index;
    const body = Buffer.from(html.replace(/<head([^>]*)>/i, '<head$1><base href="/">'), 'utf8');
    const variant: CachedFile = { ...index, body, size: body.length, etag: index.etag.replace(/"$/, '-b"'), enc: {} };
    this.baseCache.set(index, variant);
    return variant;
  }

  private async send(req: IncomingMessage, res: ServerResponse, f: CachedFile, cacheControl: string): Promise<void> {
    const headers: Record<string, string | number> = {
      'Content-Type': f.type,
      'Cache-Control': cacheControl,
      ETag: f.etag,
      'Last-Modified': f.lastModified,
      'X-Content-Type-Options': 'nosniff',
    };
    if (f.compressible) headers.Vary = 'Accept-Encoding';

    const inm = req.headers['if-none-match'];
    const ims = req.headers['if-modified-since'];
    const notModified = inm !== undefined ? etagMatches(inm, f.etag) : ims !== undefined && Math.floor(f.mtimeMs / 1000) * 1000 <= Date.parse(ims);
    if (notModified) {
      delete headers['Content-Type'];
      res.writeHead(304, headers);
      res.end();
      return;
    }

    // Too large to cache: stream it as-is.
    if (f.body.length !== f.size) {
      headers['Content-Length'] = f.size;
      res.writeHead(200, headers);
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = createReadStream(f.abs);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
      return;
    }

    let body = f.body;
    const enc = f.compressible ? negotiateEncoding(req.headers['accept-encoding']) : null;
    if (enc) {
      const c = await this.encoded(f, enc);
      if (c) {
        body = c;
        headers['Content-Encoding'] = enc;
      }
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  }
}

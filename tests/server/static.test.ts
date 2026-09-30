// Production static serving of a temp dist/client: MIME types, cache headers,
// ETag revalidation, brotli/gzip, SPA fallback, and path-traversal defenses.
// Uses raw http.request so paths reach the server exactly as written.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../../src/server/index';
import { negotiateEncoding } from '../../src/server/static';

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

let srv: RunningServer;
let tmp: string;
const JS = `export const halcyon = ${JSON.stringify('front '.repeat(800))};\n`;
const INDEX = '<!doctype html><html><head><meta charset="utf-8"><title>HF</title></head><body><div id="app">INDEX-MARKER</div><script type="module" src="./assets/index-AbC123xy.js"></script></body></html>';
const SECRET = 'TOP-SECRET-CONTENT';

function request(pathname: string, headers: Record<string, string> = {}, method = 'GET'): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.port, path: pathname, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'hf-static-'));
  const dist = path.join(tmp, 'dist');
  mkdirSync(path.join(dist, 'assets'), { recursive: true });
  mkdirSync(path.join(dist, 'docs'), { recursive: true });
  writeFileSync(path.join(dist, 'index.html'), INDEX);
  writeFileSync(path.join(dist, 'assets', 'index-AbC123xy.js'), JS);
  writeFileSync(path.join(dist, 'assets', 'font-Zz9.woff2'), Buffer.alloc(3000, 7));
  writeFileSync(path.join(dist, 'assets', 'sim-Qq1.wasm'), Buffer.alloc(2048, 1));
  writeFileSync(path.join(dist, 'manifest.webmanifest'), JSON.stringify({ name: 'HALCYON FRONT' }));
  writeFileSync(path.join(dist, 'docs', 'index.html'), '<!doctype html><title>docs</title>');
  writeFileSync(path.join(dist, '.env'), SECRET);
  writeFileSync(path.join(tmp, 'secret.txt'), SECRET);
  symlinkSync(path.join(tmp, 'secret.txt'), path.join(dist, 'link.txt'));
  srv = await startServer({ port: 0, host: '127.0.0.1', dev: false, dataDir: path.join(tmp, 'data'), clientDir: dist, log: false, prewarm: false });
});

afterAll(async () => {
  await srv?.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('static file serving', () => {
  it('serves index.html with no-cache and validators', async () => {
    const r = await request('/');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(r.headers['cache-control']).toBe('no-cache');
    expect(r.headers.etag).toBeTruthy();
    expect(r.headers['last-modified']).toBeTruthy();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.body.toString()).toContain('INDEX-MARKER');
    expect((await request('/index.html')).body.toString()).toContain('INDEX-MARKER');
    expect((await request('/?room=ABCDE')).body.toString()).toContain('INDEX-MARKER');
    expect((await request('/docs/')).body.toString()).toContain('<title>docs</title>');
  });

  it('serves hashed assets as immutable with correct MIME types', async () => {
    const r = await request('/assets/index-AbC123xy.js');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(r.body.toString()).toBe(JS);
    expect(r.headers['content-encoding']).toBeUndefined();
    expect((await request('/assets/font-Zz9.woff2')).headers['content-type']).toBe('font/woff2');
    expect((await request('/assets/sim-Qq1.wasm')).headers['content-type']).toBe('application/wasm');
    const mf = await request('/manifest.webmanifest');
    expect(mf.headers['content-type']).toBe('application/manifest+json; charset=utf-8');
    expect(mf.headers['cache-control']).toBe('no-cache');
  });

  it('compresses with brotli or gzip per Accept-Encoding', async () => {
    const br = await request('/assets/index-AbC123xy.js', { 'Accept-Encoding': 'gzip, deflate, br' });
    expect(br.headers['content-encoding']).toBe('br');
    expect(br.headers.vary).toBe('Accept-Encoding');
    expect(br.body.length).toBeLessThan(JS.length / 4);
    expect(zlib.brotliDecompressSync(br.body).toString()).toBe(JS);
    const gz = await request('/assets/index-AbC123xy.js', { 'Accept-Encoding': 'gzip' });
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(zlib.gunzipSync(gz.body).toString()).toBe(JS);
    const noBr = await request('/assets/index-AbC123xy.js', { 'Accept-Encoding': 'br;q=0, gzip' });
    expect(noBr.headers['content-encoding']).toBe('gzip');
    // Already-compressed formats are never re-encoded.
    expect((await request('/assets/font-Zz9.woff2', { 'Accept-Encoding': 'br' })).headers['content-encoding']).toBeUndefined();
    expect(negotiateEncoding('identity')).toBeNull();
    expect(negotiateEncoding('*')).toBe('br');
  });

  it('answers conditional requests with 304', async () => {
    const first = await request('/assets/index-AbC123xy.js');
    const etag = String(first.headers.etag);
    const again = await request('/assets/index-AbC123xy.js', { 'If-None-Match': etag });
    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);
    expect(again.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const ims = await request('/', { 'If-Modified-Since': String(first.headers['last-modified']) });
    expect(ims.status).toBe(304);
    expect((await request('/', { 'If-None-Match': '"something-else"' })).status).toBe(200);
  });

  it('falls back to index.html for app routes, 404 for missing files', async () => {
    const r = await request('/play/room/ABCDE', { Accept: 'text/html,application/xhtml+xml' });
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-cache');
    // Relative asset URLs (Vite base './') stay rooted on nested fallback routes.
    expect(r.body.toString()).toContain('<head><base href="/">');
    const flat = await request('/lobby');
    expect(flat.status).toBe(200);
    expect(flat.body.toString()).toContain('INDEX-MARKER');
    expect((await request('/assets/missing-123.js')).status).toBe(404);
    expect((await request('/missing.js')).status).toBe(404);
  });

  it('blocks path traversal, dotfiles and symlink escapes', async () => {
    const attempts = [
      '/../secret.txt',
      '/assets/../../secret.txt',
      '/%2e%2e/secret.txt',
      '/assets/..%2f..%2fsecret.txt',
      '/..%5csecret.txt',
      '/%2e%2e%2f%2e%2e%2fsecret.txt',
      '/foo/%00/index.html',
      '/.env',
      '/link.txt',
      '/%E0%A4%A',
    ];
    for (const p of attempts) {
      const r = await request(p, { Accept: '*/*' });
      expect(r.status, p).not.toBe(200);
      expect(r.body.toString(), p).not.toContain(SECRET);
    }
  });

  it('handles HEAD, rejects other methods, and keeps /healthz + /api routes separate', async () => {
    const head = await request('/', {}, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    expect(Number(head.headers['content-length'])).toBeGreaterThan(0);
    expect((await request('/', {}, 'POST')).status).toBe(405);
    const hz = await request('/healthz');
    expect(hz.status).toBe(200);
    expect(hz.body.toString()).toBe('ok');
    const api = await request('/api/unknown', { Accept: 'text/html' });
    expect(api.status).toBe(404);
    expect(api.headers['content-type']).toContain('application/json');
  });
});

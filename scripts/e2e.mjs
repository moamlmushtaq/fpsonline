#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — end-to-end smoke tests (npm run e2e; run `npm run build` first).
//
// Boots the production server (dist/server/index.js) on a free port with a
// throw-away DATA_DIR, drives Playwright's Chromium (SwiftShader WebGL) through
// the ?debug=1 hooks (window.__HF) and fails (exit 1) on page errors, console
// errors or failed assertions. Screenshots → artifacts/e2e/.
//
// Scenarios:
//   a  menu loads < 15 s without errors
//   b  offline-style bot match (TDM / Gantry / recruit): reaches 'live', moves
//      + fires; position changes, ammo drops, snapshots flow; leave → menu
//   c  online quick play with two pages → same room within ~8 s; each renders
//      the other; a 12 s main-thread stall does not drop the connection
//   d  phone landscape 844×390 with touch: touch controls in match, no
//      horizontal overflow
//   e  Arabic (?lang=ar): <html dir="rtl">, menu screenshot
//   f  training range: target hits register; leave → results → menu
//   g  repeated matches: GPU memory (geometries/textures) does not grow
//   h  Launch Control finale: force-end a bot match → rocket outro → results →
//      menu → a second match starts cleanly
// Flags: --quick (a, b, f only), --only=a,c,…, --headed, --keep (keep server log).
// Software rendering is slow: small viewports and the Low preset throughout.
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'artifacts', 'e2e');
/** Build to test (default ./dist; E2E_DIST lets CI or engineers point at another build). */
const DIST = process.env.E2E_DIST ? path.resolve(process.env.E2E_DIST) : path.join(ROOT, 'dist');
/** Extra URL query for every page, e.g. E2E_QUERY='&wsThread=main&hostThread=main' to test the fallbacks. */
const EXTRA_QUERY = process.env.E2E_QUERY || '';
const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const HEADED = args.includes('--headed');
const onlyArg = args.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;
const ALL = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const SELECTED = ALL.filter((s) => (ONLY ? ONLY.has(s) : QUICK ? ['a', 'b', 'f'].includes(s) : true));
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
/** Console noise that is not a product error. */
const BENIGN = [/AudioContext was not allowed to start/i, /GPU stall due to ReadPixels/i, /THREE\.Material: parameter/i, /speechSynthesis/i, /Automatic fallback to software WebGL/i];

const t0 = Date.now();
const log = (...a) => console.log(`[e2e ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// ── Server ──────────────────────────────────────────────────────────────────

async function startServer() {
  const entry = path.join(DIST, 'server', 'index.js');
  if (!existsSync(entry) || !existsSync(path.join(DIST, 'client', 'index.html'))) {
    console.error('dist/ is missing — run `npm run build` first.');
    process.exit(2);
  }
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), 'halcyon-e2e-'));
  const proc = spawn(process.execPath, [entry], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, CLIENT_DIR: path.join(DIST, 'client'), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (d) => (out += d));
  proc.stderr.on('data', (d) => (out += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${base}/api/status`);
      if (r.ok) return { proc, base, dataDir, output: () => out };
    } catch {
      /* not up yet */
    }
    if (proc.exitCode !== null) break;
    await sleep(150);
  }
  console.error(out);
  throw new Error('server did not start');
}

// ── Browser helpers ─────────────────────────────────────────────────────────

const failures = [];
function check(cond, msg) {
  if (!cond) {
    failures.push(msg);
    log(`  ✗ ${msg}`);
  } else log(`  ✓ ${msg}`);
  return !!cond;
}

async function openPage(browser, base, { query = '', viewport = { width: 800, height: 450 }, touch = false, label = 'page', renderScale = 1 } = {}) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    hasTouch: touch,
    isMobile: touch,
    userAgent: touch ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' : undefined,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (BENIGN.some((re) => re.test(text))) return;
    errors.push(`[${label} console.error] ${text}`);
  });
  page.on('pageerror', (e) => errors.push(`[${label} pageerror] ${e.message}`));
  const t = Date.now();
  await page.goto(`${base}/?debug=1${query}${EXTRA_QUERY}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!window.__HF && window.__HF.state().screen === 'menu', null, { timeout: 60000, polling: 200 });
  const loadMs = Date.now() - t;
  await page.evaluate((rs) => window.__HF.app.settings.update({ quality: 'low', renderScale: rs }), renderScale);
  // Let server discovery settle (≤ 2.5 s probe).
  await page.waitForFunction(() => window.__HF.app.net.status !== 'connecting', null, { timeout: 8000, polling: 100 }).catch(() => undefined);
  return { ctx, page, errors, loadMs };
}

const state = (page) => page.evaluate(() => window.__HF.state());

async function waitState(page, pred, timeout, label) {
  const end = Date.now() + timeout;
  let last = null;
  while (Date.now() < end) {
    last = await state(page);
    if (pred(last)) return last;
    await sleep(400);
  }
  throw new Error(`timeout waiting for ${label} (last: ${JSON.stringify(last && { screen: last.screen, phase: last.phase, camera: last.camera, ready: last.ready, remotes: last.remotes, roster: last.roster, you: last.you })})`);
}

async function shot(page, name) {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

/** Leaves the running match without the confirm dialog and waits for a menu-ish screen. */
async function leaveMatch(page, want = ['menu', 'results']) {
  await page.evaluate(() => window.__HF.app.match?.leave());
  return waitState(page, (s) => !s.inMatch && want.includes(s.screen), 30000, `leave → ${want.join('/')}`);
}

function reportErrors(p, name) {
  check(p.errors.length === 0, `${name}: no page/console errors${p.errors.length ? `\n      ${p.errors.slice(0, 6).join('\n      ')}` : ''}`);
}

// ── Scenarios ───────────────────────────────────────────────────────────────

async function scenarioA(browser, base) {
  log('a) menu');
  const p = await openPage(browser, base, { label: 'a' });
  const budget = Number(process.env.E2E_MENU_BUDGET_MS || 15000);
  check(p.loadMs < budget, `menu ready in ${p.loadMs} ms (< ${budget / 1000} s)`);
  await sleep(600);
  await shot(p.page, 'a-menu');
  const net = await p.page.evaluate(() => window.__HF.app.net.status);
  check(net === 'online', `server discovered (net status: ${net})`);
  reportErrors(p, 'a');
  await p.ctx.close();
}

async function scenarioB(browser, base) {
  log('b) bot match (TDM / Gantry / recruit)');
  const p = await openPage(browser, base, { label: 'b', viewport: { width: 720, height: 405 } });
  const { page } = p;
  await page.evaluate(() => window.__HF.botMatch('tdm', 'gantry', 'recruit'));
  const s0 = await waitState(page, (s) => s.screen === 'match' && s.phase === 'live' && s.camera === 'fp' && s.pos, 90000, 'live bot match');
  check(s0.mode === 'tdm' && s0.map === 'gantry' && s0.players >= 10, `in match: ${s0.mode}/${s0.map}, ${s0.players} players, transport ${s0.transport}`);
  await shot(page, 'b-live');
  await page.evaluate(() => window.__HF.simulateInput({ forward: true, fire: true }, { dx: 0.35, dy: -0.05 }));
  await sleep(4000);
  await shot(page, 'b-firing');
  const s1 = await state(page);
  await page.evaluate(() => window.__HF.simulateInput({ forward: false, fire: false }));
  const moved = Math.hypot(s1.pos.x - s0.pos.x, s1.pos.z - s0.pos.z);
  check(moved > 0.5, `position changed (${moved.toFixed(2)} m)`);
  check(s1.shotsFired > 0 && (s1.ammo < s0.ammo || s1.reserve < s0.reserve), `shots fired (${s1.shotsFired}), ammo ${s0.ammo} → ${s1.ammo}`);
  check(s1.snaps > s0.snaps + 20, `snapshots flowing (${s0.snaps} → ${s1.snaps})`);
  check(s1.ack > s0.ack, `inputs acknowledged (${s0.ack} → ${s1.ack})`);
  check(s1.remotes.length >= 9, `remote players rendered (${s1.remotes.length})`);
  // Hunt for a few seconds (face the nearest visible enemy and fire) for a mid-fight screenshot.
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => {
      const id = window.__HF.app.match?.debugFaceEnemy() ?? -1;
      window.__HF.simulateInput({ fire: id >= 0, forward: id < 0, sprint: id < 0 }, { dx: id < 0 ? 0.08 : 0, dy: 0 });
    });
    await sleep(350);
  }
  await shot(page, 'b-fight');
  await page.evaluate(() => window.__HF.simulateInput({ fire: false, forward: false, sprint: false }));
  const left = await leaveMatch(page, ['menu']);
  check(left.screen === 'menu', 'left the match → menu');
  reportErrors(p, 'b');
  await p.ctx.close();
}

async function scenarioC(browser, base) {
  log('c) online quick play, two pages');
  // Two software-rendered pages share the CPU: keep them light so neither starves its socket.
  const vp = { width: 560, height: 315 };
  const [A, B] = await Promise.all([openPage(browser, base, { viewport: vp, label: 'c1', renderScale: 0.5 }), openPage(browser, base, { viewport: vp, label: 'c2', renderScale: 0.5 })]);
  for (const p of [A, B]) {
    await p.page.waitForFunction(() => window.__HF.app.net.status === 'online', null, { timeout: 10000, polling: 200 }).catch(() => undefined);
    const net = await p.page.evaluate(() => window.__HF.app.net.status);
    check(net === 'online', `page sees the server online (${net})`);
  }
  // Measure queue → 'found' inside each page (independent of how slowly software GL paints).
  const arm = (p) =>
    p.page.evaluate(() => {
      window.__qp = { at: performance.now(), found: 0 };
      window.__HF.app.on('queue', (q) => {
        if (q.state === 'found' && !window.__qp.found) window.__qp.found = performance.now();
      });
      void window.__HF.quickPlay('tdm');
    });
  await Promise.all([arm(A), arm(B)]);
  const cond = (s) => s.inMatch && s.you != null && Array.isArray(s.roster);
  const [sa, sb] = await Promise.all([waitState(A.page, cond, 30000, 'match A'), waitState(B.page, cond, 30000, 'match B')]);
  const found = await Promise.all([A, B].map((p) => p.page.evaluate(() => (window.__qp.found ? window.__qp.found - window.__qp.at : -1))));
  check(sa.transport === 'online' && sb.transport === 'online', `both over the WebSocket transport (socket thread: ${sa.transportThread}, ${sb.transportThread})`);
  check(sa.map === sb.map && sa.mode === sb.mode, `same map/mode (${sa.map}/${sa.mode} vs ${sb.map}/${sb.mode})`);
  // A drop-in reaches the other page as a 'join' event in its next snapshot: poll briefly.
  const [ra, rb] = await Promise.all([
    waitState(A.page, (s) => s.roster.includes(sb.you), 10000, 'A roster has B').catch(() => sa),
    waitState(B.page, (s) => s.roster.includes(sa.you), 10000, 'B roster has A').catch(() => sb),
  ]);
  check(ra.roster.includes(sb.you) && rb.roster.includes(sa.you), `same room: each roster has the other (A=${sa.you}, B=${sb.you})`);
  check(found.every((ms) => ms >= 0 && ms < 10000), `matched within ~8 s (${found.map((ms) => (ms / 1000).toFixed(1)).join(' s, ')} s; software GL delays the pages)`);
  // Once both views are built, each renders the other as a remote character.
  const why = [];
  const [va, vb] = await Promise.all([
    waitState(A.page, (s) => s.remotes && s.remotes.includes(sb.you), 60000, 'A renders B').catch((e) => (why.push(e.message), null)),
    waitState(B.page, (s) => s.remotes && s.remotes.includes(sa.you), 60000, 'B renders A').catch((e) => (why.push(e.message), null)),
  ]);
  check(!!va && !!vb, `each renders the other player${why.length ? ` (${why.join('; ')})` : ''}`);
  await waitState(A.page, (s) => s.screen === 'match', 60000, 'A match screen').catch(() => null);
  await shot(A.page, 'c-online-a');
  // A page whose main thread stalls (map build on a slow phone, a busy machine) must not be dropped by
  // the server's 5 s ping/pong heartbeat: the socket lives in a worker that keeps reading it.
  const snapsBefore = (await state(B.page)).snaps;
  await B.page.evaluate((ms) => {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      /* busy */
    }
  }, 12000);
  const resumed = await waitState(B.page, (s) => s.inMatch && s.snaps > snapsBefore + 30, 15000, 'B resumes').catch(() => null);
  const aStill = await state(A.page);
  const bStill = resumed ?? (await state(B.page));
  check(!!resumed && aStill.roster.includes(sb.you) && bStill.roster.includes(sa.you), `B survives a 12 s main-thread stall (in match: ${!!resumed}, A still lists B: ${aStill.roster.includes(sb.you)})`);
  for (const [p, n] of [[A, 'c1'], [B, 'c2']]) {
    await p.page.evaluate(() => window.__HF.app.match?.leave());
    reportErrors(p, n);
    await p.ctx.close();
  }
}

async function scenarioD(browser, base) {
  log('d) phone landscape 844×390, touch');
  const p = await openPage(browser, base, { viewport: { width: 844, height: 390 }, touch: true, label: 'd' });
  const { page } = p;
  const device = await page.evaluate(() => window.__HF.app.input.device);
  check(device === 'touch', `input device is touch (${device})`);
  await shot(page, 'd-phone-menu');
  await page.evaluate(() => window.__HF.training(false));
  await waitState(page, (s) => s.screen === 'match' && s.camera === 'fp', 90000, 'range on phone');
  await sleep(800);
  const ui = await page.evaluate(() => {
    const root = document.querySelector('.hf-touch');
    const vis = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 && r.width > 0 && r.height > 0;
    };
    const buttons = root ? [...root.querySelectorAll('.b')].filter(vis).length : 0;
    return {
      root: vis(root),
      buttons,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      bodyOverflowX: document.body.scrollWidth - window.innerWidth,
      // The scoreboard toggle is one of the (movable) touch buttons.
      sbButton: vis(root?.querySelector('.b-scoreboard')),
    };
  });
  check(ui.root && ui.buttons >= 6, `touch controls visible (${ui.buttons} buttons)`);
  check(ui.sbButton, 'touch scoreboard button visible');
  check(ui.overflowX <= 0 && ui.bodyOverflowX <= 0, `no horizontal overflow (${ui.overflowX}, ${ui.bodyOverflowX})`);
  await shot(page, 'd-phone-match');
  await leaveMatch(page);
  reportErrors(p, 'd');
  await p.ctx.close();
}

async function scenarioE(browser, base) {
  log('e) Arabic / RTL');
  const p = await openPage(browser, base, { query: '&lang=ar', label: 'e' });
  const dir = await p.page.evaluate(() => document.documentElement.dir);
  check(dir === 'rtl', `document dir = ${dir}`);
  const lang = await p.page.evaluate(() => document.documentElement.lang);
  check(lang.startsWith('ar'), `document lang = ${lang}`);
  await sleep(600);
  await shot(p.page, 'e-arabic-menu');
  // Restore English for later scenarios sharing storage (separate contexts anyway).
  reportErrors(p, 'e');
  await p.ctx.close();
}

async function scenarioF(browser, base) {
  log('f) training range');
  const p = await openPage(browser, base, { label: 'f' });
  const { page } = p;
  await page.evaluate(() => window.__HF.training(false));
  await waitState(page, (s) => s.screen === 'match' && s.camera === 'fp' && s.pos, 90000, 'range');
  let hits = 0;
  for (let i = 0; i < 40 && hits < 3; i++) {
    const r = await page.evaluate(() => {
      const id = window.__HF.app.match?.debugFaceEnemy() ?? -1;
      // Tap fire (semi-automatic cadence keeps recoil low).
      window.__HF.simulateInput({ fire: id >= 0 });
      return id;
    });
    await sleep(260);
    await page.evaluate(() => window.__HF.simulateInput({ fire: false }));
    await sleep(140);
    const s = await state(page);
    hits = s.range?.hits ?? 0;
    if (i === 6) await shot(page, 'f-range');
    void r;
  }
  const s = await state(page);
  check(s.shotsFired > 0, `range shots fired (${s.shotsFired})`);
  check(hits > 0 && s.hitsConfirmed > 0, `target hits registered (range stats ${hits}, confirmed ${s.hitsConfirmed})`);
  const after = await leaveMatch(page, ['results']);
  check(after.screen === 'results', 'leaving the range shows results');
  await sleep(1200);
  await shot(page, 'f-results');
  await page.evaluate(() => window.__HF.show('menu'));
  await waitState(page, (x) => x.screen === 'menu', 10000, 'menu');
  reportErrors(p, 'f');
  await p.ctx.close();
}

async function scenarioG(browser, base) {
  log('g) repeated matches — GPU memory stable');
  const p = await openPage(browser, base, { label: 'g', viewport: { width: 640, height: 360 } });
  const { page } = p;
  const mem = () => page.evaluate(() => ({ ...window.__HF.app.engine.renderer.info.memory }));
  const runRange = async () => {
    await page.evaluate(() => window.__HF.training(false));
    await waitState(page, (s) => s.screen === 'match' && s.camera === 'fp', 90000, 'range');
    await sleep(800);
    await leaveMatch(page);
    await page.evaluate(() => window.__HF.show('menu'));
    await waitState(page, (s) => s.screen === 'menu', 10000, 'menu');
    await sleep(600);
    return mem();
  };
  const m1 = await runRange();
  const m2 = await runRange();
  const m3 = await runRange();
  log(`  memory at the menu after each session: ${JSON.stringify([m1, m2, m3])}`);
  check(m2.geometries === m1.geometries && m3.geometries === m1.geometries, `geometries released (${m1.geometries} → ${m2.geometries} → ${m3.geometries})`);
  check(m2.textures === m1.textures && m3.textures === m1.textures, `textures released (${m1.textures} → ${m2.textures} → ${m3.textures})`);
  reportErrors(p, 'g');
  await p.ctx.close();
}

async function scenarioH(browser, base) {
  log('h) Launch Control finale → results → menu → next match');
  const p = await openPage(browser, base, { label: 'h', viewport: { width: 640, height: 360 } });
  const { page } = p;
  await page.evaluate(() => window.__HF.botMatch('control', 'gantry', 'recruit'));
  await waitState(page, (s) => s.screen === 'match' && s.phase === 'live' && s.camera === 'fp', 90000, 'live control match');
  // Stand in / near zone B for a moment so a team owns something, then force the end.
  await sleep(1500);
  const ended = await page.evaluate(() => window.__HF.app.match?.debugEndMatch());
  check(ended === true, 'forced match end on the local host');
  const outro = await waitState(page, (s) => s.phase === 'ended' && s.camera === 'outro', 20000, 'outro camera');
  check(outro.camera === 'outro', `outro camera running (scores ${outro.scores.join(':')})`);
  await sleep(2500);
  await shot(page, 'h-outro');
  const res = await waitState(page, (s) => s.screen === 'results' && !s.inMatch, 30000, 'results after outro');
  check(res.screen === 'results', 'matchEnd → results screen');
  await sleep(1500);
  await shot(page, 'h-results');
  await page.evaluate(() => window.__HF.show('menu'));
  await waitState(page, (s) => s.screen === 'menu', 10000, 'menu');
  const memA = await page.evaluate(() => ({ ...window.__HF.app.engine.renderer.info.memory }));
  await page.evaluate(() => window.__HF.botMatch('ffa', 'observatory', 'recruit'));
  const s2 = await waitState(page, (s) => s.screen === 'match' && s.camera !== undefined && s.ready, 90000, 'second match');
  check(s2.mode === 'ffa' && s2.map === 'observatory', `second match running (${s2.mode}/${s2.map})`);
  await waitState(page, (s) => s.camera === 'fp', 30000, 'second match first person').catch(() => null);
  await shot(page, 'h-second-match');
  await leaveMatch(page, ['menu']);
  await sleep(600);
  const memB = await page.evaluate(() => ({ ...window.__HF.app.engine.renderer.info.memory }));
  // Different maps/cosmetics legitimately warm different caches; g) asserts the strict case.
  log(`  memory at the menu after bot matches: ${JSON.stringify([memA, memB])}`);
  reportErrors(p, 'h');
  await p.ctx.close();
}

// ── Main ────────────────────────────────────────────────────────────────────

const server = await startServer();
log(`server on ${server.base} · scenarios: ${SELECTED.join(', ')}${QUICK ? ' (quick)' : ''}`);
const browser = await chromium.launch({ headless: !HEADED, args: GL_ARGS });
const table = { a: scenarioA, b: scenarioB, c: scenarioC, d: scenarioD, e: scenarioE, f: scenarioF, g: scenarioG, h: scenarioH };
try {
  for (const id of SELECTED) {
    try {
      await table[id](browser, server.base);
    } catch (err) {
      failures.push(`${id}: ${err.message}`);
      log(`  ✗ ${id} crashed: ${err.stack ?? err}`);
    }
  }
} finally {
  await browser.close().catch(() => undefined);
  server.proc.kill('SIGTERM');
  await sleep(300);
  if (!args.includes('--keep')) rmSync(server.dataDir, { recursive: true, force: true });
}

log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s — screenshots in ${path.relative(ROOT, OUT)}/`);
if (failures.length) {
  console.log(`\n${failures.length} failure(s):\n - ${failures.join('\n - ')}`);
  if (args.includes('--keep')) console.log(server.output());
  process.exit(1);
}
console.log('\nall e2e checks passed');

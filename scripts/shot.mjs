#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — dev screenshot tool for the preview harness (preview.html).
//
// Usage:
//   npx vite --port 5173 &                      # dev server (serves preview.html)
//   node scripts/shot.mjs "<path+query>" out.png [--w 1280 --h 720 --wait 3000 --port 5173 --timeout 90000]
//
// Examples:
//   node scripts/shot.mjs "preview.html?view=map&map=gantry&cam=keyart" artifacts/gantry.png
//   node scripts/shot.mjs "preview.html?view=weapons&quality=high" artifacts/weapons.png --w 1600 --h 900
//   node scripts/shot.mjs "preview.html?view=viewmodel&weapon=breaker&anim=reload&t=1.2" vm.png
//   --eval "<js expression>"  evaluates in the page after capture and prints the result
//   --touch                   emulate a touch device (hasTouch/isMobile), --dpr <n> device scale
//
// Launches Playwright's Chromium with SwiftShader WebGL (software rendering —
// slow, keep runs short), waits for `window.__previewReady === true` (or the
// timeout), waits `--wait` ms more, takes the screenshot and prints any console
// errors / page errors it saw. Exit code 1 if the page never became ready.
// ─────────────────────────────────────────────────────────────────────────────

import { chromium } from 'playwright';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('usage: node scripts/shot.mjs "<path+query>" out.png [--w 1280 --h 720 --wait 3000 --port 5173 --timeout 90000]');
  process.exit(2);
}
const [target, out] = args;
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};
const w = Number(opt('w', 1280));
const h = Number(opt('h', 720));
const wait = Number(opt('wait', 3000));
const port = Number(opt('port', 5173));
const timeout = Number(opt('timeout', 90000));
const dpr = Number(opt('dpr', 1));
const touch = args.includes('--touch');

const url = /^https?:/.test(target) ? target : `http://localhost:${port}/${target.replace(/^\//, '')}`;

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[console.${m.type()}] ${m.text()}`);
  else if (process.env.SHOT_VERBOSE) console.log(`[console.${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

let ready = false;
const t0 = Date.now();
try {
  await page.goto(url, { waitUntil: 'load', timeout });
  await page.waitForFunction(() => window.__previewReady === true, null, { timeout, polling: 250 });
  ready = true;
} catch (e) {
  errors.push(`[shot] not ready: ${e.message.split('\n')[0]}`);
}
if (wait > 0) await page.waitForTimeout(wait);
await page.screenshot({ path: out, timeout });
const info = await page.evaluate(() => window.__previewInfo ?? null).catch(() => null);
const evalSrc = opt('eval', '');
if (evalSrc) {
  const r = await page.evaluate(evalSrc).catch((e) => `eval error: ${e.message}`);
  console.log(`[shot] eval ${typeof r === 'string' ? r : JSON.stringify(r)}`);
}
await browser.close();

console.log(`[shot] ${out} (${w}x${h}) ready=${ready} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (info) console.log(`[shot] info ${JSON.stringify(info)}`);
for (const e of errors) console.log(e);
process.exit(ready ? 0 : 1);

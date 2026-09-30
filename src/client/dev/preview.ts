// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — dev preview harness (preview.html; NOT in the production build).
//
// URL parameters:
//   view=map|characters|weapons|viewmodel|effects|materials|touch   (default map)
//   map=<MapId>              map for map/viewmodel/effects/characters lighting (default gantry)
//   cam=intro|keyart|outro|free|x,y,z,tx,ty,tz                        (map view)
//   quality=low|medium|high  (default high)
//   weapon=<WeaponId>        (viewmodel / weapons highlight)
//   skin=<skin id>           (weapons / viewmodel)
//   anim=idle|fire|reload|ads|sprint|swap|throw|walk                  (viewmodel / characters)
//   mode=control             (map view: show zones with sample states)
//   t=<seconds>              advance the simulation before capture
//   colorblind=off|protanopia|deuteranopia|tritanopia
//   stats=1                  show fps / draw calls overlay
//
// Sets window.__previewReady = true once a representative frame is on screen,
// and window.__previewInfo with draw-call / triangle stats.
// Free camera (cam=free): WASD/QE to fly, drag to orbit-look, Shift = fast.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { Renderer } from '../engine/renderer';
import { Materials } from '../engine/materials';
import { setColorblindMode, type ColorblindMode } from '../engine/palette';
import { WeaponModels } from '../world/weapon-models';
import type { QualityPreset } from '../contracts';
import { setupView, type PreviewContext, type PreviewView } from './views';

declare global {
  interface Window {
    __previewReady?: boolean;
    __previewInfo?: unknown;
  }
}

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'map';
const quality = (params.get('quality') ?? 'high') as QualityPreset;
const advance = Math.max(0, Number(params.get('t') ?? 0) || 0);
setColorblindMode((params.get('colorblind') ?? 'off') as ColorblindMode);

const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const engine = new Renderer(canvas, { preset: quality, renderScale: 1 });
const materials = new Materials();
materials.setQuality(engine.quality);
const weapons = new WeaponModels(materials);

const ctx: PreviewContext = { engine, materials, weapons, params, canvas };

async function main(): Promise<void> {
  const v: PreviewView = await setupView(view, ctx);
  (window as unknown as { __preview: unknown }).__preview = { view: v, engine, THREE };
  engine.setScene(v.scene, v.camera);
  if (v.overlay) engine.setOverlay(v.overlay.scene, v.overlay.camera);

  // Deterministic warm-up: advance the requested time in fixed steps.
  const step = 1 / 60;
  const steps = Math.round(advance / step);
  for (let i = 0; i < steps; i++) v.update(step, i * step);
  let simTime = steps * step;

  let last = performance.now();
  let frames = 0;
  const showStats = params.get('stats') === '1';
  const frame = (): void => {
    const now = performance.now();
    // Screenshots must be deterministic: before "ready", use fixed dt.
    const dt = window.__previewReady ? Math.min(0.05, (now - last) / 1000) : step;
    last = now;
    simTime += dt;
    v.update(dt, simTime);
    engine.render(dt);
    frames++;
    if (frames === 3) {
      window.__previewInfo = { calls: engine.stats.calls, triangles: engine.stats.triangles, preset: engine.quality.preset };
      window.__previewReady = true;
    }
    if (showStats) hud.textContent = `${view} ${engine.quality.preset}  fps ${engine.stats.fps.toFixed(0)}  calls ${engine.stats.calls}  tris ${engine.stats.triangles}`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((err) => {
  console.error('[preview] failed', err);
  hud.textContent = `preview failed: ${String(err)}`;
  window.__previewReady = true;
});

export { THREE };

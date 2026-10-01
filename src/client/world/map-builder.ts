// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — map builder: MapDef → MapView.
//
//  1. Scene + atmosphere (sky, sun, fog, weather) + per-mood grading.
//  2. Static geometry from every non-'hidden' solid (map-builder/solids.ts,
//     primitives in map-builder/geometry.ts), merged into one mesh per
//     texture/material (a dozen draws).
//  3. Backdrop: terrain skirt, coast or cloud sea + water (map-builder/backdrop.ts).
//  4. Gameplay visuals: control zones, Sunspear pedestals, range targets
//     (map-builder/gameplay.ts).
//  5. Per-map decor: world/maps/<id>.ts default-exports a DecorBuilder and may
//     export `backdrop: BackdropOptions` to override step 3 (map-builder/decor.ts).
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { DecorContext, GradingSettings, MapDecor, MapRuntimeState, MapView, MaterialLibrary, QualitySettings, RenderEngine, ShowcasePose } from '../contracts';
import type { MapDef, MapLighting } from '../../shared/maps/types';
import type { Vec3 } from '../../shared/types';
import { hashString, mulberry32 } from '../../shared/math';
import { createAtmosphere, type AtmosphereView } from '../engine/atmosphere';
import { Materials } from '../engine/materials';
import { ENV } from '../engine/palette';
import { paintTree } from '../engine/painterly';
import { buildBackdrop, dominantGround } from './map-builder/backdrop';
import { loadDecor } from './map-builder/decor';
import { GameplayVisuals } from './map-builder/gameplay';
import { defaultShowcase } from './map-builder/showcase';
import { addSolid, SolidGrid, type Ctx } from './map-builder/solids';

export type { BackdropOptions } from './map-builder/backdrop';
export { prefetchDecorModules } from './map-builder/decor';
export { defaultShowcase } from './map-builder/showcase';

/**
 * Bounds of the static content that can throw sun shadows into the play space:
 * the decor/solid extent, clipped to the map bounds plus a margin (tall set
 * pieces just outside still shade the edge; the far backdrop does not count).
 */
function staticShadowBounds(def: MapDef, roots: THREE.Object3D[]): THREE.Box3 {
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  for (const r of roots) {
    r.updateMatrixWorld(true);
    tmp.setFromObject(r);
    if (!tmp.isEmpty()) box.union(tmp);
  }
  const m = 24;
  const b = def.bounds;
  if (box.isEmpty()) box.set(new THREE.Vector3(b.min.x, b.min.y, b.min.z), new THREE.Vector3(b.max.x, b.max.y, b.max.z));
  box.min.x = Math.max(box.min.x, b.min.x - m);
  box.min.z = Math.max(box.min.z, b.min.z - m);
  box.max.x = Math.min(box.max.x, b.max.x + m);
  box.max.z = Math.min(box.max.z, b.max.z + m);
  box.min.y = Math.max(box.min.y, b.min.y);
  box.max.y = Math.min(box.max.y, b.min.y + 160);
  return box;
}

/** Grading derived from a map's lighting mood (applied by buildMapView). */
export function gradingForLighting(l: MapLighting): Partial<GradingSettings> {
  const tint = l.mood === 'sunset' ? '#ffeedd' : l.mood === 'golden' ? '#fff3df' : '#f4eefc';
  return {
    exposure: l.exposure,
    bloomStrength: l.bloom,
    saturation: l.mood === 'dusk' ? 1.1 : l.mood === 'golden' ? 1.16 : 1.13,
    tint,
    vignette: 0.34,
    grain: 0.035,
    shadowTint: ENV.shadowCool,
  };
}

// ── MapView ─────────────────────────────────────────────────────────────────

class MapViewImpl implements MapView {
  readonly scene = new THREE.Scene();
  readonly atmosphere: AtmosphereView;
  decor: MapDecor | null = null;
  readonly tickers: ((dt: number) => void)[] = [];
  gameplay: GameplayVisuals | null = null;
  private readonly owned: THREE.Object3D[] = [];
  private tickObjects: THREE.Object3D[] = [];

  constructor(readonly def: MapDef, quality: QualitySettings) {
    this.scene.name = `map.${def.id}`;
    this.atmosphere = createAtmosphere(this.scene, def.lighting, quality);
  }

  own(o: THREE.Object3D): void {
    this.owned.push(o);
  }

  collectTickers(root: THREE.Object3D): void {
    this.tickObjects = [];
    root.traverse((o) => {
      if (typeof o.userData.halcyonTick === 'function') this.tickObjects.push(o);
    });
  }

  update(dt: number, s: MapRuntimeState): void {
    this.atmosphere.update(dt, s.camera, this.def.lighting.stars * THREE.MathUtils.clamp(s.matchProgress, 0, 1));
    for (const t of this.tickers) t(dt);
    for (const o of this.tickObjects) (o.userData.halcyonTick as (dt: number, scene: THREE.Scene) => void)(dt, this.scene);
    this.gameplay?.update(dt, s);
    this.decor?.update?.(dt, s);
  }

  showcase(kind: 'intro' | 'outro' | 'keyart'): ShowcasePose {
    const custom = this.decor?.showcase?.(kind);
    if (custom) return custom;
    return defaultShowcase(this.def, kind);
  }

  dispose(): void {
    this.decor?.dispose?.();
    this.gameplay?.dispose();
    for (const o of this.tickObjects) (o.userData.dispose as (() => void) | undefined)?.();
    for (const o of this.owned) {
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        // Shared library materials are owned by MaterialLibrary; only dispose our own.
        const mat = m.material as THREE.Material | undefined;
        if (mat && (mat as THREE.ShaderMaterial).isShaderMaterial) mat.dispose();
      });
      o.removeFromParent();
    }
    this.atmosphere.dispose();
    this.scene.clear();
  }
}

/**
 * Builds the complete visual map. Also applies the map's grading (exposure,
 * bloom, tint) to the engine — callers showing a different scene afterwards
 * should call engine.setGrading themselves.
 */
export async function buildMapView(def: MapDef, ctx: { engine: RenderEngine; materials: MaterialLibrary }): Promise<MapView> {
  const quality = ctx.engine.quality;
  if (ctx.materials instanceof Materials) ctx.materials.setQuality(quality);
  const view = new MapViewImpl(def, quality);
  ctx.engine.setGrading(gradingForLighting(def.lighting));

  const mod = await loadDecor(def.id);

  const g = dominantGround(def);
  const bctx: Ctx = {
    lib: ctx.materials,
    quality,
    buckets: new Map(),
    solids: def.solids,
    grid: new SolidGrid(def.solids),
    groundY: g.y,
    drawHidden: !mod?.default,
  };
  if (!mod?.default && def.solids.some((x) => x.style === 'hidden')) {
    console.info(`[map] '${def.id}' has no decor module yet — drawing 'hidden' solids as blockout.`);
  }
  def.solids.forEach((s, i) => addSolid(bctx, s, i));
  const backdrop = buildBackdrop(bctx, def, mod?.backdrop ?? {}, view.scene, view.tickers);
  for (const o of backdrop) view.own(o);

  const staticRoot = new THREE.Group();
  staticRoot.name = 'map.static';
  const castEnabled = quality.shadows !== 'off';
  for (const b of bctx.buckets.values()) {
    const m = b.build(true, castEnabled);
    if (m) staticRoot.add(m);
  }
  view.scene.add(staticRoot);
  view.own(staticRoot);

  view.gameplay = new GameplayVisuals(def, view.scene, ctx.materials, quality);

  // Per-map decor.
  const decorRoot = new THREE.Group();
  decorRoot.name = 'map.decor';
  view.scene.add(decorRoot);
  view.own(decorRoot);
  if (mod?.default) {
    const dctx: DecorContext = {
      def,
      scene: view.scene,
      root: decorRoot,
      quality,
      materials: ctx.materials,
      rng: mulberry32(hashString(`decor|${def.id}`)),
    };
    try {
      view.decor = mod.default(dctx);
    } catch (err) {
      console.error(`[map] decor builder for '${def.id}' threw`, err);
    }
  }
  // Painterly finish on every environment surface the decor modules built with
  // their own materials (library materials carry it already) — characters,
  // weapons, gameplay markers and effects are never part of these roots.
  paintTree(decorRoot);
  for (const o of backdrop) paintTree(o);
  // Low preset: the static content casts one baked whole-map sun shadow.
  view.atmosphere.setStaticShadowCasters([staticRoot, decorRoot], staticShadowBounds(def, [staticRoot, decorRoot]));
  view.collectTickers(view.scene);
  return view;
}

export type { Vec3 };

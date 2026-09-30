// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — procedural weapon models (premium 1970s industrial design).
//
// Braun / Olivetti / NASA hardware language: pillowy ceramic shells over
// anodized receivers, knurled rubber and bakelite grips, brass rings, exposed
// screws, vent slots, an analog dial with a live needle and a tiny amber
// seven-segment ammo screen on every gun. Silhouettes follow the kill-feed
// icons (ui/icons.ts):
//   Meridian  AR   carry-handle round-lens optic, pill handguard, curved mag
//   Swift     SMG  top pan drum that turns per round, finned shroud, wire stock
//   Longline  DMR  fluted barrel, big brass-ringed scope, bolt that cycles
//   Breaker   pump ceramic pump grip, vented rib, side shell saddle
//   Pulse     side swing-out glowing capacitor cartridge, coil emitter
//   Sunspear  beam gilt trim, four ring coils that light in sequence, lens,
//                  vent fins that open after a shot
//
// Rendering (see weapons/surface.ts + weapons/kit.ts): one "finish palette"
// material per skin; geometry merged per bucket and cached per weapon.
//   view  LOD: 1 body mesh + 1 print (decal) mesh + 1 mesh per moving part +
//              the live screen  → 5–10 draw calls, ≈ 6–14k triangles.
//   world LOD: ONE mesh (moving parts become empty anchors) → 1 draw call,
//              ≈ 0.6–1.6k triangles (≈ 0.4–1k on the low preset, Lambert).
// Shared geometries / materials are never disposed per instance.
//
// Local space: origin at the top of the pistol grip, muzzle toward −Z, +Y up,
// meters. Moving parts live in `parts` with pivots where they hinge/slide.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { MaterialLibrary, WeaponModel, WeaponModelFactory } from '../contracts';
import type { WeaponId } from '../../shared/types';
import { findSkin, type WeaponSkin } from '../../shared/cosmetics';
import { ENV, PICKUP_COLOR } from '../engine/palette';
import { makeCanvas } from '../engine/textures';
import { Build, countTriangles, type Q } from './weapons/kit';
import { F, Palette, SCREEN_H, SCREEN_W, drawAmmoScreen, finishMaterial, patternTexture, printMaterial, skinPalette, type FinishKind } from './weapons/surface';
import { buildLongline, buildMeridian, buildSwift } from './weapons/designs-rifles';
import { buildBreaker, buildPulse, buildSunspear } from './weapons/designs-heavy';

export type WeaponLod = 'view' | 'world';

/** Extra (non-contract) members the viewmodel/characters use. */
export interface WeaponModelView extends WeaponModel {
  readonly id: WeaponId;
  readonly lod: WeaponLod;
  /** Point on the line of sight (rear aperture / scope eyepiece). */
  readonly sight: THREE.Object3D;
  /** Hand anchors: palm centre on the grip axis (+Y up the grip, −Z toward the front). */
  readonly handR: THREE.Object3D;
  readonly handL: THREE.Object3D;
  /** Sunspear heat vents (open after a shot; rotate +X to open). */
  readonly vents: THREE.Object3D[];
  /** Extra anchors: 'mag' (support-hand grab on the magazine/drum/cartridge), 'bolt' (knob), 'shell'. */
  readonly anchors: Readonly<Record<string, THREE.Object3D>>;
  /** Layout metadata: eye (ADS eye relief m), gripR, supportR (grip radii), supportGrip (1 = vertical support grip). */
  readonly meta: Readonly<Record<string, number>>;
  /** Optional per-frame tick (analog needle easing). */
  tick(dt: number): void;
}

// ── Shared materials ────────────────────────────────────────────────────────

const mainCache = new Map<string, THREE.Material>();
const screenGeoCache = new Map<string, THREE.PlaneGeometry>();
const DYNAMIC: ReadonlySet<WeaponId> = new Set<WeaponId>(['sunspear', 'pulse']);

function sharedMain(skin: WeaponSkin, kind: FinishKind): THREE.Material {
  const key = `${skin.id}|${kind}`;
  let m = mainCache.get(key);
  if (!m) {
    m = finishMaterial(skinPalette(skin), patternTexture(skin), kind);
    m.name = `weapon.finish.${key}`;
    mainCache.set(key, m);
  }
  return m;
}

const GLOW_BASE = new THREE.Color(PICKUP_COLOR);
const GLOW_HOT = new THREE.Color('#fff4d6');
const PULSE_GLOW = new THREE.Color('#ffae5c');
const _c = new THREE.Color();

const SCREEN_LABEL: Record<WeaponId, string> = {
  meridian: 'RDS',
  swift: 'RDS',
  longline: 'RND',
  breaker: 'SHL',
  pulse: 'CEL',
  sunspear: 'CHG',
};

// ── Instance ────────────────────────────────────────────────────────────────

class WeaponInstance implements WeaponModelView {
  readonly root: THREE.Group;
  readonly muzzle: THREE.Object3D;
  readonly parts: WeaponModel['parts'];
  readonly sight: THREE.Object3D;
  readonly handR: THREE.Object3D;
  readonly handL: THREE.Object3D;
  readonly vents: THREE.Object3D[];
  readonly anchors: Readonly<Record<string, THREE.Object3D>>;
  readonly meta: Readonly<Record<string, number>>;
  private readonly needle: THREE.Object3D | null;
  private screenCanvas: HTMLCanvasElement | null = null;
  private screenTex: THREE.CanvasTexture | null = null;
  private screenMat: THREE.MeshBasicMaterial | null = null;
  private readonly palette: Palette | null = null;
  private readonly ownMain: THREE.Material | null = null;
  private lastMag = NaN;
  private lastSize = NaN;
  private needleTarget = Math.PI * 0.75;
  private needleVel = 0;
  private ticking = false;
  private charge = -1;

  constructor(readonly id: WeaponId, readonly lod: WeaponLod, b: Build, skin: WeaponSkin, kind: FinishKind) {
    this.root = b.root;
    this.muzzle = b.muzzle;
    this.parts = b.parts;
    this.sight = b.sight;
    this.handR = b.handR;
    this.handL = b.handL;
    this.vents = b.vents;
    this.anchors = b.anchors;
    this.meta = b.meta;
    this.needle = b.needle;
    let main: THREE.Material;
    if (DYNAMIC.has(id)) {
      // Animated glows need their own palette (still one draw call).
      this.palette = skinPalette(skin);
      main = this.ownMain = finishMaterial(this.palette, patternTexture(skin), kind);
    } else main = sharedMain(skin, kind);
    b.finalize(main, b.hi ? printMaterial() : null);
    if (b.screen) {
      this.screenCanvas = makeCanvas(SCREEN_W, SCREEN_H);
      this.screenTex = new THREE.CanvasTexture(this.screenCanvas);
      this.screenTex.colorSpace = THREE.SRGBColorSpace;
      this.screenTex.anisotropy = 4;
      this.screenMat = new THREE.MeshBasicMaterial({ map: this.screenTex, color: new THREE.Color(1.7, 1.7, 1.7) });
      const k = `${b.screen.w}x${b.screen.h}`;
      let g = screenGeoCache.get(k);
      if (!g) screenGeoCache.set(k, (g = new THREE.PlaneGeometry(b.screen.w, b.screen.h)));
      const mesh = new THREE.Mesh(g, this.screenMat);
      mesh.name = 'ammoScreen';
      b.screen.node.add(mesh);
      this.parts.screen = mesh;
    }
    const shadows = lod === 'world';
    this.root.traverse((o) => {
      o.castShadow = shadows;
      o.receiveShadow = false;
    });
    // The loose reload shell only exists in first person (hidden until loading).
    if (this.parts.shell) this.parts.shell.visible = false;
    this.setCharge(0);
  }

  setAmmo(mag: number, magSize: number): void {
    if (mag === this.lastMag && magSize === this.lastSize) return;
    this.lastMag = mag;
    this.lastSize = magSize;
    if (this.needle && this.id !== 'sunspear') {
      const f = magSize > 0 ? Math.max(0, Math.min(1, mag / magSize)) : 0;
      this.needleTarget = Math.PI * 0.75 - f * Math.PI * 1.5;
      if (!this.ticking) this.needle.rotation.z = this.needleTarget;
    }
    if (this.screenCanvas && this.screenTex) {
      drawAmmoScreen(this.screenCanvas.getContext('2d') as CanvasRenderingContext2D, mag, magSize, SCREEN_LABEL[this.id]);
      this.screenTex.needsUpdate = true;
    }
  }

  setCharge(k: number): void {
    k = Math.max(0, Math.min(1, k));
    if (k === this.charge) return;
    this.charge = k;
    const p = this.palette;
    if (this.id === 'sunspear') {
      if (this.needle) {
        this.needleTarget = Math.PI * 0.75 - k * Math.PI * 1.5;
        if (!this.ticking) this.needle.rotation.z = this.needleTarget;
      }
      if (!p) return;
      // Coils light in sequence, then everything runs white-hot.
      for (let i = 0; i < 4; i++) {
        const g = THREE.MathUtils.smoothstep(k, i * 0.2, i * 0.2 + 0.28);
        _c.copy(GLOW_BASE).lerp(GLOW_HOT, g * g * 0.8);
        p.setLinear(F.g0 + i, _c.r, _c.g, _c.b, 0.35 + g * 5.5);
      }
      const lens = THREE.MathUtils.smoothstep(k, 0.55, 1);
      _c.copy(GLOW_BASE).lerp(GLOW_HOT, lens);
      p.setLinear(F.g4, _c.r, _c.g, _c.b, 0.6 + lens * 7);
    } else if (this.id === 'pulse' && p) {
      // Faint idle glow; flares when the viewmodel reports a shot / fresh cell.
      _c.copy(PULSE_GLOW).lerp(GLOW_HOT, k * 0.6);
      p.setLinear(F.g0, _c.r, _c.g, _c.b, 0.55 + k * 4.5);
      p.setLinear(F.g1, _c.r, _c.g, _c.b, 0.9 + k * 6);
    }
  }

  tick(dt: number): void {
    this.ticking = true;
    if (!this.needle) return;
    // Under-damped spring: the needle swings and settles like a real gauge.
    const x = this.needle.rotation.z;
    const a = (this.needleTarget - x) * 260 - this.needleVel * 17;
    this.needleVel += a * Math.min(dt, 0.05);
    this.needle.rotation.z = x + this.needleVel * Math.min(dt, 0.05);
  }

  dispose(): void {
    this.screenTex?.dispose();
    this.screenMat?.dispose();
    this.ownMain?.dispose();
    this.root.removeFromParent();
  }
}

const BUILDERS: Record<WeaponId, (b: Build) => void> = {
  meridian: buildMeridian,
  swift: buildSwift,
  longline: buildLongline,
  breaker: buildBreaker,
  pulse: buildPulse,
  sunspear: buildSunspear,
};

export class WeaponModels implements WeaponModelFactory {
  constructor(private readonly materials: MaterialLibrary) {}

  create(id: WeaponId, skin: string, lod: 'view' | 'world'): WeaponModelView {
    const s = findSkin(skin);
    const tier = (this.materials as MaterialLibrary & { currentTier?: string }).currentTier;
    const q: Q = lod === 'view' ? 2 : tier === 'low' ? 0 : 1;
    const b = new Build(id, q);
    BUILDERS[id](b);
    const inst = new WeaponInstance(id, lod, b, s, q === 0 ? 'lambert' : 'standard');
    inst.setAmmo(WEAPON_MAG_DEFAULT[id], WEAPON_MAG_DEFAULT[id]);
    return inst;
  }
}

const WEAPON_MAG_DEFAULT: Record<WeaponId, number> = { meridian: 30, swift: 32, longline: 6, breaker: 6, pulse: 12, sunspear: 4 };

/** Draw calls + triangles of a model (diagnostics / preview stats). */
export function weaponStats(m: WeaponModel): { draws: number; triangles: number } {
  let draws = 0;
  m.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.visible) draws++;
  });
  return { draws, triangles: Math.round(countTriangles(m.root)) };
}

/** Environment neutral used by previews/menus behind weapons. */
export const WEAPON_BACKDROP = ENV.shadowWarm;

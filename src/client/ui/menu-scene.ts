// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — 3D menu backdrop.
//
// The player's character stands on a chamfered concrete platform at sunset on
// the coast; a launch tower and its rocket stand in silhouette across the bay,
// warm dust drifts through the low sun. The camera slowly orbits; each menu
// screen has a framing preset (the character slides to the free side of the
// UI via a projection view offset, so perspective never distorts). In the
// Loadout (and the Customize weapon-skin tab) the selected weapon floats in
// the foreground in its high-detail first-person ('view') model — printed
// decals, live ammo screen and dial — turning slowly around a 3/4 profile.
// Customize can preview any cosmetic (locked ones included) on the live
// character, and play an elimination effect on it (lazy EffectsSystem).
//
// Cheap by design: ~20 draw calls, merged static geometry, no allocations per
// frame, one atmosphere (sky dome + fog + sun) from engine/atmosphere.ts.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { App } from '../app';
import type { Atmosphere, CharacterAnim, CharacterView, ScreenId, WeaponModel } from '../contracts';
import { createAtmosphere } from '../engine/atmosphere';
import { EffectsSystem } from '../engine/effects';
import { createLaunchRocket, type LaunchRocket } from '../world/rocket';
import { ENV } from '../engine/palette';
import type { MapLighting } from '../../shared/maps/types';
import { GANTRY } from '../../shared/maps/gantry';
import type { CosmeticSelection, Faction, Team, WeaponId } from '../../shared/types';
import { i18n } from './i18n';

/** Sunset tuned for the showcase: the sun sits just behind the character's shoulder. */
const MENU_LIGHTING: MapLighting = {
  ...GANTRY.lighting,
  sunDir: { x: 0.42, y: 0.085, z: -0.9 },
  sunColor: '#ffa468',
  sunIntensity: 2.5,
  skyZenith: '#3f4a82',
  skyHorizon: '#f59462',
  sunGlow: '#ffc88e',
  fogColor: '#e0937a',
  fogDensity: 0.0038,
  hemiIntensity: 0.6,
  exposure: 0.96,
  weather: 'dust',
};

/** Temporary look shown while browsing Customize (locked items included). */
export interface MenuPreview {
  faction?: Faction;
  cosmetics?: Partial<Omit<CosmeticSelection, 'skins'>>;
  /** Weapon the character holds (and the showcase displays) with this skin. */
  weapon?: { id: WeaponId; skin: string };
}

/** Full magazine shown on the showcase ammo screen. */
const WEAPON_MAG: Record<WeaponId, number> = { meridian: 30, swift: 32, longline: 6, breaker: 6, pulse: 12, sunspear: 4 };

interface Framing {
  /** Look-at target. */
  tx: number;
  ty: number;
  tz: number;
  radius: number;
  height: number;
  fov: number;
  /** Base orbit angle (radians, 0 = camera on +Z) and swing amplitude. */
  angle: number;
  swing: number;
  /** Horizontal screen position (0..1, LTR) where the target appears. */
  screenX: number;
}

const FRAMING: Record<string, Framing> = {
  // Hero shot: camera slightly below the chest, looking up past the character into the sunset.
  menu: { tx: 0, ty: 1.2, tz: 0, radius: 5.9, height: 1.05, fov: 33, angle: -0.3, swing: 0.3, screenX: 0.66 },
  sub: { tx: 0, ty: 1.15, tz: 0, radius: 6.6, height: 1.35, fov: 34, angle: -0.2, swing: 0.18, screenX: 0.79 },
  loadout: { tx: 0, ty: 1.15, tz: 0, radius: 5.8, height: 1.3, fov: 33, angle: -0.3, swing: 0.1, screenX: 0.88 },
  skins: { tx: 0, ty: 1.15, tz: 0, radius: 5.6, height: 1.25, fov: 33, angle: -0.2, swing: 0.3, screenX: 0.89 },
  customize: { tx: 0, ty: 1.2, tz: 0, radius: 4.6, height: 1.15, fov: 34, angle: -0.15, swing: 0.5, screenX: 0.77 },
  profile: { tx: 0, ty: 1.15, tz: 0, radius: 5.8, height: 1.3, fov: 34, angle: 0.25, swing: 0.18, screenX: 0.78 },
  results: { tx: 0, ty: 1.15, tz: 0, radius: 5.4, height: 1.25, fov: 34, angle: 0.3, swing: 0.12, screenX: 0.84 },
  center: { tx: 0, ty: 1.4, tz: 0, radius: 8.5, height: 1.4, fov: 36, angle: 0, swing: 0.3, screenX: 0.5 },
};

function framingFor(screen: ScreenId | null): Framing {
  switch (screen) {
    case 'menu':
      return FRAMING.menu;
    case 'loadout':
      return FRAMING.loadout;
    case 'customize':
      return FRAMING.customize;
    case 'profile':
      return FRAMING.profile;
    case 'results':
      return FRAMING.results;
    case 'matchmaking':
      return FRAMING.center;
    default:
      return FRAMING.sub;
  }
}

export class MenuScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 900);
  private readonly app: App;
  private atmosphere: Atmosphere | null = null;
  private readonly statics: THREE.Object3D[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];
  private character: CharacterView | null = null;
  private fallback: THREE.Group | null = null;
  private weaponModel: (WeaponModel & { tick?: (dt: number) => void }) | null = null;
  private readonly weaponPivot = new THREE.Group();
  private readonly weaponCenter = new THREE.Group();
  private preview: MenuPreview | null = null;
  private weaponShowcase = false;
  private effects: EffectsSystem | null = null;
  private elimTimer = 0;
  private readonly camBack = new THREE.Vector3();
  private readonly platformTop = 0.36;
  private dust: THREE.Points | null = null;
  private rocket: LaunchRocket | null = null;
  private active = false;
  private time = 0;
  private focus: ScreenId | null = 'menu';
  private cur: Framing = { ...FRAMING.menu };
  private charKey = '';
  private weaponKey = '';
  private rebuildTimer = 0;
  private readonly target = new THREE.Vector3();
  private readonly anim: CharacterAnim = {
    vel: { x: 0, y: 0, z: 0 },
    yaw: Math.PI,
    pitch: 0,
    crouch: 0,
    sliding: false,
    airborne: false,
    sprinting: false,
    ads: false,
    reloading: false,
    mantling: false,
    charging: false,
    weapon: 'meridian',
    alive: true,
  };
  private unsub: (() => void)[] = [];

  constructor(app: App) {
    this.app = app;
    this.scene.name = 'menu-scene';
    this.build();
    this.refresh(true);
    this.unsub.push(app.profile.onChange(() => this.scheduleRefresh()));
    const eng = app.engine;
    if (eng?.onQualityChange) this.unsub.push(eng.onQualityChange((q) => this.atmosphere?.setQuality(q)));
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  activate(): void {
    if (this.active) return;
    this.active = true;
    const eng = this.app.engine;
    if (!eng) return;
    eng.setScene(this.scene, this.camera);
    eng.setOverlay(null, null);
    // Low bloom: the sun sits in frame right behind the hero, and a strong bloom
    // washes the whole sunset (and the character) out to cream on medium/high.
    eng.setGrading({ exposure: MENU_LIGHTING.exposure, bloomStrength: 0.32, vignette: 0.5, saturation: 1.14, tint: '#fff0dc', grain: 0.03, shadowTint: ENV.shadowCool });
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    const eng = this.app.engine;
    if (eng) {
      eng.setScene(null, null);
      this.camera.clearViewOffset();
    }
  }

  get isActive(): boolean {
    return this.active;
  }

  setFocus(screen: ScreenId | null): void {
    if (screen !== this.focus && screen !== 'customize') {
      // Leaving Customize drops any temporary preview.
      if (this.preview || this.weaponShowcase) {
        this.preview = null;
        this.weaponShowcase = false;
        this.scheduleRefresh();
      }
    }
    this.focus = screen;
  }

  /** Shows a temporary look (null restores the saved profile look). */
  setPreview(p: MenuPreview | null): void {
    const a = JSON.stringify(this.preview);
    const b = JSON.stringify(p);
    if (a === b) return;
    this.preview = p;
    this.scheduleRefresh();
  }

  /** Customize → weapon skins: float the weapon in the foreground like the Loadout does. */
  setWeaponShowcase(on: boolean): void {
    this.weaponShowcase = on;
  }

  /** Plays an elimination effect on the showcase character, then re-materializes it. */
  playElimination(fxId: string): void {
    const ch = this.character;
    const eng = this.app.engine;
    if (!ch || !eng) return;
    try {
      if (!this.effects) this.effects = new EffectsSystem(this.scene, eng.quality);
      const p = this.app.profile.value;
      const faction = (this.preview?.faction ?? p.faction) as Faction;
      ch.root.updateMatrixWorld(true);
      const pos = ch.root.position;
      this.effects.elimination({ x: pos.x, y: pos.y, z: pos.z }, this.anim.yaw, faction, faction as Team, fxId, 0);
      ch.die();
      this.elimTimer = 1.5;
    } catch (err) {
      console.warn('[menu-scene] elimination preview unavailable', err);
    }
  }

  dispose(): void {
    this.deactivate();
    for (const u of this.unsub.splice(0)) u();
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.character?.dispose();
    this.character = null;
    this.weaponModel?.dispose();
    this.weaponModel = null;
    this.effects?.dispose();
    this.effects = null;
    this.atmosphere?.dispose();
    this.rocket?.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.ownedMaterials) m.dispose();
  }

  // ── Scene construction ───────────────────────────────────────────────────

  private build(): void {
    const eng = this.app.engine;
    const quality = eng?.quality;
    if (quality) {
      try {
        this.atmosphere = createAtmosphere(this.scene, MENU_LIGHTING, quality);
      } catch (err) {
        console.warn('[menu-scene] atmosphere unavailable', err);
      }
    }
    if (!this.atmosphere) {
      this.scene.background = new THREE.Color(MENU_LIGHTING.fogColor);
      this.scene.fog = new THREE.FogExp2(MENU_LIGHTING.fogColor, MENU_LIGHTING.fogDensity);
      this.scene.add(new THREE.HemisphereLight(MENU_LIGHTING.hemiSky, MENU_LIGHTING.hemiGround, 1.2));
      const sun = new THREE.DirectionalLight(MENU_LIGHTING.sunColor, 2.5);
      sun.position.set(MENU_LIGHTING.sunDir.x, MENU_LIGHTING.sunDir.y, MENU_LIGHTING.sunDir.z).multiplyScalar(50);
      this.scene.add(sun);
    }

    // Warm key light from the camera side so the character's front reads while
    // the low sun behind gives a hot rim.
    const key = new THREE.DirectionalLight('#ffd2a6', 1.8);
    key.position.set(-2, 3.2, 5);
    this.scene.add(key);
    const rim = new THREE.PointLight('#ffb070', 7, 9, 1.6);
    rim.position.set(1.6, 2.2, -2.2);
    this.scene.add(rim);
    // Cool bounce from the sea side (shadowCool family) so the shaded flank keeps its volume.
    const fill = new THREE.DirectionalLight('#8f9bd0', 0.55);
    fill.position.set(4, 1.5, 2);
    this.scene.add(fill);

    const mats = this.app.materials;
    const concrete = mats ? mats.surface('concrete', { color: ENV.concrete }) : this.own(new THREE.MeshStandardMaterial({ color: ENV.concrete, roughness: 0.9 }));
    const concreteDark = mats ? mats.painted(ENV.concreteDark, { roughness: 0.95 }) : this.own(new THREE.MeshStandardMaterial({ color: ENV.concreteDark }));
    const bone = mats ? mats.painted(ENV.bone, { roughness: 0.6 }) : this.own(new THREE.MeshStandardMaterial({ color: ENV.bone }));
    const terracotta = mats ? mats.painted(ENV.terracottaFaded, { roughness: 0.7 }) : this.own(new THREE.MeshStandardMaterial({ color: ENV.terracottaFaded }));
    const metal = mats ? mats.painted(ENV.metalDark, { roughness: 0.55, metalness: 0.3 }) : this.own(new THREE.MeshStandardMaterial({ color: ENV.metalDark }));
    const glowGold = mats ? mats.glow(ENV.glowGold, 3) : this.own(new THREE.MeshBasicMaterial({ color: ENV.glowGold }));
    const sand = mats ? mats.surface('sand') : this.own(new THREE.MeshStandardMaterial({ color: ENV.sand }));
    const water = this.own(new THREE.MeshStandardMaterial({ color: new THREE.Color('#9aa6bf'), roughness: 0.22, metalness: 0 }));

    // Platform: lathe profile with chamfers + a darker inset ring.
    const r = 2.3;
    const top = this.platformTop;
    const prof = [
      new THREE.Vector2(0, top),
      new THREE.Vector2(r - 0.08, top),
      new THREE.Vector2(r, top - 0.06),
      new THREE.Vector2(r, 0.1),
      new THREE.Vector2(r + 0.18, 0.02),
      new THREE.Vector2(r + 0.18, -0.3),
    ];
    this.addMesh(new THREE.LatheGeometry(prof, 64), concrete, true);
    const ring = new THREE.RingGeometry(r * 0.72, r * 0.75, 64, 1);
    ring.rotateX(-Math.PI / 2);
    ring.translate(0, top + 0.004, 0);
    this.addMesh(ring, concreteDark, false);
    // Painted hazard-stripe arc (terracotta, environment palette).
    const arc = new THREE.RingGeometry(r * 0.82, r * 0.9, 48, 1, Math.PI * 0.15, Math.PI * 0.5);
    arc.rotateX(-Math.PI / 2);
    arc.translate(0, top + 0.004, 0);
    this.addMesh(arc, terracotta, false);

    // Ground apron + beach sand, then the sea.
    const apron = new THREE.CylinderGeometry(9, 10, 0.4, 48, 1);
    apron.translate(0, -0.35, 0);
    this.addMesh(apron, concrete, true);
    const beach = new THREE.CircleGeometry(26, 48);
    beach.rotateX(-Math.PI / 2);
    beach.translate(0, -0.52, 0);
    this.addMesh(beach, sand, true);
    const sea = new THREE.PlaneGeometry(2400, 2400, 1, 1);
    sea.rotateX(-Math.PI / 2);
    sea.translate(0, -0.9, 0);
    this.addMesh(sea, water, false);

    // Props on the apron: rounded crates, a lamp post and a small antenna.
    const crates: THREE.BufferGeometry[] = [];
    const place = (g: THREE.BufferGeometry, x: number, y: number, z: number, ry: number) => {
      g.rotateY(ry);
      g.translate(x, y, z);
      crates.push(g);
    };
    place(new RoundedBoxGeometry(1.1, 0.8, 0.9, 2, 0.08), -3.6, 0.2, -1.4, 0.3);
    place(new RoundedBoxGeometry(0.8, 0.6, 0.7, 2, 0.07), -3.1, 0.9, -1.2, -0.2);
    place(new RoundedBoxGeometry(1.4, 0.7, 1.0, 2, 0.08), 3.8, 0.15, -2.6, -0.5);
    const crateGeo = mergeGeometries(crates, false);
    for (const g of crates) g.dispose();
    if (crateGeo) this.addMesh(crateGeo, bone, true);

    const pole = new THREE.CylinderGeometry(0.06, 0.08, 5.2, 8);
    pole.translate(-5.5, 2.4, -3.5);
    const arm = new THREE.BoxGeometry(0.9, 0.08, 0.1);
    arm.translate(-5.15, 4.95, -3.5);
    const lampPole = mergeGeometries([pole, arm], false);
    pole.dispose();
    arm.dispose();
    if (lampPole) this.addMesh(lampPole, metal, true);
    const lamp = new THREE.SphereGeometry(0.14, 12, 8);
    lamp.translate(-4.75, 4.85, -3.5);
    this.addMesh(lamp, glowGold, false);

    // Distant launch complex across the bay: the game's own finale rocket +
    // umbilical tower (same art as Launch Control), hazed into a silhouette.
    try {
      if (!mats || !quality) throw new Error('materials unavailable');
      const rocket = createLaunchRocket(mats, quality, { scale: 0.72, tower: true });
      rocket.root.position.set(112, -1.2, -196);
      rocket.root.rotation.y = -0.6;
      this.scene.add(rocket.root);
      this.rocket = rocket;
    } catch (err) {
      console.warn('[menu-scene] launch rocket unavailable, using simple complex', err);
      this.buildLaunchComplex(metal, bone, terracotta);
    }

    // Weapon showcase (loadout / skins): pivot follows the camera each frame.
    this.weaponPivot.rotation.order = 'YXZ';
    this.weaponPivot.visible = false;
    this.weaponPivot.add(this.weaponCenter);
    this.scene.add(this.weaponPivot);

    // Blob shadow under the character (works without shadow maps).
    const blobTex = this.makeBlobTexture();
    const blobMat = this.own(new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.55, color: '#2a2230' }));
    const blob = new THREE.PlaneGeometry(1.6, 1.6);
    blob.rotateX(-Math.PI / 2);
    blob.translate(0, top + 0.008, 0);
    this.addMesh(blob, blobMat, false);

    this.buildDust();
  }

  private buildLaunchComplex(metal: THREE.Material, bone: THREE.Material, stripe: THREE.Material): void {
    const parts: THREE.BufferGeometry[] = [];
    const H = 92;
    const w0 = 10;
    const w1 = 4;
    const legAt = (t: number) => (w0 + (w1 - w0) * t) / 2;
    // Four legs.
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const g = new THREE.CylinderGeometry(0.45, 0.7, H, 6);
        const lean = (legAt(0) - legAt(1)) / H;
        g.rotateZ(sx * lean);
        g.rotateX(-sz * lean);
        g.translate((sx * (legAt(0) + legAt(1))) / 2, H / 2, (sz * (legAt(0) + legAt(1))) / 2);
        parts.push(g);
      }
    // Cross bracing + platforms.
    const levels = 12;
    for (let i = 1; i <= levels; i++) {
      const t = i / levels;
      const y = t * H;
      const half = legAt(t);
      for (const [sx, sz, rot] of [
        [0, 1, 0],
        [0, -1, 0],
        [1, 0, Math.PI / 2],
        [-1, 0, Math.PI / 2],
      ] as const) {
        const bar = new THREE.BoxGeometry(half * 2, 0.4, 0.4);
        bar.rotateY(rot);
        bar.translate(sx * half, y, sz * half);
        parts.push(bar);
      }
      if (i % 3 === 0) {
        const plat = new THREE.BoxGeometry(half * 2 + 3, 0.6, half * 2 + 3);
        plat.translate(0, y, 0);
        parts.push(plat);
      }
      // Diagonals on the two visible faces.
      const prevHalf = legAt((i - 1) / levels);
      const len = Math.hypot(half + prevHalf, H / levels);
      const ang = Math.atan2(H / levels, half + prevHalf);
      for (const sz of [-1, 1]) {
        const d = new THREE.BoxGeometry(len, 0.3, 0.3);
        d.rotateZ((i % 2 ? 1 : -1) * ang);
        d.translate(0, y - H / levels / 2, sz * (half + prevHalf) / 2);
        parts.push(d);
      }
    }
    // Service arms toward the rocket.
    for (const y of [34, 58, 76]) {
      const a = new THREE.BoxGeometry(12, 0.8, 1.2);
      a.translate(8, y, 0);
      parts.push(a);
    }
    const antenna = new THREE.CylinderGeometry(0.2, 0.3, 14, 5);
    antenna.translate(0, H + 7, 0);
    parts.push(antenna);
    const towerGeo = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();

    const complex = new THREE.Group();
    if (towerGeo) {
      const m = new THREE.Mesh(towerGeo, metal);
      complex.add(m);
      this.geometries.push(towerGeo);
    }
    // Rocket: body, nose, fins, stripes.
    const rocket: THREE.BufferGeometry[] = [];
    const body = new THREE.CylinderGeometry(3, 3, 70, 24);
    body.translate(16, 37, 0);
    rocket.push(body);
    const nose = new THREE.LatheGeometry(
      Array.from({ length: 12 }, (_, i) => {
        const t = i / 11;
        return new THREE.Vector2(3 * Math.cos((t * Math.PI) / 2) ** 0.8, t * 12);
      }),
      24,
    );
    nose.translate(16, 72, 0);
    rocket.push(nose);
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.BoxGeometry(0.5, 9, 4);
      fin.translate(0, 4.5, 4.5);
      fin.rotateY((i * Math.PI) / 2 + Math.PI / 4);
      fin.translate(16, 0, 0);
      rocket.push(fin);
    }
    const rocketGeo = mergeGeometries(rocket, false);
    for (const g of rocket) g.dispose();
    if (rocketGeo) {
      complex.add(new THREE.Mesh(rocketGeo, bone));
      this.geometries.push(rocketGeo);
    }
    const bands: THREE.BufferGeometry[] = [];
    for (const y of [22, 50]) {
      const b = new THREE.CylinderGeometry(3.05, 3.05, 2.2, 24, 1, true);
      b.translate(16, y, 0);
      bands.push(b);
    }
    const bandGeo = mergeGeometries(bands, false);
    for (const g of bands) g.dispose();
    if (bandGeo) {
      complex.add(new THREE.Mesh(bandGeo, stripe));
      this.geometries.push(bandGeo);
    }
    // Pad + headland it stands on.
    const pad = new THREE.CylinderGeometry(40, 55, 8, 24);
    pad.translate(6, -4, 0);
    complex.add(new THREE.Mesh(pad, metal));
    this.geometries.push(pad);
    // Place it across the bay, left of the sun.
    complex.position.set(112, -2, -196);
    complex.scale.setScalar(0.5);
    complex.rotation.y = -0.6;
    this.scene.add(complex);
    this.statics.push(complex);
    // Low headland silhouettes along the horizon.
    const hills: THREE.BufferGeometry[] = [];
    for (const [x, z, s] of [
      [-260, -420, 1.4],
      [-40, -520, 1.9],
      [180, -470, 1.2],
      [-420, -250, 1.1],
    ] as const) {
      const hill = new THREE.SphereGeometry(60, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      hill.scale(s * 1.8, s * 0.35, s);
      hill.translate(x, -1, z);
      hills.push(hill);
    }
    const hillGeo = mergeGeometries(hills, false);
    for (const g of hills) g.dispose();
    if (hillGeo) this.addMesh(hillGeo, metal, false);
  }

  private buildDust(): void {
    const q = this.app.engine?.quality;
    const count = Math.round(160 * (q?.particles ?? 0.6));
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 9;
      pos[i * 3 + 1] = Math.random() * 4;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 7;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geometries.push(g);
    const sprite = this.makeBlobTexture(true);
    const m = this.own(
      new THREE.PointsMaterial({ size: 0.05, map: sprite, color: new THREE.Color('#ffd9a0').multiplyScalar(1.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: 0.8 }),
    );
    this.dust = new THREE.Points(g, m);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  private makeBlobTexture(soft = false): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    if (ctx) {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(soft ? 0.25 : 0.45, `rgba(255,255,255,${soft ? 0.6 : 0.7})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private addMesh(g: THREE.BufferGeometry, m: THREE.Material, receive: boolean): THREE.Mesh {
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = receive;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.scene.add(mesh);
    this.geometries.push(g);
    return mesh;
  }

  private own<T extends THREE.Material>(m: T): T {
    this.ownedMaterials.push(m);
    return m;
  }

  // ── Character & weapon ──────────────────────────────────────────────────

  private scheduleRefresh(): void {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildTimer = 0;
      this.refresh(false);
    }, 60);
  }

  /** Rebuilds the character (cosmetics/faction change) and the weapon display. */
  refresh(force: boolean): void {
    const p = this.app.profile.value;
    const pv = this.preview;
    const faction = (pv?.faction ?? p.faction) as Faction;
    const cosmetics: CosmeticSelection = { ...p.cosmetics, ...(pv?.cosmetics ?? {}), skins: { ...p.cosmetics.skins } };
    const primary: WeaponId = pv?.weapon?.id ?? p.loadout.primary;
    const skin = pv?.weapon?.skin ?? p.cosmetics.skins[primary] ?? 'factory';
    if (pv?.weapon) cosmetics.skins[primary] = skin;
    const key = JSON.stringify([faction, cosmetics.armor, cosmetics.visor, cosmetics.elimFx, this.app.engine?.quality.preset]);
    if (force || key !== this.charKey) {
      this.charKey = key;
      this.character?.dispose();
      if (this.character) this.scene.remove(this.character.root);
      this.character = null;
      try {
        const q = this.app.engine.quality;
        const view: CharacterView = this.app.characters.create({
          faction,
          team: faction as Team,
          cosmetics,
          friendly: true,
          quality: q,
          showcase: true,
        });
        view.root.position.set(0, this.platformTop, 0);
        view.root.traverse((o: THREE.Object3D) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = true;
        });
        this.scene.add(view.root);
        this.character = view;
        this.weaponKey = '';
        this.elimTimer = 0;
        if (this.fallback) {
          this.scene.remove(this.fallback);
          this.fallback = null;
        }
      } catch (err) {
        console.warn('[menu-scene] character factory unavailable', err);
        if (!this.fallback) this.fallback = this.buildFallbackFigure(faction);
      }
    }
    const wKey = `${primary}:${skin}`;
    if (wKey !== this.weaponKey) {
      this.weaponKey = wKey;
      this.anim.weapon = primary;
      try {
        this.character?.setWeapon(primary, skin);
      } catch (err) {
        console.warn('[menu-scene] setWeapon failed', err);
      }
      this.weaponModel?.dispose();
      if (this.weaponModel) this.weaponCenter.remove(this.weaponModel.root);
      this.weaponModel = null;
      try {
        // The first-person model: printed decals, the live ammo screen and dial.
        const model = this.app.weapons.create(primary, skin, 'view') as WeaponModel & { tick?: (dt: number) => void };
        const root = model.root;
        root.position.set(0, 0, 0);
        root.rotation.set(0, 0, 0);
        root.scale.setScalar(1);
        root.updateMatrixWorld(true);
        // Center on the pivot and normalise the size so a pistol and a rifle both fill the frame.
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const k = THREE.MathUtils.clamp(0.95 / Math.max(0.2, size.z), 0.9, 2.4);
        root.position.copy(center).multiplyScalar(-1);
        this.weaponCenter.scale.setScalar(k);
        root.traverse((o) => {
          o.castShadow = false;
          o.frustumCulled = false;
        });
        this.weaponCenter.add(root);
        const mag = WEAPON_MAG[primary];
        model.setAmmo(mag, mag);
        this.weaponModel = model;
      } catch (err) {
        console.warn('[menu-scene] weapon model unavailable', err);
      }
    }
  }

  /** Graceful stand-in if the character factory is unavailable (never shown when it works). */
  private buildFallbackFigure(faction: 0 | 1): THREE.Group {
    const g = new THREE.Group();
    const armor = this.own(new THREE.MeshStandardMaterial({ color: faction === 0 ? '#ece6da' : '#7d8a78', roughness: 0.45 }));
    const visor = this.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(faction === 0 ? '#ff9a4a' : '#3ff2e1').multiplyScalar(2) }));
    const body = new THREE.CapsuleGeometry(0.32, 0.8, 6, 16);
    body.translate(0, 0.95, 0);
    const head = new THREE.SphereGeometry(0.2, 20, 14);
    head.translate(0, 1.62, 0);
    const band = new THREE.TorusGeometry(0.19, 0.025, 6, 24, Math.PI);
    band.rotateY(Math.PI);
    band.rotateX(Math.PI / 2);
    band.translate(0, 1.64, 0.02);
    this.geometries.push(body, head, band);
    g.add(new THREE.Mesh(body, armor), new THREE.Mesh(head, armor), new THREE.Mesh(band, visor));
    g.position.set(0, this.platformTop, 0);
    this.scene.add(g);
    return g;
  }

  // ── Per frame ────────────────────────────────────────────────────────────

  update(dt: number): void {
    if (!this.active) return;
    this.time += dt;
    const want = this.focus === 'customize' && this.weaponShowcase ? FRAMING.skins : framingFor(this.focus);
    const size = this.app.engine?.size;
    const k = 1 - Math.exp(-dt * 3.2);
    const c = this.cur;
    c.tx += (want.tx - c.tx) * k;
    c.ty += (want.ty - c.ty) * k;
    c.tz += (want.tz - c.tz) * k;
    c.radius += (want.radius - c.radius) * k;
    c.height += (want.height - c.height) * k;
    c.fov += (want.fov - c.fov) * k;
    c.angle += (want.angle - c.angle) * k;
    c.swing += (want.swing - c.swing) * k;
    c.screenX += (want.screenX - c.screenX) * k;

    const theta = c.angle + Math.sin(this.time * 0.11) * c.swing;
    const cam = this.camera;
    cam.position.set(c.tx + Math.sin(theta) * c.radius, c.height + Math.sin(this.time * 0.23) * 0.05, c.tz + Math.cos(theta) * c.radius);
    this.target.set(c.tx, c.ty, c.tz);
    cam.lookAt(this.target);
    if (Math.abs(cam.fov - c.fov) > 0.01) {
      cam.fov = c.fov;
      cam.updateProjectionMatrix();
    }
    // Slide the subject to the free side of the UI (mirrored in RTL).
    if (size && size.width > 0) {
      const sx = i18n.dir === 'rtl' ? 1 - c.screenX : c.screenX;
      // Narrow (portrait-ish) screens keep the subject nearer the centre.
      const narrow = size.aspect < 1.2 ? 0.5 : 1;
      const f = 0.5 + (sx - 0.5) * narrow;
      cam.setViewOffset(size.width, size.height, (0.5 - f) * size.width, 0, size.width, size.height);
    }

    // Character idle (faces the camera's average position).
    // Three-quarter stance: the weapon points past the camera toward the
    // middle of the screen (mirrored with the layout in RTL), never at the viewer.
    this.anim.yaw = Math.PI + c.angle * 0.6 + (i18n.dir === 'rtl' ? 0.55 : -0.55);
    try {
      this.character?.update(dt, this.anim);
    } catch {
      /* keep the menu alive even if the character animation throws */
    }
    if (this.fallback) this.fallback.rotation.y = c.angle * 0.6;

    // Weapon showcase: floats in the free strip between the UI panel and the
    // hero (placed in screen space, so it works for every aspect and RTL), held
    // in a slowly breathing 3/4 profile with the muzzle toward the UI.
    const showWeapon = (this.focus === 'loadout' || (this.focus === 'customize' && this.weaponShowcase)) && !!this.weaponModel;
    this.weaponPivot.visible = showWeapon;
    if (showWeapon) {
      const rtl = i18n.dir === 'rtl';
      const narrow = (size?.aspect ?? 1.7) < 1.2;
      const sxL = narrow ? 0.5 : this.focus === 'loadout' ? 0.72 : 0.74;
      const sx = rtl ? 1 - sxL : sxL;
      cam.updateMatrixWorld();
      this.camBack.set(sx * 2 - 1, -(0.57 * 2 - 1), 0.5).unproject(cam).sub(cam.position).normalize();
      const dist = Math.max(2, c.radius - 1.4);
      this.weaponPivot.position.copy(cam.position).addScaledVector(this.camBack, dist);
      this.weaponPivot.position.y += Math.sin(this.time * 1.1) * 0.025;
      // Azimuth from the weapon back to the camera → muzzle points screen-side toward the UI.
      const toCam = Math.atan2(-this.camBack.x, -this.camBack.z);
      const face = toCam + (rtl ? -Math.PI / 2 : Math.PI / 2);
      const sway = rtl ? -1 : 1;
      this.weaponPivot.rotation.set(0.06 + Math.sin(this.time * 0.37) * 0.04, face + Math.sin(this.time * 0.42) * 0.5 * sway, Math.sin(this.time * 0.29) * 0.05);
      this.weaponModel?.tick?.(dt);
    }

    // Elimination preview: effects run, then the hero re-materializes.
    if (this.effects) this.effects.update(dt, cam);
    if (this.elimTimer > 0) {
      this.elimTimer -= dt;
      if (this.elimTimer <= 0) this.character?.respawn();
    }

    // Dust drift.
    if (this.dust) {
      const arr = (this.dust.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] += dt * (0.12 + Math.sin(this.time * 0.3 + i) * 0.05);
        arr[i + 1] += dt * (0.04 + Math.sin(this.time * 0.7 + i * 0.37) * 0.05);
        if (arr[i] > 4.5) arr[i] = -4.5;
        if (arr[i + 1] > 4) arr[i + 1] = 0;
      }
      (this.dust.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }

    this.rocket?.update(dt, null, this.time);
    this.atmosphere?.update(dt, cam, 0);
  }
}

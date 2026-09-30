// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — procedural weapon models (premium 1970s industrial design).
//
// Braun / Olivetti / NASA hardware language: rounded ceramic shells over
// rounded metal receivers, knurled grips, a cream analog dial and a tiny
// amber ammo-counter screen on every weapon. Each gun has a distinct
// silhouette:
//   Meridian  AR   — balanced, reflex tube sight, curved accent magazine
//   Swift     SMG  — compact, top-mounted pan drum, wire stock, foregrip
//   Longline  DMR  — long fluted barrel, bell scope, bolt handle, cheek rest
//   Breaker   pump — chunky, twin tubes, wood/ceramic pump, side shell caddy
//   Pulse     side — compact frame, swing-out cell cylinder, copper coil
//   Sunspear  beam — bulky shell, glowing capacitor rings, gold lens
//
// Local space: origin at the grip/trigger, muzzle toward −Z, +Y up, meters.
// Moving parts are exposed in `parts` with pivots placed where they hinge or
// slide. Static pieces are merged per material (moving parts stay separate);
// 'world' LOD also uses fewer segments (≈5 draw calls per third-person weapon). Geometries are cached
// module-wide and shared by every instance; materials are cached per skin.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MaterialLibrary, WeaponModel, WeaponModelFactory } from '../contracts';
import type { WeaponId } from '../../shared/types';
import { findSkin, type WeaponSkin } from '../../shared/cosmetics';
import { ENV, PICKUP_COLOR } from '../engine/palette';
import { proceduralTexture, makeCanvas } from '../engine/textures';

export type WeaponLod = 'view' | 'world';

/** Extra (non-contract) members the viewmodel/characters use. */
export interface WeaponModelView extends WeaponModel {
  readonly id: WeaponId;
  readonly lod: WeaponLod;
  /** Point on the line of sight (rear aperture / scope eyepiece). */
  readonly sight: THREE.Object3D;
  /** Hand anchors (+Z of the anchor = back of the hand). */
  readonly handR: THREE.Object3D;
  readonly handL: THREE.Object3D;
  /** Sunspear heat vents (open after a shot). */
  readonly vents: THREE.Object3D[];
}

// ── Shared resources ────────────────────────────────────────────────────────

const geoCache = new Map<string, THREE.BufferGeometry>();
const mergedCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.Material>();
const texCache = new Map<string, THREE.Texture>();

type Slot = 'shell' | 'accent' | 'metal' | 'dark' | 'grip' | 'wood' | 'glass' | 'glow' | 'dial' | 'brass' | 'copper' | 'screen';

const AMBER = '#ffb347';

function geo(lod: WeaponLod, key: string, make: (seg: number) => THREE.BufferGeometry, ownUV = false): THREE.BufferGeometry {
  const k = `${lod}|${key}`;
  let g = geoCache.get(k);
  if (!g) {
    g = make(lod === 'view' ? 1 : 0);
    if (g.index) g = g.toNonIndexed();
    if (!ownUV) weaponUV(g);
    if (!g.attributes.normal) g.computeVertexNormals();
    // Keep attribute sets uniform so world-LOD pieces can be merged.
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    geoCache.set(k, g);
  }
  return g;
}

/** Box-projected UVs in weapon space (0.25 m per repeat). u follows Z on sides/tops. */
function weaponUV(g: THREE.BufferGeometry): void {
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute | undefined;
  if (!n) g.computeVertexNormals();
  const nn = g.attributes.normal as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(nn.getX(i)), ay = Math.abs(nn.getY(i)), az = Math.abs(nn.getZ(i));
    let u: number, v: number;
    if (ax >= ay && ax >= az) {
      u = p.getZ(i);
      v = p.getY(i);
    } else if (ay >= az) {
      u = p.getZ(i);
      v = p.getX(i);
    } else {
      u = p.getX(i);
      v = p.getY(i);
    }
    uv[i * 2] = u * 4;
    uv[i * 2 + 1] = v * 4;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

const rbox = (w: number, h: number, d: number, r: number) => (seg: number) => new RoundedBoxGeometry(w, h, d, seg ? 3 : 1, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
/** Cylinder along Z. */
const cylZ = (rt: number, rb: number, len: number, rs = 16) => (seg: number) => new THREE.CylinderGeometry(rt, rb, len, seg ? rs : Math.max(6, rs >> 1), 1).rotateX(Math.PI / 2);
const cylX = (r: number, len: number, rs = 12) => (seg: number) => new THREE.CylinderGeometry(r, r, len, seg ? rs : 6, 1).rotateZ(Math.PI / 2);
const cylY = (r: number, len: number, rs = 20) => (seg: number) => new THREE.CylinderGeometry(r, r, len, seg ? rs : 8, 1);
const torusZ = (r: number, tube: number) => (seg: number) => new THREE.TorusGeometry(r, tube, seg ? 8 : 4, seg ? 24 : 10);
const sphere = (r: number) => (seg: number) => new THREE.SphereGeometry(r, seg ? 12 : 6, seg ? 8 : 4);
/** Lathe around Z from (radius, z) points (any order; outward winding is enforced). */
const latheZ = (pts: [number, number][], rs = 20) => (seg: number) => {
  const ordered = pts[0][1] > pts[pts.length - 1][1] ? [...pts].reverse() : pts;
  return new THREE.LatheGeometry(ordered.map(([r, z]) => new THREE.Vector2(r, z)), seg ? rs : 8).rotateX(-Math.PI / 2);
};

/** Thick-walled open tube along Z (reflex sight housings, rings). */
const tubeZ = (rIn: number, rOut: number, len: number) => (seg: number) =>
  new THREE.LatheGeometry(
    [
      new THREE.Vector2(rIn, len / 2),
      new THREE.Vector2(rOut, len / 2),
      new THREE.Vector2(rOut, -len / 2),
      new THREE.Vector2(rIn, -len / 2),
      new THREE.Vector2(rIn, len / 2),
    ],
    seg ? 28 : 10,
  ).rotateX(-Math.PI / 2);

/** Profile point: (u = forward along −Z, v = up, optional corner radius). */
type PP = [number, number, number?];

function roundedShape(pts: PP[], holes: PP[][] = []): THREE.Shape {
  const trace = (path: THREE.Path, list: PP[]): void => {
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const [x, y, r = 0] = list[i];
      if (r <= 0) {
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
        continue;
      }
      const p = list[(i - 1 + n) % n];
      const q = list[(i + 1) % n];
      const d1 = Math.hypot(p[0] - x, p[1] - y) || 1;
      const d2 = Math.hypot(q[0] - x, q[1] - y) || 1;
      const rr = Math.min(r, d1 * 0.48, d2 * 0.48);
      const ax = x + ((p[0] - x) / d1) * rr, ay = y + ((p[1] - y) / d1) * rr;
      const bx = x + ((q[0] - x) / d2) * rr, by = y + ((q[1] - y) / d2) * rr;
      if (i === 0) path.moveTo(ax, ay);
      else path.lineTo(ax, ay);
      path.quadraticCurveTo(x, y, bx, by);
    }
    path.closePath();
  };
  const shape = new THREE.Shape();
  trace(shape, pts);
  for (const h of holes) {
    const hp = new THREE.Path();
    trace(hp, h);
    shape.holes.push(hp);
  }
  return shape;
}

/**
 * Side-profile extrusion: the silhouette is drawn in (u, v) = (forward, up)
 * and extruded across X (`width`), with soft bevels and smooth normals — the
 * rounded ceramic-shell look of 1970s industrial design.
 */
const profile = (pts: PP[], width: number, bevel = 0.006, holes: PP[][] = []) => (seg: number) => {
  const depth = Math.max(0.002, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(roundedShape(pts, holes), {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.9,
    bevelSegments: seg ? 3 : 1,
    curveSegments: seg ? 6 : 2,
  });
  // (u, v, extrude) → (x = extrude − depth/2, y = v, z = −u)
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -depth / 2, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1));
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const m = mergeVertices(g, 1e-5);
  g.dispose();
  m.computeVertexNormals();
  return m;
};

// ── Canvas textures ─────────────────────────────────────────────────────────

let dialTex: THREE.Texture | null = null;
function dialTexture(): THREE.Texture {
  if (dialTex) return dialTex;
  const s = 128;
  const c = makeCanvas(s, s);
  const x = c.getContext('2d') as CanvasRenderingContext2D;
  const g = x.createRadialGradient(s * 0.45, s * 0.4, 4, s / 2, s / 2, s / 2);
  g.addColorStop(0, '#f7f0e2');
  g.addColorStop(1, '#ddd1bb');
  x.fillStyle = g;
  x.beginPath();
  x.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
  x.fill();
  // 270° scale with a warm red low zone.
  x.translate(s / 2, s / 2);
  for (let i = 0; i <= 30; i++) {
    const a = -Math.PI * 1.25 + (i / 30) * Math.PI * 1.5;
    const major = i % 5 === 0;
    x.strokeStyle = i < 5 ? '#c4552f' : '#2a2622';
    x.lineWidth = major ? 3.2 : 1.6;
    x.beginPath();
    x.moveTo(Math.cos(a) * s * 0.44, Math.sin(a) * s * 0.44);
    x.lineTo(Math.cos(a) * s * (major ? 0.33 : 0.38), Math.sin(a) * s * (major ? 0.33 : 0.38));
    x.stroke();
  }
  x.fillStyle = '#2a2622';
  x.beginPath();
  x.arc(0, 0, s * 0.06, 0, Math.PI * 2);
  x.fill();
  dialTex = new THREE.CanvasTexture(c);
  dialTex.colorSpace = THREE.SRGBColorSpace;
  return dialTex;
}

let staticScreenTex: THREE.Texture | null = null;
function drawScreen(ctx: CanvasRenderingContext2D, w: number, h: number, mag: number, magSize: number): void {
  ctx.fillStyle = '#110c09';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,179,71,0.05)';
  for (let y = 0; y < h; y += 2) ctx.fillRect(0, y, w, 1);
  const txt = String(Math.max(0, Math.min(999, Math.round(mag)))).padStart(2, '0');
  ctx.font = `700 ${Math.round(h * 0.62)}px "JetBrains Mono", ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = AMBER;
  ctx.shadowBlur = 5;
  ctx.fillStyle = mag <= 0 ? '#8a5a2a' : AMBER;
  ctx.fillText(txt, w * 0.5, h * 0.42);
  ctx.shadowBlur = 0;
  const f = magSize > 0 ? Math.max(0, Math.min(1, mag / magSize)) : 0;
  ctx.fillStyle = 'rgba(255,179,71,0.25)';
  ctx.fillRect(4, h - 6, w - 8, 3);
  ctx.fillStyle = AMBER;
  ctx.fillRect(4, h - 6, (w - 8) * f, 3);
}
function staticScreenTexture(): THREE.Texture {
  if (staticScreenTex) return staticScreenTex;
  const c = makeCanvas(64, 32);
  drawScreen(c.getContext('2d') as CanvasRenderingContext2D, 64, 32, 30, 30);
  staticScreenTex = new THREE.CanvasTexture(c);
  staticScreenTex.colorSpace = THREE.SRGBColorSpace;
  return staticScreenTex;
}

const LABELS: Record<WeaponId, [string, string]> = {
  meridian: ['MERIDIAN', 'HF·AR 7'],
  swift: ['SWIFT', 'HF·SM 3'],
  longline: ['LONGLINE', 'HF·MR 12'],
  breaker: ['BREAKER', 'HF·PG 4'],
  pulse: ['PULSE', 'HF·SA 2'],
  sunspear: ['SUNSPEAR', 'HELIOS·X'],
};

function labelMaterial(id: WeaponId): THREE.Material {
  const key = `label|${id}`;
  let m = matCache.get(key);
  if (m) return m;
  const c = makeCanvas(256, 56);
  const x = c.getContext('2d') as CanvasRenderingContext2D;
  x.clearRect(0, 0, 256, 56);
  x.fillStyle = '#3a3632';
  x.font = '700 26px "Space Grotesk", "Helvetica Neue", Arial, sans-serif';
  x.textBaseline = 'middle';
  x.fillText(LABELS[id][0], 30, 22);
  x.font = '500 15px "JetBrains Mono", ui-monospace, monospace';
  x.fillStyle = '#6a635b';
  x.fillText(LABELS[id][1], 30, 45);
  x.fillStyle = '#d9a441';
  x.fillRect(4, 10, 16, 16);
  x.fillStyle = '#3a3632';
  x.fillRect(4, 32, 16, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  m = new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.35, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  m.userData.slot = 'label';
  matCache.set(key, m);
  return m;
}

function patternTexture(skin: WeaponSkin): THREE.Texture | null {
  const cached = texCache.get(skin.id);
  if (cached) return cached;
  if (skin.pattern === 'plain') return null;
  const s = 256;
  const c = makeCanvas(s, s);
  const x = c.getContext('2d') as CanvasRenderingContext2D;
  x.fillStyle = skin.shell;
  x.fillRect(0, 0, s, s);
  let rnd = 1234;
  const r = (): number => ((rnd = (Math.imul(rnd, 1664525) + 1013904223) >>> 0) / 4294967296);
  if (skin.pattern === 'stripes') {
    x.fillStyle = skin.accent;
    for (let i = -2; i < 4; i++) {
      x.save();
      x.translate(i * s * 0.5, 0);
      x.beginPath();
      x.moveTo(0, 0);
      x.lineTo(s * 0.12, 0);
      x.lineTo(s * 0.12 + s, s);
      x.lineTo(s, s);
      x.closePath();
      x.fill();
      x.restore();
    }
  } else if (skin.pattern === 'patina') {
    for (let i = 0; i < 260; i++) {
      x.fillStyle = r() < 0.5 ? 'rgba(232,217,176,0.16)' : 'rgba(60,90,80,0.14)';
      x.beginPath();
      x.ellipse(r() * s, r() * s, 4 + r() * 22, 3 + r() * 14, r() * Math.PI, 0, Math.PI * 2);
      x.fill();
    }
  } else if (skin.pattern === 'speckle') {
    for (let i = 0; i < 900; i++) {
      x.fillStyle = r() < 0.6 ? skin.accent : skin.metal;
      x.beginPath();
      x.arc(r() * s, r() * s, 0.6 + r() * 1.8, 0, Math.PI * 2);
      x.fill();
    }
  } else if (skin.pattern === 'gradient') {
    const g = x.createLinearGradient(0, s, 0, 0);
    g.addColorStop(0, skin.accent);
    g.addColorStop(0.45, skin.shell);
    g.addColorStop(1, skin.shell);
    x.fillStyle = g;
    x.fillRect(0, 0, s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = skin.pattern === 'gradient' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  if (skin.pattern === 'gradient') {
    // v = y·4 → map y ∈ [−0.06, 0.16] onto the gradient.
    t.repeat.set(1, 1 / 0.88);
    t.offset.set(0, 0.24 / 0.88);
  }
  texCache.set(skin.id, t);
  return t;
}

function materialFor(skin: WeaponSkin, lod: WeaponLod, slot: Slot): THREE.Material {
  const key = `${skin.id}|${lod}|${slot}`;
  let m = matCache.get(key);
  if (m) return m;
  const metalness = lod === 'view' ? 0.6 : 0.3;
  switch (slot) {
    case 'shell': {
      const pat = patternTexture(skin);
      m = new THREE.MeshStandardMaterial({
        color: pat ? 0xffffff : new THREE.Color(skin.shell),
        map: pat ?? proceduralTexture('ceramic', 256, 4),
        roughness: 0.36,
        metalness: 0,
      });
      break;
    }
    case 'accent':
      m = new THREE.MeshStandardMaterial({ color: new THREE.Color(skin.accent), roughness: 0.4, metalness: 0.05, map: proceduralTexture('wear', 256, 4) });
      break;
    case 'metal':
      m = new THREE.MeshStandardMaterial({ color: new THREE.Color(skin.metal), roughness: 0.38, metalness, map: proceduralTexture('metal', 256, 4) });
      break;
    case 'dark':
      m = new THREE.MeshStandardMaterial({ color: new THREE.Color(skin.metal).multiplyScalar(0.45), roughness: 0.5, metalness: metalness * 0.7 });
      break;
    case 'grip': {
      const t = proceduralTexture('knurl', 64, 4).clone();
      t.needsUpdate = true;
      t.repeat.set(3, 3);
      m = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3e3a36'), roughness: 0.75, metalness: 0.2, map: t, bumpMap: lod === 'view' ? t : null, bumpScale: 0.6 });
      break;
    }
    case 'wood':
      m = new THREE.MeshStandardMaterial({ color: new THREE.Color('#a57c5a'), roughness: 0.55, map: proceduralTexture('wood', 256, 4) });
      break;
    case 'glass':
      m = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1c2433'), roughness: 0.06, metalness: 0.3, emissive: new THREE.Color('#3a2a52'), emissiveIntensity: 0.35 });
      break;
    case 'glow':
      m = new THREE.MeshBasicMaterial({ color: new THREE.Color(PICKUP_COLOR).multiplyScalar(2.2) });
      break;
    case 'dial':
      m = new THREE.MeshStandardMaterial({ map: dialTexture(), roughness: 0.3, emissive: new THREE.Color('#fff4df'), emissiveIntensity: 0.12, emissiveMap: dialTexture() });
      break;
    case 'brass':
      m = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a25a'), roughness: 0.3, metalness: 0.8 });
      break;
    case 'copper':
      m = new THREE.MeshStandardMaterial({ color: new THREE.Color('#b87a55'), roughness: 0.32, metalness: 0.75, emissive: new THREE.Color(AMBER), emissiveIntensity: 0.25 });
      break;
    case 'screen':
      m = new THREE.MeshBasicMaterial({ map: staticScreenTexture(), color: new THREE.Color(1.8, 1.8, 1.8) });
      break;
  }
  m.userData.slot = slot;
  m.name = `weapon.${slot}.${skin.id}`;
  matCache.set(key, m);
  return m;
}

// ── Builder ─────────────────────────────────────────────────────────────────

class Build {
  readonly root = new THREE.Group();
  readonly parts: WeaponModel['parts'] = {};
  readonly muzzle = new THREE.Object3D();
  readonly sight = new THREE.Object3D();
  readonly handR = new THREE.Object3D();
  readonly handL = new THREE.Object3D();
  readonly vents: THREE.Object3D[] = [];
  /** Subtrees that must stay separate (animated). */
  readonly dynamic = new Set<THREE.Object3D>();
  screenMesh: THREE.Mesh | null = null;
  dialNeedle: THREE.Object3D | null = null;
  chargeMats: THREE.MeshStandardMaterial[] = [];

  constructor(readonly id: WeaponId, readonly lod: WeaponLod, readonly skin: WeaponSkin) {
    this.root.name = `weapon.${id}.${lod}`;
    this.muzzle.name = 'muzzle';
    this.root.add(this.muzzle, this.sight, this.handR, this.handL);
  }

  m(slot: Slot): THREE.Material {
    return materialFor(this.skin, this.lod, slot);
  }

  add(parent: THREE.Object3D, key: string, make: (seg: number) => THREE.BufferGeometry, slot: Slot | THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(geo(this.lod, `${this.id}.${key}`, make), typeof slot === 'string' ? this.m(slot) : slot);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    parent.add(mesh);
    return mesh;
  }

  group(parent: THREE.Object3D, name: string, x = 0, y = 0, z = 0, dynamic = true): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    if (dynamic) this.dynamic.add(g);
    return g;
  }

  /** Analog dial facing −X (the side the player sees) with a pivoting needle. */
  dial(x: number, y: number, z: number, r: number): void {
    const g = this.group(this.root, 'dialHousing', x, y, z, false);
    g.rotation.y = -Math.PI / 2;
    this.add(g, `dialBezel${r}`, torusZ(r, r * 0.16), 'metal', 0, 0, 0.002);
    const face = new THREE.Mesh(geo(this.lod, `dialFace${r}`, (seg) => new THREE.CircleGeometry(r, seg ? 28 : 12), true), this.m('dial'));
    face.position.z = 0.001;
    g.add(face);
    const needle = this.group(g, 'dialNeedle', 0, 0, 0.004, true);
    this.add(needle, `needle${r}`, rbox(r * 0.12, r * 0.85, 0.002, 0.0008), 'accent', 0, r * 0.38, 0);
    needle.rotation.z = Math.PI * 0.75;
    this.parts.dial = needle;
    this.dialNeedle = needle;
  }

  /** Ammo screen: `rx` tilts it toward the eye. */
  screen(x: number, y: number, z: number, w: number, h: number, rx: number, ry = 0): void {
    const housing = this.group(this.root, 'screenHousing', x, y, z, false);
    housing.rotation.set(rx, ry, 0);
    this.add(housing, `screenBezel${w}`, rbox(w + 0.008, h + 0.008, 0.008, 0.003), 'dark', 0, 0, -0.003);
    const plane = new THREE.Mesh(geo(this.lod, `screenPlane${w}x${h}`, () => new THREE.PlaneGeometry(w, h), true), this.m('screen'));
    plane.position.z = 0.0015;
    housing.add(plane);
    this.screenMesh = plane;
    this.parts.screen = plane;
  }

  /** Small printed model label on the left side (Braun-style typography). */
  label(x: number, y: number, z: number, w: number): void {
    if (this.lod !== 'view') return;
    const h = w * 0.22;
    const plane = new THREE.Mesh(geo(this.lod, `label${w}`, () => new THREE.PlaneGeometry(w, h), true), labelMaterial(this.id));
    plane.position.set(x, y, z);
    plane.rotation.y = -Math.PI / 2;
    this.root.add(plane);
  }

  hands(r: [number, number, number, number], l: [number, number, number, number]): void {
    this.handR.position.set(r[0], r[1], r[2]);
    this.handR.rotation.x = r[3];
    this.handL.position.set(l[0], l[1], l[2]);
    this.handL.rotation.x = l[3];
  }
}

// ── Weapon designs ──────────────────────────────────────────────────────────

/** Angled knurled pistol grip whose top-front sits at (u, v). */
function pistolGrip(b: Build, key: string, u: number, v: number, len = 0.118): void {
  b.add(b.root, `${key}.grip`, profile([[u + 0.03, v, 0.004], [u - 0.002, v - len, 0.016], [u - 0.046, v - len + 0.006, 0.016], [u - 0.022, v, 0.004]], 0.034, 0.006), 'grip');
}

/** Trigger + guard loop in front of the grip. */
function triggerGroup(b: Build, key: string, u: number, v: number): void {
  b.add(
    b.root,
    `${key}.guard`,
    profile([[u + 0.075, v, 0], [u + 0.075, v - 0.05, 0.02], [u - 0.005, v - 0.052, 0.012], [u - 0.005, v, 0]], 0.012, 0.003, [
      [[u + 0.063, v - 0.006, 0.004], [u + 0.063, v - 0.04, 0.014], [u + 0.006, v - 0.042, 0.008], [u + 0.006, v - 0.006, 0.004]],
    ]),
    'dark',
  );
  b.add(b.root, `${key}.trigger`, rbox(0.008, 0.028, 0.01, 0.003), 'metal', 0, v - 0.018, -(u + 0.035), 0.35);
}

function buildMeridian(b: Build): void {
  const R = b.root;
  // Lower receiver (metal core) under the ceramic upper.
  b.add(R, 'lower', profile([[-0.07, -0.03, 0.01], [-0.07, 0.02, 0], [0.22, 0.02, 0], [0.22, -0.018, 0.012], [0.15, -0.034, 0.01], [-0.02, -0.034, 0.01]], 0.06), 'dark');
  b.add(R, 'upper', profile([[-0.105, 0.012, 0.01], [-0.105, 0.088, 0.03], [-0.075, 0.118, 0.02], [0.19, 0.118, 0.02], [0.228, 0.094, 0.025], [0.228, 0.012, 0.01]], 0.076), 'shell');
  b.add(R, 'rail', rbox(0.05, 0.016, 0.3, 0.005), 'metal', 0, 0.128, -0.06);
  for (let i = 0; i < 6; i++) b.add(R, 'railTooth', rbox(0.054, 0.006, 0.012, 0.002), 'dark', 0, 0.136, 0.05 - i * 0.045);
  b.add(R, 'guard', profile([[0.228, 0.016, 0.01], [0.228, 0.1, 0.012], [0.49, 0.092, 0.03], [0.518, 0.07, 0.02], [0.518, 0.028, 0.02], [0.49, 0.008, 0.02]], 0.068), 'shell');
  for (let i = 0; i < 3; i++) b.add(R, 'slot', rbox(0.071, 0.011, 0.07, 0.005), 'dark', 0, 0.074 - i * 0.02, -0.36);
  b.add(R, 'joint', rbox(0.074, 0.092, 0.012, 0.012), 'accent', 0, 0.058, -0.232);
  b.add(R, 'barrel', cylZ(0.011, 0.011, 0.16), 'metal', 0, 0.055, -0.595);
  b.add(R, 'brake', cylZ(0.02, 0.02, 0.06), 'dark', 0, 0.055, -0.68);
  b.add(R, 'brakeRing', torusZ(0.02, 0.004), 'metal', 0, 0.055, -0.655);
  b.muzzle.position.set(0, 0.055, -0.715);
  pistolGrip(b, 'mer', -0.005, -0.028);
  triggerGroup(b, 'mer', 0.02, -0.03);
  // Stock with an accent cheek pad and a rubber butt.
  b.add(R, 'stock', profile([[-0.105, 0.105, 0.02], [-0.33, 0.086, 0.02], [-0.336, -0.022, 0.012], [-0.3, -0.036, 0.02], [-0.19, -0.004, 0.03], [-0.105, 0.012, 0.01]], 0.056), 'shell');
  b.add(R, 'cheek', rbox(0.05, 0.018, 0.13, 0.008), 'accent', 0, 0.1, 0.22, 0.09);
  b.add(R, 'butt', profile([[-0.328, 0.09, 0.008], [-0.356, 0.088, 0.008], [-0.362, -0.03, 0.008], [-0.334, -0.026, 0.008]], 0.06, 0.004), 'dark');
  // Curved magazine (pivot at the mag well).
  const mag = b.group(R, 'mag', 0, -0.02, -0.14);
  b.add(mag, 'magBody', profile([[-0.034, 0.01, 0], [0.036, 0.01, 0], [0.062, -0.125, 0.012], [0.004, -0.136, 0.012]], 0.03, 0.005), 'accent');
  b.add(mag, 'magBase', rbox(0.034, 0.012, 0.064, 0.004), 'dark', 0, -0.135, -0.034, 0.18);
  b.parts.mag = mag;
  // Charging handle (slides +Z).
  const bolt = b.group(R, 'bolt', 0.04, 0.095, -0.03);
  b.add(bolt, 'boltKnob', cylX(0.008, 0.026), 'metal', 0.012, 0, 0);
  b.add(bolt, 'boltCap', sphere(0.011), 'accent', 0.026, 0, 0);
  b.parts.bolt = bolt;
  // Reflex tube sight.
  b.add(R, 'sightBase', rbox(0.03, 0.024, 0.07, 0.006), 'metal', 0, 0.146, -0.02);
  b.add(R, 'sightTube', tubeZ(0.021, 0.027, 0.064), 'dark', 0, 0.182, -0.02);
  b.add(R, 'sightLens', (seg) => new THREE.CircleGeometry(0.021, seg ? 24 : 10).rotateY(Math.PI), 'glass', 0, 0.182, -0.05);
  b.add(R, 'sightRing', torusZ(0.026, 0.0045), 'accent', 0, 0.182, -0.052);
  b.add(R, 'sightDot', sphere(0.0022), 'glow', 0, 0.182, -0.045);
  b.sight.position.set(0, 0.182, 0.02);
  b.dial(-0.039, 0.064, -0.05, 0.019);
  b.label(-0.0395, 0.092, -0.14, 0.07);
  b.screen(-0.024, 0.124, 0.075, 0.044, 0.022, -0.75, -0.25);
  b.hands([0, -0.06, 0.02, 0.35], [-0.012, -0.012, -0.4, 0]);
}

function buildSwift(b: Build): void {
  const R = b.root;
  b.add(R, 'lower', profile([[-0.06, -0.03, 0.01], [-0.06, 0.02, 0], [0.16, 0.02, 0], [0.16, -0.02, 0.01], [0.1, -0.03, 0.01]], 0.056), 'dark');
  b.add(R, 'upper', profile([[-0.09, 0.01, 0.01], [-0.09, 0.085, 0.03], [-0.06, 0.1, 0.02], [0.12, 0.1, 0.02], [0.205, 0.072, 0.035], [0.205, 0.01, 0.01]], 0.07), 'shell');
  b.add(R, 'shroud', cylZ(0.026, 0.026, 0.12, 20), 'metal', 0, 0.05, -0.262);
  for (let i = 0; i < 4; i++) b.add(R, 'shroudRing', torusZ(0.026, 0.003), 'dark', 0, 0.05, -0.215 - i * 0.03);
  b.add(R, 'barrel', cylZ(0.011, 0.011, 0.05), 'dark', 0, 0.05, -0.345);
  b.muzzle.position.set(0, 0.05, -0.375);
  pistolGrip(b, 'swf', -0.005, -0.028, 0.11);
  triggerGroup(b, 'swf', 0.02, -0.03);
  b.add(R, 'foregrip', profile([[0.128, -0.02, 0.004], [0.176, -0.02, 0.004], [0.168, -0.105, 0.016], [0.126, -0.1, 0.016]], 0.034), 'shell');
  b.add(R, 'foregripCap', rbox(0.036, 0.012, 0.045, 0.005), 'accent', 0, -0.104, -0.148);
  // Folding wire stock.
  for (const x of [-0.024, 0.024]) b.add(R, 'wire', cylZ(0.0055, 0.0055, 0.22, 8), 'metal', x, 0.045, 0.19);
  b.add(R, 'wireBrace', cylX(0.005, 0.05, 8), 'metal', 0, 0.045, 0.14);
  b.add(R, 'buttPlate', rbox(0.066, 0.1, 0.016, 0.01), 'dark', 0, 0.035, 0.3);
  // Top-mounted pan drum (the magazine).
  const mag = b.group(R, 'mag', 0, 0.108, -0.05);
  b.add(mag, 'drum', cylY(0.078, 0.034, 32), 'accent', 0, 0.017, 0);
  b.add(mag, 'drumLid', cylY(0.07, 0.006, 32), 'shell', 0, 0.036, 0);
  b.add(mag, 'drumHub', cylY(0.02, 0.012, 16), 'metal', 0, 0.041, 0);
  b.add(mag, 'drumWinder', rbox(0.004, 0.008, 0.05, 0.002), 'dark', 0, 0.048, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add(mag, 'drumRib', rbox(0.006, 0.03, 0.012, 0.002), 'dark', Math.cos(a) * 0.078, 0.017, Math.sin(a) * 0.078, 0, -a);
  }
  b.parts.mag = mag;
  const bolt = b.group(R, 'bolt', -0.036, 0.07, -0.02);
  b.add(bolt, 'boltKnob', cylX(0.008, 0.02), 'metal', -0.008, 0, 0);
  b.parts.bolt = bolt;
  // Raised aperture sight clears the drum.
  b.add(R, 'sightPost', profile([[-0.07, 0.1, 0], [-0.04, 0.1, 0], [-0.052, 0.18, 0.008], [-0.068, 0.18, 0.008]], 0.018, 0.004), 'metal');
  b.add(R, 'sightRing', torusZ(0.016, 0.004), 'dark', 0, 0.19, 0.06);
  b.add(R, 'frontPost', rbox(0.006, 0.07, 0.01, 0.002), 'metal', 0, 0.12, -0.215);
  b.add(R, 'frontDot', sphere(0.003), 'glow', 0, 0.158, -0.215);
  b.sight.position.set(0, 0.19, 0.07);
  b.dial(-0.036, 0.052, -0.11, 0.017);
  b.label(-0.0365, 0.082, -0.01, 0.06);
  b.screen(-0.034, 0.068, 0.045, 0.036, 0.02, 0, -Math.PI / 2 + 0.35);
  b.hands([0, -0.06, 0.02, 0.33], [0, -0.05, -0.15, -0.1]);
}

function buildLongline(b: Build): void {
  const R = b.root;
  b.add(R, 'lower', profile([[-0.08, -0.03, 0.01], [-0.08, 0.02, 0], [0.25, 0.02, 0], [0.25, -0.02, 0.01], [0.16, -0.034, 0.01], [-0.02, -0.034, 0.01]], 0.058), 'dark');
  b.add(R, 'upper', profile([[-0.12, 0.01, 0.01], [-0.12, 0.085, 0.025], [-0.09, 0.105, 0.02], [0.24, 0.105, 0.02], [0.272, 0.084, 0.02], [0.272, 0.01, 0.01]], 0.07), 'shell');
  b.add(R, 'guard', profile([[0.272, 0.012, 0.01], [0.272, 0.095, 0.012], [0.6, 0.084, 0.03], [0.632, 0.06, 0.02], [0.632, 0.03, 0.02], [0.6, 0.012, 0.02]], 0.062), 'shell');
  b.add(R, 'joint', rbox(0.066, 0.086, 0.012, 0.012), 'accent', 0, 0.053, -0.276);
  for (let i = 0; i < 4; i++) b.add(R, 'guardSlot', rbox(0.064, 0.01, 0.05, 0.004), 'dark', 0, 0.06, -0.34 - i * 0.07);
  b.add(R, 'barrel', cylZ(0.014, 0.015, 0.34, 12), 'metal', 0, 0.05, -0.8);
  for (let i = 0; i < 3; i++) b.add(R, 'flute', rbox(0.031, 0.004, 0.26, 0.002), 'dark', 0, 0.05, -0.81, 0, 0, (i * Math.PI) / 3);
  b.add(R, 'brake', cylZ(0.02, 0.02, 0.07), 'dark', 0, 0.05, -1.0);
  b.add(R, 'brakeSlot', rbox(0.044, 0.008, 0.032, 0.003), 'metal', 0, 0.05, -0.995);
  b.muzzle.position.set(0, 0.05, -1.04);
  for (const x of [-0.018, 0.018]) b.add(R, 'bipod', cylZ(0.005, 0.005, 0.26, 6), 'dark', x, 0.004, -0.47);
  pistolGrip(b, 'lng', -0.005, -0.028, 0.12);
  triggerGroup(b, 'lng', 0.02, -0.03);
  // Skeleton stock with a lightening cut.
  b.add(
    R,
    'stock',
    profile(
      [[-0.12, 0.1, 0.02], [-0.45, 0.094, 0.02], [-0.46, -0.04, 0.015], [-0.41, -0.052, 0.025], [-0.2, -0.012, 0.03], [-0.12, 0.012, 0.01]],
      0.054,
      0.006,
      [[[-0.4, 0.06, 0.02], [-0.25, 0.064, 0.02], [-0.25, 0.012, 0.015], [-0.4, -0.018, 0.02]]],
    ),
    'shell',
  );
  b.add(R, 'cheek', rbox(0.046, 0.03, 0.14, 0.012), 'accent', 0, 0.108, 0.3);
  b.add(R, 'butt', profile([[-0.448, 0.098, 0.008], [-0.478, 0.096, 0.008], [-0.484, -0.046, 0.008], [-0.456, -0.044, 0.008]], 0.058, 0.004), 'dark');
  // Scope.
  b.add(R, 'scopeMountA', rbox(0.03, 0.05, 0.022, 0.006), 'metal', 0, 0.125, -0.16);
  b.add(R, 'scopeMountB', rbox(0.03, 0.05, 0.022, 0.006), 'metal', 0, 0.125, 0.0);
  b.add(
    R,
    'scope',
    latheZ([[0.0, 0.1], [0.024, 0.1], [0.026, 0.07], [0.017, 0.04], [0.017, -0.16], [0.028, -0.2], [0.028, -0.255], [0.0, -0.255]], 28),
    'metal',
    0,
    0.16,
    -0.03,
  );
  b.add(R, 'scopeBand', torusZ(0.0175, 0.003), 'accent', 0, 0.16, -0.12);
  b.add(R, 'scopeLens', (seg) => new THREE.CircleGeometry(0.026, seg ? 24 : 10).rotateY(Math.PI), 'glass', 0, 0.16, -0.2855);
  b.add(R, 'scopeEye', (seg) => new THREE.CircleGeometry(0.022, seg ? 24 : 10), 'glass', 0, 0.16, 0.0705);
  b.add(R, 'turretTop', cylY(0.012, 0.022, 14), 'accent', 0, 0.189, -0.07);
  b.add(R, 'turretSide', cylX(0.011, 0.02, 14), 'metal', -0.028, 0.16, -0.07);
  b.sight.position.set(0, 0.16, 0.09);
  const mag = b.group(R, 'mag', 0, -0.02, -0.1);
  b.add(mag, 'magBody', profile([[-0.04, 0.01, 0], [0.042, 0.01, 0], [0.042, -0.07, 0.01], [-0.04, -0.07, 0.01]], 0.032, 0.005), 'accent');
  b.add(mag, 'magBase', rbox(0.036, 0.012, 0.09, 0.004), 'dark', 0, -0.074, 0);
  b.parts.mag = mag;
  // Bolt handle: rotates about the bore (Z) and slides along it.
  const bolt = b.group(R, 'bolt', 0, 0.075, 0.07);
  b.add(bolt, 'boltArm', cylX(0.006, 0.05, 8), 'metal', 0.05, 0, 0);
  b.add(bolt, 'boltBall', sphere(0.013), 'metal', 0.078, 0, 0);
  b.add(bolt, 'boltCollar', cylZ(0.016, 0.016, 0.03, 12), 'dark', 0.022, 0, 0);
  b.parts.bolt = bolt;
  b.dial(-0.036, 0.055, -0.05, 0.018);
  b.label(-0.0365, 0.082, -0.15, 0.07);
  b.screen(-0.03, 0.102, 0.12, 0.04, 0.02, -0.7, -0.35);
  b.hands([0, -0.06, 0.02, 0.35], [-0.012, -0.015, -0.46, 0]);
}

function buildBreaker(b: Build): void {
  const R = b.root;
  b.add(R, 'receiver', profile([[-0.1, -0.02, 0.012], [-0.1, 0.1, 0.03], [-0.07, 0.132, 0.025], [0.2, 0.132, 0.025], [0.232, 0.1, 0.02], [0.232, -0.02, 0.015]], 0.084), 'shell');
  b.add(R, 'receiverStripe', rbox(0.088, 0.016, 0.28, 0.006), 'accent', 0, 0.1, -0.06);
  b.add(R, 'port', rbox(0.05, 0.012, 0.1, 0.004), 'dark', 0, -0.022, -0.1);
  b.add(R, 'barrel', cylZ(0.021, 0.021, 0.4, 18), 'metal', 0, 0.09, -0.43);
  b.add(R, 'rib', rbox(0.012, 0.012, 0.38, 0.003), 'dark', 0, 0.115, -0.43);
  b.add(R, 'tube', cylZ(0.018, 0.018, 0.34, 16), 'dark', 0, 0.036, -0.4);
  b.add(R, 'tubeCap', cylZ(0.021, 0.021, 0.025, 16), 'metal', 0, 0.036, -0.575);
  b.add(R, 'barrelClamp', rbox(0.05, 0.085, 0.018, 0.008), 'metal', 0, 0.062, -0.575);
  b.add(R, 'muzzle', cylZ(0.025, 0.025, 0.03, 18), 'metal', 0, 0.09, -0.63);
  b.add(R, 'bead', sphere(0.004), 'glow', 0, 0.126, -0.62);
  b.muzzle.position.set(0, 0.09, -0.65);
  pistolGrip(b, 'brk', -0.01, -0.02, 0.12);
  triggerGroup(b, 'brk', 0.018, -0.022);
  b.add(R, 'stock', profile([[-0.1, 0.112, 0.02], [-0.36, 0.084, 0.022], [-0.37, -0.05, 0.015], [-0.33, -0.062, 0.022], [-0.18, -0.03, 0.03], [-0.1, -0.01, 0.01]], 0.064), 'shell');
  b.add(R, 'stockStripe', rbox(0.066, 0.12, 0.014, 0.01), 'accent', 0, 0.02, 0.28, -0.1);
  b.add(R, 'butt', profile([[-0.358, 0.088, 0.01], [-0.39, 0.086, 0.01], [-0.4, -0.06, 0.01], [-0.368, -0.064, 0.01]], 0.066, 0.004), 'dark');
  b.add(R, 'rearNotch', rbox(0.024, 0.014, 0.012, 0.003), 'metal', 0, 0.138, 0.06);
  b.sight.position.set(0, 0.134, 0.09);
  // Side shell caddy (static decoration) on the left.
  b.add(R, 'caddy', rbox(0.01, 0.058, 0.13, 0.004), 'dark', -0.045, 0.045, -0.045);
  for (let i = 0; i < 4; i++) {
    const z = 0.0 - i * 0.03;
    b.add(R, 'caddyShell', cylY(0.0105, 0.048, 10), 'accent', -0.051, 0.052, z);
    b.add(R, 'caddyBase', cylY(0.011, 0.012, 10), 'brass', -0.051, 0.022, z);
  }
  // Pump (slides +Z on the cycle).
  const pump = b.group(R, 'pump', 0, 0.036, -0.36);
  b.add(pump, 'pumpWood', rbox(0.066, 0.064, 0.15, 0.03), 'wood', 0, 0, 0);
  b.add(pump, 'pumpCapF', rbox(0.07, 0.068, 0.018, 0.03), 'shell', 0, 0, -0.08);
  b.add(pump, 'pumpCapR', rbox(0.07, 0.068, 0.018, 0.03), 'shell', 0, 0, 0.08);
  for (let i = 0; i < 3; i++) b.add(pump, 'groove', rbox(0.068, 0.066, 0.006, 0.029), 'dark', 0, 0, -0.035 + i * 0.035);
  b.parts.pump = pump;
  const shell = b.group(R, 'shell', 0, -0.03, -0.1);
  b.add(shell, 'looseShell', cylZ(0.0105, 0.0105, 0.05, 10), 'accent', 0, 0, 0);
  b.add(shell, 'looseBase', cylZ(0.011, 0.011, 0.012, 10), 'brass', 0, 0, 0.028);
  shell.visible = false;
  b.parts.shell = shell;
  b.dial(-0.043, 0.06, 0.05, 0.02);
  b.label(-0.0435, 0.118, -0.1, 0.075);
  b.screen(-0.03, 0.137, 0.085, 0.044, 0.022, -0.8, -0.2);
  b.hands([0, -0.055, 0.025, 0.35], [-0.01, -0.025, -0.36, 0]);
}

function buildPulse(b: Build): void {
  const R = b.root;
  b.add(R, 'frame', profile([[-0.04, 0.035, 0.01], [-0.04, 0.1, 0.015], [0.19, 0.1, 0.015], [0.205, 0.084, 0.012], [0.205, 0.045, 0.015], [0.06, 0.03, 0.012]], 0.04), 'shell');
  b.add(R, 'frameStripe', rbox(0.042, 0.008, 0.2, 0.003), 'accent', 0, 0.062, -0.08);
  const slide = b.group(R, 'slide', 0, 0, 0);
  b.add(slide, 'slideBody', profile([[-0.045, 0.098, 0.004], [-0.045, 0.128, 0.01], [0.195, 0.128, 0.012], [0.21, 0.098, 0.004]], 0.033, 0.004), 'metal');
  for (let i = 0; i < 4; i++) b.add(slide, 'serration', rbox(0.035, 0.022, 0.004, 0.001), 'dark', 0, 0.114, 0.03 - i * 0.009);
  b.add(slide, 'rearSight', rbox(0.026, 0.012, 0.01, 0.002), 'dark', 0, 0.134, 0.035);
  b.add(slide, 'frontSight', rbox(0.006, 0.012, 0.008, 0.002), 'dark', 0, 0.134, -0.19);
  b.add(slide, 'frontDot', sphere(0.0025), 'glow', 0, 0.139, -0.19);
  b.parts.slide = slide;
  b.add(R, 'barrel', cylZ(0.009, 0.009, 0.05), 'dark', 0, 0.072, -0.23);
  b.muzzle.position.set(0, 0.072, -0.26);
  const coil = b.group(R, 'coil', 0, 0.072, -0.215);
  for (let i = 0; i < 3; i++) b.add(coil, 'coilRing', torusZ(0.019, 0.0045), 'copper', 0, 0, -i * 0.013);
  b.parts.coil = coil;
  // Swing-out cell cylinder (crane pivot below-left of the bore).
  const crane = b.group(R, 'mag', -0.012, 0.045, -0.03);
  const cyl = b.group(crane, 'cylinder', 0.012, 0.022, 0, false);
  b.add(cyl, 'cylBody', cylZ(0.027, 0.027, 0.052, 18), 'metal', 0, 0, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.add(cyl, 'cell', cylZ(0.0068, 0.0068, 0.054, 8), 'copper', Math.cos(a) * 0.016, Math.sin(a) * 0.016, 0);
  }
  b.parts.mag = crane;
  pistolGrip(b, 'pls', 0.03, 0.045, 0.11);
  b.add(R, 'gripCap', rbox(0.036, 0.012, 0.05, 0.005), 'accent', 0, -0.066, 0.012, 0.3);
  triggerGroup(b, 'pls', 0.035, 0.036);
  b.sight.position.set(0, 0.137, 0.045);
  b.dial(-0.0205, 0.066, -0.14, 0.012);
  b.label(-0.021, 0.085, -0.05, 0.05);
  b.screen(0, 0.075, 0.041, 0.028, 0.015, 0.25);
  b.hands([0, -0.01, 0.0, 0.32], [-0.014, -0.02, 0.005, 0.32]);
}

function buildSunspear(b: Build): void {
  const R = b.root;
  b.add(R, 'lower', profile([[-0.07, -0.03, 0.01], [-0.07, 0.02, 0], [0.3, 0.02, 0], [0.3, -0.02, 0.012], [0.2, -0.036, 0.01], [-0.02, -0.036, 0.01]], 0.066), 'dark');
  b.add(R, 'body', profile([[-0.12, 0.0, 0.015], [-0.12, 0.1, 0.04], [-0.08, 0.145, 0.03], [0.3, 0.145, 0.03], [0.362, 0.11, 0.04], [0.362, 0.01, 0.02], [0.3, -0.012, 0.02]], 0.094), 'shell');
  b.add(R, 'spine', rbox(0.05, 0.024, 0.4, 0.01), 'metal', 0, 0.152, -0.12);
  b.add(R, 'bodyStripe', rbox(0.098, 0.018, 0.4, 0.008), 'accent', 0, 0.032, -0.12);
  b.add(R, 'core', cylZ(0.018, 0.018, 0.38, 14), 'metal', 0, 0.07, -0.55);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    b.add(R, 'rail', cylZ(0.005, 0.005, 0.34, 6), 'dark', Math.cos(a) * 0.047, 0.07 + Math.sin(a) * 0.047, -0.54);
  }
  const coil = b.group(R, 'coil', 0, 0.07, -0.41);
  for (let i = 0; i < 4; i++) b.add(coil, 'capRing', torusZ(0.045, 0.012), 'glow', 0, 0, -i * 0.075);
  for (const x of [-0.05, 0.05]) b.add(coil, 'cell', cylZ(0.017, 0.017, 0.14, 12), 'glow', x, -0.015, 0.21);
  b.parts.coil = coil;
  b.add(R, 'lensBezel', torusZ(0.04, 0.008), 'metal', 0, 0.07, -0.745);
  b.add(R, 'lens', (seg) => new THREE.CircleGeometry(0.036, seg ? 24 : 10).rotateY(Math.PI), 'glow', 0, 0.07, -0.747);
  b.muzzle.position.set(0, 0.07, -0.76);
  pistolGrip(b, 'sun', -0.005, -0.03, 0.12);
  triggerGroup(b, 'sun', 0.02, -0.032);
  b.add(R, 'foregrip', profile([[0.26, -0.03, 0.004], [0.31, -0.03, 0.004], [0.3, -0.1, 0.016], [0.255, -0.095, 0.016]], 0.04), 'shell');
  b.add(R, 'stock', profile([[-0.12, 0.112, 0.02], [-0.3, 0.1, 0.02], [-0.31, -0.024, 0.015], [-0.27, -0.038, 0.02], [-0.12, 0.0, 0.01]], 0.072), 'shell');
  b.add(R, 'butt', profile([[-0.3, 0.104, 0.008], [-0.33, 0.102, 0.008], [-0.336, -0.03, 0.008], [-0.306, -0.03, 0.008]], 0.074, 0.004), 'dark');
  for (let i = 0; i < 3; i++) {
    const v = b.group(R, `vent${i}`, 0, 0.164, -0.2 - i * 0.05);
    b.add(v, 'ventFlap', rbox(0.036, 0.006, 0.032, 0.002), 'dark', 0, 0, 0.016);
    b.vents.push(v);
  }
  b.add(R, 'sightPost', rbox(0.014, 0.03, 0.02, 0.004), 'metal', 0, 0.178, 0.02);
  b.add(R, 'sightRing', torusZ(0.022, 0.0035), 'glow', 0, 0.212, 0.02);
  b.sight.position.set(0, 0.212, 0.05);
  b.dial(-0.048, 0.074, -0.02, 0.022);
  b.label(-0.0485, 0.112, -0.13, 0.08);
  b.screen(-0.034, 0.137, 0.09, 0.046, 0.022, -0.75, -0.3);
  b.hands([0, -0.06, 0.02, 0.35], [0, -0.05, -0.28, -0.1]);
}

const BUILDERS: Record<WeaponId, (b: Build) => void> = {
  meridian: buildMeridian,
  swift: buildSwift,
  longline: buildLongline,
  breaker: buildBreaker,
  pulse: buildPulse,
  sunspear: buildSunspear,
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
  private screenCanvas: HTMLCanvasElement | null = null;
  private screenTex: THREE.CanvasTexture | null = null;
  private screenMat: THREE.MeshBasicMaterial | null = null;
  private glowMat: THREE.MeshBasicMaterial | null = null;
  private lastMag = -1;
  private lastSize = -1;
  private readonly needle: THREE.Object3D | null;
  private charge = 0;

  constructor(readonly id: WeaponId, readonly lod: WeaponLod, b: Build) {
    this.root = b.root;
    this.muzzle = b.muzzle;
    this.parts = b.parts;
    this.sight = b.sight;
    this.handR = b.handR;
    this.handL = b.handL;
    this.vents = b.vents;
    this.needle = b.dialNeedle;
    if (lod === 'view' && b.screenMesh) {
      this.screenCanvas = makeCanvas(64, 32);
      this.screenTex = new THREE.CanvasTexture(this.screenCanvas);
      this.screenTex.colorSpace = THREE.SRGBColorSpace;
      this.screenMat = new THREE.MeshBasicMaterial({ map: this.screenTex, color: new THREE.Color(1.8, 1.8, 1.8) });
      b.screenMesh.material = this.screenMat;
    }
    if (id === 'sunspear') {
      // Per-instance glow so charge can ramp independently.
      this.glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PICKUP_COLOR) });
      this.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && (m.material as THREE.Material).userData?.slot === 'glow') m.material = this.glowMat!;
      });
      this.setCharge(0);
    }
    this.root.traverse((o) => {
      o.castShadow = lod === 'world';
      o.receiveShadow = false;
    });
  }

  setAmmo(mag: number, magSize: number): void {
    if (mag === this.lastMag && magSize === this.lastSize) return;
    this.lastMag = mag;
    this.lastSize = magSize;
    if (this.needle) {
      const f = magSize > 0 ? Math.max(0, Math.min(1, mag / magSize)) : 0;
      if (this.id !== 'sunspear') this.needle.rotation.z = Math.PI * 0.75 - f * Math.PI * 1.5;
    }
    if (this.screenCanvas && this.screenTex) {
      drawScreen(this.screenCanvas.getContext('2d') as CanvasRenderingContext2D, 64, 32, mag, magSize);
      this.screenTex.needsUpdate = true;
    }
  }

  setCharge(k: number): void {
    this.charge = Math.max(0, Math.min(1, k));
    if (this.glowMat) {
      const base = new THREE.Color(PICKUP_COLOR);
      const hot = new THREE.Color('#fff6dc');
      this.glowMat.color.copy(base.lerp(hot, this.charge * 0.7)).multiplyScalar(0.9 + this.charge * 3.2);
    }
    if (this.id === 'sunspear' && this.needle) this.needle.rotation.z = Math.PI * 0.75 - this.charge * Math.PI * 1.5;
  }

  dispose(): void {
    this.screenTex?.dispose();
    this.screenMat?.dispose();
    this.glowMat?.dispose();
    this.root.removeFromParent();
  }
}

/** Merges all static meshes per material into single meshes (world LOD). */
function flatten(b: Build): void {
  const root = b.root;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const bySlot = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
  const remove: THREE.Mesh[] = [];
  const isDynamic = (o: THREE.Object3D): boolean => {
    for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (b.dynamic.has(p)) return true;
    return false;
  };
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || isDynamic(m)) return;
    const mat = m.material as THREE.Material;
    const slot = (mat.userData.slot as string) ?? mat.uuid;
    const key = `${b.id}|${b.lod}|${slot}`;
    let e = bySlot.get(key);
    if (!e) bySlot.set(key, (e = { mat, geos: [] }));
    if (!mergedCache.has(key)) e.geos.push(m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)));
    remove.push(m);
  });
  for (const m of remove) m.removeFromParent();
  for (const [key, e] of bySlot) {
    let g = mergedCache.get(key);
    if (!g) {
      g = mergeGeometries(e.geos, false) ?? e.geos[0];
      for (const x of e.geos) if (x !== g) x.dispose();
      mergedCache.set(key, g);
    }
    const mesh = new THREE.Mesh(g, e.mat);
    mesh.name = `merged.${key}`;
    if ((e.mat.userData.slot as string) === 'screen') b.screenMesh = mesh;
    root.add(mesh);
  }
}

export class WeaponModels implements WeaponModelFactory {
  constructor(private readonly materials: MaterialLibrary) {
    void this.materials;
  }

  create(id: WeaponId, skin: string, lod: 'view' | 'world'): WeaponModelView {
    const s = findSkin(skin);
    const b = new Build(id, lod, s);
    BUILDERS[id](b);
    // Static pieces merge per material for both LODs (≈10–14 draws first-person,
    // ≈5 third-person); animated groups (mag, bolt, pump, dial needle…) stay live.
    flatten(b);
    const inst = new WeaponInstance(id, lod, b);
    inst.setAmmo(1, 1);
    return inst;
  }
}

/** Environment neutral used by previews/menus behind weapons. */
export const WEAPON_BACKDROP = ENV.shadowWarm;

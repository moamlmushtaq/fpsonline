// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Observatory snowfield: the summit's sculpted snow surface.
//
// Replaces the generic flat snow slab (the ground solid is drawn by the decor):
//  • Real drifts sculpted against every grounded solid (walls, crates, rocks):
//    long sun-catching tails on the lee (east) side of the wind, short steep
//    banks on the windward side; trodden footpaths flatten them through doors.
//  • Open ground stays at the collision height (y = 0: feet, contact shadows
//    and effects sit right on it); its sastrugi ripples and broad wind-swells
//    live in the vertex NORMALS only (shaded relief at the grazing sun, zero
//    displacement).
//  • Vertex colours: a blue-violet (west, hollows, wall feet) → warm (east, the
//    last light) gradient, glazed wind-scoured patches, compacted grey-warm
//    footpaths. A wrapped canvas texture adds sastrugi streaks aligned with the
//    wind (same single fetch the library snow texture used).
//  • Sparkle: view-dependent glints at grazing angles (a hash per 4 cm cell,
//    ~12 ALU, every preset; fades out past ~35 m so it never shimmers far off).
//  • Footprints: one multiply-blended draw of boot prints along the paths.
// The height function is exposed so other decor (light pools, tracks) drapes
// over the drifts instead of being buried by them.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { DecorContext } from '../../../contracts';
import type { Solid } from '../../../../shared/maps/types';
import { OBS } from '../../../../shared/maps/observatory';
import { noise3 } from './rocks';

/** Prevailing wind (toward +x, a touch +z — matches the weather and the pennants). */
export const WIND = new THREE.Vector2(2.4, 0.8).normalize();

type P2 = [number, number];
interface Trail {
  pts: P2[];
  w: number;
  /** Footprint lanes (0 = none). */
  prints: number;
}

// South half (mirrored to the north): the routes people actually walked.
const TRAILS: Trail[] = [
  // Centre gate → round the porch (both sides) → the dome's south door.
  { pts: [[0, 44], [0, 40.6], [-4.6, 39.7], [-6.9, 37.4], [-6.2, 31], [-4.2, 24.4], [-1.4, 17.5], [0, 12.4]], w: 1.9, prints: 2 },
  { pts: [[0, 40.6], [4.6, 39.7], [6.8, 37.4], [5.6, 31], [3.6, 23.8], [2.4, 20.8], [0.6, 15], [0, 12.4]], w: 1.5, prints: 1 },
  // Forecourt along the yard wall.
  { pts: [[-46, 40.2], [-30, 40.5], [-18, 40.3], [-7.2, 39.9], [7.2, 39.9], [18, 40.3], [30, 40.5], [46, 40.2]], w: 2.0, prints: 1 },
  // West gate → ridge-path ramp foot / under-ridge yard → plateau steps → hut → arcade.
  { pts: [[-55, 44], [-54, 40.4], [-46, 40.2]], w: 1.8, prints: 1 },
  { pts: [[-54, 40.4], [-53.2, 38.4]], w: 1.6, prints: 1 },
  { pts: [[-46, 40.2], [-45.4, 31], [-46, 20], [-41.5, 15.2], [-34, 12.9], [-31.6, 10.6], [-30, 5.2], [-26.6, 3.2], [-25.2, 0.6], [-25, 0]], w: 1.6, prints: 2 },
  // East gate → the deck ramp; the dorm alley.
  { pts: [[55, 44], [54, 40.5], [46, 40.2]], w: 1.8, prints: 1 },
  { pts: [[54, 40.5], [49.2, 35], [45.6, 26], [44.6, 16.6]], w: 1.7, prints: 2 },
  { pts: [[29.5, 15.4], [30.2, 22], [31.6, 28.2], [36, 33], [46, 40.2]], w: 1.7, prints: 2 },
  // Dorm east door → the mantle crate onto the deck.
  { pts: [[34.7, 8], [38, 7], [40.8, 3.6], [41.2, 1.9]], w: 1.4, prints: 1 },
  // Dome south door → the generator's service door / the snowcat.
  { pts: [[1.4, 13.4], [8, 16.6], [12, 18.6], [17.6, 19.5]], w: 1.4, prints: 1 },
  { pts: [[-1.4, 13.4], [-6, 15.6], [-11.4, 18.2]], w: 1.3, prints: 1 },
  // Spawn yard: from the rows round the blast baffles to the three gates.
  { pts: [[-40, 55], [-45, 47.4], [-46.3, 44.2], [-55, 43.9]], w: 1.8, prints: 2 },
  { pts: [[-17, 55.5], [-10.6, 47.6], [-9.3, 44.2], [0, 43.8]], w: 1.8, prints: 2 },
  { pts: [[17, 55.5], [10.6, 47.6], [9.3, 44.2], [0, 43.8]], w: 1.8, prints: 2 },
  { pts: [[40, 55], [45, 47.4], [46.3, 44.2], [55, 43.9]], w: 1.8, prints: 2 },
  // Across the courtyards: west yard → round the crate stack; east court → the alley.
  { pts: [[-36.5, 31.2], [-29.5, 29.2], [-24.6, 31.8], [-15, 33.4], [-6.9, 34]], w: 1.4, prints: 1 },
  { pts: [[6.4, 34], [12, 32], [19, 31.4], [24, 29.8], [31.6, 28.2]], w: 1.4, prints: 1 },
];

/** Vehicle tracks (south: the snowcat's cleated treads; north: the fuel sled's runners). */
const TRACK: P2[] = [[0, 41.6], [-6.8, 39.4], [-7.4, 33.5], [-6.2, 29.2], [-8.6, 23.6], [-11.2, 20.4], [-12.6, 18.5]];

/** Axis-aligned rects (x0, z0, x1, z1) with their own floors: no snow surface inside. */
const CUTS: [number, number, number, number][] = [
  [-OBS.hallHalf + 0.05, -OBS.hallHalf + 0.05, OBS.hallHalf - 0.05, OBS.hallHalf - 0.05],
  [-OBS.doorHalf, -OBS.baseHalf - 0.05, OBS.doorHalf, OBS.baseHalf + 0.05],
  [-OBS.baseHalf - 0.05, -OBS.doorHalf, OBS.baseHalf + 0.05, OBS.doorHalf],
  [OBS.baseHalf, -OBS.doorHalf + 0.02, OBS.dorm.x0 + 0.6, OBS.doorHalf - 0.02],
  [-24, -OBS.doorHalf + 0.02, -OBS.baseHalf, OBS.doorHalf - 0.02],
  [OBS.dorm.x0 + 0.45, -OBS.dorm.z + 0.45, OBS.dorm.x1 - 0.45, OBS.dorm.z - 0.45],
];

interface Obstacle {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Peak drift height against this obstacle. */
  h: number;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az;
  const l2 = vx * vx + vz * vz || 1;
  const t = Math.min(1, Math.max(0, ((px - ax) * vx + (pz - az) * vz) / l2));
  return Math.hypot(px - ax - vx * t, pz - az - vz * t);
}

export class SnowField {
  private readonly obs: Obstacle[] = [];
  /** Obstacles bucketed on a 4 m grid (with their drift reach). */
  private readonly grid = new Map<number, number[]>();
  /** Trail segments [ax, az, bx, bz, halfWidth]. */
  readonly segs: number[][] = [];
  readonly trails: Trail[] = [];
  /** Sastrugi ridge amplitude (shading only; lower on coarse grids). */
  ridgeAmp = 0.3;

  constructor(solids: readonly Solid[]) {
    for (const s of solids) {
      const w = s.max.x - s.min.x, d = s.max.z - s.min.z, hgt = s.max.y - s.min.y;
      if (s.min.y > 0.05 || hgt < 0.5 || s.ramp || s.shootThrough) continue;
      if (w * d > 4000) continue; // the ground slab itself
      this.obs.push({ x0: s.min.x, z0: s.min.z, x1: s.max.x, z1: s.max.z, h: Math.min(0.42, 0.1 + hgt * 0.06) });
    }
    const reach = 3.2;
    this.obs.forEach((o, i) => {
      for (let gx = Math.floor((o.x0 - reach) / 4); gx <= Math.floor((o.x1 + reach) / 4); gx++) {
        for (let gz = Math.floor((o.z0 - reach) / 4); gz <= Math.floor((o.z1 + reach) / 4); gz++) {
          const k = gx * 7919 + gz;
          let a = this.grid.get(k);
          if (!a) this.grid.set(k, (a = []));
          a.push(i);
        }
      }
    });
    for (const s of [1, -1]) {
      for (const t of TRAILS) {
        const pts = t.pts.map(([x, z]) => [x, z * s] as P2);
        this.trails.push({ pts, w: t.w, prints: t.prints });
        for (let i = 0; i + 1 < pts.length; i++) this.segs.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], t.w / 2]);
      }
    }
  }

  /** Inside an interior / paved area (no snow surface). */
  cut(x: number, z: number): boolean {
    for (const [a, b, c, d] of CUTS) if (x > a && x < c && z > b && z < d) return true;
    return false;
  }

  /** 0..1: how much a footpath has trodden this spot flat. */
  trail(x: number, z: number): number {
    let best = 0;
    for (const s of this.segs) {
      if (x < Math.min(s[0], s[2]) - 2 || x > Math.max(s[0], s[2]) + 2 || z < Math.min(s[1], s[3]) - 2 || z > Math.max(s[1], s[3]) + 2) continue;
      const d = segDist(x, z, s[0], s[1], s[2], s[3]);
      // Ragged edges: the half-width breathes along the path.
      const hw = s[4] * (0.8 + 0.4 * noise3(x * 0.6, 3.3, z * 0.6));
      const m = 1 - smooth(hw * 0.55, hw, d);
      if (m > best) best = m;
    }
    return best;
  }

  /** Drift height (≥ 0) sculpted by the obstacles, before footpaths flatten it. */
  drift(x: number, z: number): { h: number; near: number; lee: number } {
    const ids = this.grid.get(Math.floor(x / 4) * 7919 + Math.floor(z / 4));
    let h = 0;
    let near = 0;
    let lee = 0;
    if (!ids) return { h, near, lee };
    for (const i of ids) {
      const o = this.obs[i];
      const dx = x < o.x0 ? x - o.x0 : x > o.x1 ? x - o.x1 : 0;
      const dz = z < o.z0 ? z - o.z0 : z > o.z1 ? z - o.z1 : 0;
      const d = Math.hypot(dx, dz);
      // Along-face variation: sampled at the nearest boundary point, so it runs along the wall.
      const bx = Math.min(o.x1, Math.max(o.x0, x));
      const bz = Math.min(o.z1, Math.max(o.z0, z));
      const n = noise3(bx * 0.33 + 1.7, 0.5, bz * 0.33 - 4.1);
      const dot = d > 1e-4 ? (dx * WIND.x + dz * WIND.y) / d : 0;
      const l = Math.max(0, dot); // lee (downwind) side
      const wv = Math.max(0, -dot); // windward side
      const W = 0.85 + 1.9 * l + 0.25 * wv + 0.8 * smooth(0.3, 0.7, n);
      if (d >= W) continue;
      const t = d / W;
      // Rounded bank at the wall, long concave tail on the lee side.
      const f = Math.pow(1 - t, 1.6 + 0.6 * l) * (1 + 0.5 * t * (1 - t));
      // Piles and gaps along the face (not a uniform berm).
      const pile = smooth(0.28, 0.72, n);
      const hh = o.h * (0.25 + 0.95 * pile) * (1 + 0.2 * l - 0.2 * wv) * f;
      if (hh > h) {
        h = hh;
        lee = l;
      }
      near = Math.max(near, 1 - smooth(0, 1.2, d));
    }
    return { h, near, lee };
  }

  /** Real surface height of the snow at (x, z) (negative = no snow surface here). */
  heightAt(x: number, z: number): number {
    if (this.cut(x, z)) return -0.15;
    const d = this.drift(x, z).h;
    if (d <= 0) return 0;
    return d * (1 - 0.92 * this.trail(x, z));
  }

  /** Shading-only relief (sastrugi + wind swells) for the normals. */
  relief(x: number, z: number): number {
    // Rotate into wind space: u along the wind, v across it.
    const u = x * WIND.x + z * WIND.y;
    const v = -x * WIND.y + z * WIND.x;
    const swell = noise3(u * 0.055, 7.1, v * 0.1) * 1.1 + noise3(u * 0.13 - 4, 3.3, v * 0.2 + 2) * 0.3;
    const r = noise3(u * 0.08 + 3, 1.3, v * 0.42);
    const ridge = 1 - Math.abs(2 * r - 1);
    const patch = smooth(0.3, 0.65, noise3(u * 0.03 - 5, 2.2, v * 0.05 + 9));
    return swell + ridge * ridge * this.ridgeAmp * patch;
  }
}

// ── Textures ────────────────────────────────────────────────────────────────

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wrapped sastrugi / wind-ripple detail (u runs along the wind). */
export function paintSnowDetail(c: CanvasRenderingContext2D, w: number, h: number): void {
  const r = rng(77);
  c.fillStyle = '#f4f4f8';
  c.fillRect(0, 0, w, h);
  const k = w / 512;
  // Draw at the wrapped copies so the tile is seamless.
  const wrap = (fn: (ox: number, oy: number) => void): void => {
    for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) fn(ox, oy);
  };
  // Broad soft value swells.
  for (let i = 0; i < 26; i++) {
    const x = r() * w, y = r() * h, rx = (60 + r() * 120) * k, ry = (14 + r() * 30) * k;
    const a = 0.025 + r() * 0.04;
    const dark = r() < 0.55;
    wrap((ox, oy) => {
      const g = c.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rx);
      g.addColorStop(0, dark ? `rgba(120,124,170,${a})` : `rgba(255,255,255,${a * 1.6})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.save();
      c.translate(x + ox, y + oy);
      c.scale(1, ry / rx);
      c.translate(-(x + ox), -(y + oy));
      c.fillStyle = g;
      c.fillRect(x + ox - rx, y + oy - rx, rx * 2, rx * 2);
      c.restore();
    });
  }
  // Sastrugi: long thin ridges along the wind — a cool shadow line under a bright crest.
  for (let i = 0; i < 150; i++) {
    const x = r() * w, y = r() * h, len = (40 + r() * 150) * k, th = (1 + r() * 2.2) * k;
    const bend = (r() - 0.5) * 10 * k;
    const a = 0.06 + r() * 0.12;
    wrap((ox, oy) => {
      c.beginPath();
      c.moveTo(x + ox, y + oy);
      c.quadraticCurveTo(x + ox + len / 2, y + oy + bend, x + ox + len, y + oy + bend * 0.3);
      c.strokeStyle = `rgba(118,122,176,${a})`;
      c.lineWidth = th * 1.6;
      c.stroke();
      c.beginPath();
      c.moveTo(x + ox, y + oy - th * 1.3);
      c.quadraticCurveTo(x + ox + len / 2, y + oy + bend - th * 1.3, x + ox + len, y + oy + bend * 0.3 - th * 1.3);
      c.strokeStyle = `rgba(255,255,255,${a * 1.8})`;
      c.lineWidth = th;
      c.stroke();
    });
  }
  // Fine crystalline grain.
  for (let i = 0; i < 2600 * k * k; i++) {
    const x = r() * w, y = r() * h;
    c.fillStyle = r() < 0.5 ? `rgba(120,126,180,${0.05 + r() * 0.07})` : `rgba(255,255,255,${0.2 + r() * 0.3})`;
    c.fillRect(x, y, 1 + r() * 1.5 * k, 1);
  }
}

// ── Mesh ────────────────────────────────────────────────────────────────────

export interface SnowSurface {
  mesh: THREE.Mesh;
  prints: THREE.Mesh | null;
  /** Snow material with glints (also used by the decor kits' snow caps). */
  sparkle(base: THREE.Material): THREE.Material;
  owned: THREE.Material[];
  dispose(): void;
}

const SPARKLE_VERT_PARS = /* glsl */ `
varying vec3 vObsWorld;`;
const SPARKLE_VERT = /* glsl */ `
vObsWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`;
const SPARKLE_FRAG_PARS = /* glsl */ `
varying vec3 vObsWorld;
uniform vec3 uObsSun;
uniform vec3 uObsSheen;
uniform float uObsSparkle;`;
// Glints: round points on a ~2.5 cm lattice, re-rolled as the view direction
// changes (they twinkle as you move), only where the low sun actually reaches,
// strongest at grazing angles, gold toward the sun. Far snow gets a soft sheen
// of the horizon glow instead (the last light skating across the field).
const SPARKLE_FRAG = /* glsl */ `
{
	vec3 obsV = cameraPosition - vObsWorld;
	float obsD = length( obsV );
	obsV /= obsD;
	vec2 obsP = vObsWorld.xz * 40.0;
	vec2 obsC = floor( obsP ) + floor( obsV.xz * 7.0 ) * 31.0;
	float obsH = fract( sin( dot( obsC, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
	float obsDot = smoothstep( 0.34, 0.08, length( fract( obsP ) - 0.5 ) );
	float obsG = step( 0.988, obsH ) * obsDot * ( 1.0 - smoothstep( 5.0, 20.0, obsD ) );
	float obsGraze = 1.0 - abs( obsV.y );
	float obsSunward = max( 0.0, dot( -obsV, uObsSun ) );
	float obsLit = clamp( dot( reflectedLight.directDiffuse, vec3( 0.3, 0.59, 0.11 ) ) * 1.6, 0.0, 1.6 );
	vec3 obsCol = mix( vec3( 0.85, 0.9, 1.2 ), vec3( 1.7, 1.2, 0.85 ), obsSunward * obsSunward );
	outgoingLight += obsCol * obsG * ( 0.12 + obsLit ) * ( 0.4 + 1.2 * obsGraze * obsGraze ) * uObsSparkle;
	float obsS = pow( obsGraze, 6.0 ) * ( 0.3 + 0.7 * obsSunward ) * smoothstep( 8.0, 40.0, obsD );
	outgoingLight += uObsSheen * obsS * 0.22 * uObsSparkle;
}`;

export function buildSnowSurface(ctx: DecorContext, field: SnowField, rnd: () => number, propTex: THREE.Texture | null, printRect: [number, number, number, number], treadRect: [number, number, number, number]): SnowSurface {
  const low = ctx.quality.preset === 'low';
  const owned: THREE.Material[] = [];
  const sun = new THREE.Vector3(ctx.def.lighting.sunDir.x, ctx.def.lighting.sunDir.y, ctx.def.lighting.sunDir.z).normalize();
  const sunU = { value: sun };
  const sparkU = { value: low ? 0.85 : 1 };
  const sheenU = { value: new THREE.Color(ctx.def.lighting.sunGlow) };

  const sparkle = (base: THREE.Material): THREE.Material => {
    const m = base.clone();
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uObsSun = sunU;
      sh.uniforms.uObsSparkle = sparkU;
      sh.uniforms.uObsSheen = sheenU;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>${SPARKLE_VERT_PARS}`).replace('#include <worldpos_vertex>', `#include <worldpos_vertex>${SPARKLE_VERT}`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>${SPARKLE_FRAG_PARS}`).replace('#include <opaque_fragment>', `${SPARKLE_FRAG}\n#include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => `obs.sparkle.${base.type}`;
    m.name = `${base.name}.sparkle`;
    owned.push(m);
    return m;
  };

  // Grid over the summit (the rim cliffs start at the edge of the old ground slab).
  const X0 = -58.5, X1 = 58.5, Z0 = -61.5, Z1 = 61.5;
  const step = low ? 1.5 : ctx.quality.preset === 'medium' ? 1.1 : 0.9;
  field.ridgeAmp = low ? 0.12 : 0.3;
  const nx = Math.ceil((X1 - X0) / step);
  const nz = Math.ceil((Z1 - Z0) / step);
  const vx = nx + 1, vz = nz + 1;
  const N = vx * vz;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const uv = new Float32Array(N * 2);
  const nor = new Float32Array(N * 3);
  const relief = new Float32Array(N);
  const cutV = new Uint8Array(N);
  const cBase = new THREE.Color('#f3f1f6');
  const cCool = new THREE.Color('#c7c3e8');
  const cWarm = new THREE.Color('#fbe9e0');
  const cIce = new THREE.Color('#d3dcf2');
  const cPath = new THREE.Color('#d4cacb');
  const cPave = new THREE.Color('#b4aca6');
  const c = new THREE.Color();
  const TU = 7.5; // detail texture tile (m)
  for (let j = 0; j < vz; j++) {
    for (let i = 0; i < vx; i++) {
      const k = j * vx + i;
      // Jitter interior vertices a little so the grid never reads.
      const edge = i === 0 || j === 0 || i === nx || j === nz;
      const x = Math.min(X1, X0 + i * step + (edge ? 0 : (rnd() - 0.5) * step * 0.35));
      const z = Math.min(Z1, Z0 + j * step + (edge ? 0 : (rnd() - 0.5) * step * 0.35));
      const cut = field.cut(x, z);
      cutV[k] = cut ? 1 : 0;
      const dr = cut ? { h: 0, near: 0, lee: 0 } : field.drift(x, z);
      const tr = cut ? 0 : field.trail(x, z);
      const y = cut ? -0.15 : dr.h * (1 - 0.92 * tr);
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      // Shading relief: flattened on paths and under drifts.
      const swept = 1 - 0.6 * smooth(43.3, 44.5, Math.abs(z));
      relief[k] = y + field.relief(x, z) * swept * (1 - 0.8 * tr) * (1 - smooth(0, 0.25, dr.h));
      // Colour.
      c.copy(cBase);
      const east = smooth(-55, 58, x);
      c.lerp(cCool, 0.3 * (1 - east));
      c.lerp(cWarm, 0.45 * east);
      // Hollows at wall feet (the drift's trough) cool; lee tails catch warm light.
      c.lerp(cCool, 0.32 * dr.near * (1 - smooth(0.05, 0.3, dr.h)));
      c.lerp(cWarm, 0.25 * dr.lee * smooth(0.04, 0.25, dr.h));
      // Wind-scoured glaze (open ground only).
      const u = x * WIND.x + z * WIND.y;
      const v = -x * WIND.y + z * WIND.x;
      const scour = smooth(0.58, 0.78, noise3(u * 0.05 + 2, 9.9, v * 0.22 - 1)) * (1 - smooth(0, 0.08, dr.h));
      c.lerp(cIce, 0.45 * scour * (1 - tr));
      // Compacted footpaths (broken, uneven).
      const pb = tr * (0.6 + 0.4 * noise3(x * 0.9, 4.4, z * 0.9));
      c.lerp(cPath, 0.55 * pb);
      // Spawn yards: swept and trodden over the station paving, scoured to the slabs in places.
      const yard = smooth(43.3, 44.5, Math.abs(z)) * (1 - smooth(60.2, 61, Math.abs(z)));
      if (yard > 0) {
        c.lerp(cPath, 0.35 * yard * (1 - smooth(0.05, 0.25, dr.h)));
        const slab = smooth(0.5, 0.68, noise3(u * 0.12 + 7, 5.5, v * 0.5)) * (1 - smooth(0.02, 0.15, dr.h));
        c.lerp(cPave, 0.55 * slab * yard);
      }
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
      uv[k * 2] = u / TU;
      uv[k * 2 + 1] = v / (TU * 0.5);
    }
  }
  // Normals from the (real + shading) relief.
  for (let j = 0; j < vz; j++) {
    for (let i = 0; i < vx; i++) {
      const k = j * vx + i;
      const kl = j * vx + Math.max(0, i - 1), kr = j * vx + Math.min(nx, i + 1);
      const kd = Math.max(0, j - 1) * vx + i, ku = Math.min(nz, j + 1) * vx + i;
      const dhx = (relief[kr] - relief[kl]) / (pos[kr * 3] - pos[kl * 3] || 1);
      const dhz = (relief[ku] - relief[kd]) / (pos[ku * 3 + 2] - pos[kd * 3 + 2] || 1);
      const l = Math.hypot(dhx, 1, dhz);
      nor[k * 3] = -dhx / l;
      nor[k * 3 + 1] = 1 / l;
      nor[k * 3 + 2] = -dhz / l;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * vx + i, b = a + 1, cc = a + vx, d = cc + 1;
      if (cutV[a] && cutV[b] && cutV[cc] && cutV[d]) continue;
      // Alternate the diagonal (no visible grain).
      if ((i + j) % 2 === 0) idx.push(a, cc, b, b, cc, d);
      else idx.push(a, cc, d, a, d, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();

  const detail = ctx.materials.canvasTexture(low ? 'obs.snowDetail.lo' : 'obs.snowDetail', low ? 256 : 512, low ? 256 : 512, paintSnowDetail);
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.colorSpace = THREE.SRGBColorSpace;
  const base = low
    ? new THREE.MeshLambertMaterial({ vertexColors: true, map: detail })
    : new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.72, metalness: 0 });
  base.name = 'obs.snowfield';
  const mat = sparkle(base);
  base.dispose();
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'obs.snowfield';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  // The field never casts into the low preset's baked sun shadow (grazing sun → acne).
  mesh.userData.hfCast = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();

  /** Decal height on the snow (+ a margin: the mesh's chords sit above the drift curve). */
  const onSnow = (x: number, z: number): number => {
    const h = Math.max(0, field.heightAt(x, z));
    return h + Math.min(0.05, h * 0.25);
  };
  // ── Footprints (one multiply-blended draw) ──
  let prints: THREE.Mesh | null = null;
  if (propTex) {
    const pp: number[] = [];
    const pu: number[] = [];
    const lanesMax = low ? 1 : 2;
    const tan = new THREE.Vector2();
    for (const t of field.trails) {
      const lanes = Math.min(lanesMax, t.prints);
      for (let lane = 0; lane < lanes; lane++) {
        const off = lanes > 1 ? (lane - 0.5) * t.w * 0.45 : (rnd() - 0.5) * 0.3;
        let carry = rnd() * 0.7;
        let foot = 0;
        for (let i = 0; i + 1 < t.pts.length; i++) {
          const [ax, az] = t.pts[i];
          const [bx, bz] = t.pts[i + 1];
          const len = Math.hypot(bx - ax, bz - az);
          tan.set((bx - ax) / len, (bz - az) / len);
          for (let s = carry; s < len; s += 0.74) {
            carry = s + 0.74 - len;
            foot ^= 1;
            if (rnd() < (low ? 0.35 : 0.12)) continue; // drifted over
            const side = (foot ? 1 : -1) * 0.13 + off + (rnd() - 0.5) * 0.08;
            const x = ax + tan.x * s - tan.y * side;
            const z = az + tan.y * s + tan.x * side;
            if (field.cut(x, z)) continue;
            const yaw = Math.atan2(tan.x, tan.y) + (rnd() - 0.5) * 0.25;
            const cy = Math.cos(yaw), sy = Math.sin(yaw);
            const hw = 0.09, hl = 0.19;
            const corners: P2[] = [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]];
            const uvs: P2[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
            const vs = corners.map(([lx, lz]) => {
              const wx = x + lx * cy + lz * sy;
              const wz = z - lx * sy + lz * cy;
              return [wx, onSnow(wx, wz) + 0.012, wz];
            });
            for (const q of [0, 2, 1, 0, 3, 2]) {
              pp.push(vs[q][0], vs[q][1], vs[q][2]);
              pu.push(uvs[q][0], uvs[q][1]);
            }
          }
        }
      }
    }
    // Footprint UVs: the prop atlas's 'print' region.
    const ua: number[] = [];
    const PR = printRect;
    for (let i = 0; i < pu.length; i += 2) ua.push(PR[0] + pu[i] * (PR[2] - PR[0]), PR[1] + pu[i + 1] * (PR[3] - PR[1]));
    // Vehicle tracks: strips of 'tread' quads along a curve (draped on the drifts).
    const TR = treadRect;
    for (const s of [1, -1]) {
      const curve = new THREE.CatmullRomCurve3(TRACK.map(([x, z]) => new THREE.Vector3(x, 0, s * z)), false, 'centripetal');
      const cat = s > 0;
      const segLen = cat ? 2.4 : 2.0;
      const n = Math.max(2, Math.round(curve.getLength() / segLen));
      const off = cat ? 1.07 : 1.25;
      const w = cat ? 0.8 : 0.2;
      const vA = cat ? TR[1] : TR[1] + (TR[3] - TR[1]) * 0.76;
      const vB = cat ? TR[1] + (TR[3] - TR[1]) * 0.7 : TR[3];
      const pts = curve.getSpacedPoints(n);
      for (const side of [-1, 1]) {
        for (let i = 0; i < n; i++) {
          const a = pts[i], b = pts[i + 1];
          const tx = b.x - a.x, tz = b.z - a.z;
          const tl = Math.hypot(tx, tz) || 1;
          const px = tz / tl, pz = -tx / tl;
          const q = (p: THREE.Vector3, k: number): number[] => {
            const x = p.x + px * (off * side + k * w * 0.5);
            const z = p.z + pz * (off * side + k * w * 0.5);
            return [x, onSnow(x, z) + 0.014, z];
          };
          const A0 = q(a, -1), A1 = q(a, 1), B0 = q(b, -1), B1 = q(b, 1);
          const quadV = [A0, B0, B1, A0, B1, A1];
          const quadU = [[TR[0], vA], [TR[2], vA], [TR[2], vB], [TR[0], vA], [TR[2], vB], [TR[0], vB]];
          // Keep the winding facing up whichever way the strip runs.
          const up = (B0[0] - A0[0]) * (A1[2] - A0[2]) - (B0[2] - A0[2]) * (A1[0] - A0[0]) < 0;
          const order = up ? [0, 1, 2, 3, 4, 5] : [0, 2, 1, 3, 5, 4];
          for (const o of order) {
            pp.push(...quadV[o]);
            ua.push(quadU[o][0], quadU[o][1]);
          }
        }
      }
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
    pg.setAttribute('uv', new THREE.Float32BufferAttribute(ua, 2));
    pg.computeBoundingSphere();
    const pm = new THREE.MeshBasicMaterial({
      map: propTex,
      transparent: true,
      depthWrite: false,
      fog: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.ZeroFactor,
      blendEquation: THREE.AddEquation,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    pm.name = 'obs.footprints';
    owned.push(pm);
    prints = new THREE.Mesh(pg, pm);
    prints.name = 'obs.footprints';
    prints.renderOrder = 2;
    prints.matrixAutoUpdate = false;
    prints.updateMatrix();
    prints.userData.hfCast = false;
  }

  return {
    mesh,
    prints,
    sparkle,
    owned,
    dispose(): void {
      g.dispose();
      mesh.removeFromParent();
      if (prints) {
        prints.geometry.dispose();
        prints.removeFromParent();
      }
      for (const m of owned) m.dispose();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — GPU-friendly particle pools.
//
// One pool = ONE instanced draw call: a unit quad instanced N times, all
// per-particle data in preallocated typed arrays (no allocation per frame).
// Billboarding, rotation, velocity stretching (tracers / sparks) and a fake
// 3D tumble ("flip", for shards and petals) happen in the vertex shader; an
// 8×4 procedural sprite atlas provides the shapes. Fog fades particles into
// the haze (additive → toward black, alpha → toward the fog color).
//
// Dissolve support: a particle can HOLD in place for `delay` seconds before it
// starts to live (eliminations build the body's silhouette out of held petals /
// flakes and release them from the feet up), ORBIT a vertical axis (spiral
// drift) and shift its colour over its life (`r1 g1 b1`).
//
// Slots are fixed (free-list), so effects can hold "managed" particles (smoke
// puffs, beam sparkles) and move them every frame through `set*` accessors.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { makeCanvas } from './textures';

/** Atlas cells (8 columns × 4 rows). */
export const SPRITE = {
  glow: 0,
  starburst: 1,
  streak: 2,
  petal: 3,
  shard: 4,
  ring: 5,
  smoke: 6,
  leaf: 7,
  paper: 8,
  star: 9,
  prism: 10,
  dust: 11,
  ember: 12,
  flare: 13,
  droplet: 14,
  chunk: 15,
  /** Long luminous petal: pointed tip, bright heart, soft edge (Bloom dissolve). */
  petalLight: 16,
  /** Thin 4-point sparkle (sun glints on ceramic, star twinkles). */
  glint: 17,
  /** Soft vertical capsule glow (a body part's luminous ghost). */
  ghost: 18,
  /** Irregular ash / char flake (alpha pool, tinted dark). */
  ash: 19,
  /** The same flake's glowing rim (additive, tinted ember orange). */
  emberRim: 20,
  /** 6-ray twinkling star with a halo. */
  twinkle: 21,
  /** Thin soft ring (ground shock rings). */
  softRing: 22,
  /** Soft light orb with a brighter rim (bokeh mote). */
  bokeh: 23,
} as const;

const ATLAS_COLS = 8;
const ATLAS_ROWS = 4;

export interface Particle {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  /** Seconds. */
  life: number;
  size: number;
  /** Size at end of life (default = size). */
  size1?: number;
  rot?: number;
  spin?: number;
  r: number;
  g: number;
  b: number;
  /** Start alpha (default 1). */
  a?: number;
  /** End alpha (default 0). */
  a1?: number;
  /** Fraction of life spent fading in (default 0). */
  fadeIn?: number;
  /** Velocity damping per second (0 = none, 1 = strong). */
  drag?: number;
  /** Downward acceleration (m/s²). */
  gravity?: number;
  sprite?: number;
  /** Stretch along screen-space velocity: quad length = size + stretch·|v|. */
  stretch?: number;
  /** Tumble rate (rad/s) for the fake 3D flip (0 = none). */
  flip?: number;
  /** Swirl strength (m/s) — gentle curl around the vertical axis. */
  swirl?: number;
  /** Seconds held motionless (age < 0) before the particle starts to live. */
  delay?: number;
  /** Alpha multiplier while held (default 1). */
  holdA?: number;
  /** Spiral drift: rad/s around the vertical axis through (ox, oz). */
  orbit?: number;
  ox?: number;
  oz?: number;
  /** End-of-life colour (default = start colour). */
  r1?: number;
  g1?: number;
  b1?: number;
}

const VERT = /* glsl */ `
uniform float uHalfH;
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec4 iMisc;   // size, rot, sprite, flip
attribute vec4 iVel;    // velocity xyz, stretch
varying vec2 vUv;
varying vec4 vColor;
varying float vFogDepth;
void main() {
  float size = iMisc.x;
  float rot = iMisc.y;
  float sprite = iMisc.z;
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  vec2 c = position.xy;
  vec2 off;
  if (iVel.w > 0.0) {
    vec3 vv = mat3(viewMatrix) * iVel.xyz;
    float l = length(vv.xy);
    vec2 dir = l > 1e-4 ? vv.xy / l : vec2(0.0, 1.0);
    float len = size + iVel.w * l;
    // Minimum on-screen width (~1.2 px) so far tracers stay readable.
    float pxW = size * projectionMatrix[1][1] * uHalfH / max(-mv.z, 0.05);
    float w = size * max(1.0, 1.2 / max(pxW, 1e-4));
    off = dir * c.y * len + vec2(-dir.y, dir.x) * c.x * w;
  } else {
    float cs = cos(rot), sn = sin(rot);
    vec2 q = vec2(c.x * iMisc.w, c.y);
    off = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs) * size;
  }
  mv.xy += off;
  gl_Position = projectionMatrix * mv;
  float col = mod(sprite, 8.0);
  float row = floor(sprite / 8.0);
  vUv = (vec2(col, 3.0 - row) + (c + 0.5)) * vec2(0.125, 0.25);
  vColor = iColor;
  vFogDepth = -mv.z;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 fogColor;
uniform float fogDensity;
uniform float uAdditive;
varying vec2 vUv;
varying vec4 vColor;
varying float vFogDepth;
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  float a = t.a * vColor.a;
  if (a < 0.004) discard;
  vec3 col = t.rgb * vColor.rgb;
  float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  if (uAdditive > 0.5) {
    gl_FragColor = vec4(col * a * (1.0 - fogF), 1.0);
  } else {
    gl_FragColor = vec4(mix(col, fogColor, fogF), a);
  }
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

let atlasTex: THREE.Texture | null = null;
let glowTex: THREE.Texture | null = null;
let flashTex: THREE.Texture | null = null;

/** Muzzle-flash atlas cells (4×2): one crisp starburst silhouette per weapon + flame lobe. */
export const FLASH_CELL = {
  meridian: 0,
  swift: 1,
  longline: 2,
  breaker: 3,
  pulse: 4,
  sunspear: 5,
  flame: 6,
  core: 7,
} as const;

/**
 * 512×256 atlas of stylized muzzle-flash silhouettes (white; tinted per weapon).
 * Each weapon reads differently at a glance: Meridian = balanced 8-point star,
 * Swift = tight 6-point, Longline = long 4-point cross, Breaker = wide blossom,
 * Pulse = electronic ring with ticks, Sunspear = 16-ray corona.
 */
export function flashAtlas(): THREE.Texture {
  if (flashTex) return flashTex;
  const C = 128;
  const cv = makeCanvas(C * 4, C * 2);
  const x = cv.getContext('2d') as CanvasRenderingContext2D;
  x.clearRect(0, 0, cv.width, cv.height);
  const cell = (i: number, draw: (cx: number, cy: number, r: number) => void): void => {
    const cx = (i % 4) * C + C / 2;
    const cy = Math.floor(i / 4) * C + C / 2;
    x.save();
    x.beginPath();
    x.rect(cx - C / 2, cy - C / 2, C, C);
    x.clip();
    draw(cx, cy, C / 2 - 3);
    x.restore();
  };
  const core = (cx: number, cy: number, r: number, a = 1): void => {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.45, `rgba(255,255,255,${a * 0.75})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  /** Tapered spikes: n rays, lengths from `len(i)`, base half-width `w` (radians). */
  const rays = (cx: number, cy: number, n: number, len: (i: number) => number, w: number, rot = 0, inner = 0.14): void => {
    x.fillStyle = '#fff';
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      const l = len(i);
      x.beginPath();
      x.moveTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l);
      x.lineTo(cx + Math.cos(a + w) * l * inner, cy + Math.sin(a + w) * l * inner);
      x.lineTo(cx + Math.cos(a - w) * l * inner, cy + Math.sin(a - w) * l * inner);
      x.closePath();
      x.fill();
    }
  };
  // Meridian: balanced 8-point star, alternating long/short.
  cell(FLASH_CELL.meridian, (cx, cy, r) => {
    rays(cx, cy, 8, (i) => r * (i % 2 ? 0.6 : 0.98), 0.17, 0.1);
    core(cx, cy, r * 0.5);
  });
  // Swift: tight, small 6-point.
  cell(FLASH_CELL.swift, (cx, cy, r) => {
    rays(cx, cy, 6, (i) => r * (i % 2 ? 0.62 : 0.8), 0.2, 0.3, 0.2);
    core(cx, cy, r * 0.42);
  });
  // Longline: long crisp 4-point cross + faint diagonals.
  cell(FLASH_CELL.longline, (cx, cy, r) => {
    rays(cx, cy, 4, () => r, 0.07, 0, 0.1);
    rays(cx, cy, 4, () => r * 0.42, 0.14, Math.PI / 4, 0.18);
    core(cx, cy, r * 0.46);
  });
  // Breaker: wide, fat 12-petal blossom.
  cell(FLASH_CELL.breaker, (cx, cy, r) => {
    rays(cx, cy, 12, (i) => r * (0.72 + ((i * 7) % 5) * 0.07), 0.24, 0.05, 0.3);
    core(cx, cy, r * 0.62);
  });
  // Pulse: electronic — thin ring, 4 ticks, compact core.
  cell(FLASH_CELL.pulse, (cx, cy, r) => {
    x.strokeStyle = 'rgba(255,255,255,0.95)';
    x.lineWidth = r * 0.07;
    x.beginPath();
    x.arc(cx, cy, r * 0.56, 0, Math.PI * 2);
    x.stroke();
    rays(cx, cy, 4, () => r * 0.9, 0.09, Math.PI / 4, 0.62);
    core(cx, cy, r * 0.4);
  });
  // Sunspear: 16-ray corona with a halo ring.
  cell(FLASH_CELL.sunspear, (cx, cy, r) => {
    rays(cx, cy, 16, (i) => r * (i % 2 ? 0.66 : 0.98) * (i % 4 === 0 ? 1 : 0.9), 0.1, 0);
    x.strokeStyle = 'rgba(255,255,255,0.6)';
    x.lineWidth = r * 0.05;
    x.beginPath();
    x.arc(cx, cy, r * 0.72, 0, Math.PI * 2);
    x.stroke();
    core(cx, cy, r * 0.55);
  });
  // Side flame lobe: base at the bottom of the cell (UV v = 0 → muzzle), tip at the top.
  cell(FLASH_CELL.flame, (cx, cy, r) => {
    const g = x.createLinearGradient(0, cy + r, 0, cy - r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(cx, cy + r);
    x.bezierCurveTo(cx + r * 0.5, cy + r * 0.55, cx + r * 0.22, cy - r * 0.35, cx, cy - r);
    x.bezierCurveTo(cx - r * 0.22, cy - r * 0.35, cx - r * 0.5, cy + r * 0.55, cx, cy + r);
    x.fill();
  });
  cell(FLASH_CELL.core, (cx, cy, r) => core(cx, cy, r));
  flashTex = new THREE.CanvasTexture(cv);
  flashTex.colorSpace = THREE.SRGBColorSpace;
  flashTex.generateMipmaps = true;
  return flashTex;
}

/** Small soft radial glow texture (sprites, blinking lights). */
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = makeCanvas(64, 64);
  const x = c.getContext('2d') as CanvasRenderingContext2D;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/** The shared 1024×512 procedural sprite atlas (white shapes; tinted per particle). */
export function particleAtlas(): THREE.Texture {
  if (atlasTex) return atlasTex;
  const C = 128;
  const cv = makeCanvas(C * ATLAS_COLS, C * ATLAS_ROWS);
  const x = cv.getContext('2d') as CanvasRenderingContext2D;
  x.clearRect(0, 0, cv.width, cv.height);
  const cell = (i: number, draw: (cx: number, cy: number, r: number) => void): void => {
    const cx = (i % ATLAS_COLS) * C + C / 2;
    const cy = Math.floor(i / ATLAS_COLS) * C + C / 2;
    x.save();
    x.beginPath();
    x.rect(cx - C / 2, cy - C / 2, C, C);
    x.clip();
    draw(cx, cy, C / 2 - 2);
    x.restore();
  };
  const radial = (cx: number, cy: number, r: number, stops: [number, number][]): void => {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    for (const [o, a] of stops) g.addColorStop(o, `rgba(255,255,255,${a})`);
    x.fillStyle = g;
    x.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  let seed = 7;
  const rnd = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  // 0 glow
  cell(0, (cx, cy, r) => radial(cx, cy, r, [[0, 1], [0.2, 0.7], [0.5, 0.2], [1, 0]]));
  // 1 starburst: 8 tapered spikes + hot core.
  cell(1, (cx, cy, r) => {
    x.fillStyle = '#fff';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + (i % 2) * 0.12;
      const len = r * (i % 2 ? 0.62 : 0.98);
      x.beginPath();
      x.moveTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      x.lineTo(cx + Math.cos(a + 0.16) * r * 0.16, cy + Math.sin(a + 0.16) * r * 0.16);
      x.lineTo(cx + Math.cos(a - 0.16) * r * 0.16, cy + Math.sin(a - 0.16) * r * 0.16);
      x.closePath();
      x.fill();
    }
    radial(cx, cy, r * 0.55, [[0, 1], [0.5, 0.8], [1, 0]]);
  });
  // 2 streak (vertical): bright line with soft falloff.
  cell(2, (cx, cy, r) => {
    const g = x.createLinearGradient(cx - r * 0.18, 0, cx + r * 0.18, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath();
    x.ellipse(cx, cy, r * 0.18, r, 0, 0, Math.PI * 2);
    x.fill();
  });
  // 3 petal (soft teardrop).
  cell(3, (cx, cy, r) => {
    const g = x.createRadialGradient(cx, cy + r * 0.2, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(cx, cy - r * 0.95);
    x.bezierCurveTo(cx + r * 0.75, cy - r * 0.2, cx + r * 0.5, cy + r * 0.8, cx, cy + r * 0.9);
    x.bezierCurveTo(cx - r * 0.5, cy + r * 0.8, cx - r * 0.75, cy - r * 0.2, cx, cy - r * 0.95);
    x.fill();
  });
  // 4 shard: crisp angular ceramic fragment with a lighter facet.
  cell(4, (cx, cy, r) => {
    x.fillStyle = 'rgba(255,255,255,1)';
    x.beginPath();
    x.moveTo(cx - r * 0.7, cy + r * 0.6);
    x.lineTo(cx + r * 0.1, cy - r * 0.9);
    x.lineTo(cx + r * 0.8, cy + r * 0.3);
    x.lineTo(cx + r * 0.1, cy + r * 0.8);
    x.closePath();
    x.fill();
    x.fillStyle = 'rgba(200,196,188,1)';
    x.beginPath();
    x.moveTo(cx + r * 0.1, cy - r * 0.9);
    x.lineTo(cx + r * 0.8, cy + r * 0.3);
    x.lineTo(cx + r * 0.1, cy + r * 0.8);
    x.closePath();
    x.fill();
  });
  // 5 ring.
  cell(5, (cx, cy, r) => {
    x.strokeStyle = 'rgba(255,255,255,1)';
    x.lineWidth = r * 0.12;
    x.shadowColor = '#fff';
    x.shadowBlur = r * 0.15;
    x.beginPath();
    x.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
    x.stroke();
  });
  // 6 smoke puff: clustered soft blobs.
  cell(6, (cx, cy, r) => {
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2;
      const d = rnd() * r * 0.4;
      radial(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * (0.35 + rnd() * 0.25), [[0, 0.35], [1, 0]]);
    }
  });
  // 7 leaf with a vein.
  cell(7, (cx, cy, r) => {
    x.fillStyle = 'rgba(255,255,255,1)';
    x.beginPath();
    x.moveTo(cx, cy - r * 0.9);
    x.quadraticCurveTo(cx + r * 0.7, cy, cx, cy + r * 0.9);
    x.quadraticCurveTo(cx - r * 0.7, cy, cx, cy - r * 0.9);
    x.fill();
    x.strokeStyle = 'rgba(170,170,170,1)';
    x.lineWidth = 3;
    x.beginPath();
    x.moveTo(cx, cy - r * 0.8);
    x.lineTo(cx, cy + r * 0.85);
    x.stroke();
  });
  // 8 paper (folded triangle, two tones).
  cell(8, (cx, cy, r) => {
    x.fillStyle = 'rgba(255,255,255,1)';
    x.beginPath();
    x.moveTo(cx - r * 0.8, cy - r * 0.7);
    x.lineTo(cx + r * 0.8, cy - r * 0.5);
    x.lineTo(cx, cy + r * 0.85);
    x.closePath();
    x.fill();
    x.fillStyle = 'rgba(215,212,205,1)';
    x.beginPath();
    x.moveTo(cx + r * 0.8, cy - r * 0.5);
    x.lineTo(cx, cy + r * 0.85);
    x.lineTo(cx + r * 0.05, cy - r * 0.6);
    x.closePath();
    x.fill();
  });
  // 9 four-point star.
  cell(9, (cx, cy, r) => {
    x.fillStyle = '#fff';
    x.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 ? r * 0.18 : r * 0.95;
      x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    x.closePath();
    x.fill();
    radial(cx, cy, r * 0.5, [[0, 0.9], [1, 0]]);
  });
  // 10 prism (hexagonal crystal with facets).
  cell(10, (cx, cy, r) => {
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2;
      const a1 = ((i + 1) / 6) * Math.PI * 2;
      x.fillStyle = `rgba(255,255,255,${0.55 + (i % 3) * 0.2})`;
      x.beginPath();
      x.moveTo(cx, cy);
      x.lineTo(cx + Math.cos(a0) * r * 0.85, cy + Math.sin(a0) * r * 0.85);
      x.lineTo(cx + Math.cos(a1) * r * 0.85, cy + Math.sin(a1) * r * 0.85);
      x.closePath();
      x.fill();
    }
  });
  // 11 dust puff (soft, grainy).
  cell(11, (cx, cy, r) => {
    radial(cx, cy, r, [[0, 0.8], [0.6, 0.35], [1, 0]]);
    for (let i = 0; i < 160; i++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * r * 0.8;
      x.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.3})`;
      x.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 3, 3);
    }
  });
  // 12 ember.
  cell(12, (cx, cy, r) => radial(cx, cy, r * 0.6, [[0, 1], [0.3, 0.9], [1, 0]]));
  // 13 flare cross (for impact / spawn glints).
  cell(13, (cx, cy, r) => {
    radial(cx, cy, r * 0.4, [[0, 1], [1, 0]]);
    for (const [w, h] of [[r * 0.07, r], [r, r * 0.07]]) {
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.beginPath();
      x.ellipse(cx, cy, w, h, 0, 0, Math.PI * 2);
      x.fill();
    }
  });
  // 14 droplet.
  cell(14, (cx, cy, r) => {
    x.fillStyle = 'rgba(255,255,255,0.9)';
    x.beginPath();
    x.moveTo(cx, cy - r * 0.8);
    x.quadraticCurveTo(cx + r * 0.5, cy + r * 0.2, cx, cy + r * 0.6);
    x.quadraticCurveTo(cx - r * 0.5, cy + r * 0.2, cx, cy - r * 0.8);
    x.fill();
  });
  // 15 debris chunk (irregular polygon).
  cell(15, (cx, cy, r) => {
    x.fillStyle = 'rgba(255,255,255,1)';
    x.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rnd() * 0.5;
      const rr = r * (0.45 + rnd() * 0.4);
      x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    x.closePath();
    x.fill();
  });
  // 16 luminous petal: pointed tip up, rounded heart, bright core near the base,
  // a faint central vein and a soft glowing edge (reads as light, not paper).
  cell(16, (cx, cy, r) => {
    const petal = (k: number): void => {
      x.beginPath();
      x.moveTo(cx, cy - r * 0.96 * k);
      x.bezierCurveTo(cx + r * 0.62 * k, cy - r * 0.42 * k, cx + r * 0.52 * k, cy + r * 0.62 * k, cx, cy + r * 0.86 * k);
      x.bezierCurveTo(cx - r * 0.52 * k, cy + r * 0.62 * k, cx - r * 0.62 * k, cy - r * 0.42 * k, cx, cy - r * 0.96 * k);
      x.closePath();
    };
    x.save();
    x.shadowColor = 'rgba(255,255,255,0.9)';
    x.shadowBlur = r * 0.16;
    const g = x.createRadialGradient(cx, cy + r * 0.32, 0, cx, cy + r * 0.1, r * 0.95);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.78)');
    g.addColorStop(1, 'rgba(255,255,255,0.42)');
    x.fillStyle = g;
    petal(0.92);
    x.fill();
    x.restore();
    x.strokeStyle = 'rgba(255,255,255,0.55)';
    x.lineWidth = r * 0.04;
    x.beginPath();
    x.moveTo(cx, cy + r * 0.7);
    x.quadraticCurveTo(cx + r * 0.05, cy, cx, cy - r * 0.7);
    x.stroke();
  });
  // 17 glint: thin 4-point sparkle, long vertical/horizontal rays, short diagonals.
  cell(17, (cx, cy, r) => {
    const ray = (a: number, len: number, w: number): void => {
      const g = x.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.beginPath();
      x.moveTo(cx + Math.cos(a + Math.PI / 2) * w, cy + Math.sin(a + Math.PI / 2) * w);
      x.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      x.lineTo(cx + Math.cos(a - Math.PI / 2) * w, cy + Math.sin(a - Math.PI / 2) * w);
      x.closePath();
      x.fill();
    };
    for (let i = 0; i < 4; i++) ray((i * Math.PI) / 2, r * 0.98, r * 0.06);
    for (let i = 0; i < 4; i++) ray(Math.PI / 4 + (i * Math.PI) / 2, r * 0.42, r * 0.04);
    radial(cx, cy, r * 0.3, [[0, 1], [0.4, 0.6], [1, 0]]);
  });
  // 18 ghost: soft vertical capsule glow.
  cell(18, (cx, cy, r) => {
    x.save();
    x.translate(cx, cy);
    x.scale(0.5, 1);
    const g = x.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(-r, -r, r * 2, r * 2);
    x.restore();
  });
  // 19 ash flake + 20 its glowing rim: the same jagged outline (seeded), filled / stroked.
  const flakePts: [number, number][] = [];
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + (rnd() - 0.5) * 0.35;
    flakePts.push([Math.cos(a) * (0.5 + rnd() * 0.38), Math.sin(a) * (0.5 + rnd() * 0.38)]);
  }
  const flake = (cx: number, cy: number, r: number): void => {
    x.beginPath();
    flakePts.forEach(([px, py], i) => (i ? x.lineTo(cx + px * r, cy + py * r) : x.moveTo(cx + px * r, cy + py * r)));
    x.closePath();
  };
  cell(19, (cx, cy, r) => {
    x.fillStyle = 'rgba(255,255,255,1)';
    flake(cx, cy, r);
    x.fill();
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * r * 0.45;
      x.fillStyle = `rgba(150,150,150,${0.25 + rnd() * 0.35})`;
      x.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 4, 4);
    }
  });
  cell(20, (cx, cy, r) => {
    x.save();
    x.shadowColor = '#fff';
    x.shadowBlur = r * 0.18;
    x.strokeStyle = 'rgba(255,255,255,1)';
    x.lineWidth = r * 0.1;
    x.lineJoin = 'round';
    flake(cx, cy, r);
    x.stroke();
    x.restore();
    radial(cx, cy, r * 0.6, [[0, 0.18], [1, 0]]);
  });
  // 21 twinkle: 6 rays (2 long) with a soft halo.
  cell(21, (cx, cy, r) => {
    radial(cx, cy, r * 0.7, [[0, 0.5], [0.3, 0.18], [1, 0]]);
    x.fillStyle = '#fff';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const len = r * (i % 3 === 0 ? 0.98 : 0.5);
      x.beginPath();
      x.moveTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      x.lineTo(cx + Math.cos(a + 0.5) * r * 0.08, cy + Math.sin(a + 0.5) * r * 0.08);
      x.lineTo(cx + Math.cos(a - 0.5) * r * 0.08, cy + Math.sin(a - 0.5) * r * 0.08);
      x.closePath();
      x.fill();
    }
    radial(cx, cy, r * 0.22, [[0, 1], [1, 0]]);
  });
  // 22 soft ring.
  cell(22, (cx, cy, r) => {
    const g = x.createRadialGradient(cx, cy, r * 0.55, cx, cy, r * 0.98);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(cx - r, cy - r, r * 2, r * 2);
  });
  // 23 bokeh orb: soft disc, slightly brighter rim.
  cell(23, (cx, cy, r) => {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r * 0.8);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.7)');
    g.addColorStop(0.9, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(cx - r, cy - r, r * 2, r * 2);
  });
  atlasTex = new THREE.CanvasTexture(cv);
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.generateMipmaps = true;
  return atlasTex;
}

function markRange(attr: THREE.InstancedBufferAttribute, count: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, count);
  attr.needsUpdate = true;
}

export class ParticlePool {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private cap: number;
  // Simulation state (SoA).
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private age: Float32Array; private life: Float32Array;
  private s0: Float32Array; private s1: Float32Array;
  private rot: Float32Array; private spin: Float32Array; private flip: Float32Array;
  private cr: Float32Array; private cg: Float32Array; private cb: Float32Array;
  private a0: Float32Array; private a1: Float32Array; private fin: Float32Array;
  private drag: Float32Array; private grav: Float32Array; private swirl: Float32Array;
  private sprite: Float32Array; private stretch: Float32Array;
  private holdA: Float32Array;
  private orb: Float32Array; private ox: Float32Array; private oz: Float32Array;
  private cr1: Float32Array; private cg1: Float32Array; private cb1: Float32Array;
  private alive: Uint8Array;
  private managed: Uint8Array;
  /** Spawned since the last update: shown once before it starts aging, so short-lived
   *  particles (tracers, sparks) still reach the screen when dt > life (low fps). */
  private fresh: Uint8Array;
  private free: Int32Array;
  private freeTop = 0;
  // GPU buffers.
  private iPos: THREE.InstancedBufferAttribute;
  private iColor: THREE.InstancedBufferAttribute;
  private iMisc: THREE.InstancedBufferAttribute;
  private iVel: THREE.InstancedBufferAttribute;
  private live = 0;

  constructor(scene: THREE.Scene, capacity: number, readonly additive: boolean, name: string) {
    this.cap = Math.max(16, capacity | 0);
    const n = this.cap;
    const F = (): Float32Array => new Float32Array(n);
    this.px = F(); this.py = F(); this.pz = F();
    this.vx = F(); this.vy = F(); this.vz = F();
    this.age = F(); this.life = F();
    this.s0 = F(); this.s1 = F();
    this.rot = F(); this.spin = F(); this.flip = F();
    this.cr = F(); this.cg = F(); this.cb = F();
    this.a0 = F(); this.a1 = F(); this.fin = F();
    this.drag = F(); this.grav = F(); this.swirl = F();
    this.sprite = F(); this.stretch = F();
    this.holdA = F();
    this.orb = F(); this.ox = F(); this.oz = F();
    this.cr1 = F(); this.cg1 = F(); this.cb1 = F();
    this.alive = new Uint8Array(n);
    this.managed = new Uint8Array(n);
    this.fresh = new Uint8Array(n);
    this.free = new Int32Array(n);
    for (let i = 0; i < n; i++) this.free[i] = n - 1 - i;
    this.freeTop = n;

    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iMisc = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iVel = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.iPos);
    g.setAttribute('iColor', this.iColor);
    g.setAttribute('iMisc', this.iMisc);
    g.setAttribute('iVel', this.iVel);
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: particleAtlas() },
        uAdditive: { value: additive ? 1 : 0 },
        fogColor: { value: new THREE.Color() },
        fogDensity: { value: 0 },
        uHalfH: { value: 360 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.name = `particles.${name}`;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 30 : 25;
    scene.add(this.mesh);
  }

  get capacity(): number {
    return this.cap;
  }

  get count(): number {
    return this.live;
  }

  /** Spawns a particle; returns its slot or −1 when the pool is full. */
  spawn(p: Particle, managed = false): number {
    if (this.freeTop <= 0) return -1;
    const i = this.free[--this.freeTop];
    this.alive[i] = 1;
    this.managed[i] = managed ? 1 : 0;
    this.fresh[i] = 1;
    this.px[i] = p.x; this.py[i] = p.y; this.pz[i] = p.z;
    this.vx[i] = p.vx ?? 0; this.vy[i] = p.vy ?? 0; this.vz[i] = p.vz ?? 0;
    this.age[i] = -Math.max(0, p.delay ?? 0);
    this.life[i] = Math.max(0.001, p.life);
    this.s0[i] = p.size;
    this.s1[i] = p.size1 ?? p.size;
    this.rot[i] = p.rot ?? 0;
    this.spin[i] = p.spin ?? 0;
    this.flip[i] = p.flip ?? 0;
    this.cr[i] = p.r; this.cg[i] = p.g; this.cb[i] = p.b;
    this.a0[i] = p.a ?? 1;
    this.a1[i] = p.a1 ?? 0;
    this.fin[i] = p.fadeIn ?? 0;
    this.drag[i] = p.drag ?? 0;
    this.grav[i] = p.gravity ?? 0;
    this.swirl[i] = p.swirl ?? 0;
    this.sprite[i] = p.sprite ?? 0;
    this.stretch[i] = p.stretch ?? 0;
    this.holdA[i] = p.holdA ?? 1;
    this.orb[i] = p.orbit ?? 0;
    this.ox[i] = p.ox ?? p.x;
    this.oz[i] = p.oz ?? p.z;
    this.cr1[i] = p.r1 ?? p.r;
    this.cg1[i] = p.g1 ?? p.g;
    this.cb1[i] = p.b1 ?? p.b;
    return i;
  }

  kill(i: number): void {
    if (i < 0 || i >= this.cap || !this.alive[i]) return;
    this.alive[i] = 0;
    this.managed[i] = 0;
    this.free[this.freeTop++] = i;
  }

  /** Managed particle accessors (positions/size/alpha driven by the caller). */
  setPos(i: number, x: number, y: number, z: number): void {
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
  }
  setSize(i: number, s: number): void {
    this.s0[i] = s;
    this.s1[i] = s;
  }
  setAlpha(i: number, a: number): void {
    this.a0[i] = a;
    this.a1[i] = a;
  }
  setColor(i: number, r: number, g: number, b: number): void {
    this.cr[i] = r;
    this.cg[i] = g;
    this.cb[i] = b;
    this.cr1[i] = r;
    this.cg1[i] = g;
    this.cb1[i] = b;
  }
  setRot(i: number, r: number): void {
    this.rot[i] = r;
  }

  clear(): void {
    for (let i = 0; i < this.cap; i++) if (this.alive[i]) this.kill(i);
  }

  update(dt: number, fog: THREE.Fog | THREE.FogExp2 | null): void {
    const u = this.mat.uniforms;
    if (fog && (fog as THREE.FogExp2).isFogExp2) {
      (u.fogColor.value as THREE.Color).copy(fog.color);
      u.fogDensity.value = (fog as THREE.FogExp2).density;
    } else u.fogDensity.value = 0;

    const P = this.iPos.array as Float32Array;
    const C = this.iColor.array as Float32Array;
    const M = this.iMisc.array as Float32Array;
    const V = this.iVel.array as Float32Array;
    let n = 0;
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) continue;
      const managed = this.managed[i] === 1;
      let t = 0;
      let held = false;
      const fdt = this.fresh[i] ? 0 : dt;
      this.fresh[i] = 0;
      if (!managed) {
        const age0 = this.age[i];
        this.age[i] += fdt;
        if (this.age[i] < 0) {
          // Still holding its place (dissolve silhouettes): no motion yet.
          held = true;
        } else {
          // Only the part of this frame after the release moves the particle.
          const dt = age0 < 0 ? this.age[i] : fdt;
          t = this.age[i] / this.life[i];
          if (t >= 1) {
            this.kill(i);
            continue;
          }
          const d = this.drag[i];
          if (d > 0) {
            const k = Math.exp(-d * dt);
            this.vx[i] *= k;
            this.vy[i] *= k;
            this.vz[i] *= k;
          }
          this.vy[i] -= this.grav[i] * dt;
          const sw = this.swirl[i];
          if (sw !== 0) {
            const ph = this.age[i] * 2.1 + i;
            this.vx[i] += Math.cos(ph) * sw * dt;
            this.vz[i] += Math.sin(ph) * sw * dt;
          }
          this.px[i] += this.vx[i] * dt;
          this.py[i] += this.vy[i] * dt;
          this.pz[i] += this.vz[i] * dt;
          const ob = this.orb[i];
          if (ob !== 0) {
            // Spiral: position and velocity co-rotate about the vertical axis.
            const a = ob * dt;
            const cs = Math.cos(a), sn = Math.sin(a);
            const rx = this.px[i] - this.ox[i], rz = this.pz[i] - this.oz[i];
            this.px[i] = this.ox[i] + rx * cs - rz * sn;
            this.pz[i] = this.oz[i] + rx * sn + rz * cs;
            const vx = this.vx[i], vz = this.vz[i];
            this.vx[i] = vx * cs - vz * sn;
            this.vz[i] = vx * sn + vz * cs;
          }
          this.rot[i] += this.spin[i] * dt;
        }
      }
      const fi = this.fin[i];
      let alpha = this.a0[i] + (this.a1[i] - this.a0[i]) * t;
      if (held) alpha *= this.holdA[i];
      else if (fi > 0 && t < fi) alpha *= t / fi;
      const size = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      P[n * 3] = this.px[i];
      P[n * 3 + 1] = this.py[i];
      P[n * 3 + 2] = this.pz[i];
      C[n * 4] = this.cr[i] + (this.cr1[i] - this.cr[i]) * t;
      C[n * 4 + 1] = this.cg[i] + (this.cg1[i] - this.cg[i]) * t;
      C[n * 4 + 2] = this.cb[i] + (this.cb1[i] - this.cb[i]) * t;
      C[n * 4 + 3] = alpha;
      M[n * 4] = size;
      M[n * 4 + 1] = this.rot[i];
      M[n * 4 + 2] = this.sprite[i];
      // Held pieces face the camera; the tumble starts at the release (cos 0 = 1).
      M[n * 4 + 3] = this.flip[i] !== 0 && !held ? Math.cos(this.age[i] * this.flip[i]) : 1;
      V[n * 4] = held ? 0 : this.vx[i];
      V[n * 4 + 1] = held ? 0 : this.vy[i];
      V[n * 4 + 2] = held ? 0 : this.vz[i];
      V[n * 4 + 3] = this.stretch[i];
      n++;
    }
    this.live = n;
    this.geo.instanceCount = n;
    if (n > 0) {
      // (No array literal here: this runs every frame.)
      markRange(this.iPos, n * 3);
      markRange(this.iColor, n * 4);
      markRange(this.iMisc, n * 4);
      markRange(this.iVel, n * 4);
    }
    // Nothing alive → skip the draw entirely (an empty instanced draw still
    // costs a draw call + state changes in three).
    this.mesh.visible = n > 0;
  }

  /**
   * Viewport height in device pixels: streaks (tracers, sparks) are kept at
   * least ~1.2 px wide so distant tracers stay readable instead of vanishing
   * into sub-pixel shimmer.
   */
  setViewportHeight(px: number): void {
    this.mat.uniforms.uHalfH.value = Math.max(1, px) * 0.5;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

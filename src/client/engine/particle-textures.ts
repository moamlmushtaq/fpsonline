// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — procedural effect textures: the particle sprite atlas (8×4
// cells, white shapes tinted per particle), the muzzle-flash atlas and a soft
// glow. Drawn once on a canvas at first use.
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

export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 4;

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
    x.shadowBlur = r * 0.1;
    x.strokeStyle = 'rgba(255,255,255,1)';
    x.lineWidth = r * 0.055;
    x.lineJoin = 'round';
    flake(cx, cy, r);
    x.stroke();
    x.restore();
    radial(cx, cy, r * 0.5, [[0, 0.08], [1, 0]]);
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

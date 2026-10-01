// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Gantry decal atlas: ONE second canvas texture for the ground
// detail (scorch, oil, cracks, damp, sand drift, tyre tracks, faded floor
// paint, manholes, grates, debris, foam lace, salt crust, rust drips) and the
// 1970s safety-sign plates, gauges and notice boards. Two batched materials
// read it: 'decal' (soft alpha-blended, lit) and 'sign2' (cut-out plates).
// Painted on a 1024² grid (scaled to 512² on Low), warm dusty neutrals only.
// ─────────────────────────────────────────────────────────────────────────────

import { ENV } from '../../../engine/palette';

export const DECAL_W = 1024;
export const DECAL_H = 1024;

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Atlas layout (px on the 1024² grid). */
export const D = {
  scorch: { x: 0, y: 0, w: 256, h: 256 },
  oil: { x: 256, y: 0, w: 256, h: 256 },
  crackA: { x: 512, y: 0, w: 256, h: 256 },
  crackB: { x: 768, y: 0, w: 256, h: 256 },
  damp: { x: 0, y: 256, w: 256, h: 256 },
  drift: { x: 256, y: 256, w: 256, h: 256 },
  debris: { x: 512, y: 256, w: 256, h: 256 },
  manhole: { x: 768, y: 256, w: 128, h: 128 },
  grate: { x: 896, y: 256, w: 128, h: 128 },
  gauge: { x: 768, y: 384, w: 128, h: 128 },
  foam: { x: 896, y: 384, w: 128, h: 128 },
  tyre: { x: 0, y: 512, w: 512, h: 128 },
  hazardFaded: { x: 512, y: 512, w: 512, h: 64 },
  keepClear: { x: 512, y: 576, w: 512, h: 64 },
  signDanger: { x: 0, y: 640, w: 256, h: 128 },
  signFuel: { x: 256, y: 640, w: 256, h: 128 },
  signNoSmoke: { x: 512, y: 640, w: 256, h: 128 },
  signHardHat: { x: 768, y: 640, w: 256, h: 128 },
  signSea: { x: 0, y: 768, w: 256, h: 128 },
  signTunnel: { x: 256, y: 768, w: 256, h: 128 },
  signCrawler: { x: 512, y: 768, w: 256, h: 128 },
  slab: { x: 768, y: 768, w: 128, h: 128 },
  salt: { x: 896, y: 768, w: 128, h: 128 },
  notice: { x: 0, y: 896, w: 256, h: 128 },
  drip: { x: 256, y: 896, w: 64, h: 128 },
  soot: { x: 320, y: 896, w: 64, h: 128 },
  lunch: { x: 384, y: 896, w: 128, h: 64 },
  plate: { x: 384, y: 960, w: 128, h: 64 },
  signBreak: { x: 512, y: 896, w: 256, h: 128 },
  leaves: { x: 768, y: 896, w: 128, h: 128 },
  sandRipple: { x: 896, y: 896, w: 128, h: 128 },
} satisfies Record<string, Region>;

export type DecalName = keyof typeof D;

/** UV rect [u0, v0, u1, v1] of a decal region (CanvasTexture flipY = true). */
export function uvD(name: DecalName, inset = 1.5): [number, number, number, number] {
  const r = D[name];
  return [(r.x + inset) / DECAL_W, 1 - (r.y + r.h - inset) / DECAL_H, (r.x + r.w - inset) / DECAL_W, 1 - (r.y + inset) / DECAL_H];
}

type C2D = CanvasRenderingContext2D;
const INK = '#2f2a26';
const FONT = '"Space Grotesk", "Arial Rounded MT Bold", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function clip(c: C2D, r: Region): void {
  c.save();
  c.beginPath();
  c.rect(r.x, r.y, r.w, r.h);
  c.clip();
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Soft dab (radial blob) — the painter's basic mark. */
function dab(c: C2D, x: number, y: number, r: number, color: string, a: number, sy = 1, rot = 0): void {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.scale(1, sy);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(0.55, rgba(color, a * 0.55));
  g.addColorStop(1, rgba(color, 0));
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, r, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** Irregular blob made of many dabs inside an ellipse (soft, painterly edge). */
function blob(c: C2D, r: Region, color: string, a: number, n: number, seed: number, spread = 0.36, size = 0.16): void {
  const rnd = rng(seed);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  for (let i = 0; i < n; i++) {
    const ang = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * spread;
    const rr = (size * (0.5 + rnd())) * Math.min(r.w, r.h);
    dab(c, cx + Math.cos(ang) * d * r.w, cy + Math.sin(ang) * d * r.h, rr, color, a * (0.5 + rnd() * 0.5), 0.6 + rnd() * 0.5, rnd() * 3);
  }
}

function text(c: C2D, s: string, x: number, y: number, px: number, color: string, weight = 800, align: CanvasTextAlign = 'center', track = 0): void {
  c.fillStyle = color;
  c.font = `${weight} ${px}px ${FONT}`;
  c.textAlign = align;
  c.textBaseline = 'middle';
  if (!track) {
    c.fillText(s, x, y);
    return;
  }
  const widths = [...s].map((ch) => c.measureText(ch).width + track);
  const total = widths.reduce((a, b) => a + b, 0) - track;
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  c.textAlign = 'left';
  [...s].forEach((ch, i) => {
    c.fillText(ch, cx, y);
    cx += widths[i];
  });
}

/** Salt/sun weathering for opaque plates. */
function weather(c: C2D, r: Region, amount: number, seed: number): void {
  const rnd = rng(seed);
  clip(c, r);
  for (let i = 0; i < 60 * amount; i++) {
    const x = r.x + rnd() * r.w;
    const y = r.y + rnd() * r.h;
    const rr = 1.5 + rnd() * r.w * 0.05;
    c.fillStyle = rnd() < 0.6 ? `rgba(245,236,220,${0.05 + rnd() * 0.16})` : `rgba(110,74,52,${0.04 + rnd() * 0.1})`;
    c.beginPath();
    c.ellipse(x, y, rr, rr * (0.4 + rnd()), rnd() * 3, 0, Math.PI * 2);
    c.fill();
  }
  // Rust weeping from the two top rivets.
  for (const fx of [0.08, 0.92]) {
    const g = c.createLinearGradient(0, r.y + 6, 0, r.y + r.h * (0.5 + rnd() * 0.4));
    g.addColorStop(0, 'rgba(122,78,52,0.5)');
    g.addColorStop(1, 'rgba(122,78,52,0)');
    c.fillStyle = g;
    c.fillRect(r.x + r.w * fx - 2, r.y + 6, 3 + rnd() * 3, r.h);
    c.fillStyle = '#6d5a4c';
    c.beginPath();
    c.arc(r.x + r.w * fx, r.y + 8, 3.2, 0, Math.PI * 2);
    c.fill();
  }
  const g = c.createRadialGradient(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) * 0.3, r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h) * 0.7);
  g.addColorStop(0, 'rgba(255,248,236,0)');
  g.addColorStop(1, `rgba(236,222,200,${0.3 * amount})`);
  c.fillStyle = g;
  c.fillRect(r.x, r.y, r.w, r.h);
  c.restore();
}

/** Knock holes out of a transparent decal (paint worn by boots and tyres). */
function wear(c: C2D, r: Region, amount: number, seed: number): void {
  const rnd = rng(seed);
  clip(c, r);
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 120 * amount; i++) {
    const x = r.x + rnd() * r.w;
    const y = r.y + rnd() * r.h;
    const rr = 1 + rnd() * Math.min(r.w, r.h) * 0.08;
    c.fillStyle = `rgba(0,0,0,${0.25 + rnd() * 0.75})`;
    c.beginPath();
    c.ellipse(x, y, rr * (1 + rnd() * 2.5), rr, rnd() * 3, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

// ── Ground decals ───────────────────────────────────────────────────────────

function drawScorch(c: C2D, r: Region): void {
  clip(c, r);
  const rnd = rng(31);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  // Blast rays: long soot strokes fanning out.
  for (let i = 0; i < 90; i++) {
    const a = rnd() * Math.PI * 2;
    const len = r.w * (0.18 + rnd() * 0.3);
    for (let k = 0; k < 6; k++) {
      const d = (k / 6) * len;
      dab(c, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 10 + (1 - k / 6) * 10, '#2b2420', 0.3 * (1 - k / 7), 0.45, a);
    }
  }
  blob(c, r, '#231e1b', 0.9, 46, 32, 0.14, 0.22);
  blob(c, r, '#3a312b', 0.5, 60, 33, 0.3, 0.14);
  // Heat-bleached halo ring with soft rust.
  c.strokeStyle = 'rgba(150,104,76,0.18)';
  c.lineWidth = 9;
  c.beginPath();
  c.arc(cx, cy, r.w * 0.41, 0, Math.PI * 2);
  c.stroke();
  c.restore();
}

function drawOil(c: C2D, r: Region): void {
  clip(c, r);
  blob(c, r, '#3a3029', 0.34, 36, 41, 0.22, 0.18);
  blob(c, r, '#2a221d', 0.4, 18, 42, 0.12, 0.14);
  // Drips and splats around it, and a dull sheen ring (warm, never rainbow).
  const rnd = rng(43);
  for (let i = 0; i < 14; i++) dab(c, r.x + r.w / 2 + (rnd() - 0.5) * r.w * 0.8, r.y + r.h / 2 + (rnd() - 0.5) * r.h * 0.8, 4 + rnd() * 9, '#2f2620', 0.55);
  c.strokeStyle = 'rgba(160,140,120,0.16)';
  c.lineWidth = 5;
  c.beginPath();
  c.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w * 0.24, r.h * 0.2, 0.4, 0, Math.PI * 2);
  c.stroke();
  c.restore();
}

function crackPath(c: C2D, rnd: () => number, x: number, y: number, a: number, len: number, w: number, depth: number, r: Region): void {
  c.beginPath();
  c.moveTo(x, y);
  let px = x;
  let py = y;
  const steps = Math.max(3, Math.round(len / 9));
  for (let i = 0; i < steps; i++) {
    a += (rnd() - 0.5) * 0.9;
    px += Math.cos(a) * (len / steps);
    py += Math.sin(a) * (len / steps);
    px = Math.min(r.x + r.w - 4, Math.max(r.x + 4, px));
    py = Math.min(r.y + r.h - 4, Math.max(r.y + 4, py));
    c.lineTo(px, py);
    if (depth > 0 && rnd() < 0.18) {
      c.lineWidth = w;
      c.stroke();
      crackPath(c, rnd, px, py, a + (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.8), len * 0.45, w * 0.6, depth - 1, r);
      c.beginPath();
      c.moveTo(px, py);
    }
  }
  c.lineWidth = w;
  c.stroke();
}

function drawCracks(c: C2D, r: Region, seed: number): void {
  clip(c, r);
  const rnd = rng(seed);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  // Soft dusty halo first, then the dark fissure on top.
  for (const [col, wk] of [
    ['rgba(120,106,92,0.22)', 4.5],
    ['rgba(52,44,38,0.85)', 1.4],
  ] as [string, number][]) {
    const r2 = rng(seed);
    c.strokeStyle = col;
    for (let i = 0; i < 3; i++) {
      const x = r.x + r.w * (0.2 + r2() * 0.6);
      const y = r.y + r.h * (0.2 + r2() * 0.6);
      crackPath(c, r2, x, y, r2() * Math.PI * 2, r.w * (0.35 + r2() * 0.3), wk * (1.4 - i * 0.3), 2, r);
    }
  }
  // Chipped spall near the crack junction.
  dab(c, r.x + r.w * (0.35 + rnd() * 0.3), r.y + r.h * (0.35 + rnd() * 0.3), 14, '#5a4f45', 0.35, 0.6, rnd() * 3);
  c.restore();
}

function drawDamp(c: C2D, r: Region): void {
  clip(c, r);
  blob(c, r, '#3c4246', 0.42, 48, 51, 0.26, 0.17);
  blob(c, r, '#30363a', 0.35, 20, 52, 0.14, 0.15);
  // Drying tide line (salt) at the edge.
  const rnd = rng(53);
  c.strokeStyle = 'rgba(232,226,214,0.22)';
  c.lineWidth = 2;
  c.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const rr = r.w * (0.36 + Math.sin(a * 3 + 1) * 0.03 + rnd() * 0.02);
    const x = r.x + r.w / 2 + Math.cos(a) * rr;
    const y = r.y + r.h / 2 + Math.sin(a) * rr * 0.8;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.stroke();
  c.restore();
}

function drawDrift(c: C2D, r: Region): void {
  clip(c, r);
  const rnd = rng(61);
  blob(c, r, ENV.sand, 0.36, 70, 62, 0.3, 0.12);
  blob(c, r, '#cdb48e', 0.22, 30, 63, 0.24, 0.09);
  // Wind ripples: soft darker arcs.
  c.lineCap = 'round';
  for (let i = 0; i < 22; i++) {
    const y = r.y + r.h * (0.2 + rnd() * 0.6);
    const x = r.x + r.w * (0.15 + rnd() * 0.5);
    c.strokeStyle = `rgba(160,136,104,${0.12 + rnd() * 0.15})`;
    c.lineWidth = 2 + rnd() * 2;
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(x + 30, y - 6 - rnd() * 6, x + 50 + rnd() * 40, y + rnd() * 4);
    c.stroke();
  }
  c.restore();
}

function drawSandRipple(c: C2D, r: Region): void {
  clip(c, r);
  blob(c, r, ENV.sand, 0.6, 30, 64, 0.3, 0.2);
  const rnd = rng(65);
  for (let i = 0; i < 12; i++) {
    const y = r.y + 10 + i * 10 + rnd() * 3;
    c.strokeStyle = `rgba(150,128,98,${0.1 + rnd() * 0.12})`;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(r.x + 8, y);
    for (let x = 8; x < r.w - 8; x += 12) c.lineTo(r.x + x, y + Math.sin(x * 0.08 + i) * 3);
    c.stroke();
  }
  c.restore();
}

function drawDebris(c: C2D, r: Region): void {
  clip(c, r);
  const rnd = rng(71);
  // Grit and gravel.
  for (let i = 0; i < 260; i++) {
    const x = r.x + r.w / 2 + (rnd() - 0.5) * r.w * 0.85 * Math.sqrt(rnd());
    const y = r.y + r.h / 2 + (rnd() - 0.5) * r.h * 0.85 * Math.sqrt(rnd());
    c.fillStyle = rnd() < 0.5 ? 'rgba(92,80,70,0.7)' : 'rgba(200,188,168,0.75)';
    c.fillRect(x, y, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  // Paper scraps (a torn checklist, a ticket), bolts, a dry leaf or two.
  for (let i = 0; i < 4; i++) {
    c.save();
    c.translate(r.x + 40 + rnd() * (r.w - 80), r.y + 40 + rnd() * (r.h - 80));
    c.rotate(rnd() * Math.PI);
    c.fillStyle = 'rgba(80,66,56,0.25)';
    c.fillRect(-15, -10, 32, 24);
    c.fillStyle = rnd() < 0.5 ? '#eee6d6' : '#e6dcc4';
    c.fillRect(-16, -12, 30, 22);
    c.fillStyle = 'rgba(60,52,46,0.55)';
    for (let k = 0; k < 4; k++) c.fillRect(-12, -8 + k * 5, 14 + rnd() * 8, 1.5);
    c.restore();
  }
  for (let i = 0; i < 9; i++) {
    c.fillStyle = '#4c4743';
    c.beginPath();
    c.arc(r.x + 20 + rnd() * (r.w - 40), r.y + 20 + rnd() * (r.h - 40), 2.5 + rnd() * 2, 0, Math.PI * 2);
    c.fill();
  }
  for (let i = 0; i < 6; i++) {
    c.save();
    c.translate(r.x + 30 + rnd() * (r.w - 60), r.y + 30 + rnd() * (r.h - 60));
    c.rotate(rnd() * Math.PI * 2);
    c.fillStyle = rnd() < 0.5 ? '#9a7a5c' : '#8a7a5a';
    c.beginPath();
    c.ellipse(0, 0, 9, 4, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  c.restore();
}

function drawLeaves(c: C2D, r: Region): void {
  clip(c, r);
  const rnd = rng(73);
  for (let i = 0; i < 40; i++) {
    c.save();
    c.translate(r.x + r.w / 2 + (rnd() - 0.5) * r.w * 0.8, r.y + r.h / 2 + (rnd() - 0.5) * r.h * 0.8);
    c.rotate(rnd() * Math.PI * 2);
    c.fillStyle = ['#9a7a5c', '#8a8a62', '#a58f6a', '#7d8566'][Math.floor(rnd() * 4)];
    c.beginPath();
    c.ellipse(0, 0, 6 + rnd() * 4, 2.5 + rnd() * 1.5, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  c.restore();
}

function drawManhole(c: C2D, r: Region): void {
  clip(c, r);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const R0 = r.w / 2 - 4;
  dab(c, cx, cy, R0 + 4, '#3a332d', 0.22);
  c.fillStyle = '#6d675e';
  c.beginPath();
  c.arc(cx, cy, R0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#3d3934';
  c.lineWidth = 3;
  c.beginPath();
  c.arc(cx, cy, R0 - 3, 0, Math.PI * 2);
  c.stroke();
  // Radial cast-iron pattern + center boss lettering.
  c.lineWidth = 2;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * R0 * 0.5, cy + Math.sin(a) * R0 * 0.5);
    c.lineTo(cx + Math.cos(a) * (R0 - 7), cy + Math.sin(a) * (R0 - 7));
    c.stroke();
  }
  c.beginPath();
  c.arc(cx, cy, R0 * 0.48, 0, Math.PI * 2);
  c.stroke();
  text(c, 'LC-7', cx, cy + 1, 15, '#3d3934', 800);
  // Rust bloom and polished boot wear.
  dab(c, cx - R0 * 0.4, cy + R0 * 0.3, R0 * 0.5, '#7a4e34', 0.35);
  dab(c, cx + R0 * 0.2, cy - R0 * 0.2, R0 * 0.5, '#9a958c', 0.2);
  c.restore();
}

function drawGrate(c: C2D, r: Region): void {
  c.clearRect(r.x, r.y, r.w, r.h);
  clip(c, r);
  c.fillStyle = '#4f4b46';
  const b = 7;
  c.fillRect(r.x + 2, r.y + 2, r.w - 4, b);
  c.fillRect(r.x + 2, r.y + r.h - 2 - b, r.w - 4, b);
  c.fillRect(r.x + 2, r.y + 2, b, r.h - 4);
  c.fillRect(r.x + r.w - 2 - b, r.y + 2, b, r.h - 4);
  for (let x = r.x + 12; x < r.x + r.w - 8; x += 11) c.fillRect(x, r.y + 2, 4, r.h - 4);
  c.fillRect(r.x + 2, r.y + r.h / 2 - 2, r.w - 4, 4);
  // Rust on the bars.
  c.globalCompositeOperation = 'source-atop';
  const rnd = rng(81);
  for (let i = 0; i < 30; i++) dab(c, r.x + rnd() * r.w, r.y + rnd() * r.h, 6 + rnd() * 10, '#7a5038', 0.4);
  c.restore();
}

function drawGauge(c: C2D, r: Region): void {
  c.clearRect(r.x, r.y, r.w, r.h);
  clip(c, r);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const R0 = r.w / 2 - 3;
  c.fillStyle = '#8a8680';
  c.beginPath();
  c.arc(cx, cy, R0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#efe6d6';
  c.beginPath();
  c.arc(cx, cy, R0 - 7, 0, Math.PI * 2);
  c.fill();
  // Safe arc (sage) / danger arc (faded terracotta), ticks, needle.
  c.lineWidth = 7;
  c.strokeStyle = '#a3ad8f';
  c.beginPath();
  c.arc(cx, cy, R0 - 16, Math.PI * 0.75, Math.PI * 1.75);
  c.stroke();
  c.strokeStyle = '#c9785b';
  c.beginPath();
  c.arc(cx, cy, R0 - 16, Math.PI * 1.85, Math.PI * 2.25);
  c.stroke();
  c.strokeStyle = INK;
  c.lineWidth = 2;
  for (let k = 0; k <= 10; k++) {
    const a = Math.PI * 0.75 + (k / 10) * Math.PI * 1.5;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * (R0 - 10), cy + Math.sin(a) * (R0 - 10));
    c.lineTo(cx + Math.cos(a) * (R0 - (k % 5 ? 17 : 22)), cy + Math.sin(a) * (R0 - (k % 5 ? 17 : 22)));
    c.stroke();
  }
  text(c, 'PSI', cx, cy + R0 * 0.42, 13, INK, 800);
  const na = Math.PI * 1.62;
  c.strokeStyle = '#9a6a4f';
  c.lineWidth = 3.5;
  c.beginPath();
  c.moveTo(cx - Math.cos(na) * 8, cy - Math.sin(na) * 8);
  c.lineTo(cx + Math.cos(na) * (R0 - 18), cy + Math.sin(na) * (R0 - 18));
  c.stroke();
  c.fillStyle = INK;
  c.beginPath();
  c.arc(cx, cy, 5, 0, Math.PI * 2);
  c.fill();
  // Glass glare.
  c.fillStyle = 'rgba(255,255,255,0.18)';
  c.beginPath();
  c.ellipse(cx - R0 * 0.25, cy - R0 * 0.35, R0 * 0.45, R0 * 0.18, -0.5, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

function drawFoam(c: C2D, r: Region): void {
  clip(c, r);
  const rnd = rng(91);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  // A lacy ring: bright dabs on a soft ring, holes knocked through.
  for (let i = 0; i < 160; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = r.w * (0.3 + (rnd() - 0.5) * 0.14);
    dab(c, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 3 + rnd() * 6, '#fbf3e6', 0.55 + rnd() * 0.4);
  }
  for (let i = 0; i < 50; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = r.w * (0.2 + rnd() * 0.25);
    dab(c, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2 + rnd() * 3, '#fbf3e6', 0.4);
  }
  c.restore();
  wear(c, r, 0.6, 92);
}

function drawTyre(c: C2D, r: Region): void {
  clip(c, r);
  // Two tread bands running along x (tileable in u): chevron lugs.
  for (const y0 of [r.y + 18, r.y + r.h - 50]) {
    c.fillStyle = 'rgba(70,60,52,0.22)';
    c.fillRect(r.x, y0, r.w, 32);
    c.fillStyle = 'rgba(58,50,44,0.45)';
    for (let x = r.x - 16; x < r.x + r.w + 16; x += 16) {
      c.beginPath();
      c.moveTo(x, y0 + 2);
      c.lineTo(x + 8, y0 + 16);
      c.lineTo(x, y0 + 30);
      c.lineTo(x + 5, y0 + 30);
      c.lineTo(x + 13, y0 + 16);
      c.lineTo(x + 5, y0 + 2);
      c.fill();
    }
  }
  c.restore();
  wear(c, r, 0.9, 93);
}

function drawHazardFaded(c: C2D, r: Region): void {
  clip(c, r);
  c.fillStyle = 'rgba(230,220,200,0.75)';
  c.fillRect(r.x, r.y, r.w, r.h);
  c.fillStyle = 'rgba(154,106,79,0.85)';
  for (let x = r.x - r.h; x < r.x + r.w; x += 48) {
    c.beginPath();
    c.moveTo(x, r.y + r.h);
    c.lineTo(x + 24, r.y + r.h);
    c.lineTo(x + 24 + r.h, r.y);
    c.lineTo(x + r.h, r.y);
    c.fill();
  }
  c.restore();
  wear(c, r, 2.2, 94);
}

function drawKeepClear(c: C2D, r: Region): void {
  clip(c, r);
  text(c, 'KEEP CLEAR', r.x + r.w / 2, r.y + r.h / 2 + 2, 50, 'rgba(232,222,204,0.92)', 800, 'center', 9);
  c.restore();
  wear(c, r, 1.6, 95);
}

function drawSlab(c: C2D, r: Region): void {
  clip(c, r);
  // A soft-edged square: re-poured / sun-bleached slab tone patches.
  const g = c.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
  g.addColorStop(0, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0.36)');
  c.fillStyle = g;
  c.fillRect(r.x + 6, r.y + 6, r.w - 12, r.h - 12);
  c.restore();
  wear(c, r, 0.5, 96);
  clip(c, r);
  // Feather the edges.
  c.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 6; k++) {
    c.strokeStyle = `rgba(0,0,0,${0.5 - k * 0.07})`;
    c.lineWidth = 2;
    c.strokeRect(r.x + 6 + k * 2, r.y + 6 + k * 2, r.w - 12 - k * 4, r.h - 12 - k * 4);
  }
  c.restore();
}

function drawSalt(c: C2D, r: Region): void {
  clip(c, r);
  const rnd = rng(97);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  for (let i = 0; i < 140; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = r.w * (0.18 + rnd() * 0.26);
    dab(c, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2 + rnd() * 5, '#f1ece2', 0.35 + rnd() * 0.4);
  }
  c.restore();
}

function drawDrip(c: C2D, r: Region, color: string, seed: number): void {
  clip(c, r);
  const rnd = rng(seed);
  for (let i = 0; i < 9; i++) {
    const x = r.x + 8 + rnd() * (r.w - 16);
    const len = r.h * (0.4 + rnd() * 0.55);
    const g = c.createLinearGradient(0, r.y, 0, r.y + len);
    g.addColorStop(0, rgba(color, 0.55));
    g.addColorStop(1, rgba(color, 0));
    c.fillStyle = g;
    c.fillRect(x, r.y, 2 + rnd() * 6, len);
  }
  const g = c.createLinearGradient(0, r.y, 0, r.y + r.h * 0.3);
  g.addColorStop(0, rgba(color, 0.4));
  g.addColorStop(1, rgba(color, 0));
  c.fillStyle = g;
  c.fillRect(r.x, r.y, r.w, r.h * 0.3);
  c.restore();
}

function drawSoot(c: C2D, r: Region): void {
  clip(c, r);
  const rnd = rng(99);
  for (let i = 0; i < 40; i++) {
    const y = r.y + r.h - rnd() * r.h * 0.95;
    const f = 1 - (r.y + r.h - y) / r.h;
    dab(c, r.x + r.w / 2 + (rnd() - 0.5) * r.w * (1 - f * 0.5), y, 10 + 14 * f, '#2b2420', 0.25 * (0.4 + f));
  }
  c.restore();
}

// ── Plates (1970s safety signage, gauges, notice board) ────────────────────

function plateBase(c: C2D, r: Region, bg: string, header: string | null, headerH: number): void {
  c.fillStyle = bg;
  c.fillRect(r.x, r.y, r.w, r.h);
  if (header) {
    c.fillStyle = header;
    c.fillRect(r.x, r.y, r.w, headerH);
  }
  // Rounded-corner frame and inner rule (period enamel plate).
  c.strokeStyle = INK;
  c.lineWidth = 4;
  c.strokeRect(r.x + 5, r.y + 5, r.w - 10, r.h - 10);
}

function signPlate(c: C2D, r: Region, head: string, headBg: string, headFg: string, l1: string, l2: string, seed: number): void {
  plateBase(c, r, '#efe6d6', headBg, 46);
  // 70s: chunky rounded heads with a speed-stripe band under the header.
  text(c, head, r.x + r.w / 2, r.y + 27, 34, headFg, 900, 'center', 4);
  c.fillStyle = INK;
  c.fillRect(r.x + 5, r.y + 46, r.w - 10, 3);
  c.fillRect(r.x + 5, r.y + 52, r.w - 10, 1.5);
  text(c, l1, r.x + r.w / 2, r.y + 76, 20, INK, 800, 'center', 1.5);
  text(c, l2, r.x + r.w / 2, r.y + 102, 16, '#5a4f45', 700, 'center', 1);
  weather(c, r, 0.9, seed);
}

function drawNoSmoke(c: C2D, r: Region): void {
  plateBase(c, r, '#efe6d6', null, 0);
  const cx = r.x + 62;
  const cy = r.y + r.h / 2;
  c.strokeStyle = '#9a6a4f';
  c.lineWidth = 9;
  c.beginPath();
  c.arc(cx, cy, 40, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = INK;
  c.fillRect(cx - 28, cy - 4, 46, 9);
  c.fillStyle = '#c9785b';
  c.fillRect(cx + 18, cy - 4, 9, 9);
  c.fillStyle = 'rgba(47,42,38,0.6)';
  for (let i = 0; i < 3; i++) c.fillRect(cx + 21 + i * 2, cy - 20 + i * 4, 2, 10);
  c.strokeStyle = '#9a6a4f';
  c.beginPath();
  c.moveTo(cx - 28, cy - 28);
  c.lineTo(cx + 28, cy + 28);
  c.stroke();
  text(c, 'NO', r.x + 178, r.y + 42, 34, INK, 900, 'center', 3);
  text(c, 'SMOKING', r.x + 178, r.y + 74, 24, INK, 900, 'center', 2);
  text(c, 'WITHIN 50 M', r.x + 178, r.y + 100, 14, '#5a4f45', 700, 'center', 1);
  weather(c, r, 1, 103);
}

function drawShaftSign(c: C2D, r: Region): void {
  // Stencilled tunnel marker: big number with direction arrows.
  plateBase(c, r, '#cfc4b0', null, 0);
  c.fillStyle = INK;
  c.fillRect(r.x + 5, r.y + 5, 90, r.h - 10);
  text(c, 'T2', r.x + 50, r.y + r.h / 2 + 2, 52, '#efe6d6', 900);
  text(c, 'SERVICE', r.x + 172, r.y + 40, 24, INK, 900, 'center', 2);
  text(c, 'TUNNEL', r.x + 172, r.y + 68, 24, INK, 900, 'center', 2);
  text(c, '◀ TRENCH  APRON ▶', r.x + 172, r.y + 98, 13, '#5a4f45', 700, 'center', 1);
  weather(c, r, 1, 104);
}

function drawCrawler(c: C2D, r: Region): void {
  plateBase(c, r, '#efdca6', null, 0);
  c.fillStyle = INK;
  c.beginPath();
  c.arc(r.x + 62, r.y + r.h / 2, 42, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#efdca6';
  c.beginPath();
  c.arc(r.x + 62, r.y + r.h / 2, 34, 0, Math.PI * 2);
  c.fill();
  text(c, '1', r.x + 62, r.y + r.h / 2 - 4, 44, INK, 900);
  text(c, 'MPH', r.x + 62, r.y + r.h / 2 + 22, 12, INK, 800);
  text(c, 'CRAWLERWAY', r.x + 178, r.y + 48, 22, INK, 900, 'center', 1.5);
  text(c, 'SPEED LIMIT', r.x + 178, r.y + 80, 18, '#5a4f45', 800, 'center', 2);
  weather(c, r, 1, 105);
}

function drawNotice(c: C2D, r: Region): void {
  // Cork board in a timber frame with pinned papers (shift rota, a launch
  // schedule that never ran, a hand-drawn "lost: thermos" note, a photo).
  c.fillStyle = '#7a634c';
  c.fillRect(r.x, r.y, r.w, r.h);
  c.fillStyle = '#b39a7f';
  c.fillRect(r.x + 7, r.y + 7, r.w - 14, r.h - 14);
  const rnd = rng(111);
  for (let i = 0; i < 260; i++) {
    c.fillStyle = rnd() < 0.5 ? 'rgba(140,110,80,0.5)' : 'rgba(200,170,130,0.4)';
    c.fillRect(r.x + 7 + rnd() * (r.w - 14), r.y + 7 + rnd() * (r.h - 14), 2, 2);
  }
  const papers: [number, number, number, number, string, number][] = [
    [18, 16, 62, 84, '#f4efe6', -0.05],
    [88, 12, 70, 52, '#efdca6', 0.04],
    [92, 70, 54, 44, '#e9c3b5', -0.08],
    [168, 18, 66, 90, '#f4efe6', 0.03],
    [150, 74, 40, 40, '#cfe0e6', 0.1],
  ];
  for (const [x, y, w, h, col, rot] of papers) {
    c.save();
    c.translate(r.x + x + w / 2, r.y + y + h / 2);
    c.rotate(rot);
    c.fillStyle = 'rgba(60,44,30,0.3)';
    c.fillRect(-w / 2 + 2, -h / 2 + 3, w, h);
    c.fillStyle = col;
    c.fillRect(-w / 2, -h / 2, w, h);
    c.fillStyle = 'rgba(47,42,38,0.7)';
    c.fillRect(-w / 2 + 5, -h / 2 + 6, w * 0.6, 3);
    for (let k = 0; k < Math.floor(h / 9) - 1; k++) c.fillRect(-w / 2 + 5, -h / 2 + 14 + k * 8, w * (0.4 + ((k * 37) % 50) / 100), 1.5);
    c.fillStyle = '#9a6a4f';
    c.beginPath();
    c.arc(0, -h / 2 + 4, 3, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  weather(c, r, 0.6, 112);
}

function drawLunch(c: C2D, r: Region): void {
  // Side panel art for the tin lunch boxes: a rocket over a sunburst.
  c.fillStyle = '#b9cfda';
  c.fillRect(r.x, r.y, r.w, r.h);
  const g = c.createLinearGradient(0, r.y, 0, r.y + r.h);
  g.addColorStop(0, '#efdca6');
  g.addColorStop(1, '#e9c3b5');
  c.fillStyle = g;
  c.fillRect(r.x + 6, r.y + 6, r.w - 12, r.h - 12);
  c.fillStyle = '#efe6d6';
  c.beginPath();
  c.arc(r.x + r.w / 2, r.y + r.h - 6, 26, Math.PI, 0);
  c.fill();
  c.fillStyle = INK;
  c.fillRect(r.x + r.w / 2 - 3, r.y + 14, 6, 34);
  c.beginPath();
  c.moveTo(r.x + r.w / 2 - 3, r.y + 14);
  c.lineTo(r.x + r.w / 2, r.y + 6);
  c.lineTo(r.x + r.w / 2 + 3, r.y + 14);
  c.fill();
  text(c, 'SPACE AGE', r.x + 30, r.y + 18, 9, INK, 900);
  weather(c, r, 0.8, 113);
}

function drawPlate(c: C2D, r: Region): void {
  // Equipment ID plate: "PUMP 4 · 400 PSI".
  plateBase(c, r, '#cfc4b0', null, 0);
  text(c, 'P-04  ·  400 PSI', r.x + r.w / 2, r.y + r.h / 2 + 1, 15, INK, 800, 'center', 1);
  weather(c, r, 1, 114);
}

/** Paints the whole decal atlas (call through MaterialLibrary.canvasTexture). */
export function paintDecals(c: C2D, w: number, h: number): void {
  c.save();
  c.scale(w / DECAL_W, h / DECAL_H);
  c.clearRect(0, 0, DECAL_W, DECAL_H);
  drawScorch(c, D.scorch);
  drawOil(c, D.oil);
  drawCracks(c, D.crackA, 21);
  drawCracks(c, D.crackB, 22);
  drawDamp(c, D.damp);
  drawDrift(c, D.drift);
  drawDebris(c, D.debris);
  drawManhole(c, D.manhole);
  drawGrate(c, D.grate);
  drawGauge(c, D.gauge);
  drawFoam(c, D.foam);
  drawTyre(c, D.tyre);
  drawHazardFaded(c, D.hazardFaded);
  drawKeepClear(c, D.keepClear);
  signPlate(c, D.signDanger, 'DANGER', '#c9785b', '#efe6d6', 'HIGH PRESSURE', 'LOX LINES · 300 PSI', 101);
  signPlate(c, D.signFuel, 'CAUTION', '#efdca6', INK, 'RP-1 FUEL', 'FLAMMABLE · NO SPARKS', 102);
  drawNoSmoke(c, D.signNoSmoke);
  signPlate(c, D.signHardHat, 'SAFETY', '#a3ad8f', INK, 'HARD HATS', 'BEYOND THIS POINT', 106);
  signPlate(c, D.signSea, 'SEAWALL', '#9cc3d5', INK, 'NO SWIMMING', 'RIP CURRENTS · STAY BACK', 107);
  drawShaftSign(c, D.signTunnel);
  drawCrawler(c, D.signCrawler);
  drawSlab(c, D.slab);
  drawSalt(c, D.salt);
  drawNotice(c, D.notice);
  drawDrip(c, D.drip, '#6e4a36', 115);
  drawSoot(c, D.soot);
  drawLunch(c, D.lunch);
  drawPlate(c, D.plate);
  signPlate(c, D.signBreak, 'BREAK', '#e9c3b5', INK, 'COFFEE 5¢', 'WASH YOUR OWN MUG', 108);
  drawLeaves(c, D.leaves);
  drawSandRipple(c, D.sandRipple);
  c.restore();
}

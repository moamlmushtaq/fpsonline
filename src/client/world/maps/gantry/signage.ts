// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Gantry signage atlas: ONE canvas texture for every poster,
// stencil, mural, facade lettering and glowing board on the map (one material,
// one draw call). Diegetic 1970s space-age signage, faded by salt and sun.
// Regions are authored on a 2048×1024 grid and scaled on Low.
// ─────────────────────────────────────────────────────────────────────────────

import { ENV } from '../../../engine/palette';

export const ATLAS_W = 2048;
export const ATLAS_H = 1024;

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Atlas layout (px on the 2048×1024 grid). */
export const R = {
  posterReach: { x: 0, y: 0, w: 256, h: 384 },
  posterSky: { x: 256, y: 0, w: 256, h: 384 },
  posterSafety: { x: 512, y: 0, w: 256, h: 384 },
  countdown: { x: 768, y: 0, w: 512, h: 128 },
  stencilPad: { x: 768, y: 128, w: 512, h: 64 },
  stencilTrench: { x: 768, y: 192, w: 512, h: 64 },
  stencilLox: { x: 768, y: 256, w: 512, h: 64 },
  stencilDock: { x: 768, y: 320, w: 512, h: 64 },
  facadeHalcyon: { x: 1280, y: 0, w: 768, h: 384 },
  mural: { x: 0, y: 384, w: 1024, h: 512 },
  facadeStation: { x: 1024, y: 384, w: 1024, h: 256 },
  hazard: { x: 1024, y: 640, w: 512, h: 64 },
  screens: { x: 1536, y: 640, w: 512, h: 128 },
  graffiti: { x: 1024, y: 704, w: 512, h: 192 },
  deckSeven: { x: 1536, y: 768, w: 256, h: 256 },
  stencilBunker: { x: 1792, y: 768, w: 256, h: 64 },
  stencilRp1: { x: 1792, y: 832, w: 256, h: 64 },
  stencilExit: { x: 1792, y: 896, w: 256, h: 64 },
  stencilCrane: { x: 1792, y: 960, w: 256, h: 64 },
  stencilLox2: { x: 0, y: 896, w: 512, h: 64 },
  stencilHangar: { x: 512, y: 896, w: 512, h: 64 },
  stencilStation: { x: 0, y: 960, w: 512, h: 64 },
  plaque: { x: 512, y: 960, w: 512, h: 64 },
} satisfies Record<string, Region>;

export type RegionName = keyof typeof R;

/** UV rect [u0, v0, u1, v1] for a region (CanvasTexture flipY = true). */
export function uvOf(name: RegionName, inset = 1): [number, number, number, number] {
  const r = R[name];
  return [(r.x + inset) / ATLAS_W, 1 - (r.y + r.h - inset) / ATLAS_H, (r.x + r.w - inset) / ATLAS_W, 1 - (r.y + inset) / ATLAS_H];
}

const INK = '#2f2a26';
const FONT = '"Space Grotesk", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';

type C2D = CanvasRenderingContext2D;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Salt/sun weathering over a region: blotches, scratches, faded edges. */
function weather(c: C2D, r: Region, amount: number, seed: number): void {
  const rnd = rng(seed);
  c.save();
  c.beginPath();
  c.rect(r.x, r.y, r.w, r.h);
  c.clip();
  for (let i = 0; i < 90 * amount; i++) {
    const x = r.x + rnd() * r.w;
    const y = r.y + rnd() * r.h;
    const rr = 2 + rnd() * r.w * 0.06;
    c.fillStyle = rnd() < 0.6 ? `rgba(245,236,220,${0.05 + rnd() * 0.14})` : `rgba(90,70,56,${0.03 + rnd() * 0.07})`;
    c.beginPath();
    c.ellipse(x, y, rr, rr * (0.4 + rnd()), rnd() * 3, 0, Math.PI * 2);
    c.fill();
  }
  c.strokeStyle = 'rgba(250,244,232,0.22)';
  c.lineWidth = 1;
  for (let i = 0; i < 26 * amount; i++) {
    const x = r.x + rnd() * r.w;
    const y = r.y + rnd() * r.h;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + (rnd() - 0.5) * 40, y + (rnd() - 0.5) * 12);
    c.stroke();
  }
  // Sun-bleached vignette.
  const g = c.createRadialGradient(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) * 0.3, r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h) * 0.75);
  g.addColorStop(0, 'rgba(255,248,236,0)');
  g.addColorStop(1, `rgba(236,222,200,${0.35 * amount})`);
  c.fillStyle = g;
  c.fillRect(r.x, r.y, r.w, r.h);
  c.restore();
}

/** Wear for cut-out lettering (transparent background): peel holes out of the paint. */
function peel(c: C2D, r: Region, amount: number, seed: number): void {
  const rnd = rng(seed);
  c.save();
  c.beginPath();
  c.rect(r.x, r.y, r.w, r.h);
  c.clip();
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 70 * amount; i++) {
    const x = r.x + rnd() * r.w;
    const y = r.y + rnd() * r.h;
    const rr = 1.5 + rnd() * r.w * 0.025;
    c.fillStyle = `rgba(0,0,0,${0.35 + rnd() * 0.65})`;
    c.beginPath();
    c.ellipse(x, y, rr * (1 + rnd() * 2), rr, rnd() * 3, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

function text(c: C2D, s: string, x: number, y: number, px: number, color: string, weight = 700, align: CanvasTextAlign = 'center', track = 0): void {
  c.fillStyle = color;
  c.font = `${weight} ${px}px ${FONT}`;
  c.textAlign = align;
  c.textBaseline = 'middle';
  if (track === 0) {
    c.fillText(s, x, y);
    return;
  }
  // Manual letter spacing (canvas letterSpacing support varies).
  const widths = [...s].map((ch) => c.measureText(ch).width + track);
  const total = widths.reduce((a, b) => a + b, 0) - track;
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  c.textAlign = 'left';
  [...s].forEach((ch, i) => {
    c.fillText(ch, cx, y);
    cx += widths[i];
  });
}

/** Stencil lettering on a plate: bold, with bridges. */
function stencil(c: C2D, r: Region, s: string, bg: string | null, fg: string, px: number, seed: number): void {
  if (bg) {
    c.fillStyle = bg;
    c.fillRect(r.x, r.y, r.w, r.h);
  } else {
    c.clearRect(r.x, r.y, r.w, r.h);
  }
  text(c, s, r.x + r.w / 2, r.y + r.h / 2 + 2, px, fg, 700, 'center', px * 0.12);
  // Stencil bridges: thin vertical gaps through the letters.
  c.fillStyle = bg ?? 'rgba(0,0,0,0)';
  if (bg) {
    const rnd = rng(seed);
    for (let x = r.x + 18 + rnd() * 6; x < r.x + r.w - 10; x += px * 0.55 + rnd() * 6) c.fillRect(x, r.y + r.h * 0.18, 2, r.h * 0.64);
  }
  if (bg) weather(c, r, 0.6, seed);
}

// ── Seven-segment digits (countdown boards) ────────────────────────────────

const SEGS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abged',
  '3': 'abgcd',
  '4': 'fgbc',
  '5': 'afgcd',
  '6': 'afgedc',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
  T: 'fedg',
};

function seg7(c: C2D, ch: string, x: number, y: number, w: number, h: number, on: string, off: string): void {
  const t = w * 0.2;
  const lit = SEGS[ch] ?? '';
  const segs: Record<string, [number, number, number, number]> = {
    a: [x + t * 0.6, y, w - t * 1.2, t],
    b: [x + w - t, y + t * 0.6, t, h / 2 - t * 0.9],
    c: [x + w - t, y + h / 2 + t * 0.3, t, h / 2 - t * 0.9],
    d: [x + t * 0.6, y + h - t, w - t * 1.2, t],
    e: [x, y + h / 2 + t * 0.3, t, h / 2 - t * 0.9],
    f: [x, y + t * 0.6, t, h / 2 - t * 0.9],
    g: [x + t * 0.6, y + h / 2 - t / 2, w - t * 1.2, t],
  };
  for (const k of Object.keys(segs)) {
    const [sx, sy, sw, sh] = segs[k];
    c.fillStyle = lit.includes(k) ? on : off;
    c.fillRect(sx, sy, sw, sh);
  }
}

function drawCountdown(c: C2D, r: Region): void {
  c.fillStyle = '#1d1a18';
  c.fillRect(r.x, r.y, r.w, r.h);
  c.strokeStyle = '#6a6259';
  c.lineWidth = 4;
  c.strokeRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
  const s = 'T-00:04:12';
  const dw = 36;
  const dh = 76;
  let x = r.x + 26;
  const y = r.y + 24;
  const on = ENV.glowGold;
  const off = 'rgba(255,227,161,0.07)';
  for (const ch of s) {
    if (ch === ':') {
      c.fillStyle = on;
      c.fillRect(x + 4, y + 18, 8, 8);
      c.fillRect(x + 4, y + 50, 8, 8);
      x += 20;
      continue;
    }
    seg7(c, ch, x, y, dw, dh, on, off);
    x += dw + 12;
  }
  text(c, 'HOLD', r.x + r.w - 40, r.y + 38, 20, '#e9c3b5', 700);
  text(c, 'HALCYON 7', r.x + r.w - 40, r.y + 88, 13, '#cfc4b0', 700);
}

// ── Posters ─────────────────────────────────────────────────────────────────

function sunburst(c: C2D, cx: number, cy: number, r0: number, r1: number, n: number, color: string): void {
  c.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = a0 + (Math.PI / n) * 0.9;
    c.beginPath();
    c.moveTo(cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0);
    c.lineTo(cx + Math.cos(a0) * r1, cy + Math.sin(a0) * r1);
    c.lineTo(cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1);
    c.lineTo(cx + Math.cos(a1) * r0, cy + Math.sin(a1) * r0);
    c.fill();
  }
}

function rocketGlyph(c: C2D, x: number, y: number, s: number, body: string, dark: string): void {
  c.fillStyle = body;
  c.beginPath();
  c.moveTo(x, y - s * 1.9);
  c.quadraticCurveTo(x + s * 0.34, y - s * 1.3, x + s * 0.3, y - s * 0.6);
  c.lineTo(x + s * 0.3, y + s * 0.5);
  c.lineTo(x - s * 0.3, y + s * 0.5);
  c.lineTo(x - s * 0.3, y - s * 0.6);
  c.quadraticCurveTo(x - s * 0.34, y - s * 1.3, x, y - s * 1.9);
  c.fill();
  c.fillStyle = dark;
  c.beginPath();
  c.moveTo(x + s * 0.3, y);
  c.lineTo(x + s * 0.72, y + s * 0.7);
  c.lineTo(x + s * 0.3, y + s * 0.5);
  c.fill();
  c.beginPath();
  c.moveTo(x - s * 0.3, y);
  c.lineTo(x - s * 0.72, y + s * 0.7);
  c.lineTo(x - s * 0.3, y + s * 0.5);
  c.fill();
  c.fillRect(x - s * 0.3, y - s * 0.62, s * 0.6, s * 0.14);
}

function drawPosterReach(c: C2D, r: Region): void {
  const g = c.createLinearGradient(0, r.y, 0, r.y + r.h);
  g.addColorStop(0, '#9cb8c9');
  g.addColorStop(0.55, '#efc9a2');
  g.addColorStop(1, '#d68f6f');
  c.fillStyle = g;
  c.fillRect(r.x, r.y, r.w, r.h);
  const cx = r.x + r.w / 2;
  sunburst(c, cx, r.y + 250, 40, 190, 18, 'rgba(255,240,214,0.35)');
  c.fillStyle = '#fbe3b8';
  c.beginPath();
  c.arc(cx, r.y + 250, 58, 0, Math.PI * 2);
  c.fill();
  // Sea stripes.
  c.fillStyle = '#6f95a0';
  c.fillRect(r.x, r.y + 282, r.w, 102);
  c.fillStyle = 'rgba(251,227,184,0.7)';
  for (let i = 0; i < 6; i++) c.fillRect(cx - 50 + i * 6, r.y + 292 + i * 12, 100 - i * 12, 3);
  // Rocket + exhaust plume.
  c.fillStyle = 'rgba(255,248,236,0.85)';
  c.beginPath();
  c.moveTo(cx - 10, r.y + 236);
  c.quadraticCurveTo(cx - 34, r.y + 300, cx - 70, r.y + 330);
  c.lineTo(cx + 70, r.y + 330);
  c.quadraticCurveTo(cx + 34, r.y + 300, cx + 10, r.y + 236);
  c.fill();
  rocketGlyph(c, cx, r.y + 212, 26, '#f4efe6', INK);
  text(c, 'REACH', cx, r.y + 44, 50, INK, 800, 'center', 3);
  text(c, 'FOR TOMORROW', cx, r.y + 88, 26, INK, 700, 'center', 2);
  text(c, 'HALCYON SPACE AGENCY', cx, r.y + 360, 12, '#f3ece0', 700, 'center', 2);
  weather(c, r, 1, 11);
}

function drawPosterSky(c: C2D, r: Region): void {
  c.fillStyle = '#e8dcc4';
  c.fillRect(r.x, r.y, r.w, r.h);
  const cx = r.x + r.w / 2;
  // Orbit rings around a big planet disc.
  c.fillStyle = '#c9785b';
  c.beginPath();
  c.arc(cx, r.y + 200, 84, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#c99a82';
  c.beginPath();
  c.arc(cx + 18, r.y + 188, 64, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = INK;
  c.lineWidth = 4;
  c.beginPath();
  c.ellipse(cx, r.y + 200, 118, 28, -0.35, 0, Math.PI * 2);
  c.stroke();
  // Helmet silhouette.
  c.fillStyle = '#f4efe6';
  c.beginPath();
  c.arc(cx - 70, r.y + 124, 26, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = INK;
  c.fillRect(cx - 88, r.y + 118, 36, 8);
  text(c, 'THE SKY', cx, r.y + 36, 40, INK, 800, 'center', 2);
  text(c, 'BELONGS TO', cx, r.y + 318, 24, INK, 700, 'center', 2);
  text(c, 'EVERYONE', cx, r.y + 352, 34, '#9a6a4f', 800, 'center', 2);
  weather(c, r, 1.1, 23);
}

function drawPosterSafety(c: C2D, r: Region): void {
  c.fillStyle = '#a3ad8f';
  c.fillRect(r.x, r.y, r.w, r.h);
  const cx = r.x + r.w / 2;
  c.fillStyle = '#efdca6';
  c.beginPath();
  c.arc(cx, r.y + 170, 70, Math.PI, 0);
  c.lineTo(cx + 92, r.y + 176);
  c.lineTo(cx - 92, r.y + 176);
  c.fill();
  c.fillStyle = INK;
  c.fillRect(cx - 94, r.y + 176, 188, 10);
  c.fillRect(cx - 8, r.y + 100, 16, 70);
  text(c, 'SAFETY IS', cx, r.y + 44, 34, INK, 800, 'center', 2);
  text(c, "EVERYONE'S", cx, r.y + 250, 30, '#f3ece0', 800, 'center', 2);
  text(c, 'MISSION', cx, r.y + 292, 40, '#f3ece0', 800, 'center', 3);
  text(c, 'WEAR YOUR HELMET ON THE PAD', cx, r.y + 350, 11, INK, 700, 'center', 1);
  weather(c, r, 1, 37);
}

// ── Facades, mural, graffiti ───────────────────────────────────────────────

function drawFacadeHalcyon(c: C2D, r: Region): void {
  c.clearRect(r.x, r.y, r.w, r.h);
  const cx = r.x + 190;
  const cy = r.y + r.h / 2;
  // Agency emblem: a low sun over three sea stripes, in a ring.
  c.fillStyle = 'rgba(239,230,214,0.92)';
  c.beginPath();
  c.arc(cx, cy, 168, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = ENV.terracottaFaded;
  c.beginPath();
  c.arc(cx, cy + 20, 110, Math.PI, 0);
  c.fill();
  c.fillStyle = INK;
  for (let i = 0; i < 3; i++) c.fillRect(cx - 120, cy + 34 + i * 26, 240, 12);
  c.strokeStyle = INK;
  c.lineWidth = 10;
  c.beginPath();
  c.arc(cx, cy, 160, 0, Math.PI * 2);
  c.stroke();
  text(c, 'HALCYON', r.x + 560, cy - 44, 104, 'rgba(47,42,38,0.92)', 800, 'center', 6);
  text(c, 'VEHICLE ASSEMBLY · 1', r.x + 560, cy + 46, 34, 'rgba(47,42,38,0.85)', 700, 'center', 5);
  text(c, 'REACH FOR TOMORROW', r.x + 560, cy + 104, 26, 'rgba(154,106,79,0.9)', 700, 'center', 6);
  peel(c, r, 1, 51);
}

function drawFacadeStation(c: C2D, r: Region): void {
  c.clearRect(r.x, r.y, r.w, r.h);
  const cy = r.y + r.h / 2;
  // Dish emblem.
  const cx = r.x + 130;
  c.strokeStyle = 'rgba(47,42,38,0.9)';
  c.lineWidth = 12;
  c.beginPath();
  c.arc(cx, cy - 10, 80, 0.2 * Math.PI, 1.05 * Math.PI);
  c.stroke();
  c.beginPath();
  c.moveTo(cx - 20, cy + 10);
  c.lineTo(cx + 40, cy - 60);
  c.stroke();
  c.beginPath();
  c.arc(cx + 44, cy - 64, 12, 0, Math.PI * 2);
  c.fillStyle = 'rgba(47,42,38,0.9)';
  c.fill();
  text(c, 'TRACKING STATION', r.x + 600, cy - 30, 78, 'rgba(47,42,38,0.88)', 800, 'center', 5);
  text(c, 'DEEP RANGE · NORTH', r.x + 600, cy + 50, 34, 'rgba(47,42,38,0.75)', 700, 'center', 6);
  peel(c, r, 1.6, 67);
}

function drawMural(c: C2D, r: Region): void {
  // "HALCYON I — FIRST LIGHT": the first launch, painted in 1970s poster style.
  const g = c.createLinearGradient(0, r.y, 0, r.y + r.h);
  g.addColorStop(0, '#93b3c8');
  g.addColorStop(0.45, '#f0c7a3');
  g.addColorStop(0.62, '#f5b690');
  g.addColorStop(0.63, '#6f95a0');
  g.addColorStop(1, '#4f7280');
  c.fillStyle = g;
  c.fillRect(r.x, r.y, r.w, r.h);
  const sx = r.x + 720;
  const sy = r.y + 300;
  sunburst(c, sx, sy, 60, 420, 28, 'rgba(255,238,210,0.22)');
  c.fillStyle = '#ffe6b8';
  c.beginPath();
  c.arc(sx, sy, 78, Math.PI, 0);
  c.fill();
  // Sun path on the sea.
  c.fillStyle = 'rgba(255,230,180,0.75)';
  for (let i = 0; i < 9; i++) c.fillRect(sx - 90 + i * 9, sy + 14 + i * 20, 180 - i * 18, 5);
  // Launch tower + rocket climbing on a plume.
  const tx = r.x + 330;
  c.fillStyle = '#9a6a4f';
  c.fillRect(tx - 24, r.y + 120, 16, 200);
  c.fillRect(tx + 8, r.y + 120, 16, 200);
  c.strokeStyle = '#9a6a4f';
  c.lineWidth = 3;
  for (let y = r.y + 130; y < r.y + 316; y += 22) {
    c.beginPath();
    c.moveTo(tx - 16, y);
    c.lineTo(tx + 16, y + 22);
    c.moveTo(tx + 16, y);
    c.lineTo(tx - 16, y + 22);
    c.stroke();
  }
  c.fillStyle = 'rgba(255,250,240,0.92)';
  c.beginPath();
  c.moveTo(tx + 90, r.y + 170);
  c.bezierCurveTo(tx + 70, r.y + 250, tx + 160, r.y + 280, tx + 40, r.y + 320);
  c.lineTo(tx + 230, r.y + 320);
  c.bezierCurveTo(tx + 150, r.y + 280, tx + 120, r.y + 240, tx + 110, r.y + 170);
  c.fill();
  c.fillStyle = '#fff1c9';
  c.beginPath();
  c.moveTo(tx + 94, r.y + 170);
  c.lineTo(tx + 100, r.y + 214);
  c.lineTo(tx + 106, r.y + 170);
  c.fill();
  rocketGlyph(c, tx + 100, r.y + 150, 34, '#f4efe6', INK);
  // Pad + crowd silhouettes along the shore.
  c.fillStyle = '#3b4150';
  c.fillRect(r.x, r.y + 318, r.w, 8);
  for (let i = 0; i < 70; i++) {
    const x = r.x + 20 + i * 14 + ((i * 37) % 7);
    const h = 16 + ((i * 53) % 9);
    c.beginPath();
    c.arc(x, r.y + 470 - h, 5, 0, Math.PI * 2);
    c.fill();
    c.fillRect(x - 5, r.y + 470 - h, 10, h + 30);
  }
  c.fillStyle = '#3b4150';
  c.fillRect(r.x, r.y + 470, r.w, 42);
  text(c, 'HALCYON I', r.x + 180, r.y + 60, 64, '#2f2a26', 800, 'center', 5);
  text(c, 'FIRST LIGHT', r.x + 180, r.y + 112, 30, '#9a6a4f', 700, 'center', 8);
  text(c, 'WE WENT TOGETHER', r.x + 780, r.y + 490, 22, '#f3ece0', 700, 'center', 6);
  // Heavy weathering: peeling paint, salt bloom.
  weather(c, r, 2.4, 91);
  const rnd = rng(92);
  for (let i = 0; i < 30; i++) {
    c.fillStyle = `rgba(207,196,176,${0.5 + rnd() * 0.4})`;
    const x = r.x + rnd() * r.w;
    const y = r.y + rnd() * r.h;
    c.beginPath();
    c.moveTo(x, y);
    for (let k = 0; k < 6; k++) c.lineTo(x + (rnd() - 0.3) * 60, y + (rnd() - 0.3) * 40);
    c.fill();
  }
}

function drawGraffiti(c: C2D, r: Region): void {
  // The Bloom's glowing paint over bare concrete: a flower sigil and tags.
  c.clearRect(r.x, r.y, r.w, r.h);
  const cx = r.x + 110;
  const cy = r.y + r.h / 2;
  c.strokeStyle = ENV.glowChartreuse;
  c.lineWidth = 9;
  c.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    c.beginPath();
    c.ellipse(cx + Math.cos(a) * 34, cy + Math.sin(a) * 34, 36, 14, a, 0, Math.PI * 2);
    c.stroke();
  }
  c.fillStyle = ENV.glowSoftPink;
  c.beginPath();
  c.arc(cx, cy, 16, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = ENV.glowChartreuse;
  c.font = `italic 800 64px ${FONT}`;
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  c.fillText('WE BLOOM', r.x + 200, cy - 20);
  c.fillStyle = ENV.glowSoftPink;
  c.font = `italic 700 26px ${FONT}`;
  c.fillText('the sky was always ours', r.x + 210, cy + 42);
  // Drips.
  c.fillStyle = ENV.glowChartreuse;
  const rnd = rng(7);
  for (let i = 0; i < 14; i++) c.fillRect(r.x + 200 + rnd() * 290, cy + 10, 3, 10 + rnd() * 50);
}

function drawScreens(c: C2D, r: Region): void {
  // Four CRT panels in warm amber phosphor (emissive).
  c.fillStyle = '#120f0d';
  c.fillRect(r.x, r.y, r.w, r.h);
  for (let i = 0; i < 4; i++) {
    const x = r.x + 8 + i * 126;
    const y = r.y + 10;
    c.fillStyle = '#2a1d10';
    c.fillRect(x, y, 116, 108);
    c.strokeStyle = 'rgba(255,211,140,0.85)';
    c.lineWidth = 2;
    c.beginPath();
    if (i === 0) {
      for (let k = 0; k <= 40; k++) {
        const px = x + 6 + k * 2.6;
        const py = y + 54 + Math.sin(k * 0.45) * 26 * Math.exp(-k * 0.02);
        if (k === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
    } else if (i === 1) {
      c.arc(x + 58, y + 54, 40, 0, Math.PI * 2);
      c.moveTo(x + 58, y + 54);
      c.lineTo(x + 88, y + 30);
    } else {
      for (let k = 0; k < 8; k++) {
        c.moveTo(x + 8, y + 12 + k * 12);
        c.lineTo(x + 8 + ((k * 37 + i * 11) % 90) + 10, y + 12 + k * 12);
      }
    }
    c.stroke();
    c.fillStyle = 'rgba(255,227,161,0.12)';
    for (let k = 0; k < 54; k++) c.fillRect(x, y + k * 2, 116, 1);
  }
}

function drawHazard(c: C2D, r: Region): void {
  c.fillStyle = '#efe6d6';
  c.fillRect(r.x, r.y, r.w, r.h);
  c.fillStyle = '#9a6a4f';
  for (let x = r.x - r.h; x < r.x + r.w; x += 48) {
    c.beginPath();
    c.moveTo(x, r.y + r.h);
    c.lineTo(x + 24, r.y + r.h);
    c.lineTo(x + 24 + r.h, r.y);
    c.lineTo(x + r.h, r.y);
    c.fill();
  }
  weather(c, r, 1.4, 5);
}

function drawDeckSeven(c: C2D, r: Region): void {
  c.clearRect(r.x, r.y, r.w, r.h);
  c.strokeStyle = 'rgba(239,230,214,0.85)';
  c.lineWidth = 10;
  c.beginPath();
  c.arc(r.x + r.w / 2, r.y + r.h / 2, r.w / 2 - 12, 0, Math.PI * 2);
  c.stroke();
  text(c, '7', r.x + r.w / 2, r.y + r.h / 2 + 8, 180, 'rgba(239,230,214,0.88)', 800);
  peel(c, r, 2.2, 77);
}

export function paintAtlas(c: C2D, w: number, h: number): void {
  c.save();
  c.scale(w / ATLAS_W, h / ATLAS_H);
  c.clearRect(0, 0, ATLAS_W, ATLAS_H);
  drawPosterReach(c, R.posterReach);
  drawPosterSky(c, R.posterSky);
  drawPosterSafety(c, R.posterSafety);
  drawCountdown(c, R.countdown);
  stencil(c, R.stencilPad, 'LAUNCH COMPLEX 7', '#efe6d6', INK, 40, 1);
  stencil(c, R.stencilTrench, 'FLAME TRENCH · KEEP CLEAR', '#c99a82', INK, 34, 2);
  stencil(c, R.stencilLox, 'LOX · NO OPEN FLAME', '#efe6d6', '#9a6a4f', 38, 3);
  stencil(c, R.stencilDock, 'DOCK 3 · HEAVY LIFT', '#b9cfda', INK, 36, 4);
  stencil(c, R.stencilBunker, 'MISSION CONTROL', '#cfc4b0', INK, 26, 5);
  stencil(c, R.stencilRp1, 'RP-1 FUEL', '#efdca6', INK, 30, 6);
  stencil(c, R.stencilExit, 'EXIT ▲ PAD', '#a3ad8f', INK, 28, 7);
  stencil(c, R.stencilCrane, 'SWL 40 T', '#efdca6', INK, 30, 8);
  stencil(c, R.stencilLox2, 'LOX 2', null, 'rgba(47,42,38,0.85)', 46, 9);
  stencil(c, R.stencilHangar, 'HANGAR 1 · AUTHORIZED ONLY', '#efe6d6', INK, 28, 10);
  stencil(c, R.stencilStation, 'NO ENTRY · DISH IN MOTION', '#c9dcc1', INK, 28, 11);
  stencil(c, R.plaque, 'FROM HERE WE REACHED THE SKY', '#8e877b', '#efe6d6', 24, 12);
  drawFacadeHalcyon(c, R.facadeHalcyon);
  drawMural(c, R.mural);
  drawFacadeStation(c, R.facadeStation);
  drawHazard(c, R.hazard);
  drawScreens(c, R.screens);
  drawGraffiti(c, R.graffiti);
  drawDeckSeven(c, R.deckSeven);
  c.restore();
}

// ── Foliage cards (separate 512×512 alpha texture) ─────────────────────────
// Left half: an ivy curtain (dense crown, trailing tongues). Right top: a round
// bush. Right bottom: a grass/fern tuft. Painted in muted, cool greens so the
// warm sunset keeps them green instead of mustard.

export const LEAF_UV = {
  curtain: [0.0, 0.0, 0.5, 1.0] as [number, number, number, number],
  bush: [0.5, 0.5, 1.0, 1.0] as [number, number, number, number],
  tuft: [0.5, 0.0, 1.0, 0.5] as [number, number, number, number],
};

/** Leaf tones: ENV olive → sage, cooled toward the violet shadow color (dark → light). */
function leafTones(): string[] {
  const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a: string, b: string, t: number): string => {
    const x = hex(a);
    const y = hex(b);
    return `rgb(${Math.round(x[0] + (y[0] - x[0]) * t)},${Math.round(x[1] + (y[1] - x[1]) * t)},${Math.round(x[2] + (y[2] - x[2]) * t)})`;
  };
  // Pulled slightly toward sky blue so the warm sunset keeps them green, not mustard.
  const base = [mix(ENV.olive, ENV.shadowCool, 0.5), mix(ENV.olive, ENV.shadowCool, 0.3), mix(ENV.olive, ENV.shadowCool, 0.12), mix(ENV.olive, ENV.sage, 0.4), mix(ENV.sage, ENV.olive, 0.2), ENV.sage];
  return base.map((c) => {
    const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(c);
    const rgb = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : hex(c);
    const sky = hex(ENV.skyBlue);
    return `rgb(${Math.round(rgb[0] * 0.78 + sky[0] * 0.08)},${Math.round(rgb[1] * 0.9 + sky[1] * 0.1)},${Math.round(rgb[2] * 0.8 + sky[2] * 0.12)})`;
  });
}
const LEAF_TONES = leafTones();

function leafCluster(c: C2D, x: number, y: number, r: number, rnd: () => number, n: number): void {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * r;
    const px = x + Math.cos(a) * d;
    const py = y + Math.sin(a) * d;
    const size = 5 + rnd() * 9;
    const shade = Math.min(LEAF_TONES.length - 1, Math.floor(((py - y) / r) * -1.5 + rnd() * 3.5 + 1));
    c.fillStyle = LEAF_TONES[Math.max(0, shade)];
    c.beginPath();
    c.ellipse(px, py, size, size * 0.55, rnd() * Math.PI, 0, Math.PI * 2);
    c.fill();
  }
}

export function paintLeaves(c: C2D, w: number, h: number): void {
  c.clearRect(0, 0, w, h);
  c.save();
  c.scale(w / 512, h / 512);
  const rnd = rng(4242);
  // Curtain: crown across the top, tongues trailing down.
  for (let x = 10; x < 246; x += 14) leafCluster(c, x, 26 + rnd() * 16, 30, rnd, 18);
  for (let t = 0; t < 9; t++) {
    const x = 16 + t * 28 + rnd() * 10;
    const len = 120 + rnd() * 360;
    for (let y = 40; y < len; y += 16) leafCluster(c, x + Math.sin(y * 0.03 + t) * 8, y, 16 * (1 - (y / len) * 0.6), rnd, 7);
  }
  // Bush.
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * 80;
    leafCluster(c, 384 + Math.cos(a) * d, 138 + Math.sin(a) * d * 0.8, 34, rnd, 16);
  }
  // Tuft (bottom-right quadrant): fronds from a base point.
  c.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * 2.2;
    const len = 90 + rnd() * 130;
    c.strokeStyle = LEAF_TONES[1 + Math.floor(rnd() * 4)];
    c.lineWidth = 5 + rnd() * 5;
    c.beginPath();
    c.moveTo(384, 506);
    c.quadraticCurveTo(384 + Math.cos(a) * len * 0.5, 506 + Math.sin(a) * len * 0.8, 384 + Math.cos(a) * len, 506 + Math.sin(a) * len * 0.7 + 30);
    c.stroke();
  }
  c.restore();
}

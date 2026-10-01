// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Observatory sign/prop atlas (one 1024² canvas texture).
//
// Diegetic 1970s–80s paper and paint: the brass survey plaque, star charts, the
// chalkboard of orbital math, a tram poster, analog dial faces, the radio, the
// frosted window glows, stencils and station signs. English text is diegetic
// signage (the station was international), kept tasteful and sparse.
// Everything is painted procedurally; `rect(name)` gives the UV rectangle.
// ─────────────────────────────────────────────────────────────────────────────

import { ENV } from '../../../engine/palette';

export const ATLAS_W = 1024;
export const ATLAS_H = 1024;

type R = [number, number, number, number];
const REG = {
  plaque: [0, 0, 512, 128],
  chalk: [512, 0, 512, 256],
  chart1: [0, 128, 256, 256],
  chart2: [256, 128, 256, 256],
  poster: [0, 384, 256, 384],
  dials: [256, 384, 256, 128],
  radio: [256, 512, 128, 128],
  window: [384, 512, 64, 128],
  windowCool: [448, 512, 64, 128],
  signTerminal: [512, 256, 512, 64],
  signQuarters: [512, 320, 512, 64],
  signDorm: [512, 384, 512, 64],
  signCable: [512, 448, 512, 64],
  signSpectro: [512, 512, 512, 64],
  signDome: [512, 576, 512, 64],
  stencil: [512, 640, 512, 64],
  hazard: [512, 704, 512, 32],
  gauge: [256, 640, 128, 128],
  roundel: [384, 640, 128, 128],
  map: [0, 768, 256, 256],
  calendar: [256, 768, 128, 128],
  seven: [384, 768, 128, 128],
  signPorch: [512, 768, 256, 64],
  signVolts: [512, 832, 256, 64],
  signSpare: [512, 896, 256, 64],
  signBoiler: [512, 960, 256, 64],
  moon: [768, 768, 256, 256],
} satisfies Record<string, R>;

export type AtlasName = keyof typeof REG;

/** UV rect [u0, v0, u1, v1] (three.js flipY convention). Optional inset in px avoids bleeding. */
export function rect(name: AtlasName, inset = 1): [number, number, number, number] {
  const [x, y, w, h] = REG[name];
  return [(x + inset) / ATLAS_W, 1 - (y + h - inset) / ATLAS_H, (x + w - inset) / ATLAS_W, 1 - (y + inset) / ATLAS_H];
}

const SANS = '"Space Grotesk", "Helvetica Neue", Arial, sans-serif';
const MONO = '"JetBrains Mono", "Courier New", monospace';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  };
}

/** Subtle paper grain / brush noise over a region. */
function grain(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, amt: number, seed: number): void {
  const r = rng(seed);
  for (let i = 0; i < (w * h) / 18; i++) {
    const a = r() * amt;
    c.fillStyle = r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.7})`;
    c.fillRect(x + r() * w, y + r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

function text(c: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, font = SANS, weight = 600, align: CanvasTextAlign = 'center', spacing = 0): void {
  c.fillStyle = color;
  c.font = `${weight} ${size}px ${font}`;
  c.textAlign = align;
  c.textBaseline = 'middle';
  const cc = c as CanvasRenderingContext2D & { letterSpacing?: string };
  if (spacing && 'letterSpacing' in cc) cc.letterSpacing = `${spacing}px`;
  c.fillText(s, x, y);
  if (spacing && 'letterSpacing' in cc) cc.letterSpacing = '0px';
}

function star(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.32;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
  c.fill();
}

// ── Painters ────────────────────────────────────────────────────────────────

function paintPlaque(c: CanvasRenderingContext2D, [x, y, w, h]: R): void {
  const g = c.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, '#d9b777');
  g.addColorStop(0.5, '#b98f4f');
  g.addColorStop(1, '#8f6a37');
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
  c.strokeStyle = 'rgba(60,40,20,0.7)';
  c.lineWidth = 4;
  c.strokeRect(x + 8, y + 8, w - 16, h - 16);
  c.strokeStyle = 'rgba(255,236,190,0.5)';
  c.lineWidth = 1.5;
  c.strokeRect(x + 13, y + 13, w - 26, h - 26);
  c.fillStyle = 'rgba(70,45,20,0.85)';
  star(c, x + 52, y + h / 2, 22);
  text(c, 'HALCYON DEEP SKY SURVEY', x + w / 2 + 26, y + 48, 30, 'rgba(62,40,18,0.92)', SANS, 700, 'center', 3);
  text(c, '— SUMMIT STATION · 1981 —', x + w / 2 + 26, y + 86, 20, 'rgba(62,40,18,0.85)', SANS, 600, 'center', 4);
  for (const [sx, sy] of [[x + 20, y + 20], [x + w - 20, y + 20], [x + 20, y + h - 20], [x + w - 20, y + h - 20]]) {
    c.fillStyle = '#6e5028';
    c.beginPath();
    c.arc(sx, sy, 4, 0, Math.PI * 2);
    c.fill();
  }
  // Verdigris creeping from the bottom edge.
  const v = c.createLinearGradient(x, y + h, x, y + h * 0.55);
  v.addColorStop(0, 'rgba(120,150,120,0.45)');
  v.addColorStop(1, 'rgba(120,150,120,0)');
  c.fillStyle = v;
  c.fillRect(x, y + h * 0.55, w, h * 0.45);
  grain(c, x, y, w, h, 0.1, 11);
}

function paintChalk(c: CanvasRenderingContext2D, [x, y, w, h]: R): void {
  c.fillStyle = '#6b4a30';
  c.fillRect(x, y, w, h);
  c.fillStyle = '#2f3a36';
  c.fillRect(x + 10, y + 10, w - 20, h - 36);
  const r = rng(7);
  // Old erased smudges.
  for (let i = 0; i < 26; i++) {
    c.fillStyle = `rgba(230,230,220,${0.03 + r() * 0.05})`;
    c.beginPath();
    c.ellipse(x + 20 + r() * (w - 40), y + 20 + r() * (h - 60), 20 + r() * 60, 8 + r() * 20, r() * 3, 0, Math.PI * 2);
    c.fill();
  }
  const chalk = 'rgba(238,236,226,0.9)';
  c.strokeStyle = chalk;
  c.lineWidth = 2.5;
  // Orbit diagram: ellipse with a focus and a planet.
  c.beginPath();
  c.ellipse(x + 118, y + 108, 88, 56, -0.2, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = chalk;
  c.beginPath();
  c.arc(x + 88, y + 114, 7, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.arc(x + 196, y + 80, 4, 0, Math.PI * 2);
  c.fill();
  c.setLineDash([5, 6]);
  c.beginPath();
  c.moveTo(x + 88, y + 114);
  c.lineTo(x + 196, y + 80);
  c.stroke();
  c.setLineDash([]);
  text(c, 'r', x + 140, y + 88, 18, chalk, 'Georgia, serif', 400);
  text(c, 'a(1−e²)', x + 118, y + 186, 16, chalk, 'Georgia, serif', 400);
  // Equations.
  const eq = ['T² = 4π²a³ / GM', 'M = E − e sin E', 'v² = GM (2/r − 1/a)', 'Δv ≈ 3.1 km/s  (LEO → GTO)', 'e = 0.0167 ✓'];
  eq.forEach((s, i) => text(c, s, x + 250, y + 40 + i * 34, 19, chalk, 'Georgia, serif', 400, 'left'));
  // Circled note + underline.
  c.beginPath();
  c.ellipse(x + 330, y + 176, 96, 18, 0, 0, Math.PI * 2);
  c.stroke();
  text(c, 'check with Kestrel!', x + 250, y + 208, 16, 'rgba(255,214,190,0.85)', 'Georgia, serif', 400, 'left');
  // Chalk tray + stubs.
  c.fillStyle = '#5a3d27';
  c.fillRect(x + 10, y + h - 26, w - 20, 12);
  c.fillStyle = '#f2efe6';
  c.fillRect(x + 60, y + h - 30, 22, 6);
  c.fillStyle = '#f0c9c0';
  c.fillRect(x + 100, y + h - 30, 14, 6);
  grain(c, x, y, w, h, 0.08, 17);
}

function paintChart(c: CanvasRenderingContext2D, [x, y, w, h]: R, seed: number, round: boolean): void {
  c.fillStyle = '#e9dfc8';
  c.fillRect(x, y, w, h);
  const cx = x + w / 2;
  const cy = y + h / 2 + (round ? 0 : 6);
  c.fillStyle = '#243058';
  if (round) {
    c.beginPath();
    c.arc(cx, cy, w * 0.44, 0, Math.PI * 2);
    c.fill();
  } else c.fillRect(x + 14, y + 26, w - 28, h - 40);
  c.save();
  c.beginPath();
  if (round) c.arc(cx, cy, w * 0.44, 0, Math.PI * 2);
  else c.rect(x + 14, y + 26, w - 28, h - 40);
  c.clip();
  // Grid of RA/Dec lines.
  c.strokeStyle = 'rgba(200,210,240,0.25)';
  c.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    c.beginPath();
    c.arc(cx, cy, (w * 0.44 * i) / 5, 0, Math.PI * 2);
    c.stroke();
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    c.beginPath();
    c.moveTo(cx, cy);
    c.lineTo(cx + Math.cos(a) * w, cy + Math.sin(a) * w);
    c.stroke();
  }
  const r = rng(seed);
  const pts: [number, number][] = [];
  for (let i = 0; i < 90; i++) {
    const px = x + r() * w;
    const py = y + r() * h;
    const s = r();
    c.fillStyle = s > 0.9 ? '#ffe9b8' : '#f4f1ff';
    c.beginPath();
    c.arc(px, py, 0.6 + s * s * 2.6, 0, Math.PI * 2);
    c.fill();
    if (s > 0.8) pts.push([px, py]);
  }
  // Constellation lines between bright stars.
  c.strokeStyle = 'rgba(255,220,170,0.55)';
  c.lineWidth = 1.2;
  for (let i = 0; i + 1 < pts.length; i++) {
    if (Math.hypot(pts[i][0] - pts[i + 1][0], pts[i][1] - pts[i + 1][1]) > 70) continue;
    c.beginPath();
    c.moveTo(pts[i][0], pts[i][1]);
    c.lineTo(pts[i + 1][0], pts[i + 1][1]);
    c.stroke();
  }
  c.restore();
  text(c, round ? 'PLANISPHÆRIUM · 47°N' : 'CHART 12 · CYGNUS', cx, y + (round ? h - 10 : 14), 12, '#3a2f22', SANS, 700, 'center', 1);
  // Pins and a coffee ring.
  c.fillStyle = '#c9785b';
  c.beginPath();
  c.arc(x + 10, y + 10, 4, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.arc(x + w - 10, y + 10, 4, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = 'rgba(120,80,40,0.25)';
  c.lineWidth = 5;
  c.beginPath();
  c.arc(x + w * 0.72, y + h * 0.78, 22, 0.3, 5.6);
  c.stroke();
  grain(c, x, y, w, h, 0.07, seed + 3);
}

function paintPoster(c: CanvasRenderingContext2D, [x, y, w, h]: R): void {
  // 70s travel poster: dusk gradient, a stylized dome on a peak, sun bands.
  const g = c.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, '#2c2f63');
  g.addColorStop(0.55, '#b98cae');
  g.addColorStop(0.75, '#f3b58c');
  g.addColorStop(1, '#f3d9b0');
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
  // Sun bands.
  for (let i = 0; i < 5; i++) {
    c.fillStyle = `rgba(255,214,160,${0.85 - i * 0.14})`;
    c.fillRect(x + 20, y + 214 + i * 10, w - 40, 5);
  }
  c.fillStyle = '#ffd9a0';
  c.beginPath();
  c.arc(x + w / 2, y + 214, 44, Math.PI, 0);
  c.fill();
  // Peak + dome silhouette.
  c.fillStyle = '#3b3560';
  c.beginPath();
  c.moveTo(x, y + h - 60);
  c.lineTo(x + 70, y + 230);
  c.lineTo(x + 128, y + 196);
  c.lineTo(x + 176, y + 236);
  c.lineTo(x + w, y + h - 90);
  c.lineTo(x + w, y + h);
  c.lineTo(x, y + h);
  c.fill();
  c.fillStyle = '#efe6d6';
  c.beginPath();
  c.arc(x + 128, y + 196, 26, Math.PI, 0);
  c.fill();
  c.fillStyle = '#3b3560';
  c.fillRect(x + 124, y + 170, 8, 26);
  // Stars.
  const r = rng(29);
  c.fillStyle = '#fff4dc';
  for (let i = 0; i < 40; i++) c.fillRect(x + r() * w, y + r() * 150, 1.5, 1.5);
  text(c, 'HALCYON', x + w / 2, y + 40, 34, '#f4e9d4', SANS, 700, 'center', 6);
  text(c, 'SUMMIT TRAMWAY', x + w / 2, y + 72, 17, '#f4e9d4', SANS, 600, 'center', 4);
  text(c, 'see the stars up close', x + w / 2, y + h - 34, 15, '#2c2f63', SANS, 600, 'center', 1);
  // Torn corner + tape.
  c.fillStyle = 'rgba(240,230,210,0.8)';
  c.fillRect(x + w / 2 - 20, y - 2, 40, 12);
  c.fillStyle = '#d7cdb8';
  c.beginPath();
  c.moveTo(x + w, y + h);
  c.lineTo(x + w - 34, y + h);
  c.lineTo(x + w, y + h - 30);
  c.fill();
  grain(c, x, y, w, h, 0.09, 31);
}

function dial(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, v: number, label: string): void {
  c.fillStyle = '#efe6d6';
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#34302c';
  c.lineWidth = r * 0.08;
  c.stroke();
  c.lineWidth = 1.2;
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * (0.75 + i * 0.15);
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82);
    c.lineTo(cx + Math.cos(a) * r * (i % 5 === 0 ? 0.6 : 0.7), cy + Math.sin(a) * r * (i % 5 === 0 ? 0.6 : 0.7));
    c.stroke();
  }
  // Red band at the top of the scale.
  c.strokeStyle = 'rgba(201,120,91,0.9)';
  c.lineWidth = r * 0.1;
  c.beginPath();
  c.arc(cx, cy, r * 0.76, Math.PI * 2.05, Math.PI * 2.25);
  c.stroke();
  const a = Math.PI * (0.75 + v * 1.5);
  c.strokeStyle = '#2a2622';
  c.lineWidth = r * 0.07;
  c.beginPath();
  c.moveTo(cx, cy);
  c.lineTo(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78);
  c.stroke();
  c.fillStyle = '#2a2622';
  c.beginPath();
  c.arc(cx, cy, r * 0.1, 0, Math.PI * 2);
  c.fill();
  text(c, label, cx, cy + r * 0.45, r * 0.22, '#34302c', MONO, 600);
}

function paintDials(c: CanvasRenderingContext2D, [x, y, w, h]: R): void {
  c.fillStyle = '#8e968a';
  c.fillRect(x, y, w, h);
  c.fillStyle = 'rgba(255,255,255,0.12)';
  c.fillRect(x, y, w, 6);
  dial(c, x + 44, y + 52, 32, 0.12, 'mV');
  dial(c, x + 126, y + 52, 32, 0.66, 'AZ');
  dial(c, x + 208, y + 52, 32, 0.93, '°K');
  for (let i = 0; i < 6; i++) {
    c.fillStyle = '#34302c';
    c.fillRect(x + 22 + i * 38, y + 98, 16, 18);
    c.fillStyle = i % 2 ? '#efe6d6' : '#c9785b';
    c.fillRect(x + 26 + i * 38, y + (i % 3 === 0 ? 100 : 106), 8, 8);
  }
  // Frost creeping in from the corners.
  const f = c.createRadialGradient(x, y + h, 0, x, y + h, 90);
  f.addColorStop(0, 'rgba(240,244,250,0.7)');
  f.addColorStop(1, 'rgba(240,244,250,0)');
  c.fillStyle = f;
  c.fillRect(x, y, w, h);
  grain(c, x, y, w, h, 0.08, 41);
}

function paintGauge(c: CanvasRenderingContext2D, [x, y, w, h]: R): void {
  c.fillStyle = '#55585c';
  c.fillRect(x, y, w, h);
  dial(c, x + w / 2, y + h / 2, w * 0.42, 0.05, 'WIND');
  const f = c.createRadialGradient(x + w, y, 0, x + w, y, 80);
  f.addColorStop(0, 'rgba(240,244,250,0.75)');
  f.addColorStop(1, 'rgba(240,244,250,0)');
  c.fillStyle = f;
  c.fillRect(x, y, w, h);
}

function paintRadio(c: CanvasRenderingContext2D, [x, y, w, h]: R): void {
  c.fillStyle = '#c99a82';
  c.fillRect(x, y, w, h);
  c.fillStyle = '#34302c';
  c.fillRect(x + 8, y + 8, w * 0.55, h - 16);
  c.fillStyle = '#8e877b';
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
    c.beginPath();
    c.arc(x + 16 + i * 7.5, y + 16 + j * 11, 2, 0, Math.PI * 2);
    c.fill();
  }
  // Tuning window (warm backlit).
  const g = c.createLinearGradient(x + 84, y, x + 120, y);
  g.addColorStop(0, '#ffe3a1');
  g.addColorStop(1, '#f6c77f');
  c.fillStyle = g;
  c.fillRect(x + 84, y + 14, 34, 44);
  c.strokeStyle = '#6b4a30';
  c.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    c.beginPath();
    c.moveTo(x + 86, y + 18 + i * 5);
    c.lineTo(x + (i % 2 ? 96 : 104), y + 18 + i * 5);
    c.stroke();
  }
  c.fillStyle = '#c9785b';
  c.fillRect(x + 100, y + 16, 2, 40);
  for (const yy of [80, 106]) {
    c.fillStyle = '#efe6d6';
    c.beginPath();
    c.arc(x + 101, y + yy, 9, 0, Math.PI * 2);
    c.fill();
  }
}

function paintWindow(c: CanvasRenderingContext2D, [x, y, w, h]: R, warm: boolean): void {
  const g = c.createLinearGradient(x, y + h, x, y);
  if (warm) {
    g.addColorStop(0, '#ffcf8a');
    g.addColorStop(0.6, '#ffe3a1');
    g.addColorStop(1, '#fff1cf');
  } else {
    g.addColorStop(0, '#9fa6d8');
    g.addColorStop(1, '#d8dcf3');
  }
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
  // Frost bloom along the lower edge and corners.
  const r = rng(warm ? 3 : 5);
  for (let i = 0; i < 60; i++) {
    const px = x + r() * w;
    const py = y + h - Math.pow(r(), 2) * h * 0.5;
    c.fillStyle = `rgba(255,255,255,${0.1 + r() * 0.25})`;
    c.beginPath();
    c.arc(px, py, 2 + r() * 6, 0, Math.PI * 2);
    c.fill();
  }
  // Frost ferns creeping in from the corners and the sill (branching crystal strokes).
  const fern = (fx: number, fy: number, ang: number, len: number, depth: number): void => {
    const ex = fx + Math.cos(ang) * len, ey = fy + Math.sin(ang) * len;
    c.strokeStyle = `rgba(255,255,255,${0.22 + depth * 0.1})`;
    c.lineWidth = 0.6 + depth * 0.5;
    c.beginPath();
    c.moveTo(fx, fy);
    c.lineTo(ex, ey);
    c.stroke();
    if (depth <= 0) return;
    for (let k = 1; k <= 3; k++) {
      const t = k / 4;
      const bx = fx + (ex - fx) * t, by = fy + (ey - fy) * t;
      fern(bx, by, ang + 0.75, len * 0.38, depth - 1);
      fern(bx, by, ang - 0.75, len * 0.38, depth - 1);
    }
  };
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  for (let i = 0; i < 7; i++) {
    const fx = x + r() * w;
    fern(fx, y + h, -Math.PI / 2 + (r() - 0.5) * 1.1, h * (0.18 + r() * 0.2), 2);
  }
  fern(x, y + h, -Math.PI / 4, h * 0.36, 2);
  fern(x + w, y + h, (-3 * Math.PI) / 4, h * 0.34, 2);
  fern(x, y, Math.PI / 4, h * 0.22, 2);
  fern(x + w, y, (3 * Math.PI) / 4, h * 0.2, 1);
  // Rime haze in the corners.
  for (const [cx, cy] of [[x, y + h], [x + w, y + h], [x, y], [x + w, y]]) {
    const g2 = c.createRadialGradient(cx, cy, 0, cx, cy, w * 0.55);
    g2.addColorStop(0, 'rgba(255,255,255,0.38)');
    g2.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g2;
    c.fillRect(x, y, w, h);
  }
  c.restore();
  // Mullion shadow.
  c.fillStyle = 'rgba(60,50,40,0.35)';
  c.fillRect(x + w / 2 - 2, y, 4, h);
  c.fillRect(x, y + h * 0.45, w, 4);
}

function paintSign(c: CanvasRenderingContext2D, [x, y, w, h]: R, label: string, bg: string, fg: string, glyph: 'star' | 'dome' | 'cable' | 'bunk' | 'prism' | 'warn'): void {
  c.fillStyle = bg;
  c.fillRect(x, y, w, h);
  c.fillStyle = fg;
  c.fillRect(x + 6, y + 6, w - 12, 2);
  c.fillRect(x + 6, y + h - 8, w - 12, 2);
  // Pictogram in a circle.
  c.beginPath();
  c.arc(x + 36, y + h / 2, 20, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = bg;
  c.strokeStyle = bg;
  c.lineWidth = 3;
  const cx = x + 36;
  const cy = y + h / 2;
  if (glyph === 'star') star(c, cx, cy, 12);
  else if (glyph === 'dome') {
    c.beginPath();
    c.arc(cx, cy + 6, 11, Math.PI, 0);
    c.fill();
    c.fillRect(cx - 12, cy + 6, 24, 5);
  } else if (glyph === 'cable') {
    c.beginPath();
    c.moveTo(cx - 14, cy - 8);
    c.lineTo(cx + 14, cy - 2);
    c.stroke();
    c.fillRect(cx - 6, cy - 2, 12, 12);
  } else if (glyph === 'bunk') {
    c.fillRect(cx - 12, cy - 8, 24, 4);
    c.fillRect(cx - 12, cy + 4, 24, 4);
    c.fillRect(cx - 12, cy - 10, 3, 20);
  } else if (glyph === 'prism') {
    c.beginPath();
    c.moveTo(cx, cy - 11);
    c.lineTo(cx + 11, cy + 9);
    c.lineTo(cx - 11, cy + 9);
    c.fill();
  } else {
    c.beginPath();
    c.moveTo(cx, cy - 12);
    c.lineTo(cx + 12, cy + 10);
    c.lineTo(cx - 12, cy + 10);
    c.fill();
    c.fillStyle = fg;
    c.fillRect(cx - 1.5, cy - 4, 3, 8);
    c.fillRect(cx - 1.5, cy + 6, 3, 2);
  }
  text(c, label, x + 68, y + h / 2 + 1, 26, fg, SANS, 700, 'left', 3);
  grain(c, x, y, w, h, 0.06, label.length * 7);
}

/** Compact enamel sign (text only, bordered). */
function paintSmallSign(c: CanvasRenderingContext2D, [x, y, w, h]: R, label: string, bg: string, fg: string, arrows = false): void {
  c.fillStyle = bg;
  c.fillRect(x, y, w, h);
  c.strokeStyle = fg;
  c.lineWidth = 3;
  c.strokeRect(x + 5, y + 5, w - 10, h - 10);
  if (arrows) {
    c.fillStyle = fg;
    for (const [ax, d] of [[x + 22, -1], [x + w - 22, 1]] as const) {
      c.beginPath();
      c.moveTo(ax + d * 10, y + h / 2);
      c.lineTo(ax - d * 6, y + h / 2 - 12);
      c.lineTo(ax - d * 6, y + h / 2 + 12);
      c.fill();
    }
  }
  text(c, label, x + w / 2, y + h / 2 + 1, 20, fg, SANS, 700, 'center', 1);
  grain(c, x, y, w, h, 0.07, label.length * 13);
}

function paintStencil(c: CanvasRenderingContext2D, [x, y, w, h]: R): void {
  c.clearRect(x, y, w, h);
  text(c, 'H A L C Y O N', x + w * 0.3, y + h / 2, 40, '#2c2a28', SANS, 700);
  text(c, 'OBS-2', x + w * 0.82, y + h / 2, 36, '#2c2a28', MONO, 700);
}

function paintHazard(c: CanvasRenderingContext2D, [x, y, w, h]: R): void {
  c.fillStyle = '#efdca6';
  c.fillRect(x, y, w, h);
  c.fillStyle = '#34302c';
  for (let i = -2; i < w / 24 + 2; i++) {
    c.beginPath();
    c.moveTo(x + i * 24, y + h);
    c.lineTo(x + i * 24 + 12, y + h);
    c.lineTo(x + i * 24 + 12 + h, y);
    c.lineTo(x + i * 24 + h, y);
    c.fill();
  }
  grain(c, x, y, w, h, 0.12, 51);
}

function paintRoundel(c: CanvasRenderingContext2D, [x, y, w, h]: R): void {
  c.clearRect(x, y, w, h);
  const cx = x + w / 2;
  const cy = y + h / 2;
  c.fillStyle = '#efe6d6';
  c.beginPath();
  c.arc(cx, cy, w * 0.46, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#34302c';
  c.lineWidth = 6;
  c.beginPath();
  c.arc(cx, cy, w * 0.4, 0, Math.PI * 2);
  c.stroke();
  // Tram cabin + cable pictogram.
  c.lineWidth = 4;
  c.beginPath();
  c.moveTo(cx - 34, cy - 20);
  c.lineTo(cx + 34, cy - 4);
  c.stroke();
  c.fillStyle = '#34302c';
  c.fillRect(cx - 16, cy - 6, 32, 26);
  c.fillStyle = '#efe6d6';
  c.fillRect(cx - 12, cy - 2, 10, 8);
  c.fillRect(cx + 2, cy - 2, 10, 8);
}

function paintMap(c: CanvasRenderingContext2D, [x, y, w, h]: R): void {
  c.fillStyle = '#e9dfc8';
  c.fillRect(x, y, w, h);
  c.strokeStyle = '#34302c';
  c.lineWidth = 3;
  c.strokeRect(x + 10, y + 30, w - 20, h - 40);
  text(c, 'SUMMIT STATION', x + w / 2, y + 16, 16, '#34302c', SANS, 700, 'center', 2);
  const mx = (px: number): number => x + 10 + ((px + 57) / 114) * (w - 20);
  const mz = (pz: number): number => y + 30 + ((pz + 60) / 120) * (h - 40);
  c.fillStyle = '#b9cfda';
  c.fillRect(mx(-12), mz(-12), mx(12) - mx(-12), mz(12) - mz(-12));
  c.fillStyle = '#efe6d6';
  c.beginPath();
  c.arc(mx(0), mz(0), (mx(9) - mx(0)), 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#34302c';
  c.stroke();
  c.fillStyle = '#8b8580';
  c.fillRect(mx(-57), mz(-13), mx(-40) - mx(-57), mz(13) - mz(-13));
  c.fillStyle = '#c99a82';
  c.fillRect(mx(24.5), mz(-15), mx(34.5) - mx(24.5), mz(15) - mz(-15));
  c.fillStyle = '#a3ad8f';
  c.fillRect(mx(42), mz(-9), mx(57) - mx(42), mz(9) - mz(-9));
  for (const [label, px, pz] of [['A', -48, 0], ['B', 0, 0], ['C', 49, 0]] as const) {
    c.fillStyle = '#34302c';
    c.beginPath();
    c.arc(mx(px), mz(pz), 9, 0, Math.PI * 2);
    c.fill();
    text(c, label, mx(px), mz(pz) + 1, 12, '#efe6d6', SANS, 700);
  }
  c.fillStyle = '#c9785b';
  for (const pz of [52, -52]) {
    c.beginPath();
    c.arc(mx(0), mz(pz), 6, 0, Math.PI * 2);
    c.fill();
  }
  grain(c, x, y, w, h, 0.07, 61);
}

function paintCalendar(c: CanvasRenderingContext2D, [x, y, w, h]: R): void {
  c.fillStyle = '#f3ece0';
  c.fillRect(x, y, w, h);
  c.fillStyle = '#9cc3d5';
  c.fillRect(x, y, w, 30);
  text(c, 'NOV 1981', x + w / 2, y + 16, 15, '#2c2f63', SANS, 700);
  c.strokeStyle = 'rgba(52,48,44,0.5)';
  c.lineWidth = 1;
  for (let i = 0; i < 7; i++) for (let j = 0; j < 5; j++) c.strokeRect(x + 6 + i * 16.5, y + 36 + j * 17, 16.5, 17);
  c.strokeStyle = 'rgba(201,120,91,0.9)';
  c.lineWidth = 2;
  for (let d = 0; d < 19; d++) {
    const i = d % 7;
    const j = Math.floor(d / 7);
    c.beginPath();
    c.moveTo(x + 8 + i * 16.5, y + 38 + j * 17);
    c.lineTo(x + 20 + i * 16.5, y + 50 + j * 17);
    c.stroke();
  }
}

function paintSeven(c: CanvasRenderingContext2D, [x, y, w, h]: R): void {
  c.clearRect(x, y, w, h);
  text(c, '7', x + w / 2, y + h / 2 + 4, 104, '#2c2a28', MONO, 700);
}

function paintMoon(c: CanvasRenderingContext2D, [x, y, w, h]: R): void {
  c.clearRect(x, y, w, h);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const R0 = w * 0.3;
  const halo = c.createRadialGradient(cx, cy, R0 * 0.9, cx, cy, w * 0.5);
  halo.addColorStop(0, 'rgba(230,236,255,0.35)');
  halo.addColorStop(1, 'rgba(230,236,255,0)');
  c.fillStyle = halo;
  c.fillRect(x, y, w, h);
  const g = c.createRadialGradient(cx - R0 * 0.3, cy - R0 * 0.3, R0 * 0.1, cx, cy, R0);
  g.addColorStop(0, '#fbf8f0');
  g.addColorStop(1, '#d9dbe8');
  c.fillStyle = g;
  c.beginPath();
  c.arc(cx, cy, R0, 0, Math.PI * 2);
  c.fill();
  // Maria.
  const r = rng(97);
  for (let i = 0; i < 9; i++) {
    c.fillStyle = `rgba(150,156,190,${0.12 + r() * 0.16})`;
    c.beginPath();
    c.ellipse(cx + (r() - 0.5) * R0 * 1.1, cy + (r() - 0.5) * R0 * 1.1, R0 * (0.12 + r() * 0.22), R0 * (0.08 + r() * 0.16), r() * 3, 0, Math.PI * 2);
    c.fill();
  }
}

/** Paints the whole atlas (used with MaterialLibrary.canvasTexture; works at half size too). */
export function paintAtlas(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.save();
  c.scale(w / ATLAS_W, h / ATLAS_H);
  c.clearRect(0, 0, ATLAS_W, ATLAS_H);
  paintPlaque(c, REG.plaque as R);
  paintChalk(c, REG.chalk as R);
  paintChart(c, REG.chart1 as R, 13, false);
  paintChart(c, REG.chart2 as R, 23, true);
  paintPoster(c, REG.poster as R);
  paintDials(c, REG.dials as R);
  paintRadio(c, REG.radio as R);
  paintWindow(c, REG.window as R, true);
  paintWindow(c, REG.windowCool as R, false);
  paintSign(c, REG.signTerminal as R, 'UPPER TERMINAL · 3412 m', ENV.bone, '#2c2f63', 'cable');
  paintSign(c, REG.signQuarters as R, 'WINTER QUARTERS', ENV.bone, '#34302c', 'bunk');
  paintSign(c, REG.signDorm as R, 'OBSERVERS’ DORMITORY', ENV.pastelBlue, '#2c2f63', 'star');
  paintSign(c, REG.signCable as R, 'CABLE STATION 7', ENV.pastelYellow, '#34302c', 'cable');
  paintSign(c, REG.signSpectro as R, 'SPECTROGRAPH', ENV.bone, '#34302c', 'prism');
  paintSign(c, REG.signDome as R, 'DOME ROTATION · KEEP CLEAR', ENV.pastelYellow, '#34302c', 'warn');
  paintStencil(c, REG.stencil as R);
  paintHazard(c, REG.hazard as R);
  paintGauge(c, REG.gauge as R);
  paintRoundel(c, REG.roundel as R);
  paintMap(c, REG.map as R);
  paintCalendar(c, REG.calendar as R);
  paintSeven(c, REG.seven as R);
  paintSmallSign(c, REG.signPorch as R, 'CENTRE GATE', ENV.pastelYellow, '#34302c', true);
  paintSmallSign(c, REG.signVolts as R, '6.6 kV · KEEP OUT', ENV.bone, '#34302c');
  paintSmallSign(c, REG.signSpare as R, 'SPARE CABIN No. 3', ENV.pastelBlue, '#2c2f63');
  paintSmallSign(c, REG.signBoiler as R, 'BOILER HOUSE', ENV.bone, '#34302c');
  paintMoon(c, REG.moon as R);
  c.restore();
}

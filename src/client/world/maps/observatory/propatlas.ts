// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Observatory prop atlas (one 512² canvas; 256² on low).
//
// Painted near-neutral so the decor kit's vertex colours tint each prop:
// stencilled plank crates (two faces + end), a ribbed equipment case with
// latches, a fuel-drum label band and lid, a jerrycan, the lunch box decal;
// plus a white-backed boot print (multiply-blended footprints) and a soft
// alpha streak (the wind-blown snow streamers).
// ─────────────────────────────────────────────────────────────────────────────

const SIZE = 512;
type R = [number, number, number, number];
const REG = {
  crateA: [0, 0, 256, 256],
  crateB: [256, 0, 256, 256],
  crateEnd: [0, 256, 128, 128],
  caseSide: [128, 256, 256, 128],
  caseTop: [384, 256, 128, 128],
  drum: [0, 384, 256, 64],
  drumTop: [256, 384, 64, 64],
  print: [320, 384, 64, 128],
  streak: [384, 384, 128, 64],
  jerry: [384, 448, 128, 64],
  lunch: [0, 448, 128, 64],
  tread: [128, 448, 192, 64],
} satisfies Record<string, R>;

export type PropName = keyof typeof REG;

/** UV rect [u0, v0, u1, v1] (flipY convention), inset to avoid mip bleeding. */
export function prect(name: PropName, inset = 2): [number, number, number, number] {
  const [x, y, w, h] = REG[name];
  return [(x + inset) / SIZE, 1 - (y + h - inset) / SIZE, (x + w - inset) / SIZE, 1 - (y + inset) / SIZE];
}

const SANS = '"Space Grotesk", "Helvetica Neue", Arial, sans-serif';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  };
}

function grain(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, amt: number, seed: number): void {
  const r = rng(seed);
  for (let i = 0; i < (w * h) / 14; i++) {
    const a = r() * amt;
    c.fillStyle = r() < 0.55 ? `rgba(40,30,25,${a})` : `rgba(255,255,255,${a * 0.8})`;
    c.fillRect(x + r() * w, y + r() * h, 1 + r() * 3, 1);
  }
}

function stencil(c: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, a = 0.82): void {
  c.font = `700 ${size}px ${SANS}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const cc = c as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in cc) cc.letterSpacing = `${Math.round(size * 0.18)}px`;
  c.fillStyle = `rgba(36,30,28,${a})`;
  c.fillText(s, x, y);
  if ('letterSpacing' in cc) cc.letterSpacing = '0px';
  // Stencil bridges + overspray.
  const r = rng(Math.round(x * 13 + y * 7));
  for (let i = 0; i < 40; i++) {
    c.fillStyle = `rgba(36,30,28,${0.05 + r() * 0.08})`;
    c.fillRect(x - size * 3 + r() * size * 6, y - size * 0.7 + r() * size * 1.4, 1.5, 1.5);
  }
}

function arrowUp(c: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  c.fillStyle = 'rgba(36,30,28,0.8)';
  c.beginPath();
  c.moveTo(x, y - s);
  c.lineTo(x + s * 0.7, y - s * 0.2);
  c.lineTo(x + s * 0.25, y - s * 0.2);
  c.lineTo(x + s * 0.25, y + s * 0.8);
  c.lineTo(x - s * 0.25, y + s * 0.8);
  c.lineTo(x - s * 0.25, y - s * 0.2);
  c.lineTo(x - s * 0.7, y - s * 0.2);
  c.closePath();
  c.fill();
}

function planks(c: CanvasRenderingContext2D, [x, y, w, h]: R, n: number, seed: number): void {
  const r = rng(seed);
  const ph = h / n;
  for (let i = 0; i < n; i++) {
    const v = 214 + Math.round(r() * 30);
    c.fillStyle = `rgb(${v},${v - 8},${v - 18})`;
    c.fillRect(x, y + i * ph, w, ph);
    // Grain streaks along the plank.
    for (let k = 0; k < 14; k++) {
      c.fillStyle = `rgba(90,70,50,${0.05 + r() * 0.1})`;
      const yy = y + i * ph + r() * ph;
      c.fillRect(x + r() * w * 0.3, yy, w * (0.3 + r() * 0.7), 1 + r());
    }
    // A knot now and then.
    if (r() < 0.5) {
      c.fillStyle = 'rgba(90,64,44,0.35)';
      c.beginPath();
      c.ellipse(x + r() * w, y + i * ph + ph / 2, 4 + r() * 4, 2 + r() * 2, 0, 0, Math.PI * 2);
      c.fill();
    }
    // Groove + top highlight.
    c.fillStyle = 'rgba(40,28,20,0.55)';
    c.fillRect(x, y + i * ph, w, 2);
    c.fillStyle = 'rgba(255,248,236,0.35)';
    c.fillRect(x, y + i * ph + 2, w, 1);
  }
}

function nails(c: CanvasRenderingContext2D, xs: number[], y0: number, y1: number, rows: number): void {
  c.fillStyle = 'rgba(50,44,44,0.75)';
  for (const x of xs) for (let i = 0; i < rows; i++) c.fillRect(x - 1.5, y0 + ((y1 - y0) * (i + 0.5)) / rows - 1.5, 3, 3);
}

function paintCrate(c: CanvasRenderingContext2D, reg: R, seed: number, label: string, sub: string): void {
  const [x, y, w, h] = reg;
  planks(c, reg, 6, seed);
  // Framing battens (darker, cross the planks at both ends) + nail heads.
  c.fillStyle = 'rgba(70,52,38,0.5)';
  c.fillRect(x, y, 18, h);
  c.fillRect(x + w - 18, y, 18, h);
  c.fillStyle = 'rgba(255,240,220,0.18)';
  c.fillRect(x + 1, y, 2, h);
  c.fillRect(x + w - 17, y, 2, h);
  nails(c, [x + 9, x + w - 9], y, y + h, 6);
  // Corner protectors (sheet steel).
  c.fillStyle = 'rgba(70,72,78,0.85)';
  for (const [cx, cy] of [[x, y], [x + w - 26, y], [x, y + h - 26], [x + w - 26, y + h - 26]]) c.fillRect(cx, cy, 26, 26);
  c.fillStyle = 'rgba(200,205,215,0.35)';
  for (const [cx, cy] of [[x + 4, y + 4], [x + w - 22, y + 4], [x + 4, y + h - 22], [x + w - 22, y + h - 22]]) c.fillRect(cx, cy, 3, 3);
  // Stencils.
  stencil(c, label, x + w / 2, y + h * 0.4, 19);
  stencil(c, sub, x + w / 2, y + h * 0.57, 11, 0.7);
  arrowUp(c, x + 46, y + h * 0.78, 13);
  arrowUp(c, x + 70, y + h * 0.78, 13);
  // A torn paper waybill.
  c.fillStyle = 'rgba(245,236,214,0.92)';
  c.fillRect(x + w - 92, y + h - 84, 54, 38);
  c.fillStyle = 'rgba(60,50,40,0.6)';
  for (let i = 0; i < 4; i++) c.fillRect(x + w - 86, y + h - 76 + i * 8, 30 + ((i * 7) % 12), 2);
  grain(c, x, y, w, h, 0.1, seed + 5);
}

function paintCrateEnd(c: CanvasRenderingContext2D, reg: R): void {
  const [x, y, w, h] = reg;
  planks(c, reg, 4, 41);
  // Z-brace.
  c.strokeStyle = 'rgba(70,52,38,0.55)';
  c.lineWidth = 12;
  c.beginPath();
  c.moveTo(x + 8, y + h - 10);
  c.lineTo(x + w - 8, y + 10);
  c.stroke();
  c.fillStyle = 'rgba(70,52,38,0.55)';
  c.fillRect(x, y, w, 12);
  c.fillRect(x, y + h - 12, w, 12);
  // Rope handle shadow.
  c.strokeStyle = 'rgba(60,50,40,0.6)';
  c.lineWidth = 4;
  c.beginPath();
  c.arc(x + w / 2, y + h * 0.42, 14, 0.15 * Math.PI, 0.85 * Math.PI);
  c.stroke();
  grain(c, x, y, w, h, 0.1, 43);
}

function paintCase(c: CanvasRenderingContext2D, [x, y, w, h]: R): void {
  // Moulded hard case: horizontal ribs, two snap latches, a hinge line, a stencil.
  const g = c.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, '#f2f0ec');
  g.addColorStop(0.5, '#e2dfda');
  g.addColorStop(1, '#c9c5bf');
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
  for (const yy of [y + h * 0.18, y + h * 0.82]) {
    c.fillStyle = 'rgba(40,40,46,0.35)';
    c.fillRect(x, yy, w, 3);
    c.fillStyle = 'rgba(255,255,255,0.45)';
    c.fillRect(x, yy + 3, w, 2);
  }
  // Hinge/lid seam.
  c.fillStyle = 'rgba(30,30,36,0.6)';
  c.fillRect(x, y + h * 0.3, w, 2);
  // Latches.
  for (const lx of [x + w * 0.22, x + w * 0.78]) {
    c.fillStyle = '#3b3c42';
    c.fillRect(lx - 14, y + h * 0.22, 28, 26);
    c.fillStyle = '#8d9097';
    c.fillRect(lx - 10, y + h * 0.24, 20, 10);
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillRect(lx - 10, y + h * 0.24, 20, 2);
  }
  // Handle recess + stencil + a warning sticker.
  c.fillStyle = 'rgba(30,30,36,0.5)';
  c.fillRect(x + w / 2 - 30, y + h * 0.22, 60, 10);
  stencil(c, 'INSTR · 12', x + w / 2, y + h * 0.58, 18, 0.75);
  c.fillStyle = '#efdca6';
  c.fillRect(x + w - 58, y + h * 0.66, 40, 22);
  c.fillStyle = 'rgba(40,30,28,0.8)';
  c.beginPath();
  c.moveTo(x + w - 38, y + h * 0.66 + 4);
  c.lineTo(x + w - 30, y + h * 0.66 + 18);
  c.lineTo(x + w - 46, y + h * 0.66 + 18);
  c.closePath();
  c.fill();
  grain(c, x, y, w, h, 0.07, 51);
}

function paintCaseTop(c: CanvasRenderingContext2D, [x, y, w, h]: R): void {
  c.fillStyle = '#e8e5e0';
  c.fillRect(x, y, w, h);
  c.strokeStyle = 'rgba(40,40,46,0.35)';
  c.lineWidth = 3;
  c.strokeRect(x + 10, y + 10, w - 20, h - 20);
  c.fillStyle = '#3b3c42';
  c.fillRect(x + w / 2 - 28, y + h / 2 - 6, 56, 12);
  c.fillStyle = 'rgba(245,236,214,0.95)';
  c.fillRect(x + 18, y + 20, 40, 24);
  c.fillStyle = 'rgba(60,50,40,0.6)';
  for (let i = 0; i < 3; i++) c.fillRect(x + 22, y + 26 + i * 6, 28, 2);
  grain(c, x, y, w, h, 0.06, 53);
}

function paintDrum(c: CanvasRenderingContext2D, [x, y, w, h]: R): void {
  const g = c.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, '#d8d6d2');
  g.addColorStop(1, '#bdbab4');
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
  // Label panel + hazard diamond, rust runs.
  c.fillStyle = 'rgba(245,238,222,0.95)';
  c.fillRect(x + w * 0.1, y + 10, w * 0.34, h - 20);
  c.fillStyle = 'rgba(40,34,30,0.75)';
  c.font = `700 11px ${SANS}`;
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  c.fillText('ARCTIC DIESEL', x + w * 0.12, y + h * 0.4);
  c.fillText('200 L · HDSS', x + w * 0.12, y + h * 0.66);
  c.save();
  c.translate(x + w * 0.62, y + h / 2);
  c.rotate(Math.PI / 4);
  c.fillStyle = '#efdca6';
  c.fillRect(-13, -13, 26, 26);
  c.strokeStyle = 'rgba(40,34,30,0.8)';
  c.lineWidth = 2;
  c.strokeRect(-11, -11, 22, 22);
  c.restore();
  const r = rng(61);
  for (let i = 0; i < 18; i++) {
    c.fillStyle = `rgba(140,80,50,${0.08 + r() * 0.15})`;
    c.fillRect(x + r() * w, y + r() * h * 0.4, 2, 6 + r() * 20);
  }
  grain(c, x, y, w, h, 0.08, 63);
}

function paintDrumTop(c: CanvasRenderingContext2D, [x, y, w, h]: R): void {
  c.fillStyle = '#c9c6c0';
  c.fillRect(x, y, w, h);
  c.strokeStyle = 'rgba(40,40,46,0.4)';
  c.lineWidth = 3;
  c.beginPath();
  c.arc(x + w / 2, y + h / 2, w * 0.42, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = '#5a5c62';
  for (const [bx, by, br] of [[0.3, 0.32, 6], [0.72, 0.62, 4]]) {
    c.beginPath();
    c.arc(x + w * bx, y + h * by, br, 0, Math.PI * 2);
    c.fill();
  }
}

function paintJerry(c: CanvasRenderingContext2D, [x, y, w, h]: R): void {
  c.fillStyle = '#d6d3ce';
  c.fillRect(x, y, w, h);
  c.strokeStyle = 'rgba(40,40,46,0.4)';
  c.lineWidth = 4;
  c.beginPath();
  c.moveTo(x + 10, y + 10);
  c.lineTo(x + w - 10, y + h - 10);
  c.moveTo(x + w - 10, y + 10);
  c.lineTo(x + 10, y + h - 10);
  c.stroke();
  c.strokeStyle = 'rgba(255,255,255,0.4)';
  c.lineWidth = 2;
  c.strokeRect(x + 5, y + 5, w - 10, h - 10);
}

function paintLunch(c: CanvasRenderingContext2D, [x, y, w, h]: R): void {
  // A 1970s tin lunch box side: pastel bands, a rocket-and-stars sticker, scuffs.
  c.fillStyle = '#e9c3b5';
  c.fillRect(x, y, w, h);
  c.fillStyle = '#efdca6';
  c.fillRect(x, y + h * 0.62, w, h * 0.2);
  c.fillStyle = '#b9cfda';
  c.fillRect(x, y + h * 0.82, w, h * 0.18);
  c.fillStyle = '#262a66';
  c.beginPath();
  c.arc(x + w * 0.3, y + h * 0.36, 16, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#f4f1ea';
  c.fillRect(x + w * 0.3 - 2, y + h * 0.2, 4, 18);
  for (const [sx, sy] of [[0.22, 0.22], [0.4, 0.3], [0.26, 0.5]]) c.fillRect(x + w * sx, y + h * sy, 2, 2);
  c.font = `700 12px ${SANS}`;
  c.fillStyle = 'rgba(60,40,40,0.85)';
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  c.fillText('M. OKAFOR', x + w * 0.52, y + h * 0.36);
  grain(c, x, y, w, h, 0.12, 71);
}

function paintTread(c: CanvasRenderingContext2D, [x, y, w, h]: R): void {
  // White = untouched snow (multiply-blended). Lower ¾: a snowcat track — a
  // compressed band with soft cleat bars across it; top ¼: a smooth sled-runner groove.
  c.fillStyle = '#ffffff';
  c.fillRect(x, y, w, h);
  const ink = (a: number): string => `rgba(170,160,205,${a})`;
  const band = y + h * 0.3;
  const bh = h * 0.66;
  const g = c.createLinearGradient(0, band, 0, band + bh);
  g.addColorStop(0, ink(0));
  g.addColorStop(0.15, ink(0.45));
  g.addColorStop(0.85, ink(0.45));
  g.addColorStop(1, ink(0));
  c.fillStyle = g;
  c.fillRect(x, band, w, bh);
  for (let i = 0; i < 8; i++) {
    const cx = x + (i + 0.5) * (w / 8);
    c.fillStyle = 'rgba(120,110,175,0.4)';
    c.fillRect(cx - 4, band + bh * 0.12, 8, bh * 0.76);
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillRect(cx + 4, band + bh * 0.12, 3, bh * 0.76);
  }
  const g2 = c.createLinearGradient(0, y, 0, y + h * 0.25);
  g2.addColorStop(0, ink(0));
  g2.addColorStop(0.5, ink(0.55));
  g2.addColorStop(1, ink(0));
  c.fillStyle = g2;
  c.fillRect(x, y, w, h * 0.25);
}

function paintPrint(c: CanvasRenderingContext2D, [x, y, w, h]: R): void {
  c.fillStyle = '#ffffff';
  c.fillRect(x, y, w, h);
  const ink = (a: number): string => `rgba(160,150,200,${a})`;
  const blob = (cx: number, cy: number, rx: number, ry: number, a: number): void => {
    c.save();
    c.translate(cx, cy);
    c.scale(1, ry / rx);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, ink(a));
    g.addColorStop(0.7, ink(a * 0.8));
    g.addColorStop(1, ink(0));
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, rx, 0, Math.PI * 2);
    c.fill();
    c.restore();
  };
  // Sole + heel (y up = toe), a tread inside, a bright compressed rim at the toe.
  blob(x + w * 0.5, y + h * 0.32, w * 0.36, h * 0.26, 0.85);
  blob(x + w * 0.5, y + h * 0.76, w * 0.3, h * 0.15, 0.8);
  c.fillStyle = 'rgba(120,110,170,0.3)';
  for (let yy = y + h * 0.14; yy < y + h * 0.54; yy += h * 0.07) c.fillRect(x + w * 0.26, yy, w * 0.48, h * 0.022);
  for (let yy = y + h * 0.68; yy < y + h * 0.86; yy += h * 0.07) c.fillRect(x + w * 0.3, yy, w * 0.4, h * 0.022);
}

function paintStreak(c: CanvasRenderingContext2D, [x, y, w, h]: R): void {
  // Soft alpha streak: dense head, frayed wispy tail (u along the wind).
  c.clearRect(x, y, w, h);
  const r = rng(91);
  for (let i = 0; i < 70; i++) {
    const yy = y + h * (0.2 + 0.6 * r());
    const x0 = x + w * (0.05 + r() * 0.4);
    const x1 = x0 + w * (0.2 + r() * 0.5);
    const g = c.createLinearGradient(x0, 0, Math.min(x + w, x1), 0);
    const a = 0.05 + r() * 0.12;
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.25, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(x0, yy, Math.min(x + w, x1) - x0, 1 + r() * 3);
  }
  // Fade the top/bottom edges.
  const fade = c.createLinearGradient(0, y, 0, y + h);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.3, 'rgba(0,0,0,0)');
  fade.addColorStop(0.7, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  c.globalCompositeOperation = 'destination-out';
  c.fillStyle = fade;
  c.fillRect(x, y, w, h);
  c.globalCompositeOperation = 'source-over';
}

/** Paints the whole atlas (the canvas may be 512² or 256²: drawn in 512 space). */
export function paintPropAtlas(c: CanvasRenderingContext2D, w: number, h: number): void {
  c.save();
  c.scale(w / SIZE, h / SIZE);
  paintCrate(c, REG.crateA, 11, 'HALCYON · HDSS', 'FRAGILE — OPTICS');
  paintCrate(c, REG.crateB, 23, 'SUMMIT STN 04', 'KEEP DRY · THIS WAY UP');
  paintCrateEnd(c, REG.crateEnd);
  paintCase(c, REG.caseSide);
  paintCaseTop(c, REG.caseTop);
  paintDrum(c, REG.drum);
  paintDrumTop(c, REG.drumTop);
  paintPrint(c, REG.print);
  paintStreak(c, REG.streak);
  paintJerry(c, REG.jerry);
  paintLunch(c, REG.lunch);
  paintTread(c, REG.tread);
  c.restore();
}

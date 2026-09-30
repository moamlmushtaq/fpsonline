// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — the key art paintings, one per map: Gantry (launch tower +
// rocket on a coast at sunset), Pastel (modernist houses, glowing vines and
// the mall sign at golden hour), Observatory (domed observatory on a peak
// above the clouds at dusk, with stars) and the Training Range.
// ─────────────────────────────────────────────────────────────────────────────

import type { MapId } from '../../shared/types';
import { mulberry32 } from '../../shared/math';
import { brush, finish, glow, haze, mix, puff, rgba, ridge, sky, streaks, sun, type Ctx, type Rng } from './keyart-brush';

// ── Maps ────────────────────────────────────────────────────────────────────

export function paint(ctx: Ctx, map: MapId, w: number, h: number): void {
  switch (map) {
    case 'pastel':
      return paintPastel(ctx, w, h);
    case 'observatory':
      return paintObservatory(ctx, w, h);
    case 'range':
      return paintRange(ctx, w, h);
    default:
      return paintGantry(ctx, w, h);
  }
}

function paintGantry(ctx: Ctx, w: number, h: number): void {
  const rng = mulberry32(0x6a17);
  const u = h / 100;
  const horizon = h * 0.66;
  sky(ctx, w, h, [
    [0, '#3a3a66'],
    [0.28, '#6d5a82'],
    [0.5, '#c07a86'],
    [0.62, '#f2a47e'],
    [0.66, '#ffcf96'],
    [1, '#ffcf96'],
  ]);
  const sx = w * 0.7;
  const sy = horizon - h * 0.03;
  glow(ctx, sx, sy, h * 0.75, '#ffb070', 0.5);
  glow(ctx, sx, sy, h * 0.25, '#ffe2b0', 0.55);
  streaks(ctx, rng, 26, h * 0.12, h * 0.5, ['#f2a88a', '#e38c86', '#ffc59a', '#9b6f8f'], 0.55);
  sun(ctx, sx, sy, h * 0.13, '#fff4cf', '#ff9458', horizon, 'rgba(242,164,126,0.85)');
  streaks(ctx, rng, 10, h * 0.5, h * 0.62, ['#ffd3a0', '#f6a57f'], 0.5);
  // Far headland on the right.
  ridge(ctx, rng, { x0: w * 0.78, x1: w * 1.02, base: horizon, amp: h * 0.05, rough: 0.55, color: mix('#7a5a78', '#f2a47e', 0.55), bottom: horizon + 1 });
  // Sea.
  const sea = ctx.createLinearGradient(0, horizon, 0, h);
  sea.addColorStop(0, '#9a6f84');
  sea.addColorStop(0.25, '#6a5372');
  sea.addColorStop(1, '#2f2640');
  ctx.fillStyle = sea;
  ctx.fillRect(0, horizon, w, h - horizon);
  haze(ctx, horizon, h * 0.03, '#ffcf96', 0.8);
  // Sun glitter on the water.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 420; i++) {
    const t = rng();
    const y = horizon + 2 + t * t * (h - horizon) * 0.95;
    const spread = (0.02 + t * 0.14) * w;
    const x = sx + (rng() - 0.5) * 2 * spread * (0.4 + rng() * 0.6);
    const len = (0.4 + rng() * 2.4) * u * (0.5 + t);
    ctx.fillStyle = rgba(rng() < 0.7 ? '#ffd9a0' : '#fff2d0', (0.25 + rng() * 0.5) * (1 - t * 0.7));
    ctx.fillRect(x, y, len, Math.max(1, u * 0.12 * (0.5 + t)));
  }
  ctx.restore();
  brush(ctx, rng, 500, [0, horizon + u, w, h - horizon], ['#5a4868', '#7b5e7c', '#3d3150'], 0.45, 0, 3);
  // Left cliffs.
  ridge(ctx, rng, { x0: -w * 0.02, x1: w * 0.34, base: h * 0.62, amp: h * 0.2, rough: 0.52, color: mix('#4f3c55', '#c07a86', 0.25), peaks: [[0.12, 0.8]], rim: '#ffb98a' });
  // Launch complex land.
  ctx.fillStyle = '#3a2d40';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.76);
  ctx.lineTo(w * 0.58, h * 0.765);
  ctx.lineTo(w * 0.64, h * 0.8);
  ctx.lineTo(w * 0.64, h);
  ctx.lineTo(0, h);
  ctx.fill();
  ctx.strokeStyle = rgba('#ffb98a', 0.6);
  ctx.lineWidth = u * 0.25;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.76);
  ctx.lineTo(w * 0.58, h * 0.765);
  ctx.lineTo(w * 0.64, h * 0.8);
  ctx.stroke();
  // Tower.
  const tx = w * 0.38;
  const base = h * 0.765;
  const top = h * 0.07;
  const tw0 = w * 0.05;
  const tw1 = w * 0.022;
  ctx.save();
  ctx.strokeStyle = '#2b2233';
  ctx.fillStyle = '#2b2233';
  ctx.lineWidth = u * 0.55;
  const legL = (y: number) => tx - (tw0 + (tw1 - tw0) * ((base - y) / (base - top))) / 2;
  const legR = (y: number) => tx + (tw0 + (tw1 - tw0) * ((base - y) / (base - top))) / 2;
  ctx.beginPath();
  ctx.moveTo(legL(base), base);
  ctx.lineTo(legL(top), top);
  ctx.moveTo(legR(base), base);
  ctx.lineTo(legR(top), top);
  ctx.stroke();
  ctx.lineWidth = u * 0.28;
  const segs = 16;
  for (let i = 0; i < segs; i++) {
    const y0 = base - ((base - top) * i) / segs;
    const y1 = base - ((base - top) * (i + 1)) / segs;
    ctx.beginPath();
    ctx.moveTo(legL(y0), y0);
    ctx.lineTo(legR(y1), y1);
    ctx.moveTo(legR(y0), y0);
    ctx.lineTo(legL(y1), y1);
    ctx.moveTo(legL(y1), y1);
    ctx.lineTo(legR(y1), y1);
    ctx.stroke();
  }
  // Tower head + antenna + service platforms.
  ctx.fillRect(legL(top) - u * 0.8, top - u * 1.2, legR(top) - legL(top) + u * 1.6, u * 1.4);
  ctx.fillRect(tx - u * 0.12, top - u * 7, u * 0.24, u * 6);
  for (const f of [0.25, 0.5, 0.72]) {
    const y = base - (base - top) * f;
    ctx.fillRect(legL(y) - u * 1.2, y - u * 0.4, legR(y) - legL(y) + u * 2.4, u * 0.6);
  }
  ctx.restore();
  // Rim light on the tower's sun side.
  ctx.save();
  ctx.strokeStyle = rgba('#ffb98a', 0.55);
  ctx.lineWidth = u * 0.18;
  ctx.beginPath();
  ctx.moveTo(legR(base) + u * 0.3, base);
  ctx.lineTo(legR(top) + u * 0.3, top);
  ctx.stroke();
  ctx.restore();
  // Rocket.
  const rx = w * 0.455;
  const rw = w * 0.034;
  const rTop = h * 0.2;
  const body = ctx.createLinearGradient(rx - rw / 2, 0, rx + rw / 2, 0);
  body.addColorStop(0, '#7e6c80');
  body.addColorStop(0.55, '#e6d7c6');
  body.addColorStop(1, '#ffd6a8');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(rx - rw / 2, base);
  ctx.lineTo(rx - rw / 2, rTop + rw * 1.4);
  ctx.quadraticCurveTo(rx - rw / 2, rTop, rx, rTop - rw * 0.9);
  ctx.quadraticCurveTo(rx + rw / 2, rTop, rx + rw / 2, rTop + rw * 1.4);
  ctx.lineTo(rx + rw / 2, base);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba('#b9644a', 0.9);
  for (const f of [0.18, 0.46]) ctx.fillRect(rx - rw / 2, rTop + (base - rTop) * f, rw, u * 1.3);
  ctx.fillStyle = '#6f5a6a';
  ctx.beginPath();
  ctx.moveTo(rx - rw / 2, base - u * 6);
  ctx.lineTo(rx - rw * 1.05, base);
  ctx.lineTo(rx - rw / 2, base);
  ctx.moveTo(rx + rw / 2, base - u * 6);
  ctx.lineTo(rx + rw * 1.05, base);
  ctx.lineTo(rx + rw / 2, base);
  ctx.fill();
  // Gantry arms tower → rocket.
  ctx.strokeStyle = '#2b2233';
  ctx.lineWidth = u * 0.45;
  for (const f of [0.3, 0.55, 0.78]) {
    const y = base - (base - top) * f;
    ctx.beginPath();
    ctx.moveTo(legR(y), y);
    ctx.lineTo(rx - rw / 2, y + u * 0.4);
    ctx.stroke();
  }
  // Floodlights.
  for (const [fx, fh] of [
    [0.12, 0.2],
    [0.24, 0.16],
    [0.56, 0.18],
  ] as const) {
    const px = w * fx;
    const py = base - h * fh;
    ctx.fillStyle = '#2b2233';
    ctx.fillRect(px - u * 0.15, py, u * 0.3, base - py);
    ctx.fillRect(px - u * 0.9, py - u * 0.4, u * 1.8, u * 0.6);
    glow(ctx, px, py, u * 3.2, '#ffd9a0', 0.55);
  }
  // Crane (right foreground on the pier).
  ctx.fillStyle = '#271f30';
  ctx.fillRect(w * 0.86, h * 0.44, u * 1.2, h * 0.56);
  ctx.beginPath();
  ctx.moveTo(w * 0.75, h * 0.45);
  ctx.lineTo(w * 1.0, h * 0.43);
  ctx.lineTo(w * 1.0, h * 0.455);
  ctx.lineTo(w * 0.75, h * 0.465);
  ctx.fill();
  ctx.strokeStyle = '#271f30';
  ctx.lineWidth = u * 0.15;
  ctx.beginPath();
  ctx.moveTo(w * 0.79, h * 0.46);
  ctx.lineTo(w * 0.79, h * 0.56);
  ctx.stroke();
  ctx.fillStyle = '#1e1826';
  ctx.fillRect(w * 0.7, h * 0.86, w * 0.32, h * 0.14);
  // Gulls.
  ctx.strokeStyle = 'rgba(40,30,45,0.8)';
  ctx.lineWidth = u * 0.2;
  for (let i = 0; i < 4; i++) {
    const gx = w * (0.55 + rng() * 0.2);
    const gy = h * (0.22 + rng() * 0.15);
    const s = u * (0.8 + rng() * 0.6);
    ctx.beginPath();
    ctx.moveTo(gx - s, gy - s * 0.3);
    ctx.quadraticCurveTo(gx - s * 0.4, gy - s * 0.6, gx, gy);
    ctx.quadraticCurveTo(gx + s * 0.4, gy - s * 0.6, gx + s, gy - s * 0.3);
    ctx.stroke();
  }
  // Dust in the light.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = rgba('#ffd9a0', 0.15 + rng() * 0.35);
    ctx.beginPath();
    ctx.arc(rng() * w, h * 0.35 + rng() * h * 0.6, u * (0.08 + rng() * 0.2), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  brush(ctx, rng, 900, [0, 0, w, horizon], ['#ffd3a0', '#c07a86', '#6d5a82'], 0.12, -0.05, 4);
  finish(ctx, rng, '#ffb070');
}

function house(ctx: Ctx, x: number, base: number, wdt: number, hgt: number, wall: string, shade: string, u: number, roof: 'butterfly' | 'flat', round: boolean): void {
  // Shadow side (sun from the left): right third darker.
  ctx.fillStyle = wall;
  ctx.fillRect(x, base - hgt, wdt, hgt);
  ctx.fillStyle = shade;
  ctx.fillRect(x + wdt * 0.68, base - hgt, wdt * 0.32, hgt);
  // Roof.
  ctx.fillStyle = mix(shade, '#3b4150', 0.35);
  ctx.beginPath();
  if (roof === 'butterfly') {
    ctx.moveTo(x - u * 1.5, base - hgt - u * 2.2);
    ctx.lineTo(x + wdt * 0.5, base - hgt + u * 0.4);
    ctx.lineTo(x + wdt + u * 1.5, base - hgt - u * 2.2);
    ctx.lineTo(x + wdt + u * 1.5, base - hgt - u * 1.4);
    ctx.lineTo(x + wdt * 0.5, base - hgt + u * 1.2);
    ctx.lineTo(x - u * 1.5, base - hgt - u * 1.4);
  } else {
    ctx.rect(x - u * 1.8, base - hgt - u * 1.1, wdt + u * 3.6, u * 1.1);
  }
  ctx.fill();
  // Breeze-block panel.
  ctx.fillStyle = mix(wall, '#ffffff', 0.25);
  const bx = x + wdt * 0.08;
  const by = base - hgt * 0.72;
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      ctx.beginPath();
      ctx.arc(bx + c * u * 1.4 + u * 0.6, by + r * u * 1.4 + u * 0.6, u * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
  // Window: round porthole or long strip.
  ctx.fillStyle = '#3b3a48';
  if (round) {
    ctx.beginPath();
    ctx.arc(x + wdt * 0.55, base - hgt * 0.55, hgt * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = mix(wall, '#ffffff', 0.5);
    ctx.lineWidth = u * 0.35;
    ctx.stroke();
  } else {
    ctx.fillRect(x + wdt * 0.4, base - hgt * 0.7, wdt * 0.26, hgt * 0.3);
  }
  // Door.
  ctx.fillStyle = mix(shade, '#2a2632', 0.5);
  ctx.fillRect(x + wdt * 0.78, base - hgt * 0.5, wdt * 0.12, hgt * 0.5);
}

function vine(ctx: Ctx, rng: Rng, x0: number, y0: number, x1: number, y1: number, sag: number, u: number): void {
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2 + sag;
  ctx.strokeStyle = '#4f5d3f';
  ctx.lineWidth = u * 0.35;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(mx, my, x1, y1);
  ctx.stroke();
  // Leaves + glowing bulbs along the curve.
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x1;
    const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * my + t * t * y1;
    ctx.fillStyle = rng() < 0.5 ? '#5e6e45' : '#7d8566';
    ctx.beginPath();
    ctx.ellipse(x + (rng() - 0.5) * u, y + u * 0.4, u * 0.9, u * 0.4, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    if (rng() < 0.45) {
      const drop = u * (0.5 + rng() * 2.5);
      ctx.strokeStyle = '#4f5d3f';
      ctx.lineWidth = u * 0.12;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + drop);
      ctx.stroke();
      const c = rng() < 0.6 ? '#c6f06b' : '#ffe3a1';
      glow(ctx, x, y + drop, u * 2.2, c, 0.55);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x, y + drop, u * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function paintPastel(ctx: Ctx, w: number, h: number): void {
  const rng = mulberry32(0x9a57e1);
  const u = h / 100;
  const horizon = h * 0.64;
  sky(ctx, w, h, [
    [0, '#6f9cc2'],
    [0.32, '#a9c2cf'],
    [0.52, '#ecd7b4'],
    [0.64, '#f8d8a0'],
    [1, '#f3cf98'],
  ]);
  const sx = w * 0.2;
  const sy = h * 0.3;
  glow(ctx, sx, sy, h * 0.8, '#fff0c8', 0.45);
  glow(ctx, sx, sy, h * 0.14, '#fffbe8', 0.9);
  ctx.fillStyle = '#fffaf0';
  ctx.beginPath();
  ctx.arc(sx, sy, h * 0.055, 0, Math.PI * 2);
  ctx.fill();
  // Cumulus.
  puff(ctx, rng, w * 0.55, h * 0.2, h * 0.08, '#fff6e6', '#c9b3b0', 0.9);
  puff(ctx, rng, w * 0.8, h * 0.28, h * 0.1, '#fff1dc', '#c4aaa8', 0.85);
  puff(ctx, rng, w * 0.38, h * 0.36, h * 0.06, '#fff4e2', '#d2bab2', 0.75);
  streaks(ctx, rng, 12, h * 0.4, h * 0.58, ['#fff0d8', '#f6d9a8'], 0.5);
  // Distant tree line.
  ridge(ctx, rng, { x0: -10, x1: w + 10, base: horizon, amp: h * 0.06, rough: 0.7, color: mix('#8f9a78', '#f6d9a8', 0.55) });
  haze(ctx, horizon - h * 0.02, h * 0.05, '#f8dca8', 0.55);
  // Mall block + pylon sign (center-right).
  const mb = h * 0.72;
  ctx.fillStyle = mix('#e7c4b4', '#f6d9a8', 0.3);
  ctx.fillRect(w * 0.48, mb - h * 0.16, w * 0.4, h * 0.16);
  ctx.fillStyle = mix('#b9a0a6', '#f6d9a8', 0.25);
  ctx.fillRect(w * 0.48, mb - h * 0.16, w * 0.4, h * 0.025);
  ctx.fillStyle = mix('#9c9fb3', '#f6d9a8', 0.2);
  for (let i = 0; i < 9; i++) ctx.fillRect(w * (0.5 + i * 0.042), mb - h * 0.1, w * 0.028, h * 0.06);
  const px = w * 0.64;
  ctx.fillStyle = '#8e8a9c';
  ctx.fillRect(px - u * 0.5, h * 0.24, u * 1, mb - h * 0.24);
  const cy = h * 0.22;
  const cr = h * 0.085;
  ctx.fillStyle = '#f2e6d4';
  ctx.beginPath();
  ctx.arc(px, cy, cr, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d98b5f';
  ctx.lineWidth = u * 0.9;
  ctx.stroke();
  glow(ctx, px, cy, cr * 2.2, '#ffe3a1', 0.35);
  // 8-point star on the sign.
  ctx.fillStyle = '#e0a052';
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? cr * 0.72 : cr * 0.28;
    ctx.lineTo(px + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  // Sign bar with dot "letters".
  ctx.fillStyle = '#d98b5f';
  ctx.fillRect(px - cr * 1.25, cy + cr * 1.1, cr * 2.5, u * 3.2);
  ctx.fillStyle = '#fff3d6';
  for (let i = 0; i < 9; i++) ctx.fillRect(px - cr * 1.05 + i * cr * 0.24, cy + cr * 1.1 + u * 0.9, cr * 0.13, u * 1.4);
  vine(ctx, rng, px - cr * 1.3, cy + cr * 1.2, px + cr * 0.3, cy + cr * 1.6, u * 4, u);
  // Houses.
  const hb = h * 0.8;
  house(ctx, w * 0.05, hb, w * 0.2, h * 0.18, '#e9c3b5', '#b99ea3', u, 'butterfly', true);
  house(ctx, w * 0.3, hb + u, w * 0.17, h * 0.15, '#c9dcc1', '#9aa99a', u, 'flat', false);
  house(ctx, w * 0.78, hb, w * 0.19, h * 0.17, '#b9cfda', '#8f9fb3', u, 'butterfly', false);
  // Vines over the houses.
  vine(ctx, rng, w * 0.03, h * 0.6, w * 0.26, h * 0.62, u * 6, u);
  vine(ctx, rng, w * 0.28, h * 0.64, w * 0.48, h * 0.66, u * 5, u);
  vine(ctx, rng, w * 0.76, h * 0.62, w * 0.99, h * 0.61, u * 7, u);
  // Flooded street / pool reflecting the sky.
  const pool = ctx.createLinearGradient(0, hb, 0, h);
  pool.addColorStop(0, '#d9c9a8');
  pool.addColorStop(0.3, '#9fb6c0');
  pool.addColorStop(1, '#5f7280');
  ctx.fillStyle = pool;
  ctx.fillRect(0, hb, w, h - hb);
  brush(ctx, rng, 360, [0, hb, w, h - hb], ['#f6d9a8', '#b9cfda', '#7f96a3'], 0.35, 0, 3.5);
  // Overgrown foreground banks.
  ctx.fillStyle = '#4e5a3c';
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, h * 0.86);
  ctx.quadraticCurveTo(w * 0.15, h * 0.83, w * 0.3, h * 0.9);
  ctx.lineTo(w * 0.36, h);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(w, h);
  ctx.lineTo(w, h * 0.84);
  ctx.quadraticCurveTo(w * 0.85, h * 0.86, w * 0.72, h * 0.93);
  ctx.lineTo(w * 0.68, h);
  ctx.fill();
  brush(ctx, rng, 700, [0, h * 0.82, w * 0.34, h * 0.18], ['#6c7a4d', '#8b9562', '#3e4a30'], 0.8, -1.35, 3);
  brush(ctx, rng, 700, [w * 0.68, h * 0.82, w * 0.32, h * 0.18], ['#6c7a4d', '#8b9562', '#3e4a30'], 0.8, -1.8, 3);
  // Glowing bulbs in the foreground shade.
  for (let i = 0; i < 16; i++) {
    const gx = rng() < 0.5 ? rng() * w * 0.3 : w * (0.7 + rng() * 0.3);
    const gy = h * (0.86 + rng() * 0.12);
    const c = rng() < 0.65 ? '#c6f06b' : '#ffe3a1';
    glow(ctx, gx, gy, u * 2.6, c, 0.5);
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(gx, gy, u * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Lamp post.
  ctx.fillStyle = '#3b4150';
  ctx.fillRect(w * 0.7, h * 0.46, u * 0.6, h * 0.36);
  ctx.beginPath();
  ctx.arc(w * 0.7 + u * 0.3, h * 0.46, u * 1.4, Math.PI, 0);
  ctx.fill();
  // Spores.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 110; i++) {
    ctx.fillStyle = rgba(rng() < 0.5 ? '#fff4c8' : '#e9f7b8', 0.2 + rng() * 0.4);
    ctx.beginPath();
    ctx.arc(rng() * w, rng() * h * 0.9, u * (0.06 + rng() * 0.22), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  brush(ctx, rng, 800, [0, 0, w, horizon], ['#fff4dc', '#a9c2cf', '#f6d9a8'], 0.1, -0.1, 4);
  finish(ctx, rng, '#ffd79a');
}

function paintObservatory(ctx: Ctx, w: number, h: number): void {
  const rng = mulberry32(0x0b5e7);
  const u = h / 100;
  const cloudTop = h * 0.72;
  sky(ctx, w, h, [
    [0, '#12142e'],
    [0.3, '#262a55'],
    [0.52, '#56467c'],
    [0.66, '#a57a9e'],
    [0.72, '#f0a88a'],
    [1, '#b58bb0'],
  ]);
  // Stars.
  for (let i = 0; i < 380; i++) {
    const y = Math.pow(rng(), 1.6) * h * 0.62;
    const x = rng() * w;
    const r = u * (0.05 + rng() * rng() * 0.28);
    ctx.fillStyle = rgba(rng() < 0.2 ? '#ffe6c8' : '#f4f2ff', 0.35 + rng() * 0.6);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (r > u * 0.2) glow(ctx, x, y, r * 8, '#dcd8ff', 0.25);
  }
  // Crescent moon.
  const mx = w * 0.16;
  const my = h * 0.17;
  glow(ctx, mx, my, h * 0.12, '#e8e4ff', 0.25);
  ctx.fillStyle = '#f4efe6';
  ctx.beginPath();
  ctx.arc(mx, my, h * 0.035, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1c1f44';
  ctx.beginPath();
  ctx.arc(mx + h * 0.014, my - h * 0.008, h * 0.032, 0, Math.PI * 2);
  ctx.fill();
  // Last light at the horizon (left).
  glow(ctx, w * 0.12, cloudTop, h * 0.55, '#ffb48a', 0.45);
  streaks(ctx, rng, 14, h * 0.5, h * 0.7, ['#f0a88a', '#c98aa0', '#8e6c9c'], 0.45);
  // Distant peaks.
  ridge(ctx, rng, { x0: -10, x1: w * 0.4, base: cloudTop + u, amp: h * 0.16, rough: 0.55, color: mix('#5d4f80', '#b58bb0', 0.45), peaks: [[0.4, 0.9]], rim: '#ffc2a8' });
  ridge(ctx, rng, { x0: w * 0.7, x1: w + 10, base: cloudTop + u, amp: h * 0.12, rough: 0.55, color: mix('#5d4f80', '#b58bb0', 0.5), peaks: [[0.7, 0.8]] });
  // Distant rocket on a far ridge with a contrail.
  const rkx = w * 0.09;
  const rky = cloudTop - h * 0.1;
  ctx.strokeStyle = 'rgba(255,230,220,0.35)';
  ctx.lineWidth = u * 0.25;
  ctx.beginPath();
  ctx.moveTo(rkx, rky);
  ctx.bezierCurveTo(rkx + u * 2, rky - h * 0.15, rkx - u * 3, rky - h * 0.3, rkx + u * 6, rky - h * 0.46);
  ctx.stroke();
  ctx.fillStyle = '#efe6f0';
  ctx.fillRect(rkx - u * 0.35, rky - u * 3.2, u * 0.7, u * 3.2);
  // Main peak.
  const apexX = w * 0.66;
  const apexY = h * 0.38;
  ctx.fillStyle = '#35304f';
  ctx.beginPath();
  ctx.moveTo(w * 0.36, h);
  ctx.lineTo(w * 0.44, cloudTop - h * 0.02);
  ctx.lineTo(w * 0.52, h * 0.55);
  ctx.lineTo(w * 0.585, h * 0.46);
  ctx.lineTo(apexX - w * 0.035, apexY + u * 1.5);
  ctx.lineTo(apexX + w * 0.045, apexY + u * 1.5);
  ctx.lineTo(w * 0.76, h * 0.5);
  ctx.lineTo(w * 0.84, h * 0.58);
  ctx.lineTo(w * 0.94, cloudTop);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  // Snow: lit (warm pink) west faces, shaded (violet) east faces.
  ctx.fillStyle = '#f2c9c4';
  ctx.beginPath();
  ctx.moveTo(apexX - w * 0.035, apexY + u * 1.5);
  ctx.lineTo(w * 0.585, h * 0.46);
  ctx.lineTo(w * 0.555, h * 0.52);
  ctx.lineTo(w * 0.6, h * 0.5);
  ctx.lineTo(w * 0.62, h * 0.47);
  ctx.lineTo(apexX, apexY + u * 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#9e97c6';
  ctx.beginPath();
  ctx.moveTo(apexX + w * 0.045, apexY + u * 1.5);
  ctx.lineTo(w * 0.76, h * 0.5);
  ctx.lineTo(w * 0.73, h * 0.53);
  ctx.lineTo(w * 0.7, h * 0.49);
  ctx.lineTo(apexX + w * 0.01, apexY + u * 5);
  ctx.closePath();
  ctx.fill();
  brush(ctx, rng, 400, [w * 0.42, h * 0.4, w * 0.5, h * 0.35], ['#4a4468', '#7d74a6', '#f2c9c4'], 0.35, -0.9, 2.6);
  // Observatory: drum + dome with a glowing slit.
  const dx = apexX + w * 0.005;
  const dy = apexY + u * 1.5;
  const dr = w * 0.032;
  ctx.fillStyle = '#d9d3e2';
  ctx.fillRect(dx - dr * 1.05, dy - u * 3.2, dr * 2.1, u * 3.2);
  ctx.fillStyle = '#9c95b8';
  ctx.fillRect(dx + dr * 0.35, dy - u * 3.2, dr * 0.7, u * 3.2);
  const dome = ctx.createLinearGradient(dx - dr, 0, dx + dr, 0);
  dome.addColorStop(0, '#fff1ea');
  dome.addColorStop(0.55, '#e6e0ee');
  dome.addColorStop(1, '#8f89b2');
  ctx.fillStyle = dome;
  ctx.beginPath();
  ctx.arc(dx, dy - u * 3.2, dr, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#ffd98a';
  ctx.beginPath();
  ctx.moveTo(dx - dr * 0.12, dy - u * 3.2);
  ctx.lineTo(dx - dr * 0.08, dy - u * 3.2 - dr * 0.98);
  ctx.lineTo(dx + dr * 0.14, dy - u * 3.2 - dr * 0.96);
  ctx.lineTo(dx + dr * 0.16, dy - u * 3.2);
  ctx.fill();
  glow(ctx, dx, dy - u * 5, dr * 3, '#ffd98a', 0.35);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = '#ffe3a1';
    ctx.fillRect(dx - dr * 0.9 + i * dr * 0.45, dy - u * 1.9, u * 0.5, u * 0.7);
  }
  // Faint telescope beam into the stars.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const beam = ctx.createLinearGradient(dx, dy - u * 5, dx - w * 0.2, 0);
  beam.addColorStop(0, 'rgba(255,217,138,0.18)');
  beam.addColorStop(1, 'rgba(255,217,138,0)');
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(dx - u * 0.4, dy - u * 5);
  ctx.lineTo(dx - w * 0.23, 0);
  ctx.lineTo(dx - w * 0.19, 0);
  ctx.lineTo(dx + u * 0.4, dy - u * 5);
  ctx.fill();
  ctx.restore();
  // Sea of clouds.
  const sea = ctx.createLinearGradient(0, cloudTop, 0, h);
  sea.addColorStop(0, '#c99ab0');
  sea.addColorStop(0.4, '#8f7aa6');
  sea.addColorStop(1, '#5a4c7e');
  ctx.fillStyle = sea;
  ctx.fillRect(0, cloudTop + u * 2, w, h - cloudTop);
  for (let row = 0; row < 5; row++) {
    const y = cloudTop + row * h * 0.055;
    const size = h * (0.035 + row * 0.02);
    const lit = mix('#ffd0bc', '#c7a8c4', row * 0.2);
    const shade = mix('#8a78a8', '#4c406e', row * 0.2);
    for (let x = -size; x < w + size; x += size * (1.4 + rng())) puff(ctx, rng, x, y, size, lit, shade, 0.95);
  }
  haze(ctx, cloudTop, h * 0.03, '#ffc8b0', 0.45);
  // Foreground ridge with antenna array (bottom-left).
  ctx.fillStyle = '#231f38';
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, h * 0.8);
  ctx.lineTo(w * 0.1, h * 0.78);
  ctx.lineTo(w * 0.2, h * 0.84);
  ctx.lineTo(w * 0.3, h * 0.9);
  ctx.lineTo(w * 0.34, h);
  ctx.fill();
  ctx.strokeStyle = '#231f38';
  ctx.fillStyle = '#231f38';
  ctx.lineWidth = u * 0.3;
  for (const [ax, ah] of [
    [0.06, 0.2],
    [0.14, 0.15],
  ] as const) {
    const bx = w * ax;
    const by = h * 0.8;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx, by - h * ah);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(bx + u * 1.2, by - h * ah, u * 2.2, u * 1, -0.6, 0, Math.PI * 2);
    ctx.fill();
    glow(ctx, bx, by - h * ah - u, u * 1.6, '#ff9d7a', 0.7);
  }
  // Snow flurries.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let i = 0; i < 120; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = u * (0.06 + rng() * rng() * 0.22);
    ctx.fillStyle = rgba('#f4f2ff', 0.15 + rng() * 0.35);
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.8, r, -0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  brush(ctx, rng, 700, [0, 0, w, cloudTop], ['#8e84c0', '#2c2f5a', '#c98aa0'], 0.1, -0.05, 4);
  finish(ctx, rng, '#c98aa0');
}

function paintRange(ctx: Ctx, w: number, h: number): void {
  const rng = mulberry32(0x7a93);
  const u = h / 100;
  const horizon = h * 0.6;
  sky(ctx, w, h, [
    [0, '#7fa6c8'],
    [0.45, '#d8d6c4'],
    [0.6, '#f3d6a6'],
    [1, '#e9cf9e'],
  ]);
  glow(ctx, w * 0.25, h * 0.28, h * 0.7, '#fff0c8', 0.45);
  streaks(ctx, rng, 14, h * 0.15, h * 0.5, ['#fff4dc', '#f3d6a6'], 0.5);
  ridge(ctx, rng, { x0: -10, x1: w + 10, base: horizon, amp: h * 0.08, rough: 0.6, color: mix('#a88e70', '#f3d6a6', 0.5) });
  const ground = ctx.createLinearGradient(0, horizon, 0, h);
  ground.addColorStop(0, '#d9c7a7');
  ground.addColorStop(1, '#a88f6e');
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon, w, h - horizon);
  // Berm + lanes converging to the vanishing point.
  ctx.fillStyle = '#9a7d62';
  ctx.fillRect(w * 0.25, horizon - h * 0.06, w * 0.5, h * 0.07);
  ctx.strokeStyle = 'rgba(80,60,45,0.35)';
  ctx.lineWidth = u * 0.25;
  for (let i = -4; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(w * 0.5 + i * w * 0.025, horizon);
    ctx.lineTo(w * 0.5 + i * w * 0.2, h);
    ctx.stroke();
  }
  // Targets at several depths.
  for (let i = 0; i < 9; i++) {
    const d = rng();
    const y = horizon + (h - horizon) * (0.1 + d * 0.5);
    const s = u * (1.5 + d * 6);
    const x = w * (0.3 + rng() * 0.4);
    ctx.fillStyle = '#efe6d6';
    ctx.fillRect(x - s * 0.35, y - s * 2.2, s * 0.7, s * 1.6);
    ctx.beginPath();
    ctx.arc(x, y - s * 2.5, s * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c9785b';
    ctx.beginPath();
    ctx.arc(x, y - s * 1.6, s * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }
  brush(ctx, rng, 600, [0, horizon, w, h - horizon], ['#c9b28e', '#8e755c', '#efdcb8'], 0.4, 0, 3);
  finish(ctx, rng, '#ffd79a');
}


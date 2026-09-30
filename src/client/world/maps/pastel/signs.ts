// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Pastel signage atlas.
//
// Every painted sign, poster, banner and screen in the suburb lives in ONE
// canvas atlas (diegetic 1970s signage — English on purpose). Quads that map
// into the atlas are batched into two meshes: 'board' (lit paint) and 'lit'
// (self-illuminated: neon, TV test card, pylon lamps).
//
// Palette: ENV neutrals + faded terracotta + a desaturated mustard. Never the
// team orange / teal / violet.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { MaterialLibrary } from '../../../contracts';
import { ENV } from '../../../engine/palette';

const W = 2048;
const H = 2048;

/** Atlas regions in pixels: [x, y, w, h]. */
export const REGION = {
  mallSign: [0, 0, 1536, 256],
  pylon: [1536, 0, 256, 768],
  pylonStar: [1792, 0, 256, 256],
  banner: [0, 256, 1280, 160],
  directory: [1280, 256, 256, 384],
  poster1: [1792, 256, 256, 384],
  poster2: [1536, 768, 256, 384],
  chapel: [0, 416, 768, 192],
  diner: [768, 416, 512, 192],
  gas: [0, 608, 512, 160],
  gasPrice: [512, 608, 256, 256],
  truck: [768, 608, 512, 160],
  tv: [1280, 640, 256, 192],
  shops: [0, 864, 1536, 384], // 3 × 4 grid of 512 × 96 shop signs
  street1: [1792, 640, 256, 64],
  street2: [1792, 704, 256, 64],
  laundro: [1536, 1152, 512, 96],
  repair: [1536, 1248, 512, 96],
  forSale: [1792, 1344, 256, 192],
  watch: [1536, 1344, 256, 192],
  mailLetters: [1280, 832, 256, 32],
  cone: [0, 1248, 256, 384],
  openNeon: [256, 1248, 256, 128],
  starlightNeon: [512, 1248, 1024, 192],
  breeze: [0, 1664, 384, 384],
  cosmoSign: [256, 1376, 256, 288],
  marquee: [512, 1440, 512, 128],
  // Spawn screen-wall murals (spawn-facing sides).
  muralH: [384, 1664, 1664, 192],
  muralB: [384, 1856, 1664, 192],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export type RegionName = keyof typeof REGION;

export const SHOP_NAMES = [
  'COSMO RECORDS',
  'ORBIT CAFE',
  'GALAXY TOYS',
  'LUNAR SHOES',
  'SATURN TV',
  'NOVA BOOKS',
  'APOLLO SPORTS',
  'STARDUST SALON',
  'COMET CANDY',
  'ZENITH OPTICS',
  'METEOR GIFTS',
  'ECLIPSE CINEMA',
] as const;

const FONT = '"Futura", "Century Gothic", "Avenir Next", "Trebuchet MS", "DejaVu Sans", "Arial", sans-serif';

const INK = '#3e3530';
const CREAM = ENV.bone;
const TERRA = ENV.terracotta;
const TERRA_F = ENV.terracottaFaded;
const MUSTARD = '#d9c28b';
const SAGE = ENV.sage;
const SKY = ENV.skyBlue;

type Ctx = CanvasRenderingContext2D;

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function star(ctx: Ctx, cx: number, cy: number, r: number, points = 4, inner = 0.28): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * inner;
    ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  ctx.closePath();
}

/** Fitted text: shrinks the font until `text` fits `maxW`. */
function fitText(ctx: Ctx, text: string, x: number, y: number, maxW: number, size: number, weight = 'bold', spacing = 0): void {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  const measure = (): number => ctx.measureText(text).width + spacing * (text.length - 1);
  while (measure() > maxW && s > 8) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${FONT}`;
  }
  if (spacing === 0) {
    ctx.fillText(text, x, y);
    return;
  }
  // Manual letter spacing (centered at x when textAlign = center).
  const total = measure();
  let cx = ctx.textAlign === 'center' ? x - total / 2 : x;
  const align = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
  ctx.textAlign = align;
}

/** Grain + sun fade over a region (painted, weathered look). */
function weather(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number, amount = 0.14): void {
  let s = seed * 9301 + 49297;
  const rnd = (): number => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const n = Math.floor((w * h) / 900);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = rnd() < 0.5 ? `rgba(255,248,235,${amount * rnd()})` : `rgba(60,48,40,${amount * 0.7 * rnd()})`;
    const px = x + rnd() * w;
    const py = y + rnd() * h;
    ctx.fillRect(px, py, 2 + rnd() * 10, 1 + rnd() * 3);
  }
  // Top-down sun bleach.
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(255,245,225,0.14)');
  g.addColorStop(1, 'rgba(255,245,225,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function drawAtlas(ctx: Ctx): void {
  ctx.clearRect(0, 0, W, H);
  // ── Breeze-block screen tile (3 × 3 blocks, flower cut-outs) ──
  {
    const [x, y, w] = REGION.breeze;
    const b = w / 3;
    ctx.fillStyle = '#e3d6bd';
    ctx.fillRect(x, y, w, w);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const bx = x + i * b;
        const by = y + j * b;
        ctx.strokeStyle = 'rgba(120,104,88,0.55)';
        ctx.lineWidth = 3;
        ctx.strokeRect(bx + 2, by + 2, b - 4, b - 4);
        const cx = bx + b / 2;
        const cy = by + b / 2;
        // Four-petal cut-out: deep shadow with a lit lower lip.
        ctx.fillStyle = '#5f5449';
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
          ctx.beginPath();
          ctx.ellipse(cx + Math.cos(a) * b * 0.2, cy + Math.sin(a) * b * 0.2, b * 0.17, b * 0.1, a, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#efe6d6';
        ctx.beginPath();
        ctx.arc(cx, cy, b * 0.08, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    weather(ctx, x, y, w, w, 77, 0.12);
  }
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  // ── STARLIGHT facade sign: cut-out letters on a transparent ground ──
  {
    const [x, y, w, h] = REGION.mallSign;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2 + 8);
    ctx.font = `900 190px ${FONT}`;
    ctx.scale(1.18, 1);
    ctx.fillStyle = TERRA_F;
    fitText(ctx, 'STARLIGHT', 10, 12, 1100, 190, '900', 26);
    ctx.fillStyle = CREAM;
    fitText(ctx, 'STARLIGHT', 0, 0, 1100, 190, '900', 26);
    ctx.restore();
    ctx.fillStyle = MUSTARD;
    star(ctx, x + 70, y + 120, 64, 4, 0.22);
    ctx.fill();
    star(ctx, x + w - 70, y + 120, 64, 4, 0.22);
    ctx.fill();
  }

  // ── Pylon panel (vertical STARLIGHT MALL with stripes) ──
  {
    const [x, y, w, h] = REGION.pylon;
    ctx.fillStyle = CREAM;
    rr(ctx, x + 6, y + 6, w - 12, h - 12, 26);
    ctx.fill();
    const stripes = [TERRA_F, MUSTARD, SAGE];
    stripes.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(x + 30 + i * 22, y + 20, 14, h - 40);
    });
    ctx.save();
    ctx.translate(x + w / 2 + 34, y + h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = INK;
    fitText(ctx, 'STARLIGHT', 0, -34, h - 90, 104, '900', 6);
    ctx.fillStyle = TERRA_F;
    fitText(ctx, 'MALL', 0, 58, h - 200, 70, 'bold', 22);
    ctx.restore();
    weather(ctx, x, y, w, h, 3);
  }
  {
    const [x, y, w, h] = REGION.pylonStar;
    ctx.fillStyle = '#fff4d8';
    star(ctx, x + w / 2, y + h / 2, w * 0.47, 4, 0.2);
    ctx.fill();
    ctx.fillStyle = '#ffe3a1';
    star(ctx, x + w / 2, y + h / 2, w * 0.3, 8, 0.45);
    ctx.fill();
  }

  // ── GRAND OPENING 1976 banner ──
  {
    const [x, y, w, h] = REGION.banner;
    ctx.fillStyle = CREAM;
    ctx.fillRect(x, y + 10, w, h - 20);
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = i % 2 ? TERRA_F : SAGE;
      ctx.beginPath();
      ctx.moveTo(x + i * (w / 26), y + 10);
      ctx.lineTo(x + (i + 1) * (w / 26), y + 10);
      ctx.lineTo(x + (i + 0.5) * (w / 26), y + 40);
      ctx.fill();
    }
    ctx.fillStyle = INK;
    fitText(ctx, 'STARLIGHT MALL — GRAND OPENING 1976', x + w / 2, y + h / 2 + 18, w - 80, 70, '900', 4);
    weather(ctx, x, y, w, h, 5, 0.2);
  }

  // ── Mall directory ──
  {
    const [x, y, w, h] = REGION.directory;
    ctx.fillStyle = '#2f2b28';
    rr(ctx, x + 4, y + 4, w - 8, h - 8, 18);
    ctx.fill();
    ctx.fillStyle = CREAM;
    fitText(ctx, 'MALL DIRECTORY', x + w / 2, y + 36, w - 40, 26, 'bold', 3);
    const cols = [TERRA_F, SAGE, SKY, MUSTARD, ENV.pastelPink, ENV.pastelMint];
    for (let i = 0; i < 10; i++) {
      const bx = x + 26 + (i % 2) * 110;
      const by = y + 70 + Math.floor(i / 2) * 44;
      ctx.fillStyle = cols[i % cols.length];
      ctx.fillRect(bx, by, 96, 34);
    }
    ctx.strokeStyle = CREAM;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + 180, 34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = TERRA;
    ctx.beginPath();
    ctx.arc(x + 70, y + 330, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = CREAM;
    ctx.textAlign = 'left';
    fitText(ctx, 'YOU ARE HERE', x + 92, y + 331, 140, 20, 'bold');
    ctx.textAlign = 'center';
  }

  muralHalcyon(ctx);
  muralMoonbeam(ctx);
  cosmoRoadSign(ctx);
  // ── Chapel letter-board marquee ──
  {
    const [x, y, w, h] = REGION.marquee;
    ctx.fillStyle = CREAM;
    rr(ctx, x + 2, y + 2, w - 4, h - 4, 12);
    ctx.fill();
    ctx.fillStyle = '#34302c';
    ctx.fillRect(x + 14, y + 14, w - 28, h - 28);
    ctx.fillStyle = CREAM;
    fitText(ctx, 'SUNDAY 10 AM', x + w / 2, y + 36, w - 60, 26, 'bold', 5);
    fitText(ctx, 'POTLUCK AFTER SERVICE', x + w / 2, y + 64, w - 60, 22, 'bold', 4);
    ctx.fillStyle = MUSTARD;
    fitText(ctx, 'ALL WELCOME · BRING A DISH', x + w / 2, y + 92, w - 60, 18, 'bold', 3);
    weather(ctx, x, y, w, h, 61, 0.18);
  }

  // ── MOON BASE HOME KITS posters ──
  const poster = (region: readonly [number, number, number, number], variant: number): void => {
    const [x, y, w, h] = region;
    const sky = ctx.createLinearGradient(0, y, 0, y + h * 0.7);
    sky.addColorStop(0, variant ? '#2f3346' : '#3a3440');
    sky.addColorStop(1, variant ? '#c99a82' : '#e9c3b5');
    ctx.fillStyle = sky;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#f3ecdf';
    ctx.beginPath();
    ctx.arc(x + w * 0.72, y + h * 0.2, w * 0.13, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = 'rgba(255,245,225,0.7)';
      ctx.fillRect(x + ((i * 97) % w), y + ((i * 53) % (h * 0.4)), 2, 2);
    }
    // Lunar ground + domes.
    ctx.fillStyle = '#cfc4b0';
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.62);
    ctx.quadraticCurveTo(x + w * 0.5, y + h * 0.55, x + w, y + h * 0.64);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.fill();
    ctx.fillStyle = CREAM;
    ctx.beginPath();
    ctx.arc(x + w * 0.38, y + h * 0.63, w * 0.2, Math.PI, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + w * 0.7, y + h * 0.64, w * 0.11, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = TERRA;
    ctx.fillRect(x + w * 0.3, y + h * 0.6, w * 0.16, 5);
    // Family silhouette.
    ctx.fillStyle = INK;
    for (const [fx, fh] of [
      [0.15, 0.12],
      [0.2, 0.1],
      [0.24, 0.07],
    ] as const) {
      ctx.fillRect(x + w * fx, y + h * (0.68 - fh), 8, h * fh);
      ctx.beginPath();
      ctx.arc(x + w * fx + 4, y + h * (0.68 - fh) - 6, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = CREAM;
    ctx.fillRect(x, y + h * 0.72, w, h * 0.28);
    ctx.fillStyle = INK;
    fitText(ctx, 'MOON BASE', x + w / 2, y + h * 0.79, w - 24, 44, '900', 2);
    ctx.fillStyle = TERRA;
    fitText(ctx, 'HOME KITS', x + w / 2, y + h * 0.87, w - 24, 34, 'bold', 4);
    ctx.fillStyle = INK;
    fitText(ctx, variant ? 'RESERVE YOUR PLOT TODAY' : "YOUR FAMILY'S FUTURE — NOW", x + w / 2, y + h * 0.945, w - 24, 15, 'bold', 1);
    weather(ctx, x, y, w, h, 11 + variant, 0.22);
  };
  poster(REGION.poster1, 0);
  poster(REGION.poster2, 1);

  // ── Chapel sign ──
  {
    const [x, y, w, h] = REGION.chapel;
    ctx.fillStyle = CREAM;
    rr(ctx, x + 6, y + 6, w - 12, h - 12, 20);
    ctx.fill();
    ctx.fillStyle = TERRA_F;
    ctx.fillRect(x + 6, y + h - 40, w - 12, 20);
    ctx.fillStyle = INK;
    fitText(ctx, 'HALCYON HEIGHTS', x + w / 2, y + 56, w - 60, 58, '900', 6);
    fitText(ctx, 'COMMUNITY CHAPEL · ALL WELCOME', x + w / 2, y + 118, w - 60, 30, 'bold', 3);
    weather(ctx, x, y, w, h, 17);
  }
  // ── Diner (neon-ish script on dark) ──
  {
    const [x, y, w, h] = REGION.diner;
    ctx.fillStyle = '#2d2724';
    rr(ctx, x + 4, y + 4, w - 8, h - 8, 60);
    ctx.fill();
    ctx.fillStyle = '#ffe3a1';
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2 - 12);
    ctx.transform(1, 0, -0.18, 1, 0, 0);
    fitText(ctx, 'Moonbeam', 0, 0, w - 80, 92, 'bold italic');
    ctx.restore();
    ctx.fillStyle = '#ffb3c7';
    fitText(ctx, 'DINER · OPEN 24 HRS', x + w / 2, y + h - 36, w - 90, 26, 'bold', 4);
  }
  // ── Gas station ──
  {
    const [x, y, w, h] = REGION.gas;
    ctx.fillStyle = CREAM;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = TERRA;
    ctx.fillRect(x, y + h - 34, w, 18);
    ctx.fillStyle = INK;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2 - 12);
    ctx.scale(1.15, 1);
    fitText(ctx, 'COMET GAS', 0, 0, w - 120, 84, '900', 4);
    ctx.restore();
    ctx.fillStyle = MUSTARD;
    star(ctx, x + 40, y + 60, 26, 4, 0.25);
    ctx.fill();
    weather(ctx, x, y, w, h, 23);
  }
  {
    const [x, y, w, h] = REGION.gasPrice;
    ctx.fillStyle = '#2f2b28';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = CREAM;
    fitText(ctx, 'REGULAR', x + w / 2, y + 36, w - 30, 30, 'bold', 3);
    fitText(ctx, '59.9', x + w / 2, y + 92, w - 30, 64, '900');
    fitText(ctx, 'SUPER', x + w / 2, y + 150, w - 30, 30, 'bold', 3);
    fitText(ctx, '63.9', x + w / 2, y + 206, w - 30, 64, '900');
  }
  // ── Ice-cream truck livery ──
  {
    const [x, y, w, h] = REGION.truck;
    ctx.fillStyle = ENV.pastelPink;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = CREAM;
    ctx.fillRect(x, y + h * 0.62, w, h * 0.12);
    ctx.fillStyle = TERRA;
    ctx.fillRect(x, y + h * 0.74, w, h * 0.06);
    ctx.fillStyle = INK;
    ctx.save();
    ctx.translate(x + w * 0.56, y + 48);
    ctx.transform(1, 0, -0.15, 1, 0, 0);
    fitText(ctx, 'Mister Cosmo', 0, 0, w * 0.72, 62, 'bold italic');
    ctx.restore();
    fitText(ctx, 'SOFT SERVE · SPACE POPS', x + w * 0.56, y + h * 0.9 - 4, w * 0.7, 20, 'bold', 3);
    // Little cone.
    ctx.fillStyle = MUSTARD;
    ctx.beginPath();
    ctx.moveTo(x + 40, y + 60);
    ctx.lineTo(x + 80, y + 60);
    ctx.lineTo(x + 60, y + 130);
    ctx.fill();
    ctx.fillStyle = CREAM;
    ctx.beginPath();
    ctx.arc(x + 60, y + 52, 24, 0, Math.PI * 2);
    ctx.fill();
    weather(ctx, x, y, w, h, 29, 0.2);
  }
  // ── TV test card (warm, no saturated bars) ──
  {
    const [x, y, w, h] = REGION.tv;
    ctx.fillStyle = '#d8cbb4';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#5b5048';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(x + (i * w) / 8, y);
      ctx.lineTo(x + (i * w) / 8, y + h);
      ctx.stroke();
    }
    for (let i = 0; i <= 6; i++) {
      ctx.beginPath();
      ctx.moveTo(x, y + (i * h) / 6);
      ctx.lineTo(x + w, y + (i * h) / 6);
      ctx.stroke();
    }
    ctx.fillStyle = '#efe6d6';
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, h * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3e3530';
    ctx.lineWidth = 4;
    ctx.stroke();
    const tones = ['#f4ecdc', '#e3cfa8', '#c9a27c', '#a77d62', '#7a5d4c', '#4a3d36'];
    tones.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(x + w / 2 - 66 + i * 22, y + h / 2 - 16, 22, 32);
    });
    ctx.fillStyle = '#3e3530';
    fitText(ctx, 'PLEASE STAND BY', x + w / 2, y + h - 22, w - 40, 18, 'bold', 2);
  }
  // ── Storefront signs (3 × 4 grid) ──
  {
    const [x0, y0] = REGION.shops;
    const bgs = [CREAM, '#2f2b28', TERRA_F, ENV.pastelMint, ENV.pastelBlue, ENV.pastelYellow];
    SHOP_NAMES.forEach((name, i) => {
      const x = x0 + (i % 3) * 512;
      const y = y0 + Math.floor(i / 3) * 96;
      const bg = bgs[i % bgs.length];
      ctx.fillStyle = bg;
      ctx.fillRect(x + 2, y + 2, 508, 92);
      ctx.fillStyle = bg === '#2f2b28' ? CREAM : INK;
      fitText(ctx, name, x + 256, y + 50, 440, 52, '900', 5);
      ctx.fillStyle = bg === TERRA_F ? CREAM : TERRA;
      star(ctx, x + 24, y + 48, 12, 4, 0.3);
      ctx.fill();
      weather(ctx, x, y, 512, 96, 40 + i, 0.18);
    });
  }
  // ── Street name signs ──
  const streetSign = (region: readonly [number, number, number, number], text: string): void => {
    const [x, y, w, h] = region;
    ctx.fillStyle = '#5d6b58';
    rr(ctx, x + 2, y + 2, w - 4, h - 4, 8);
    ctx.fill();
    ctx.fillStyle = CREAM;
    fitText(ctx, text, x + w / 2, y + h / 2 + 2, w - 24, 40, 'bold', 3);
  };
  streetSign(REGION.street1, 'ORBIT LANE');
  streetSign(REGION.street2, 'STARLIGHT BLVD');
  // ── Garage-row shop signs ──
  const band = (region: readonly [number, number, number, number], text: string, bg: string, fg: string): void => {
    const [x, y, w, h] = region;
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = fg;
    fitText(ctx, text, x + w / 2, y + h / 2 + 2, w - 40, 58, '900', 6);
    weather(ctx, x, y, w, h, text.length * 7, 0.2);
  };
  band(REGION.laundro, 'SUDS-O-MATIC', ENV.pastelBlue, INK);
  band(REGION.repair, 'TV & RADIO REPAIR', CREAM, TERRA);
  // ── Yard signs ──
  {
    const [x, y, w, h] = REGION.forSale;
    ctx.fillStyle = CREAM;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = TERRA;
    ctx.fillRect(x, y, w, 50);
    ctx.fillStyle = CREAM;
    fitText(ctx, 'FOR SALE', x + w / 2, y + 27, w - 20, 36, '900', 3);
    ctx.fillStyle = INK;
    fitText(ctx, 'ORBITAL REALTY', x + w / 2, y + 90, w - 30, 24, 'bold', 1);
    fitText(ctx, 'CALL KL5-1976', x + w / 2, y + 140, w - 30, 26, 'bold', 1);
    weather(ctx, x, y, w, h, 51, 0.24);
  }
  {
    const [x, y, w, h] = REGION.watch;
    ctx.fillStyle = MUSTARD;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = INK;
    fitText(ctx, 'NEIGHBORHOOD', x + w / 2, y + 44, w - 30, 30, '900', 2);
    fitText(ctx, 'WATCH', x + w / 2, y + 90, w - 30, 44, '900', 6);
    ctx.beginPath();
    ctx.arc(x + w / 2, y + 150, 22, 0, Math.PI * 2);
    ctx.lineWidth = 6;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + w / 2, y + 150, 8, 0, Math.PI * 2);
    ctx.fill();
    weather(ctx, x, y, w, h, 57, 0.24);
  }
  // ── Letters spilling out of a mailbox ──
  {
    const [x, y, w, h] = REGION.mailLetters;
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 3 === 0 ? '#e9dcc4' : i % 3 === 1 ? '#f3ecdf' : '#dcc9a6';
      ctx.fillRect(x + i * 32 + 2, y + 2, 28, h - 4);
      ctx.fillStyle = TERRA_F;
      ctx.fillRect(x + i * 32 + 20, y + 5, 6, 7);
    }
  }
  // ── Giant ice-cream cone (roof prop) ──
  {
    const [x, y, w, h] = REGION.cone;
    ctx.fillStyle = MUSTARD;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.2, y + h * 0.45);
    ctx.lineTo(x + w * 0.8, y + h * 0.45);
    ctx.lineTo(x + w * 0.5, y + h - 6);
    ctx.fill();
    ctx.strokeStyle = '#b08a48';
    ctx.lineWidth = 4;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(x + w * 0.2 + i * 26, y + h * 0.45);
      ctx.lineTo(x + w * 0.5 + i * 6, y + h - 10);
      ctx.stroke();
    }
    ctx.fillStyle = ENV.pastelPink;
    ctx.beginPath();
    ctx.arc(x + w * 0.5, y + h * 0.36, w * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = CREAM;
    ctx.beginPath();
    ctx.arc(x + w * 0.5, y + h * 0.2, w * 0.24, 0, Math.PI * 2);
    ctx.fill();
  }
  // ── Neon: OPEN + STARLIGHT script ──
  {
    const [x, y, w, h] = REGION.openNeon;
    ctx.strokeStyle = '#ffb3c7';
    ctx.lineWidth = 8;
    rr(ctx, x + 12, y + 12, w - 24, h - 24, 30);
    ctx.stroke();
    ctx.fillStyle = '#ffe3a1';
    fitText(ctx, 'OPEN', x + w / 2, y + h / 2 + 4, w - 60, 60, '900', 6);
  }
  {
    const [x, y, w, h] = REGION.starlightNeon;
    ctx.fillStyle = '#ffe3a1';
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.transform(1, 0, -0.2, 1, 0, 0);
    fitText(ctx, 'Starlight', 0, 0, w - 160, 150, 'bold italic');
    ctx.restore();
    ctx.fillStyle = '#fff4d8';
    star(ctx, x + w - 70, y + 50, 40, 4, 0.2);
    ctx.fill();
  }
}

/** The toppled 'Mister Cosmo' roadside sign (now standing on its edge in the wreck). */
function cosmoRoadSign(ctx: Ctx): void {
  const [x, y, w, h] = REGION.cosmoSign;
  ctx.save();
  ctx.fillStyle = ENV.pastelPink;
  rr(ctx, x + 6, y + 6, w - 12, h - 12, 34);
  ctx.fill();
  ctx.strokeStyle = CREAM;
  ctx.lineWidth = 8;
  rr(ctx, x + 16, y + 16, w - 32, h - 32, 26);
  ctx.stroke();
  // Cone with a ringed planet scoop.
  const cx = x + w / 2;
  ctx.fillStyle = MUSTARD;
  ctx.beginPath();
  ctx.moveTo(cx - 38, y + h * 0.42);
  ctx.lineTo(cx, y + h * 0.78);
  ctx.lineTo(cx + 38, y + h * 0.42);
  ctx.fill();
  ctx.strokeStyle = 'rgba(154,106,79,0.6)';
  ctx.lineWidth = 3;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + i * 15 - 10, y + h * 0.43);
    ctx.lineTo(cx + i * 6, y + h * 0.7);
    ctx.stroke();
  }
  ctx.fillStyle = CREAM;
  ctx.beginPath();
  ctx.arc(cx, y + h * 0.36, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = TERRA;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.ellipse(cx, y + h * 0.36, 70, 16, -0.3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.save();
  ctx.translate(cx, y + h * 0.12);
  ctx.transform(1, 0, -0.16, 1, 0, 0);
  fitText(ctx, 'Mister Cosmo', 0, 0, w - 50, 40, 'bold italic');
  ctx.restore();
  ctx.fillStyle = TERRA;
  fitText(ctx, 'SOFT SERVE', cx, y + h * 0.85, w - 60, 28, '900', 4);
  ctx.fillStyle = INK;
  fitText(ctx, 'OUT OF THIS WORLD · 15¢', cx, y + h * 0.92, w - 60, 15, 'bold', 1);
  weather(ctx, x, y, w, h, 29, 0.2);
  ctx.restore();
}

/** Rolling hill band across a region (painted mural helper). */
function hills(ctx: Ctx, x: number, y: number, w: number, h: number, base: number, amp: number, freq: number, phase: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    ctx.lineTo(x + w * t, y + h * base - Math.sin(t * Math.PI * freq + phase) * h * amp - Math.sin(t * Math.PI * freq * 2.3 + phase * 1.7) * h * amp * 0.35);
  }
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
}

/** Little modernist house silhouettes on a ridge (flat / butterfly roofs). */
function roofline(ctx: Ctx, x: number, y: number, w: number, h: number, n: number, seed: number): void {
  const cols = [ENV.pastelPink, ENV.pastelMint, ENV.pastelYellow, ENV.pastelBlue, CREAM];
  for (let i = 0; i < n; i++) {
    const cx = x + (w * (i + 0.5)) / n + Math.sin(i * 7.1 + seed) * w * 0.012;
    const hw = w * (0.018 + ((i * 31 + seed) % 7) * 0.002);
    const hh = h * (0.12 + ((i * 17 + seed) % 5) * 0.012);
    const gy = y + h * 0.66 - Math.sin((i / n) * Math.PI * 2 + seed) * h * 0.03;
    ctx.fillStyle = cols[(i + seed) % cols.length];
    ctx.fillRect(cx - hw, gy - hh, hw * 2, hh);
    ctx.fillStyle = (i + seed) % 2 ? TERRA_F : CREAM;
    ctx.beginPath();
    if ((i + seed) % 3 === 0) {
      ctx.moveTo(cx - hw * 1.2, gy - hh - h * 0.035);
      ctx.lineTo(cx, gy - hh);
      ctx.lineTo(cx + hw * 1.2, gy - hh - h * 0.035);
      ctx.lineTo(cx + hw * 1.2, gy - hh + 3);
      ctx.lineTo(cx - hw * 1.2, gy - hh + 3);
    } else ctx.rect(cx - hw * 1.15, gy - hh - 5, hw * 2.3, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(62,53,48,0.55)';
    ctx.fillRect(cx - hw * 0.5, gy - hh * 0.62, hw * 0.4, hh * 0.3);
    ctx.beginPath();
    ctx.arc(cx + hw * 0.45, gy - hh * 0.5, hh * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Halcyon spawn wall: 'HALCYON HEIGHTS — A BRIGHTER TOMORROW' community mural. */
function muralHalcyon(ctx: Ctx): void {
  const [x, y, w, h] = REGION.muralH;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const sky = ctx.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0, '#a9c9da');
  sky.addColorStop(0.55, '#f1d3bd');
  sky.addColorStop(1, '#f4dcae');
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);
  // Rising sun with rings + rays (left third).
  const sx = x + w * 0.16;
  const sy = y + h * 0.78;
  ctx.save();
  ctx.translate(sx, sy);
  for (let i = 0; i < 18; i++) {
    const a = Math.PI + (i / 17) * Math.PI;
    ctx.fillStyle = i % 2 ? 'rgba(239,220,166,0.75)' : 'rgba(233,195,181,0.7)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, h * 1.1, a - 0.045, a + 0.045);
    ctx.closePath();
    ctx.fill();
  }
  for (const [r, c] of [
    [0.62, TERRA_F],
    [0.5, MUSTARD],
    [0.38, ENV.pastelPink],
    [0.26, CREAM],
  ] as const) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(0, 0, h * r, Math.PI, 0);
    ctx.fill();
  }
  ctx.restore();
  // Rocket arcing up on the right with a dotted trail.
  ctx.save();
  ctx.strokeStyle = 'rgba(255,248,235,0.9)';
  ctx.setLineDash([8, 10]);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.74, y + h * 0.7);
  ctx.quadraticCurveTo(x + w * 0.8, y + h * 0.5, x + w * 0.9, y + h * 0.16);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.translate(x + w * 0.9, y + h * 0.16);
  ctx.rotate(0.55);
  ctx.fillStyle = CREAM;
  rr(ctx, -9, -30, 18, 50, 9);
  ctx.fill();
  ctx.fillStyle = TERRA;
  ctx.beginPath();
  ctx.moveTo(-9, 12);
  ctx.lineTo(-19, 26);
  ctx.lineTo(-9, 20);
  ctx.moveTo(9, 12);
  ctx.lineTo(19, 26);
  ctx.lineTo(9, 20);
  ctx.fill();
  ctx.fillStyle = MUSTARD;
  ctx.beginPath();
  ctx.moveTo(-6, 22);
  ctx.lineTo(0, 40);
  ctx.lineTo(6, 22);
  ctx.fill();
  ctx.restore();
  // Hills + a row of little modernist houses.
  hills(ctx, x, y, w, h, 0.72, 0.06, 3, 0.4, '#c9dcc1');
  roofline(ctx, x + w * 0.3, y, w * 0.42, h, 9, 2);
  hills(ctx, x, y, w, h, 0.8, 0.05, 4.5, 1.9, '#a3ad8f');
  hills(ctx, x, y, w, h, 0.9, 0.03, 6, 0.7, '#d9c7a7');
  // Title.
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(62,53,48,0.18)';
  fitText(ctx, 'HALCYON HEIGHTS', x + w * 0.515 + 4, y + h * 0.3 + 4, w * 0.42, 76, '900', 10);
  ctx.fillStyle = TERRA;
  fitText(ctx, 'HALCYON HEIGHTS', x + w * 0.515, y + h * 0.3, w * 0.42, 76, '900', 10);
  ctx.fillStyle = INK;
  fitText(ctx, 'A BRIGHTER TOMORROW  ·  EST. 1972', x + w * 0.515, y + h * 0.56, w * 0.36, 26, 'bold', 6);
  // Racing stripes top + bottom.
  for (const [yy, c] of [
    [0, TERRA_F],
    [8, MUSTARD],
    [h - 14, MUSTARD],
    [h - 6, TERRA_F],
  ] as const) {
    ctx.fillStyle = c;
    ctx.fillRect(x, y + yy, w, 6);
  }
  weather(ctx, x, y, w, h, 41, 0.2);
  // Flaked paint where the render has let go.
  for (let i = 0; i < 40; i++) {
    const fx = x + ((i * 389) % w);
    const fy = y + ((i * 131) % h);
    ctx.fillStyle = 'rgba(214,202,180,0.85)';
    ctx.beginPath();
    ctx.ellipse(fx, fy, 3 + (i % 5) * 2, 2 + (i % 3), (i % 7) * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Bloom spawn wall (diner lot): a faded 'MOONBEAM DINER · EAT UNDER THE STARS'
 *  dusk mural (light enough to read in the wall's permanent shade), half
 *  reclaimed by painted-over glowing vines. */
function muralMoonbeam(ctx: Ctx): void {
  const [x, y, w, h] = REGION.muralB;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const sky = ctx.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0, '#7f9cb4');
  sky.addColorStop(0.55, '#e3b8ab');
  sky.addColorStop(1, '#f1d4a6');
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);
  // Stars + crescent moon.
  for (let i = 0; i < 90; i++) {
    const px = x + ((i * 457) % w);
    const py = y + ((i * 97) % Math.floor(h * 0.6));
    ctx.fillStyle = `rgba(255,243,214,${0.35 + (i % 4) * 0.15})`;
    if (i % 9 === 0) {
      star(ctx, px, py, 7, 4, 0.3);
      ctx.fill();
    } else ctx.fillRect(px, py, 2.5, 2.5);
  }
  ctx.fillStyle = '#f3ecdf';
  ctx.beginPath();
  ctx.arc(x + w * 0.2, y + h * 0.38, h * 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8aa3b8';
  ctx.beginPath();
  ctx.arc(x + w * 0.2 + h * 0.1, y + h * 0.33, h * 0.23, 0, Math.PI * 2);
  ctx.fill();
  // Horizon: desert mesas + the streamline diner with a saucer roof.
  hills(ctx, x, y, w, h, 0.78, 0.05, 2.5, 2.2, '#b58f7f');
  const dx = x + w * 0.52;
  const dy = y + h * 0.78;
  ctx.fillStyle = ENV.pastelMint;
  rr(ctx, dx - w * 0.09, dy - h * 0.2, w * 0.18, h * 0.2, 18);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,227,161,0.95)';
  for (let i = 0; i < 6; i++) ctx.fillRect(dx - w * 0.08 + i * w * 0.027, dy - h * 0.15, w * 0.02, h * 0.08);
  ctx.fillStyle = CREAM;
  ctx.beginPath();
  ctx.ellipse(dx, dy - h * 0.22, w * 0.12, h * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffe3a1';
  ctx.beginPath();
  ctx.ellipse(dx, dy - h * 0.27, w * 0.035, h * 0.05, 0, Math.PI, 0);
  ctx.fill();
  // Finned car parked out front.
  ctx.fillStyle = ENV.pastelPink;
  ctx.beginPath();
  ctx.moveTo(dx + w * 0.11, dy);
  ctx.lineTo(dx + w * 0.11, dy - h * 0.07);
  ctx.lineTo(dx + w * 0.14, dy - h * 0.13);
  ctx.lineTo(dx + w * 0.18, dy - h * 0.13);
  ctx.lineTo(dx + w * 0.21, dy - h * 0.07);
  ctx.lineTo(dx + w * 0.23, dy - h * 0.11);
  ctx.lineTo(dx + w * 0.23, dy);
  ctx.fill();
  ctx.fillStyle = '#2d2724';
  for (const wx of [0.135, 0.205]) {
    ctx.beginPath();
    ctx.arc(dx + w * wx, dy, h * 0.035, 0, Math.PI * 2);
    ctx.fill();
  }
  hills(ctx, x, y, w, h, 0.86, 0.02, 5, 0.3, '#c99a82');
  // Title in neon-script style.
  ctx.save();
  ctx.translate(x + w * 0.8, y + h * 0.36);
  ctx.transform(1, 0, -0.18, 1, 0, 0);
  ctx.fillStyle = 'rgba(62,53,48,0.25)';
  fitText(ctx, 'Moonbeam', 4, 4, w * 0.26, 84, 'bold italic');
  ctx.fillStyle = '#fff1cf';
  fitText(ctx, 'Moonbeam', 0, 0, w * 0.26, 84, 'bold italic');
  ctx.restore();
  ctx.fillStyle = TERRA;
  fitText(ctx, 'EAT UNDER THE STARS', x + w * 0.8, y + h * 0.66, w * 0.25, 24, 'bold', 6);
  weather(ctx, x, y, w, h, 53, 0.24);
  // The Bloom have let the vines finish the painting: tendrils + glowing buds.
  let sd = 7;
  const rnd = (): number => {
    sd = (sd * 16807) % 2147483647;
    return sd / 2147483647;
  };
  for (let v = 0; v < 26; v++) {
    const left = v % 2 === 0;
    const vx = left ? x + rnd() * w * 0.35 : x + w * 0.62 + rnd() * w * 0.38;
    ctx.strokeStyle = 'rgba(111,122,85,0.95)';
    ctx.lineWidth = 3 + rnd() * 3;
    ctx.beginPath();
    ctx.moveTo(vx, y);
    const len = h * (0.35 + rnd() * 0.65);
    ctx.bezierCurveTo(vx + (rnd() - 0.5) * 60, y + len * 0.3, vx + (rnd() - 0.5) * 60, y + len * 0.7, vx + (rnd() - 0.5) * 40, y + len);
    ctx.stroke();
    for (let l = 0; l < 7; l++) {
      const t = rnd();
      ctx.fillStyle = rnd() < 0.7 ? 'rgba(163,173,143,0.95)' : 'rgba(125,133,102,0.95)';
      ctx.beginPath();
      ctx.ellipse(vx + (rnd() - 0.5) * 30, y + len * t, 6 + rnd() * 5, 3 + rnd() * 3, rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = rnd() < 0.65 ? '#c6f06b' : '#ffe3a1';
    ctx.beginPath();
    ctx.arc(vx + (rnd() - 0.5) * 20, y + len * (0.5 + rnd() * 0.5), 3 + rnd() * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export interface SignSet {
  board: THREE.Material;
  lit: THREE.Material;
  texture: THREE.Texture;
}

export function signMaterials(lib: MaterialLibrary, low: boolean): SignSet {
  // Same UV layout at half resolution on Low (phones): draw scaled.
  const size = low ? W / 2 : W;
  const texture = lib.canvasTexture(low ? 'pastel.atlas.lo' : 'pastel.atlas', size, size, (ctx) => {
    ctx.save();
    ctx.scale(size / W, size / H);
    drawAtlas(ctx);
    ctx.restore();
  });
  texture.colorSpace = THREE.SRGBColorSpace;
  const board = low
    ? new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.35 })
    : new THREE.MeshStandardMaterial({ map: texture, alphaTest: 0.35, roughness: 0.8 });
  const lit = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.2, color: new THREE.Color(1.6, 1.5, 1.35) });
  board.name = 'pastel.signs';
  lit.name = 'pastel.neon';
  return { board, lit, texture };
}

/** Accumulates atlas-mapped quads for one sign material. */
export class SignBatch {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uv: number[] = [];

  /**
   * A quad of size w × h centered at `c`, facing `normal` (horizontal or any),
   * mapped to `region` (optionally a sub-rectangle u0..u1 / v0..v1 in 0..1).
   */
  quad(region: readonly [number, number, number, number], c: THREE.Vector3, w: number, h: number, normal: THREE.Vector3, sub?: [number, number, number, number], tilt = 0): void {
    const n = normal.clone().normalize();
    const up0 = Math.abs(n.y) > 0.95 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up0, n).normalize();
    const up = new THREE.Vector3().crossVectors(n, right).normalize();
    if (tilt) {
      right.applyAxisAngle(n, tilt);
      up.applyAxisAngle(n, tilt);
    }
    const [rx, ry, rw, rh] = region;
    const s = sub ?? [0, 1, 0, 1];
    const u0 = (rx + rw * s[0]) / W;
    const u1 = (rx + rw * s[1]) / W;
    // Canvas y grows down; texture v grows up (flipY).
    const v1 = 1 - (ry + rh * s[2]) / H;
    const v0 = 1 - (ry + rh * s[3]) / H;
    const hw = w / 2;
    const hh = h / 2;
    const p = (a: number, b: number): THREE.Vector3 => c.clone().addScaledVector(right, a).addScaledVector(up, b);
    const A = p(-hw, -hh);
    const B = p(hw, -hh);
    const C = p(hw, hh);
    const D = p(-hw, hh);
    const verts = [A, B, C, A, C, D];
    const uvs = [u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1];
    for (let i = 0; i < 6; i++) {
      this.pos.push(verts[i].x, verts[i].y, verts[i].z);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(uvs[i * 2], uvs[i * 2 + 1]);
    }
  }

  /** Same sign on both faces of a free-standing panel (front + mirrored back). */
  quad2(region: readonly [number, number, number, number], c: THREE.Vector3, w: number, h: number, normal: THREE.Vector3, gap = 0.01): void {
    const n = normal.clone().normalize();
    this.quad(region, c.clone().addScaledVector(n, gap), w, h, n);
    this.quad(region, c.clone().addScaledVector(n, -gap), w, h, n.clone().negate());
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  build(mat: THREE.Material, name: string): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }
}

/** Shop-sign sub-rectangle inside REGION.shops for shop index i. */
export function shopSub(i: number): [number, number, number, number] {
  const col = i % 3;
  const row = Math.floor(i / 3) % 4;
  return [col / 3, (col + 1) / 3, row / 4, (row + 1) / 4];
}

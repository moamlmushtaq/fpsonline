// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — generated impulse responses (per-map acoustic character).
//
// Each IR = pre-delay + discrete early reflections (the geometry you can
// "hear": container walls, house facades, tunnel flutter, far ridges) + a
// two-band diffuse tail whose highs die faster than its lows (air/surface
// damping). Channels are decorrelated and reflections alternate sides, so the
// space feels wide. Buffers are cached per context.
//
//   open     — Training Range: modest yard, a few ground/wall reflections.
//   coastal  — Gantry: container slap-backs over a bright-ish harbour tail.
//   suburb   — Pastel: dense short facade reflections, short tail.
//   mountain — Observatory: sparse early, long dark tail, distant ridge echoes.
//   indoor   — tunnels / interiors: dense early field + metallic flutter.
//   hall     — music only: lush, dark, 2.7 s.
// ─────────────────────────────────────────────────────────────────────────────

import type { MapAudioDef } from '../../shared/maps/types';

export type IrKind = MapAudioDef['reverb'] | 'hall';

interface IrSpec {
  dur: number;
  rt60: number;
  pre: number;
  /** How much faster the highs decay (0 = same, 0.8 = much faster). */
  damp: number;
  /** High-band level (0..1). */
  bright: number;
  early: [number, number][];
  late?: [number, number][];
  /** Flutter echo spacing (s) for parallel-wall tunnels. */
  flutter?: number;
}

const SPECS: Record<IrKind, IrSpec> = {
  // Music: a lush, dark hall (never the map's acoustics).
  hall: {
    dur: 3.2,
    rt60: 2.7,
    pre: 0.022,
    damp: 0.55,
    bright: 0.45,
    early: [
      [0.021, 0.3],
      [0.037, 0.25],
      [0.058, 0.2],
    ],
  },
  open: {
    dur: 1.8,
    rt60: 1.5,
    pre: 0.012,
    damp: 0.5,
    bright: 0.6,
    early: [
      [0.019, 0.5],
      [0.043, 0.35],
      [0.087, 0.3],
      [0.13, 0.18],
    ],
  },
  coastal: {
    dur: 2.6,
    rt60: 2.1,
    pre: 0.02,
    damp: 0.6,
    bright: 0.45,
    early: [
      [0.034, 0.45],
      [0.071, 0.55],
      [0.118, 0.5],
      [0.183, 0.42],
      [0.246, 0.3],
      [0.31, 0.2],
    ],
  },
  suburb: {
    dur: 1.4,
    rt60: 1.05,
    pre: 0.006,
    damp: 0.45,
    bright: 0.65,
    early: [
      [0.009, 0.55],
      [0.017, 0.45],
      [0.026, 0.5],
      [0.038, 0.4],
      [0.052, 0.35],
      [0.069, 0.3],
      [0.091, 0.22],
    ],
  },
  mountain: {
    dur: 3.4,
    rt60: 3.0,
    pre: 0.035,
    damp: 0.7,
    bright: 0.35,
    early: [
      [0.06, 0.25],
      [0.14, 0.2],
    ],
    late: [
      [0.72, 0.45],
      [1.31, 0.3],
      [1.95, 0.18],
    ],
  },
  indoor: {
    dur: 1.1,
    rt60: 0.85,
    pre: 0.003,
    damp: 0.35,
    bright: 0.8,
    early: [
      [0.004, 0.6],
      [0.007, 0.55],
      [0.011, 0.5],
      [0.016, 0.45],
      [0.022, 0.4],
      [0.029, 0.35],
    ],
    flutter: 0.0115,
  },
};

const cache = new WeakMap<BaseAudioContext, Map<IrKind, AudioBuffer>>();

/** Generated stereo impulse response for a reverb character (cached). */
export function makeImpulse(ctx: BaseAudioContext, kind: IrKind): AudioBuffer {
  let m = cache.get(ctx);
  if (!m) {
    m = new Map();
    cache.set(ctx, m);
  }
  const hit = m.get(kind);
  if (hit) return hit;
  const buf = buildImpulse(ctx, SPECS[kind] ?? SPECS.open);
  m.set(kind, buf);
  return buf;
}

function buildImpulse(ctx: BaseAudioContext, s: IrSpec): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * s.dur);
  const buf = ctx.createBuffer(2, len, sr);
  // One-pole crossover ~1.4 kHz between the low and high bands.
  const aLp = 1 - Math.exp((-2 * Math.PI * 1400) / sr);
  const kLow = -6.91 / s.rt60;
  const kHigh = -6.91 / (s.rt60 * (1 - s.damp * 0.85));
  const build = 0.012;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    const pre = s.pre + ch * 0.0017;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      if (t < pre) {
        d[i] = 0;
        continue;
      }
      const w = Math.random() * 2 - 1;
      lp += (w - lp) * aLp;
      const hi = w - lp;
      const tt = t - pre;
      const onset = tt < build ? tt / build : 1;
      // Fade the last 5 % to zero so the buffer end never truncates audibly.
      const tailFade = i > len * 0.95 ? (len - i) / (len * 0.05) : 1;
      d[i] = (lp * 1.6 * Math.exp(kLow * tt) + hi * s.bright * Math.exp(kHigh * tt)) * onset * tailFade * 0.5;
    }
    // Early reflections: short bursts, alternating sides for width.
    const burst = (at: number, amp: number, width: number, dark: number) => {
      const i0 = Math.floor(at * sr);
      const n = Math.floor(width * sr);
      let b = 0;
      for (let k = 0; k < n && i0 + k < len; k++) {
        const w = Math.random() * 2 - 1;
        b += (w - b) * dark;
        d[i0 + k] += b * amp * Math.exp((-4 * k) / n);
      }
    };
    s.early.forEach(([at, amp], idx) => {
      const side = (idx + ch) % 2 === 0 ? 1 : 0.55;
      burst(at + ch * 0.0023 * (idx % 3), amp * side * 1.4, 0.004, 0.7);
    });
    if (s.late) {
      s.late.forEach(([at, amp], idx) => {
        const side = (idx + ch) % 2 === 0 ? 1 : 0.7;
        burst(at + ch * 0.011, amp * side, 0.035, 0.12);
      });
    }
    if (s.flutter) {
      for (let k = 1; k * s.flutter < 0.25; k++) {
        burst(0.03 + k * s.flutter + ch * 0.0009, 0.35 * Math.exp(-k / 7), 0.002, 0.8);
      }
    }
  }
  return buf;
}

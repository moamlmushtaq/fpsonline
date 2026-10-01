// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — graphics quality presets, device heuristics and the adaptive
// ("Auto") quality controller.
//
//  • resolveQuality(preset)   → concrete QualitySettings for low / medium / high.
//  • detectInitialPreset()    → best-guess starting preset from device signals
//                               (touch/mobile UA, cores, memory, GPU string).
//  • AdaptiveQuality          → pure frame-time state machine used by the
//                               Renderer when the player picks "Auto". It first
//                               trims the render scale in small steps, then
//                               switches presets; upgrades are slow & capped.
//
// Nothing here touches WebGL state except detectInitialPreset(), which may
// probe the GPU renderer string once with a throwaway context.
// ─────────────────────────────────────────────────────────────────────────────

import type { QualitySettings } from '../contracts';

export type ResolvedPreset = 'low' | 'medium' | 'high';

/** Device pixel ratio cap per preset (before the render-scale multiplier). */
export const DPR_CAP: Record<ResolvedPreset, number> = { low: 1, medium: 1.5, high: 2 };

function devicePixelRatio(): number {
  const d = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  return Number.isFinite(d) && d > 0 ? d : 1;
}

/**
 * Concrete settings for a preset. `renderScale` (0.5..1, from the Settings
 * screen) and `adaptiveScale` (Auto mode trims, 0.6..1) multiply the capped DPR.
 */
export function resolveQuality(preset: ResolvedPreset, renderScale = 1, adaptiveScale = 1): QualitySettings {
  const scale = clampNum(renderScale, 0.5, 1) * clampNum(adaptiveScale, 0.5, 1);
  const pixelRatio = Math.max(0.5, Math.min(devicePixelRatio(), DPR_CAP[preset]) * scale);
  switch (preset) {
    case 'low':
      return {
        preset,
        pixelRatio,
        shadows: 'off',
        shadowMapSize: 512,
        post: false,
        bloom: false,
        painterly: false,
        lightShafts: false,
        particles: 0.35,
        decor: 0.35,
        drawDistance: 260,
        antialias: false,
        hrtf: false,
      };
    case 'medium':
      return {
        preset,
        pixelRatio,
        shadows: 'low',
        shadowMapSize: 1024,
        post: true,
        bloom: true,
        painterly: false,
        lightShafts: false,
        particles: 0.7,
        decor: 0.7,
        drawDistance: 420,
        antialias: true,
        hrtf: false,
      };
    case 'high':
    default:
      return {
        preset: 'high',
        pixelRatio,
        shadows: 'high',
        shadowMapSize: 2048,
        post: true,
        bloom: true,
        painterly: true,
        lightShafts: true,
        particles: 1,
        decor: 1,
        drawDistance: 600,
        antialias: true,
        hrtf: true,
      };
  }
}

// ── Device heuristics ───────────────────────────────────────────────────────

let cachedGpu: string | null | undefined;

/** Unmasked GPU renderer string (lower-case) or null when unavailable. Probed once. */
export function gpuRendererString(): string | null {
  if (cachedGpu !== undefined) return cachedGpu;
  cachedGpu = null;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const s = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      cachedGpu = typeof s === 'string' ? s.toLowerCase() : null;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    cachedGpu = null;
  }
  return cachedGpu;
}

export interface DeviceProfile {
  mobile: boolean;
  cores: number;
  /** GB, or 0 when unknown (Safari/Firefox do not expose it). */
  memory: number;
  gpu: string | null;
  gpuTier: 'software' | 'weak' | 'mid' | 'strong' | 'unknown';
}

export function deviceProfile(): DeviceProfile {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const ua = nav?.userAgent ?? '';
  const touch = (nav?.maxTouchPoints ?? 0) > 0;
  // iPadOS reports a desktop Mac UA; a Mac with touch points is an iPad.
  const mobile = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua) || (touch && /Macintosh/.test(ua));
  const cores = nav?.hardwareConcurrency ?? 4;
  const memory = (nav as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory ?? 0;
  const gpu = gpuRendererString();
  return { mobile, cores, memory, gpu, gpuTier: classifyGpu(gpu) };
}

function classifyGpu(gpu: string | null): DeviceProfile['gpuTier'] {
  if (!gpu) return 'unknown';
  if (/swiftshader|llvmpipe|softpipe|software|microsoft basic/.test(gpu)) return 'software';
  // Old mobile GPUs and integrated Intel HD/UHD (desktop → medium, phone → low).
  if (/mali-(4|t\d)|adreno \(tm\) [2-5]\d\d|adreno [2-5]\d\d|powervr|sgx|videocore|intel.*\b(hd|uhd) graphics|gma/.test(gpu)) {
    return 'weak';
  }
  if (/nvidia|geforce|rtx|radeon (rx|pro)|radeon\(tm\) rx|apple m[1-9]|adreno \(tm\) [67]\d\d|adreno [67]\d\d|arc\(tm\)|iris xe/.test(gpu)) return 'strong';
  return 'mid';
}

/**
 * Starting preset for a fresh install / Auto mode. Deliberately conservative on
 * phones (smoothness beats detail); Auto then upgrades if frames are cheap.
 */
export function detectInitialPreset(): ResolvedPreset {
  const p = deviceProfile();
  if (p.gpuTier === 'software') return 'low';
  if (p.mobile) {
    if (p.gpuTier === 'weak') return 'low';
    if (p.memory > 0 && p.memory <= 3) return 'low';
    if (p.cores > 0 && p.cores <= 4) return 'low';
    return 'medium';
  }
  if (p.gpuTier === 'weak') return 'medium';
  if (p.gpuTier === 'strong') return 'high';
  if (p.cores >= 6 && (p.memory === 0 || p.memory >= 8)) return 'high';
  return 'medium';
}

// ── Adaptive quality ────────────────────────────────────────────────────────

export type AdaptiveAction =
  | { kind: 'none' }
  | { kind: 'scale'; scale: number }
  | { kind: 'preset'; preset: ResolvedPreset; scale: number };

const ORDER: ResolvedPreset[] = ['low', 'medium', 'high'];

/** Tunables (exported for tests / tuning). */
export const ADAPTIVE = {
  /** Frames at the start / after any change that are ignored (shader compiles, loading). */
  settleMs: 3000,
  /** p90 above this (ms) = struggling (≈ below 45 fps). */
  badMs: 22,
  /** Sustained struggle before stepping down. */
  badHoldMs: 4000,
  /** Clean vsync-locked frames needed before probing one step up. */
  goodHoldMs: 20000,
  /** After an upward step, a struggle within this window reverts it at once and
   *  blacklists that configuration for the session (no ping-pong). */
  probeWindowMs: 12000,
  /** Render-scale steps. */
  scaleStep: 0.1,
  minScale: 0.7,
} as const;

/**
 * Frame-time driven quality controller (pure logic; the Renderer applies the
 * returned actions). Robust by construction — it can never oscillate:
 *
 *  • Frames are ignored for `settleMs` after start / any change and while the
 *    tab is hidden or after long stalls.
 *  • DOWN: p90 > badMs sustained for badHoldMs → trim render scale in 0.1 steps
 *    (to 0.7), then drop a preset (scale back to 1 on the lower preset).
 *  • UP (probe): rAF intervals are vsync-locked when the budget is met, so a
 *    p90 below 11 ms never happens on a 60 Hz screen. Instead "good" means
 *    clean, vsync-locked frames (p90 ≤ 1.12 × the measured refresh interval, no
 *    long frames) for goodHoldMs → one step up (scale first, then preset).
 *  • Hysteresis: if the device struggles within probeWindowMs of a step up, it
 *    reverts immediately and that configuration is never probed again this
 *    session. A configuration abandoned for sustained struggle is also
 *    blacklisted, so Auto settles instead of ping-ponging between presets.
 */
export class AdaptiveQuality {
  preset: ResolvedPreset;
  scale = 1;
  private readonly samples = new Float32Array(120);
  private sampleCount = 0;
  private sampleIdx = 0;
  private settleUntil = 0;
  private badSince = -1;
  private goodSince = -1;
  private lastEval = 0;
  private readonly scratch = new Float32Array(120);
  /** Configurations ("preset@scale") proven too heavy on this device. */
  private readonly failed = new Set<string>();
  /** Configuration to return to if the current probe fails (null = not probing). */
  private probeFrom: { preset: ResolvedPreset; scale: number; until: number } | null = null;
  /** Smoothed refresh interval estimate (ms): low percentile of recent frames. */
  private vsyncMs = 16.7;

  constructor(start: ResolvedPreset, now: number) {
    this.preset = start;
    this.settleUntil = now + ADAPTIVE.settleMs;
  }

  /** Re-arm the settle window (e.g. after a resize or map load). */
  settle(now: number, ms: number = ADAPTIVE.settleMs): void {
    this.settleUntil = Math.max(this.settleUntil, now + ms);
    this.sampleCount = 0;
    this.badSince = -1;
    this.goodSince = -1;
    if (this.probeFrom) this.probeFrom.until = Math.max(this.probeFrom.until, now + ms + ADAPTIVE.probeWindowMs);
  }

  /** True once `preset@scale` failed on this device (diagnostics / tests). */
  hasFailed(preset: ResolvedPreset, scale: number): boolean {
    return this.failed.has(key(preset, scale));
  }

  /** Feed one frame. `frameMs` is the wall-clock interval between frames. */
  feed(frameMs: number, now: number, hidden: boolean): AdaptiveAction {
    if (hidden || !(frameMs > 0) || frameMs > 250) {
      // Tab switches / stalls are not representative of steady-state cost.
      this.badSince = -1;
      this.goodSince = -1;
      if (hidden || frameMs > 250) this.settleUntil = Math.max(this.settleUntil, now + 1000);
      return NONE;
    }
    if (now < this.settleUntil) return NONE;
    this.samples[this.sampleIdx] = frameMs;
    this.sampleIdx = (this.sampleIdx + 1) % this.samples.length;
    this.sampleCount = Math.min(this.sampleCount + 1, this.samples.length);
    if (this.sampleCount < 30 || now - this.lastEval < 250) return NONE;
    this.lastEval = now;

    this.sortSamples();
    const p10 = this.pct(0.1);
    const p90 = this.pct(0.9);
    const p98 = this.pct(0.98);
    // Refresh interval: ~the fastest frames we see (clamped to 30..240 Hz).
    const vs = Math.min(34, Math.max(4, p10));
    this.vsyncMs += (vs - this.vsyncMs) * 0.25;

    if (this.probeFrom && now > this.probeFrom.until) this.probeFrom = null; // probe survived

    if (p90 > ADAPTIVE.badMs) {
      this.goodSince = -1;
      // A fresh probe that struggles: revert immediately, remember the failure.
      if (this.probeFrom) return this.revertProbe(now);
      if (this.badSince < 0) this.badSince = now;
      if (now - this.badSince >= ADAPTIVE.badHoldMs) return this.stepDown(now);
      return NONE;
    }
    this.badSince = -1;
    const clean = p90 <= this.vsyncMs * 1.12 + 0.5 && p98 <= Math.max(this.vsyncMs * 1.6, this.vsyncMs + 6);
    if (clean) {
      if (this.goodSince < 0) this.goodSince = now;
      if (now - this.goodSince >= ADAPTIVE.goodHoldMs) return this.stepUp(now);
    } else this.goodSince = -1;
    return NONE;
  }

  private revertProbe(now: number): AdaptiveAction {
    const from = this.probeFrom!;
    this.failed.add(key(this.preset, this.scale));
    this.probeFrom = null;
    const presetChanged = from.preset !== this.preset;
    this.preset = from.preset;
    this.scale = from.scale;
    this.settle(now, 2500);
    return presetChanged ? { kind: 'preset', preset: this.preset, scale: this.scale } : { kind: 'scale', scale: this.scale };
  }

  private stepDown(now: number): AdaptiveAction {
    this.settle(now, 2500);
    // Sustained struggle here: never come back to this configuration.
    this.failed.add(key(this.preset, this.scale));
    if (this.scale > ADAPTIVE.minScale + 0.05) {
      this.scale = round2(this.scale - ADAPTIVE.scaleStep);
      return { kind: 'scale', scale: this.scale };
    }
    const i = ORDER.indexOf(this.preset);
    if (i > 0) {
      this.preset = ORDER[i - 1];
      // The lower preset also has a lower DPR cap; start it at full scale.
      this.scale = 1;
      return { kind: 'preset', preset: this.preset, scale: this.scale };
    }
    return NONE;
  }

  private stepUp(now: number): AdaptiveAction {
    this.goodSince = -1;
    // Candidate: restore scale first, then the next preset (at full scale).
    let preset = this.preset;
    let scale = this.scale;
    if (scale < 1) scale = Math.min(1, round2(scale + ADAPTIVE.scaleStep));
    else {
      const i = ORDER.indexOf(preset);
      if (i >= ORDER.length - 1) return NONE;
      preset = ORDER[i + 1];
      scale = 1;
    }
    if (this.failed.has(key(preset, scale))) return NONE;
    this.probeFrom = { preset: this.preset, scale: this.scale, until: 0 };
    const presetChanged = preset !== this.preset;
    this.preset = preset;
    this.scale = scale;
    this.settle(now, ADAPTIVE.settleMs);
    this.probeFrom.until = now + ADAPTIVE.settleMs + ADAPTIVE.probeWindowMs;
    return presetChanged ? { kind: 'preset', preset, scale } : { kind: 'scale', scale };
  }

  private sortSamples(): void {
    const n = this.sampleCount;
    const s = this.scratch;
    for (let i = 0; i < n; i++) s[i] = this.samples[i];
    s.subarray(0, n).sort();
  }

  private pct(p: number): number {
    const n = this.sampleCount;
    return this.scratch[Math.min(n - 1, Math.floor(p * n))];
  }
}

function key(p: ResolvedPreset, s: number): string {
  return `${p}@${s.toFixed(2)}`;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

const NONE: AdaptiveAction = { kind: 'none' };

function clampNum(x: number, lo: number, hi: number): number {
  return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : hi;
}

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

/**
 * Frame-time driven quality controller (pure logic; the Renderer applies the
 * returned actions). Rules:
 *  • ignore the first 3 s after start / any change (shader compiles, loading)
 *    and frames while the tab is hidden or after long stalls;
 *  • p90 frame time > 22 ms sustained for 4 s → step down: first reduce the
 *    render scale in 0.1 steps (down to 0.7), then drop a preset;
 *  • p90 < 11 ms sustained for 12 s → step up cautiously: restore scale first,
 *    then raise the preset (max 2 preset upgrades per session).
 */
export class AdaptiveQuality {
  preset: ResolvedPreset;
  scale = 1;
  private upgrades = 0;
  private readonly samples = new Float32Array(120);
  private sampleCount = 0;
  private sampleIdx = 0;
  private settleUntil = 0;
  private badSince = -1;
  private goodSince = -1;
  private lastEval = 0;
  private scratch = new Float32Array(120);

  constructor(start: ResolvedPreset, now: number) {
    this.preset = start;
    this.settleUntil = now + 3000;
  }

  /** Re-arm the settle window (e.g. after a resize or map load). */
  settle(now: number, ms = 3000): void {
    this.settleUntil = Math.max(this.settleUntil, now + ms);
    this.sampleCount = 0;
    this.badSince = -1;
    this.goodSince = -1;
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

    const p90 = this.percentile(0.9);
    if (p90 > 22) {
      this.goodSince = -1;
      if (this.badSince < 0) this.badSince = now;
      if (now - this.badSince >= 4000) return this.stepDown(now);
    } else if (p90 < 11) {
      this.badSince = -1;
      if (this.goodSince < 0) this.goodSince = now;
      if (now - this.goodSince >= 12000) return this.stepUp(now);
    } else {
      this.badSince = -1;
      this.goodSince = -1;
    }
    return NONE;
  }

  private stepDown(now: number): AdaptiveAction {
    this.settle(now, 2500);
    if (this.scale > 0.75) {
      this.scale = Math.round((this.scale - 0.1) * 100) / 100;
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
    this.settle(now, 3000);
    if (this.scale < 1) {
      this.scale = Math.min(1, Math.round((this.scale + 0.1) * 100) / 100);
      return { kind: 'scale', scale: this.scale };
    }
    const i = ORDER.indexOf(this.preset);
    if (i < ORDER.length - 1 && this.upgrades < 2) {
      this.upgrades++;
      this.preset = ORDER[i + 1];
      return { kind: 'preset', preset: this.preset, scale: this.scale };
    }
    return NONE;
  }

  private percentile(p: number): number {
    const n = this.sampleCount;
    const s = this.scratch;
    for (let i = 0; i < n; i++) s[i] = this.samples[i];
    const view = s.subarray(0, n);
    view.sort();
    return view[Math.min(n - 1, Math.floor(p * n))];
  }
}

const NONE: AdaptiveAction = { kind: 'none' };

function clampNum(x: number, lo: number, hi: number): number {
  return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : hi;
}

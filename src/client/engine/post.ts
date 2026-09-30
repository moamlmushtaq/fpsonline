// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — post-processing pipeline (medium / high presets).
//
//   RenderPass(world) → OverlayPass(viewmodel, depth cleared) → [UnrealBloom]
//   → GradingPass (final, to screen)
//
// The GradingPass is the single custom full-screen shader. It also performs
// the OutputPass duties (ACES filmic tone mapping with the renderer's exposure
// + sRGB encoding) so grading happens in display space, where saturation,
// shadow tint, vignette and grain behave perceptually — and phones save one
// full-screen pass. On 'high' it adds a cheap painterly filter: a 9-tap,
// 4-quadrant Kuwahara-style smoothing (edge preserving) plus a paper grain.
//
// Everything linear/HDR lives in HalfFloat render targets (MSAA on high).
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { GradingSettings } from '../contracts';

/** CSS hex → display-space (non-linearized) RGB triple. */
export function hexToDisplayRGB(hex: string, out = new THREE.Vector3()): THREE.Vector3 {
  const c = new THREE.Color();
  // Interpreting the input as "linear" skips the sRGB→linear conversion, so the
  // stored components are exactly the sRGB display values we want here.
  c.setStyle(hex, THREE.LinearSRGBColorSpace);
  return out.set(c.r, c.g, c.b);
}

// ── Overlay pass: viewmodel drawn over the world with a cleared depth buffer ─

class OverlayPass extends Pass {
  scene: THREE.Scene | null = null;
  camera: THREE.Camera | null = null;

  constructor() {
    super();
    this.needsSwap = false;
  }

  override render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    if (!this.scene || !this.camera) return;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }
}

// ── Grading shader ──────────────────────────────────────────────────────────

const GRADING_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const GRADING_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform vec2 uResolution;
uniform float uTime;
uniform float uExposure;
uniform float uSaturation;
uniform vec3 uTint;
uniform vec3 uShadowTint;
uniform float uVignette;
uniform float uGrain;
uniform float uPaintRadius;
varying vec2 vUv;

// ACES filmic fit (identical to three.js ACESFilmicToneMapping).
vec3 hfRRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 color) {
  const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= uExposure / 0.6;
  color = ACESInputMat * color;
  color = hfRRTAndODTFit(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}
vec3 srgbEncode(vec3 c) {
  return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

#ifdef PAINTERLY
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
vec3 tap(vec2 uv) { return aces(texture2D(tDiffuse, uv).rgb); }
// One Kuwahara quadrant from the shared centre + two bilinear taps.
void quadrant(vec3 c0, vec2 uv, vec2 dir, vec2 px, inout vec3 acc, inout float wsum) {
  vec3 s1 = tap(uv + vec2(dir.x * 1.5, dir.y * 0.5) * px);
  vec3 s2 = tap(uv + vec2(dir.x * 0.5, dir.y * 1.5) * px);
  vec3 m = (c0 + s1 + s2) * (1.0 / 3.0);
  vec3 d0 = c0 - m; vec3 d1 = s1 - m; vec3 d2 = s2 - m;
  float v = dot(d0, d0) + dot(d1, d1) + dot(d2, d2);
  float w = 1.0 / (1.0 + v * 900.0);
  w *= w;
  acc += m * w;
  wsum += w;
}
#endif

void main() {
  vec2 uv = vUv;
#ifdef PAINTERLY
  vec2 px = uTexel * uPaintRadius;
  vec3 c0 = tap(uv);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  quadrant(c0, uv, vec2(-1.0, -1.0), px, acc, wsum);
  quadrant(c0, uv, vec2(1.0, -1.0), px, acc, wsum);
  quadrant(c0, uv, vec2(-1.0, 1.0), px, acc, wsum);
  quadrant(c0, uv, vec2(1.0, 1.0), px, acc, wsum);
  vec3 col = acc / max(wsum, 1e-5);
  // Keep a little of the original so fine UI-critical detail never smears away.
  col = mix(col, c0, 0.25);
#else
  vec3 col = aces(texture2D(tDiffuse, uv).rgb);
#endif

  // Saturation (around luma) and warm tint (luminance-preserving).
  float l = luma(col);
  col = mix(vec3(l), col, uSaturation);
  col *= uTint / max(luma(uTint), 1e-3);

  // Painterly shadow lift toward the cool-violet shadow tint (never pure black).
  float sh = 1.0 - smoothstep(0.0, 0.42, l);
  col = mix(col, max(col, uShadowTint), sh * 0.3);
  col += uShadowTint * sh * sh * 0.06;

  // Soft oval vignette.
  vec2 q = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float vig = smoothstep(1.05, 0.25, length(q) * 1.1);
  col *= mix(1.0, vig, uVignette);

#ifdef PAINTERLY
  // Paper tooth: fine mottling + long faint fibers, fixed in screen space.
  vec2 pp = gl_FragCoord.xy;
  float paper = vnoise(pp * 0.45) * 0.55 + vnoise(pp * 1.3) * 0.25 + vnoise(vec2(pp.x * 0.05, pp.y * 0.9)) * 0.2;
  col *= 1.0 + (paper - 0.5) * 0.045;
#endif

  // Animated film grain, strongest in the mid-tones.
  float g = hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 317.0) - 0.5;
  col += g * uGrain * 0.09 * (0.35 + 0.65 * (1.0 - abs(l * 2.0 - 1.0)));

  gl_FragColor = vec4(srgbEncode(clamp(col, 0.0, 1.0)), 1.0);
}`;

class GradingPass extends Pass {
  readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;

  constructor(painterly: boolean) {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uExposure: { value: 1 },
        uSaturation: { value: 1 },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
        uShadowTint: { value: new THREE.Vector3(0.23, 0.25, 0.31) },
        uVignette: { value: 0.3 },
        uGrain: { value: 0.04 },
        uPaintRadius: { value: 1.6 },
      },
      defines: painterly ? { PAINTERLY: '' } : {},
      vertexShader: GRADING_VERT,
      fragmentShader: GRADING_FRAG,
      depthTest: false,
      depthWrite: false,
      // We tone map + encode ourselves; keep three from injecting its own.
      toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  setPainterly(on: boolean): void {
    const has = 'PAINTERLY' in this.material.defines;
    if (has === on) return;
    this.material.defines = on ? { PAINTERLY: '' } : {};
    this.material.needsUpdate = true;
  }

  override setSize(w: number, h: number): void {
    this.material.uniforms.uTexel.value.set(1 / Math.max(1, w), 1 / Math.max(1, h));
    this.material.uniforms.uResolution.value.set(Math.max(1, w), Math.max(1, h));
    // Painterly radius grows a touch with resolution so the look is stable across DPRs.
    this.material.uniforms.uPaintRadius.value = THREE.MathUtils.clamp(h / 720, 1, 2.2) * 1.35;
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.uExposure.value = renderer.toneMappingExposure;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}

// ── Pipeline ────────────────────────────────────────────────────────────────

export interface PostOptions {
  bloom: boolean;
  painterly: boolean;
  /** MSAA samples for the HDR scene target (0 = off). */
  samples: number;
}

/** Luminance threshold: only emissives, the sun disc and hot glints bloom. */
const BLOOM_THRESHOLD = 0.92;

export class PostPipeline {
  readonly composer: EffectComposer;
  private readonly worldPass: RenderPass;
  private readonly overlayPass = new OverlayPass();
  private bloomPass: UnrealBloomPass | null = null;
  private readonly grading: GradingPass;
  private readonly emptyScene = new THREE.Scene();
  private readonly emptyCamera = new THREE.PerspectiveCamera();
  private time = 0;
  private opts: PostOptions;
  private w = 1;
  private h = 1;

  constructor(private readonly renderer: THREE.WebGLRenderer, width: number, height: number, pixelRatio: number, opts: PostOptions) {
    this.opts = { ...opts };
    this.w = Math.max(1, width);
    this.h = Math.max(1, height);
    const rt = new THREE.WebGLRenderTarget(Math.round(this.w * pixelRatio), Math.round(this.h * pixelRatio), {
      type: THREE.HalfFloatType,
      samples: opts.samples,
    });
    rt.texture.name = 'Halcyon.hdr';
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(this.w, this.h);
    this.worldPass = new RenderPass(this.emptyScene, this.emptyCamera);
    this.composer.addPass(this.worldPass);
    this.composer.addPass(this.overlayPass);
    if (opts.bloom) this.addBloom();
    this.grading = new GradingPass(opts.painterly);
    this.composer.addPass(this.grading);
  }

  private addBloom(): void {
    const res = new THREE.Vector2(this.w, this.h);
    const bloom = new UnrealBloomPass(res, 0.6, 0.55, BLOOM_THRESHOLD);
    // Soft knee so the transition into bloom is gentle (default is a hard 0.01).
    (bloom.highPassUniforms as Record<string, THREE.IUniform>).smoothWidth.value = 0.35;
    this.bloomPass = bloom;
    this.composer.insertPass(bloom, 2);
  }

  setOptions(opts: PostOptions): void {
    if (opts.bloom !== this.opts.bloom) {
      if (opts.bloom) this.addBloom();
      else if (this.bloomPass) {
        this.composer.removePass(this.bloomPass);
        this.bloomPass.dispose();
        this.bloomPass = null;
      }
    }
    this.grading.setPainterly(opts.painterly);
    if (opts.samples !== this.opts.samples) {
      // Sample count is baked into the render targets.
      this.composer.renderTarget1.samples = opts.samples;
      this.composer.renderTarget2.samples = opts.samples;
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
    }
    this.opts = { ...opts };
  }

  setScenes(
    scene: THREE.Scene | null,
    camera: THREE.Camera | null,
    overlay: THREE.Scene | null,
    overlayCamera: THREE.Camera | null,
  ): void {
    this.worldPass.scene = scene ?? this.emptyScene;
    this.worldPass.camera = camera ?? this.emptyCamera;
    this.overlayPass.scene = overlay;
    this.overlayPass.camera = overlayCamera;
  }

  setGrading(g: GradingSettings): void {
    const u = this.grading.material.uniforms;
    u.uSaturation.value = g.saturation;
    hexToDisplayRGB(g.tint, u.uTint.value);
    hexToDisplayRGB(g.shadowTint, u.uShadowTint.value);
    u.uVignette.value = THREE.MathUtils.clamp(g.vignette, 0, 1);
    u.uGrain.value = THREE.MathUtils.clamp(g.grain, 0, 1);
    if (this.bloomPass) this.bloomPass.strength = THREE.MathUtils.clamp(g.bloomStrength, 0, 1.5) * 0.75;
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.w = Math.max(1, width);
    this.h = Math.max(1, height);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(this.w, this.h);
  }

  render(dt: number): void {
    this.time += dt;
    this.grading.material.uniforms.uTime.value = this.time % 1000;
    this.composer.render(dt);
  }

  dispose(): void {
    this.bloomPass?.dispose();
    this.grading.dispose();
    this.composer.dispose();
  }
}

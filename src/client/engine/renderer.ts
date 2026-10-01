// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — RenderEngine implementation.
//
// Owns the single WebGLRenderer, the world + overlay (viewmodel) passes, the
// post pipeline (medium/high), resize/DPR handling, frame statistics, WebGL
// context loss, and the adaptive "Auto" quality controller.
//
// Cameras registered through setScene/setOverlay get their aspect ratio kept
// in sync with the canvas automatically.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { GradingSettings, QualityPreset, QualitySettings, RenderEngine } from '../contracts';
import { applySceneFogSun, setBakedShadowSupport, type StaticShadowBake } from './atmosphere';
import { ENV } from './palette';
import { setDirectGrading } from './painterly';
import { PostPipeline } from './post';
import { AdaptiveQuality, detectInitialPreset, resolveQuality, type ResolvedPreset } from './quality';

export const DEFAULT_GRADING: GradingSettings = {
  exposure: 1.05,
  bloomStrength: 0.8,
  saturation: 1.06,
  tint: '#fff3e2',
  vignette: 0.32,
  grain: 0.035,
  shadowTint: ENV.shadowCool,
};

type Listener<T extends unknown[]> = (...a: T) => void;

export class Renderer implements RenderEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly size = { width: 1, height: 1, aspect: 1 };
  readonly stats = { fps: 60, frameMs: 16.7, calls: 0, triangles: 0 };

  private q: QualitySettings;
  private preset: QualityPreset;
  private renderScale: number;
  private adaptive: AdaptiveQuality | null = null;
  private post: PostPipeline | null = null;
  private grading: GradingSettings = { ...DEFAULT_GRADING };

  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private overlay: THREE.Scene | null = null;
  private overlayCamera: THREE.PerspectiveCamera | null = null;

  private readonly qualityListeners = new Set<Listener<[QualitySettings]>>();
  private readonly resizeListeners = new Set<Listener<[number, number]>>();
  private resizeDirty = true;
  private contextLost = false;
  private lastFrameTime = 0;
  private resizeObserver: ResizeObserver | null = null;
  private readonly onWindowResize = (): void => {
    this.resizeDirty = true;
  };
  private readonly onContextLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
  };
  private readonly onContextRestored = (): void => {
    this.contextLost = false;
    // three re-initialises its GL state itself; our render targets are rebuilt.
    this.rebuildPost();
    this.applyRendererQuality();
    this.markSceneMaterialsDirty();
    this.resizeDirty = true;
  };
  private readonly onVisibility = (): void => {
    if (!document.hidden) this.adaptive?.settle(performance.now(), 1500);
  };

  constructor(canvas: HTMLCanvasElement, opts: { preset: QualityPreset; renderScale: number }) {
    this.canvas = canvas;
    this.preset = opts.preset;
    this.renderScale = clampScale(opts.renderScale);
    const start: ResolvedPreset = opts.preset === 'auto' ? detectInitialPreset() : opts.preset;
    if (opts.preset === 'auto') this.adaptive = new AdaptiveQuality(start, performance.now());
    this.q = resolveQuality(start, this.renderScale, 1);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        // MSAA on the default framebuffer only matters for the no-post (low)
        // path; post uses multisampled HDR targets instead.
        antialias: this.q.preset !== 'low',
        powerPreference: 'high-performance',
        alpha: false,
        stencil: false,
        depth: true,
        preserveDrawingBuffer: false,
      });
    } catch {
      // Some drivers refuse high-performance / antialias; retry minimal.
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    }
    this.renderer = renderer;
    setBakedShadowSupport(renderer);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = this.grading.exposure;
    // PCF with a per-preset kernel radius (atmosphere sets sun.shadow.radius);
    // atmosphere.ts patches its kernel to 5 bilinear taps → soft, stair-free,
    // stable painterly penumbrae. PCFSoft ignores the radius (harder edges).
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.info.autoReset = false;
    renderer.setClearColor(0x000000, 1);

    this.applyRendererQuality();
    this.measure();
    this.rebuildPost();

    canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);
    window.addEventListener('resize', this.onWindowResize);
    window.visualViewport?.addEventListener('resize', this.onWindowResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.onWindowResize);
      this.resizeObserver.observe(canvas);
    }
  }

  get quality(): QualitySettings {
    return this.q;
  }

  // ── Scenes ────────────────────────────────────────────────────────────────

  /**
   * The render target scenes are drawn into this frame (the post pipeline's HDR target,
   * or null = the canvas). Shader warm-up must compile against it: three.js keys programs
   * on the target (output colour space, tone mapping), so a program compiled for the
   * canvas is compiled again on first use when post is on.
   */
  get sceneTarget(): THREE.WebGLRenderTarget | null {
    return this.post?.composer.renderTarget1 ?? null;
  }

  setScene(scene: THREE.Scene | null, camera: THREE.PerspectiveCamera | null): void {
    this.scene = scene;
    this.camera = camera;
    this.syncCamera(camera);
    this.post?.setScenes(this.scene, this.camera, this.overlay, this.overlayCamera);
    this.adaptive?.settle(performance.now(), 2500);
  }

  setOverlay(scene: THREE.Scene | null, camera: THREE.PerspectiveCamera | null): void {
    this.overlay = scene;
    this.overlayCamera = camera;
    this.syncCamera(camera);
    this.post?.setScenes(this.scene, this.camera, this.overlay, this.overlayCamera);
  }

  // ── Grading / quality ────────────────────────────────────────────────────

  setGrading(g: Partial<GradingSettings>): void {
    for (const k of Object.keys(g) as (keyof GradingSettings)[]) {
      const v = g[k];
      if (v !== undefined) (this.grading as unknown as Record<string, unknown>)[k] = v;
    }
    this.renderer.toneMappingExposure = this.grading.exposure;
    this.post?.setGrading(this.grading);
    this.syncDirectGrading();
  }

  /** Low preset (no post): the same grade is applied inside every material (painterly.ts). */
  private syncDirectGrading(): void {
    const px = this.q.pixelRatio;
    setDirectGrading(this.post ? null : this.grading, Math.round(this.size.width * px), Math.round(this.size.height * px));
  }

  /** Current merged grading (read-only copy). */
  getGrading(): GradingSettings {
    return { ...this.grading };
  }

  setQualityPreset(p: QualityPreset): void {
    this.preset = p;
    const now = performance.now();
    if (p === 'auto') {
      const start = this.adaptive?.preset ?? detectInitialPreset();
      this.adaptive = new AdaptiveQuality(start, now);
      this.applyQuality(resolveQuality(start, this.renderScale, 1));
    } else {
      this.adaptive = null;
      this.applyQuality(resolveQuality(p, this.renderScale, 1));
    }
  }

  setRenderScale(s: number): void {
    this.renderScale = clampScale(s);
    this.applyQuality(resolveQuality(this.q.preset, this.renderScale, this.adaptive?.scale ?? 1));
  }

  onQualityChange(cb: (q: QualitySettings) => void): () => void {
    this.qualityListeners.add(cb);
    return () => this.qualityListeners.delete(cb);
  }

  onResize(cb: (w: number, h: number) => void): () => void {
    this.resizeListeners.add(cb);
    return () => this.resizeListeners.delete(cb);
  }

  private applyQuality(next: QualitySettings): void {
    const prev = this.q;
    this.q = next;
    const shadowChange = prev.shadows !== next.shadows || prev.shadowMapSize !== next.shadowMapSize;
    this.applyRendererQuality();
    if (prev.post !== next.post || !this.post) this.rebuildPost();
    else this.post.setOptions(this.postOptions());
    this.syncDirectGrading();
    if (shadowChange) this.markSceneMaterialsDirty();
    this.resizeDirty = true;
    for (const cb of this.qualityListeners) cb(next);
  }

  private applyRendererQuality(): void {
    const r = this.renderer;
    // Always on: medium/high follow the view with a live PCF shadow map; low
    // has no per-frame shadow pass but samples the map's sun shadow baked once
    // (atmosphere.ts setStaticShadowCasters) through a 4-tap bilinear BASIC lookup. Scenes
    // without a casting light (menu on low) compile no shadow code at all.
    r.shadowMap.enabled = true;
    r.shadowMap.type = this.q.shadows === 'off' ? THREE.BasicShadowMap : THREE.PCFShadowMap;
    r.shadowMap.needsUpdate = true;
    r.setPixelRatio(this.q.pixelRatio);
  }

  private postOptions(): { bloom: boolean; painterly: boolean; samples: number } {
    return {
      bloom: this.q.bloom,
      painterly: this.q.painterly,
      samples: this.q.antialias ? (this.q.preset === 'high' ? 4 : 2) : 0,
    };
  }

  private rebuildPost(): void {
    this.post?.dispose();
    this.post = null;
    if (this.q.post) {
      try {
        this.post = new PostPipeline(this.renderer, this.size.width, this.size.height, this.q.pixelRatio, this.postOptions());
        this.post.setScenes(this.scene, this.camera, this.overlay, this.overlayCamera);
        this.post.setGrading(this.grading);
      } catch (err) {
        // Missing HalfFloat render target support etc. → direct rendering.
        console.warn('[renderer] post pipeline unavailable, rendering directly', err);
        this.post = null;
      }
    }
    // Without post (low, or no HalfFloat support) the grade moves into the materials.
    this.syncDirectGrading();
  }

  /** Shadow on/off changes shader programs; ask three to rebuild them. */
  private markSceneMaterialsDirty(): void {
    const mark = (o: THREE.Object3D): void => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) for (const x of m) x.needsUpdate = true;
      else if (m) m.needsUpdate = true;
    };
    this.scene?.traverse(mark);
    this.overlay?.traverse(mark);
  }

  // ── Size ────────────────────────────────────────────────────────────────

  private measure(): boolean {
    const c = this.canvas;
    const w = Math.max(1, Math.round(c.clientWidth || window.innerWidth || 1));
    const h = Math.max(1, Math.round(c.clientHeight || window.innerHeight || 1));
    const changed = w !== this.size.width || h !== this.size.height;
    this.size.width = w;
    this.size.height = h;
    this.size.aspect = w / h;
    this.renderer.setPixelRatio(this.q.pixelRatio);
    this.renderer.setSize(w, h, false);
    return changed;
  }

  private syncCamera(cam: THREE.PerspectiveCamera | null): void {
    if (!cam) return;
    if (Math.abs(cam.aspect - this.size.aspect) > 1e-4) {
      cam.aspect = this.size.aspect;
      cam.updateProjectionMatrix();
    }
  }

  private handleResize(): void {
    this.resizeDirty = false;
    const changed = this.measure();
    this.post?.setSize(this.size.width, this.size.height, this.q.pixelRatio);
    this.syncDirectGrading();
    this.syncCamera(this.camera);
    this.syncCamera(this.overlayCamera);
    if (changed) {
      this.adaptive?.settle(performance.now(), 1500);
      for (const cb of this.resizeListeners) cb(this.size.width, this.size.height);
    }
  }

  // ── Frame ───────────────────────────────────────────────────────────────

  render(dt: number): void {
    const now = performance.now();
    const frameMs = this.lastFrameTime > 0 ? now - this.lastFrameTime : 16.7;
    this.lastFrameTime = now;
    this.updateStats(frameMs);
    this.runAdaptive(frameMs, now);

    if (this.contextLost) return;
    if (this.resizeDirty) this.handleResize();
    // Cameras may have been swapped by callers; keep aspect right each frame (cheap check).
    this.syncCamera(this.camera);
    this.syncCamera(this.overlayCamera);

    const r = this.renderer;
    r.info.reset();
    if (this.scene && this.camera && this.camera.far !== this.q.drawDistance) {
      // Callers own the camera but the far plane is a quality knob.
      this.camera.far = this.q.drawDistance;
      this.camera.updateProjectionMatrix();
    }

    // Aerial perspective: this scene's sun-tinted fog (0 when it has none).
    applySceneFogSun(this.scene);
    // Low preset: render the map's one-time baked sun depth first (atmosphere.ts).
    const bake = this.scene?.userData.hfShadowBake as StaticShadowBake | undefined;
    if (bake?.pending) bake.run(r);
    if (this.post) {
      this.post.render(dt);
    } else {
      r.autoClear = true;
      if (this.scene && this.camera) r.render(this.scene, this.camera);
      else r.clear();
      if (this.overlay && this.overlayCamera) {
        r.autoClear = false;
        r.clearDepth();
        r.render(this.overlay, this.overlayCamera);
        r.autoClear = true;
      }
    }
    this.stats.calls = r.info.render.calls;
    this.stats.triangles = r.info.render.triangles;
  }

  private updateStats(frameMs: number): void {
    const ms = Math.min(250, Math.max(1, frameMs));
    this.stats.frameMs += (ms - this.stats.frameMs) * 0.08;
    this.stats.fps = 1000 / this.stats.frameMs;
  }

  private runAdaptive(frameMs: number, now: number): void {
    if (!this.adaptive || this.preset !== 'auto') return;
    const a = this.adaptive.feed(frameMs, now, document.hidden);
    if (a.kind === 'scale') this.applyQuality(resolveQuality(this.q.preset, this.renderScale, a.scale));
    else if (a.kind === 'preset') this.applyQuality(resolveQuality(a.preset, this.renderScale, a.scale));
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    window.removeEventListener('resize', this.onWindowResize);
    window.visualViewport?.removeEventListener('resize', this.onWindowResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.resizeObserver?.disconnect();
    this.post?.dispose();
    this.renderer.dispose();
  }
}

function clampScale(s: number): number {
  return Number.isFinite(s) ? Math.max(0.5, Math.min(1, s)) : 1;
}

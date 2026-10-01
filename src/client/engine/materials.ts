// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — MaterialLibrary: cached, shared environment materials.
//
//  • surface(tag, {style, color})  painterly textured material for a surface.
//  • surfaceVC(...)                same, but with vertex colors enabled (the map
//                                  builder bakes AO / edge shading into them).
//  • painted(color, opts)          flat stylized material.
//  • glow(color, intensity)        HDR emissive plant material (bloom source).
//  • canvasTexture(key, w, h, fn)  cached canvas textures for decor.
//
// Low preset → MeshLambertMaterial (per-vertex lighting, much cheaper on
// phones); otherwise MeshStandardMaterial. Textures are neutral greys tinted by
// the ENV color, so a handful of textures serve the whole palette.
//
// Texture coordinates: surface textures expect WORLD-SCALE UVs (1 unit = one
// texture repeat = TEX_TILE meters). Use boxProjectUVs() on custom geometry.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { MaterialLibrary, QualitySettings } from '../contracts';
import type { SurfaceTag } from '../../shared/types';
import { ENV } from './palette';
import { enablePainterly } from './painterly';
import { disposeProceduralTextures, makeCanvas, proceduralTexture, TEX_TILE, type TexName } from './textures';

/** Faded timber (derived from the ENV neutrals; not a gameplay color). */
export const WOOD_COLOR = '#b39a7f';
export const DIRT_COLOR = '#b59d82';

/** Default ENV color per surface tag. */
export const TAG_COLOR: Record<SurfaceTag, string> = {
  concrete: ENV.concrete,
  metal: ENV.metalLight,
  ceramic: ENV.bone,
  wood: WOOD_COLOR,
  plaster: ENV.sandLight,
  tile: ENV.pastelMint,
  glass: ENV.skyPale,
  grass: ENV.sage,
  dirt: DIRT_COLOR,
  sand: ENV.sand,
  rock: ENV.rock,
  snow: ENV.snow,
  water: ENV.water,
  foliage: ENV.olive,
  fabric: ENV.boneShade,
};

/** Texture used per tag (glass/water are untextured). */
export const TAG_TEXTURE: Record<SurfaceTag, TexName | null> = {
  concrete: 'concrete',
  metal: 'metal',
  ceramic: 'ceramic',
  wood: 'wood',
  plaster: 'plaster',
  tile: 'tile',
  glass: null,
  grass: 'grass',
  dirt: 'dirt',
  sand: 'sand',
  rock: 'rock',
  snow: 'snow',
  water: null,
  foliage: 'foliage',
  fabric: 'fabric',
};

const TAG_ROUGHNESS: Record<SurfaceTag, number> = {
  concrete: 0.95,
  metal: 0.55,
  ceramic: 0.42,
  wood: 0.9,
  plaster: 0.93,
  tile: 0.5,
  glass: 0.08,
  grass: 1,
  dirt: 1,
  sand: 1,
  rock: 0.95,
  snow: 0.8,
  water: 0.1,
  foliage: 0.95,
  fabric: 1,
};

/** Style → texture override (e.g. corrugated shipping containers). */
const STYLE_TEXTURE: Record<string, TexName> = {
  container: 'corrugated',
  hangar: 'corrugated',
  shed: 'corrugated',
};

export function textureForSurface(tag: SurfaceTag, style?: string): TexName | null {
  return (style && STYLE_TEXTURE[style]) || TAG_TEXTURE[tag];
}

export interface SurfaceOpts {
  style?: string;
  color?: string;
}

export interface PaintedOpts {
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
}

export type MaterialTier = 'low' | 'medium' | 'high';

export class Materials implements MaterialLibrary {
  private tier: MaterialTier = 'high';
  private texSize = 512;
  private anisotropy = 4;
  private readonly cache = new Map<string, THREE.Material>();
  private readonly canvasCache = new Map<string, THREE.Texture>();

  constructor() {}

  /** Chooses Lambert vs Standard and texture sizes. The map builder calls this before building. */
  setQuality(q: QualitySettings): void {
    this.tier = q.preset;
    this.texSize = q.preset === 'low' ? 256 : 512;
    this.anisotropy = q.preset === 'high' ? 4 : q.preset === 'medium' ? 2 : 1;
  }

  get currentTier(): MaterialTier {
    return this.tier;
  }

  /** Cached procedural texture at the current quality size. */
  texture(name: TexName): THREE.Texture {
    return proceduralTexture(name, name === 'knurl' ? 64 : name === 'ceramic' || name === 'metal' || name === 'wear' ? Math.min(256, this.texSize) : this.texSize, this.anisotropy);
  }

  surface(tag: SurfaceTag, opts?: SurfaceOpts): THREE.Material {
    return this.surfaceImpl(tag, opts, false);
  }

  /** Surface material with vertex colors (geometry MUST carry a `color` attribute). */
  surfaceVC(tag: SurfaceTag, opts?: SurfaceOpts): THREE.Material {
    return this.surfaceImpl(tag, opts, true);
  }

  private surfaceImpl(tag: SurfaceTag, opts: SurfaceOpts | undefined, vc: boolean): THREE.Material {
    const color = opts?.color ?? TAG_COLOR[tag] ?? ENV.concrete;
    const style = opts?.style ?? '';
    const texName = textureForSurface(tag, style);
    const key = `s|${this.tier}|${vc ? 1 : 0}|${tag}|${texName}|${color}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    let m: THREE.Material;
    if (tag === 'glass') {
      m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: 0.08,
        metalness: 0.1,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexColors: vc,
      });
    } else if (tag === 'water') {
      m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.85, vertexColors: vc });
    } else {
      const map = texName ? this.texture(texName) : null;
      if (this.tier === 'low') {
        m = new THREE.MeshLambertMaterial({ color: new THREE.Color(color), map, vertexColors: vc });
      } else {
        m = new THREE.MeshStandardMaterial({
          color: new THREE.Color(color),
          map,
          roughness: TAG_ROUGHNESS[tag] ?? 0.9,
          metalness: tag === 'metal' ? 0.18 : 0,
          vertexColors: vc,
        });
      }
    }
    // Hand-painted finish (world-space mottling, hue drift, painted form): every preset.
    enablePainterly(m);
    m.name = `surface.${tag}.${style || 'default'}`;
    this.cache.set(key, m);
    return m;
  }

  painted(color: string, opts: PaintedOpts = {}): THREE.Material {
    const key = `p|${this.tier}|${color}|${opts.roughness ?? ''}|${opts.metalness ?? ''}|${opts.emissive ?? ''}|${opts.emissiveIntensity ?? ''}|${opts.transparent ? 1 : 0}|${opts.opacity ?? ''}|${opts.side ?? ''}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const common = {
      color: new THREE.Color(color),
      transparent: !!opts.transparent,
      opacity: opts.opacity ?? 1,
      side: opts.side ?? THREE.FrontSide,
      emissive: new THREE.Color(opts.emissive ?? '#000000'),
      emissiveIntensity: opts.emissiveIntensity ?? 1,
    };
    const m =
      this.tier === 'low'
        ? new THREE.MeshLambertMaterial(common)
        : new THREE.MeshStandardMaterial({ ...common, roughness: opts.roughness ?? 0.85, metalness: opts.metalness ?? 0 });
    if (opts.transparent) m.depthWrite = false;
    // Flat stylized props still read hand-painted (skipped for see-through ones).
    enablePainterly(m);
    m.name = `painted.${color}`;
    this.cache.set(key, m);
    return m;
  }

  glow(color: string, intensity = 2.2): THREE.Material {
    const key = `g|${color}|${intensity}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    // HDR basic color: values > 1 feed the bloom pass; fog still applies so
    // distant plants melt into the haze.
    const c = new THREE.Color(color).multiplyScalar(intensity);
    const m = new THREE.MeshBasicMaterial({ color: c });
    m.name = `glow.${color}`;
    this.cache.set(key, m);
    return m;
  }

  canvasTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.Texture {
    const hit = this.canvasCache.get(key);
    if (hit) return hit;
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    draw(ctx, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = this.anisotropy;
    t.name = `canvas.${key}`;
    this.canvasCache.set(key, t);
    return t;
  }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
    for (const t of this.canvasCache.values()) t.dispose();
    this.canvasCache.clear();
    disposeProceduralTextures();
  }
}

/**
 * Writes world-scale box-projected UVs (per-triangle dominant axis) into a
 * geometry so surface() textures keep a consistent texel density on custom
 * decor meshes. Positions are taken in the geometry's local space; pass the
 * object's world matrix if the mesh will be placed/scaled.
 */
export function boxProjectUVs(geo: THREE.BufferGeometry, tex: TexName | number = 'concrete', matrix?: THREE.Matrix4): void {
  const tile = typeof tex === 'number' ? tex : TEX_TILE[tex];
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) {
    // Copy the de-indexed attributes back so the caller's reference stays valid.
    geo.setIndex(null);
    for (const name of Object.keys(g.attributes)) geo.setAttribute(name, g.attributes[name]);
  }
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    if (matrix) {
      a.applyMatrix4(matrix);
      b.applyMatrix4(matrix);
      c.applyMatrix4(matrix);
    }
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const p = k === 0 ? a : k === 1 ? b : c;
      let u: number;
      let v: number;
      if (ay >= ax && ay >= az) {
        u = p.x;
        v = p.z;
      } else if (ax >= az) {
        u = p.z;
        v = p.y;
      } else {
        u = p.x;
        v = p.y;
      }
      uv[(i + k) * 2] = u / tile;
      uv[(i + k) * 2 + 1] = v / tile;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// ── Contact shadows (blob AO decals) ────────────────────────────────────────
//
// Cheap grounding for props and characters on every preset (and the only
// dynamic-object shadow on low): a soft elliptical darkening decal in the
// palette's cool shadow color. Merge many quads into ONE mesh with
// contactShadowGeometry() + contactShadowMaterial() (one draw call).

let contactTex: THREE.DataTexture | null = null;
let contactMat: THREE.MeshBasicMaterial | null = null;

/** Soft radial falloff (64², DOM-free), alpha = occlusion. */
export function contactShadowTexture(): THREE.DataTexture {
  if (contactTex) return contactTex;
  const N = 64;
  const d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N - 0.5;
      const dy = (y + 0.5) / N - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      // Dense core (contact) fading into a wide soft skirt.
      const a = Math.pow(1 - r, 1.6) * 0.85 + Math.pow(Math.max(0, 1 - r * 1.8), 2) * 0.15;
      const i = (y * N + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(THREE.MathUtils.clamp(a, 0, 1) * 255);
    }
  }
  contactTex = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  contactTex.name = 'tex.contactShadow';
  contactTex.magFilter = THREE.LinearFilter;
  contactTex.minFilter = THREE.LinearMipmapLinearFilter;
  contactTex.generateMipmaps = true;
  contactTex.needsUpdate = true;
  return contactTex;
}

/** Shared contact-shadow material (cool violet-brown, never black; fogged). */
export function contactShadowMaterial(): THREE.MeshBasicMaterial {
  if (contactMat) return contactMat;
  contactMat = new THREE.MeshBasicMaterial({
    map: contactShadowTexture(),
    color: new THREE.Color(ENV.shadowWarm).lerp(new THREE.Color(ENV.shadowCool), 0.5),
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  contactMat.name = 'contactShadow';
  return contactMat;
}

/**
 * Ground quad for one contact shadow: centred at (x, y, z), radii rx/rz (m),
 * yaw `ry`. Merge several (mergeGeometries) and draw with contactShadowMaterial().
 */
export function contactShadowGeometry(x: number, y: number, z: number, rx: number, rz: number, ry = 0): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(rx * 2, rz * 2);
  g.rotateX(-Math.PI / 2);
  g.rotateY(ry);
  g.translate(x, y + 0.01, z);
  return g;
}

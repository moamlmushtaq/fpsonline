// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Observatory rock helpers: faceted, snow-dusted rock masses
// that always COVER their collision box (displacement is outward only, walkable
// tops stay flat), boulders, snow drifts and glowing lichen.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ENV } from '../../../engine/palette';
import { floorQuad, type ObsKit, rbox, sphere } from './kit';

function h3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 3D value noise in [0, 1]. */
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number): number => h3(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), sx), l(c(0, 1, 0), c(1, 1, 0), sx), sy),
    l(l(c(0, 0, 1), c(1, 0, 1), sx), l(c(0, 1, 1), c(1, 1, 1), sx), sy),
    sz,
  );
}

export const ROCK = '#8a8290';
export const ROCK_DARK = '#5e5a6a';

export interface RockOpts {
  /** Outward displacement amplitude (m). */
  amp?: number;
  /** Subdivision size (m). */
  seg?: number;
  /** Walkable top: keep it flat (and lay a snow slab on it). */
  flatTop?: boolean;
  /** Jagged crest amplitude for unwalkable tops. */
  crest?: number;
  color?: string;
  /** Faces to skip (hidden against other geometry): 'x-','x+','z-','z+'. */
  skip?: string[];
  /** Noise frequency. */
  freq?: number;
  /**
   * Vertical fins / gullies (0..1): the side displacement follows a noise stretched
   * vertically, and recessed vertices are baked darker — reads as wind-cut crags
   * rather than a lumpy box.
   */
  fins?: number;
}

/** Faceted rock mass covering the box [x0,x1]×[y0,y1]×[z0,z1]. */
export function rockBox(kit: ObsKit, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, o: RockOpts = {}): void {
  const amp = o.amp ?? 0.4;
  const seg = (o.seg ?? 1.4) * (kit.low ? 1.5 : 1);
  const freq = o.freq ?? 0.42;
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const g0 = new THREE.BoxGeometry(w, h, d, Math.max(1, Math.round(w / seg)), Math.max(1, Math.round(h / seg)), Math.max(1, Math.round(d / seg)));
  g0.deleteAttribute('normal');
  g0.deleteAttribute('uv');
  const g = mergeVertices(g0, 1e-4);
  g0.dispose();
  const p = g.attributes.position as THREE.BufferAttribute;
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const e = 1e-4;
  const fins = o.fins ?? 0;
  const ao = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    let vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const wx = vx + cx, wy = vy + cy, wz = vz + cz;
    const onTop = vy > hy - e;
    const onBottom = vy < -hy + e;
    const n1 = noise3(wx * freq, wy * freq, wz * freq);
    const n2 = noise3(wx * freq * 3.1 + 7, wy * freq * 3.1, wz * freq * 3.1 - 3);
    // Fins: noise along the face, stretched ×6 vertically (gullies run down the crag).
    const fin = smooth01((noise3(wx * 0.38 + 11, wy * 0.065, wz * 0.38 - 5) - 0.25) * 2);
    const lump = 0.25 + 0.6 * n1 + 0.3 * n2;
    const k = amp * (lump * (1 - fins) + (0.12 + 1.05 * fin + 0.25 * n2) * fins);
    // Baked cavity: recessed vertices (gullies, strata undercuts) darker.
    const cav = onTop ? 1 : 0.5 + 0.5 * Math.min(1, k / (amp * 0.95));
    ao[i * 3] = ao[i * 3 + 1] = ao[i * 3 + 2] = cav;
    // Outward direction from the face(s) this vertex lies on.
    let dx = Math.abs(vx) > hx - e ? Math.sign(vx) : 0;
    let dz = Math.abs(vz) > hz - e ? Math.sign(vz) : 0;
    let dy = onTop ? 1 : 0;
    if (onTop && o.flatTop) dy = 0;
    if (onBottom) dy = 0;
    // Strata: horizontal banding pushes some rows further out (ledges catch snow).
    const strata = 1 + 0.35 * Math.sin(wy * 2.3 + n1 * 3);
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l;
    dz /= l;
    dy /= l;
    vx += dx * k * strata;
    vz += dz * k * strata;
    if (onTop && !o.flatTop) vy += (o.crest ?? amp) * (n1 * 1.2 + n2 * 0.6);
    else if (!onTop && !onBottom) vy += (n2 - 0.5) * amp * 0.4;
    // Back to world space (the box was built around the origin).
    p.setXYZ(i, vx + cx, vy + cy, vz + cz);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(ao, 3));
  const flat = g.toNonIndexed();
  g.dispose();
  // Drop skipped faces (triangles whose normal points along a skipped axis).
  flat.computeVertexNormals();
  let geo = flat;
  if (o.skip?.length) {
    const pos = flat.attributes.position as THREE.BufferAttribute;
    const nor = flat.attributes.normal as THREE.BufferAttribute;
    const colA = flat.attributes.color as THREE.BufferAttribute;
    const keepP: number[] = [];
    const keepN: number[] = [];
    const keepC: number[] = [];
    for (let i = 0; i < pos.count; i += 3) {
      const nx = nor.getX(i), nz = nor.getZ(i);
      const tag = Math.abs(nx) > 0.8 ? (nx > 0 ? 'x+' : 'x-') : Math.abs(nz) > 0.8 ? (nz > 0 ? 'z+' : 'z-') : '';
      if (tag && o.skip.includes(tag)) continue;
      for (let k = 0; k < 3; k++) {
        keepP.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
        keepN.push(nor.getX(i + k), nor.getY(i + k), nor.getZ(i + k));
        keepC.push(colA.getX(i + k), colA.getY(i + k), colA.getZ(i + k));
      }
    }
    flat.dispose();
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(keepP, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(keepN, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(keepC, 3));
  }
  const col = o.color ?? ROCK;
  const top = y1;
  kit.add('rock', geo, col, {
    vc: true,
    shade: (x, y, z, nx, ny) => {
      let s = 0.55 + 0.45 * smooth01((y - y0) / Math.max(1, h * 0.6));
      if (ny < -0.3) s *= 0.6;
      // Cool, darker lower faces; lighter crests.
      s *= 0.9 + 0.2 * noise3(x * 0.3, y * 0.3, z * 0.3);
      if (y > top - 0.3 && ny > 0.3) s *= 1.1;
      return s;
    },
  });
  if (o.flatTop) {
    // Snow slab on the walkable top (slightly proud, rounded edge).
    kit.add('snow', rbox(x0 - amp * 0.4, y1 - 0.08, z0 - amp * 0.4, x1 + amp * 0.4, y1 + 0.03, z1 + amp * 0.4, 0.1, 2), ENV.snow, { flat: true });
  }
}

function smooth01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** A loose boulder (visual) — faceted icosahedron squashed onto the ground. */
export function boulder(kit: ObsKit, x: number, y: number, z: number, r: number, rnd: () => number, color = ROCK): void {
  // Polyhedron geometries are already non-indexed (every face owns its vertices).
  const g = new THREE.IcosahedronGeometry(r, kit.low ? 0 : 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  const cache = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
    const key = `${px.toFixed(3)},${py.toFixed(3)},${pz.toFixed(3)}`;
    let k = cache.get(key);
    if (k === undefined) cache.set(key, (k = 0.8 + rnd() * 0.4));
    p.setXYZ(i, px * k * 1.2, Math.max(-r * 0.25, py * k * 0.7), pz * k);
  }
  g.rotateY(rnd() * Math.PI);
  g.translate(x, y + r * 0.2, z);
  g.computeVertexNormals();
  kit.add('rock', g, color, { base: y });
}

/** Wind-carved snow drift (visual, low): an elongated half-ellipsoid. */
export function drift(kit: ObsKit, x: number, y: number, z: number, lx: number, lz: number, h: number, rotY = 0): void {
  const g = sphere(0, 0, 0, 1, kit.low ? 8 : 12, kit.low ? 4 : 6, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const yy = p.getY(i);
    p.setXYZ(i, p.getX(i) * lx, Math.max(0, yy) * h - 0.02, p.getZ(i) * lz * (yy < 0 ? 1 : 1));
  }
  g.computeVertexNormals();
  g.rotateY(rotY);
  g.translate(x, y, z);
  kit.add('snow', g, ENV.snow, { flat: true });
}

/** Faint bioluminescent lichen (additive glow decal + a few glowing cushion plants). */
export function lichen(kit: ObsKit, x: number, y: number, z: number, size: number, color: string, rnd: () => number): void {
  kit.add('pool', floorQuad(x, y + 0.03, z, size, size, undefined, rnd() * 3), color, { k: 0.5, flat: true });
  const n = kit.low ? 2 : 4;
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const r = rnd() * size * 0.3;
    kit.add('glow', sphere(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 0.06 + rnd() * 0.08, 6, 4, 0.6), color, { k: 1.6 + rnd(), flat: true });
  }
}

/**
 * Rocky vertical face under a slope: in the plane x = `x`, from z = za (top at ya)
 * to z = zb (top at yb), down to y = -0.5, displaced toward +x·dir.
 */
export function rockFace(kit: ObsKit, x: number, za: number, zb: number, ya: number, yb: number, dir: 1 | -1, amp = 0.3): void {
  const nu = Math.max(2, Math.round(Math.abs(zb - za) / (kit.low ? 1.6 : 1)));
  const nv = kit.low ? 3 : 5;
  const pos: number[] = [];
  const P = (i: number, j: number): [number, number, number] => {
    const u = i / nu;
    const z = za + (zb - za) * u;
    const top = ya + (yb - ya) * u;
    const y = -0.5 + (top + 0.5) * (j / nv);
    const edge = i === 0 || i === nu || j === nv ? 0.3 : 1;
    const n = noise3(x * 0.5, y * 0.6, z * 0.5);
    return [x + dir * amp * (0.2 + 0.8 * n) * edge, y, z];
  };
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      const flip = (dir > 0) !== zb > za;
      if (!flip) pos.push(...a, ...c, ...b, ...a, ...d, ...c);
      else pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  kit.add('rock', g, ROCK, { base: 0 });
}

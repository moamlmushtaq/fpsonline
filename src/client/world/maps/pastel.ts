// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — "Pastel" decor (DecorBuilder).
//
// Halcyon Heights, an abandoned 1970s suburb swallowed by glowing vines, in
// honey-gold late-afternoon light. This module draws everything the collision
// data marks 'hidden' plus all the life around it:
//   ground.ts    streets, lawns, lots, sidewalks, paint, cracks & weeds
//   mall.ts      STARLIGHT MALL — the landmark (vault skylight, flooded atrium)
//   houses.ts    enterable two-storey houses, bungalows, garages, spawn ends
//   props.ts     cars, the crashed soft-serve van, pool, backyards, street kit
//   vines.ts     glowing overgrowth + walk-through vine curtains
//   backdrop.ts  the town beyond, hills, radio mast, birds, the launch rocket
//   signs.ts     one canvas atlas for every sign / poster / screen
//   water.ts     ankle-deep flood water shader
//
// Budget (high): 16 merged static batches + curtains, water, signs (2),
// light shafts (2 each), rocket (~10), birds, beacon — ~50 decor meshes,
// ~200k decor triangles; the whole frame stays ≈ 90 draw calls / 325k tris.
// Medium/high add one unshadowed warm point light in the atrium (the Sunrise
// sculpture "glows"). Low: no shafts, no point light, ~40% props / vines /
// tufts, Lambert materials, half-res atlas, rocket pulled inside the 260 m far
// plane (≈ 47 draw calls / 90k tris).
// Dev only: preview.html?…&t=12&launch=6 previews the Launch Control finale.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { DecorBuilder, DecorContext, MapDecor, MapRuntimeState, ShowcasePose } from '../../contracts';
import { ENV } from '../../engine/palette';
import type { BackdropOptions } from '../map-builder';
import { buildBackdrop } from './pastel/backdrop';
import { buildGround } from './pastel/ground';
import { bungalow, chapel, cornerHouse, dinerAndGas, garageRow, houseLightPools, poolHouse, screenWall, spawnWall, twoStorey } from './pastel/houses';
import { DecorKit, mix, rgb } from './pastel/kit';
import { GAL, buildMall } from './pastel/mall';
import { buildProps } from './pastel/props';
import { SignBatch, signMaterials } from './pastel/signs';
import { buildCurtains, climbingVine, hangingVine } from './pastel/vines';
import { createWaterSurface } from './pastel/water';

/** Default builder backdrop: grassy terrain skirt, no global water plane (the flood is local). */
export const backdrop: BackdropOptions = { kind: 'terrain', tag: 'grass', color: '#aab194', water: false };

const build: DecorBuilder = (ctx: DecorContext): MapDecor => {
  const def = ctx.def;
  const rng = ctx.rng;
  const kit = new DecorKit(ctx);
  const signSet = signMaterials(ctx.materials, kit.low);
  const signs = { board: new SignBatch(), lit: new SignBatch() };

  // ── Static decor ──
  buildGround(kit, rng);
  const mall = buildMall(kit, signs, def.lighting, rng);

  const styles = [
    { wall: rgb(ENV.pastelPink), accent: rgb(ENV.terracotta), shutters: rgb(ENV.sage) },
    { wall: rgb(ENV.pastelMint), accent: rgb(ENV.terracottaFaded), shutters: rgb(ENV.terracottaFaded) },
    { wall: rgb(ENV.pastelYellow), accent: rgb(ENV.terracotta), shutters: rgb(ENV.pastelBlue) },
    { wall: rgb(ENV.pastelBlue), accent: rgb(ENV.terracottaFaded), shutters: rgb(ENV.pastelYellow) },
  ];
  twoStorey(kit, signs, 1, 1, styles[0], rng, true);
  twoStorey(kit, signs, -1, 1, styles[1], rng, false);
  twoStorey(kit, signs, 1, -1, styles[2], rng, false);
  twoStorey(kit, signs, -1, -1, styles[3], rng, true);
  houseLightPools(kit);
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      bungalow(kit, sx, sz, rng);
      garageRow(kit, signs, sx, sz, rng);
    }
  }
  poolHouse(kit, rng);
  cornerHouse(kit, rng);
  for (const sz of [1, -1]) {
    const z0 = Math.min(40 * sz, 40.4 * sz);
    const z1 = Math.max(40 * sz, 40.4 * sz);
    screenWall(kit, signs, -54, -36, z0, z1, 2.8, true);
    screenWall(kit, signs, 36, 54, z0, z1, 2.8, true);
    screenWall(kit, signs, -26, 26, z0, z1, 3.2, false);
    spawnWall(kit, signs, sz, rng);
    screenWall(kit, signs, -29.5, -22, Math.min(6 * sz, 6.4 * sz), Math.max(6 * sz, 6.4 * sz), 2.6, true);
  }
  chapel(kit, signs, rng);
  dinerAndGas(kit, signs, rng);
  buildProps(kit, signs, rng);

  // Glowing vines in the shade: under the vault, along the gallery fascias,
  // on the mall's east (shaded) facade and the garage backs.
  const vaultVines = Math.round(34 * kit.detail);
  for (let i = 0; i < vaultVines; i++) {
    const x = -9 + rng() * 18;
    const z = -10.6 + rng() * 21.2;
    if (Math.abs(z) < 2.4) continue;
    const u = x / 10;
    const y = 8.7 + 3.6 * Math.sqrt(Math.max(0, 1 - u * u)) - 0.1;
    hangingVine(kit, new THREE.Vector3(x, y, z), 2.2 + rng() * 3.4, rng, 1.4);
  }
  for (const s of [1, -1]) {
    for (let z = -10.5; z <= 10.5; z += 1.9) {
      if (Math.abs(z) < 2.4 || rng() < 0.3) continue;
      hangingVine(kit, new THREE.Vector3(10.05 * s, GAL - 0.6, z + rng() * 0.6), 0.8 + rng() * 1.8, rng, 1.2);
    }
    climbingVine(kit, new THREE.Vector3(15.02, 0, 8.4 * s), 7.5, new THREE.Vector3(1, 0, 0), rng, 1.2);
    climbingVine(kit, new THREE.Vector3(15.02, 0, 11 * s), 6.2, new THREE.Vector3(1, 0, 0), rng, 1.0);
    climbingVine(kit, new THREE.Vector3(-8.6, 0, -12.02 * (s > 0 ? 1 : -1)), 6, new THREE.Vector3(0, 0, -1), rng, 1.0);
  }

  // The mall is being reclaimed: ivy up the fluted facades, vines spilling off
  // the roof fascia, shrubs and weeds at its feet.
  for (const s of [1, -1]) {
    for (const x of [-13.2, -9.4, 10.2, 13.6]) climbingVine(kit, new THREE.Vector3(x, 0, 12.18 * s), 4 + rng() * 3.5, new THREE.Vector3(0, 0, s), rng, 1.1);
    for (const z of [-10.5, -7, 7.5, 10.8]) climbingVine(kit, new THREE.Vector3(-15.18, 0, z), 3.5 + rng() * 3.5, new THREE.Vector3(-1, 0, 0), rng, 0.9);
    for (let x = -15.5; x <= 15.5; x += 1.4) {
      if (rng() < 0.45) continue;
      hangingVine(kit, new THREE.Vector3(x, 7.95, 13.25 * s), 0.8 + rng() * 2.6, rng, 1.2);
    }
    for (let z = -12.5; z <= 12.5; z += 1.5) {
      if (Math.abs(z) < 5.5 || rng() < 0.4) continue;
      hangingVine(kit, new THREE.Vector3(16.25, 7.95, z), 0.8 + rng() * 3, rng, 1.2);
    }
    for (const x of [-12.5, -9.8, 9.7, 12.8]) {
      kit.ball('foliage', x, 0.35, 12.9 * s, 1.1 + rng() * 0.4, 0.7, 0.7, mix(rgb(ENV.olive), rgb(ENV.sage), rng()), 1, { drift: 0.2 });
    }
  }

  // Walk-through vine curtains (collision: pool pergolas + back-lot pergolas).
  buildCurtains(
    kit,
    ctx.materials,
    [
      { x0: -47.5, z0: 7.5, x1: -30, z1: 7.5, y0: 0.2, y1: 4.4 },
      { x0: -47.5, z0: -7.5, x1: -30, z1: -7.5, y0: 0.2, y1: 4.4 },
      { x0: -23.9, z0: 27, x1: -23.9, z1: 40, y0: 0.2, y1: 4.4 },
      { x0: 23.9, z0: 27, x1: 23.9, z1: 40, y0: 0.2, y1: 4.4 },
      { x0: -23.9, z0: -40, x1: -23.9, z1: -27, y0: 0.2, y1: 4.4 },
      { x0: 23.9, z0: -40, x1: 23.9, z1: -27, y0: 0.2, y1: 4.4 },
    ],
    rng,
  );

  // Warm bounce in the atrium: the Sunrise sculpture's glowing buds light the
  // flood water, escalators and bridge soffit (one unshadowed point light,
  // medium/high only — Low keeps the look through emissives + bloom).
  if (!kit.low) {
    const bounce = new THREE.PointLight('#ffc98a', 26, 21, 2);
    bounce.position.set(0, 2.3, 0);
    bounce.name = 'pastel.atriumBounce';
    kit.add(bounce);
  }

  const back = buildBackdrop(kit, def, rng);
  const staticCalls = kit.build();

  // Signs (two draws for every painted/lit sign in town).
  if (!signs.board.empty) kit.add(signs.board.build(kit.ownMaterial(signSet.board), 'pastel.signs')).receiveShadow = kit.q.shadows !== 'off';
  if (!signs.lit.empty) kit.add(signs.lit.build(kit.ownMaterial(signSet.lit), 'pastel.neon'));

  // Flood water: the atrium + the rain puddle in the pool's deep end.
  const wy = def.waterY ?? -0.2;
  const atrium = new THREE.PlaneGeometry(29, 23, 1, 1);
  atrium.rotateX(-Math.PI / 2);
  atrium.translate(0, wy, 0);
  const puddle = new THREE.CircleGeometry(1, kit.low ? 14 : 24);
  puddle.rotateX(-Math.PI / 2);
  puddle.scale(2.5, 1, 3.2);
  puddle.translate(-42, -1.175, -0.6);
  const waterGeo = kit.ownGeometry(mergeTwo(atrium, puddle));
  const water = kit.add(createWaterSurface(def.lighting, waterGeo, 0, 0.82));
  const waterMat = water.material as THREE.ShaderMaterial;
  kit.ownMaterial(waterMat);

  if (import.meta.env?.DEV) {
    const tris: Record<string, number> = {};
    let meshes = 0;
    ctx.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints) meshes++;
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const g = m.geometry;
      const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
      const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
      tris[m.name || 'unnamed'] = (tris[m.name || 'unnamed'] ?? 0) + Math.round(n * inst);
    });
    (window as unknown as { __pastelDecor?: unknown }).__pastelDecor = { staticCalls, meshes, shafts: mall.shafts.length, tris, total: Object.values(tris).reduce((a, b) => a + b, 0) };
  }

  // Outro frames the launch over the town: aim ~52 m (× scale) up the rocket so
  // the whole 7 s climb and pitch-over stays in frame.
  const rocketTarget = (): THREE.Vector3 => {
    const p = back.rocket.root.position;
    return new THREE.Vector3(p.x, p.y + 52 * back.rocket.root.scale.x, p.z);
  };

  return {
    update(dt: number, s: MapRuntimeState): void {
      kit.time.value = s.time;
      waterMat.uniforms.uTime.value = s.time;
      back.update(dt, s);
    },
    showcase(kind): ShowcasePose | undefined {
      // Key art: the STARLIGHT pylon and the sun-struck south facade (sunburst
      // mural, glass vault, rooftop letters) with long golden shadows.
      if (kind === 'keyart') return { pos: { x: 16, y: 1.8, z: 33 }, target: { x: -16, y: 8.5, z: 0 }, fov: 60 };
      // Intro: the whole suburb from the south-east, rocket on the horizon.
      if (kind === 'intro') return { pos: { x: 50, y: 30, z: 56 }, target: { x: -8, y: 2, z: -8 }, fov: 58 };
      const t = rocketTarget();
      return { pos: { x: -6, y: 14, z: 30 }, target: { x: t.x, y: t.y, z: t.z }, fov: 56 };
    },
    dispose(): void {
      back.dispose();
      kit.dispose();
    },
  };
};

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const A = a.index ? a.toNonIndexed() : a;
  const B = b.index ? b.toNonIndexed() : b;
  const pa = A.attributes.position.array as ArrayLike<number>;
  const pb = B.attributes.position.array as ArrayLike<number>;
  const pos = new Float32Array(pa.length + pb.length);
  pos.set(pa, 0);
  pos.set(pb, pa.length);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeBoundingSphere();
  for (const x of [a, b, A, B]) x.dispose();
  return g;
}

export default build;

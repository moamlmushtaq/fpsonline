// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Training Range decor (small reference example of the
// DecorBuilder API). Shows the recommended patterns:
//  • build props from shared library materials, batch static pieces per
//    material with mergeGeometries (few draw calls);
//  • world-scale UVs via boxProjectUVs so textures match the map builder;
//  • canvas textures for signage (materials.canvasTexture, cached by key);
//  • glow() plants in the shade, light shafts only when quality allows;
//  • scale optional detail with quality.decor; animate in update().
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DecorBuilder, MapDecor } from '../../contracts';
import { createLightShaft } from '../../engine/atmosphere';
import { boxProjectUVs } from '../../engine/materials';
import { ENV } from '../../engine/palette';

const build: DecorBuilder = (ctx) => {
  const { root, materials, quality, rng, def } = ctx;
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const put = (mat: THREE.Material, g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, tex: Parameters<typeof boxProjectUVs>[1] = 'concrete'): void => {
    const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
    const gg = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m);
    boxProjectUVs(gg, tex);
    const list = batches.get(mat) ?? [];
    list.push(gg);
    batches.set(mat, list);
    g.dispose();
  };

  // Canvas distance boards at each target row.
  const metal = materials.surface('metal', { color: ENV.metalDark });
  const wood = materials.surface('wood');
  for (const [dist, z] of [[10, -10], [25, -25], [50, -50], [75, -75]] as const) {
    const tex = materials.canvasTexture(`range.board.${dist}`, 128, 64, (x, w, h) => {
      x.fillStyle = ENV.bone;
      x.fillRect(0, 0, w, h);
      x.strokeStyle = '#3a3632';
      x.lineWidth = 4;
      x.strokeRect(4, 4, w - 8, h - 8);
      x.fillStyle = '#3a3632';
      x.font = '700 34px "JetBrains Mono", ui-monospace, monospace';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(`${dist}m`, w / 2, h / 2 + 2);
    });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    for (const side of [-1, 1]) {
      const b = board.clone();
      b.position.set(side * 13.6, 1.6, z);
      b.rotation.y = side < 0 ? Math.PI / 2 - 0.35 : -Math.PI / 2 + 0.35;
      root.add(b);
      put(metal, new THREE.BoxGeometry(0.08, 1.3, 0.08), side * 13.6, 0.65, z + 0.02, 0, 'metal');
    }
  }

  // Shade canopy over the firing line (sun-bleached fabric on a timber frame).
  const canvas = materials.surface('fabric', { color: ENV.pastelYellow });
  for (const x of [-9.5, 9.5]) for (const z of [-1.2, 1.6]) put(wood, new THREE.BoxGeometry(0.14, 3.2, 0.14), x, 1.6, z, 0, 'wood');
  const canopy = new THREE.BoxGeometry(20, 0.06, 3.4);
  put(canvas, canopy, 0, 3.22, 0.2, 0, 'fabric');

  // Sandbag walls at the ends of the counter (count scales with decor density).
  const sand = materials.surface('fabric', { color: ENV.sand });
  const bags = Math.max(4, Math.round(12 * quality.decor));
  for (let i = 0; i < bags; i++) {
    const side = i % 2 ? -1 : 1;
    const row = Math.floor(i / 2);
    const g = new THREE.CapsuleGeometry(0.16, 0.4, 3, 8).rotateZ(Math.PI / 2).scale(1, 0.8, 1);
    put(sand, g, side * (11.2 + (row % 3) * 0.05), 0.14 + Math.floor(row / 3) * 0.24, -0.4 + (row % 3) * 0.62 + rng() * 0.05, 0, 'fabric');
  }

  // A radio on a crate by the audio emitter (a little environmental story).
  const radioPos = def.audio.emitters.find((e) => e.kind === 'radio')?.pos ?? { x: 12, y: 1, z: 12 };
  put(wood, new THREE.BoxGeometry(0.9, 0.7, 0.6), radioPos.x, 0.35, radioPos.z, 0.3, 'wood');
  const radio = new THREE.Group();
  radio.position.set(radioPos.x, 0.7, radioPos.z);
  radio.rotation.y = 0.3 + Math.PI;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.16), materials.painted(ENV.terracottaFaded, { roughness: 0.5 }));
  body.position.y = 0.12;
  const dial = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), materials.glow(ENV.glowGold, 1.6));
  dial.position.set(0.11, 0.13, 0.081);
  const grille = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.14), materials.painted(ENV.shadowWarm, { roughness: 0.9 }));
  grille.position.set(-0.08, 0.12, 0.081);
  radio.add(body, dial, grille);
  root.add(radio);

  // Bioluminescent sprouts in the shaded west corner (chartreuse / gold, never teal).
  const glowA = materials.glow(ENV.glowChartreuse, 2.4);
  const stem = materials.painted(ENV.olive, { roughness: 0.9 });
  const sprouts = Math.round(14 * quality.decor);
  for (let i = 0; i < sprouts; i++) {
    const x = -14.4 + rng() * 1.2;
    const z = 6 - rng() * 40;
    const h = 0.25 + rng() * 0.5;
    put(stem, new THREE.CylinderGeometry(0.015, 0.025, h, 5).translate(0, h / 2, 0), x, 0, z, 0, 'foliage');
    put(glowA, new THREE.SphereGeometry(0.05 + rng() * 0.04, 8, 6), x, h, z, 0, 'foliage');
  }

  // Merge every batch into one mesh per material.
  for (const [mat, list] of batches) {
    const g = mergeGeometries(list, false);
    for (const x of list) x.dispose();
    if (!g) continue;
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = quality.shadows !== 'off' && mat !== glowA;
    mesh.receiveShadow = quality.shadows !== 'off';
    root.add(mesh);
  }

  // A soft dusty light shaft through the canopy gap (high preset only).
  if (quality.lightShafts) {
    const s = def.lighting.sunDir;
    root.add(createLightShaft({ pos: { x: -6, y: 3.3, z: 0.4 }, dir: { x: -s.x, y: -s.y, z: -s.z }, length: 5.5, radius: 0.9, color: ENV.glowGold, intensity: 0.8 }));
  }

  let t = 0;
  const decor: MapDecor = {
    update(dt) {
      t += dt;
      // The radio dial flickers gently.
      dial.scale.setScalar(0.92 + Math.sin(t * 7.3) * 0.04 + Math.sin(t * 2.1) * 0.04);
    },
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    },
  };
  return decor;
};

export default build;

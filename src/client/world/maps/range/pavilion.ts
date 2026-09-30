// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Training Range: the firing-line pavilion + armory corner.
//
// A 1970s ceramic-shell canopy (six shallow barrel vaults on slim columns
// with ceramic capitals) over a timber shooting counter with ceramic caps and
// stall fins, numbered bays, painted floor lines. The armory corner holds the
// weapon rack (real weapon models, brass nameplates), the RESET and TARGET
// SPEED consoles, a radio on the rack, a lunchbox by bay 5 and a wind chime.
// Returns the animated bits (radio dial, speed needle, chimes).
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { ENV, UI } from '../../../engine/palette';
import { RANGE_COURSE } from '../../../../shared/maps/range';
import { PRIMARY_WEAPON_IDS } from '../../../../shared/types';
import { WeaponModels } from '../../weapon-models';
import type { MaterialLibrary } from '../../../contracts';
import { rgb, type RangeKit } from './kit';
import type { SignAtlas } from './signs';

const C = RANGE_COURSE;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface PavilionAnim {
  update(dt: number, t: number): void;
  dispose(): void;
}

export function buildPavilion(k: RangeKit, signs: SignAtlas, lib: MaterialLibrary): PavilionAnim {
  const bone = rgb(ENV.bone);
  const boneShade = rgb(ENV.boneShade);
  const terra = rgb(ENV.terracottaFaded);
  const terraDeep = rgb(ENV.terracotta, 0.9);
  const ink = rgb(ENV.shadowWarm);
  const wood = rgb('#b98c5e');
  const metal = rgb(ENV.metalDark);
  const x0 = -19.4;
  const x1 = 4.2;
  const zF = -1.6;
  const zB = 9.6;

  // ── Canopy: six shallow ceramic barrel vaults ──
  const nV = 6;
  const vw = (x1 - x0) / nV;
  const R = vw / 2;
  const shell = k.cached(`vault|${R.toFixed(3)}`, () => {
    const s = new THREE.Shape();
    const segs = 18;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI;
      s.lineTo(Math.cos(a) * R, Math.sin(a) * R);
    }
    for (let i = segs; i >= 0; i--) {
      const a = (i / segs) * Math.PI;
      s.lineTo(Math.cos(a) * (R - 0.07), Math.sin(a) * (R - 0.07));
    }
    return new THREE.ExtrudeGeometry(s, { depth: zB - zF, bevelEnabled: false, curveSegments: 1 });
  });
  for (let i = 0; i < nV; i++) {
    const cx = x0 + vw * (i + 0.5);
    k.place('ceramic', shell, V(cx, 3.62, zF), new THREE.Euler(0, 0, 0), V(1, 0.42, 1), i % 2 ? bone : rgb(ENV.bone, 0.97), { drift: 0.05 });
    // Gutter between vaults.
    if (i > 0) k.box('ceramic', x0 + vw * i - 0.12, 3.52, zF, x0 + vw * i + 0.12, 3.7, zB, boneShade, 0.05);
  }
  // Fascia beams (front + back) with a faded terracotta band.
  k.box('ceramic', x0, 3.34, zF - 0.16, x1, 3.72, zF + 0.16, bone, 0.08);
  k.box('paint', x0, 3.42, zF - 0.175, x1, 3.5, zF - 0.16, terra);
  k.box('ceramic', x0, 3.34, zB - 0.16, x1, 3.72, zB + 0.16, bone, 0.08);
  signs.board('firingline', V(-7.6, 3.53, zF - 0.18), Math.PI, 0.3);
  signs.board('firingline', V(-7.6, 3.53, zF + 0.18), 0, 0.3);
  // Bay plaques hanging under the front fascia (facing the shooters).
  for (let b = 0; b < 6; b++) {
    const bx = -15.5 + b * 3;
    k.tube('trim', V(bx, 3.34, zF + 0.1), V(bx, 3.08, zF + 0.1), 0.012, metal, 5);
    signs.backed(k, `bay.${b + 1}`, V(bx, 2.92, zF + 0.1), 0, 0.3, terra, 0.03);
  }

  // ── Columns: ceramic capitals + plinths over the builder's pillars ──
  for (const cx of [-17.6, -11.2, -4.8, 1.6]) {
    for (const cz of [9.08, -0.82]) {
      if (cz < 0 && cx !== -17.6 && cx !== 1.6) continue;
      k.box('ceramic', cx - 0.3, 3.36, cz - 0.3, cx + 0.3, 3.56, cz + 0.3, bone, 0.06);
      k.box('ceramic', cx - 0.26, 0, cz - 0.26, cx + 0.26, 0.28, cz + 0.26, boneShade, 0.05);
    }
  }

  // ── Counter dressing: ceramic cap, stall fins, spent casings tray ──
  k.box('ceramic', -17.08, 1.0, -0.66, 1.08, 1.09, 0.06, bone, 0.035);
  k.box('paint', -17.02, 0.78, 0.005, 1.02, 0.84, 0.02, terraDeep);
  for (let b = 1; b < 6; b++) {
    const fx = -17 + b * 3;
    k.box('ceramic', fx - 0.025, 1.09, -0.6, fx + 0.025, 1.36, -0.12, bone, 0.02);
  }
  for (let b = 0; b < 6; b++) k.box('trim', -15.9 + b * 3, 1.09, -0.5, -15.1 + b * 3, 1.13, -0.2, metal);

  // Shooter's side of the counter: ceramic kick band, a low shelf with ammo tins.
  k.box('ceramic', -17.02, 0, 0, 1.02, 0.16, 0.05, boneShade, 0.02);
  k.box('wood', -17, 0.5, 0, 1, 0.55, 0.3, wood, 0.01);
  for (let b = 0; b < 6; b++) {
    const bx = -16.2 + b * 3;
    k.cyl('trim', bx, 0.55, 0.16, 0.07, 0.07, 0.16, metal, 10);
    k.cyl('paint', bx + 0.22, 0.55, 0.14, 0.06, 0.06, 0.12, terraDeep, 10);
  }

  // ── Floor paint: stall lines + the "stand behind" line ──
  for (let b = 0; b <= 6; b++) k.slab('paint', -17.04 + b * 3, 0.05, -16.96 + b * 3, 2.4, 0.012, rgb(ENV.bone, 0.92), { drift: 0.25 });
  k.slab('paint', -17, 2.72, 1, 2.84, 0.012, terra, { drift: 0.3 });

  // ── Armory: weapon rack ──
  k.box('ceramic', -18.8, 0, 7.4, -14.4, 1.35, 8.0, bone, 0.06);
  k.box('wood', -18.86, 1.35, 7.36, -14.34, 1.43, 8.04, wood, 0.02);
  k.box('paint', -18.8, 0, 7.36, -14.4, 0.12, 7.4, terraDeep);
  const weapons = new WeaponModels(lib);
  const rackRoot = k.add(new THREE.Group());
  rackRoot.name = 'range.rack';
  const models: { dispose(): void }[] = [];
  C.rackSlots.forEach((s, i) => {
    k.box('paint', s.x - 0.46, 0.18, 7.37, s.x + 0.46, 1.2, 7.4, rgb(ENV.terracottaFaded, 0.62));
    k.box('trim', s.x - 0.3, 0.2, 7.26, s.x + 0.3, 0.26, 7.4, metal);
    signs.board(`rack.${i}`, V(s.x, 1.27, 7.395), Math.PI, 0.1);
    try {
      const w = weapons.create(PRIMARY_WEAPON_IDS[i], 'factory', 'world');
      w.root.rotation.order = 'YXZ';
      w.root.rotation.set(Math.PI / 2 - 0.16, Math.PI / 2, 0);
      w.root.position.set(s.x, 0.62, 7.2);
      w.root.traverse((o) => {
        o.castShadow = k.q.shadows !== 'off';
      });
      rackRoot.add(w.root);
      models.push(w);
    } catch (err) {
      console.warn('[range] rack weapon model failed', err);
    }
  });
  signs.backed(k, 'armory', V(-16.6, 2.55, 7.7), Math.PI, 0.4, bone);
  k.tube('trim', V(-17.6, 3.5, 7.7), V(-17.6, 2.76, 7.7), 0.012, metal, 5);
  k.tube('trim', V(-15.6, 3.5, 7.7), V(-15.6, 2.76, 7.7), 0.012, metal, 5);

  // ── Consoles (reset / target speed): ceramic pedestals with sloped panels ──
  const consoleAt = (cx: number, label: string): void => {
    k.box('ceramic', cx - 0.6, 0, 7.4, cx + 0.6, 0.9, 8.0, bone, 0.08);
    k.box('paint', cx - 0.62, 0, 7.38, cx + 0.62, 0.1, 8.02, terraDeep);
    k.place('paint', k.cached('box', () => new THREE.BoxGeometry(1, 1, 1)), V(cx, 0.99, 7.68), new THREE.Euler(-0.5, 0, 0), V(1.12, 0.06, 0.62), ink);
    signs.board(label, V(cx, 0.62, 7.385), Math.PI, 0.2);
  };
  consoleAt(C.resetStation.x, 'console.reset');
  consoleAt(C.speedStation.x, 'console.speed');
  // Reset: big amber push button; speed: bone dial face.
  const cyl = k.cached('ccyl', () => new THREE.CylinderGeometry(1, 1, 1, 20));
  k.place('glow', cyl, V(C.resetStation.x, 1.045, 7.64), new THREE.Euler(-0.5, 0, 0), V(0.13, 0.05, 0.13), rgb(UI.accent, 1.6));
  k.place('ceramic', cyl, V(C.speedStation.x, 1.03, 7.66), new THREE.Euler(-0.5, 0, 0), V(0.2, 0.03, 0.2), bone);
  const needleMat = k.own(new THREE.MeshBasicMaterial({ color: new THREE.Color(ENV.terracotta) }));
  const needleGeo = k.own(new THREE.BoxGeometry(0.018, 0.01, 0.17).translate(0, 0, -0.07));
  const needle = k.add(new THREE.Mesh(needleGeo, needleMat));
  const needlePivot = new THREE.Group();
  needlePivot.position.set(C.speedStation.x, 1.05, 7.665);
  needlePivot.rotation.x = -0.5;
  k.add(needlePivot);
  needlePivot.add(needle);
  needle.position.set(0, 0.01, 0);

  // ── Radio on the rack (the audio emitter), lunchbox + thermos by bay 5 ──
  const radio = new THREE.Group();
  radio.position.set(-15.1, 1.43, 7.72);
  radio.rotation.y = 0.25;
  const rBody = new THREE.Mesh(k.cached('rbody', () => new THREE.BoxGeometry(0.44, 0.25, 0.17)), lib.painted(ENV.terracottaFaded, { roughness: 0.5 }));
  rBody.position.y = 0.125;
  const dialMat = lib.glow(ENV.glowGold, 1.7);
  const dial = new THREE.Mesh(k.cached('rdial', () => new THREE.CircleGeometry(0.05, 16)), dialMat);
  dial.position.set(0.12, 0.13, 0.086);
  const grille = new THREE.Mesh(k.cached('rgrille', () => new THREE.PlaneGeometry(0.17, 0.15)), lib.painted(ENV.shadowWarm, { roughness: 0.9 }));
  grille.position.set(-0.08, 0.125, 0.086);
  radio.add(rBody, dial, grille);
  k.add(radio);
  k.tube('trim', V(-15.26, 1.68, 7.7), V(-15.5, 2.05, 7.66), 0.006, metal, 4);
  k.box('paint', -3.62, 1.09, -0.5, -3.3, 1.28, -0.28, rgb(ENV.sage), 0.03);
  k.box('trim', -3.52, 1.28, -0.4, -3.4, 1.31, -0.38, metal);
  k.cyl('paint', -3.05, 1.09, -0.36, 0.055, 0.06, 0.3, terraDeep, 12);
  k.cyl('trim', -3.05, 1.39, -0.36, 0.045, 0.045, 0.05, metal, 10);
  k.box('paint', -9.9, 1.09, -0.52, -9.6, 1.1, -0.1, bone);
  k.box('trim', -9.88, 1.1, -0.2, -9.62, 1.12, -0.12, metal);

  // ── Ammo crates at the east end (collision in the map data) ──
  for (const [cx, cz, h, r] of [
    [2.9, 6.8, 0.5, 0.1],
    [3.55, 7.1, 0.5, -0.06],
    [3.1, 7.9, 0.5, 0.2],
    [3.2, 7.3, 1.0, 0.05],
  ] as const) {
    k.boxR('wood', cx, h - 0.25, cz, 0.75, 0.5, 0.52, r, wood, 0.03);
    k.boxR('paint', cx, h - 0.25, cz + 0.261 * Math.cos(r), 0.5, 0.12, 0.01, r, terraDeep);
  }
  k.box('fabric', 2.5, 0.95, 6.35, 3.95, 1.02, 8.3, rgb(ENV.sage, 0.85), 0.05);

  // ── Wind chime hanging from the canopy's east corner ──
  const chime = new THREE.Group();
  chime.position.set(3.4, 3.3, 8.6);
  const chimeMat = lib.painted(ENV.metalLight, { roughness: 0.3, metalness: 0.6 });
  const tubes: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const len = 0.32 + i * 0.06;
    const m = new THREE.Mesh(k.cached(`chime${i}`, () => new THREE.CylinderGeometry(0.012, 0.012, len, 6).translate(0, -len / 2, 0)), chimeMat);
    m.position.set(Math.cos((i / 5) * Math.PI * 2) * 0.09, -0.12, Math.sin((i / 5) * Math.PI * 2) * 0.09);
    chime.add(m);
    tubes.push(m);
  }
  const disc = new THREE.Mesh(k.cached('chimedisc', () => new THREE.CylinderGeometry(0.13, 0.13, 0.025, 14)), lib.painted(ENV.terracottaFaded));
  disc.position.y = -0.1;
  chime.add(disc);
  k.add(chime);
  k.tube('trim', V(3.4, 3.62, 8.6), V(3.4, 3.2, 8.6), 0.006, metal, 4);

  // ── Posters on the back wall (turn around: a little story) ──
  signs.board('poster.safety', V(-14.8, 1.55, 11.98), Math.PI, 1.2);
  signs.board('poster.pilot', V(-13.7, 1.55, 11.98), Math.PI, 1.2);
  signs.board('poster.schedule', V(-2.2, 1.55, 11.98), Math.PI, 1.2);

  return {
    update(_dt, t) {
      dial.scale.setScalar(0.92 + Math.sin(t * 7.3) * 0.04 + Math.sin(t * 2.1) * 0.04);
      needle.rotation.y = -0.6 + Math.sin(t * 0.7) * 0.05 + Math.sin(t * 5.1) * 0.012;
      chime.rotation.z = Math.sin(t * 1.3) * 0.05;
      chime.rotation.x = Math.sin(t * 0.9 + 1) * 0.04;
      for (let i = 0; i < tubes.length; i++) tubes[i].rotation.z = Math.sin(t * 2.2 + i * 1.7) * 0.07;
    },
    dispose() {
      for (const m of models) m.dispose();
    },
  };
}

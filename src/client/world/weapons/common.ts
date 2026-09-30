// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — shared weapon components (1970s industrial-design kit):
// knurled pistol grips, trigger groups, analog dials with a live needle, the
// amber ammo-screen pod, exposed screws, vent slots and printed labels.
// Coordinates: weapon space, origin at the top of the pistol grip, muzzle −Z,
// +Y up; the player sees the LEFT (−X) side and the top in first person, so
// dials, screens and labels live there.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { F } from './surface';
import { REGION, labelRegion } from './surface';
import { Build, cylX, cylY, cylZ, decalDisc, decalPlane, profile, rbox, sphere, torusZ, type PP } from './kit';

/**
 * Raked pistol grip whose top-front corner sits at forward distance `u`, height
 * `v`. Sets the right-hand anchor (palm centre on the grip axis, +Y up the
 * grip, −Z toward the front strap).
 */
export function pistolGrip(b: Build, key: string, u: number, v: number, o: { len?: number; rake?: number; depth?: number; width?: number; fin?: number; cap?: number } = {}): void {
  const L = o.len ?? 0.115;
  const t = Math.tan(o.rake ?? 0.3);
  const d = o.depth ?? 0.046;
  const w = o.width ?? 0.032;
  const pts: PP[] = [
    [u, v, 0.004],
    [u - L * t + 0.004, v - L * 0.55, 0.03],
    [u - L * t, v - L, 0.012],
    [u - L * t - d, v - L + 0.004, 0.014],
    [u - d - 0.004 - L * 0.35 * t, v - L * 0.35, 0.03],
    [u - d - 0.012, v + 0.004, 0.012],
  ];
  b.add(b.root, `${key}.grip`, profile(pts, w, w * 0.4), o.fin ?? F.rubber);
  // Knurled side panels (printed) + an enamel cap.
  const cu = u - L * 0.5 * t - d * 0.48, cv = v - L * 0.52;
  for (const s of [-1, 1]) b.decal(b.root, `${key}.knurl`, decalPlane(d * 0.62, L * 0.62, REGION.knurl), (s * w) / 2 + s * 0.0004, cv, -cu, -(o.rake ?? 0.3), (s * Math.PI) / 2, 0);
  b.add(b.root, `${key}.gripCap`, rbox(w + 0.004, 0.012, d + 0.006, 0.005), o.cap ?? F.accent, 0, v - L - 0.001, -(u - L * t - d * 0.5), o.rake ?? 0.3, 0, 0, { mid: true });
  b.handR.position.set(0, v - L * 0.45, -(u - L * 0.45 * t - d * 0.5));
  b.handR.rotation.set(-(o.rake ?? 0.3), 0, 0);
  b.meta.gripR = Math.max(w, d) * 0.5;
}

/** Trigger guard loop + trigger blade in front of a grip at (u, v). */
export function triggerGroup(b: Build, key: string, u: number, v: number, len = 0.072, fin: number = F.dark): void {
  if (!b.hi) {
    // Third person: two bars + a blade read the same at distance (~40 tris instead of ~270).
    b.add(b.root, `${key}.guardBar`, rbox(0.012, 0.007, len + 0.006, 0.002), fin, 0, v - 0.047, -(u + len * 0.5));
    b.add(b.root, `${key}.guardFront`, rbox(0.012, 0.05, 0.008, 0.002), fin, 0, v - 0.023, -(u + len));
    b.add(b.root, `${key}.triggerBox`, rbox(0.007, 0.026, 0.008, 0.002), F.steel, 0, v - 0.016, -(u + 0.03), 0.3, 0, 0);
    return;
  }
  b.add(
    b.root,
    `${key}.guard`,
    profile(
      [[u + len, v + 0.004, 0], [u + len + 0.004, v - 0.046, 0.02], [u - 0.004, v - 0.05, 0.012], [u - 0.004, v, 0]],
      0.012,
      0.004,
      [[[u + len - 0.009, v - 0.006, 0.004], [u + len - 0.008, v - 0.037, 0.012], [u + 0.005, v - 0.04, 0.008], [u + 0.005, v - 0.006, 0.004]]],
    ),
    fin,
  );
  b.add(b.root, `${key}.trigger`, profile([[u + 0.036, v, 0.002], [u + 0.034, v - 0.02, 0.006], [u + 0.022, v - 0.03, 0.004], [u + 0.026, v - 0.012, 0.004], [u + 0.024, v, 0.002]], 0.007, 0.0025), F.steel);
}

/** Slotted cheese-head screw facing −X (left side) or any axis via ry. */
export function screw(b: Build, parent: THREE.Object3D, x: number, y: number, z: number, ry = 0, r = 0.0032): void {
  if (!b.hi) return;
  const n = b.node(parent, 'screw', x, y, z, 0, ry, 0);
  b.add(n, `screw${r}`, cylX(r, 0.0022, 10), F.steel, 0, 0, 0);
  b.add(n, `screwSlot${r}`, rbox(0.001, 0.0008, r * 1.7, 0.0003), F.dark, -0.0012, 0, 0, 0.6, 0, 0);
}

/** Row of vent slots sunk into a flat side wall at signed surface x (stacked downward). */
export function ventSlots(b: Build, parent: THREE.Object3D, key: string, xSurface: number, y: number, z: number, n: number, pitch: number, len: number, h = 0.007): void {
  const x = xSurface - Math.sign(xSurface) * 0.0026;
  for (let i = 0; i < n; i++) b.add(parent, `${key}.slot`, rbox(0.006, h, len, h * 0.48), F.rubber, x, y - i * pitch, z, 0, 0, 0, { ao: 0.45, mid: true });
}

/**
 * Analog dial: bezel ring, printed face, live needle (first person) and a
 * small domed pivot. The face normal is +Z of the node, rotated by ry
 * (−π/2 = facing the player's side).
 */
export function dial(b: Build, parent: THREE.Object3D, x: number, y: number, z: number, r: number, ry = -Math.PI / 2, charge = false, bezel: number = F.metal): void {
  const n = b.node(parent, 'dialHousing', x, y, z, 0, ry, 0);
  b.add(n, `dialBack${r}`, cylZ(r * 1.12, r * 1.18, 0.006, 24), F.dark, 0, 0, -0.002);
  b.add(n, `dialBezel${r}`, torusZ(r * 1.02, r * 0.14, Math.PI * 2, 32), bezel, 0, 0, 0.0015);
  if (b.hi) {
    b.decal(n, `dialFace${r}${charge ? 'c' : 'a'}`, decalDisc(r * 0.98, charge ? REGION.dialCharge : REGION.dialAmmo), 0, 0, 0.0016);
    const needle = b.part(n, 'dialNeedle', 0, 0, 0.0024);
    b.add(needle, `needle${r}`, rbox(Math.max(0.0014, r * 0.09), r * 0.86, 0.0012, 0.0005), charge ? F.gold : F.accent, 0, r * 0.36, 0);
    b.add(needle, `needlePivot${r}`, sphere(r * 0.12, 10), F.steel, 0, 0, 0.0006);
    needle.rotation.z = Math.PI * 0.75;
    b.needle = needle;
    b.parts.dial = needle;
  } else {
    b.add(n, `dialFaceFlat${r}`, cylZ(r * 0.98, r * 0.98, 0.002, 16), charge ? F.dark : F.cream, 0, 0, 0.001);
  }
}

/**
 * Ammo-screen pod: a dark bezel with a glass lip; first person gets a live
 * canvas screen (set up by the instance), third person a static amber glow.
 */
export function screenPod(b: Build, parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, rx: number, ry: number, rz = 0, depth = 0.026): void {
  podBody(b, b.node(parent, 'screenPod', x, y, z, rx, ry, rz), w, h, depth);
}

/**
 * Instrument panel aligned with the weapon axis (edges parallel to the bore,
 * so it reads as designed-in): the face is rolled `roll` rad from "up" toward
 * the player's side (−X) about the bore, and tilted `back` rad from "up"
 * toward the eye (+Z). back ≈ 1.3 = a dashboard facing the shooter.
 */
export function screenPanel(b: Build, parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, roll: number, back: number, depth = 0.022): void {
  const node = b.node(parent, 'screenPanel', x, y, z);
  _pn.set(-Math.sin(roll) * Math.cos(back), Math.cos(roll) * Math.cos(back), Math.sin(back));
  // Text runs toward screen-right as the shooter sees it: +X on top faces,
  // +Z (toward the eye, like the side labels) on side walls, blended between.
  const s = Math.min(1, Math.max(0, roll / (Math.PI / 2)));
  _pr.set(1 - s, 0, s * 1.4).normalize();
  _pr.addScaledVector(_pn, -_pr.dot(_pn)).normalize();
  _pu.crossVectors(_pn, _pr);
  node.quaternion.setFromRotationMatrix(_pb.makeBasis(_pr, _pu, _pn));
  podBody(b, node, w, h, depth);
}

const _pn = new THREE.Vector3();
const _pr = new THREE.Vector3();
const _pu = new THREE.Vector3();
const _pb = new THREE.Matrix4();

function podBody(b: Build, n: THREE.Object3D, w: number, h: number, depth: number): void {
  // A deep housing whose back half sinks into the body, so the instrument reads
  // as molded into the shell (not a card stuck on it), with a small sun hood.
  b.add(n, `screenHousing${w}x${h}d${depth}`, rbox(w + 0.009, h + 0.009, depth, 0.004), F.dark, 0, 0, 0.001 - depth / 2);
  b.add(n, `screenHood${w}`, rbox(w + 0.009, 0.0032, 0.01, 0.0014), F.dark, 0, h / 2 + 0.0036, 0.0035, -0.42, 0, 0, { mid: true });
  b.add(n, `screenLip${w}x${h}`, rbox(w + 0.004, h + 0.004, 0.003, 0.0012), F.glass, 0, 0, 0.0008, 0, 0, 0, { view: true });
  if (b.hi) {
    const s = b.node(n, 'screen', 0, 0, 0.0026);
    b.screen = { node: s, w, h };
  } else {
    b.add(n, `screenGlow${w}x${h}`, rbox(w, h, 0.003, 0.001), F.amber, 0, 0, 0.0008);
  }
}

/** Printed model label (first person) on a side wall facing −X. */
export function label(b: Build, parent: THREE.Object3D, x: number, y: number, z: number, w: number, ry = -Math.PI / 2): void {
  const r = labelRegion(b.id);
  b.decal(parent, `label.${b.id}${w}`, decalPlane(w, (w * r[3]) / r[2], r), x, y, z, 0, ry, 0);
}

/** Small printed decal on a −X wall. */
export function sideDecal(b: Build, parent: THREE.Object3D, key: string, region: [number, number, number, number], x: number, y: number, z: number, w: number, ry = -Math.PI / 2, rz = 0): void {
  b.decal(parent, `${key}${w}`, decalPlane(w, (w * region[3]) / region[2], region), x, y, z, 0, ry, rz);
}

/** Sling loop (steel ring on a small lug). */
export function slingLoop(b: Build, parent: THREE.Object3D, x: number, y: number, z: number): void {
  b.add(parent, 'slingLug', rbox(0.01, 0.01, 0.016, 0.003), F.dark, x, y, z, 0, 0, 0, { mid: true });
  b.add(parent, 'slingRing', torusZ(0.009, 0.0018, Math.PI * 2, 16), F.steel, x, y - 0.01, z, 0, Math.PI / 2, 0, { view: true });
}

/** Cartridge / shell (hull + brass base) along +Y. */
export function shellY(b: Build, parent: THREE.Object3D, key: string, x: number, y: number, z: number, hull: number = F.hull, rx = 0, rz = 0): void {
  const n = b.node(parent, `${key}.shell`, x, y, z, rx, 0, rz);
  b.add(n, 'shellHull', cylY(0.0104, 0.0104, 0.05, 12), hull, 0, 0.012, 0);
  b.add(n, 'shellBase', cylY(0.0112, 0.0112, 0.012, 12), F.brass, 0, -0.019, 0, 0, 0, 0, { mid: true });
  b.add(n, 'shellCrimp', cylY(0.0082, 0.0104, 0.004, 12), hull, 0, 0.039, 0, 0, 0, 0, { view: true });
}

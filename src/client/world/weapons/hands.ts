// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — first-person gloves (fabric + ceramic knuckle plates, a
// team-colored cuff stripe) and the throwable canisters.
//
// Templates (each merged into ONE mesh, all sharing one finish material):
//   gripR   right fist around a vertical bar (pistol grip): bar axis +Y,
//           front strap −Z, back of the hand +X
//   gripL   the same, mirrored (vertical foregrips, magazines, pistol support)
//   support left hand under a horizontal bar (handguard / pump): bar axis Z,
//           palm below, fingers wrap the right side, thumb along the left
// Forearms (sleeve + ceramic bracer) are baked into each template so a hand
// costs one draw call; they run off-screen toward the elbows.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { ThrowableId, WeaponId } from '../../../shared/types';
import { DANGER_COLOR, ENV } from '../../engine/palette';
import { Build, capsuleZ, cylZ, rbox, sphere, torusZ, type GeoMaker } from './kit';
import { F, Palette, finishMaterial } from './surface';

type V3 = [number, number, number];

/** Forearm directions baked into the templates (right grip; mirrored for the left). */
const GRIP_ARM: V3 = [0.42, -0.48, 0.77];
const SUPPORT_ARM: V3 = [-0.26, -0.5, 0.83];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const Z = new THREE.Vector3(0, 0, 1);

/** Capsule from a to c (radius r). */
function limb(b: Build, parent: THREE.Object3D, key: string, a: V3, c: V3, r: number, fin: number): void {
  _a.set(...a);
  _b.set(...c);
  const len = _a.distanceTo(_b);
  _q.setFromUnitVectors(Z, _b.clone().sub(_a).normalize());
  _e.setFromQuaternion(_q);
  const m = _a.add(_b).multiplyScalar(0.5);
  b.add(parent, `${key}${len.toFixed(4)}r${r}`, capsuleZ(r, Math.max(0.001, len)), fin, m.x, m.y, m.z, _e.x, _e.y, _e.z);
}

/** Box aligned with a direction (length along the direction). */
function slab(b: Build, parent: THREE.Object3D, key: string, at: V3, dir: V3, size: V3, r: number, fin: number, roll = 0): void {
  _a.set(...dir).normalize();
  _q.setFromUnitVectors(Z, _a);
  _q.multiply(new THREE.Quaternion().setFromAxisAngle(Z, roll));
  _e.setFromQuaternion(_q);
  b.add(parent, key, rbox(size[0], size[1], size[2], r), fin, at[0], at[1], at[2], _e.x, _e.y, _e.z);
}

const _mb = new THREE.Matrix4();
const _bx = new THREE.Vector3();

/** Rounded plate: length along `dir`, thickness along `up` (⊥ dir). */
function plate(b: Build, parent: THREE.Object3D, key: string, at: THREE.Vector3, dir: THREE.Vector3, up: THREE.Vector3, size: V3, r: number, fin: number): void {
  _bx.crossVectors(up, dir).normalize();
  _mb.makeBasis(_bx, up, dir);
  _q.setFromRotationMatrix(_mb);
  _e.setFromQuaternion(_q);
  b.add(parent, key, rbox(size[0], size[1], size[2], r), fin, at.x, at.y, at.z, _e.x, _e.y, _e.z);
}

/** Torus arc around Y (bar axis) from angle t0 (measured +X → +Z) spanning `arc`. */
function fingerRing(b: Build, parent: THREE.Object3D, key: string, R: number, tube: number, y: number, t0: number, arc: number, fin: number): void {
  const make: GeoMaker = torusZ(R, tube, arc, 30);
  const wrapped: GeoMaker = (q) => make(q).rotateX(Math.PI / 2);
  b.add(parent, `${key}${R.toFixed(4)}a${arc.toFixed(3)}`, wrapped, fin, 0, y, 0, 0, -t0, 0);
}

/** Forearm (sleeve + ceramic bracer + cuff) from the wrist along `dir`. */
function forearm(b: Build, parent: THREE.Object3D, key: string, wrist: V3, dir: V3, side: number): void {
  const d = new THREE.Vector3(...dir).normalize();
  const w = new THREE.Vector3(...wrist);
  const end = w.clone().addScaledVector(d, 0.36);
  limb(b, parent, `${key}.sleeve`, [w.x + d.x * 0.03, w.y + d.y * 0.03, w.z + d.z * 0.03], [end.x, end.y, end.z], 0.034, F.metal);
  // Cuff: glove gauntlet + team stripe.
  const cuff = w.clone().addScaledVector(d, 0.018);
  slab(b, parent, `${key}.gauntlet`, [cuff.x, cuff.y, cuff.z], [d.x, d.y, d.z], [0.07, 0.066, 0.05], 0.024, F.rubber);
  const stripe = w.clone().addScaledVector(d, 0.046);
  slab(b, parent, `${key}.stripe`, [stripe.x, stripe.y, stripe.z], [d.x, d.y, d.z], [0.074, 0.07, 0.012], 0.005, F.accent);
  // Ceramic bracer: a slim plate strapped to the outer forearm (the sleeve stays
  // the dominant read, so the arm never looks like a white pipe).
  const out = new THREE.Vector3(side * 0.7, 0.45, 0).normalize();
  const up = out.clone().addScaledVector(d, -out.dot(d)).normalize();
  const br = w.clone().addScaledVector(d, 0.14).addScaledVector(up, 0.031);
  plate(b, parent, `${key}.plate`, br, d, up, [0.046, 0.016, 0.11], 0.0075, F.shell);
  const line = w.clone().addScaledVector(d, 0.14).addScaledVector(up, 0.0395);
  plate(b, parent, `${key}.plateLine`, line, d, up, [0.01, 0.003, 0.098], 0.0014, F.accent);
  _q.setFromUnitVectors(Z, d);
  _e.setFromQuaternion(_q);
  for (const t of [0.095, 0.185]) {
    const st = w.clone().addScaledVector(d, t);
    b.add(parent, `${key}.strap`, torusZ(0.0352, 0.0052, Math.PI * 2, 22), F.dark, st.x, st.y, st.z, _e.x, _e.y, _e.z);
  }
}

/** Right (side 1) or mirrored left (side −1) fist around a vertical bar of radius r. */
function buildGrip(side: 1 | -1, r: number): Build {
  const b = new Build('meridian' as WeaponId, 2, `hand.grip${side}.${r.toFixed(3)}`);
  const R = b.root;
  const s = side;
  // Mirror a torus arc: t → π − t.
  const arcAt = (t0: number, arc: number): number => (s > 0 ? t0 : Math.PI - t0 - arc);
  const Rf = r + 0.0098;
  const fingers: [number, number, number][] = [[0.0, -Math.PI + 0.32, Math.PI - 0.08], [-0.021, -Math.PI + 0.42, Math.PI - 0.16], [-0.041, -Math.PI + 0.55, Math.PI - 0.3]];
  fingers.forEach(([y, t0, arc], i) => fingerRing(b, R, `finger${i}`, Rf - i * 0.0008, 0.0098 - i * 0.0006, y, arcAt(t0, arc), arc, F.rubber));
  // Finger-tip pads (leather) where the fingers end on the far side.
  // Index finger along the trigger.
  limb(b, R, 'index1', [s * (r + 0.004), 0.026, -0.002], [s * (r * 0.4 + 0.006), 0.031, -r - 0.018], 0.0088, F.rubber);
  limb(b, R, 'index2', [s * (r * 0.4 + 0.006), 0.031, -r - 0.018], [s * 0.002, 0.022, -r - 0.034], 0.0082, F.rubber);
  // Back of the hand + ceramic knuckle plate.
  b.add(R, 'palmBack', rbox(0.03, 0.08, 0.072, 0.013), F.rubber, s * (r + 0.008), -0.012, 0.018, 0.1, s * 0.3, 0);
  b.add(R, 'knuckle', rbox(0.012, 0.064, 0.044, 0.005), F.shell, s * (r + 0.024), -0.006, 0.01, 0.1, s * 0.3, 0);
  b.add(R, 'knuckleLine', rbox(0.013, 0.066, 0.006, 0.002), F.accent, s * (r + 0.0245), -0.006, -0.008, 0.1, s * 0.3, 0);
  b.add(R, 'knuckleRidge', rbox(0.016, 0.07, 0.012, 0.005), F.dark, s * (r + 0.018), -0.007, -0.022, 0.1, s * 0.3, 0);
  // Thumb over the far side of the grip + thenar pad.
  limb(b, R, 'thenar', [s * (r + 0.004), 0.004, 0.04], [-s * 0.002, 0.036, r + 0.006], 0.014, F.rubber);
  limb(b, R, 'thumb1', [-s * 0.002, 0.038, r + 0.004], [-s * (r + 0.002), 0.032, 0.002], 0.0098, F.rubber);
  limb(b, R, 'thumb2', [-s * (r + 0.002), 0.032, 0.002], [-s * (r + 0.004), 0.024, -r - 0.004], 0.009, F.rubber);
  b.add(R, 'thumbPlate', rbox(0.008, 0.016, 0.03, 0.003), F.shell, -s * (r + 0.011), 0.034, -0.002, 0, 0, 0);
  forearm(b, R, 'arm', [s * (r + 0.006), -0.034, 0.052], [s * GRIP_ARM[0], GRIP_ARM[1], GRIP_ARM[2]], s);
  b.finalize(handMaterialPlaceholder, null);
  return b;
}

/**
 * Left hand clamped on a horizontal bar (axis Z) of radius r ("C-clamp"): palm
 * on the near (left) side so the ceramic back-of-hand plate faces the camera,
 * thumb hooked over the top, fingers wrapping underneath.
 */
function buildSupport(r: number): Build {
  const b = new Build('meridian' as WeaponId, 2, `hand.support.${r.toFixed(3)}`);
  const R = b.root;
  const Rf = r + 0.0096;
  const zs = [-0.03, -0.01, 0.01, 0.029];
  zs.forEach((z, i) => {
    // Angles measured +X → +Y around the bar: start on the left side, wrap under.
    const t0 = Math.PI - 0.05 + i * 0.03;
    const arc = Math.PI * 0.72 - i * 0.1;
    b.add(R, `sfinger${i}${Rf.toFixed(4)}a${arc.toFixed(3)}`, torusZ(Rf - i * 0.0006, 0.0096 - i * 0.0005, arc, 30), F.rubber, 0, 0, z, 0, 0, t0);
  });
  // Palm + back of the hand on the near side, ceramic plate facing out.
  b.add(R, 'spalm', rbox(0.028, 0.066, 0.084, 0.012), F.rubber, -r - 0.012, -0.008, 0.002, 0, 0, -0.12);
  b.add(R, 'sback', rbox(0.011, 0.05, 0.062, 0.005), F.shell, -r - 0.028, -0.004, 0.004, 0, 0, -0.12);
  b.add(R, 'sbackLine', rbox(0.012, 0.052, 0.006, 0.002), F.accent, -r - 0.0285, -0.004, -0.02, 0, 0, -0.12);
  b.add(R, 'sknuckle', rbox(0.018, 0.012, 0.074, 0.005), F.dark, -r - 0.018, -0.036, 0.002, 0, 0, 0.4);
  // Thumb hooked over the top of the bar.
  limb(b, R, 'sthenar', [-r - 0.018, 0.004, 0.034], [-r - 0.006, r * 0.55, 0.018], 0.0135, F.rubber);
  limb(b, R, 'sthumb1', [-r - 0.006, r * 0.55, 0.018], [-r * 0.35, r + 0.008, -0.004], 0.0098, F.rubber);
  limb(b, R, 'sthumb2', [-r * 0.35, r + 0.008, -0.004], [r * 0.3, r + 0.007, -0.026], 0.009, F.rubber);
  b.add(R, 'sthumbPlate', rbox(0.016, 0.008, 0.026, 0.003), F.shell, -r * 0.3, r + 0.016, -0.006, 0, 0.35, 0);
  forearm(b, R, 'sarm', [-r - 0.02, -r * 0.55 - 0.012, 0.05], SUPPORT_ARM, -1);
  b.finalize(handMaterialPlaceholder, null);
  return b;
}

/** Replaced right after finalize (the merged meshes take the live hand material). */
const handMaterialPlaceholder = new THREE.MeshBasicMaterial();

function buildCanister(kind: ThrowableId): Build {
  const b = new Build('meridian' as WeaponId, 2, `canister.${kind}`);
  const R = b.root;
  if (kind === 'smoke') {
    b.add(R, 'canBody', cylZ(0.029, 0.029, 0.11, 20), F.shell, 0, 0, 0);
    b.add(R, 'canBand', cylZ(0.0295, 0.0295, 0.028, 20), F.accent, 0, 0, 0.01);
    for (const z of [-0.056, 0.056]) b.add(R, 'canCap', cylZ(0.025, 0.027, 0.008, 20), F.dark, 0, 0, z);
    b.add(R, 'canLever', rbox(0.008, 0.006, 0.09, 0.002), F.steel, 0, 0.031, 0.0);
    b.add(R, 'canPin', torusZ(0.008, 0.0015, Math.PI * 2, 12), F.steel, 0, 0.036, -0.05, 0, Math.PI / 2, 0);
  } else {
    b.add(R, 'grenBody', sphere(0.034, 20), F.dark, 0, 0, 0);
    b.add(R, 'grenRing', torusZ(0.0345, 0.0045, Math.PI * 2, 28), F.danger, 0, 0, 0, Math.PI / 2, 0, 0);
    b.add(R, 'grenCap', cylZ(0.012, 0.014, 0.016, 14), F.steel, 0, 0.036, 0, Math.PI / 2, 0, 0);
    b.add(R, 'grenPin', torusZ(0.009, 0.0016, Math.PI * 2, 12), F.steel, 0.012, 0.046, 0, 0, Math.PI / 2, 0);
  }
  b.finalize(handMaterialPlaceholder, null);
  return b;
}

// ── Hands rig ───────────────────────────────────────────────────────────────

export type HandTemplate = 'gripR' | 'gripL' | 'support';

const HALCYON_CERAMIC = ENV.bone;
const BLOOM_CERAMIC = '#9fa88c';

export class Gloves {
  readonly palette = new Palette();
  readonly material: THREE.Material;
  readonly right = new THREE.Group();
  readonly left = new THREE.Group();
  readonly canister = new THREE.Group();
  private readonly templates = new Map<string, THREE.Object3D>();
  private readonly canisters: Record<ThrowableId, THREE.Object3D>;

  constructor() {
    const p = this.palette;
    p.set(F.shell, { color: HALCYON_CERAMIC, metal: 0, rough: 0.34, emissive: 0, pattern: 0 });
    p.set(F.accent, { color: '#ff8a3d', metal: 0, rough: 0.45, emissive: 0.08, pattern: 0 });
    p.set(F.rubber, { color: '#3f3934', metal: 0, rough: 0.86, emissive: 0, pattern: 0 });
    p.set(F.dark, { color: '#292421', metal: 0, rough: 0.6, emissive: 0, pattern: 0 });
    p.set(F.metal, { color: '#5a554d', metal: 0, rough: 0.92, emissive: 0, pattern: 0 });
    p.set(F.steel, { color: '#b4b4b0', metal: 0.9, rough: 0.3, emissive: 0, pattern: 0 });
    p.set(F.danger, { color: DANGER_COLOR, metal: 0, rough: 0.5, emissive: 2.6, pattern: 0 });
    this.material = finishMaterial(p, null, 'standard');
    this.right.name = 'glove.right';
    this.left.name = 'glove.left';
    this.canister.name = 'canister';
    this.canisters = { smoke: this.adopt(buildCanister('smoke').root), grenade: this.adopt(buildCanister('grenade').root) };
    this.canister.add(this.canisters.smoke, this.canisters.grenade);
    this.canister.visible = false;
  }

  private adopt(o: THREE.Object3D): THREE.Object3D {
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh) {
        m.material = this.material;
        m.renderOrder = 2;
        m.frustumCulled = false;
      }
    });
    return o;
  }

  /** Cached glove mesh for a template + bar radius (build once, then reuse). */
  template(kind: HandTemplate, r: number): THREE.Object3D {
    const rr = Math.round(r * 500) / 500;
    const key = `${kind}|${rr}`;
    let t = this.templates.get(key);
    if (!t) {
      const b = kind === 'support' ? buildSupport(rr) : buildGrip(kind === 'gripR' ? 1 : -1, rr);
      t = this.adopt(b.root);
      t.name = key;
      // Local forearm direction (the viewmodel aims it at the shoulder).
      t.userData.forearm = new THREE.Vector3(...(kind === 'support' ? SUPPORT_ARM : kind === 'gripR' ? GRIP_ARM : ([-GRIP_ARM[0], GRIP_ARM[1], GRIP_ARM[2]] as V3))).normalize();
      this.templates.set(key, t);
    }
    return t;
  }

  /** Local forearm direction of the template currently on a hand. */
  forearmDir(hand: THREE.Group): THREE.Vector3 | null {
    return (hand.children[0]?.userData.forearm as THREE.Vector3 | undefined) ?? null;
  }

  /** Mounts the given templates on the right / left hand (no-op if unchanged). */
  use(right: THREE.Object3D | null, left: THREE.Object3D | null): void {
    if (right && right.parent !== this.right) {
      this.right.clear();
      this.right.add(right);
    }
    if (left && left.parent !== this.left) {
      this.left.clear();
      this.left.add(left);
    }
  }

  showCanister(kind: ThrowableId | null): void {
    this.canister.visible = kind !== null;
    this.canisters.smoke.visible = kind === 'smoke';
    this.canisters.grenade.visible = kind === 'grenade';
  }

  setTeamColor(color: string): void {
    this.palette.set(F.accent, { color });
  }

  setFaction(f: 0 | 1): void {
    this.palette.set(F.shell, { color: f === 0 ? HALCYON_CERAMIC : BLOOM_CERAMIC });
    this.palette.set(F.rubber, { color: f === 0 ? '#3f3934' : '#3b3d33' });
    this.palette.set(F.metal, { color: f === 0 ? '#5a554d' : '#55553f' });
  }

  dispose(): void {
    // Geometries are cached module-wide by the kit; only the material is ours.
    this.material.dispose();
  }
}

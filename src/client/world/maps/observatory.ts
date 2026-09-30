// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — "Observatory" decor: a mountaintop observatory above the
// clouds at blue-violet dusk; the stars come out as the match goes on.
//
// The generic map builder has already drawn the snowfield ground and the sky /
// low sun / haze / snow. Every other solid is 'hidden' and drawn here:
//   observatory/dome.ts       the brutalist base, the telescope hall (gallery
//                             ring, stairs, podium, the observer's desk), the
//                             arcades, and the ROTATING dome + telescope with
//                             the cold starlight shaft through its slit
//   observatory/west.ts       ridge, signal array (tracking dishes, masts,
//                             flapping pennants), under-ridge yard, spectrograph
//   observatory/east.ts       dormitory (radio still playing), pylon station,
//                             the stuck cabin No. 7 swaying over the void
//   observatory/compounds.ts  tram terminal / winter quarters, courtyards
//   observatory/backdrop.ts   cliffs, cloud sea, peaks, launch mesa + rocket,
//                             Milky Way + moon fading in with the match
//   observatory/atlas.ts      painted signage / charts / plaque (one texture)
//
// Static dressing is merged per material kind (~16 draw calls); animated
// pieces (dome ~6, dishes 2×3, cabin 4, wheel 1, pennants 1, beacons 1, sky 3,
// rocket ~10, shafts 2×2) keep the total well under budget. Detail and light
// shafts scale with quality.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { DecorBuilder, DecorContext, MapDecor, MapRuntimeState, ShowcasePose } from '../../contracts';
import type { Team } from '../../../shared/types';
import { ENV } from '../../engine/palette';
import type { BackdropOptions } from '../map-builder';
import { ATLAS_H, ATLAS_W, paintAtlas } from './observatory/atlas';
import { buildBackdrop } from './observatory/backdrop';
import { buildCompounds } from './observatory/compounds';
import { buildDome, buildObservatoryStatic } from './observatory/dome';
import { buildEast } from './observatory/east';
import { ObsKit, sphere } from './observatory/kit';
import { buildWest } from './observatory/west';

/** The summit's own cliffs + cloud sea are drawn by the decor (no default skirt). */
export const backdrop: BackdropOptions = { kind: 'none', water: false };

const buildObservatory: DecorBuilder = (ctx: DecorContext): MapDecor => {
  const { root, quality, def } = ctx;
  const rnd = ctx.rng;
  const decor = THREE.MathUtils.clamp(quality.decor, 0.3, 1);
  const low = quality.preset === 'low';

  const atlas = ctx.materials.canvasTexture(low ? 'obs.atlas.lo' : 'obs.atlas', low ? ATLAS_W / 2 : ATLAS_W, low ? ATLAS_H / 2 : ATLAS_H, paintAtlas);
  const kit = new ObsKit(ctx, 'obs');
  kit.signTexture = atlas;

  // Ropeway heading: from the pylon toward the launch mesa (the ropeway once carried supplies there).
  const cableDir = new THREE.Vector3(def.rocket.pos.x - 57, 0, def.rocket.pos.z).normalize();

  buildObservatoryStatic(kit, rnd, decor);
  const domeKit = new ObsKit(ctx, 'obs.dome');
  domeKit.signTexture = atlas;
  const dome = buildDome(domeKit, root, quality);
  const west = buildWest(kit, root, rnd, decor);
  if (west.pennants) root.add(west.pennants.mesh);
  const east = buildEast(kit, root, rnd, decor, cableDir);
  buildCompounds(kit, rnd, decor);
  const back = buildBackdrop(kit, root, def, ctx.materials, quality, rnd);
  kit.build(root);

  if (import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('decorStats')) {
    console.info('[observatory] decor tris', kit.meshes.map((m) => `${m.name}:${(m.geometry.attributes.position.count / 3) | 0}`).join(' '));
    console.info('[observatory] by section', [...kit.sectionTris.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => `${k}:${v | 0}`).join(' '));
  }

  // ── Blinking beacons (mast tips, pylon) — one draw, one material ──
  const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(ENV.glowSoftPink) });
  const beaconGeos = [...west.masts, ...east.beacons].map((p) => sphere(p.x, p.y, p.z, 0.22, 8, 6));
  const beaconKit = new ObsKit(ctx, 'obs.beacons');
  for (const g of beaconGeos) beaconKit.add('glow', g, '#ffffff', { flat: true });
  const beaconGroup = new THREE.Group();
  beaconKit.build(beaconGroup);
  for (const m of beaconKit.meshes) m.material = beaconMat;
  root.add(beaconGroup);

  // ── Dev hooks: ?rocketT=1[&rocketTeam=1] previews the finale; ?domeT=<s> sets the dome angle. ──
  let devLaunchTeam: Team | null = null;
  let devDome: number | null = null;
  if (import.meta.env.DEV && typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search);
    if (q.has('rocketT')) devLaunchTeam = (Number(q.get('rocketTeam') ?? 0) === 1 ? 1 : 0) as Team;
    if (q.has('domeT')) devDome = Number(q.get('domeT'));
  }

  const PINK = new THREE.Color(ENV.glowSoftPink);
  const signGlow = kit.meshes.find((m) => m.name === 'obs.signGlow')?.material as THREE.MeshBasicMaterial | undefined;
  const cloudU = back.cloudMat.uniforms;
  const mwU = back.milkyMat.uniforms;
  const pennantTime = west.pennants?.mat.userData.uTime;
  let stars = 0;

  const update = (dt: number, s: MapRuntimeState): void => {
    const t = s.time;
    const cam = s.camera;
    // The dome turns slowly (≈ 8 min per revolution) with a gentle tracking wobble.
    const domeT = devDome ?? t;
    dome.rotor.rotation.y = 0.55 + domeT * 0.0125 + Math.sin(domeT * 0.021) * 0.08;
    // Dishes slowly track their sources.
    for (const d of west.dishes) d.group.rotation.y = d.base + Math.sin(t * d.speed + d.phase) * 0.6 + t * d.speed * 0.2;
    if (pennantTime) pennantTime.value = t;
    // Cabin No. 7 sways on its grip; the bullwheel creaks back and forth.
    east.cabin.rotation.z = Math.sin(t * 0.9) * 0.035 + Math.sin(t * 2.3 + 1) * 0.01;
    east.cabin.rotation.x = Math.sin(t * 0.63 + 0.5) * 0.05;
    east.wheel.rotation.y = Math.sin(t * 0.25) * 0.06;
    // Beacons: slow double blink; the dome crown pulses out of phase.
    const ph = t % 2.6;
    const on = ph < 0.12 || (ph > 0.3 && ph < 0.42);
    beaconMat.color.copy(PINK).multiplyScalar(on ? 3.6 : 0.35);
    const ph2 = (t + 1.3) % 2.6;
    dome.beacon.color.copy(PINK).multiplyScalar(ph2 < 0.14 ? 4 : 0.4);
    if (signGlow) signGlow.color.setScalar(0.94 + 0.06 * Math.sin(t * 0.7) * Math.sin(t * 1.9));
    // Sky: clouds drift, the Milky Way and the moon fade in with the match.
    cloudU.uTime.value = t;
    const target = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(s.matchProgress, 0, 1), 0.08, 0.85);
    stars += (target - stars) * Math.min(1, dt * 0.8);
    mwU.uAmount.value = 0.15 + stars * 0.85;
    back.milky.position.copy(cam.position);
    back.moon.position.copy(cam.position).addScaledVector(back.moonDir, back.moonDist);
    back.moon.quaternion.copy(cam.quaternion);
    (back.moon.material as THREE.MeshBasicMaterial).opacity = 0.55 + stars * 0.45;
    // Launch Control finale.
    const launch = devLaunchTeam !== null ? { team: devLaunchTeam, t } : s.rocketLaunch;
    back.rocket.update(dt, launch, t);
  };

  const showcase = (kind: 'intro' | 'outro' | 'keyart'): ShowcasePose | undefined => {
    // Key art: from above the east rim, the dome in full alpenglow against the
    // blue-violet sky, the moon and the first stars over the ridge.
    if (kind === 'keyart') return { pos: { x: 62, y: 12, z: 20 }, target: { x: 0, y: 9, z: -2 }, fov: 56 };
    // Intro: the whole summit, the dome, the pylon and the launch butte against the last light.
    if (kind === 'intro') return { pos: { x: -84, y: 30, z: 70 }, target: { x: 4, y: 4, z: -2 }, fov: 50 };
    // Outro: over the station deck, the ropeway and cabin No. 7 lead the eye to the launch.
    const rt = back.rocketTarget;
    return { pos: { x: 50, y: 11, z: 16 }, target: { x: rt.x, y: rt.y, z: rt.z }, fov: 46 };
  };

  const dispose = (): void => {
    back.rocket.dispose();
    for (const o of back.owned) o.dispose();
    if (west.pennants) {
      west.pennants.mesh.geometry.dispose();
      west.pennants.mat.dispose();
      west.pennants.mesh.removeFromParent();
    }
    for (const k of west.kits) k.dispose();
    east.cabinKit.dispose();
    east.wheelKit.dispose();
    dome.kit.dispose();
    dome.beacon.dispose();
    if (dome.caster) {
      dome.caster.geometry.dispose();
      (dome.caster.material as THREE.Material).dispose();
      dome.caster.removeFromParent();
    }
    for (const c of dome.rotor.children) (c as THREE.Mesh).geometry?.dispose();
    for (const sh of dome.shafts) (sh.userData.dispose as (() => void) | undefined)?.();
    beaconKit.dispose();
    beaconMat.dispose();
    kit.dispose();
  };

  return { update, showcase, dispose };
};

export default buildObservatory;

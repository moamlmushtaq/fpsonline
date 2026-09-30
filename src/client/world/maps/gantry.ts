// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — "Gantry" decor: a coastal launch site at sunset.
//
// The generic map builder has already drawn the non-hidden collision solids,
// the sky/sun/haze, the sand skirt and the sea. This module adds everything
// that makes Gantry memorable: the hero rocket on its mount beside the 64 m
// lattice tower, the flame trench and tunnels, the assembly hangar and the
// overgrown tracking station, the tank farm and mission-control bunker, the
// docks with the harbor crane and crashing waves, the world beyond the fences,
// and the storytelling props (posters, the frozen countdown, lunch boxes, the
// radio, the mural of the first launch, the beached rowboat, gulls, windsock).
//
// Static dressing is merged per material kind (see gantry/kit.ts) → ~16 draw
// calls; animated pieces (rocket, arms, dish, flag, windsock, boat, waves,
// gulls, beacons) are a handful more. Detail scales with quality.decor.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { DecorBuilder, DecorContext, MapDecor, MapRuntimeState, ShowcasePose } from '../../contracts';
import type { Team } from '../../../shared/types';
import { GANTRY_DECK, GANTRY_ROCKET } from '../../../shared/maps/gantry';
import { createLightShaft } from '../../engine/atmosphere';
import { ENV } from '../../engine/palette';
import type { BackdropOptions } from '../map-builder';
import { createLaunchRocket, createSteamEmitter } from '../rocket';
import { buildBackdrop } from './gantry/backdrop';
import { buildCompounds } from './gantry/compounds';
import { buildDocks } from './gantry/docks';
import { buildGround } from './gantry/ground';
import { DecorKit, sphere } from './gantry/kit';
import { buildPad } from './gantry/pad';
import { ATLAS_H, ATLAS_W, paintAtlas, paintLeaves } from './gantry/signage';
import { buildTankFarm } from './gantry/tankfarm';

/** Sea to the east (toward the sun), sand skirt elsewhere, water plane on. */
export const backdrop: BackdropOptions = { kind: 'coast', tag: 'sand', water: true };

const buildGantry: DecorBuilder = (ctx: DecorContext): MapDecor => {
  const { root, quality } = ctx;
  const rnd = ctx.rng;
  const decor = THREE.MathUtils.clamp(quality.decor, 0.3, 1);
  const low = quality.preset === 'low';

  const kit = new DecorKit(ctx);
  kit.signTexture = ctx.materials.canvasTexture(low ? 'gantry.atlas.lo' : 'gantry.atlas', low ? ATLAS_W / 2 : ATLAS_W, low ? ATLAS_H / 2 : ATLAS_H, paintAtlas);
  kit.leafTexture = ctx.materials.canvasTexture(low ? 'gantry.leaves.lo' : 'gantry.leaves', low ? 256 : 512, low ? 256 : 512, paintLeaves);

  kit.section = 'pad';
  const pad = buildPad(kit, rnd, root, decor);
  kit.section = 'compounds';
  const compounds = buildCompounds(kit, rnd, root, decor);
  kit.section = 'farm';
  const farm = buildTankFarm(kit, rnd, root, decor);
  kit.section = 'docks';
  const docks = buildDocks(kit, rnd, root, decor, ctx.def.solids);
  kit.section = 'backdrop';
  const gulls = buildBackdrop(kit, rnd, root, quality);
  kit.section = 'ground';
  buildGround(kit, rnd, decor);
  kit.build(root);

  if (import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('decorStats')) {
    console.info('[gantry] decor tris', kit.meshes.map((m) => `${m.name}:${(m.geometry.attributes.position.count / 3) | 0}`).join(' '));
    console.info('[gantry] by section', [...kit.sectionTris.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([k, v]) => `${k}:${v | 0}`).join(' '));
  }

  // ── The hero rocket ──
  const rocket = createLaunchRocket(ctx.materials, quality, { scale: ctx.def.rocket.scale });
  rocket.root.position.set(ctx.def.rocket.pos.x, ctx.def.rocket.pos.y, ctx.def.rocket.pos.z);
  rocket.root.rotation.y = Math.PI / 2; // stacked "HALCYON" stencil faces both spawns
  root.add(rocket.root);

  // Launch exhaust also blasts out of the flame trench mouth (east face) and
  // jets up through the broken grate over the Sunspear.
  const trenchSteam = createSteamEmitter(quality, 72);
  trenchSteam.sunDir.set(ctx.def.lighting.sunDir.x, ctx.def.lighting.sunDir.y, ctx.def.lighting.sunDir.z).normalize();
  root.add(trenchSteam.mesh);
  let steamAcc = 0;
  let wasLaunching = false;

  // ── Blinking aviation beacons (tower mast, hammerhead tips, crane, boat) ──
  const beaconBase = new THREE.Color(ENV.glowGold);
  const beaconMat = new THREE.MeshBasicMaterial({ color: beaconBase.clone() });
  const beaconGeo = [
    sphere(-9.5, 76.3, 0, 0.35, 8, 6),
    sphere(-21.8, 66.6, 0, 0.3, 8, 6),
    sphere(4.8, 66.6, 0, 0.3, 8, 6),
    sphere(54, 34.4, 0, 0.35, 8, 6),
    sphere(97.8, 26.6, 0, 0.3, 8, 6),
  ];
  const beaconKit = new DecorKit(ctx);
  for (const g of beaconGeo) beaconKit.add('glow', g, '#ffffff', { flat: true });
  const beaconGroup = new THREE.Group();
  beaconKit.build(beaconGroup);
  for (const m of beaconKit.meshes) m.material = beaconMat;
  root.add(beaconGroup);

  // ── Light shafts (High): grate → Sunspear, trench mouth, bunker window, hangar ──
  const shafts: THREE.Object3D[] = [];
  if (quality.lightShafts) {
    const anchors = [
      ...pad.shaftAnchors,
      ...farm.shafts,
      // Sunset streaming through the hangar's east clerestory, across the spawn hall.
      { pos: new THREE.Vector3(18.2, 15.6, -59.0), dir: new THREE.Vector3(-0.95, -0.19, 0.24).normalize(), length: 36, radius: 1.5, color: '#ffc995', intensity: 0.75 },
      { pos: new THREE.Vector3(18.2, 15.6, -55.4), dir: new THREE.Vector3(-0.95, -0.19, 0.24).normalize(), length: 36, radius: 1.5, color: '#ffc995', intensity: 0.6 },
    ];
    for (const a of anchors) {
      const s = createLightShaft({ pos: a.pos, dir: a.dir, length: a.length, radius: a.radius, color: a.color, intensity: a.intensity });
      root.add(s);
      shafts.push(s);
    }
  }

  // ── Dev hook: preview the finale with ?rocketT=1[&rocketTeam=1] ──
  let devLaunchTeam: Team | null = null;
  if (import.meta.env.DEV && typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search);
    if (q.has('rocketT')) devLaunchTeam = (Number(q.get('rocketTeam') ?? 0) === 1 ? 1 : 0) as Team;
  }

  const flagPos = compounds.flag.geometry.attributes.position as THREE.BufferAttribute;
  const signGlow = kit.meshes.find((m) => m.name === 'gantry.signGlow')?.material as THREE.MeshBasicMaterial | undefined;
  let clock = 0;

  const update = (dt: number, s: MapRuntimeState): void => {
    clock += dt;
    const t = s.time;
    const launch = devLaunchTeam !== null ? { team: devLaunchTeam, t } : s.rocketLaunch;
    rocket.update(dt, launch, t);
    if (launch) {
      wasLaunching = true;
      const lt = launch.t;
      if (lt > 0.35 && lt < 4.8) {
        steamAcc += dt * 22 * (0.4 + quality.particles * 0.6);
        while (steamAcc >= 1) {
          steamAcc -= 1;
          const r = rnd();
          if (r < 0.72) trenchSteam.emit(16.5, 0.8 + rnd() * 1.8, (rnd() - 0.5) * 5, 11 + rnd() * 9, 0.6 + rnd() * 2.4, (rnd() - 0.5) * 5, 4.5 + rnd() * 2.5, 2.2, 9 + rnd() * 6, 0.85, 0.55);
          else trenchSteam.emit(-3.2 + (rnd() - 0.5), GANTRY_DECK + 0.2, (rnd() - 0.5), (rnd() - 0.5) * 1.5, 7 + rnd() * 5, (rnd() - 0.5) * 1.5, 3 + rnd() * 1.5, 1.2, 5 + rnd() * 3, 0.7, 0.9);
        }
      }
    } else if (wasLaunching) {
      wasLaunching = false;
      trenchSteam.clear();
    }
    trenchSteam.update(dt, -1.2, 0.3);
    // Swing arms retract at ignition.
    pad.arms.rotation.y = launch ? -THREE.MathUtils.smoothstep(launch.t, 0.15, 1.4) * 1.2 : 0;
    // Tracking dish sweeps slowly; flag and windsock in the sea breeze.
    compounds.dish.rotation.y = Math.sin(t * 0.05) * 0.9 + 0.2;
    const arr = flagPos.array as Float32Array;
    const base = compounds.flagBase;
    for (let i = 0; i < arr.length; i += 3) {
      const x = base[i];
      const k = x / 4.2;
      arr[i + 2] = base[i + 2] + Math.sin(t * 3.1 - x * 1.6) * 0.35 * k + Math.sin(t * 5.3 - x * 2.9 + base[i + 1]) * 0.08 * k;
      arr[i + 1] = base[i + 1] - k * k * 0.25;
    }
    flagPos.needsUpdate = true;
    docks.sock.rotation.y = Math.PI * 0.95 + Math.sin(t * 0.7) * 0.25 + Math.sin(t * 2.3) * 0.06;
    docks.sock.rotation.z = -0.12 + Math.sin(t * 1.9) * 0.05;
    // Waves, splashes, moored boat, gulls.
    for (const m of docks.materials) m.uniforms.uTime.value = t;
    docks.boat.position.y = -3 + Math.sin(t * 0.9) * 0.18;
    docks.boat.rotation.z = Math.sin(t * 0.7) * 0.05;
    docks.boat.rotation.x = Math.sin(t * 0.55 + 1) * 0.03;
    gulls.update(t);
    // Beacons: slow double-blink; the countdown board hums and flickers.
    const ph = t % 2.2;
    beaconMat.color.copy(beaconBase).multiplyScalar(ph < 0.14 || (ph > 0.3 && ph < 0.42) ? 3.4 : 0.25);
    if (signGlow) {
      const f = 0.92 + 0.08 * Math.sin(t * 13.0) * Math.sin(t * 2.7) + (Math.sin(t * 0.9) > 0.985 ? -0.35 : 0);
      signGlow.color.setScalar(f);
    }
    void clock;
  };

  const showcase = (kind: 'intro' | 'outro' | 'keyart'): ShowcasePose | undefined => {
    const rx = GANTRY_ROCKET.x;
    if (kind === 'keyart') return { pos: { x: -17, y: 2, z: -36 }, target: { x: rx - 1, y: 21, z: 0 }, fov: 52 };
    // Intro: the whole site from the south-west — Halcyon's hangar below, the
    // tank farm's lamp islands, the pad and tower, the docks and the sea beyond.
    if (kind === 'intro') return { pos: { x: -70, y: 34, z: -64 }, target: { x: 10, y: 4, z: 10 }, fov: 52 };
    // Outro (launch finale): low in Halcyon's yard, looking up past the hangar
    // corner — wide enough that the climb and its smoke column stay in frame
    // for the whole 7 s outro, the sunset raking the rocket from the right.
    return { pos: { x: -40, y: 5, z: -52 }, target: { x: rx, y: 46, z: 0 }, fov: 64 };
  };

  const dispose = (): void => {
    rocket.dispose();
    trenchSteam.dispose();
    gulls.dispose();
    for (const m of docks.materials) m.dispose();
    for (const g of [pad.arms, compounds.dish, docks.sock, docks.boat]) (g.userData as { kit?: DecorKit }).kit?.dispose();
    beaconKit.dispose();
    beaconMat.dispose();
    compounds.flag.geometry.dispose();
    kit.dispose();
  };

  return { update, showcase, dispose };
};

export default buildGantry;

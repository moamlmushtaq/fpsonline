// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — preview harness: deterministic match cameras (dev only).
//
//   view=finale&map=<id>[&team=0|1][&t=…&freeze=1]
//       The Launch Control finale exactly as a match plays it: the camera
//       director's outro (swoop / crane / climb-follow / rumble) from a team-0
//       spawn, the rocket launch, the exposure bump and (High) the pad flare.
//   view=intro&map=<id>[&team=0|1][&spawn=i][&dur=3][&t=…&freeze=1]
//       The intro fly-in from showcase('intro') into the spawn's eyes; t ≥ dur
//       shows the spawn view itself. window.__introPlan = the chosen path.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { EYE_HEIGHT } from '../../shared/constants';
import { CollisionWorld } from '../../shared/physics';
import type { Team } from '../../shared/types';
import { EffectsSystem } from '../engine/effects';
import { CameraDirector, type FirstPersonPose } from '../game/deathcam';
import { rocketFlash, ROCKET_MOUNT_H } from '../world/rocket';
import { loadMap, makeCamera, runtimeState, type PreviewContext, type PreviewView } from './views';

const DEG = Math.PI / 180;

/** First-person pose at a spawn (90° horizontal FOV, the settings default). */
function spawnPose(ctx: PreviewContext, pos: { x: number; y: number; z: number }, yaw: number): FirstPersonPose {
  const aspect = ctx.engine.size.aspect;
  const vfov = 2 * Math.atan(Math.tan((90 * DEG) / 2) / Math.max(0.5, aspect));
  return {
    pos: new THREE.Vector3(pos.x, pos.y + EYE_HEIGHT, pos.z),
    quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ')),
    fov: vfov / DEG,
  };
}

export async function finaleView(ctx: PreviewContext): Promise<PreviewView> {
  const { def, mv } = await loadMap(ctx, ctx.params.get('map') ?? 'gantry');
  const world = new CollisionWorld(def.solids, def.bounds, { waterY: def.waterY });
  const team = (Number(ctx.params.get('team') ?? 0) === 1 ? 1 : 0) as Team;
  const sp = def.spawns.find((s) => s.team === team) ?? def.spawns[0];
  const camera = makeCamera(ctx, 60);
  const fp = spawnPose(ctx, sp.pos, sp.yaw);
  camera.position.copy(fp.pos);
  camera.quaternion.copy(fp.quat);
  camera.fov = fp.fov;
  camera.updateProjectionMatrix();
  const fx = new EffectsSystem(mv.scene, ctx.engine.quality);
  const director = new CameraDirector(world);
  director.setShakeScale(ctx.params.get('reduced') === '1' ? 0.25 : 1);
  director.startOutro(camera, 'rocket', mv.showcase('outro'), null, def.rocket);
  const base = ctx.engine.getGrading().exposure;
  if (Math.hypot(def.rocket.pos.x, def.rocket.pos.z) < 160) {
    fx.flare(new THREE.Vector3(def.rocket.pos.x, def.rocket.pos.y + ROCKET_MOUNT_H * def.rocket.scale + 2, def.rocket.pos.z), '#ffc98a', 260 * def.rocket.scale, 140 * def.rocket.scale, 3.2);
  }
  const freezeAt = ctx.params.get('freeze') === '1' ? Number(ctx.params.get('t') ?? 0) + 1e-3 : Infinity;
  const launch = { team, t: 0 };
  const hide = (ctx.params.get('hide') ?? '').split(',').filter(Boolean);
  // Frame-time log (perf checks): window.__finaleFrames = [[t, ms since last frame], …].
  const frames: [number, number][] = [];
  (window as unknown as { __finaleFrames?: unknown }).__finaleFrames = frames;
  let lastNow = performance.now();
  return {
    scene: mv.scene,
    camera,
    update(dt, t) {
      const now = performance.now();
      if (frames.length < 600) frames.push([+t.toFixed(3), +(now - lastNow).toFixed(1)]);
      lastNow = now;
      if (t > freezeAt) return;
      launch.t = t;
      director.apply(dt, camera, fp, null, null);
      ctx.engine.setGrading({ exposure: base * (1 + 0.32 * rocketFlash(t)) });
      fx.update(dt, camera);
      const rt = runtimeState(def, camera, t, 'control');
      rt.rocketLaunch = launch;
      rt.phase = 'ended';
      mv.update(dt, rt);
      // Perf bisecting: &hide=rocket.flare,rocket.puffs,…
      for (const n of hide) {
        const o = mv.scene.getObjectByName(n);
        if (o) o.visible = false;
      }
    },
  };
}

export async function introView(ctx: PreviewContext): Promise<PreviewView> {
  const { def, mv } = await loadMap(ctx, ctx.params.get('map') ?? 'gantry');
  const world = new CollisionWorld(def.solids, def.bounds, { waterY: def.waterY });
  const team = (Number(ctx.params.get('team') ?? 0) === 1 ? 1 : 0) as Team;
  const list = def.spawns.filter((s) => s.team === team);
  const sp = list[Math.min(list.length - 1, Math.max(0, Number(ctx.params.get('spawn') ?? 0) | 0))] ?? def.spawns[0];
  const camera = makeCamera(ctx, 60);
  const fp = spawnPose(ctx, sp.pos, sp.yaw);
  const director = new CameraDirector(world);
  director.setOccluders(mv.scene);
  const dur = Number(ctx.params.get('dur') ?? 3) || 3;
  director.startIntro(mv.showcase('intro'), dur);
  const freezeAt = ctx.params.get('freeze') === '1' ? Number(ctx.params.get('t') ?? 0) + 1e-3 : Infinity;
  return {
    scene: mv.scene,
    camera,
    update(dt, t) {
      if (t > freezeAt) return;
      director.apply(dt, camera, fp, null, null);
      (window as unknown as { __introPlan?: string }).__introPlan = `${director.plan} ${director.planMs.toFixed(0)}ms`;
      mv.update(dt, runtimeState(def, camera, t, null));
    },
  };
}

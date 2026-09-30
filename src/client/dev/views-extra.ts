// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — preview harness: viewmodel / characters / effects / touch views.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { ViewModelState } from '../contracts';
import type { WeaponId } from '../../shared/types';
import { WEAPONS } from '../../shared/weapons';
import { reloadDuration } from '../../shared/combat';
import { teamColors } from '../engine/palette';
import { FirstPersonViewModel } from '../world/viewmodel';
import { loadMap, makeCamera, runtimeState, type PreviewContext, type PreviewView } from './views';

export const extraViews: Record<string, (ctx: PreviewContext) => Promise<PreviewView> | PreviewView> = {
  viewmodel: viewmodelView,
};

async function viewmodelView(ctx: PreviewContext): Promise<PreviewView> {
  const { def, mv } = await loadMap(ctx, ctx.params.get('map') ?? 'gantry');
  const camera = makeCamera(ctx, 78);
  const sp = def.spawns.find((s) => s.team === 0) ?? def.spawns[0];
  camera.position.set(sp.pos.x, sp.pos.y + 1.62, sp.pos.z);
  camera.rotation.set(0, sp.yaw, 0, 'YXZ');
  const vm = new FirstPersonViewModel(ctx.weapons, ctx.engine);
  vm.setTeamLight(teamColors(0).primary);
  const weapon = (ctx.params.get('weapon') ?? 'meridian') as WeaponId;
  const skin = ctx.params.get('skin') ?? 'factory';
  const anim = ctx.params.get('anim') ?? 'idle';
  const w = WEAPONS[weapon];
  const interval = 60 / w.rpm;
  const reloadMag = weapon === 'breaker' ? 2 : 0;
  const reloadTime = reloadDuration(weapon, reloadMag);
  const s: ViewModelState = {
    weapon,
    skin,
    ads: anim === 'ads' ? 1 : 0,
    sprinting: anim === 'sprint',
    sliding: anim === 'slide',
    crouch: 0,
    speed: anim === 'sprint' ? 7.8 : anim === 'walk' ? 5.4 : 0,
    onGround: true,
    reload: -1,
    raise: 1,
    charge: 0,
    cycle: 1,
    mag: Math.round(w.magSize * 0.7),
    magSize: w.magSize,
    lookDx: 0,
    lookDy: 0,
    scoped: false,
  };
  let lastShot = -1;
  let reloadStarted = false;
  if (anim === 'throw') vm.throwStart('grenade');
  return {
    scene: mv.scene,
    camera,
    overlay: { scene: vm.scene, camera: vm.camera },
    update(dt, t) {
      if (anim === 'fire') {
        if (t - lastShot >= interval) {
          lastShot = t;
          vm.fire();
          s.mag = Math.max(0, s.mag - 1);
        }
        s.cycle = Math.min(1, (t - lastShot) / interval);
        if (weapon === 'sunspear') s.charge = Math.min(1, ((t % 1.2) / 0.6));
      }
      if (anim === 'reload') {
        if (!reloadStarted) {
          reloadStarted = true;
          vm.reloadStart(reloadMag === 0);
          s.mag = reloadMag;
        }
        s.reload = Math.min(0.999, t / reloadTime);
        if (weapon === 'breaker') {
          const lead = w.reloadTime * 0.25;
          s.mag = Math.min(w.magSize, reloadMag + Math.max(0, Math.floor((t - lead) / (w.reloadPerRound ?? 0.42)) + 1) - (t < lead + (w.reloadPerRound ?? 0.42) ? 1 : 0));
        }
      }
      if (anim === 'swap') s.raise = Math.min(1, (t % 1.2) / 0.6);
      if (anim === 'charge') s.charge = Math.min(1, t / 0.6);
      if (anim === 'scoped') {
        s.ads = 1;
        s.scoped = true;
      }
      vm.update(dt, s);
      mv.update(dt, runtimeState(def, camera, t, null));
    },
  };
}

export { THREE };

// ── view=characters ─────────────────────────────────────────────────────────
// Implemented in views-characters.ts (lazy import keeps this module small).

extraViews.characters = async (ctx: PreviewContext): Promise<PreviewView> => (await import('./views-characters')).charactersView(ctx);

// ── view=effects ────────────────────────────────────────────────────────────

import { EffectsSystem } from '../engine/effects';
import type { SurfaceTag } from '../../shared/types';

extraViews.effects = effectsView;

async function effectsView(ctx: PreviewContext): Promise<PreviewView> {
  const { def, mv } = await loadMap(ctx, ctx.params.get('map') ?? 'range');
  const fx = new EffectsSystem(mv.scene, ctx.engine.quality);
  const group = ctx.params.get('fx') ?? 'combat';
  const camera = makeCamera(ctx, 55);
  camera.position.set(0, 1.7, -1.5);
  camera.lookAt(0, 1.0, -8);
  const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  const fire = (): void => {
    if (group === 'impacts') {
      const surfaces: (SurfaceTag | 'player' | 'shield')[] = ['metal', 'concrete', 'sand', 'wood', 'snow', 'water', 'foliage', 'player', 'glass', 'rock'];
      surfaces.forEach((s, i) => fx.impact(V(((i % 5) - 2) * 1.3, i < 5 ? 1.5 : 0.6, -6), V(0, 0, 1), s));
    } else if (group === 'elims') {
      const styles = ['default', 'default', 'embers', 'origami', 'starfall', 'prism'];
      styles.forEach((id, i) => fx.elimination({ x: (i - 2.5) * 1.5, y: 0, z: -7 }, 0, (i === 1 ? 1 : 0) as 0 | 1, (i === 1 ? 1 : 0) as 0 | 1, id, 0));
    } else {
      fx.muzzleFlash(V(-1.2, 1.3, -4.5), V(0.6, 0, -1).normalize(), 'meridian', false);
      fx.muzzleFlash(V(-2.4, 1.1, -5), V(1, 0.1, 0.2).normalize(), 'breaker', false);
      for (let i = 0; i < 5; i++) fx.tracer(V(-2 + i * 0.2, 1.5, -2), V(-4 + i * 2, 1 + i * 0.2, -40), 'meridian', 0);
      fx.tracer(V(2, 1.6, -2), V(4, 1.2, -60), 'longline', 1);
      fx.beam(V(1.5, 1.4, -2.5), V(2.5, 1.3, -30), 1);
      fx.explosion(V(-3, 0, -12));
      fx.smokeStart(1, V(4, 0, -12));
      fx.smokeUpdate(1, V(4, 0, -12), 4, 10);
      fx.spawnFlash({ x: -1, y: 0, z: -7 }, 0);
      fx.projectile(7, 'grenade', V(0.6, 0.8, -4), 0);
      fx.projectile(8, 'smoke', V(-0.5, 0.7, -4), 0);
      fx.dust(V(0.5, 0, -5), 1, 'sand');
    }
  };
  let last = -10;
  return {
    scene: mv.scene,
    camera,
    update(dt, t) {
      if (t - last > 2.5) {
        last = t;
        fire();
      }
      fx.update(dt, camera);
      mv.update(dt, runtimeState(def, camera, t, null));
    },
  };
}

// ── view=touch ──────────────────────────────────────────────────────────────

import { Input } from '../input/input';
import { defaultSettings } from '../state/settings';

extraViews.touch = async (ctx: PreviewContext): Promise<PreviewView> => {
  const v = await viewmodelView(ctx);
  const s = defaultSettings();
  s.autoSprint = true;
  const input = new Input(ctx.canvas, () => s);
  input.setGameplayActive(true);
  input.setTouchControlsVisible(true);
  (window as unknown as { __input: Input }).__input = input;
  const hud = document.getElementById('hud');
  const base = v.update;
  return {
    ...v,
    update(dt, t) {
      base(dt, t);
      const m = input.moveAxes();
      const l = input.consumeLook();
      if (hud && ctx.params.get('stats') === '1') hud.textContent = `device ${input.device} move ${m.x.toFixed(2)},${m.y.toFixed(2)} look ${l.dx.toFixed(3)},${l.dy.toFixed(3)} fire ${input.down('fire')} sprint ${input.down('sprint')}`;
      input.endFrame();
    },
  };
};

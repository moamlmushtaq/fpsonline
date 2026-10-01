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
// fx=combat|impacts|elims|elim   (elim: one close-up, style=bloom|halcyon|embers|origami|starfall|prism)
// body=1   stand real characters on the elimination spots until the dissolve fires
// cycle=<s> refire period (default 2.5 s; 4 s for eliminations). Fires at t = 0.
// freeze=1  stop the effects at the warm-up time `t` (exact-time screenshots)

import { EffectsSystem } from '../engine/effects';
import { Characters } from '../world/characters';
import { defaultCosmetics } from '../../shared/cosmetics';
import type { CharacterAnim, CharacterView } from '../contracts';
import type { Faction, SurfaceTag, Team } from '../../shared/types';

extraViews.effects = effectsView;

const ELIM_STYLES: Record<string, { id: string; faction: Faction }> = {
  bloom: { id: 'default', faction: 1 },
  halcyon: { id: 'default', faction: 0 },
  embers: { id: 'embers', faction: 0 },
  origami: { id: 'origami', faction: 1 },
  starfall: { id: 'starfall', faction: 0 },
  prism: { id: 'prism', faction: 1 },
};

async function effectsView(ctx: PreviewContext): Promise<PreviewView> {
  const { def, mv } = await loadMap(ctx, ctx.params.get('map') ?? 'range');
  const fx = new EffectsSystem(mv.scene, ctx.engine.quality);
  const group = ctx.params.get('fx') ?? 'combat';
  const camera = makeCamera(ctx, 55);
  camera.position.set(0, 1.7, -1.5);
  camera.lookAt(0, 1.0, -8);
  const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  // Elimination spots: the six styles in a row, or one close-up.
  const spots: { x: number; z: number; id: string; faction: Faction; team: Team; yaw: number }[] = [];
  if (group === 'elims') {
    ['bloom', 'halcyon', 'embers', 'origami', 'starfall', 'prism'].forEach((k, i) => {
      const st = ELIM_STYLES[k];
      spots.push({ x: (i - 2.5) * 1.7, z: -7.5, id: st.id, faction: st.faction, team: st.faction as Team, yaw: Math.PI - 0.4 });
    });
    camera.position.set(0, 1.5, -0.8);
    camera.lookAt(0, 1.0, -7.5);
  } else if (group === 'elim') {
    const st = ELIM_STYLES[ctx.params.get('style') ?? 'halcyon'] ?? ELIM_STYLES.halcyon;
    // 3/4 view: the body faces the camera, turned 30° to its left.
    spots.push({ x: 0, z: -6, id: st.id, faction: st.faction, team: st.faction as Team, yaw: Math.atan2(-0.6, -3.8) + 0.5 });
    camera.fov = 40;
    camera.position.set(0.6, 1.35, -2.2);
    camera.lookAt(0, 0.95, -6);
  }
  camera.updateProjectionMatrix();
  // Optional stand-ins: real characters that vanish when their dissolve fires.
  const bodies: { v: CharacterView; a: CharacterAnim }[] = [];
  if (ctx.params.get('body') === '1' && spots.length) {
    const chars = new Characters(ctx.materials, ctx.weapons);
    for (const sp of spots) {
      const v = chars.create({ faction: sp.faction, team: sp.team, cosmetics: defaultCosmetics(), friendly: false, quality: ctx.engine.quality });
      v.root.position.set(sp.x, 0, sp.z);
      v.setWeapon('meridian', 'factory');
      mv.scene.add(v.root);
      const a: CharacterAnim = { vel: { x: 0, y: 0, z: 0 }, yaw: sp.yaw, pitch: 0, crouch: 0, sliding: false, airborne: false, sprinting: false, ads: false, reloading: false, mantling: false, charging: false, weapon: 'meridian', alive: true };
      bodies.push({ v, a });
    }
  }
  const fire = (): void => {
    if (group === 'impacts') {
      const surfaces: (SurfaceTag | 'player' | 'shield')[] = ['metal', 'concrete', 'sand', 'wood', 'snow', 'water', 'foliage', 'player', 'glass', 'rock'];
      surfaces.forEach((s, i) => fx.impact(V(((i % 5) - 2) * 1.3, i < 5 ? 1.5 : 0.6, -6), V(0, 0, 1), s));
    } else if (spots.length) {
      spots.forEach((sp) => fx.elimination({ x: sp.x, y: 0, z: sp.z }, sp.yaw, sp.faction, sp.team, sp.id, 0));
      for (const b of bodies) b.v.die();
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
  const cycle = Number(ctx.params.get('cycle') ?? (spots.length ? 4 : 2.5)) || 2.5;
  // With stand-ins the first dissolve waits 0.5 s (t=0 shows the bodies).
  const firstAt = bodies.length ? 0.5 : 0;
  let last = firstAt - cycle;
  const freezeAt = ctx.params.get('freeze') === '1' ? Number(ctx.params.get('t') ?? 0) + 1e-3 : Infinity;
  return {
    scene: mv.scene,
    camera,
    update(dt, t) {
      if (t > freezeAt) {
        // Frozen: re-submit the same particle state (dt = 0) so the frame stays drawable.
        fx.update(0, camera);
        return;
      }
      if (t >= firstAt && t - last >= cycle - 1e-6) {
        last = t;
        for (const b of bodies) b.v.respawn();
        fire();
      }
      for (const b of bodies) if (b.v.root.visible) b.v.update(dt, b.a);
      fx.update(dt, camera);
      mv.update(dt, runtimeState(def, camera, t, null));
      (window as unknown as { __fxCounts?: unknown }).__fxCounts = fx.liveCounts;
    },
  };
}

// ── view=finale / view=intro (deterministic match cameras; views-finale.ts) ──

extraViews.finale = async (ctx: PreviewContext): Promise<PreviewView> => (await import('./views-finale')).finaleView(ctx);
extraViews.intro = async (ctx: PreviewContext): Promise<PreviewView> => (await import('./views-finale')).introView(ctx);

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

// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — preview harness: view=characters (dev only).
//
// URL parameters (plus the global ones in preview.ts: quality, colorblind, t, stats):
//   layout=lineup|hero|visors|dist|range|anim|perf (default lineup)
//     lineup — both factions × all six visor styles × armour tints
//     hero   — one character, menu showcase detail (cam=full|face|back|three)
//     visors — every visor shape on both factions, head-and-shoulders
//     dist   — silhouette test at `d` metres (default 20) from a gameplay camera
//     range  — pairs at 10 / 20 / 40 / 60 / 80 m in one frame
//     anim   — four characters performing `anim` (side view by default)
//     strip  — onion skin: n=<count> copies of faction's character doing `anim`,
//              each step=<s> seconds further into the cycle (one-shot sequence)
//     perf   — 5v5 running around; measures draw calls / triangles / CPU ms
//     far    — far-readability test: both factions at `d` metres (default 60)
//              in five poses each (front, side, back, run, crouch) from a
//              gameplay camera (60° vfov); combine with sil=1 and map=…
//     inmap  — the REAL map (map=…) seen from zone from=A|B|C|spawn toward
//              zone to=… (yaw=<offset rad>): Halcyon / Bloom pairs at 12–80 m along the
//              view, snapped to the ground — in-match lighting, haze, clutter
//   sil=1   silhouette render: characters flat black on white (shape-only test)
//   faction=0|1  weapon=<WeaponId>  armor=<id>  visor=<id>
//   anim=idle|walk|run|sprint|strafe|back|crouch|crouchwalk|slide|air|mantle|
//        reload|ads|adswalk|fire|charge|aimup|aimdown|turn|flinch|spawn
//   d=<metres>  move=1 (translate walkers — foot planting check)
//   showcase=1|0  map=<MapId> (lighting)  ground=<SurfaceTag>
//   cam=front|side|back|three|face|x,y,z,tx,ty,tz  yaw=<radians>
// Exposes window.__charInfo = { perChar: {drawCalls, triangles}[], sceneCalls, … }.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { CharacterAnim } from '../contracts';
import type { Faction, MapId, SurfaceTag, Team, WeaponId } from '../../shared/types';
import { WEAPONS } from '../../shared/weapons';
import { defaultCosmetics, VISOR_STYLES } from '../../shared/cosmetics';
import { getMap } from '../../shared/maps/index';
import { createAtmosphere } from '../engine/atmosphere';
import { boxProjectUVs } from '../engine/materials';
import { Characters, type CharacterInstance } from '../world/characters';
import { loadMap, makeCamera, parseCam, runtimeState, type PreviewContext, type PreviewView } from './views';

declare global {
  interface Window {
    __charInfo?: unknown;
  }
}

interface Actor {
  v: CharacterInstance;
  a: CharacterAnim;
  anim: string;
  home: THREE.Vector3;
  /** Circle/lap motion for perf layout. */
  orbit?: { c: THREE.Vector3; r: number; w: number; ph: number };
  lastFire: number;
  lastEvent: number;
}

const SIL_BG = new THREE.Color(0xffffff);

const SPEEDS: Record<string, number> = {
  walk: 3.3, adswalk: 3.3, run: 5.4, strafe: 5.4, back: 4.6, sprint: 7.8, crouchwalk: 2.9, slide: 9.5, air: 5.4, mantle: 2,
};

function baseAnim(weapon: WeaponId): CharacterAnim {
  return {
    vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, crouch: 0, sliding: false, airborne: false, sprinting: false,
    ads: false, reloading: false, mantling: false, charging: false, weapon, alive: true,
  };
}

/** Apply a named animation state (static part) to an anim record; yaw = facing. */
function applyAnim(a: CharacterAnim, anim: string, yaw: number): void {
  a.yaw = yaw;
  const sp = SPEEDS[anim] ?? 0;
  // Direction relative to facing: forward (−Z local) by default.
  let lx = 0, lz = -1;
  if (anim === 'strafe') {
    lx = 1;
    lz = 0;
  } else if (anim === 'back') lz = 1;
  const s = Math.sin(yaw), c = Math.cos(yaw);
  a.vel.x = (lx * c + lz * s) * sp;
  a.vel.z = (-lx * s + lz * c) * sp;
  a.crouch = anim === 'crouch' || anim === 'crouchwalk' ? 1 : 0;
  a.sliding = anim === 'slide';
  a.airborne = anim === 'air';
  a.sprinting = anim === 'sprint';
  a.ads = anim === 'ads' || anim === 'adswalk';
  a.mantling = anim === 'mantle';
  a.pitch = anim === 'aimup' ? 0.7 : anim === 'aimdown' ? -0.6 : 0;
  a.charging = anim === 'charge';
}

export async function charactersView(ctx: PreviewContext): Promise<PreviewView> {
  const P = ctx.params;
  const layout = P.get('layout') ?? 'lineup';
  if (layout === 'inmap') return inMapView(ctx);
  const anim = P.get('anim') ?? 'idle';
  const scene = new THREE.Scene();
  const def = getMap((P.get('map') ?? (layout === 'hero' ? 'gantry' : 'pastel')) as MapId);
  const atmo = createAtmosphere(scene, def.lighting, ctx.engine.quality);
  const groundTag = (P.get('ground') ?? (layout === 'anim' || layout === 'strip' ? 'tile' : 'concrete')) as SurfaceTag;
  const groundGeo = new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2);
  boxProjectUVs(groundGeo, groundTag === 'tile' ? 'tile' : 'concrete');
  const ground = new THREE.Mesh(groundGeo, ctx.materials.surface(groundTag));
  ground.receiveShadow = true;
  scene.add(ground);

  const chars = new Characters(ctx.materials, ctx.weapons);
  const q = ctx.engine.quality;
  const showcaseParam = P.get('showcase');
  const actors: Actor[] = [];
  const add = (faction: Faction, team: Team, opts: { armor?: string; visor?: string; weapon?: WeaponId; showcase?: boolean; pos: [number, number, number]; yaw: number; anim?: string }): Actor => {
    const cos = defaultCosmetics();
    cos.armor = opts.armor ?? P.get('armor') ?? 'standard';
    cos.visor = opts.visor ?? P.get('visor') ?? 'band';
    const weapon = (opts.weapon ?? P.get('weapon') ?? 'meridian') as WeaponId;
    const showcase = showcaseParam !== null ? showcaseParam === '1' : !!opts.showcase;
    const v = chars.create({ faction, team, cosmetics: cos, friendly: team === 0, quality: q, showcase });
    v.root.position.set(...opts.pos);
    scene.add(v.root);
    const a = baseAnim(weapon);
    const an = opts.anim ?? anim;
    applyAnim(a, an, opts.yaw);
    v.setWeapon(weapon, 'factory');
    const act: Actor = { v, a, anim: an, home: v.root.position.clone(), lastFire: -1, lastEvent: -1 };
    actors.push(act);
    return act;
  };

  const camera = makeCamera(ctx, 36);
  const faction = Number(P.get('faction') ?? 0) as Faction;
  const yawP = P.get('yaw');
  const weapons: WeaponId[] = ['meridian', 'longline', 'breaker', 'swift', 'pulse', 'sunspear'];
  const aim = (pos: [number, number, number], target: [number, number, number], fov: number): void => {
    camera.position.set(...pos);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.lookAt(...target);
  };

  switch (layout) {
    case 'hero': {
      const yaw = yawP !== null ? Number(yawP) : -0.55;
      add(faction, faction as Team, { pos: [0, 0, 0], yaw, showcase: true });
      const cam = P.get('cam') ?? 'full';
      if (cam === 'face') aim([0.35, 1.72, -1.05], [0, 1.66, 0], 30);
      else if (cam === 'back') aim([0.9, 1.5, 2.9], [0, 1.05, 0], 36);
      else if (cam === 'three') aim([-2.2, 1.4, -2.4], [0, 1.0, 0], 36);
      else aim([0.6, 1.25, -3.9], [0, 0.98, 0], 36);
      break;
    }
    case 'dist': {
      const d = Number(P.get('d') ?? 20);
      const sp = Math.max(1.3, d * 0.06);
      add(0, 0, { pos: [-1.5 * sp, 0, -d], yaw: Math.PI + 0.35, anim: 'idle', weapon: 'meridian' });
      add(1, 1, { pos: [-0.5 * sp, 0, -d], yaw: Math.PI - 0.35, anim: 'idle', weapon: 'swift' });
      add(0, 0, { pos: [0.5 * sp, 0, -d], yaw: -Math.PI / 2, anim: 'run', weapon: 'longline' });
      add(1, 1, { pos: [1.5 * sp, 0, -d], yaw: Math.PI / 2, anim: 'run', weapon: 'breaker' });
      aim([0, 1.62, 0], [0, 1.1, -d], 60);
      break;
    }
    case 'range': {
      [10, 20, 40, 60, 80].forEach((d, i) => {
        const x = (i - 2) * d * 0.16;
        add(0, 0, { pos: [x - 0.7, 0, -d], yaw: Math.PI + 0.3, anim: 'idle', weapon: weapons[i % 4] });
        add(1, 1, { pos: [x + 0.7, 0, -d], yaw: Math.PI - 0.3, anim: 'idle', weapon: weapons[(i + 1) % 4] });
      });
      aim([0, 1.62, 0], [0, 1.3, -40], 60);
      break;
    }
    case 'anim': {
      const side = -Math.PI / 2;
      const list: [Faction, WeaponId][] = [[0, 'meridian'], [1, 'swift'], [0, 'breaker'], [1, anim === 'charge' ? 'sunspear' : 'pulse']];
      list.forEach(([f, w], i) => add(f, f as Team, { pos: [(i - 1.5) * 1.6, 0, 0], yaw: yawP !== null ? Number(yawP) : side, weapon: (P.get('weapon') as WeaponId) ?? (anim === 'charge' ? 'sunspear' : w) }));
      const cam = P.get('cam') ?? 'side';
      if (cam === 'front') aim([0, 1.3, -8.5], [0, 0.95, 0], 30);
      else if (cam === 'three') aim([-5.5, 1.8, -6.5], [0, 0.9, 0], 32);
      else aim([0, 1.2, 8.5], [0, 0.95, 0], 30);
      break;
    }
    case 'strip': {
      // Onion-skin strip: n copies of one character performing `anim`, each
      // pre-advanced by i·step seconds — a whole gait/reload cycle in ONE
      // screenshot (foot placement, stride, weapon choreography).
      const n = Math.max(2, Math.min(10, Number(P.get('n') ?? 6)));
      const step = Number(P.get('step') ?? 0.1);
      const yaw = yawP !== null ? Number(yawP) : -Math.PI / 2;
      for (let i = 0; i < n; i++) {
        const act = add(faction, faction as Team, { pos: [(i - (n - 1) / 2) * 1.05, 0, 0], yaw });
        act.a.reloading = anim === 'reload';
        const pre = Math.round((i * step) / (1 / 60));
        for (let s = 0; s < pre; s++) act.v.update(1 / 60, act.a);
      }
      aim([0, 1.0, 9.5], [0, 0.9, 0], 34);
      break;
    }
    case 'visors': {
      // Head-and-shoulders comparison of every visor shape, both factions.
      VISOR_STYLES.forEach((vs, i) => add(faction, faction as Team, { pos: [(i - 2.5) * 0.62, 0, 0], yaw: 0, visor: vs.id, anim: 'idle', weapon: 'pulse' }));
      aim([0, 1.5, -4.4], [0, 1.4, 0.6], 26);
      break;
    }
    case 'far': {
      // Halcyon row on the left, Bloom on the right, same five poses each.
      const d = Number(P.get('d') ?? 60);
      const sp = Math.max(1.1, d * 0.045);
      const poses: [string, number][] = [['idle', Math.PI], ['idle', -Math.PI / 2], ['idle', 0], ['run', Math.PI / 2], ['crouch', Math.PI + 0.6]];
      for (const f of [0, 1] as Faction[]) {
        poses.forEach(([an, yaw], i) => {
          const x = (f === 0 ? -5.6 : 0.6) * sp + i * sp;
          add(f, f as Team, { pos: [x, 0, -d], yaw, anim: an, weapon: f === 0 ? 'meridian' : 'swift' });
        });
      }
      aim([0, 1.62, 0], [0, 1.1, -d], 60);
      break;
    }
    case 'perf': {
      for (let i = 0; i < 10; i++) {
        const f = (i % 2) as Faction;
        const r = 3 + (i % 5) * 1.8;
        const c = new THREE.Vector3(((i % 5) - 2) * 7, 0, -16 - (i % 3) * 9);
        const an = ['run', 'sprint', 'crouchwalk', 'adswalk', 'run'][i % 5];
        const act = add(f, f as Team, { pos: [c.x + r, 0, c.z], yaw: 0, anim: an, weapon: weapons[i % 6], visor: VISOR_STYLES[i % 6].id });
        act.orbit = { c, r, w: (SPEEDS[an] ?? 5) / r, ph: i * 0.7 };
      }
      aim([0, 1.7, 2], [0, 1.0, -20], 60);
      break;
    }
    default: {
      // Lineup: Halcyon front row, Bloom second row — every visor, several tints.
      const tints = ['standard', 'sandstone', 'slate', 'sage', 'terracotta', 'graphite'];
      VISOR_STYLES.forEach((vs, i) => {
        add(0, 0, { pos: [(i - 2.5) * 1.25, 0, 0], yaw: Math.PI + 0.35, visor: vs.id, armor: tints[i], weapon: weapons[i] });
        add(1, 1, { pos: [(i - 2.5) * 1.25 + 0.6, 0, -2.4], yaw: Math.PI + 0.35, visor: vs.id, armor: tints[(i + 3) % 6], weapon: weapons[(i + 2) % 6] });
      });
      const cam = P.get('cam');
      if (cam === 'close') aim([-1.2, 1.55, 3.3], [-1.9, 1.2, 0], 34);
      else aim([0, 2.2, 11], [0, 0.85, -1.2], 36);
    }
  }
  const explicit = parseCam(P.get('cam'));
  if (explicit) {
    camera.position.copy(explicit.pos);
    camera.lookAt(explicit.target);
  }

  // Silhouette test: only the characters, flat black on white.
  const sil = P.get('sil') === '1';
  if (sil) {
    const roots = new Set<THREE.Object3D>(actors.map((x) => x.v.root));
    for (const o of scene.children) if (!roots.has(o)) o.visible = false;
    scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
  }
  const move = P.get('move') === '1' || (layout === 'anim' && P.get('move') !== '0');
  // (strip keeps the copies in place so their phases stay comparable)
  const info = { perChar: actors.map((x) => x.v.stats()), heads: [] as unknown[], skate: {} as unknown, sceneCalls: 0, baselineCalls: 0, charCalls: 0, triangles: 0, cpuMs: 0, preset: q.preset };
  window.__charInfo = info;
  const hudEl = document.createElement('div');
  hudEl.style.cssText = 'position:fixed;right:8px;top:6px;opacity:.75;pointer-events:none;white-space:pre;text-align:right;text-shadow:0 1px 2px #000;font:11px/1.35 ui-monospace,monospace;color:#f3ece0';
  if (P.get('stats') === '1') document.body.appendChild(hudEl);
  let frame = 0;
  const footNow = [new THREE.Vector3(), new THREE.Vector3()];
  const footPrev = [new THREE.Vector3(), new THREE.Vector3()];
  const footPrevOk = [false, false];
  const rootPrev = new THREE.Vector3();
  let skateDist = 0;
  let skateTime = 0;
  let cpuAcc = 0;
  let cpuN = 0;
  const up = new THREE.Vector3();

  return {
    scene,
    camera,
    update(dt, t) {
      frame++;
      // Baseline draw calls with characters hidden (perf layout, until the harness is ready).
      const hide = layout === 'perf' && !window.__previewReady;
      if (layout === 'perf' && window.__previewReady && !info.baselineCalls) info.baselineCalls = ctx.engine.stats.calls;
      for (const x of actors) x.v.root.visible = !hide && x.a.alive;
      const t0 = performance.now();
      for (const x of actors) {
        const a = x.a;
        const w = WEAPONS[a.weapon];
        if (x.orbit) {
          const o = x.orbit;
          const ang = o.ph + t * o.w;
          x.v.root.position.set(o.c.x + Math.cos(ang) * o.r, 0, o.c.z + Math.sin(ang) * o.r);
          // Tangent velocity; facing = direction of travel (yaw 0 looks −Z).
          const sp = SPEEDS[x.anim] ?? 5;
          a.vel.x = -Math.sin(ang) * sp;
          a.vel.z = Math.cos(ang) * sp;
          a.yaw = Math.atan2(-a.vel.x, -a.vel.z);
        } else if (move && (SPEEDS[x.anim] ?? 0) > 0) {
          x.v.root.position.x += a.vel.x * dt;
          x.v.root.position.z += a.vel.z * dt;
          const off = up.subVectors(x.v.root.position, x.home);
          if (off.length() > 3.2) x.v.root.position.copy(x.home).addScaledVector(off.normalize(), -3.2);
        }
        if (x.anim === 'turn') a.yaw = (yawP !== null ? Number(yawP) : -Math.PI / 2) + Math.sin(t * 0.9) * 1.6;
        if (x.anim === 'air') {
          a.vel.y = 5 * Math.cos(t * 2.4);
          x.v.root.position.y = Math.max(0, 0.9 * Math.sin(t * 2.4));
        }
        if (x.anim === 'fire' || x.anim === 'charge') {
          const every = x.anim === 'charge' ? 1.6 : Math.max(0.14, 60 / w.rpm);
          if (t - x.lastFire >= every) {
            x.lastFire = t;
            x.v.fire();
          }
          if (x.anim === 'charge') a.charging = (t % 1.6) < 0.9;
        }
        if (x.anim === 'reload') {
          const dur = (w.reloadPerRound ? w.reloadTime * 0.25 + w.reloadPerRound * 3 : w.reloadTime) + 0.6;
          a.reloading = w.reloadTime > 0 && t % dur < dur - 0.6;
        }
        if (x.anim === 'flinch' && t - x.lastEvent > 1.1) {
          x.lastEvent = t;
          x.v.flinch({ x: Math.sin(t * 3), y: 0, z: Math.cos(t * 3) });
        }
        if (x.anim === 'spawn' && t - x.lastEvent > 2.2) {
          x.lastEvent = t;
          x.v.respawn();
        }
        x.v.update(dt, a);
      }
      cpuAcc += performance.now() - t0;
      // Foot-skate probe (first actor): world speed of the planted foot vs body speed.
      if (layout === 'anim' && actors[0]) {
        const r0 = actors[0].v.root;
        r0.updateMatrixWorld(true);
        for (let i = 0; i < 2; i++) {
          const f = r0.getObjectByName(i ? 'footR' : 'footL');
          if (!f) continue;
          const p = f.getWorldPosition(footNow[i]);
          const teleported = r0.position.distanceTo(rootPrev) > 1;
          if (p.y - r0.position.y < 0.1 && footPrevOk[i] && dt > 0 && !teleported) {
            skateDist += Math.hypot(p.x - footPrev[i].x, p.z - footPrev[i].z);
            skateTime += dt;
          }
          footPrevOk[i] = p.y - r0.position.y < 0.1;
          footPrev[i].copy(p);
        }
        rootPrev.copy(r0.position);
        const bodySp = Math.hypot(actors[0].a.vel.x, actors[0].a.vel.z);
        info.skate = { plantedFootSpeed: skateTime ? +(skateDist / skateTime).toFixed(3) : 0, bodySpeed: +bodySp.toFixed(2), samples: Math.round(skateTime * 60) };
      }
      cpuN++;
      if (cpuN >= 30) {
        info.cpuMs = cpuAcc / cpuN;
        cpuAcc = 0;
        cpuN = 0;
      }
      atmo.update(dt, camera, 0);
      if (sil) {
        scene.background = SIL_BG;
        scene.fog = null;
      }
      if (window.__previewReady && frame % 10 === 0) {
        info.perChar = actors.map((x) => x.v.stats());
        // Head centre relative to the feet (hitbox check: head sphere at y≈1.69, r 0.23, centred on x/z).
        info.heads = actors.slice(0, 4).map((x) => {
          const h = x.v.headWorld(new THREE.Vector3()).sub(x.v.root.position);
          const yaw = x.a.yaw;
          const fwd = -(h.x * -Math.sin(yaw) + h.z * -Math.cos(yaw));
          return { f: x.v.faction, y: +h.y.toFixed(3), forward: +(-fwd).toFixed(3), lateral: +(h.x * Math.cos(yaw) - h.z * Math.sin(yaw)).toFixed(3) };
        });
        info.sceneCalls = ctx.engine.stats.calls;
        info.charCalls = info.baselineCalls ? info.sceneCalls - info.baselineCalls : 0;
        info.triangles = ctx.engine.stats.triangles;
      }
      if (hudEl.isConnected && frame % 15 === 0) {
        const pc = info.perChar;
        const tri = pc.map((p) => p.bodyTriangles);
        const wtri = pc.map((p) => p.weaponTriangles);
        hudEl.textContent =
          `${layout} ${anim} · ${q.preset}\n` +
          `per char: draws ${pc[0]?.drawCalls ?? 0} (weapon ${pc[0]?.weaponDrawCalls ?? 0})  body tris ${Math.min(...tri)}–${Math.max(...tri)}  weapon tris ${Math.min(...wtri)}–${Math.max(...wtri)}\n` +
          (layout === 'perf' ? `10 chars: +${info.charCalls} calls (incl. shadows)  cpu ${info.cpuMs.toFixed(2)} ms/frame` : `cpu ${info.cpuMs.toFixed(2)} ms/frame`);
      }
    },
  };
}

/** layout=inmap: factions at 12–80 m inside a real map, from a team-0 spawn. */
async function inMapView(ctx: PreviewContext): Promise<PreviewView> {
  const P = ctx.params;
  const { def, mv } = await loadMap(ctx, P.get('map') ?? 'gantry');
  const scene = mv.scene;
  scene.updateMatrixWorld(true);
  const camera = makeCamera(ctx, 60);
  // Viewpoint: Launch Control zone `from` (default A — open ground) looking
  // toward zone `to` (default B), or a team-0 spawn (from=spawn).
  const zone = (id: string) => def.zones.find((z) => z.id === id);
  const fromId = P.get('from') ?? 'A';
  const own = def.spawns.filter((s) => s.team === 0);
  const sp = own[Number(P.get('spawn') ?? 0) % Math.max(1, own.length)] ?? def.spawns[0];
  const zf = fromId === 'spawn' ? null : zone(fromId);
  const zt = zone(P.get('to') ?? 'B');
  const s0 = { pos: zf ? zf.center : sp.pos };
  camera.position.set(s0.pos.x, s0.pos.y + 1.62, s0.pos.z);
  const fx = zt ? zt.center.x : 0, fz = zt ? zt.center.z : 0;
  const ang = Math.atan2(fx - s0.pos.x, fz - s0.pos.z) + Number(P.get('yaw') ?? 0);
  const dx = Math.sin(ang), dz = Math.cos(ang);
  const ray = new THREE.Raycaster();
  ray.camera = camera; // sprites need it
  const down = new THREE.Vector3(0, -1, 0);
  const o = new THREE.Vector3();
  const groundAt = (x: number, z: number): number | null => {
    o.set(x, s0.pos.y + 2.5, z);
    ray.set(o, down);
    ray.far = 12;
    for (const h of ray.intersectObject(scene, true)) {
      const m = h.object as THREE.Mesh;
      if (!m.isMesh || !m.visible || !h.face || h.face.normal.y < 0.3) continue;
      return h.point.y;
    }
    return null;
  };
  const chars = new Characters(ctx.materials, ctx.weapons);
  const actors: { v: CharacterInstance; a: CharacterAnim }[] = [];
  const yawToCam = ang + Math.PI;
  [12, 25, 40, 60, 80].forEach((d, i) => {
    const off = Math.max(1.1, d * 0.05);
    for (const f of [0, 1] as Faction[]) {
      const side = f === 0 ? -1 : 1;
      const x = s0.pos.x + dx * d + dz * side * off;
      const z = s0.pos.z + dz * d - dx * side * off;
      const y = groundAt(x, z);
      if (y === null) continue;
      const cos = defaultCosmetics();
      const v = chars.create({ faction: f, team: f as Team, cosmetics: cos, friendly: false, quality: ctx.engine.quality });
      v.root.position.set(x, y, z);
      scene.add(v.root);
      const a = baseAnim(f === 0 ? 'meridian' : 'swift');
      // Odd rows run across the view (on a treadmill: the root stays put).
      applyAnim(a, i % 2 ? 'run' : 'idle', yawToCam + (i % 2 ? side * 1.4 : 0));
      actors.push({ v, a });
    }
  });
  camera.lookAt(camera.position.x + dx * 30, camera.position.y - 0.9, camera.position.z + dz * 30);
  window.__charInfo = { perChar: actors.map((x) => x.v.stats()), count: actors.length };
  return {
    scene,
    camera,
    update(dt, t) {
      for (const x of actors) x.v.update(dt, x.a);
      mv.update(dt, runtimeState(def, camera, t, null));
    },
  };
}

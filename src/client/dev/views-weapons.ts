// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — preview harness: weapon showroom + first-person viewmodel.
//
// view=weapons   lineup of all six (3×2) in one skin
//   &weapon=<id>        hero close-up of one weapon
//   &angle=hero|side|top|front|player   camera for the hero shot
//   &skins=1            one weapon in all four skins
//   &lod=view|world     model LOD (world = third person / loadout turntable)
//   &skin=<id>          skin for the lineup / hero
//   &spin=1             slow turntable
// view=viewmodel  first-person weapon over a map
//   &weapon=<id>&skin=<id>&map=<id>
//   &anim=idle|walk|sprint|slide|ads|fire|reload|reloadempty|swap|throw|charge|scoped|dry|land|look
//   &mag=<n>            starting magazine
//   &t=<s>              advance to t seconds and FREEZE there (&freeze=0 keeps running)
// Both print draw calls / triangles of the weapon (and hands) into #hud.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { ViewModelState } from '../contracts';
import type { WeaponId } from '../../shared/types';
import { WEAPON_IDS } from '../../shared/types';
import { WEAPON_SKINS } from '../../shared/cosmetics';
import { WEAPONS } from '../../shared/weapons';
import { reloadDuration } from '../../shared/combat';
import { ENV, teamColors } from '../engine/palette';
import { weaponStats, type WeaponModelView } from '../world/weapon-models';
import { FirstPersonViewModel, VM_POSES, VM_VIEW } from '../world/viewmodel';
import { loadMap, makeCamera, runtimeState, type PreviewContext, type PreviewView } from './views';

function hud(text: string): void {
  const el = document.getElementById('hud');
  if (el) el.textContent = text;
}

// ── Studio ──────────────────────────────────────────────────────────────────

function backdropTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 256;
  const x = c.getContext('2d') as CanvasRenderingContext2D;
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#3a3430');
  g.addColorStop(0.55, '#2a2522');
  g.addColorStop(1, '#171412');
  x.fillStyle = g;
  x.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function weaponStudio(ctx: PreviewContext, scene: THREE.Scene): void {
  const pmrem = new THREE.PMREMGenerator(ctx.engine.renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.4;
  scene.background = backdropTexture();
  // Golden-hour key (upper left, in front), cool sky fill (right), warm rim (behind).
  const key = new THREE.DirectionalLight('#ffd9ae', 2.3);
  key.position.set(-2.2, 3, 1.4);
  scene.add(key);
  const fill = new THREE.DirectionalLight('#a9c7da', 0.9);
  fill.position.set(2.5, 0.8, 1.5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight('#ffb070', 1.6);
  rim.position.set(0.5, 1.2, -3);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight('#f2e2c6', '#3b3430', 0.7));
  // Soft floor to ground the pieces.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: new THREE.Color(ENV.shadowWarm).multiplyScalar(0.55), roughness: 0.9 }));
  floor.position.y = -0.62;
  scene.add(floor);
}

// ── view=weapons ────────────────────────────────────────────────────────────

export function weaponsView(ctx: PreviewContext): PreviewView {
  const scene = new THREE.Scene();
  weaponStudio(ctx, scene);
  const camera = makeCamera(ctx, 30);
  const P = ctx.params;
  const skin = P.get('skin') ?? 'factory';
  const lod = (P.get('lod') as 'view' | 'world') ?? 'view';
  const only = P.get('weapon') as WeaponId | null;
  const skins = P.get('skins') === '1';
  const models: WeaponModelView[] = [];
  const stats: string[] = [];
  const place = (m: WeaponModelView, x: number, y: number, z: number): void => {
    // Centre each model on its bounding box so lengths read comparably.
    m.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m.root);
    const c = box.getCenter(new THREE.Vector3());
    m.root.position.set(x - c.x, y - c.y, z - c.z);
    scene.add(m.root);
    models.push(m);
  };
  if (only && skins) {
    WEAPON_SKINS.forEach((s, i) => {
      const m = ctx.weapons.create(only, s.id, lod);
      m.setAmmo(Math.round(WEAPONS[only].magSize * (0.35 + i * 0.2)), WEAPONS[only].magSize);
      m.setCharge(0.25 + i * 0.25);
      place(m, 0, 0.42 - i * 0.29, 0);
      stats.push(`${s.id}`);
    });
    camera.fov = 26;
    camera.position.set(-3.1, 0.35, -0.55);
    camera.lookAt(0, -0.02, -0.08);
  } else if (only) {
    const m = ctx.weapons.create(only, skin, lod);
    m.setAmmo(Math.round(WEAPONS[only].magSize * 0.7), WEAPONS[only].magSize);
    m.setCharge(Number(P.get('charge') ?? 0.6));
    place(m, 0, 0, 0);
    const st = weaponStats(m);
    stats.push(`${only} ${lod}: ${st.draws} draws, ${st.triangles} tris`);
    const angle = P.get('angle') ?? 'hero';
    const len = new THREE.Box3().setFromObject(m.root).getSize(new THREE.Vector3()).z;
    // Fit: the weapon's length spans ~78% of the frame width.
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect);
    const d = (len / 0.78) / (2 * Math.tan(hfov / 2)) * Number(P.get('zoom') ?? 1);
    if (angle === 'side') camera.position.set(-d, 0.02, 0);
    else if (angle === 'top') camera.position.set(-0.1, d * 1.05, 0.01);
    else if (angle === 'front') camera.position.set(-0.3, 0.14, -d * 0.8);
    else if (angle === 'player') camera.position.set(-0.22, 0.2, d * 0.55);
    else if (angle === 'three') camera.position.set(d * 0.75, d * 0.28, d * 0.45);
    else camera.position.set(-d * 0.78, d * 0.3, d * 0.5);
    camera.lookAt(0, 0, 0);
  } else {
    WEAPON_IDS.forEach((id, i) => {
      const m = ctx.weapons.create(id, skin, lod);
      m.setAmmo(Math.round(WEAPONS[id].magSize * 0.7), WEAPONS[id].magSize);
      m.setCharge(0.7);
      const col = i % 2, row = Math.floor(i / 2);
      place(m, 0, 0.36 - row * 0.36, (col - 0.5) * 1.25);
      const st = weaponStats(m);
      stats.push(`${id}: ${st.draws}d ${st.triangles}t`);
    });
    camera.position.set(-2.75, 0.4, 0);
    camera.lookAt(0, 0.0, 0);
  }
  camera.updateProjectionMatrix();
  hud(stats.join('   '));
  const spin = P.get('spin') === '1';
  return {
    scene,
    camera,
    update(dt, t) {
      for (const m of models) {
        m.tick(dt);
        if (spin) m.root.rotation.y = Math.sin(t * 0.5) * 0.7;
      }
    },
  };
}

// ── view=viewmodel ──────────────────────────────────────────────────────────

export async function viewmodelView(ctx: PreviewContext): Promise<PreviewView> {
  const P = ctx.params;
  const { def, mv } = await loadMap(ctx, P.get('map') ?? 'gantry');
  const camera = makeCamera(ctx, Number(P.get('fov') ?? 78));
  const sp = def.spawns.find((s) => s.team === 0) ?? def.spawns[0];
  camera.position.set(sp.pos.x, sp.pos.y + 1.62, sp.pos.z);
  camera.rotation.set(Number(P.get('pitch') ?? 0), sp.yaw + Number(P.get('yaw') ?? 0), 0, 'YXZ');
  // Live framing tuning: &hip=x,y,d &rot=rx,ry,rz &vfov=hip,ads
  const tw = (P.get('weapon') ?? 'meridian') as WeaponId;
  const nums = (k: string): number[] | null => (P.get(k) ? (P.get(k) as string).split(',').map(Number) : null);
  const hipQ = nums('hip'), rotQ = nums('rot'), fovQ = nums('vfov');
  if (hipQ?.length === 3) VM_POSES[tw].hip = hipQ as [number, number, number];
  if (rotQ?.length === 3) VM_POSES[tw].hipRot = rotQ as [number, number, number];
  if (fovQ) {
    VM_VIEW.fov = fovQ[0];
    if (fovQ[1]) VM_VIEW.adsFov = fovQ[1];
  }
  const vm = new FirstPersonViewModel(ctx.weapons, ctx.engine);
  vm.setTeamLight(teamColors(Number(P.get('team') ?? 0) as 0 | 1).primary);
  vm.setLighting?.(def.lighting);
  const weapon = (P.get('weapon') ?? 'meridian') as WeaponId;
  const skin = P.get('skin') ?? 'factory';
  const anim = P.get('anim') ?? 'idle';
  const w = WEAPONS[weapon];
  const interval = 60 / w.rpm;
  const empty = anim === 'reloadempty';
  const reloadMag = empty ? 0 : weapon === 'breaker' ? 2 : Math.round(w.magSize * 0.3);
  const reloadTime = reloadDuration(weapon, reloadMag);
  const s: ViewModelState = {
    weapon,
    skin,
    ads: anim === 'ads' || anim === 'scoped' ? 1 : 0,
    sprinting: anim === 'sprint',
    sliding: anim === 'slide',
    crouch: anim === 'slide' ? 1 : 0,
    speed: anim === 'sprint' ? 7.8 : anim === 'walk' ? 5.4 : anim === 'slide' ? 9 : 0,
    onGround: anim !== 'land',
    reload: -1,
    raise: 1,
    charge: 0,
    cycle: 1,
    mag: Number(P.get('mag') ?? Math.round(w.magSize * 0.7)),
    magSize: w.magSize,
    lookDx: 0,
    lookDy: 0,
    scoped: anim === 'scoped' && w.scoped,
  };
  let lastShot = -10;
  let reloadStarted = false;
  let thrown = false;
  let dried = false;
  const tris = (): string => {
    let draws = 0, tri = 0;
    vm.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible) return;
      let p: THREE.Object3D | null = m, vis = true;
      for (; p; p = p.parent) if (!p.visible) vis = false;
      if (!vis) return;
      draws++;
      tri += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    });
    return `${weapon} vm: ${draws} draws, ${Math.round(tri)} tris`;
  };
  let statT = 0;
  const freezeAt = P.has('t') && P.get('freeze') !== '0' ? Number(P.get('t')) : -1;
  if (P.get('hands') === '0') vm.scene.traverse((o) => {
    if (o.name.startsWith('glove.')) o.scale.setScalar(0);
  });
  return {
    scene: mv.scene,
    camera,
    overlay: { scene: vm.scene, camera: vm.camera },
    update(dt, t) {
      // With &t= the pose freezes at that instant so screenshots are exact.
      if (freezeAt >= 0 && t > freezeAt + 1e-6) return;
      if (anim === 'fire') {
        if (weapon === 'sunspear') {
          const k = t % 1.4;
          s.charge = Math.min(1, k / (w.chargeTime ?? 0.6));
          if (k >= (w.chargeTime ?? 0.6) && lastShot < t - 1) {
            lastShot = t;
            vm.fire();
            s.mag = Math.max(1, s.mag - 1);
            s.charge = 0;
          }
          if (t - lastShot < 0.8) s.charge = 0;
        } else if (t - lastShot >= interval) {
          lastShot = t;
          vm.fire();
          s.mag = Math.max(0, s.mag - 1);
        }
        s.cycle = Math.min(1, (t - lastShot) / interval);
      }
      if (anim === 'charge') s.charge = Math.min(1, t / (w.chargeTime ?? 0.6));
      if (anim === 'reload' || anim === 'reloadempty') {
        if (!reloadStarted) {
          reloadStarted = true;
          s.mag = reloadMag;
          vm.reloadStart(reloadMag === 0);
        }
        const k = t / reloadTime;
        if (k < 1) {
          s.reload = Math.min(0.999, k);
          if (w.reloadPerRound) {
            const lead = w.reloadTime * 0.25 + (empty ? w.reloadEmptyExtra : 0);
            s.mag = Math.min(w.magSize, reloadMag + Math.max(0, Math.floor((t - lead) / w.reloadPerRound)));
          }
        } else {
          s.reload = -1;
          s.mag = w.magSize;
        }
      }
      if (anim === 'swap') s.raise = Math.min(1, (t % 1.4) / w.swapTime);
      if (anim === 'throw' && !thrown && t > 0.05) {
        thrown = true;
        vm.throwStart('smoke');
      }
      if (anim === 'dry' && !dried && t > 0.05) {
        dried = true;
        s.mag = 0;
        vm.dryFire();
      }
      if (anim === 'land') s.onGround = t > 0.5;
      if (anim === 'look') {
        s.lookDx = Math.sin(t * 2.2) * 0.012;
        s.lookDy = Math.cos(t * 1.7) * 0.006;
      }
      if (anim === 'walk' || anim === 'sprint') {
        camera.position.x = sp.pos.x;
      }
      vm.update(dt, s);
      mv.update(dt, runtimeState(def, camera, t, null));
      statT -= dt;
      if (statT <= 0) {
        statT = 0.5;
        hud(tris());
      }
    },
  };
}

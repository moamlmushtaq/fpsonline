// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — preview harness scenes (dev only). One setup per `view=`.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getMap } from '../../shared/maps/index';
import type { MapDef } from '../../shared/maps/types';
import type { MapId, TargetSnap, WeaponId, ZoneSnap } from '../../shared/types';
import { WEAPON_IDS } from '../../shared/types';
import type { MapRuntimeState, MapView } from '../contracts';
import { createAtmosphere } from '../engine/atmosphere';
import { boxProjectUVs, Materials } from '../engine/materials';
import { ENV } from '../engine/palette';
import type { Renderer } from '../engine/renderer';
import { buildMapView } from '../world/map-builder';
import type { WeaponModels } from '../world/weapon-models';
import { extraViews } from './views-extra';

export interface PreviewContext {
  engine: Renderer;
  materials: Materials;
  weapons: WeaponModels;
  params: URLSearchParams;
  canvas: HTMLCanvasElement;
}

export interface PreviewView {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  overlay?: { scene: THREE.Scene; camera: THREE.PerspectiveCamera };
  update(dt: number, t: number): void;
}

export async function setupView(view: string, ctx: PreviewContext): Promise<PreviewView> {
  switch (view) {
    case 'map':
      return mapView(ctx);
    case 'weapons':
      return weaponsView(ctx);
    case 'materials':
      return materialsView(ctx);
    default: {
      const extra = extraViews[view];
      if (extra) return extra(ctx);
      throw new Error(`unknown view '${view}'`);
    }
  }
}

// ── Shared helpers ──────────────────────────────────────────────────────────

export function makeCamera(ctx: PreviewContext, fov = 60): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(fov, ctx.engine.size.aspect, 0.05, 600);
}

export function parseCam(spec: string | null): { pos: THREE.Vector3; target: THREE.Vector3 } | null {
  if (!spec) return null;
  const n = spec.split(',').map(Number);
  if (n.length !== 6 || n.some((x) => !Number.isFinite(x))) return null;
  return { pos: new THREE.Vector3(n[0], n[1], n[2]), target: new THREE.Vector3(n[3], n[4], n[5]) };
}

/** WASD/QE + drag-look free camera. */
export class FreeCam {
  private readonly keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private drag = false;
  constructor(private readonly cam: THREE.PerspectiveCamera, el: HTMLElement) {
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = e.x;
    window.addEventListener('keydown', (ev) => this.keys.add(ev.code));
    window.addEventListener('keyup', (ev) => this.keys.delete(ev.code));
    el.addEventListener('pointerdown', () => (this.drag = true));
    window.addEventListener('pointerup', () => (this.drag = false));
    window.addEventListener('pointermove', (ev) => {
      if (!this.drag) return;
      this.yaw -= ev.movementX * 0.004;
      this.pitch = THREE.MathUtils.clamp(this.pitch - ev.movementY * 0.004, -1.5, 1.5);
    });
  }
  update(dt: number): void {
    this.cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const sp = (this.keys.has('ShiftLeft') ? 40 : 10) * dt;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.cam.quaternion);
    const r = new THREE.Vector3(1, 0, 0).applyQuaternion(this.cam.quaternion);
    if (this.keys.has('KeyW')) this.cam.position.addScaledVector(f, sp);
    if (this.keys.has('KeyS')) this.cam.position.addScaledVector(f, -sp);
    if (this.keys.has('KeyD')) this.cam.position.addScaledVector(r, sp);
    if (this.keys.has('KeyA')) this.cam.position.addScaledVector(r, -sp);
    if (this.keys.has('KeyE')) this.cam.position.y += sp;
    if (this.keys.has('KeyQ')) this.cam.position.y -= sp;
  }
}

/** Synthesized runtime state so maps animate without a simulation. */
export function runtimeState(def: MapDef, camera: THREE.PerspectiveCamera, t: number, mode: string | null): MapRuntimeState {
  const zones: ZoneSnap[] =
    mode === 'control'
      ? def.zones.map((z, i) => ({
          id: z.id,
          owner: i === 0 ? 0 : i === 2 ? 1 : 2,
          progress: i === 0 ? -1 : i === 2 ? 1 : 0.55,
          capturing: i === 1 ? 1 : 2,
          contested: i === 1,
        }))
      : [];
  const targets: TargetSnap[] = (def.targets ?? []).map((d) => {
    const ph = d.path && d.period ? 0.5 - 0.5 * Math.cos((t / d.period) * Math.PI * 2) : 0;
    return {
      id: d.id,
      x: d.pos.x + (d.path?.x ?? 0) * ph,
      y: d.pos.y + (d.path?.y ?? 0) * ph,
      z: d.pos.z + (d.path?.z ?? 0) * ph,
      yaw: d.yaw,
      alive: d.id % 5 !== 3,
      hp: 1,
    };
  });
  return {
    time: t,
    matchElapsed: t,
    matchProgress: Math.min(1, Number(new URLSearchParams(location.search).get('progress') ?? 0.6)),
    phase: 'live',
    zones,
    pickups: def.pickups.map((p, i) => ({ id: p.id, available: i === 0, respawnIn: 0 })),
    targets,
    localTeam: 0,
    camera,
    rocketLaunch: null,
  };
}

// ── view=map ────────────────────────────────────────────────────────────────

export async function loadMap(ctx: PreviewContext, id: string): Promise<{ def: MapDef; mv: MapView }> {
  const def = getMap(id as MapId);
  const mv = await buildMapView(def, { engine: ctx.engine, materials: ctx.materials });
  return { def, mv };
}

async function mapView(ctx: PreviewContext): Promise<PreviewView> {
  const { def, mv } = await loadMap(ctx, ctx.params.get('map') ?? 'gantry');
  const camera = makeCamera(ctx);
  const camSpec = ctx.params.get('cam') ?? 'keyart';
  const explicit = parseCam(camSpec);
  if (explicit) {
    camera.position.copy(explicit.pos);
    camera.lookAt(explicit.target);
  } else {
    const kind = camSpec === 'free' ? 'intro' : (camSpec as 'intro' | 'keyart' | 'outro');
    const pose = mv.showcase(kind === 'intro' || kind === 'outro' || kind === 'keyart' ? kind : 'keyart');
    camera.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
  }
  const free = camSpec === 'free' ? new FreeCam(camera, ctx.canvas) : null;
  const mode = ctx.params.get('mode');
  return {
    scene: mv.scene,
    camera,
    update(dt, t) {
      free?.update(dt);
      mv.update(dt, runtimeState(def, camera, t, mode));
    },
  };
}

// ── view=weapons ────────────────────────────────────────────────────────────

export function studio(ctx: PreviewContext, scene: THREE.Scene): void {
  const pmrem = new THREE.PMREMGenerator(ctx.engine.renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  scene.background = new THREE.Color(ENV.shadowWarm).multiplyScalar(0.6);
  const key = new THREE.DirectionalLight('#ffe2bd', 2.6);
  key.position.set(-2, 3, 2);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#9cc3d5', 1.2);
  rim.position.set(2, 1, -3);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight('#f5e3c0', '#4a4038', 0.8));
}

function weaponsView(ctx: PreviewContext): PreviewView {
  const scene = new THREE.Scene();
  studio(ctx, scene);
  const camera = makeCamera(ctx, 30);
  const skin = ctx.params.get('skin') ?? 'factory';
  const only = ctx.params.get('weapon') as WeaponId | null;
  const ids = only ? [only] : WEAPON_IDS;
  const models = ids.map((id, i) => {
    const m = ctx.weapons.create(id, skin, (ctx.params.get('lod') as 'view' | 'world') ?? 'view');
    const col = ids.length === 1 ? 0 : i % 2;
    const row = ids.length === 1 ? 0 : Math.floor(i / 2);
    if (ids.length > 1) m.root.position.set(0, 0.55 - row * 0.42, (col - 0.5) * 1.25);
    m.root.rotation.y = 0;
    m.setAmmo(Math.round((i + 1) * 4), 30);
    m.setCharge(0.7);
    scene.add(m.root);
    return m;
  });
  camera.position.set(-3.6, 1.1, 0);
  camera.lookAt(0, 0.12, 0);
  if (only) {
    camera.position.set(-1.05, 0.42, 0.55);
    camera.lookAt(0, 0.03, -0.18);
  }
  return {
    scene,
    camera,
    update(_dt, t) {
      if (ctx.params.get('spin') === '1') for (const m of models) m.root.rotation.y = Math.sin(t * 0.5) * 0.6;
    },
  };
}

// ── view=materials ─────────────────────────────────────────────────────────

function materialsView(ctx: PreviewContext): PreviewView {
  const scene = new THREE.Scene();
  const def = getMap((ctx.params.get('map') ?? 'range') as MapId);
  const atmo = createAtmosphere(scene, def.lighting, ctx.engine.quality);
  const tags = ['concrete', 'metal', 'ceramic', 'wood', 'plaster', 'tile', 'glass', 'grass', 'dirt', 'sand', 'rock', 'snow', 'foliage', 'fabric'] as const;
  tags.forEach((tag, i) => {
    const g = new THREE.BoxGeometry(1.6, 1.6, 1.6);
    const m = new THREE.Mesh(g, ctx.materials.surface(tag));
    m.position.set((i % 7) * 2.3 - 7, 0.8 + Math.floor(i / 7) * 2.3, 0);
    m.rotation.y = 0.6;
    m.updateMatrixWorld();
    boxProjectUVs(g, 1.6);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), ctx.materials.surface('sand'));
  boxProjectUVs(ground.geometry, 'sand');
  ground.receiveShadow = true;
  scene.add(ground);
  const camera = makeCamera(ctx, 45);
  camera.position.set(0, 3.2, 12);
  camera.lookAt(0, 1.8, 0);
  return { scene, camera, update: (dt) => atmo.update(dt, camera, 0) };
}

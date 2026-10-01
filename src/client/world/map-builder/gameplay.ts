// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — map builder: gameplay visuals (control zone dials + beams,
// Sunspear pickup pedestals with respawn timer, training range targets).
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { MapRuntimeState, MaterialLibrary, QualitySettings } from '../../contracts';
import type { MapDef } from '../../../shared/maps/types';
import type { TargetSnap, Team, Vec3, ZoneSnap } from '../../../shared/types';
import { ENV, NEUTRAL_OBJECTIVE, PICKUP_COLOR, UI, teamColors } from '../../engine/palette';
import { WeaponModels, type WeaponModelView } from '../weapon-models';

const ZONE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ZONE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uArcColor;
uniform float uArc;
uniform float uPulse;
uniform float uTime;
uniform float uScale;
varying vec2 vUv;
void main() {
  vec2 p = (vUv * 2.0 - 1.0) * uScale;
  float r = length(p);
  float a = fract(atan(p.x, p.y) / 6.2831853 + 1.0);
  float aa = fwidth(r) * 1.5;
  float ring = 1.0 - smoothstep(0.012, 0.012 + aa, abs(r - 1.0));
  // Dial ticks (every 5°, long at quadrants) just inside the ring.
  float tickA = fract(a * 72.0);
  float tick = (1.0 - smoothstep(0.08, 0.16, abs(tickA - 0.5) * 2.0 - 0.8)) * step(0.92, r) * step(r, 0.965);
  float major = step(abs(fract(a * 4.0 + 0.5) - 0.5), 0.006) * step(0.86, r) * step(r, 0.99);
  // Capture progress arc outside the ring.
  float band = 1.0 - smoothstep(0.022, 0.022 + aa, abs(r - 1.065));
  float arc = band * step(a, uArc);
  float track = band * 0.18;
  // Soft inner fill, stronger near the rim.
  float fill = smoothstep(0.2, 1.0, r) * step(r, 1.0) * 0.16;
  float pulse = 1.0 + uPulse * 0.45 * sin(uTime * 9.0);
  vec3 col = uColor * (ring + tick * 0.7 + major + fill + track) * pulse + uArcColor * arc * 1.6;
  float alpha = clamp(max(max(ring, tick * 0.7), max(max(major, fill), max(arc, track))), 0.0, 1.0);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(col * 1.4, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const BEAM_VERT = /* glsl */ `
varying float vT;
varying vec3 vN;
varying vec3 vV;
void main() {
  vT = uv.y;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
varying float vT;
varying vec3 vN;
varying vec3 vV;
void main() {
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float edge = pow(facing, 1.5);
  float fade = pow(1.0 - vT, 2.2) * smoothstep(0.0, 0.03, vT);
  float streak = 0.8 + 0.2 * sin(vT * 30.0 - uTime * 2.0);
  float a = edge * fade * streak * uIntensity;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function beamMaterial(color: THREE.Color, intensity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uIntensity: { value: intensity }, uTime: { value: 0 } },
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function glowSpriteTexture(lib: MaterialLibrary): THREE.Texture {
  return lib.canvasTexture('fx.softglow', 64, 64, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  });
}

interface ZoneView {
  id: string;
  group: THREE.Group;
  ringMat: THREE.ShaderMaterial;
  beamMat: THREE.ShaderMaterial;
  letter: THREE.Sprite;
  baseY: number;
}

interface PickupView {
  id: string;
  respawn: number;
  group: THREE.Group;
  weapon: WeaponModelView;
  weaponPivot: THREE.Group;
  ring: THREE.Mesh;
  glow: THREE.Sprite;
  beamMat: THREE.ShaderMaterial;
  timerMat: THREE.ShaderMaterial;
  timer: THREE.Mesh;
  lit: number;
}

interface TargetView {
  id: number;
  group: THREE.Group;
  board: THREE.Group;
  mat: THREE.MeshStandardMaterial;
  down: number;
  lastHp: number;
  flash: number;
  wobble: number;
}

export class GameplayVisuals {
  private readonly root = new THREE.Group();
  private readonly zones: ZoneView[] = [];
  private readonly pickups: PickupView[] = [];
  private readonly targets = new Map<number, TargetView>();
  private readonly own: { dispose(): void }[] = [];
  private time = 0;
  private readonly weapons: WeaponModels;

  constructor(private readonly def: MapDef, scene: THREE.Scene, private readonly lib: MaterialLibrary, private readonly quality: QualitySettings) {
    this.root.name = 'map.gameplay';
    scene.add(this.root);
    this.weapons = new WeaponModels(lib);
    for (const z of def.zones) this.buildZone(z.id, z.center, z.radius);
    for (const p of def.pickups) this.buildPickup(p.id, p.pos, p.respawn);
    for (const t of def.targets ?? []) this.buildTarget(t.id, t.pos, t.yaw);
  }

  // Zones ------------------------------------------------------------------
  private buildZone(id: string, c: Vec3, radius: number): void {
    const group = new THREE.Group();
    group.position.set(c.x, c.y, c.z);
    group.visible = false;
    const margin = 1.25;
    const plane = new THREE.PlaneGeometry(radius * 2 * margin, radius * 2 * margin).rotateX(-Math.PI / 2);
    const ringMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(NEUTRAL_OBJECTIVE) },
        uArcColor: { value: new THREE.Color(NEUTRAL_OBJECTIVE) },
        uArc: { value: 0 },
        uPulse: { value: 0 },
        uTime: { value: 0 },
        uScale: { value: margin },
      },
      vertexShader: ZONE_VERT,
      fragmentShader: ZONE_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    const ring = new THREE.Mesh(plane, ringMat);
    ring.position.y = 0.05;
    ring.renderOrder = 5;
    group.add(ring);
    const col = new THREE.CylinderGeometry(radius, radius, 9, this.quality.preset === 'low' ? 24 : 40, 1, true).translate(0, 4.5, 0);
    const beamMat = beamMaterial(new THREE.Color(NEUTRAL_OBJECTIVE), 0.22);
    const beam = new THREE.Mesh(col, beamMat);
    beam.renderOrder = 6;
    group.add(beam);
    const tex = this.lib.canvasTexture(`zone.letter.${id}`, 128, 128, (x, w, h) => {
      x.clearRect(0, 0, w, h);
      x.strokeStyle = '#ffffff';
      x.lineWidth = 5;
      x.beginPath();
      x.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2);
      x.stroke();
      x.lineWidth = 2;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        x.beginPath();
        x.moveTo(w / 2 + Math.cos(a) * w * 0.34, h / 2 + Math.sin(a) * w * 0.34);
        x.lineTo(w / 2 + Math.cos(a) * w * (i % 6 === 0 ? 0.29 : 0.32), h / 2 + Math.sin(a) * w * (i % 6 === 0 ? 0.29 : 0.32));
        x.stroke();
      }
      x.fillStyle = '#ffffff';
      x.font = '700 62px "Space Grotesk", system-ui, sans-serif';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(id, w / 2, h / 2 + 3);
    });
    const letterMat = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(NEUTRAL_OBJECTIVE), transparent: true, depthWrite: false });
    const letter = new THREE.Sprite(letterMat);
    letter.scale.setScalar(1.7);
    letter.position.y = 4.2;
    letter.renderOrder = 7;
    group.add(letter);
    this.root.add(group);
    this.zones.push({ id, group, ringMat, beamMat, letter, baseY: 4.2 });
    this.own.push(plane, ringMat, col, beamMat, letterMat);
  }

  private updateZones(dt: number, zs: ZoneSnap[]): void {
    const show = zs.length > 0;
    for (const z of this.zones) {
      const snap = zs.find((s) => s.id === z.id);
      z.group.visible = show && !!snap;
      if (!snap) continue;
      const owner = snap.owner === 2 ? null : teamColors(snap.owner as Team);
      const base = owner ? owner.primary : NEUTRAL_OBJECTIVE;
      const arcTeam: Team = snap.progress < 0 ? 0 : 1;
      const u = z.ringMat.uniforms;
      (u.uColor.value as THREE.Color).set(base);
      (u.uArcColor.value as THREE.Color).set(teamColors(arcTeam).primary);
      u.uArc.value = Math.abs(snap.progress);
      u.uPulse.value += ((snap.contested ? 1 : 0) - u.uPulse.value) * Math.min(1, dt * 6);
      u.uTime.value = this.time;
      (z.beamMat.uniforms.uColor.value as THREE.Color).set(base);
      z.beamMat.uniforms.uTime.value = this.time;
      z.beamMat.uniforms.uIntensity.value = (owner ? 0.3 : 0.16) * (1 + u.uPulse.value * 0.6 * Math.sin(this.time * 9));
      z.letter.material.color.set(base).multiplyScalar(1.3);
      z.letter.position.y = z.baseY + Math.sin(this.time * 1.4 + z.id.charCodeAt(0)) * 0.12;
    }
  }

  // Pickups ----------------------------------------------------------------
  private buildPickup(id: string, pos: Vec3, respawn: number): void {
    const group = new THREE.Group();
    group.position.set(pos.x, pos.y, pos.z);
    const seg = this.quality.preset === 'low' ? 16 : 32;
    const profile = [
      [0, 0], [0.62, 0], [0.62, 0.07], [0.56, 0.11], [0.44, 0.16], [0.4, 0.5], [0.5, 0.56], [0.52, 0.62], [0, 0.62],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const ped = new THREE.LatheGeometry(profile, seg);
    const pedestal = new THREE.Mesh(ped, this.lib.painted(ENV.bone, { roughness: 0.4 }));
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    group.add(pedestal);
    const ringGeo = new THREE.TorusGeometry(0.47, 0.022, 8, seg).rotateX(Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, this.lib.glow(PICKUP_COLOR, 2.6));
    ring.position.y = 0.63;
    group.add(ring);
    // Respawn timer ring (flat, shows fill while unavailable).
    const timerGeo = new THREE.RingGeometry(0.28, 0.36, seg).rotateX(-Math.PI / 2);
    const timerMat = new THREE.ShaderMaterial({
      uniforms: { uFill: { value: 0 }, uColor: { value: new THREE.Color(PICKUP_COLOR).multiplyScalar(1.6) } },
      vertexShader: ZONE_VERT,
      fragmentShader: /* glsl */ `
        uniform float uFill; uniform vec3 uColor; varying vec2 vUv;
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float a = fract(atan(p.x, p.y) / 6.2831853 + 1.0);
          float on = step(a, uFill);
          gl_FragColor = vec4(uColor * (0.25 + on * 0.75), 0.35 + on * 0.6);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });
    const timer = new THREE.Mesh(timerGeo, timerMat);
    timer.position.y = 0.625;
    timer.visible = false;
    group.add(timer);
    const weaponPivot = new THREE.Group();
    weaponPivot.position.y = 1.25;
    group.add(weaponPivot);
    const weapon = this.weapons.create('sunspear', 'factory', 'world');
    weapon.root.scale.setScalar(1.25);
    weapon.root.position.z = 0.2;
    weapon.setCharge(0.6);
    weaponPivot.add(weapon.root);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSpriteTexture(this.lib), color: new THREE.Color(PICKUP_COLOR).multiplyScalar(1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.setScalar(2.2);
    glow.position.y = 1.25;
    group.add(glow);
    const beamGeo = new THREE.CylinderGeometry(0.42, 0.5, 3.4, 24, 1, true).translate(0, 0.62 + 1.7, 0);
    const beamMat = beamMaterial(new THREE.Color(PICKUP_COLOR), 0.35);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.renderOrder = 6;
    group.add(beam);
    this.root.add(group);
    this.pickups.push({ id, respawn, group, weapon, weaponPivot, ring, glow, beamMat, timerMat, timer, lit: 1 });
    this.own.push(ped, ringGeo, timerGeo, timerMat, glow.material, beamGeo, beamMat, weapon);
  }

  private updatePickups(dt: number, snaps: MapRuntimeState['pickups']): void {
    for (const p of this.pickups) {
      const s = snaps.find((x) => x.id === p.id);
      const available = s ? s.available : true;
      p.lit += ((available ? 1 : 0) - p.lit) * Math.min(1, dt * 5);
      p.weaponPivot.visible = p.lit > 0.05;
      p.weaponPivot.scale.setScalar(Math.max(0.001, p.lit));
      p.weaponPivot.rotation.y += dt * 0.9;
      p.weaponPivot.position.y = 1.25 + Math.sin(this.time * 1.6) * 0.06;
      p.glow.material.opacity = 0.25 + p.lit * (0.6 + Math.sin(this.time * 3) * 0.1);
      p.glow.position.y = p.weaponPivot.position.y;
      p.beamMat.uniforms.uIntensity.value = 0.05 + p.lit * 0.32;
      p.beamMat.uniforms.uTime.value = this.time;
      p.ring.visible = p.lit > 0.5;
      p.timer.visible = !available;
      if (s && !available) p.timerMat.uniforms.uFill.value = THREE.MathUtils.clamp(1 - s.respawnIn / Math.max(1, p.respawn), 0, 1);
    }
  }

  // Targets ----------------------------------------------------------------
  private buildTarget(id: number, pos: Vec3, yaw: number): void {
    const group = new THREE.Group();
    group.position.set(pos.x, pos.y, pos.z);
    group.rotation.y = yaw;
    const metal = this.lib.painted(ENV.metalDark, { roughness: 0.5, metalness: 0.3 });
    const baseGeo = targetGeo('base', () => new THREE.BoxGeometry(0.7, 0.06, 0.42).translate(0, 0.03, 0));
    const postGeo = targetGeo('post', () => new THREE.CylinderGeometry(0.035, 0.045, 0.3, 10).translate(0, 0.2, 0.06));
    const hingeGeo = targetGeo('hinge', () => new THREE.CylinderGeometry(0.03, 0.03, 0.5, 10).rotateZ(Math.PI / 2).translate(0, 0.34, 0.06));
    for (const g of [baseGeo, postGeo, hingeGeo]) {
      const m = new THREE.Mesh(g, metal);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
    const board = new THREE.Group();
    board.position.set(0, 0.34, 0.06);
    group.add(board);
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(ENV.bone), roughness: 0.38, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0 });
    const bodyGeo = targetGeo('board', silhouetteGeometry);
    const body = new THREE.Mesh(bodyGeo, mat);
    body.castShadow = true;
    board.add(body);
    const decalTex = this.lib.canvasTexture('target.rings', 128, 256, drawTargetRings);
    const decalMat = targetDecalMaterial(decalTex);
    const decal = new THREE.Mesh(targetGeo('decal', () => new THREE.PlaneGeometry(0.72, 1.44).translate(0, 0.72, 0)), decalMat);
    decal.position.z = -0.032;
    decal.rotation.y = Math.PI;
    board.add(decal);
    this.root.add(group);
    this.targets.set(id, { id, group, board, mat, down: 0, lastHp: 1, flash: 0, wobble: 0 });
    this.own.push(mat);
  }

  private updateTargets(dt: number, snaps: TargetSnap[]): void {
    const k = 1 - Math.exp(-dt * 14);
    for (const t of this.targets.values()) {
      const s = snaps.find((x) => x.id === t.id);
      const alive = s ? s.alive : true;
      if (s) {
        t.group.position.x += (s.x - t.group.position.x) * k;
        t.group.position.y += (s.y - t.group.position.y) * k;
        t.group.position.z += (s.z - t.group.position.z) * k;
        t.group.rotation.y = s.yaw;
        if (s.hp < t.lastHp - 1e-3 && alive) {
          t.flash = 1;
          t.wobble = 1;
        }
        t.lastHp = s.hp;
      }
      // Flip back (away from the shooter) when eliminated; spring up on respawn.
      const target = alive ? 0 : 1;
      t.down += (target - t.down) * Math.min(1, dt * (alive ? 6 : 10));
      t.wobble = Math.max(0, t.wobble - dt * 3);
      t.board.rotation.x = t.down * 1.45 + Math.sin(this.time * 28) * t.wobble * 0.06;
      t.flash = Math.max(0, t.flash - dt * 6);
      t.mat.emissiveIntensity = t.flash * 0.9;
    }
  }

  update(dt: number, s: MapRuntimeState): void {
    this.time += dt;
    if (this.zones.length) this.updateZones(dt, s.zones);
    if (this.pickups.length) this.updatePickups(dt, s.pickups);
    if (this.targets.size) this.updateTargets(dt, s.targets);
  }

  dispose(): void {
    for (const o of this.own) o.dispose();
    this.root.removeFromParent();
  }
}

const targetGeoCache = new Map<string, THREE.BufferGeometry>();
function targetGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = targetGeoCache.get(key);
  if (!g) targetGeoCache.set(key, (g = make()));
  return g;
}

/** Humanoid ceramic target board (local origin at the hinge, front faces −Z). */
function silhouetteGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.2, 0);
  s.lineTo(-0.21, 0.6);
  s.quadraticCurveTo(-0.3, 0.86, -0.3, 1.02);
  s.quadraticCurveTo(-0.3, 1.13, -0.2, 1.15);
  s.lineTo(-0.075, 1.17);
  // Head: arc from the left neck point over the top to the right neck point.
  const cx = 0, cy = 1.35, r = 0.2;
  const aL = Math.atan2(1.19 - cy, -0.07);
  const aR = Math.atan2(1.19 - cy, 0.07);
  const sweep = aL - aR + Math.PI * 2;
  for (let i = 0; i <= 20; i++) {
    const a = aL - (sweep * i) / 20;
    s.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  s.lineTo(0.075, 1.17);
  s.lineTo(0.2, 1.15);
  s.quadraticCurveTo(0.3, 1.13, 0.3, 1.02);
  s.quadraticCurveTo(0.3, 0.86, 0.21, 0.6);
  s.lineTo(0.2, 0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -0.02);
  return g;
}

function drawTargetRings(x: CanvasRenderingContext2D, w: number, h: number): void {
  x.clearRect(0, 0, w, h);
  // Canvas is 0.72 × 1.44 m; board-local (u, v) → pixels.
  const px = (u: number): number => ((u + 0.36) / 0.72) * w;
  const py = (v: number): number => h - (v / 1.44) * h;
  const ring = (cx: number, cy: number, rad: number, lw: number, col: string): void => {
    x.strokeStyle = col;
    x.lineWidth = lw;
    x.beginPath();
    x.arc(px(cx), py(cy), (rad / 0.72) * w, 0, Math.PI * 2);
    x.stroke();
  };
  ring(0, 0.84, 0.17, 5, UI.accent);
  ring(0, 0.84, 0.1, 4, UI.accent);
  x.fillStyle = UI.accent;
  x.beginPath();
  x.arc(px(0), py(0.84), 5, 0, Math.PI * 2);
  x.fill();
  ring(0, 1.35, 0.11, 4, UI.headshot);
  x.fillStyle = 'rgba(40,36,32,0.35)';
  x.fillRect(px(-0.19), py(0.12), px(0.19) - px(-0.19), 3);
}

function targetDecalMaterial(tex: THREE.Texture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.3, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
}


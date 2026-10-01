// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — admin combat assist + visuals (the owner's cheat panel):
//
//  • Aimbot — a client-side input assist. Every rendered frame it picks the
//    living enemy nearest to the crosshair inside the FOV cone (line of sight
//    against the CollisionWorld + smoke unless "through walls"), aims at its
//    head (hitbox centre, exactly what the host tests) or chest, leads it by
//    its interpolated velocity, compensates the predicted recoil, and turns the
//    view by feeding a yaw/pitch delta into LocalPlayer.look() — the same path
//    mouse, gamepad and touch use, so it works on every device and online
//    (hits stay server-authoritative: it only moves your view).
//  • Triggerbot — when the crosshair ray (view + recoil, from the predicted
//    eye) hits an enemy hitbox (shared hitboxes() at the interpolated position,
//    i.e. what lag compensation rewinds to) before any wall, FIRE is OR-ed into
//    the next InputCmds after a short delay (semi-automatics are pulsed).
//  • ESP — a DPR-aware 2D canvas inside the HUD root (above the 3D view, below
//    every HUD panel): corner boxes, rig-driven skeletons (CharacterView.
//    jointsWorld, or a crouch-aware template), names, health bars, distance,
//    snaplines and off-screen arrows; through walls; team colours from the
//    palette (colour-blind aware). Plus the aimbot FOV circle.
//
// Cost: nothing at all unless adminFlags.assist / adminFlags.visuals is set
// (ClientMatch checks those first). When on: O(players), allocation-free per
// frame (scratch objects, cached strings), a handful of raycasts.
// Flags come from admin/flags.ts (admin/admin.ts keeps them off unless the
// session is offline or the server authorized this connection).
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { adminFlags } from '../admin/flags';
import { teamColors } from '../engine/palette';
import { activeWeapon, HEAD_RADIUS, hitboxes, rayVsHitboxes, type Hitboxes } from '../../shared/combat';
import { PITCH_LIMIT } from '../../shared/constants';
import { clamp, wrapAngle } from '../../shared/math';
import type { CombatState, InputCmd, Team, Vec3 } from '../../shared/types';
import { BTN_ADS, BTN_FIRE } from '../../shared/types';
import { WEAPONS } from '../../shared/weapons';
import type { MatchContext } from './context';
import type { RemoteEntry } from './remote-players';
import { WorldState } from './world-state';

const DEG = Math.PI / 180;
/** Extra lead on top of the frame time (s): positions are sampled once per frame. */
const AIM_LEAD = 0.03;
/** A locked target keeps a wider cone (no flicker on the edge). */
const STICKY_CONE = 1.25;
/** At most this many line-of-sight tests per frame for the aimbot. */
const MAX_LOS_TESTS = 4;
const MAX_CANDIDATES = 32;
/** ESP skeleton joints (CharacterView.jointsWorld order). */
export const ESP_JOINTS = 16;
/** Bone segments as joint index pairs: spine, arms, legs. */
const SEGMENTS = [0, 1, 1, 2, 2, 3, 1, 4, 4, 5, 5, 6, 1, 7, 7, 8, 8, 9, 3, 10, 10, 11, 11, 12, 3, 13, 13, 14, 14, 15] as const;
/**
 * Fallback skeleton (character space: feet at y = 0, facing −Z, +X = right) for
 * views without jointsWorld; crouch compresses it (see templateJoints).
 */
const TEMPLATE = new Float32Array([
  0, 1.69, 0, /* head centre */ 0, 1.5, 0, /* neck */ 0, 1.26, 0, /* chest */ 0, 0.97, 0, /* pelvis */
  -0.21, 1.42, 0, -0.27, 1.16, -0.1, -0.1, 1.08, -0.38, /* shoulder / elbow / hand L */
  0.21, 1.42, 0, 0.25, 1.15, -0.06, 0.08, 1.12, -0.32, /* R */
  -0.1, 0.92, 0, -0.12, 0.5, -0.04, -0.12, 0.08, 0, /* hip / knee / ankle L */
  0.1, 0.92, 0, 0.13, 0.5, 0.03, 0.125, 0.08, 0.07, /* R */
]);

export interface AssistDebug {
  /** Aimbot target id (-1 = none). */
  target: number;
  /** Angle between the crosshair (view + recoil) and the nearest visible enemy's head (deg; -1 = none). */
  headAngle: number;
  headId: number;
  /** Distance to that head (m). */
  headDist: number;
  triggerArmed: boolean;
  /** FIRE presses the triggerbot added. */
  triggerPulls: number;
  /** Rolling average cost of the assist + ESP work per frame (ms; CPU side — canvas rasterization is the compositor's). */
  costMs: number;
}

export class AdminAssist {
  // ── Aimbot / trigger state ──
  private readonly out = { dx: 0, dy: 0 };
  private readonly eye: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly dir: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly hb: Hitboxes = hitboxes({ x: 0, y: 0, z: 0 }, 0);
  private readonly candId = new Int32Array(MAX_CANDIDATES);
  private readonly candCos = new Float64Array(MAX_CANDIDATES);
  private readonly candPt = new Float64Array(MAX_CANDIDATES * 3);
  private target = -1;
  private onTargetSince = -1;
  private armed = false;
  private triggerPulls = 0;
  private time = 0;

  // ── ESP ──
  private canvas: HTMLCanvasElement | null = null;
  private g: CanvasRenderingContext2D | null = null;
  private shown = false;
  private cw = 0;
  private ch = 0;
  private dpr = 1;
  private font = '600 12px sans-serif';
  private fontSmall = '500 11px sans-serif';
  private readonly vp = new THREE.Matrix4();
  private readonly joints = new Float32Array(ESP_JOINTS * 3);
  private readonly scr = new Float32Array(ESP_JOINTS * 2);
  private sx = 0;
  private sy = 0;
  private readonly distText: string[] = [];
  private readonly hpColor: string[] = [];
  private aimCost = 0;
  private drawCost = 0;

  constructor(private readonly ctx: MatchContext) {
    for (let i = 0; i <= 10; i++) {
      // Health bar: red → amber → green (HSL), precomputed (no per-frame strings).
      this.hpColor.push(`hsl(${Math.round(i * 12)}, 85%, 55%)`);
    }
  }

  /** The ESP canvas currently shows something (ClientMatch keeps calling draw() until it is cleared). */
  get canvasShown(): boolean {
    return this.shown;
  }

  // ═══ Aimbot + triggerbot (per rendered frame, before the ticks) ═════════

  /**
   * Returns the aimbot look delta for this frame (+dx = turn right, +dy = look up;
   * zero when off / no target) and updates the triggerbot. `controllable` = live
   * first person.
   */
  frame(dt: number, controllable: boolean): { dx: number; dy: number } {
    const t0 = performance.now();
    this.time += dt;
    const o = this.out;
    o.dx = 0;
    o.dy = 0;
    const p = this.ctx.predictor;
    const c = p.combat;
    if (!controllable || !p.alive || !p.move || !c) {
      this.target = -1;
      this.armed = false;
      this.onTargetSince = -1;
      return o;
    }
    p.eye(this.eye);
    if (adminFlags.aimbot) this.aim(dt, c);
    else this.target = -1;
    if (adminFlags.trigger) this.trigger(c);
    else {
      this.armed = false;
      this.onTargetSince = -1;
    }
    this.aimCost = this.aimCost * 0.95 + (performance.now() - t0) * 0.05;
    return o;
  }

  /** Effective aim direction (view + recoil, what the next shot uses) into this.dir. */
  private aimDir(c: CombatState): void {
    const l = this.ctx.local;
    const yaw = l.yaw - c.recoilYaw;
    const pitch = clamp(l.pitch + c.recoilPitch, -PITCH_LIMIT, PITCH_LIMIT);
    const cp = Math.cos(pitch);
    this.dir.x = -Math.sin(yaw) * cp;
    this.dir.y = Math.sin(pitch);
    this.dir.z = -Math.cos(yaw) * cp;
  }

  /** Aim point of an entry (head = hitbox centre; chest = upper body box). */
  private aimPoint(e: RemoteEntry, lead: number, out: Float64Array, i: number): void {
    const hb = hitboxes(e.pos, e.s.c / 100, this.hb);
    const s = e.s;
    let y: number;
    if (adminFlags.aimBone === 'head') y = hb.head.c.y;
    else y = e.pos.y + (hb.body.max.y - e.pos.y) * 0.72;
    out[i] = e.pos.x + s.vx * lead;
    out[i + 1] = y + s.vy * lead * 0.5;
    out[i + 2] = e.pos.z + s.vz * lead;
  }

  private visible(x: number, y: number, z: number): boolean {
    const e = this.eye;
    if (!this.ctx.world.segmentClear(e.x, e.y, e.z, x, y, z, 'sight')) return false;
    const ss = this.ctx.smokes;
    return ss.length === 0 || !WorldState.smokeBlocks(ss, e, this.tmpPoint(x, y, z));
  }

  private readonly tp: Vec3 = { x: 0, y: 0, z: 0 };
  private tmpPoint(x: number, y: number, z: number): Vec3 {
    this.tp.x = x;
    this.tp.y = y;
    this.tp.z = z;
    return this.tp;
  }

  private aim(dt: number, c: CombatState): void {
    const ctx = this.ctx;
    const view = ctx.view;
    const f = adminFlags;
    const local = ctx.local;
    const engaged = f.aimAlways || (local.heldNow & (BTN_FIRE | BTN_ADS)) !== 0 || c.adsT > 0.3 || this.armed;
    if (!view || !engaged) {
      this.target = -1;
      return;
    }
    this.aimDir(c);
    const d = this.dir;
    const half = Math.min(179.9, Math.max(5, f.aimFov)) * 0.5 * DEG;
    const cosHalf = Math.cos(half);
    const cosSticky = Math.cos(Math.min(Math.PI, half * STICKY_CONE));
    const lead = Math.min(0.1, dt) + AIM_LEAD;
    const eye = this.eye;
    let n = 0;
    for (const e of view.remotes.entries.values()) {
      if (e.isLocal || !e.alive || !e.placed || !ctx.isEnemy(e.ident.id)) continue;
      const id = e.ident.id;
      const k = n * 3;
      this.aimPoint(e, lead, this.candPt, k);
      const dx = this.candPt[k] - eye.x;
      const dy = this.candPt[k + 1] - eye.y;
      const dz = this.candPt[k + 2] - eye.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 0.5) continue;
      let cos = (dx * d.x + dy * d.y + dz * d.z) / dist;
      if (cos < (id === this.target ? cosSticky : cosHalf)) continue;
      if (id === this.target) cos += 2; // the locked target sorts first while it stays valid
      // Insertion sort by cos (descending = nearest to the crosshair first).
      let j = n;
      while (j > 0 && this.candCos[j - 1] < cos) {
        this.candCos[j] = this.candCos[j - 1];
        this.candId[j] = this.candId[j - 1];
        this.candPt[j * 3] = this.candPt[(j - 1) * 3];
        this.candPt[j * 3 + 1] = this.candPt[(j - 1) * 3 + 1];
        this.candPt[j * 3 + 2] = this.candPt[(j - 1) * 3 + 2];
        j--;
      }
      if (j !== n) {
        this.candPt[j * 3] = dx + eye.x;
        this.candPt[j * 3 + 1] = dy + eye.y;
        this.candPt[j * 3 + 2] = dz + eye.z;
      }
      this.candCos[j] = cos;
      this.candId[j] = id;
      if (++n >= MAX_CANDIDATES) break;
    }
    let pick = -1;
    for (let i = 0, tests = 0; i < n; i++) {
      if (f.aimWalls) {
        pick = i;
        break;
      }
      if (tests++ >= MAX_LOS_TESTS) break;
      if (this.visible(this.candPt[i * 3], this.candPt[i * 3 + 1], this.candPt[i * 3 + 2])) {
        pick = i;
        break;
      }
    }
    if (pick < 0) {
      this.target = -1;
      return;
    }
    this.target = this.candId[pick];
    const dx = this.candPt[pick * 3] - eye.x;
    const dy = this.candPt[pick * 3 + 1] - eye.y;
    const dz = this.candPt[pick * 3 + 2] - eye.z;
    const tyaw = Math.atan2(-dx, -dz);
    const tpitch = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
    // Recoil compensation: the shot flies along view − recoilYaw / view + recoilPitch.
    const wantYaw = tyaw + c.recoilYaw;
    const wantPitch = clamp(tpitch - c.recoilPitch, -PITCH_LIMIT, PITCH_LIMIT);
    const dyaw = wrapAngle(wantYaw - local.yaw);
    const dpitch = wantPitch - local.pitch;
    const sm = clamp(f.aimSmooth, 0, 1);
    const k = sm <= 0.001 ? 1 : 1 - Math.exp(-Math.max(0, dt) / (0.012 + sm * sm * 0.45));
    // LocalPlayer.look: yaw −= dx, pitch += dy.
    this.out.dx = -dyaw * k;
    this.out.dy = dpitch * k;
  }

  private trigger(c: CombatState): void {
    const ctx = this.ctx;
    const view = ctx.view;
    if (!view) return;
    this.aimDir(c);
    const range = WEAPONS[activeWeapon(c)].range;
    const eye = this.eye;
    let best = Infinity;
    for (const e of view.remotes.entries.values()) {
      if (e.isLocal || !e.alive || !e.placed || !ctx.isEnemy(e.ident.id)) continue;
      // Cheap reject: the ray passes farther than 1.5 m from the player's centre.
      const cx = e.pos.x - eye.x;
      const cy = e.pos.y + 0.9 - eye.y;
      const cz = e.pos.z - eye.z;
      const along = cx * this.dir.x + cy * this.dir.y + cz * this.dir.z;
      if (along < 0 || along > range + 2) continue;
      const px = cx - this.dir.x * along;
      const py = cy - this.dir.y * along;
      const pz = cz - this.dir.z * along;
      if (px * px + py * py + pz * pz > 2.25) continue;
      const hit = rayVsHitboxes(eye, this.dir, Math.min(best, range), hitboxes(e.pos, e.s.c / 100, this.hb));
      if (hit && hit.dist < best) best = hit.dist;
    }
    // Walls block bullets (smoke does not).
    const on = best < Infinity && ctx.world.rayDist(eye.x, eye.y, eye.z, this.dir.x, this.dir.y, this.dir.z, best, 'bullet') === Infinity;
    if (!on) {
      this.onTargetSince = -1;
      this.armed = false;
      return;
    }
    if (this.onTargetSince < 0) this.onTargetSince = this.time;
    this.armed = this.time - this.onTargetSince >= Math.max(0, adminFlags.triggerDelay) - 1e-6;
  }

  /**
   * Called for each InputCmd before prediction (so the host receives the very
   * same command): the triggerbot ORs FIRE in. Semi-automatics get a fresh press
   * every other tick (unless rapid fire makes them automatic).
   */
  applyTrigger(cmd: InputCmd, c: CombatState | null, allowFire: boolean): void {
    if (!this.armed || !allowFire || !c || !this.ctx.predictor.alive) return;
    if (cmd.buttons & BTN_FIRE) return; // the player is already firing
    const w = WEAPONS[activeWeapon(c)];
    if (w.fireMode === 'semi' && !c.cheatRapid && c.fireHeld) return; // release for one tick → next press
    cmd.buttons |= BTN_FIRE;
    if (!c.fireHeld) this.triggerPulls++;
  }

  // ═══ ESP overlay (per rendered frame, after the camera) ═════════════════

  /** Draws (or clears) the overlay. `active` = live first person. */
  draw(active: boolean): void {
    const t0 = performance.now();
    const f = adminFlags;
    if (!active || !f.visuals || !this.ctx.view) {
      if (this.shown) this.hide();
      return;
    }
    const g = this.ensureCanvas();
    if (!g) return;
    this.shown = true;
    const W = this.cw;
    const H = this.ch;
    g.clearRect(0, 0, W, H);
    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    this.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

    if (f.aimbot) this.drawFovCircle(g, W, H, cam.fov);
    if (f.esp) this.drawEsp(g, W, H);
    this.drawCost = this.drawCost * 0.95 + (performance.now() - t0) * 0.05;
  }

  private drawFovCircle(g: CanvasRenderingContext2D, W: number, H: number, vfovDeg: number): void {
    const half = Math.min(179.9, Math.max(5, adminFlags.aimFov)) * 0.5 * DEG;
    if (half >= 89 * DEG) return; // a hemisphere or more: the whole screen
    const r = (Math.tan(half) / Math.tan((vfovDeg * DEG) / 2)) * (H / 2);
    if (r > Math.hypot(W, H)) return;
    const locked = this.target >= 0;
    g.lineWidth = 1.5;
    g.globalAlpha = locked ? 0.9 : 0.55;
    g.strokeStyle = '#0b0a09';
    g.beginPath();
    g.arc(W / 2, H / 2, r + 1, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = locked ? '#ff5a5f' : '#f3ece0';
    g.beginPath();
    g.arc(W / 2, H / 2, r, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
  }

  /** World → canvas px into (sx, sy). False when behind the camera. */
  private project(x: number, y: number, z: number, W: number, H: number): boolean {
    const e = this.vp.elements;
    const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (cw < 0.05) return false;
    const cx = e[0] * x + e[4] * y + e[8] * z + e[12];
    const cy = e[1] * x + e[5] * y + e[9] * z + e[13];
    this.sx = (cx / cw * 0.5 + 0.5) * W;
    this.sy = (0.5 - cy / cw * 0.5) * H;
    return true;
  }

  private drawEsp(g: CanvasRenderingContext2D, W: number, H: number): void {
    const ctx = this.ctx;
    const view = ctx.view;
    if (!view) return;
    const f = adminFlags;
    const ffa = ctx.config.mode === 'ffa';
    const cp = ctx.camPos;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.textAlign = 'center';
    for (const e of view.remotes.entries.values()) {
      if (e.isLocal || !e.alive || !e.placed) continue;
      const enemy = ctx.isEnemy(e.ident.id);
      if (!enemy && !f.espTeam) continue;
      const team: Team = enemy && ffa ? 2 : e.ident.team;
      const color = enemy ? teamColors(team).primary : teamColors(team).light;
      const hb = hitboxes(e.pos, e.s.c / 100, this.hb);
      const topY = hb.head.c.y + HEAD_RADIUS + 0.05;
      const px = e.pos.x;
      const pz = e.pos.z;
      const okTop = this.project(px, topY, pz, W, H);
      const tx = this.sx;
      const ty = this.sy;
      const okBot = this.project(px, e.pos.y, pz, W, H);
      const bx = this.sx;
      const by = this.sy;
      const dx = px - cp.x;
      const dy = e.pos.y + 1 - cp.y;
      const dz = pz - cp.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!okTop || !okBot || by < -40 || ty > H + 40 || Math.max(tx, bx) < -40 || Math.min(tx, bx) > W + 40) {
        if (enemy) this.drawArrow(g, W, H, px, e.pos.y + 1, pz, color);
        continue;
      }
      const h = Math.max(4, by - ty);
      const w = h * 0.42;
      const cx = (tx + bx) / 2;
      const left = cx - w / 2;
      // Behind walls: slightly dimmer (still drawn — that is the point).
      const seen = ctx.world.segmentClear(cp.x, cp.y, cp.z, hb.head.c.x, hb.head.c.y, hb.head.c.z, 'sight');
      const alpha = seen ? 1 : 0.72;

      if (f.espLines && enemy) {
        g.globalAlpha = alpha * 0.55;
        g.lineWidth = 1;
        g.strokeStyle = color;
        g.beginPath();
        g.moveTo(W / 2, H);
        g.lineTo(cx, by);
        g.stroke();
      }
      if (f.espBoxes) this.cornerBox(g, left, ty, w, h, color, alpha);
      if (f.espSkeleton) this.skeleton(g, e, W, H, color, alpha);
      if (f.espHealth) {
        const hp = clamp(e.s.hp, 0, 100) / 100;
        const bw = Math.max(2, Math.min(4, w * 0.06));
        const x = left - bw - 4;
        g.globalAlpha = alpha * 0.8;
        g.fillStyle = '#0b0a09';
        g.fillRect(x - 1, ty - 1, bw + 2, h + 2);
        g.globalAlpha = alpha;
        g.fillStyle = this.hpColor[Math.round(hp * 10)];
        g.fillRect(x, ty + h * (1 - hp), bw, h * hp);
      }
      if (f.espNames || f.espDistance) {
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(11,10,9,0.85)';
        g.globalAlpha = alpha;
        if (f.espNames) {
          g.font = this.font;
          g.fillStyle = color;
          g.strokeText(e.ident.name, cx, ty - 6);
          g.fillText(e.ident.name, cx, ty - 6);
        }
        if (f.espDistance) {
          g.font = this.fontSmall;
          g.fillStyle = '#f3ece0';
          const s = this.distanceText(dist);
          g.strokeText(s, cx, by + 13);
          g.fillText(s, cx, by + 13);
        }
      }
    }
    g.globalAlpha = 1;
  }

  private cornerBox(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, alpha: number): void {
    const lx = Math.max(3, w * 0.28);
    const ly = Math.max(3, h * 0.2);
    for (let pass = 0; pass < 2; pass++) {
      g.globalAlpha = pass === 0 ? alpha * 0.75 : alpha;
      g.lineWidth = pass === 0 ? 3.5 : 1.6;
      g.strokeStyle = pass === 0 ? '#0b0a09' : color;
      g.beginPath();
      g.moveTo(x, y + ly);
      g.lineTo(x, y);
      g.lineTo(x + lx, y);
      g.moveTo(x + w - lx, y);
      g.lineTo(x + w, y);
      g.lineTo(x + w, y + ly);
      g.moveTo(x + w, y + h - ly);
      g.lineTo(x + w, y + h);
      g.lineTo(x + w - lx, y + h);
      g.moveTo(x + lx, y + h);
      g.lineTo(x, y + h);
      g.lineTo(x, y + h - ly);
      g.stroke();
    }
  }

  /** Fallback joints from the snapshot pose: template rotated by yaw, compressed by crouch. */
  private templateJoints(e: RemoteEntry): void {
    const yaw = e.s.yaw;
    const s = Math.sin(yaw);
    const c = Math.cos(yaw);
    const cr = clamp(e.s.c / 100, 0, 1);
    const j = this.joints;
    for (let i = 0; i < ESP_JOINTS; i++) {
      const lx = TEMPLATE[i * 3];
      let ly = TEMPLATE[i * 3 + 1];
      let lz = TEMPLATE[i * 3 + 2];
      if (cr > 0) {
        // Hips drop ~0.42 m; knees bend forward; the upper body follows the hips.
        if (ly > 0.6) ly -= 0.42 * cr * Math.min(1, (ly - 0.6) / 0.35);
        else if (ly > 0.2) lz -= 0.3 * cr;
      }
      // Character space → world (rotation.y = yaw: x' = x·cos + z·sin, z' = −x·sin + z·cos).
      j[i * 3] = e.pos.x + lx * c + lz * s;
      j[i * 3 + 1] = e.pos.y + ly;
      j[i * 3 + 2] = e.pos.z - lx * s + lz * c;
    }
  }

  private skeleton(g: CanvasRenderingContext2D, e: RemoteEntry, W: number, H: number, color: string, alpha: number): void {
    const j = this.joints;
    if (!e.view.jointsWorld || !e.view.jointsWorld(j)) this.templateJoints(e);
    const s = this.scr;
    for (let i = 0; i < ESP_JOINTS; i++) {
      if (!this.project(j[i * 3], j[i * 3 + 1], j[i * 3 + 2], W, H)) return;
      s[i * 2] = this.sx;
      s[i * 2 + 1] = this.sy;
    }
    for (let pass = 0; pass < 2; pass++) {
      g.globalAlpha = pass === 0 ? alpha * 0.6 : alpha;
      g.lineWidth = pass === 0 ? 3 : 1.4;
      g.strokeStyle = pass === 0 ? '#0b0a09' : color;
      g.beginPath();
      for (let k = 0; k < SEGMENTS.length; k += 2) {
        const a = SEGMENTS[k] * 2;
        const b = SEGMENTS[k + 1] * 2;
        g.moveTo(s[a], s[a + 1]);
        g.lineTo(s[b], s[b + 1]);
      }
      g.stroke();
    }
    // Head ring.
    const r = Math.max(2, Math.hypot(s[0] - s[2], s[1] - s[3]) * 0.55);
    g.beginPath();
    g.arc(s[0], s[1], r, 0, Math.PI * 2);
    g.stroke();
  }

  /** Off-screen / behind-you indicator: an arrow on a ring around the crosshair pointing at the enemy. */
  private drawArrow(g: CanvasRenderingContext2D, W: number, H: number, x: number, y: number, z: number, color: string): void {
    const m = this.ctx.camera.matrixWorldInverse.elements;
    const vx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const vy = m[1] * x + m[5] * y + m[9] * z + m[13];
    let ax = vx;
    let ay = -vy;
    const l = Math.hypot(ax, ay);
    if (l < 1e-4) {
      ax = 0;
      ay = 1;
    } else {
      ax /= l;
      ay /= l;
    }
    const R = Math.min(W, H) * 0.34;
    const px = W / 2 + ax * R;
    const py = H / 2 + ay * R;
    const size = 11;
    // Triangle pointing along (ax, ay); perpendicular = (−ay, ax).
    g.globalAlpha = 0.9;
    g.fillStyle = color;
    g.strokeStyle = '#0b0a09';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(px + ax * size, py + ay * size);
    g.lineTo(px - ax * size * 0.6 - ay * size * 0.75, py - ay * size * 0.6 + ax * size * 0.75);
    g.lineTo(px - ax * size * 0.25, py - ay * size * 0.25);
    g.lineTo(px - ax * size * 0.6 + ay * size * 0.75, py - ay * size * 0.6 - ax * size * 0.75);
    g.closePath();
    g.stroke();
    g.fill();
    g.globalAlpha = 1;
  }

  private distanceText(d: number): string {
    const n = Math.min(999, Math.max(0, Math.round(d)));
    let s = this.distText[n];
    if (s === undefined) this.distText[n] = s = `${n} m`;
    return s;
  }

  // ── Canvas lifecycle ──

  private ensureCanvas(): CanvasRenderingContext2D | null {
    const root = this.ctx.app.hud.root;
    if (!this.canvas) {
      const c = document.createElement('canvas');
      c.className = 'hf-adm-esp';
      c.setAttribute('aria-hidden', 'true');
      c.dir = 'ltr'; // "12 m" must not reorder in the Arabic UI
      // Above the 3D view, below every HUD panel (first child of the HUD root).
      c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
      this.canvas = c;
      this.g = c.getContext('2d');
      if (this.g) this.g.direction = 'ltr';
      try {
        const cs = getComputedStyle(document.documentElement);
        const fam = (cs.getPropertyValue('--f-ui') || cs.getPropertyValue('--f-latin')).trim() || 'system-ui, sans-serif';
        this.font = `600 12px ${fam}`;
        this.fontSmall = `500 11px ${fam}`;
      } catch {
        /* keep defaults */
      }
    }
    const c = this.canvas;
    if (c.parentElement !== root) root.prepend(c);
    if (c.style.display === 'none') c.style.display = '';
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w !== this.cw || h !== this.ch || dpr !== this.dpr) {
      this.cw = w;
      this.ch = h;
      this.dpr = dpr;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      this.g?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    return this.g;
  }

  private hide(): void {
    this.shown = false;
    this.g?.clearRect(0, 0, this.cw, this.ch);
    if (this.canvas) this.canvas.style.display = 'none';
  }

  // ── Debug / lifecycle ──

  /** Debug (?debug=1 state()): aimbot target, crosshair→nearest head angle, triggerbot, cost. */
  debug(): AssistDebug {
    const ctx = this.ctx;
    const p = ctx.predictor;
    let headAngle = -1;
    let headId = -1;
    let headDist = -1;
    if (p.alive && p.move && p.combat && ctx.view) {
      const eye = p.eye({ x: 0, y: 0, z: 0 });
      this.aimDir(p.combat);
      const d = this.dir;
      let bestCos = -2;
      for (const e of ctx.view.remotes.entries.values()) {
        if (e.isLocal || !e.alive || !e.placed || !ctx.isEnemy(e.ident.id)) continue;
        const hb = hitboxes(e.pos, e.s.c / 100);
        const dx = hb.head.c.x - eye.x;
        const dy = hb.head.c.y - eye.y;
        const dz = hb.head.c.z - eye.z;
        const l = Math.hypot(dx, dy, dz);
        if (l < 0.5 || !ctx.world.segmentClear(eye.x, eye.y, eye.z, hb.head.c.x, hb.head.c.y, hb.head.c.z, 'sight')) continue;
        const cos = (dx * d.x + dy * d.y + dz * d.z) / l;
        if (cos > bestCos) {
          bestCos = cos;
          headId = e.ident.id;
          headDist = Math.round(l * 10) / 10;
        }
      }
      if (headId >= 0) headAngle = Math.round((Math.acos(clamp(bestCos, -1, 1)) / DEG) * 100) / 100;
    }
    return { target: this.target, headAngle, headId, headDist, triggerArmed: this.armed, triggerPulls: this.triggerPulls, costMs: Math.round((this.aimCost + this.drawCost) * 1000) / 1000 };
  }

  dispose(): void {
    this.canvas?.remove();
    this.canvas = null;
    this.g = null;
    this.shown = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — HUD bridge: builds the per-frame HudState from predicted
// local state + interpolated world state, and the scoreboard rows.
//
// Allocation-free in steady state: the HudState, marker and objective objects
// are created once and rewritten each frame (the HUD diffs values itself).
//  • Compass: map landmarks, zones (owner colors), available pickups.
//  • Objectives (world-anchored, edge-clamped): zones with capture progress
//    in team colors, the Sunspear pedestal when available, and small markers
//    over teammates' heads (always, even through walls).
//  • Crosshair spread: currentSpread() radians → CSS px via the camera's FOV.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { HudCompassMarker, HudObjective, HudRadar, HudRadarBlip, HudState, ScoreboardEntry } from '../contracts';
import { NEUTRAL_OBJECTIVE, PICKUP_COLOR, UI, teamColors } from '../engine/palette';
import { keyLabel } from '../state/settings';
import { activeSlot, activeWeapon, currentSpread, reloadProgress } from '../../shared/combat';
import { MAX_HEALTH } from '../../shared/constants';
import { MODES } from '../../shared/modes';
import type { ScoreboardRow } from '../../shared/protocol';
import { PICKUP_INTERACT_RADIUS } from '../../shared/sim/pickups';
import type { Team, Vec3 } from '../../shared/types';
import { WEAPONS } from '../../shared/weapons';
import type { PickupDef, ZoneDef } from '../../shared/maps/types';
import type { MatchContext } from './context';
// Admin wallhack (client-only cheat; off unless the admin console authorized it).
import { adminFlags } from '../admin/flags';

const ZONE_MARK_H = 2.6;
/** Seconds an enemy stays on the radar after firing (fades out). */
const RADAR_SHOT_SHOW = 2.6;
const HEAD_MARK_H = 2.15;

function yawTo(from: Vec3, x: number, z: number): number {
  return Math.atan2(-(x - from.x), -(z - from.z));
}

export class HudBridge {
  readonly state: HudState;
  private readonly compass: HudCompassMarker[] = [];
  private readonly objectives: HudObjective[] = [];
  private readonly landmarkLabels: string[] = [];
  private labelLang = '';
  private readonly v = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  /** Latest scoreboard rows (from the host, ~1 Hz). */
  rows: ScoreboardRow[] = [];
  /** Local extra kills since the last scoreboard (FFA score feels instant). */
  private killBoost = new Map<number, number>();
  ping = 0;
  prompt: string | null = null;
  private sunspearLabel = 'Sunspear';
  private promptSig = '';
  private promptText = '';
  private readonly zoneDefs = new Map<string, ZoneDef>();
  private readonly pickupDefs = new Map<string, PickupDef>();
  private readonly friendKeys = new Map<number, string>();
  private readonly radar: HudRadar = { x: 0, z: 0, yaw: 0, fov: 1.4, blips: [], count: 0 };
  /** performance.now() seconds of each player's last shot (enemies show on the radar while firing). */
  private readonly shotAt = new Map<number, number>();

  constructor(private readonly ctx: MatchContext) {
    const c = ctx.config;
    for (const z of ctx.def.zones) this.zoneDefs.set(z.id, z);
    for (const p of ctx.def.pickups) this.pickupDefs.set(p.id, p);
    this.state = {
      mode: c.mode,
      phase: 'countdown',
      phaseLeft: 0,
      health: MAX_HEALTH,
      maxHealth: MAX_HEALTH,
      alive: true,
      respawnIn: 0,
      protectedT: 0,
      weapon: 'meridian',
      mag: 0,
      magSize: 0,
      reserve: 0,
      reloading: -1,
      charge: 0,
      throwable: 'grenade',
      throwables: 0,
      yaw: 0,
      compass: this.compass,
      objectives: this.objectives,
      localTeam: ctx.localTeam,
      teamScores: [0, 0],
      scoreLimit: c.scoreLimit,
      ffa: c.mode === 'ffa' ? { mine: 0, leader: 0, rank: 1 } : undefined,
      spread: 0,
      ads: 0,
      scoped: false,
      sprinting: false,
      prompt: null,
      ping: 0,
      fps: 60,
      showFps: false,
    };
  }

  /** A remote player fired (from the 'shot' event). */
  onShot(id: number): void {
    this.shotAt.set(id, performance.now() / 1000);
  }

  onScoreboard(rows: ScoreboardRow[]): void {
    this.rows = rows;
    this.killBoost.clear();
  }

  /** Kill events between scoreboards keep the FFA counter instant. */
  onKill(killer: number): void {
    if (killer < 0) return;
    this.killBoost.set(killer, (this.killBoost.get(killer) ?? 0) + 1);
  }

  private killsOf(id: number): number {
    const r = this.rows.find((x) => x.id === id);
    return (r?.kills ?? 0) + (this.killBoost.get(id) ?? 0);
  }

  /** Builds the HudState for this frame. `phaseLeft` is the locally-extrapolated clock. */
  build(phaseLeft: number, vw: number, vh: number): HudState {
    const ctx = this.ctx;
    const s = this.state;
    const app = ctx.app;
    const p = ctx.predictor;
    const clock = ctx.clock;
    s.phase = clock.phase;
    s.phaseLeft = phaseLeft;
    s.localTeam = ctx.localTeam;
    s.teamScores[0] = clock.teamScores[0];
    s.teamScores[1] = clock.teamScores[1];
    s.alive = p.alive;
    s.health = p.alive ? p.health : 0;
    s.respawnIn = p.respawnIn;
    s.protectedT = p.protectedT;
    s.yaw = ctx.camYaw;
    s.ping = this.ping;
    s.fps = app.engine.stats.fps;
    s.showFps = app.settings.value.showFps;
    s.prompt = this.prompt;

    const c = p.combat;
    const m = p.move;
    if (c && m) {
      const slot = activeSlot(c);
      const w = WEAPONS[slot.id];
      s.weapon = slot.id;
      s.mag = slot.mag;
      s.magSize = w.magSize;
      s.reserve = slot.reserve;
      s.reloading = reloadProgress(c);
      s.charge = w.chargeTime ? Math.min(1, c.chargeT / w.chargeTime) : 0;
      s.throwables = c.throwables;
      s.ads = c.adsT;
      s.scoped = w.scoped && c.adsT > 0.9;
      s.sprinting = m.sprint;
      // Spread (radians, cone half-angle) → CSS px at the current vertical FOV.
      const spread = currentSpread(c, m);
      const halfV = THREE.MathUtils.degToRad(ctx.camera.fov) / 2;
      s.spread = Math.min(80, (Math.tan(spread) / Math.tan(halfV)) * (vh / 2));
    }
    const me = ctx.players.get(ctx.localId);
    if (me) s.throwable = me.loadout.throwable;

    if (s.ffa) {
      const mine = this.killsOf(ctx.localId);
      let leader = mine;
      let rank = 1;
      for (const id of ctx.players.keys()) {
        if (id === ctx.localId) continue;
        const k = this.killsOf(id);
        if (k > leader) leader = k;
        if (k > mine) rank++;
      }
      s.ffa.mine = mine;
      s.ffa.leader = leader;
      s.ffa.rank = rank;
    }

    this.buildCompass();
    this.buildObjectives(vw, vh);
    s.radar = ctx.config.mode === 'range' ? null : this.buildRadar(vw, vh);
    return s;
  }

  private cn = 0;
  private on = 0;
  private vw = 0;
  private vh = 0;

  private putCompass(yaw: number, label: string, color: string, kind: HudCompassMarker['kind']): void {
    let mk = this.compass[this.cn];
    if (!mk) {
      mk = { yaw: 0, label: '', color: '', kind: 'landmark' };
      this.compass[this.cn] = mk;
    }
    mk.yaw = yaw;
    mk.label = label;
    mk.color = color;
    mk.kind = kind;
    this.cn++;
  }

  private buildCompass(): void {
    const ctx = this.ctx;
    const def = ctx.def;
    const lang = ctx.app.i18n.lang;
    if (lang !== this.labelLang) {
      this.labelLang = lang;
      this.landmarkLabels.length = 0;
      for (const l of def.landmarks) this.landmarkLabels.push(ctx.app.i18n.t(l.nameKey));
      this.sunspearLabel = ctx.app.i18n.t(WEAPONS.sunspear.nameKey);
    }
    const from = ctx.camPos;
    this.cn = 0;
    for (let i = 0; i < def.landmarks.length; i++) {
      const l = def.landmarks[i];
      this.putCompass(yawTo(from, l.pos.x, l.pos.z), this.landmarkLabels[i], UI.text, 'landmark');
    }
    for (const z of ctx.zones) {
      const zd = this.zoneDefs.get(z.id);
      if (zd) this.putCompass(yawTo(from, zd.center.x, zd.center.z), z.id, this.zoneColor(z.owner), 'zone');
    }
    for (const pk of ctx.pickups) {
      const pd = pk.available ? this.pickupDefs.get(pk.id) : undefined;
      if (pd) this.putCompass(yawTo(from, pd.pos.x, pd.pos.z), this.sunspearLabel, PICKUP_COLOR, 'pickup');
    }
    this.compass.length = this.cn;
  }

  private rn = 0;

  private putBlip(kind: HudRadarBlip['kind'], x: number, z: number, color: string, alpha: number, label: string, yaw: number, pulse: boolean): void {
    let b = this.radar.blips[this.rn];
    if (!b) {
      b = { x: 0, z: 0, kind: 'zone', color: '', alpha: 1, label: '', yaw: 0, pulse: false };
      this.radar.blips[this.rn] = b;
    }
    b.kind = kind;
    b.x = x;
    b.z = z;
    b.color = color;
    b.alpha = alpha;
    b.label = label;
    b.yaw = yaw;
    b.pulse = pulse;
    this.rn++;
  }

  /** Radar contents: you, zones, pickup, teammates, and enemies that fired recently. */
  private buildRadar(vw: number, vh: number): HudRadar {
    const ctx = this.ctx;
    const r = this.radar;
    r.x = ctx.camPos.x;
    r.z = ctx.camPos.z;
    r.yaw = ctx.camYaw;
    const halfV = THREE.MathUtils.degToRad(ctx.camera.fov) / 2;
    r.fov = 2 * Math.atan(Math.tan(halfV) * (vw / Math.max(1, vh)));
    this.rn = 0;
    for (const z of ctx.zones) {
      const zd = this.zoneDefs.get(z.id);
      if (zd) this.putBlip('zone', zd.center.x, zd.center.z, this.zoneColor(z.owner), 1, z.id, 0, z.contested || (z.capturing !== 2 && z.capturing !== z.owner));
    }
    for (const pk of ctx.pickups) {
      const pd = pk.available ? this.pickupDefs.get(pk.id) : undefined;
      if (pd) this.putBlip('pickup', pd.pos.x, pd.pos.z, PICKUP_COLOR, 1, '', 0, false);
    }
    const remotes = ctx.view?.remotes;
    if (remotes) {
      const now = performance.now() / 1000;
      for (const e of remotes.entries.values()) {
        if (e.isLocal || !e.alive || !e.placed) continue;
        const id = e.ident.id;
        if (!ctx.isEnemy(id)) {
          this.putBlip('friend', e.pos.x, e.pos.z, teamColors(e.ident.team).light, 1, '', e.s.yaw, false);
          continue;
        }
        const t = this.shotAt.get(id);
        const wall = adminFlags.radarAll; // admin: radar shows every enemy
        if (t === undefined && !wall) continue;
        const age = t === undefined ? Infinity : now - t;
        if (age > RADAR_SHOT_SHOW && !wall) continue;
        const alpha = age < 1 ? 1 : age > RADAR_SHOT_SHOW ? 0.85 : Math.max(wall ? 0.85 : 0, 1 - (age - 1) / (RADAR_SHOT_SHOW - 1));
        // FFA: everyone is hostile — use the hostile set (team 2); team modes: the enemy team's color.
        const team: Team = ctx.config.mode === 'ffa' ? 2 : e.ident.team;
        this.putBlip('enemy', e.pos.x, e.pos.z, teamColors(team).primary, alpha, '', 0, false);
      }
    }
    r.count = this.rn;
    return r;
  }

  private zoneColor(owner: Team): string {
    return owner === 0 || owner === 1 ? teamColors(owner).primary : NEUTRAL_OBJECTIVE;
  }

  private putObjective(x: number, y: number, z: number, id: string, label: string, color: string, progress: number, kind: HudObjective['kind'], pulse: boolean): void {
    let o = this.objectives[this.on];
    if (!o) {
      o = { id: '', label: '', screen: { x: 0, y: 0 }, offscreen: false, color: '', progress: 0, distance: 0, kind: 'zone', pulse: false };
      this.objectives[this.on] = o;
    }
    const cp = this.ctx.camPos;
    o.id = id;
    o.label = label;
    o.color = color;
    o.progress = progress;
    o.kind = kind;
    o.pulse = pulse;
    o.distance = Math.hypot(x - cp.x, y - cp.y, z - cp.z);
    if (!o.screen) o.screen = { x: 0, y: 0 };
    o.offscreen = this.project(x, y, z, this.vw, this.vh, o.screen, kind === 'friendly');
    if (kind === 'friendly' && o.offscreen) return; // teammates: on-screen only
    this.on++;
  }

  private buildObjectives(vw: number, vh: number): void {
    const ctx = this.ctx;
    ctx.camera.getWorldDirection(this.fwd);
    this.vw = vw;
    this.vh = vh;
    this.on = 0;
    const zoneTeam = ctx.localTeam === 1 ? 1 : 0;
    for (const z of ctx.zones) {
      const zd = this.zoneDefs.get(z.id);
      if (!zd) continue;
      const owned = z.owner === 0 || z.owner === 1;
      // Ring = capture progress toward whoever is gaining it; tinted by the leaning team.
      const prog = Math.min(1, Math.abs(z.progress));
      const leaning: Team = z.progress < -1e-3 ? 0 : z.progress > 1e-3 ? 1 : 2;
      const color = owned ? this.zoneColor(z.owner) : leaning !== 2 ? teamColors(leaning).light : NEUTRAL_OBJECTIVE;
      const pulse = z.contested || (z.capturing !== 2 && (z.capturing !== zoneTeam || z.owner !== zoneTeam));
      this.putObjective(zd.center.x, zd.center.y + ZONE_MARK_H, zd.center.z, z.id, z.id, color, prog, 'zone', pulse);
    }
    for (const pk of ctx.pickups) {
      const pd = pk.available ? this.pickupDefs.get(pk.id) : undefined;
      if (pd) this.putObjective(pd.pos.x, pd.pos.y + 1.4, pd.pos.z, pk.id, this.sunspearLabel, PICKUP_COLOR, 1, 'pickup', false);
    }
    const remotes = ctx.view?.remotes;
    if (remotes && ctx.config.mode !== 'ffa' && ctx.config.mode !== 'range') {
      for (const e of remotes.entries.values()) {
        if (e.isLocal || !e.alive || ctx.isEnemy(e.ident.id) || this.on >= 11) continue;
        let key = this.friendKeys.get(e.ident.id);
        if (!key) this.friendKeys.set(e.ident.id, (key = `p${e.ident.id}`));
        this.putObjective(e.pos.x, e.pos.y + HEAD_MARK_H - (e.s.c / 100) * 0.55, e.pos.z, key, '', teamColors(e.ident.team).light, 0, 'friendly', false);
      }
    }
    // Admin chams: a small chevron over every on-screen enemy, visible through walls (the ESP replaces it).
    if (remotes && adminFlags.chams && !adminFlags.esp && ctx.config.mode !== 'range') {
      for (const e of remotes.entries.values()) {
        if (e.isLocal || !e.alive || !e.placed || !ctx.isEnemy(e.ident.id) || this.on >= 16) continue;
        let key = this.friendKeys.get(-e.ident.id);
        if (!key) this.friendKeys.set(-e.ident.id, (key = `e${e.ident.id}`));
        const team: Team = ctx.config.mode === 'ffa' ? 2 : e.ident.team;
        this.putObjective(e.pos.x, e.pos.y + HEAD_MARK_H - (e.s.c / 100) * 0.55, e.pos.z, key, '', teamColors(team).primary, 0, 'friendly', false);
      }
    }
    this.objectives.length = this.on;
  }

  /**
   * Projects a world point to CSS px. Returns true when off-screen/behind (the
   * point is then clamped to the screen edge in the right direction).
   */
  private project(x: number, y: number, z: number, vw: number, vh: number, out: { x: number; y: number }, strict: boolean): boolean {
    const cam = this.ctx.camera;
    const f = this.fwd;
    const behind = (x - cam.position.x) * f.x + (y - cam.position.y) * f.y + (z - cam.position.z) * f.z < 0;
    const v = this.v.set(x, y, z).project(cam);
    let nx = v.x;
    let ny = v.y;
    if (behind) {
      // Mirrored by the projection: flip, then push onto the nearest screen edge.
      nx = -nx;
      ny = -ny;
      if (Math.abs(nx) < 1e-3 && Math.abs(ny) < 1e-3) ny = -1;
      const m = Math.max(Math.abs(nx), Math.abs(ny));
      nx /= m;
      ny /= m;
    }
    const off = behind || nx < -1 || nx > 1 || ny < -1 || ny > 1;
    if (off && !strict) {
      const m = Math.max(Math.abs(nx), Math.abs(ny));
      if (m > 1) {
        nx /= m;
        ny /= m;
      }
    }
    out.x = ((nx + 1) / 2) * vw;
    out.y = ((1 - ny) / 2) * vh;
    return off;
  }

  /** Pickup interaction prompt when standing near an available Sunspear. */
  pickupPrompt(): string | null {
    const ctx = this.ctx;
    const m = ctx.predictor.move;
    const c = ctx.predictor.combat;
    if (!m || !c || !ctx.predictor.alive) return null;
    const full = c.slots[2] && c.slots[2].mag >= WEAPONS.sunspear.magSize;
    if (full) return null;
    for (const pk of ctx.pickups) {
      const pd = pk.available ? this.pickupDefs.get(pk.id) : undefined;
      if (!pd) continue;
      const dx = m.pos.x - pd.pos.x;
      const dz = m.pos.z - pd.pos.z;
      const dy = m.pos.y - pd.pos.y;
      if (dy < -1.6 || dy > 1.6 || dx * dx + dz * dz > PICKUP_INTERACT_RADIUS * PICKUP_INTERACT_RADIUS) continue;
      const key = ctx.app.input.device === 'kbm' ? (ctx.app.settings.value.bindings.interact?.keys[0] ?? '') : '';
      const sig = `${ctx.app.i18n.lang}|${key}`;
      if (sig !== this.promptSig) {
        this.promptSig = sig;
        const text = ctx.app.i18n.t('hud.prompt.pickup', { weapon: ctx.app.i18n.t(WEAPONS.sunspear.nameKey) });
        this.promptText = key ? `${keyLabel(key)} · ${text}` : text;
      }
      return this.promptText;
    }
    return null;
  }

  /** Scoreboard entries (latest host rows + roster + live flags). */
  scoreboardEntries(): ScoreboardEntry[] {
    const ctx = this.ctx;
    const out: ScoreboardEntry[] = [];
    for (const ident of ctx.players.values()) {
      const r = this.rows.find((x) => x.id === ident.id);
      const local = ident.id === ctx.localId;
      const e = ctx.view?.remotes.get(ident.id);
      out.push({
        id: ident.id,
        name: ident.name,
        team: ident.team,
        kills: r?.kills ?? 0,
        deaths: r?.deaths ?? 0,
        assists: r?.assists ?? 0,
        score: r?.score ?? 0,
        objectiveTime: r?.objectiveTime ?? 0,
        ping: local ? Math.round(this.ping) : (r?.ping ?? 0),
        isBot: ident.isBot,
        local,
        level: ident.level,
        alive: local ? ctx.predictor.alive : (e?.alive ?? true),
      });
    }
    return out;
  }

  /** Mode label for banners. */
  modeName(): string {
    return this.ctx.app.i18n.t(MODES[this.ctx.config.mode].nameKey);
  }

  /** Active weapon of the predicted state. */
  weapon(): string {
    const c = this.ctx.predictor.combat;
    return c ? activeWeapon(c) : 'meridian';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — ClientMatch: the in-match orchestrator.
//
// Created by the App on 'matchStart'; owns the transport subscription and
// every in-match subsystem:
//   net messages ─► InterpClock / Predictor.reconcile / RemotePlayers /
//                   Feedback (FX, audio, HUD) / extensions
//   rAF update   ─► look (per frame) ─► fixed 60 Hz ticks: LocalPlayer.buildCmd
//                   → Predictor.step (+ predicted feedback) → 'input' msg with
//                   the last ≤ 8 unacked cmds (once per frame)
//                ─► remote interpolation, projectiles/smokes/targets
//                ─► camera (first person / CameraDirector) + viewmodel + feel
//                ─► map runtime, effects, audio listener, HUD, extensions
// Lifecycle: `ready` resolves when the map view is built (App drives the
// loading dial from `loadProgress`), `done` resolves with the results on
// 'matchEnd' (or null when leaving). dispose() releases everything.
// Helpers: predictor, interpolator, local-player, first-person (camera rig,
// viewmodel state, aim assist), remote-players, world-state (projectiles,
// smokes, range targets), feedback, hud-bridge, match-flow (intro, music,
// callouts, outro), deathcam (camera director), overlays, range-stats.
// Debug hooks (?debug=1): debugState(), debugFaceEnemy(), debugEndMatch(),
// setTimeScale().
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { App } from '../app';
import type { MapRuntimeState } from '../contracts';
import { CameraFeelController } from '../engine/camera-feel';
import { EffectsSystem } from '../engine/effects';
import { teamColors, UI } from '../engine/palette';
import { keyLabel } from '../state/settings';
import { buildMapView, gradingForLighting } from '../world/map-builder';
import { FirstPersonViewModel } from '../world/viewmodel';
import type { Transport } from '../net/transport';
import { LocalHostLink } from '../net/local-host';
import { SIM_DT } from '../../shared/constants';
import { getMap } from '../../shared/maps/index';
import type { MapDef } from '../../shared/maps/types';
import { clamp } from '../../shared/math';
import type { CollisionWorld } from '../../shared/physics';
import type { MatchEndMsg, MatchStartMsg, ScoreboardRow, ServerMsg, SnapshotMsg } from '../../shared/protocol';
import { worldForMap } from '../../shared/sim/game';
import type { RangeSummary } from '../../shared/sim/range';
import type {
  GameConfig,
  GameEvent,
  MatchClock,
  MatchPhase,
  MatchResults,
  PickupSnap,
  PlayerIdentity,
  SmokeSnap,
  TargetSnap,
  Team,
  ZoneSnap,
} from '../../shared/types';
import type { MatchContext, MatchView } from './context';
import { CameraDirector } from './deathcam';
import { FirstPersonRig } from './first-person';
import type { InstructionOptions, MatchApi, MatchExtension } from './extensions';
import { Feedback, type StepMarks } from './feedback';
import { HudBridge } from './hud-bridge';
import { InterpClock } from './interpolator';
import { LocalPlayer } from './local-player';
import { MatchFlow } from './match-flow';
import { MatchOverlays } from './overlays';
import { Predictor } from './predictor';
import { RangePanel } from './range-stats';
import { RemotePlayers } from './remote-players';
import { Scheduler } from './scheduler';
import { WorldState } from './world-state';

type MatchOutcome = { results: MatchResults; ratingDelta: number } | null;

const MAX_TICKS_PER_FRAME = 6;
const PING_MS = 2000;
const DEATH_SATURATION = 0.5;

/** Yields to the browser (a frame when visible; a task when hidden, where rAF is paused). */
const nextFrame = (): Promise<void> =>
  new Promise((r) => (typeof document !== 'undefined' && document.hidden ? window.setTimeout(r, 0) : requestAnimationFrame(() => r())));

export class ClientMatch implements MatchContext, MatchApi {
  readonly done: Promise<MatchOutcome>;
  readonly ready: Promise<void>;
  /** 0..1 build progress for the loading screen. */
  loadProgress = 0;

  readonly app: App;
  readonly config: GameConfig;
  readonly def: MapDef;
  readonly world: CollisionWorld;
  readonly localId: number;
  localTeam: Team;
  readonly players = new Map<number, PlayerIdentity>();
  readonly predictor: Predictor;
  readonly local = new LocalPlayer();
  readonly camera: THREE.PerspectiveCamera;
  readonly scheduler = new Scheduler();
  readonly interp = new InterpClock();
  view: MatchView | null = null;
  clock: MatchClock;
  zones: ZoneSnap[] = [];
  pickups: PickupSnap[] = [];
  smokes: SmokeSnap[] = [];
  readonly camPos = new THREE.Vector3();
  camYaw = 0;

  private readonly transport: Transport;
  private readonly offs: (() => void)[] = [];
  private resolveDone!: (v: MatchOutcome) => void;
  private settled = false;
  private disposed = false;
  private leaving = false;
  private leaveTimer = 0;
  private readonly hudBridge: HudBridge;
  private feedback: Feedback | null = null;
  private overlays: MatchOverlays | null = null;
  private range: RangePanel | null = null;
  private readonly director: CameraDirector;
  private readonly rig: FirstPersonRig;
  private readonly flow: MatchFlow;
  private readonly worldState: WorldState;
  private readonly extensions: MatchExtension[] = [];
  private offQuality: (() => void) | null = null;
  private pendingSnaps: SnapshotMsg[] = [];

  // Frame / tick state.
  private acc = 0;
  private lastFrameAt = 0;
  private timeScale = 1;
  private clockAt = 0;
  private lookDx = 0;
  private lookDy = 0;
  private readonly errTmp = { x: 0, y: 0, z: 0 };
  private readonly curEye = { x: 0, y: 0, z: 0 };
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly vtmp = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly killerHead = new THREE.Vector3();
  private readonly orbitCenter = new THREE.Vector3();
  private readonly marks: StepMarks = { onGround: true, mantleT: 0, slideT: 0, stride: 0, mag: 0, weapon: 'meridian' };
  private readonly runtime: MapRuntimeState;

  // Lifecycle state.
  private yawInit = false;
  private killerId = -1;
  private deathGrade = 0;
  private baseSaturation = 1.13;
  private overlayOn = false;
  private heartbeat = 0;
  private scoreboardShown = false;
  private pingTimer = 0;
  private ping = 0;

  // Diagnostics.
  private snaps = 0;
  private inputsSent = 0;

  constructor(app: App, transport: Transport, start: MatchStartMsg) {
    this.app = app;
    this.transport = transport;
    this.config = start.config;
    this.localId = start.you;
    for (const p of start.players) this.players.set(p.id, p);
    this.localTeam = this.players.get(start.you)?.team ?? 2;
    this.def = getMap(start.config.map);
    this.world = worldForMap(this.def);
    this.predictor = new Predictor(this.world, start.you);
    this.clock = { phase: start.config.countdown > 0 ? 'countdown' : 'live', phaseLeft: start.config.countdown, elapsed: 0, teamScores: [0, 0] };
    this.clockAt = performance.now();
    this.camera = new THREE.PerspectiveCamera(60, app.engine.size.aspect || 16 / 9, 0.05, 1000);
    this.camera.name = 'match.camera';
    this.hudBridge = new HudBridge(this);
    this.director = new CameraDirector(this.world);
    this.rig = new FirstPersonRig(this);
    this.flow = new MatchFlow(this, this.director, this.hudBridge, () => this.overlays);
    this.worldState = new WorldState(this);
    this.runtime = {
      time: 0,
      matchElapsed: 0,
      matchProgress: 0,
      phase: this.clock.phase,
      zones: this.zones,
      pickups: this.pickups,
      targets: this.worldState.targets,
      localTeam: this.localTeam,
      camera: this.camera,
      rocketLaunch: null,
    };
    this.done = new Promise<MatchOutcome>((r) => (this.resolveDone = r));
    this.offs.push(transport.onMessage((m) => this.onMessage(m)));
    this.pingTimer = window.setInterval(() => this.sendPing(), PING_MS);
    this.sendPing();
    this.ready = this.build().catch((err) => {
      console.error('[match] failed to build the match view', err);
      this.app.ui.toast('errors.generic', 'error');
      this.leave();
    });
  }

  // ═══ Build ═══════════════════════════════════════════════════════════════

  private async build(): Promise<void> {
    const app = this.app;
    this.loadProgress = 0.02;
    // The map build is a long synchronous chunk: let the loading screen (key art,
    // tips, dial) mount and paint first instead of freezing the previous screen.
    for (let i = 0; i < 60 && !this.disposed && app.ui.baseScreen !== 'loading' && app.ui.baseScreen !== 'match'; i++) await nextFrame();
    await nextFrame();
    if (this.disposed) return;
    this.loadProgress = 0.05;
    const map = await buildMapView(this.def, { engine: app.engine, materials: app.materials });
    if (this.disposed) {
      map.dispose();
      return;
    }
    this.loadProgress = 0.55;
    const q = app.engine.quality;
    const effects = new EffectsSystem(map.scene, q);
    const vm = new FirstPersonViewModel(app.weapons, app.engine);
    // Rendering: the local muzzle flash is drawn in the viewmodel overlay (over the gun).
    effects.attachOverlay(vm.scene, vm.camera);
    const me = this.players.get(this.localId);
    vm.setTeamLight(teamColors(this.localTeam === 2 ? (me?.faction ?? 0) : this.localTeam).primary);
    const feel = new CameraFeelController();
    feel.setShakeScale(app.settings.value.reducedShake ? 0.25 : 1);
    // Live settings: reduced shake, colour-blind team colours on the viewmodel rim light.
    this.offs.push(
      app.settings.onChange((st) => {
        feel.setShakeScale(st.reducedShake ? 0.25 : 1);
        vm.setTeamLight(teamColors(this.localTeam === 2 ? (this.players.get(this.localId)?.faction ?? 0) : this.localTeam).primary);
      }),
    );
    const remotes = new RemotePlayers(this, map.scene);
    this.view = { map, effects, vm, feel, remotes };
    map.scene.add(this.camera);
    const ids = [...this.players.keys()];
    for (let i = 0; i < ids.length; i++) {
      // Roster may change while we yield (join/leave events): only add who is still here.
      const ident = this.players.get(ids[i]);
      if (ident) remotes.add(ident);
      if (i % 3 === 2) {
        this.loadProgress = 0.55 + 0.3 * ((i + 1) / ids.length);
        await nextFrame();
        if (this.disposed) return;
      }
    }
    for (const s of this.pendingSnaps) remotes.push(s.tick, s.players);
    this.pendingSnaps = [];
    this.baseSaturation = gradingForLighting(this.def.lighting).saturation ?? 1.13;

    // HUD-side overlays, range stats, feedback.
    app.hud.setScale(app.settings.value.hudScale);
    app.hud.setCrosshair(app.settings.value.crosshair, app.settings.value.crosshairColor);
    this.overlays = new MatchOverlays(app.hud.root);
    if (this.config.mode === 'range') {
      // Range stats panel + stations (rack / reset / speed) + floating hit numbers.
      this.range = new RangePanel(app.hud.root, this);
      this.use(this.range);
    }
    this.feedback = new Feedback(this, this.hudBridge, this.range);

    // Engine & audio.
    const intro = map.showcase('intro');
    this.camera.position.set(intro.pos.x, intro.pos.y, intro.pos.z);
    this.camera.lookAt(intro.target.x, intro.target.y, intro.target.z);
    this.camera.fov = intro.fov;
    this.camera.updateProjectionMatrix();
    // The scene is handed to the engine when the match screen appears (startIntro):
    // rendering it behind the loading screen would only slow loading down.
    app.engine.setOverlay(null, null);
    this.offQuality = app.engine.onQualityChange((nq) => {
      map.atmosphere.setQuality(nq);
      effects.setQuality(nq);
    });
    app.audio.setEnvironment(this.def);
    // Audio pass: occlusion / indoor-acoustics probe on the collision world.
    app.audio.setOcclusionProbe((ax, ay, az, bx, by, bz) => !this.world.segmentClear(ax, ay, az, bx, by, bz, 'sight'));
    app.input.setAimAssist(this.rig.aimAssist);
    await this.warmShaders(map.scene, vm.scene, vm.camera);
    if (this.disposed) return;
    this.loadProgress = 0.95;
    if (this.config.tutorial) await this.loadTutorial();
    this.loadProgress = 1;
  }

  /**
   * Compiles every material behind the loading screen so the first frames don't
   * hitch — in small chunks with frame yields, so the page keeps processing
   * network traffic (a main thread blocked for seconds would starve the socket's
   * heartbeat on slow devices). Everything hidden (characters not yet spawned, pooled
   * effects, other weapons) is made visible for the pass: compile() skips invisible
   * objects, and a program first compiled mid-fight is a visible hitch.
   */
  private async warmShaders(scene: THREE.Scene, overlay: THREE.Scene, overlayCam: THREE.Camera): Promise<void> {
    const r = this.app.engine.renderer;
    const hidden: THREE.Object3D[] = [];
    const reveal = (o: THREE.Object3D): void => {
      // Lights keep their state: the light setup is part of every program's cache key.
      if (!o.visible && !(o as THREE.Light).isLight) {
        o.visible = true;
        hidden.push(o);
      }
    };
    scene.traverse(reveal);
    overlay.traverse(reveal);
    const items: THREE.Object3D[] = [];
    for (const c of scene.children) {
      if (c.children.length > 6) items.push(...c.children);
      else items.push(c);
    }
    let t = performance.now();
    const prevTarget = r.getRenderTarget();
    try {
      // Compile against the target the frame will actually draw into (see Renderer.sceneTarget).
      r.setRenderTarget(this.app.engine.sceneTarget);
      for (const o of items) {
        if (this.disposed) return;
        r.compile(o, this.camera, scene);
        if (performance.now() - t > 20) {
          await nextFrame();
          t = performance.now();
        }
      }
      r.setRenderTarget(this.app.engine.sceneTarget);
      r.compile(overlay, overlayCam);
    } catch (err) {
      console.warn('[match] shader warm-up skipped', err);
    } finally {
      r.setRenderTarget(prevTarget);
      for (const o of hidden) o.visible = false;
    }
    await this.finishPrograms();
  }

  /**
   * compile() only issues the compile/link calls; three.js queries the link
   * result and uniform locations on a program's FIRST USE, which blocks until
   * the driver has finished (seconds in total on slow GPUs / software GL) — i.e.
   * the first frames of the intro would freeze. Finish every program here,
   * behind the loading screen: with KHR_parallel_shader_compile we wait without
   * blocking; otherwise one program per slice, yielding between them.
   */
  private async finishPrograms(): Promise<void> {
    const r = this.app.engine.renderer;
    const programs = (r.info.programs ?? []) as unknown as { isReady?: () => boolean; getUniforms: () => unknown }[];
    const from = this.loadProgress;
    let t = performance.now();
    try {
      for (let i = 0; i < programs.length; i++) {
        if (this.disposed) return;
        const prog = programs[i];
        const waitUntil = performance.now() + 3000;
        while (prog.isReady && !prog.isReady() && performance.now() < waitUntil) {
          await new Promise((res) => window.setTimeout(res, 8));
          if (this.disposed) return;
        }
        prog.getUniforms();
        this.loadProgress = from + (0.95 - from) * ((i + 1) / programs.length);
        if (performance.now() - t > 20) {
          await nextFrame();
          t = performance.now();
        }
      }
    } catch (err) {
      console.warn('[match] shader finish skipped', err);
    }
  }

  private async loadTutorial(): Promise<void> {
    try {
      const mods = import.meta.glob<{ default: (m: MatchApi) => MatchExtension }>('./tutorial.ts');
      const load = mods['./tutorial.ts'];
      if (!load) return;
      const mod = await load();
      if (!this.disposed && typeof mod.default === 'function') this.use(mod.default(this));
    } catch (err) {
      console.error('[match] tutorial failed to load', err);
    }
  }

  // ═══ Network ═════════════════════════════════════════════════════════════

  private send(m: Parameters<Transport['send']>[0]): void {
    try {
      this.transport.send(m);
    } catch (err) {
      console.warn('[match] send failed', err);
    }
  }

  private sendPing(): void {
    if (!this.disposed) this.send({ type: 'ping', t: performance.now() });
  }

  private onMessage(m: ServerMsg): void {
    if (this.disposed) return;
    try {
      switch (m.type) {
        case 'snap':
          this.onSnapshot(m);
          break;
        case 'scoreboard':
          this.flow.onScoreboard(m.rows);
          this.hudBridge.onScoreboard(m.rows);
          break;
        case 'pong': {
          const rtt = Math.max(0, performance.now() - m.t);
          this.ping = this.ping ? this.ping * 0.7 + rtt * 0.3 : rtt;
          this.hudBridge.ping = this.ping;
          break;
        }
        case 'matchEnd':
          this.onMatchEnd(m);
          break;
        default:
          break;
      }
    } catch (err) {
      console.error('[match] message handling failed', m.type, err);
    }
  }

  private onSnapshot(s: SnapshotMsg): void {
    const now = performance.now();
    this.snaps++;
    this.interp.onSnapshot(s.tick, now);
    this.setClock(s.clock, now);
    this.zones = s.zones;
    this.pickups = s.pickups;
    this.smokes = s.smokes;
    this.runtime.zones = s.zones;
    this.runtime.pickups = s.pickups;
    this.worldState.onSnapshot(s);
    if (this.view) this.view.remotes.push(s.tick, s.players);
    else {
      this.pendingSnaps.push(s);
      if (this.pendingSnaps.length > 8) this.pendingSnaps.shift();
    }
    if (!this.yawInit) {
      // Our spawn event predates matchStart; the host seeds lastCmd.yaw with the spawn yaw.
      const mine = s.players.find((p) => p.id === this.localId);
      if (mine) {
        this.yawInit = true;
        this.local.setAngles(mine.yaw, 0);
      }
    }
    if (s.self) {
      const r = this.predictor.reconcile(s.self, this.errTmp);
      if (r.snapped) this.rig.correction.set(0, 0, 0);
      else this.rig.addCorrection(this.errTmp);
    }
    for (const ev of s.events) this.onEvent(ev, s.tick);
    for (const x of this.extensions) x.onSnapshot?.(s);
    this.flow.checkLead();
  }

  private setClock(c: MatchClock, now: number): void {
    const prev = this.clock.phase;
    this.clock = c;
    this.clockAt = now;
    this.runtime.phase = c.phase;
    if (prev !== c.phase && c.phase === 'ended') this.flow.beginOutro();
  }

  /** Locally extrapolated seconds left in the current phase. */
  private phaseLeft(): number {
    const c = this.clock;
    if (this.config.mode === 'range' && c.phase === 'live') return 0;
    return Math.max(0, c.phaseLeft - (performance.now() - this.clockAt) / 1000);
  }

  private onEvent(ev: GameEvent, tick: number): void {
    const me = this.localId;
    switch (ev.t) {
      case 'join': {
        const known = this.players.has(ev.p.id);
        this.players.set(ev.p.id, ev.p);
        this.view?.remotes.add(ev.p);
        if (!known && !ev.p.isBot && ev.p.id !== me) this.app.hud.toast(this.app.i18n.t('match.joined', { name: ev.p.name }));
        break;
      }
      case 'leave': {
        const p = this.players.get(ev.p);
        if (!p) break;
        this.players.delete(ev.p);
        this.view?.remotes.remove(ev.p);
        this.scheduler.cancel(`r${ev.p}`);
        if (!p.isBot) this.app.hud.toast(this.app.i18n.t('match.left', { name: p.name }));
        break;
      }
      case 'teamSwap': {
        const p = this.players.get(ev.p);
        if (!p) break;
        const np: PlayerIdentity = { ...p, team: ev.team, faction: ev.team === 0 || ev.team === 1 ? ev.team : p.faction };
        this.players.set(ev.p, np);
        if (ev.p === me) this.localTeam = ev.team;
        this.view?.remotes.add(np);
        this.app.hud.toast(this.app.i18n.t('match.switched', { name: np.name, team: this.app.i18n.t(`common.team.${ev.team}`) }));
        break;
      }
      case 'spawn':
        if (ev.p === me) this.onLocalSpawn(ev.yaw);
        break;
      case 'kill':
        if (ev.v === me) this.onLocalDeath(ev.k);
        {
          const e = this.view?.remotes.get(ev.v);
          if (e) this.flow.noteKill(e.pos);
        }
        break;
      case 'pickup':
        if (ev.p === me) this.local.requestSlot(2);
        break;
      case 'phase':
        this.flow.onPhase(ev.phase);
        break;
      case 'announce':
        this.flow.onAnnounce(ev.key);
        break;
      default:
        break;
    }
    this.feedback?.event(ev, tick);
    for (const x of this.extensions) {
      try {
        x.onEvent?.(ev);
      } catch (err) {
        console.error('[match] extension onEvent failed', err);
      }
    }
  }

  private onMatchEnd(m: MatchEndMsg): void {
    this.finish({ results: m.results, ratingDelta: m.ratingDelta });
  }

  // ═══ Local lifecycle ═════════════════════════════════════════════════════

  private onLocalSpawn(yaw: number): void {
    this.local.setAngles(yaw, 0);
    this.local.requestSlot(0);
    this.local.releaseButtons();
    this.yawInit = true;
    this.rig.correction.set(0, 0, 0);
    this.killerId = -1;
    this.view?.feel.reset();
    if (this.director.mode === 'death') this.director.toFirstPerson();
  }

  private onLocalDeath(killer: number): void {
    this.killerId = killer !== this.localId ? killer : -1;
    this.local.releaseButtons();
    if (this.director.mode === 'outro') return;
    const m = this.predictor.move;
    const eye = m ? this.predictor.eye(this.curEye) : { x: this.camPos.x, y: this.camPos.y, z: this.camPos.z };
    this.director.startDeath(this.camera, this.vtmp.set(eye.x, eye.y, eye.z), this.local.yaw);
  }

  // ═══ Frame ═══════════════════════════════════════════════════════════════

  update(rawDt: number): void {
    if (this.disposed) return;
    const now = performance.now();
    // Back from a hidden tab / long stall: world FX queued meanwhile are stale — drop them.
    if (now - this.lastFrameAt > 1000) this.feedback?.clear();
    this.lastFrameAt = now;
    this.interp.update(now, rawDt);
    const view = this.view;
    if (!view) return;
    const app = this.app;
    const dt = rawDt * this.timeScale;
    const inMatchScreen = app.ui.baseScreen === 'match';
    if (inMatchScreen && !this.flow.started) {
      app.engine.setScene(view.map.scene, this.camera);
      this.flow.startIntro(this.phaseLeft());
      // The host holds the pre-match countdown until we are actually showing the match.
      this.send({ type: 'loaded' });
    }

    // ── Look (every frame, zero latency) ──
    const look = app.input.consumeLook();
    this.lookDx = look.dx;
    this.lookDy = look.dy;
    const controllable = this.predictor.alive && this.director.mode !== 'death' && this.director.mode !== 'outro';
    if (controllable) {
      this.local.look(look.dx, look.dy);
      if (this.director.mode === 'intro' && this.clock.phase === 'live' && (look.dx !== 0 || look.dy !== 0 || this.local.moveX !== 0 || this.local.moveZ !== 0)) this.director.hurryIntro();
    }
    this.local.sampleFrame(app.input);

    // ── Fixed-step simulation ──
    this.acc += rawDt;
    let ticks = 0;
    while (this.acc >= SIM_DT && ticks < MAX_TICKS_PER_FRAME) {
      this.acc -= SIM_DT;
      ticks++;
      this.tick();
    }
    if (this.acc > SIM_DT) this.acc = SIM_DT; // drop backlog after a hitch
    if (ticks > 0 && this.predictor.unacked.length > 0) {
      this.send({ type: 'input', cmds: this.predictor.resendList(8) });
      this.inputsSent++;
    }
    const alpha = clamp(this.acc / SIM_DT, 0, 1);
    if (!this.flow.started) {
      // Still behind the loading screen: keep the command stream alive but skip all
      // presentation work, and drop queued world FX so they don't burst at the intro.
      this.feedback?.clear();
      return;
    }

    // ── World ──
    this.scheduler.update(dt);
    this.feedback?.frame();
    this.range?.tick(dt);
    view.remotes.update(dt, this.interp.renderTick, this.camPos);
    this.worldState.update(this.interp.renderTick);
    this.feedback?.update(this.interp.renderTick);

    // ── Camera ──
    this.updateCamera(dt, alpha);

    // ── Map, effects, audio ──
    const rt = this.runtime;
    const left = this.phaseLeft();
    this.flow.frame(dt, left);
    rt.time += dt;
    const live = this.clock.phase === 'live';
    rt.matchElapsed = this.clock.elapsed + (live ? (now - this.clockAt) / 1000 : 0);
    rt.matchProgress = this.clock.phase === 'ended' ? 1 : this.config.timeLimit > 0 ? clamp(rt.matchElapsed / this.config.timeLimit, 0, 1) : 0;
    rt.localTeam = this.localTeam;
    rt.rocketLaunch = this.flow.rocket;
    view.map.update(dt, rt);
    view.effects.update(dt, this.camera);
    this.camera.getWorldDirection(this.fwd);
    this.up.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    app.audio.setListener(this.camera.position, this.fwd, this.up);
    const hb = this.predictor.alive && this.predictor.health < 35 ? 1 - this.predictor.health / 35 : 0;
    if (Math.abs(hb - this.heartbeat) > 0.02 || (hb === 0 && this.heartbeat !== 0)) {
      this.heartbeat = hb;
      app.audio.setHeartbeat(hb);
    }

    // ── HUD ──
    this.updateHud(dt, left);
    for (const x of this.extensions) {
      try {
        x.onTick?.(dt);
      } catch (err) {
        console.error('[match] extension onTick failed', err);
      }
    }
  }

  /** One fixed SIM_DT tick: command → prediction → predicted feedback. */
  private tick(): void {
    const p = this.predictor;
    const allowFire = this.clock.phase === 'live' || this.config.mode === 'range';
    const cmd = this.local.buildCmd(this.interp.renderTick, p.combat, allowFire && this.director.mode !== 'outro');
    const m = p.move;
    const c = p.combat;
    const mk = this.marks;
    if (m && c) {
      mk.onGround = m.onGround;
      mk.mantleT = m.mantleT;
      mk.slideT = m.slideT;
      mk.stride = m.stride;
      const slot = c.slots[c.active] ?? c.slots[0];
      mk.mag = slot.mag;
      mk.weapon = slot.id;
    }
    const r = p.step(cmd);
    if (r && m && c) this.feedback?.localStep(r, mk);
  }

  private updateCamera(dt: number, alpha: number): void {
    const p = this.predictor;
    const view = this.view as MatchView;
    const rig = this.rig;
    rig.lookDx = this.lookDx;
    rig.lookDy = this.lookDy;
    const fp = rig.compute(dt, alpha);
    const killer = this.killerId >= 0 ? view.remotes.get(this.killerId) : undefined;
    const kpos = killer && killer.alive ? this.killerHead.set(killer.pos.x, killer.pos.y + 1.5, killer.pos.z) : null;
    const center = this.director.mode === 'outro' ? this.flow.outroCenter(this.orbitCenter) : null;
    this.director.apply(dt, this.camera, fp, kpos, center);
    this.camPos.copy(this.camera.position);
    const fpMode = this.director.mode === 'fp';
    this.camYaw = fpMode ? rig.yaw : this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ').y;
    rig.assistEnabled = fpMode;

    // Viewmodel only in live first person; HUD cinematic during intro/outro.
    const fpVisible = fpMode && p.alive && !!p.move;
    if (fpVisible !== this.overlayOn) {
      this.overlayOn = fpVisible;
      this.app.engine.setOverlay(fpVisible ? view.vm.scene : null, fpVisible ? view.vm.camera : null);
    }
    if (fpVisible) rig.updateViewModel(dt);
    this.overlays?.setCinematic(this.director.mode === 'intro' || this.director.mode === 'outro');

    // Death: gently desaturate while the camera watches your killer.
    const target = this.director.mode === 'death' ? 1 : 0;
    if (this.deathGrade !== target) {
      this.deathGrade = target > this.deathGrade ? Math.min(target, this.deathGrade + dt / 0.6) : Math.max(target, this.deathGrade - dt / 0.3);
      this.app.engine.setGrading({ saturation: this.baseSaturation * (1 - (1 - DEATH_SATURATION) * this.deathGrade) });
    }
  }

  private updateHud(dt: number, left: number): void {
    const app = this.app;
    const b = this.hudBridge;
    const inGameplay = app.ui.current === 'match' && !app.isPaused;
    const fpLive = this.director.mode === 'fp' || this.director.mode === 'intro';
    if (app.input.device === 'kbm' && !app.input.pointerLocked && inGameplay && fpLive && this.predictor.alive) b.prompt = app.i18n.t('match.clickToEngage');
    else b.prompt = b.pickupPrompt() ?? this.extPrompt;
    const size = app.engine.size;
    const vw = window.innerWidth || size.width;
    const vh = window.innerHeight || size.height;
    app.hud.update(dt, b.build(left, vw, vh));
    // The touch controls now carry their own (movable) scoreboard toggle → input.down('scoreboard').
    this.overlays?.setTouchScoreboardVisible(false);
    const want = inGameplay && (app.input.down('scoreboard') || !!this.overlays?.scoreboardToggled) && this.director.mode !== 'outro';
    if (want) app.hud.scoreboard(true, b.scoreboardEntries(), this.config.mode);
    else if (this.scoreboardShown) app.hud.scoreboard(false, [], this.config.mode);
    this.scoreboardShown = want;
  }

  // ═══ MatchContext helpers ═══════════════════════════════════════════════

  get renderTick(): number {
    return this.interp.renderTick;
  }

  get targets(): readonly TargetSnap[] {
    return this.worldState.targets;
  }

  isEnemy(id: number): boolean {
    if (id === this.localId) return false;
    if (this.config.mode === 'ffa' || this.config.mode === 'range') return true;
    return this.teamOf(id) !== this.localTeam;
  }

  nameOf(id: number): string {
    return this.players.get(id)?.name ?? '';
  }

  teamOf(id: number): Team {
    return this.players.get(id)?.team ?? 2;
  }

  // ═══ MatchApi (extensions / tutorial) ═══════════════════════════════════

  get move() {
    return this.predictor.alive ? this.predictor.move : null;
  }

  get combat() {
    return this.predictor.alive ? this.predictor.combat : null;
  }

  get alive(): boolean {
    return this.predictor.alive;
  }

  get health(): number {
    return this.predictor.alive ? this.predictor.health : 0;
  }

  get yaw(): number {
    return this.local.yaw;
  }

  get pitch(): number {
    return this.local.pitch;
  }

  get hud() {
    return this.app.hud;
  }

  get audio() {
    return this.app.audio;
  }

  get announcer() {
    return this.app.announcer;
  }

  get i18n() {
    return this.app.i18n;
  }

  get device(): string {
    return this.app.input.device;
  }

  rangeSummary(): RangeSummary {
    return this.range?.summary() ?? { shots: 0, hits: 0, headshots: 0, kills: 0, accuracy: 0, ttkByDistance: [] };
  }

  instruct(text: string | null, opts?: InstructionOptions): void {
    this.overlays?.instruct(text, opts);
  }

  resetRange(): void {
    this.send({ type: 'range', action: 'reset' });
    this.range?.reset();
  }

  setRangeSpeed(k: number): void {
    this.send({ type: 'range', action: 'difficulty', value: k });
  }

  keyLabel(action: string): string {
    const b = this.app.settings.value.bindings as Record<string, { keys: string[] } | undefined>;
    const k = b[action]?.keys[0];
    return k ? keyLabel(k) : '';
  }

  use(ext: MatchExtension): void {
    this.extensions.push(ext);
  }

  // Additive MatchApi members (Training Range + tutorial).
  private extPrompt: string | null = null;

  get input() {
    return this.app.input;
  }

  get scene(): THREE.Scene | null {
    return this.view?.map.scene ?? null;
  }

  get controllable(): boolean {
    return this.predictor.alive && this.director.mode === 'fp' && !this.app.isPaused && this.app.ui.current === 'match';
  }

  get localSeq(): number {
    return this.local.seq;
  }

  setRangeWeapon(index: number): void {
    if (this.config.mode === 'range') this.send({ type: 'range', action: 'weapon', value: index });
  }

  setRangeThrowable(index: number): void {
    if (this.config.mode === 'range') this.send({ type: 'range', action: 'throwable', value: index });
  }

  setPrompt(text: string | null): void {
    this.extPrompt = text;
  }

  /** Leaves without the results screen (tutorial "Play now" / "Keep practicing" never needs one). */
  exit(next: 'menu' | 'quickplay'): void {
    if (this.leaving) return;
    this.leaving = true;
    this.send({ type: 'leave' });
    this.finish(null);
    if (next === 'quickplay') window.setTimeout(() => void this.app.quickPlay('tdm'), 0);
  }

  // ═══ Lifecycle ═══════════════════════════════════════════════════════════

  private finish(v: MatchOutcome): void {
    if (this.settled) return;
    this.settled = true;
    window.clearTimeout(this.leaveTimer);
    this.resolveDone(v);
  }

  /** Leaves the match: 'leave' to the host; the range answers with its session results. */
  leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.send({ type: 'leave' });
    if (this.config.mode === 'range' && !this.transport.closed) this.leaveTimer = window.setTimeout(() => this.finish(null), 1500);
    else this.finish(null);
  }

  /** Debug hook (?debug=1 → __HF.state()). */
  debugState(): Record<string, unknown> {
    const p = this.predictor;
    const c = p.combat;
    const slot = c ? (c.slots[c.active] ?? c.slots[0]) : null;
    return {
      mode: this.config.mode,
      map: this.config.map,
      phase: this.clock.phase,
      phaseLeft: Math.round(this.phaseLeft() * 10) / 10,
      players: this.players.size,
      you: this.localId,
      team: this.localTeam,
      health: this.health,
      alive: p.alive,
      ammo: slot ? slot.mag : null,
      reserve: slot ? slot.reserve : null,
      weapon: slot ? slot.id : null,
      pos: p.move ? { x: +p.move.pos.x.toFixed(2), y: +p.move.pos.y.toFixed(2), z: +p.move.pos.z.toFixed(2) } : null,
      yaw: +this.local.yaw.toFixed(3),
      ready: !!this.view,
      camera: this.director.mode,
      snaps: this.snaps,
      inputsSent: this.inputsSent,
      renderTick: Math.round(this.interp.renderTick * 10) / 10,
      latestTick: this.interp.latestTick,
      interpDelay: Math.round(this.interp.delayTicks * 10) / 10,
      jitter: Math.round(this.interp.jitter * 100) / 100,
      pending: p.unacked.length,
      ack: p.ackSeq,
      seq: this.local.seq,
      reconciles: p.reconciles,
      maxCorrection: Math.round(p.maxCorrection * 1000) / 1000,
      corrections: p.corrections.slice(),
      shotsFired: this.feedback?.shotsFired ?? 0,
      hitsConfirmed: this.feedback?.hitsConfirmed ?? 0,
      predictedHits: this.feedback?.predictedHits ?? 0,
      hostTickNow: Math.round(this.interp.hostTickAt(performance.now())),
      kills: this.feedback?.kills ?? 0,
      ping: Math.round(this.ping),
      scores: [...this.clock.teamScores],
      transport: this.transport.kind,
      /** Thread that owns the socket / runs the local host ('worker' | 'main' | 'pending'). */
      transportThread: (this.transport as { thread?: string; backend?: string }).thread ?? (this.transport as { backend?: string }).backend ?? '',
      roster: [...this.players.keys()],
      remotes: this.view ? [...this.view.remotes.entries.values()].filter((e) => !e.isLocal).map((e) => e.ident.id) : [],
      range: this.range ? this.range.summary() : null,
    };
  }

  /** Debug / e2e: turns the view toward the nearest visible enemy or range target (id or -1). */
  debugFaceEnemy(): number {
    return this.rig.faceNearestEnemy();
  }

  /** Debug / e2e: force-ends the match on the local host (bot matches only). */
  debugEndMatch(): boolean {
    if (this.transport.kind !== 'local') return false;
    LocalHostLink.get().debug('endMatch');
    return true;
  }

  /** Debug: scales client-side animation time (never the simulation). */
  setTimeScale(k: number): void {
    this.timeScale = clamp(Number.isFinite(k) ? k : 1, 0.05, 4);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.finish(null);
    for (const off of this.offs.splice(0)) off();
    window.clearInterval(this.pingTimer);
    window.clearTimeout(this.leaveTimer);
    for (const x of this.extensions.splice(0)) {
      try {
        x.dispose?.();
      } catch (err) {
        console.error('[match] extension dispose failed', err);
      }
    }
    const app = this.app;
    app.input.setAimAssist(null);
    app.input.setAimState(0, 1);
    app.audio.setHeartbeat(0);
    app.audio.setOcclusionProbe(null); // audio pass: drop the probe with the world
    app.hud.scoreboard(false, [], this.config.mode);
    app.hud.setVisible(true);
    this.offQuality?.();
    this.offQuality = null;
    const view = this.view;
    this.view = null;
    app.engine.setOverlay(null, null);
    if (view) {
      app.engine.setScene(null, null);
      try {
        view.remotes.dispose();
        view.effects.dispose();
        view.vm.dispose();
        view.map.dispose();
      } catch (err) {
        console.error('[match] dispose failed', err);
      }
    }
    this.overlays?.dispose();
    this.overlays = null;
    this.range?.dispose();
    this.range = null;
    this.feedback?.clear();
    this.scheduler.clear();
    this.worldState.clear();
    this.predictor.clear();
    this.pendingSnaps = [];
    this.camera.removeFromParent();
  }
}

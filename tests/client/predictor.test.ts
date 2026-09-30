import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, SIM_HZ } from '../../src/shared/constants';
import { HostCore, type HostConnection } from '../../src/shared/host/host-core';
import { getMap } from '../../src/shared/maps/index';
import { mulberry32 } from '../../src/shared/math';
import type { ClientMsg, MatchStartMsg, ServerMsg, SnapshotMsg } from '../../src/shared/protocol';
import { worldForMap } from '../../src/shared/sim/game';
import { sanitizeCmd } from '../../src/shared/sim/player';
import type { ModeId } from '../../src/shared/types';
import { LocalPlayer, type ActionName, type InputLike } from '../../src/client/game/local-player';
import { Predictor } from '../../src/client/game/predictor';

const TICK_MS = 1000 / SIM_HZ;

/** Scripted input device. */
class ScriptInput implements InputLike {
  held = new Set<ActionName>();
  edges = new Set<ActionName>();
  axes = { x: 0, y: 0 };
  moveAxes() {
    return this.axes;
  }
  down(a: ActionName) {
    return this.held.has(a) || this.edges.has(a);
  }
  pressed(a: ActionName) {
    return this.edges.has(a);
  }
}

/**
 * One client connected to a local HostCore through a simulated network
 * (latency both ways, optional input-message loss). The client runs the real
 * LocalPlayer + Predictor loop once per tick.
 */
class NetSim {
  now = 1000;
  readonly host = new HostCore({ kind: 'local', seed: 11 });
  private toHost: { at: number; m: ClientMsg }[] = [];
  private toClient: { at: number; m: ServerMsg }[] = [];
  readonly conn: HostConnection;
  start: MatchStartMsg | null = null;
  predictor: Predictor | null = null;
  readonly local = new LocalPlayer();
  readonly input = new ScriptInput();
  readonly rng = mulberry32(5);
  corrections: number[] = [];
  snaps = 0;
  shots = 0;
  phase = 'countdown';

  constructor(private readonly latencyMs: number, private readonly lossRate = 0) {
    this.conn = {
      id: 'c1',
      send: (m: ServerMsg) => this.toClient.push({ at: this.now + this.latencyMs, m: JSON.parse(JSON.stringify(m)) as ServerMsg }),
    };
    this.host.connect(this.conn);
    this.clientSend({ type: 'hello', protocol: PROTOCOL_VERSION, name: 'Tester', platform: 'desktop', lang: 'en', level: 3, rating: 1000, loadout: { primary: 'meridian', throwable: 'grenade' }, cosmetics: { armor: 'standard', visor: 'band', namecard: 'horizon', elimFx: 'default', skins: {} }, faction: 0 });
  }

  clientSend(m: ClientMsg, lossy = false): void {
    if (lossy && this.rng() < this.lossRate) return;
    this.toHost.push({ at: this.now + this.latencyMs, m: JSON.parse(JSON.stringify(m)) as ClientMsg });
  }

  private deliver(): void {
    while (this.toHost.length && this.toHost[0].at <= this.now) this.host.receive(this.conn, this.toHost.shift()!.m);
    while (this.toClient.length && this.toClient[0].at <= this.now) this.onClient(this.toClient.shift()!.m);
  }

  private onClient(m: ServerMsg): void {
    if (m.type === 'matchStart') {
      this.start = m;
      this.predictor = new Predictor(worldForMap(getMap(m.config.map)), m.you);
    } else if (m.type === 'snap' && this.predictor) this.onSnap(m);
  }

  private onSnap(s: SnapshotMsg): void {
    this.snaps++;
    this.phase = s.clock.phase;
    if (!s.self) return;
    const err = { x: 0, y: 0, z: 0 };
    const r = this.predictor!.reconcile(s.self, err);
    if (!r.snapped) this.corrections.push(Math.hypot(err.x, err.y, err.z));
    for (const ev of s.events) if (ev.t === 'spawn' && ev.p === this.start?.you) this.local.setAngles(ev.yaw, 0);
  }

  /** One client tick (and host time advance). */
  step(): void {
    this.now += TICK_MS;
    this.host.update(this.now);
    this.deliver();
    const p = this.predictor;
    if (!p) return;
    this.local.sampleFrame(this.input);
    this.input.edges.clear();
    const allowFire = this.phase === 'live' || this.start?.config.mode === 'range';
    const cmd = this.local.buildCmd(0, p.combat, allowFire);
    const r = p.step(cmd);
    if (r?.shot) this.shots++;
    this.clientSend({ type: 'input', cmds: p.resendList(8) }, true);
  }

  queue(mode: ModeId): void {
    this.clientSend({ type: 'queue', mode, map: mode === 'range' ? 'range' : 'gantry', botDifficulty: 'recruit', kind: mode === 'range' ? 'solo' : 'bots' });
  }
}

/** A busy scripted routine: strafe, sprint, jump, slide, crouch, ADS, fire, reload, swap. */
function script(sim: NetSim, frame: number): void {
  const inp = sim.input;
  const t = frame / SIM_HZ;
  inp.held.clear();
  inp.axes = { x: Math.sin(t * 1.7) * 0.8, y: frame % 400 < 300 ? 1 : -0.6 };
  if (frame % 400 < 200) inp.held.add('sprint');
  if (frame % 97 === 13) inp.edges.add('jump');
  if (frame % 173 === 40) inp.edges.add('crouch');
  if (frame % 300 > 220) inp.held.add('ads');
  if (frame % 180 > 120) inp.held.add('fire');
  if (frame % 211 === 5) inp.edges.add('reload');
  if (frame % 520 === 260) inp.edges.add('secondary');
  if (frame % 520 === 20) inp.edges.add('primary');
  sim.local.look(Math.sin(t * 0.9) * 0.02, Math.cos(t * 1.3) * 0.004);
}

describe('Predictor ⇄ HostCore', () => {
  it('replays reproduce the host exactly with 60 ms latency (zero corrections)', () => {
    const sim = new NetSim(60);
    sim.queue('range');
    for (let f = 0; f < 1500; f++) {
      script(sim, f);
      sim.step();
    }
    expect(sim.snaps).toBeGreaterThan(400);
    expect(sim.corrections.length).toBeGreaterThan(300);
    expect(Math.max(...sim.corrections)).toBe(0);
    expect(sim.shots).toBeGreaterThan(20);
    const m = sim.predictor!.move!;
    expect(Math.hypot(m.pos.x, m.pos.z)).toBeGreaterThan(0);
  }, 60000);

  it('redundant input resends survive 25 % input-message loss without mispredictions', () => {
    const sim = new NetSim(40, 0.25);
    sim.queue('range');
    for (let f = 0; f < 1200; f++) {
      script(sim, f);
      sim.step();
    }
    expect(sim.corrections.length).toBeGreaterThan(200);
    expect(Math.max(...sim.corrections)).toBe(0);
    // Every command was eventually acknowledged in order.
    expect(sim.predictor!.ackSeq).toBeGreaterThan(sim.local.seq - 20);
  }, 60000);

  it('stays exact in a bot match through countdown → live (fire masked before live)', () => {
    const sim = new NetSim(50);
    sim.queue('tdm');
    let liveFrames = 0;
    for (let f = 0; f < 600; f++) {
      script(sim, f);
      if (sim.phase === 'live') liveFrames++;
      sim.step();
    }
    expect(liveFrames).toBeGreaterThan(200);
    // Bots may push nothing (players pass through each other); deaths snap, so only smooth corrections are checked.
    expect(Math.max(...sim.corrections)).toBe(0);
  }, 60000);
});

describe('LocalPlayer command builder', () => {
  it('latches taps shorter than a tick and masks fire outside live', () => {
    const lp = new LocalPlayer();
    const inp = new ScriptInput();
    inp.edges.add('jump');
    lp.sampleFrame(inp); // frame with no tick
    inp.edges.clear();
    lp.sampleFrame(inp);
    const c1 = lp.buildCmd(0, null, true);
    expect(c1.buttons & 1).toBe(1); // BTN_JUMP survived
    const c2 = lp.buildCmd(0, null, true);
    expect(c2.buttons & 1).toBe(0);
    inp.held.add('fire');
    lp.sampleFrame(inp);
    expect(lp.buildCmd(0, null, false).buttons & 8).toBe(0);
    expect(lp.buildCmd(0, null, true).buttons & 8).toBe(8);
  });

  it('produces commands the host sanitizer leaves bit-identical', () => {
    const lp = new LocalPlayer();
    const inp = new ScriptInput();
    const rng = mulberry32(9);
    for (let i = 0; i < 2000; i++) {
      lp.look((rng() - 0.5) * 0.7, (rng() - 0.5) * 0.3);
      inp.axes = { x: rng() * 2 - 1, y: rng() * 2 - 1 };
      lp.sampleFrame(inp);
      const cmd = lp.buildCmd(rng() * 5000, null, true);
      expect(sanitizeCmd(JSON.parse(JSON.stringify(cmd)))).toEqual(cmd);
    }
  });

  it('selects slots, cycles, and follows the active slot when the desired one is empty', () => {
    const lp = new LocalPlayer();
    const inp = new ScriptInput();
    const combat = { slots: [{ id: 'meridian', mag: 30, reserve: 90 }, { id: 'pulse', mag: 12, reserve: 60 }, null], active: 0 } as unknown as Parameters<LocalPlayer['buildCmd']>[1];
    inp.edges.add('secondary');
    lp.sampleFrame(inp);
    inp.edges.clear();
    expect(lp.buildCmd(0, combat, true).slot).toBe(1);
    inp.edges.add('pickupSlot'); // empty → ignored
    lp.sampleFrame(inp);
    inp.edges.clear();
    expect(lp.buildCmd(0, combat, true).slot).toBe(1);
    inp.edges.add('nextWeapon');
    lp.sampleFrame(inp);
    inp.edges.clear();
    expect(lp.buildCmd(0, combat, true).slot).toBe(0);
    lp.requestSlot(2); // own pickup event before the host state shows the Sunspear
    expect(lp.buildCmd(0, combat, true).slot).toBe(0); // follows active while slot 2 is empty
  });
});

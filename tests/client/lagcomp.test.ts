import { describe, expect, it } from 'vitest';
import { hitboxes, type Hitboxes } from '../../src/shared/combat';
import { PROTOCOL_VERSION, SIM_HZ } from '../../src/shared/constants';
import { HostCore, type HostConnection } from '../../src/shared/host/host-core';
import { getMap } from '../../src/shared/maps/index';
import type { ClientMsg, MatchStartMsg, ServerMsg, SnapshotMsg } from '../../src/shared/protocol';
import { worldForMap, type GameSim, type SimPlayer } from '../../src/shared/sim/game';
import { tracePellet } from '../../src/shared/sim/hitscan';
import { BTN_CROUCH, BTN_JUMP, PF_ALIVE, PF_PROTECTED, type InputCmd, type Team, type Vec3 } from '../../src/shared/types';
import { WEAPONS } from '../../src/shared/weapons';
import { EntityBuffer, InterpClock, emptySample } from '../../src/client/game/interpolator';
import { LocalPlayer, type ActionName, type InputLike } from '../../src/client/game/local-player';
import { Predictor } from '../../src/client/game/predictor';

const TICK_MS = 1000 / SIM_HZ;
const LATENCY_MS = 45;

/** The client stands here (south forecourt, between the blast baffle and the pad)… */
const SHOOTER: Vec3 = { x: -12, y: 0, z: -34 };
/** …and the target strafes along this open lane in front of the pad (x range, z). */
const LANE = { x0: -14, x1: -3, z: -21 };

class HeldInput implements InputLike {
  fire = false;
  moveAxes() {
    return { x: 0, y: 0 };
  }
  down(a: ActionName) {
    return (a === 'fire' && this.fire) || a === 'ads';
  }
  pressed() {
    return false;
  }
}

/**
 * Deterministic "puppet" for the target: strafes along the lane at walk speed
 * with irregular direction changes (ADAD), crouch-walks on some legs and hops
 * now and then, so its rendered (interpolated) position is always well away
 * from where the host has it when the shot arrives. Independent of the bot AI.
 */
function puppet(sim: GameSim, p: SimPlayer): () => InputCmd {
  const LEGS = [41, 23, 57, 31, 19, 47, 27, 37, 53, 29];
  let seq = 0;
  let leg = 0;
  let legT = 0;
  let dir = 1;
  return () => {
    seq++;
    if (++legT > LEGS[leg % LEGS.length]) {
      legT = 0;
      leg++;
      dir = -dir;
    }
    const x = p.move.pos.x;
    if (x > LANE.x1 - 0.5) dir = -1;
    else if (x < LANE.x0 + 0.5) dir = 1;
    let buttons = 0;
    if (leg % 4 === 2) buttons |= BTN_CROUCH;
    if (leg % 5 === 3 && legT === 6) buttons |= BTN_JUMP;
    // yaw 0: forward = −Z, right = +X → mx strafes along the lane.
    return { seq, mx: dir, mz: 0, yaw: 0, pitch: 0, buttons, slot: 0, viewTick: sim.tick };
  };
}

function idle(sim: GameSim): () => InputCmd {
  let seq = 0;
  return () => ({ seq: ++seq, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, slot: 0, viewTick: sim.tick });
}

interface Outcome {
  predictedHits: number;
  confirmed: number;
  shots: number;
  /** Mean distance (m) between the target where the client saw it and where the host had it "now" at each predicted hit. */
  meanLead: number;
}

/**
 * "What you see is what you hit", end to end: a client 45 ms from the host
 * renders a strafing target through the real InterpClock/EntityBuffer, aims its
 * predicted shots at the interpolated chest and sends viewTick = render tick
 * (or, for the control run, a viewTick the host clamps to "now" = no rewind).
 * Counts the pellets the client's own trace (against the interpolated hitboxes)
 * says hit, and the host 'hit' confirmations for them.
 */
function runScenario(rewind: boolean): Outcome {
  let now = 1000;
  const host = new HostCore({ kind: 'local', seed: 21 });
  const toClient: { at: number; m: ServerMsg }[] = [];
  const toHost: { at: number; m: ClientMsg }[] = [];
  const conn: HostConnection = { id: 'c', send: (m) => toClient.push({ at: now + LATENCY_MS, m: JSON.parse(JSON.stringify(m)) as ServerMsg }) };
  host.connect(conn);
  const send = (m: ClientMsg) => toHost.push({ at: now + LATENCY_MS, m });
  send({ type: 'hello', protocol: PROTOCOL_VERSION, name: 'Aimer', platform: 'desktop', lang: 'en', level: 1, rating: 1000, loadout: { primary: 'longline', throwable: 'smoke' }, cosmetics: { armor: 'standard', visor: 'band', namecard: 'horizon', elimFx: 'default', skins: {} }, faction: 0 });
  send({ type: 'queue', mode: 'tdm', map: 'gantry', botDifficulty: 'recruit', kind: 'bots' });

  let start = null as MatchStartMsg | null; // (assigned in pump(): no narrowing to null)
  let pred = null as Predictor | null;
  const clock = new InterpClock();
  const bufs = new Map<number, EntityBuffer>();
  const teams = new Map<number, Team>();
  const world = worldForMap(getMap('gantry'));
  const local = new LocalPlayer();
  const input = new HeldInput();
  const sample = emptySample();
  const hb: Hitboxes = hitboxes({ x: 0, y: 0, z: 0 }, 0);
  let phase = 'countdown';
  let predictedHits = 0;
  let confirmed = 0;
  let cooldown = 0;
  let shots = 0;
  let leadSum = 0;
  let target = null as SimPlayer | null;
  let sim = null as GameSim | null;

  const onSnap = (s: SnapshotMsg) => {
    clock.onSnapshot(s.tick, now);
    phase = s.clock.phase;
    for (const p of s.players) {
      let b = bufs.get(p.id);
      if (!b) bufs.set(p.id, (b = new EntityBuffer(24)));
      b.push(s.tick, p);
    }
    if (s.self && pred) pred.reconcile(s.self, { x: 0, y: 0, z: 0 });
    for (const ev of s.events) {
      if (ev.t === 'hit' && start && ev.p === start.you && target && ev.v === target.ident.id) confirmed++;
      if (ev.t === 'join') teams.set(ev.p.id, ev.p.team);
    }
  };
  const place = (p: SimPlayer, at: Vec3) => {
    p.move.pos.x = at.x;
    p.move.pos.y = at.y;
    p.move.pos.z = at.z;
    p.move.vel.x = p.move.vel.y = p.move.vel.z = 0;
  };
  const pump = () => {
    now += TICK_MS;
    while (toHost.length && toHost[0].at <= now) host.receive(conn, toHost.shift()!.m);
    host.update(now);
    while (toClient.length && toClient[0].at <= now) {
      const m = toClient.shift()!.m;
      if (m.type === 'matchStart') {
        start = m;
        pred = new Predictor(world, m.you);
        send({ type: 'loaded' }); // like ClientMatch: the countdown waits for it
        for (const p of m.players) teams.set(p.id, p.team);
      } else if (m.type === 'snap') onSnap(m);
    }
  };

  for (let f = 0; f < SIM_HZ * 60 && predictedHits < 14; f++) {
    pump();
    clock.update(now, TICK_MS / 1000);
    if (!start || !pred?.move || !pred.combat) continue;
    const me = start.you;
    if (!sim) {
      // Take the bots off the AI: one enemy becomes the scripted target, everyone else idles at spawn.
      sim = (host as unknown as { rooms: { sim: GameSim }[] }).rooms[0].sim;
      const myTeam = sim.player(me)!.ident.team;
      for (const p of sim.players) {
        if (!p.bot) continue;
        if (!target && p.ident.team !== myTeam) {
          target = p;
          p.bot.think = puppet(sim, p);
        } else p.bot.think = idle(sim);
      }
      expect(target).not.toBeNull();
    }
    const tgt = target!;
    const hostMe = sim.player(me)!;
    if (phase === 'live') {
      // Test shortcuts: keep the shooter on its mark and the target on its lane, and never let the target die.
      if (hostMe.alive && Math.hypot(hostMe.move.pos.x - SHOOTER.x, hostMe.move.pos.z - SHOOTER.z) > 0.5) place(hostMe, SHOOTER);
      if (tgt.alive && (Math.abs(tgt.move.pos.z - LANE.z) > 0.5 || tgt.move.pos.x < LANE.x0 - 1 || tgt.move.pos.x > LANE.x1 + 1)) place(tgt, { x: (LANE.x0 + LANE.x1) / 2, y: 0, z: LANE.z });
      tgt.health = 1000;
    }

    const eye = pred.eye({ x: 0, y: 0, z: 0 });
    // The target as this client displays it at the render tick.
    let aim: Vec3 | null = null;
    let n = 0;
    const b = bufs.get(tgt.ident.id);
    if (b && b.sample(clock.renderTick, sample) !== 'empty' && sample.f & PF_ALIVE && !(sample.f & PF_PROTECTED)) {
      hitboxes({ x: sample.x, y: sample.y, z: sample.z }, sample.c / 100, hb);
      n = 1;
      const chest = { x: sample.x, y: sample.y + 1.15 - (sample.c / 100) * 0.4, z: sample.z };
      if (world.segmentClear(eye.x, eye.y, eye.z, chest.x, chest.y, chest.z, 'bullet')) aim = chest;
    }
    input.fire = false;
    if (aim && phase === 'live' && cooldown <= 0 && pred.combat.adsT > 0.99) {
      const dx = aim.x - eye.x;
      const dz = aim.z - eye.z;
      local.setAngles(Math.atan2(-dx, -dz), Math.atan2(aim.y - eye.y, Math.hypot(dx, dz)));
      input.fire = true;
    }
    local.sampleFrame(input);
    const cmd = local.buildCmd(clock.renderTick, pred.combat, phase === 'live');
    // Control run: a viewTick from the future clamps to the host's current tick (no rewind).
    if (!rewind) cmd.viewTick = 1e9;
    const r = pred.step(cmd);
    cooldown--;
    if (r?.shot) {
      shots++;
      cooldown = 70; // bolt action: let recoil settle between shots
      for (const d of r.shot.dirs) {
        const tr = tracePellet(world, r.shot.origin, d, WEAPONS[r.shot.weapon].range, [hb], n, null);
        if (tr.candidate >= 0) {
          predictedHits++;
          leadSum += Math.hypot(tgt.move.pos.x - sample.x, tgt.move.pos.z - sample.z);
        }
      }
    }
    send({ type: 'input', cmds: pred.resendList(8) });
  }
  // Let the last confirmations arrive.
  for (let k = 0; k < 30; k++) pump();
  return { predictedHits, confirmed, shots, meanLead: predictedHits ? leadSum / predictedHits : 0 };
}

describe('lag compensation end to end', () => {
  it('the shooter has a clear view of the whole target lane', () => {
    const world = worldForMap(getMap('gantry'));
    expect(world.supportHeight(SHOOTER.x, SHOOTER.z, 0.4, 1, 2)).toBeCloseTo(0, 3);
    for (let x = LANE.x0; x <= LANE.x1; x += 0.5) {
      expect(world.supportHeight(x, LANE.z, 0.4, 1, 2), `lane floor at x=${x}`).toBeCloseTo(0, 3);
      expect(world.boxOverlaps(x, 0, LANE.z, 0.4, 1.8)).toBe(false);
      for (const y of [0.7, 1.15, 1.6]) expect(world.segmentClear(SHOOTER.x, 1.62, SHOOTER.z, x, y, LANE.z, 'bullet'), `x=${x} y=${y}`).toBe(true);
    }
  });

  it('predicted hits on an interpolated, strafing target are confirmed by the host', () => {
    const r = runScenario(true);
    expect(r.predictedHits).toBeGreaterThanOrEqual(12);
    expect(r.shots).toBeGreaterThanOrEqual(r.predictedHits);
    // The target really was elsewhere on the host when the shots landed…
    expect(r.meanLead).toBeGreaterThan(0.35);
    // …and the host still confirms (Longline is single-pellet: one 'hit' per predicted hit).
    expect(r.confirmed / r.predictedHits).toBeGreaterThan(0.9);
  }, 60000);

  it('control: without rewinding, the same shots mostly miss (the scenario exercises lag compensation)', () => {
    const r = runScenario(false);
    expect(r.predictedHits).toBeGreaterThanOrEqual(12);
    expect(r.confirmed / r.predictedHits).toBeLessThan(0.5);
  }, 60000);
});

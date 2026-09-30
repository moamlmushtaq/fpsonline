import { describe, expect, it } from 'vitest';
import { hitboxes, type Hitboxes } from '../../src/shared/combat';
import { PROTOCOL_VERSION, SIM_HZ } from '../../src/shared/constants';
import { HostCore, type HostConnection } from '../../src/shared/host/host-core';
import { getMap } from '../../src/shared/maps/index';
import type { ClientMsg, MatchStartMsg, ServerMsg, SnapshotMsg } from '../../src/shared/protocol';
import { worldForMap } from '../../src/shared/sim/game';
import { tracePellet } from '../../src/shared/sim/hitscan';
import { PF_ALIVE, PF_PROTECTED, type Team } from '../../src/shared/types';
import { WEAPONS } from '../../src/shared/weapons';
import { EntityBuffer, InterpClock, emptySample } from '../../src/client/game/interpolator';
import { LocalPlayer, type ActionName, type InputLike } from '../../src/client/game/local-player';
import { Predictor } from '../../src/client/game/predictor';

const TICK_MS = 1000 / SIM_HZ;

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
 * "What you see is what you hit": a client renders bots through the real
 * InterpClock/EntityBuffer, aims its predicted shots at their interpolated
 * chests and sends viewTick = render tick. Every pellet the client's own
 * trace (against the interpolated hitboxes) says hit must be confirmed by the
 * host's lag-compensated hitscan.
 */
describe('lag compensation end to end', () => {
  it('predicted hits on interpolated targets are confirmed by the host', () => {
    const latency = 45;
    let now = 1000;
    const host = new HostCore({ kind: 'local', seed: 21 });
    const toClient: { at: number; m: ServerMsg }[] = [];
    const toHost: { at: number; m: ClientMsg }[] = [];
    const conn: HostConnection = { id: 'c', send: (m) => toClient.push({ at: now + latency, m: JSON.parse(JSON.stringify(m)) as ServerMsg }) };
    host.connect(conn);
    const send = (m: ClientMsg) => toHost.push({ at: now + latency, m });
    send({ type: 'hello', protocol: PROTOCOL_VERSION, name: 'Aimer', platform: 'desktop', lang: 'en', level: 1, rating: 1000, loadout: { primary: 'longline', throwable: 'smoke' }, cosmetics: { armor: 'standard', visor: 'band', namecard: 'horizon', elimFx: 'default', skins: {} }, faction: 0 });
    send({ type: 'queue', mode: 'tdm', map: 'gantry', botDifficulty: 'recruit', kind: 'bots' });

    let start: MatchStartMsg | null = null;
    let pred: Predictor | null = null;
    const clock = new InterpClock();
    const bufs = new Map<number, EntityBuffer>();
    const teams = new Map<number, Team>();
    const world = worldForMap(getMap('gantry'));
    const local = new LocalPlayer();
    const input = new HeldInput();
    const sample = emptySample();
    const hb: Hitboxes[] = [];
    let phase = 'countdown';
    let predictedHits = 0;
    let confirmed = 0;
    let cooldown = 0;
    let shots = 0;
    // An open, grounded spot near the middle lane.
    const spot = { x: 0, y: 0, z: -24 };
    search: for (let r = 0; r < 30; r += 1.5) {
      for (let a = 0; a < Math.PI * 2; a += 0.5) {
        const x = Math.cos(a) * r;
        const z = -24 + Math.sin(a) * r;
        const g = world.supportHeight(x, z, 0.4, 3, 6);
        if (Number.isNaN(g) || world.boxOverlaps(x, g, z, 0.4, 1.8)) continue;
        spot.x = x;
        spot.y = g;
        spot.z = z;
        break search;
      }
    }

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
        if (ev.t === 'hit') confirmed++;
        if (ev.t === 'join') teams.set(ev.p.id, ev.p.team);
      }
    };

    for (let f = 0; f < 60 * 50 && (predictedHits < 12 || f < 60 * 8); f++) {
      now += TICK_MS;
      while (toHost.length && toHost[0].at <= now) host.receive(conn, toHost.shift()!.m);
      host.update(now);
      while (toClient.length && toClient[0].at <= now) {
        const m = toClient.shift()!.m;
        if (m.type === 'matchStart') {
          start = m;
          pred = new Predictor(world, m.you);
          for (const p of m.players) teams.set(p.id, p.team);
        } else if (m.type === 'snap') onSnap(m);
      }
      clock.update(now, TICK_MS / 1000);
      if (!start || !pred?.move || !pred.combat) continue;
      const me = start.you;
      // Test shortcut: stand the (living) client in the open middle of the map so bots come into view.
      const sim = (host as unknown as { rooms: { sim: { player(id: number): { alive: boolean; move: { pos: { x: number; y: number; z: number } } } | undefined } }[] }).rooms[0]?.sim;
      const hostMe = sim?.player(me);
      if (hostMe?.alive && phase === 'live' && Math.hypot(hostMe.move.pos.x - spot.x, hostMe.move.pos.z - spot.z) > 3) {
        hostMe.move.pos.x = spot.x;
        hostMe.move.pos.y = spot.y;
        hostMe.move.pos.z = spot.z;
      }
      const myTeam = teams.get(me);
      const eye = pred.eye({ x: 0, y: 0, z: 0 });
      // Nearest visible, unprotected enemy at the render tick.
      let target: { x: number; y: number; z: number } | null = null;
      let best = Infinity;
      let n = 0;
      for (const [id, b] of bufs) {
        if (id === me || teams.get(id) === myTeam) continue;
        if (b.sample(clock.renderTick, sample) === 'empty') continue;
        if (!(sample.f & PF_ALIVE) || sample.f & PF_PROTECTED) continue;
        const h = hb[n] ?? (hb[n] = hitboxes({ x: 0, y: 0, z: 0 }, 0));
        hitboxes({ x: sample.x, y: sample.y, z: sample.z }, sample.c / 100, h);
        n++;
        const chest = { x: sample.x, y: sample.y + 1.15 - (sample.c / 100) * 0.4, z: sample.z };
        const d = Math.hypot(chest.x - eye.x, chest.y - eye.y, chest.z - eye.z);
        if (d < best && d < 70 && world.segmentClear(eye.x, eye.y, eye.z, chest.x, chest.y, chest.z, 'bullet')) {
          best = d;
          target = chest;
        }
      }
      input.fire = false;
      if (target && phase === 'live' && cooldown <= 0 && pred.combat.adsT > 0.99) {
        const dx = target.x - eye.x;
        const dz = target.z - eye.z;
        local.setAngles(Math.atan2(-dx, -dz), Math.atan2(target.y - eye.y, Math.hypot(dx, dz)));
        input.fire = true;
      }
      local.sampleFrame(input);
      const cmd = local.buildCmd(clock.renderTick, pred.combat, phase === 'live');
      const r = pred.step(cmd);
      cooldown--;
      if (r?.shot) {
        shots++;
        cooldown = 70; // bolt action: let recoil settle between shots
        for (const d of r.shot.dirs) {
          const tr = tracePellet(world, r.shot.origin, d, WEAPONS[r.shot.weapon].range, hb, n, null);
          if (tr.candidate >= 0) predictedHits++;
        }
      }
      send({ type: 'input', cmds: pred.resendList(8) });
    }
    // Let the last confirmations arrive.
    for (let k = 0; k < 30; k++) {
      now += TICK_MS;
      while (toHost.length && toHost[0].at <= now) host.receive(conn, toHost.shift()!.m);
      host.update(now);
      while (toClient.length && toClient[0].at <= now) {
        const m = toClient.shift()!.m;
        if (m.type === 'snap') onSnap(m);
      }
    }
    expect(predictedHits).toBeGreaterThanOrEqual(8);
    // Longline is single-pellet: each predicted hit should come back as a host 'hit'.
    expect(confirmed / predictedHits).toBeGreaterThan(0.85);
    expect(shots).toBeGreaterThanOrEqual(predictedHits);
  }, 60000);
});

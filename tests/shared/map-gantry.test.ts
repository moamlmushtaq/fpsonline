// Gantry-specific layout guarantees: reachability, spawn safety, lane flow.
import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT, PLAYER_HEIGHT, SIM_DT, SIM_HZ } from '../../src/shared/constants';
import { GANTRY, GANTRY_DECK } from '../../src/shared/maps/gantry';
import { makeGameConfig } from '../../src/shared/modes';
import { createMoveState, stepMovement } from '../../src/shared/movement';
import { CollisionWorld } from '../../src/shared/physics';
import { GameSim } from '../../src/shared/sim/game';
import { NavGraph } from '../../src/shared/sim/nav';

const map = GANTRY;
const world = new CollisionWorld(map.solids, map.bounds, { waterY: map.waterY });
const nav = NavGraph.build(world, map);
const teamSpawns = map.spawns.filter((s) => s.team !== 2);

function eye(p: { x: number; y: number; z: number }): [number, number, number] {
  return [p.x, p.y + EYE_HEIGHT, p.z];
}

describe('gantry layout', () => {
  it('stays within the collision budget and uses hidden solids only where decor draws them', () => {
    expect(map.solids.length).toBeGreaterThanOrEqual(60);
    expect(map.solids.length).toBeLessThanOrEqual(128); // +6 for the art-pass-2 service vehicles / drum pallets (GANTRY_PROPS)
    for (const s of map.solids) {
      expect(s.max.x).toBeGreaterThan(s.min.x);
      expect(s.max.y).toBeGreaterThan(s.min.y);
      expect(s.max.z).toBeGreaterThan(s.min.z);
    }
  });

  it('every spawn, zone and the Sunspear are mutually reachable on foot', () => {
    for (const s of map.spawns) {
      const k = nav.nearestNode(s.pos);
      expect(k, JSON.stringify(s.pos)).toBeGreaterThanOrEqual(0);
      expect(nav.comp[k]).toBe(nav.mainComp);
      expect(world.playerOverlaps(s.pos, PLAYER_HEIGHT)).toBe(false);
    }
    const halcyon = teamSpawns.find((s) => s.team === 0)!;
    const bloom = teamSpawns.find((s) => s.team === 1)!;
    for (const from of [halcyon, bloom]) {
      for (const z of map.zones) expect(nav.findPath(from.pos, z.center), `zone ${z.id}`).not.toBeNull();
      for (const p of map.pickups) expect(nav.findPath(from.pos, p.pos), 'sunspear').not.toBeNull();
      expect(nav.findPath(from.pos, { x: -9.5, y: 8.4, z: 0 }), 'tower L1').not.toBeNull();
      expect(nav.findPath(from.pos, { x: -62.5, y: 4.8, z: -15 }), 'catwalk').not.toBeNull();
      expect(nav.findPath(from.pos, { x: 60, y: -1.2, z: 30 }), 'pier').not.toBeNull();
      expect(nav.findPath(from.pos, { x: -60, y: 0, z: 0 }), 'bunker').not.toBeNull();
    }
  });

  it('the Sunspear lies in the flame trench under the broken grate', () => {
    const pk = map.pickups[0];
    expect(pk.respawn).toBe(45);
    expect(pk.pos.y).toBe(0);
    // A ceiling (the pad deck) above the trench beside the pickup, open sky straight above it.
    expect(world.segmentClear(pk.pos.x, 1, pk.pos.z, pk.pos.x, 30, pk.pos.z, 'sight')).toBe(true);
    expect(world.segmentClear(pk.pos.x + 2.5, 1, pk.pos.z, pk.pos.x + 2.5, 30, pk.pos.z, 'sight')).toBe(false);
    // Zone B is on the deck.
    const b = map.zones.find((z) => z.id === 'B')!;
    expect(b.center.y).toBe(GANTRY_DECK);
  });

  it('team spawns are never visible from enemy spawns or anywhere in the mid-map', () => {
    for (const a of teamSpawns) {
      for (const b of teamSpawns) {
        if (a.team === b.team) continue;
        const [ax, ay, az] = eye(a.pos);
        const [bx, by, bz] = eye(b.pos);
        expect(world.segmentClear(ax, ay, az, bx, by, bz, 'sight')).toBe(false);
      }
    }
    // Every walkable nav node with |z| ≤ 40 (lanes, pad, tower, catwalk, pier) at eye height.
    let checked = 0;
    for (let i = 0; i < nav.count; i += 2) {
      const z = nav.pz[i];
      if (Math.abs(z) > 40 || nav.comp[i] !== nav.mainComp) continue;
      const x = nav.px[i];
      const y = nav.py[i] + EYE_HEIGHT;
      checked++;
      for (const s of teamSpawns) {
        const [sx, sy, sz] = eye(s.pos);
        if (world.segmentClear(x, y, z, sx, sy, sz, 'sight')) throw new Error(`spawn ${JSON.stringify(s.pos)} visible from (${x}, ${nav.py[i]}, ${z})`);
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it('the straight tunnel line and the trench are broken up (no pad-crossing sightline)', () => {
    // South tunnel mouth → north tunnel mouth.
    expect(world.segmentClear(-8, 1.6, -17.5, -8, 1.6, 17.5, 'sight')).toBe(false);
    // Trench mouth (east) → Sunspear.
    expect(world.segmentClear(17, 1.6, 0, -3.2, 1.6, 0, 'sight')).toBe(false);
    // Zone A ↔ Zone C across the map at head height.
    expect(world.segmentClear(51, 1.6, 0, -45, 1.6, 0, 'sight')).toBe(false);
  });

  it('spawn exits (all three doors + the forecourt strip) are hidden from the mid-map and the enemy third', () => {
    // Points just outside the Halcyon doors; the Bloom side is the mirror image.
    const exits = [
      [-16.25, -45],
      [16.25, -45],
      [-4, -45],
      [4, -45],
      [-10.5, -43.5],
      [10.5, -43.5],
    ];
    for (const sz of [1, -1]) {
      for (const [ex, ez] of exits) {
        const e = { x: ex, y: EYE_HEIGHT, z: ez * sz };
        for (let i = 0; i < nav.count; i++) {
          const z = nav.pz[i] * sz; // distance into the enemy's direction (> −20 = mid-map or beyond)
          if (z < -20 || nav.comp[i] !== nav.mainComp) continue;
          const x = nav.px[i];
          const y = nav.py[i] + EYE_HEIGHT;
          if (Math.hypot(x - e.x, y - e.y, nav.pz[i] - e.z) < 25) continue;
          if (world.segmentClear(x, y, nav.pz[i], e.x, e.y, e.z, 'sight')) throw new Error(`exit (${e.x}, ${e.z}) visible from (${x}, ${nav.py[i]}, ${nav.pz[i]})`);
        }
      }
    }
  });

  it('the aprons flanking the pad have no forecourt-to-forecourt sightline', () => {
    for (const x of [-23.6, -22, -20.5, -19.2, 16.4, 17.6, 18.5, 19.5, 21, 21.8]) {
      for (let z0 = -44; z0 <= -12; z0 += 4) {
        expect(world.segmentClear(x, EYE_HEIGHT, z0, x + (x < 0 ? 0.6 : -0.6), EYE_HEIGHT, -z0, 'sight'), `x ${x} z ${z0}`).toBe(false);
      }
    }
  });

  it('nobody can stand on the launch mount among the fins, and the grate is a clean drop', () => {
    const r = map.rocket.pos;
    // The mount + fin skirt is one tall solid: the first support above the deck is far overhead.
    expect(world.supportHeight(r.x - 3.2, 3.2, 0.4, 20, 20)).toBeGreaterThan(17);
    // A player centered over the broken grate has no support until the trench floor.
    const pk = map.pickups[0];
    expect(world.supportHeight(pk.pos.x, pk.pos.z, 0.4, GANTRY_DECK + 0.05, 5)).toBeCloseTo(0, 3);
    expect(world.supportHeight(pk.pos.x + 0.9, pk.pos.z + 0.9, 0.4, GANTRY_DECK + 0.05, 5)).toBeCloseTo(0, 3);
  });

  it('stepping off the deck under L1 (west edge, |z| ≤ 5) does not trap the player', () => {
    // Regression: x −18.6…−16 under L1 was a 3.6 m pit between the stair flanks
    // and the service wall. It is now filled to deck level.
    for (const z of [-4.5, -2, 0, 2, 4.5]) {
      const m = createMoveState({ x: -13, y: GANTRY_DECK, z });
      // Walk west (yaw π/2 → forward = −X) into the alcove, then back east.
      for (let i = 0; i < 90; i++) stepMovement(world, m, { seq: i, mx: 0, mz: 1, yaw: Math.PI / 2, pitch: 0, buttons: 0, slot: 0, viewTick: 0 }, 1, SIM_DT);
      expect(m.pos.x, `z=${z}`).toBeLessThan(-17.5);
      expect(m.pos.y, `z=${z}`).toBeCloseTo(GANTRY_DECK, 3);
      for (let i = 0; i < 90; i++) stepMovement(world, m, { seq: i, mx: 0, mz: 1, yaw: -Math.PI / 2, pitch: 0, buttons: 0, slot: 0, viewTick: 0 }, 1, SIM_DT);
      expect(m.pos.x, `z=${z}`).toBeGreaterThan(-12);
      expect(m.pos.y, `z=${z}`).toBeCloseTo(GANTRY_DECK, 3);
    }
  });

  it('team spawns face an open way out (not the rocket stage beside them)', () => {
    for (const s of teamSpawns) {
      const fx = -Math.sin(s.yaw);
      const fz = -Math.cos(s.yaw);
      const [ex, ey, ez] = eye(s.pos);
      expect(world.segmentClear(ex, ey, ez, ex + fx * 5, ey, ez + fz * 5, 'move'), JSON.stringify(s.pos)).toBe(true);
    }
  });
});

describe('gantry bots', () => {
  it('10 bots flow through all three lanes without getting stuck', () => {
    const cfg = { ...makeGameConfig('tdm', 'gantry', { botFill: true, botDifficulty: 'veteran' }), countdown: 0 };
    const sim = new GameSim(cfg, map, 99);
    sim.fillBots();
    const lanes = [0, 0, 0];
    let samples = 0;
    let kills = 0;
    let maxStill = 0;
    const anchor = new Map<number, { x: number; z: number; t: number }>();
    for (let i = 0; i < SIM_HZ * 90; i++) {
      sim.step();
      for (const e of sim.drainEvents()) if (e.ev.t === 'kill') kills++;
      if (i % 30 !== 0) continue;
      for (const p of sim.players) {
        if (!p.alive) {
          anchor.delete(p.ident.id);
          continue;
        }
        const { x, z } = p.move.pos;
        if (Math.abs(z) < 40) {
          samples++;
          if (x < -24) lanes[0]++;
          else if (x > 22) lanes[2]++;
          else lanes[1]++;
        }
        const a = anchor.get(p.ident.id);
        if (!a || Math.hypot(x - a.x, z - a.z) > 1.5) anchor.set(p.ident.id, { x, z, t: sim.tick });
        else maxStill = Math.max(maxStill, (sim.tick - a.t) / SIM_HZ);
      }
    }
    expect(kills).toBeGreaterThan(5);
    expect(maxStill).toBeLessThan(10);
    for (const n of lanes) expect(n / samples).toBeGreaterThan(0.06);
  }, 60_000);

  it('Launch Control: every zone gets captured', () => {
    const cfg = { ...makeGameConfig('control', 'gantry', { botFill: true }), countdown: 0 };
    const sim = new GameSim(cfg, map, 5);
    sim.fillBots();
    const owned = new Set<string>();
    for (let i = 0; i < SIM_HZ * 120; i++) {
      sim.step();
      sim.drainEvents();
      if (i % 60 === 0) for (const z of sim.zoneStates()) if (z.owner !== 2) owned.add(z.def.id);
    }
    expect([...owned].sort()).toEqual(['A', 'B', 'C']);
  }, 60_000);
});

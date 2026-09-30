// Observatory-specific layout guarantees: collision budget, reachability,
// spawn safety, the hall's vertical layout, and bots flowing through all lanes.
import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT, PLAYER_HEIGHT, PLAYER_RADIUS, SIM_HZ } from '../../src/shared/constants';
import { OBS, OBSERVATORY } from '../../src/shared/maps/observatory';
import { makeGameConfig } from '../../src/shared/modes';
import { CollisionWorld } from '../../src/shared/physics';
import { GameSim } from '../../src/shared/sim/game';
import { NavGraph } from '../../src/shared/sim/nav';

const map = OBSERVATORY;
const world = new CollisionWorld(map.solids, map.bounds);
const nav = NavGraph.build(world, map);
const teamSpawns = map.spawns.filter((s) => s.team !== 2);

function eye(p: { x: number; y: number; z: number }): [number, number, number] {
  return [p.x, p.y + EYE_HEIGHT, p.z];
}

describe('observatory layout', () => {
  it('stays within the collision budget with well-formed solids', () => {
    expect(map.solids.length).toBeGreaterThanOrEqual(60);
    expect(map.solids.length).toBeLessThanOrEqual(120);
    for (const s of map.solids) {
      expect(s.max.x).toBeGreaterThan(s.min.x);
      expect(s.max.y).toBeGreaterThan(s.min.y);
      expect(s.max.z).toBeGreaterThan(s.min.z);
    }
    // Mirror-symmetric across z = 0 (fair for both teams).
    const key = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): string => [x0, y0, z0, x1, y1, z1].map((n) => n.toFixed(2)).join(',');
    const set = new Set(map.solids.map((s) => key(s.min.x, s.min.y, s.min.z, s.max.x, s.max.y, s.max.z)));
    for (const s of map.solids) expect(set.has(key(s.min.x, s.min.y, -s.max.z, s.max.x, s.max.y, -s.min.z)), JSON.stringify(s)).toBe(true);
  });

  it('every spawn, zone, the Sunspear and each level are mutually reachable on foot', () => {
    for (const s of map.spawns) {
      const g = world.supportHeight(s.pos.x, s.pos.z, PLAYER_RADIUS, s.pos.y + 0.01, 0.5);
      expect(g, JSON.stringify(s.pos)).toBeCloseTo(s.pos.y, 3);
      expect(world.playerOverlaps(s.pos, PLAYER_HEIGHT)).toBe(false);
      const k = nav.nearestNode(s.pos);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(nav.comp[k]).toBe(nav.mainComp);
    }
    const halcyon = teamSpawns.find((s) => s.team === 0)!;
    const bloom = teamSpawns.find((s) => s.team === 1)!;
    const places: [string, { x: number; y: number; z: number }][] = [
      ['gallery S', { x: -3, y: OBS.gallery, z: 8.9 }],
      ['gallery N', { x: 3, y: OBS.gallery, z: -8.9 }],
      ['podium W', { x: -2.9, y: OBS.gallery, z: 0 }],
      ['ridge path', { x: -53, y: OBS.ridge, z: 18 }],
      ['array plateau', { x: -45, y: OBS.ridge, z: -10 }],
      ['dorm wing', { x: 27, y: 0, z: 10 }],
      ['dorm common room', { x: 32, y: 0, z: -2 }],
      ['station deck', { x: 53, y: OBS.deck, z: 6 }],
    ];
    for (const from of [halcyon, bloom]) {
      for (const z of map.zones) expect(nav.findPath(from.pos, z.center), `zone ${z.id}`).not.toBeNull();
      for (const p of map.pickups) expect(nav.findPath(from.pos, p.pos), 'sunspear').not.toBeNull();
      for (const [name, p] of places) expect(nav.findPath(from.pos, p), name).not.toBeNull();
    }
  });

  it('the Sunspear rests on the telescope podium (solid below, fair for both teams)', () => {
    const pk = map.pickups[0];
    expect(pk.respawn).toBe(45);
    expect(pk.pos.z).toBe(0);
    expect(pk.pos.y).toBe(OBS.gallery);
    // Nothing walkable directly underneath (the podium is solid down to the floor).
    expect(world.playerOverlaps({ x: pk.pos.x, y: 0.05, z: pk.pos.z }, PLAYER_HEIGHT)).toBe(true);
    // Equal path lengths from both teams' spawn centroids.
    const len = (team: number): number => {
      const sp = teamSpawns.filter((s) => s.team === team);
      let total = 0;
      for (const s of sp) {
        const p = nav.findPath(s.pos, pk.pos)!;
        let prev = s.pos;
        for (const q of p.points) {
          total += Math.hypot(q.x - prev.x, q.z - prev.z);
          prev = q;
        }
      }
      return total / sp.length;
    };
    expect(Math.abs(len(0) - len(1))).toBeLessThan(3);
  });

  it('the telescope hall blocks straight door-to-door lines; the gallery rings the hall', () => {
    // N door ↔ S door and E door ↔ W door at head height.
    expect(world.segmentClear(0, 1.6, 11, 0, 1.6, -11, 'sight')).toBe(false);
    expect(world.segmentClear(11, 1.6, 0, -11, 1.6, 0, 'sight')).toBe(false);
    // Arcade → dorm east wall line is closed.
    expect(world.segmentClear(-24, 1.6, 0, 40, 1.6, 0, 'sight')).toBe(false);
    // Gallery is a ring at 3.6 m: each strip corner is supported.
    for (const [x, z] of [[8.9, 8.9], [-8.9, 8.9], [8.9, -8.9], [-8.9, -8.9], [8.9, 0], [-8.9, 0]]) {
      expect(world.supportHeight(x, z, 0.3, OBS.gallery + 0.2, 0.5)).toBeCloseTo(OBS.gallery, 3);
    }
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
  }, 30_000);

  it('spawn-yard walls cannot be climbed (≥ 2.6 m) and the edges are clamped by the bounds', () => {
    const walls = map.solids.filter((s) => Math.abs(s.min.z) >= 41.9 && Math.abs(s.max.z) <= 43.1 && s.max.z - s.min.z <= 1.1);
    expect(walls.length).toBe(4);
    for (const w of walls) expect(w.max.y - w.min.y).toBeGreaterThanOrEqual(2.6);
    // Three 4 m gates per yard, exactly where OBS.gates says (the decor draws the portals there).
    for (const sz of [1, -1]) {
      for (const [a, b] of OBS.gates) {
        const mid = (a + b) / 2;
        expect(world.segmentClear(mid, 1.2, sz * 40, mid, 1.2, sz * 46, 'move'), `gate ${a}…${b}`).toBe(true);
        expect(b - a).toBeGreaterThanOrEqual(4);
      }
    }
    const ground = map.solids[0];
    expect(ground.min.x).toBeLessThanOrEqual(map.bounds.min.x);
    expect(ground.max.x).toBeGreaterThanOrEqual(map.bounds.max.x);
    expect(ground.min.z).toBeLessThanOrEqual(map.bounds.min.z);
    expect(ground.max.z).toBeGreaterThanOrEqual(map.bounds.max.z);
  });
});

describe('observatory spawn exits and roofs', () => {
  it('no spawn-gate exit is visible from the enemy half of the map', () => {
    for (const sz of [1, -1]) {
      for (const [a, b] of OBS.gates) {
        const gx = (a + b) / 2;
        // Just outside the gate (where a player steps out) and inside it.
        for (const gz of [40.8, 43.6]) {
          for (let i = 0; i < nav.count; i++) {
            if (nav.comp[i] !== nav.mainComp) continue;
            const z = nav.pz[i];
            if (z * sz > 0) continue; // own half
            const x = nav.px[i];
            if (Math.hypot(x - gx, z - sz * gz) < 25) continue;
            if (world.segmentClear(x, nav.py[i] + EYE_HEIGHT, z, gx, 1.2, sz * gz, 'sight')) {
              // The east vestibule may be glimpsed from right beside the alley transformer; nothing else.
              if (gz > 42 && Math.abs(x - 36.5) < 1.5 && Math.abs(z) < 2) continue;
              throw new Error(`gate ${a}…${b} (z ${sz * gz}) visible from (${x.toFixed(1)}, ${nav.py[i].toFixed(1)}, ${z.toFixed(1)})`);
            }
          }
        }
      }
    }
  }, 30_000);

  it('dressed roofs are out of jump+mantle reach from anything climbable nearby', () => {
    // Jump apex (v²/2g) + mantle reach above the feet.
    const reach = 6.8 ** 2 / (2 * 20) + 1.3;
    const roofs = map.solids.filter((s) => {
      const top = s.max.y;
      return (
        (Math.abs(top - OBS.genTop) < 1e-6 && s.min.x >= 17.9 && s.max.x <= 26.1) || // generator / boiler house
        (Math.abs(top - OBS.dorm.roofTop) < 1e-6 && s.min.y > 3) // dorm roof
      );
    });
    expect(roofs.length).toBe(3);
    for (const r of roofs) {
      for (const s of map.solids) {
        if (s === r || s.style === 'ground' || s.max.y >= r.max.y) continue;
        // Horizontal gap between the footprints.
        const gx = Math.max(0, s.min.x - r.max.x, r.min.x - s.max.x);
        const gz = Math.max(0, s.min.z - r.max.z, r.min.z - s.max.z);
        if (Math.hypot(gx, gz) > 6) continue;
        // Only surfaces a player can stand on and get up to (≤ reach from the ground).
        if (s.max.y > reach + 0.01 && s.min.y < 0.1) continue;
        expect(s.max.y + reach, `${JSON.stringify(s.min)} → roof ${r.max.y}`).toBeLessThan(r.max.y);
      }
    }
  });

  it('dorm furniture and the observer desk sit on collision (no walking through bunks or shelves)', () => {
    // Bunks / lockers / bookcases: the wall collision faces are the furniture fronts.
    for (const z of [7.6, 10.4, 13, -7.6, -10.4, -13, 3, -3]) expect(world.playerOverlaps({ x: OBS.dorm.bay - 0.2, y: 0, z }, PLAYER_HEIGHT)).toBe(true);
    for (const z of [10.5, 13, -10.5, -13]) expect(world.playerOverlaps({ x: OBS.dorm.x1 - 0.7, y: 0, z }, PLAYER_HEIGHT)).toBe(true);
    // The walkway in front of them stays open.
    for (const z of [7.6, -10.4, 3]) expect(world.playerOverlaps({ x: OBS.dorm.bay + 0.5, y: 0, z }, PLAYER_HEIGHT)).toBe(false);
  });
});

describe('observatory bots', () => {
  it('10 bots flow through all three lanes without getting stuck', () => {
    const cfg = { ...makeGameConfig('tdm', 'observatory', { botFill: true, botDifficulty: 'veteran' }), countdown: 0 };
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
          else if (x > 24) lanes[2]++;
          else lanes[1]++;
        }
        const a = anchor.get(p.ident.id);
        if (!a || Math.hypot(x - a.x, z - a.z) > 1.5) anchor.set(p.ident.id, { x, z, t: sim.tick });
        else maxStill = Math.max(maxStill, (sim.tick - a.t) / SIM_HZ);
      }
    }
    expect(kills).toBeGreaterThan(5);
    expect(maxStill).toBeLessThan(10);
    for (const n of lanes) expect(n / samples).toBeGreaterThan(0.08);
  }, 60_000);

  it('Launch Control: every zone gets captured', () => {
    const cfg = { ...makeGameConfig('control', 'observatory', { botFill: true }), countdown: 0 };
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

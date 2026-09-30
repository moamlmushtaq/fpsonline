// Tutorial step machine — pure logic (no DOM / three.js).
import { describe, expect, it } from 'vitest';
import { RANGE_COURSE } from '../../src/shared/maps/range';
import type { Vec3 } from '../../src/shared/types';
import {
  ASSIST_AFTER,
  DONE_HOLD,
  HINT_AFTER,
  STEP_ORDER,
  TutorialMachine,
  type StepId,
  type TutorialObservation,
} from '../../src/client/game/tutorial/steps';

const C = RANGE_COURSE;
const DT = 1 / 60;

function obs(over: Partial<TutorialObservation> = {}): TutorialObservation {
  return {
    dt: DT,
    alive: true,
    pos: { ...C.spawn },
    eye: { x: C.spawn.x, y: 1.62, z: C.spawn.z },
    yaw: 0,
    pitch: -0.4, // looking at the floor: no beacon in view
    sprinting: false,
    sliding: false,
    mantling: false,
    ads: 0,
    padProgress: 0,
    padOwned: false,
    ...over,
  };
}

function lookAt(eye: Vec3, p: Vec3): { yaw: number; pitch: number } {
  const dx = p.x - eye.x;
  const dy = p.y - eye.y;
  const dz = p.z - eye.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/** Feeds frames until the machine leaves `step` (or `max` seconds). Returns the id that started. */
function run(m: TutorialMachine, o: Partial<TutorialObservation>, max = 3): StepId | null {
  const from = m.current;
  for (let t = 0; t < max; t += DT) {
    m.observe(obs(o));
    if (m.current !== from) return m.current;
  }
  return m.current;
}

describe('tutorial step machine', () => {
  it('runs the drills in order as each action is performed', () => {
    const m = new TutorialMachine(C);
    expect(m.current).toBe('look');
    const eye = { x: C.spawn.x, y: 1.62, z: C.spawn.z };
    // Look: first beacon only → still on look, sub-progress 1/2.
    m.observe(obs({ ...lookAt(eye, C.lookBeacons[0]) }));
    expect(m.sub()).toEqual({ n: 1, total: 2 });
    expect(m.current).toBe('look');
    const r = m.observe(obs({ ...lookAt(eye, C.lookBeacons[1]) }));
    expect(r.completed).toBe('look');
    expect(m.hold).toBeCloseTo(DONE_HOLD, 5);
    expect(run(m, {})).toBe('move');
    expect(run(m, { pos: { ...C.entry } })).toBe('sprint');
    expect(run(m, { pos: { x: 12, y: 0, z: -14 } })).toBe('jump');
    expect(run(m, { pos: { x: 12, y: 1, z: -24.5 } })).toBe('mantle');
    expect(run(m, { pos: { x: 12, y: 0, z: -33 } })).toBe('slide');
    expect(run(m, { pos: { x: 12, y: 0, z: -39.5 } })).toBe('shoot');
    // Shoot: kills on the trio only (lane targets and hits don't count).
    m.event({ kind: 'target', id: 1, kill: true, thrown: false });
    m.event({ kind: 'target', id: C.trio[0], kill: false, thrown: false });
    for (const id of C.trio.slice(0, 2)) m.event({ kind: 'target', id, kill: true, thrown: false });
    m.observe(obs());
    expect(m.sub()).toEqual({ n: 2, total: 3 });
    expect(m.current).toBe('shoot');
    m.event({ kind: 'target', id: C.trio[2], kill: true, thrown: false });
    expect(run(m, {})).toBe('ads');
    m.event({ kind: 'target', id: C.long, kill: false, thrown: false });
    expect(run(m, {})).toBe('reload');
    m.event({ kind: 'reload' });
    expect(run(m, {})).toBe('throw');
    // A throw that lands far away does not count; one in the pit does.
    m.event({ kind: 'throwLanded', pos: { x: -10, y: 0, z: -30 } });
    expect(run(m, {}, 1)).toBe('throw');
    m.event({ kind: 'throwLanded', pos: { x: C.trioCenter.x + 2, y: 0, z: C.trioCenter.z - 1 } });
    expect(run(m, {})).toBe('capture');
    expect(m.finished).toBe(false);
    run(m, { padOwned: true });
    expect(m.finished).toBe(true);
    expect(m.progress).toBe(1);
    expect(m.steps.every((s) => s.done && !s.assisted)).toBe(true);
    expect(m.skipped).toBe(false);
  });

  it('auto-completes drills the player already did out of order', () => {
    const m = new TutorialMachine(C);
    // Before even looking around: reload, throw into the pit, run to the perch.
    m.event({ kind: 'reload' });
    m.event({ kind: 'target', id: C.trio[1], kill: false, thrown: true });
    m.observe(obs({ pos: { x: 12, y: 3, z: -48 } }));
    const eye = { x: C.spawn.x, y: 1.62, z: C.spawn.z };
    m.observe(obs({ ...lookAt(eye, C.lookBeacons[0]) }));
    m.observe(obs({ ...lookAt(eye, C.lookBeacons[1]) }));
    // look done → every course drill is already satisfied: fast beats straight to shoot.
    let t = 0;
    while (m.current !== 'shoot' && t < 5) {
      m.observe(obs({ pos: { x: 12, y: 3, z: -48 } }));
      t += DT;
    }
    expect(m.current).toBe('shoot');
    expect(t).toBeLessThan(5 * 0.3 + 1);
    for (const id of C.trio) m.event({ kind: 'target', id, kill: true, thrown: false });
    m.event({ kind: 'target', id: C.long, kill: true, thrown: false });
    while (m.current !== 'capture' && t < 10) {
      m.observe(obs());
      t += DT;
    }
    // shoot, ads, reload, throw were all remembered.
    expect(m.current).toBe('capture');
    for (const id of ['shoot', 'ads', 'reload', 'throw'] as StepId[]) expect(m.steps.find((s) => s.id === id)!.done).toBe(true);
  });

  it('hints after HINT_AFTER seconds and never softlocks (assist after ASSIST_AFTER)', () => {
    const m = new TutorialMachine(C);
    let hinted = -1;
    let t = 0;
    while (m.current === 'look' && t < ASSIST_AFTER + 2) {
      m.observe(obs());
      t += DT;
      if (hinted < 0 && m.hint) hinted = t;
    }
    expect(hinted).toBeGreaterThanOrEqual(HINT_AFTER - 0.05);
    expect(hinted).toBeLessThan(HINT_AFTER + 0.1);
    expect(m.current).toBe('move');
    expect(m.steps[0].assisted).toBe(true);
    expect(m.hint).toBe(false);
  });

  it('skip ends immediately; progress counts completed drills; dead frames are ignored', () => {
    const m = new TutorialMachine(C);
    m.observe(obs({ alive: false, pos: { ...C.entry } }));
    expect(m.satisfied('move')).toBe(false);
    m.observe(obs({ pos: { ...C.entry } }));
    expect(m.satisfied('move')).toBe(true);
    expect(m.progress).toBe(0);
    m.skip();
    expect(m.finished).toBe(true);
    expect(m.skipped).toBe(true);
    expect(m.current).toBeNull();
    expect(m.observe(obs()).finished).toBe(false);
    expect(STEP_ORDER.length).toBe(11);
  });
});

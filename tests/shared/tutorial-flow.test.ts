// Tutorial flow — a scripted "typical new player" plays the whole tutorial in
// the real shared GameSim (range mode) while the tutorial step machine watches
// the same observations/events the client feeds it. Measures the duration.
import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/shared/constants';
import { RANGE_COURSE } from '../../src/shared/maps/range';
import { BTN_ADS, BTN_CROUCH, BTN_FIRE, BTN_JUMP, BTN_RELOAD, BTN_SPRINT, BTN_THROW, type Vec3 } from '../../src/shared/types';
import { TutorialMachine, type StepId } from '../../src/client/game/tutorial/steps';
import { RangeDriver, aimAt } from './range-agent';

const C = RANGE_COURSE;

interface PlayerProfile {
  /** Seconds to read a one-word prompt and react. */
  react: number;
  /** View turn rate (rad/s). */
  turn: number;
  /** Extra aim settle time before shooting (s). */
  settle: number;
  /** Fraction of recoil the player compensates (0..1). */
  recoilComp: number;
}

function playTutorial(pp: PlayerProfile, seed = 11): { m: TutorialMachine; seconds: number; stepTimes: Record<string, number> } {
  const d = new RangeDriver(seed);
  const m = new TutorialMachine(C);
  let reloading = false;
  d.onStep = () => {
    const mv = d.p.move;
    const c = d.p.combat;
    for (const ev of d.latest) {
      if (ev.t === 'target') m.event({ kind: 'target', id: ev.id, kill: ev.kill, thrown: ev.w === 'grenade' });
      else if (ev.t === 'explode' || ev.t === 'smoke') m.event({ kind: 'throwLanded', pos: ev.pos });
      else if (ev.t === 'zone' && ev.ev === 'captured') m.event({ kind: 'captured' });
    }
    if (c.reloadT > 0 && !reloading) m.event({ kind: 'reload' });
    reloading = c.reloadT > 0;
    const z = d.sim.zoneStates()[0];
    m.observe({
      dt: SIM_DT,
      alive: d.p.alive,
      pos: mv.pos,
      eye: d.eye,
      yaw: d.yaw,
      pitch: d.pitch,
      sprinting: mv.sprint,
      sliding: mv.slideT > 0,
      mantling: mv.mantleT > 0,
      ads: c.adsT,
      padProgress: Math.max(0, -z.progress),
      padOwned: z.owner === 0,
    });
  };
  const waitFor = (id: StepId): void => {
    for (let i = 0; i < 60 * 40 && m.current !== id && !m.finished; i++) d.step({});
    d.idle(pp.react);
  };
  const aimTo = (p: Vec3, buttons = 0): void => {
    const a = aimAt(d.eye, p);
    d.turnTo(a.yaw, a.pitch, pp.turn);
    for (let i = 0; i < Math.round(pp.settle / SIM_DT); i++) d.step({ buttons });
  };
  /** Bursts at a target until `done()` (re-aiming between bursts like a person would). */
  const shootAt = (id: number, done: () => boolean, ads = false): void => {
    const hold = ads ? BTN_ADS : 0;
    if (ads) d.idle(0.3, BTN_ADS);
    for (let burst = 0; burst < 40 && !done(); burst++) {
      const t = d.target(id);
      if (!t.alive) {
        d.idle(0.1, hold);
        continue;
      }
      aimTo({ x: t.pos.x, y: t.pos.y + 1.15, z: t.pos.z }, hold);
      for (let i = 0; i < 15 && !done(); i++) {
        const c = d.p.combat;
        const a = aimAt(d.eye, { x: t.pos.x, y: t.pos.y + 1.15, z: t.pos.z });
        d.step({ yaw: a.yaw + c.recoilYaw * pp.recoilComp, pitch: a.pitch - c.recoilPitch * pp.recoilComp, buttons: BTN_FIRE | hold });
      }
      d.idle(0.18, hold);
    }
  };

  // look
  waitFor('look');
  aimTo(C.lookBeacons[0]);
  aimTo(C.lookBeacons[1]);
  // move → sprint → jump → mantle → slide
  waitFor('move');
  d.moveTo(C.entry, { tol: C.entryRadius * 0.7 });
  waitFor('sprint');
  d.moveTo({ x: 12, z: -14.5 }, { buttons: BTN_SPRINT });
  waitFor('jump');
  d.moveTo({ x: 12, z: -25 }, { buttons: (x) => BTN_SPRINT | (x.pos.z < -19.9 ? BTN_JUMP : 0), tol: 0.8 });
  waitFor('mantle');
  d.moveTo({ x: 12, z: -32.5 }, { buttons: (x) => (x.pos.z < -29.1 && x.pos.y < 0.5 && x.ticks % 8 < 4 ? BTN_JUMP : 0) });
  waitFor('slide');
  d.moveTo({ x: 12, z: -40.5 }, { buttons: (x) => BTN_SPRINT | (x.pos.z < -34.2 ? BTN_CROUCH : 0) });
  // shoot the trio from the perch
  waitFor('shoot');
  d.moveTo({ x: C.perch.x, z: C.perch.z - 1 }, { buttons: BTN_SPRINT });
  for (const id of C.trio) shootAt(id, () => m.trioDown.has(id) || m.current !== 'shoot');
  // ADS + the 50 m target
  waitFor('ads');
  const hitsBefore = d.ofType('target').filter((e) => e.id === C.long).length;
  shootAt(C.long, () => d.ofType('target').filter((e) => e.id === C.long).length > hitsBefore || m.current !== 'ads', true);
  // reload
  waitFor('reload');
  d.step({ buttons: BTN_RELOAD });
  // throw at the cluster
  waitFor('throw');
  for (let tries = 0; tries < 3 && m.current === 'throw'; tries++) {
    aimTo({ x: C.trioCenter.x, y: 0.9, z: C.trioCenter.z });
    d.step({ buttons: BTN_THROW });
    d.idle(2.2);
  }
  // capture the pad
  waitFor('capture');
  d.moveTo(C.pad, { tol: 0.8, buttons: BTN_SPRINT });
  for (let i = 0; i < 60 * 15 && !m.finished; i++) d.step({});
  const stepTimes: Record<string, number> = {};
  for (const s of m.steps) stepTimes[s.id] = Math.round(s.time * 10) / 10;
  return { m, seconds: m.elapsed, stepTimes };
}

describe('tutorial flow (simulated input through the real sim)', () => {
  it('a typical new player finishes in about a minute without assists', () => {
    const r = playTutorial({ react: 0.9, turn: 4, settle: 0.25, recoilComp: 0.6 });
    console.info(`[tutorial] typical player: ${r.seconds.toFixed(1)} s`, JSON.stringify(r.stepTimes));
    expect(r.m.finished).toBe(true);
    expect(r.m.skipped).toBe(false);
    expect(r.m.steps.filter((s) => s.assisted).map((s) => s.id)).toEqual([]);
    expect(r.seconds).toBeGreaterThan(30);
    expect(r.seconds).toBeLessThan(70);
  });

  it('a slower, hesitant player still finishes within ~80 s', () => {
    const r = playTutorial({ react: 1.6, turn: 2.5, settle: 0.45, recoilComp: 0.3 }, 5);
    console.info(`[tutorial] hesitant player: ${r.seconds.toFixed(1)} s`, JSON.stringify(r.stepTimes));
    expect(r.m.finished).toBe(true);
    expect(r.seconds).toBeLessThan(85);
  });
});

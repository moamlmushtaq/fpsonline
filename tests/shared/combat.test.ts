import { describe, expect, it } from 'vitest';
import {
  activeWeapon,
  aimAngles,
  createCombatState,
  currentSpread,
  giveSunspear,
  hitboxes,
  pelletDirections,
  rayVsHitboxes,
  reloadDuration,
  speedMultiplier,
  stepCombat,
  stepPlayer,
  type CombatStepResult,
} from '../../src/shared/combat';
import { ADS_SPEED_MULT, SIM_DT } from '../../src/shared/constants';
import { createMoveState } from '../../src/shared/movement';
import { CollisionWorld } from '../../src/shared/physics';
import type { CombatState, InputCmd, MoveState } from '../../src/shared/types';
import { BTN_ADS, BTN_FIRE, BTN_RELOAD, BTN_SPRINT, BTN_THROW } from '../../src/shared/types';
import { WEAPONS, fireInterval } from '../../src/shared/weapons';

let seq = 0;
function cmd(p: Partial<InputCmd> = {}): InputCmd {
  return { seq: ++seq, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, slot: 0, viewTick: 0, ...p };
}

/** Runs combat for `ticks` with the given command (prevButtons maintained like stepMovement does). */
function run(c: CombatState, m: MoveState, p: Partial<InputCmd>, ticks: number): CombatStepResult[] {
  const out: CombatStepResult[] = [];
  for (let i = 0; i < ticks; i++) {
    const k = cmd(p);
    out.push(stepCombat(c, m, k, 7, SIM_DT));
    m.prevButtons = k.buttons;
  }
  return out;
}

const shots = (rs: CombatStepResult[]) => rs.filter((r) => r.shot).length;

describe('combat', () => {
  it('auto fire matches the weapon rpm', () => {
    const c = createCombatState({ primary: 'meridian', throwable: 'grenade' });
    const m = createMoveState({ x: 0, y: 0, z: 0 });
    const rs = run(c, m, { buttons: BTN_FIRE }, 60);
    const expected = 60 / 60 / fireInterval('meridian');
    expect(shots(rs)).toBeGreaterThanOrEqual(Math.floor(expected));
    expect(shots(rs)).toBeLessThanOrEqual(Math.ceil(expected) + 1);
    expect(c.slots[0].mag).toBe(WEAPONS.meridian.magSize - shots(rs));
  });

  it('semi-auto requires re-pressing the trigger', () => {
    const c = createCombatState({ primary: 'meridian', throwable: 'grenade' });
    c.active = 1; // Pulse sidearm
    const m = createMoveState({ x: 0, y: 0, z: 0 });
    expect(shots(run(c, m, { buttons: BTN_FIRE, slot: 1 }, 60))).toBe(1);
    run(c, m, { slot: 1 }, 1);
    let n = 0;
    for (let i = 0; i < 20; i++) {
      c.slots[1].mag = WEAPONS.pulse.magSize;
      n += shots(run(c, m, { buttons: BTN_FIRE, slot: 1 }, 1));
      run(c, m, { buttons: 0, slot: 1 }, 10);
    }
    expect(n).toBe(20);
  });

  it('reloads manually with the right timing and moves reserve into the magazine', () => {
    const c = createCombatState({ primary: 'meridian', throwable: 'grenade' });
    const m = createMoveState({ x: 0, y: 0, z: 0 });
    run(c, m, { buttons: BTN_FIRE }, 30);
    const fired = WEAPONS.meridian.magSize - c.slots[0].mag;
    expect(fired).toBeGreaterThan(0);
    run(c, m, {}, 30);
    const r = run(c, m, { buttons: BTN_RELOAD }, 1);
    expect(r[0].reloadStarted).toBe(true);
    expect(r[0].reloadEmpty).toBe(false);
    const ticks = Math.round(WEAPONS.meridian.reloadTime / SIM_DT);
    run(c, m, {}, ticks - 3);
    expect(c.reloadT).toBeGreaterThan(0);
    expect(c.slots[0].mag).toBe(WEAPONS.meridian.magSize - fired);
    run(c, m, {}, 4);
    expect(c.reloadT).toBe(0);
    expect(c.slots[0].mag).toBe(WEAPONS.meridian.magSize);
    expect(c.slots[0].reserve).toBe(WEAPONS.meridian.reserve - fired);
  });

  it('auto-reloads (with empty extra) when firing an empty magazine; dry fire without reserve', () => {
    const c = createCombatState({ primary: 'swift', throwable: 'grenade' });
    const m = createMoveState({ x: 0, y: 0, z: 0 });
    c.slots[0].mag = 0;
    const r = run(c, m, { buttons: BTN_FIRE }, 1);
    expect(r[0].reloadStarted).toBe(true);
    expect(r[0].reloadEmpty).toBe(true);
    expect(c.reloadT).toBeCloseTo(reloadDuration('swift', 0) - 0, 6);
    expect(reloadDuration('swift', 0)).toBeCloseTo(WEAPONS.swift.reloadTime + WEAPONS.swift.reloadEmptyExtra, 6);
    const c2 = createCombatState({ primary: 'swift', throwable: 'grenade' });
    c2.slots[0].mag = 0;
    c2.slots[0].reserve = 0;
    const r2 = run(c2, m, { buttons: BTN_FIRE }, 1);
    expect(r2[0].dryFire).toBe(true);
    expect(r2[0].reloadStarted).toBe(false);
  });

  it('Breaker reloads shell by shell and can interrupt the reload to fire', () => {
    const c = createCombatState({ primary: 'breaker', throwable: 'grenade' });
    const m = createMoveState({ x: 0, y: 0, z: 0 });
    c.slots[0].mag = 2;
    run(c, m, { buttons: BTN_RELOAD }, 1);
    expect(c.reloadT).toBeCloseTo(reloadDuration('breaker', 2), 6);
    run(c, m, {}, Math.round((WEAPONS.breaker.reloadTime * 0.25 + WEAPONS.breaker.reloadPerRound! * 1.5) / SIM_DT));
    expect(c.slots[0].mag).toBe(3);
    const r = run(c, m, { buttons: BTN_FIRE }, 1);
    expect(r[0].shot).not.toBeNull();
    expect(r[0].shot!.dirs.length).toBe(WEAPONS.breaker.pellets);
    expect(c.reloadT).toBe(0);
    expect(c.slots[0].mag).toBe(2);
  });

  it('swap blocks firing, interrupts reload, ignores empty pickup slot', () => {
    const c = createCombatState({ primary: 'meridian', throwable: 'grenade' });
    const m = createMoveState({ x: 0, y: 0, z: 0 });
    c.slots[0].mag = 5;
    run(c, m, { buttons: BTN_RELOAD }, 1);
    expect(c.reloadT).toBeGreaterThan(0);
    const r = run(c, m, { slot: 1, buttons: BTN_FIRE }, 1);
    expect(r[0].swappedTo).toBe('pulse');
    expect(c.reloadT).toBe(0);
    expect(c.slots[0].mag).toBe(5);
    const during = run(c, m, { slot: 1, buttons: BTN_FIRE }, Math.floor(WEAPONS.pulse.swapTime / SIM_DT) - 2);
    expect(shots(during)).toBe(0);
    run(c, m, { slot: 1 }, 5);
    expect(shots(run(c, m, { slot: 1, buttons: BTN_FIRE }, 1))).toBe(1);
    // Empty pickup slot is ignored.
    const r2 = run(c, m, { slot: 2 }, 1);
    expect(r2[0].swappedTo).toBeNull();
    expect(c.active).toBe(1);
  });

  it('sprinting delays the first shot by sprintOutTime', () => {
    const c = createCombatState({ primary: 'meridian', throwable: 'grenade' });
    const m = createMoveState({ x: 0, y: 0, z: 0 });
    m.sprint = true;
    run(c, m, { buttons: BTN_SPRINT, mz: 1 }, 10);
    m.sprint = false;
    const rs = run(c, m, { buttons: BTN_FIRE }, 30);
    const first = rs.findIndex((r) => r.shot);
    expect(first * SIM_DT).toBeGreaterThanOrEqual(WEAPONS.meridian.sprintOutTime - SIM_DT);
    expect(first * SIM_DT).toBeLessThanOrEqual(WEAPONS.meridian.sprintOutTime + 2 * SIM_DT);
  });

  it('ADS progresses over adsTime and slows movement', () => {
    const c = createCombatState({ primary: 'longline', throwable: 'grenade' });
    const m = createMoveState({ x: 0, y: 0, z: 0 });
    run(c, m, { buttons: BTN_ADS }, Math.round(WEAPONS.longline.adsTime / SIM_DT / 2));
    expect(c.adsT).toBeGreaterThan(0.4);
    expect(c.adsT).toBeLessThan(0.6);
    run(c, m, { buttons: BTN_ADS }, 30);
    expect(c.adsT).toBe(1);
    expect(speedMultiplier(c)).toBeCloseTo(WEAPONS.longline.moveSpeedMult * ADS_SPEED_MULT, 6);
    expect(currentSpread(c, m)).toBeCloseTo(WEAPONS.longline.adsSpread * 1, 6);
  });

  it('spread is deterministic per (player, seq) and bounded by the cone', () => {
    const a = pelletDirections('breaker', 0.3, 0.1, 0.05, 4, 123);
    const b = pelletDirections('breaker', 0.3, 0.1, 0.05, 4, 123);
    const c = pelletDirections('breaker', 0.3, 0.1, 0.05, 4, 124);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    const fwd = { x: -Math.sin(0.3) * Math.cos(0.1), y: Math.sin(0.1), z: -Math.cos(0.3) * Math.cos(0.1) };
    for (const d of a) {
      const cos = d.x * fwd.x + d.y * fwd.y + d.z * fwd.z;
      expect(Math.acos(Math.min(1, cos))).toBeLessThanOrEqual(0.05 + 1e-6);
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
    }
  });

  it('recoil accumulates along the pattern and recovers after firing stops', () => {
    const c = createCombatState({ primary: 'meridian', throwable: 'grenade' });
    const m = createMoveState({ x: 0, y: 0, z: 0 });
    const rs = run(c, m, { buttons: BTN_FIRE }, 40);
    const n = shots(rs);
    expect(c.recoilIdx).toBe(n);
    const pat = WEAPONS.meridian.recoil.pattern;
    let expected = 0;
    for (let i = 0; i < n; i++) expected += pat[Math.min(i, pat.length - 1)][0];
    expect(c.recoilPitch).toBeCloseTo(expected, 6);
    const aim = aimAngles(cmd({ pitch: 0 }), c);
    expect(aim.pitch).toBeCloseTo(c.recoilPitch, 9);
    run(c, m, {}, 180);
    expect(c.recoilPitch).toBe(0);
    expect(c.recoilIdx).toBe(0);
  });

  it('Sunspear charges, fires a beam, decays when released early, and empties into a swap', () => {
    const c = createCombatState({ primary: 'meridian', throwable: 'grenade' });
    const m = createMoveState({ x: 0, y: 0, z: 0 });
    expect(giveSunspear(c)).toBe(true);
    run(c, m, { slot: 2 }, Math.ceil(WEAPONS.sunspear.swapTime / SIM_DT) + 1);
    expect(activeWeapon(c)).toBe('sunspear');
    // Release early: no shot, charge decays.
    const early = run(c, m, { slot: 2, buttons: BTN_FIRE }, 20);
    expect(early[0].chargeStarted).toBe(true);
    expect(shots(early)).toBe(0);
    run(c, m, { slot: 2 }, 30);
    expect(c.chargeT).toBe(0);
    let fired = 0;
    for (let k = 0; k < 4; k++) {
      const rs = run(c, m, { slot: 2, buttons: BTN_FIRE }, Math.ceil(WEAPONS.sunspear.chargeTime! / SIM_DT) + 1);
      fired += shots(rs);
      run(c, m, { slot: 2 }, 70);
    }
    expect(fired).toBe(4);
    expect(c.slots[2]).toBeNull();
    expect(activeWeapon(c)).toBe('meridian');
  });

  it('throw is edge-triggered and limited to one per life', () => {
    const c = createCombatState({ primary: 'meridian', throwable: 'smoke' });
    const m = createMoveState({ x: 0, y: 0, z: 0 });
    const a = run(c, m, { buttons: BTN_THROW }, 10);
    expect(a.filter((r) => r.throwRequested).length).toBe(1);
    run(c, m, {}, 60);
    const b = run(c, m, { buttons: BTN_THROW }, 1);
    expect(b[0].throwRequested).toBe(false);
  });

  it('hitboxes: head above body, crouch lowers both; ray picks the nearest', () => {
    const stand = hitboxes({ x: 0, y: 0, z: 0 }, 0);
    const crouch = hitboxes({ x: 0, y: 0, z: 0 }, 1);
    expect(stand.head.c.y).toBeGreaterThan(stand.body.max.y);
    expect(crouch.head.c.y).toBeLessThan(stand.head.c.y - 0.5);
    expect(crouch.body.max.y).toBeLessThan(stand.body.max.y);
    const head = rayVsHitboxes({ x: 0, y: stand.head.c.y, z: 10 }, { x: 0, y: 0, z: -1 }, 100, stand);
    expect(head?.head).toBe(true);
    expect(head?.dist).toBeCloseTo(10 - stand.head.r, 6);
    const body = rayVsHitboxes({ x: 0, y: 1, z: 10 }, { x: 0, y: 0, z: -1 }, 100, stand);
    expect(body?.head).toBe(false);
    expect(rayVsHitboxes({ x: 2, y: 1, z: 10 }, { x: 0, y: 0, z: -1 }, 100, stand)).toBeNull();
    expect(rayVsHitboxes({ x: 0, y: 1, z: 10 }, { x: 0, y: 0, z: -1 }, 5, stand)).toBeNull();
  });

  it('stepPlayer runs combat then movement deterministically', () => {
    const world = new CollisionWorld([{ min: { x: -50, y: -1, z: -50 }, max: { x: 50, y: 0, z: 50 }, tag: 'concrete' }], {
      min: { x: -50, y: -10, z: -50 },
      max: { x: 50, y: 20, z: 50 },
    });
    const runOnce = () => {
      const m = createMoveState({ x: 0, y: 0, z: 0 });
      const c = createCombatState({ primary: 'swift', throwable: 'grenade' });
      const out: string[] = [];
      for (let i = 1; i <= 240; i++) {
        const k: InputCmd = { seq: i, mx: Math.sin(i * 0.1), mz: 1, yaw: i * 0.01, pitch: 0, buttons: (i % 40 < 25 ? BTN_FIRE : 0) | (i % 90 > 60 ? BTN_ADS : 0), slot: 0, viewTick: 0 };
        const r = stepPlayer(world, m, c, k, 3, SIM_DT);
        if (r.shot) out.push(JSON.stringify(r.shot.dirs));
      }
      return JSON.stringify({ m, c, out });
    };
    expect(runOnce()).toBe(runOnce());
  });
});

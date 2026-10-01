import { describe, expect, it } from 'vitest';
import {
  JUMP_VELOCITY,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  SIM_DT,
  SLIDE_DURATION,
  SLIDE_SPEED,
  SPRINT_SPEED,
  WALK_SPEED,
} from '../../src/shared/constants';
import { createMoveState, horizontalSpeed, playerHeight, stepMovement } from '../../src/shared/movement';
import { CollisionWorld } from '../../src/shared/physics';
import { GANTRY } from '../../src/shared/maps/gantry';
import type { Solid } from '../../src/shared/maps/types';
import { worldForMap } from '../../src/shared/sim/game';
import type { InputCmd, MoveState } from '../../src/shared/types';
import { BTN_CROUCH, BTN_JUMP, BTN_SPRINT } from '../../src/shared/types';

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, extra: Partial<Solid> = {}): Solid {
  return { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 }, tag: 'concrete', ...extra };
}

function world(extra: Solid[] = []): CollisionWorld {
  const solids = [box(-100, -1, -100, 100, 0, 100), ...extra];
  return new CollisionWorld(solids, { min: { x: -100, y: -10, z: -100 }, max: { x: 100, y: 50, z: 100 } });
}

let seq = 0;
function cmd(p: Partial<InputCmd> = {}): InputCmd {
  return { seq: ++seq, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, slot: 0, viewTick: 0, ...p };
}

function run(w: CollisionWorld, m: MoveState, c: Partial<InputCmd>, ticks: number, speedMult = 1): void {
  for (let i = 0; i < ticks; i++) stepMovement(w, m, cmd(c), speedMult, SIM_DT);
}

describe('movement', () => {
  it('reaches walk speed quickly and stops crisply', () => {
    const w = world();
    const m = createMoveState({ x: 0, y: 0, z: 0 });
    run(w, m, { mz: 1 }, 8);
    expect(horizontalSpeed(m)).toBeGreaterThan(WALK_SPEED * 0.95);
    run(w, m, { mz: 1 }, 30);
    expect(horizontalSpeed(m)).toBeCloseTo(WALK_SPEED, 3);
    // Moves toward -Z at yaw 0.
    expect(m.pos.z).toBeLessThan(-2);
    expect(m.onGround).toBe(true);
    run(w, m, {}, 12);
    expect(horizontalSpeed(m)).toBeLessThan(0.05);
  });

  it('sprints only when moving forward', () => {
    const w = world();
    const m = createMoveState({ x: 0, y: 0, z: 0 });
    run(w, m, { mz: 1, buttons: BTN_SPRINT }, 30);
    expect(m.sprint).toBe(true);
    expect(horizontalSpeed(m)).toBeCloseTo(SPRINT_SPEED, 2);
    run(w, m, { mx: 1, buttons: BTN_SPRINT }, 30);
    expect(m.sprint).toBe(false);
    expect(horizontalSpeed(m)).toBeLessThanOrEqual(WALK_SPEED + 1e-6);
  });

  it('jump apex is about 1.1–1.3 m and lands with impact', () => {
    const w = world();
    const m = createMoveState({ x: 0, y: 0, z: 0 });
    run(w, m, {}, 2);
    stepMovement(w, m, cmd({ buttons: BTN_JUMP }), 1, SIM_DT);
    expect(m.vel.y).toBeCloseTo(JUMP_VELOCITY - 20 * SIM_DT, 5);
    let apex = 0;
    let impact = 0;
    for (let i = 0; i < 90; i++) {
      stepMovement(w, m, cmd({ buttons: BTN_JUMP }), 1, SIM_DT);
      apex = Math.max(apex, m.pos.y);
      impact = Math.max(impact, m.landImpact);
    }
    expect(apex).toBeGreaterThan(1.1);
    expect(apex).toBeLessThan(1.3);
    expect(m.onGround).toBe(true);
    expect(m.pos.y).toBeCloseTo(0, 6);
    expect(impact).toBeGreaterThan(5);
  });

  it('jump is edge-triggered (holding does not bunny hop)', () => {
    const w = world();
    const m = createMoveState({ x: 0, y: 0, z: 0 });
    let jumps = 0;
    let wasGround = true;
    for (let i = 0; i < 180; i++) {
      stepMovement(w, m, cmd({ buttons: BTN_JUMP }), 1, SIM_DT);
      if (wasGround && !m.onGround) jumps++;
      wasGround = m.onGround;
    }
    expect(jumps).toBe(1);
  });

  it('steps up onto 0.4 m steps and walks up stairs', () => {
    const steps: Solid[] = [];
    for (let i = 0; i < 6; i++) steps.push(box(-2, 0, -3 - i * 0.5, 2, 0.4 * (i + 1), -2.5 - i * 0.5));
    steps.push(box(-2, 0, -12, 2, 2.4, -5.5));
    const w = world(steps);
    const m = createMoveState({ x: 0, y: 0, z: 0 });
    run(w, m, { mz: 1 }, 90);
    expect(m.pos.y).toBeCloseTo(2.4, 5);
    expect(m.pos.z).toBeLessThan(-6);
    expect(m.onGround).toBe(true);
  });

  it('is blocked by a 1 m wall without jumping, mantles onto it with jump', () => {
    const w = world([box(-3, 0, -4, 3, 1.0, -2)]);
    const m = createMoveState({ x: 0, y: 0, z: 0 });
    run(w, m, { mz: 1 }, 60);
    expect(m.pos.y).toBe(0);
    expect(m.pos.z).toBeGreaterThan(-1.61);
    expect(m.pos.z).toBeLessThan(-1.55);
    stepMovement(w, m, cmd({ mz: 1, buttons: BTN_JUMP }), 1, SIM_DT);
    expect(m.mantleT).toBeGreaterThan(0);
    run(w, m, { mz: 1 }, 40);
    expect(m.mantleT).toBe(0);
    expect(m.pos.y).toBeCloseTo(1.0, 2);
    expect(m.onGround).toBe(true);
  });

  it('does not mantle walls that are too tall', () => {
    const w = world([box(-3, 0, -4, 3, 3.0, -2)]);
    const m = createMoveState({ x: 0, y: 0, z: 0 });
    run(w, m, { mz: 1 }, 40);
    stepMovement(w, m, cmd({ mz: 1, buttons: BTN_JUMP }), 1, SIM_DT);
    run(w, m, { mz: 1 }, 60);
    expect(m.pos.y).toBeLessThan(0.01);
  });

  it('slides from sprint and returns to crouch speed', () => {
    const w = world();
    const m = createMoveState({ x: 0, y: 0, z: 0 });
    run(w, m, { mz: 1, buttons: BTN_SPRINT }, 40);
    expect(m.sprint).toBe(true);
    stepMovement(w, m, cmd({ mz: 1, buttons: BTN_SPRINT | BTN_CROUCH }), 1, SIM_DT);
    expect(m.slideT).toBeGreaterThan(0);
    expect(horizontalSpeed(m)).toBeGreaterThan(SLIDE_SPEED * 0.95);
    const startZ = m.pos.z;
    let ticks = 0;
    while (m.slideT > 0 && ticks < 200) {
      stepMovement(w, m, cmd({ mz: 1, buttons: BTN_SPRINT | BTN_CROUCH }), 1, SIM_DT);
      ticks++;
    }
    expect(ticks * SIM_DT).toBeLessThanOrEqual(SLIDE_DURATION + 1e-6);
    expect(ticks * SIM_DT).toBeGreaterThan(0.4);
    expect(startZ - m.pos.z).toBeGreaterThan(4);
    expect(m.slideCooldown).toBeGreaterThan(0);
    run(w, m, { mz: 1, buttons: BTN_CROUCH }, 60);
    expect(horizontalSpeed(m)).toBeLessThan(3.2);
    expect(playerHeight(m)).toBeCloseTo(PLAYER_CROUCH_HEIGHT, 5);
  });

  it('slide-jump keeps momentum but is capped', () => {
    const w = world();
    const m = createMoveState({ x: 0, y: 0, z: 0 });
    run(w, m, { mz: 1, buttons: BTN_SPRINT }, 40);
    stepMovement(w, m, cmd({ mz: 1, buttons: BTN_SPRINT | BTN_CROUCH }), 1, SIM_DT);
    run(w, m, { mz: 1, buttons: BTN_CROUCH }, 5);
    stepMovement(w, m, cmd({ mz: 1, buttons: BTN_JUMP }), 1, SIM_DT);
    expect(m.slideT).toBe(0);
    expect(m.onGround).toBe(false);
    const hs = horizontalSpeed(m);
    expect(hs).toBeGreaterThan(SPRINT_SPEED);
    expect(hs).toBeLessThan(9.5);
  });

  it('cannot stand up under a low ceiling', () => {
    const w = world([box(-2, 1.4, -6, 2, 2, -2)]);
    const m = createMoveState({ x: 0, y: 0, z: 0 });
    run(w, m, { mz: 1, buttons: BTN_CROUCH }, 60);
    expect(m.pos.z).toBeLessThan(-3);
    run(w, m, {}, 30);
    expect(m.crouch).toBe(true);
    expect(playerHeight(m)).toBeLessThan(1.4);
    run(w, m, { mz: 1 }, 120);
    expect(m.pos.z).toBeLessThan(-6);
    run(w, m, {}, 30);
    expect(m.crouch).toBe(false);
    expect(playerHeight(m)).toBeCloseTo(PLAYER_HEIGHT, 5);
  });

  it('releasing crouch mid-jump under a 2.4 m ceiling never wedges the player in the air', () => {
    // Regression: a crouch-jump in Gantry's 2.4 m maintenance tunnels, releasing
    // crouch on the way up, left the player hanging under the ceiling (the box
    // grew into the roof; nothing could move it) until they crouched again.
    const tunnel = () => world([box(-3, 2.4, -20, 3, 4, 20)]);
    for (let release = 0; release <= 40; release++) {
      const w = tunnel();
      const m = createMoveState({ x: 0, y: 0, z: 0 });
      run(w, m, { buttons: BTN_CROUCH }, 20);
      stepMovement(w, m, cmd({ buttons: BTN_CROUCH | BTN_JUMP }), 1, SIM_DT);
      run(w, m, { buttons: BTN_CROUCH | BTN_JUMP }, release);
      let maxHead = 0;
      for (let i = 0; i < 90; i++) {
        stepMovement(w, m, cmd({ buttons: i < 30 ? BTN_JUMP : 0 }), 1, SIM_DT);
        maxHead = Math.max(maxHead, m.pos.y + playerHeight(m));
        expect(w.boxOverlaps(m.pos.x, m.pos.y, m.pos.z, 0.4, playerHeight(m)), `release ${release} tick ${i}`).toBe(false);
      }
      expect(maxHead).toBeLessThanOrEqual(2.4 + 1e-6);
      expect(m.onGround, `release ${release}`).toBe(true);
      expect(m.pos.y).toBeCloseTo(0, 6);
      expect(m.crouch).toBe(false);
      expect(playerHeight(m)).toBeCloseTo(PLAYER_HEIGHT, 5);
      // And walks on normally.
      const z0 = m.pos.z;
      run(w, m, { mz: 1 }, 30);
      expect(m.pos.z).toBeLessThan(z0 - 2);
    }
  });

  it('crouch-jump + release in the real Gantry tunnels lands and stands up', () => {
    const w = worldForMap(GANTRY);
    for (const [x, z] of [
      [-8, -10],
      [-8, 10],
    ]) {
      for (let release = 2; release <= 20; release += 3) {
        const m = createMoveState({ x, y: 0, z });
        run(w, m, { buttons: BTN_CROUCH }, 20);
        stepMovement(w, m, cmd({ buttons: BTN_CROUCH | BTN_JUMP }), 1, SIM_DT);
        run(w, m, { buttons: BTN_CROUCH }, release);
        run(w, m, {}, 60);
        expect(m.onGround, `${x},${z} release ${release}`).toBe(true);
        expect(m.pos.y).toBeCloseTo(0, 6);
        expect(playerHeight(m)).toBeCloseTo(PLAYER_HEIGHT, 5);
      }
    }
  });

  it('never tunnels through a 0.2 m wall at 30 m/s', () => {
    const w = world([box(-5, 0, -10.1, 5, 4, -9.9)]);
    for (let k = 0; k < 20; k++) {
      const m = createMoveState({ x: 0, y: 0, z: -8 + k * 0.037 });
      m.vel.z = -30;
      for (let i = 0; i < 10; i++) {
        m.vel.z = -30;
        stepMovement(w, m, cmd({ mz: 1 }), 1, SIM_DT);
      }
      expect(m.pos.z).toBeGreaterThan(-9.9);
    }
    // Airborne too.
    const m = createMoveState({ x: 0, y: 0.5, z: -8 });
    m.onGround = false;
    for (let i = 0; i < 10; i++) {
      m.vel.z = -30;
      stepMovement(w, m, cmd(), 1, SIM_DT);
    }
    expect(m.pos.z).toBeGreaterThan(-9.9);
  });

  it('walks up and down ramps', () => {
    // Ramp rising toward -Z from z=-2 (y=0) to z=-10 (y=3), then a platform.
    const w = world([
      box(-2, 0, -10, 2, 3, -2, { ramp: { axis: 'z', dir: -1 } }),
      box(-2, 0, -16, 2, 3, -10),
    ]);
    const m = createMoveState({ x: 0, y: 0, z: 0 });
    run(w, m, { mz: 1 }, 150);
    expect(m.pos.z).toBeLessThan(-11);
    expect(m.pos.y).toBeCloseTo(3, 4);
    run(w, m, { yaw: Math.PI, mz: 1 }, 150);
    expect(m.pos.z).toBeGreaterThan(-1);
    expect(m.pos.y).toBeCloseTo(0, 4);
    expect(m.onGround).toBe(true);
  });

  it('ramp side is a wall when too high', () => {
    const w = world([box(-2, 0, -10, 2, 3, -2, { ramp: { axis: 'z', dir: -1 } })]);
    const m = createMoveState({ x: -6, y: 0, z: -9 });
    // Walk toward +X (yaw -π/2 → forward = +X).
    run(w, m, { yaw: -Math.PI / 2, mz: 1 }, 120);
    expect(m.pos.x).toBeLessThan(-2.39);
    expect(m.pos.y).toBe(0);
  });

  it('is deterministic for identical inputs', () => {
    const w = world([box(-3, 0, -8, 3, 1.0, -6), box(4, 0, -20, 8, 2, -4, { ramp: { axis: 'z', dir: -1 } })]);
    const script: InputCmd[] = [];
    let s = 12345;
    const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
    for (let i = 0; i < 600; i++) {
      const b = (rnd() < 0.1 ? BTN_JUMP : 0) | (rnd() < 0.5 ? BTN_SPRINT : 0) | (rnd() < 0.08 ? BTN_CROUCH : 0);
      script.push({ seq: i + 1, mx: rnd() * 2 - 1, mz: rnd() * 1.4 - 0.4, yaw: rnd() * 0.6 - 0.3, pitch: 0, buttons: b, slot: 0, viewTick: 0 });
    }
    const a = createMoveState({ x: 0, y: 0, z: 0 });
    const b = createMoveState({ x: 0, y: 0, z: 0 });
    for (const c of script) stepMovement(w, a, c, 1, SIM_DT);
    for (const c of script) stepMovement(w, b, c, 1, SIM_DT);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('coyote time allows a jump just after walking off a ledge', () => {
    const w = new CollisionWorld([box(-2, -1, -3, 2, 2, 3), box(-50, -3, -50, 50, -2, 50)], {
      min: { x: -50, y: -10, z: -50 },
      max: { x: 50, y: 50, z: 50 },
    });
    const m = createMoveState({ x: 0, y: 2, z: 0 });
    let t = 0;
    while (m.onGround && t < 200) {
      stepMovement(w, m, cmd({ mz: 1 }), 1, SIM_DT);
      t++;
    }
    expect(m.onGround).toBe(false);
    stepMovement(w, m, cmd({ mz: 1, buttons: BTN_JUMP }), 1, SIM_DT);
    expect(m.vel.y).toBeGreaterThan(5);
  });
});

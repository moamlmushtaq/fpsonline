// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — weapon designs I: Meridian (AR), Swift (SMG), Longline (DMR).
// Profiles are drawn as (u = forward, v = up) and extruded across X; z = −u.
// ─────────────────────────────────────────────────────────────────────────────

import { F, REGION } from './surface';
import { Build, cylX, cylY, cylZ, latheY, latheZ, profile, rbox, sphere, torusY, torusZ } from './kit';
import { dial, label, pistolGrip, screenPanel, screw, sideDecal, slingLoop, triggerGroup, ventSlots } from './common';

// ── MERIDIAN — balanced assault rifle, carry-handle optic, curved magazine ──

export function buildMeridian(b: Build): void {
  const R = b.root;
  // Receiver: anodized lower + ceramic clamshell upper.
  b.add(R, 'lower', profile([[-0.07, 0.014, 0.004], [0.212, 0.014, 0.004], [0.212, -0.016, 0.01], [0.178, -0.03, 0.006], [0.176, -0.066, 0.005], [0.096, -0.066, 0.005], [0.094, -0.03, 0.004], [-0.062, -0.03, 0.01], [-0.07, -0.016, 0.008]], 0.052, 0.009), F.dark);
  b.add(R, 'upper', profile([[-0.098, 0.004, 0.008], [-0.098, 0.062, 0.028], [-0.07, 0.088, 0.02], [0.195, 0.088, 0.02], [0.218, 0.07, 0.016], [0.218, 0.004, 0.006]], 0.066, 0.02), F.shell);
  // Carry handle that doubles as the optic bridge.
  b.add(
    R,
    'handle',
    profile(
      [[-0.066, 0.08, 0.004], [-0.052, 0.136, 0.018], [0.12, 0.136, 0.018], [0.144, 0.08, 0.004]],
      0.03,
      0.009,
      [[[-0.034, 0.093, 0.006], [-0.028, 0.116, 0.01], [0.1, 0.116, 0.01], [0.114, 0.093, 0.006]]],
    ),
    F.dark,
  );
  // Round-lens optic tube (open, so ADS sees straight through).
  const S = 0.163;
  b.add(R, 'mountA', rbox(0.02, 0.012, 0.022, 0.004), F.dark, 0, 0.141, 0.018);
  b.add(R, 'mountB', rbox(0.02, 0.012, 0.022, 0.004), F.dark, 0, 0.141, -0.085);
  b.add(
    R,
    'optic',
    latheZ([[0.0135, -0.034], [0.0175, -0.034], [0.0175, -0.016], [0.016, -0.01], [0.016, 0.07], [0.0205, 0.086], [0.0225, 0.112], [0.019, 0.112], [0.0145, 0.09], [0.0135, -0.034]], 28),
    F.metal,
    0,
    S,
    0,
  );
  b.add(R, 'opticEyecup', torusZ(0.0165, 0.003, Math.PI * 2, 24), F.rubber, 0, S, 0.034);
  b.add(R, 'opticRing', torusZ(0.022, 0.0026, Math.PI * 2, 28), F.accent, 0, S, -0.112);
  b.add(R, 'opticLens', torusZ(0.0178, 0.0016, Math.PI * 2, 28), F.glass, 0, S, -0.108, 0, 0, 0, { view: true });
  b.add(R, 'opticKnob', cylX(0.006, 0.01, 14), F.accent, -0.02, S, -0.02);
  b.add(R, 'reticleRing', torusZ(0.0042, 0.00055, Math.PI * 2, 24), F.sight, 0, S, -0.1, 0, 0, 0, { view: true });
  b.add(R, 'reticleDot', sphere(0.00085, 8), F.sight, 0, S, -0.1, 0, 0, 0, { view: true });
  b.sight.position.set(0, S, 0.034);
  b.meta.eye = 0.17;
  // Pill handguard with vent slots + metal joint band.
  b.add(R, 'guard', profile([[0.218, -0.018, 0.01], [0.218, 0.078, 0.01], [0.455, 0.074, 0.03], [0.485, 0.05, 0.022], [0.485, 0.0, 0.022], [0.455, -0.022, 0.03]], 0.064, 0.026), F.shell);
  b.add(R, 'joint', rbox(0.07, 0.1, 0.012, 0.02), F.metal, 0, 0.03, -0.222);
  b.add(R, 'heatShield', rbox(0.032, 0.012, 0.215, 0.005), F.dark, 0, 0.076, -0.34);
  for (let i = 0; i < 6; i++) b.add(R, 'shieldPort', rbox(0.02, 0.003, 0.012, 0.0015), F.rubber, 0, 0.0822, -0.26 - i * 0.032, 0, 0, 0, { view: true });
  ventSlots(b, R, 'merVent', -0.032, 0.047, -0.385, 3, 0.015, 0.1);
  ventSlots(b, R, 'merVentR', 0.032, 0.047, -0.385, 3, 0.015, 0.1);
  label(b, R, -0.0322, 0.03, -0.27, 0.07);
  // Barrel + brake.
  b.add(R, 'barrel', cylZ(0.0105, 0.0105, 0.1, 14), F.steel, 0, 0.03, -0.53);
  b.add(R, 'gasBlock', rbox(0.026, 0.03, 0.018, 0.006), F.dark, 0, 0.034, -0.492);
  b.add(R, 'brake', cylZ(0.0165, 0.0165, 0.052, 18), F.dark, 0, 0.03, -0.6);
  b.add(R, 'brakeRing', torusZ(0.0166, 0.0024), F.accent, 0, 0.03, -0.578);
  b.add(R, 'brakeCrown', torusZ(0.0148, 0.0028), F.steel, 0, 0.03, -0.626, 0, 0, 0, { view: true });
  for (const s of [-1, 1]) b.add(R, 'brakePort', rbox(0.004, 0.008, 0.026, 0.002), F.steel, s * 0.0158, 0.03, -0.603, 0, 0, 0, { view: true });
  b.muzzle.position.set(0, 0.03, -0.632);
  // Grip + trigger + selector.
  pistolGrip(b, 'mer', 0.004, -0.028, { len: 0.118, rake: 0.32 });
  triggerGroup(b, 'mer', 0.008, -0.03);
  b.add(R, 'selector', rbox(0.004, 0.006, 0.024, 0.002), F.steel, -0.0272, -0.004, 0.03, 0.5, 0, 0, { view: true });
  sideDecal(b, R, 'merSel', REGION.selector, -0.0263, -0.006, 0.044, 0.03);
  // Stock with lightening cut, cheek riser, rubber pad.
  b.add(
    R,
    'stock',
    profile(
      [[-0.095, 0.074, 0.01], [-0.285, 0.068, 0.02], [-0.3, 0.05, 0.012], [-0.3, -0.058, 0.012], [-0.27, -0.066, 0.02], [-0.16, -0.03, 0.03], [-0.095, -0.012, 0.01]],
      0.05,
      0.013,
      [[[-0.255, 0.042, 0.012], [-0.165, 0.044, 0.014], [-0.165, 0.014, 0.012], [-0.235, -0.028, 0.012], [-0.255, -0.03, 0.01]]],
    ),
    F.shell,
  );
  b.add(R, 'butt', profile([[-0.296, 0.07, 0.008], [-0.318, 0.068, 0.008], [-0.322, -0.062, 0.008], [-0.296, -0.064, 0.008]], 0.054, 0.012), F.rubber);
  b.add(R, 'cheek', rbox(0.044, 0.014, 0.12, 0.006), F.rubber, 0, 0.078, 0.2, -0.03);
  b.add(R, 'cheekPip', rbox(0.046, 0.016, 0.012, 0.004), F.accent, 0, 0.078, 0.148, -0.03);
  sideDecal(b, R, 'merBadge', REGION.badge, -0.0252, 0.052, 0.12, 0.022);
  slingLoop(b, R, 0, -0.064, 0.27);
  // Magazine (pivot at the mag well).
  // Curved (banana) magazine in brushed metal; the skin accent is kept to the base plate.
  const mag = b.part(R, 'mag', 0, -0.066, -0.136);
  b.add(
    mag,
    'magBodyC',
    profile(
      [[-0.034, 0.03, 0], [0.034, 0.03, 0], [0.04, -0.03, 0.03], [0.053, -0.08, 0.04], [0.074, -0.124, 0.012], [0.012, -0.136, 0.012], [-0.012, -0.086, 0.04], [-0.028, -0.03, 0.03]],
      0.028,
      0.008,
    ),
    F.metal,
  );
  b.add(mag, 'magBase', rbox(0.033, 0.013, 0.07, 0.004), F.accent, 0, -0.134, -0.043, 0.2, 0, 0);
  for (const [y, z, r] of [[-0.045, -0.006, 0.08], [-0.09, -0.02, 0.22]] as const) b.add(mag, 'magRib', rbox(0.0296, 0.004, 0.058, 0.0018), F.dark, 0, y, z, r, 0, 0, { view: true });
  b.add(mag, 'magWindow', rbox(0.002, 0.05, 0.007, 0.001), F.cream, -0.0135, -0.056, 0.012, 0.12, 0, 0, { view: true });
  b.anchor('mag', mag, 0, -0.07, -0.012, 0.16, 0, 0);
  b.parts.mag = mag;
  // Charging handle on the left (slides back).
  const bolt = b.part(R, 'bolt', -0.033, 0.058, 0.018);
  b.add(bolt, 'boltStem', cylX(0.005, 0.022, 10), F.steel, -0.01, 0, 0);
  b.add(bolt, 'boltCap', cylX(0.009, 0.006, 18), F.accent, -0.022, 0, 0);
  b.anchor('bolt', bolt, -0.024, 0, 0);
  b.parts.bolt = bolt;
  b.add(R, 'boltTrack', rbox(0.004, 0.008, 0.075, 0.003), F.dark, -0.0322, 0.058, 0.05, 0, 0, 0, { ao: 0.5, view: true });
  // Side dial, ammo screen, screws.
  dial(b, R, -0.0332, 0.047, -0.168, 0.0175);
  // Ammo screen: a dashboard on the rear face of the carry handle, facing the eye.
  screenPanel(b, R, 0, 0.106, 0.0598, 0.024, 0.015, 0, 1.33, 0.018);
  for (const [z, y] of [[0.075, 0.028], [-0.19, 0.028], [0.045, -0.012], [-0.19, -0.012]] as const) screw(b, R, y > 0 ? -0.0332 : -0.0262, y, z);
  // Hands: support under the handguard.
  b.handL.position.set(0, 0.03, -0.37);
  b.meta.supportR = 0.038;
}

// ── SWIFT — compact SMG, top pan drum that turns, finned shroud, wire stock ──

export function buildSwift(b: Build): void {
  const R = b.root;
  b.add(R, 'receiver', profile([[-0.075, -0.022, 0.01], [-0.075, 0.07, 0.024], [-0.05, 0.092, 0.018], [0.178, 0.092, 0.02], [0.205, 0.066, 0.024], [0.205, -0.022, 0.01]], 0.064, 0.022), F.shell);
  b.add(R, 'belly', profile([[-0.07, -0.008, 0.004], [0.2, -0.008, 0.004], [0.2, -0.032, 0.008], [-0.07, -0.032, 0.008]], 0.054, 0.01), F.dark);
  // Finned (Lewis-style) cooling shroud.
  // Fin count follows the LOD (8 up close, 4 in third person, a plain sleeve on low).
  const finCount = b.q === 2 ? 8 : b.q === 1 ? 4 : 0;
  const fins: [number, number][] = [[0.012, 0.2], [0.022, 0.2]];
  for (let i = 0; i < finCount; i++) {
    const pitch = 0.116 / finCount;
    const u = 0.212 + i * pitch;
    fins.push([0.022, u], [0.03, u + pitch * 0.2], [0.03, u + pitch * 0.52], [0.022, u + pitch * 0.72]);
  }
  if (!finCount) fins.push([0.027, 0.205], [0.027, 0.325]);
  fins.push([0.022, 0.33], [0.012, 0.33]);
  b.add(R, `shroud${finCount}`, latheZ(fins, 24), F.metal, 0, 0.035, 0);
  b.add(R, 'shroudCap', cylZ(0.019, 0.022, 0.03, 20), F.dark, 0, 0.035, -0.345);
  b.add(R, 'muzzleRing', torusZ(0.019, 0.0026), F.accent, 0, 0.035, -0.359);
  b.muzzle.position.set(0, 0.035, -0.364);
  // Front sight tower + hooded post; rear aperture tower.
  const S = 0.162;
  // Slim dark shark-fin blade on a clamp band (a sight, not a horn).
  b.add(R, 'frontClamp', cylZ(0.0315, 0.0315, 0.014, 20), F.dark, 0, 0.035, -0.312);
  b.add(R, 'frontFin', profile([[0.294, 0.058, 0.004], [0.33, 0.058, 0.004], [0.316, 0.15, 0.003], [0.309, 0.15, 0.003]], 0.005, 0.0018), F.dark);
  b.add(R, 'frontHood', torusZ(0.011, 0.0024, Math.PI * 1.25, 20), F.dark, 0, S, -0.312, 0, 0, -Math.PI * 0.125);
  b.add(R, 'frontPost', rbox(0.003, 0.012, 0.003, 0.001), F.steel, 0, S - 0.007, -0.312);
  b.add(R, 'frontDot', sphere(0.0017, 8), F.sight, 0, S, -0.312);
  b.add(R, 'rearTower', profile([[-0.07, 0.088, 0.003], [-0.04, 0.088, 0.003], [-0.048, 0.148, 0.006], [-0.064, 0.148, 0.006]], 0.016, 0.006), F.dark);
  b.add(R, 'rearAperture', torusZ(0.0085, 0.003, Math.PI * 2, 20), F.steel, 0, S, 0.056);
  b.sight.position.set(0, S, 0.058);
  b.meta.eye = 0.19;
  // Grips.
  pistolGrip(b, 'swf', 0.004, -0.03, { len: 0.108, rake: 0.3 });
  triggerGroup(b, 'swf', 0.008, -0.032);
  b.add(R, 'foregrip', profile([[0.118, -0.028, 0.004], [0.168, -0.028, 0.004], [0.172, -0.075, 0.02], [0.162, -0.118, 0.012], [0.126, -0.118, 0.012], [0.12, -0.07, 0.02]], 0.034, 0.014), F.shell);
  b.add(R, 'foregripCap', rbox(0.038, 0.012, 0.05, 0.005), F.accent, 0, -0.12, -0.144);
  for (let i = 0; i < 3; i++) b.add(R, 'foregripRing', rbox(0.036, 0.004, 0.046, 0.002), F.rubber, 0, -0.058 - i * 0.018, -0.144, 0, 0, 0, { view: true });
  b.handL.position.set(0, -0.078, -0.144);
  b.meta.supportGrip = 1;
  b.meta.supportR = 0.02;
  // Wire stock (folds on the right hinge).
  for (const x of [-0.018, 0.018]) b.add(R, 'wire', cylZ(0.0045, 0.0045, 0.185, 8), F.steel, x, 0.045, 0.1675);
  b.add(R, 'wireLow', cylZ(0.004, 0.004, 0.182, 8), F.steel, 0, -0.0225, 0.165, 0.083, 0, 0);
  b.add(R, 'wireHinge', cylY(0.009, 0.009, 0.032, 14), F.accent, 0.03, 0.03, 0.078);
  b.add(R, 'buttPlate', profile([[-0.255, 0.07, 0.01], [-0.275, 0.068, 0.01], [-0.278, -0.035, 0.012], [-0.258, -0.038, 0.012]], 0.05, 0.012), F.rubber);
  // Pan drum: rotates a notch per round; lifts off to reload.
  b.add(R, 'drumNeck', cylY(0.024, 0.027, 0.008, 20), F.dark, 0, 0.096, -0.058);
  const mag = b.part(R, 'mag', 0, 0.1, -0.058);
  const D = 0.86; // drum scale (keeps the pan readable without swamping the view)
  // Brushed-aluminium pan under a ceramic lid; the accent is a thin band + the key.
  b.add(mag, 'drumBody', latheY([[0.001, 0.0], [0.056 * D, 0.0], [0.063 * D, 0.004], [0.066 * D, 0.011], [0.066 * D, 0.026], [0.061 * D, 0.032], [0.001, 0.032]], 40), F.metal);
  b.add(mag, 'drumLid', latheY([[0.001, 0.031], [0.057 * D, 0.031], [0.055 * D, 0.037], [0.022, 0.04], [0.001, 0.04]], 40), F.shell);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add(mag, 'drumRay', rbox(0.026, 0.003, 0.004, 0.0012), F.dark, Math.cos(a) * 0.034, 0.0395, Math.sin(a) * 0.034, 0, -a, 0, { view: true });
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    b.add(mag, 'drumNotch', rbox(0.004, 0.014, 0.006, 0.0015), F.dark, Math.cos(a) * 0.0655 * D, 0.0185, Math.sin(a) * 0.0655 * D, 0, -a, 0, { view: true });
  }
  b.add(mag, 'drumHub', cylY(0.013, 0.015, 0.01, 18), F.steel, 0, 0.044, 0);
  b.add(mag, 'drumKey', rbox(0.028, 0.007, 0.006, 0.002), F.accent, 0, 0.052, 0);
  b.add(mag, 'drumBand', torusY(0.0664 * D, 0.0026, Math.PI * 2, 40), F.accent, 0, 0.011, 0, 0, 0, 0, { mid: true });
  b.anchor('mag', mag, -0.05, 0.022, 0.012, 0, 0, 0);
  b.parts.mag = mag;
  // Charging knob (left).
  const bolt = b.part(R, 'bolt', -0.032, 0.056, -0.16);
  b.add(bolt, 'boltStem', cylX(0.005, 0.018, 10), F.steel, -0.008, 0, 0);
  b.add(bolt, 'boltBall', sphere(0.0072, 12), F.accent, -0.019, 0, 0);
  b.anchor('bolt', bolt, -0.02, 0, 0);
  b.parts.bolt = bolt;
  b.add(R, 'boltTrack', rbox(0.004, 0.007, 0.07, 0.003), F.dark, -0.0318, 0.056, -0.13, 0, 0, 0, { ao: 0.5, view: true });
  dial(b, R, -0.0322, 0.052, -0.15, 0.0145);
  screenPanel(b, R, -0.0335, 0.07, -0.079, 0.03, 0.015, 1.35, 0.3);
  label(b, R, -0.0322, 0.024, -0.035, 0.058);
  for (const z of [0.055, -0.19]) screw(b, R, -0.0322, 0.06, z);
  screw(b, R, -0.0322, 0.0, 0.055);
}

// ── LONGLINE — marksman rifle: fluted barrel, brass-ringed scope, bolt ──────

export function buildLongline(b: Build): void {
  const R = b.root;
  const BY = 0.046;
  b.add(R, 'receiver', latheZ([[0.001, -0.07], [0.02, -0.07], [0.024, -0.062], [0.024, 0.16], [0.02, 0.168], [0.001, 0.168]], 22), F.metal, 0, BY, 0);
  b.add(R, 'chassis', profile([[-0.085, 0.032, 0.006], [0.23, 0.032, 0.006], [0.24, 0.014, 0.012], [0.24, -0.026, 0.012], [0.2, -0.034, 0.01], [-0.02, -0.034, 0.008], [-0.07, -0.026, 0.01], [-0.085, -0.01, 0.01]], 0.06, 0.018), F.shell);
  b.add(R, 'magwell', profile([[0.05, -0.026, 0.004], [0.14, -0.026, 0.004], [0.137, -0.048, 0.006], [0.053, -0.048, 0.006]], 0.044, 0.008), F.dark);
  b.add(R, 'forend', profile([[0.24, -0.024, 0.01], [0.24, 0.05, 0.01], [0.43, 0.048, 0.022], [0.46, 0.03, 0.018], [0.46, 0.0, 0.018], [0.43, -0.02, 0.022]], 0.054, 0.022), F.shell);
  ventSlots(b, R, 'lngVent', -0.027, 0.02, -0.395, 2, 0.013, 0.09);
  ventSlots(b, R, 'lngVentR', 0.027, 0.02, -0.395, 2, 0.013, 0.09);
  label(b, R, -0.0302, -0.002, -0.12, 0.07);
  // Tapered fluted barrel + heavy brake.
  b.add(R, 'barrel', cylZ(0.0115, 0.0145, 0.552, 16), F.metal, 0, BY, -0.444);
  for (let k = 0; k < 6; k++) {
    const n = b.node(R, 'fluteRot', 0, BY, -0.59, 0, 0, (k * Math.PI) / 3);
    b.add(n, 'flute', rbox(0.0034, 0.0024, 0.2, 0.001), F.dark, 0, 0.0118, 0, 0, 0, 0, { mid: true });
  }
  b.add(R, 'brake', rbox(0.034, 0.03, 0.07, 0.009), F.metal, 0, BY, -0.755);
  for (let i = 0; i < 3; i++) b.add(R, 'brakePort', rbox(0.0355, 0.006, 0.011, 0.002), F.rubber, 0, BY, -0.735 - i * 0.02, 0, 0, 0, { ao: 0.5, view: true });
  b.add(R, 'crown', torusZ(0.013, 0.0022), F.accent, 0, BY, -0.791);
  b.muzzle.position.set(0, BY, -0.795);
  // Bipod folded forward under the barrel.
  b.add(R, 'bipodHinge', rbox(0.04, 0.018, 0.02, 0.006), F.dark, 0, 0.022, -0.465);
  for (const x of [-0.013, 0.013]) {
    b.add(R, 'bipodLeg', cylZ(0.004, 0.0045, 0.19, 8), F.dark, x, 0.024, -0.565);
    b.add(R, 'bipodFoot', sphere(0.0065, 10), F.rubber, x, 0.024, -0.662, 0, 0, 0, { view: true });
  }
  // Grip, trigger.
  pistolGrip(b, 'lng', 0.004, -0.03, { len: 0.118, rake: 0.3 });
  triggerGroup(b, 'lng', 0.008, -0.034);
  // Solid precision stock with a dropped toe (the kill-feed silhouette), a
  // slim lightening slot and a bakelite cheek piece on steel posts — distinct
  // from the Meridian's open skeleton stock.
  b.add(
    R,
    'stockT',
    profile(
      [[-0.085, 0.032, 0.006], [-0.085, 0.066, 0.012], [-0.36, 0.063, 0.02], [-0.38, 0.046, 0.01], [-0.38, -0.1, 0.012], [-0.352, -0.114, 0.016], [-0.29, -0.084, 0.03], [-0.19, -0.046, 0.03], [-0.1, -0.034, 0.012], [-0.085, -0.01, 0.006]],
      0.052,
      0.013,
      [[[-0.318, 0.03, 0.012], [-0.2, 0.034, 0.012], [-0.2, 0.012, 0.01], [-0.3, -0.01, 0.01]]],
    ),
    F.shell,
  );
  for (const z of [0.2, 0.3]) b.add(R, 'cheekPost', cylY(0.003, 0.003, 0.02, 8), F.steel, 0, 0.07, z, 0, 0, 0, { view: true });
  b.add(R, 'cheek', rbox(0.044, 0.016, 0.14, 0.007), F.bakelite, 0, 0.083, 0.25);
  b.add(R, 'buttT', profile([[-0.374, 0.064, 0.008], [-0.397, 0.062, 0.008], [-0.4, -0.108, 0.01], [-0.376, -0.112, 0.008]], 0.056, 0.012), F.rubber);
  b.add(R, 'toeStripe', rbox(0.0536, 0.006, 0.07, 0.0025), F.accent, 0, -0.07, 0.3, 0.42, 0, 0, { mid: true });
  sideDecal(b, R, 'lngBadge', REGION.badge, -0.0262, 0.05, 0.14, 0.022);
  slingLoop(b, R, 0, -0.098, 0.33);
  slingLoop(b, R, 0, -0.024, -0.42);
  // Scope: brass rings, turrets, glass.
  const SY = 0.128;
  for (const z of [0.0, -0.13]) {
    b.add(R, 'scopeBase', rbox(0.022, 0.05, 0.02, 0.005), F.dark, 0, 0.092, z);
    b.add(R, 'scopeRing', torusZ(0.0185, 0.0038, Math.PI * 2, 28), F.brass, 0, SY, z);
  }
  b.add(
    R,
    'scope',
    latheZ([[0.012, -0.078], [0.017, -0.078], [0.019, -0.088], [0.0245, -0.083], [0.0245, -0.04], [0.0165, -0.022], [0.0165, 0.15], [0.0285, 0.2], [0.0295, 0.245], [0.026, 0.252], [0.023, 0.246], [0.012, 0.246]], 30),
    F.dark,
    0,
    SY,
    0,
  );
  b.add(R, 'scopeEyeGlass', cylZ(0.0125, 0.0125, 0.001, 20), F.glass, 0, SY, 0.078, 0, 0, 0, { view: true });
  b.add(R, 'scopeObjGlass', cylZ(0.0235, 0.0235, 0.001, 24), F.glass, 0, SY, -0.2455, 0, 0, 0, { mid: true });
  b.add(R, 'scopeBandA', torusZ(0.0247, 0.0022, Math.PI * 2, 28), F.brass, 0, SY, 0.04);
  b.add(R, 'scopeBandB', torusZ(0.0294, 0.0022, Math.PI * 2, 28), F.brass, 0, SY, -0.2);
  b.add(R, 'turretTop', cylY(0.011, 0.011, 0.016, 18), F.metal, 0, SY + 0.024, -0.065);
  b.add(R, 'turretTopCap', cylY(0.012, 0.012, 0.006, 18), F.accent, 0, SY + 0.034, -0.065);
  b.add(R, 'turretSide', cylX(0.011, 0.016, 18), F.metal, 0.024, SY, -0.065);
  b.add(R, 'turretSideCap', cylX(0.012, 0.006, 18), F.accent, 0.034, SY, -0.065);
  b.sight.position.set(0, SY, 0.09);
  b.meta.eye = 0.07;
  // Magazine.
  const mag = b.part(R, 'mag', 0, -0.048, -0.095);
  b.add(mag, 'magBody', profile([[-0.036, 0.02, 0.002], [0.038, 0.02, 0.002], [0.04, -0.062, 0.008], [-0.034, -0.062, 0.008]], 0.03, 0.007), F.metal);
  b.add(mag, 'magBase', rbox(0.034, 0.01, 0.08, 0.004), F.accent, 0, -0.064, -0.003);
  for (let i = 0; i < 3; i++) b.add(mag, 'magDot', cylX(0.003, 0.002, 10), F.cream, -0.0152, -0.012 - i * 0.014, 0.018, 0, 0, 0, { view: true });
  b.anchor('mag', mag, 0, -0.04, 0, 0, 0, 0);
  b.parts.mag = mag;
  // Bolt: rotates about the bore to lift, slides back to open.
  const bolt = b.part(R, 'bolt', 0, BY, 0.03);
  b.add(bolt, 'boltShroud', latheZ([[0.001, -0.075], [0.014, -0.075], [0.019, -0.068], [0.02, -0.035], [0.02, -0.03], [0.001, -0.03]], 18), F.dark, 0, 0, 0.015);
  b.add(bolt, 'boltBody', cylZ(0.0155, 0.0155, 0.07, 14), F.steel, 0, 0, -0.02, 0, 0, 0, { view: true });
  b.add(bolt, 'boltArm', cylX(0.0042, 0.046, 10), F.steel, 0.026, -0.006, -0.012, 0, 0, -0.35);
  b.add(bolt, 'boltKnob', sphere(0.0105, 14), F.bakelite, 0.05, -0.016, -0.012);
  b.anchor('bolt', bolt, 0.05, -0.016, -0.012);
  b.parts.bolt = bolt;
  dial(b, R, -0.0272, 0.016, -0.285, 0.0125);
  screenPanel(b, R, -0.0235, SY + 0.004, -0.065, 0.03, 0.015, 1.25, 0.3, 0.018);
  b.add(R, 'screenArm', rbox(0.01, 0.008, 0.02, 0.003), F.dark, -0.017, SY, -0.065);
  for (const z of [0.07, -0.06, -0.225]) screw(b, R, -0.0302, 0.016, z);
  b.handL.position.set(0, 0.013, -0.34);
  b.meta.supportR = 0.032;
}

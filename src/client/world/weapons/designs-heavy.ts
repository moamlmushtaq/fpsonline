// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — weapon designs II: Breaker (pump), Pulse (sidearm),
// Sunspear (charge rifle, pickup-only: gilt trim and glowing ring coils).
// Profiles are drawn as (u = forward, v = up) and extruded across X; z = −u.
// ─────────────────────────────────────────────────────────────────────────────

import { F, REGION } from './surface';
import { Build, cylX, cylY, cylZ, latheZ, profile, rbox, sphere, torusZ } from './kit';
import { dial, label, pistolGrip, screenPanel, screenPod, screw, shellY, sideDecal, slingLoop, triggerGroup, ventSlots } from './common';

// ── BREAKER — chunky pump shotgun, ceramic pump grip, side shell saddle ─────

export function buildBreaker(b: Build): void {
  const R = b.root;
  b.add(R, 'receiver', profile([[-0.085, -0.03, 0.01], [-0.085, 0.078, 0.026], [-0.06, 0.104, 0.02], [0.2, 0.104, 0.02], [0.228, 0.08, 0.02], [0.228, -0.03, 0.012], [0.19, -0.044, 0.01], [0.02, -0.044, 0.01], [-0.06, -0.04, 0.012]], 0.074, 0.024), F.shell);
  b.add(R, 'receiverBand', rbox(0.078, 0.018, 0.3, 0.008), F.metal, 0, 0.004, -0.072);
  // Loading port (underside) + ejection port (right).
  b.add(R, 'loadPort', rbox(0.036, 0.008, 0.1, 0.0035), F.rubber, 0, -0.043, -0.12, 0, 0, 0, { ao: 0.35 });
  b.add(R, 'lifter', rbox(0.028, 0.003, 0.08, 0.001), F.steel, 0, -0.0405, -0.12, 0, 0, 0, { view: true });
  b.add(R, 'ejectPort', rbox(0.006, 0.03, 0.07, 0.003), F.rubber, 0.035, 0.056, -0.1, 0, 0, 0, { ao: 0.4, mid: true });
  // Barrel with vented rib + bead.
  b.add(R, 'barrel', cylZ(0.019, 0.02, 0.37, 22), F.metal, 0, 0.072, -0.413);
  b.add(R, 'rib', rbox(0.012, 0.005, 0.36, 0.0015), F.dark, 0, 0.0975, -0.41);
  for (let i = 0; i < 8; i++) b.add(R, 'ribPost', rbox(0.006, 0.008, 0.006, 0.0015), F.dark, 0, 0.092, -0.25 - i * 0.045, 0, 0, 0, { view: true });
  // Raised sight line (ghost ring in protective ears, bead on a post): at ADS
  // the receiver drops out of the way instead of filling the lower screen.
  const S = 0.126;
  b.add(R, 'beadRampT', profile([[0.572, 0.1, 0.002], [0.6, 0.1, 0.002], [0.594, S - 0.003, 0.003], [0.584, S - 0.003, 0.003]], 0.008, 0.0025), F.dark);
  b.add(R, 'bead', sphere(0.0036, 10), F.sight, 0, S, -0.588);
  b.add(R, 'muzzleCrown', cylZ(0.0215, 0.0215, 0.025, 22), F.dark, 0, 0.072, -0.6);
  b.add(R, 'muzzleRing', torusZ(0.0215, 0.0026), F.accent, 0, 0.072, -0.588);
  b.muzzle.position.set(0, 0.072, -0.616);
  // Magazine tube, cap and clamp.
  b.add(R, 'tube', cylZ(0.0165, 0.0165, 0.32, 18), F.dark, 0, 0.026, -0.388);
  b.add(R, 'tubeCap', latheZ([[0.001, 0.548], [0.018, 0.548], [0.0195, 0.552], [0.0195, 0.57], [0.016, 0.576], [0.001, 0.576]], 20), F.metal, 0, 0.026, 0);
  b.add(R, 'clamp', rbox(0.046, 0.082, 0.014, 0.012), F.dark, 0, 0.049, -0.538);
  // Ghost-ring rear sight on the receiver.
  for (const x of [-0.0128, 0.0128]) b.add(R, 'rearEar', profile([[-0.036, 0.1, 0.003], [-0.018, 0.1, 0.003], [-0.022, S + 0.012, 0.004], [-0.032, S + 0.012, 0.004]], 0.005, 0.0018), F.dark, x, 0, 0);
  b.add(R, 'rearBaseT', rbox(0.032, 0.012, 0.022, 0.003), F.dark, 0, 0.106, 0.028);
  b.add(R, 'ringStem', rbox(0.006, S - 0.112, 0.006, 0.002), F.dark, 0, (S + 0.112) / 2 - 0.004, 0.028);
  b.add(R, 'ghostRing', torusZ(0.0075, 0.0026, Math.PI * 2, 20), F.steel, 0, S, 0.028);
  b.sight.position.set(0, S, 0.04);
  b.meta.eye = 0.18;
  // Grip (bakelite) + trigger.
  pistolGrip(b, 'brk', 0.0, -0.036, { len: 0.115, rake: 0.34, width: 0.034, fin: F.bakelite, cap: F.metal });
  triggerGroup(b, 'brk', 0.004, -0.038);
  // Chunky stock with a bakelite pad and an accent band.
  b.add(R, 'stock', profile([[-0.085, 0.09, 0.012], [-0.33, 0.07, 0.022], [-0.345, 0.05, 0.012], [-0.345, -0.07, 0.012], [-0.31, -0.082, 0.024], [-0.17, -0.044, 0.03], [-0.085, -0.03, 0.012]], 0.062, 0.02), F.shell);
  b.add(R, 'butt', profile([[-0.34, 0.072, 0.01], [-0.368, 0.07, 0.01], [-0.372, -0.08, 0.01], [-0.342, -0.084, 0.01]], 0.066, 0.014), F.bakelite);
  b.add(R, 'stockBand', rbox(0.065, 0.15, 0.014, 0.012), F.accent, 0, 0.0, 0.29, 0.13, 0, 0);
  sideDecal(b, R, 'brkBadge', REGION.badge, -0.0312, 0.035, 0.18, 0.024);
  slingLoop(b, R, 0, -0.078, 0.3);
  // Side shell saddle (left).
  b.add(R, 'saddle', rbox(0.008, 0.066, 0.14, 0.004), F.dark, -0.04, 0.034, -0.1);
  for (let i = 0; i < 5; i++) shellY(b, R, `saddle${i}`, -0.0505, 0.036, -0.05 - i * 0.025);
  for (const y of [0.052, 0.018]) b.add(R, 'saddleStrap', rbox(0.004, 0.006, 0.136, 0.002), F.rubber, -0.0615, y, -0.1);
  // Pump (slides back on every cycle; left hand rides it).
  const pump = b.part(R, 'pump', 0, 0.026, -0.37);
  b.add(pump, 'pumpBody', latheZ([[0.018, -0.078], [0.027, -0.075], [0.032, -0.06], [0.033, 0.06], [0.029, 0.074], [0.018, 0.078]], 28), F.shell);
  for (let i = 0; i < 4; i++) b.add(pump, 'pumpGroove', torusZ(0.0328, 0.0026, Math.PI * 2, 28), F.rubber, 0, 0, 0.036 - i * 0.024, 0, 0, 0, { view: true });
  for (const x of [-0.019, 0.019]) b.add(pump, 'actionBar', cylZ(0.0026, 0.0026, 0.17, 8), F.steel, x, -0.004, 0.12);
  b.parts.pump = pump;
  pump.add(b.handL);
  b.handL.position.set(0, 0, 0.0);
  b.meta.supportR = 0.034;
  // Loose shell used by the shell-by-shell reload (hidden at rest).
  const shell = b.part(R, 'shell', 0, -0.05, -0.12, 0, 0, 0, true);
  shellY(b, shell, 'loose', 0, 0, 0, F.hull, -Math.PI / 2);
  b.anchor('shell', shell, 0, -0.02, 0.0);
  b.parts.shell = shell;
  // Dial, screen, label, screws.
  dial(b, R, -0.0372, 0.056, -0.196, 0.0175);
  screenPanel(b, R, -0.0335, 0.089, -0.03, 0.032, 0.016, 1.0, 0.3);
  label(b, R, -0.0372, 0.075, -0.1, 0.07);
  for (const [z, y] of [[0.07, 0.02], [-0.205, 0.07], [-0.205, 0.0]] as const) screw(b, R, -0.0372, y, z);
}

// ── PULSE — compact sidearm with a swing-out glowing capacitor cartridge ────

export function buildPulse(b: Build): void {
  const R = b.root;
  // Top strap / slide (cycles back on fire).
  const slide = b.part(R, 'slide', 0, 0, 0);
  b.add(slide, 'slideBody', profile([[-0.045, 0.062, 0.004], [-0.045, 0.094, 0.01], [-0.03, 0.102, 0.008], [0.19, 0.102, 0.01], [0.2, 0.09, 0.008], [0.2, 0.062, 0.004]], 0.03, 0.008), F.metal);
  for (let i = 0; i < 5; i++) b.add(slide, 'serration', rbox(0.031, 0.024, 0.0025, 0.001), F.dark, 0, 0.082, 0.04 - i * 0.006, 0, 0, 0, { view: true });
  for (const x of [-0.0078, 0.0078]) b.add(slide, 'rearSight', rbox(0.0085, 0.011, 0.008, 0.0018), F.dark, x, 0.1065, 0.036);
  const S = 0.1085;
  for (const x of [-0.0078, 0.0078]) b.add(slide, 'rearDot', sphere(0.0015, 8), F.sight, x, S - 0.001, 0.0402, 0, 0, 0, { view: true });
  b.add(slide, 'frontSight', rbox(0.0045, 0.01, 0.006, 0.0015), F.dark, 0, 0.106, -0.19);
  b.add(slide, 'frontDot', sphere(0.0017, 8), F.sight, 0, S, -0.187);
  screenPod(b, slide, 0, 0.08, 0.049, 0.024, 0.014, 0, 0, 0, 0.012);
  b.parts.slide = slide;
  b.sight.position.set(0, S, 0.04);
  b.meta.eye = 0.3;
  // Frame: dark grip frame behind the capacitor window, ceramic shroud in front.
  b.add(R, 'frameRear', profile([[-0.04, 0.066, 0.006], [0.036, 0.066, 0.002], [0.036, 0.004, 0.004], [-0.035, 0.012, 0.012]], 0.032, 0.009), F.dark);
  b.add(R, 'frameBridge', profile([[0.03, 0.019, 0.002], [0.106, 0.019, 0.002], [0.1, 0.006, 0.004], [0.03, 0.004, 0.004]], 0.03, 0.006), F.dark);
  b.add(R, 'frameFront', profile([[0.102, 0.066, 0.002], [0.198, 0.066, 0.008], [0.198, 0.036, 0.012], [0.12, 0.03, 0.01], [0.102, 0.016, 0.006]], 0.034, 0.011), F.shell);
  b.add(R, 'frameStripe', rbox(0.035, 0.005, 0.08, 0.002), F.accent, 0, 0.052, -0.15);
  b.add(R, 'frameRail', rbox(0.026, 0.006, 0.07, 0.002), F.dark, 0, 0.03, -0.155, 0, 0, 0, { mid: true });
  // Barrel emitter with copper coils.
  b.add(R, 'barrel', cylZ(0.0085, 0.0085, 0.03, 14), F.dark, 0, 0.078, -0.205);
  for (let i = 0; i < 2; i++) b.add(R, 'emitterCoil', torusZ(0.0105, 0.0022, Math.PI * 2, 18), F.brass, 0, 0.078, -0.204 - i * 0.008);
  b.add(R, 'emitterGlow', cylZ(0.0062, 0.0062, 0.003, 14), F.g1, 0, 0.078, -0.219);
  b.muzzle.position.set(0, 0.078, -0.222);
  // Capacitor cartridge on a crane that swings out to the left.
  const crane = b.part(R, 'mag', -0.012, 0.018, -0.07);
  const cyl = b.node(crane, 'cylinder', 0.012, 0.024, 0);
  b.add(cyl, 'cylCore', cylZ(0.0175, 0.0175, 0.064, 16), F.dark);
  for (let i = 0; i < 6; i++) b.add(cyl, 'cylCoil', torusZ(0.0192, 0.0026, Math.PI * 2, 22), F.brass, 0, 0, 0.026 - i * 0.0104, 0, 0, 0, i % 2 ? { view: true } : { mid: true });
  b.add(cyl, 'cylGlow', cylZ(0.0186, 0.0186, 0.05, 18), F.g0);
  for (const z of [0.033, -0.033]) b.add(cyl, 'cylCap', cylZ(0.0215, 0.0215, 0.005, 20), F.metal, 0, 0, z);
  b.add(cyl, 'cylPin', cylZ(0.004, 0.004, 0.074, 8), F.steel, 0, 0, 0);
  b.add(crane, 'craneArm', rbox(0.006, 0.02, 0.06, 0.002), F.dark, 0.002, 0.008, 0);
  b.anchor('mag', cyl, -0.012, -0.004, 0.0, 0, 0, 0);
  b.parts.mag = crane;
  b.parts.coil = cyl;
  // Grip + trigger + lanyard ring.
  pistolGrip(b, 'pls', 0.018, 0.006, { len: 0.104, rake: 0.3, width: 0.03, depth: 0.05 });
  triggerGroup(b, 'pls', 0.024, 0.006, 0.066);
  b.add(R, 'lanyard', torusZ(0.0055, 0.0015, Math.PI * 2, 12), F.steel, 0, -0.105, 0.075, 0, Math.PI / 2, 0, { view: true });
  dial(b, R, -0.0172, 0.05, -0.15, 0.011);
  label(b, R, -0.0172, 0.044, 0.002, 0.046);
  screw(b, R, -0.0172, 0.028, 0.02, 0, 0.0026);
  screw(b, R, -0.0172, 0.05, -0.115, 0, 0.0026);
  // Support hand cups the firing hand.
  b.handL.position.set(-0.004, b.handR.position.y - 0.012, b.handR.position.z - 0.006);
  b.handL.rotation.set(b.handR.rotation.x, 0, 0);
  b.meta.supportGrip = 1;
  b.meta.supportR = 0.026;
}

// ── SUNSPEAR — elegant charge rifle: gilt trim, ring coils, lens, vent fins ─

export function buildSunspear(b: Build): void {
  const R = b.root;
  b.add(R, 'body', profile([[-0.1, -0.028, 0.014], [-0.1, 0.086, 0.034], [-0.066, 0.12, 0.03], [0.24, 0.118, 0.05], [0.33, 0.085, 0.04], [0.355, 0.055, 0.02], [0.35, 0.02, 0.02], [0.28, -0.03, 0.04], [0.1, -0.036, 0.02], [0.0, -0.036, 0.01]], 0.082, 0.03), F.shell);
  b.add(R, 'belly', profile([[-0.09, -0.018, 0.004], [0.26, -0.018, 0.004], [0.245, -0.042, 0.01], [-0.08, -0.042, 0.01]], 0.07, 0.012), F.dark);
  for (const y of [0.04, 0.062]) b.add(R, `giltTrim${y}`, rbox(0.0836, y === 0.04 ? 0.005 : 0.0024, 0.34, 0.0012), F.gold, 0, y, -0.13);
  // Stock sweeping into a gilt butt cap.
  b.add(R, 'stock', profile([[-0.1, 0.1, 0.014], [-0.29, 0.086, 0.024], [-0.305, 0.064, 0.012], [-0.305, -0.05, 0.012], [-0.27, -0.062, 0.026], [-0.16, -0.03, 0.03], [-0.1, -0.02, 0.012]], 0.066, 0.022), F.shell);
  b.add(R, 'buttCap', profile([[-0.3, 0.088, 0.008], [-0.322, 0.084, 0.01], [-0.326, -0.056, 0.01], [-0.302, -0.06, 0.008]], 0.07, 0.014), F.gold);
  sideDecal(b, R, 'sunBadge', REGION.badge, -0.0335, 0.03, 0.2, 0.03);
  // Exposed coil section.
  const CY = 0.055;
  b.add(R, 'core', cylZ(0.012, 0.015, 0.34, 16), F.metal, 0, CY, -0.51);
  for (let k = 0; k < 3; k++) {
    const a = Math.PI / 2 + (k * Math.PI * 2) / 3;
    b.add(R, 'coilRail', cylZ(0.0032, 0.0032, 0.3, 8), F.gold, Math.cos(a) * 0.041, CY + Math.sin(a) * 0.041, -0.5);
  }
  const coil = b.part(R, 'coil', 0, CY, 0);
  const radii = [0.052, 0.047, 0.042, 0.037];
  radii.forEach((r, i) => {
    const z = -0.4 - i * 0.07;
    b.add(coil, `coilRing${i}`, torusZ(r, 0.0078, Math.PI * 2, 32), F.gold, 0, 0, z);
    b.add(coil, `coilGlow${i}`, torusZ(r - 0.0095, 0.0042, Math.PI * 2, 32), F.g0 + i, 0, 0, z);
  });
  b.parts.coil = coil;
  // Muzzle lens.
  b.add(R, 'lensHousing', cylZ(0.028, 0.031, 0.024, 26), F.dark, 0, CY, -0.678);
  b.add(R, 'lensBezel', torusZ(0.029, 0.0055, Math.PI * 2, 30), F.gold, 0, CY, -0.69);
  b.add(R, 'lens', latheZ([[0.027, 0.69], [0.022, 0.696], [0.012, 0.7], [0.001, 0.701]], 26), F.g4, 0, CY, 0);
  b.muzzle.position.set(0, CY, -0.705);
  // Sight rail, gilt ring sight, front post.
  const S = 0.165;
  // Gilt spine (pickup-only weapon: gold reads as special).
  b.add(R, 'sightRail', rbox(0.016, 0.012, 0.3, 0.004), F.gold, 0, 0.124, -0.07);
  b.add(R, 'ringPost', rbox(0.012, 0.03, 0.014, 0.004), F.dark, 0, 0.14, 0.055);
  b.add(R, 'ringSight', torusZ(0.0155, 0.0028, Math.PI * 2, 28), F.gold, 0, S, 0.055);
  b.add(R, 'frontPost', rbox(0.004, 0.032, 0.006, 0.0015), F.dark, 0, 0.146, -0.205);
  b.add(R, 'frontDot', sphere(0.0019, 8), F.sight, 0, S, -0.205);
  b.sight.position.set(0, S, 0.06);
  b.meta.eye = 0.19;
  // Heat-vent fins either side of the rail (open after a shot).
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const z = -0.03 - i * 0.055;
      b.add(R, 'ventSlot', rbox(0.02, 0.004, 0.042, 0.0015), F.rubber, side * 0.02, 0.1185, z - 0.022, 0, 0, 0, { ao: 0.4, mid: true });
      const v = b.part(R, `vent${side > 0 ? 'R' : 'L'}${i}`, side * 0.02, 0.121, z);
      b.add(v, 'ventFin', rbox(0.021, 0.003, 0.044, 0.0012), F.metal, 0, 0, -0.022);
      b.add(v, 'ventEdge', rbox(0.021, 0.0035, 0.004, 0.0012), F.gold, 0, 0.0004, -0.043, 0, 0, 0, { mid: true });
      b.vents.push(v);
    }
  }
  // Grip + trigger.
  pistolGrip(b, 'sun', 0.0, -0.034, { len: 0.12, rake: 0.3, cap: F.gold });
  triggerGroup(b, 'sun', 0.004, -0.036, 0.072, F.gold);
  dial(b, R, -0.0412, 0.058, -0.225, 0.02, -Math.PI / 2, true, F.gold);
  screenPanel(b, R, -0.0375, 0.1, -0.2, 0.032, 0.016, 1.0, 0.3);
  label(b, R, -0.0412, 0.082, -0.07, 0.07);
  ventSlots(b, R, 'sunVent', -0.041, 0.022, -0.26, 2, 0.012, 0.06);
  for (const [z, y] of [[0.06, 0.012], [-0.14, 0.012], [0.06, 0.09]] as const) screw(b, R, -0.0412, y, z);
  slingLoop(b, R, 0, -0.062, 0.26);
  // Capacitor front grip (vertical) for the support hand.
  b.add(R, 'frontGrip', profile([[0.228, -0.028, 0.004], [0.276, -0.028, 0.004], [0.28, -0.075, 0.02], [0.27, -0.118, 0.012], [0.232, -0.118, 0.012], [0.226, -0.07, 0.02]], 0.036, 0.015), F.shell);
  b.add(R, 'frontGripCap', rbox(0.04, 0.012, 0.05, 0.005), F.gold, 0, -0.12, -0.252);
  for (let i = 0; i < 3; i++) b.add(R, 'frontGripRing', rbox(0.038, 0.004, 0.046, 0.002), F.rubber, 0, -0.058 - i * 0.018, -0.252, 0, 0, 0, { view: true });
  b.handL.position.set(0, -0.078, -0.252);
  b.meta.supportGrip = 1;
  b.meta.supportR = 0.021;
}

// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Gantry industrial storytelling (art pass 2): the site was
// abandoned mid-shift.
//  • Service vehicles (a yard forklift at the docks, the crew pickup) and a
//    drum pallet against the compressor house — the only new collision
//    (GANTRY_PROPS, mirrored; the Bloom's copies are overgrown).
//  • Pipe racks with valves, handwheels and gauges on the compressor houses
//    and the transit shed, a pipe bridge over the west cross-connector, fuel
//    hoses snaking from the tanker, scaffolding up the LOX spheres, a
//    painters' cradle still hanging on the hangar facade.
//  • 1970s enamel safety plates, notice boards, lockers, the crew's break
//    benches with mugs, lunch boxes and thermos flasks in both spawns and in
//    mission control.
//  • Glowing chartreuse / pale-gold fungi in the shaded corners (west and
//    north faces — the sunset comes from the sea).
// ─────────────────────────────────────────────────────────────────────────────

import { GANTRY_PROPS } from '../../../../shared/maps/gantry';
import { ENV } from '../../../engine/palette';
import { moss } from './pad';
import { box, cyl, cylAB, DecorKit } from './kit';
import {
  barrel,
  barrelGroup,
  crate,
  floorDecal,
  forklift,
  fungi,
  gauge,
  handwheel,
  hardHat,
  hose,
  lockers,
  lunchbox,
  mug,
  pallet3,
  pickup,
  pipeBridge,
  plate,
  scaffold,
  thermos,
  toolCart,
  wallCabinet,
  wallDecal,
  wallPipes,
  workbench,
} from './props';

const STEEL_DARK = ENV.metalDark;

export function buildIndustry(kit: DecorKit, rnd: () => number, decor: number): void {
  const P = GANTRY_PROPS;
  for (const s of [-1, 1] as const) {
    const bloom = s > 0;
    kit.section = 'ind.veh';
    // ── Service vehicles + drums (collision: GANTRY_PROPS, mirrored) ────────
    {
      const f = P.forklift;
      const cz = (s * (f.z0 + f.z1)) / 2;
      forklift(kit, (f.x0 + f.x1) / 2, cz, s < 0 ? Math.PI : 0, bloom ? '#a3ad8f' : ENV.pastelYellow, bloom, rnd);
      floorDecal(kit, 'oil', (f.x0 + f.x1) / 2 + 0.2, 0.001, cz + s * 0.5, 1.8, 1.4, rnd() * 3);
      const p = P.pickup;
      pickup(kit, (p.x0 + p.x1) / 2, s * 49.0, s < 0 ? 0 : Math.PI, bloom ? '#b9bfa6' : ENV.pastelBlue, rnd, bloom);
      floorDecal(kit, 'oil', (p.x0 + p.x1) / 2, 0.001, (s * (p.z0 + p.z1)) / 2 + s * 1.4, 2.2, 1.6, rnd() * 3);
      const d = P.drums;
      barrelGroup(kit, rnd, -32.62, s * 33.72, 0, 4);
      crate(kit, -31.08, 0, s * 33.7, 0.95, 0.95, 0.05);
      if (!bloom) barrel(kit, -30.95, 0.95, s * 33.75, ENV.terracottaFaded, 1, false, 0.2);
      else moss(kit, rnd, -31.1, 0.95, s * 33.7, 0.35, Math.round(6 * decor));
      floorDecal(kit, 'oil', (d.x0 + d.x1) / 2, 0.001, s * 34.6, 2.6, 1.3, 0);
    }

    kit.section = 'ind.dockprops';
    // ── Docks: pallets, coiled hoses, a tool cart by the transit shed ───────
    pallet3(kit, 47.5, s * 44.5, 0.2);
    pallet3(kit, 47.6, s * 44.6, 0.35, 1.2, 1.0, 0.14);
    hose(kit, [
      [44.8, s * 47.5],
      [45.6, s * 46.2],
      [47.2, s * 46.6],
      [48.4, s * 45.9],
      [48.1, s * 47.1],
    ]);
    toolCart(kit, 32.75, s * 9.3, -Math.PI / 2, bloom ? '#a3ad8f' : '#9fb4be');
    // Stacked drums and pallets against the yard fence.
    for (const x of [24.5, 52]) {
      barrelGroup(kit, rnd, x, s * 59.2, 0, kit.low ? 2 : 4);
      if (decor > 0.5) {
        pallet3(kit, x, s * 59.2, 0, 1.25, 1.25, 1.02);
        for (const dx of [-0.31, 0.31]) barrel(kit, x + dx, 1.16, s * 59.2 - s * 0.3, BARRELS[Math.floor(rnd() * BARRELS.length)], rnd() * 6, false, rnd());
      }
    }

    kit.section = 'ind.pipes';
    // ── Pipe racks on the compressor houses (west faces) and the transit shed ─
    wallPipes(kit, rnd, 'x-', -34.12, s * 20.4, s * 31.6, 2.85);
    wallPipes(kit, rnd, s < 0 ? 'z-' : 'z+', s * 10.02, 22.8, 31.4, 3.0, ['#9fb4be', ENV.bone]);
    // Pipe bridge over the west cross-connector (transfer station ↔ compressor house).
    pipeBridge(kit, -29.4, s * 11.0, -29.4, s * 19.2, 6.0, [ENV.bone, '#9fa98c', ENV.terracottaFaded]);
    for (const dx of [-0.75, 0.75]) kit.add('metal', box(-29.4 + dx - 0.09, 5.65, s * 19.3 - 0.09, -29.4 + dx + 0.09, 6.0, s * 19.3 + 0.09), STEEL_DARK);
    handwheel(kit, -29.4, 6.75, s * 15, 0, 0, 0.2);

    kit.section = 'ind.hoses';
    // ── Fuel hose from the tanker to a ground valve pit ─────────────────────
    hose(kit, [
      [-29.9, s * 51.6],
      [-31.2, s * 51.2],
      [-31.6, s * 49.6],
      [-32.8, s * 48.8],
      [-33.6, s * 47.6],
    ], 0.07, '#7a5a48');
    kit.add('metal', box(-34.3, 0, s * 47.0, -33.1, 0.03, s * 47.9 + s * 0.1), '#5c574f', { flat: true });
    handwheel(kit, -33.7, 0.22, s * 47.5, 0, 0, 0.16);
    kit.add('metal', cylAB(-33.7, 0, s * 47.5, -33.7, 0.2, s * 47.5, 0.05, 0.05, 6), STEEL_DARK, { flat: true });
    // Nitrogen hose off the bottle rack, coiled on the apron.
    hose(kit, [
      [-21.65, s * 11.4],
      [-22.4, s * 12.6],
      [-23.6, s * 13.0],
      [-24.2, s * 12.1],
      [-23.4, s * 11.6],
    ], 0.05, '#5a4f45');

    kit.section = 'ind.scaffold';
    // ── Scaffolding up the LOX sphere (inside its collision box) ───────────
    scaffold(kit, -48.95, s * 28.62, -47.62, s * 29.95, 7.05, 3.05);
    if (bloom) moss(kit, rnd, -48.3, 3.06, s * 29.3, 0.4, Math.round(6 * decor));

    kit.section = 'ind.plates';
    // ── Enamel safety plates (1970s) ────────────────────────────────────────
    plate(kit, 'signDanger', -23.84, 2.0, s * 23.0, 0.9, 0.45, 1, 0);
    plate(kit, 'signNoSmoke', -47.45, 1.9, s * 31.5, 0.9, 0.45, 1, 0);
    plate(kit, 'signFuel', -34.13, 1.8, s * 8.2, 0.9, 0.45, -1, 0);
    plate(kit, 'signHardHat', s < 0 ? 10.5 : -10.5, 2.2, s * 45.97, 0.9, 0.45, 0, -s);
    plate(kit, 'signTunnel', -13.1, 1.9, s * 17.14, 0.8, 0.4, 0, s);
    plate(kit, 'signCrawler', 7.2, 2.0, s * 17.14, 0.9, 0.45, 0, s);
    plate(kit, 'signDanger', 21.98, 2.0, s * 8.6, 0.9, 0.45, -1, 0);
    plate(kit, 'signNoSmoke', -21.67, 1.0, s * 11, 0.7, 0.35, -1, 0);

    // ── Wall utility cabinets (vertical detail along the lanes) ─────────────
    wallCabinet(kit, -23.95, s * 5.0, 1, 0, 6.7, bloom ? '#9fa98c' : '#b9cfda');
    wallCabinet(kit, -23.95, s * 20.6, 1, 0, 5.3);
    wallCabinet(kit, 21.95, s * 3.3, -1, 0, 6.95, '#a3ad8f');
    wallCabinet(kit, s < 0 ? 8.0 : -7.6, s * 45.97, 0, -s, 12);
    wallCabinet(kit, 11.6, s * 17.12, 0, s, 3.25, '#8e9aa0');

    // ── Gauges on the pump skids and the bottle racks ───────────────────────
    gauge(kit, -43.12, 1.0, s * 8.5 - s * 0.45, 1, 0, 0.1);
    gauge(kit, -21.67, 2.15, s * 11.5, -1, 0, 0.1);

    kit.section = 'ind.fungi';
    // ── Shaded corners: glowing fungi (north faces / west faces) ────────────
    const n = Math.round((bloom ? 12 : 6) * decor);
    fungi(kit, rnd, -34.5, 0, s * 21.5, 0.45, n); // compressor house, west foot
    fungi(kit, rnd, 21.7, 0, s * 4.4, 0.4, n); // transit shed, west foot
    fungi(kit, rnd, -35.2, 0, s * 9.2, 0.5, n); // transfer station, west foot
    fungi(kit, rnd, -64.0, CW_Y, s * 9, 0.3, Math.round(4 * decor)); // under the catwalk lip (deck)
    if (bloom) {
      fungi(kit, rnd, -23.6, 0, 33.4, 0.5, n); // compressor house north corner
      fungi(kit, rnd, 22.3, 0, 30.4, 0.5, n); // container stack north foot
      fungi(kit, rnd, 6.2, 0, 35.3, 0.5, n); // crawler north
      fungi(kit, rnd, -32.0, 0.15, 11.02, 0.6, n, 0, 1); // transfer station north wall (low)
      fungi(kit, rnd, 12, 0.15, 41.02, 0.6, n, 0, 1); // corner wall, shaded north face
    } else {
      fungi(kit, rnd, 22.3, 0, -17.6, 0.4, Math.round(5 * decor)); // container stack north foot
      fungi(kit, rnd, -23.6, 0, -18.6, 0.4, Math.round(5 * decor));
    }
  }

  kit.section = 'ind.crewH';
  // ════ HALCYON hangar: the crew's break corner, tools, notice board ═══════
  workbench(kit, rnd, -17.64, -58.3, Math.PI / 2, 2.0);
  plate(kit, 'notice', -17.95, 1.75, -58.3, 1.7, 0.85, 1, 0, false);
  plate(kit, 'signBreak', -17.95, 2.65, -56.8, 0.8, 0.4, 1, 0);
  hardHat(kit, -17.6, 1.0, -57.55);
  toolCart(kit, 17.42, -58.7, -Math.PI / 2);
  toolCart(kit, 17.42, -49.2, -Math.PI / 2, ENV.terracottaFaded);
  plate(kit, 'signHardHat', 17.95, 2.2, -49.2, 0.9, 0.45, -1, 0);
  // Painters' cradle hanging on the facade (left mid-job: the emblem half re-painted).
  {
    const y = 12.9;
    kit.add('metal', box(-14.6, y, -45.55, -7.8, y + 0.08, -44.75), '#8a8680');
    for (const yy of [y + 0.55, y + 1.05]) kit.add('metal', box(-14.6, yy, -44.8, -7.8, yy + 0.05, -44.75), '#8a8680', { flat: true });
    for (const x of [-14.5, -7.9]) {
      kit.add('metal', box(x - 0.04, y, -44.82, x + 0.04, y + 1.1, -44.74), STEEL_DARK, { flat: true });
      kit.add('metal', cylAB(x, y + 1.1, -45.15, x, 22.6, -45.15, 0.015, 0.015, 3), STEEL_DARK, { flat: true });
      kit.add('metal', box(x - 0.3, 22.6, -45.9, x + 0.3, 22.9, -44.6), STEEL_DARK, { flat: true });
    }
    kit.add('paint', cyl(-13.2, y + 0.08, -45.1, 0.16, 0.32, 10), ENV.bone);
    kit.add('paint', cyl(-12.7, y + 0.08, -45.2, 0.14, 0.28, 10), ENV.terracottaFaded);
    kit.add('paint', box(-12.2, y + 0.08, -45.4, -11.4, y + 0.1, -45.0), '#e6dcc4', { flat: true });
    wallDecal(kit, 'drip', -12.6, 11.2, -45.97, 0.6, 2.4, 0, 1, '#efe6d6');
  }

  kit.section = 'ind.crewB';
  // ════ BLOOM station: the same benches, reclaimed ═════════════════════════
  workbench(kit, rnd, 17.64, 58.3, -Math.PI / 2, 2.0);
  moss(kit, rnd, 17.6, 0.9, 57.8, 0.45, Math.round(8 * decor));
  plate(kit, 'notice', 17.95, 1.75, 58.3, 1.7, 0.85, -1, 0, false);
  plate(kit, 'signBreak', 17.95, 2.65, 56.8, 0.8, 0.4, -1, 0);
  toolCart(kit, -17.42, 58.7, Math.PI / 2, '#a3ad8f');
  lockers(kit, rnd, 5.6, 11.4, 60.17, 'z-', ['#a3ad8f', '#9fa98c', '#b9bfa6'], true);
  lockers(kit, rnd, -8.0, -4.6, 60.17, 'z-', ['#a3ad8f', '#b9bfa6'], true);
  fungi(kit, rnd, 9, 0, 59.4, 0.6, Math.round(10 * decor));
  fungi(kit, rnd, -17.5, 0.1, 50.5, 0.6, Math.round(8 * decor), 1, 0);

  kit.section = 'ind.bunker';
  // ════ Mission control: lockers, notice board, more of the lunch break ═════
  lockers(kit, rnd, -63.9, -61.6, -5.55, 'z+', ['#9fb4be', '#b9cfda']);
  lockers(kit, rnd, -63.9, -61.6, 5.55, 'z-', ['#9fb4be', '#b9cfda']);
  plate(kit, 'notice', -60.6, 1.7, 5.53, 1.4, 0.7, 0, -1, false);
  plate(kit, 'signBreak', -60.4, 2.55, -5.53, 0.8, 0.4, 0, 1);
  mug(kit, -59.7, 1.0, -0.6, ENV.pastelYellow, 0.4);
  mug(kit, -59.55, 1.0, 1.75, ENV.bone, 2.1);
  lunchbox(kit, -59.65, 1.0, -1.9, Math.PI / 2 + 0.2, ENV.pastelYellow, true);
  thermos(kit, -59.5, 1.0, 3.2, ENV.sage);
  hardHat(kit, -62.4, 0.11, 4.6, ENV.bone);
  fungi(kit, rnd, -63.6, 0, 5.0 - 0.4, 0.35, Math.round(6 * decor));

  // A couple of drums knocked over in the yards (story: the evacuation).
  barrel(kit, -40.5, 0, -46.2, ENV.terracottaFaded, 0.7, true, 0.7);
  barrel(kit, 37.5, 0, 49.6, ENV.sage, 2.2, true, 0.5);
}

const BARRELS = [ENV.terracottaFaded, ENV.sage, ENV.pastelBlue, ENV.bone, '#8e9aa0'];
/** Catwalk deck height at the lip (fungi under it on the ground side). */
const CW_Y = 0;

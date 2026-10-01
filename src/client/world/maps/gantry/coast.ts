// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Gantry shoreline (art pass 2): boulders along the seawall
// foot with foam lace around them, tide pools and a wrecked dinghy on the two
// shingle beaches, a rusted cage buoy beached and another bobbing offshore,
// salt-crusted bollards and salt bloom on the seawall, gulls perched on piles,
// bollards and the crane, and a sunset glitter path on the sea (one additive
// shader quad, glints twinkle in the shader — zero CPU per frame).
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { GANTRY_PIER_Y as PY } from '../../../../shared/maps/gantry';
import type { QualitySettings } from '../../../contracts';
import { ENV } from '../../../engine/palette';
import { cyl, DecorKit, floorQuad, GREENS, quad, sphere, trs } from './kit';
import { uvD } from './decals';
import { buoyGeo, floorDecal, perchedGull, rock, wallDecal, wreckedDinghy } from './props';

const WATER_Y = -3;

const GLITTER_VERT = /* glsl */ `
varying vec3 vW;
varying float vFogD;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vFogD = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const GLITTER_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uColor;
uniform vec3 fogColor;
uniform float fogDensity;
varying vec3 vW;
varying float vFogD;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  // Mirror the view ray in a gently rippled sea and compare with the sun.
  vec3 v = normalize(vW - cameraPosition);
  vec3 r = vec3(v.x, -v.y, v.z);
  float sd = max(dot(r, uSunDir), 0.0);
  float lobe = pow(sd, 18.0) * 0.8 + pow(sd, 90.0) * 1.6;
  if (lobe < 0.004) discard;
  // Glints: painterly dabs on a cell grid stretched across the path, each
  // twinkling on its own phase. Cells grow with distance so they never shimmer.
  float scale = 0.35 + vFogD * 0.01;
  vec2 q = vec2(vW.x * 0.45, vW.z * 1.4) / scale;
  vec2 c = floor(q);
  vec2 f = fract(q) - 0.5;
  float id = h2(c);
  vec2 o = vec2(h2(c + 3.1), h2(c + 7.7)) - 0.5;
  float d = length((f - o * 0.6) * vec2(1.0, 2.2));
  float tw = 0.5 + 0.5 * sin(uTime * (2.0 + id * 4.0) + id * 40.0);
  float g = smoothstep(0.28, 0.0, d) * step(0.45, id) * tw * tw;
  // Near the shore the water shader's own sparkle carries; the path builds up
  // from ~20 m out to the horizon.
  float a = lobe * (g * 1.8 + 0.05) * smoothstep(14.0, 50.0, vFogD);
  float fog = 1.0 - exp(-fogDensity * fogDensity * vFogD * vFogD * 0.35);
  gl_FragColor = vec4(mix(uColor, fogColor, fog) * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface CoastAnim {
  update(t: number): void;
  dispose(): void;
}

export function buildCoast(kit: DecorKit, rnd: () => number, root: THREE.Group, quality: QualitySettings, decor: number, sunDir: THREE.Vector3): CoastAnim {
  // ── Boulders along the seawall foot, foam lace around them ────────────────
  const foamRing = (x: number, z: number, r: number): void => {
    kit.add('foam', floorQuad(x, WATER_Y + 0.035, z, r * 2.4, r * 2.1, uvD('foam', 2), rnd() * 6), '#ffffff', { flat: true, k: 0.95 });
  };
  for (let z = -58; z <= 58; z += 5.5 + rnd() * 3) {
    if (z > 14 && z < 29) continue; // the moored boat
    if (rnd() > 0.45 + 0.4 * decor) continue;
    const n = 1 + Math.floor(rnd() * (2 + 2 * decor));
    const cx = 65.6 + rnd() * 2.6;
    for (let i = 0; i < n; i++) {
      const s = 0.45 + rnd() * 0.9;
      const x = cx + (rnd() - 0.3) * 2.2;
      const zz = z + (rnd() - 0.5) * 2.4;
      rock(kit, rnd, x, WATER_Y - s * 0.25, zz, s, rnd() < 0.5 ? ENV.rock : '#958a80');
      foamRing(x, zz, s * 1.1);
    }
    // Weed and barnacle line on the larger stones.
    if (rnd() < 0.5) kit.add('foliage', sphere(cx, WATER_Y + 0.02, z, 0.5, 6, 3, 0.15), GREENS[0], { flat: true, k: 0.6 });
  }

  // ── Shingle beaches: the south one exists (docks.ts); a matching rocky cove
  // north, overgrown by the Bloom (glowing algae in the tide pools). ────────
  kit.add('sand', new THREE.SphereGeometry(1, kit.low ? 10 : 16, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(6.4, 1.1, 7.4).translate(70.4, -3.5, 57.4), '#c8b393', { shade: (_x, y) => 0.8 + 0.2 * Math.min(1, (y + 3.5) / 1.1) });
  for (const [x, z, s] of [
    [74.6, 52.4, 1.8],
    [66.4, 61.5, 1.3],
    [76.8, 58.8, 1.2],
    [69.1, 50.6, 0.9],
  ] as [number, number, number][]) {
    rock(kit, rnd, x, -3.1, z, s, '#958a80');
    foamRing(x, z, s * 1.15);
  }
  const tidePool = (x: number, y: number, z: number, r: number, glow: boolean): void => {
    const g = new THREE.CircleGeometry(r, 14);
    g.scale(1, 0.75, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(x, y + 0.02, z);
    kit.add('gloss', g, '#4e5f64', { flat: true });
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + rnd() * 0.4;
      rock(kit, rnd, x + Math.cos(a) * r * 1.05, y + 0.02, z + Math.sin(a) * r * 0.8, 0.14 + rnd() * 0.12, '#8b8580');
    }
    floorDecal(kit, 'salt', x, y + 0.01, z, r * 3.2, r * 2.8, rnd() * 3);
    if (glow) {
      for (let k = 0; k < 5; k++) kit.add('glow', sphere(x + (rnd() - 0.5) * r, y + 0.03, z + (rnd() - 0.5) * r * 0.6, 0.05 + rnd() * 0.04, 5, 3, 0.5), rnd() < 0.7 ? ENV.glowChartreuse : ENV.glowGold, { flat: true, k: 2.2 });
      kit.add('pool', floorQuad(x, y + 0.05, z, r * 3, r * 2.5), ENV.glowChartreuse, { flat: true, k: 0.25 });
    } else {
      for (let k = 0; k < 4; k++) kit.add('paint', sphere(x + (rnd() - 0.5) * r * 1.4, y + 0.02, z + (rnd() - 0.5) * r, 0.04, 5, 3, 0.5), ENV.bone, { flat: true });
    }
  };
  tidePool(68.2, -2.42, -60.8, 0.8, false);
  tidePool(71.6, -2.4, -52.6, 0.6, false);
  tidePool(68.6, -2.42, 55.2, 0.75, true);
  tidePool(72.2, -2.45, 59.4, 0.55, true);
  wreckedDinghy(kit, 72.8, -2.9, 54.6, 2.4, '#9fb4be');
  // Driftwood.
  for (const [x, z, a] of [
    [66.6, -51.4, 0.4],
    [70.4, 61.2, 1.9],
  ] as [number, number, number][]) kit.add('wood', cyl(0, 0, 0, 0.08, 2.4, 6).rotateZ(Math.PI / 2).rotateY(a).translate(x, -2.35, z), '#b8a68e', { flat: true });

  // ── Buoys: one beached on its side, one bobbing offshore (animated) ───────
  buoyGeo(kit, trs(74.4, -2.25, -56.4, 0.6).multiply(new THREE.Matrix4().makeRotationZ(1.25)));
  const buoy = new THREE.Group();
  buoy.position.set(80, WATER_Y, -18);
  const bk = new DecorKit(kit.ctx);
  bk.decalTexture = kit.decalTexture;
  buoyGeo(bk, new THREE.Matrix4());
  bk.add('foam', floorQuad(0, 0.04, 0, 3.2, 3.2, uvD('foam', 2)), '#ffffff', { flat: true, k: 0.9 });
  bk.build(buoy);
  root.add(buoy);

  // ── Salt-crusted bollards, salt bloom and rust on the seawall ─────────────
  for (let z = -57; z <= 57; z += 3) {
    if ((z + 57) % 9 !== 0) continue;
    kit.add('paint', cyl(63.85, PY, z, 0.34, 0.08, 10, 0.32), '#e3ddd1', { flat: true });
    kit.add('paint', cyl(63.85, PY + 0.55, z, 0.37, 0.05, 10), '#d9d3c6', { flat: true });
    floorDecal(kit, 'salt', 63.85, PY + 0.01, z, 1.3, 1.3, z);
    wallDecal(kit, 'drip', 64.6, -2.1, z + 0.6, 0.6, 1.6, 1, 0, '#ffffff', 0.9);
  }
  for (let z = -56; z <= 56; z += 7 + rnd() * 5) wallDecal(kit, 'salt', 64.6, -2.6 + rnd() * 0.4, z, 2.4, 1.0, 1, 0, '#ffffff');
  // Seawall + quay safety plates.
  for (const z of [-44, -18, 18, 44]) {
    const pz = z + (z > 0 ? 1.2 : -1.2);
    wallDecal(kit, 'salt', 56.09, -0.7, pz, 1.4, 0.6, 1, 0);
    kit.add('sign2', quad(56.1, -0.55, pz, 0.9, 0.45, 1, 0, uvD('signSea', 2)), '#ffffff', { flat: true });
  }

  // ── Perched gulls ─────────────────────────────────────────────────────────
  const gulls: [number, number, number, number][] = [
    [64.2, -1.3, -45, 1.2],
    [64.2, -1.3, -12, -0.6],
    [64.2, -1.3, 33, 2.4],
    [63.85, PY + 0.62, -30, 0.3],
    [63.85, PY + 0.62, 24, 2.9],
    [52.4, 16.4, -5.2, 1.6],
    [55.6, 16.4, -5.1, 1.9],
    [48.2, 16.4, 5.1, -1.2],
    [37.2, 2.6, -37.6, 0.8],
    [23.8, 5.2, -22.4, 2.2],
    [40, 9.3, 60.2, 1.0],
    [-26, 9.3, -60.2, -0.4],
  ];
  const nG = Math.max(6, Math.round(gulls.length * (0.5 + 0.5 * decor)));
  for (let i = 0; i < nG; i++) {
    const [x, y, z, r] = gulls[i];
    perchedGull(kit, x, y, z, r, 1.05);
  }

  // ── Sunset glitter path on the sea ────────────────────────────────────────
  const glitterMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uSunDir: { value: sunDir.clone().normalize() },
        // HDR warm gold: blooms on medium/high, reads as bright dabs on low.
        uColor: { value: new THREE.Color('#ffd9a8').multiplyScalar(quality.preset === 'low' ? 1.4 : 2.6) },
      },
    ]),
    vertexShader: GLITTER_VERT,
    fragmentShader: GLITTER_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  const gg = new THREE.PlaneGeometry(520, 560, 1, 1);
  gg.rotateX(-Math.PI / 2);
  const glitter = new THREE.Mesh(gg, glitterMat);
  glitter.position.set(64.6 + 260, WATER_Y + 0.03, -60);
  glitter.renderOrder = 5;
  glitter.frustumCulled = false;
  glitter.name = 'gantry.glitter';
  glitter.userData.noPaint = true;
  glitter.userData.noShadow = true;
  root.add(glitter);

  return {
    update: (t: number): void => {
      glitterMat.uniforms.uTime.value = t;
      buoy.position.y = WATER_Y - 0.15 + Math.sin(t * 1.1) * 0.16;
      buoy.rotation.z = Math.sin(t * 0.8) * 0.09;
      buoy.rotation.x = Math.sin(t * 0.65 + 1.3) * 0.07;
    },
    dispose: (): void => {
      gg.dispose();
      glitterMat.dispose();
      bk.dispose();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Observatory wind-blown snow: spindrift streamers peeling off
// ridges, roof edges, wall copings and the cliff rim, and low ground-hugging
// sheets skating across the open snow. ONE draw call: every streamer is a
// soft alpha card (prop atlas 'streak') that billboards around the wind axis
// and loops along it entirely in the vertex shader — zero CPU per frame
// beyond one time uniform.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { OBS } from '../../../../shared/maps/observatory';
import { WIND } from './snowfield';

/** An emitter: streamers start along the segment a→b at height y (± jitter). */
interface Emitter {
  a: [number, number];
  b: [number, number];
  y: number;
  /** Relative density. */
  n: number;
  /** Ground sheet (long, thin, hugging the snow) vs. edge plume. */
  sheet?: boolean;
}

function emitters(): Emitter[] {
  const R = OBS.ridge;
  const D = OBS.deck;
  const DM = OBS.dorm;
  const out: Emitter[] = [];
  for (const s of [-1, 1]) {
    // Ridge & plateau crest (the wind comes off the western cliff over them).
    out.push({ a: [-40.3, 0], b: [-40.3, s * 12.5], y: R + 0.15, n: 7 });
    out.push({ a: [-49.3, s * 13], b: [-49.3, s * 30], y: R + 0.15, n: 6 });
    out.push({ a: [-57, s * 2], b: [-57, s * 36], y: R + 0.3, n: 6 });
    // Rock rib + outcrop crests.
    out.push({ a: [-23.3, s * 7.5], b: [-23.3, s * 26.5], y: OBS.ribTop - 0.2, n: 6 });
    out.push({ a: [-25.3, s * 31], b: [-25.3, s * 40], y: OBS.outcropTop - 0.1, n: 3 });
    // Roof edges (lee side) — dome base, dorm, generator / boiler house, shed.
    out.push({ a: [12.2, s * 1], b: [12.2, s * 12], y: OBS.baseTop + 0.15, n: 6 });
    out.push({ a: [DM.x1 + 0.1, s * 1], b: [DM.x1 + 0.1, s * 15], y: DM.roofTop + 0.25, n: 5 });
    out.push({ a: [26.1, s * 15], b: [26.1, s * 24], y: OBS.genTop + 0.15, n: 4 });
    out.push({ a: [43.1, s * 20], b: [43.1, s * 27.5], y: 3.5, n: 3 });
    // Spawn-yard wall copings (the wind runs along them).
    out.push({ a: [-53, s * 42.5], b: [53, s * 42.5], y: OBS.yardWall + 0.15, n: 10 });
    // The east rim: spindrift pouring off the cliff into the void.
    out.push({ a: [57.2, s * 9.5], b: [57.2, s * 40], y: 0.25, n: 7 });
    out.push({ a: [57.4, s * 0.5], b: [57.4, s * 9], y: D + 0.3, n: 4 });
    out.push({ a: [-55, s * 61], b: [55, s * 61], y: 0.3, n: 6 });
    // Ground sheets across the open courtyards and lanes.
    out.push({ a: [-20, s * 14], b: [-20, s * 38], y: 0.05, n: 7, sheet: true });
    out.push({ a: [-8, s * 14], b: [-8, s * 38], y: 0.05, n: 7, sheet: true });
    out.push({ a: [8, s * 30], b: [8, s * 39], y: 0.05, n: 4, sheet: true });
    out.push({ a: [-48, s * 14], b: [-48, s * 40], y: 0.05, n: 6, sheet: true });
    out.push({ a: [36, s * 9], b: [36, s * 18], y: 0.05, n: 4, sheet: true });
    out.push({ a: [44, s * 30], b: [44, s * 40], y: 0.05, n: 3, sheet: true });
    out.push({ a: [-52, s * 0.5], b: [-52, s * 9], y: R + 0.08, n: 4, sheet: true });
  }
  return out;
}

const VERT_PARS = /* glsl */ `
attribute vec4 aSeed;   // phase, speed (m/s), travel (m), length (m)
attribute vec3 aShape;  // along (-0.5..0.5), across (-0.5..0.5), width (m)
uniform float uTime;
uniform vec3 uWind;
varying float vFade;`;

const VERT_BEGIN = /* glsl */ `
	float life = fract( uTime * aSeed.y / aSeed.z + aSeed.x );
	vec3 c = position + uWind * ( life * aSeed.z );
	// Plumes lift and curl off the edge; sheets hug the snow.
	float sheet = step( aShape.z, 0.2 );
	c.y += ( 1.0 - sheet ) * ( sin( life * 3.1416 ) * 0.5 - life * life * 1.2 + sin( uTime * 1.7 + aSeed.x * 40.0 ) * 0.12 );
	c.xz += vec2( -uWind.z, uWind.x ) * sin( uTime * 0.9 + aSeed.x * 23.0 ) * 0.25;
	vec3 toCam = normalize( cameraPosition - c );
	vec3 side = cross( uWind, toCam );
	float sl = length( side );
	side = sl > 1e-3 ? side / sl : vec3( 0.0, 1.0, 0.0 );
	// Sheets lie flat-ish on the snow (their 'side' leans toward the ground).
	side = normalize( mix( side, vec3( -uWind.z, 0.0, uWind.x ), sheet * 0.7 ) );
	float len = aSeed.w * ( 0.55 + 0.6 * sin( life * 3.1416 ) );
	vec3 transformed = c + uWind * aShape.x * len + side * aShape.y * aShape.z;
	vFade = sin( life * 3.1416 );
	vFade *= vFade;
	// Fade out close to the camera (no card slapping the lens).
	vFade *= smoothstep( 1.5, 5.0, length( cameraPosition - c ) );`;

export interface Streamers {
  mesh: THREE.Mesh;
  time: { value: number };
  dispose(): void;
}

/** Builds the spindrift draw. `count` scales with quality (≈ 90 low … 300 high). */
export function buildStreamers(tex: THREE.Texture, uv: [number, number, number, number], count: number, rnd: () => number): Streamers {
  const ems = emitters();
  const total = ems.reduce((a, e) => a + e.n, 0);
  const pos: number[] = [];
  const seed: number[] = [];
  const shape: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  let v = 0;
  for (const e of ems) {
    const n = Math.max(1, Math.round((e.n / total) * count));
    for (let i = 0; i < n; i++) {
      const t = rnd();
      const x = e.a[0] + (e.b[0] - e.a[0]) * t;
      const z = e.a[1] + (e.b[1] - e.a[1]) * t;
      const y = e.y + (e.sheet ? rnd() * 0.08 : rnd() * 0.4);
      const speed = e.sheet ? 3 + rnd() * 2.5 : 4.5 + rnd() * 3.5;
      const travel = e.sheet ? 9 + rnd() * 9 : 6 + rnd() * 8;
      const len = e.sheet ? 3 + rnd() * 4 : 2.2 + rnd() * 3;
      // Sheets: width ≤ 0.2 flags them in the shader (thin, lying low).
      const width = e.sheet ? 0.1 + rnd() * 0.1 : 0.35 + rnd() * 0.55;
      const ph = rnd();
      for (const [ax, ay, u, vv] of [
        [-0.5, -0.5, 0, 0],
        [0.5, -0.5, 1, 0],
        [0.5, 0.5, 1, 1],
        [-0.5, 0.5, 0, 1],
      ]) {
        pos.push(x, y, z);
        seed.push(ph, speed, travel, len);
        shape.push(ax, ay, width);
        uvs.push(uv[0] + u * (uv[2] - uv[0]), uv[1] + vv * (uv[3] - uv[1]));
      }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
  g.setAttribute('aShape', new THREE.Float32BufferAttribute(shape, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  // Generous bounds (the cards travel downwind) — and the draw is never culled anyway.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 4, 0), 120);
  const time = { value: 0 };
  const wind = { value: new THREE.Vector3(WIND.x, 0, WIND.y) };
  const m = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color('#dcdcee'), transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.uniforms.uWind = wind;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>${VERT_PARS}`).replace('#include <begin_vertex>', VERT_BEGIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFade;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n\tdiffuseColor.a *= vFade;');
  };
  m.customProgramCacheKey = () => 'obs.streamers';
  m.name = 'obs.streamers';
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'obs.streamers';
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  mesh.matrixAutoUpdate = false;
  mesh.userData.hfCast = false;
  mesh.userData.noPaint = true;
  return {
    mesh,
    time,
    dispose(): void {
      g.dispose();
      m.dispose();
      mesh.removeFromParent();
    },
  };
}

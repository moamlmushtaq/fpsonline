// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Pastel: ankle-deep flood water (mall atrium, pool puddle).
//
// One transparent plane per body of water: sky-tinted fresnel reflection over
// the terrazzo, slow crossing ripples, warm sun glints and soft sparkle. No
// render targets (phones): the "reflection" is analytic — inside the mall the
// reflected ray is traced to the ceiling plane: under the broken glass vault it
// shows the sky, elsewhere the warm dark soffits, so the flood reads as a black
// mirror with the skylight glowing in it.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { MapLighting } from '../../../../shared/maps/types';

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute float aEdge;
varying vec3 vWorld;
varying float vEdge;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vEdge = aEdge;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uSun;
uniform vec3 uSunDir;
uniform float uOpacity;
uniform vec3 uInterior;
varying vec3 vWorld;
varying float vEdge;

vec2 wave(vec2 p, vec2 d, float f, float s, float t) {
  float ph = dot(p, d) * f + t * s;
  return d * cos(ph) * f;
}

void main() {
  vec2 p = vWorld.xz;
  float t = uTime;
  vec2 g = wave(p, normalize(vec2(1.0, 0.35)), 1.7, 1.1, t) * 0.016
         + wave(p, normalize(vec2(-0.4, 1.0)), 2.3, 1.6, t) * 0.012
         + wave(p, normalize(vec2(0.7, -0.8)), 4.1, 2.3, t) * 0.004
         + wave(p, normalize(vec2(-1.0, -0.2)), 7.3, 3.1, t) * 0.002;
  // Expanding rings where the broken skylight drips.
  for (int i = 0; i < 3; i++) {
    vec2 c = i == 0 ? vec2(-5.0, 6.0) : i == 1 ? vec2(6.0, -5.0) : vec2(-3.0, -7.5);
    float per = 2.3 + float(i) * 0.7;
    float ph = fract((t + float(i) * 0.9) / per);
    vec2 dd = p - c;
    float d = length(dd);
    float rr = ph * 3.2;
    float ring = exp(-((d - rr) * 5.0) * ((d - rr) * 5.0)) * (1.0 - ph);
    g += (dd / max(d, 0.001)) * ring * 0.06;
  }
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 v = normalize(cameraPosition - vWorld);
  // clamp(): dot of unit vectors can exceed 1 by an ulp; pow() of a negative base is NaN on Apple GPUs.
  float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
  vec3 r = reflect(-v, n);
  vec3 refl = mix(uHorizon, uSky, smoothstep(0.0, 0.6, r.y));
  // Mall interior: ceiling-plane trace (vault opening |x| < 10, |z| < 11).
  float inMall = step(abs(vWorld.x), 15.2) * step(abs(vWorld.z), 12.2);
  vec2 hit = vWorld.xz + r.xz * ((8.9 - vWorld.y) / max(r.y, 0.04));
  float open = smoothstep(10.2, 9.2, abs(hit.x)) * smoothstep(11.2, 10.2, abs(hit.y));
  float rib = smoothstep(0.08, 0.0, abs(fract(hit.y / 2.2 + 0.5) - 0.5)) * 0.6 + smoothstep(0.05, 0.0, abs(fract(hit.x / 2.0 + 0.5) - 0.5)) * 0.5;
  vec3 vaultRefl = mix(mix(uHorizon, uSky, 0.55), uInterior * 1.6, clamp(rib, 0.0, 1.0));
  refl = mix(refl, mix(uInterior, vaultRefl, open), inMall);
  float spec = pow(max(dot(r, uSunDir), 0.0), 180.0) * 2.4 + pow(max(dot(r, uSunDir), 0.0), 18.0) * 0.18;
  vec3 col = mix(uShallow * mix(1.0, 0.55, inMall), refl, 0.3 + fres * 0.6) + uSun * spec * mix(1.0, 0.35 + 0.65 * open, inMall);
  // Sparkle where ripples crest.
  float sp = smoothstep(0.985, 1.0, sin(p.x * 3.1 + t * 1.7) * sin(p.y * 2.7 - t * 1.3));
  col += uSun * sp * 0.25;
  float a = clamp(uOpacity * (0.55 + fres * 0.6) + spec * 0.4, 0.0, 0.96);
  // Street puddles feather into the asphalt (aEdge 1 inside → 0 at the rim)
  // and read darker (wet asphalt under a thin film): mostly sky reflection.
  a *= smoothstep(0.0, 0.85, vEdge);
  // Low reflected rays meet the houses / trees around the puddle, not the sky.
  vec3 near = vec3(0.16, 0.15, 0.15);
  vec3 prefl = mix(near, mix(uHorizon, uSky, smoothstep(0.25, 0.7, r.y)) * 0.85, smoothstep(0.06, 0.32, r.y));
  vec3 wet = vec3(0.09, 0.085, 0.085);
  float pspec = pow(max(dot(r, uSunDir), 0.0), 220.0) * 1.6;
  vec3 pcol = mix(wet, prefl * 0.55, 0.16 + fres * 0.45) + uSun * pspec;
  float isPuddle = step(-0.1, vWorld.y) * (1.0 - inMall);
  col = mix(col, pcol, isPuddle);
  a = mix(a, clamp(uOpacity * (0.55 + fres * 0.6) + pspec * 0.3, 0.0, 0.9) * smoothstep(0.0, 0.85, vEdge), isPuddle);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/**
 * Flood-water surface. `geo` may carry a per-vertex `aEdge` (1 = full water,
 * 0 = feathered rim for street puddles); it is filled with 1 when missing.
 */
export function createWaterSurface(l: MapLighting, geo: THREE.BufferGeometry, y: number, opacity = 0.62): THREE.Mesh {
  if (!geo.getAttribute('aEdge')) geo.setAttribute('aEdge', new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count).fill(1), 1));
  const sun = new THREE.Vector3(l.sunDir.x, l.sunDir.y, l.sunDir.z).normalize();
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uShallow: { value: new THREE.Color('#71898a') },
        uSky: { value: new THREE.Color(l.skyZenith) },
        uHorizon: { value: new THREE.Color(l.skyHorizon) },
        uSun: { value: new THREE.Color(l.sunColor) },
        uSunDir: { value: sun },
        uOpacity: { value: opacity },
        uInterior: { value: new THREE.Color('#4f4741') },
      },
    ]),
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  mat.name = 'pastel.water';
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  m.renderOrder = 4;
  m.name = 'pastel.water';
  return m;
}

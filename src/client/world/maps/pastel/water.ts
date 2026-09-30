// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Pastel: ankle-deep flood water (mall atrium, pool puddle).
//
// One transparent plane per body of water: sky-tinted fresnel reflection over
// the terrazzo, slow crossing ripples, warm sun glints and soft sparkle. No
// render targets (phones): the "reflection" is the painted sky gradient.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { MapLighting } from '../../../../shared/maps/types';

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
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
varying vec3 vWorld;

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
    float ring = exp(-pow((d - rr) * 5.0, 2.0)) * (1.0 - ph);
    g += (dd / max(d, 0.001)) * ring * 0.06;
  }
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 r = reflect(-v, n);
  vec3 refl = mix(uHorizon, uSky, smoothstep(0.0, 0.6, r.y));
  float spec = pow(max(dot(r, uSunDir), 0.0), 180.0) * 2.4 + pow(max(dot(r, uSunDir), 0.0), 18.0) * 0.18;
  vec3 col = mix(uShallow, refl, 0.25 + fres * 0.6) + uSun * spec;
  // Sparkle where ripples crest.
  float sp = smoothstep(0.985, 1.0, sin(p.x * 3.1 + t * 1.7) * sin(p.y * 2.7 - t * 1.3));
  col += uSun * sp * 0.25;
  float a = clamp(uOpacity * (0.55 + fres * 0.6) + spec * 0.4, 0.0, 0.96);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function createWaterSurface(l: MapLighting, geo: THREE.BufferGeometry, y: number, opacity = 0.62): THREE.Mesh {
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

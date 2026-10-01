// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — the launch rocket's shaders (see rocket.ts): sun-shaded steam
// puffs lit by the engines, the billowing / drifting smoke column, the flame,
// the shock-diamond jet core, the ignition flare and the pad glow.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';

// ── Shaders ─────────────────────────────────────────────────────────────────

/**
 * Fog uniforms for the ADDITIVE shaders. Deliberately not UniformsLib.fog: on
 * the low preset the in-material grading (painterly.ts) rides on those shared
 * uniforms and lifts black to a floor colour — fine for surfaces, but an
 * additive quad would add that floor everywhere it covers (a visible box).
 */
export function additiveFogUniforms(): Record<string, THREE.IUniform> {
  return { fogDensity: { value: 0 }, fogNear: { value: 1 }, fogFar: { value: 2000 }, fogColor: { value: new THREE.Color() } };
}

export const PUFF_VERT = /* glsl */ `
attribute float aAlpha;
attribute float aSeed;
varying float vAlpha;
varying float vSeed;
varying vec2 vUv;
varying float vFogD;
varying float vLocalY;
void main() {
  vUv = uv;
  vAlpha = aAlpha;
  vSeed = aSeed;
  vLocalY = instanceMatrix[3].y;
  vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(instanceMatrix[0].xyz) * length(modelMatrix[0].xyz);
  float r = aSeed * 6.2831;
  vec2 p = mat2(cos(r), -sin(r), sin(r), cos(r)) * position.xy;
  c.xy += p * s;
  vFogD = -c.z;
  gl_Position = projectionMatrix * c;
}`;

export const PUFF_FRAG = /* glsl */ `
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uSunW;
uniform vec3 uFire;
uniform float uFireY;
uniform vec3 fogColor;
uniform float fogDensity;
uniform float uFogScale;
varying float vAlpha;
varying float vSeed;
varying vec2 vUv;
varying float vFogD;
varying float vLocalY;
void main() {
  vec2 p = vUv - 0.5;
  float d = length(p) * 2.0;
  float ang = dot(p, p) < 1e-12 ? 0.0 : atan(p.y, p.x); // atan(0,0) is NaN on Apple GPUs
  float edge = 0.92 + 0.1 * sin(ang * 5.0 + vSeed * 40.0) + 0.06 * sin(ang * 11.0 - vSeed * 17.0);
  float a = 1.0 - smoothstep(edge * 0.35, edge, d);
  a *= vAlpha;
  if (a < 0.004) discard;
  vec3 nV = normalize(vec3(p * 2.0, sqrt(max(0.05, 1.0 - d * d))));
  vec3 nW = (vec4(nV, 0.0) * viewMatrix).xyz;
  float lit = clamp(dot(nW, uSunW) * 0.6 + 0.45 + nW.y * 0.15, 0.0, 1.0);
  vec3 col = mix(uShade, uLit, lit);
  // Steam lit from below by the engines (ignition flash / exhaust), fading with height.
  col += uFire * exp(-max(0.0, vLocalY - uFireY) * 0.07) * (0.55 + 0.45 * clamp(0.5 - p.y * 1.6, 0.0, 1.0));
  float fd = vFogD * uFogScale;
  col = mix(col, fogColor, 1.0 - exp(-fogDensity * fogDensity * fd * fd));
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export const TRAIL_VERT = /* glsl */ `
uniform float uTop;
uniform float uTopX;
uniform float uSpread;
uniform float uTime;
uniform float uLift;
uniform float uBase;
uniform vec2 uWind;
varying vec3 vNW;
varying vec3 vW;
varying float vH;
varying float vY;
varying float vFogD;
void main() {
  float h = position.y + 0.5;
  float y = h * uTop;
  float ang = abs(position.x) + abs(position.z) < 1e-6 ? 0.0 : atan(position.z, position.x); // cap centres: atan(0,0) is NaN on Apple GPUs
  // Age of the smoke at this height: when did the tail pass it (inverse of the climb curve)?
  float pass = pow(max(1e-6, (y - uBase) / 2.4), 1.0 / 2.4); // (pow(0, y) is NaN-prone)
  float age = max(0.0, uLift - pass);
  float r = mix(uSpread, 2.4, pow(max(h, 1e-5), 0.35)) + y * 0.04;
  r *= 1.0 + age * 0.26;
  float lump = sin(y * 0.33 - uTime * 0.7 + ang * 3.0) * 0.45 + sin(y * 0.13 + ang * 5.0 + uTime * 0.25) * 0.35 + sin(y * 0.71 + ang * 7.0 - uTime * 1.1) * 0.2;
  r *= 1.0 + (0.3 + min(0.25, age * 0.05)) * lump * smoothstep(0.02, 0.2, h);
  vec3 p = vec3(position.x * r, y, position.z * r);
  p.x += uTopX * h * h;
  // Older smoke drifts downwind (the column leans and frays as it ages).
  p.xz += uWind * age * smoothstep(0.0, 0.12, h);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vW = wp.xyz;
  vNW = normalize(mat3(modelMatrix) * vec3(position.x, 0.25 - h * 0.2, position.z));
  vH = h;
  vY = y;
  vec4 mv = viewMatrix * wp;
  vFogD = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

export const TRAIL_FRAG = /* glsl */ `
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uSunW;
uniform float uOpacity;
uniform vec3 uFire;
uniform float uBase;
uniform float uTop;
uniform vec3 fogColor;
uniform float fogDensity;
uniform float uFogScale;
varying vec3 vNW;
varying vec3 vW;
varying float vH;
varying float vY;
varying float vFogD;
void main() {
  vec3 n = normalize(vNW);
  vec3 v = normalize(cameraPosition - vW);
  float facing = abs(dot(n, v));
  float a = smoothstep(0.05, 0.75, facing) * uOpacity;
  a *= smoothstep(1.0, 0.9, vH) * (0.65 + 0.35 * smoothstep(0.0, 0.08, vH));
  if (a < 0.004) discard;
  float lit = clamp(dot(n, uSunW) * 0.55 + 0.5, 0.0, 1.0);
  vec3 col = mix(uShade, uLit, lit);
  // The exhaust lights the smoke: warm at the pad, hot just under the tail.
  col += uFire * (exp(-max(0.0, vY - uBase) * 0.06) * 0.7 + smoothstep(uTop - 26.0, uTop - 2.0, vY) * 1.1);
  float fd = vFogD * uFogScale;
  col = mix(col, fogColor, 1.0 - exp(-fogDensity * fogDensity * fd * fd));
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export const FLAME_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying float vFogD;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = cameraPosition - wp.xyz;
  vec4 mv = viewMatrix * wp;
  vFogD = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

export const FLAME_FRAG = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uEdge;
uniform float uPower;
uniform float uTime;
uniform float fogDensity;
uniform float uFogScale;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying float vFogD;
void main() {
  float along = vUv.y; // 1 at the nozzle, 0 at the tail
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float core = pow(max(facing, 1e-4), 2.2);
  float flick = 0.82 + 0.18 * sin(uTime * 43.0 + along * 17.0) * sin(uTime * 29.0 - vUv.x * 25.0);
  float fade = smoothstep(0.0, 0.7, along);
  vec3 col = mix(uEdge, uCore, core) * (0.35 + core) * fade * flick;
  col += uCore * core * pow(max(0.5 + 0.5 * sin(along * 34.0 - uTime * 24.0), 1e-4), 8.0) * 0.5 * smoothstep(0.45, 1.0, along);
  float fd = vFogD * uFogScale;
  col *= exp(-fogDensity * fogDensity * fd * fd) * uPower;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Camera-facing exhaust core with stationary shock diamonds (Mach disks). */
export const DIAMOND_VERT = /* glsl */ `
uniform float uLen;
uniform float uWidth;
varying vec2 vUv;
varying float vFogD;
void main() {
  vec3 o = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 axis = normalize(mat3(modelMatrix) * vec3(0.0, -1.0, 0.0));
  float sc = length(modelMatrix[1].xyz);
  vec3 p = o + axis * (position.y + 0.5) * uLen * sc;
  vec3 side = cross(axis, cameraPosition - p);
  side = dot(side, side) < 1e-8 ? vec3(1.0, 0.0, 0.0) : normalize(side);
  p += side * position.x * uWidth * sc;
  vUv = vec2(position.x * 2.0, position.y + 0.5);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vFogD = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

export const DIAMOND_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uPower;
uniform float uCount;
uniform float uTime;
uniform float fogDensity;
uniform float uFogScale;
varying vec2 vUv;
varying float vFogD;
void main() {
  float v = vUv.y;
  float u = abs(vUv.x);
  float k = v * uCount;
  float f = fract(k);
  float idx = floor(k);
  // Each cell: a bright diamond whose width peaks mid-cell, shrinking down the plume.
  float w = (1.0 - abs(f * 2.0 - 1.0)) * (0.62 - idx * 0.07);
  float dmd = (1.0 - smoothstep(w * 0.55, w, u)) * (1.0 - idx / uCount);
  float fv = clamp(1.0 - v, 0.0, 1.0);
  float fade = fv * sqrt(fv);
  float jet = exp(-u * u * 22.0) * fade;
  float flick = 0.9 + 0.1 * sin(uTime * 51.0 + v * 9.0);
  vec3 c = (uColor * dmd * 1.4 + uCore * jet * 0.8) * uPower * flick;
  float fd = vFogD * uFogScale;
  c *= exp(-fogDensity * fogDensity * fd * fd);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Big camera-facing flare (ignition flash + the exhaust's glare). */
export const FLARE_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
varying float vFogD;
void main() {
  vUv = uv;
  vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = uSize * length(modelMatrix[1].xyz);
  vFogD = -c.z;
  // Pulled toward the camera so the pad/ground right at the engines can't clip
  // the glare into a hard edge; real foreground (buildings) still occludes it.
  c.z += min(s * 0.5, -c.z * 0.5);
  c.xy += position.xy * s;
  gl_Position = projectionMatrix * c;
}`;

export const FLARE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uPower;
uniform float fogDensity;
uniform float uFogScale;
varying vec2 vUv;
varying float vFogD;
void main() {
  vec2 p = vUv - 0.5;
  float d = length(p) * 2.0;
  // (No pow(): pow(0, y) is NaN-prone on some GPUs / SwiftShader.)
  float x = clamp(1.0 - d, 0.0, 1.0);
  float x2 = x * x;
  float x4 = x2 * x2;
  float a = x2 * (0.55 + 0.45 * x) + 0.5 * x4 * x4 * x;
  // Thin horizontal streak (anamorphic glare) through the core.
  a += 0.35 * exp(-p.y * p.y * 900.0) * clamp(1.0 - abs(p.x) * 2.0, 0.0, 1.0);
  float fd = vFogD * uFogScale;
  vec3 c = uColor * a * uPower * exp(-fogDensity * fogDensity * fd * fd * 0.5);
  gl_FragColor = vec4(max(c, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uPower;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float x = clamp(1.0 - d, 0.0, 1.0);
  float a = x * x * (0.8 + 0.2 * x); // (no pow(0, y): NaN-prone)
  gl_FragColor = vec4(uColor * a * uPower, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

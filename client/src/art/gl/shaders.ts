// GLSL for the art layer. Budget notes (per pixel, the iPhone target):
//   nebula   : 12 noise fetches + 1 dust fetch, rendered at 1/2..1/3 of CSS resolution, often not every frame
//   under    : 1 bilinear nebula fetch, 3 star cells (integer hash, no loops), 1 felt + 1 blue-noise fetch
//   light    : lamp pool + beam (2 noise fetches), 1 bloom fetch, 1 mote cell
//   shade    : vignette + lamp falloff + 1 blue-noise fetch (grain)
//   corona   : instanced quads, 1 noise fetch per covered pixel; only around stars
// No loops over neighbours, no branches on textures, mediump where the range allows.

/** Shared helpers: smooth value noise from a 256² RGBA random texture (hardware bilinear on a quintic-remapped
 *  lattice: one fetch = 4 independent smooth noises), fbm, and an integer hash for star cells. */
const COMMON = `
uniform sampler2D uNoise;
vec4 nz(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return texture(uNoise, (i + f + 0.5) / 256.0);
}
const mat2 ROT = mat2(0.80, 0.60, -0.60, 0.80);
vec4 fbm(vec2 p) {
  vec4 s = vec4(0.0); float a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * nz(p); p = ROT * p * 2.03 + 17.13; a *= 0.5; }
  return s / 0.9375;
}
uint hh(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
vec4 hash4(vec2 c, uint seed) {
  uint h = hh(uint(int(c.x) + 1048576) * 1973u + hh(uint(int(c.y) + 1048576) + seed) * 9277u);
  return vec4(float(hh(h) & 0xffffu), float(hh(h + 1u) & 0xffffu), float(hh(h + 2u) & 0xffffu), float(hh(h + 3u) & 0xffffu)) / 65535.0;
}
vec3 softLight(vec3 b, vec3 s) {
  return mix(2.0 * b * s + b * b * (1.0 - 2.0 * s), sqrt(b) * (2.0 * s - 1.0) + 2.0 * b * (1.0 - s), step(0.5, s));
}
`;

/** The living nebula, rendered into a small target. World space with its own parallax and a damped zoom, so
 *  panning the board slides the sky a little slower than the board (depth) and zooming breathes rather than
 *  magnifies. Palette: the art bible's "ink, umber, oxblood, verdigris, lamp-gold" (no neon). */
export const NEBULA_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
${COMMON}
uniform sampler2D uDust;
uniform vec2 uView;        // viewport, CSS px
uniform vec3 uCam;         // world x, y, zoom
uniform float uTime, uPar, uScale, uSeed, uDustAmt, uDensity;
uniform vec3 uInk, uDeep, uUmber, uBlood, uVerd, uGold;
void main() {
  float ze = pow(max(uCam.z, 1e-3), 0.45);
  vec2 world = uCam.xy * uPar + (vUv - 0.5) * uView / ze;
  vec2 p = world * uScale + uSeed;
  float t = uTime * 0.010;
  vec4 q = fbm(p + vec2(0.0, t));
  vec4 r = fbm(p + 1.7 * (q.xy - 0.5) * 2.0 + vec2(1.7, 9.2) - vec2(t * 0.7, 0.0));
  vec4 f = fbm(p * 1.7 + 1.3 * (r.xy - 0.5) * 2.0 + vec2(8.3, 2.8) + vec2(0.0, t * 0.4));

  // a broad mask keeps the clouds in a few drifts with real dark space between them
  float broad = smoothstep(0.36, 0.62, fbm(p * 0.33 + vec2(5.1, 1.3)).x);
  // keep the middle of the table legible: the gas gathers toward the rim of the board
  broad = clamp(broad + smoothstep(500.0, 1300.0, length(world)) * 0.55 - 0.15, 0.0, 1.0);
  float d = (f.x * 0.65 + q.z * 0.35) * (0.72 + 0.48 * broad);
  float cloud = smoothstep(0.36 - 0.08 * uDensity, 0.64, d);
  float core = smoothstep(0.58, 0.78, d);

  // the dark: ink with a cool deep-blue breath, so the warm gas has something to glow against
  vec3 col = mix(uInk, uDeep, smoothstep(0.30, 0.75, q.w));
  // the gas emits: rust-red body, amber where dense, a cool verdigris veil where thin
  vec3 gas = mix(uBlood, uUmber, smoothstep(0.45, 0.65, r.z));
  gas = mix(gas, uVerd, smoothstep(0.52, 0.72, q.y) * (1.0 - core));
  gas = mix(gas, uGold, core * smoothstep(0.42, 0.72, f.y) * 0.75);
  col += gas * (cloud * cloud) * 1.5;
  // emission rims: a thin bright edge where density crosses the threshold (what makes it read as gas, not smoke)
  float rim = smoothstep(0.06, 0.0, abs(d - 0.52)) * broad;
  col += uGold * rim * 0.07;
  // dust lanes: dark filaments from the warped noise, plus the Hubble dust detail (NASA/ESA, see docs/ASSETS.md)
  float lane = smoothstep(0.55, 0.38, f.z) * smoothstep(0.36, 0.56, d);
  vec2 duv = world * uScale * 0.6 + (r.xy - 0.5) * 0.30;
  float dust = texture(uDust, duv).r - 0.5;
  col *= 1.0 - 0.7 * lane;
  col *= 1.0 + dust * uDustAmt * cloud;
  o = vec4(max(col, 0.0), 1.0);
}`;

/** The under layer at full resolution: upscaled nebula, three parallax star layers with twinkle, the felt of the
 *  mat at screen-constant scale (soft-light), and blue-noise dither so dark gradients never band. */
export const UNDER_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
${COMMON}
uniform sampler2D uNeb, uFelt, uBlue;
uniform vec2 uView;        // CSS px
uniform vec3 uCam;
uniform float uTime, uStars, uFelt_, uSeed;
uniform vec2 uPar;         // parallax: x = far layers, y = near layer
vec3 starLayer(vec2 p, float cell, float dens, float size, uint sd, float bright) {
  vec2 c = floor(p / cell), f = p / cell - c;
  vec4 h = hash4(c, sd);
  if (h.x > dens) return vec3(0.0);
  vec2 pos = 0.18 + 0.64 * h.yz;
  vec2 dv = (f - pos) * cell;
  float b = h.w * h.w * h.w;
  float r = size * (0.55 + 1.3 * b);
  float tw = 0.72 + 0.28 * sin(uTime * (0.5 + 2.2 * h.y) + h.z * 43.0);
  float a = exp(-dot(dv, dv) / (r * r)) * (0.22 + 1.1 * b) * mix(1.0, tw, 0.4 + 0.6 * b) * bright;
  // a faint cross on the brightest: lens, not cartoon
  a += b * b * exp(-abs(dv.x) * 1.4) * exp(-abs(dv.y) * 0.35 / size) * 0.10 * bright;
  a += b * b * exp(-abs(dv.y) * 1.4) * exp(-abs(dv.x) * 0.35 / size) * 0.10 * bright;
  vec3 tint = mix(vec3(1.0, 0.84, 0.66), vec3(0.80, 0.88, 1.0), smoothstep(0.2, 0.9, h.y));
  return tint * a;
}
void main() {
  vec2 css = vec2(vUv.x, 1.0 - vUv.y) * uView;
  vec3 col = texture(uNeb, vUv).rgb;
  float zd = pow(max(uCam.z, 1e-3), 0.12);
  vec2 c0 = css - 0.5 * uView;
  vec3 st = vec3(0.0);
  st += starLayer(c0 / zd + uCam.xy * uCam.z * uPar.x * 0.5, 46.0, 0.55, 0.55, 11u, 0.55);
  st += starLayer(c0 / zd + uCam.xy * uCam.z * uPar.x, 90.0, 0.50, 0.75, 23u, 0.80);
  st += starLayer(c0 * zd + uCam.xy * uCam.z * uPar.y, 170.0, 0.42, 1.00, 37u, 1.00);
  // stars sit behind the dust: dim them where the nebula is dark-laned (luminance of the cloud)
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  col += st * uStars * (0.55 + 2.5 * lum);
  // felt: screen-constant scale, anchored to the board's pan
  vec2 fuv = (css + uCam.xy * uCam.z) / 300.0;
  vec3 felt = vec3(texture(uFelt, fuv).r);
  col = mix(col, softLight(col, felt), uFelt_);
  // dither
  float bn = texture(uBlue, gl_FragCoord.xy / 128.0).r;
  col += (bn - 0.5) / 160.0;
  o = vec4(col, 1.0);
}`;

/** Light pass (composited with CSS mix-blend-mode: screen): the warm lamp pool, the volumetric beam with dust
 *  drifting in it, and the bloom of the board's highlights. Black = no change. */
export const LIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
${COMMON}
uniform sampler2D uBloom;
uniform vec2 uView;
uniform vec2 uLamp;        // lamp pool centre, uv (y down)
uniform vec3 uWarm;
uniform float uTime, uLampAmt, uBeamAmt, uBloomAmt, uMotes;
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 css = uv * uView;
  float asp = uView.x / uView.y;
  vec2 dl = (uv - uLamp) * vec2(asp, 1.0);
  float pool = exp(-dot(dl, dl) * 2.6);
  vec3 col = uWarm * pool * uLampAmt;

  // the beam: a cone from a lamp above the top edge; dust density drifts slowly through it
  vec2 src = vec2(uLamp.x - 0.10, -0.55);
  vec2 v = (uv - src) * vec2(asp, 1.0);
  vec2 axis = normalize((uLamp - src) * vec2(asp, 1.0));
  float along = dot(v, axis);
  float across = abs(v.x * axis.y - v.y * axis.x);
  float cone = smoothstep(0.42, 0.0, across / max(along, 0.05)) * smoothstep(0.0, 0.5, along) * exp(-along * 0.9);
  float haze = nz(css / 260.0 + vec2(uTime * 0.03, -uTime * 0.015)).r;
  haze = 0.55 + 0.9 * haze * haze;
  col += uWarm * cone * haze * uBeamAmt;

  // dust motes: one per 110px cell, drifting; only visible inside the beam
  if (uMotes > 0.0) {
    vec2 mp = css + vec2(uTime * 7.0, -uTime * 4.0);
    vec2 c = floor(mp / 110.0), f = mp / 110.0 - c;
    vec4 h = hash4(c, 71u);
    vec2 pos = 0.15 + 0.7 * fract(h.xy + vec2(sin(uTime * 0.21 + h.z * 6.3), cos(uTime * 0.17 + h.w * 6.3)) * 0.08);
    vec2 dd = (f - pos) * 110.0;
    float r = 0.9 + 1.4 * h.z;
    float flick = 0.5 + 0.5 * sin(uTime * (0.7 + h.w * 1.6) + h.x * 30.0);
    col += uWarm * exp(-dot(dd, dd) / (r * r)) * (cone * 3.0 + pool * 0.25) * flick * uMotes * step(0.45, h.w);
  }

  if (uBloomAmt > 0.0) {
    vec3 b = texture(uBloom, vUv).rgb;
    col += b * uBloomAmt * mix(vec3(1.0), uWarm * 1.15, 0.35);
  }
  o = vec4(col, 1.0);
}`;

/** Shade pass (premultiplied alpha over everything): vignette toward the dark edge of the table, the lamp's
 *  falloff, and a film grain from blue noise (signed: lifts and darkens). */
export const SHADE_FS = `#version 300 es
precision mediump float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uBlue;
uniform vec2 uView, uLamp, uGrainOff;
uniform vec3 uEdge;        // vignette colour: warm near-black
uniform float uVig, uFall, uGrain;
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float asp = uView.x / uView.y;
  vec2 dc = (uv - vec2(0.5, 0.48)) * vec2(min(asp, 1.6) * 0.82, 1.0);
  float vig = smoothstep(0.30, 0.95, length(dc)) * uVig;
  vec2 dl = (uv - uLamp) * vec2(asp, 1.0);
  float fall = smoothstep(0.25, 1.35, length(dl)) * uFall;
  float a = 1.0 - (1.0 - vig) * (1.0 - fall);
  vec3 rgb = uEdge * a;
  float g = (texture(uBlue, gl_FragCoord.xy / 128.0 + uGrainOff).r - 0.5) * uGrain;
  float lift = max(g, 0.0) * (1.0 - a), dark = max(-g, 0.0) * (1.0 - a);
  rgb += vec3(1.0, 0.93, 0.82) * lift;
  a += lift + dark;
  o = vec4(rgb, a);
}`;

/** Bloom chain: bright-pass from the downscaled board, then a separable 9-tap Gaussian (5 linear fetches). */
export const BRIGHT_FS = `#version 300 es
precision mediump float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uSrc;
uniform float uThresh;
void main() {
  vec4 s = texture(uSrc, vec2(vUv.x, 1.0 - vUv.y));
  vec3 c = s.rgb;                       // the 2D canvas uploads premultiplied; transparent = black, good
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(uThresh, uThresh + 0.35, l);
  o = vec4(c * k, 1.0);
}`;

export const BLUR_FS = `#version 300 es
precision mediump float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uDir;                      // texel step * direction
void main() {
  vec3 c = texture(uSrc, vUv).rgb * 0.2270270270;
  c += texture(uSrc, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture(uSrc, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture(uSrc, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture(uSrc, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  o = vec4(c, 1.0);
}`;

/** Star coronas: one instanced quad per visible star, additive. In core radii: a hot bleed over the painted
 *  sprite, a soft halo, slowly turning streamers, and (bright stars only) a restrained lens cross with a warm
 *  anamorphic streak, as if photographed through the lamp-lit glass of a display case. */
export const CORONA_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 iA;        // x, y (CSS px), core radius (CSS px), amplitude
layout(location = 2) in vec4 iB;        // r, g, b, seed
uniform vec2 uView;
uniform float uSpan;
out vec2 vP;
out vec3 vCol;
out vec2 vSA;
void main() {
  float span = uSpan * (0.8 + 0.5 * iA.w);
  vP = aCorner * span;
  vCol = iB.rgb; vSA = vec2(iB.a, iA.w);
  vec2 p = iA.xy + aCorner * iA.z * span;
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
}`;

export const CORONA_FS = `#version 300 es
precision highp float;
in vec2 vP;
in vec3 vCol;
in vec2 vSA;
out vec4 o;
uniform sampler2D uNoise;
uniform float uTime, uSpan, uAmt;
void main() {
  float seed = vSA.x, amp = vSA.y;
  float d = length(vP);
  vec2 dir = vP / max(d, 1e-4);
  float spin = uTime * 0.04 + seed * 6.28;
  vec2 rd = mat2(cos(spin), sin(spin), -sin(spin), cos(spin)) * dir;
  vec4 n = texture(uNoise, (rd * 5.0 + seed * 91.0 + vec2(uTime * 0.02, 0.0)) / 256.0 * 6.0);
  float pulse = 0.92 + 0.08 * sin(uTime * 0.9 + seed * 40.0);
  float halo = exp(-d * 1.15) * 0.55 + 0.22 / (1.0 + d * d * 3.0);
  float stream = smoothstep(0.42, 0.85, n.r * 0.7 + n.g * 0.3) * smoothstep(0.85, 1.4, d) * exp(-(d - 1.0) * 0.9);
  float core = exp(-d * d * 2.2);
  vec3 c = vCol * (halo + stream * 0.75) * pulse + mix(vCol, vec3(1.0), 0.6) * core * 0.35;
  // lens cross + warm anamorphic streak, bright stars only
  float bright = smoothstep(0.55, 1.0, amp);
  float sx = exp(-abs(vP.y) * 22.0) * exp(-abs(vP.x) * 0.75);
  float sy = exp(-abs(vP.x) * 22.0) * exp(-abs(vP.y) * 0.95);
  float ana = exp(-abs(vP.y) * 55.0) * exp(-abs(vP.x) * 0.28);
  c += mix(vCol, vec3(1.0, 0.86, 0.62), 0.5) * (sx + sy) * 0.28 * bright;
  c += vec3(1.0, 0.78, 0.52) * ana * 0.18 * bright;
  float edge = smoothstep(uSpan * (0.8 + 0.5 * amp), uSpan * 0.55, d);
  o = vec4(c * edge * amp * uAmt, 1.0);
}`;

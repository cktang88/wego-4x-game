// WebGL2 plumbing for the art layer (client/src/art/gl): context creation with a capability probe, shader
// compilation with readable errors, render targets, the fullscreen triangle and texture loading.
// Everything here returns null instead of throwing, so a caller can always fall back to the 2D painters.

export type GL = WebGL2RenderingContext;

export interface Program {
  prog: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

export interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

/** Is WebGL2 available at all (cached)? `?gl=0` in the URL forces the 2D fallback for testing. */
let probe: boolean | null = null;
export function hasWebGL2(): boolean {
  if (probe !== null) return probe;
  try {
    if (new URLSearchParams(location.search).get('gl') === '0') return (probe = false);
    const c = document.createElement('canvas');
    const g = c.getContext('webgl2');
    probe = !!g;
    g?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { probe = false; }
  return probe;
}

/** A WebGL2 context tuned for a compositing layer: no depth/stencil/AA, premultiplied alpha, low-power hint. */
/** A software rasteriser behind WebGL2 (SwiftShader, llvmpipe, Microsoft's basic renderer): the browser does not
 *  always flag it as a "major performance caveat" (Chromium's ANGLE + SwiftShader on Vulkan doesn't), so the
 *  renderer string is checked too. Probed once. */
let soft: boolean | null = null;
export function softwareGL(): boolean {
  if (soft !== null) return soft;
  soft = false;
  try {
    const g = document.createElement('canvas').getContext('webgl2');
    const d = g?.getExtension('WEBGL_debug_renderer_info');
    const r = g && d ? String(g.getParameter(d.UNMASKED_RENDERER_WEBGL)) : '';
    soft = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(r);
    g?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* */ }
  return soft;
}

/** Ask for a hardware context only (the Graphics setting "auto"): a software rasteriser (SwiftShader, llvmpipe,
 *  a blocklisted GPU) would spend the frame budget on the sky, so the 2D table is the better choice there. */
let hardwareOnly = false;
export function setHardwareOnly(v: boolean) { hardwareOnly = v; }

export function context(canvas: HTMLCanvasElement, alpha = true): GL | null {
  if (!hasWebGL2()) return null;
  try {
    return canvas.getContext('webgl2', {
      alpha, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: false, powerPreference: 'low-power', desynchronized: false,
      failIfMajorPerformanceCaveat: hardwareOnly,
    }) as GL | null;
  } catch { return null; }
}

/** The common vertex shader: one oversized triangle covering the viewport, uv in [0,1]. */
export const FULLSCREEN_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

function compile(gl: GL, type: number, src: string, name: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    console.warn(`[art/gl] ${name} ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader:\n${gl.getShaderInfoLog(s)}`);
    gl.deleteShader(s);
    return null;
  }
  return s;
}

/** Compile + link; uniforms are looked up by the names listed (missing ones are null, which GL ignores). */
export function program(gl: GL, name: string, vs: string, fs: string, uniforms: string[]): Program | null {
  const v = compile(gl, gl.VERTEX_SHADER, vs, name), f = compile(gl, gl.FRAGMENT_SHADER, fs, name);
  if (!v || !f) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, v); gl.attachShader(prog, f);
  gl.linkProgram(prog);
  gl.deleteShader(v); gl.deleteShader(f);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
    console.warn(`[art/gl] ${name} link:\n${gl.getProgramInfoLog(prog)}`);
    return null;
  }
  const u: Program['u'] = {};
  for (const n of uniforms) u[n] = gl.getUniformLocation(prog, n);
  return { prog, u };
}

/** An RGBA8 render target with linear filtering (half-res nebula, bloom chain). */
export function target(gl: GL, w: number, h: number, prev?: Target | null): Target | null {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  if (prev && prev.w === w && prev.h === h) return prev;
  if (prev) { gl.deleteFramebuffer(prev.fb); gl.deleteTexture(prev.tex); }
  const tex = gl.createTexture(), fb = gl.createFramebuffer();
  if (!tex || !fb) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, tex, w, h };
}

export function dropTarget(gl: GL, t: Target | null) {
  if (!t) return;
  gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex);
}

/** A tileable value-noise texture: 4 independent channels of smooth noise, so one fetch gives 4 octaves' worth
 *  of uncorrelated values (RG drive the domain warp, B the dust, A the twinkle phase). */
export function noiseTexture(gl: GL, n = 256, seed = 1337): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  const data = new Uint8Array(n * n * 4);
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(rnd() * 256);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return tex;
}

/** A 1x1 grey texture, so a sampler is always bound while an image texture is still loading. */
export function flatTexture(gl: GL, v = 128): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([v, v, v, 255]));
  return tex;
}

/** Load an image from client/public into a repeating, mipmapped texture. Resolves null on failure; until then the
 *  returned holder points at a flat grey texture, so shaders never sample an unbound unit. */
export function imageTexture(gl: GL, url: string, opts: { mirror?: boolean; nearest?: boolean } = {}): { tex: WebGLTexture | null; ready: Promise<boolean> } {
  const holder: { tex: WebGLTexture | null; ready: Promise<boolean> } = { tex: flatTexture(gl), ready: Promise.resolve(false) };
  holder.ready = new Promise(res => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (gl.isContextLost()) return res(false);
      const tex = gl.createTexture();
      if (!tex) return res(false);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
      const wrap = opts.mirror ? gl.MIRRORED_REPEAT : gl.REPEAT;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      if (opts.nearest) {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      } else {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      }
      if (holder.tex) gl.deleteTexture(holder.tex);
      holder.tex = tex;
      res(true);
    };
    img.onerror = () => res(false);
    img.src = url;
  });
  return holder;
}

/** Public asset URL relative to the page (works under a sub-path deploy). */
export const publicUrl = (p: string) => { try { return new URL(p, document.baseURI).href; } catch { return p; } };

/** Hex '#rrggbb' to linear-ish 0..1 floats for uniforms (the shaders work in display space; that's fine here). */
export function hex3(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

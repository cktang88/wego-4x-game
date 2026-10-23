// The GL art stage: three thin WebGL2 canvases around the existing 2D map canvas.
//
//   [ under ]  opaque  : living nebula (small target, often not every frame) + parallax stars + felt + dither
//   [ map 2D ] the existing MapRenderer canvas, drawn with a transparent background
//   [ light ]  CSS mix-blend-mode: screen : lamp pool, volumetric beam + dust motes, star coronas, bloom
//   [ shade ]  premultiplied alpha        : vignette, lamp falloff, film grain
//
// Nothing here touches the 2D canvas except reading it (downscaled) for bloom. Each layer can be switched off;
// the whole stage is optional: create() returns null without WebGL2 and the caller keeps its 2D backdrop.
// A frame-time governor steps quality down (high → medium → low) when a device can't hold 60fps.

import { type GL, type Program, type Target, FULLSCREEN_VS, context, program, target, dropTarget, noiseTexture, imageTexture, publicUrl, hex3 } from './core.ts';
import { NEBULA_FS, UNDER_FS, LIGHT_FS, SHADE_FS, BRIGHT_FS, BLUR_FS, CORONA_VS, CORONA_FS } from './shaders.ts';
import { SKY, LAMP } from '../bible.ts';

export type Quality = 'high' | 'medium' | 'low';

export interface StageToggles {
  nebula: boolean;   // false: plain ink + stars
  stars: boolean;
  felt: boolean;
  corona: boolean;
  lamp: boolean;     // pool + beam + motes
  bloom: boolean;    // needs a bloom source canvas
  shade: boolean;    // vignette + falloff + grain
}

export interface CoronaStar {
  /** CSS px in the viewport */
  x: number; y: number;
  /** painted core radius, CSS px */
  r: number;
  /** 0..1: brightness; >0.55 adds the lens cross */
  amp: number;
  color: string;
  seed: number;
}

export interface StageFrame {
  /** world camera: centre + zoom (MapRenderer.cam) */
  cam: { x: number; y: number; z: number };
  /** seconds */
  t: number;
  stars?: CoronaStar[];
  /** the 2D board to bloom (downscaled each frame); omit for no bloom */
  bloomSrc?: HTMLCanvasElement | null;
  /** the caller's real frame interval in ms, for the quality governor. A caller that draws the stage only every
   *  2nd or 3rd frame on purpose (a paced still board) must pass it: the gap between stage frames is not its frame
   *  time. Without it, gaps over 50 ms (a timer-driven or paced caller) are not counted as slow frames. */
  dt?: number;
}

export interface StageOptions {
  quality?: Quality;
  toggles?: Partial<StageToggles>;
  /** map seed: varies the sky */
  seed?: number;
  /** called when the governor or a context loss changes what's drawn */
  onChange?: (s: { quality: Quality; lost: boolean }) => void;
  /** disable the automatic quality governor */
  fixedQuality?: boolean;
}

const TIERS: Record<Quality, { nebScale: number; nebEvery: number; underDpr: number; lightScale: number; shadeScale: number; bloom: boolean; motes: boolean }> = {
  high:   { nebScale: 0.5,  nebEvery: 1, underDpr: 2,   lightScale: 1,   shadeScale: 0.75, bloom: true,  motes: true },
  medium: { nebScale: 0.38, nebEvery: 2, underDpr: 1.5, lightScale: 0.75, shadeScale: 0.5, bloom: false, motes: true },
  low:    { nebScale: 0.28, nebEvery: 4, underDpr: 1,   lightScale: 0.5, shadeScale: 0.5,  bloom: false, motes: false },
};

const MAX_STARS = 96;

function layerCanvas(cls: string, blend?: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.className = `artgl ${cls}`;
  c.setAttribute('aria-hidden', 'true');
  c.style.cssText = `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:block;${blend ? `mix-blend-mode:${blend};` : ''}`;
  return c;
}

class UnderLayer {
  gl: GL; neb: Program; under: Program;
  noise: WebGLTexture | null; felt; dust; blue;
  nebT: Target | null = null;
  frame = 0;
  lastCam = '';
  constructor(public canvas: HTMLCanvasElement, gl: GL, neb: Program, under: Program) {
    this.gl = gl; this.neb = neb; this.under = under;
    this.noise = noiseTexture(gl);
    this.felt = imageTexture(gl, publicUrl('tex/felt.webp'));
    this.dust = imageTexture(gl, publicUrl('tex/nebula-dust.webp'), { mirror: true });
    this.blue = imageTexture(gl, publicUrl('tex/bluenoise-128.png'), { nearest: true });
  }
  static create(canvas: HTMLCanvasElement): UnderLayer | null {
    const gl = context(canvas, false);
    if (!gl) return null;
    const neb = program(gl, 'nebula', FULLSCREEN_VS, NEBULA_FS, ['uNoise', 'uDust', 'uView', 'uCam', 'uTime', 'uPar', 'uScale', 'uSeed', 'uDustAmt', 'uDensity', 'uInk', 'uDeep', 'uUmber', 'uBlood', 'uVerd', 'uGold']);
    const under = program(gl, 'under', FULLSCREEN_VS, UNDER_FS, ['uNoise', 'uNeb', 'uFelt', 'uBlue', 'uView', 'uCam', 'uTime', 'uStars', 'uFelt_', 'uPar']);
    if (!neb || !under) return null;
    return new UnderLayer(canvas, gl, neb, under);
  }
  draw(f: StageFrame, w: number, h: number, q: (typeof TIERS)[Quality], tg: StageToggles, seed: number) {
    const gl = this.gl;
    this.nebT = target(gl, w * q.nebScale, h * q.nebScale, this.nebT);
    if (!this.nebT) return;
    const camKey = `${f.cam.x.toFixed(1)},${f.cam.y.toFixed(1)},${f.cam.z.toFixed(4)},${w},${h},${tg.nebula}`;
    const redrawNeb = camKey !== this.lastCam || this.frame % q.nebEvery === 0;
    this.frame++;
    if (redrawNeb) {
      this.lastCam = camKey;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.nebT.fb);
      gl.viewport(0, 0, this.nebT.w, this.nebT.h);
      gl.disable(gl.BLEND);
      const P = this.neb; gl.useProgram(P.prog);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.noise); gl.uniform1i(P.u.uNoise, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.dust.tex); gl.uniform1i(P.u.uDust, 1);
      gl.uniform2f(P.u.uView, w, h);
      gl.uniform3f(P.u.uCam, f.cam.x, f.cam.y, f.cam.z);
      gl.uniform1f(P.u.uTime, f.t);
      gl.uniform1f(P.u.uPar, 0.55);
      gl.uniform1f(P.u.uScale, 1 / 820);
      gl.uniform1f(P.u.uSeed, (seed % 997) * 0.731);
      gl.uniform1f(P.u.uDustAmt, 0.7);
      gl.uniform1f(P.u.uDensity, tg.nebula ? 1 : -3);
      gl.uniform3fv(P.u.uInk, hex3(SKY.ink)); gl.uniform3fv(P.u.uDeep, hex3(SKY.deep));
      gl.uniform3fv(P.u.uUmber, hex3(SKY.umber)); gl.uniform3fv(P.u.uBlood, hex3(SKY.blood));
      gl.uniform3fv(P.u.uVerd, hex3(SKY.verd)); gl.uniform3fv(P.u.uGold, hex3(SKY.gold));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const U = this.under; gl.useProgram(U.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.noise); gl.uniform1i(U.u.uNoise, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.nebT.tex); gl.uniform1i(U.u.uNeb, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.felt.tex); gl.uniform1i(U.u.uFelt, 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.blue.tex); gl.uniform1i(U.u.uBlue, 3);
    gl.uniform2f(U.u.uView, w, h);
    gl.uniform3f(U.u.uCam, f.cam.x, f.cam.y, f.cam.z);
    gl.uniform1f(U.u.uTime, f.t);
    gl.uniform1f(U.u.uStars, tg.stars ? 1 : 0);
    gl.uniform1f(U.u.uFelt_, tg.felt ? 0.12 : 0);
    gl.uniform2f(U.u.uPar, 0.04, 0.12);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  dispose() { dropTarget(this.gl, this.nebT); this.nebT = null; }
  /** force a nebula redraw on the next frame */
  forget() { this.lastCam = ''; }
}

class LightLayer {
  gl: GL; light: Program; bright: Program; blur: Program; corona: Program;
  noise: WebGLTexture | null;
  vao: WebGLVertexArrayObject | null; inst: WebGLBuffer | null;
  instData = new Float32Array(MAX_STARS * 8);
  srcTex: WebGLTexture | null;
  bA: Target | null = null; bB: Target | null = null;
  small: HTMLCanvasElement = document.createElement('canvas');
  smallCtx: CanvasRenderingContext2D | null = null;
  black: WebGLTexture | null;
  constructor(public canvas: HTMLCanvasElement, gl: GL, ps: Program[]) {
    this.gl = gl;
    [this.light, this.bright, this.blur, this.corona] = ps;
    this.noise = noiseTexture(gl, 256, 4242);
    this.srcTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.black = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.black);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    // instanced corona quads
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.inst = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, this.instData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
  }
  static create(canvas: HTMLCanvasElement): LightLayer | null {
    const gl = context(canvas, false);
    if (!gl) return null;
    const ps = [
      program(gl, 'light', FULLSCREEN_VS, LIGHT_FS, ['uNoise', 'uBloom', 'uView', 'uLamp', 'uWarm', 'uTime', 'uLampAmt', 'uBeamAmt', 'uBloomAmt', 'uMotes']),
      program(gl, 'bright', FULLSCREEN_VS, BRIGHT_FS, ['uSrc', 'uThresh']),
      program(gl, 'blur', FULLSCREEN_VS, BLUR_FS, ['uSrc', 'uDir']),
      program(gl, 'corona', CORONA_VS, CORONA_FS, ['uNoise', 'uView', 'uSpan', 'uTime', 'uAmt']),
    ];
    if (ps.some(p => !p)) return null;
    return new LightLayer(canvas, gl, ps as Program[]);
  }
  /** Downscale the 2D board to ~1/4 CSS res, upload, bright-pass, blur twice. Returns the bloom texture. */
  private bloom(src: HTMLCanvasElement, w: number, h: number): WebGLTexture | null {
    const gl = this.gl;
    const bw = Math.max(8, Math.round(w / 4)), bh = Math.max(8, Math.round(h / 4));
    if (this.small.width !== bw || this.small.height !== bh) { this.small.width = bw; this.small.height = bh; this.smallCtx = null; }
    this.smallCtx ??= this.small.getContext('2d', { alpha: true });
    const sc = this.smallCtx;
    if (!sc) return null;
    sc.clearRect(0, 0, bw, bh);
    sc.drawImage(src, 0, 0, bw, bh);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    // keep the canvas premultiplied: a 30%-alpha wash must bloom as a dim wash, not as its full colour
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.small);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.bA = target(gl, bw, bh, this.bA); this.bB = target(gl, bw, bh, this.bB);
    if (!this.bA || !this.bB) return null;
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, bw, bh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bA.fb);
    gl.useProgram(this.bright.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.srcTex); gl.uniform1i(this.bright.u.uSrc, 0);
    gl.uniform1f(this.bright.u.uThresh, 0.55);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(this.blur.prog);
    gl.uniform1i(this.blur.u.uSrc, 0);
    for (let i = 0; i < 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bB.fb);
      gl.bindTexture(gl.TEXTURE_2D, this.bA.tex); gl.uniform2f(this.blur.u.uDir, (1 + i) / bw, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bA.fb);
      gl.bindTexture(gl.TEXTURE_2D, this.bB.tex); gl.uniform2f(this.blur.u.uDir, 0, (1 + i) / bh);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.bA.tex;
  }
  draw(f: StageFrame, w: number, h: number, q: (typeof TIERS)[Quality], tg: StageToggles) {
    const gl = this.gl;
    const bloomOn = tg.bloom && q.bloom && !!f.bloomSrc;
    const bt = bloomOn ? this.bloom(f.bloomSrc!, w, h) : null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    if (tg.lamp || bt) {
      const L = this.light; gl.useProgram(L.prog);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.noise); gl.uniform1i(L.u.uNoise, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bt ?? this.black); gl.uniform1i(L.u.uBloom, 1);
      gl.uniform2f(L.u.uView, w, h);
      gl.uniform2f(L.u.uLamp, LAMP.uv[0], LAMP.uv[1]);
      gl.uniform3fv(L.u.uWarm, hex3(LAMP.color));
      gl.uniform1f(L.u.uTime, f.t);
      gl.uniform1f(L.u.uLampAmt, tg.lamp ? 0.075 : 0);
      gl.uniform1f(L.u.uBeamAmt, tg.lamp ? 0.05 : 0);
      gl.uniform1f(L.u.uBloomAmt, bt ? 0.85 : 0);
      gl.uniform1f(L.u.uMotes, tg.lamp && q.motes ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    const stars = tg.corona ? (f.stars ?? []) : [];
    const n = Math.min(MAX_STARS, stars.length);
    if (n) {
      const d = this.instData;
      for (let i = 0; i < n; i++) {
        const s = stars[i], c = hex3(s.color), o = i * 8;
        d[o] = s.x; d[o + 1] = s.y; d[o + 2] = s.r; d[o + 3] = s.amp;
        d[o + 4] = c[0]; d[o + 5] = c[1]; d[o + 6] = c[2]; d[o + 7] = (s.seed % 1000) / 1000;
      }
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      const C = this.corona; gl.useProgram(C.prog);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.noise); gl.uniform1i(C.u.uNoise, 0);
      gl.uniform2f(C.u.uView, w, h);
      gl.uniform1f(C.u.uSpan, 5.5);
      gl.uniform1f(C.u.uTime, f.t);
      gl.uniform1f(C.u.uAmt, 0.9);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, n * 8);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }
  }
  dispose() { dropTarget(this.gl, this.bA); dropTarget(this.gl, this.bB); this.bA = this.bB = null; }
}

class ShadeLayer {
  gl: GL; shade: Program; blue;
  constructor(public canvas: HTMLCanvasElement, gl: GL, p: Program) {
    this.gl = gl; this.shade = p;
    this.blue = imageTexture(gl, publicUrl('tex/bluenoise-128.png'), { nearest: true });
  }
  static create(canvas: HTMLCanvasElement): ShadeLayer | null {
    const gl = context(canvas, true);
    if (!gl) return null;
    const p = program(gl, 'shade', FULLSCREEN_VS, SHADE_FS, ['uBlue', 'uView', 'uLamp', 'uGrainOff', 'uEdge', 'uVig', 'uFall', 'uGrain']);
    return p ? new ShadeLayer(canvas, gl, p) : null;
  }
  draw(f: StageFrame, w: number, h: number) {
    const gl = this.gl, S = this.shade;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(S.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.blue.tex); gl.uniform1i(S.u.uBlue, 0);
    gl.uniform2f(S.u.uView, w, h);
    gl.uniform2f(S.u.uLamp, LAMP.uv[0], LAMP.uv[1]);
    // grain re-rolls 24 times a second, like film, not every frame
    const k = Math.floor(f.t * 24);
    gl.uniform2f(S.u.uGrainOff, ((k * 0.618) % 1), ((k * 0.381) % 1));
    gl.uniform3f(S.u.uEdge, 0.035, 0.022, 0.012);
    gl.uniform1f(S.u.uVig, 0.62);
    gl.uniform1f(S.u.uFall, 0.30);
    gl.uniform1f(S.u.uGrain, 0.075);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

export class ArtStage {
  readonly under: HTMLCanvasElement;
  readonly light: HTMLCanvasElement;
  readonly shade: HTMLCanvasElement;
  quality: Quality;
  toggles: StageToggles;
  lost = false;
  /** layers whose context is lost now / was lost since the layers were last built */
  private lostSet = new Set<HTMLCanvasElement>();
  private stale = new Set<HTMLCanvasElement>();
  private disposed = false;
  private reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private U: UnderLayer | null; private L: LightLayer | null; private S: ShadeLayer | null;
  private w = 0; private h = 0; private dpr = 1;
  private ema = 16.7; private lastT = 0; private slowFor = 0; private fastFor = 0;
  private seed: number;
  private onChange?: StageOptions['onChange'];
  private fixed: boolean;

  private constructor(under: HTMLCanvasElement, light: HTMLCanvasElement, shade: HTMLCanvasElement, U: UnderLayer, L: LightLayer, S: ShadeLayer, o: StageOptions) {
    this.under = under; this.light = light; this.shade = shade;
    this.U = U; this.L = L; this.S = S;
    this.quality = o.quality ?? ArtStage.defaultQuality();
    this.toggles = { nebula: true, stars: true, felt: true, corona: true, lamp: true, bloom: true, shade: true, ...o.toggles };
    this.seed = o.seed ?? 7;
    this.onChange = o.onChange;
    this.fixed = !!o.fixedQuality;
    // each layer has its own context: a GPU reset loses all three and the browser restores them one at a time, so
    // the stage stays lost until none is, and only the layers that were lost are rebuilt (the others keep their
    // programs and textures: rebuilding them leaked a set per loss)
    for (const c of [under, light, shade]) {
      c.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lostSet.add(c); this.stale.add(c); this.setLost(true); });
      c.addEventListener('webglcontextrestored', () => { this.lostSet.delete(c); this.restore(); });
    }
  }

  /** Phones start at medium (the governor may raise nothing, only lower); desktops at high. */
  static defaultQuality(): Quality {
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    return coarse ? 'medium' : 'high';
  }

  /** Build the three layers, or null (no WebGL2, or a shader failed): keep the 2D backdrop then. */
  static create(o: StageOptions = {}): ArtStage | null {
    const under = layerCanvas('artgl-under'), light = layerCanvas('artgl-light', 'screen'), shade = layerCanvas('artgl-shade');
    const U = UnderLayer.create(under), L = U && LightLayer.create(light), S = L && ShadeLayer.create(shade);
    if (!U || !L || !S) return null;
    return new ArtStage(under, light, shade, U, L, S, o);
  }

  /** Put the layers around a canvas: under before it, light and shade after it, in its positioned parent. */
  mount(around: HTMLElement) {
    const p = around.parentElement;
    if (!p) return;
    p.insertBefore(this.under, around);
    around.after(this.light);
    this.light.after(this.shade);
  }

  unmount() { this.under.remove(); this.light.remove(); this.shade.remove(); }

  dispose() {
    this.disposed = true; this.onChange = undefined;
    this.unmount();
    this.U?.dispose(); this.L?.dispose();
    for (const c of [this.under, this.light, this.shade]) (c.getContext('webgl2') as GL | null)?.getExtension('WEBGL_lose_context')?.loseContext();
  }

  /** A new map: the sky is seeded per galaxy. */
  setSeed(seed: number) { if (seed !== this.seed) { this.seed = seed; this.U?.forget(); } }
  /** Fixed: the player chose a tier, the governor keeps out of it. */
  setFixed(v: boolean) { this.fixed = v; this.slowFor = 0; }

  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q; this.w = 0;
    this.onChange?.({ quality: q, lost: this.lost });
  }

  private setLost(v: boolean) {
    this.lost = v;
    for (const c of [this.under, this.light, this.shade]) c.style.visibility = v ? 'hidden' : '';
    this.onChange?.({ quality: this.quality, lost: v });
  }

  private restore() {
    if (this.lostSet.size || this.disposed) return;
    const U = this.stale.has(this.under) ? UnderLayer.create(this.under) : this.U;
    const L = this.stale.has(this.light) ? LightLayer.create(this.light) : this.L;
    const S = this.stale.has(this.shade) ? ShadeLayer.create(this.shade) : this.S;
    if (U && L && S) { this.U = U; this.L = L; this.S = S; this.stale.clear(); this.w = 0; this.setLost(false); }
  }

  private resize(w: number, h: number) {
    const q = TIERS[this.quality];
    const dpr = Math.min(q.underDpr, window.devicePixelRatio || 1);
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w; this.h = h; this.dpr = dpr;
    const size = (c: HTMLCanvasElement, k: number) => { c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k)); };
    size(this.under, dpr);
    size(this.light, Math.min(dpr, q.lightScale));
    size(this.shade, q.shadeScale);
  }

  /** The governor: EMA of frame time; 2s over 21ms steps down one tier. Never steps up on its own. */
  private govern(now: number, frameDt?: number) {
    // a paced caller (every 2nd/3rd frame on a still board) or the lobby's 10 fps timer looked like a slow device:
    // an idle board stepped Auto down to low within seconds and it never came back up
    const gap = now - this.lastT;
    if (this.lastT && (frameDt !== undefined || gap <= 50)) {
      const dt = Math.min(100, frameDt ?? gap);
      this.ema += (dt - this.ema) * 0.05;
      if (this.ema > 21) { this.slowFor += dt; this.fastFor = 0; } else { this.fastFor += dt; this.slowFor = 0; }
      if (!this.fixed && this.slowFor > 2000) {
        this.slowFor = 0;
        if (this.quality === 'high') this.setQuality('medium');
        else if (this.quality === 'medium') this.setQuality('low');
      }
    }
    this.lastT = now;
  }

  /** Draw one frame. w/h: the viewport in CSS px (the 2D canvas's client size). */
  frame(f: StageFrame, w: number, h: number) {
    if (this.lost || !this.U || !this.L || !this.S) return;
    this.govern(performance.now(), f.dt);
    this.resize(w, h);
    const q = TIERS[this.quality], tg = this.toggles;
    // reduced motion: the sky, motes, twinkle and coronas hold still (state changes still show)
    if (this.reduced) f = { ...f, t: 0 };
    this.U.draw(f, w, h, q, tg, this.seed);
    this.L.draw(f, w, h, q, tg);
    this.shade.style.display = tg.shade ? 'block' : 'none';
    if (tg.shade) this.S.draw(f, w, h);
  }

  /** Smoothed frame time in ms (for an FPS readout). */
  get frameMs() { return this.ema; }
}

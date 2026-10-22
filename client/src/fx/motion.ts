// Motion helpers for the reward moments: easings, the reduced-motion switch, and the replay's own clock, which can
// stop for a hit-pause or run slow for the decisive volley without ever going backwards.
//
// The clock is real time minus a growing "debt": a hit-pause adds debt at 1 ms per ms (time stands still), slow motion
// at (1 − scale) ms per ms. The map, the fx and the beat progress all read this clock during a replay, so a pause
// freezes the whole table (the stamp mid-slam, the fireball, the tokens), then everything resumes where it was.
export const reduced = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** One overshoot, then settle (the art bible's "strike"). */
export const easeOutBack = (t: number, c = 1.4) => 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

interface Warp { from: number; to: number; scale: number }
export class ReplayClock {
  private debt = 0;
  private last = 0;
  private warps: Warp[] = [];
  /** Real now → replay now. Call once per frame with performance.now(); returns the warped time. */
  step(real: number): number {
    if (!this.last) this.last = real;
    const dt = Math.max(0, Math.min(250, real - this.last));
    // the scale for this slice: the slowest active warp (a hit-pause inside slow motion still stops)
    let scale = 1;
    for (const w of this.warps) if (real >= w.from && this.last < w.to) scale = Math.min(scale, w.scale);
    this.debt += dt * (1 - scale);
    this.last = real;
    this.warps = this.warps.filter(w => w.to > real);
    return real - this.debt;
  }
  /** The current replay time, without advancing. */
  get now(): number { return (this.last || performance.now()) - this.debt; }
  /** The time scale right now (1 normal, 0 paused, 0.35 slow motion). */
  get scale(): number {
    const t = this.last || performance.now();
    let s = 1;
    for (const w of this.warps) if (t >= w.from && t < w.to) s = Math.min(s, w.scale);
    return s;
  }
  /** Stop time for `ms` (real), starting `delay` ms from now (real). */
  hitPause(ms: number, delay = 0) { const t = (this.last || performance.now()) + delay; this.warps.push({ from: t, to: t + ms, scale: 0 }); }
  /** Run at `scale` for `ms` of real time, from `delay` ms from now. */
  slow(scale: number, ms: number, delay = 0) { const t = (this.last || performance.now()) + delay; this.warps.push({ from: t, to: t + ms, scale }); }
  /** Back to real time (the debt is forgiven: replay time jumps forward to real time, never back). */
  reset() { this.debt = 0; this.warps = []; this.last = 0; }
  get warping(): boolean { return this.warps.length > 0; }
}

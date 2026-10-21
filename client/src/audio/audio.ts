// Three Crowns audio: a small Web Audio engine.
//
//   ctx ─┬─ sfxBus ─────┐
//        ├─ musicBus ───┼─ master ─ limiter ─ destination
//        └─ ambientBus ─┘
//
// - Nothing is created until the first user gesture (iOS Safari only unlocks audio inside one): call
//   `audio.install()` once at boot; it arms one-shot pointer/key/touch listeners.
// - Volumes (master / sfx / music / ambient) and mute are persisted in localStorage ('tc.audio.v1').
// - SFX are decoded once, cached, and played through a per-name voice pool (polyphony cap + min gap), so a
//   battle with 40 shots in a frame stays a texture, not a wall.
// - Music and the ambient bed each crossfade between tracks.
// - `onGameEvent(ev)`, `onShot(shot)` and the `ui*` helpers map game semantics to sounds, so wiring the game
//   up is a handful of one-line hook calls (see docs/ASSETS.md, "Phase 2 integration").
//
// All files live in client/public/audio/<name>.ogg (Vorbis) and <name>.m4a (AAC, for Safari).
// Every asset is CC0; see client/public/CREDITS.txt.
import type { GameEvent, PlayerId, ShotRec } from '../../../shared/sim/types.ts';

// ------------------------------------------------------------------ catalogue
export type SfxName =
  | 'ui_click' | 'ui_hover' | 'ui_open' | 'ui_close' | 'ui_error' | 'ui_confirm' | 'ui_seal'
  | 'ui_coin' | 'ui_banner' | 'ui_page'
  | 'game_order' | 'game_move' | 'game_capture' | 'game_research' | 'game_turn'
  | 'bt_laser' | 'bt_laser_heavy' | 'bt_cannon' | 'bt_explosion' | 'bt_shield' | 'bt_destroyed'
  | 'st_called' | 'st_caught' | 'st_victory' | 'st_defeat';
export type TrackName = 'amb_drone' | 'mus_board' | 'mus_theme';
export type Bus = 'master' | 'sfx' | 'music' | 'ambient';

interface SfxDef {
  vol: number;      // base gain (files are peak-normalised; this sets the mix)
  jitter: number;   // default random pitch spread, in semitones (±)
  voices: number;   // max simultaneous voices of this sound
  gap: number;      // min ms between two starts of this sound (extra calls are dropped)
  duck?: number;    // duck music+ambient to this factor while it plays (stings)
}
const SFX: Record<SfxName, SfxDef> = {
  ui_click:       { vol: 0.45, jitter: 0.6, voices: 3, gap: 30 },
  ui_hover:       { vol: 0.16, jitter: 0.8, voices: 2, gap: 45 },
  ui_open:        { vol: 0.45, jitter: 0.3, voices: 2, gap: 60 },
  ui_close:       { vol: 0.40, jitter: 0.3, voices: 2, gap: 60 },
  ui_error:       { vol: 0.40, jitter: 0,   voices: 1, gap: 200 },
  ui_confirm:     { vol: 0.45, jitter: 0,   voices: 1, gap: 120 },
  ui_seal:        { vol: 0.65, jitter: 0.2, voices: 1, gap: 250 },
  ui_coin:        { vol: 0.55, jitter: 0.5, voices: 2, gap: 80 },
  ui_banner:      { vol: 0.60, jitter: 0.2, voices: 1, gap: 300 },
  ui_page:        { vol: 0.50, jitter: 0.6, voices: 2, gap: 90 },
  game_order:     { vol: 0.55, jitter: 0.8, voices: 3, gap: 40 },
  game_move:      { vol: 0.30, jitter: 1.5, voices: 3, gap: 70 },
  game_capture:   { vol: 0.60, jitter: 0.3, voices: 2, gap: 200 },
  game_research:  { vol: 0.50, jitter: 0,   voices: 1, gap: 250 },
  game_turn:      { vol: 0.45, jitter: 0,   voices: 1, gap: 500 },
  bt_laser:       { vol: 0.28, jitter: 2.0, voices: 5, gap: 25 },
  bt_laser_heavy: { vol: 0.36, jitter: 1.2, voices: 3, gap: 50 },
  bt_cannon:      { vol: 0.45, jitter: 1.0, voices: 3, gap: 60 },
  bt_explosion:   { vol: 0.50, jitter: 1.5, voices: 3, gap: 70 },
  bt_shield:      { vol: 0.35, jitter: 1.0, voices: 2, gap: 80 },
  bt_destroyed:   { vol: 0.65, jitter: 0.8, voices: 2, gap: 150 },
  st_called:      { vol: 0.70, jitter: 0,   voices: 1, gap: 400, duck: 0.35 },
  st_caught:      { vol: 0.70, jitter: 0,   voices: 1, gap: 400, duck: 0.35 },
  st_victory:     { vol: 0.85, jitter: 0,   voices: 1, gap: 2000, duck: 0.15 },
  st_defeat:      { vol: 0.85, jitter: 0,   voices: 1, gap: 2000, duck: 0.15 },
};
export const SFX_NAMES = Object.keys(SFX) as SfxName[];
export const TRACK_NAMES: TrackName[] = ['amb_drone', 'mus_board', 'mus_theme'];
/** Every file in client/public/audio (without extension). */
export const ALL_AUDIO: string[] = [...SFX_NAMES, ...TRACK_NAMES];

/** Track mix levels (files are loudness-normalised: drone −26 LUFS, board −24, theme −20). */
const TRACK_VOL: Record<TrackName, number> = { amb_drone: 0.9, mus_board: 0.9, mus_theme: 0.7 };

// ------------------------------------------------------------------ settings
export interface AudioSettings { master: number; sfx: number; music: number; ambient: number; muted: boolean }
/** Respectful defaults: music quiet, the ambient bed on, nothing ever plays before a gesture. */
export const DEFAULT_SETTINGS: AudioSettings = { master: 0.8, sfx: 0.75, music: 0.3, ambient: 0.5, muted: false };
const KEY = 'tc.audio.v1';

function loadSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const o = JSON.parse(raw) as Partial<AudioSettings>;
    const n = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
    return {
      master: n(o.master, DEFAULT_SETTINGS.master), sfx: n(o.sfx, DEFAULT_SETTINGS.sfx),
      music: n(o.music, DEFAULT_SETTINGS.music), ambient: n(o.ambient, DEFAULT_SETTINGS.ambient),
      muted: typeof o.muted === 'boolean' ? o.muted : DEFAULT_SETTINGS.muted,
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s: AudioSettings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } }

export interface SfxOpts {
  vol?: number;         // multiplier on the sound's base volume
  pitchJitter?: number; // ± semitones of random pitch (default: the sound's own)
  rate?: number;        // fixed playback-rate multiplier (applied before jitter)
  pan?: number;         // -1..1
  delay?: number;       // seconds from now
}

type Listener = (s: AudioSettings) => void;
interface Voice { src: AudioBufferSourceNode; gain: GainNode; t: number }
interface Slot { name: TrackName; src: AudioBufferSourceNode; gain: GainNode }
const AC: typeof AudioContext | undefined = typeof window === 'undefined' ? undefined
  : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);

// ------------------------------------------------------------------ engine
export class AudioEngine {
  ctx: AudioContext | null = null;
  private settings = loadSettings();
  private buses: Record<Bus, GainNode> | null = null;
  private duckGain: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private decoded = new Map<string, AudioBuffer>();
  private voices = new Map<SfxName, Voice[]>();
  private lastStart = new Map<SfxName, number>();
  private slots: { music: Slot | null; ambient: Slot | null } = { music: null, ambient: null };
  private want: { music: TrackName | null; ambient: TrackName | null } = { music: null, ambient: null };
  private listeners = new Set<Listener>();
  private installed = false;
  private ext: 'ogg' | 'm4a' = 'ogg';
  /** Folder the files are served from (Vite serves client/public at the site root). */
  base = 'audio/';
  /** Errors seen while loading/decoding (for the check script and debugging). */
  errors: string[] = [];
  /** The local player, so onGameEvent can tell "mine" from "theirs". Set it when a game starts. */
  me: PlayerId | null = null;

  /** Arm the one-shot unlock on the first user gesture. Safe to call more than once. */
  install(): void {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;
    const evs = ['pointerdown', 'touchend', 'keydown', 'mousedown'] as const;
    const go = () => {
      if (!this.unlock()) return;
      for (const e of evs) window.removeEventListener(e, go, true);
    };
    for (const e of evs) window.addEventListener(e, go, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend().catch(() => {});
      else void this.ctx.resume().catch(() => {});
    });
  }

  /** Create/resume the context. Must run inside a user gesture on iOS. Returns true once running. */
  unlock(): boolean {
    if (!AC) return false;
    try {
      if (!this.ctx) {
        const ctx = new AC({ latencyHint: 'interactive' });
        this.ctx = ctx;
        this.ext = pickExt();
        const master = ctx.createGain();
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -6; limiter.knee.value = 6; limiter.ratio.value = 8;
        limiter.attack.value = 0.003; limiter.release.value = 0.2;
        master.connect(limiter).connect(ctx.destination);
        this.duckGain = ctx.createGain();
        this.duckGain.connect(master);
        const mk = (to: AudioNode) => { const g = ctx.createGain(); g.connect(to); return g; };
        this.buses = { master, sfx: mk(master), music: mk(this.duckGain), ambient: mk(this.duckGain) };
        this.applyVolumes(0);
        // iOS: play one silent sample inside the gesture to fully unlock output.
        const b = ctx.createBuffer(1, 1, 22050); const s = ctx.createBufferSource();
        s.buffer = b; s.connect(ctx.destination); s.start(0);
        void this.preload(['ui_click', 'ui_hover', 'ui_open', 'ui_close']);
      }
      if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
      // Start whatever was requested before the unlock.
      if (this.want.ambient) this.ambient(this.want.ambient, { fade: 2.5 });
      if (this.want.music) this.music(this.want.music, { fade: 2.5 });
      return true;
    } catch (e) { this.errors.push('unlock: ' + String(e)); return false; }
  }

  get unlocked(): boolean { return !!this.ctx; }

  // ---------------------------------------------------------------- settings
  getSettings(): AudioSettings { return { ...this.settings }; }
  setVolume(bus: Bus, v: number): void {
    this.settings[bus] = Math.min(1, Math.max(0, v));
    this.commit();
  }
  setMuted(m: boolean): void { this.settings.muted = m; this.commit(); }
  toggleMute(): boolean { this.setMuted(!this.settings.muted); return this.settings.muted; }
  reset(): void { this.settings = { ...DEFAULT_SETTINGS }; this.commit(); }
  /** Subscribe to settings changes (for a settings panel / mute button). Returns an unsubscribe. */
  subscribe(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private commit() {
    saveSettings(this.settings);
    this.applyVolumes(0.08);
    for (const l of this.listeners) l(this.getSettings());
  }
  private applyVolumes(ramp: number) {
    if (!this.ctx || !this.buses) return;
    const s = this.settings, t = this.ctx.currentTime;
    const set = (g: GainNode, v: number) => {
      g.gain.cancelScheduledValues(t);
      if (ramp > 0) { g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(v, t + ramp); }
      else g.gain.setValueAtTime(v, t);
    };
    // perceptual-ish curve: slider² so the low half of a slider is usable
    const c = (v: number) => v * v;
    set(this.buses.master, s.muted ? 0 : c(s.master));
    set(this.buses.sfx, c(s.sfx));
    set(this.buses.music, c(s.music));
    set(this.buses.ambient, c(s.ambient));
  }

  // ---------------------------------------------------------------- loading
  url(name: string, ext: 'ogg' | 'm4a' = this.ext): string {
    try { return new URL(`${this.base}${name}.${ext}`, document.baseURI).href; }
    catch { return `${this.base}${name}.${ext}`; }
  }
  private fetchDecode(ctx: AudioContext, name: string, ext: 'ogg' | 'm4a'): Promise<AudioBuffer> {
    return fetch(this.url(name, ext))
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((ab) => new Promise<AudioBuffer>((res, rej) => {
        // callback form for old Safari; promise form everywhere else
        const ret = ctx.decodeAudioData(ab, res, rej) as Promise<AudioBuffer> | undefined;
        if (ret && typeof ret.then === 'function') ret.then(res, rej);
      }));
  }
  /** Fetch + decode (cached), falling back to the other format. Resolves null on failure (see `errors`). */
  load(name: string): Promise<AudioBuffer | null> {
    const hit = this.buffers.get(name);
    if (hit) return hit;
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve(null);
    const alt = this.ext === 'ogg' ? 'm4a' : 'ogg';
    const p = this.fetchDecode(ctx, name, this.ext)
      .catch(() => this.fetchDecode(ctx, name, alt))
      .then((b) => { this.decoded.set(name, b); return b; })
      .catch((e) => { this.errors.push(`${name}: ${String(e)}`); this.buffers.delete(name); return null; });
    this.buffers.set(name, p);
    return p;
  }
  /** Warm the cache (e.g. battle sounds when the battle viewer opens). Default: every SFX. */
  preload(names: string[] = SFX_NAMES): Promise<(AudioBuffer | null)[]> {
    return Promise.all(names.map((n) => this.load(n)));
  }

  // ---------------------------------------------------------------- sfx
  /**
   * Play a one-shot. Never throws; silently drops when locked, muted, rate-limited, or not yet decoded
   * (the first call kicks off the load, so late sounds don't fire out of sync).
   */
  sfx(name: SfxName, o: SfxOpts = {}): void {
    const ctx = this.ctx, buses = this.buses, def = SFX[name];
    if (!ctx || !buses || !def || this.settings.muted || this.settings.sfx <= 0) return;
    const buf = this.decoded.get(name);
    if (!buf) { void this.load(name); return; }
    const now = performance.now();
    if (now - (this.lastStart.get(name) ?? -1e9) < def.gap) return;
    this.lastStart.set(name, now);
    const pool = (this.voices.get(name) ?? []).filter((v) => v.t > ctx.currentTime);
    while (pool.length >= def.voices) {
      const old = pool.shift()!;
      try { old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.015); old.src.stop(ctx.currentTime + 0.06); } catch { /* */ }
    }
    try {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const j = o.pitchJitter ?? def.jitter;
      const semis = j ? (Math.random() * 2 - 1) * j : 0;
      src.playbackRate.value = (o.rate ?? 1) * Math.pow(2, semis / 12);
      const gain = ctx.createGain();
      gain.gain.value = def.vol * (o.vol ?? 1);
      let tail: AudioNode = gain;
      if (o.pan && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan));
        gain.connect(p); tail = p;
      }
      src.connect(gain); tail.connect(buses.sfx);
      const at = ctx.currentTime + Math.max(0, o.delay ?? 0);
      src.start(at);
      const end = at + buf.duration / src.playbackRate.value;
      const v: Voice = { src, gain, t: end };
      pool.push(v); this.voices.set(name, pool);
      src.onended = () => { try { gain.disconnect(); tail.disconnect(); } catch { /* */ } };
      if (def.duck !== undefined) this.duck(def.duck, at, end - at);
    } catch (e) { this.errors.push(`sfx ${name}: ${String(e)}`); }
  }

  /** Dip music + ambient to `to` for `dur` seconds starting at `at` (context time). */
  private duck(to: number, at: number, dur: number) {
    if (!this.duckGain) return;
    const g = this.duckGain.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(to, at, 0.08);
    g.setTargetAtTime(1, at + Math.max(0.3, dur - 0.4), 0.6);
  }

  // ---------------------------------------------------------------- music / ambient
  /** Crossfade the music bus to `name` (null = fade out). Remembered and started on unlock if locked. */
  music(name: TrackName | null, o: { fade?: number } = {}): void { this.crossfade('music', name, o.fade ?? 3); }
  /** Crossfade the ambient bed to `name` (null = fade out). */
  ambient(name: TrackName | null, o: { fade?: number } = {}): void { this.crossfade('ambient', name, o.fade ?? 3); }
  /** Stop music and ambient. */
  stopAll(fade = 1): void { this.music(null, { fade }); this.ambient(null, { fade }); }

  private crossfade(bus: 'music' | 'ambient', name: TrackName | null, fade: number) {
    this.want[bus] = name;
    const ctx = this.ctx, buses = this.buses;
    if (!ctx || !buses) return;
    const cur = this.slots[bus];
    if (cur && cur.name === name) return;
    const t = ctx.currentTime;
    if (cur) {
      cur.gain.gain.cancelScheduledValues(t);
      cur.gain.gain.setValueAtTime(cur.gain.gain.value, t);
      cur.gain.gain.linearRampToValueAtTime(0, t + fade);
      try { cur.src.stop(t + fade + 0.05); } catch { /* */ }
      this.slots[bus] = null;
    }
    if (!name) return;
    void this.load(name).then((buf) => {
      if (!buf || this.want[bus] !== name || this.slots[bus]?.name === name) return;
      const t0 = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(TRACK_VOL[name], t0 + fade);
      src.connect(gain).connect(buses[bus]);
      src.start(t0);
      this.slots[bus] = { name, src, gain };
    });
  }

  // ---------------------------------------------------------------- semantic layer
  /** UI shorthand. */
  ui(kind: 'click' | 'hover' | 'open' | 'close' | 'error' | 'confirm' | 'seal' | 'coin' | 'banner' | 'page' | 'order'): void {
    this.sfx(kind === 'order' ? 'game_order' : (`ui_${kind}` as SfxName));
  }

  /**
   * Map one sim event to a sound. Call once per event as the replay reaches it (pulse by pulse), or pass a
   * whole batch to `onGameEvents`. Perspective-aware when `me` is set: your own fleet blocked = error, a
   * posture you won = CALLED IT, a posture that caught you (or you lost) = CAUGHT OUT.
   */
  onGameEvent(ev: GameEvent, o: { pan?: number; delay?: number } = {}): void {
    const me = this.me;
    const mine = (p: PlayerId | null | undefined | -1) => me !== null && p === me;
    const s = (n: SfxName, x: SfxOpts = {}) => this.sfx(n, { ...o, ...x });
    switch (ev.k) {
      case 'move': s('game_move', { vol: ev.guard ? 0.6 : 1 }); break;
      case 'retreat': case 'rout': s('game_move', { rate: 0.8, vol: 0.8 }); break;
      case 'blocked': if (me === null || mine(ev.owner)) s('ui_error', { vol: 0.6 }); break;
      case 'clash': s('bt_laser_heavy', { vol: 0.8 }); break;
      case 'battle': s('bt_cannon'); s('bt_laser', { delay: (o.delay ?? 0) + 0.12 }); break;
      case 'destroyed': s('bt_destroyed', { vol: mine(ev.owner) ? 1 : 0.8 }); break;
      case 'capture': s('game_capture', { rate: ev.how === 'influence' ? 1.12 : 1 }); break;
      case 'build': s('game_order', { vol: 0.8 }); break;
      case 'project': if (ev.done) s('game_research'); break;
      case 'tech': s('game_research', { vol: ev.stolen ? 0.7 : 1 }); break;
      case 'excavate': s('game_research', { rate: 0.9 }); break;
      case 'law': s('ui_seal', { vol: 0.7 }); break;
      case 'fortify': case 'refit': s('game_order', { vol: 0.6, rate: 0.85 }); break;
      case 'pact': s(ev.formed ? 'ui_seal' : 'ui_close'); break;
      case 'betrayal': s('st_caught'); break;
      case 'fail': if (me === null || mine(ev.owner)) s('ui_error', { vol: 0.5 }); break;
      case 'fate': s('ui_coin'); break;
      case 'posture': {
        if (ev.outcome === 'none') break;
        // From my side: my bet paid -> CALLED IT; someone's bet paid against me, or mine failed -> CAUGHT OUT.
        const good = me === null ? ev.outcome === 'called' : mine(ev.owner) === (ev.outcome === 'called');
        s(good ? 'st_called' : 'st_caught');
        break;
      }
      case 'soul':
        if (ev.kind === 'founded' || ev.kind === 'coronation') s('ui_banner');
        else if (ev.kind === 'razed' || ev.kind === 'plunder') s('bt_explosion', { vol: 0.7, rate: 0.8 });
        else if (ev.kind === 'vow_broken' || ev.kind === 'broken' || ev.kind === 'debt') s('st_caught', { vol: 0.6 });
        else if (ev.kind === 'liberated' || ev.kind === 'vow_kept' || ev.kind === 'vengeance') s('game_capture', { vol: 0.7, rate: 1.1 });
        else s('ui_page', { vol: 0.6 });
        break;
      default: break; // pulse, scan, influence, note, tribute...: silent
    }
  }
  /** A batch (e.g. all events of one replay pulse); the voice pools keep stacks tidy. */
  onGameEvents(evs: readonly GameEvent[], o: { stagger?: number } = {}): void {
    evs.forEach((e, i) => this.onGameEvent(e, { delay: (o.stagger ?? 0) * i }));
  }

  /** Battle viewer: one shot from a BattleReport round. `pan` -1..1 from the shooter's screen x if handy. */
  onShot(shot: ShotRec, o: { pan?: number; heavy?: boolean; delay?: number } = {}): void {
    const x = { pan: o.pan, delay: o.delay };
    if (shot.twist) { this.sfx('bt_shield', x); return; }
    this.sfx(shot.first ? 'bt_cannon' : o.heavy || shot.crit ? 'bt_laser_heavy' : 'bt_laser', x);
    if (shot.miss) return;
    const d = (o.delay ?? 0) + 0.12;
    if (shot.kill) this.sfx('bt_destroyed', { pan: o.pan, delay: d + 0.05 });
    else if (shot.crit) this.sfx('bt_explosion', { pan: o.pan, delay: d });
    else if (shot.dmg > 0 && Math.random() < 0.35) this.sfx('bt_shield', { pan: o.pan, delay: d, vol: 0.6 });
  }

  /** The turn finished resolving (replay starts / new plan phase). */
  turnResolved(): void { this.sfx('game_turn'); }
  /** End of game. Swaps to the theme after the sting. */
  gameOver(won: boolean): void {
    this.sfx(won ? 'st_victory' : 'st_defeat');
    this.ambient(null, { fade: 2 });
    this.music('mus_theme', { fade: 6 });
  }
  /** Scene presets. */
  scene(s: 'lobby' | 'board' | 'battle' | 'off'): void {
    if (s === 'lobby') { this.ambient(null); this.music('mus_theme'); }
    else if (s === 'board') { this.ambient('amb_drone'); this.music('mus_board'); }
    else if (s === 'battle') { this.ambient('amb_drone'); this.music('mus_board', { fade: 1 }); }
    else this.stopAll();
  }
}

function pickExt(): 'ogg' | 'm4a' {
  try {
    const a = document.createElement('audio');
    if (a.canPlayType('audio/ogg; codecs="vorbis"')) return 'ogg';
  } catch { /* */ }
  return 'm4a';
}

/** The app-wide engine. */
export const audio = new AudioEngine();

// Convenience re-exports for one-liner hooks.
export const sfx = (name: SfxName, o?: SfxOpts) => audio.sfx(name, o);
export const onGameEvent = (ev: GameEvent) => audio.onGameEvent(ev);

/**
 * A minimal settings block (mute + four sliders), unstyled except for class names, for the menu/help modal.
 * Classes: .audio-settings, .audio-row, .audio-mute. Keeps itself in sync with the engine.
 */
export function audioSettingsPanel(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'audio-settings';
  const mute = document.createElement('button');
  mute.type = 'button'; mute.className = 'audio-mute';
  mute.addEventListener('click', () => { audio.unlock(); audio.toggleMute(); audio.sfx('ui_click'); });
  root.append(mute);
  const rows: [Bus, string][] = [['master', 'Master'], ['sfx', 'Effects'], ['music', 'Music'], ['ambient', 'Ambience']];
  const inputs = new Map<Bus, HTMLInputElement>();
  for (const [bus, label] of rows) {
    const row = document.createElement('label'); row.className = 'audio-row';
    const span = document.createElement('span'); span.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = '0'; inp.max = '100'; inp.step = '1';
    inp.addEventListener('input', () => audio.setVolume(bus, Number(inp.value) / 100));
    if (bus === 'sfx') inp.addEventListener('change', () => audio.sfx('ui_click'));
    row.append(span, inp); root.append(row); inputs.set(bus, inp);
  }
  const sync = (s: AudioSettings) => {
    mute.textContent = s.muted ? 'Sound: off' : 'Sound: on';
    mute.setAttribute('aria-pressed', String(!s.muted));
    for (const [bus, inp] of inputs) inp.value = String(Math.round(s[bus] * 100));
  };
  sync(audio.getSettings());
  const off = audio.subscribe(sync);
  // stop listening once removed from the DOM
  const mo = new MutationObserver(() => { if (!root.isConnected) { off(); mo.disconnect(); } });
  queueMicrotask(() => { if (root.parentNode) mo.observe(document.body, { childList: true, subtree: true }); });
  return root;
}

// Audio check: every file in client/public/audio decodes (decodeAudioData, both .ogg and .m4a where the
// browser supports the codec), is not silent, and the engine in client/src/audio/audio.ts unlocks on a
// gesture, plays every SFX, crossfades music/ambient, mutes and persists settings without errors.
// Also checks every texture in client/public/tex loads.
//   node scripts/audio-check.mjs [baseUrl]        (needs the Vite dev server: `npm run dev`, default :5173)
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base = (process.argv[2] ?? 'http://localhost:5173/').replace(/\/?$/, '/');
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--autoplay-policy=user-gesture-required'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
// A blank same-origin page so the game itself doesn't boot; module imports still go through Vite.
const testUrl = base + '__audio-check.html';
await page.route(testUrl, (r) => r.fulfill({
  contentType: 'text/html',
  body: '<!doctype html><meta charset="utf-8"><title>audio check</title><body style="background:#111;height:100vh"></body>',
}));
await page.goto(testUrl);

const res = await page.evaluate(async () => {
  const A = await import('/src/audio/audio.ts');
  const T = await import('/src/art/textures.ts');
  const out = { files: [], codecs: {}, engine: {}, textures: [] };
  const probe = document.createElement('audio');
  out.codecs = { ogg: probe.canPlayType('audio/ogg; codecs="vorbis"'), m4a: probe.canPlayType('audio/mp4; codecs="mp4a.40.2"') };

  // 1. raw decode of every file in both formats (own context so this is independent of the engine)
  const ctx = new OfflineAudioContext(2, 44100, 44100);
  for (const name of A.ALL_AUDIO) for (const ext of ['ogg', 'm4a']) {
    const rec = { name, ext };
    try {
      const r = await fetch(`/audio/${name}.${ext}`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const ab = await r.arrayBuffer();
      rec.bytes = ab.byteLength;
      const b = await ctx.decodeAudioData(ab);
      let peak = 0;
      for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i += 7) peak = Math.max(peak, Math.abs(d[i])); }
      Object.assign(rec, { ok: true, dur: +b.duration.toFixed(2), ch: b.numberOfChannels, peak: +peak.toFixed(3) });
    } catch (e) { rec.ok = false; rec.err = String(e); }
    out.files.push(rec);
  }

  // 2. the engine
  const eng = A.audio;
  eng.install();
  out.engine.lockedBefore = !eng.unlocked;
  window.__eng = eng;
  return out;
});

// a real gesture unlocks the context
await page.mouse.click(50, 50);
const eng = await page.evaluate(async () => {
  const A = await import('/src/audio/audio.ts');
  const eng = A.audio;
  const o = { unlocked: eng.unlocked, state: eng.ctx?.state };
  const t0 = performance.now();
  const bufs = await eng.preload([...A.SFX_NAMES, ...A.TRACK_NAMES]);
  o.preloadMs = Math.round(performance.now() - t0);
  o.preloaded = bufs.filter(Boolean).length;
  o.expected = A.SFX_NAMES.length + A.TRACK_NAMES.length;
  for (const n of A.SFX_NAMES) eng.sfx(n, { vol: 0.5 });
  eng.ui('click'); eng.ui('hover');
  // semantic layer
  eng.me = 0;
  const evs = [
    { k: 'move', pulse: 1, step: 0, fleet: 1, owner: 0, from: 0, to: 1, ships: 3 },
    { k: 'battle', pulse: 1, region: 1, battle: 1, name: 'x', parties: [0, 1] },
    { k: 'destroyed', pulse: 1, fleet: 2, owner: 1, region: 1, name: 'x' },
    { k: 'capture', pulse: 1, region: 1, by: 0, from: 1, how: 'force' },
    { k: 'posture', pulse: 1, owner: 0, posture: 'charge', outcome: 'called', region: 1, text: '' },
    { k: 'posture', pulse: 1, owner: 1, posture: 'ambush', outcome: 'called', region: 1, text: '' },
    { k: 'fate', pulse: 1, owner: 0, use: 'surge', text: '', left: 1 },
    { k: 'tech', pulse: 1, owner: 0, tech: 'x' },
    { k: 'soul', pulse: 1, kind: 'founded', owner: 0, text: '' },
  ];
  eng.onGameEvents(evs, { stagger: 0.05 });
  for (const s of [{ from: 0, to: 1, dmg: 3 }, { from: 0, to: 1, dmg: 0, miss: true }, { from: 0, to: 1, dmg: 9, kill: true }, { from: 1, to: 0, dmg: 2, crit: 'engines' }, { from: 1, to: 0, dmg: 0, twist: true }, { from: 1, to: 0, dmg: 4, first: true }])
    eng.onShot(s, { pan: Math.random() * 2 - 1 });
  eng.turnResolved();
  // music + ambient crossfade
  eng.scene('board');
  await new Promise((r) => setTimeout(r, 400));
  o.slotsBoard = { music: eng.slots.music?.name, ambient: eng.slots.ambient?.name };
  eng.music('mus_theme', { fade: 0.3 });
  await new Promise((r) => setTimeout(r, 500));
  o.slotsTheme = { music: eng.slots.music?.name, ambient: eng.slots.ambient?.name };
  eng.gameOver(true);
  // settings: volume, mute, persistence
  eng.setVolume('music', 0.42);
  const muted = eng.toggleMute();
  o.mutedToggle = muted;
  o.persisted = JSON.parse(localStorage.getItem('tc.audio.v1') || 'null');
  eng.setMuted(false); eng.reset();
  // panel builds
  const panel = A.audioSettingsPanel(); document.body.append(panel);
  o.panelInputs = panel.querySelectorAll('input[type=range]').length;
  panel.remove();
  await new Promise((r) => setTimeout(r, 300));
  o.state2 = eng.ctx?.state;
  o.engineErrors = eng.errors.slice();
  return o;
});

const tex = await page.evaluate(async () => {
  const T = await import('/src/art/textures.ts');
  const names = Object.keys(T.TEXTURES);
  const imgs = await T.preloadTextures();
  return names.map((n, i) => ({ name: n, ok: !!imgs[i], w: imgs[i]?.naturalWidth ?? 0 }));
});
await browser.close();

// ---------------------------------------------------------------- report
let fail = 0;
const bad = [];
console.log('codec support:', JSON.stringify(res.codecs));
for (const f of res.files) {
  const supported = f.ext === 'ogg' ? res.codecs.ogg : res.codecs.m4a;
  const flag = f.ok ? (f.peak < 0.01 ? 'SILENT' : 'ok') : supported ? 'FAIL' : 'skip (codec unsupported in this Chromium)';
  if (f.ok && f.peak < 0.01) { fail++; bad.push(f); }
  if (!f.ok && supported) { fail++; bad.push(f); }
  console.log(`  ${(f.name + '.' + f.ext).padEnd(22)} ${String(f.bytes ?? '-').padStart(7)} B  ${f.ok ? `${f.dur}s ${f.ch}ch peak ${f.peak}` : f.err}  ${flag}`);
}
const okOgg = res.files.filter((f) => f.ext === 'ogg' && f.ok).length;
const okM4a = res.files.filter((f) => f.ext === 'm4a' && f.ok).length;
const n = res.files.length / 2;
console.log(`decoded in Chromium: ogg ${okOgg}/${n}, m4a ${okM4a}/${n}`);
// Chromium builds without proprietary codecs can't decode AAC; decode the .m4a files with ffmpeg instead
// (the format Safari will pick) and compare durations with the .ogg twin.
if (!res.codecs.m4a) {
  const dir = fileURLToPath(new URL('../client/public/audio/', import.meta.url));
  const ff = spawnSync('ffmpeg', ['-version']);
  if (ff.status !== 0) console.log('  (ffmpeg not found: .m4a files not verified)');
  else {
    let ok = 0;
    for (const f of res.files.filter((x) => x.ext === 'm4a')) {
      const twin = res.files.find((x) => x.ext === 'ogg' && x.name === f.name);
      const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', dir + f.name + '.m4a'], { encoding: 'utf8' });
      const d = spawnSync('ffmpeg', ['-v', 'error', '-i', dir + f.name + '.m4a', '-f', 'null', '-'], { encoding: 'utf8' });
      const dur = parseFloat(r.stdout);
      const good = r.status === 0 && d.status === 0 && !d.stderr.trim() && twin && Math.abs(dur - twin.dur) < 0.12;
      if (good) ok++; else { fail++; console.log(`  FAIL ${f.name}.m4a (ffmpeg): dur ${dur} vs ogg ${twin?.dur} ${d.stderr.trim()}`); }
    }
    console.log(`decoded with ffmpeg: m4a ${ok}/${n}`);
  }
}
console.log('engine:', JSON.stringify({ lockedBeforeGesture: res.engine.lockedBefore, ...eng }));
if (!res.engine.lockedBefore) { fail++; console.log('FAIL: engine unlocked before a gesture'); }
if (!eng.unlocked || eng.state !== 'running') { fail++; console.log('FAIL: engine did not unlock/run after a click'); }
if (eng.preloaded !== eng.expected) { fail++; console.log('FAIL: engine preload incomplete'); }
if (eng.slotsBoard.music !== 'mus_board' || eng.slotsBoard.ambient !== 'amb_drone') { fail++; console.log('FAIL: board scene'); }
if (eng.slotsTheme.music !== 'mus_theme') { fail++; console.log('FAIL: music crossfade'); }
if (!eng.mutedToggle || !eng.persisted || eng.persisted.music !== 0.42 || eng.persisted.muted !== true) { fail++; console.log('FAIL: settings persistence'); }
if (eng.panelInputs !== 4) { fail++; console.log('FAIL: settings panel'); }
if (eng.engineErrors.length) { fail++; console.log('FAIL: engine errors', eng.engineErrors); }
console.log('textures:', tex.map((t) => `${t.name}:${t.ok ? t.w + 'px' : 'FAIL'}`).join(' '));
fail += tex.filter((t) => !t.ok).length;
if (errors.length) { fail++; console.log('page errors:', errors); }
console.log(fail ? `AUDIO CHECK FAILED (${fail})` : 'AUDIO CHECK OK');
process.exit(fail ? 1 : 0);

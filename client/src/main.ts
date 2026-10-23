// Entry point + lobby. Routes:  #/  lobby · #/local  local game · #/g/<id>[/<token>]  online game
import './style.css';
import './fx.css';
import './ux.css';
import './empire.css';
import './shell.css';
import './icons.css';
// the art bible's tokens and component kit (.k-*): every screen's chrome is built from it
import './art/kit.css';
import { GameScreen, backfillRules } from './game.ts';
import { LocalSource, RemoteSource, api, tokens, type LocalSave } from './net.ts';
import { esc, toast, overlay } from './ui/dom.ts';
import { ic } from './art/icons.ts';
import { openTweaks, loadOverrides, countOverrides } from './ui/tweaks.ts';
import { seatPlate } from './ui/houses.ts';
import { resetTab } from './ui/tab.ts';
import { waxSealHtml } from './fx/stage.ts';
import { audio } from './audio/audio.ts';
import { installAudioHooks, openSoundSettings, soundIcon } from './audio/hooks.ts';
import { openGraphicsSettings } from './ui/graphics.ts';
import { enhanceSelects } from './ui/kselect.ts';
import { orreryBackdrop } from './art/orrery-bg.ts';
import { enamel } from './art/bible.ts';
import type { GameMeta } from '../../shared/protocol.ts';
import { LIVE_SPEEDS } from '../../shared/sim/live.ts';
import { PLAYER_COLORS, NEUTRAL_COLOR } from '../../shared/config/content.ts';
import './lobby.css';

/** Re-bind this browser's seats to its turn notifications (push/push.ts; a no-op while they are off). */
const syncPush = () => void import('./push/push.ts').then(m => m.syncPush()).catch(() => { /* offline: next time */ });

const app = document.getElementById('app')!;

// Audio: nothing is created or fetched until the first gesture (iOS unlock); the lobby theme waits for it.
audio.install();
installAudioHooks();
(window as unknown as { tcAudio: typeof audio }).tcAudio = audio;

/** localStorage that never throws: with site data blocked (or a full quota) the lobby must still work.
 *  Saves also live in memory for the session, so a local game can still be started and played. */
const mem = new Map<string, string>();
const store = {
  get(k: string): string | null { try { const v = localStorage.getItem(k); if (v !== null) return v; } catch { /* blocked */ } return mem.get(k) ?? null; },
  set(k: string, v: string) { mem.set(k, v); try { localStorage.setItem(k, v); } catch { /* blocked or full */ } },
};
/** A new local game in this save slot: forget the old one's plans and "seen turn" markers (same seed → same keys). */
function forgetLocal(slot: string) {
  try {
    const drop: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(`tc.plan.${slot}:`) || k.startsWith(`tc.seen.${slot}:`))) drop.push(k);
    }
    drop.forEach(k => localStorage.removeItem(k));
  } catch { /* */ }
}
/** LocalSource keeps its own save in localStorage; mirror it in memory so a blocked storage can't lose the game. */
function remember(src: LocalSource) { mem.set(src.storageKey, JSON.stringify(src.save)); }
let screen: GameScreen | null = null;
/** Bumped on every route change so async work from a previous route can tell it is stale. */
let routeGen = 0;
/** A remote source still connecting (closed if the user navigates away first). */
let pending: RemoteSource | null = null;

function route() {
  routeGen++;
  if (screen?.src instanceof LocalSource) remember(screen.src);
  screen?.destroy();
  screen = null;
  pending?.close();
  pending = null;
  // modal dialogs, battle viewers and toasts live on <body>: don't let them leak into the next screen
  // (the Herald and the Saga too: left open on Back, they covered the lobby and kept acting on the old game)
  document.querySelectorAll('.overlay, .bv-overlay, .toast, .tooltip, .herald-ov, .saga-ov, .mdl-root, .tcl-ov, .ksel-list').forEach(e => { if (!app.contains(e)) e.remove(); });
  resetTab();
  app.innerHTML = '';
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'local') return openLocal('tc.local.autosave');
  if (parts[0] === 'watch') return openLocal('tc.local.watch');
  if (parts[0] === 'g' && parts[1]) return openRemote(parts[1], parts[2]);
  lobby();
}
window.addEventListener('hashchange', route);
// a turn notification clicked while this tab is not controlled by the service worker (sw.js can't navigate it)
try {
  navigator.serviceWorker?.addEventListener('message', e => {
    const d = e.data as { type?: unknown; url?: unknown } | null;
    if (d?.type !== 'tc-open' || typeof d.url !== 'string') return;
    try { const u = new URL(d.url, location.href); if (u.origin === location.origin && u.hash !== location.hash) location.hash = u.hash; } catch { /* */ }
  });
  navigator.serviceWorker?.startMessages();
} catch { /* no service workers here */ }

function openLocal(key: string) {
  const raw = store.get(key);
  if (!raw) { location.hash = '#/'; return; }
  let save: LocalSave;
  try {
    save = JSON.parse(raw) as LocalSave;
    if (!save?.state?.regions || !Array.isArray(save.seats)) throw new Error('bad save');
    save.pending ??= {}; save.history ??= []; save.current ??= 0;
    backfillRules(save.state);
  } catch {
    toast('That saved game could not be read.');
    location.hash = '#/';
    return;
  }
  try {
    const src = new LocalSource(save, key);
    screen = new GameScreen(app, src, () => (location.hash = '#/'));
  } catch (e) {
    console.error(e);
    screen?.destroy(); screen = null;
    notice('bad', 'This saved game could not be opened', esc(String(e)));
    return;
  }
  expose();
}

/** Dev console access: window.tc.screen / tc.state / tc.rules, etc. */
function expose() {
  (window as any).tc = {
    screen, get state() { return screen?.src.view.state; }, get rules() { return screen?.src.view.state.rules; },
    get save() { return (screen?.src as any)?.save; },
  };
}

async function openRemote(id: string, tokenFromUrl?: string) {
  const gen = routeGen;
  if (tokenFromUrl) {
    // seat links carry the token; remember it and clean the URL
    const seat = await seatFromToken(id, tokenFromUrl);
    if (gen !== routeGen) return;
    // a stale or mistyped link must not replace a working seat (or lock this browser out of the join dialog)
    if (seat === -1) toast('That seat link is not valid for this game.');
    else { tokens.set(id, { token: tokenFromUrl, seat: seat ?? -1 }); syncPush(); }
    history.replaceState(null, '', `#/g/${encodeURIComponent(id)}`);
  }
  const tk = tokens.get(id);
  notice('wait', 'Connecting…', `Game <b>${esc(id)}</b>`);
  const src = new RemoteSource(id, tk?.token ?? null);
  pending = src;
  // the server answers a wrong id at once: say so instead of waiting for the "can't reach the server" timeout
  src.onChange = k => {
    if (k !== 'error' || gen !== routeGen || screen) return;
    if (/no such game/i.test(src.lastError)) {
      clearTimeout(timeout);
      notice('bad', 'Game not found', `There is no game <b>${esc(id)}</b> on this server. The link may be mistyped, or the game was deleted.`);
    } else if (/too many connections/i.test(src.lastError)) {
      clearTimeout(timeout);
      notice('wait', 'The server is busy', 'Too many connections from this device. Close other game tabs; this one keeps retrying.');
    }
  };
  const timeout = setTimeout(() => {
    if (gen === routeGen && !screen) notice('bad', 'Can’t reach the game server', 'Still trying in the background. Local games work without it. To host online games, run <code>npm run server</code>.');
  }, 6000);
  await src.waitReady();
  clearTimeout(timeout);
  if (gen !== routeGen) { src.close(); return; }   // the user navigated away while connecting
  pending = null;
  app.innerHTML = '';
  if (!tk) {
    // not seated: offer to join an open seat, else spectate
    const open = src.meta.seats.filter(s => s.kind === 'human' && !s.claimed);
    if (open.length && src.meta.winner === null) {
      src.close();
      return joinDialog(src.meta);
    }
  }
  screen = new GameScreen(app, src, () => (location.hash = '#/'));
  expose();
}

/** The seat a token holds: -1 when the server says it holds none, null when the server could not be asked. */
async function seatFromToken(id: string, token: string): Promise<number | null> {
  try {
    const res = await fetch(`/api/games/${encodeURIComponent(id)}/view`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return res.status === 404 ? -1 : null;
    const r = await res.json();
    return Number.isInteger(r.view?.you) ? r.view.you : -1;
  } catch { return null; }
}

/** A full-screen lobby message: connecting (spinner, Cancel) or an error (warning, Back to lobby). */
function notice(kind: 'wait' | 'bad', title: string, body: string) {
  app.innerHTML = `<div class="lobby"><div class="lobby-inner lb-center"><div class="card lb-notice lb-${kind}" role="${kind === 'bad' ? 'alert' : 'status'}">
    ${kind === 'wait' ? '<span class="lb-spin" aria-hidden="true"></span>' : `<i class="lb-noticon">${ic('warning')}</i>`}
    <h2>${esc(title)}</h2><p>${body}</p>
    <div class="lb-actions"><a class="lb-btn" href="#/">${kind === 'wait' ? 'Cancel' : 'Back to lobby'}</a></div></div></div></div>`;
}

/** A seat's colour in the lobby: the house enamel's lit tone (the state may still carry the retired neons). */
const seatColor = (seat: number) => enamel(PLAYER_COLORS[seat] ?? NEUTRAL_COLOR).hi;

/** The war table under the lobby: the board's orrery (art/orrery-bg.ts), the black-enamel dial in its gold bezel on
 *  velvet, baked once per window size. A still page: no frames at all. */
function lobbyTable(host: HTMLElement) {
  const c = document.createElement('canvas');
  c.className = 'lb-sky';
  c.setAttribute('aria-hidden', 'true');
  host.appendChild(c);
  host.classList.add('orrery');
  let key = '';
  const paint = () => {
    if (!c.isConnected) { removeEventListener('resize', onResize); return; }
    const W = Math.max(1, host.clientWidth), H = Math.max(1, host.clientHeight), dpr = Math.min(2, devicePixelRatio || 1);
    const k = `${W}x${H}@${dpr}`;
    if (k === key) return;
    key = k;
    const bg = orreryBackdrop(W, H, dpr, 4471, { cx: W * 0.5, cy: H * 0.56, R: Math.hypot(W, H) * 0.43, sheen: true, falloff: 0.6 });
    c.width = bg.width; c.height = bg.height;
    c.getContext('2d')!.drawImage(bg, 0, 0);
  };
  let t = 0;
  const onResize = () => { clearTimeout(t); t = window.setTimeout(paint, 120); };
  addEventListener('resize', onResize);
  requestAnimationFrame(paint);
}

function joinDialog(meta: GameMeta) {
  const live = meta.mode === 'live';
  app.innerHTML = `<div class="lobby"><div class="lobby-inner lb-center"><div class="card lb-join">
    <div class="lb-kicker">Join game · ${live ? 'Live' : 'WEGO'} · turn ${Number(meta.turn)}</div>
    <h2 class="lb-gname">${esc(meta.name)}</h2>
    <label class="lb-field"><span>Your name</span><input data-name maxlength="40" autocomplete="nickname" value="${esc(store.get('tc.name') ?? '')}" placeholder="Commander"></label>
    <div class="lb-seats">${meta.seats.map(s => {
      const open = s.kind === 'human' && !s.claimed;
      return `<div class="lb-seat${open ? ' open' : ''}" style="--pc:${seatColor(Number(s.seat))}"><i class="lb-dot" aria-hidden="true"></i>
        <span class="lb-sname">${esc(s.name)}</span><span class="lb-sstate">${s.kind === 'ai' ? `AI ${esc(s.aiLevel)}` : s.claimed ? 'Taken' : 'Open'}</span>
        ${open ? `<button class="primary" data-seat="${Number(s.seat)}">Take seat</button>` : ''}</div>`;
    }).join('')}</div>
    <div class="lb-actions"><a class="lb-btn" href="#/">Back</a><span class="grow"></span><button data-spec title="Watch without a seat">Spectate</button></div></div></div></div>`;
  const seatBtns = [...app.querySelectorAll<HTMLButtonElement>('[data-seat]')];
  seatBtns.forEach(b => b.addEventListener('click', async () => {
    const name = app.querySelector<HTMLInputElement>('[data-name]')!.value.trim();
    if (name) store.set('tc.name', name);
    seatBtns.forEach(x => (x.disabled = true));
    const label = b.textContent;
    b.textContent = 'Joining…';
    try {
      const r = await api.join(meta.id, Number(b.dataset.seat), name);
      tokens.set(meta.id, r);
      syncPush();
      route();
    } catch (e: any) {
      toast(`Could not take the seat: ${e.message ?? e}`);
      seatBtns.forEach(x => (x.disabled = false));
      b.textContent = label;
    }
  }));
  app.querySelector('[data-spec]')!.addEventListener('click', () => {
    const gen = routeGen;
    const src = new RemoteSource(meta.id, null);
    pending = src;
    notice('wait', 'Connecting…', `Spectating <b>${esc(meta.name)}</b>`);
    src.waitReady().then(() => {
      if (gen !== routeGen || screen) { src.close(); return; }
      pending = null;
      app.innerHTML = '';
      screen = new GameScreen(app, src, () => (location.hash = '#/'));
      expose();
    });
  }, { once: true });
}

// ===================================================================== lobby
const MODES: [string, string, string][] = [
  ['wego', 'WEGO · 5 orders a turn', 'Everyone plans in secret, then the turn resolves for all at once.'],
  ...Object.entries(LIVE_SPEEDS).map(([k, v]): [string, string, string] => [`live-${k}`, `Live ${v.label.toLowerCase()} · ${k === 'normal' ? 'over days' : k === 'fast' ? 'an evening' : 'testing'}`, `Real time. ${v.desc}`]),
];
const modeOpts = (sel: string) => MODES.map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${esc(l)}</option>`).join('');
// the AI levels as rival houses (ui/houses.ts): the level stays in the label, the ruler sits beside it
const AI_OPTS = (sel: string, human: string) => [['novice', 'AI novice · the Young Heir'], ['standard', 'AI standard · the Steward'], ['expert', 'AI expert · the Old Admiral'], ['human', human]]
  .map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${l}</option>`).join('');
const SEAT_OPTS = '<option value="human" selected>Human</option><option value="novice">AI novice</option><option value="standard">AI standard</option><option value="expert">AI expert</option>';
const tweaksLabel = () => { const n = countOverrides(); return `${ic('industry')} Tweaks${n ? ` <span class="lb-count">${n} changed</span>` : ''}`; };

function lobby() {
  audio.me = null;
  audio.scene('lobby');
  // seats joined on other devices, or before notifications were turned on
  syncPush();
  let saveTurn = 0;
  const saved = store.get('tc.local.autosave');
  if (saved) { try { const sv = JSON.parse(saved) as LocalSave; saveTurn = sv.state.winner === null ? Math.max(1, Number(sv.state.turn) || 1) : -1; } catch { saveTurn = 0; } }
  const name = store.get('tc.name') ?? '';
  app.innerHTML = `<div class="lobby"><div class="lb-table" aria-hidden="true"></div><div class="lobby-inner">
    <header class="title"><h1>Three Crowns</h1><div class="lb-orn" aria-hidden="true"><i></i>${ic('crown')}<i></i></div>
      <p>Three heirs. One empty throne. <b>Five orders a turn</b>, no matter how big your empire grows. Everyone plans in secret, then everything happens at once.</p></header>
    <div class="cards">
      <section class="card lb-play lb-sheet"><div class="lb-articles">Articles of War</div><h2>Play vs AI</h2>
        <div class="form">
          <label for="l-name">Your name</label><input id="l-name" data-l="name" maxlength="40" autocomplete="nickname" value="${esc(name)}" placeholder="Azure Compact">
          <label for="l-ai1">Rival 1</label><select id="l-ai1" data-l="ai1">${AI_OPTS('standard', 'Human (hotseat)')}</select>
          <div class="lb-house-slot" data-l="h1" aria-live="polite">${seatPlate(1, 'standard')}</div>
          <label for="l-ai2">Rival 2</label><select id="l-ai2" data-l="ai2">${AI_OPTS('expert', 'Human (hotseat)')}</select>
          <div class="lb-house-slot" data-l="h2" aria-live="polite">${seatPlate(2, 'expert')}</div>
          <label for="l-mode">Mode</label><select id="l-mode" data-l="mode">${modeOpts('wego')}</select>
          <p class="lb-hint" data-l="hint" aria-live="polite"></p>
          <label for="l-seed">Seed</label><input id="l-seed" data-l="seed" placeholder="Random map" inputmode="numeric" pattern="[0-9]*">
        </div>
        <div class="lb-actions"><button class="primary lb-start lb-seal" data-l="start" title="Seal the articles and begin"><span class="lb-wax" aria-hidden="true">${ic('crown')}</span><span class="lb-seal-t">Start</span></button>${saveTurn > 0 ? `<button data-l="continue">Continue <span class="lb-count">turn ${saveTurn}</span></button>` : saveTurn < 0 ? '<button data-l="continue">Last game <span class="lb-count">finished</span></button>' : ''}<button data-l="load">Load file…</button><button data-l="watch">Watch 3 AIs</button></div>
      </section>
      <section class="card lb-online"><h2>Online multiplayer</h2>
        <p class="lb-lead">Send the link to your rivals and play at your own pace. A turn resolves when all three have sealed their orders, or at the deadline (an AI steward covers anyone late).</p>
        <div class="form">
          <label for="o-name">Game name</label><input id="o-name" data-o="name" maxlength="40" placeholder="Friday war">
          <label for="o-s1">Seat 2</label><select id="o-s1" data-o="s1">${SEAT_OPTS}</select>
          <label for="o-s2">Seat 3</label><select id="o-s2" data-o="s2">${SEAT_OPTS}</select>
          <label for="o-mode">Mode</label><select id="o-mode" data-o="mode">${modeOpts('wego')}</select>
          <p class="lb-hint" data-o="hint" aria-live="polite"></p>
          <label for="o-deadline">Deadline</label><select id="o-deadline" data-o="deadline"><option value="0">None: wait for all</option><option value="1">1 hour a turn</option><option value="8">8 hours a turn</option><option value="24">24 hours a turn</option><option value="48">48 hours a turn</option></select>
          <div class="lb-league" data-o="league"></div>
        </div>
        <div class="lb-actions"><button class="primary" data-o="create">Create &amp; take seat 1</button></div>
        <h3>Games on this server</h3><div class="gamelist" data-o="list" aria-live="polite"><p class="lb-empty"><span class="lb-spin" aria-hidden="true"></span>Looking for games…</p></div>
      </section>
      <section class="card lb-fiddle"><h2>Fiddle</h2>
        <p class="lb-lead">Everything is a knob. Change any rule (orders per turn, ship stats, VP values, combat odds…) and start a new game to try it.</p>
        <div class="lb-actions"><button data-l="tweaks">${tweaksLabel()}</button><button data-l="help">${ic('help')} How to play</button><button data-l="sound">${soundIcon()} Sound</button><button data-l="gfx">${ic('star')} Graphics</button><button data-l="notify">${ic('dispatch')} Notifications</button><button data-l="league">${ic('crown')} League</button></div>
        <p class="lb-dev">Dev tips: <code>npm run sim -- --games 50</code> runs headless AI-vs-AI balance tests. The <i>Menu</i> in a local game can reveal the whole map. All rules: <code>shared/config/rules.ts</code>.</p>
      </section>
    </div></div></div>`;
  const q = (s: string) => app.querySelector<HTMLInputElement>(s)!;
  lobbyTable(app.querySelector<HTMLElement>('.lb-table')!);
  enhanceSelects(app);
  // live / hotseat hints: say what the choice means (and that live turns hotseat rivals into AIs) before Start
  const hintPlay = () => {
    const mode = q('[data-l="mode"]').value, live = mode.startsWith('live');
    const hot = q('[data-l="ai1"]').value === 'human' || q('[data-l="ai2"]').value === 'human';
    const m = MODES.find(x => x[0] === mode)?.[2] ?? '';
    q('[data-l="hint"]').innerHTML = esc(m) + (hot ? live ? ' <b class="lb-warn">Live is one human per device: hotseat rivals will play as AIs.</b>' : ' <b>Hotseat:</b> pass the device; a curtain hides each player’s plans.' : '');
  };
  const hintOnline = () => { q('[data-o="hint"]').textContent = MODES.find(x => x[0] === q('[data-o="mode"]').value)?.[2] ?? ''; };
  ['ai1', 'ai2', 'mode'].forEach(k => q(`[data-l="${k}"]`).addEventListener('change', hintPlay));
  // the rival's chair: a ruler takes it (a cloth sound as the banner is set), or a friend does
  const plate = (i: number, anim: boolean) => {
    const slot = app.querySelector<HTMLElement>(`[data-l="h${i}"]`);
    if (!slot) return;
    const live = q('[data-l="mode"]').value.startsWith('live'), v = q(`[data-l="ai${i}"]`).value;
    const k = `${live && v === 'human' ? 'standard' : v}`;
    if ((slot.dataset.v ?? (i === 1 ? 'standard' : 'expert')) === k) return;
    slot.dataset.v = k;
    slot.innerHTML = seatPlate(i, v, live);
    if (anim) { slot.firstElementChild?.classList.add('set'); audio.touch('cloth'); }
  };
  for (const i of [1, 2]) q(`[data-l="ai${i}"]`).addEventListener('change', () => plate(i, true));
  q('[data-l="mode"]').addEventListener('change', () => { plate(1, true); plate(2, true); });
  q('[data-o="mode"]').addEventListener('change', hintOnline);
  hintPlay(); hintOnline();
  q('[data-l="start"]').addEventListener('click', () => {
    const prev = store.get('tc.local.autosave');
    if (prev) {
      try {
        const sv = JSON.parse(prev) as LocalSave;
        if (sv.state.winner === null && sv.state.turn > 1 && !confirm(`Start a new game? Your saved game (turn ${sv.state.turn}) will be replaced. Download it first from the in-game menu if you want to keep it.`)) return;
      } catch { /* ignore */ }
    }
    const nm = q('[data-l="name"]').value.trim();
    if (nm) store.set('tc.name', nm);
    const lv = (k: string) => q(`[data-l="${k}"]`).value;
    const seat = (v: string) => v === 'human' ? { kind: 'human' as const, aiLevel: 'standard' as const } : { kind: 'ai' as const, aiLevel: v as 'novice' };
    const seedTxt = q('[data-l="seed"]').value.trim();
    const seed = seedTxt ? Number(seedTxt) : undefined;
    if (seed !== undefined && !Number.isFinite(seed)) { toast('The seed must be a number (or leave it empty for a random map).'); q('[data-l="seed"]').focus(); return; }
    const mode = lv('mode');
    const live = mode.startsWith('live') ? { speed: LIVE_SPEEDS[mode.slice(5)].mult } : undefined;
    // live mode runs on a real clock: hotseat makes no sense there, so rivals are always AIs
    const rival = (v: string) => live && v === 'human' ? seat('standard') : seat(v);
    if (live && (lv('ai1') === 'human' || lv('ai2') === 'human')) toast('Live mode is one human per browser: hotseat rivals became AIs. Use Online multiplayer to play live with friends.');
    const src = LocalSource.create('Local game', [{ kind: 'human', aiLevel: 'standard' }, rival(lv('ai1')), rival(lv('ai2'))], [nm || undefined], seed, loadOverrides(), undefined, live);
    src.refresh();
    // this source only wrote the save; the route opens its own. Left running, a LIVE one kept ticking its
    // own copy of the game in the background and overwrote the autosave (without your queued orders)
    src.close();
    remember(src);
    forgetLocal('tc.local.autosave');
    location.hash = '#/local';
  });
  q('[data-l="watch"]').addEventListener('click', () => {
    const src = LocalSource.create('AI exhibition', [{ kind: 'ai', aiLevel: 'expert' }, { kind: 'ai', aiLevel: 'standard' }, { kind: 'ai', aiLevel: 'novice' }], ['Expert AI', 'Standard AI', 'Novice AI'], undefined, loadOverrides(), 'tc.local.watch');
    src.refresh();
    src.close();
    remember(src);
    forgetLocal('tc.local.watch');
    location.hash = '#/watch';
  });
  app.querySelector('[data-l="continue"]')?.addEventListener('click', () => (location.hash = '#/local'));
  q('[data-l="load"]').addEventListener('click', () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return;
      try {
        const save = JSON.parse(await f.text());
        if (!save?.state?.regions || !Array.isArray(save.seats)) throw new Error('not a save');
        forgetLocal('tc.local.autosave');
        store.set('tc.local.autosave', JSON.stringify(save));
        // hashchange triggers the route; if we're already there, route explicitly
        if (location.hash === '#/local') route(); else location.hash = '#/local';
      } catch { toast('That file is not a Three Crowns save.'); }
    };
    inp.click();
  });
  // the button counts changed rules: recount when the editor closes
  q('[data-l="tweaks"]').addEventListener('click', () => openTweaks(() => {
    const b = app.querySelector('[data-l="tweaks"]');
    if (b) b.innerHTML = tweaksLabel();
  }));
  q('[data-l="sound"]').addEventListener('click', () => {
    // the button's speaker shows the current mute state: keep it in step while the dialog is open
    const b = q('[data-l="sound"]'), off = audio.subscribe(s => { b.innerHTML = `${soundIcon(s.muted)} Sound`; });
    openSoundSettings().addEventListener('fx-removed', off);
  });
  q('[data-l="gfx"]').addEventListener('click', () => openGraphicsSettings());
  q('[data-l="league"]').addEventListener('click', () => void import('./league/panel.ts').then(m => m.mountLeaguePanel()));
  q('[data-l="notify"]').addEventListener('click', async () => {
    const m = await import('./push/push.ts');
    const o = overlay(`<div class="dialog lb-notify" role="dialog" aria-label="Notifications"><h2>Notifications</h2><div data-push></div><div class="row"><button class="primary" data-close>Done</button></div></div>`);
    m.mountPushSettings(o.querySelector<HTMLElement>('[data-push]')!);
    o.querySelector('[data-close]')!.addEventListener('click', () => o.remove());
  });
  // which League a new online game counts for (renders nothing until this browser sits in one)
  let leagueChoice: import('../../shared/protocol.ts').CreateGameReq['league'];
  const lgen = routeGen;
  void import('./league/panel.ts').then(m => { const host = app.querySelector<HTMLElement>('[data-o="league"]'); if (host && lgen === routeGen) m.mountLeaguePicker(host, v => { leagueChoice = v; }); });
  q('[data-l="help"]').addEventListener('click', async () => {
    const { helpHtml } = await import('./ui/help.ts');
    const { createGame } = await import('../../shared/sim/setup.ts');
    overlay(`<div class="dialog wide scroll help" role="dialog" aria-label="How to play">${helpHtml(createGame({ seed: 1, players: [], rules: loadOverrides() }))}</div>`);
  });
  const bCreate = q('[data-o="create"]') as unknown as HTMLButtonElement;
  bCreate.addEventListener('click', async () => {
    const nm = q('[data-l="name"]').value.trim() || 'Player 1';
    store.set('tc.name', nm);
    const seat = (v: string) => v === 'human' ? { kind: 'human' } : { kind: 'ai', aiLevel: v };
    bCreate.disabled = true;
    bCreate.textContent = 'Creating…';
    try {
      const r = await api.create({
        name: q('[data-o="name"]').value.trim() || undefined,
        seats: [{ kind: 'human', name: nm }, seat(q('[data-o="s1"]').value), seat(q('[data-o="s2"]').value)],
        rules: loadOverrides(), deadlineHours: Number(q('[data-o="deadline"]').value),
        ...(q('[data-o="mode"]').value.startsWith('live') ? { mode: 'live' as const, liveSpeed: q('[data-o="mode"]').value.slice(5) } : {}),
        ...(leagueChoice ? { league: leagueChoice } : {}),
      });
      const j = await api.join(r.id, 0, nm);
      tokens.set(r.id, j);
      syncPush();
      const link = `${location.origin}${location.pathname}#/g/${r.id}`;
      const o = overlay(`<div class="dialog lb-created" role="dialog" aria-label="Game created"><h2>${ic('check')} Game created</h2><p>Send this link to your rivals:</p>
        <input class="lb-link" value="${esc(link)}" readonly aria-label="Game link">
        <p class="lb-note">They pick a seat when they open it. Your own seat is remembered in this browser. To play from another device, use <i>Menu → your private seat link</i> in game.</p>
        <div class="lb-actions"><button data-copy>${ic('chain')} Copy link</button><span class="grow"></span><button class="primary" data-go>Enter game</button></div></div>`, false);
      const inp = o.querySelector<HTMLInputElement>('.lb-link')!;
      inp.addEventListener('focus', () => inp.select());
      const bCopy = o.querySelector<HTMLButtonElement>('[data-copy]')!;
      bCopy.addEventListener('click', async () => {
        try { if (!navigator.clipboard) throw new Error('no clipboard'); await navigator.clipboard.writeText(link); bCopy.innerHTML = `${ic('check')} Copied`; toast('Link copied'); }
        catch { inp.focus(); inp.select(); toast('Select the link and copy it'); }
      });
      o.querySelector('[data-go]')!.addEventListener('click', () => { o.remove(); location.hash = `#/g/${r.id}`; });
    } catch (e: any) { toast(`Could not create the game: ${e.message ?? e}. Is the server running?`); }
    finally { if (bCreate.isConnected) { bCreate.disabled = false; bCreate.textContent = 'Create & take seat 1'; } }
  });
  const gen = routeGen;
  api.list().then(games => {
    if (gen !== routeGen) return;
    const el = q('[data-o="list"]');
    if (!games.length) { el.innerHTML = '<p class="lb-empty">No games yet. Create one above and send the link.</p>'; return; }
    // games waiting on you are sealed letters on the table (DELIGHT #4): the wax is the colour of a friend who sealed
    // and waits; a letter whose deadline is near has its corner curling. They lie on top of the pile.
    const waitingOn = (g: (typeof games)[number]) => { const m = tokens.get(g.id); return !!m && m.seat >= 0 && g.winner === null && g.mode !== 'live' && !g.seats[m.seat]?.submitted; };
    const pile = games.slice(0, 30).map((g, i) => ({ g, i, w: waitingOn(g) })).sort((a, b) => Number(b.w) - Number(a.w) || a.i - b.i);
    el.innerHTML = pile.map(({ g, w: waiting }) => {
      const mine = tokens.get(g.id);
      const open = g.seats.filter(s => s.kind === 'human' && !s.claimed).length;
      const act = mine ? 'Continue' : open && g.winner === null ? 'Join' : 'Watch';
      const meta = [waiting ? '<b class="lb-yours">Your move</b>' : '', `Turn ${Number(g.turn)}`, g.mode === 'live' ? 'Live' : '', g.winner !== null ? 'Finished' : open ? `${open} open seat${open > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
      const waiter = waiting ? g.seats.find(s => s.submitted && s.seat !== mine!.seat && s.kind === 'human') ?? g.seats.find(s => s.seat !== mine!.seat) : undefined;
      const curl = waiting && !!g.deadline && g.deadline - Date.now() < 3 * 3600e3;
      const letter = waiter ? `<span class="lb-letter${curl ? ' curl' : ''}"${curl ? ' title="The deadline is near"' : ''} aria-hidden="true">${waxSealHtml({ seat: Number(waiter.seat), color: seatColor(Number(waiter.seat)) }, 22)}</span>` : '';
      return `<div class="gamerow${waiting ? ' letter' : ''}">${letter}<div class="lb-ghead"><b class="lb-gname">${esc(g.name)}</b><span class="lb-meta">${meta}</span></div>
        <div class="seatline">${g.seats.map(s => `<span class="lb-tag${s.online && s.kind === 'human' ? ' online' : ''}" style="--pc:${seatColor(Number(s.seat))}"><i class="lb-dot" aria-hidden="true"></i>${esc(s.name)}${s.kind === 'ai' ? ' <small>AI</small>' : s.claimed ? '' : ' <small>open</small>'}${s.submitted && s.kind === 'human' ? ` ${ic('check', { title: 'Orders sealed' })}` : ''}</span>`).join('')}</div>
        <a class="lb-btn${act === 'Watch' ? '' : ' primary'}" href="#/g/${esc(encodeURIComponent(g.id))}">${act}</a></div>`;
    }).join('');
  }).catch(() => { if (gen !== routeGen) return; q('[data-o="list"]').innerHTML = '<p class="lb-empty">Server not reachable, so online play is off. Local games work without it. To host, run <code>npm run server</code>.</p>'; });
}

route();

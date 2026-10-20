// Entry point + lobby. Routes:  #/  lobby · #/local  local game · #/g/<id>[/<token>]  online game
import './style.css';
import { GameScreen } from './game.ts';
import { LocalSource, RemoteSource, api, tokens, type LocalSave } from './net.ts';
import { esc, toast, overlay } from './ui/dom.ts';
import { openTweaks, loadOverrides } from './ui/tweaks.ts';
import type { GameMeta } from '../../shared/protocol.ts';

const app = document.getElementById('app')!;
let screen: GameScreen | null = null;

function route() {
  screen?.destroy();
  screen = null;
  app.innerHTML = '';
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'local') return openLocal();
  if (parts[0] === 'g' && parts[1]) return openRemote(parts[1], parts[2]);
  lobby();
}
window.addEventListener('hashchange', route);

function openLocal() {
  const raw = localStorage.getItem('tc.local.autosave');
  if (!raw) { location.hash = '#/'; return; }
  const src = new LocalSource(JSON.parse(raw) as LocalSave);
  screen = new GameScreen(app, src, () => (location.hash = '#/'));
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
  if (tokenFromUrl) {
    // seat links carry the token; remember it and clean the URL
    const seat = await seatFromToken(id, tokenFromUrl);
    tokens.set(id, { token: tokenFromUrl, seat });
    history.replaceState(null, '', `#/g/${id}`);
  }
  const tk = tokens.get(id);
  app.innerHTML = `<div class="lobby"><div class="lobby-inner"><p class="dim">Connecting to game ${esc(id)}…</p></div></div>`;
  const src = new RemoteSource(id, tk?.token ?? null);
  const timeout = setTimeout(() => { if (!screen) app.innerHTML = `<div class="lobby"><div class="lobby-inner"><p class="bad">Could not reach the game server. Is it running? (<code>npm run server</code>)</p><a href="#/">Back</a></div></div>`; }, 6000);
  await src.waitReady();
  clearTimeout(timeout);
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

async function seatFromToken(id: string, token: string): Promise<number> {
  try {
    const r = await (await fetch(`/api/games/${id}/view?token=${token}`)).json();
    return r.view?.you ?? -1;
  } catch { return -1; }
}

function joinDialog(meta: GameMeta) {
  app.innerHTML = `<div class="lobby"><div class="lobby-inner"><div class="card" style="max-width:520px;margin:40px auto">
    <h2>Join “${esc(meta.name)}”</h2>
    <div class="form"><span>Your name</span><input data-name value="${esc(localStorage.getItem('tc.name') ?? '')}" placeholder="Commander"></div>
    <div class="col" style="margin-top:12px">${meta.seats.map(s => `<div class="row"><span class="grow">${esc(s.name)} <span class="faint">${s.kind === 'ai' ? `AI (${s.aiLevel})` : s.claimed ? 'taken' : 'open'}</span></span>
      ${s.kind === 'human' && !s.claimed ? `<button class="primary" data-seat="${s.seat}">Take this seat</button>` : ''}</div>`).join('')}</div>
    <div class="row" style="margin-top:14px"><button data-spec>Spectate instead</button><a href="#/">Back to lobby</a></div></div></div></div>`;
  app.querySelectorAll<HTMLButtonElement>('[data-seat]').forEach(b => b.addEventListener('click', async () => {
    const name = app.querySelector<HTMLInputElement>('[data-name]')!.value.trim();
    if (name) localStorage.setItem('tc.name', name);
    try {
      const r = await api.join(meta.id, Number(b.dataset.seat), name);
      tokens.set(meta.id, r);
      route();
    } catch (e: any) { toast(e.message); }
  }));
  app.querySelector('[data-spec]')!.addEventListener('click', () => {
    const src = new RemoteSource(meta.id, null);
    src.waitReady().then(() => { app.innerHTML = ''; screen = new GameScreen(app, src, () => (location.hash = '#/')); });
  });
}

// ===================================================================== lobby
function lobby() {
  const hasSave = !!localStorage.getItem('tc.local.autosave');
  const name = localStorage.getItem('tc.name') ?? '';
  const tw = Object.keys(loadOverrides()).length;
  app.innerHTML = `<div class="lobby"><div class="lobby-inner">
    <div class="title"><h1>THREE CROWNS</h1>
      <p>Three heirs. One empty throne. <b>Five orders a turn</b>, no matter how big your empire grows. Everyone plans in secret, then everything happens at once.</p></div>
    <div class="cards">
      <div class="card"><h2>Play vs AI</h2>
        <div class="form">
          <span>Your name</span><input data-l="name" value="${esc(name)}" placeholder="Azure Compact">
          <span>Rival 1</span><select data-l="ai1"><option value="novice">AI novice</option><option value="standard" selected>AI standard</option><option value="expert">AI expert</option><option value="human">Human (hotseat)</option></select>
          <span>Rival 2</span><select data-l="ai2"><option value="novice">AI novice</option><option value="standard">AI standard</option><option value="expert" selected>AI expert</option><option value="human">Human (hotseat)</option></select>
          <span>Seed</span><input data-l="seed" placeholder="random" inputmode="numeric">
        </div>
        <div class="row" style="margin-top:12px"><button class="primary" data-l="start">Start</button>${hasSave ? '<button data-l="continue">Continue saved game</button>' : ''}<button data-l="load">Load file…</button><button data-l="watch" title="Three AIs play; you watch with the map revealed">Watch AIs</button></div>
      </div>
      <div class="card"><h2>Online multiplayer</h2>
        <p class="dim" style="font-size:14px;margin-top:0">Create a game, send the link to your rivals, and play asynchronously. A turn resolves when all three have sealed their orders (or at the optional deadline, when an AI steward plays for anyone who is late).</p>
        <div class="form">
          <span>Game name</span><input data-o="name" placeholder="Friday war">
          <span>Seat 2</span><select data-o="s1"><option value="human" selected>Human</option><option value="novice">AI novice</option><option value="standard">AI standard</option><option value="expert">AI expert</option></select>
          <span>Seat 3</span><select data-o="s2"><option value="human" selected>Human</option><option value="novice">AI novice</option><option value="standard">AI standard</option><option value="expert">AI expert</option></select>
          <span>Deadline</span><select data-o="deadline"><option value="0">none (wait for everyone)</option><option value="1">1 hour</option><option value="8">8 hours</option><option value="24">24 hours</option><option value="48">48 hours</option></select>
        </div>
        <div class="row" style="margin-top:12px"><button class="primary" data-o="create">Create & take seat 1</button></div>
        <h3>Games on this server</h3><div class="gamelist" data-o="list"><span class="faint">loading…</span></div>
      </div>
      <div class="card"><h2>Fiddle</h2>
        <p class="dim" style="font-size:14px;margin-top:0">Everything is a knob. Change any rule (orders per turn, ship stats, VP values, combat odds…) and start a new game to try it.</p>
        <div class="row"><button data-l="tweaks">⚙ Tweaks${tw ? ` (${tw} groups changed)` : ''}</button><button data-l="help">How to play</button></div>
        <p class="faint" style="font-size:13px">Dev tips: <code>npm run sim -- --games 50</code> runs headless AI-vs-AI balance tests. The <i>Menu</i> in a local game can reveal the whole map. All rules: <code>shared/config/rules.ts</code>.</p>
      </div>
    </div></div></div>`;
  const q = (s: string) => app.querySelector<HTMLInputElement>(s)!;
  q('[data-l="start"]').addEventListener('click', () => {
    const nm = q('[data-l="name"]').value.trim();
    if (nm) localStorage.setItem('tc.name', nm);
    const lv = (k: string) => q(`[data-l="${k}"]`).value;
    const seat = (v: string) => v === 'human' ? { kind: 'human' as const, aiLevel: 'standard' as const } : { kind: 'ai' as const, aiLevel: v as 'novice' };
    const seed = q('[data-l="seed"]').value.trim();
    const src = LocalSource.create('Local game', [{ kind: 'human', aiLevel: 'standard' }, seat(lv('ai1')), seat(lv('ai2'))], [nm || undefined], seed ? Number(seed) : undefined, loadOverrides());
    src.refresh();
    location.hash = '#/local';
  });
  q('[data-l="watch"]').addEventListener('click', () => {
    const src = LocalSource.create('AI exhibition', [{ kind: 'ai', aiLevel: 'expert' }, { kind: 'ai', aiLevel: 'standard' }, { kind: 'ai', aiLevel: 'novice' }], [], undefined, loadOverrides());
    src.refresh();
    location.hash = '#/local';
  });
  app.querySelector('[data-l="continue"]')?.addEventListener('click', () => (location.hash = '#/local'));
  q('[data-l="load"]').addEventListener('click', () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return;
      try { const save = JSON.parse(await f.text()); if (!save.state) throw new Error('not a save'); localStorage.setItem('tc.local.autosave', JSON.stringify(save)); location.hash = '#/local'; route(); }
      catch { toast('That file is not a Three Crowns save.'); }
    };
    inp.click();
  });
  q('[data-l="tweaks"]').addEventListener('click', () => openTweaks());
  q('[data-l="help"]').addEventListener('click', async () => {
    const { helpHtml } = await import('./ui/help.ts');
    const { createGame } = await import('../../shared/sim/setup.ts');
    const o = overlay(`<div class="dialog wide scroll help">${helpHtml(createGame({ seed: 1, players: [], rules: loadOverrides() }))}</div>`);
    void o;
  });
  q('[data-o="create"]').addEventListener('click', async () => {
    const nm = q('[data-l="name"]').value.trim() || 'Player 1';
    localStorage.setItem('tc.name', nm);
    const seat = (v: string) => v === 'human' ? { kind: 'human' } : { kind: 'ai', aiLevel: v };
    try {
      const r = await api.create({
        name: q('[data-o="name"]').value.trim() || undefined,
        seats: [{ kind: 'human', name: nm }, seat(q('[data-o="s1"]').value), seat(q('[data-o="s2"]').value)],
        rules: loadOverrides(), deadlineHours: Number(q('[data-o="deadline"]').value),
      });
      const j = await api.join(r.id, 0, nm);
      tokens.set(r.id, j);
      const link = `${location.origin}${location.pathname}#/g/${r.id}`;
      const o = overlay(`<div class="dialog"><h2>Game created</h2><p>Send this link to your rivals:</p><input value="${esc(link)}" readonly style="width:100%" onclick="this.select()">
        <p class="dim" style="font-size:13px">They pick a seat when they open it. Your own seat is remembered in this browser. To play from another device, use <i>Menu → your private seat link</i> in game.</p>
        <div class="row"><button data-copy>Copy link</button><button class="primary" data-go>Enter game</button></div></div>`, false);
      o.querySelector('[data-copy]')!.addEventListener('click', () => { navigator.clipboard?.writeText(link); toast('Copied'); });
      o.querySelector('[data-go]')!.addEventListener('click', () => { o.remove(); location.hash = `#/g/${r.id}`; });
    } catch (e: any) { toast(`Could not create game: ${e.message ?? e}. Is the server running?`); }
  });
  api.list().then(games => {
    const el = q('[data-o="list"]');
    if (!games.length) { el.innerHTML = '<span class="faint">No games yet.</span>'; return; }
    el.innerHTML = games.slice(0, 30).map(g => {
      const mine = tokens.get(g.id);
      const open = g.seats.filter(s => s.kind === 'human' && !s.claimed).length;
      return `<div class="gamerow"><div class="row"><b class="grow">${esc(g.name)}</b><span class="faint">turn ${g.turn}${g.winner !== null ? ' · finished' : ''}</span></div>
        <div class="seatline">${g.seats.map(s => `<span class="tag" title="${s.kind === 'ai' ? 'AI ' + s.aiLevel : s.claimed ? 'human' : 'open seat'}">${s.online && s.kind === 'human' ? '● ' : ''}${esc(s.name)}${s.kind === 'ai' ? ' (AI)' : s.claimed ? '' : ' (open)'}${s.submitted && s.kind === 'human' ? ' ✓' : ''}</span>`).join('')}
        <span class="grow"></span><a href="#/g/${g.id}">${mine ? 'Continue' : open ? 'Join' : 'Watch'}</a></div></div>`;
    }).join('');
  }).catch(() => { q('[data-o="list"]').innerHTML = '<span class="faint">Server not reachable. Run <code>npm run server</code> for online play. Local games work without it.</span>'; });
}

route();

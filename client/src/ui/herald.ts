// The Herald (docs/SOUL.md §3): a front page each WEGO turn / LIVE cycle, printed from the game's events, plus the
// houses' planted dispatches (a boast, a threat or a lie, printed as fact). Shown at the start of a turn (after the
// replay), and from the Chronicle. Each house may plant one dispatch per edition (free action `dispatch`).
import type { GameScreen } from '../game.ts';
import type { HeraldEdition, Headline } from '../../../shared/sim/types.ts';
import { headlineVisible } from '../../../shared/sim/herald.ts';
import { soulOn, SR } from '../../../shared/sim/soul.ts';
import { esc, toast } from './dom.ts';
import { sigilSvg } from '../art/sigils.ts';
import { iconizeDom, ic, icFor } from '../art/icons.ts';
import { audio } from '../audio/audio.ts';

const KIND_ICON: Record<string, string> = {
  rout: '⤺', caught: '✝', destroyed: '✝', broken: '✝', death: '✝', vengeance: '⚔', debt: '✠', vow_broken: '✗', vow_kept: '✦',
  vow_sworn: '✠', oath: '✗', coronation: '♛', relic: '✧', capital: '♜', capture: '⚑', razed: '♨', liberated: '☼', battle: '⚔',
  honour: '❖', legend: '★', retired: '⚑', eliminated: '✝', founded: '⚑', quiet: '☾', calling: '◈', deed: '◆', fate: '✪', fate_bonus: '✪',
  p_called: '✓', p_caught: '✗', p_ambush: '◉', p_broken: '⚡', p_exposed: '◌', p_scorched: '♨', p_levies: '⚑',
  tribute: '⚖', tribute_offer: '⚖', refugees: '⇢',
};
export const headlineIcon = (k: string) => ic(icFor('herald', k, KIND_ICON[k] ?? (k.startsWith('p_') ? '◉' : '•')));

const seenKey = (g: GameScreen) => `tc.herald.${g.gameKey()}.${g.you ?? 's'}`;
function seen(g: GameScreen): number { try { return Number(localStorage.getItem(seenKey(g)) ?? 0) || 0; } catch { return 0; } }
function markSeen(g: GameScreen, t: number) { try { localStorage.setItem(seenKey(g), String(t)); } catch { /* */ } }
/** Browser scripts can keep the Herald from opening by itself: localStorage 'tc.herald.auto' = 'off'. */
const autoOff = () => { try { return localStorage.getItem('tc.herald.auto') === 'off'; } catch { return false; } };

export function editions(g: GameScreen): HeraldEdition[] { return g.st.soul?.herald ?? []; }
const visible = (g: GameScreen, h: Headline) => (g.you === null ? h.public || g.st.winner !== null : headlineVisible(h, g.you));

let open: { el: HTMLElement; turn: number } | null = null;
export const heraldOpen = () => !!open?.el.isConnected;

/** Open the newest unseen edition (start of a turn / cycle). Returns whether it opened. */
export function maybeHerald(g: GameScreen): boolean {
  if (!soulOn(g.st) || autoOff() || g.you === null || heraldOpen()) return false;
  const eds = editions(g);
  const ed = eds[eds.length - 1];
  if (!ed || ed.turn <= seen(g)) return false;
  if (!ed.headlines.some(h => visible(g, h) && h.kind !== 'quiet') && !ed.dispatches.length) { markSeen(g, ed.turn); return false; }
  openHerald(g, ed.turn);
  return true;
}

export function closeHerald() {
  const o = open;
  open = null;
  if (!o) return;
  if (o.el.isConnected) audio.ui('close');
  o.el.classList.add('out');
  setTimeout(() => o.el.remove(), 220);
}

/** The front page of edition `turn` (default: the newest). */
export function openHerald(g: GameScreen, turn?: number) {
  const eds = editions(g);
  if (!eds.length) { toast('No edition yet: the Herald prints after the first turn'); return; }
  const ed = turn !== undefined ? eds.find(e => e.turn === turn) ?? eds[eds.length - 1] : eds[eds.length - 1];
  open?.el.remove();
  markSeen(g, Math.max(seen(g), ed.turn));
  const el = document.createElement('div');
  el.className = 'herald-ov';
  el.innerHTML = `<div class="herald-back" data-h="close"></div><article class="herald" role="dialog" aria-label="The Herald"></article>`;
  document.body.appendChild(el);
  open = { el, turn: ed.turn };
  audio.ui('page');
  render(g, ed);
  requestAnimationFrame(() => el.classList.add('show'));
  el.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-h]');
    if (!b) return;
    const a = b.dataset.h!;
    if (a === 'close') { closeHerald(); g.renderAll(); return; }
    if (a === 'ed') { const t = Number(b.dataset.t); const e2 = editions(g).find(x => x.turn === t); if (e2 && open) { open.turn = t; audio.ui('page'); render(g, e2); } return; }
    if (a === 'as') { asWho = b.dataset.v === 'source' ? 'source' : 'house'; render(g, edNow(g)); return; }
    if (a === 'file') { file(g); return; }
    if (a === 'unfile') { if (!g.live) { g.plan.free = g.plan.free.filter(x => x.type !== 'dispatch'); g.savePlan(); g.renderAll(); } render(g, edNow(g)); return; }
    if (a === 'region') { const r = g.st.regions[Number(b.dataset.r)]; closeHerald(); if (r) { g.select({ kind: 'region', id: r.id }); g.focus(r.site); } }
  });
  el.addEventListener('input', e => {
    const t = e.target as HTMLTextAreaElement;
    if (!t.matches('[data-dispatch]')) return;
    draft = t.value;
    const c = el.querySelector('.dsp-count'); if (c) c.textContent = `${draft.length}/${max(g)}`;
  });
  el.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { closeHerald(); g.renderAll(); }
    if (e.key === 'Enter' && (e.target as HTMLElement).matches('[data-dispatch]') && !e.shiftKey) { e.preventDefault(); file(g); }
  });
  window.addEventListener('keydown', function esc(e) {
    if (!el.isConnected) { window.removeEventListener('keydown', esc, true); return; }
    if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest?.('.herald')) { e.stopPropagation(); closeHerald(); g.renderAll(); }
  }, true);
}

let draft = '';
let asWho: 'house' | 'source' = 'house';
const max = (g: GameScreen) => SR(g.st).dispatchMax ?? 140;
const edNow = (g: GameScreen) => editions(g).find(e => e.turn === open?.turn) ?? editions(g)[editions(g).length - 1];

/** Your dispatch waiting for the next edition (plan, LIVE queue, or already queued in the state). */
function pending(g: GameScreen): { text: string; as: 'house' | 'source' } | null {
  const fa = g.myFree().find(x => x.type === 'dispatch');
  if (fa && fa.type === 'dispatch') return { text: fa.text, as: fa.as ?? 'house' };
  const d = g.st.soul?.dispatches.find(x => x.p === g.you);
  return d ? { text: d.text, as: d.as } : null;
}
function file(g: GameScreen) {
  const t = draft.trim().replace(/\s+/g, ' ').slice(0, max(g));
  if (!t) { toast('Write something first'); return; }
  if (!g.canPlan || g.you === null) { toast('⊘ Not now'); return; }
  if (g.live) g.src.liveFree?.({ type: 'dispatch', text: t, as: asWho });
  else { g.plan.free = g.plan.free.filter(x => x.type !== 'dispatch'); g.plan.free.push({ type: 'dispatch', text: t, as: asWho }); g.savePlan(); }
  draft = '';
  audio.ui('confirm');
  toast('✒ Filed for the next edition');
  g.renderAll();
  render(g, edNow(g));
}

function render(g: GameScreen, ed: HeraldEdition) {
  const art = open?.el.querySelector<HTMLElement>('.herald');
  if (!art) return;
  const st = g.st;
  const hs = ed.headlines.filter(h => visible(g, h)).slice(0, 6);
  const [lead, ...rest] = hs.length ? hs : [{ kind: 'quiet', text: 'Quiet in the Reach', players: [], drama: 0, public: true } as Headline];
  const T = g.live ? 'Cycle' : 'Turn';
  const eds = editions(g);
  const i = eds.indexOf(ed);
  const nav = `<nav class="hd-nav">${i > 0 ? `<button data-h="ed" data-t="${eds[i - 1].turn}">‹ ${T} ${eds[i - 1].turn}</button>` : '<span></span>'}${i < eds.length - 1 ? `<button data-h="ed" data-t="${eds[i + 1].turn}">${T} ${eds[i + 1].turn} ›</button>` : '<span></span>'}</nav>`;
  const hl = (h: Headline, cls: string) => {
    const by = h.players.filter(p => p >= 0 && st.players[p]).map(p => `<i style="background:${esc(g.color(p))}"></i>`).join('');
    const go = h.region !== undefined && st.regions[h.region] ? ` data-h="region" data-r="${h.region}"` : '';
    return `<section class="hl ${cls} k-${esc(h.kind)}"${go}><span class="hl-ic">${headlineIcon(h.kind)}</span><h2>${esc(h.text)}</h2>${by ? `<span class="hl-by">${by}</span>` : ''}</section>`;
  };
  const disp = ed.dispatches.map(d => `<blockquote class="dsp" style="--pc:${esc(g.color(d.player))}"><p>“${esc(d.text)}”</p><cite>— ${esc(d.byline)}</cite></blockquote>`).join('');
  const pend = g.you !== null ? pending(g) : null;
  const can = g.you !== null && g.canPlan && st.winner === null;
  const me = g.you !== null ? st.players[g.you] : null;
  const plant = !can ? '' : pend
    ? `<div class="plant filed"><b>✒ Filed</b><p>“${esc(pend.text)}”</p><small>${pend.as === 'source' ? 'as an unnamed source' : `as ${esc(me?.name ?? '')}`} · prints next edition</small>${!g.live ? '<button class="hb plain" data-h="unfile">↶ Withdraw</button>' : ''}</div>`
    : `<div class="plant"><label>✒ Plant a dispatch</label><textarea data-dispatch maxlength="${max(g)}" rows="2" placeholder="A boast, a threat, a lie…">${esc(draft)}</textarea>
       <div class="plant-row"><span class="seg2"><button class="${asWho === 'house' ? 'on' : ''}" data-h="as" data-v="house">${esc(me?.name.split(' ').slice(-1)[0] ?? 'House')}</button><button class="${asWho === 'source' ? 'on' : ''}" data-h="as" data-v="source">A source</button></span><span class="dsp-count">${draft.length}/${max(g)}</span><button class="hb" data-h="file">File</button></div></div>`;
  const ink = lead.players.length && st.players[lead.players[0]] ? g.color(lead.players[0]) : '#2a1d10';
  art.innerHTML = `
    <header class="hd-mast"><div class="hd-ear">${sigilSvg('crown', 26, '#2a1d10')}<span>Late<br>edition</span></div><h1>The Herald</h1><div class="hd-ear r"><span>One<br>credit</span>${sigilSvg('raven', 26, '#2a1d10')}</div></header>
    <div class="hd-date"><span>${T} ${ed.turn}</span><span>of the Three Crowns</span><span>${esc(st.players.filter(p => !p.eliminated).length)} houses stand</span></div>
    <div class="hd-body">
      <div class="hd-main">${hl(lead, 'lead')}<div class="hd-rule" style="--ink:${esc(ink)}"></div><div class="hd-cols">${rest.map(h => hl(h, '')).join('')}</div></div>
      <aside class="hd-side"><h3>Dispatches</h3>${disp || '<p class="hd-none">No house wrote in.</p>'}${plant}</aside>
    </div>
    <footer class="hd-foot">${nav}<button class="hb go" data-h="close">To the board ▸</button></footer>`;
  iconizeDom(art);
}

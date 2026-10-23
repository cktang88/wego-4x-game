// The Herald (docs/SOUL.md §3): a front page each WEGO turn / LIVE cycle, printed from the game's events, plus the
// houses' planted dispatches (a boast, a threat or a lie, printed as fact). Shown at the start of a turn (after the
// replay), and from the Chronicle. Each house may plant one dispatch per edition (free action `dispatch`).
import type { GameScreen } from '../game.ts';
import type { HeraldEdition, Headline } from '../../../shared/sim/types.ts';
import { headlineVisible } from '../../../shared/sim/herald.ts';
import { soulOn, SR } from '../../../shared/sim/soul.ts';
import { esc, toast } from './dom.ts';
import { sigilSvg } from '../art/sigils.ts';
import { iconizeDom, ic, icFor, glyphHtml, type IconKey } from '../art/icons.ts';
import '../herald.css';
import { audio } from '../audio/audio.ts';
import { ownerHi, enamel } from '../art/bible.ts';
import { TEMPERS, rulerImg, aiHouseLine } from './houses.ts';
import { smudgesFor } from './ink.ts';
import { portraitImg, portraitCaption } from '../art/portraits.ts';
import { MAIMED_AT, GREY_AFTER } from '../hud/portrait.ts';
import { SCARS } from '../../../shared/config/content.ts';

const KIND_ICON: Record<string, string> = {
  rout: '⤺', caught: '✝', destroyed: '✝', broken: '✝', death: '✝', vengeance: '⚔', debt: '✠', vow_broken: '✗', vow_kept: '✦',
  vow_sworn: '✠', oath: '✗', coronation: '♛', relic: '✧', capital: '♜', capture: '⚑', razed: '♨', liberated: '☼', battle: '⚔',
  honour: '❖', legend: '★', retired: '⚑', eliminated: '✝', founded: '⚑', quiet: '☾', calling: '◈', deed: '◆', fate: '✪', fate_bonus: '✪',
  p_called: '✓', p_caught: '✗', p_ambush: '◉', p_broken: '⚡', p_exposed: '◌', p_scorched: '♨', p_levies: '⚑',
  tribute: '⚖', tribute_offer: '⚖', refugees: '⇢',
  // the Herald remembers (shared/sim/herald.ts): obituaries, anniversaries of broken oaths, a League feud, the acts of the war
  obituary: '✝', anniversary: '⏳', feud: '✠', act_claim: '♨', act_borders: '⛩', act_blood: '†', act_crisis: '⚖', act_throne: '♔', act_last: '⏱',
};
/** A special edition's ornament (ACT_EDITIONS[act].ornament) as an icon of the closed set. */
const ORNAMENT: Record<string, IconKey> = { beacon: 'fire', border: 'gates', blood: 'blade', scales: 'scales', throne: 'throne', candle: 'time', feud: 'blood-debt' };
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const headlineIcon = (k: string) => ic(icFor('herald', k, KIND_ICON[k] ?? (k.startsWith('p_') ? '◉' : '•')));

const seenKey = (g: GameScreen) => `tc.herald.${g.gameKey()}.${g.you ?? 's'}`;
function seen(g: GameScreen): number { try { return Number(localStorage.getItem(seenKey(g)) ?? 0) || 0; } catch { return 0; } }
function markSeen(g: GameScreen, t: number) { try { localStorage.setItem(seenKey(g), String(t)); } catch { /* */ } }
/** Browser scripts can keep the Herald from opening by itself: localStorage 'tc.herald.auto' = 'off'. */
const autoOff = () => { try { return localStorage.getItem('tc.herald.auto') === 'off'; } catch { return false; } };

export function editions(g: GameScreen): HeraldEdition[] { return g.st.soul?.herald ?? []; }
const visible = (g: GameScreen, h: Headline) => (g.you === null ? h.public || g.st.winner !== null : headlineVisible(h, g.you));

let open: { el: HTMLElement; turn: number; inked?: boolean } | null = null;
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
  el.innerHTML = `<div class="herald-back" data-h="close"></div><article class="herald" role="dialog" aria-modal="true" aria-label="The Herald" lang="en"></article>`;
  document.body.appendChild(el);
  open = { el, turn: ed.turn };
  useDraft(g);
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

/** A headline with its story (the sim may add body, byline and dateline; old saves have none). */
type Story = Headline & { body?: string; byline?: string; dateline?: string };

// the unfiled draft and its signing choice belong to one seat of one game: in hotseat, the next player must not
// find the last player's half-written lie in the box (a curtain leak), nor carry it into another game
let draft = '';
let asWho: 'house' | 'source' = 'house';
let draftOf = '';
const drafts = new Map<string, { draft: string; asWho: 'house' | 'source' }>();
function useDraft(g: GameScreen) {
  const k = `${g.gameKey()}:${g.you ?? 's'}`;
  if (k === draftOf) return;
  if (draftOf) drafts.set(draftOf, { draft, asWho });
  const d = drafts.get(k);
  draft = d?.draft ?? ''; asWho = d?.asWho ?? 'house'; draftOf = k;
}
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
  // every story the sim printed: the edition is already capped (heraldMax), plus the obituary, the act and the feud
  const hs = ed.headlines.filter(h => visible(g, h));
  const [lead, ...rest]: Story[] = hs.length ? hs : [{ kind: 'quiet', text: 'Quiet in the Reach', players: [], drama: 0, public: true } as Headline];
  const T = g.live ? 'Cycle' : 'Turn';
  const eds = editions(g);
  const i = eds.indexOf(ed);
  const nav = `<nav class="hd-nav">${i > 0 ? `<button data-h="ed" data-t="${eds[i - 1].turn}" aria-label="Previous edition, ${T} ${eds[i - 1].turn}">‹ ${T} ${eds[i - 1].turn}</button>` : '<span></span>'}${i < eds.length - 1 ? `<button data-h="ed" data-t="${eds[i + 1].turn}" aria-label="Next edition, ${T} ${eds[i + 1].turn}">${T} ${eds[i + 1].turn} ›</button>` : '<span></span>'}</nav>`;
  const hl = (h: Story, cls: string) => {
    const by = h.players.filter(p => p >= 0 && st.players[p]).map(p => `<i style="background:${esc(ownerHi(g.color(p)))}"></i>`).join('');
    const reg = h.region !== undefined ? st.regions[h.region] : undefined;
    const go = reg ? ` data-h="region" data-r="${h.region}" title="Show ${esc(reg.name)} on the map"` : '';
    // the headline is the link to the map (a button: reachable by keyboard and touch); the story stays plain text
    const head = `<h2>${reg ? `<button class="hl-go"${go}>${esc(h.text)}</button>` : esc(h.text)}</h2>`;
    const paras = (h.body ?? '').split(/\n+/).map(x => x.trim()).filter(Boolean);
    const dl = paras.length ? (h.dateline ?? (reg ? `${reg.name}, ${T} ${ed.turn}` : `${T} ${ed.turn}`)).replace(/\s*[—–-]+\s*$/, '') : '';
    // an obituary carries the fallen commander's portrait, mourning sash and every scar it earned
    const por = h.kind === 'obituary' ? obituaryPortrait(g, h) : '';
    const body = paras.length
      ? `<div class="hl-body">${por}${h.byline ? `<p class="hl-byl">${glyphHtml(esc(h.byline))}</p>` : ''}<p class="hl-dl">${glyphHtml(esc(dl))} —</p>${paras.map((x, i) => `<p${i === 0 ? ' class="first"' : ''}>${glyphHtml(esc(x))}</p>`).join('')}</div>`
      : por;
    return `<section class="hl ${cls} k-${esc(h.kind)}${paras.length ? ' has-body' : ''}"><span class="hl-ic">${headlineIcon(h.kind)}</span>${head}${by ? `<span class="hl-by">${by}</span>` : ''}${body}</section>`;
  };
  // dispatches: an AI house writes in its ruler's hand and signs with its motto (ui/houses.ts); in your copy the ink
  // runs where your own intel contradicts the words (ui/ink.ts), and only there
  const smudge = smudgesFor(g, ed, ed === eds[eds.length - 1]);
  const disp = ed.dispatches.map((d, i) => {
    const p = st.players[d.player];
    const temper = p?.kind === 'ai' ? TEMPERS[p.aiLevel] ?? TEMPERS.standard : null;
    const signed = !!temper && d.as === 'house';
    const why = smudge.get(i);
    return `<blockquote class="dsp${temper ? ` hand-${temper.hand}` : ''}${why ? ' smudged' : ''}${signed ? ' signed' : ''}" style="--pc:${esc(ownerHi(g.color(d.player)))}">${signed ? `<span class="dsp-ruler">${rulerImg(p.aiLevel, enamel(p.color).base, 40)}</span>` : ''}<p>“${esc(d.text)}”</p><cite>— ${esc(d.byline)}${signed ? `<small>${esc(aiHouseLine(p) ?? '')} · “${esc(temper!.motto)}”</small>` : ''}</cite>${why ? `<aside class="dsp-note" role="note">${ic('eye')}<span><b>The ink runs.</b> ${esc(why)}</span></aside>` : ''}</blockquote>`;
  }).join('');
  if (smudge.size && ed === eds[eds.length - 1] && open && !open.inked) { open.inked = true; audio.touch('smudge'); }
  const pend = g.you !== null ? pending(g) : null;
  const can = g.you !== null && g.canPlan && st.winner === null;
  const me = g.you !== null ? st.players[g.you] : null;
  const plant = !can ? '' : pend
    ? `<div class="plant filed"><b>✒ Filed</b><p>“${esc(pend.text)}”</p><small>${pend.as === 'source' ? 'as an unnamed source' : `as ${esc(me?.name ?? '')}`} · prints next edition</small>${!g.live ? '<button class="hb plain" data-h="unfile">↶ Withdraw</button>' : ''}</div>`
    : `<div class="plant"><label>✒ Plant a dispatch</label><textarea data-dispatch maxlength="${max(g)}" rows="2" placeholder="A boast, a threat, a lie…">${esc(draft)}</textarea>
       <div class="plant-row"><span class="seg2" role="group" aria-label="Sign it as"><button class="${asWho === 'house' ? 'on' : ''}" data-h="as" data-v="house">${esc(me?.name.split(' ').slice(-1)[0] ?? 'House')}</button><button class="${asWho === 'source' ? 'on' : ''}" data-h="as" data-v="source">A source</button></span><span class="dsp-count">${draft.length}/${max(g)}</span><button class="hb" data-h="file">File</button></div></div>`;
  const ink = lead.players.length && st.players[lead.players[0]] ? ownerHi(g.color(lead.players[0])) : '#2a1d10';
  // a special edition marks an act of the war; a League game's first edition opens with the old feud
  const sp = ed.special;
  const orn = (k: string) => `<i class="hd-orn" aria-hidden="true">${ic(ORNAMENT[k] ?? 'dot')}</i>`;
  const act = sp
    ? `<div class="hd-act orn-${esc(sp.ornament)}">${orn(sp.ornament)}<span class="hd-act-n">Act ${ROMAN[sp.n] ?? sp.n}</span><b>${esc(sp.title)}</b>${orn(sp.ornament)}</div>`
    : ed.feud ? `<div class="hd-act orn-feud">${orn('feud')}<span class="hd-act-n">The League</span><b>The Old Feud</b>${orn('feud')}</div>` : '';
  const ear = sp ? 'Special<br>edition' : ed.feud ? 'League<br>edition' : 'Late<br>edition';
  art.classList.toggle('special', !!sp);
  art.innerHTML = `
    <header class="hd-mast"><div class="hd-ear">${sigilSvg('crown', 26, '#2a1d10')}<span>${ear}</span></div><h1>The Herald</h1><div class="hd-ear r"><span>One<br>credit</span>${sigilSvg('raven', 26, '#2a1d10')}</div></header>
    ${act}
    <div class="hd-date"><span>${T} ${ed.turn}</span><span class="hd-of">of the Three Crowns</span>${ed.correspondent ? `<span class="hd-corr">${esc(ed.correspondent)}, at the front</span>` : ''}<span class="hd-stand">${esc(st.players.filter(p => !p.eliminated).length)} houses stand</span></div>
    <div class="hd-body">
      <div class="hd-main">${hl(lead, 'lead')}<div class="hd-rule" style="--ink:${esc(ink)}"></div><div class="hd-cols">${rest.map(h => hl(h, '')).join('')}</div></div>
      <aside class="hd-side"><h3>Dispatches</h3>${disp || `<p class="hd-none">${can ? 'No house wrote in. Plant the first word below: a boast, a threat, a lie.' : 'No house wrote in to this edition.'}</p>`}${plant}</aside>
    </div>
    <footer class="hd-foot">${nav}<button class="hb go" data-h="close">To the board ▸</button></footer>`;
  iconizeDom(art);
}

/** The fallen commander of an obituary ("Obituary: <name>"), from the record of its banner when the reader has it. */
function obituaryPortrait(g: GameScreen, h: Headline): string {
  const name = h.text.replace(/^Obituary:\s*/i, '').trim();
  if (!name) return '';
  const rec = (g.st.soul?.fallen ?? []).find(r => r.commander === name);
  const owner = rec?.owner ?? h.players[0];
  const spec = {
    name, color: g.color(owner ?? -1), dead: true,
    scars: rec?.scars.map(x => x.id) ?? [], maimed: (rec?.routs ?? 0) >= MAIMED_AT, legend: (rec?.rank ?? 0) >= 5, rank: rec?.rank ?? 1,
    grey: !!rec && rec.fateTurn - rec.foundedTurn >= GREY_AFTER,
  };
  const cap = portraitCaption(spec, SCARS);
  return `<figure class="hl-por">${portraitImg(spec, 84, 'portrait', cap).replace('<img ', `<img title="${esc(cap)}" `)}<figcaption>${esc(name)}</figcaption></figure>`;
}

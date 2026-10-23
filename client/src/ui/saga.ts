// The Saga (docs/SOUL.md §3, DELIGHT #78 #79): at the end of a game, a leather-bound book in the winner's colour laid
// open on the table. Its cover swings open; the leaves turn (the right page lifts over the spine onto the left); a
// frontispiece of the winner faces the title page; every banner gets a chapter with its commander's portrait, scars
// and all; then the Throne's reigns, the oaths and debts, the worlds and the memorial roll. Everything printed is
// sagaOf(state): nothing is invented. Phones read it a page at a time.
// The share card (#79): one image for the group chat (1200x630, or 1080x1350 for a phone's chat), with the three
// houses' seals, the decisive moment and the headline; shared through the system sheet where there is one.
// "Copy text", "Copy link" (online games: the finished game is public) and "Save image" (the whole Saga) stay.
import type { GameScreen } from '../game.ts';
import { sagaOf, type Saga, type FleetSaga } from '../../../shared/sim/herald.ts';
import { BOONS, BANES, CALLINGS, SCARS } from '../../../shared/config/content.ts';
import { esc, toast } from './dom.ts';
import { bannerSvg, drawSigil, goldPaint, sigilSvg } from '../art/sigils.ts';
import { headlineIcon } from './herald.ts';
import { beatIcon } from '../hud/soul.ts';
import { iconizeDom, ic, icFor, glyphHtml } from '../art/icons.ts';
import { enamel, ownerHi, ownerText } from '../art/bible.ts';
import { drawPortrait, type PortraitSpec } from '../art/portraits.ts';
import { sagaPortrait, portraitTag } from '../hud/portrait.ts';
import { TEMPERS, houseShort } from './houses.ts';
import { waxSealHtml, signetOf } from '../fx/stage.ts';
import { audio } from '../audio/audio.ts';
import '../saga.css';

const FATE: Record<FleetSaga['fate'], [string, string]> = {
  alive: ['Still flies', 'alive'], destroyed: ['Destroyed', 'dead'], caught: ['Hunted down', 'dead'], broken: ['Broken', 'dead'], retired: ['Retired', 'retired'], merged: ['Merged', 'merged'],
};
const ROMAN = (n: number) => { const m: [number, string][] = [[50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let s = ''; for (const [v, r] of m) while (n >= v) { s += r; n -= v; } return s; };
const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let el: HTMLElement | null = null;
let offKeys: (() => void) | null = null;
export const sagaOpen = () => !!el?.isConnected;
let returnFocus: HTMLElement | null = null;
export function closeSaga() {
  if (!el) return;
  const e = el; el = null;
  returnFocus?.focus?.({ preventScroll: true }); returnFocus = null;
  offKeys?.(); offKeys = null;
  audio.ui('close');
  e.classList.add('out'); setTimeout(() => e.remove(), 220);
}

// ------------------------------------------------------------------ who the book is about
interface Hero { spec: PortraitSpec | null; caption: string; owner: number; fleet: FleetSaga | null }
/** The frontispiece: the winner (or the leader, if the war goes on). An AI house shows its ruler; a player's house
 *  its greatest commander (the Saga's own order: rank, then epithets). */
function heroOf(g: GameScreen, S: Saga): Hero {
  const st = g.st;
  const w = st.winner ?? st.players.slice().sort((a, b) => b.vp - a.vp)[0]?.id ?? 0;
  const p = st.players[w];
  if (p?.kind === 'ai') {
    const t = TEMPERS[p.aiLevel] ?? TEMPERS.standard;
    return { spec: { name: `${t.title} of ${enamel(g.color(w)).base}`, color: enamel(g.color(w)).base, persona: t.persona, rank: p.aiLevel === 'expert' ? 5 : p.aiLevel === 'standard' ? 3 : 1 }, caption: `${t.title} of the ${houseShort(g.color(w), p.name)}`, owner: w, fleet: null };
  }
  const f = S.fleets.find(x => x.owner === w) ?? null;
  if (!f) return { spec: null, caption: p?.name ?? '', owner: w, fleet: null };
  return { spec: sagaPortrait(st, f, g.color(w)), caption: `${f.commander}, ${f.rankName}, of ${f.name}`, owner: w, fleet: f };
}
/** The biggest moment of the game (the Herald ranks them by drama; the Saga lists them in that order). */
const decisive = (S: Saga) => S.moments[0] ?? null;

// ------------------------------------------------------------------ the pages
function pagesOf(g: GameScreen, S: Saga): string[] {
  const st = g.st;
  const T = g.live ? 'Cycle' : 'Turn';
  const pn = (p: number) => `<b class="sg-who" style="--pc:${esc(inkOf(g.color(p)))}">${esc(g.pname(p))}</b>`;
  const winner = st.winner !== null ? st.players[st.winner] : null;
  const ranks = st.players.slice().sort((a, b) => b.vp - a.vp);
  const lastTurn = Math.max(1, st.winner !== null ? st.turn : st.turn - 1);
  const hero = heroOf(g, S);
  const pages: string[] = [];

  // I. the frontispiece: an engraved plate of the winner
  const heroBan = hero.fleet ? bannerSvg(hero.fleet.sigil || 'star', ownerHi(g.color(hero.owner)), 44, { rim: hero.fleet.rank >= 4 ? 'gold' : 'silver', rank: hero.fleet.rank, broken: hero.fleet.oathbreaker })
    : bannerSvg('crown', ownerHi(g.color(hero.owner)), 44, { rim: 'gold' });
  pages.push(`<div class="sg-front">
    <div class="sg-plate">${hero.spec ? portraitTag(hero.spec, 168, 'portrait sg-hero', 'title') : `<span class="sg-hero-ban">${bannerSvg('crown', ownerHi(g.color(hero.owner)), 120, { rim: 'gold' })}</span>`}<span class="sg-plate-ban">${heroBan}</span></div>
    <p class="sg-cap">${esc(hero.caption)}</p>
    <div class="sg-crowned">${winner ? `<small>Crowned, ${T} ${st.turn}</small><b style="--pc:${esc(inkOf(winner.color))}">${esc(winner.name)}</b><em>${esc(st.winReason || 'wins')}</em>` : `<small>${T} ${st.turn}</small><b style="--pc:${esc(inkOf(st.players[hero.owner]?.color ?? ''))}">${esc(st.players[hero.owner]?.name ?? '')}</b><em>leads, and the war goes on</em>`}</div>
  </div>`);

  // II. the title page: the masthead, the standings as three seals, the moments
  const moments = S.moments.map((m, i) => `<figure class="sg-moment n${i}"><span class="mic">${headlineIcon(m.kind)}</span><blockquote>${esc(m.text)}</blockquote><figcaption>${T} ${m.turn}</figcaption></figure>`).join('');
  pages.push(`<div class="sg-title">
    <small class="kicker">The Saga of</small><h1>The Three Crowns</h1>
    <p class="sg-sub">being a true account of the war for the Hollow Throne, set down in ${lastTurn} ${g.live ? 'cycles' : 'turns'}</p>
    <ol class="sg-ranks">${ranks.map((p, i) => `<li class="${i === 0 && winner ? 'first' : ''}">${waxSealHtml({ seat: p.id, color: p.color }, i === 0 && winner ? 46 : 38)}<b style="--pc:${esc(inkOf(p.color))}">${esc(p.name)}</b><span class="k-num">${p.vp} ${ic('vp')}</span>${(p.oathbreaker ?? []).length ? '<em>Oathbreaker</em>' : ''}</li>`).join('')}</ol>
    <h2 class="sg-h">The moments</h2>${moments ? `<div class="sg-moments">${moments}</div>` : '<p class="sg-none">A quiet war: the Herald found nothing worth the ink.</p>'}
  </div>`);

  // III. the Throne, the oaths, the debts
  const reigns = S.reigns.map(r => {
    const to = r.to ?? lastTurn + 1;
    return `<i style="left:${((r.from - 1) / lastTurn * 100).toFixed(2)}%;width:${(Math.max(0.6, (to - r.from) / lastTurn * 100)).toFixed(2)}%;background:${esc(enamel(g.color(r.player)).base)}" title="${esc(r.name)} ${T} ${r.from}–${r.to ?? 'end'}"></i>`;
  }).join('');
  const oaths = [
    ...S.oaths.map(o => `<li>${pn(o.player)} broke faith with ${pn(o.victim)} <small>${T} ${o.turn}</small>${o.words ? `<q>${esc(o.words)}</q>` : ''}</li>`),
    ...S.vowsBroken.map(v => `<li>${esc(v.fleet)} <span class="dim">(${esc(g.pname(v.owner))})</span> forswore its vow <small>${T} ${v.turn}</small></li>`),
  ].join('');
  const debts = S.debts.map(d => `<li>${pn(d.debtor)} owed ${pn(d.creditor)} for ${esc(d.victim)} <small>${T} ${d.turn}</small> ${d.cleared ? `<span class="paid">avenged, ${T} ${d.cleared}</span>` : '<span class="unpaid">unpaid</span>'}</li>`).join('');
  pages.push(`<h2 class="sg-h">The Hollow Throne</h2>${reigns ? `<div class="sg-reigns"><div class="bar">${reigns}</div><div class="axis"><span>${T} 1</span><span>${T} ${lastTurn}</span></div><ul>${S.reigns.map(r => `<li>${pn(r.player)} <small>${T} ${r.from}–${r.to ?? (st.winner !== null ? 'end' : 'now')}</small></li>`).join('')}</ul></div>` : '<p class="sg-none">No one ever sat the Throne. It waits for the next war.</p>'}
    <h2 class="sg-h">Oaths broken</h2>${oaths ? `<ul class="sg-list">${oaths}</ul>` : '<p class="sg-none">Every word was kept.</p>'}
    <h2 class="sg-h">Blood-debts</h2>${debts ? `<ul class="sg-list">${debts}</ul>` : '<p class="sg-none">No blood owed.</p>'}`);

  // IV. a chapter per banner, with its commander's portrait
  S.fleets.forEach((f, i) => {
    const [fw, fc] = FATE[f.fate];
    const col = g.color(f.owner);
    pages.push(`<article class="sg-fleet ${fc}" style="--pc:${esc(inkOf(col))}">
      <small class="sg-ch">Chapter ${ROMAN(i + 1)}</small>
      <header>${portraitTag(sagaPortrait(st, f, col), 92, 'portrait sg-por', 'title')}
        <div><h3>${esc(f.name)}</h3>${f.epithets.length ? `<em>${esc(f.epithets.join(' · '))}</em>` : ''}<small>${esc(f.rankName)} · ${esc(f.commander)}</small><span class="sg-house">${bannerSvg(f.sigil || 'star', ownerHi(col), 26, { rim: f.rank >= 4 ? 'gold' : 'silver', rank: f.rank, broken: f.oathbreaker })}${esc(g.pname(f.owner))}</span></div></header>
      <span class="sg-fate">${fw}${f.fateTurn ? ` · ${T} ${f.fateTurn}` : ''}</span>
      <p class="sg-para">${esc(f.paragraph)}</p>
      <div class="sg-tags">${f.boons.map(b => `<span class="t boon">${ic(icFor('boon', b, BOONS[b]?.icon))} ${esc(BOONS[b]?.name ?? b)}</span>`).join('')}${f.banes.map(b => `<span class="t bane">${ic(icFor('bane', b, BANES[b]?.icon))} ${esc(BANES[b]?.name ?? b)}</span>`).join('')}${f.scars.map(s => `<span class="t scar">${ic(icFor('scar', s, SCARS[s]?.icon))} ${esc(SCARS[s]?.name ?? s)}</span>`).join('')}</div>
      ${f.beats.length ? `<ol class="sg-beats">${f.beats.slice(-8).map(b => `<li><span class="bi">${beatIcon(b.kind)}</span><small>${T} ${b.turn}</small><span>${glyphHtml(esc(b.text))}</span></li>`).join('')}</ol>` : ''}
    </article>`);
  });
  if (!S.fleets.length) pages.push(`<h2 class="sg-h">The banners</h2><p class="sg-none">No banners were raised. Next war, found one at a yard: a named fleet earns a chapter here.</p>`);

  // V. the worlds and the memorial roll
  const worlds = S.worlds.slice(0, 14).map(w => `<li><b>${esc(w.name)}</b>${w.epithet ? ` <em>${esc(w.epithet)}</em>` : ''}${w.calling ? ` · ${ic(icFor('calling', w.calling, CALLINGS[w.calling]?.icon))} ${esc(CALLINGS[w.calling]?.name ?? w.calling)}` : ''}${(() => { const ds = w.deeds.filter(d => d.toLowerCase() !== (w.epithet ?? '').toLowerCase()); return ds.length ? ` · ${ds.map(esc).join(', ')}` : ''; })()}</li>`).join('');
  pages.push(`<h2 class="sg-h">Worlds remembered</h2>${worlds ? `<ul class="sg-list">${worlds}</ul>` : '<p class="sg-none">No world made history. A world held long enough earns a Calling, and a name.</p>'}`);
  const mem = S.memorials.map(m => `<li>${esc(m.text)}</li>`).join('');
  pages.push(`<h2 class="sg-h">The memorial roll</h2>${mem ? `<ul class="sg-mem">${mem}</ul>` : '<p class="sg-none">No names on the stone.</p>'}
    <div class="sg-finis">${sigilSvg('crown', 30, '#6b4a1c')}<span>Finis</span></div>`);
  return pages;
}
/** A house colour as ink on vellum: the enamel base, darkened enough to read on paper. */
function inkOf(color: string): string {
  const b = enamel(color).base.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(b)) return '#2a1d10';
  const n = parseInt(b, 16), k = 0.5;
  return `#${((1 << 24) | (Math.round(((n >> 16) & 255) * k) << 16) | (Math.round(((n >> 8) & 255) * k) << 8) | Math.round((n & 255) * k)).toString(16).slice(1)}`;
}

// ------------------------------------------------------------------ the book
export function openSaga(g: GameScreen) {
  const st = g.st;
  const S = sagaOf(st);
  el?.remove(); offKeys?.();
  if (!el) returnFocus = document.activeElement as HTMLElement | null;
  const pages = pagesOf(g, S);
  const lead = st.winner ?? st.players.slice().sort((a, b) => b.vp - a.vp)[0]?.id ?? 0;
  const lc = enamel(g.color(lead));
  const link = shareLink(g);
  el = document.createElement('div');
  el.className = 'saga-ov';
  el.innerHTML = `<div class="saga" role="dialog" aria-modal="true" aria-label="The Saga">
    <div class="sg-book" style="--lea:${esc(lc.base)};--lea-lo:${esc(lc.lo)};--lea-hi:${esc(lc.hi)}">
      <div class="sg-spread">${pages.map((p, i) => `<section class="sg-page ${i % 2 ? 'verso-r' : 'verso-l'}" data-i="${i}" aria-label="Page ${i + 1}"><div class="sg-pin">${p}</div><span class="sg-folio" aria-hidden="true">${i + 1}</span></section>`).join('')}</div>
    </div>
    <footer class="sg-foot">
      <div class="sg-nav"><button class="k-btn nav" data-s="prev" aria-label="Previous page">${ic('caret')}</button><span class="sg-at" aria-live="polite"></span><button class="k-btn nav" data-s="next" aria-label="Next page">${ic('caret')}</button></div>
      <div class="sg-acts"><button class="k-btn" data-s="share">${ic('dispatch')} Share card</button><button class="k-btn" data-s="text">${ic('copy')} Copy text</button>${link ? `<button class="k-btn" data-s="link">${ic('chain')} Copy link</button>` : ''}<button class="k-btn" data-s="image">${ic('download')} Save image</button><button class="k-btn primary" data-s="close">Close</button></div>
    </footer></div>`;
  iconizeDom(el);
  document.body.appendChild(el);
  const root = el;
  const book = root.querySelector<HTMLElement>('.sg-book')!;
  const leaves = [...root.querySelectorAll<HTMLElement>('.sg-page')];
  const twoUp = () => window.matchMedia('(min-width: 54rem) and (min-height: 30rem)').matches;
  let at = 0;            // the first page shown
  let busy = false;
  const step = () => (twoUp() ? 2 : 1);
  const show = (i: number) => {
    const two = twoUp();
    at = two ? i - (i % 2) : i;
    leaves.forEach((p, k) => {
      p.dataset.slot = k === at ? (two ? 'l' : 'one') : two && k === at + 1 ? 'r' : '';
      p.toggleAttribute('inert', !p.dataset.slot);
    });
    book.classList.toggle('two', two);
    // an odd page count leaves a blank endpaper on the right
    book.classList.toggle('blank-r', two && at + 1 >= leaves.length);
    const last = Math.min(leaves.length, at + (two ? 2 : 1));
    root.querySelector('.sg-at')!.textContent = two && last > at + 1 ? `Pages ${at + 1}–${last} of ${leaves.length}` : `Page ${at + 1} of ${leaves.length}`;
    root.querySelector<HTMLButtonElement>('[data-s=prev]')!.disabled = at <= 0;
    root.querySelector<HTMLButtonElement>('[data-s=next]')!.disabled = at + step() >= leaves.length;
    leaves.forEach(p => { if (p.dataset.slot) p.scrollTop = 0; });
  };
  /** Turn a leaf: the page lifts over the spine (two-up) or turns away (one page); reduced motion cross-fades. */
  const turn = (dir: 1 | -1) => {
    const n = step();
    const to = at + dir * n;
    if (busy || to < 0 || to >= leaves.length) return;
    audio.touch('leaf');
    if (reducedMotion()) { book.classList.remove('fade'); void book.offsetWidth; book.classList.add('fade'); show(to); return; }
    busy = true;
    const two = twoUp();
    const face = (i: number, back: boolean) => {
      const src = leaves[i];
      const c = (src ? src.cloneNode(true) : document.createElement('section')) as HTMLElement;
      c.className = `sg-page sg-face ${back ? 'back' : 'front'}${src ? '' : ' blank'}`;
      c.removeAttribute('data-slot'); c.removeAttribute('inert'); c.removeAttribute('aria-label');
      if (src) c.scrollTop = 0;
      return c;
    };
    const leaf = document.createElement('div');
    leaf.className = `sg-leaf ${two ? (dir > 0 ? 'on-r' : 'on-l') : 'on-one'}`;
    leaf.setAttribute('aria-hidden', 'true');
    leaf.inert = true;
    let done: () => void;
    if (two) {
      // forward: the old right page lifts and lands as the new left; back: the old left lifts and lands as the new right
      leaf.append(face(dir > 0 ? at + 1 : at, false), face(dir > 0 ? at + 2 : at - 1, true));
      const keepL = dir > 0 ? at : to, keepR = dir > 0 ? to + 1 : at + 1;
      leaves.forEach((p, k) => { p.dataset.slot = k === keepL ? 'l' : k === keepR ? 'r' : ''; });
      book.classList.toggle('blank-r', keepR >= leaves.length);
      done = () => show(to);
    } else {
      // one page: forward, the page turns away over the new one; back, the earlier page turns in over this one
      leaf.append(face(dir > 0 ? at : to, false));
      leaves.forEach((p, k) => { p.dataset.slot = k === (dir > 0 ? to : at) ? 'one' : ''; });
      done = () => show(to);
    }
    book.appendChild(leaf);
    const a = leaf.animate(
      two ? [{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${dir > 0 ? -180 : 180}deg)` }]
        : dir > 0 ? [{ transform: 'rotateY(0deg)', filter: 'brightness(1)' }, { transform: 'rotateY(-96deg)', filter: 'brightness(0.55)' }] : [{ transform: 'rotateY(-96deg)', filter: 'brightness(0.55)' }, { transform: 'rotateY(0deg)', filter: 'brightness(1)' }],
      { duration: two ? 720 : 460, easing: 'cubic-bezier(0.45, 0.05, 0.25, 1)', fill: 'forwards' });
    const end = () => { leaf.remove(); busy = false; done(); };
    a.onfinish = end; a.oncancel = end;
  };
  show(0);
  // the cover swings open (once), the book's leather in the winner's colour
  if (!reducedMotion()) {
    const cover = document.createElement('div');
    cover.className = `sg-cover ${twoUp() ? 'on-r' : 'on-one'}`;
    cover.setAttribute('aria-hidden', 'true');
    cover.innerHTML = `<div class="sg-cover-face"><span class="sg-cover-t">The Saga</span>${bannerSvg('crown', lc.hi, 64, { rim: 'gold' })}<span class="sg-cover-s">of the Three Crowns</span></div><div class="sg-cover-in"></div>`;
    book.appendChild(cover);
    setTimeout(() => {
      if (!cover.isConnected) return;
      audio.touch('cover');
      // no opacity in these keyframes: opacity flattens a 3D card, and both faces would show at once
      const a = cover.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-180deg)' }],
        { duration: 1000, easing: 'cubic-bezier(0.3, 0.1, 0.2, 1)', fill: 'forwards' });
      a.onfinish = () => cover.remove(); a.oncancel = () => cover.remove();
    }, 420);
  }
  requestAnimationFrame(() => el?.classList.add('show'));
  audio.ui('open');
  root.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-s]');
    if (!b) { if (e.target === root) closeSaga(); return; }
    switch (b.dataset.s) {
      case 'close': closeSaga(); break;
      case 'prev': turn(-1); break;
      case 'next': turn(1); break;
      case 'text': copy(sagaText(g, S), 'Saga copied'); break;
      case 'link': if (link) copy(link, 'Link copied'); break;
      case 'image': void saveImage(g, S); break;
      case 'share': void shareCard(g, S); break;
    }
  });
  // swipe the page (touch), like a real leaf: left for the next, right for the previous
  let sx = 0, sy = 0, sid = -1;
  book.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') return; sid = e.pointerId; sx = e.clientX; sy = e.clientY; });
  book.addEventListener('pointerup', e => {
    if (e.pointerId !== sid) return;
    sid = -1;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.6) turn(dx < 0 ? 1 : -1);
  });
  const onKey = (e: KeyboardEvent) => {
    if (!root.isConnected) { offKeys?.(); return; }
    if (e.key === 'Escape') { e.stopPropagation(); closeSaga(); }
    else if (e.key === 'Tab') {
      // the book keeps focus inside it, like every other modal (QUALITY.md §8)
      const f = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, textarea, [tabindex]:not([tabindex="-1"])')].filter(x => !x.closest('[inert]') && x.offsetParent !== null);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey ? i <= 0 : i === f.length - 1 || i < 0) { e.preventDefault(); (e.shiftKey ? f[f.length - 1] : f[0]).focus(); }
    }
    else if ((e.key === 'ArrowRight' || e.key === 'PageDown') && !(e.target as HTMLElement)?.matches?.('input, textarea')) { e.preventDefault(); e.stopPropagation(); turn(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); e.stopPropagation(); turn(-1); }
  };
  const onResize = () => { if (!busy) show(at); };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  offKeys = () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize); };
  root.querySelector<HTMLElement>('[data-s=next]')?.focus({ preventScroll: true });
}

function shareLink(g: GameScreen): string {
  if (g.src.kind !== 'remote') return '';
  return `${location.origin}${location.pathname}#/g/${g.src.meta.id}`;
}
function copy(t: string, ok: string) {
  const done = () => toast(ok);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(t).then(done, () => fallback());
  else fallback();
  function fallback() {
    const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch { toast('Copy failed'); }
    ta.remove();
  }
}

/** The saga as plain text (the group chat). */
export function sagaText(g: GameScreen, S: Saga = sagaOf(g.st)): string {
  const st = g.st;
  const L: string[] = ['THE SAGA OF THE THREE CROWNS'];
  if (st.winner !== null) L.push(`${st.players[st.winner].name} wins: ${st.winReason}`);
  L.push(st.players.slice().sort((a, b) => b.vp - a.vp).map(p => `${p.name} ${p.vp}♛`).join(' · '), '');
  if (S.moments.length) { L.push('THE MOMENTS'); for (const m of S.moments) L.push(`· T${m.turn}: ${m.text}`); L.push(''); }
  if (S.reigns.length) { L.push('THE HOLLOW THRONE'); for (const r of S.reigns) L.push(`· ${r.name}, T${r.from}–${r.to ?? 'end'}`); L.push(''); }
  if (S.fleets.length) { L.push('THE BANNERS'); for (const f of S.fleets.slice(0, 12)) L.push(`${f.sigilGlyph} ${f.name}: ${f.paragraph}`); L.push(''); }
  if (S.oaths.length || S.vowsBroken.length) {
    L.push('OATHS BROKEN');
    for (const o of S.oaths) L.push(`· ${g.pname(o.player)} broke faith with ${g.pname(o.victim)} (T${o.turn})${o.words ? `: “${o.words}”` : ''}`);
    for (const v of S.vowsBroken) L.push(`· ${v.fleet} forswore its vow (T${v.turn})`);
    L.push('');
  }
  if (S.debts.length) { L.push('BLOOD-DEBTS'); for (const d of S.debts) L.push(`· ${g.pname(d.debtor)} owed ${g.pname(d.creditor)} for ${d.victim}${d.cleared ? ` (avenged T${d.cleared})` : ' (unpaid)'}`); L.push(''); }
  if (S.memorials.length) { L.push('THE MEMORIAL ROLL'); for (const m of S.memorials.slice(0, 20)) L.push(`· ${m.text}`); }
  return L.join('\n').trim();
}

// ------------------------------------------------------------------ canvas helpers
function wrap(c: CanvasRenderingContext2D, t: string, w: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of t.split(/\s+/)) {
    const tryL = line ? `${line} ${word}` : word;
    if (c.measureText(tryL).width > w && line) { out.push(line); line = word; } else line = tryL;
  }
  if (line) out.push(line);
  return out;
}
/** Vellum: warm paper, the lamp's pool upper left, foxing at the far corner, a fibre tooth. */
function vellum(c: CanvasRenderingContext2D, W: number, H: number) {
  const bg = c.createLinearGradient(0, 0, W * 0.3, H);
  bg.addColorStop(0, '#f1e6ca'); bg.addColorStop(0.58, '#e4d3ab'); bg.addColorStop(1, '#cdb588');
  c.fillStyle = bg; c.fillRect(0, 0, W, H);
  const lamp = c.createRadialGradient(W * 0.2, H * 0.08, 10, W * 0.25, H * 0.15, Math.max(W, H) * 0.7);
  lamp.addColorStop(0, 'rgba(255,248,228,0.7)'); lamp.addColorStop(1, 'rgba(255,248,228,0)');
  c.fillStyle = lamp; c.fillRect(0, 0, W, H);
  const fox = c.createRadialGradient(W, H, 10, W, H, Math.max(W, H) * 0.6);
  fox.addColorStop(0, 'rgba(110,74,30,0.35)'); fox.addColorStop(1, 'rgba(110,74,30,0)');
  c.fillStyle = fox; c.fillRect(0, 0, W, H);
  let s = 1234567;
  const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < (W * H) / 900; i++) { c.fillStyle = r() < 0.5 ? 'rgba(90,60,25,0.06)' : 'rgba(255,250,235,0.08)'; c.fillRect(r() * W, r() * H, 1 + r() * 2.5, 1); }
}
/** A poured wax seal in a house's colour with its signet pressed in (canvas twin of fx/stage waxSealHtml). */
function waxSeal(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, seat: number) {
  const e = enamel(color);
  c.save();
  c.shadowColor = 'rgba(40,20,5,0.55)'; c.shadowBlur = r * 0.35; c.shadowOffsetX = r * 0.08; c.shadowOffsetY = r * 0.16;
  c.beginPath();
  for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2, k = 1 + Math.sin(i * 2.7 + seat) * 0.035 + Math.sin(i * 5.3) * 0.02; c.lineTo(x + Math.cos(a) * r * k, y + Math.sin(a) * r * k); }
  const g = c.createRadialGradient(x - r * 0.34, y - r * 0.4, r * 0.05, x, y, r * 1.05);
  g.addColorStop(0, e.hi); g.addColorStop(0.55, e.base); g.addColorStop(1, e.lo);
  c.fillStyle = g; c.fill();
  c.restore();
  c.beginPath(); c.arc(x, y, r * 0.72, 0, Math.PI * 2); c.strokeStyle = 'rgba(0,0,0,0.28)'; c.lineWidth = r * 0.06; c.stroke();
  c.beginPath(); c.arc(x + r * 0.02, y + r * 0.03, r * 0.72, Math.PI * 0.9, Math.PI * 1.6); c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = r * 0.04; c.stroke();
  drawSigil(c, signetOf(seat), x, y, r * 0.9, 'rgba(0,0,0,0.42)', false);
  c.beginPath(); c.ellipse(x - r * 0.38, y - r * 0.42, r * 0.22, r * 0.12, -0.6, 0, Math.PI * 2); c.fillStyle = 'rgba(255,255,255,0.28)'; c.fill();
}
function brassFrame(c: CanvasRenderingContext2D, W: number, H: number, inset: number) {
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#f7e2a6'); g.addColorStop(0.3, '#c8964a'); g.addColorStop(0.7, '#8a5f22'); g.addColorStop(1, '#3a2810');
  c.strokeStyle = 'rgba(42,29,16,0.85)'; c.lineWidth = 10; c.strokeRect(inset - 3, inset - 3, W - (inset - 3) * 2, H - (inset - 3) * 2);
  c.strokeStyle = g; c.lineWidth = 6; c.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
  c.strokeStyle = 'rgba(107,74,28,0.45)'; c.lineWidth = 1.2; c.strokeRect(inset + 14, inset + 14, W - (inset + 14) * 2, H - (inset + 14) * 2);
}

// ------------------------------------------------------------------ the share card (#79)
export interface ShareCard { blob: Blob | null; url: string; w: number; h: number }
/** Paint the share card: 1200x630 (wide chat previews) or 1080x1350 (a phone's chat). */
export async function renderShareCard(g: GameScreen, S: Saga = sagaOf(g.st), tall = false): Promise<HTMLCanvasElement> {
  const st = g.st;
  const W = tall ? 1080 : 1200, H = tall ? 1350 : 630;
  try { await document.fonts?.ready; } catch { /* */ }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  const serif = '"Cinzel", Georgia, serif', body = '"IM Fell English", Georgia, serif', black = '"UnifrakturMaguntia", "Cinzel", Georgia, serif';
  vellum(c, W, H);
  brassFrame(c, W, H, 22);
  const hero = heroOf(g, S);
  const winner = st.winner !== null ? st.players[st.winner] : null;
  const lead = st.players[hero.owner];
  const T = g.live ? 'Cycle' : 'Turn';
  // the masthead
  c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = '#2a1d10';
  c.font = `${tall ? 64 : 50}px ${black}`; c.fillText('The Herald', W / 2, tall ? 130 : 96);
  c.strokeStyle = 'rgba(42,29,16,0.7)'; c.lineWidth = 1.5;
  const ry = tall ? 152 : 112;
  c.beginPath(); c.moveTo(70, ry); c.lineTo(W - 70, ry); c.moveTo(70, ry + 5); c.lineTo(W - 70, ry + 5); c.stroke();
  c.font = `600 ${tall ? 20 : 16}px ${serif}`; c.fillStyle = '#6b5638';
  c.fillText(`${T.toUpperCase()} ${st.turn}  ·  THE SAGA OF THE THREE CROWNS  ·  SPECIAL EDITION`, W / 2, ry + (tall ? 34 : 28));
  // the portrait plate (left on a wide card, top on a tall one)
  const pw = tall ? 300 : 210, ph = pw * 1.25;
  const px = tall ? W / 2 - pw / 2 : 70, py = tall ? 230 : 168;
  if (hero.spec) drawPortrait(c, hero.spec, px, py, pw, ph);
  else { c.save(); drawSigil(c, 'crown', px + pw / 2, py + ph / 2, pw * 0.7, goldPaint(c, py, py + ph)); c.restore(); }
  c.font = `italic ${tall ? 24 : 18}px ${body}`; c.fillStyle = '#4a3720'; c.textAlign = 'center';
  for (const [i, l] of wrap(c, hero.caption, pw + 40).slice(0, 2).entries()) c.fillText(l, px + pw / 2, py + ph + (tall ? 36 : 28) + i * (tall ? 28 : 22));
  // the headline and the decisive moment
  const hx = tall ? 90 : px + pw + 50, hw = tall ? W - 180 : W - hx - 70;
  let y = tall ? py + ph + 120 : 200;
  c.textAlign = tall ? 'center' : 'left';
  const ax = tall ? W / 2 : hx;
  const headline = winner ? `${winner.name.toUpperCase()} TAKES THE HOLLOW THRONE` : `${(lead?.name ?? '').toUpperCase()} LEADS THE WAR`;
  c.font = `800 ${tall ? 54 : 42}px ${serif}`; c.fillStyle = '#2a1d10';
  for (const l of wrap(c, headline, hw).slice(0, tall ? 3 : 2)) { c.fillText(l, ax, y); y += tall ? 62 : 48; }
  c.font = `italic ${tall ? 28 : 22}px ${body}`; c.fillStyle = '#3a2a18';
  const why = winner ? (st.winReason || 'Crowned.') : `${lead?.vp ?? 0} victory points, and the war goes on.`;
  for (const l of wrap(c, why, hw).slice(0, 2)) { c.fillText(l, ax, y); y += tall ? 36 : 28; }
  const m = decisive(S);
  if (m) {
    y += tall ? 22 : 14;
    c.font = `700 ${tall ? 18 : 14}px ${serif}`; c.fillStyle = '#8e1f1f';
    c.fillText(`THE MOMENT OF THE WAR · ${T.toUpperCase()} ${m.turn}`, ax, y); y += tall ? 38 : 30;
    c.font = `italic ${tall ? 30 : 24}px ${body}`; c.fillStyle = '#2a1d10';
    for (const l of wrap(c, `“${m.text}”`, hw).slice(0, tall ? 4 : 2)) { c.fillText(l, ax, y); y += tall ? 38 : 30; }
  }
  // the three seals, the winner's first and largest, each with its victory points
  const ranks = st.players.slice().sort((a, b) => b.vp - a.vp);
  const sy = tall ? H - 210 : H - 168;
  const gap = tall ? 300 : hw / 3;
  const cx0 = tall ? W / 2 - gap : hx + hw / 6;
  ranks.forEach((p, i) => {
    const x = cx0 + i * gap, r = i === 0 && winner ? (tall ? 50 : 36) : (tall ? 40 : 28);
    waxSeal(c, x, sy, r, p.color, p.id);
    c.textAlign = 'center'; c.fillStyle = '#2a1d10';
    c.font = `700 ${tall ? 22 : 16}px ${serif}`;
    let nm = p.name;
    while (c.measureText(nm).width > gap - 16 && nm.length > 4) nm = `${nm.slice(0, -2).trimEnd()}…`;
    const ny = sy + (tall ? 50 : 36) + (tall ? 34 : 24);
    c.fillText(nm, x, ny);
    c.font = `800 ${tall ? 24 : 17}px ${serif}`; c.fillStyle = '#6b4a1c';
    c.fillText(`${p.vp} VP`, x, ny + (tall ? 30 : 22));
  });
  c.textAlign = 'center'; c.font = `600 ${tall ? 16 : 13}px ${serif}`; c.fillStyle = '#7d6a4a';
  c.fillText('THREE CROWNS · A WAR BETWEEN THREE FRIENDS', W / 2, H - 46);
  return cv;
}
/** Make the card and hand it to the system share sheet (phones), else save it. One image, one tap. */
async function shareCard(g: GameScreen, S: Saga) {
  const tall = window.matchMedia('(max-width: 40rem)').matches;
  const cv = await renderShareCard(g, S, tall);
  const url = cv.toDataURL('image/png');
  (window as unknown as { __shareCard?: string }).__shareCard = url;
  const name = `three-crowns-t${g.st.turn}${tall ? '-tall' : ''}.png`;
  const blob = await new Promise<Blob | null>(r => cv.toBlob(r, 'image/png'));
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (blob && nav.share && nav.canShare) {
    const file = new File([blob], name, { type: 'image/png' });
    if (nav.canShare({ files: [file] })) {
      try { await nav.share({ files: [file], title: 'The Saga of the Three Crowns' }); return; } catch (e) { if ((e as Error)?.name === 'AbortError') return; }
    }
  }
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  toast('Share card saved');
}

// ------------------------------------------------------------------ the whole Saga as one image
export async function saveImage(g: GameScreen, S: Saga = sagaOf(g.st)) {
  const st = g.st;
  const W = 1080, P = 72;
  try { await document.fonts?.ready; } catch { /* */ }
  const serif = '"Cinzel", Georgia, serif', body = '"IM Fell English", Georgia, serif';
  const ink = '#2a1d10', faded = '#6b5638', rubric = '#8e1f1f';
  // measure first, then draw at the final height
  const plan = (c: CanvasRenderingContext2D, draw: boolean) => {
    let y = P + 10;
    const text = (t: string, font: string, color: string, x = P, align: CanvasTextAlign = 'left', lh = 0) => { c.font = font; if (draw) { c.fillStyle = color; c.textAlign = align; c.fillText(t, x, y); } y += lh; };
    text('THE SAGA OF', `600 22px ${serif}`, rubric, W / 2, 'center', 56);
    text('THE THREE CROWNS', `700 54px ${serif}`, ink, W / 2, 'center', 44);
    if (st.winner !== null) text(`${st.players[st.winner].name} wins · ${st.winReason}`, `italic 24px ${body}`, inkOf(st.players[st.winner].color), W / 2, 'center', 34);
    text(st.players.slice().sort((a, b) => b.vp - a.vp).map(p => `${p.name} ${p.vp}`).join('   ·   '), `600 20px ${serif}`, faded, W / 2, 'center', 30);
    if (draw) { c.strokeStyle = 'rgba(107,74,28,0.6)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(P, y); c.lineTo(W - P, y); c.stroke(); }
    y += 40;
    if (S.moments.length) {
      text('THE MOMENTS', `700 20px ${serif}`, rubric, P, 'left', 34);
      for (const m of S.moments) {
        c.font = `italic 24px ${body}`;
        const ls = wrap(c, `“${m.text}”`, W - P * 2 - 60);
        text(`T${m.turn}`, `700 16px ${serif}`, faded, P, 'left', 0);
        for (const l of ls) text(l, `italic 24px ${body}`, ink, P + 60, 'left', 30);
        y += 8;
      }
      y += 16;
    }
    if (S.reigns.length) {
      text('THE HOLLOW THRONE', `700 20px ${serif}`, rubric, P, 'left', 22);
      const last = Math.max(1, st.turn);
      if (draw) {
        c.fillStyle = 'rgba(42,29,16,0.12)'; c.fillRect(P, y, W - P * 2, 18);
        for (const r of S.reigns) { const to = r.to ?? last + 1; c.fillStyle = enamel(g.color(r.player)).base; c.fillRect(P + ((r.from - 1) / last) * (W - P * 2), y, Math.max(3, ((to - r.from) / last) * (W - P * 2)), 18); }
      }
      y += 54;
    }
    text('THE BANNERS', `700 20px ${serif}`, rubric, P, 'left', 30);
    for (const f of S.fleets.slice(0, 6)) {
      const y0 = y;
      if (draw) drawPortrait(c, sagaPortrait(st, f, g.color(f.owner)), P, y - 18, 64, 80);
      text(`${f.name}${f.epithets.length ? `, ${f.epithets.join(', ')}` : ''}`, `700 24px ${serif}`, inkOf(g.color(f.owner)), P + 84, 'left', 28);
      c.font = `20px ${body}`;
      for (const l of wrap(c, f.paragraph, W - P * 2 - 84).slice(0, 4)) text(l, `20px ${body}`, ink, P + 84, 'left', 25);
      y = Math.max(y, y0 + 70) + 14;
    }
    y += 10;
    if (S.oaths.length || S.debts.length) {
      text('OATHS & DEBTS', `700 20px ${serif}`, rubric, P, 'left', 30);
      for (const o of S.oaths.slice(0, 3)) text(`${g.pname(o.player)} broke faith with ${g.pname(o.victim)}${o.words ? `: “${o.words}”` : ''}`, `italic 20px ${body}`, rubric, P, 'left', 27);
      for (const d of S.debts.slice(0, 4)) text(`${g.pname(d.debtor)} owed ${g.pname(d.creditor)} for ${d.victim}${d.cleared ? ', avenged' : ', unpaid'}`, `20px ${body}`, ink, P, 'left', 27);
      y += 10;
    }
    text('THREE CROWNS · A WAR BETWEEN THREE FRIENDS', `600 15px ${serif}`, faded, W / 2, 'center', 0);
    return y + P;
  };
  const m = document.createElement('canvas').getContext('2d')!;
  const H = Math.ceil(plan(m, false));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  vellum(c, W, H);
  brassFrame(c, W, H, 22);
  c.textBaseline = 'alphabetic';
  plan(c, true);
  const url = cv.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url; a.download = `three-crowns-saga-t${st.turn}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  (window as unknown as { __sagaImage?: string }).__sagaImage = url;
  toast('Saga image saved');
}

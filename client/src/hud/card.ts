// The selection card (docs/WORLD-CARD.md): shown only while something is selected. PC and landscape tablets: a side
// card floating above the strip on the side away from the selection. Phone (and a portrait tablet under 700px): a
// bottom sheet with two snap points, peek (the face, the suggested action, the verbs) and full (swipe up or tap a
// verb). Every card has the same grammar: a painted face, verbs in fixed slots (worlds: Raise, Improve, Story;
// fleets: Orders, Story), a Gambit only when a bet is possible, and prompts that take the face for one decision.
// Worlds live in worldcard.ts; this file dispatches, places, binds the pointer and keyboard, and holds the fleet card.
import type { GameScreen } from '../game.ts';
import type { Doctrine, Fleet, Order, Region } from '../../../shared/sim/types.ts';
import { fleetPower, fleetSpeed } from '../../../shared/sim/graph.ts';
import { blueprintFor, supplied } from '../../../shared/sim/empire.ts';
import { etaTicks, tickMs } from '../../../shared/sim/live.ts';
import { esc, toast } from '../ui/dom.ts';
import { intentFor, commitIntent, type Intent } from './verbs.ts';
import { tip, fmtDur, shortName, shortWhy } from './util.ts';
import { chevrons, fleetEpi, vowQuote, honourPrompt, limpLine, fleetStory, fleetSoulActs, shipTraitBits, soulAction, openFounding, resetSoul } from './soul.ts';
import { bannerSvg } from '../art/sigils.ts';
import { fleetPortrait, portraitTag } from './portrait.ts';
import { postureStatus, fleetGambit, sigAction, toggleGambit, betPeek, resetSignature } from './signature.ts';
import { tributeAction, roleKey, paintArt, artPeek, resetSystems } from './systems.ts';
import { ownWorld, foreignWorld, tabOf, setWorldTab, toggleLocks, toggleTrack, intoNext, buildInto, hullPeek, trackPeek, resetWorldCard, type WorldTab } from './worldcard.ts';
import { paintMinis } from '../ui/ship-plinth.ts';
import { ic } from '../art/icons.ts';
import { audio } from '../audio/audio.ts';
import '../art/kit.css';
import '../card.css';

const MOD_COLOR: Record<string, string> = { armor: '#c9c3e6', railgun: '#e4ab4a', deflector: '#9bbbd9', ion: '#86c08f' };
const STANCES: { id: Doctrine['stance']; icon: string; label: string; retreat: number; guard: boolean; tip: string }[] = [
  { id: 'aggressive', icon: ic('attack'), label: 'Attack', retreat: 0.15, guard: false, tip: 'Engages anything hostile; retreats late' },
  { id: 'defensive', icon: ic('hold'), label: 'Hold', retreat: 0.35, guard: true, tip: 'Fights when attacked; guards neighbours' },
  { id: 'evasive', icon: ic('evade'), label: 'Evade', retreat: 0.6, guard: false, tip: 'Avoids fights; retreats early' },
];

/** The fleet card's open verb (kept across fleets: Orders is where you live). */
let fleetTab: 'orders' | 'story' = 'orders';
/** The phone sheet's snap point (a new selection opens at peek). */
let sheetSnap: 'peek' | 'full' = 'peek';
let lastSel = '';
/** Scroll of the open verb, kept across re-renders of the same card and tab. */
let bodyScroll = { key: '', top: 0 };

const isSheet = (g: GameScreen) => g.phone;

export function renderCard(g: GameScreen, el: HTMLElement) {
  const s = g.sel;
  let html = '', kind = '', role = '', tab = '';
  const selKey = s ? `${s.kind}:${s.id}` : '';
  if (selKey !== lastSel) { lastSel = selKey; sheetSnap = 'peek'; hidePeek(); }
  const sheet = isSheet(g);
  if (s && !g.blockingReplay) {
    if (s.kind === 'fleet') {
      const f = g.fleet(s.id);
      if (f) { kind = f.owner === g.you ? 'own-fleet' : 'foe-fleet'; html = f.owner === g.you ? ownFleet(g, f) : foeFleet(g, f); tab = f.owner === g.you ? fleetTab : ''; role = 'fleet'; }
    } else {
      const r = g.st.regions[s.id];
      if (r) {
        const own = r.owner === g.you && g.you !== null;
        kind = own ? 'own-planet' : 'planet';
        html = own ? ownWorld(g, r, sheet, sheetSnap) : foreignWorld(g, r);
        role = roleKey(g, r) ?? 'none';
        tab = own ? tabOf(g, r) : '';
      }
    }
  }
  el.classList.toggle('hidden', !html);
  if (!html) { g.setHtml(el, ''); g.root.classList.remove('card-left'); return; }
  el.dataset.kind = kind;
  el.dataset.role = role;
  el.dataset.tab = tab;
  el.dataset.foe = s?.kind === 'region' ? String(g.st.regions[s.id]?.owner !== g.you) : String(kind === 'foe-fleet');
  if (sheet) el.dataset.snap = sheetSnap; else delete el.dataset.snap;
  el.classList.add('wc');
  // keep the open verb's scroll while the same card re-renders (the body is rebuilt)
  const scrollKey = `${selKey}|${tab}`;
  const oldBody = el.querySelector<HTMLElement>('.wc-body');
  if (oldBody && bodyScroll.key === scrollKey) bodyScroll.top = oldBody.scrollTop;
  else if (bodyScroll.key !== scrollKey) bodyScroll = { key: scrollKey, top: 0 };
  let rebuilt = false;
  g.keepInputs(el, () => { rebuilt = g.setHtml(el, html); });
  if (rebuilt) {
    const nb = el.querySelector<HTMLElement>('.wc-body');
    if (nb && bodyScroll.top) nb.scrollTop = bodyScroll.top;
  }
  paintArt(el);
  paintMinis(el);
  place(g, el);
}

/** Desktop: float above the strip on the side away from the selection. Phone: the CSS bottom sheet. */
function place(g: GameScreen, el: HTMLElement) {
  if (g.phone) { g.root.classList.remove('card-left'); return; }
  const s = g.sel!;
  const site = s.kind === 'region' ? g.st.regions[s.id]?.site : (() => { const f = g.fleet(s.id); return f ? g.lastFleetPos.get(f.id) ?? g.st.regions[f.region].site : undefined; })();
  if (!site) return;
  const p = g.map.toScreen(site);
  const left = p.x > g.map.w * 0.5;
  el.classList.toggle('at-left', left);
  el.classList.toggle('at-right', !left);
  g.root.classList.toggle('card-left', left);
}

// ---------------------------------------------------------------- the fleet card (docs/WORLD-CARD.md §7)
/** A commander's surname: the last capitalised word ("Admiral Theodora Vasquez of the" → "Vasquez"). */
export const lastName = (n: string) => n.split(/\s+/).filter(w => /^[A-Z]/.test(w)).slice(-1)[0] ?? n;
const shortOwner = (g: GameScreen, o: number | null) => shortName(g.pname(o), 1);
/** "Theodora Vasquez" → "Cdr Vasquez" (the face beside it says the rest; the Story verb has the full name). */
const cmdShort = (n: string) => `Cdr ${lastName(n)}`;

function fleetArt(g: GameScreen, f: Fleet, extra = ''): string {
  // the commander's painted miniature with the banner pinned at its foot (DELIGHT #37); pickets fly no banner
  const ban = f.banner ? `<span class="fl-port">${portraitTag(fleetPortrait(g.st, f, g.color(f.owner)), 46)}<span class="fl-pin">${bannerSvg(f.banner.sigil, g.color(f.owner), 26, { rim: f.commander.rank >= 4 ? 'gold' : 'silver', broken: !!f.oathbreaker })}</span></span>`
    : `<span class="picket">${ic('ships')}</span>`;
  const siblings = g.st.fleets.filter(x => x.owner === f.owner && x.region === f.region && x.ships.length);
  const sib = siblings.length > 1 ? `<span class="sib"><button data-a="sib" data-d="-1" aria-label="Previous fleet here">${ic('caret')}</button><small>${siblings.indexOf(f) + 1}/${siblings.length}</small><button data-a="sib" data-d="1" aria-label="Next fleet here">${ic('caret')}</button></span>` : '';
  const epi = fleetEpi(g, f);
  return `<div class="wc-art fl-art"><span class="bn">${ban}</span><div class="fl-id"><div class="wc-name" style="--pc:${esc(g.color(f.owner))}"><span>${esc(g.pendingName(f))}</span>${chevrons(f.commander.rank)}</div>${epi ? `<div class="wc-epi">${epi}</div>` : ''}${f.banner ? `<div class="fl-cmd">${esc(cmdShort(f.commander.name))}</div>` : ''}</div>${extra}${sib}<button class="x" data-a="close" aria-label="Close">${ic('close')}</button></div>`;
}
function fleetStats(g: GameScreen, f: Fleet, own: boolean): string {
  const st = g.st;
  const power = fleetPower(st, f);
  const hp = f.ships.reduce((a, s) => a + s.hp, 0), max = f.ships.reduce((a, s) => a + s.maxHp, 0) || 1;
  const pct = Math.round((hp / max) * 100);
  return `<div class="fl-stats"><span${tip('Power')}>${ic('attack')}<b>${power}</b></span>${own ? `<span class="${pct < 50 ? 'bad' : ''}"${tip('Hull')}>${ic('hull')}<b>${pct}%</b></span><span${tip('Speed')}>${ic('speed')}<b>${fleetSpeed(st, f)}</b></span>` : ''}<small>${f.ships.length}/${st.rules.maxShipsPerFleet} ships</small></div>`;
}
/** The route ribbon: where it is going and what it means to do there, or how to give it an order. */
function routeRibbon(g: GameScreen, f: Fleet): string {
  const st = g.st;
  if (f.limping) return limpLine(g, f);
  const planned = (g.live ? g.queue : g.plan.orders).find(o => !!o && (o.type === 'move' || o.type === 'seize') && o.fleet === f.id) as Extract<Order, { type: 'move' | 'seize' }> | undefined;
  const seizeTo = planned?.type === 'seize' ? planned.target : f.route?.seize ?? null;
  const moveTo = planned?.type === 'move' ? planned.path[planned.path.length - 1] : f.route?.path.length ? f.route.path[f.route.path.length - 1] : null;
  const dest = seizeTo ?? moveTo;
  if (dest === null || dest === undefined) {
    return g.canPlan && g.isIdle(f) ? `<div class="route idle">${ic('move')}<span>Idle: drag it to a region</span></div>` : '';
  }
  const steps = planned?.type === 'move' ? planned.path.length : f.route?.path.length ?? 1;
  const speed = Math.max(1, fleetSpeed(st, f));
  const eta = g.live ? fmtDur((etaTicks(st, f.id) ?? 0) * tickMs(st)) : steps <= speed ? 'arrives this turn' : `${Math.ceil(steps / speed)} turns`;
  let odds = '';
  if (seizeTo !== null && seizeTo !== undefined) {
    const o = g.odds([f.id], seizeTo, g.plan.orders.findIndex(x => x === planned));
    if (o) odds = ` · ${Math.round(o.p * 100)}%`;
  }
  const halting = !g.live && g.plan.free.some(x => x.type === 'halt' && x.fleet === f.id);
  const halt = !g.canPlan || planned ? '' : halting ? `<span class="warn"${tip('Stops where it is when the turn resolves')}>${ic('halt')} Halting</span>` : `<button class="mini" data-a="halt">${ic('halt')} Halt</button>`;
  return `<div class="route${seizeTo !== null && seizeTo !== undefined ? ' seize' : ''}">${ic(seizeTo !== null && seizeTo !== undefined ? 'seize' : 'move')}<span><b>${seizeTo !== null && seizeTo !== undefined ? 'Seize' : 'To'} ${esc(st.regions[dest]?.name ?? '?')}</b> · ${eta}${odds}</span>${halt}</div>`;
}
function fleetStatus(g: GameScreen, f: Fleet): string {
  const st = g.st, out: string[] = [];
  const war = (st.engagements ?? []).find(e => e.region === f.region);
  if (f.siege === f.region) out.push(`<span class="war">${ic('comet')} Siege${war ? ` · ${war.rounds}` : ''}</span>`);
  else if (war) out.push(`<span class="war">${ic('battle')} In battle</span>`);
  if (f.fatigued) out.push(`<span class="warn">${ic('warning')} Fatigued</span>`);
  out.push(...postureStatus(g, f));
  if (f.fortified) out.push(`<span>${ic('fortify')} Dug in</span>`);
  if (st.rules.empire?.enabled !== false && f.owner === g.you && f.ships.length && ((f.oos ?? 0) > 0 || !supplied(st, f.owner).has(f.region))) out.push(`<span class="warn">${ic('warning')} No supply</span>`);
  return out.length ? `<div class="fl-status">${out.join('')}</div>` : '';
}
function fan(g: GameScreen, f: Fleet, own: boolean): string {
  const R = g.st.rules;
  const bpState = own ? g.projectedState(g.nextSlot() ?? 0) : g.st;
  return `<div class="fan" data-fleet="${f.id}">${f.ships.map(s => {
    const def = R.ships[s.cls];
    const pct = Math.max(0, Math.min(1, s.hp / s.maxHp));
    const bp = own ? blueprintFor(bpState, f.owner, s.cls) : null;
    const old = bp && s.mod && bp !== s.mod;
    const sys = !s.sys.engines || !s.sys.weapons || !s.sys.shields;
    const tr = shipTraitBits(s.traits);
    const up = own && g.lifted.has(s.id);
    return `<button class="sc${up ? ' up' : ''}" ${own ? `data-ship="${s.id}"` : ''} aria-label="${esc(`${s.name}, ${def?.name ?? s.cls}, hull ${Math.round(pct * 100)}%`)}"${own ? ` aria-pressed="${up}"` : ''}${tip(`${s.name} · ${def?.name ?? s.cls}${s.title ? ` ${s.title}` : ''}${tr.tip}`)}>${tr.icons}<canvas data-mini data-bare data-cls="${esc(s.cls)}" data-owner="${f.owner}" data-team="${esc(g.color(f.owner))}" aria-hidden="true"></canvas><i class="hb"><i class="${pct < 0.4 ? 'low' : ''}" style="width:${(pct * 100).toFixed(0)}%"></i></i>${s.mod ? `<i class="md ${old ? 'old' : ''}" style="background:${MOD_COLOR[s.mod] ?? '#9aa1ae'}"></i>` : ''}${sys ? '<i class="sx">!</i>' : ''}</button>`;
  }).join('')}</div>`;
}
const ib = (a: string, icon: string, label: string, why: string | null, extra = '', tipText = '') =>
  `<button class="ib" data-a="${a}" ${extra}${why ? ` aria-disabled="true"${tip(`⊘ ${shortWhy(why)}`)}` : tipText ? tip(tipText) : ''}>${ic(icon)}<span>${label}</span>${why ? `<small>${esc(shortWhy(why))}</small>` : ''}</button>`;
function ordersTab(g: GameScreen, f: Fleet): string {
  const st = g.st;
  if (!g.canPlan) return `<p class="foot-note">${ic('help')} ${esc(g.planBlock() ?? 'Watching')}</p>`;
  const here = st.regions[f.region];
  const why = (o: Order) => g.orderWhy(o);
  const bpState = g.projectedState(g.nextSlot() ?? 0);
  const nLift = [...g.lifted].filter(id => f.ships.some(s => s.id === id)).length;
  let acts = ib('fortify', 'fortify', 'Fortify', f.fortified ? 'already dug in' : why({ type: 'fortify', fleet: f.id }), '', 'Dig in: hits harder here');
  acts += ib('scan', 'scan', 'Scan', why({ type: 'scan', target: f.region }), '', 'Reveal this area');
  if (f.ships.length > 1) acts += ib('split', 'split', nLift ? `Split ${nLift}` : 'Split ½', g.fleetUses(f.id) > 0 ? 'has orders' : splitIds(g, f) ? null : 'its other ships are already splitting off', '', 'Free: forms a new fleet');
  const needRefit = f.ships.some(s => s.mod !== blueprintFor(bpState, g.you!, s.cls) || s.hp < s.maxHp);
  acts += ib('refit', 'refit', 'Refit', here.owner === g.you && (here.buildings.shipyard ?? 0) > 0 ? (needRefit ? why({ type: 'refit', fleet: f.id }) : 'up to date and repaired') : 'needs one of your yards', '', 'Repair and upgrade');
  if (here.relic === 'unclaimed') acts += ib('excavate', 'excavate', 'Excavate', here.owner === g.you ? why({ type: 'excavate', fleet: f.id }) : 'you must own the region', '', 'Dig up the relic');
  acts += fleetSoulActs(g, f, (a, icon, label, w, extra, t) => a === 'vowpick' ? '' : ib(a, a === 'retire' ? 'retire' : 'vow', label, w, extra, t));
  const d = g.doctrineOf(f);
  const temper = `<div class="temper" role="group" aria-label="Temper: how it fights">${STANCES.map(x => `<button class="${d.stance === x.id ? 'on' : ''}" data-a="stance" data-s="${x.id}" aria-pressed="${d.stance === x.id}"${tip(x.tip)}>${x.icon}<span>${x.label}</span></button>`).join('')}</div>`;
  return `<div class="verbs">${acts}</div><h4 class="sub">Temper</h4>${temper}`;
}
function ownFleet(g: GameScreen, f: Fleet): string {
  const tabs = `<nav class="wc-tabs n2" role="tablist">${([['orders', 'move', 'Orders'], ['story', 'chronicle', 'Story']] as const).map(([k, icon, l]) => `<button role="tab" class="${fleetTab === k ? 'on' : ''}" data-a="ftab" data-t="${k}" aria-selected="${fleetTab === k}">${ic(icon)}<span>${l}</span></button>`).join('')}</nav>`;
  const body = fleetTab === 'story' ? `<div class="story">${fleetStory(g, f)}</div>` : ordersTab(g, f);
  return `${fleetArt(g, f, vowQuote(g, f))}<div class="wc-face">${fleetStats(g, f, true)}${honourPrompt(g, f)}${routeRibbon(g, f)}${fleetStatus(g, f)}${fan(g, f, true)}</div>${tabs}<div class="wc-body" data-tab="${fleetTab}">${body}</div>${fleetGambit(g, f)}`;
}
/** Your fleets that could attack this one where it stands, best odds first (at most two). */
function attackOptions(g: GameScreen, f: Fleet): Intent[] {
  if (g.you === null || !g.canPlan) return [];
  const out: Intent[] = [];
  for (const m of g.st.fleets) {
    if (m.owner !== g.you || !m.ships.length) continue;
    const it = intentFor(g, { fleet: m.id }, f.region, null, null);
    if (it?.ok && (it.verb === 'seize' || it.verb === 'move' || it.verb === 'join') && it.odds !== undefined) out.push(it);
  }
  return out.sort((a, b) => (b.odds ?? 0) - (a.odds ?? 0)).slice(0, 2);
}
function foeFleet(g: GameScreen, f: Fleet): string {
  const st = g.st;
  const counts = new Map<string, number>();
  for (const s of f.ships) counts.set(s.cls, (counts.get(s.cls) ?? 0) + 1);
  const ships = `<div class="fan foe">${[...counts].map(([cls, n]) => `<span class="cls"${tip(st.rules.ships[cls]?.name ?? cls)}><canvas data-mini data-bare data-cls="${esc(cls)}" data-owner="${f.owner}" data-team="${esc(g.color(f.owner))}" aria-hidden="true"></canvas><b>×${n}</b></span>`).join('')}</div>`;
  const owner = `<span class="vow owner" style="--pc:${esc(g.color(f.owner))}"><i class="dot"></i>${esc(f.owner < 0 ? (f.owner === -1 ? 'the Warden' : 'Raiders') : shortOwner(g, f.owner))}</span>`;
  const atk = attackOptions(g, f).map((it, i) => {
    const m = g.fleet((it.order as { fleet?: number } | undefined)?.fleet ?? it.join?.fleet ?? -1);
    const pct = Math.round((it.odds ?? 0) * 100);
    const tone = pct >= 65 ? 'good' : pct >= 40 ? 'warn' : 'bad';
    return `<button class="odds ${tone}" data-a="attackwith" data-with="${m?.id ?? -1}">${ic('attack')}<span class="nm">${i ? 'with' : 'Attack with'} ${esc(m ? m.name.replace(/^The /, '') : 'fleet')}<small>${ic('attack')}${m ? fleetPower(st, m) : 0} vs ${fleetPower(st, f)}</small></span><b class="p">${pct}%</b><span class="bar"><i style="width:${pct}%"></i></span></button>`;
  }).join('');
  return `${fleetArt(g, f, owner)}<div class="wc-face">${fleetStats(g, f, false)}${fleetStatus(g, f)}${ships}</div>${atk ? `<div class="wc-body foreign">${atk}</div>` : ''}`;
}

/** Your fleets that could seize this region right now, best odds first. */
export function seizeOptions(g: GameScreen, r: Region): Intent[] {
  if (g.you === null || !g.canPlan) return [];
  const out: Intent[] = [];
  for (const f of g.st.fleets) {
    if (f.owner !== g.you || !f.ships.length) continue;
    const it = intentFor(g, { fleet: f.id }, r.id, null, 'seize');
    if (it?.ok && (it.verb === 'seize' || it.verb === 'join')) out.push(it);
  }
  return out.sort((a, b) => (b.odds ?? 0) - (a.odds ?? 0)).slice(0, 2);
}

// ---------------------------------------------------------------- peeks: hover (mouse) or long-press (touch)
let peekEl: HTMLElement | null = null;
let peekFor: HTMLElement | null = null;
function peekHtml(g: GameScreen, key: string): string | null {
  const k = key.split(':')[0];
  if (k === 'body' || k === 'star') return artPeek(g, key);
  if (k === 'hull') return hullPeek(g, key);
  if (k === 'trk') return trackPeek(g, key);
  return betPeek(g, key);
}
function showPeek(g: GameScreen, el: HTMLElement) {
  const html = peekHtml(g, el.dataset.peek ?? '');
  if (!html) return;
  if (!peekEl || !peekEl.isConnected) { peekEl = document.createElement('div'); peekEl.className = 'cardpeek k-slip'; peekEl.setAttribute('role', 'tooltip'); document.body.appendChild(peekEl); }
  peekFor = el;
  peekEl.innerHTML = html;
  el.classList.add('peeking');
  const card = g.hud.h.card.getBoundingClientRect(), r = el.getBoundingClientRect();
  const w = peekEl.offsetWidth, h = peekEl.offsetHeight, W = window.innerWidth, H = window.innerHeight;
  let x: number, y: number;
  if (g.phone) { x = Math.max(8, Math.min(W - w - 8, r.left + r.width / 2 - w / 2)); y = Math.max(8, card.top - h - 10); }
  else {
    // beside the card, on the side away from it, level with the thing peeked at
    x = card.left - w - 12 >= 8 ? card.left - w - 12 : card.right + 12;
    y = Math.max(8, Math.min(H - h - 8, r.top + r.height / 2 - h / 2));
  }
  peekEl.style.left = `${Math.round(x)}px`; peekEl.style.top = `${Math.round(y)}px`;
  peekEl.classList.add('on');
}
export function hidePeek() {
  peekFor?.classList.remove('peeking');
  peekFor = null;
  peekEl?.classList.remove('on');
}

// ---------------------------------------------------------------- events (bound once)
/** Wire the card's handlers once; returns the cleanup for what lives outside the card (the HUD's destroy calls it). */
export function bindCard(g: GameScreen, el: HTMLElement): () => void {
  el.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('[data-a]');
    if (!b || !el.contains(b)) return;
    if (b.dataset.a === 'peek') { if (peekFor === b) hidePeek(); else showPeek(g, b); return; }
    hidePeek();
    if (b.getAttribute('aria-disabled') === 'true') {
      audio.ui('error'); b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope');
      // say why (on a touch screen the reason in the tip was only a long-press away)
      if (b.dataset.tip) toast(b.dataset.tip);
      return;
    }
    // Fate makes its own sounds (arm click, coin on the spend)
    if (b.dataset.a !== 'fate') audio.ui('click');
    cardAction(g, b.dataset.a!, b.dataset, e.shiftKey);
  });
  el.addEventListener('change', e => {
    const t = e.target as HTMLInputElement;
    if (!t.matches('[data-rename]') || g.sel?.kind !== 'fleet' || !g.canPlan) return;
    const v = t.value.trim().slice(0, 40);
    if (v && v !== g.fleet(g.sel.id)?.name) g.pushFree({ type: 'rename', fleet: g.sel.id, name: v });
    g.renderAll();
  });
  el.addEventListener('keydown', e => {
    // Enter / Esc leave the name field: re-renders put the focus back into it, so the board's shortcuts stayed dead
    const t = e.target as HTMLElement;
    // the card keeps only what is its own: typing in a field, Space / Enter on a focused control, and Esc.
    // Every other key (F, M, S, Tab, the lenses...) reaches the board's shortcuts even with a card button focused.
    const typingHere = t.matches('input, textarea, select, [contenteditable]');
    if (typingHere || e.key === 'Escape' || ((e.key === ' ' || e.key === 'Enter') && t.matches('button, [role=button], a'))) e.stopPropagation();
    if ((e.key === 'Enter' || e.key === 'Escape') && t.matches('input')) (t as HTMLInputElement).blur();
    else if (e.key === 'Escape') { hidePeek(); g.deselect(); }
  });
  // peeks: hover with a mouse; a long press (350ms) on touch, and that press does not click
  el.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse') return;
    const p = (e.target as HTMLElement).closest<HTMLElement>('[data-peek]');
    if (p && !p.dataset.tip && p !== peekFor) showPeek(g, p);
    else if (!p && peekFor && peekFor.dataset.a !== 'peek') hidePeek();
  });
  el.addEventListener('pointerleave', () => { if (peekFor && peekFor.dataset.a !== 'peek') hidePeek(); });
  let lp = 0, held = 0, pressed = false;
  el.addEventListener('pointerdown', e => {
    pressed = false;
    if (e.pointerType === 'mouse') return;
    const p = (e.target as HTMLElement).closest<HTMLElement>('[data-peek]');
    clearTimeout(lp);
    if (p && !p.dataset.tip && p.dataset.a !== 'peek') lp = window.setTimeout(() => { showPeek(g, p); pressed = true; }, 350);
  });
  const clear = () => clearTimeout(lp);
  // the click comes with the release, however long the finger stayed: a press that peeked must not also act
  el.addEventListener('pointerup', () => { clear(); if (pressed) { pressed = false; held = performance.now() + 400; } });
  el.addEventListener('pointercancel', clear);
  el.addEventListener('pointermove', e => { if (e.pointerType !== 'mouse' && Math.abs(e.movementX) + Math.abs(e.movementY) > 6) clear(); });
  el.addEventListener('click', e => { if (performance.now() < held) { e.stopPropagation(); e.preventDefault(); held = 0; } }, true);
  const outside = (e: PointerEvent) => { if (peekFor && !el.contains(e.target as Node)) hidePeek(); };
  document.addEventListener('pointerdown', outside, true);
  // ship fan: tap lifts a chip; dragging chips out onto the map splits them off
  el.addEventListener('pointerdown', e => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-ship]');
    if (!chip || g.sel?.kind !== 'fleet' || !g.canPlan) return;
    const fid = g.sel.id, sid = Number(chip.dataset.ship);
    const x0 = e.clientX, y0 = e.clientY, pid = e.pointerId;
    const th = e.pointerType === 'mouse' ? 6 : 10;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid || started) return;
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > th) {
        started = true;
        const ids = g.lifted.has(sid) ? [...g.lifted] : [...g.lifted, sid];
        g.gest.startShipDrag(fid, ids, ev);
        cleanup();
      }
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      cleanup();
      if (!started) { if (g.lifted.has(sid)) g.lifted.delete(sid); else g.lifted.add(sid); g.renderAll(); }
    };
    const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    e.preventDefault();
  });
  // phone: the sheet's two snap points. Drag the face up: full; down from full: peek; down from peek: close.
  let sw: { y: number; id: number; moved: boolean } | null = null;
  el.addEventListener('pointerdown', e => {
    const t = e.target as HTMLElement;
    // the diorama's bodies are buttons (tap: a peek) covering much of the header: a swipe may start on them too
    if (!isSheet(g) || t.closest('button:not([data-a=peek]), input, .wc-body, [data-ship]')) return;
    if (!t.closest('.wc-art, .wc-face, .wc-tabs') && !t.matches('.card')) return;
    sw = { y: e.clientY, id: e.pointerId, moved: false };
  });
  el.addEventListener('pointermove', e => {
    if (!sw || e.pointerId !== sw.id) return;
    const d = e.clientY - sw.y;
    if (Math.abs(d) > 6) sw.moved = true;
    el.style.transform = d > 0 ? `translateY(${d}px)` : `translateY(${Math.max(-40, d / 3)}px)`;
  });
  const swEnd = (e: PointerEvent) => {
    if (!sw || e.pointerId !== sw.id) return;
    const d = e.clientY - sw.y, moved = sw.moved; sw = null; el.style.transform = '';
    // a swipe that began on a body is not a tap on it
    if (moved) held = performance.now() + 400;
    if (d < -40 && sheetSnap === 'peek') { sheetSnap = 'full'; audio.ui('click'); g.renderAll(); }
    else if (d > 70) { if (sheetSnap === 'full') { sheetSnap = 'peek'; g.renderAll(); } else g.deselect(); }
  };
  el.addEventListener('pointerup', swEnd);
  el.addEventListener('pointercancel', swEnd);
  // (left on the document, it kept every finished game alive: its card, its screen, its state)
  return () => {
    document.removeEventListener('pointerdown', outside, true);
    // the module-level card state belongs to this game: a peek left on <body>, the sheet's snap, the per-world
    // tabs and choices, open Gambits, refused terms (all keyed by region ids the next game reuses)
    hidePeek(); peekEl?.remove(); peekEl = null;
    lastSel = ''; sheetSnap = 'peek'; bodyScroll = { key: '', top: 0 };
    resetWorldCard(); resetSignature(); resetSystems(); resetSoul();
  };
}

/**
 * The ships a Split takes off this fleet: the lifted ones, else half. WEGO splits wait for the turn, so ships already
 * in a planned split are left out (splitting the same half twice failed at resolution); null when nothing can go.
 */
export function splitIds(g: GameScreen, f: Fleet): number[] | null {
  const gone = new Set(g.live ? [] : g.plan.free.flatMap(x => (x.type === 'split' && x.fleet === f.id ? x.ships : [])));
  const left = f.ships.filter(s => !gone.has(s.id));
  if (left.length < 2) return null;
  const lifted = left.filter(s => g.lifted.has(s.id)).map(s => s.id);
  const ids = lifted.length && lifted.length < left.length ? lifted : left.slice(Math.ceil(left.length / 2)).map(s => s.id);
  return ids.length ? ids : null;
}

/** Open a world card on a verb (the context ring's Build / Develop). */
export function openWorldTab(g: GameScreen, rid: number, t: WorldTab) {
  setWorldTab(rid, t);
  if (g.phone) sheetSnap = 'full';
  g.select({ kind: 'region', id: rid });
  g.renderAll();
}

/** Card / ring / keyboard actions on the current selection. */
export function cardAction(g: GameScreen, a: string, data: DOMStringMap, shift = false) {
  const sel = g.sel;
  if (a === 'close') { g.deselect(); return; }
  if (!sel) return;
  // ---- the card's own state: verbs, the Gambit, expanding lines, the sheet
  if (a === 'tab' && sel.kind === 'region') { setWorldTab(sel.id, data.t as WorldTab); if (g.phone) sheetSnap = 'full'; g.renderAll(); return; }
  if (a === 'ftab') { fleetTab = data.t === 'story' ? 'story' : 'orders'; if (g.phone) sheetSnap = 'full'; g.renderAll(); return; }
  if (a === 'gambit') { toggleGambit(data.key ?? ''); if (g.phone && sheetSnap === 'peek') sheetSnap = 'full'; g.renderAll(); return; }
  if (a === 'lockx' && sel.kind === 'region') { toggleLocks(sel.id); g.renderAll(); return; }
  if (a === 'trkx' && sel.kind === 'region') { toggleTrack(sel.id, data.track ?? ''); g.renderAll(); return; }
  if (a === 'intonext' && sel.kind === 'region') { intoNext(g, sel.id); g.renderAll(); return; }
  if (a === 'research') { g.openModal('empire', 'research'); return; }
  if (a === 'record' && soulAction(g, a, data)) return;
  if (g.canPlan && (sigAction(g, a, data) || soulAction(g, a, data) || tributeAction(g, a))) return;
  if (a === 'fleet') { g.select({ kind: 'fleet', id: Number(data.id) }); return; }
  if (a === 'sib' && sel.kind === 'fleet') {
    const f = g.fleet(sel.id); if (!f) return;
    const sibs = g.st.fleets.filter(x => x.owner === f.owner && x.region === f.region && x.ships.length);
    const i = (sibs.indexOf(f) + Number(data.d) + sibs.length) % sibs.length;
    g.select({ kind: 'fleet', id: sibs[i].id });
    return;
  }
  if (!g.canPlan) return;
  if (sel.kind === 'fleet') {
    const f = g.fleet(sel.id);
    if (!f) return;
    if (f.owner !== g.you) {
      if (a === 'attackwith') { const it = intentFor(g, { fleet: Number(data.with) }, f.region, null, null); if (it?.ok) commitIntent(g, it); }
      return;
    }
    switch (a) {
      case 'fortify': g.addOrder({ type: 'fortify', fleet: f.id }); break;
      case 'scan': g.addOrder({ type: 'scan', target: f.region }); break;
      case 'feint': g.addOrder({ type: 'feint', target: f.region }); break;
      case 'influence': g.addOrder({ type: 'influence', target: f.region }); break;
      case 'conceal': g.addOrder({ type: 'conceal' }); break;
      case 'excavate': g.addOrder({ type: 'excavate', fleet: f.id }); break;
      case 'refit': g.addOrder({ type: 'refit', fleet: f.id }); break;
      case 'halt': if (g.live) g.src.liveHalt?.(f.id); else { g.pushFree({ type: 'halt', fleet: f.id }); g.renderAll(); } break;
      case 'split': {
        const ids = splitIds(g, f);
        if (!ids) return;
        g.pushFree({ type: 'split', fleet: f.id, ships: ids });
        g.lifted.clear();
        g.renderAll();
        break;
      }
      case 'stance': {
        const x = STANCES.find(s => s.id === data.s);
        if (!x) return;
        const d = g.doctrineOf(f);
        g.pushFree({ type: 'doctrine', fleet: f.id, doctrine: { ...d, stance: x.id, retreatAt: x.retreat, guard: x.guard } });
        g.renderAll();
        break;
      }
    }
    return;
  }
  const r = g.st.regions[sel.id];
  switch (a) {
    case 'build': {
      const into = buildInto(g, r);
      const cls = data.cls!;
      if (into !== 'new') { g.addOrder({ type: 'build', region: r.id, cls, fleet: into }); break; }
      // a scout alone forms a picket (no banner); anything else raises a banner: the founding ritual (Shift: quick)
      if (cls === 'scout' || g.st.rules.soul?.enabled === false) { g.addOrder({ type: 'build', region: r.id, cls, fleet: null }); break; }
      const block = g.orderWhy({ type: 'build', region: r.id, cls, fleet: null });
      if (block && !/banner/i.test(block)) { g.addOrder({ type: 'build', region: r.id, cls, fleet: null }); break; }
      openFounding(g, { region: r.id, cls }, shift);
      break;
    }
    case 'develop': g.addOrder({ type: 'develop', region: r.id, project: data.proj! }); break;
    // an Improve track: the concrete building the button showed (the picker ran against the same projected state)
    case 'track': {
      if (data.proj) { g.addOrder({ type: 'develop', region: r.id, project: data.proj }); break; }
      if (data.track === 'yard') g.addOrder({ type: 'develop', region: r.id, project: 'shipyard' });
      break;
    }
    case 'unqueue': { const i = Number(data.slot); if (i >= 0) g.removeOrder(i); break; }
    case 'influence': g.addOrder({ type: 'influence', target: r.id }); break;
    case 'scan': g.addOrder({ type: 'scan', target: r.id }); break;
    case 'feint': g.addOrder({ type: 'feint', target: r.id }); break;
    case 'pact': if (r.owner !== null && r.owner >= 0) g.addOrder({ type: 'pact', with: r.owner }); break;
    case 'seizewith': {
      const it = intentFor(g, { fleet: Number(data.with) }, r.id, null, 'seize');
      if (it?.ok) commitIntent(g, it);
      break;
    }
  }
}

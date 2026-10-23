// Signature mechanics on the HUD (docs/SIGNATURE.md): fleet postures (a secret bet each turn), world postures on
// your systems, and Fate tokens. Pit of success: invalid choices are disabled with the reason, the default (Steady)
// costs nothing, Fate asks once more before it is spent, and a Seize dropped by drag offers a Charge on the spot.
// Postures are introduced from turn 3 (progressive disclosure); Fate shows when it matters.
import type { GameScreen } from '../game.ts';
import type { FateUse, Fleet, FreeAction, Order, Posture, Region, WorldPosture } from '../../../shared/sim/types.ts';
import { POSTURES, WORLD_POSTURES, FATE_USES } from '../../../shared/config/content.ts';
import { sigOn, posturesOn, worldPosturesOn, fateOn, postureBlock, wpostureBlock, fateBlock, fateLeft, isDugIn, isExposed, fateOf, POSTURE_IDS, WORLD_POSTURE_IDS, SG } from '../../../shared/sim/signature.ts';
import { contestOn, systemStatus } from '../../../shared/sim/contest.ts';
import { esc, toast, uiScale } from '../ui/dom.ts';
import { tip, shortWhy, safeInsets } from './util.ts';
import { setFree, dropFree } from './soul.ts';
import { ic, icFor } from '../art/icons.ts';
import { audio } from '../audio/audio.ts';

/** Turn from which the posture selector appears (progressive disclosure: learn to move first). */
export const POSTURE_FROM_TURN = 3;
const P = (p: string) => ic(icFor('posture', p, POSTURES[p]?.icon));
const W = (p: string) => ic(icFor('wposture', p, WORLD_POSTURES[p]?.icon));
const F = (u: string) => ic(icFor('fate', u, FATE_USES[u]?.icon));

// ------------------------------------------------------------------ what's planned
const myOrders = (g: GameScreen): (Order | null)[] => (g.live ? g.queue : g.plan.orders);
export function pendingPosture(g: GameScreen, fid: number): Posture | null {
  const fa = [...g.myFree()].reverse().find(x => x.type === 'posture' && x.fleet === fid);
  return fa && fa.type === 'posture' ? fa.posture : null;
}
/** The posture a fleet of yours will take this turn: the planned one, else the one in force, else Steady. */
export function postureNow(g: GameScreen, f: Fleet): Posture {
  return pendingPosture(g, f.id) ?? f.posture ?? 'steady';
}
export function pendingWPosture(g: GameScreen, rid: number): WorldPosture | null {
  const fa = [...g.myFree()].reverse().find(x => x.type === 'wposture' && x.region === rid);
  return fa && fa.type === 'wposture' ? fa.posture : null;
}
export function pendingFate(g: GameScreen): Extract<FreeAction, { type: 'fate' }>[] {
  return g.myFree().filter((x): x is Extract<FreeAction, { type: 'fate' }> => x.type === 'fate');
}
/** Fate tokens left after what your plan already spends. */
export function fateAvail(g: GameScreen): number {
  if (g.you === null || !fateOn(g.st)) return 0;
  return fateLeft(g.st, g.you) - (g.live ? 0 : pendingFate(g).length);
}
const seizesThisTurn = (g: GameScreen, f: Fleet) =>
  myOrders(g).some(o => !!o && o.type === 'seize' && (o.fleet === f.id || (o.also ?? []).includes(f.id))) || (!!f.route && f.route.seize !== null) || (f.siege !== null && f.siege !== undefined && f.siege === f.region);
const movesThisTurn = (g: GameScreen, f: Fleet) => myOrders(g).some(o => !!o && o.type === 'move' && o.fleet === f.id) || !!f.route?.path.length;

/** Why this fleet can't take posture `p` (the rules, plus what your orders imply), or null. */
export function postureWhy(g: GameScreen, f: Fleet, p: Posture): string | null {
  if (g.you === null) return 'spectating';
  if (!g.canPlan) return g.planBlock() ?? 'not now';
  const b = postureBlock(g.st, g.you, f, p);
  if (b) return b;
  if (p === 'charge' && !seizesThisTurn(g, f)) return 'a Charge needs a Seize';
  if (p === 'ambush' && (seizesThisTurn(g, f) || movesThisTurn(g, f))) return 'an Ambush must lie still';
  if (p === 'guarded' && seizesThisTurn(g, f)) return 'a Guarded fleet cannot seize';
  return null;
}
/** Why `use` can't be spent on this fleet / region now, or null (counts Fate already in the plan). */
export function fateWhy(g: GameScreen, use: FateUse, fleet?: number, region?: number): string | null {
  if (g.you === null) return 'spectating';
  if (!g.canPlan) return g.planBlock() ?? 'not now';
  const b = fateBlock(g.st, g.you, use, fleet, region);
  if (b) return b;
  if (!g.live && pendingFate(g).length >= SG(g.st).fatePerTurn) return `${SG(g.st).fatePerTurn} Fate per turn`;
  if (fateAvail(g) <= 0) return 'no Fate left';
  return null;
}

// ------------------------------------------------------------------ the Gambit (docs/WORLD-CARD.md §4.5, §7)
// One compact control per card for every secret bet and Fate on it. A world shows it only when something threatens
// it or a Surge would pay; a fleet's is always possible from turn 3, and its chip reads the plan ("Seizing Vela:
// Charge?"). Tapped open: the bet cards (Fate ones gold) and the chosen bet's three lines: the bet, right, wrong.
const open = new Set<string>();
/** A new game: no Gambit starts open, nothing armed, no Charge offer left over from the last one. */
export function resetSignature() { open.clear(); armed = null; offerEl?.remove(); offerEl = null; }
export const gambitOpen = (key: string) => open.has(key);
export function toggleGambit(key: string) { if (open.has(key)) open.delete(key); else open.add(key); }

const betLines = (d: { bet: string; right: string; wrong: string }) =>
  `<div class="betline"><span class="k">Bet</span><span>${esc(d.bet)}</span><span class="k ok">${ic('check')}</span><span class="ok">${esc(d.right)}</span><span class="k no">${ic('close')}</span><span class="no">${esc(d.wrong)}</span></div>`;
const noBet = (t = 'No bet: nothing gained, nothing risked. Tap one: it stays secret, this turn only.') => `<div class="betline none"><span>${esc(t)}</span></div>`;
const coinRow = (n: number, max: number) => `<span class="coins" role="img" aria-label="Fate: ${n} of ${max} left">${Array.from({ length: Math.max(max, n) }, (_, i) => `<i class="${i < n ? 'on' : ''}">${ic('fate')}</i>`).join('')}</span>`;
/** A bet card: a posture / world posture (free) or a Fate use (gold, two taps). */
function betCard(o: { a: string; data: string; icon: string; name: string; sub: string; why: string | null; on?: boolean; fate?: boolean; armed?: boolean; peek?: string }): string {
  return `<button class="bet${o.on ? ' on' : ''}${o.fate ? ' fate' : ''}${o.armed ? ' armed' : ''}" data-a="${o.a}" ${o.data}${o.peek ? ` data-peek="${o.peek}"` : ''}${o.why ? ` aria-disabled="true"${tip(`⊘ ${shortWhy(o.why)}`)}` : ''}>${o.icon}<b>${esc(o.armed ? 'Spend?' : o.name)}</b><small>${esc(o.why ? `⊘ ${shortWhy(o.why)}` : o.sub)}</small></button>`;
}
const isArmed = (key: string) => !!armed && armed.key === key && performance.now() - armed.at < 4000;
function fateCard(g: GameScreen, use: FateUse, why: string | null, target: string, pending: boolean): string {
  const d = FATE_USES[use];
  const key = `${use}:${target}`;
  const label = use === 'laststand' ? 'Stand' : use === 'hyperjump' ? 'Jump' : use === 'twist' ? 'Twist' : use === 'rally' ? 'Rally' : 'Surge';
  if (pending) return betCard({ a: 'unfate', data: '', icon: F(use), name: label, sub: g.live ? 'at the tick' : 'at seal ↶', why: null, on: true, fate: true, peek: `fate:${use}` });
  return betCard({ a: 'fate', data: `data-use="${use}" data-key="${esc(key)}"`, icon: F(use), name: label, sub: '1 Fate', why, fate: true, armed: isArmed(key), peek: `fate:${use}` }).replace('<button', `<button aria-label="${esc(d?.name ?? label)}"`);
}
function chip(key: string, icon: string, text: string, set: boolean, g: GameScreen): string {
  const isOpen = open.has(key);
  return `<button class="gchip${set ? ' set' : ''}${isOpen ? ' open' : ''}" data-a="gambit" data-key="${key}" aria-expanded="${isOpen}">${icon}<b>Gambit</b><span>${esc(text)}</span>${fateOn(g.st) ? coinRow(fateAvail(g), SG(g.st).fateStart) : ''}</button>`;
}

/** Hostile warships at r or one jump away (yours excluded, pact partners too), strongest first. */
function threatsAt(g: GameScreen, r: Region): { here: Fleet[]; near: Fleet[] } {
  const st = g.st, you = g.you;
  const hostile = (f: Fleet) => f.owner !== you && f.ships.some(x => x.cls !== 'scout') && (f.owner < 0 || !st.pacts.some(x => x.until >= st.turn && ((x.a === you && x.b === f.owner) || (x.b === you && x.a === f.owner))));
  const fl = st.fleets.filter(f => f.ships.length && hostile(f));
  return { here: fl.filter(f => f.region === r.id), near: fl.filter(f => r.neighbors.includes(f.region) || ((r as Region & { links?: number[] }).links ?? []).includes(f.region)) };
}
const ownerWord = (g: GameScreen, o: number) => (o === -1 ? 'Warden' : o < 0 ? 'Raider' : g.pname(o).split(' ').slice(-1)[0]);

/** Why the Gambit shows on this world now (its chip text), or null: it is hidden. */
export function gambitRelevant(g: GameScreen, r: Region): string | null {
  const st = g.st;
  if (!sigOn(st) || g.you === null || r.owner !== g.you || !g.canPlan || r.kind === 'void' || (r.kind as string) === 'lane') return null;
  const wp = pendingWPosture(g, r.id) ?? (r.wposture && r.wposture.turn === st.turn ? r.wposture.kind : null);
  const surge = pendingFate(g).some(x => x.use === 'surge' && x.region === r.id);
  if (wp) return `${WORLD_POSTURES[wp]?.name ?? wp} · secret`;
  if (surge) return `Surge · ${g.live ? 'at the tick' : 'at seal'}`;
  // under siege it always shows (the urgency line), whatever the turn
  const S = contestOn(st) && r.bodies ? systemStatus(st, r) : null;
  if (S?.contested) return `under siege${S.refugeesIn !== null ? ` · refugees in ${S.refugeesIn}t` : ''}`;
  if (st.turn < POSTURE_FROM_TURN) return null;
  const t = threatsAt(g, r);
  if (t.here.length) return `${ownerWord(g, t.here[0].owner)} fleet here`;
  if (t.near.length) return `${ownerWord(g, t.near[0].owner)} fleet next door`;
  if (fateOn(st) && fateAvail(g) > 0 && (r.project || topYield(g).has(r.id))) return r.project ? 'Surge would rush the project' : 'Surge would pay here';
  return null;
}
/** Your three best-yielding worlds (a Surge doubles one turn of output). */
function topYield(g: GameScreen): Set<number> {
  const st = g.st, R = st.rules.economy.yields;
  const mine = st.regions.filter(x => x.owner === g.you && x.kind !== 'lane' && x.kind !== 'void');
  const score = (x: Region) => { const y = R[x.kind] ?? R.colony; return (y.industry + y.credits) * Math.max(1, x.dev) + (x.buildings.mine ?? 0) * 4 + (x.buildings.tradehub ?? 0) * 5; };
  return new Set(mine.sort((a, b) => score(b) - score(a)).slice(0, 3).map(x => x.id));
}

/** The world's Gambit: Levies, Scorch (and Gates where the rules keep it), Surge. */
export function worldGambit(g: GameScreen, r: Region): string {
  const why = gambitRelevant(g, r);
  if (!why) return '';
  const st = g.st, key = `r${r.id}`;
  const pend = pendingWPosture(g, r.id);
  const cur = pend ?? (r.wposture && r.wposture.turn === st.turn ? r.wposture.kind : null);
  const surge = pendingFate(g).some(x => x.use === 'surge' && x.region === r.id);
  let body = '';
  if (open.has(key)) {
    const cards: string[] = [];
    if (worldPosturesOn(st)) for (const p of WORLD_POSTURE_IDS) {
      const b = wpostureBlock(st, g.you!, r.id, p);
      if (b && /not in these rules/.test(b)) continue;   // the simplified world cut it
      const d = WORLD_POSTURES[p];
      const why = p === cur ? (cur && !pend ? null : null) : cur && !pend ? 'already set this turn' : b;
      cards.push(betCard({ a: 'wposture', data: `data-p="${p === cur ? '' : p}"`, icon: W(p), name: p === 'scorch' ? 'Scorch' : d.name.split(' ').slice(-1)[0], sub: 'free', why, on: p === cur, peek: `wbet:${p}` }));
    }
    if (fateOn(st)) cards.push(fateCard(g, 'surge', fateWhy(g, 'surge', undefined, r.id), `r${r.id}`, surge));
    const lines = cur ? betLines(WORLD_POSTURES[cur]) : surge ? `<div class="betline"><span class="k">Fate</span><span>${esc(FATE_USES.surge.desc.split('.')[0])}</span></div>` : noBet();
    body = `<div class="gopen"><div class="bets n${cards.length}">${cards.join('')}</div>${lines}</div>`;
  }
  return `<div class="gambit">${chip(key, ic('levies'), open.has(key) ? 'secret · this turn' : why, !!cur || surge, g)}${body}</div>`;
}

/** The fleet's Gambit chip text, read from the plan. */
function fleetGambitWhy(g: GameScreen, f: Fleet): string {
  const st = g.st;
  const pp = pendingPosture(g, f.id);
  if (pp && pp !== 'steady') return `${POSTURES[pp]?.name ?? pp} · secret`;
  const pf = pendingFate(g).find(x => x.fleet === f.id);
  if (pf) return `${FATE_USES[pf.use]?.name ?? pf.use} · ${g.live ? 'at the tick' : 'at seal'}`;
  if (f.limping) return 'Limping: Rally?';
  if ((st.engagements ?? []).some(e => e.region === f.region)) return 'In battle: Stand?';
  const seize = myOrders(g).find(o => !!o && o.type === 'seize' && (o.fleet === f.id || (o.also ?? []).includes(f.id)));
  const tgt = seize && seize.type === 'seize' ? seize.target : f.route?.seize ?? null;
  if (tgt !== null && tgt !== undefined && !postureWhy(g, f, 'charge')) return `Seizing ${st.regions[tgt]?.name ?? '?'}: Charge?`;
  const mv = myOrders(g).find(o => !!o && o.type === 'move' && o.fleet === f.id);
  const dest = mv && mv.type === 'move' ? mv.path[mv.path.length - 1] : f.route?.path.length ? f.route.path[f.route.path.length - 1] : null;
  if (dest !== null && dest !== undefined && !postureWhy(g, f, 'running')) return `Moving to ${st.regions[dest]?.name ?? '?'}: Run?`;
  if (!seizesThisTurn(g, f) && !movesThisTurn(g, f) && !postureWhy(g, f, 'ambush')) return 'Ambush here?';
  return 'steady';
}
/** The fleet's Gambit: postures (free, secret) and Fate (gold, public), one control. */
export function fleetGambit(g: GameScreen, f: Fleet): string {
  const st = g.st;
  if (f.owner !== g.you || !g.canPlan || (!posturesOn(st) && !fateOn(st))) return '';
  const cur = postureNow(g, f);
  const pf = pendingFate(g).find(x => x.fleet === f.id);
  const engaged = (st.engagements ?? []).some(e => e.region === f.region);
  if (st.turn < POSTURE_FROM_TURN && cur === 'steady' && !pf && !engaged && !f.limping) return '';
  const key = `f${f.id}`;
  let body = '';
  if (open.has(key)) {
    const locked = !!f.postureFx?.set && f.postureFx.turn === st.turn && !pendingPosture(g, f.id);
    const cards: string[] = [];
    if (posturesOn(st)) for (const p of POSTURE_IDS) {
      if (p === 'steady') continue;
      const d = POSTURES[p];
      const why = p === cur ? null : locked ? 'it already took a posture this turn' : postureWhy(g, f, p);
      cards.push(betCard({ a: 'posture', data: `data-p="${p === cur ? 'steady' : p}"`, icon: P(p), name: p === 'running' ? 'Run' : d.name, sub: p === 'charge' ? 'with a Seize' : 'free', why, on: p === cur, peek: `fbet:${p}` }));
    }
    if (fateOn(st)) {
      const uses: FateUse[] = f.limping ? ['rally', 'laststand', 'twist', 'hyperjump'] : ['laststand', 'twist', 'hyperjump'];
      for (const u of uses) cards.push(fateCard(g, u, pf ? (pf.use === u ? null : `${SG(st).fatePerTurn} Fate per turn`) : fateWhy(g, u, f.id), `f${f.id}`, pf?.use === u));
    }
    const lines = cur !== 'steady' ? betLines(POSTURES[cur]) : pf ? `<div class="betline"><span class="k">Fate</span><span>${esc(FATE_USES[pf.use]?.desc.split('.')[0] ?? '')}</span></div>` : noBet('Steady: no bet, the right call most turns. Postures stay secret; Fate is spent in public.');
    body = `<div class="gopen"><div class="bets n${cards.length > 4 ? 4 : cards.length}">${cards.join('')}</div>${lines}</div>`;
  }
  return `<div class="gambit">${chip(key, P(cur === 'steady' ? 'guarded' : cur), open.has(key) ? 'secret · this turn' : fleetGambitWhy(g, f), cur !== 'steady' || !!pf, g)}${body}</div>`;
}
/** Hover / long-press text for a bet card. */
export function betPeek(g: GameScreen, key: string): string | null {
  const [k, id] = key.split(':');
  const d = k === 'wbet' ? WORLD_POSTURES[id] : k === 'fbet' ? POSTURES[id] : null;
  if (d) return `<b>${esc(d.name)}</b><p>${esc(d.bet)}</p><p class="gain">${ic('check')} ${esc(d.right)}</p><p class="loss">${ic('close')} ${esc(d.wrong)}</p>`;
  if (k === 'fate') { const u = FATE_USES[id]; return u ? `<b>${esc(u.name)} · 1 Fate</b><p>${esc(u.desc)}</p><p class="d">Spent in public; ${SG(g.st).fateStart} for the whole game.</p>` : null; }
  return null;
}

/** Status chips for a fleet's posture state (dug in, exposed, Fate in force), any owner. */
export function postureStatus(g: GameScreen, f: Fleet): string[] {
  const st = g.st, out: string[] = [];
  if (!sigOn(st)) return out;
  if (isDugIn(st, f)) out.push(`<span class="warn"${tip('Guarded, nobody came: cannot move this turn')}>${ic(icFor('state', 'dug'))} Dug in</span>`);
  if (isExposed(st, f)) out.push(`<span class="warn"${tip('Ambush, nobody came: seen by all, weaker')}>${ic('eye')} Exposed</span>`);
  const fu = fateOf(st, f);
  if (fu) out.push(`<span class="fatechip"${tip(FATE_USES[fu]?.desc.split('.')[0] ?? '')}>${F(fu)} ${esc(FATE_USES[fu]?.name ?? fu)}</span>`);
  if (f.owner !== g.you && f.posture && f.posture !== 'steady') out.push(`<span class="war"${tip('Seen by your scouts or a scan')}>${P(f.posture)} ${esc(POSTURES[f.posture]?.name ?? f.posture)}</span>`);
  return out;
}

// ------------------------------------------------------------------ Fate (fleet and world)
let armed: { key: string; at: number } | null = null;
const coins = (n: number, max: number) => `<span class="coins">${Array.from({ length: Math.max(max, n) }, (_, i) => `<i class="${i < n ? 'on' : ''}">${ic('fate')}</i>`).join('')}</span>`;

// ------------------------------------------------------------------ actions
export function sigAction(g: GameScreen, a: string, data: DOMStringMap): boolean {
  const sel = g.sel;
  if (!sel || !g.canPlan) return false;
  if (a === 'posture' && sel.kind === 'fleet') {
    const f = g.fleet(sel.id);
    const p = data.p as Posture;
    if (!f) return true;
    if (p === 'steady' && !f.posture) dropFree(g, x => x.type === 'posture' && x.fleet === f.id);
    else setFree(g, { type: 'posture', fleet: f.id, posture: p }, x => x.type === 'posture' && x.fleet === f.id);
    return true;
  }
  if (a === 'wposture' && sel.kind === 'region') {
    const p = data.p as WorldPosture | '';
    if (!p) dropFree(g, x => x.type === 'wposture' && x.region === sel.id);
    else setFree(g, { type: 'wposture', region: sel.id, posture: p }, x => x.type === 'wposture' && x.region === sel.id);
    return true;
  }
  if (a === 'unfate') {
    dropFree(g, x => x.type === 'fate' && (sel.kind === 'fleet' ? x.fleet === sel.id : x.region === sel.id));
    return true;
  }
  if (a === 'fate') {
    const use = data.use as FateUse, key = data.key ?? '';
    // scarce: the first tap arms the button ("Spend?"), the second spends
    if (!armed || armed.key !== key || performance.now() - armed.at > 4000) { audio.ui('click'); armed = { key, at: performance.now() }; g.renderAll(); g.later(() => { if (armed?.key === key) { armed = null; g.renderAll(); } }, 4100); return true; }
    armed = null;
    const fa: FreeAction = use === 'surge' ? { type: 'fate', use, region: sel.id } : { type: 'fate', use, fleet: sel.id };
    setFree(g, fa, x => x.type === 'fate' && (use === 'surge' ? x.region === sel.id : x.fleet === sel.id));
    audio.ui('coin');
    fateFlourish(g, use);
    return true;
  }
  return false;
}

/** The public reveal: a coin flips off the HUD pips, a banner names the Fate. */
export function fateFlourish(g: GameScreen, use: FateUse | 'bonus') {
  const pill = g.hud.h.res.querySelector<HTMLElement>('[data-k=fate]');
  if (pill) { pill.classList.remove('flip'); void pill.offsetWidth; pill.classList.add('flip'); }
  // the coin lands, then the banner's flourish
  audio.sfx('ui_banner', { delay: 0.14 });
  g.banner(use === 'bonus' ? '✪ FORTUNE' : `✪ ${(FATE_USES[use]?.name ?? use).toUpperCase()}`);
  toast(use === 'bonus' ? '✪ A Fate token, for the fallen' : `✪ ${FATE_USES[use]?.name ?? use}: spent when the turn resolves`);
}

// ------------------------------------------------------------------ drag-to-order: offer a Charge after a Seize
let offerEl: HTMLElement | null = null;
export function offerCharge(g: GameScreen, fleet: number, region: number) {
  const f = g.fleet(fleet);
  if (!f || !posturesOn(g.st) || g.st.turn < POSTURE_FROM_TURN || postureNow(g, f) !== 'steady' || postureWhy(g, f, 'charge')) return;
  offerEl?.remove();
  const el = document.createElement('button');
  el.className = 'chargeoffer';
  el.innerHTML = `<i>${P('charge')}</i><b>Charge?</b><small>${esc(POSTURES.charge.bet)}</small>`;
  const p = g.map.toScreen(g.st.regions[region].site);
  el.style.transform = `translate(${Math.round(Math.max(8, Math.min(g.map.w - 220 * uiScale(), p.x + 22)))}px, ${Math.round(Math.max(60 * uiScale() + safeInsets(g.root).t, p.y - 70 * uiScale()))}px)`;
  g.hud.h.res.parentElement!.appendChild(el);
  offerEl = el;
  el.addEventListener('click', () => {
    el.remove();
    // the seat may have changed (hotseat) or the plan been sealed since the offer went up
    if (g.fleet(fleet)?.owner !== g.you || !g.canPlan) return;
    setFree(g, { type: 'posture', fleet, posture: 'charge' }, x => x.type === 'posture' && x.fleet === fleet);
    toast(`${POSTURES.charge.icon} ${f.name}: Charge`);
  });
  g.later(() => { el.classList.add('out'); g.later(() => el.remove(), 250); }, 4500);
}

// ------------------------------------------------------------------ map: what each token shows
/** Fleet id → posture to draw (yours: planned or in force; rivals': only what your view reveals). */
export function postureMap(g: GameScreen): Map<number, string> {
  const out = new Map<number, string>();
  if (!posturesOn(g.st)) return out;
  for (const f of g.st.fleets) {
    const p = f.owner === g.you ? postureNow(g, f) : f.posture;
    if (p && p !== 'steady') out.set(f.id, p);
  }
  return out;
}

// ------------------------------------------------------------------ HUD: Fate coins
export function fatePill(g: GameScreen): string {
  if (g.you === null || !fateOn(g.st)) return '';
  const n = fateAvail(g), max = SG(g.st).fateStart;
  return `<button class="respill fatepill" data-k="fate" aria-label="Fate: ${n} of ${max} tokens left"><small class="fl">Fate</small>${coins(n, max)}</button>`;
}
export function fatePop(g: GameScreen): string {
  const n = fateAvail(g);
  return `<div class="bd"><div class="h">${ic('fate')} Fate <b>${n}</b> left</div><div class="r sub"><span>Rare tokens, spent in public: tap Fate on a fleet or world card.</span></div>${(['laststand', 'twist', 'hyperjump', 'rally', 'surge'] as FateUse[]).map(u => `<div class="r"><span>${F(u)} ${esc(FATE_USES[u].name)}</span><b>${FATE_USES[u].target === 'region' ? 'world' : 'fleet'}</b></div>`).join('')}<div class="r"><span>Per turn</span><b>${SG(g.st).fatePerTurn}</b></div></div>`;
}

// The Empire tab: research tree, Charter (laws), ship designs (blueprints), and a
// resources & supply summary. Design: docs/EMPIRE.md. Everything a rival does here is
// public, so the tab also shows rivals' techs and laws (and spectators can browse any
// player's empire, read-only).
import type { GameScreen } from '../game.ts';
import type { FreeAction, Order } from '../../../shared/sim/types.ts';
import { BRANCHES, TECHS, TECH, LAWS, LAW, LAW_PAIRS, MODULES, MODULE, VEINS, type Branch, type TechDef } from '../../../shared/config/empire.ts';
import { techCost, researchBlock, lawSlots, lawBlock, lawCost, opposite, starOwner, connected, supplied, hasVein, blueprintFor, classBlock, academyLevels } from '../../../shared/sim/empire.ts';
import { canAfford, costText } from '../../../shared/sim/orders.ts';
import { creditRate } from '../../../shared/sim/resolve.ts';
import { distance } from '../../../shared/sim/graph.ts';
import { esc, roman, toast } from './dom.ts';
import { ic, icFor } from '../art/icons.ts';
import { miniUrl } from './ship-plinth.ts';
import { ownerHi, enamelBoss } from '../art/bible.ts';
const TI = (t: { id: string; icon: string }) => ic(icFor('tech', t.id, t.icon));
const LI = (l: { id: string; icon: string }) => ic(icFor('law', l.id, l.icon));

const tip = (t: string) => ` data-tip="${esc(t)}"`;
const capFirst = (t: string | null) => (t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : null);
const TIER = ['', 'I', 'II', 'III', '★'];
const BRANCH_IDS = Object.keys(BRANCHES) as Branch[];


export type EmpFocus = { kind: 'tech' | 'law'; id: string } | null;

/** Touch screens: the first tap on a node only shows its details (no accidental spending). */
const touchy = (g: GameScreen) => g.phone || (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches);

/** Which player the tab shows: you, or the player a spectator picked. */
export function empirePid(g: GameScreen): number {
  if (g.you !== null) return g.you;
  const n = g.st.players.length;
  return g.empPid !== null && g.empPid >= 0 && g.empPid < n ? g.empPid : 0;
}
/** Your free actions waiting for the turn (WEGO plan) or the next tick (LIVE). */
function freeList(g: GameScreen): FreeAction[] {
  if (g.you === null) return [];
  return g.live ? g.st.live?.free[g.you] ?? [] : g.plan.free;
}
export function pendingResearch(g: GameScreen): string | null {
  const fa = freeList(g).find(x => x.type === 'research');
  return fa && fa.type === 'research' ? fa.tech : null;
}
const pendingRevoke = (g: GameScreen, law: string) => freeList(g).some(x => x.type === 'revoke' && x.law === law);
function pendingBlueprint(g: GameScreen, cls: string): string | null {
  const fa = [...freeList(g)].reverse().find(x => x.type === 'blueprint' && x.cls === cls);
  return fa && fa.type === 'blueprint' ? fa.mod : null;
}
/** Where a law order sits: the WEGO slot, or the LIVE queue index. */
function pendingLaw(g: GameScreen, law: string): number | null {
  const list: (Order | null)[] = g.live ? g.queue : g.plan.orders;
  const i = list.findIndex(o => o?.type === 'law' && o.law === law);
  return i >= 0 ? i : null;
}
/** Resources left for a purchase after everything else you have planned (optionally ignoring the pending research). */
function leftover(g: GameScreen, pid: number, ignoreResearch: boolean) {
  const res = g.st.players[pid].res;
  if (g.you !== pid || g.live) return { ...res };
  const sp = g.plannedSpend();
  const out = { industry: res.industry - sp.industry, credits: res.credits - sp.credits, influence: res.influence - sp.influence };
  const pr = pendingResearch(g);
  if (ignoreResearch && pr) { const c = techCost(g.st, pid, pr); out.industry += c.industry ?? 0; out.credits += c.credits ?? 0; }
  return out;
}

type TState = 'own' | 'pending' | 'avail' | 'short' | 'busy' | 'locked' | 'other' | 'rival';
interface TInfo { s: TState; why: string; owner?: number }

function techInfo(g: GameScreen, pid: number, t: TechDef): TInfo {
  const st = g.st, per = g.live ? 'cycle' : 'turn';
  if (st.players[pid].techs?.includes(t.id)) return { s: 'own', why: 'Researched.' };
  const mine = pid === g.you;
  const pend = mine ? pendingResearch(g) : null;
  if (pend === t.id) return { s: 'pending', why: g.live ? 'Queued: bought at the next tick.' : 'Queued: bought when the turn resolves, before any orders. Remove it to pick another.' };
  const b = researchBlock(st, pid, t.id);
  if (b?.startsWith('you chose')) return { s: 'other', why: `${capFirst(b)} Tier III is a fork: one of two, forever.` };
  if (t.tier === 4) { const o = starOwner(st, t.id); if (o !== null && o !== pid) return { s: 'rival', why: `${st.players[o].name} owns it. A ★ technology has one owner per game.`, owner: o }; }
  if (b && !b.startsWith('one technology')) return { s: 'locked', why: capFirst(b)! };
  if (b) return { s: 'busy', why: `You already bought a technology this ${per}. More next ${per}.` };
  if (pend && g.live) return { s: 'busy', why: `One per cycle: ${TECH[pend]?.name ?? pend} is already queued.` };
  if (!mine) return { s: 'avail', why: 'Available to research.' };
  const cost = techCost(st, pid, t.id);
  const left = leftover(g, pid, true);
  const short = !canAfford(left, cost, creditRate(st, pid));
  const repl = pend ? ` Replaces ${TECH[pend]?.name ?? pend} as this ${per}'s research.` : '';
  if (short) return { s: 'short', why: `Not enough resources: you'd have ${Math.max(0, left.industry)}⚙ ${Math.max(0, left.credits)}¢ after your other plans (spare credits cover missing ⚙).${repl}` };
  return { s: 'avail', why: `${touchy(g) ? 'Tap Research' : 'Click'} to buy it (free action, no order).${repl}` };
}

// ====================================================================== HTML
export function empireHtml(g: GameScreen): string {
  const st = g.st;
  if (st.rules.empire?.enabled === false) return `<p class="dim">The Empire layer (research, laws, ship designs, supply) is switched off in these rules.</p>`;
  const pid = empirePid(g);
  const pl = st.players[pid];
  const editable = g.you === pid && g.canPlan;
  const pick = g.you === null ? `<div class="empp">${st.players.map(p => `<button class="small ${p.id === pid ? 'active' : ''}" data-emp-p="${p.id}" style="color:${esc(ownerHi(p.color))}">${esc(p.name)}</button>`).join('')}</div>` : '';
  const ro = g.you === null ? `<div class="note">Spectating: ${esc(pl.name)}'s empire (read-only). Techs, laws and designs are public.</div>` : '';
  return `${pick}${ro}${alertsHtml(g, pid)}${researchHtml(g, pid, editable)}${charterHtml(g, pid, editable)}${designsHtml(g, pid, editable)}${supplyHtml(g, pid)}${g.you !== null ? rivalsHtml(g, pid) : ''}`;
}

/** Red lines that need attention right away (cut-off regions, starving fleets). */
function alertsHtml(g: GameScreen, pid: number): string {
  const st = g.st;
  const conn = connected(st, pid), sup = supplied(st, pid, conn);
  const cut = st.regions.filter(r => r.owner === pid && !conn.has(r.id));
  const oos = st.fleets.filter(f => f.owner === pid && f.ships.length && ((f.oos ?? 0) > 0 || !sup.has(f.region)));
  const out: string[] = [];
  const whose = pid === g.you ? 'your' : `${esc(st.players[pid].name)}'s`;
  if (cut.length) out.push(`<div class="status cut">✂ ${cut.length} region${cut.length > 1 ? 's' : ''} cut off from ${whose} capital: half yield, veins dark. ${cut.slice(0, 3).map(r => `<span class="click" data-region="${r.id}">${esc(r.name)}</span>`).join(', ')}${cut.length > 3 ? '…' : ''}</div>`);
  if (oos.length) out.push(`<div class="status cut">⛽ ${oos.length} fleet${oos.length > 1 ? 's' : ''} out of supply: no repairs${oos.some(f => (f.oos ?? 0) > st.rules.empire.oosGraceTurns) ? ', wearing down' : ''}. ${oos.slice(0, 3).map(f => `<span class="click" data-fleet="${f.id}">${esc(f.name)}</span>`).join(', ')}</div>`);
  return out.join('');
}

function researchHtml(g: GameScreen, pid: number, editable: boolean): string {
  const st = g.st, pl = st.players[pid], per = g.live ? 'cycle' : 'turn';
  const focus = g.empFocus?.kind === 'tech' ? g.empFocus.id : null;
  const acad = academyLevels(st, pid);
  const disc = Math.round(Math.min(st.rules.empire.academyMaxDiscount, acad * st.rules.empire.academyDiscount) * 100);
  const node = (t: TechDef | undefined) => {
    if (!t) return '';
    const B = BRANCHES[t.branch];
    const inf = techInfo(g, pid, t);
    const cost = techCost(st, pid, t.id);
    const rivals = st.players.filter(p => p.id !== pid && p.techs?.includes(t.id));
    const showCost = inf.s === 'avail' || inf.s === 'short' || inf.s === 'busy' || inf.s === 'pending';
    const sub = inf.s === 'pending' ? '⏳ queued' : inf.s === 'rival' ? `♛ ${esc(st.players[inf.owner!].name)}` : inf.s === 'other' ? 'not chosen' : showCost ? `<span class="${inf.s === 'short' ? 'bad' : ''}">${costText(cost)}</span>` : '';
    const t1 = `${t.icon} ${t.name} · ${B.name} ${TIER[t.tier]}\n${t.desc}\n${showCost ? `Cost ${costText(cost)}. ` : ''}${inf.why}${rivals.length ? `\nAlso owned by ${rivals.map(p => p.name).join(', ')}.` : ''}`;
    const pips = rivals.length ? `<span class="rp">${rivals.map(p => `<i style="background:${esc(ownerHi(p.color))}"></i>`).join('')}</span>` : '';
    const x = inf.s === 'pending' && editable && !g.live ? `<i class="x" data-unres title="Cancel this research" role="button" aria-label="Cancel research">×</i>` : '';
    return `<button class="tn ${inf.s} t${t.tier} ${focus === t.id ? 'focus' : ''}" data-tech="${t.id}" data-pop="tech:${pid}.${t.id}.${inf.s}"${inf.owner !== undefined ? ` style="--rc:${esc(ownerHi(st.players[inf.owner].color))}"` : ''}${tip(t1)} aria-label="${esc(`${t.name}: ${inf.why}`)}"><span class="ti">${TI(t)}</span><span class="tnm">${esc(t.name)}</span>${sub ? `<small>${sub}</small>` : ''}${pips}${x}</button>`;
  };
  const cols = BRANCH_IDS.map(b => {
    const B = BRANCHES[b];
    const ts = TECHS.filter(t => t.branch === b);
    const f = ts.filter(t => t.tier === 3);
    const owned = ts.filter(t => pl.techs?.includes(t.id)).length;
    return `<div class="br" style="--bc:${enamelBoss(B.color)}"><div class="bh"${tip(`${B.icon} ${B.name}: ${B.pitch}\nI → II → III (pick one of two, forever) → ★ (one owner per game).`)}><span class="bi">${ic(icFor('branch', b, B.icon))}</span><b>${B.name}</b><small>${owned}/4</small></div>
      <div class="nodes">${node(ts.find(t => t.tier === 1))}${node(ts.find(t => t.tier === 2))}<div class="fork">${node(f[0])}<i class="or">or</i>${node(f[1])}</div>${node(ts.find(t => t.tier === 4))}</div></div>`;
  }).join('');
  const total = pl.techs?.length ?? 0;
  const head = `<div class="emh"><h2>Research</h2><span class="n"${tip(`One technology per ${per}. It's a free action: it costs resources, not an order.\nPrices grow with tier and with the size of your empire.${acad ? `\nYour Academies cut them by ${disc}%.` : '\nAn Academy (Develop) cuts them 15% per level.'}\nTier III: pick one of two, forever. ★: whoever buys it first owns it for the whole game.`)}>${total} known · 1 per ${per}<i class="ip">i</i></span></div>`;
  return `<div class="emsec">${head}<div class="tree${editable ? '' : ' ro'}">${cols}</div>${detailHtml(g, pid, editable, 'tech')}</div>`;
}

/** The selected node/card: what it does, what it costs, the action button (or why not). */
function detailHtml(g: GameScreen, pid: number, editable: boolean, kind: 'tech' | 'law'): string {
  const st = g.st, per = g.live ? 'cycle' : 'turn';
  const f = g.empFocus?.kind === kind ? g.empFocus : null;
  if (f?.kind === 'tech' && TECH[f.id]) {
    const t = TECH[f.id], B = BRANCHES[t.branch], inf = techInfo(g, pid, t), cost = techCost(st, pid, t.id);
    let btn = '';
    if (editable && (inf.s === 'avail' || inf.s === 'short' || inf.s === 'busy')) btn = `<button class="primary small" data-research="${t.id}" ${inf.s === 'avail' ? '' : `disabled title="${esc(inf.why)}"`}>Research · ${costText(cost)}</button>`;
    else if (editable && inf.s === 'pending' && !g.live) btn = `<button class="small" data-unres>Cancel research</button>`;
    return `<div class="edetail" style="--bc:${enamelBoss(B.color)}"><div class="row"><b class="grow">${TI(t)} ${esc(t.name)}</b><span class="faint">${ic(icFor('branch', t.branch, B.icon))} ${B.name} ${TIER[t.tier]}</span></div><div>${esc(t.desc)}</div>
      <div class="row" style="margin-top:0.25rem">${btn}<span class="${inf.s === 'short' || inf.s === 'locked' || inf.s === 'rival' ? 'why' : 'note'} grow" style="margin:0">${esc(inf.why)}</span></div></div>`;
  }
  if (f?.kind === 'law' && LAW[f.id]) {
    const l = LAW[f.id];
    const c = lawCard(g, pid, editable, l.id);
    let btn = '';
    if (editable && c.state === 'open') btn = `<button class="primary small" data-enact="${l.id}" ${c.why ? `disabled title="${esc(c.why)}"` : ''}>Enact · ${c.cost}✦ + 1 order</button>`;
    if (editable && c.state === 'on') btn = `<button class="small" data-revoke="${l.id}" title="Free: the slot opens up">Revoke</button>`;
    return `<div class="edetail law"><div class="row"><b class="grow">${LI(l)} ${esc(l.name)}</b><span class="faint">${esc(LAW_PAIRS[l.pair])}</span></div><div>${esc(l.desc)}</div>
      <div class="row" style="margin-top:0.25rem">${btn}<span class="${c.why ? 'why' : 'note'} grow" style="margin:0">${esc(c.why ?? c.note)}</span></div></div>`;
  }
  if (kind === 'law') return '';
  return `<div class="note" style="margin-top:0.375rem">${editable ? `${touchy(g) ? 'Tap' : 'Hover'} a technology to see what it does; ${touchy(g) ? 'tap Research to buy it' : 'click a glowing one to buy it'}. One per ${per}.` : 'Lit nodes are researched. Coloured dots are rivals who have it too.'}</div>`;
}

/** Laws you have queued that need a new slot (not switches of an enacted pair). */
function queuedLaws(g: GameScreen, pid: number): string[] {
  const pl = g.st.players[pid];
  return LAWS.filter(l => pendingLaw(g, l.id) !== null && !pl.laws?.includes(opposite(l.id) ?? '')).map(l => l.id);
}

interface LawCard { state: 'on' | 'revoking' | 'pending' | 'open'; why: string | null; note: string; cost: number }
function lawCard(g: GameScreen, pid: number, editable: boolean, id: string): LawCard {
  const st = g.st, pl = st.players[pid];
  // priced as the resolver will: after your free actions (revoking the other side first makes it a plain enact)
  const cs = pid === g.you ? g.costState() : st;
  const cost = lawCost(cs, pid, id);
  const opp = opposite(id);
  const switching = !!opp && !!cs.players[pid].laws?.includes(opp);
  if (pl.laws?.includes(id)) {
    if (pid === g.you && pendingRevoke(g, id)) return { state: 'revoking', why: null, note: g.live ? 'Revoked at the next tick.' : 'Revoked when the turn resolves, before any orders.', cost };
    return { state: 'on', why: null, note: 'In force. Revoking is free and opens the slot.', cost };
  }
  const k = pid === g.you ? pendingLaw(g, id) : null;
  if (k !== null) return { state: 'pending', why: null, note: g.live ? 'Enacted at the next tick.' : `Enacted in pulse ${roman(k + 1)}.`, cost };
  let why: string | null = null;
  if (editable) why = g.orderWhy({ type: 'law', law: id });
  else if (pid === g.you) why = g.planBlock();
  else why = capFirst(lawBlock(st, pid, id));
  if (!why && pid === g.you) {
    // laws already queued this turn take their slots too (and a pair can only change once)
    if (opp && pendingLaw(g, opp) !== null) why = `${LAW[opp].name} is already queued for this pair.`;
    else if (!switching) {
      const queued = queuedLaws(g, pid).filter(x => x !== id);
      const after = (pl.laws ?? []).filter(x => !pendingRevoke(g, x)).length + queued.length;
      const slots = lawSlots({ ...st, players: g.pendingPlayers() }, pid);
      if (queued.length && after >= slots) why = `No free law slot: ${queued.map(x => LAW[x].name).join(', ')} already queued (${after}/${slots}). Revoke a law (free) to make room.`;
    }
  }
  const note = `Costs an order + ${cost}✦${switching ? ` (double: switching from ${LAW[opp!].name})` : ''}.`;
  return { state: 'open', why, note, cost };
}

function charterHtml(g: GameScreen, pid: number, editable: boolean): string {
  const st = g.st, pl = st.players[pid], E = st.rules.empire;
  const slots = lawSlots(st, pid), laws = pl.laws ?? [];
  const focus = g.empFocus?.kind === 'law' ? g.empFocus.id : null;
  const next = E.lawSlotTurns.find(t => st.turn < t);
  const slotTip = `Law slots: ${slots}. You start with ${E.lawSlotsStart}${E.lawSlotTurns.length ? `, +1 at ${g.live ? 'cycle' : 'turn'} ${E.lawSlotTurns.join(', ')}` : ''}, +1 with Bureaucracy (Statecraft II).${next ? `\nNext slot: ${g.live ? 'cycle' : 'turn'} ${next}.` : ''}\nPick at most one side of each pair. Enacting costs an order and influence; switching a pair to its other side costs double. Revoking is free.`;
  const card = (id: string) => {
    const l = LAW[id];
    const c = lawCard(g, pid, editable, id);
    const rivals = st.players.filter(p => p.id !== pid && p.laws?.includes(id));
    const pips = rivals.length ? `<span class="rp">${rivals.map(p => `<i style="background:${esc(ownerHi(p.color))}"></i>`).join('')}</span>` : '';
    const sub = c.state === 'on' ? 'in force' : c.state === 'revoking' ? 'revoking' : c.state === 'pending' ? `⏳ ${g.live ? 'next tick' : `pulse ${roman((pendingLaw(g, id) ?? 0) + 1)}`}` : `${c.cost}✦${opposite(id) && laws.includes(opposite(id)!) && !(pid === g.you && pendingRevoke(g, opposite(id)!)) ? ' · switch' : ''}`;
    const x = editable ? (c.state === 'on' ? `<i class="x" data-revoke="${id}" title="Revoke (free)" role="button" aria-label="Revoke ${esc(l.name)}">×</i>`
      : c.state === 'revoking' && !g.live ? `<i class="x" data-unrevoke="${id}" title="Keep this law" role="button" aria-label="Keep ${esc(l.name)}">↺</i>`
      : c.state === 'pending' ? `<i class="x" data-unlaw="${id}" title="Remove this order" role="button" aria-label="Cancel">×</i>` : '') : '';
    const t1 = `${l.icon} ${l.name}\n${l.desc}\n${c.why ?? c.note}${rivals.length ? `\nAlso enacted by ${rivals.map(p => p.name).join(', ')}.` : ''}`;
    return `<button class="lc ${c.state} ${c.why && c.state === 'open' ? 'blocked' : ''} ${focus === id ? 'focus' : ''}" data-law="${id}" data-pop="law:${pid}.${id}.${c.state}"${tip(t1)} aria-label="${esc(`${l.name}: ${c.why ?? c.note}`)}"><span class="li">${LI(l)}</span><span class="lnm">${esc(l.name)}<small>${sub}</small></span>${pips}${x}</button>`;
  };
  const rows = LAW_PAIRS.map((name, i) => {
    const [a, b] = LAWS.filter(l => l.pair === i);
    return `<div class="lp"><span class="lpn">${esc(name)}</span>${card(a.id)}${card(b.id)}</div>`;
  }).join('');
  const q = pid === g.you ? queuedLaws(g, pid).length : 0;
  const head = `<div class="emh"><h2>Charter</h2><span class="n"${tip(slotTip)}><b class="${laws.length + q >= slots ? '' : 'gold'}">${laws.length}/${slots}</b> laws${q ? ` <span class="gold">+${q} queued</span>` : ''}<i class="ip">i</i></span></div>`;
  return `<div class="emsec">${head}<div class="laws">${rows}</div>${detailHtml(g, pid, editable, 'law')}</div>`;
}

function designsHtml(g: GameScreen, pid: number, editable: boolean): string {
  const st = g.st, R = st.rules, pl = st.players[pid];
  const known = MODULES.filter(m => !m.tech || pl.techs?.includes(m.tech));
  const classes = Object.entries(R.ships).filter(([k]) => { const b = classBlock(st, pid, k); return !b || b.includes('Extractor'); });
  const cur = (cls: string) => (pid === g.you ? pendingBlueprint(g, cls) : null) ?? blueprintFor(st, pid, cls) ?? 'armor';
  const rows = classes.map(([k, d]) => {
    const c = cur(k), m = MODULE[c];
    const pend = pid === g.you && pendingBlueprint(g, k) !== null && pendingBlueprint(g, k) !== blueprintFor(st, pid, k);
    const chips = editable ? MODULES.map(x => {
      const ok = !x.tech || pl.techs?.includes(x.tech);
      const t1 = `${x.icon} ${x.name}: ${x.desc}${ok ? '' : `\nNeeds ${TECH[x.tech!]?.name ?? x.tech} (research).`}`;
      return `<button class="mod ${x.id === c ? 'on' : ''}" data-bp="${k}:${x.id}" ${ok ? '' : 'disabled'}${tip(t1)} aria-label="${esc(`${x.name} for ${d.name}`)}">${ic(icFor('module', x.id, x.icon))}</button>`;
    }).join('') : '';
    return `<div class="bp"><span class="bpc"><img class="g mini" src="${miniUrl(k, pid, ownerHi(g.color(pid)), 34, 20)}" width="34" height="20" alt="" draggable="false">${esc(d.name)}</span><span class="bpm"${tip(`${m?.name}: ${m?.desc}`)}>${m ? ic(icFor('module', m.id, m.icon)) : ''} ${esc(m?.name ?? c)}${pend ? ' <span class="gold">⏳</span>' : ''}</span><span class="mods">${chips}</span></div>`;
  }).join('');
  const old = st.fleets.filter(f => f.owner === pid).reduce((a, f) => a + f.ships.filter(s => s.mod !== blueprintFor(st, pid, s.cls)).length, 0);
  const body = `<div class="bps">${rows}</div><div class="orderhelp">Each ship class carries one module. New ships get it. Older ships keep theirs until you <b>Refit</b> their fleet at one of your shipyards (an order, ${R.empire.refitIndustryPerShip}⚙ per ship; it also repairs).${known.length < MODULES.length ? ` Research ${MODULES.filter(m => m.tech && !pl.techs?.includes(m.tech)).map(m => TECH[m.tech!]?.name).join(', ')} for more modules.` : ''}</div>`;
  return g.sec('designs', 'Ship designs', body, `${known.length}/${MODULES.length} modules${old ? ` · ${old} ship${old > 1 ? 's' : ''} to refit` : ''}`);
}

function supplyHtml(g: GameScreen, pid: number): string {
  const st = g.st, E = st.rules.empire, pl = st.players[pid];
  const conn = connected(st, pid), sup = supplied(st, pid, conn);
  const owned = st.regions.filter(r => r.owner === pid);
  const reg = (id: number) => `<span class="click" data-region="${id}">${esc(st.regions[id].name)}</span>`;
  const veins = Object.entries(VEINS).map(([v, V]) => {
    const access = hasVein(st, pid, v, conn);
    const mineX = owned.filter(r => r.vein === v);
    const ext = mineX.filter(r => (r.buildings.extractor ?? 0) > 0);
    const idle = mineX.filter(r => !(r.buildings.extractor ?? 0));
    let where = '';
    if (ext.length) where = `Extractor${ext.length > 1 ? 's' : ''}: ${ext.map(r => `${reg(r.id)}${conn.has(r.id) ? '' : ' <span class="bad">(cut off)</span>'}`).join(', ')}`;
    if (idle.length) where += `${where ? '. ' : ''}Vein without an Extractor: ${idle.map(r => reg(r.id)).join(', ')} <span class="gold">(Develop one)</span>`;
    if (!mineX.length) {
      const cap = pl.capital;
      const far = st.regions.filter(r => r.vein === v).map(r => ({ r, d: st.regions[cap] ? distance(st, cap, r.id) : 99 })).sort((a, b) => a.d - b.d)[0];
      where = far ? `None in your territory. Nearest: ${reg(far.r.id)} (${esc(g.pname(far.r.owner))}, ${far.d} jump${far.d === 1 ? '' : 's'} from your capital).` : 'No veins on this map.';
    }
    return `<div class="vrow"><span class="vi" style="color:${V.color}"${tip(`${V.name}: ${V.desc}\nAn Extractor on a vein you own gives access (and +${E.extractorCredits}¢ a ${g.live ? 'cycle' : 'turn'}) while it stays connected to your capital.`)}>${V.icon}</span><div><b>${V.name}</b> ${access ? '<span class="good">✓ access</span>' : '<span class="bad">✗ no access</span>'} <span class="faint">· ${esc(V.desc.replace(/^Needed for /, 'for ').replace(/\.$/, ''))}</span><br><span class="dim">${where}</span></div></div>`;
  }).join('');
  const cut = owned.filter(r => !conn.has(r.id));
  const oos = st.fleets.filter(f => f.owner === pid && f.ships.length && ((f.oos ?? 0) > 0 || !sup.has(f.region)));
  const depots = owned.filter(r => r.buildings.depot).length, gates = owned.filter(r => r.buildings.gate).length;
  const supTip = `Connected: your regions linked to your capital through your own territory, with no hostile warships sitting in them. Cut-off regions yield half and their Extractors go dark.\nIn supply: fleets in or next to connected territory (${E.depotRange} away from a Depot). Out of supply they don't repair, and after ${E.oosGraceTurns} ${g.live ? 'cycle' : 'turn'}${E.oosGraceTurns > 1 ? 's' : ''} lose ${E.oosAttrition} hp per ship each ${g.live ? 'cycle' : 'turn'}.`;
  const supply = `<div class="kv"><span>Connected</span><span${tip(supTip)} class="nt">${owned.length - cut.length}/${owned.length} regions${cut.length ? ` · <span class="bad">${cut.length} cut off</span>` : ''}</span>
    ${cut.length ? `<span>Cut off</span><span>${cut.map(r => reg(r.id)).join(', ')} <span class="faint">(half yield)</span></span>` : ''}
    <span>Fleets</span><span>${oos.length ? `<span class="bad">${oos.length} out of supply</span>: ${oos.map(f => `<span class="click" data-fleet="${f.id}">${esc(f.name)}</span>${f.oos ? ` (${f.oos} ${g.live ? 'cycle' : 'turn'}${f.oos > 1 ? 's' : ''})` : ''}`).join(', ')}` : 'all in supply'}</span>
    ${depots || gates ? `<span>Network</span><span>${depots ? `${depots} depot${depots > 1 ? 's' : ''}` : ''}${depots && gates ? ', ' : ''}${gates ? `${gates} warp gate${gates > 1 ? 's' : ''}` : ''}</span>` : ''}</div>`;
  const sum = `${Object.entries(VEINS).map(([v, V]) => `${V.icon}${hasVein(st, pid, v, conn) ? '✓' : '✗'}`).join(' ')}${cut.length ? ` · ${cut.length} cut off` : ''}${oos.length ? ` · ${oos.length} unsupplied` : ''}`;
  return g.sec('supply', 'Resources & supply', `${veins}${supply}`, sum);
}

function rivalsHtml(g: GameScreen, pid: number): string {
  const st = g.st;
  const rows = st.players.filter(p => p.id !== pid).map(p => {
    const techs = TECHS.filter(t => p.techs?.includes(t.id));
    const laws = LAWS.filter(l => p.laws?.includes(l.id));
    return `<div class="rv"><b style="color:${esc(ownerHi(p.color))}">${esc(p.name)}</b>
      <div class="rvt">${techs.length ? techs.map(t => `<span class="chip" style="--bc:${enamelBoss(BRANCHES[t.branch].color)}"${tip(`${t.name} (${BRANCHES[t.branch].name} ${TIER[t.tier]}): ${t.desc}`)}>${TI(t)}</span>`).join('') : '<span class="faint">no technologies</span>'}</div>
      <div class="rvt">${laws.length ? laws.map(l => `<span class="chip law"${tip(`${l.name}: ${l.desc}`)}>${LI(l)} ${esc(l.name)}</span>`).join('') : '<span class="faint">no laws</span>'}</div></div>`;
  }).join('');
  const sum = `${st.players.filter(p => p.id !== pid).map(p => p.techs?.length ?? 0).join(' · ')} techs`;
  return g.sec('rivals', 'Rivals', `${rows}<div class="note">Research, laws and ship designs are public. Plan around them.</div>`, sum);
}

// ====================================================================== actions
export function bindEmpire(g: GameScreen) {
  const b = g.el.tabbody;
  const pid = empirePid(g);
  const editable = g.you === pid && g.canPlan;
  const rerender = () => g.renderAll();
  b.querySelectorAll<HTMLElement>('[data-emp-p]').forEach(e => e.addEventListener('click', () => { g.empPid = Number(e.dataset.empP); g.empFocus = null; g.renderTab(); }));
  b.querySelectorAll<HTMLElement>('[data-fleet]').forEach(e => e.addEventListener('click', () => g.select({ kind: 'fleet', id: Number(e.dataset.fleet) })));
  b.querySelectorAll<HTMLElement>('[data-tech]').forEach(e => e.addEventListener('click', ev => {
    const id = e.dataset.tech!;
    if ((ev.target as HTMLElement).closest('[data-unres]')) { ev.stopPropagation(); unresearch(g); return; }
    const s = techInfo(g, pid, TECH[id]).s;
    const was = g.empFocus?.kind === 'tech' && g.empFocus.id === id;
    g.empFocus = { kind: 'tech', id };
    if (editable && s === 'avail' && (!touchy(g) || was)) { research(g, id); return; }
    g.renderTab();
  }));
  b.querySelectorAll<HTMLElement>('[data-research]').forEach(e => e.addEventListener('click', () => research(g, e.dataset.research!)));
  b.querySelectorAll<HTMLElement>('[data-unres]').forEach(e => { if (!e.closest('[data-tech]')) e.addEventListener('click', () => unresearch(g)); });
  b.querySelectorAll<HTMLElement>('[data-law]').forEach(e => e.addEventListener('click', ev => {
    const id = e.dataset.law!;
    const t = ev.target as HTMLElement;
    if (editable) {
      const rv = t.closest<HTMLElement>('[data-revoke]'), ur = t.closest<HTMLElement>('[data-unrevoke]'), ul = t.closest<HTMLElement>('[data-unlaw]');
      if (rv) { ev.stopPropagation(); revoke(g, id); return; }
      if (ur) { ev.stopPropagation(); g.plan.free = g.plan.free.filter(x => !(x.type === 'revoke' && x.law === id)); g.savePlan(); rerender(); return; }
      if (ul) { ev.stopPropagation(); unlaw(g, id); return; }
    }
    const c = lawCard(g, pid, editable, id);
    const was = g.empFocus?.kind === 'law' && g.empFocus.id === id;
    g.empFocus = { kind: 'law', id };
    if (editable && c.state === 'open' && !c.why && (!touchy(g) || was)) { enact(g, id); return; }
    g.renderTab();
  }));
  b.querySelectorAll<HTMLElement>('[data-enact]').forEach(e => e.addEventListener('click', () => enact(g, e.dataset.enact!)));
  b.querySelectorAll<HTMLElement>('.edetail [data-revoke]').forEach(e => e.addEventListener('click', () => revoke(g, e.dataset.revoke!)));
  b.querySelectorAll<HTMLElement>('[data-bp]').forEach(e => e.addEventListener('click', () => {
    const [cls, mod] = e.dataset.bp!.split(':');
    blueprint(g, cls, mod);
  }));
}

function research(g: GameScreen, id: string) {
  if (!g.canPlan || g.you === null) return;
  const t = TECH[id];
  const inf = techInfo(g, g.you, t);
  if (inf.s !== 'avail') { toast(`Can't: ${inf.why}`); return; }
  if (g.live) {
    g.src.liveFree?.({ type: 'research', tech: id });
    toast(`${t.icon} Researching ${t.name}: bought at the next tick.`);
  } else {
    const prev = pendingResearch(g);
    g.plan.free = g.plan.free.filter(x => x.type !== 'research');
    g.plan.free.push({ type: 'research', tech: id });
    g.savePlan();
    toast(`${t.icon} ${t.name} queued${prev ? ` (instead of ${TECH[prev]?.name})` : ''}: bought when the turn resolves.`);
  }
  g.renderAll();
}
function unresearch(g: GameScreen) {
  if (!g.canPlan || g.live) return;
  g.plan.free = g.plan.free.filter(x => x.type !== 'research');
  g.savePlan();
  g.renderAll();
}
function enact(g: GameScreen, id: string) {
  if (!g.canPlan) return;
  g.addOrder({ type: 'law', law: id });
}
function unlaw(g: GameScreen, id: string) {
  const k = pendingLaw(g, id);
  if (k === null) return;
  if (g.live) g.src.liveCancel?.(k);
  else { g.plan.orders[k] = null; g.savePlan(); }
  g.renderAll();
}
function revoke(g: GameScreen, id: string) {
  if (!g.canPlan) return;
  if (g.live && !confirm(`Revoke ${LAW[id].name}? It takes effect at the next tick, and enacting it again costs an order.`)) return;
  g.pushFree({ type: 'revoke', law: id });
  toast(`${LAW[id].icon} ${LAW[id].name} will be revoked ${g.live ? 'at the next tick' : 'when the turn resolves'}.`);
  g.renderAll();
}
function blueprint(g: GameScreen, cls: string, mod: string) {
  if (!g.canPlan || g.you === null) return;
  const st = g.st, name = st.rules.ships[cls]?.name ?? cls, m = MODULE[mod];
  if (g.live) g.src.liveFree?.({ type: 'blueprint', cls, mod });
  else {
    g.plan.free = g.plan.free.filter(x => !(x.type === 'blueprint' && x.cls === cls));
    if (mod !== blueprintFor(st, g.you, cls)) g.plan.free.push({ type: 'blueprint', cls, mod });
    g.savePlan();
  }
  toast(`${m.icon} New ${name}s get ${m.name}${g.live ? ' from the next tick' : ' from this turn'}.`);
  g.renderAll();
}

/** A short line for the Orders tab's "Free changes" list. */
export function empireFreeText(fa: FreeAction, shipName: (cls: string) => string): string | null {
  if (fa.type === 'research') return `${TECH[fa.tech]?.icon ?? '⚗'} Research ${TECH[fa.tech]?.name ?? fa.tech}`;
  if (fa.type === 'revoke') return `${LAW[fa.law]?.icon ?? '⚑'} Revoke ${LAW[fa.law]?.name ?? fa.law}`;
  if (fa.type === 'blueprint') return `${MODULE[fa.mod]?.icon ?? '▣'} New ${shipName(fa.cls)}s get ${MODULE[fa.mod]?.name ?? fa.mod}`;
  return null;
}

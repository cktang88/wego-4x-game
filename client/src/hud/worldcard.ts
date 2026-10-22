// The world card v3 (docs/WORLD-CARD.md): a painted card per world. Its face says what the world is (the diorama,
// the role as the frame, the name, the epithet, the Calling as the title line) and what it gives (citizens, one yield
// line). Three verbs sit in the same slots on every world: Raise (hulls, into which fleet), Improve (four tracks, one
// button each) and Story (bodies, deeds, ledger, chronicle). A Gambit appears only when something threatens the
// world; one-time decisions (a Calling, terms, raze or keep, a purge) take over the face for the turn they matter.
// A rival's, a neutral or a fogged world shows the same face, read-only, with what you can do to it.
import type { GameScreen } from '../game.ts';
import type { Order, Region } from '../../../shared/sim/types.ts';
import type { Res } from '../../../shared/config/rules.ts';
import { orderCost, canAfford } from '../../../shared/sim/orders.ts';
import { creditRate, flipThreshold, regionYield } from '../../../shared/sim/resolve.ts';
import { blueprintFor, classBlock, connected } from '../../../shared/sim/empire.ts';
import { fleetPower } from '../../../shared/sim/graph.ts';
import { maxGarrison } from '../../../shared/sim/setup.ts';
import { MODULE } from '../../../shared/config/empire.ts';
import { SY, sysOn, systemCostMult, trackCap, trackUsed, slotsCut, TRACK_MEMBERS, type Track } from '../../../shared/sim/systems.ts';
import { nextInTrack, trackMembers, TRACKS } from '../../../shared/sim/tracks.ts';
import { esc } from '../ui/dom.ts';
import { roman } from '../ui/dom.ts';
import { tip, shortWhy } from './util.ts';
import { ic, icFor } from '../art/icons.ts';
import { bannerSvg } from '../art/sigils.ts';
import { sysArt, sysLine, garrisonPlate, ribbon, faceYield, storyBodies, termsPrompt, termsOffer, growthLine } from './systems.ts';
import { epithetOf, callingLine, callingPrompt, razePrompt, purgePrompt, storyWorld, bannersLeft } from './soul.ts';
import { worldGambit } from './signature.ts';
import { suggestAt, warmSuggestions } from './suggest.ts';
import { seizeOptions } from './card.ts';

// ------------------------------------------------------------------ per-world UI state (kept across re-renders)
export type WorldTab = 'raise' | 'improve' | 'story';
const worldTab = new Map<number, WorldTab>();
let lockOpen = -1;
let trkOpen = '';
/** Which fleet a build at r goes into: a fleet already here, or a new banner (the founding sheet). Per region. */
const intoChoice = new Map<number, number | 'new'>();

export function setWorldTab(rid: number, t: WorldTab) { worldTab.set(rid, t); }
export function toggleLocks(rid: number) { lockOpen = lockOpen === rid ? -1 : rid; }
export function toggleTrack(rid: number, t: string) { const k = `${rid}:${t}`; trkOpen = trkOpen === k ? '' : k; }

/** Raise at a yard world with an order to give; otherwise Improve. The last choice per world wins for the session. */
export function tabOf(g: GameScreen, r: Region): WorldTab {
  const t = worldTab.get(r.id);
  if (t) return t;
  return (r.buildings.shipyard ?? 0) > 0 && g.canPlan && !g.orderBlock() ? 'raise' : 'improve';
}

// ------------------------------------------------------------------ small pieces
const RES_IC: Record<string, string> = { industry: 'industry', credits: 'credits', influence: 'influence' };
/** A price as icon + number pairs; `short` reddens it (can't afford this turn); `was` strikes the undiscounted one. */
export function priceHtml(c: Partial<Res>, short = false, was?: Partial<Res>): string {
  const parts = (['industry', 'credits', 'influence'] as const).filter(k => (c[k] ?? 0) > 0).map(k => {
    const old = was && (was[k] ?? 0) > (c[k] ?? 0) ? `<s>${was[k]}</s>` : '';
    return `<span class="pr">${ic(RES_IC[k])}${old}${c[k]}</span>`;
  });
  return `<span class="price${short ? ' short' : ''}">${parts.join('') || 'free'}</span>`;
}
function purse(g: GameScreen): Res {
  const p = g.st.players[g.you!].res;
  if (g.live) return p;
  const sp = g.plannedSpend();
  return { industry: p.industry - sp.industry, credits: p.credits - sp.credits, influence: p.influence - sp.influence };
}
const isShort = (g: GameScreen, c: Partial<Res>) => !canAfford(purse(g), c, creditRate(g.st, g.you!));
/** Rule-engine reasons → the few words that fit on a button. */
export function why3(t: string | null | undefined): string {
  if (!t) return '';
  const s = t.replace(/\.$/, '');
  let m: RegExpExecArray | null;
  if ((m = /^needs (.+?)(?: \(|$)/i.exec(s))) return `needs ${m[1]}`;
  if ((m = /needs (\d+) citizens/i.exec(s))) return `needs ${m[1]} citizens`;
  if (/already underway/i.test(s)) return 'busy';
  if (/no Works site/i.test(s)) return 'no site left';
  if (/track full/i.test(s)) return 'track full';
  if (/no free civil slot/i.test(s)) return 'no civil slot';
  if (/no free military slot/i.test(s)) return 'no military slot';
  if (/citizens at the cap/i.test(s)) return 'at the cap';
  if (/no belt, barren world or vein/i.test(s)) return 'no mine site';
  if (/trade hub needs/i.test(s)) return 'no trade site';
  if (/no surface/i.test(s)) return 'no surface';
  if (/all \d+ orders are used/i.test(s)) return 'no order free';
  if (/no orders banked/i.test(s)) return 'no order banked';
  if (/sealed/i.test(s)) return 'sealed';
  if (/spectating/i.test(s)) return 'watching';
  return shortWhy(s);
}

// ------------------------------------------------------------------ the face
function head(g: GameScreen, r: Region): string {
  const st = g.st;
  const seat = r.owner !== null && r.owner >= 0 && st.players[r.owner]?.capital === r.id;
  const cap = sysOn(st) && r.bodies && r.dev >= 0 ? Math.max(citizenCapOf(g, r), r.dev) : 0;
  const grows = r.owner === g.you && cap > r.dev && growthLine(g, r).next.startsWith('+1');
  const pips = r.kind === 'lane' || r.kind === 'void' ? '' : cap
    ? `<span class="wc-cit" role="img" aria-label="Citizens ${r.dev} of ${cap}"${tip(`Citizens ${r.dev}/${cap}: the cap comes from the bodies and the star`)}>${Array.from({ length: cap }, (_, i) => `<i class="${i < r.dev ? 'on' : i === r.dev && grows ? 'next' : ''}"></i>`).join('')}</span>`
    : r.dev > 0 && r.dev < 9 ? `<span class="wc-cit" role="img" aria-label="Development ${r.dev}">${Array.from({ length: r.dev }, () => '<i class="on"></i>').join('')}</span>` : '';
  const epi = epithetOf(g, r), line = sysLine(g, r);
  return `<div class="wc-head"><div class="wc-name" style="--pc:${esc(g.color(r.owner))}"><span>${esc(r.name)}</span>${seat ? `<i class="seat"${tip('Capital')}>${ic('crown')}</i>` : ''}</div>${pips}${epi || line ? `<div class="wc-epi">${epi ? `<em>${esc(epi)}</em>` : ''}${epi && line ? ' · ' : ''}${line ? `<span class="sys">${esc(line)}</span>` : ''}</div>` : ''}</div>`;
}
function citizenCapOf(g: GameScreen, r: Region): number {
  // the same cap the sim uses (bodies + star + a built Station)
  const Y = SY(g.st);
  const h = r.bodies?.find(b => b.kind === 'habitable');
  let cap = 0;
  if (h) {
    let hc = Y.capHabitable[h.q ?? 'fair'] ?? 0;
    if (r.star === 'yellow') hc += Y.capYellow;
    if (r.star === 'red') hc += Y.capRed;
    if (r.star === 'blue') hc = Math.min(hc, Y.blueHabitableMax);
    cap += Math.max(0, hc) + (r.bodies ?? []).filter(b => b.kind === 'moon').length * Y.capMoon;
  }
  cap += (r.bodies ?? []).filter(b => b.kind === 'barren').length * Y.capBarren;
  if ((r.buildings.station ?? 0) > 0) cap += Y.capStation;
  return Math.max(0, Math.min(Y.maxCitizens, cap));
}
function yieldLine(g: GameScreen, r: Region): string {
  const y = faceYield(g, r);
  if (!y) return '';
  return `<div class="wc-yield"${tip('Yield per turn')}><span>${ic('industry')}<b>${y.i}</b></span><span>${ic('credits')}<b>${y.c}</b></span><span>${ic('influence')}<b>${y.f}</b></span><small class="${y.lost ? 'lost' : ''}">${esc(y.note)}</small></div>`;
}
function tabs(g: GameScreen, r: Region, cur: WorldTab): string {
  const yard = (r.buildings.shipyard ?? 0) > 0;
  const busy = !!r.project;
  const T: [WorldTab, string, string][] = [['raise', 'move', 'Raise'], ['improve', 'develop', 'Improve'], ['story', 'chronicle', 'Story']];
  return `<nav class="wc-tabs n3" role="tablist">${T.map(([k, icon, label]) => `<button role="tab" class="${cur === k ? 'on' : ''}${k === 'raise' && !yard ? ' off' : ''}" data-a="tab" data-t="${k}" aria-selected="${cur === k}">${ic(icon)}<span>${label}</span>${k === 'improve' && busy ? `<i class="dot"${tip('A project is underway')}></i>` : ''}</button>`).join('')}</nav>`;
}

// ------------------------------------------------------------------ the suggested action (PC gold edge; phone peek button)
interface Primary { order: Order; label: string; icon: string; cost: Partial<Res>; sug: boolean; cls?: string }
function primaryOf(g: GameScreen, r: Region): Primary | null {
  if (!g.canPlan || g.you === null || g.orderBlock()) return null;
  const st = g.st;
  const s = suggestAt(g, r.id);
  if (s?.type === 'build') return { order: s, label: `Raise a ${st.rules.ships[s.cls]?.name ?? s.cls}`, icon: '', cost: orderCost(g.costState(), { ...s, fleet: null }, g.you), sug: true, cls: s.cls };
  if (s?.type === 'develop') { const t = trackOf2(s.project); return { order: s, label: `${t ? `${cap1(t)}: ` : ''}${memberLabel(g, r, s.project)}`, icon: ic(icFor('structure', s.project)), cost: orderCost(g.costState(), s, g.you), sug: true }; }
  // no suggestion: the cheapest hull this yard can raise, else the first track that can move
  if ((r.buildings.shipyard ?? 0) > 0) {
    const ps = g.projectedState(g.nextSlot() ?? 0);
    const legal = Object.entries(st.rules.ships).filter(([k, d]) => !classBlock(ps, g.you!, k) && (r.buildings.shipyard ?? 0) >= d.needsShipyard)
      .sort((a, b) => (a[1].cost.industry ?? 0) - (b[1].cost.industry ?? 0));
    const k = legal.find(([k]) => k !== 'scout')?.[0] ?? legal[0]?.[0];
    if (k) { const o: Order = { type: 'build', region: r.id, cls: k, fleet: null }; return { order: o, label: `Raise a ${st.rules.ships[k].name}`, icon: '', cost: orderCost(g.costState(), o, g.you), sug: false, cls: k }; }
  }
  for (const t of TRACKS) {
    const p = nextInTrack(g.projectedState(g.nextSlot() ?? 0), g.you, r, t);
    if (p.order && !g.orderWhy(p.order)) return { order: p.order, label: `${cap1(t)}: ${memberLabel(g, r, p.key!)}`, icon: ic(icFor('structure', p.key!)), cost: orderCost(g.costState(), p.order, g.you), sug: false };
  }
  return null;
}
const cap1 = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const trackOf2 = (k: string): Track | null => (TRACKS as readonly Track[]).find(t => TRACK_MEMBERS[t].includes(k)) ?? (k === 'develop' ? 'works' : null);
/** The phone peek's one big button. */
function primaryButton(g: GameScreen, r: Region): string {
  const p = primaryOf(g, r);
  if (!p) return '';
  const mini = p.cls ? `<canvas data-mini data-bare data-cls="${esc(p.cls)}" data-owner="${g.you}" data-team="${esc(g.color(g.you))}" aria-hidden="true"></canvas>` : p.icon;
  const data = p.order.type === 'build' ? `data-a="build" data-cls="${esc(p.order.cls)}"` : p.order.type === 'develop' ? `data-a="develop" data-proj="${esc(p.order.project)}"` : '';
  return `<button class="primary k-btn primary" ${data}>${mini}<span>${esc(p.label)}</span>${priceHtml(p.cost, isShort(g, p.cost))}${p.sug ? '<em>suggested</em>' : ''}</button>`;
}

// ------------------------------------------------------------------ RAISE
function intoOf(g: GameScreen, r: Region): number | 'new' {
  const js = joinable(g, r);
  const c = intoChoice.get(r.id);
  if (c === 'new') return 'new';
  if (c !== undefined && js.some(f => f.id === c)) return c;
  return js.find(f => f.banner)?.id ?? js[0]?.id ?? 'new';
}
export function joinable(g: GameScreen, r: Region) {
  const pos = g.projected(g.nextSlot() ?? 0);
  return g.st.fleets.filter(x => x.owner === g.you && pos.get(x.id) === r.id && x.ships.length && x.ships.length < g.st.rules.maxShipsPerFleet && x.bornTurn !== g.st.turn);
}
/** The Into selector: tap to step through the fleets here and a new banner. */
export function intoNext(g: GameScreen, rid: number) {
  const r = g.st.regions[rid];
  const opts: (number | 'new')[] = [...joinable(g, r).map(f => f.id), 'new'];
  const i = opts.indexOf(intoOf(g, r));
  intoChoice.set(rid, opts[(i + 1) % opts.length]);
}
export const buildInto = (g: GameScreen, r: Region) => intoOf(g, r);
function intoSelect(g: GameScreen, r: Region): string {
  const js = joinable(g, r), cur = intoOf(g, r), left = bannersLeft(g, r.id);
  const f = cur === 'new' ? null : g.fleet(cur);
  const label = f ? `${f.banner ? bannerSvg(f.banner.sigil, g.color(f.owner), 18) : ic('ships')}<span>${esc(f.name.replace(/^The /, ''))}</span><small>${f.ships.length}/${g.st.rules.maxShipsPerFleet}</small>`
    : `${ic('banner')}<span>New banner</span><small class="${left.free <= 0 ? 'bad' : ''}">${Math.max(0, left.free)} left</small>`;
  const others = js.filter(x => x.id !== cur).length;
  const alt = cur === 'new' ? (js.length ? `or join ${js.length} fleet${js.length > 1 ? 's' : ''} here` : 'scouts alone form a picket') : `or ${others ? `${others} other fleet${others > 1 ? 's' : ''} · ` : ''}new banner (${Math.max(0, left.free)} left)`;
  const many = js.length > 0;
  return `<div class="into"><span class="into-lbl">Into</span><button class="sel" data-a="intonext"${many ? tip('Tap: the next fleet here, or a new banner') : ' aria-disabled="true"'} aria-label="Build into: ${esc(f?.name ?? 'a new banner')}">${label}${many ? ic('caret') : ''}</button><span class="into-alt">${esc(alt)}</span></div>`;
}
function raiseTab(g: GameScreen, r: Region): string {
  const st = g.st, R = st.rules, you = g.you!;
  const yard = r.buildings.shipyard ?? 0;
  if (!yard) {
    const ps = g.projectedState(g.nextSlot() ?? 0);
    const p = nextInTrack(ps, you, r, 'yard');
    const o: Order = { type: 'develop', region: r.id, project: 'shipyard' };
    const queued = queuedIdx(g, r, 'shipyard') >= 0 || r.project?.key === 'shipyard';
    const why = queued ? null : !g.canPlan ? (g.planBlock() ?? 'watching') : g.orderWhy(o) ?? p.why;
    const c = orderCost(g.costState(), o, you);
    const reason = /citizens/.test(why ?? '') ? `${esc(r.name)} has ${r.dev} citizen${r.dev === 1 ? '' : 's'}; a Yard needs ${SY(st).shipyardCitizens}.` : `${esc(r.name)} has ${r.dev} citizen${r.dev === 1 ? '' : 's'}: enough for one.`;
    return `<div class="teach">${ic('shipyard')}<div><b>No yard here.</b><span>Ships are raised at a Yard. ${reason}</span></div></div>
      <button class="go wide${why ? ' why' : ' sug'}" data-a="track" data-track="yard"${why ? ` aria-disabled="true"${tip(`⊘ ${shortWhy(why)}`)}` : ''}><b>${ic('develop')} ${queued ? 'Yard I queued' : 'Build Yard I'}</b><small>${why ? esc(why3(why)) : `${priceHtml(c, isShort(g, c))} · 1 order`}</small></button>`;
  }
  const block = g.canPlan ? g.orderBlock() : g.planBlock() ?? 'watching';
  const ps = g.projectedState(g.nextSlot() ?? 0);
  const sug = suggestAt(g, r.id);
  const into = intoOf(g, r);
  const legal: string[] = [], locked: { k: string; why: string; yard: number }[] = [];
  for (const [k, d] of Object.entries(R.ships)) {
    const cb = classBlock(ps, you, k);
    if (!cb && yard >= d.needsShipyard) legal.push(k);
    else locked.push({ k, why: [yard < d.needsShipyard ? `Yard ${roman(d.needsShipyard)}` : '', cb ? cb.replace(/^needs /, '') : ''].filter(Boolean).join(' · '), yard: d.needsShipyard });
  }
  const tiles = legal.map(k => {
    const d = R.ships[k];
    const o: Order = { type: 'build', region: r.id, cls: k, fleet: into === 'new' ? null : into };
    const c = orderCost(g.costState(), o, you);
    const short = isShort(g, c);
    const isSug = sug?.type === 'build' && sug.cls === k;
    return `<button class="hull${isSug ? ' sug' : ''}${short ? ' short' : ''}" data-a="build" data-cls="${k}" data-peek="hull:${r.id}:${k}"${block ? ` aria-disabled="true"${tip(`⊘ ${shortWhy(block)}`)}` : ''} aria-label="${esc(`Raise a ${d.name}`)}">${isSug ? '<i class="sugtag">Suggested</i>' : ''}<canvas data-mini data-bare data-cls="${k}" data-owner="${you}" data-team="${esc(g.color(you))}" aria-hidden="true"></canvas><b>${esc(d.name)}</b>${priceHtml(c, short)}</button>`;
  }).join('');
  let locks = '';
  if (locked.length) {
    const minYard = Math.min(...locked.map(x => x.yard).filter(y => y > yard), 99);
    const first = locked[0];
    const go = minYard < 99 ? `<button class="lk-go" data-a="tab" data-t="improve">Yard ${roman(minYard)} ›</button>` : /Cruiser|Dread|Bombard|research|Doctrine|Strike|Yards/i.test(first.why) ? `<button class="lk-go" data-a="research">Research ›</button>` : '';
    if (lockOpen === r.id) {
      locks = `<div class="locks"><button class="lx open" data-a="lockx" aria-expanded="true">${ic('lock')}<span>${locked.length} more hull${locked.length > 1 ? 's' : ''}</span>${ic('caret')}</button>${locked.map(x => `<div class="lk"><canvas data-mini data-bare data-cls="${x.k}" data-owner="${you}" data-team="#6d6f78" aria-hidden="true"></canvas><b>${esc(R.ships[x.k].name)}</b><span>needs ${esc(x.why)}</span>${x.yard > yard ? `<button class="lk-go" data-a="tab" data-t="improve">Yard ${roman(x.yard)} ›</button>` : ''}</div>`).join('')}</div>`;
    } else {
      locks = `<div class="lockline"><button class="lx" data-a="lockx" aria-expanded="false">${ic('lock')}<span class="ghosts">${locked.slice(0, 3).map(x => `<canvas data-mini data-bare data-cls="${x.k}" data-owner="${you}" data-team="#6d6f78" aria-hidden="true"></canvas>`).join('')}</span><span>${locked.length} more hull${locked.length > 1 ? 's' : ''}</span></button>${go}</div>`;
    }
  }
  return `<div data-tray="build">${intoSelect(g, r)}<div class="hulls tiles n${Math.min(3, legal.length) || 1}">${tiles}</div>${locks}</div>`;
}
export function hullPeek(g: GameScreen, key: string): string | null {
  const [, rs, k] = key.split(':');
  const d = g.st.rules.ships[k];
  if (!d || g.you === null) return null;
  const r = g.st.regions[Number(rs)];
  const ps = g.projectedState(g.nextSlot() ?? 0);
  const m = g.st.rules.empire?.enabled !== false ? MODULE[blueprintFor(ps, g.you, k) ?? 'armor'] : null;
  const into = r ? intoOf(g, r) : 'new';
  const f = into === 'new' ? null : g.fleet(into);
  const s = r ? suggestAt(g, r.id) : null;
  return `<b>${esc(d.name)}</b><p class="stats">${ic('attack')}${d.attack * d.shots} ${ic('hull')}${d.hp} ${ic('shield')}${d.shields} ${ic('speed')}${d.speed}</p><p>${m ? `${esc(m.name)} · ` : ''}${f ? `joins ${esc(f.name)} (${f.ships.length}/${g.st.rules.maxShipsPerFleet})` : k === 'scout' ? 'forms a picket' : 'raises a new banner'}</p>${s?.type === 'build' && s.cls === k ? '<p class="gain">Suggested by the planner for this turn</p>' : ''}`;
}

// ------------------------------------------------------------------ IMPROVE
const TRACK_ICON: Record<Track, string> = { works: 'mine', yard: 'shipyard', walls: 'fortress', outpost: 'depot' };
const TRACK_NAME: Record<Track, string> = { works: 'Works', yard: 'Yard', walls: 'Walls', outpost: 'Outpost' };
/** What a member's next level is called on its button ("Mine II", "+1 Citizen", "Yard II", "Battery"). */
export function memberLabel(g: GameScreen, r: Region, k: string, to?: number): string {
  if (k === 'develop') return '+1 Citizen';
  const P = g.st.rules.projects[k];
  const lv = (to ?? (r.buildings[k] ?? 0) + 1);
  const name = k === 'shipyard' ? 'Yard' : k === 'pshield' ? 'Shield' : k === 'tradehub' ? 'Trade Hub' : k === 'gate' ? 'Warp Gate' : k === 'sensor' ? 'Sensor' : P?.name ?? k;
  return (P?.max ?? 1) > 1 ? `${name} ${roman(lv)}` : name;
}
const queuedIdx = (g: GameScreen, r: Region, k: string) => (g.live ? g.queue : g.plan.orders).findIndex(o => !!o && o.type === 'develop' && o.region === r.id && o.project === k);
function trackSub(g: GameScreen, r: Region, t: Track, next: string | null): string {
  const st = g.st;
  const built = TRACK_MEMBERS[t].filter(k => (r.buildings[k] ?? 0) > 0).map(k => memberLabel(g, r, k, r.buildings[k]));
  switch (t) {
    case 'works': {
      if (built.length) return built.join(' · ');
      const site = r.bodies?.find(b => b.kind === 'belt' || b.kind === 'barren') ?? r.bodies?.find(b => b.kind === 'habitable' || b.kind === 'gas');
      return next ? `${next === 'develop' ? 'a new citizen' : memberLabel(g, r, next).replace(/ I$/, '')}${site && next !== 'develop' ? ` on ${site.name}` : ''}` : 'nothing to work here';
    }
    case 'yard': {
      const yard = r.buildings.shipyard ?? 0;
      if (!yard) return 'no yard yet';
      const ok = Object.values(st.rules.ships).filter(d => d.needsShipyard <= yard).map(d => `${d.name}s`);
      return ok.join(', ');
    }
    case 'walls': {
      const max = r.owner !== null ? maxGarrison(st, r.id) : 0;
      const regen = st.rules.garrison.regenPerTurn;
      return `garrison ${Math.max(0, r.garrison)}${r.garrison < max ? `/${max}` : ''} · rebuilds +${regen}`;
    }
    case 'outpost': return built.length ? built.join(' · ') : 'supply · sight · gate';
  }
}
function trackRow(g: GameScreen, r: Region, t: Track, sug: Order | null): string {
  const st = g.st, you = g.you!;
  const ps = g.projectedState(g.nextSlot() ?? 0);
  let pick = nextInTrack(ps, you, r, t);
  const members = TRACK_MEMBERS[t];
  // the planner's suggestion wins the track's button when it is one of this track's members (a Core's +1 citizen too)
  if (sug?.type === 'develop' && sug.region === r.id && trackOf2(sug.project) === t && sug.project !== pick.key) {
    pick = { key: sug.project, to: (sug.project === 'develop' ? r.dev : r.buildings[sug.project] ?? 0) + 1, why: null, order: sug };
  }
  // levels: Yard = its level of 3; the others = kinds built of the track's cap here (the old rules: of 3)
  const lv = t === 'yard' ? r.buildings.shipyard ?? 0 : trackUsed(r, t);
  const max = t === 'yard' ? 3 : slotsCut(st) && sysOn(st) && r.bodies ? Math.max(lv, trackCap(st, r, t)) : Math.max(lv, 3);
  const pips = `<span class="lv" role="img" aria-label="${lv} of ${max}">${Array.from({ length: max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</span>`;
  const inProg = r.project && members.includes(r.project.key) ? r.project : r.project?.key === 'develop' && t === 'works' ? r.project : null;
  const qk = members.concat(t === 'works' ? ['develop', 'station'] : []).find(k => queuedIdx(g, r, k) >= 0);
  let go: string;
  if (inProg) {
    const P = st.rules.projects[inProg.key];
    const left = Math.max(1, (P?.turns ?? 1) - inProg.progress);
    go = `<span class="go max busy"><b>${esc(memberLabel(g, r, inProg.key))}</b><small>${left}t left</small></span>`;
  } else if (qk) {
    go = `<button class="go queued" data-a="unqueue" data-slot="${queuedIdx(g, r, qk)}"${g.canPlan && !g.live ? tip('Queued: tap to take it back') : ' aria-disabled="true"'}><b>${esc(memberLabel(g, r, qk))}</b><small>queued${g.canPlan && !g.live ? ' ↶' : ''}</small></button>`;
  } else if (!pick.key && pick.why === 'max') {
    go = `<span class="go max"><b>${ic('check')} max</b></span>`;
  } else {
    const why = !g.canPlan ? g.planBlock() ?? 'watching' : pick.order ? g.orderWhy(pick.order) : pick.why;
    const k = pick.key!;
    const o: Order = { type: 'develop', region: r.id, project: k };
    if (why) {
      const w = why3(why);
      const [a, b] = /^needs /.test(w) ? ['needs', w.slice(6)] : [memberLabel(g, r, k), w];
      go = `<button class="go why" data-a="track" data-track="${t}" aria-disabled="true"${tip(`⊘ ${why}`)}><b>${esc(a)}</b><small>${esc(b)}</small></button>`;
    } else {
      const c = orderCost(g.costState(), o, you);
      const was = systemCostMult(st, r, k) < 1 ? st.rules.projects[k]?.cost : undefined;
      const isSug = sug?.type === 'develop' && sug.project === k;
      const pct = Math.round((1 - systemCostMult(st, r, k)) * 100);
      go = `<button class="go${isSug ? ' sug' : ''}" data-a="track" data-track="${t}" data-proj="${k}" data-peek="trk:${r.id}:${t}"${was ? tip(`Waystation: ${pct}% off military and logistics`) : ''}><b>${esc(memberLabel(g, r, k))}</b><small>${was ? `<i class="disc">−${pct}%</i>` : ''}${priceHtml(c, isShort(g, c), was)}</small></button>`;
    }
  }
  const dim = !inProg && !qk && pick.why && pick.why !== 'max' && /^needs /.test(why3(pick.why)) && lv === 0;
  const open = trkOpen === `${r.id}:${t}`;
  let list = '';
  if (open) {
    list = `<div class="members">${trackMembers(st, r, t).map(m => {
      const o: Order = { type: 'develop', region: r.id, project: m.key };
      const done = m.lvl >= m.max;
      const why = done ? null : !g.canPlan ? g.planBlock() ?? 'watching' : g.orderWhy(o);
      const c = orderCost(g.costState(), o, you);
      const name = m.key === 'develop' ? 'Citizen' : st.rules.projects[m.key]?.name ?? m.key;
      return `<button class="mem" data-a="develop" data-proj="${m.key}"${done || why ? ` aria-disabled="true"${tip(done ? `${name}: at its top level` : `⊘ ${why}`)}` : tip(st.rules.projects[m.key]?.desc ?? '')}>${ic(icFor('structure', m.key))}<b>${esc(name)}</b><small>${m.lvl}/${m.max}</small><span>${done ? ic('check') : why ? esc(why3(why)) : priceHtml(c, isShort(g, c))}</span></button>`;
    }).join('')}</div>`;
  }
  return `<div class="trk${dim ? ' dim' : ''}${open ? ' open' : ''}"><button class="trn" data-a="trkx" data-track="${t}" aria-expanded="${open}" aria-label="${TRACK_NAME[t]}: its buildings">${ic(TRACK_ICON[t])}<span><b>${TRACK_NAME[t]}${pips}</b><small>${esc(trackSub(g, r, t, pick.key))}</small></span></button>${go}${list}</div>`;
}
function improveTab(g: GameScreen, r: Region): string {
  const st = g.st;
  const sug = suggestAt(g, r.id);
  let cit = '';
  if (sysOn(st) && r.bodies && r.kind !== 'void') {
    const gl = growthLine(g, r), cap = citizenCapOf(g, r);
    const pips = `<span class="lv cit" role="img" aria-label="${r.dev} of ${cap}">${Array.from({ length: Math.max(cap, r.dev) }, (_, i) => `<i class="${i < r.dev ? 'on' : ''}"></i>`).join('')}</span>`;
    cit = `<div class="trk cit"><span class="trn">${ic('citizen')}<span><b>Citizens${pips}</b><small>${esc(gl.text)}</small></span></span><span class="auto${gl.next.startsWith('+') ? '' : ' dim'}">${esc(gl.next || '—')}</span></div>`;
  }
  return `<div class="tracks">${cit}${TRACKS.map(t => trackRow(g, r, t, sug)).join('')}</div><p class="foot-note">${ic('help')} Each upgrade is one order. Tap a track's name for all its buildings.</p>`;
}
export function trackPeek(g: GameScreen, key: string): string | null {
  const [, rs, t] = key.split(':');
  const r = g.st.regions[Number(rs)];
  if (!r || g.you === null) return null;
  const p = nextInTrack(g.projectedState(g.nextSlot() ?? 0), g.you, r, t as Track);
  if (!p.key) return null;
  const P = g.st.rules.projects[p.key];
  const c = orderCost(g.costState(), { type: 'develop', region: r.id, project: p.key }, g.you);
  const gain = p.key === 'mine' ? g.st.rules.economy.mineBonus : p.key === 'tradehub' ? g.st.rules.economy.tradeHubBonus : 0;
  const back = gain ? Math.ceil(((c.industry ?? 0) + (c.credits ?? 0)) / gain) : 0;
  return `<b>${TRACK_NAME[t as Track]} · ${esc(memberLabel(g, r, p.key))}</b><p>${esc(P?.desc ?? '')}</p>${gain ? `<p class="gain">+${gain}${p.key === 'mine' ? '⚙' : '¢'} a turn · pays back in ${back} turns</p>` : ''}<p class="d">${P?.turns ?? 1} turn${(P?.turns ?? 1) > 1 ? 's' : ''} to build</p>`;
}

// ------------------------------------------------------------------ the card: your world
export function ownWorld(g: GameScreen, r: Region, phone: boolean, snap: 'peek' | 'full'): string {
  warmSuggestions(g);
  const tab = tabOf(g, r);
  const rb = ribbon(g, r);
  const prompts = callingPrompt(g, r) + termsPrompt(g, r) + razePrompt(g, r) + purgePrompt(g, r, flipThreshold(g.st, r.id));
  const body = tab === 'raise' ? raiseTab(g, r) : tab === 'improve' ? improveTab(g, r) : `<div class="story">${storyBodies(g, r) ? `<section><h4>The system</h4>${storyBodies(g, r)}</section>` : ''}${storyWorld(g, r)}</div>`;
  const face = `${sysArt(g, r, { ribbon: rb, garrison: garrisonPlate(g, r) })}<div class="wc-face">${head(g, r)}${phone && snap === 'full' ? '' : callingLine(g, r)}${prompts}${yieldLine(g, r)}${phone && snap === 'peek' && !prompts ? primaryButton(g, r) : ''}</div>`;
  return `${face}${tabs(g, r, tab)}<div class="wc-body" data-tab="${tab}">${body}</div>${worldGambit(g, r)}`;
}

// ------------------------------------------------------------------ the card: someone else's world (or a fogged one)
export function foreignWorld(g: GameScreen, r: Region): string {
  const st = g.st, you = g.you;
  const fog = you !== null && !g.visibleSet().has(r.id) && r.owner !== you;
  const rb = ribbon(g, r, fog) ?? (r.owner === null && r.kind !== 'lane' ? { cls: 'dim' as const, html: r.kind === 'void' ? 'the void' : `neutral${r.garrison >= 0 ? ` · garrison ${r.garrison}` : ''}` } : null);
  let body = '';
  const intrigue = (list: string[]) => `<div class="intrigue">${list.join('')}</div>`;
  const ib = (a: string, icon: string, label: string, o: Order | null, sub: string) => {
    const why = !g.canPlan ? g.planBlock() ?? 'watching' : o ? g.orderWhy(o) : null;
    return `<button data-a="${a}"${why ? ` aria-disabled="true"${tip(`⊘ ${shortWhy(why)}`)}` : ''}>${ic(icFor('order', icon))}<span>${label}</span><small>${esc(why ? why3(why) : sub)}</small></button>`;
  };
  const cost = (o: Order) => { const c = you !== null ? orderCost(st, o, you) : {}; return (c.influence ? `✦${c.influence}` : '') || (c.credits ? `¢${c.credits}` : '') || 'free'; };
  if (you !== null) {
    if (!fog) {
      const opts = g.canPlan ? seizeOptions(g, r) : [];
      body += opts.map((it, i) => {
        const f = g.fleet(it.join?.fleet ?? (it.order as { fleet?: number } | undefined)?.fleet ?? -1);
        const pct = Math.round((it.odds ?? 0) * 100);
        const tone = pct >= 65 ? 'good' : pct >= 40 ? 'warn' : 'bad';
        const pow = f ? fleetPower(st, f) : 0;
        return `<button class="odds ${tone}" data-a="seizewith" data-with="${f?.id ?? -1}">${ic('seize')}<span class="nm">${i ? 'with' : 'Seize with'} ${esc(f ? f.name.replace(/^The /, '') : 'fleet')}<small>${ic('attack')}${pow} vs ${ic('garrison')}${Math.max(0, r.garrison)} · ${it.path.length > 1 ? `${it.path.length} steps` : 'arrives this turn'}</small></span><b class="p">${pct}%</b><span class="bar"><i style="width:${pct}%"></i></span></button>`;
      }).join('');
      // what taking it would give you
      if (r.kind !== 'lane' && r.kind !== 'void') {
        let y = null;
        try { const conn = new Set(connected(st, you)); conn.add(r.id); y = regionYield(st, you, { ...r, owner: you }, conn, undefined, false); } catch { y = null; }
        if (y) body += `<p class="gainline">Taking it gives <b>${ic('industry')}${Math.round(y.industry)} ${ic('credits')}${Math.round(y.credits)}</b>${sysOn(st) ? ` · occupied ${SY(st).occupiedTurns} turns at ½` : ''}</p>`;
      }
      body += termsOffer(g, r);
      const isPlayer = r.owner !== null && r.owner >= 0 && r.owner !== you;
      body += intrigue([
        r.kind !== 'void' && r.kind !== 'lane' ? ib('influence', 'influence', 'Sway', { type: 'influence', target: r.id }, cost({ type: 'influence', target: r.id })) : '',
        ib('scan', 'scan', 'Scan', { type: 'scan', target: r.id }, cost({ type: 'scan', target: r.id })),
        ib('feint', 'feint', 'Feint', { type: 'feint', target: r.id }, cost({ type: 'feint', target: r.id })),
        isPlayer ? ib('pact', 'pact', 'Pact', { type: 'pact', with: r.owner! }, 'offer') : '',
      ].filter(Boolean));
    } else {
      body += `<p class="gainline">Out of sight: only the star, the bodies and the role are known.</p>`;
      body += intrigue([ib('scan', 'scan', 'Scan', { type: 'scan', target: r.id }, cost({ type: 'scan', target: r.id })), ib('feint', 'feint', 'Feint', { type: 'feint', target: r.id }, cost({ type: 'feint', target: r.id }))]);
    }
  }
  const foes = fog ? [] : st.fleets.filter(f => f.region === r.id && f.owner !== you && f.ships.length);
  const fl = foes.length ? `<div class="fan foe">${foes.map(f => `<button class="cls" data-a="fleet" data-id="${f.id}" aria-label="${esc(f.name)}"${tip(f.name)}>${f.banner ? bannerSvg(f.banner.sigil, g.color(f.owner), 18) : ic('ships')}<b>${ic('attack')}${fleetPower(st, f)}</b></button>`).join('')}</div>` : '';
  const y = !fog && r.owner !== null ? yieldLine(g, r) : '';
  return `${sysArt(g, r, { fog, ribbon: rb, garrison: garrisonPlate(g, r, fog) })}<div class="wc-face">${head(g, r)}${!fog ? callingLine(g, r) : ''}${y}</div><div class="wc-body foreign">${fl}${body}</div>`;
}


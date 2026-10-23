// The Soul layer on the HUD (docs/SOUL.md phase B): banners, ranks, boons and banes, scars, vows, honours and the
// saga on fleet cards; epithet, ledger, calling, tenure, deeds and razing on world cards; the founding ritual
// (sigil, name, boon/bane point-buy, optional vow) when a new banner is raised. Text budget (docs/UX-V2.md §6):
// icon + number, labels of at most 2 words, tooltips of at most 12 words; sentences only in the fleet record.
import type { GameScreen } from '../game.ts';
import type { FoundSpec, FreeAction, Fleet, Order, Region, VowKind } from '../../../shared/sim/types.ts';
import { BOONS, BANES, VOWS, SCARS, CALLINGS, DEEDS, SHIP_TRAITS, SIGILS } from '../../../shared/config/content.ts';
import { RANK_NAMES, SR, soulOn, foundingOffer, modsBlock, modPoints, boonsOf, vowBlock, vowText, razeBlock, tenureTier, tenureTurns, worldEpithet, limpRoute } from '../../../shared/sim/soul.ts';
import { TRAITS as CMD_TRAITS } from '../../../shared/config/content.ts';
import { fleetSpeed } from '../../../shared/sim/graph.ts';
import { orderCost, costText } from '../../../shared/sim/orders.ts';
import { esc, overlay, toast } from '../ui/dom.ts';
import { bannerSvg, sigilSvg } from '../art/sigils.ts';
import { tip, shortWhy } from './util.ts';
import { splitIds } from './card.ts';
import { iconizeDom, ic, icFor } from '../art/icons.ts';

// ------------------------------------------------------------------ short texts (≤ 6 words)
export const BOON_SHORT: Record<string, string> = {
  medics: 'Repairs anywhere in supply', ghosts: 'Unseen unless rivals are close', ambushers: 'Double first volley holding still',
  shock: 'Double first volley attacking', cleanbreak: 'Retreats without a parting volley', salvagers: '+3⚙ per enemy ship sunk',
  hunters: '+20% hit vs scarred, fleeing', iron: 'Forced out 3 rounds later', siegebreakers: '+2 siege damage',
  longrange: '+1 movement', beloved: '+1✦ a turn at home', raiders: 'Plunders ¢ from rival systems', inspiring: 'Garrison here rebuilds faster',
};
export const BANE_SHORT: Record<string, string> = {
  green: '−15% hit until first battle', hungry: '+2¢ upkeep a turn', slowrefit: 'Repairs only at shipyards',
  brittle: 'Retreats early, breaks sooner', conspicuous: 'Always visible to everyone', glass: 'Every hit does +1',
  homesick: '−1 attack far from home', grudgebound: 'Must attack its named rival', ponderous: '−1 movement',
  looselips: 'Movements always reported', reckless: 'Can never be evasive', gilded: 'Ships built into it +10¢',
};
export const VOW_SHORT: Record<string, string> = {
  throne: '+8% hit at the Throne', never_retreat: '+5% hit, never retreats', guard: '+5% hit guarding here',
  avenge: '+1 damage vs the target', relic: '+1 speed carrying a relic',
};
export const CALLING_SHORT: Record<string, string> = {
  arsenal: 'Ships built here cost less', granary: '+⚙ and +¢ each turn', bastion: 'Bigger garrison, rebuilds faster',
  refinery: '+¢ each turn', proving: 'New ships blood green commanders', oracle: '+sensor range from here',
  cenotaph: 'Fight harder, armoured garrison', bulwark: 'Less siege damage here',
};
export const SCAR_SHORT: Record<string, string> = {
  burned: '−15% hull, steadier outnumbered', grudge: '+1 damage vs its routers', skeleton: '−6% hit, half upkeep', haunted: '−1 speed, foes shaken',
};
const BEAT_ICON: Record<string, string> = {
  founded: '⚑', vow: '✠', vow_kept: '✦', vow_broken: '✗', vow_lapsed: '·', honour: '❖', legend: '★', rout: '⤺', home: '⌂',
  broken: '✝', destroyed: '✝', caught: '✝', loot: '¢', sulk: '⚡', merged: '+', retired: '⚑',
};
export const beatIcon = (k: string) => ic(icFor('beat', k, BEAT_ICON[k]));
const MARKS: [key: 'toil' | 'blood' | 'siege' | 'relic' | 'loss', icon: string, name: string][] = [
  ['toil', '⚒', 'Toil: turns developed'], ['blood', '⚔', 'Blood: battles fought'], ['siege', '⛨', 'Siege: attacks held off'], ['relic', '✧', 'Relic: relics found'], ['loss', '✝', 'Loss: memorials'],
];

const pill = (cls: string, inner: string, t: string, extra = '') => `<span class="sp ${cls}"${tip(t)}${extra}>${inner}</span>`;
export const rankName = (r: number) => RANK_NAMES[r] ?? `Rank ${r}`;
export function chevrons(rank: number): string {
  if (rank >= 5) return `<span class="chev legend"${tip('Legend')}>★</span>`;
  const n = Math.max(0, Math.min(4, rank - 1));
  return n ? `<span class="chev"${tip(rankName(rank))}>${'<i></i>'.repeat(n)}</span>` : '';
}
const on = (g: GameScreen) => soulOn(g.st);

// ------------------------------------------------------------------ plan helpers
/** Put a free action into the plan, replacing an earlier one that `same` matches (WEGO; LIVE dedupes itself). */
export function setFree(g: GameScreen, fa: FreeAction, same: (x: FreeAction) => boolean) {
  if (!g.canPlan) return;
  if (g.live) { g.src.liveFree?.(fa); g.renderAll(); return; }
  g.snapshot();
  g.plan.free = g.plan.free.filter(x => !same(x));
  g.plan.free.push(fa);
  g.savePlan();
  g.renderAll();
}
export function dropFree(g: GameScreen, same: (x: FreeAction) => boolean) {
  if (!g.canPlan || g.live) return;
  g.snapshot();
  g.plan.free = g.plan.free.filter(x => !same(x));
  g.savePlan();
  g.renderAll();
}
const pendingFree = <T extends FreeAction['type']>(g: GameScreen, type: T, pred: (x: Extract<FreeAction, { type: T }>) => boolean) =>
  g.myFree().find(x => x.type === type && pred(x as Extract<FreeAction, { type: T }>)) as Extract<FreeAction, { type: T }> | undefined;
const pendingOrderIdx = (g: GameScreen, pred: (o: Order) => boolean): number => {
  const list: (Order | null)[] = g.live ? g.queue : g.plan.orders;
  return list.findIndex(o => !!o && pred(o));
};

/** Banners you could still raise this turn: free banners minus foundings already in the plan. */
export function bannersLeft(g: GameScreen, region: number): { free: number; limit: number } {
  const st = g.st, you = g.you!;
  const off = foundingOffer(st, you, region);
  let used = 0;
  const list: (Order | null)[] = g.live ? g.queue : g.plan.orders;
  for (const o of list) if (o?.type === 'build' && o.fleet === null && (o.cls !== 'scout' || o.found)) used++;
  for (const fa of g.myFree()) if (fa.type === 'split') { const f = g.fleet(fa.fleet); if (fa.found || f?.ships.some(s => fa.ships.includes(s.id) && s.cls !== 'scout')) used++; }
  return { free: off.bannersFree - used, limit: off.bannerLimit };
}

// ------------------------------------------------------------------ fleet card
/** The banner badge for a card header (enamel shield with the sigil), or ''. */
export function fleetBadge(g: GameScreen, f: Fleet, size = 30): string {
  if (!on(g) || !f.banner) return '';
  return `<span class="bnr"${tip(`${SIGILS.find(s => s.id === f.banner!.sigil)?.name ?? ''} banner · ${rankName(f.commander.rank)}`)}>${bannerSvg(f.banner.sigil, g.color(f.owner), size, { rim: f.commander.rank >= 4 ? 'gold' : 'silver', broken: !!f.oathbreaker })}</span>`;
}
/** Epithets + rank chevrons under the name. */
export function fleetSubline(g: GameScreen, f: Fleet): string {
  if (!on(g) || f.owner < 0) return '';
  const ep = (f.epithets ?? []).slice(-2);
  const brand = f.oathbreaker ? `<span class="brand"${tip(`Broke: ${f.oathbreaker.vow}`)}>OATHBREAKER</span>` : '';
  const home = f.banner ? `<span class="home"${tip('Home world')}>⌂ ${esc(g.st.regions[f.banner.home]?.name ?? '?')}</span>` : `<span class="home"${tip('Scouts only: no banner')}>Picket</span>`;
  return `<div class="epi">${chevrons(f.commander.rank)}${ep.map(e => `<em>${esc(e)}</em>`).join('')}${brand}${home}</div>`;
}

/** Boons, honours, banes and scars as icon chips; the vow; limping; ship-trait summary. */
export function fleetSoulRows(g: GameScreen, f: Fleet): string {
  if (!on(g) || !f.banner) return f.limping ? limpRow(g, f) : '';
  const st = g.st;
  const chips: string[] = [];
  for (const b of f.banner.boons) chips.push(pill('boon', ic(icFor('boon', b, BOONS[b]?.icon)), `${BOONS[b]?.name}: ${BOON_SHORT[b] ?? ''}`));
  for (const h of f.honours ?? []) chips.push(pill('honour', ic(icFor('boon', h.id, BOONS[h.id]?.icon ?? '❖')), `Honour · ${BOONS[h.id]?.name}: ${BOON_SHORT[h.id] ?? ''}`));
  const haven = boonsOf(st, f).filter(b => !f.banner!.boons.includes(b) && !(f.honours ?? []).some(h => h.id === b));
  for (const b of haven) chips.push(pill('boon haven', ic(icFor('boon', b, BOONS[b]?.icon)), `Haven gift · ${BOONS[b]?.name}`));
  for (const b of f.banner.banes) chips.push(pill('bane', ic(icFor('bane', b, BANES[b]?.icon)), `${BANES[b]?.name}: ${BANE_SHORT[b] ?? ''}${b === 'grudgebound' && f.banner!.grudgeVs != null ? ` (${g.pname(f.banner!.grudgeVs)})` : ''}`));
  const scars = (f.scars ?? []).map(s => pill('scar', `<i class="notch"></i>${ic(icFor('scar', s.id, SCARS[s.id]?.icon))}`, `Scar · ${SCARS[s.id]?.name}: ${SCAR_SHORT[s.id] ?? ''}${s.vs != null && s.vs >= 0 ? ` (${g.pname(s.vs)})` : ''}`)).join('');
  const sulk = (f.sulkUntil ?? -1) >= st.turn ? pill('bane sulk', '⚡', 'Sulking: boons fail this turn') : '';
  let html = (chips.length || scars || sulk) ? `<div class="soulchips">${chips.join('')}${sulk}${scars ? `<span class="scars">${scars}</span>` : ''}</div>` : '';
  html += vowRow(g, f);
  if (f.limping) html += limpRow(g, f);
  return html;
}
function limpRow(g: GameScreen, f: Fleet): string {
  const st = g.st, L = f.limping!;
  const to = st.regions[L.to]?.name ?? '?';
  const rt = limpRoute(st, f);
  const n = f.route?.path.length ?? rt?.path.length ?? 0;
  const sp = Math.max(1, fleetSpeed(st, f));
  const eta = n ? `${Math.max(1, Math.ceil(n / sp))}${g.live ? '⏱' : 't'}` : 'here';
  return `<div class="soulrow limp"${tip('Limping home: cannot attack, dies if caught')}><i>${ic('limping')}</i><b>Limping</b><span>➤ ${esc(to)} · ${eta}</span></div>`;
}
function vowRow(g: GameScreen, f: Fleet): string {
  const st = g.st;
  const pv = f.owner === g.you ? pendingFree(g, 'vow', x => x.fleet === f.id) : undefined;
  if (f.vow) {
    const v = f.vow, S = SR(st);
    const prog = v.kind === 'never_retreat' ? ` · ${v.progress ?? 0}/${S.vowNeverRetreatWins}` : v.kind === 'guard' ? ` · ${v.progress ?? 0}/${S.vowGuardTurns}` : v.kind === 'relic' && v.carrying ? ' · carrying' : '';
    return `<div class="soulrow vow"${tip(`${VOWS[v.kind].name}: ${VOW_SHORT[v.kind]}`)}><i>✠</i><b>${esc(vowText(st, v))}</b><span>${prog.replace(/^ · /, '')}</span><em class="kept">sworn</em></div>`;
  }
  if (pv) return `<div class="soulrow vow pend"><i>✠</i><b>${esc(VOWS[pv.vow].name)}</b><em>at seal</em>${g.canPlan && !g.live ? '<button class="mini" data-a="unvow">↶</button>' : ''}</div>`;
  return '';
}

/** Rank-up honour waiting: two big cards (free action honour). */
export function honourChoice(g: GameScreen, f: Fleet): string {
  if (!on(g) || f.owner !== g.you || !f.pendingHonour?.options.length) return '';
  const picked = pendingFree(g, 'honour', x => x.fleet === f.id);
  const pickedId = picked ? (typeof picked.pick === 'number' ? f.pendingHonour.options[picked.pick] : picked.pick) : null;
  const cards = f.pendingHonour.options.map(id => {
    const b = BOONS[id];
    return `<button class="bigpick ${pickedId === id ? 'on' : ''}" data-a="honour" data-pick="${esc(id)}"${g.canPlan ? '' : ' aria-disabled="true"'}><i>${ic(icFor('boon', id, b?.icon ?? '❖'))}</i><b>${esc(b?.name ?? id)}</b><small>${esc(BOON_SHORT[id] ?? '')}</small></button>`;
  }).join('');
  return `<div class="choice"><div class="choice-h"><span>❖ Honour</span><small>${esc(rankName(f.commander.rank))}</small></div><div class="picks">${cards}</div></div>`;
}

/** The last three saga beats as icon + turn chips (tap: the full record). */
export function sagaChips(g: GameScreen, f: Fleet): string {
  if (!on(g) || !f.saga?.length) return '';
  const beats = f.saga.slice(-3).reverse();
  return `<div class="beats">${beats.map(b => `<button class="beat k-${esc(b.kind)}" data-a="record"${tip(b.text.split(/[.:;]/)[0].split(/\s+/).slice(0, 10).join(' '))}><i>${beatIcon(b.kind)}</i><small>T${b.turn}</small></button>`).join('')}<button class="beat more" data-a="record" aria-label="Full record"${tip('Full record')}>☰</button></div>`;
}

/** Retire / Vow buttons for the action row (own bannered fleet). */
export function fleetSoulActs(g: GameScreen, f: Fleet, ib: (a: string, icon: string, label: string, why: string | null, extra?: string, t?: string) => string): string {
  if (!on(g) || !f.banner || !g.canPlan) return '';
  let out = '';
  if (!f.vow && !pendingFree(g, 'vow', x => x.fleet === f.id)) out += ib('vowpick', '✠', 'Vow', null, vowOpen === f.id ? 'data-on="1"' : '', 'Swear a vow: a want, a bonus');
  if (f.commander.rank >= SR(g.st).retireMinRank) out += ib('retire', ic('retire'), 'Retire', g.orderWhy({ type: 'retire', fleet: f.id }), '', 'Furl the banner here: a Haven');
  return out;
}

let vowOpen: number | null = null;
/** The vow picker (opened by the Vow button). */
export function vowPicker(g: GameScreen, f: Fleet): string {
  if (vowOpen !== f.id || !g.canPlan || f.vow) return '';
  const st = g.st, you = g.you!;
  const rows: string[] = [];
  for (const k of ['throne', 'never_retreat', 'guard', 'relic'] as VowKind[]) {
    const why = vowBlock(st, you, f, k, f.region);
    rows.push(`<button class="vowopt" data-a="vow" data-k="${k}"${why ? ` aria-disabled="true"${tip(`⊘ ${shortWhy(why)}`)}` : tip(VOWS[k].keep)}><i>${ic(icFor('vow', k, VOWS[k].icon))}</i><b>${esc(k === 'guard' ? `Guard ${st.regions[f.region].name}` : VOWS[k].name)}</b><small>${esc(VOW_SHORT[k])}</small></button>`);
  }
  // avenge: rival fleets whose commander you have a grievance with
  for (const t of st.fleets) {
    if (t.owner < 0 || t.owner === you || !t.ships.length) continue;
    if (vowBlock(st, you, f, 'avenge', undefined, t.id)) continue;
    rows.push(`<button class="vowopt" data-a="vow" data-k="avenge" data-t="${t.id}"${tip(VOWS.avenge.keep)}><i>†</i><b>Avenge ${esc(t.commander.name.split(' ').slice(-1)[0])}</b><small>${esc(VOW_SHORT.avenge)}</small></button>`);
  }
  return `<div class="vowpick">${rows.join('')}</div>`;
}

/** Ship-trait icons on a ship chip, and the trait names for its tooltip. */
export function shipTraitBits(traits: string[] | undefined): { icons: string; tip: string } {
  const t = (traits ?? []).filter(id => Object.hasOwn(SHIP_TRAITS, id));
  if (!t.length) return { icons: '', tip: '' };
  return { icons: `<i class="trt">${t.map(id => esc(SHIP_TRAITS[id].icon)).join('')}</i>`, tip: ` · ${t.map(id => SHIP_TRAITS[id].name).join(', ')}` };
}

// ------------------------------------------------------------------ world card (docs/WORLD-CARD.md §8.5)
/** The world's epithet ("the Unbroken"), or ''. Its deeds' summary: the card's subtitle. */
export function epithetOf(g: GameScreen, r: Region): string {
  if (!on(g) || !r.story) return '';
  return r.story.epithet ?? worldEpithet(g.st, r) ?? '';
}
/** One line for what a calling does at tier t (0 = none yet, 1-3 = tenure tiers). */
export function callingEffect(g: GameScreen, id: string, t: number): string {
  const S = SR(g.st), at = (a: number[]) => a[Math.max(0, Math.min(a.length - 1, t))];
  switch (id) {
    case 'arsenal': return `ships built here −${Math.round(at(S.arsenalDiscount) * 100)}%`;
    case 'granary': return `+${at(S.granaryIndustry)}⚙ +${at(S.granaryCredits)}¢ a turn`;
    case 'bastion': return `garrison +${at(S.bastionGarrison)}, rebuilds +${at(S.bastionRegen)}`;
    case 'refinery': return `+${at(S.refineryCredits)}¢ a turn`;
    case 'proving': return `new ships blood green commanders`;
    case 'oracle': return `sensor +${at(S.oracleRange)} from here`;
    case 'cenotaph': return `fight harder here, armoured garrison`;
    case 'bulwark': return `siege damage −${at(S.bulwarkSiegeCut)} here`;
  }
  return CALLING_SHORT[id] ?? '';
}
/** The card's title line: the Calling with its effect and three tenure segments; dormant; or the teaser before it. */
export function callingLine(g: GameScreen, r: Region): string {
  if (!on(g) || !r.story || r.kind === 'void' || (r.kind as string) === 'lane' || r.owner === null) return '';
  const st = g.st, sto = r.story;
  if (sto.pendingCalling) return '';   // the prompt takes the line's place
  if (sto.calling) {
    const c = CALLINGS[sto.calling.id];
    const dormLeft = (sto.calling.dormantUntil ?? -1) - st.turn;
    const icon = ic(icFor('calling', sto.calling.id, c?.icon));
    if (dormLeft > 0) return `<div class="wc-calling dorm"${tip(`${c?.name}: sleeps after a capture`)}>${icon}<span>Calling dormant ${dormLeft} turn${dormLeft === 1 ? '' : 's'} · ${esc(c?.name ?? sto.calling.id)}</span></div>`;
    const tier = tenureTier(st, r);
    const T = SR(st).tenureTiers, tt = tenureTurns(st, r), nxt = T.find(x => x > tt);
    const segs = [0, 1, 2].map(i => `<i class="${i < tier ? 'on' : ''}"></i>`).join('');
    return `<div class="wc-calling"${tip(`${c?.name}: ${c?.desc ?? ''}`)}>${icon}<b>${esc(c?.name ?? sto.calling.id)}</b><span class="eff">${esc(callingEffect(g, sto.calling.id, tier))}</span><span class="ten" role="img" aria-label="Tenure tier ${tier} of 3"${tip(`Held ${tt}t${nxt ? ` · tier ${tier + 1} at ${nxt}t` : ' · top tier'}`)}>${segs}</span></div>`;
  }
  const need = SR(st).callingAtDev;
  if (r.owner !== g.you || r.dev < need - 1) return '';
  const pips = Array.from({ length: need }, (_, i) => `<i class="${i < r.dev ? 'on' : ''}"></i>`).join('');
  return `<div class="wc-calling none">${ic('calling')}<span>${r.dev >= need ? 'A Calling comes at the turn\'s end' : `Calling at ${need} citizens`}</span><span class="cit" role="img" aria-label="${Math.min(r.dev, need)} of ${need} citizens">${pips}</span></div>`;
}
/** "What will Mire become?": the two Calling picks (and gated ones, dimmed with their reason). Your world only. */
export function callingPrompt(g: GameScreen, r: Region): string {
  const pc = r.story?.pendingCalling;
  if (!on(g) || !pc || r.owner !== g.you || g.you === null) return '';
  const picked = pendingFree(g, 'calling', x => x.region === r.id);
  const pid = picked ? (typeof picked.pick === 'number' ? pc.options[picked.pick] : picked.pick) : null;
  const picks = pc.options.map(id => {
    const c = CALLINGS[id];
    return `<button class="pick ${pid === id ? 'on' : ''}" data-a="calling" data-pick="${esc(id)}"${g.canPlan ? '' : ' aria-disabled="true"'}>${ic(icFor('calling', id, c?.icon))}<b>${esc(c?.name ?? id)}</b><small>${esc(callingEffect(g, id, 0))}</small><em>${c?.from === 'mark' ? 'its history' : 'its nature'}</em></button>`;
  }).join('') + (pc.gated ?? []).map(x => {
    const c = CALLINGS[x.id];
    return `<button class="pick gated" aria-disabled="true"${tip(`${c?.name ?? x.id} ${x.why}`)}>${ic(icFor('calling', x.id, c?.icon))}<b>${esc(c?.name ?? x.id)}</b><small>⊘ ${esc(x.why)}</small></button>`;
  }).join('');
  return `<div class="prompt calling"><div class="ph"><span>${ic('calling')} What will ${esc(shortName(r.name))} become?</span><small>${pid ? 'chosen · at seal' : 'free · once'}</small></div><div class="picks">${picks}</div></div>`;
}
const shortName = (n: string) => n.replace(/^the\s+/i, '').split(/\s+/).slice(0, 2).join(' ');
/** Raze-or-keep, the turn after a capture: its payout on the button. */
const kept = new Set<string>();
/** A new game: "keep" choices were keyed by turn and region, which the next game reuses. */
export function resetSoul() { kept.clear(); vowOpen = null; }
export function razePrompt(g: GameScreen, r: Region): string {
  const st = g.st, you = g.you;
  if (!on(g) || you === null || r.owner !== you || !g.canPlan || kept.has(`${st.turn}:${r.id}`)) return '';
  const pend = pendingFree(g, 'raze', x => x.region === r.id);
  const pendO = pendingOrderIdx(g, o => o.type === 'raze' && o.region === r.id);
  const S = SR(st), lump = S.razeLump + S.razeLumpPerDev * r.dev;
  const free = !razeBlock(st, you, r.id, true), order = !free && !razeBlock(st, you, r.id, false);
  if (!pend && pendO < 0 && !free && !order) return '';
  const h = `<div class="ph"><span>${ic('occupied')} Just taken</span><small>${free ? 'free · this turn only' : '1 order · last chance'}</small></div>`;
  if (pend || pendO >= 0) return `<div class="prompt raze">${h}<div class="acts"><button class="on" data-a="unraze"${pend && !g.live ? tip('Take it back') : ' aria-disabled="true"'}>${ic('raze')} Razing: +${lump}⚙ +${lump}¢${pend && !g.live ? ' ↶' : ''}</button></div></div>`;
  return `<div class="prompt raze">${h}<div class="acts"><button data-a="raze"${free ? ' data-free="1"' : ''}${tip(`Loot it: citizens −1, its calling lost, ${nameOf(g, r.story?.captured?.from)} swears vengeance`)}>${ic('raze')} Raze: +${lump}⚙ +${lump}¢</button><button class="yes" data-a="keep">Keep it</button></div></div>`;
}
const nameOf = (g: GameScreen, p: number | null | undefined) => (p === null || p === undefined ? 'its old owner' : g.pname(p).split(' ').slice(-1)[0]);
/** Rival agents near flipping (from half the threshold): Purge. */
export function purgePrompt(g: GameScreen, r: Region, thr: number): string {
  const st = g.st, you = g.you;
  if (you === null || r.owner !== you) return '';
  const worst = st.players.filter(p => p.id !== you).map(p => ({ p, n: r.loyalty[p.id] ?? 0 })).sort((a, b) => b.n - a.n)[0];
  if (!worst || worst.n < Math.ceil(thr / 2)) return '';
  const o: Order = { type: 'influence', target: r.id };
  const why = g.canPlan ? g.orderWhy(o) : 'not planning';
  return `<div class="prompt purge"><div class="ph"><span>${ic('influence')} ${esc(nameOf(g, worst.p.id))} agents ${worst.n}/${thr}</span><small>flips at ${thr}</small></div><div class="acts"><button class="yes" data-a="influence"${why ? ` aria-disabled="true"${tip(`⊘ ${shortWhy(why)}`)}` : tip('Remove rival agents')}>${ic('influence')} Purge · ${costText(orderCost(g.st, o, you))}</button></div></div>`;
}
/** The Story tab's world half: the calling's tier, deeds (and Engrave where the rules keep it), ledger, chronicle, hands. */
export function storyWorld(g: GameScreen, r: Region): string {
  if (!on(g) || !r.story || r.kind === 'void' || (r.kind as string) === 'lane') return '';
  const st = g.st, sto = r.story, you = g.you;
  const sec = (h: string, body: string) => body ? `<section><h4>${h}</h4>${body}</section>` : '';
  let html = '';
  if (sto.calling) {
    const c = CALLINGS[sto.calling.id], tier = r.owner !== null ? tenureTier(st, r) : 0, T = SR(st).tenureTiers, tt = tenureTurns(st, r), nxt = T.find(x => x > tt);
    html += sec('Calling', `<p class="line">${ic(icFor('calling', sto.calling.id, c?.icon))} <b>${esc(c?.name ?? sto.calling.id)}</b> · tier ${tier} <small>(held ${tt}t${nxt ? `; tier ${tier + 1} at ${nxt}t` : ''})</small> · ${esc(callingEffect(g, sto.calling.id, tier))}</p>`);
  }
  if (sto.deeds.length) {
    const engraveOn = !(st.rules.world?.enabled !== false && st.rules.world && st.rules.world.engrave === false);
    const canEng = engraveOn && r.owner === you && you !== null && g.canPlan && !sto.deeds.some(d => d.engraved);
    const engIdx = pendingOrderIdx(g, o => o.type === 'engrave' && o.region === r.id);
    html += sec('Deeds', `<div class="deeds">${sto.deeds.map(d => {
      const D = DEEDS[d.id];
      const o: Order = { type: 'engrave', region: r.id, deed: d.id };
      const why = canEng ? g.orderWhy(o) : null;
      const eng = canEng && engIdx < 0 ? `<button class="eng" data-a="engrave" data-deed="${esc(d.id)}" aria-label="Engrave ${esc(d.name)}"${why ? ` aria-disabled="true"${tip(`⊘ ${shortWhy(why)}`)}` : tip(`Engrave: never replaced · ${costText(orderCost(g.st, o, you!))}`)}>${ic('engrave')}</button>` : '';
      return `<span class="deed ${d.engraved ? 'engraved' : ''}"${tip(`${D?.desc.split('.')[0] ?? ''}`)}>${ic(icFor('deed', d.id, D?.icon))}<span>${esc(d.name)}</span><small>T${d.turn}</small>${eng}</span>`;
    }).join('')}${engIdx >= 0 ? `<span class="deed pend">${ic('engrave')} engraving</span>` : ''}</div>`);
  }
  const marks = MARKS.filter(([k]) => sto[k] > 0).map(([k, , t]) => `<span${tip(t)}>${ic(icFor('mark', k))}<b>${sto[k]}</b></span>`).join('');
  html += sec('Ledger', marks ? `<div class="marks">${marks}</div>` : '');
  const led = (sto.ledger ?? []).slice(-3).reverse();
  html += sec('Chronicle', led.length ? `<div class="wchron">${led.map(e => `<p><span>T${e.turn}</span>${esc(e.text)}</p>`).join('')}</div>` : '');
  if (sto.owners.length > 1) html += sec('Hands', `<div class="hands">${sto.owners.slice(-5).map(o => `<span style="--pc:${esc(g.color(o.p))}"${tip(`${g.pname(o.p)} · T${o.turn} · ${o.how}`)}><i></i>T${o.turn}</span>`).join('<b>›</b>')}</div>`);
  return html;
}

// ------------------------------------------------------------------ fleet card: face prompts and the Story tab
/** "the Unbroken · Veteran": the epithets and rank under a fleet's name. */
export function fleetEpi(g: GameScreen, f: Fleet): string {
  if (!on(g) || f.owner < 0) return '';
  const ep = (f.epithets ?? []).slice(-1)[0];
  const brand = f.oathbreaker ? `<span class="brand"${tip(`Broke: ${f.oathbreaker.vow}`)}>Oathbreaker</span>` : '';
  const rank = f.banner ? rankName(f.commander.rank) : 'Picket';
  return `${ep ? `<em>${esc(ep)}</em> · ` : ''}<span class="rk">${esc(rank)}</span>${brand}`;
}
/** The vow as a quoted line on the art ("Guard Ninefold" · 4/6), or a vow waiting for the seal. */
export function vowQuote(g: GameScreen, f: Fleet): string {
  const st = g.st;
  const pv = f.owner === g.you ? pendingFree(g, 'vow', x => x.fleet === f.id) : undefined;
  if (f.vow) {
    const v = f.vow, S = SR(st);
    const prog = v.kind === 'never_retreat' ? `${v.progress ?? 0}/${S.vowNeverRetreatWins} wins` : v.kind === 'guard' ? `${v.progress ?? 0}/${S.vowGuardTurns} turns` : v.kind === 'relic' && v.carrying ? 'carrying' : 'sworn';
    return `<span class="vow"${tip(`${VOWS[v.kind].name}: ${VOW_SHORT[v.kind]}`)}>“${esc(vowText(st, v))}”<small>vow · ${esc(prog)}</small></span>`;
  }
  if (pv) return `<span class="vow pend">“${esc(VOWS[pv.vow].name)}”<small>sworn at seal</small></span>`;
  return '';
}
/** A pending Honour takes the fleet card's face: two big cards. */
export function honourPrompt(g: GameScreen, f: Fleet): string {
  if (!on(g) || f.owner !== g.you || !f.pendingHonour?.options.length) return '';
  const picked = pendingFree(g, 'honour', x => x.fleet === f.id);
  const pickedId = picked ? (typeof picked.pick === 'number' ? f.pendingHonour.options[picked.pick] : picked.pick) : null;
  const cards = f.pendingHonour.options.map(id => {
    const b = BOONS[id];
    return `<button class="pick ${pickedId === id ? 'on' : ''}" data-a="honour" data-pick="${esc(id)}"${g.canPlan ? '' : ' aria-disabled="true"'}>${ic(icFor('boon', id, b?.icon ?? '❖'))}<b>${esc(b?.name ?? id)}</b><small>${esc(BOON_SHORT[id] ?? '')}</small></button>`;
  }).join('');
  return `<div class="prompt honour"><div class="ph"><span>${ic('honour')} Honour · ${esc(rankName(f.commander.rank))}</span><small>${pickedId ? 'chosen · at seal' : 'free · choose one'}</small></div><div class="picks">${cards}</div></div>`;
}
/** Limping home: the route and the turns left (the Rally bet is in the Gambit). */
export function limpLine(g: GameScreen, f: Fleet): string {
  if (!f.limping) return '';
  const st = g.st, L = f.limping;
  const to = st.regions[L.to]?.name ?? '?';
  const rt = limpRoute(st, f);
  const n = f.route?.path.length ?? rt?.path.length ?? 0;
  const sp = Math.max(1, fleetSpeed(st, f));
  const eta = n ? `${Math.max(1, Math.ceil(n / sp))}${g.live ? '⏱' : 't'}` : 'here';
  return `<div class="route limp"${tip('Limping home: cannot attack, dies if caught')}>${ic('limping')}<span><b>Limping home</b> → ${esc(to)} · ${eta}</span></div>`;
}
/** The fleet's Story tab: commander and record, boons / banes / scars (named), the vow, the saga, rename. */
export function fleetStory(g: GameScreen, f: Fleet): string {
  const st = g.st, c = f.commander;
  const sec = (h: string, body: string) => body ? `<section><h4>${h}</h4>${body}</section>` : '';
  let html = sec('Commander', `<p class="line"><b>${esc(c.name)}</b> <small>· ${esc(rankName(c.rank))} · ${c.deeds.wins}W ${c.deeds.losses}L · ${c.deeds.kills} kills</small></p>${c.traits.length ? `<div class="soulrow">${c.traits.map(t => `<span class="sp trait"${tip(CMD_TRAITS[t]?.desc ?? '')}>${esc(CMD_TRAITS[t]?.name ?? t)}</span>`).join('')}</div>` : ''}`);
  if (on(g) && f.banner) {
    const chips: string[] = [];
    for (const b of f.banner.boons) chips.push(`<span class="sp boon"${tip(BOON_SHORT[b] ?? '')}>${ic(icFor('boon', b, BOONS[b]?.icon))}${esc(BOONS[b]?.name ?? b)}</span>`);
    for (const h of f.honours ?? []) chips.push(`<span class="sp boon honour"${tip(`Honour: ${BOON_SHORT[h.id] ?? ''}`)}>${ic(icFor('boon', h.id, BOONS[h.id]?.icon ?? '❖'))}${esc(BOONS[h.id]?.name ?? h.id)}</span>`);
    for (const b of boonsOf(st, f).filter(b => !f.banner!.boons.includes(b) && !(f.honours ?? []).some(h => h.id === b))) chips.push(`<span class="sp boon haven"${tip('A Haven\'s gift')}>${ic(icFor('boon', b, BOONS[b]?.icon))}${esc(BOONS[b]?.name ?? b)}</span>`);
    for (const b of f.banner.banes) chips.push(`<span class="sp bane"${tip(`${BANE_SHORT[b] ?? ''}${b === 'grudgebound' && f.banner!.grudgeVs != null ? ` (${g.pname(f.banner!.grudgeVs)})` : ''}`)}>${ic(icFor('bane', b, BANES[b]?.icon))}${esc(BANES[b]?.name ?? b)}</span>`);
    for (const x of f.scars ?? []) chips.push(`<span class="sp scar"${tip(SCAR_SHORT[x.id] ?? '')}>${ic(icFor('scar', x.id, SCARS[x.id]?.icon))}${esc(SCARS[x.id]?.name ?? x.id)}</span>`);
    if ((f.sulkUntil ?? -1) >= st.turn) chips.push(`<span class="sp bane"${tip('Boons fail this turn')}>${ic('bolt')}Sulking</span>`);
    html += sec('Boons, banes &amp; scars', chips.length ? `<div class="soulrow">${chips.join('')}</div>` : '');
    // the vow: sworn (with its progress on the face), waiting for the seal, or the picker
    if (f.owner === g.you && g.canPlan && !f.vow && !pendingFree(g, 'vow', x => x.fleet === f.id)) html += sec('Vow', `${vowOpen === f.id ? vowPicker(g, f) : `<button class="mini wide" data-a="vowpick">${ic('vow')} Swear a vow</button>`}`);
    else if (pendingFree(g, 'vow', x => x.fleet === f.id) && !f.vow) html += sec('Vow', `<p class="line">${ic('vow')} ${esc(VOWS[pendingFree(g, 'vow', x => x.fleet === f.id)!.vow].name)} <small>· sworn at seal</small>${g.canPlan && !g.live ? ' <button class="mini" data-a="unvow" aria-label="Take the vow back">↶</button>' : ''}</p>`);
  }
  const beats = (f.saga ?? []).slice(-3).reverse();
  html += sec('Saga', beats.length ? `<div class="wchron">${beats.map(b => `<p><span>T${b.turn}</span>${esc(b.text)}</p>`).join('')}</div><button class="mini wide" data-a="record">${ic('chronicle')} Full record</button>` : (f.history.length ? `<div class="wchron">${f.history.slice(-3).reverse().map(x => `<p>${esc(x)}</p>`).join('')}</div>` : ''));
  if (f.owner === g.you && g.canPlan) html += sec('Name', `<input data-rename value="${esc(g.pendingName(f))}" maxlength="40" aria-label="Fleet name">`);
  return html;
}

// ------------------------------------------------------------------ actions (card / ring)
export function soulAction(g: GameScreen, a: string, data: DOMStringMap): boolean {
  const sel = g.sel;
  if (!sel) return false;
  if (sel.kind === 'fleet') {
    const f = g.fleet(sel.id);
    if (!f) return false;
    switch (a) {
      case 'record': openRecord(g, f); return true;
      case 'honour': if (f.owner === g.you && data.pick) setFree(g, { type: 'honour', fleet: f.id, pick: data.pick }, x => x.type === 'honour' && x.fleet === f.id); return true;
      case 'vowpick': vowOpen = vowOpen === f.id ? null : f.id; g.renderAll(); return true;
      case 'vow': {
        const k = data.k as VowKind;
        const fa: FreeAction = { type: 'vow', fleet: f.id, vow: k, ...(k === 'guard' ? { region: f.region } : {}), ...(k === 'avenge' ? { target: Number(data.t) } : {}) };
        vowOpen = null;
        setFree(g, fa, x => x.type === 'vow' && x.fleet === f.id);
        return true;
      }
      case 'unvow': dropFree(g, x => x.type === 'vow' && x.fleet === f.id); return true;
      case 'retire': g.addOrder({ type: 'retire', fleet: f.id }); return true;
      case 'split': {
        // warships split off raise a new banner: the founding sheet
        if (!on(g) || f.owner !== g.you) return false;
        const ids = splitIds(g, f);
        if (!ids) return true;
        if (f.ships.filter(s => ids.includes(s.id)).every(s => s.cls === 'scout')) return false;
        openFounding(g, { region: f.region, split: { fleet: f.id, ships: ids } });
        return true;
      }
    }
    return false;
  }
  const r = g.st.regions[sel.id];
  if (!r) return false;
  switch (a) {
    case 'calling': if (data.pick) setFree(g, { type: 'calling', region: r.id, pick: data.pick }, x => x.type === 'calling' && x.region === r.id); return true;
    case 'engrave': if (data.deed) g.addOrder({ type: 'engrave', region: r.id, deed: data.deed }); return true;
    case 'raze':
      if (data.free) setFree(g, { type: 'raze', region: r.id }, x => x.type === 'raze' && x.region === r.id);
      else g.addOrder({ type: 'raze', region: r.id });
      return true;
    case 'unraze': dropFree(g, x => x.type === 'raze' && x.region === r.id); return true;
    case 'keep': kept.add(`${g.st.turn}:${r.id}`); g.renderAll(); return true;
  }
  return false;
}

// ------------------------------------------------------------------ fleet record (the full saga of one fleet)
export function openRecord(g: GameScreen, f: Fleet) {
  const st = g.st;
  const beats = (f.saga ?? []).slice().reverse();
  const o = overlay(`<div class="dialog record">
    <div class="rec-h">${f.banner ? bannerSvg(f.banner.sigil, g.color(f.owner), 56, { rim: f.commander.rank >= 4 ? 'gold' : 'silver', rank: f.commander.rank, broken: !!f.oathbreaker }) : ''}
      <div><h1 style="color:${esc(g.color(f.owner))}">${esc(f.name)}</h1>${(f.epithets ?? []).length ? `<div class="rec-ep">${f.epithets!.map(esc).join(' · ')}</div>` : ''}
      <div class="rec-sub">${esc(f.commander.name)} · ${esc(rankName(f.commander.rank))}${f.banner ? ` · founded at ${esc(st.regions[f.banner.home]?.name ?? '?')}, turn ${f.banner.foundedTurn}` : ''}</div></div></div>
    <ol class="rec-list">${beats.map(b => `<li class="k-${esc(b.kind)}"><span class="rec-t">T${b.turn}</span><i>${beatIcon(b.kind)}</i><span>${esc(b.text)}</span></li>`).join('') || '<li class="dim">No deeds yet.</li>'}</ol></div>`);
  o.classList.add('soul-ov');
}

// ------------------------------------------------------------------ the founding ritual
interface Found {
  region: number;
  cls?: string;
  split?: { fleet: number; ships: number[] };
  sigil: string;
  name: string;
  names: string[];
  boons: string[];
  banes: string[];
  grudgeVs: number | null;
  vow: VowKind | null;
}
let F: Found | null = null;

/** Open the founding sheet for a build (cls) or a split at a region. `quick` founds with the defaults at once. */
export function openFounding(g: GameScreen, opts: { region: number; cls?: string; split?: { fleet: number; ships: number[] } }, quick = false) {
  const st = g.st, you = g.you;
  if (you === null) return;
  const off = foundingOffer(st, you, opts.region);
  const used = new Set(g.myFree().flatMap(x => (x.type === 'split' && x.found?.sigil ? [x.found.sigil] : [])));
  for (const o of g.live ? g.queue : g.plan.orders) if (o?.type === 'build' && o.found?.sigil) used.add(o.found.sigil);
  const sigil = used.has(off.sigil) ? (SIGILS.find(s => !used.has(s.id) && !st.fleets.some(f => f.owner === you && f.banner?.sigil === s.id))?.id ?? off.sigil) : off.sigil;
  F = { ...opts, sigil, name: off.names[0] ?? 'New Banner', names: off.names, boons: [], banes: [], grudgeVs: null, vow: null };
  if (quick) { commitFounding(g); return; }
  const o = overlay(`<div class="dialog founding" data-found></div>`);
  o.classList.add('soul-ov', 'found-ov');
  const box = o.querySelector<HTMLElement>('[data-found]')!;
  renderFounding(g, box);
  box.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-f]');
    if (!b || !F) return;
    if (b.getAttribute('aria-disabled') === 'true') { b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope'); return; }
    const v = b.dataset.v ?? '';
    switch (b.dataset.f) {
      case 'sigil': F.sigil = v; break;
      case 'name': F.name = v; { const i = box.querySelector<HTMLInputElement>('[data-fname]'); if (i) i.value = v; } break;
      case 'boon': F.boons = F.boons.includes(v) ? F.boons.filter(x => x !== v) : [...F.boons, v]; break;
      case 'bane': F.banes = F.banes.includes(v) ? F.banes.filter(x => x !== v) : [...F.banes, v]; if (v === 'grudgebound' && F.banes.includes(v) && F.grudgeVs === null) F.grudgeVs = st.players.find(p => p.id !== you && !p.eliminated)?.id ?? null; break;
      case 'grudge': F.grudgeVs = Number(v); break;
      case 'vow': F.vow = F.vow === v ? null : v as VowKind; break;
      case 'go': { const nm = box.querySelector<HTMLInputElement>('[data-fname]')?.value.trim(); if (nm) F.name = nm; if (commitFounding(g)) o.remove(); return; }
      case 'quick': { F.boons = []; F.banes = []; F.vow = null; F.grudgeVs = null; F.name = F.names[0] ?? F.name; if (commitFounding(g)) o.remove(); return; }
      case 'cancel': o.remove(); return;
    }
    const nm = box.querySelector<HTMLInputElement>('[data-fname]');
    if (nm && b.dataset.f !== 'name') F.name = nm.value;
    renderFounding(g, box);
  });
  box.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && (e.target as HTMLElement).matches('[data-fname]')) box.querySelector<HTMLElement>('[data-f=go]')?.click(); });
  setTimeout(() => box.querySelector<HTMLElement>('[data-f=go]')?.focus({ preventScroll: true }), 40);
}

function renderFounding(g: GameScreen, box: HTMLElement) {
  if (!F) return;
  const st = g.st, you = g.you!, S = SR(st);
  const col = g.color(you);
  const { cost, value } = modPoints(F.boons, F.banes);
  const bal = value + S.freePoints - cost;
  const err = modsBlock(st, you, F.boons, F.banes, F.banes.includes('grudgebound') ? F.grudgeVs ?? undefined : undefined);
  const left = bannersLeft(g, F.region);
  const what = F.split ? `${F.split.ships.length} ship${F.split.ships.length === 1 ? '' : 's'} split off` : `${st.rules.ships[F.cls ?? '']?.name ?? 'Ship'} at ${st.regions[F.region]?.name ?? '?'}`;
  const sig = SIGILS.map(s => `<button class="sg ${F!.sigil === s.id ? 'on' : ''}" data-f="sigil" data-v="${s.id}" aria-label="${esc(s.name)}"${tip(s.name)}>${bannerSvg(s.id, col, 40, { rim: F!.sigil === s.id ? 'gold' : 'iron' })}</button>`).join('');
  const modCard = (kind: 'boon' | 'bane', id: string) => {
    const d = kind === 'boon' ? BOONS[id] : BANES[id];
    const picked = (kind === 'boon' ? F!.boons : F!.banes).includes(id);
    let why: string | null = null;
    if (!picked) {
      const nb = kind === 'boon' ? [...F!.boons, id] : F!.boons, nn = kind === 'bane' ? [...F!.banes, id] : F!.banes;
      const e = modsBlock(st, you, nb, nn, nn.includes('grudgebound') ? (F!.grudgeVs ?? (you + 1) % st.players.length) : undefined);
      if (e && !(kind === 'bane' && /boons cost/.test(e))) why = /boons cost/.test(e) ? 'not enough points' : e;
    }
    const pts = kind === 'boon' ? `−${d.cost}` : `+${d.cost}`;
    return `<button class="mod ${kind} ${picked ? 'on' : ''}" data-f="${kind}" data-v="${id}"${why ? ` aria-disabled="true"${tip(`⊘ ${why}`)}` : ''}><i>${ic(icFor(kind === 'boon' ? 'boon' : 'bane', id, d.icon))}</i><b>${esc(d.name)}</b><small>${esc(kind === 'boon' ? BOON_SHORT[id] : BANE_SHORT[id])}</small><span class="pts">${pts}</span></button>`;
  };
  const rivals = st.players.filter(p => p.id !== you && !p.eliminated);
  const grudge = F.banes.includes('grudgebound') ? `<div class="grudge"><span>⚡ Grudge vs</span>${rivals.map(p => `<button class="gr ${F!.grudgeVs === p.id ? 'on' : ''}" data-f="grudge" data-v="${p.id}" style="--pc:${esc(p.color)}">${esc(p.name.split(' ').slice(-1)[0])}</button>`).join('')}</div>` : '';
  const vows = (['throne', 'never_retreat', 'guard', 'relic'] as VowKind[]).map(k => `<button class="vw ${F!.vow === k ? 'on' : ''}" data-f="vow" data-v="${k}"${tip(`${VOW_SHORT[k]} · sworn when it launches`)}><i>${ic(icFor('vow', k, VOWS[k].icon))}</i><span>${esc(k === 'guard' ? 'Guard home' : VOWS[k].name)}</span></button>`).join('');
  const nameSug = F.names.map(n => `<button class="nsug ${F!.name === n ? 'on' : ''}" data-f="name" data-v="${esc(n)}">${esc(n)}</button>`).join('');
  const blocked = err ?? (left.free <= 0 ? 'no free banner' : null);
  const keepName = box.querySelector<HTMLInputElement>('[data-fname]');
  const focused = keepName && document.activeElement === keepName;
  const sel = focused ? [keepName.selectionStart, keepName.selectionEnd] : null;
  box.innerHTML = `
    <header class="fh"><div class="fh-ban">${bannerSvg(F.sigil, col, 64, { rim: 'gold' })}</div>
      <div class="fh-t"><small class="kicker">Raise a banner</small><h1>${esc(F.name || '…')}</h1><span class="fh-what">${esc(what)}</span></div>
      <span class="fh-free ${left.free <= 0 ? 'bad' : ''}"${tip('Banners: 3, +1 per Crown held')}><i>⚑</i><b>${Math.max(0, left.free)}</b><small>/${left.limit}</small></span>
      <button class="fx-x" data-f="cancel" aria-label="Cancel">×</button></header>
    <section class="fs"><h3>Sigil</h3><div class="sigils">${sig}</div></section>
    <section class="fs"><h3>Name</h3><div class="fname"><input data-fname maxlength="40" value="${esc(F.name)}" aria-label="Fleet name"><div class="nsugs">${nameSug}</div></div></section>
    <section class="fs mods"><div class="mods-h"><h3>Boons <small>${F.boons.length}/${S.maxBoons}</small></h3><span class="bal ${bal < 0 ? 'bad' : bal === 0 ? '' : 'good'}"${tip('Banes pay for boons; one point free')}><i>◆</i><b>${bal}</b></span><h3>Banes <small>${F.banes.length}/${S.maxBanes}</small></h3></div>
      <div class="modcols"><div class="modlist">${Object.keys(BOONS).map(id => modCard('boon', id)).join('')}</div><div class="modlist">${Object.keys(BANES).map(id => modCard('bane', id)).join('')}</div></div>${grudge}</section>
    <section class="fs"><h3>Vow <small>optional</small></h3><div class="vows">${vows}</div></section>
    <footer class="ff"><span class="ferr">${blocked ? `⊘ ${esc(shortWhy(blocked))}` : ''}</span><button class="fbtn plain" data-f="quick"${left.free <= 0 ? ' aria-disabled="true"' : ''}${tip('Defaults: no boons, no banes')}>Quick</button><button class="fbtn go" data-f="go"${blocked ? ' aria-disabled="true"' : ''}>⚑ Found</button></footer>`;
  iconizeDom(box);
  if (sel) { const i = box.querySelector<HTMLInputElement>('[data-fname]')!; i.focus({ preventScroll: true }); try { i.setSelectionRange(sel[0], sel[1]); } catch { /* */ } }
  box.querySelector<HTMLInputElement>('[data-fname]')!.addEventListener('input', e => {
    if (!F) return;
    F.name = (e.target as HTMLInputElement).value;
    const h = box.querySelector('.fh-t h1'); if (h) h.textContent = F.name || '…';
  });
}

function commitFounding(g: GameScreen): boolean {
  const f = F;
  if (!f || g.you === null) return false;
  const found: FoundSpec = { name: f.name.trim().slice(0, 40) || f.names[0], sigil: f.sigil };
  if (f.boons.length) found.boons = f.boons.slice();
  if (f.banes.length) found.banes = f.banes.slice();
  if (f.banes.includes('grudgebound') && f.grudgeVs !== null) found.grudgeVs = f.grudgeVs;
  const err = modsBlock(g.st, g.you, found.boons ?? [], found.banes ?? [], found.grudgeVs);
  if (err) { toast(`⊘ ${shortWhy(err)}`); return false; }
  if (bannersLeft(g, f.region).free <= 0) { toast('⊘ No free banner'); return false; }
  let ok: boolean;
  if (f.split) {
    g.pushFree({ type: 'split', fleet: f.split.fleet, ships: f.split.ships, found });
    g.lifted.clear();
    g.afterAction();
    ok = true;
  } else ok = g.addOrder({ type: 'build', region: f.region, cls: f.cls ?? 'frigate', fleet: null, found });
  if (ok && f.vow) rememberVow(g, found.name!, f.vow, f.region);
  if (ok) toast(`⚑ ${found.name}`);
  F = null;
  return ok;
}

// ------------------------------------------------------------------ a vow chosen at founding is sworn on the fleet's first turn
const vowKey = (g: GameScreen) => `tc.fvow.${g.gameKey()}.${g.you ?? 's'}`;
function rememberVow(g: GameScreen, name: string, vow: VowKind, region: number) {
  try {
    const list = JSON.parse(localStorage.getItem(vowKey(g)) ?? '[]') as { name: string; vow: VowKind; region: number; turn: number }[];
    list.push({ name, vow, region, turn: g.st.turn });
    localStorage.setItem(vowKey(g), JSON.stringify(list.slice(-12)));
  } catch { /* storage blocked: the vow can still be sworn from the card */ }
}
/** Swear founding vows for fleets that now exist (called on every new view). */
export function applyFoundingVows(g: GameScreen) {
  if (g.you === null || !g.canPlan || !on(g)) return;
  let list: { name: string; vow: VowKind; region: number; turn: number }[] = [];
  try { list = JSON.parse(localStorage.getItem(vowKey(g)) ?? '[]'); } catch { return; }
  if (!list.length) return;
  const keep: typeof list = [];
  for (const v of list) {
    const f = g.st.fleets.find(x => x.owner === g.you && x.name === v.name && x.banner && x.banner.foundedTurn >= v.turn && x.ships.length);
    if (!f) { if (g.st.turn - v.turn < 3) keep.push(v); continue; }
    if (f.vow || g.myFree().some(x => x.type === 'vow' && x.fleet === f.id)) continue;
    const fa: FreeAction = { type: 'vow', fleet: f.id, vow: v.vow, ...(v.vow === 'guard' ? { region: f.region } : {}) };
    if (vowBlock(g.st, g.you, f, v.vow, f.region)) continue;
    if (g.live) g.src.liveFree?.(fa); else { g.plan.free.push(fa); g.savePlan(); }
  }
  try { localStorage.setItem(vowKey(g), JSON.stringify(keep)); } catch { /* */ }
}

// ------------------------------------------------------------------ notes
/** Choices waiting for you (honours, callings, a raze window): notification chips. */
export function soulNotes(g: GameScreen): { key: string; icon: string; text: string; go: () => void }[] {
  const st = g.st, you = g.you;
  if (you === null || !on(g) || !g.canPlan) return [];
  const out: { key: string; icon: string; text: string; go: () => void }[] = [];
  for (const f of st.fleets) if (f.owner === you && f.pendingHonour && !g.myFree().some(x => x.type === 'honour' && x.fleet === f.id)) {
    out.push({ key: `hon${f.id}`, icon: '❖', text: 'Choose an honour', go: () => { g.select({ kind: 'fleet', id: f.id }); g.focus(st.regions[f.region].site); } });
  }
  for (const r of st.regions) if (r.owner === you && r.story?.pendingCalling && !g.myFree().some(x => x.type === 'calling' && x.region === r.id)) {
    out.push({ key: `cal${r.id}`, icon: '◈', text: 'Choose a calling', go: () => { g.select({ kind: 'region', id: r.id }); g.focus(r.site); } });
  }
  return out;
}

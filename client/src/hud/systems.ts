// Star systems on the world card (docs/SYSTEMS.md): a star line, one compact row per body, the derived role
// badge, citizens x/cap and slots used/total. Stars and bodies are public map knowledge; slots too (buildings are).
// Step 3: the system's status (Held / Contested / Occupied / Tribute), each body's output and who gets it, contested
// turns and the refugee warning, and the Tribute offer / accept controls. Step 4: body tags on the body rows.
import type { GameScreen } from '../game.ts';
import type { Body, FreeAction, Region } from '../../../shared/sim/types.ts';
import { BODIES, ROLES, STARS, STATION } from '../../../shared/config/systems.ts';
import { SY, BODY_STATION, bodyLine, bodyTag, systemInfo, sysOn } from '../../../shared/sim/systems.ts';
import { contestOn, systemStatus, tributeBlock, acceptBlock, tributeOfferer, type Share } from '../../../shared/sim/contest.ts';
import { regionYield, type YieldPart } from '../../../shared/sim/resolve.ts';
import { connected } from '../../../shared/sim/empire.ts';
import { esc } from '../ui/dom.ts';
import { tip, shortWhy } from './util.ts';
import { setFree, dropFree } from './soul.ts';
import { ic, icFor } from '../art/icons.ts';

/** What one body adds to the citizens cap (for its row), or 0. */
function bodyCap(g: GameScreen, r: Region, b: Body): number {
  if (!sysOn(g.st)) return 0;
  const Y = SY(g.st);
  const hab = r.bodies?.some(x => x.kind === 'habitable');
  if (b.kind === 'habitable') {
    let c = Y.capHabitable[b.q ?? 'fair'] ?? 0;
    if (r.star === 'yellow') c += Y.capYellow;
    if (r.star === 'red') c += Y.capRed;
    if (r.star === 'blue') c = Math.min(c, Y.blueHabitableMax);
    return Math.max(0, c);
  }
  if (b.kind === 'moon') return hab ? Y.capMoon : 0;
  if (b.kind === 'barren') return Y.capBarren;
  return 0;
}

/** The role badge (Core / Forge / Harbor / Waystation), or ''. */
export function roleBadge(g: GameScreen, r: Region): string {
  const info = systemInfo(g.st, r.id);
  if (!info?.role) return '';
  const R = ROLES[info.role];
  return `<span class="sysrole role-${info.role}"${tip(`${R.name}: ${R.desc} (derived from the bodies, never chosen)`)}>${ic(icFor('role', info.role, R.icon))} ${R.name}</span>`;
}

/** Star line + body rows + citizens and slots. Empty for lane waypoints and old maps. */
export function systemRows(g: GameScreen, r: Region): string {
  if (!r.star || r.kind === 'lane') return '';
  const st = g.st;
  const S = STARS[r.star];
  const info = systemInfo(st, r.id);
  const pip = (n: number, max: number) => `<span class="cpips">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
  const top = `<div class="sysrow star"><i style="color:${S.color}">${ic(icFor('star', r.star, S.icon))}</i><b>${esc(S.name)}</b><small>${esc(S.desc)}</small></div>`;
  const out = bodyOutputs(g, r);
  const rows = (r.bodies ?? []).map((b, i) => {
    const D = BODIES[b.kind];
    const cap = bodyCap(g, r, b);
    const vein = b.vein ? ` <em class="vein v-${esc(b.vein)}">${ic(icFor('vein', b.vein))}</em>` : '';
    const tag = bodyTag(st, r, i);
    return `<div class="sysrow body"${tip(`${D.name}${tag ? ` · ${tag}` : ''}: ${D.desc}${D.orbital ? ' Orbital: its output goes to whoever holds space.' : ' Surface: blockaded while an enemy holds space.'}`)}><i>${ic(icFor('body', b.kind, D.icon))}</i><b>${esc(b.name)}</b>${tag ? `<em class="btag">${esc(tag)}</em>` : ''}<small>${esc(bodyLine(b))}${cap ? ` · cap +${cap}` : ''}</small>${vein}${out.get(i) ?? ''}</div>`;
  }).join('');
  const stTag = (r.buildings.station ?? 0) > 0 ? bodyTag(st, r, BODY_STATION) : null;
  const station = (r.buildings.station ?? 0) > 0 ? `<div class="sysrow body"${tip(`${STATION.desc} Orbital.`)}><i>${ic('station')}</i><b>Station</b>${stTag ? `<em class="btag">${esc(stTag)}</em>` : ''}<small>built · cap +${sysOn(st) ? SY(st).capStation : 1}</small>${out.get(BODY_STATION) ?? ''}</div>` : '';
  const space = out.get(-1) ? `<div class="sysrow body"${tip('Output with no body of its own (a Depot without a Station): orbital')}><i>${ic('star')}</i><b>Open space</b><small>orbital</small>${out.get(-1)}</div>` : '';
  let foot = '';
  if (info) {
    const sl = info.slots;
    const disc = info.waystation ? `<span class="sysdisc"${tip(`Waystation (citizens ≤ ${SY(st).waystationCitizens}): military and logistics projects cost ${Math.round(SY(st).waystationDiscount * 100)}% less`)}>⛯ −${Math.round(SY(st).waystationDiscount * 100)}%</span>` : '';
    const grow = info.role === 'core' && r.owner !== null && info.citizens < info.cap ? `<small${tip('Turns of growth banked: an uncontested Core gains a citizen every few turns')}>↑${info.growth}</small>` : '';
    foot = `<div class="sysfoot">${roleBadge(g, r)}<span class="syscit"${tip(`Citizens ${info.citizens}/${info.cap}: the cap comes from the bodies and the star`)}>☺ ${info.citizens}/${info.cap} ${pip(Math.min(info.citizens, 5), Math.max(info.cap, info.citizens))}${grow}</span>` +
      `<span class="sysslot"${tip('Civil slots (from bodies; a Station adds one): Mine, Trade Hub, Extractor, Academy, Shipyard')}>⚙ ${sl.civilUsed}/${sl.civil}</span>` +
      `<span class="sysslot"${tip(`Military/logistics slots: ${SY(st).milSlots} everywhere, +${SY(st).chokeSlots} at a chokepoint`)}>⛨ ${sl.milUsed}/${sl.mil}${info.choke ? ` ${ic('choke')}` : ''}</span>${disc}</div>`;
  }
  return `<div class="sys">${statusLine(g, r)}${top}${rows}${station}${space}${foot}</div>`;
}

// ------------------------------------------------------------------ step 3: status, output split, tribute
const nm = (g: GameScreen, p: number | null | undefined) => (p === -1 ? 'the Warden' : p === null || p === undefined ? 'nobody' : g.pname(p).split(' ').slice(-1)[0]);
const pct = (x: number) => (x >= 0.999 ? '' : x <= 0.001 ? '0' : x === 0.5 ? '½' : Math.abs(x - 1 / 3) < 0.01 ? '⅓' : Math.abs(x - 2 / 3) < 0.01 ? '⅔' : x === 0.25 ? '¼' : `${Math.round(x * 100)}%`);

/** Held / Contested / Occupied / Tribute: one line at the top of the system block (owned systems, step 3 on). */
function statusLine(g: GameScreen, r: Region): string {
  const st = g.st;
  if (!contestOn(st) || r.owner === null || r.kind === 'lane' || !r.bodies) return '';
  const S = systemStatus(st, r);
  const bits: string[] = [];
  let cls = 'held';
  if (S.contested) {
    cls = 'contested';
    const holder = S.holder;
    const hc = holder === null || holder === undefined || holder < 0 ? '#bdb6d6' : g.color(holder);
    bits.push(`<b${tip('An enemy warship is in the system: no growth; orbital output goes to whoever holds space')}>${ic('chain')} Contested</b>`);
    bits.push(`<span class="hold" style="--pc:${esc(hc)}"${tip(holder === r.owner ? 'The owner holds space: no blockade' : holder === null ? 'Two hostile besiegers: nobody holds space; the orbitals produce nothing' : `${nm(g, holder)} holds space: plunders the orbitals, blockades the surface`)}><i></i>${holder === null ? 'no one holds space' : `${esc(nm(g, holder))} holds space`}</span>`);
    bits.push(`<span${tip('Consecutive contested turns')}>${S.contestedTurns}t</span>`);
    if (S.refugeesIn !== null) bits.push(`<span class="warn"${tip(`Every ${SY(st).refugeeTurns} contested turns a citizen flees as refugees`)}>⚠ refugees in ${S.refugeesIn}t</span>`);
  }
  if (S.occupiedLeft > 0) { if (cls === 'held') cls = 'occupied'; bits.push(`<b${tip(`Just taken: the new owner gets ${S.occupiedScorched ? 'nothing (scorched)' : `${Math.round(SY(st).occupiedShare * 100)}%`} of its output; its Calling sleeps too`)}>⚑ Occupied</b><span>${S.occupiedLeft}t left</span>`); }
  if (S.tribute) { if (cls === 'held') cls = 'tribute'; bits.push(`<b style="--pc:${esc(g.color(S.tribute.to))}"${tip(`${r.name} pays ${Math.round(SY(st).tributeShare * 100)}% of its output to ${g.pname(S.tribute.to)}; they don't fight here`)}>⚖ Tribute → ${esc(nm(g, S.tribute.to))}</b><span>${S.tributeLeft}t left</span>`); }
  if (!bits.length) bits.push(`<b${tip('Held: the owner gets all of its output')}>${ic('check')} Held</b>`);
  return `<div class="sysstat s-${cls}">${bits.join('')}</div>`;
}

/** Each body's output (⚙ ¢ ✦) and who gets it, as row tails; key -1 = open space. Owned systems only. */
function bodyOutputs(g: GameScreen, r: Region): Map<number, string> {
  const out = new Map<number, string>();
  const st = g.st;
  if (!sysOn(st) || r.owner === null || !r.bodies || r.kind === 'lane') return out;
  let y;
  try { y = regionYield(st, r.owner, r, st.rules.empire?.enabled !== false ? connected(st, r.owner) : null, undefined, !!systemStatus(st, r).contested); } catch { return out; }
  if (!y) return out;
  const by = new Map<number, YieldPart[]>();
  for (const x of y.parts) { const k = x.body ?? -1; (by.get(k) ?? by.set(k, []).get(k)!).push(x); }
  const sh = systemStatus(st, r).shares;
  for (const [k, ps] of by) {
    const i = ps.reduce((a, x) => a + x.i, 0), c = ps.reduce((a, x) => a + x.c, 0), f = ps.reduce((a, x) => a + x.f, 0);
    if (Math.round(i) + Math.round(c) + Math.round(f) <= 0) continue;
    const orb = ps[0].orbital;
    const vals = `${i >= 0.5 ? `⚙${Math.round(i)}` : ''}${c >= 0.5 ? ` ¢${Math.round(c)}` : ''}${f >= 0.5 ? ` ✦${Math.round(f)}` : ''}`.trim();
    let rcv = '';
    if (sh) {
      const lane = (x: Share) => (orb ? x.o : x.s);
      const cut = (x: Share) => { const l = lane(x); return i >= c ? l.i : l.c; };   // the main resource's share
      const parts = [...sh.get].map(([p, x]) => ({ p, k: cut(x) })).filter(x => x.k > 0.001);
      const kept = parts.reduce((a, x) => a + x.k, 0);
      rcv = parts.map(x => `<i class="rcv" style="--pc:${esc(g.color(x.p))}"${tip(`${g.pname(x.p)} gets ${Math.round(x.k * 100)}%`)}>${pct(x.k) || '●'}</i>`).join('') +
        (kept < 0.999 ? `<i class="rcv lost"${tip(`${Math.round((1 - kept) * 100)}% is lost${orb ? '' : ' to the blockade'}`)}>✕${pct(1 - kept)}</i>` : '');
    }
    out.set(k, `<span class="bout"${tip(`${orb ? 'Orbital' : 'Surface'} output per turn${sh ? ' and who gets it' : ''}`)}>${vals}${rcv}</span>`);
  }
  return out;
}

/** Tribute controls on a world card: offer terms (a rival's system your warships contest) or accept them (yours). */
export function tributeRows(g: GameScreen, r: Region): string {
  const st = g.st, you = g.you;
  if (!contestOn(st) || you === null || r.owner === null || !r.bodies) return '';
  const Y = SY(st);
  const terms = `${Math.round(Y.tributeShare * 100)}% of its output for ${Y.tributeTurns} turns`;
  const pend = g.myFree().find(x => x.type === 'tribute' && x.region === r.id) as Extract<FreeAction, { type: 'tribute' }> | undefined;
  if (r.owner === you) {
    const a = tributeOfferer(st, r.id, 'plan');
    if (a === null) return '';
    const why = g.canPlan ? acceptBlock(st, you, r.id, 'plan') : 'not planning';
    return `<div class="tribute offer" style="--pc:${esc(g.color(a))}"><div class="trib-h"><i>⚖</i><b>${esc(g.pname(a))} offers terms</b></div><small>Pay ${esc(terms)} and the siege lifts; you two won't fight here. Refuse and the siege goes on.</small>` +
      `<button class="mini ${pend ? 'on' : ''}" data-a="tribute-accept"${why && !pend ? ` aria-disabled="true"${tip(`⊘ ${shortWhy(why)}`)}` : tip(pend ? 'Take it back' : 'Free action: accept the terms this turn')}>${pend ? '✓ Accepting ↶' : '⚖ Accept terms'}</button></div>`;
  }
  const why = tributeBlock(st, you, r.id, 'plan');
  if (why && !pend) return '';
  const blocked = !g.canPlan;
  return `<div class="tribute ask"><div class="trib-h"><i>⚖</i><b>Offer terms</b></div><small>${esc(g.pname(r.owner))} pays you ${esc(terms)}; your siege lifts. They can accept next turn.</small>` +
    `<button class="mini ${pend ? 'on' : ''}" data-a="tribute-offer"${blocked ? ' aria-disabled="true"' : tip(pend ? 'Take it back' : 'Free action: offer terms over this system')}>${pend ? '✓ Terms offered ↶' : '⚖ Offer terms'}</button></div>`;
}

/** Card actions for Tribute (free actions, toggled). */
export function tributeAction(g: GameScreen, a: string): boolean {
  if (a !== 'tribute-offer' && a !== 'tribute-accept') return false;
  const sel = g.sel;
  if (!sel || sel.kind !== 'region') return true;
  const rid = sel.id;
  const same = (x: FreeAction) => x.type === 'tribute' && x.region === rid;
  if (g.myFree().some(same)) { dropFree(g, same); return true; }
  setFree(g, a === 'tribute-accept' ? { type: 'tribute', region: rid, accept: true } : { type: 'tribute', region: rid }, same);
  return true;
}

/** Notification chips: terms offered to you, and your blockaded or refugee-losing systems. */
export function systemNotes(g: GameScreen): { key: string; icon: string; text: string; tone: 'bad' | 'gold'; go: () => void }[] {
  const st = g.st, you = g.you, out: { key: string; icon: string; text: string; tone: 'bad' | 'gold'; go: () => void }[] = [];
  if (you === null || !contestOn(st)) return out;
  const at = (r: Region) => () => { g.select({ kind: 'region', id: r.id }); g.focus(r.site); };
  for (const r of st.regions) {
    if (r.owner !== you || !r.bodies) continue;
    if (tributeOfferer(st, r.id, 'plan') !== null && !g.myFree().some(x => x.type === 'tribute' && x.region === r.id)) out.push({ key: `trib${r.id}`, icon: '⚖', text: `Terms for ${r.name.split(' ')[0]}`, tone: 'gold', go: at(r) });
    const S = systemStatus(st, r);
    if (S.blockaded && S.refugeesIn === 1) out.push({ key: `ref${r.id}`, icon: '⚠', text: `Refugees soon: ${r.name.split(' ')[0]}`, tone: 'bad', go: at(r) });
    else if (S.blockaded) out.push({ key: `blk${r.id}`, icon: '⛓', text: `${r.name.split(' ')[0]} blockaded`, tone: 'bad', go: at(r) });
  }
  return out.slice(0, 2);
}

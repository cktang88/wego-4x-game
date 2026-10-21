// Star systems on the world card (docs/SYSTEMS.md): a star line, one compact row per body, the derived role
// badge, citizens x/cap and slots used/total. Stars and bodies are public map knowledge; slots too (buildings are).
import type { GameScreen } from '../game.ts';
import type { Body, Region } from '../../../shared/sim/types.ts';
import { BODIES, ROLES, STARS, STATION } from '../../../shared/config/systems.ts';
import { SY, bodyLine, systemInfo, sysOn } from '../../../shared/sim/systems.ts';
import { esc } from '../ui/dom.ts';
import { tip } from './util.ts';

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
  return `<span class="sysrole role-${info.role}"${tip(`${R.name}: ${R.desc} (derived from the bodies, never chosen)`)}>${R.icon} ${R.name}</span>`;
}

/** Star line + body rows + citizens and slots. Empty for lane waypoints and old maps. */
export function systemRows(g: GameScreen, r: Region): string {
  if (!r.star || r.kind === 'lane') return '';
  const st = g.st;
  const S = STARS[r.star];
  const info = systemInfo(st, r.id);
  const pip = (n: number, max: number) => `<span class="cpips">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
  const top = `<div class="sysrow star"><i style="color:${S.color}">${S.icon}</i><b>${esc(S.name)}</b><small>${esc(S.desc)}</small></div>`;
  const rows = (r.bodies ?? []).map(b => {
    const D = BODIES[b.kind];
    const cap = bodyCap(g, r, b);
    const vein = b.vein ? ` <em class="vein v-${esc(b.vein)}">${b.vein === 'antimatter' ? '⚛' : '◆'}</em>` : '';
    return `<div class="sysrow body"${tip(`${D.name}: ${D.desc}`)}><i>${D.icon}</i><b>${esc(b.name)}</b><small>${esc(bodyLine(b))}${cap ? ` · cap +${cap}` : ''}</small>${vein}</div>`;
  }).join('');
  const station = (r.buildings.station ?? 0) > 0 ? `<div class="sysrow body"${tip(STATION.desc)}><i>${STATION.icon}</i><b>Station</b><small>built · cap +${sysOn(st) ? SY(st).capStation : 1}</small></div>` : '';
  let foot = '';
  if (info) {
    const sl = info.slots;
    const disc = info.waystation ? `<span class="sysdisc"${tip(`Waystation (citizens ≤ ${SY(st).waystationCitizens}): military and logistics projects cost ${Math.round(SY(st).waystationDiscount * 100)}% less`)}>⛯ −${Math.round(SY(st).waystationDiscount * 100)}%</span>` : '';
    const grow = info.role === 'core' && r.owner !== null && info.citizens < info.cap ? `<small${tip('Turns of growth banked: an uncontested Core gains a citizen every few turns')}>↑${info.growth}</small>` : '';
    foot = `<div class="sysfoot">${roleBadge(g, r)}<span class="syscit"${tip(`Citizens ${info.citizens}/${info.cap}: the cap comes from the bodies and the star`)}>☺ ${info.citizens}/${info.cap} ${pip(Math.min(info.citizens, 5), Math.max(info.cap, info.citizens))}${grow}</span>` +
      `<span class="sysslot"${tip('Civil slots (from bodies; a Station adds one): Mine, Trade Hub, Extractor, Academy, Shipyard')}>⚙ ${sl.civilUsed}/${sl.civil}</span>` +
      `<span class="sysslot"${tip(`Military/logistics slots: ${SY(st).milSlots} everywhere, +${SY(st).chokeSlots} at a chokepoint`)}>⛨ ${sl.milUsed}/${sl.mil}${info.choke ? ' ⋈' : ''}</span>${disc}</div>`;
  }
  return `<div class="sys">${top}${rows}${station}${foot}</div>`;
}

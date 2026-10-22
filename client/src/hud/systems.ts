// Star systems on the world card (docs/WORLD-CARD.md §3, §8.3): the painted diorama header (the star, its bodies on
// their orbits, the garrison on the right shoulder, the role crest, one state ribbon), the one evocative system line,
// the face's yield line with its loss note, the bodies as Story rows, and the Tribute prompts (accept terms on your
// world; offer them on a rival's). Stars and bodies are public map knowledge; a fogged system shows only those.
import type { GameScreen } from '../game.ts';
import type { Body, FreeAction, Region } from '../../../shared/sim/types.ts';
import { BODIES, ROLES, STARS, STATION } from '../../../shared/config/systems.ts';
import { SY, BODY_STATION, bodyLine, bodyTag, systemInfo, sysOn, roleOf } from '../../../shared/sim/systems.ts';
import { contestOn, systemStatus, tributeBlock, acceptBlock, tributeOfferer, type Share } from '../../../shared/sim/contest.ts';
import { regionYield, type YieldPart } from '../../../shared/sim/resolve.ts';
import { connected } from '../../../shared/sim/empire.ts';
import { maxGarrison } from '../../../shared/sim/setup.ts';
import { regionIdle } from '../../../shared/sim/signature.ts';
import { tenureTurns, soulOn } from '../../../shared/sim/soul.ts';
import { esc } from '../ui/dom.ts';
import { tip, shortWhy, shortName } from './util.ts';
import { setFree, dropFree } from './soul.ts';
import { ic, icFor } from '../art/icons.ts';
import { starKindOf, starSprite, type StarKind } from '../art/stars.ts';
import { planetSprite, bodyWorldType, regionArt, type WorldType } from '../art/planets.ts';
import { rockSprite } from '../art/structures.ts';
import { drawGlow } from '../art/fx.ts';
import { canvas, h2, strHash } from '../art/util.ts';

// ------------------------------------------------------------------ role: the card's frame
export type RoleKey = 'core' | 'forge' | 'harbor' | 'way';
/** The derived role as the frame key (Core brass, Forge ember, Harbor verdigris, Waystation silver), or null. */
export function roleKey(g: GameScreen, r: Region): RoleKey | null {
  const role = r.kind === 'lane' ? null : roleOf(r);
  if (!role) return r.kind === 'home' || r.kind === 'crown' || r.kind === 'throne' ? 'core' : null;
  return role === 'waystation' ? 'way' : role;
}
const KIND_WORD: Record<string, string> = { home: 'Capital', colony: 'Colony', crown: 'Crown', throne: 'Throne', relic: 'Relic site', void: 'Void' };
/** The engraved crest word on the art (role, else what the region is). */
function crest(g: GameScreen, r: Region): string {
  const role = r.kind === 'lane' ? null : roleOf(r);
  if (role) return `<span class="wc-crest"${tip(`${ROLES[role].name}: ${ROLES[role].desc} Derived from the bodies, never chosen.`)}>${ic(icFor('role', role, ROLES[role].icon))}${esc(ROLES[role].name)}</span>`;
  const w = KIND_WORD[r.kind];
  return w ? `<span class="wc-crest">${ic(r.kind === 'throne' ? 'throne' : r.kind === 'crown' ? 'crown' : 'colony')}${esc(w)}</span>` : '';
}

// ------------------------------------------------------------------ the one evocative system line
const STAR_WORD: Record<string, string> = { yellow: 'Yellow sun', red: 'Red sun', blue: 'Blue giant', binary: 'Twin suns', pulsar: 'Pulsar', blackhole: 'Black hole' };
const bare = (n: string) => n.replace(/^the\s+/i, '');
function bodyWord(b: Body, first: boolean): string {
  const a = (w: string) => (first ? w : `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w}`);
  switch (b.kind) {
    case 'habitable': return a(`${b.adj ?? (b.q === 'poor' ? 'harsh' : 'living')} world`);
    case 'gas': return a('gas giant');
    case 'belt': return a('belt');
    case 'moon': return a('moon');
    case 'barren': return a(b.q === 'rich' ? 'forge world' : 'barren rock');
    case 'ruin': return first ? 'ruins' : 'ruins';
  }
}
/** "Yellow sun · garden world, a moon, a belt" (empty for lanes and maps without stars). */
export function sysLine(g: GameScreen, r: Region): string {
  if (!r.star || r.kind === 'lane') return '';
  const star = STAR_WORD[r.star] ?? STARS[r.star as keyof typeof STARS]?.name ?? '';
  const bodies = (r.bodies ?? []).slice().sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  const words = bodies.map((b, i) => bodyWord(b, i === 0));
  if ((r.buildings.station ?? 0) > 0) words.push('a station');
  return [star, words.join(', ')].filter(Boolean).join(' · ');
}

// ------------------------------------------------------------------ the diorama
const ORDER: Record<string, number> = { habitable: 0, gas: 1, barren: 2, moon: 3, belt: 4, ruin: 5, station: 6 };
/** Body slots as fractions of the art box: a row riding the orbits to the right of the star, clear of the garrison
 *  (top right), the crest (bottom left) and the ribbon (bottom right). */
const SLOTS: [number, number][] = [[0.37, 0.45], [0.53, 0.57], [0.67, 0.64], [0.795, 0.6]];
const STAR_AT: [number, number] = [0.14, 0.52];
interface ArtItem { idx: number; kind: string; type: WorldType | null; d: number; ring: boolean; seed: number; hue: number; name: string; vein?: string | null; relic?: boolean }

function artItems(g: GameScreen, r: Region): ArtItem[] {
  const seed = (strHash(r.name) ^ Math.imul(r.id + 1, 2654435761)) >>> 0;
  if (r.bodies && r.star) {
    const out: ArtItem[] = r.bodies.map((b, i) => {
      const type = bodyWorldType(b, r.kind, r.name);
      const d = b.kind === 'habitable' ? (b.q === 'poor' ? 44 : 54) : b.kind === 'gas' ? 44 : b.kind === 'barren' ? (b.q === 'rich' ? 40 : 30) : b.kind === 'moon' ? 22 : b.kind === 'ruin' ? 18 : 44;
      return { idx: i, kind: b.kind, type, d, ring: b.kind === 'gas', seed: (seed * 31 + i * 977) % 100000, hue: (seed + i) % 4, name: b.name, vein: b.vein ?? null, relic: b.kind === 'ruin' && r.relic === 'unclaimed' };
    });
    if ((r.buildings.station ?? 0) > 0) out.push({ idx: BODY_STATION, kind: 'station', type: null, d: 18, ring: false, seed, hue: 0, name: STATION.name });
    return out.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]).slice(0, SLOTS.length);
  }
  // maps from before star systems: the region's painted world and moon
  const art = regionArt(r);
  const out: ArtItem[] = [];
  if (art.body) out.push({ idx: 0, kind: 'world', type: art.body.type, d: 52, ring: !!art.body.ring, seed: art.body.seed, hue: art.body.hue ?? 0, name: r.name });
  if (art.moon) out.push({ idx: 1, kind: 'moon', type: art.moon.type, d: 22, ring: false, seed: art.moon.seed, hue: art.moon.hue ?? 0, name: `${r.name}'s moon` });
  return out;
}

/** What paintArt needs to paint each canvas the HTML refers to (filled while the HTML is built). */
const specs = new Map<string, () => (cv: HTMLCanvasElement, w: number, h: number, dpr: number) => void>();

/**
 * The art strip: a painted diorama of the system with tappable bodies, the garrison plate, the close button, the role
 * crest and the state ribbon. `fog`: only public knowledge, desaturated, garrison "?".
 */
export function sysArt(g: GameScreen, r: Region, o: { fog?: boolean; ribbon?: Ribbon | null; garrison?: string } = {}): string {
  const fog = !!o.fog;
  const kind = starKindOf(r) as StarKind;
  const items = artItems(g, r);
  const bgKey = `bg:${r.id}:${fog ? 1 : 0}:${kind}:${items.map(x => `${x.kind}${x.d}`).join(',')}`;
  specs.set(bgKey, () => (cv, w, h, dpr) => paintBackdrop(cv, w, h, dpr, kind, items, fog, r.id));
  const bodies = items.map((it, k) => {
    const [fx, fy] = SLOTS[k];
    const key = `bd:${r.id}:${it.idx}:${it.kind}:${it.type}:${it.seed}:${fog ? 1 : 0}`;
    specs.set(key, () => (cv, w, h, dpr) => paintBody(cv, w, h, dpr, it, fog));
    const cw = it.ring ? it.d * 2.3 : it.kind === 'belt' ? 58 : it.d * 1.35;
    const ch = it.ring ? it.d * 1.3 : it.kind === 'belt' ? 26 : it.d * 1.35;
    const gem = it.vein ? `<i class="gem v-${esc(it.vein)}">${ic(icFor('vein', it.vein))}</i>` : '';
    return `<button class="bd b-${it.kind}${it.relic ? ' relic' : ''}" style="left:${(fx * 100).toFixed(1)}%;top:${(fy * 100).toFixed(1)}%;--d:${it.d}" data-a="peek" data-peek="body:${r.id}:${it.idx}" aria-label="${esc(bodyLabel(r, it))}"><canvas data-art="${esc(key)}" style="width:calc(${cw.toFixed(0)}px * var(--art-k, 1));height:calc(${ch.toFixed(0)}px * var(--art-k, 1))"></canvas>${gem}</button>`;
  }).join('');
  const star = r.kind === 'lane' ? '' : `<button class="bstar" style="left:${STAR_AT[0] * 100}%;top:${STAR_AT[1] * 100}%" data-a="peek" data-peek="star:${r.id}" aria-label="${esc(r.star ? STARS[r.star as keyof typeof STARS]?.name ?? 'Star' : 'Star')}"></button>`;
  const rb = o.ribbon ? `<span class="ribbon ${o.ribbon.cls}"${o.ribbon.tip ? tip(o.ribbon.tip) : ''}>${o.ribbon.html}</span>` : '';
  return `<div class="wc-art${fog ? ' fog' : ''}"><canvas class="wc-bg" data-art="${esc(bgKey)}" aria-hidden="true"></canvas>${star}${bodies}${o.garrison ?? ''}<button class="x" data-a="close" aria-label="Close">${ic('close')}</button>${crest(g, r)}${rb}</div>`;
}
const bodyLabel = (r: Region, it: ArtItem) => `${it.name}: ${it.kind === 'world' ? 'world' : BODIES[it.kind as keyof typeof BODIES]?.name ?? it.kind}`;

/** The garrison plate on the art's right shoulder ("/max" only while it is below max). */
export function garrisonPlate(g: GameScreen, r: Region, fog = false): string {
  if (r.kind === 'lane') return '';
  const known = !fog && r.garrison >= 0;
  const max = known && r.owner !== null ? maxGarrison(g.st, r.id) : null;
  const dmg = max !== null && r.garrison < max;
  const col = r.owner === null ? 'var(--k-steel-300, #9aa1ae)' : g.color(r.owner);
  return `<span class="garr" style="--gc:${esc(col)}"${tip(known ? `Garrison ${r.garrison}${max !== null ? ` of ${max}` : ''}: it rebuilds by itself` : 'Garrison unknown: out of sight')}>${ic('garrison')}<b>${known ? r.garrison : '?'}</b>${dmg ? `<small>/${max}</small>` : ''}</span>`;
}

/** Paint every canvas[data-art] under root from the specs (after the card's HTML lands). */
export function paintArt(root: ParentNode) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  for (const cv of root.querySelectorAll<HTMLCanvasElement>('canvas[data-art]')) {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) continue;
    const sig = `${cv.dataset.art}|${w}x${h}@${dpr}`;
    if (cv.dataset.painted === sig) continue;
    const mk = specs.get(cv.dataset.art ?? '');
    if (!mk) continue;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    try { mk()(cv, w, h, dpr); } catch { /* art is decoration: a failed bake leaves the plate dark */ }
    cv.dataset.painted = sig;
  }
}

const bdCache = new Map<string, HTMLCanvasElement>();
function paintBackdrop(cv: HTMLCanvasElement, w: number, h: number, dpr: number, kind: StarKind, items: ArtItem[], fog: boolean, rid: number) {
  const key = `${rid}|${kind}|${w}x${h}@${dpr}|${fog ? 1 : 0}|${items.map(x => x.kind).join(',')}`;
  let src = bdCache.get(key);
  if (!src) {
    src = canvas(w * dpr, h * dpr);
    const g = src.getContext('2d')!;
    g.scale(dpr, dpr);
    // the felt behind the system: dark, lit warm from the upper left
    const bg = g.createRadialGradient(0, h * 0.5, 0, 0, h * 0.5, w * 1.1);
    bg.addColorStop(0, fog ? '#1b1c20' : '#221f22'); bg.addColorStop(0.55, '#111217'); bg.addColorStop(1, '#08090c');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    // a few far stars
    g.fillStyle = 'rgba(255,244,220,0.55)';
    for (let i = 0; i < 26; i++) { const x = h2(rid, i) * w, y = h2(rid, i + 99) * h, s = 0.3 + h2(rid, i + 7) * 0.8; g.globalAlpha = 0.2 + h2(rid, i + 3) * 0.5; g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
    const k = h / 112;
    const sx = STAR_AT[0] * w, sy = STAR_AT[1] * h;
    // orbits through each body (a tilted tabletop plane), the belt's as a dotted ring
    items.forEach((it, i) => {
      const [fx, fy] = SLOTS[i];
      const dx = fx * w - sx, dy = fy * h - sy, f = 0.34;
      const a = Math.sqrt(dx * dx + (dy / f) ** 2);
      g.save();
      if (it.kind === 'belt') { g.setLineDash([1.6 * k, 4.2 * k]); g.lineCap = 'round'; g.lineWidth = 2.6 * k; g.strokeStyle = fog ? 'rgba(150,150,160,0.28)' : 'rgba(205,188,156,0.42)'; }
      else { g.lineWidth = 1; g.strokeStyle = fog ? 'rgba(170,170,190,0.08)' : 'rgba(255,236,200,0.1)'; }
      g.beginPath(); g.ellipse(sx, sy, a, a * f, 0, 0, Math.PI * 2); g.stroke();
      g.restore();
    });
    // the star: the map's own painted sprite, big
    const rc = 0.29 * h;
    const s = starSprite(kind, rc * dpr, fog, false);
    const sc = (rc * dpr) / s.R / dpr;
    g.drawImage(s.img, sx - (s.size * sc) / 2, sy - (s.size * sc) / 2, s.size * sc, s.size * sc);
    bdCache.set(key, src);
    if (bdCache.size > 24) bdCache.delete(bdCache.keys().next().value!);
  }
  const g2 = cv.getContext('2d')!;
  g2.clearRect(0, 0, cv.width, cv.height);
  g2.drawImage(src, 0, 0);
}
function paintBody(cv: HTMLCanvasElement, w: number, h: number, dpr: number, it: ArtItem, fog: boolean) {
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const k = w / (it.ring ? it.d * 2.3 : it.kind === 'belt' ? 58 : it.d * 1.35);
  const d = it.d * k;
  if (it.kind === 'belt') {
    // rubble strewn along a short arc of the belt
    for (let i = 0; i < 11; i++) {
      const t = i / 10, x = w * (0.06 + t * 0.88), y = h * (0.62 - Math.sin(t * Math.PI) * 0.34) + (h2(it.seed, i) - 0.5) * h * 0.18;
      const sz = (2.2 + h2(it.seed, i + 20) * 3.4) * k;
      const rk = rockSprite(Math.floor(h2(it.seed, i + 40) * 8), sz * dpr);
      g.drawImage(rk, x - rk.width / dpr / 2, y - rk.height / dpr / 2, rk.width / dpr, rk.height / dpr);
    }
    return;
  }
  if (it.kind === 'ruin') {
    const s = d * 0.42;
    if (!fog) drawGlow(g, cx, cy, s * 2.8, [255, 220, 140], it.relic ? 0.6 : 0.3);
    g.beginPath(); g.moveTo(cx, cy - s * 1.25); g.lineTo(cx + s, cy); g.lineTo(cx, cy + s * 1.25); g.lineTo(cx - s, cy); g.closePath();
    const gr = g.createLinearGradient(cx - s, cy - s, cx + s, cy + s); gr.addColorStop(0, '#fbedc8'); gr.addColorStop(0.5, '#dcb46c'); gr.addColorStop(1, '#6b4a1c');
    g.fillStyle = gr; g.fill(); g.lineWidth = 0.8; g.strokeStyle = 'rgba(40,24,4,0.9)'; g.stroke();
    return;
  }
  if (it.kind === 'station') {
    const s = d * 0.45;
    g.beginPath();
    for (let j = 0; j < 6; j++) { const a = (j / 6) * Math.PI * 2 + 0.3; const qx = cx + Math.cos(a) * s, qy = cy + Math.sin(a) * s; if (j) g.lineTo(qx, qy); else g.moveTo(qx, qy); }
    g.closePath();
    const gr = g.createLinearGradient(cx - s, cy - s, cx + s, cy + s); gr.addColorStop(0, '#e6e9f0'); gr.addColorStop(1, '#5b6170');
    g.fillStyle = gr; g.fill(); g.lineWidth = 0.8; g.strokeStyle = 'rgba(5,3,12,0.9)'; g.stroke();
    return;
  }
  const type = it.type ?? 'barren';
  const sp = planetSprite({ type, seed: it.seed, hue: it.hue, ring: it.ring, dev: 0 }, (d / 2) * dpr, false);
  const sc = ((d / 2) * dpr) / sp.R / dpr;
  // a soft contact shadow so the world sits on the felt
  g.fillStyle = 'rgba(4,2,10,0.35)'; g.beginPath(); g.ellipse(cx + d * 0.06, cy + d * 0.08, d * 0.55, d * 0.55, 0, 0, Math.PI * 2); g.fill();
  g.drawImage(sp.img, cx - (sp.size * sc) / 2, cy - (sp.size * sc) / 2, sp.size * sc, sp.size * sc);
}

// ------------------------------------------------------------------ peeks: a body, the star
/** What one body adds to the citizens cap (for its line), or 0. */
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
/** A body's role in a few words: "citizens +1", "Mine site", "+4¢ a turn", "relics are dug here". */
function bodyUse(g: GameScreen, r: Region, b: Body): string {
  const cap = bodyCap(g, r, b);
  switch (b.kind) {
    case 'habitable': return `citizens ${cap}`;
    case 'gas': return `+${g.st.rules.empire?.gasCredits ?? 4}¢ a turn · Trade Hub site`;
    case 'belt': return 'Mine site';
    case 'moon': return cap ? `citizens +${cap}` : 'a Bulwark: garrison ×1.5';
    case 'barren': return b.q === 'rich' ? `Forge: +1⚙ per citizen · citizens +${cap}` : `Mine site · citizens +${cap}`;
    case 'ruin': return r.relic === 'unclaimed' ? 'a relic lies here' : 'relics are dug here';
  }
}
/** The peek for "body:<rid>:<i>" / "star:<rid>": a name, what it is, what it does. */
export function artPeek(g: GameScreen, key: string): string | null {
  const [what, rs, is] = key.split(':');
  const r = g.st.regions[Number(rs)];
  if (!r) return null;
  if (what === 'star') {
    if (!r.star) return `<b>${esc(r.name)}</b><p>${esc(KIND_WORD[r.kind] ?? 'A system')}</p>`;
    const S = STARS[r.star as keyof typeof STARS];
    return `<b>${esc(S?.name ?? r.star)}</b><p>${esc(S?.desc ?? '')}</p>`;
  }
  const i = Number(is);
  if (i === BODY_STATION) return `<b>${esc(STATION.name)}</b><p>${esc(STATION.desc)}</p><p class="d">orbital</p>`;
  const b = r.bodies?.[i];
  if (!b) return `<b>${esc(r.name)}</b>`;
  const D = BODIES[b.kind];
  const tag = bodyTag(g.st, r, i);
  const out = r.owner === g.you ? bodyOutputs(g, r).get(i) : undefined;
  const vein = b.vein ? ` · ${b.vein === 'antimatter' ? 'antimatter' : 'crystal'} vein` : '';
  return `<b>${esc(b.name)}${tag ? ` <em>${esc(tag)}</em>` : ''}</b><p>${esc(bodyLine(b))} · ${esc(bodyUse(g, r, b))}${esc(vein)} · ${D.orbital ? 'orbital' : 'surface'}</p>${out?.vals ? `<p class="stats">${out.vals} a turn</p>` : ''}<p class="d">${esc(D.orbital ? 'Its output goes to whoever holds space.' : 'Blockaded while an enemy holds space.')}</p>`;
}

/** The Story tab's system block: the star and every body, one row each. */
export function storyBodies(g: GameScreen, r: Region): string {
  if (!r.star || r.kind === 'lane') return '';
  const S = STARS[r.star as keyof typeof STARS];
  const out = r.owner !== null ? bodyOutputs(g, r) : new Map();
  const items = artItems(g, r);
  const thumb = (it: ArtItem | undefined) => it ? `<canvas data-art="bd:${r.id}:${it.idx}:${it.kind}:${it.type}:${it.seed}:0" style="width:${it.ring ? 44 : 28}px;height:28px" aria-hidden="true"></canvas>` : '';
  // the story rows reuse the art's body specs (registered by sysArt on the face)
  for (const it of items) { const key = `bd:${r.id}:${it.idx}:${it.kind}:${it.type}:${it.seed}:0`; if (!specs.has(key)) specs.set(key, () => (cv, w, h, dpr) => paintBody(cv, w, h, dpr, { ...it, d: it.ring ? 24 : 26 }, false)); }
  const rows = [`<div class="body"><i class="bi star" style="color:${esc(S?.color ?? '#ffd76a')}">${ic(icFor('star', r.star, S?.icon))}</i><span><b>${esc(S?.name ?? r.star)}</b></span><em>${esc((S?.desc ?? '').replace(/\.$/, '').toLowerCase())}</em></div>`];
  (r.bodies ?? []).forEach((b, i) => {
    const it = items.find(x => x.idx === i);
    const tag = bodyTag(g.st, r, i);
    const o = out.get(i);
    rows.push(`<div class="body">${it ? `<i class="bi">${thumb(it)}</i>` : `<i class="bi">${ic(icFor('body', b.kind))}</i>`}<span><b>${esc(bare(b.name))}</b> <small>${esc(bodyLine(b))}${tag ? ` · ${esc(tag)}` : ''}</small></span><em>${o?.vals ? o.vals : esc(bodyUse(g, r, b))}</em></div>`);
  });
  if ((r.buildings.station ?? 0) > 0) rows.push(`<div class="body"><i class="bi">${ic('station')}</i><span><b>Station</b> <small>orbital</small></span><em>citizens +${sysOn(g.st) ? SY(g.st).capStation : 1}</em></div>`);
  if (out.get(-1)) rows.push(`<div class="body"><i class="bi">${ic('star')}</i><span><b>Open space</b></span><em>${out.get(-1)!.vals}</em></div>`);
  const split = [...out.values()].some(o => o.rcv);
  const sh = split ? `<div class="syssplit"${tip('Contested: each body\'s output per turn and who gets it')}>${[...out.entries()].filter(([, o]) => o.rcv).map(([k, o]) => {
    const kind = k === BODY_STATION ? 'station' : k === -1 ? null : r.bodies?.[k]?.kind;
    return `<span class="bsplit"><i>${kind ? ic(icFor('body', kind)) : ic('star')}</i>${o.vals}${o.rcv}</span>`;
  }).join('')}</div>` : '';
  return `<div class="bodies">${rows.join('')}</div>${sh}`;
}

// ------------------------------------------------------------------ the state ribbon (one, by priority)
export interface Ribbon { cls: 'war' | 'gold' | 'dim' | 'cut'; html: string; tip?: string }
const nm = (g: GameScreen, p: number | null | undefined) => (p === -1 ? 'the Warden' : p === null || p === undefined ? 'nobody' : shortName(g.pname(p), 1).split(' ').slice(-1)[0]);
const frac = (x: number) => (x >= 0.999 ? '' : x <= 0.001 ? '0' : x === 0.5 ? '½' : Math.abs(x - 1 / 3) < 0.01 ? '⅓' : Math.abs(x - 2 / 3) < 0.01 ? '⅔' : x === 0.25 ? '¼' : `${Math.round(x * 100)}%`);

/** battle / siege > contested > occupied > tribute > cut off > idle / surging > relic > out of sight. */
export function ribbon(g: GameScreen, r: Region, fog = false): Ribbon | null {
  const st = g.st;
  if (fog) return { cls: 'dim', html: `${ic('eye')} out of sight`, tip: 'Fogged: only the star, bodies and role are known' };
  const e = (st.engagements ?? []).find(x => x.region === r.id);
  if (e) return { cls: 'war', html: `${ic('battle')} ${esc(e.name.replace(/ \(.*\)$/, '').split(' ').slice(0, 4).join(' '))}`, tip: e.name };
  const besieged = st.fleets.some(f => f.siege === r.id && f.region === r.id && f.ships.length);
  if (r.owner !== null && contestOn(st) && r.bodies) {
    const S = systemStatus(st, r);
    // a siege is a contest: the contested ribbon says who holds space, which is what the siege decides
    if (S.contested) {
      const who = S.holder === null || S.holder === undefined ? 'no one holds space' : S.holder === r.owner ? `${esc(nm(g, r.owner))} holds space` : `${esc(nm(g, S.holder))} holds space`;
      return { cls: 'war', html: `${ic('chain')} Contested · ${who}`, tip: 'An enemy warship is in the system: no growth; orbital output goes to whoever holds space' };
    }
    if (besieged) return { cls: 'war', html: `${ic('comet')} Under siege` };
    if (S.occupiedLeft > 0) return { cls: 'gold', html: `${ic('occupied')} Occupied · ${S.occupiedScorched ? 'scorched' : `${frac(SY(st).occupiedShare)} output`} · ${S.occupiedLeft}t`, tip: 'Just taken: its new owner gets part of its output for a few turns; its Calling sleeps too' };
    if (S.tribute) return { cls: 'gold', html: `${ic('scales')} Tribute → ${esc(nm(g, S.tribute.to))} · ${S.tributeLeft}t`, tip: `${r.name} pays ${Math.round(SY(st).tributeShare * 100)}% of its output to ${g.pname(S.tribute.to)}` };
  }
  if (besieged) return { cls: 'war', html: `${ic('comet')} Under siege` };
  if (r.owner !== null && r.owner === g.you && st.rules.empire?.enabled !== false && !connected(st, r.owner).has(r.id)) return { cls: 'cut', html: `${ic('chain')} Cut off · ½ yield`, tip: 'Not connected to your capital: half yield' };
  if (regionIdle(st, r)) return { cls: 'dim', html: `${ic('dormant')} Idle to T${r.idleUntil ?? st.turn + 1}`, tip: 'Levies called in vain: no output' };
  if (r.surge === st.turn) return { cls: 'gold', html: `${ic('surge')} Surging ×2` };
  if (r.relic === 'unclaimed') return { cls: 'gold', html: `${ic('relic')} Relic here`, tip: 'A fleet of the owner can Excavate it' };
  if (r.owner !== null && r.owner !== g.you && soulOn(st)) {
    const t = tenureTurns(st, r);
    return { cls: 'dim', html: `<i class="dot" style="--pc:${esc(g.color(r.owner))}"></i>${esc(nm(g, r.owner))}${t > 0 ? ` · held ${t}t` : ''}` };
  }
  return null;
}

// ------------------------------------------------------------------ the face's yield line
export interface FaceYield { i: number; c: number; f: number; note: string; lost: boolean }
/** What this world gives its owner per turn now (the shares of a contested / occupied / tributary system applied),
 *  plus a short note: what is lost and why. Null for lanes and the void. */
export function faceYield(g: GameScreen, r: Region): FaceYield | null {
  const st = g.st, R = st.rules;
  if (r.kind === 'lane' || r.kind === 'void' || r.owner === null || r.owner < 0) return null;
  const conn = R.empire?.enabled !== false ? connected(st, r.owner) : null;
  let base;
  try { base = regionYield(st, r.owner, r, conn, undefined, false); } catch { base = null; }
  const own = r.owner === g.you;
  if (regionIdle(st, r)) return { i: 0, c: 0, f: 0, note: 'idle: levies in vain', lost: true };
  if (!base) return null;
  let i = base.industry, c = base.credits, f = base.influence;
  let note = own ? 'a turn' : 'its yield', lost = false;
  const S = contestOn(st) && r.bodies ? systemStatus(st, r) : null;
  if (S?.shares) {
    let ry;
    try { ry = regionYield(st, r.owner, r, conn, undefined, !!S.shares.contest); } catch { ry = null; }
    const g0 = S.shares.get.get(r.owner);
    if (ry) {
      const o = ry.orbital;
      const k = g0 ?? { o: { i: 0, c: 0, f: 0 }, s: { i: 0, c: 0, f: 0 } };
      const ni = o.i * k.o.i + (ry.industry - o.i) * k.s.i, nc = o.c * k.o.c + (ry.credits - o.c) * k.s.c, nf = o.f * k.o.f + (ry.influence - o.f) * k.s.f;
      const di = Math.round(base.industry - ni), dc = Math.round(base.credits - nc);
      if (S.contested) { note = [di > 0 ? `−${di}⚙` : '', dc > 0 ? `−${dc}¢` : ''].filter(Boolean).join(' ') + ' blockade'; lost = di > 0 || dc > 0; if (!lost) note = 'contested'; }
      else if (S.tribute) { note = `${frac(SY(st).tributeShare)} to ${nm(g, S.tribute.to)}`; lost = true; }
      else if (S.occupiedLeft > 0) { note = S.occupiedScorched ? 'scorched: nothing' : `${frac(SY(st).occupiedShare)} output · ${S.occupiedLeft}t`; lost = true; }
      i = ni; c = nc; f = nf;
    }
  } else if (base.cut) { note = 'cut off · ½'; lost = true; }
  if (r.surge === st.turn) note = 'Surge ×2';
  return { i: Math.round(i), c: Math.round(c), f: Math.round(f), note, lost };
}

// ------------------------------------------------------------------ each body's output, and who gets it
/** Each body's output (industry, credits, influence) and, while shared, who gets it; key -1 = open space. Owned
 *  systems only. */
function bodyOutputs(g: GameScreen, r: Region): Map<number, { vals: string; rcv: string }> {
  const out = new Map<number, { vals: string; rcv: string }>();
  const st = g.st;
  if (!sysOn(st) || r.owner === null || r.owner < 0 || !r.bodies || r.kind === 'lane') return out;
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
    const vals = [i >= 0.5 ? `${ic('industry')}${Math.round(i)}` : '', c >= 0.5 ? `${ic('credits')}${Math.round(c)}` : '', f >= 0.5 ? `${ic('influence')}${Math.round(f)}` : ''].filter(Boolean).join(' ');
    let rcv = '';
    if (sh) {
      const lane = (x: Share) => (orb ? x.o : x.s);
      const cut = (x: Share) => { const l = lane(x); return i >= c ? l.i : l.c; };
      const parts = [...sh.get].map(([p, x]) => ({ p, k: cut(x) })).filter(x => x.k > 0.001);
      const kept = parts.reduce((a, x) => a + x.k, 0);
      rcv = parts.map(x => `<i class="rcv" style="--pc:${esc(g.color(x.p))}"${tip(`${g.pname(x.p)} gets ${Math.round(x.k * 100)}%`)}>${frac(x.k) || '●'}</i>`).join('') +
        (kept < 0.999 ? `<i class="rcv lost"${tip(`${Math.round((1 - kept) * 100)}% is lost${orb ? '' : ' to the blockade'}`)}>${ic('close')}${frac(1 - kept)}</i>` : '');
    }
    out.set(k, { vals, rcv });
  }
  return out;
}

/** Citizens growth for the Improve tab: turns to the next citizen at a Core, or why it isn't growing. */
export function growthLine(g: GameScreen, r: Region): { auto: boolean; text: string; next: string } {
  const info = systemInfo(g.st, r.id);
  if (!info) return { auto: false, text: '', next: '' };
  const Y = SY(g.st);
  if (info.role !== 'core') return { auto: false, text: `cap ${info.cap} · Works can add one`, next: info.citizens >= info.cap ? 'at cap' : '' };
  if (info.citizens >= info.cap) return { auto: true, text: `grow by themselves · cap ${info.cap}`, next: 'at cap' };
  if (contestOn(g.st) && systemStatus(g.st, r).contested) return { auto: true, text: 'no growth while contested', next: 'halted' };
  const garden = r.kind === 'colony' && r.bodies?.some(b => b.kind === 'habitable' && b.q === 'rich');
  const every = Math.max(1, garden ? Y.gardenGrowthEvery : Y.growthEvery);
  return { auto: true, text: `grow by themselves · cap ${info.cap}`, next: `+1 in ${Math.max(1, every - info.growth)}t` };
}

// ------------------------------------------------------------------ Tribute: a prompt on your world, an offer on theirs
const termsOf = (g: GameScreen) => { const Y = SY(g.st); return { pct: Math.round(Y.tributeShare * 100), frac: frac(Y.tributeShare), turns: Y.tributeTurns }; };
const pendTrib = (g: GameScreen, rid: number) => g.myFree().find(x => x.type === 'tribute' && x.region === rid) as Extract<FreeAction, { type: 'tribute' }> | undefined;
/** Terms you've been refused for this turn (the prompt goes away; it comes back next turn if they offer again). */
const refused = new Set<string>();

/** Your world, a besieger offers terms: the prompt that takes the face for this turn (Accept / Refuse). */
export function termsPrompt(g: GameScreen, r: Region): string {
  const st = g.st, you = g.you;
  if (!contestOn(st) || you === null || r.owner !== you || !r.bodies) return '';
  const a = tributeOfferer(st, r.id, 'plan');
  if (a === null || refused.has(`${st.turn}:${r.id}`)) return '';
  const T = termsOf(g);
  const pend = pendTrib(g, r.id);
  const why = g.canPlan ? acceptBlock(st, you, r.id, 'plan') : 'not planning';
  return `<div class="prompt terms" style="--pc:${esc(g.color(a))}"><div class="ph"><span>${ic('scales')} ${esc(nm(g, a))} offers terms</span><small>free · this turn</small></div>
    <p>Pay ${T.frac} of its output for ${T.turns} turns; the siege lifts.</p>
    <div class="acts"><button class="yes ${pend ? 'on' : ''}" data-a="tribute-accept"${why && !pend ? ` aria-disabled="true"${tip(`⊘ ${shortWhy(why)}`)}` : tip(pend ? 'Take it back' : 'Free action: accept the terms this turn')}>${ic(pend ? 'check' : 'scales')} ${pend ? 'Accepting ↶' : 'Accept'}</button>${pend ? '' : '<button data-a="tribute-refuse">Refuse</button>'}</div></div>`;
}
/** A rival's world your warships contest: offer them terms (on the foreign card). */
export function termsOffer(g: GameScreen, r: Region): string {
  const st = g.st, you = g.you;
  if (!contestOn(st) || you === null || r.owner === null || r.owner === you || !r.bodies) return '';
  const pend = pendTrib(g, r.id);
  if (tributeBlock(st, you, r.id, 'plan') && !pend) return '';
  const T = termsOf(g);
  return `<div class="prompt offer"><div class="ph"><span>${ic('scales')} Offer terms</span><small>free · this turn</small></div>
    <p>${esc(nm(g, r.owner))} pays you ${T.frac} of its output for ${T.turns} turns; your siege lifts.</p>
    <div class="acts"><button class="yes ${pend ? 'on' : ''}" data-a="tribute-offer"${!g.canPlan ? ' aria-disabled="true"' : tip(pend ? 'Take it back' : 'Free action: they can accept next turn')}>${ic(pend ? 'check' : 'scales')} ${pend ? 'Terms offered ↶' : 'Offer terms'}</button></div></div>`;
}

/** Card actions for Tribute (free actions, toggled; Refuse just clears the prompt for this turn). */
export function tributeAction(g: GameScreen, a: string): boolean {
  if (a !== 'tribute-offer' && a !== 'tribute-accept' && a !== 'tribute-refuse') return false;
  const sel = g.sel;
  if (!sel || sel.kind !== 'region') return true;
  const rid = sel.id;
  if (a === 'tribute-refuse') { refused.add(`${g.st.turn}:${rid}`); g.renderAll(); return true; }
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
    if (tributeOfferer(st, r.id, 'plan') !== null && !g.myFree().some(x => x.type === 'tribute' && x.region === r.id)) out.push({ key: `trib${r.id}`, icon: '⚖', text: `Terms for ${shortName(r.name, 2)}`, tone: 'gold', go: at(r) });
    const S = systemStatus(st, r);
    if (S.blockaded && S.refugeesIn === 1) out.push({ key: `ref${r.id}`, icon: '⚠', text: `Refugees soon: ${shortName(r.name, 2)}`, tone: 'bad', go: at(r) });
    else if (S.blockaded) out.push({ key: `blk${r.id}`, icon: '⛓', text: `${shortName(r.name, 2)} blockaded`, tone: 'bad', go: at(r) });
  }
  return out.slice(0, 2);
}

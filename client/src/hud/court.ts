// The Court on the HUD (docs/SOUL.md §4; the modules live in client/src/court/). A captor's prisoner and an owner's
// ransom letter are one-turn prompts on the face of the world where the commander was taken; Kneel or Defy is one on
// the Throne's face (and opens by itself once per coronation, after the Herald). Each prompt can open its full module
// in a sheet. The urgent ones are nags on the strip's "to do" tab. An exile's whisper panel takes the card slot in
// place of the planning HUD. The crests show who knelt and who defied.
// Gate on the state, never the rules: backfillRules() turns rules.court on for an old save, which has no st.court.
// Sounds (audio.ts vocabulary): terms are a letter (a leaf), turning a commander is cloth (a banner), paying is a
// coin, kneeling a brass plate; execute and defy press the wax seal (irreversible), with the seal's haptic.
import type { GameScreen } from '../game.ts';
import type { Captive, FreeAction, PlayerId, Region } from '../../../shared/sim/types.ts';
import { CR, captiveBlock, ransomBlock, decreeBlock, ransomPrice, turnPrice } from '../../../shared/sim/court.ts';
import { courtPrompts, sameCourtAction, mountCaptiveCard, mountRansomOffer, mountDecreePrompt, mountWhisperPanel, exileDue, type CourtMount, type CourtHandlers } from '../court/index.ts';
import { crest, rankWord, turnWord } from '../court/util.ts';
import { LocalSource } from '../net.ts';
import { esc, overlay } from '../ui/dom.ts';
import { ic, type IconKey } from '../art/icons.ts';
import { portraitImg } from '../art/portraits.ts';
import { audio } from '../audio/audio.ts';
import { haptic } from '../fx/haptics.ts';
import { setFree, dropFree } from './soul.ts';
import { tip, shortWhy, shortName } from './util.ts';

type Fa<T extends FreeAction['type']> = Extract<FreeAction, { type: T }>;

/** The strip's free-change icons for the Court's free actions. */
export const COURT_FREE_ICON: Record<string, IconKey> = { captive: 'chain', ransom: 'purse', decree: 'crown', exile: 'ghost' };

/** "Maximiliana Throckmorton" → "Throckmorton" (the face is narrow; the sheet has the full name). */
const surname = (n: string) => n.split(/\s+/).filter(w => /^[A-Z]/.test(w)).slice(-1)[0] ?? n;
const turns = (n: number) => `${n} turn${n === 1 ? '' : 's'}`;
const pendOf = <T extends FreeAction['type']>(g: GameScreen, type: T, pred: (x: Fa<T>) => boolean = () => true) =>
  g.myFree().find(x => x.type === type && pred(x as Fa<T>)) as Fa<T> | undefined;
const dis = (why: string | null) => (why ? ` aria-disabled="true"${tip(`⊘ ${shortWhy(why)}`)}` : '');
const throneOf = (g: GameScreen) => g.st.regions.find(r => r.kind === 'throne');

// ------------------------------------------------------------------ feel
/** The sound and haptic of a Court choice (nothing new: the audio and haptics vocabularies). */
export function courtFeel(fa: FreeAction) {
  switch (fa.type) {
    case 'captive':
      if (fa.act === 'execute') { audio.ui('seal'); haptic('seal'); }
      else if (fa.act === 'turn') { audio.touch('cloth'); haptic('slot'); }
      else { audio.touch('leaf'); haptic('slot'); }
      return;
    case 'ransom': if (fa.pay) { audio.ui('coin'); haptic('coin'); } else { audio.touch('smudge'); haptic('slot'); } return;
    case 'decree': if (fa.answer === 'defy') { audio.ui('seal'); haptic('seal'); } else { audio.touch('brass'); haptic('slot'); } return;
    case 'exile': audio.touch('smudge'); haptic('posture'); return;
  }
}
/** The wax is warmed: the first press of a two-press seal. */
const armFeel = () => { audio.touch('tok'); haptic('lift'); };

// ------------------------------------------------------------------ plan plumbing
function act(g: GameScreen, fa: FreeAction) {
  if (!g.canPlan) return;
  courtFeel(fa);
  setFree(g, fa, sameCourtAction(fa));
}
function undo(g: GameScreen, match: (fa: FreeAction) => boolean) {
  if (!g.canPlan || g.live) return;
  audio.ui('close');
  dropFree(g, match);
}
const handlers = (g: GameScreen): CourtHandlers => ({ onAction: fa => act(g, fa), ...(g.live ? {} : { onClear: m => undo(g, m) }) });

/** An exile's whisper or ghost vote: `canPlan` is false for an eliminated seat, so it goes straight to the source. */
export function exileSend(g: GameScreen, fa: FreeAction) {
  const you = g.you;
  if (you === null || g.st.winner !== null) return;
  courtFeel(fa);
  if (g.src instanceof LocalSource) g.src.exileFree(you, fa);
  else if (g.live) g.src.liveFree?.(fa);
  else g.src.submit({ orders: [], free: [fa] });
  g.renderAll();
}
/** What the exile has sent and not yet seen resolved (its submission, or its LIVE queue). */
function exilePending(g: GameScreen): FreeAction[] {
  if (g.live) return g.myFree();
  if (g.src instanceof LocalSource) return g.you !== null ? g.src.save.pending[g.you]?.free ?? [] : [];
  return g.src.mySubmission?.free ?? [];
}

// ------------------------------------------------------------------ the two-press seals on the card face
let armed = '';
const armKey = (g: GameScreen, k: string) => `${g.gameKey()}:${g.you}:${g.st.turn}:${k}`;

// ------------------------------------------------------------------ card face prompts
/** The Court's prompts on a world's face: prisoners taken there, a letter about your commander taken there, the Throne. */
export function courtFace(g: GameScreen, r: Region): string {
  const st = g.st, you = g.you, ct = st.court;
  if (!ct || you === null || st.winner !== null || st.players[you]?.eliminated) return '';
  let html = '';
  for (const c of ct.captives) {
    if (c.region !== r.id) continue;
    if (c.captor === you) html += captiveFace(g, c);
    else if (c.owner === you) html += ransomFace(g, c);
  }
  if (r.kind === 'throne' && ct.coronation) html += decreeFace(g);
  // several prisoners can share a world: the prompts scroll in their own well, so the face stays bounded
  return html ? `<div class="ct-fps">${html}</div>` : '';
}

function captiveFace(g: GameScreen, c: Captive): string {
  const st = g.st, you = g.you!;
  const owner = st.players[c.owner];
  const pend = pendOf(g, 'captive', x => x.id === c.id);
  const open = c.acted !== st.turn && (!c.offer || (c.refused ?? null) !== null);
  const can = g.canPlan;
  const nm = surname(c.cmd.name);
  const por = portraitImg({ name: c.cmd.name, color: owner?.color ?? '#888', scars: (c.scars ?? []).map(x => x.id), rank: c.cmd.rank, legend: c.cmd.rank >= 5 }, 40, 'ct-fport', `${c.cmd.name}, prisoner`);
  const state = pend ? 'chosen · at seal' : open ? 'free · this turn' : 'decided';
  const head = `<div class="ph"><span>${ic('chain')} Prisoner · ${esc(nm)}</span><small>${state}</small></div>`;
  const who = `<div class="ct-fwho">${por}<p>${esc(rankWord(c.cmd.rank))} of ${esc(owner?.name ?? '?')}. ${c.refused != null && open ? 'They refused your terms. ' : ''}Walks free at the end of ${esc(turnWord(st, c.until))}.</p></div>`;
  const more = `<button data-a="ct-open" data-k="cap:${c.id}">${ic('chain')} Details</button>`;
  let acts: string;
  if (pend) {
    const what = pend.act === 'ransom' ? `Terms: ${ransomPrice(st, c, pend.res ?? 'credits')}${pend.res === 'influence' ? '✦' : '¢'}` : pend.act === 'turn' ? 'Turning' : 'Executing';
    const back = can && !g.live;
    acts = `<div class="acts"><button class="on" data-a="ct-undo" data-k="cap:${c.id}"${back ? tip('Take it back') : ' aria-disabled="true"'}>${ic(pend.act === 'execute' ? 'skull' : pend.act === 'turn' ? 'banner' : 'purse')} ${what}${back ? ' ↶' : ''}</button>${more}</div>`;
  } else if (!open) {
    const o = c.offer;
    const line = o ? `Your terms: ${o.amount}${o.res === 'credits' ? '¢' : '✦'}. ${o.turn < st.turn ? 'They may pay now.' : 'They may pay next turn.'}` : 'You decided this turn.';
    acts = `<p class="ct-fnote">${esc(line)}</p><div class="acts">${more}</div>`;
  } else {
    const why = (a: 'ransom' | 'turn' | 'execute', res?: 'credits') => (can ? captiveBlock(st, you, c.id, a, res) : g.planBlock() ?? 'not now');
    const k = armKey(g, `cap:${c.id}`), hot = armed === k;
    acts = `<div class="acts"><button class="yes" data-a="ct-ransom" data-id="${c.id}" data-res="credits"${dis(why('ransom', 'credits')) || tip('Name the terms; they pay next turn, or you decide again')}>${ic('purse')} Ransom ${ransomPrice(st, c, 'credits')}¢</button><button data-a="ct-turn" data-id="${c.id}"${dis(why('turn')) || tip('Serves you, scars and all')}>${ic('banner')} Turn −${turnPrice(st, c)}✦</button></div>
      <div class="acts"><button class="ct-wax${hot ? ' armed' : ''}" data-a="ct-exec" data-id="${c.id}"${dis(why('execute')) || tip(hot ? 'Press again: it cannot be undone' : `A grievance ${owner?.name ?? 'its house'} never forgets`)}>${ic('skull')} ${hot ? 'Press again' : 'Execute'}</button>${more}</div>`;
  }
  // once decided, the prompt folds to its header and its buttons (several prisoners can share a world)
  return `<div class="prompt ct-fp ct-cap" style="--pc:${esc(g.color(c.owner))}">${head}${pend || !open ? '' : who}${acts}</div>`;
}

function ransomFace(g: GameScreen, c: Captive): string {
  const st = g.st, you = g.you!;
  const pend = pendOf(g, 'ransom', x => x.id === c.id);
  const o = c.offer && c.offer.turn < st.turn ? c.offer : null;
  const nm = surname(c.cmd.name);
  const captor = shortName(g.pname(c.captor), 1);
  const amt = o ? `${o.amount}${o.res === 'credits' ? '¢' : '✦'}` : '';
  const head = `<div class="ph"><span>${ic('scales')} ${esc(captor)} holds ${esc(nm)}</span><small>${pend ? 'chosen · at seal' : o ? 'free · this turn' : 'no terms yet'}</small></div>`;
  const line = o ? `Pay ${amt} and ${nm} comes home at the seal. Refuse, and they decide again.`
    : `${c.offer ? 'Their terms reach you next turn.' : 'They may ransom, turn or execute.'} Free at the end of ${turnWord(st, c.until)}.`;
  const more = `<button data-a="ct-open" data-k="ran:${c.id}">${ic('scales')} Letter</button>`;
  let acts: string;
  if (pend) {
    const back = g.canPlan && !g.live;
    acts = `<div class="acts"><button class="on" data-a="ct-undo" data-k="ran:${c.id}"${back ? tip('Take it back') : ' aria-disabled="true"'}>${ic(pend.pay ? 'purse' : 'close')} ${pend.pay ? `Paying ${amt}` : 'Refused'}${back ? ' ↶' : ''}</button>${more}</div>`;
  } else if (o) {
    const why = g.canPlan ? ransomBlock(st, you, c.id, true) : g.planBlock() ?? 'not now';
    acts = `<div class="acts"><button class="yes" data-a="ct-pay" data-id="${c.id}"${dis(why) || tip(`${nm} comes home at the seal`)}>${ic('purse')} Pay ${amt}</button><button data-a="ct-refuse" data-id="${c.id}"${g.canPlan ? tip('They decide again') : ' aria-disabled="true"'}>${ic('close')} Refuse</button>${more}</div>`;
  } else acts = `<div class="acts">${more}</div>`;
  return `<div class="prompt ct-fp ct-ran" style="--pc:${esc(g.color(c.captor))}">${head}${pend ? '' : `<p>${esc(line)}</p>`}${acts}</div>`;
}

function decreeFace(g: GameScreen): string {
  const st = g.st, you = g.you!, cr = st.court!.coronation!;
  const K = CR(st);
  const left = Math.max(0, cr.until - st.turn + 1);
  const holder = cr.holder === you;
  const mine = cr.answers[you] ?? null;
  const pend = pendOf(g, 'decree');
  const hn = shortName(g.pname(cr.holder), 1);
  const head = `<div class="ph"><span>${ic('throne')} ${holder ? 'Your coronation' : 'Kneel or Defy'}</span><small>${turns(left)} left</small></div>`;
  const line = holder ? `Every rival must Kneel or Defy, in public, by the end of ${turnWord(st, cr.until)}.`
    : mine ? `You ${mine === 'kneel' ? 'knelt to' : 'defied'} ${hn}. The Herald printed it.`
    : `${hn} holds the Throne. Kneel: +${K.kneelInfluence}✦ now, −${K.kneelBreakVp}♛ if you strike it. Silence is Defiance.`;
  const rivals = st.players.filter(p => p.id !== cr.holder && !p.eliminated);
  const fans = `<ul class="ct-fans" aria-label="Answers so far">${rivals.map(p => {
    const a = cr.answers[p.id];
    return `<li class="${a ?? 'silent'}">${crest(st, p.id as PlayerId, 18)}<span>${esc(shortName(p.name, 1))}</span><b>${a === 'kneel' ? 'Kneels' : a === 'defy' ? 'Defies' : 'Silent'}</b></li>`;
  }).join('')}</ul>`;
  const more = `<button data-a="ct-open" data-k="dec">${ic('throne')} Decree</button>`;
  let acts = `<div class="acts">${more}</div>`;
  if (!holder && !mine) {
    if (pend) {
      const back = g.canPlan && !g.live;
      acts = `<div class="acts"><button class="on" data-a="ct-undo" data-k="dec"${back ? tip('Take it back') : ' aria-disabled="true"'}>${ic(pend.answer === 'kneel' ? 'crown' : 'fist')} ${pend.answer === 'kneel' ? 'Kneeling' : 'Defying'}${back ? ' ↶' : ''}</button>${more}</div>`;
    } else {
      const why = g.canPlan ? decreeBlock(st, you, 'kneel') : g.planBlock() ?? 'not now';
      const k = armKey(g, 'dec'), hot = armed === k;
      acts = `<div class="acts"><button class="yes" data-a="ct-kneel"${dis(why) || tip(`+${K.kneelInfluence} influence now`)}>${ic('crown')} Kneel +${K.kneelInfluence}✦</button><button class="ct-wax${hot ? ' armed' : ''}" data-a="ct-defy"${dis(why) || tip(hot ? 'Press again: public, final' : 'Free, and printed in the Herald')}>${ic('fist')} ${hot ? 'Press again' : 'Defy'}</button>${more}</div>`;
    }
  }
  return `<div class="prompt ct-fp ct-dec" style="--pc:${esc(g.color(cr.holder))}">${head}<p>${esc(line)}</p>${fans}${acts}</div>`;
}

/** The card's data-a actions for the Court ('ct-…'). Returns true when it was one. */
export function courtAction(g: GameScreen, a: string, data: DOMStringMap): boolean {
  if (!a.startsWith('ct-')) return false;
  if (a === 'ct-open') { openCourtSheet(g, data.k ?? ''); return true; }
  if (!g.canPlan || !g.st.court) return true;
  const id = Number(data.id);
  const two = (k: string, fa: FreeAction) => {
    const key = armKey(g, k);
    if (armed !== key) { armed = key; armFeel(); g.renderAll(); return; }
    armed = '';
    act(g, fa);
  };
  if (a !== 'ct-exec' && a !== 'ct-defy') armed = '';
  switch (a) {
    case 'ct-ransom': act(g, { type: 'captive', id, act: 'ransom', res: data.res === 'influence' ? 'influence' : 'credits' }); break;
    case 'ct-turn': act(g, { type: 'captive', id, act: 'turn' }); break;
    case 'ct-exec': two(`cap:${id}`, { type: 'captive', id, act: 'execute' }); break;
    case 'ct-pay': act(g, { type: 'ransom', id, pay: true }); break;
    case 'ct-refuse': act(g, { type: 'ransom', id, pay: false }); break;
    case 'ct-kneel': act(g, { type: 'decree', answer: 'kneel' }); break;
    case 'ct-defy': two('dec', { type: 'decree', answer: 'defy' }); break;
    case 'ct-undo': {
      const [k, n] = (data.k ?? '').split(':');
      const cid = Number(n);
      undo(g, k === 'cap' ? x => x.type === 'captive' && x.id === cid : k === 'ran' ? x => x.type === 'ransom' && x.id === cid : x => x.type === 'decree');
      break;
    }
  }
  return true;
}

// ------------------------------------------------------------------ the "to do" nags
/** Urgent Court prompts not yet answered in the plan: the strip's "to do" tab (keys ct-…). */
export function courtNotes(g: GameScreen): { key: string; icon: string; text: string; tone: 'gold' | 'bad'; go: () => void }[] {
  const st = g.st, you = g.you;
  if (you === null || !st.court || !g.canPlan) return [];
  const at = (rid: number | undefined, sheet: string) => () => {
    const r = rid !== undefined ? st.regions[rid] : undefined;
    if (r) { g.select({ kind: 'region', id: r.id }); g.focus(r.site); } else openCourtSheet(g, sheet);
  };
  const out: ReturnType<typeof courtNotes> = [];
  for (const p of courtPrompts(st, you)) {
    if (!p.urgent) continue;
    if (p.kind === 'captive' && !pendOf(g, 'captive', x => x.id === p.id)) {
      const c = st.court.captives.find(x => x.id === p.id);
      out.push({ key: `ct-cap-${p.id}`, icon: '⛓', text: 'Prisoner: decide', tone: 'gold', go: at(c?.region, `cap:${p.id}`) });
    } else if (p.kind === 'ransom' && !pendOf(g, 'ransom', x => x.id === p.id)) {
      const c = st.court.captives.find(x => x.id === p.id);
      out.push({ key: `ct-ran-${p.id}`, icon: '⚖', text: 'Ransom terms arrived', tone: 'bad', go: at(c?.region, `ran:${p.id}`) });
    } else if (p.kind === 'decree' && !pendOf(g, 'decree')) {
      out.push({ key: 'ct-dec', icon: '♛', text: 'Kneel or Defy', tone: 'gold', go: at(throneOf(g)?.id, 'dec') });
    }
  }
  return out;
}

// ------------------------------------------------------------------ the sheet (the full module)
let sheet: { o: HTMLElement; m: CourtMount<any>; props: () => object } | null = null;

/** Open a Court module in a sheet: 'cap:<id>' (captive card), 'ran:<id>' (ransom letter) or 'dec' (the decree). */
export function openCourtSheet(g: GameScreen, key: string) {
  closeCourt();
  if (g.you === null || !g.st.court) return;
  const [kind, n] = key.split(':');
  const id = Number(n);
  const o = overlay(`<div class="dialog ct-sheet" role="dialog" aria-label="${kind === 'dec' ? 'The Coronation' : kind === 'ran' ? 'Ransom terms' : 'Prisoner'}"></div>`);
  o.classList.add('ct-ov');
  const host = o.querySelector<HTMLElement>('.dialog')!;
  const props = () => ({ st: g.st, you: g.you!, pending: g.myFree(), canPlan: g.canPlan, captiveId: id });
  const m = kind === 'cap' ? mountCaptiveCard(host, props(), handlers(g)) : kind === 'ran' ? mountRansomOffer(host, props(), handlers(g)) : mountDecreePrompt(host, props(), handlers(g));
  // the seal's first press warms the wax (the module arms itself; the sound is ours)
  host.addEventListener('click', e => { const s = (e.target as HTMLElement).closest('.k-seal'); if (s && !s.classList.contains('armed') && s.getAttribute('aria-disabled') !== 'true') armFeel(); }, true);
  const mine = { o, m, props };
  sheet = mine;
  o.addEventListener('fx-removed', () => { if (sheet === mine) sheet = null; m.destroy(); });
}
/** Keep an open sheet and the exile panel in step with the game (every renderAll). */
export function refreshCourt(g: GameScreen) {
  if (sheet && !sheet.o.isConnected) sheet = null;
  if (!sheet) return;
  if (g.you === null || !g.st.court) { closeCourt(); return; }
  sheet.m.update(sheet.props());
}
export function closeCourt() { const s = sheet; sheet = null; s?.o.remove(); }

/** Start of a turn: open the decree by itself once per coronation and seat (after the Herald; scripts that keep the
 *  Herald shut, localStorage 'tc.herald.auto' = 'off', keep this shut too). */
export function courtCheck(g: GameScreen) {
  const st = g.st, you = g.you, cr = st.court?.coronation;
  if (!cr || you === null || st.winner !== null || st.players[you]?.eliminated || sheet) return;
  try { if (localStorage.getItem('tc.herald.auto') === 'off') return; } catch { /* */ }
  const k = `tc.court.coro.${g.gameKey()}:${you}`;
  const v = `${cr.holder}:${cr.since}`;
  try { if (localStorage.getItem(k) === v) return; localStorage.setItem(k, v); } catch { return; }
  openCourtSheet(g, 'dec');
  audio.ui('banner');
}

// ------------------------------------------------------------------ the exile's panel (the card slot)
let exile: { el: HTMLElement; m: CourtMount<any>; you: number } | null = null;
let folded = false;

/** The exile's whole HUD: shown instead of the planning HUD while nothing is selected. */
export function renderExile(g: GameScreen, el: HTMLElement) {
  const st = g.st, you = g.you;
  const show = you !== null && !!st.court && st.winner === null && exileDue({ st, you }) && !g.sel && !g.blockingReplay;
  el.classList.toggle('hidden', !show);
  g.root.classList.toggle('in-exile', you !== null && !!st.court && exileDue({ st, you }));
  if (!show) { if (exile) { exile.m.destroy(); exile = null; el.innerHTML = ''; } return; }
  const props = { st, you: you!, pending: exilePending(g), canPlan: true };
  const local = g.src instanceof LocalSource ? g.src : null;
  // local hotseat: the exile has the device; it passes it on when it has whispered (no seal: nothing to seal)
  const pass = !!local && local.humans.length > 0 && local.save.current === you;
  if (!exile || exile.el !== el || exile.you !== you || !el.isConnected || !el.querySelector('.ct-exbody')) {
    exile?.m.destroy();
    el.innerHTML = `<button type="button" class="ct-fold" data-ct="fold" aria-expanded="true">${ic('ghost')}<span>In exile</span>${ic('caret')}</button><div class="ct-exbody"></div><div class="ct-exfoot"></div>`;
    exile = { el, m: mountWhisperPanel(el.querySelector('.ct-exbody')!, props, { onAction: fa => exileSend(g, fa) }), you: you! };
    el.onclick = e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ct]');
      if (!b) return;
      if (b.dataset.ct === 'fold') { folded = !folded; audio.ui('click'); renderExile(g, el); }
      if (b.dataset.ct === 'pass' && g.src instanceof LocalSource) { audio.ui('confirm'); g.src.exilePass(); }
    };
  } else exile.m.update(props);
  el.classList.toggle('folded', folded);
  el.querySelector('.ct-fold')?.setAttribute('aria-expanded', String(!folded));
  const foot = el.querySelector<HTMLElement>('.ct-exfoot')!;
  const fh = pass ? `<button type="button" class="k-btn primary" data-ct="pass">${ic('check')} Done: pass the device</button>` : '';
  if (foot.dataset.html !== fh) { foot.dataset.html = fh; foot.innerHTML = fh; }
}
export function resetCourt() { closeCourt(); exile?.m.destroy(); exile = null; armed = ''; }

// ------------------------------------------------------------------ the crests: who knelt, who defied
/** A crest's Court mark and tooltip words: the crowned holder, a kneel, a defiance, a broken knee, an exile. */
export function crestCourt(g: GameScreen, p: PlayerId): { tip: string; mark: string } {
  const st = g.st, ct = st.court;
  if (!ct) return { tip: '', mark: '' };
  if (ct.exiles.some(e => e.p === p)) return { tip: ' · in exile', mark: `<i class="ct-ans exile" aria-label="In exile">${ic('ghost')}</i>` };
  const cr = ct.coronation;
  const holder = cr?.holder ?? st.throne.owner;
  if (holder === null || holder === undefined) return { tip: '', mark: '' };
  const hn = shortName(g.pname(holder), 1);
  if (p === holder) return cr ? { tip: ` · crowned: rivals answer by turn ${cr.until}`, mark: `<i class="ct-ans crowned" aria-label="Crowned">${ic('throne')}</i>` } : { tip: '', mark: '' };
  const last = [...ct.decrees].reverse().find(d => d.p === p && d.holder === holder);
  const a = cr?.answers[p] ?? (ct.kneels.some(k => k.p === p && k.holder === holder) ? 'kneel' : last?.answer === 'kneel' ? null : last?.answer ?? null);
  if (a === 'kneel') return { tip: ` · knelt to ${hn}`, mark: `<i class="ct-ans kneel" aria-label="Knelt to ${esc(hn)}">${ic('crown')}</i>` };
  if (a === 'defy') return { tip: ` · defied ${hn}${last?.auto ? ' (by silence)' : ''}`, mark: `<i class="ct-ans defy" aria-label="Defied ${esc(hn)}">${ic('fist')}</i>` };
  if (a === 'broke') return { tip: ` · broke its knee to ${hn}`, mark: `<i class="ct-ans broke" aria-label="Broke its knee to ${esc(hn)}">${ic('oathbreaker')}</i>` };
  if (cr && !st.players[p]?.eliminated) return { tip: ` · silent before ${hn}`, mark: '' };
  return { tip: '', mark: '' };
}

/** A Court free action in words (the strip's free-changes list). */
export function courtFreeText(g: GameScreen, x: FreeAction): string | null {
  const c = 'id' in x ? g.st.court?.captives.find(y => y.id === x.id) : undefined;
  const nm = c ? c.cmd.name : 'the prisoner';
  switch (x.type) {
    case 'captive': return x.act === 'ransom' ? `Name terms for ${nm} (${x.res === 'influence' ? 'influence' : 'credits'})` : x.act === 'turn' ? `Turn ${nm}` : `Execute ${nm}`;
    case 'ransom': return x.pay ? `Pay the ransom for ${nm}` : `Refuse the terms for ${nm}`;
    case 'decree': return x.answer === 'kneel' ? `Kneel to ${g.pname(g.st.court?.coronation?.holder ?? null)}` : `Defy ${g.pname(g.st.court?.coronation?.holder ?? null)}`;
    case 'exile': return `Exile: ${x.whisper !== undefined ? `whisper ${g.pname(x.whisper)}` : ''}${x.whisper !== undefined && x.vote !== undefined ? ', ' : ''}${x.vote !== undefined ? `vote ${g.pname(x.vote)}` : ''}`;
  }
  return null;
}

// The HUD over the full-screen board (docs/UX-V2.md §1): turn + phase (top-left), resource pills (top-centre),
// player crests (top-right), notification chips (bottom-left), modal buttons (bottom-right), the plan strip and
// primary button (bottom-centre), the selection card, and the popovers (menu, lens, breakdowns).
// Everything is rendered from the GameScreen's state; handlers are delegated once per container.
import type { GameScreen, Lens } from '../game.ts';
import { LENSES } from '../game.ts';
import { LocalSource } from '../net.ts';
import { incomeDetail, currentLeader, upkeepOf } from '../../../shared/sim/resolve.ts';
import { nextTickAt, tickMs, tickInCycle, orderMs } from '../../../shared/sim/live.ts';
import { esc, overlay, toast } from '../ui/dom.ts';
import { helpHtml } from '../ui/help.ts';
import { empireHtml, bindEmpire } from '../ui/empire.ts';
import { renderStrip, renderPrimary, bindStrip } from './strip.ts';
import { renderCard, bindCard } from './card.ts';
import { renderNotes, bindNotes, resetNotes } from './notify.ts';
import * as M from '../ui/modals.ts';
import { fmtClock, plus, shortName, tip, safeInsets } from './util.ts';
import { fatePill, fatePop } from './signature.ts';
import { ic, icFor } from '../art/icons.ts';
import { audio } from '../audio/audio.ts';
import { openSoundSettings, soundIcon } from '../audio/hooks.ts';
import { canVibrate, haptic, hapticsOn, setHaptics } from '../fx/haptics.ts';
import { openGraphicsSettings } from '../ui/graphics.ts';
import { bannerSvg } from '../art/sigils.ts';
import { enamel } from '../art/bible.ts';
import { signetOf } from '../fx/stage.ts';

type ModalName = 'empire' | 'score' | 'chronicle' | 'help';
interface ModalsModule {
  openModal(g: GameScreen, name: ModalName, tab?: string): void;
  closeModal(): void;
  isModalOpen(): boolean;
  refreshModal?(g?: GameScreen): void;
}
// The full-screen modals (client/src/ui/modals.ts); the fallback below only runs if opening one throws.
const modals: ModalsModule | null = M;
const loadModals = (): Promise<ModalsModule | null> => Promise.resolve(modals);

const lensIcon = (l: Lens) => ic(icFor('lens', l));
const LENS_NAME: Record<Lens, string> = { political: 'Political', supply: 'Supply', economy: 'Economy', military: 'Military' };
const RES_NAME = { industry: 'Industry', credits: 'Credits', influence: 'Influence' } as const;
const RES_WHAT = { industry: 'Builds ships and projects.', credits: 'Pays upkeep, ships and projects.', influence: 'Buys loyalty, laws and pacts.' } as const;

export class Hud {
  h: Record<string, HTMLElement> = {};
  private pop: { kind: string; anchor: HTMLElement | null } | null = null;
  private fallback: HTMLElement | null = null;
  private unbindCard: () => void = () => {};

  constructor(private g: GameScreen) {
    const root = g.el.hud;
    root.innerHTML = `
      <div class="hud-tl" data-h="turn"></div>
      <div class="hud-tc" data-h="res"></div>
      <div class="hud-tr" data-h="crests"></div>
      <div class="hud-bl" data-h="notes"></div>
      <div class="hud-br" data-h="tools"></div>
      <div class="hud-bc" data-h="bottom"><div class="strip" data-h="strip"></div><div class="prim" data-h="primary"></div></div>
      <div class="card hidden" data-h="card"></div>
      <div class="dragcard hidden" data-h="preview"></div>
      <div class="ring hidden" data-h="ring"></div>
      <div class="loupe hidden" data-h="loupe"><canvas width="240" height="240"></canvas><div class="lbl"></div></div>
      <div class="ghost hidden" data-h="ghost"></div>
      <div class="callout hidden" data-h="callout"></div>
      <div class="pop hidden" data-h="pop"></div>
      <div class="banner" data-el="banner"></div>`;
    root.querySelectorAll<HTMLElement>('[data-h]').forEach(e => (this.h[e.dataset.h!] = e));
    g.el.banner = root.querySelector('[data-el=banner]')!;
    // top bar: delegated
    this.h.res.addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-k]'); if (b) this.togglePop('res:' + b.dataset.k, b); });
    this.h.res.addEventListener('pointerover', e => { if (e.pointerType !== 'mouse') return; const b = (e.target as HTMLElement).closest<HTMLElement>('[data-k]'); if (b && this.pop?.kind !== 'res:' + b.dataset.k) this.showPop('res:' + b.dataset.k, b); });
    this.h.res.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && this.pop?.kind.startsWith('res:')) this.closePopovers(); });
    this.h.crests.addEventListener('click', () => this.modal('score'));
    this.h.tools.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!b) return;
      const a = b.dataset.act!;
      if (a === 'menu') { audio.ui('click'); this.togglePop('menu', b); }
      else if (a === 'lens' || a === 'legend') this.togglePop(a, b);
      else this.modal(a as ModalName);
    });
    this.h.pop.addEventListener('click', e => this.popClick(e));
    this.h.pop.addEventListener('change', e => this.popClick(e));
    // a click anywhere else closes a popover
    document.addEventListener('pointerdown', this.outside, true);
    bindStrip(g, this.h.strip, this.h.primary);
    this.unbindCard = bindCard(g, this.h.card);
    bindNotes(g, this.h.notes);
    void loadModals();
  }
  destroy() {
    document.removeEventListener('pointerdown', this.outside, true);
    this.unbindCard();
    resetNotes();
    this.fallback?.remove();
    try { if (modals?.isModalOpen()) modals.closeModal(); } catch { /* */ }
  }
  private outside = (e: PointerEvent) => {
    if (!this.pop) return;
    const t = e.target as HTMLElement;
    if (this.h.pop.contains(t) || this.pop.anchor?.contains(t)) return;
    this.closePopovers();
  };

  // ------------------------------------------------------------------ render
  render() {
    const g = this.g;
    g.root.classList.toggle('spectating', g.you === null);
    g.root.classList.toggle('live', g.live);
    g.root.classList.toggle('replaying', !!g.blockingReplay);
    g.root.classList.toggle('sel-open', !!g.sel);
    { const seat = g.you ?? g.mySeat(); g.root.style.setProperty('--you', seat !== null ? g.color(seat) : '#d9b26a'); }
    this.renderTurn();
    this.renderRes();
    this.renderCrests();
    this.renderTools();
    renderNotes(g, this.h.notes);
    renderStrip(g, this.h.strip);
    renderPrimary(g, this.h.primary);
    renderCard(g, this.h.card);
    if (this.pop) this.showPop(this.pop.kind, this.pop.anchor);
    this.fitTop();
    g.tickClocks();
  }
  /** Keep the resource pills between the turn box and the crests: centred when there is room, else nudged aside
   *  (a touch tablet's taller pills and the Fate label ran into the crests at 1180x820). */
  fitTop() {
    const tc = this.h.res;
    tc.style.marginLeft = '';
    if (this.g.phone || !tc.childElementCount) return;
    const a = tc.getBoundingClientRect(), c = this.h.crests.getBoundingClientRect(), t = this.h.turn.getBoundingClientRect();
    if (!a.width) return;
    let dx = 0;
    if (c.width && a.right > c.left - 8) dx = c.left - 8 - a.right;
    if (t.width && a.left + dx < t.right + 8) dx = t.right + 8 - a.left;
    if (dx) tc.style.marginLeft = `${Math.round(dx)}px`;
  }
  /** Once or twice a second: countdowns and the LIVE tick ring. */
  tick() {
    const g = this.g, st = g.st;
    if (g.live && st.live) {
      const bar = this.h.turn.querySelector<HTMLElement>('.tickbar > i');
      if (bar) { const f = 1 - Math.max(0, nextTickAt(st) - Date.now()) / tickMs(st); bar.style.width = `${(Math.max(0, Math.min(1, f)) * 100).toFixed(1)}%`; }
    }
    const meta = g.src.meta;
    if (meta.deadline) { const d = this.h.turn.querySelector('[data-deadline]'); if (d) d.textContent = fmtClock(meta.deadline - Date.now()); }
  }

  phaseText(): string {
    const g = this.g, st = g.st;
    if (st.winner !== null) return `${shortName(g.pname(st.winner), 1).toUpperCase()} WINS`;
    if (g.replay?.preview) return 'PREVIEW';
    if (g.replay && !g.live) return 'WATCH';
    if (g.watching) return 'WATCH';
    if (g.you === null) return 'SPECTATE';
    if (g.live) return `TICK ${tickInCycle(st) + 1}/${st.rules.live.ticksPerCycle}`;
    if (g.submitted) return 'WAITING';
    return 'PLAN';
  }
  renderTurn() {
    const g = this.g, st = g.st;
    const ph = this.phaseText();
    const dl = g.src.meta.deadline ? ` <span class="dl"${tip('Turn deadline')}>⏱ <b data-deadline>${fmtClock(g.src.meta.deadline - Date.now())}</b></span>` : '';
    const html = g.live
      ? `<div class="turnbox live"><div><b><span class="livedot"></span>CYCLE ${st.turn}</b><span data-el="phase">${esc(ph)} · ⏱ <b data-countdown="${nextTickAt(st)}"></b></span><i class="tickbar"><i></i></i></div></div>`
      : `<div class="turnbox"><div><b>TURN ${st.turn}<small>/${st.rules.victory.turnLimit}</small></b><span data-el="phase" class="ph-${esc(ph.split(' ')[0].toLowerCase())}">${esc(ph)}</span>${dl}</div></div>`;
    if (this.g.setHtml(this.h.turn, html)) { this.g.el.phase = this.h.turn.querySelector('[data-el=phase]')!; this.tick(); }
  }
  renderRes() {
    const g = this.g, st = g.st, me = g.you;
    if (me === null) { g.setHtml(this.h.res, ''); return; }
    const p = st.players[me];
    const inc = incomeDetail(st, me).total;
    const up = upkeepOf(st, me);
    const sp = g.live ? { industry: 0, credits: 0, influence: 0 } : g.plannedSpend();
    const cell = (k: 'industry' | 'credits' | 'influence', icon: string) => {
      const left = p.res[k] - sp[k];
      const d = k === 'credits' ? inc[k] - up : inc[k];
      return `<button class="respill ${left < 0 ? 'short' : ''}" data-k="${k}" aria-label="${RES_NAME[k]} ${left}, ${plus(d)} a ${g.live ? 'cycle' : 'turn'}"><i>${icon}</i><b data-num="res-${k}">${left}</b><small class="${d < 0 ? 'neg' : ''}">${plus(d)}</small></button>`;
    };
    g.setHtml(this.h.res, cell('industry', '⚙') + cell('credits', '¢') + cell('influence', '✦') + fatePill(g));
  }
  renderCrests() {
    const g = this.g, st = g.st, meta = g.src.meta;
    const leader = currentLeader(st);
    const target = st.rules.victory.vpTarget;
    // a League game remembers (DELIGHT #82): the house that took the most from you in this League wears a mark
    const me = g.you ?? g.mySeat();
    const nemesis = new Set((st.league?.nemesis ?? []).filter(n => n.seat === me).map(n => n.of));
    const html = st.players.map(p => {
      const s = meta.seats[p.id];
      const rt = g.replay && !g.replay.preview && g.replay.result.turn === st.turn - 1 ? g.replay.result.turn : null;
      // during the reveal: where the house stood before this turn; during the count-up: the coins landed so far
      const vp = g.vpShown.get(p.id) ?? (rt !== null ? p.vp - p.vpLog.filter(v => v.turn === rt).reduce((a, v) => a + v.amount, 0) : p.vp);
      const frac = Math.max(0, Math.min(1, vp / Math.max(1, target)));
      const sealed = !g.live && s?.submitted && st.winner === null;
      const oath = (p.oathbreaker ?? []).length;
      const nem = nemesis.has(p.id);
      // an enamel heater shield with the house signet in a metal rim (gold for the leader); the VP on a cartouche
      const shield = bannerSvg(signetOf(p.id), enamel(p.color).base, 64, { rim: leader === p.id ? 'gold' : 'silver', broken: !!oath, cls: 'cb-shield' });
      return `<div class="pcrest ${p.id === g.you ? 'you' : ''} ${p.eliminated ? 'out' : ''} ${oath ? 'oath' : ''} ${nem ? 'nemesis' : ''}" style="--pc:${esc(p.color)}" data-crest="${p.id}"${tip(`${p.name}: ${p.vp} of ${target} victory points (♛)${leader === p.id ? ' · in the lead' : ''}${sealed ? ' · orders sealed' : ''}${oath ? ' · Oathbreaker' : ''}${nem ? ' · your nemesis in this League' : ''}`)}>
        <span class="cb">${shield}<b class="vp" data-vp="${p.id}">${vp}</b>${oath ? '<i class="crack" aria-label="Oathbreaker"></i>' : ''}${sealed ? '<i class="sealed wax" aria-label="Orders sealed"></i>' : ''}${nem ? `<i class="nem" aria-label="Your nemesis">${ic('blade')}</i>` : ''}</span>${leader === p.id ? '<i class="lead" aria-label="In the lead">♛</i>' : ''}
        <span class="nm">${s?.online && g.src.kind === 'remote' ? '<i class="on"></i>' : ''}${esc(shortName(p.name, 1))}</span><i class="vpbar"><i style="width:${(frac * 100).toFixed(1)}%"></i></i></div>`;
    }).join('');
    g.setHtml(this.h.crests, `<button class="crests" aria-label="Score: victory points of each player">${html}</button>`);
  }
  renderTools() {
    const g = this.g;
    const emp = g.st.rules.empire?.enabled !== false;
    const dot = (on: boolean) => (on ? '<i class="dot"></i>' : '');
    const newBattles = !!g.st.last?.battles.length && g.st.last.turn >= g.lastSeenTurn && !g.replay;
    // icon + a one-word caption (phones fold Empire / Score / Chronicle into the menu and drop the captions)
    const tool = (act: string, icon: string, label: string, tipText: string, on = false) =>
      `<button class="tool" data-act="${act}"${tip(tipText)} aria-label="${label}"><i class="ti">${icon}</i><span class="tl">${label}</span>${dot(on)}</button>`;
    const html = `${emp ? tool('empire', '✺', 'Empire', 'Empire · E: research, laws, ship designs', g.canResearchNow()) : ''}
      ${tool('score', '♛', 'Score', 'Score · Q: victory points, pacts, chat', g.unreadChat > 0)}
      ${tool('chronicle', ic('chronicle'), 'Chronicle', 'Chronicle · C: what happened each turn', newBattles && false)}
      ${tool('lens', lensIcon(g.lens), LENS_NAME[g.lens], 'Map lens · 1-4: what the map colours show')}
      ${tool('legend', '?', 'Key', 'Map key: what the marks on the map mean')}
      ${tool('menu', '≡', 'Menu', 'Menu: replays, sound, help, save, leave', g.phone && (g.unreadChat > 0 || g.canResearchNow()))}`;
    g.setHtml(this.h.tools, html);
  }

  // ------------------------------------------------------------------ popovers
  togglePop(kind: string, anchor: HTMLElement) { if (this.pop?.kind === kind) this.closePopovers(); else this.showPop(kind, anchor); }
  closePopovers(): boolean {
    if (!this.pop) return false;
    this.pop = null;
    this.h.pop.classList.add('hidden');
    this.h.pop.innerHTML = '';
    return true;
  }
  showPop(kind: string, anchor: HTMLElement | null) {
    const html = this.popHtml(kind);
    if (!html) { this.closePopovers(); return; }
    // re-find a re-rendered anchor
    if (anchor && !anchor.isConnected) {
      anchor = kind.startsWith('res:') ? this.h.res.querySelector(`[data-k="${kind.slice(4)}"]`) : kind === 'menu' || kind === 'lens' || kind === 'legend' ? this.h.tools.querySelector(`[data-act="${kind}"]`) ?? this.h.tools.querySelector('[data-act=menu]') : null;
    }
    this.pop = { kind, anchor };
    const p = this.h.pop;
    p.className = `pop pop-${kind.split(':')[0]}`;
    this.g.keepInputs(p, () => this.g.setHtml(p, html));
    if (!anchor) return;
    const r = anchor.getBoundingClientRect(), w = p.offsetWidth, hh = p.offsetHeight;
    const si = safeInsets(this.g.root);
    const top = r.top < window.innerHeight / 2 ? r.bottom + 8 : r.top - hh - 8;
    p.style.left = `${Math.round(Math.max(8 + si.l, Math.min(window.innerWidth - w - 8 - si.r, r.left + r.width / 2 - w / 2)))}px`;
    p.style.top = `${Math.round(Math.max(8 + si.t, top))}px`;
  }
  private popHtml(kind: string): string {
    const g = this.g, st = g.st;
    if (kind === 'res:fate') return fatePop(g);
    if (kind.startsWith('res:')) {
      const me = g.you;
      if (me === null) return '';
      const k = kind.slice(4) as 'industry' | 'credits' | 'influence';
      const icon = { industry: '⚙', credits: '¢', influence: '✦' }[k];
      const det = incomeDetail(st, me);
      const sp = g.live ? 0 : g.plannedSpend()[k];
      const now = st.players[me].res[k];
      const up = k === 'credits' ? upkeepOf(st, me) : 0;
      const per = g.live ? 'cycle' : 'turn';
      const row = (a: string, b: string, cls = '') => `<div class="r ${cls}"><span>${a}</span><b>${b}</b></div>`;
      const cut = det.why.find(w => /cut off/i.test(w));
      return `<div class="bd"><div class="h">${icon} ${RES_NAME[k]} <b>${now}</b></div><div class="r sub"><span>${RES_WHAT[k]}</span></div>${row('Income', `${plus(det.total[k])}/${per}`, 'good')}${up ? row('Upkeep', `−${up}`, 'bad') : ''}${sp ? row('Planned', `−${sp}`, now - sp < 0 ? 'bad' : '') : ''}${sp ? row('Left', String(now - sp), now - sp < 0 ? 'bad' : '') : ''}${cut ? row('⚠ Cut off', '½', 'bad') : ''}</div>`;
    }
    if (kind === 'legend') return legendHtml();
    if (kind === 'lens') {
      return `<div class="lenses">${LENSES.map((l, i) => `<button class="${g.lens === l ? 'on' : ''}" data-lens="${l}"${tip(`${LENS_NAME[l]} · ${i + 1}`)}><i>${lensIcon(l)}</i><span>${LENS_NAME[l]}</span></button>`).join('')}</div>`;
    }
    if (kind === 'menu') {
      const local = g.src instanceof LocalSource ? g.src : null;
      const emp = st.rules.empire?.enabled !== false;
      const link = g.src.kind === 'remote' && g.you !== null ? `${location.origin}${location.pathname}#/g/${g.src.meta.id}/${(g.src as unknown as { token: string }).token}` : '';
      const item = (x: string, icon: string, label: string, extra = '') => `<button data-m="${x}"${extra}><i>${icon}</i><span>${label}</span></button>`;
      const phoneItems = g.phone ? `<div class="mrow">${emp ? item('empire', '✺', 'Empire', g.canResearchNow() ? ' class="hot"' : '') : ''}${item('score', '♛', 'Score', g.unreadChat ? ' class="hot"' : '')}${item('chronicle', ic('chronicle'), 'Chronicle')}</div>` : '';
      const last = g.live ? (st.live?.tick ?? 0) : st.turn - 1;
      return `<div class="menu">${phoneItems}
        ${g.phone && !g.live && g.canPlan && !g.submitted ? item('preview', ic('eye'), 'Preview my turn', g.plan.orders.some(Boolean) ? '' : ' disabled') : ''}
        ${item('replaylast', '⟲', g.live ? 'Replay tick' : 'Replay turn')}
        ${last >= 1 ? `<label class="mrep"><span>${g.live ? 'Tick' : 'Turn'}</span><input type="number" min="1" max="${last}" value="${Math.max(1, last)}" data-rt><button data-m="replayturn">▶</button></label>` : ''}
        ${item('signals', '◎', `Signals ${g.showSignals ? 'on' : 'off'}`)}
        ${(() => { const m = audio.getSettings().muted; return item('sound', soundIcon(m), `Sound ${m ? 'off' : 'on'}`, `${m ? ' class="off"' : ''} aria-pressed="${!m}"${tip('Mute or unmute · Shift+M')}`); })()}
        ${item('soundset', soundIcon(false), 'Sound settings')}
        ${item('gfx', ic('star'), 'Graphics')}
        ${canVibrate() && g.root.classList.contains('touch') ? item('haptics', ic('bolt'), `Haptics ${hapticsOn() ? 'on' : 'off'}`, `${hapticsOn() ? '' : ' class="off"'} aria-pressed="${hapticsOn()}"`) : ''}
        ${g.phone ? item('legend', '?', 'Map key') : ''}
        ${item('help', ic('help'), 'Help')}
        ${g.you !== null ? item('teach', ic('replay'), 'Teach again') : ''}
        ${local ? item('save', '⤓', 'Save file') : ''}
        ${local ? `<label class="mchk"><input type="checkbox" data-m="reveal" ${local.save.reveal ? 'checked' : ''}><span>Reveal map</span></label>` : ''}
        ${link ? `<label class="mlink"><span>Seat link</span><input value="${esc(link)}" readonly data-copy></label><label class="mlink"><span>Invite</span><input value="${esc(`${location.origin}${location.pathname}#/g/${g.src.meta.id}`)}" readonly data-copy></label>` : ''}
        ${item('exit', '⏏', 'Leave game')}</div>`;
    }
    return '';
  }
  private popClick(e: Event) {
    const g = this.g;
    const t = e.target as HTMLElement;
    const lens = t.closest<HTMLElement>('[data-lens]');
    if (lens && e.type === 'click') { g.setLens(lens.dataset.lens as Lens); this.closePopovers(); return; }
    const cp = t.closest<HTMLInputElement>('[data-copy]');
    if (cp && e.type === 'click') { cp.select(); navigator.clipboard?.writeText(cp.value).then(() => toast('Copied')).catch(() => {}); return; }
    const m = t.closest<HTMLElement>('[data-m]');
    if (!m) return;
    const x = m.dataset.m!;
    if (x === 'reveal') { if (e.type === 'change' && g.src instanceof LocalSource) g.src.setReveal((m as HTMLInputElement).checked); return; }
    if (e.type !== 'click') return;
    if (x === 'signals') { g.toolbar('signals'); return; }
    if (x === 'haptics') { setHaptics(!hapticsOn()); haptic('slot'); if (this.pop) this.showPop(this.pop.kind, this.pop.anchor); return; }
    if (x === 'sound') {
      audio.unlock();
      if (!audio.toggleMute()) audio.ui('click');
      if (this.pop) this.showPop(this.pop.kind, this.pop.anchor);
      return;
    }
    this.closePopovers();
    switch (x) {
      case 'empire': case 'score': case 'chronicle': case 'help': this.modal(x); break;
      case 'replaylast': g.toolbar('replay'); break;
      case 'preview': g.preview(); break;
      case 'replayturn': {
        const n = Math.floor(Number(this.h.pop.querySelector<HTMLInputElement>('[data-rt]')?.value ?? (t.closest('.mrep')?.querySelector('input') as HTMLInputElement | null)?.value));
        const v = Number.isFinite(n) && n >= 1 ? n : 0;
        if (!v) { toast('Pick a number'); return; }
        if (g.st.live) void g.replayTurn(g.turnOfTick(v), v); else void g.replayTurn(v);
        break;
      }
      case 'soundset': openSoundSettings(); break;
      case 'gfx': openGraphicsSettings(); break;
      case 'legend': this.showPop('legend', this.h.tools.querySelector('[data-act=menu]')); break;
      case 'teach': g.restartTeach(); break;
      case 'save': g.exportSave(); break;
      case 'exit': g.onExit(); break;
    }
  }
  openMenu() { this.showPop('menu', this.h.tools.querySelector('[data-act=menu]')); }

  // ------------------------------------------------------------------ modals
  modal(name: ModalName, tab?: string) {
    const g = this.g;
    this.closePopovers();
    g.gest.cancel();
    if (name === 'score') g.unreadChat = 0;
    void loadModals().then(m => {
      if (g.destroyed) return;
      if (m) { try { m.openModal(g, name, tab); g.renderAll(); return; } catch (e) { console.warn('modal failed', e); } }
      this.fallbackModal(name);
    });
  }
  modalOpen(): boolean {
    try { if (modals?.isModalOpen()) return true; } catch { /* */ }
    return !!this.fallback?.isConnected;
  }
  /** Re-render whatever modal is open after a state change. */
  refreshModal() {
    try { if (modals?.isModalOpen()) modals.refreshModal?.(this.g); } catch { /* */ }
    if (this.fallback?.isConnected && this.fallback.dataset.m === 'empire') this.renderFallbackEmpire();
    window.dispatchEvent(new CustomEvent('tc:render'));
  }
  /** The chat is on screen (incoming messages are then read). */
  chatVisible(): boolean { const c = document.querySelector('.chat-log, .chatlog'); return !!c && (c as HTMLElement).offsetParent !== null; }

  /** Minimal stand-ins while client/src/ui/modals.ts is missing. */
  private fallbackModal(name: ModalName) {
    const g = this.g, st = g.st;
    this.fallback?.remove();
    let html = '';
    if (name === 'help') html = `<div class="dialog wide scroll help">${helpHtml(st)}</div>`;
    else if (name === 'empire') html = `<div class="dialog wide scroll"><div class="fb-emp" data-fb-emp></div></div>`;
    else if (name === 'score') html = `<div class="dialog"><h2>Score</h2>${st.players.map(p => `<div class="row"><b style="color:${esc(p.color)}" class="grow">${esc(p.name)}</b><b>${p.vp} ♛</b></div>`).join('')}</div>`;
    else html = `<div class="dialog wide scroll"><h2>Chronicle</h2>${st.chronicle.slice().reverse().slice(0, 40).map(c => `<div class="entry"><b>${c.turn}</b> ${esc(c.text)}</div>`).join('')}</div>`;
    const o = overlay(html);
    o.dataset.m = name;
    this.fallback = o;
    if (name === 'empire') this.renderFallbackEmpire();
  }
  private renderFallbackEmpire() {
    const box = this.fallback?.querySelector<HTMLElement>('[data-fb-emp]');
    if (!box) return;
    this.g.el.tabbody = box;
    this.g.keepInputs(box, () => { box.innerHTML = empireHtml(this.g); });
    bindEmpire(this.g);
  }
}

/** One line for the LIVE bank: "+1 in 3m". */
export function bankNext(g: GameScreen): number { return g.you !== null ? g.st.live?.nextOrderAt[g.you] ?? 0 : 0; }
export { orderMs };

// ------------------------------------------------------------------ the map key ("?" tool)
/** Small drawings of the map's marks, in the map's own manner (render/map.ts): territory wash, crown rings, fleet
 *  counters, lanes, battles, plans, rims, hatching. 32x22 each. */
const K = {
  gold: '#f1d488', you: 'var(--you, #7fb3dc)', foe: '#dc6a66', line: 'rgba(214, 186, 130, 0.55)', amber: '#e4ab4a', contested: '#e8a08e', ink: '#f3ead6',
};
const svg = (body: string) => `<svg class="kg" viewBox="0 0 32 22" width="32" height="22" aria-hidden="true">${body}</svg>`;
const star = (x = 16, y = 11, r = 2.6) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff4cf"/><circle cx="${x}" cy="${y}" r="${r + 2.2}" fill="rgba(255,220,140,0.25)"/>`;
const LEGEND: [string, string][] = [
  [svg(`<path d="M3 4 Q12 1 22 4 L29 12 Q20 21 8 19 Z" fill="rgba(127,179,220,0.28)" stroke="${K.you}" stroke-width="1.6"/>`), 'Coloured territory: who holds it.'],
  [svg(`${star()}<circle cx="16" cy="11" r="7" fill="none" stroke="${K.gold}" stroke-width="1.8"/>`), 'Gold ring: a Crown, worth victory points every turn.'],
  [svg(`${star()}<circle cx="16" cy="11" r="6.5" fill="none" stroke="${K.gold}" stroke-width="1.5"/><circle cx="16" cy="11" r="9.5" fill="none" stroke="${K.gold}" stroke-width="1.2"/>`), 'Double gold ring: the Throne.'],
  [svg(`${star(20)}<circle cx="9" cy="10" r="5" fill="${K.you}" stroke="#c8964a" stroke-width="1"/><text x="9" y="21.5" font-size="6.5" text-anchor="middle" fill="${K.ink}" font-family="Alegreya Sans, sans-serif" font-weight="700">2</text>`), 'Round counter or chevron beside a star: a fleet in that system. Yours always sit on the left; a small number under it: fleets in the stack.'],
  [svg(`<line x1="2" y1="16" x2="30" y2="6" stroke="${K.line}" stroke-width="1.4"/><path d="M13 13.5 l6 -5 l1.5 4 Z" fill="${K.foe}" stroke="#c8964a" stroke-width="0.8"/>`), 'Piece on a lane: a fleet travelling between systems.'],
  [svg(`<path d="M9 4 L23 18 M23 4 L9 18" stroke="#efd59a" stroke-width="2.2" stroke-linecap="round"/><path d="M7 16 l4 4 M25 16 l-4 4" stroke="#efd59a" stroke-width="2.2" stroke-linecap="round"/>`), 'Crossed swords: a battle.'],
  [svg(`<path d="M3 17 L24 6" stroke="${K.you}" stroke-width="1.8" stroke-dasharray="3 2.4"/><path d="M29 3.5 L22 4.5 L25.5 10 Z" fill="${K.you}"/>`), 'Dashed line with arrowhead: a planned move.'],
  [svg(`${star()}<circle cx="16" cy="11" r="7" fill="none" stroke="${K.foe}" stroke-width="1.4"/><path d="M16 1v5 M16 16v5 M6 11h5 M21 11h5" stroke="${K.foe}" stroke-width="1.4"/>`), 'Reticle round a star: a planned attack.'],
  [svg(`<circle cx="16" cy="11" r="5.5" fill="${K.you}"/><circle cx="16" cy="11" r="8.5" fill="none" stroke="${K.ink}" stroke-opacity="0.75" stroke-width="1.6"/>`), 'Breathing rim: your fleet has no orders.'],
  [svg(`<circle cx="16" cy="11" r="5.5" fill="${K.you}"/><circle cx="16" cy="11" r="8.5" fill="none" stroke="${K.amber}" stroke-width="1.6" stroke-dasharray="2.6 2"/>`), 'Amber dashed rim: out of supply.'],
  [svg(`<defs><pattern id="kh" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="${K.you}" stroke-width="1.4"/></pattern></defs><path d="M3 4 Q12 1 22 4 L29 12 Q20 21 8 19 Z" fill="url(#kh)" stroke="${K.you}" stroke-width="1.2"/>`), 'Hatching: cut off from your capital.'],
  [svg(`${star()}<circle cx="16" cy="11" r="7.5" fill="none" stroke="${K.contested}" stroke-width="1.5" stroke-dasharray="2.4 2.2"/>`), 'Dashed ring round a star: a contested system.'],
];
function legendHtml(): string {
  return `<div class="legend" role="list"><div class="lg-h">Map key</div>${LEGEND.map(([i, t]) => `<div class="lg" role="listitem">${i}<span>${esc(t)}</span></div>`).join('')}<div class="lg-f">Hover or tap anything for details.</div></div>`;
}

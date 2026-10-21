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
import { renderNotes, bindNotes } from './notify.ts';
import * as M from '../ui/modals.ts';
import { fmtClock, plus, shortName, tip } from './util.ts';
import { fatePill, fatePop } from './signature.ts';

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

const LENS_ICON: Record<Lens, string> = { political: '◐', supply: '⛓', economy: '⚙', military: '⚔' };
const LENS_NAME: Record<Lens, string> = { political: 'Political', supply: 'Supply', economy: 'Economy', military: 'Military' };

export class Hud {
  h: Record<string, HTMLElement> = {};
  private pop: { kind: string; anchor: HTMLElement | null } | null = null;
  private fallback: HTMLElement | null = null;

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
      if (a === 'menu') this.togglePop('menu', b);
      else if (a === 'lens') this.togglePop('lens', b);
      else this.modal(a as ModalName);
    });
    this.h.pop.addEventListener('click', e => this.popClick(e));
    this.h.pop.addEventListener('change', e => this.popClick(e));
    // a click anywhere else closes a popover
    document.addEventListener('pointerdown', this.outside, true);
    bindStrip(g, this.h.strip, this.h.primary);
    bindCard(g, this.h.card);
    bindNotes(g, this.h.notes);
    void loadModals();
  }
  destroy() {
    document.removeEventListener('pointerdown', this.outside, true);
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
    { const seat = g.you ?? g.mySeat(); g.root.style.setProperty('--you', seat !== null ? g.color(seat) : '#b78bff'); }
    this.renderTurn();
    this.renderRes();
    this.renderCrests();
    this.renderTools();
    renderNotes(g, this.h.notes);
    renderStrip(g, this.h.strip);
    renderPrimary(g, this.h.primary);
    renderCard(g, this.h.card);
    if (this.pop) this.showPop(this.pop.kind, this.pop.anchor);
    g.tickClocks();
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
      return `<button class="respill ${left < 0 ? 'short' : ''}" data-k="${k}" aria-label="${k}"><i>${icon}</i><b data-num="res-${k}">${left}</b><small class="${d < 0 ? 'neg' : ''}">${plus(d)}</small></button>`;
    };
    g.setHtml(this.h.res, cell('industry', '⚙') + cell('credits', '¢') + cell('influence', '✦') + fatePill(g));
  }
  renderCrests() {
    const g = this.g, st = g.st, meta = g.src.meta;
    const leader = currentLeader(st);
    const target = st.rules.victory.vpTarget;
    const html = st.players.map(p => {
      const s = meta.seats[p.id];
      const rt = g.replay && !g.replay.preview && g.replay.result.turn === st.turn - 1 ? g.replay.result.turn : null;
      const vp = rt !== null ? p.vp - p.vpLog.filter(v => v.turn === rt).reduce((a, v) => a + v.amount, 0) : p.vp;
      const frac = Math.max(0, Math.min(1, vp / Math.max(1, target)));
      const sealed = !g.live && s?.submitted && st.winner === null;
      const oath = (p.oathbreaker ?? []).length;
      return `<div class="pcrest ${p.id === g.you ? 'you' : ''} ${p.eliminated ? 'out' : ''} ${oath ? 'oath' : ''}" style="--pc:${esc(p.color)}" data-crest="${p.id}"${tip(`${p.name} · ${p.vp}/${target} ♛${oath ? ' · Oathbreaker' : ''}`)}>
        <span class="cb"><b class="vp" data-num="vp-${p.id}">${vp}</b>${oath ? '<i class="crack" aria-label="Oathbreaker"></i>' : ''}</span>${leader === p.id ? '<i class="lead">♛</i>' : ''}${sealed ? '<i class="sealed">✓</i>' : ''}
        <span class="nm">${s?.online && g.src.kind === 'remote' ? '<i class="on"></i>' : ''}${esc(shortName(p.name, 1))}</span><i class="vpbar"><i style="width:${(frac * 100).toFixed(1)}%"></i></i></div>`;
    }).join('');
    g.setHtml(this.h.crests, `<button class="crests" aria-label="Score">${html}</button>`);
  }
  renderTools() {
    const g = this.g;
    const emp = g.st.rules.empire?.enabled !== false;
    const dot = (on: boolean) => (on ? '<i class="dot"></i>' : '');
    const newBattles = !!g.st.last?.battles.length && g.st.last.turn >= g.lastSeenTurn && !g.replay;
    const html = `${emp ? `<button class="tool" data-act="empire"${tip('Empire · E')} aria-label="Empire">✺${dot(g.canResearchNow())}</button>` : ''}
      <button class="tool" data-act="score"${tip('Score · Q')} aria-label="Score">♛${dot(g.unreadChat > 0)}</button>
      <button class="tool" data-act="chronicle"${tip('Chronicle · C')} aria-label="Chronicle">☰${dot(newBattles && false)}</button>
      <button class="tool" data-act="lens"${tip(`Lens: ${LENS_NAME[g.lens]} · 1-4`)} aria-label="Lens">${LENS_ICON[g.lens]}</button>
      <button class="tool" data-act="menu" aria-label="Menu">≡${dot(g.phone && (g.unreadChat > 0 || g.canResearchNow()))}</button>`;
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
      anchor = kind.startsWith('res:') ? this.h.res.querySelector(`[data-k="${kind.slice(4)}"]`) : kind === 'menu' || kind === 'lens' ? this.h.tools.querySelector(`[data-act="${kind}"]`) : null;
    }
    this.pop = { kind, anchor };
    const p = this.h.pop;
    p.className = `pop pop-${kind.split(':')[0]}`;
    this.g.keepInputs(p, () => this.g.setHtml(p, html));
    if (!anchor) return;
    const r = anchor.getBoundingClientRect(), w = p.offsetWidth, hh = p.offsetHeight;
    const top = r.top < window.innerHeight / 2 ? r.bottom + 8 : r.top - hh - 8;
    p.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)))}px`;
    p.style.top = `${Math.round(Math.max(8, top))}px`;
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
      return `<div class="bd"><div class="h">${icon} ${now}</div>${row('Income', `${plus(det.total[k])}/${per}`, 'good')}${up ? row('Upkeep', `−${up}`, 'bad') : ''}${sp ? row('Planned', `−${sp}`, now - sp < 0 ? 'bad' : '') : ''}${sp ? row('Left', String(now - sp), now - sp < 0 ? 'bad' : '') : ''}${cut ? row('⚠ Cut off', '½', 'bad') : ''}</div>`;
    }
    if (kind === 'lens') {
      return `<div class="lenses">${LENSES.map((l, i) => `<button class="${g.lens === l ? 'on' : ''}" data-lens="${l}"${tip(`${LENS_NAME[l]} · ${i + 1}`)}><i>${LENS_ICON[l]}</i><span>${LENS_NAME[l]}</span></button>`).join('')}</div>`;
    }
    if (kind === 'menu') {
      const local = g.src instanceof LocalSource ? g.src : null;
      const emp = st.rules.empire?.enabled !== false;
      const link = g.src.kind === 'remote' && g.you !== null ? `${location.origin}${location.pathname}#/g/${g.src.meta.id}/${(g.src as unknown as { token: string }).token}` : '';
      const item = (x: string, icon: string, label: string, extra = '') => `<button data-m="${x}"${extra}><i>${icon}</i><span>${label}</span></button>`;
      const phoneItems = g.phone ? `<div class="mrow">${emp ? item('empire', '✺', 'Empire', g.canResearchNow() ? ' class="hot"' : '') : ''}${item('score', '♛', 'Score', g.unreadChat ? ' class="hot"' : '')}${item('chronicle', '☰', 'Chronicle')}</div>` : '';
      const last = g.live ? (st.live?.tick ?? 0) : st.turn - 1;
      return `<div class="menu">${phoneItems}
        ${item('replaylast', '⟲', g.live ? 'Replay tick' : 'Replay turn')}
        ${last >= 1 ? `<label class="mrep"><span>${g.live ? 'Tick' : 'Turn'}</span><input type="number" min="1" max="${last}" value="${Math.max(1, last)}" data-rt><button data-m="replayturn">▶</button></label>` : ''}
        ${item('signals', '◎', `Signals ${g.showSignals ? 'on' : 'off'}`)}
        ${item('help', '?', 'Help')}
        ${g.you !== null ? item('teach', '↻', 'Teach again') : ''}
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
    this.closePopovers();
    switch (x) {
      case 'empire': case 'score': case 'chronicle': case 'help': this.modal(x); break;
      case 'replaylast': g.toolbar('replay'); break;
      case 'replayturn': {
        const n = Math.floor(Number(this.h.pop.querySelector<HTMLInputElement>('[data-rt]')?.value ?? (t.closest('.mrep')?.querySelector('input') as HTMLInputElement | null)?.value));
        const v = Number.isFinite(n) && n >= 1 ? n : 0;
        if (!v) { toast('Pick a number'); return; }
        if (g.st.live) void g.replayTurn(g.turnOfTick(v), v); else void g.replayTurn(v);
        break;
      }
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

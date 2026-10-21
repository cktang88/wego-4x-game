// Teach by doing (docs/UX-V2.md §7): no text tour. Turn 1: a ghost arrow from your biggest fleet to a neutral
// neighbour with "Drag to seize"; after the first order the primary button glows with "Seal when ready". Later
// systems get a one-time 3-word callout on their element the first time they matter: Build, Research, an
// enemy in sight, Laws. × skips everything; Menu → Teach again (or GameScreen.restartTeach) starts over.
// Browser scripts set localStorage 'tc.tutorial.wego' / 'tc.tutorial.live' = 'done' to keep it out of the way.
import type { GameScreen } from '../game.ts';
import { esc } from '../ui/dom.ts';
import { intentFor } from './verbs.ts';
import { ic } from '../art/icons.ts';

type Step = 'drag' | 'seal' | 'build' | 'enemy' | 'research' | 'laws' | 'posture';
const ALL: Step[] = ['drag', 'seal', 'build', 'enemy', 'research', 'laws', 'posture'];
const skipKey = (live: boolean) => `tc.tutorial.${live ? 'live' : 'wego'}`;
const onceKey = (s: Step) => `tc.teach.${s}`;
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* */ } };

export class Teach {
  private cur: Step | null = null;
  private shownAt = 0;
  private dragPair: { fleet: number; to: number } | null = null;
  private sawBuild = false;
  private mem = new Set<Step>();

  constructor(private g: GameScreen) {
    const el = g.hud.h.callout;
    el.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-t]');
      if (!b) return;
      if (b.dataset.t === 'skip') this.skipAll();
      else if (this.cur) this.done(this.cur);
    });
  }
  destroy() { this.g.root.classList.remove('teach-seal'); this.g.teachArrow = null; }
  get off(): boolean { return this.g.you === null || get(skipKey(this.g.live)) === 'done'; }
  private isDone(s: Step) { return this.mem.has(s) || get(onceKey(s)) === '1'; }
  private done(s: Step) { this.mem.add(s); set(onceKey(s), '1'); if (this.cur === s) this.cur = null; this.update(); }
  skipAll() { set(skipKey(this.g.live), 'done'); this.cur = null; this.update(); }
  restart() { set(skipKey(this.g.live), null); for (const s of ALL) set(onceKey(s), null); this.mem.clear(); this.cur = null; this.sawBuild = false; this.update(); }

  /** Decide which callout (if any) applies now. Cheap; called on every render. */
  update() {
    const g = this.g, st = g.st;
    let next: Step | null = null;
    if (!this.off && g.canPlan && !g.blockingReplay && !g.curtain) {
      const anyOrder = g.live ? g.queue.length > 0 : g.plan.orders.some(Boolean);
      if (anyOrder && !this.isDone('drag')) this.done('drag');
      if (!g.live && g.submitted && !this.isDone('seal')) this.done('seal');
      if (!this.isDone('drag') && !anyOrder) {
        this.dragPair ??= this.pickDrag();
        if (this.dragPair && g.fleet(this.dragPair.fleet)) next = 'drag';
      } else if (!g.live && anyOrder && !g.submitted && !this.isDone('seal') && this.isDone('drag') && !g.sel) next = 'seal';
      if (!next) {
        const card = g.hud.h.card;
        const tray = !card.classList.contains('hidden') && card.querySelector('[data-tray="build"]');
        if (tray && !this.isDone('build')) { next = 'build'; this.sawBuild = true; }
        else if (this.sawBuild && !this.isDone('build')) this.done('build');
        else if (!this.isDone('posture') && !card.classList.contains('hidden') && card.querySelector('[data-posture-row]')) next = 'posture';
        else if (!this.isDone('enemy') && this.enemyToken()) next = 'enemy';
        else if (!this.isDone('research') && st.turn >= 2 && g.canResearchNow()) next = 'research';
        else if (!this.isDone('laws') && st.turn >= 3 && !(st.players[g.you!]?.laws ?? []).length && st.rules.empire?.enabled !== false) next = 'laws';
      }
      if (g.live && this.cur === 'seal') next = null;
    }
    if (next !== this.cur) { this.cur = next; this.shownAt = performance.now(); }
    g.root.classList.toggle('teach-seal', this.cur === 'seal');
    g.teachArrow = this.cur === 'drag' && this.dragPair ? { from: g.fleet(this.dragPair.fleet)?.region ?? -1, to: this.dragPair.to } : null;
    this.render();
  }
  private pickDrag(): { fleet: number; to: number } | null {
    const g = this.g, st = g.st;
    const fs = st.fleets.filter(f => f.owner === g.you && f.ships.length).sort((a, b) => b.ships.length - a.ships.length);
    for (const f of fs) {
      // a neutral colony next door, preferring one that is on screen and clear of the HUD
      const nb = st.regions[f.region].neighbors.filter(n => st.regions[n].owner === null && st.regions[n].kind === 'colony')
        .sort((a, b) => Number(!g.map.onScreen(st.regions[a].site, 110)) - Number(!g.map.onScreen(st.regions[b].site, 110)));
      for (const n of nb) { const it = intentFor(g, { fleet: f.id }, n); if (it?.ok && it.verb === 'seize') return { fleet: f.id, to: n }; }
    }
    return null;
  }
  private enemyToken(): number | null {
    const g = this.g;
    const vis = g.visibleSet();
    const f = g.st.fleets.find(x => x.owner >= 0 && x.owner !== g.you && x.ships.length && vis.has(x.region));
    return f ? f.id : null;
  }
  private text(s: Step): string {
    return { drag: 'Drag to seize', seal: 'Seal when ready', build: 'Tap to build', enemy: 'Enemy in sight', research: 'Buy a tech', laws: 'Enact a law', posture: 'Read your rival' }[s];
  }
  private render() {
    const el = this.g.hud.h.callout;
    if (!this.cur) { el.classList.add('hidden'); el.innerHTML = ''; el.dataset.s = ''; return; }
    if (el.dataset.s !== this.cur) {
      el.dataset.s = this.cur;
      el.innerHTML = `<span>${esc(this.text(this.cur))}</span><button data-t="ok" aria-label="Got it">${ic('check')}</button><button data-t="skip" aria-label="Skip tips" title="Skip tips">${ic('close')}</button>`;
    }
    el.classList.remove('hidden');
    this.frame();
  }
  /** Keep the callout on its subject (tokens move with the camera). */
  frame() {
    const g = this.g, el = g.hud.h.callout, s = this.cur;
    if (!s || el.classList.contains('hidden')) return;
    // timed ones bow out on their own
    if ((s === 'enemy' || s === 'laws' || s === 'research' || s === 'posture') && performance.now() - this.shownAt > 9000) { this.done(s); return; }
    let x = 0, y = 0, below = false;
    const at = (e: Element | null) => { if (!e) return false; const r = e.getBoundingClientRect(); if (!r.width) return false; x = r.left + r.width / 2; y = r.top; return true; };
    const onMap = (fid: number | null) => {
      if (fid === null) return false;
      const p = g.lastFleetPos.get(fid);
      if (!p) return false;
      const s2 = g.map.toScreen(p), c = g.el.canvas.getBoundingClientRect();
      x = s2.x + c.left; y = s2.y + c.top - 18; return true;
    };
    let ok = false;
    if (s === 'drag') ok = onMap(this.dragPair?.fleet ?? null);
    else if (s === 'seal') ok = at(g.hud.h.primary.querySelector('[data-submit]') ?? g.hud.h.primary);
    else if (s === 'build') ok = at(g.hud.h.card.querySelector('[data-tray="build"] .tiles'));
    else if (s === 'posture') ok = at(g.hud.h.card.querySelector('[data-posture-row] .pz'));
    else if (s === 'enemy') ok = onMap(this.enemyToken());
    else ok = at(g.hud.h.tools.querySelector(g.phone ? '[data-act=menu]' : '[data-act=empire]'));
    if (!ok) { el.style.visibility = 'hidden'; return; }
    el.style.visibility = '';
    const w = el.offsetWidth, h = el.offsetHeight;
    let top = y - h - 12;
    if (top < 56) { top = y + 40; below = true; }
    el.classList.toggle('below', below);
    el.style.transform = `translate(${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)))}px, ${Math.round(top)}px)`;
  }
}

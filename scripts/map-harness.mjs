// Self-contained map renderer harness: constructs MapRenderer directly from a simulated game (createGame + AI turns
// until a battle is on), independent of the game shell. Used by map-v2-shots.mjs and render-check.mjs.
// window.H = { M, map, full, view, opts, input(now), frameCost }; H.opts: { lens, peek, expanded, drag, highlight, selRegion, selFleet, arrows }
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
/** Boots the harness in the page; returns once a game with an ongoing battle is rendering. */
export async function bootHarness(page, base, errors = [], lanes = !!process.env.LANES) {
  await page.routeWebSocket(/\?token=/, () => {});
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  if (lanes) await page.evaluate(() => { window.__LANES = true; });
  await page.evaluate(async root => {
    const fs = p => `/@fs${root}/${p}`;
    const M = await import('/src/render/map.ts');
    const { createGame } = await import(fs('shared/sim/setup.ts'));
    const { resolveTurn } = await import(fs('shared/sim/resolve.ts'));
    const { planTurn } = await import(fs('shared/sim/ai.ts'));
    const { viewFor } = await import(fs('shared/sim/view.ts'));
    const { roman } = await import(fs('shared/sim/setup.ts'));
    try { await document.fonts.ready; } catch { /* */ }
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;background:#05030b;overflow:hidden';
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:block';
    document.body.appendChild(canvas);
    // a game a few turns in, with a battle on
    let s = createGame({ seed: 4242, players: [{ kind: 'ai', aiLevel: 'expert' }, { kind: 'ai', aiLevel: 'expert' }, { kind: 'ai', aiLevel: 'expert' }] });
    let best = null;
    for (let t = 0; t < 30; t++) {
      const subs = { 0: planTurn(s, 0, 'expert'), 1: planTurn(s, 1, 'expert'), 2: planTurn(s, 2, 'expert') };
      s = resolveTurn(s, subs);
      if (s.engagements.length && s.turn >= 6) { best = s; if (s.engagements.some(e => s.regions[e.region].garrison > 0)) break; }
    }
    if (best) s = best;
    // no hyperlane dots from shared/ yet? synthesize them per the model (kind 'lane', poly [], lane {a,b,i,n}, links)
    if (window.__LANES && !s.regions.some(r => r.kind === 'lane')) {
      s = structuredClone(s);
      const real = s.regions.slice();
      for (const r of real) r.links = [];
      const done = new Set();
      for (const r of real) for (const nb of r.neighbors) {
        const k = Math.min(r.id, nb) + '|' + Math.max(r.id, nb);
        if (done.has(k)) continue; done.add(k);
        const o = real[nb], d = Math.hypot(o.site.x - r.site.x, o.site.y - r.site.y);
        const n = d > 420 ? 2 : d > 260 ? 1 : 0;
        if (!n) { r.links.push(nb); o.links.push(r.id); continue; }
        const ids = [];
        for (let i = 1; i <= n; i++) {
          const t = i / (n + 1), id = s.regions.length;
          s.regions.push({ ...structuredClone(r), id, name: 'Deep space', kind: 'lane', feature: 'none', poly: [], centroid: { x: 0, y: 0 }, site: { x: r.site.x + (o.site.x - r.site.x) * t, y: r.site.y + (o.site.y - r.site.y) * t }, owner: null, homeOf: null, garrison: 0, buildings: {}, project: null, relic: null, trait: null, vein: null, dev: 0, lane: { a: r.id, b: nb, i, n }, neighbors: [r.id, nb] });
          ids.push(id);
        }
        r.links.push(ids[0]); o.links.push(ids[ids.length - 1]);
        ids.forEach((id, i) => { s.regions[id].links = [i ? ids[i - 1] : r.id, i < ids.length - 1 ? ids[i + 1] : nb]; s.regions[id].centroid = s.regions[id].site; });
      }
      // put one of your fleets on a dot with a multi-turn route, and one rival in transit too
      const lanes = s.regions.filter(r => r.kind === 'lane');
      const mine = s.fleets.find(f => f.owner === 0), riv = s.fleets.find(f => f.owner === 1);
      if (mine && lanes[0]) { const L = lanes.find(l => l.lane.a === mine.region || l.lane.b === mine.region) ?? lanes[0]; mine.region = L.id; mine.route = { path: [L.lane.b === mine.region ? L.lane.a : L.lane.b], seize: null, mp: 0 }; }
      if (riv && lanes.length > 3) { const L = lanes.find(l => l.lane.a === riv.region) ?? lanes[3]; riv.region = L.id; riv.route = { path: [L.links[1], L.lane.b].filter((x, i, a) => a.indexOf(x) === i), seize: L.lane.b, mp: 0 }; }
    }
    const map = new M.MapRenderer(canvas);
    const H = window.H = {
      M, map, full: s, you: 0, fog: true, opts: {}, plan: planTurn(s, 0, 'expert'),
      get view() { return this.fog ? (this._v && this._vs === this.full ? this._v : (this._vs = this.full, this._v = viewFor(this.full, 0))) : { state: this.full, you: null, visible: this.full.regions.map(r => r.id) }; },
      input(now) {
        const v = this.view, st = v.state, O = this.opts;
        const lay = M.regionLayout(st, st.fleets, map.px(1));
        const fleets = st.fleets.map(f => ({ id: f.id, owner: f.owner, ships: f.ships.length, pos: lay.get(f.id) ?? st.regions[f.region].site, alpha: 1, name: f.name, region: f.region, idle: f.owner === 0 && !this.plan.orders.some(o => o && 'fleet' in o && o.fleet === f.id), selected: O.selFleet === f.id }));
        const plannedArrows = [];
        if (O.arrows !== false) this.plan.orders.forEach((o, i) => {
          if (!o) return;
          const f = st.fleets.find(x => x.id === o.fleet);
          if (!f) return;
          if (o.type === 'move') { let from = f.region; for (const r of o.path) { plannedArrows.push({ from: st.regions[from].site, to: st.regions[r].site, label: r === o.path[o.path.length - 1] ? roman(i + 1) : '', color: st.players[0].color, kind: 'move' }); from = r; } }
          else if (o.type === 'seize' && o.target !== f.region) plannedArrows.push({ from: st.regions[f.region].site, to: st.regions[o.target].site, label: roman(i + 1), color: st.players[0].color, kind: 'seize' });
        });
        return {
          state: st, you: v.you, visible: this._visSet && this._visFor === v.visible ? this._visSet : (this._visFor = v.visible, this._visSet = new Set(v.visible)),
          owners: st.regions.map(r => r.owner), fleets, selectedRegion: O.selRegion ?? null, hoverRegion: null,
          highlight: this._hl && this._hlSrc === O.highlight ? this._hl : (this._hlSrc = O.highlight, this._hl = new Map(O.highlight ?? [])), plannedArrows, pathPreview: null, signals: [], showSignals: false, fx: this.extraFx ?? [], now,
          lens: O.lens ?? 'political', peek: !!O.peek, expanded: O.expanded ?? null, drag: O.drag ?? null,
        };
      },
      frameCost: [],
      running: true,
    };
    map.resize();
    const cap = s.regions[s.players[0].capital].site;
    map.fit(s, cap);
    const loop = () => {
      if (!H.running) return;
      map.resize();
      const t0 = performance.now();
      map.draw(H.input(t0));
      H.frameCost.push(performance.now() - t0);
      if (H.frameCost.length > 600) H.frameCost.shift();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, ROOT);
  await page.waitForTimeout(600);
}


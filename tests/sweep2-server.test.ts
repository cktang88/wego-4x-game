// Second sweep: the server store under many games, restarts and players knocked out.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, sanitizeRules } from '../server/store.ts';
import { planTurn } from '../shared/sim/ai.ts';

const quiet = <T>(f: () => T): T => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };

describe('sweep2: server store', () => {
  it('a WEGO game whose human seats have all been eliminated plays on (it waited forever for a deadline it had none of)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tc-sweep2-'));
    try {
      const st = quiet(() => new Store(dir));
      const g = st.create({ seed: 4, seats: [{ kind: 'human' }, { kind: 'ai' }, { kind: 'ai' }] } as never);
      st.join(g, 0, 'Me');
      expect(g.deadline).toBe(null);
      // knocked out: no worlds, no fleets
      g.state.players[0].eliminated = true;
      for (const r of g.state.regions) if (r.owner === 0) r.owner = 1;
      g.state.fleets = g.state.fleets.filter(f => f.owner !== 0);
      const t0 = g.state.turn;
      expect(st.tick(Date.now())).toContain(g.id);
      expect(g.state.turn).toBe(t0 + 1);
      // a game seated with AIs only still waits (no free autoplay)
      const ai = st.create({ seed: 5, seats: [{ kind: 'ai' }, { kind: 'ai' }, { kind: 'ai' }] } as never);
      st.tick(Date.now());
      expect(ai.state.turn).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('many games (WEGO and LIVE) reload byte-identical after a restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tc-sweep2-'));
    try {
      let st = quiet(() => new Store(dir));
      const ids: string[] = [];
      for (let i = 0; i < 6; i++) {
        const live = i % 2 === 1;
        const g = st.create({ seed: 40 + i, rules: [{}, { signature: { enabled: false } }, { soul: { enabled: false } }][i % 3], seats: [{ kind: 'human' }, { kind: 'ai' }, { kind: 'ai' }], mode: live ? 'live' : 'wego', liveSpeed: 'blitz' } as never);
        st.join(g, 0, 'P');
        ids.push(g.id);
      }
      let now = Date.now();
      for (let round = 0; round < 3; round++) {
        now += 12_000;
        for (const id of ids) {
          const g = st.games.get(id)!;
          if (g.state.live) {
            for (const o of planTurn(g.state, 0).orders) if (o) { try { st.liveOrder(g, 0, o); } catch { /* refused */ } }
            st.advanceLive(g, now);
          } else st.submit(g, 0, planTurn(g.state, 0), g.state.turn);
        }
        const before = new Map(ids.map(id => [id, JSON.stringify(st.games.get(id))]));
        st = quiet(() => new Store(dir));
        for (const id of ids) expect(JSON.stringify(st.games.get(id))).toBe(before.get(id));
      }
      expect(st.games.get(ids[0])!.state.turn).toBe(4);
      expect(st.games.get(ids[1])!.state.live!.tick).toBeGreaterThan(3);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('a rules override cannot blow up the map or the starting fleets with huge arrays', () => {
    const r = sanitizeRules({ map: { laneDots: Array(300).fill(1) }, start: { fleets: [Array(400).fill('cruiser'), Array(400).fill('cruiser')] }, warden: { ships: Array(2000).fill('dread') } }) as any;
    expect(r.map.laneDots.length).toBeLessThanOrEqual(4);
    expect(r.start.fleets.length).toBeLessThanOrEqual(6);
    for (const f of r.start.fleets) expect(f.length).toBeLessThanOrEqual(6);
    expect(r.warden.ships.length).toBeLessThanOrEqual(8);
    // ordinary overrides pass untouched
    expect((sanitizeRules({ map: { laneDots: [300, 500] }, start: { fleets: [['frigate'], ['scout']] } }) as any).start.fleets).toEqual([['frigate'], ['scout']]);
  });
  it('a rules override naming unknown ship classes cannot jam the game (the AI threw on every turn)', () => {
    const r = sanitizeRules({ start: { fleets: [['nope', 'frigate'], [42], ['toString']] }, warden: { ships: ['nope', '__proto__'] } }) as any;
    expect(r.start.fleets).toEqual([['frigate']]);
    expect(r.warden?.ships).toBeUndefined();
    const dir = mkdtempSync(join(tmpdir(), 'tc-sweep2-'));
    try {
      const st = quiet(() => new Store(dir));
      let failed = 0;
      st.onResolveError = () => { failed++; };
      const g = st.create({ seed: 9, rules: { start: { fleets: [['nope', 'frigate'], ['bogus']] } }, seats: [{ kind: 'human' }, { kind: 'ai' }, { kind: 'ai' }] } as never);
      st.join(g, 0, 'P');
      expect(st.submit(g, 0, planTurn(g.state, 0), 1)).toBe(true);
      expect(failed).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

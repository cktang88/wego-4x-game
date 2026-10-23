// Dev page: builds a fake BattleReport with a tiny local combat sim and opens the viewer.
import { openBattleViewer } from './render/battle.ts';
import { defaultRules } from '../../shared/config/rules.ts';
import { PLAYER_COLORS, PLAYER_DEFAULT_NAMES, NEUTRAL_COLOR } from '../../shared/config/content.ts';
import type { BattleReport, BattleSide, ShotRec, Subsystems } from '../../shared/sim/types.ts';

const rules = defaultRules();

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface FleetSpec { id: number; name: string; commander: string; ships: [string, string][]; retreatRound?: number }
interface SideSpec { owner: number; fleets: FleetSpec[]; garrison?: number }

function buildReport(specs: SideSpec[], regionId: number, name: string, seed: number): BattleReport {
  const R = rng(seed);
  let nextId = 100;
  type U = { id: number; owner: number; fleet: number | null; cls: string | null; hp: number; name: string; sys: Subsystems; gone: boolean };
  const all: U[] = [];
  const sides: BattleSide[] = specs.map(sp => {
    const ships = sp.fleets.flatMap(f => f.ships.map(([cls, nm]) => {
      const d = rules.ships[cls];
      const hp = Math.round(d.hp * (0.75 + R() * 0.25));
      const u: U = { id: nextId++, owner: sp.owner, fleet: f.id, cls, hp, name: nm, sys: { engines: true, weapons: true, shields: true }, gone: false };
      all.push(u);
      return { id: u.id, name: nm, cls, hp, maxHp: d.hp, fleet: f.id };
    }));
    const side: BattleSide = { owner: sp.owner, fleets: sp.fleets.map(f => ({ id: f.id, name: f.name, commander: f.commander })), ships };
    if (sp.garrison) {
      side.garrison = { id: -regionId - 1, hp: sp.garrison, maxHp: sp.garrison };
      all.push({ id: -regionId - 1, owner: sp.owner, fleet: null, cls: null, hp: sp.garrison, name: 'Garrison', sys: { engines: true, weapons: true, shields: true }, gone: false });
    }
    return side;
  });
  const report: BattleReport = { id: seed, name, turn: 14, pulse: 2, region: regionId, sides, rounds: [], winner: null, losses: {}, highlights: [] };
  const hl = (t: string) => report.highlights.push(t);
  const fl = specs.flatMap(s => s.fleets);
  if (fl.length >= 2) hl(`${fl[0].commander} and ${fl[fl.length - 1].commander} meet for the third time. This is personal now.`);
  let firstBlood = false;
  const alive = () => all.filter(u => !u.gone && u.hp > 0);
  const owners = () => new Set(alive().map(u => u.owner));

  for (let round = 0; round < 8 && owners().size > 1; round++) {
    const shots: ShotRec[] = [];
    const pending = new Map<number, number>();
    const units = alive();
    for (const sh of units) {
      let n: number, atk: number, siege = 0;
      if (sh.cls) {
        const d = rules.ships[sh.cls];
        if (!sh.sys.weapons) continue;
        n = d.shots; atk = d.attack; siege = d.siege;
      } else { n = 3; atk = 3; }
      for (let i = 0; i < n; i++) {
        const cands = units.filter(t => t.owner !== sh.owner && t.hp - (pending.get(t.id) ?? 0) > 0);
        if (!cands.length) break;
        const tg = cands[Math.floor(R() * cands.length)];
        const ev = tg.cls ? rules.ships[tg.cls].evasion : 0;
        if (R() > 0.62 - ev) { shots.push({ from: sh.id, to: tg.id, dmg: 0, miss: true }); continue; }
        const dmg = tg.cls ? Math.max(1, atk - (tg.sys.shields ? rules.ships[tg.cls].shields : 0)) : Math.max(1, atk - 1) + siege;
        const p = (pending.get(tg.id) ?? 0) + dmg;
        pending.set(tg.id, p);
        const rec: ShotRec = { from: sh.id, to: tg.id, dmg };
        if (tg.cls && tg.hp - p > 0 && R() < 0.14) {
          const working = (['engines', 'weapons', 'shields'] as (keyof Subsystems)[]).filter(k => tg.sys[k]);
          if (working.length) rec.crit = working[Math.floor(R() * working.length)];
        }
        if (tg.cls && tg.hp - p <= 0) rec.kill = true;
        shots.push(rec);
      }
    }
    for (const u of units) u.hp -= pending.get(u.id) ?? 0;
    for (const s of shots) {
      const u = all.find(x => x.id === s.to)!;
      if (s.crit && u.hp > 0) {
        u.sys[s.crit] = false;
        if (s.crit === 'engines') hl(`${u.name}'s engines are knocked out. It can't run now.`);
        if (s.crit === 'weapons' && u.cls && rules.ships[u.cls].hp >= 20) hl(`${u.name}'s guns fall silent.`);
      }
      if (s.kill) {
        report.losses[u.owner] = (report.losses[u.owner] ?? 0) + 1;
        if (!firstBlood) { firstBlood = true; hl(`First blood: ${u.name} (${rules.ships[u.cls!].name}) is destroyed.`); }
      }
    }
    const rr: BattleReport['rounds'][number] = { shots, retreats: [] };
    report.rounds.push(rr);
    for (const sp of specs) for (const f of sp.fleets) {
      if (f.retreatRound !== round + 1) continue;
      const mine = all.filter(u => u.fleet === f.id && !u.gone && u.hp > 0);
      if (!mine.length) continue;
      const stuck = mine.filter(u => !u.sys.engines);
      for (const u of mine) if (u.sys.engines) u.gone = true;
      if (stuck.length) hl(`${stuck.map(x => x.name).join(', ')} ${stuck.length > 1 ? 'have' : 'has'} no engines and must stay behind: last stand.`);
      rr.retreats.push({ owner: sp.owner, fleet: f.id, to: 3 });
    }
  }
  const left = [...owners()];
  report.winner = left.length === 1 ? left[0] : null;
  hl(`${fl[0].commander} is promoted to rank 3.`);
  return report;
}

const names = ['Azure Compact', 'Crimson Dominion', 'Gilded Throneholders'];
const ctx = {
  rules,
  playerName: (o: number) => (o === -1 ? 'The Warden' : PLAYER_DEFAULT_NAMES[o] ?? names[o] ?? `Player ${o}`),
  playerColor: (o: number) => (o === -1 ? NEUTRAL_COLOR : PLAYER_COLORS[o] ?? '#fff'),
  regionName: (id: number) => ({ 7: 'Crown of Ash', 12: 'Widow Rift' } as Record<number, string>)[id] ?? `Region ${id}`,
  you: 0,
};

function threeWay(): BattleReport {
  return buildReport([
    { owner: 0, fleets: [
      { id: 10, name: 'First Lance', commander: 'Adm. Iria Vance', ships: [['cruiser', 'Resolute'], ['frigate', 'Kestrel'], ['frigate', 'Hollow Star'], ['corvette', 'Needle']] },
      { id: 11, name: 'Dawn Pickets', commander: 'Cmdr. Oto Rask', ships: [['scout', 'Glimmer'], ['corvette', 'Wren'], ['corvette', 'Sparrowhawk']] },
    ] },
    { owner: 1, fleets: [
      { id: 20, name: 'Red Tide', commander: 'Warlord Sabine Kor', retreatRound: 3, ships: [['dread', 'Iron Verdict'], ['corvette', 'Lash'], ['corvette', 'Barb'], ['frigate', 'Cinder'], ['corvette', 'Thorn']] },
    ] },
    { owner: 2, garrison: 30, fleets: [
      { id: 30, name: 'Gilded Wardens', commander: 'Lord Castellan Marrow', ships: [['bombard', 'Saltbreaker'], ['frigate', 'Aurum'], ['frigate', 'Gilt Edge']] },
    ] },
  ], 7, '2nd Battle of Crown of Ash', 4242);
}

function twoWay(): BattleReport {
  return buildReport([
    { owner: 0, fleets: [{ id: 10, name: 'First Lance', commander: 'Adm. Iria Vance', ships: [['cruiser', 'Resolute'], ['frigate', 'Kestrel'], ['corvette', 'Needle'], ['scout', 'Glimmer']] }] },
    { owner: -1, garrison: 24, fleets: [{ id: 90, name: 'The Warden Host', commander: 'The Warden', ships: [['dread', 'Ancient Sentinel'], ['cruiser', 'Vigil'], ['frigate', 'Echo']] }] },
  ], 12, 'Battle of Widow Rift', 77);
}

const params = new URLSearchParams(location.search);
document.getElementById('open3')!.onclick = () => openBattleViewer(threeWay(), ctx);
document.getElementById('open2')!.onclick = () => openBattleViewer(twoWay(), ctx);
(window as unknown as { __bv: unknown }).__bv = { threeWay, twoWay, ctx, openBattleViewer, buildReport };
if (params.get('mode') !== 'none') openBattleViewer(params.get('mode') === '2' ? twoWay() : threeWay(), ctx);

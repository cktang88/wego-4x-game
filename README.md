# Three Crowns

A **3-player competitive WEGO space 4X** you can play with friends asynchronously in the browser.

- **Five orders per turn, forever.** Your whole empire gets 5 orders a turn, inspired by Old World's Orders. Expansion gives you more options, never more actions.
- **Simultaneous pulses.** The order in slot *k* resolves in pulse *k* for all three players at once. Everyone plans in secret, then it all happens together, and you watch the replay.
- **Spaceship conflict over stalemate.** Head-on moves *clash* instead of bouncing. Battles are *sustained*: they rage pulse after pulse (bigger ones for longer, often over several turns) so reinforcements can arrive and sieges give defenders time to respond. Every battle still reaches a decision, and VP rewards holding contested Crowns, the Throne, and fighting.
- **Memorable fleets.** Named commanders earn traits through deeds. Rivals who meet again get vengeance bonuses. Veteran ships earn titles. Engines, weapons and shields get knocked out individually. Battles leave wreckage and memorials on the map.
- **Light diplomacy and deception.** Intel signals come from rivals' actual orders. Feints, scans, conceal, influence and pacts are breakable, but betrayal costs VP.

## Quick start

```bash
npm install
npm run server     # game server (REST + WebSocket) on :8787
npm run dev        # client with hot reload on :5173 (proxies /api and /ws to :8787)
```

Open http://localhost:5173.

- **Play vs AI** runs entirely in the browser; no server needed. The rival dropdowns can also be set to *Human (hotseat)*.
- **Watch AIs** runs three AIs on a fully revealed map.
- **Online multiplayer**: create a game, send the link to two friends, and each picks a seat. A turn resolves when all three have sealed their orders, or at an optional deadline. If you miss the deadline, an AI steward plays for you.

Production, single port:

```bash
npm run build && npm start        # serves dist/ + API + WS on $PORT (default 8787)
```

To play with friends over the internet, run `npm start` on any machine they can reach: a small VPS, Fly.io/Render/Railway, or a tunnel like `cloudflared tunnel --url http://localhost:8787`. Games are stored as JSON in `data/games/` (or `$DATA_DIR`), so restarts don't lose anything.

## Live mode (Neptune's Pride style)

When you create a game (vs AI or online), pick **Live** instead of WEGO:
- The world ticks on a real clock (one pulse per tick: every 30 min at normal speed). Every 8 ticks a *cycle* (= a WEGO turn: income, scoring, edicts) ends.
- You earn **one order every 4 hours**, bank up to 6, and spend them whenever you like. Spent orders act at the next tick and can be taken back until then.
- Moves go any distance. Fleets travel in real time with visible routes and ETAs. Halt is free.
- Speeds: *Normal* (days-long games), *Fast* (×60, an evening), *Blitz* (×360, testing). Tune it in `rules.live`.
- Online, the server runs the clock, so nobody has to be connected. Locally, the browser catches up on missed ticks when you come back. AI seats spend one banked order per tick.

The engine lives in `shared/sim/live.ts` and reuses the same pulse resolver as WEGO.

## On a phone

Works in iPhone/Android browsers. On narrow screens the layout changes:
- the map fills the screen;
- a thumb dock at the bottom holds the 5 pulse slots and **Seal**;
- one bottom sheet opens at a time: the tapped fleet or region, or the Orders / Intel / Chronicle / Score / Chat tabs;
- Replay, Intel and Help are under ☰.

Pinch to zoom, drag to pan, tap to select. Overdrive is a toggle while targeting. Safe areas (notch, home indicator) are respected, and "Add to Home Screen" gives a full-screen app.

## Fiddling (this is a prototype: everything is a knob)

| Want to change… | Where |
|---|---|
| Any number (orders per turn, ship stats, VP values, combat odds, garrisons, influence…) | `shared/config/rules.ts`, or in-game **Tweaks** in the lobby (applies to new games, local or online) |
| Names, commander traits, relics, lore fragments, colors | `shared/config/content.ts` |
| Public objectives (Edicts) | `shared/sim/edicts.ts` (one object per edict with a `check` function) |
| The turn resolution order | `shared/sim/resolve.ts` (the step order is documented at the top) |
| Combat | `shared/sim/combat.ts` |
| Order types and validation | `shared/sim/orders.ts` |
| AI | `shared/sim/ai.ts` (novice / standard / expert) |
| Map generation (Voronoi, 3-fold symmetric) | `shared/sim/mapgen.ts` |
| Map look | `client/src/render/map.ts` |
| Battle replay viewer | `client/src/render/battle.ts` (demo: `/battle-demo.html`) |

Each game stores the exact rules it was created with, so changing defaults never breaks saved or online games.

### Balance tools

```bash
npm run sim -- --games 60 --levels expert,standard,novice      # headless AI-vs-AI stats
npm run sim -- --games 40 --rules '{"orders":{"perTurn":4}}'  # try a rule change
npm run play -- new --save g.json --ai expert,expert           # play in the terminal (you are seat 0)
npm run play -- show --save g.json
npm run play -- orders --save g.json '{"orders":[{"type":"seize","fleet":1,"target":5},null,null,null,null],"free":[]}'
npm test                                                       # 68 tests: determinism, fairness, rules, exploits, fog leaks, server security
```

Browser checks (need `npm run dev` + `npm run server` running; Chromium via `playwright-core`):

```bash
node scripts/play-e2e.mjs <outdir>        # plays a few turns through the UI, screenshots
node scripts/mp-e2e.mjs                   # 3 isolated browsers create/join/seal an online game
node scripts/review-e2e.mjs               # long soak: Watch AIs on auto, replays, battles, listener leaks
node scripts/mp-test.mjs                  # REST + WebSocket protocol smoke test against :8787
node scripts/live-e2e.mjs <outdir> [base] [phone]  # LIVE blitz game: bank orders, travel, ticks
node scripts/phone.mjs <outdir>           # iPhone 15 Pro emulation (393x852 @3x, touch) screenshots of the phone layout
```

`sim` prints win rates by AI level (does skill matter?), game length, battles per turn, VP sources, Warden wake rate, and more.

In the browser console, `tc.state` / `tc.rules` / `tc.screen` give you the live game. A local game's menu can reveal the whole map.

## How a turn works

1. **Plan** (secret): up to 5 orders in slots I–V, plus free doctrine changes, fleet splits, merges and renames. **Preview** simulates your plan against idle rivals.
2. **Resolve** (once all 3 seal their orders): for each pulse, in fixed order, the server runs Prepare (fortify/scan/feint/conceal/pact) → Influence → Movement (clashes, blocking, guard reactions) → Sieges → Combat (each ongoing battle fights its rounds; finished sieges capture) → Economy (build/develop/excavate). Then everyone gets 5 fresh orders.
3. **After pulse V**: the Warden acts, then income/upkeep/repairs/projects, then pacts. Then scoring, which uses the final state only.
4. **Replay**: every client animates what *they* could see. Battles open in the battle viewer.

Victory: first to the VP target, most VP at the turn limit, or hold all three Crowns for 3 consecutive turns.

## Architecture

```
shared/   deterministic simulation (no DOM, no Node APIs), used by server, client, CLI & tests
  config/ rules.ts (all numbers), content.ts (flavor)
  sim/    mapgen, setup, orders, resolve, combat, ai, visibility (fog), view (per-player filtering), edicts
  protocol.ts  client/server message types
server/   Node http + ws: lobby REST, game channel, persistence, deadlines/stewards
client/   Vite + TypeScript, Canvas 2D map & battle viewer, DOM panels; LocalSource (in-browser) / RemoteSource (WS)
scripts/  simulate.ts (balance), cli.ts (text play), debug.ts, e2e/screenshot helpers
tests/    vitest
```

The sim is fully deterministic from the game seed and the orders, through a seeded PRNG with no `Math.random`. The server is authoritative, and each client receives only its fog-of-war-filtered view.

## Multiplayer safety

- The server is authoritative. Each client receives only its fog-of-war-filtered view: no rival fleets outside sensors, no rival resources, doctrines or scans, and no combat RNG state. Spectators of a running game see public info only. Finished games are fully revealed.
- Seat tokens are random, stored hashed and compared in constant time. Submissions, rule overrides and chat are validated and size-capped, and malformed or hostile input can't crash the resolver.
- If a resolution ever throws, the game keeps its previous state and the sealed orders, so nothing is corrupted.
- Saves are written atomically to `data/games/*.json`. Chat and turn history are capped.

## Design notes

The design comes from a research pass over WEGO/async games, action economies, 3-player diplomacy, unit attachment and intel design:

- Old World's Orders and fatigue → fixed 5 orders, max 2 per fleet, and a fleet's second order costs credits.
- Diplomacy's readable simultaneous resolution, minus bounces → clashes and forced decisions.
- Dominions' published turn phases → a fixed step order inside each pulse.
- King of Tokyo / Battlefield conquest → a Throne that pays more the longer it's held, with the holder fully visible; Crown majority bonus.
- Twilight Imperium objectives → Edicts announced a turn before they score.
- Kingmaking mitigations → bounties for hitting the leader, battle honors, pacts that expire and cost VP to break.
- XCOM / Shadow of Mordor / RimWorld → deed-based traits, nemesis and vengeance, ship titles, memorials, last stands.
- Into the Breach / Neptune's Pride intel → signals show destination, arrival pulse and size band, never exact strength. Feints and scans.
- Subterfuge / Frozen Synapse → the Preview ghost planner.

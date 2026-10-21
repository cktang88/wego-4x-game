# Three Crowns

A **3-player competitive WEGO space 4X** you can play with friends asynchronously in the browser.

- **Five orders per turn, forever.** Your whole empire gets 5 orders a turn, inspired by Old World's Orders. Expansion gives you more options, never more actions.
- **Simultaneous turns.** Everyone plans in secret; then all orders of all three players resolve together in one step, and you watch the replay.
- **Spaceship conflict over stalemate.** Head-on moves *clash* instead of bouncing. Battles are *sustained*: they rage round after round (bigger ones for longer, often over several turns) so reinforcements can arrive and sieges give defenders time to respond. Every battle still reaches a decision, and VP rewards holding contested Crowns, the Throne, and fighting.
- **Memorable fleets.** Named commanders earn traits through deeds. Rivals who meet again get vengeance bonuses. Veteran ships earn titles. Engines, weapons and shields get knocked out individually. Battles leave wreckage and memorials on the map.
- **Light diplomacy and deception.** Intel signals come from rivals' actual orders. Feints, scans, conceal, influence and pacts are breakable, but betrayal costs VP.

## The Empire layer

Underneath the five orders sits a small 4X spine: invest now, pay off later, without micromanagement. In the **Empire** tab you research one technology per turn across four branches (with an exclusive fork and a one-per-game ★ at the top of each), enact laws from a Charter of opposed pairs, and pick the module each ship class carries. On the map, world traits and Antimatter / Crystal veins make some planets worth fighting for, and supply lines matter: regions cut off from your capital yield half, and fleets beyond supply wear down. Design and numbers: [docs/EMPIRE.md](docs/EMPIRE.md).

Every world is a **star system**: a star and up to three bodies that decide what it can become. Citizens (development) have a cap from the bodies, grow on their own at quiet Core worlds, and gate Shipyards and Academies; civil buildings need a body slot (a built Station adds one), military ones have two slots (three at chokepoints) and are 30% cheaper at sparsely peopled Waystations. Black holes stop fleets passing through. Design: [docs/SYSTEMS.md](docs/SYSTEMS.md).

## Design docs

- [docs/EMPIRE.md](docs/EMPIRE.md): research, laws, ship modules, worlds, supply
- [docs/UX-V2.md](docs/UX-V2.md): the game UI (semantic-zoom map, drag-to-order, HUD, modals)
- [docs/SOUL.md](docs/SOUL.md): fleets as characters, worlds with a story, friends as antagonists
- [docs/SYSTEMS.md](docs/SYSTEMS.md): star systems (stars, bodies, roles, citizens, contested systems)
- [docs/SIGNATURE.md](docs/SIGNATURE.md): signature mechanics (Postures, Fate)
- [docs/TODO.md](docs/TODO.md): ideas we like but haven't built yet (Legacy Galaxy, League, Exile, Turncoats…)

## Quick start

```bash
npm install
npm run server     # game server (REST + WebSocket) on :8787
npm run dev        # client with hot reload on :5173 (proxies /api and /ws to :8787)
```

Open http://localhost:5173. The first turns teach by doing: gold callouts point at what to try (Drag to seize, Seal when ready…); Menu → Teach again restarts them. Hover (or long-press on a phone) any icon or number for a short explanation.

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
- The world ticks on a real clock (one resolution step per tick: every 30 min at normal speed). Every 8 ticks a *cycle* (= a WEGO turn: income, scoring, edicts) ends.
- You earn **one order every 4 hours**, bank up to 6, and spend them whenever you like. Spent orders act at the next tick and can be taken back until then.
- Moves go any distance. Fleets travel in real time with visible routes and ETAs. Halt is free.
- Speeds: *Normal* (days-long games), *Fast* (×60, an evening), *Blitz* (×360, testing). Tune it in `rules.live`.
- Online, the server runs the clock, so nobody has to be connected. Locally, the browser catches up on missed ticks when you come back. AI seats spend one banked order per tick.

The engine lives in `shared/sim/live.ts` and reuses the same resolver as WEGO.

## On a phone

Works in iPhone/Android browsers with the same board as on desktop:
- the map fills the screen; the top row shows the turn, resources and the three crests;
- the plan strip (5 order slots) and the primary button sit in the bottom thumb zone;
- tapping a fleet or world opens its card as a bottom sheet (swipe down to dismiss);
- drag a fleet to order it: the drop point rides above your finger and a loupe shows what's under it;
- Empire, Score and Chronicle fold into ≡; notifications fold into one badge.

Pinch to zoom, drag empty space to pan, long-press for the action ring. Safe areas (notch, home indicator) are respected, and "Add to Home Screen" gives a full-screen app.

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
node scripts/ux-shots.mjs <outdir> [base] [wego|live|...]  # walks the teach-by-doing callouts, screenshots each step
node scripts/fx-shots.mjs <outdir> [phone]  # animation screenshots + frame-time measurements (NOSHOT=1 to only measure)
node scripts/phone.mjs <outdir>           # iPhone 15 Pro emulation (393x852 @3x, touch) screenshots of the phone layout
node scripts/soul-e2e.mjs [outdir]        # Soul layer UI: founding, honours, callings, vows, Herald dispatch, retire, raze, the Saga
```

`sim` prints win rates by AI level (does skill matter?), game length, battles per turn, VP sources, Warden wake rate, and more.

In the browser console, `tc.state` / `tc.rules` / `tc.screen` give you the live game. A local game's menu can reveal the whole map.

## How a turn works

1. **Plan** (secret): drag your fleets onto worlds (the target picks the verb: Move, Seize, Merge), tap your worlds to Build and Develop, and fill up to 5 order slots in the strip. Long moves follow the hyperlanes and become routes that keep going on later turns. Free actions cost no order: doctrine, splits, merges, research, vows, honours, callings, a Herald dispatch. The primary button walks you through idle fleets and research, then **Seal**. 👁 Preview simulates your plan against idle rivals.
2. **Resolve** (once all 3 have sealed): every order of every player resolves together in **one step**, in a fixed order: Prepare (fortify/scan/feint/conceal/pact/laws/refits) → Economy (build/develop/excavate) → Influence → Movement (clashes, blocking, guard reactions) → Sieges → Combat (each battle fights its rounds for the turn and carries on next turn; finished sieges capture).
3. **Then**: the Warden acts, then income/upkeep/repairs/projects, then pacts, the Soul layer's bookkeeping (vows, limping fleets, callings, deeds) and the Herald's new edition. Scoring uses the final state only.
4. **Replay**: every client animates what *they* could see, on the board. Battles leave a result chip that opens the battle viewer. Then the Herald's front page.

Victory: first to the VP target, most VP at the turn limit, or hold all three Crowns for 3 consecutive turns.

### The Soul layer

Fleets fly **banners** (founded with a sigil, a name and point-bought boons and banes), swear **vows**, earn ranks, honours and epithets, **rout** and limp home instead of vanishing, and carry their scars. Worlds keep a ledger, earn an epithet, take a **Calling** that grows with tenure, and collect deeds; a fresh conquest can be **razed**. The **Herald** prints a front page each turn (plant one dispatch: a boast, a threat, a lie), sworn pacts brand their breakers **Oathbreaker**, killing a commander leaves a **blood-debt**, and at the end the **Saga** tells the whole game (copy text, save image). Design: [docs/SOUL.md](docs/SOUL.md).

## Architecture

```
shared/   deterministic simulation (no DOM, no Node APIs), used by server, client, CLI & tests
  config/ rules.ts (all numbers), content.ts (flavor)
  sim/    mapgen, setup, orders, resolve, combat, ai, visibility (fog), view (per-player filtering), edicts
  protocol.ts  client/server message types
server/   Node http + ws: lobby REST, game channel, persistence, deadlines/stewards
client/   Vite + TypeScript, Canvas 2D map (painted miniatures) & battle viewer, a DOM HUD and full-screen modals; LocalSource (in-browser) / RemoteSource (WS)
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
- Dominions' published turn phases → a fixed, published step order.
- King of Tokyo / Battlefield conquest → a Throne that pays more the longer it's held, with the holder fully visible; Crown majority bonus.
- Twilight Imperium objectives → Edicts announced a turn before they score.
- Kingmaking mitigations → bounties for hitting the leader, battle honors, pacts that expire and cost VP to break.
- XCOM / Shadow of Mordor / RimWorld → deed-based traits, nemesis and vengeance, ship titles, memorials, last stands.
- Into the Breach / Neptune's Pride intel → signals show destination and size band, never exact strength. Feints and scans.
- Subterfuge / Frozen Synapse → the Preview ghost planner.

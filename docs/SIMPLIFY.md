# Simplify the system: the high-order bits

> "Every region has so much stuff to take care of. Think of what the 3 or 4 highest-order bits are and remove
> the low-order bits: stuff that is meaningless or doesn't do anything."

This document covers:
- **Inventory:** every per-system mechanic and decision.
- **Measurement:** AI ablation over many games.
- **Classification:** KEEP / AUTOMATE / MERGE / DEMOTE / CUT.
- **Rule changes:** the proposed changes with their knobs, code and balance risk, and a staged rollout that
  keeps old saves working.

The card that shows the result is [WORLD-CARD.md](WORLD-CARD.md).

## 1. The answer first

**Per system, a player should make only two kinds of standing decision, plus one situational bet:**
1. **Raise:** which hull to build here, and into which fleet. Only at yard worlds (1–3 per house).
2. **Improve:** which of **four tracks** to push one level: **Works** (economy), **Yard** (hull sizes),
   **Walls** (defence) and **Outpost** (supply, sight, gates). The game picks the concrete building from the
   system's bodies. Citizens grow by themselves.
3. **Gambit** (situational): a secret bet (Levies or Scorch) or a Fate Surge. It exists only when something
   threatens the system or Surge would pay.

**And one identity decision per world, once: the Calling** (two options at 3 citizens).

Everything else is automatic (growth, garrison, tenure, contested and occupied output, supply), derived
(role from the bodies, discounts as prices), story (epithet, deeds, ledger, bodies, star), or an event prompt
that lives for one turn (terms, raze, purge).

**Challenging the guess** (identity, build, grow, defend):
- **Identity is not a per-turn decision.** It is mostly *given* (the bodies and star make the role) plus *one*
  choice (the Calling). Show it as the card's frame and title; don't ask about it every turn.
- **"Grow" and "build structures" are the same decision.** Players are choosing *what kind of investment* this
  world gets. The ablation shows that denying any single economy building costs the AI nothing, because it
  substitutes another, while denying the whole category hurts (§3). The decision with weight is the category.
- **"Defend (garrison)" is a readout, not a decision.** The garrison regenerates by itself. The defend decisions
  are **Walls** (an Improve track) and, when a siege is coming, **Levies** (a Gambit). So defence lives inside
  the other two rather than as a fourth bit.
- **So the bits are Raise, Improve (×4 tracks), and Gambit-when-threatened.** The fourth slot goes to the
  *one-time* Calling, not to a recurring decision.

## 2. Method

`scripts/ablate-world.ts` (new; no sim code changed) plays expert×3 AI games with seeds 1000+.

**Two kinds of variant:**
- **`deny:<x>`.** One seat, rotating per game, **plans against rules in which option *x* is unaffordable**,
  or has those free actions stripped, so the expert AI re-plans around it. The other two seats play normally.
  This measures **what the decision is worth** to a good player:
  - the denied seat's wins (fair share 1/3);
  - its VP **paired** against the same seat with the same seed in the baseline (Δ VP ± standard error).
- **`<sym>`.** A rules override for everyone (a passive feature switched off). This measures **game feel**:
  turns, captures and the VP margin, paired with the baseline.

**Sample and caveats:**
- Baseline: 18 games. `deny` variants for postures, Surge and Develop: 18 games. The other 21 variants:
  9 games each (the machine was shared, at about 90 s per expert game). Not run: build gates off, callings
  off for everyone.
- With 9 games, a ±4 VP difference is noise. Read the table as "clearly matters", "clearly doesn't" or
  "can't tell", never as exact values.
- The AI values options with hand-written heuristics. An option the AI never considers (the Sensor, Engrave)
  shows zero usage because of AI coverage, not because it has no value. Those rows are judged qualitatively.

Re-run with:
`npx vite-node scripts/ablate-world.ts -- --games 18 --variant deny:mine --out /tmp/x.json`
(variants are listed at the top of the script). For the analysis, see `analyze.py` next to the results in
`/tmp/claude-0/world-card/sim/`.

**Baseline** (expert×3, 18 games):
- 22.9 turns, 40.6 captures and 66.8 battles a game, VP margin 13.4.
- **Develop orders are 31% of all orders** (70.7 of 229 a game; builds are 68.2). Improve is the per-turn
  decision that matters most to simplify.

## 3. Inventory, measurements and verdicts

Usage is per game (three houses, ~23 turns). Δ VP is the denied seat against the same seat in the baseline.

| Mechanic | What it does | Usage / game (baseline) | Measurement | Would a human notice? | Verdict | Why |
|---|---|---|---|---|---|---|
| Garrison | defence number; regenerates; +Fortress, +Bastion, binary star | always | - | yes: on the map | KEEP (readout) | The face shows it. Not a decision; Walls and Levies are the decisions. |
| Citizens growth (Cores) | +1 citizen every 3 turns (Garden 2) below cap, uncontested | growth 24.1 a game | off for all (9g): turns -1.0±1.3, captures -7.3±2.3, margin +2.0±3.3 → **changes the game** | yes: yields | AUTOMATE (as now) | The most-used economy mechanic, and nobody decides it. Show it as pips and "+1 in 2t". |
| Develop (buy a citizen) | an order: +1 citizen now | develop 5.2 orders | denied wins 6/18 (base 8/18); ΔVP -0.4±3.9 → **no clear loss**; sym: off for all (9g): turns -1.0±1.5, captures -2.7±3.2, margin +3.9±2.4 → **no clear change**; grow-all: off for all (9g): turns -1.3±1.5, captures -4.3±2.7, margin +4.9±2.3 → **changes the game** | barely | MERGE → Works (a member the picker takes); cut only after a bigger run | Denied to one seat it costs nothing (the AI spends the order elsewhere). Off for everyone, games get more lopsided (margin +4 to +5 VP), so it is a quiet catch-up lever. Keep the effect and drop the separate "Citizen" tile. |
| Citizens cap (from bodies and star) | cap 0–5 from bodies; yellow +1, red −1, blue ≤ 2 | always | - | as empty pips | KEEP (derived) | The empty pips are the cap. The bodies explain it in Story. |
| Civil slots | Mine / Trade / Extractor / Academy / Yard need a free civil slot (one per body, +1 Station) | constraint | - | only as "no slot" | MERGE → Works cap | A slot is the answer to "can I build here?", and the track button already answers it. |
| Military slots, chokepoint | 2 (+1 at a chokepoint) for Fortress / Battery / Shield / Sensor / Depot / Gate | constraint | off for all (9g): turns +0.2±0.2, captures -0.1±0.1, margin +0.3±0.6 → **no clear change** | only as "no slot" | MERGE → Walls and Outpost caps | Unlimited military slots change nothing at all: the cap never binds. A chokepoint becomes "+1 Walls level" in the peek. |
| Shipyard | hull sizes 1–3; repairs | shipyard 3.8 | (not denied: no yard, no ships) | yes | KEEP → Yard track | A real decision: where your war is built. |
| Fortress | +10 garrison, +firepower per level | fortress 3.4 | denied wins 3/9 (base 5/9); ΔVP -1.4±2.9 → **no clear loss** | yes | KEEP → Walls track | The defence investment. Substitutable for the AI, but the only lever a defender has between turns. |
| Battery (tech) | garrison +2 shots, +2 damage per level | battery 4.9 | denied wins 4/9 (base 5/9); ΔVP +3.3±1.7 → **no clear loss** | a little | MERGE → Walls | Denied, the AI does no worse. A Walls level once researched. |
| Planetary Shield (tech + crystal) | garrison takes 3 less per hit | pshield 0.1 | (rare) | rarely | MERGE → Walls | The top Walls level where you have crystal. |
| Mine | +4⚙ per level | mine 22.2 | denied wins 4/9 (base 5/9); ΔVP -1.6±4.8 → **no clear loss** | yes (yield) | MERGE → Works | Denied alone: no loss (the AI builds Trade Hubs instead). The decision is "invest here", not "which building". |
| Trade Hub | +5¢ per level | tradehub 14.0 | denied wins 5/9 (base 5/9); ΔVP +2.9±5.2 → **no clear loss** | yes (yield) | MERGE → Works | Same. |
| Extractor (vein) | +3¢, vein access while connected | extractor 5.5 | denied wins 4/9 (base 5/9); ΔVP -0.4±3.2 → **no clear loss** | yes (unlocks hulls) | MERGE → Works (first pick on a vein) | Its real job is vein access for cruisers and shields; the picker takes it first. |
| Academy | research −15% per level (all Academies, ≤ 45%); captured: tech stolen | academy 1.2 | denied wins 7/9 (base 5/9); ΔVP +6.8±5.2 → **no clear loss** | a little | MERGE → Works at Cores, last in the picker; review its price | Denying it *helped* the denied seat: the AI overvalues it or it is overpriced. Keep it for the steal-on-capture story, but never as a default pick. |
| Every structure except Yard / Fortress / Develop | (the economy and logistics categories at once) | — | denied wins 1/9 (base 5/9); ΔVP -3.2±6.4 → **no clear loss** | — | (evidence for the Works track) | Denying the category hurts, while denying its members one by one doesn't: keep the category, automate the member. |
| Sensor | +1 sensor range | sensor 0.0 | (the AI never builds it) | rarely | MERGE → Outpost II | Not a standalone decision. |
| Depot (tech) | supply +2, repair like a yard, +3⚙ | depot 4.8 | denied wins 4/9 (base 5/9); ΔVP -1.3±2.0 → **no clear loss** (Depot + Sensor + Gate) | yes, at the front | MERGE → Outpost I | A real logistics choice at the front, rarely elsewhere. |
| Warp Gate (tech + crystal) | jump between gates; links supply | gate 0.1 | (rare) | yes, when built | MERGE → Outpost III | A late, rare, big decision. |
| Station | +1 cap, +1 civil slot; one per system | station 0.8 | denied wins 4/9 (base 5/9); ΔVP -0.7±1.5 → **no clear loss** | no | CUT (stage B3) | It exists to un-block slots; with slots gone it has no job. Existing Stations keep their +1 cap. |
| Waystation discount | military / logistics −30% at ≤ 1 citizen | passive | off for all (9g): turns -1.7±1.1, captures -6.0±2.0, margin -0.6±3.2 → **changes the game** | only as a price | MERGE → role perk, shown as struck prices | Off for everyone, captures drop by 6 a game: cheap forts and depots at Waystations shape the front. Keep the rule; show it where it is spent. |
| Build gates (Yard 2 citizens, Academy 3) | citizens or Station before Yard / Academy | passive | not measured (cut for time) | as "why not" | KEEP (as inline why-not) | A good teaching moment: "needs 2 citizens". |
| Role (Core / Forge / Harbor / Waystation) | derived from bodies: growth (Core), yields, discount | always | - | yes | KEEP → the card frame | Identity you can see, never choose. |
| Calling (choose 1 of 2 at 3 citizens) | a per-world perk, tier by tenure | calling pick 9.7 picks | denied wins 2/9 (base 5/9); ΔVP -3.8±4.8 → **no clear loss** (denied = default pick); calling off for all: not measured | yes | KEEP (one-time prompt; the card title) | The one identity decision per world: rare, legible, with story. |
| Tenure | calling tiers at 3 / 6 / 10 turns held | passive | off for all (9g): turns -0.8±1.4, captures -3.8±2.2, margin +2.4±3.0 → **no clear change** | as segments | AUTOMATE (as now) | Shown as the three segments on the title line. |
| Epithet | cosmetic name from the strongest mark | passive | - | yes (flavour) | DEMOTE → subtitle | The card's subtitle; free story. |
| Deeds | small rule effects (Fell +hit, Unbroken armor, King's Seat garrison) | passive | - | rarely | DEMOTE → Story | Keep the effects; the epithet summarises them on the face. |
| Engrave a deed | an order + 4✦ + 10¢: never replaced | order:engrave 0.0 (the AI never does it) | - | no | CUT (stage B4) | An order for a cosmetic lock. Deeds are capped at 2 anyway. |
| Ledger marks | toil / blood / siege / relic / loss counters | passive | - | no | DEMOTE → Story | Inputs to the epithet and calling; lore. |
| Star effects | cap ±1, binary +3 garrison, pulsar +1 sensor / gate −30%, blue +1⚙ per mine, black-hole gravity well | gravity well stops 8.9 a game | off for all (9g): turns +0.0±1.9, captures -0.2±2.9, margin +0.0±5.0 → **no clear change** | gravity well only | DEMOTE → Story (rules unchanged) | Turning every star effect off changes nothing measurable. Keep them as flavour (they cost the player nothing once off the face); the gravity well is a map rule shown on the map. |
| Bodies | the input to role, cap, slots, Works type, callings | always | - | yes (as art) | KEEP → the art diorama | Pictures, not chips. |
| Levies (world posture) | bet: a siege lands; garrison ×1.5 / output lost 2 turns | levies 2.1 | denied wins 9/18 (base 8/18); ΔVP +3.4±2.4 → **no clear loss** (all world postures) | yes, in a siege | KEEP → Gambit, only under threat | Denying world postures costs the AI nothing; keep it for the human read, and only when it can pay. |
| Scorched Earth | bet: you lose it; the conqueror gets nothing | scorch 2.8 | (same) | yes, dramatic | KEEP → Gambit, only under threat | Rare, dramatic, story. |
| Open the Gates | bet: an ally needs refuge | gates 0.2 | (same) | no | CUT (stage B1) | 0.17 a game; it needs a pact ally passing through. The ally can repair at its own yards. |
| Surge (Fate) | double output this turn and +1 project turn; one of 3 Fate tokens | surge 3.8 | denied wins 7/18 (base 8/18); ΔVP +1.8±2.9 → **no clear loss** | yes | KEEP → Gambit card (when Fate is left and it would pay) | Fate is empire-level; the world card is just where you aim it. |
| Contested / blockade / plunder | enemy in system: output split | contested sys-turns 7.2 sys-turns | off for all (9g): turns -2.2±1.4, captures -5.2±2.0, margin +6.1±5.4 → **changes the game** | yes (yield drop) | AUTOMATE (ribbon + red yield note) | A state, not a decision. |
| Refugees | −1 citizen every 3 contested turns | refugees 3.6 | (part of contested) | yes | AUTOMATE (Gambit chip text) | The urgency line under siege. |
| Occupied | ½ output for 3 turns after capture | occupied sys-turns 26.7 sys-turns | - | yes | AUTOMATE (ribbon) | A state. |
| Tribute (offer / accept) | pay ⅓ for 5 turns to lift a siege | offers 1.17, accepts 0.06 | - | between friends, yes | KEEP as an event prompt | Nearly dead between AIs, but a deal between friends is the game's social core. Only ever a prompt. |
| Raze | free right after capture: lump, dev −1, vendetta | raze 2.0 | - | yes | KEEP as an event prompt | One turn, one choice, with its payout on the button. |
| Rival agents / Purge | influence flips the system at the threshold | influence 28.7 influence orders (all uses) | - | yes, near flipping | KEEP as an event prompt (from half the threshold) | Urgent or noise; show it only when urgent. |
| Veins | antimatter / crystal on a body; access via Extractor | passive | - | yes | KEEP (a gem on the body art) |  |
| Excavate | fleet order at a relic: VP | excavate 5.8 | - | yes | KEEP (fleet card / map, not the world card) |  |
| Supply / cut off | unconnected systems yield half | passive | - | yes | AUTOMATE (ribbon) |  |
| Banners (into which fleet) | founding a fleet is a ritual; limit 3 + crowns | build 68.2 builds | - | yes | KEEP → Raise "Into" selector | One selector, not four chips. |
| Scan (from a world card) | reveal the area | scan 0.2 | - | no | CUT from the own-world card (still in the ring and on fleets) |  |

**What the numbers say:**
1. **No single per-system option, taken away from one expert, measurably changes who wins.** No denial
   crosses two standard errors.
   - The denied seat even does better without the Academy (+6.8±5.2 VP, 7/9 wins), without Batteries
     (+3.3±1.7) and without world postures (+3.4±2.4).
   - Denying the *whole* economy/logistics category is the only denial that looks costly (1/9 wins against
     5/9): what matters is "invest here", not which building.
2. **The passive rules that shape the game are growth, contested output and the waystation discount.** With
   each off for everyone, captures drop by 7, 5 and 6 a game. These stay, automated, and become ribbons,
   pips and prices on the card.
3. **These do nothing measurable:**
   - Military slots (the cap never binds: the games are almost identical).
   - Every star effect at once, gravity well included.
   - Stations.
   - Engrave and the Sensor (the AI never uses them).
   - Open the Gates (0.17 a game).
4. **Develop is the exception to "cut what doesn't matter".** One seat loses nothing without it, but with it
   gone for everyone the VP margin widens by 4–5. It stays, as a Works member rather than its own tile.

Determinism check: after a container restart, seeds 1000–1002 of the baseline replayed identically (same
turns, captures and VP), so runs made at different times are comparable.

**Verdict counts** (44 mechanics):
- **KEEP** (most as a readout, frame or prompt): 17.
- **MERGE** into the four tracks or a role perk: 13.
- **AUTOMATE:** 6.
- **DEMOTE** to story: 4.
- **CUT:** 4 (Open the Gates, Station, Engrave, and Scan from the own-world card).

## 4. The simplified per-system model

| | Before | After |
|---|---|---|
| **Standing options on an own yard world, per turn** | 6 hulls × 4 fleet chips, 13 project tiles, 4 stance buttons, Surge, Scan: **~29 controls**, plus situational Purge, Terms, Raze, Calling and Engrave | 3 legal hulls + 1 "into" selector, 4 track buttons: **8 controls**. Under threat: + Levies / Scorch / Surge = 11 |
| **Standing options on a non-yard world** | 13 project tiles, 4 stance, Surge, Scan: **~19** | 4 track buttons: **4** (+3 under threat) |
| **Concepts to learn per system** | citizens, cap, growth, Develop, civil slots, military slots, chokepoint, waystation discount, 13 buildings, role, calling, tenure, epithet, deeds, engrave, ledger, star effect, body effects, 3 world postures, Surge, contested, occupied, tribute | role (frame), calling (title), citizens (pips), 4 tracks, Gambit (2 bets + Surge), states (ribbons) |
| **Numbers on the face** | 29 | 4 (garrison and yield) |

**The four tracks** (each 0–3; the next level is picked from the bodies; long-press picks a specific member):

| Track | Members (today's projects), in the order the picker takes them | Cap | Notes |
|---|---|---|---|
| **Works** | Extractor (on a vein) → +1 Citizen (Develop; non-growing worlds below cap) → Mine (belt or barren) / Trade Hub (habitable or gas), whichever pays more → the other → Academy (Cores with 3+ citizens; last) | the old civil slots: one per productive body, at most 3 (citizens are capped separately) | Replaces civil slots and the "Citizen" tile. The button names what it buys: "Works II · Mine", "Works · +1 citizen". |
| **Yard** | Shipyard I → II → III | 3 | Gates on citizens stay (inline why-not). |
| **Walls** | Fortress I → Battery (tech) → Fortress II → Planetary Shield (tech + crystal) → Fortress III | 3 visible levels (5 members) | The level shown is the Fortress level, with ◆ marks for Battery and Shield. Replaces military slots. |
| **Outpost** | Depot (tech) → Sensor → Warp Gate (tech + crystal) | 3 | Always in its slot; dimmed ("needs Supply Depots") until researched, except at a Waystation. The waystation discount shows as a struck-through price. |

## 5. Rule changes and rollout

All new behaviour sits behind a new rules group, **`rules.world`**, added to `OPT_IN_LAYERS` in
`shared/config/rules.ts`:
- **Old saves** (no `world` group) keep today's rules exactly (`upgradeRules` switches the group off).
- **New games** get it on.
- Every knob below defaults to the new behaviour inside the group.

### Stage A: UI only (no rules change; ship first)
- The card per WORLD-CARD.md.
- Improve shows the four tracks. A track button sends today's concrete `{type:'develop', project}` chosen by a
  client-side picker, `client/src/hud/tracks.ts` (`nextInTrack(st, r, track)`).
- Gates and Station stay reachable through the track's long-press list.
- The Gambit is gated by relevance. "Held", the slot counters, `↑0`, the star effect line and the per-body
  numbers leave the face.
- **Risk:** none to balance. Humans lose a little speed choosing an off-track member (two taps instead of one).

### Stage B: rules flags (one PR each, each measured with `scripts/ablate-world.ts` and `npm run sim -- --suite`)

The new group (`shared/config/rules.ts`):
```ts
export const WORLD_DEFAULTS = {
  world: {
    enabled: true,          // OPT_IN_LAYERS: absent in a save = off (today's rules)
    gatesPosture: false,    // B1: Open the Gates is gone
    develop: false,         // B2: no Develop order...
    growAllEvery: 4,        // B2: ...non-Core systems grow by themselves every N turns (Cores keep growthEvery / garden)
    slots: false,           // B3: no civil / military slots; track caps instead
    worksCap: 3, wallsCap: 3, outpostCap: 3, chokeWalls: 1,
    station: false,         // B3: no new Stations (built ones keep their +1 cap)
    engrave: false,         // B4: no Engrave order
  },
};
```

| Step | Rule | Code | Measured | Balance risk |
|---|---|---|---|---|
| **B1** | Cut **Open the Gates**. | `signature.ts`: `wpostureBlock` returns "not in these rules" for `gates` when `world.gatesPosture === false`; the UI's bet list reads the same predicate. `ai-signature.ts` already validates through `wpostureBlock`. | 0.17 uses a game; all world postures denied: denied wins 9/18 (base 8/18); ΔVP +3.4±2.4 → **no clear loss** | **None.** |
| **B2 (hold)** | *Proposed:* cut **Develop**; **citizens grow everywhere** (non-Cores every `growAllEvery` turns). *Recommended for now:* **keep Develop as a Works member** (Stage A already does this) and ship B2 only if a 45-game run shows the margin unchanged. | `systems.ts` `growSystem`: drop the `roleOf(r) !== 'core'` early return when `world.develop === false`, use `growAllEvery` for non-Cores. `empire.ts` `projectBlock` rejects `develop`. The AI's `add('develop')` candidates fail validation (no AI change needed). | Develop denied to one seat: denied wins 6/18 (base 8/18); ΔVP -0.4±3.9 → **no clear loss**. Develop off for all: off for all (9g): turns -1.0±1.5, captures -2.7±3.2, margin +3.9±2.4 → **no clear change**. Off for all + growth everywhere (harness-emulated; it fires only ~2× a game, since non-Core caps are 1–2 and mostly full): off for all (9g): turns -1.3±1.5, captures -4.3±2.7, margin +4.9±2.3 → **changes the game**. | **Medium.** Off for everyone, the VP margin grows by 4–5: Develop is a quiet catch-up lever. Growth everywhere does not replace it. |
| **B3** | Replace **slots** with **track caps**; cut new **Stations**. | `systems.ts`: `slotsOf` → `trackCaps(s, r)`: Works = productive bodies (belt, barren, habitable, gas, vein), max 3; Walls 3 (+1 at a chokepoint); Outpost 3. `systemsBlock` checks the cap of the project's track instead of the slot. `stationUnblocks` returns false. `projectBlock` rejects `station`. | Military slots unlimited: off for all (9g): turns +0.2±0.2, captures -0.1±0.1, margin +0.3±0.6 → **no clear change**. Stations denied: denied wins 4/9 (base 5/9); ΔVP -0.7±1.5 → **no clear loss**. | **Low.** Caps match today's slot counts on almost every system (civil slots = bodies). |
| **B4** | Cut **Engrave**. | `orders.ts` / `resolve.ts` `validateOrder`: reject `engrave` when `world.engrave === false`. | 0 uses (the AI never engraves). | **None** (cosmetic). |
| — | Star effects, deeds, tenure: **no rule change**; they leave the face only. | — | All star effects off: off for all (9g): turns +0.0±1.9, captures -0.2±2.9, margin +0.0±5.0 → **no clear change**. Tenure off: off for all (9g): turns -0.8±1.4, captures -3.8±2.2, margin +2.4±3.0 → **no clear change**. | — |

**Old saves.**
- `upgradeRules` sees no `world` group and sets `world.enabled = false`, so every branch above is skipped and
  the game plays as it was saved.
- The card still works on old saves (Stage A is UI-only): Improve shows tracks over today's projects and
  includes the Develop and Station members when the rules allow them.

**AI.**
- No new AI is needed for B1–B4: every removed option is rejected by the validators the expert already calls.
- `aiSiteBonus` keeps valuing military projects at waystations.
- The `stationUnblocks` path returns false.
- Re-run `scripts/ai-audit.ts` (wasted orders) after each step.

### Stage C (later, only if B holds)
- Move the picker into the sim: a `develop` order may name a track (`project: 'works'|'walls'|'yard'|'outpost'`)
  and `validateOrder` resolves it with the shared `nextInTrack`. The AI and humans then share one vocabulary,
  and the Chronicle can say "Ninefold raised its Walls".
- Concrete keys remain valid, so the AI and old plans keep working.

## 6. What this does not touch
- Fleet-level systems (postures, boons, vows), the Empire layer (research, laws), victory and VP.
- The map: the gravity well and choke points stay map rules, shown on the map.
- Combat numbers.

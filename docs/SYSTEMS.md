# Star systems (territory model v2)

Each Voronoi region stays **one** node for movement, battles and ownership. It now represents a whole
star system. The bodies inside it are economy and story, never movement targets.

Research basis:
- Stellaris: system vs. planets, and the per-pop simulation pitfalls to avoid.
- Endless Space 2: blockades as an output split.
- Master of Orion: one quality word per body.
- Sins of a Solar Empire: civil vs. military slots, gravity wells.
- Distant Worlds: automatic extraction.
- Aurora / Star Ruler 2: what to avoid.
- Neptune's Pride: minimal stars.
- Old World: the land decides what a city can become.

## Star: one glyph, one real effect
| Star | Effect |
|---|---|
| Yellow dwarf | habitable cap +1 |
| Red dwarf | habitable cap −1; dim: hidden from adjacent systems without a Sensor |
| Blue giant | +1 industry per Mine/Extractor; habitable cap ≤ 2 |
| Binary | may have 3 bodies; garrison +1 |
| Pulsar | no habitable world; sensor +1; Warp Gate −30% |
| Black hole | no habitable world; entering fleets stop here (gravity well); relic/memorial magnet |

Nebula stays an overlay on top of any star.

## Bodies: at most 3, one line each
| Body | Line |
|---|---|
| Habitable world (adjective; poor / fair / rich) | citizens cap 1 / 3 / 4: the only real population |
| Gas giant | +credits; fuel (Depot cheaper, +1 repair) |
| Asteroid belt | industry via Mine; evasive fleets hide here |
| Ice/rock moon | +1 cap next to a habitable world, else a Bulwark site (garrison ×1.5) |
| Barren/forge world (rich / poor) | big Mine site; cap 1 |
| Ruin | relic dig; Oracle |
| Station (the only buildable body) | +1 cap, +1 civil slot; one per system |

## Role: derived from the bodies, shown as a badge, never chosen
| Role | Bodies | What it's for |
|---|---|---|
| Core | fair/rich habitable world | citizens, influence, academies, big yards |
| Forge | belt or rich barren world, no good habitable | industry |
| Harbor | gas giant, no habitable | credits, refuel, depot |
| Waystation | rock/ice/nothing (pulsar, red dwarf) | supply, sensors, gates, forts |

- **Chokepoint** is an overlay rather than a role: degree ≥ 4 or a cut vertex adds a military slot.
- **Specials:**
  - Home: rich Core.
  - Crown: rich Core plus a Ruin or unique body.
  - Throne: yellow giant, rich world and Ring Ruin.
  - Relic sites: Ruin plus pulsar or black hole.
- **Per wedge (3-fold symmetric):** 2 Core (one safe, one border), 1 Forge, 1 Harbor, 1 Waystation, 1 Relic/Wild.
- **Veins:** antimatter on the border gas giant, crystals on the border belt.

## Citizens: one 0–5 number per system (the old `dev`)
- **Cap:** the sum of body caps plus the star modifier.
- **Growth:** +1 every 3 turns at an uncontested Core below cap (Garden: every 2 turns). Develop still buys +1.
- **Pips:** each pip adds +1 of the role's yield. Gates: Shipyard needs 2 citizens (or a Station); Academy needs 3.
- **Crews:** founding a fleet costs 1 citizen from its yard system ("Vel's people crew it"). Dreadnoughts cost 1. Ordinary hulls cost nothing.
- **Capture:** −1 pip, which becomes **refugees** that resettle the old owner's nearest system with room, logged in the ledger. A raze zeroes the pips and gives cap −1 forever.
- No species, happiness or jobs.

## Stories
- **The system ledger stays primary.** Each entry gains an optional body: the deterministic battlefield body is the world or station in a siege, and the belt for an ambush.
- **Chronicle names** come out as e.g. "Battle of the Ashen Belt (Vel)".
- **Body tags:** at most 1 per body, earned after 2+ events there, e.g. "Vel II, the Burned World".
- **Callings are gated by bodies:** Granary needs a habitable world; Refinery a belt, gas giant or vein; Oracle a Ruin or pulsar; Arsenal a shipyard; Cenotaph 2+ battles.

## Investment: not everything can be modified
- **Civil slots come from bodies:** Mine/Extractor on a belt, barren world or vein; Trade Hub on a habitable world or gas giant; Academy and Shipyard as gated above.
- **Military/logistics slots:** 2 everywhere (+1 at chokepoints) for Fortress, Batteries, Shield, Sensor, Depot and Gate.
- **Waystation discount:** military and logistics builds cost −30% where citizens ≤ 1. A barren pulsar becomes the best gate-depot-fort on the map.
- **No terraforming.** A Station is the only way to change what a system is. A breadbasket is something you capture, not something you build.

## Contested systems and sharing output
Bodies are **Orbital** (gas giant, belt, station) or **Surface** (habitable, moon, barren, ruin).

1. **Held:** the owner gets everything.
2. **Contested:** an enemy fleet is present and the garrison or defenders survive.
   - **Space control:** whoever won the last battle there and is still present; otherwise the larger force present.
   - **Orbital output:** goes to whoever holds space. If that is the attacker, they get 50% as plunder and the rest is lost.
   - **Surface output:** stays with the owner but is **blockaded** at 50%. Credits can't leave, influence doesn't grow, and veins don't count.
   - **Citizens:** no growth; after 3 contested turns, −1 pip (refugees).
   - **Two allied besiegers** split the plunder. Two hostile besiegers: nobody holds space.
3. **Occupied** (just captured): the new owner gets 50% of output for 3 turns, then the system is Held (ties into tenure).

**Parley/Tribute:** the attacker offers terms. If accepted, the siege lifts, the attacker gets ⅓ of the output for 5 turns, and a pact covers that system. The ledger records it as "Vel paid tribute to Kith".

## Map/UI
- **Strategic zoom:** star glyph by type, up to 3 body dots on an arc, role badge and citizen pips.
- **Operational zoom:** one row of body chips tinted by controller (`◉ Vel II ▪▪▪ │ ⁘ Ashen Belt ⚒ │ ◍ Tyr`).
- **Detail view:** a sheet with a star line and up to 3 body rows.

## Migration (each step ships on its own)
- **Data model:**
  - Add `star` and `bodies` to Region, generated in mapgen on a separate RNG stream so geometry is unchanged.
  - Old fields map to bodies: `trait` forge → barren-rich, garden → rich habitable, bulwark → moon, gas → gas giant; feature asteroids → belt; veins sit on bodies.
  - `dev` = Citizens with a derived cap (grandfathered).
  - Buildings gain `requires: { body?, citizens?, slot }`.
- **Rollout:**
  1. Bodies and stars as flavour, with trait effects sourced from bodies.
  2. Citizens cap and growth, slots, the waystation discount.
  3. Contested, Occupied and Tribute.
  4. Body-tagged ledger and Calling gates.

## As built (steps 1 and 2)
Code: `shared/sim/systems.ts` (helpers, generation, growth), `shared/config/systems.ts` (names, icons, one-liners),
numbers in `rules.systems`. Client: `client/src/hud/systems.ts` (card rows), `drawSystemMarks` in
`client/src/render/map.ts`, `regionArt` in `client/src/art/planets.ts` (paints the real star and bodies).

**Switch.** `sysOn(s)` = `rules.systems` present with `enabled !== false` **and** a map generated with stars
(`regions[0].star`). The server backfills missing rule groups on old saves, so the map check is what keeps old
games on their old behaviour: no cap (maxDev, Garden +1), no growth, no slots or gates, no discount, no gravity
well, and trait effects from `Region.trait`.

**Data.** `Region.star?: 'yellow'|'red'|'blue'|'binary'|'pulsar'|'blackhole'`, `Region.bodies?: Body[]` (≤ 3),
`Region.growth?: number` (turns banked). `Body = { kind: 'habitable'|'gas'|'belt'|'moon'|'barren'|'ruin', name, q?: 'poor'|'fair'|'rich', adj?, vein? }`.
Lane waypoints get neither. Both are public map knowledge (views send them for every system). A **Station** is a
project (`buildings.station`, max 1), not an entry in `bodies`.

**Generation.** `planSystem` runs on its own RNG stream (`seed ^ 0x5157e115`) per wedge-template site, so the three
wedges get identical systems and geometry, names, traits, veins and garrisons are byte-identical to before (tests
pin the hashes). `nameBodies` names them deterministically ("Ninefold I", "the Ashen Belt", "Tyr", "the Ring").
Anchors from the old fields: forge → rich barren, garden → rich habitable, bulwark → lone moon, gas → gas giant,
asteroids → belt, antimatter → gas giant, crystals → belt (the vein sits on that body). Home: yellow, rich world +
moon + belt. Crown: yellow/binary, rich world + ruin + moon/belt. Throne: rich "Throneworld" + "the Ring" + moon.
Relic sites: ruin under a pulsar (first per wedge) or a black hole (second). Plain colony: a fair world (border
Core). Flavour bodies never add an old trait's effect (no extra gas giants, rich worlds or lone moons).

**Traits from bodies** (`worldFx`): Forge = rich barren; Garden = rich habitable **colony**; Bulwark = moon with no
habitable world; Gas = gas giant. Yields, garrisons and develop discounts read these.

**Citizens** (`dev`). `citizenCap`: habitable poor/fair/rich 1/3/4 (yellow +1, red −1, blue ≤ 2), +1 per moon beside
a habitable world, +1 per barren world, +1 Station, clamped to 0..5. `maxDevAt` returns the cap. A system above its
cap keeps its citizens (grandfathered). Growth (`growSystem`, end of turn/cycle): an owned Core below its cap,
not under siege or battle and with no hostile warship present, gains 1 every 3 turns (Garden: 2); contested
turns pause the count.

**Gates, sites, slots** (`systemsBlock`, checked by `projectBlock`/`validateOrder`, new projects only):
Shipyard needs 2 citizens or a Station; Academy 3. Mine needs a belt, barren world or vein; Trade Hub a habitable
world or gas giant. Civil slots (Mine, Trade Hub, Extractor, Academy, Shipyard) = bodies + 1 with a Station;
military/logistics slots (Fortress, Battery, Shield, Sensor, Depot, Gate) = 2, +1 at a chokepoint
(`isChokepoint`: ≥ `chokeDegree` borders or a cut vertex). A slot is used per building *type*; level-ups keep it.
`slotsOf(s, r)` → `{ civil, civilUsed, mil, milUsed }`.

**Discounts** (`systemCostMult`, applied in `projectCostMod`): military/logistics projects −30% where citizens ≤ 1
(a Waystation); Warp Gate −30% at a pulsar (they stack).

**Stars.** Built: cap modifiers; binary owned garrison +`binaryGarrison` (3); pulsar sensor +1 for its owner and gate
discount; blue giant +1 industry per Mine/Extractor level; black hole gravity well: a fleet entering it stops for
the turn (even a Hyperjump), its route and Seize carry on next turn (`blocked` event, reason `gravity well`); LIVE:
it loses a step's worth of movement. Leaving is free.

**AI.** Plans only valid projects (`validateOrder`), develops up to the cap, offers a Station when one would unblock
a wanted project (`stationUnblocks`), and values military/logistics projects higher where they are discounted
(`aiSiteBonus`). It does not route around black holes.

**Deviations from the design above.**
- Chokepoint is `chokeDegree: 6`, not 4: about 80% of systems have 4+ borders, so 4 would make the bonus universal.
- Binary garrison is +3 (one development step), not +1: garrisons run 12–60, so +1 would be invisible.
- Garden (growth every 2, Develop −30%) is a rich habitable *colony*; homes, Crowns and the Throne are rich without
  it, so their Develop costs are unchanged.
- The antimatter vein's gas giant pays the gas giant's +4¢ (a small new income on that contested border system).
- Not built (deliberately): red dwarf "dim" (fog change), black hole relic magnet, gas giant fuel/Depot/repair,
  belt hiding evasive fleets, per-pip role yields (yield is still the old per-development multiplier), fleet crews,
  raze cap −1. Role badges are on the card, not on the map. (Refugees, Contested/Occupied/Tribute, the body-tagged
  ledger and the Calling gates: built in steps 3 and 4, below.)

**Balance** (`scripts/simulate.ts`, 45 games per run; before → after).
- expert/standard/novice (seed 1000): expert wins 29 → 36 of 45; game length 23.0 → 21.5 turns; styles turtle 25% → 41%,
  trader 22% → 19%, raider 35% → 38%, warlord 55% → 38%.
- expert×3, seeds 1000 and 7000 pooled (90 games): warlord 50% → 35%, turtle 23% → 28%, trader 32% → 36%, raider 29% → 35%;
  game length 23.9 → 21.6 turns.
- Projects per game (expert×3): Develop 9 → 4 plus ~21 free growth citizens; Stations ~1; Depots 1.4 → 3.4–4.1 (the
  waystation discount); Mines and Trade Hubs about the same.
- `scripts/ai-audit.ts`: wasted orders 0.2% expert / 0.5% standard / 0.3% novice (fogged view the same).

## As built (steps 3 and 4)
Code: `shared/sim/contest.ts` (Contested, Occupied, Tribute, refugees), step-4 helpers in `shared/sim/systems.ts`
(`battleBody`, `battleName`, `ledgerAdd`, `bodyTag`, `callingGate`, `outputBodies`, `tributeCovers`), `callingOffer` in
`shared/sim/soul.ts`, `regionYield` in `shared/sim/resolve.ts`. Knobs: `rules.systems` (`contested`, `plunderShare`,
`blockadeIndustry/Credits/Influence`, `refugeeTurns`, `refugeeMinCitizens`, `occupiedTurns`, `occupiedShare`,
`tributeTurns`, `tributeShare`, `bodyTagEvents`, `callingGates`, `cenotaphBattles`, `ledgerKeep`). Client:
`client/src/hud/systems.ts` (status line, per-body output, Tribute controls, notes), the blockade ring and tags in
`drawSystemMarks`, gated callings in the picker, body chips in the Chronicle, Herald icons.

**Switch.** Step 3 runs when `contestOn(s)` = `sysOn(s)` and `rules.systems.contested !== false`; step 4 when `sysOn(s)`
(Calling gates also need `callingGates !== false`). Old saves, old maps (no stars), rules without `systems`, and
`contested: false` + `callingGates: false` play exactly as before (the sim with both off reproduces the step-2
numbers to the VP).

**Contested** (`contestOf`): an owned system with a hostile warship in it (armed, not a lone scout, not limping; the
same test as supply blockades). Space holder: the winner of the last finished battle there (`Region.spaceWon`) if it
still has ships there; else the larger fleet strength (fleets only; the garrison holds the surface, not space; ties go
to the owner if it has ships there); two mutually hostile besiegers and no other holder: nobody. Shares
(`systemShares`, per resource, applied in `incomeDetail`):
- Orbital output (gas giant, belt, Station, and output with no body such as a Depot) goes to the holder. Attacker:
  `plunderShare` (50%) split between it and its allied (pact) besiegers present; the rest is lost. Nobody: all lost.
  The Warden takes nothing.
- Surface output: the owner's. While the owner does **not** hold space it is blockaded: industry ×50%, credits ×50%
  ("credits can't leave": half reach the treasury), influence 0. Holding space yourself means no blockade.
- The contested system's own supply cut-off halving is replaced by this split (no double halving); its vein already
  goes dark through the existing supply rule. No citizen growth (as before).
- `Region.contested` counts consecutive contested turns; every `refugeeTurns` (3) a citizen flees (never below
  `refugeeMinCitizens`).

**Output attribution** (`regionYield().parts`): citizens' yield, callings and laws on the habitable world (else
barren, moon, ruin, Station, open space); Mines and the blue-giant bonus on the belt (else barren world or vein);
Trade Hubs on the habitable world (else gas giant); the gas giant's credits on it; an Extractor on its vein's body;
a Depot on the Station (else open space). Held systems keep the old totals exactly; only the split uses the parts.

**Refugees** (`resettle`): the citizen goes to the old owner's nearest system (BFS over links, ties by id) with room
(citizens < cap) that isn't contested; else it is lost. Both ledgers record it, the chronicle names the haven, and the
Herald prints `refugees` / `refugees_lost`.

**Capture** (`onCaptureContest`): the existing war-scar citizen (force captures, not Crowns/Throne/Thrice-Taken) **is**
the refugee pip: no second loss. Occupied: `{ by, until: turn + occupiedTurns }`, the owner gets `occupiedShare` (50%)
of everything while `turn < until` (0% after a Scorched Earth capture). It lasts as long as the Calling's dormancy
(both 3), so the two end together; no Occupation on a Liberation, an influence defection or a neutral capture. A
capture ends any Tribute and gives the taker space control.

**Tribute.** Free action `{type:'tribute', region}` (offer) and `{type:'tribute', region, accept:true}`. Offers live in
`Player.tributeOffers` / `prevTributeOffers`, rotated at the start of a turn exactly like pact offers; views show them
only to the besieged owner. Offer (`tributeBlock`): a rival house's system your warships contest, no Tribute in
force. Accept (`acceptBlock`): the next turn (WEGO resolution reads last turn's list; LIVE either), while the offerer
still has warships there (largest force wins if several). Then: `Region.tribute = { from, to, since, until: turn +
tributeTurns }`; the besiegers' siege flags and Seize routes clear; the two houses are not hostile **in that system**
(`hostile(s, a, b, rid)`; combat, blocking, guards, captures and contest checks pass the region) and the recipient
takes `tributeShare` (⅓) of the system's output (after any other split) for 5 turns. Ledger: "Vel paid tribute to
Kith."; chronicle; public Herald `tribute`. A Seize on it by the recipient breaks it (`breakTribute`): −`pactBreakVp`,
Oathbreaker with the terms as the words, a `betrayal` event, the Herald's `tribute_broken`. It ends early if the system
changes hands; when paid in full the ledger says so.

**Interactions.** Scorched Earth (the owner's world posture this turn) denies plunder that turn and makes a capture's
Occupation pay nothing; its bet settles as before. Levies called in vain idle the whole system (nobody gets
anything). Postures, dug-in and exposed fleets are untouched.

**Step 4.** `Engagement.body` / `siege`: a siege is fought over the habitable world, else the Station; any other battle
(ambush, interception) at the belt; otherwise a body by hash of seed, system and battle count. Names: "Battle of the
Ashen Belt (Vel)", "2nd Siege of Vel II (Vel)" (border clashes and old maps keep their names); the Herald's battle
headline uses the same field. `RegionStory.ledger` (capped at `ledgerKeep`) gets battles/sieges (on their body),
captures, refugees, refuge, tribute, betrayal and paid entries; `ChronicleEntry.body` tags battle, refugee and
tribute lines. `RegionStory.bodyMarks` counts events per body (3 = the Station); a body with `bodyTagEvents` (2)+
events earns one tag from its commonest kind (`BODY_TAGS`: battle → "the Burned World", "the Graveyard Belt"...;
siege, capture, refugees, refuge, tribute), shown as "Vel II, the Burned World". Calling gates (`callingGate`):
Granary a habitable world; Refinery a belt, gas giant or vein; Oracle a ruin or pulsar; Arsenal a shipyard; Cenotaph
`cenotaphBattles` (2) battles fought here (`Region.battles`). `callingOffer` keeps both natural options when valid,
lists blocked ones in `pendingCalling.gated` (shown greyed with the reason), and replaces each with the first valid
fallback (trait side: Refinery, Granary, Arsenal, Bastion; history side: Oracle, Cenotaph, Proving Ground, Bulwark),
so there are always two valid choices. Existing callings are grandfathered. The AI picks from `options` only.

**AI.** Offers terms where it holds space but its assault odds are under 50% (not novice); accepts when the assault
would likely win (≥ 45%) or it is blockaded with no relief within two jumps (≥ 1.1× the besieger) on a Core or a
system with citizens to lose; never Seizes a system that pays it tribute. Experts add half the target's orbital
output as plunder value to a Seize (and take sieges of rich orbitals at 55% odds instead of 60%); moving to break a
blockade on its own system (a fight it wins) gains value, most on Cores.

**Deviations.**
- Occupation applies to captures from a house only (neutral colonies would slow early expansion); influence
  defections and Liberations are never occupied.
- The garrison doesn't hold space; the owner needs ships there. A contested system that the owner holds is not
  blockaded (a blockade needs space control): only growth pauses and the refugee count runs.
- "Credits can't leave" is read as: blockaded surface credits at 50% (knob), influence 0.
- Tribute makes the two houses non-hostile only in that system; it doesn't touch house-level pacts.

**Balance** (`scripts/simulate.ts`, 45 games per run, before → after).
- expert/standard/novice: seed 1000 expert 36 → 27 wins, seed 4000 26 → 35 (seed noise); pooled 90 games
  expert 62 → 62, standard 25 → 23, novice 3 → 5. Game length 21.5 → 21.6 and 20.7 → 20.7 turns.
- expert×3, seeds 1000 + 7000 pooled (90 games): warlord 35% → 36%, turtle 28% → 33%, trader 36% → 29%, raider
  35% → 35%; game length 21.6 → 22.2 turns.
- Per expert×3 game: ~6.5 contested system-turns (4.5 blockaded, 3.6 plundered), ~23 occupied system-turns,
  ~2.4 refugee moves, ~1.1 tribute offers, ~0.08 accepted.
- `scripts/ai-audit.ts --games 20`: wasted orders 0.6% expert / 0.5% standard / 0.3% novice.

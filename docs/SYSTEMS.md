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
  belt hiding evasive fleets, Ruin/Oracle gates, per-pip role yields (yield is still the old per-development
  multiplier), fleet crews, capture refugees / raze cap −1 (step 3), Contested/Occupied/Tribute (step 3), body-tagged
  ledger and Calling gates (step 4). Role badges are on the card, not on the map.

**Balance** (`scripts/simulate.ts`, 45 games per run; before → after).
- expert/standard/novice (seed 1000): expert wins 29 → 36 of 45; game length 23.0 → 21.5 turns; styles turtle 25% → 41%,
  trader 22% → 19%, raider 35% → 38%, warlord 55% → 38%.
- expert×3, seeds 1000 and 7000 pooled (90 games): warlord 50% → 35%, turtle 23% → 28%, trader 32% → 36%, raider 29% → 35%;
  game length 23.9 → 21.6 turns.
- Projects per game (expert×3): Develop 9 → 4 plus ~21 free growth citizens; Stations ~1; Depots 1.4 → 3.4–4.1 (the
  waystation discount); Mines and Trade Hubs about the same.
- `scripts/ai-audit.ts`: wasted orders 0.2% expert / 0.5% standard / 0.3% novice (fogged view the same).

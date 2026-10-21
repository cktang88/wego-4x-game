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

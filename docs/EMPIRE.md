# The Empire layer (research, ships, laws, worlds, supply)

Goal: a real 4X spine (invest now, pay off later; several ways to win) without
micromanagement. Every system is a few big, *public* decisions that rivals can
read and punish. Nothing needs tending every turn.

| System | Costs | Decision cadence | Payoff |
|---|---|---|---|
| **Research** (4 branches) | credits, *free action* (1 per turn / cycle) | every 2-4 turns | new ships, buildings, modules, rule-benders |
| **Ship modules** | free per class; *Refit* order to upgrade an old fleet | rare | fleets specialise (rock-paper-scissors) |
| **Laws** (4 opposed pairs) | an *order* + influence; switching costs double | 2-4 per game | your empire's identity |
| **Worlds** (traits, veins, Academy) | *Develop* orders | when expanding | reasons to want *that* planet |
| **Supply** | none: it follows territory | automatic | cutting/holding lines matters |

## Research: the Archives
Four branches, each **I → II → III (choose one of two, forever) → ★**. A ★ technology
can be owned by **one player per game**: whoever buys it first. Purchases are public.
Price grows with tier and empire size; an **Academy** cuts it. Capturing a rival's
Academy steals a technology you lack.

- ⚔ **Warfare**: Railguns (module) · Cruiser Yards · *Siege Doctrine* | *Alpha Strike* (either unlocks Dreadnoughts) · ★ Sunhammer
- ⛨ **Bulwark**: Deflectors (module) · Orbital Batteries · *Planetary Shields* | *Regenerators* · ★ Citadel Worlds (bigger garrisons, Crowns pay +1 VP)
- ➤ **Logistics**: Ion Drives (module) · Supply Depots (−40% upkeep; Depot hubs +3 industry) · *Warp Gates* | *Deep Scanners* · ★ Jump Drive
- ✦ **Statecraft**: Trade Compacts · Bureaucracy (+1 law slot) · *Subversion* | *Free Markets* · ★ Imperial Mandate

## Ship modules
Each ship class carries one module, set per class (a free blueprint choice).
New ships get it; a **Refit** order upgrades a whole fleet at one of your shipyards.
Armor Plating is known from the start; Railguns, Deflectors and Ion Drives are researched.

## Laws: the Charter
Pick at most one side of each pair. 1 slot at the start, +1 at turn 10, +1 from Bureaucracy.
Enacting costs an order and influence; switching to the other side costs double.
Bastion|Vanguard · Mercantile|Industrial · Centralism|Federation · Martial Law|Open Society.

## Worlds
Map generation gives regions a **trait** (Forge, Garden, Bulwark, Gas Giant) and places a few
**veins** of Antimatter ⚛ (cruisers, dreadnoughts) and Crystals ◆ (planetary shields, warp gates).
An **Extractor** on a vein you own pays credits and gives access while it stays connected. With star systems (docs/SYSTEMS.md) the traits are carried by bodies, and Develop is capped by each system's citizens cap.

## Supply
Your regions that link back to your capital through your territory (or your warp gates), with no
uncontested enemy warships sitting in them (a lone scout doesn't count), are **connected**. Cut-off regions yield half and their veins go dark.
Fleets in or next to connected territory (2 away from a Depot) are **in supply**; out of
supply they don't repair, and after a turn they start to wear down.

## Balance (measured with the AI; `npm run sim`, `npx tsx scripts/research-value.ts`)
Each AI seat plays one of four styles (warlord, turtle, trader, raider: different research
priorities, laws and modules). In expert-vs-expert mirrors (180 games, two seed sets) the styles
win 27-37% of their seats (fair share 33%): turtle 33%, trader 37%, warlord 36%, raider 27%.
An expert barred from researching wins far less often than its researching rivals, so
investment pays, but no single path is mandatory. Experts still beat standard and novice AIs
about 80% of the time.

# The Soul layer: making people feel something

Three research passes fed this design:
- **Attachment and emergent story:** RimWorld, XCOM, Nemesis, Wildermyth, Darkest Dungeon, Old World.
- **Playing with friends:** Diplomacy, Neptune's Pride, Legacy games, EVE, Blood on the Clocktower.
- **Living places and veteran units:** 40k Crusade, Necromunda, Blood Bowl, Battle Brothers, Polytopia, Stellaris.

## First principles
1. **The story happens in the player's head; the game supplies the prompts** (Sylvester). Prompts are a few loud, readable signals with real consequences, not deep hidden simulation.
2. **People love what they made, own and could lose** (IKEA effect, endowment, loss aversion). So the effort must be small and finished, the stakes real, and every loss readable.
3. **Remember the peaks, not the logistics** (Nemesis). Record the near-death, the revenge, the last stand and the betrayal, and play them back.
4. **History leaves scars.** Anything that can be fully repaired forgets.
5. **A character is a want plus a flaw, not a stat block.** Give fleets a vow and planets a calling.
6. **Our best NPCs are two friends.** RimWorld has to fake rivals; we have real ones. Every system should turn game events into *social memory between the same three people*.
7. **Few, rich things beat many shallow ones.** Each player has a handful of fleets and a handful of beloved worlds.

## 1. Fleets are characters
**Founding (a small ritual, finished at once).** Building ships no longer spawns anonymous fleets. A ship joins a fleet at the yard, or you **found** a new fleet:
- A **banner**: one of 12 sigils plus your colour.
- A **name**: 3 suggestions, editable.
- A **commander perk**, one of 3 drawn: Raider, Shieldwall, Lancer, Quartermaster, Ghost, Bulwark…
- **Where it was founded:** it remembers its home world ("the Vel Home Guard").

Banners are scarce: 3, plus 1 per Crown you hold.

**A vow: the fleet's want.** Each fleet may swear one vow, at founding or later; it is free and visible to everyone.

| Vow | Bonus while kept | When fulfilled |
|---|---|---|
| Take the Throne | +hit chance at the Throne | epithet "Throne-takers" |
| Never retreat | +retreat threshold immunity, +attack | epithet "the Unbroken" |
| Guard ⟨world⟩ | +defence there | epithet "Shield of ⟨world⟩" |
| Avenge ⟨commander⟩ | +damage vs them | epithet "the Avenger" |
| Bring a relic home | +speed while carrying it | epithet "Relic-bearers" |

Breaking a vow (retreating under Never Retreat, leaving the world it swore to guard) brands the fleet **Oathbreaker** for the rest of the game.

**Defeat routs; it doesn't erase.** When a fleet loses a battle (forced out, or down to its last ships), it does not vanish unless one of these applies:
- it was hopelessly outmatched (under 25% of the winner's strength);
- it is trapped;
- it is already **Limping**.

Otherwise it **routs**:
- One or more hulls survive at no more than 30% hull.
- It turns for the nearest friendly shipyard by itself. That trip home is a story.
- While Limping it cannot attack, it is slow and visible, and it dies if anyone catches it, so it can be hunted.
- It takes a **scar**, and every scar is double-edged:
  - Burned Hull: −hull, +nerve.
  - Grudge vs ⟨player⟩: +damage vs them, −damage vs others.
  - Skeleton Crew: −attack, upkeep halved.
  - Haunted: −speed, nearby enemies' morale drops.
- A third scar **breaks** the fleet. It is disbanded with honours, and its home world gains a Deed.

Individual ships still die, and they are named on memorials.

**Honours.** Commander rank-ups (already deed-driven) now offer a choice of 1 of 2 Honours. The pool is shaped by how the fleet fought: sieges offer Breacher, defences offer Unyielding, interceptions offer Hunter. At Legend rank the fleet earns an **epithet** and its perk upgrades. Limits: at most 3 Honours and 2 scars at once.

**Retirement.** A Storied or Legend fleet can be **retired** at a world. Its banner is returned and the world gains *Haven of ⟨fleet⟩*, a permanent Deed carrying the fleet's perk.

**Guardrails:**
- Upkeep rises with rank.
- Fleets earn XP only by fighting.
- A second rout within 4 turns kills the fleet.
- A fleet routed by one rival and then caught by the other dies.

## 2. Worlds with a story
Every world keeps a ledger of what happened there: **Toil** (turns developed), **Blood** (battles fought), **Siege** (attacks held off), **Relic**, **Loss** (memorials). From it, a world shows at most four things:
- **Epithet** (automatic, cosmetic): taken from its strongest mark, e.g. "Kessa the Unbroken", "Vael Thrice-Taken". It changes as history changes.
- **Calling** (your choice at development 3): pick 1 of 2.
  - One option comes from the world trait: Arsenal, Granary, Bastion, Refinery.
  - The other comes from what happened there: Proving Ground (Blood), Oracle (Relic), Cenotaph (Loss), Bulwark (Siege).
  - The same forge world becomes something different depending on its history.
- **Tenure:** the Calling grows at 3, 6 and 10 turns of continuous ownership, shown as a thickening ring. This is what keeps you coming back to the same worlds, and it is what conquest takes away.
- **Deeds** (earned, at most 2; you may engrave one so it is never replaced):
  - Unbroken: survived 2 sieges.
  - Thrice-Taken: changed hands 3 times.
  - Where ⟨fleet⟩ Fell: a fleet broke or died here.
  - Haven of ⟨fleet⟩: a fleet retired here.
  - King's Seat: the Throne's list of reigns.

**Capture:** history belongs to the place, tenure to the owner.
- Epithet and Deeds stay. "Taken by ⟨House⟩, T14" goes into the world's chronicle.
- Tenure resets, and the Calling goes **dormant** for 3 turns.
- The conqueror may instead **raze** it: a resource lump, development −1, and the former owner gains a vengeance bonus against them.
- If the former owner retakes the world within 5 turns, it is **Liberated**: the Calling wakes at its old tier, plus a Deed.

## 3. Your friends are the antagonists
- **The Herald.** Each turn (in LIVE, each cycle) a front page is written from the events: headlines about battles, routs, vengeance, broken vows, relics, coronations, deaths. Each player may plant **one dispatch** per edition: a boast, a threat or a lie, printed as fact. Your intel decides what to believe. Writing it costs nothing; it is all story.
- **Sworn pacts.** A pact can carry your own words ("I will not cross the Veil while Sam's Crown stands"). Breaking it brands your banner **Oathbreaker** and the Herald prints your words next to the breach.
- **Blood-debts.** When a commander kills another, their owner is in blood-debt to the victim's owner: a marker on the map, the Herald remembers it, and the avenger gets a bonus.
- **The Saga** (end of game): a shareable page with a one-paragraph saga per fleet, the Throne's list of reigns, the memorial roll, the three biggest moments, and broken vows and debts. It is the thing you send to the group chat.
- **Later (phase B):**
  - A **League** ledger across games: feuds, records, a Hall of Crowns. The winner's Decree names a star, and the last-place finisher carries an Ugly Trophy.
- **The Court (phase C, built):** Ransom, the Coronation and Exile. See section 4.

## 4. The Court: Ransom, Coronation, Exile (phase C)
Three social mechanics, each **one free decision with a visible payoff**. The code is `shared/sim/court.ts` (rules),
`shared/sim/ai-court.ts` (AI) and `client/src/court/` (UI modules). Every number is in `rules.court`. It is an opt-in
layer (`OPT_IN_LAYERS`): a save without a `court` group plays exactly as before, and it needs the Soul layer.

**Ransom.** A commander is **captured** instead of escaping when:
- its fleet is wiped out and the house that sank it still has ships in the system (a commander who falls still falls); or
- its limping fleet is caught by an enemy fleet. This is a capture outright, with no roll.

The Warden and garrisons never take prisoners. The captor makes **one decision a turn**:

| Choice | What happens | Default numbers |
|---|---|---|
| **Ransom** | Name the currency. The price is fixed: base + per-rank × rank. The owner may pay from the next turn; paying brings the commander home at once. Refusing clears the terms, and the captor decides again. | 12¢ + 4¢/rank, or 4 + 1/rank influence |
| **Execute** (a wax seal) | The commander dies. The captor's house owes a **grievance**: a blood-debt that never clears (vengeance does not pay it) and gives the victim's house +debtHit +4% to hit the executioner. It makes a public headline and a memorial. | executeHit 0.04 |
| **Turn** | The captor pays influence, and the commander joins its reserve. The commander keeps its rank, rivals and deeds, and its next fleet bears the scars of the fleet it lost. Public headline. | 3 + 1/rank influence |

**The clock:** at the end of turn captured + `releaseTurns` (4), a captive goes home free, so no game stalls. A captive
whose captor falls is released at once. **Fog:** the captive, the terms and any payment are seen by the two houses only.
A witness to the battle reads only "X survives the wreck". Executions and turncoats are public. The AI ransoms first. It
executes a commander that killed one of its own, turns a Veteran or better when it can afford to, and lets the clock run
otherwise. As an owner, it pays for a Blooded or better commander, or when the price is under 35% of its stock.

**Coronation: Kneel or Defy.** A new Throne reign opens a public countdown of `decreeTurns` (2) turns. Every living
rival answers in public:
- **Kneel** gives `kneelInfluence` (4) at once, paid once per house and holder per game. While that reign lasts, a
  Seize on the holder's worlds or fleets, or an Influence on its worlds, **breaks the knee**. That costs
  `kneelBreakVp` (2) VP, in public.
- **Defy** is free, and printed in the Herald.
- **No answer by the deadline counts as Defy** (printed as silence).

Losing the Throne releases the knees. The AI kneels only when it trails the holder by 4 VP or more, shares no border
with it, and the holder is not close to winning. It counts a broken knee as a cost when it picks orders.

**Exile.** A house that is eliminated goes into exile and stays at the table. It has two standing choices, set with
one free action:
- **Whisper to the Warden.** The awake Warden hunts the whispered house instead of the VP leader, but only if that
  house is within `whisperGap` (6) VP of the leader. This keeps an exile from turning the Warden on the weakest.
- **Ghost vote.** The house it backs gains `ghostInfluence` (1) influence a turn and **wins an exact VP tie**. That is
  the only tiebreak an exile has, and it comes before the Throne and Crowns.

**Exile points** come from the losses of the whispered house: 1 per ship and 2 per world, with the Warden's work
counting double. Only points against the **eventual winner** count. They appear in the Saga (`saga.exiles`) and the
League (`exilePoints` per seat and per member). The whisper and the running tally are the exile's secret; the vote and
the final points are public. An AI exile marks the leader and backs the trailing house. A human exile's choice is never
overwritten by a stand-in plan. An exile has no orders and never holds up the turn.

**Balance** (`scripts/simulate.ts`, the same seeds with the court on and off): see `docs/TODO.md`. Turning the court off
reproduces the old numbers exactly.

## What we cut on purpose
- Per-ship characterization (ships are background detail).
- Upfront perk menus beyond one pick.
- Generic +5% traits: every Deed changes a rule and shows on the map.
- Repairs that erase history.
- Random events that override player agency: drama comes from players' choices.

## Implementation phases
- **A (sim):**
  - fleet founding, banners, perks, vows, rout and limp, scars, honours, retirement;
  - world ledger, epithet, calling, tenure, deeds, capture rules;
  - blood-debts;
  - the Herald (generated, plus dispatches);
  - Saga data.
  - Choices (honour, calling) are free actions; the AI picks automatically, and if a human doesn't choose, a default applies after a turn.
- **B (UI, on top of UX v2):**
  - the founding dialog;
  - fleet and world cards (at most 4 chips, the latest 3 events as icon + turn);
  - map signals (banner tokens with rank chevrons and scar notches, Calling glyphs, tenure ring segments, deed pips, a limping trail);
  - the Herald on turn start;
  - the Saga page.
- **C:** League, Exile, Ransom, Coronation. Exile, Ransom and Coronation are built (section 4). The UI modules are in
  `client/src/court/`, and the HUD wiring is pending.

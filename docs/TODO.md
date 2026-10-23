# TODO / ideas we like but haven't built

## Legacy Galaxy
A friend group plays the same galaxy again and again, and it keeps the scars. What carries over:
- system epithets and memorials;
- a system the winner renames forever ("Tom's Folly");
- wreck fields and monuments of famous battles;
- the King's List of every Throne holder across games;
- returning legendary banners (founded again with the same name and one honour);
- commanders' nemesis records;
- a league table of feuds, oaths kept and oaths broken.

Needs: server-side league identity, map seeds per league, and a persistence and migration story for rules changes.

## League ledger (Soul phase C)
- Head-to-head records and feud meters.
- A Hall of Crowns.
- The winner's Decree (cosmetic or flavour only).
- The last-place finisher's Ugly Trophy.

## The Court (Soul phase C): built
Exile, Ransom and Coronation (Kneel or Defy) are built. See docs/SOUL.md section 4, `shared/sim/court.ts`,
`shared/sim/ai-court.ts`, `client/src/court/` and `tests/court.test.ts`. What is still open:
- **Wiring the UI modules** into the HUD: the chips, the prompt sheet, the exile's HUD and the Saga and League
  sections. The hooks are listed with the modules (`client/src/court/index.ts`).
- **Ransom terms beyond influence or credits** (a pact, a relic) were cut to keep the decision to one currency
  choice. Revisit them if players ask.
- **Balance** (`scripts/simulate.ts`). Wins by AI level, with the court off and then on, on the same seeds:

  | suite | games | court off | court on | winning margin (off → on) |
  |---|---|---|---|---|
  | expert, standard, novice | 40 | 25 / 13 / 2 | 22 / 16 / 2 | 18.4 → 15.7 VP |
  | expert, novice, novice | 40 | 38 / 2 | 32 / 8 | 23.9 → 25.1 VP |
  | standard, novice, novice | 40 | 28 / 12 | 26 / 14 | 19.0 → 21.2 VP |
  | expert, expert, standard | 40 | 32 / 8 | 32 / 8 | 16.3 → 14.3 VP |
  | expert, novice, novice | 120 | 110 / 10 | 110 / 10 | 24.0 → 24.0 VP |
  | expert, standard, novice | 120 | 86 / 31 / 3 | 80 / 32 / 8 | 18.7 → 18.5 VP |

  The shift is small and runs toward the trailing seats: they get kneel influence and ransoms. Seat balance did not
  move. With `court.enabled: false`, the numbers match the build before the Court exactly.

## Turncoats
Spend influence to plant a hidden agent in a rival's fleet or world, then activate it once at the worst possible moment.
- Grievances (broken vows, scars) make commanders easier to turn.
- Counterplay: Scan exposes agents; Martial Law and honoured commanders resist.

## Contracts
Self-executing deals with conditions and escrow ("while you don't enter Vel, I pay 5¢/turn"; "if Sam
attacks me, our pact activates"). They sit beside non-binding chat.

## Secret Ambitions
A hidden objective aimed at a named rival, worth VP and revealed at the end. It blunts dog-piling.

## More postures
- **Shadow ⟨enemy fleet⟩:** follow a fleet if it moves, and engage where it stops.
- **Run Silent:** hidden from scans; a hunter that misses you is revealed.

These were cut from the first set to keep postures few and non-overlapping.

## Other
- Ship-trait and fleet-boon balance dashboards in `scripts/simulate.ts`.
- A shareable Saga page (image export).

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

## Exile (Soul phase C)
Eliminated players stay in the game:
- they whisper to the Warden (set its hunt priority);
- they keep a ghost vote at the Throne;
- they earn Exile points for making the winner's victory costly.

## Ransom (Soul phase C)
Captured commanders can be ransomed (influence, a pact, a relic), executed (a permanent grievance), or
turned (they serve the captor and keep their memories). A clock auto-releases them so no game stalls.

## Coronation: Kneel or Defy (Soul phase C)
Taking the Throne starts a public countdown, and each rival must publicly Kneel or Defy.
- Kneel: gain influence; striking the holder later costs VP.
- Defy: costs nothing, but is a public declaration.

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

# Signature mechanics

A signature mechanic solves a problem only *this* game has, fits in one sentence, and creates
moments people retell. Ours serve a **3-friend, simultaneous-secret-turn, story** game.

## 1. ⭐ Postures: "Call It" through commitment, not menus
**One sentence:** you predict your friend's move by *committing your forces* to a posture. Right, and
you win the moment; wrong, and you pay for it.

There is no prediction menu and nothing to type. Every posture:
- is a real tactical stance with a **payoff if the read was right** and a **penalty if it was wrong**;
- is secret (rivals see it only by scanning or adjacency);
- shows on your own map as a literal icon on the fleet;
- costs no order: you set it on the fleet each turn, one posture per fleet, and it lasts that turn (in LIVE, one cycle).

The replay reveals every posture with a **CALLED IT** flash when a read pays off, and a **CAUGHT OUT** stamp when it backfires.

### Fleet postures
| Posture | You're betting that… | Right: payoff | Wrong: penalty |
|---|---|---|---|
| **Brace** | they attack you *here* | fortified, first strike, +defence for the whole battle | *Dug in*: can't move next turn |
| **Charge** (on a seize/attack) | the defender is *not* braced | first strike and +damage for the opening rounds | if they Braced: the charge breaks, you eat their first volley and lose a round |
| **Ambush** (in a system or lane waypoint next to their path) | they come *through here* | the enemy is stopped where they enter, and you strike first | *Exposed*: revealed to everyone, and fatigued (−attack) next turn |
| **Shadow ⟨enemy fleet⟩** (adjacent) | that fleet *moves* | you follow it and engage wherever it ends its move, with first strike | if it stays put, your fleet wastes the turn (no move or attack, no order refund) |
| **Run Silent** | they *scan or hunt* for you | hidden from sensors even when adjacent; a hunter that misses you is itself revealed | if they don't scan, you lose the turn's supply and repairs (lights off) |

**The triangle that makes it a mind game:**
- Charge beats a normal defender. Brace beats Charge. A non-attack beats Brace, because the bracer gets dug in.
- Ambush and Shadow punish the mover. Staying put punishes them.
- Your own feints and scans tilt every read.

### World postures (systems you own)
| Posture | Betting that… | Right | Wrong |
|---|---|---|---|
| **Call the Levies** | a siege lands here *this turn* | garrison ×1.5 at once | that system's output is lost this turn and next |
| **Scorched Earth** | you *lose* it this turn | the conqueror gets nothing (no plunder, no capture loot) and the Calling is razed by *you* | if you hold it: development −1 for nothing |
| **Open the Gates** | an *ally* (pact) needs refuge | their fleet repairs here as if it were their own yard | if a non-ally arrives, the garrison doesn't fire in round 1 |

**The AI** plays postures from its threat map and battle predictor. It reads your patterns (where you attacked before, which postures you favour) as human friends will.

## 2. ⭐ Fate: luck you spend, not luck that happens to you
**One sentence:** three Fate tokens per game turn a dice roll into a decision everyone saw you make.

**Uses** (one Fate per battle per side; each one public, with a Herald headline):
- **Last Stand:** this fleet will not rout or be forced out this battle, and gets +hit.
- **Surge:** one system produces double this turn, or a build there completes instantly.
- **Hyperjump:** a fleet moves +3 steps this turn, through a blockade.
- **Twist of Fate:** reroll this round's worst volley against you.
- **Rally:** a Limping fleet repairs to 60% where it stands.

**Supply:** 3 tokens per game, and a player 10+ VP behind gets a 4th, once. It is a comeback that feels heroic, not like pity.

## 3. Build order
1. **Postures**, the headline. They need a sim hook in movement and combat, AI support, and in the UI a posture selector on the fleet card, an icon on the fleet token, and the replay stamps.
2. **Fate**: sim, AI, UI.

Later ideas are kept in [TODO.md](TODO.md).

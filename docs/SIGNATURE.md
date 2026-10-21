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
There are five, and each is a single, non-overlapping bet. **Steady** is the default and the right choice
most turns. The other four are worth taking only when you are actually reading your friend, because
each one costs something when the read is wrong.

| Posture | The bet | Right: payoff | Wrong / cost |
|---|---|---|---|
| **Steady** (default) | none | none | none |
| **Guarded** | "they attack me *here*" | fortified, first strike, +defence for the whole battle | −1 speed and can't attack this turn; if no one comes, *dug in*: can't move next turn |
| **Running** | "my path is *clear*" | +2 speed this turn (long routes arrive early) | if anyone intercepts or engages you this turn: caught strung out, you can't fire in round 1 and take +50% damage |
| **Charge** (only with a Seize) | "the defender is *not* guarded" | first strike and +damage for the opening rounds | if they were Guarded: the charge breaks, you eat their first volley and lose a round |
| **Ambush** (stationary, in a system or on a lane waypoint) | "they come *through here*" | hidden; any hostile fleet entering is stopped there and you strike first | if no one comes: *exposed*, revealed to everyone and fatigued (−attack) next turn |

**No overlap:**
- Guarded protects *a place you hold* against an attack.
- Ambush *catches movers* (it works in empty space and on lanes).
- Charge is the attacker's bet against Guarded.
- Running is the mover's bet against Ambush.
- Steady never wins a read and never loses one.

**The mind game:**
- Charge beats Steady. Guarded beats Charge. Not attacking beats Guarded (the defender gets dug in).
- Ambush beats Running. Not coming beats Ambush.
- Feints and scans tilt every read.

**Shadow and Run Silent** were cut to keep the set small and distinct (see TODO.md).

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

## 4. As built (sim contract)
Code: `shared/sim/signature.ts` (rules, combat and end-of-turn hooks), `shared/sim/ai-signature.ts` (AI).
Numbers: `rules.signature` (`enabled`, `postures`, `worldPostures`, `fate` flags). Rules without that group
(older games) play without any of this.

**Free actions** (no Order cost; sanitized by `cleanFree`; LIVE: `queueFree`, applied at the next tick):
- `{type:'posture', fleet, posture:'steady'|'guarded'|'running'|'charge'|'ambush'}`: one per fleet per turn (LIVE: per cycle).
- `{type:'wposture', region, posture:'levies'|'scorch'|'gates'}`: a system you own, one per system per turn.
- `{type:'fate', use:'laststand'|'surge'|'hyperjump'|'twist'|'rally', fleet?, region?}` (`region` for Surge only).
- Validation helpers for the UI: `postureBlock`, `wpostureBlock`, `fateBlock` (an error string, or null).

**State:** `Fleet.posture` (secret), `Fleet.postureFx` (secret bookkeeping), `Fleet.dugIn` (secret: can't move
while `>= turn`), `Fleet.exposed` (public: seen by all and fatigued while `>= turn`), `Fleet.fate` (public: this
turn's Fate). `Region.wposture` and `Region.idleUntil` (owner only), `Region.surge` (public). `Player.fate`
(tokens left), `Player.fateBonus`, `Player.fateSpent`, `Player.postureLog` (postures rivals have seen revealed).
Rivals see a fleet's posture only with a fleet in the same system or a scan over it (`postureSeenBy`).
A fleet in Ambush is hidden even from neighbours unless they scan it or share its system.

**Events:** `{k:'posture', fleet?, owner, posture, outcome:'called'|'caught'|'none', region, text, with?, public?, private?}`
(no `fleet` for a world posture) for CALLED IT / CAUGHT OUT stamps; `{k:'fate', owner, use, fleet?, region?, text, left}`
(`use:'bonus'` = the comeback token). Shots fired with first strike carry `first: true`; a volley undone by Twist
of Fate carries `twist: true`. Herald kinds: `p_called`, `p_caught`, `p_ambush`, `p_broken`, `p_exposed`,
`p_scorched`, `p_levies`, `fate`, `fate_bonus`.

**Rulings:**
- A posture lasts the turn (LIVE: the cycle). Charge with no Seize, or Ambush with a move, falls back to Steady
  (a `fail` event). A Guarded fleet's Seize fails, and Guarded or Ambushing fleets don't join assaults or answer guard calls.
- Called/caught is decided when the bet meets reality: Guarded when a hostile fleet arrives where it stood (not
  in an old fight with no newcomers: `none`); Running the moment it fights; Charge when it reaches its Seize
  target (Guarded defenders that stood still, Called Levies, or, by a secret roll of `neutralBraceChance`, a
  neutral garrison or the Warden brace); Ambush when a hostile fleet enters. Undecided bets settle at the end of
  the turn: Guarded with no arrival is dug in, Ambush with no arrival is exposed (public), Running that moved
  freely is called (private).
- "Round 1" for a fleet means its first combat round this turn. First strike: those shooters fire and their
  hits land before anyone else fires that round.
- Posture vs doctrine: the doctrine keeps its retreat threshold, target and guard flag; a Guarded, Charging or
  Ambushing fleet never acts Evasive (`effStance`). Fortify and Guarded stack. Ambushers / Shock Troops still
  double their first volley; Clean Break still breaks off cleanly. Limping fleets: Steady or Running only.
- Hyperjump slips through blockades (enemy fleets and garrisons on the way) but an Ambush still stops it.
- Last Stand: the fleet never retreats, routs or is forced out this turn, and hits harder; if it is wiped out, it dies.
- Twist of Fate: the single enemy ship whose volley hurt the fleet most in its first exchange of fire this turn misses.
- Fate limits: `fatePerTurn` per house, one per fleet per turn, one battle Fate (Last Stand / Twist) per side per engagement.
- Scorched Earth on capture: the conqueror gets no Raiders' loot, no stolen archives and nothing to raze; the
  Calling is gone. VP for the capture (capital, bounty) still counts.

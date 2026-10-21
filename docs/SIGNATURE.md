# Signature mechanics: the things people will describe the game by

A signature mechanic must (1) solve a problem only *this* game has, (2) be explainable in one
sentence, and (3) create moments people retell. Old World's Orders solve "4X micromanagement". Azul's
draft solves "what you take is what you deny". Ours must solve the problems of a **3-friend,
simultaneous-secret-turn, story** game:

| Problem | Why it hurts |
|---|---|
| WEGO's core skill (reading your friends) is invisible and unrewarded | the best play leaves no trace; defence is passive |
| Luck can decide a battle and feel like the "RNG god" | losses feel unearned, and unearned losses don't make stories |
| Three players → dog-piling and kingmaking | the trailer decides the winner, arbitrarily |
| Friends play many games together, but each game is forgotten | no running feuds, no legends |
| Betrayal needs teeth *and* plausibility, asynchronously | pacts are either toothless or rigid |

## 1. ⭐ Call It (Gambits): the headline mechanic
**One sentence:** each turn, besides your 5 orders, you seal one secret prediction of a rival's move;
if you called it, your trap springs.

**What you call:** pick from a structured menu of *player* + *verb* + *place*:
- "Sam attacks Vel"
- "Tom's fleet passes the Veil lane"
- "Jess takes the Throne"
- "someone excavates Ilos"

**If it comes true, the gambit fires on that action during the same resolution step:**

| Gambit | Effect |
|---|---|
| Ambush (attack/seize called) | your forces there and next door fortify and strike first; idle fleets next door join |
| Snare (movement through a lane called) | the mover stops on the waypoint, and your nearest fleet in range intercepts it |
| Counter-intel (an intel action called) | their scan or feint fails and shows them false picture |
| Foresight (anything else called) | +1 VP and a Herald headline: "Kith called it" |

**If it misses:** nothing is lost but the opportunity. Only you see that it missed.

**Why it's needed:**
- It turns the one skill that matters in WEGO, knowing your friends, into a visible move with payoff.
- Defence becomes active play: "I think he goes for Vel; I'll set the ambush and keep my fleet free".
- It gives the existing feints and scans a purpose. A feint now *baits* a wrong call, and a scan *confirms* one: bluffing becomes real.

**The replay moment:** the arrow reaches Vel, the screen flashes **"CALLED IT — Kith saw this coming"**, and the ambush fires. Your friend is shouting.

**Live mode:** a gambit stands for a whole cycle as a trap.

**Guardrails:**
- One gambit per turn, so it costs no orders, but you can only guard one guess.
- Ambush only works where you have forces next door.
- Predictions are menu-structured, so they are unambiguous and the AI can play them too.

## 2. ⭐ Fate: luck you spend, not luck that happens to you
**One sentence:** each player holds three Fate tokens per game; spend one to bend a battle, and everyone sees it.

**Uses (one per battle per side):**
- **Reroll** this round's worst volley.
- **Hold the line:** ignore a forced retreat this turn.
- **Seize the initiative:** strike first next round.

**Rules:**
- A trailing player gets a fourth token. It's a comeback mechanism, but it feels heroic, not like pity.
- Every spend is public, makes a Herald headline, and is a peak moment: "He burned his last Fate at the Throne."

**Why it's needed:** it answers "RNG god decides the game". The big swings are *chosen*, scarce and
visible, so they make stories, not resentment.

## 3. ⭐ The Legacy Galaxy: your friend group's galaxy remembers
**One sentence:** a group plays the same galaxy again and again, and it keeps the scars.

**What carries over between games:**
- System epithets and memorials.
- The winner renames one system forever ("Tom's Folly").
- Wreck fields and monuments of famous battles.
- The King's List of every Throne holder across games.
- A legendary fleet of the last game can be founded again as a returning banner, with the same name and one honour.
- Commanders' nemesis records.
- The league table: feuds, oaths kept and broken.

**Why it's needed:** friends replay with friends. No 4X lets your group's history *become the map*.
"This is where I beat you last spring" is the strongest emotional anchor available, and only a
friend-group game can have it.

## 4. Turncoats: social deduction inside the 4X (later)
**One sentence:** influence can secretly plant an agent in a rival's fleet or world; activate it once, at the worst possible moment.

**How it works:**
- Commanders with grievances (ignored vows, scars, broken by Oathbreaker orders) are easier to turn.
- Counterplay: Scan exposes agents; Martial Law and honoured commanders resist.

**Why it's needed:** it gives betrayal mechanical teeth beyond pacts. "My flagship turned on me in the
Battle of the Throne" is a story people tell for years.

## 5. Contracts: deals that execute themselves (later)
**One sentence:** write a deal as conditions and the engine keeps it, e.g. "while you don't enter Vel,
I pay you 5¢ a turn", or "if Sam attacks me, our pact activates".

**Why it's needed:** async diplomacy breaks when partners aren't online to honour deals. Contracts sit
beside non-binding talk, so binding and lying both have a place.

## 6. Secret Ambitions (later)
**One sentence:** each player draws a hidden ambition aimed at a named rival ("Sam never holds the
Throne three turns running"), worth VP and revealed at the end.

**Why it's needed:** hidden victory information blunts dog-piling the leader, and the end reveal
rewrites the replay: "you were after *me* the whole time?"

## Build order
1. **Call It.** It is the signature; it needs a sim hook in resolution, AI predictions and a small UI (a sealed card plus the replay flash).
2. **Fate.** It is small and fixes the luck complaint.
3. **Legacy Galaxy.** It merges with the League ledger (Soul phase C).
4. **Turncoats, Contracts, Ambitions.**

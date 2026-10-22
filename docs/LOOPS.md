# Loops: why anyone plays the next turn, the next game, the next month

This doc plans the three loops of Three Crowns, maps every reward moment, and orders the work into three
waves. It is a design doc: nothing here is built unless the **Now** column says so. Companion docs:
[DELIGHT.md](DELIGHT.md) (88 concrete details) and [QUALITY.md](QUALITY.md) (the ship checklist).
It assumes the cuts in [SIMPLIFY.md](SIMPLIFY.md) and the card in [WORLD-CARD.md](WORLD-CARD.md): nothing
here adds a rule, and every reward below is presentation over events the sim already emits, unless marked
as a TODO.md mechanic.

**The one-line thesis.** Three Crowns is a game about *reading your friends*. Every loop should end in a
reveal that answers "was I right about them?", and every reward should be something you can retell
to those same two friends.

---

## 0. What the award winners teach us

| Game | What it does best | What we take |
|---|---|---|
| **Hades** | The story advances *because* you repeat. Characters remember: "every time you run into a boss, they remember", and the game keeps "a tally of who won this time, who won last time" (Kasavin). 21,000+ voiced lines, picked by priority and condition, so the game seems to notice everything. Kasavin fills games with "unnecessary" details because you can't know in advance which one a player will love. | The **Herald** and commanders must *remember*: callbacks ("the third siege of Vel"), counts, grudges. A large pool of short, conditional lines beats a few long ones. |
| **Into the Breach** | Enemies telegraph their moves, so "each match becomes a puzzle"; consequences are readable *before* you commit. | Every preview (seize odds, posture bets, supply cuts) tells the truth, and the replay never shows a result the player couldn't have reasoned toward. Juice may *exaggerate the feeling*, never the numbers. |
| **Inscryption** | The rules live in objects: scales keep score, the cabin is "a rules archive where objects explain, interrupt and modify". Mullins cut card text to name plus icons for legibility. | Our UI is **objects on a table**: brass sockets, wax seals, coins, a newspaper, a leather book. Not panels. When text would go on a card, an icon goes there instead. |
| **Slay the Spire** | A tight run, then a meta loop of unlocks and 20 Ascension levels; every card has a purpose; balanced with metrics (Giovannetti, GDC 2019). | The session is the run; the **League** is the meta. Use `npm run sim` metrics for pacing (when the first battle happens, when the lead changes), not just win rates. |
| **Balatro** | Layered scoring feedback: cards flip with a spring, digits roll like reels, shake scales with the score, each scored card is a higher note. | The **VP roll-up** and the replay: escalating pitch, coins that fly to your crest, shake scaled to stakes. |
| **Neptune's Pride** | Real-time, days long, and it makes "every conversation you have with fellow players an agenda" (bit-tech). Its price is "the friendships you sacrifice" (PC Gamer). | LIVE mode, ETAs and the notification as an event. The *social* fallout is the content; our job is to make it fun to retell, not bitter (Saga awards, Ugly Trophy). |
| **Diplomacy** | Secret written orders, revealed at once: "whispered promises in one corner crumble into accusations across the room when orders are revealed". | Our reveal *is* the Diplomacy reveal. Stage it: seals crack, all arrows draw at once, betrayals get their own beat. |
| **Marvel Snap** | Simultaneous turns keep both players "always in on the action"; Brode cites the doubling cube and simultaneous-reveal board games. | Short planning turns, everyone always busy; Fate as a public "I'm sure" signal, like a Snap. |
| **Polytopia** | Midjiwan didn't port a PC 4X; they "reshaped the genre": deep mechanics, simple controls, games of 20–60 min. | Five orders forever. Cut anything that doesn't produce a reveal or a story (see the SIMPLIFY proposal). |
| **Twilight Imperium** | The agenda phase turns influence into votes and forces open negotiation: "if you want to eat, you're going to have to share the scraps". | A *table-talk moment* in each game: the Coronation (Kneel or Defy, from TODO.md) is our agenda phase. |
| **Root** | Asymmetry as a design philosophy, at a high cost in balance and art (Wehrle). | We keep houses symmetric for now; asymmetry comes cheap from *history*: each house's scars, vows and League titles make it play and look different. |
| **Risk Legacy / Wildermyth** | Permanent changes: you name cities, write on the board, and heroes return in later campaigns. | The **Legacy galaxy** and returning banners. |
| **Juice it or lose it** (Jonasson & Purho, 2012), **The art of screenshake** (Nijman) | Feedback layers (easing, squash, shake, particles, sound) turn a dull prototype into a toy. Hicks et al. (DiGRA 2018) found juice raises *perceived* quality, while a related study found players did *worse* in the juicy version. | Juice is budgeted: loud for rare, decisive moments; quiet for frequent ones; never in the way of reading the board. |
| **MDA** (Hunicke, LeBlanc, Zubek, 2004) | Designers build mechanics, players feel aesthetics. | Our target aesthetics, in order: **Fellowship** (friends), **Narrative** (stories), **Challenge** (reads), **Fantasy** (space-opera house), **Sensation** (the table). Every feature names which one it serves. |
| **Chemistry of game design** (Cook) | Loops are skill atoms: action → simulation → feedback → model update. | Each loop below ends with feedback that updates your *model of your friends*. |

---

## 1. The minute loop: one turn (WEGO 30–120 s of planning, 20–45 s of reveal)

### 1.1 The shape
```
READ (5–15 s) → SURVEY (10–30 s) → PLAN (20–60 s) → BET (5–15 s) → SEAL (1 s) → WAIT (0–∞) → REVEAL (20–45 s) → RECKON (5 s) → READ…
 Herald           threats, odds      5 orders         postures,       wax          the others    the replay           VP roll-up,
 front page       primary button     on the map       Fate            seal         deliberate    "slot machine pull"   counts, teaser
```
The turn is a **question** ("what will they do?") asked during PLAN and BET, held during WAIT, and answered
during REVEAL. The rest of the design exists to sharpen the question and dramatise the answer.

### 1.2 Each step, and how it should feel

| Step | What the player does | Feel target | Feedback (visual / sound / phone) | Now |
|---|---|---|---|---|
| **Read** | Opens on the Herald's front page; skims the headline and one dispatch. | "Something happened, and it's about *us*." | Page unfolds from the table; paper sound; the headline about you is first. | Herald exists, opens on turn start; generic headlines on quiet turns. |
| **Survey** | Scans for threats; the primary button walks idle fleets. | Calm, legible, Into the Breach clear. | Threat outlines on enemy fleets adjacent to you; a rival's last-seen position as a ghost with the turn it was seen. | Semantic zoom, lenses, idle cycling exist. |
| **Plan** | Drags fleets; taps builds. 5 slots. | Tactile: picking up and putting down a miniature. | Lift: token rises, shadow widens, felt tick; drop: wooden *tok*; slot fills with a chip clack whose pitch rises I→V (5 notes, the fifth resolves the chord); light haptic per slot. | Drag, preview card, chip sound exist; no lift, pitch ladder or haptic. |
| **Bet** | Sets postures on fleets; maybe spends Fate. | The pleasant nerves of a poker bet. | The posture is a small face-down token placed on the fleet's base; only you see its face. Fate coin spins on the table and lands. Medium haptic. | Posture selector and icon exist; the coin sound exists. |
| **Seal** | Presses Seal. | A ritual: irreversible-feeling (though unseal exists), satisfying. | Wax drips onto the strip, the house signet presses, a bell; heavy haptic; your crest shows a wax seal to the others. | `ui_seal` sound, crest tick. |
| **Wait** | Nothing; or reads the Herald, chats. | Anticipation, not boredom. | The unsealed rivals' crests show trickling sand; when the *last* friend seals, music ducks, the room "inhales" (a 600 ms swell), and the seals crack. Async: a push notification (§4). | Crest ticks; in-tab browser Notification only. |
| **Reveal** | Watches the replay. | The slot-machine pull: tension, then release. | See §1.3. | Chronological beats, stamps, battle roundels, sound per event. |
| **Reckon** | Sees the summary ribbon. | "Here's what I got." | VP coins fly to crests and digits roll; a ribbon: `+3♛ · 1 CALLED IT · Vel captured · 2 ships lost`; a Herald teaser headline for next turn. | Crest VP number changes without animation. |

### 1.3 The reveal: our slot-machine pull
A slot machine works through **anticipation** (the reels spin and stop one at a time), **near-misses** and
**variable reward**. Diplomacy works through **betrayal made visible**. The replay should do both, while
staying truthful: it shows exactly what the sim resolved, only *paced and framed*.

**The replay in five movements** (one director, `game.ts` beat builder; causality is preserved: we reorder
only presentation of *independent* events within a movement, never across steps the sim ordered).

1. **Unsealing (0.8 s).** Three wax seals crack, in the order the players sealed. Last to seal cracks last
   ("the one who agonised").
2. **The flop (1.5–3 s).** Every order arrow of every player draws *at once*, colour by colour, for 600 ms
   before the fleets move. This is the Diplomacy "orders on the table" moment: you see the betrayal
   *as intent* before you see its outcome. Pact breaches get a torn-parchment icon on their arrow.
3. **Movement and bets (3–8 s).** Fleets move; posture tokens flip face-up as they meet reality. CALLED IT
   / CAUGHT OUT stamps land with a 120 ms hitstop. Clashes on lanes spark.
4. **Battles (5–20 s).** Battles play in **ascending stakes**, so the biggest one is last: *"…and at Vel."*
   Each battle *holds* for 400 ms before resolving (both power numbers and the odds dial shown: the reel
   still spinning). Decisive volleys go to 0.35× for 600 ms with sound pitched down, then snap back. The
   killing blow gets a camera push-in. A survivor at ≤ 5% hull gets **BY A THREAD**.
5. **Aftermath (2–4 s).** Captures flood the territory with the new owner's ink from the star outward.
   VP coins fly from their sources (Crown, edict, battle) to each crest, with a rising pitch per coin.
   The Reckoning ribbon (§1.2) closes it.

**Tempo map, not a fixed speed.** Each beat has a *drama weight* (0–3): builds and research weight 0 run at
3× speed in batches; a capture of a Crown or a commander's death weight 3 runs at 0.75×. The whole replay
targets 20–45 s; Space skips straight to the Reckoning ribbon so no information is lost by skipping.

**You first.** Within a movement, events involving you play first and centred; events between the other two
play second and wider. Spectators (Watch AIs) get the neutral order.

**Near-misses are content.** A seize that failed by one ship, a posture that *would* have been called if the
rival had come, an Ambush that waited in vain one system away: the Reckoning ribbon names the best one in
the Herald's voice ("Kith's ambush waited at the Ashen Belt. Sam passed one system north.").

**Truth rules (Into the Breach).** No juice changes a number. Slow-mo is only for a volley that actually
decided the battle (the side's retreat threshold crossed, or the last ship). A stamp only for a real
called/caught event. The replay never hides an event the player is entitled to see.

### 1.4 LIVE mode's minute loop
LIVE has no seal and no single reveal. Its loop is **order → ETA → arrival**. The pull is the arrival: a
push notification "Your fleet reaches Vel in 10 min" invites you back to watch the tick. Every tick that
contains you is a mini-reveal (movements 3–5 only); ticks without you aggregate into a digest. Bank pips
fill with a clink; the full bank glows (an order you're wasting).

---

## 2. The session loop: one game (1–2 h hotseat/LIVE-fast, or 1–3 weeks async WEGO)

The AI sim says a game lasts ~21–22 turns. A human game should feel like **five acts**, with the Herald
marking each act with a special edition. Acts are *detected*, not scheduled: they announce what the
players did.

| Act | Typical turns | What happens | The beat that marks it | Rewards in this act |
|---|---|---|---|---|
| **I. The Claim** | 1–5 | Seize neutrals, found banners, first Calling. | First capture; first Herald naming your house; first banner founded. | Many small ones: captures, citizens, research. |
| **II. The Borders Close** | 5–10 | Territories touch; scans, feints, pacts; Laws slot at T10. | Herald special: "THE BORDERS CLOSE" when all three houses first share a border. | First pact signed, first intel read right. |
| **III. First Blood** | 8–14 | First house-vs-house battle, first rout, first blood-debt, vows sworn. | The first battle between houses gets a full-screen title card on the board ("THE FIRST BATTLE OF THE WAR: the Ashen Belt"). | Medium: battles, CALLED IT, commander rank-ups. |
| **IV. The Crisis** | 13–20 | Someone leads; ★ techs taken; Fate comeback token; alliances against the leader. | Herald: "THE GILDED GROW FAT": automatic once a house leads by ≥ 25% of the VP goal. The leader's crest is marked for everyone. | Big: Crown captures, legends, nemesis kills. |
| **V. The Throne** | 18+ | Throne race; Coronation (Kneel or Defy); last stands. | **Coronation**: holding the Throne starts a public countdown and each rival chooses Kneel or Defy in public. Last turn: "LAST ORDERS" edition and a longer final reveal. | The biggest: victory, Saga, awards. |

### 2.1 Pacing devices (existing mechanics, framed)
- **Edicts** (public objectives revealed a turn before they score) are our pacing metronome: each one is a
  public "everyone go *here*" beat. Present the next edict as a sealed proclamation nailed to the table
  edge, opened at turn start.
- **The VP arc** on each crest is the race. When a house is within 3 VP of victory, its crest trembles
  and the board's ambient gains a low drum: everyone knows it's now or never.
- **Turn count** `TURN 14/32` becomes a candle that burns down at the top-left; the last five turns, it
  gutters.

### 2.2 Comeback mechanics (heroic, not pity)
- **Fate bonus token** (exists): a player 10+ VP behind gets a 4th. Present it as a gift from the Herald's
  readers ("The people remember House Kith"), with its own sting.
- **The Herald targets the leader**: headlines and the leader mark make dog-piling the leader the *natural
  story*, without a rule.
- **Kneel or Defy** gives the trailing players a public, dramatic choice instead of a quiet loss.
- **Secret Ambitions** (TODO.md, keep as a candidate): a hidden objective against a named rival, revealed at
  the end, which blunts dog-piling the weakest.
- **Exile** (TODO.md): an eliminated friend keeps playing (whispers to the Warden, a ghost vote). For a
  3-friend game this matters more than any balance rule: **nobody goes home early**.

### 2.3 The finale and the Saga payoff
The current end is a dark modal ("VICTORY", a sunburst, three buttons) and a dark web page. It is the biggest
missed reward in the game. The finale should be a **ceremony** of about 60 s that every player enjoys,
including the losers.

1. **The final reveal** plays at 0.75× with the Throne battle last.
2. **The crowning.** The lamp swings to the winner's place on the table; their banner drops; the Throne star
   takes their colour; the victory sting. On the losers' screens the same scene plays, and their own banner
   lowers slowly. No modal.
3. **The awards** (3–6 superlatives, at least one per player), cards dealt onto the table:
   *The Unbroken* (never lost a battle), *Oathbreaker* (broke a pact), *Called It* (most reads paid),
   *The Butcher* (most ships destroyed), *Kingmaker* (the loser who hurt the 2nd place most), *Last Stand*
   (best Fate use), *The Herald's Darling* (most headlines), *Survivor* (held the capital all game).
   This is the party-game superlative trick: everyone leaves with a story about themselves.
4. **The Saga** as a bound book (leather cover in the winner's colour): the reigns of the Throne, a page per
   banner with its commander portrait (scars included), the memorial roll, the three biggest moments with
   a ▶ replay link each, the broken oaths and the blood-debts.
5. **The share card**: one image (1200×630 and 1080×1350) with the three seals, the decisive battle's snapshot
   and the headline. One tap to share. This is the thing that lands in the group chat and recruits the next
   game.
6. **"Again?"**: a single button that creates a rematch on the same galaxy (the Legacy galaxy, §3) with the
   same three seats.

---

## 3. The 10+ hour loop: the same friends, many games

TODO.md lists many ideas. The strongest few, chosen for **social memory per unit of work**:

### 3.1 ⭐ The League ledger and rivalries (build first)
A **League** is the three friends (identity: the three account or invite names) and their history.
- **Head-to-head** per pair: wins, games, battles won against each other, ships destroyed, oaths broken
  to each other.
- **Nemesis**: per pair, the rival who has hurt you most (ships killed + captures). Shown everywhere you see
  that rival: their crest wears your nemesis mark. First game of a session, the Herald's front page opens
  with the feud: *"SAM AND KITH: THE FOURTH MEETING. Kith leads 2–1."*
- **Records**: biggest battle, longest-held Crown, fastest Throne, most CALLED IT in a game.
- **The Hall of Crowns**: the winner's plaque per game.
- **The Ugly Trophy**: last place keeps a dented tin goblet on their side of the lobby table until they
  stop being last.
Cost: medium (server-side league id; a stats reducer over finished games; lobby UI). Impact: the highest of
anything in this section, because it turns every game into an episode.

### 3.2 ⭐ House heraldry: the cosmetic progression
Your **House** persists: name, colour preference, sigil, motto. Achievements in play *quarter* the shield,
like real heraldry, and every quartering is earned by a deed, never bought:
- a crown in chief for each Throne victory (up to 3, then a gold border);
- a broken chain for a Liberation; a black bend (a diagonal stripe) for an Oathbreaker game (shame is fun
  among friends, and it fades after two clean games);
- a laurel for an Unbroken award; a skull for the Butcher.
Unlocks are *motifs* (new sigil shapes, banner fringes, signet styles, wax colours), granted by League
milestones: first win, 5 games, first nemesis kill, first Legend commander.
Cost: medium (sigil compositor exists in `art/sigils.ts`). Impact: high; it's the visible trophy cabinet.

### 3.3 ⭐ The Legacy galaxy (lite first, then full)
The same friends can replay **their** galaxy. Lite version (wave 2): the map seed is kept; the winner
**renames one star** forever ("Tom's Folly"); stars where commanders fell keep a **memorial**; the King's List
carries over. Full version (wave 3): wreck fields, returning legendary banners ("Raise the old banner: *the
Unbroken*, game 3"), commanders' nemesis records, a body tag that survives. Needs a migration story for rule
changes (TODO.md); keep everything carried over cosmetic or narrative so rules can change freely.

### 3.4 Titles
One earned title per house, shown under its name in the lobby and the Herald: *Twice-Crowned*, *the
Oathbreaker*, *Kingmaker*, *the Unlucky* (lost three games where they led at turn 15). Titles come from
League stats, change over time, and the Herald uses them.

### 3.5 Seasons
A **season** is 5 games. The season champion (most wins, ties by VP) issues a **Decree** for the next
season: one choice from a short list of rule *variants* that are flavour-sized (the Throne pays +1 VP; Fate
starts at 4; the Warden is hungrier). It's Risk Legacy's "the winner changes the world", cheap to build, and
it hands the loser of a season a motive. Seasonal *events* that override agency are out (SOUL.md cut them).

**Not now:** Turncoats, Contracts, Ransom (good, but mechanics; the SIMPLIFY proposal should judge them).

---

## 4. Single-player and async hooks: why come back tomorrow

| Hook | What it is | Why it works | Cost |
|---|---|---|---|
| **Turn-ready push** | Real Web Push via a service worker, so it arrives with the tab closed. Copy in the Herald's voice, with a hint of what happened: "Turn 9 is in. Smoke over the Ashen Belt." The last player to seal gets one gentle reminder: "Kith and Sam have sealed. The table waits." | The notification is the async game's slot pull. | M |
| **The morning paper** | In async WEGO, the Herald *is* the daily digest: the front page as an email or push with the headline image. "You missed 2 editions" shows the stack folded on the table. | Readable in 20 s from bed; ends with a question you want to answer. | M |
| **LIVE arrival alerts** | "Your fleet reaches Vel in 10 min", "Enemy fleet sighted 2 jumps from your capital". User-tunable. | Neptune's Pride's habit loop. | S (on top of push) |
| **AI rivals with memory** | AI houses keep names, mottos and a grudge ledger against *you* across solo games: "The Gilded remember Vel." They plant dispatches that reference past games. | Hades: the boss remembers. Solo play gets the friends' loop in miniature. | M |
| **The Gauntlet (daily seed)** | One fixed galaxy and AI line-up per day; your score (turn of victory, VP) on a friends-only board. | Slay the Spire's Daily Climb; a reason to open the game daily, and a comparison with friends without needing them online. | M |
| **Chronicles (solo scenarios)** | 6–8 hand-tuned scenarios ("Hold Vel for 10 turns", "Win without breaking a pact") teaching one mechanic each, with a medal per scenario. | Into the Breach islands; teaching through play. | L |

---

## 5. The dopamine map: every reward moment

**Sizes:** small (many per turn, ≤ 300 ms of attention), medium (a few per game, 0.5–1.5 s), big (a few per
game, 2–5 s, may take the screen). **Budget rule:** at most one *big* treatment per reveal; if two
qualify, the second becomes medium. Screen shake is capped at 6 px, never on small moments, and off with
reduced motion. **Haptics** use `navigator.vibrate` (Android Chrome; iOS Safari has none, so iOS gets the
sound alone; a future native wrapper can map these to iOS haptics). "Now" is what the code does today.

### Small
| Moment | Now | Make it land |
|---|---|---|
| Pick up a fleet | Drag ghost; `vibrate(10)` on drag | Token lifts 4 px, shadow widens; felt tick; reachable systems brighten (exists). |
| Order placed | Chip-lay sound | Chip drops into brass socket; pitch ladder I→V; light haptic (10 ms). |
| Fifth order placed | Same as any | The strip's brass rim glints once; a resolved chord; the primary button turns to SEAL with a pulse. |
| Posture set | Icon on token | Face-down token taps onto the base; a brass coin click; 15 ms haptic. |
| Research bought | `game_research` | The Empire node fills like poured metal; the branch line glows to the next node. |
| Citizen grows | Pip appears | Pip pops with a tiny squash; a soft "breath" chime, only in the end-of-turn aftermath, batched. |
| Build complete | Warp-in fx | A small hull drops onto the yard with a clank; at strategic zoom, a single glint. |
| Income | Numbers update | Resource pills roll their digits (0.4 s, 50 ms stagger per digit). |

### Medium
| Moment | Now | Make it land |
|---|---|---|
| Seal | `ui_seal` (plate + bell) | Wax and signet animation; heavy haptic (40 ms); your crest shows a seal to rivals. |
| Last friend seals | Crest tick | 600 ms music duck and swell; seals crack; push to the others if away. |
| Capture | "CAPTURED" text, `game_capture` | Ink flood from the star; banner plate flips to your colour; VP coin flies to crest; 2×20 ms haptic. |
| CALLED IT | Stamp fx + `st_called` | 120 ms hitstop, stamp with ink spatter and ±4° rotation, stays faint on the felt until next turn; triple haptic; the posture token flips gold. |
| CAUGHT OUT | Stamp + `st_caught` | Camera "double take" (100 ms push-in and back); stamp in red; one long low haptic. |
| Battle won | Roundel; aftermath marker | Roundel cracks to the winner's colour; the commander's portrait nods; XP pips fill. |
| Commander rank-up | Event + sound | Brass chevron pressed onto the token base; choose-an-Honour cards dealt. |
| Relic found | "RELIC FOUND" text | A gold glint rises from the ruin and arcs to the fleet; a choir note. |
| Calling chosen | Glyph on world | The glyph is engraved into the world's plate (line by line, 400 ms). |
| Fate spent | Coin + banner sound, flourish | Coin spins on the table and lands on its target; the Herald headline is pre-printed under it. |
| Herald headline about you | Page flip | Your house name in the headline is set in heavier type; a small "★ you" in your copy only. |
| VP gained | Crest number changes | Coins fly from sources to crest; digits roll; pitch rises per coin (Balatro ladder). |

### Big
| Moment | Now | Make it land |
|---|---|---|
| Decisive volley of a big battle | Viewer shake | Slow-mo 0.35× for 600 ms, sound pitched down, a camera push-in on the killing blow; snap back. |
| Crown captured | Capture fx | Board-wide title card ("THE CROWN OF ASH FALLS"); the crown icon lifts from the old owner's crest and lands on the new one; 3-pulse haptic. |
| Commander becomes Legend | Event | The epithet is embroidered onto the banner, letter by letter; the Herald prints a portrait. |
| Nemesis killed (revenge) | Vengeance bonus | Both portraits face off before the battle ("3rd meeting"); on the kill, the blood-debt seal on the rival's crest shatters. |
| Throne taken / Coronation | Throne star | The Throne star takes the colour; the Coronation countdown candle appears for everyone; Kneel / Defy cards. |
| Victory | Sunburst modal | The crowning ceremony (§2.3); long haptic (200 ms). |
| Defeat | Modal | Your banner lowers; the defeat theme; then the awards deal *you* a card. |
| The Saga | Dark page | The bound book and the share card (§2.3). |

---

## 6. Priorities and the build list

Impact: ★ to ★★★ (how much it changes what a player feels or retells). Cost: S (≤ 1 day), M (2–4 days),
L (1–2 weeks). Ordered by impact over cost, with dependencies.

| # | Item | Impact | Cost | Wave |
|---|---|---|---|---|
| 1 | **Replay director**: five movements, tempo map, you-first, battles ascending to "the main event" | ★★★ | M | 1 |
| 2 | **Reckoning ribbon + VP roll-up** (coins, rolling digits, pitch ladder) | ★★★ | S–M | 1 |
| 3 | **Seal ritual and the last-seal swell** (wax, signet, crack in the reveal) | ★★ | S | 1 |
| 4 | **Crowning ceremony + awards** replacing the victory modal | ★★★ | M | 1 |
| 5 | **Truthful slow-mo and push-in** on decisive volleys and killing blows; hitstop on stamps | ★★ | M | 1 |
| 6 | **Haptics map + reduced-motion audit** (one table in code, used everywhere) | ★★ | S | 1 |
| 7 | **Lobby as the war table** (no web forms: places, sealed letters for games, rival portraits for AI levels) | ★★★ | M–L | 1 |
| 8 | **Web Push turn-ready + Herald-voice copy** (+ LIVE arrivals) | ★★★ | M | 2 |
| 9 | **Reactive Herald**: callbacks and counts (third siege, Nth meeting), a named correspondent, obituaries, act editions | ★★★ | M | 2 |
| 10 | **League ledger**: head-to-head, nemesis marks, Hall of Crowns, Ugly Trophy | ★★★ | M | 2 |
| 11 | **Saga book and share card** | ★★ | M | 2 |
| 12 | **Commander portraits with scars** (layered painted parts; scars and age from history) | ★★ | L | 2 |
| 13 | **Coronation: Kneel or Defy** (the table-talk finale) | ★★ | M | 2 |
| 14 | **Legacy galaxy lite**: rematch on the same seed, renamed star, memorials, King's List | ★★ | M | 3 |
| 15 | **House heraldry** quarterings and motif unlocks | ★★ | M | 3 |
| 16 | **Titles and seasons** (5-game season, the champion's Decree) | ★ | S–M | 3 |
| 17 | **AI rivals with memory** | ★★ | M | 3 |
| 18 | **The Gauntlet daily seed** | ★ | M | 3 |
| 19 | Legacy galaxy full (wrecks, returning banners) | ★★ | L | 3 |
| 20 | Chronicles (solo scenarios) | ★ | L | later |

**Wave 1: make the core pull sing.** Everything a player sees every turn and at every game's end. Mostly
client presentation over existing events; no rule changes. Exit test: a new player, watching a replay with
sound, says "ooh" at least once per turn and can tell you what happened without opening the Chronicle.

**Wave 2: make it about *us*.** Reasons to come back (push), memory (Herald, League), and something to
send to the group chat (Saga card). Exit test: after a game, someone shares the card without being asked.

**Wave 3: make it a campaign.** The galaxy and the houses carry history; solo players get a daily reason.
Exit test: a group plays a 4th game in a month.

---

## Sources
- Greg Kasavin on Hades' narrative: [Game Developer / GDC Podcast](https://www.gamedeveloper.com/design/roguelikes-and-narrative-design-with-i-hades-i-creative-director-greg-kasavin), [GDC news](https://gdconf.com/news/roguelikes-and-narrative-design-hades-creative-director-greg-kasavin-gdc-podcast-ep-16), [ScreenHub](https://www.screenhub.com.au/news-article/features/digital/jini-maxwell/hades-greg-kasavin-breaks-down-supergiants-unique-approach-to-narrative-262459), [GameSpot](https://gamespot.com/articles/hades-changes-what-it-means-to-be-a-roguelike/1100-6483420/), [GameSpot on reactivity](https://gamespot.com/articles/hades-writer-explains-script-philosophy-after-player-discovers-incredible-detail/1100-6482650/), [Nintendo Wire: 21,000 lines](https://nintendowire.com/news/2020/12/30/hades-has-over-300000-words-of-voiced-dialogue-heres-a-handy-breakdown-of-who-speaks-most-and-least/)
- Into the Breach: [GDC Vault, Design Postmortem (Davis)](https://gdcvault.com/play/1025772/-Into-the-Breach-Design), [Road to the IGF](https://gamedeveloper.com/game-platforms/road-to-the-igf-subset-games-i-into-the-breach-i-), [80.lv GDC 2019 summary](https://80.lv/articles/gdc-2019-an-inside-look-at-into-the-breach)
- Inscryption: [Game Developer: how a game jam became Inscryption](https://www.gamedeveloper.com/design/how-game-jam-sacrifices-became-inscryption), [Wikipedia](https://en.wikipedia.org/wiki/Inscryption)
- Slay the Spire: [GDC 2019, Metrics Driven Design and Balance](https://gdconf.com/news/learn-slay-spires-successful-metrics-driven-approach-game-balancing-gdc-2019), [Wikipedia](https://en.wikipedia.org/wiki/Slay_the_Spire)
- Balatro: [Juice breakdown (blakecrosley.com)](https://blakecrosley.com/guides/design/balatro), [TouchArcade interview](https://toucharcade.com/2024/03/18/balatro-interview-mobile-port-localthunk-dlc-plans-updates-new-jokers-demo-feedback/)
- Neptune's Pride: [bit-tech review](https://www.bit-tech.net/reviews/gaming/pc/the-price-of-neptune-s-pride/1/), [PC Gamer](https://www.pcgamer.com/au/neptunes-pride-ii-triton-released-promises-more-strategic-scheming-in-space), [Wikipedia](https://en.wikipedia.org/wiki/Neptune%27s_Pride)
- Diplomacy: [Wikipedia](https://en.wikipedia.org/wiki/Diplomacy_(game)), [Dickinson: a game about how we play with people](https://blogs.dickinson.edu/wrpg211/?p=3164)
- Marvel Snap: [Game Developer: simultaneous turns](https://www.gamedeveloper.com/game-platforms/designers-don-t-sleep-on-marvel-snap-s-simultaneous-turns), [mobilegamer.biz: Brode's recipe](https://mobilegamer.biz/second-dinners-ben-brode-reveals-marvel-snaps-recipe-for-success-literally/)
- Polytopia: [Mobidictum: Lövstedt on minimalism](https://mobidictum.com/christian-lovstedt-midjiwan-polytopia-minimalism/), [Pocket Tactics interview](https://www.pockettactics.com/the-battle-of-polytopia/interview)
- Twilight Imperium: [FFG: A Galactic Council](https://www.fantasyflightgames.com/en/news/2017/9/13/a-galactic-council/), [Meeple Mountain review](https://www.meeplemountain.com/reviews/twilight-imperium-4th-edition-review-a-space-opera-with-real-drama)
- Root: [Think Like a Game Designer: Cole Wehrle](https://justingarydesign.substack.com/p/cole-wehrle-cute-creatures-brutal), [Wikipedia](https://en.wikipedia.org/wiki/Root_(board_game))
- Legacy games: [NPR on Risk Legacy](https://www.npr.org/2011/11/24/142657733/new-risk-game-remembers-where-you-left-off), [Wikipedia: Legacy game](https://en.wikipedia.org/wiki/Legacy_game), [GamingOnLinux: Wildermyth legacy](https://www.gamingonlinux.com/2020/06/papercraft-styled-tactical-rpg-wildermyth-adds-legacy-campaigns/)
- Juice: ["Juice it or lose it" (Game Developer)](https://gamedeveloper.com/design/video-indies-resist-the-urge-to-juice-it-or-lose-it-), [Juicy Break notes on both talks](https://crcdng.itch.io/juicy-break), [Kenney: must-see talks incl. The Art of Screenshake](https://kenney.nl/learn/must-see-videos-for-indie-developers), [Hicks et al., Good Game Feel, DiGRA 2018](https://dl.digra.org/index.php/dl/article/view/936), [Good feedback for bad players](https://adk.elsevierpure.com/en/publications/good-feedback-for-bad-players-a-preliminary-study-of-juicy-interf)
- MDA: [Hunicke, LeBlanc, Zubek (PDF)](https://users.cs.northwestern.edu/%7Ehunicke/MDA.pdf)
- Loops: [Daniel Cook, The Chemistry of Game Design](https://lostgarden.com/2007/07/19/the-chemistry-of-game-design/), [Multiplayer game atoms](https://lostgarden.com/2009/02/12/project-horseshoe-multiplayer-game-atoms/)

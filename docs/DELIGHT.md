# Delight: 88 details, each with a reason to exist

A catalogue in the spirit of Hades (the world notices you) and Inscryption (the rules live in objects). Each
entry is tied to a screen or moment, and each one is **true**: it reflects real game state, so a
player who notices it learns something. Loops and priorities: [LOOPS.md](LOOPS.md). Ship bar:
[QUALITY.md](QUALITY.md).

**Art direction, the test for every entry:** painted miniatures on a tabletop under a warm lamp; steel,
brass, felt, wax, leather, ink and paper; light falls from the lamp, top-left; shadows are soft and warm.
Never flat SaaS panels, never neon, never emoji, never a toast that could be from a banking app.

**Now:** what the code does today (**done**, part, or — not built). Wave 2 is the client pass that added portraits,
the Saga book, rival houses, Herald ink and the small touches; what it skipped because it needs the sim or the server is
listed at the end.

**Priority:** P1 = in the wave it belongs to; P2 = next; P3 = when someone has a free afternoon.
**Effort:** S ≤ 1 day, M 2–4 days, L 1–2 weeks. **Wave** refers to the build list in LOOPS.md §6.

---

## The table (lobby and setup)
| # | Detail | Moment | Pri | Effort | Now |
|---|---|---|---|---|---|
| 1 | **The lobby is the war table**, not a form: three places around a lamp-lit table, each with a chair, a signet and a candle. Picking a rival means placing a house's banner at a seat. | Lobby | P1 | L | part: the Articles of War on the lamp-lit table; no chairs or candles yet |
| 2 | **Your house's trophies sit at your place**: one small brass crown per past win, the League's Ugly Trophy (a dented tin goblet) at last place's seat. Hover reads the engraving ("Crowned, T24, the Hollow Throne"). | Lobby | P1 | M | part: Ugly Trophy and Hall of Crowns live in the League ledger, not at the seats |
| 3 | AI levels are **rival houses with a portrait and motto**, not "standard / expert": *the Gilded, who never hurry*; *the Crimson, who never forgive*. | Lobby | P1 | M | **done** (wave 2): a ruler, temper and motto per AI level, in the lobby, the crests and the Herald |
| 4 | Games waiting on you are **sealed letters** on the table; the wax is the colour of whoever is waiting. A letter whose deadline is near has its corner curling. | Lobby | P1 | M | **done** (wave 2): your games that wait on you lie on top as sealed letters in the waiting friend's wax; the corner curls inside 3 hours of the deadline |
| 5 | When a friend joins your game, **their candle lights** and their banner unfurls at their seat, with a cloth sound. | Lobby, multiplayer | P2 | S | — |
| 6 | The seed field is a **brass chart number** ("Chart No. 4471") with a dial; spinning it shuffles star charts with a paper riffle. | Setup | P3 | S | — |
| 7 | Dust motes drift in the lamp beam while the lobby is idle (frozen under reduced motion). | Lobby idle | P3 | S | **done**: the GL lamp beam carries the motes; frozen under reduced motion |
| 8 | After 14+ days away, **a dust sheet covers the table** and slides off on your first click. | Return | P3 | S | — |
| 9 | The rematch button reads **"Again, at the same table?"** and keeps seats, colours and the galaxy. | End of game | P1 | S | **done**: the League result card |

## Planning (the minute loop)
| # | Detail | Moment | Pri | Effort | Now |
|---|---|---|---|---|---|
| 10 | **Picking up a fleet lifts the miniature**: the token rises 4 px, its shadow widens and softens; dropping it gives a wooden *tok*. | Drag | P1 | S | **done** (wave 2): the piece rises 4 px, shadow widens; a wooden tok when set down |
| 11 | **Order slots are brass sockets**; each order drops in as a chip with a clack, pitched up I → V; the fifth resolves the chord and the rim glints. | Plan strip | P1 | S | **done** (wave 2): chip clack pitched I→V; the fifth resolves a triad and the rim glints |
| 12 | Undo lifts the chip out with the drop sound reversed. | Plan strip | P3 | S | — |
| 13 | Order arrows are **drawn in ink**: a slight hand wobble, wet-glossy for 300 ms, then matte. Seize arrows have a dipped-pen flourish at the head. | Plan | P2 | M | — |
| 14 | The seize-odds preview is a **brass dial needle** that swings past the value and settles (one overshoot, 250 ms). | Drag preview | P2 | S | part: the battle hold plate's needle hunts and settles; no dial on the drag preview |
| 15 | **Posture tokens are placed face-down** on the fleet's base. Only you see the face (hover tilts it toward you). Rivals who scanned you see it face-up. | Bet | P1 | M | — |
| 16 | **Fate coins spin on the table** before landing on their target; the remaining coins in the tray slide together to close the gap. | Fate | P2 | S | — |
| 17 | Hover a rival fleet whose commander killed one of yours: a **thin red thread** runs from it to your memorial. | Survey | P2 | M | — |
| 18 | An idle-fleet commander portrait on the primary button **glances at you** after 30 s of inactivity, once. | Plan | P3 | S | — |
| 19 | When you leave a slot empty and seal, the empty socket shows **a fleck of dust** in the reveal ("an order unspent"). Honest, not nagging. | Seal | P3 | S | — |
| 20 | Hovering the turn candle shows **"7 turns of oil left"**; in the last five turns it gutters. | HUD | P2 | S | **done** (wave 2): the turn candle burns down; gutters in the last five; tooltip counts the turns |

## The seal and the wait
| # | Detail | Moment | Pri | Effort | Now |
|---|---|---|---|---|---|
| 21 | **Sealing drips wax** onto the strip and the house signet presses it (400 ms), a bell rings; heavy haptic on phone. | Seal | P1 | S | **done** |
| 22 | A sealed rival's crest shows **their wax seal**; an unsealed one shows trickling sand. | Wait | P1 | S | **done**: wax on sealed crests; trickling sand on a friend still planning (wave 2) |
| 23 | When the **last friend seals**, the music ducks and swells (600 ms): the room inhales. | Wait → reveal | P1 | S | **done** |
| 24 | Unsealing (taking orders back) **cracks your own seal** with a small, guilty sound; rivals see your seal vanish. | Unseal | P2 | S | part (wave 2): unsealing cracks the wax with a small sound and the seal leaves your crest for everyone; no crack animation |
| 25 | While waiting, the Herald's next edition shows **"Going to press…"** with a typesetter's tray filling slowly as players seal. | Wait | P3 | M | — |

## The map: worlds, stars, scars
| # | Detail | Moment | Pri | Effort | Now |
|---|---|---|---|---|---|
| 26 | **A star you've held for 10 turns visibly brightens**, gaining a faint halo ring at each tenure tier (3, 6, 10). | Map, always | P1 | S | **done** (wave 2): brighter corona and a ring per tenure tier (3, 6, 10); hover explains |
| 27 | **Thrice-Taken** worlds show three small notches filed into their banner plate. | Map, detail zoom | P2 | S | — |
| 28 | **Battle sites keep a wreck speck** that drifts slowly; memorials stand as a tiny obelisk at detail zoom, hover lists the names. | After battles | P2 | M | — |
| 29 | **Razed worlds leave an ash ring on the felt** for the rest of the game. | After a raze | P2 | S | — |
| 30 | **Refugees travel as a tiny lantern** along the links to their new home in the aftermath. | Refugees | P2 | M | — |
| 31 | Your capital's pennant **flutters faster** while an enemy fleet is adjacent. | Threat | P2 | S | — |
| 32 | The **Throne star burns in its holder's colour**; hover shows the King's Seat list as a carved plaque. | Throne | P1 | S | **done** (wave 2): corona, glow and an enamel ring in the holder's colour; hover lists the King's Seat |
| 33 | Fog edges look like **a hand-inked chart's edge**, with last-seen notes in a small hand: "Crimson, 3 fleets, T11". | Fog | P2 | M | part: fogged garrisons show "~N (last seen)"; no inked edge |
| 34 | A **blockaded** world's light dims to half, matching its blockaded output. | Contested | P2 | S | **done** (wave 2): a blockaded star's light dims to its blockaded output share |
| 35 | After 22:00 local time, **the lamp is warmer and lower**; at dawn it cools. Cosmetic only. | Any | P3 | S | — |
| 36 | Systems with a body tag (*the Burned World*) show a **scorch on that body's speck** at detail zoom. | Detail zoom | P3 | S | — |

## Fleets and commanders
| # | Detail | Moment | Pri | Effort | Now |
|---|---|---|---|---|---|
| 37 | **Commander portraits gain a scar after a rout**, matched to the scar: Burned Hull a burn across the cheek, Haunted a white streak in the hair, Grudge a narrowed eye, Skeleton Crew a hollow face. | Rout | P1 | L | **done** (wave 2): painted portraits, scars by type, an eye lost at the second rout, laurel at Legend |
| 38 | Portraits **age**: a commander who served 15+ turns gets grey at the temples in the Saga. | Long service | P3 | M | **done** (wave 2): grey at the temples after 15 turns of service |
| 39 | **Rank chevrons are brass, pressed** onto the token base at promotion, with a stamping sound. | Rank-up | P2 | S | — |
| 40 | A **Limping fleet lists 8°** and trails thin smoke; its arrow home is dotted. | Rout | P1 | S | part: smoke, a drooping pennant, and (wave 2) the miniatures list 8°; no dotted arrow home yet |
| 41 | A vow is a **ribbon on the banner**; fulfilled, it turns gold and the epithet is embroidered letter by letter. | Vow | P2 | M | — |
| 42 | An **Oathbreaker's banner is torn diagonally**, for the rest of the game, on every screen. | Breach | P1 | S | **done**: torn banner on every screen |
| 43 | **Retiring a fleet folds its banner** into a triangle laid at the world; at detail zoom the folded flag is visible there forever. | Retire | P2 | M | — |
| 44 | **Commander barks** in the fleet card, keyed to history (Hades-style pool, one line, never repeated within a game): "Vel again. I know these stars." / "Third fight. Still here." | Select fleet | P2 | M | **done** (wave 2): eleven conditional lines from the fleet's record in the Story verb; each said once per fleet per game |
| 45 | **Nemesis face-off**: when two commanders meet again, both portraits slide in facing each other before the battle with "3rd meeting · Kith leads 2–0". | Battle start | P1 | M | part (wave 2): both commanders' portraits face off on the hold plate; the "3rd meeting" count needs a sim fix |
| 46 | A fleet named after a fallen friend-rival's fleet gets a raised eyebrow from the Herald: "an insult, surely". | Founding | P3 | S | — |
| 47 | Founding dialog: the **banner is sewn** stitch by stitch as you choose its sigil (800 ms). | Founding | P2 | S | — |

## The reveal (replay)
| # | Detail | Moment | Pri | Effort | Now |
|---|---|---|---|---|---|
| 48 | **Three wax seals crack in the order they were sealed**; the last to seal cracks last. | Reveal start | P1 | S | **done** |
| 49 | **The flop**: every arrow of every player draws at once for 600 ms before anything moves. A pact breach's arrow carries a torn-parchment mark. | Reveal | P1 | S | **done** |
| 50 | **Posture tokens flip face-up** as they meet reality; a called one flips gold. | Reveal | P1 | S | part: stamps land on the real event; the tokens do not flip |
| 51 | **CALLED IT lands with a 120 ms hitstop**, ink spatter and a ±4° tilt, and stays faintly stamped on the felt until next turn. | Bet resolves | P1 | S | **done** |
| 52 | **CAUGHT OUT gets a camera double take**: a 100 ms push-in and back. | Bet resolves | P2 | S | **done** (wave 2): a 100 ms lean-in and back on the real CAUGHT OUT; never under reduced motion |
| 53 | **Battles play in ascending stakes**; the biggest is introduced last: *"…and at Vel."* | Battles | P1 | M | **done** |
| 54 | Before each battle resolves, **a 400 ms hold**: both power numbers and the odds dial, the reel still spinning. | Battles | P1 | S | **done** |
| 55 | **Slow-mo on the decisive volley** (0.35× for 600 ms, sound pitched down), only when it truly decided the battle. | Battles | P1 | M | **done** |
| 56 | **The camera pushes in on the killing blow**; the last ship's name is then written onto the memorial roll in ink. | Battles | P1 | M | **done** |
| 57 | **BY A THREAD**: a ship that survives at ≤ 5% hull gets a stamp and a single heartbeat. | Battles | P2 | S | **done** (wave 2): on the board after the battle: the stamp and one heartbeat, only for a ship alive at ≤ 5% hull |
| 58 | **Captures flood with ink**: the new owner's colour spreads from the star like ink in water (700 ms). | Capture | P1 | M | **done** |
| 59 | **VP coins fly** from their source (a Crown, an edict, a battle) to the crest, and the digits roll; each coin a step higher in pitch. | Aftermath | P1 | M | **done** |
| 60 | **The near-miss line**: the Reckoning ribbon names the best near-miss in the Herald's voice ("Kith's ambush waited at the Ashen Belt. Sam passed one system north."). | Reckoning | P1 | M | **done** |
| 61 | Twist of Fate **visibly rewinds** the volley: particles run backwards for 300 ms. | Fate | P2 | S | — |

## The battle viewer
| # | Detail | Moment | Pri | Effort | Now |
|---|---|---|---|---|---|
| 62 | The viewer is **a felt circle on the table**, ships on painted plinths under the lamp, not a dark space panel. | Battle viewer | P2 | L | part: the viewer follows the art bible (felt, minis, type); not yet a circle on the table |
| 63 | **A destroyed ship's nameplate tips over** on its plinth. | Ship lost | P2 | S | — |
| 64 | **Last ship standing: the music drops out**, leaving only the engine hum. | Final round | P2 | S | — |
| 65 | Shield hits show a **brief hex shimmer in the defender's colour**. | Shield hit | P3 | S | — |

## The Herald
| # | Detail | Moment | Pri | Effort | Now |
|---|---|---|---|---|---|
| 66 | **The ink smudges when a lie is printed**, but only in *your* copy, and only if your own intel (a Scan, a fleet present) contradicts the dispatch. Intel makes lies visible; the liar's copy prints clean. | Herald | P1 | S | **done** (wave 2): checked in your client against your own view; the liar's copy prints clean |
| 67 | **A named war correspondent** with opinions and a memory ("Ottoline Vask, our woman at the front"), who calls back: "for the third time this war", "Kith, who swore otherwise in edition 6". | Herald | P1 | M | **done** |
| 68 | **Obituaries** for commanders: dates, deeds, epithet, the battle that took them. | Commander dies | P1 | S | **done**: with the fallen commander's portrait and mourning sash (wave 2) |
| 69 | **Act editions**: "THE BORDERS CLOSE", "FIRST BLOOD", "WAR EXTRA" (a Crown falls), "LAST ORDERS" (final turn), each with its own masthead ornament. | Act changes | P1 | S | **done** |
| 70 | **The cover price rises with the war**: One credit, then Two, then "Price: whatever you have left". | Herald | P3 | S | — |
| 71 | Away for 2+ editions: the missed papers **sit folded in a stack** on the table; tap to fan them. | Return | P2 | S | — |
| 72 | **Classifieds** generated from state: "WANTED: hulls. Apply Vel Yards." / "LOST: one Crown. Reward." | Herald | P3 | S | — |

## Score and diplomacy
| # | Detail | Moment | Pri | Effort | Now |
|---|---|---|---|---|---|
| 73 | **Pacts are one parchment with two pressed seals**; a breach tears it, and the torn half stays in Score for the rest of the game. | Pact | P1 | M | **done** (wave 2): one parchment, both seals; a broken pact leaves the torn half in Score |
| 74 | A **blood-debt is a red wax drop** on the rival's crest in your view; avenging it shatters the drop. | Blood-debt | P2 | S | **done** (wave 2): a red wax drop on the debtor's crest; shattered the turn it is avenged |
| 75 | A crest within 3 VP of victory **trembles slightly** for everyone, and a low drum joins the ambient. | Endgame | P1 | S | **done** (wave 2): the crest shivers within 3 VP (an ember rim under reduced motion); no drum yet |

## Victory, the Saga, and across games
| # | Detail | Moment | Pri | Effort | Now |
|---|---|---|---|---|---|
| 76 | **The crowning**: the lamp swings to the winner's seat; their banner drops; the Throne star takes their colour. On the losers' screens, their own banner lowers slowly. No modal. | Victory | P1 | M | **done** |
| 77 | **Awards dealt as cards**, at least one per player: The Unbroken, Oathbreaker, Called It, The Butcher, Kingmaker, Survivor. | End | P1 | S | **done** |
| 78 | **The Saga is a leather-bound book** in the winner's colour; pages turn; each banner gets a page with its (scarred) portrait. | Saga | P2 | L | **done** (wave 2): leather in the winner's enamel, the cover swings open, leaves turn, a chapter per banner |
| 79 | **The share card**: three seals, the decisive battle and the headline in one image, sized for chat apps. | Saga | P1 | M | **done** (wave 2): 1200×630 or 1080×1350, shared through the system sheet or saved |
| 80 | **The star the winner renamed** appears in the next game on that galaxy with a tiny brass plaque. | Legacy | P2 | M | — |
| 81 | **Raise the old banner**: the founding dialog offers a past Legend's banner ("the Unbroken, game 3") with one honour. | Legacy | P2 | M | — |
| 82 | **Your nemesis's sigil hangs on your side of the lobby table**, until you beat them. | League | P2 | S | **done** |
| 83 | First Herald of a new game with the same friends opens with **the feud**: "SAM AND KITH: THE FOURTH MEETING". | New game | P1 | S | **done** |

## Phone, sound and care
| # | Detail | Moment | Pri | Effort | Now |
|---|---|---|---|---|---|
| 84 | **One haptic vocabulary**: 10 ms per slot, 15 ms posture, 40 ms seal, 3×20 ms CALLED IT, one 80 ms low for CAUGHT OUT, 200 ms victory. Android; iOS falls back to sound. | Phone | P1 | S | **done** |
| 85 | **Each house has a three-note motif** in its colour's mode, heard at its seal, its captures and its victory. | Sound | P2 | M | — |
| 86 | **The ambient tightens** when an enemy fleet is adjacent to your capital (a low drum layer). | Threat | P2 | M | — |
| 87 | Pull-to-refresh on the Herald **unfolds the paper**. | Phone | P3 | S | — |
| 88 | The page title and favicon show **your seal state**: a wax dot when it's your move. | Browser tab | P2 | S | **done** (wave 2): a wax drop on the tab's crown and "Your move" in the title |

---

### Why these and not others
- Every P1 entry either sharpens **the question** (what will they do?) or dramatises **the answer** (the
  reveal), or makes the game **remember** (scars, ink, plaques). That is the whole design in three verbs.
- No entry adds a rule. Where one leans on a TODO mechanic (Coronation, League, Legacy), it is marked by
  wave in LOOPS.md.
- Each entry must survive [QUALITY.md](QUALITY.md): reduced motion, phone, sound off, and colour-blind.

### Skipped in wave 2: needs the sim or the server
- **#45 the meeting count** ("3rd meeting · Kith leads 2–0"): `Commander.rivals[x].met` counts a meeting twice when both
  fleets join an engagement in the same pulse, and keeps no per-pair win tally; the sim needs a true per-pair record.
- **#2 trophies at the seats, #5 a friend's candle lighting**: need the lobby to know each seat's League history and
  a join event from the server (the League API answers per League, the game list has no join stream).
- **#15 face-down posture tokens for rivals who scanned you**: the view must say which rival postures you are entitled
  to see face-up per fleet (today only "seen or not").
- **#30 refugee lanterns, #29 ash rings, #27 Thrice-Taken notches, #28 wreck specks**: need per-world event history in
  the view (refugee routes, razes, capture counts, wreck sites) that the client can't reconstruct after fog.
- **#80 renamed star, #81 the old banner**: the Legacy galaxy is server-side.
- **#85 house motifs, #86 the adjacent-threat drum, #75's drum**: need new CC0 audio stems (docs/ASSETS.md).

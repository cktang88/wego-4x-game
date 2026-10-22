# The World Card v3: a painted card, three verbs

> "There's so much crap on this screen. Everything about the planet is dumped here."

The card that opens when you click one of your systems has grown one section per mechanic. Today it has a
header, a stat line, a status line, a star line, body chips, a badge row, a ledger and calling row, a Stance
panel, a Fate row, a Build tray and a Develop tray. That is **9 stacked sections, 29 numbers and 21 controls
above the fold, plus 14 more tiles below it** (capital, turn 4, PC). The two decisions you make most often
(raise a ship, improve the world) are at the bottom, under a Stance panel that three expert AIs use about 5 times
in a whole game between them (18 measured games). Half of the numbers (`41/41`, `↑0`, `⚙ 1/3`, `🛡 1/2`, `cap +1`) answer no question you are
asking at that moment.

The redesign has two halves:
- **The game.** Fewer per-system decisions. See [SIMPLIFY.md](SIMPLIFY.md) for the inventory, the AI ablation
  measurements and the rule changes.
- **The card.** A tabletop card, described in this document:
  - a **face** that says what the world is and what it gives;
  - **three verbs** (Raise, Improve, Story) for what you can do with it;
  - one **Gambit** control that exists only when something threatens the world;
  - **prompts** that take over the face for one-time decisions (choose a Calling, accept terms, raze or keep).

Mockup: `/tmp/claude-0/world-card/mockup.html`. Screenshots are `mockup-compare.png`, `mockup-pc.png`,
`mockup-tablet.png`, `mockup-phone.png`, `mockup-states.png` and `mockup-fleet.png` in the same folder.

---

## 1. Research: how good strategy games show a place

| Source | What it does | The principle we take |
|---|---|---|
| **Stellaris 4.0** (Dev Diary #371) | Zones replace the old planet designations, and industrial districts are cut. Districts gain a *development level* instead of a dozen copies, and "upgrading districts is now clearly shown as a button on the Planet UI". | **One upgrade track per thing**, and the upgrade is a visible button, not a hunt through a grid. This is our Improve tab: one button per track. |
| **Stellaris** (planet view, 2.2–3.x) | A summary strip (designation, stability, output), then tabs for districts, buildings, pops and holdings. Automation toggles take the routine work away. | **Summary first, depth in tabs.** Automate the routine (our Core growth already is). |
| **Civilization VI** (city panel and production) | The city banner and panel give a compact summary; production opens as its own list. Long-standing community complaints are "too much information in one place" and the lack of a queue, which mods like CQUI address by compressing and reordering the panel. | **Separate "what it is" from "what to make".** Put lenses on the map, not numbers on the card. |
| **Endless Space 2** (system screen) | One screen holds a system's 1–5 planets together, with planet art as the main element. Player complaint: "many critical information is through some tooltips, plenty players never discover". | **The bodies are art, in one strip.** Reasons go **inline**, never only in a tooltip. |
| **Old World** (city and tooltips) | Floating yield text each turn, yield previews before you commit, and lockable tooltips that open a second level. | **Preview the effect before the commitment** (hover / long-press peek). Two tooltip levels at most. |
| **Crusader Kings III** (nested tooltips) | Blue game terms can be tooltipped, and a locked tooltip opens another above it. Paradox now builds its tooltip design "heavily around" this. | Story and rules terms are **tappable keywords**. The Story tab is the second level, not the face. |
| **Humankind** (city panel) | Criticised for "buttons that don't look like buttons", non-standard tooltip zones, and a stability number with no direction. | Buttons look like buttons (brass plates). Show **trends** (`+1 in 2t`), not bare values. |
| **The Battle of Polytopia** | A city levels up and you pick one of two rewards, e.g. City Wall vs +5 stars. Almost nothing else is per-city. | **One identity choice at a milestone** beats ten small sliders. This is our Calling prompt. |
| **Northgard** | Each territory shows a building-capacity counter (`1/5`), and building is the main per-territory decision. | Slots are worth showing only where building is *the* decision. We fold them into the track caps instead of showing `⚙ 1/3`. |
| **Twilight Imperium 4** planet cards | Two numbers (resources and influence), at most one trait and one tech specialty, on one card. | **The face is a couple of numbers and one identity mark.** Everything else is table talk. |
| **Into the Breach** (Subset; "readable from one screenshot") | The first, second and third reads of a screen are designed: grid, units, threats. | The face passes **three reads**: (1) art and frame tell the role, (2) name and Calling, (3) the yield line. |
| **Slay the Spire / Hearthstone / Marvel Snap** cards | The frame and colour say the class or rarity; one cost and one rules line; bold keywords have tooltips. | **Role is the frame**, not a badge. The Calling is the card's title line. |
| **Mobile 4X** (Polytopia, Civ VI iOS) | A bottom sheet, one big primary action in the thumb zone, 44pt targets, no hover. | **Phone: peek sheet with one suggested action**, verbs pinned in the thumb zone, long-press replaces hover. |
| **NN/g, progressive disclosure** | "Initially, show users only a few of the most important options." Use two levels at most, and make the path to secondary options obvious. "The very fact that something appears on the initial display tells users that it's important." | The face is level 1, a verb is level 2, and **there is no level 3** (no nested panels). What is on the face *is* what matters. |

Sources:
- [Stellaris Dev Diary #371](https://forum.paradoxplaza.com/forum/developer-diary/stellaris-dev-diary-371-4-0-changes-part-5.1729244/)
- [Stellaris developer diaries](https://stellaris.fandom.com/wiki/Developer_diaries)
- [CQUI for Civ VI](https://github.com/civfanatics/CQUI_Community-Edition)
- [Civ VI forum critique](https://boards.straightdope.com/t/civilization-vi/768933?page=9)
- [ES2 Steam discussion](https://steamcommunity.com/app/392110/discussions/0/3002177675819027534)
- [ES2 UI on HUDs & GUIs](https://www.hudsandguis.com/home/2017/7/6/endless-space-2)
- [Old World patch 79](https://forums.civfanatics.com/threads/old-world-patch-79.674377/latest)
- [Old World update 105](https://forums.civfanatics.com/threads/old-world-update-105.682191/post-16414297)
- [CK3 nested tooltips, Tinto Talks #77](https://admin-forum.paradoxplaza.com/forum/developer-diary/tinto-talks-77-20th-of-august-2025.1856053)
- [Humankind UI idea](https://community.amplitude-studios.com/amplitude-studios/humankind/ideas/2743-ui-improvement-for-city-unit-panels)
- [Humankind Steam discussion](https://steamcommunity.com/app/1124300/discussions/0/3043858334666569762)
- [Polytopia City Wall](https://blog.finxter.com/what-does-a-city-wall-do-in-the-battle-of-polytopia-2025-build/)
- [Northgard guide](https://www.gameskinny.com/tips/northgard-guide-tips-and-tricks-for-getting-started-with-your-first-settlement/)
- [TI4 planets](https://twilight-imperium.fandom.com/wiki/Planets)
- [Into the Breach legibility](https://gigazine.net/gsc_news/en/20180501-game-design-subway-legibility)
- [Into the Breach GDC postmortem](https://gdcvault.com/play/1025772/-Into-the-Breach-Design)
- [NN/g: progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- [City level-up UX complaints](https://forums.sorcererking.com/404554)

**What the research says against the brief's hypotheses:**
1. *A single primary action on the face* is right, but it has to be the **suggested** action, not the
   first legal one. Civ VI and Old World make you browse; mobile 4X games put one thing under the thumb.
   We get the suggestion from the AI planner we already have (`planTurn(st, you, 'expert')` filtered to this
   system), so it is a real recommendation, never automatic.
2. *Tabs vs accordions.* Use tabs, because accordions let every section open at once and that rebuilds the
   wall of stuff. Stellaris 4 and ES2 both use tabs. But **the verbs never move**: three tabs, in the same
   place on every world. A verb that does not apply (Raise without a yard) stays in its slot, dimmed, and
   opening it **teaches** how to get it.
3. *Bodies folded into one line* is right as text, but the strongest version is **art**: the game already
   paints its stars and bodies (`art/stars.ts`, `art/planets.ts`), so the card's header is a tiny diorama of
   the system, ES2-style. The one evocative line sits under the name.
4. *Gambit from turn 3* is not enough on its own. The gate should be **relevance**: show it only when a
   hostile fleet is adjacent or present, the system is contested, a bet is already set, or Surge would pay
   (see §3).

---

## 2. UX techniques applied

| Technique | Where we use it | Why (and where we deliberately don't) |
|---|---|---|
| **Progressive disclosure (staged)** | Face (level 1), then one verb (level 2). The Gambit is collapsed until tapped. | NN/g: two levels at most. There is no third level: the Story tab is a flat list, not nested panels. |
| **Contextual disclosure** (shown when relevant) | The Gambit appears only under threat. Ribbons appear only for non-default states (no "Held" line). Prompts appear only for the turn they matter (terms, raze, calling). The Purge prompt appears only when rival agents are near flipping. | A control that is always there reads as always important. Normal states are silent. |
| **Defaults and smart suggestions** | Phone peek: one big "Raise a Frigate" button. PC: a gold "SUGGESTED" edge on one hull or track. Suggestions come from `planTurn` for your seat. The Raise tab opens by default at a yard world with an idle order slot; otherwise Improve opens. | It never auto-queues anything; the suggestion only removes browsing. There is **no suggestion for Gambit bets**: a secret bet the AI suggests is no longer a read of your friend. |
| **Recognition over recall** | The diorama shows the actual bodies. Hull silhouettes match the map tokens. The role frame matches the map's role colours. Track icons match the map's detail-tier building pictograms. The fleet you build into shows its banner. | The player recognises "the belt world" without remembering what a belt does. |
| **Chunking** | The face has four chunks (art · title · yield · verbs). Improve is 4–5 rows with one button each, instead of a 13-tile grid. Raise shows 3 legal hulls plus one "3 more hulls" line. | About 4±1 chunks per view. Locked hulls collapse to a single line. |
| **Inverted pyramid** | Name → Calling (what it *is for*) → yield (what it *gives*) → verbs (what you can *do*) → Story (where it *came from*). | The answer to "why do I care about this world" sits in the first two lines. |
| **Verb-first actions** | The tabs are verbs (Raise, Improve, Story), buttons say the outcome ("Works II", "Walls II", "Accept", "Raze: +31⚙ +31¢"), and the foreign face leads with "Seize with Home Guard 68%". | The current "BUILD", "DEVELOP", "Stance" and "Fate" are nouns for systems, not actions. |
| **Inline "why not"** | A blocked track's button *is* the reason ("needs Supply Depots"). Locked hulls say what unlocks them ("Yard II ›", which is a link to the Yard row). A disabled bet card names its rule ("a Charge needs a Seize"). | ES2 is criticised for hiding reasons in tooltips; on the phone a tooltip is a long-press nobody finds. |
| **Empty and locked states that teach** | Raise at a world without a yard keeps its tab, dimmed; opening it shows "No yard here. Improve → Yard I (40⚙ 15¢)" as a button. Outpost before Depots reads "needs Supply Depots", which links to research. A Calling before 3 citizens reads "Calling at 3 citizens ●●○". | Each locked thing says the one step that unlocks it. |
| **Unlocking UI as the game progresses** | The Gambit control does not exist before turn 3 (keeping `POSTURE_FROM_TURN`) and then only under threat. The Outpost row is always in its slot (spatial memory) but dimmed, reading "needs Supply Depots", until it is researched or the world is a Waystation. The Calling line appears at 2 citizens as a teaser ("Calling at 3"). | New mechanics enter the card the first time they are relevant, as UX-V2 §7 already does with callouts. |
| **Hover, long-press and peek previews** | Hovering or long-pressing a hull shows stats, the fleet it joins and why it is suggested. A track row shows what the next level gives and when it pays back. A body in the diorama shows its line ("Cinder · moon · citizens +1 · surface"). A bet shows its bet / ✓ / ✗ lines. | Peeks are previews, never the only place information lives (see inline why-not). |
| **Consistent spatial memory** | The art strip is always top, the close button always top-right, the garrison always on the art's right shoulder, and the verbs always in the same three slots (fleet card: same slots, two verbs). On the phone the verb bar sits at the same height in the peek state. | Muscle memory: "Improve is the middle tab" holds on every world and every device. |
| **Direct manipulation** (kept) | The ship fan on the fleet card, drag-to-order on the map. | Not a card concern; it stays as it is. |

---

## 3. Information hierarchy: every element and where it lives

**Legend:**
- **F**: the face (always visible).
- **R / I / S**: the Raise, Improve and Story verbs.
- **G**: the Gambit (only when relevant).
- **P**: a prompt (the face, for one turn or one decision).
- **K**: a peek (hover or long-press).
- **M**: the map only.
- **✗**: removed.

| Today (code) | Element | Goes to | Why |
|---|---|---|---|
| `head` | Name | **F** | Identity. |
| `head` | "capital" tag | **F** as a ♛ glyph after the name | One glyph, not a word. |
| `head` | Close × | **F**, top-right of the art | Same place everywhere. |
| `regionStats` | Garrison `44/41` | **F**: the number on a shield on the art. `/max` only while damaged | Max matters only when deciding Walls or Levies, i.e. when it is below max. |
| `regionStats` | Yield ⚙ ¢ ✦ | **F**: one line, plus a red note when blockaded, tributary or cut off | The "what it gives" line. |
| `regionStats` | Dev pips, trait icon (old maps) | **F** as citizen pips; the trait goes to **S** | Old saves keep a sane face. |
| `regionStats` | Vein icon | **F**: a gem on its body in the art. **S**: the line | Recognition over recall. |
| `regionStats` | Cut-off `½` | **F** ribbon "Cut off · ½ yield" | A state, so a ribbon. |
| `regionStatus` | Battle / siege | **F** ribbon (war) | Same. |
| `regionStatus` | Project in progress | **I**: on its track row ("Yard II · 1t left"). A small progress tick on the Improve tab | It belongs where you made it. |
| `regionStatus` | Unclaimed relic | **F**: a gold glint on the Ruin in the art; ribbon "Relic here" | It is a fleet verb (Excavate). |
| `regionStatus` | Rival agents `2/9` | **P**: "Agents 6/9 · Purge ✦3", only from half the threshold | It is either urgent or noise. |
| `statusLine` | "Held" | **✗** | The default state is silent. |
| `statusLine` | Contested, holder, turns, refugees | **F** ribbon; "refugees in 2t" in the Gambit chip | One line, coloured. |
| `statusLine` | Occupied / Tribute and turns left | **F** ribbon plus a yield note ("½ output", "⅓ to Crimson") | Same. |
| `systemRows` | Star line "Yellow dwarf · Habitable cap +1" | **F**: one evocative line, "Yellow sun · garden world, a moon, a belt". **S**: the effect | The effect is already inside the citizens cap. |
| `systemRows` | Body chips with cap hints and output | **F**: the art diorama. **K**: per body. **S**: full lines and per-body output | Three chips, each with three numbers, become pictures. |
| `systemRows` | Contested output split | **S**, plus the ribbon's peek | Detail of a state the ribbon already names. |
| `roleBadge` | Core / Forge / Harbor / Waystation | **F**: the frame colour plus the engraved crest on the art | Role as art, not a badge. |
| `systemRows` foot | Citizens `3/5`, pips, `↑1` | **F** pips (the next one dashed while growing). **I**: "grows by itself · +1 in 2t" | Size is identity; growth is a plan detail. |
| `systemRows` foot | Civil slots `⚙ 1/3` | **✗** (folded into the track caps: Works can reach level = productive bodies) | A slot answers "can I build X here?", and the track's own button answers that. |
| `systemRows` foot | Military slots `🛡 1/2`, chokepoint | **✗** (folded into the Walls and Outpost caps; a chokepoint raises the cap and says so in the peek) | Same. |
| `systemRows` foot / tray header | Waystation `−30%` | **I**: struck-through prices on Walls and Outpost | The discount shows where it is spent. |
| `tributeRows` | Offer / accept terms | **P** on the face (accept); **R**-side panel of a besieged rival (offer) | A one-turn decision. |
| `worldEpi` | Epithet | **F**: italic under the name | The card's subtitle; it is the summary of its deeds. |
| `worldSoulRows` | Calling and tenure | **F**: the **title line**: icon, NAME, one effect line, three tenure segments | The world's identity; the card's "title". |
| `worldSoulRows` | Dormant calling | **F** title line, greyed: "Calling dormant 3 turns · Bastion" | Same place, different state. |
| `worldSoulRows` | Pending calling picks (and gated ones) | **P**: two big pick cards on the face | A once-per-world decision deserves the face. |
| `worldSoulRows` | Ledger marks ⚒ ⚔ ⛨ ✧ ✝ | **S** | Lore. |
| `worldSoulRows` | Deeds and Engrave | **S** (Engrave: see SIMPLIFY.md) | Lore; their summary is the epithet. |
| `worldSoulRows` | Owners history | **S** | Lore. |
| `worldSoulRows` | Raze | **P**: "Just taken · Raze: +31⚙ +31¢ / Keep it", the turn after capture only | A one-turn decision with a payout. |
| `worldSigRows` | Idle (levies) / Surging | **F** ribbon | State. |
| `worldSigRows` | Stance (4 buttons and bet text) | **G** | A situational secret bet. Gates is cut (see SIMPLIFY.md). |
| `worldSigRows` | Fate coins and Surge | **G**: the third bet card ("Surge · 1 Fate"), with the coins on the chip | One Gambit control for all bets on this world. |
| `ownPlanet` | Into chips and New banner `0/3` | **R**: one selector "Into [Home Guard 3/8 ▾]" with the alternatives in its menu | One control instead of four chips. |
| `ownPlanet` | Ship tiles (6) | **R**: the legal hulls as tiles; locked ones on one "3 more hulls · Yard II ›" line | Chunking; teaching locks. |
| `ownPlanet` | Develop tiles (13) | **I**: 4–5 track rows, one button each | See SIMPLIFY.md. |
| `ownPlanet` | Purge | **P** (see agents) | |
| `ownPlanet` | Scan | **✗** on your own world (it is in the context ring and on the fleet card) | You don't scan your own capital from its card. |

---

## 4. Layout and wireframes

The card is **368px wide** on PC and tablet (CSS `--card-w: 23rem`), positioned like today: `place()` floats it
on the side away from the selection. On the phone it is a **bottom sheet** with two snap points, *peek* (face,
suggested action and verbs; about 52% of the screen) and *full* (88%). It switches to the sheet when
`g.phone`, or on a tablet in portrait under 700px wide.

### 4.1 The face (all devices)
```
┌──────────────────────────────────────┐
│ ☀ ·  ◍ planet   ∘ moon     ⛨ 41   ✕ │  ← art: the star, the bodies on their orbits (painted
│ ·  ·  ·  ·  belt dots · · ·          │     sprites); garrison on the right shoulder
│ 🏛 CORE                [ribbon]     │  ← role crest (frame colour) · state ribbon if any
├──────────────────────────────────────┤
│ NINEFOLD ♛                 ●●●◌○    │  ← name (house colour) · citizen pips (◌ = growing)
│ the Unbroken · Yellow sun · garden   │  ← epithet · one evocative system line
│   world, a moon, a belt              │
│ ▌⚒ ARSENAL  ships built here −15% ▰▰▱│  ← the Calling = the card's title, tenure segments
│ ⚙ 18   ¢ 12   ✦ 3            a turn │  ← yield (or "−9⚙ −6¢ blockade" in red)
│ [⚒ RAISE] [▲ IMPROVE] [☰ STORY]    │  ← the three verbs, same slots everywhere
│  … the open verb …                   │
│ [⚑ GAMBIT  Crimson fleet next door ✪✪○]│ ← only when relevant
└──────────────────────────────────────┘
```

### 4.2 Raise
```
│ INTO [🛡 Home Guard 3/8 ▾]  or 1 other fleet · new banner (1 left)
│ ┌────────┐ ┌────────┐ ┌──SUGGESTED─┐
│ │ ➤ Scout│ │➤Corvette│ │ ➤ Frigate │      ← legal hulls only; the gold edge = planTurn's pick
│ │  ⚙10   │ │ ⚙12 ¢4  │ │ ⚙28 ¢10   │      ← red cost = can't afford this turn (still tappable: says why)
│ └────────┘ └────────┘ └────────────┘
│ 🔒 ▬ ▬ ▬  3 more hulls          Yard II ›  ← tap: expands the three, each with its reason inline
```
No yard: `No yard here.  [▲ Build Yard I · ⚙40 ¢15]` (one tap queues it, as on the Improve tab).

### 4.3 Improve (with the track model from SIMPLIFY.md)
```
│ ☺ Citizens ◆◆◆◇◇  grow by themselves · cap 5          +1 in 2t   (no button: automatic)
│ ⛏ Works    ◆◇◇   Mine on the Broken Belt · +3⚙   [Works II ⚙25]   ← gold edge if suggested
│ ⚒ Yard     ◆◇◇   Scouts, Corvettes, Frigates      [Yard II ⚙40 ¢15]
│ ♜ Walls    ◆◇◇   garrison 41 · rebuilds +5        [Walls II ⚙30 ¢15]
│ ⛽ Outpost ◇◇◇   supply · sight · gate            [needs Supply Depots]  ← inline why-not
│ ⓘ Each upgrade is one order. Long-press a row for what the next level gives.
```
At a world that does not grow by itself (not a Core) and is below its cap, the Works button may say
`[Works · +1 citizen ⚙35 ¢15]`: Develop is a Works member, not a tile of its own (SIMPLIFY.md §3).
While building: `[Yard II · 1t left ↶]`. Maxed: `◆◆◆  Fortress, Battery, Shield  ✓ max`. Waystation:
`[Walls II ~~⚙30~~ ⚙21]`.

### 4.4 Story
```
│ THE SYSTEM   ☀ Yellow dwarf ··············· habitable +1
│              ◍ Ninefold I · rich garden world  citizens 4 · ⚙18 ¢12 ✦3
│              ∘ Cinder · moon ················ citizens +1
│              ⁘ the Broken Belt · belt ········ Mine site
│ CALLING      ⚒ Arsenal · tier 2 (held 7t; tier 3 at 10t) · ships here −15%
│ DEEDS        [✎ Unbroken T9] [✝ Where the Long Watch Fell T12]
│ LEDGER       ⚒11 ⚔4 ⛨2 ✝1
│ CHRONICLE    T12 The Long Watch broke here, three hulls lost.
│              T9  Crimson's second siege fails at the walls.
│ HANDS        ■ Azure T1 › ■ Crimson T8 › ■ Azure T10
```

### 4.5 Gambit (tapped open)
```
│ [⚑ GAMBIT  secret · this turn                         ✪✪○]
│ ┌ Levies ┐ ┌ Scorch ┐ ┌ Surge ─┐                              (Gates: cut)
│ │  free  │ │  free  │ │ 1 Fate │                              (disabled: "⊘ a reason")
│ Bet  a siege lands here this turn
│ ✓    garrison ×1.5 the moment it lands
│ ✗    no output this turn and next
```
Surge keeps its two-tap arm ("Spend?") from `fateBtn`.

### 4.6 Devices
**PC (1440×900).** The side card is 368 wide and at most `100vh − 190px` tall. The open verb scrolls
inside the card; the face never scrolls away. Hover gives peeks; Esc closes.
```
┌─────────────────────────────────────────────────────────────┬─────────────┐
│ TURN 4 PLAN        ⚙60 ¢40 ✦10 ✪✪✪                ■■■ crests │             │
│                                                             │ [world card]│
│        (board: the selected star ringed in gold)            │  face       │
│                                         [peek: Frigate…] ◄──┤  RAISE open │
│                                                             │  GAMBIT     │
│              [ I ][ II ][ III ][ IV ][ V ]  [IDLE ×3]       │             │
└─────────────────────────────────────────────────────────────┴─────────────┘
```
**Tablet (1180×820 landscape, or 820 portrait).** In landscape, the same side card. Peeks appear on
long-press (350ms, as the context ring) and stay until you tap elsewhere. In portrait under 700px wide: the
phone sheet.

**Phone (393×852).** Bottom sheet; the map keeps the top ~48%.
```
┌──────────────── 393 ────────────────┐
│ T4  ⚙60 ¢40 ✦10           ■■■      │
│        (board, selection ringed)    │
│                                     │
├────────────── ▬ grabber ────────────┤  ← peek (≈52%)
│ [art: sun · world · moon    ⛨41  ✕] │
│ NINEFOLD ♛               ●●●◌○      │
│ the Unbroken · Yellow sun · …       │
│ ▌⚒ ARSENAL ships here −15%   ▰▰▱   │
│ ⚙18 ¢12 ✦3                 a turn   │
│ [ ➤ Raise a Frigate      ⚙28 ¢10 ] │  ← the suggested action, one tap queues it
│ [RAISE] [IMPROVE] [STORY]           │  ← tap a verb or swipe up: full (88%)
│ [⚑ GAMBIT Crimson next door ✪✪○]   │
└─────────────────────────────────────┘
```
Full state: the art shrinks to 72px and the Calling line folds into the Story tab, so the five Improve rows
fit with no scroll. Swiping down from full goes to peek, and from peek it closes (today's 70px threshold).
Every target is at least 44pt.

---

## 5. The five most common tasks: taps before and after

Phone, own capital, plan phase. "Tap" includes the tap on the world.

| Task | Before | After |
|---|---|---|
| **1. Queue a ship** | Tap the world, scroll past Stance and Fate to BUILD (1 swipe), check the Into chip, tap a hull: **2 taps + 1 swipe**, with 6 hulls and 4 chips to scan. | Suggested hull: tap the world, tap "Raise a Frigate": **2 taps, 0 swipes**. Another hull: the world, Raise, the hull: **3 taps**. |
| **2. Develop** (a Mine) | Tap the world, scroll past BUILD to DEVELOP (2 swipes), find Mine among 13 tiles: **2 taps + 2 swipes**. | Tap the world, Improve, "Works II": **3 taps, 0 swipes**, 5 rows to scan. Improve opens by default at a world without a yard: **2 taps**. |
| **3. Why can't I build a Cruiser?** | Tap the world, scroll, long-press the dim Cruiser tile, read "⊘ needs Cruiser Yards": **1 tap + 1 swipe + 1 long-press** (undiscoverable on the phone). | Tap the world, Raise (often already open): the line "3 more hulls · Yard II ›" is visible. Tap it to expand: "Cruiser · needs Cruiser Yards (research) · Yard II": **2–3 taps, 0 long-presses**. |
| **4. Set a stance bet** | Tap the world, tap Levies (always visible): **2 taps**. | Tap the world, tap Gambit, tap Levies: **3 taps** (+1). The price is deliberate: the control exists only when the bet can pay. |
| **5. Read its story** | Tap the world, then read the scattered ledger row, deeds and epithet; there is no chronicle or bodies detail on the card: **1 tap, incomplete**. | Tap the world, then Story: **2 taps**, complete (bodies, Calling tier, deeds, ledger, chronicle, hands). |

The PC is the same minus the swipes (the current card scrolls on PC too: 1179px of content in a 728px card).

---

## 6. Edge states (see `mockup-states.png`)

The same face is used everywhere. A **ribbon** on the art names the state, and the verbs change to what you
can do there.

| State | Face | Verbs / body |
|---|---|---|
| **Rival world** (visible) | Frame and name in the owner's colour. Ribbon "■ Crimson · held 3t". Garrison. Yield labelled "its yield". | **No tabs.** The primary is the seize: one red odds button per fleet that could seize ("Seize with Home Guard · 34 vs 18⛨ · 68%"), from `seizeOptions`. A gain line ("Taking it gives ⚙14 ¢4 · Occupied 3 turns at ½"). Intrigue row: Sway (Influence), Scan, Feint, Pact. If your warships contest it: the "Offer terms" prompt. |
| **Neutral** | As rival, in grey; "neutral · garrison 14". | Same. No Pact. |
| **Fogged** | The art desaturated; garrison "?"; ribbon "👁 last seen T9". Only public knowledge (star, bodies, role). | Scan and Feint only. |
| **Own, contested** | Ribbon (war): "⛓ Contested · Crimson holds space". Garrison shows `23/41`. Yield note in red: "−9⚙ −6¢ blockade". | Tabs as normal. The **Gambit is always shown** ("under siege · refugees in 2t"). Terms offered: a prompt with Accept / Refuse. |
| **Own, occupied** (just taken) | Ribbon (gold) "Occupied · ½ output · 2t". Calling line greyed: "Calling dormant 3 turns · Bastion". | On the first turn only: the **Raze / Keep** prompt with its payout. |
| **Own, paying tribute** | Ribbon (gold) "⚖ Tribute → Crimson · 3t". Yield note "⅓ to Crimson". | As normal. |
| **Own, cut off** | Ribbon "⛓ Cut off · ½ yield". | As normal. The Outpost row suggests a Depot or Gate if that would reconnect it. |
| **Calling to choose** | The Calling line becomes a prompt: "What will Mire become?", with two pick cards (nature vs history) and gated ones dimmed with their reason. | Tabs below as normal. |
| **Not planning** (watching, waiting) | Same face. | Verbs are read-only: buttons show prices, disabled with "⊘ watching". |

---

## 7. The fleet card: the same grammar (see `mockup-fleet.png`)

The fleet branch of `card.ts` (`ownFleet`) stacks:
- a header with a 4-stat line;
- a status line;
- an honour choice;
- soul chips;
- a vow row;
- a 5-chip posture row with bet text;
- a Fate row;
- the ship fan;
- an action row with a 3-way doctrine toggle;
- a vow picker;
- saga chips;
- a "⋯" record.

**Redesign:**
- **Face:**
  - The banner (sigil art) on the left of the art strip, with the name, rank chevrons and epithet.
  - The **vow as a quoted line** on the right: "“Guard Ninefold” · 4/6".
  - One stat line: ⚔ power, ❤ hull %, ➤ speed, and ships `6/8`.
  - **The route ribbon** ("⚔ Seize Vela · arrives this turn · 68%  [■ Halt]") or "Idle: drag to a region".
  - **The ship fan** stays on the face: it is direct manipulation (lift and drag to split), the fleet's real body.
- **Verbs:** two tabs in the same slots, **Orders** and **Story**.
  - **Orders:**
    - Fortify, Scan, Split *n*, Refit, Excavate (only at a relic), Retire (only when eligible), as 4-wide icon buttons with inline reasons.
    - Below them, the doctrine as a 3-way **"temper"** toggle (Attack / Hold / Evade). It is a standing setting, not a per-turn decision, so it leaves the face.
  - **Story:**
    - The commander, rank and record.
    - Boons, banes and scars as chips (today these crowd the face as unlabelled icons).
    - The vow picker ("Swear a vow").
    - The saga list.
    - Rename.
- **Gambit:**
  - Fleet postures (Guarded / Running / Charge / Ambush) and Fate (Last Stand / Twist / Hyperjump / Rally) share one control.
  - It is **plan-aware**: with a Seize planned, the chip itself says "Seizing Vela: Charge?". Today's `offerCharge` popup moves here.
  - With a move planned, it says "Moving 3: Run?". Idle on a lane, it says "Ambush here?".
  - Otherwise it shows from turn 3 as "Gambit · steady" (a fleet's bet is always possible, unlike a world's).
  - Fate bets are gold.
- **Prompts:**
  - A pending **Honour** takes the face (two big cards), as the Calling does on worlds.
  - So does **Limping** ("Limping home → Ninefold · 2t · Rally? 1 Fate").
- **Foe fleet:**
  - Face only: owner colour, power, ships by class, and the posture if revealed.
  - The primary is "Attack with … 62%" when one of your fleets can reach it.
- **Counts:** today, about 30 controls and 7 sections on a bannered fleet. After: the face has 3 numbers, the fan and the route, with 2 verbs and the Gambit.

---

## 8. Implementation plan (maps onto the code)

### 8.1 New state (card.ts, module level, like `moreOpen` and `intoChoice`)
- `worldTab: Map<RegionId, 'raise'|'improve'|'story'>`. The default is chosen by `defaultTab(g, r)`: Raise if
  there is a yard and an idle order slot, else Improve. Remember the last choice per world for the session.
- `gambitOpen: Set<string>` (keys `r<id>` / `f<id>`).
- `fleetTab: 'orders'|'story'` (replaces `moreOpen`).
- Phone sheet snap: `sheetSnap: 'peek'|'full'`.

### 8.2 card.ts
| Function | Change |
|---|---|
| `renderCard` | Unchanged dispatch. Adds `data-tab` to the element for CSS. |
| `place` | Unchanged (side away from the selection). The phone adds `data-snap` and the sheet height. |
| `head` | Replaced, for worlds, by `worldFace(g, r)`. Fleets get `fleetFace(g, f)`. |
| `regionStats` | Becomes `faceYield(g, r)`: returns the three numbers plus `note` (blockade / tribute / cut / occupied share). The share maths (`systemStatus(st, r).shares`, `regionYield`) is kept as is. The garrison moves to `sysArt`. |
| `regionStatus` | Becomes `ribbon(g, r)`: **one** ribbon by priority: battle/siege > contested > occupied > tribute > cut off > idle/surging > relic > last seen. Project progress moves to `improveTab`; rival agents move to `prompts`. |
| `ownPlanet` | Becomes `worldCard(g, r)`: `sysArt` + `worldTitle` + `callingLine` + `prompts` + `faceYield` + `primaryAction` (phone peek) + `verbBar` + the open tab + `gambit`. |
| (build tray in `ownPlanet`) | Becomes `raiseTab(g, r)`: `intoSelect(g, r)` (replaces `intoRow`; `intoOf` and `joinable` are kept) + legal hull tiles + `lockLine` (expandable). The `classBlock` / `needsShipyard` / `orderBlock` checks are kept; only the presentation changes. |
| (develop tray in `ownPlanet`) | Becomes `improveTab(g, r)`, driven by `tracksOf(g, r)` from a new `hud/tracks.ts`, which maps each track to its project keys and picks the next one (stage 1 is UI-only; see SIMPLIFY.md). Kept: the `orderWhy` / `techLock` / `systemsBlock` reasons (now the button text), `systemCostMult` (struck price), `pips`. |
| `foreignPlanet` | Becomes `foreignCard(g, r)`: `sysArt` (fogged variant) + title + `faceYield('its yield')` + `seizeOptions` buttons (unchanged helper) + gain line + intrigue row. `tributeRows` (offer) goes here. |
| `ownFleet` / `foeFleet` | Become `fleetFace` + `ordersTab` / `storyTab` + `fleetGambit`. The fan code and pointer handlers are unchanged. `STANCES` renders as the temper toggle in Orders. |
| `cardAction` | New actions: `tab` (data-t), `gambit` (toggle), `lockx` (expand the lock line), `track` (data-track: resolves to a concrete project with `nextInTrack`, then `addOrder({type:'develop', project})`), `sheet` (snap). Existing actions are unchanged. |
| `bindCard` | The phone swipe gets two snap points (peek ↔ full ↔ close) instead of only close. Long-press (350ms) on `[data-peek]` shows the peek popover (re-using `tip` styling). |
| new `primaryAction(g, r)` | Takes the suggested order for this region from a per-turn cached `planTurn(g.st, g.you, 'expert')` (computed in an idle callback after each new view; ~100–300ms off the main path). Falls back to the cheapest legal hull, then to the first open track. |

### 8.3 systems.ts
| Function | Change |
|---|---|
| `systemRows` | Split into:<ul><li>**`sysArt(g, r)`**: the diorama. The star sprite from `starSprite(kind, R)` and the body sprites from `planetSprite` / `bodyWorldType`, baked once per region to a data URL and cached by `r.id` + fog. Positions come from `ORBIT_K` / `ORBIT_FLAT` so they match the map's detail tier. Each body is a `<button data-peek="body:i">`. The garrison plate, role crest and ribbon slot are on it.</li><li>**`sysLine(g, r)`**: one line, "Yellow sun · garden world, a moon, a belt", from `STARS[r.star].name` and `chipText` labels (lower-cased, articles added).</li><li>**`storyBodies(g, r)`**: the old chip contents (`chipText`, `bodyCap`, `bodyTag`, vein, `bodyOutputs`) as Story rows.</li></ul> |
| `statusLine` | Feeds `ribbon()` (return `{cls, html, tip}` instead of HTML). |
| `roleBadge` | Becomes `roleOf(g, r) → 'core'|'forge'|'harbor'|'way'|null`, used as the card class `role-*` plus the crest. |
| `tributeRows` | Split into `termsPrompt(g, r)` (yours: accept; face prompt) and `termsOffer(g, r)` (the rival's world, in `foreignCard`). `tributeAction` is unchanged. |
| `bodyOutputs` | Unchanged; used by `storyBodies` and the ribbon peek. |
| `systemNotes` | Unchanged (notification chips). |

### 8.4 signature.ts
| Function | Change |
|---|---|
| `worldSigRows` | Split into:<ul><li>**`gambitRelevant(g, r)`**: true when all hold:<ul><li>`worldPosturesOn`;</li><li>`canPlan`;</li><li>turn ≥ `POSTURE_FROM_TURN`;</li><li>and one of: a pending wposture or surge; a hostile warship present or within 1 jump; contested; or (Fate available and the world has a project in progress or the top-3 yield).</li></ul></li><li>**`worldGambit(g, r)`**: the chip (status text from the relevance reason, coins) plus, when open, three bet cards (Levies, Scorch, Surge; Gates only if the rules keep it) and the `betLines` of the selected one.</li><li>The idle/surging status chips move to `ribbon()`.</li></ul> |
| `postureRow` + `fateRow` | Merged into `fleetGambit(g, f)`, with the plan-aware chip text (`seizesThisTurn`, `movesThisTurn`). `offerCharge` can retire, since the chip says it. |
| `fateBtn` | Becomes the bet-card renderer (keeps the two-tap arm). |
| `sigAction` | Unchanged; plus `gambit` toggling in `cardAction`. |

### 8.5 soul.ts
- `worldEpi` → used by `worldTitle`.
- `worldSoulRows` is split into:
  - `callingLine(g, r)`: title, dormant or "Calling at 3 citizens" teaser;
  - `callingPrompt(g, r)`: the pending picks;
  - `razePrompt(g, r)`;
  - `storyWorld(g, r)`: ledger, deeds and engrave, owners, plus the last 3 entries of the system ledger, `r.story.ledger` (`LedgerEntry.text`, already body-tagged), as the chronicle.
- `fleetSubline`, `fleetSoulRows`, `vowRow`, `sagaChips` and `vowPicker` move into `fleetFace` / `storyTab`.
- `honourChoice` becomes a face prompt.

### 8.6 New CSS (`client/src/card.css`, loaded after `theme.css`; remove the old `.card .sys*`, `.posture.world`, `.tray` rules once migrated)
- **Card and art:**
  - `.wc`, `.wc.role-core|forge|harbor|way` (frame tokens `--role`, `--role-hi`), `.wc.foe`, `.wc.fogged`.
  - `.wc-art` (diorama, 112px; 96px on phone peek; 72px full), `.wc-art .bd` (body buttons), `.garr`, `.crest`.
  - `.ribbon.war|gold|dim|cut`.
- **Face:**
  - `.wc-head`, `.wc-name`, `.wc-cit` (pips: `.on`, `.next`), `.wc-epi` (IM Fell English italic).
  - `.wc-calling` (`.pick`, `.none`, `.dorm`), `.wc-yield` (`.lost`).
  - `.wc-tabs` (`.on`, `.off`, `.dot`), `.wc-body`.
- **Raise:** `.into` (selector), `.hulls` / `.hull` (`.sug`, `.short`, `.locked`), `.lockline`.
- **Improve:** `.tracks` / `.trk` (`.dim`), `.lv` (diamond level pips), `.go` (`.sug`, `.why`, `.max`, `.queued`, `.disc`).
- **Story:** `.story`, `.bodies` / `.body`, `.deeds` / `.deed`, `.marks`, `.chron`, `.hands`.
- **Gambit:** `.gambit`, `.gchip` (`.set`), `.gopen`, `.bets` / `.bet` (`.on`, `.fate`, `.armed`), `.betline`.
- **Prompts and foreign card:** `.prompt` (`.ph`, `.picks` / `.pick` (`.gated`), `.acts`, `.yes`); `.odds`, `.bar`, `.gainline`, `.intrigue`.
- **Peek and phone:** `.peek` (hover/long-press popover); `.phone .wc.sheet` (`[data-snap=peek|full]`, grabber, `.primary`).
- **Fleet:** `.fl-art`, `.fl-stats`, `.route`, `.temper`, `.verbs`.
- The tokens are all from `theme.css`. New ones:
  - `--role*`;
  - `--gambit: #d7b4ff` (violet: the colour of secret bets; gold stays VP/Fate);
  - `--card-w: 23rem`.
- Fonts: Cinzel (titles, verbs), IM Fell English (epithet, deeds, chronicle), Rajdhani (numbers).

### 8.7 Tests
- `scripts/systems-e2e.mjs` checks today's chips (`.syschips .bchip` = 3, `/3\/5/`, `1\/3`). Rewrite it against:
  - `.wc-art .bd` = 3;
  - the `.wc-cit` pips;
  - the `.trk` rows;
  - "Shipyard needs 2 citizens" becomes the Yard track's `.go.why` text;
  - the waystation discount becomes `.go .disc`.
- `signature-e2e.mjs`: the posture rows become `.gambit`, and the e2e must open it first (`[data-a=gambit]`).
- A new `scripts/card-v3-e2e.mjs` checks:
  - three tabs on every own world;
  - the face fits at 393×852 without scrolling;
  - the Gambit is absent without a threat;
  - a peek appears on long-press.

### 8.8 Rollout
1. Ship `sysArt` + face + tabs with the **current** rules. Improve groups today's 13 projects into tracks, the
   button picks the next project in the track, and long-press lists the track's members.
2. Gambit relevance gate.
3. Rules simplifications behind flags (SIMPLIFY.md), with the card following them.

---

## 9. Open questions
- **Should the suggestion use the expert AI or a style-matched one?** The expert, but labelled
  "suggested", never "best".
- **The diorama cost.** Baking about 20 small sprites per view is cheap (the map already bakes them). Cache by
  `r.id` + fog state + body count.
- **Colour-blindness.** Role is frame colour **and** an engraved crest word, and ribbons carry an icon and a
  word, so nothing is colour-only.

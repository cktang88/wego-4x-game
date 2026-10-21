# Three Crowns UX v2: game UI, not a dashboard

Built from three research passes (map readability and semantic zoom; direct-manipulation orders and
stack management; HUD, menus and text). The references are Civ VI, Polytopia, Old World, Into the
Breach, Total War, Supreme Commander, Neptune's Pride, Backstabbr/webDiplomacy, Paradox, Marvel Snap
and Hearthstone.

**Principles:** the board is the interface. Use one object per idea. Colour means owner, shape means
kind, the big number means strength, and a bar means something is in progress. The target picks the
verb. Invalid targets never light up. Show icons and numbers, not sentences. Detail comes on demand
(zoom, hover/long-press, lenses, modals). Nothing should be cramped: when there is a lot to show, use
a full-screen modal over the board.

## 1. Screen layout (desktop and phone)
- **Board:** full width and full height. There are no permanent side panels.
- **Top-left:** turn number plus phase (PLAN / WAITING / WATCH; in LIVE, CYCLE n and a tick ring).
- **Top-centre:** three resource pills, `⚙ 134 +65` `¢ 37 +21` `✦ 55 +8`. Hovering or tapping one shows its breakdown.
- **Top-right:** three player crests, each showing colour, short name and VP, with a thin VP-to-victory arc. Your own crest is outlined. A tick appears once a player has sealed (WEGO). Tapping a crest opens Score.
- **Bottom-centre:** the plan strip and the primary button.
  - WEGO strip: five slots I–V. A filled slot shows an order icon and a 2-word target ("⚔ Vela"); an empty slot is a dashed outline.
  - LIVE strip: bank pips, a "+1 in 3m" countdown, and the queued order chips.
  - The primary button sits right of the strip. It is big, faction coloured, and cycles through what needs attention (see §4).
- **Bottom-left:** at most 3 notification chips (icon plus up to 5 words). Clicking one jumps to its subject. More than 3 collapse into "+N".
- **Bottom-right:** round icon buttons that open modals:
  - Empire (✺, key E) holds Research, Laws and Ships.
  - Score (♛, Q) holds score, diplomacy, intel and chat.
  - Chronicle (☰, C).
  - Lens toggle (◐, keys 1–4).
  - Menu (≡).
  - A dot on a button means something new or available.
- **Selection card:** a floating card that appears only while something is selected. On desktop it sits above the strip, never covering the selection. On phone it is a half-height bottom sheet over the strip; swipe down to dismiss.
- **Phone:**
  - The top row is 44px tall, with resources and VP compact. The strip and primary button stay in the bottom thumb zone.
  - The modal buttons fold into ≡ and the notification chips into one badge.
  - All touch targets are at least 44pt.

## 2. Map (renderer): semantic zoom, one object per idea
**Three tiers, chosen by zoom.** Tiers switch with a 150ms crossfade. Text never scales with zoom; the content swaps instead.

1. **Strategic** (whole map fits; the phone default):
   - Owner fill at about 45% with thick borders, and each empire's name large across its territory.
   - Crowns and the Throne shown as diamonds.
   - One number per region: its garrison, on a small shield plate.
   - One fleet token per owner per region.
   - Battle roundels.
   - Cut-off hatch (the only supply mark at this tier).
   - No region names, badges, buildings or veins.
2. **Operational** (the desktop default):
   - **Region banner:** a pill under the planet. On the left, a shield cap in the owner colour holds the garrison number in big bold digits. On the right, the name on a dark plate.
   - A fortification ring around the cap scales with fortress, batteries and shield, so a fortified world looks chunkier.
   - **Siege:** a bar under the banner drains as the garrison falls.
   - **Badges:** at most 2 small badges, picked in this priority order: Crown/Throne/relic, shipyard, warp gate, vein, academy.
   - Fleet tokens, planned-order arrows and battle roundels with balance ring and numbers.
   - Terrain is shown by texture alone: a void is black and starless, a nebula a soft haze, an asteroid field speckle. Never by text.
3. **Detail** (zoomed in, or a selected region):
   - The banner gains development pips and a fixed-order tray of building pictograms.
   - The trait and vein are spelled out.
   - Own fleets fan out into per-fleet tokens.
   - Supply paths.

**Fleet token:**
- One token per owner per region: a chevron in the owner colour, pointing along its order or up when idle.
- It carries a **power** number (`fleetPower`) and a small ship-count subscript.
- Several of your own fleets in one region merge into one stacked token. Clicking it fans them out.
- Each owner has a fixed anchor slot around the planet, so tokens never overlap the banner or each other.
- A fleet out of supply gets a dashed outline. An idle own fleet breathes softly.

**Battle roundel:**
- Replaces the opposing tokens in a region with a live engagement: a crossed-swords disc ringed by a two-colour balance arc, each side's power number beside it, and a small round counter.
- It pulses, more strongly at strategic zoom.
- On the turn the battle ends, an aftermath marker appears in the winner's colour and fades.

**Orders on the map:**
- Arrows in the owner colour, with a roman slot badge at the midpoint.
- Seize arrows end in a crossed-swords head.
- Hollow or dashed arrows mean "join".
- In LIVE, an arrow in transit shows its ETA at the head.

**Lenses** (key 1–4, or the ◐ button). A lens desaturates everything else:
1. Political (the default).
2. Supply: supply paths and cut-off regions.
3. Economy: veins, traits and development tint.
4. Military: fortification, shipyards, batteries and enemy power heat.

**Hold Space** (long-press on empty space on phone) to peek at detail-tier banners everywhere.

**Never on the map:** sentences, the old "⛨20 dev 1 ⛏ ✦" lines, per-building icons outside detail tier or a lens, or several icons per region.

## 3. Orders: the target picks the verb
**Drag a fleet token onto a region.**
- A ghost token rides the pointer: 48px above the finger on phone, with a 2× loupe.
- An animated arrow snaps to the region under the pointer.
- Reachable regions brighten when the drag starts; everything else dims.
- The verb is chosen by what is under the pointer, and a **preview card** at the arrow head says it live:

| Under the pointer | Verb | Card |
|---|---|---|
| own or empty region in range | Move | `➤ Move` |
| beyond speed but within overdrive | Overdrive | `➤ +1 · fatigued next turn` (amber arrow) |
| adjacent hostile or neutral region | Seize | `⚔ 68% · 34 vs 20⛨` (red arrow with swords head) |
| another own fleet here | Merge (free) | `+ 7/8 ships` |
| a region with your own pending seize | Join | `⚔ join · 81%` |
| invalid | none | grey dotted arrow and a reason (`too far 4>3`, `not adjacent`); releasing does nothing |

**Other ways to give the same orders:**
- **Tap-then-tap fallback:** tap a fleet to select it and light up its targets. On desktop, hovering a region shows the same blinking arrow and card. Tap a target to commit.
- **Desktop shortcut:** with a fleet selected, right-click a target to commit the default verb.

**Secondary actions** go in the selection card's icon buttons and in a context ring (right-click or long-press 350ms on a fleet or region). The ring shows only legal actions, at most 8, in fixed positions.
- Fleet ring: Fortify, Scan, Feint, Conceal, Split, Refit, Excavate (only at a relic), Influence (on a region).
- Region ring: Build (opens the build tray), Develop (opens the project tray), Influence, Scan, Feint, Pact (with the owner).
- Every ring item previews its effect on the map before release.

**Builds and projects:** the card of your own planet shows a tray of tiles (icon, cost, one word). Tapping a tile adds the order. Unaffordable or locked tiles are dim, and long-press explains why.

**Stacks without checkboxes:**
- Selecting your own fleet shows a **ship fan** in its card: one chip per ship, with class pictogram, hull bar and module dot.
- To split, drag a chip onto the map: onto its own region to form a new fleet there, or onto another region to split and move in one gesture.
- Tap chips to lift several, then drag them together.
- Dropping a fleet or a chip onto your own fleet merges them; a drop that would go over 8 ships is refused, and the card shows the overflow.

**Plan strip:**
- Hovering a chip highlights its arrow.
- Dragging a chip reorders it.
- Flicking a chip up or right-clicking it removes the order.
- Dragging an arrow head retargets it.
- With all slots full, the drag card says `no slot free: drop on a chip to replace` and dropping on a chip replaces that order.
- Undo with Ctrl+Z or the ↶ button on the strip, unlimited until seal.

**LIVE:** the same gestures. Spending an order uses a bank pip. Dragging the arrow head back refunds the order before the next tick.

## 4. Turn flow
The **primary button** shows the first item that applies:
1. `◉ Idle fleet ×2`: centres the map on the fleet and selects it. Tab also cycles idle fleets.
2. `✺ Research` when you can afford a technology this turn: opens Empire.
3. `SEAL ✓` in the faction colour, pulsing once all 5 slots are full or nothing is idle.
   - Shift+click or Enter seals at once from any state.
   - After sealing it shows `Waiting · ●●○` with each crest lit, plus an unseal ↶.
   - In LIVE there is no seal: the button shows the next useful thing, or `Next tick 2:14`.

**Watch:** the replay plays on the board with its effects. A battle shows a small result chip; tapping it opens the battle viewer, and nothing opens automatically. Space skips.

## 5. Modals (full screen over a dimmed board)
- **Open and close:** title at the top, × top-right, Esc or a backdrop click closes. On phone the modal slides up full screen and closes on swipe-down.
- **Empire (E):** tabs Research, Laws, Ships.
  - Research: four branch columns of five nodes. A node shows its icon and cost, coloured by state. Tapping a node expands it into a card with what it unlocks and one `Research` button. No prose on the tree.
  - Laws: four rows, each a two-sided toggle card (icon, name, one effect line); the switch cost appears on the toggle.
  - Ships: a card per class (silhouette, ⚔ ❤ ➤ cost) with a module picker; the refit hint is a single line.
- **Score (Q):** a column per player crest with VP total, a breakdown bar, victory track, pacts and diplomacy actions (offer a pact), and that player's public techs and laws. Intel signals go in a list. Chat opens as a drawer.
- **Chronicle (C):** a timeline with one row per turn, icons and a ▶ replay button. Battles open the viewer.
- **Help (?):** a short encyclopedia with key terms.

## 6. Text budget and icons
**Text budget:**
- HUD: icon plus number only.
- Labels: at most 2 words. Buttons: at most 3.
- Tooltips: at most 12 words; anything longer goes in Help.
- Cards: name at most 4 words; one effect line, preferably icon plus number.
- Notifications: at most 5 words.
- Sentences only in Help, Chronicle detail and chat.
- Type sizes: three sizes only. Numbers are bold and tabular.

**Closed icon set:**

| Icon | Meaning |
|---|---|
| ⚙ | industry |
| ¢ | credits |
| ✦ | influence |
| ♛ | VP |
| ⚔ | power / attack / seize |
| ⛨ | garrison / defense |
| ➤ | move / speed |
| ⚒ | build |
| ▲ | develop |
| ✺ | research |
| ⚑ | law |
| ◎ | intel / scan |
| ⏱ | time |
| ⚠ | alert |
| ⚛ | antimatter |
| ◆ | crystals |

Ship classes are silhouettes, not icons. Tech, law and module icons appear only inside the Empire modal.

**Colour:**
- Player colours mean ownership only.
- Gold means VP.
- Green means affordable or good, red means unaffordable or danger. These apply in UI chrome only; on the map, danger is shown by shape and motion.

## 7. Onboarding by doing
- The text tour goes. On turn 1, the first own fleet pulses and a ghost arrow points at a neutral neighbour with a 3-word callout, `Drag to seize`.
- After the first order, the primary button glows with `Seal`. Each later system gets a one-time 3-word callout on its element the first time it becomes relevant: Build, Research, an enemy in sight, Laws.
- The whole thing can be skipped and restarted from Help.

## 8. Module ownership (implementation)
- `client/src/render/map.ts` handles tiers, banners, tokens, roundels, lenses, drag arrows and hit-testing:
  - `tokenAt(sx, sy) → { region, owner, fleetIds } | null`
  - `tier` (read-only)
  - DrawInput gains `drag`, `lens`, `expanded`, `peek`; FleetDraw gains `region`.
- `client/src/game.ts` with new `client/src/hud/*.ts`, `client/src/shell.css`:
  - layout and HUD
  - plan strip and primary button
  - selection card, ship fan, context ring
  - gestures, preview card, notifications
  - LIVE behaviour, phone layout, onboarding
- `client/src/ui/modals.ts`, `client/src/modals.css`: Empire, Score, Chronicle and Help modals, built on the GameScreen API.

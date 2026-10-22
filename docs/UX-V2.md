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

## 2. Map (renderer): a readable board, an information budget per zoom
**The board carries the information, not badges.** Like a printed wargame board: owner colour fills the territory,
names are printed in space, pieces stand in exactly one place. Everything else is one hover, tap or click away
(the map tooltip, the card). **If a mark can't explain itself in one hover, it isn't on the resting map.**

**Three tiers, crossfaded.** The tier is a function of the on-screen size of a typical region, but nothing switches at
a threshold: every representation fades in or out over a zoom range, and star, piece and slot sizes grow continuously
with zoom (`mapmodel.ts`: `zoomW`, `starScale`, `tokR`).

1. **Strategic** (zoomed out): who owns what, where the armies are, where the fighting is, where the objectives are.
   - Bold owner fills and each empire's name in large spaced lettering across its territory.
   - Stars as small glowing points; unowned space is quiet.
   - Objectives: a Crown wears a gold ring, the Throne a larger double gold ring. No numbers.
   - Fleets as owner-coloured chevron pips at their star or on their lane; a stack of 2+ gets a tiny count.
   - Battles as one small crossed-swords mark.
   - Nothing else: no garrisons, numbers, system names, pips, icons or plates.
2. **Operational** (mid): what can I reach and attack, and where are my forces.
   - System names written in space: letter-spaced display caps with a soft dark halo, no plates. Sized by importance
     (Throne, Crowns, capitals, colonies); fogged names are faded. Lower-priority names hide first; a shown name keeps
     its spot while it still fits (hysteresis), names fade in and out, and the layout never depends on the pan.
   - Fleets as compact round counters in the owner colour with a ship arrow along the heading.
   - Garrison numbers only for the hovered or selected star and the current drag or seize target: one small figure
     under the name, never a badge.
   - Your idle fleets breathe softly while you plan; out of supply is an amber dashed rim on the piece.
3. **Detail** (close): the full tabletop.
   - Painted miniatures on bases (at most three models; the base stays the same size), the fleet pennant.
   - Orbiting bodies on their orbits (a belt as a rubble band), orbital structures, the planetary shield dome.
   - A small garrison figure under every shown name.

**Fleet placement:** a fleet is in exactly one place.
- In a system: parked beside its star with a short tether to it. Yours always on the left, the first rival opposite on
  the right, the second rival up and to the right, the Warden above. The name sits under the star, so pieces never
  cover it. Your opened stack fans out further along its side.
- On a hyperlane waypoint: on the dot itself, pointing along the lane.
- Strength (attack power) shows on the selected piece and in the tooltip; ship count only in the tooltip and card.

**Battles:** one marker, crossed swords in a ring, on the star (zoomed out) or just above it. The pieces stay at their
places. Round, odds and the garrison left are in its tooltip. Up close the pieces exchange fire.

**Orders and routes:** one dashed line in the owner colour with a head at the destination. A seize ends in a target
reticle round the star it attacks. No slot badges or ETA chips on the map (the strip lists the orders; the tooltip
gives the ETA).

**Hyperlanes:** a faint thread at rest; waypoint dots appear only where a lane is lit (hovered or selected star, your
selected fleet's reach this turn, routes) or faintly up close.

**Map tooltip** (hover on desktop, tap on touch), in plain words:
- Star: name, kind and owner, what an objective is worth, "Defenders N: the garrison you must beat to take it",
  buildings, development, trait and vein, siege, contested or cut-off state.
- Fleet: whose, "Strength N (k ships): its attack power in battle", where it is, where it is going and when, idle,
  out of supply, posture.
- Battle: round, each side's strength, odds, garrison left.
- Route / reticle: "Attack target: X", arrival in turns. Waypoint: one jump of travel.

**Lenses** (key 1–4, or the ◐ button). A lens desaturates everything else:
1. Political (the default).
2. Supply: supply paths and cut-off regions.
3. Economy: veins, traits and development tint.
4. Military: enemy power heat.

**Hold Space** (long-press on empty space on phone) to peek: every garrison figure and your supply network.

**Camera:** `MapRenderer.zoomAt(x, y, factor)` glides the zoom about a point (~240 ms, eased, retargeted by further
wheel notches, instant with reduced motion); pinch stays direct. The cached layer holds only what scales with the
world (background, fills, borders, lanes) and crossfades when it is rebuilt after a zoom; stars, names and pieces are
drawn every frame, so nothing pops while panning.

**Never on the map:** plates, badges, sentences, slot or ETA chips, number boxes on pieces, citizen pips, dot chains,
icons that need a legend.

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

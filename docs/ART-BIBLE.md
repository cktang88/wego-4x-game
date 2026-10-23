# Three Crowns: the Art Bible

One world, one lamp, one set of materials. Every pixel on screen, from a dreadnought to a tooltip, is a physical
object on the same war table, painted by the same hand and lit by the same light. If a thing could not sit on that
table, it does not ship.

Living references in the repo:

| what | where |
|---|---|
| tokens in code | `client/src/art/bible.ts` |
| tokens and the component kit in CSS | `client/src/art/kit.css` (the `.k-` classes) |
| **the board: the enamel and gold orrery (§13)** | `client/src/art/orrery.ts` (materials), `client/src/render/dial.ts` (the baked ground), `client/src/art/figurine.ts` (cast-metal minis), `client/src/art/orrery-bg.ts` (battle viewer and lobby) |
| the Graphics tier | `client/src/art/gfx.ts` |
| ~~GL sky, coronas and post~~ (retired from the game, §13.9; kept for the art lab only) | `client/src/art/gl/` (`stage.ts`, `shaders.ts`, `core.ts`) |
| the lab: every recipe running | `client/art-lab.html` (`npm run dev`, then `/art-lab.html`; `?kit=1`, `?gl=0`, `?terr=neon`) |
| audit screenshots, annotated | `/tmp/claude-0/art-audit/*.png` (raw captures in `raw/`) |
| lab screenshots | `/tmp/claude-0/art-lab/*.png` |

---

## 0. The audit: where the style breaks today (ranked)

Captured on every surface at 1440×900 and on an iPhone 15 Pro (393×852 @3x) with the `scripts/font-audit.mjs`
flows, plus the entity galleries (`scripts/art-gallery.mjs`). The ranking is by **pixels × visibility**: the
first item covers a third of the main screen all game long, the last is a rarely opened screen.

| # | break | where | shot |
|---|---|---|---|
| 1 | **Territories are flat neon polygons.** `#3fd0ff`, `#ff4f7b` and `#ffd23f` are filled flat at 12 to 50% alpha with a 2px neon stroke: a vector placeholder over a painted board. They also tint the HUD crests, chips and ships. | `render/map.ts` region fills, `art/gallery.ts` TEAM, the `--you`/`--pc` colours | `01-map-hud`, `10-fleet-card` |
| 2 | **The battle viewer is a second art direction.** It uses spaced-caps sans labels in cyan and pink, a hex-grid shield, a purple-pink photo-ish nebula and neon HP bars. That is a sci-fi HUD, not a war table. | `render/battle.ts` (`FONT` = Rajdhani/Orbitron), its backdrop | `04-battle` |
| 3 | **Rajdhani is the body and number face.** A squared techno sans fights Cinzel and Fell on every card, form and toast, and Orbitron is still loaded as `--display` in `style.css`. Rajdhani has **no tabular figures** (measured: "1111" is 52px and "8888" is 85px, with or without `tnum`), so counters jitter. | `style.css --font`, `--display`, `index.html` font link | `02-lobby`, `06-score` |
| 4 | **The Score modal is an analytics dashboard.** It has glass cards tinted per faction with a coloured glow border, flat segmented progress bars in neon pink and cyan, and coloured names in web hex. | `ui/modal-score.ts`, `modals.css` | `06-score` |
| 5 | **The lobby, the first impression, is a settings form.** Native `<select>` chevrons, dark SaaS inputs, sans labels, a dev tip in `code` font, "Join" pills. | `main.ts` lobby, `lobby.css` | `02-lobby` |
| 6 | **The hull icons in the build tray and the order glyphs are flat neon-cyan silhouettes**, in a game whose ships are painted miniatures. | `hud/card.ts` build tray, ship class icons | `03-world-card`, `10-fleet-card` |
| 7 | **The research tree is a rainbow of category cards.** It has red, blue, yellow and green tinted columns. The flat game-icons are filled in category colours, including a flat yellow arrow. The round icon "app buttons" are off-palette. | `ui/modal-empire.ts`, `empire.css` | `05-research` |
| 8 | **Pills everywhere, and no radius rule.** Resource pills, "Core", "New banner 1/3", "1 per turn", "Research ready", the "Chat" pill. The CSS has 25 distinct `border-radius` values (0.125 to 1.375rem) and 215 distinct hex colours. | all `*.css` | `01`, `03`, `05` |
| 9 | **Victory is a generic alert box over hard-edged flat yellow sunburst rays.** The climax of a 40-minute game is the cheapest-looking screen. | `game.ts` `showVictory`, `fx.css` | `07-victory` |
| 10 | **The "tabletop" never reads.** The mat is navy `#121a33` with a saturated purple, teal and magenta pixel nebula (`nebulaPrint`). The lamp pool is at alpha 0.075 and the weave at 0.22 overlay, so both are invisible. There is no warm key light, no vignette weight and no grain. | `art/mat.ts`, `map.ts` background pass | `01-map-hud` |
| 11 | **Map tokens and labels are UI badges, not minis.** Fleet chips are flat cyan circles with chevrons. Cinzel labels have no ink halo, so they collide with stars and fleet badges ("NINEFOLD" is overprinted). | `render/map.ts` tokens and labels | `01`, `03` |
| 12 | **The faction crests (top right) are app badges.** Flat bright shields with numbers and mint-green check bubbles. | `hud/hud.ts` `.crests`, `theme.css` `.pcrest` | `01-map-hud` |
| 13 | **Semantic colours are web-app neons.** `--good #7ee3a2` (mint), `--bad #ff6b5e` (coral), `--gold #ffd86b`. Income "+18" is in mint. VP lines in the victory box use raw faction neons. | `theme.css :root`, `modals.css` | `01`, `07` |
| 14 | **The Herald, the best screen, is still flat paper.** It is a CSS gradient with no fibre, deckle or ink spread. Faction neon underlines sit on parchment, and the "Compact / A source" segmented control is flat. | `herald.css` | `08-herald` |
| 15 | **Help, Chronicle and Laws read as templates.** A grid of identical rounded dark cards. Laws has 8 identical gold-gradient "Enact" bars with no hierarchy. Chronicle is a near-empty list. | `ui/modal-help.ts`, `modal-chronicle.ts`, `modal-empire.ts` | `09-laws`, `raw/desk-16-*` |

Also noted:

- **Mixed icon styles.** Filled game-icons sit next to hand-drawn line icons (eye, undo), with a `✓` glyph and a `⋯` ellipsis in one bar (`01`, #16 in the shot).
- **Default checkboxes** in the menu ("Reveal map") and in Tweaks.
- **The phone battle viewer** squeezes the spaced-caps labels.
- **The ship sculpts.** The Azure ships read as glossy jets (toy-like), while the Crimson ships are gothic 40k. Align the Azure sculpt to "lapis-and-silver cathedral ships" (see §8).
- **A pending colour emoji.** `👁` in `ui/modal-help.ts:21`. Most other symbols go through `icons.ts`, but toasts still accept raw `⚠`.

What already works and sets the bar:

- **Ships and stars.** The painted miniatures, the Crimson and Gilded sculpts, and the star sprites.
- **The Herald.** Blackletter masthead, columns and drop caps.
- **The Saga.** Its banners.
- **The brass-on-gunmetal chrome.** The modal frames, the Seal and turn plate, and the order strip slots.

The kit below keeps all of it and removes the rest.

---

## 1. Pillars

1. **A war table in a candlelit admiralty.** The board is a printed star-chart mat on felt, on a dark wood table. Everything else sits on, over or beside that table: brass instruments, enamel tokens, steel plates, vellum slips, a wax seal. The camera is a person leaning over the table.
2. **Diegetic objects, not UI.** Every component answers "what is this made of, and how would it be lit?" Buttons are engraved plates you press. Counters are tokens. Notes are slips. Sealing the turn is pressing a seal into wax. A tooltip is a slip of vellum, never a black rectangle.
3. **Four materials (and wax).** Blued **steel**, aged **brass**, fired **enamel** and **vellum**, plus sealing **wax** for the irreversible. Glass appears only as light (coronas, beams). There is no plastic, no frosted glass, no flat colour.
4. **One warm key lamp, upper left.** The light is `#ffd9a0`, from the upper left (`LIGHT` in `art/util.ts` = (−0.52, −0.85)), with its pool slightly above the board's centre (`LAMP.uv` = 0.42, 0.34). Every bevel, cast shadow, sprite highlight and specular glint agrees with it. The room beyond the table falls off to warm black, never pure `#000`.
5. **Painted, not rendered.** This is a 40k miniature painted by a good hobbyist: zenithal highlight, edge highlights on raised detail, a dark wash in the recesses, and slightly exaggerated contrast. It is stylised but never comic. There are no outlines on miniatures; the edges come from value.
6. **Colour is enamel, and it is rare.** The world is near-monochrome warm metal and dark felt. Faction colour appears only as enamel (crests, territory inlay, banners, hull lacquer). That is why it reads instantly.

**The Hades and Inscryption test.** Squint at a screenshot. It should read as three values: dark felt, warm metal, lamp-lit highlights. The faction colours should come through as jewels. If it reads as a dark-mode web app, it fails.

---

## 2. Palette

All tokens are in `client/src/art/bible.ts` (TS) and `client/src/art/kit.css` (`--k-*`). New code never writes a hex
that is not in these tables.

### 2.1 Materials

| token | hex | role |
|---|---|---|
| ink | `#07080c` | the room, the deepest shadow (never `#000`) |
| soot / umbra | `#0e0f13` / `#16171c` | panel backs, wells |
| steel 950 to 300 | `#121318` `#1b1d23` `#262932` `#353945` `#5b6170` `#9aa1ae` | blued gunmetal plates, bezels, iron rims |
| brass 900 to 100 | `#3a2810` `#6b4a1c` `#a87a35` `#c8964a` `#dcb46c` `#efd59a` `#fbedc8` | trim, engraving, rules, primary plates |
| vellum | `#e9dcbc`, shade `#c9b48a`, deep `#9c845a` | Herald, slips, Saga |
| felt | `#121a22`, lit `#1d2731` | the mat under the printed sky |
| wax | `#8e1f1f`, hi `#c2453a`, lo `#4a0d0e` | the seal, danger |

### 2.2 Text

| token | hex | use |
|---|---|---|
| ivory | `#ece3cf` | primary text on dark |
| parchment | `#c4b89c` | secondary and prose on dark |
| faded | `#958a74` | tertiary, disabled labels (≥ 4.5:1 on steel 900) |
| engraved | `#d9b26a` | Cinzel caps headings, section labels |
| ink | `#2a1d10` | text on vellum; faded ink `#6b5638` |

Pure white text is never used. Coloured body text is never used: faction colour may tint a **name**, never a sentence.

### 2.3 Faction enamels (replace the neons)

| house | base | hi (lit edge, text on dark) | lo (recess, hatching) | trim metal |
|---|---|---|---|---|
| Azure Compact | `#2f6ea6` lapis | `#7fb3dc` | `#163556` | silver |
| Crimson Dominion | `#a3303a` cinnabar-oxblood | `#dc6a66` | `#4f1117` | brass |
| Gilded Throneholders | `#c79a2c` saffron gold | `#f0cf72` | `#5e4410` | gold |
| the Warden | `#6e58a0` amethyst | `#ab95d8` | `#2b2046` | silver |
| unclaimed | `#6d6f78` pewter | `#a9abb3` | `#2c2d33` | iron |

They retire `#3fd0ff`, `#ff4f7b` and `#ffd23f`. `art/palette.ts` derives hull paint from the team colour, so passing the enamel base keeps every sculpt working: the lab passes `FACTION[h].base` to `drawShip`/`drawBase` unchanged.

**Gilded versus brass chrome.** Gilded is saffron enamel; the chrome is aged brass. Keep them apart by saturation, and on chrome by the bezel (a Gilded token is enamel *in* a brass bezel).

### 2.4 Semantic

| meaning | text and icon on dark | enamel (token boss, fill) |
|---|---|---|
| good (gain, held, success) | malachite `#86c08f` | `#3f7a4c` |
| bad (loss, threat, error) | cinnabar `#e2725d` | `#9a3427` |
| warning (soon, low) | amber `#e4ab4a` | `#8f6418` |
| info | pale lapis `#9bbbd9` | `#36597d` |
| Fate, VP, crowns | lamp gold `#f1d488` | brass 500 |

Deltas ("+18") use the semantic **text** colour at 80% size beside an ivory number. Never colour the number itself.

### 2.5 Sky pigments (GL nebula): RETIRED

> Retired with the GL nebula (§13.9). The board's ground is now the orrery dial; its enamels are listed in §13.2.

ink `#05060a`, deep `#0c1526`, umber `#6a3f26`, oxblood `#4e1a1e`, verdigris `#1c4848`, lamp-gold `#d9a256`.

- **No pure hues.** No violet, magenta or cyan.
- **Star coronas** are warm-biased: even blue stars are `#a9c6ff`, never `#4cf`.

---

## 3. Materials and how to render them

The recipes below hold across media: CSS (chrome), Canvas2D (map, minis) and GLSL (sky, light).

### Blued steel (plates, cards, bezels)

- **Face.** A 162° linear gradient `#383c47 → #252830 (38%) → #17191e`, lit at the top left.
- **Rim.** A 1px gradient border `#8a909c → #4a4f5a → #1d1f25 → #5b6170`, so the edge catches the lamp twice.
- **Bevel.** `inset 1px 1px 0 rgba(255,238,205,.16), inset -1px -1px 0 rgba(0,0,0,.55)`.
- **Grain.** `metal-brushed.webp` in a `::after` at z −1, `soft-light`, **opacity 0.16 to 0.22**. Above 0.3 it reads as wood or static; the first lab pass proved it.
- **Canvas.** `plates.ts gunmetal()`, then `overlayDetail(g,'metal-brushed',…,0.12)` clipped to the plate.

### Aged brass (primary plates, trim, rules, engraving)

- **Face.** A 172° gradient `#f7e2a6 → #dcb05e (22%) → #b8863a (55%) → #8a5f22`.
- **Bevel.** The bright top-left lip `inset 1px 1px 0 rgba(255,252,230,.7)`, a dark lower lip, and an inner bottom shade `inset 0 -.35em .6em -.3em rgba(80,45,5,.45)`.
- **Tarnish.** `brass-grime.webp` at about 0.3 soft-light.
- **Engraved text on brass.** Dark ink `#2a1a06` with a **light lower lip**: `text-shadow: 0 1px 0 rgba(255,245,210,.55)`. Light text on brass reads as a sticker.
- **Rules.** Two stacked 1px lines, black over `rgba(220,180,108,.45)`: an engraved groove (`.k-rule`). This replaces every 1px grey border.

### Enamel (faction colour, tokens, territory inlay, semantic bosses)

- **Shape.** A domed coin: `radial-gradient(circle at 35% 30%, hi→base 55%→base·55%black)`.
- **Bezel.** A brass bezel ring `0 0 0 1.5px brass500, 0 0 0 2.5px rgba(0,0,0,.6)`.
- **Recess.** An inner bottom shadow.
- **Territory on the map, as cloisonné inlay** (lab `territories()`):
  1. A translucent wash at 0.17.
  2. Engraved diagonal hatching in `hi`.
  3. A lit inner edge toward the lamp (mask minus mask shifted (3,4), `hi` at 0.35) and a dark inner edge away from it.
  4. An ink wire outside with a thin `hi` line inside, with a cast shadow.
  5. Two houses never overlap; they meet with a hairline gap.

### Vellum (Herald, slips, Saga, notes)

- **Paper.** A warm radial `#f3e8cc → #e4d3ab → #cdb588`, with `parchment.webp` multiplied at 0.28 (higher goes blotchy).
- **Edge.** A deckled edge via `clip-path`.
- **Ink.** `#2a1d10` text; red rubrics in wax `#8e1f1f`.
- **Type.** IM Fell for prose, UnifrakturMaguntia only for mastheads.

### Felt (the mat)

- **GL.** `felt.webp` at screen-constant scale (300px), anchored to the pan, soft-light 0.12.
- **2D fallback.** `pattern('felt')` at about 0.10 soft-light.
- The felt is felt only: it is never seen as a separate colour, just a tooth under the printed sky.

### Wax (the seal, danger, irreversible)

- **Shape.** A poured disc with an irregular `clip-path` edge.
- **Shading.** A specular blob at (34%, 30%), a pressed inner ring, a deep drop shadow, and the charge (crown or sigil) debossed (light lower lip, dark upper).

### Glass and light (never a surface, only light)

- **Coronas, beams, bloom.** Only in GL or as additive sprites.
- **Glass fill.** No `backdrop-filter`, no translucent white panels.

### Starlight (RETIRED on the board: stars are gems, §13.4)

The painted sprite (`stars.ts`) is the body. The GL corona (`CORONA_FS`) adds:

- a hot core bleed,
- a soft halo,
- slowly turning streamers,
- a pulse of ±8% over about 7 s,
- for bright stars only (amp > 0.55), a faint lens cross and a warm anamorphic streak.

It never adds hard 4-point toon sparkles.

---

## 4. Light and VFX

> **The sky, star, corona, bloom and shade rows below are retired on the board** (§13.9). The map, the battle viewer
> and the lobby draw no WebGL at all: the 2D renderer is the only renderer, and "light" on the board is the lamp's one
> reflection and falloff over the glaze plus the pieces' cast shadows. The table stays for the art lab.

| layer | what | how | cost (iPhone budget) |
|---|---|---|---|
| **Sky** | living nebula: 3-level domain-warped fbm, a broad mask that gathers gas toward the rim, rust and amber emission with a verdigris veil, dust lanes plus a Hubble dust detail map, slow drift (`t·0.01`) | `NEBULA_FS` into a **0.5 / 0.38 / 0.28 scale** target, redrawn when the camera moves or every 1, 2 or 4 frames by tier | 13 fetches/px at ¼ to ⅛ of the pixels |
| **Stars** | 3 parallax layers (pan factors 0.02, 0.04, 0.12; zoom ^0.12), twinkle, a faint cross on the brightest, dimmed behind dust | `UNDER_FS`, one integer-hash cell per layer, no neighbour loops | ~10 ALU/px |
| **Corona and bloom on stars** | see §3 Starlight | instanced quads, additive | only around stars |
| **Lamp** | a warm pool at `LAMP.uv`; a **volumetric beam** from above the top edge with drifting haze; **dust motes** (one per 110px cell) visible only inside the beam | `LIGHT_FS`, composited with `mix-blend-mode: screen` | 2 noise fetches/px at ≤ 1× |
| **Bloom** | the board's highlights bloom softly and warmly | 2D canvas → ¼-res copy (`UNPACK_PREMULTIPLY_ALPHA` **on**) → bright-pass at 0.55 → 2× separable 9-tap blur | high tier only |
| **Vignette and falloff** | the table's edge falls to warm black `(9,6,3)`; the light falls off with distance from the lamp | `SHADE_FS`, premultiplied | ½ res |
| **Film grain** | blue-noise grain (CC0, Peters), signed, ±7.5%, re-rolled **24 times a second** (film, not TV static) | `SHADE_FS` | 1 fetch |

Rules:

- **Bloom is for light sources only.** Stars, engine plumes, fire and the Fate gold. Chrome never blooms, and text never glows except the victory title.
- **Glow colour comes from the source.** A warm source glows warm. Cyan glows are only allowed on Azure engine plumes, and then desaturated.
- **Never stack glows.** One corona per star. No CSS `text-shadow` glow plus a canvas glow on the same thing.
- **Respect reduced motion and quality.**
  - `prefers-reduced-motion` freezes the drift, motes and twinkle.
  - The quality governor (`ArtStage.govern`) steps high → medium → low after 2 s over 21 ms a frame.
  - Without WebGL2, `ArtStage.create()` returns null and the 2D mat painters stay.

---

## 5. The UI component kit

Everything is live in `client/src/art/kit.css` and shown in the lab's kit tray (`/art-lab.html?kit=1`).

**Shared rules:**

- **Radii.** 3px machined (plates, buttons, tabs, tokens), 7px (cards, sheets, modals), 50% (coins, seals, knobs). Nothing else.
- **Bevel scheme.** Highlight on the top-left inner edge, shadow on the bottom-right inner edge, cast shadow down and right (`--k-bevel`, `--k-cast`, `--k-cast-lift`, `--k-press`).
- **Every face carries grain.** A static SVG `feTurbulence` at soft-light, plus the material texture in a z −1 pseudo-element at ≤ 0.3.
- **No 1px solid borders.** A border is a gradient rim (`padding-box` face over a `border-box` rim gradient) or an engraved rule.
- **Touch targets** are ≥ 44px (`min-height: 2.75rem`).

| component | object | recipe (kit.css) |
|---|---|---|
| **Primary button** | an engraved brass plate | `.k-btn.primary`: brass face, bright rim, `--k-bevel-brass`, grime 0.3, an inner engraved rule (`::after` inset 3px), dark engraved Cinzel caps with a light lip. Press: `translate(1px,2px)` with inner shadow, 120 ms heavy. |
| **Secondary button** | a blued-steel plate with a brass rim | `.k-btn`: steel face, `--k-brass-rim`, brass-200 Cinzel caps with a dark upper lip. Hover: face lightens (`--k-steel-face-hi`) and brightness 1.12. |
| **Danger** | a cinnabar enamel plate in a blackened-iron rim | `.k-btn.danger` |
| **Irreversible commit** | a wax seal | `.k-seal`: poured-edge disc and debossed charge. On commit, `.stamped` drops it from 1.25× with a long shadow, squashes once and settles (900 ms strike). |
| **Disabled** | unlit, tarnished plate | dark face, iron rim, faded `#6d6556` engraving still legible. **Never** `opacity: .4`. |
| **Ghost** | lettering engraved straight into the panel | `.k-btn.ghost`: no plate; hover gives a lamp-warm text glow. |
| **Tabs** | index tabs cut into a plate | `.k-tab`: Cinzel caps; selected is raised steel with a brass lip (a glowing hairline) joining it to the panel. |
| **Card** | a riveted steel plate | `.k-card` (`.riveted` adds 4 brass domes). A faction card is a plain plate with an enamel shield and a coloured **name**; never a tinted glass card (`[data-house]`). |
| **Pill / chip / badge** | an enamel token: a coin in a bezel on a small steel plate | `.k-token` + `.boss`; variants `.good` `.bad` `.warn` `.fate` and the houses. Numbers in `.k-num`. |
| **Tooltip** | a vellum slip, deckled, with a cast shadow | `.k-slip`: IM Fell prose, Cinzel name, ink figures. |
| **Sheet / modal / phone drawer** | a leather-backed tray in a brass rim | `.k-sheet` (leather 0.35 soft-light). The phone handle is a brass bar, not a grey pill. |
| **Slider** | a brass knob, knurled, in a sunken groove | `.k-slider` (`appearance: none`; webkit and moz thumbs) |
| **Toggle** | a lever switch with an amber indicator lamp | `.k-toggle` > `input` + `.lever`; lit lamp = on. Replaces every native checkbox. |
| **Segmented** | a row of engraved stops; the chosen one is a brass insert | `.k-seg` |
| **Select** | (to build) a steel plate with an engraved chevron; the list is a vellum slip | `appearance: none` + `.k-btn` look; never the native chevron |
| **Input** | a sunken well in steel | `inset 1px 1px 3px rgba(0,0,0,.9)`, the brass rule underneath, IM Fell italic placeholder |
| **Progress / VP track** | a brass rail with enamel pegs (one per crown), or a filling hourglass | not a flat bar: pegs or notches, so the count reads as objects |

---

## 6. Iconography

1. **One family.** The game-icons.net silhouettes (filled, 512 grid) via `ic()` / `drawIcon()`. Hand-drawn 24-grid icons must be **filled silhouettes** at the same visual weight, never outlines (the eye and undo icons today are line icons: redraw them filled).
2. **Icons are struck or enamelled, never flat-coloured.**
   - On steel: brass-200 with a dark upper lip (`emboss: true`, or `filter: drop-shadow(0 -1px 0 rgba(0,0,0,.7))`).
   - On brass: dark ink, debossed.
   - In a token: ivory on an enamel boss.
   - Category colour belongs to the **boss**, not the glyph. The research tree loses its four rainbow columns; each branch gets an enamel boss colour and nothing else.
3. **Sizes.** 1.15em in text and buttons, 1.35rem bosses, 2rem seals. Never mix two icon sizes on one row.
4. **No Unicode or emoji glyphs in the chrome.** Every `⚔ ⚠ ♛ ✦ ➤ 👁 ✓` string goes through `iconizeHtml` or `ic()`. Toasts are no exception.
5. **Ship classes are shown as miniatures,** a `drawShip` thumbnail baked to a data URL, never a flat silhouette. Structures use `structureSprite`.
6. **Sigils** (banners) use the existing sigil set: an engraved metal charge on an enamel heater shield. That is the model for all faction marks, including the HUD crests.

---

## 7. Typography

| role | face | weight / size | rules |
|---|---|---|---|
| Titles, plates, labels, buttons | **Cinzel** | 600 to 800; tracking 0.08em (titles) to 0.16em (small caps labels) | caps only below 1rem; engraved (dark lip on brass, light lip on steel) |
| Prose: descriptions, Herald, Saga, tooltips, flavour | **IM Fell English** (and italic) | 400; 1rem minimum, 1.35 to 1.45 line height | never below 15px on phone; never in caps |
| Mastheads only (The Herald, The Saga) | **UnifrakturMaguntia** | one per screen | never in UI controls |
| Numbers, dense data, small UI text | **Alegreya Sans** (replaces Rajdhani) | 500/700/800, `font-variant-numeric: lining-nums tabular-nums` (`.k-num`) | measured: with `tnum` the figures are all 76.0px wide at 40px. Rajdhani has no `tnum`, so its counters jitter. Alegreya Sans is humanist and calligraphic, so it sits with Fell and Cinzel. |
| Big display numbers (VP, turn, battle tallies) | **Cinzel** 700 | ≥ 1.5rem | proportional roman figures are fine at display size |

**Scale** (rem, root 16px; it scales with the existing UI factor): 0.8 label · 0.95 UI · 1.0 prose · 1.15 card title · 1.4 section · 2.0 modal title · 3.2 ceremony.

**Changes:**

- **Drop Orbitron and Rajdhani** from `index.html`, and the `Orbitron` fallbacks in `battle.ts`.
- **Add `Alegreya+Sans:wght@500;700;800`.**
- Canvas text uses the same faces: Cinzel labels with a 3.5px ink stroke halo (`strokeText` in `rgba(5,4,3,.85)`, then fill), and Alegreya Sans for numbers.

---

## 8. Entities: one hand across everything

| entity | rule |
|---|---|
| **Ships** | Painted minis on bases, zenithal light from the lamp, cast shadow down and right (already `drawShip`). Team colour = enamel base. **Azure sculpt:** lapis lacquer with silver trim and cathedral spines, not a jet. Engines glow warm except Azure (pale, desaturated cyan). |
| **Planets** | Painted globes; the terminator faces away from the lamp. Atmospheres are thin and warm-lit. No neon city lights. |
| **Stars** | Painted sprite plus GL corona. Fogged stars desaturate to pewter and lose the corona. |
| **Territory** | Cloisonné enamel inlay (§3), not a fill. The political lens raises the wash to about 0.35 and keeps the wire. |
| **Lanes** | An engraved groove: a 3px dark under-stroke and a 1.1px brass inlay offset 0.6px toward the lamp. |
| **Fleet tokens (zoomed out)** | A miniature on a base, or, when too small, an **enamel token** (coin with the house sigil, brass bezel). Never a flat circle-chevron. |
| **Labels** | Cinzel caps, ink halo; the owner's `hi` for owned names. Labels never overprint a token: tokens take priority and labels nudge down. |
| **Battle viewer** | The same table, closer: the felt and nebula of the board, minis on bases, Cinzel and Alegreya type. HP is enamel pips on a brass rail. Shields are a warm glass shimmer, not a hex grid. |
| **Herald and Saga** | Vellum objects laid on the table (a slight rotation of 0.3 to 0.6°, a cast shadow, the lamp falloff across the sheet). |

---

## 9. Motion

Everything is a **physical object with weight**. It is lifted, slid, struck or settled; it never fades in from nowhere.

| token | ms | easing | use |
|---|---|---|---|
| tick | 90 | linear | hover colour, indicator lamps |
| press | 120 | `cubic-bezier(.22,.9,.25,1)` heavy | button and plate press (1 to 2px down-right, inner shadow) |
| settle | 260 | heavy | cards sliding onto the table, tab change, toggles |
| sheet | 340 | heavy | drawers and modals (a slide plus a 1° tilt settle, no scale-from-0.8) |
| ceremony | 900 | `cubic-bezier(.3,1.35,.45,1)` strike | the seal stamp, crown won, the victory title (one overshoot only) |
| leave | ×0.7 | `cubic-bezier(.55,0,.75,.2)` | things that leave accelerate away |

Rules:

- **No bounce loops and no infinite pulsing on chrome.** Only light breathes (coronas ±8%, lamp haze).
- **Shadows animate with height.** A lifted card's shadow grows and softens (`--k-cast` → `--k-cast-lift`). A stamped seal's shadow shrinks to contact.
- **Stagger by physical order.** Cards deal left to right, 40 ms apart.
- **Camera moves** ease heavily, and the sky parallax makes them feel deep (nebula pan factor 0.55, zoom ^0.45).
- **`prefers-reduced-motion`:** keep state changes, drop travel; GL drift and motes freeze.

---

## 10. Do and don't

| do | don't |
|---|---|
| A primary action as an engraved brass plate with dark lettering | A gold gradient bar with white bold sans |
| A count as an enamel token in a bezel (`.k-token`) | A rounded pill with a 1px border and a coloured background |
| Faction identity as an enamel shield plus a coloured name | A card tinted in the faction colour with a glowing border |
| Territory as a cloisonné inlay with hatching | A flat translucent polygon with a neon stroke |
| A tooltip as a vellum slip with a deckled edge | A black rounded rectangle with sans text |
| A progress bar as brass notches or pegs | A flat two-colour bar |
| Glow only on light sources (stars, plumes, fire, Fate gold) | Glows on borders, cards, text or icons |
| One warm lamp, upper left; shadows down and right | A centred top light, shadows straight down, or none |
| Textures at 0.15 to 0.3 soft-light behind content | Textures at full strength in the background stack (scratches, static) |
| Cinzel caps for labels, Fell for sentences, Alegreya Sans for figures | Rajdhani, Orbitron or system-ui anywhere |
| A native control fully restyled (`appearance: none`) | The browser's default select chevron or checkbox |
| Victory as a ceremony: the seal, the crown struck, the Saga | An alert box over CSS sunburst rays |

---

## 11. Assets

- **New CC0 and PD assets** are in `client/public/tex/` and listed in `docs/ASSETS.md`:
  - `nebula-dust.webp`: Hubble Lagoon Nebula, NASA/ESA, CC BY 4.0, credited.
  - `bluenoise-128.png`: Christoph Peters, CC0.
  - `metal-brushed-normal.webp`: derived from ambientCG Metal009, CC0.
  - `brass-grime.webp`: ambientCG Metal048B, CC0.
- **Rejected:**
  - Photographic nebulae as a visible layer: they are photos, not paint, and would be a mashup. NASA imagery is allowed only as a greyscale detail map inside the shader.
  - Painted brush-stroke textures: no verifiably CC0 set was found.

---

## 12. Integration plan (waves)

Other agents are editing the client now. Each wave is a separate PR touching the files listed; the kit and stage are additive until wave 4 removes the old rules.

**Wave 1: the table and the light** (map only, behind a Tweaks flag `art.gl`, default on where WebGL2 exists)
1. `render/map.ts`:
   - Accept an optional `ArtStage`. When present, skip `matBackdrop`, `starfield`, `nebulaPrint` and the `lampOverlay` blits, and clear to transparent.
   - Each frame, after the 2D draw, call `stage.frame({ cam, t, stars, bloomSrc: canvas }, w, h)`. The `stars` array (screen x, y, radius, kind) comes from the star pass, with `CORONA[kind]` for colour.
   - Drop `drawTwinkle` when the stage is on.
2. `game.ts`: create the stage beside the map canvas (`ArtStage.create({ seed: st.seed })`, `stage.mount(canvas)`), and dispose it on leave. On context loss (`onChange({lost})`), call `map.invalidate()` so the 2D backdrop returns.
3. `ui/tweaks.ts`: add the quality setting (auto, high, medium, low, off).
4. `vite.config.ts`: add `build.rollupOptions.input = { main: 'client/index.html', lab: 'client/art-lab.html' }` if the lab should ship (dev works already).

**Wave 2: enamel, not neon** (colour only)
1. Retire the team neons:
   - `shared/config`, or wherever the seat colours live, takes `FACTION.*.base`.
   - `theme.css`/`shell.css` `--you`/`--pc` take the enamel `hi` for text and `base` for fills.
2. `render/map.ts`:
   - Region fills become the cloisonné inlay. Port lab `influenceMasks` + `territories()`, or (better) do the same on the Voronoi polygons: a wash, hatch pattern, inner bevel via a shifted clip, and ink and `hi` strokes clipped outside.
   - Labels get the ink halo.
   - Fleet chips become enamel tokens with the sigil.
3. `theme.css :root`: `--good/--bad/--gold` take the semantic tokens; deltas switch to malachite and cinnabar.

**Wave 3: type**
1. `index.html`: swap Rajdhani and Orbitron for Alegreya Sans.
2. `style.css`: `--font: 'Alegreya Sans'`, `--display: 'Cinzel'`, and numbers get `.k-num` (tabular).
3. `render/battle.ts` `FONT` and every canvas `font =`: Cinzel for labels, Alegreya Sans for numbers.

**Wave 4: the kit replaces the chrome** (component by component, removing the old rules as each lands)
1. `game.ts` imports `art/kit.css`.
2. **Buttons.** `theme.css button/.primary/.pbtn/.mbtn` → `.k-btn` variants. The Seal (`.pbtn` seal state) → `.k-seal`.
3. **Pills.** `.respill`, `.nchip`, `.chip`, `.sc`, `.tile` pills → `.k-token`.
4. **Tooltips.** `.uxtip` → `.k-slip`.
5. **Sheets and modals.** `.card` (phone sheet), `.pop` and `.mdl` → `.k-card` / `.k-sheet`, with `.k-tabs` for modal tabs.
6. **Native controls.** The menu "Reveal map" checkbox and the Tweaks checkboxes → `.k-toggle`. Audio sliders → `.k-slider`. Lobby `<select>` → the custom select.
7. **Crests.** `hud/hud.ts` crests become enamel heater shields from `bannerSvg`, with the VP in Cinzel; the mint check becomes a small brass "sealed" stamp.

**Wave 5: the set pieces**
1. **Score** (`ui/modal-score.ts`): three steel plates with enamel shields. VP becomes a brass rail with 40 notches and enamel pegs. Laws and tech become tokens.
2. **Research** (`ui/modal-empire.ts`, `empire.css`): one steel plate per branch with an enamel boss colour and struck brass icons; the tree lines become engraved grooves.
3. **Build tray** (`hud/card.ts`): miniature thumbnails from `drawShip`.
4. **Lobby** (`main.ts`, `lobby.css`): the table seen from above. A vellum "articles of war" sheet holds the setup; seats are enamel crests; Start is the wax seal.
5. **Victory** (`game.ts showVictory`, `fx.css`): kill the sunburst. The lamp swings to the winner's crest, the crown is struck (ceremony motion), and a vellum proclamation leads to the Saga.
6. **Battle viewer** (`render/battle.ts`): reuse `ArtStage` for its background, the miniature HP rails and the Cinzel labels; replace the hex shield with a warm shimmer.
7. **Herald** (`herald.css`): parchment texture at 0.28 multiply, a deckle, ink spread (a `text-shadow` of 0 0 0.4px), the faction rules as enamel dashes.

**Verification each wave:**

- `scripts/font-audit.mjs` (size floor and glyph leftovers).
- `scripts/art-lab-shots.mjs`.
- Re-capture `/tmp/claude-0/art-audit` and compare against §0.
- On a real iPhone: `/art-lab.html` shows fps and ms. Target: ≤ 12 ms at medium.

---

## 13. The board: the enamel and gold orrery

Chosen from the style exploration (`docs/STYLE-EXPLORE.md`, direction C) with three rules taken from A. It replaces
the near-photoreal board (GL nebula, coronas, bloom, painted star sprites). The problem it fixes is value structure:
the old sky spent the contrast the marks needed (Y up to 0.13 under the names, names at 1.1 to 2.3:1). The orrery's
ground lives in a narrow, dark value band, and every mark owns the values above it.

### 13.1 The three rules (from A)

1. **Printed is flat, pieces are lit.** Names, lanes, routes, reticles, walls and hatching are cut in the glaze: flat
   ink or gilt in a dark groove (`GROOVE`), no shadow. Only things that stand *on* the dial cast shadows down and to the
   right from the one lamp (upper left): fleet tokens, figurines and their plinths, the battle coin, the tribute coin.
2. **The hatch lives in the border band.** Each house's hatch (`HATCH` angle) is engraved under the enamel, faint over
   the whole field and strong in a band along the wall (8 / 14 / 20 px at strategic / operational / detail). Spacing is
   screen-constant (4.5 px), so the colour-blind cue reads at every tier.
3. **Fog removes colour, never contrast.** A fogged region's enamel is desaturated (`saturation` blend, value kept);
   a fogged star is a pewter stone in a silver collet; a fogged name is uncoloured ink (`FOG_INK`) at full value, never
   faded.

### 13.2 The ground (`render/dial.ts`)

| layer | how |
|---|---|
| the room | black velvet `#060608`, the felt's tooth at 0.16 soft-light |
| the dial | black enamel `#0a0b10` over the union of the regions, its shadow cast on the velvet |
| nebulae | cloisonné fields: indigo `#10142c`, oxblood `#280e16`, verdigris `#0d2428`, umber `#2c1e10`, from an fbm density field (raised inside the map's real nebulae) contoured at three levels by marching squares, smoothed, filled even-odd; fine bronze wire (`rgba(150,116,60,.5)`, 0.9 px) where two enamels meet. **Vector, so edges never step.** |
| guilloché | the crests of an engine-turned wave round the Throne, `rgba(112,94,64,.15)` |
| brilliants | 700 pin-head stars set in the glaze |
| territories | champlevé: the house `FIELD` enamel at 0.72 / 0.62 / 0.52 (strategic / operational / detail), a glaze gradient, the hatch (rule 2) |
| walls | antique **bronze** `#d4b47a`, 2.4 px, in a cut groove, the house's lifted enamel catching inside. Never the bright gold. |
| resting lanes | inlaid gold wire, `rgba(214,170,90,.42)` 1 px in a groove; dotted where an end is fogged |
| lenses | economy tint, supply darkening, pale-gold cut-off hatching |
| the bezel | polished gold round the dial with its degree scale engraved outside |

Measured value range of the ground: Y 0.002 to 0.08.

**Baking.** The ground is baked in world space in 512 px tiles, three zoom buckets an octave (a tile is never drawn
more than ~12% off its baked scale, so the hatch stays within a hair of 4.5 px). A frame blits the visible tiles of the
bucket it has. A new bucket (zoom) or new content (a capture, the fog moving, a lens) bakes a few tiles a frame inside
a time budget (5 ms moving, 12 ms still, which also bakes the ring just off screen) and crossfades in (170 ms) once its
view is complete. A small overview bake of the whole board stands under any tile not baked yet. A tile only touches the
geometry whose bounding box reaches it, so its cost does not grow with the map. No zoom stalls.

**The lamp** over the ground (under every mark): one broad soft reflection across the glaze (High only) and the room's
falloff toward the edges, baked per viewport size.

### 13.3 Gold is rationed

Bright polished gold (`gold()` in `art/orrery.ts`, darkest stop Y 0.5) is for **objectives, lit lanes and pieces**
only: crown and Throne settings, collets, the lit lane wire, counters, plinth rims, pins, the battle coin, the reticle.
Walls are bronze; resting lanes are a dim gold wire. House colour on the dark is the enamel lifted (`HI`, for fields
of colour) or brought toward ivory (`INK`, for lettering and fine lines: every house holds 4.5:1).

### 13.4 Stars are gems (the stone tells the kind)

| kind | stone |
|---|---|
| yellow | citrine |
| red | garnet, larger |
| blue | sapphire, small |
| white | moonstone |
| binary | citrine and sapphire on one gold bar |
| pulsar | star sapphire, its asterism turning slowly, gold beam pins |
| black hole | onyx inside a gold orbit ring that crosses in front, a gold bead riding it |
| the Throne | a repoussé gold sun boss with the crown struck in it; held, its centre is fired in the holder's enamel |
| fogged | pewter in a silver collet |

Each is a cabochon in a gold collet with a cut groove round it, lit from the lamp (a specular dab never under a pixel).
**No bloom, lens crosses, coronas or twinkles.** Crowns wear a gold ring with pearl milgrain and a gold crown; the
Throne a grand double bezel (the inner ring in the holder's enamel) with the lamp's glint walking slowly round it.
Tenure: one thin enamel ring in the holder's colour per tier, round the collet. Blockade: the stone clouds over.
At detail zoom the system is an orrery: engraved gold tracks, arms from the hub, bodies as small cabochons (gas,
ice, lava, ocean, garden, rock), a belt as gold granules, a station as a gold lozenge.

### 13.5 Pieces

- **Strategic pip:** a house-enamel chevron in a gold keyline, in an opaque groove.
- **Operational counter:** a struck gold token, the domed house enamel inside, the heading as an ivory chevron; shadow.
- **Detail figurine:** the game's own sculpts (`ships.ts`) gradient-mapped to the house metal (Azure silver, Crimson
  red-gold, Gilded gold, the Warden violet-silver), the strongly painted lacquer kept as enamel; on gold pins over a
  black-enamel plinth with a gold rim and a band of house enamel. Silhouettes unchanged. A limping fleet lists on its
  pins; a picked-up piece lifts 4 px and its shadow widens. Metal bakes are spread over frames (a few a frame).
- **Status:** idle = a slowly turning ring of pearls; out of supply = amber dashes; exposed = cinnabar; lurking = pale
  dashes; each in a groove. Stack count = a black-enamel stud with a gold rim. Strength (selected) = gold sword and
  ivory figure. Posture and dug-in marks are black studs in gold.
- **Battle:** a gold coin with cinnabar enamel and gold crossed swords, over the star's setting. Up close the pieces
  exchange flat enamel bolts with ivory heads; impacts are gold beads.

### 13.6 Marks

Contested: a ring of twelve segments, gold and the space-holder's ink. Occupied: a small gold staff with the
occupier's flag, lower right. Tribute: a gold coin struck with the scales, rimmed in the receiver's enamel, lower
left. Routes and planned orders: the house's ink dashes in a groove, a gilt-keyed head; rivals' routes have shorter
dashes (never fainter). Seize: a gold reticle with the attacker's ink inside. Lit lanes: bright gold wire in a groove.
Selection: a pale-gold wall inside the region. Reach while dragging: the region's wall gilt in the verb's colour.

### 13.7 Readability (measured)

`scripts/orrery-contrast.mjs` measures the live board (`MapRenderer.measureContrast()`, the method of
STYLE-EXPLORE §2) at every tier, on a battle and the most crowded star, with and without a selection, on 1440, 2560,
iPad and phone, on a mid-game and a turn-1 (fogged) board. Target: no indicator under 4.5:1 (resting lanes are quiet
by design and reported apart). Keep it as the regression test.

A line is measured on its own ground: a lane or route probe sits on the calmest point of its leg (at least 12 px from a
wall or the bezel's rim when there is one), a lane under a printed route or under a piece's strength badge is not
measured there, and a route leaves its star and breaks round every system it passes through (a route printed over a
small stone hid it). Selected and lit marks get an ink keyline, never glow: the reach wall is solid gilt in a 5 px
groove (only its tint breathes), a pip's keyline is the bright end of the gold over an ivory-to-ink face.

### 13.8 The battle viewer and the lobby

The same dial, closer (`art/orrery-bg.ts`): velvet, the black enamel with cloisonné and guilloché, the gold bezel with
pearls and its degree scale, the sides' enamels inlaid inside the bezel in the viewer; baked once per size. The lobby
needs no frames at all.

The defended world is set like the board's bodies: a cabochon of its kind in a gold collet with the holder's enamel
inlaid round it (no painted planet, no halo). Fire is flat house ink in a groove with an ivory head (Azure lances
included); only fire itself (muzzle flashes, explosions, a burning world) and the Fate gold still glow. The Saga's room
is the board's velvet, and the crowning's title stands on a dark veil so the board's names never cross it.

### 13.9 Graphics setting, and what retired

`art/gfx.ts`: **Auto** (High, stepping down to Low after ~2 s of frames over 22 ms), **High** (figurines at full device
resolution, soft shadows, the lamp's reflection, the ground baked at up to 3x), **Low** (figurines at up to 1.5x, plain
shadows, no reflection, the ground baked at up to 1.5x). Old values read as High (`medium`) or Low (`off`, `?gl=0`).

**Retired on the board:** the WebGL table (`art/gl/table.ts` deleted; `stage.ts`, `shaders.ts`, `core.ts` stay for
the art lab only), the domain-warped nebula, the Hubble dust map, star coronas, bloom, lens crosses and anamorphic
streaks, the GL lamp beam and motes, film grain on the board, the painted star sprites and twinkles on the map
(`stars.ts` still serves the art lab and `starKindOf`), the printed 2D nebula and starfield (`mat.ts`), the acrylic
bases on the map (`minis.ts` drawBase stays for the battle viewer). §2.5, §3 Starlight and the sky rows of §4 are
history.


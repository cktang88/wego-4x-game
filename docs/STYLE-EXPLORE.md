# Three Crowns: one art style for the map (style exploration)

Status: **direction C (with A's three rules) is adopted and integrated into the live game**; see docs/ART-BIBLE.md §13.
What follows is the exploration as it was run (the style lab files are unchanged).

**What's here**
- `compare-strategic.png`, `compare-operational.png`, `compare-detail.png`: the **current look** next to directions
  **A**, **B** and **C**. Each sheet shows 1440×900 on top and an iPhone 15 Pro below.
- `<A|B|C>/desk-<tier>.png` and `<A|B|C>/phone-<tier>.png`: the three tiers on each device.
- `<A|B|C>/closeup-battle.png`, `closeup-crowded.png` (Crown of Thorns: contested, a crown, a rival piece, a route,
  the tooltip) and `phone-closeup-crowded.png`.
- `<A|B|C>/legend.png`: every indicator on that direction's own ground, each with its measured contrast.
- `current/`: fresh captures of the live game. `current/hotspots.txt` has the measurements of the current problems.
- `metrics.json`: the worst contrast per indicator kind, for every direction × view.

---

## 1. Diagnosis: why the current map is hard to read

The captures are in `current/`. The game ran for 12 turns of AI play, with the GL stage on.

The mismatch is not really "photo against paint". It is a **value-structure** problem. The background spends the
contrast budget that the marks need.

1. **The sky competes for the brightest values.**
   - The domain-warped nebula's emission rims and the Hubble dust map reach Y≈0.13 at p95 (`hotspots.txt`). That is
     about 30× the luminance of the darkest space, and it falls exactly where the marks sit.
   - Ivory text at Y≈0.68 can only reach about 3.8:1 against a Y≈0.13 ground.
   - At strategic zoom on turn 1, the "AZURE COMPACT" empire lettering measures **1.1:1** against the gas behind it.
2. **Glows swallow tokens and names.** Coronas, bloom and lens crosses are light sources sitting directly under labels:
   - "The Hollow Throne" name over its corona: **1.4:1** (turn 12) and **1.4:1** (turn 1).
   - "Ninefold" under a blue corona: **2.3:1**.
   - "Pale Harbor" in a blue corona: **1.6:1**.
   - The 3.2px ink halo on the canvas text is too thin to separate a 12px name from a corona that is 60px across. In
     the shots, the Throne's crown ring, its Ring Ruin arcs and the label all fuse into one bright blot.
3. **Fog is shown as low contrast.**
   - Fogged names are drawn grey at 55% alpha, so they measure 1.6 to 2.5:1: Kappa Drift 1.8, Halcyon Verge 2.0,
     Crown of Glass 2.2.
   - Turn 1 is almost entirely fogged, so the first thing a player sees is the least readable map.
4. **Gold is overloaded: own colour on own land.** The Gilded house, the objective gold, the brass chrome, the gold
   lanes and the gilded routes are all one hue family.
   - A Gilded dashed route on Gilded land measures **1.0:1**: it is invisible.
   - A Gilded counter on the Gilded border measures 3.5:1.
   - The crowns' gold rings sit on gold-hatched land.
5. **Photographic texture competes with engraved line-work.**
   - The dust map and nebula have fine, high-frequency, high-contrast detail. That is exactly the frequency band of
     the hairline lanes, hatching and Cinzel serifs, so the eye can't separate the figure from the ground.
   - The hatching, which is the colour-blind cue, becomes "graph paper" over the gas and is the first thing lost
     (`current/desk-detail.png`).
6. **Two light models.** The board pieces are lit by the warm lamp (upper left) and cast shadows. The sky is
   self-luminous HDR (bloom, streaks, anamorphic flare). The minis look pasted onto a photograph instead of standing on
   a table.

**The rule every direction below follows:**
- The ground stays in a narrow, low-contrast value band. The measured p5 to p95 ranges are:
  - B: Y 0.004 to 0.06
  - C: Y 0.002 to 0.08
  - A (inverted, a light ground): Y 0.33 to 0.63
- Marks own every value outside that band.
- Light sources never glow over a mark.
- Fog removes colour, not contrast.

## 2. Method

The prototype is `client/style-lab.html`, built from `client/src/art/lab2/*`.

**One mock board for all three directions.** It is laid out the way `render/map.ts` and `mapmodel.ts` lay out the
real map: the same tier crossfade (`zoomW`), star and token sizes, fleet slots, names under stars, and the UX-V2 §2
information budget. The board holds:
- 28 systems covering every star kind: yellow, red, blue, white, binary, pulsar, black hole and the Throne.
- Three houses plus the Warden, and Voronoi territories.
- 12 fleets: pips, counters, minis, a stack of 2 and a stack of 3, one idle and one out of supply.
- A battle with an exchange of fire, a move route and a seize route with its reticle.
- Three Crowns and the Throne.
- One each of contested, occupied and tribute.
- Fog, lane focus with waypoints, the hover tooltip, orbiting bodies, and the HUD chrome restyled per direction.

Each direction implements one `Style` interface of about 30 paint calls (`render.ts`). Nothing about the content
differs between them.

**Readability is measured, not eyeballed** (`kit.ts measure`). For every indicator drawn, the renderer leaves a probe.
- The mark's pixels are wherever the final frame differs from a frame of the background alone (ground and territory).
- The mark reads if one of these holds:
  - its light tone (p95) beats the bright side of the local ground (p85 of a ring round it);
  - its dark tone (p5) beats the dark side (p15);
  - for a two-tone keyline on a mixed ground, each tone beats the opposite side.
- A glow under a mark counts as ground, so it is penalised. A keyline counts.
- Resting lanes are quiet by design (UX-V2: "a faint thread"), so they are reported but not held to 4.5:1.
- `scripts/style-explore-shots.mjs` runs this for every view and writes `metrics.json`.

The current game can't be measured the same way, because its glow and marks are not separable. For it,
`current/hotspots.txt` samples the screenshots directly: the ring of ground round each mark against the mark's own
tones.

## 3. The three directions

All three keep every indicator. The legend sheets list them with their numbers.

| | **A. The printed star chart** | **B. Painted diorama** | **C. Enamel and gold orrery** |
|---|---|---|---|
| indicator checks (201 per direction, all views) | **200 pass, 1 marginal** (lit lane on the phone strategic tier, 4.1:1) | 197 pass; strategic pips 3.6 and 4.0, phone-strategic Throne name 4.4 | 198 pass; a fogged gem beside the bezel 3.3, a route 4.47, a phone crown ring 4.46 |
| median of the worst-per-kind contrast | 8.3:1 | 7.8:1 | 7.7:1 |
| ground value range (operational, p5 to p95) | Y 0.33 to 0.63 (light) | Y 0.004 to 0.06 | Y 0.002 to 0.08 |
| per-frame marks (desk, CPU raster) | 1.4 ms | 1.6 ms | 1.9 ms |
| static rebuild on zoom (ground, territories, lanes) | ~30 ms | ~25 ms | 60 to 125 ms |
| bakes (once) | 0.75 Mpx plate | 2.3×1.5 Mpx stroke sky | 2.5×1.8 Mpx dial |
| GL needed | none | none | none |

**For comparison, the current map:** 1.2 to 2.3 ms per 2D frame (measured with the repo's map harness). On top of
that comes the full GL stage:
- nebula: 13 fetches/px, re-rendered every 1 to 4 frames;
- coronas, bloom, light and shade passes;
- the 0.5 / 0.38 / 0.28 targets.

All three directions remove the whole GL stage, so they are cheaper on phones, and the 2D path is the only path.
That makes the "fallback" the real renderer.

The static-rebuild cost is dominated by the per-house hatch mask in a viewport buffer. In integration, territories
would be baked in world space per ownership change, like the game's cached layer, so a zoom would not pay it.

### A. The printed star chart *(Cellarius plate on the war table)*

**Pitch.** The board is a hand-coloured engraved celestial plate laid on the walnut. The direction rests on one rule:
- **Printed things are flat.** Space, nebulae, stars, names, borders and routes are sepia ink, gilt and watercolour
  on vellum, and cast no shadow.
- **Pieces are objects.** Card counters, standees and the battle's wax seal are lit by the lamp and cast shadows
  down and to the right.

That rule *is* the unification: the photo-versus-paint clash disappears because nothing is photographic, and the
pieces are visibly on top of the print.

**How the indicators are expressed:**
- **Nebulae:** watercolour washes with pigment pooling at the edges, inside Y 0.45 to 0.62.
- **Graticule:** a planisphere centred on the Throne.
- **Beyond the board:** the plate is ruled, as terra incognita.
- **The plate:** a graduated neatline and a title cartouche.
- **Stars:** engraved glyphs whose **shape** tells the kind, with colour as a second cue:
  - yellow: an 8-ray gilt sun;
  - red: a vermilion disc with a dotted giant's ring;
  - blue: a 6-point star;
  - white: a 4-point compass star;
  - binary: two discs on one orbit;
  - pulsar: a disc with twin beams and radio arcs;
  - black hole: an ink disc with a gilt ring crossing in front;
  - Throne: a 16-ray sunburst with the crown engraved.
- **Territories:** the antique "outline colouring": a light wash plus a strong band along the border. **The hatch
  lives only in that band.** It keeps the colour-blind cue at every tier and leaves the interiors clean under the
  pieces.
- **Lanes:** hairline ink at rest. Lit lanes get a paper knock-out, heavier ink and a gilt inlay along the route.
- **Fog:** the plate left *uncoloured*, with the same ink weight, so names stay ≥ 4.5:1.

**Readability.** This is the strongest of the three. Ink at Y≈0.01 on paper at Y≈0.5 gives about 9:1 by default.
Every name uses a paper knock-out, the way engraved lettering interrupts hatching.

**Cost.** The lowest: one small bake plus screen-space grain from `parchment.webp`.

**Risks:**
- A **light board** is the biggest departure from "space opera". It is bright at night on a phone.
- The dark brass/steel chrome and modals need re-skinning to vellum, or the map becomes the only light surface.
- A dark-lacquer "night plate" variant (gilt ink on black lacquer, the same engraving) is the obvious hedge. It is not
  built.

**HUD chrome to match.** Vellum cartouches with double ink rules and red rubrics. The Seal becomes a real wax seal.
Crests become hand-coloured heraldic shields. The tooltip becomes a deckled slip (already in the kit).

**Minis to match.** The game's own sculpts are re-expressed as **hand-coloured engravings**: three tones of the
house colour plus ink cross-hatching in the shadows, with an ink outline (`stylizedShip`, per pixel and baked once).
They stand on turned walnut bases. The operational token is a **die-cut card counter** with a paper margin, a
thickness edge and a shadow. Square counters are the most "wargame" piece of the three.

### B. Painted diorama *(a hand-painted miniature-wargame space board)*

**Pitch.** Everything is painted by the same hand as the minis, and the minis stay exactly as they are. The sky
replaces the photographic nebula: about 52k bristled, directional brush strokes along a flow field, all of them inside
Y 0.004 to 0.05.

**How the indicators are expressed:**
- **Stars:** painted spheres with one lamp key light, a bounce rim and a short painted halo of ≤ 1.9R. There is no
  bloom, lens cross or flare:
  - yellow: a gold sphere;
  - red: a large ember sphere with brush mottling;
  - blue: a small hot sphere with four painted glints;
  - white: a pearl;
  - binary: two spheres in a painted swirl;
  - pulsar: a tiny sphere with tapered beam strokes;
  - black hole: a black sphere inside an orange painted ring;
  - Throne: a gold sphere with painted petals.
- **Territories:** a glaze, a dry-brushed band whose **stroke direction is the hatch angle**, and a border painted
  in loaded strokes of uneven pressure.
- **Labels:** sit on a soft painted dark underlay, the way a painter knocks back what is behind a focal point.
- **Pieces:** painted wooden discs. The minis get a painter's **edge highlight**, a fine light line round the
  silhouette.

**Readability.** Good once marks use the lifted house tones (`MK`). The weak spot is the **strategic tier**: small
pips sitting on a painted bright border measure 3.6 to 4.2:1.

**Cost.**
- About 1.6 ms of marks per frame.
- The biggest bake (a 2.3×1.5 Mpx sky of 52k stroke stamps), done once at load. It was not timed on a real phone.

**Risks:**
- It is the **closest to the current look**, so it fixes the clash with the least change in identity. The flip side
  is the least distinct "board game" read.
- The brushwork softens when upscaled at detail zoom. A second, finer stroke layer, or a GL stroke shader, would be
  needed.

**HUD chrome to match.** Painted wood and brass plates with painted bevels and a gold Seal. It is close to today's kit.

**Minis to match.** Unchanged sculpts with the edge-highlight outline, on painted slate bases with an enamel rim.

### C. Enamel and gold orrery *(a jewelled instrument on the table)*

**Pitch.** The galaxy is a deep black-enamel dial inside a polished gold bezel, with milgrain and an engraved degree
scale, set on black velvet:
- **Guilloché:** engine-turned rings round the Throne under the glaze.
- **Nebulae:** cloisonné fields of deep enamel (indigo, verdigris, oxblood, umber) separated by fine bronze wire.
- **Lanes:** inlaid gold wire.
- **Territories:** **champlevé** house enamel with the house hatch engraved *under* the glaze (basse-taille). The
  hatch is strongest in a band along the wall.
- **Stars:** **cabochons in gold collets**; the stone tells the kind:
  - yellow: citrine;
  - red: garnet, and larger;
  - blue: sapphire, and small;
  - white: moonstone;
  - binary: two stones on one bar;
  - pulsar: a *star sapphire* whose asterism is the pulsar mark, plus gold beam pins;
  - black hole: onyx inside a gold orbit ring that crosses in front;
  - Throne: a repoussé gold sun boss with the crown struck in it.
- **Fog:** unpolished pewter stones in silver collets.
- **The lamp:** the one light shows as a single broad reflection across the glaze.

**Readability.** Very strong figure/ground: gold and ivory at Y 0.45 to 0.8 against a dial at Y ≤ 0.08.

One lesson learned during iteration: **gold must be rationed.** With gold territory walls, the crown rings and
contested rings lost against the walls (3.7:1). The fix:
- territory walls are antique bronze;
- **bright gold is reserved** for objectives, lit lanes and pieces;
- crown rings carry pearl milgrain.

The remaining marginal case is a fogged pewter stone right beside the bezel at strategic zoom (3.3:1).

**Cost.**
- About 1.9 ms of marks per frame.
- The dial bake (2.5×1.8 Mpx, per pixel), done once at load. It was not timed on a real phone.
- The heaviest static rebuild, because of the two hatch passes per house.

**Risks:**
- The cloisonné contours are baked raster, so they step at close zoom. Vector contours (marching squares, once) or a
  GL SDF pass would fix it.
- Saturated enamel fields can feel loud, so their alpha must stay low.
- It can tip into "luxury UI" if the gold isn't rationed.

**HUD chrome to match.** Black-enamel plates in polished gold bezels, round jewel buttons, crests as enamel cabochons
in gold, and the Seal as a cinnabar enamel cartouche.

This is **the smallest change from today's kit.** The bible's own materials are already enamel, brass and steel, and
today's operational counter is already an enamel coin in a brass bezel.

**Minis to match.** **Cast-metal figurines**: the sculpts are gradient-mapped to the house metal (Azure silver,
Crimson red-gold, Gilded gold, the Warden violet-silver), with the painted lacquer kept as enamel. They stand on
black-enamel plinths with a gold rim and a house-enamel band.

## 4. Recommendation

**Adopt C, the enamel and gold orrery, with three rules taken from A.**

**Why C:**
1. It fixes the actual fault: the background's value range drops from about 30:1 to a narrow band, and nothing
   glows under a mark.
2. It keeps the dark, deep-space mood the game has built its identity on, and the minis read as precious objects on
   it.
3. It is *the art bible's own material vocabulary* (enamel, brass, steel), so the HUD chrome, the crests and the
   enamel tokens already belong to it. Integration is mostly the map plus a gradient-map pass on the minis.
4. It is the most "tactile" and screenshot-worthy of the three, which is QUALITY.md §1.

**The three rules from A:**
1. **Printed is flat, pieces are lit.** Only things that sit *on* the dial cast shadows.
2. **The hatch lives in the border band.** The colour-blind cue survives at every tier and the interiors stay quiet.
3. **Fog removes colour, never contrast.** Use pewter stones and uncoloured names, never 55% alpha.

**A is the runner-up and the safest for readability:** 200 of 201 checks pass and it is the cheapest. Take it instead
of C if you are willing to make the board light and re-skin the chrome to vellum. It is also the right model for a
"print/handout" lens or the Herald's maps.

**B is not recommended.** It is the least change, but painted gas behind small pieces still competes at the strategic
tier, which is where the weakest readings fell. It keeps the photograph's problem in painted form.

**Next steps if C is chosen:**
1. Integrate behind a Tweaks flag. Bake territories and the dial in world space per ownership change. Turn the
   cloisonné contours into vectors.
2. Gradient-map the ship sprites once per house (the `metalFn` in `orrery.ts`).
3. Retire the GL nebula, coronas and bloom on the map. Keep the GL stage for the battle viewer only if it is wanted
   there.
4. Raise strategic pips to 8 to 9 px (the lab does) and keep the measurement script as a regression test.

## 5. Inspiration, and what was taken from each

- **Andreas Cellarius, *Harmonia Macrocosmica* (1660).**
  - Sources: [Linda Hall Library](https://www.lindahall.org/about/news/scientist-of-the-day/andreas-cellarius/) and
    [RareMaps](https://raremaps.com/gallery/detail/112856/situs-terrae-circulis-coelestibus-circundatae).
  - Taken for A: hand-coloured engraved plates "heightened in gold", the planisphere graticule, the graduated
    border, the title cartouche, and the orrery diagrams that became the dotted orbits.
- **Twilight Imperium 4** ([Wikipedia](https://en.wikipedia.org/wiki/Twilight_Imperium)).
  - Taken: the hex tiles signal anomalies with a border colour, not texture. So a state goes in the *edge* of a thing
    (rims, rings, bands), never in its fill.
- **Eclipse: Second Dawn** ([Wikipedia](https://en.wikipedia.org/wiki/Eclipse_(board_game))).
  - Taken: the 2nd edition revised the graphic design and the miniatures together, which is the argument for
    restyling minis and board in one pass. Its sector tiles keep dark space quiet behind bold printed lane edges.
- **Stellaris.**
  - Sources: [PC Gamer on its map UI](https://pcgamer.com/why-i-love-stellaris-slick-interface), the border mods'
    notes on reducing territory transparency and avoiding dark primary colours
    ([Steam](https://steamcommunity.com/sharedfiles/filedetails/changelog/2104240928?l=english)), and the
    Construct-forum recipe of cells merged and then shrunk to leave a gap between empires
    ([construct.net](https://www.construct.net/en/users/344891/moonpunk/forum-posts/page-2)).
  - Taken: territory as one merged shape with a strong border band and low interior fill, and lifted house tones
    for marks on the dark.
- **Endless Space 2.**
  - Sources: a [Steam discussion](https://steamcommunity.com/app/392110/discussions/0/1291817208495290521)
    complaining that the map hides the art behind wireframes, and its notes that dark space makes light colours the
    way things stand out.
  - Taken: both. The pieces must stay art (cast figurines, engravings) while the *ground* goes quiet.
- **Sunless Skies** ([Failbetter pre-production](https://www.failbettergames.com/news/sunless-skies-pre-production-looking-to-the-skies)).
  - Taken: one palette per region for navigation, painterly roughness "swiftly rendered in a naturalist's notebook"
    (B's brushwork and A's watercolour), and organic shapes against hard machinery.
- **Inscryption** ([Game Developer](https://www.gamedeveloper.com/design/how-game-jam-sacrifices-became-inscryption)).
  - Taken: low resolution forced them to drop card text and use icons. That is the same discipline as the UX-V2
    budget per tier, now enforced here too: no corner marks at strategic.
- **Hades / Jen Zee** ([Wikipedia](https://en.wikipedia.org/wiki/Jen_Zee),
  [GeekChamp analysis](https://geekchamp.com/the-art-of-hades-showcases-the-talent-that-went-into-this-beautifully-vibrant-game/)).
  - Taken for B: silhouette first, and bright edges with controlled shadows so figures read through effects. That
    became the minis' edge highlight and the painted underlay behind names.
- **FTL** ([Subset forum](https://www.subsetgames.com/forum/viewtopic.php?p=31310)).
  - Taken: the map is a "beacon map", not a star map, and it shows only what a decision needs. That supports
    hiding the rest of the information until zoom or hover.

## 6. Files and how to run

- **The page:** `client/style-lab.html` (`npm run dev`, then
  `/style-lab.html?style=A|B|C&tier=strategic|operational|detail`, or `&focus=battle|crowded`, or `&legend=1`). The
  A/B/C and S/O/D buttons switch live.
- **Modules** in `client/src/art/lab2/`:
  - `board.ts`: the mock board
  - `render.ts`: shared layout plus the `Style` interface
  - `kit.ts`: view, colour, contrast measurement, band hatch, sprite stylizer, mip blits
  - `chart.ts`: A
  - `diorama.ts`: B
  - `orrery.ts`: C
  - `legend.ts`
  - `main.ts`
  - `lab2.css`: the HUD chrome per direction
- **Scripts:**
  - `scripts/style-explore-shots.mjs`: every direction × tier × device, the close-ups, the legends, `metrics.json` and
    the compare sheets.
  - `scripts/style-explore-current.mjs`: the live game at the same tiers.
- The existing files are untouched. `vite.config.ts` was **not** changed, because dev serves `style-lab.html`
  without it. Add `style: page('style-lab.html')` to the build inputs only if the lab should ship.

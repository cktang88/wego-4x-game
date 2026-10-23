# Third-party assets: audio and textures

Policy: **CC0 only.** Anything under CC-BY, CC-BY-SA, OGA-BY or GPL is rejected, and so is any entry that
lists CC0 alongside other licences. Each licence below was checked on the asset's own page on the date of
download (2026-10-21). Kenney packs also include a `License.txt` that states CC0. The ambientCG licence page
reads: "All assets are released under the Creative Commons CC0 license". The player-facing summary is in
`client/public/CREDITS.txt`.

## Audio: `client/public/audio/`

Each sound ships in two formats:

- `<name>.ogg`: Vorbis, picked by Chrome, Firefox and Edge.
- `<name>.m4a`: AAC-LC with `+faststart`, picked by Safari and iOS.

The engine picks the format with `canPlayType` and falls back to the other one if decoding fails.

**Pipeline** (ffmpeg 6, run from a scratch script, not part of the build):

- **SFX:**
  1. Resample to 44.1 kHz mono.
  2. Mix the layers with the gain and delay given in the table.
  3. Trim the trailing silence below −60 dB.
  4. Peak-normalise to the listed dBFS.
  5. Encode as Vorbis q1 (q3 for stings) and AAC at 48 kbps (64 kbps for stings).
- **Loops:**
  1. Trim the start.
  2. Run `loudnorm` to the target LUFS.
  3. Build a seamless loop with a crossfade: the body `[xf..end]` crossfades into `[0..xf]` (quarter-sine, `acrossfade`).
  4. Encode as Vorbis q0 and AAC at 40–56 kbps.

| file | used for | source (original file) | author | page | licence | conversion |
|---|---|---|---|---|---|---|
| ui_click | button click | Interface Sounds `click_002.ogg` | Kenney | https://kenney.nl/assets/interface-sounds | CC0 | mono, peak −3 dB |
| ui_hover | hover tick | Interface Sounds `tick_002.ogg` | Kenney | same | CC0 | mono, peak −6 dB |
| ui_open | modal/plate open | RPG Audio `metalLatch.ogg` | Kenney | https://kenney.nl/assets/rpg-audio | CC0 | mono, peak −3 dB |
| ui_close | modal close | RPG Audio `metalClick.ogg` | Kenney | same | CC0 | mono, peak −3 dB |
| ui_error | blocked / invalid | Interface Sounds `error_006.ogg` | Kenney | interface-sounds | CC0 | mono, trimmed, peak −3 dB |
| ui_confirm | confirm | Interface Sounds `confirmation_002.ogg` | Kenney | interface-sounds | CC0 | mono, peak −3 dB |
| ui_seal | seal the turn | Impact Sounds `impactPlate_heavy_001.ogg` + `impactBell_heavy_003.ogg` (−10 dB, +20 ms) | Kenney | https://kenney.nl/assets/impact-sounds | CC0 | 2-layer mix, peak −2 dB |
| ui_coin | Fate spend | RPG Audio `handleCoins2.ogg` | Kenney | rpg-audio | CC0 | mono, peak −3 dB |
| ui_banner | banner / founding | RPG Audio `cloth1.ogg` + Impact `impactBell_heavy_002.ogg` (−8 dB, +180 ms) | Kenney | rpg-audio, impact-sounds | CC0 | 2-layer mix, peak −2 dB |
| ui_page | Herald page flip | RPG Audio `bookFlip2.ogg` | Kenney | rpg-audio | CC0 | mono, peak −3 dB |
| game_order | order placed | Casino Audio `chip-lay-1.ogg` | Kenney | https://kenney.nl/assets/casino-audio | CC0 | mono, peak −3 dB |
| game_move | fleet move whoosh | Sci-Fi Sounds `thrusterFire_001.ogg` | Kenney | https://kenney.nl/assets/sci-fi-sounds | CC0 | first 1.0 s, fade in 0.18 s, fade out 0.55 s, peak −4 dB |
| game_capture | siege / capture | Impact `impactMetal_heavy_000.ogg` + `impactBell_heavy_001.ogg` (−4 dB, +50 ms) | Kenney | impact-sounds | CC0 | 2-layer mix, peak −2 dB |
| game_research | research / project done | Interface `glass_002.ogg` + `confirmation_003.ogg` (−3 dB, +100 ms) | Kenney | interface-sounds | CC0 | 2-layer mix, peak −3 dB |
| game_turn | turn resolved | Impact `impactBell_heavy_000.ogg` | Kenney | impact-sounds | CC0 | pitched down to 0.82×, peak −3 dB |
| bt_laser | shot | Sci-Fi `laserSmall_000.ogg` | Kenney | sci-fi-sounds | CC0 | mono, peak −4 dB |
| bt_laser_heavy | crit / heavy shot | Sci-Fi `laserLarge_000.ogg` | Kenney | sci-fi-sounds | CC0 | mono, peak −4 dB |
| bt_cannon | first strike / battle start | Impact `impactPunch_heavy_000.ogg` + Sci-Fi `lowFrequency_explosion_001.ogg` (first 0.6 s, −5 dB) | Kenney | impact-sounds, sci-fi-sounds | CC0 | 2-layer mix, peak −2 dB |
| bt_explosion | hit / crit | Sci-Fi `explosionCrunch_000.ogg` | Kenney | sci-fi-sounds | CC0 | mono, peak −2 dB |
| bt_shield | shield hit / Twist of Fate | Sci-Fi `forceField_000.ogg` | Kenney | sci-fi-sounds | CC0 | mono, peak −4 dB |
| bt_destroyed | ship destroyed | Sci-Fi `lowFrequency_explosion_000.ogg` + `explosionCrunch_002.ogg` (−3 dB, +40 ms) | Kenney | sci-fi-sounds | CC0 | 2-layer mix, peak −1 dB |
| st_called | CALLED IT sting | "Victory Fanfare Short" `Heavy_ConceptB.wav` | cynicmusic | https://opengameart.org/content/victory-fanfare-short | CC0 | first 2.4 s (opening brass stab), fade out 0.7 s, mono |
| st_caught | CAUGHT OUT sting | "String and piano horror stings" `piano_sting.mp3` | congusbongus | https://opengameart.org/content/string-and-piano-horror-stings | CC0 | first 3.2 s, fade out 1.4 s, mono |
| st_victory | victory | "Victory Fanfare Short" `Heavy_ConceptB.wav` | cynicmusic | https://opengameart.org/content/victory-fanfare-short | CC0 | full 11.8 s, mono |
| st_defeat | defeat | "Medieval: Defeat Theme" `defeat.wav` | RandomMind | https://opengameart.org/content/medieval-defeat-theme | CC0 | first 10 s, fade out 3 s, mono |
| amb_drone | board ambience bed (loop) | "Dark Sci-Fi Audio Pack" `airy.mp3` | SRG774 | https://opengameart.org/content/dark-sci-fi-audio-pack | CC0 | skip 0.5 s, loudnorm −26 LUFS, 5 s loop crossfade, mono, 58.5 s |
| mus_board | board music, gentle (loop) | "Dark Sci-Fi Audio Pack" `sector.mp3` | SRG774 | same | CC0 | skip 0.8 s, loudnorm −24 LUFS, 4 s loop crossfade, stereo, 52 s |
| mus_theme | lobby / end screen: choir, horns, deep bass | "Epic Endgame Cinematic" `ChoirChordsBassMaster.wav` | cynicmusic | https://opengameart.org/content/epic-endgame-cinematic | CC0 | loudnorm −20 LUFS, stereo, 91 s |

**Sizes:** .ogg set 1.64 MB, .m4a set 1.68 MB, 3.32 MB on disk. A browser downloads only one set, about 1.65 MB.

| set | .ogg | .m4a |
|---|---|---|
| All 25 SFX and stings | 0.39 MB | 0.34 MB |
| Music and ambience (3 loops) | 1.25 MB | 1.34 MB |

**Pairings without new files** (`audio.ts` `touch()`, `chip()`, `heartbeat()`; the delight wave 2, docs/DELIGHT.md):
the Saga's leaf is `ui_page` at 0.82×; its cover is `ui_close` at 0.62× under a slow page; a ruler's banner set at a
lobby chair is `ui_banner` at 1.2×, quiet; a piece set back on the felt is `ui_click` at 0.55× (the wooden tok); the
ink running in the Herald is a faint `ui_page` at 1.5×; order chips are `game_order` pitched up the major scale I→V,
the fifth over a soft synthesized triad; a ship that lived by a thread gets one synthesized lub-dub.

Not shipped: Kenney UI Audio, Digital Audio and Music Jingles were reviewed and not used, because they are too synthetic or cartoony for the tabletop tone.

Rejected for licence: "Evil Awaits", "Tragic ambient main menu", "Ambient Soundscape", "10 Fanfares" and "space fanfare". These pages list CC-BY or OGA-BY alongside CC0.

## Textures: `client/public/tex/`

Every texture is from ambientCG (Lennart Demes), CC0. Each is the `<id>_1K-JPG_Color.jpg` map, converted with Pillow to WebP (method 6).

- **color** maps are albedo, used as-is.
- **detail** maps are greyscale. They get a 0.5 % autocontrast and are then shifted so the mean is 50 % grey. They are meant for `soft-light` or `overlay` blending at low alpha, so the palette in `palette.ts` stays in charge.

| file | source | page | kind | size | bytes | where it would plug in (phase 2, not wired) |
|---|---|---|---|---|---|---|
| felt.webp | Fabric 034 | https://ambientcg.com/view?id=Fabric034 | detail | 512² q70 | 106,716 | `art/mat.ts` `weaveTile()`: replace the synthetic weave; soft-light ~0.10 over `matBackdrop` |
| wood-dark.webp | Wood 051 | https://ambientcg.com/view?id=Wood051 | color | 1024² q72 | 32,432 | table rim past the mat edge (`theme.css` body or app frame), and the order-strip tray |
| metal-brushed.webp | Metal 009 | https://ambientcg.com/view?id=Metal009 | detail | 512² q70 | 59,758 | `art/plates.ts` `gunmetal()`: `overlayDetail()` clipped to the plate; `theme.css` chrome panels |
| metal-worn.webp | Metal 011 | https://ambientcg.com/view?id=Metal011 | detail | 512² q70 | 62,012 | `art/plates.ts` `enamel()` rims (gold/iron tarnish) and brass buttons |
| parchment.webp | Paper 003 | https://ambientcg.com/view?id=Paper003 | detail | 1024² q70 | 57,334 | `ui/herald.ts` sheet: a soft-light pseudo-element at ~.35 over the beige gradient |
| leather.webp | Leather 030 | https://ambientcg.com/view?id=Leather030 | color | 512² q72 | 15,302 | modal backs, Fate token tray, card spines |

Total: 333,554 bytes. Loaders and helpers are in `client/src/art/textures.ts`: `loadTexture`, `preloadTextures`, `textureNow`, `pattern`, `overlayDetail`, `texUrl` and `cssUrl`.

### Added for the art layer (2026-10-22): `client/public/tex/`

Used by the WebGL2 stage (`client/src/art/gl/`) and the component kit (`client/src/art/kit.css`). Licences were checked on each source on 2026-10-22. One asset is CC BY 4.0 rather than CC0, because its attribution is simple and is recorded here and in `client/public/CREDITS.txt`.

| file | source | author / credit | page | licence | processing | bytes |
|---|---|---|---|---|---|---|
| nebula-dust.webp | Hubble, "Hubble reveals heart of Lagoon Nebula" (M8), NASA image library id `GSFC_20171208_Archive_e001955` (~large) | **NASA, ESA** | https://images.nasa.gov/details/GSFC_20171208_Archive_e001955 | NASA material is public domain; ESA/Hubble images are **CC BY 4.0** (credit "NASA, ESA") | greyscale, 7px median filter (removes the stars), high-pass (subtract a 60px Gaussian), 1% autocontrast, mean shifted to 50% grey, 1024×512, WebP q72. It is a detail map only: the shader samples it with mirrored repeat as dust in the gas. It is never shown as a photo. | 36,638 |
| bluenoise-128.png | "Free blue noise textures", `128_128/LDR_LLL1_0.png` | Christoph Peters | https://momentsingraphics.de/BlueNoise.html | CC0 (LICENSE.txt in the archive) | unchanged, greyscale PNG (lossless: grain and dither need exact values) | 16,580 |
| metal-brushed-normal.webp | derived from `metal-brushed.webp` (ambientCG Metal 009) | Lennart Demes (ambientCG) | https://ambientcg.com/view?id=Metal009 | CC0 | tangent-space normal map from the brushed height (0.8px blur, wrapped central differences, strength 2.2), 512², WebP q82. ambientCG's own NormalGL for Metal009 is nearly flat (σ ≈ 1/255), so it was not usable. | 38,530 |
| brass-grime.webp | Metal 048 B (dirty gold, fingerprints): `Roughness` map | Lennart Demes (ambientCG) | https://ambientcg.com/view?id=Metal048B | CC0 | detail map: 512², 0.5% autocontrast, mean shifted to 50% grey, WebP q70 (tarnish on brass plates, soft-light ~0.3) | 52,640 |

Considered and not added:

- **Photographic nebula backdrops** (Hubble or JWST colour images): they would be a photo in a painted world. NASA imagery is used only as the greyscale dust detail above. JWST images from STScI are co-credited NASA/ESA/CSA, so check the CSA terms before any use.
- **Painted brush-stroke texture packs:** none found with a verifiable CC0 licence. The painterly breakup comes from the shader's domain warp instead.
- **ambientCG Paper 006** (beige) and **Fabric 030:** the existing `parchment.webp` and `felt.webp` already cover them.

## Verification

```
node scripts/audio-check.mjs            # needs the Vite dev server on :5173
```

The check covers:

- Every `.ogg` decodes with `decodeAudioData` in Chromium and is not silent.
- Every `.m4a` decodes. The Playwright Chromium build has no AAC, so these files are decoded with ffmpeg, and their durations are compared with the `.ogg` twins.
- The engine stays locked until a real click, unlocks, preloads all 28 files, plays every SFX, runs the semantic layer, crossfades scenes, mutes, persists settings and builds the settings panel. All of this must happen with zero page or engine errors.
- All textures load.

## Phase 2 integration

The engine is in `client/src/audio/audio.ts`. Import it with `import { audio } from '../audio/audio.ts';`.

**Status: wired.** Every hook below is in place. Beyond the table:

- `client/src/audio/hooks.ts` holds the app-wide pieces: the delegated hover tick (mouse only), Shift+M, `openSoundSettings()` (the Sound dialog: menu → *Sound settings*, Help → *Sound settings*, lobby → *Sound*) and the speaker icon. The dialog styles are in `audio/audio.css`.
- Refused actions get `ui_error` from `toast()` itself (`ui/dom.ts`: any toast starting `⊘`, `⏱ No orders banked` or `No slot free`), so `verbs.ts` / `soul.ts` needed no edits.
- LIVE ticks are not voiced beat by beat. `onSourceChange` calls `audio.onTick(events)` once per tick: at most one sound per kind of event, the most dramatic first, capped at 4.
- After the unlock, the engine preloads the small UI set and then every SFX in the background (about 0.6 MB). Music loads only when a scene asks for it. Nothing is fetched before the first gesture.
- Test hook: when a page sets `window.__tcAudioLog = []`, every sound that starts is appended to it. `window.tcAudio` is the engine. See `scripts/audio-e2e.mjs`.

| hook | file / place | call |
|---|---|---|
| boot | `client/src/main.ts`, top level, before `lobby()` | `audio.install();` (arms unlock on the first gesture) then `audio.scene('lobby')` |
| game start | `client/src/game.ts` `GameScreen` constructor | `audio.me = this.you; audio.scene('board');` (also refresh `audio.me` after a hotseat `handoff()`) |
| leave game | `GameScreen.destroy()` | `audio.scene('lobby')` |
| order placed | `game.ts` `addOrder()` on success | `audio.ui('order')` |
| order blocked | `hud/verbs.ts` / `game.ts` where `toast('⊘ …')` fires; `hud/card.ts` `bindCard` `aria-disabled` branch (`.nope`) | `audio.ui('error')` |
| drag/tap commit | `hud/gestures.ts`: the three `commitIntent(g, it)` call sites (right-click, tap-then-tap, `endDrag(true)`) | covered by `addOrder()`. Optional: `audio.sfx('game_move', { vol: 0.5 })` when a drag starts |
| card buttons | `hud/card.ts` `bindCard` click handler, before `cardAction(...)` | `audio.ui('click')` |
| hover tick | delegated `pointerover` on `.ib, .tool, .bv-btn` (desktop only, `pointerType === 'mouse'`) | `audio.ui('hover')` |
| seal turn | `game.ts` `submit()` inside `go()` | `audio.ui('seal')` |
| Fate spend | `hud/signature.ts` `sigAction` `a === 'fate'`: first tap (arming) and the spend before `fateFlourish` | arming: `audio.ui('click')`; spend: `audio.ui('coin')` |
| Fate public reveal / bonus | `hud/signature.ts` `fateFlourish()` | `audio.ui('banner')` |
| modal open/close | `ui/modals.ts` `openModal()` / `closeModal()`; `ui/dom.ts` `overlay()` | `audio.ui('open')` / `audio.ui('close')` |
| Herald | `ui/herald.ts` `openHerald()`, and its edition prev/next buttons | `audio.ui('page')` |
| replay beats | `game.ts` `nextBeat()`, after `const beat = R.beats[R.i]` (skip when `R.preview`) | `audio.onGameEvents(beat.events, { stagger: 0.04 })`. It maps move, battle, destroyed, capture, posture CALLED IT / CAUGHT OUT, fate, tech, soul and the rest |
| turn resolved | `game.ts` `startReplay()` (WEGO, not preview), or `endReplay()` | `audio.turnResolved()` |
| battle viewer | `render/battle.ts` `openBattleViewer`. In `frame()` keep `prevT`; while `playing`, for each `sh` in `shots` with `prevT < sh.t0 && sh.t0 <= T` call the hook. On open, `audio.preload(['bt_laser','bt_laser_heavy','bt_cannon','bt_explosion','bt_shield','bt_destroyed'])`; optionally `audio.scene('battle')`, and back to `'board'` in `close()` | `audio.onShot(sh.rec, { pan: (sh.from.x / W) * 2 - 1 })` |
| victory/defeat | `game.ts` `showVictory()` | `audio.gameOver(st.winner === this.you)` |
| founding banner | covered by the `soul` `founded` event; the founding pick UI in `hud/soul.ts` can also call `audio.ui('banner')` | |
| settings | `hud/hud.ts` menu popover (`kind === 'menu'`): add a `Sound on/off` item (`data-m="sound"` → `audio.toggleMute()`), and mount `audioSettingsPanel()` in the Help modal (`ui/modal-help.ts`) or `ui/tweaks.ts` | `audioSettingsPanel()` returns a self-syncing block (`.audio-settings`, `.audio-row`, `.audio-mute`) |
| keyboard | global key handler in `game.ts` (`m` is already Move with a fleet selected) | e.g. `Shift+M` → `audio.toggleMute()` |

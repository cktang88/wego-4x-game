# Quality bar: the one-page ship checklist

Every screen, modal, effect and feature passes this before it merges. If an item doesn't apply, say why in
the PR. Shots for the review come from the existing scripts (`scripts/ux-shots.mjs`, `scripts/phone.mjs`,
`scripts/sweep-*.mjs`) at **1440×900, 2560×1440, 820×1180 (tablet) and 390×844 (phone)**.

## 1. The screenshot test
- [ ] **Would a reviewer screenshot this?** Seen cold, it looks like a *game* and a crafted object (felt, brass,
  ink, wax, paper, leather), not a web app. No default form controls, no bare `<select>`, no grey cards.
- [ ] One clear focal point; the eye knows where to go in under a second.
- [ ] Light comes from the lamp (top-left, warm); shadows and highlights agree with it.

## 2. Juice and feel
- [ ] Every player action answers within **100 ms** (sound, motion or state), even when the network is slow.
- [ ] The feedback size matches the moment (LOOPS.md §5): small things are quiet, big things are rare.
      At most one *big* treatment per reveal.
- [ ] Motion has easing and weight (no linear tweens, no instant pops); one overshoot at most.
- [ ] **Truth:** no animation, number roll or stamp misstates the game state. Slow-mo and stamps fire only on
      the real event.
- [ ] Screen shake ≤ 6 px, never on small moments, never on text the player is reading.

## 3. Sound
- [ ] The action has a sound from the existing set (docs/ASSETS.md), or a new CC0 one logged there.
- [ ] Frequent sounds have pitch jitter; stings duck the music; nothing clips when 3 events stack.
- [ ] The screen works fully with sound **off** (sound is never the only signal).

## 4. States
- [ ] **Empty:** written in the game's voice, with a next step ("No banners fly yet. Build a ship at a yard to
      raise one."), never "No data".
- [ ] **Loading:** anything over 300 ms shows a diegetic wait (sand, a candle, a typesetter's tray), never a
      spinner; nothing shifts layout when it arrives.
- [ ] **Error:** says what happened and what to do, in plain words; offers a retry; never shows a stack trace
      or an error code alone; refused actions explain why (UX-V2: grey arrow + reason).
- [ ] **Offline / reconnect** (online games): the player sees it, orders are kept, and resync is silent.
- [ ] **Long content:** longest names (e.g. "Commander Maximiliana Ophelia Throckmorton"), 3-digit numbers,
      8-ship fleets, turn 99. Nothing overflows or truncates mid-word without an ellipsis and a tooltip.

## 5. Typography and text
- [ ] Only the theme's families and three sizes; numbers bold and tabular; floor 14 px desktop, 13 px phone.
- [ ] Text budget (UX-V2 §6): labels ≤ 2 words, buttons ≤ 3, tooltips ≤ 12, notifications ≤ 5.
- [ ] House voice: short, concrete, a little dry. No "Successfully", no "Oops!", no exclamation marks
      outside the Herald.
- [ ] Spelling and capitalisation match the glossary (Crown, Throne, Fate, Herald, CALLED IT).

## 6. Consistency
- [ ] Colour means what UX-V2 says (player colour = owner, gold = VP, red/green only in chrome).
- [ ] Icons from the closed set; same verb, same icon, same place, on every screen.
- [ ] Open/close behaves like every other modal (Esc, ×, backdrop, swipe-down on phone; same sounds).
- [ ] Uses theme tokens and shared components; no one-off colours, radii or shadows.

## 7. Phone, tablet, PC
- [ ] **Phone (390×844):** reachable with one thumb; targets ≥ 44 pt; safe areas respected; no horizontal
      scroll; bottom sheets swipe down; nothing important under the notch or home bar.
- [ ] **Tablet:** works in both orientations; touch *and* pointer (hover states have a long-press twin).
- [ ] **PC:** keyboard path for every action (shortcut shown in the tooltip); right-click does something
      sensible or nothing; the layout uses big screens (no tiny island in a 2560 px void).
- [ ] 60 fps on a mid-range phone during the replay; nothing animates off-screen; idle CPU near zero.
- [ ] Haptics use the shared vocabulary (DELIGHT.md #84) and are absent, not broken, on iOS.

## 8. Accessibility
- [ ] **Reduced motion:** shake, slow-mo, parallax and drifting particles off; state changes still visible
      (cross-fades).
- [ ] **Colour-blind:** owners distinguishable by shape or sigil as well as colour (check deuteranopia and
      protanopia sims); no red/green-only meaning.
- [ ] Contrast ≥ 4.5:1 for text, 3:1 for UI glyphs, including over the starfield and the parchment.
- [ ] Focus is visible and ordered; modals trap focus and restore it; controls have accessible names.
- [ ] Nothing depends on timing the player can't pause (the replay pauses; LIVE prompts don't expire silently).

## 9. Intention
- [ ] It names the aesthetic it serves (Fellowship, Narrative, Challenge, Fantasy, Sensation).
- [ ] It shows real game state, or it is clearly decoration that never competes with state.
- [ ] Someone other than the author played it on a phone and on a PC, with sound, and said what it does
      without being told.
- [ ] Zero console errors in the e2e scripts; `npm test` green.

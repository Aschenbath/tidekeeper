# Tidekeeper — SPEC

A seated, hands-only mixed-reality puzzle for Meta Quest 3, built with IWSDK 1.1 (WebXR). Entry for the Meta VR Start
Developer Competition 2026 (Devpost), Gaming track, New Experience division. Targets the "First Five Minutes" and
"Reason to Come Back" special prizes.

Deadline: 2026-11-18 12:00 PT. Build window 2026-11-01 → 11-14, buffer 11-15 → 11-17.

## 1. Player promise

> A tiny archipelago floats in front of you at table height. Letters must reach the villages before the tide shuts the canals.
> Pinch channels into place, scrub time forward to see what the sea will do, then launch the boats and watch your plan
> work. Every delivery lights another village.

The pleasure is **predicting a small world and watching the prediction come true**. Everything serves that: the
preview must match the launch exactly, failures must explain themselves, and undo must always be one gesture away.

Not a tech demo: every mission has a piece budget, a tide window and an optional mastery goal, so choices matter.

## 2. Rules (pure simulation, deterministic, no physics engine)

### Board
- Square grid, up to 7 × 6 cells. Each cell is one of:
  - `sea` — open water; boats can move through it only along placed or fixed channels (see below).
  - `rock` — never passable; islands, cliffs.
  - `build` — empty slot where the player may place one piece.
  - `fixed:<piece>@<rot>` — a pre-placed piece the player cannot move (authored).
  - `harbor:<id>` — where a boat starts; has an exit direction.
  - `dock:<shape>` — destination; shape ∈ circle, triangle, square, diamond. Accepts boats of the same shape.
  - `bar` — a sandbar: a channel cell that is passable only when the tide is high (see Tide).
- Boats move between edge-connected cells. A cell is enterable from a direction only if its piece has an opening on
  that side. Harbors, docks and `sea` cells with an authored lane behave like fixed pieces.

### Pieces (only three types)
| Piece | Openings | Rotations | Extra |
|---|---|---|---|
| Straight | 2 opposite sides | 2 | — |
| Bend | 2 adjacent sides | 4 | — |
| Lock | 2 opposite sides | 2 | holds a boat for `wait` ticks, wait ∈ {1, 2, 3}, set by the player |

### Tide
- Each mission defines a tide pattern: a list of levels per tick, repeating (e.g. `[0,1,2,2,1,0]`), and each `bar`
  cell has a threshold. A bar is passable at tick t when `level(t) ≥ threshold`.
- The tide is visible: water height animates, bars visibly dry out.

### Ticks
- Time advances in discrete ticks (1 tick = 0.6 s when animated, adjustable).
- Each boat has a launch tick (authored; default 0) and moves one cell per tick along openings. A boat entering a lock
  waits there `wait` ticks before continuing.
- Resolution order per tick is fixed and documented in code: compute every boat's intended next cell, then resolve
  failures, then move. Failures (the run stops at the first tick with a failure, all failures in that tick reported):
  - **Aground**: the next cell is a bar that is dry at the arrival tick.
  - **Dead end**: no opening continues the path, or the next cell is rock/off-board.
  - **Collision**: two boats in the same cell, or swapping cells, in the same tick.
  - **Wrong dock**: a boat enters a dock with a different shape.
  - **Out of time**: the mission's tick limit is reached with boats still at sea.
- Success: every boat is inside its matching dock.

### Mission
- JSON in `src/game/missions/*.json`, validated by a schema at load: id, title, short hint line, grid, boats
  (harbor, shape, launch tick), tide pattern, bar thresholds, piece budget (per type), tick limit, mastery goal
  (one of: ≤ N pieces, arrive by tick T, use no lock), and one known solution (used by tests and by the hint).
- 9 authored missions forming a short campaign (§5), plus a **daily remix** (§6).

### Player actions on the board (each one undoable)
- Place a piece from the tray into a `build` cell (respecting budget).
- Rotate a placed piece (90°, or 180° for straight/lock).
- Set a lock's wait (cycles 1 → 2 → 3 → 1).
- Remove a placed piece (returns to the tray).
- Undo / redo (unbounded within a mission), restart mission, hint (reveals one piece of the stored solution, counted;
  a hint used means no mastery star).

## 3. Preview and launch (the core feature)

- A **tide dial** beside the board: a large ring the player pinch-drags (or pokes ◀ ▶) to scrub ticks 0…limit.
- While scrubbing, ghost boats show where each boat will be at that tick, the water level and bars update, and any
  failure appears at its tick as a red marker with a one-line reason ("Runs aground — the bar is dry at tick 5").
- Scrubbing never changes the board. The preview is computed by the same simulation function the launch uses; the
  launch animates exactly the ticks the preview showed (tested).
- **Launch** button: runs the animation. During a run the board is locked; the player can pause, or stop (returns to
  edit, board unchanged). On failure: the boat stops where it failed, the reason shows, and "Undo last change" and
  "Back to editing" are the two big buttons. On success: boats dock, village lights, mission card with stars.

## 4. Hands-first input (whole game playable with hands only; controllers optional)

The board is the interaction surface. Two equivalent ways to do everything, both one-handed, either hand:

- **Pinch mode (default):** pinch a piece in the tray (near grab, `OneHandGrabbable` with hand pinch), carry it, and
  release over the board; it snaps to the nearest valid `build` cell within 1 cell of the release point, otherwise
  returns to the tray. Pinch-tap a placed piece to rotate it; pinch-tap a lock to change its wait; pinch-hold 0.6 s to
  remove. Pinch-drag the tide dial.
- **Poke mode (accessibility, also works at once):** poke a tray piece to select it (it lifts and glows), poke a cell to
  place. Poke a placed piece to rotate; poke-and-hold to remove. ◀ ▶ buttons step the dial.
- Buttons are large (≥ 4 cm), have visible press depth, a sound, and trigger once per press (debounced on contact
  leave), never on hover.
- Tracking loss mid-drag: the carried piece returns to the tray after 0.5 s without a hand; no duplicate placement, no
  stuck state.
- No velocity-sensitive gestures, no two-hand requirements, no gaze requirement. Quest 3 has no eye tracking: do not
  claim gaze interaction. Head direction is only used to keep the mission card in comfortable view.

## 5. Placement, comfort, field of view

- On entering XR, the board appears ~0.45 m in front of the player and ~0.35 m below eye height, tilted 15° towards
  them, on an invisible table plane. A small "Move board" handle (pinch-drag, or poke arrows) and "Reach: near / far"
  setting adjust it. Board stays world-locked when the head moves.
- Tray, dial and board sit within ±30° horizontally of the board centre and below eye line. The mission card (launch,
  undo, tide steps, settings) stands beside the board, past the dial on the widest board, turned toward that shoulder:
  within the emulator's comfortable fingertip reach of that shoulder without leaning (`tests/xr/11-seated-reach`).
  It is right-hand by default; Settings moves it to the left. Reading it means a glance or head turn of about 45°.
  (It first floated above the board's far edge, about 0.8 m from the shoulder: out of seated reach.)
- Passthrough (mode `ar`): the real room is visible; the archipelago is a diorama on it. If AR is not supported,
  fall back to VR with a simple soft-gradient room (feature-detected, not assumed).
- Desktop fallback (no XR): the same scene is playable with a mouse (click = poke) so a judge without a headset can try
  it in a normal browser. Lower priority than XR.

## 6. Content

### Campaign (9 missions, ~25 minutes for a first-time player)
1. **First Letter** — one boat, one bend needed, no tide. Teaches pinch-place. (≤ 50 s for a new player.)
2. **Two Shapes** — two boats, two docks; teaches rotation and shape matching.
3. **Low Water** — a bar blocks the obvious route at low tide; teaches scrubbing the dial.
4. **The Lock** — must wait 2 ticks for the tide; teaches the lock.
5. **Crossing** — two routes cross; avoid a collision with timing.
6. **Narrow Budget** — few pieces; reuse fixed channels.
7. **Spring Tide** — a long tide cycle; two bars with different thresholds.
8. **Three Villages** — three boats, staggered launches.
9. **Lighthouse** — the finale: four boats, every mechanic; lights the lighthouse and the whole archipelago.

Each mission must be solvable (its stored solution passes) and must **not** be solvable trivially (tests check that the
empty board fails). Missions 1–4 also carry a one-line coach prompt shown near the relevant object.

### Daily remix (Reason to Come Back)
- One puzzle per calendar day, generated deterministically from the local date (seeded PRNG) by mutating a verified
  template (shift bars, change thresholds, swap dock shapes, adjust budget), then checked by the solver; if not
  solvable within the search limit, take the next seed. Same date → same puzzle for everyone.
- Shows the streak (consecutive days solved) and a best result (pieces, arrival tick). Stored locally.

### Progress
- `localStorage` (every access in try/catch; the game works without storage): missions completed, stars, villages
  lit, daily streak, settings (mode, reach, sound). A "Reset progress" option in settings.
- The archipelago is the progress map: each solved mission lights its village permanently.

## 7. First five minutes (target the special prize)
- 0:00–0:20 — enter XR from a single big "Play" button; the board fades in on the table with one boat, one dock and a
  glowing bend in the tray. Coach line: "Pinch the bend and drop it in the glowing square."
- by 0:50 — first delivery: boat sails, village lights, a soft bell. Mission 2 slides in without a menu.
- minute 2 — a bar blocks the way; coach: "Turn the tide dial to see what the sea will do." The failure is visible in
  the preview before the player launches.
- minute 3 — the lock arrives.
- minute 4 — mission 5 without coaching; hint button available.
- minute 5 — mission card offers the next mission and reveals the daily remix and the map of villages.
- Text: max ~10 words per coach line, always paired with a highlight on the target object. Colour is never the only
  cue (shapes on boats and docks, icons on buttons). Sound is never the only cue (animation too).

## 8. Look and sound (no artist; procedural only)
- Palette: warm paper-and-sea diorama (sand, slate rock, teal water, white sails, ochre roofs), soft lighting. Water is
  a single animated shader plane whose height follows the tide; bars are sand shapes that emerge.
- Islands: extruded rounded shapes; villages: 3–5 instanced box-and-prism houses that switch to emissive windows when
  lit. Boats: hull + sail from primitives, coloured with a shape emblem on the sail.
- Feedback: piece snap pulse, ghost-boat trail during preview, ripple on launch, particles on delivery.
- Audio via Web Audio, generated in code (no samples needed): snap click, dial ticks, launch whoosh, dock bell, gentle
  ambient sea. Audio starts only after the first user gesture. Mute toggle.
- Budgets: initial payload ≤ 8 MB, ≤ 100 draw calls (instancing), 72 fps target; avoid real-time shadows except one
  cheap blob shadow per boat.

## 9. Architecture
- `src/game/` — pure TypeScript, **no IWSDK or Three imports**: types, mission schema + loader, simulation (`simulate
  (board, mission) → TickFrame[] + outcome`), actions + undo/redo stack, solver (bounded search over build cells), daily
  remix generator, progress store. Fully unit-tested with Vitest.
- ECS layer (`src/systems/`, `src/components.ts`): board view, tray, dial, buttons, boats animation, coach, audio,
  placement. Systems read game state and dispatch actions; they never compute game rules.
- Follow the scaffold's rules in `AGENTS.md`, `.claude/rules/` and `.agents/skills/` (import Three from `@iwsdk/core`,
  components in a system-free module, `iwsdk.config.json` is the authority, `entity.dispose()`).
- Telemetry: `@meta-quest/metavr` is a dev dependency from the template. Find out what it sends and when; if it reports
  usage, disable it (config/env) or remove it, and say which in the README.

## 10. Verification (no headset; IWER emulator only)
- Unit: simulation rules (one test per failure kind and for success), resolution order, lock waits, tide/bar
  thresholds, undo/redo, budget, every mission's stored solution succeeds and its empty board fails, preview ≡ launch
  (same frames), daily remix determinism + solvability, storage failure tolerance.
- Emulator acceptance (`npx @iwsdk/cli` with `xr run-sequence`, saved as JSON in `tests/xr/`, run by a script that
  prints pass/fail by querying ECS/game state, plus runtime screenshots to `output/xr/`):
  1. Enter XR with hands; board placed in front, stays put when the head turns.
  2. Pinch-carry-release a piece onto a build cell, right hand then left hand; exactly one placement; near miss returns
     it to the tray.
  3. Poke mode: select + place + rotate with one hand, no pinch.
  4. Scrub the dial; board state unchanged; ghost positions equal the simulation frames.
  5. Launch → success on mission 1; launch → aground on mission 3 with the reason shown; undo restores the board.
  6. Tracking loss mid-carry: no stuck piece, no duplicate.
  7. Complete missions 1–3 entirely by scripted hand input.
- Build: `npm run typecheck`, `npm test`, `npm run build`; the production build served by `vite preview` over HTTPS
  enters XR in the emulator (no dev bridges required).

## 11. Delivery
- GitHub Pages from `dist/` (relative `base`), via a GitHub Action. HTTPS by default. No accounts, no backend.
- README for judges: what it is, how to play (hands), the URL, what was verified in the emulator and what was not
  (no headset was used; comfort and real tracking are unverified), how it was built (Codex from this spec, Claude Code
  verifying), licence MIT.
- Video ≤ 3 min recorded from the emulator, labelled as emulator footage.

## 12. Cut order if late
Shareable postcards → ambient music layers → desktop fallback polish → missions 8–9 (keep 7) → daily-remix streak
display (keep the puzzle). Never cut: undo, preview≡launch, hands-only completion, onboarding, tracking-loss recovery.

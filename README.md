# Tidekeeper

A seated, hands-only mixed-reality puzzle for Meta Quest 3, built with IWSDK 1.1 (WebXR).

**Play:** https://aschenbath.github.io/tidekeeper/ (Meta Quest Browser, or any desktop browser with **Play in browser**).

A tiny archipelago floats in front of you at table height. Letters must reach the villages before the tide shuts the canals.
Place channel pieces, scrub time forward to see exactly what the sea will do, then launch the boats and watch your
plan work. Every delivery lights another village; finishing the ninth mission lights the lighthouse.

## How to play

1. Put channel pieces from the tray onto the empty squares: pinch and carry, or poke a piece and then a square.
2. Turn the tide ring (or poke ◀ ▶) to preview every boat, tick by tick. Problems show as a red marker with one line
   of explanation.
3. Press **Launch**. The run plays exactly what the preview showed.

Poke or pinch-tap a placed piece to rotate it, tap a lock to change how long it holds a boat, hold for 0.6 s to take a
piece back. Undo, redo, restart and hints are always one press away.

## Try it

- **Quest 3:** open the page in the Meta Quest Browser and press **Play**. It starts in mixed reality (passthrough)
  when available, VR otherwise. Designed and tested for hands; controllers are not part of the tested flow, and while one is in use the hint line under the board asks you to set it down.
- **No headset:** open the same page on a desktop browser. **Play in browser** shows the board and lets the mouse
  act as a fingertip. Developers can use IWSDK's [IWER emulator](https://iwsdk.dev/guides/02-testing-experience.html)
  for the full XR flow.

## What's inside

- **Campaign:** 9 missions on an archipelago map. Each adds one idea: two shapes, low water, locks, a crossing,
  a tight budget, a spring tide with two sandbars, four boats, and the lighthouse finale on a 7×6 board. Each mission
  has a piece budget and an optional mastery star (fewest pieces, fastest arrival, or no locks).
- **Daily tide:** a new puzzle every day, remixed from five templates with a date-seeded generator (mirroring, tide
  shift, thresholds, launch times, shape shuffle). Every candidate is checked by a solver that enumerates all working
  boards: it must be solvable, must not be solvable by the template's answer, and must need more than straights.
  Your streak and today's best are kept.
- **Deterministic rules:** a pure, tick-based simulation with no physics engine. The preview, the launch and the
  solver all run the same function, so what you predict is what happens. Failures are explicit: aground, dead end,
  collision, wrong dock, out of time.
- **Progress:** stored locally (the game still works when storage is blocked). Settings for reach, panel side and sound; reset
  with a confirm step.

## Accessibility

- Everything works one-handed with either hand. Poke mode needs no pinch at all.
- No fast or two-handed gestures, no gaze requirement. Large buttons with visible press depth; each press fires once.
- Boats and docks carry matching shape emblems (circle, triangle, square, diamond), never colour alone.
- Every sound has a visual equivalent, and sound can be turned off.
- The mission card stands beside the board, within seated reach of that hand. The entry card (before Play) or
  Settings puts it on the left for left-handed play. While a hand holds a piece or the dial the card takes no input,
  and a finger already on it must lift before it presses again. Reach (near/far) and a move control adjust the board.
- A delivery pauses whenever the headset session is not fully visible; a refused session request is explained on the
  entry card.

## Tech

TypeScript, [IWSDK](https://iwsdk.dev) 1.1.0-rc.2 (three.js, ECS, WebXR), UIKit for the panels, Vitest.
All models are built from primitives in code and all audio is synthesized with Web Audio: no downloaded art, audio
or fonts from third-party CDNs, no accounts, no analytics.

```sh
npm ci
npm test            # rules, solver, missions, daily remix, progress, models
npm run typecheck
npm run build       # dist/
npm run build:pages # dist/ for a GitHub Pages project site at /tidekeeper/
```

Hand-input acceptance runs in the IWER emulator through the IWSDK CLI:

```sh
npx @iwsdk/cli dev up --headless --ai-mode agent
npx @iwsdk/cli dev status   # wait for browserCommandReady: true
npm run test:xr             # writes output/xr/acceptance.txt and screenshots
```

The scenarios in `tests/xr/` drive simulated hands (poke, pinch, carry, tracking loss, hold-to-remove) through the
real game. `11-seated-reach` fixes the emulator's body (no lean, no walking) and plays mission 1, switches the panel
side and toggles reach with each hand, so an out-of-reach control fails the run. Dev-only helpers may set up a board, but every launch is pressed by a hand. The debug surface is not in
production builds.

## Submission capture

`node scripts/trailer.mjs` records the video footage and gallery stills from real IWER hand input against the running
dev server; `bash ../media/assemble.sh` cuts them into a silent 1920×1080 video. For a readable 16:9 frame it
uses a downward head pose; the layout is the shipped one. Later missions start from seeded progress and `GameDebug` boards, but every launch is pressed by a hand.
Each run writes a manifest of hand events and state checks. Stages can be rerun with `--only=<stage>`; see the header
of `scripts/trailer.mjs` for options.

## Limits

Built and tested in the emulator; comfort, real passthrough and real hand tracking still need a check on a headset.

## Credits

Built with substantial AI assistance: the spec, code, missions and tests were produced with OpenAI Codex and
Anthropic Claude Code. All visuals and sounds are procedural.

MIT license.

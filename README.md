# Tidekeeper — vertical slice

A seated, hands-only canal puzzle built with IWSDK 1.1.0-rc.2. The first four
missions use the existing deterministic game core and unchanged mission JSON.

Press **Play** to enter XR (an immersive session); AR is offered when supported,
with VR as the fallback. Pinch a tray piece, carry it, and release over a build
square. Alternatively, poke a tray piece and then a square. Poke or pinch-tap a
placed piece to rotate it; a lock tap cycles its wait. Hold for 0.6 seconds to
remove. Scrub the tide ring or poke its arrow buttons, then Launch. Undo,
pause/stop, hints, Next, reach settings, and a move handle/arrows are available.
The browser fallback uses mouse clicks as pokes.

```sh
npm ci
npm run typecheck
npm test
npx @iwsdk/cli dev up --headless --ai-mode agent
npx @iwsdk/cli dev status
node scripts/xr-accept.mjs
npx @iwsdk/cli dev down
npm run build
npm run preview -- --host 127.0.0.1 --port 8181
# In another terminal, while HTTPS preview is running:
node scripts/production-smoke.mjs
```

Wait for `browserCommandReady: true` before acceptance. IWER is IWSDK's
[browser XR emulator](https://iwsdk.dev/guides/02-testing-experience.html).
The saved JSON scenarios and shared assertion engine live in `tests/xr/` and
`scripts/xr-engine.mjs`. They inspect a read-only dev snapshot through ECS (the
entity-component system), never change game state through a test API. That debug
surface is omitted from production. The CLI runner returns a nonzero status on
failure and writes `output/xr/acceptance.txt`.

All visuals are procedural, including local instanced hand joints and optional
controller grips. A tiny local hand rig replaces the SDK's default CDN model
requests. Fonts and UI files are served locally; audio is generated with Web
Audio after Play. There are no accounts or external game requests.

The scaffold's `@meta-quest/metavr` 1.10.0 was removed. Its inspected JS package
downloads a platform native binary during installation/first invocation,
generates completions and can update shell profiles; its CLI wrapper runs that
binary. It was not imported by the game or build. The wrapper alone does not
establish what telemetry the native binary sends, so this project excludes it
rather than making an unsupported telemetry claim.

See [REPORT.md](REPORT.md) for acceptance output, screenshots and limits.
No physical headset was used; comfort, real passthrough and real tracking remain
unverified. Daily remix, persistent progress, missions 5–9 and presentation polish
are for the next round. MIT license; no deployment was made in this round.

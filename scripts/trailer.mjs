/** Reproducible IWER footage. Uses a separate bundled Chromium, never the managed browser. */
import { chromium } from 'playwright';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { renderCards } from './trailer-cards.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const media = resolve(project, process.env.TIDEKEEPER_MEDIA_DIR ?? '../media');
const origin = process.env.TIDEKEEPER_CAPTURE_ORIGIN ?? 'https://127.0.0.1:8081';
const date = process.env.TIDEKEEPER_CAPTURE_DATE ?? '2026-11-01';
const ffmpeg = process.env.TIDEKEEPER_FFMPEG ?? 'D:/WeFlow/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe';
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7).split(',');
const stages = ['cards', 'flow', 'aground', 'crossing', 'map', 'finale', 'daily'];
if (only?.some(s => !stages.includes(s))) throw Error(`--only accepts: ${stages.join(',')}`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('Capture date must be YYYY-MM-DD');
if (!existsSync(ffmpeg)) throw Error(`Missing ffmpeg: ${ffmpeg}`);
mkdirSync(media, { recursive: true });
const work = resolve(media, '.capture-work');
mkdirSync(work, { recursive: true });
const reportPath = resolve(media, 'capture-manifest.json');
const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : { stages: {} };
Object.assign(report, {
  format: 1, date, origin, resolution: [1920, 1080], audio: 'silent',
  disclosure: 'Recorded in the IWSDK emulator; not yet tested on a physical Quest. Built with AI assistance (OpenAI Codex, Anthropic Claude Code).',
  fixtures: 'Fresh save for flow. Later stages seed preceding campaign unlocks, then select menus and launch with emulated hands. GameDebug prepares specified boards. Daily earns a real one-day streak at a fixed capture date. No mission or rule changes.',
  framing: { headset: [0.23, 1.78, -0.02], lookAt: [0.23, 1.32, -0.48], verticalFov: 56, stereo: false, environment: 'sunlit_living_room', panel: 'Existing mission panel placed beside the board in this dev-only capture session; shipped layout unchanged.' },
});
function saveReport() { writeFileSync(`${reportPath}.tmp`, JSON.stringify(report, null, 2) + '\n'); renameSync(`${reportPath}.tmp`, reportPath); }
function assert(ok, message) { if (!ok) throw Error(message); }
function ff(args) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 4_000_000 });
  if (r.error || r.status !== 0) throw Error(r.error?.message ?? r.stderr);
}
function duration(path) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-i', path], { encoding: 'utf8', windowsHide: true });
  const m = r.stderr?.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  assert(m, `Cannot probe duration: ${path}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
copyFileSync(resolve(project, 'scripts/assemble-trailer.sh'), resolve(media, 'assemble.sh'));
saveReport();
console.log(`Output: ${media}`);
const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=d3d11'] }); // Bundled Chromium, Windows hardware rendering.
try {
  for (const name of stages.filter(s => !only || only.includes(s))) {
    console.log(`START ${name}`);
    report.stages[name] = { complete: false, stills: [], clips: [], inputs: [], assertions: [] }; saveReport();
    if (name === 'cards') {
      report.stages[name].stills = await renderCards(browser, media);
      report.stages[name].complete = true; saveReport();
    } else {
      try { await captureStage(name); }
      catch (error) { console.error(`FAILED ${name}: ${error.message}`); process.exitCode = 1; continue; }
    }
    console.log(`SAVED ${name}`);
  }
} finally {
  await browser.close();
  if (!readdirSync(work).length) rmdirSync(work);
  report.files = readdirSync(media).filter(n => statSync(resolve(media, n)).isFile() && n !== 'capture-manifest.json')
    .map(file => ({ file, bytes: statSync(resolve(media, file)).size, ...(/\.(mp4|webm)$/.test(file) ? { seconds: duration(resolve(media, file)) } : {}) }));
  saveReport();
}

async function captureStage(name) {
  const entry = report.stages[name], pending = [], errors = [];
  const context = await browser.newContext({
    ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
    timezoneId: 'Asia/Shanghai', recordVideo: { dir: work, size: { width: 1920, height: 1080 } },
  });
  // Fresh contexts never touch the developer's save. Only campaign unlocks are fixtures.
  const unlocked = { flow: 0, aground: 2, crossing: 4, map: 8, finale: 8, daily: 8 }[name];
  await context.addInitScript(count => {
    const missions = Object.fromEntries(Array.from({ length: count }, (_, i) => [`m0${i + 1}`, { stars: 3, pieces: 8, tick: 9 }]));
    localStorage.setItem('tidekeeper.progress.v1', JSON.stringify({ version: 1, missions, daily: { lastSolved: null, streak: 0, best: {} }, settings: { reach: 'near', sound: false } }));
  }, unlocked);
  const page = await context.newPage(), video = page.video();
  // Fix Date only; timers, RAF and gameplay retain real time.
  await page.clock.setFixedTime(new Date(`${date}T12:00:00+08:00`));
  page.on('pageerror', e => errors.push(e.message));
  const remote = (method, params = {}) => page.evaluate(({ method, params }) => window.IWER_DEVICE.remote.dispatch(method, params), { method, params });
  const ecs = (method, params = {}) => page.evaluate(({ method, params }) => window.FRAMEWORK_MCP_RUNTIME.dispatch(method, params), { method, params });
  const state = () => page.evaluate(() => window.__tidekeeper);
  const check = (ok, message) => { assert(ok, message); entry.assertions.push(message); saveReport(); };
  const wait = ms => page.waitForTimeout(ms);
  const sequence = async (steps, body = 'fixed') => {
    const result = await remote('run_sequence', { device: 'hand-right', body, gaze: 'fixed', idleHand: 'keep', steps });
    entry.inputs.push({ steps, result }); saveReport();
    assert(result.completed && !result.cancelled, `Hand sequence failed: ${JSON.stringify(result)}`);
    return result;
  };
  const press = async target => {
    const result = await sequence([{ target: /^(Tray_|Cell_|Piece_)/.test(target) ? { name: target, face: 'top' } : target, press: { hold: 0.07 } }], 'auto');
    assert(result.presses?.length === 1, `Missing fingertip contact: ${target}`); await wait(150);
  };
  let camera;
  const park = async () => {
    const hand = await remote('get_hand_state', { device: 'hand-right' }), tip = hand.anchors['index-tip'];
    // Leave the panel along its outward normal before moving toward the lap; don't brush lower buttons.
    await remote('animate_to', { device: 'hand-right', anchor: 'index-tip', position: { x: tip.x, y: tip.y + 0.14, z: tip.z + 0.20 }, duration: 0.25 });
    await remote('animate_to', { device: 'hand-right', anchor: 'wrist', position: { x: 0.38, y: 1.05, z: 0.35 }, duration: 0.5 });
    await remote('animate_to', { device: 'headset', position: camera.position, orientation: camera.orientation, duration: 0.35 });
  };
  let debugIndex;
  const setup = async command => {
    if (debugIndex === undefined) debugIndex = (await ecs('ecs_find_entities', { withComponents: ['GameDebug'] })).entities[0].entityIndex;
    await ecs('ecs_set_component', { entityIndex: debugIndex, componentId: 'GameDebug', field: 'command', value: JSON.stringify(command) });
    await wait(300); assert(!(await state()).status.includes('Test setup failed'), 'GameDebug setup failed');
  };
  const still = async (file, predicate) => {
    const s = await state(); assert(predicate(s), `Wrong state for ${file}: ${s.mission}/${s.phase}/${s.tick}`);
    assert(s.view !== 'settings', `Unexpected settings view in ${file}`);
    assert((await remote('get_session_status')).sessionActive, 'Still requires active XR');
    await page.screenshot({ path: resolve(media, file) });
    entry.stills.push({ file, bytes: statSync(resolve(media, file)).size, state: s }); saveReport(); console.log(`STILL ${file}`);
  };
  const clip = async (file, seconds, action) => {
    const started = Date.now(); await action();
    await wait(Math.max(0, seconds * 1000 - (Date.now() - started)));
    const ended = Date.now(); assert(ended - started < 20_000, `${file} exceeded 20 s; source retained`);
    pending.push({ file, started, ended }); entry.pendingClips = pending; saveReport();
  };
  let ended, completed = false;
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => window.__tidekeeper && window.IWER_DEVICE?.activeSession);
    await remote('set_device_state', { state: { inputMode: 'hand', stereoEnabled: false, fov: 56 } });
    await page.evaluate(() => {
      const ui = window.IWER_DEVICE.devui;
      if (ui) { ui.devUIContainer.style.display = 'none'; ui.render = () => {}; }
      // Existing DEV-only runtime hook. This changes presentation in this disposable page only.
      if (!window.__tidekeeper) throw Error('Capture layout requires the dev-only GameDebug surface');
      const panel = window.FRAMEWORK_MCP_RUNTIME.world.requireSceneObject('game-panel');
      panel.position.set(0.49, 0.12, 0);
      panel.rotation.set(-70 * Math.PI / 180, 0, 0);
    });
    await remote('set_transform', { device: 'headset', position: { x: 0.23, y: 1.78, z: -0.02 } });
    await remote('look_at', { device: 'headset', target: { x: 0.23, y: 1.32, z: -0.48 } });
    camera = await remote('get_transform', { device: 'headset' });
    for (const side of ['left', 'right']) await remote('set_transform', { device: `hand-${side}`, anchor: 'wrist', position: { x: side === 'left' ? -0.4 : 0.4, y: 1.05, z: 0.35 } });
    await setup({ autoAdvance: false }); await wait(1200);
    entry.session = await remote('get_session_status');
    check(entry.session.sessionMode === 'immersive-ar' && entry.session.runtimeKind === 'emulated', 'Active emulated AR with hands');
    if (name === 'flow') {
      const tray = (await ecs('ecs_find_entities', { namePattern: 'Tray_bend' })).entities[0];
      check(tray.componentIds.some(id => id.endsWith('OneHandGrabbable')), 'Tray bend has OneHandGrabbable');
      await clip('01-pinch-carry.webm', 8, async () => {
        await wait(600);
        await sequence([
          { target: 'Tray_bend', approach: { distance: 0.06 }, pinch: { value: 1, at: 'arrival' }, duration: 1.1 },
          { target: 'Cell_2_1', depart: { distance: 0.08 }, approach: { distance: 0.06 }, duration: 1.8 },
        ], 'auto');
        const held = await state(); check(held.carried.length === 1 && held.carried[0].hand === 'right', 'Right pinch carries the bend');
        await wait(500); await sequence([{ pinch: 0, duration: 0.3 }]); await wait(300);
        const placed = await state(); check(placed.placements.length === 1 && placed.placements[0].rot === 2 && !placed.carried.length, 'Release places one correctly oriented bend');
        await park();
      });
      const preview = (await state()).frames;
      await press('TideForward'); await press('TideForward'); await park();
      await still('01-route-preview.png', s => s.tick === 2 && s.phase === 'editing');
      await clip('02-first-delivery.webm', 8, async () => {
        await wait(600); await press('Launch');
        await page.waitForFunction(() => window.__tidekeeper.phase === 'running' && window.__tidekeeper.tick >= 1, null, { timeout: 8000 });
        await still('02-first-delivery-in-progress.png', s => s.phase === 'running');
        await park();
        await page.waitForFunction(() => window.__tidekeeper.phase === 'success', null, { timeout: 10000 });
        check(JSON.stringify((await state()).frames) === JSON.stringify(preview), 'First delivery matches cached preview frames');
        await still('03-first-village-lit.png', s => s.phase === 'success' && s.frame.boats.some(b => b.status === 'docked'));
      });
    } else if (name === 'aground') {
      await press('Mission3'); await park();
      check((await state()).view === 'game', 'Mission 3 stays in game view after the hand withdraws');
      await setup({ board: [{ x: 1, y: 1, piece: 'straight', rot: 1 }, { x: 2, y: 1, piece: 'straight', rot: 1 }] });
      // Use the authored panel placement for the ring close-up, then return to the gallery framing.
      const heroCamera = camera;
      await page.evaluate(() => { const p = window.FRAMEWORK_MCP_RUNTIME.world.requireSceneObject('game-panel'); p.position.set(0, 0.23, -0.32); p.rotation.set(-40 * Math.PI / 180, 0, 0); });
      await remote('set_device_state', { state: { fov: 68 } });
      await remote('set_transform', { device: 'headset', position: { x: 0, y: 1.75, z: 0.02 } });
      await remote('look_at', { device: 'headset', target: { x: 0, y: 1.42, z: -0.48 } });
      camera = await remote('get_transform', { device: 'headset' });
      entry.ringCamera = { ...camera, fov: 68, panel: 'authored placement; assembly uses a close-up crop' };
      entry.dialGeometry = await page.evaluate(() => {
        const root = window.FRAMEWORK_MCP_RUNTIME.world.requireSceneEntity('board-root').object3D;
        root.updateWorldMatrix(true, true); const dial = root.getObjectByName('TideDial'), bounds = [];
        dial.traverse(m => { if (m.isMesh) { m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld); bounds.push({ name: m.name, min: b.min.toArray(), max: b.max.toArray(), pointerEvents: m.pointerEvents, visible: m.visible }); } });
        return { bounds, matrix: dial.matrixWorld.toArray(), pointerEvents: dial.pointerEvents };
      }); saveReport();
      // Start above the tabletop, so the resolver approaches the ring's upper surface rather than its underside.
      await remote('animate_to', { device: 'hand-right', anchor: 'grasp', position: { x: 0.215, y: 1.42, z: -0.445 }, duration: 0.6 });
      await clip('03-scrub-tide-ring.webm', 9, async () => {
        await wait(600);
        // Close on approach: touching this thin ring before closing is a poke, which the game correctly cancels as a grab.
        await sequence([{ target: 'TideDial', poseId: 'default', offset: { x: 0.025, y: 0.012, z: 0 }, approach: { distance: 0.06 }, pinch: { value: 1, start: 0.1, end: 0.4 }, duration: 1.2 }]);
        await wait(200); // Let the app consume the last emulated select frame before querying ECS.
        entry.dialHeld = await ecs('ecs_find_entities', { withComponents: ['Grabbed'] }); saveReport();
        if (!entry.dialHeld.entities.length) {
          const dial = (await ecs('ecs_find_entities', { namePattern: 'TideDial' })).entities[0];
          await ecs('ecs_pause'); await ecs('ecs_snapshot', { label: 'before' });
          await ecs('ecs_step', { count: 3, delta: 0.016 }); await ecs('ecs_snapshot', { label: 'after' });
          entry.dialProbe = { diff: await ecs('ecs_diff', { from: 'before', to: 'after' }), entity: await ecs('ecs_query_entity', { entityIndex: dial.entityIndex }), otherPressed: await ecs('ecs_find_entities', { withComponents: ['Pressed'] }), otherHovered: await ecs('ecs_find_entities', { withComponents: ['Hovered'] }) };
          await ecs('ecs_resume'); saveReport();
        }
        check(entry.dialHeld.entities.some(e => e.name === 'TideDial'), 'Pinch holds the tide ring');
        await sequence([
          { position: { x: 0.225, y: 1.29, z: -0.485 }, anchor: 'grasp', duration: 1.4 },
          { position: { x: 0.28, y: 1.30, z: -0.36 }, duration: 1.5 },
        ]);
        await wait(150);
        const s = await state(); check(s.tick >= s.outcome.tick && s.phase === 'editing' && s.outcome.failures[0].kind === 'aground', 'Pinch scrub reveals the aground preview');
        entry.scrubState = s; saveReport();
      });
      await sequence([{ pinch: 0, duration: 0.3 }]); await wait(150);
      entry.releaseTick = (await state()).tick;
      await page.evaluate(() => { const p = window.FRAMEWORK_MCP_RUNTIME.world.requireSceneObject('game-panel'); p.position.set(0.49, 0.12, 0); p.rotation.set(-70 * Math.PI / 180, 0, 0); });
      camera = heroCamera; await remote('set_device_state', { state: { fov: 56 } }); await park();
      // Use the real one-hand step controls to select the exact failure tick for the still and launch.
      for (let n = 0; n < 12 && (await state()).tick !== 3; n++) await press((await state()).tick < 3 ? 'TideForward' : 'TideBack');
      await park();
      check(JSON.stringify((await state()).frames) === JSON.stringify(entry.scrubState.frames), 'Ring preview and exact-tick preview share the same frames');
      await still('04-tide-aground-preview.png', s => s.tick >= s.outcome.tick && s.status.includes('bar is dry at tick 3'));
      const preview = (await state()).frames;
      await clip('04-launch-matches-preview.webm', 8, async () => {
        await wait(900); await press('Launch'); await park();
        await page.waitForFunction(() => window.__tidekeeper.phase === 'failure', null, { timeout: 10000 });
        const s = await state(); check(s.outcome.failures[0].kind === 'aground' && JSON.stringify(s.frames) === JSON.stringify(preview), 'Hand launch reproduces the aground preview exactly');
      });
    } else if (name === 'crossing') {
      await press('Mission5'); await park();
      check((await state()).view === 'game', 'Crossing stays in game view');
      await setup({ board: [{ x: 1, y: 2, piece: 'straight', rot: 1 }, { x: 3, y: 2, piece: 'straight', rot: 1 }, { x: 2, y: 1, piece: 'straight', rot: 0 }, { x: 2, y: 3, piece: 'straight', rot: 0 }] });
      await press('TideForward'); await press('TideForward'); await park();
      await still('05-crossing-collision-ghosts.png', s => s.phase === 'editing' && s.outcome.failures[0]?.kind === 'collision' && s.renderedGhosts.length === 2);
    } else if (name === 'map') {
      await still('06-archipelago-map.png', s => s.view === 'map' && Object.keys(s.progress.missions).length === 8);
    } else if (name === 'finale') {
      await press('Mission9'); await park(); await setup({ solution: true });
      check((await state()).view === 'game', 'Finale stays in game view');
      await clip('05-m09-finale.webm', 14, async () => {
        await wait(800); await press('Launch'); await park();
        await page.waitForFunction(() => window.__tidekeeper.phase === 'success', null, { timeout: 16000 });
        await still('07-lighthouse-finale.png', s => s.mission === 'm09' && s.phase === 'success' && s.lighthouse);
        check((await state()).lighthouse, 'm09 hand launch delivers all boats and lights the lighthouse');
      });
    } else if (name === 'daily') {
      await press('Daily'); await park(); await setup({ solution: true });
      check((await state()).view === 'game', 'Daily stays in game view');
      await clip('06-daily-tide.webm', 12, async () => {
        await wait(800); await press('Launch'); await park();
        await page.waitForFunction(() => window.__tidekeeper.phase === 'success', null, { timeout: 14000 });
        await still('08-daily-tide-streak.png', s => s.phase === 'success' && s.daily.streak === 1 && !!s.daily.best && s.dailyDate === date);
        check((await state()).daily.streak === 1, 'Daily completion earns a saved one-day streak');
      });
    }
    assert(!errors.length, `Browser errors: ${errors.join('; ')}`); completed = true;
  } catch (error) { entry.error = error.message; entry.failedState = await state().catch(() => null); saveReport(); throw error;
  } finally {
    ended = Date.now();
    await page.close(); await context.close(); // Flush real browser recording, including on failure.
    const raw = resolve(work, `${name}.webm`);
    await video.saveAs(raw); await video.delete();
    entry.rawSource = `.capture-work/${name}.webm`; saveReport();
    if (pending.length) {
      const total = duration(raw);
      for (const cut of pending) {
        // The first video frame can follow newPage(): align from the end of recording.
        const seconds = (cut.ended - cut.started) / 1000, start = Math.max(0, total - (ended - cut.started) / 1000);
        const output = resolve(media, cut.file), temporary = output.replace(/\.webm$/, '.partial.webm');
        ff(['-y', '-ss', start.toFixed(3), '-i', raw, '-t', seconds.toFixed(3), '-an', '-vf', 'fps=30,scale=1920:1080,setsar=1', '-c:v', 'libvpx-vp9', '-crf', '22', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '6', temporary]);
        renameSync(temporary, output);
        entry.clips.push({ file: cut.file, seconds: duration(output), bytes: statSync(output).size, sourceStart: start }); saveReport();
      }
    }
    if (completed) { rmSync(raw); delete entry.rawSource; delete entry.pendingClips; }
    entry.complete = completed; entry.errors = errors; saveReport();
  }
}

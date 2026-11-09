import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Run against the IWSDK dev server. Visibility events are simulated; game
// launches, resume and Next use the same emulated hand input as xr-accept.
const origin = process.env.TIDEKEEPER_DEV_ORIGIN ?? 'https://127.0.0.1:8081';
const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--use-angle=d3d11'] });

async function scenario(name, run) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 800, height: 800 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const remote = (method, params = {}) => page.evaluate(
    ({ method, params }) => window.IWER_DEVICE.remote.dispatch(method, params), { method, params });
  const state = () => page.evaluate(() => {
    const s = window.__tidekeeper;
    return { mission: s.mission, phase: s.phase, tick: s.tick };
  });
  const expect = (mission, phase) => page.waitForFunction(
    ({ mission, phase }) => window.__tidekeeper?.mission === mission && window.__tidekeeper?.phase === phase,
    { mission, phase }, { timeout: 20000 });
  const press = async target => {
    const result = await remote('run_sequence', {
      device: 'hand-right', body: 'auto', gaze: 'fixed', idleHand: 'keep',
      steps: [{ target: /^(Tray_|Cell_|Piece_)/.test(target) ? { name: target, face: 'top' } : target, press: { hold: 0.07 } }],
    });
    assert(result.completed && !result.cancelled && result.presses?.length === 1, `No hand press: ${target}`);
    await page.waitForTimeout(150);
  };
  const setup = async command => {
    await page.evaluate(async command => {
      const runtime = window.FRAMEWORK_MCP_RUNTIME;
      const { entities } = await runtime.dispatch('ecs_find_entities', { withComponents: ['GameDebug'] });
      await runtime.dispatch('ecs_set_component', {
        entityIndex: entities[0].entityIndex, componentId: 'GameDebug', field: 'command', value: JSON.stringify(command),
      });
    }, command);
    await page.waitForTimeout(300);
  };
  const documentHidden = hidden => page.evaluate(hidden => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  const xrVisibility = value => page.evaluate(value => {
    const session = window.IWER_DEVICE.activeSession;
    Object.defineProperty(session, 'visibilityState', { configurable: true, get: () => value });
    session.dispatchEvent(new XRSessionEvent('visibilitychange', { session }));
  }, value);
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => window.__tidekeeper && window.IWER_DEVICE?.activeSession);
    await remote('set_device_state', { state: { inputMode: 'hand', stereoEnabled: false } });
    await page.waitForTimeout(700);
    await run({ page, state, expect, press, setup, documentHidden, xrVisibility });
    assert.deepEqual(errors, [], 'Unexpected browser error');
    console.log(`PASS ${name}`);
  } finally {
    await context.close();
  }
}

try {
  await scenario('visible first delivery still advances automatically', async ({ setup, press, expect }) => {
    await setup({ reset: true, autoAdvance: true });
    await press('Tray_bend');
    await press('Cell_2_1');
    await press('Launch');
    await expect('m02', 'editing');
  });

  await scenario('background document pauses a run until manual resume', async ({ page, setup, press, state, expect, documentHidden }) => {
    await setup({ reset: true, solution: true, autoAdvance: false });
    await press('Launch');
    await documentHidden(true);
    await expect('m01', 'paused');
    const paused = await state();
    await page.waitForTimeout(1500);
    assert.deepEqual(await state(), paused, 'A hidden delivery moved');
    await documentHidden(false);
    await page.waitForTimeout(300);
    assert.deepEqual(await state(), paused, 'Returning resumed without a hand press');
    await press('Pause');
    await expect('m01', 'success');
  });

  for (const interruption of ['document', 'visible-blurred', 'hidden', 'session-end']) {
    await scenario(`first result survives ${interruption}; Next remains usable`, async ({ page, setup, press, state, expect, documentHidden, xrVisibility }) => {
      await setup({ reset: true, solution: true, autoAdvance: true });
      await press('Launch');
      await expect('m01', 'success');
      if (interruption === 'document') await documentHidden(true);
      else if (interruption === 'session-end') await page.evaluate(() => window.IWER_DEVICE.activeSession.end());
      else await xrVisibility(interruption);
      await page.waitForTimeout(3000);
      assert.equal((await state()).mission, 'm01', 'Hidden success advanced to mission 2');
      assert.equal((await state()).phase, 'success', 'The first result was lost');
      if (interruption === 'document') await documentHidden(false);
      else if (interruption === 'session-end') {
        await page.getByRole('button', { name: 'Play', exact: true }).click();
        await page.waitForFunction(() => !!window.IWER_DEVICE.activeSession);
      } else await xrVisibility('visible');
      await page.waitForTimeout(2700);
      assert.equal((await state()).mission, 'm01', 'Returning restarted automatic advancement');
      await press('Next');
      await expect('m02', 'editing');
    });
  }
} finally {
  await browser.close();
}

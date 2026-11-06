import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BrowserContext } from '../src/types.ts';
import BrowserActions from '../src/scraper/browser-actions.ts';
import type { StepExecutor } from '../src/scraper/step-runner.ts';

function actions(scale: number, navDelayMs = 100): BrowserActions {
  const steps: StepExecutor = { run: async (_step, action) => action() };
  return new BrowserActions({
    steps, inspector: { logFrameInputs: async () => {} },
    getNavDelayMs: () => navDelayMs, getDelayScale: () => scale, log: () => {}
  });
}

test('zero delay scale skips navigation and retry timers while preserving the DOM readiness wait', async t => {
  const timer = t.mock.method(globalThis, 'setTimeout');
  const browserActions = actions(0);
  await browserActions.preNavDelay();
  let evaluations = 0;
  let readinessWaits = 0;
  const context = {
    evaluate: async () => {
      if (++evaluations === 1) throw new Error('Execution context was destroyed');
      return 42;
    },
    waitForFunction: async () => { readinessWaits++; }
  } as unknown as BrowserContext;
  assert.equal(await browserActions.retryEvaluate(context, () => 42), 42);
  assert.equal(evaluations, 2);
  assert.equal(readinessWaits, 1);
  assert.equal(timer.mock.calls.length, 0);
});

test('positive delay scale retains configurable navigation pauses', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finished = false;
  const waiting = actions(0.5).preNavDelay().then(() => { finished = true; });
  t.mock.timers.tick(49);
  await Promise.resolve();
  assert.equal(finished, false);
  t.mock.timers.tick(1);
  await waiting;
  assert.equal(finished, true);
});

test('unrelated protocol and script errors fail immediately instead of being retried', async () => {
  for (const message of ['Protocol error (Runtime.callFunctionOn): Target closed', 'Invalid selector']) {
    const error = new Error(message);
    let evaluations = 0;
    const context = {
      evaluate: async () => { evaluations++; throw error; },
      waitForFunction: async () => { throw new Error('Unexpected readiness wait'); }
    } as unknown as BrowserContext;
    await assert.rejects(actions(0).retryEvaluate(context, () => 42), actual => actual === error);
    assert.equal(evaluations, 1);
  }
});

test('repeated context changes have bounded retries and preserve the original error', async () => {
  const error = new Error('Protocol error: Cannot find context with specified id');
  let evaluations = 0;
  let readinessWaits = 0;
  const context = {
    evaluate: async () => { evaluations++; throw error; },
    waitForFunction: async () => { readinessWaits++; }
  } as unknown as BrowserContext;
  await assert.rejects(actions(0).retryEvaluate(context, () => 42), actual => actual === error);
  assert.equal(evaluations, 3);
  assert.equal(readinessWaits, 2);
});

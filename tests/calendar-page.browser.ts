import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import ChromeScraper from '../src/scraper.ts';
import type { DebugEntry } from '../src/scraper-debug.ts';
import BrowserActions from '../src/scraper/browser-actions.ts';
import DebugInspector from '../src/scraper/debug-inspector.ts';
import CalendarPage from '../src/scraper/pages/calendar-page.ts';
import StepRunner from '../src/scraper/step-runner.ts';

async function fixture(t: TestContext) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'calendar-page-browser-'));
  const scraper = new ChromeScraper();
  t.after(async () => {
    try {
      await scraper.close();
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
  await scraper.initBrowser(2000, { headless: true, debug: true, debugDir: rootDir });
  return { scraper, page: scraper.getPage() };
}

async function journal(scraper: ChromeScraper): Promise<DebugEntry[]> {
  assert.ok(scraper.debug.directory);
  const text = await fs.readFile(path.join(scraper.debug.directory, 'steps.jsonl'), 'utf8');
  return text.trim().split('\n').map(line => JSON.parse(line) as DebugEntry);
}

test('calendar handles empty slots and next-month controls identified by title, image or handler', async (t) => {
  const { scraper, page } = await fixture(t);
  scraper.isLoggedIn = true;
  const update = `onclick="setTimeout(() => document.querySelector('#calendarHeader').textContent = 'December 2026', 30)"`;
  for (const attributes of [
    `title="Next month." ${update}`,
    `src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#dlcalendar_nextmonth_black.gif" ${update}`,
    'onclick="addMonths(event, 1)"'
  ]) {
    await page.setContent(`<!doctype html><html><body>
      <div id="calendarHeader"> November\n 2026 </div><div class="time-slot"></div>
      <img title="Previous month." style="width:20px;height:20px">
      <img style="width:20px;height:20px" ${attributes}>
      <script>function addMonths(event, amount) {
        document.querySelector('#calendarHeader').textContent = 'December 2026';
      }</script>
    </body></html>`);
    assert.equal(await scraper.getCalendarMonth(), 'November 2026');
    assert.deepEqual(await scraper.getAvailableTimeSlots(), []);
    await scraper.goToNextCalendarMonth();
    assert.equal(await scraper.getCalendarMonth(), 'December 2026');
  }
  const events = await journal(scraper);
  assert.equal(events.some(entry => entry.phase === 'error'), false);
  assert.equal(events.filter(entry => entry.step === 'next-calendar-month' && entry.phase === 'after').length, 3);
  const available = events.findIndex(entry => entry.step === 'get-available-time-slots');
  assert.deepEqual(events.slice(available, available + 6).map(entry => [entry.step, entry.phase]), [
    ['get-available-time-slots', 'before'], ['get-time-slots', 'before'],
    ['get-calendar-month', 'before'], ['get-calendar-month', 'after'],
    ['get-time-slots', 'after'], ['get-available-time-slots', 'after']
  ]);
});

test('calendar supports frame contexts and preserves authorization checks and missing-button errors', async (t) => {
  const { scraper, page } = await fixture(t);
  await assert.rejects(scraper.getTimeSlots(), /Not logged in/);
  await assert.rejects(scraper.getAvailableTimeSlots(), /Not logged in/);
  await assert.rejects(scraper.goToNextCalendarMonth(), /Not logged in/);
  await page.setContent(`<!doctype html><html><body>
    <iframe name="calendar" srcdoc="<div id='calendarHeader'>October 2026</div><img title='Next month.'>"></iframe>
  </body></html>`);
  const frame = await page.waitForFrame(frame => frame.name() === 'calendar');
  await frame.waitForSelector('#calendarHeader');
  assert.equal(await scraper.getCalendarMonth(frame), 'October 2026');
  const log = () => {};
  const inspector = new DebugInspector(log);
  const steps = new StepRunner({ getPage: () => page, getRecorder: () => scraper.debug });
  const actions = new BrowserActions({ steps, inspector, getNavDelayMs: () => 0, log });
  const calendar = new CalendarPage({ context: frame, actions, inspector, steps, log });
  const button = await calendar.waitForNextMonthButton();
  assert.equal(await button.evaluate(image => image.title), 'Next month.');
  await button.dispose();

  scraper.isLoggedIn = true;
  await page.setContent('<!doctype html><html><body><div id="calendarHeader">November 2026</div></body></html>');
  await assert.rejects(scraper.goToNextCalendarMonth(), /Failed to go to next calendar month:/);
  const failure = (await journal(scraper)).at(-1);
  assert.ok(failure);
  assert.equal(failure.step, 'next-calendar-month');
  assert.equal(failure.phase, 'error');
  assert.equal(failure.expected, 'Next month calendar image button');
  assert.equal(failure.screenshot, 'screenshot.png');
});

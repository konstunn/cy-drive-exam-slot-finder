import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import type { HTTPRequest } from 'puppeteer';
import ChromeScraper from '../src/scraper.ts';
import BrowserActions from '../src/scraper/browser-actions.ts';
import DebugInspector from '../src/scraper/debug-inspector.ts';
import CalendarPage from '../src/scraper/pages/calendar-page.ts';
import StepRunner from '../src/scraper/step-runner.ts';
import type { DebugEntry } from '../src/scraper-debug.ts';

const FIRST = ['28/12/26', '29/12/26', '30/12/26', '31/12/26', '01/01/27', '02/01/27'];
const SECOND = ['04/01/27', '05/01/27', '06/01/27', '07/01/27', '08/01/27', '09/01/27'];
const THIRD = ['11/01/27', '12/01/27', '13/01/27', '14/01/27', '15/01/27', '16/01/27'];

interface FreeSlot { day: string; time: string; color?: string }
interface SearchFixtureOptions {
  selected?: string;
  free?: FreeSlot[];
  staleColumns?: boolean;
  unknownTime?: boolean;
}

async function fixture(t: TestContext, { selected = '29/12/2026', free = [],
  staleColumns = false, unknownTime = false }: SearchFixtureOptions = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'calendar-search-'));
  const scraper = new ChromeScraper();
  t.after(async () => {
    try { await scraper.close(); } finally { await fs.rm(rootDir, { recursive: true, force: true }); }
  });
  await scraper.initBrowser(2500, { headless: true, debug: true, debugDir: rootDir });
  const page = scraper.getPage();
  page.setDefaultNavigationTimeout(10000);
  const requestedDates: string[] = [];
  const requestErrors: unknown[] = [];

  function html(requested: string): string {
    const dates = staleColumns ? FIRST : {
      '29/12/2026': FIRST, '04/01/2027': SECOND, '11/01/2027': THIRD
    }[requested];
    assert.ok(dates, `Unexpected week requested: ${requested}`);
    const rows = ['7:45', '9:00', '10:00'].map(time => `<tr>${dates.map(day => {
      const slot = free.find(slot => slot.day === day && slot.time === time);
      const content = `<h5>${slot && unknownTime ? '?' : time}</h5>`;
      return `<td background="/WebPhase1/images/drivercalendar/${slot?.color ?? (slot ? 'green' : 'red')}time.gif">
        ${slot ? `<a href="/must-not-book">${content}</a>` : content}</td>`;
    }).join('')}<td></td></tr>`).join('');
    // This matches the real layout: a nested month picker and two row-spanned
    // cells before six dated headings, then six slot cells and a trailing cell.
    return `<form name="vrmSearch" method="post" action="https://fixture.invalid/weekly">
      <input type="hidden" name="startingdate" value="2026-12-29">
      <input type="hidden" name="enddate" value="2027-01-13">
      <input name="asd" value="${requested}">
      <input type="hidden" name="h_centre" value="2">
      <input type="hidden" name="licencecategory" value="ΒΒ">
      <table><tr><td rowspan="4"><table id="calendar"><tr><th id="calendarHeader">Calendar</th></tr></table></td>
      <td rowspan="4">→</td>${dates.map(day => `<td>Ημέρα<br>${day}</td>`).join('')}<td></td></tr>
      ${rows}</table>
    </form>`;
  }

  async function respond(request: HTTPRequest): Promise<void> {
    const url = new URL(request.url());
    assert.equal(url.origin, 'https://fixture.invalid');
    if (url.pathname.startsWith('/WebPhase1/images/drivercalendar/')) {
      await request.respond({ status: 204 });
      return;
    }
    assert.equal(url.pathname, '/weekly');
    let requested = selected;
    if (request.method() === 'POST') {
      const form = new URLSearchParams(request.postData());
      assert.equal(form.get('h_centre'), '2');
      assert.equal(form.get('licencecategory'), 'ΒΒ');
      requested = form.get('asd') ?? '';
      requestedDates.push(requested);
    }
    await request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: html(requested) });
  }
  await page.setRequestInterception(true);
  page.on('request', request => {
    respond(request).catch(async error => {
      requestErrors.push(error);
      if (!request.isInterceptResolutionHandled()) await request.abort();
    });
  });
  await page.setContent('<iframe name="center" src="https://fixture.invalid/weekly"></iframe>');
  const context = await page.waitForFrame(frame => frame.name() === 'center');
  const log = () => {};
  const inspector = new DebugInspector(log);
  const steps = new StepRunner({ getPage: () => page, getRecorder: () => scraper.debug });
  const actions = new BrowserActions({ steps, inspector, getNavDelayMs: () => 100, getDelayScale: () => 0, log });
  const calendar = new CalendarPage({ context, actions, inspector, steps, log });
  await calendar.waitUntilReady();
  return { scraper, context, calendar, requestedDates, requestErrors };
}

test('nearest search resets a later page and checks every week across the year, ordering by day before time', async t => {
  const { calendar, context, requestedDates, requestErrors } = await fixture(t, {
    selected: '11/01/2027',
    free: [
      { day: '28/12/26', time: '7:45' },
      { day: '05/01/27', time: '7:45' },
      { day: '04/01/27', time: '9:00', color: 'ble' },
      { day: '04/01/27', time: '10:00' },
      { day: '11/01/27', time: '7:45' }
    ]
  });
  const from = new Date(2026, 11, 29, 8);
  assert.deepEqual(await calendar.findNearestAvailableSlot({ from }), {
    datetime: new Date(2027, 0, 4, 9), available: true
  });
  assert.deepEqual(requestedDates, ['29/12/2026', '04/01/2027']);
  assert.equal(await context.$eval('input[name="asd"]', input => input.value), '04/01/2027');
  assert.equal(from.getDate(), 29);
  assert.deepEqual(requestErrors, []);
});

test('nearest search uses weekly headings for slots without dates in links and excludes elapsed times', async t => {
  const { calendar, requestedDates, requestErrors } = await fixture(t, {
    selected: '04/01/2027',
    free: [{ day: '04/01/27', time: '7:45' }, { day: '04/01/27', time: '9:00' }]
  });
  assert.deepEqual(await calendar.findNearestAvailableSlot({ from: new Date(2027, 0, 4, 8) }), {
    datetime: new Date(2027, 0, 4, 9), available: true
  });
  assert.deepEqual(requestedDates, []);
  assert.deepEqual(requestErrors, []);
});

test('search includes the last partial week and stops at the booking end date', async t => {
  for (const hasLastDaySlot of [true, false]) {
    await t.test(String(hasLastDaySlot), async t => {
      const { calendar, requestedDates, requestErrors } = await fixture(t, {
        free: [
          { day: '14/01/27', time: '7:45' },
          ...(hasLastDaySlot ? [{ day: '13/01/27', time: '9:00' }] : [])
        ]
      });
      const found = await calendar.findNearestAvailableSlot({ from: new Date(2026, 11, 29) });
      assert.deepEqual(found, hasLastDaySlot ? { datetime: new Date(2027, 0, 13, 9), available: true } : null);
      assert.deepEqual(requestedDates, ['04/01/2027', '11/01/2027']);
      assert.deepEqual(requestErrors, []);
    });
  }
});

test('an explicit search cutoff and an empty interval avoid requests outside the requested period', async t => {
  const { calendar, requestedDates, requestErrors } = await fixture(t, {
    free: [{ day: '05/01/27', time: '7:45' }]
  });
  assert.equal(await calendar.findNearestAvailableSlot({ from: new Date(2026, 11, 29), until: new Date(2027, 0, 3, 23, 59) }), null);
  assert.equal(await calendar.findNearestAvailableSlot({ from: new Date(2027, 0, 14) }), null);
  await assert.rejects(calendar.findNearestAvailableSlot({ from: new Date(NaN) }), /Invalid slot search date range/);
  await assert.rejects(calendar.findNearestAvailableSlot({ until: new Date(NaN) }), /Invalid slot search date range/);
  await assert.rejects(calendar.goToDate(new Date(2026, 11, 28)), /outside the calendar booking period/);
  assert.deepEqual(requestedDates, []);
  assert.deepEqual(requestErrors, []);
});

test('a stale weekly response fails the search with diagnostics instead of reporting no availability', async t => {
  const { scraper, calendar, requestedDates, requestErrors } = await fixture(t, { staleColumns: true });
  await assert.rejects(calendar.findNearestAvailableSlot({ from: new Date(2026, 11, 29) }), /different week/);
  assert.deepEqual(requestedDates, ['04/01/2027']);
  assert.deepEqual(requestErrors, []);
  assert.ok(scraper.debug.directory);
  const journal = await fs.readFile(path.join(scraper.debug.directory, 'steps.jsonl'), 'utf8');
  const events = journal.trim().split('\n').map(line => JSON.parse(line) as DebugEntry);
  assert.equal(events.find(event => event.step === 'find-nearest-available-slot' && event.phase === 'error')?.screenshot, 'screenshot.png');
});

test('a non-red slot with unresolved time is an error instead of a guessed appointment', async t => {
  const { calendar, requestedDates, requestErrors } = await fixture(t, {
    free: [{ day: '29/12/26', time: '9:00' }], unknownTime: true
  });
  await assert.rejects(calendar.findNearestAvailableSlot({ from: new Date(2026, 11, 29) }), /Cannot determine the date and time/);
  assert.deepEqual(requestedDates, []);
  assert.deepEqual(requestErrors, []);
});

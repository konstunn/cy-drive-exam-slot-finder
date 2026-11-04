import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import type { HTTPRequest } from 'puppeteer';
import ChromeScraper from '../src/scraper.ts';
import type { DebugEntry } from '../src/scraper-debug.ts';

const EXISTING_EXAM_PATH = '/WebPhase1/gui/dlcalendar/CancelRebookCalendar.jsp';

async function fixture(t: TestContext, { failOpen = false } = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'existing-exam-browser-'));
  const scraper = new ChromeScraper();
  t.after(async () => {
    try {
      await scraper.close();
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
  await scraper.initBrowser(2000, { headless: true, debug: true, debugDir: rootDir });
  const page = scraper.getPage();
  await page.setRequestInterception(true);
  const requestedPaths: string[] = [];
  const requestErrors: unknown[] = [];

  // All responses are local fixtures, including the navigation to exam details.
  async function respond(request: HTTPRequest): Promise<void> {
    const url = new URL(request.url());
    requestedPaths.push(url.pathname);
    if (failOpen && url.pathname === EXISTING_EXAM_PATH) {
      await request.abort('failed');
      return;
    }

    let body: string;
    if (url.pathname === EXISTING_EXAM_PATH) {
      body = `<!doctype html><html><body>
        <button onclick="location.href='/wrong-button'">Next</button>
        <input type="submit" value="Next">
        <input type="button" value="Back" onclick="location.href='/wrong-button'">
        <script>setTimeout(() => {
          const button = document.createElement('input');
          button.type = 'button';
          button.value = ' Next ';
          button.onclick = () => { location.href = '/exam-details'; };
          document.body.append(button);
        }, 100);</script>
      </body></html>`;
    } else if (url.pathname === '/exam-details') {
      body = '<!doctype html><html><body><form id="exam-details"><select name="h_centre"><option>Nicosia</option></select></form></body></html>';
    } else {
      body = '<!doctype html><html><body>Unexpected route</body></html>';
    }
    await request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body });
  }

  page.on('request', request => {
    respond(request).catch(error => requestErrors.push(error));
  });
  return { scraper, page, requestedPaths, requestErrors };
}

async function journal(scraper: ChromeScraper): Promise<DebugEntry[]> {
  assert.ok(scraper.debug.directory);
  const text = await fs.readFile(path.join(scraper.debug.directory, 'steps.jsonl'), 'utf8');
  return text.trim().split('\n').map(line => JSON.parse(line) as DebugEntry);
}

test('existing exam requires authorization, opens the page and waits for the correct Next button', async (t) => {
  const { scraper, page, requestedPaths, requestErrors } = await fixture(t);
  await assert.rejects(scraper.navigateToCancelRebook(), /Not logged in/);
  await assert.rejects(scraper.chooseExistingExam(), /Not logged in/);
  assert.equal(requestedPaths.length, 0);
  const start = (await journal(scraper)).length;

  scraper.isLoggedIn = true;
  await scraper.navigateToCancelRebook();
  assert.equal(new URL(page.url()).pathname, EXISTING_EXAM_PATH);
  await scraper.chooseExistingExam();
  assert.equal(new URL(page.url()).pathname, '/exam-details');
  await page.waitForSelector('#exam-details');
  assert.equal(requestedPaths.filter(route => route === '/exam-details').length, 1);
  assert.equal(requestedPaths.includes('/wrong-button'), false);
  assert.deepEqual(requestErrors, []);

  const events = (await journal(scraper)).slice(start);
  assert.deepEqual(events.map(entry => [entry.step, entry.phase]), [
    ['navigate-to-cancel-rebook', 'before'], ['navigate-to-cancel-rebook', 'after'],
    ['choose-existing-exam', 'before'],
    ['wait-for-button', 'before'], ['wait-for-button', 'after'],
    ['click-element-and-navigate', 'before'], ['click-element-and-navigate', 'after'],
    ['choose-existing-exam', 'after']
  ]);
  assert.equal(events[0]?.targetUrl, `https://rtd.mcw.gov.cy${EXISTING_EXAM_PATH}`);
  const choose = events.find(entry => entry.step === 'choose-existing-exam');
  assert.equal(choose?.expected, 'input[type=button] with value Next');
});

test('existing exam preserves the navigation error and failure diagnostics', async (t) => {
  const { scraper, requestedPaths, requestErrors } = await fixture(t, { failOpen: true });
  scraper.isLoggedIn = true;
  await assert.rejects(scraper.navigateToCancelRebook(), /Failed to navigate to calendar:.*ERR_FAILED/);
  assert.ok(requestedPaths.includes(EXISTING_EXAM_PATH));
  assert.equal(requestedPaths.includes('/exam-details'), false);
  assert.deepEqual(requestErrors, []);

  const events = await journal(scraper);
  const failure = events.find(entry => entry.step === 'navigate-to-cancel-rebook' && entry.phase === 'error');
  assert.ok(failure);
  assert.match(failure.error?.message ?? '', /Failed to navigate to calendar:/);
  assert.equal(failure.targetUrl, `https://rtd.mcw.gov.cy${EXISTING_EXAM_PATH}`);
  assert.equal(failure.screenshot, 'screenshot.png');
});

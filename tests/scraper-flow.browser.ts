import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { HTTPRequest } from 'puppeteer';
import ChromeScraper from '../src/scraper.ts';
import type { DebugEntry } from '../src/scraper-debug.ts';

const ORIGIN = 'https://rtd.mcw.gov.cy';
const EXISTING_EXAM_PATH = '/WebPhase1/gui/dlcalendar/CancelRebookCalendar.jsp';
const SESSION_COOKIE = 'fixture_session=scraper-flow';
const PIXEL = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function calendar(month: 'November' | 'December'): string {
  const date = month === 'November' ? '10/11/2026' : '02/12/2026';
  return `<!doctype html><html><body>
    <div id="calendarHeader">${month} 2026</div>
    <table class="time-slot"><tr>
      <td background="/WebPhase1/images/drivercalendar/greentime.gif">
        <a href="/slot?calendarday=${encodeURIComponent(date)}&amp;examtime=09%3A30"><h5>09:30</h5></a>
      </td>
      <td background="/WebPhase1/images/drivercalendar/redtime.gif">
        <a href="/slot?calendarday=${encodeURIComponent(date)}&amp;examtime=10%3A00"><h5>10:00</h5></a>
      </td>
    </tr></table>
    <img title="Next month." src="data:image/gif;base64,${PIXEL}" style="width:20px;height:20px"
      onclick="location.href='/calendar?month=2026-12'">
  </body></html>`;
}

test('scraper completes login, exam selection, details and two calendar months in one session', async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scraper-flow-browser-'));
  const scraper = new ChromeScraper();
  t.after(async () => {
    try {
      if (scraper.browser) await scraper.close();
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
  await scraper.initBrowser(5000, { headless: true, debug: true, debugDir: rootDir });
  const page = scraper.getPage();
  const creds = { username: 'flow-fixture-user', password: 'flow-fixture-password<&"' };
  const exam = { centerCity: 'Limassol', carPlateNumber: 'FLOW-123' };
  const routes: string[] = [];
  const rejectedRequests: string[] = [];
  const requestErrors: unknown[] = [];
  const loginForms: URLSearchParams[] = [];
  const examForms: URLSearchParams[] = [];
  let stage: 'anonymous' | 'logged-in' | 'existing-exam' | 'exam-details' | 'calendar' = 'anonymous';

  // The real browser handles forms, navigation and cookies. Every response is
  // fulfilled in memory, and protected routes enforce the fixture's session.
  async function respond(request: HTTPRequest): Promise<void> {
    const url = new URL(request.url());
    if (url.protocol === 'data:') {
      assert.equal(url.href, `data:image/gif;base64,${PIXEL}`);
      await request.continue();
      return;
    }
    assert.equal(url.origin, ORIGIN);
    if (url.pathname.startsWith('/WebPhase1/images/drivercalendar/')) {
      await request.respond({ status: 200, contentType: 'image/gif', body: Buffer.from(PIXEL, 'base64') });
      return;
    }
    if (url.pathname === '/favicon.ico') {
      await request.respond({ status: 204 });
      return;
    }
    const route = `${request.method()} ${url.pathname}${url.search}`;
    routes.push(route);
    const form = new URLSearchParams(request.postData());
    const reply = (body: string, headers: Record<string, string> = {}) => request.respond({
      status: 200, contentType: 'text/html; charset=utf-8', headers, body
    });
    if (route === 'GET /') {
      await reply('<!doctype html><html><body><iframe name="top" src="/TPRTDLogo.jsp"></iframe></body></html>');
      return;
    }
    if (route === 'GET /TPRTDLogo.jsp') {
      await reply(`<!doctype html><html><body><form method="post" action="/session">
        <input name="h_USERNAME"><input name="h_PASSWORD" type="password">
        <input type="submit" name="h_LOGIN" value="Login">
      </form></body></html>`);
      return;
    }
    if (route === 'POST /session') {
      assert.equal(stage, 'anonymous');
      assert.equal(form.get('h_USERNAME'), creds.username);
      assert.equal(form.get('h_PASSWORD'), creds.password);
      loginForms.push(form);
      stage = 'logged-in';
      await reply(`<!doctype html><html><body>Welcome ${creds.username}</body></html>`, {
        'set-cookie': `${SESSION_COOKIE}; Path=/; HttpOnly; Secure; SameSite=Lax`
      });
      return;
    }
    if (!request.headers()['cookie']?.split(';').some(cookie => cookie.trim() === SESSION_COOKIE)) {
      rejectedRequests.push(route);
      await request.respond({ status: 401, body: 'Session required' });
      return;
    }
    if (route === `GET ${EXISTING_EXAM_PATH}`) {
      assert.equal(stage, 'logged-in');
      stage = 'existing-exam';
      await reply(`<!doctype html><html><body>
        <input type="button" value="Next" onclick="location.href='/exam-details'">
      </body></html>`);
      return;
    }
    if (route === 'GET /exam-details') {
      assert.equal(stage, 'existing-exam');
      stage = 'exam-details';
      await reply(`<!doctype html><html><body><form method="post" action="/calendar">
        <select name="h_centre"><option value="NIC">Nicosia</option><option value="LIM">Limassol</option></select>
        <input name="h_vrm">
        <input type="button" id="submitBtn" value="Search" onclick="this.form.submit()">
      </form></body></html>`);
      return;
    }
    if (route === 'POST /calendar') {
      assert.equal(stage, 'exam-details');
      assert.equal(form.get('h_centre'), 'LIM');
      assert.equal(form.get('h_vrm'), exam.carPlateNumber);
      examForms.push(form);
      stage = 'calendar';
      await reply(calendar('November'));
      return;
    }
    if (route === 'GET /calendar?month=2026-12') {
      assert.equal(stage, 'calendar');
      await reply(calendar('December'));
      return;
    }
    throw new Error(`Unexpected fixture route: ${route}`);
  }

  await page.setRequestInterception(true);
  page.on('request', request => {
    respond(request).catch(async error => {
      requestErrors.push(error);
      if (!request.isInterceptResolutionHandled()) {
        await request.abort().catch(abortError => requestErrors.push(abortError));
      }
    });
  });

  assert.equal(scraper.isLoggedIn, false);
  await scraper.login(creds);
  assert.equal(scraper.isLoggedIn, true);
  await scraper.navigateToCancelRebook();
  assert.equal(rejectedRequests.length, 0);
  await scraper.chooseExistingExam();
  assert.deepEqual(await scraper.getExamCityCenters(), ['Nicosia', 'Limassol']);
  await scraper.submitExamDetails(exam);
  assert.equal(await scraper.getCalendarMonth(), 'November 2026');
  assert.deepEqual(await scraper.getTimeSlots(), [
    { datetime: new Date(2026, 10, 10, 9, 30), available: true },
    { datetime: new Date(2026, 10, 10, 10, 0), available: false }
  ]);
  assert.deepEqual(await scraper.getAvailableTimeSlots(), [
    { datetime: new Date(2026, 10, 10, 9, 30), available: true }
  ]);
  await scraper.goToNextCalendarMonth();
  assert.equal(await scraper.getCalendarMonth(), 'December 2026');
  assert.deepEqual(await scraper.getAvailableTimeSlots(), [
    { datetime: new Date(2026, 11, 2, 9, 30), available: true }
  ]);
  assert.equal(scraper.getPage(), page);
  assert.equal(loginForms.length, 1);
  assert.equal(examForms.length, 1);
  assert.equal(rejectedRequests.length, 0);
  assert.deepEqual(requestErrors, []);
  assert.deepEqual(routes, [
    'GET /', 'GET /TPRTDLogo.jsp', 'POST /session', `GET ${EXISTING_EXAM_PATH}`,
    'GET /exam-details', 'POST /calendar', 'GET /calendar?month=2026-12'
  ]);

  const directory = scraper.debug.directory;
  assert.ok(directory);
  await scraper.close();
  assert.equal(scraper.browser, null);
  assert.equal(scraper.page, null);
  assert.equal(scraper.isLoggedIn, false);
  assert.deepEqual(await fs.readdir(rootDir), [path.basename(directory)]);
  const journal = await fs.readFile(path.join(directory, 'steps.jsonl'), 'utf8');
  const events = journal.trim().split('\n').map(line => JSON.parse(line) as DebugEntry);
  assert.equal(events.some(entry => entry.phase === 'error'), false);
  assert.equal(new Set(events.map(entry => entry.snapshot)).size, events.length);
  const stages = new Set([
    'init-browser', 'login', 'navigate-to-cancel-rebook', 'choose-existing-exam',
    'get-exam-city-centers', 'submit-exam-details', 'next-calendar-month', 'close'
  ]);
  assert.deepEqual(events.filter(entry => entry.phase === 'after' && stages.has(entry.step)).map(entry => entry.step), [
    'init-browser', 'login', 'navigate-to-cancel-rebook', 'choose-existing-exam',
    'get-exam-city-centers', 'submit-exam-details', 'next-calendar-month', 'close'
  ]);
  assert.ok(events.some(entry => entry.frames.some(frame => frame.name === 'top' && frame.file)));
  const secrets = [creds.username, creds.password, encodeURIComponent(creds.password),
    'flow-fixture-password&lt;&amp;&quot;'];
  for (const secret of secrets) assert.equal(journal.includes(secret), false);
  for (const entry of events) {
    for (const frame of entry.frames) {
      if (!frame.file) continue;
      const html: string = await fs.readFile(path.join(directory, entry.snapshot, frame.file), 'utf8');
      for (const secret of secrets) assert.equal(html.includes(secret), false);
    }
  }
});

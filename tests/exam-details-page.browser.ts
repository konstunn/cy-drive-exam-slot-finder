import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import ChromeScraper from '../src/scraper.ts';
import type { DebugEntry } from '../src/scraper-debug.ts';

async function fixture(t: TestContext) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'exam-details-browser-'));
  const scraper = new ChromeScraper();
  t.after(async () => {
    try {
      await scraper.close();
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
  await scraper.initBrowser(5000, { headless: true, debug: true, debugDir: rootDir });
  const page = scraper.getPage();
  await page.setRequestInterception(true);
  const submissions: Array<{ url: string; method: string; form: URLSearchParams }> = [];
  const requestErrors: unknown[] = [];
  page.on('request', request => {
    if (request.method() === 'POST') {
      submissions.push({ url: request.url(), method: request.method(), form: new URLSearchParams(request.postData()) });
    }
    request.respond({
      status: 200, contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><body><div id="calendarHeader">November 2026</div></body></html>'
    }).catch(error => requestErrors.push(error));
  });

  const showForm = () => page.setContent(`<!doctype html><html><body>
    <form method="post" action="https://fixture.invalid/calendar">
      <select name="h_centre" onchange="this.form.elements.namedItem('centerChanged').value = 'yes'">
        <option value="NIC"> Nicosia </option><option value="LIM"> Limassol </option>
      </select>
      <input name="h_vrm">
      <input type="hidden" name="centerChanged" value="no">
      <button type="button" id="submitBtn" onclick="location.href='https://fixture.invalid/wrong-button'">Wrong control</button>
      <input type="button" id="submitBtn" value="Search" onclick="this.form.submit()">
    </form>
  </body></html>`);
  await showForm();
  return { scraper, page, submissions, requestErrors, showForm };
}

async function journal(scraper: ChromeScraper): Promise<DebugEntry[]> {
  assert.ok(scraper.debug.directory);
  const text = await fs.readFile(path.join(scraper.debug.directory, 'steps.jsonl'), 'utf8');
  return text.trim().split('\n').map(line => JSON.parse(line) as DebugEntry);
}

test('exam details lists centers and submits the center by label or value with the plate', async (t) => {
  const { scraper, page, submissions, requestErrors, showForm } = await fixture(t);
  scraper.isLoggedIn = true;
  assert.deepEqual(await scraper.getExamCityCenters(), ['Nicosia', 'Limassol']);

  for (const [index, centerCity, expectedValue, carPlateNumber] of [
    [0, 'Nicosia', 'NIC', 'FIXTURE-123'],
    [1, 'LIM', 'LIM', 'FIXTURE-456']
  ] as const) {
    if (index > 0) await showForm();
    await scraper.submitExamDetails({ centerCity, carPlateNumber });
    await page.waitForSelector('#calendarHeader');
    const submission = submissions[index];
    assert.ok(submission);
    assert.equal(submission.url, 'https://fixture.invalid/calendar');
    assert.equal(submission.method, 'POST');
    assert.equal(submission.form.get('h_centre'), expectedValue);
    assert.equal(submission.form.get('h_vrm'), carPlateNumber);
    assert.equal(submission.form.get('centerChanged'), 'yes');
  }
  assert.equal(submissions.length, 2);
  assert.deepEqual(requestErrors, []);

  const events = await journal(scraper);
  assert.equal(events.some(entry => entry.phase === 'error'), false);
  assert.equal(events.filter(entry => entry.step === 'submit-exam-details' && entry.phase === 'after').length, 2);
  const centers = events.find(entry => entry.step === 'get-exam-city-centers');
  assert.equal(centers?.selector, 'select[name="h_centre"]');
  const submit = events.find(entry => entry.step === 'submit-exam-details');
  assert.equal(submit?.selector, 'input[type="button"][id="submitBtn"]');
});

test('exam details rejects unauthorized, incomplete and unknown-center requests without submitting', async (t) => {
  const { scraper, page, submissions, requestErrors } = await fixture(t);
  const validExam = { centerCity: 'Nicosia', carPlateNumber: 'FIXTURE-123' };
  await assert.rejects(scraper.getExamCityCenters(), /Not logged in/);
  await assert.rejects(scraper.submitExamDetails(validExam), /Not logged in/);
  scraper.isLoggedIn = true;

  for (const exam of [
    { centerCity: '', carPlateNumber: validExam.carPlateNumber },
    { centerCity: validExam.centerCity, carPlateNumber: '' }
  ]) {
    await assert.rejects(scraper.submitExamDetails(exam), {
      message: 'Center city and car plate number must be provided'
    });
  }
  await assert.rejects(scraper.submitExamDetails({ ...validExam, centerCity: 'Unknown center' }),
    /Failed to submit exam center and plate: Could not find option "Unknown center"/);
  assert.equal(await page.$eval('input[name="h_vrm"]', input => input.value), '');
  assert.equal(submissions.length, 0);
  assert.deepEqual(requestErrors, []);

  const events = await journal(scraper);
  const selectionError = events.find(entry => entry.step === 'select-option' && entry.phase === 'error');
  assert.equal(selectionError?.selector, 'select[name="h_centre"]');
  const failure = events.at(-1);
  assert.ok(failure);
  assert.equal(failure.step, 'submit-exam-details');
  assert.equal(failure.phase, 'error');
  assert.match(failure.error?.message ?? '', /Failed to submit exam center and plate:/);
  assert.equal(failure.screenshot, 'screenshot.png');
});

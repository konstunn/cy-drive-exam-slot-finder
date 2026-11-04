// Run explicitly: npm run test:browser (requires Chrome launch permissions).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import ChromeScraper from '../src/scraper.ts';
import type { DebugEntry } from '../src/scraper-debug.ts';

test('Chrome snapshots preserve live forms, redact credentials and capture iframe failures', async (t) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scraper-debug-browser-'));
  const scraper = new ChromeScraper();
  t.after(async () => {
    try {
      if (scraper.browser) await scraper.close();
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
  await scraper.initBrowser(2000, { headless: true, debug: true, debugDir: rootDir });
  const page = scraper.getPage();
  scraper.creds = { username: 'fixture-user', password: 'fixture-password<&"' };
  scraper.isLoggedIn = true;
  await page.setContent(`<!doctype html><html><body>
    <input name="h_USERNAME"><input name="h_PASSWORD" type="password">
    <input id="plate"><input id="checked" type="checkbox">
    <textarea id="notes"></textarea>
    <select id="center"><option value="A">First</option><option value="B">Second</option></select>
    <iframe name="content" srcdoc="<html><body><div id='message'>Δέν υπάρχει κράτηση με αυτή την ταυτότητα.</div><input type='password' value='unknown-frame-password'></body></html>"></iframe>
  </body></html>`);
  const child = await page.waitForFrame(frame => frame.name() === 'content');
  await child.waitForSelector('#message');
  await page.evaluate(({ username, password }) => {
    const usernameInput = document.querySelector<HTMLInputElement>('[name=h_USERNAME]');
    const passwordInput = document.querySelector<HTMLInputElement>('[name=h_PASSWORD]');
    const plate = document.querySelector<HTMLInputElement>('#plate');
    const checked = document.querySelector<HTMLInputElement>('#checked');
    const notes = document.querySelector<HTMLTextAreaElement>('#notes');
    if (!usernameInput || !passwordInput || !plate || !checked || !notes) {
      throw new Error('Fixture form controls are missing');
    }
    usernameInput.value = username;
    passwordInput.value = password;
    plate.value = 'LIVE-123';
    checked.checked = true;
    notes.value = 'Live notes';
    document.body.insertAdjacentHTML('beforeend', '<p>Added by JavaScript</p>');
  }, scraper.creds);
  await scraper.selectByValueOrText(page, '#center', 'B');
  page.setDefaultTimeout(150);
  await assert.rejects(scraper.chooseExistingExam(), /Failed to choose existing exam/);
  const directory = scraper.debug.directory;
  assert.ok(directory);
  const liveCredentials = await page.evaluate(() => {
    const username = document.querySelector<HTMLInputElement>('[name=h_USERNAME]');
    const password = document.querySelector<HTMLInputElement>('[name=h_PASSWORD]');
    if (!username || !password) throw new Error('Fixture credentials are missing');
    return { username: username.value, password: password.value };
  });
  assert.deepEqual(liveCredentials, scraper.creds);
  assert.equal(await child.$eval('input', input => input.value), 'unknown-frame-password');
  await scraper.close();

  const journal = await fs.readFile(path.join(directory, 'steps.jsonl'), 'utf8');
  const events = journal.trim().split('\n').map(line => JSON.parse(line) as DebugEntry);
  const failure = events.find(event => event.step === 'choose-existing-exam' && event.phase === 'error');
  assert.ok(failure);
  assert.equal(failure.frames.length, 2);
  assert.ok(failure.error);
  assert.match(failure.error.message, /Failed to choose existing exam/);
  assert.equal(failure.screenshot, 'screenshot.png');
  const snapshot = path.join(directory, failure.snapshot);
  const html = await fs.readFile(path.join(snapshot, 'page.html'), 'utf8');
  const frameHtml = await fs.readFile(path.join(snapshot, 'frame-01.html'), 'utf8');
  assert.match(html, /<!DOCTYPE html>/i);
  assert.match(html, /value="LIVE-123"/);
  assert.match(html, /id="checked"[^>]*checked/);
  assert.match(html, /<textarea id="notes">Live notes<\/textarea>/);
  assert.match(html, /value="B" selected/);
  assert.match(html, /Added by JavaScript/);
  assert.match(frameHtml, /Δέν υπάρχει κράτηση/);
  assert.equal(frameHtml.includes('unknown-frame-password'), false);
  assert.equal(html.includes('unknown-frame-password'), false);
  for (const secret of Object.values(scraper.creds)) {
    assert.equal(html.includes(secret), false);
    assert.equal(journal.includes(secret), false);
  }
  const screenshot = await fs.readFile(path.join(snapshot, 'screenshot.png'));
  assert.equal(screenshot.subarray(1, 4).toString(), 'PNG');
  assert.ok(events.some(event => event.step === 'close' && event.phase === 'before'));
  assert.ok(events.some(event => event.step === 'close' && event.phase === 'after'));

  // The snapshot clone and temporary screenshot masks must leave form state intact.
  const liveSnapshot = events.find(event => event.step === 'close' && event.phase === 'before');
  assert.ok(liveSnapshot);
  const lastHtml = await fs.readFile(path.join(directory, liveSnapshot.snapshot, 'page.html'), 'utf8');
  assert.match(lastHtml, /value="LIVE-123"/);
  assert.equal(lastHtml.includes('visibility: hidden !important'), false);
});

test('calendar extraction returns typed dates, availability and unresolved slots', async (t) => {
  const scraper = new ChromeScraper();
  t.after(() => scraper.close());
  await scraper.initBrowser(2000, { headless: true, debug: false });
  scraper.isLoggedIn = true;
  const page = scraper.getPage();
  await page.setContent(`<!doctype html><html><body>
    <div id="calendarHeader">November 2026</div>
    <table class="time-slot"><tr>
      <td background="/WebPhase1/images/drivercalendar/greentime.gif">
        <a href="https://fixture.invalid/?calendarday=04%2F11%2F26&amp;examtime=09%3A30"><h5>09:30</h5></a>
      </td>
      <td background="/WebPhase1/images/drivercalendar/redtime.gif">
        <a href="https://fixture.invalid/?calendarday=05%2F11%2F2026&amp;examtime=14%3A45"><h5>14:45</h5></a>
      </td>
      <td background="/WebPhase1/images/drivercalendar/greentime.gif"></td>
    </tr></table>
    <input type="button" value="Next">
    <img title="Next month." style="width: 20px; height: 20px" onclick="document.querySelector('#calendarHeader').textContent = 'December 2026'">
  </body></html>`);

  assert.deepEqual(await scraper.getTimeSlots(), [
    { datetime: new Date(2026, 10, 4, 9, 30), available: true },
    { datetime: new Date(2026, 10, 5, 14, 45), available: false },
    { datetime: null, available: true }
  ]);
  assert.deepEqual(await scraper.getAvailableTimeSlots(), [
    { datetime: new Date(2026, 10, 4, 9, 30), available: true },
    { datetime: null, available: true }
  ]);

  const button = await scraper.waitForInputButtonByValue(page, 'Next');
  assert.equal(await button.evaluate(input => input.value), 'Next');
  await button.dispose();
  await scraper.goToNextCalendarMonth();
  assert.equal(await scraper.getCalendarMonth(), 'December 2026');
});

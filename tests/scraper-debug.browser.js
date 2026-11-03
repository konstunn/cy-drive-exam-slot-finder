// Run explicitly: node tests/scraper-debug.browser.js (requires Chrome launch permissions).
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ChromeScraper = require('../src/scraper');

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
  scraper.creds = { username: 'fixture-user', password: 'fixture-password<&"' };
  scraper.isLoggedIn = true;
  await scraper.page.setContent(`<!doctype html><html><body>
    <input name="h_USERNAME"><input name="h_PASSWORD" type="password">
    <input id="plate"><input id="checked" type="checkbox">
    <textarea id="notes"></textarea>
    <select id="center"><option value="A">First</option><option value="B">Second</option></select>
    <iframe name="content" srcdoc="<html><body><div id='message'>Δέν υπάρχει κράτηση με αυτή την ταυτότητα.</div><input type='password' value='unknown-frame-password'></body></html>"></iframe>
  </body></html>`);
  const child = await scraper.page.waitForFrame(frame => frame.name() === 'content');
  await child.waitForSelector('#message');
  await scraper.page.evaluate(({ username, password }) => {
    document.querySelector('[name=h_USERNAME]').value = username;
    document.querySelector('[name=h_PASSWORD]').value = password;
    document.querySelector('#plate').value = 'LIVE-123';
    document.querySelector('#checked').checked = true;
    document.querySelector('#notes').value = 'Live notes';
    document.body.insertAdjacentHTML('beforeend', '<p>Added by JavaScript</p>');
  }, scraper.creds);
  await scraper.selectByValueOrText(scraper.page, '#center', 'B');
  scraper.page.setDefaultTimeout(150);
  await assert.rejects(scraper.chooseExistingExam(), /Failed to choose existing exam/);
  const directory = scraper.debug.directory;
  const liveCredentials = await scraper.page.evaluate(() => ({
    username: document.querySelector('[name=h_USERNAME]').value,
    password: document.querySelector('[name=h_PASSWORD]').value
  }));
  assert.deepEqual(liveCredentials, scraper.creds);
  assert.equal(await child.$eval('input', input => input.value), 'unknown-frame-password');
  await scraper.close();

  const journal = await fs.readFile(path.join(directory, 'steps.jsonl'), 'utf8');
  const events = journal.trim().split('\n').map(line => JSON.parse(line));
  const failure = events.find(event => event.step === 'choose-existing-exam' && event.phase === 'error');
  assert.ok(failure);
  assert.equal(failure.frames.length, 2);
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
  const lastHtml = await fs.readFile(path.join(directory, liveSnapshot.snapshot, 'page.html'), 'utf8');
  assert.match(lastHtml, /value="LIVE-123"/);
  assert.equal(lastHtml.includes('visibility: hidden !important'), false);
});

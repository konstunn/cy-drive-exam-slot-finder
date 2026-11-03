const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ScraperDebug = require('../src/scraper-debug');
const ChromeScraper = require('../src/scraper');

async function tempDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scraper-debug-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function frame(html, name = '', url = 'https://fixture.invalid/') {
  return {
    name: () => name,
    url: () => url,
    evaluate: async () => html,
    evaluateHandle: async () => ({ evaluate: async () => {}, dispose: async () => {} })
  };
}

function page(frames) {
  return {
    isClosed: () => false,
    url: () => frames[0].url(),
    mainFrame: () => frames[0],
    frames: () => frames,
    screenshot: async ({ path: filename }) => fs.writeFile(filename, 'test screenshot')
  };
}

async function entries(recorder) {
  const journal = await fs.readFile(path.join(recorder.directory, 'steps.jsonl'), 'utf8');
  return journal.trim().split('\n').map(line => JSON.parse(line));
}

test('disabled capture creates no files', async (t) => {
  const rootDir = await tempDirectory(t);
  const recorder = new ScraperDebug({ rootDir });
  await recorder.capture(null, 'disabled', 'before');
  assert.deepEqual(await fs.readdir(rootDir), []);
});

test('captures full page and iframe HTML, journal phases and separate run directories', async (t) => {
  const rootDir = await tempDirectory(t);
  const recorder = new ScraperDebug({ enabled: true, rootDir });
  const browserPage = page([
    frame('<html><iframe name="content"></iframe></html>'),
    frame('<html><body>Nested frame content</body></html>', 'content', 'https://fixture.invalid/frame')
  ]);
  await recorder.capture(browserPage, 'navigate', 'before');
  await recorder.capture(browserPage, 'navigate', 'after', { durationMs: 50, selector: '#next' });
  const events = await entries(recorder);
  assert.deepEqual(events.map(event => event.phase), ['before', 'after']);
  assert.equal(events[1].durationMs, 50);
  assert.equal(events[1].selector, '#next');
  assert.equal(events[1].frames[1].name, 'content');
  const directory = path.join(recorder.directory, events[1].snapshot);
  assert.match(await fs.readFile(path.join(directory, 'page.html'), 'utf8'), /<iframe/);
  assert.match(await fs.readFile(path.join(directory, 'frame-01.html'), 'utf8'), /Nested frame content/);
  assert.equal(events[1].screenshot, undefined);

  const secondRun = new ScraperDebug({ enabled: true, rootDir });
  await secondRun.capture(null, 'init', 'before');
  assert.notEqual(recorder.directory, secondRun.directory);
});

test('redacts credentials in HTML, URLs and errors without corrupting journal JSON', async (t) => {
  const rootDir = await tempDirectory(t);
  const password = 'p<&" ss';
  const recorder = new ScraperDebug({ enabled: true, rootDir, getSecrets: () => ['sample-user', password] });
  const browserPage = page([frame(`<html>sample-user p&lt;&amp;&quot; ss ${password}</html>`,
    'main', `https://fixture.invalid/?value=${encodeURIComponent(password)}`)]);
  await recorder.capture(browserPage, 'login', 'error', {
    error: { message: `Failed for sample-user with ${password}` }
  });
  const [event] = await entries(recorder);
  assert.equal(event.error.message, 'Failed for [REDACTED] with [REDACTED]');
  assert.match(event.url, /\[REDACTED\]/);
  assert.equal(event.screenshot, 'screenshot.png');
  const html = await fs.readFile(path.join(recorder.directory, event.snapshot, 'page.html'), 'utf8');
  assert.equal(html.includes(password), false);
  assert.equal(html.includes('sample-user'), false);
  assert.equal(html.includes('p&lt;&amp;&quot; ss'), false);
});

test('detached iframe does not discard the main page or original error', async (t) => {
  const rootDir = await tempDirectory(t);
  const recorder = new ScraperDebug({ enabled: true, rootDir });
  const detached = frame('', 'detached');
  detached.evaluate = async () => { throw new Error('Frame detached'); };
  await recorder.capture(page([frame('<html>Still available</html>'), detached]), 'choose-exam', 'error', {
    error: { message: 'Next button missing' }
  });
  const [event] = await entries(recorder);
  assert.equal(event.frames[0].file, 'page.html');
  assert.equal(event.frames[1].error, 'Frame detached');
  assert.equal(event.error.message, 'Next button missing');
});

test('unwritable debug directory preserves action results and error identity', async (t) => {
  const directory = await tempDirectory(t);
  const rootDir = path.join(directory, 'file');
  await fs.writeFile(rootDir, 'not a directory');
  const warnings = [];
  const scraper = new ChromeScraper();
  scraper.debug = new ScraperDebug({ enabled: true, rootDir, onWarning: message => warnings.push(message) });
  assert.equal(await scraper.runStep('success', async () => 42), 42);
  const original = new Error('Original scraping failure');
  await assert.rejects(scraper.runStep('failure', async () => { throw original; }),
    error => error === original);
  assert.equal(warnings.length, 4);
});

test('screenshot failure preserves HTML and the scraping error', async (t) => {
  const rootDir = await tempDirectory(t);
  const recorder = new ScraperDebug({ enabled: true, rootDir });
  const browserPage = page([frame('<html>Failure page</html>')]);
  browserPage.screenshot = async () => { throw new Error('Screenshot unavailable'); };
  const scraper = new ChromeScraper();
  scraper.debug = recorder;
  scraper.page = browserPage;
  const original = new Error('Missing selector');
  await assert.rejects(scraper.runStep('missing-button', async () => { throw original; }),
    error => error === original);
  const event = (await entries(recorder)).find(entry => entry.phase === 'error');
  assert.equal(event.error.message, 'Missing selector');
  assert.equal(event.screenshotError, 'Screenshot unavailable');
  assert.equal(event.frames[0].file, 'page.html');
});

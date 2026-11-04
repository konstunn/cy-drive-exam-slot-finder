import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import type { HTTPRequest } from 'puppeteer';
import ChromeScraper from '../src/scraper.ts';
import type { DebugEntry } from '../src/scraper-debug.ts';

interface FixtureOptions {
  debug?: boolean;
  delayedFrame?: boolean;
  missingPassword?: boolean;
}

async function fixture(t: TestContext, { debug = false, delayedFrame = false,
  missingPassword = false }: FixtureOptions = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'login-page-browser-'));
  const scraper = new ChromeScraper();
  t.after(async () => {
    try {
      await scraper.close();
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
  await scraper.initBrowser(2000, { headless: true, debug, debugDir: rootDir });
  const page = scraper.getPage();
  await page.setRequestInterception(true);
  const submissions: Array<{ method: string; form: URLSearchParams }> = [];
  const requestErrors: unknown[] = [];

  // Every request is answered in memory; the real site is never contacted.
  async function respond(request: HTTPRequest): Promise<void> {
    const url = new URL(request.url());
    let body: string;
    if (url.pathname === '/') {
      const loginFrame = '<iframe name="top" src="/TPRTDLogo.jsp"></iframe>';
      body = `<!doctype html><html><body>
        <iframe name="top" src="/decoy.jsp"></iframe>
        <iframe name="other" src="/TPRTDLogo.jsp?decoy"></iframe>
        ${delayedFrame ? `<script>setTimeout(() => {
          document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(loginFrame)});
        }, 100);</script>` : loginFrame}
      </body></html>`;
    } else if (url.pathname === '/TPRTDLogo.jsp' && !url.search) {
      body = `<!doctype html><html><body><form method="post" action="/logged-in">
        <input name="h_USERNAME">
        ${missingPassword ? '' : '<input name="h_PASSWORD" type="password">'}
        <input type="submit" name="h_LOGIN" value="Login">
      </form></body></html>`;
    } else if (url.pathname === '/logged-in') {
      submissions.push({ method: request.method(), form: new URLSearchParams(request.postData()) });
      body = '<!doctype html><html><body>Logged in</body></html>';
    } else {
      body = '<!doctype html><html><body>Not the login frame</body></html>';
    }
    await request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body });
  }

  page.on('request', request => {
    respond(request).catch(error => requestErrors.push(error));
  });
  return { scraper, page, submissions, requestErrors };
}

async function journal(scraper: ChromeScraper): Promise<DebugEntry[]> {
  assert.ok(scraper.debug.directory);
  const text = await fs.readFile(path.join(scraper.debug.directory, 'steps.jsonl'), 'utf8');
  return text.trim().split('\n').map(line => JSON.parse(line) as DebugEntry);
}

test('login uses the matching frame, submits credentials and preserves redacted diagnostics', async (t) => {
  const { scraper, submissions, requestErrors } = await fixture(t, { debug: true });
  const creds = { username: 'fixture-login-user', password: 'fixture-login-password<&"' };
  await scraper.login(creds);
  assert.equal(scraper.isLoggedIn, true);
  assert.deepEqual(requestErrors, []);
  assert.equal(submissions.length, 1);
  const submission = submissions[0];
  assert.ok(submission);
  assert.equal(submission.method, 'POST');
  assert.equal(submission.form.get('h_USERNAME'), creds.username);
  assert.equal(submission.form.get('h_PASSWORD'), creds.password);
  assert.equal(submission.form.get('h_LOGIN'), 'Login');

  const events = await journal(scraper);
  assert.deepEqual(events.filter(entry => entry.step !== 'init-browser').map(entry => [entry.step, entry.phase]), [
    ['login', 'before'],
    ['open-login-page', 'before'], ['open-login-page', 'after'],
    ['wait-for-input', 'before'], ['wait-for-input', 'after'],
    ['type-input', 'before'], ['type-input', 'after'],
    ['wait-for-input', 'before'], ['wait-for-input', 'after'],
    ['type-input', 'before'], ['type-input', 'after'],
    ['click-and-navigate', 'before'], ['click-and-navigate', 'after'],
    ['login', 'after']
  ]);
  const filled = events.find(entry => entry.step === 'click-and-navigate' && entry.phase === 'before');
  assert.ok(filled);
  const loginFrame = filled.frames.find(frame => frame.name === 'top' && frame.url.endsWith('/TPRTDLogo.jsp'));
  assert.ok(loginFrame?.file);
  assert.ok(scraper.debug.directory);
  const html = await fs.readFile(path.join(scraper.debug.directory, filled.snapshot, loginFrame.file), 'utf8');
  assert.match(html, /\[REDACTED\]/);
  for (const secret of Object.values(creds)) {
    assert.equal(html.includes(secret), false);
    assert.equal(JSON.stringify(events).includes(secret), false);
  }
});

test('login waits for a delayed frame and resolves it again after navigation', async (t) => {
  const { scraper, page, submissions, requestErrors } = await fixture(t, { delayedFrame: true });
  const creds = { username: 'fixture-user', password: 'fixture-password' };
  await scraper.login(creds);
  const firstFrame = page.frames().find(frame => frame.name() === 'top' && frame.url().endsWith('/logged-in'));
  assert.ok(firstFrame);

  await scraper.login(creds);
  assert.equal(firstFrame.detached, true);
  assert.equal(scraper.isLoggedIn, true);
  assert.equal(submissions.length, 2);
  assert.deepEqual(requestErrors, []);
});

test('failed login leaves authorization unset and captures the missing input', async (t) => {
  const { scraper, page, submissions, requestErrors } = await fixture(t, { debug: true, missingPassword: true });
  page.setDefaultTimeout(300);
  const creds = { username: 'fixture-failing-user', password: 'fixture-failing-password' };
  await assert.rejects(scraper.login(creds), /Login failed:/);
  assert.equal(scraper.isLoggedIn, false);
  assert.equal(submissions.length, 0);
  assert.deepEqual(requestErrors, []);

  const events = await journal(scraper);
  const missingInput = events.find(entry => entry.step === 'wait-for-input' && entry.phase === 'error');
  assert.equal(missingInput?.inputName, 'h_PASSWORD');
  const failure = events.find(entry => entry.step === 'login' && entry.phase === 'error');
  assert.ok(failure);
  assert.match(failure.error?.message ?? '', /Login failed:/);
  assert.equal(failure.screenshot, 'screenshot.png');
  assert.ok(failure.frames.some(frame => frame.file && frame.url.endsWith('/TPRTDLogo.jsp')));
  assert.equal(JSON.stringify(events).includes(creds.username), false);
});

import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { TelegramBotPolling } from 'node-telegram-bot-api';
import Bot from '../src/bot.ts';
import ChromeScraper from '../src/scraper.ts';

test('Telegram client handles incoming messages and preserves reply parameters', async (t) => {
  // Exercise the installed client without polling Telegram or sending messages.
  const polling = t.mock.method(TelegramBotPolling.prototype, 'start', async () => {});
  const requests: Array<{ url: Parameters<typeof fetch>[0]; options: RequestInit | undefined }> = [];
  t.mock.method(globalThis, 'fetch', async (...[url, options]: Parameters<typeof fetch>) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }));
  });

  const bot = new Bot('test-token', new ChromeScraper());
  t.after(() => bot.stop());
  assert.equal(polling.mock.callCount(), 1);

  const cases = [
    ['/start', "Hello! I'm a driving exam slot finder bot. Send me any text, and I'll repeat it."],
    ['/find_slots', 'Searching for available slots...'],
    ['hello', 'You said: hello']
  ] as const;

  for (const [text, expectedReply] of cases) {
    await t.test(text, async () => {
      bot.bot.processUpdate({
        update_id: 1,
        message: {
          message_id: 42,
          date: 0,
          chat: { id: 123, type: 'private' },
          text
        }
      });
      await setImmediate();

      assert.equal(requests.length, 1);
      const request = requests.shift();
      assert.ok(request);
      const { url, options } = request;
      assert.ok(options);
      assert.equal(url, 'https://api.telegram.org/bottest-token/sendMessage');
      assert.equal(options.method, 'POST');
      assert.ok(typeof options.body === 'string' || options.body instanceof URLSearchParams);
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('chat_id'), '123');
      assert.equal(body.get('text'), expectedReply);
      assert.deepEqual(JSON.parse(body.get('reply_parameters') ?? 'null'), { message_id: 42 });
    });
  }

  await t.test('ignores messages without text', async () => {
    await bot.handleMessage({ message_id: 43, date: 0, chat: { id: 123, type: 'private' } });
    assert.equal(requests.length, 0);
  });
});

const assert = require('node:assert/strict');
const { setImmediate } = require('node:timers/promises');
const { test } = require('node:test');
const { TelegramBotPolling } = require('node-telegram-bot-api');
const Bot = require('../src/bot');

test('Telegram client handles incoming messages and preserves reply parameters', async (t) => {
  // Exercise the installed client without polling Telegram or sending messages.
  const polling = t.mock.method(TelegramBotPolling.prototype, 'start', async () => {});
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }));
  });

  const bot = new Bot('test-token', {});
  t.after(() => bot.stop());
  assert.equal(polling.mock.callCount(), 1);

  const cases = [
    ['/start', "Hello! I'm a driving exam slot finder bot. Send me any text, and I'll repeat it."],
    ['/find_slots', 'Searching for available slots...'],
    ['hello', 'You said: hello']
  ];

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
      const { url, options } = requests.shift();
      assert.equal(url, 'https://api.telegram.org/bottest-token/sendMessage');
      assert.equal(options.method, 'POST');
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('chat_id'), '123');
      assert.equal(body.get('text'), expectedReply);
      assert.equal(body.get('reply_to_message_id'), '42');
    });
  }
});

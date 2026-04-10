const TelegramBot = require('node-telegram-bot-api');

/**
 * Bot represents a Telegram bot for finding driving exam slots
 */
class Bot {
  /**
   * @param {string} token - Telegram bot token
   * @param {ChromeScraper} scraper - The scraper instance
   */
  constructor(token, scraper) {
    this.bot = new TelegramBot(token, { polling: true });
    this.scraper = scraper;

    this.setupEventHandlers();
  }

  /**
   * Generate a reply based on the incoming message text
   * @param {string} text
   * @returns {string}
   */
  getReply(text) {
    switch (text) {
      case '/start':
        return 'Hello! I\'m a driving exam slot finder bot. Send me any text, and I\'ll repeat it.';
      case '/find_slots':
        return 'Searching for available slots...';
      default:
        return `You said: ${text}`;
    }
  }

  /**
   * Set up event handlers for the bot
   */
  setupEventHandlers() {
    this.bot.on('message', (msg) => {
      this.handleMessage(msg);
    });
  }

  /**
   * Handle incoming messages
   * @param {Object} msg - Telegram message object
   */
  async handleMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;

    const reply = this.getReply(text);

    try {
      await this.bot.sendMessage(chatId, reply, {
        reply_to_message_id: msg.message_id
      });
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }

  /**
   * Start the bot
   */
  start() {
    console.log('Bot started and listening for messages...');
  }

  /**
   * Stop the bot
   */
  stop() {
    this.bot.stopPolling();
  }
}

module.exports = Bot;
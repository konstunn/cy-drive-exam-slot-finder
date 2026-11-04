import { TelegramBot, type Message } from 'node-telegram-bot-api';
import type ChromeScraper from './scraper.ts';

/**
 * Bot represents a Telegram bot for finding driving exam slots
 */
export default class Bot {
  readonly bot: TelegramBot;
  readonly scraper: ChromeScraper;
  constructor(token: string, scraper: ChromeScraper) {
    this.bot = new TelegramBot(token, { polling: true });
    this.scraper = scraper;

    this.setupEventHandlers();
  }

  /**
   * Generate a reply based on the incoming message text
   */
  getReply(text: string): string {
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
  setupEventHandlers(): void {
    this.bot.on('message', (msg) => {
      this.handleMessage(msg).catch(error => console.error('Error handling message:', error));
    });
  }

  /**
   * Handle incoming messages
   */
  async handleMessage(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (text === undefined) return;

    const reply = this.getReply(text);

    try {
      await this.bot.sendMessage(chatId, reply, {
        reply_parameters: { message_id: msg.message_id }
      });
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }

  /**
   * Start the bot
   */
  start(): void {
    console.log('Bot started and listening for messages...');
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    await this.bot.stopPolling();
  }
}

const Bot = require('./bot');
const ChromeScraper = require('./scraper');

async function main() {
  // Get environment variables
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN environment variable is required');
    process.exit(1);
  }

  const username = process.env.SCRAPER_USERNAME;
  const password = process.env.SCRAPER_PASSWORD;
  if (!username || !password) {
    console.error('SCRAPER_USERNAME and SCRAPER_PASSWORD environment variables are required');
    process.exit(1);
  }

  console.log('Initializing scraper...');

  // Initialize scraper
  const scraper = new ChromeScraper();
  try {
    await scraper.initBrowser(60000); // 60 seconds timeout
  } catch (error) {
    console.error('Failed to initialize browser:', error);
    process.exit(1);
  }

  // Login to the scraping service
  try {
    console.log('Logging in to driving exam system...');
    await scraper.login({ username, password });
    console.log('Successfully logged in!');
  } catch (error) {
    console.error('Failed to login to scraping service:', error);
    await scraper.close();
    process.exit(1);
  }

  // Initialize and start bot
  const bot = new Bot(token, scraper);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    bot.stop();
    await scraper.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    bot.stop();
    await scraper.close();
    process.exit(0);
  });

  // Start the bot
  bot.start();
}

main().catch(console.error);
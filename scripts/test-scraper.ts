import { setTimeout as sleep } from 'node:timers/promises';
import ChromeScraper from '../src/scraper.ts';

async function main(): Promise<void> {
  const username = process.env.SCRAPER_USERNAME;
  const password = process.env.SCRAPER_PASSWORD;

  if (!username || !password) {
    console.error('Please set SCRAPER_USERNAME and SCRAPER_PASSWORD environment variables');
    process.exit(1);
  }

  const scraper = new ChromeScraper();

  try {
    console.log('Initializing browser...');
    const debug = process.env.SCRAPER_DEBUG !== '0';
    await scraper.initBrowser(100 * 1e3, {
      headless: false,
      args: ['--start-maximized', '--force-device-scale-factor=2'],
      debug,
      logLevel: debug ? 'DEBUG' : 'INFO'
    });

    console.log('Logging in...');
    const main = await scraper.login({ username, password });
    console.log('Login successful!');

    console.log('Opening driving exam menu...');
    await main.openDrivingExamMenu();

    console.log('Opening Κράτηση και Πληρωμή για Εξέταση Άδειας Οδήγησης...');
    const booking = await main.openBookingAndPayment();
    console.log('Booking and payment page opened!');

    console.log('Getting exam city centers...');
    const centers = await booking.getCenters();
    console.log('Available centers:', centers);

    console.log('Scraper test completed successfully!');
    console.log('Keeping browser open for 60 seconds...');
    await sleep(60_000);
  } catch (error) {
    console.error('Error:', error);
    process.exitCode = 1;
  } finally {
    await scraper.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

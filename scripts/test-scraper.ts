import { loadEnvFile } from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import ChromeScraper from '../src/scraper.ts';

async function main(): Promise<void> {
  loadEnvFile(new URL('../.env', import.meta.url));

  const delayScale = Number(process.env.SCRAPER_DELAY_SCALE ?? '1');
  const navDelayMs = Number(process.env.SCRAPER_NAV_DELAY_MS ?? '0');
  if (!Number.isFinite(delayScale) || delayScale < 0 || !Number.isFinite(navDelayMs) || navDelayMs < 0) {
    throw new Error('SCRAPER_DELAY_SCALE and SCRAPER_NAV_DELAY_MS must be finite non-negative numbers');
  }

  const username = process.env.SCRAPER_USERNAME;
  const password = process.env.SCRAPER_PASSWORD;
  const centerCity = process.env.SCRAPER_CITY_CENTER;
  const carPlateNumber = process.env.SCRAPER_CAR_PLATE;
  const drivingCategory = process.env.SCRAPER_DRIVING_CATEGORY;

  if (!username || !password) {
    console.error('Please set SCRAPER_USERNAME and SCRAPER_PASSWORD environment variables');
    process.exit(1);
  }

  if (!centerCity || !carPlateNumber || !drivingCategory) {
    console.error('Please set SCRAPER_CITY_CENTER, SCRAPER_CAR_PLATE and SCRAPER_DRIVING_CATEGORY environment variables');
    process.exit(1);
  }

  const startedAt = performance.now();
  const scraper = new ChromeScraper();

  try {
    console.log('Initializing browser...');
    const debug = process.env.SCRAPER_DEBUG !== '0';
    await scraper.initBrowser(100 * 1e3, {
      headless: false,
      delayScale,
      navDelayMs,
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

    console.log('Available driving categories:', await booking.getDrivingCategories());
    console.log('Filling exam booking details...');
    await booking.fillDetails({ centerCity, carPlateNumber, drivingCategory });
    console.log('Exam booking details filled!');

    console.log('Clicking Επόμενο and opening the calendar...');
    const calendar = await booking.next();
    console.log('Calendar month:', await calendar.getMonth());
    console.log('Searching for the nearest available time slot...');
    const nearest = await calendar.findNearestAvailableSlot();
    if (nearest?.datetime) {
      console.log('Nearest available time slot:', nearest.datetime.toLocaleString('ru-RU'));
    } else {
      console.log('No available slots found within the calendar booking period.');
    }

    console.log(`Scraper test completed successfully in ${((performance.now() - startedAt) / 1000).toFixed(2)} seconds!`);
    if (delayScale > 0) {
      console.log(`Keeping browser open for ${60 * delayScale} seconds...`);
      await sleep(60_000 * delayScale);
    }
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

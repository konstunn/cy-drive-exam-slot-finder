const ChromeScraper = require('./scraper');

async function main() {
  const username = process.env.SCRAPER_USERNAME;
  const password = process.env.SCRAPER_PASSWORD;
  const centerCity = process.env.SCRAPER_CITY_CENTER
  const carPlateNumber = process.env.SCRAPER_CAR_PLATE

  if (!username || !password) {
    console.error('Please set SCRAPER_USERNAME and SCRAPER_PASSWORD environment variables');
    process.exit(1);
  }

  if (!centerCity || !carPlateNumber) {
    console.error('Please set SCRAPER_CITY_CENTER and SCRAPER_CAR_PLATE environment variables');
    process.exit(1);
  }

  const scraper = new ChromeScraper();

  try {
    console.log('Initializing browser...');
    await scraper.initBrowser(100*1e3, { headless: false }); // 10 seconds, not headless for testing

    console.log('Logging in...');
    await scraper.login({ username, password });
    console.log('Login successful!');

    console.log('Navigating to cancel/rebook page...');
    await scraper.navigateToCancelRebook();
    console.log('Navigation successful!');

    console.log('Choosing existing exam...');
    await scraper.chooseExistingExam();
    console.log('Exam chosen successfully!');

    console.log('Getting exam city centers...');
    const centers = await scraper.getExamCityCenters();
    console.log('Available centers:', centers);

    // For manual testing, you can add more steps here
    // For example, submit exam details if you have them
    const exam = {
      centerCity: centerCity,
      carPlateNumber: carPlateNumber
    };
    await scraper.submitExamDetails(exam);
    console.log('Exam details submitted!');

    var currentMonth = await scraper.getCalendarMonth();
    console.log('Current calendar month:', currentMonth);

    var timeSlots = await scraper.getTimeSlots();
    console.log('Available time slots:', timeSlots);

    await scraper.goToNextCalendarMonth();
    console.log('Moved to next calendar month!');

      var currentMonth = await scraper.getCalendarMonth();
    console.log('Current calendar month:', currentMonth);

    timeSlots = await scraper.getTimeSlots();
    console.log('Available time slots in next month:', timeSlots);

    console.log('Scraper test completed successfully!');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await scraper.close();
  }
}

main();
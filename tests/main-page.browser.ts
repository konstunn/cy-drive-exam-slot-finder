import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import type { HTTPRequest } from 'puppeteer';
import ChromeScraper from '../src/scraper.ts';
import type { DebugEntry } from '../src/scraper-debug.ts';
import ExamBookingPage from '../src/scraper/pages/exam-booking-page.ts';
import CalendarPage from '../src/scraper/pages/calendar-page.ts';

const COMMON = '/WebPhase1/gui/Common/';
const CALENDAR = '/WebPhase1/gui/dlcalendar/';
const BOOKING_TEXT = 'Κράτηση και Πληρωμή για Εξέταση Άδειας Οδήγησης';

async function fixture(t: TestContext, { missingCategory = false, wrongDestination = false,
  missingCalendarHeader = false, failCalendarNavigation = false } = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'main-page-browser-'));
  const scraper = new ChromeScraper();
  t.after(async () => {
    try {
      await scraper.close();
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
  await scraper.initBrowser(2000, { headless: true, debug: true, debugDir: rootDir });
  const page = scraper.getPage();
  page.setDefaultNavigationTimeout(10000);
  const requests: string[] = [];
  const requestErrors: unknown[] = [];
  const bookingForms: URLSearchParams[] = [];

  async function respond(request: HTTPRequest): Promise<void> {
    const url = new URL(request.url());
    if (url.protocol === 'data:') {
      await request.continue();
      return;
    }
    assert.equal(url.origin, 'https://rtd.mcw.gov.cy');
    requests.push(`${request.method()} ${url.pathname}${url.search}`);
    let body: string;
    switch (url.pathname) {
      case '/':
        body = `<iframe name="top" src="${COMMON}TPRTDLogo.jsp"></iframe>`;
        break;
      case `${COMMON}TPRTDLogo.jsp`:
        body = `<form method="post" action="/session">
          <input name="h_USERNAME"><input name="h_PASSWORD" type="password">
          <input name="h_LOGIN" type="submit">
        </form>`;
        break;
      case '/session':
        body = `<iframe name="left" src="${COMMON}NavBar.jsp?lang=gr"></iframe>
          <iframe name="center" src="${COMMON}RTDInfo.jsp"></iframe>`;
        break;
      case `${COMMON}RTDInfo.jsp`:
        body = '<p>Main page</p>';
        break;
      case `${COMMON}NavBar.jsp`:
        body = `<a href="NavBarNext.jsp?lang=gr&amp;type=driverLicenseInd" target="left">Εξέταση Άδειας Οδήγησης</a>`;
        break;
      case `${COMMON}NavBarNext.jsp`:
        assert.equal(url.searchParams.get('type'), 'driverLicenseInd');
        body = `<a href="${CALENDAR}PersonalDataPage.jsp?lang=gr&amp;comingfrom=2" target="center">Ακύρωση Εξέτασης Άδειας Οδήγησης</a>
          <a href="${CALENDAR}PersonalDataPage.jsp?lang=gr&amp;comingfrom=1" target="center"
            onclick="this.href += '&clicked=yes'">Κράτηση και Πληρωμή για\n Εξέταση Άδειας Οδήγησης</a>`;
        break;
      case `${CALENDAR}PersonalDataPage.jsp`:
        assert.equal(url.searchParams.get('comingfrom'), '1');
        // Only a real click executes the link's handler.
        assert.equal(url.searchParams.get('clicked'), 'yes');
        await request.respond({ status: 302, headers: {
          location: `${CALENDAR}${wrongDestination ? 'WrongPage' : 'NewestCalendar'}.jsp?lang=gr`
        } });
        return;
      case `${CALENDAR}NewestCalendar.jsp`:
      case `${CALENDAR}WrongPage.jsp`:
        body = `<form name="RegForm" method="post" action="${CALENDAR}NewCalendarDate.jsp?lang=gr">
          <select name="h_centre" onchange="this.dataset.changed = this.value"><option value="NIC"> Nicosia </option><option value="LIM">Limassol</option></select>
          <input name="h_vrm" value="OLD123" maxlength="7" onchange="this.value = this.value.toUpperCase()">
          <input type="hidden" name="h_lic_code"><input type="hidden" name="h_endors_date">
          <button type="button" id="submitBtn" onclick="location.href='/wrong-button'">Επόμενο</button>
          <input type="button" id="submitBtn" value="Επόμενο" onclick="
            const category = this.form.elements.namedItem('h_licence_category').value.split('%');
            this.form.elements.namedItem('h_lic_code').value = category[0];
            this.form.elements.namedItem('h_endors_date').value = category[1];
            this.form.submit();">
        </form>${missingCategory ? '' : `<script>setTimeout(() => {
          document.querySelector('form').insertAdjacentHTML('beforeend', '<select name="h_licence_category" onchange="this.dataset.changed = this.value"><option value="-1">Category</option><option value="ΒΒ%01/01/2026"> ΒΒ </option><option value="Α1%02/02/2026">Α1</option><option disabled value="C">C</option></select>');
        }, 100);</script>`}`;
        break;
      case `${CALENDAR}NewCalendarDate.jsp`:
        assert.equal(request.method(), 'POST');
        bookingForms.push(new URLSearchParams(request.postData()));
        if (failCalendarNavigation) {
          await request.abort('failed');
          return;
        }
        body = `<body onload="document.forms[0].submit()">
          <form method="post" action="/WebPhase1/ExaminerDateServlet?lang=gr">
            <input type="hidden" name="comefrom" value="1">
          </form>
        </body>`;
        break;
      case '/WebPhase1/ExaminerDateServlet':
        assert.equal(request.method(), 'POST');
        assert.equal(new URLSearchParams(request.postData()).get('comefrom'), '1');
        await request.respond({ status: 302, headers: { location: `${CALENDAR}NewCalendar1.jsp?lang=gr` } });
        return;
      case `${CALENDAR}NewCalendar1.jsp`:
        body = `<table class="time-slot"><tr>
          <td background="/WebPhase1/images/drivercalendar/greentime.gif"><a href="/slot?calendarday=10%2F11%2F2026&amp;examtime=09%3A30"><h5>09:30</h5></a></td>
          <td background="/WebPhase1/images/drivercalendar/redtime.gif"><a href="/slot?calendarday=10%2F11%2F2026&amp;examtime=10%3A00"><h5>10:00</h5></a></td>
        </tr></table>${missingCalendarHeader ? '' : `<script>setTimeout(() => {
          document.body.insertAdjacentHTML('afterbegin', '<div id="calendarHeader">November 2026</div>');
        }, 100);</script>`}`;
        break;
      case '/WebPhase1/images/drivercalendar/greentime.gif':
      case '/WebPhase1/images/drivercalendar/redtime.gif':
      case '/favicon.ico':
        await request.respond({ status: 204 });
        return;
      default:
        throw new Error(`Unexpected fixture request: ${request.method()} ${url.pathname}`);
    }
    await request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body });
  }

  await page.setRequestInterception(true);
  page.on('request', request => {
    respond(request).catch(async error => {
      requestErrors.push(error);
      if (!request.isInterceptResolutionHandled()) await request.abort();
    });
  });
  const main = await scraper.login({ username: 'main-fixture-user', password: 'main-fixture-password' });
  return { scraper, page, main, requests, requestErrors, bookingForms };
}

async function journal(scraper: ChromeScraper): Promise<DebugEntry[]> {
  assert.ok(scraper.debug.directory);
  const journalText = await fs.readFile(path.join(scraper.debug.directory, 'steps.jsonl'), 'utf8');
  return journalText.trim().split('\n').map(line => JSON.parse(line) as DebugEntry);
}

test('main page expands its menu and clicks booking into the center frame, returning the ready page', async t => {
  const { scraper, page, main, requests, requestErrors } = await fixture(t);
  assert.equal(await main.openDrivingExamMenu(), main);
  const menu = await page.waitForFrame(frame => frame.name() === 'left');
  const menuUrl = menu.url();
  const booking = await main.openBookingAndPayment();
  assert.ok(booking instanceof ExamBookingPage);
  assert.deepEqual(await booking.getCenters(), ['Nicosia', 'Limassol']);
  assert.equal(menu.url(), menuUrl);
  const center = await page.waitForFrame(frame => frame.name() === 'center');
  assert.equal(new URL(center.url()).pathname, `${CALENDAR}NewestCalendar.jsp`);
  assert.ok(await center.$('select[name="h_licence_category"]'));
  assert.equal(requests.filter(route => route.includes('PersonalDataPage.jsp')).length, 1);
  assert.equal(requests.filter(route => route.startsWith('POST ')).length, 1);
  assert.deepEqual(requestErrors, []);

  const events = await journal(scraper);
  assert.equal(events.some(entry => entry.phase === 'error'), false);
  const bookingStep = events.find(entry => entry.step === 'open-booking-and-payment' && entry.phase === 'after');
  assert.equal(bookingStep?.expected, BOOKING_TEXT);
  assert.ok(bookingStep?.frames.some(frame => frame.name === 'center' && frame.url.includes('/NewestCalendar.jsp') && frame.file));
  assert.ok(events.some(entry => entry.step === 'click-element-and-navigate' && entry.phase === 'after'));
});

test('booking rejects incomplete forms and unexpected destinations and records failure diagnostics', async t => {
  for (const options of [{ missingCategory: true }, { wrongDestination: true }]) {
    await t.test(JSON.stringify(options), async t => {
      const { scraper, main, requestErrors } = await fixture(t, options);
      await main.openDrivingExamMenu();
      await assert.rejects(main.openBookingAndPayment(), /Waiting failed/);
      assert.deepEqual(requestErrors, []);
      const events = await journal(scraper);
      assert.equal(events.some(entry => entry.step === 'open-booking-and-payment' && entry.phase === 'after'), false);
      const failure = events.find(entry => entry.step === 'open-booking-and-payment' && entry.phase === 'error');
      assert.equal(failure?.expected, BOOKING_TEXT);
      assert.equal(failure?.screenshot, 'screenshot.png');
    });
  }
});

test('booking fills center and category by label or value and replaces the plate using the form change handler', async t => {
  const { scraper, page, main, requests, requestErrors } = await fixture(t);
  await main.openDrivingExamMenu();
  const booking = await main.openBookingAndPayment();
  const center = await page.waitForFrame(frame => frame.name() === 'center');
  assert.deepEqual(await booking.getDrivingCategories(), ['Category', 'ΒΒ', 'Α1', 'C']);
  const bookingUrl = center.url();

  for (const [exam, expectedCenter, expectedCategory, expectedPlate] of [
    [{ centerCity: ' Limassol ', drivingCategory: ' ΒΒ ', carPlateNumber: ' abc123 ' }, 'LIM', 'ΒΒ%01/01/2026', 'ABC123'],
    [{ centerCity: 'NIC', drivingCategory: 'Α1%02/02/2026', carPlateNumber: 'xyz789' }, 'NIC', 'Α1%02/02/2026', 'XYZ789']
  ] as const) {
    assert.equal(await booking.fillDetails(exam), booking);
    const form = await center.evaluate(() => {
      const city = document.querySelector<HTMLSelectElement>('select[name="h_centre"]');
      const category = document.querySelector<HTMLSelectElement>('select[name="h_licence_category"]');
      return {
        city: city?.value,
        cityChange: city?.dataset.changed,
        category: category?.value,
        categoryChange: category?.dataset.changed,
        plate: document.querySelector<HTMLInputElement>('input[name="h_vrm"]')?.value
      };
    });
    assert.deepEqual(form, {
      city: expectedCenter, cityChange: expectedCenter,
      category: expectedCategory, categoryChange: expectedCategory, plate: expectedPlate
    });
  }

  assert.equal(center.url(), bookingUrl);
  assert.equal(requests.filter(route => route.startsWith('POST ')).length, 1);
  assert.deepEqual(requestErrors, []);
  const events = await journal(scraper);
  assert.equal(events.some(entry => entry.phase === 'error'), false);
  assert.equal(events.filter(entry => entry.step === 'fill-exam-booking-details' && entry.phase === 'after').length, 2);
});

test('booking rejects missing fields, unknown or placeholder options and plates that would be truncated', async t => {
  const { scraper, main, requests, requestErrors } = await fixture(t);
  await main.openDrivingExamMenu();
  const booking = await main.openBookingAndPayment();
  const valid = { centerCity: 'Limassol', drivingCategory: 'ΒΒ', carPlateNumber: 'ABC123' };
  for (const field of ['centerCity', 'drivingCategory', 'carPlateNumber'] as const) {
    await assert.rejects(booking.fillDetails({ ...valid, [field]: '  ' }), /must be provided/);
  }
  await assert.rejects(booking.fillDetails({ ...valid, centerCity: 'Unknown center' }), /Could not find option/);
  await assert.rejects(booking.fillDetails({ ...valid, drivingCategory: 'Unknown category' }), /Could not find option/);
  await assert.rejects(booking.fillDetails({ ...valid, drivingCategory: 'Category' }), /Please select a valid option/);
  await assert.rejects(booking.fillDetails({ ...valid, drivingCategory: 'C' }), /Please select a valid option/);
  await assert.rejects(booking.fillDetails({ ...valid, carPlateNumber: 'TOO-LONG' }), /maximum length of 7/);
  assert.equal(requests.filter(route => route.startsWith('POST ')).length, 1);
  assert.deepEqual(requestErrors, []);
  const events = await journal(scraper);
  const failure = events.find(entry => entry.step === 'fill-exam-booking-details' && entry.phase === 'error');
  assert.equal(failure?.screenshot, 'screenshot.png');
});

test('booking Next clicks the input, submits prepared hidden fields and returns the ready calendar after automatic navigation', async t => {
  const { scraper, page, main, requests, requestErrors, bookingForms } = await fixture(t);
  await main.openDrivingExamMenu();
  const booking = await main.openBookingAndPayment();
  await booking.fillDetails({ centerCity: 'Limassol', drivingCategory: 'ΒΒ', carPlateNumber: 'abc123' });
  const menu = await page.waitForFrame(frame => frame.name() === 'left');
  const menuUrl = menu.url();
  const calendar = await booking.next();
  assert.ok(calendar instanceof CalendarPage);
  assert.equal(await calendar.getMonth(), 'November 2026');
  assert.deepEqual(await calendar.getAvailableSlots(), [
    { datetime: new Date(2026, 10, 10, 9, 30), available: true }
  ]);
  assert.equal(menu.url(), menuUrl);
  const center = await page.waitForFrame(frame => frame.name() === 'center');
  assert.equal(new URL(center.url()).pathname, `${CALENDAR}NewCalendar1.jsp`);
  assert.equal(bookingForms.length, 1);
  assert.equal(bookingForms[0]?.get('h_centre'), 'LIM');
  assert.equal(bookingForms[0]?.get('h_vrm'), 'ABC123');
  assert.equal(bookingForms[0]?.get('h_licence_category'), 'ΒΒ%01/01/2026');
  assert.equal(bookingForms[0]?.get('h_lic_code'), 'ΒΒ');
  assert.equal(bookingForms[0]?.get('h_endors_date'), '01/01/2026');
  assert.equal(requests.includes('POST /WebPhase1/ExaminerDateServlet?lang=gr'), true);
  assert.deepEqual(requestErrors, []);
  const events = await journal(scraper);
  assert.equal(events.some(entry => entry.phase === 'error'), false);
  const next = events.find(entry => entry.step === 'submit-exam-booking-details' && entry.phase === 'after');
  assert.ok(next?.frames.some(frame => frame.name === 'center' && frame.url.includes('/NewCalendar1.jsp') && frame.file));
  assert.ok(events.some(entry => entry.step === 'wait-for-calendar-page' && entry.phase === 'after'));
});

test('booking Next rejects failed navigation and pages without a ready calendar, preserving diagnostics', async t => {
  for (const options of [{ failCalendarNavigation: true }, { missingCalendarHeader: true }]) {
    await t.test(JSON.stringify(options), async t => {
      const { scraper, main, requestErrors } = await fixture(t, options);
      await main.openDrivingExamMenu();
      const booking = await main.openBookingAndPayment();
      await booking.fillDetails({ centerCity: 'Limassol', drivingCategory: 'ΒΒ', carPlateNumber: 'ABC123' });
      await assert.rejects(booking.next(), /ERR_FAILED|Waiting failed/);
      assert.deepEqual(requestErrors, []);
      const events = await journal(scraper);
      assert.equal(events.some(entry => entry.step === 'submit-exam-booking-details' && entry.phase === 'after'), false);
      const failure = events.find(entry => entry.step === 'submit-exam-booking-details' && entry.phase === 'error');
      assert.equal(failure?.expected, 'Calendar after clicking Επόμενο');
      assert.equal(failure?.screenshot, 'screenshot.png');
    });
  }
});

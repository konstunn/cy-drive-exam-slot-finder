import type { Page } from 'puppeteer';
import type BrowserActions from '../browser-actions.ts';
import type { StepExecutor } from '../step-runner.ts';
import ExamBookingPage from './exam-booking-page.ts';

const EXAM_MENU_SELECTOR = 'a[href*="NavBarNext.jsp"][href*="type=driverLicenseInd"][target="left"]';
const BOOKING_SELECTOR = 'a[href*="PersonalDataPage.jsp"][href*="comingfrom=1"][target="center"]';
const BOOKING_TEXT = 'Κράτηση και Πληρωμή για Εξέταση Άδειας Οδήγησης';

interface MainPageOptions {
  page: Page;
  actions: Pick<BrowserActions, 'preNavDelay' | 'clickAndWaitForNavigation'>;
  steps: StepExecutor;
}

export default class MainPage {
  private readonly options: Readonly<MainPageOptions>;

  constructor(options: MainPageOptions) {
    this.options = options;
  }

  async openDrivingExamMenu(): Promise<this> {
    const { page, actions, steps } = this.options;
    return steps.run('open-driving-exam-menu', async () => {
      const menu = await page.waitForFrame(frame => {
        return frame.name() === 'left' && /\/NavBar(?:Next)?\.jsp$/.test(new URL(frame.url()).pathname);
      });
      await menu.waitForSelector(EXAM_MENU_SELECTOR);
      await actions.preNavDelay();
      await actions.clickAndWaitForNavigation(menu, EXAM_MENU_SELECTOR);
      await menu.waitForSelector(BOOKING_SELECTOR);
      return this;
    }, { selector: EXAM_MENU_SELECTOR });
  }

  async openBookingAndPayment(): Promise<ExamBookingPage> {
    const { page, actions, steps } = this.options;
    return steps.run('open-booking-and-payment', async () => {
      const menu = await page.waitForFrame(frame => {
        if (frame.name() !== 'left') return false;
        const url = new URL(frame.url());
        return url.pathname.endsWith('/NavBarNext.jsp') && url.searchParams.get('type') === 'driverLicenseInd';
      });
      await menu.waitForFunction((selector, text) => {
        return document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() === text;
      }, {}, BOOKING_SELECTOR, BOOKING_TEXT);
      const link = await menu.$(BOOKING_SELECTOR);
      if (!link) throw new Error('Booking and payment link disappeared');

      try {
        // The link lives in "left", but its target navigates the "center" frame.
        const center = await page.waitForFrame(frame => frame.name() === 'center');
        await actions.preNavDelay();
        await actions.clickAndWaitForNavigation(center, link);
        const booking = new ExamBookingPage({ context: center, steps });
        return await booking.waitUntilReady();
      } finally {
        await link.dispose();
      }
    }, { selector: BOOKING_SELECTOR, expected: BOOKING_TEXT });
  }
}

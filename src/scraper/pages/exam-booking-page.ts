import type { BrowserContext } from '../../types.ts';
import type { StepExecutor } from '../step-runner.ts';

const CENTER_SELECTOR = 'select[name="h_centre"]';
const CATEGORY_SELECTOR = 'select[name="h_licence_category"]';
const PLATE_SELECTOR = 'input[name="h_vrm"]';

interface ExamBookingPageOptions {
  context: BrowserContext;
  steps: StepExecutor;
}

export default class ExamBookingPage {
  private readonly options: Readonly<ExamBookingPageOptions>;

  constructor(options: ExamBookingPageOptions) {
    this.options = options;
  }

  async waitUntilReady(): Promise<this> {
    const { context, steps } = this.options;
    return steps.run('wait-for-exam-booking-page', async () => {
      await context.waitForFunction((center, category, plate) => {
        return location.pathname.endsWith('/NewestCalendar.jsp')
          && document.querySelector(center) !== null
          && document.querySelector(category) !== null
          && document.querySelector(plate) !== null;
      }, {}, CENTER_SELECTOR, CATEGORY_SELECTOR, PLATE_SELECTOR);
      return this;
    }, { expected: 'NewestCalendar.jsp with exam center, licence category and car plate fields' });
  }

  async getCenters(): Promise<string[]> {
    const { context, steps } = this.options;
    return steps.run('get-exam-booking-centers', async () => {
      await context.waitForSelector(CENTER_SELECTOR);
      return context.$$eval(`${CENTER_SELECTOR} option`, options => {
        return options.map(option => (option.textContent ?? '').trim());
      });
    }, { selector: CENTER_SELECTOR });
  }
}

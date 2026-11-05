import type { BrowserContext, ExamBookingDetails } from '../../types.ts';
import type BrowserActions from '../browser-actions.ts';
import type DebugInspector from '../debug-inspector.ts';
import type { StepExecutor } from '../step-runner.ts';
import CalendarPage from './calendar-page.ts';

const CENTER_SELECTOR = 'select[name="h_centre"]';
const CATEGORY_SELECTOR = 'select[name="h_licence_category"]';
const PLATE_SELECTOR = 'input[name="h_vrm"]';
const NEXT_SELECTOR = 'input[type="button"][id="submitBtn"][value="Επόμενο"]';

interface ExamBookingPageOptions {
  context: BrowserContext;
  actions: Pick<BrowserActions, 'selectByValueOrText' | 'preNavDelay' | 'clickAndWaitForNavigation' | 'retryEvaluate'>;
  inspector: Pick<DebugInspector, 'logCalendarNavigationControls'>;
  steps: StepExecutor;
  log: (message: string) => void;
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

  async getDrivingCategories(): Promise<string[]> {
    const { context, steps } = this.options;
    return steps.run('get-exam-booking-categories', async () => {
      await context.waitForSelector(CATEGORY_SELECTOR);
      return context.$$eval(`${CATEGORY_SELECTOR} option`, options => {
        return options.map(option => (option.textContent ?? '').trim());
      });
    }, { selector: CATEGORY_SELECTOR });
  }

  async fillDetails(exam: ExamBookingDetails): Promise<this> {
    const { context, actions, steps } = this.options;
    return steps.run('fill-exam-booking-details', async () => {
      const center = exam.centerCity.trim();
      const category = exam.drivingCategory.trim();
      const plate = exam.carPlateNumber.trim();
      if (!center || !category || !plate) {
        throw new Error('Center city, car plate number and driving category must be provided');
      }

      await context.waitForSelector(PLATE_SELECTOR);
      await context.$eval(PLATE_SELECTOR, (input, value) => {
        if (!(input instanceof HTMLInputElement)) throw new Error('Car plate input not found');
        if (input.maxLength >= 0 && value.length > input.maxLength) {
          throw new Error(`Car plate number exceeds the maximum length of ${input.maxLength}`);
        }
      }, plate);

      for (const [selector, value] of [[CENTER_SELECTOR, center], [CATEGORY_SELECTOR, category]] as const) {
        await context.waitForSelector(selector);
        await actions.selectByValueOrText(context, selector, value);
        await context.$eval(selector, select => {
          if (!(select instanceof HTMLSelectElement)) throw new Error('Exam detail select not found');
          const option = select.selectedOptions[0];
          if (!option || option.disabled || option.parentElement?.matches('optgroup:disabled')
            || !option.value || option.value === '-1') {
            throw new Error(`Please select a valid option for ${select.name}`);
          }
        });
      }

      await context.$eval(PLATE_SELECTOR, input => {
        if (!(input instanceof HTMLInputElement)) throw new Error('Car plate input not found');
        input.value = '';
      });
      await context.type(PLATE_SELECTOR, plate);
      await context.$eval(PLATE_SELECTOR, input => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      return this;
    }, { expected: 'Exam center, driving category and car plate filled in' });
  }

  async next(): Promise<CalendarPage> {
    const { context, actions, inspector, steps, log } = this.options;
    return steps.run('submit-exam-booking-details', async () => {
      await context.waitForSelector(NEXT_SELECTOR, { visible: true });
      await actions.preNavDelay();
      await actions.clickAndWaitForNavigation(context, NEXT_SELECTOR);
      const calendar = new CalendarPage({ context, actions, inspector, steps, log });
      // NewCalendarDate.jsp submits another form on load; wait for the final calendar.
      return calendar.waitUntilReady();
    }, { selector: NEXT_SELECTOR, expected: 'Calendar after clicking Επόμενο' });
  }
}

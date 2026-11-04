import type { Page } from 'puppeteer';
import { errorMessage } from '../../errors.ts';
import type { ExamDetails } from '../../types.ts';
import type BrowserActions from '../browser-actions.ts';
import type DebugInspector from '../debug-inspector.ts';

const CENTER_SELECTOR = 'select[name="h_centre"]';
const PLATE_SELECTOR = 'input[name="h_vrm"]';
const SUBMIT_SELECTOR = 'input[type="button"][id="submitBtn"]';

interface ExamDetailsPageOptions {
  page: Page;
  actions: Pick<BrowserActions, 'selectByValueOrText' | 'preNavDelay' | 'clickAndWaitForNavigation'>;
  inspector: Pick<DebugInspector, 'logClickableControls' | 'logSelectOptions'>;
  log: (message: string) => void;
}

export default class ExamDetailsPage {
  static readonly centersDetails = { selector: CENTER_SELECTOR } as const;
  static readonly submitDetails = { selector: SUBMIT_SELECTOR } as const;

  private readonly options: Readonly<ExamDetailsPageOptions>;

  constructor(options: ExamDetailsPageOptions) {
    this.options = options;
  }

  async getCenters(): Promise<string[]> {
    const { page, log } = this.options;
    try {
      log(`Getting exam city centers from page at ${page.url()}`);
      await page.waitForSelector(CENTER_SELECTOR);
      return await page.evaluate(selector => {
        const options = Array.from(document.querySelectorAll(selector));
        return options.map(option => (option.textContent ?? '').trim());
      }, `${CENTER_SELECTOR} option`);
    } catch (error) {
      throw new Error(`Failed to get exam city centers: ${errorMessage(error)}`);
    }
  }

  async submit(exam: ExamDetails): Promise<void> {
    if (!exam.centerCity || !exam.carPlateNumber) {
      throw new Error('Center city and car plate number must be provided');
    }

    const { page, actions, inspector, log } = this.options;
    try {
      log(`Submitting exam details on page at ${page.url()}`);
      await inspector.logClickableControls(page, 'page');

      await page.waitForSelector(CENTER_SELECTOR);
      await inspector.logSelectOptions(page, CENTER_SELECTOR);
      await actions.selectByValueOrText(page, CENTER_SELECTOR, exam.centerCity);

      await page.waitForSelector(PLATE_SELECTOR);
      await page.type(PLATE_SELECTOR, exam.carPlateNumber);

      log('Clicking submitBtn input and waiting for navigation');
      await actions.preNavDelay();
      await actions.clickAndWaitForNavigation(page, SUBMIT_SELECTOR);
    } catch (error) {
      throw new Error(`Failed to submit exam center and plate: ${errorMessage(error)}`);
    }
  }
}

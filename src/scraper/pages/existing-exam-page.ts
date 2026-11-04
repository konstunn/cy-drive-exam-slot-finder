import type { Page } from 'puppeteer';
import { errorMessage } from '../../errors.ts';
import type BrowserActions from '../browser-actions.ts';
import type DebugInspector from '../debug-inspector.ts';

const EXISTING_EXAM_URL = 'https://rtd.mcw.gov.cy/WebPhase1/gui/dlcalendar/CancelRebookCalendar.jsp';
const NEXT_BUTTON_VALUE = 'Next';

interface ExistingExamPageOptions {
  page: Page;
  actions: Pick<BrowserActions, 'preNavDelay' | 'waitForInputButtonByValue' | 'clickAndWaitForNavigation'>;
  inspector: Pick<DebugInspector, 'logClickableControls'>;
  log: (message: string) => void;
}

export default class ExistingExamPage {
  static readonly openDetails = { targetUrl: EXISTING_EXAM_URL } as const;
  static readonly chooseDetails = { expected: `input[type=button] with value ${NEXT_BUTTON_VALUE}` } as const;

  private readonly options: Readonly<ExistingExamPageOptions>;

  constructor(options: ExistingExamPageOptions) {
    this.options = options;
  }

  async open(): Promise<void> {
    const { page, actions } = this.options;
    try {
      await actions.preNavDelay();
      await page.goto(EXISTING_EXAM_URL, { waitUntil: 'domcontentloaded' });
    } catch (error) {
      throw new Error(`Failed to navigate to calendar: ${errorMessage(error)}`);
    }
  }

  async choose(): Promise<void> {
    const { page, actions, inspector, log } = this.options;
    try {
      log('Choosing existing exam');
      log(`Using page at ${page.url()}`);
      await inspector.logClickableControls(page, 'page');

      log('Waiting for existing exam Next button');
      const nextButton = await actions.waitForInputButtonByValue(page, NEXT_BUTTON_VALUE);
      log('Clicking existing exam Next button and waiting for navigation');
      await actions.preNavDelay();
      await actions.clickAndWaitForNavigation(page, nextButton);
      log('Existing exam navigation completed');
    } catch (error) {
      throw new Error(`Failed to choose existing exam: ${errorMessage(error)}`);
    }
  }
}

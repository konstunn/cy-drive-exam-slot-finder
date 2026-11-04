import puppeteer, { type Browser, type Page, type Frame, type ElementHandle, type EvaluateFunc } from 'puppeteer';
import ScraperDebug, { type DebugDetails } from './scraper-debug.ts';
import { errorMessage } from './errors.ts';
import type { BrowserContext, Credentials, ExamDetails, ExamTimeSlot, LogLevel, ScraperOptions } from './types.ts';
import BrowserActions from './scraper/browser-actions.ts';
import DebugInspector from './scraper/debug-inspector.ts';
import StepRunner from './scraper/step-runner.ts';
import LoginPage from './scraper/pages/login-page.ts';

const WAIT_UNTIL = 'domcontentloaded';

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

let currentLogLevel = LOG_LEVELS.INFO;

/**
 * Set the global log level for all scraper instances.
 */
export function setLogLevel(level: LogLevel): void {
  if (LOG_LEVELS[level] !== undefined) {
    currentLogLevel = LOG_LEVELS[level];
  }
}

/**
 * Log a message at a specific level.
 */
function log(message: string, level: LogLevel = 'INFO'): void {
  const messageLevel = LOG_LEVELS[level];
  if (messageLevel <= currentLogLevel) {
    console.log(`[scraper:${level}] ${message}`);
  }
}

function logStep(message: string): void {
  log(message, 'DEBUG');
}

/**
 * ChromeScraper implements slot scraping using Puppeteer
 */
export default class ChromeScraper {
  creds: Credentials | null;
  isLoggedIn: boolean;
  browser: Browser | null;
  page: Page | null;
  debug: ScraperDebug;
  private navDelayMs = 0;
  private readonly actions: BrowserActions;
  private readonly inspector: DebugInspector;
  private readonly steps: StepRunner;

  constructor() {
    this.creds = null;
    this.isLoggedIn = false;
    this.browser = null;
    this.page = null;
    this.debug = this.createDebugRecorder();
    this.steps = new StepRunner({ getPage: () => this.page, getRecorder: () => this.debug });
    this.inspector = new DebugInspector(logStep);
    this.actions = new BrowserActions({
      steps: this.steps,
      inspector: this.inspector,
      getNavDelayMs: () => this.navDelayMs,
      log: logStep
    });
  }

  createDebugRecorder(enabled = process.env.SCRAPER_DEBUG === '1',
    rootDir = process.env.SCRAPER_DEBUG_DIR || 'debug'): ScraperDebug {
    return new ScraperDebug({
      enabled, rootDir,
      getSecrets: () => this.creds ? [this.creds.username, this.creds.password] : [],
      onDirectory: directory => log(`Debug files: ${directory}`, 'INFO'),
      onSnapshot: directory => logStep(`HTML snapshot: ${directory}`),
      onWarning: message => log(message, 'WARN')
    });
  }

  async runStep<T>(step: string, action: () => Promise<T>, details: DebugDetails = {}): Promise<T> {
    return this.steps.run(step, action, details);
  }

  /**
   * Initialize the browser and page
   */
  async initBrowser(timeout = 60000, options: ScraperOptions = {}): Promise<void> {
    if (this.browser) {
      throw new Error('Browser already initialized: call close() before reinitializing');
    }
    // Scraper options must not be forwarded to Puppeteer.
    const { navDelayMs = 0, logLevel = 'INFO',
      debug = process.env.SCRAPER_DEBUG === '1',
      debugDir = process.env.SCRAPER_DEBUG_DIR || 'debug', ...launchOptions } = options;
    this.debug = this.createDebugRecorder(debug, debugDir);
    this.navDelayMs = Number(navDelayMs) || 0;

    // Set the global log level for all scraper operations
    if (logLevel) {
      setLogLevel(logLevel);
      log(`Log level set to ${logLevel}`, 'DEBUG');
    }

    return this.runStep('init-browser', async () => {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ],
        ...launchOptions
      });

      this.page = await this.browser.newPage();
      this.page.setDefaultTimeout(timeout);
    });
  }

  /**
   * Small helper to wait before navigation-triggering actions when configured.
   */
  async preNavDelay(): Promise<void> {
    return this.actions.preNavDelay();
  }

  /**
   * Close the browser and clean up resources
   */
  async close(): Promise<void> {
    return this.runStep('close', async () => {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.page = null;
        this.isLoggedIn = false;
      }
    });
  }

  /**
   * Login to the driving exam booking system
   */
  async login(creds: Credentials): Promise<void> {
    this.creds = creds;
    return this.runStep('login', async () => {
      const loginPage = new LoginPage({
        page: this.getPage(),
        actions: this.actions,
        inspector: this.inspector,
        steps: this.steps,
        log: logStep
      });

      try {
        await loginPage.login(creds);
        this.isLoggedIn = true;
        log('Successfully logged in to driving exam system', 'INFO');
      } catch (error) {
        throw new Error(`Login failed: ${errorMessage(error)}`);
      }
    });
  }

  /**
   * Navigate to the rebooking calendar page
   */
  async navigateToCancelRebook(): Promise<void> {
    return this.runStep('navigate-to-cancel-rebook', async () => {
      const page = this.checkInitializedLoggedIn();

      const url = 'https://rtd.mcw.gov.cy/WebPhase1/gui/dlcalendar/CancelRebookCalendar.jsp';

      try {
        await this.preNavDelay();
        await page.goto(url, { waitUntil: WAIT_UNTIL });
      } catch (error) {
        throw new Error(`Failed to navigate to calendar: ${errorMessage(error)}`);
      }
    }, { targetUrl: 'https://rtd.mcw.gov.cy/WebPhase1/gui/dlcalendar/CancelRebookCalendar.jsp' });
  }

  /**
   * Choose the existing exam to proceed with rebooking
   */
  async chooseExistingExam(): Promise<void> {
    return this.runStep('choose-existing-exam', async () => {
      const page = this.checkInitializedLoggedIn();

      try {
        logStep('Choosing existing exam');
        logStep(`Using page at ${page.url()}`);
        await this.logClickableControls(page, 'page');

        logStep('Waiting for existing exam Next button');
        const nextButton = await this.waitForInputButtonByValue(page, 'Next');
        logStep('Clicking existing exam Next button and waiting for navigation');
        await this.preNavDelay();
        await this.clickElementAndWaitForNavigation(page, nextButton);
        logStep('Existing exam navigation completed');
      } catch (error) {
        throw new Error(`Failed to choose existing exam: ${errorMessage(error)}`);
      }
    }, { expected: 'input[type=button] with value Next' });
  }

  /**
   * Get the list of available exam city centers
   */
  async getExamCityCenters(): Promise<string[]> {
    return this.runStep('get-exam-city-centers', async () => {
      const page = this.checkInitializedLoggedIn();

      try {
        logStep(`Getting exam city centers from page at ${page.url()}`);

        await page.waitForSelector('select[name="h_centre"]');

        const centers = await page.evaluate(() => {
          const options = Array.from(document.querySelectorAll('select[name="h_centre"] option'));
          return options.map(option => (option.textContent ?? '').trim());
        });

        return centers;
      } catch (error) {
        throw new Error(`Failed to get exam city centers: ${errorMessage(error)}`);
      }
    }, { selector: 'select[name="h_centre"]' });
  }

  /**
   * Submit exam details to search for available slots
   */
  async submitExamDetails(exam: ExamDetails): Promise<void> {
    return this.runStep('submit-exam-details', async () => {
      const page = this.checkInitializedLoggedIn();

      if (!exam.centerCity || !exam.carPlateNumber) {
        throw new Error('Center city and car plate number must be provided');
      }

      try {
        logStep(`Submitting exam details on page at ${page.url()}`);
        await this.logClickableControls(page, 'page');

        await page.waitForSelector('select[name="h_centre"]');
        await this.logSelectOptions(page, 'select[name="h_centre"]');
        await this.selectByValueOrText(page, 'select[name="h_centre"]', exam.centerCity);

        await page.waitForSelector('input[name="h_vrm"]');
        await page.type('input[name="h_vrm"]', exam.carPlateNumber);

        logStep('Clicking submitBtn input and waiting for navigation');
        await this.preNavDelay();
        await this.clickAndWaitForNavigation(page, 'input[type="button"][id="submitBtn"]');
      } catch (error) {
        throw new Error(`Failed to submit exam center and plate: ${errorMessage(error)}`);
      }
    }, { selector: 'input[type="button"][id="submitBtn"]' });
  }

  /**
   * Get available time slots
   */
  async getTimeSlots(): Promise<ExamTimeSlot[]> {
    return this.runStep('get-time-slots', async () => {
      const page = this.checkInitializedLoggedIn();

      try {
        logStep(`Getting time slots from page at ${page.url()}`);

        // Wait for the calendar or slot container to appear; selector may vary by page
        // If `.time-slot` isn't present yet, wait a short time for it to arrive
        try {
          await page.waitForSelector('.time-slot', { timeout: 3000 });
        } catch (e) {
          // it's OK if there are no time slots — we'll return an empty array
        }

        // Gather raw slot nodes that have a calendar background image (all color variants)
        const rawSlots = await this.retryEvaluate(page, () => {
          const tds = Array.from(document.querySelectorAll('td[background*="/WebPhase1/images/drivercalendar/"]'));
          return tds.map(td => {
            const bg = td.getAttribute('background') || '';
            const h5 = td.querySelector('h5');
            const timeText = h5 ? (h5.textContent ?? '').trim() : null;
            const a = td.querySelector('a');
            const href = a ? a.getAttribute('href') : null;
            return { background: bg, timeText, href };
          });
        });

        // Parse each raw slot into { datetime, available }
        const slots: ExamTimeSlot[] = [];

        // Get current calendar header (may include year) to help with parsing
        const header = await this.getCalendarMonth();

        for (const s of rawSlots) {
          const bg = (s.background || '').toLowerCase();
          const available = !bg.includes('red');

          let datetime = null;

          // Prefer explicit calendarday + examtime from href if present
          if (s.href) {
            try {
              const url = new URL(s.href, page.url());
              const params = url.searchParams;
              const examtime = params.get('examtime') || params.get('time') || null;
              const calendarday = params.get('calendarday') || params.get('calendardate') || null;

              if (calendarday && examtime) {
                // calendarday expected as DD/MM/YY or DD/MM/YYYY
                const parts = calendarday.split('/').map(p => p.trim());
                const [dayText, monthText, yearText] = parts;
                if (parts.length === 3 && dayText !== undefined && monthText !== undefined && yearText !== undefined) {
                  const day = parseInt(dayText, 10);
                  const month = parseInt(monthText, 10) - 1;
                  let year = parseInt(yearText, 10);
                  if (year < 100) year += 2000;

                  // examtime might include trailing + or spaces
                  const timeMatch = String(examtime).match(/(\d{1,2}):(\d{2})/);
                  if (timeMatch?.[1] && timeMatch[2]) {
                    const hh = parseInt(timeMatch[1], 10);
                    const mm = parseInt(timeMatch[2], 10);
                    datetime = new Date(year, month, day, hh, mm);
                  } else {
                    datetime = new Date(year, month, day);
                  }
                }
              }
            } catch (e) {
              // ignore parse errors and fall back
            }
          }

          // If we couldn't parse a full date, try to parse timeText and guess date using header/year
          if (!datetime && s.timeText) {
            const timeMatch = String(s.timeText).match(/(\d{1,2}):(\d{2})/);
            if (timeMatch?.[1] && timeMatch[2]) {
              const hh = parseInt(timeMatch[1], 10);
              const mm = parseInt(timeMatch[2], 10);
              // try to derive year from header
              let year = (new Date()).getFullYear();
              const yearMatch = String(header || '').match(/(20\d{2}|\d{4}|\d{2})/);
              if (yearMatch?.[1]) {
                let y = parseInt(yearMatch[1], 10);
                if (y < 100) y += 2000;
                if (y >= 1970) year = y;
              }
              // No day information available — set to today's date with parsed time (caller can adjust)
              const today = new Date();
              datetime = new Date(year, today.getMonth(), today.getDate(), hh, mm);
            }
          }

          slots.push({ datetime, available });
        }

        return slots;
      } catch (error) {
        throw new Error(`Failed to get time slots: ${errorMessage(error)}`);
      }
    }, { selector: 'td[background*="/WebPhase1/images/drivercalendar/"]' });
  }

  /**
   * Return only available time slots (filters result of getTimeSlots)
   */
  async getAvailableTimeSlots(): Promise<ExamTimeSlot[]> {
    return this.runStep('get-available-time-slots', async () => {
      const slots = await this.getTimeSlots();
      return Array.isArray(slots) ? slots.filter(s => s && s.available) : [];
    });
  }

  /**
   * Move the calendar to the next month.
   */
  async goToNextCalendarMonth(): Promise<void> {
    return this.runStep('next-calendar-month', async () => {
      const page = this.checkInitializedLoggedIn();

      try {
        logStep('Going to next calendar month');
        await this.logCalendarNavigationControls(page);
        await this.logCurrentCalendarMonth(page);

        const nextMonthButtonHandle = await this.waitForCalendarNextMonthButton(page);

        // get current month label to detect change
        const before = await this.getCalendarMonth(page);

        // Click and wait for calendar header to change
        await this.preNavDelay();
        await nextMonthButtonHandle.click();

        // Wait until calendar header text changes (or timeout)
        try {
          await page.waitForFunction((prev) => {
            const header = document.querySelector('#calendarHeader');
            if (!header) return false;
            return (header.textContent ?? '').replace(/\s+/g, ' ').trim() !== prev;
          }, {}, before);
        } catch (e) {
          // fallback to waiting for network idle or complete state
          try {
            await page.waitForFunction(() => document.readyState === 'complete', { timeout: 5000 });
          } catch (_) {
            // ignore
          }
        }

        logStep('Moved to next calendar month (attempted)');
        await this.logCurrentCalendarMonth(page);
      } catch (error) {
        throw new Error(`Failed to go to next calendar month: ${errorMessage(error)}`);
      }
    }, { expected: 'Next month calendar image button' });
  }

  /**
   * Click on a specific time slot
   */
  async clickTimeSlot(slot: ExamTimeSlot): Promise<void> {
    this.checkInitializedLoggedIn();

    // TODO: Implement time slot clicking logic
    // This depends on the actual HTML structure of the time slots
    console.log('Time slot clicking not yet implemented');
  }

  /**
   * Wait for an input by its name attribute.
   */
  async waitForNamedInput(frame: Frame, name: string): Promise<void> {
    return this.actions.waitForNamedInput(frame, name);
  }

  /**
   * Type into an input by its name attribute.
   */
  async typeNamedInput(frame: Frame, name: string, value: string): Promise<void> {
    return this.actions.typeNamedInput(frame, name, value);
  }

  /**
   * Log visible input names in the current frame for debugging.
   */
  async logFrameInputs(frame: Frame): Promise<void> {
    return this.inspector.logFrameInputs(frame);
  }

  /**
   * Log buttons and submit inputs in the current frame for debugging.
   */
  async logClickableControls(context: BrowserContext, label = 'frame'): Promise<void> {
    return this.inspector.logClickableControls(context, label);
  }

  /**
   * Log select options for debugging form values.
   */
  async logSelectOptions(context: BrowserContext, selector: string): Promise<void> {
    return this.inspector.logSelectOptions(context, selector);
  }

  /**
   * Select an option by value first, then by visible text.
   */
  async selectByValueOrText(context: BrowserContext, selector: string, valueOrText: string): Promise<void> {
    return this.actions.selectByValueOrText(context, selector, valueOrText);
  }

  /**
   * Retry a page/frame evaluate when transient navigation destroys the execution context.
   */
  async retryEvaluate<Params extends unknown[], Func extends EvaluateFunc<Params>>(
    context: BrowserContext, fn: Func, ...args: Params
  ): Promise<Awaited<ReturnType<Func>>> {
    return this.actions.retryEvaluate(context, fn, ...args);
  }

  /**
   * Log calendar navigation images for debugging.
   */
  async logCalendarNavigationControls(context: BrowserContext): Promise<void> {
    return this.inspector.logCalendarNavigationControls(context);
  }

  /**
   * Find the calendar next-month image button.
   */
  async waitForCalendarNextMonthButton(context: BrowserContext): Promise<ElementHandle<HTMLImageElement>> {
    await context.waitForFunction(() => {
      return Array.from(document.querySelectorAll('img')).some(image => {
        const title = image.getAttribute('title') || '';
        const src = image.getAttribute('src') || '';
        const onclick = image.getAttribute('onclick') || '';

        return title.trim() === 'Next month.'
          || src.includes('dlcalendar_nextmonth_black.gif')
          || onclick.includes('addMonths(event, 1)');
      });
    });

    return context.evaluateHandle(() => {
      const image = Array.from(document.querySelectorAll('img')).find(image => {
        const title = image.getAttribute('title') || '';
        const src = image.getAttribute('src') || '';
        const onclick = image.getAttribute('onclick') || '';

        return title.trim() === 'Next month.'
          || src.includes('dlcalendar_nextmonth_black.gif')
          || onclick.includes('addMonths(event, 1)');
      });
      if (!image) throw new Error('Next month calendar button disappeared');
      return image;
    });
  }

  /**
   * Get the current calendar month label.
   */
  async getCalendarMonth(context: BrowserContext = this.getPage()): Promise<string | null> {
    return this.runStep('get-calendar-month', async () => {
      try {
        await context.waitForSelector('#calendarHeader', { timeout: 5000 });
      } catch (e) {
        // no header found, return null
        return null;
      }

      return this.retryEvaluate(context, () => {
        const header = document.querySelector('#calendarHeader');
        if (!header) return null;
        return (header.textContent ?? '').replace(/\s+/g, ' ').trim();
      });
    }, { selector: '#calendarHeader' });
  }

  /**
   * Log the current calendar month label.
   */
  async logCurrentCalendarMonth(context: BrowserContext = this.getPage()): Promise<void> {
    const month = await this.getCalendarMonth(context);
    logStep(`Calendar month: ${month || '<not found>'}`);
  }

  /**
   * Find an input button by its displayed value.
   */
  async waitForInputButtonByValue(context: BrowserContext, value: string): Promise<ElementHandle<HTMLInputElement>> {
    return this.actions.waitForInputButtonByValue(context, value);
  }

  /**
   * Click a selector inside a frame and wait for that frame to navigate.
   */
  async clickAndWaitForNavigation(frame: BrowserContext, selector: string): Promise<void> {
    return this.actions.clickAndWaitForNavigation(frame, selector);
  }

  /**
   * Click an element and wait for the current page to navigate.
   */
  async clickElementAndWaitForNavigation(page: Page, element: ElementHandle<Element>): Promise<void> {
    return this.actions.clickElementAndWaitForNavigation(page, element);
  }

  /**
   * Return the active page, or fail if the browser has not been initialized.
   */
  getPage(): Page {
    if (!this.page) {
      throw new Error('Browser not initialized: call initBrowser() first');
    }

    return this.page;
  }

  checkInitializedLoggedIn(): Page {
    const page = this.getPage();
    if (!this.isLoggedIn) {
      throw new Error('Not logged in: please call login() first');
    }
    return page;
  }
}

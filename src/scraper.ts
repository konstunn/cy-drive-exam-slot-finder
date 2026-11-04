import puppeteer, { type Browser, type Page, type Frame, type ElementHandle, type EvaluateFunc } from 'puppeteer';
import ScraperDebug, { type DebugDetails } from './scraper-debug.ts';
import { errorMessage } from './errors.ts';
import type { BrowserContext, Credentials, ExamDetails, ExamTimeSlot, LogLevel, ScraperOptions } from './types.ts';
import BrowserActions from './scraper/browser-actions.ts';
import DebugInspector from './scraper/debug-inspector.ts';
import StepRunner from './scraper/step-runner.ts';
import LoginPage from './scraper/pages/login-page.ts';
import ExistingExamPage from './scraper/pages/existing-exam-page.ts';
import ExamDetailsPage from './scraper/pages/exam-details-page.ts';
import CalendarPage from './scraper/pages/calendar-page.ts';

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
    return this.runStep('navigate-to-cancel-rebook', () => this.getExistingExamPage().open(),
      ExistingExamPage.openDetails);
  }

  /**
   * Choose the existing exam to proceed with rebooking
   */
  async chooseExistingExam(): Promise<void> {
    return this.runStep('choose-existing-exam', () => this.getExistingExamPage().choose(),
      ExistingExamPage.chooseDetails);
  }

  private getExistingExamPage(): ExistingExamPage {
    return new ExistingExamPage({
      page: this.checkInitializedLoggedIn(),
      actions: this.actions,
      inspector: this.inspector,
      log: logStep
    });
  }

  /**
   * Get the list of available exam city centers
   */
  async getExamCityCenters(): Promise<string[]> {
    return this.runStep('get-exam-city-centers', () => this.getExamDetailsPage().getCenters(),
      ExamDetailsPage.centersDetails);
  }

  /**
   * Submit exam details to search for available slots
   */
  async submitExamDetails(exam: ExamDetails): Promise<void> {
    return this.runStep('submit-exam-details', () => this.getExamDetailsPage().submit(exam),
      ExamDetailsPage.submitDetails);
  }

  private getExamDetailsPage(): ExamDetailsPage {
    return new ExamDetailsPage({
      page: this.checkInitializedLoggedIn(),
      actions: this.actions,
      inspector: this.inspector,
      log: logStep
    });
  }

  /**
   * Get available time slots
   */
  async getTimeSlots(): Promise<ExamTimeSlot[]> {
    return this.runStep('get-time-slots', () => this.getCalendarPage(this.checkInitializedLoggedIn()).getSlots(),
      CalendarPage.slotsDetails);
  }

  /**
   * Return only available time slots (filters result of getTimeSlots)
   */
  async getAvailableTimeSlots(): Promise<ExamTimeSlot[]> {
    return this.runStep('get-available-time-slots',
      () => this.getCalendarPage(this.checkInitializedLoggedIn()).getAvailableSlots());
  }

  /**
   * Move the calendar to the next month.
   */
  async goToNextCalendarMonth(): Promise<void> {
    return this.runStep('next-calendar-month', () => this.getCalendarPage(this.checkInitializedLoggedIn()).nextMonth(),
      CalendarPage.nextMonthDetails);
  }

  /**
   * Click on a specific time slot
   */
  async clickTimeSlot(slot: ExamTimeSlot): Promise<void> {
    return this.getCalendarPage(this.checkInitializedLoggedIn()).clickTimeSlot(slot);
  }

  private getCalendarPage(context: BrowserContext = this.getPage()): CalendarPage {
    return new CalendarPage({ context, actions: this.actions, inspector: this.inspector, steps: this.steps, log: logStep });
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
    return this.getCalendarPage(context).waitForNextMonthButton();
  }

  /**
   * Get the current calendar month label.
   */
  async getCalendarMonth(context: BrowserContext = this.getPage()): Promise<string | null> {
    return this.getCalendarPage(context).getMonth();
  }

  /**
   * Log the current calendar month label.
   */
  async logCurrentCalendarMonth(context: BrowserContext = this.getPage()): Promise<void> {
    return this.getCalendarPage(context).logCurrentMonth();
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

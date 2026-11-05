import puppeteer, { type Browser, type Page } from 'puppeteer';
import ScraperDebug from './scraper-debug.ts';
import { errorMessage } from './errors.ts';
import type { BrowserContext, Credentials, ExamDetails, ExamTimeSlot, LogLevel, ScraperOptions } from './types.ts';
import BrowserActions from './scraper/browser-actions.ts';
import DebugInspector from './scraper/debug-inspector.ts';
import StepRunner from './scraper/step-runner.ts';
import LoginPage from './scraper/pages/login-page.ts';
import ExistingExamPage from './scraper/pages/existing-exam-page.ts';
import ExamDetailsPage from './scraper/pages/exam-details-page.ts';
import CalendarPage from './scraper/pages/calendar-page.ts';
import MainPage from './scraper/pages/main-page.ts';

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

  private createDebugRecorder(enabled = process.env.SCRAPER_DEBUG === '1',
    rootDir = process.env.SCRAPER_DEBUG_DIR || 'debug'): ScraperDebug {
    return new ScraperDebug({
      enabled, rootDir,
      getSecrets: () => this.creds ? [this.creds.username, this.creds.password] : [],
      onDirectory: directory => log(`Debug files: ${directory}`, 'INFO'),
      onSnapshot: directory => logStep(`HTML snapshot: ${directory}`),
      onWarning: message => log(message, 'WARN')
    });
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

    return this.steps.run('init-browser', async () => {
      this.browser = await puppeteer.launch({
        headless: true,
        defaultViewport: null,
        ...launchOptions,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          ...(launchOptions.args ?? [])
        ]
      });

      this.page = await this.browser.newPage();
      this.page.setDefaultTimeout(timeout);
    });
  }

  /**
   * Close the browser and clean up resources
   */
  async close(): Promise<void> {
    return this.steps.run('close', async () => {
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
  async login(creds: Credentials): Promise<MainPage> {
    this.creds = creds;
    return this.steps.run('login', async () => {
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
        return new MainPage({
          page: this.getPage(), actions: this.actions, inspector: this.inspector, steps: this.steps, log: logStep
        });
      } catch (error) {
        throw new Error(`Login failed: ${errorMessage(error)}`);
      }
    });
  }

  /**
   * Navigate to the rebooking calendar page
   */
  async navigateToCancelRebook(): Promise<void> {
    return this.steps.run('navigate-to-cancel-rebook', () => this.getExistingExamPage().open(),
      ExistingExamPage.openDetails);
  }

  /**
   * Choose the existing exam to proceed with rebooking
   */
  async chooseExistingExam(): Promise<void> {
    return this.steps.run('choose-existing-exam', () => this.getExistingExamPage().choose(),
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
    return this.steps.run('get-exam-city-centers', () => this.getExamDetailsPage().getCenters(),
      ExamDetailsPage.centersDetails);
  }

  /**
   * Submit exam details to search for available slots
   */
  async submitExamDetails(exam: ExamDetails): Promise<void> {
    return this.steps.run('submit-exam-details', () => this.getExamDetailsPage().submit(exam),
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
    return this.steps.run('get-time-slots', () => this.getCalendarPage(this.checkInitializedLoggedIn()).getSlots(),
      CalendarPage.slotsDetails);
  }

  /**
   * Return only available time slots (filters result of getTimeSlots)
   */
  async getAvailableTimeSlots(): Promise<ExamTimeSlot[]> {
    return this.steps.run('get-available-time-slots',
      () => this.getCalendarPage(this.checkInitializedLoggedIn()).getAvailableSlots());
  }

  /**
   * Move the calendar to the next month.
   */
  async goToNextCalendarMonth(): Promise<void> {
    return this.steps.run('next-calendar-month', () => this.getCalendarPage(this.checkInitializedLoggedIn()).nextMonth(),
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
   * Get the current calendar month label.
   */
  async getCalendarMonth(context: BrowserContext = this.getPage()): Promise<string | null> {
    return this.getCalendarPage(context).getMonth();
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

  private checkInitializedLoggedIn(): Page {
    const page = this.getPage();
    if (!this.isLoggedIn) {
      throw new Error('Not logged in: please call login() first');
    }
    return page;
  }
}

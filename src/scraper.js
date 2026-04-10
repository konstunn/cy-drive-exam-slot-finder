const puppeteer = require('puppeteer');

const TOP_FRAME_NAME = 'top';
const TOP_FRAME_URL_PART = 'TPRTDLogo.jsp';
const WAIT_UNTIL = 'domcontentloaded';

function logStep(message) {
  console.log(`[scraper] ${message}`);
}

/**
 * ChromeScraper implements slot scraping using Puppeteer
 */
class ChromeScraper {
  constructor() {
    this.creds = null;
    this.isLoggedIn = false;
    this.browser = null;
    this.page = null;
  }

  /**
   * Initialize the browser and page
   * @param {number} timeout - Timeout in milliseconds
   * @param {Object} options - Additional options
   */
  async initBrowser(timeout = 60000, options = {}) {
    if (this.browser) {
      throw new Error('Browser already initialized: call close() before reinitializing');
    }

    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ],
      ...options
    });

    this.page = await this.browser.newPage();
    this.page.setDefaultTimeout(timeout);
  }

  /**
   * Close the browser and clean up resources
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      this.isLoggedIn = false;
    }
  }

  /**
   * Login to the driving exam booking system
   * @param {Credentials} creds
   */
  async login(creds) {
    if (!this.page) {
      throw new Error('Browser not initialized: call initBrowser() first');
    }

    this.creds = creds;

    const loginURL = 'https://rtd.mcw.gov.cy';

    try {
      logStep(`Opening login page: ${loginURL}`);
      await this.page.goto(loginURL, { waitUntil: WAIT_UNTIL });
      logStep('Login page loaded');

      const frame = await this.getTopFrame();
      logStep(`Using frame "${frame.name()}" at ${frame.url()}`);
      await this.logFrameInputs(frame);

      logStep('Waiting for username input');
      await this.waitForNamedInput(frame, 'h_USERNAME');
      logStep('Typing username');
      await this.typeNamedInput(frame, 'h_USERNAME', creds.username);

      logStep('Waiting for password input');
      await this.waitForNamedInput(frame, 'h_PASSWORD');
      logStep('Typing password');
      await this.typeNamedInput(frame, 'h_PASSWORD', creds.password);

      logStep('Clicking login submit and waiting for navigation');
      await this.clickAndWaitForNavigation(frame, 'input[type="submit"][name="h_LOGIN"]');
      logStep('Login navigation completed');

      this.isLoggedIn = true;
      console.log('Successfully logged in to driving exam system');
    } catch (error) {
      throw new Error(`Login failed: ${error.message}`);
    }
  }

  /**
   * Navigate to the rebooking calendar page
   */
  async navigateToCancelRebook() {
    this.checkInitializedLoggedIn();

    const url = 'https://rtd.mcw.gov.cy/WebPhase1/gui/dlcalendar/CancelRebookCalendar.jsp';

    try {
      await this.page.goto(url, { waitUntil: WAIT_UNTIL });
    } catch (error) {
      throw new Error(`Failed to navigate to calendar: ${error.message}`);
    }
  }

  /**
   * Choose the existing exam to proceed with rebooking
   */
  async chooseExistingExam() {
    this.checkInitializedLoggedIn();

    try {
      logStep('Choosing existing exam');
      logStep(`Using page at ${this.page.url()}`);
      await this.logClickableControls(this.page, 'page');

      logStep('Waiting for existing exam Next button');
      const nextButton = await this.waitForInputButtonByValue(this.page, 'Next');
      logStep('Clicking existing exam Next button and waiting for navigation');
      await this.clickElementAndWaitForNavigation(this.page, nextButton);
      logStep('Existing exam navigation completed');
    } catch (error) {
      throw new Error(`Failed to choose existing exam: ${error.message}`);
    }
  }

  /**
   * Get the list of available exam city centers
   * @returns {Promise<string[]>}
   */
  async getExamCityCenters() {
    this.checkInitializedLoggedIn();

    try {
      logStep(`Getting exam city centers from page at ${this.page.url()}`);

      await this.page.waitForSelector('select[name="h_centre"]');

      const centers = await this.page.evaluate(() => {
        const options = Array.from(document.querySelectorAll('select[name="h_centre"] option'));
        return options.map(option => option.textContent.trim());
      });

      return centers;
    } catch (error) {
      throw new Error(`Failed to get exam city centers: ${error.message}`);
    }
  }

  /**
   * Submit exam details to search for available slots
   * @param {ExamDetails} exam
   */
  async submitExamDetails(exam) {
    this.checkInitializedLoggedIn();

    if (!exam.centerCity || !exam.carPlateNumber) {
      throw new Error('Center city and car plate number must be provided');
    }

    try {
      logStep(`Submitting exam details on page at ${this.page.url()}`);
      await this.logClickableControls(this.page, 'page');

      await this.page.waitForSelector('select[name="h_centre"]');
      await this.logSelectOptions(this.page, 'select[name="h_centre"]');
      await this.selectByValueOrText(this.page, 'select[name="h_centre"]', exam.centerCity);

      await this.page.waitForSelector('input[name="h_vrm"]');
      await this.page.type('input[name="h_vrm"]', exam.carPlateNumber);

      logStep('Clicking submitBtn input and waiting for navigation');
      await this.clickAndWaitForNavigation(this.page, 'input[type="button"][id="submitBtn"]');
    } catch (error) {
      throw new Error(`Failed to submit exam center and plate: ${error.message}`);
    }
  }

  /**
   * Get available time slots
   * @returns {Promise<Date[]>}
   */
  async getTimeSlots() {
    this.checkInitializedLoggedIn();

    try {
      logStep(`Getting time slots from page at ${this.page.url()}`);

      await this.page.waitForSelector('body');

      const timeSlots = await this.page.evaluate(() => {
        // This selector needs to be adjusted based on the actual HTML structure
        const slots = Array.from(document.querySelectorAll('.time-slot'));
        return slots.map(slot => slot.textContent.trim());
      });

      // Convert string times to Date objects
      // This is a placeholder - actual implementation depends on the HTML structure
      return timeSlots.map(slot => new Date()); // Placeholder
    } catch (error) {
      throw new Error(`Failed to get time slots: ${error.message}`);
    }
  }

  /**
   * Move the calendar to the next month.
   */
  async goToNextCalendarMonth() {
    this.checkInitializedLoggedIn();

    try {
      logStep('Going to next calendar month');
      await this.logCalendarNavigationControls(this.page);
      await this.logCalendarMonth(this.page);

      const nextMonthButton = await this.waitForCalendarNextMonthButton(this.page);
      await nextMonthButton.click();

      logStep('Clicked next calendar month');
      await this.page.waitForFunction(() => document.readyState === 'complete');
      await this.logCalendarMonth(this.page);
    } catch (error) {
      throw new Error(`Failed to go to next calendar month: ${error.message}`);
    }
  }

  /**
   * Click on a specific time slot
   * @param {Date} slot
   */
  async clickTimeSlot(slot) {
    this.checkInitializedLoggedIn();

    // TODO: Implement time slot clicking logic
    // This depends on the actual HTML structure of the time slots
    console.log('Time slot clicking not yet implemented');
  }

  /**
   * Get the application frame that contains the driving exam UI.
   */
  async getTopFrame() {
    if (!this.page) {
      throw new Error('Browser not initialized: call initBrowser() first');
    }

    const frames = this.page.frames();
    logStep(`Available frames: ${frames.map(frame => {
      const name = frame.name() || '<unnamed>';
      return `${name} (${frame.url()})`;
    }).join(', ')}`);

    const frame = this.page.frames().find(pageFrame => this.isTopFrame(pageFrame));
    if (frame) {
      return frame;
    }

    logStep(`Waiting for frame named "${TOP_FRAME_NAME}" with URL containing "${TOP_FRAME_URL_PART}"`);
    return this.page.waitForFrame(pageFrame => this.isTopFrame(pageFrame));
  }

  /**
   * Check whether a Puppeteer frame is the application top frame.
   * @param {import('puppeteer').Frame} frame
   * @returns {boolean}
   */
  isTopFrame(frame) {
    return frame.name() === TOP_FRAME_NAME && frame.url().includes(TOP_FRAME_URL_PART);
  }

  /**
   * Wait for an input by its name attribute.
   * @param {import('puppeteer').Frame} frame
   * @param {string} name
   */
  async waitForNamedInput(frame, name) {
    try {
      await frame.waitForFunction(inputName => {
        return document.getElementsByName(inputName).length > 0;
      }, {}, name);
    } catch (error) {
      await this.logFrameInputs(frame);
      throw error;
    }
  }

  /**
   * Type into an input by its name attribute.
   * @param {import('puppeteer').Frame} frame
   * @param {string} name
   * @param {string} value
   */
  async typeNamedInput(frame, name, value) {
    const input = await frame.$(`input[name="${name}"]`);
    if (!input) {
      throw new Error(`Input not found: ${name}`);
    }

    await input.type(value);
  }

  /**
   * Log visible input names in the current frame for debugging.
   * @param {import('puppeteer').Frame} frame
   */
  async logFrameInputs(frame) {
    const inputs = await frame.evaluate(() => {
      return Array.from(document.querySelectorAll('input')).map(input => {
        const type = input.getAttribute('type') || '<no type>';
        const name = input.getAttribute('name') || '<no name>';
        const id = input.id || '<no id>';

        return `${type} name=${name} id=${id}`;
      });
    });

    logStep(`Inputs in frame "${frame.name()}": ${inputs.length ? inputs.join(', ') : '<none>'}`);
  }

  /**
   * Log buttons and submit inputs in the current frame for debugging.
   * @param {import('puppeteer').Frame|import('puppeteer').Page} context
   * @param {string} label
   */
  async logClickableControls(context, label = 'frame') {
    const controls = await context.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button')).map(button => {
        const type = button.getAttribute('type') || '<no type>';
        const name = button.getAttribute('name') || '<no name>';
        const id = button.id || '<no id>';
        const text = button.textContent.trim() || '<no text>';

        return `button type=${type} name=${name} id=${id} text=${text}`;
      });

      const submitInputs = Array.from(document.querySelectorAll('input[type="submit"]')).map(input => {
        const name = input.getAttribute('name') || '<no name>';
        const id = input.id || '<no id>';
        const value = input.getAttribute('value') || '<no value>';

        return `submit name=${name} id=${id} value=${value}`;
      });

      const buttonInputs = Array.from(document.querySelectorAll('input[type="button"]')).map(input => {
        const name = input.getAttribute('name') || '<no name>';
        const id = input.id || '<no id>';
        const value = input.getAttribute('value') || '<no value>';
        const onclick = input.getAttribute('onclick') || '<no onclick>';

        return `input-button name=${name} id=${id} value=${value} onclick=${onclick}`;
      });

      return buttons.concat(submitInputs, buttonInputs);
    });

    logStep(`Clickable controls in ${label}: ${controls.length ? controls.join(', ') : '<none>'}`);
  }

  /**
   * Log select options for debugging form values.
   * @param {import('puppeteer').Frame|import('puppeteer').Page} context
   * @param {string} selector
   */
  async logSelectOptions(context, selector) {
    const options = await context.evaluate(selectSelector => {
      const select = document.querySelector(selectSelector);
      if (!select) {
        return null;
      }

      return Array.from(select.options).map(option => {
        return `value=${option.value} text=${option.textContent.trim()}`;
      });
    }, selector);

    logStep(`Options for ${selector}: ${options ? options.join(', ') : '<select not found>'}`);
  }

  /**
   * Select an option by value first, then by visible text.
   * @param {import('puppeteer').Frame|import('puppeteer').Page} context
   * @param {string} selector
   * @param {string} valueOrText
   */
  async selectByValueOrText(context, selector, valueOrText) {
    const selectedValue = await context.evaluate((selectSelector, expected) => {
      const select = document.querySelector(selectSelector);
      if (!select) {
        return null;
      }

      const expectedText = String(expected).trim();
      const option = Array.from(select.options).find(item => {
        return item.value === expectedText || item.textContent.trim() === expectedText;
      });

      if (!option) {
        return null;
      }

      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return option.value;
    }, selector, valueOrText);

    if (!selectedValue) {
      throw new Error(`Could not find option "${valueOrText}" for ${selector}`);
    }

    logStep(`Selected ${selector} option value=${selectedValue}`);
  }

  /**
   * Log calendar navigation images for debugging.
   * @param {import('puppeteer').Frame|import('puppeteer').Page} context
   */
  async logCalendarNavigationControls(context) {
    const controls = await context.evaluate(() => {
      return Array.from(document.querySelectorAll('img')).map(image => {
        const title = image.getAttribute('title') || '<no title>';
        const src = image.getAttribute('src') || '<no src>';
        const onclick = image.getAttribute('onclick') || '<no onclick>';

        return `img title=${title} src=${src} onclick=${onclick}`;
      });
    });

    logStep(`Calendar image controls: ${controls.length ? controls.join(', ') : '<none>'}`);
  }

  /**
   * Find the calendar next-month image button.
   * @param {import('puppeteer').Frame|import('puppeteer').Page} context
   */
  async waitForCalendarNextMonthButton(context) {
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
      return Array.from(document.querySelectorAll('img')).find(image => {
        const title = image.getAttribute('title') || '';
        const src = image.getAttribute('src') || '';
        const onclick = image.getAttribute('onclick') || '';

        return title.trim() === 'Next month.'
          || src.includes('dlcalendar_nextmonth_black.gif')
          || onclick.includes('addMonths(event, 1)');
      });
    });
  }

  /**
   * Get the current calendar month label.
   * @param {import('puppeteer').Frame|import('puppeteer').Page} context
   * @returns {Promise<string|null>}
   */
  async getCalendarMonth(context = this.page) {
    return context.evaluate(() => {
      const header = document.querySelector('#calendarHeader');
      if (!header) {
        return null;
      }

      return header.textContent.replace(/\s+/g, ' ').trim();
    });
  }

  /**
   * Log the current calendar month label.
   * @param {import('puppeteer').Frame|import('puppeteer').Page} context
   */
  async logCalendarMonth(context = this.page) {
    const month = await this.getCalendarMonth(context);
    logStep(`Calendar month: ${month || '<not found>'}`);
  }

  /**
   * Find an input button by its displayed value.
   * @param {import('puppeteer').Frame|import('puppeteer').Page} context
   * @param {string} value
   */
  async waitForInputButtonByValue(context, value) {
    await context.waitForFunction(expectedValue => {
      return Array.from(document.querySelectorAll('input[type="button"]')).some(input => {
        return input.value.trim() === expectedValue;
      });
    }, {}, value);

    return context.evaluateHandle(expectedValue => {
      return Array.from(document.querySelectorAll('input[type="button"]')).find(input => {
        return input.value.trim() === expectedValue;
      });
    }, value);
  }

  /**
   * Click a selector inside a frame and wait for that frame to navigate.
   * @param {import('puppeteer').Frame} frame
   * @param {string} selector
   */
  async clickAndWaitForNavigation(frame, selector) {
    await Promise.all([
      frame.waitForNavigation({ waitUntil: WAIT_UNTIL }),
      frame.click(selector)
    ]);
  }

  /**
   * Click an element and wait for the current page to navigate.
   * @param {import('puppeteer').Page} page
   * @param {import('puppeteer').ElementHandle} element
   */
  async clickElementAndWaitForNavigation(page, element) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: WAIT_UNTIL }),
      element.click()
    ]);
  }

  /**
   * Check if browser is initialized and user is logged in
   */
  checkInitializedLoggedIn() {
    if (!this.page) {
      throw new Error('Browser not initialized: call initBrowser() first');
    }

    if (!this.isLoggedIn) {
      throw new Error('Not logged in: please call login() first');
    }
  }
}

module.exports = ChromeScraper;

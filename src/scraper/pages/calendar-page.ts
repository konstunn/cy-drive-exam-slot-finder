import type { ElementHandle } from 'puppeteer';
import { errorMessage } from '../../errors.ts';
import type { BrowserContext, ExamTimeSlot } from '../../types.ts';
import type BrowserActions from '../browser-actions.ts';
import type DebugInspector from '../debug-inspector.ts';
import { parseSlots } from '../slot-parser.ts';
import type { StepExecutor } from '../step-runner.ts';

const SLOT_SELECTOR = 'td[background*="/WebPhase1/images/drivercalendar/"]';
const HEADER_SELECTOR = '#calendarHeader';

interface CalendarPageOptions {
  context: BrowserContext;
  actions: Pick<BrowserActions, 'retryEvaluate' | 'preNavDelay'>;
  inspector: Pick<DebugInspector, 'logCalendarNavigationControls'>;
  steps: StepExecutor;
  log: (message: string) => void;
}

export default class CalendarPage {
  static readonly slotsDetails = { selector: SLOT_SELECTOR } as const;
  static readonly nextMonthDetails = { expected: 'Next month calendar image button' } as const;

  private readonly options: Readonly<CalendarPageOptions>;

  constructor(options: CalendarPageOptions) {
    this.options = options;
  }

  async getSlots(): Promise<ExamTimeSlot[]> {
    const { context, actions, log } = this.options;
    try {
      log(`Getting time slots from page at ${context.url()}`);
      try {
        await context.waitForSelector('.time-slot', { timeout: 3000 });
      } catch {
        // The container is optional; the calendar cells are still inspected.
      }
      const rawSlots = await actions.retryEvaluate(context, (selector: string) => {
        return Array.from(document.querySelectorAll(selector)).map(td => {
          const h5 = td.querySelector('h5');
          return {
            background: td.getAttribute('background') || '',
            timeText: h5 ? (h5.textContent ?? '').trim() : null,
            href: td.querySelector('a')?.getAttribute('href') ?? null
          };
        });
      }, SLOT_SELECTOR);
      const calendarHeader = await this.getMonth();
      return parseSlots(rawSlots, { pageUrl: context.url(), calendarHeader, referenceDate: new Date() });
    } catch (error) {
      throw new Error(`Failed to get time slots: ${errorMessage(error)}`);
    }
  }

  async getAvailableSlots(): Promise<ExamTimeSlot[]> {
    const slots = await this.options.steps.run('get-time-slots', () => this.getSlots(), CalendarPage.slotsDetails);
    return Array.isArray(slots) ? slots.filter(slot => slot && slot.available) : [];
  }

  async getMonth(): Promise<string | null> {
    const { context, actions, steps } = this.options;
    return steps.run('get-calendar-month', async () => {
      try {
        await context.waitForSelector(HEADER_SELECTOR, { timeout: 5000 });
      } catch {
        return null;
      }
      return actions.retryEvaluate(context, (selector: string) => {
        const header = document.querySelector(selector);
        return header ? (header.textContent ?? '').replace(/\s+/g, ' ').trim() : null;
      }, HEADER_SELECTOR);
    }, { selector: HEADER_SELECTOR });
  }

  async logCurrentMonth(): Promise<void> {
    const month = await this.getMonth();
    this.options.log(`Calendar month: ${month || '<not found>'}`);
  }

  async nextMonth(): Promise<void> {
    const { context, actions, inspector, log } = this.options;
    try {
      log('Going to next calendar month');
      await inspector.logCalendarNavigationControls(context);
      await this.logCurrentMonth();
      const nextMonthButton = await this.waitForNextMonthButton();
      const before = await this.getMonth();
      await actions.preNavDelay();
      await nextMonthButton.click();
      try {
        await context.waitForFunction((previous, selector) => {
          const header = document.querySelector(selector);
          return header !== null && (header.textContent ?? '').replace(/\s+/g, ' ').trim() !== previous;
        }, {}, before, HEADER_SELECTOR);
      } catch {
        // A navigation can complete without an observable header change.
        try {
          await context.waitForFunction(() => document.readyState === 'complete', { timeout: 5000 });
        } catch {
          // Still attempt the final month read if the completion wait times out.
        }
      }
      log('Moved to next calendar month (attempted)');
      await this.logCurrentMonth();
    } catch (error) {
      throw new Error(`Failed to go to next calendar month: ${errorMessage(error)}`);
    }
  }

  async waitForNextMonthButton(): Promise<ElementHandle<HTMLImageElement>> {
    const { context } = this.options;
    await context.waitForFunction(() => {
      return Array.from(document.querySelectorAll('img')).some(image => {
        return (image.getAttribute('title') || '').trim() === 'Next month.'
          || (image.getAttribute('src') || '').includes('dlcalendar_nextmonth_black.gif')
          || (image.getAttribute('onclick') || '').includes('addMonths(event, 1)');
      });
    });
    return context.evaluateHandle(() => {
      const image = Array.from(document.querySelectorAll('img')).find(image => {
        return (image.getAttribute('title') || '').trim() === 'Next month.'
          || (image.getAttribute('src') || '').includes('dlcalendar_nextmonth_black.gif')
          || (image.getAttribute('onclick') || '').includes('addMonths(event, 1)');
      });
      if (!image) throw new Error('Next month calendar button disappeared');
      return image;
    });
  }

  async clickTimeSlot(_slot: ExamTimeSlot): Promise<void> {
    // Booking behavior has not been implemented yet.
    console.log('Time slot clicking not yet implemented');
  }
}

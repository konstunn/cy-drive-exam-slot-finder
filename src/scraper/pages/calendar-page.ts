import type { ElementHandle } from 'puppeteer';
import { errorMessage } from '../../errors.ts';
import type { BrowserContext, ExamTimeSlot, SlotSearchOptions } from '../../types.ts';
import type BrowserActions from '../browser-actions.ts';
import { calendarWeekStart, formatCalendarDate, parseCalendarDate } from '../calendar-date.ts';
import type DebugInspector from '../debug-inspector.ts';
import { parseSlots } from '../slot-parser.ts';
import type { StepExecutor } from '../step-runner.ts';

const SLOT_SELECTOR = 'td[background*="/WebPhase1/images/drivercalendar/"]';
const HEADER_SELECTOR = '#calendarHeader';
const CALENDAR_FORM_SELECTOR = 'form[name="vrmSearch"]';

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

  async waitUntilReady(): Promise<this> {
    const { context, steps } = this.options;
    return steps.run('wait-for-calendar-page', async () => {
      await context.waitForFunction(selector => {
        const header = document.querySelector(selector);
        return document.readyState !== 'loading' && Boolean(header?.textContent?.trim());
      }, {}, HEADER_SELECTOR);
      return this;
    }, { selector: HEADER_SELECTOR });
  }

  async getSlots(): Promise<ExamTimeSlot[]> {
    const { context, actions, log } = this.options;
    try {
      log(`Getting time slots from page at ${context.url()}`);
      const rawSlots = await actions.retryEvaluate(context, (selector: string) => {
        const datesByTable = new Map<HTMLTableElement, string[]>();
        return Array.from(document.querySelectorAll<HTMLTableCellElement>(selector)).map(td => {
          const h5 = td.querySelector('h5');
          const table = td.closest('table');
          if (table && !datesByTable.has(table)) {
            const dates = Array.from(table.rows).flatMap(row => Array.from(row.cells))
              .filter(cell => !cell.querySelector('table'))
              .flatMap(cell => (cell.textContent ?? '').match(/\b\d{1,2}\/\d{1,2}\/\d{2}(?:\d{2})?\b/) ?? []);
            datesByTable.set(table, dates);
          }
          return {
            background: td.getAttribute('background') || '',
            timeText: h5 ? (h5.textContent ?? '').trim() : null,
            href: td.querySelector('a')?.getAttribute('href') ?? null,
            dateText: table ? datesByTable.get(table)?.[td.cellIndex] ?? null : null
          };
        });
      }, SLOT_SELECTOR);
      await this.getMonth();
      return parseSlots(rawSlots, { pageUrl: context.url() });
    } catch (error) {
      throw new Error(`Failed to get time slots: ${errorMessage(error)}`);
    }
  }

  async getAvailableSlots(): Promise<ExamTimeSlot[]> {
    const slots = await this.options.steps.run('get-time-slots', () => this.getSlots(), CalendarPage.slotsDetails);
    return Array.isArray(slots) ? slots.filter(slot => slot && slot.available) : [];
  }

  private async getWeekState() {
    const raw = await this.options.actions.retryEvaluate(this.options.context, (selector: string) => {
      const form = document.querySelector<HTMLFormElement>(selector);
      const value = (name: string) => form?.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ?? '';
      const dates = Array.from(form?.querySelectorAll('td, th') ?? [])
        .filter(cell => !cell.querySelector('table'))
        .flatMap(cell => (cell.textContent ?? '').match(/\b\d{1,2}\/\d{1,2}\/\d{2}(?:\d{2})?\b/) ?? []);
      return { start: value('startingdate'), end: value('enddate'), selected: value('asd'), dates };
    }, CALENDAR_FORM_SELECTOR);
    const start = parseCalendarDate(raw.start);
    const end = parseCalendarDate(raw.end);
    const selected = parseCalendarDate(raw.selected);
    const dates = raw.dates.map(parseCalendarDate);
    if (!start || !end || !selected || start > end || !dates.length || dates.some(date => !date)) {
      throw new Error('Cannot determine the calendar booking period and displayed week');
    }
    return { start, end, selected, dates: dates.filter((date): date is Date => date !== null) };
  }

  async goToDate(date: Date): Promise<this> {
    const { context, actions, steps } = this.options;
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid calendar date');
    const dateText = formatCalendarDate(date);
    return steps.run('load-calendar-week', async () => {
      const state = await this.getWeekState();
      const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      if (day < state.start || day > state.end) throw new Error('Date is outside the calendar booking period');
      await actions.preNavDelay();
      await Promise.all([
        context.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        context.evaluate((selector, requestedDate) => {
          const form = document.querySelector<HTMLFormElement>(selector);
          const input = form?.querySelector<HTMLInputElement>('input[name="asd"]');
          if (!form || !input) throw new Error('Calendar date form not found');
          input.value = requestedDate;
          HTMLFormElement.prototype.submit.call(form);
        }, CALENDAR_FORM_SELECTOR, dateText)
      ]);
      await this.waitUntilReady();
      const loaded = await this.getWeekState();
      if (formatCalendarDate(loaded.selected) !== dateText) throw new Error('Calendar did not load the requested date');
      return this;
    }, { selector: CALENDAR_FORM_SELECTOR, expected: `Week containing ${dateText}` });
  }

  async findNearestAvailableSlot({ from = new Date(), until }: SlotSearchOptions = {}): Promise<ExamTimeSlot | null> {
    const { steps, log } = this.options;
    return steps.run('find-nearest-available-slot', async () => {
      if (!Number.isFinite(from.getTime()) || (until && !Number.isFinite(until.getTime()))) {
        throw new Error('Invalid slot search date range');
      }
      await this.waitUntilReady();
      let state = await this.getWeekState();
      const endOfPeriod = new Date(state.end);
      endOfPeriod.setHours(23, 59, 59, 999);
      const first = Math.max(from.getTime(), state.start.getTime());
      const last = Math.min(until?.getTime() ?? Infinity, endOfPeriod.getTime());
      if (first > last) return null;
      const week = calendarWeekStart(new Date(first));
      while (week.getTime() <= last) {
        if (calendarWeekStart(state.selected).getTime() !== week.getTime()) {
          await this.goToDate(new Date(Math.max(week.getTime(), first)));
          state = await this.getWeekState();
        }
        if (state.dates.some(date => calendarWeekStart(date).getTime() !== week.getTime())) {
          throw new Error('Calendar displayed a different week than requested');
        }
        log(`Checking calendar week starting ${formatCalendarDate(week)}`);
        const slots = await this.getAvailableSlots();
        let nearest: ExamTimeSlot | null = null;
        for (const slot of slots) {
          if (!slot.datetime) throw new Error('Cannot determine the date and time of a non-red slot');
          const time = slot.datetime.getTime();
          if (time >= first && time <= last && (!nearest?.datetime || time < nearest.datetime.getTime())) nearest = slot;
        }
        if (nearest) return nearest;
        week.setDate(week.getDate() + 7);
      }
      return null;
    }, { expected: 'Nearest non-red slot within the calendar booking period' });
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
      try {
        const before = await this.getMonth();
        await actions.preNavDelay();
        await nextMonthButton.click();
        await context.waitForFunction((previous, selector) => {
          const header = document.querySelector(selector);
          return header !== null && (header.textContent ?? '').replace(/\s+/g, ' ').trim() !== previous;
        }, {}, before, HEADER_SELECTOR);
      } finally {
        await nextMonthButton.dispose();
      }
      log('Moved to next calendar month');
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

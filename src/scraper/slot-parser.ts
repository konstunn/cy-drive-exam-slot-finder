import type { ExamTimeSlot } from '../types.ts';
import { parseCalendarDate } from './calendar-date.ts';

export interface RawTimeSlot {
  background: string;
  timeText: string | null;
  href: string | null;
  dateText?: string | null;
}

interface SlotParseContext {
  pageUrl: string;
}

function parseDateTime(dateText: string | null | undefined, timeText: string | null): Date | null {
  if (!dateText || !timeText) return null;
  const date = parseCalendarDate(dateText);
  const time = /(?:^|\D)(\d{1,2}):(\d{2})(?!\d)/.exec(timeText);
  if (!date || !time) return null;
  const hours = Number(time[1]);
  const minutes = Number(time[2]);
  if (hours > 23 || minutes > 59) return null;
  date.setHours(hours, minutes);
  return date;
}

export function parseSlots(rawSlots: readonly RawTimeSlot[], { pageUrl }: SlotParseContext): ExamTimeSlot[] {
  return rawSlots.map(slot => {
    let datetime: Date | null = null;
    if (slot.href) {
      try {
        const params = new URL(slot.href, pageUrl).searchParams;
        datetime = parseDateTime(params.get('calendarday') || params.get('calendardate'),
          params.get('examtime') || params.get('time') || slot.timeText);
      } catch {
        // Use the timetable column below if the link is not a URL.
      }
    }
    datetime ??= parseDateTime(slot.dateText, slot.timeText);
    return { datetime, available: !slot.background.toLowerCase().includes('red') };
  });
}

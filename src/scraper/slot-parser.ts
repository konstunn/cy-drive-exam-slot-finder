import type { ExamTimeSlot } from '../types.ts';

export interface RawTimeSlot {
  background: string;
  timeText: string | null;
  href: string | null;
}

interface SlotParseContext {
  pageUrl: string;
  calendarHeader: string | null;
  referenceDate: Date;
}

export function parseSlots(rawSlots: readonly RawTimeSlot[],
  { pageUrl, calendarHeader, referenceDate }: SlotParseContext): ExamTimeSlot[] {
  const slots: ExamTimeSlot[] = [];
  for (const s of rawSlots) {
    const bg = (s.background || '').toLowerCase();
    const available = !bg.includes('red');

    let datetime = null;

    // Prefer explicit calendarday + examtime from href if present
    if (s.href) {
      try {
        const url = new URL(s.href, pageUrl);
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
        let year = referenceDate.getFullYear();
        const yearMatch = String(calendarHeader || '').match(/(20\d{2}|\d{4}|\d{2})/);
        if (yearMatch?.[1]) {
          let y = parseInt(yearMatch[1], 10);
          if (y < 100) y += 2000;
          if (y >= 1970) year = y;
        }
        // No day information available — set to today's date with parsed time (caller can adjust)
        const today = referenceDate;
        datetime = new Date(year, today.getMonth(), today.getDate(), hh, mm);
      }
    }

    slots.push({ datetime, available });
  }

  return slots;
}

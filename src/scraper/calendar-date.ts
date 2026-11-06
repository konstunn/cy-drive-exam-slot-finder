/** Parse the date formats used by the booking form and weekly column headings. */
export function parseCalendarDate(value: string): Date | null {
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const local = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (!iso && !local) return null;
  const yearText = iso?.[1] ?? local?.[3] ?? '';
  const year = Number(yearText) + (yearText.length === 2 ? 2000 : 0);
  const month = Number(iso?.[2] ?? local?.[2]) - 1;
  const day = Number(iso?.[3] ?? local?.[1]);
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}

export function formatCalendarDate(date: Date): string {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

export function calendarWeekStart(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  return monday;
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSlots } from '../src/scraper/slot-parser.ts';
import { calendarWeekStart, formatCalendarDate, parseCalendarDate } from '../src/scraper/calendar-date.ts';

const pageUrl = 'https://fixture.invalid/calendar/';

test('slot parser prefers explicit URL dates and supports aliases, short years and time suffixes', () => {
  assert.deepEqual(parseSlots([
    { background: 'greentime.gif', timeText: '19:00', href: '?calendarday=04%2F11%2F26&examtime=09%3A30%2B', dateText: '05/11/26' },
    { background: 'REDTIME.GIF', timeText: '12:00', href: '/day?calendardate=05%2F12%2F2027&time=14%3A45' },
    { background: 'bluetime.gif', timeText: '8:05', href: '?calendarday=2027-01-04' },
    { background: '/WebPhase1/images/drivercalendar/timeregular3.gif', timeText: '7:45', href: '?calendarday=05%2F05%2F27&examtime=7%3A45%20' }
  ], { pageUrl }), [
    { datetime: new Date(2026, 10, 4, 9, 30), available: true },
    { datetime: new Date(2027, 11, 5, 14, 45), available: false },
    { datetime: new Date(2027, 0, 4, 8, 5), available: true },
    { datetime: new Date(2027, 4, 5, 7, 45), available: true }
  ]);
});

test('weekly column dates resolve red and non-red slots without usable links', () => {
  assert.deepEqual(parseSlots([
    { background: 'greentime.gif', timeText: '8:05', href: null, dateText: '31/12/26' },
    { background: 'redtime.gif', timeText: '11:20', href: 'http://[', dateText: '01/01/2027' },
    { background: 'bletime.gif', timeText: '14:30', href: '/reserve', dateText: '02/01/27' }
  ], { pageUrl }), [
    { datetime: new Date(2026, 11, 31, 8, 5), available: true },
    { datetime: new Date(2027, 0, 1, 11, 20), available: false },
    { datetime: new Date(2027, 0, 2, 14, 30), available: true }
  ]);
});

test('unresolved dates and times stay null instead of guessing today or midnight', () => {
  const slots = parseSlots([
    { background: 'greentime.gif', timeText: '16:10', href: null },
    { background: 'greentime.gif', timeText: null, href: '?calendarday=06%2F11%2F2026&examtime=unspecified' },
    { background: 'redtime.gif', timeText: 'Unavailable', href: '#' }
  ], { pageUrl });
  assert.deepEqual(slots, [
    { datetime: null, available: true },
    { datetime: null, available: true },
    { datetime: null, available: false }
  ]);
  assert.deepEqual(parseSlots([], { pageUrl }), []);
});

test('invalid dates and times do not roll over into another day or month', () => {
  for (const [dateText, timeText] of [
    ['31/02/27', '8:05'], ['29/02/27', '8:05'], ['00/01/27', '8:05'],
    ['01/13/27', '8:05'], ['01/01/27', '24:00'], ['01/01/27', '8:60']
  ] as const) {
    assert.equal(parseSlots([{ background: 'greentime.gif', href: null, dateText, timeText }], { pageUrl })[0]?.datetime, null);
  }
  assert.deepEqual(parseCalendarDate('29/02/28'), new Date(2028, 1, 29));
  assert.deepEqual(parseCalendarDate('2027-01-04'), new Date(2027, 0, 4));
  assert.equal(parseCalendarDate('2027-02-29'), null);
});

test('week calculations cross the year boundary and preserve their input', () => {
  const date = new Date(2027, 0, 3, 15, 20);
  assert.equal(formatCalendarDate(calendarWeekStart(date)), '28/12/2026');
  assert.equal(formatCalendarDate(date), '03/01/2027');
  assert.equal(date.getHours(), 15);
});

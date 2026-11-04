import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSlots } from '../src/scraper/slot-parser.ts';

const referenceDate = new Date(2026, 10, 5, 12, 0);
const pageUrl = 'https://fixture.invalid/calendar/';

test('slot parser prefers URL dates and supports relative links, aliases and short years', () => {
  const slots = parseSlots([
    { background: 'greentime.gif', timeText: '19:00', href: '?calendarday=04%2F11%2F26&examtime=09%3A30%2B' },
    { background: 'REDTIME.GIF', timeText: '12:00', href: '/day?calendardate=05%2F12%2F2027&time=14%3A45' },
    { background: '', timeText: null, href: '?calendarday=06%2F11%2F2026&examtime=unspecified' }
  ], { pageUrl, calendarHeader: null, referenceDate });
  assert.deepEqual(slots, [
    { datetime: new Date(2026, 10, 4, 9, 30), available: true },
    { datetime: new Date(2027, 11, 5, 14, 45), available: false },
    { datetime: new Date(2026, 10, 6), available: true }
  ]);
});

test('time-only fallback uses the reference day and the year from the calendar header', () => {
  const slots = parseSlots([
    { background: '', timeText: 'Available at 8:05', href: null },
    { background: 'redtime.gif', timeText: '11:20', href: 'http://[' }
  ], { pageUrl, calendarHeader: 'December 2027', referenceDate });
  assert.deepEqual(slots, [
    { datetime: new Date(2027, 10, 5, 8, 5), available: true },
    { datetime: new Date(2027, 10, 5, 11, 20), available: false }
  ]);
  assert.equal(referenceDate.getFullYear(), 2026);
});

test('time-only fallback uses the reference year when no calendar header is available', () => {
  assert.deepEqual(parseSlots([
    { background: 'greentime.gif', timeText: '16:10', href: null }
  ], { pageUrl, calendarHeader: null, referenceDate }), [
    { datetime: new Date(2026, 10, 5, 16, 10), available: true }
  ]);
});

test('unresolved dates stay null and empty calendars stay empty', () => {
  const context = { pageUrl, calendarHeader: null, referenceDate };
  assert.deepEqual(parseSlots([
    { background: 'greentime.gif', timeText: null, href: null },
    { background: 'redtime.gif', timeText: 'Unavailable', href: '#' }
  ], context), [
    { datetime: null, available: true },
    { datetime: null, available: false }
  ]);
  assert.deepEqual(parseSlots([], context), []);
});

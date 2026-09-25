import {
  addDays as dfAddDays,
  addMonths as dfAddMonths,
  differenceInCalendarDays,
  endOfMonth,
  format,
  getDaysInMonth,
  isValid,
  parse,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

/** Local calendar dates are stored as `yyyy-MM-dd` strings so they never shift with time zones. */
export type DateStr = string;

const FMT = 'yyyy-MM-dd';

export function toDateStr(d: Date): DateStr {
  return format(d, FMT);
}

export function parseDate(s: DateStr): Date {
  const d = parse(s, FMT, new Date(2000, 0, 1, 12));
  return isValid(d) ? d : new Date(NaN);
}

export function isDateStr(s: unknown): s is DateStr {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && isValid(parseDate(s));
}

export const today = (): DateStr => toDateStr(new Date());
export const nowTime = (): string => format(new Date(), 'HH:mm');
export const addDays = (s: DateStr, n: number): DateStr => toDateStr(dfAddDays(parseDate(s), n));
export const addMonths = (s: DateStr, n: number): DateStr => toDateStr(dfAddMonths(parseDate(s), n));
export const daysBetween = (a: DateStr, b: DateStr): number => differenceInCalendarDays(parseDate(b), parseDate(a));
export const monthStart = (s: DateStr): DateStr => toDateStr(startOfMonth(parseDate(s)));
export const monthEnd = (s: DateStr): DateStr => toDateStr(endOfMonth(parseDate(s)));
export const daysInMonth = (s: DateStr): number => getDaysInMonth(parseDate(s));
export const weekStartOf = (s: DateStr, weekStartsOn: 0 | 1): DateStr => toDateStr(startOfWeek(parseDate(s), { weekStartsOn }));
export const dayOfMonth = (s: DateStr): number => parseDate(s).getDate();
export const dayOfWeek = (s: DateStr): number => parseDate(s).getDay();

/** Inclusive list of dates from `from` to `to`. */
export function eachDay(from: DateStr, to: DateStr): DateStr[] {
  const out: DateStr[] = [];
  const n = daysBetween(from, to);
  for (let i = 0; i <= n; i++) out.push(addDays(from, i));
  return out;
}

const sameYear = (s: DateStr) => s.slice(0, 4) === today().slice(0, 4);

/** "Fri, Sep 25" */
export const fmtDate = (s: DateStr) => format(parseDate(s), sameYear(s) ? 'EEE, MMM d' : 'EEE, MMM d, yyyy');
/** "Sep 25" */
export const fmtShort = (s: DateStr) => format(parseDate(s), sameYear(s) ? 'MMM d' : 'MMM d, yyyy');
/** "Friday, September 25" */
export const fmtLong = (s: DateStr) => format(parseDate(s), sameYear(s) ? 'EEEE, MMMM d' : 'EEEE, MMMM d, yyyy');
/** "September 2026" */
export const fmtMonth = (s: DateStr) => format(parseDate(s), 'MMMM yyyy');

export function fmtTime(hhmm: string | undefined): string {
  if (!hhmm) return '';
  const d = parse(hhmm, 'HH:mm', new Date(2000, 0, 1));
  return isValid(d) ? format(d, 'h:mm a') : hhmm;
}

/** "today", "yesterday", "3 days ago", "2 wk ago", or a date. */
export function relDay(s: DateStr, ref: DateStr = today()): string {
  const n = daysBetween(s, ref);
  if (n === 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n === -1) return 'tomorrow';
  if (n > 1 && n < 7) return `${n} days ago`;
  if (n >= 7 && n < 60) return `${Math.round(n / 7)} wk ago`;
  return fmtShort(s);
}

/** Weekday labels starting on the given day, e.g. ["Sun", "Mon", ...]. */
export function weekdayLabels(weekStartsOn: 0 | 1, style: 'EEE' | 'EEEEE' = 'EEE'): string[] {
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => format(new Date(2023, 0, 1 + ((weekStartsOn + i) % 7), 12), style));
}

export function dateTimeKey(date: DateStr, time?: string): string {
  return `${date} ${time || '00:00'}`;
}

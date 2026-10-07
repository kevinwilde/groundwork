import { describe, expect, it } from 'vitest';
import { fmtAgo, fmtWhen } from './dates';

const at = (d: string) => new Date(d).getTime();
const NOW = at('2026-10-07T09:30:00');

describe('fmtAgo', () => {
  it('reads like speech', () => {
    expect(fmtAgo(NOW - 10_000, NOW)).toBe('just now');
    expect(fmtAgo(NOW + 5000, NOW)).toBe('just now');
    expect(fmtAgo(NOW - 60_000, NOW)).toBe('1 minute ago');
    expect(fmtAgo(NOW - 5 * 60_000, NOW)).toBe('5 minutes ago');
    expect(fmtAgo(NOW - 59.8 * 60_000, NOW)).toBe('1 hour ago');
    expect(fmtAgo(NOW - 2 * 3_600_000, NOW)).toBe('2 hours ago');
    expect(fmtAgo(at('2026-10-06T08:00:00'), NOW)).toBe('yesterday');
    expect(fmtAgo(at('2026-10-04T12:00:00'), NOW)).toBe('3 days ago');
    expect(fmtAgo(at('2026-08-25T12:00:00'), NOW)).toBe('on Aug 25');
    expect(fmtAgo(at('2025-08-25T12:00:00'), NOW)).toBe('on Aug 25, 2025');
  });
});

describe('fmtWhen', () => {
  it('names the day and time', () => {
    expect(fmtWhen(at('2026-10-07T09:12:00'), NOW)).toBe('today at 09:12');
    expect(fmtWhen(at('2026-10-06T18:40:00'), NOW)).toBe('yesterday at 18:40');
    expect(fmtWhen(at('2026-10-05T08:10:00'), NOW)).toBe('Mon, Oct 5 at 08:10');
    expect(fmtWhen(at('2025-12-31T23:59:00'), NOW)).toBe('Wed, Dec 31, 2025 at 23:59');
  });
});

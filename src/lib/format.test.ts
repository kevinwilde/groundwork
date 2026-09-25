import { describe, expect, it } from 'vitest';
import { fmtDuration, fmtDurationLong, fmtPace, niceMax, parseDuration, parseNum, slugKey } from './format';

describe('parseDuration', () => {
  it('reads bare numbers as seconds by default and minutes when asked', () => {
    expect(parseDuration('60')).toBe(60);
    expect(parseDuration('30', 'min')).toBe(1800);
  });
  it('reads clock formats', () => {
    expect(parseDuration('1:30')).toBe(90);
    expect(parseDuration('27:45')).toBe(1665);
    expect(parseDuration('1:02:03')).toBe(3723);
  });
  it('reads unit suffixes', () => {
    expect(parseDuration('45s')).toBe(45);
    expect(parseDuration('5m')).toBe(300);
    expect(parseDuration('1h20m')).toBe(4800);
    expect(parseDuration('1 h 5 min 10 s')).toBe(3910);
  });
  it('returns null for empty and NaN for nonsense', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('  ')).toBeNull();
    expect(parseDuration('abc')).toBeNaN();
    expect(parseDuration('5 apples')).toBeNaN();
  });
});

describe('formatting', () => {
  it('formats durations', () => {
    expect(fmtDuration(45)).toBe('45 s');
    expect(fmtDuration(60)).toBe('60 s');
    expect(fmtDuration(150)).toBe('2:30');
    expect(fmtDuration(3725)).toBe('1:02:05');
    expect(fmtDurationLong(5400)).toBe('1 h 30 min');
  });
  it('formats pace and rounds 59.5 s up to the next minute', () => {
    expect(fmtPace(537)).toBe('8:57');
    expect(fmtPace(599.6)).toBe('10:00');
  });
  it('parses numbers with separators', () => {
    expect(parseNum('1,250')).toBe(1250);
    expect(parseNum('')).toBeNull();
    expect(parseNum('x')).toBeNaN();
  });
  it('picks nice axis maxima', () => {
    expect(niceMax(7)).toBe(8);
    expect(niceMax(135)).toBe(150);
  });
  it('makes camelCase field keys', () => {
    expect(slugKey('Avg HR')).toBe('avgHr');
    expect(slugKey('  Elevation gain ')).toBe('elevationGain');
    expect(slugKey('!!')).toBe('field');
  });
});

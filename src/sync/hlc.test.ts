import { describe, expect, it } from 'vitest';
import { canonical, sameContent } from './canonical';
import { Clock, decode, encode, HLC_PATTERN, isHlc, legacyStamp, maxHlc, SEED_GONE_HLC, SEED_HLC, wallOf } from './hlc';
import { isSynced, tombstoneId } from './scope';

describe('hlc', () => {
  it('orders strings the same way as (wall, counter, node)', () => {
    const stamps: [number, number, string][] = [
      [0, 0, 'seed'],
      [1, 0, 'seed'],
      [9, 35, 'a'],
      [10, 0, 'a'],
      [1_791_380_000_000, 0, 'k3j9x0a1b2'],
      [1_791_380_000_000, 1, 'a'],
      [1_791_380_000_000, 1, 'b'],
      [1_791_380_000_001, 0, 'a'],
      [36 ** 9 - 1, 0, 'z'],
    ];
    const strs = stamps.map(([w, c, n]) => encode(w, c, n));
    expect([...strs].sort()).toEqual(strs);
    for (const s of strs) expect(s).toMatch(HLC_PATTERN);
    expect(decode(strs[4])).toEqual({ wall: 1_791_380_000_000, counter: 0, node: 'k3j9x0a1b2' });
  });

  it('has fixed special stamps below any real time', () => {
    expect(SEED_HLC < SEED_GONE_HLC).toBe(true);
    expect(SEED_GONE_HLC < encode(2, 0, '0')).toBe(true);
    expect(isHlc(SEED_HLC) && isHlc(SEED_GONE_HLC)).toBe(true);
    expect(isHlc('yesterday')).toBe(false);
    expect(wallOf(SEED_HLC)).toBe(0);
  });

  it('stamps legacy records from their own times', () => {
    expect(legacyStamp({ createdAt: 5000, updatedAt: 9000 })).toBe(encode(9000, 0, 'legacy'));
    expect(legacyStamp({ createdAt: 5000 })).toBe(encode(5000, 0, 'legacy'));
    expect(wallOf(legacyStamp({}))).toBe(0);
  });

  it('only moves forward, even when the wall clock goes backwards', () => {
    const c = new Clock();
    const a = c.next(1000, 'n');
    const b = c.next(1000, 'n');
    const d = c.next(400, 'n');
    const e = c.next(2000, 'n');
    expect(a < b && b < d && d < e).toBe(true);
    expect(decode(d)).toMatchObject({ wall: 1000, counter: 2 });
    expect(decode(e)).toMatchObject({ wall: 2000, counter: 0 });
  });

  it('carries into the wall time when the counter overflows', () => {
    const c = new Clock(1000, 36 ** 4 - 1);
    const s = c.next(500, 'n');
    expect(decode(s)).toMatchObject({ wall: 1001, counter: 0 });
    expect(s > encode(1000, 36 ** 4 - 1, 'n')).toBe(true);
  });

  it('observes stamps from elsewhere, so the next stamp beats them', () => {
    const c = Clock.from({ wall: 1000, counter: 0 });
    const remote = encode(5000, 7, 'other');
    c.observe(remote).observe(encode(10, 0, 'old')).observe(null);
    expect(c.state).toEqual({ wall: 5000, counter: 7 });
    expect(c.next(3000, 'n') > remote).toBe(true);
    const stamp = Clock.from(null).observe(remote).stamper('n', 0);
    expect(stamp() > remote).toBe(true);
    expect(maxHlc([null, remote, SEED_HLC, undefined])).toBe(remote);
    expect(maxHlc([])).toBeNull();
  });
});

describe('canonical', () => {
  it('ignores key order and undefined, keeps null and array order', () => {
    expect(canonical({ b: 1, a: { d: [2, 1], c: null }, x: undefined })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
    expect(canonical({ a: 1, b: 2 })).toBe(canonical({ b: 2, a: 1 }));
  });
  it('compares content without stamps', () => {
    expect(sameContent({ id: 'a', name: 'x', hlc: '1', updatedAt: 1 }, { name: 'x', id: 'a', hlc: '2' })).toBe(true);
    expect(sameContent({ id: 'a', name: 'x' }, { id: 'a', name: 'y' })).toBe(false);
  });
});

describe('scope', () => {
  it('keeps sample records and device-local settings on the device', () => {
    expect(isSynced('entries', { id: 'en1', sample: true })).toBe(false);
    expect(isSynced('entries', { id: 'en1' })).toBe(true);
    expect(isSynced('settings', { key: 'weekStart', value: 1 })).toBe(true);
    expect(isSynced('settings', { key: 'seeded', value: true })).toBe(false);
    expect(isSynced('settings', { key: 'lastExportAt', value: 1 })).toBe(false);
    expect(isSynced('settings', { key: 'someFutureKey', value: 1 })).toBe(false);
    expect(tombstoneId('exercises', 'ex_rdl')).toBe('exercises:ex_rdl');
  });
});

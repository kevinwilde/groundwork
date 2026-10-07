import { describe, expect, it } from 'vitest';
import { commitMessage, commitSubject, parseTrailers } from './message';
import { emptyCounts, type Counts } from './merge';

const counts = (patch: Partial<Counts>): Counts => ({ ...emptyCounts(), ...patch });

describe('commit messages', () => {
  it('lists verbs in order, tables by count, joined with commas and "and"', () => {
    expect(commitSubject('iPhone', counts({ added: { entries: 3, checkins: 1 }, updated: { exercises: 1 } }), 'sync')).toBe('iPhone: added 3 entries and 1 check-in, updated 1 exercise');
    expect(commitSubject('Mac', counts({ added: { tags: 1, entries: 2, snacks: 1 }, deleted: { views: 1 } }), 'sync')).toBe('Mac: added 2 entries, 1 tag and 1 mini-exercise, deleted 1 saved view');
    expect(commitSubject('Mac', counts({ restored: { exercises: 1 }, updated: { tags: 2 } }), 'sync')).toBe('Mac: updated 2 tags, restored 1 exercise');
  });

  it('falls back to a count when the subject would pass 72 characters', () => {
    const many = counts({ added: { entries: 400, checkins: 7, tags: 2 }, updated: { exercises: 3, sessions: 1 }, deleted: { bodyParts: 1 } });
    const subject = commitSubject('Mac', many, 'sync');
    expect(subject).toBe('Mac: 414 changes (entries, check-ins, exercises, tags, …)');
    expect(subject.length).toBeLessThanOrEqual(72);
    expect(commitSubject('Mac', counts({ added: { entries: 400 }, updated: { exercises: 3, sessions: 1, bodyParts: 2, types: 1, tags: 9 } }), 'sync').length).toBeLessThanOrEqual(72);
  });

  it('names the first sync, an undo and housekeeping', () => {
    expect(commitSubject('Mac', counts({ added: { entries: 500, exercises: 63 } }), 'first')).toBe('Mac: first sync, 563 records');
    expect(commitSubject('Mac', counts({ deleted: { entries: 3 }, updated: { checkins: 1 } }), 'undo')).toBe('Mac: undid a sync (updated 1 check-in, deleted 3 entries)');
    expect(commitSubject('iPhone', counts({ purged: 4 }), 'sync')).toBe('iPhone: tidied the deleted-records list');
  });

  it('adds a line per table and trailers that read back', () => {
    const message = commitMessage({ device: { id: 'k3j9x0a1b2', name: 'iPhone', createdAt: 0 }, counts: counts({ added: { entries: 3 }, updated: { entries: 1 }, purged: 2 }), kind: 'sync', app: '1.1.0' });
    expect(message).toBe(
      [
        'iPhone: added 3 entries, updated 1 entry',
        '',
        'Logged entries: 3 added, 1 updated',
        'Deleted-records list: 2 older than a year removed',
        '',
        'Groundwork-Device: iPhone',
        'Groundwork-Device-Id: k3j9x0a1b2',
        'Groundwork-Version: 1.1.0',
      ].join('\n'),
    );
    expect(parseTrailers(message)).toEqual({ device: 'iPhone', deviceId: 'k3j9x0a1b2', version: '1.1.0' });
    expect(parseTrailers('Fix a typo')).toEqual({});
  });

  it('keeps a device name on one line', () => {
    expect(commitSubject('My\nMac ', counts({ added: { tags: 1 } }), 'sync')).toBe('My Mac: added 1 tag');
  });
});

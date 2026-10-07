import { describe, expect, it } from 'vitest';
import { emptyCounts } from '../sync/merge';
import { changesText, items } from './labels';

describe('change summaries', () => {
  it('lists verbs in order and tables by count', () => {
    const c = emptyCounts();
    c.updated.checkins = 1;
    c.added.checkins = 1;
    c.added.entries = 3;
    c.deleted.tags = 2;
    expect(changesText(c)).toBe('3 logged entries added · 1 check-in added · 1 check-in updated · 2 tags deleted');
    expect(changesText(emptyCounts())).toBe('');
    expect(items('snacks', 1)).toBe('1 mini-exercise');
  });
});

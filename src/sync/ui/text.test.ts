import { describe, expect, it } from 'vitest';
import { emptyCounts } from '../merge';
import { progressText, tokenUrl, undoText, warningText } from './text';

describe('Sync card wording', () => {
  it('prefills the token form, keeping the name within 40 characters', () => {
    expect(tokenUrl('iPhone', { owner: 'kevinwilde', repo: 'groundwork-data' })).toBe(
      'https://github.com/settings/personal-access-tokens/new?name=Groundwork%20(iPhone)&description=Groundwork%20sync%20for%20kevinwilde%2Fgroundwork-data&target_name=kevinwilde&expires_in=366&contents=write',
    );
    const long = new URL(tokenUrl('A very long device name that goes on and on', null));
    expect(long.searchParams.get('name')!.length).toBe(40);
    expect(long.searchParams.get('name')).toMatch(/^Groundwork \(A very long .*…\)$/);
    expect(long.searchParams.has('target_name')).toBe(false);
  });

  it('describes progress, warnings and an undo', () => {
    expect(progressText({ step: 'downloading', done: 1, total: 3 }, 'iPhone')).toBe('Downloading 2 of 3 files…');
    expect(progressText({ step: 'saving' }, 'iPhone')).toBe('Saving on this iPhone…');
    expect(progressText({ step: 'uploading', files: 1 }, 'iPhone')).toBe('Uploading 1 file…');
    expect(warningText({ kind: 'clock', minutes: 185 })).toBe("Your devices' clocks seem about 3 hours apart. Turn on Set Automatically in Date & Time on each device.");
    const c = emptyCounts();
    c.added.entries = 3;
    c.updated.checkins = 1;
    expect(undoText(c)).toBe('removes 3 logged entries and restores 1 check-in');
  });
});

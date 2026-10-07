import { describe, expect, it } from 'vitest';
import { blobSha, blobShas, byteLength } from './gitsha';

describe('git blob ids', () => {
  it('matches git for known files', async () => {
    expect(await blobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(await blobSha('hello world\n')).toBe('3b18e512dba79e4c8300dd08aeb37f8e728b8dad');
  });
  it('counts UTF-8 bytes, not characters, for non-ASCII text', async () => {
    // From `git hash-object --stdin`, and Node's createHash('sha1') over `blob <bytes>\0…`.
    const text = 'Grüße, Bjørn ✓ 💪\n{"notes":"Knie – gut"}\n';
    expect(byteLength(text)).toBeGreaterThan(text.length);
    expect(await blobSha(text)).toBe('735d02c2a0407e45b74503e47d0ffaa8c0ac6374');
    expect(await blobShas(new Map([['a.jsonl', 'hello world\n']]))).toEqual(new Map([['a.jsonl', '3b18e512dba79e4c8300dd08aeb37f8e728b8dad']]));
  });
});

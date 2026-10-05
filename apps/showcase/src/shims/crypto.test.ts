import { createHash as nodeHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createHash } from './crypto';

describe('browser sha256 shim', () => {
  it('matches node:crypto on ASCII, empty, multi-block and non-ASCII text', () => {
    const texts = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'x'.repeat(1000), 'clamp: ß → é 日本 \u{1F600}'];
    for (const t of texts) expect(createHash('sha256').update(t).digest('hex')).toBe(nodeHash('sha256').update(t).digest('hex'));
  });
});

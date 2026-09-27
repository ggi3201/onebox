import { describe, expect, it } from 'vitest';

import { parseMarkdown, plainText } from './parseMarkdown';

const answer = [
  'You have **3 items** due this week, and one is *late*.',
  '',
  '| Item | Due |',
  '|---|---|',
  '| Rent & bills | 2026-10-01 |',
  '| Milk | today |',
  '',
  '1. Pay the rent',
  '2. Buy [milk](https://example.com)',
].join('\n');

describe('parseMarkdown', () => {
  // It runs on every streamed delta, so it mostly sees a truncated answer.
  it('parses every prefix of an answer without throwing or losing words', () => {
    for (let i = 1; i <= answer.length; i++) {
      const blocks = parseMarkdown(answer.slice(0, i));
      expect(Array.isArray(blocks)).toBe(true);
    }
    const text = plainText(parseMarkdown(answer));
    for (const word of ['items', 'late', 'Rent & bills', 'Pay the rent', 'milk']) expect(text).toContain(word);
  });

  it('joins a soft line break into a space', () => {
    expect(plainText(parseMarkdown('one\ntwo'))).toBe('one two');
  });
});

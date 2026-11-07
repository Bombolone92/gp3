import { describe, it, expect } from 'vitest';
import {
  formatWhen, formatFullDate, initialFor, hueFor, cleanSnippet, formatSize,
} from '../src/lib/format.js';

// A fixed "now" keeps assertions stable regardless of when the suite runs.
const NOW = new Date(2026, 7, 19, 15, 0, 0); // Aug 19 2026, local time

describe('formatWhen', () => {
  it('shows a time for messages from today', () => {
    const when = formatWhen({ date: new Date(2026, 7, 19, 9, 24) }, NOW);
    expect(when).toMatch(/\d{1,2}[:.]\d{2}/);
    expect(when).not.toMatch(/2026/);
  });

  it('shows month and day within the same year', () => {
    const when = formatWhen({ date: new Date(2026, 6, 2) }, NOW);
    expect(when).toMatch(/\d/);
    expect(when).not.toMatch(/2026/);
    expect(when).not.toMatch(/[:.]\d{2}\s*$/);
  });

  it('adds the year for older messages', () => {
    expect(formatWhen({ date: new Date(2025, 11, 24) }, NOW)).toMatch(/2025/);
  });

  it('falls back to the file modified time, then the day folder name', () => {
    const modified = Math.floor(new Date(2026, 7, 18).getTime() / 1000);
    expect(formatWhen({ modified }, NOW)).toMatch(/\d/);
    expect(formatWhen({ day: '2026-08-01' }, NOW)).toBe('2026-08-01');
    expect(formatWhen({}, NOW)).toBe('');
  });

  it('ignores an invalid parsed date', () => {
    expect(formatWhen({ date: new Date('nope'), day: '2026-08-01' }, NOW)).toBe('2026-08-01');
  });
});

describe('formatFullDate', () => {
  it('includes year and minutes', () => {
    const text = formatFullDate(new Date(2026, 7, 19, 9, 5));
    expect(text).toMatch(/2026/);
    expect(text).toMatch(/05/);
  });

  it('returns empty for missing or invalid dates', () => {
    expect(formatFullDate(null)).toBe('');
    expect(formatFullDate(new Date('nope'))).toBe('');
  });
});

describe('initialFor', () => {
  it('uppercases the first meaningful character', () => {
    expect(initialFor('jane doe')).toBe('J');
    expect(initialFor('"Quoted Name"')).toBe('Q');
    expect(initialFor('<bare@example.com>')).toBe('B');
  });

  it('falls back to a question mark', () => {
    expect(initialFor('')).toBe('?');
    expect(initialFor('   ')).toBe('?');
  });

  it('keeps a name that starts with an emoji whole rather than splitting its surrogate pair', () => {
    expect(initialFor('🎉 Sale Newsletter')).toBe('🎉');
    // A ZWJ sequence is one glyph on screen and stays one here.
    expect(initialFor('👩\u200d💻 Dev Digest')).toBe('👩\u200d💻');
    // A letter written as base plus combining mark keeps its accent.
    expect(initialFor('e\u0301lise')).toBe('E\u0301');
    expect(initialFor('ünal')).toBe('Ü');
  });
});

describe('hueFor', () => {
  it('is deterministic and within [0, 360)', () => {
    expect(hueFor('jane@example.com')).toBe(hueFor('jane@example.com'));
    for (const input of ['a', 'jane@example.com', 'x'.repeat(200), '']) {
      const hue = hueFor(input);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it('spreads different senders across hues', () => {
    expect(hueFor('a@example.com')).not.toBe(hueFor('b@example.com'));
  });
});

describe('cleanSnippet', () => {
  it('collapses runs of whitespace into single spaces', () => {
    expect(cleanSnippet('one\n\n  two\tthree ')).toBe('one two three');
  });

  it('truncates long text with an ellipsis', () => {
    const out = cleanSnippet('word '.repeat(100), 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith('…')).toBe(true);
  });

  it('leaves short text untouched', () => {
    expect(cleanSnippet('short')).toBe('short');
  });

  it('never cuts a surrogate pair in half', () => {
    // The emoji straddles the cut: keeping its first half would draw a
    // broken-glyph box at the end of the preview line.
    const out = cleanSnippet(`${'a'.repeat(38)}\u{1F600}bbbb`, 40);
    expect(out.endsWith('…')).toBe(true);
    expect([...out].every((ch) => {
      const code = ch.codePointAt(0);
      return code < 0xd800 || code > 0xdfff;
    })).toBe(true);
  });

  it('keeps a whole emoji that fits', () => {
    expect(cleanSnippet(`${'a'.repeat(37)}\u{1F600}bbbb`, 40)).toBe(`${'a'.repeat(37)}\u{1F600}…`);
  });
});

describe('formatSize', () => {
  it('picks sensible units', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(300 * 1024)).toBe('300 KB');
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('moves to MB when a size just under a megabyte rounds up to 1024 KB', () => {
    expect(formatSize(1024 * 1024 - 1)).toBe('1.0 MB');
    expect(formatSize(1023 * 1024)).toBe('1023 KB');
  });

  it('returns empty for invalid input', () => {
    expect(formatSize(-1)).toBe('');
    expect(formatSize(NaN)).toBe('');
  });
});

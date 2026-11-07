import { describe, it, expect } from 'vitest';
import { uid, initials, formatBytes, relativeTime, safeFileName, readableInk } from '../src/lib/util.js';

describe('uid', () => {
  it('is unique across many calls', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => uid()));
    expect(ids.size).toBe(5000);
  });
});

describe('initials', () => {
  it('takes first and last name', () => {
    expect(initials('Maya Chen')).toBe('MC');
    expect(initials('ada lovelace king')).toBe('AK');
  });

  it('handles single names and junk', () => {
    expect(initials('alex')).toBe('A');
    expect(initials('   ')).toBe('?');
    expect(initials(null)).toBe('?');
  });
});

describe('formatBytes', () => {
  it('scales units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(200 * 1024)).toBe('200 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatBytes(undefined)).toBe('0 B');
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-08-05T12:00:00Z');

  it('buckets by age', () => {
    expect(relativeTime(now - 20_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
  });

  it('falls back to the same short date the platform prints', () => {
    const old = now - 40 * 86_400_000;
    expect(relativeTime(old, now))
      .toBe(new Date(old).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  });

  it('never goes negative for future skew', () => {
    expect(relativeTime(now + 60_000, now)).toBe('just now');
  });
});

describe('safeFileName', () => {
  it('strips path separators and reserved characters', () => {
    expect(safeFileName('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(safeFileName('report: Q3 <final>.pdf')).toBe('report_ Q3 _final_.pdf');
  });

  it('falls back for empty input and caps length', () => {
    expect(safeFileName('')).toBe('file');
    expect(safeFileName('x'.repeat(300)).length).toBe(120);
  });
});

describe('readableInk', () => {
  it('keeps white on the dark end of the member palette', () => {
    expect(readableInk('#8833eb')).toBe('#ffffff');
    expect(readableInk('#4f63f0')).toBe('#ffffff');
    expect(readableInk('#5f7d2f')).toBe('#ffffff');
  });

  it('switches to dark ink where white would fall under 4.5:1', () => {
    expect(readableInk('#d97706')).toBe('#17171a');
    expect(readableInk('#0d9488')).toBe('#17171a');
  });

  it('accepts shorthand hex and is case insensitive', () => {
    expect(readableInk('#FFF')).toBe('#17171a');
    expect(readableInk('#000')).toBe('#ffffff');
  });

  it('defers to the stylesheet for anything it cannot read', () => {
    expect(readableInk('var(--accent)')).toBe(null);
    expect(readableInk('rebeccapurple')).toBe(null);
    expect(readableInk(null)).toBe(null);
  });
});

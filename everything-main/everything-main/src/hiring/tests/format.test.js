import { describe, it, expect } from 'vitest';
import { fileSlug, formatBytes, formatMoney, formatSalaryRange, plural } from '../src/lib/format.js';

describe('fileSlug', () => {
  it('turns a name into a safe filename fragment', () => {
    expect(fileSlug('Ada Lovelace')).toBe('ada-lovelace');
    expect(fileSlug('José García Jr.')).toBe('jose-garcia-jr');
  });

  it('falls back when no letters survive', () => {
    expect(fileSlug('李明')).toBe('candidate');
    expect(fileSlug('  ')).toBe('candidate');
    expect(fileSlug(null, 'file')).toBe('file');
  });

  it('folds stroked and ligature letters that NFKD cannot decompose', () => {
    // Ø/Ł/Đ/Æ have no decomposition, so without an explicit fold the
    // ASCII sweep would silently drop them from the filename.
    expect(fileSlug('Søren Kierkegaard')).toBe('soren-kierkegaard');
    expect(fileSlug('Łukasz Nowak')).toBe('lukasz-nowak');
    expect(fileSlug('Đorđe Petrović')).toBe('dorde-petrovic');
    expect(fileSlug('Björk Guðmundsdóttir')).toBe('bjork-gudmundsdottir');
    expect(fileSlug('Þóra Æbelø')).toBe('thora-aebelo');
  });
});

describe('formatMoney / formatSalaryRange', () => {
  it('treats a null or empty currency as the USD default', () => {
    // A restored backup can carry currency: null; the default parameter
    // only fires for undefined, and Intl throws on "null", so the
    // fallback rendered the raw value: "null 120,000".
    expect(formatMoney(120000, null)).toBe(formatMoney(120000));
    expect(formatMoney(120000, '')).toBe(formatMoney(120000));
    expect(formatSalaryRange(120000, 150000, null)).toBe(formatSalaryRange(120000, 150000));
    expect(formatSalaryRange(120000, 150000, null)).not.toContain('null');
  });
});

describe('formatBytes', () => {
  it('picks sensible units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(824)).toBe('824 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(325 * 1024)).toBe('325 KB');
    expect(formatBytes(2.4 * 1024 * 1024)).toBe('2.4 MB');
    // Rounding must not overflow the unit it was picked for.
    expect(formatBytes(1048064)).toBe('1.0 MB');
    expect(formatBytes(1023.6)).toBe('1 KB');
  });

  it('is empty for garbage', () => {
    expect(formatBytes(-1)).toBe('');
    expect(formatBytes('x')).toBe('');
    expect(formatBytes(null)).toBe('');
  });
});

describe('plural', () => {
  it('inflects', () => {
    expect(plural(1, 'day')).toBe('1 day');
    expect(plural(2, 'day')).toBe('2 days');
    expect(plural(0, 'candidate')).toBe('0 candidates');
  });
});

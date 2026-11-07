import { describe, it, expect } from 'vitest';
import { candidateTags, hasTag, MAX_TAGS, normalizeTags, parseTags, tagCounts, tagKey } from '../src/core/tags.js';

describe('normalizeTags', () => {
  it('trims, collapses whitespace, dedupes case-insensitively, keeps order', () => {
    expect(normalizeTags([' Senior ', 'senior', 'needs   sponsorship', '', null, 'Rust'])).toEqual([
      'Senior',
      'needs sponsorship',
      'Rust',
    ]);
  });

  it('caps the list and the length of a single tag', () => {
    expect(normalizeTags(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(MAX_TAGS);
    expect(normalizeTags(['x'.repeat(80)])[0]).toHaveLength(30);
  });

  it('is empty for anything that is not a list', () => {
    expect(normalizeTags(null)).toEqual([]);
    expect(normalizeTags('senior')).toEqual([]);
  });

  it('parses a comma-separated entry', () => {
    expect(parseTags('senior, needs sponsorship , senior')).toEqual(['senior', 'needs sponsorship']);
    expect(parseTags('')).toEqual([]);
  });
});

describe('candidateTags', () => {
  it('reads tags off the candidate', () => {
    expect(candidateTags({ tags: ['senior'] })).toEqual(['senior']);
    expect(candidateTags({})).toEqual([]);
    expect(candidateTags(null)).toEqual([]);
  });

  it('still reads the labels an old talent-pool entry carried', () => {
    expect(candidateTags({ pool: { addedAt: 'x', tags: ['strong', 'bad timing'] } })).toEqual(['strong', 'bad timing']);
    // Both sources, without duplicating what appears in each.
    expect(candidateTags({ tags: ['Strong', 'senior'], pool: { tags: ['strong'] } })).toEqual(['Strong', 'senior']);
  });
});

describe('tagCounts', () => {
  it('counts usage, most used first then alphabetical', () => {
    const candidates = [
      { tags: ['senior', 'rust'] },
      { tags: ['Senior'] },
      { pool: { tags: ['bad timing'] } },
      { tags: [] },
    ];
    expect(tagCounts(candidates)).toEqual([
      { tag: 'senior', count: 2 },
      { tag: 'bad timing', count: 1 },
      { tag: 'rust', count: 1 },
    ]);
    expect(tagCounts([])).toEqual([]);
  });
});

describe('hasTag', () => {
  it('matches case-insensitively, and an empty filter matches everyone', () => {
    const candidate = { tags: ['Needs Sponsorship'] };
    expect(hasTag(candidate, 'needs sponsorship')).toBe(true);
    expect(hasTag(candidate, 'senior')).toBe(false);
    expect(hasTag(candidate, '')).toBe(true);
    expect(hasTag({}, 'senior')).toBe(false);
    expect(tagKey(' Senior ')).toBe('senior');
  });
});

import { describe, it, expect } from 'vitest';
import {
  RATING_FIELDS,
  averageRating,
  isValidRating,
  normalizeRatingFields,
  ratingFieldsForJob,
  ratingFieldsForScorecard,
  summarizeScorecards,
  validateScorecard,
} from '../src/core/scorecards.js';

describe('validateScorecard', () => {
  it('accepts a complete scorecard', () => {
    expect(
      validateScorecard({ author: 'Grace', recommendation: 'yes', ratings: { skills: 4 } })
    ).toEqual([]);
  });

  it('requires an author and a known recommendation', () => {
    expect(validateScorecard({ author: ' ', recommendation: 'yes' })).toHaveLength(1);
    expect(validateScorecard({ author: 'G', recommendation: 'perhaps' })).toHaveLength(1);
  });

  it('bounds ratings to integers 1..5, allowing omissions', () => {
    expect(isValidRating(3)).toBe(true);
    expect(isValidRating(0)).toBe(false);
    expect(isValidRating(6)).toBe(false);
    expect(isValidRating(3.5)).toBe(false);
    expect(
      validateScorecard({ author: 'G', recommendation: 'yes', ratings: { skills: 9 } })
    ).toHaveLength(1);
    expect(
      validateScorecard({ author: 'G', recommendation: 'yes', ratings: { skills: null } })
    ).toEqual([]);
  });
});

describe('averageRating', () => {
  it('averages only the ratings that were filled in', () => {
    expect(averageRating({ ratings: { skills: 5, experience: 3 } })).toBe(4);
  });

  it('is null with no usable ratings', () => {
    expect(averageRating({ ratings: {} })).toBeNull();
    expect(averageRating({})).toBeNull();
  });
});

describe('custom rubrics', () => {
  const custom = [
    { key: 'dim_product', label: 'Product sense' },
    { key: 'dim_craft', label: 'Craft' },
  ];

  it('normalizes stored dimension lists and drops junk entries', () => {
    expect(
      normalizeRatingFields([
        { key: 'dim_a', label: '  Craft  ' },
        { key: 'bad key!', label: 'Nope' },
        { key: 'dim_b', label: '   ' },
        { key: 'dim_a', label: 'Twin' },
      ])
    ).toEqual([{ key: 'dim_a', label: 'Craft' }]);
    expect(normalizeRatingFields([])).toBeNull();
    expect(normalizeRatingFields(null)).toBeNull();
    expect(normalizeRatingFields('nope')).toBeNull();
  });

  it('resolves a job rubric, falling back to the default', () => {
    expect(ratingFieldsForJob(null)).toBe(RATING_FIELDS);
    expect(ratingFieldsForJob({ ratingFields: null })).toBe(RATING_FIELDS);
    expect(ratingFieldsForJob({ ratingFields: custom })).toEqual(custom);
  });

  it('resolves the rubric a scorecard was written with', () => {
    expect(ratingFieldsForScorecard({ ratings: { skills: 3 } })).toBe(RATING_FIELDS);
    expect(ratingFieldsForScorecard({ fields: custom })).toEqual(custom);
  });

  it('averages ratings stored under custom dimension keys', () => {
    expect(averageRating({ ratings: { dim_product: 5, dim_craft: 2 } })).toBe(3.5);
  });

  it('summarizes byField over a custom rubric', () => {
    const s = summarizeScorecards(
      [
        { ratings: { dim_product: 4 }, recommendation: 'yes' },
        { ratings: { dim_product: 2, dim_craft: 5 }, recommendation: 'yes' },
      ],
      custom
    );
    expect(s.byField).toEqual({ dim_product: 3, dim_craft: 5 });
    expect(s.average).toBeCloseTo((4 + 3.5) / 2);
  });
});

describe('summarizeScorecards', () => {
  const cards = [
    { ratings: { skills: 5, communication: 4 }, recommendation: 'strong_yes' },
    { ratings: { skills: 3 }, recommendation: 'no' },
  ];

  it('computes per-field and overall averages', () => {
    const s = summarizeScorecards(cards);
    expect(s.count).toBe(2);
    expect(s.byField.skills).toBe(4);
    expect(s.byField.communication).toBe(4);
    expect(s.byField.experience).toBeNull();
    expect(s.average).toBeCloseTo((4.5 + 3) / 2);
  });

  it('tallies recommendations and derives the leaning', () => {
    expect(summarizeScorecards(cards).leaning).toBe('hire'); // +2 - 1 = +1
    expect(
      summarizeScorecards([{ recommendation: 'yes' }, { recommendation: 'no' }]).leaning
    ).toBe('split');
    expect(summarizeScorecards([{ recommendation: 'strong_no' }]).leaning).toBe('no_hire');
  });

  it('handles the empty case', () => {
    const s = summarizeScorecards([]);
    expect(s.count).toBe(0);
    expect(s.average).toBeNull();
    expect(s.leaning).toBeNull();
  });
});

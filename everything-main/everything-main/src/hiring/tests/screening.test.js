import { describe, it, expect } from 'vitest';
import {
  answerFor,
  isYesAnswer,
  MAX_SCREENING_QUESTIONS,
  normalizeAnswers,
  normalizeScreeningQuestions,
  screeningMismatches,
  screeningQuestionsForJob,
} from '../src/core/screening.js';

describe('normalizeScreeningQuestions', () => {
  it('keeps well-formed questions and their flags', () => {
    expect(
      normalizeScreeningQuestions([
        { id: 'q1', label: '  Work authorization?  ', kind: 'yesno', required: true, mustHave: true },
        { id: 'q2', label: 'Notice period', kind: 'short' },
      ])
    ).toEqual([
      { id: 'q1', label: 'Work authorization?', kind: 'yesno', required: true, mustHave: true },
      { id: 'q2', label: 'Notice period', kind: 'short', required: false },
    ]);
  });

  it('returns null for nothing usable', () => {
    expect(normalizeScreeningQuestions(null)).toBeNull();
    expect(normalizeScreeningQuestions([])).toBeNull();
    expect(normalizeScreeningQuestions([{ id: 'q1', label: '   ' }])).toBeNull();
    // An id that could escape a path or repeat is not an id.
    expect(normalizeScreeningQuestions([{ id: '../x', label: 'Hi' }])).toBeNull();
  });

  it('drops duplicates, unknown kinds, and optionless choices', () => {
    const out = normalizeScreeningQuestions([
      { id: 'q1', label: 'One', kind: 'wat' },
      { id: 'q1', label: 'Duplicate id' },
      { id: 'q2', label: 'Pick', kind: 'choice', options: [] },
      { id: 'q3', label: 'Pick', kind: 'choice', options: [' a ', 'a', 'b'] },
    ]);
    expect(out).toEqual([
      { id: 'q1', label: 'One', kind: 'short', required: false },
      { id: 'q3', label: 'Pick', kind: 'choice', required: false, options: ['a', 'b'] },
    ]);
  });

  it('only lets yes/no questions be must-haves', () => {
    const [q] = normalizeScreeningQuestions([{ id: 'q1', label: 'How many?', kind: 'short', mustHave: true }]);
    expect(q.mustHave).toBeUndefined();
  });

  it('caps how many a form can ask', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, label: `Q${i}` }));
    expect(normalizeScreeningQuestions(many)).toHaveLength(MAX_SCREENING_QUESTIONS);
  });

  it('reads a job with no questions as an empty list', () => {
    expect(screeningQuestionsForJob({})).toEqual([]);
    expect(screeningQuestionsForJob(null)).toEqual([]);
  });
});

describe('normalizeAnswers', () => {
  it('trims pairs and drops the unusable ones', () => {
    expect(
      normalizeAnswers([
        { label: ' Work authorization? ', answer: ' Yes ' },
        { label: '', answer: 'orphan' },
        { label: 'Unanswered', answer: '   ' },
        null,
      ])
    ).toEqual([{ label: 'Work authorization?', answer: 'Yes' }]);
  });

  it('returns null when nothing is left', () => {
    expect(normalizeAnswers([])).toBeNull();
    expect(normalizeAnswers('nope')).toBeNull();
  });
});

describe('screeningMismatches', () => {
  const job = {
    screeningQuestions: [
      { id: 'q1', label: 'Authorized to work?', kind: 'yesno', mustHave: true },
      { id: 'q2', label: 'Willing to relocate?', kind: 'yesno', mustHave: true },
      { id: 'q3', label: 'Notice period', kind: 'short' },
    ],
  };

  it('flags a must-have answered with anything but yes', () => {
    const candidate = {
      answers: [
        { label: 'authorized to work?', answer: 'yes' },
        { label: 'Willing to relocate?', answer: 'No' },
        { label: 'Notice period', answer: 'Never' },
      ],
    };
    expect(screeningMismatches(candidate, job).map((q) => q.id)).toEqual(['q2']);
  });

  it('says nothing about an unanswered question', () => {
    expect(screeningMismatches({ answers: [] }, job)).toEqual([]);
    expect(screeningMismatches({}, job)).toEqual([]);
    expect(screeningMismatches({ answers: [{ label: 'Authorized to work?', answer: 'Yes' }] }, {})).toEqual([]);
  });

  it('reads answers by label, so a reworded question keeps its own', () => {
    const candidate = { answers: [{ label: 'Notice period', answer: '2 months' }] };
    expect(answerFor(candidate, { label: ' notice period ' })).toBe('2 months');
    expect(answerFor(candidate, { label: 'Notice period (weeks)' })).toBeNull();
  });

  it('reads the usual ways of writing yes', () => {
    expect(isYesAnswer('Yes')).toBe(true);
    expect(isYesAnswer(' y ')).toBe(true);
    expect(isYesAnswer('yes, of course')).toBe(false);
    expect(isYesAnswer('')).toBe(false);
    expect(isYesAnswer(null)).toBe(false);
  });
});

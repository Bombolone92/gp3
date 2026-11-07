import { describe, it, expect } from 'vitest';
import {
  sanitizeAnswer,
  validateAnswer,
  validateResponse,
  nextStep,
  walk,
  conditionHolds,
  seededShuffle,
  questionNumbers,
  OTHER_ID,
  NONE_ID,
} from '../src/shared/runtime.js';

const single = {
  id: 'q1',
  type: 'single',
  title: 'Pick',
  required: true,
  choices: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ],
  other: { enabled: true, label: 'Other' },
};

describe('sanitizeAnswer', () => {
  it('keeps known choices and drops unknown ones', () => {
    expect(sanitizeAnswer(single, { c: 'a' })).toEqual({ c: 'a' });
    expect(sanitizeAnswer(single, 'b')).toEqual({ c: 'b' });
    expect(sanitizeAnswer(single, { c: 'zzz' })).toBeUndefined();
  });

  it('carries other text only for the other option', () => {
    expect(sanitizeAnswer(single, { c: OTHER_ID, t: '  mine ' })).toEqual({ c: OTHER_ID, t: 'mine' });
    expect(sanitizeAnswer({ ...single, other: { enabled: false } }, { c: OTHER_ID, t: 'x' })).toBeUndefined();
  });

  it('makes "none of the above" exclusive on checkboxes', () => {
    const q = { id: 'm', type: 'multi', choices: [{ id: 'a' }, { id: 'b' }], none: { enabled: true } };
    expect(sanitizeAnswer(q, { c: ['a', NONE_ID] })).toEqual({ c: [NONE_ID] });
    expect(sanitizeAnswer(q, { c: ['a', 'a', 'b', 'x'] })).toEqual({ c: ['a', 'b'] });
    expect(sanitizeAnswer(q, { c: [] })).toBeUndefined();
  });

  it('bounds numeric answers', () => {
    expect(sanitizeAnswer({ type: 'rating', scale: 5 }, 5)).toBe(5);
    expect(sanitizeAnswer({ type: 'rating', scale: 5 }, 6)).toBeUndefined();
    expect(sanitizeAnswer({ type: 'nps' }, 0)).toBe(0);
    expect(sanitizeAnswer({ type: 'nps' }, '')).toBeUndefined();
    expect(sanitizeAnswer({ type: 'nps' }, 11)).toBeUndefined();
    expect(sanitizeAnswer({ type: 'slider', min: 10, max: 20 }, 15)).toBe(15);
    expect(sanitizeAnswer({ type: 'slider', min: 10, max: 20 }, 25)).toBeUndefined();
  });

  it('requires a full order for ranking', () => {
    const q = { type: 'ranking', choices: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
    expect(sanitizeAnswer(q, ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
    expect(sanitizeAnswer(q, ['c', 'a'])).toBeUndefined();
  });

  it('keeps only valid matrix cells', () => {
    const q = { type: 'matrix', rows: [{ id: 'r1' }, { id: 'r2' }], columns: [{ id: 'c1' }, { id: 'c2' }] };
    expect(sanitizeAnswer(q, { r1: 'c1', r2: 'nope', r3: 'c1' })).toEqual({ r1: 'c1' });
    expect(sanitizeAnswer({ ...q, multi: true }, { r1: ['c1', 'c2', 'x'] })).toEqual({ r1: ['c1', 'c2'] });
  });

  it('checks date and time formats', () => {
    expect(sanitizeAnswer({ type: 'datetime', date: true }, '2026-01-31')).toBe('2026-01-31');
    expect(sanitizeAnswer({ type: 'datetime', date: true }, '31/01/2026')).toBeUndefined();
    expect(sanitizeAnswer({ type: 'datetime', date: false, time: true }, '23:59')).toBe('23:59');
    expect(sanitizeAnswer({ type: 'datetime', date: true, time: true }, '2026-01-31T08:05')).toBe('2026-01-31T08:05');
  });

  it('caps text length and treats blank text as unanswered', () => {
    expect(sanitizeAnswer({ type: 'text' }, '   ')).toBeUndefined();
    expect(sanitizeAnswer({ type: 'text' }, 'x'.repeat(5000)).length).toBe(1000);
  });

  it('ignores statement blocks', () => {
    expect(sanitizeAnswer({ type: 'statement' }, 'x')).toBeUndefined();
  });
});

describe('validateAnswer', () => {
  it('requires answers on required questions', () => {
    expect(validateAnswer(single, undefined)).toMatch(/requires an answer/);
    expect(validateAnswer({ ...single, requiredMessage: 'Please!' }, undefined)).toBe('Please!');
    expect(validateAnswer({ ...single, required: false }, undefined)).toBe('');
  });

  it('asks for other text when other is picked', () => {
    expect(validateAnswer(single, { c: OTHER_ID })).toMatch(/specify/);
    expect(validateAnswer(single, { c: OTHER_ID, t: 'x' })).toBe('');
  });

  it('enforces checkbox selection counts', () => {
    const q = { type: 'multi', choices: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], minSelect: 2, maxSelect: 2 };
    expect(validateAnswer(q, { c: ['a'] })).toBe('Select exactly 2 options.');
    expect(validateAnswer(q, { c: ['a', 'b'] })).toBe('');
    expect(validateAnswer({ ...q, minSelect: 0, maxSelect: 1 }, { c: ['a', 'b'] })).toBe('Select no more than 1 option.');
  });

  it('validates text formats', () => {
    const email = { type: 'text', validation: { kind: 'email' } };
    expect(validateAnswer(email, 'nope')).toMatch(/email/);
    expect(validateAnswer(email, 'a@b.co')).toBe('');
    const num = { type: 'text', validation: { kind: 'integer', min: 1, max: 10 } };
    expect(validateAnswer(num, '11')).toBe('Enter a whole number between 1 and 10.');
    expect(validateAnswer(num, '2.5')).toMatch(/whole number/);
    expect(validateAnswer(num, '7')).toBe('');
    expect(validateAnswer(num, ' 7 ')).toBe('');
    // Only plain decimal digits count as numbers.
    expect(validateAnswer(num, '2.0')).toBe('');
    for (const t of ['0x5', '5e0', '0b1', 'Infinity', '+', '']) expect(validateAnswer(num, t)).toMatch(/whole number/);
    const dec = { type: 'text', validation: { kind: 'number' } };
    for (const t of ['3.5', '-2', '+4', '.5', '10']) expect(validateAnswer(dec, t)).toBe('');
    for (const t of ['1e3', '0x10', '1 000', 'NaN', '-', '1,000', '1,2,3', '1.5,2']) expect(validateAnswer(dec, t)).toBe('Enter a number.');
    // A decimal comma, as phone keypads in many languages offer.
    for (const t of ['3,5', '-0,25', ',5', '12,75']) expect(validateAnswer(dec, t)).toBe('');
    expect(validateAnswer({ type: 'text', validation: { kind: 'number', min: 0, max: 5 } }, '5,5')).toMatch(/between 0 and 5/);
    const len = { type: 'text', validation: { kind: 'length', min: 3, max: '' } };
    expect(validateAnswer(len, 'ab')).toBe('Enter at least 3 characters.');
  });

  it('requires every row of a required grid', () => {
    const q = { type: 'matrix', required: true, rows: [{ id: 'r1' }, { id: 'r2' }], columns: [{ id: 'c1' }] };
    expect(validateAnswer(q, { r1: 'c1' })).toMatch(/every row/);
    expect(validateAnswer(q, { r1: 'c1', r2: 'c1' })).toBe('');
  });

  it('requires required contact fields even when the question is left blank', () => {
    const q = { type: 'contact', required: false, fields: { name: { enabled: true, required: true }, email: { enabled: true } } };
    expect(validateAnswer(q, undefined)).toMatch(/Name is required/);
    const optional = { type: 'contact', required: false, fields: { name: { enabled: true }, email: { enabled: true } } };
    expect(validateAnswer(optional, undefined)).toBe('');
  });

  it('checks contact fields', () => {
    const q = { type: 'contact', fields: { email: { enabled: true, required: true }, name: { enabled: true } } };
    expect(validateAnswer(q, { name: 'Ana' })).toMatch(/Email address is required/);
    expect(validateAnswer(q, { email: 'bad' })).toMatch(/valid email/);
    expect(validateAnswer(q, { email: 'ana@example.com' })).toBe('');
  });
});

const branching = {
  pages: [
    {
      id: 'p1',
      questions: [
        {
          id: 'q1',
          type: 'single',
          required: true,
          choices: [
            { id: 'yes', label: 'Yes' },
            { id: 'no', label: 'No' },
            { id: 'kid', label: 'Under 13' },
          ],
          logic: { no: { type: 'page', pageId: 'p3' }, kid: { type: 'disqualify' } },
        },
      ],
    },
    { id: 'p2', questions: [{ id: 'q2', type: 'text', required: true }] },
    {
      id: 'p3',
      questions: [
        { id: 'q3', type: 'textarea', required: false },
        { id: 'q4', type: 'text', required: true, display: { qid: 'q1', op: 'is', value: 'yes' } },
      ],
      logic: { type: 'end' },
    },
    { id: 'p4', questions: [{ id: 'q5', type: 'text', required: true }] },
  ],
};

describe('logic', () => {
  it('follows question skip logic', () => {
    expect(nextStep(branching, 0, { q1: { c: 'no' } })).toBe(2);
    expect(nextStep(branching, 0, { q1: { c: 'yes' } })).toBe(1);
    expect(nextStep(branching, 0, { q1: { c: 'kid' } })).toBe('disqualify');
  });

  it('follows page logic and ends at the last page', () => {
    expect(nextStep(branching, 2, {})).toBe('end');
    expect(nextStep({ pages: [{ id: 'a', questions: [] }] }, 0, {})).toBe('end');
  });

  it('never jumps backwards', () => {
    const s = { pages: [{ id: 'a', questions: [] }, { id: 'b', questions: [], logic: { type: 'page', pageId: 'a' } }] };
    expect(nextStep(s, 1, {})).toBe('end');
  });

  it('walks the path a respondent takes', () => {
    expect(walk(branching, { q1: { c: 'no' } })).toEqual({ path: [0, 2], outcome: 'end' });
    expect(walk(branching, { q1: { c: 'yes' } })).toEqual({ path: [0, 1, 2], outcome: 'end' });
    expect(walk(branching, { q1: { c: 'kid' } })).toEqual({ path: [0], outcome: 'disqualify' });
  });

  it('follows checkbox skip logic in the order the choices were written', () => {
    const q = { id: 'm', type: 'multi', choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], logic: { a: { type: 'disqualify' }, b: { type: 'end' } } };
    const survey = { pages: [{ id: 'p1', questions: [q] }, { id: 'p2', questions: [] }] };
    expect(nextStep(survey, 0, { m: { c: ['a', 'b'] } })).toBe('disqualify');
    expect(nextStep(survey, 0, { m: { c: ['b', 'a'] } })).toBe('disqualify');
  });

  it('evaluates display conditions', () => {
    expect(conditionHolds({ qid: 'q1', op: 'is', value: 'yes' }, branching, { q1: { c: 'yes' } })).toBe(true);
    expect(conditionHolds({ qid: 'q1', op: 'isNot', value: 'yes' }, branching, {})).toBe(false);
    expect(conditionHolds({ qid: 'q1', op: 'answered' }, branching, { q1: { c: 'no' } })).toBe(true);
    expect(conditionHolds({ qid: 'r', op: 'is', value: '4' }, branching, { r: 4 })).toBe(true);
    expect(conditionHolds({ qid: 'm', op: 'is', value: 'b' }, branching, { m: { c: ['a', 'b'] } })).toBe(true);
  });
});

describe('validateResponse', () => {
  it('only requires questions on the path the respondent took', () => {
    const r = validateResponse(branching, { q1: { c: 'no' } });
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('end');
  });

  it('reports missing required answers', () => {
    const r = validateResponse(branching, { q1: { c: 'yes' } });
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(['q2', 'q4']);
  });

  it('drops answers to skipped pages and hidden questions', () => {
    const r = validateResponse(branching, { q1: { c: 'no' }, q2: 'skipped', q4: 'hidden', q5: 'after end' });
    expect(r.answers).toEqual({ q1: { c: 'no' } });
  });

  it('reports a disqualified outcome', () => {
    const r = validateResponse(branching, { q1: { c: 'kid' }, q2: 'x' });
    expect(r).toMatchObject({ ok: true, outcome: 'disqualify', answers: { q1: { c: 'kid' } } });
  });

  it('survives garbage input', () => {
    expect(validateResponse(branching, null).ok).toBe(false);
    expect(validateResponse(branching, 'nope').ok).toBe(false);
    expect(validateResponse({ pages: [] }, {}).ok).toBe(true);
  });
});

describe('helpers', () => {
  it('shuffles deterministically per seed', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(seededShuffle(items, 'x')).toEqual(seededShuffle(items, 'x'));
    expect(seededShuffle(items, 'x').sort()).toEqual(items);
  });

  it('numbers answerable questions only', () => {
    const s = { pages: [{ questions: [{ id: 'a', type: 'statement' }, { id: 'b', type: 'text' }] }, { questions: [{ id: 'c', type: 'nps' }] }] };
    expect(questionNumbers(s)).toEqual({ b: 1, c: 2 });
  });
});

describe('hardening', () => {
  it('rejects impossible dates and off-grid or non-numeric values', () => {
    expect(sanitizeAnswer({ type: 'datetime', date: true }, '2024-02-31')).toBeUndefined();
    expect(sanitizeAnswer({ type: 'datetime', date: true }, '2024-02-29')).toBe('2024-02-29');
    expect(sanitizeAnswer({ type: 'nps' }, [])).toBeUndefined();
    expect(sanitizeAnswer({ type: 'nps' }, ' ')).toBeUndefined();
    expect(sanitizeAnswer({ type: 'nps' }, '7')).toBe(7);
    expect(sanitizeAnswer({ type: 'nps' }, 7.5)).toBeUndefined();
    expect(sanitizeAnswer({ type: 'slider', min: 0, max: 10, step: 5 }, 5)).toBe(5);
    expect(sanitizeAnswer({ type: 'slider', min: 0, max: 10, step: 5 }, 3)).toBeUndefined();
    expect(sanitizeAnswer({ type: 'slider', min: 0, max: 1, step: 0.1 }, 0.3)).toBe(0.3);
  });

  it('treats question ids named like object members as ordinary ids', () => {
    const s = { pages: [{ id: 'p', questions: [{ id: 'constructor', type: 'multi', choices: [{ id: 'a' }] }, { id: '__proto__', type: 'text', required: true }] }] };
    const r = validateResponse(s, {});
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors)).toEqual(['__proto__']);
  });
});

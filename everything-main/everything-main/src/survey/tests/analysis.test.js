import { describe, it, expect } from 'vitest';
import { summarize, summarizeQuestion, npsBreakdown, topWords, responsesOverTime } from '../src/analysis/aggregate.js';
import { answerLines, choiceLabel, REMOVED_CHOICE } from '../src/analysis/answers.js';
import { OTHER_ID, NONE_ID } from '../src/shared/runtime.js';
import { convertQuestion } from '../src/model/edit.js';

let n = 0;
const resp = (answers, extra = {}) => ({ key: `k${++n}`, id: `k${n}`, cid: 'c1', at: 1_700_000_000_000 + n, st: 1_700_000_000_000, outcome: 'complete', answers, meta: { device: 'desktop' }, ...extra });

const single = {
  id: 'q1',
  type: 'single',
  title: 'Pick',
  choices: [
    { id: 'a', label: 'Apple' },
    { id: 'b', label: 'Banana' },
    { id: 'blank', label: '' },
  ],
  other: { enabled: true, label: 'Something else' },
};

describe('choice summaries', () => {
  it('counts choices, Other, and removed choices; percents of answered', () => {
    const rs = [resp({ q1: { c: 'a' } }), resp({ q1: { c: 'a' } }), resp({ q1: { c: OTHER_ID, t: 'Kiwi' } }), resp({ q1: { c: 'gone' } }), resp({})];
    const s = summarizeQuestion(single, rs);
    expect(s.answered).toBe(4);
    expect(s.skipped).toBe(1);
    expect(s.rows.map((r) => [r.label, r.count])).toEqual([
      ['Apple', 2],
      ['Banana', 0],
      ['Something else', 1],
      [REMOVED_CHOICE, 1],
    ]);
    expect(s.rows[0].pct).toBe(50);
    expect(s.otherTexts.map((o) => o.text)).toEqual(['Kiwi']);
  });

  it('lets checkbox percentages exceed 100 in total and counts None', () => {
    const q = { id: 'm', type: 'multi', choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], none: { enabled: true, label: 'None' } };
    const s = summarizeQuestion(q, [resp({ m: { c: ['a', 'b'] } }), resp({ m: { c: ['a'] } }), resp({ m: { c: [NONE_ID] } })]);
    expect(s.multi).toBe(true);
    expect(s.rows.map((r) => r.count)).toEqual([2, 1, 1]);
    expect(s.rows.reduce((t, r) => t + r.pct, 0)).toBeGreaterThan(100);
  });
});

describe('rating and 0-10', () => {
  it('averages ratings and builds the distribution', () => {
    const q = { id: 'r', type: 'rating', scale: 5 };
    const s = summarizeQuestion(q, [resp({ r: 5 }), resp({ r: 4 }), resp({ r: 3 }), resp({})]);
    expect(s.avg).toBe(4);
    expect(s.rows.map((r) => r.count)).toEqual([0, 0, 1, 1, 1]);
    expect(s.skipped).toBe(1);
  });

  it('leaves answers outside a shortened scale out of the average', () => {
    const q = { id: 'r', type: 'rating', scale: 5 };
    const s = summarizeQuestion(q, [resp({ r: 9 }), resp({ r: 10 }), resp({ r: 5 }), resp({ r: 3 })]);
    expect(s.avg).toBe(4);
    expect(s.outOfScale).toBe(2);
    expect(s.answered).toBe(4);
    expect(s.rows[4]).toMatchObject({ count: 1, pct: 50 });
  });

  it('leaves answers outside 0 to 10, or a slider range, out of the numbers', () => {
    const n = summarizeQuestion({ id: 'n', type: 'nps' }, [resp({ n: 55 }), resp({ n: 80 }), resp({ n: 9.5 }), resp({ n: 10 }), resp({ n: 0 })]);
    expect(n).toMatchObject({ promoters: 1, detractors: 1, score: 0, outOfScale: 3, answered: 5 });
    expect(n.avg).toBe(5);
    const s = summarizeQuestion({ id: 's', type: 'slider', min: 0, max: 10, step: 1 }, [resp({ s: 80 }), resp({ s: 90 }), resp({ s: 4 })]);
    expect(s).toMatchObject({ mean: 4, median: 4, min: 4, max: 4, outOfScale: 2 });
    expect(s.bins.reduce((t, b) => t + b.count, 0)).toBe(1);
  });

  it('computes the recommendation score', () => {
    expect(npsBreakdown([10, 9, 8, 7, 6, 0])).toEqual({ promoters: 2, passives: 2, detractors: 2, score: 0 });
    expect(npsBreakdown([10, 10, 10, 1])).toMatchObject({ score: 50 });
    expect(npsBreakdown([]).score).toBeNull();
    // 40 answers, one more promoter than detractors (+2.5) and the reverse.
    const filler = Array(38).fill(8);
    expect(npsBreakdown([10, ...filler, 8]).score).toBe(3);
    expect(npsBreakdown([0, ...filler, 8]).score).toBe(-3);
    expect(Object.is(npsBreakdown([...Array(299).fill(8), 0]).score, 0)).toBe(true);
    const s = summarizeQuestion({ id: 'n', type: 'nps' }, [resp({ n: 10 }), resp({ n: 0 }), resp({ n: 0 })]);
    expect(s.score).toBe(-33);
    expect(s.rows).toHaveLength(11);
    expect(s.rows[0].count).toBe(2);
  });
});

describe('answers from before a change of type', () => {
  it('leaves them out of the summary and shows them as text', () => {
    const asText = { id: 'q1', type: 'text', title: 'Now text' };
    const rs = [resp({ q1: { c: 'a' } }), resp({ q1: 'typed' })];
    const s = summarizeQuestion(asText, rs);
    expect(s.answered).toBe(1);
    expect(s.entries.map((e) => e.text)).toEqual(['typed']);
    expect(s.words.map((w) => w.word)).not.toContain('object');
    // The question no longer lists that choice: said so, not shown as an id.
    expect(answerLines(asText, { c: 'a' })).toEqual(['(removed choice)']);
    // Where it still does (now a ranking), by its label.
    const asRanking = { id: 'q1', type: 'ranking', choices: [{ id: 'a', label: 'Apple' }] };
    expect(answerLines(asRanking, { c: 'a' })).toEqual(['Apple']);
    expect(answerLines({ ...asText, choices: asRanking.choices }, ['a'])).toEqual(['1. Apple']);

    // A grid turned into text boxes, and a choice into a grid: earlier
    // answers are not read as answers to the new parts.
    const grid = { id: 'q1', type: 'matrix', rows: [{ id: 'r1', label: 'Price' }], columns: [{ id: 'k1', label: 'Good' }] };
    const boxes = convertQuestion(grid, 'multitext');
    expect(boxes.fields[0].id).not.toBe('r1');
    expect(summarizeQuestion(boxes, [resp({ q1: { r1: 'k1' } })]).answered).toBe(0);
    expect(summarizeQuestion(convertQuestion(asText, 'matrix'), [resp({ q1: { c: 'a' } })]).answered).toBe(0);
    // A grid answer whose row was removed since still counts.
    expect(summarizeQuestion(grid, [resp({ q1: { rOld: 'k1' } })]).answered).toBe(1);

    const asChoice = { id: 'q1', type: 'single', choices: [{ id: 'a', label: 'A' }] };
    const c = summarizeQuestion(asChoice, rs);
    expect(c.answered).toBe(1);
    expect(c.rows[0]).toMatchObject({ label: 'A', count: 1, pct: 100 });
    expect(answerLines(asChoice, 'typed')).toEqual(['typed']);
  });
});

describe('blank labels', () => {
  it('calls a choice or row whose label was cleared blank, not removed', () => {
    const rank = { id: 'k', type: 'ranking', choices: [{ id: 'a', label: 'A' }, { id: 'b', label: '' }] };
    const r = summarizeQuestion(rank, [resp({ k: ['b', 'a', 'gone'] })]);
    expect(r.items.map((i) => [i.label, i.removed])).toEqual([['(blank choice)', false], ['A', false], [REMOVED_CHOICE, true]]);
    const grid = { id: 'g', type: 'matrix', rows: [{ id: 'r1', label: 'One' }, { id: 'r2', label: ' ' }], columns: [{ id: 'c1', label: 'Yes' }] };
    const g = summarizeQuestion(grid, [resp({ g: { r1: 'c1', r2: 'c1', r9: 'c1' } })]);
    expect(g.rows.map((x) => [x.label, !!x.removed])).toEqual([['One', false], ['(blank row)', false], ['(removed row)', true]]);
  });
});

describe('contact fields turned off after answers came in', () => {
  it('keep their names in results', () => {
    const q = { id: 'c', type: 'contact', title: 'You', fields: { name: { enabled: true }, phone: { enabled: false } } };
    const rs = [resp({ c: { name: 'Ana', phone: '555 0100' } })];
    expect(answerLines(q, rs[0].answers.c)).toContain('Phone number: 555 0100');
    expect(summarizeQuestion(q, rs).fields.map((f) => f.label)).toContain('Phone number');
  });
});

describe('responses over many years', () => {
  it('are grouped by year past 60 months', () => {
    const rs = Array.from({ length: 120 }, (_, i) => ({ at: new Date(2016, i, 15).getTime() }));
    const r = responsesOverTime(rs);
    expect(r.unit).toBe('year');
    expect(r.buckets).toHaveLength(10);
    expect(r.buckets.reduce((t, b) => t + b.count, 0)).toBe(120);
    expect(responsesOverTime(rs.slice(0, 40)).unit).toBe('month');
  });
});

describe('slider', () => {
  it('reports mean, median, min, max and bins', () => {
    const q = { id: 's', type: 'slider', min: 0, max: 100, step: 1 };
    const s = summarizeQuestion(q, [resp({ s: 10 }), resp({ s: 20 }), resp({ s: 90 }), resp({ s: 100 })]);
    expect(s).toMatchObject({ mean: 55, median: 55, min: 10, max: 100 });
    expect(s.bins).toHaveLength(10);
    expect(s.bins[9].count).toBe(2);
    expect(s.bins.reduce((t, b) => t + b.count, 0)).toBe(4);
  });

  it('gives a short scale one bar per value', () => {
    const q = { id: 's', type: 'slider', min: 1, max: 5, step: 1 };
    const s = summarizeQuestion(q, [1, 2, 3, 4, 5, 5].map((v) => resp({ s: v })));
    expect(s.bins.map((b) => [b.from, b.to, b.count])).toEqual([[1, 1, 1], [2, 2, 1], [3, 3, 1], [4, 4, 1], [5, 5, 2]]);
  });

  it('has no bar past the end when the step does not divide the range', () => {
    const q = { id: 's', type: 'slider', min: 0, max: 7, step: 2 };
    const s = summarizeQuestion(q, [resp({ s: 6 })]);
    expect(s.bins.map((b) => b.from)).toEqual([0, 2, 4, 6]);
  });

  it('falls back to ranges when answers are off the current steps', () => {
    // Answered in steps of 1, then the step became 2.
    const q = { id: 's', type: 'slider', min: 0, max: 8, step: 2 };
    const s = summarizeQuestion(q, [resp({ s: 3 }), resp({ s: 4 })]);
    expect(s.bins.every((b) => b.from !== b.to)).toBe(true);
    expect(s.bins.reduce((t, b) => t + b.count, 0)).toBe(2);
  });

  it('bins decimal steps by their value', () => {
    const q = { id: 's', type: 'slider', min: 0, max: 1, step: 0.1 };
    const s = summarizeQuestion(q, [resp({ s: 0.3 }), resp({ s: 0.6 }), resp({ s: 1 })]);
    expect(s.bins).toHaveLength(10);
    expect(s.bins[3].count).toBe(1);
    expect(s.bins[6].count).toBe(1);
    expect(s.bins[9].count).toBe(1);
  });

  it('handles an empty set', () => {
    const s = summarizeQuestion({ id: 's', type: 'slider', min: 0, max: 10 }, [resp({})]);
    expect(s).toMatchObject({ answered: 0, mean: null, median: null, min: null });
  });
});

describe('grid', () => {
  const q = {
    id: 'g',
    type: 'matrix',
    rows: [{ id: 'r1', label: 'Speed' }, { id: 'r2', label: 'Price' }],
    columns: [{ id: 'c1', label: 'Bad', weight: 1 }, { id: 'c2', label: 'OK', weight: 2 }, { id: 'c3', label: 'Good', weight: 3 }],
  };

  it('computes per-row percentages and weighted averages', () => {
    const s = summarizeQuestion(q, [resp({ g: { r1: 'c3', r2: 'c1' } }), resp({ g: { r1: 'c2' } }), resp({ g: { rOld: 'c1' } })]);
    const speed = s.rows.find((r) => r.id === 'r1');
    expect(speed.answered).toBe(2);
    expect(speed.cells.map((c) => c.pct)).toEqual([0, 50, 50]);
    expect(speed.weightedAvg).toBe(2.5);
    expect(s.rows.find((r) => r.id === 'r2').weightedAvg).toBe(1);
    expect(s.rows.find((r) => r.id === 'rOld').removed).toBe(true);
  });

  it('counts answers in removed or blank columns, without weight', () => {
    const g = { ...q, columns: [...q.columns, { id: 'cBlank', label: ' ' }] };
    const s = summarizeQuestion(g, [resp({ g: { r1: 'c1' } }), resp({ g: { r1: 'cBlank' } }), resp({ g: { r1: 'cGone' } })]);
    expect(s.columns.slice(-2).map((c) => [c.label, c.weight])).toEqual([['(blank column)', null], [REMOVED_CHOICE, null]]);
    const row = s.rows.find((r) => r.id === 'r1');
    expect(row.answered).toBe(3);
    expect(row.weightedAvg).toBe(1);
  });

  it('counts every pick in checkbox grids', () => {
    const s = summarizeQuestion({ ...q, multi: true }, [resp({ g: { r1: ['c1', 'c3'] } })]);
    expect(s.rows[0].cells.map((c) => c.count)).toEqual([1, 0, 1]);
    expect(s.rows[0].weightedAvg).toBe(2);
  });
});

describe('ranking', () => {
  it('scores items and sorts best first', () => {
    const q = { id: 'k', type: 'ranking', choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] };
    const s = summarizeQuestion(q, [resp({ k: ['b', 'a', 'c'] }), resp({ k: ['b', 'c', 'a'] }), resp({ k: ['a', 'b', 'c'] })]);
    expect(s.items.map((i) => i.label)).toEqual(['B', 'A', 'C']);
    const b = s.items[0];
    expect(b.avgRank).toBeCloseTo(4 / 3);
    expect(b.score).toBeCloseTo((3 + 3 + 2) / 3);
    expect(b.positions).toEqual([2, 1, 0]);
  });
});

describe('text', () => {
  it('lists answers newest first and finds frequent words', () => {
    const q = { id: 't', type: 'textarea' };
    const s = summarizeQuestion(q, [resp({ t: 'Great support team' }), resp({ t: 'The support was slow' }), resp({ t: 'support support support' })]);
    expect(s.entries[0].text).toBe('support support support');
    expect(s.words[0]).toEqual({ word: 'support', count: 3 });
  });

  it('ignores stopwords and numbers', () => {
    const words = topWords(['the and of 123', 'the and of 123', 'quality quality']).map((w) => w.word);
    expect(words).toEqual(['quality']);
  });

  it('summarizes multi-field answers', () => {
    const q = { id: 'c', type: 'contact', fields: { name: { enabled: true }, email: { enabled: true } } };
    const s = summarizeQuestion(q, [resp({ c: { name: 'Ana' } })]);
    expect(s.kind).toBe('fields');
    expect(s.fields.map((f) => f.id)).toEqual(expect.arrayContaining(['name', 'email']));
    expect(s.entries[0].values.name).toBe('Ana');
  });
});

describe('summarize', () => {
  it('skips statement blocks and covers every page', () => {
    const survey = { pages: [{ questions: [{ id: 'x', type: 'statement' }, single] }, { questions: [{ id: 't', type: 'text' }] }] };
    const out = summarize(survey, [resp({ q1: { c: 'a' }, t: 'hi' })]);
    expect(Object.keys(out.questions)).toEqual(['q1', 't']);
    expect(out.total).toBe(1);
  });
});

describe('responses over time', () => {
  it('fills empty days with zeros', () => {
    const d = (day) => new Date(2026, 0, day, 12).getTime();
    const { unit, buckets } = responsesOverTime([{ at: d(1) }, { at: d(1) }, { at: d(4) }]);
    expect(unit).toBe('day');
    expect(buckets.map((b) => b.count)).toEqual([2, 0, 0, 1]);
  });

  it('switches to weeks and months for long spans', () => {
    const d = (m, day) => new Date(2026, m, day, 12).getTime();
    expect(responsesOverTime([{ at: d(0, 1) }, { at: d(5, 1) }]).unit).toBe('week');
    const months = responsesOverTime([{ at: d(0, 1) }, { at: new Date(2030, 0, 1).getTime() }]);
    expect(months.unit).toBe('month');
    expect(months.buckets.length).toBe(49);
    expect(responsesOverTime([]).buckets).toEqual([]);
  });
});

describe('answer text', () => {
  it('renders every shape readably', () => {
    expect(answerLines(single, { c: OTHER_ID, t: 'Kiwi' })).toEqual(['Something else: Kiwi']);
    expect(answerLines(single, { c: 'gone' })).toEqual([REMOVED_CHOICE]);
    expect(choiceLabel({ none: { label: 'Nope' } }, NONE_ID)).toBe('Nope');
    expect(answerLines({ type: 'rating', scale: 4 }, 3)).toEqual(['3 of 4']);
    expect(answerLines({ type: 'ranking', choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }, ['b', 'a'])).toEqual(['1. B', '2. A']);
    expect(answerLines({ type: 'matrix', rows: [{ id: 'r', label: 'Row' }], columns: [{ id: 'c', label: 'Col' }] }, { r: 'c' })).toEqual(['Row: Col']);
    expect(answerLines({ type: 'multitext', fields: [{ id: 'f', label: 'City' }] }, { f: 'Oslo' })).toEqual(['City: Oslo']);
    expect(answerLines({ type: 'text' }, undefined)).toEqual([]);
    expect(answerLines({ type: 'datetime', date: true }, '2026-03-05')[0]).toMatch(/2026/);
  });
});

describe('pruneFilters', async () => {
  const { pruneFilters, emptyFilters } = await import('../src/analysis/filters.js');
  it('drops rules for questions or answers that no longer exist', () => {
    const survey = { pages: [{ id: 'p', questions: [{ id: 'q1', type: 'single', title: 'A', choices: [{ id: 'c1', label: 'Yes' }] }] }] };
    const f = { ...emptyFilters(), answers: [{ qid: 'q1', value: 'c1' }, { qid: 'q1', value: 'gone' }, { qid: 'q9', value: 'c1' }] };
    expect(pruneFilters(f, survey).answers).toEqual([{ qid: 'q1', value: 'c1' }]);
    const kept = { ...emptyFilters(), answers: [{ qid: 'q1', value: 'c1' }] };
    expect(pruneFilters(kept, survey)).toBe(kept);
  });
});

import { describe, it, expect } from 'vitest';
import { csvCell, csvColumns, toCsv, toJson } from '../src/analysis/export.js';
import {
  applyFilters,
  describeFilters,
  emptyFilters,
  isFiltered,
  normalizeFilters,
  removeFilter,
  filterableQuestions,
} from '../src/analysis/filters.js';
import { OTHER_ID, CONTACT_FIELDS } from '../src/shared/runtime.js';

const contactFields = Object.fromEntries(
  CONTACT_FIELDS.map(([id, label]) => [id, { enabled: id === 'name' || id === 'email', label }]),
);

const survey = {
  id: 'sx',
  title: 'T',
  pages: [
    {
      questions: [
        { id: 'intro', type: 'statement', title: 'Hi' },
        { id: 'q1', type: 'single', title: 'Fruit', choices: [{ id: 'a', label: 'Apple' }, { id: 'b', label: 'Banana' }], other: { enabled: true, label: 'Other' } },
        { id: 'q2', type: 'multi', title: 'Colors', choices: [{ id: 'r', label: 'Red' }, { id: 'g', label: 'Green' }], other: { enabled: false } },
        { id: 'q3', type: 'matrix', title: 'Rate', rows: [{ id: 'r1', label: 'Speed' }, { id: 'r2', label: 'Price' }], columns: [{ id: 'c1', label: 'Bad' }, { id: 'c2', label: 'Good' }] },
        { id: 'q4', type: 'ranking', title: 'Order', choices: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }] },
        { id: 'q5', type: 'contact', title: 'You', fields: contactFields },
        { id: 'q6', type: 'nps', title: 'Recommend' },
        { id: 'q7', type: 'textarea', title: 'Comments' },
        { id: 'q8', type: 'rating', title: 'Stars', scale: 5 },
      ],
    },
  ],
};

const t0 = Date.UTC(2026, 0, 2, 10, 0, 0);
const responses = [
  {
    key: 'k1',
    id: 'k1',
    cid: 'c1',
    st: t0,
    at: t0 + 65_000,
    outcome: 'complete',
    meta: { device: 'mobile' },
    answers: {
      q1: { c: OTHER_ID, t: '=HYPERLINK("x")' },
      q2: { c: ['r', 'g'] },
      q3: { r1: 'c2' },
      q4: ['y', 'x'],
      q5: { name: 'Ana', email: 'ana@example.com' },
      q6: 9,
      q7: 'Line one\nLine "two", ok',
      q8: 4,
    },
  },
  { key: 'k2', id: 'k2', cid: 'c2', st: t0, at: t0 + 86_400_000 * 3, outcome: 'disqualified', meta: { device: 'desktop' }, answers: { q1: { c: 'a' }, q8: 2 } },
];

describe('csvCell', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('-3')).toBe('-3');
    expect(csvCell('+2.5')).toBe('+2.5');
    expect(csvCell('-1+2')).toBe("'-1+2");
    expect(csvCell('+1 555 0100')).toBe("'+1 555 0100");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
  });

  it('neutralizes formulas but keeps negative numbers', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+33 1 23')).toBe("'+33 1 23");
    expect(csvCell('-x')).toBe("'-x");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell(-5)).toBe('-5');
  });
});

describe('CSV export', () => {
  it('lays out columns per question type', () => {
    const headers = csvColumns(survey, { c1: { name: 'Web link 1' } }).map((c) => c.header);
    expect(headers.slice(0, 7)).toEqual(['Response ID', 'Collector', 'Started', 'Submitted', 'Time taken (s)', 'Device', 'Outcome']);
    expect(headers.slice(7)).toEqual([
      'Q1. Fruit',
      'Q1. Fruit (Other)',
      'Q2. Colors',
      'Q3. Rate: Speed',
      'Q3. Rate: Price',
      'Q4. Order: X',
      'Q4. Order: Y',
      'Q5. You: Name',
      'Q5. You: Email address',
      'Q6. Recommend',
      'Q7. Comments',
      'Q8. Stars',
    ]);
  });

  it('writes a BOM, CRLF rows and readable values', () => {
    const csv = toCsv(survey, responses, { c1: { name: 'Web link 1' } });
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toHaveLength(4); // header, 2 rows, trailing empty
    expect(lines[3]).toBe('');
    const row = lines[1];
    expect(row).toContain('Web link 1');
    expect(row).toContain(',65,Phone,Completed,');
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).toContain('Red; Green');
    expect(row).toContain(',Good,,'); // Speed: Good, Price: blank
    expect(row).toContain(',2,1,'); // ranking X=2, Y=1
    expect(row).toContain('"Line one\nLine ""two"", ok"');
    expect(lines[2]).toContain('c2,'); // unknown collector falls back to its id
    expect(lines[2]).toContain('Disqualified');
  });

  it('exports JSON with ISO dates', () => {
    const data = JSON.parse(toJson(survey, responses, {}));
    expect(data.responses).toHaveLength(2);
    expect(data.responses[0]).toMatchObject({ id: 'k1', device: 'mobile', submittedAt: new Date(t0 + 65_000).toISOString() });
  });
});

describe('filters', () => {
  it('normalizes junk', () => {
    expect(normalizeFilters(null)).toEqual(emptyFilters());
    expect(normalizeFilters({ outcome: 'x', from: 'nope', collectors: [1, 'c1'], answers: [{ qid: 'q1', value: 'a' }, {}] })).toEqual({
      ...emptyFilters(),
      collectors: ['c1'],
      answers: [{ qid: 'q1', value: 'a' }],
    });
    expect(isFiltered(emptyFilters())).toBe(false);
  });

  it('filters by collector, outcome, device and answers', () => {
    expect(applyFilters(responses, { ...emptyFilters(), collectors: ['c2'] }).map((r) => r.key)).toEqual(['k2']);
    expect(applyFilters(responses, { ...emptyFilters(), outcome: 'complete' }).map((r) => r.key)).toEqual(['k1']);
    expect(applyFilters(responses, { ...emptyFilters(), devices: ['desktop'] }).map((r) => r.key)).toEqual(['k2']);
    expect(applyFilters(responses, { ...emptyFilters(), answers: [{ qid: 'q2', value: 'g' }] }).map((r) => r.key)).toEqual(['k1']);
    expect(applyFilters(responses, { ...emptyFilters(), answers: [{ qid: 'q8', value: '2' }] }).map((r) => r.key)).toEqual(['k2']);
    expect(applyFilters(responses, { ...emptyFilters(), answers: [{ qid: 'q1', value: 'a' }, { qid: 'q8', value: '4' }] })).toEqual([]);
  });

  it('filters by inclusive local date range', () => {
    const day = (t) => {
      const d = new Date(t);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const first = day(responses[0].at);
    expect(applyFilters(responses, { ...emptyFilters(), from: first, to: first }).map((r) => r.key)).toEqual(['k1']);
    expect(applyFilters(responses, { ...emptyFilters(), from: day(responses[1].at) }).map((r) => r.key)).toEqual(['k2']);
  });

  it('describes and removes filters', () => {
    const f = { ...emptyFilters(), collectors: ['c1'], outcome: 'complete', devices: ['mobile'], answers: [{ qid: 'q1', value: 'b' }, { qid: 'q2', value: 'g' }] };
    const chips = describeFilters(f, survey, { c1: { name: 'Newsletter' } });
    // A checkbox answer can hold several choices: it includes one.
    expect(chips.map((c) => c.label)).toEqual(['Link: Newsletter', 'Completed', 'Phone', 'Q1 is Banana', 'Q2 includes Green']);
    const after = removeFilter(f, 'answer:0');
    expect(after.answers).toEqual([{ qid: 'q2', value: 'g' }]);
    expect(f.answers).toHaveLength(2);
    expect(removeFilter(f, 'collectors').collectors).toEqual([]);
  });

  it('offers choice, rating and 0-10 questions for answer filters', () => {
    const ids = filterableQuestions(survey).map((x) => x.q.id);
    expect(ids).toEqual(['q1', 'q2', 'q6', 'q8']);
    expect(filterableQuestions(survey)[0].values.map((v) => v.label)).toEqual(['Apple', 'Banana', 'Other']);
  });
});

describe('export of answers the survey no longer asks for', () => {
  it('keeps Other text, removed grid rows and turned-off contact fields', () => {
    const s = {
      id: 'sy',
      title: 'T',
      pages: [
        {
          questions: [
            { id: 'q1', type: 'single', title: 'Fruit', choices: [{ id: 'a', label: 'Apple' }], other: { enabled: false } },
            { id: 'q3', type: 'matrix', title: 'Rate', rows: [{ id: 'r1', label: 'Speed' }], columns: [{ id: 'c1', label: 'Good' }] },
            { id: 'q5', type: 'contact', title: 'You', fields: contactFields },
          ],
        },
      ],
    };
    const r = { key: 'k', id: 'k', cid: 'c1', at: 1, st: 0, outcome: 'complete', meta: {}, answers: { q1: { c: OTHER_ID, t: 'Kiwi' }, q3: { r1: 'c1', gone: 'c1' }, q5: { name: 'Ana', phone: '555 0100' } } };
    const csv = toCsv(s, [r]);
    const [head, row] = csv.replace(/^﻿/, '').split('\r\n');
    expect(head).toContain('Q1. Fruit (Other)');
    expect(row).toContain('Kiwi');
    expect(head).toContain('Q2. Rate: (removed row)');
    expect(head).toContain('Q3. You: Phone');
    expect(row).toContain('555 0100');
    // Nothing extra when no response needs it.
    expect(csvColumns(s).map((c) => c.header)).not.toContain('Q1. Fruit (Other)');
  });
});

describe('export of answers from before a type change', () => {
  it('writes them as text in the question column', () => {
    const s = { id: 'sz', title: 'T', pages: [{ questions: [
      { id: 'q1', type: 'text', title: 'Now text' },
      { id: 'q2', type: 'single', title: 'Now choice', choices: [{ id: 'a', label: 'A' }] },
    ] }] };
    const r = { key: 'k', id: 'k', cid: 'c1', at: 1, st: 0, outcome: 'complete', meta: {}, answers: { q1: { c: 'a' }, q2: 'typed earlier' } };
    const row = toCsv(s, [r]).replace(/^\uFEFF/, '').split('\r\n')[1];
    expect(row).toContain('typed earlier');
    expect(row).toContain('(removed choice)');
  });

  it('keeps them for every question type', () => {
    const s = { id: 'sz', title: 'T', pages: [{ questions: [
      { id: 'q1', type: 'text', title: 'Was a rating' },
      { id: 'q2', type: 'rating', title: 'Was text', scale: 10 },
      { id: 'q3', type: 'ranking', title: 'Was a choice', choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
      { id: 'q4', type: 'contact', title: 'Was text', fields: {} },
      { id: 'q5', type: 'matrix', title: 'Was text', rows: [{ id: 'r1', label: 'R' }], columns: [{ id: 'k1', label: 'K' }] },
    ] }] };
    const r = { key: 'k', id: 'k', cid: 'c1', at: 1, st: 0, outcome: 'complete', meta: {}, answers: { q1: 4, q2: '7', q3: { c: 'a' }, q4: 'jane@example.com', q5: 'fine' } };
    const cols = csvColumns(s, {}, [r]);
    const cell = (header) => cols.find((c) => c.header.startsWith(header)).get(r);
    expect(cell('Q1.')).toBe('4');
    expect(cell('Q2.')).toBe(7);
    expect(cell('Q3.')).not.toBe('');
    expect(cell('Q4.')).toBe('jane@example.com');
    expect(cell('Q5.')).toBe('fine');
  });
});

describe('export of rankings with removed choices', () => {
  it('keeps the position of every ranked choice', () => {
    const s = { id: 'sr', title: 'T', pages: [{ questions: [{ id: 'k', type: 'ranking', title: 'Order', choices: [{ id: 'x', label: 'X' }] }] }] };
    const r = { key: 'k', id: 'k', cid: 'c1', at: 1, st: 0, outcome: 'complete', meta: {}, answers: { k: ['gone', 'x'] } };
    const [head, row] = toCsv(s, [r]).replace(/^\uFEFF/, '').split('\r\n');
    expect(head).toContain('Q1. Order: (removed choice)');
    expect(row.split(',').slice(-2)).toEqual(['2', '1']);
  });
});


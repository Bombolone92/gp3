import { describe, it, expect } from 'vitest';
import { parseQuickAdd } from '../src/lib/quickadd.js';

const LABELS = [
  { id: 'l1', name: 'Design', color: '#000' },
  { id: 'l2', name: 'Design System', color: '#111' },
];
const MEMBERS = [
  { id: 'm1', name: 'Maya Chen' },
  { id: 'm2', name: 'Leo Park' },
];

// A Thursday, so weekday resolution has somewhere to go in both directions.
const TODAY = '2026-08-06';
const parse = (text, extra = {}) =>
  parseQuickAdd(text, { labels: LABELS, members: MEMBERS, today: TODAY, ...extra });

describe('dates', () => {
  it('reads the documented shapes off the end', () => {
    expect(parse('Call the bank today').dueDate).toBe(TODAY);
    expect(parse('Call the bank tomorrow').dueDate).toBe('2026-08-07');
    expect(parse('Call the bank next week').dueDate).toBe('2026-08-13');
    expect(parse('Call the bank +3d').dueDate).toBe('2026-08-09');
    expect(parse('Call the bank +2w').dueDate).toBe('2026-08-20');
    expect(parse('Call the bank 2026-09-01').dueDate).toBe('2026-09-01');
    expect(parse('Call the bank aug 12').dueDate).toBe('2026-08-12');
    expect(parse('Call the bank 12 aug').dueDate).toBe('2026-08-12');
    expect(parse('Call the bank August 12, 2027').dueDate).toBe('2027-08-12');
  });

  it('takes the coming weekday, counting today', () => {
    expect(parse('Standup fri').dueDate).toBe('2026-08-07');
    expect(parse('Standup thu').dueDate).toBe(TODAY);
    expect(parse('Standup monday').dueDate).toBe('2026-08-10');
  });

  it('rolls a bare month-day forward rather than backdating it', () => {
    expect(parse('Renewal jan 5').dueDate).toBe('2027-01-05');
    // An explicit year is taken at its word.
    expect(parse('Renewal jan 5 2026').dueDate).toBe('2026-01-05');
  });

  it('only reads a date at the very end', () => {
    const mid = parse('Plan the tomorrow party');
    expect(mid.dueDate).toBeNull();
    expect(mid.title).toBe('Plan the tomorrow party');
  });

  it('does not take the tail of a longer word', () => {
    expect(parse('Refactor codefri').dueDate).toBeNull();
    expect(parse('Ship the method').dueDate).toBeNull();
  });

  it('leaves a name alone where a shorthand used to eat it', () => {
    for (const text of ['Call Tom', 'Ask Tod', 'Pair with Tom']) {
      const r = parse(text);
      expect(r.dueDate).toBeNull();
      expect(r.title).toBe(text);
    }
    // The spellings nobody writes by accident still work.
    expect(parse('Call the bank tmr').dueDate).toBe('2026-08-07');
    expect(parse('Call the bank tmrw').dueDate).toBe('2026-08-07');
  });

  it('ignores a date that is not a real day', () => {
    expect(parse('Party feb 30').dueDate).toBeNull();
    expect(parse('Party feb 30').title).toBe('Party feb 30');
  });

  it('strips the date from the title', () => {
    expect(parse('Call the bank tomorrow').title).toBe('Call the bank');
  });
});

describe('sigil tokens', () => {
  it('reads priority in every documented spelling', () => {
    expect(parse('Fix it !urgent').priority).toBe('urgent');
    expect(parse('Fix it !h').priority).toBe('high');
    expect(parse('Fix it !3').priority).toBe('medium');
    expect(parse('Fix it !low').priority).toBe('low');
  });

  it('leaves an unknown priority word in the title', () => {
    const r = parse('Ship it !yesterday');
    expect(r.priority).toBeNull();
    expect(r.title).toBe('Ship it !yesterday');
  });

  it('matches an existing label, ignoring case and separators', () => {
    expect(parse('Polish #design').labelIds).toEqual(['l1']);
    expect(parse('Polish #design-system').labelIds).toEqual(['l2']);
    expect(parse('Polish #DESIGN').labelIds).toEqual(['l1']);
  });

  it('offers to create a label it has never seen', () => {
    const r = parse('Polish #marketing');
    expect(r.labelIds).toEqual([]);
    expect(r.newLabels).toEqual(['marketing']);
    expect(r.title).toBe('Polish');
  });

  it('matches an assignee by first name or full name, and nobody else', () => {
    expect(parse('Review @maya').assigneeIds).toEqual(['m1']);
    expect(parse('Review @leo-park').assigneeIds).toEqual(['m2']);
    const miss = parse('Review @nobody');
    expect(miss.assigneeIds).toEqual([]);
    expect(miss.title).toBe('Review @nobody');
  });

  it('reads tokens anywhere, including the start', () => {
    const r = parse('!high #design Ship the beta @maya tomorrow');
    expect(r).toMatchObject({
      title: 'Ship the beta',
      priority: 'high',
      dueDate: '2026-08-07',
      labelIds: ['l1'],
      assigneeIds: ['m1'],
    });
  });

  it('lets the last of a repeated facet win', () => {
    expect(parse('Thing !low !urgent').priority).toBe('urgent');
  });

  it('collects several labels and assignees', () => {
    const r = parse('Thing #design #design-system @maya @leo');
    expect(r.labelIds).toEqual(['l1', 'l2']);
    expect(r.assigneeIds).toEqual(['m1', 'm2']);
  });
});

describe('escapes', () => {
  it('keeps a token as text when asked', () => {
    const ignore = new Set(['#design']);
    const r = parse('Rewrite the #design page', { ignore });
    expect(r.labelIds).toEqual([]);
    expect(r.title).toBe('Rewrite the #design page');
  });

  it('treats an input made only of tokens as a plain title', () => {
    const r = parse('#design');
    expect(r.title).toBe('#design');
    expect(r.labelIds).toEqual([]);
    expect(r.newLabels).toEqual([]);
    expect(r.tokens).toEqual([]);
  });

  it('handles an empty input without inventing anything', () => {
    expect(parse('')).toMatchObject({ title: '', dueDate: null, priority: null, tokens: [] });
  });

  it('reports every token it claimed, for the chips', () => {
    const r = parse('Ship #design !high @maya tomorrow');
    expect(r.tokens.map((t) => t.kind).sort())
      .toEqual(['assignee', 'due', 'label', 'priority']);
    expect(r.tokens.every((t) => t.raw)).toBe(true);
  });
});

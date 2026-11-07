import { describe, it, expect } from 'vitest';
import { parseGoal, recallGoal, rememberGoal, moveGoal, describeGoal } from '../src/lib/goal.js';

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

describe('word count goal', () => {
  it('parses counts, blanks, and nonsense', () => {
    expect(parseGoal('2,000')).toBe(2000);
    expect(parseGoal(' 500 ')).toBe(500);
    expect(parseGoal('')).toBeNull();
    // No goal is a goal of nothing: 0 clears it, as an empty field does.
    expect(parseGoal('0')).toBeNull();
    expect(parseGoal('000')).toBeNull();
    for (const spelling of ['1e3', '0x10', '0b11', '1.0', '+5', 'Infinity']) expect(parseGoal(spelling)).toBeNaN();
    expect(parseGoal('1.5')).toBeNaN();
    expect(parseGoal('lots')).toBeNaN();
  });

  it('stores, clears, and moves goals by path', () => {
    const storage = memory();
    expect(recallGoal('Documents/A.docx', { storage })).toBeNull();
    rememberGoal('Documents/A.docx', 1500, { storage });
    expect(recallGoal('Documents/A.docx', { storage })).toBe(1500);
    moveGoal('Documents/A.docx', 'Documents/B.docx', { storage });
    expect(recallGoal('Documents/A.docx', { storage })).toBeNull();
    expect(recallGoal('Documents/B.docx', { storage })).toBe(1500);
    rememberGoal('Documents/B.docx', null, { storage });
    expect(recallGoal('Documents/B.docx', { storage })).toBeNull();
    storage.setItem('documents:goals', 'garbage');
    expect(recallGoal('Documents/B.docx', { storage })).toBeNull();
  });

  it('describes progress for the status bar', () => {
    expect(describeGoal(1204, 2000)).toEqual({ label: '1,204 / 2,000 words', done: 0.602, reached: false });
    expect(describeGoal(2500, 2000)).toEqual({ label: '2,500 / 2,000 words', done: 1, reached: true });
  });
});

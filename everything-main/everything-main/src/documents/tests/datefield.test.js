import { describe, it, expect } from 'vitest';
import { dateFieldFormat, dateFieldInstruction, dateFieldText, caretTarget, insertDateField } from '../src/lib/datefield.js';

describe('date field', () => {
  it('picks the date picture by locale', () => {
    expect(dateFieldFormat('en-US')).toBe('MMMM d, yyyy');
    expect(dateFieldFormat('en')).toBe('MMMM d, yyyy');
    expect(dateFieldFormat('en-GB')).toBe('d MMMM yyyy');
    expect(dateFieldFormat('de-DE')).toBe('d MMMM yyyy');
    // The seed reads the way the field recomputes, so the date does not change on the next open.
    const day = new Date(2026, 8, 14);
    expect(dateFieldText(day, 'en-US')).toBe('September 14, 2026');
    expect(dateFieldText(day, 'de-DE')).toBe('14 September 2026');
    expect(dateFieldText(day, 'ja-JP')).toBe('14 September 2026');
    expect(dateFieldInstruction('en-US')).toBe('DATE \\@ "MMMM d, yyyy"');
  });

  it('targets the caret and inserts the field with today\'s text', async () => {
    const snap = { selectionTarget: { start: { kind: 'text', blockId: 'p1', offset: 4 }, end: { kind: 'text', blockId: 'p1', offset: 9 } } };
    expect(caretTarget(snap)).toEqual({ kind: 'text', segments: [{ blockId: 'p1', range: { start: 4, end: 4 } }], story: { kind: 'story', storyType: 'body' } });
    expect(caretTarget(null)).toBeNull();
    const calls = [];
    const api = { fields: { insert: async (i) => { calls.push(i); return { success: true }; } } };
    await insertDateField(api, snap, 'August 28, 2026', { locale: 'en-US' });
    expect(calls[0]).toMatchObject({ instruction: 'DATE \\@ "MMMM d, yyyy"', mode: 'raw', cachedResultText: 'August 28, 2026' });
    expect(calls[0].at.segments[0].blockId).toBe('p1');
    await expect(insertDateField(api, {}, 'x')).rejects.toThrow('Place the cursor');
    await expect(insertDateField({ fields: { insert: async () => ({ success: false, failure: { message: 'no' } }) } }, snap, 'x')).rejects.toThrow('no');
  });
});

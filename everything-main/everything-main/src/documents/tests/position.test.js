import { describe, it, expect } from 'vitest';
import { rememberPosition, recallPosition, forgetPosition, movePosition, MAX_POSITIONS } from '../src/lib/position.js';

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };

describe('where you left off', () => {
  it('remembers, recalls, and forgets a place per document', () => {
    const storage = memory();
    expect(recallPosition('Documents/A.docx', { storage })).toBeNull();
    rememberPosition('Documents/A.docx', { blockId: 'b7', offset: 12 }, { storage, now: 100 });
    expect(recallPosition('Documents/A.docx', { storage })).toEqual({ blockId: 'b7', offset: 12, at: 100 });
    rememberPosition('Documents/A.docx', { blockId: 'b9', offset: -3 }, { storage, now: 200 });
    expect(recallPosition('Documents/A.docx', { storage })).toEqual({ blockId: 'b9', offset: 0, at: 200 });
    forgetPosition('Documents/A.docx', { storage });
    expect(recallPosition('Documents/A.docx', { storage })).toBeNull();
  });

  it('ignores useless input and broken storage', () => {
    const storage = memory();
    rememberPosition('', { blockId: 'b1' }, { storage });
    rememberPosition('Documents/A.docx', {}, { storage });
    expect(storage.m.size).toBe(0);
    storage.setItem('documents:positions', '[not json');
    expect(recallPosition('Documents/A.docx', { storage })).toBeNull();
    rememberPosition('Documents/A.docx', { blockId: 'b1' }, { storage });
    expect(recallPosition('Documents/A.docx', { storage }).blockId).toBe('b1');
  });

  it('survives a damaged entry left in storage by something else', () => {
    const storage = memory();
    storage.setItem('documents:positions', JSON.stringify({ 'Documents/old.docx': null, 'Documents/odd.docx': 'text' }));
    expect(() => rememberPosition('Documents/a.docx', { blockId: 'p1', offset: 4 }, { storage, now: 5 })).not.toThrow();
    expect(recallPosition('Documents/a.docx', { storage })).toEqual({ blockId: 'p1', offset: 4, at: 5 });
    expect(recallPosition('Documents/old.docx', { storage })).toBeNull();
  });

  it('follows renames and trims to the most recent documents', () => {
    const storage = memory();
    rememberPosition('Documents/Old.docx', { blockId: 'b1', offset: 4 }, { storage, now: 1 });
    movePosition('Documents/Old.docx', 'Documents/New.docx', { storage });
    expect(recallPosition('Documents/Old.docx', { storage })).toBeNull();
    expect(recallPosition('Documents/New.docx', { storage })).toMatchObject({ blockId: 'b1', offset: 4 });
    for (let i = 0; i < MAX_POSITIONS + 5; i++) rememberPosition(`Documents/${i}.docx`, { blockId: 'x' }, { storage, now: 10 + i });
    expect(recallPosition('Documents/New.docx', { storage })).toBeNull();
    expect(recallPosition('Documents/0.docx', { storage })).toBeNull();
    expect(recallPosition(`Documents/${MAX_POSITIONS + 4}.docx`, { storage })).not.toBeNull();
    expect(Object.keys(JSON.parse(storage.getItem('documents:positions')))).toHaveLength(MAX_POSITIONS);
  });
});

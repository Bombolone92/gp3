import { describe, it, expect, beforeEach, vi } from 'vitest';

// A small localStorage and window for the module.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const events = [];
globalThis.window = { dispatchEvent: (e) => events.push(e.type) };
globalThis.CustomEvent = class CustomEvent { constructor(type) { this.type = type; } };

const drafts = await import('../src/lib/drafts.js');

describe('drafts', () => {
  beforeEach(() => {
    mem.clear();
    events.length = 0;
    drafts._resetDraftCache();
    vi.useRealTimers();
  });

  it('keeps a draft per conversation and lists a workspace newest first', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    drafts.setDraft(drafts.draftKey('ws1', 'c1'), { text: 'hello' });
    vi.setSystemTime(2000);
    drafts.setDraft(drafts.draftKey('ws1', 'c2'), { text: 'later one' });
    drafts.setDraft(drafts.draftKey('ws2', 'c1'), { text: 'elsewhere' });
    expect(drafts.listDrafts('ws1').map((d) => d.conv)).toEqual(['c2', 'c1']);
    expect(drafts.draftCount('ws1')).toBe(2);
    expect(drafts.hasDraft('ws1:c1')).toBe(true);
    expect(drafts.getDraft('ws1:c1')).toMatchObject({ text: 'hello', ts: 1000 });
  });

  it('survives a reload: the next read comes from storage', () => {
    drafts.setDraft('ws1:c1', { text: 'kept', attachments: [{ id: 'f1', name: 'a.png', size: 1, type: 'image/png' }] });
    drafts._resetDraftCache();
    expect(drafts.getDraft('ws1:c1')).toMatchObject({ text: 'kept' });
    expect(drafts.getDraft('ws1:c1').attachments).toHaveLength(1);
  });

  it('an empty draft removes the entry, and unchanged text writes nothing', () => {
    drafts.setDraft('ws1:c1', { text: 'x' });
    const writes = events.length;
    drafts.setDraft('ws1:c1', { text: 'x' });
    expect(events.length).toBe(writes);
    drafts.setDraft('ws1:c1', { text: '   ' });
    expect(drafts.hasDraft('ws1:c1')).toBe(false);
    expect(drafts.listDrafts('ws1')).toEqual([]);
    drafts.deleteDraft('ws1:missing');
  });

  it('announces changes on window', () => {
    drafts.setDraft('ws1:c1', { text: 'a' });
    drafts.deleteDraft('ws1:c1');
    expect(events).toEqual(['teamchat:drafts', 'teamchat:drafts']);
  });

  it('caps the map at 200 entries, dropping the oldest', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 205; i++) {
      vi.setSystemTime(i + 1);
      drafts.setDraft(`ws1:c${i}`, { text: `d${i}` });
    }
    const list = drafts.listDrafts('ws1');
    expect(list).toHaveLength(200);
    expect(list.some((d) => d.conv === 'c0')).toBe(false);
    expect(list.some((d) => d.conv === 'c204')).toBe(true);
  });
});

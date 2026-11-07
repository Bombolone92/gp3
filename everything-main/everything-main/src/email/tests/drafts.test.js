import { describe, it, expect } from 'vitest';
import { createDraftStore, isEmptyDraft, draftToMessage } from '../src/lib/drafts.js';
import { memoryStorage } from '../src/lib/readstate.js';

// A clock the tests drive, so "newest first" is asserted rather than raced.
const clock = (start = 1000) => {
  let t = start;
  return { now: () => (t += 1000), at: () => t };
};

const store = (over = {}) => {
  const storage = over.storage ?? memoryStorage();
  const time = over.clock ?? clock();
  return { storage, time, drafts: createDraftStore(over.scope ?? 'me', storage, time.now) };
};

const draft = (over = {}) => ({ id: 'a', to: 'a@b.co', cc: '', subject: 'Hi', body: 'text', ...over });

describe('isEmptyDraft', () => {
  it('is empty when every text field is blank', () => {
    expect(isEmptyDraft({})).toBe(true);
    expect(isEmptyDraft({ to: '  ', cc: '', subject: '\n', body: ' ' })).toBe(true);
    // The sending domain is a preference, not content.
    expect(isEmptyDraft({ domain: 'puter.email' })).toBe(true);
  });

  it('is not empty as soon as anything has been typed', () => {
    expect(isEmptyDraft({ body: 'x' })).toBe(false);
    expect(isEmptyDraft({ to: 'a@b.co' })).toBe(false);
    expect(isEmptyDraft({ subject: 'Hi' })).toBe(false);
  });
});

describe('createDraftStore', () => {
  it('saves and reads back every field', () => {
    const { drafts } = store();
    expect(drafts.save(draft({ domain: 'puterstaging.email' }))).toBe(true);
    expect(drafts.get('a')).toMatchObject({
      id: 'a', domain: 'puterstaging.email', to: 'a@b.co', cc: '', subject: 'Hi', body: 'text',
    });
    expect(drafts.count).toBe(1);
  });

  it('upserts by id rather than piling up copies', () => {
    const { drafts } = store();
    drafts.save(draft());
    drafts.save(draft({ body: 'more text' }));
    expect(drafts.count).toBe(1);
    expect(drafts.get('a').body).toBe('more text');
  });

  it('preserves unrelated drafts written from another open app window', () => {
    const storage = memoryStorage();
    const first = createDraftStore('me', storage);
    const second = createDraftStore('me', storage);
    first.save(draft({ id: 'first' }));
    second.save(draft({ id: 'second' }));
    first.save(draft({ id: 'first', body: 'updated' }));
    expect(createDraftStore('me', storage).list().map((entry) => entry.id).sort()).toEqual(['first', 'second']);
  });

  it('does not remove a draft from memory when deletion cannot be persisted', () => {
    const storage = memoryStorage();
    const drafts = createDraftStore('me', storage);
    drafts.save(draft());
    storage.setItem = () => { throw new Error('Quota'); };
    expect(drafts.remove('a')).toBe(false);
    expect(drafts.get('a')).not.toBeNull();
  });

  it('lists newest first', () => {
    const { drafts } = store();
    drafts.save(draft({ id: 'first' }));
    drafts.save(draft({ id: 'second' }));
    drafts.save(draft({ id: 'first', body: 'edited' }));
    expect(drafts.list().map((d) => d.id)).toEqual(['first', 'second']);
  });

  it('survives a reload through the same storage', () => {
    const { storage, time } = store();
    createDraftStore('me', storage, time.now).save(draft());
    expect(createDraftStore('me', storage, time.now).get('a').body).toBe('text');
  });

  it('is scoped per account, so drafts never leak between them', () => {
    const { storage, time } = store();
    createDraftStore('me', storage, time.now).save(draft());
    const other = createDraftStore('you', storage, time.now);
    expect(other.get('a')).toBeNull();
    expect(other.count).toBe(0);
  });

  it('removes a draft, and says whether there was one', () => {
    const { drafts } = store();
    drafts.save(draft());
    expect(drafts.remove('a')).toBe(true);
    expect(drafts.remove('a')).toBe(false);
    expect(drafts.list()).toEqual([]);
  });

  it('reports a storage that refused the write, so the dialog can say so', () => {
    const full = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
    expect(createDraftStore('me', full).save(draft())).toBe(false);
  });

  it('ignores stored junk instead of throwing', () => {
    const storage = memoryStorage();
    storage.setItem('puter-mail:drafts:me', 'not json');
    expect(createDraftStore('me', storage).list()).toEqual([]);
    storage.setItem('puter-mail:drafts:me', '[{"no":"id"},null,42]');
    expect(createDraftStore('me', storage).list()).toEqual([]);
  });

  it('coerces every stored field to a string, whatever was in storage', () => {
    const storage = memoryStorage();
    storage.setItem('puter-mail:drafts:me', JSON.stringify([{ id: 'a', body: { x: 1 }, to: 7 }]));
    const stored = createDraftStore('me', storage).get('a');
    expect(stored.body).toBe('');
    expect(stored.to).toBe('');
  });

  it('keeps the newest 50 drafts rather than growing forever', () => {
    const { drafts } = store();
    for (let i = 0; i < 60; i++) drafts.save(draft({ id: `d${i}` }));
    expect(drafts.count).toBe(50);
    expect(drafts.get('d59')).not.toBeNull();
    expect(drafts.get('d0')).toBeNull();
  });

  it('records how many attachments a draft had, since their bytes are not kept', () => {
    const { drafts } = store();
    drafts.save(draft({ attachments: 2 }));
    expect(drafts.get('a').attachments).toBe(2);
  });
});

describe('draftToMessage', () => {
  const at = Date.UTC(2026, 7, 22, 9, 30);

  it('gives the list everything a row needs, with no file to read', () => {
    const message = draftToMessage({
      id: 'abc', updated: at, subject: '  Half-written  ', to: '"Doe, Jane" <jane@x.co>, bob@y.co',
      body: 'first line\nsecond line',
    });
    expect(message).toMatchObject({
      name: 'abc', box: 'drafts', day: '2026-08-22', subject: 'Half-written',
      snippet: 'first line second line', hasAttachments: false,
    });
    expect(message.to.map((a) => a.email)).toEqual(['jane@x.co', 'bob@y.co']);
    expect(message.path).toBeUndefined();
    expect(message.date.getTime()).toBe(at);
  });

  it('handles a draft with nothing but a body', () => {
    const message = draftToMessage({ id: 'abc', updated: at, body: 'just this' });
    expect(message.subject).toBe('');
    expect(message.to).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import {
  parseQuery, matchesQuery, needsIndex, createSearchIndex,
} from '../src/lib/search.js';
import { memoryStorage } from '../src/lib/readstate.js';
import { enrichMessage } from '../src/lib/mailbox.js';

const entry = (over = {}) => ({
  name: 'a--x',
  subject: 'Q3 usage report attached',
  from: { name: 'Ana Petrova', email: 'ana@meridianlabs.example' },
  snippet: 'Here is the usage export you asked for',
  hasAttachments: true,
  date: new Date('2026-08-20T16:30:00Z'),
  ...over,
});

// A message whose header has not been read yet: the subject comes from the
// filename, and nothing else exists.
const unread = (over = {}) => ({ name: 'b--y', subject: 'Print files, final versions', ...over });

const match = (raw, message, state) => matchesQuery(parseQuery(raw), message, state);

describe('parseQuery', () => {
  it('splits plain terms', () => {
    expect(parseQuery('usage report')).toEqual({
      terms: [{ field: 'any', value: 'usage' }, { field: 'any', value: 'report' }],
      flags: [],
      empty: false,
    });
  });

  it('keeps a quoted phrase whole', () => {
    expect(parseQuery('"usage report" ana').terms).toEqual([
      { field: 'any', value: 'usage report' },
      { field: 'any', value: 'ana' },
    ]);
  });

  it('keeps a quoted phrase whole after a field prefix', () => {
    expect(parseQuery('subject:"usage report"').terms).toEqual([
      { field: 'subject', value: 'usage report' },
    ]);
    expect(parseQuery('from:"Ana Petrova" q3').terms).toEqual([
      { field: 'from', value: 'ana petrova' },
      { field: 'any', value: 'q3' },
    ]);
  });

  it('reads field prefixes and lowercases the value', () => {
    expect(parseQuery('From:Ana SUBJECT:Q3').terms).toEqual([
      { field: 'from', value: 'ana' },
      { field: 'subject', value: 'q3' },
    ]);
  });

  it('reads the flag prefixes', () => {
    expect(parseQuery('has:attachment is:unread is:starred').flags)
      .toEqual(['attachment', 'unread', 'starred']);
    expect(parseQuery('has:attachments').flags).toEqual(['attachment']);
  });

  it('treats an unknown prefix as text rather than dropping what was typed', () => {
    expect(parseQuery('label:work').terms).toEqual([{ field: 'any', value: 'label:work' }]);
  });

  it.each(['constructor', '__proto__', 'constructor:report', 'constructor:2026-08-01'])(
    'treats %s as literal text rather than an inherited operator', (text) => {
      const query = parseQuery(text);
      expect(query).toEqual({ terms: [{ field: 'any', value: text }], flags: [], empty: false });
      expect(needsIndex(query)).toBe(true);
      expect(matchesQuery(query, entry())).toBe(false);
      expect(matchesQuery(query, entry({ subject: `Details about ${text}` }))).toBe(true);
    },
  );

  it('is empty for an empty or whitespace query', () => {
    expect(parseQuery('').empty).toBe(true);
    expect(parseQuery('   ').empty).toBe(true);
    expect(parseQuery('""').empty).toBe(true);
  });
});

describe('needsIndex', () => {
  it('is false for a query the filenames alone can answer', () => {
    expect(needsIndex(parseQuery('subject:usage'))).toBe(false);
    expect(needsIndex(parseQuery('is:unread is:starred'))).toBe(false);
  });

  it('is true as soon as sender, preview, or attachments are involved', () => {
    expect(needsIndex(parseQuery('usage'))).toBe(true);
    expect(needsIndex(parseQuery('from:ana'))).toBe(true);
    expect(needsIndex(parseQuery('body:export'))).toBe(true);
    expect(needsIndex(parseQuery('has:attachment'))).toBe(true);
  });
});

describe('matchesQuery', () => {
  it('does not search a failed-read placeholder as though it were the sender', async () => {
    const patch = await enrichMessage({ read: async () => { throw new Error('offline'); } }, { path: '/message' });
    const failed = entry({ ...patch, subject: 'A real report' });
    expect(match('from:unreadable', failed)).toBe(false);
    expect(match('unreadable', failed)).toBe(false);
    expect(match('subject:report', failed)).toBe(true);
    expect(match('report', failed)).toBe(true);
    expect(match('unreadable', { ...failed, subject: 'An unreadable report' })).toBe(true);
  });

  it('still matches unreadable when it is part of a real sender name', () => {
    const message = entry({ from: { name: 'Unreadable', email: 'unreadable@example.com' } });
    expect(match('from:unreadable', message)).toBe(true);
    expect(match('unreadable', message)).toBe(true);
  });

  it('matches the subject, the sender, and the preview line', () => {
    expect(match('usage', entry())).toBe(true);
    expect(match('petrova', entry())).toBe(true);
    expect(match('meridianlabs', entry())).toBe(true);
    expect(match('asked for', entry())).toBe(true);
    expect(match('nowhere', entry())).toBe(false);
  });

  it('is case insensitive', () => {
    expect(match('ANA PETROVA', entry())).toBe(true);
  });

  it('requires every term, not any of them', () => {
    expect(match('usage petrova', entry())).toBe(true);
    expect(match('usage nowhere', entry())).toBe(false);
  });

  it('narrows to one field with a prefix', () => {
    expect(match('from:ana', entry())).toBe(true);
    expect(match('from:usage', entry())).toBe(false);
    expect(match('subject:usage', entry())).toBe(true);
    expect(match('subject:petrova', entry())).toBe(false);
    expect(match('body:export', entry())).toBe(true);
    expect(match('body:q3', entry())).toBe(false);
  });

  it('matches recipients too, which is what Sent and Drafts rows show', () => {
    const sent = entry({ to: [{ name: 'Leo Tanaka', email: 'leo@puter.com' }] });
    expect(match('tanaka', sent)).toBe(true);
    expect(match('leo@puter.com', sent)).toBe(true);
  });

  it('reads the flags from the state it is given, not from the entry', () => {
    expect(match('is:unread', entry(), { isRead: false })).toBe(true);
    expect(match('is:unread', entry(), { isRead: true })).toBe(false);
    expect(match('is:read', entry(), { isRead: true })).toBe(true);
    expect(match('is:starred', entry(), { isStarred: true })).toBe(true);
    expect(match('is:starred', entry(), { isStarred: false })).toBe(false);
    expect(match('is:unstarred', entry(), { isStarred: false })).toBe(true);
  });

  it('matches has:attachment against the indexed flag', () => {
    expect(match('has:attachment', entry())).toBe(true);
    expect(match('has:attachment', entry({ hasAttachments: false }))).toBe(false);
  });

  it('combines terms and flags', () => {
    expect(match('usage has:attachment is:unread', entry(), { isRead: false })).toBe(true);
    expect(match('usage has:attachment is:unread', entry(), { isRead: true })).toBe(false);
  });

  it('matches an unindexed message by subject, since the filename carries it', () => {
    expect(match('print files', unread())).toBe(true);
    expect(match('subject:final', unread())).toBe(true);
  });

  it('does not pretend to match an unindexed sender or preview', () => {
    expect(match('from:marta', unread())).toBe(false);
    expect(match('proofs', unread())).toBe(false);
    expect(match('has:attachment', unread())).toBe(false);
  });

  it('matches everything when the query is empty', () => {
    expect(match('', entry())).toBe(true);
    expect(match('', unread())).toBe(true);
  });
});

describe('createSearchIndex', () => {
  const indexed = () => {
    const storage = memoryStorage();
    const index = createSearchIndex('me', storage);
    index.add(entry());
    return { storage, index };
  };

  it('fills a listed message in from the cache, with no read', () => {
    const { index } = indexed();
    const listed = { name: 'a--x', subject: 'Q3 usage report attached' };
    expect(index.hydrate(listed)).toBe(true);
    expect(listed.from).toEqual({ name: 'Ana Petrova', email: 'ana@meridianlabs.example' });
    expect(listed.snippet).toBe('Here is the usage export you asked for');
    expect(listed.hasAttachments).toBe(true);
    expect(listed.date.toISOString()).toBe('2026-08-20T16:30:00.000Z');
  });

  it('says so when it has nothing for a message', () => {
    const { index } = indexed();
    const listed = { name: 'never--seen' };
    expect(index.hydrate(listed)).toBe(false);
    expect(listed.from).toBeUndefined();
  });

  it('survives a reload through the same storage', () => {
    const { storage, index } = indexed();
    index.flush();
    const fresh = createSearchIndex('me', storage);
    expect(fresh.size).toBe(1);
    const listed = { name: 'a--x' };
    expect(fresh.hydrate(listed)).toBe(true);
    expect(listed.from.name).toBe('Ana Petrova');
  });

  it('does not write until it is flushed', () => {
    const { storage, index } = indexed();
    expect(createSearchIndex('me', storage).size).toBe(0);
    index.flush();
    expect(createSearchIndex('me', storage).size).toBe(1);
  });

  it('is scoped per account', () => {
    const { storage, index } = indexed();
    index.flush();
    expect(createSearchIndex('you', storage).size).toBe(0);
  });

  it('keeps a message with no date and no sender name usable', () => {
    const storage = memoryStorage();
    const index = createSearchIndex('me', storage);
    index.add({ name: 'c--z', from: { name: '', email: 'noreply@x.co' } });
    const listed = { name: 'c--z' };
    index.hydrate(listed);
    expect(listed.from).toEqual({ name: 'noreply@x.co', email: 'noreply@x.co' });
    expect(listed.snippet).toBe('');
    expect(listed.date).toBeUndefined();
  });

  it('truncates the stored preview rather than keeping a whole body', () => {
    const storage = memoryStorage();
    const index = createSearchIndex('me', storage);
    index.add(entry({ snippet: 'x'.repeat(500) }));
    const listed = { name: 'a--x' };
    index.hydrate(listed);
    expect(listed.snippet).toHaveLength(160);
    expect(listed.searchIncomplete).toBe(true);
  });

  it('does not mistake capped recipients for complete searchable metadata', () => {
    const index = createSearchIndex('me', memoryStorage());
    index.add(entry({ to: Array.from({ length: 21 }, (_, i) => ({ name: `Person ${i}`, email: `${i}@example.com` })) }));
    const listed = { name: 'a--x' };
    expect(index.hydrate(listed)).toBe(true);
    expect(listed.to).toHaveLength(20);
    expect(listed.searchIncomplete).toBe(true);
  });

  it('drops the oldest entries past the cap instead of growing forever', () => {
    const index = createSearchIndex('me', memoryStorage(), { cap: 3 });
    for (let i = 0; i < 5; i++) index.add(entry({ name: `m${i}--x` }));
    expect(index.size).toBe(3);
    expect(index.has('m0--x')).toBe(false);
    expect(index.has('m4--x')).toBe(true);
  });

  it('trims a batch at a time rather than on every message', () => {
    const index = createSearchIndex('me', memoryStorage(), { cap: 10 });
    for (let i = 0; i < 40; i++) index.add(entry({ name: `m${i}--x` }));
    expect(index.size).toBeLessThanOrEqual(10);
    expect(index.has('m39--x')).toBe(true);
    expect(index.has('m0--x')).toBe(false);
  });

  it('counts a message written twice once', () => {
    const index = createSearchIndex('me', memoryStorage());
    index.add(entry({ name: 'a--x' }));
    index.add(entry({ name: 'a--x' }));
    expect(index.size).toBe(1);
  });

  it('keeps what the conversation view groups on', () => {
    const storage = memoryStorage();
    const index = createSearchIndex('me', storage);
    index.add(entry({
      messageId: '<c@x.co>',
      references: ['<a@x.co>', '<b@x.co>', '<c-parent@x.co>'],
    }));
    index.flush();

    const listed = { name: 'a--x' };
    expect(createSearchIndex('me', storage).hydrate(listed, { needsThread: true })).toBe(true);
    expect(listed.messageId).toBe('<c@x.co>');
    // The root and the parent, which are what do the linking; the middle of a
    // long chain is not worth the room it takes in one key-value entry.
    expect(listed.references).toEqual(['<a@x.co>', '<c-parent@x.co>']);
  });

  it('is no answer for the conversation view when it was written without one', () => {
    // An entry from before threading existed. Grouping from those would put
    // every message in a conversation of its own, so the header is read again.
    const { index } = indexed();
    const listed = { name: 'a--x' };
    expect(index.hydrate(listed, { needsThread: true })).toBe(false);
    // And it is still a perfectly good answer for a row.
    expect(index.hydrate(listed)).toBe(true);
    expect(listed.from.name).toBe('Ana Petrova');
  });

  it('records a message that has no id as having none', () => {
    // Otherwise it is read again on every regrouping, for ever.
    const storage = memoryStorage();
    const index = createSearchIndex('me', storage);
    index.add(entry({ messageId: '', references: [] }));
    const listed = { name: 'a--x' };
    expect(index.hydrate(listed, { needsThread: true })).toBe(true);
    expect(listed.messageId).toBe('');
    expect(listed.references).toEqual([]);
  });

  it('keeps the recipients and the threading slots apart', () => {
    // The slots are positional: an entry with threading but no recipients
    // would otherwise hand its message id back as the recipient list.
    const storage = memoryStorage();
    const index = createSearchIndex('me', storage);
    index.add(entry({ to: undefined, messageId: '<c@x.co>', references: [] }));
    const listed = { name: 'a--x' };
    expect(index.hydrate(listed, { needsThread: true })).toBe(true);
    expect(listed.to).toBeUndefined();
    expect(listed.messageId).toBe('<c@x.co>');
    // And such an entry is still no answer for a Sent row.
    expect(index.hydrate({ name: 'a--x' }, { needsRecipients: true })).toBe(false);
  });

  it('answers a Sent row only from an entry that marks the recipients as the account\'s own', () => {
    const storage = memoryStorage();
    const index = createSearchIndex('me', storage);
    // Recipients recorded as received mail's -- which is also the shape of
    // every entry from before the mark existed. Read again, once.
    index.add(entry({ to: [{ name: 'Sam', email: 'sam@x.co' }], messageId: '<c@x.co>', references: [] }));
    expect(index.hydrate({ name: 'a--x' }, { needsRecipients: true })).toBe(false);
    index.add(entry({ to: [{ name: 'Sam', email: 'sam@x.co' }], messageId: '<c@x.co>', references: [] }),
      { outgoing: true });
    const listed = { name: 'a--x' };
    expect(index.hydrate(listed, { needsRecipients: true })).toBe(true);
    expect(listed.to).toEqual([{ name: 'Sam', email: 'sam@x.co' }]);
    // The mark is what the address book reads as "written to".
    expect(index.addresses().filter((address) => address.written).map((address) => address.email))
      .toEqual(['sam@x.co']);
  });

  it('reports a storage that refused the write, and stays usable', () => {
    const full = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    const index = createSearchIndex('me', full);
    index.add(entry());
    expect(index.flush()).toBe(false);
    expect(index.hydrate({ name: 'a--x' })).toBe(true);
  });

  it('ignores stored junk rather than throwing', () => {
    const storage = memoryStorage();
    storage.setItem('puter-mail:index:me', '["not","an","object"]');
    expect(createSearchIndex('me', storage).size).toBe(0);
    storage.setItem('puter-mail:index:me', 'not json');
    expect(createSearchIndex('me', storage).size).toBe(0);
  });
});

describe('to: and the date prefixes', () => {
  const entry = (extra = {}) => ({
    name: 'x', subject: 'Invoice', day: '2026-08-14',
    from: { name: 'Ana', email: 'ana@example.com' },
    to: [{ name: 'Leo Park', email: 'leo@example.com' }],
    snippet: 'attached', ...extra,
  });

  it('reads to: as a field of its own', () => {
    const query = parseQuery('to:leo');
    expect(query.terms).toEqual([{ field: 'to', value: 'leo' }]);
    expect(needsIndex(query)).toBe(true);
    expect(matchesQuery(query, entry())).toBe(true);
    expect(matchesQuery(parseQuery('to:ana'), entry())).toBe(false);
    // Recipients match by name too.
    expect(matchesQuery(parseQuery('to:park'), entry())).toBe(true);
  });

  it('reads before: and after: as days, in either form', () => {
    expect(parseQuery('after:2026-08-01').terms).toEqual([{ field: 'after', value: '2026-08-01' }]);
    expect(parseQuery('before:2026/9/1').terms).toEqual([{ field: 'before', value: '2026-09-01' }]);
  });

  it('searches a date it cannot read as text, like any unknown prefix', () => {
    expect(parseQuery('before:yesterday').terms).toEqual([{ field: 'any', value: 'before:yesterday' }]);
    expect(parseQuery('after:2026-13-40').terms).toEqual([{ field: 'any', value: 'after:2026-13-40' }]);
  });

  it.each(['2026-02-30', '2026/2/29', '2026-04-31', '1900-02-29', '9999-02-30'])(
    'does not turn the nonexistent day %s into a date filter', (day) => {
      const raw = `before:${day}`;
      expect(parseQuery(raw).terms).toEqual([{ field: 'any', value: raw }]);
      expect(match(raw, entry())).toBe(false);
      expect(match(raw, entry({ subject: `Typo: ${raw}` }))).toBe(true);
    },
  );

  it.each(['2024-02-29', '2000-02-29', '2026-02-28', '2026-04-30'])(
    'keeps the valid day %s as a date filter', (day) => {
      expect(parseQuery(`after:${day}`).terms).toEqual([{ field: 'after', value: day }]);
    },
  );

  it('answers a date term from the day folder, with no read', () => {
    const query = parseQuery('after:2026-08-01 before:2026-09-01');
    expect(needsIndex(query)).toBe(false);
    expect(matchesQuery(query, { name: 'x', subject: 'Invoice', day: '2026-08-14' })).toBe(true);
    expect(matchesQuery(query, { name: 'x', subject: 'Invoice', day: '2026-09-01' })).toBe(false);
    expect(matchesQuery(query, { name: 'x', subject: 'Invoice', day: '2026-07-31' })).toBe(false);
  });

  it('includes the day named in after: and excludes it in before:', () => {
    const on = { name: 'x', subject: 's', day: '2026-08-14' };
    expect(matchesQuery(parseQuery('after:2026-08-14'), on)).toBe(true);
    expect(matchesQuery(parseQuery('before:2026-08-14'), on)).toBe(false);
    expect(matchesQuery(parseQuery('before:2026-08-15'), on)).toBe(true);
  });

  it('prefers the header date once it has been read', () => {
    // Filed under the 15th in UTC, written late on the 14th locally.
    const late = { name: 'x', subject: 's', day: '2026-08-15', date: new Date(2026, 7, 14, 23, 30) };
    expect(matchesQuery(parseQuery('before:2026-08-15'), late)).toBe(true);
  });

  it('does not match before: on a message with no day at all', () => {
    expect(matchesQuery(parseQuery('before:2026-08-15'), { name: 'x', subject: 's' })).toBe(false);
  });

  it('combines a date with the other terms', () => {
    expect(matchesQuery(parseQuery('from:ana after:2026-08-01'), entry())).toBe(true);
    expect(matchesQuery(parseQuery('from:ana after:2026-08-20'), entry())).toBe(false);
  });
});

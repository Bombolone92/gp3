import { describe, it, expect } from 'vitest';
import { mergeContacts, rankContacts } from '../src/lib/contacts.js';
import { createSearchIndex } from '../src/lib/search.js';
import { memoryStorage } from '../src/lib/readstate.js';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox, SAMPLE_ADDRESS } from '../src/lib/sample.js';

/**
 * The address book is the header index asked a second question, so both ends
 * are covered here: what the index hands over, and what the ranking makes of
 * it. The dropdown itself is covered in composedialog.test.js.
 */

const seen = (over = {}) => ({
  name: 'Ana Petrova', email: 'ana@meridianlabs.example', seconds: 1000, written: false, ...over,
});

const emails = (contacts) => contacts.map((contact) => contact.email);

describe('mergeContacts', () => {
  it('gives one entry per address, whatever case it arrived in', () => {
    const book = mergeContacts([
      seen(),
      seen({ email: 'ANA@Meridianlabs.Example', seconds: 2000 }),
    ]);
    expect(emails(book)).toEqual(['ana@meridianlabs.example']);
    expect(book[0].count).toBe(2);
    expect(book[0].seconds).toBe(2000);
  });

  it('drops anything that is not an address', () => {
    expect(mergeContacts([
      seen({ email: 'undisclosed-recipients' }),
      seen({ email: '' }),
      seen({ email: null }),
      seen(),
    ])).toHaveLength(1);
  });

  it('keeps the name from the most recent appearance that had one', () => {
    const book = mergeContacts([
      seen({ name: 'Ana Petrova', seconds: 1000 }),
      // Bare address, and more recent: it must not erase the name.
      seen({ name: '', seconds: 3000 }),
      seen({ name: 'A. Petrova', seconds: 2000 }),
    ]);
    expect(book[0].name).toBe('A. Petrova');
    expect(book[0].seconds).toBe(3000);
  });

  it('does not take the address itself as a name', () => {
    const book = mergeContacts([seen({ name: 'ana@meridianlabs.example' })]);
    expect(book[0].name).toBe('');
  });

  it('marks anyone who has been written to, from any one appearance', () => {
    const book = mergeContacts([seen(), seen({ written: true }), seen()]);
    expect(book[0].written).toBe(true);
  });

  it('puts someone written to ahead of someone who has only written', () => {
    // The newsletter has sent fifty messages and is still not who was meant.
    const book = mergeContacts([
      ...Array.from({ length: 50 }, (_, i) =>
        seen({ name: 'The Weekly', email: 'news@weekly.example', seconds: 9000 + i })),
      seen({ email: 'sam@example.com', seconds: 10, written: true }),
    ]);
    expect(emails(book)).toEqual(['sam@example.com', 'news@weekly.example']);
  });

  it('ranks by how often, then how recently, within one kind', () => {
    const book = mergeContacts([
      seen({ email: 'once@example.com', seconds: 5000 }),
      seen({ email: 'twice@example.com', seconds: 100 }),
      seen({ email: 'twice@example.com', seconds: 200 }),
    ]);
    expect(emails(book)).toEqual(['twice@example.com', 'once@example.com']);
  });

  it('is a total order, so the same book twice is the same list', () => {
    const addresses = [
      seen({ email: 'b@example.com', seconds: 1 }),
      seen({ email: 'a@example.com', seconds: 1 }),
    ];
    expect(emails(mergeContacts(addresses)))
      .toEqual(emails(mergeContacts([...addresses].reverse())));
  });

  it('answers an empty history with an empty book', () => {
    expect(mergeContacts()).toEqual([]);
    expect(mergeContacts([])).toEqual([]);
  });
});

describe('rankContacts', () => {
  const book = mergeContacts([
    seen({ name: 'Ana Petrova', email: 'ana@meridianlabs.example', written: true }),
    seen({ name: 'Ravi Anand', email: 'ravi@northwind.example', written: true }),
    seen({ name: 'Sam Okafor', email: 'sam@meridianlabs.example', seconds: 500 }),
    seen({ name: 'Joanna Hale', email: 'jo@example.org', seconds: 400 }),
  ]);

  it('matches a name, an address, or a domain', () => {
    expect(emails(rankContacts(book, 'petrova'))).toEqual(['ana@meridianlabs.example']);
    expect(emails(rankContacts(book, 'jo@'))).toEqual(['jo@example.org']);
    expect(emails(rankContacts(book, 'meridian')))
      .toEqual(['ana@meridianlabs.example', 'sam@meridianlabs.example']);
  });

  it('puts a prefix ahead of a match in the middle', () => {
    // "an" starts Ana and Anand; it merely sits inside Joanna, and inside
    // "meridianlabs" -- so the two people it names come first.
    const found = emails(rankContacts(book, 'an'));
    expect(found.slice(0, 2).sort())
      .toEqual(['ana@meridianlabs.example', 'ravi@northwind.example']);
    expect(found.slice(2).sort()).toEqual(['jo@example.org', 'sam@meridianlabs.example']);
  });

  it('matches any word of a name, not only the first', () => {
    expect(emails(rankContacts(book, 'okafor'))).toEqual(['sam@meridianlabs.example']);
  });

  it('ignores case and surrounding space', () => {
    expect(emails(rankContacts(book, '  PETROVA '))).toEqual(['ana@meridianlabs.example']);
  });

  it('leaves out the addresses the field already holds', () => {
    expect(emails(rankContacts(book, 'meridian', { exclude: ['ANA@meridianlabs.example'] })))
      .toEqual(['sam@meridianlabs.example']);
  });

  it('offers the whole book, in rank order, for an empty query', () => {
    expect(emails(rankContacts(book, ''))).toEqual(emails(book));
  });

  it('offers nothing that matches nothing', () => {
    expect(rankContacts(book, 'zzz')).toEqual([]);
  });

  it('stops at the limit', () => {
    expect(rankContacts(book, '', { limit: 2 })).toHaveLength(2);
  });
});

describe('the index as an address book', () => {
  const index = () => createSearchIndex('who', memoryStorage());

  it('yields the sender of every message it has read', () => {
    const store = index();
    store.add({
      name: 'a--x',
      from: { name: 'Ana Petrova', email: 'ana@meridianlabs.example' },
      date: new Date(2_000_000 * 1000),
    });
    expect(store.addresses()).toEqual([
      { name: 'Ana Petrova', email: 'ana@meridianlabs.example', seconds: 2_000_000, written: false },
    ]);
  });

  it('yields the recipients of a sent message as addresses that have been written to', () => {
    const store = index();
    store.add({
      name: 'b--y',
      from: { name: 'Me', email: 'me@puter.email' },
      to: [{ name: 'Sam Okafor', email: 'sam@example.com' }, { name: '', email: 'ravi@example.com' }],
      date: new Date(3_000_000 * 1000),
      messageId: '<b@puter.email>',
      references: [],
    }, { outgoing: true });
    expect(store.addresses()).toEqual([
      { name: 'Me', email: 'me@puter.email', seconds: 3_000_000, written: false },
      { name: 'Sam Okafor', email: 'sam@example.com', seconds: 3_000_000, written: true },
      { name: '', email: 'ravi@example.com', seconds: 3_000_000, written: true },
    ]);
  });

  it('does not take the To line of received mail for people written to', () => {
    // The reader's own address is on every message they receive, and so is
    // whoever else was copied. They are known addresses, not chosen ones.
    const store = index();
    store.add({
      name: 'c--z',
      from: { name: 'Leo Tanaka', email: 'leo@puter.com' },
      to: [{ name: '', email: 'me@puter.email' }, { name: 'Sam Okafor', email: 'sam@example.com' }],
      date: new Date(4_000_000 * 1000),
      messageId: '<c@puter.com>',
      references: [],
    });
    expect(store.addresses()).toEqual([
      { name: 'Leo Tanaka', email: 'leo@puter.com', seconds: 4_000_000, written: false },
      { name: '', email: 'me@puter.email', seconds: 4_000_000, written: false },
      { name: 'Sam Okafor', email: 'sam@example.com', seconds: 4_000_000, written: false },
    ]);
  });

  it('reads recipients recorded before the sent mark existed as received mail\'s', () => {
    const storage = memoryStorage();
    storage.setItem('puter-mail:index:who', JSON.stringify({
      'e--v': ['Me', 'me@puter.email', 'hi', 0, 1234, [['Sam', 'sam@example.com']], '<e@x.co>', []],
    }));
    expect(createSearchIndex('who', storage).addresses()).toEqual([
      { name: 'Me', email: 'me@puter.email', seconds: 1234, written: false },
      { name: 'Sam', email: 'sam@example.com', seconds: 1234, written: false },
    ]);
  });

  it('says nothing about a message whose header was never read', () => {
    expect(index().addresses()).toEqual([]);
  });

  it('survives an entry from an older shape of the cache', () => {
    const storage = memoryStorage();
    // Sender and snippet only: what the index held before it kept recipients.
    storage.setItem('puter-mail:index:who', JSON.stringify({
      'c--z': ['Ana', 'ana@example.com', 'hello', 0, 1234],
      'd--w': 'not an entry at all',
    }));
    expect(createSearchIndex('who', storage).addresses()).toEqual([
      { name: 'Ana', email: 'ana@example.com', seconds: 1234, written: false },
    ]);
  });
});

describe('the address book behind the shell', () => {
  const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  it('offers who the inbox has heard from, and none of them as written to', async () => {
    const root = document.createElement('div');
    root.id = 'app';
    document.body.append(root);
    try {
      const { fs, mailPath, objectsPath } = createSampleMailbox();
      let hooks = null;
      renderApp(root, {
        fs, mailPath, objectsPath, sample: true, account: { username: 'sample' },
        onCompose: (prefill, given) => { hooks = given; },
      });
      await settle(250);
      root.querySelector('.side-compose').click();
      // The rows' header reads land on their own schedule.
      let book = [];
      for (let i = 0; i < 40 && book.length < 10; i++) {
        await settle(100);
        book = mergeContacts(hooks.contacts());
      }
      expect(book.length).toBeGreaterThan(5);
      // Nothing has been sent, so nobody has been written to -- least of all
      // the reader, whose own address is on every message in the inbox.
      expect(book.filter((contact) => contact.written)).toEqual([]);
      // Known, and offered -- a note to oneself is a message too -- but not
      // as someone written to.
      expect(book.find((contact) => contact.email === SAMPLE_ADDRESS)).toMatchObject({ written: false });
    } finally {
      root.remove();
      document.querySelectorAll('.modal-root, .toast').forEach((node) => node.remove());
    }
  });
});

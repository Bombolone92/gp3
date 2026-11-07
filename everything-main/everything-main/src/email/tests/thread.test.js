import { describe, it, expect } from 'vitest';
import {
  stripPrefixes, normalizeSubject, isReply, parseMessageId, parseReferences,
  keyReferences, makeThread, singleThread, groupThreads, splitQuotedTail,
} from '../src/lib/thread.js';

/**
 * Grouping a folder into conversations. Everything here is a pure function
 * over listed messages, which is the point: the cases that decide whether two
 * messages belong together are awkward, and none of them needs a DOM.
 */

const headers = (map) => new Map(Object.entries(map));

// A listed message, as the mailbox and the header read leave it.
let seq = 0;
const message = ({ subject = '', id = '', refs = [], day = '2026-08-20' } = {}) => {
  seq++;
  return {
    subject,
    messageId: id,
    references: refs,
    day,
    // Filenames sort chronologically, so a later call is a later message.
    name: `${String(seq).padStart(4, '0')}--x`,
  };
};

// Newest first, the order a mailbox lists in.
const listing = (...built) => [...built].reverse();

const subjects = (threads) => threads.map((thread) => thread.subject);

describe('subject prefixes', () => {
  it('strips a reply or forward prefix, and says it did', () => {
    expect(stripPrefixes('Re: Lunch')).toEqual({ text: 'Lunch', replied: true });
    expect(stripPrefixes('Fwd: Lunch')).toEqual({ text: 'Lunch', replied: true });
    expect(stripPrefixes('Lunch')).toEqual({ text: 'Lunch', replied: false });
  });

  it('strips as many as a client piled on', () => {
    expect(normalizeSubject('Re: Fwd: RE: Re: Q3 numbers')).toBe('q3 numbers');
    expect(normalizeSubject('Re[2]: Q3 numbers')).toBe('q3 numbers');
    expect(normalizeSubject('RE(3): Q3 numbers')).toBe('q3 numbers');
  });

  it('strips the ones other languages localise to', () => {
    for (const prefix of ['AW', 'WG', 'SV', 'VS', 'TR', 'Odp', 'Res', 'Enc', 'Rif', 'YNT']) {
      expect(normalizeSubject(`${prefix}: Lunch`)).toBe('lunch');
      expect(isReply(`${prefix}: Lunch`)).toBe(true);
    }
  });

  it('keeps a mailing list tag, whichever side of the prefix it is on', () => {
    // Mailman rewrites the subject and the replying client does not agree with
    // it about the order. Both are the same conversation.
    expect(normalizeSubject('Re: [dev] patch series')).toBe('[dev] patch series');
    expect(normalizeSubject('[dev] Re: patch series')).toBe('[dev] patch series');
    // And the tag is kept, so two lists discussing the same thing stay apart.
    expect(normalizeSubject('[ops] Re: patch series')).not
      .toBe(normalizeSubject('[dev] Re: patch series'));
  });

  it('collapses the whitespace a folded header leaves behind', () => {
    expect(normalizeSubject('Print files,   final  versions'))
      .toBe('print files, final versions');
  });

  it('leaves a subject that only looks like a prefix alone', () => {
    expect(normalizeSubject('Rebuilding the index')).toBe('rebuilding the index');
    expect(isReply('Rebuilding the index')).toBe(false);
  });

  it('takes the counted form however it is spaced', () => {
    for (const subject of ['Re[2]: x', 'Re (3) : x', 'Re  [2]  :  x', 'Re\t:\tx', 'Re :x']) {
      expect(stripPrefixes(subject)).toEqual({ text: 'x', replied: true });
    }
  });

  /**
   * Every message in a folder is read through here to be grouped, and the
   * subject is written by whoever sent it. A run of whitespace after
   * something that looks like a prefix used to be divided between the two
   * sides of the counted form in every possible way before the subject was
   * admitted not to be one: sixty thousand spaces was five seconds, per
   * message, on listing the folder.
   */
  it('reads a subject padded with whitespace in one pass', () => {
    const began = Date.now();
    const padded = `Re${' '.repeat(60_000)}x`;
    expect(stripPrefixes(padded)).toEqual({ text: padded.trim(), replied: false });
    expect(Date.now() - began).toBeLessThan(2000);
  });
});

describe('reading the threading headers', () => {
  it('takes the ids in angle brackets and nothing else', () => {
    expect(parseMessageId(headers({ 'message-id': ' <a@x.co> ' }))).toBe('<a@x.co>');
    expect(parseMessageId(headers({ 'message-id': 'not an id' }))).toBe('');
    expect(parseMessageId(headers({}))).toBe('');
  });

  it('joins References and In-Reply-To, in order and without repeats', () => {
    expect(parseReferences(headers({
      references: '<a@x.co> <b@x.co>',
      'in-reply-to': '<b@x.co>',
    }))).toEqual(['<a@x.co>', '<b@x.co>']);
  });

  it('reads In-Reply-To on its own, which is sometimes all there is', () => {
    expect(parseReferences(headers({ 'in-reply-to': '<b@x.co>' }))).toEqual(['<b@x.co>']);
    expect(parseReferences(headers({}))).toEqual([]);
  });

  it('caches the root and the parent, which is what does the linking', () => {
    const chain = ['<a@x.co>', '<b@x.co>', '<c@x.co>', '<d@x.co>'];
    expect(keyReferences(chain)).toEqual(['<a@x.co>', '<d@x.co>']);
    expect(keyReferences(['<a@x.co>'])).toEqual(['<a@x.co>']);
    expect(keyReferences([])).toEqual([]);
  });
});

describe('a conversation', () => {
  it('reads oldest to newest, whatever order it was given in', () => {
    const first = message({ subject: 'Lunch' });
    const second = message({ subject: 'Re: Lunch' });
    const thread = makeThread([second, first]);
    expect(thread.messages).toEqual([first, second]);
    expect(thread.oldest).toBe(first);
    expect(thread.latest).toBe(second);
    expect(thread.count).toBe(2);
  });

  it('is named by its first message, and identified by it', () => {
    const first = message({ subject: 'Lunch' });
    const second = message({ subject: 'Re: Lunch' });
    const thread = makeThread([first, second]);
    // The subject as the conversation started, not the stripped form: for a
    // conversation of one the row has to say what the message says.
    expect(thread.subject).toBe('Lunch');
    expect(thread.id).toBe(first.name);
    expect(thread.key).toBe('lunch');
  });

  it('of one is still a conversation', () => {
    const only = message({ subject: 'Receipt' });
    expect(singleThread(only)).toMatchObject({
      count: 1, subject: 'Receipt', oldest: only, latest: only,
    });
  });
});

describe('grouping by references', () => {
  it('joins a reply to the message it answers', () => {
    const root = message({ subject: 'Lunch', id: '<1@x.co>' });
    const reply = message({ subject: 'Re: Lunch', id: '<2@x.co>', refs: ['<1@x.co>'] });
    const threads = groupThreads(listing(root, reply));
    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toEqual([root, reply]);
  });

  it('joins a whole chain, however long', () => {
    const a = message({ subject: 'Plan', id: '<1@x.co>' });
    const b = message({ subject: 'Re: Plan', id: '<2@x.co>', refs: ['<1@x.co>'] });
    const c = message({ subject: 'Re: Plan', id: '<3@x.co>', refs: ['<1@x.co>', '<2@x.co>'] });
    expect(groupThreads(listing(a, b, c))).toHaveLength(1);
  });

  it('starts a new conversation where the subject changed', () => {
    // Renaming a thread is how people split one, and Gmail treats it that way.
    const root = message({ subject: 'Lunch', id: '<1@x.co>' });
    const split = message({ subject: 'Dinner instead', id: '<2@x.co>', refs: ['<1@x.co>'] });
    expect(subjects(groupThreads(listing(root, split))))
      .toEqual(['Dinner instead', 'Lunch']);
  });

  it('joins two replies to a message this folder does not hold', () => {
    // The original went to someone else, or is in another folder. The two
    // answers still answer the same thing.
    const one = message({ subject: 'Re: Offsite', id: '<2@x.co>', refs: ['<1@x.co>'] });
    const two = message({ subject: 'Re: Offsite', id: '<3@x.co>', refs: ['<1@x.co>'] });
    const threads = groupThreads(listing(one, two));
    expect(threads).toHaveLength(1);
    expect(threads[0].count).toBe(2);
  });

  it('does not join two subjects that share a reference', () => {
    const one = message({ subject: 'Re: Offsite', id: '<2@x.co>', refs: ['<1@x.co>'] });
    const two = message({ subject: 'Re: Budget', id: '<3@x.co>', refs: ['<1@x.co>'] });
    expect(groupThreads(listing(one, two))).toHaveLength(2);
  });
});

describe('grouping by subject, where the headers gave nothing', () => {
  it('joins a reply whose client dropped References', () => {
    const root = message({ subject: 'Invoice 88' });
    const reply = message({ subject: 'Re: Invoice 88' });
    expect(groupThreads(listing(root, reply))).toHaveLength(1);
  });

  it('leaves two notices that merely share a subject apart', () => {
    // Neither is a reply to anything, so there is no conversation here -- and
    // collapsing them would hide one behind the other.
    const first = message({ subject: 'Invoice' });
    const second = message({ subject: 'Invoice' });
    const third = message({ subject: 'Invoice' });
    expect(groupThreads(listing(first, second, third))).toHaveLength(3);
  });

  it('leaves a reply that is already linked out of it', () => {
    // Two "Invoice" notices, and a reply to one of them by reference. The
    // reply joins its target; the other notice stays on its own.
    const one = message({ subject: 'Invoice', id: '<1@x.co>' });
    const two = message({ subject: 'Invoice', id: '<2@x.co>' });
    const reply = message({ subject: 'Re: Invoice', id: '<3@x.co>', refs: ['<1@x.co>'] });
    const threads = groupThreads(listing(one, two, reply));
    expect(threads).toHaveLength(2);
    expect(threads.map((thread) => thread.count).sort()).toEqual([1, 2]);
    expect(threads.find((thread) => thread.count === 2).messages).toEqual([one, reply]);
  });

  it('does not group by an empty subject', () => {
    // Two messages with no subject have nothing in common.
    expect(groupThreads(listing(message({}), message({}), message({})))).toHaveLength(3);
  });
});

describe('the order conversations come out in', () => {
  it('is newest conversation first, by its newest message', () => {
    const oldRoot = message({ subject: 'Old thread', id: '<1@x.co>' });
    const lone = message({ subject: 'Something else' });
    // A reply drags its conversation to the top, above mail that arrived
    // after the conversation started.
    const oldReply = message({ subject: 'Re: Old thread', id: '<2@x.co>', refs: ['<1@x.co>'] });
    expect(subjects(groupThreads(listing(oldRoot, lone, oldReply))))
      .toEqual(['Old thread', 'Something else']);
  });

  it('handles an empty listing', () => {
    expect(groupThreads([])).toEqual([]);
  });
});

describe('the quoted copy at the end of a reply', () => {
  it('splits off an attribution and the lines it introduces', () => {
    const { text, quoted } = splitQuotedTail([
      'Two works for me.',
      '',
      'On Tuesday, Ana Petrova wrote:',
      '> Could we meet Thursday?',
      '> Either day is fine.',
    ].join('\n'));
    expect(text).toBe('Two works for me.');
    expect(quoted.split('\n')[0]).toBe('On Tuesday, Ana Petrova wrote:');
    expect(quoted).toContain('> Either day is fine.');
  });

  it('takes a wrapped attribution back to the line it opens on', () => {
    // Gmail wraps the introduction at 76 columns: the date and the name on
    // one line, "wrote:" on the next. Apple Mail does the same in German,
    // with the address alone on the second line.
    for (const [first, second] of [
      ['On Tue, Sep 15, 2026 at 10:12 AM Ana Petrova <', 'ana@meridianlabs.example> wrote:'],
      ['On Tue, 15 Sept 2026 at 10:12, Ana Petrova <ana@meridianlabs.example>', 'wrote:'],
      ['Am 15.09.2026 um 10:12 schrieb Ana Petrova', '<ana@meridianlabs.example>:'],
    ]) {
      const { text, quoted } = splitQuotedTail([
        'Two works for me.',
        '',
        first,
        second,
        '> Could we meet Thursday?',
        '> Either day is fine.',
      ].join('\n'));
      expect(text).toBe('Two works for me.');
      expect(quoted.split('\n').slice(0, 2)).toEqual([first, second]);
    }
  });

  it('reads the introductions other clients localise', () => {
    for (const intro of [
      'Am Di., 15. Sept. 2026 um 10:12 Uhr schrieb Ana Petrova <ana@example.com>:',
      'Le mar. 15 sept. 2026 à 10:12, Ana Petrova <ana@example.com> a écrit :',
      'El mar., 15 sept. 2026 a las 10:12, Ana Petrova (<ana@example.com>) escribió:',
      'Em ter., 15 de set. de 2026 às 10:12, Ana Petrova <ana@example.com> escreveu:',
      'Op di 15 sep. 2026 om 10:12 schreef Ana Petrova <ana@example.com>:',
      'Den tis 15 sep. 2026 kl 10:12 skrev Ana Petrova <ana@example.com>:',
      'Il giorno mar 15 set 2026 alle ore 10:12 Ana Petrova <ana@example.com> ha scritto:',
    ]) {
      const { text, quoted } = splitQuotedTail(`Passt.\n\n${intro}\n> Donnerstag?\n> Oder Freitag.`);
      expect(text).toBe('Passt.');
      expect(quoted.split('\n')[0]).toBe(intro);
    }
  });

  it('does not take a line of the message for the introduction under it', () => {
    const { text, quoted } = splitQuotedTail([
      'Some context first.',
      'Here is what she wrote:',
      '> one',
      '> two',
    ].join('\n'));
    expect(text).toBe('Some context first.');
    expect(quoted.split('\n')[0]).toBe('Here is what she wrote:');
  });

  it('keeps a blank line that is inside the quote', () => {
    const { quoted } = splitQuotedTail('Yes.\n\n> one\n>\n> two');
    expect(quoted).toBe('> one\n>\n> two');
  });

  it('splits at the rule Outlook writes instead of quoting', () => {
    const { text, quoted } = splitQuotedTail([
      'Approved.',
      '',
      '-----Original Message-----',
      'From: Ana Petrova',
      'Please approve the order.',
    ].join('\n'));
    expect(text).toBe('Approved.');
    expect(quoted).toContain('From: Ana Petrova');
  });

  it('leaves a single quoted line alone', () => {
    // As likely to be a quotation the writer meant as a copy of anything.
    const raw = 'She said it best:\n\n> less is more';
    expect(splitQuotedTail(raw)).toEqual({ text: raw, quoted: '' });
  });

  it('leaves a message that is nothing but a quote whole', () => {
    // Folding it away would leave nothing at all on screen.
    const raw = '> one\n> two\n> three';
    expect(splitQuotedTail(raw)).toEqual({ text: raw, quoted: '' });
  });

  it('leaves a message with no quote in it alone', () => {
    expect(splitQuotedTail('Just a note.')).toEqual({ text: 'Just a note.', quoted: '' });
    expect(splitQuotedTail('')).toEqual({ text: '', quoted: '' });
  });
});

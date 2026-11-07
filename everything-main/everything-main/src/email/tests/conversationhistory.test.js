import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';
import { fileSentCopy } from '../src/lib/mailbox.js';
import { buildMessage } from '../src/lib/compose.js';

/**
 * The conversation the reader shows is more than the folder's row: it holds
 * the replies sent from here and the messages of it filed elsewhere. These
 * are the ways that history is found and kept up to date without costing the
 * reader its place.
 */

const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

const THREAD = 'Thursday walkthrough';

let root;
let mailbox;

const rows = () => [...root.querySelectorAll('.row')].filter((row) => !row.hidden);
const rowFor = (subject) => rows()
  .find((row) => row.querySelector('.row-subject').textContent === subject);
const cards = () => [...root.querySelectorAll('.msg-item')];
const openCards = () => cards().filter((card) => card.classList.contains('is-open'));
const back = async () => {
  root.querySelector('.icon-btn[aria-label="Back to list"]').click();
  await settle(60);
};

/** A reply of the reader's own, filed in Sent the way a send files it. */
const fileReply = async ({ cc = [] } = {}) => {
  // Quoting the message it answers, the way a reply written here does.
  const body = [
    'Thanks, that works for me.',
    '',
    'On Tuesday, Priya Raman wrote:',
    "> Two o'clock is perfect. I'll bring the printed sheets so we can mark",
    '> them up as we go.',
  ].join('\n');
  const raw = buildMessage({
    from: 'sample@puter.email',
    to: ['priya@northgate.example'],
    cc,
    subject: `Re: ${THREAD}`,
    body,
    date: new Date(),
    messageId: `<${Math.random().toString(36).slice(2)}@puter.email>`,
    inReplyTo: '<walkthrough-3@northgate.example>',
    references: [
      '<walkthrough-1@northgate.example>',
      '<walkthrough-2@northgate.example>',
      '<walkthrough-3@northgate.example>',
    ],
  });
  return fileSentCopy({
    fs: mailbox.fs, mailPath: mailbox.mailPath, raw, subject: `Re: ${THREAD}`, date: new Date(),
  });
};

const mount = async (extra = {}) => {
  renderApp(root, {
    ...mailbox, sample: true, account: { username: 'sample' }, onCompose: () => {}, ...extra,
  });
  await settle();
};

beforeEach(() => {
  mailbox = createSampleMailbox();
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  document.querySelectorAll('.toast, .menu, .modal-root').forEach((node) => node.remove());
});

describe('finding the rest of a conversation', () => {
  it('opens threads without a history warning before Sent or Archive exists', async () => {
    await mount();
    for (const subject of [THREAD, 'Welcome to your Puter mailbox']) {
      rowFor(subject).click();
      await vi.waitFor(() => {
        expect(cards().length).toBeGreaterThan(0);
        expect(root.querySelector('.msg-thread')?.getAttribute('aria-busy')).toBe('false');
        expect(root.querySelector('.history-status')).toBeNull();
      });
      await back();
    }
  });

  it('still reports a real history listing failure and recovers on retry', async () => {
    const readdir = mailbox.fs.readdir.bind(mailbox.fs);
    let failed = true;
    mailbox.fs.readdir = async (path) => {
      if (failed && path === `${mailbox.mailPath}/sent`) {
        throw { code: 'permission_denied', message: 'Access denied' };
      }
      return readdir(path);
    };
    await mount();
    rowFor(THREAD).click();
    await vi.waitFor(() => expect(root.querySelector('.history-status button')?.textContent).toBe('Retry history'));
    failed = false;
    root.querySelector('.history-status button').click();
    await vi.waitFor(() => {
      expect(root.querySelector('.msg-thread')?.getAttribute('aria-busy')).toBe('false');
      expect(root.querySelector('.history-status')).toBeNull();
    });
    expect(cards()).toHaveLength(3);
  });

  it('lists each folder once rather than on every open', async () => {
    // Sent and Archive both exist, with something in them: a folder that is
    // not there yet cannot be remembered as listed, since the first thing
    // filed into it makes it.
    await fileReply();
    const day = (await mailbox.fs.readdir(mailbox.objectsPath))
      .filter((item) => item.is_dir).map((item) => item.name).sort()[0];
    await mailbox.fs.write(`${mailbox.mailPath}/archive/${day}/00000000-0000-7000-8000-000000000000--${btoa('Old notice')}`,
      new Blob(['From: a@example.com\r\nSubject: Old notice\r\n\r\nKept.']));
    const listed = [];
    const readdir = mailbox.fs.readdir.bind(mailbox.fs);
    mailbox.fs.readdir = async (path) => {
      listed.push(path);
      return readdir(path);
    };
    await mount();

    listed.length = 0;
    rowFor('Welcome to your Puter mailbox').click();
    await settle(400);
    // The first open lists the inbox, Sent and Archive to look for the rest of
    // the conversation: the folder itself plus one readdir per day folder.
    const first = listed.length;
    expect(first).toBeGreaterThan(0);

    // The next open answers from what was listed. Listing afresh each time
    // cost a readdir per day folder of three folders behind every click.
    listed.length = 0;
    await back();
    rowFor('Your receipt from Nimbus Coffee').click();
    await settle(400);
    expect(listed).toEqual([]);
  });

  it('looks at Sent again once a reply has been filed there', async () => {
    let hooks;
    await mount({ onCompose: (prefill, options) => { hooks = options; } });
    rowFor(THREAD).click();
    await vi.waitFor(() => expect(root.querySelector('.msg-reply .btn')).toBeTruthy());
    expect(cards()).toHaveLength(3);
    root.querySelector('.msg-reply .btn').click();

    // A reply sent from another open of the composer lands in Sent; the shell
    // is told the way a send tells it.
    const path = await fileReply();
    await hooks.onFiled(path);
    await vi.waitFor(() => expect(cards()).toHaveLength(4));

    // And a conversation opened afterwards finds it, although Sent had been
    // listed before it was written.
    await back();
    rowFor(THREAD).click();
    await vi.waitFor(() => expect(cards()).toHaveLength(4));
  });
});

describe('the rest of the conversation arriving under the reader', () => {
  /** Mount with the listing of Sent held back, so the reader paints first. */
  const mountWithSlowSent = async (delay = 400) => {
    await fileReply();
    const readdir = mailbox.fs.readdir.bind(mailbox.fs);
    let slow = false;
    mailbox.fs.readdir = async (path) => {
      if (slow && path === `${mailbox.mailPath}/sent`) await settle(delay);
      return readdir(path);
    };
    await mount();
    slow = true;
  };

  it('leaves what is on screen exactly as it was', async () => {
    await mountWithSlowSent();
    const reads = [];
    const read = mailbox.fs.read.bind(mailbox.fs);
    mailbox.fs.read = async (path, options) => {
      if (!options?.byte_count) reads.push(path);
      return read(path, options);
    };

    rowFor(THREAD).click();
    await settle(200);
    // The folder's three messages, all open, all read once.
    const before = cards();
    expect(before).toHaveLength(3);
    expect(root.querySelector('.history-status')).toBeNull();
    expect(root.textContent).not.toContain('Loading conversation history');
    expect(root.querySelector('.msg-thread').getAttribute('aria-busy')).toBe('true');
    expect(openCards()).toHaveLength(3);
    expect(reads).toHaveLength(0); // complete short header reads already hold all bytes
    const heading = root.querySelector('.msg-subject');
    expect(document.activeElement).toBe(heading);

    // The reader gets to work: folds the first message to a line, and unfolds
    // the quote the second one carries -- which puts the keyboard on the fold.
    before[0].querySelector('.msg-item-open').click();
    const fold = before[1].querySelector('.msg-quoted');
    fold.click();
    await settle(30);
    expect(before[0].classList.contains('is-open')).toBe(false);
    expect(before[1].querySelector('.msg-quote')).not.toBeNull();
    expect(document.activeElement).toBe(fold);

    // The reply sent from here arrives from Sent and goes under the rest.
    await settle(600);
    const after = cards();
    expect(after).toHaveLength(4);
    expect(root.querySelector('.msg-thread').getAttribute('aria-busy')).toBe('false');
    expect(after.slice(0, 3)).toEqual(before);
    expect(after[3].classList.contains('is-open')).toBe(true);
    expect(after[3].querySelector('.msg-body').textContent).toContain('Thanks, that works for me.');
    // Nothing that was on screen was drawn again: the first message is still
    // a line, the quote is still out, the keyboard is still on the fold, and
    // no file was read a second time. Redrawing the stack dropped the
    // keyboard on <body>, folded the quote back, and read every open message
    // again.
    expect(before[0].classList.contains('is-open')).toBe(false);
    expect(before[1].querySelector('.msg-quote')).not.toBeNull();
    expect(document.activeElement).toBe(fold);
    expect(reads).toHaveLength(0);
    // The heading is the same one, now counting four.
    expect(root.querySelector('.msg-subject')).toBe(heading);
    expect(heading.getAttribute('aria-label')).toBe(`${THREAD}, 4 messages`);
    expect(heading.querySelector('.msg-count').textContent).toBe('4');
    // Reply, Reply all and Forward now answer the newest message.
    expect([...root.querySelectorAll('.msg-reply .btn')].map((button) => button.textContent))
      .toEqual(['Reply', 'Forward']);
  });

  it('gives a message that was on its own the folds of one among several', async () => {
    await mountWithSlowSent();
    [...root.querySelectorAll('.nav-item')].find((item) => item.textContent.includes('Sent')).click();
    await settle(600);
    rowFor(`Re: ${THREAD}`).click();
    await settle(200);

    // In Sent the reply is a conversation of one: the message view this app
    // has always had, with nothing to fold -- the quote it carries is all
    // there is of what it answers.
    const [only] = cards();
    expect(cards()).toHaveLength(1);
    expect(only.querySelector('.msg-expander')).toBeNull();
    expect(only.querySelector('.msg-quoted')).toBeNull();
    expect(only.querySelector('.msg-body').textContent).toContain("> Two o'clock is perfect");

    // The messages it answers arrive from the inbox, and it is one of four:
    // its head folds it to a line, and the copy of the message now above it
    // is folded away.
    await settle(600);
    expect(cards()).toHaveLength(4);
    expect(cards()[3]).toBe(only);
    expect(only.classList.contains('is-open')).toBe(true);
    const toggle = only.querySelector('.msg-expander');
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(only.querySelector('.msg-quoted')).not.toBeNull();
    expect(only.querySelector('.msg-body').textContent).not.toContain("> Two o'clock is perfect");
    expect(only.querySelector('.msg-body').textContent).toContain('Thanks, that works for me.');
  });
});

/**
 * A conversation whose first message is on a page not yet loaded. The reader
 * finds it through the folder's catalog and shows it; what it does about the
 * message being unread has to agree with the row the page will later join.
 */
describe('the start of a conversation on an older page', () => {
  const OBJECTS = '/user/.mail/objects';
  const DAYS = ['2026-08-03', '2026-08-02', '2026-08-01'];
  const ROOT_ID = '<survey-1@example.com>';

  const raw = (subject, extra = []) => [
    'From: Dana Ruiz <dana@example.com>',
    'To: you@puter.email',
    `Subject: ${subject}`,
    'Date: Mon, 17 Aug 2026 10:30:00 GMT',
    ...extra,
    'Content-Type: text/plain; charset=utf-8',
    '',
    `Body of ${subject}.`,
  ].join('\r\n');

  const named = (day, i, subject) => {
    const name = `${day}-${String(i).padStart(2, '0')}--${btoa(subject).replace(/=+$/, '')}`;
    return { name, path: `${OBJECTS}/${day}/${name}`, is_dir: false, size: 300, modified: 0 };
  };
  const subjectOf = (path) => {
    const encoded = path.slice(path.indexOf('--') + 2);
    return atob(encoded + '='.repeat((4 - encoded.length % 4) % 4));
  };

  // Thirty files per day, so the first page of sixty stops short of the
  // oldest day -- the one holding the start of the conversation.
  const fs = {
    async readdir(path) {
      if (path === OBJECTS) {
        return DAYS.map((day) => ({ name: day, path: `${OBJECTS}/${day}`, is_dir: true }));
      }
      if (!path.startsWith(`${OBJECTS}/`)) throw new Error(`No such directory: ${path}`);
      const day = path.split('/').pop();
      return Array.from({ length: 30 }, (unused, i) => {
        if (day === DAYS[0] && i === 0) return named(day, i, 'Re: Roof survey');
        if (day === DAYS[2] && i === 0) return named(day, i, 'Roof survey');
        return named(day, i, `${day} number ${String(i).padStart(2, '0')}`);
      });
    },
    async read(path) {
      const subject = subjectOf(path);
      if (subject === 'Re: Roof survey') {
        return new Blob([raw(subject, [
          'Message-ID: <survey-2@example.com>', `In-Reply-To: ${ROOT_ID}`, `References: ${ROOT_ID}`,
        ])]);
      }
      if (subject === 'Roof survey') return new Blob([raw(subject, [`Message-ID: ${ROOT_ID}`])]);
      return new Blob([raw(subject)]);
    },
  };

  it('is shown, opened, and read along with the rest', async () => {
    window.localStorage.clear();
    renderApp(root, {
      fs, mailPath: '/user/.mail', objectsPath: OBJECTS,
      sample: true, account: { username: 'user' }, onCompose: () => {},
    });
    await settle(700);
    rowFor('Re: Roof survey').click();
    await settle(800);

    // The reply's row stands alone in the list, but the reader found what it
    // answers and shows both -- and both are unread, so both are opened.
    expect(cards()).toHaveLength(2);
    expect(openCards()).toHaveLength(2);
    await back();

    // The page that holds the start of the conversation joins the row that
    // was already there. Everything in it has been read, so the row says so:
    // it used to go back to bold here, over a message the reader had shown.
    root.querySelector('.btn-more').click();
    await settle(900);
    const row = rowFor('Roof survey');
    expect(row.querySelector('.row-count').textContent).toBe('2');
    expect(row.classList.contains('unread')).toBe(false);
    window.localStorage.clear();
  });
});

describe('a reply landing while its conversation is open', () => {
  const REPLY = [
    'From: Tom Beckett <tom@northgate.example>',
    'To: sample@puter.com',
    'Subject: Re: Thursday walkthrough',
    'Date: Mon, 24 Aug 2026 08:15:00 GMT',
    'Message-ID: <walkthrough-4@northgate.example>',
    'In-Reply-To: <walkthrough-3@northgate.example>',
    'References: <walkthrough-1@northgate.example> <walkthrough-3@northgate.example>',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Booked the small room. See you Thursday.',
  ].join('\r\n');

  it('goes under what is being read, opened and read', async () => {
    window.localStorage.clear();
    // A real account rather than the sample inbox, which never checks for
    // new mail.
    renderApp(root, { ...mailbox, sample: false, account: { username: 'tester' } });
    await settle();
    rowFor(THREAD).click();
    await settle(400);
    const before = cards();
    expect(before).toHaveLength(3);
    const heading = root.querySelector('.msg-subject');

    const days = (await mailbox.fs.readdir(mailbox.objectsPath))
      .filter((item) => item.is_dir).map((item) => item.name).sort();
    const name = `ffffffff-ffff-7fff-8fff-ffffffffffff--${btoa('Re: Thursday walkthrough').replace(/=+$/, '')}`;
    await mailbox.fs.write(`${mailbox.objectsPath}/${days[days.length - 1]}/${name}`, new Blob([REPLY]));
    document.dispatchEvent(new Event('visibilitychange'));
    await settle(800);

    // The row took it in, as it did before -- and so did the reader, which
    // used to go on showing three until it was closed and opened again.
    const row = rowFor(THREAD);
    expect(row.querySelector('.row-count').textContent).toBe('4');
    const after = cards();
    expect(after).toHaveLength(4);
    expect(after.slice(0, 3)).toEqual(before);
    expect(after[3].classList.contains('is-open')).toBe(true);
    expect(after[3].querySelector('.msg-body').textContent).toContain('Booked the small room');
    expect(heading.querySelector('.msg-count').textContent).toBe('4');
    // It is on screen, so it has been read: the row does not go bold under
    // the reader.
    expect(row.classList.contains('unread')).toBe(false);
    window.localStorage.clear();
  });
});

describe('the reader\'s own message in the stack', () => {
  it('reads as "me", with the address beside it', async () => {
    await fileReply();
    await mount();
    rowFor(THREAD).click();
    await vi.waitFor(() => expect(cards()).toHaveLength(4));
    await vi.waitFor(() => expect(cards()[3].querySelector('.msg-body')).not.toBeNull());

    // The rows and the "to" lines already say "me" for an address the reader
    // owns; the sent card said "sample@puter.email", the one bare address in
    // a stack of names.
    const mine = cards()[3];
    expect(mine.querySelector('.msg-from-name').textContent).toBe('me');
    expect(mine.querySelector('.msg-from-email').textContent).toBe('<sample@puter.email>');
    // The disc is drawn from the address rather than from the word.
    expect(mine.querySelector('.avatar').textContent).toBe('S');
    expect(mine.querySelector('.msg-expander').getAttribute('aria-label'))
      .toMatch(/^Collapse the message from me, ./);
    // Everyone else is still named.
    expect(cards()[2].querySelector('.msg-from-name').textContent).toBe('Priya Raman');
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';

/**
 * The conversation view over the sample mailbox, which holds one real thread:
 * "Thursday walkthrough", three messages with the Message-ID and References
 * chain a client actually writes. Everything here is the shell doing its
 * normal job against it -- the grouping, the stacked reader, and the actions
 * applying to a whole conversation rather than to a row.
 */

const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

const THREAD = 'Thursday walkthrough';

let root;

const mount = async () => {
  const { fs, mailPath, objectsPath } = createSampleMailbox();
  renderApp(root, {
    fs, mailPath, objectsPath, sample: true, account: { username: 'sample' },
  });
  await settle();
};

const rows = () => [...root.querySelectorAll('.row')].filter((row) => !row.hidden);
const subjects = () => rows().map((row) => row.querySelector('.row-subject').textContent);
const rowFor = (subject) => rows()
  .find((row) => row.querySelector('.row-subject').textContent === subject);
const ticked = () => rows().filter((row) => row.querySelector('.row-check').checked);

/** Tick one row's own box, the way a click on it does. */
const tick = (row) => {
  const box = row.querySelector('.row-check');
  box.checked = !box.checked;
  box.dispatchEvent(new Event('change', { bubbles: true }));
};

const items = () => [...root.querySelectorAll('.msg-item')];
const openItems = () => items().filter((item) => item.classList.contains('is-open'));

const openFolder = async (label) => {
  [...root.querySelectorAll('.nav-item')]
    .find((item) => item.textContent.includes(label))
    .click();
  await settle();
};

const search = async (text) => {
  const input = root.querySelector('.search-input');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle(500);
};

const actOn = async (subject, label) => {
  [...rowFor(subject).querySelectorAll('.row-action')]
    .find((button) => (button.getAttribute('aria-label') || '').startsWith(label))
    .click();
  await settle(400);
};

const toolbarBtn = (label) => [...root.querySelectorAll('.msg-actions-bar .icon-btn')]
  .find((button) => button.getAttribute('aria-label') === label);

/** Flip "Conversation view" in the settings menu. */
const toggleConversationView = async () => {
  root.querySelector('.icon-btn[aria-label="Settings"]').click();
  [...root.querySelectorAll('.menu-item')]
    .find((item) => item.textContent.includes('Conversation view'))
    .click();
  await settle(400);
};

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  document.querySelectorAll('.toast').forEach((node) => node.remove());
  document.querySelectorAll('.menu').forEach((node) => node.remove());
});

describe('a conversation in the list', () => {
  it('is one row for the messages in it', async () => {
    await mount();
    // Fourteen messages, twelve rows: three of them are one conversation.
    expect(root.querySelectorAll('.row')).toHaveLength(12);
    expect(subjects().filter((subject) => subject.includes('walkthrough')))
      .toEqual([THREAD]);
    expect(root.querySelector('.list-meta').textContent)
      .toBe('14 messages in 12 conversations, 14 unread');
  });

  it('is named by everyone who wrote in it, and says how many wrote', async () => {
    await mount();
    const row = rowFor(THREAD);
    expect(row.querySelector('.row-sender').textContent).toBe('Priya Raman, Tom Beckett');
    expect(row.querySelector('.row-count').textContent).toBe('3');
    expect(row.querySelector('.row-count').hidden).toBe(false);
  });

  it('shows the preview line of its newest message', async () => {
    await mount();
    expect(rowFor(THREAD).querySelector('.row-snippet').textContent)
      .toContain("Two o'clock is perfect");
  });

  it('is where the conversation started, so it sorts by its newest message', async () => {
    await mount();
    // The conversation began two days ago and its last reply is the newest
    // thing in the mailbox, so it comes first.
    expect(subjects()[0]).toBe(THREAD);
  });

  it('leaves an ordinary message counting nothing', async () => {
    await mount();
    const row = rowFor('Welcome to your Puter mailbox');
    expect(row.querySelector('.row-count').hidden).toBe(true);
    expect(row.querySelector('.row-count').textContent).toBe('');
  });
});

describe('opening a conversation', () => {
  it('stacks its messages oldest to newest under one subject', async () => {
    await mount();
    rowFor(THREAD).click();
    await settle();

    expect(root.querySelector('.msg-subject').textContent).toContain(THREAD);
    expect(root.querySelector('.msg-count').textContent).toBe('3');
    expect(items()).toHaveLength(3);

    const names = items()
      .map((item) => item.querySelector('.msg-from-name').textContent);
    expect(names).toEqual(['Priya Raman', 'Tom Beckett', 'Priya Raman']);
  });

  it('says what the number beside the subject counts', async () => {
    await mount();
    rowFor(THREAD).click();
    await settle();

    // Read out with the heading, the bare numeral came out as part of the
    // subject: "Thursday walkthrough3".
    const subject = root.querySelector('.msg-subject');
    expect(subject.getAttribute('aria-label')).toBe(`${THREAD}, 3 messages`);
    expect(root.querySelector('.msg-count').getAttribute('aria-hidden')).toBe('true');

    // One message counts nothing, so there is nothing to explain and the
    // heading is read as what it says.
    root.querySelector('.icon-btn[aria-label="Back to list"]').click();
    await settle();
    rowFor('Welcome to your Puter mailbox').click();
    await settle();
    expect(root.querySelector('.msg-subject').getAttribute('aria-label')).toBeNull();
  });

  it('opens what was unread, because that is what the reader came for', async () => {
    await mount();
    rowFor(THREAD).click();
    await settle();
    // Every sample message starts unread.
    expect(openItems()).toHaveLength(3);
  });

  it('marks the whole conversation read', async () => {
    await mount();
    const before = root.querySelector('.nav-count').textContent;
    expect(before).toBe('14');
    rowFor(THREAD).click();
    await settle();
    expect(root.querySelector('.nav-count').textContent).toBe('11');
  });

  it('opens only the newest once the rest has been read', async () => {
    await mount();
    rowFor(THREAD).click();
    await settle();
    root.querySelector('.icon-btn[aria-label="Back to list"]').click();
    await settle();

    rowFor(THREAD).click();
    await settle();
    expect(items()).toHaveLength(3);
    expect(openItems()).toHaveLength(1);
    // The newest message is the one at the bottom of the stack.
    expect(openItems()[0]).toBe(items()[2]);
  });

  it('reads a collapsed message only when it is opened', async () => {
    await mount();
    rowFor(THREAD).click();
    await settle();
    root.querySelector('.icon-btn[aria-label="Back to list"]').click();
    await settle();
    rowFor(THREAD).click();
    await settle();

    const first = items()[0];
    expect(first.querySelector('.msg-body')).toBeNull();
    first.querySelector('.msg-item-open').click();
    await settle();

    expect(first.classList.contains('is-open')).toBe(true);
    expect(first.querySelector('.msg-body').textContent)
      .toContain('Could we walk through the storage figures');
  });

  it('says who else an open message went to, by name', async () => {
    await mount();
    rowFor(THREAD).click();
    await settle();

    // The newest message is open: To the reader, Cc Tom.
    const lines = [...items()[2].querySelectorAll('.msg-to')].map((line) => line.textContent);
    expect(lines).toEqual(['to sample@puter.com', 'cc Tom Beckett']);
    // The header as it was written is a hover away.
    expect(items()[2].querySelectorAll('.msg-to')[1].title).toBe('cc: Tom Beckett <tom@northgate.example>');
    // Collapsed, a message shows its preview line instead.
    items()[0].querySelector('.msg-item-open').click();
    await settle(60);
    expect(items()[0].querySelector('.msg-to')).toBeNull();
    expect(items()[0].querySelector('.msg-item-snippet')).not.toBeNull();
  });

  it('folds away the copy of the message above that a reply carries', async () => {
    await mount();
    rowFor(THREAD).click();
    await settle();

    // The first message answers nothing, so it quotes nothing.
    expect(items()[0].querySelector('.msg-quoted')).toBeNull();
    const fold = items()[1].querySelector('.msg-quoted');
    expect(fold).not.toBeNull();
    const body = items()[1].querySelector('.msg-body');
    expect(body.textContent).not.toContain('> Thursday or Friday both work');

    fold.click();
    await settle(60);
    expect(items()[1].querySelector('.msg-body').textContent)
      .toContain('> Thursday or Friday both work');
    // And it is set apart from the reply rather than run on from it.
    expect(items()[1].querySelector('.msg-quote').textContent)
      .toContain('> Thursday or Friday both work');
  });

  it('folds the quoted copy back away again', async () => {
    await mount();
    rowFor(THREAD).click();
    await settle();

    const fold = items()[1].querySelector('.msg-quoted');
    fold.click();
    await settle(60);

    // The control is the only way back, so it is still there to be used --
    // and it says which way it now goes.
    expect(fold.hidden).toBe(false);
    expect(fold.isConnected).toBe(true);
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    expect(fold.getAttribute('aria-label')).toBe('Hide the quoted message');
    // Using it must not drop the keyboard on <body>.
    expect(document.activeElement).toBe(fold);

    fold.click();
    await settle(60);
    expect(items()[1].querySelector('.msg-body').textContent)
      .not.toContain('> Thursday or Friday both work');
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(fold.getAttribute('aria-label')).toBe('Show the quoted message');
  });

  it('offers a message that would not read another go at it', async () => {
    const { fs, mailPath, objectsPath } = createSampleMailbox();
    let failing = true;
    const read = fs.read.bind(fs);
    fs.read = async (path) => {
      if (failing && path.includes('/objects/')) throw new Error('network unreachable');
      return read(path);
    };
    renderApp(root, {
      fs, mailPath, objectsPath, sample: true, account: { username: 'sample' },
      onCompose: () => {},
    });
    await settle();
    rowFor(THREAD).click();
    await settle();

    // Every message opened, and every one of them failed.
    const newest = items()[2];
    const failure = newest.querySelector('.msg-full .center');
    expect(failure.textContent).toContain('Could not read this message');
    // Nothing has been read, so there is nothing to reply to yet.
    expect(root.querySelector('.msg-reply').hidden).toBe(true);

    failing = false;
    const again = failure.querySelector('.btn');
    expect(again.textContent).toBe('Try again');
    again.click();
    await settle();

    expect(newest.querySelector('.msg-full .center')).toBeNull();
    expect(newest.querySelector('.msg-body').textContent)
      .toContain("Two o'clock is perfect");
    // And the reply block, which was waiting on that read, is there now.
    expect(root.querySelector('.msg-reply').hidden).toBe(false);
    expect([...root.querySelectorAll('.msg-reply .btn')].map((b) => b.textContent))
      .toEqual(['Reply', 'Reply all', 'Forward']);
  });

  it('offers Reply all, because the conversation has a Cc', async () => {
    const { fs, mailPath, objectsPath } = createSampleMailbox();
    renderApp(root, {
      fs, mailPath, objectsPath, sample: true, account: { username: 'sample' },
      onCompose: () => {},
    });
    await settle();
    rowFor(THREAD).click();
    await settle();

    const labels = [...root.querySelectorAll('.msg-reply .btn')]
      .map((button) => button.textContent);
    expect(labels).toEqual(['Reply', 'Reply all', 'Forward']);
  });
});

describe('acting on a conversation', () => {
  it('archives every message in it, and undoes all of them', async () => {
    await mount();
    await actOn(THREAD, 'Archive');
    expect(subjects()).not.toContain(THREAD);
    expect(root.querySelectorAll('.row')).toHaveLength(11);

    await openFolder('Archive');
    expect(rows()).toHaveLength(1);
    expect(rowFor(THREAD).querySelector('.row-count').textContent).toBe('3');
    expect(root.querySelector('.list-meta').textContent)
      .toBe('3 messages in 1 conversation');

    // One toast, one undo, the whole conversation back -- and back as one
    // conversation of three, not as a row claiming six.
    document.querySelector('.toast-action').click();
    await settle(500);
    await openFolder('Inbox');
    expect(rowFor(THREAD).querySelector('.row-count').textContent).toBe('3');
    expect(root.querySelectorAll('.row')).toHaveLength(12);
  });

  it('undoes into the folder it left, without counting its messages twice', async () => {
    await mount();
    await actOn(THREAD, 'Archive');
    // The undo happens in the Inbox, which is not re-listed: the row is put
    // back from the conversation object the archive emptied.
    document.querySelector('.toast-action').click();
    await settle(600);

    expect(root.querySelectorAll('.row')).toHaveLength(12);
    const row = rowFor(THREAD);
    expect(row.querySelector('.row-count').textContent).toBe('3');
    expect(root.querySelector('.list-meta').textContent)
      .toBe('14 messages in 12 conversations, 14 unread');
    // And it went back where its date puts it, which is the top.
    expect(subjects()[0]).toBe(THREAD);

    row.click();
    await settle();
    expect(items()).toHaveLength(3);
  });

  it('marks all of it unread again from the message toolbar', async () => {
    await mount();
    rowFor(THREAD).click();
    await settle();
    expect(root.querySelector('.nav-count').textContent).toBe('11');

    toolbarBtn('Mark as unread').click();
    await settle();
    expect(root.querySelector('.nav-count').textContent).toBe('14');
    expect(rowFor(THREAD).classList.contains('unread')).toBe(true);
  });

  it('says what moved before saying where it went', async () => {
    await mount();
    // One click, three messages: the count belongs between the verb and the
    // folder. "Moved to Trash 3 messages" read as a folder called "Trash 3
    // messages".
    await actOn(THREAD, 'Delete');
    expect([...document.querySelectorAll('.toast')].pop().textContent)
      .toContain('Moved 3 messages to Trash.');

    await openFolder('Trash');
    await actOn(THREAD, 'Restore');
    expect([...document.querySelectorAll('.toast')].pop().textContent)
      .toContain('Restored 3 messages to Inbox.');
  });

  it('stars it once, and clears whichever message the star is on', async () => {
    await mount();
    const star = rowFor(THREAD).querySelector('.star-btn');
    star.click();
    await settle(60);
    expect(star.getAttribute('aria-pressed')).toBe('true');

    await openFolder('Starred');
    expect(rows()).toHaveLength(1);
    expect(root.querySelector('.list-meta').textContent).toBe('1 conversation starred');

    // The star went on the newest message; one click has to find it again.
    rowFor(THREAD).querySelector('.star-btn').click();
    await settle(60);
    expect(rows()).toHaveLength(0);
  });

  it('names every star, because there is one per message in the reader', async () => {
    await mount();
    // The row's other controls name their row; the star does too.
    expect(rowFor(THREAD).querySelector('.star-btn').getAttribute('aria-label'))
      .toBe(`Star ${THREAD}`);

    rowFor(THREAD).click();
    await settle();
    const stars = [...root.querySelectorAll('.msg-item .star-btn')];
    expect(stars).toHaveLength(3);
    // Three controls all called "Star" were no answer to which message the
    // next one would star -- and Priya wrote two of them, so the name alone
    // was no answer either. The date is what tells her messages apart.
    const labels = stars.map((star) => star.getAttribute('aria-label'));
    expect(labels[0]).toMatch(/^Star the message from Priya Raman, ./);
    expect(labels[1]).toMatch(/^Star the message from Tom Beckett, ./);
    expect(labels[2]).toMatch(/^Star the message from Priya Raman, ./);
    expect(new Set(labels).size).toBe(3);

    stars[1].click();
    await settle(60);
    expect(stars[1].getAttribute('aria-label'))
      .toMatch(/^Unstar the message from Tom Beckett, ./);
    expect(rowFor(THREAD).querySelector('.star-btn').getAttribute('aria-label'))
      .toBe(`Unstar ${THREAD}`);
  });

  it('says which message a collapsed line would expand', async () => {
    await mount();
    rowFor(THREAD).click();
    await settle();
    root.querySelector('.icon-btn[aria-label="Back to list"]').click();
    await settle();
    rowFor(THREAD).click();
    await settle();

    // Two collapsed lines, one of them Priya's: the reply she is answered by
    // is hers too, so the dates are what keep the two apart.
    const openers = items().map((item) => item.querySelector('.msg-expander'));
    expect(openers.map((opener) => opener.getAttribute('aria-label'))[0])
      .toMatch(/^Expand the message from Priya Raman, ./);
    expect(new Set(openers.map((opener) => opener.getAttribute('aria-label'))).size).toBe(3);

    openers[0].click();
    await settle();
    expect(openers[0].getAttribute('aria-label'))
      .toMatch(/^Collapse the message from Priya Raman, ./);
  });

  it('keeps the controls in a message\'s header out of its toggle', async () => {
    const { fs, mailPath, objectsPath } = createSampleMailbox();
    renderApp(root, {
      fs, mailPath, objectsPath, sample: true, account: { username: 'sample' },
      onCompose: () => {},
    });
    await settle();
    rowFor(THREAD).click();
    await settle();

    // The whole header line used to be the button that folds the message,
    // with the menu beside the date inside it -- and what is inside a button
    // is its label, not a control anyone using a screen reader can reach.
    // The name is the button now, and the menu stands beside it.
    const open = items()[2];
    const toggle = open.querySelector('.msg-expander');
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Priya Raman');
    const more = open.querySelector('.msg-more');
    expect(more.parentElement.closest('button, [role="button"]')).toBeNull();
    expect(open.querySelector('.msg-item-open').getAttribute('role')).toBeNull();
    expect(open.querySelector('.msg-item-open').hasAttribute('tabindex')).toBe(false);

    // The name folds the message and keeps the keyboard while the head is
    // drawn again around it; the line around it still folds under the
    // pointer; and a message on its own has a name that is only a name.
    toggle.focus();
    toggle.click();
    await settle(30);
    expect(open.classList.contains('is-open')).toBe(false);
    expect(open.querySelector('.msg-expander')).toBe(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toMatch(/^Expand the message from Priya Raman, ./);
    expect(document.activeElement).toBe(toggle);
    open.querySelector('.msg-item-open').click();
    await settle(60);
    expect(open.classList.contains('is-open')).toBe(true);
    root.querySelector('.icon-btn[aria-label="Back to list"]').click();
    await settle();
    rowFor('Welcome to your Puter mailbox').click();
    await settle();
    expect(root.querySelector('.msg-expander')).toBeNull();
    expect(root.querySelector('.msg-from-name').tagName).toBe('SPAN');
  });

  it('is one row to the tick box at the head of the list', async () => {
    await mount();
    const all = root.querySelector('.select-all');
    const flip = () => {
      all.checked = !all.checked;
      all.dispatchEvent(new Event('change', { bubbles: true }));
    };

    // Twelve rows over fourteen messages. The box is about the rows, so
    // ticking all of them is "checked" rather than a count that overshoots
    // and leaves it looking empty.
    flip();
    await settle(60);
    expect(ticked()).toHaveLength(12);
    expect(all.checked).toBe(true);
    expect(all.indeterminate).toBe(false);

    // And the second click clears them, which it could not do while the box
    // never registered as checked in the first place.
    flip();
    await settle(60);
    expect(ticked()).toHaveLength(0);
    expect(root.querySelector('.list-actions').hidden).toBe(true);

    // Some but not all: indeterminate, even when the one row ticked stands
    // for three messages.
    tick(rowFor(THREAD));
    await settle(60);
    expect(all.checked).toBe(false);
    expect(all.indeterminate).toBe(true);
  });
});

describe('mail that arrives into a conversation already on screen', () => {
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

  /**
   * Mounted as a real account rather than the sample inbox, because the sample
   * inbox deliberately never checks for new mail.
   */
  const deliver = async (mailbox) => {
    const { fs, objectsPath } = mailbox;
    const days = (await fs.readdir(objectsPath))
      .filter((item) => item.is_dir)
      .map((item) => item.name)
      .sort();
    // A filename that sorts above every other, in the newest day folder,
    // which is where mail is delivered.
    const name = `ffffffff-ffff-7fff-8fff-ffffffffffff--${btoa('Re: Thursday walkthrough').replace(/=+$/, '')}`;
    await fs.write(`${objectsPath}/${days[days.length - 1]}/${name}`, new Blob([REPLY]));
    // A tab coming back into view is one of the moments the app looks.
    document.dispatchEvent(new Event('visibilitychange'));
    await settle(700);
  };

  it('joins it rather than starting a row of its own', async () => {
    window.localStorage.clear();
    const mailbox = createSampleMailbox();
    renderApp(root, { ...mailbox, sample: false, account: { username: 'tester' } });
    await settle();
    expect(root.querySelectorAll('.row')).toHaveLength(12);

    await deliver(mailbox);

    // Still twelve rows, and the conversation it answers now holds four --
    // and has moved to the top, because its newest message has.
    expect(root.querySelectorAll('.row')).toHaveLength(12);
    const row = rowFor(THREAD);
    expect(row).toBe(rows()[0]);
    expect(row.querySelector('.row-count').textContent).toBe('4');
    expect(row.querySelector('.row-snippet').textContent).toContain('Booked the small room');
    // The reply is from someone already in the conversation, so nobody new is
    // named.
    expect(row.querySelector('.row-sender').textContent).toBe('Priya Raman, Tom Beckett');

    row.click();
    await settle();
    expect(items()).toHaveLength(4);
    window.localStorage.clear();
  });
});

describe('the head reads a folder waits for', () => {
  it('keeps their progress out of a folder opened over the top of them', async () => {
    const { fs, mailPath, objectsPath } = createSampleMailbox();
    const read = fs.read.bind(fs);
    // Slow enough that the folder can be switched while they are in flight.
    fs.read = async (...args) => {
      await settle(400);
      return read(...args);
    };
    renderApp(root, {
      fs, mailPath, objectsPath, sample: true, account: { username: 'sample' },
    });
    const meta = () => root.querySelector('.list-meta').textContent;

    await settle(150);
    expect(meta()).toBe('');
    expect(root.querySelector('.loading-list')).not.toBeNull();

    await openFolder('Archive');
    // The inbox's reads carry on -- the index is worth having either way --
    // but they are no longer news, and the last one to land used to stay in
    // the meta line of the folder opened instead, for good: the load that
    // would have written the real count over it had given up on the inbox.
    await settle(2500);
    expect(meta()).not.toContain('Reading');
  });
});

describe('search', () => {
  it('answers about messages rather than conversations', async () => {
    await mount();
    await search('walkthrough');
    // Three messages carry the word, and a result stands for the message it
    // found rather than for everything that message is threaded with.
    expect(subjects()).toEqual([
      'Re: Thursday walkthrough', 'Re: Thursday walkthrough', 'Thursday walkthrough',
    ]);
    expect(root.querySelector('.list-meta').textContent).toBe('3 results in 14 messages');
  });

  it('gives the folder its conversations back when it is cleared', async () => {
    await mount();
    await search('walkthrough');
    await search('');
    expect(root.querySelectorAll('.row')).toHaveLength(12);
    expect(rowFor(THREAD).querySelector('.row-count').textContent).toBe('3');
  });

  it('counts a result opened from a search out of the unread badge', async () => {
    await mount();
    expect(root.querySelector('.nav-count').textContent).toBe('14');
    await search('walkthrough');
    rows()[0].click();
    await settle();
    // A search's meta line is about the results, so the folder counts are
    // brought up to date on their own: the badge and the tab title both said
    // the message just read was still unread.
    expect(root.querySelector('.nav-count').textContent).toBe('13');
    expect(document.title).toContain('(13)');
  });
});

describe('turning the conversation view off', () => {
  it('gives every message a row of its own', async () => {
    await mount();
    expect(root.querySelectorAll('.row')).toHaveLength(12);

    await toggleConversationView();
    expect(root.querySelectorAll('.row')).toHaveLength(14);
    expect(subjects().filter((subject) => subject.includes('walkthrough'))).toEqual([
      'Re: Thursday walkthrough', 'Re: Thursday walkthrough', 'Thursday walkthrough',
    ]);
    expect(root.querySelector('.list-meta').textContent).toBe('14 messages, 14 unread');
  });

  it('opens a message on its own, with nothing to collapse', async () => {
    await mount();
    await toggleConversationView();
    rowFor('Re: Thursday walkthrough').click();
    await settle();

    expect(items()).toHaveLength(1);
    expect(root.querySelector('.msg-count')).toBeNull();
    // Nothing above it in the reader, so nothing is folded away either: the
    // quote it carries is all there is of the message it answers.
    expect(root.querySelector('.msg-quoted')).toBeNull();
    expect(root.querySelector('.msg-body').textContent)
      .toContain('> Thursday works. Shall we say two');
  });

  it('groups them again when it is turned back on', async () => {
    await mount();
    await toggleConversationView();
    expect(root.querySelectorAll('.row')).toHaveLength(14);
    await toggleConversationView();
    expect(root.querySelectorAll('.row')).toHaveLength(12);
  });
});

/**
 * A conversation whose first message is on a later page. The folder pages
 * newest-first, so the reply is listed before the message it answers -- and
 * "Load older messages" has to group the page against what is already on
 * screen rather than beside it.
 */
describe('a page of older mail', () => {
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

  // Thirty files per day folder, so the first page of sixty stops with the
  // oldest folder -- the one holding the start of the conversation -- unlisted.
  const named = (day, i, subject) => {
    const name = `${day}-${String(i).padStart(2, '0')}--${btoa(subject).replace(/=+$/, '')}`;
    return { name, path: `${OBJECTS}/${day}/${name}`, is_dir: false, size: 300, modified: 0 };
  };

  const subjectOf = (path) => {
    const encoded = path.slice(path.indexOf('--') + 2);
    return atob(encoded + '='.repeat((4 - encoded.length % 4) % 4));
  };

  const fs = {
    async readdir(path) {
      if (path === OBJECTS) {
        return DAYS.map((day) => ({ name: day, path: `${OBJECTS}/${day}`, is_dir: true }));
      }
      const day = path.split('/').pop();
      return Array.from({ length: 30 }, (unused, i) => {
        // Last within the newest day, so the row is well down the first page
        // and its place there is worth watching.
        if (day === DAYS[0] && i === 0) return named(day, i, 'Re: Roof survey');
        if (day === DAYS[2] && i === 0) return named(day, i, 'Roof survey');
        return named(day, i, `${day} number ${String(i).padStart(2, '0')}`);
      });
    },
    async read(path) {
      const subject = subjectOf(path);
      if (subject === 'Re: Roof survey') {
        return new Blob([raw(subject, [
          'Message-ID: <survey-2@example.com>',
          `In-Reply-To: ${ROOT_ID}`,
          `References: ${ROOT_ID}`,
        ])]);
      }
      if (subject === 'Roof survey') {
        return new Blob([raw(subject, [`Message-ID: ${ROOT_ID}`])]);
      }
      return new Blob([raw(subject)]);
    },
  };

  it('joins a conversation already on screen instead of listing beside it', async () => {
    window.localStorage.clear();
    renderApp(root, {
      fs, mailPath: '/user/.mail', objectsPath: OBJECTS,
      sample: true, account: { username: 'user' },
    });
    await settle(700);

    // Sixty messages, sixty rows: the reply's own first message has not been
    // listed yet, so it stands alone and says so.
    expect(root.querySelectorAll('.row')).toHaveLength(60);
    expect(rowFor('Re: Roof survey').querySelector('.row-count').hidden).toBe(true);
    const was = rows().indexOf(rowFor('Re: Roof survey'));
    expect(was).toBe(29);

    root.querySelector('.btn-more').click();
    await settle(900);

    // Ninety messages, eighty-nine rows: the older page brought the start of
    // the conversation, and the row that was already there took it in.
    expect(root.querySelectorAll('.row')).toHaveLength(89);
    expect(rowFor('Re: Roof survey')).toBeUndefined();
    const row = rowFor('Roof survey');
    expect(row.querySelector('.row-count').textContent).toBe('2');
    // Ordered by its newest message, which has not changed -- so it is where
    // the reply was rather than down with the page that just arrived.
    expect(rows().indexOf(row)).toBe(was);
    window.localStorage.clear();
  });
});

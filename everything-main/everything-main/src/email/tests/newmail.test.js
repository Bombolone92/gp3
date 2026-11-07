import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';
import { createDraftStore } from '../src/lib/drafts.js';
import { memoryStorage } from '../src/lib/readstate.js';

/**
 * Mail that arrives while the app is open. Mounted as a real account rather
 * than the sample inbox, because the sample inbox deliberately never checks
 * for new mail.
 */

const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

const LATE = [
  'From: Ana Petrova <ana@example.com>',
  'To: sample@puter.com',
  'Subject: Late arrival',
  'Date: Mon, 17 Aug 2026 10:30:00 GMT',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'One more thing before the quarter closes.',
].join('\r\n');

let root;
let mailbox;

const mount = async () => {
  mailbox = createSampleMailbox();
  renderApp(root, {
    ...mailbox,
    sample: false,
    account: { username: 'tester' },
    drafts: createDraftStore('tester', memoryStorage()),
    onCompose: () => {},
  });
  await settle();
};

// A reply to the sample inbox's three-message conversation, carrying the
// headers that put it there.
const REPLY = [
  'From: Tom Beckett <tom@northgate.example>',
  'To: sample@puter.com',
  'Subject: Re: Thursday walkthrough',
  'Date: Tue, 15 Sep 2026 11:00:00 GMT',
  'Message-ID: <walkthrough-4@northgate.example>',
  'In-Reply-To: <walkthrough-3@northgate.example>',
  'References: <walkthrough-1@northgate.example> <walkthrough-3@northgate.example>',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Printed sheets it is. See you at two.',
].join('\r\n');

// A filename that sorts above every real uuid v7, in the newest day folder,
// which is where mail is delivered. A second delivery in one test has to
// sort above the first, so the uuid is a parameter.
const deliver = async (raw = LATE, subject = 'Late arrival', uuid = 'ffffffff-ffff-7fff-8fff-ffffffffffff') => {
  const { fs, objectsPath } = mailbox;
  const days = (await fs.readdir(objectsPath))
    .filter((item) => item.is_dir)
    .map((item) => item.name)
    .sort();
  const name = `${uuid}--${btoa(subject).replace(/=+$/, '')}`;
  await fs.write(`${objectsPath}/${days[days.length - 1]}/${name}`, new Blob([raw]));
  // A tab coming back into view is one of the moments the app looks.
  document.dispatchEvent(new Event('visibilitychange'));
  await settle(600);
};

const search = async (text) => {
  const input = root.querySelector('.search-input');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle(700);
};

const subjects = () => [...root.querySelectorAll('.row')]
  .filter((row) => !row.hidden)
  .map((row) => row.querySelector('.row-subject').textContent);

beforeEach(() => {
  window.localStorage.clear();
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  document.querySelectorAll('.toast').forEach((node) => node.remove());
  window.localStorage.clear();
});

describe('mail that arrives under the open conversation', () => {
  it('goes under the reader without being announced as new', async () => {
    await mount();
    [...root.querySelectorAll('.row')]
      .find((row) => row.querySelector('.row-subject').textContent === 'Thursday walkthrough')
      .click();
    await settle(500);
    expect(root.querySelectorAll('.msg-item')).toHaveLength(3);

    // A reply to what is being read is put under it, opened and read -- so
    // it is not news the pill has to break when the reader is closed.
    await deliver(REPLY, 'Re: Thursday walkthrough', 'fffffffe-ffff-7fff-8fff-ffffffffffff');
    expect(root.querySelectorAll('.msg-item')).toHaveLength(4);
    const pill = root.querySelector('.new-mail');
    expect(pill.hidden).toBe(true);

    // Mail for some other conversation still is.
    await deliver();
    expect(pill.hidden).toBe(false);
    expect(pill.textContent).toBe('1 new message');
  });
});

describe('mail that arrives while a search is on screen', () => {
  it('is searched, and joins the results when it matches', async () => {
    await mount();
    await search('petrova');
    expect(subjects()).toEqual(['Q3 usage report attached']);
    expect(root.querySelector('.list-meta').textContent).toBe('1 result in 14 messages');

    await deliver();

    // The folder was indexed before this message existed. Without reading it
    // the count would sit one short for ever and the message would never
    // match anything.
    expect(subjects()).toEqual(['Late arrival', 'Q3 usage report attached']);
    expect(root.querySelector('.list-meta').textContent).toBe('2 results in 15 messages');
  });

  it('joins the results without emptying the scroller under the reader', async () => {
    await mount();
    await search('petrova');

    // Clearing the list to rebuild it puts the scroll position back to the
    // top, which is not where the reader was.
    const removed = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) removed.push(...record.removedNodes);
    });
    observer.observe(root.querySelector('.msglist'), { childList: true });
    await deliver();
    observer.disconnect();

    expect(removed).toEqual([]);
    expect(root.querySelector('.msglist-options').parentNode)
      .toBe(root.querySelector('.msglist'));
  });

  it('is announced, and appears in the folder once the search is cleared', async () => {
    await mount();
    await deliver();
    expect(subjects()[0]).toBe('Late arrival');
  });
});

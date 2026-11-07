import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';
import { createDraftStore } from '../src/lib/drafts.js';
import { mailFilename, dayFolder } from '../src/lib/mailbox.js';
import { memoryStorage } from '../src/lib/readstate.js';

/**
 * Rows filled in from the header index rather than by reading the file again.
 *
 * Mounted as a real account rather than the sample inbox, because the index
 * only outlives a session when there is real storage behind it -- and it is
 * the second session, the one that reads the index instead of the mailbox,
 * that these are about.
 */

const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

let root;

const mount = async ({ seed } = {}) => {
  const mailbox = createSampleMailbox();
  await seed?.(mailbox);
  renderApp(root, {
    ...mailbox,
    sample: false,
    account: { username: 'tester' },
    drafts: createDraftStore('tester', memoryStorage()),
    onCompose: () => {},
  });
  await settle();
};

const remount = async (options) => {
  root.remove();
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
  await mount(options);
};

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
  await settle(700);
};

const shown = (selector) => [...root.querySelectorAll('.row')]
  .filter((row) => !row.hidden)
  .map((row) => row.querySelector(selector).textContent);

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

const SENT = [
  'From: tester@puter.email',
  'To: Ana Petrova <ana@example.com>, Leo Tanaka <leo@example.com>',
  'Subject: Printer quote',
  'Date: Mon, 17 Aug 2026 10:30:00 GMT',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Quote attached for the uncoated stock.',
].join('\r\n');
const SENT_AT = new Date('2026-08-17T10:30:00Z');
// A fixed filename: the filename is the index's key, so the second session
// below has to be looking up the message the first one stored.
const SENT_NAME = mailFilename('Printer quote', SENT_AT, new Uint8Array(10));
const withSent = {
  seed: ({ fs, mailPath }) =>
    fs.write(`${mailPath}/sent/${dayFolder(SENT_AT)}/${SENT_NAME}`, new Blob([SENT])),
};

describe('a row the index can fill in', () => {
  it('is repainted rather than left saying nothing', async () => {
    await mount();
    // Reading the folder for a full-text search is what fills the index.
    await search('petrova');
    expect(shown('.row-subject')).toEqual(['Q3 usage report attached']);

    // Second session: the rows are built by the folder listing, then filled
    // in from the index when the search lists the folder. Both have to show.
    await remount();
    await search('petrova');
    expect(shown('.row-sender')).toEqual(['Ana Petrova']);
    expect(shown('.row-snippet')[0]).toContain('usage export');
  });
});

describe('a Sent row', () => {
  it('shows who the message went to', async () => {
    await mount(withSent);
    await openFolder('Sent');
    await search('uncoated');
    expect(shown('.row-sender')).toEqual(['Ana Petrova, +1']);
  });

  it('still shows them when it comes back from the index', async () => {
    await mount(withSent);
    await openFolder('Sent');
    await search('uncoated');
    expect(shown('.row-sender')).toEqual(['Ana Petrova, +1']);

    // A Sent row shows who the message went to, so an index entry that has
    // only a sender is no answer for one: filling in everything except the
    // recipients left the row saying '…' with nothing left to correct it.
    await remount(withSent);
    await openFolder('Sent');
    await search('uncoated');
    expect(shown('.row-sender')).toEqual(['Ana Petrova, +1']);
  });
});

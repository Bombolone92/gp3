import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';

/**
 * The menu beside each open message in a conversation: answering that
 * message rather than the newest, and downloading it as a file.
 */

const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

let root;
let prefills;

const mount = ({ canSend = true } = {}) => {
  const { fs, mailPath, objectsPath } = createSampleMailbox();
  renderApp(root, {
    fs, mailPath, objectsPath, sample: true, account: { username: 'sample' },
    ...(canSend ? { onCompose: (prefill) => prefills.push(prefill) } : {}),
  });
};

const open = async (subject) => {
  // The folder lists after mount, and the row has to be there to be opened.
  if (!root.querySelector('.row')) await settle(400);
  [...root.querySelectorAll('.row')]
    .find((row) => row.querySelector('.row-subject').textContent === subject)
    .click();
  await settle(400);
};

const cards = () => [...root.querySelectorAll('.msg-item')];
const moreOf = (card) => card.querySelector('.msg-more');
const menuItems = () => [...document.querySelectorAll('.menu .menu-item')];
const itemNamed = (label) => menuItems().find((item) => item.textContent.trim() === label);

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
  prefills = [];
});

afterEach(() => {
  root.remove();
  // A dialog left open by a failed assertion must not be the one the next
  // test finds.
  document.querySelectorAll('.toast, .menu, .modal-root').forEach((node) => node.remove());
});

describe('the per-message menu', () => {
  it('answers the message it belongs to, not the newest one', async () => {
    mount();
    await open('Thursday walkthrough');
    // All three arrive unread, so all three are open and carry a menu.
    expect(cards()).toHaveLength(3);
    expect(cards().every((card) => moreOf(card))).toBe(true);

    moreOf(cards()[0]).click();
    await settle(50);
    expect(itemNamed('Reply')).toBeTruthy();
    itemNamed('Reply').click();
    await settle(50);

    expect(prefills).toHaveLength(1);
    // The oldest message is the first in the stack.
    expect(prefills[0].inReplyTo).toBe('<walkthrough-1@northgate.example>');
    expect(prefills[0].kind).toBe('reply');

    // The block at the foot still answers the newest.
    [...root.querySelectorAll('.msg-reply .btn')]
      .find((btn) => btn.textContent.trim() === 'Reply').click();
    expect(prefills[1].inReplyTo).toBe('<walkthrough-3@northgate.example>');
  });

  it('forwards the one message, with its own text', async () => {
    mount();
    await open('Thursday walkthrough');
    moreOf(cards()[1]).click();
    await settle(50);
    itemNamed('Forward').click();
    await settle(50);
    expect(prefills[0].kind).toBe('forward');
    expect(prefills[0].subject).toMatch(/^Fwd: /);
  });

  it('offers no reply on a message that is on its own', async () => {
    mount();
    await open('Welcome to your Puter mailbox');
    expect(cards()).toHaveLength(1);
    moreOf(cards()[0]).click();
    await settle(50);
    expect(menuItems().map((item) => item.textContent.trim()))
      .toEqual(['Copy sender\'s address', 'Show details', 'Download original (.eml)']);
  });

  it('offers no reply where nothing can be sent', async () => {
    mount({ canSend: false });
    await open('Thursday walkthrough');
    moreOf(cards()[0]).click();
    await settle(50);
    expect(menuItems().map((item) => item.textContent.trim()))
      .toEqual(['Copy sender\'s address', 'Show details', 'Download original (.eml)']);
  });

  it('downloads the message as it arrived, as an .eml file', async () => {
    mount();
    await open('Welcome to your Puter mailbox');
    const made = [];
    const clicked = [];
    URL.createObjectURL = (blob) => { made.push(blob); return 'blob:x'; };
    URL.revokeObjectURL = () => {};
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { clicked.push(this.getAttribute('download')); };
    try {
      moreOf(cards()[0]).click();
      await settle(50);
      itemNamed('Download original (.eml)').click();
      await settle(50);
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }
    expect(clicked).toEqual(['Welcome to your Puter mailbox.eml']);
    expect(made[0].type).toBe('message/rfc822');
    expect(await made[0].text()).toContain('Subject: Welcome to your Puter mailbox');
  });

  it('is not on a collapsed message, whose file has not been read', async () => {
    mount();
    await open('Thursday walkthrough');
    root.querySelector('[aria-label="Back to list"]').click();
    await open('Thursday walkthrough');
    const closed = cards().filter((card) => !card.classList.contains('is-open'));
    expect(closed.length).toBeGreaterThan(0);
    expect(closed.every((card) => !moreOf(card))).toBe(true);
  });
});

describe('Copy sender\'s address', () => {
  it('puts the bare address on the clipboard and says so', async () => {
    const written = [];
    const had = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: async (text) => { written.push(text); } },
    });
    try {
      mount();
      await open('Welcome to your Puter mailbox');
      moreOf(cards()[0]).click();
      await settle(50);
      itemNamed('Copy sender\'s address').click();
      await settle(50);
    } finally {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: had });
    }
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/^[^\s<>@]+@[^\s<>@]+$/);
    const toast = [...document.querySelectorAll('.toast')].pop()?.textContent ?? '';
    expect(toast).toBe(`Copied ${written[0]}.`);
  });

  it('says so when the clipboard refuses', async () => {
    const had = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: async () => { throw new Error('denied'); } },
    });
    try {
      mount();
      await open('Welcome to your Puter mailbox');
      moreOf(cards()[0]).click();
      await settle(50);
      itemNamed('Copy sender\'s address').click();
      await settle(50);
    } finally {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: had });
    }
    const toast = [...document.querySelectorAll('.toast')].pop()?.textContent ?? '';
    expect(toast).toBe('Could not copy to the clipboard.');
  });
});

describe('Show details', () => {
  it('lays the headers out as a table', async () => {
    mount();
    await open('Thursday walkthrough');
    moreOf(cards()[2]).click();
    await settle(50);
    itemNamed('Show details').click();
    await settle(50);

    const dialog = document.querySelector('.modal-root');
    expect(dialog).not.toBe(null);
    expect(dialog.querySelector('.modal-title').textContent).toBe('Message details');
    const names = [...dialog.querySelectorAll('.details-name')].map((n) => n.textContent);
    const values = [...dialog.querySelectorAll('.details-value')].map((n) => n.textContent);
    const row = (name) => values[names.indexOf(name)];
    expect(row('Message-ID')).toBe('<walkthrough-3@northgate.example>');
    expect(row('In-Reply-To')).toBe('<walkthrough-2@northgate.example>');
    expect(row('Subject')).toBe('Re: Thursday walkthrough');
    expect(row('From')).toContain('@');
    expect(row('Cc')).toContain('tom@northgate.example');
    // Nothing is shown for a header the message does not have.
    expect(names).not.toContain('Reply-To');
    expect(names).not.toContain('Attachments');
  });

  it('names the attachments a message carries', async () => {
    mount();
    await open('Q3 usage report attached');
    moreOf(cards()[0]).click();
    await settle(50);
    itemNamed('Show details').click();
    await settle(50);
    const dialog = document.querySelector('.modal-root');
    const names = [...dialog.querySelectorAll('.details-name')].map((n) => n.textContent);
    const values = [...dialog.querySelectorAll('.details-value')].map((n) => n.textContent);
    expect(values[names.indexOf('Attachments')]).toContain('q3-usage.csv');
  });
});

describe('controls inside a message head', () => {
  it('do not collapse the message they sit in', async () => {
    mount();
    await open('Thursday walkthrough');
    const card = cards()[0];
    expect(card.classList.contains('is-open')).toBe(true);
    moreOf(card).click();
    await settle(50);
    expect(card.classList.contains('is-open')).toBe(true);
    expect(menuItems().length).toBeGreaterThan(0);
    // The head itself still does.
    card.querySelector('.msg-item-toggle').click();
    expect(card.classList.contains('is-open')).toBe(false);
  });
});

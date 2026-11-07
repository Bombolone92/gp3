import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';

/**
 * Archive, delete and restore over the sample mailbox: the moves are real
 * (the in-memory fs implements move and delete), so where a message lands is
 * checked by opening the folder it should be in.
 */

const settle = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

let root;

const mount = () => {
  const { fs, mailPath, objectsPath } = createSampleMailbox();
  renderApp(root, {
    fs, mailPath, objectsPath, sample: true, account: { username: 'sample' },
  });
};

const openFolder = async (label) => {
  [...root.querySelectorAll('.nav-item')]
    .find((item) => item.textContent.includes(label))
    .click();
  await settle(250);
};

const subjects = () => [...root.querySelectorAll('.row')]
  .map((row) => row.querySelector('.row-subject').textContent);

const rowFor = (subject) => [...root.querySelectorAll('.row')]
  .find((row) => row.querySelector('.row-subject').textContent === subject);

const actOn = async (subject, label) => {
  [...rowFor(subject).querySelectorAll('.row-action')]
    .find((button) => (button.getAttribute('aria-label') || '').startsWith(label))
    .click();
  await settle(250);
};

const lastToast = () => [...document.querySelectorAll('.toast')].pop()?.textContent ?? '';

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  document.querySelectorAll('.toast').forEach((node) => node.remove());
});

describe('where the keyboard goes after an action', () => {
  const SUBJECT = 'Welcome to your Puter mailbox';

  const nth = (n) => [...root.querySelectorAll('.row')][n];

  it('carries on from the row that took the archived one\'s place', async () => {
    mount();
    await settle(250);
    const after = nth(1).querySelector('.row-subject').textContent;
    const button = [...nth(0).querySelectorAll('.row-action')]
      .find((b) => (b.getAttribute('aria-label') || '').startsWith('Archive'));
    button.focus();
    button.click();
    await settle(250);

    // The button archived itself off the page; the keyboard has to land
    // somewhere better than the top of the document.
    expect(document.activeElement.classList.contains('row')).toBe(true);
    expect(document.activeElement.querySelector('.row-subject').textContent).toBe(after);
  });

  it('carries on from the list after archiving from the open message', async () => {
    mount();
    await settle(250);
    const after = nth(1).querySelector('.row-subject').textContent;
    nth(0).click();
    await settle(250);

    const button = [...root.querySelectorAll('.msg-actions-bar .icon-btn')]
      .find((b) => b.getAttribute('aria-label') === 'Archive');
    button.focus();
    button.click();
    await settle(250);

    expect(document.activeElement.classList.contains('row')).toBe(true);
    expect(document.activeElement.querySelector('.row-subject').textContent).toBe(after);
  });

  it('carries on from the row after marking the open message unread', async () => {
    mount();
    await settle(250);
    const subject = nth(0).querySelector('.row-subject').textContent;
    nth(0).click();
    await settle(250);

    const button = [...root.querySelectorAll('.msg-actions-bar .icon-btn')]
      .find((b) => b.getAttribute('aria-label') === 'Mark as unread');
    button.focus();
    button.click();
    await settle(250);

    // Marking unread put the message back on the list and closed the reader
    // -- taking the toolbar, and the control the keyboard was on, with it.
    expect(document.activeElement.classList.contains('row')).toBe(true);
    expect(document.activeElement.querySelector('.row-subject').textContent).toBe(subject);
  });

  it('falls back to the toolbar after unstarring the last starred row', async () => {
    mount();
    await settle(250);
    rowFor(SUBJECT).querySelector('.star-btn').click();
    await settle(120);
    await openFolder('Starred');

    const star = rowFor(SUBJECT).querySelector('.star-btn');
    star.focus();
    star.click();
    await settle(250);

    // The row hid itself under the star that cleared it; the keyboard has to
    // land somewhere better than the top of the document.
    expect(document.activeElement.getAttribute('aria-label')).toBe('Refresh this folder');
  });

  it('falls back to the folder toolbar when the folder is empty', async () => {
    mount();
    await settle(250);
    await actOn(SUBJECT, 'Archive');
    await openFolder('Archive');

    const button = [...rowFor(SUBJECT).querySelectorAll('.row-action')]
      .find((b) => (b.getAttribute('aria-label') || '').startsWith('Delete'));
    button.focus();
    button.click();
    await settle(250);

    expect(document.activeElement.getAttribute('aria-label')).toBe('Refresh this folder');
  });
});

describe('restore', () => {
  const SUBJECT = 'Welcome to your Puter mailbox';

  it('sends an archived message back to the inbox', async () => {
    mount();
    await settle(250);
    await actOn(SUBJECT, 'Archive');

    await openFolder('Archive');
    expect(subjects()).toEqual([SUBJECT]);
    await actOn(SUBJECT, 'Restore');
    expect(lastToast()).toContain('Restored to Inbox');

    await openFolder('Inbox');
    expect(subjects()).toContain(SUBJECT);
  });

  it('sends a deleted message back to the folder it was deleted from', async () => {
    mount();
    await settle(250);
    await actOn(SUBJECT, 'Archive');

    await openFolder('Archive');
    await actOn(SUBJECT, 'Delete');

    await openFolder('Trash');
    expect(subjects()).toEqual([SUBJECT]);
    await actOn(SUBJECT, 'Restore');
    expect(lastToast()).toContain('Restored to Archive');

    await openFolder('Archive');
    expect(subjects()).toEqual([SUBJECT]);
  });

  it('still knows where a message came from after a restore is undone', async () => {
    mount();
    await settle(250);
    await actOn(SUBJECT, 'Archive');
    await openFolder('Archive');
    await actOn(SUBJECT, 'Delete');
    await openFolder('Trash');
    await actOn(SUBJECT, 'Restore');
    expect(lastToast()).toContain('Restored to Archive');

    // Undo puts it back in Trash. It came from Archive, and it still does.
    [...document.querySelectorAll('.toast-action')].pop().click();
    await settle(250);
    expect(subjects()).toEqual([SUBJECT]);
    await actOn(SUBJECT, 'Restore');
    expect(lastToast()).toContain('Restored to Archive');
    await openFolder('Archive');
    expect(subjects()).toEqual([SUBJECT]);
  });

  it('does not treat the restore itself as where the message came from', async () => {
    mount();
    await settle(250);
    await actOn(SUBJECT, 'Archive');
    await openFolder('Archive');
    await actOn(SUBJECT, 'Delete');
    await openFolder('Trash');
    await actOn(SUBJECT, 'Restore');

    // Restored into Archive, and restoring again must go to the inbox rather
    // than back to the Trash it just came out of.
    await openFolder('Archive');
    await actOn(SUBJECT, 'Restore');
    expect(lastToast()).toContain('Restored to Inbox');

    await openFolder('Trash');
    expect(subjects()).toEqual([]);
    await openFolder('Inbox');
    expect(subjects()).toContain(SUBJECT);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';

/**
 * Emptying the Trash over the sample mailbox: the deletes are real against
 * the in-memory fs, so the folder is checked by listing it afterwards.
 */

const settle = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

let root;
let fs;

const mount = () => {
  const sample = createSampleMailbox();
  ({ fs } = sample);
  renderApp(root, {
    fs, mailPath: sample.mailPath, objectsPath: sample.objectsPath,
    sample: true, account: { username: 'sample' },
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
const note = () => root.querySelector('.folder-note');
const dialog = () => document.querySelector('.modal-root');

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  document.querySelectorAll('.toast, .modal-root').forEach((node) => node.remove());
});

describe('Empty Trash', () => {
  const ONE = 'Welcome to your Puter mailbox';
  const TWO = 'Your receipt from Nimbus Coffee';

  it('is offered above the rows in Trash, and nowhere else', async () => {
    mount();
    await settle(250);
    expect(note()).toBe(null);
    await actOn(ONE, 'Delete');
    await openFolder('Archive');
    expect(note()).toBe(null);
    await openFolder('Trash');
    expect(note()).not.toBe(null);
    expect(note().textContent).toContain('Empty Trash now');
  });

  it('is not offered over an empty Trash', async () => {
    mount();
    await settle(250);
    await openFolder('Trash');
    expect(subjects()).toEqual([]);
    expect(note()).toBe(null);
  });

  it('asks first, naming the count, and does nothing when the answer is no', async () => {
    mount();
    await settle(250);
    await actOn(ONE, 'Delete');
    await actOn(TWO, 'Delete');
    await openFolder('Trash');
    expect(subjects()).toHaveLength(2);

    note().querySelector('.btn').click();
    await settle(50);
    expect(dialog()).not.toBe(null);
    expect(dialog().textContent).toContain('2 messages will be deleted permanently');
    // Cancel is the first button, which is also where focus lands.
    dialog().querySelector('.confirm-actions .btn').click();
    await settle(250);
    expect(dialog()).toBe(null);
    expect(subjects()).toHaveLength(2);
  });

  it('deletes every message in the folder for good', async () => {
    mount();
    await settle(250);
    await actOn(ONE, 'Delete');
    await actOn(TWO, 'Delete');
    await openFolder('Trash');

    note().querySelector('.btn').click();
    await settle(50);
    dialog().querySelector('.btn-danger').click();
    await settle(400);

    expect(subjects()).toEqual([]);
    expect(root.querySelector('.msglist').textContent).toContain('Trash is empty.');
    expect(note()).toBe(null);
    expect(lastToast()).toContain('Trash emptied.');
    // Gone from the filesystem, not only from the list.
    const days = await fs.readdir('/sample/.mail/trash').catch(() => []);
    let left = 0;
    for (const day of days) left += (await fs.readdir(`/sample/.mail/trash/${day.name}`)).length;
    expect(left).toBe(0);
    // And not back in the inbox either.
    await openFolder('Inbox');
    expect(subjects()).not.toContain(ONE);
    expect(subjects()).not.toContain(TWO);
  });

  it('hands the keyboard to the folder toolbar once the rows are gone', async () => {
    mount();
    await settle(250);
    await actOn(ONE, 'Delete');
    await openFolder('Trash');
    const button = note().querySelector('.btn');
    button.focus();
    button.click();
    await settle(50);
    dialog().querySelector('.btn-danger').click();
    await settle(400);
    expect(document.activeElement.getAttribute('aria-label')).toBe('Refresh this folder');
  });
});

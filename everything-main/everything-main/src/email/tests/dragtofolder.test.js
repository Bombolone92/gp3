import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';

/**
 * Dragging rows onto a folder in the sidebar. The drag events are dispatched
 * by hand -- happy-dom has no drag and drop of its own -- so what is checked
 * is the wiring: what a drop moves, where it may land, and the way back.
 */

const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

let root;

const mount = () => {
  const { fs, mailPath, objectsPath } = createSampleMailbox();
  renderApp(root, {
    fs, mailPath, objectsPath, sample: true, account: { username: 'sample' },
  });
};

const rows = () => [...root.querySelectorAll('.row')].filter((row) => !row.hidden);
const subjects = () => rows().map((row) => row.querySelector('.row-subject').textContent);
const nav = (label) => [...root.querySelectorAll('.nav-item')]
  .find((item) => item.textContent.includes(label));
const openFolder = async (label) => {
  nav(label).click();
  await settle();
};
const lastToast = () => [...document.querySelectorAll('.toast')].pop()?.textContent ?? '';

const dragEvent = (type) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  event.dataTransfer = { setData: () => {}, effectAllowed: '', dropEffect: '' };
  return event;
};

const drag = async (row, label) => {
  row.dispatchEvent(dragEvent('dragstart'));
  const over = dragEvent('dragover');
  nav(label).dispatchEvent(over);
  const accepted = over.defaultPrevented;
  nav(label).dispatchEvent(dragEvent('drop'));
  row.dispatchEvent(dragEvent('dragend'));
  await settle();
  return accepted;
};

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  document.querySelectorAll('.toast').forEach((node) => node.remove());
});

describe('dragging a row onto a folder', () => {
  it('archives it, with an Undo', async () => {
    mount();
    await settle(400);
    const subject = subjects()[0];
    expect(await drag(rows()[0], 'Archive')).toBe(true);
    expect(subjects()).not.toContain(subject);
    // The first row is a conversation, and a conversation moves whole.
    expect(lastToast()).toMatch(/Moved (1 message|\d+ messages) to Archive/);

    [...document.querySelectorAll('.toast-action')].pop().click();
    await settle();
    expect(subjects()).toContain(subject);
  });

  it('puts a row back unfaded when the drop is undone', async () => {
    mount();
    await settle(400);
    const row = rows()[1];
    const subject = row.querySelector('.row-subject').textContent;
    await drag(row, 'Archive');
    expect(subjects()).not.toContain(subject);

    // Undo brings the same node back, so the drag's fade has to have gone
    // with the drop rather than waiting for a `dragend` that had nothing left
    // to clear.
    [...document.querySelectorAll('.toast-action')].pop().click();
    await settle();
    const back = rows().find((r) => r.querySelector('.row-subject').textContent === subject);
    expect(back).toBeTruthy();
    expect(back.classList.contains('is-dragging')).toBe(false);
  });

  it('moves the ticked rows together when one of them is dragged', async () => {
    mount();
    await settle(400);
    const [a, b] = subjects();
    for (const row of rows().slice(0, 2)) {
      const check = row.querySelector('.row-check');
      check.checked = true;
      check.dispatchEvent(new Event('change'));
    }
    await drag(rows()[0], 'Trash');
    expect(subjects()).not.toContain(a);
    expect(subjects()).not.toContain(b);
    expect(lastToast()).toMatch(/Moved \d+ messages to Trash/);
  });

  it('refuses a folder the rows cannot go to from here', async () => {
    mount();
    await settle(400);
    const before = subjects();
    // Inbox rows cannot be dropped on Inbox or Starred.
    expect(await drag(rows()[0], 'Inbox')).toBe(false);
    expect(await drag(rows()[0], 'Starred')).toBe(false);
    expect(subjects()).toEqual(before);
  });

  it('brings a message back to the inbox from Trash, and forgets where it was', async () => {
    mount();
    await settle(400);
    const subject = subjects()[0];
    await drag(rows()[0], 'Trash');
    await openFolder('Trash');
    expect(subjects()).toEqual([subject]);
    await drag(rows()[0], 'Archive');
    expect(lastToast()).toMatch(/Moved (1 message|\d+ messages) to Archive/);

    await openFolder('Archive');
    expect(subjects()).toEqual([subject]);
    // Restore from here goes to the inbox, not back into the Trash it was
    // dragged out of.
    [...rows()[0].querySelectorAll('.row-action')]
      .find((b) => (b.getAttribute('aria-label') || '').startsWith('Restore')).click();
    await settle();
    expect(lastToast()).toMatch(/^Restored( \d+ messages)? to Inbox\./);
  });

  it('marks the folders a drag can land on while it is in the air', async () => {
    mount();
    await settle(400);
    rows()[0].dispatchEvent(dragEvent('dragstart'));
    nav('Archive').dispatchEvent(dragEvent('dragenter'));
    expect(nav('Archive').classList.contains('is-drop-target')).toBe(true);
    nav('Inbox').dispatchEvent(dragEvent('dragenter'));
    expect(nav('Inbox').classList.contains('is-drop-target')).toBe(false);
    rows()[0].dispatchEvent(dragEvent('dragend'));
    expect(nav('Archive').classList.contains('is-drop-target')).toBe(false);
  });
});

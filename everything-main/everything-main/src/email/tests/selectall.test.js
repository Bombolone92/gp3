import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { createSampleMailbox } from '../src/lib/sample.js';

/**
 * Selecting the whole folder rather than the page of it on screen. The sample
 * mailbox is listed five messages to a page here, so there is a "rest".
 */

const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

let root;

const mount = () => {
  const { fs, mailPath, objectsPath } = createSampleMailbox();
  renderApp(root, {
    fs, mailPath, objectsPath, sample: true, account: { username: 'sample' }, pageSize: 5,
  });
};

const rows = () => [...root.querySelectorAll('.row')].filter((row) => !row.hidden);
const note = () => root.querySelector('.select-note');
const meta = () => root.querySelector('.list-meta').textContent;
const tickAll = async () => {
  const box = root.querySelector('.select-all');
  box.checked = true;
  box.dispatchEvent(new Event('change'));
  await settle(50);
};
const openFolder = async (label) => {
  [...root.querySelectorAll('.nav-item')]
    .find((item) => item.textContent.includes(label))
    .click();
  await settle();
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

describe('a move of many says how far it has got', () => {
  it('counts the messages moved in the meta line while the move runs', async () => {
    // Each move is one request, and a folder of hundreds is hundreds of them
    // in a row. The rows on screen leave one by one; the rest of the folder
    // left nothing on screen at all while the toolbar went on saying how many
    // were selected.
    const { fs, mailPath, objectsPath } = createSampleMailbox();
    // Moves run a few at a time, so the seven here go in two batches; the
    // check lands between them.
    const slow = { ...fs, move: async (...args) => { await settle(120); return fs.move(...args); } };
    renderApp(root, {
      fs: slow, mailPath, objectsPath, sample: true, account: { username: 'sample' }, pageSize: 7,
    });
    await settle(400);
    await tickAll();
    root.querySelector('.list-actions [aria-label="Archive"]').click();
    await settle(170);
    expect(meta()).toMatch(/^Archiving \d+ of 7…$/);
    await settle(900);
    expect(meta()).not.toMatch(/Archiving/);
    expect(rows()).toHaveLength(0);
  });
});

describe('selecting the whole folder', () => {
  it('keeps older messages reachable after archiving only the loaded page', async () => {
    mount();
    await settle(400);
    const archived = rows().map((row) => row.querySelector('.row-subject').textContent);
    await tickAll();
    root.querySelector('.list-actions [aria-label="Archive"]').click();
    await settle(600);
    expect(rows()).toHaveLength(0);
    expect(root.querySelector('.msglist').textContent).not.toContain('No mail yet.');
    const more = root.querySelector('.btn-more');
    expect(more).not.toBeNull();
    expect(more.textContent).toBe('Load older messages');
    more.click();
    await settle(400);
    expect(rows().length).toBeGreaterThan(0);
    expect(rows().every((row) => !archived.includes(row.querySelector('.row-subject').textContent))).toBe(true);
  });

  it('is offered once every row on the page is ticked, and there is more', async () => {
    mount();
    await settle(400);
    expect(root.querySelector('.btn-more')).not.toBe(null);
    // Not in the list at all until it has something to say.
    expect(note() === null || note().hidden).toBe(true);

    await tickAll();
    expect(note().hidden).toBe(false);
    expect(note().textContent).toContain('on this page are selected');
    expect(note().querySelector('.btn').textContent).toContain('in Inbox');
  });

  it('lists the folder and selects all of it', async () => {
    mount();
    await settle(400);
    const page = rows().length;
    await tickAll();
    note().querySelector('.btn').click();
    await settle();

    expect(note().textContent).toMatch(/All \d+ messages in Inbox are selected\./);
    const total = Number(/All (\d+) messages/.exec(note().textContent)[1]);
    expect(total).toBeGreaterThan(page);
    expect(meta()).toBe(`All ${total} messages in Inbox selected`);
    expect(note().querySelector('.btn').textContent).toBe('Clear selection');
  });

  it('acts on the whole folder, not the page', async () => {
    mount();
    await settle(400);
    await tickAll();
    note().querySelector('.btn').click();
    await settle();

    [...root.querySelectorAll('.list-actions .icon-btn')]
      .find((btn) => btn.getAttribute('aria-label') === 'Archive').click();
    await settle(600);

    // Nothing left in the inbox at all, not only on the first page.
    expect(rows()).toHaveLength(0);
    expect(root.querySelector('.msglist').textContent).toContain('No mail yet.');
    await openFolder('Archive');
    expect(rows().length).toBeGreaterThan(0);
    // More than a page went across.
    expect(root.querySelector('.btn-more')).not.toBe(null);
  });

  it('goes back to a selection of rows when one is unticked', async () => {
    mount();
    await settle(400);
    await tickAll();
    note().querySelector('.btn').click();
    await settle();
    expect(meta()).toMatch(/^All /);

    const check = rows()[0].querySelector('.row-check');
    check.checked = false;
    check.dispatchEvent(new Event('change'));
    await settle(50);

    expect(meta()).toBe(`${rows().length - 1} selected`);
    expect(note().hidden).toBe(true);
  });

  it('is cleared by its own button', async () => {
    mount();
    await settle(400);
    await tickAll();
    note().querySelector('.btn').click();
    await settle();
    note().querySelector('.btn').click();
    await settle(50);
    expect(note().hidden).toBe(true);
    expect(root.querySelectorAll('.row.is-selected')).toHaveLength(0);
  });
});

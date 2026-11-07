import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderApp } from '../src/ui/app.js';
import { openCompose, isDraftSending } from '../src/ui/compose.js';
import { createSampleMailbox } from '../src/lib/sample.js';
import { createDraftStore } from '../src/lib/drafts.js';
import { memoryStorage } from '../src/lib/readstate.js';

/**
 * The Drafts folder against a composer that is still open for one of its
 * rows: the two hold the same message, and an action on one has to be an
 * action on the other.
 */

const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

let root;
let drafts;

const rows = () => [...root.querySelectorAll('.row')].filter((row) => !row.hidden);
const nav = (label) => [...root.querySelectorAll('.nav-item')].find((item) => item.textContent.includes(label));
const dockItems = () => document.querySelectorAll('.compose-dock-item').length;
const lastToast = () => [...document.querySelectorAll('.toast')].pop()?.textContent ?? '';

const mount = () => {
  const username = 'sample';
  const { fs, mailPath, objectsPath } = createSampleMailbox();
  drafts = createDraftStore(username, memoryStorage());
  renderApp(root, {
    fs, mailPath, objectsPath, sample: true, account: { username }, drafts,
    onCompose: (prefill, hooks) => openCompose({
      ...hooks, username, mailPath, prefill, drafts,
      draft: hooks?.draft ?? (prefill ? null : drafts.list()
        .find((entry) => !isDraftSending({ username, mailPath, id: entry.id })) ?? null),
    }),
  });
};

/** Start a message, give it a subject, and minimize it to the dock. */
const minimizedDraft = async () => {
  root.querySelector('.side-compose').click();
  await settle(50);
  const modal = document.querySelector('.modal-root');
  const subject = modal.querySelector('#compose-subject');
  subject.value = 'Half done';
  subject.dispatchEvent(new Event('input'));
  await settle(700);
  expect(drafts.count).toBe(1);
  modal.querySelector('[aria-label="Minimize composer"]').click();
  await settle(50);
  expect(dockItems()).toBe(1);
};

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
  globalThis.puter = { ui: {}, APIOrigin: 'https://api.example', authToken: 't', fs: { write: async () => {} } };
});

afterEach(() => {
  root.remove();
  document.querySelectorAll('.toast, .modal-root, .compose-dock').forEach((node) => node.remove());
  delete globalThis.puter;
});

describe('a draft row', () => {
  it('names a recipient the way the chip does, where the address book knows them', async () => {
    mount();
    await settle();
    // The inbox has been read, so the book knows who priya@northgate.example
    // is; nobody has ever written to or from the other address.
    drafts.save({
      id: 'd1', updated: Date.now(), attachments: 0, domain: 'puter.email',
      to: 'priya@northgate.example, nobody@nowhere.example', cc: '', subject: 'Notes', body: 'soon',
      html: '', inReplyTo: '', references: '',
    });
    nav('Drafts').click();
    await settle();
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector('.row-sender').textContent).toBe('Priya Raman, +1');
    expect(rows()[0].getAttribute('aria-label')).toContain('To Priya Raman, +1');
  });
});

describe('discarding a draft from the folder', () => {
  it('closes the composer that was minimized for it, so it cannot come back', async () => {
    mount();
    await settle();
    await minimizedDraft();

    nav('Drafts').click();
    await settle();
    expect(rows()).toHaveLength(1);
    const discard = [...rows()[0].querySelectorAll('.row-action')]
      .find((button) => (button.getAttribute('aria-label') || '').startsWith('Discard'));
    discard.click();
    await settle();

    expect(drafts.count).toBe(0);
    expect(rows()).toHaveLength(0);
    expect(dockItems()).toBe(0);
    expect(document.querySelectorAll('.modal-root')).toHaveLength(0);
    expect(lastToast()).toContain('1 message discarded.');
    // The keyboard stays in the folder rather than jumping to the Compose
    // pill that opened the dialog a while ago.
    expect(document.activeElement).not.toBe(root.querySelector('.side-compose'));
  });

  it('brings the draft back with Undo, as a row that opens a fresh composer', async () => {
    mount();
    await settle();
    await minimizedDraft();
    nav('Drafts').click();
    await settle();
    [...rows()[0].querySelectorAll('.row-action')]
      .find((button) => (button.getAttribute('aria-label') || '').startsWith('Discard')).click();
    await settle();

    [...document.querySelectorAll('.toast-action')].pop().click();
    await settle();
    expect(drafts.count).toBe(1);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector('.row-subject').textContent).toBe('Half done');

    rows()[0].click();
    await settle(50);
    const modal = document.querySelector('.modal-root:not([hidden])');
    expect(modal).toBeTruthy();
    expect(modal.querySelector('#compose-subject').value).toBe('Half done');
  });

  it('opens a minimized draft back out of the dock from its row', async () => {
    mount();
    await settle();
    await minimizedDraft();
    nav('Drafts').click();
    await settle();
    rows()[0].click();
    await settle(50);
    expect(dockItems()).toBe(0);
    expect(document.querySelectorAll('.modal-root:not([hidden])')).toHaveLength(1);
  });
});

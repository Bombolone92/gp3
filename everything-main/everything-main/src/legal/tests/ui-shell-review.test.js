// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { app } from '../src/app.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { buildSampleData } from '../src/core/sample.js';
import { today } from '../src/core/dates.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const key = (target, k, opts = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));

let shell;

beforeAll(async () => {
  globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
  }
  Element.prototype.scrollIntoView ??= function () {};
  globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
  location.hash = '#/';
  app.demo = true;
  app.store = createStore({ backend: createMemoryBackend(buildSampleData(today())), flushDelay: 0 });
  await app.store.init();
  const { buildShell } = await import('../src/ui/shell.js');
  shell = buildShell();
});

beforeEach(() => {
  document.body.replaceChildren(shell.root);
  location.hash = '#/';
});

describe('keyboard shortcuts', () => {
  it('lets type-ahead in the Create menu jump to an item without running shortcuts', async () => {
    key(document.body, 'n');
    const menu = document.querySelector('[role=menu]');
    expect(menu).not.toBe(null);
    const first = document.activeElement;
    key(first, 'n');
    expect(document.querySelector('[role=menu]')).toBe(menu);
    expect(document.activeElement.textContent).toBe('Note');
    key(document.activeElement, 'g');
    key(document.activeElement, 'm');
    await tick(5);
    expect(location.hash).toBe('#/');
  });

  it('does not open search on top of an open dialog with Ctrl+K', async () => {
    const { openDialog } = await import('../src/ui/dialog.js');
    const input = document.createElement('input');
    const { close } = openDialog({ title: 'New task', body: input });
    input.focus();
    key(input, 'k', { ctrlKey: true });
    expect(document.querySelector('dialog.palette')).toBe(null);
    close();
    key(document.body, 'k', { ctrlKey: true });
    const palette = document.querySelector('dialog.palette');
    expect(palette).not.toBe(null);
    key(palette.querySelector('input'), 'Escape');
  });

  it('still runs shortcuts while a checkbox has focus, but not while typing', async () => {
    const box = document.createElement('input');
    box.type = 'checkbox';
    const text = document.createElement('input');
    shell.main.append(box, text);
    text.focus();
    key(text, '/');
    expect(document.querySelector('dialog.palette')).toBe(null);
    box.focus();
    key(box, '/');
    const palette = document.querySelector('dialog.palette');
    expect(palette).not.toBe(null);
    key(palette.querySelector('input'), 'Escape');
    box.remove();
    text.remove();
  });
});

describe('search palette', () => {
  it('opens what was typed when Enter follows the typing immediately', async () => {
    const { openSearch } = await import('../src/ui/search.js');
    openSearch();
    const input = document.querySelector('dialog.palette input');
    input.value = 'kestrel';
    input.dispatchEvent(new Event('input'));
    key(input, 'Enter');
    await tick(5);
    const m = app.store.all('matters').find((x) => /kestrel/i.test(`${x.description} ${x.displayNumber}`));
    expect(location.hash).toBe(`#/matters/${m.id}`);
    expect(document.querySelector('dialog[open]')).toBe(null);
  });

  it('does not point the input at a removed option when nothing matches', async () => {
    const { openSearch } = await import('../src/ui/search.js');
    openSearch();
    const input = document.querySelector('dialog.palette input');
    expect(input.getAttribute('aria-activedescendant')).toBeTruthy();
    input.value = 'zzzzqqqq';
    input.dispatchEvent(new Event('input'));
    await tick(80);
    const id = input.getAttribute('aria-activedescendant');
    expect(id === null || document.getElementById(id) !== null).toBe(true);
    key(input, 'Escape');
  });
});

describe('timer', () => {
  it('keeps the timer panel\'s Start/Pause button in step when the timer changes elsewhere', async () => {
    const { toggleTimer, resetTimer, getTimer } = await import('../src/ui/timer.js');
    resetTimer();
    document.querySelector('.timer-more').click();
    let panel;
    for (let i = 0; i < 50 && !(panel = document.querySelector('.timer-panel')); i++) await tick(5);
    const startBtn = panel.querySelector('.row .btn');
    expect(startBtn.textContent).toBe('Start');
    toggleTimer(); // Shift+T, or another tab
    expect(getTimer().running).toBe(true);
    expect(startBtn.textContent).toBe('Pause');
    key(document.activeElement, 'Escape');
    resetTimer();
  });
});

describe('sync status', () => {
  it('leaves its live region alone when the status has not changed, so it is not re-announced on every edit', async () => {
    const status = document.querySelector('.sync-status');
    expect(status.textContent).toBe('Demo');
    const seen = [];
    const mo = new MutationObserver((m) => seen.push(...m));
    mo.observe(status, { childList: true, subtree: true, characterData: true });
    app.store.put('notes', { subject: 'One' });
    app.store.put('notes', { subject: 'Two' });
    await tick(20);
    mo.disconnect();
    expect(seen.length).toBe(0);
    expect(status.textContent).toBe('Demo');
  });

  it('says changes were not saved when the server refuses them while online', async () => {
    const prev = { store: app.store, demo: app.demo };
    const backend = createMemoryBackend(buildSampleData(today()));
    const put = backend.putRecords.bind(backend);
    backend.putRecords = async (name, list) => {
      if (name === 'notes') throw Object.assign(new Error('Too large'), { status: 413 });
      return put(name, list);
    };
    try {
      app.demo = false;
      app.store = createStore({ backend, flushDelay: 0 });
      await app.store.init();
      const { buildShell } = await import('../src/ui/shell.js');
      const own = buildShell();
      document.body.replaceChildren(own.root);
      const status = own.root.querySelector('.sync-status');
      app.store.put('notes', { subject: 'Refused' });
      await app.store.flush();
      await tick(20);
      expect(app.store.state.online).toBe(true);
      expect(status.textContent).not.toBe('Saved');
      expect(status.textContent).toMatch(/not saved/i);
      expect(status.title).toBe(app.store.state.error);
    } finally {
      app.store = prev.store;
      app.demo = prev.demo;
    }
  });
});

/**
 * Shared setup for the vehicles-area review tests: jsdom polyfills, a store
 * on the memory backend, and helpers to drive dialogs and views.
 */
import { app } from '../src/app.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { bucketOf } from '../src/core/schema.js';
import { buildSampleData } from '../src/core/sample.js';

export const TODAY = '2026-10-12';

export function polyfill() {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
  globalThis.requestAnimationFrame ??= window.requestAnimationFrame;
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
  Element.prototype.scrollIntoView ??= function () {};
  HTMLCanvasElement.prototype.getContext ??= () => null;
}

/** A fresh store, empty or holding the sample fleet. */
export async function freshStore({ sample = false, demo = true } = {}) {
  app.demo = demo;
  app.user = demo ? null : { username: 'me', uuid: 'u1' };
  app.team = null;
  app.today = () => TODAY;
  const seed = sample ? buildSampleData(TODAY) : { collections: {}, settings: null };
  app.store = createStore({ backend: createMemoryBackend(seed, { bucketOf }), flushDelay: 1 });
  await app.store.init();
  document.body.innerHTML = '<main></main>';
  return app.store;
}

export const settle = (ms = 10) => new Promise((r) => setTimeout(r, ms));

/** A stand-in for a picked File: jsdom's File has no text() or arrayBuffer(). */
export function fakeFile(content, name = 'data.csv') {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return {
    name,
    size: bytes.length,
    type: 'text/csv',
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

/** Choose a file in the open import dialog and wait for the preview. */
export async function chooseFile(file) {
  const input = document.querySelector('dialog[open] input[type="file"]');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
  await settle();
  return document.querySelector('dialog[open]');
}

export function clickButton(root, text) {
  const b = [...root.querySelectorAll('button')].find((x) => x.textContent.trim() === text);
  if (!b) throw new Error(`No button "${text}"`);
  b.click();
  return b;
}

/** A minimal view context for calling a view's render() directly. */
export function viewCtx({ params = {}, query = {} } = {}) {
  const disposers = [];
  const lives = [];
  const ctx = {
    params,
    query,
    live(fn, colls = 'all') {
      const node = document.createElement('div');
      const draw = () => {
        const out = fn();
        node.replaceChildren(...(Array.isArray(out) ? out.filter(Boolean) : out ? [out] : []));
      };
      draw();
      node.redraw = draw;
      lives.push({ node, draw, colls });
      return node;
    },
    onDispose: (fn) => disposers.push(fn),
    dispose: () => disposers.forEach((d) => d()),
  };
  // Mirror the view host: redraw live regions when their collections change.
  disposers.push(app.store.subscribe((changed) => lives.forEach((l) => (l.colls === 'all' || l.colls.some((c) => changed.has(c))) && l.draw())));
  return ctx;
}

/** Fill fields of the open dialog by label: pickers, dates, numbers, and text. */
export function fillDialog(values) {
  const dlg = document.querySelector('dialog[open]');
  for (const [label, value] of Object.entries(values)) {
    const lab = [...dlg.querySelectorAll('label')].find((l) => l.textContent.replace('*', '').trim() === label);
    if (!lab) throw new Error(`No field "${label}"`);
    const el = dlg.querySelector(`[id="${lab.getAttribute('for')}"]`);
    const target = el.classList.contains('picker-btn') ? el.parentElement : el;
    target.value = value ?? '';
    target.dispatchEvent(new Event('input'));
  }
  return dlg;
}

export function saveDialog() {
  const dlg = document.querySelector('dialog[open]');
  [...dlg.querySelectorAll('.dialog-foot .btn.primary')].pop().click();
  return dlg;
}

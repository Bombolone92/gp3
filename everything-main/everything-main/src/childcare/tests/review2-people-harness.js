/**
 * Boots the app's views in jsdom on the demo school, for the review2-people
 * tests. Import from a file that starts with `// @vitest-environment jsdom`.
 */
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { buildSampleData } from '../src/core/sample.js';
import { today } from '../src/core/dates.js';
import { app } from '../src/app.js';
import { tick } from './helpers.js';

// jsdom lacks these.
globalThis.requestAnimationFrame ||= (fn) => setTimeout(fn, 0);
globalThis.matchMedia ||= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
HTMLElement.prototype.scrollIntoView ||= function () {};
URL.createObjectURL ||= () => 'blob:test';
URL.revokeObjectURL ||= () => {};
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
}

export { app, tick };

/** Starts the demo store and the view host. Returns <main>. */
export async function bootViews() {
  app.demo = true;
  app.demoRole = 'director';
  const sample = buildSampleData(today());
  app.me = { guardianId: null, staffId: 'staff-1', studentIds: null };
  app.store = createStore({ backend: createMemoryBackend({ settings: sample.settings, collections: sample.collections }) });
  await app.store.init();
  const main = document.createElement('main');
  main.tabIndex = -1;
  document.body.append(main);
  const { startViews } = await import('../src/ui/viewhost.js');
  startViews(main);
  // Let the first view (its chunk loads on demand) render before any test navigates.
  for (let i = 0; i < 200 && !main.firstElementChild; i++) await tick(20);
  await tick(30);
  return main;
}

export function asFamily(guardian) {
  app.demoRole = 'family';
  app.me = { guardianId: guardian.id, staffId: null, studentIds: guardian.studentIds };
}

export function asDirector() {
  app.demoRole = 'director';
  app.me = { guardianId: null, staffId: 'staff-1', studentIds: null };
}

/** Navigates and waits for the new view (its chunk may still be loading). */
export async function go(hash) {
  const main = document.querySelector('main');
  const before = main.firstElementChild;
  location.hash = hash;
  for (let i = 0; i < 100 && main.firstElementChild === before; i++) await tick(20);
  await tick(30);
}

export async function type(input, value) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick(200);
  await tick(20);
}

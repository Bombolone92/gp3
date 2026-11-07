import { Store } from '../../src/data/store.js';
import { memoryBackend, memoryKv } from '../../src/data/backend.js';
import { memoryJournal } from '../../src/data/journal.js';
import { App } from '../../src/ui/app.js';
import { resetPrefs } from '../../src/ui/prefs.js';

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** Mount the app on a fresh in-memory store. */
let current = null;

export async function mountApp({ env = 'web', onSignOut = () => {}, user = { username: 'ada' } } = {}) {
  current?.destroy();
  localStorage.clear();
  resetPrefs();
  history.replaceState(null, '', '/#/');
  document.body.replaceChildren();
  const root = document.createElement('div');
  root.id = 'app';
  const live = document.createElement('div');
  live.id = 'live-region';
  document.body.append(root, live);
  const store = new Store({ backend: memoryBackend(), kv: memoryKv(), journal: memoryJournal(), user: user.username });
  await store.init();
  const app = new App(root, { store, user, env, onSignOut });
  app.start();
  current = app;
  await tick();
  return { app, store, root };
}

/** Open a base and wait for its first view. */
export async function openBase(app, id) {
  location.hash = `/${id}`;
  await app.route();
  await tick(5);
  return app.page;
}

export function key(el, k, opts = {}) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
}

export function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

/**
 * DOM harness for the billing, reports, calendar, menus, and settings views:
 * a director (or family) demo store on the in-memory backend and a view
 * context whose live regions redraw when their collections change, like
 * ui/viewhost.js.
 */
import { app } from '../src/app.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { today as todayISO } from '../src/core/dates.js';
import { liveRegion } from '../src/ui/viewhost.js';

if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
}

// jsdom has no object URLs; downloadText() revokes its URL a second later.
if (typeof URL.revokeObjectURL !== 'function') URL.revokeObjectURL = () => {};

export async function setupApp({ collections = {}, settings, role = 'director', today = '2026-10-12', me } = {}) {
  app.demo = true;
  app.demoRole = role;
  app.team = null;
  app.me = me || { guardianId: null, staffId: null, studentIds: null };
  app.today = today ? () => today : () => todayISO();
  const backend = createMemoryBackend({ collections, settings });
  app.store = createStore({ backend, flushDelay: 0 });
  await app.store.init();
  document.body.replaceChildren();
  return { store: app.store, backend };
}

export function viewCtx(params = {}, query = {}) {
  return {
    params,
    query,
    live(fn, colls = 'all') {
      const node = liveRegion(fn);
      const draw = node.redraw;
      app.store.subscribe((changed) => {
        if (node.isConnected && (colls === 'all' || colls.some((c) => [...changed].includes(c)))) draw();
      });
      return node;
    },
    onDispose() {},
  };
}

/** Render a view module into the document; returns its root node. */
export function mountView(mod, params, query) {
  const out = mod.render(viewCtx(params, query));
  const node = out instanceof Node ? out : out.node;
  document.body.append(node);
  return node;
}

export const button = (text, root = document) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim().includes(text));

/** The text of the file that `trigger` downloads with downloadText(). */
export async function downloaded(trigger) {
  let blob = null;
  const { createObjectURL, revokeObjectURL } = URL;
  URL.createObjectURL = (b) => ((blob = b), '#download');
  URL.revokeObjectURL = () => {};
  try {
    trigger();
  } finally {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  }
  if (!blob) return null;
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsText(blob);
  });
}

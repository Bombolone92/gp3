/**
 * Shared setup for the check-in, kiosk, home and activity view tests: an
 * in-memory store on `app`, and a view ctx with the view host's live
 * regions.
 */
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { app } from '../src/app.js';
import { liveRegion } from '../src/ui/viewhost.js';

// jsdom has <dialog> but not its modal methods.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
}

export async function setupStore(collections = {}) {
  const store = createStore({ backend: createMemoryBackend({ collections }), flushDelay: 1 });
  await store.init();
  Object.assign(app, { store, demo: true, demoRole: 'director', team: null, kioskLock: false, me: { guardianId: null, staffId: null, studentIds: null } });
  return store;
}

export function makeCtx(query = {}) {
  const lives = [];
  const disposers = [];
  const ctx = {
    params: {},
    query,
    live(renderFn, colls = 'all', tag = 'div') {
      const node = liveRegion(renderFn, tag);
      lives.push({ node, draw: node.redraw });
      return node;
    },
    onDispose(fn) {
      disposers.push(fn);
    },
  };
  const off = app.store.subscribe(() => {
    for (const l of lives) if (l.node.isConnected) l.draw();
  });
  ctx.dispose = () => {
    off();
    for (const d of disposers) d();
  };
  return ctx;
}

/** Mount a view's output into the document. */
export function mount(out) {
  const node = out instanceof Node ? out : out.node;
  const main = document.createElement('main');
  main.append(node);
  document.body.replaceChildren(main);
  return main;
}

export const settle = () => new Promise((r) => setTimeout(r, 0));

export const byText = (root, sel, text) => [...root.querySelectorAll(sel)].find((n) => n.textContent.includes(text));

/**
 * Mounts the view for the current route into <main>. Views are code-split
 * modules exporting render(ctx), which returns a node or
 * { node, title, dirty?(), dispose?() }.
 *
 * ctx.live(renderFn, collections) returns a container that re-renders itself
 * (at most once per frame) when any of those collections change. Only that
 * region redraws, so inputs elsewhere on the page keep focus. renderFn gets
 * a context for subscriptions made while drawing; they end at the next redraw.
 */
import { h, rafThrottle } from './dom.js';
import { route, onRoute, startRouter, currentRoute } from './router.js';
import { app } from '../app.js';
import { confirmDialog } from './dialog.js';
import { emptyState } from './components.js';

export const APP_NAME = 'Legal';

const VIEWS = {
  dashboard: () => import('../views/dashboard.js'),
  calendar: () => import('../views/calendar.js'),
  tasks: () => import('../views/tasks.js'),
  matters: () => import('../views/matters.js'),
  stages: () => import('../views/stages.js'),
  'matter-form': () => import('../views/matter-form.js'),
  matter: () => import('../views/matter-detail.js'),
  contacts: () => import('../views/contacts.js'),
  'contact-form': () => import('../views/contact-form.js'),
  contact: () => import('../views/contact-detail.js'),
  activities: () => import('../views/activities.js'),
  billing: () => import('../views/billing.js'),
  'bill-generate': () => import('../views/bill-generate.js'),
  bill: () => import('../views/bill-detail.js'),
  accounts: () => import('../views/accounts.js'),
  documents: () => import('../views/documents.js'),
  communications: () => import('../views/communications.js'),
  reports: () => import('../views/reports.js'),
  settings: () => import('../views/settings.js'),
};

export function defineRoutes() {
  route('/', 'dashboard');
  route('/calendar', 'calendar');
  route('/tasks', 'tasks');
  route('/matters', 'matters');
  route('/matters/stages', 'stages');
  route('/matters/new', 'matter-form');
  route('/matters/:id/edit', 'matter-form');
  route('/matters/:id', 'matter');
  route('/contacts', 'contacts');
  route('/contacts/new', 'contact-form');
  route('/contacts/:id/edit', 'contact-form');
  route('/contacts/:id', 'contact');
  route('/activities', 'activities');
  route('/billing', 'billing');
  route('/billing/new', 'bill-generate');
  route('/billing/:tab', 'billing');
  route('/bills/:id', 'bill');
  route('/accounts', 'accounts');
  route('/accounts/:id', 'accounts');
  route('/documents', 'documents');
  route('/documents/:tab', 'documents');
  route('/communications', 'communications');
  route('/reports', 'reports');
  route('/reports/:report', 'reports');
  route('/settings', 'settings');
  route('/settings/:section', 'settings');
}

let leaving = false;
let pageDirty = () => false;

/** Whether the open page has edits its form has not saved yet. */
export const hasUnsavedEdits = () => pageDirty();

/** Let the page unload without the browser's "Leave site?" prompt, once the person has already confirmed. */
export function allowUnload() {
  leaving = true;
}

export function startViews(main) {
  let active = null; // { dispose, dirty, lives }
  pageDirty = () => !!active?.dirty?.();
  let token = 0;
  let lastHash = location.hash;
  let ignoreNext = false;
  let asking = false;

  const changedColls = new Set();
  const flushLive = rafThrottle(() => {
    if (!active) return;
    const changed = new Set(changedColls);
    changedColls.clear();
    for (const l of [...active.lives]) {
      if (!l.node.isConnected) continue;
      if (l.colls === 'all' || l.colls.some((c) => changed.has(c))) l.draw();
    }
  });
  app.store.subscribe((changed) => {
    if (changed.size === 1 && changed.has('sync')) return;
    for (const c of changed) changedColls.add(c);
    flushLive();
  });

  async function show(r) {
    if (ignoreNext) {
      ignoreNext = false;
      return;
    }
    // Already asking: that answer applies to this newer address as well.
    if (asking) return;
    if (active?.dirty?.()) {
      asking = true;
      const leave = await confirmDialog({
        title: 'Discard unsaved changes?',
        message: 'You have changes on this page that have not been saved.',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        danger: true,
      });
      asking = false;
      if (!leave) {
        // Put the address back. A link to this same page never changed it,
        // and no hashchange would come to clear the flag.
        if (location.hash !== lastHash) {
          ignoreNext = true;
          location.hash = lastHash;
        }
        return;
      }
      r = currentRoute(); // the address may have moved on while asking
    }
    lastHash = location.hash;
    const my = ++token;
    const loader = VIEWS[r.name];
    let mod = null;
    let loadError = null;
    if (loader) {
      try {
        mod = await loader();
      } catch (err) {
        // Offline, or a new version replaced this screen's file.
        console.error(err);
        loadError = err;
      }
    }
    if (my !== token) return;
    active?.dispose?.();
    const lives = [];
    const disposers = [];
    // A context whose subscriptions go into `bucket`. Each live region hands
    // its render function a context of its own, emptied before every redraw,
    // so whatever a redraw subscribes to replaces (not adds to) the last one.
    const makeCtx = (bucket) => ({
      params: r.params,
      query: r.query,
      route: r,
      live(renderFn, colls = 'all', tag = 'div') {
        const node = h(tag);
        const inner = [];
        const release = () => {
          for (const d of inner.splice(0)) d();
        };
        const draw = () => {
          release();
          const out = renderFn(makeCtx(inner));
          const path = focusPath(node);
          node.replaceChildren(...(Array.isArray(out) ? out.filter(Boolean) : out ? [out] : []));
          if (path) refocus(node, path);
        };
        draw();
        node.redraw = draw;
        const entry = { node, draw, colls };
        lives.push(entry);
        bucket.push(() => {
          release();
          const i = lives.indexOf(entry);
          if (i >= 0) lives.splice(i, 1);
        });
        return node;
      },
      /** Run fn when any of these collections change (for views that patch themselves). */
      watch(colls, fn) {
        const set = new Set(colls);
        const off = app.store.subscribe((changed) => [...changed].some((c) => set.has(c)) && fn(changed));
        bucket.push(off);
      },
      onDispose(fn) {
        bucket.push(fn);
      },
    });
    const ctx = makeCtx(disposers);
    let out;
    try {
      out = mod ? mod.render(ctx) : loadError ? crashed(loadError) : notFound();
    } catch (err) {
      console.error(err);
      out = crashed(err);
    }
    const view = out instanceof Node ? { node: out } : out || { node: notFound() };
    active = {
      lives,
      dirty: view.dirty,
      dispose: () => {
        view.dispose?.();
        for (const d of disposers) d();
      },
    };
    main.replaceChildren(view.node);
    main.scrollTop = 0;
    const title = view.title || main.querySelector('h1')?.textContent || APP_NAME;
    document.title = `${title} · ${APP_NAME}`;
    // Move focus for keyboard and screen reader users, without scrolling.
    if (!document.activeElement || document.activeElement === document.body || !main.contains(document.activeElement)) {
      if (!document.querySelector('dialog[open]')) main.focus({ preventScroll: true });
    }
  }

  window.addEventListener('beforeunload', (e) => {
    if (leaving) return;
    if (active?.dirty?.() || app.store.pendingCount()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  defineRoutes();
  onRoute(show);
  startRouter();
  return { current: currentRoute };
}

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]';

/** Child indexes from root down to the focused element, if it is inside root. */
function focusPath(root) {
  let el = document.activeElement;
  if (!el || el === root || !root.contains(el)) return null;
  const path = [];
  for (; el !== root; el = el.parentElement) path.unshift([...el.parentElement.children].indexOf(el));
  return path;
}

/**
 * A redraw replaced the focused element. Focus its counterpart in the new
 * content (same position; after a removal that is the next item), else the
 * nearest focusable thing around that position, so keyboard users keep their
 * place instead of being sent back to the top of the page.
 */
function refocus(root, path) {
  let el = root;
  for (const i of path) {
    const next = el.children[Math.min(i, el.children.length - 1)];
    if (!next) break;
    el = next;
  }
  for (; el && el !== root; el = el.parentElement) {
    const target = el.matches(FOCUSABLE) ? el : el.querySelector(FOCUSABLE);
    if (target) return target.focus({ preventScroll: true });
  }
  root.querySelector(FOCUSABLE)?.focus({ preventScroll: true });
}

function notFound() {
  return h(
    'div.page',
    emptyState({
      icon: 'search',
      title: 'Page not found',
      text: 'The page you were looking for does not exist or was deleted.',
      headingLevel: 1,
      actions: [h('a.btn.primary', { href: '#/' }, 'Go to dashboard')],
    }),
  );
}

function crashed(err) {
  return h(
    'div.page',
    emptyState({
      icon: 'alert',
      title: 'Something went wrong',
      text: `This page failed to load. ${err?.message || ''}`,
      headingLevel: 1,
      actions: [h('button.btn', { type: 'button', onClick: () => location.reload() }, 'Reload')],
    }),
  );
}

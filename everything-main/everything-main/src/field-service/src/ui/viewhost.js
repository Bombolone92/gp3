/**
 * Mounts the view for the current route into <main>. Views are code-split
 * modules exporting `render(ctx)` which returns a node or
 * { node, title, dirty?(), dispose?() }.
 *
 * ctx.live(renderFn, collections) returns a container that re-renders
 * itself (at most once per frame) when any of those collections change.
 * Only the region re-renders, so inputs elsewhere on the page keep focus.
 */
import { h, rafThrottle, keepFocus } from './dom.js';
import { route, onRoute, startRouter, currentRoute } from './router.js';
import { app } from '../app.js';
import { confirmDialog } from './dialog.js';
import { emptyState } from './components.js';
import { closeMenu } from './menu.js';

const VIEWS = {
  home: () => import('../views/home.js'),
  schedule: () => import('../views/schedule.js'),
  clients: () => import('../views/clients.js'),
  'client-form': () => import('../views/client-form.js'),
  client: () => import('../views/client-detail.js'),
  requests: () => import('../views/requests.js'),
  'request-form': () => import('../views/request-form.js'),
  request: () => import('../views/request-detail.js'),
  quotes: () => import('../views/quotes.js'),
  'quote-form': () => import('../views/quote-form.js'),
  quote: () => import('../views/quote-detail.js'),
  jobs: () => import('../views/jobs.js'),
  'job-form': () => import('../views/job-form.js'),
  job: () => import('../views/job-detail.js'),
  invoices: () => import('../views/invoices.js'),
  'invoice-form': () => import('../views/invoice-form.js'),
  invoice: () => import('../views/invoice-detail.js'),
  payments: () => import('../views/payments.js'),
  timesheets: () => import('../views/timesheets.js'),
  expenses: () => import('../views/expenses.js'),
  reports: () => import('../views/reports.js'),
  settings: () => import('../views/settings.js'),
};

export function defineRoutes() {
  route('/', 'home');
  route('/schedule', 'schedule');
  for (const [base, single] of [
    ['clients', 'client'],
    ['requests', 'request'],
    ['quotes', 'quote'],
    ['jobs', 'job'],
    ['invoices', 'invoice'],
  ]) {
    route(`/${base}`, base);
    route(`/${base}/new`, `${single}-form`);
    route(`/${base}/:id/edit`, `${single}-form`);
    route(`/${base}/:id`, single);
  }
  route('/payments', 'payments');
  route('/timesheets', 'timesheets');
  route('/expenses', 'expenses');
  route('/reports', 'reports');
  route('/settings', 'settings');
  route('/settings/:section', 'settings');
}

const fieldKey = (el) => el.getAttribute('aria-label') || el.name || el.placeholder || '';

export function startViews(main) {
  let active = null; // { dispose, dirty, lives }
  let token = 0;
  let lastHash = location.hash;
  let ignoreNext = false;
  let asking = null; // { r }: the page to go to once "Discard?" is answered

  const changedColls = new Set();
  const flushLive = rafThrottle(() => {
    if (!active) return;
    const changed = new Set(changedColls);
    changedColls.clear();
    for (const l of active.lives) {
      if (!l.node.isConnected) continue;
      if (l.colls === 'all' || l.colls.some((c) => changed.has(c))) l.draw();
    }
  });
  app.store.subscribe((changed) => {
    for (const c of changed) changedColls.add(c);
    flushLive();
  });

  async function show(r) {
    if (ignoreNext) {
      ignoreNext = false;
      return;
    }
    // Back pressed again while asking: one question, about the latest page.
    if (asking) {
      asking.r = r;
      return;
    }
    if (active?.dirty?.()) {
      asking = { r };
      const leave = await confirmDialog({
        title: 'Discard unsaved changes?',
        message: 'You have changes on this page that have not been saved.',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        danger: true,
      });
      r = asking.r;
      asking = null;
      if (!leave) {
        // A link to the page already open changes no hash, so putting it
        // back fires no hashchange to skip.
        if (location.hash !== lastHash) {
          ignoreNext = true;
          location.hash = lastHash;
        }
        return;
      }
    }
    lastHash = location.hash;
    // Nothing from the previous page stays open over the next one (browser
    // Back, a link inside a dialog). A dialog that must not close (one that
    // blocks while copying data) refuses its cancel event.
    closeMenu();
    for (const d of document.querySelectorAll('dialog[open]')) d.dispatchEvent(new Event('cancel', { cancelable: true }));
    const my = ++token;
    const loader = VIEWS[r.name];
    let mod = null;
    let loadError = null;
    if (loader) {
      try {
        mod = await loader();
      } catch (err) {
        // Usually offline, or a new version was deployed since this tab opened.
        console.error(err);
        loadError = err;
      }
    }
    if (my !== token) return;
    active?.dispose?.();
    const lives = [];
    const disposers = [];
    const ctx = {
      params: r.params,
      query: r.query,
      route: r,
      live(renderFn, colls = 'all', tag = 'div') {
        const node = h(tag);
        const draw = () => {
          // Someone typing in this region (a note, a checklist item) must not
          // lose their text or place when it redraws for a sync.
          const el = document.activeElement;
          const typing = el && node.contains(el) && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|email|tel|url|number)$/.test(el.type)));
          const keep = typing ? { key: fieldKey(el), value: el.value, start: el.selectionStart, end: el.selectionEnd } : null;
          const paint = () => {
            const out = renderFn();
            node.replaceChildren(...(Array.isArray(out) ? out.filter(Boolean) : out ? [out] : []));
          };
          // A button just used (Mark approved, Mark complete) is replaced
          // too: keep focus in the same place rather than losing it.
          if (!typing) return keepFocus(node, paint);
          paint();
          if (keep?.key) {
            const next = [...node.querySelectorAll('textarea, input')].find((x) => fieldKey(x) === keep.key);
            if (next) {
              next.value = keep.value;
              next.focus();
              try {
                next.setSelectionRange(keep.start, keep.end);
              } catch {}
            }
          }
        };
        draw();
        node.redraw = draw;
        lives.push({ node, draw, colls });
        return node;
      },
      onDispose(fn) {
        disposers.push(fn);
      },
    };
    let out;
    try {
      out = mod ? mod.render(ctx) : loadError ? crashed(null, 'This page could not be loaded. Check your connection and reload. If the app was just updated, reloading picks up the new version.') : notFound();
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
    const title = view.title || main.querySelector('h1')?.textContent || 'Field Service';
    document.title = `${title} · Field Service`;
    // Move focus for keyboard and screen reader users, without scrolling.
    if (document.activeElement === document.body || !document.activeElement || main.contains(document.activeElement) === false) {
      if (!document.querySelector('dialog[open]')) main.focus({ preventScroll: true });
    }
  }

  window.addEventListener('beforeunload', (e) => {
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

function notFound() {
  return h(
    'div.page',
    emptyState({
      icon: 'search',
      title: 'Page not found',
      text: 'The page you were looking for does not exist or was deleted.',
      headingLevel: 1,
      actions: [h('a.btn.primary', { href: '#/' }, 'Go home')],
    }),
  );
}

function crashed(err, text = `This page failed to load. ${err?.message || ''}`) {
  return h(
    'div.page',
    emptyState({
      icon: 'alert',
      title: 'Something went wrong',
      text,
      headingLevel: 1,
      actions: [h('button.btn', { type: 'button', onClick: () => location.reload() }, 'Reload')],
    }),
  );
}

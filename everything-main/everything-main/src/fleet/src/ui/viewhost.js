/**
 * Mounts the view for the current route into <main>. Views are code-split
 * modules exporting `render(ctx)` which returns a node or
 * { node, title, dirty?(), dispose?() }.
 *
 * ctx.live(renderFn, collections) returns a container that re-renders
 * itself (at most once per frame) when any of those collections change.
 * Only the region re-renders, so inputs elsewhere on the page keep focus.
 */
import { h, rafThrottle } from './dom.js';
import { route, onRoute, startRouter, currentRoute } from './router.js';
import { app, reloadApp } from '../app.js';
import { confirmDialog } from './dialog.js';
import { emptyState } from './components.js';
import { closeMenu } from './menu.js';

const VIEWS = {
  dashboard: () => import('../views/dashboard.js'),
  vehicles: () => import('../views/vehicles.js'),
  'vehicle-form': () => import('../views/vehicle-form.js'),
  vehicle: () => import('../views/vehicle-detail.js'),
  assignments: () => import('../views/assignments.js'),
  meters: () => import('../views/meters.js'),
  expenses: () => import('../views/expenses.js'),
  inspections: () => import('../views/inspections.js'),
  'inspection-start': () => import('../views/inspection-run.js'),
  inspection: () => import('../views/inspection-detail.js'),
  failures: () => import('../views/failures.js'),
  'inspection-forms': () => import('../views/inspection-forms.js'),
  'inspection-form': () => import('../views/inspection-form-builder.js'),
  issues: () => import('../views/issues.js'),
  'issue-form': () => import('../views/issue-form.js'),
  issue: () => import('../views/issue-detail.js'),
  reminders: () => import('../views/reminders.js'),
  'reminder-form': () => import('../views/reminder-form.js'),
  reminder: () => import('../views/reminder-detail.js'),
  renewals: () => import('../views/renewals.js'),
  service: () => import('../views/service.js'),
  'service-form': () => import('../views/service-form.js'),
  'service-entry': () => import('../views/service-detail.js'),
  'work-orders': () => import('../views/work-orders.js'),
  'work-order-form': () => import('../views/service-form.js'),
  'work-order': () => import('../views/work-order-detail.js'),
  'service-tasks': () => import('../views/service-tasks.js'),
  'service-programs': () => import('../views/service-programs.js'),
  'service-program': () => import('../views/service-program.js'),
  contacts: () => import('../views/contacts.js'),
  'contact-form': () => import('../views/contact-form.js'),
  contact: () => import('../views/contact-detail.js'),
  vendors: () => import('../views/vendors.js'),
  'vendor-form': () => import('../views/vendor-form.js'),
  vendor: () => import('../views/vendor-detail.js'),
  parts: () => import('../views/parts.js'),
  'part-form': () => import('../views/part-form.js'),
  part: () => import('../views/part-detail.js'),
  'purchase-orders': () => import('../views/purchase-orders.js'),
  'purchase-order-form': () => import('../views/purchase-order-form.js'),
  'purchase-order': () => import('../views/purchase-order-detail.js'),
  fuel: () => import('../views/fuel.js'),
  'fuel-form': () => import('../views/fuel-form.js'),
  documents: () => import('../views/documents.js'),
  reports: () => import('../views/reports.js'),
  report: () => import('../views/report.js'),
  settings: () => import('../views/settings.js'),
};

export function defineRoutes() {
  route('/', 'dashboard');
  const crud = (base, list, single, form) => {
    route(`/${base}`, list);
    route(`/${base}/new`, form);
    route(`/${base}/:id/edit`, form);
    route(`/${base}/:id`, single);
  };
  crud('vehicles', 'vehicles', 'vehicle', 'vehicle-form');
  route('/assignments', 'assignments');
  route('/meters', 'meters');
  route('/expenses', 'expenses');
  route('/inspections', 'inspections');
  route('/inspections/start', 'inspection-start');
  route('/inspections/:id', 'inspection');
  route('/failures', 'failures');
  route('/inspection-forms', 'inspection-forms');
  route('/inspection-forms/new', 'inspection-form');
  route('/inspection-forms/:id', 'inspection-form');
  crud('issues', 'issues', 'issue', 'issue-form');
  crud('reminders', 'reminders', 'reminder', 'reminder-form');
  route('/renewals', 'renewals');
  route('/contact-renewals', 'renewals');
  crud('service', 'service', 'service-entry', 'service-form');
  crud('work-orders', 'work-orders', 'work-order', 'work-order-form');
  route('/service-tasks', 'service-tasks');
  route('/service-programs', 'service-programs');
  route('/service-programs/new', 'service-program');
  route('/service-programs/:id', 'service-program');
  crud('contacts', 'contacts', 'contact', 'contact-form');
  crud('vendors', 'vendors', 'vendor', 'vendor-form');
  crud('parts', 'parts', 'part', 'part-form');
  crud('purchase-orders', 'purchase-orders', 'purchase-order', 'purchase-order-form');
  route('/fuel', 'fuel');
  route('/fuel/new', 'fuel-form');
  route('/fuel/:id', 'fuel-form');
  route('/documents', 'documents');
  route('/reports', 'reports');
  route('/reports/:id', 'report');
  route('/settings', 'settings');
  route('/settings/:section', 'settings');
}

// Cleanups registered by components while the current view is showing.
let leaving = [];

/** Run fn when the current view is replaced (unsubscribe, observers...). */
export function onLeave(fn) {
  if (typeof fn === 'function') leaving.push(fn);
}

export function startViews(main) {
  let active = null; // { dispose, dirty, lives }
  let token = 0;
  let lastHash = location.hash;
  let ignoreNext = false;
  let confirming = false;

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
    for (const c of changed) if (c !== 'sync') changedColls.add(c);
    if (changedColls.size) flushLive();
  });

  async function show(r) {
    if (ignoreNext) {
      ignoreNext = false;
      return;
    }
    // A prompt is already open (Back pressed twice): it decides, using the
    // latest URL when it closes.
    if (confirming) return;
    if (active?.dirty?.()) {
      confirming = true;
      let leave;
      try {
        leave = await confirmDialog({
          title: 'Discard unsaved changes?',
          message: 'You have changes on this page that have not been saved.',
          confirmLabel: 'Discard changes',
          cancelLabel: 'Keep editing',
          danger: true,
        });
      } finally {
        confirming = false;
      }
      if (!leave) {
        // Restoring the URL fires one hashchange to skip. A link to the page
        // already showing changes nothing, and must not swallow the next one.
        if (location.hash !== lastHash) {
          ignoreNext = true;
          location.hash = lastHash;
        }
        return;
      }
      r = currentRoute();
    }
    lastHash = location.hash;
    const my = ++token;
    const loader = VIEWS[r.name];
    let mod = null;
    if (loader) {
      try {
        mod = await loader();
      } catch (err) {
        console.error(err);
        mod = { render: () => crashed(err) };
      }
    }
    if (my !== token) return;
    // A menu or popover left open (Back pressed while it was showing) would
    // keep its anchor expanded and its key and pointer listeners alive.
    closeMenu();
    active?.dispose?.();
    for (const fn of leaving.splice(0)) {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    }
    const lives = [];
    const disposers = [];
    const ctx = {
      params: r.params,
      query: r.query,
      route: r,
      live(renderFn, colls = 'all', tag = 'div') {
        const node = h(tag);
        const draw = () => {
          const out = renderFn();
          node.replaceChildren(...(Array.isArray(out) ? out.filter(Boolean) : out ? [out] : []));
        };
        draw();
        node.redraw = draw;
        lives.push({ node, draw, colls });
        return node;
      },
      onDispose(fn) {
        if (typeof fn === 'function') disposers.push(fn);
      },
    };
    let out;
    try {
      out = mod ? mod.render(ctx) : notFound();
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
    const title = view.title || main.querySelector('h1')?.textContent || 'Fleet';
    document.title = `${title} · Fleet`;
    // Move focus for keyboard and screen reader users, without scrolling.
    if (document.activeElement === document.body || !document.activeElement || main.contains(document.activeElement) === false) {
      if (!document.querySelector('dialog[open]')) main.focus({ preventScroll: true });
    }
  }

  window.addEventListener('beforeunload', (e) => {
    // The app's own reloads keep unsent changes in the device cache first.
    // A form's unsaved edits are not kept anywhere, so they still ask.
    const unsent = !app.reloading && app.store.pendingCount();
    app.reloading = false;
    if (active?.dirty?.() || unsent) {
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
      actions: [h('button.btn', { type: 'button', onClick: () => reloadApp() }, 'Reload')],
    }),
  );
}

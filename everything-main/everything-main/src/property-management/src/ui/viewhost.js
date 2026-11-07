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
import { app } from '../app.js';
import { confirmDialog } from './dialog.js';
import { emptyState } from './components.js';
import { closeMenu } from './menu.js';

export const VIEWS = {
  home: () => import('../views/home.js'),
  // Rentals
  properties: () => import('../views/properties/list.js'),
  'property-form': () => import('../views/properties/form.js'),
  property: () => import('../views/properties/detail.js'),
  unit: () => import('../views/properties/unit.js'),
  leases: () => import('../views/leases/list.js'),
  'lease-form': () => import('../views/leases/form.js'),
  lease: () => import('../views/leases/detail.js'),
  tenants: () => import('../views/people/tenants.js'),
  'tenant-form': () => import('../views/people/tenant-form.js'),
  tenant: () => import('../views/people/tenant.js'),
  owners: () => import('../views/people/owners.js'),
  'owner-form': () => import('../views/people/owner-form.js'),
  owner: () => import('../views/people/owner.js'),
  balances: () => import('../views/leases/balances.js'),
  // Leasing
  listings: () => import('../views/leasing/listings.js'),
  applicants: () => import('../views/leasing/applicants.js'),
  'applicant-form': () => import('../views/leasing/applicant-form.js'),
  applicant: () => import('../views/leasing/applicant.js'),
  renewals: () => import('../views/leasing/renewals.js'),
  // Accounting
  financials: () => import('../views/accounting/financials.js'),
  ledger: () => import('../views/accounting/ledger.js'),
  transaction: () => import('../views/accounting/transaction.js'),
  banking: () => import('../views/accounting/banking.js'),
  'bank-account': () => import('../views/accounting/bank-account.js'),
  bills: () => import('../views/accounting/bills.js'),
  bill: () => import('../views/accounting/bill.js'),
  accounts: () => import('../views/accounting/accounts.js'),
  account: () => import('../views/accounting/account.js'),
  budgets: () => import('../views/accounting/budgets.js'),
  budget: () => import('../views/accounting/budget.js'),
  // Maintenance
  'work-orders': () => import('../views/maintenance/work-orders.js'),
  'work-order-form': () => import('../views/maintenance/work-order-form.js'),
  'work-order': () => import('../views/maintenance/work-order.js'),
  vendors: () => import('../views/maintenance/vendors.js'),
  'vendor-form': () => import('../views/maintenance/vendor-form.js'),
  vendor: () => import('../views/maintenance/vendor.js'),
  inspections: () => import('../views/maintenance/inspections.js'),
  inspection: () => import('../views/maintenance/inspection.js'),
  // Workspace
  tasks: () => import('../views/tasks/list.js'),
  'task-form': () => import('../views/tasks/form.js'),
  task: () => import('../views/tasks/detail.js'),
  communication: () => import('../views/communication.js'),
  calendar: () => import('../views/calendar.js'),
  reports: () => import('../views/reports/index.js'),
  report: () => import('../views/reports/report.js'),
  settings: () => import('../views/settings.js'),
};

/**
 * Routes. Records with a list, a form and a detail page follow one pattern:
 *   /things            list
 *   /things/new        form (query parameters may prefill it)
 *   /things/:id/edit   form
 *   /things/:id        detail (?tab= selects a tab)
 */
export function defineRoutes() {
  route('/', 'home');
  for (const [base, single] of [
    ['properties', 'property'],
    ['leases', 'lease'],
    ['tenants', 'tenant'],
    ['owners', 'owner'],
    ['applicants', 'applicant'],
    ['work-orders', 'work-order'],
    ['vendors', 'vendor'],
    ['tasks', 'task'],
  ]) {
    route(`/${base}`, base);
    route(`/${base}/new`, `${single}-form`);
    route(`/${base}/:id/edit`, `${single}-form`);
    route(`/${base}/:id`, single);
  }
  route('/units/:id', 'unit');
  route('/balances', 'balances');
  route('/listings', 'listings');
  route('/renewals', 'renewals');
  route('/financials', 'financials');
  route('/ledger', 'ledger');
  route('/transactions/:id', 'transaction');
  route('/banking', 'banking');
  route('/banking/:id', 'bank-account');
  route('/bills', 'bills');
  route('/bills/:id', 'bill');
  route('/accounts', 'accounts');
  route('/accounts/:id', 'account');
  route('/budgets', 'budgets');
  route('/budgets/:id', 'budget');
  route('/inspections', 'inspections');
  route('/inspections/:id', 'inspection');
  route('/communication', 'communication');
  route('/calendar', 'calendar');
  route('/reports', 'reports');
  route('/reports/:id', 'report');
  route('/settings', 'settings');
  route('/settings/:section', 'settings');
}

export function startViews(main) {
  let active = null; // { dispose, dirty, lives }
  let token = 0;
  let lastHash = location.hash;
  let ignoreNext = false;

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
    if (active?.dirty?.()) {
      const leave = await confirmDialog({
        title: 'Discard unsaved changes?',
        message: 'You have changes on this page that have not been saved.',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        danger: true,
      });
      if (!leave) {
        // Put the address back. Only a real change fires a hashchange to
        // ignore; navigating to the page already open fires none, and a
        // flag left set would swallow the next real navigation.
        if (location.hash !== lastHash) {
          ignoreNext = true;
          location.hash = lastHash;
        }
        return;
      }
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
        // Usually a new version was deployed and this screen's old file is
        // gone: say so and offer a reload, not "Page not found".
        console.error(err);
        loadError = err;
      }
    }
    if (my !== token) return;
    // A menu or popover left open belongs to the page being replaced.
    closeMenu();
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
          const out = renderFn();
          node.replaceChildren(...(Array.isArray(out) ? out.filter(Boolean) : out ? [out] : []));
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
      out = mod ? mod.render(ctx) : loadError ? crashed(new Error('Check your connection, or reload to get the latest version of the app.')) : notFound();
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
    const title = view.title || main.querySelector('h1')?.textContent || 'Property Management';
    document.title = `${title} · Property Management`;
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

import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/components.css';
import './styles/forms.css';
import './styles/views.css';
import './styles/print.css';

import { el } from './ui/dom.js';
import { applyTheme } from './ui/theme.js';
import { toast } from './ui/toast.js';
import { mountShell, onCreate } from './ui/shell.js';
import { route, overlay, startRouter, navigate, rerender, currentRoute } from './ui/router.js';
import { installShortcuts, onShortcut } from './ui/shortcuts.js';
import { topLayer, confirmDialog } from './ui/dialog.js';
import { store, COLLECTIONS } from './lib/store.js';
import { Sync } from './lib/sync.js';
import { openCache } from './lib/idb.js';
import { whenReady, currentUser, profilePicture, isPuterApp } from './lib/puter.js';
import { setMoneyDefaults } from './lib/money.js';
import { setDateStyle } from './lib/dates.js';
import { loadSample } from './lib/sample.js';
import { runRecurring } from './lib/recurring-run.js';
import { authView, errorView, bootView, onboarding } from './views/auth.js';
import { renderHome } from './views/home.js';
import { emptyState } from './views/page.js';
import { openTxn, openNew, openContactForm, openItemForm, openAccountForm } from './forms/lazy.js';

const root = document.getElementById('app');
let shell = null;
let user = null;
let sync = null;

function applySettings() {
  setMoneyDefaults({ currency: store.settings.currency || 'USD' });
  setDateStyle(store.settings.dateStyle || 'mdy');
  shell?.setCompany(store.settings.company?.name);
  document.title = `${store.settings.company?.name ? `${store.settings.company.name} - ` : ''}Accounting`;
}

// ---------------------------------------------------------------- routes

route('home', (main, r) => renderHome(main, r, { user }));

/**
 * Pages other than Home load on first visit, so opening the app downloads
 * and parses only what the first screen needs.
 */
function lazy(load, name) {
  let render = null;
  let loading = null;
  return (main, r) => {
    if (render) return render(main, r);
    if (!main.querySelector('.page-loading')) main.replaceChildren(el('div.page.page-loading', { 'aria-busy': 'true' }, el('div.skeleton', { style: { width: '220px', height: '30px', marginBottom: '24px' } }), el('div.skeleton', { style: { height: '300px' } })));
    loading ||= load().then((m) => {
      render = m[name];
      rerender();
      // Entering the page focused nothing (there was no heading yet): move
      // focus to the heading now, as for any other page, unless the user has
      // since moved on or put focus somewhere else.
      const at = document.activeElement;
      if (currentRoute() === r && !topLayer() && (!at || at === document.body || at.closest('nav'))) main.querySelector('h1')?.focus({ preventScroll: true });
    }).catch(() => {
      main.replaceChildren(el('div.page', {}, emptyState({ iconName: 'offline', title: 'This page could not be loaded', text: 'Check your connection and try again.', action: el('button.btn.btn-primary', { type: 'button', onclick: () => location.reload() }, 'Reload') })));
      loading = null;
    });
    return null;
  };
}
const txnList = () => import('./views/txnlist.js');
const contacts = () => import('./views/contacts.js');
const accounts = () => import('./views/accounts.js');
const reports = () => import('./views/reports.js');
const misc = () => import('./views/misc.js');
for (const name of ['sales', 'invoices', 'estimates', 'expenses', 'bills']) route(name, lazy(txnList, 'renderTxnList'));
route('customers', lazy(contacts, 'renderContacts'));
route('vendors', lazy(contacts, 'renderContacts'));
route('customer', lazy(contacts, 'renderContact'));
route('vendor', lazy(contacts, 'renderContact'));
route('items', lazy(() => import('./views/items.js'), 'renderItems'));
route('accounts', lazy(accounts, 'renderAccounts'));
route('register', lazy(accounts, 'renderRegister'));
route('banking', lazy(() => import('./views/banking.js'), 'renderBanking'));
route('rules', lazy(() => import('./views/rules.js'), 'renderRules'));
route('reconcile', lazy(() => import('./views/reconcile.js'), 'renderReconcile'));
route('reports', lazy(reports, 'renderReportList'));
route('report', lazy(reports, 'renderReport'));
route('recurring', lazy(misc, 'renderRecurring'));
route('sales-tax', lazy(misc, 'renderSalesTax'));
route('audit', lazy(misc, 'renderAudit'));
route('settings', lazy(() => import('./views/settings.js'), 'renderSettings'));
route('notfound', (main) => main.replaceChildren(el('div.page', {}, emptyState({ title: 'Page not found', text: 'That address does not match anything in your books.', action: el('a.btn.btn-primary', { href: '#/home' }, 'Go home') }))));
overlay('txn', ([id]) => openTxn(id));
overlay('new', ([type]) => openNew(type));

let lastRoute = null;
function renderPage(r, view, { refresh = false } = {}) {
  if (!shell) return;
  const main = shell.main;
  const samePage = lastRoute && lastRoute.path === r.path;
  const scroll = refresh || samePage ? main.scrollTop : 0;
  try {
    view(main, r);
  } catch (err) {
    console.error(err);
    main.replaceChildren(el('div.page', {}, emptyState({ iconName: 'warn', title: 'Something went wrong on this page', text: String(err.message || err), action: el('a.btn', { href: '#/home' }, 'Go home') })));
  }
  shell.highlight();
  if (refresh || samePage) {
    main.scrollTop = scroll;
  } else {
    main.scrollTop = 0;
    shell.closeMobilePanel();
    // Move focus to the new page's heading so screen readers announce it,
    // unless a form or dialog is open over the page.
    requestAnimationFrame(() => { if (!topLayer()) main.querySelector('h1')?.focus({ preventScroll: true }); });
  }
  lastRoute = r;
}

// ------------------------------------------------------------- creating

onCreate((target) => {
  if (target.startsWith('@')) {
    const what = target.slice(1);
    if (what === 'customer' || what === 'vendor') openContactForm({ kind: what });
    else if (what === 'item') openItemForm();
    else if (what === 'account') openAccountForm();
    else if (what === 'import') import('./views/banking.js').then((m) => m.openBankImport());
    else if (what === 'importCustomers') import('./views/importer.js').then((m) => m.openImport('customers'));
    else if (what === 'importVendors') import('./views/importer.js').then((m) => m.openImport('vendors'));
    else if (what === 'importItems') import('./views/importer.js').then((m) => m.openImport('items'));
    return;
  }
  openNew(target);
});

function wireShortcuts() {
  installShortcuts();
  onShortcut('newInvoice', () => openNew('invoice'));
  onShortcut('newPayment', () => openNew('payment'));
  onShortcut('newEstimate', () => openNew('estimate'));
  onShortcut('newExpense', () => openNew('expense'));
  onShortcut('newCheck', () => openNew('check'));
  onShortcut('newBill', () => openNew('bill'));
  onShortcut('newJournal', () => openNew('journal'));
  onShortcut('customers', () => navigate('customers'));
  onShortcut('vendors', () => navigate('vendors'));
  onShortcut('accounts', () => navigate('accounts'));
  onShortcut('items', () => navigate('items'));
  onShortcut('banking', () => navigate('banking'));
  onShortcut('reports', () => navigate('reports'));
  onShortcut('home', () => navigate('home'));
  onShortcut('search', () => shell?.focusSearch());
  onShortcut('help', () => document.dispatchEvent(new CustomEvent('shortcuts:help')));
}

// --------------------------------------------------------------- syncing

let refreshQueued = false;
function queueRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    applySettings();
    // A form or dialog keeps its own state; the page underneath refreshes
    // when it closes.
    if (topLayer()) { pendingRefresh = true; return; }
    rerender();
  });
}
let pendingRefresh = false;
setInterval(() => { if (pendingRefresh && !topLayer()) { pendingRefresh = false; rerender(); } }, 400);

const refusedShown = new Set();

// Scheduled recurring transactions are created once per launch, and only
// after this device has caught up with the cloud: a device that is offline
// or behind would otherwise re-create an occurrence another device already
// created, and overwrite any edits made to it there.
let recurringDone = false;
function runRecurringOnce() {
  if (recurringDone || !sync?.caughtUp) return;
  recurringDone = true;
  try {
    const n = runRecurring(store);
    if (n) toast(`${n} recurring ${n === 1 ? 'transaction was' : 'transactions were'} created`);
  } catch {}
}

let pulling = false;
let lastPull = 0;
async function pull(force = false) {
  if (!sync || pulling || (!force && Date.now() - lastPull < 10000)) return;
  pulling = true;
  lastPull = Date.now();
  try {
    const { changes, full } = await sync.pull();
    if (full) store.loadRecords(full);
    else if (changes.length) store.applyChanges(changes);
    runRecurringOnce();
  } catch {
    // Offline or rate limited: the status pill says so; try again later.
  } finally {
    pulling = false;
  }
}

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('bookkeeping') : null;

// ------------------------------------------------------------------ boot

async function signOut() {
  if (isPuterApp()) return;
  if (sync?.pending) {
    toast('Saving your last changes first');
    try { await sync.flush(); } catch {}
  }
  // Signing out clears this device's copy, outbox included: anything still
  // unsent would be gone for good.
  const unsent = sync?.pending || 0;
  if (unsent) {
    const ok = await confirmDialog({
      title: 'Some changes are not saved yet',
      message: `${unsent === 1 ? '1 change' : `${unsent} changes`} could not be saved to your Puter account, perhaps because you are offline. Signing out now deletes ${unsent === 1 ? 'it' : 'them'} from this device. Stay signed in and ${unsent === 1 ? 'it is' : 'they are'} saved when the connection returns.`,
      confirmLabel: 'Sign out and discard',
      cancelLabel: 'Stay signed in',
      danger: true,
    });
    if (!ok) return;
  }
  try { await sync?.reset(); } catch {}
  window.puter?.auth.signOut();
  try { localStorage.removeItem(LAST_USER); } catch {}
  location.hash = '';
  location.reload();
}

async function boot() {
  try {
    const t = localStorage.getItem('bookkeeping:theme');
    applyTheme(t === 'light' || t === 'dark' ? t : 'system');
  } catch {}
  root.replaceChildren(bootView('Connecting to Puter'));
  let puter = null;
  try {
    puter = await whenReady();
  } catch (err) {
    // No SDK (no connection, and no cached copy): open the books from this
    // device if they were opened here before. Edits wait in the outbox.
    if (!(await bootOffline())) root.replaceChildren(errorView({ title: 'Could not reach Puter', message: err.message, onRetry: () => location.reload() }));
    return;
  }
  if (!puter.auth.isSignedIn()) {
    if (!navigator.onLine && (await bootOffline())) return;
    root.replaceChildren(authView({
      onSignIn: async () => {
        try {
          await puter.auth.signIn();
          boot();
        } catch {
          root.replaceChildren(authView({ onSignIn: () => location.reload(), error: 'Sign-in did not finish. Try again.' }));
        }
      },
    }));
    return;
  }
  user = await currentUser();
  if (!user && (await bootOffline())) return;
  try { localStorage.setItem(LAST_USER, JSON.stringify({ username: user?.username, uuid: user?.uuid })); } catch {}
  await openBooks(puter.kv);
}

const LAST_USER = 'bookkeeping:lastUser';

/** A stand-in KV for offline launches: every call fails like a dropped connection. */
const OFFLINE_KV = new Proxy({}, { get: () => async () => { throw new TypeError('offline'); } });

async function bootOffline() {
  let last = null;
  try { last = JSON.parse(localStorage.getItem(LAST_USER) || 'null'); } catch {}
  if (!last?.username) return false;
  user = last;
  const ok = await openBooks(OFFLINE_KV, { offline: true });
  if (ok) {
    toast('You are offline. Changes are kept on this device and saved when you reconnect.');
    window.addEventListener('online', () => location.reload(), { once: true });
  }
  return ok;
}

async function openBooks(kv, { offline = false } = {}) {
  root.replaceChildren(bootView(offline ? 'Opening your books from this device' : 'Opening your books'));
  const cacheName = `bookkeeping:${user?.uuid || user?.username || 'me'}`;
  const cache = await openCache(cacheName);
  sync = new Sync({ kv, cache, prefixes: Object.values(COLLECTIONS), singles: ['settings'], lockPrefix: cacheName });
  store.sync = sync;
  if (import.meta.env.DEV) window.__books = { store, sync };
  let records;
  try {
    ({ records } = await sync.start((n) => {
      const status = root.querySelector('.boot span:last-child');
      if (status) status.textContent = `Loading your books (${n} records)`;
    }));
  } catch (err) {
    if (offline) return false;
    root.replaceChildren(errorView({ title: 'Could not load your books', message: `${err.message || err}. Check your connection and try again.`, onRetry: () => location.reload() }));
    return false;
  }
  store.loadRecords(records);
  applySettings();
  if (store.settings.theme) applyTheme(store.settings.theme);

  const picture = offline ? null : await profilePicture();
  shell = mountShell(root, { user, picture, onSignOut: signOut });
  sync.on((event, detail) => {
    if (event === 'status') shell.setSync(detail);
    if (event === 'stale') pull(true);
    if (event === 'saved') channel?.postMessage('saved');
    if (event === 'refused') {
      // Said once per record; the status pill keeps showing "Not saved".
      const fresh = detail.keys.filter((k) => !refusedShown.has(k));
      for (const k of fresh) refusedShown.add(k);
      if (fresh.length) toast(`${fresh.length === 1 ? 'A change' : `${fresh.length} changes`} could not be saved to your Puter account (${detail.error?.message || 'refused'}). ${fresh.length === 1 ? 'It is' : 'They are'} kept on this device and will be retried.`);
    }
  });
  store.on(() => queueRefresh());
  document.addEventListener('company:changed', applySettings);
  wireShortcuts();

  if (!store.accounts.size && !store.settings.onboarded) {
    startRouter(renderPage);
    const o = await onboarding({ defaultName: '' });
    store.createCompany(o);
    if (o.sample) loadSample(store, { asCompany: true });
    applySettings();
    toast(o.sample ? 'Sample company ready to explore' : 'Your books are ready');
  } else {
    startRouter(renderPage);
  }

  // Stay current with other tabs and devices. Scheduled recurring
  // transactions run after the first pull that catches up (runRecurringOnce).
  pull(true);
  channel?.addEventListener('message', () => pull(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
  window.addEventListener('online', () => { sync.flush().catch(() => {}); pull(true); });
  setInterval(() => { if (document.visibilityState === 'visible') pull(); }, 60000);
  window.addEventListener('beforeunload', (e) => {
    if (sync.pending) {
      sync.flush().catch(() => {});
      e.preventDefault();
      e.returnValue = '';
    }
  });
  return true;
}

// The installed app opens without a connection: the shell comes from the
// service worker's cache and the books from IndexedDB.
if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

boot();

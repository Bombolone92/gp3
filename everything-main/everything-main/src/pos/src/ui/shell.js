import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { confirmDialog, closeAllModals } from './modal.js';
import { store } from '../lib/store.js';
import { initialOf } from '../lib/util.js';
import { syncStatusBar } from './sync-status.js';
import { wipeSampleData } from '../lib/sample.js';
import { openOnboarding } from './onboarding.js';
import { isPuterApp } from '../lib/env.js';
import { registerView } from '../views/register.js';
import { productsView } from '../views/products.js';
import { receiptsView } from '../views/receipts.js';
import { customersView } from '../views/customers.js';
import { reportsView } from '../views/reports.js';
import { settingsView, confirmSignOut } from '../views/settings.js';

const ROUTES = [
  { hash: '#/', label: 'Register', icon: 'cart', view: registerView },
  { hash: '#/products', label: 'Products', icon: 'package', view: productsView },
  { hash: '#/receipts', label: 'Receipts', icon: 'receipt', view: receiptsView },
  { hash: '#/customers', label: 'Customers', icon: 'users', view: customersView },
  { hash: '#/reports', label: 'Reports', icon: 'chart', view: reportsView },
  { hash: '#/settings', label: 'Settings', icon: 'gear', view: settingsView },
];

export function mountShell(appRoot) {
  const sampleBanner = el('div');
  const viewWrap = el('div');
  // Above every view, so "is that sale saved?" is answered wherever you are.
  const sync = syncStatusBar();
  const main = el('main.main', { id: 'main' }, sync.node, sampleBanner, viewWrap);
  let currentView = null;

  /* Sample-data banner: always visible while exploring, one-tap wipe. */
  function renderSampleBanner() {
    clear(sampleBanner);
    if (!store.settings.sampleData) return;
    sampleBanner.append(el('div.sample-banner', {},
      el('span.sample-banner-ic', { html: icon('sparkle', 14, 2.2) }),
      el('span.grow', {}, 'Sample data: explore freely, nothing here is yours'),
      el('button', {
        onclick: async () => {
          const ok = await confirmDialog({
            title: 'Start fresh?',
            message: 'All sample products and sales are removed and you set up your own store from scratch.',
            confirmLabel: 'Wipe sample data',
          });
          if (!ok) return;
          try {
            await wipeSampleData(store);
          } catch (err) {
            console.error(err);
            toast('Couldn’t wipe. Check your connection', { icon: 'wifiOff' });
            return;
          }
          openOnboarding();
        },
      }, 'Start fresh')
    ));
  }
  store.addEventListener('change', renderSampleBanner);
  renderSampleBanner();

  function routeFor(hash) {
    const clean = (hash || '#/').split('?')[0];
    return ROUTES.find((r) => r.hash === clean) || ROUTES[0];
  }

  /* Sidebar (desktop) */
  const username = store.user?.username || 'Puter user';
  const sidebarNav = el('div', { style: { display: 'contents' } });
  const sidebar = el('nav.sidebar', { 'aria-label': 'Main navigation' },
    el('div.brand', {},
      el('img', { src: './icons/icon-192.png', width: 30, height: 30, alt: '' }),
      el('span.brand-name', {}, store.settings.storeName || 'Point of Sale')
    ),
    sidebarNav,
    el('div.sidebar-spacer'),
    el('div.sidebar-user', {},
      el('span.user-avatar', {}, initialOf(username)),
      el('span.name', { title: username }, username),
      // Inside a Puter app window the platform owns the session - no sign-out.
      !isPuterApp() && el('button.icon-btn', {
        html: icon('logout', 18, 2),
        'aria-label': 'Sign out',
        title: 'Sign out',
        onclick: confirmSignOut,
      })
    )
  );
  /**
   * Two places name the store: the sidebar brand and the document title (the
   * browser tab, the installed app's window, the entry in a task switcher).
   * They're refreshed together - renaming the shop used to change the brand
   * and leave the tab on the old name until the next navigation.
   */
  function renderStoreName() {
    const label = store.settings.storeName || 'Point of Sale';
    const name = sidebar.querySelector('.brand-name');
    if (name) name.textContent = label;
    document.title = `${routeFor(location.hash).label} · ${label}`;
  }
  store.addEventListener('change', renderStoreName);

  /* Tab bar (mobile) */
  const tabbar = el('nav.tabbar', { 'aria-label': 'Main navigation' });

  function renderNav() {
    const active = routeFor(location.hash);
    clear(sidebarNav);
    clear(tabbar);
    for (const r of ROUTES) {
      sidebarNav.append(el('a.nav-item', {
        href: r.hash,
        className: `nav-item${r === active ? ' active' : ''}`,
        html: icon(r.icon, 21, 1.8),
        'aria-current': r === active ? 'page' : null,
      }, el('span', {}, r.label)));
      tabbar.append(el('a.tab-item', {
        href: r.hash,
        className: `tab-item${r === active ? ' active' : ''}`,
        html: icon(r.icon, 23, 1.8),
        'aria-current': r === active ? 'page' : null,
      }, el('span', {}, r.label)));
    }
  }

  let currentHash = null;

  function renderView() {
    // Sheets and dialogs are mounted on <body>, so they outlive the view
    // they were opened over. Navigation closes them - a payment sheet that
    // survived Back would float over a rebuilt register whose restored
    // draft holds the same items, inviting a second charge. A sheet that
    // refuses to close (its write is in flight) wins: the route change is
    // reverted, and the register stays exactly where the money is.
    if (!closeAllModals()) {
      if (currentHash && location.hash !== currentHash) location.hash = currentHash;
      return;
    }
    const route = routeFor(location.hash);
    currentView?.destroy?.();
    clear(viewWrap);
    currentView = route.view();
    viewWrap.append(currentView.node);
    renderNav();
    // A view change is a page change for assistive tech and scroll position.
    renderStoreName();
    window.scrollTo(0, 0);
    currentHash = location.hash || '#/';
  }

  window.addEventListener('hashchange', renderView);

  clear(appRoot);
  appRoot.append(el('div.shell', {}, sidebar, main, tabbar));
  renderView();
}

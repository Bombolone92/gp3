import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { confirmDialog } from './modal.js';
import { store, allObligations } from '../lib/store.js';
import { needsAttention } from '../lib/dates.js';
import { DOT } from '../lib/util.js';
import { wipeSampleData } from '../lib/sample.js';
import { openOnboarding } from './onboarding.js';
import { openContractForm } from './contract-form.js';
import { openContactForm } from './contact-form.js';
import { dashboardView } from '../views/dashboard.js';
import { contractsView } from '../views/contracts.js';
import { contractDetailView } from '../views/contract-detail.js';
import { contactsView } from '../views/contacts.js';
import { renewalsView } from '../views/renewals.js';
import { obligationsView } from '../views/obligations.js';
import { settingsView, confirmSignOut } from '../views/settings.js';

const ROUTES = [
  { path: '/', label: 'Home', icon: 'dashboard', view: dashboardView },
  { path: '/contracts', label: 'Contracts', icon: 'file-text', view: contractsView },
  { path: '/renewals', label: 'Renewals', icon: 'calendar-clock', view: renewalsView },
  { path: '/obligations', label: 'Obligations', icon: 'checklist', view: obligationsView },
  { path: '/contacts', label: 'Contacts', icon: 'users', view: contactsView },
  { path: '/settings', label: 'Settings', icon: 'gear', view: settingsView },
];

/** Contracts is ROUTES[1]; contract detail pages highlight it in the nav. */
const CONTRACTS_ROUTE = ROUTES[1];

/*
 * Whatever the document was called before the app took over — "Contract
 * Manager" from index.html, and the dev mock's own variant of it.
 */
const APP_TITLE = document.title;

/**
 * '#/contracts/abc' → { route: contracts nav entry, view: detail, param: 'abc' }
 *
 * A contract has a page of its own; a contact is a sheet over the list, so
 * '#/contacts/abc' is the same list view with the id handed to it.
 */
function resolve(hash) {
  const raw = (hash || '#/').replace(/^#/, '').split('?')[0];
  const segments = raw.split('/').filter(Boolean);
  if (segments[0] === 'contracts' && segments[1]) {
    return { route: CONTRACTS_ROUTE, view: contractDetailView, param: segments[1] };
  }
  const route = ROUTES.find((r) => r.path === `/${segments[0] || ''}`) || ROUTES[0];
  return { route, view: route.view, param: segments[1] || null };
}

export function mountShell(appRoot) {
  const sampleBanner = el('div');
  const viewWrap = el('div');
  // tabindex so the skip control below can put focus here; -1 keeps it out of
  // the tab order itself.
  const main = el('main.main', { id: 'main', tabindex: -1 }, sampleBanner, viewWrap);
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
            message: 'Everything currently in the app is removed: the sample data and anything you added while exploring.',
            confirmLabel: 'Wipe sample data',
          });
          if (!ok) return;
          try {
            await wipeSampleData(store);
          } catch (err) {
            console.error(err);
            toast('Could not wipe. Check your connection', { icon: 'wifiOff' });
            return;
          }
          openOnboarding();
        },
      }, 'Start fresh')
    ));
  }
  store.addEventListener('change', renderSampleBanner);
  renderSampleBanner();

  /*
   * Badges: renewals waiting on a decision, and obligations already overdue.
   *
   * Each is a pass over the whole book — a renewal clock worked out per
   * contract, and every obligation collected and sorted — and the nav is drawn
   * twice over (sidebar and tab bar) on every single store change. Asking each
   * row for its own count meant four of those passes per keystroke-sized edit,
   * so they are counted once and handed down.
   */
  function badgeCounts() {
    return {
      '/renewals': store.contracts.filter((c) => needsAttention(c)).length,
      '/obligations': allObligations(store.contracts)
        .filter(({ daysLeft }) => daysLeft !== null && daysLeft < 0).length,
    };
  }

  function navBadge(route, counts) {
    const n = counts[route.path] || 0;
    if (!n) return null;
    const label = route.path === '/renewals'
      ? `${n} renewal${n === 1 ? ' needs' : 's need'} attention`
      : `${n} obligation${n === 1 ? '' : 's'} overdue`;
    return el('span.nav-badge', { role: 'img', 'aria-label': label, title: label },
      n > 9 ? '9+' : String(n));
  }

  /* Sidebar (desktop) */
  const isApp = typeof puter !== 'undefined' && puter.env === 'app';
  const username = store.user?.username || 'Puter user';
  const sidebarNav = el('div', { style: { display: 'contents' } });
  const sidebar = el('nav.sidebar', { 'aria-label': 'Main navigation' },
    el('div.brand', {},
      el('img', { src: './icon-128.png', width: 30, height: 30, alt: '' }),
      'Contract Manager'
    ),
    sidebarNav,
    el('div.sidebar-spacer'),
    el('button.btn.btn-primary.sidebar-add', {
      html: icon('plus', 17, 2.2),
      onclick: () => openContractForm(),
    }, ' New contract'),
    el('div.sidebar-user', {},
      el('span.avatar', { 'aria-hidden': 'true' }, username.charAt(0).toUpperCase()),
      el('span.name', { title: username }, username),
      // Inside a Puter app the platform owns the session — no sign-out.
      !isApp && el('button.icon-btn', {
        html: icon('logout', 18, 2),
        'aria-label': 'Sign out',
        title: 'Sign out',
        onclick: confirmSignOut,
      })
    )
  );

  /* Tab bar (mobile) */
  const tabbar = el('nav.tabbar', { 'aria-label': 'Main navigation' });

  function renderNav() {
    const { route: active } = resolve(location.hash);
    const counts = badgeCounts();
    clear(sidebarNav);
    clear(tabbar);
    for (const r of ROUTES) {
      sidebarNav.append(el('a.nav-item', {
        href: `#${r.path}`,
        className: `nav-item${r === active ? ' active' : ''}`,
        html: icon(r.icon, 21, 1.8),
        'aria-current': r === active ? 'page' : null,
      }, el('span', {}, r.label), navBadge(r, counts)));
      tabbar.append(el('a.tab-item', {
        href: `#${r.path}`,
        className: `tab-item${r === active ? ' active' : ''}`,
        html: icon(r.icon, 23, 1.8),
        'aria-current': r === active ? 'page' : null,
      }, el('span', {}, r.label), navBadge(r, counts)));
    }
  }

  /*
   * The page is only ever called "Contract Manager", on every route: six
   * pages and every contract in the book share one browser tab title, one
   * bookmark name and one history entry, and a screen reader is told the
   * same thing each time the page changes under it. The name of what is on
   * screen goes first, the way a title bar is read.
   */
  function renderTitle() {
    const { route, param } = resolve(location.hash);
    const contract = param && route === CONTRACTS_ROUTE ? store.contractById(param) : null;
    const page = contract ? contract.title : route.path === '/' ? null : route.label;
    document.title = page ? `${page}${DOT}${APP_TITLE}` : APP_TITLE;
  }

  function renderRoute() {
    const { route, view, param } = resolve(location.hash);
    renderNav();
    renderTitle();
    renderFab(route);
    currentView?.destroy?.();
    clear(viewWrap);
    currentView = view({ param });
    viewWrap.append(currentView);
    main.scrollTop = 0;
    window.scrollTo({ top: 0 });
  }

  /*
   * On a phone the FAB is the only add button there is — every page-head one is
   * desktop-only — so it has to add the thing the page in front of the user is
   * about. Fixed to "new contract", it left Contacts with no way to add a
   * contact at all once the list was no longer empty: the header button was
   * hidden, and the only route left was the inline shortcut buried in a
   * contract form.
   */
  let addNew = () => openContractForm();
  const fab = el('button.fab', {
    html: icon('plus', 26, 2.2),
    'aria-label': 'New contract',
    onclick: () => addNew(),
  });

  function renderFab(route) {
    const onContacts = route.path === '/contacts';
    addNew = onContacts ? () => openContactForm() : () => openContractForm();
    fab.setAttribute('aria-label', onContacts ? 'New contact' : 'New contract');
  }

  /*
   * Every page put eight stops — six nav items, the add button, the sign-out
   * icon — between the top of the tab order and the view, on every single
   * navigation. A button rather than the conventional `href="#main"`: the hash
   * is this app's router, so that link would navigate to the dashboard.
   */
  const skip = el('button.skip-link', {
    type: 'button',
    onclick: () => main.focus(),
  }, 'Skip to content');

  clear(appRoot);
  appRoot.append(skip, el('div.shell', {}, sidebar, main), tabbar, fab);

  window.addEventListener('hashchange', renderRoute);
  renderRoute();

  // Badge counts follow the data, and so does the name of a contract that
  // was renamed while its own page was open.
  store.addEventListener('change', () => { renderNav(); renderTitle(); });
}

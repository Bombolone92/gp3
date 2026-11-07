/**
 * Application chrome: navigation rail with collapsible sections, top bar,
 * mobile tab bar, account menu, create menu, sync indicator, keyboard
 * shortcuts.
 */
import { h, isTypingTarget } from './dom.js';
import { icon } from './icons.js';
import { openMenu, openPopover } from './menu.js';
import { openDialog } from './dialog.js';
import { initToasts } from './toast.js';
import { navigate, onRoute, currentRoute } from './router.js';
import { segmented, avatar } from './components.js';
import { getThemeMode, setThemeMode } from './theme.js';
import { app, derived } from '../app.js';
import { openSearch } from './search.js';
import { createActions } from '../views/create.js';
import { canSignOut, signOut, clearProfilePicture } from '../platform.js';
import { clearAllCaches } from '../core/cache.js';
import { navCounts } from '../core/counts.js';

const REPO_URL = 'https://github.com/heyputer/everything';
const RAIL_KEY = 'propertymgmt.rail';
const GROUPS_KEY = 'propertymgmt.navGroups';

/**
 * Navigation. Top-level entries are links or sections of links. `key` is
 * the second key of a "G then key" shortcut. `badge` names a count from
 * core/counts.js.
 */
export const NAV = [
  { id: 'home', label: 'Dashboard', icon: 'dashboard', href: '#/', key: 'h' },
  {
    group: 'rentals',
    label: 'Rentals',
    icon: 'building',
    items: [
      { id: 'properties', label: 'Properties', href: '#/properties', key: 'p' },
      { id: 'leases', label: 'Rent roll', href: '#/leases', key: 'r' },
      { id: 'tenants', label: 'Tenants', href: '#/tenants', key: 't' },
      { id: 'owners', label: 'Rental owners', href: '#/owners', key: 'o' },
      { id: 'balances', label: 'Outstanding balances', href: '#/balances', key: 'd', badge: 'balances', alert: true },
    ],
  },
  {
    group: 'leasing',
    label: 'Leasing',
    icon: 'key',
    items: [
      { id: 'listings', label: 'Listings', href: '#/listings', key: 'l' },
      { id: 'applicants', label: 'Applicants', href: '#/applicants', key: 'a', badge: 'applicants' },
      { id: 'renewals', label: 'Renewals', href: '#/renewals', key: 'n', badge: 'renewals' },
    ],
  },
  {
    group: 'accounting',
    label: 'Accounting',
    icon: 'landmark',
    items: [
      { id: 'financials', label: 'Financials', href: '#/financials', key: 'f' },
      { id: 'ledger', label: 'General ledger', href: '#/ledger', key: 'g' },
      { id: 'banking', label: 'Banking', href: '#/banking', key: 'k' },
      { id: 'bills', label: 'Bills', href: '#/bills', key: 'b', badge: 'bills', alert: true },
      { id: 'accounts', label: 'Chart of accounts', href: '#/accounts', key: 'y' },
      { id: 'budgets', label: 'Budgets', href: '#/budgets', key: 'u' },
    ],
  },
  {
    group: 'maintenance',
    label: 'Maintenance',
    icon: 'wrench',
    items: [
      { id: 'work-orders', label: 'Work orders', href: '#/work-orders', key: 'w', badge: 'workOrders' },
      { id: 'vendors', label: 'Vendors', href: '#/vendors', key: 'v' },
      { id: 'inspections', label: 'Inspections', href: '#/inspections', key: 'i' },
    ],
  },
  { id: 'tasks', label: 'Tasks', icon: 'list-checks', href: '#/tasks', key: 's', badge: 'tasks' },
  { id: 'communication', label: 'Communication', icon: 'megaphone', href: '#/communication', key: 'm' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar-days', href: '#/calendar', key: 'c' },
  { id: 'reports', label: 'Reports', icon: 'chart', href: '#/reports', key: 'e' },
];

/** Every link, flattened, with its section. */
export const ALL_NAV = NAV.flatMap((n) => (n.items ? n.items.map((i) => ({ ...i, group: n.group, icon: i.icon || n.icon })) : [n]));

const TABBAR = ['home', 'leases', 'work-orders', 'tasks'];
const TAB_ICONS = { home: 'dashboard', leases: 'file-signature', 'work-orders': 'wrench', tasks: 'list-checks' };

// Routes whose first path segment differs from the nav item they belong to.
const ALIASES = { units: 'properties', transactions: 'ledger', join: 'home' };

/** Which nav item a route belongs to. */
export function sectionFor(route) {
  const first = route.path.split('/')[1] || 'home';
  const id = ALIASES[first] || first;
  return ALL_NAV.find((n) => n.id === id)?.id || (first === 'settings' ? 'settings' : 'home');
}

function loadOpenGroups() {
  try {
    const v = JSON.parse(localStorage.getItem(GROUPS_KEY) || 'null');
    if (Array.isArray(v)) return new Set(v);
  } catch {}
  return new Set(['rentals']);
}

// A field flagged as invalid stops being flagged once it is edited, in
// every form at once (each one only sets the flag on a failed save).
let clearsInvalid = false;
function clearInvalidOnEdit() {
  if (clearsInvalid) return;
  clearsInvalid = true;
  const clear = (e) => e.target?.getAttribute?.('aria-invalid') === 'true' && e.target.removeAttribute('aria-invalid');
  document.addEventListener('input', clear, true);
  document.addEventListener('change', clear, true);
}

export function buildShell({ onSignIn } = {}) {
  clearInvalidOnEdit();
  initToasts();
  const store = app.store;
  let railMode = 'expanded';
  try {
    railMode = localStorage.getItem(RAIL_KEY) === 'collapsed' ? 'collapsed' : 'expanded';
  } catch {}
  const openGroups = loadOpenGroups();

  const main = h('main.content#main', { tabindex: '-1' });
  const navLinks = new Map(); // item id -> link
  const tabLinks = new Map();
  const groupBtns = new Map(); // group -> { btn, sub, dot }
  const badges = new Map(); // badge key -> [{ badge, link, base }]

  function badgeEl(item) {
    if (!item.badge) return null;
    const b = h('span.nav-badge', { hidden: true });
    if (!badges.has(item.badge)) badges.set(item.badge, []);
    badges.get(item.badge).push({ badge: b, item });
    return b;
  }

  function link(item, { sub = false } = {}) {
    const a = h(
      `a.nav-link${sub ? '.sub' : ''}`,
      { href: item.href, 'data-nav': item.id, title: sub ? null : item.label },
      sub ? null : icon(item.icon, 19),
      h('span.label', item.label),
      badgeEl(item),
      sub ? null : item.badge ? h('span.nav-dot', { hidden: true, 'aria-hidden': 'true' }) : null,
    );
    navLinks.set(item.id, a);
    return a;
  }

  function section(entry) {
    const subId = `nav-${entry.group}`;
    const dot = h('span.nav-dot', { hidden: true, 'aria-hidden': 'true' });
    const btn = h(
      'button.nav-link.nav-group-btn',
      {
        type: 'button',
        'aria-controls': subId,
        title: entry.label,
        onClick: (e) => {
          if (root.dataset.rail === 'collapsed' || matchMedia('(max-width: 1023px)').matches) {
            openFlyout(e.currentTarget, entry);
          } else toggleGroup(entry.group);
        },
      },
      icon(entry.icon, 19),
      h('span.label', entry.label),
      icon('chevron-down', 16, 'chev'),
      dot,
    );
    const sub = h('div.nav-sub', { id: subId, role: 'group', 'aria-label': entry.label }, entry.items.map((i) => link(i, { sub: true })));
    groupBtns.set(entry.group, { btn, sub, dot, entry });
    return h('div.nav-section', btn, sub);
  }

  function toggleGroup(group, force) {
    const open = force ?? !openGroups.has(group);
    if (open) openGroups.add(group);
    else openGroups.delete(group);
    paintGroups();
    try {
      localStorage.setItem(GROUPS_KEY, JSON.stringify([...openGroups]));
    } catch {}
  }

  function paintGroups() {
    for (const [group, g] of groupBtns) {
      const open = openGroups.has(group);
      g.btn.setAttribute('aria-expanded', String(open));
      g.sub.hidden = !open;
    }
  }

  function openFlyout(anchor, entry) {
    const section = sectionFor(currentRoute());
    openMenu(
      anchor,
      [{ heading: entry.label }, ...entry.items.map((i) => ({ label: i.label, href: i.href, checked: i.id === section ? true : undefined, hint: countText(i) }))],
      { label: entry.label, side: 'right' },
    );
  }

  const nav = h(
    'nav.rail-nav',
    { 'aria-label': 'Main' },
    NAV.map((entry) => (entry.items ? section(entry) : link(entry))),
  );

  const createBtn = h(
    'button.btn.primary.create-btn',
    { type: 'button', title: 'Create (N)', onClick: (e) => openCreateMenu(e.currentTarget) },
    icon('plus', 18),
    h('span.label', 'New'),
  );

  const railToggle = h('button.icon-btn.rail-toggle', {
    type: 'button',
    onClick: () => setRail(railMode === 'expanded' ? 'collapsed' : 'expanded'),
  });

  const companyName = h('span.brand-name.truncate');
  const companySub = h('span.brand-sub.truncate');

  const rail = h(
    'aside.rail',
    h('a.rail-brand', { href: '#/', 'aria-label': 'Dashboard' }, h('img.brand-mark', { src: './icons/icon-192.png', alt: '' }), h('div.brand-text', companyName, companySub)),
    h('div.rail-create', createBtn),
    nav,
    h(
      'div.rail-foot',
      h('a.nav-link.foot-link', { href: '#/settings', 'data-nav': 'settings', title: 'Settings' }, icon('settings', 19), h('span.label', 'Settings')),
      h(
        'div.rail-foot-row',
        h(
          'a.icon-btn',
          { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Source code on GitHub (opens in a new tab)', title: 'Source code on GitHub' },
          icon('github', 18),
        ),
        h('span.powered.grow', 'Powered by ', h('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener noreferrer' }, 'Puter')),
        railToggle,
      ),
    ),
  );
  navLinks.set('settings', rail.querySelector('.foot-link'));

  // ---- Top bar ------------------------------------------------------------

  const syncEl = h('span.sync-status', { role: 'status', 'aria-live': 'polite' });
  const accountBtn = h('button.account-btn', { type: 'button', 'aria-label': 'Account and appearance', title: 'Account' });

  const topbar = h(
    'header.topbar',
    h('a.mobile-brand', { href: '#/', 'aria-label': 'Dashboard' }, h('img', { src: './icons/icon-192.png', alt: '' }), h('span.truncate.mobile-company')),
    h(
      'button.search-trigger',
      { type: 'button', onClick: () => openSearch(), 'aria-label': 'Search', 'aria-keyshortcuts': '/' },
      icon('search', 17),
      h('span.label', 'Search properties, tenants, leases...'),
      h('span.kbd', '/'),
    ),
    h('div.spacer'),
    syncEl,
    h('button.icon-btn.show-mobile', { type: 'button', 'aria-label': 'Create', onClick: (e) => openCreateMenu(e.currentTarget) }, icon('plus', 20)),
    h(
      'a.icon-btn.desktop-only',
      { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Source code on GitHub (opens in a new tab)', title: 'Source code on GitHub' },
      icon('github'),
    ),
    h(
      'button.icon-btn.desktop-only',
      { type: 'button', 'aria-label': 'Keyboard shortcuts', title: 'Keyboard shortcuts (?)', onClick: () => showShortcuts() },
      icon('keyboard'),
    ),
    accountBtn,
  );

  accountBtn.addEventListener('click', () => openAccountMenu(accountBtn, onSignIn));

  // ---- Demo banner ----------------------------------------------------------

  const banner = app.demo
    ? h(
        'section.demo-banner',
        { 'aria-label': 'Demo mode' },
        icon('info', 16),
        h('span.grow', h('span.long', 'You are exploring a sample portfolio. Changes stay in this tab and disappear when you leave.'), h('span.short', 'Sample portfolio. Changes are not saved.')),
        h('button.btn.sm.primary', { type: 'button', onClick: () => onSignIn?.() }, h('span.long', 'Sign in to start your own'), h('span.short', 'Sign in')),
      )
    : null;

  // ---- Mobile tab bar -------------------------------------------------------

  const tabbar = h(
    'nav.tabbar',
    { 'aria-label': 'Main' },
    TABBAR.map((id) => {
      const item = ALL_NAV.find((n) => n.id === id);
      const a = h('a', { href: item.href }, icon(TAB_ICONS[id] || item.icon, 22), h('span', id === 'home' ? 'Home' : item.label));
      tabLinks.set(id, a);
      return a;
    }),
    h('button', { type: 'button', onClick: () => openMoreSheet(), 'aria-haspopup': 'dialog' }, icon('menu', 22), h('span', 'More')),
  );

  const root = h(
    'div.app',
    { dataset: { rail: railMode } },
    h('a.skip-link', { href: '#main', onClick: (e) => (e.preventDefault(), main.focus()) }, 'Skip to content'),
    rail,
    h('div.main-col', topbar, banner, main),
    tabbar,
  );

  function setRail(mode) {
    railMode = mode;
    root.dataset.rail = mode;
    railToggle.replaceChildren(icon(mode === 'expanded' ? 'panel-close' : 'panel-open', 18));
    railToggle.setAttribute('aria-label', mode === 'expanded' ? 'Collapse navigation' : 'Expand navigation');
    railToggle.title = `${mode === 'expanded' ? 'Collapse' : 'Expand'} navigation ([)`;
    try {
      localStorage.setItem(RAIL_KEY, mode);
    } catch {}
  }
  setRail(railMode);
  paintGroups();

  // ---- Live bits --------------------------------------------------------------

  function updateActive(route) {
    const section = sectionFor(route);
    const item = ALL_NAV.find((n) => n.id === section);
    for (const [id, a] of [...navLinks, ...tabLinks]) {
      if (id === section) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    for (const [group, g] of groupBtns) g.btn.classList.toggle('has-current', item?.group === group);
    // Reveal the section that holds the current page.
    if (item?.group && !openGroups.has(item.group)) toggleGroup(item.group, true);
  }

  function updateBrand() {
    const s = store.state.settings;
    companyName.textContent = s.company.name || 'Property Management';
    companySub.textContent = app.demo ? 'Sample portfolio' : app.team && app.team.role !== 'owner' ? `Team member${app.user ? ' · ' + app.user.username : ''}` : app.user?.username || '';
    const mb = topbar.querySelector('.mobile-company');
    if (mb) mb.textContent = s.company.name || 'Property Management';
  }

  let counts = {};
  function countText(item) {
    const n = item.badge ? counts[item.badge]?.n : 0;
    return n ? String(n > 99 ? '99+' : n) : null;
  }

  function updateBadges() {
    counts = derived('navCounts', ['leases', 'transactions', 'applicants', 'workOrders', 'tasks', 'settings'], () => navCounts(store, app.today(), app.ledger()), { daily: true });
    for (const [key, list] of badges) {
      const c = counts[key] || { n: 0, label: '' };
      for (const { badge, item } of list) {
        badge.hidden = !c.n;
        badge.textContent = c.n > 99 ? '99+' : String(c.n);
        badge.title = c.label;
        badge.classList.toggle('alert', !!item.alert);
        const a = navLinks.get(item.id);
        a?.setAttribute('aria-label', c.n ? `${item.label}, ${c.label}` : item.label);
        a?.parentElement && a.querySelector('.nav-dot') && (a.querySelector('.nav-dot').hidden = !c.n);
      }
    }
    for (const g of groupBtns.values()) g.dot.hidden = !g.entry.items.some((i) => i.alert && counts[i.badge]?.n);
    for (const id of ['tasks']) {
      const a = navLinks.get(id);
      const dot = a?.querySelector('.nav-dot');
      if (dot) dot.hidden = !counts.tasks?.n;
    }
  }

  function updateSync() {
    const st = store.state;
    const pending = store.pendingCount();
    let cls = '';
    let ic = 'cloud-check';
    let text = 'Saved';
    if (app.demo) {
      cls = 'demo';
      ic = 'eye';
      text = 'Demo';
    } else if (!st.online) {
      cls = 'offline';
      ic = 'cloud-off';
      text = pending ? `Offline, ${pending} unsaved` : 'Offline';
    } else if (pending || st.syncing) {
      ic = 'refresh';
      text = pending ? 'Saving' : 'Syncing';
    }
    syncEl.className = `sync-status ${cls}`;
    syncEl.replaceChildren(icon(ic, 15), h('span.label', text));
    syncEl.title = st.error && !st.online ? `Changes are kept on this device and will sync when the connection returns. (${st.error})` : text;
  }

  function updateAccount() {
    const name = app.user?.username || 'Guest';
    accountBtn.replaceChildren(avatar(name, { color: '#4c5a63', img: app.avatarUrl }));
  }

  onRoute(updateActive);
  updateActive(currentRoute());
  updateBrand();
  updateBadges();
  updateSync();
  updateAccount();
  const watched = new Set(['leases', 'transactions', 'applicants', 'workOrders', 'tasks', 'settings']);
  store.subscribe((changed) => {
    if (changed.has('settings')) updateBrand();
    if (changed.has('sync')) updateSync();
    if ([...changed].some((c) => watched.has(c))) updateBadges();
    if (changed.size && !changed.has('sync')) updateSync();
  });
  // Re-derive date-based badges when the day rolls over.
  setInterval(updateBadges, 5 * 60 * 1000);

  installShortcuts({ toggleRail: () => setRail(railMode === 'expanded' ? 'collapsed' : 'expanded'), createBtn });

  return { root, main, updateAccount };
}

// ---- Menus ----------------------------------------------------------------

export function openCreateMenu(anchor) {
  const groups = createActions();
  const items = [];
  for (const g of groups) {
    items.push({ heading: g.heading });
    for (const a of g.items) items.push({ label: a.label, icon: a.icon, run: a.run });
  }
  openMenu(anchor, items, { label: 'Create new' });
}

function openAccountMenu(anchor, onSignIn) {
  // A small dialog rather than a role=menu: it mixes a theme control with
  // links, which a menu may not contain.
  openPopover(
    anchor,
    ({ close }) => {
      const link = (label, ic, attrs) => h(attrs.href ? 'a.menu-item' : 'button.menu-item', { type: attrs.href ? null : 'button', ...attrs }, icon(ic, 16), h('span.grow', label));
      const items = [
        link('Settings', 'settings', { href: '#/settings', onClick: () => close() }),
        link('Keyboard shortcuts', 'keyboard', { onClick: () => (close(), showShortcuts()) }),
        link('Source code on GitHub', 'github', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer', onClick: () => close() }),
      ];
      let footer = null;
      if (app.demo) footer = link('Sign in with Puter', 'log-in', { onClick: () => (close(), onSignIn?.()) });
      else if (canSignOut())
        footer = link('Sign out', 'log-out', {
          onClick: async () => {
            close();
            if (app.store.pendingCount()) {
              const { confirmDialog } = await import('./dialog.js');
              const ok = await confirmDialog({
                title: 'Sign out with unsaved changes?',
                message: 'Some changes have not reached the cloud yet. Signing out now discards them.',
                confirmLabel: 'Sign out anyway',
                danger: true,
              });
              if (!ok) return;
            }
            signOut();
            // Nothing of this account stays on the device: the offline copy
            // (records and unsent changes) and the cached profile picture.
            app.store.detachCache();
            await clearAllCaches().catch(() => {});
            clearProfilePicture();
            location.hash = '';
            location.reload();
          },
        });
      return h(
        'div.account-pop',
        h(
          'div.row',
          { style: { padding: '10px 10px 12px' } },
          avatar(app.user?.username || 'Guest', { color: '#4c5a63', img: app.avatarUrl, size: 'lg' }),
          h(
            'div.grow',
            h('div', { style: { fontWeight: '700' } }, app.demo ? 'Demo mode' : app.user?.username || ''),
            h('div.subtle', { style: { fontSize: '12px' } }, app.demo ? 'Nothing is saved' : 'Signed in with Puter'),
          ),
        ),
        h('div.menu-sep'),
        h(
          'div',
          { style: { padding: '6px 10px 10px' } },
          h('div.menu-label', { style: { padding: '0 0 8px' } }, 'Appearance'),
          segmented({
            label: 'Theme',
            value: getThemeMode(),
            items: [
              { value: 'system', label: 'System', icon: 'monitor' },
              { value: 'light', label: 'Light', icon: 'sun' },
              { value: 'dark', label: 'Dark', icon: 'moon' },
            ],
            onChange: (v) => setThemeMode(v),
          }),
        ),
        companySwitcher(close),
        h('div.menu-sep'),
        h('nav', { 'aria-label': 'Account' }, items),
        footer ? [h('div.menu-sep'), footer] : null,
      );
    },
    { align: 'end', label: 'Account and appearance', role: 'dialog' },
  );
}

/** Lists the person's own company and those they joined, when there is a choice. */
function companySwitcher(close) {
  const ws = app.workspaces;
  if (app.demo || !ws || !ws.joined?.length) return null;
  const current = app.team && app.team.role !== 'owner' ? app.team.url : 'own';
  const options = [{ id: 'own', label: 'My company', sub: app.team?.role === 'owner' || current === 'own' ? app.store.state.settings.company.name || '' : '' }, ...ws.joined.map((j) => ({ id: j.url, label: j.business || 'Team company', sub: j.role === 'admin' ? 'Admin' : 'Team member' }))];
  return [
    h('div.menu-sep'),
    h('div.menu-label', 'Company'),
    h(
      'div',
      { role: 'group', 'aria-label': 'Switch company' },
      options.map((o) =>
        h(
          'button.menu-item',
          {
            type: 'button',
            'aria-current': o.id === current ? 'true' : null,
            onClick: () => {
              close();
              if (o.id !== current) import('../team.js').then((m) => m.switchWorkspace(o.id));
            },
          },
          icon(o.id === 'own' ? 'home' : 'building', 16),
          h('span.grow', o.label, o.sub ? h('span.menu-desc', o.sub) : null),
          o.id === current ? icon('check', 16) : null,
        ),
      ),
    ),
  ];
}

function openMoreSheet() {
  openDialog({
    title: 'Menu',
    sheet: true,
    body: ({ close }) =>
      h(
        'nav.more-sheet',
        { 'aria-label': 'All sections' },
        NAV.filter((n) => !n.items && !TABBAR.includes(n.id)).length
          ? h(
              'ul.list',
              NAV.filter((n) => !n.items && !TABBAR.includes(n.id)).map((n) => h('li', h('a.list-item', { href: n.href, onClick: () => close() }, icon(n.icon, 20), h('span.title', n.label)))),
            )
          : null,
        NAV.filter((n) => n.items).map((g) =>
          h(
            'section',
            { 'aria-label': g.label },
            h('h3.more-heading', icon(g.icon, 16), g.label),
            h(
              'ul.list',
              g.items.map((i) => h('li', h('a.list-item', { href: i.href, onClick: () => close() }, h('span.title.grow', i.label), icon('chevron-right', 16)))),
            ),
          ),
        ),
        h(
          'ul.list',
          h('li', h('a.list-item', { href: '#/settings', onClick: () => close() }, icon('settings', 20), h('span.title', 'Settings'))),
          h(
            'li',
            h('a.list-item', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, icon('github', 20), h('span.title.grow', 'Source code on GitHub'), icon('external', 16)),
          ),
        ),
      ),
  });
}

// ---- Keyboard shortcuts ---------------------------------------------------

export const SHORTCUTS = [
  { keys: ['/'], label: 'Search' },
  { keys: ['N'], label: 'Create new' },
  { keys: ['?'], label: 'Show keyboard shortcuts' },
  { keys: ['['], label: 'Collapse or expand navigation' },
  ...ALL_NAV.map((n) => ({ keys: ['G', n.key.toUpperCase()], label: `Go to ${n.label}` })),
  { keys: ['G', ','], label: 'Go to Settings' },
  { keys: ['Esc'], label: 'Close dialog or menu' },
];

export function showShortcuts() {
  openDialog({
    title: 'Keyboard shortcuts',
    body: h(
      'dl.kv.shortcuts',
      SHORTCUTS.map((s) => [
        h(
          'dt',
          h(
            'span.row',
            { style: { gap: '4px' } },
            s.keys.map((k, i) => [i ? h('span.subtle', 'then') : null, h('kbd', k)]),
          ),
        ),
        h('dd', s.label),
      ]),
    ),
  });
}

function installShortcuts({ toggleRail, createBtn }) {
  let gPending = false;
  let gTimer;
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) {
      // Not over another dialog: picking a result would leave it open on
      // top of the new page.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        openSearch();
      }
      return;
    }
    if (isTypingTarget(e.target) || document.querySelector('dialog[open]') || e.target?.closest?.('.popover')) return;
    if (gPending) {
      gPending = false;
      clearTimeout(gTimer);
      const k = e.key.toLowerCase();
      if (k === ',') return navigate('/settings');
      const item = ALL_NAV.find((n) => n.key === k);
      if (item) {
        e.preventDefault();
        navigate(item.href.slice(1) || '/');
      }
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      openSearch();
    } else if (e.key === '?') {
      e.preventDefault();
      showShortcuts();
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      const visible = createBtn.offsetParent ? createBtn : document.querySelector('.topbar .show-mobile');
      openCreateMenu(visible || createBtn);
    } else if (e.key === '[') {
      toggleRail();
    } else if (e.key === 'g') {
      gPending = true;
      gTimer = setTimeout(() => (gPending = false), 1200);
    }
  });
}

export { openPopover };

/**
 * Application chrome: navigation sidebar with collapsible groups, top bar
 * (search, alerts, quick add, account), phone tab bar, keyboard shortcuts.
 */
import { h, isTypingTarget } from './dom.js';
import { icon } from './icons.js';
import { openMenu, openPopover } from './menu.js';
import { openDialog, confirmDialog } from './dialog.js';
import { switchWorkspace } from '../team.js';
import { navigate, onRoute, currentRoute } from './router.js';
import { segmented, avatar } from './components.js';
import { getThemeMode, setThemeMode } from './theme.js';
import { app, canEdit, role, reloadApp } from '../app.js';
import { openSearch } from './search.js';
import { createActions } from '../views/create.js';
import { canSignOut, signOut, clearProfilePicture } from '../platform.js';
import { clearUserCaches } from '../core/cache.js';
import { computeAlerts } from '../views/alerts.js';

export const REPO_URL = 'https://github.com/heyputer/everything';
const RAIL_KEY = 'fleet.rail';
const OPEN_KEY = 'fleet.navOpen';

/**
 * Navigation. Items with children are groups that expand in place; `match`
 * lists the route sections (first path segment) that belong to an item.
 */
export const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', href: '#/', key: 'd', match: [''] },
  {
    id: 'vehicles-group',
    label: 'Vehicles',
    icon: 'truck',
    key: 'v',
    children: [
      { id: 'vehicles', label: 'Vehicle list', href: '#/vehicles', match: ['vehicles'] },
      { id: 'assignments', label: 'Assignments', href: '#/assignments', match: ['assignments'] },
      { id: 'meters', label: 'Meter history', href: '#/meters', match: ['meters'] },
      { id: 'expenses', label: 'Expense history', href: '#/expenses', match: ['expenses'] },
    ],
  },
  {
    id: 'inspections-group',
    label: 'Inspections',
    icon: 'clipboard-check',
    key: 'i',
    children: [
      { id: 'inspections', label: 'Inspection history', href: '#/inspections', match: ['inspections'] },
      { id: 'failures', label: 'Item failures', href: '#/failures', match: ['failures'] },
      { id: 'inspection-forms', label: 'Forms', href: '#/inspection-forms', match: ['inspection-forms'] },
    ],
  },
  { id: 'issues', label: 'Issues', icon: 'warning', href: '#/issues', key: 'u', badge: 'issues', match: ['issues'] },
  {
    id: 'reminders-group',
    label: 'Reminders',
    icon: 'bell',
    key: 'r',
    badge: 'reminders',
    children: [
      { id: 'reminders', label: 'Service reminders', href: '#/reminders', match: ['reminders'] },
      { id: 'renewals', label: 'Vehicle renewals', href: '#/renewals', match: ['renewals'] },
      { id: 'contact-renewals', label: 'Contact renewals', href: '#/contact-renewals', match: ['contact-renewals'] },
    ],
  },
  {
    id: 'service-group',
    label: 'Service',
    icon: 'wrench',
    key: 's',
    children: [
      { id: 'service', label: 'Service history', href: '#/service', match: ['service'] },
      { id: 'work-orders', label: 'Work orders', href: '#/work-orders', match: ['work-orders'] },
      { id: 'service-tasks', label: 'Service tasks', href: '#/service-tasks', match: ['service-tasks'] },
      { id: 'service-programs', label: 'Service programs', href: '#/service-programs', match: ['service-programs'] },
    ],
  },
  { id: 'contacts', label: 'Contacts', icon: 'users', href: '#/contacts', key: 'c', match: ['contacts'] },
  { id: 'vendors', label: 'Vendors', icon: 'store', href: '#/vendors', key: 'e', match: ['vendors'] },
  {
    id: 'parts-group',
    label: 'Parts and inventory',
    icon: 'package',
    key: 'p',
    children: [
      { id: 'parts', label: 'Parts list', href: '#/parts', match: ['parts'] },
      { id: 'purchase-orders', label: 'Purchase orders', href: '#/purchase-orders', match: ['purchase-orders'] },
    ],
  },
  { id: 'fuel', label: 'Fuel and energy', icon: 'fuel', href: '#/fuel', key: 'f', match: ['fuel'] },
  { id: 'documents', label: 'Documents', icon: 'folder', href: '#/documents', key: 'o', match: ['documents'] },
  { id: 'reports', label: 'Reports', icon: 'chart', href: '#/reports', key: 't', match: ['reports'] },
];

const LEAVES = NAV.flatMap((n) => (n.children ? n.children.map((c) => ({ ...c, parent: n })) : [n]));
const TABBAR = [
  { id: 'dashboard', label: 'Home', icon: 'dashboard', href: '#/' },
  { id: 'vehicles', label: 'Vehicles', icon: 'truck', href: '#/vehicles' },
  { id: 'inspect', label: 'Inspect', icon: 'clipboard-check', href: '#/inspections/start' },
  { id: 'issues', label: 'Issues', icon: 'warning', href: '#/issues' },
];

/** The nav leaf a route belongs to. */
export function leafFor(route) {
  const first = route.path.split('/')[1] || '';
  if (first === 'inspections' && route.path.startsWith('/inspections/start')) return LEAVES.find((l) => l.id === 'inspections');
  return LEAVES.find((l) => l.match.includes(first)) || null;
}

function loadOpen() {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) || 'null');
    return new Set(Array.isArray(v) ? v : []);
  } catch {
    return new Set();
  }
}

export function buildShell({ onSignIn } = {}) {
  const store = app.store;
  let railMode = 'expanded';
  try {
    railMode = localStorage.getItem(RAIL_KEY) === 'collapsed' ? 'collapsed' : 'expanded';
  } catch {}
  const openGroups = loadOpen();

  const main = h('main.content#main', { tabindex: '-1' });
  const leafLinks = new Map(); // leaf id -> <a>
  const groupBtns = new Map(); // group id -> { btn, list }
  const badges = new Map();
  const tabLinks = new Map();

  function badgeNode(key) {
    if (!key) return [null, null];
    const badge = h('span.nav-badge', { hidden: true });
    const dot = h('span.nav-dot', { hidden: true, 'aria-hidden': 'true' });
    badges.set(key, { badge, dot });
    return [badge, dot];
  }

  const nav = h(
    'nav.rail-nav',
    { 'aria-label': 'Main' },
    h(
      'ul.nav-list',
      NAV.map((item) => {
        const [badge, dot] = badgeNode(item.badge);
        if (!item.children) {
          const a = h('a.nav-link', { href: item.href, title: item.label, 'data-nav': item.id }, icon(item.icon, 18), h('span.label', item.label), badge, dot);
          leafLinks.set(item.id, a);
          return h('li', a);
        }
        const listId = `nav-${item.id}`;
        const sub = h(
          'ul.nav-sub',
          { id: listId },
          item.children.map((c) => {
            const a = h('a.nav-sublink', { href: c.href, 'data-nav': c.id }, h('span.label', c.label));
            leafLinks.set(c.id, a);
            return h('li', a);
          }),
        );
        const btn = h(
          'button.nav-link.nav-group-btn',
          {
            type: 'button',
            title: item.label,
            'aria-expanded': 'false',
            'aria-controls': listId,
            onClick: (e) => {
              if (root.dataset.rail === 'collapsed' || matchMedia('(max-width: 1023px) and (min-width: 768px)').matches) {
                openMenu(e.currentTarget, [{ heading: item.label }, ...item.children.map((c) => ({ label: c.label, href: c.href }))], { label: item.label });
                return;
              }
              toggleGroup(item.id);
            },
          },
          icon(item.icon, 18),
          h('span.label', item.label),
          badge,
          dot,
          h('span.nav-caret', icon('chevron-down', 15)),
        );
        groupBtns.set(item.id, { btn, sub });
        return h('li.nav-group', btn, sub);
      }),
    ),
  );

  function toggleGroup(id, force) {
    const open = force ?? !openGroups.has(id);
    if (open) openGroups.add(id);
    else openGroups.delete(id);
    const g = groupBtns.get(id);
    g.btn.setAttribute('aria-expanded', String(open));
    g.sub.hidden = !open;
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...openGroups]));
    } catch {}
  }
  for (const id of groupBtns.keys()) toggleGroup(id, openGroups.has(id));

  const railToggle = h('button.icon-btn.rail-toggle', {
    type: 'button',
    onClick: () => setRail(railMode === 'expanded' ? 'collapsed' : 'expanded'),
  });

  const fleetName = h('span.brand-name.truncate');
  const fleetSub = h('span.brand-sub.truncate');

  const rail = h(
    'aside.rail',
    { 'aria-label': 'Sidebar' },
    h('a.rail-brand', { href: '#/', 'aria-label': 'Dashboard' }, h('img.brand-mark', { src: './icons/icon-192.png', alt: '' }), h('span.brand-text', fleetName, fleetSub)),
    nav,
    h(
      'div.rail-foot',
      h('a.nav-link.foot-link', { href: '#/settings', title: 'Settings', 'data-nav': 'settings' }, icon('settings', 18), h('span.label', 'Settings')),
      h(
        'div.rail-foot-row',
        h(
          'a.icon-btn.nav-icon-btn',
          { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Source code on GitHub (opens in a new tab)', title: 'Source code on GitHub' },
          icon('github', 17),
        ),
        h('span.powered.grow', 'Built on ', h('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener noreferrer' }, 'Puter')),
        railToggle,
      ),
    ),
  );
  leafLinks.set('settings', rail.querySelector('[data-nav="settings"]'));

  // ---- Top bar ------------------------------------------------------------

  const syncEl = h('span.sync-status', { role: 'status', 'aria-live': 'polite' });
  const accountBtn = h('button.account-btn', { type: 'button', 'aria-label': 'Account and appearance', title: 'Account' });
  const alertCount = h('span.alert-count', { hidden: true });
  const alertBtn = h('button.icon-btn.alert-btn', { type: 'button', 'aria-label': 'Needs attention', title: 'Needs attention', onClick: (e) => openAlerts(e.currentTarget) }, icon('bell', 19), alertCount);
  const addBtn = h('button.btn.primary.add-btn', { type: 'button', title: 'Add (N)', 'aria-label': 'Add new', onClick: (e) => openCreateMenu(e.currentTarget) }, icon('plus', 18), h('span.label', 'Add'));
  const pageTitle = h('span.mobile-title.truncate');

  const topbar = h(
    'header.topbar',
    h('a.mobile-brand', { href: '#/', 'aria-label': 'Dashboard' }, h('img', { src: './icons/icon-192.png', alt: '' })),
    pageTitle,
    h(
      'button.search-trigger',
      { type: 'button', onClick: () => openSearch(), 'aria-label': 'Search', 'aria-keyshortcuts': '/' },
      icon('search', 17),
      h('span.label', 'Search vehicles, issues, parts...'),
      h('span.kbd', '/'),
    ),
    h('div.spacer'),
    syncEl,
    h('button.icon-btn.desktop-only', { type: 'button', 'aria-label': 'Keyboard shortcuts', title: 'Keyboard shortcuts (?)', onClick: () => showShortcuts() }, icon('keyboard', 19)),
    alertBtn,
    addBtn,
    accountBtn,
  );
  accountBtn.addEventListener('click', () => openAccountMenu(accountBtn, onSignIn));

  const banner = app.demo
    ? h(
        'section.demo-banner',
        { 'aria-label': 'Demo mode' },
        icon('info', 16),
        h('span.grow', h('span.long', 'You are exploring a sample fleet. Changes stay in this tab and disappear when you leave.'), h('span.short', 'Sample fleet. Changes are not saved.')),
        h('button.btn.sm.primary', { type: 'button', onClick: () => onSignIn?.() }, h('span.long', 'Sign in to start your fleet'), h('span.short', 'Sign in')),
      )
    : null;

  const tabbar = h(
    'nav.tabbar',
    { 'aria-label': 'Main' },
    TABBAR.map((t) => {
      const a = h('a', { href: t.href }, icon(t.icon, 22), h('span', t.label));
      tabLinks.set(t.id, a);
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
    railToggle.replaceChildren(icon(mode === 'expanded' ? 'panel-close' : 'panel-open', 17));
    railToggle.setAttribute('aria-label', mode === 'expanded' ? 'Collapse sidebar' : 'Expand sidebar');
    railToggle.title = `${mode === 'expanded' ? 'Collapse' : 'Expand'} sidebar ([)`;
    try {
      localStorage.setItem(RAIL_KEY, mode);
    } catch {}
  }
  setRail(railMode);

  // ---- Live bits --------------------------------------------------------------

  function updateActive(route) {
    const leaf = route.path.startsWith('/settings') ? { id: 'settings' } : leafFor(route);
    for (const [id, a] of leafLinks) {
      if (leaf && id === leaf.id) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    for (const [gid, g] of groupBtns) {
      const has = leaf?.parent?.id === gid;
      g.btn.classList.toggle('has-current', has);
      if (has && !openGroups.has(gid)) toggleGroup(gid, true);
    }
    const tabId = route.path.startsWith('/inspections/start') ? 'inspect' : leaf?.id === 'dashboard' ? 'dashboard' : leaf?.id;
    for (const [id, a] of tabLinks) {
      if (id === tabId) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    pageTitle.textContent = route.path.startsWith('/inspections/start') ? 'Inspect' : leaf?.label || (route.path.startsWith('/settings') ? 'Settings' : 'Fleet');
  }

  function updateBrand() {
    const s = store.state.settings;
    fleetName.textContent = s.company.name || 'My fleet';
    const r = role();
    fleetSub.textContent = app.demo ? 'Sample fleet' : r !== 'owner' ? `${r[0].toUpperCase()}${r.slice(1)}${app.user ? ' · ' + app.user.username : ''}` : app.user?.username || '';
  }

  function setBadge(key, n, label, alert = false) {
    const b = badges.get(key);
    if (!b) return;
    b.badge.hidden = !n;
    b.dot.hidden = !n;
    b.badge.textContent = n > 99 ? '99+' : String(n);
    b.badge.title = label;
    b.badge.classList.toggle('alert', alert);
    const link = b.badge.closest('.nav-link');
    const base = link.querySelector('.label').textContent;
    link.setAttribute('aria-label', n ? `${base}, ${label}` : base);
  }

  function updateBadges() {
    const a = computeAlerts();
    setBadge('issues', a.openIssues, `${a.openIssues} open`, a.overdueIssues > 0);
    const rem = a.overdueReminders + a.overdueRenewals;
    setBadge('reminders', rem, `${rem} overdue`, true);
    const n = a.items.length;
    alertCount.hidden = !n;
    alertCount.textContent = n > 99 ? '99+' : String(n);
    alertBtn.setAttribute('aria-label', n ? `Needs attention, ${n} items` : 'Needs attention');
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
    } else if (st.error && !pending) {
      cls = 'offline';
      ic = 'alert';
      text = 'Not saved';
    } else if (pending || st.syncing) {
      ic = 'refresh';
      text = pending ? 'Saving' : 'Syncing';
    }
    // It is a live region: rewriting the same status re-announces it.
    const shown = `${cls}|${ic}|${text}`;
    if (syncEl.dataset.shown !== shown) {
      syncEl.dataset.shown = shown;
      syncEl.className = `sync-status ${cls}`;
      syncEl.replaceChildren(icon(ic, 15), h('span.label', text));
    }
    syncEl.title = st.error ? (st.online ? st.error : `Changes are kept on this device and will sync when the connection returns. (${st.error})`) : text;
  }

  function updateAccount() {
    const name = app.user?.username || 'Guest';
    accountBtn.replaceChildren(avatar(name, { color: '#55606e', img: app.avatarUrl }));
  }

  let badgeTimer = null;
  const badgesSoon = () => {
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(updateBadges, 150);
  };
  onRoute(updateActive);
  updateActive(currentRoute());
  updateBrand();
  updateBadges();
  updateSync();
  updateAccount();
  store.subscribe((changed) => {
    if (changed.has('settings')) updateBrand();
    if (changed.has('sync')) updateSync();
    if ([...changed].some((c) => c !== 'sync')) {
      updateSync();
      badgesSoon();
    }
  });
  // Date-based alerts change as the day rolls over.
  setInterval(updateBadges, 5 * 60 * 1000);

  installShortcuts({ toggleRail: () => setRail(railMode === 'expanded' ? 'collapsed' : 'expanded'), addBtn });

  return { root, main, updateAccount };
}

// ---- Menus ----------------------------------------------------------------

export function openCreateMenu(anchor) {
  const items = createActions().filter((a) => canEdit(a.coll));
  const groups = [];
  let last = null;
  for (const a of items) {
    if (a.group !== last) {
      if (last !== null) groups.push({ separator: true });
      last = a.group;
    }
    groups.push({ label: a.label, icon: a.icon, run: a.run, href: a.href });
  }
  openMenu(anchor, groups, { label: 'Add new', align: 'end' });
}

function openAlerts(anchor) {
  openPopover(
    anchor,
    ({ close }) => {
      const a = computeAlerts();
      const body = a.items.length
        ? h(
            'ul.alert-list',
            a.items.slice(0, 40).map((it) =>
              h(
                'li',
                h(
                  'a.alert-item',
                  { href: it.href, onClick: () => close() },
                  h(`span.alert-icon.${it.tone}`, icon(it.icon, 16)),
                  h('span.grow', h('span.alert-title', it.title), h('span.alert-sub', it.sub)),
                ),
              ),
            ),
          )
        : h('div.alert-empty', icon('circle-check', 22), h('p', 'Nothing needs attention right now.'));
      return h('div.alerts-pop', h('div.alerts-head', h('h2', 'Needs attention'), a.items.length ? h('span.subtle', String(a.items.length)) : null), body);
    },
    { align: 'end', label: 'Needs attention', width: 380 },
  );
}

function openAccountMenu(anchor, onSignIn) {
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
              const ok = await confirmDialog({
                title: 'Sign out with unsaved changes?',
                message: 'Some changes have not reached the cloud yet. Signing out now discards them.',
                confirmLabel: 'Sign out anyway',
                danger: true,
              });
              if (!ok) return;
            }
            // A shared driver phone or shop tablet must not keep the fleet's
            // records around for the next person.
            const uuid = app.user?.uuid;
            app.store.detachCache();
            clearProfilePicture();
            try {
              localStorage.removeItem(`fleet.workspaces:${uuid}`);
              localStorage.removeItem('fleet.user');
              await clearUserCaches(uuid);
            } catch {}
            signOut();
            location.hash = '';
            reloadApp();
          },
        });
      return h(
        'div.account-pop',
        h(
          'div.row.account-head',
          avatar(app.user?.username || 'Guest', { color: '#55606e', img: app.avatarUrl, size: 'lg' }),
          h('div.grow', h('div.account-name', app.demo ? 'Demo mode' : app.user?.username || ''), h('div.subtle.account-sub', app.demo ? 'Nothing is saved' : 'Signed in with Puter')),
        ),
        h('div.menu-sep'),
        h(
          'div.account-theme',
          h('div.menu-label', 'Appearance'),
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
        fleetSwitcher(close),
        h('div.menu-sep'),
        h('nav', { 'aria-label': 'Account' }, items),
        footer ? [h('div.menu-sep'), footer] : null,
      );
    },
    { align: 'end', label: 'Account and appearance', role: 'dialog' },
  );
}

/** Lists the person's own fleet and those they joined, when there is a choice. */
function fleetSwitcher(close) {
  const ws = app.workspaces;
  if (app.demo || !ws || !ws.joined?.length) return null;
  const current = app.team && app.team.role !== 'owner' ? app.team.url : 'own';
  const options = [
    { id: 'own', label: 'My fleet', sub: current === 'own' ? app.store.state.settings.company.name || '' : '' },
    ...ws.joined.map((j) => ({ id: j.url, label: j.business || 'Shared fleet', sub: j.role === 'admin' ? 'Admin' : j.role === 'driver' ? 'Driver' : 'Member' })),
  ];
  return [
    h('div.menu-sep'),
    h('div.menu-label', 'Fleet'),
    h(
      'div',
      { role: 'group', 'aria-label': 'Switch fleet' },
      options.map((o) =>
        h(
          'button.menu-item',
          {
            type: 'button',
            'aria-current': o.id === current ? 'true' : null,
            onClick: () => {
              close();
              if (o.id !== current) switchWorkspace(o.id);
            },
          },
          icon(o.id === 'own' ? 'truck' : 'building', 16),
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
    body: ({ close }) =>
      h(
        'nav.more-nav',
        { 'aria-label': 'All sections' },
        NAV.map((n) =>
          n.children
            ? h('section', h('h3.more-head', icon(n.icon, 16), n.label), h('ul.list', n.children.map((c) => h('li', h('a.list-item', { href: c.href, onClick: () => close() }, h('span.title.grow', c.label), icon('chevron-right', 16))))))
            : h('a.list-item.more-top', { href: n.href, onClick: () => close() }, icon(n.icon, 18), h('span.title.grow', n.label), icon('chevron-right', 16)),
        ),
        h('a.list-item.more-top', { href: '#/settings', onClick: () => close() }, icon('settings', 18), h('span.title.grow', 'Settings'), icon('chevron-right', 16)),
        h('a.list-item.more-top', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, icon('github', 18), h('span.title.grow', 'Source code on GitHub'), icon('external', 16)),
      ),
  });
}

// ---- Keyboard shortcuts ---------------------------------------------------

export const SHORTCUTS = [
  { keys: ['/'], label: 'Search' },
  { keys: ['N'], label: 'Add new' },
  { keys: ['?'], label: 'Show keyboard shortcuts' },
  { keys: ['['], label: 'Collapse or expand the sidebar' },
  ...NAV.map((n) => ({ keys: ['G', n.key.toUpperCase()], label: `Go to ${n.label}` })),
  { keys: ['G', ','], label: 'Go to Settings' },
  { keys: ['J', 'K'], label: 'Move through list rows', joiner: 'or' },
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
            s.keys.map((k, i) => [i ? h('span.subtle', s.joiner || 'then') : null, h('kbd', k)]),
          ),
        ),
        h('dd', s.label),
      ]),
    ),
  });
}

function installShortcuts({ toggleRail, addBtn }) {
  let gPending = false;
  let gTimer;
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        // Not over another dialog: jumping to a page would leave it open on top.
        if (document.querySelector('dialog[open]:not(.palette)')) return;
        e.preventDefault();
        openSearch();
      }
      return;
    }
    // Letters typed in an open menu or popover are its type-ahead, not shortcuts.
    if (isTypingTarget(e.target) || e.target.closest?.('.popover') || document.querySelector('dialog[open]')) return;
    if (gPending) {
      gPending = false;
      clearTimeout(gTimer);
      const k = e.key.toLowerCase();
      if (k === ',') return navigate('/settings');
      const item = NAV.find((n) => n.key === k);
      if (item) {
        e.preventDefault();
        navigate((item.href || item.children[0].href).slice(1));
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
      openCreateMenu(addBtn);
    } else if (e.key === '[') {
      toggleRail();
    } else if (e.key === 'g') {
      gPending = true;
      gTimer = setTimeout(() => (gPending = false), 1200);
    }
  });
}

export { openPopover };

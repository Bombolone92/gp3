/**
 * Application chrome: navigation rail, top bar, mobile tab bar, account
 * menu, create menu, sync indicator, keyboard shortcuts.
 */
import { h, isTypingTarget } from './dom.js';
import { icon } from './icons.js';
import { openMenu, openPopover } from './menu.js';
import { toast } from './toast.js';
import { openDialog, confirmDialog } from './dialog.js';
import { navigate, onRoute, currentRoute } from './router.js';
import { segmented, avatar } from './components.js';
import { getThemeMode, setThemeMode } from './theme.js';
import { app } from '../app.js';
import { openSearch } from './search.js';
import { createActions } from '../views/create.js';
import { canSignOut, signOut } from '../platform.js';
import { switchWorkspace } from '../team.js';
import { role, isFamily, isManager, myStudents, myName } from '../app.js';
import { unreadCount } from '../core/messages.js';
import { allAccounts } from '../core/billing.js';
import { personName } from '../core/format.js';

const REPO_URL = 'https://github.com/heyputer/everything';
const RAIL_KEY = 'childcare.rail';

const STAFF_NAV = [
  [
    { id: 'home', label: 'Home', icon: 'home', href: '#/', key: 'h' },
    { id: 'attendance', label: 'Check-in', icon: 'user-check', href: '#/attendance', key: 'a' },
    { id: 'activities', label: 'Activities', icon: 'notebook-pen', href: '#/activities', key: 'l' },
    { id: 'messages', label: 'Messages', icon: 'messages', href: '#/messages', key: 'm', badge: 'messages' },
  ],
  [
    { id: 'children', label: 'Children', icon: 'baby', href: '#/children', key: 'c' },
    { id: 'families', label: 'Families', icon: 'users', href: '#/families', key: 'f' },
    { id: 'rooms', label: 'Rooms', icon: 'door-open', href: '#/rooms', key: 'r' },
    { id: 'staff', label: 'Staff', icon: 'id-card', href: '#/staff', key: 's' },
  ],
  [
    { id: 'calendar', label: 'Calendar', icon: 'calendar-days', href: '#/calendar', key: 'e' },
    { id: 'menus', label: 'Menus', icon: 'utensils', href: '#/menus', key: 'u' },
    { id: 'billing', label: 'Billing', icon: 'wallet', href: '#/billing', key: 'b', badge: 'billing', manager: true },
    { id: 'reports', label: 'Reports', icon: 'chart', href: '#/reports', key: 'o' },
  ],
];

const FAMILY_NAV = [
  [
    { id: 'home', label: 'Today', icon: 'home', href: '#/', key: 'h' },
    { id: 'messages', label: 'Messages', icon: 'messages', href: '#/messages', key: 'm', badge: 'messages' },
    { id: 'calendar', label: 'Calendar', icon: 'calendar-days', href: '#/calendar', key: 'e' },
    { id: 'menus', label: 'Menus', icon: 'utensils', href: '#/menus', key: 'u' },
    { id: 'billing', label: 'Billing', icon: 'wallet', href: '#/billing', key: 'b', badge: 'billing' },
  ],
];

export function navGroups() {
  if (isFamily()) return FAMILY_NAV;
  return STAFF_NAV.map((g) => g.filter((n) => !n.manager || isManager()));
}

const allNav = () => navGroups().flat();
const tabbarIds = () => (isFamily() ? ['home', 'messages', 'calendar', 'billing'] : ['home', 'attendance', 'activities', 'messages']);

/** Which nav item a route belongs to. */
function sectionFor(route) {
  const first = route.path.split('/')[1] || 'home';
  const alias = { statements: 'billing', kiosk: 'attendance' };
  const id = alias[first] || first;
  return allNav().find((n) => n.id === id)?.id || (first === 'settings' ? 'settings' : 'home');
}

export function buildShell({ onSignIn } = {}) {
  const store = app.store;
  let railMode = 'expanded';
  try {
    railMode = localStorage.getItem(RAIL_KEY) === 'collapsed' ? 'collapsed' : 'expanded';
  } catch {}

  const main = h('main.content#main', { tabindex: '-1' });
  const navLinks = new Map();
  const tabLinks = new Map();
  const badges = new Map();

  const NAV = navGroups();
  const ALL_NAV = NAV.flat();
  const TABBAR = tabbarIds();
  const nav = h(
    'nav.rail-nav',
    { 'aria-label': 'Main' },
    NAV.map((group) =>
      h(
        'div.nav-group',
        group.map((item) => {
          const badge = item.badge ? h('span.nav-badge', { hidden: true }) : null;
          const dot = item.badge ? h('span.nav-dot', { hidden: true, 'aria-hidden': 'true' }) : null;
          if (badge) badges.set(item.badge, { badge, dot });
          const link = h(
            'a.nav-link',
            { href: item.href, title: item.label, 'data-nav': item.id },
            icon(item.icon, 19),
            h('span.label', item.label),
            badge,
            dot,
          );
          navLinks.set(item.id, link);
          return link;
        }),
      ),
    ),
  );

  const createBtn = isFamily()
    ? h('a.btn.primary', { href: '#/messages', title: 'Message the school' }, icon('send', 18), h('span.label', 'Message school'))
    : h('button.btn.primary', { type: 'button', title: 'Log or add (N)', onClick: (e) => openCreateMenu(e.currentTarget) }, icon('plus', 18), h('span.label', 'Log or add'));

  const railToggle = h('button.icon-btn.rail-toggle', {
    type: 'button',
    onClick: () => setRail(railMode === 'expanded' ? 'collapsed' : 'expanded'),
  });

  const schoolName = h('span.brand-name.truncate');
  const schoolSub = h('span.brand-sub.truncate');

  const rail = h(
    'aside.rail',
    h(
      'div.rail-brand',
      h('img.brand-mark', { src: './icons/icon-192.png', alt: '' }),
      h('div.brand-text', schoolName, schoolSub),
    ),
    h('div.rail-create', createBtn),
    nav,
    h(
      'div.rail-foot',
      h(
        'a.icon-btn',
        { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Source code on GitHub (opens in a new tab)', title: 'Source code on GitHub' },
        icon('github', 18),
      ),
      h('span.powered.grow', 'Powered by ', h('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener noreferrer' }, 'Puter')),
      railToggle,
    ),
  );

  // ---- Top bar ------------------------------------------------------------

  const syncEl = h('span.sync-status', { role: 'status', 'aria-live': 'polite' });
  const accountBtn = h('button.account-btn', { type: 'button', 'aria-label': 'Account and appearance', title: 'Account' });

  const topbar = h(
    'header.topbar',
    h('a.mobile-brand', { href: '#/', 'aria-label': 'Home' }, h('img', { src: './icons/icon-192.png', alt: '' }), h('span.truncate.mobile-school')),
    h(
      'button.search-trigger',
      { type: 'button', onClick: () => openSearch(), 'aria-label': 'Search', 'aria-keyshortcuts': '/' },
      icon('search', 17),
      h('span.label', isFamily() ? 'Search' : 'Search children, families, staff...'),
      h('span.kbd', '/'),
    ),
    h('div.spacer'),
    syncEl,
    isFamily() ? null : h('button.icon-btn.show-mobile', { type: 'button', 'aria-label': 'Log or add', onClick: (e) => openCreateMenu(e.currentTarget) }, icon('plus', 20)),
    h(
      'button.icon-btn.desktop-only',
      { type: 'button', 'aria-label': 'Keyboard shortcuts', title: 'Keyboard shortcuts (?)', onClick: () => showShortcuts() },
      icon('keyboard'),
    ),
    h('a.icon-btn.desktop-only', { href: '#/settings', 'aria-label': 'Settings', title: 'Settings' }, icon('settings')),
    accountBtn,
  );

  accountBtn.addEventListener('click', () => openAccountMenu(accountBtn, onSignIn));

  // ---- Demo banner ----------------------------------------------------------

  const banner = app.demo
    ? h(
        'section.demo-banner',
        { 'aria-label': 'Demo mode' },
        icon('info', 16),
        h(
          'span.grow',
          h('span.long', app.demoRole === 'family' ? 'You are previewing the family app for a sample school. Changes stay in this tab.' : 'You are exploring a sample school. Changes stay in this tab and disappear when you leave.'),
          h('span.short', app.demoRole === 'family' ? 'Family preview. Nothing is saved.' : 'Sample school. Nothing is saved.'),
        ),
        h(
          'a.btn.sm.ghost.hide-mobile',
          { href: app.demoRole === 'family' ? '?demo=1' : '?demo=family' },
          app.demoRole === 'family' ? 'Switch to director view' : 'Preview family app',
        ),
        h('button.btn.sm.primary', { type: 'button', onClick: () => onSignIn?.() }, h('span.long', 'Sign in to start your own'), h('span.short', 'Sign in')),
      )
    : null;

  // ---- Mobile tab bar -------------------------------------------------------

  const tabbar = h(
    'nav.tabbar',
    { 'aria-label': 'Main' },
    TABBAR.map((id) => {
      const item = ALL_NAV.find((n) => n.id === id);
      const a = h('a', { href: item.href }, icon(item.icon, 22), h('span', item.label));
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

  // ---- Live bits --------------------------------------------------------------

  function updateActive(route) {
    const section = sectionFor(route);
    for (const [id, a] of [...navLinks, ...tabLinks]) {
      if (id === section) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }

  function updateBrand() {
    const s = store.state.settings;
    const name = s.school.name || app.team?.school || 'Childcare';
    schoolName.textContent = name;
    schoolSub.textContent = roleLabel();
    const mb = topbar.querySelector('.mobile-school');
    if (mb) mb.textContent = name;
  }

  function updateBadges() {
    const who = { role: isFamily() ? 'family' : 'staff', uuid: app.user?.uuid || 'family' };
    const threads = isFamily() ? store.all('threads').filter((t) => (app.me.studentIds || []).includes(t.id)) : store.all('threads');
    const unread = unreadCount(threads, who);
    setBadge('messages', unread, `${unread} unread`, true);
    if (isManager() || isFamily()) {
      const ids = new Set(myStudents().map((s) => s.id));
      const accounts = allAccounts(store.all('invoices'), store.all('payments'), app.today());
      let overdue = 0;
      for (const [sid, acc] of accounts) if (ids.has(sid) && acc.overdue > 0) overdue++;
      setBadge('billing', overdue, isFamily() ? 'payment overdue' : `${overdue} overdue`, true);
    }
  }

  function setBadge(key, n, label, alert = false) {
    const b = badges.get(key);
    if (!b) return;
    b.badge.hidden = !n;
    b.dot.hidden = !n;
    b.badge.textContent = n > 99 ? '99+' : String(n);
    b.badge.title = label;
    b.badge.classList.toggle('alert', alert);
    const link = b.badge.closest('a');
    const base = link.querySelector('.label').textContent;
    link.setAttribute('aria-label', n ? `${base}, ${label}` : base);
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
    const name = app.demo ? myName() : app.user?.username || 'Guest';
    accountBtn.replaceChildren(avatar(name, { color: '#55606e', img: app.avatarUrl }));
  }

  onRoute(updateActive);
  updateActive(currentRoute());
  updateBrand();
  updateBadges();
  updateSync();
  updateAccount();
  store.subscribe((changed) => {
    if (changed.has('settings')) updateBrand();
    if (changed.has('sync')) updateSync();
    if (changed.has('rejected')) toast(store.state.error || 'A change could not be saved.', { type: 'error', duration: 8000 });
    if (changed.has('threads') || changed.has('invoices') || changed.has('payments') || changed.has('students')) updateBadges();
    else if (changed.size && !changed.has('sync')) updateSync();
  });
  // Re-derive date-based badges when the day rolls over.
  setInterval(updateBadges, 5 * 60 * 1000);

  installShortcuts({ toggleRail: () => setRail(railMode === 'expanded' ? 'collapsed' : 'expanded'), createBtn, allNav: ALL_NAV });

  return { root, main, updateAccount };
}

// ---- Menus ----------------------------------------------------------------

export function openCreateMenu(anchor) {
  const items = createActions().map((a) => (a.separator ? a : { label: a.label, icon: a.icon, run: a.run, hint: a.hint }));
  openMenu(anchor, items, { label: 'Log or add' });
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
              const ok = await confirmDialog({
                title: 'Sign out with unsaved changes?',
                message: 'Some changes have not reached the cloud yet. Signing out now discards them.',
                confirmLabel: 'Sign out anyway',
                danger: true,
              });
              if (!ok) return;
            }
            await signOut(app.user?.uuid);
            location.hash = '';
            location.reload();
          },
        });
      return h(
        'div.account-pop',
        h(
          'div.row',
          { style: { padding: '10px 10px 12px' } },
          avatar(app.demo ? myName() : app.user?.username || 'Guest', { color: '#55606e', img: app.avatarUrl, size: 'lg' }),
          h(
            'div.grow',
            h('div', { style: { fontWeight: '700' } }, app.demo ? (app.demoRole === 'family' ? 'Family preview' : 'Demo mode') : app.user?.username || ''),
            h('div.subtle', { style: { fontSize: '12px' } }, app.demo ? 'Nothing is saved' : `${roleLabel()} · Signed in with Puter`),
          ),
        ),
        h('div.menu-sep'),
        h(
          'div',
          { style: { padding: '6px 10px 10px' } },
          h('div.menu-label#theme-label', { style: { padding: '0 0 8px' } }, 'Appearance'),
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
        schoolSwitcher(close),
        h('div.menu-sep'),
        h('nav', { 'aria-label': 'Account' }, items),
        footer ? [h('div.menu-sep'), footer] : null,
      );
    },
    { align: 'end', label: 'Account and appearance', role: 'dialog' },
  );
}

function roleLabel() {
  const r = role();
  if (app.demo) return app.demoRole === 'family' ? 'Family preview' : 'Sample school';
  if (r === 'parent') {
    const g = app.store.get('guardians', app.me.guardianId);
    return g ? `Family · ${personName(g)}` : 'Family';
  }
  return r === 'owner' ? 'Director' : r === 'admin' ? 'Admin' : 'Staff';
}

/** Lists the person's own school and those they joined, when there is a choice. */
function schoolSwitcher(close) {
  const ws = app.workspaces;
  if (app.demo || !ws || !ws.joined?.length) return null;
  const current = app.team && app.team.role !== 'owner' ? app.team.url : 'own';
  const label = (r) => (r === 'parent' ? 'Family' : r === 'admin' ? 'Admin' : 'Staff');
  const options = [{ id: 'own', label: 'My school', sub: app.team?.role === 'owner' || current === 'own' ? app.store.state.settings.school.name || '' : '' }, ...ws.joined.map((j) => ({ id: j.url, label: j.school || 'School', sub: label(j.role) }))];
  return [
    h('div.menu-sep'),
    h('div.menu-label', 'School'),
    h(
      'div',
      { role: 'group', 'aria-label': 'Switch school' },
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
          icon(o.id === 'own' ? 'home' : 'school', 16),
          h('span.grow', o.label, o.sub ? h('span.menu-desc', o.sub) : null),
          o.id === current ? icon('check', 16) : null,
        ),
      ),
    ),
  ];
}

function openMoreSheet() {
  const tabs = tabbarIds();
  const more = [...allNav().filter((n) => !tabs.includes(n.id)), ...(isFamily() ? [] : [{ id: 'kiosk', label: 'Check-in kiosk', icon: 'tablet', href: '#/kiosk' }])];
  openDialog({
    title: 'More',
    body: ({ close }) =>
      h(
        'nav',
        { 'aria-label': 'More sections' },
        h(
          'ul.list',
          [...more, { id: 'settings', label: 'Settings', icon: 'settings', href: '#/settings' }].map((n) =>
            h('li', h('a.list-item', { href: n.href, onClick: () => close() }, icon(n.icon, 20), h('span.title', n.label))),
          ),
          h(
            'li',
            h(
              'a.list-item',
              { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' },
              icon('github', 20),
              h('span.title.grow', 'Source code on GitHub'),
              icon('external', 16),
            ),
          ),
        ),
      ),
  });
}

// ---- Keyboard shortcuts ---------------------------------------------------

export function shortcuts() {
  return [
    { keys: ['/'], label: 'Search' },
    ...(isFamily() ? [] : [{ keys: ['N'], label: 'Log an activity or add something' }]),
    { keys: ['?'], label: 'Show keyboard shortcuts' },
    { keys: ['['], label: 'Collapse or expand navigation' },
    ...allNav().map((n) => ({ keys: ['G', n.key.toUpperCase()], label: `Go to ${n.label}` })),
    { keys: ['G', ','], label: 'Go to Settings' },
    { keys: ['Esc'], label: 'Close dialog or menu' },
  ];
}

export function showShortcuts() {
  openDialog({
    title: 'Keyboard shortcuts',
    body: h(
      'dl.kv',
      { style: { gridTemplateColumns: 'max-content 1fr', alignItems: 'center' } },
      shortcuts().map((s) => [
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

function installShortcuts({ toggleRail, createBtn, allNav: ALL_NAV }) {
  let gPending = false;
  let gTimer;
  document.addEventListener('keydown', (e) => {
    if (app.kioskLock) return;
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openSearch();
      }
      return;
    }
    if (isTypingTarget(e.target) || document.querySelector('dialog[open]')) return;
    if (gPending) {
      gPending = false;
      clearTimeout(gTimer);
      const k = e.key.toLowerCase();
      if (k === ',') return navigate('/settings');
      const item = ALL_NAV.find((n) => n.key === k);
      if (item) {
        e.preventDefault();
        navigate(item.href.slice(1));
      }
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      openSearch();
    } else if (e.key === '?') {
      e.preventDefault();
      showShortcuts();
    } else if ((e.key === 'n' || e.key === 'N') && !isFamily()) {
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

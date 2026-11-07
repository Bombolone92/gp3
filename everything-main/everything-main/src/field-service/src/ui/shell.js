/**
 * Application chrome: navigation rail, top bar, mobile tab bar, account
 * menu, create menu, sync indicator, keyboard shortcuts.
 */
import { h, isTypingTarget } from './dom.js';
import { icon } from './icons.js';
import { openMenu, openPopover } from './menu.js';
import { openDialog } from './dialog.js';
import { navigate, onRoute, currentRoute } from './router.js';
import { segmented, avatar } from './components.js';
import { getThemeMode, setThemeMode } from './theme.js';
import { app } from '../app.js';
import { openSearch } from './search.js';
import { createActions } from '../views/create.js';
import { canSignOut, signOut } from '../platform.js';
import { jobStatus, invoiceStatus, requestStatus } from '../core/status.js';

const REPO_URL = 'https://github.com/heyputer/everything';
const RAIL_KEY = 'fieldservice.rail';

export const NAV = [
  [
    { id: 'home', label: 'Home', icon: 'home', href: '#/', key: 'h' },
    { id: 'schedule', label: 'Schedule', icon: 'calendar-days', href: '#/schedule', key: 's' },
  ],
  [
    { id: 'clients', label: 'Clients', icon: 'users', href: '#/clients', key: 'c' },
    { id: 'requests', label: 'Requests', icon: 'inbox', href: '#/requests', key: 'r', badge: 'requests' },
    { id: 'quotes', label: 'Quotes', icon: 'file-pen', href: '#/quotes', key: 'q' },
    { id: 'jobs', label: 'Jobs', icon: 'hammer', href: '#/jobs', key: 'j', badge: 'jobs' },
    { id: 'invoices', label: 'Invoices', icon: 'receipt-text', href: '#/invoices', key: 'i', badge: 'invoices' },
    { id: 'payments', label: 'Payments', icon: 'wallet', href: '#/payments', key: 'p' },
  ],
  [
    { id: 'timesheets', label: 'Timesheets', icon: 'clock', href: '#/timesheets', key: 't' },
    { id: 'expenses', label: 'Expenses', icon: 'receipt', href: '#/expenses', key: 'e' },
    { id: 'reports', label: 'Reports', icon: 'chart', href: '#/reports', key: 'o' },
  ],
];

const ALL_NAV = NAV.flat();
const TABBAR = ['home', 'schedule', 'clients', 'jobs'];

/** Which nav item a route belongs to. */
function sectionFor(route) {
  const first = route.path.split('/')[1] || 'home';
  return ALL_NAV.find((n) => n.id === first)?.id || (first === 'settings' ? 'settings' : 'home');
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

  const createBtn = h(
    'button.btn.primary',
    { type: 'button', title: 'Create (N)', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onClick: (e) => openCreateMenu(e.currentTarget) },
    icon('plus', 18),
    h('span.label', 'Create'),
  );

  const railToggle = h('button.icon-btn.rail-toggle', {
    type: 'button',
    onClick: () => setRail(railMode === 'expanded' ? 'collapsed' : 'expanded'),
  });

  const businessName = h('span.brand-name.truncate');
  const businessSub = h('span.brand-sub.truncate');

  const rail = h(
    'aside.rail',
    h(
      'div.rail-brand',
      h('img.brand-mark', { src: './icons/icon-192.png', alt: '' }),
      h('div.brand-text', businessName, businessSub),
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
  const accountBtn = h('button.account-btn', { type: 'button', 'aria-label': 'Account and appearance', title: 'Account', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });

  const topbar = h(
    'header.topbar',
    h('a.mobile-brand', { href: '#/', 'aria-label': 'Home' }, h('img', { src: './icons/icon-192.png', alt: '' }), h('span.truncate.mobile-business')),
    h(
      'button.search-trigger',
      { type: 'button', onClick: () => openSearch(), 'aria-label': 'Search', 'aria-keyshortcuts': '/' },
      icon('search', 17),
      h('span.label', 'Search clients, jobs, quotes...'),
      h('span.kbd', '/'),
    ),
    h('div.spacer'),
    syncEl,
    h('button.icon-btn.show-mobile', { type: 'button', 'aria-label': 'Create', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onClick: (e) => openCreateMenu(e.currentTarget) }, icon('plus', 20)),
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
        h('span.grow', h('span.long', 'You are exploring a demo business. Changes stay in this tab and disappear when you leave.'), h('span.short', 'Demo business. Changes are not saved.')),
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
    businessName.textContent = s.company.name || 'Field Service';
    businessSub.textContent = app.demo ? 'Demo business' : app.team && app.team.role !== 'owner' ? `Team member${app.user ? ' · ' + app.user.username : ''}` : app.user?.username || '';
    const mb = topbar.querySelector('.mobile-business');
    if (mb) mb.textContent = s.company.name || 'Field Service';
  }

  function updateBadges() {
    const today = app.today();
    const reqs = store.all('requests').filter((r) => requestStatus(r, today) === 'new').length;
    const invoices = store.all('invoices');
    const payments = store.all('payments');
    const pastDue = invoices.filter((i) => invoiceStatus(i, today, payments) === 'past_due').length;
    const toInvoice = store.all('jobs').filter((j) => jobStatus(j, today, invoices) === 'requires_invoicing').length;
    setBadge('requests', reqs, `${reqs} new`);
    setBadge('jobs', toInvoice, `${toInvoice} to invoice`);
    setBadge('invoices', pastDue, `${pastDue} past due`, true);
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

  let lastSync = '';
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
    } else if (st.error) {
      // Online with an error: the server refused a change for good.
      cls = 'error';
      ic = 'alert';
      text = 'Some changes not saved';
    }
    const title = st.error ? (st.online ? st.error : `Changes are kept on this device and will sync when the connection returns. (${st.error})`) : text;
    // Only touch the DOM when something changed, so it is not re-announced.
    const key = `${cls}|${ic}|${text}|${title}`;
    if (key === lastSync) return;
    lastSync = key;
    syncEl.className = `sync-status ${cls}`;
    syncEl.replaceChildren(icon(ic, 15), h('span.label', text));
    syncEl.title = title;
  }

  function updateAccount() {
    const name = app.user?.username || 'Guest';
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
    // Any change can start a save, so the indicator always takes a look.
    if (changed.size) updateSync();
    if (changed.has('requests') || changed.has('jobs') || changed.has('invoices') || changed.has('payments')) updateBadges();
  });
  // Re-derive date-based badges when the day rolls over.
  setInterval(updateBadges, 5 * 60 * 1000);

  installShortcuts({ toggleRail: () => setRail(railMode === 'expanded' ? 'collapsed' : 'expanded'), createBtn });
  // A field flagged as invalid stops being flagged once it is edited.
  const clearInvalid = (e) => e.target?.getAttribute?.('aria-invalid') === 'true' && e.target.removeAttribute('aria-invalid');
  document.addEventListener('input', clearInvalid, true);
  document.addEventListener('change', clearInvalid, true);

  return { root, main, updateAccount };
}

// ---- Menus ----------------------------------------------------------------

export function openCreateMenu(anchor) {
  const items = createActions().map((a) => ({ label: a.label, icon: a.icon, run: a.run, hint: a.hint }));
  openMenu(anchor, [{ heading: 'Create new' }, ...items], { label: 'Create new' });
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
            // A shared crew tablet must not keep the business's clients and
            // invoices around for the next person.
            const uuid = app.user?.uuid;
            try {
              await app.store.close();
              await Promise.all([import('../core/cache.js').then((c) => c.clearUserCaches(uuid)), import('../platform.js').then((p) => p.clearProfilePicture())]);
              localStorage.removeItem(`fieldservice.workspaces:${uuid}`);
            } catch {}
            signOut();
            location.hash = '';
            location.reload();
          },
        });
      return h(
        'div.account-pop',
        h(
          'div.row',
          { style: { padding: '10px 10px 12px' } },
          avatar(app.user?.username || 'Guest', { color: '#55606e', img: app.avatarUrl, size: 'lg' }),
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
        businessSwitcher(close),
        h('div.menu-sep'),
        h('nav', { 'aria-label': 'Account' }, items),
        footer ? [h('div.menu-sep'), footer] : null,
      );
    },
    { align: 'end', label: 'Account and appearance', role: 'dialog' },
  );
}

/** Lists the person's own business and those they joined, when there is a choice. */
function businessSwitcher(close) {
  const ws = app.workspaces;
  if (app.demo || !ws || !ws.joined?.length) return null;
  const current = app.team && app.team.role !== 'owner' ? app.team.url : 'own';
  const options = [{ id: 'own', label: 'My business', sub: app.team?.role === 'owner' || current === 'own' ? app.store.state.settings.company.name || '' : '' }, ...ws.joined.map((j) => ({ id: j.url, label: j.business || 'Team business', sub: j.role === 'admin' ? 'Admin' : 'Team member' }))];
  return [
    h('div.menu-sep'),
    h('div.menu-label', 'Business'),
    h(
      'div',
      { role: 'group', 'aria-label': 'Switch business' },
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
  const more = ALL_NAV.filter((n) => !TABBAR.includes(n.id));
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
      'dl.kv',
      { style: { gridTemplateColumns: 'max-content 1fr', alignItems: 'center' } },
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        // Not on top of another dialog, whose work would be left behind it.
        if (!document.querySelector('dialog[open]:not(.palette)')) openSearch();
      }
      return;
    }
    // Menus use letters to jump to items.
    if (isTypingTarget(e.target) || document.querySelector('dialog[open]') || e.target.closest?.('.popover')) return;
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

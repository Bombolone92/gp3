/**
 * The agent workspace frame: navigation rail, top bar with ticket tabs,
 * search, notifications and the profile menu, and the main region where
 * routed views mount. On phones the rail becomes a bottom tab bar.
 */
import { h, clear, announce } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openMenu, closePopover } from '../ui/popover.js';
import { avatar } from '../ui/components.js';
import { bind, label as keyLabel } from '../ui/shortcuts.js';
import { applyTheme, savedTheme } from '../ui/theme.js';
import { onRoute, go, current, confirmLeave } from '../ui/router.js';
import { app } from '../app.js';
import { canSignOut, signOut } from '../client/puter.js';
import { LOCAL } from '../client/api.js';
import { showShortcuts } from './shortcuts-dialog.js';
import { notifications } from './notifications.js';
import { STATUS_LABEL } from '../shared/model.js';
import { watchMailbox } from '../client/mailbox.js';
import { toast } from '../ui/toast.js';
import { forgetLocalData } from '../client/cache.js';

export const REPO_URL = 'https://github.com/heyputer/everything';

const VIEWS = {
  home: () => import('./home.js'),
  views: () => import('./views.js'),
  ticket: () => import('./ticket.js'),
  customers: () => import('./customers.js'),
  customer: () => import('./customer.js'),
  orgs: () => import('./orgs.js'),
  org: () => import('./org.js'),
  kb: () => import('./kb.js'),
  reports: () => import('./reports.js'),
  admin: () => import('./admin.js'),
  search: () => import('./search.js'),
};

const NAV = [
  { id: 'home', label: 'Home', icon: 'house', href: '#/home', key: 'g h' },
  { id: 'views', label: 'Views', icon: 'inbox', href: '#/views', key: 'g v' },
  { id: 'customers', label: 'Customers', icon: 'users', href: '#/customers', key: 'g u' },
  { id: 'orgs', label: 'Organizations', icon: 'building', href: '#/orgs', key: 'g o' },
  { id: 'kb', label: 'Knowledge base', icon: 'book-open', href: '#/kb', key: 'g k' },
  { id: 'reports', label: 'Reports', icon: 'chart-column', href: '#/reports', key: 'g r' },
];

function resolve(route) {
  const [a, b] = route.path;
  switch (a) {
    case undefined:
    case 'home':
      return { view: 'home', nav: 'home' };
    case 'views':
      return { view: 'views', nav: 'views', id: b || null };
    case 'tickets':
      return { view: 'ticket', nav: null, id: b };
    case 'customers':
      return b ? { view: 'customer', nav: 'customers', id: Number(b) } : { view: 'customers', nav: 'customers' };
    case 'orgs':
      return b ? { view: 'org', nav: 'orgs', id: Number(b) } : { view: 'orgs', nav: 'orgs' };
    case 'kb':
      return { view: 'kb', nav: 'kb', sub: route.path.slice(1) };
    case 'reports':
      return { view: 'reports', nav: 'reports', sub: b || null };
    case 'admin':
      return { view: 'admin', nav: 'admin', sub: b || null };
    case 'search':
      return { view: 'search', nav: null };
    default:
      return { view: 'home', nav: 'home' };
  }
}

export function mountShell(root) {
  clear(root);
  const main = h('main#main.main', { tabindex: '-1' });
  const navLinks = new Map();

  const navItem = (item) => {
    const a = h('a.rail-item', { href: item.href, 'aria-label': item.label, title: `${item.label} (${keyLabel(item.key)})` }, icon(item.icon, { size: 20 }), h('span.rail-label', item.label));
    navLinks.set(item.id, a);
    return a;
  };

  const adminLink = navItem({ id: 'admin', label: 'Admin', icon: 'settings', href: '#/admin', key: 'g a' });
  const rail = h(
    'nav.rail', { 'aria-label': 'Main' },
    h('a.rail-logo', { href: '#/home', 'aria-label': 'Help Desk home' }, h('img', { src: './icon-192.png', alt: '', width: 28, height: 28 })),
    h('div.rail-items', NAV.map(navItem)),
    h('div.rail-bottom',
      h('a.rail-item.rail-github', { href: REPO_URL, target: '_blank', rel: 'noopener', 'aria-label': 'Source code on GitHub (opens in a new tab)', title: 'Source code on GitHub' }, icon('github', { size: 18 })),
      adminLink,
    ),
  );

  /* Top bar */
  const deskBtn = h('button.desk-switch', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => openDeskMenu(deskBtn) });
  const tabsEl = h('nav.tabs', { 'aria-label': 'Open tickets' });
  const addBtn = h('button.btn.btn-ghost.add-btn', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => openAddMenu(addBtn) }, icon('plus', { size: 16 }), h('span.add-label', 'Add'));
  const searchBtn = h('button.search-btn', { type: 'button', onclick: () => go('/search'), 'aria-label': 'Search (press /)' }, icon('search', { size: 16 }), h('span.search-label', 'Search'), h('kbd', '/'));
  const statusEl = h('span.conn', { role: 'status' });
  const bell = notifications.button();
  const profileBtn = h('button.profile-btn', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Your profile and settings', onclick: () => openProfileMenu(profileBtn) });
  const topbar = h('header.topbar', deskBtn, h('div.tabs-wrap', tabsEl, addBtn), h('div.topbar-end', statusEl, searchBtn, bell, profileBtn));

  /* Mobile bottom bar */
  const bottomLinks = new Map();
  const bottom = h('nav.bottombar', { 'aria-label': 'Main' },
    [NAV[0], NAV[1], NAV[2], NAV[4]].map((item) => {
      const a = h('a.bottom-item', { href: item.href }, icon(item.icon, { size: 20 }), h('span', item.label === 'Knowledge base' ? 'Articles' : item.label));
      bottomLinks.set(item.id, a);
      return a;
    }),
    h('button.bottom-item', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: (e) => openMoreMenu(e.currentTarget) }, icon('menu', { size: 20 }), h('span', 'More')),
  );

  root.append(h('a.skip-link', { href: '#main', onclick: (e) => { e.preventDefault(); main.focus(); } }, 'Skip to content'), rail, h('div.workspace', topbar, main), bottom);

  function paintDesk() {
    clear(deskBtn);
    const meta = app.replica?.meta;
    deskBtn.append(h('span.desk-name.ellipsis', meta?.name || 'Help desk'), icon('chevron-down', { size: 14 }));
    deskBtn.setAttribute('aria-label', `Help desk: ${meta?.name || ''}. Switch help desk`);
    adminLink.hidden = !app.isAdmin;
    clear(profileBtn);
    const me = app.me;
    profileBtn.append(avatar(me?.name || app.user?.username || '?', { username: '' }));
  }

  function paintStatus() {
    const s = app.replica?.status;
    clear(statusEl);
    if (s === 'offline') statusEl.append(h('span.conn-pill', icon('wifi-off', { size: 14 }), 'Offline, retrying'));
    else if (s === 'loading') statusEl.append(h('span.conn-pill', h('span.spinner'), 'Syncing'));
  }

  function tabTitle(tab) {
    if (tab.id === 'new' || String(tab.id).startsWith('new')) return { title: 'New ticket', sub: '' };
    const t = app.replica?.tickets.get(Number(tab.id));
    if (!t) return { title: `Ticket #${tab.id}`, sub: '' };
    return { title: t.subject, sub: `#${t.id}`, status: t.status };
  }

  function paintTabs() {
    clear(tabsEl);
    const r = current();
    const activeId = r.path[0] === 'tickets' ? r.path[1] : null;
    for (const tab of app.tabs) {
      const { title, sub, status } = tabTitle(tab);
      const active = String(tab.id) === String(activeId);
      const el = h(
        `div.tab${active ? '.active' : ''}`,
        {},
        h('a.tab-link', {
          href: `#/tickets/${tab.id}`, 'aria-current': active ? 'page' : undefined, title: `${title}${sub ? ` ${sub}` : ''}`,
        },
        status ? h(`span.tab-status.status.${status}`, { 'aria-label': STATUS_LABEL[status] }) : icon('square-pen', { size: 14 }),
        h('span.tab-text', h('span.tab-title', title), sub ? h('span.tab-sub', sub) : null)),
        h('button.tab-close', {
          type: 'button', 'aria-label': `Close ${title}`,
          onclick: () => closeTab(tab.id),
        }, icon('x', { size: 14 })),
      );
      tabsEl.append(el);
    }
  }

  function closeTab(id) {
    const r = current();
    const wasActive = r.path[0] === 'tickets' && String(r.path[1]) === String(id);
    const next = app.closeTab(String(id));
    if (wasActive) go(next ? `/tickets/${next.id}` : app.lastListRoute);
  }

  function paintNav(nav) {
    for (const [id, a] of navLinks) {
      if (id === nav) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    for (const [id, a] of bottomLinks) {
      if (id === nav) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }

  /* Menus */
  function openDeskMenu(anchor) {
    const items = [{ heading: 'Help desks' }];
    for (const d of app.desks()) {
      const ref = `${d.server}/${d.desk}`;
      items.push({
        label: d.name || 'Help desk', desc: d.server === LOCAL ? 'On this account only' : d.role === 'owner' ? 'Owner' : d.role === 'admin' ? 'Administrator' : 'Agent',
        checked: ref === app.ref,
        run: async () => {
          if (ref !== app.ref && await confirmLeave()) app.emit('switch', { server: d.server, desk: d.desk });
        },
      });
    }
    items.push({ separator: true }, { label: 'Create a help desk', icon: 'plus', run: async () => { if (await confirmLeave()) app.emit('create'); } });
    if (app.helpCenterUrl()) items.push({ label: 'Open help center', icon: 'external-link', run: () => window.open(app.helpCenterUrl(), '_blank', 'noopener') });
    openMenu(anchor, items, { label: 'Help desks' });
  }

  function openAddMenu(anchor) {
    openMenu(anchor, [
      { label: 'Ticket', icon: 'inbox', shortcut: 'C', run: () => go('/tickets/new') },
      { label: 'Customer', icon: 'user-plus', run: () => import('./customers.js').then((m) => m.newCustomerDialog()) },
      { label: 'Organization', icon: 'building', run: () => import('./orgs.js').then((m) => m.newOrgDialog()) },
      { label: 'Article', icon: 'file-text', run: () => go('/kb/new') },
    ], { label: 'Add' });
  }

  function profileItems() {
    const me = app.me;
    const theme = savedTheme();
    const items = [
      { heading: `${me?.name || ''}${me?.role ? ` · ${me.role === 'owner' ? 'Owner' : me.role === 'admin' ? 'Administrator' : 'Agent'}` : ''}` },
      { label: 'Edit your profile', icon: 'user', run: () => import('./profile.js').then((m) => m.profileDialog()) },
      { separator: true },
      { heading: 'Appearance' },
      { label: 'System', icon: 'monitor', checked: theme === 'system', run: () => applyTheme('system') },
      { label: 'Light', icon: 'sun', checked: theme === 'light', run: () => applyTheme('light') },
      { label: 'Dark', icon: 'moon', checked: theme === 'dark', run: () => applyTheme('dark') },
      { separator: true },
      { label: 'Keyboard shortcuts', icon: 'keyboard', shortcut: '?', run: showShortcuts },
      { label: 'Source code on GitHub', icon: 'github', run: () => window.open(REPO_URL, '_blank', 'noopener') },
    ];
    if (canSignOut()) {
      items.push({ separator: true }, {
        label: 'Sign out', icon: 'log-out',
        run: async () => {
          if (!await confirmLeave()) return;
          // Nothing of the desk stays behind in this browser for the next
          // person to use it.
          app.replica?.close({ save: false });
          await forgetLocalData();
          await signOut();
          location.hash = '';
          location.reload();
        },
      });
    }
    return items;
  }

  function openProfileMenu(anchor) {
    openMenu(anchor, profileItems(), { label: 'Profile', align: 'end' });
  }

  function openMoreMenu(anchor) {
    openMenu(anchor, [
      { label: 'Organizations', icon: 'building', run: () => go('/orgs') },
      { label: 'Reports', icon: 'chart-column', run: () => go('/reports') },
      app.isAdmin ? { label: 'Admin', icon: 'settings', run: () => go('/admin') } : null,
      { label: 'Search', icon: 'search', run: () => go('/search') },
      { separator: true },
      ...profileItems().slice(1),
    ], { label: 'More', align: 'end', side: 'top' });
  }

  /* Routing */
  let unmount = null;
  let token = 0;
  async function route(r) {
    const target = resolve(r);
    const my = ++token;
    // A menu from the page being left would act on a screen that is gone.
    closePopover();
    paintNav(target.nav);
    if (target.view === 'ticket' && target.id) {
      app.openTab({ id: String(target.id) });
    }
    if (['views', 'home', 'search'].includes(target.view)) app.lastListRoute = r.hash;
    paintTabs();
    const mod = await VIEWS[target.view]();
    if (my !== token) return;
    if (unmount) {
      try {
        unmount();
      } catch (e) {
        console.error(e);
      }
      unmount = null;
    }
    clear(main);
    main.dataset.view = target.view;
    unmount = mod.mount(main, { ...target, route: r }) || null;
    if (document.activeElement === document.body || !document.activeElement) main.focus({ preventScroll: true });
  }

  const offRoute = onRoute(route);
  const onChange = (e) => {
    const kinds = e.detail?.kinds;
    if (!kinds || kinds.has('t')) paintTabs();
    if (!kinds || kinds.has('d') || kinds.has('m')) paintDesk();
  };
  app.replica.addEventListener('change', onChange);
  app.replica.addEventListener('status', paintStatus);
  app.addEventListener('tabs', paintTabs);
  notifications.attach(app.replica);

  bind('global', {
    '/': () => go('/search'),
    'mod+k': () => go('/search'),
    '?': showShortcuts,
    c: () => go('/tickets/new'),
    'g h': () => go('/home'),
    'g v': () => go('/views'),
    'g u': () => go('/customers'),
    'g o': () => go('/orgs'),
    'g k': () => go('/kb'),
    'g r': () => go('/reports'),
    'g a': () => app.isAdmin && go('/admin'),
    'alt+w': () => {
      const r = current();
      if (r.path[0] === 'tickets') closeTab(r.path[1]);
    },
    'alt+arrowright': () => cycleTab(1),
    'alt+arrowleft': () => cycleTab(-1),
  });

  function cycleTab(dir) {
    if (!app.tabs.length) return;
    const r = current();
    const i = app.tabs.findIndex((t) => r.path[0] === 'tickets' && String(t.id) === String(r.path[1]));
    // From a page that is not a tab, next is the first tab and previous the last.
    const from = i < 0 ? (dir > 0 ? -1 : 0) : i;
    const next = app.tabs[(from + dir + app.tabs.length) % app.tabs.length];
    go(`/tickets/${next.id}`);
    announce(`Ticket tab ${next.id}`);
  }

  const stopMailbox = watchMailbox(app, {
    onImported: (s) => {
      const parts = [];
      if (s.created) parts.push(`${s.created} new request${s.created === 1 ? '' : 's'}`);
      if (s.appended) parts.push(`${s.appended} repl${s.appended === 1 ? 'y' : 'ies'}`);
      toast(`From email: ${parts.join(' and ')}.`, { kind: 'info' });
    },
  });

  paintDesk();
  paintStatus();
  route(current());

  return () => {
    stopMailbox();
    offRoute();
    // A route still loading its screen must not mount it into this shell
    // once it is gone (switching desks starts one just before this runs).
    token++;
    if (unmount) unmount();
    unmount = null;
    app.replica?.removeEventListener('change', onChange);
    app.replica?.removeEventListener('status', paintStatus);
    app.removeEventListener('tabs', paintTabs);
  };
}

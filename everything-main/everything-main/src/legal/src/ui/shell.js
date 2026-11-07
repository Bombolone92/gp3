/**
 * Application chrome: navigation rail, top bar (search, timer, create,
 * alerts, account), mobile tab bar, and keyboard shortcuts.
 */
import { h, isTypingTarget, rafThrottle } from './dom.js';
import { icon } from './icons.js';
import { openMenu, openPopover } from './menu.js';
import { openDialog, confirmDialog } from './dialog.js';
import { navigate, onRoute, currentRoute } from './router.js';
import { segmented, avatar, textInput, field } from './components.js';
import { getThemeMode, setThemeMode } from './theme.js';
import { app, lookup, meId } from '../app.js';
import { openSearch } from './search.js';
import { createActions } from '../views/create.js';
import { canSignOut, signOut } from '../platform.js';
import { switchWorkspace } from '../team.js';
import { getTimer, onTimerChange, elapsedMs, toggleTimer, updateTimer, resetTimer } from './timer.js';
import { formatClock } from '../core/duration.js';
import { matterLabel } from '../core/format.js';
import { formatDate, diffDays, formatTime } from '../core/dates.js';
import { billStatus, trustBalance } from '../core/finance.js';
import { APP_NAME, allowUnload, hasUnsavedEdits } from './viewhost.js';

export const REPO_URL = 'https://github.com/heyputer/everything';
const RAIL_KEY = 'legal.rail';

export const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', href: '#/', key: 'd' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', href: '#/calendar', key: 'c' },
  { id: 'tasks', label: 'Tasks', icon: 'list-checks', href: '#/tasks', key: 't', badge: 'tasks' },
  { id: 'matters', label: 'Matters', icon: 'briefcase', href: '#/matters', key: 'm' },
  { id: 'contacts', label: 'Contacts', icon: 'contact', href: '#/contacts', key: 'o' },
  { id: 'activities', label: 'Activities', icon: 'clock', href: '#/activities', key: 'a' },
  { id: 'billing', label: 'Billing', icon: 'receipt-text', href: '#/billing', key: 'b', badge: 'billing' },
  { id: 'accounts', label: 'Accounts', icon: 'landmark', href: '#/accounts', key: 'u' },
  { id: 'documents', label: 'Documents', icon: 'folder', href: '#/documents', key: 'f' },
  { id: 'communications', label: 'Communications', icon: 'messages', href: '#/communications', key: 'e' },
  { id: 'reports', label: 'Reports', icon: 'chart', href: '#/reports', key: 'r' },
];

const TABBAR = ['dashboard', 'matters', 'calendar', 'activities'];

/** Which nav item a route belongs to. */
function sectionFor(route) {
  const first = route.path.split('/')[1] || 'dashboard';
  if (first === 'bills') return 'billing';
  return NAV.find((n) => n.id === first)?.id || (first === 'settings' ? 'settings' : 'dashboard');
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
    NAV.map((item) => {
      const badge = item.badge ? h('span.nav-badge', { hidden: true }) : null;
      if (badge) badges.set(item.badge, badge);
      const link = h('a.nav-link', { href: item.href, 'data-tip': item.label }, icon(item.icon, 18), h('span.label', item.label), badge);
      navLinks.set(item.id, link);
      return link;
    }),
  );

  const railToggle = h('button.nav-link.rail-toggle', { type: 'button', onClick: () => setRail(railMode === 'expanded' ? 'collapsed' : 'expanded') });
  const firmName = h('span.brand-name.truncate');
  const firmSub = h('span.brand-sub.truncate');
  const settingsLink = h('a.nav-link', { href: '#/settings', 'data-tip': 'Settings' }, icon('settings', 18), h('span.label', 'Settings'));
  navLinks.set('settings', settingsLink);

  const rail = h(
    'aside.rail',
    h('a.rail-brand', { href: '#/', 'aria-label': `${APP_NAME} dashboard` }, h('img.brand-mark', { src: './icons/icon.svg', alt: '' }), h('span.brand-text', firmName, firmSub)),
    nav,
    h(
      'div.rail-foot',
      settingsLink,
      h(
        'a.nav-link',
        { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer', 'data-tip': 'Source code on GitHub', 'aria-label': 'Source code on GitHub (opens in a new tab)' },
        icon('github', 18),
        h('span.label', 'Source on GitHub'),
      ),
      railToggle,
    ),
  );

  // ---- Top bar ----------------------------------------------------------------

  const syncEl = h('span.sync-status', { role: 'status', 'aria-live': 'polite' });
  const accountBtn = h('button.account-btn', { type: 'button', 'aria-label': 'Account and appearance', title: 'Account' });
  const bellBadge = h('span.bell-badge', { hidden: true });
  const bellBtn = h('button.icon-btn.top-icon', { type: 'button', 'aria-label': 'Alerts', title: 'Alerts', onClick: () => openAlerts(bellBtn) }, icon('bell', 19), bellBadge);
  const timer = timerWidget();

  const createBtn = h(
    'button.btn.primary.create-btn',
    { type: 'button', title: 'Create new (N)', 'aria-keyshortcuts': 'N', onClick: (e) => openCreateMenu(e.currentTarget) },
    h('span.label', 'Create new'),
    icon('plus', 17),
  );

  const topbar = h(
    'header.topbar',
    h('a.mobile-brand', { href: '#/', 'aria-label': `${APP_NAME} dashboard` }, h('img', { src: './icons/icon.svg', alt: '' })),
    h(
      'button.search-trigger',
      { type: 'button', onClick: () => openSearch(), 'aria-label': 'Search', 'aria-keyshortcuts': '/ Control+K' },
      icon('search', 17),
      h('span.label', 'Search matters, contacts, bills...'),
      h('kbd', '/'),
    ),
    h('div.spacer'),
    syncEl,
    timer.node,
    createBtn,
    bellBtn,
    accountBtn,
  );
  accountBtn.addEventListener('click', () => openAccountMenu(accountBtn, onSignIn));

  const banner = app.demo
    ? h(
        'section.demo-banner',
        { 'aria-label': 'Demo mode' },
        icon('info', 16),
        h('span.grow', h('span.long', 'You are exploring a sample law firm. Changes stay in this tab and disappear when you leave.'), h('span.short', 'Sample firm. Changes are not saved.')),
        h('button.btn.sm.primary', { type: 'button', onClick: () => onSignIn?.() }, h('span.long', 'Sign in to start your own firm'), h('span.short', 'Sign in')),
      )
    : null;

  const tabbar = h(
    'nav.tabbar',
    { 'aria-label': 'Main' },
    TABBAR.map((id) => {
      const item = NAV.find((n) => n.id === id);
      const a = h('a', { href: item.href }, icon(item.icon, 21), h('span', item.label));
      tabLinks.set(id, a);
      return a;
    }),
    h('button', { type: 'button', onClick: () => openMoreSheet(), 'aria-haspopup': 'dialog' }, icon('menu', 21), h('span', 'More')),
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
    railToggle.replaceChildren(icon(mode === 'expanded' ? 'panel-close' : 'panel-open', 18), h('span.label', 'Collapse'));
    railToggle.setAttribute('aria-label', mode === 'expanded' ? 'Collapse navigation' : 'Expand navigation');
    railToggle.dataset.tip = mode === 'expanded' ? 'Collapse' : 'Expand';
    railToggle.setAttribute('aria-keyshortcuts', '[');
    try {
      localStorage.setItem(RAIL_KEY, mode);
    } catch {}
  }
  setRail(railMode);

  // ---- Live bits ------------------------------------------------------------------

  function updateActive(route) {
    const section = sectionFor(route);
    for (const [id, a] of [...navLinks, ...tabLinks]) {
      if (id === section) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }

  function updateBrand() {
    const s = store.state.settings;
    firmName.textContent = s.firm.name || APP_NAME;
    firmSub.textContent = app.demo ? 'Sample firm' : app.team && app.team.role !== 'owner' ? 'Firm member' : app.me()?.name || app.user?.username || 'Practice management';
  }

  const updateBadges = rafThrottle(() => {
    const a = computeAlerts();
    setBadge('tasks', a.overdueTasks.length, `${a.overdueTasks.length} overdue`);
    setBadge('billing', a.overdueBills.length, `${a.overdueBills.length} overdue bills`);
    const urgent = a.overdueTasks.length + a.sol.length + a.lowTrust.length + a.overdueBills.length;
    bellBadge.hidden = !urgent;
    bellBadge.textContent = urgent > 99 ? '99+' : String(urgent);
    bellBtn.setAttribute('aria-label', urgent ? `Alerts, ${urgent} need attention` : 'Alerts');
  });

  function setBadge(key, n, label) {
    const b = badges.get(key);
    if (!b) return;
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : String(n);
    b.title = label;
    const link = b.closest('a');
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
    } else if (st.error) {
      // The server refused some changes; they were dropped, not saved.
      cls = 'error';
      ic = 'alert';
      text = 'Some changes not saved';
    }
    syncEl.title = st.error && !st.online ? `Changes are kept on this device and will sync when the connection returns. (${st.error})` : cls === 'error' ? st.error : text;
    // A live region: rewriting it unchanged would re-announce it on every edit.
    if (syncEl.dataset.state === `${cls}|${text}`) return;
    syncEl.dataset.state = `${cls}|${text}`;
    syncEl.className = `sync-status ${cls}`;
    syncEl.replaceChildren(icon(ic, 15), h('span.label', text));
  }

  function updateAccount() {
    const name = app.me()?.name || app.user?.username || 'Guest';
    accountBtn.replaceChildren(avatar(name, { color: '#4b5563', img: app.avatarUrl }));
  }

  onRoute(updateActive);
  updateActive(currentRoute());
  updateBrand();
  updateBadges();
  updateSync();
  updateAccount();
  store.subscribe((changed) => {
    if (changed.has('settings') || changed.has('users')) {
      updateBrand();
      updateAccount();
    }
    if (changed.has('sync') || changed.size) updateSync();
    if (['tasks', 'matters', 'bills', 'payments', 'transactions', 'events'].some((c) => changed.has(c))) updateBadges();
  });
  // Date-based alerts change as the day goes on.
  setInterval(updateBadges, 5 * 60 * 1000);

  installShortcuts({ toggleRail: () => setRail(railMode === 'expanded' ? 'collapsed' : 'expanded'), createBtn });

  return { root, main, updateAccount };
}

// ---- Timer -------------------------------------------------------------------------

function timerWidget() {
  const clock = h('span.timer-clock', '00:00:00');
  const playIcon = h('span.timer-icon');
  const toggle = h('button.timer-toggle', { type: 'button', onClick: () => toggleTimer(), 'aria-keyshortcuts': 'Shift+T' }, playIcon, clock);
  const details = h('button.timer-more', { type: 'button', 'aria-label': 'Timer details', title: 'Timer details', onClick: () => openTimerPanel(details) }, icon('chevron-down', 15));
  const node = h('div.timer', { role: 'group', 'aria-label': 'Timer' }, toggle, details);
  let tick = null;
  function draw() {
    const s = getTimer();
    const ms = elapsedMs(s);
    clock.textContent = formatClock(ms);
    node.classList.toggle('running', s.running);
    node.classList.toggle('has-time', ms > 0);
    playIcon.replaceChildren(icon(s.running ? 'pause' : 'play', 14));
    const m = s.matterId ? lookup.matter(s.matterId) : null;
    toggle.setAttribute('aria-label', `${s.running ? 'Pause' : 'Start'} timer, ${formatClock(ms)}${m ? `, ${matterLabel(m)}` : ''}`);
    toggle.title = `${s.running ? 'Pause' : 'Start'} timer (Shift+T)${m ? `\n${matterLabel(m)}` : ''}`;
    clearInterval(tick);
    if (s.running) tick = setInterval(() => (clock.textContent = formatClock(elapsedMs(getTimer()))), 1000);
  }
  onTimerChange(draw);
  draw();
  return { node };
}

async function openTimerPanel(anchor) {
  const { matterPicker } = await import('../views/common.js');
  let t = null;
  let off = null;
  openPopover(
    anchor,
    ({ close }) => {
      const s = getTimer();
      const clock = h('div.timer-big', formatClock(elapsedMs(s)));
      t = setInterval(() => (clock.textContent = formatClock(elapsedMs(getTimer()))), 1000);
      const picker = matterPicker({ value: s.matterId, onChange: (id) => updateTimer({ matterId: id }) });
      const desc = textInput({ name: 'timerDesc', value: s.description, placeholder: 'What are you working on?' });
      desc.addEventListener('input', () => updateTimer({ description: desc.value }));
      const startBtn = h('button.btn', { type: 'button', onClick: () => (toggleTimer(), draw()) });
      const draw = () => startBtn.replaceChildren(icon(getTimer().running ? 'pause' : 'play', 15), getTimer().running ? 'Pause' : 'Start');
      draw();
      off = onTimerChange(draw); // Shift+T, or another tab
      const panel = h(
        'div.timer-panel',
        clock,
        field('Matter', picker),
        field('Description', desc),
        h(
          'div.row',
          startBtn,
          h(
            'button.btn.ghost',
            {
              type: 'button',
              onClick: async () => {
                if (elapsedMs(getTimer()) > 60000 && !(await confirmDialog({ title: 'Reset the timer?', message: 'The tracked time will be discarded.', confirmLabel: 'Reset', danger: true }))) return;
                resetTimer();
                close();
              },
            },
            'Reset',
          ),
          h('div.spacer'),
          h(
            'button.btn.primary',
            {
              type: 'button',
              onClick: async () => {
                const cur = getTimer();
                const minutes = Math.max(1, Math.round(elapsedMs(cur) / 60000));
                close();
                const { openActivityDialog } = await import('../views/dialogs.js');
                const saved = await openActivityDialog({ kind: 'time', minutes, matterId: cur.matterId, description: cur.description });
                if (saved) resetTimer();
              },
            },
            'Save entry',
          ),
        ),
      );
      return panel;
    },
    { align: 'end', label: 'Timer', width: 340, onClose: () => (clearInterval(t), off?.()) },
  );
}

// ---- Alerts ------------------------------------------------------------------------

function computeAlerts() {
  const store = app.store;
  const today = app.today();
  const me = meId();
  const tasks = store.all('tasks').filter((t) => !t.done && (!me || !t.assigneeId || t.assigneeId === me));
  const overdueTasks = tasks.filter((t) => t.dueDate && t.dueDate < today);
  const dueToday = tasks.filter((t) => t.dueDate === today);
  const openMatters = store.all('matters').filter((m) => m.status !== 'closed');
  const sol = openMatters.filter((m) => m.solDate && !m.solSatisfied && diffDays(today, m.solDate) <= 30);
  const tx = store.all('transactions');
  const accounts = store.all('accounts');
  const lowTrust = openMatters.filter((m) => Number(m.trustMinimumCents) > 0 && trustBalance(m.id, tx, accounts) < Number(m.trustMinimumCents));
  const payments = store.all('payments');
  const overdueBills = store.all('bills').filter((b) => billStatus(b, payments, today) === 'overdue');
  const events = store
    .all('events')
    .filter((e) => e.date === today)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return { overdueTasks, dueToday, sol, lowTrust, overdueBills, events };
}

function openAlerts(anchor) {
  openPopover(
    anchor,
    ({ close }) => {
      const a = computeAlerts();
      const today = app.today();
      const item = (ic, tone, title, sub, href) =>
        h('a.alert-item', { href, onClick: () => close() }, h(`span.alert-icon.${tone}`, icon(ic, 16)), h('span.grow', h('span.alert-title', title), sub ? h('span.alert-sub', sub) : null));
      const items = [
        ...a.sol.map((m) => {
          const d = diffDays(today, m.solDate);
          return item('flag', 'danger', `Statute of limitations ${d < 0 ? 'passed' : d === 0 ? 'is today' : `in ${d} days`}`, matterLabel(m), `#/matters/${m.id}`);
        }),
        ...a.overdueTasks.slice(0, 6).map((t) => item('alarm', 'danger', t.name, `Overdue since ${formatDate(t.dueDate)}`, t.matterId ? `#/matters/${t.matterId}?tab=tasks` : '#/tasks')),
        ...a.overdueBills.slice(0, 5).map((b) => item('receipt-text', 'warning', `Bill #${b.number} is overdue`, lookup.contactName(b.clientId), `#/bills/${b.id}`)),
        ...a.lowTrust.slice(0, 5).map((m) => item('vault', 'warning', 'Trust below minimum', matterLabel(m), `#/matters/${m.id}?tab=transactions`)),
        ...a.dueToday.slice(0, 5).map((t) => item('square-check', 'info', t.name, 'Due today', t.matterId ? `#/matters/${t.matterId}?tab=tasks` : '#/tasks')),
        ...a.events.slice(0, 5).map((e) => item('calendar', 'info', e.title, e.allDay ? 'Today, all day' : `Today at ${formatTime(e.start)}`, `#/calendar?date=${e.date}`)),
      ];
      const more = a.overdueTasks.length > 6 ? h('a.alert-more', { href: '#/tasks?due=overdue', onClick: () => close() }, `View all ${a.overdueTasks.length} overdue tasks`) : null;
      return h(
        'div.alerts-pop',
        h('div.menu-label', 'Needs attention'),
        items.length ? h('div.alert-list', items) : h('div.alerts-empty', icon('circle-check', 22), h('p', 'You are all caught up.')),
        more,
      );
    },
    { align: 'end', label: 'Alerts', width: 360 },
  );
}

// ---- Menus ----------------------------------------------------------------------------

export function openCreateMenu(anchor) {
  openMenu(
    anchor,
    createActions().map((a) => (a.separator ? a : { label: a.label, icon: a.icon, run: a.run })),
    { label: 'Create new', align: 'end' },
  );
}

function openAccountMenu(anchor, onSignIn) {
  // A small dialog rather than role=menu: it mixes a theme control with links.
  openPopover(
    anchor,
    ({ close }) => {
      const link = (label, ic, attrs) => h(attrs.href ? 'a.menu-item' : 'button.menu-item', { type: attrs.href ? null : 'button', ...attrs }, icon(ic, 16), h('span.grow', label));
      const me = app.me();
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
            const unsent = app.store.pendingCount();
            if (unsent || hasUnsavedEdits()) {
              const ok = await confirmDialog({
                title: 'Sign out with unsaved changes?',
                message: unsent ? 'Some changes have not reached the cloud yet. Signing out now discards them.' : 'This page has changes you have not saved. Signing out now discards them.',
                confirmLabel: 'Sign out anyway',
                danger: true,
              });
              if (!ok) return;
            }
            // Client data must not stay on a shared computer after signing out.
            await app.store.clearCache().catch(() => {});
            // Already confirmed above; the reload must not ask again.
            allowUnload();
            signOut();
            location.hash = '';
            location.reload();
          },
        });
      return h(
        'div.account-pop',
        h(
          'div.account-head',
          avatar(me?.name || app.user?.username || 'Guest', { color: '#4b5563', img: app.avatarUrl, size: 'lg' }),
          h(
            'div.grow',
            h('div.account-name', app.demo ? 'Sample firm' : me?.name || app.user?.username || ''),
            h('div.subtle.small', app.demo ? 'Nothing is saved' : app.user ? `Signed in as ${app.user.username}` : ''),
          ),
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
        firmSwitcher(close),
        h('div.menu-sep'),
        h('nav', { 'aria-label': 'Account' }, items),
        footer ? [h('div.menu-sep'), footer] : null,
      );
    },
    { align: 'end', label: 'Account and appearance', role: 'dialog', width: 300 },
  );
}

/** The person's own firm and those they joined, when there is a choice. */
function firmSwitcher(close) {
  const ws = app.workspaces;
  if (app.demo || !ws || !ws.joined?.length) return null;
  const current = app.team && app.team.role !== 'owner' ? app.team.url : 'own';
  const options = [
    { id: 'own', label: 'My firm', sub: current === 'own' ? app.settings().firm.name || '' : '' },
    ...ws.joined.map((j) => ({ id: j.url, label: j.business || 'Shared firm', sub: j.role === 'admin' ? 'Admin' : 'Member' })),
  ];
  return [
    h('div.menu-sep'),
    h('div.menu-label', 'Firm'),
    h(
      'div',
      { role: 'group', 'aria-label': 'Switch firm' },
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
          icon(o.id === 'own' ? 'home' : 'building', 16),
          h('span.grow', o.label, o.sub ? h('span.menu-desc', o.sub) : null),
          o.id === current ? icon('check', 16) : null,
        ),
      ),
    ),
  ];
}

function openMoreSheet() {
  const more = NAV.filter((n) => !TABBAR.includes(n.id));
  openDialog({
    title: 'More',
    cls: 'sheet',
    body: ({ close }) =>
      h(
        'nav',
        { 'aria-label': 'More sections' },
        h(
          'ul.list.more-list',
          [...more, { id: 'settings', label: 'Settings', icon: 'settings', href: '#/settings' }].map((n) =>
            h('li', h('a.list-item', { href: n.href, onClick: () => close() }, icon(n.icon, 20), h('span.grow', n.label), icon('chevron-right', 16))),
          ),
          h('li', h('a.list-item', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, icon('github', 20), h('span.grow', 'Source code on GitHub'), icon('external', 16))),
        ),
      ),
  });
}

// ---- Keyboard shortcuts ------------------------------------------------------------------

export const SHORTCUTS = [
  { keys: ['/'], label: 'Search' },
  { keys: ['Ctrl', 'K'], label: 'Search', combo: true },
  { keys: ['N'], label: 'Create new' },
  { keys: ['Shift', 'T'], label: 'Start or pause the timer', combo: true },
  { keys: ['?'], label: 'Show keyboard shortcuts' },
  { keys: ['['], label: 'Collapse or expand navigation' },
  ...NAV.map((n) => ({ keys: ['G', n.key.toUpperCase()], label: `Go to ${n.label}` })),
  { keys: ['G', ','], label: 'Go to Settings' },
  { keys: ['Esc'], label: 'Close dialog or menu' },
];

export function showShortcuts() {
  openDialog({
    title: 'Keyboard shortcuts',
    body: h(
      'dl.shortcuts',
      SHORTCUTS.map((s) => [
        h(
          'dt',
          s.keys.map((k, i) => [i ? h('span.subtle', s.combo ? ' + ' : ' then ') : null, h('kbd', k)]),
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
    if (e.defaultPrevented) return;
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      // Not over a dialog: a result would navigate away underneath it.
      if (!document.querySelector('dialog[open]')) openSearch();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(e.target) || document.querySelector('dialog[open]')) return;
    if (gPending) {
      gPending = false;
      clearTimeout(gTimer);
      const k = e.key.toLowerCase();
      if (k === ',') return navigate('/settings');
      const item = NAV.find((n) => n.key === k);
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
    } else if (e.key === 'T' && e.shiftKey) {
      e.preventDefault();
      toggleTimer();
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      openCreateMenu(createBtn);
    } else if (e.key === '[') {
      toggleRail();
    } else if (e.key === 'g') {
      gPending = true;
      gTimer = setTimeout(() => (gPending = false), 1200);
    }
  });
}

/** App shell: sidebar / bottom-nav navigation, hash router, theme menu. */
import { el, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { pendingSwaps } from '../core/swaps.js';
import { initials, MOBILE_QUERY } from './components.js';
import { confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { openOnboarding } from './onboarding.js';
import { renderDashboard } from './views/dashboard.js';
import { renderSchedule } from './views/schedule.js';
import { renderEmployees } from './views/employees.js';
import { renderAvailability } from './views/availability.js';
import { renderSwaps } from './views/swaps.js';
import { renderAttendance } from './views/attendance.js';
import { renderReports } from './views/reports.js';
import { openShiftEditor } from './editors.js';
import { openDataDialog } from './data.js';

const VIEWS = {
  dashboard: { title: 'Home', icon: 'dashboard', render: renderDashboard },
  schedule: { title: 'Schedule', icon: 'calendar', render: renderSchedule },
  team: { title: 'Team', icon: 'users', render: renderEmployees },
  availability: { title: 'Availability', icon: 'clock', render: renderAvailability },
  swaps: { title: 'Swaps', icon: 'arrow-left-right', render: renderSwaps },
  attendance: { title: 'Attendance', icon: 'clipboard', render: renderAttendance },
  reports: { title: 'Reports', icon: 'chart', render: renderReports },
};

const SIDEBAR_ORDER = ['dashboard', 'schedule', 'team', 'availability', 'swaps', 'attendance', 'reports'];
const TABBAR_ORDER = ['dashboard', 'schedule', 'team', 'swaps', 'attendance'];

/* ---- Theme ---------------------------------------------------------- */

const THEME_KEY = 'shifts.theme';
const THEMES = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System', icon: 'monitor' },
];

/**
 * Reading or writing localStorage throws outright where the browser
 * blocks storage (private mode, an embedded frame with storage
 * partitioned off), so every access here is best-effort, exactly like
 * the pre-paint read in index.html. `sessionTheme` keeps the choice
 * coherent for the session when nothing can be persisted.
 */
let sessionTheme = null;

function readStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function writeStoredTheme(value) {
  try {
    if (value === null) localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, value);
  } catch {
    /* not remembered across reloads; the theme still applies right now */
  }
}

function getTheme() {
  const t = readStoredTheme() ?? sessionTheme;
  return t === 'light' || t === 'dark' ? t : 'system';
}

/** Mirrors the --bg token per theme (see styles/main.css). */
const THEME_BG = { light: '#f6f6f7', dark: '#101013' };

/**
 * Keeps the browser-chrome color in step with the app theme. With an
 * explicit theme both metas get that theme's background; for "system"
 * they revert to per-scheme values so OS switches keep working.
 */
function syncThemeColor(theme) {
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    if (theme === 'system') {
      meta.content = meta.media?.includes('dark') ? THEME_BG.dark : THEME_BG.light;
    } else {
      meta.content = THEME_BG[theme];
    }
  }
}

function setTheme(value) {
  sessionTheme = value === 'system' ? null : value;
  if (value === 'system') {
    writeStoredTheme(null);
    delete document.documentElement.dataset.theme;
  } else {
    writeStoredTheme(value);
    document.documentElement.dataset.theme = value;
  }
  syncThemeColor(value);
}

const themeMeta = (value) =>
  THEMES.find((t) => t.value === value) ?? THEMES.find((t) => t.value === 'system');

/**
 * Paints a theme button to match the active theme, so the toolbar shows
 * which mode is on rather than a fixed icon. Called again after a pick,
 * since choosing a theme doesn't go through the store or a re-render.
 */
function syncThemeButton(button) {
  const { icon: iconName, label } = themeMeta(getTheme());
  button.replaceChildren(icon(iconName, 17));
  button.setAttribute('aria-label', `Theme: ${label}`);
  button.title = `Theme: ${label}`;
}

/** Close function of the open theme menu, so its button acts as a toggle. */
let closeThemeMenu = null;

function openThemeMenu(anchor) {
  if (closeThemeMenu) {
    closeThemeMenu();
    return;
  }
  const current = getTheme();
  const rect = anchor.getBoundingClientRect();
  const menu = el(
    'div',
    { class: 'menu', role: 'menu' },
    THEMES.map((t) =>
      el(
        'button',
        {
          class: 'menu-item',
          role: 'menuitemradio',
          'aria-checked': String(t.value === current),
          onClick: () => {
            setTheme(t.value);
            syncThemeButton(anchor);
            close({ refocus: true });
          },
        },
        icon(t.icon, 15),
        t.label,
        t.value === current ? el('span', { class: 'check' }, icon('check', 15)) : null
      )
    )
  );

  function close({ refocus = false } = {}) {
    closeThemeMenu = null;
    anchor.setAttribute('aria-expanded', 'false');
    menu.remove();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onViewportChange);
    if (refocus && anchor.isConnected) anchor.focus();
  }
  /**
   * The menu is placed once, at coordinates taken from the anchor. A
   * resize moves the anchor out from under it, and crossing the mobile
   * breakpoint hides the whole sidebar, leaving the menu floating over
   * the page attached to nothing. Dismiss instead of chasing it.
   */
  function onViewportChange() {
    close();
  }
  function onOutside(e) {
    // Presses on the anchor are left to its click handler, which toggles
    // the menu shut; closing here would make that same click reopen it.
    if (!menu.contains(e.target) && !anchor.contains(e.target)) close();
  }
  /** Standard menu keyboard support; focus lives on the item buttons. */
  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close({ refocus: true });
      return;
    }
    if (e.key === 'Tab') {
      // Per the ARIA menu pattern, Tab dismisses the menu; hand focus
      // back to the anchor so the default Tab continues from there.
      close({ refocus: true });
      return;
    }
    const items = [...menu.querySelectorAll('.menu-item')];
    const index = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      items[(index + delta + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  }

  document.body.appendChild(menu);
  const menuRect = menu.getBoundingClientRect();
  const top = Math.min(rect.bottom + 6, window.innerHeight - menuRect.height - 8);
  const left = Math.min(Math.max(8, rect.right - menuRect.width), window.innerWidth - menuRect.width - 8);
  menu.style.top = `${Math.max(8, top)}px`;
  menu.style.left = `${left}px`;
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onViewportChange);
  anchor.setAttribute('aria-expanded', 'true');
  closeThemeMenu = close;
  menu.querySelector('[aria-checked="true"]')?.focus();
}

/* ---- Shell ----------------------------------------------------------- */

/**
 * Text fields whose caret survives a re-render. A rebuilt input comes
 * back with its caret at the end of the value, which is invisible on a
 * field that only re-renders when it loses focus but wrong on one that
 * re-renders as it is typed in: the schedule's search box sent every
 * keystroke after an edit in the middle of a name to the end of the
 * line. Only the types that actually support a selection are asked;
 * setSelectionRange throws on number, date, email, and color.
 */
const CARET_TYPES = new Set(['text', 'search', 'tel', 'url', 'password']);

const hasCaret = (node) => Boolean(node) && (node.tagName === 'TEXTAREA' || CARET_TYPES.has(node.type));

function caretOf(node) {
  if (!hasCaret(node)) return null;
  return { start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection };
}

function restoreCaret(node, caret) {
  if (!caret || !hasCaret(node)) return;
  try {
    node.setSelectionRange(caret.start, caret.end, caret.direction ?? 'none');
  } catch {
    /* the field is a different shape than the one focus came from */
  }
}

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name, param] = hash.split('/');
  return { name: VIEWS[name] ? name : 'dashboard', param: param || null };
}

export function startApp({ store, user, snapshots, onSignOut }) {
  const ui = {};
  syncThemeColor(getTheme());

  const ctx = {
    store,
    ui,
    user,
    // Restore points (see core/snapshots.js); the backup dialog lists them.
    snapshots,
    navigate(route) {
      location.hash = `#/${route}`;
    },
    refresh() {
      render();
    },
  };

  function themeButton() {
    const button = el('button', {
      class: 'btn btn-ghost btn-icon',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      onClick: (e) => openThemeMenu(e.currentTarget),
    });
    syncThemeButton(button);
    return button;
  }

  function navButton(name, className) {
    const view = VIEWS[name];
    const route = parseRoute();
    const pendingCount = name === 'swaps' ? pendingSwaps(store.state.swaps).length : 0;
    return el(
      'button',
      {
        class: className,
        // The tablet rail hides these labels (see styles/main.css), which
        // takes them out of the accessibility tree too: every sidebar
        // button announced as a bare "button" and hovering the icon said
        // nothing either. The title covers both, and where the label is
        // visible the button's own text still names it.
        title: className === 'nav-item' ? view.title : null,
        'aria-current': route.name === name ? 'page' : null,
        // Navigating rebuilds this very button, so it carries a stable
        // key like the in-view controls do (see render() below). The two
        // bars are separate keys because only one of them is on screen at
        // a time, and focus cannot land on the hidden one.
        dataset: { focusKey: `${className === 'tab-item' ? 'tab' : 'nav'}:${name}` },
        onClick: () => ctx.navigate(name),
      },
      icon(view.icon, className === 'tab-item' ? 20 : 17),
      el('span', {}, view.title),
      pendingCount > 0
        ? el(
            'span',
            { class: className === 'tab-item' ? 'tab-badge' : 'nav-badge' },
            String(pendingCount)
          )
        : null
    );
  }

  function sidebar() {
    return el(
      'aside',
      { class: 'sidebar' },
      el(
        'div',
        { class: 'brand' },
        el('img', { class: 'brand-logo', src: './icons/icon-192.png', width: 30, height: 30, alt: '' }),
        el('div', { class: 'brand-name' }, 'Shifts')
      ),
      el('nav', { class: 'nav', 'aria-label': 'Main' }, SIDEBAR_ORDER.map((name) => navButton(name, 'nav-item'))),
      el(
        'div',
        { class: 'sidebar-footer' },
        el(
          'button',
          { class: 'nav-item', title: 'Backup & restore', onClick: () => openDataDialog(ctx) },
          icon('database', 17),
          el('span', {}, 'Backup & restore')
        ),
        el(
          'div',
          { class: 'user-card' },
          el('span', { class: 'avatar', style: { '--emp': 'var(--accent)' } }, user ? initials(user.username ?? 'U') : icon('circle-user', 16)),
          el(
            'div',
            { class: 'user-info' },
            el('div', { class: 'name' }, user?.username ?? 'Account'),
            el('div', { class: 'meta' }, 'Signed in')
          ),
          themeButton(),
          el(
            'button',
            {
              class: 'btn btn-ghost btn-icon',
              'aria-label': 'Sign out',
              title: 'Sign out',
              onClick: onSignOut,
            },
            icon('log-out', 16)
          )
        ),
        el('div', { class: 'powered' }, 'Powered by ', el('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noreferrer' }, 'Puter'))
      )
    );
  }

  function mobileTopbar() {
    return el(
      'header',
      { class: 'mobile-topbar' },
      el('img', { class: 'brand-logo', src: './icons/icon-192.png', width: 28, height: 28, alt: '' }),
      el('div', { class: 'brand-name' }, 'Shifts'),
      el('span', { class: 'spacer' }),
      el(
        'button',
        { class: 'btn btn-ghost btn-icon', 'aria-label': 'Backup & restore', onClick: () => openDataDialog(ctx) },
        icon('database', 16)
      ),
      themeButton(),
      el(
        'button',
        { class: 'btn btn-ghost btn-icon', 'aria-label': 'Sign out', onClick: onSignOut },
        icon('log-out', 16)
      )
    );
  }

  function tabbar() {
    return el(
      'nav',
      { class: 'tabbar', 'aria-label': 'Main' },
      el('div', { class: 'tabbar-inner' }, TABBAR_ORDER.map((name) => navButton(name, 'tab-item')))
    );
  }

  /* Sample-data banner: always visible while exploring, one-tap wipe. */
  const sampleBanner = el('div', { style: { display: 'contents' } });

  function renderSampleBanner() {
    sampleBanner.replaceChildren();
    if (!store.state.settings.sampleData) return;
    sampleBanner.appendChild(
      el(
        'div',
        { class: 'sample-banner' },
        icon('sparkles', 14),
        el('span', { class: 'grow' }, 'Sample data. Explore freely, nothing here is yours.'),
        el(
          'button',
          {
            class: 'btn btn-sm',
            onClick: async () => {
              const ok = await confirmDialog({
                title: 'Start fresh?',
                message: 'All sample data is removed so you can set up your own team from scratch.',
                confirmLabel: 'Wipe sample data',
                danger: true,
              });
              if (!ok) return;
              try {
                await store.wipeSampleData();
              } catch (err) {
                console.error(err);
                toast('Couldn’t wipe the sample data. Check your connection.', 'error');
                return;
              }
              openOnboarding(store);
            },
          },
          'Start fresh'
        )
      )
    );
  }

  /**
   * The floating button is the phone's main way to add a shift, and it
   * is built once, outside any view. On the schedule it sits over a week
   * or day the user has navigated to, so take the date that view already
   * settled on; anywhere else "today" is the sensible start.
   */
  function newShiftDefaults() {
    const date = parseRoute().name === 'schedule' ? ui.scheduleNewShiftDate : null;
    return date ? { date } : {};
  }

  // tabindex -1 makes the region a focus target without putting it in the
  // tab order: a dialog whose opener the re-render took away parks focus
  // here rather than dropping it to <body> (see restoreFocus in modal.js).
  const content = el('main', { class: 'content', tabindex: '-1' });
  const shell = el(
    'div',
    { class: 'app' },
    sidebar(),
    el('div', { class: 'main' }, mobileTopbar(), sampleBanner, content),
    tabbar(),
    el(
      'button',
      {
        class: 'fab',
        'aria-label': 'New shift',
        onClick: () => openShiftEditor(ctx, { defaults: newShiftDefaults() }),
      },
      icon('plus', 22)
    )
  );

  let lastRoute = null;

  function render() {
    const route = parseRoute();
    if (route.name === 'availability' && route.param) ui.availabilityEmp = route.param;
    // #/team/<id> is one person's page; #/team is the list. Reading the
    // parameter here keeps the router the only place that parses a hash.
    if (route.name === 'team') ui.teamEmployee = route.param ?? null;
    // A view may name the page after the record it is showing.
    ui.pageTitle = null;

    // Keep the scroll position for in-place refreshes (data changes),
    // but start new views at the top.
    const sameView = lastRoute === route.name;
    lastRoute = route.name;
    const scrollTop = content.scrollTop;
    // A view is rebuilt from scratch, so whatever was focused is gone.
    // The screens that save as you type re-render after every field, and
    // dropping focus to <body> there sends a keyboard user back to the
    // top of the page each time; controls on them carry a stable
    // data-focus-key so the equivalent control can be picked back up.
    //
    // The shell around the view is rebuilt too, so the search covers all
    // of it: the navigation is the one thing on the page that always
    // replaces the control that was just pressed.
    const active = shell.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active?.dataset?.focusKey ?? null;
    const caret = focusKey ? caretOf(active) : null;
    mount(content, el('div', { class: 'content-inner' }, VIEWS[route.name].render(ctx)));
    content.scrollTop = sameView ? scrollTop : 0;

    // Sync nav highlight, badges, and the sample-data banner. The theme
    // menu's anchor lives in the sidebar being replaced, so an open menu
    // would be left pointing at a detached button.
    closeThemeMenu?.();
    shell.querySelector('.sidebar').replaceWith(sidebar());
    shell.querySelector('.tabbar').replaceWith(tabbar());
    renderSampleBanner();

    // After everything is standing again, so a nav button's replacement
    // exists to hand focus to.
    if (focusKey) {
      // Compared rather than selected: an imported record's id ends up in
      // the key, and it is not guaranteed to be selector-safe.
      for (const node of shell.querySelectorAll('[data-focus-key]')) {
        if (node.dataset.focusKey === focusKey) {
          node.focus();
          restoreCaret(node, caret);
          break;
        }
      }
    }
    document.title = `${ui.pageTitle ?? VIEWS[route.name].title} · Shifts`;
  }

  store.subscribe(render);
  window.addEventListener('hashchange', render);

  // Only the mobile breakpoint changes what the views build (the rest of
  // the layout is CSS), and re-rendering tears down whatever is focused.
  // Listening for plain resize meant the on-screen keyboard, which fires
  // one as it opens, closed the very time or date picker it was opened
  // for, so watch the breakpoint itself instead.
  window.matchMedia(MOBILE_QUERY).addEventListener('change', render);

  mount(document.body, shell);
  render();
}

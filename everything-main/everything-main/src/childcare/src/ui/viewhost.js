/**
 * Mounts the view for the current route into <main>. Views are code-split
 * modules exporting `render(ctx)` which returns a node or
 * { node, title, dirty?(), dispose?() }.
 *
 * ctx.live(renderFn, collections) returns a container that re-renders
 * itself (at most once per frame) when any of those collections change.
 * Only the region re-renders, so inputs elsewhere on the page keep focus;
 * focus inside the region moves to the matching new element (see keepFocus).
 */
import { h, rafThrottle, keepFocus } from './dom.js';
import { route, onRoute, startRouter, currentRoute } from './router.js';
import { app, isFamily, isManager } from '../app.js';
import { confirmDialog } from './dialog.js';
import { emptyState } from './components.js';

const VIEWS = {
  home: () => import('../views/home.js'),
  attendance: () => import('../views/attendance.js'),
  kiosk: () => import('../views/kiosk.js'),
  activities: () => import('../views/activities.js'),
  messages: () => import('../views/messages.js'),
  children: () => import('../views/children.js'),
  'child-form': () => import('../views/child-form.js'),
  child: () => import('../views/child.js'),
  families: () => import('../views/families.js'),
  rooms: () => import('../views/rooms.js'),
  room: () => import('../views/room.js'),
  staff: () => import('../views/staff.js'),
  member: () => import('../views/member.js'),
  calendar: () => import('../views/calendar.js'),
  menus: () => import('../views/menus.js'),
  billing: () => import('../views/billing.js'),
  invoice: () => import('../views/invoice.js'),
  reports: () => import('../views/reports.js'),
  settings: () => import('../views/settings.js'),
};

export function defineRoutes() {
  route('/', 'home');
  route('/attendance', 'attendance');
  route('/kiosk', 'kiosk');
  route('/activities', 'activities');
  route('/messages', 'messages');
  route('/messages/:id', 'messages');
  route('/children', 'children');
  route('/children/new', 'child-form');
  route('/children/:id/edit', 'child-form');
  route('/children/:id', 'child');
  route('/families', 'families');
  route('/rooms', 'rooms');
  route('/rooms/:id', 'room');
  route('/staff', 'staff');
  route('/staff/:id', 'member');
  route('/calendar', 'calendar');
  route('/menus', 'menus');
  route('/billing', 'billing');
  route('/billing/:tab', 'billing');
  route('/statements/:id', 'invoice');
  route('/reports', 'reports');
  route('/settings', 'settings');
  route('/settings/:section', 'settings');
}

export function startViews(main) {
  let active = null; // { dispose, dirty, lives }
  let token = 0;
  let lastHash = location.hash;
  let ignoreNext = false;

  const changedColls = new Set();
  const flushLive = rafThrottle(() => {
    if (!active) return;
    const changed = new Set(changedColls);
    changedColls.clear();
    for (const l of active.lives) {
      if (!l.node.isConnected) continue;
      if (l.colls === 'all' || l.colls.some((c) => changed.has(c))) l.draw();
    }
  });
  app.store.subscribe((changed) => {
    for (const c of changed) changedColls.add(c);
    flushLive();
  });

  async function show(r) {
    if (ignoreNext) {
      ignoreNext = false;
      return;
    }
    // A kiosk stays a kiosk until it is exited with its own button.
    if (app.kioskLock && r.name !== 'kiosk') {
      ignoreNext = true;
      location.hash = '#/kiosk';
      return;
    }
    if (active?.dirty?.()) {
      const leave = await confirmDialog({
        title: 'Discard unsaved changes?',
        message: 'You have changes on this page that have not been saved.',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        danger: true,
      });
      if (!leave) {
        ignoreNext = true;
        location.hash = lastHash;
        return;
      }
    }
    lastHash = location.hash;
    const my = ++token;
    const loader = allowed(r.name) ? VIEWS[r.name] : null;
    let mod = null;
    if (loader) {
      try {
        mod = await loader();
      } catch (err) {
        console.error(err);
      }
    }
    if (my !== token) return;
    active?.dispose?.();
    const lives = [];
    const disposers = [];
    const ctx = {
      params: r.params,
      query: r.query,
      route: r,
      live(renderFn, colls = 'all', tag = 'div') {
        const node = liveRegion(renderFn, tag);
        lives.push({ node, draw: node.redraw, colls });
        return node;
      },
      onDispose(fn) {
        disposers.push(fn);
      },
    };
    let out;
    try {
      out = mod ? mod.render(ctx) : notFound();
    } catch (err) {
      console.error(err);
      out = crashed(err);
    }
    const view = out instanceof Node ? { node: out } : out || { node: notFound() };
    active = {
      lives,
      dirty: view.dirty,
      dispose: () => {
        view.dispose?.();
        for (const d of disposers) d();
      },
    };
    main.replaceChildren(view.node);
    main.scrollTop = 0;
    const title = view.title || main.querySelector('h1')?.textContent || 'Childcare';
    document.title = `${title} · Childcare`;
    // Move focus for keyboard and screen reader users, without scrolling.
    if (document.activeElement === document.body || !document.activeElement || main.contains(document.activeElement) === false) {
      if (!document.querySelector('dialog[open]')) main.focus({ preventScroll: true });
    }
  }

  window.addEventListener('beforeunload', (e) => {
    if (active?.dirty?.() || app.store.pendingCount()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  defineRoutes();
  onRoute(show);
  startRouter();
  return { current: currentRoute };
}

/** A container that redraws from renderFn on node.redraw(), keeping focus. */
export function liveRegion(renderFn, tag = 'div') {
  const node = h(tag);
  const draw = () =>
    keepFocus(node, () => {
      const out = renderFn();
      node.replaceChildren(...(Array.isArray(out) ? out.flat(Infinity).filter(Boolean) : out ? [out] : []));
    });
  draw();
  node.redraw = draw;
  return node;
}

// Families see their own children's pages; billing is for the director and admins.
const FAMILY_VIEWS = new Set(['home', 'messages', 'calendar', 'menus', 'billing', 'invoice', 'child', 'settings']);
const MANAGER_VIEWS = new Set(['billing', 'invoice']);

function allowed(name) {
  if (isFamily()) return FAMILY_VIEWS.has(name);
  if (MANAGER_VIEWS.has(name)) return isManager();
  return true;
}

function notFound() {
  return h(
    'div.page',
    emptyState({
      icon: 'search',
      title: 'Page not found',
      text: 'The page you were looking for does not exist or was deleted.',
      headingLevel: 1,
      actions: [h('a.btn.primary', { href: '#/' }, 'Go home')],
    }),
  );
}

function crashed(err) {
  return h(
    'div.page',
    emptyState({
      icon: 'alert',
      title: 'Something went wrong',
      text: `This page failed to load. ${err?.message || ''}`,
      headingLevel: 1,
      actions: [h('button.btn', { type: 'button', onClick: () => location.reload() }, 'Reload')],
    }),
  );
}

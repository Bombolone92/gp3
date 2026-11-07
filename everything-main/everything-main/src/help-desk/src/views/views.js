/**
 * Views: saved ticket filters listed on the left with live counts, and the
 * selected view's tickets on the right with sorting, grouping, bulk edits
 * and a "Play" mode that walks through the view one ticket at a time.
 */
import './views.css';
import { h, clear, debounce, preserveFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openMenu } from '../ui/popover.js';
import { emptyState } from '../ui/components.js';
import { relTime, plural } from '../ui/format.js';
import { toast, toastError } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { go } from '../ui/router.js';
import { bind } from '../ui/shortcuts.js';
import { SYSTEM_VIEWS, SPECIAL_VIEWS, DEFAULT_COLUMNS, inView } from '../shared/rules.js';
import { app } from '../app.js';
import { ticketTable, GROUPS } from './ticket-table.js';
import { bulkEditDialog } from './bulk-edit.js';

export function allViews() {
  const custom = (app.replica.cfg.views || []).filter((v) => v.active !== false);
  return [...SYSTEM_VIEWS, ...custom];
}

export function viewById(id) {
  return [...allViews(), ...SPECIAL_VIEWS].find((v) => v.id === id) || null;
}

export function ticketsInView(view) {
  const ctx = { me: app.me?.uuid, now: Date.now() };
  return app.replica.ticketsFor((t) => inView(view, t, ctx));
}

/** The queue "Play" walks: remembered so "Next ticket" works from a ticket. */
export const playQueue = { viewId: null, ids: [] };
// Play mode walks one desk's tickets; another desk starts with none.
app.addEventListener('desk', () => {
  playQueue.viewId = null;
  playQueue.ids = [];
});

export function mount(main, { id }) {
  const views = allViews();
  const viewId = id && viewById(id) ? id : views[0].id;
  if (!id) history.replaceState(null, '', `#/views/${viewId}`);
  const side = h('nav.side-nav', { 'aria-label': 'Views' });
  const content = h('section.view-content', { 'aria-labelledby': 'view-title' });
  main.append(h('div.split-page', side, content));
  const prefsKey = `help-desk:view-prefs:${viewId}`;
  let prefs = {};
  try {
    prefs = JSON.parse(localStorage.getItem(prefsKey) || '{}');
  } catch {
    prefs = {};
  }

  let view = viewById(viewId);
  let columns = view.columns?.length ? view.columns : DEFAULT_COLUMNS;
  let sort = prefs.sort || view.sort || { field: 'updatedAt', dir: 'desc' };
  let groupBy = prefs.groupBy !== undefined ? prefs.groupBy : view.groupBy || (view.id === 'sys-unsolved' || view.id === 'sys-recent' ? 'status' : null);

  const savePrefs = () => {
    prefs = { sort, groupBy };
    try {
      localStorage.setItem(prefsKey, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  };

  const titleEl = h('h1#view-title', view.title);
  // On phones the views list is hidden, so the title switches views.
  const switchBtn = h('button.view-switch', {
    type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `${view.title}. Switch view`,
    onclick: () => openMenu(switchBtn, [...allViews(), ...SPECIAL_VIEWS].map((v) => ({ label: v.title, checked: v.id === viewId, run: () => go(`/views/${v.id}`) })), { label: 'Views' }),
  }, h('span.ellipsis', view.title), icon('chevron-down', { size: 18 }));
  const countEl = h('span.view-count');
  const updatedEl = h('span.view-updated');
  const bulkBar = h('div.bulk-bar', { hidden: true, role: 'region', 'aria-label': 'Bulk actions' });
  const table = ticketTable({
    label: view.title,
    onOpen: (t, list) => {
      playQueue.viewId = viewId;
      playQueue.ids = list.map((x) => x.id);
      go(`/tickets/${t.id}`);
    },
    onSort: (s) => {
      sort = s;
      savePrefs();
      refresh();
    },
    onSelect: (sel) => paintBulk(sel),
  });

  const groupBtn = h('button.btn.btn-sm', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => {
    openMenu(groupBtn, [
      { heading: 'Group by' },
      { label: 'No grouping', checked: !groupBy, run: () => setGroup(null) },
      ...Object.entries(GROUPS).map(([k, g]) => ({ label: g.label, checked: groupBy === k, run: () => setGroup(k) })),
    ], { label: 'Group by' });
  } }, icon('layout-list', { size: 14 }), 'Group');
  const playBtn = h('button.btn.btn-sm.btn-outline-accent', { type: 'button', onclick: play }, icon('play', { size: 14 }), 'Play');
  const moreBtn = app.isAdmin
    ? h('button.icon-btn', { type: 'button', 'aria-label': 'View options', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => openMenu(moreBtn, [
        { label: 'Create a view', icon: 'plus', run: () => go('/admin/views/new') },
        !view.id.startsWith('sys-') ? { label: 'Edit this view', icon: 'pencil', run: () => go(`/admin/views/${view.id}`) } : null,
      ], { align: 'end' }) }, icon('ellipsis', { size: 18 }))
    : null;

  clear(content);
  content.append(
    h('header.view-head',
      h('div.view-title-wrap', titleEl, switchBtn, h('div.view-meta', countEl, h('span.subtle', '·'), updatedEl)),
      h('div.toolbar', groupBtn, view.special ? null : playBtn, moreBtn)),
    bulkBar,
    table.el,
  );

  function setGroup(g) {
    groupBy = g;
    savePrefs();
    refresh();
  }

  function play() {
    const list = table.tickets;
    if (!list.length) {
      toast('This view has no tickets to play.');
      return;
    }
    playQueue.viewId = viewId;
    playQueue.ids = list.map((t) => t.id);
    go(`/tickets/${list[0].id}`);
  }

  function paintBulk(sel) {
    clear(bulkBar);
    bulkBar.hidden = sel.size === 0;
    if (!sel.size) return;
    const ids = [...sel];
    const special = view.special;
    bulkBar.append(
      h('strong', `${plural(sel.size, 'ticket')} selected`),
      special === 'deleted'
        ? h('button.btn.btn-sm', { type: 'button', onclick: () => doBulk(ids, { action: 'restore' }, 'restored') }, icon('archive-restore', { size: 14 }), 'Restore')
        : h('button.btn.btn-sm', { type: 'button', onclick: () => bulkEditDialog(ids, () => table.clearSelection()) }, icon('pencil', { size: 14 }), 'Edit'),
      special === 'spam'
        ? h('button.btn.btn-sm', { type: 'button', onclick: () => doBulk(ids, { action: 'restore' }, 'moved back to the inbox') }, 'Not spam')
        : special ? null : h('button.btn.btn-sm', { type: 'button', onclick: () => doBulk(ids, { action: 'spam' }, 'marked as spam') }, icon('ban', { size: 14 }), 'Mark as spam'),
      special === 'deleted'
        ? (app.isAdmin ? h('button.btn.btn-sm.btn-danger', { type: 'button', onclick: () => purge(ids) }, 'Delete permanently') : null)
        : h('button.btn.btn-sm', { type: 'button', onclick: () => doBulk(ids, { action: 'delete' }, 'moved to Deleted tickets') }, icon('trash', { size: 14 }), 'Delete'),
      h('span.spacer'),
      h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: () => table.clearSelection() }, 'Clear selection'),
    );
  }

  async function doBulk(ids, body, verb) {
    try {
      await app.bulk(ids, body);
      table.clearSelection();
      toast(`${plural(ids.length, 'ticket')} ${verb}.`, {
        kind: 'success',
        action: body.action === 'delete' || body.action === 'spam' ? { label: 'Undo', run: () => app.bulk(ids, { action: 'restore' }) } : null,
      });
    } catch (e) {
      toastError(e);
    }
  }

  async function purge(ids) {
    const ok = await confirmDialog({ title: 'Delete permanently?', message: `${plural(ids.length, 'ticket')} and their conversations will be erased. This cannot be undone.`, confirmLabel: 'Delete permanently', danger: true });
    if (!ok) return;
    let done = 0;
    for (const id of ids) {
      try {
        await app.api.del(`/tickets/${id}`);
        app.replica.drop('t', id);
        done++;
      } catch (e) {
        toastError(e);
        break;
      }
    }
    table.clearSelection();
    if (done) toast(`${plural(done, 'ticket')} deleted permanently.`, { kind: 'success' });
  }

  function paintSide() {
    clear(side);
    const counts = new Map();
    const ctx = { me: app.me?.uuid, now: Date.now() };
    const list = allViews();
    const all = [...list, ...SPECIAL_VIEWS];
    for (const v of all) counts.set(v.id, 0);
    for (const t of app.replica.tickets.values()) {
      for (const v of all) if (inView(v, t, ctx)) counts.set(v.id, counts.get(v.id) + 1);
    }
    side.append(h('div.side-nav-head', h('h2', 'Views'), app.isAdmin ? h('button.icon-btn', { type: 'button', 'aria-label': 'Create a view', title: 'Create a view', onclick: () => go('/admin/views/new') }, icon('plus', { size: 16 })) : null));
    const link = (v) => h('a.side-link', { href: `#/views/${v.id}`, 'aria-current': v.id === viewId ? 'page' : undefined }, h('span.ellipsis', v.title), h('span.count', String(counts.get(v.id) ?? 0)));
    side.append(h('div', list.filter((v) => v.id.startsWith('sys-')).map(link)));
    const custom = list.filter((v) => !v.id.startsWith('sys-'));
    if (custom.length) side.append(h('div.side-group', 'Shared views'), h('div', custom.map(link)));
    side.append(h('div.side-sep'), h('div', SPECIAL_VIEWS.map(link)));
  }

  function refresh() {
    const list = ticketsInView(view);
    countEl.textContent = plural(list.length, 'ticket');
    updatedEl.textContent = `Updated ${relTime(Date.now())}`;
    table.update({ tickets: list, columns, sort, groupBy });
    content.querySelector('.view-empty')?.remove();
    table.el.hidden = list.length === 0;
    if (!list.length) {
      content.append(h('div.view-empty', emptyState({
        glyph: view.special === 'deleted' ? 'trash' : view.special === 'spam' ? 'ban' : 'circle-check',
        title: view.special ? 'Nothing here' : 'No tickets in this view',
        text: view.special === 'deleted' ? 'Deleted tickets stay here until an administrator removes them for good.' : view.special === 'spam' ? 'Tickets marked as spam are kept out of every other view.' : 'When tickets match this view they will appear here.',
        action: view.special ? null : h('button.btn', { type: 'button', onclick: () => go('/tickets/new') }, icon('plus', { size: 14 }), 'New ticket'),
      })));
    }
  }

  // Counts change on every sync; keyboard focus in the list stays put.
  const paintSideSoon = debounce(() => preserveFocus(side, paintSide), 250);
  /** Follow edits to this view made since it was opened (by a teammate, say). */
  function followView() {
    const fresh = viewById(viewId);
    if (!fresh) {
      // Deleted or turned off: show the first view instead.
      go(`/views/${allViews()[0].id}`, { replace: true });
      return false;
    }
    // Settings saved anew (another view changed) without changes to this one.
    if (fresh === view || JSON.stringify(fresh) === JSON.stringify(view)) return true;
    view = fresh;
    columns = view.columns?.length ? view.columns : DEFAULT_COLUMNS;
    if (!prefs.sort) sort = view.sort || { field: 'updatedAt', dir: 'desc' };
    if (prefs.groupBy === undefined && view.groupBy !== undefined) groupBy = view.groupBy || null;
    titleEl.textContent = view.title;
    switchBtn.setAttribute('aria-label', `${view.title}. Switch view`);
    switchBtn.querySelector('.ellipsis').textContent = view.title;
    table.el.querySelector('table')?.setAttribute('aria-label', view.title);
    return true;
  }

  const onChange = (e) => {
    const k = e.detail?.kinds;
    if ((!k || k.has('c')) && !followView()) return;
    if (!k || k.has('t') || k.has('u') || k.has('c') || k.has('m')) {
      refresh();
      paintSideSoon();
    }
  };
  app.replica.addEventListener('change', onChange);
  const clock = setInterval(() => {
    updatedEl.textContent = `Updated ${relTime(Date.now())}`;
  }, 30000);
  const unbind = bind('views', { j: () => table.focusFirst(), k: () => table.focusFirst() });
  paintSide();
  refresh();
  requestAnimationFrame(() => refresh());
  return () => {
    app.replica.removeEventListener('change', onChange);
    clearInterval(clock);
    unbind();
    table.destroy();
  };
}

/**
 * The ticket table used by views and search. Rows are rendered in a window
 * around the scroll position, so a view with tens of thousands of tickets
 * scrolls as smoothly as one with ten. Keyboard: j/k or arrows move, Enter
 * opens, x selects; shift-click selects a range.
 */
import { h, clear, rafThrottle } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { statusBadge, priorityLabel, avatar } from '../ui/components.js';
import { relTime, fullDate } from '../ui/format.js';
import { STATUS_LABEL, PRIORITY_RANK, TYPE_LABEL, CHANNEL_LABEL, STATUSES } from '../shared/model.js';
import { slaStatus, shortDuration } from '../shared/rules.js';
import { app } from '../app.js';

const GROUP_H = 38;
const phone = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 767px)') : { matches: false };
let ROW_H = phone.matches ? 66 : 46;
const STATUS_RANK = Object.fromEntries(STATUSES.map((s, i) => [s, i]));

export const COLUMNS = {
  sla: { label: 'SLA', width: 72, sort: (t) => slaStatus(t, app.replica.cfg.sla)?.dueAt ?? Infinity },
  status: { label: 'Status', width: 92, sort: (t) => STATUS_RANK[t.status] },
  id: { label: 'ID', width: 70, sort: (t) => t.id },
  subject: { label: 'Subject', width: null, sort: (t) => t.subject.toLowerCase() },
  requester: { label: 'Requester', width: 170, sort: (t) => app.userName(t.requester).toLowerCase() },
  org: { label: 'Organization', width: 150, sort: (t) => (t.org ? app.replica.orgs.get(t.org)?.name || '' : '').toLowerCase() },
  createdAt: { label: 'Requested', width: 120, sort: (t) => t.createdAt },
  updatedAt: { label: 'Updated', width: 120, sort: (t) => t.updatedAt },
  priority: { label: 'Priority', width: 100, sort: (t) => PRIORITY_RANK[t.priority] || 0 },
  type: { label: 'Type', width: 96, sort: (t) => t.type || '' },
  assignee: { label: 'Assignee', width: 170, sort: (t) => app.memberName(t.assignee).toLowerCase() },
  group: { label: 'Group', width: 120, sort: (t) => groupName(t.group).toLowerCase() },
  via: { label: 'Channel', width: 110, sort: (t) => t.via },
  satisfaction: { label: 'Satisfaction', width: 110, sort: (t) => t.csat?.score || '' },
};

export const GROUPS = {
  status: { label: 'Status', key: (t) => t.status, title: (k) => STATUS_LABEL[k], order: (k) => STATUS_RANK[k] },
  priority: { label: 'Priority', key: (t) => t.priority || '', title: (k) => (k ? k[0].toUpperCase() + k.slice(1) : 'No priority'), order: (k) => -(PRIORITY_RANK[k] || 0) },
  assignee: { label: 'Assignee', key: (t) => t.assignee || '', title: (k) => (k ? app.memberName(k) : 'Unassigned'), order: (k) => (k ? app.memberName(k) : '￿') },
  group: { label: 'Group', key: (t) => t.group || '', title: (k) => (k ? groupName(k) : 'No group'), order: (k) => (k ? groupName(k) : '￿') },
  type: { label: 'Type', key: (t) => t.type || '', title: (k) => TYPE_LABEL[k] || 'No type', order: (k) => k || '￿' },
  via: { label: 'Channel', key: (t) => t.via, title: (k) => CHANNEL_LABEL[k] || k, order: (k) => k },
};

function groupName(id) {
  return (app.replica.cfg.groups || []).find((g) => g.id === id)?.name || '';
}

export function slaBadge(t) {
  const s = slaStatus(t, app.replica.cfg.sla);
  if (!s) return null;
  const soon = !s.breached && s.remaining < 60 * 60 * 1000;
  const label = s.breached ? `Breached by ${shortDuration(-s.remaining)}` : `Due in ${shortDuration(s.remaining)}`;
  return h(`span.sla${s.breached ? '.breached' : soon ? '.soon' : ''}`, { title: `${s.metric === 'first' ? 'First reply' : s.metric === 'next' ? 'Next reply' : 'Resolution'}: ${label}` }, s.breached ? `-${shortDuration(-s.remaining)}` : shortDuration(s.remaining));
}

function cell(col, t) {
  switch (col) {
    case 'sla':
      return slaBadge(t) || h('span.subtle', '');
    case 'status':
      return statusBadge(t.status);
    case 'id':
      return h('span.muted', `#${t.id}`);
    case 'subject':
      return h('div.subject-cell', h('span.ellipsis.subject-text', t.subject), t.preview ? h('span.ellipsis.subject-preview', t.preview) : null);
    case 'requester':
      return h('span.ellipsis', app.userName(t.requester));
    case 'org':
      return h('span.ellipsis', t.org ? app.replica.orgs.get(t.org)?.name || '' : '');
    case 'createdAt':
      return h('span', { title: fullDate(t.createdAt) }, relTime(t.createdAt));
    case 'updatedAt':
      return h('span', { title: fullDate(t.updatedAt) }, relTime(t.updatedAt));
    case 'priority':
      return priorityLabel(t.priority);
    case 'type':
      return h('span', TYPE_LABEL[t.type] || '');
    case 'assignee':
      return t.assignee ? h('span.row.assignee-cell', avatar(app.memberName(t.assignee), { size: 'sm', agent: true }), h('span.ellipsis', app.memberName(t.assignee))) : h('span.subtle', 'Unassigned');
    case 'group':
      return h('span.ellipsis', groupName(t.group));
    case 'via':
      return h('span', CHANNEL_LABEL[t.via] || t.via);
    case 'satisfaction':
      return t.csat ? h(`span.csat.${t.csat.score}`, icon(t.csat.score === 'good' ? 'thumbs-up' : 'thumbs-down', { size: 14 }), t.csat.score === 'good' ? 'Good' : 'Bad') : h('span.subtle', '');
    default:
      return '';
  }
}

/**
 * Create a table. Call `update({ tickets, columns, groupBy, sort })` to
 * render. `onOpen(ticket, list)` opens; `onSelect(set)` reports selection.
 */
export function ticketTable({ onOpen, onSelect, onSort, label = 'Tickets', selectable = true }) {
  const scroller = h('div.tt-scroll', { tabindex: '-1' });
  const table = h('table.table.tt', { 'aria-label': label, 'aria-rowcount': '0' });
  const thead = h('thead');
  const tbody = h('tbody');
  table.append(thead, tbody);
  scroller.append(table);

  let items = [];
  let tickets = [];
  let columns = [];
  let sort = { field: 'updatedAt', dir: 'desc' };
  let offsets = [];
  let total = 0;
  const selected = new Set();
  let focusId = null;
  let anchorId = null;

  function header() {
    clear(thead);
    const tr = h('tr');
    if (selectable) {
      const all = h('input', { type: 'checkbox', 'aria-label': 'Select all tickets', onchange: () => {
        if (all.checked) tickets.forEach((t) => selected.add(t.id));
        else selected.clear();
        render();
        onSelect?.(new Set(selected));
      } });
      all.checked = tickets.length > 0 && tickets.every((t) => selected.has(t.id));
      all.indeterminate = !all.checked && selected.size > 0;
      tr.append(h('th.check', all));
    }
    for (const c of columns) {
      const def = COLUMNS[c];
      if (!def) continue;
      const active = sort.field === c;
      tr.append(h('th', {
        style: def.width ? { width: `${def.width}px` } : {},
        'aria-sort': active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined,
      }, h('button.sort-btn', {
        type: 'button',
        onclick: () => {
          sort = { field: c, dir: active && sort.dir === 'desc' ? 'asc' : active ? 'desc' : c === 'subject' || c === 'requester' ? 'asc' : 'desc' };
          onSort?.(sort);
        },
      }, def.label, icon(active ? (sort.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'arrow-up-down', { size: 12 }))));
    }
    thead.append(tr);
  }

  function rowEl(t, index, ariaIndex) {
    const isSel = selected.has(t.id);
    const tr = h(`tr${isSel ? '.selected' : ''}`, {
      tabindex: t.id === focusId || (focusId === null && index === 0) ? '0' : '-1',
      'aria-rowindex': String(ariaIndex),
      dataset: { id: String(t.id) },
      onclick: (e) => {
        if (e.target.closest('input')) return;
        if (e.shiftKey && selectable) {
          rangeSelect(index);
          return;
        }
        if (e.metaKey || e.ctrlKey) {
          window.open(`#/tickets/${t.id}`, '_blank');
          return;
        }
        onOpen?.(t, tickets);
      },
      onfocus: () => {
        focusId = t.id;
      },
    });
    if (selectable) {
      tr.append(h('td.check', h('input', {
        type: 'checkbox', checked: isSel, 'aria-label': `Select ticket ${t.id}`,
        onclick: (e) => {
          if (e.shiftKey) {
            e.preventDefault();
            rangeSelect(index);
            return;
          }
          toggle(t.id);
        },
      })));
    }
    for (const c of columns) if (COLUMNS[c]) tr.append(h(`td.col-${c}`, cell(c, t)));
    return tr;
  }

  function toggle(id) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    anchorId = id;
    render();
    onSelect?.(new Set(selected));
  }

  function rangeSelect(index) {
    const rows = items.filter((x) => x.t);
    // The anchor is a ticket, not a position: the list may have been
    // re-sorted or updated live since it was clicked.
    const at = rows.findIndex((x) => x.t.id === anchorId);
    const from = at >= 0 ? at : index;
    const [a, b] = [Math.min(from, index), Math.max(from, index)];
    for (let i = a; i <= b; i++) if (rows[i]) selected.add(rows[i].t.id);
    render();
    onSelect?.(new Set(selected));
  }

  function layout() {
    ROW_H = phone.matches ? 66 : 46;
    offsets = [];
    let y = 0;
    for (const it of items) {
      offsets.push(y);
      y += it.group ? GROUP_H : ROW_H;
    }
    total = y;
  }

  let shown = '';

  /**
   * Draw the rows in and around the visible range. Scrolling only redraws
   * when that range changes, and focus stays on the same row or header
   * control across a redraw, so keyboard users keep their place.
   */
  function render({ scrolling = false } = {}) {
    const viewTop = scroller.scrollTop;
    const viewH = scroller.clientHeight || 800;
    const headH = thead.offsetHeight || 40;
    let start = 0;
    while (start < items.length - 1 && offsets[start + 1] < viewTop - headH - 400) start++;
    let end = start;
    while (end < items.length && offsets[end] < viewTop + viewH + 400) end++;
    if (scrolling && shown === `${start}:${end}`) return;
    shown = `${start}:${end}`;
    const active = document.activeElement;
    const inHead = !scrolling && thead.contains(active) ? [...thead.querySelectorAll('button, input')].indexOf(active) : -1;
    const inRow = tbody.contains(active) ? { id: active.closest('tr[data-id]')?.dataset.id, box: active.tagName === 'INPUT' } : null;
    if (!scrolling) header();
    clear(tbody);
    const colspan = columns.length + (selectable ? 1 : 0);
    if (offsets[start] > 0) tbody.append(h('tr.tt-spacer', { 'aria-hidden': 'true' }, h('td', { colspan, style: { height: `${offsets[start]}px`, padding: 0, border: 0 } })));
    let rowIndex = items.slice(0, start).filter((x) => x.t).length;
    for (let i = start; i < end; i++) {
      const it = items[i];
      // Row 1 is the header; group headings are rows too.
      if (it.group) {
        tbody.append(h('tr.tt-group', { 'aria-rowindex': String(i + 2) }, h('td', { colspan }, h('span.tt-group-label', `${it.label}`), h('span.count', String(it.count)))));
      } else {
        tbody.append(rowEl(it.t, rowIndex, i + 2));
        rowIndex++;
      }
    }
    // One row is always reachable with Tab, even when the one last focused
    // left the view or is scrolled out of the drawn range.
    if (!tbody.querySelector('tr[tabindex="0"]')) tbody.querySelector('tr[data-id]')?.setAttribute('tabindex', '0');
    const rest = total - (offsets[end] ?? total);
    if (rest > 0) tbody.append(h('tr.tt-spacer', { 'aria-hidden': 'true' }, h('td', { colspan, style: { height: `${rest}px`, padding: 0, border: 0 } })));
    table.setAttribute('aria-rowcount', String(items.length + 1));
    if (inHead >= 0) thead.querySelectorAll('button, input')[inHead]?.focus({ preventScroll: true });
    else if (inRow) {
      const tr = tbody.querySelector(`tr[data-id="${inRow.id}"]`);
      // A row scrolled out of the drawn range hands focus to the list, so
      // j and k carry on from it.
      (tr ? (inRow.box ? tr.querySelector('input') : tr) : scroller)?.focus({ preventScroll: true });
    }
  }

  const onScroll = rafThrottle(() => render({ scrolling: true }));
  scroller.addEventListener('scroll', onScroll, { passive: true });

  // A taller window shows more rows, and crossing the phone breakpoint
  // changes the row height, which moves every row.
  const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(rafThrottle(() => {
    if ((phone.matches ? 66 : 46) !== ROW_H) {
      layout();
      render();
    } else render({ scrolling: true });
  }));
  resized?.observe(scroller);

  function move(delta) {
    const rows = items.filter((x) => x.t).map((x) => x.t);
    if (!rows.length) return;
    let i = rows.findIndex((t) => t.id === focusId);
    i = Math.max(0, Math.min(rows.length - 1, (i === -1 ? -1 : i) + delta));
    focusId = rows[i].id;
    const itemIndex = items.findIndex((x) => x.t && x.t.id === focusId);
    const y = offsets[itemIndex];
    const headH = thead.offsetHeight || 40;
    if (y < scroller.scrollTop) scroller.scrollTop = y;
    else if (y + ROW_H > scroller.scrollTop + scroller.clientHeight - headH) scroller.scrollTop = y + ROW_H - scroller.clientHeight + headH;
    render();
    tbody.querySelector(`tr[data-id="${focusId}"]`)?.focus();
  }

  scroller.addEventListener('keydown', (e) => {
    // Row keys work on rows (and the list itself); the header's sort buttons
    // and select-all box keep their own Enter and Space.
    if (e.target !== scroller && !e.target.closest('tbody tr[data-id]')) return;
    if (e.target.tagName === 'INPUT' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter' || e.key === 'o') {
      const t = tickets.find((x) => x.id === focusId);
      if (t) { e.preventDefault(); onOpen?.(t, tickets); }
    } else if (e.key === 'x' && selectable) {
      if (tickets.some((x) => x.id === focusId)) { e.preventDefault(); toggle(focusId); tbody.querySelector(`tr[data-id="${focusId}"]`)?.focus(); }
    }
  });

  return {
    el: scroller,
    update(opts) {
      columns = opts.columns || columns;
      sort = opts.sort || sort;
      const def = COLUMNS[sort.field] || COLUMNS.updatedAt;
      const dir = sort.dir === 'asc' ? 1 : -1;
      tickets = [...opts.tickets].sort((a, b) => {
        const x = def.sort(a);
        const y = def.sort(b);
        return (x < y ? -1 : x > y ? 1 : b.id - a.id) * dir;
      });
      // Tickets that left the view leave the selection, and the bulk bar has
      // to hear about it, or its actions would still apply to them.
      const ids = new Set(tickets.map((t) => t.id));
      const before = selected.size;
      for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);
      if (selected.size !== before) onSelect?.(new Set(selected));
      items = [];
      if (opts.groupBy && GROUPS[opts.groupBy]) {
        const g = GROUPS[opts.groupBy];
        const buckets = new Map();
        for (const t of tickets) {
          const k = g.key(t);
          if (!buckets.has(k)) buckets.set(k, []);
          buckets.get(k).push(t);
        }
        const keys = [...buckets.keys()].sort((a, b) => {
          const x = g.order(a);
          const y = g.order(b);
          return x < y ? -1 : x > y ? 1 : 0;
        });
        tickets = [];
        for (const k of keys) {
          items.push({ group: true, label: `${g.label}: ${g.title(k)}`, count: buckets.get(k).length });
          for (const t of buckets.get(k)) {
            items.push({ t });
            tickets.push(t);
          }
        }
      } else {
        items = tickets.map((t) => ({ t }));
      }
      layout();
      render();
    },
    clearSelection() {
      selected.clear();
      render();
      onSelect?.(new Set());
    },
    focusFirst() {
      focusId = null;
      move(1);
    },
    destroy() {
      resized?.disconnect();
    },
    get tickets() {
      return tickets;
    },
    get selection() {
      return new Set(selected);
    },
  };
}

/**
 * Calendar: everything with a date in one place. Lease move-ins, move-outs
 * and term ends, renewal follow-ups, task and work order due dates, bill due
 * dates, inspections and events. A month grid on larger screens and an
 * agenda list on phones (or by choice).
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { pageHeader, segmented, field, textInput, textarea, emptyState } from '../ui/components.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { setQuery } from '../ui/router.js';
import { addDays, addMonths, endOfMonth, formatDate, formatTime, formatTimeRange, startOfMonth, startOfWeek, monthLabel } from '../core/dates.js';
import { billStatus } from '../core/ledger.js';
import { effectiveEnd } from '../core/leases.js';
import { displayName } from '../core/format.js';
import { propertySelect } from './common.js';

export const CAL_TYPES = [
  { id: 'lease', label: 'Leases', icon: 'file-signature' },
  { id: 'maintenance', label: 'Maintenance', icon: 'wrench' },
  { id: 'task', label: 'Tasks', icon: 'list-checks' },
  { id: 'bill', label: 'Bills', icon: 'receipt' },
  { id: 'event', label: 'Events', icon: 'calendar' },
  { id: 'inspection', label: 'Inspections', icon: 'clipboard-check' },
];

const DONE_WO = new Set(['completed', 'closed', 'cancelled']);
const DONE_TASK = new Set(['completed', 'closed', 'deferred']);
/** Days after an offer is sent before it needs a follow-up. */
export const RENEWAL_FOLLOW_UP_DAYS = 14;

/**
 * Every dated item between from and to (inclusive), sorted by date then time.
 * Pure apart from reading the store: [{ id, type, date, time?, title, sub, href, tone }]
 */
export function calendarItems(store, { from, to, today, ledger }) {
  const out = [];
  const inRange = (d) => d && d >= from && d <= to;
  const place = (unitId, propertyId) => (unitId ? lookup.unitLabel(unitId) : propertyId ? store.get('properties', propertyId)?.name || '' : '');
  const tenantsOf = (l) =>
    (l.tenantIds || [])
      .map((id) => store.get('tenants', id))
      .filter(Boolean)
      .map((t) => [t.firstName, t.lastName].filter(Boolean).join(' ') || t.company)
      .join(', ');

  for (const l of store.all('leases')) {
    if (l.draft) continue;
    const where = place(l.unitId, l.propertyId);
    const who = tenantsOf(l);
    // A renewal continues the same tenancy: nobody moves in, and the lease
    // it replaces ends without anyone leaving.
    const renewal = l.renewsLeaseId && store.get('leases', l.renewsLeaseId);
    const renewedBy = l.renewedByLeaseId && store.get('leases', l.renewedByLeaseId);
    if (inRange(l.start)) out.push(renewal ? { id: `in-${l.id}`, type: 'lease', date: l.start, title: `Renewal starts: ${where}`, sub: who, href: `#/leases/${l.id}`, tone: 'info' } : { id: `in-${l.id}`, type: 'lease', date: l.start, title: `Move-in: ${where}`, sub: who, href: `#/leases/${l.id}`, tone: 'success' });
    const moveOut = l.moveOut?.date;
    if (inRange(moveOut)) out.push({ id: `out-${l.id}`, type: 'lease', date: moveOut, title: `Move-out: ${where}`, sub: who, href: `#/leases/${l.id}`, tone: 'warning' });
    if (l.end && !moveOut && l.type !== 'at-will' && !(renewedBy && !renewedBy.draft) && inRange(l.end)) {
      out.push({ id: `end-${l.id}`, type: 'lease', date: l.end, title: `Lease ends: ${where}`, sub: who, href: `#/leases/${l.id}`, tone: l.type === 'fixed' ? 'warning' : 'neutral' });
    }
    if (l.renewal?.status === 'offered' && l.renewal.offeredOn) {
      const follow = addDays(l.renewal.offeredOn, RENEWAL_FOLLOW_UP_DAYS);
      if (inRange(follow) && (!effectiveEnd(l) || effectiveEnd(l) >= follow)) out.push({ id: `ren-${l.id}`, type: 'lease', date: follow, title: `Follow up on renewal: ${where}`, sub: who, href: `#/leases/${l.id}`, tone: 'info' });
    }
  }

  for (const w of store.all('workOrders')) {
    if (!inRange(w.dueDate) || DONE_WO.has(w.status)) continue;
    out.push({ id: `wo-${w.id}`, type: 'maintenance', date: w.dueDate, title: `WO-${w.number}: ${w.title}`, sub: place(w.unitId, w.propertyId), href: `#/work-orders/${w.id}`, tone: w.dueDate < today ? 'danger' : 'accent' });
  }

  for (const t of store.all('tasks')) {
    if (!inRange(t.dueDate) || DONE_TASK.has(t.status)) continue;
    out.push({ id: `tk-${t.id}`, type: 'task', date: t.dueDate, title: t.title, sub: place(t.unitId, t.propertyId), href: `#/tasks/${t.id}`, tone: t.dueDate < today ? 'danger' : 'info' });
  }

  for (const tx of store.all('transactions')) {
    if (tx.kind !== 'bill' || tx.voided || !inRange(tx.dueDate)) continue;
    const status = billStatus(tx, ledger.bill(tx.id), today);
    if (status === 'paid' || status === 'void') continue;
    const vendor = store.get('vendors', tx.vendorId);
    out.push({ id: `bill-${tx.id}`, type: 'bill', date: tx.dueDate, title: `Bill due: ${vendor ? displayName(vendor) : 'Vendor'}`, sub: tx.memo || '', href: `#/bills/${tx.id}`, tone: status === 'overdue' ? 'danger' : 'neutral' });
  }

  for (const i of store.all('inspections')) {
    if (!inRange(i.date)) continue;
    const kind = { 'move-in': 'Move-in', 'move-out': 'Move-out', routine: 'Routine' }[i.type] || 'Routine';
    out.push({ id: `ins-${i.id}`, type: 'inspection', date: i.date, title: `${kind} inspection`, sub: place(i.unitId, i.propertyId), href: `#/inspections/${i.id}`, tone: i.status === 'completed' ? 'neutral' : 'accent' });
  }

  for (const e of store.all('events')) {
    if (!inRange(e.date)) continue;
    out.push({ id: `ev-${e.id}`, type: 'event', date: e.date, time: e.start || '', end: e.end || '', title: e.title || 'Event', sub: e.propertyId ? store.get('properties', e.propertyId)?.name || '' : '', eventId: e.id, tone: 'accent' });
  }

  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time || '99').localeCompare(b.time || '99')));
}

// ---- View ----------------------------------------------------------------------

const TYPES_KEY = 'propertymgmt.calendarTypes';

function loadTypes(query) {
  if (query.types) return new Set(query.types.split(',').filter((t) => CAL_TYPES.some((c) => c.id === t)));
  try {
    const v = JSON.parse(localStorage.getItem(TYPES_KEY) || 'null');
    if (Array.isArray(v)) return new Set(v);
  } catch {}
  return new Set(CAL_TYPES.map((t) => t.id));
}

export function render(ctx) {
  const today = app.today();
  const isPhone = typeof matchMedia === 'function' && matchMedia('(max-width: 767px)').matches;
  const state = {
    view: ctx.query.view === 'agenda' || ctx.query.view === 'month' ? ctx.query.view : isPhone ? 'agenda' : 'month',
    month: /^\d{4}-\d{2}$/.test(ctx.query.m || '') ? `${ctx.query.m}-01` : startOfMonth(today),
    types: loadTypes(ctx.query),
  };

  const title = h('h2.cal-title', { 'aria-live': 'polite' });
  const viewToggle = segmented({
    label: 'View',
    value: state.view,
    items: [
      { value: 'month', label: 'Month', icon: 'grid' },
      { value: 'agenda', label: 'Agenda', icon: 'list' },
    ],
    onChange: (v) => {
      state.view = v;
      setQuery({ view: v });
      body.redraw();
    },
  });

  const go = (n) => {
    state.month = n === 0 ? startOfMonth(app.today()) : addMonths(state.month, n);
    setQuery({ m: state.month.slice(0, 7) });
    body.redraw();
  };

  const toolbar = h(
    'div.cal-toolbar',
    h(
      'div.cal-nav',
      h('button.icon-btn.bordered', { type: 'button', 'aria-label': 'Previous month', onClick: () => go(-1) }, icon('chevron-left')),
      h('button.btn.sm', { type: 'button', onClick: () => go(0) }, 'Today'),
      h('button.icon-btn.bordered', { type: 'button', 'aria-label': 'Next month', onClick: () => go(1) }, icon('chevron-right')),
      title,
    ),
    h('div.grow'),
    viewToggle,
  );

  const filters = h('div');
  function drawFilters() {
    filters.replaceChildren(
      h(
        'div.chips.cal-filters',
        { role: 'group', 'aria-label': 'Show on calendar' },
        CAL_TYPES.map((t) =>
          h(
            `button.chip.cal-chip.t-${t.id}`,
            {
              type: 'button',
              'aria-pressed': String(state.types.has(t.id)),
              onClick: () => {
                if (state.types.has(t.id)) state.types.delete(t.id);
                else state.types.add(t.id);
                try {
                  localStorage.setItem(TYPES_KEY, JSON.stringify([...state.types]));
                } catch {}
                drawFilters();
                body.redraw();
              },
            },
            h('span.cal-dot', { 'aria-hidden': 'true' }),
            t.label,
          ),
        ),
      ),
    );
  }
  drawFilters();

  const body = ctx.live(() => (state.view === 'month' ? monthGrid() : agenda()), ['leases', 'workOrders', 'tasks', 'transactions', 'inspections', 'events', 'settings']);

  function rangeItems(from, to) {
    return calendarItems(app.store, { from, to, today: app.today(), ledger: app.ledger() }).filter((i) => state.types.has(i.type));
  }

  function monthGrid() {
    title.textContent = monthLabel(state.month);
    const weekStart = Number(app.settings().weekStart) || 0;
    const first = startOfWeek(state.month, weekStart);
    const last = addDays(startOfWeek(endOfMonth(state.month), weekStart), 6);
    const items = rangeItems(first, last);
    const byDay = new Map();
    for (const it of items) {
      if (!byDay.has(it.date)) byDay.set(it.date, []);
      byDay.get(it.date).push(it);
    }
    const now = app.today();
    const weeks = [];
    for (let d = first; d <= last; d = addDays(d, 7)) weeks.push(d);
    const head = h(
      'div.cal-row.cal-head',
      { role: 'row' },
      Array.from({ length: 7 }, (_, i) => {
        const d = addDays(first, i);
        return h('div.cal-colhead', { role: 'columnheader', 'aria-label': formatDate(d, { weekday: 'long' }) }, formatDate(d, { weekday: 'short' }));
      }),
    );
    return h(
      'div.cal-month',
      { role: 'grid', 'aria-label': monthLabel(state.month) },
      head,
      weeks.map((ws) =>
        h(
          'div.cal-row',
          { role: 'row' },
          Array.from({ length: 7 }, (_, i) => {
            const d = addDays(ws, i);
            const list = byDay.get(d) || [];
            const outside = d.slice(0, 7) !== state.month.slice(0, 7);
            const shown = list.slice(0, 3);
            const more = list.length - shown.length;
            return h(
              `div.cal-cell${outside ? '.outside' : ''}${d === now ? '.today' : ''}`,
              { role: 'gridcell', 'aria-label': `${formatDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}${list.length ? `, ${list.length} item${list.length === 1 ? '' : 's'}` : ''}` },
              h(
                'div.cal-cell-head',
                h('span.cal-daynum', { 'aria-hidden': 'true' }, String(Number(d.slice(8)))),
                h('button.icon-btn.sm.cal-add', { type: 'button', 'aria-label': `Add event on ${formatDate(d, { month: 'long', day: 'numeric' })}`, title: 'Add event', onClick: () => eventDialog({ date: d }) }, icon('plus', 14)),
              ),
              h('ul.cal-items', shown.map((it) => h('li', itemChip(it)))),
              more > 0
                ? h(
                    'button.link-btn.cal-more',
                    {
                      type: 'button',
                      onClick: () => dayPopover(d, list),
                    },
                    `${more} more`,
                  )
                : null,
            );
          }),
        ),
      ),
    );
  }

  function agenda() {
    title.textContent = monthLabel(state.month);
    const from = state.month;
    const to = endOfMonth(state.month);
    const items = rangeItems(from, to);
    if (!items.length) {
      return h(
        'div.card',
        emptyState({
          compact: true,
          icon: 'calendar-check',
          title: 'Nothing scheduled this month',
          text: 'Move-ins, lease ends, due dates and events show up here.',
          actions: [h('button.btn', { type: 'button', onClick: () => eventDialog({ date: from <= app.today() && app.today() <= to ? app.today() : from }) }, icon('plus', 16), 'Add event')],
          headingLevel: 3,
        }),
      );
    }
    const groups = new Map();
    for (const it of items) {
      if (!groups.has(it.date)) groups.set(it.date, []);
      groups.get(it.date).push(it);
    }
    const now = app.today();
    return h(
      'div.cal-agenda',
      [...groups].map(([d, list]) =>
        h(
          `section.agenda-day${d === now ? '.today' : ''}${d < now ? '.past' : ''}`,
          { 'aria-label': formatDate(d, { weekday: 'long', month: 'long', day: 'numeric' }) },
          h(
            'h3.agenda-date',
            h('span.agenda-dow', formatDate(d, { weekday: 'short' })),
            h('span.agenda-num', String(Number(d.slice(8)))),
            d === now ? h('span.pill.accent.plain', 'Today') : null,
          ),
          h('ul.agenda-items', list.map((it) => h('li', agendaRow(it)))),
        ),
      ),
    );
  }

  function dayPopover(d, list) {
    openDialog({
      title: formatDate(d, { weekday: 'long', month: 'long', day: 'numeric' }),
      size: 'narrow',
      body: ({ close }) => h('ul.agenda-items', list.map((it) => h('li', { onClick: (e) => e.target.closest('a,button') && close() }, agendaRow(it)))),
    });
  }

  const header = pageHeader({
    title: 'Calendar',
    actions: [h('button.btn.primary', { type: 'button', onClick: () => eventDialog({ date: app.today() }) }, icon('plus', 16), 'Add event')],
  });

  return {
    node: h('div.page.calendar-page', header, h('section.card.cal-card', { 'aria-label': 'Calendar' }, toolbar, filters, body)),
    title: 'Calendar',
  };
}

function typeIcon(type) {
  return CAL_TYPES.find((t) => t.id === type)?.icon || 'calendar';
}

function itemChip(it) {
  // In the month grid space is tight: the start time only, then the title.
  const label = `${it.time ? formatTime(it.time) + ' ' : ''}${it.title}`;
  const attrs = { title: [label, it.sub].filter(Boolean).join('\n'), class: `cal-item t-${it.type} tone-${it.tone || 'neutral'}` };
  if (it.eventId) return h('button', { type: 'button', ...attrs, onClick: () => eventDialog({ id: it.eventId }) }, h('span.cal-dot', { 'aria-hidden': 'true' }), h('span.truncate', label));
  return h('a', { href: it.href, ...attrs }, h('span.cal-dot', { 'aria-hidden': 'true' }), h('span.truncate', label));
}

function agendaRow(it) {
  const content = [
    h(`span.agenda-icon.t-${it.type}`, { 'aria-hidden': 'true' }, icon(typeIcon(it.type), 16)),
    h('span.grow.agenda-text', h('span.agenda-title', it.title), it.sub ? h('span.agenda-sub', it.sub) : null),
    h('span.agenda-time.subtle', it.time ? formatTimeRange(it.time, it.end) : CAL_TYPES.find((t) => t.id === it.type)?.label.replace(/s$/, '') || ''),
  ];
  if (it.eventId) return h('button.agenda-row', { type: 'button', onClick: () => eventDialog({ id: it.eventId }) }, content);
  return h('a.agenda-row', { href: it.href }, content);
}

// ---- Events --------------------------------------------------------------------

/** Add or edit a calendar event. */
export function eventDialog({ id = null, date = null, propertyId = '' } = {}) {
  const store = app.store;
  const existing = id ? store.get('events', id) : null;
  const ev = existing || { title: '', date: date || app.today(), start: '', end: '', propertyId, notes: '' };
  const titleIn = textInput({ name: 'title', value: ev.title, placeholder: 'e.g. Fire inspection', required: true });
  const dateIn = textInput({ name: 'date', type: 'date', value: ev.date, required: true });
  const startIn = textInput({ name: 'start', type: 'time', value: ev.start });
  const endIn = textInput({ name: 'end', type: 'time', value: ev.end });
  const prop = propertySelect({ value: ev.propertyId || '', empty: 'No property' });
  const notes = textarea({ name: 'notes', value: ev.notes, rows: 3 });
  const error = h('p.form-error.span-2', { role: 'alert', hidden: true });

  const save = (close) => {
    const t = titleIn.value.trim();
    if (!t) {
      titleIn.setAttribute('aria-invalid', 'true');
      titleIn.focus();
      return;
    }
    if (!dateIn.value) {
      dateIn.setAttribute('aria-invalid', 'true');
      dateIn.focus();
      return;
    }
    if (startIn.value && endIn.value && endIn.value < startIn.value) {
      error.textContent = 'The end time is before the start time.';
      error.hidden = false;
      endIn.focus();
      return;
    }
    const rec = { ...ev, title: t, date: dateIn.value, start: startIn.value, end: endIn.value, propertyId: prop.value || null, notes: notes.value.trim() };
    store.put('events', rec);
    close();
    toast(existing ? 'Event updated' : `Event added for ${formatDate(rec.date)}`);
  };

  openDialog({
    title: existing ? 'Edit event' : 'Add event',
    body: ({ close }) => {
      const form = h(
        'form.form-grid',
        { onSubmit: (e) => (e.preventDefault(), save(close)), novalidate: true },
        field('Title', titleIn, { span2: true, required: true }),
        field('Date', dateIn, { required: true }),
        field('Property', prop),
        field('Starts', startIn),
        field('Ends', endIn),
        field('Notes', notes, { span2: true }),
        error,
        h('button', { type: 'submit', hidden: true }),
      );
      return form;
    },
    footer: ({ close }) => [
      existing
        ? h(
            'button.btn.subtle-danger',
            {
              type: 'button',
              onClick: async () => {
                const ok = await confirmDialog({ title: 'Delete this event?', message: `"${existing.title}" will be removed from the calendar.`, confirmLabel: 'Delete', danger: true });
                if (!ok) return;
                const removed = store.remove('events', existing.id);
                close();
                toast('Event deleted', { action: { label: 'Undo', run: () => store.restore('events', removed) } });
              },
            },
            icon('trash', 16),
            'Delete',
          )
        : null,
      h('div.spacer'),
      h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
      h('button.btn.primary', { type: 'button', onClick: () => save(close) }, existing ? 'Save' : 'Add event'),
    ],
  });
}

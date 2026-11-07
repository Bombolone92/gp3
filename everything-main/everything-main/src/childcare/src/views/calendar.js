/** Calendar: school events, closures, and birthdays by month, with an agenda for phones. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { pageHeader, emptyState, field, textInput, textarea, select, segmented, pill, moreButton } from '../ui/components.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { openMenu } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { setQuery } from '../ui/router.js';
import { app, isFamily, myStudents } from '../app.js';
import { firstName } from '../core/format.js';
import { sortRooms } from '../core/people.js';
import { startOfMonth, endOfMonth, addDays, addMonths, startOfWeek, formatDate, formatTime, monthLabel, nextBirthday, relativeDay } from '../core/dates.js';
import { eventsOn, toICS } from '../core/calendar.js';
import { downloadText } from '../core/csv.js';
import { roomDot } from './common.js';

export function render(ctx) {
  const store = app.store;
  // A malformed ?month= would make an endless grid of invalid dates.
  let month = startOfMonth(/^\d{4}-(0[1-9]|1[0-2])$/.test(ctx.query.month || '') ? `${ctx.query.month}-01` : app.today());
  let room = 'all';

  const body = ctx.live(() => {
    const weekStart = app.settings().weekStart ?? 0;
    const rooms = sortRooms(store.all('rooms'));
    const events = familyEvents().filter((e) => isFamily() || room === 'all' || !e.roomIds?.length || e.roomIds.includes(room));
    const kids = myStudents().filter((s) => s.status === 'active' && (room === 'all' || s.roomId === room));
    const first = startOfWeek(month, weekStart);
    const last = endOfMonth(month);
    const cells = [];
    for (let d = first; d <= last || cells.length % 7; d = addDays(d, 1)) cells.push(d);
    const birthdaysOn = (d) => kids.filter((s) => s.birthday && nextBirthday(s.birthday, d) === d);
    const dayNames = Array.from({ length: 7 }, (_, i) => formatDate(addDays(first, i), { weekday: 'short' }));
    const today = app.today();

    // Phones show a list: what is coming up in this month, or the month chosen with the arrows.
    const thisMonth = month.slice(0, 7) === today.slice(0, 7);
    const from = thisMonth ? today : month;
    const until = thisMonth ? addDays(today, 60) : last;
    const upcoming = [];
    for (let d = from; d <= until && (!thisMonth || upcoming.length < 30); d = addDays(d, 1)) {
      for (const e of eventsOn(events, d)) if (e.date === d || d === from) upcoming.push({ d, e });
    }

    return [
      h(
        'div.toolbar.cal-toolbar',
        h('button.btn', { type: 'button', onClick: () => ((month = startOfMonth(today)), setQuery({ month: null }), body.redraw()) }, 'Today'),
        h('button.icon-btn.bordered', { type: 'button', 'aria-label': 'Previous month', onClick: () => ((month = addMonths(month, -1)), setQuery({ month: month.slice(0, 7) }), body.redraw()) }, icon('chevron-left')),
        h('button.icon-btn.bordered', { type: 'button', 'aria-label': 'Next month', onClick: () => ((month = addMonths(month, 1)), setQuery({ month: month.slice(0, 7) }), body.redraw()) }, icon('chevron-right')),
        h('h2.cal-title', { 'aria-live': 'polite' }, monthLabel(month)),
        h('span.grow'),
        !isFamily()
          ? (() => {
              const s = select({ options: [{ value: 'all', label: 'All rooms' }, ...rooms.map((r) => ({ value: r.id, label: r.name }))], value: room, 'aria-label': 'Room' });
              s.addEventListener('change', () => ((room = s.value), body.redraw()));
              return s;
            })()
          : null,
      ),
      h(
        'div.cal-grid.hide-mobile',
        { role: 'grid', 'aria-label': monthLabel(month) },
        h('div.cal-row.cal-head', { role: 'row' }, dayNames.map((n) => h('div', { role: 'columnheader' }, n))),
        Array.from({ length: cells.length / 7 }, (_, w) =>
          h(
            'div.cal-row',
            { role: 'row' },
            cells.slice(w * 7, w * 7 + 7).map((d) => {
              const evs = eventsOn(events, d);
              const bdays = birthdaysOn(d);
              return h(
                `div.cal-cell${d.slice(0, 7) !== month.slice(0, 7) ? '.other' : ''}${d === today ? '.today' : ''}${evs.some((e) => e.kind === 'closure') ? '.closed' : ''}`,
                { role: 'gridcell', 'aria-label': formatDate(d, { weekday: 'long', month: 'long', day: 'numeric' }), onDblclick: () => !isFamily() && openEventForm({ date: d }) },
                h('span.cal-day', formatDate(d, { day: 'numeric' })),
                evs.slice(0, 3).map((e) => h(`button.cal-event.kind-${e.kind || 'event'}`, { type: 'button', onClick: () => showEvent(e) }, e.allDay === false && e.start && e.date === d ? h('span.cal-time', formatTime(e.start)) : null, e.title)),
                evs.length > 3 ? h('span.cal-more', `+${evs.length - 3} more`) : null,
                bdays.map((s) => h('span.cal-bday', icon('cake', 12), `${firstName(s)}'s birthday`)),
              );
            }),
          ),
        ),
      ),
      h(
        'section.show-mobile.agenda',
        { 'aria-label': thisMonth ? 'Upcoming' : monthLabel(month) },
        upcoming.length
          ? h('ul.mini-list.card-list', upcoming.map(({ d, e }) => h('li', h('span.date-chip', h('span', formatDate(d, { month: 'short' })), h('strong', formatDate(d, { day: 'numeric' }))), h('button.grow.plain-btn', { type: 'button', onClick: () => showEvent(e) }, h('span.person-name', e.title), h('span.person-sub', [relativeDay(d, today), e.allDay === false && e.start ? formatTime(e.start) : 'All day'].join(' · '))), e.kind === 'closure' ? pill('Closed', 'warning') : null)))
          : emptyState({ icon: 'calendar', title: thisMonth ? 'Nothing coming up' : `Nothing in ${monthLabel(month)}`, compact: true }),
      ),
    ];
  }, ['events', 'students', 'rooms', 'settings']);

  // Families see, and download, only events for everyone or for their children's rooms.
  function familyEvents() {
    if (!isFamily()) return store.all('events');
    const myRooms = new Set(myStudents().map((s) => s.roomId));
    return store.all('events').filter((e) => !e.roomIds?.length || e.roomIds.some((r) => myRooms.has(r)));
  }

  function exportICS() {
    downloadText(`${(app.settings().school.name || 'school').replace(/[^\w]+/g, '-').toLowerCase()}-calendar.ics`, toICS(familyEvents(), { name: app.settings().school.name || 'School calendar' }), 'text/calendar;charset=utf-8');
    toast('Calendar downloaded. Open it to add the events to your calendar app.');
  }

  return h(
    'div.page.wide-page',
    pageHeader({
      title: 'Calendar',
      actions: [moreButton((btn) => openMenu(btn, [{ label: 'Download as calendar file (.ics)', icon: 'download', run: exportICS }])), !isFamily() ? h('button.btn.primary', { type: 'button', onClick: () => openEventForm() }, icon('plus', 16), 'Add event') : null],
    }),
    body,
  );
}

function showEvent(e) {
  const store = app.store;
  openDialog({
    title: e.title,
    size: 'narrow',
    body: h(
      'div.stack',
      h('p', h('strong', e.endDate && e.endDate !== e.date ? `${formatDate(e.date)} to ${formatDate(e.endDate)}` : formatDate(e.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })), e.allDay === false && e.start ? ` · ${formatTime(e.start)}${e.end ? ` to ${formatTime(e.end)}` : ''}` : ' · All day'),
      h('div.row', e.kind === 'closure' ? pill('School closed', 'warning') : null, e.roomIds?.length ? e.roomIds.map((r) => roomDot(store.get('rooms', r))) : pill('Everyone', 'plain')),
      e.description ? h('p.pre', e.description) : null,
    ),
    footer: isFamily()
      ? null
      : ({ close }) => [
          h('button.btn.ghost.danger-text', { type: 'button', onClick: async () => (await confirmDialog({ title: 'Delete this event?', message: e.title, confirmLabel: 'Delete', danger: true })) && (store.remove('events', e.id), close()) }, icon('trash', 16), 'Delete'),
          h('span.spacer'),
          h('button.btn', { type: 'button', onClick: () => (close(), openEventForm(e)) }, 'Edit'),
        ],
  });
}

/** Add or edit an event. */
export function openEventForm(existing = {}) {
  const store = app.store;
  const e = { title: '', date: app.today(), endDate: '', allDay: true, start: '09:00', end: '10:00', kind: 'event', roomIds: [], description: '', ...structuredClone(existing) };
  const rooms = new Set(e.roomIds || []);
  const title = textInput({ value: e.title, required: true, placeholder: 'Picture day' });
  const date = textInput({ type: 'date', value: e.date, required: true });
  const endDate = textInput({ type: 'date', value: e.endDate || '' });
  const start = textInput({ type: 'time', value: e.start || '09:00' });
  const end = textInput({ type: 'time', value: e.end || '10:00' });
  const times = h('div.form-grid', field('Starts', start), field('Ends', end));
  times.hidden = e.allDay !== false;
  const allDay = h('input', { type: 'checkbox', checked: e.allDay !== false, onChange: () => (times.hidden = allDay.checked) });
  const desc = textarea({ value: e.description || '', rows: 3 });
  let kind = e.kind || 'event';
  openDialog({
    title: existing.id ? 'Edit event' : 'Add an event',
    body: h(
      'div.stack',
      field('Title', title, { required: true }),
      h('div.field', h('span.field-label', 'Type'), segmented({ label: 'Type', items: [{ value: 'event', label: 'Event' }, { value: 'closure', label: 'School closed' }], value: kind, onChange: (v) => (kind = v) })),
      h('div.form-grid', field('Date', date, { required: true }), field('Last day', endDate, { hint: 'For events over several days' })),
      h('label.check', allDay, h('span', 'All day')),
      times,
      h('div.field', h('span.field-label', 'Rooms'), h('div.check-grid', sortRooms(store.all('rooms')).map((r) => {
        const c = h('input', { type: 'checkbox', checked: rooms.has(r.id), onChange: () => (c.checked ? rooms.add(r.id) : rooms.delete(r.id)) });
        return h('label.check', c, roomDot(r));
      })), h('span.hint', 'Leave all unchecked for the whole school.')),
      field('Details', desc),
    ),
    footer: ({ close }) => [
      h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
      h(
        'button.btn.primary',
        {
          type: 'button',
          onClick: () => {
            if (!title.value.trim()) return title.focus();
            if (!date.value) return date.focus();
            // A one-day event cannot end before it starts (calendar apps reject the .ics).
            if (!allDay.checked && !(endDate.value > date.value) && start.value && end.value && end.value < start.value) {
              toast('The event ends before it starts.', { type: 'error' });
              return end.focus();
            }
            store.put('events', { ...e, title: title.value.trim(), date: date.value, endDate: endDate.value > date.value ? endDate.value : '', allDay: allDay.checked, start: allDay.checked ? '' : start.value, end: allDay.checked ? '' : end.value, kind, roomIds: [...rooms], description: desc.value.trim() });
            toast(existing.id ? 'Event saved' : 'Event added');
            close();
          },
        },
        existing.id ? 'Save' : 'Add event',
      ),
    ],
  });
}


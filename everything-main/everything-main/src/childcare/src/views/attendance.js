/**
 * Check-in board: every child's status for a day with one-tap check in and
 * out, absences, room moves, and corrections; plus staff clock in and out.
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { pageHeader, chips, searchBox, tabs, emptyState, field, textInput, select, textarea, pill } from '../ui/components.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { openMenu } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { setQuery } from '../ui/router.js';
import { app, myName, isManager } from '../app.js';
import { personName, pluralize, matches, formatHours } from '../core/format.js';
import { attendanceName, indexDay, statusOf, currentRoom, firstIn, lastOut, minutesPresent, checkIn, checkOut, moveRoom, markAbsent, clearAbsent, removeEvent, updateEvent, staffClockIn, staffClockOut, staffMoveRoom, nowHHMM, studentRecordId, staffRecordId } from '../core/attendance.js';
import { sortByName, sortRooms, pickupPeople, hasAllergy } from '../core/people.js';
import { formatTime } from '../core/dates.js';
import { childAvatar, staffAvatar, dayNav, attendancePill, roomDot } from './common.js';

const STATUS_FILTERS = [
  { id: 'all', label: 'Everyone' },
  { id: 'in', label: 'Here' },
  { id: 'none', label: 'Not here yet' },
  { id: 'absent', label: 'Absent' },
  { id: 'out', label: 'Gone home' },
];

export function render(ctx) {
  const store = app.store;
  let day = ctx.query.date || app.today();
  let tab = ctx.query.tab === 'staff' ? 'staff' : 'children';
  let room = ctx.query.room || 'all';
  let filter = ctx.query.filter || 'all';
  let q = '';
  const selected = new Set();

  const open = () => store.open([attendanceName(day)]);
  open();

  // A board left open overnight follows the date, so the morning's check-ins
  // are not recorded on yesterday. Timers stop while a laptop sleeps, so a
  // click on a board that missed midnight first moves it to the new day.
  let following = day === app.today();
  let lastToday = app.today();
  const rollover = () => {
    if (lastToday === app.today()) return false;
    lastToday = app.today();
    if (following) {
      day = lastToday;
      selected.clear();
      open();
      body.redraw();
    }
    drawHeader();
    return following;
  };
  const tick = setInterval(rollover, 60000);
  ctx.onDispose(() => clearInterval(tick));

  const header = h('div');
  const drawHeader = () =>
    header.replaceChildren(
      pageHeader({
        title: 'Check-in',
        subtitle: dayNav({
          value: day,
          max: app.today(),
          onChange: (d) => {
            day = d;
            following = d === app.today();
            selected.clear();
            setQuery({ date: d === app.today() ? null : d });
            open();
            drawHeader();
            body.redraw();
          },
        }),
        actions: [
          h('a.btn', { href: '#/kiosk' }, icon('tablet', 17), 'Kiosk mode'),
          h('a.btn', { href: `#/reports?r=signin&date=${day}` }, icon('printer', 17), h('span.hide-mobile', 'Sign-in sheet')),
        ],
      }),
      tabs({
        label: 'People',
        items: [
          { id: 'children', label: 'Children' },
          { id: 'staff', label: 'Staff' },
        ],
        selected: tab,
        onSelect: (t) => {
          tab = t;
          setQuery({ tab: t === 'staff' ? 'staff' : null });
          drawHeader();
          body.redraw();
        },
      }),
    );
  drawHeader();

  const body = ctx.live(() => (tab === 'staff' ? staffBoard(day) : childBoard()), ['attendance', 'students', 'rooms', 'staff', 'guardians']);

  function childBoard() {
    const rooms = sortRooms(store.all('rooms'));
    const idx = indexDay(store.all(attendanceName(day))).students;
    const students = sortByName(store.all('students').filter((s) => s.status === 'active'));
    const roomOf = (s) => currentRoom(idx.get(s.id)) || idx.get(s.id)?.roomId || s.roomId;
    const inRoom = room === 'all' ? students : students.filter((s) => roomOf(s) === room);
    const counts = Object.fromEntries(STATUS_FILTERS.map((f) => [f.id, f.id === 'all' ? inRoom.length : inRoom.filter((s) => statusOf(idx.get(s.id)) === f.id).length]));
    const list = inRoom.filter((s) => (filter === 'all' || statusOf(idx.get(s.id)) === filter) && matches(personName(s), q));
    for (const id of [...selected]) if (!list.some((s) => s.id === id)) selected.delete(id);
    const loaded = store.isOpen(attendanceName(day));

    const bulk = selected.size
      ? h(
          'div.bulk-bar',
          { role: 'region', 'aria-label': 'Selected children' },
          h('strong', `${selected.size} selected`),
          h('button.btn.sm', { type: 'button', onClick: () => bulkCheckIn([...selected]) }, icon('log-in', 15), 'Check in'),
          h('button.btn.sm', { type: 'button', onClick: () => bulkCheckOut([...selected]) }, icon('log-out', 15), 'Check out'),
          h('button.btn.sm', { type: 'button', onClick: () => import('./log.js').then((m) => m.openLogActivity({ studentIds: [...selected], day })) }, icon('notebook-pen', 15), 'Log activity'),
          h('span.spacer'),
          h('button.btn.sm.ghost', { type: 'button', onClick: () => (selected.clear(), body.redraw()) }, 'Clear'),
        )
      : null;

    return [
      h(
        'div.toolbar',
        chips({
          label: 'Room',
          items: [{ id: 'all', label: 'All rooms' }, ...rooms.map((r) => ({ id: r.id, label: r.name }))],
          selected: room,
          onSelect: (id) => ((room = id), setQuery({ room: id === 'all' ? null : id }), body.redraw()),
        }),
      ),
      h(
        'div.toolbar',
        chips({ label: 'Status', items: STATUS_FILTERS.map((f) => ({ ...f, count: counts[f.id] })), selected: filter, onSelect: (id) => ((filter = id), setQuery({ filter: id === 'all' ? null : id }), body.redraw()) }),
        h('span.grow'),
        searchBox({ value: q, placeholder: 'Find a child', onInput: (v) => ((q = v), body.redraw()) }),
      ),
      bulk,
      !loaded
        ? h('div.skeleton-list', [1, 2, 3, 4].map(() => h('div.skeleton')))
        : list.length
          ? h(
              'ul.checkin-list',
              { 'aria-label': 'Children' },
              list.map((s) => childRow(s, idx.get(s.id), roomOf(s))),
            )
          : emptyState({ icon: 'users', title: inRoom.length ? 'Nobody matches' : 'No children enrolled', text: inRoom.length ? 'Try another filter.' : 'Add children to start checking them in.', compact: true, actions: inRoom.length ? null : [h('a.btn.primary', { href: '#/children/new' }, 'Add a child')] }),
    ];
  }

  function childRow(s, rec, roomId) {
    const state = statusOf(rec);
    const r = store.get('rooms', roomId);
    const cb = h('input', { type: 'checkbox', checked: selected.has(s.id), 'aria-label': `Select ${personName(s)}`, onChange: () => (cb.checked ? selected.add(s.id) : selected.delete(s.id), body.redraw()) });
    const times = [];
    if (firstIn(rec)) times.push(`In ${formatTime(firstIn(rec))}`);
    if (state === 'out' && lastOut(rec)) times.push(`Out ${formatTime(lastOut(rec))}`);
    if (state === 'absent' && rec.absent?.reason) times.push(rec.absent.reason);
    const actions = [];
    if (state === 'none' || state === 'absent') {
      actions.push(h('button.btn.checkin', { type: 'button', dataset: { key: `act-${s.id}` }, onClick: () => doCheckIn(s, roomId) }, icon('log-in', 16), 'Check in'));
      if (state === 'none') actions.push(h('button.btn.ghost.hide-mobile', { type: 'button', onClick: () => absentDialog(s, rec) }, 'Absent'));
    } else if (state === 'in') {
      actions.push(h('button.btn.checkout', { type: 'button', dataset: { key: `act-${s.id}` }, onClick: () => checkOutDialog(s, rec) }, icon('log-out', 16), 'Check out'));
    } else if (state === 'out') {
      actions.push(h('button.btn.ghost', { type: 'button', dataset: { key: `act-${s.id}` }, onClick: () => doCheckIn(s, roomId) }, 'Check in again'));
    }
    actions.push(
      h(
        'button.icon-btn',
        {
          type: 'button',
          'aria-label': `More for ${personName(s)}`,
          onClick: (e) =>
            openMenu(e.currentTarget, [
              state === 'none' || state === 'absent' ? { label: 'Check in with details', icon: 'log-in', run: () => checkInDialog(s, roomId) } : null,
              state === 'in' ? { label: 'Move to another room', icon: 'door-open', run: () => moveDialog(s, rec) } : null,
              state === 'none' ? { label: 'Mark absent', icon: 'calendar-x', run: () => absentDialog(s, rec) } : null,
              state === 'absent' ? { label: 'Clear absence', icon: 'undo', run: () => (clearAbsent(store, day, s.id), toast('Absence cleared')) } : null,
              rec?.events?.length ? { label: 'Edit times', icon: 'clock', run: () => editTimes(rec, personName(s)) } : null,
              { label: 'Log activity', icon: 'notebook-pen', run: () => import('./log.js').then((m) => m.openLogActivity({ studentIds: [s.id], day })) },
              { label: 'Open profile', icon: 'user', href: `#/children/${s.id}` },
            ]),
        },
        icon('more-vertical'),
      ),
    );
    return h(
      `li.checkin-row.state-${state}`,
      h('label.check-col', cb),
      h('a.person-link', { href: `#/children/${s.id}` }, childAvatar(s), h('span.person-text', h('span.person-name', personName(s), hasAllergy(s) ? h('span.allergy-flag', { title: `Allergies: ${s.allergies}` }, icon('warning', 13), h('span.sr-only', `Allergies: ${s.allergies}`)) : null), h('span.person-sub', r ? r.name : 'No room'))),
      h('div.checkin-state', attendancePill(state, state === 'in' ? r?.name : ''), times.length ? h('span.subtle.small', times.join(' · ')) : null),
      h('div.checkin-actions', actions),
    );
  }

  function doCheckIn(s, roomId) {
    const before = store.get(attendanceName(day), studentRecordId(s.id));
    const rec = checkIn(store, day, s.id, { roomId: roomId || s.roomId, at: day === app.today() ? nowHHMM() : '08:00', by: myName() });
    toast(`${personName(s)} checked in`, { action: { label: 'Undo', run: undoer(day, rec, before) } });
  }

  /**
   * Undo for a toast: removes the event the action added, from the day it
   * was added to, even after moving to another day or adding more events.
   * When nothing came after it, the record goes back to how it was before
   * (a check in clears an absence and sets the room).
   */
  function undoer(d, rec, before = null) {
    const added = rec.events[rec.events.length - 1];
    const prior = before && structuredClone(before);
    const same = (e) => e.type === added.type && e.at === added.at && e.roomId === added.roomId && e.person === added.person && e.by === added.by;
    return () => {
      const name = attendanceName(d);
      const cur = store.get(name, rec.id);
      const events = cur?.events || [];
      let i = events.length - 1;
      while (i >= 0 && !same(events[i])) i--;
      if (i < 0) return;
      if (!prior || i !== events.length - 1) return removeEvent(store, d, rec.id, i);
      const next = { ...structuredClone(cur), events: events.slice(0, i), absent: cur.absent || prior.absent || null, roomId: prior.roomId };
      if (!next.events.length && !next.absent) return store.remove(name, rec.id);
      store.put(name, next);
    };
  }

  function bulkCheckIn(ids) {
    const idx = indexDay(store.all(attendanceName(day))).students;
    let n = 0;
    for (const id of ids) {
      const s = store.get('students', id);
      const st = statusOf(idx.get(id));
      if (!s || st === 'in') continue;
      checkIn(store, day, id, { roomId: idx.get(id)?.roomId || s.roomId, at: day === app.today() ? nowHHMM() : '08:00', by: myName() });
      n++;
    }
    selected.clear();
    body.redraw();
    toast(n ? `${pluralize(n, 'child', 'children')} checked in` : 'Everyone selected is already here');
  }

  function bulkCheckOut(ids) {
    const idx = indexDay(store.all(attendanceName(day))).students;
    let n = 0;
    for (const id of ids) {
      if (statusOf(idx.get(id)) !== 'in') continue;
      checkOut(store, day, id, { at: day === app.today() ? nowHHMM() : '17:00', by: myName() });
      n++;
    }
    selected.clear();
    body.redraw();
    toast(n ? `${pluralize(n, 'child', 'children')} checked out` : 'Nobody selected is checked in');
  }

  function checkInDialog(s, roomId) {
    const rooms = sortRooms(store.all('rooms'));
    const roomSel = select({ options: rooms.map((r) => ({ value: r.id, label: r.name })), value: roomId || s.roomId });
    const time = textInput({ type: 'time', value: day === app.today() ? nowHHMM() : '08:00' });
    const people = pickupPeople(store.all('guardians'), s.id);
    const by = select({ options: [{ value: '', label: 'Not recorded' }, ...people.map((g) => ({ value: personName(g), label: `${personName(g)}${g.relation ? ` (${g.relation})` : ''}` }))], value: '' });
    const note = textarea({ rows: 2, placeholder: 'Anything the teachers should know today' });
    openDialog({
      title: `Check in ${personName(s)}`,
      size: 'narrow',
      body: h('div.stack', h('div.form-grid', field('Room', roomSel), field('Time', time)), field('Dropped off by', by), field('Note', note)),
      footer: ({ close }) => [
        h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
        h(
          'button.btn.primary',
          {
            type: 'button',
            onClick: () => {
              checkIn(store, day, s.id, { roomId: roomSel.value, at: time.value || nowHHMM(), by: myName(), person: by.value, note: note.value.trim() });
              toast(`${personName(s)} checked in`);
              close();
            },
          },
          'Check in',
        ),
      ],
    });
  }

  /** Check out, confirming who is picking up from the approved list. */
  function checkOutDialog(s, rec) {
    const people = pickupPeople(store.all('guardians'), s.id);
    let person = '';
    const time = textInput({ type: 'time', value: day === app.today() ? nowHHMM() : '17:00' });
    const other = textInput({ placeholder: 'Name of the person picking up' });
    const choose = (name) => ((person = name), (other.value = ''), draw());
    // The options are updated in place, so the chosen one keeps focus; arrow
    // keys move between them as in any radio group.
    const options = people.map((g) =>
      h(
        'button.pickup-option',
        { type: 'button', role: 'radio', dataset: { person: personName(g) }, onClick: () => choose(personName(g)) },
        h('span.avatar.sm', { style: { '--av': '#55606e' }, 'aria-hidden': 'true' }, (g.firstName || '?')[0]),
        h('span.grow', h('span.person-name', personName(g)), h('span.person-sub', g.relation || 'Approved pickup')),
        icon('circle', 18),
      ),
    );
    const list = h('div.pickup-list', { role: 'radiogroup', 'aria-label': 'Picked up by' }, options);
    const draw = () => {
      const current = options.find((b) => b.dataset.person === person) || options[0];
      for (const b of options) {
        const on = b.dataset.person === person;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = b === current ? 0 : -1;
        b.lastChild.replaceWith(icon(on ? 'circle-check' : 'circle', 18));
      }
    };
    list.addEventListener('keydown', (e) => {
      const i = options.indexOf(document.activeElement);
      const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
      if (i < 0 || !step) return;
      e.preventDefault();
      const next = options[(i + step + options.length) % options.length];
      next.focus();
      choose(next.dataset.person);
    });
    draw();
    other.addEventListener('input', () => {
      if (other.value.trim()) {
        person = '';
        draw();
      }
    });
    openDialog({
      title: `Check out ${personName(s)}`,
      size: 'narrow',
      initialFocus: people.length ? '.pickup-option' : null,
      body: h(
        'div.stack',
        people.length ? h('div.field', h('span.field-label', 'Picked up by'), list) : h('p.notice.warning', icon('warning', 16), h('span', 'No approved pickups on file for this child.')),
        field(people.length ? 'Someone else' : 'Picked up by', other, { hint: people.length ? 'Check their ID: they are not on the approved list.' : 'Add approved pickups on the child\'s Family tab.' }),
        field('Time', time),
      ),
      footer: ({ close }) => [
        h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
        h(
          'button.btn.primary',
          {
            type: 'button',
            onClick: () => {
              const who = person || other.value.trim();
              const rec = checkOut(store, day, s.id, { at: time.value || nowHHMM(), by: myName(), person: who, note: !person && who ? 'Not on the approved pickup list' : '' });
              toast(`${personName(s)} checked out`, { action: { label: 'Undo', run: undoer(day, rec) } });
              close();
            },
          },
          'Check out',
        ),
      ],
    });
  }

  function moveDialog(s) {
    const rooms = sortRooms(store.all('rooms'));
    openMenu(
      document.activeElement,
      rooms.map((r) => ({ label: `Move to ${r.name}`, icon: 'door-open', run: () => (moveRoom(store, day, s.id, r.id, { at: nowHHMM(), by: myName() }), toast(`${personName(s)} moved to ${r.name}`)) })),
      { label: 'Move to room' },
    );
  }

  function absentDialog(s) {
    const reason = select({ options: app.settings().absenceReasons, value: app.settings().absenceReasons[0] });
    const note = textInput({ placeholder: 'Optional' });
    openDialog({
      title: `Mark ${personName(s)} absent`,
      size: 'narrow',
      body: h('div.stack', field('Reason', reason), field('Note', note)),
      footer: ({ close }) => [
        h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
        h('button.btn.primary', { type: 'button', onClick: () => (markAbsent(store, day, s.id, { reason: reason.value, note: note.value.trim(), by: myName() }), toast(`${personName(s)} marked absent`), close()) }, 'Mark absent'),
      ],
    });
  }

  function editTimes(rec, name) {
    const draw = (wrap) =>
      wrap.replaceChildren(
        ...rec.events.map((e, i) => {
          const label = e.type === 'in' ? 'Check in' : e.type === 'out' ? 'Check out' : 'Moved';
          const t = textInput({ type: 'time', value: e.at, 'aria-label': `${label} time` });
          // Not redrawn: a time field fires change for each part typed, and a
          // redraw would take focus away before the minutes are in.
          t.addEventListener('change', () => {
            if (t.value) rec = updateEvent(store, day, rec.id, i, { at: t.value }) || rec;
          });
          return h(
            'div.event-row',
            h('span.event-type', label),
            t,
            h('span.subtle.small.grow', [e.roomId && store.get('rooms', e.roomId)?.name, e.person].filter(Boolean).join(' · ')),
            h(
              'button.icon-btn',
              {
                type: 'button',
                'aria-label': `Remove ${label.toLowerCase()}`,
                onClick: () => {
                  rec = removeEvent(store, day, rec.id, i);
                  if (!rec) return api.close();
                  draw(wrap);
                },
              },
              icon('trash', 16),
            ),
          );
        }),
      );
    const wrap = h('div.event-list');
    const api = openDialog({ title: `Times for ${name}`, size: 'narrow', body: wrap, footer: ({ close }) => h('button.btn.primary', { type: 'button', onClick: () => close() }, 'Done') });
    draw(wrap);
  }

  // ---- Staff ----
  // Clock in and Clock out swap in place and keep focus, so a second press
  // of a double click or double Enter would undo the first: ignore a toggle
  // of the same person right after the last one (as on the child page).
  const toggledAt = new Map();
  const toggle = (id, fn) => () => {
    if (Date.now() - (toggledAt.get(id) || 0) < 700) return;
    toggledAt.set(id, Date.now());
    fn();
  };
  const clock = (m, d, rec, done) => toast(`${personName(m)} ${done}`, { action: { label: 'Undo', run: undoer(d, rec) } });

  function staffBoard(day) {
    const idx = indexDay(store.all(attendanceName(day))).staff;
    const members = sortByName(store.all('staff').filter((m) => m.active !== false));
    const rooms = sortRooms(store.all('rooms'));
    const now = day === app.today() ? nowHHMM() : null;
    if (!members.length) return emptyState({ icon: 'id-card', title: 'No staff yet', text: 'Add staff to track who is on site and keep ratios.', actions: isManager() ? [h('a.btn.primary', { href: '#/staff' }, 'Add staff')] : null });
    return h(
      'ul.checkin-list',
      { 'aria-label': 'Staff' },
      members.map((m) => {
        const rec = idx.get(m.id);
        const state = statusOf(rec);
        const roomId = currentRoom(rec);
        const mins = minutesPresent(rec, now);
        return h(
          `li.checkin-row.state-${state}`,
          h('a.person-link', { href: `#/staff/${m.id}` }, staffAvatar(m), h('span.person-text', h('span.person-name', personName(m)), h('span.person-sub', m.title || ''))),
          h('div.checkin-state', state === 'in' ? pill(roomId ? `In ${store.get('rooms', roomId)?.name || ''}` : 'Clocked in', 'success') : state === 'out' ? pill('Clocked out', 'neutral') : pill('Not in', 'plain'), mins ? h('span.subtle.small', `${formatHours(mins)} today`) : null),
          h(
            'div.checkin-actions',
            state === 'in'
              ? [
                  h(
                    'button.btn.ghost',
                    {
                      type: 'button',
                      onClick: (e) => openMenu(e.currentTarget, rooms.map((r) => ({ label: r.name, icon: 'door-open', checked: r.id === roomId, run: () => staffMoveRoom(store, day, m.id, r.id, { at: nowHHMM(), by: myName() }) })), { label: 'Assign room' }),
                    },
                    icon('door-open', 16),
                    h('span.hide-mobile', 'Room'),
                  ),
                  h('button.btn.checkout', { type: 'button', dataset: { key: `clock-${m.id}` }, onClick: toggle(m.id, () => clock(m, day, staffClockOut(store, day, m.id, { at: now || '17:00', by: myName() }), 'clocked out')) }, icon('log-out', 16), 'Clock out'),
                ]
              : h(
                  'button.btn.checkin',
                  {
                    type: 'button',
                    dataset: { key: `clock-${m.id}` },
                    onClick: (e) =>
                      openMenu(e.currentTarget, rooms.map((r) => ({ label: `Clock in to ${r.name}`, icon: 'door-open', run: toggle(m.id, () => clock(m, day, staffClockIn(store, day, m.id, { roomId: r.id, at: now || '08:00', by: myName() }), 'clocked in')) })), { label: 'Clock in to room' }),
                  },
                  icon('log-in', 16),
                  'Clock in',
                ),
            rec?.events?.length ? h('button.icon-btn', { type: 'button', 'aria-label': `Edit times for ${personName(m)}`, onClick: () => editTimes(store.get(attendanceName(day), staffRecordId(m.id)), personName(m)) }, icon('clock')) : null,
          ),
        );
      }),
    );
  }

  const page = h('div.page', header, body);
  page.addEventListener(
    'click',
    (e) => {
      if (!rollover()) return;
      e.preventDefault();
      e.stopPropagation();
      toast('It is a new day, so the board now shows today.', { type: 'info' });
    },
    true,
  );
  return page;
}


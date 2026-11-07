/**
 * Activities: a classroom's day. Pick children (or a whole room), tap a
 * type to log for all of them, and read the day's feed. Naps in progress
 * can be ended with one tap.
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { pageHeader, chips, emptyState } from '../ui/components.js';
import { setQuery } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { app } from '../app.js';
import { firstName, pluralize } from '../core/format.js';
import { ACTIVITY_TYPES, activityName, sortActivities, openNaps, updateActivity } from '../core/activities.js';
import { attendanceName, indexDay, statusOf, currentRoom, nowHHMM } from '../core/attendance.js';
import { sortByName, sortRooms } from '../core/people.js';
import { formatTime } from '../core/dates.js';
import { childAvatar, typeTile, activityCard, dayNav, remember } from './common.js';
import { openLogActivity } from './log.js';

export function render(ctx) {
  const store = app.store;
  let day = ctx.query.date || app.today();
  let room = ctx.query.room || remember('activityRoom') || 'all';
  let type = 'all';
  let onlyIn = true;
  const selected = new Set();
  const open = () => store.open([attendanceName(day), activityName(day)]);
  open();

  // A screen left open overnight follows the date, so the morning's entries
  // are not logged on yesterday (see the check-in board).
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
        title: 'Activities',
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
        actions: [h('button.btn.primary', { type: 'button', onClick: () => openLogActivity({ studentIds: [...selected], day }) }, icon('plus', 17), 'Log activity')],
      }),
    );
  drawHeader();

  const body = ctx.live(() => {
    const rooms = sortRooms(store.all('rooms'));
    if (room !== 'all' && !rooms.some((r) => r.id === room)) room = 'all';
    const idx = indexDay(store.all(attendanceName(day))).students;
    const roomOf = (s) => currentRoom(idx.get(s.id)) || idx.get(s.id)?.roomId || s.roomId;
    const kids = sortByName(store.all('students').filter((s) => s.status === 'active' && (room === 'all' || roomOf(s) === room)));
    const shown = onlyIn ? kids.filter((s) => statusOf(idx.get(s.id)) === 'in' || (statusOf(idx.get(s.id)) === 'out' && day !== app.today())) : kids;
    const ids = new Set(kids.map((k) => k.id));
    const all = store.all(activityName(day)).filter((a) => ids.has(a.studentId));
    const perKid = new Map();
    for (const a of all) perKid.set(a.studentId, (perKid.get(a.studentId) || 0) + 1);
    for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);
    const naps = openNaps(all);

    const quickBar = h(
      'div.quick-log',
      { role: 'group', 'aria-label': 'Log for selected children' },
      ACTIVITY_TYPES.map((t) =>
        h(
          'button.quick-type',
          {
            type: 'button',
            title: `Log ${t.label.toLowerCase()}`,
            onClick: () => openLogActivity({ type: t.id, studentIds: [...selected], roomId: room === 'all' ? null : room, day }),
          },
          typeTile(t.id, 'md'),
          h('span', t.short || t.label),
        ),
      ),
    );

    const kidGrid = h(
      'div.kid-grid',
      shown.map((s) => {
        const on = selected.has(s.id);
        const cb = h('input.sr-only', { type: 'checkbox', checked: on, dataset: { key: `kid-${s.id}` }, onChange: () => (cb.checked ? selected.add(s.id) : selected.delete(s.id), body.redraw()) });
        const sleeping = naps.some((n) => n.studentId === s.id);
        return h(
          `label.kid-tile${on ? '.on' : ''}${statusOf(idx.get(s.id)) !== 'in' && day === app.today() ? '.away' : ''}`,
          cb,
          h('span.kid-av', childAvatar(s, { size: 'lg' }), sleeping ? h('span.kid-badge.sleep', { title: 'Napping' }, icon('moon', 11)) : null),
          h('span.kid-name', firstName(s)),
          h('span.kid-count', perKid.get(s.id) ? pluralize(perKid.get(s.id), 'entry', 'entries') : 'No entries'),
          h('span.pick-check', icon('check', 14)),
        );
      }),
    );

    const typeCounts = new Map();
    for (const a of all) typeCounts.set(a.type, (typeCounts.get(a.type) || 0) + 1);
    const feedList = sortActivities(type === 'all' ? all : all.filter((a) => a.type === type));
    // Show a group entry (one photo of five children) once.
    const seen = new Set();
    const grouped = [];
    for (const a of feedList) {
      if (a.groupId) {
        if (seen.has(a.groupId)) continue;
        seen.add(a.groupId);
        grouped.push({ a, n: feedList.filter((x) => x.groupId === a.groupId).length });
      } else grouped.push({ a, n: 1 });
    }

    return [
      h(
        'div.toolbar',
        chips({
          label: 'Room',
          items: [{ id: 'all', label: 'All rooms' }, ...rooms.map((r) => ({ id: r.id, label: r.name }))],
          selected: room,
          onSelect: (id) => {
            room = id;
            remember('activityRoom', id);
            selected.clear();
            setQuery({ room: id === 'all' ? null : id });
            body.redraw();
          },
        }),
      ),
      h(
        'div.activity-layout',
        h(
          'section.card.kid-panel',
          { 'aria-label': 'Children' },
          h(
            'div.card-head',
            h('h2.grow', 'Children', h('span.count', ` ${shown.length}`)),
            h('label.check.inline.small', h('input', { type: 'checkbox', checked: onlyIn, dataset: { key: 'only-in' }, onChange: (e) => ((onlyIn = e.target.checked), body.redraw()) }), h('span', 'Here only')),
          ),
          h(
            'div.card-body',
            h(
              'div.kid-panel-bar',
              h('span.subtle.small', selected.size ? `${selected.size} selected` : 'Select children, then choose what to log'),
              h('span.spacer'),
              shown.length
                ? h(
                    'button.link-btn',
                    {
                      type: 'button',
                      dataset: { key: 'select-all' },
                      onClick: () => {
                        const allOn = shown.every((s) => selected.has(s.id));
                        for (const s of shown) allOn ? selected.delete(s.id) : selected.add(s.id);
                        body.redraw();
                      },
                    },
                    shown.every((s) => selected.has(s.id)) ? 'Clear' : 'Select all',
                  )
                : null,
            ),
            quickBar,
            shown.length ? kidGrid : h('p.subtle.pick-empty', onlyIn ? 'Nobody is checked in here yet.' : 'No children in this room.'),
          ),
        ),
        h(
          'section.activity-feed',
          { 'aria-label': 'Feed' },
          naps.length
            ? h(
                'div.nap-bar',
                icon('moon', 16),
                h('span.grow', `${pluralize(naps.length, 'child', 'children')} napping: `, naps.map((n) => firstName(store.get('students', n.studentId))).join(', ')),
                h(
                  'button.btn.sm',
                  {
                    type: 'button',
                    onClick: () => {
                      const at = day === app.today() ? nowHHMM() : '15:00';
                      // A nap that started later (a typed start, or a past day) ends at its start.
                      for (const n of naps) updateActivity(store, n, { details: { end: n.details.start > at ? n.details.start : at } });
                      toast(`Ended ${pluralize(naps.length, 'nap')} at ${formatTime(at)}`);
                    },
                  },
                  'Everyone is up',
                ),
              )
            : null,
          h(
            'div.feed-filter',
            chips({
              label: 'Type',
              items: [{ id: 'all', label: 'All', count: all.length }, ...ACTIVITY_TYPES.filter((t) => typeCounts.has(t.id)).map((t) => ({ id: t.id, label: t.short || t.label, count: typeCounts.get(t.id) }))],
              selected: type,
              onSelect: (id) => ((type = id), body.redraw()),
            }),
          ),
          !store.isOpen(activityName(day))
            ? h('div.skeleton-feed', h('div.skeleton'), h('div.skeleton'))
            : grouped.length
              ? h(
                  'div.feed',
                  grouped.slice(0, 150).map(({ a, n }) => activityCard(a, { groupCount: n, onEdit: (rec) => openLogActivity({ edit: rec }) })),
                  grouped.length > 150 ? h('p.subtle.center', `Showing the latest 150 of ${grouped.length}. Pick a room or type to narrow it down.`) : null,
                )
              : emptyState({ icon: 'notebook-pen', title: 'Nothing logged', text: day === app.today() ? 'Select children on the left and tap what to log.' : 'Nothing was logged for these children on this day.', compact: true }),
        ),
      ),
    ];
  }, ['attendance', 'activities', 'students', 'rooms']);

  const page = h('div.page.wide-page', header, body);
  page.addEventListener(
    'click',
    (e) => {
      if (!rollover()) return;
      e.preventDefault();
      e.stopPropagation();
      toast('It is a new day, so this page now shows today.', { type: 'info' });
    },
    true,
  );
  return page;
}


/** One room: its children and their status today, assigned staff, and the day's feed. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { pageHeader, tabs, emptyState, pill } from '../ui/components.js';
import { setQuery } from '../ui/router.js';
import { app, isManager } from '../app.js';
import { personName } from '../core/format.js';
import { sortByName } from '../core/people.js';
import { attendanceName, indexDay, statusOf, currentRoom, firstIn, roomRatios } from '../core/attendance.js';
import { activityName, sortActivities } from '../core/activities.js';
import { formatTime, ageLabel } from '../core/dates.js';
import { childLink, staffAvatar, attendancePill, activityCard } from './common.js';
import { openLogActivity } from './log.js';
import { openRoomForm } from './rooms.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  const day = app.today();
  let tab = ctx.query.tab || 'children';
  store.open([attendanceName(day), activityName(day)]);

  const body = ctx.live(() => {
    const room = store.get('rooms', id);
    if (!room) return emptyState({ icon: 'search', title: 'Room not found', headingLevel: 1, actions: [h('a.btn', { href: '#/rooms' }, 'All rooms')] });
    const att = store.all(attendanceName(day));
    const idx = indexDay(att);
    const enrolled = sortByName(store.all('students').filter((s) => s.status === 'active' && s.roomId === id));
    const visiting = store.all('students').filter((s) => s.roomId !== id && currentRoom(idx.students.get(s.id)) === id);
    const ratio = roomRatios([room], att).rows[0];
    const staff = sortByName(store.all('staff').filter((m) => m.active !== false && ((m.roomIds || []).includes(id) || currentRoom(idx.staff.get(m.id)) === id)));
    const ids = new Set([...enrolled, ...visiting].map((s) => s.id));
    const feed = sortActivities(store.all(activityName(day)).filter((a) => ids.has(a.studentId)));

    const panel =
      tab === 'staff'
        ? staff.length
          ? h('ul.checkin-list', staff.map((m) => h('li.checkin-row', h('a.person-link', { href: `#/staff/${m.id}` }, staffAvatar(m), h('span.person-text', h('span.person-name', personName(m)), h('span.person-sub', m.title || ''))), h('div.checkin-state', currentRoom(idx.staff.get(m.id)) === id ? pill('In this room', 'success') : statusOf(idx.staff.get(m.id)) === 'in' ? pill(`In ${store.get('rooms', currentRoom(idx.staff.get(m.id)))?.name || 'another room'}`, 'info') : pill('Not in', 'plain')), h('div'))))
          : emptyState({ icon: 'id-card', title: 'No staff assigned', text: 'Assign staff to this room from their profile.', compact: true })
        : tab === 'feed'
          ? feed.length
            ? h('div.feed', feed.slice(0, 100).map((a) => activityCard(a, { onEdit: (rec) => openLogActivity({ edit: rec }) })))
            : emptyState({ icon: 'notebook-pen', title: 'Nothing logged today', compact: true })
          : enrolled.length || visiting.length
            ? h(
                'ul.checkin-list',
                [...enrolled, ...visiting].map((s) => {
                  const rec = idx.students.get(s.id);
                  return h('li.checkin-row', childLink(s, { sub: false }), h('div.checkin-state', attendancePill(statusOf(rec), ''), firstIn(rec) ? h('span.subtle.small', `In ${formatTime(firstIn(rec))}`) : null), h('div.subtle.small', visiting.includes(s) ? 'Visiting' : ageLabel(s.birthday)));
                }),
              )
            : emptyState({ icon: 'baby', title: 'No children in this room', compact: true, actions: [h('a.btn.primary', { href: `#/children/new?room=${id}` }, 'Add a child')] });

    return [
      pageHeader({
        title: room.name,
        crumbs: [{ label: 'Rooms', href: '#/rooms' }],
        subtitle: h('span.row', { style: { gap: '10px', flexWrap: 'wrap' } }, room.ageRange || null, `${ratio.students} here`, `${ratio.staff} staff`, room.ratio ? `1:${room.ratio} required` : null, ratio.ok ? pill('In ratio', 'success') : pill('Out of ratio', 'danger')),
        actions: [isManager() ? h('button.btn', { type: 'button', onClick: () => openRoomForm(room) }, icon('settings', 16), 'Room settings') : null, h('a.btn', { href: `#/attendance?room=${id}` }, icon('user-check', 16), 'Check in'), h('button.btn.primary', { type: 'button', onClick: () => openLogActivity({ roomId: id }) }, icon('plus', 16), 'Log activity')],
      }),
      tabs({ label: 'Room', items: [{ id: 'children', label: 'Children', count: enrolled.length }, { id: 'staff', label: 'Staff', count: staff.length }, { id: 'feed', label: 'Today', count: feed.length }], selected: tab, onSelect: (t) => ((tab = t), setQuery({ tab: t === 'children' ? null : t }), body.redraw()) }),
      h('div.tab-panel', panel),
    ];
  }, ['rooms', 'students', 'staff', 'attendance', 'activities']);
  return h('div.page', body);
}

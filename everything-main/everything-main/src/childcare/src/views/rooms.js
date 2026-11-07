/** Rooms: classrooms with capacity, required ratio, and who is in each one right now. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { pageHeader, emptyState, field, textInput, pill } from '../ui/components.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { navigate } from '../ui/router.js';
import { app, isManager } from '../app.js';
import { pluralize } from '../core/format.js';
import { ROOM_COLORS, sortRooms } from '../core/people.js';
import { attendanceName, roomRatios } from '../core/attendance.js';

export function render(ctx) {
  const store = app.store;
  const day = app.today();
  store.open([attendanceName(day)]);
  const body = ctx.live(() => {
    const rooms = sortRooms(store.all('rooms'));
    if (!rooms.length) return emptyState({ icon: 'door-open', title: 'Add your first room', text: 'Rooms are your classrooms. Set a capacity and the staff ratio your license requires, and the app watches ratios for you.', actions: [h('button.btn.primary', { type: 'button', onClick: () => openRoomForm() }, 'Add a room')] });
    const ratios = roomRatios(rooms, store.all(attendanceName(day)));
    const enrolled = store.all('students').filter((s) => s.status === 'active');
    return h(
      'div.room-grid',
      ratios.rows.map((r) => {
        const count = enrolled.filter((s) => s.roomId === r.room.id).length;
        const full = r.room.capacity && count >= r.room.capacity;
        return h(
          'a.room-card',
          { href: `#/rooms/${r.room.id}`, style: { '--room': r.room.color || '#55606e' } },
          h('div.room-card-head', h('h2', r.room.name), r.room.ageRange ? h('span.subtle.small', r.room.ageRange) : null),
          h(
            'dl.room-facts',
            h('div', h('dt', 'Enrolled'), h('dd', String(count), r.room.capacity ? h('span.subtle', ` / ${r.room.capacity}`) : null)),
            h('div', h('dt', 'Here now'), h('dd', String(r.students))),
            h('div', h('dt', 'Staff'), h('dd', String(r.staff))),
            h('div', h('dt', 'Ratio'), h('dd', r.room.ratio ? `1:${r.room.ratio}` : '-')),
          ),
          h('div.room-card-foot', r.ok ? pill(r.students ? 'In ratio' : 'Empty', r.students ? 'success' : 'plain') : pill(r.staff ? `Needs ${r.needed - r.staff} more staff` : 'No staff', 'danger'), full ? pill('Full', 'warning') : r.room.capacity ? h('span.subtle.small', `${pluralize(r.room.capacity - count, 'open spot')}`) : null),
        );
      }),
    );
  }, ['rooms', 'students', 'attendance']);
  return h('div.page', pageHeader({ title: 'Rooms', actions: isManager() ? [h('button.btn.primary', { type: 'button', onClick: () => openRoomForm() }, icon('plus', 16), 'Add room')] : null }), body);
}

export function openRoomForm(room = null) {
  const store = app.store;
  const r = structuredClone(room || { name: '', ageRange: '', capacity: '', ratio: '', color: ROOM_COLORS[store.all('rooms').length % ROOM_COLORS.length], order: store.all('rooms').length });
  const inp = (k, opts = {}) => {
    const i = textInput({ value: r[k] ?? '', ...opts });
    i.addEventListener('input', () => (r[k] = i.value));
    return i;
  };
  const name = inp('name', { required: true, placeholder: 'Toddlers' });
  const colors = h(
    'div.color-pick',
    { role: 'radiogroup', 'aria-label': 'Color' },
    ROOM_COLORS.map((c) => {
      const b = h('button.color-swatch', { type: 'button', role: 'radio', 'aria-checked': String(r.color === c), 'aria-label': c, style: { '--c': c } });
      b.addEventListener('click', () => {
        r.color = c;
        for (const x of colors.children) x.setAttribute('aria-checked', String(x === b));
      });
      return b;
    }),
  );
  openDialog({
    title: room ? `Edit ${room.name}` : 'Add a room',
    body: h(
      'div.stack',
      h('div.form-grid', field('Name', name, { required: true }), field('Ages', inp('ageRange', { placeholder: '1 to 2 years' })), field('Capacity', inp('capacity', { type: 'number', min: '0', inputmode: 'numeric' }), { hint: 'Most children enrolled at once' }), field('Children per staff member', inp('ratio', { type: 'number', min: '0', inputmode: 'numeric', placeholder: '6' }), { hint: 'From your license, for example 6 for 1:6' })),
      h('div.field', h('span.field-label', 'Color'), colors),
    ),
    footer: ({ close }) => [
      room
        ? h(
            'button.btn.ghost.danger-text',
            {
              type: 'button',
              onClick: async () => {
                const kids = store.all('students').filter((s) => s.roomId === room.id && s.status === 'active').length;
                if (!(await confirmDialog({ title: `Delete ${room.name}?`, message: kids ? `${pluralize(kids, 'child is', 'children are')} in this room and will have no room until you move them.` : 'This room is removed.', confirmLabel: 'Delete room', danger: true }))) return;
                store.remove('rooms', room.id);
                close();
                navigate('/rooms');
              },
            },
            icon('trash', 16),
            'Delete',
          )
        : null,
      h('span.spacer'),
      h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
      h(
        'button.btn.primary',
        {
          type: 'button',
          onClick: () => {
            if (!String(r.name).trim()) return name.focus();
            // Whole, non-negative numbers: a ratio of -2 read as "Needs -3 more staff".
            const count = (v) => Math.max(0, Math.round(Number(v) || 0));
            store.put('rooms', { ...r, name: r.name.trim(), capacity: count(r.capacity), ratio: count(r.ratio) });
            toast(room ? 'Room saved' : `${r.name.trim()} added`);
            close();
          },
        },
        room ? 'Save' : 'Add room',
      ),
    ],
  });
}

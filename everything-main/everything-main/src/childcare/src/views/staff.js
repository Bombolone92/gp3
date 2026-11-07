/** Staff: who works here, where, whether they are in today, and expiring certifications. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { pageHeader, chips, searchBox, dataTable, emptyState, field, textInput, textarea, pill } from '../ui/components.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { navigate } from '../ui/router.js';
import { app, isManager } from '../app.js';
import { personName, matches, telHref, TEAM_COLORS } from '../core/format.js';
import { sortRooms, newPin } from '../core/people.js';
import { attendanceName, indexDay, statusOf, currentRoom } from '../core/attendance.js';
import { diffDays } from '../core/dates.js';
import { staffAvatar, roomDot, rememberSort, saveSort } from './common.js';
import { inviteStaff } from './invite.js';

export function render(ctx) {
  const store = app.store;
  const day = app.today();
  let filter = 'active';
  let q = '';
  let sort = rememberSort('staff', { id: 'name', dir: 'asc' });
  store.open([attendanceName(day)]);

  const body = ctx.live(() => {
    const all = store.all('staff');
    if (!all.length) return emptyState({ icon: 'id-card', title: 'Add your team', text: 'Add teachers and assistants to track who is on site, keep ratios, and invite them to the app.', actions: isManager() ? [h('button.btn.primary', { type: 'button', onClick: () => openStaffForm() }, 'Add staff')] : null });
    const idx = indexDay(store.all(attendanceName(day))).staff;
    const rows = all.filter((m) => (filter === 'active' ? m.active !== false : m.active === false) && matches(`${personName(m)} ${m.title || ''}`, q));
    const certState = (m) => {
      const soon = (m.certifications || []).filter((c) => c.expires).map((c) => diffDays(day, c.expires));
      const min = soon.length ? Math.min(...soon) : null;
      return min === null ? null : min < 0 ? pill('Certification expired', 'danger') : min <= 30 ? pill(`Expires in ${min} days`, 'warning') : pill('Current', 'success');
    };
    return [
      h('div.toolbar', chips({ label: 'Show', items: [{ id: 'active', label: 'Current', count: all.filter((m) => m.active !== false).length }, { id: 'former', label: 'Former', count: all.filter((m) => m.active === false).length }], selected: filter, onSelect: (v) => ((filter = v), body.redraw()) }), h('span.grow'), searchBox({ value: q, placeholder: 'Search staff', onInput: (v) => ((q = v), body.redraw()) })),
      dataTable({
        columns: [
          { id: 'name', label: 'Name', render: (m) => h('a.person-link', { href: `#/staff/${m.id}` }, staffAvatar(m, { size: 'sm' }), h('span.person-text', h('span.person-name', personName(m)), h('span.person-sub', m.title || ''))), sort: (m) => personName(m).toLowerCase() },
          { id: 'rooms', label: 'Rooms', render: (m) => ((m.roomIds || []).length ? h('span.kid-links', m.roomIds.map((r) => roomDot(store.get('rooms', r)))) : h('span.subtle', 'Floater')) },
          { id: 'today', label: 'Today', render: (m) => (statusOf(idx.get(m.id)) === 'in' ? pill(`In ${store.get('rooms', currentRoom(idx.get(m.id)))?.name || ''}`, 'success') : statusOf(idx.get(m.id)) === 'out' ? pill('Clocked out', 'neutral') : pill('Not in', 'plain')), sort: (m) => statusOf(idx.get(m.id)) },
          { id: 'certs', label: 'Certifications', render: (m) => certState(m) || h('span.subtle', 'None on file') },
          { id: 'phone', label: 'Phone', render: (m) => (m.phone ? h('a', { href: telHref(m.phone) }, m.phone) : h('span.subtle', '-')) },
          { id: 'app', label: 'App access', render: (m) => (m.memberUuid ? pill('Signed up', 'success') : isManager() ? h('button.btn.sm', { type: 'button', onClick: () => inviteStaff(m) }, icon('send', 14), 'Invite') : pill('Not invited', 'plain')) },
        ],
        rows,
        sort,
        onSort: (s) => ((sort = s), saveSort('staff', s), body.redraw()),
        rowHref: (m) => `#/staff/${m.id}`,
        caption: 'Staff',
        mobile: (m) => h('a.list-item', { href: `#/staff/${m.id}` }, staffAvatar(m), h('span.grow', h('span.title', personName(m)), h('span.meta', m.title || '')), statusOf(idx.get(m.id)) === 'in' ? pill('In', 'success') : null),
        empty: emptyState({ icon: 'search', title: 'Nobody matches', compact: true }),
      }),
    ];
  }, ['staff', 'rooms', 'attendance']);

  return h('div.page', pageHeader({ title: 'Staff', actions: isManager() ? [h('button.btn.primary', { type: 'button', onClick: () => openStaffForm() }, icon('plus', 16), 'Add staff')] : null }), body);
}

/** Add or edit a staff member. */
export function openStaffForm(member = null) {
  const store = app.store;
  const m = structuredClone(member || { firstName: '', lastName: '', title: 'Teacher', email: '', phone: '', roomIds: [], hireDate: app.today(), certifications: [], color: TEAM_COLORS[store.all('staff').length % TEAM_COLORS.length], active: true });
  if (!m.pin) m.pin = newPin([...store.all('staff'), ...store.all('guardians')].map((x) => x.pin));
  const inp = (k, opts = {}) => {
    const i = textInput({ value: m[k] || '', ...opts });
    i.addEventListener('input', () => (m[k] = i.value));
    return i;
  };
  const rooms = new Set(m.roomIds || []);
  const first = inp('firstName', { required: true });
  const roomList = h(
    'div.check-grid',
    sortRooms(store.all('rooms')).map((r) => {
      const c = h('input', { type: 'checkbox', checked: rooms.has(r.id), onChange: () => (c.checked ? rooms.add(r.id) : rooms.delete(r.id)) });
      return h('label.check', c, roomDot(r));
    }),
  );
  openDialog({
    title: member ? `Edit ${personName(member)}` : 'Add staff',
    size: 'wide',
    body: h(
      'div.stack',
      h('div.form-grid', field('First name', first, { required: true }), field('Last name', inp('lastName')), field('Title', inp('title', { placeholder: 'Lead teacher' })), field('Hire date', inp('hireDate', { type: 'date' })), field('Phone', inp('phone', { type: 'tel' })), field('Email', inp('email', { type: 'email' }))),
      h('div.field', h('span.field-label', 'Rooms'), roomList, h('span.hint', 'Leave all unchecked for a floater.')),
      field('Notes', (() => {
        const t = textarea({ value: m.notes || '', rows: 2 });
        t.addEventListener('input', () => (m.notes = t.value));
        return t;
      })()),
    ),
    footer: ({ close }) => [
      member && member.active !== false ? h('button.btn.ghost', { type: 'button', onClick: async () => { if (await confirmDialog({ title: `Mark ${personName(member)} as former staff?`, message: 'They no longer appear in check-in and ratios. Their timecards stay in reports.', confirmLabel: 'Mark as former' })) { store.patch('staff', member.id, { active: false }); close(); } } }, icon('archive', 16), 'Former staff') : null,
      member && member.active === false ? h('button.btn.ghost', { type: 'button', onClick: () => (store.patch('staff', member.id, { active: true }), close()) }, 'Restore') : null,
      h('span.spacer'),
      h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
      h(
        'button.btn.primary',
        {
          type: 'button',
          onClick: () => {
            if (!m.firstName.trim()) return first.focus();
            const saved = store.put('staff', { ...m, firstName: m.firstName.trim(), lastName: (m.lastName || '').trim(), roomIds: [...rooms] });
            toast(member ? 'Changes saved' : `${personName(saved)} added`);
            close();
            if (!member) navigate(`/staff/${saved.id}`);
          },
        },
        member ? 'Save' : 'Add staff',
      ),
    ],
  });
}


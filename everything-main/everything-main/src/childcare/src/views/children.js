/** Children: the roster, with enrollment status, rooms, today's attendance, and CSV import and export. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { pageHeader, chips, searchBox, dataTable, emptyState, select, pill, moreButton } from '../ui/components.js';
import { openMenu } from '../ui/menu.js';
import { confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { setQuery } from '../ui/router.js';
import { app } from '../app.js';
import { personName, matches, pluralize } from '../core/format.js';
import { statusMeta, guardiansOf, sortRooms, hasAllergy } from '../core/people.js';
import { attendanceName, indexDay, statusOf } from '../core/attendance.js';
import { ageLabel, formatDate, ageInMonths } from '../core/dates.js';
import { exportRosterCSV, importRosterCSV } from '../core/roster.js';
import { downloadText } from '../core/csv.js';
import { childLink, childAvatar, attendancePill, roomDot, rememberSort, saveSort } from './common.js';

const FILTERS = [
  { id: 'active', label: 'Enrolled', match: (s) => s.status === 'active' },
  { id: 'waitlist', label: 'Waitlist', match: (s) => s.status === 'waitlist' },
  { id: 'inquiry', label: 'Inquiries', match: (s) => s.status === 'inquiry' },
  { id: 'former', label: 'Former', match: (s) => s.status === 'inactive' || s.status === 'graduated' },
  { id: 'all', label: 'All', match: () => true },
];

export function render(ctx) {
  const store = app.store;
  let filter = FILTERS.some((f) => f.id === ctx.query.status) ? ctx.query.status : 'active';
  let room = ctx.query.room || 'all';
  let q = ctx.query.q || '';
  let sort = rememberSort('children', { id: 'name', dir: 'asc' });
  const day = app.today();
  store.open([attendanceName(day)]);

  const header = pageHeader({
    title: 'Children',
    actions: [
      moreButton((btn) =>
        openMenu(btn, [
          { label: 'Export roster (CSV)', icon: 'download', run: exportRoster },
          { label: 'Import roster (CSV)', icon: 'upload', run: importRoster },
          { label: 'Print emergency cards', icon: 'printer', href: '#/reports?r=emergency' },
        ]),
      ),
      h('a.btn.primary', { href: '#/children/new' }, icon('plus', 16), 'Add child'),
    ],
  });

  const body = ctx.live(() => {
    const all = store.all('students');
    const rooms = sortRooms(store.all('rooms'));
    const idx = indexDay(store.all(attendanceName(day))).students;
    const guardians = store.all('guardians');
    const counts = Object.fromEntries(FILTERS.map((f) => [f.id, all.filter(f.match).length]));
    const f = FILTERS.find((x) => x.id === filter);
    const rows = all.filter((s) => f.match(s) && (room === 'all' || s.roomId === room) && matches(`${personName(s, { preferred: false })} ${s.preferredName || ''}`, q));
    const pipeline = filter === 'waitlist' || filter === 'inquiry';

    if (!all.length)
      return emptyState({
        icon: 'baby',
        title: 'Add your first child',
        text: 'Add children one at a time, or import your roster from a spreadsheet.',
        actions: [h('a.btn.primary', { href: '#/children/new' }, 'Add a child'), h('button.btn', { type: 'button', onClick: importRoster }, icon('upload', 16), 'Import CSV')],
      });

    const columns = [
      { id: 'name', label: 'Child', render: (s) => childLink(s, { sub: false }), sort: (s) => personName(s).toLowerCase() },
      { id: 'room', label: 'Room', render: (s) => roomDot(store.get('rooms', s.roomId)) || h('span.subtle', 'None'), sort: (s) => store.get('rooms', s.roomId)?.name || '' },
      { id: 'age', label: 'Age', render: (s) => ageLabel(s.birthday, day) || h('span.subtle', '-'), sort: (s) => ageInMonths(s.birthday, day) ?? -1 },
      pipeline
        ? { id: 'start', label: 'Wants to start', render: (s) => (s.inquiry?.desiredStart ? formatDate(s.inquiry.desiredStart) : h('span.subtle', '-')), sort: (s) => s.inquiry?.desiredStart || '' }
        : { id: 'today', label: 'Today', render: (s) => (s.status === 'active' ? attendancePill(statusOf(idx.get(s.id))) : pill(statusMeta(s.status).label, statusMeta(s.status).tone)), sort: (s) => ['in', 'out', 'absent', 'none'].indexOf(statusOf(idx.get(s.id))) },
      pipeline
        ? { id: 'contact', label: 'First contact', render: (s) => (s.inquiry?.firstContact ? formatDate(s.inquiry.firstContact) : h('span.subtle', '-')), sort: (s) => s.inquiry?.firstContact || '' }
        : { id: 'allergies', label: 'Allergies', render: (s) => (hasAllergy(s) ? h('span.allergy-text', icon('warning', 14), s.allergies) : h('span.subtle', 'None')), sort: (s) => s.allergies || '' },
      { id: 'family', label: 'Family', render: (s) => familyCell(guardiansOf(guardians, s.id)), sort: (s) => personName(guardiansOf(guardians, s.id)[0]) },
    ];

    return [
      h(
        'div.toolbar',
        chips({ label: 'Status', items: FILTERS.map((x) => ({ id: x.id, label: x.label, count: counts[x.id] })), selected: filter, onSelect: (id) => ((filter = id), setQuery({ status: id === 'active' ? null : id }), body.redraw()) }),
        h('span.grow'),
        (() => {
          const s = select({ options: [{ value: 'all', label: 'All rooms' }, ...rooms.map((r) => ({ value: r.id, label: r.name }))], value: room, 'aria-label': 'Room' });
          s.addEventListener('change', () => ((room = s.value), setQuery({ room: room === 'all' ? null : room }), body.redraw()));
          return s;
        })(),
        searchBox({ value: q, placeholder: 'Search children', onInput: (v) => ((q = v), setQuery({ q: v || null }), body.redraw()) }),
      ),
      dataTable({
        columns,
        rows,
        sort,
        onSort: (s) => ((sort = s), saveSort('children', s), body.redraw()),
        rowHref: (s) => `#/children/${s.id}`,
        caption: 'Children',
        mobile: (s) =>
          h(
            'a.list-item',
            { href: `#/children/${s.id}` },
            childAvatar(s),
            h('span.grow', h('span.title', personName(s)), h('span.meta', [store.get('rooms', s.roomId)?.name, ageLabel(s.birthday, day)].filter(Boolean).join(' · '))),
            s.status === 'active' ? attendancePill(statusOf(idx.get(s.id))) : pill(statusMeta(s.status).label, statusMeta(s.status).tone),
          ),
        empty: emptyState({ icon: 'search', title: 'No children match', text: 'Try another filter or search.', compact: true }),
      }),
      h('p.subtle.small.list-foot', pluralize(rows.length, 'child', 'children')),
    ];
  }, ['students', 'rooms', 'guardians', 'attendance']);

  function familyCell(fam) {
    if (!fam.length) return h('span.subtle', 'No family added');
    const g = fam[0];
    return h('span.person-text', h('span', personName(g)), h('span.person-sub', [g.relation, fam.length > 1 ? `+${fam.length - 1} more` : ''].filter(Boolean).join(' · ')));
  }

  function exportRoster() {
    const students = store.all('students').filter((s) => FILTERS.find((x) => x.id === filter).match(s));
    downloadText(`roster-${day}.csv`, exportRosterCSV({ students, guardians: store.all('guardians'), rooms: store.all('rooms') }));
    toast(`Exported ${pluralize(students.length, 'child', 'children')}`);
  }

  function importRoster() {
    const input = h('input', { type: 'file', accept: '.csv,text/csv' });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const res = importRosterCSV(await file.text(), { rooms: store.all('rooms') });
      if (!res.students.length) {
        toast('No children found. The file needs at least a first name column.', { type: 'error' });
        return;
      }
      const ok = await confirmDialog({
        title: `Import ${pluralize(res.students.length, 'child', 'children')}?`,
        message: `This adds ${pluralize(res.students.length, 'child', 'children')} and ${pluralize(res.guardians.length, 'family member')}${res.rooms.length ? `, and creates ${pluralize(res.rooms.length, 'new room')}` : ''}.${res.skipped ? ` ${pluralize(res.skipped, 'row')} without a name will be skipped.` : ''}`,
        confirmLabel: 'Import',
      });
      if (!ok) return;
      if (res.rooms.length) store.bulkPut('rooms', res.rooms);
      store.bulkPut('students', res.students);
      if (res.guardians.length) store.bulkPut('guardians', res.guardians);
      toast(`Imported ${pluralize(res.students.length, 'child', 'children')}`);
    });
    input.click();
  }

  return h('div.page', header, body);
}


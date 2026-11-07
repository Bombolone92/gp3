/** One staff member: contact, rooms, certifications, and weekly timecard. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { card, pill, emptyState, field, textInput } from '../ui/components.js';
import { formDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { app, isManager, role } from '../app.js';
import { personName, formatHours, telHref } from '../core/format.js';
import { attendanceName, staffRecordId, firstIn, lastOut, minutesPresent, statusOf, nowHHMM } from '../core/attendance.js';
import { startOfWeek, addDays, formatDate, formatTime, diffDays } from '../core/dates.js';
import { staffAvatar, roomDot } from './common.js';
import { openStaffForm } from './staff.js';
import { inviteStaff } from './invite.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  let week = startOfWeek(app.today(), app.settings().weekStart ?? 1);
  const days = () => Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const load = () => store.open(days().filter((d) => d <= app.today()).map(attendanceName));
  load();

  const body = ctx.live(() => {
    const m = store.get('staff', id);
    if (!m) return emptyState({ icon: 'search', title: 'Staff member not found', headingLevel: 1, actions: [h('a.btn', { href: '#/staff' }, 'All staff')] });
    const today = app.today();
    let total = 0;
    const rows = days().map((d) => {
      const rec = store.get(attendanceName(d), staffRecordId(m.id));
      const mins = minutesPresent(rec, d === today ? nowHHMM() : null);
      total += mins;
      return h('tr', h('td', formatDate(d, { weekday: 'short', month: 'short', day: 'numeric' })), h('td', firstIn(rec) ? formatTime(firstIn(rec)) : '-'), h('td', statusOf(rec) === 'in' ? pill('Working', 'success') : lastOut(rec) ? formatTime(lastOut(rec)) : '-'), h('td.r', mins ? formatHours(mins) : '-'));
    });
    const certs = [...(m.certifications || [])].sort((a, b) => String(a.expires || '9').localeCompare(String(b.expires || '9')));
    return [
      h(
        'header.child-head',
        staffAvatar(m, { size: 'xl' }),
        h('div.child-titles', h('nav.crumbs', { 'aria-label': 'Breadcrumb' }, h('a', { href: '#/staff' }, 'Staff'), icon('chevron-right', 14)), h('h1', personName(m)), h('div.child-meta', m.title ? h('span', m.title) : null, ...(m.roomIds || []).map((r) => roomDot(store.get('rooms', r))), m.active === false ? pill('Former staff', 'neutral') : null)),
        isManager() ? h('div.child-actions', !m.memberUuid ? h('button.btn', { type: 'button', onClick: () => inviteStaff(m) }, icon('send', 16), 'Invite to app') : null, !m.memberUuid && role() === 'owner' ? h('button.btn', { type: 'button', onClick: () => inviteStaff(m, 'admin') }, icon('shield', 16), 'Invite as admin') : null, h('button.btn.primary', { type: 'button', onClick: () => openStaffForm(m) }, icon('pencil', 16), 'Edit')) : null,
      ),
      h(
        'div.profile-grid',
        card({
          title: 'Contact',
          body: h(
            'dl.kv',
            h('dt', 'Phone'),
            h('dd', m.phone ? h('a', { href: telHref(m.phone) }, m.phone) : h('span.subtle', 'Not set')),
            h('dt', 'Email'),
            h('dd', m.email ? h('a', { href: `mailto:${m.email}` }, m.email) : h('span.subtle', 'Not set')),
            h('dt', 'Hired'),
            h('dd', m.hireDate ? formatDate(m.hireDate) : h('span.subtle', 'Not set')),
            h('dt', 'App access'),
            h('dd', m.memberUuid ? pill(`Signed up as ${m.memberName || 'staff'}`, 'success') : pill('Not invited', 'plain')),
            isManager() && m.pin ? [h('dt', 'Kiosk PIN'), h('dd', h('button.btn.sm.ghost', { type: 'button', onClick: (e) => ((e.currentTarget.textContent = m.pin), (e.currentTarget.disabled = true)) }, 'Show'))] : null,
          ),
        }),
        card({
          title: 'Certifications',
          actions: isManager() ? h('button.btn.sm.ghost', { type: 'button', onClick: () => editCert(m) }, icon('plus', 15), 'Add') : null,
          flush: true,
          body: certs.length
            ? h(
                'ul.mini-list',
                certs.map((c) => {
                  const left = c.expires ? diffDays(today, c.expires) : null;
                  return h(
                    'li',
                    h('span.grow', h('span.person-name', c.name), h('span.person-sub', c.expires ? `Expires ${formatDate(c.expires)}` : 'No expiry')),
                    left === null ? null : left < 0 ? pill('Expired', 'danger') : left <= 30 ? pill(`${left} days left`, 'warning') : pill('Current', 'success'),
                    isManager() ? h('button.icon-btn.sm', { type: 'button', 'aria-label': `Edit ${c.name}`, onClick: () => editCert(m, c) }, icon('pencil', 15)) : null,
                  );
                }),
              )
            : h('p.card-pad.subtle', 'No certifications on file.'),
        }),
      ),
      card({
        title: 'Timecard',
        actions: h(
          'div.row',
          h('button.icon-btn.bordered', { type: 'button', 'aria-label': 'Previous week', onClick: () => ((week = addDays(week, -7)), load(), body.redraw()) }, icon('chevron-left')),
          h('span.small', `Week of ${formatDate(week, { month: 'short', day: 'numeric' })}`),
          h('button.icon-btn.bordered', { type: 'button', 'aria-label': 'Next week', disabled: addDays(week, 7) > today || null, onClick: () => ((week = addDays(week, 7)), load(), body.redraw()) }, icon('chevron-right')),
        ),
        flush: true,
        body: h('div.table-wrap', h('table.table', h('thead', h('tr', h('th', 'Day'), h('th', 'In'), h('th', 'Out'), h('th.r', 'Hours'))), h('tbody', rows), h('tfoot', h('tr', h('th', { colspan: 3 }, 'Total'), h('th.r', formatHours(total)))))),
      }),
    ];
  }, ['staff', 'rooms', 'attendance']);
  return h('div.page', body);
}

function editCert(m, cert = null) {
  formDialog({
    title: cert ? 'Edit certification' : 'Add a certification',
    size: 'narrow',
    submitLabel: cert ? 'Save' : 'Add',
    body: h('div.stack', field('Name', textInput({ name: 'name', value: cert?.name || '', placeholder: 'Pediatric CPR and First Aid', required: true })), field('Expires', textInput({ name: 'expires', type: 'date', value: cert?.expires || '' }))),
    extraFooter: cert ? ({ close }) => h('button.btn.ghost.danger-text', { type: 'button', onClick: () => (app.store.patch('staff', m.id, (cur) => ({ ...cur, certifications: (cur.certifications || []).filter((c) => c !== cert && !(c.name === cert.name && c.expires === cert.expires)) })), close()) }, 'Remove') : null,
    onSubmit: (fd) => {
      const next = { name: String(fd.get('name')).trim(), expires: fd.get('expires') || '' };
      app.store.patch('staff', m.id, (cur) => {
        const list = (cur.certifications || []).filter((c) => !(cert && c.name === cert.name && c.expires === cert.expires));
        return { ...cur, certifications: [...list, next] };
      });
      toast('Certification saved');
    },
  });
}

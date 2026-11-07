import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup, canEdit } from '../app.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { contactName, vehicleName, colorFor, telHref } from '../core/format.js';
import { formatDate, relativeDays } from '../core/dates.js';
import { CONTACT_ROLES } from '../core/status.js';
import { renewalState } from '../core/reminders.js';
import { syncOperator, recomputeVehicleMeter } from '../core/actions.js';
import { avatar, statusPill, pill } from '../ui/components.js';
import { detailHeader, kvList, sectionCard, vehicleCell, attachmentsPanel, commentsPanel, emptyPage, moreMenuButton, simpleTable, deleteWithUndo, money, deletedNotice } from './common.js';
import { openAssignmentDialog, assignmentReadings } from './assignments.js';
import { openRenewalDialog, resolveRenewal } from './renewals.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  if (!store.get('contacts', id)) return emptyPage('Contact not found', 'It may have been deleted.');
  const get = () => store.get('contacts', id);
  const editable = canEdit('contacts');
  const files = h('div.two-col.top-gap', h('div.col', attachmentsPanel('contacts', id, { title: 'Documents' })), h('div.col', commentsPanel('contacts', id)));
  const body = ctx.live(() => {
    const c = get();
    files.hidden = !c;
    if (!c) return deletedNotice('contact', { href: '#/contacts', label: 'Back to contacts' });
    const today = app.today();
    const roles = (c.roles || []).map((r) => CONTACT_ROLES.find((x) => x.id === r)?.label).filter(Boolean);
    const assignments = store.all('assignments').filter((a) => a.contactId === id);
    const rens = store.all('renewals').filter((r) => r.kind === 'contact' && r.contactId === id);
    const wos = store.all('workOrders').filter((w) => w.assigneeId === id && w.status !== 'completed' && w.status !== 'cancelled');
    const issues = store.all('issues').filter((i) => i.assigneeId === id && i.status === 'open');
    return h(
      'div',
      detailHeader({
        back: { label: 'Contacts', href: '#/contacts' },
        thumb: avatar(contactName(c), { color: colorFor(c.id), size: 'xl' }),
        title: contactName(c),
        sub: [c.jobTitle, lookup.groupName(c.groupId)].filter(Boolean).join(' · '),
        meta: [...roles.map((r) => h('span.mini-tag', r)), c.email ? h('a.row.gap-4', { href: `mailto:${c.email}` }, icon('mail', 14), c.email) : null, c.phone ? h('a.row.gap-4', { href: telHref(c.phone) }, icon('phone', 14), c.phone) : null, c.archived ? pill('Archived', 'gray') : null],
        actions: editable
          ? [
              h('a.btn', { href: `#/contacts/${id}/edit` }, icon('pencil', 15), 'Edit'),
              moreMenuButton([
                canEdit('assignments') ? { label: 'Assign a vehicle', icon: 'truck', run: () => openAssignmentDialog({ contactId: id }) } : null,
                canEdit('renewals') ? { label: 'Add renewal reminder', icon: 'calendar-clock', run: () => openRenewalDialog({ kind: 'contact', contactId: id }) } : null,
                { label: c.archived ? 'Restore' : 'Archive', icon: c.archived ? 'unarchive' : 'archive', run: () => (store.patch('contacts', id, { archived: !c.archived }), toast(c.archived ? 'Contact restored' : 'Contact archived')) },
                { label: 'Delete contact', icon: 'trash', danger: true, run: () => deleteContact(c) },
              ]),
            ]
          : [],
      }),
      h(
        'div.two-col',
        h(
          'div.col',
          sectionCard('Details', kvList([
            ['Email', c.email ? h('a', { href: `mailto:${c.email}` }, c.email) : null],
            ['Phone', c.phone ? h('a', { href: telHref(c.phone) }, c.phone) : null],
            ['Roles', roles.join(', ')],
            ['Group', lookup.groupName(c.groupId)],
            ['Employee number', c.employeeNumber],
            ['Labor rate', c.hourlyRate ? `${money(c.hourlyRate)} per hour` : null],
            ['Started', c.startDate ? formatDate(c.startDate) : null],
            ['Left', c.leaveDate ? formatDate(c.leaveDate) : null],
            ['Driver license', c.license?.number ? `${c.license.number}${c.license.class ? `, class ${c.license.class}` : ''}${c.license.state ? `, ${c.license.state}` : ''}` : null],
            ['Notes', c.notes ? h('span.pre-wrap', c.notes) : null],
          ])),
          sectionCard(
            'Renewals',
            rens.length
              ? h('ul.widget-list.no-top', rens.map((r) => { const st = renewalState(r, today, app.settings()); return h('li', h('div.widget-row', r.done ? pill('Done', 'green') : statusPill('reminder', st.status), h('span.grow', r.type), h('span.subtle', r.dueDate ? `${formatDate(r.dueDate)}, ${relativeDays(r.dueDate, today)}` : ''), canEdit('renewals') && !r.done ? h('button.btn.sm', { type: 'button', onClick: () => resolveRenewal(r) }, 'Resolve') : null)); }))
              : h('p.mini-empty', 'No license or certification renewals tracked.'),
            { actions: canEdit('renewals') ? h('button.btn.sm.ghost', { type: 'button', onClick: () => openRenewalDialog({ kind: 'contact', contactId: id }) }, icon('plus', 15), 'Add') : null },
          ),
        ),
        h(
          'div.col',
          h(
            'section.card.panel',
            h('div.card-head', h('h2.grow', 'Vehicle assignments'), canEdit('assignments') ? h('button.btn.sm.ghost', { type: 'button', onClick: () => openAssignmentDialog({ contactId: id }) }, icon('plus', 15), 'Assign') : null),
            h('div.card-body.flush', simpleTable({
              rows: assignments,
              caption: 'Vehicle assignments',
              defaultSort: { id: 'start', dir: 'desc' },
              empty: 'No vehicles assigned.',
              columns: [
                { id: 'vehicle', label: 'Vehicle', render: (a) => vehicleCell(a.vehicleId, { sub: false }), sort: (a) => vehicleName(lookup.vehicle(a.vehicleId)) },
                { id: 'start', label: 'Start', render: (a) => formatDate(a.start), sort: (a) => a.start },
                { id: 'end', label: 'End', render: (a) => (a.end ? formatDate(a.end) : a.start <= today ? pill('Current', 'green') : pill('Upcoming', 'blue')), sort: (a) => a.end || '9999' },
              ],
            })),
          ),
          wos.length || issues.length
            ? sectionCard('Assigned work', h('ul.widget-list.no-top', ...wos.map((w) => h('li', h('a.widget-row', { href: `#/work-orders/${w.id}` }, statusPill('workOrder', w.status), h('span.grow.truncate', `Work order #${w.number} · ${vehicleName(lookup.vehicle(w.vehicleId))}`)))), ...issues.map((i) => h('li', h('a.widget-row', { href: `#/issues/${i.id}` }, statusPill('priority', i.priority), h('span.grow.truncate', `Issue #${i.number} ${i.summary}`))))))
            : null,
        ),
      ),
    );
  }, ['contacts', 'assignments', 'renewals', 'vehicles', 'workOrders', 'issues']);
  return { node: h('div.page.detail-page', body, files), title: contactName(get()) };
}

const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * Delete a contact with the records that only make sense with them: their
 * vehicle assignments and license renewals. Their vehicles become
 * unassigned. Undo puts all of it back.
 */
function deleteContact(c) {
  const store = app.store;
  const assignments = store.all('assignments').filter((a) => a.contactId === c.id);
  const renewals = store.all('renewals').filter((r) => r.kind === 'contact' && r.contactId === c.id);
  const readings = assignmentReadings(store, assignments.map((a) => a.id));
  const operated = new Map(store.all('vehicles').filter((v) => v.operatorId === c.id || assignments.some((a) => a.vehicleId === v.id)).map((v) => [v.id, v.operatorId || null]));
  const parts = [assignments.length ? plural(assignments.length, 'vehicle assignment') : '', renewals.length ? plural(renewals.length, 'renewal') : ''].filter(Boolean);
  const message = parts.length ? `${contactName(c)} and their ${parts.join(' and ')} will be permanently deleted, and their vehicles unassigned. Archive the contact instead to keep this history.` : undefined;
  return deleteWithUndo('contacts', c, {
    label: 'contact',
    message,
    extra: () => {
      store.bulkRemove('assignments', assignments.map((a) => a.id));
      store.bulkRemove('renewals', renewals.map((r) => r.id));
      store.bulkRemove('meters', readings.map((m) => m.id));
      for (const vid of operated.keys()) {
        recomputeVehicleMeter(store, vid);
        syncOperator(store, vid, app.today());
        if (store.get('vehicles', vid)?.operatorId === c.id) store.patch('vehicles', vid, { operatorId: null });
      }
    },
    onUndo: () => {
      for (const a of assignments) store.restore('assignments', a);
      for (const r of renewals) store.restore('renewals', r);
      for (const m of readings) store.restore('meters', m);
      for (const [vid, operatorId] of operated) {
        if (!store.get('vehicles', vid)) continue;
        recomputeVehicleMeter(store, vid);
        store.patch('vehicles', vid, { operatorId });
      }
    },
    onDeleted: () => navigate('/contacts'),
  });
}

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderList, fieldFilter } from '../ui/grid.js';
import { app, lookup, canEdit } from '../app.js';
import { contactName, vehicleName, colorFor, telHref } from '../core/format.js';
import { CONTACT_ROLES } from '../core/status.js';
import { renewalState } from '../core/reminders.js';
import { avatar, pill } from '../ui/components.js';
import { dash, operatorOf, archiveBulk } from './common.js';
import { importContacts } from './importers.js';

export function render(ctx) {
  const store = app.store;
  const editable = canEdit('contacts');
  const roleLabels = (c) => (c.roles || []).map((r) => CONTACT_ROLES.find((x) => x.id === r)?.label).filter(Boolean);
  const vehiclesOf = (c) => store.all('vehicles').filter((v) => operatorOf(v) === c.id && !v.archived);
  const expiring = (c) => store.all('renewals').filter((r) => r.kind === 'contact' && r.contactId === c.id && !r.done && renewalState(r, app.today(), app.settings()).status !== 'upcoming');
  return renderList(ctx, {
    key: 'contacts',
    title: 'Contacts',
    intro: 'Drivers, technicians, and everyone else involved with your fleet.',
    coll: 'contacts',
    watch: ['vehicles', 'renewals', 'assignments'],
    csvName: 'contacts',
    actions: editable ? [h('a.btn.primary', { href: '#/contacts/new' }, icon('plus', 16), 'Add contact')] : [],
    more: editable ? [{ label: 'Import from CSV', icon: 'upload', run: importContacts }] : [],
    tabs: [
      { id: 'active', label: 'Active', filter: (c) => !c.archived },
      { id: 'operators', label: 'Operators', filter: (c) => !c.archived && (c.roles || []).includes('operator') },
      { id: 'technicians', label: 'Technicians', filter: (c) => !c.archived && (c.roles || []).includes('technician') },
      { id: 'archived', label: 'Archived', filter: (c) => c.archived },
    ],
    filters: [
      { id: 'role', label: 'Role', options: () => CONTACT_ROLES.map((r) => ({ value: r.id, label: r.label })), match: (c, vals) => (c.roles || []).some((r) => vals.has(r)) },
      fieldFilter('group', 'Group', (c) => c.groupId || '', () => (app.settings().groups || []).map((g) => ({ value: g.id, label: g.name }))),
    ],
    defaultSort: { id: 'name', dir: 'asc' },
    search: (c) => [contactName(c), c.email, c.phone, c.jobTitle, c.employeeNumber, ...roleLabels(c)].join(' '),
    rowHref: (c) => `#/contacts/${c.id}`,
    columns: [
      { id: 'name', label: 'Name', fixed: true, render: (c) => h('span.cell-person', avatar(contactName(c), { color: colorFor(c.id), size: 'sm' }), h('span.cell-text', h('span.cell-title', contactName(c)), c.jobTitle ? h('span.cell-sub', c.jobTitle) : null)), sort: (c) => contactName(c), csv: (c) => contactName(c) },
      { id: 'email', label: 'Email', render: (c) => (c.email ? h('a', { href: `mailto:${c.email}` }, c.email) : dash()), sort: (c) => c.email || '' },
      { id: 'phone', label: 'Phone', render: (c) => (c.phone ? h('a', { href: telHref(c.phone) }, c.phone) : dash()), sort: (c) => c.phone || '' },
      { id: 'roles', label: 'Roles', render: (c) => h('span.cell-labels', roleLabels(c).map((r) => h('span.mini-tag', r))), sort: (c) => roleLabels(c).join(','), csv: (c) => roleLabels(c).join('; ') },
      { id: 'group', label: 'Group', render: (c) => lookup.groupName(c.groupId) || dash(), sort: (c) => lookup.groupName(c.groupId) },
      { id: 'vehicles', label: 'Assigned vehicles', render: (c) => { const vs = vehiclesOf(c); return vs.length ? h('span.truncate', vs.map((v) => vehicleName(v)).join(', ')) : dash(); }, sort: (c) => vehiclesOf(c).length },
      { id: 'renewals', label: 'Renewals', render: (c) => { const ex = expiring(c); return ex.length ? pill(`${ex.length} due`, 'orange') : dash(); }, sort: (c) => expiring(c).length },
      { id: 'employee', label: 'Employee number', hidden: true, render: (c) => c.employeeNumber || dash(), sort: (c) => c.employeeNumber || '' },
      { id: 'license', label: 'License', hidden: true, render: (c) => (c.license?.number ? `${c.license.number}${c.license.class ? ` (class ${c.license.class})` : ''}` : dash()), sort: (c) => c.license?.number || '' },
    ],
    mobile: (c) => h('div.row.grow', avatar(contactName(c), { color: colorFor(c.id), size: 'sm' }), h('div.grow', h('strong', contactName(c)), h('div.subtle.truncate', [c.jobTitle, c.phone].filter(Boolean).join(' · ')))),
    bulk: editable ? [archiveBulk('contacts', 'contact')] : null,
    empty: { icon: 'users', title: 'No contacts yet', text: 'Add drivers and technicians to assign vehicles, work orders, and license renewals.', action: editable ? () => h('a.btn.primary', { href: '#/contacts/new' }, icon('plus', 16), 'Add contact') : null },
  });
}

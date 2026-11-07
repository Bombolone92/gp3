/** Task detail: status, details, related records, updates thread and files. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, card, emptyState, statusPill, avatar, moreButton } from '../../ui/components.js';
import { openMenu } from '../../ui/menu.js';
import { navigate } from '../../ui/router.js';
import { toast } from '../../ui/toast.js';
import { formatDate, relativeDay } from '../../core/dates.js';
import { displayName, personName, telHref } from '../../core/format.js';
import { TASK_STATUSES, isOverdue, statusLabel, taskKindLabel } from '../../core/status.js';
import { kvList, notesCard, deleteWithUndo, unitLink, propertyLink, tenantLink, ownerLink, leaseLink } from '../common.js';
import { attachmentsCard } from '../attachments.js';
import { currentMember } from './list.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  const node = ctx.live(() => view(), ['tasks', 'team', 'properties', 'units', 'tenants', 'owners', 'leases', 'workOrders']);

  function setStatus(task, status) {
    const changes = { status };
    // Completed gets today's date; closed keeps the date it was completed
    // on, if it was; reopened, it has none.
    changes.completedOn = status === 'completed' ? task.completedOn || app.today() : status === 'closed' ? task.completedOn || null : null;
    if (status === 'in-progress' && !task.assigneeId) changes.assigneeId = currentMember()?.id || null;
    const before = { status: task.status, completedOn: task.completedOn || null, assigneeId: task.assigneeId || null };
    store.patch('tasks', task.id, changes);
    toast(`Marked ${statusLabel(status).toLowerCase()}`, { action: { label: 'Undo', run: () => store.patch('tasks', task.id, before) } });
  }

  function view() {
    const t = store.get('tasks', id);
    if (!t) return h('div.page', emptyState({ icon: 'list-checks', title: 'Task not found', text: 'It may have been deleted.', headingLevel: 1, actions: [h('a.btn.primary', { href: '#/tasks' }, 'Back to tasks')] }));
    const today = app.today();
    const done = t.status === 'completed' || t.status === 'closed';
    const wo = t.workOrderId ? store.get('workOrders', t.workOrderId) : null;
    const lease = t.leaseId ? store.get('leases', t.leaseId) : null;
    const member = lookup.member(t.assigneeId);

    const statusBtn = h(
      'button.btn',
      {
        type: 'button',
        'aria-label': `Status: ${statusLabel(t.status)}. Change status`,
        onClick: (e) => openMenu(e.currentTarget, TASK_STATUSES.map((s) => ({ label: statusLabel(s), checked: s === t.status, run: () => s !== t.status && setStatus(t, s) })), { label: 'Change status' }),
      },
      statusPill(t.status),
      icon('chevron-down', 14),
    );

    const more = moreButton((btn) =>
      openMenu(btn, [
        { label: 'Edit', icon: 'pencil', run: () => navigate(`/tasks/${t.id}/edit`) },
        !wo ? { label: 'Convert to work order', icon: 'wrench', run: () => toWorkOrder(t) } : null,
        // Only when someone on the task has an email address to write to.
        recipientsFor(t).length ? { label: 'Email', icon: 'mail', run: () => emailAbout(t) } : null,
        { separator: true },
        {
          label: 'Delete',
          icon: 'trash',
          danger: true,
          run: () => deleteWithUndo('tasks', t, { title: 'Delete this task?', message: `TK-${t.number} "${t.title}" and its updates will be deleted.`, label: 'Task deleted', after: () => navigate('/tasks') }),
        },
      ]),
    );

    const header = pageHeader({
      title: t.title || 'Untitled task',
      crumbs: [{ label: 'Tasks', href: '#/tasks' }, { label: `TK-${t.number || ''}` }],
      subtitle: h('span.row.task-sub', { style: { gap: '8px', flexWrap: 'wrap' } }, taskKindLabel(t.kind), t.priority && t.priority !== 'normal' ? statusPill(t.priority) : null, isOverdue(t, today) ? h('span.overdue', icon('alert', 14), `Overdue since ${formatDate(t.dueDate)}`) : null),
      actions: [
        statusBtn,
        !done ? h('button.btn.primary', { type: 'button', onClick: () => setStatus(t, 'completed') }, icon('check', 16), 'Mark complete') : null,
        more,
      ],
    });

    const related = [
      t.unitId ? ['Unit', unitLink(t.unitId)] : t.propertyId ? ['Property', propertyLink(t.propertyId)] : null,
      t.tenantId ? ['Tenant', tenantLink(t.tenantId)] : null,
      t.ownerId ? ['Rental owner', ownerLink(t.ownerId)] : null,
      t.contact?.name || t.contact?.phone || t.contact?.email
        ? [
            'Contact',
            h(
              'span.stack.sm',
              t.contact.name ? h('span', t.contact.name) : null,
              t.contact.phone ? h('a', { href: telHref(t.contact.phone) }, t.contact.phone) : null,
              t.contact.email ? h('a', { href: `mailto:${t.contact.email}` }, t.contact.email) : null,
            ),
          ]
        : null,
      lease ? ['Lease', leaseLink(lease)] : null,
      wo ? ['Work order', h('a', { href: `#/work-orders/${wo.id}` }, `WO-${wo.number}: ${wo.title}`, ' ', statusPill(wo.status))] : null,
    ].filter(Boolean);

    const tenant = t.tenantId ? store.get('tenants', t.tenantId) : null;
    const contactQuick = tenant && ((tenant.phones || [])[0] || (tenant.emails || [])[0])
      ? h(
          'div.task-contact',
          h('span.subtle', `Contact ${personName(tenant)}`),
          (tenant.phones || [])[0] ? h('a.btn.sm', { href: telHref(tenant.phones[0]) }, icon('phone', 14), tenant.phones[0]) : null,
          (tenant.emails || [])[0] ? h('button.btn.sm', { type: 'button', onClick: () => emailAbout(t) }, icon('mail', 14), 'Email') : null,
        )
      : null;

    return h(
      'div.page',
      header,
      h(
        'div.detail',
        h(
          'div.detail-main',
          card({ title: 'Description', body: t.description ? h('p.task-description', t.description) : h('p.subtle', 'No description.') }),
          notesCard('tasks', t, { title: 'Updates' }),
          attachmentsCard('tasks', t, { title: 'Files and photos', folder: 'tasks' }),
        ),
        h(
          'div.detail-aside',
          card({
            title: 'Details',
            body: kvList([
              ['Status', statusPill(t.status)],
              ['Assigned to', member ? h('span.row', { style: { gap: '6px' } }, avatar(member.name, { color: member.color, size: 'sm' }), member.name) : h('span.subtle', 'Unassigned')],
              ['Due', t.dueDate ? h(`span${isOverdue(t, today) ? '.overdue' : ''}`, `${formatDate(t.dueDate)} (${relativeDay(t.dueDate, today)})`) : h('span.subtle', 'No due date')],
              ['Priority', statusLabel(t.priority || 'normal')],
              ['Category', t.category || ''],
              ['Type', taskKindLabel(t.kind)],
              ['Created', t.createdAt ? formatDate(t.createdAt) : ''],
              t.completedOn ? ['Completed', formatDate(t.completedOn)] : null,
            ].filter(Boolean)),
          }),
          card({
            title: 'Related to',
            body: [related.length ? kvList(related) : h('p.subtle', 'Not linked to a property, tenant or owner.'), contactQuick],
            actions: !wo && !done ? h('button.btn.sm', { type: 'button', onClick: () => toWorkOrder(t) }, icon('wrench', 14), 'Work order') : null,
          }),
        ),
      ),
    );
  }

  function toWorkOrder(t) {
    const p = new URLSearchParams({ taskId: t.id, ...(t.propertyId ? { propertyId: t.propertyId } : {}), ...(t.unitId ? { unitId: t.unitId } : {}), title: t.title || '' });
    navigate(`/work-orders/new?${p.toString()}`);
  }

  function recipientsFor(t) {
    const tenant = t.tenantId ? store.get('tenants', t.tenantId) : null;
    const owner = t.ownerId ? store.get('owners', t.ownerId) : null;
    const to = [];
    if (tenant?.emails?.[0]) to.push({ name: personName(tenant), email: tenant.emails[0], tenantId: tenant.id });
    if (owner?.emails?.[0]) to.push({ name: displayName(owner), email: owner.emails[0] });
    if (t.contact?.email) to.push({ name: t.contact.name || '', email: t.contact.email });
    return to;
  }

  async function emailAbout(t) {
    const { composeEmail } = await import('../compose.js');
    composeEmail({ to: recipientsFor(t), subject: `Re: ${t.title}`, related: { propertyId: t.propertyId, leaseId: t.leaseId, tenantId: t.tenantId } });
  }

  return { node, title: store.get('tasks', id)?.title || 'Task' };
}

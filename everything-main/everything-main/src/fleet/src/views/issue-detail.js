import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup, canEdit, canDelete } from '../app.js';
import { navigate } from '../ui/router.js';
import { openMenu } from '../ui/menu.js';
import { openFormDialog } from '../ui/form.js';
import { toast } from '../ui/toast.js';
import { vehicleName } from '../core/format.js';
import { formatDate, relativeDays, timeAgo } from '../core/dates.js';
import { issueOverdue } from '../core/status.js';
import { statusPill, pill } from '../ui/components.js';
import { detailHeader, kvList, sectionCard, vehicleCell, contactCell, attachmentsPanel, commentsPanel, emptyPage, moreMenuButton, deleteWithUndo, meterText, dash } from './common.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  if (!store.get('issues', id)) return emptyPage('Issue not found', 'It may have been deleted.');
  const get = () => store.get('issues', id);
  const editable = canEdit('issues');

  const header = ctx.live(() => {
    const i = get();
    if (!i) return null;
    const today = app.today();
    const late = issueOverdue(i, today, lookup.vehicle(i.vehicleId));
    return detailHeader({
      back: { label: 'Issues', href: '#/issues' },
      title: h('span', h('span.subtle', `#${i.number} `), i.summary),
      meta: [late ? pill('Overdue', 'red') : statusPill('issue', i.status), statusPill('priority', i.priority), vehicleCell(i.vehicleId, { sub: false }), h('span.subtle', `Reported ${relativeDays(i.reportedDate, today)}${i.reportedBy ? ` by ${i.reportedBy}` : ''}`)],
      actions: editable
        ? [
            i.status === 'open'
              ? h('button.btn.primary', { type: 'button', onClick: (e) => resolveMenu(e.currentTarget, i) }, icon('circle-check', 16), 'Resolve', icon('chevron-down', 15))
              : h('button.btn', { type: 'button', onClick: () => (store.patch('issues', id, { status: 'open', resolvedAt: null, resolution: null }), toast('Issue reopened')) }, icon('rotate', 15), 'Reopen'),
            h('a.btn', { href: `#/issues/${id}/edit` }, icon('pencil', 15), 'Edit'),
            i.status === 'open' || canDelete('issues')
              ? moreMenuButton([
                  i.status === 'open' ? { label: 'Close without fixing', icon: 'circle-x', run: () => closeIssue(i) } : null,
                  canDelete('issues') ? { label: 'Delete issue', icon: 'trash', danger: true, run: () => deleteWithUndo('issues', i, { label: 'issue', meterSource: 'issue', onDeleted: () => navigate('/issues') }) } : null,
                ])
              : null,
          ]
        : [],
    });
  }, ['issues', 'vehicles', 'contacts']);

  const body = ctx.live(() => {
    const i = get();
    if (!i) return null;
    const v = lookup.vehicle(i.vehicleId);
    const res = i.resolution;
    return h(
      'div.col',
      sectionCard(
        'Details',
        kvList([
          ['Vehicle', vehicleCell(i.vehicleId)],
          ['Summary', i.summary],
          ['Description', i.description ? h('span.pre-wrap', i.description) : null],
          ['Priority', statusPill('priority', i.priority)],
          ['Reported', `${formatDate(i.reportedDate)}${i.reportedBy ? ` by ${i.reportedBy}` : ''}`],
          ['Assigned to', i.assigneeId ? contactCell(i.assigneeId) : null],
          ['Due', [i.dueDate ? formatDate(i.dueDate) : '', i.dueMeter ? meterText(i.dueMeter, v) : ''].filter(Boolean).join(' or ')],
          ['Source', i.source?.type === 'inspection' ? h('a', { href: `#/inspections/${i.source.id}` }, 'Failed inspection item') : 'Reported manually'],
          ['Labels', (i.labels || []).length ? h('span.cell-labels', i.labels.map((l) => h('span.mini-tag', l))) : null],
        ]),
      ),
      i.status !== 'open'
        ? sectionCard(
            i.status === 'resolved' ? 'Resolution' : 'Closed',
            kvList([
              ['Date', i.resolvedAt ? formatDate(i.resolvedAt) : null],
              ['Resolved by', res?.type === 'service' ? (store.get('serviceEntries', res.id) ? h('a', { href: `#/service/${res.id}` }, 'Service entry') : h('span.subtle', 'Deleted service entry')) : res?.type === 'workOrder' ? (store.get('workOrders', res.id) ? h('a', { href: `#/work-orders/${res.id}` }, 'Work order') : h('span.subtle', 'Deleted work order')) : res?.type === 'note' ? 'Note' : null],
              ['Note', res?.note || null],
            ]),
          )
        : null,
    );
  }, ['issues', 'vehicles', 'contacts', 'serviceEntries', 'workOrders']);

  function resolveMenu(anchor, i) {
    openMenu(
      anchor,
      [
        canEdit('serviceEntries') ? { label: 'With a service entry', description: 'Record the repair that fixed it', icon: 'wrench', run: () => navigate(`/service/new?vehicle=${i.vehicleId}&issue=${i.id}`) } : null,
        canEdit('workOrders') ? { label: 'With a work order', description: 'Plan the repair in the shop', icon: 'clipboard', run: () => navigate(`/work-orders/new?vehicle=${i.vehicleId}&issue=${i.id}`) } : null,
        { label: 'With a note', description: 'Mark it fixed and say how', icon: 'message', run: () => noteResolve(i) },
      ],
      { label: 'Resolve issue', align: 'end' },
    );
  }

  function noteResolve(i) {
    openFormDialog({
      title: `Resolve issue #${i.number}`,
      record: { date: app.today() },
      fields: [
        { id: 'date', label: 'Resolved on', type: 'date', required: true },
        { id: 'note', label: 'How was it fixed?', type: 'textarea', rows: 3, span: 2 },
      ],
      saveLabel: 'Resolve',
      onSave: (v) => {
        if (!get()) return toast('This issue was deleted.', { type: 'error' });
        store.put('issues', { ...get(), status: 'resolved', resolvedAt: v.date, resolution: { type: 'note', note: v.note, date: v.date } });
        toast('Issue resolved');
      },
    });
  }

  function closeIssue(i) {
    openFormDialog({
      title: `Close issue #${i.number}`,
      intro: 'Close an issue that does not need a fix, like a duplicate or a false alarm.',
      record: {},
      fields: [{ id: 'note', label: 'Reason', type: 'textarea', rows: 2, span: 2 }],
      saveLabel: 'Close issue',
      onSave: (v) => {
        if (!get()) return toast('This issue was deleted.', { type: 'error' });
        store.put('issues', { ...get(), status: 'closed', resolvedAt: app.today(), resolution: { type: 'note', note: v.note, date: app.today() } });
        toast('Issue closed');
      },
    });
  }

  const i0 = get();
  return {
    node: h('div.page.detail-page', header, h('div.two-col', body, h('div.col', attachmentsPanel('issues', id, { title: 'Photos and documents' }), commentsPanel('issues', id)))),
    title: `Issue #${i0.number}`,
  };
}

export { vehicleName, timeAgo, dash };

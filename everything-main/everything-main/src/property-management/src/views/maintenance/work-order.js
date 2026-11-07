/** One work order: status, details, vendor, cost, bill, notes and files. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, statusPill, emptyState, moreButton, card } from '../../ui/components.js';
import { confirmDialog } from '../../ui/dialog.js';
import { openMenu } from '../../ui/menu.js';
import { navigate } from '../../ui/router.js';
import { toast } from '../../ui/toast.js';
import { money, date, kvList, notesCard, deleteWithUndo, tenantLink, sectionEmpty } from '../common.js';
import { attachmentsCard } from '../attachments.js';
import { displayName, primaryEmail, primaryPhone, telHref } from '../../core/format.js';
import { billStatus } from '../../core/ledger.js';
import { ACC } from '../../core/accounts.js';
import { isOverdue, statusLabel } from '../../core/status.js';
import { statusMenuItems, setStatus, priorityTag } from './work-orders.js';
import { ENTRY_LABEL, workOrderTotal, openCompose, printNode, printHeader, txDialogs, insuranceState } from './shared.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  const body = ctx.live(() => {
    const w = store.get('workOrders', id);
    if (!w) return emptyState({ icon: 'wrench', title: 'Work order not found', headingLevel: 1, text: 'It may have been deleted.', actions: [h('a.btn.primary', { href: '#/work-orders' }, 'Back to work orders')] });
    const today = app.today();
    const vendor = lookup.vendor(w.vendorId);
    const total = workOrderTotal(w);
    const bills = billsFor(w);
    const done = ['completed', 'closed', 'cancelled'].includes(w.status);
    const task = w.taskId ? store.get('tasks', w.taskId) : null;

    const statusBtn = h(
      'button.btn',
      { type: 'button', 'aria-haspopup': 'menu', onClick: (e) => openMenu(e.currentTarget, statusMenuItems(w), { label: 'Status' }) },
      statusLabel(w.status),
      icon('chevron-down', 15),
    );
    const primary = !done
      ? h('button.btn.primary', { type: 'button', onClick: () => setStatus(w, 'completed') }, icon('check', 16), 'Mark complete')
      : !bills.length && w.vendorId
        ? h('button.btn.primary', { type: 'button', onClick: () => createBill(w) }, icon('receipt', 16), 'Create bill')
        : null;
    const more = moreButton((btn) =>
      openMenu(btn, [
        { label: 'Edit', icon: 'pencil', href: `#/work-orders/${w.id}/edit` },
        w.vendorId ? { label: 'Create bill from work order', icon: 'receipt', run: () => createBill(w) } : null,
        vendor && primaryEmail(vendor) ? { label: 'Email vendor', icon: 'mail', run: () => emailVendor(w) } : null,
        { label: 'Print work order', icon: 'printer', run: () => printWorkOrder(w) },
        { separator: true },
        { label: 'Delete', icon: 'trash', danger: true, run: () => deleteWithUndo('workOrders', w, { title: `Delete WO-${w.number}?`, message: 'The work order, its notes and file links will be removed.', label: 'Work order deleted', after: () => navigate('/work-orders') }) },
      ]),
    );

    const items = w.items || [];
    const main = h(
      'div.detail-main',
      card({
        title: 'Details',
        body: h(
          'div.stack',
          w.description ? h('p.pre-wrap', w.description) : h('p.subtle', 'No description.'),
          kvList([
            ['Unit', w.unitId ? h('a', { href: `#/units/${w.unitId}` }, lookup.unitLabel(w.unitId)) : lookup.property(w.propertyId) ? h('a', { href: `#/properties/${w.propertyId}` }, lookup.property(w.propertyId).name) : null],
            ['Requested by', w.requestedBy ? tenantLink(w.requestedBy) : null],
            ['Entry', h('span', ENTRY_LABEL[w.entry || 'allowed'], w.entryNotes ? h('span.subtle', ` · ${w.entryNotes}`) : null)],
            ['From task', task ? h('a', { href: `#/tasks/${task.id}` }, task.title) : null],
          ]),
        ),
      }),
      card({
        title: 'Parts and labor',
        flush: true,
        actions: h('a.btn.sm.ghost', { href: `#/work-orders/${w.id}/edit` }, icon('pencil', 14), items.length ? 'Edit' : 'Add items'),
        body: items.length
          ? h(
              'div.table-wrap',
              h(
                'table.table',
                h('caption.sr-only', 'Parts and labor'),
                h('thead', h('tr', h('th', 'Description'), h('th.r', 'Qty'), h('th.r', 'Unit price'), h('th.r', 'Total'))),
                h('tbody', items.map((it) => h('tr', h('td', it.description || 'Item'), h('td.r.num', String(it.qty ?? 1)), h('td.r.num', money(it.amount || 0)), h('td.r.num', money(Math.round((Number(it.qty) || 0) * (it.amount || 0))))))),
                h('tfoot', h('tr', h('td', { colspan: 3 }, h('strong', 'Total')), h('td.r.num', h('strong', money(total))))),
              ),
            )
          : h('div.card-body', sectionEmpty('No parts or labor recorded yet.')),
      }),
      card({
        title: 'Bills',
        flush: true,
        actions: w.vendorId ? h('button.btn.sm', { type: 'button', onClick: () => createBill(w) }, icon('plus', 14), 'Create bill') : null,
        body: bills.length
          ? h(
              'ul.list',
              bills.map((b) => {
                const info = app.ledger().bill(b.id);
                return h('li', h('a.list-item', { href: `#/bills/${b.id}` }, icon('receipt', 18), h('span.grow', h('span.title', b.ref ? `Bill ${b.ref}` : b.memo || 'Bill'), h('span.meta', ` ${date(b.date)} · due ${date(b.dueDate)}`)), h('span.num', money(info.total)), statusPill(billStatus(b, info, today))));
              }),
            )
          : h('div.card-body', sectionEmpty(w.vendorId ? 'Not billed yet. Create a bill when the vendor invoices you.' : 'Choose a vendor to bill this work.')),
      }),
      notesCard('workOrders', w),
      attachmentsCard('workOrders', w, { title: 'Photos and files' }),
    );

    const ins = insuranceState(vendor, today);
    const aside = h(
      'div.detail-aside',
      card({
        title: 'Summary',
        body: kvList([
          ['Status', statusPill(w.status)],
          ['Priority', statusPill(w.priority || 'normal')],
          ['Due', w.dueDate ? h(`span${isOverdue(w, today) ? '.overdue' : ''}`, date(w.dueDate)) : 'No due date'],
          ['Assigned to', lookup.member(w.assigneeId)?.name || 'Unassigned'],
          ['Completed', w.completedOn ? date(w.completedOn) : null],
          ['Estimated cost', total ? money(total) : null],
          ['Created', w.createdAt ? date(w.createdAt) : null],
        ]),
      }),
      card({
        title: 'Vendor',
        body: vendor
          ? h(
              'div.stack',
              h('a.vendor-name', { href: `#/vendors/${vendor.id}` }, displayName(vendor)),
              kvList([
                ['Category', vendor.category || null],
                ['Phone', primaryPhone(vendor) ? h('a', { href: telHref(primaryPhone(vendor)) }, primaryPhone(vendor)) : null],
                ['Email', primaryEmail(vendor) ? h('a', { href: `mailto:${primaryEmail(vendor)}` }, primaryEmail(vendor)) : null],
              ]),
              ins ? h(`div.notice.${ins === 'expired' ? 'danger' : 'warning'}`, icon('shield'), h('span', ins === 'expired' ? 'Insurance certificate has expired.' : `Insurance expires ${date(vendor.insuranceExpires)}.`)) : null,
              primaryEmail(vendor) ? h('button.btn.sm', { type: 'button', onClick: () => emailVendor(w) }, icon('mail', 14), 'Email work order') : null,
            )
          : h('div.stack', h('p.subtle', 'No vendor assigned.'), h('a.btn.sm', { href: `#/work-orders/${w.id}/edit` }, 'Choose a vendor')),
      }),
    );

    return h(
      'div',
      pageHeader({
        title: w.title || 'Work order',
        crumbs: [{ label: 'Work orders', href: '#/work-orders' }],
        after: h('div.row.header-pills', h('span.subtle', `WO-${w.number}`), statusPill(w.status), priorityTag(w.priority)),
        actions: [more, statusBtn, primary],
      }),
      h('div.detail', main, aside),
    );
  }, ['workOrders', 'vendors', 'transactions', 'team']);
  return { node: h('div.page', body), title: store.get('workOrders', id) ? `WO-${store.get('workOrders', id).number}` : 'Work order' };
}

/** Bills already recorded for a work order (not voided). */
function billsFor(w) {
  return app.store.all('transactions').filter((t) => t.kind === 'bill' && !t.voided && (t.workOrderId === w.id || t.id === w.billId));
}

async function createBill(w) {
  const vendor = lookup.vendor(w.vendorId);
  const accountId = vendor?.accountId || ACC.repairs;
  const where = { propertyId: w.propertyId, unitId: w.unitId || null };
  const total = workOrderTotal(w);
  const billed = billsFor(w).reduce((s, b) => s + app.ledger().bill(b.id).total, 0);
  // A second bill is sometimes right (a second invoice), but never by accident.
  if (billed > 0) {
    const ok = await confirmDialog({
      title: `WO-${w.number} already has a bill`,
      message: `${money(billed)} has been billed for this work order${total > billed ? `, and ${money(total - billed)} of its ${money(total)} is not billed yet` : ''}. Create another bill?`,
      confirmLabel: 'Create another bill',
    });
    if (!ok) return;
  }
  const lines = (w.items || []).map((it) => ({ accountId, amount: Math.round((Number(it.qty) || 0) * (it.amount || 0)), memo: it.description || w.title, ...where }));
  // Bills take positive lines only, so a discount is netted into one line.
  const discounted = lines.some((it) => it.amount < 0);
  const items =
    billed > 0
      ? [{ accountId, amount: Math.max(0, total - billed), memo: `${w.title} (remaining)`, ...where }]
      : discounted
        ? [{ accountId, amount: Math.max(0, total), memo: `${w.title} (parts and labor, net of discounts)`, ...where }]
        : lines.length
          ? lines.filter((it) => it.amount > 0)
          : [{ accountId, amount: 0, memo: w.title, ...where }];
  const m = await txDialogs();
  const bill = await m.billDialog({ vendorId: w.vendorId, propertyId: w.propertyId, unitId: w.unitId || null, workOrderId: w.id, items });
  if (bill?.id) {
    app.store.patch('workOrders', w.id, { billId: bill.id });
    toast(`Bill recorded for WO-${w.number}`);
  }
}

function summaryText(w) {
  const lines = [`Work order WO-${w.number}: ${w.title}`, '', `Location: ${w.unitId ? lookup.unitLabel(w.unitId) : lookup.property(w.propertyId)?.name || ''}`];
  const p = lookup.property(w.propertyId);
  const a = p?.address;
  if (a) lines.push(`Address: ${[a.street, a.city, a.state, a.zip].filter(Boolean).join(', ')}`);
  lines.push(`Priority: ${statusLabel(w.priority || 'normal')}`);
  if (w.dueDate) lines.push(`Due: ${date(w.dueDate)}`);
  lines.push(`Entry: ${ENTRY_LABEL[w.entry || 'allowed']}${w.entryNotes ? ` (${w.entryNotes})` : ''}`);
  if (w.description) lines.push('', w.description);
  if ((w.items || []).length) {
    lines.push('', 'Parts and labor:');
    for (const it of w.items) lines.push(`  ${it.description || 'Item'} x ${it.qty ?? 1}: ${money(Math.round((Number(it.qty) || 0) * (it.amount || 0)))}`);
  }
  return lines.join('\n');
}

function emailVendor(w) {
  const v = lookup.vendor(w.vendorId);
  const c = app.settings().company || {};
  openCompose({
    to: [{ name: displayName(v), email: primaryEmail(v) }],
    subject: `Work order WO-${w.number}: ${w.title}`,
    body: `Hello,\n\nPlease see the work order below.\n\n${summaryText(w)}\n\nThank you,\n${c.name || ''}`.trim(),
    related: { type: 'workOrder', id: w.id },
  });
}

function printWorkOrder(w) {
  const v = lookup.vendor(w.vendorId);
  const items = w.items || [];
  printNode(
    h(
      'div.print-sheet',
      printHeader(`Work order WO-${w.number}`, w.title),
      h(
        'dl.print-kv',
        [
          ['Location', w.unitId ? lookup.unitLabel(w.unitId) : lookup.property(w.propertyId)?.name || ''],
          ['Priority', statusLabel(w.priority || 'normal')],
          ['Due', w.dueDate ? date(w.dueDate) : 'Not set'],
          ['Vendor', v ? displayName(v) : 'Not assigned'],
          ['Entry', `${ENTRY_LABEL[w.entry || 'allowed']}${w.entryNotes ? ` (${w.entryNotes})` : ''}`],
          ['Status', statusLabel(w.status)],
        ].map(([k, val]) => [h('dt', k), h('dd', val)]),
      ),
      w.description ? h('section', h('h2', 'Description'), h('p.pre-wrap', w.description)) : null,
      items.length
        ? h(
            'table.table',
            h('thead', h('tr', h('th', 'Description'), h('th.r', 'Qty'), h('th.r', 'Unit price'), h('th.r', 'Total'))),
            h('tbody', items.map((it) => h('tr', h('td', it.description || 'Item'), h('td.r', String(it.qty ?? 1)), h('td.r', money(it.amount || 0)), h('td.r', money(Math.round((Number(it.qty) || 0) * (it.amount || 0))))))),
            h('tfoot', h('tr', h('td', { colspan: 3 }, 'Total'), h('td.r', money(workOrderTotal(w))))),
          )
        : null,
      h('section.print-sign', h('div', 'Completed by'), h('div', 'Date')),
    ),
    `WO-${w.number} ${w.title}`,
  );
}

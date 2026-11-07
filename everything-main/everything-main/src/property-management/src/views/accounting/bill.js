/** One vendor bill: amounts, lines, payments, linked work order, files. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, card, stat, statusPill, moreButton, dataTable } from '../../ui/components.js';
import { openMenu } from '../../ui/menu.js';
import { billStatus } from '../../core/ledger.js';
import { ACC } from '../../core/accounts.js';
import { displayName, primaryEmail, primaryPhone } from '../../core/format.js';
import { methodLabel } from '../../core/settings.js';
import { attachmentsCard } from '../attachments.js';
import { money, date, kvList } from '../common.js';
import { notFound, voidPill, runTx } from './shared.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;

  const view = ctx.live(() => {
    const bill = store.get('transactions', id);
    if (!bill || bill.kind !== 'bill') return notFound('Bill', { href: '#/bills', label: 'Go to bills' });
    return draw(bill);
  }, ['transactions', 'vendors', 'accounts', 'properties', 'units', 'workOrders']);

  function draw(bill) {
    const ledger = app.ledger();
    const info = ledger.bill(bill.id);
    const status = billStatus(bill, info, app.today());
    const vendor = lookup.vendor(bill.vendorId);
    const items = bill.lines.filter((l) => l.accountId !== ACC.ap);
    const open = !bill.voided && info.balance > 0;

    const actions = [];
    if (!bill.voided)
      actions.push(
        moreButton((btn) =>
          openMenu(btn, [
            { label: 'View journal entry', icon: 'book', href: `#/transactions/${bill.id}` },
            { separator: true },
            { label: 'Void bill', icon: 'ban', danger: true, run: () => runTx('voidTransaction', bill.id) },
          ]),
        ),
        h('button.btn', { type: 'button', onClick: () => runTx('billDialog', { billId: bill.id }) }, icon('pencil', 16), 'Edit'),
      );
    if (open) actions.push(h('button.btn.primary', { type: 'button', onClick: () => runTx('payBillsDialog', { vendorId: bill.vendorId, billIds: [bill.id] }) }, icon('wallet', 16), 'Pay bill'));

    const linesTable = dataTable({
      caption: 'Bill lines',
      rows: items,
      columns: [
        { id: 'acc', label: 'Account', render: (l) => h('span.acct-desc', h('span', lookup.account(l.accountId)?.name || 'Unknown account'), l.memo ? h('span.acct-memo', l.memo) : null) },
        { id: 'prop', label: 'Property', render: (l) => (l.unitId ? h('a', { href: `#/units/${l.unitId}` }, lookup.unitLabel(l.unitId)) : l.propertyId ? h('a', { href: `#/properties/${l.propertyId}` }, lookup.property(l.propertyId)?.name || '') : h('span.subtle', 'Company')) },
        { id: 'amt', label: 'Amount', align: 'r', render: (l) => h('span.num', money(l.amount)) },
      ],
      mobile: (l) => h('div.mobile-row', h('div.grow', h('div.m-title', lookup.account(l.accountId)?.name || ''), h('div.m-sub', l.unitId ? lookup.unitLabel(l.unitId) : lookup.property(l.propertyId)?.name || 'Company')), h('div.m-end', h('span.num', money(l.amount)))),
    });

    const payments = info.payments.filter((p) => !p.voided);
    const paymentsBody = payments.length
      ? h(
          'ul.acct-cash',
          payments.map((p) => {
            const amt = (p.allocations || []).filter((a) => a.billId === bill.id).reduce((s, a) => s + a.amount, 0);
            const meta = [methodLabel(p.method), p.ref].filter(Boolean).join(' \u00b7 ');
            return h('li', h('a', { href: `#/transactions/${p.id}` }, h('span', date(p.date)), meta ? h('span.subtle', ` \u00b7 ${meta}`) : null), h('span.num', money(amt)));
          }),
        )
      : h('div.section-empty', 'No payments yet.', open ? h('button.btn.sm', { type: 'button', onClick: () => runTx('payBillsDialog', { vendorId: bill.vendorId, billIds: [bill.id] }) }, 'Pay now') : null);

    const wo = bill.workOrderId ? store.get('workOrders', bill.workOrderId) : null;

    return h(
      'div.page.acct-page',
      pageHeader({
        title: `Bill from ${displayName(vendor) || 'unknown vendor'}`,
        crumbs: [{ label: 'Bills', href: '#/bills' }],
        subtitle: [bill.memo, bill.ref ? `Ref ${bill.ref}` : null].filter(Boolean).join(' · '),
        after: h('div.row', bill.voided ? voidPill() : statusPill(status)),
        actions,
      }),
      h(
        'div.stats',
        stat({ label: 'Amount', value: money(info.total) }),
        stat({ label: 'Paid', value: money(info.paid) }),
        stat({ label: 'Balance due', value: money(Math.max(0, info.balance)), tone: status === 'overdue' ? 'danger' : null, sub: bill.dueDate ? `Due ${date(bill.dueDate)}` : null }),
      ),
      h(
        'div.detail',
        h(
          'div.detail-main',
          card({ title: 'Details', body: kvList([['Bill date', date(bill.date)], ['Due date', date(bill.dueDate)], ['Reference', bill.ref], ['Memo', bill.memo]]) }),
          card({ title: 'Lines', flush: true, body: linesTable }),
          card({ title: 'Payments', flush: !!payments.length, body: paymentsBody }),
        ),
        h(
          'div.detail-aside',
          card({
            title: 'Vendor',
            body: vendor
              ? h(
                  'div.stack.sm',
                  h('a.primary-link', { href: `#/vendors/${vendor.id}` }, displayName(vendor)),
                  vendor.category ? h('span.subtle', vendor.category) : null,
                  primaryPhone(vendor) ? h('span', primaryPhone(vendor)) : null,
                  primaryEmail(vendor) ? h('a', { href: `mailto:${primaryEmail(vendor)}` }, primaryEmail(vendor)) : null,
                  h('span.subtle', `Owed to this vendor: ${money(ledger.vendorOwed(vendor.id))}`),
                )
              : h('p.subtle', 'This vendor was deleted.'),
          }),
          wo ? card({ title: 'Work order', body: h('a', { href: `#/work-orders/${wo.id}` }, `WO-${wo.number}: ${wo.title}`) }) : null,
          attachmentsCard('transactions', bill, { title: 'Files', folder: 'files/bills' }),
        ),
      ),
    );
  }

  return { node: view, title: 'Bill' };
}

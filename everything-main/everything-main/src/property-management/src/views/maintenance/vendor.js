/** One vendor: contact, compliance, work orders, bills and payments. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, statusPill, emptyState, moreButton, card, dataTable, stat } from '../../ui/components.js';
import { openMenu } from '../../ui/menu.js';
import { navigate } from '../../ui/router.js';
import { toast } from '../../ui/toast.js';
import { money, date, kvList, notesCard, deleteWithUndo, detailTabs, addressBlock, accountName } from '../common.js';
import { attachmentsCard } from '../attachments.js';
import { displayName, secondaryName, telHref, formatAddress } from '../../core/format.js';
import { billStatus, txTotal } from '../../core/ledger.js';
import { isOverdue } from '../../core/status.js';
import { isOpenWorkOrder, txDialogs, openCompose, insuranceState } from './shared.js';
import { priorityTag } from './work-orders.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  let lastTabs = null; // keeps the chosen tab when the page redraws
  const body = ctx.live(() => {
    const v = store.get('vendors', id);
    if (!v) return emptyState({ icon: 'truck', title: 'Vendor not found', headingLevel: 1, text: 'It may have been deleted.', actions: [h('a.btn.primary', { href: '#/vendors' }, 'Back to vendors')] });
    const today = app.today();
    const ledger = app.ledger();
    const owed = ledger.vendorOwed(v.id);
    const workOrders = store.all('workOrders').filter((w) => w.vendorId === v.id);
    const txs = store.all('transactions').filter((t) => t.vendorId === v.id && !t.voided);
    const bills = txs.filter((t) => t.kind === 'bill');
    const payments = txs.filter((t) => t.kind === 'bill-payment' || t.kind === 'expense');
    const yearStart = `${today.slice(0, 4)}-01-01`;
    const paidThisYear = payments.filter((t) => t.date >= yearStart).reduce((s, t) => s + txTotal(t), 0);
    const ins = insuranceState(v, today);

    const recordBill = async () => (await txDialogs()).billDialog({ vendorId: v.id, items: v.accountId ? [{ accountId: v.accountId, amount: 0 }] : undefined });
    const payBills = async () => (await txDialogs()).payBillsDialog({ vendorId: v.id });
    const more = moreButton((btn) =>
      openMenu(btn, [
        { label: 'Edit', icon: 'pencil', href: `#/vendors/${v.id}/edit` },
        { label: 'New work order', icon: 'wrench', href: `#/work-orders/new?vendorId=${v.id}` },
        { label: 'Record bill', icon: 'receipt', run: recordBill },
        { label: 'Record expense', icon: 'wallet', run: async () => (await txDialogs()).expenseDialog({ vendorId: v.id }) },
        (v.emails || [])[0] ? { label: 'Email vendor', icon: 'mail', run: () => openCompose({ to: [{ name: displayName(v), email: v.emails[0] }], subject: '', body: '', related: { type: 'vendor', id: v.id } }) } : null,
        { separator: true },
        v.active === false
          ? { label: 'Mark active', icon: 'check', run: () => (store.patch('vendors', v.id, { active: true }), toast('Vendor is active')) }
          : { label: 'Mark inactive', icon: 'archive', run: () => (store.patch('vendors', v.id, { active: false }), toast('Vendor marked inactive', { action: { label: 'Undo', run: () => store.patch('vendors', v.id, { active: true }) } })) },
        {
          label: 'Delete',
          icon: 'trash',
          danger: true,
          run: () => {
            if (txs.length) {
              toast('This vendor has bills or payments. Mark them inactive instead.', { type: 'error' });
              return;
            }
            deleteWithUndo('vendors', v, { title: `Delete ${displayName(v)}?`, message: 'The vendor and their notes will be removed. Work orders keep their history.', label: 'Vendor deleted', after: () => navigate('/vendors') });
          },
        },
      ]),
    );
    const primary = owed > 0 ? h('button.btn.primary', { type: 'button', onClick: payBills }, icon('wallet', 16), 'Pay bills') : h('button.btn.primary', { type: 'button', onClick: recordBill }, icon('receipt', 16), 'Record bill');

    const tabs = detailTabs(
      { query: { tab: lastTabs ? lastTabs.selected() : ctx.query.tab } },
      [
        { id: 'work', label: 'Work orders', count: workOrders.filter(isOpenWorkOrder).length },
        { id: 'bills', label: 'Bills', count: bills.length },
        { id: 'payments', label: 'Payments', count: payments.length },
        { id: 'notes', label: 'Notes and files' },
      ],
      (tab) => {
        if (tab === 'work') {
          return h(
            'section.card.list-card',
            h('div.card-head', h('h2.grow', 'Work orders'), h('a.btn.sm', { href: `#/work-orders/new?vendorId=${v.id}` }, icon('plus', 14), 'New work order')),
            dataTable({
              caption: 'Work orders',
              rows: workOrders,
              sort: { id: 'due', dir: 'desc' },
              rowHref: (w) => `#/work-orders/${w.id}`,
              columns: [
                { id: 'title', label: 'Work order', cls: 'primary-cell', render: (w) => h('span', h('span.subtle', `WO-${w.number} `), w.title, priorityTag(w.priority)) },
                { id: 'unit', label: 'Unit', render: (w) => (w.unitId ? lookup.unitLabel(w.unitId) : lookup.property(w.propertyId)?.name || '') },
                { id: 'due', label: 'Due', sort: (w) => w.dueDate || '', render: (w) => (w.dueDate ? h(`span${isOverdue(w, today) ? '.overdue' : ''}`, date(w.dueDate)) : h('span.subtle', 'None')) },
                { id: 'status', label: 'Status', render: (w) => statusPill(w.status) },
              ],
              mobile: (w) => h('a.mobile-row', { href: `#/work-orders/${w.id}` }, h('div.grow', { style: { minWidth: '0' } }, h('div.m-title', `WO-${w.number} ${w.title}`), h('div.m-sub', w.unitId ? lookup.unitLabel(w.unitId) : '')), h('div.m-end', statusPill(w.status))),
              empty: emptyState({ compact: true, icon: 'wrench', title: 'No work orders for this vendor', headingLevel: 3 }),
            }),
          );
        }
        if (tab === 'bills') {
          return h(
            'section.card.list-card',
            h('div.card-head', h('h2.grow', 'Bills'), h('button.btn.sm', { type: 'button', onClick: recordBill }, icon('plus', 14), 'Record bill'), owed > 0 ? h('button.btn.sm.primary', { type: 'button', onClick: payBills }, 'Pay bills') : null),
            dataTable({
              caption: 'Bills',
              rows: bills,
              sort: { id: 'date', dir: 'desc' },
              rowHref: (b) => `#/bills/${b.id}`,
              columns: [
                { id: 'date', label: 'Date', sort: (b) => b.date, render: (b) => h('span.nowrap', date(b.date)) },
                { id: 'memo', label: 'Bill', cls: 'primary-cell', render: (b) => h('span', b.memo || 'Bill', b.ref ? h('span.sub', { style: { display: 'block' } }, `Ref ${b.ref}`) : null) },
                { id: 'due', label: 'Due', sort: (b) => b.dueDate || '', render: (b) => h('span.nowrap', date(b.dueDate)) },
                { id: 'total', label: 'Amount', align: 'r', render: (b) => h('span.num', money(ledger.bill(b.id).total)) },
                { id: 'balance', label: 'Unpaid', align: 'r', render: (b) => (ledger.bill(b.id).balance > 0 ? h('span.num', money(ledger.bill(b.id).balance)) : h('span.subtle.num', money(0))) },
                { id: 'status', label: 'Status', render: (b) => statusPill(billStatus(b, ledger.bill(b.id), today)) },
              ],
              mobile: (b) => h('a.mobile-row', { href: `#/bills/${b.id}` }, h('div.grow', { style: { minWidth: '0' } }, h('div.m-title', b.memo || 'Bill'), h('div.m-sub', `${date(b.date)} · due ${date(b.dueDate)}`)), h('div.m-end', h('span.num', money(ledger.bill(b.id).total)), statusPill(billStatus(b, ledger.bill(b.id), today)))),
              empty: emptyState({ compact: true, icon: 'receipt', title: 'No bills from this vendor', headingLevel: 3 }),
            }),
          );
        }
        if (tab === 'payments') {
          return h(
            'section.card.list-card',
            h('div.card-head', h('h2.grow', 'Payments')),
            dataTable({
              caption: 'Payments',
              rows: payments,
              sort: { id: 'date', dir: 'desc' },
              rowHref: (t) => `#/transactions/${t.id}`,
              columns: [
                { id: 'date', label: 'Date', sort: (t) => t.date, render: (t) => h('span.nowrap', date(t.date)) },
                { id: 'kind', label: 'Type', render: (t) => (t.kind === 'expense' ? 'Expense' : 'Bill payment') },
                { id: 'ref', label: 'Reference', render: (t) => t.ref || h('span.subtle', 'None') },
                { id: 'from', label: 'Paid from', render: (t) => accountName(t.bankAccountId) },
                { id: 'amount', label: 'Amount', align: 'r', render: (t) => h('span.num', money(txTotal(t))) },
              ],
              mobile: (t) => h('a.mobile-row', { href: `#/transactions/${t.id}` }, h('div.grow', h('div.m-title', t.kind === 'expense' ? 'Expense' : 'Bill payment'), h('div.m-sub', date(t.date))), h('div.m-end', h('span.num', money(txTotal(t))))),
              empty: emptyState({ compact: true, icon: 'wallet', title: 'No payments yet', headingLevel: 3 }),
            }),
          );
        }
        return h('div.stack', notesCard('vendors', v), attachmentsCard('vendors', v, { title: 'Files', folder: 'files/vendors' }));
      },
      { label: 'Vendor sections' },
    );
    lastTabs = tabs;

    const aside = h(
      'div.detail-aside',
      card({
        title: 'Contact',
        actions: h('a.btn.sm.ghost', { href: `#/vendors/${v.id}/edit` }, icon('pencil', 14), 'Edit'),
        body: kvList([
          ['Contact', secondaryName(v) || null],
          ['Phone', (v.phones || []).length ? h('div.stack.xs', v.phones.map((p) => h('a', { href: telHref(p) }, p))) : null],
          ['Email', (v.emails || []).length ? h('div.stack.xs', v.emails.map((e) => h('a.truncate', { href: `mailto:${e}` }, e))) : null],
          ['Website', v.website ? h('a', { href: /^https?:/i.test(v.website) ? v.website : `https://${v.website}`, target: '_blank', rel: 'noopener noreferrer' }, v.website.replace(/^https?:\/\//i, '')) : null],
          ['Address', formatAddress(v.address) ? addressBlock(v.address) : null],
        ]),
      }),
      card({
        title: 'Accounting',
        body: kvList([
          ['Category', v.category || 'None'],
          ['Default account', v.accountId ? accountName(v.accountId) : 'None'],
          ['Insurance', v.insuranceExpires ? h(`span${ins ? '.overdue' : ''}`, ins === 'expired' ? `Expired ${date(v.insuranceExpires)}` : `Expires ${date(v.insuranceExpires)}`) : 'Not on file'],
        ]),
      }),
    );

    return h(
      'div',
      pageHeader({
        title: displayName(v),
        crumbs: [{ label: 'Vendors', href: '#/vendors' }],
        after: h('div.row.header-pills', v.category ? h('span.pill.plain', v.category) : null, v.active === false ? h('span.pill', 'Inactive') : null),
        actions: [more, primary],
      }),
      ins ? h(`div.notice.${ins === 'expired' ? 'danger' : 'warning'}`, icon('shield'), h('span', ins === 'expired' ? `The insurance certificate expired on ${date(v.insuranceExpires)}. Ask for an updated certificate before assigning new work.` : `The insurance certificate expires on ${date(v.insuranceExpires)}.`)) : null,
      h(
        'div.stats.list-stats',
        stat({ label: 'Owed', value: money(owed), sub: owed ? 'Unpaid bills' : 'All paid', tone: owed ? 'warning' : null }),
        stat({ label: 'Paid this year', value: money(paidThisYear), sub: `Since ${date(yearStart, { month: 'short', day: 'numeric' })}` }),
        stat({ label: 'Open work orders', value: String(workOrders.filter(isOpenWorkOrder).length), sub: `${workOrders.length} in total` }),
      ),
      h('div.detail', h('div.detail-main', tabs.node), aside),
    );
  }, ['vendors', 'workOrders', 'transactions']);
  return { node: h('div.page', body), title: displayName(store.get('vendors', id)) || 'Vendor' };
}

/** One transaction: summary, journal lines, related records, files. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, card, moreButton, statusPill } from '../../ui/components.js';
import { openMenu } from '../../ui/menu.js';
import { methodLabel } from '../../core/settings.js';
import { accountLabel } from '../../core/accounts.js';
import { billStatus } from '../../core/ledger.js';
import { attachmentsCard } from '../attachments.js';
import { money, date, kvList, leaseLink, vendorLink, ownerLink, propertyLink, unitLink } from '../common.js';
import { kindLabel, txTotal, txParty, voidPill, notFound, runTx } from './shared.js';

const RECEIPT_KINDS = new Set(['payment']);

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;

  const view = ctx.live(() => {
    const tx = store.get('transactions', id);
    if (!tx) return notFound('Transaction', { href: '#/ledger', label: 'Go to the general ledger' });
    return draw(tx);
  }, ['transactions', 'accounts', 'leases', 'tenants', 'vendors', 'owners', 'properties', 'units', 'workOrders']);

  function draw(tx) {
    const total = txTotal(tx);
    const party = txParty(tx);
    const actions = [];
    if (!tx.voided && RECEIPT_KINDS.has(tx.kind)) actions.push(h('button.btn', { type: 'button', onClick: () => runTx('printReceipt', tx.id) }, icon('printer', 16), 'Print receipt'));
    if (tx.kind === 'bill') actions.push(h('a.btn', { href: `#/bills/${tx.id}` }, 'Open bill'));
    if (!tx.voided && !tx.auto) actions.push(h('button.btn.primary', { type: 'button', onClick: () => runTx('editTransaction', tx.id) }, icon('pencil', 16), 'Edit'));
    if (!tx.voided)
      actions.unshift(
        moreButton((btn) =>
          openMenu(btn, [
            tx.auto ? { label: 'Edit', icon: 'pencil', run: () => runTx('editTransaction', tx.id) } : null,
            { label: 'Void transaction', icon: 'ban', danger: true, run: () => runTx('voidTransaction', tx.id) },
          ]),
        ),
      );

    const summary = kvList([
      ['Type', kindLabel(tx.kind)],
      ['Date', date(tx.date)],
      tx.dueDate && tx.kind === 'bill' ? ['Due', date(tx.dueDate)] : null,
      ['Amount', h('span.num', money(total))],
      party ? [tx.kind === 'bill' || tx.kind === 'bill-payment' || tx.kind === 'expense' ? 'Paid to' : tx.kind === 'payment' ? 'Received from' : 'With', party] : null,
      tx.payer ? ['Paid by', tx.payer] : null,
      tx.method ? ['Method', methodLabel(tx.method) || tx.method] : null,
      tx.bankAccountId ? ['Bank account', lookup.account(tx.bankAccountId)?.name || ''] : null,
      tx.ref ? ['Reference', tx.ref] : null,
      tx.memo ? ['Memo', tx.memo] : null,
      tx.auto ? ['Posted by', 'Posted automatically from the lease'] : null,
      tx.createdAt ? ['Recorded', new Date(tx.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })] : null,
    ]);

    let debit = 0;
    let credit = 0;
    const lines = h(
      'div.table-wrap',
      { tabindex: '0', role: 'region', 'aria-label': 'Journal lines' },
      h(
        'table.table.acct-lines',
        h('caption.sr-only', 'Journal lines'),
        h('thead', h('tr', h('th', { scope: 'col' }, 'Account'), h('th', { scope: 'col' }, 'Property'), h('th.r', { scope: 'col' }, 'Debit'), h('th.r', { scope: 'col' }, 'Credit'))),
        h(
          'tbody',
          tx.lines.map((l) => {
            if (l.amount > 0) debit += l.amount;
            else credit -= l.amount;
            const a = lookup.account(l.accountId);
            const forAcc = l.forAccountId ? lookup.account(l.forAccountId) : null;
            return h(
              'tr',
              h('td', a ? h('a', { href: `#/accounts/${a.id}` }, accountLabel(a)) : 'Unknown account', forAcc ? h('div.subtle.acct-small', `For ${forAcc.name}`) : null, l.memo ? h('div.subtle.acct-small', l.memo) : null),
              h('td', l.unitId ? lookup.unitLabel(l.unitId) : l.propertyId ? lookup.property(l.propertyId)?.name || '' : h('span.subtle', 'Company')),
              h('td.r', l.amount > 0 ? h('span.num', money(l.amount)) : ''),
              h('td.r', l.amount < 0 ? h('span.num', money(-l.amount)) : ''),
            );
          }),
        ),
        h('tfoot', h('tr', h('th', { scope: 'row', colspan: 2 }, 'Total'), h('td.r', h('span.num.strong', money(debit))), h('td.r', h('span.num.strong', money(credit))))),
      ),
    );

    return h(
      'div.page.acct-page',
      pageHeader({
        title: `${kindLabel(tx.kind)} ${money(total)}`,
        crumbs: [{ label: 'General ledger', href: '#/ledger' }],
        subtitle: [date(tx.date), party].filter(Boolean).join(' · '),
        after: tx.voided ? h('div.row', voidPill()) : null,
        actions,
      }),
      tx.voided ? h('div.notice.warning', { role: 'note' }, icon('ban'), h('span', 'This transaction was voided. It stays on record but does not affect any balance.')) : null,
      h(
        'div.detail',
        h('div.detail-main', card({ title: 'Details', body: summary }), card({ title: 'Journal', flush: true, body: lines })),
        h('div.detail-aside', related(tx), attachmentsCard('transactions', tx, { title: 'Files', folder: 'files/transactions' })),
      ),
    );
  }

  return { node: view, title: 'Transaction' };
}

function related(tx) {
  const store = app.store;
  const items = [];
  if (tx.leaseId) items.push(['Lease', leaseLink(lookup.lease(tx.leaseId))]);
  if (tx.propertyId) items.push(['Property', propertyLink(tx.propertyId)]);
  if (tx.unitId) items.push(['Unit', unitLink(tx.unitId)]);
  if (tx.vendorId) items.push(['Vendor', vendorLink(tx.vendorId)]);
  if (tx.ownerId) items.push(['Owner', ownerLink(tx.ownerId)]);
  if (tx.workOrderId) {
    const wo = store.get('workOrders', tx.workOrderId);
    items.push(['Work order', wo ? h('a', { href: `#/work-orders/${wo.id}` }, `WO-${wo.number}: ${wo.title}`) : h('span.subtle', 'Deleted')]);
  }
  const ledger = app.ledger();
  if (tx.kind === 'bill') {
    const info = ledger.bill(tx.id);
    items.push(['Status', statusPill(billStatus(tx, info, app.today()))]);
    items.push(['Balance due', h('span.num', money(info.balance))]);
  }
  const billLinks = (tx.allocations || [])
    .map((a) => {
      const bill = store.get('transactions', a.billId);
      return bill ? h('li', h('a', { href: `#/bills/${bill.id}` }, bill.memo || bill.ref || 'Bill'), h('span.num', money(a.amount))) : null;
    })
    .filter(Boolean);
  const payments = tx.kind === 'bill' ? ledger.bill(tx.id).payments : [];
  return card({
    title: 'Related',
    body: h(
      'div.stack',
      items.length ? kvList(items) : h('p.subtle', 'Not linked to a lease, vendor or owner.'),
      billLinks.length ? h('div', h('h3.acct-subhead', 'Bills paid'), h('ul.acct-cash', billLinks)) : null,
      payments.length
        ? h(
            'div',
            h('h3.acct-subhead', 'Payments'),
            h(
              'ul.acct-cash',
              payments.map((p) => h('li', h('a', { href: `#/transactions/${p.id}` }, date(p.date), p.ref ? ` · ${p.ref}` : ''), h('span.num', money((p.allocations || []).filter((a) => a.billId === tx.id).reduce((s, a) => s + a.amount, 0))))),
            ),
          )
        : null,
    ),
  });
}

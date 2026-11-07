/** One lease: terms, money, ledger, tenants, notes and files. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, card, emptyState, statusPill, moreButton, field, textInput, textarea, select, moneyInput, segmented } from '../../ui/components.js';
import { openMenu } from '../../ui/menu.js';
import { openDialog, confirmDialog, formDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { navigate } from '../../ui/router.js';
import { ACC, chargeableAccounts } from '../../core/accounts.js';
import { kindLabel } from '../../core/ledger.js';
import { leaseStatus, daysLeft, effectiveEnd, monthlyRent, renewalStatus, newRecurring, tenantName } from '../../core/leases.js';
import { leaseTypeLabel } from '../../core/settings.js';
import { addDays, addMonths } from '../../core/dates.js';
import { primaryEmail, primaryPhone, telHref, formatAddress } from '../../core/format.js';
import { attachmentsCard } from '../attachments.js';
import { money, moneyCell, balanceCell, date, kvList, detailTabs, notesCard, tenantPicker, accountSelect, exportCSV, csvMoney, personAvatar, sectionEmpty } from '../common.js';
import { ledgerRows, accountSummary } from '../transactions/logic.js';
import { termText } from './list.js';

const tx = () => import('../transactions/dialogs.js');
const accName = (id) => lookup.account(id)?.name || 'Unknown account';
function ordinal(n) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
}

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  const prefs = { ledgerView: 'date', newestFirst: false, showVoided: false };
  // The selected tab survives redraws (ctx.query only reflects the first load).
  let tabsNode = null;

  const body = ctx.live(() => {
    const lease = store.get('leases', id);
    if (!lease) {
      return h('div.page', emptyState({ icon: 'file-signature', title: 'Lease not found', headingLevel: 1, text: 'It may have been deleted.', actions: [h('a.btn.primary', { href: '#/leases' }, 'Back to rent roll')] }));
    }
    const today = app.today();
    const status = leaseStatus(lease, today);
    const info = app.ledger().lease(lease.id);
    const label = lookup.leaseLabel(lease);

    const actions = [
      moreButton((btn) => openMenu(btn, menuItems(lease, info, status))),
      h('button.btn', { type: 'button', onClick: () => tx().then((m) => m.chargeDialog({ leaseId: lease.id })) }, icon('receipt-text', 16), h('span.hide-mobile', 'Enter charge')),
      lease.draft
        ? h('a.btn.primary', { href: `#/leases/${lease.id}/edit` }, icon('check', 16), 'Finish and activate')
        : h('button.btn.primary', { type: 'button', onClick: () => tx().then((m) => m.receivePaymentDialog({ leaseId: lease.id })) }, icon('hand-coins', 16), 'Receive payment'),
    ];

    const header = pageHeader({
      title: label,
      crumbs: [{ label: 'Rent roll', href: '#/leases' }, { label: lease.number ? `Lease ${lease.number}` : 'Lease' }],
      subtitle: h('span.ls-subtitle', statusPill(status), lease.evictionPending ? statusPill('eviction') : null, h('span', lookup.tenantNames(lease) || 'No tenants'), h('span.subtle', `${leaseTypeLabel(lease.type)}, ${termText(lease)}`)),
      actions,
    });

    const left = daysLeft(lease, today);
    const glance = h(
      'section.ls-glance',
      { 'aria-label': 'Lease at a glance' },
      glanceItem(info.balance < 0 ? 'Credit' : 'Balance due', h(`span${info.balance > 0 ? '.owed' : info.balance < 0 ? '.credit' : ''}`, money(Math.abs(info.balance)))),
      glanceItem('Monthly rent', money(monthlyRent(lease, today))),
      glanceItem('Deposits held', money(info.deposits)),
      glanceItem('Last payment', info.lastPayment ? `${money(info.lastPayment.lines.find((l) => l.amount > 0)?.amount || 0)} on ${date(info.lastPayment.date, { month: 'short', day: 'numeric' })}` : 'None'),
      glanceItem(lease.moveOut?.date ? 'Moving out' : 'Term ends', lease.moveOut?.date ? date(lease.moveOut.date) : left !== null ? `${date(lease.end)} (${left} days)` : lease.type === 'at-will' ? 'Month to month' : lease.end ? date(lease.end) : 'Open'),
    );

    const tabCtx = { ...ctx, query: { ...ctx.query, tab: tabsNode ? tabsNode.selected() : ctx.query.tab } };
    tabsNode = detailTabs(tabCtx, [
      { id: 'summary', label: 'Summary' },
      { id: 'ledger', label: 'Ledger' },
      { id: 'tenants', label: 'Tenants', count: (lease.tenantIds || []).length },
      { id: 'notes', label: 'Notes', count: Array.isArray(lease.notes) ? lease.notes.length : undefined },
      { id: 'files', label: 'Files', count: (lease.attachments || []).length || undefined },
    ], (tab) => {
      const current = store.get('leases', id) || lease;
      if (tab === 'ledger') return ledgerTab(current);
      if (tab === 'tenants') return tenantsTab(current);
      if (tab === 'notes') return h('div.ls-tab-narrow', notesCard('leases', current));
      if (tab === 'files') return h('div.ls-tab-narrow', attachmentsCard('leases', current, { folder: 'leases' }));
      return summaryTab(current, info, status);
    }, { label: 'Lease sections' });

    return h('div.page', header, lease.draft ? h('div.notice.accent', icon('info', 16), h('span', 'This lease is a draft. No charges are posted until you finish and activate it.')) : null, glance, tabsNode.node);
  }, ['leases', 'transactions', 'tenants', 'units', 'properties', 'accounts', 'settings']);

  // ---- Summary ----------------------------------------------------------------

  function summaryTab(lease, info, status) {
    const unit = lookup.unit(lease.unitId);
    const property = lookup.property(lease.propertyId);
    const terms = card({
      title: 'Lease terms',
      actions: h('a.btn.ghost.sm', { href: `#/leases/${lease.id}/edit` }, icon('pencil', 14), 'Edit'),
      body: kvList([
        ['Property', property ? h('a', { href: `#/properties/${property.id}` }, property.name) : null],
        ['Unit', unit && !property?.singleUnit ? h('a', { href: `#/units/${unit.id}` }, unit.name) : null],
        ['Lease number', lease.number ? String(lease.number) : null],
        ['Type', leaseTypeLabel(lease.type)],
        ['Start', date(lease.start)],
        ['End', lease.type === 'at-will' ? 'Month to month' : lease.end ? date(lease.end) : null],
        ['Signed on', lease.signedOn ? date(lease.signedOn) : null],
        ['Security deposit', lease.deposit ? money(lease.deposit) : null],
        ['Move-out', lease.moveOut?.date ? `${date(lease.moveOut.date)}${lease.moveOut.reason ? `, ${lease.moveOut.reason}` : ''}` : null],
        ['Notice given', lease.moveOut?.noticeDate ? date(lease.moveOut.noticeDate) : null],
        ['Forwarding address', lease.moveOut?.forwardingAddress || null],
      ]),
    });

    const recurring = lease.recurring || [];
    const recurringCard = card({
      title: 'Recurring charges',
      count: recurring.length,
      actions: lease.draft || status === 'past' ? null : h('button.btn.ghost.sm', { type: 'button', onClick: () => recurringDialog(lease) }, icon('plus', 14), 'Add'),
      flush: true,
      body: recurring.length
        ? h(
            'ul.ls-recurring',
            recurring.map((r) => {
              const ended = r.end && r.end < app.today();
              return h(
                'li',
                h(
                  'div.grow',
                  h('div.ls-rec-title', r.memo || accName(r.accountId), ended ? h('span.pill.plain', 'Ended') : null),
                  h('div.subtle', `${accName(r.accountId)}, due on the ${ordinal(r.day || 1)}${r.start ? `, from ${date(r.start)}` : ''}${r.end ? ` to ${date(r.end)}` : ''}`),
                  r.postedThrough ? h('div.subtle.ls-small', `Charged through ${date(r.postedThrough)}`) : null,
                ),
                h('strong.num', money(r.amount)),
                lease.draft
                  ? null
                  : moreButton(
                      (btn) =>
                        openMenu(btn, [
                          { label: 'Edit', icon: 'pencil', run: () => recurringDialog(lease, r) },
                          !ended ? { label: 'Stop charging', icon: 'ban', run: () => stopRecurring(lease, r) } : null,
                          !r.postedThrough ? { label: 'Remove', icon: 'trash', danger: true, run: () => removeRecurring(lease, r) } : null,
                        ]),
                      `Actions for ${r.memo || accName(r.accountId)}`,
                    ),
              );
            }),
          )
        : sectionEmpty('No recurring charges.'),
    });

    const moneyCard = card({
      title: 'Account',
      body: h(
        'div.stack',
        kvList([
          [info.balance < 0 ? 'Credit' : 'Balance due', balanceCell(info.balance)],
          ['Prepaid credit', info.prepaid ? money(info.prepaid) : null],
          ['Security deposits held', money(info.deposits)],
          ['Total charged', money(info.charged)],
          ['Total paid', money(info.paid)],
        ]),
        h(
          'div.ls-quick',
          h('button.btn.sm', { type: 'button', onClick: () => tx().then((m) => m.receivePaymentDialog({ leaseId: lease.id })) }, 'Receive payment'),
          h('button.btn.sm', { type: 'button', onClick: () => tx().then((m) => m.creditDialog({ leaseId: lease.id })) }, 'Issue credit'),
          info.deposits ? h('button.btn.sm', { type: 'button', onClick: () => tx().then((m) => m.applyDepositDialog({ leaseId: lease.id })) }, 'Apply deposit') : null,
          info.prepaid || info.deposits ? h('button.btn.sm', { type: 'button', onClick: () => tx().then((m) => m.refundDialog({ leaseId: lease.id })) }, 'Refund') : null,
        ),
      ),
    });

    const tenants = lookup.tenants(lease.tenantIds);
    const tenantsCard = card({
      title: 'Tenants',
      count: tenants.length,
      flush: true,
      body: tenants.length
        ? h(
            'ul.ls-people',
            tenants.map((t) =>
              h(
                'li',
                personAvatar(t),
                h('div.grow', { style: { minWidth: '0' } }, h('a.ls-person-name', { href: `#/tenants/${t.id}` }, tenantName(t)), primaryPhone(t) ? h('a.subtle.ls-contact', { href: telHref(primaryPhone(t)) }, primaryPhone(t)) : null, primaryEmail(t) ? h('a.subtle.ls-contact', { href: `mailto:${primaryEmail(t)}` }, primaryEmail(t)) : null),
              ),
            ),
          )
        : sectionEmpty('No tenants on this lease.', h('button.btn.sm', { type: 'button', onClick: () => goTab('tenants') }, 'Add tenant')),
    });

    const settings = app.settings();
    const policy = lease.lateFee?.enabled === false ? null : { ...settings.lateFee, ...(lease.lateFee || {}) };
    const customFee = lease.lateFee && Object.keys(lease.lateFee).some((k) => k !== 'enabled');
    const lateCard = card({
      title: 'Late fees',
      actions: h('button.btn.ghost.sm', { type: 'button', onClick: () => lateFeeDialog(lease) }, icon('pencil', 14), 'Change'),
      body: policy?.enabled
        ? h('p.ls-policy', `${policy.kind === 'percent' ? `${policy.percent}% of rent` : money(policy.amount)} when rent is unpaid ${policy.graceDays} ${policy.graceDays === 1 ? 'day' : 'days'} after it is due.`, h('span.subtle', customFee ? ' Custom for this lease.' : ' Company policy.'))
        : h('p.subtle', 'No late fees are charged on this lease.'),
    });

    return h('div.detail', h('div.detail-main', terms, recurringCard, renewalCard(lease, status), lateCard), h('div.detail-aside', moneyCard, tenantsCard));
  }

  function renewalCard(lease, status) {
    if (lease.draft || status === 'past' || lease.type === 'at-will' || !lease.end || lease.moveOut?.date) return null;
    const renewal = lease.renewal || {};
    const st = renewalStatus(lease);
    const renewedBy = store.all('leases').find((l) => l.renewsLeaseId === lease.id);
    const left = daysLeft(lease, app.today());
    let content;
    if (renewedBy) {
      content = h('div.stack', h('p', 'This lease has been renewed.'), h('a.btn.sm', { href: `#/leases/${renewedBy.id}` }, 'Open the renewal lease'));
    } else if (st === 'offered') {
      content = h(
        'div.stack',
        kvList([
          ['Offered rent', renewal.offerRent ? money(renewal.offerRent) : null],
          ['New end date', renewal.offerEnd ? date(renewal.offerEnd) : null],
          ['Sent', renewal.offeredOn ? date(renewal.offeredOn) : null],
          ['Notes', renewal.notes || null],
        ]),
        h(
          'div.ls-quick',
          h('a.btn.sm.primary', { href: `#/leases/new?renews=${lease.id}` }, 'Tenant accepted'),
          h('button.btn.sm', { type: 'button', onClick: () => declineRenewal(lease) }, 'Tenant is moving out'),
          h('button.btn.sm.ghost', { type: 'button', onClick: () => offerDialog(lease) }, 'Change offer'),
        ),
      );
    } else if (st === 'declined') {
      content = h('div.stack', h('p', 'The tenant does not plan to renew.', renewal.notes ? h('span.subtle', ` ${renewal.notes}`) : null), h('div.ls-quick', h('button.btn.sm.primary', { type: 'button', onClick: () => moveOutDialog(lease) }, 'Record move-out'), h('button.btn.sm', { type: 'button', onClick: () => offerDialog(lease) }, 'Send an offer instead')));
    } else {
      content = h(
        'div.stack',
        h('p', left !== null ? `The term ends in ${left} ${left === 1 ? 'day' : 'days'}. ` : 'The fixed term has ended. ', lease.type === 'fixed-rollover' ? 'After that it continues month to month.' : 'After that the lease ends.'),
        h('div.ls-quick', h('button.btn.sm.primary', { type: 'button', onClick: () => offerDialog(lease) }, icon('send', 14), 'Send renewal offer'), h('a.btn.sm', { href: `#/leases/new?renews=${lease.id}` }, 'Renew now'), h('button.btn.sm.ghost', { type: 'button', onClick: () => declineRenewal(lease) }, 'Not renewing')),
      );
    }
    return card({ title: 'Renewal', actions: renewedBy ? null : statusPill(st), body: content });
  }

  // ---- Ledger ---------------------------------------------------------------------

  function ledgerTab(lease) {
    const all = store.all('transactions');
    const rows = ledgerRows(all, lease.id).filter((r) => prefs.showVoided || !r.tx.voided);
    const view = segmented({
      label: 'Ledger view',
      value: prefs.ledgerView,
      items: [
        { value: 'date', label: 'By date' },
        { value: 'account', label: 'By account' },
      ],
      onChange: (v) => ((prefs.ledgerView = v), redrawTab()),
    });
    const tools = h(
      'div.ls-ledger-tools',
      view,
      h('div.grow'),
      prefs.ledgerView === 'date'
        ? [
            h('label.check', h('input', { type: 'checkbox', checked: prefs.newestFirst, onChange: (e) => ((prefs.newestFirst = e.target.checked), redrawTab()) }), 'Newest first'),
            h('label.check', h('input', { type: 'checkbox', checked: prefs.showVoided, onChange: (e) => ((prefs.showVoided = e.target.checked), redrawTab()) }), 'Show voided'),
          ]
        : null,
      moreButton((btn) =>
        openMenu(btn, [
          { label: 'Export to CSV', icon: 'file-down', run: () => exportLedger(lease, rows) },
          { label: 'Print statement', icon: 'printer', run: () => printStatement(lease) },
        ]),
      ),
    );
    if (prefs.ledgerView === 'account') {
      const sum = accountSummary(all, lease.id).sort((a, b) => b.balance - a.balance);
      const info = app.ledger().lease(lease.id);
      return h(
        'section.card.list-card',
        { 'aria-label': 'Balance by account' },
        h('div.toolbar', tools),
        sum.length
          ? h(
              'div.table-wrap',
              h(
                'table.table',
                h('caption.sr-only', 'Balance by account'),
                h('thead', h('tr', h('th', { scope: 'col' }, 'Account'), h('th.r', { scope: 'col' }, 'Charged'), h('th.r', { scope: 'col' }, 'Paid or credited'), h('th.r', { scope: 'col' }, 'Balance'))),
                h(
                  'tbody',
                  sum.map((r) => h('tr', h('td', accName(r.accountId)), h('td.r', moneyCell(r.charged)), h('td.r', moneyCell(r.paid)), h('td.r', balanceCell(r.balance)))),
                  info.prepaid ? h('tr', h('td', 'Prepaid credit'), h('td.r'), h('td.r', moneyCell(info.prepaid)), h('td.r', balanceCell(-info.prepaid))) : null,
                ),
                h('tfoot', h('tr', h('th', { scope: 'row' }, 'Total'), h('td.r'), h('td.r'), h('td.r', balanceCell(info.balance)))),
              ),
            )
          : sectionEmpty('Nothing has been charged yet.'),
      );
    }
    const shown = prefs.newestFirst ? [...rows].reverse() : rows;
    return h(
      'section.card.list-card',
      { 'aria-label': 'Lease ledger' },
      h('div.toolbar', tools),
      rows.length
        ? h(
            'div.table-wrap',
            { tabindex: '0', role: 'region', 'aria-label': 'Lease ledger' },
            h(
              'table.table.ls-ledger',
              h('caption.sr-only', 'Lease ledger'),
              h('thead', h('tr', h('th', { scope: 'col' }, 'Date'), h('th', { scope: 'col' }, 'Transaction'), h('th.hide-mobile', { scope: 'col' }, 'Account'), h('th.r', { scope: 'col' }, 'Charges'), h('th.r', { scope: 'col' }, 'Payments'), h('th.r', { scope: 'col' }, 'Balance'), h('th', h('span.sr-only', 'Actions')))),
              h('tbody', shown.map((r) => ledgerRow(r))),
            ),
          )
        : emptyState({ compact: true, icon: 'receipt-text', title: 'No transactions yet', text: lease.draft ? 'Charges are posted when the lease is activated.' : 'Charges and payments for this lease will appear here.', headingLevel: 3 }),
    );
  }

  function ledgerRow({ tx: t, charge, credit, balance }) {
    const accounts = [...new Set(t.lines.filter((l) => l.leaseId && l.accountId === ACC.ar).map((l) => accName(l.forAccountId)))];
    if (!accounts.length && t.lines.some((l) => l.accountId === ACC.prepaid)) accounts.push('Prepayment');
    const title = h('a', { href: `#/transactions/${t.id}` }, kindLabel(t.kind));
    return h(
      `tr${t.voided ? '.ls-void' : ''}`,
      h('td.nowrap', date(t.date)),
      h('td', h('div.ls-tx-title', title, t.voided ? h('span.pill.plain', 'Void') : null, t.auto ? h('span.ls-auto', { title: 'Posted automatically' }, icon('repeat', 12)) : null), h('div.sub', [t.memo, t.ref ? `Ref ${t.ref}` : ''].filter(Boolean).join(' · '))),
      h('td.hide-mobile.sub', accounts.join(', ')),
      h('td.r', charge ? h('span.num', money(charge)) : null),
      h('td.r', credit ? h('span.num', money(credit)) : null),
      h('td.r', balanceCell(balance)),
      h(
        'td.r',
        moreButton(
          (btn) =>
            openMenu(btn, [
              { label: 'Open', icon: 'external', href: `#/transactions/${t.id}` },
              !t.voided ? { label: 'Edit', icon: 'pencil', run: () => tx().then((m) => m.editTransaction(t.id)) } : null,
              t.kind === 'payment' ? { label: 'Print receipt', icon: 'printer', run: () => tx().then((m) => m.printReceipt(t.id)) } : null,
              t.kind === 'payment' ? { label: 'Email receipt', icon: 'mail', run: () => tx().then((m) => m.emailReceipt(t.id)) } : null,
              { separator: true },
              { label: t.voided ? 'Restore' : 'Void', icon: t.voided ? 'undo' : 'ban', danger: !t.voided, run: () => tx().then((m) => m.voidTransaction(t.id)) },
            ]),
          `Actions for ${kindLabel(t.kind)} on ${date(t.date)}`,
        ),
      ),
    );
  }

  function exportLedger(lease, rows) {
    exportCSV(`lease-ledger-${lease.number || lease.id}`, [
      { label: 'Date', value: (r) => r.tx.date },
      { label: 'Type', value: (r) => kindLabel(r.tx.kind) },
      { label: 'Memo', value: (r) => r.tx.memo || '' },
      { label: 'Reference', value: (r) => r.tx.ref || '' },
      { label: 'Void', value: (r) => (r.tx.voided ? 'Yes' : '') },
      { label: 'Charges', value: (r) => (r.charge ? csvMoney(r.charge) : '') },
      { label: 'Payments and credits', value: (r) => (r.credit ? csvMoney(r.credit) : '') },
      { label: 'Balance', value: (r) => csvMoney(r.balance) },
    ], rows);
  }

  async function printStatement(lease) {
    const m = await tx();
    const s = app.settings();
    const rows = ledgerRows(store.all('transactions'), lease.id).filter((r) => !r.tx.voided);
    const bal = rows.length ? rows[rows.length - 1].balance : 0;
    const property = lookup.property(lease.propertyId);
    m.printNode(
      h(
        'article.receipt.ls-statement',
        h('header.receipt-head', h('div', h('div.receipt-company', s.company?.name || 'Property Management'), s.company?.address ? h('div.receipt-small', { style: { whiteSpace: 'pre-line' } }, s.company.address) : null), h('div.receipt-title', h('div', 'Tenant statement'), h('div.receipt-small', `As of ${date(app.today(), { month: 'long', day: 'numeric', year: 'numeric' })}`))),
        h('dl.receipt-meta', h('dt', 'Tenants'), h('dd', lookup.tenantNames(lease) || ''), h('dt', 'Property'), h('dd', lookup.leaseLabel(lease)), property?.address ? [h('dt', 'Address'), h('dd', formatAddress(property.address))] : null),
        h(
          'table.receipt-lines',
          h('thead', h('tr', h('th', 'Date'), h('th', 'Description'), h('th.r', 'Charges'), h('th.r', 'Payments'), h('th.r', 'Balance'))),
          h('tbody', rows.map((r) => h('tr', h('td', date(r.tx.date)), h('td', [kindLabel(r.tx.kind), r.tx.memo].filter(Boolean).join(': ')), h('td.r', r.charge ? money(r.charge) : ''), h('td.r', r.credit ? money(r.credit) : ''), h('td.r', money(r.balance))))),
        ),
        h('div.receipt-amount', h('span', bal < 0 ? 'Credit balance' : 'Balance due'), h('strong', money(Math.abs(bal)))),
        s.receipts?.footer ? h('footer.receipt-foot', s.receipts.footer) : null,
      ),
      `Statement ${lookup.leaseLabel(lease)}`,
    );
  }

  // ---- Tenants ----------------------------------------------------------------------

  function tenantsTab(lease) {
    const tenants = lookup.tenants(lease.tenantIds);
    const picker = tenantPicker({
      exclude: lease.tenantIds || [],
      placeholder: 'Add an existing tenant',
      onSelect: (t) => {
        store.patch('leases', lease.id, (l) => ((l.tenantIds = [...new Set([...(l.tenantIds || []), t.id])]), l));
        toast(`${tenantName(t)} added to the lease`);
      },
      onCreate: (q) => navigate(`/tenants/new?leaseId=${lease.id}${q ? `&name=${encodeURIComponent(q)}` : ''}`),
    });
    return h(
      'div.stack',
      h('section.card', h('div.card-head', h('h2.grow', 'Add a tenant')), h('div.card-body', picker)),
      tenants.length
        ? h(
            'div.ls-tenant-grid',
            tenants.map((t) =>
              h(
                'section.card.ls-tenant',
                h(
                  'div.card-body',
                  h('div.row', personAvatar(t, { size: 'lg' }), h('div.grow', { style: { minWidth: '0' } }, h('a.ls-person-name', { href: `#/tenants/${t.id}` }, tenantName(t)), t.company && t.firstName ? h('div.subtle', t.company) : null)),
                  kvList([
                    ['Phone', (t.phones || []).length ? h('span.stack.sm', t.phones.map((p) => h('a', { href: telHref(p) }, p))) : null],
                    ['Email', (t.emails || []).length ? h('span.stack.sm', t.emails.map((e) => h('a', { href: `mailto:${e}` }, e))) : null],
                    ['Emergency contact', t.emergency?.name ? `${t.emergency.name}${t.emergency.relation ? ` (${t.emergency.relation})` : ''}${t.emergency.phone ? `, ${t.emergency.phone}` : ''}` : null],
                  ]),
                  h(
                    'div.ls-quick',
                    h('a.btn.sm', { href: `#/tenants/${t.id}` }, 'Open'),
                    (lease.tenantIds || []).length > 1
                      ? h(
                          'button.btn.sm.ghost',
                          {
                            type: 'button',
                            onClick: async () => {
                              const ok = await confirmDialog({ title: `Remove ${tenantName(t)} from this lease?`, message: 'The tenant record is kept. Their name is removed from this lease.', confirmLabel: 'Remove' });
                              if (ok) store.patch('leases', lease.id, (l) => ((l.tenantIds = l.tenantIds.filter((x) => x !== t.id)), l));
                            },
                          },
                          'Remove from lease',
                        )
                      : null,
                  ),
                ),
              ),
            ),
          )
        : emptyState({ compact: true, icon: 'users', title: 'No tenants on this lease', text: 'Add the people who live here and are responsible for rent.', headingLevel: 3 }),
    );
  }

  // ---- Actions -----------------------------------------------------------------------

  function goTab(id) {
    navigate(`/leases/${ctx.params.id}${id === 'summary' ? '' : `?tab=${id}`}`, { replace: true });
  }

  function redrawTab() {
    body.redraw();
  }

  function menuItems(lease, info, status) {
    const hasTx = store.all('transactions').some((t) => t.leaseId === lease.id);
    return [
      { label: 'Issue credit', icon: 'receipt', run: () => tx().then((m) => m.creditDialog({ leaseId: lease.id })) },
      { label: 'Refund', icon: 'arrow-up-right', disabled: !(info.prepaid || info.deposits), run: () => tx().then((m) => m.refundDialog({ leaseId: lease.id })) },
      { label: 'Apply deposit', icon: 'vault', disabled: !info.deposits, run: () => tx().then((m) => m.applyDepositDialog({ leaseId: lease.id })) },
      { label: 'Print statement', icon: 'printer', run: () => printStatement(lease) },
      { separator: true },
      !lease.draft && status !== 'past' ? { label: 'Renew lease', icon: 'repeat', href: `#/leases/new?renews=${lease.id}` } : null,
      !lease.draft ? { label: lease.moveOut?.date ? 'Edit move-out' : 'Record move-out', icon: 'door', run: () => moveOutDialog(lease) } : null,
      lease.moveOut?.date ? { label: 'Cancel move-out', icon: 'undo', run: () => cancelMoveOut(lease) } : null,
      !lease.draft ? { label: lease.evictionPending ? 'Clear eviction pending' : 'Mark eviction pending', icon: 'gavel', run: () => toggleEviction(lease) } : null,
      { separator: true },
      { label: 'Edit lease', icon: 'pencil', href: `#/leases/${lease.id}/edit` },
      { label: 'Delete lease', icon: 'trash', danger: true, run: () => deleteLease(lease, hasTx) },
    ];
  }

  function toggleEviction(lease) {
    store.patch('leases', lease.id, { evictionPending: !lease.evictionPending });
    toast(lease.evictionPending ? 'Eviction pending cleared' : 'Marked as eviction pending');
  }

  async function deleteLease(lease, hasTx) {
    if (hasTx) {
      await confirmDialog({ title: 'This lease has transactions', message: 'A lease with charges or payments cannot be deleted, so its history stays intact. Record a move-out to end it instead.', confirmLabel: 'OK', cancelLabel: 'Close' });
      return;
    }
    const renewed = lease.renewsLeaseId ? store.get('leases', lease.renewsLeaseId) : null;
    const original = renewed?.renewedByLeaseId === lease.id ? renewed : null;
    const ok = await confirmDialog({
      title: 'Delete this lease?',
      message: original ? `The lease is removed and the lease it renews goes back to its own term. Tenant records are kept.` : 'The lease is removed. Tenant records are kept.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const removed = store.remove('leases', lease.id);
    // An applicant this lease was made for goes back to approved, ready for
    // another lease.
    const applicants = store.all('applicants').filter((a) => a.leaseId === lease.id);
    for (const a of applicants) store.patch('applicants', a.id, { status: a.status === 'converted' ? 'approved' : a.status, leaseId: null });
    // Undo the renewal on the lease it renewed.
    const before = original ? structuredClone(original) : null;
    if (original) {
      store.patch('leases', original.id, (l) => {
        const b = l.beforeRenewal;
        if (b) {
          l.type = b.type;
          l.end = b.end;
          l.renewal = b.renewal;
          l.recurring = (l.recurring || []).map((r) => {
            const was = b.recurring.find((x) => x.id === r.id);
            return was ? { ...r, end: was.end } : r;
          });
        } else if (l.renewal?.status === 'accepted') l.renewal = { ...l.renewal, status: 'not-started' };
        delete l.beforeRenewal;
        delete l.renewedByLeaseId;
        return l;
      });
    }
    navigate('/leases');
    toast('Lease deleted', {
      action: {
        label: 'Undo',
        run: () => {
          store.restore('leases', removed);
          if (before) store.put('leases', before);
          for (const a of applicants) store.put('applicants', a);
        },
      },
    });
  }

  function moveOutDialog(lease) {
    const mo = lease.moveOut || {};
    const notice = textInput({ type: 'date', value: mo.noticeDate || app.today() });
    const moveDate = textInput({ type: 'date', value: mo.date || (lease.end && lease.end >= app.today() ? lease.end : addDays(app.today(), 30)), required: true });
    const reason = textInput({ value: mo.reason || '', placeholder: 'Optional' });
    const forwarding = textarea({ value: mo.forwardingAddress || '', rows: 2, placeholder: 'Where to send the deposit refund and final statement' });
    return formDialog({
      title: mo.date ? 'Edit move-out' : 'Record move-out',
      submitLabel: 'Save move-out',
      body: h('div.stack', h('p.subtle', 'Recurring charges stop after the move-out date. Settle the deposit from the lease once the tenant has left.'), h('div.form-grid', field('Notice given on', notice), field('Move-out date', moveDate, { required: true })), field('Reason', reason), field('Forwarding address', forwarding)),
      onSubmit: () => {
        store.patch('leases', lease.id, (l) => {
          l.moveOut = { date: moveDate.value, noticeDate: notice.value || null, reason: reason.value.trim(), forwardingAddress: forwarding.value.trim() };
          if (l.renewal?.status !== 'accepted') l.renewal = { ...(l.renewal || {}), status: 'declined' };
          return l;
        });
        toast(`Move-out set for ${date(moveDate.value)}`);
      },
    });
  }

  async function cancelMoveOut(lease) {
    const ok = await confirmDialog({ title: 'Cancel the move-out?', message: 'The lease continues and recurring charges resume.', confirmLabel: 'Cancel move-out' });
    if (!ok) return;
    store.patch('leases', lease.id, (l) => {
      delete l.moveOut;
      if (l.renewal?.status === 'declined') l.renewal = { ...l.renewal, status: 'not-started' };
      return l;
    });
  }

  function offerDialog(lease) {
    const r = lease.renewal || {};
    const current = monthlyRent(lease, app.today());
    const rent = moneyInput({ cents: r.offerRent || Math.round((current * 1.03) / 100) * 100 });
    const end = textInput({ type: 'date', value: r.offerEnd || addMonths(lease.end || app.today(), app.settings().leases?.termMonths || 12) });
    const notes = textarea({ value: r.notes || '', rows: 2 });
    const email = h('input', { type: 'checkbox', checked: true });
    const tenantsWithEmail = lookup.tenants(lease.tenantIds).filter((t) => primaryEmail(t));
    return formDialog({
      title: 'Renewal offer',
      submitLabel: 'Save offer',
      body: h(
        'div.stack',
        h('p.subtle', `Current rent is ${money(current)}. The current term ends ${date(lease.end)}.`),
        h('div.form-grid', field('Offered rent', rent), field('New end date', end)),
        field('Notes', notes),
        tenantsWithEmail.length ? h('label.check', email, 'Email the offer to the tenants') : null,
      ),
      onSubmit: async () => {
        store.patch('leases', lease.id, { renewal: { status: 'offered', offerRent: rent.cents, offerEnd: end.value, offeredOn: app.today(), notes: notes.value.trim() } });
        toast('Renewal offer saved');
        if (tenantsWithEmail.length && email.checked) {
          const first = tenantsWithEmail.map((t) => t.firstName).filter(Boolean).join(' and ');
          const s = app.settings();
          const body = [`Hello ${first},`, '', `Your lease at ${lookup.leaseLabel(lease)} ends on ${date(lease.end)}. We would be glad to have you stay.`, '', `We are offering a renewal through ${date(end.value)} at ${money(rent.cents)} per month.`, notes.value.trim() ? `\n${notes.value.trim()}` : '', '', 'Please reply to let us know whether you would like to renew.', '', s.company?.name || ''].join('\n');
          try {
            const m = await import('../compose.js');
            m.composeEmail({ to: tenantsWithEmail.map((t) => ({ name: tenantName(t), email: primaryEmail(t), tenantId: t.id })), subject: `Lease renewal offer for ${lookup.leaseLabel(lease)}`, body, related: { leaseId: lease.id, propertyId: lease.propertyId } });
          } catch {
            toast('Email is not available right now.', { type: 'error' });
          }
        }
      },
    });
  }

  async function declineRenewal(lease) {
    const notes = textInput({ placeholder: 'Optional, e.g. Buying a home' });
    return formDialog({
      title: 'Tenant is not renewing',
      submitLabel: 'Save',
      body: h('div.stack', h('p.subtle', 'Mark the lease as not renewing. Record the move-out date when you know it.'), field('Reason', notes)),
      onSubmit: () => {
        store.patch('leases', lease.id, { renewal: { ...(lease.renewal || {}), status: 'declined', notes: notes.value.trim() } });
        toast('Marked as not renewing', { action: { label: 'Record move-out', run: () => moveOutDialog(store.get('leases', lease.id)) } });
      },
    });
  }

  function lateFeeDialog(lease) {
    const s = app.settings().lateFee || {};
    const lf = lease.lateFee || {};
    const mode = lf.enabled === false ? 'none' : Object.keys(lf).some((k) => k !== 'enabled') ? 'custom' : 'company';
    let choice = mode;
    const grace = textInput({ type: 'number', min: 0, max: 31, value: lf.graceDays ?? s.graceDays ?? 5 });
    const kind = select({ value: lf.kind || s.kind || 'flat', options: [{ value: 'flat', label: 'Flat amount' }, { value: 'percent', label: 'Percent of rent' }] });
    const amount = moneyInput({ cents: lf.amount ?? s.amount ?? 5000 });
    const pct = textInput({ type: 'number', min: 0, max: 100, step: '0.5', value: lf.percent ?? s.percent ?? 5 });
    const custom = h('div.form-grid.three', field('Grace days', grace), field('Fee type', kind), h('div', field('Amount', amount), field('Percent', pct)));
    const showCustom = () => {
      custom.hidden = choice !== 'custom';
      amount.closest('.field').hidden = kind.value !== 'flat';
      pct.closest('.field').hidden = kind.value !== 'percent';
    };
    kind.addEventListener('change', showCustom);
    return formDialog({
      title: 'Late fees for this lease',
      submitLabel: 'Save',
      body: () => {
        const node = h(
          'div.stack',
          segmented({
            label: 'Late fee policy',
            value: choice,
            items: [
              { value: 'company', label: 'Company policy' },
              { value: 'custom', label: 'Custom' },
              { value: 'none', label: 'None' },
            ],
            onChange: (v) => ((choice = v), showCustom()),
          }),
          h('p.subtle', s.enabled ? `Company policy: ${s.kind === 'percent' ? `${s.percent}% of rent` : money(s.amount)} after ${s.graceDays} days.` : 'Late fees are turned off in company settings.'),
          custom,
        );
        queueMicrotask(showCustom);
        return node;
      },
      onSubmit: () => {
        const next = choice === 'none' ? { enabled: false } : choice === 'company' ? {} : { enabled: true, graceDays: Number(grace.value) || 0, kind: kind.value, amount: amount.cents, percent: Number(pct.value) || 0 };
        store.patch('leases', lease.id, { lateFee: next });
        toast('Late fee policy updated');
      },
    });
  }

  function recurringDialog(lease, item = null) {
    const accounts = chargeableAccounts(store.all('accounts')).filter((a) => a.type === 'income');
    const acc = accountSelect({ value: item?.accountId || accounts[0]?.id, filter: (a) => accounts.some((x) => x.id === a.id) });
    const amount = moneyInput({ cents: item?.amount || 0, required: true });
    const day = textInput({ type: 'number', min: 1, max: 31, value: item?.day || app.settings().leases?.rentDay || 1 });
    const start = textInput({ type: 'date', value: item?.start || app.today() });
    const end = textInput({ type: 'date', value: item?.end || '' });
    const memo = textInput({ value: item?.memo || '', placeholder: 'e.g. Parking space 12' });
    return formDialog({
      title: item ? 'Edit recurring charge' : 'Add recurring charge',
      submitLabel: 'Save',
      body: h(
        'div.stack',
        item?.postedThrough ? h('p.subtle', `Charged through ${date(item.postedThrough)}. Changes apply to charges after that date.`) : h('p.subtle', 'Charged automatically every month on the due day.'),
        h('div.form-grid', field('Account', acc), field('Amount', amount, { required: true })),
        h('div.form-grid.three', field('Due day of month', day), field('Starts', start), field('Ends', end, { hint: 'Leave empty to follow the lease' })),
        field('Description', memo),
      ),
      onSubmit: () => {
        if (!(amount.cents > 0)) {
          amount.setAttribute('aria-invalid', 'true');
          amount.focus();
          return false;
        }
        const d = Math.min(31, Math.max(1, Number(day.value) || 1));
        store.patch('leases', lease.id, (l) => {
          const list = l.recurring || [];
          if (item) l.recurring = list.map((r) => (r.id === item.id ? { ...r, accountId: acc.value, amount: amount.cents, day: d, start: start.value || r.start, end: end.value || null, memo: memo.value.trim() } : r));
          else l.recurring = [...list, newRecurring({ accountId: acc.value, amount: amount.cents, day: d, start: start.value || app.today(), end: end.value || null, memo: memo.value.trim() })];
          return l;
        });
        toast(item ? 'Recurring charge updated' : 'Recurring charge added');
      },
    });
  }

  async function stopRecurring(lease, item) {
    const end = textInput({ type: 'date', value: app.today() });
    return formDialog({
      title: 'Stop recurring charge',
      submitLabel: 'Stop charging',
      body: h('div.stack', h('p', `${item.memo || accName(item.accountId)}, ${money(item.amount)} a month.`), field('Last day to charge', end)),
      onSubmit: () => {
        store.patch('leases', lease.id, (l) => ((l.recurring = l.recurring.map((r) => (r.id === item.id ? { ...r, end: end.value || app.today() } : r))), l));
        toast('Recurring charge stopped');
      },
    });
  }

  async function removeRecurring(lease, item) {
    const ok = await confirmDialog({ title: 'Remove this recurring charge?', message: 'Nothing has been charged from it yet.', confirmLabel: 'Remove', danger: true });
    if (ok) store.patch('leases', lease.id, (l) => ((l.recurring = l.recurring.filter((r) => r.id !== item.id)), l));
  }

  return {
    node: body,
    title: (() => {
      const l = store.get('leases', id);
      return l ? lookup.leaseLabel(l) : 'Lease';
    })(),
  };
}

function glanceItem(label, value) {
  return h('div.ls-glance-item', h('span.ls-glance-label', label), h('span.ls-glance-value', value));
}

export { termText };

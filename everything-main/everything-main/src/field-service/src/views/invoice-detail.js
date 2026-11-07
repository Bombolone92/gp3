/** A single invoice: the document, payments, and status actions. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { pageHeader, statusPill, emptyState, moreButton } from '../ui/components.js';
import { openMenu } from '../ui/menu.js';
import { confirmDialog } from '../ui/dialog.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { clientName } from '../core/format.js';
import { invoiceStatus, invoiceBalance } from '../core/status.js';
import { computeTotals, amountPaid } from '../core/totals.js';
import { formatDate, diffDays } from '../core/dates.js';
import { duplicateDoc } from '../core/workflow.js';
import { PAYMENT_METHODS } from '../core/settings.js';
import { clientCard, notesCard, money } from './common.js';
import { documentSheet, printDocument, sendDialog, timeline } from './docview.js';
import { recordPaymentDialog } from './payments.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;

  const body = ctx.live(() => {
    const inv = store.get('invoices', id);
    if (!inv) return emptyState({ icon: 'receipt-text', title: 'Invoice not found', headingLevel: 1, text: 'It may have been deleted.', actions: [h('a.btn.primary', { href: '#/invoices' }, 'Back to invoices')] });
    const today = app.today();
    const payments = store.all('payments');
    const status = invoiceStatus(inv, today, payments);
    const client = lookup.client(inv.clientId);
    const t = computeTotals(inv);
    const paid = amountPaid(inv.id, payments);
    const balance = invoiceBalance(inv, payments);
    const myPayments = payments.filter((p) => p.invoiceId === inv.id && !p.voided).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const jobs = (inv.jobIds || []).map((j) => store.get('jobs', j)).filter(Boolean);
    const markSent = () => store.patch('invoices', inv.id, { sentAt: inv.sentAt || new Date().toISOString() });

    let primary;
    if (status === 'draft') primary = h('button.btn.primary', { type: 'button', onClick: () => sendDialog('invoices', inv, { onSent: () => (markSent(), toast('Invoice marked as sent')) }) }, icon('send', 16), 'Send invoice');
    else if (balance > 0 && status !== 'bad_debt') primary = h('button.btn.primary', { type: 'button', onClick: () => recordPaymentDialog({ invoiceId: inv.id }) }, icon('wallet', 16), 'Collect payment');
    else primary = h('button.btn', { type: 'button', onClick: () => printDocument('invoices', inv) }, icon('printer', 16), 'Print');

    const more = moreButton((btn) =>
      openMenu(
        btn,
        [
          { label: 'Print or save as PDF', icon: 'printer', run: () => printDocument('invoices', inv) },
          status !== 'draft' ? { label: status === 'past_due' ? 'Send reminder' : 'Send again', icon: 'send', run: () => sendDialog('invoices', inv, { onSent: markSent }) } : { label: 'Mark as sent', icon: 'send', run: () => (markSent(), toast('Invoice marked as sent')) },
          balance > 0 ? { label: 'Record payment', icon: 'wallet', run: () => recordPaymentDialog({ invoiceId: inv.id }) } : null,
          { separator: true },
          // A written-off invoice stays bad debt as a draft: remove that first.
          inv.sentAt && status !== 'paid' && status !== 'bad_debt' ? { label: 'Revert to draft', icon: 'undo', run: () => store.patch('invoices', inv.id, { sentAt: null }) } : null,
          inv.badDebt
            ? { label: 'Remove bad debt', icon: 'undo', run: () => store.patch('invoices', inv.id, { badDebt: false, badDebtAt: null }) }
            : balance > 0 && inv.sentAt
              ? { label: 'Mark as bad debt', icon: 'alert', description: 'Write off the unpaid balance', run: () => (store.patch('invoices', inv.id, { badDebt: true, badDebtAt: new Date().toISOString() }), toast('Marked as bad debt')) }
              : null,
          {
            label: 'Duplicate',
            icon: 'copy',
            run: async () => {
              const c = await duplicateDoc(store, 'invoices', inv.id, app.today());
              toast(`Invoice #${c.number} created`);
              navigate(`/invoices/${c.id}/edit`);
            },
          },
          {
            label: 'Delete',
            icon: 'trash',
            danger: true,
            run: async () => {
              if (!(await confirmDialog({ title: `Delete invoice #${inv.number}?`, message: myPayments.length ? 'Payments recorded against it stay, but become unapplied.' : 'This permanently deletes the invoice.', confirmLabel: 'Delete invoice', danger: true }))) return;
              const removed = store.remove('invoices', inv.id);
              // Unlink visits billed by this invoice so they can be billed again.
              const unlinked = new Set();
              for (const j of jobs)
                store.patch('jobs', j.id, (x) => {
                  x.visits = (x.visits || []).map((v) => (v.invoiceId === inv.id ? (unlinked.add(v.id), { ...v, invoiceId: null }) : v));
                  return x;
                });
              // Its payments stay as unapplied credit, free to apply elsewhere.
              const paymentIds = store.all('payments').filter((p) => p.invoiceId === inv.id).map((p) => p.id);
              for (const pid of paymentIds) store.patch('payments', pid, { invoiceId: null });
              navigate('/invoices');
              const undo = () => {
                store.restore('invoices', removed);
                for (const pid of paymentIds) if (store.get('payments', pid) && !store.get('payments', pid).invoiceId) store.patch('payments', pid, { invoiceId: removed.id });
                // Link the visits back, unless another invoice billed them meanwhile.
                for (const j of jobs)
                  store.patch('jobs', j.id, (x) => {
                    x.visits = (x.visits || []).map((v) => (unlinked.has(v.id) && !v.invoiceId ? { ...v, invoiceId: removed.id } : v));
                    return x;
                  });
              };
              toast('Invoice deleted', { action: { label: 'Undo', run: undo } });
            },
          },
        ],
        { align: 'end' },
      ),
    );

    const header = pageHeader({
      title: h('span.row', { style: { gap: '12px', flexWrap: 'wrap' } }, `Invoice #${inv.number}`, statusPill(status)),
      crumbs: [{ label: 'Invoices', href: '#/invoices' }],
      subtitle: [inv.subject || 'Invoice', ' for ', h('a', { href: `#/clients/${inv.clientId}` }, clientName(client))],
      actions: [more, h('a.btn', { href: `#/invoices/${inv.id}/edit` }, icon('pencil', 16), 'Edit'), primary],
    });

    const overdueDays = status === 'past_due' ? diffDays(inv.dueDate, today) : 0;
    const paymentsCard = h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Payments'), balance > 0 ? h('button.btn.sm', { type: 'button', onClick: () => recordPaymentDialog({ invoiceId: inv.id }) }, icon('plus', 14), 'Record') : null),
      h(
        'div.card-body.flush',
        myPayments.length
          ? h(
              'ul.list',
              myPayments.map((p) =>
                h(
                  'li',
                  h(
                    'button.list-item',
                    { type: 'button', onClick: () => recordPaymentDialog({ payment: p }) },
                    h('div.grow', h('div.title', money(p.amount)), h('div.meta', `${formatDate(p.date)} · ${PAYMENT_METHODS.find((m) => m.id === p.method)?.label || 'Other'}${p.reference ? ' · ' + p.reference : ''}`)),
                    icon('pencil', 15, 'subtle'),
                  ),
                ),
              ),
            )
          : h('div.section-empty', h('span', 'No payments yet.')),
      ),
    );

    return [
      header,
      status === 'past_due' ? h('div.notice.danger', { style: { marginBottom: '16px' } }, icon('alert'), h('span', `Payment is ${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue. Send a reminder or record a payment.`)) : null,
      h(
        'div.detail',
        h('div.detail-main', h('section.card.sheet-card', documentSheet('invoices', inv))),
        h(
          'div.detail-aside',
          h(
            'section.card',
            h(
              'div.card-body',
              h(
                'div.doc-meta',
                h('div', h('div.meta-label', 'Balance due'), h('div.meta-value.big-number', { style: { fontSize: '22px', color: balance > 0 && status === 'past_due' ? 'var(--danger)' : null } }, money(Math.max(0, balance)))),
                h('div', h('div.meta-label', 'Total'), h('div.meta-value', { style: { fontSize: '16px' } }, money(t.total)), h('div.subtle', { style: { fontSize: '12px' } }, paid ? `${money(paid)} paid` : status === 'draft' ? 'Not sent yet' : `Due ${formatDate(inv.dueDate)}`)),
              ),
            ),
          ),
          paymentsCard,
          clientCard(client, inv.propertyId),
          jobs.length
            ? h('section.card', h('div.card-head', h('h2.grow', 'Related jobs')), h('div.card-body.flush', h('ul.list', jobs.map((j) => h('li', h('a.list-item', { href: `#/jobs/${j.id}` }, icon('hammer', 16, 'subtle'), h('span.grow.title', `Job #${j.number}`), h('span.meta.truncate', j.title)))))))
            : null,
          h(
            'section.card',
            h('div.card-head', h('h2.grow', 'Activity')),
            timeline([
              { at: inv.createdAt, label: 'Invoice created', icon: 'receipt-text' },
              { at: inv.sentAt, label: 'Sent to client', icon: 'send', tone: 'accent' },
              ...(inv.emails || []).map((e) => ({ at: e.at, label: `Emailed to ${(e.to || []).join(', ')}`, icon: 'mail', tone: 'accent' })),
              ...myPayments.map((p) => ({ at: p.createdAt || p.date, label: `Payment of ${money(p.amount)}`, icon: 'wallet', tone: 'success' })),
            ]),
          ),
          notesCard('invoices', inv),
        ),
      ),
    ];
  }, ['invoices', 'payments', 'clients', 'jobs', 'settings']);

  const inv = store.get('invoices', id);
  return { node: h('div.page', body), title: inv ? `Invoice #${inv.number}` : 'Invoice' };
}

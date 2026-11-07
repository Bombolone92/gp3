/**
 * The trash: what has been deleted, and the way back.
 *
 * This app is the record — there is no copy of it on a server of ours — so a
 * mis-tapped row on a phone must not be the end of an invoice, its payments,
 * and its receipt. Everything deleted waits here for thirty days, then goes
 * on its own at the next boot.
 */

import { el, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/modal.js';
import { emptyState, keepFocus } from '../ui/bits.js';
import { store, TRASH_DAYS } from '../lib/store.js';
import { docTotals, fmtMoney, isRefund } from '../lib/money.js';
import { fmtDate } from '../lib/dates.js';
import { republishIfShared } from '../lib/share.js';

/**
 * "Deleted today · 30 days left" — the two things a trash row must say.
 * Counted from the stored timestamp, not from its date part: deletions are
 * stamped in UTC, and slicing the date out of one made a row deleted this
 * evening read as "31 days left" anywhere east of Greenwich.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
function deletedNote(deletedAt) {
  const at = Date.parse(deletedAt);
  const age = Number.isFinite(at) ? Math.max(0, Math.floor((Date.now() - at) / DAY_MS)) : 0;
  const left = Math.max(0, TRASH_DAYS - age);
  const ago = age === 0 ? 'today' : age === 1 ? 'yesterday' : `${age} days ago`;
  return `Deleted ${ago} · ${left === 0 ? 'goes today' : `${left} day${left === 1 ? '' : 's'} left`}`;
}

export function trashView({ navigate }) {
  const root = el('div.view');

  function render() {
    const restoreFocus = keepFocus(root);
    clear(root);
    const trash = store.trash();
    const count = trash.docs.length + trash.payments.length
      + trash.clients.length + trash.recurring.length;

    root.append(el('div.page-head', {},
      el('div', {},
        el('h1.page-title', {}, 'Trash'),
        el('p.page-sub', {}, `Deleted items are recoverable for ${TRASH_DAYS} days`)),
      // Emptying the trash is a write: offline this page reads what is in
      // there and what is left of its thirty days, and nothing more.
      count && !store.readOnly ? el('div.page-actions', {},
        el('button.btn.btn-danger', {
          html: icon('trash', 15, 1.6),
          onclick: async () => {
            const ok = await confirmDialog({
              title: 'Empty the trash?',
              message: `All ${count} item${count === 1 ? '' : 's'} in here are deleted for good. This cannot be undone.`,
              confirmLabel: 'Delete everything',
            });
            if (!ok) return;
            try {
              await store.emptyTrash();
              toast('Trash emptied', { icon: 'trash' });
            } catch (err) {
              console.error(err);
              toast('Could not empty the trash. Check your connection', { icon: 'wifiOff' });
            }
          },
        }, ' Empty trash')) : null));

    if (!count) {
      root.append(emptyState('trash', 'Nothing in the trash',
        `Anything you delete waits here for ${TRASH_DAYS} days, so a mis-tap is never the end of an invoice.`));
      restoreFocus();
      return;
    }

    /**
     * One row: what it was, when it went, and the two ways out of here.
     * `restore` and `purge` are async and both re-render this view.
     */
    const row = (ic, title, sub, deletedAt, { restore, purge, purgeMessage }) =>
      el('div.doc-row.rule-row', {},
        el('span.doc-row-ic', { html: icon(ic, 17, 1.5) }),
        el('span.doc-row-main', {},
          el('span.doc-row-title', {}, el('span.doc-row-number', {}, title)),
          el('span.doc-row-sub', {}, `${sub ? `${sub} · ` : ''}${deletedNote(deletedAt)}`)),
        el('span.doc-row-end.rule-end', {},
          !store.readOnly && el('span.rule-actions', {},
            el('button.icon-btn', {
              html: icon('undo', 16, 1.6), 'aria-label': `Restore ${title}`, title: 'Restore',
              onclick: async () => {
                try {
                  await restore();
                  toast(`${title} restored`, { icon: 'undo' });
                } catch (err) {
                  console.error(err);
                  toast('Could not restore. Check your connection', { icon: 'wifiOff' });
                }
              },
            }),
            el('button.icon-btn', {
              html: icon('trash', 16, 1.6), 'aria-label': `Delete ${title} permanently`, title: 'Delete permanently',
              onclick: async () => {
                const ok = await confirmDialog({
                  title: `Delete ${title} for good?`,
                  message: purgeMessage || 'This cannot be undone.',
                });
                if (!ok) return;
                try {
                  await purge();
                  toast(`${title} deleted for good`, { icon: 'trash' });
                } catch (err) {
                  console.error(err);
                  toast('Could not delete. Check your connection', { icon: 'wifiOff' });
                }
              },
            }))));

    const section = (title, rows) => (rows.length
      ? el('section.card.list-card', {},
        el('div.card-head', {}, el('h2.card-title', {}, title)),
        el('div.doc-list', {}, rows))
      : null);

    const sections = [
      section('Documents', trash.docs.map((d) => {
        const client = store.clients.find((c) => c.id === d.clientId);
        const t = docTotals(d);
        return row(d.kind === 'quote' ? 'quote' : 'invoice', d.number,
          `${fmtMoney(t.total, d.currency)}${client ? ` · ${client.company || client.name || 'Client'}` : ''}`
          + ` · ${fmtDate(d.issueDate)}`,
          d.deletedAt, {
            restore: () => store.restoreDoc(d.id),
            purge: () => store.purgeDoc(d.id),
            purgeMessage: (d.payments || []).length
              ? 'Its recorded payments and receipts go with it. This cannot be undone.'
              : 'This cannot be undone.',
          });
      })),
      section('Payments', trash.payments.map(({ doc, payment }) => row(
        isRefund(payment) ? 'undo' : 'receipt',
        payment.number || 'Payment',
        `${fmtMoney(Math.abs(payment.amount), doc.currency)} ${isRefund(payment) ? 'refunded' : 'received'}`
        + ` · ${doc.number}`,
        payment.deletedAt, {
          restore: async () => {
            await store.restorePayment(doc.id, payment.id);
            // A payment back on the invoice changes what its public page must
            // say — the balance, the Paid row, whether a pay link belongs
            // there — exactly as deleting it did from the receipt; the Undo
            // on that toast refreshes the page, and this way back has to too.
            republishIfShared(store, doc.id)
              .catch(() => toast('Could not refresh the shared page', { icon: 'wifiOff' }));
          },
          purge: () => store.purgePayment(doc.id, payment.id),
          purgeMessage: `The receipt for this ${isRefund(payment) ? 'refund' : 'payment'} is gone for good.`,
        }))),
      section('Clients', trash.clients.map((c) => {
        const name = c.company || c.name || 'Client';
        const docs = store.docs().filter((d) => d.clientId === c.id).length;
        return row('clients', name,
          docs ? `${docs} document${docs === 1 ? '' : 's'} waiting to be re-attached` : 'No documents',
          c.deletedAt, {
            restore: () => store.restoreClient(c.id),
            purge: () => store.purgeClient(c.id),
            purgeMessage: docs
              ? `Their ${docs} document${docs === 1 ? ' stays' : 's stay'} in your records without a client attached, for good.`
              : 'This cannot be undone.',
          });
      })),
      section('Recurring schedules', trash.recurring.map((r) => row('repeat',
        r.name || 'Recurring invoice',
        'Drafts nothing while it is in here',
        r.deletedAt, {
          restore: () => store.restoreRecurring(r.id),
          purge: () => store.purgeRecurring(r.id),
          purgeMessage: 'Invoices it already created stay. This cannot be undone.',
        }))),
    ].filter(Boolean);

    root.append(...sections);
    restoreFocus();
  }

  store.addEventListener('change', render);
  root.destroy = () => store.removeEventListener('change', render);
  render();
  return root;
}

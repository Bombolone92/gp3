import { el, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { emptyState, download, keepFocus } from '../ui/bits.js';
import { receiptHTML } from '../ui/paper.js';
import { store, TRASH_DAYS } from '../lib/store.js';
import { fmtMoney, isRefund } from '../lib/money.js';
import { fmtDate } from '../lib/dates.js';
import { paymentRows, paymentsCsv } from '../lib/acct-csv.js';
import { republishIfShared } from '../lib/share.js';
import { savePdf } from '../ui/pdf-action.js';

/**
 * The currency the accounting export converts into: the reporting currency
 * when the account names one, otherwise the currency it bills in. Read at
 * click time, never snapshotted — Settings can change it while a page is open.
 */
const acctBaseCurrency = () =>
  store.settings.baseCurrency || store.settings.currency || 'USD';

/** Receipt viewer: printable paper plus payment management. */
export function openReceiptModal(payment, doc) {
  const client = store.client(doc.clientId);
  const paper = el('div.paper.receipt-paper', {
    html: receiptHTML(payment, doc, client, store.settings),
  });

  const modal = openModal({
    title: `${isRefund(payment) ? 'Refund receipt' : 'Receipt'} ${payment.number}`,
    wide: true,
    content: el('div', {},
      paper,
      el('div.side-actions', { style: { marginTop: '14px' } },
        el('button.btn.btn-primary', {
          html: icon('printer', 15, 1.6),
          onclick: () => {
            // Print just the receipt, not the view behind the modal.
            document.body.classList.add('print-paper');
            const done = () => document.body.classList.remove('print-paper');
            window.addEventListener('afterprint', done, { once: true });
            window.print();
            setTimeout(done, 1000);
          },
        }, ' Print'),
        el('button.btn', {
          html: icon('download', 15, 1.6),
          onclick: () => savePdf((mods) => mods.receiptSpec(payment, doc, client, store.settings)),
        }, ' Download PDF'),
        el('a.btn.btn-ghost', { href: `#/doc/${doc.id}`, onclick: () => modal.close() }, `View ${doc.number}`),
        // Printing and saving a receipt work offline; deleting the payment
        // behind it does not, so it is left out rather than refused.
        !store.readOnly && el('button.btn.btn-danger', {
          html: icon('trash', 15, 1.6),
          onclick: async () => {
            const back = isRefund(payment);
            const ok = await confirmDialog({
              title: back ? 'Delete this refund?' : 'Delete this payment?',
              message: `${fmtMoney(Math.abs(payment.amount), doc.currency)} ${back ? 'refunded' : 'received'} `
                + `${fmtDate(payment.date)} comes off ${doc.number} and its receipt with it. `
                + `Recoverable from the trash for ${TRASH_DAYS} days.`,
            });
            if (!ok) return;
            try {
              await store.deletePayment(doc.id, payment.id);
              modal.close();
              toast(isRefund(payment) ? 'Refund moved to the trash' : 'Payment moved to the trash', {
                icon: 'trash',
                action: {
                  label: 'Undo',
                  onClick: async () => {
                    try {
                      await store.restorePayment(doc.id, payment.id);
                      toast(isRefund(payment) ? 'Refund restored' : 'Payment restored', { icon: 'undo' });
                      republishIfShared(store, doc.id)
                        .catch(() => toast('Could not refresh the shared page', { icon: 'wifiOff' }));
                    } catch (err) {
                      console.error(err);
                      toast('Could not restore. Check your connection', { icon: 'wifiOff' });
                    }
                  },
                },
              });
              // A shared page must reflect the restored balance.
              republishIfShared(store, doc.id)
                .catch(() => toast('Could not refresh the shared page', { icon: 'wifiOff' }));
            } catch (err) {
              console.error(err);
              toast('Could not delete. Check your connection', { icon: 'wifiOff' });
            }
          },
        }, isRefund(payment) ? ' Delete refund' : ' Delete payment'))),
  });
}

export function receiptsView() {
  const root = el('div.view');

  function render() {
    const restoreFocus = keepFocus(root);
    clear(root);
    const receipts = store.receipts();
    // Refunds get a receipt of their own and are listed here too, so the
    // subtitle only claims payments when that is all there is.
    const anyRefunds = receipts.some(({ payment }) => isRefund(payment));

    root.append(el('div.page-head', {},
      el('div', {},
        el('h1.page-title', {}, 'Receipts'),
        el('p.page-sub', {}, anyRefunds
          ? 'Every payment received, and every refund sent back'
          : 'Every payment received')),
      receipts.length ? el('div.page-actions', {},
        el('button.btn', {
          html: icon('download', 16, 1.6),
          title: 'CSV shaped for the Personal Finance import wizard',
          onclick: () => {
            // The export leaves out void invoices' payments, so a ledger
            // with rows in it can still produce an empty file; say so
            // rather than downloading a header on its own.
            // The account's own money, so a payment taken in another currency
            // carries what it was worth here; a single-currency ledger gets
            // the same six columns it always did.
            const opts = { baseCurrency: acctBaseCurrency() };
            const rows = paymentRows(store.docs(), store.clients, opts);
            if (!rows.length) {
              toast('Nothing to export: every payment is on a void invoice', { icon: 'alert' });
              return;
            }
            download('income-for-personal-finance.csv',
              paymentsCsv(store.docs(), store.clients, opts), 'text/csv');
            toast(`${rows.length} payment${rows.length === 1 ? '' : 's'} ready. Import them in Personal Finance`, { icon: 'download' });
          },
        }, ' Export for Personal Finance')) : null));

    if (!receipts.length) {
      root.append(emptyState('receipt', 'No receipts yet',
        'Record a payment on an invoice and its receipt appears here.'));
      restoreFocus();
      return;
    }

    root.append(el('div.doc-list.card-list', {}, receipts.map(({ payment, doc }) => {
      const client = store.client(doc.clientId);
      const back = isRefund(payment);
      return el('button.doc-row', {
        type: 'button',
        onclick: () => openReceiptModal(payment, doc),
      },
        el(`span.doc-row-ic${back ? '.refund' : ''}`, { html: icon(back ? 'undo' : 'receipt', 17, 1.6) }),
        el('span.doc-row-main', {},
          el('span.doc-row-title', {},
            el('span.doc-row-number', {}, payment.number),
            ' ',
            // 'No client', as every other list says it: falling back to the
            // invoice number printed it twice, once here and again in the
            // line below, and still never said who the money came from.
            el('span.doc-row-client', {}, client ? (client.company || client.name || 'Client') : 'No client')),
          el('span.doc-row-sub', {}, `${back ? 'Refund · ' : ''}${fmtDate(payment.date)} · ${doc.number}${payment.method ? ` · ${payment.method}` : ''}`)),
        el('span.doc-row-end', {},
          el(`span.doc-row-amount${back ? '.refunded' : ''}`, {}, fmtMoney(payment.amount, doc.currency))));
    })));
    restoreFocus();
  }

  store.addEventListener('change', render);
  root.destroy = () => store.removeEventListener('change', render);
  render();
  return root;
}

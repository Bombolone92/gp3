import { el } from './dom.js';
import { toast } from './toast.js';
import { receiptDoc } from '../lib/receipt-doc.js';
import { hasPrinter, printDocBytes, printerSaid } from '../lib/printer.js';

/**
 * Render a receipt as a document - the same markup serves the on-screen
 * detail view and the print layout (print.css restyles it for paper). Content
 * comes from receiptDoc, which the shareable image renders too, so the three
 * copies can't drift apart.
 */
export function receiptNode(receipt, store) {
  const doc = receiptDoc(receipt, store.settings);

  const item = (l) => el('div.rcpt-line', {},
    el('div.rcpt-line-main', {},
      el('span.rcpt-qty', {}, l.qty),        // refund lines carry negative qty
      el('span.rcpt-name', {}, l.name),
      el('span.rcpt-amount', {}, l.amount)
    ),
    // Options, unit price, and discount sit under their item, as on any
    // café receipt; the unit price already includes option deltas.
    ...l.subs.map((s) => el(`div.rcpt-line-sub${s.kind === 'discount' ? '.rcpt-disc' : ''}${s.kind === 'options' ? '.rcpt-opts' : ''}${s.kind === 'note' ? '.rcpt-line-note' : ''}`, {}, s.text))
  );

  const row = (r, cls = '') => el(`div.rcpt-row${cls}`, {},
    el('span', {}, r.label), el('span', {}, r.value));

  return el('div.rcpt', {
    className: `rcpt${doc.refund ? ' rcpt-refund' : ''}`,
    'aria-label': `${doc.refund ? 'Refund' : 'Receipt'} ${doc.number}`,
  },
    doc.voided && el('div.rcpt-void-stamp', { role: 'img', 'aria-label': 'Voided' }, 'VOID'),
    el('div.rcpt-head', {},
      doc.logo && el('img.rcpt-logo', { src: doc.logo, alt: '' }),
      el('div.rcpt-store', {}, doc.storeName),
      doc.address && el('div.rcpt-addr', {}, doc.address),
      // Tax/registration numbers: in much of the world a receipt without
      // them isn't one a customer can expense.
      doc.registrations.length
        ? el('div.rcpt-reg', {}, doc.registrations.map((line) => el('div', {}, line)))
        : null
    ),
    // A refund must never be mistakable for a sale, on screen or on paper.
    doc.kind && el('div.rcpt-kind', {}, doc.kind),
    el('div.rcpt-meta', {}, doc.meta.map((line) => el('span', {}, line))),
    el('div.rcpt-lines', {}, doc.items.map(item)),
    el('div.rcpt-totals', {}, doc.totals.map((t) => row(t, t.strong ? '.rcpt-total' : ''))),
    el('div.rcpt-pay', {}, doc.payments.map((p) => row(p, p.strong ? '.rcpt-total' : ''))),
    doc.note && el('div.rcpt-note', {}, doc.note),
    // The reward taken, then the card as it stands - what the customer looks
    // for when they get their slip back.
    (doc.reward || doc.loyalty) && el('div.rcpt-loyalty', {},
      doc.reward && el('div.rcpt-reward', {}, doc.reward),
      doc.loyalty && el('div', {}, doc.loyalty)),
    doc.footer && el('div.rcpt-footer', {}, doc.footer)
  );
}

/**
 * Print one document: a dedicated print root is populated, printed, and
 * removed - print.css hides everything else while it exists. Shared by
 * receipts and the end-of-day Z-report.
 */
/** Teardown of the print currently owning #print-root, if one is out. */
let activeCleanup = null;

export function printDocument(node) {
  // A reprint within the sweep window: the previous print's timer and
  // listeners must not tear down this print's root under its dialog.
  activeCleanup?.();
  const root = el('div', { id: 'print-root' }, node);
  document.body.append(root);
  // The class keys the print stylesheet (everything but the receipt hides),
  // so a plain Cmd+P without a receipt still prints the page normally.
  document.body.classList.add('printing');

  let timer = null;
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    if (activeCleanup === cleanup) activeCleanup = null;
    clearTimeout(timer);
    window.removeEventListener('afterprint', cleanup);
    window.removeEventListener('focus', cleanup);
    root.remove();
    document.body.classList.remove('printing');
  };
  activeCleanup = cleanup;
  window.addEventListener('afterprint', cleanup);
  window.print();
  // Where print() doesn't block (iOS), execution passes here with the
  // dialog still open: afterprint - or focus returning when the sheet
  // closes - is the real signal. The old flat 4s sweep tore the receipt
  // out from under anyone still choosing a printer; the long timer now
  // only catches browsers that deliver neither event.
  if (!done) {
    window.addEventListener('focus', cleanup);
    timer = setTimeout(cleanup, 60_000);
  }
}

/**
 * Put a receipt on paper.
 *
 * Where this device has a thermal printer set up, the slip goes straight to
 * it - no dialog, no preview, which on a tablet mid-queue is the whole point.
 * Everywhere else (and whenever the printer doesn't answer) it falls back to
 * the browser's own print dialog, which is what every shop had before.
 *
 * `kick` opens the cash drawer once the slip is out; it is ignored when there
 * is no printer, because a browser print has no drawer to open.
 */
export async function printReceipt(receipt, store, { kick = false } = {}) {
  const doc = receiptDoc(receipt, store.settings);
  if (hasPrinter()) {
    try {
      await printDocBytes(doc, { kick });
      return true;
    } catch (err) {
      console.error(err);
      // Say what happened, then fall back rather than leave the customer
      // waiting for a slip that isn't coming.
      toast(`${printerSaid(err)} — using the print dialog instead`,
        { icon: 'alert', duration: 6000 });
    }
  }
  printDocument(receiptNode(receipt, store));
  return false;
}

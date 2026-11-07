/**
 * The client-facing document (quote or invoice) as it appears on screen and
 * on paper, plus print and send helpers.
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { openDialog } from '../ui/dialog.js';
import { field, textInput, textarea } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { clientName, formatAddress, primaryEmail, primaryPhone } from '../core/format.js';
import { formatDate } from '../core/dates.js';
import { computeTotals } from '../core/totals.js';
import { amountPaid } from '../core/totals.js';
import { lineItemsTable, totalsBlock, money } from './common.js';
import { PAYMENT_TERMS } from '../core/settings.js';
import { mailerAvailable, sendDocument, parseRecipients, describeResult } from '../mailer.js';

const NOUN = { quotes: 'Quote', invoices: 'Invoice' };

/** Paper-like rendering of a quote or invoice. */
export function documentSheet(coll, doc, { forPrint = false } = {}) {
  const s = app.settings();
  const client = lookup.client(doc.clientId);
  const property = client ? lookup.property(client, doc.propertyId) : null;
  const billing = client?.billingSame === false && client.billing?.street1 ? client.billing : property;
  const payments = app.store.all('payments');
  const paid = coll === 'invoices' ? amountPaid(doc.id, payments) : null;
  const meta =
    coll === 'quotes'
      ? [
          ['Quote', `#${doc.number}`],
          ['Created', formatDate(doc.createdAt)],
          doc.validUntil ? ['Valid until', formatDate(doc.validUntil)] : null,
        ]
      : [
          ['Invoice', `#${doc.number}`],
          ['Issued', formatDate(doc.issueDate)],
          ['Due', doc.terms === 'receipt' ? 'Upon receipt' : formatDate(doc.dueDate)],
          ['Terms', PAYMENT_TERMS.find((t) => t.id === doc.terms)?.label || ''],
        ];

  return h(
    `article.doc-sheet${forPrint ? '.print' : ''}`,
    { 'aria-label': `${NOUN[coll]} ${doc.number}` },
    h(
      'header.sheet-head',
      h(
        'div.sheet-company',
        h('div.sheet-company-name', s.company.name || 'Your business'),
        h('div.sheet-small', [s.company.address, s.company.phone, s.company.email, s.company.website].filter(Boolean).join('\n')),
      ),
      h('div.sheet-title', h('div.sheet-kind', NOUN[coll]), h('dl.sheet-meta', meta.filter(Boolean).map(([k, v]) => [h('dt', k), h('dd', v)]))),
    ),
    h(
      'section.sheet-parties',
      h('div', h('div.sheet-label', coll === 'quotes' ? 'Prepared for' : 'Bill to'), h('div.sheet-strong', clientName(client)), h('div.sheet-small', [formatAddress(billing, { multiline: true }), primaryPhone(client), primaryEmail(client)].filter(Boolean).join('\n'))),
      property && property !== billing ? h('div', h('div.sheet-label', 'Service address'), h('div.sheet-small', formatAddress(property, { multiline: true }))) : null,
    ),
    doc.title || doc.subject ? h('h2.sheet-subject', doc.title || doc.subject) : null,
    lineItemsTable(doc.items, { showCost: false }),
    h('div.sheet-totals', totalsBlock(doc, { showDeposit: coll === 'quotes', paid })),
    doc.message ? h('section.sheet-note', h('div.sheet-label', 'Message'), h('p.message-block', doc.message)) : null,
    doc.disclaimer ? h('section.sheet-note', h('div.sheet-label', coll === 'quotes' ? 'Terms' : 'Notes'), h('p.message-block.sheet-small', doc.disclaimer)) : null,
    coll === 'quotes' && forPrint
      ? h('section.sheet-sign', h('div', h('div.sheet-line'), h('div.sheet-label', 'Client signature')), h('div', h('div.sheet-line'), h('div.sheet-label', 'Date')))
      : null,
  );
}

/** Print (or save as PDF from the print dialog). */
export function printDocument(coll, doc) {
  let root = document.getElementById('print-root');
  if (!root) {
    root = h('div#print-root', { 'aria-hidden': 'true' });
    document.body.append(root);
  }
  root.replaceChildren(documentSheet(coll, doc, { forPrint: true }));
  // Print only the document (a browser Print elsewhere prints the page).
  document.body.classList.add('printing-doc');
  const prevTitle = document.title;
  document.title = `${NOUN[coll]} ${doc.number} · ${clientName(lookup.client(doc.clientId))}`;
  const cleanup = () => {
    document.title = prevTitle;
    root.replaceChildren();
    document.body.classList.remove('printing-doc');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}

/** Plain-text summary used for email bodies and the clipboard. */
export function documentText(coll, doc) {
  const s = app.settings();
  const client = lookup.client(doc.clientId);
  const t = computeTotals(doc);
  const lines = [];
  const first = client?.firstName || clientName(client);
  lines.push(`Hi ${first},`, '');
  if (doc.message) lines.push(doc.message, '');
  lines.push(`${NOUN[coll]} #${doc.number}${doc.title || doc.subject ? `: ${doc.title || doc.subject}` : ''}`);
  for (const it of (doc.items || []).filter((i) => !i.optional || i.selected)) lines.push(`  ${it.name || 'Untitled item'} x ${it.qty}: ${money(Math.round(it.qty * it.unitPrice))}`);
  const optional = (doc.items || []).filter((i) => i.optional && !i.selected);
  if (optional.length) {
    lines.push('', 'Optional add-ons:');
    for (const it of optional) lines.push(`  ${it.name || 'Untitled item'}: ${money(Math.round(it.qty * it.unitPrice))}`);
  }
  lines.push('');
  if (t.discount) lines.push(`Discount: -${money(t.discount)}`);
  if (t.tax) lines.push(`Tax: ${money(t.tax)}`);
  lines.push(`Total: ${money(t.total)}`);
  if (coll === 'quotes' && t.deposit) lines.push(`Required deposit: ${money(t.deposit)}`);
  if (coll === 'invoices') {
    const paid = amountPaid(doc.id, app.store.all('payments'));
    if (paid) lines.push(`Paid: ${money(paid)}`, `Balance due: ${money(Math.max(0, t.total - paid))}`);
    if (doc.dueDate) lines.push(`Due: ${doc.terms === 'receipt' ? 'upon receipt' : formatDate(doc.dueDate)}`);
  }
  lines.push('', 'Thank you,', s.company.name || '');
  if (s.company.phone) lines.push(s.company.phone);
  return lines.join('\n');
}

/**
 * Send dialog. With a Puter session the message is emailed through the app's
 * email worker; it can also open in the person's own email app, or be copied.
 * onSent() runs when the document should be marked as sent.
 */
export function sendDialog(coll, doc, { onSent } = {}) {
  const s = app.settings();
  const client = lookup.client(doc.clientId);
  const kind = coll === 'quotes' ? 'quote' : 'invoice';
  const to = textInput({ type: 'email', value: primaryEmail(client), autocomplete: 'email', multiple: true });
  const subject = textInput({ value: `${NOUN[coll]} #${doc.number} from ${s.company.name || 'us'}` });
  const body = textarea({ value: documentText(coll, doc), rows: 12 });
  const canSend = !app.demo && mailerAvailable();
  const status = h('div', { role: 'status', 'aria-live': 'polite' });
  const { dialog } = openDialog({
    title: `Send ${NOUN[coll].toLowerCase()} #${doc.number}`,
    size: 'wide',
    body: h(
      'div.stack',
      h('div.form-grid', field('To', to, { hint: 'Separate several addresses with commas' }), field('Subject', subject), field('Message', body, { span2: true })),
      canSend
        ? h('div.notice', icon('info'), h('span', `Sent from Puter on your behalf${s.company.email ? `, with replies going to ${s.company.email}` : ''}. To attach a PDF, choose Print, then Save as PDF, and send it from your email app.`))
        : h('div.notice', icon('info'), h('span', app.demo ? 'Emailing is turned off in the demo. You can still open the message in your email app.' : 'This opens your email app with the message ready to send.')),
      status,
    ),
    footer: ({ close }) => {
      const record = (addresses) => {
        app.store.patch(coll, doc.id, (d) => ((d.emails = [...(d.emails || []), { to: addresses, at: new Date().toISOString() }].slice(-20)), d));
        onSent?.();
      };
      const sendBtn = canSend
        ? h(
            'button.btn.primary',
            {
              type: 'button',
              onClick: async () => {
                const parsed = parseRecipients(to.value);
                if (parsed.error) {
                  to.setAttribute('aria-invalid', 'true');
                  to.focus();
                  status.replaceChildren(h('p.error-text', parsed.error));
                  return;
                }
                sendBtn.disabled = true;
                sendBtn.replaceChildren(icon('loader', 16, 'spin'), 'Sending');
                try {
                  const out = await sendDocument({ kind, doc, settings: s, to: parsed.list, subject: subject.value, body: body.value });
                  const res = describeResult(out);
                  if (res.ok) {
                    // Only the addresses that got it: the rest were skipped or failed.
                    record(res.delivered.length ? res.delivered : parsed.list);
                    close();
                    toast(res.message, res.partial ? { type: 'info', duration: 9000 } : {});
                  } else status.replaceChildren(h('div.notice.danger', icon('alert'), h('span', res.message)));
                } catch (err) {
                  status.replaceChildren(h('div.notice.danger', icon('alert'), h('span', err.message)));
                } finally {
                  sendBtn.disabled = false;
                  sendBtn.replaceChildren(icon('send', 16), 'Send email');
                }
              },
            },
            icon('send', 16),
            'Send email',
          )
        : null;
      return [
        h(
          'button.btn',
          {
            type: 'button',
            // The visible label is hidden on phones; keep the button named.
            'aria-label': 'Copy',
            onClick: async () => {
              try {
                await navigator.clipboard.writeText(`${subject.value}\n\n${body.value}`);
                toast('Copied to clipboard');
              } catch {
                toast('Copy failed. Select the text and copy it manually.', { type: 'error' });
              }
            },
          },
          icon('copy', 16),
          h('span.hide-mobile', 'Copy'),
        ),
        h('button.btn', { type: 'button', 'aria-label': 'Print or PDF', onClick: () => printDocument(coll, app.store.get(coll, doc.id) || doc) }, icon('printer', 16), h('span.hide-mobile', 'Print or PDF')),
        h('div.spacer'),
        h('button.btn.ghost.hide-mobile', { type: 'button', onClick: () => (onSent?.(), close()) }, 'Mark as sent'),
        h(
          `button.btn${canSend ? '' : '.primary'}`,
          {
            type: 'button',
            onClick: () => {
              const href = `mailto:${encodeURIComponent(to.value.replace(/\s+/g, ''))}?subject=${encodeURIComponent(subject.value)}&body=${encodeURIComponent(body.value)}`;
              window.location.href = href;
              record(to.value.split(/[,;\s]+/).filter(Boolean));
              close();
            },
          },
          icon('mail', 16),
          'Open in email app',
        ),
        sendBtn,
      ];
    },
  });
  dialog.classList.add('send-dialog');
}

/** Timeline entries from a record's timestamps. */
export function timeline(entries) {
  const list = entries.filter((e) => e && e.at).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  if (!list.length) return null;
  return h(
    'ol.timeline',
    list.map((e) =>
      h(
        'li',
        h(`span.tl-icon${e.tone ? '.' + e.tone : ''}`, icon(e.icon || 'circle-dot', 14)),
        h('div', h('div.tl-title', e.label), h('div.tl-when', formatDate(e.at) + (e.at.length > 10 ? `, ${new Date(e.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''))),
      ),
    ),
  );
}

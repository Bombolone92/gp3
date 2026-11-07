import { el, clear, append } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import { docStatus, isOpenInvoice } from '../lib/doc.js';
import { docTotals, fmtMoney } from '../lib/money.js';
import {
  todayISO, daysBetween, fmtDate, freqLabel, ruleCompleted, remainingOccurrences,
} from '../lib/dates.js';
import { reminderNote, daysLate } from '../lib/reminders.js';
import { overdueAmount } from '../lib/aging.js';
import { docRow, emptyState, moneyLines, keepFocus } from '../ui/bits.js';

function sumBy(docs, pick) {
  const out = {};
  for (const d of docs) {
    const v = pick(d);
    if (v > 0.005) out[d.currency] = Math.round(((out[d.currency] || 0) + v) * 100) / 100;
  }
  return out;
}

export function dashboardView({ navigate }) {
  const root = el('div.view');

  function render() {
    const restoreFocus = keepFocus(root);
    clear(root);
    const today = todayISO();
    const docs = store.docs();
    const invoices = docs.filter((d) => d.kind === 'invoice');
    const quotes = docs.filter((d) => d.kind === 'quote');

    if (!docs.length) {
      root.append(
        el('div.page-head', {}, el('div', {},
          el('h1.page-title', {}, 'Home'),
          el('p.page-sub', {}, 'Your billing at a glance'))),
        emptyState('invoice', 'Nothing to bill yet',
          'Create your first invoice or estimate. It takes about a minute.',
          // Nothing to create from a device showing a saved copy, exactly as
          // the buttons above, the sidebar, and the FAB already know.
          store.readOnly ? null : el('div.empty-actions', {},
            el('button.btn.btn-primary', { onclick: () => navigate('#/new/invoice') }, 'New invoice'),
            el('button.btn', { onclick: () => navigate('#/new/quote') }, 'New estimate')))
      );
      restoreFocus();
      return;
    }

    const open = invoices.filter((d) => isOpenInvoice(d, today));
    const overdue = open.filter((d) => docStatus(d, today) === 'overdue');
    const paid30 = invoices.filter((d) => d.status !== 'void')
      .flatMap((d) => (d.payments || []).map((p) => ({ ...p, currency: d.currency })))
      .filter((p) => daysBetween(p.date, today) <= 30 && daysBetween(p.date, today) >= 0);
    const openQuotes = quotes.filter((d) => docStatus(d, today) === 'sent');

    const paid30Sum = {};
    for (const p of paid30) {
      paid30Sum[p.currency] = Math.round(((paid30Sum[p.currency] || 0) + p.amount) * 100) / 100;
    }

    // Empty buckets read as formatted money too; a bare "0" among
    // currency values looks like a rendering glitch.
    const zero = { zero: fmtMoney(0, store.settings.currency) };

    // append(), not root.append(): attentionCard() returns null when nothing
    // needs attention, and the DOM would render that as the text "null".
    append(root, [
      el('div.page-head', {},
        el('div', {},
          el('h1.page-title', {}, 'Home'),
          el('p.page-sub', {}, 'Your billing at a glance')),
        // Offline these lead to an editor that can only say so; every other
        // create button in the app is already disabled there.
        el('div.page-actions', {},
          el('button.btn', {
            disabled: store.readOnly,
            title: store.readOnly ? 'Reconnect to create documents' : null,
            onclick: () => navigate('#/new/quote'),
          }, 'New estimate'),
          el('button.btn.btn-primary', {
            html: icon('plus', 16, 1.8),
            disabled: store.readOnly,
            title: store.readOnly ? 'Reconnect to create documents' : null,
            onclick: () => navigate('#/new/invoice'),
          }, ' New invoice'))),

      el('div.stat-grid', {},
        statTile('Outstanding', moneyLines(sumBy(open, (d) => docTotals(d).balance), zero),
          `${open.length} open invoice${open.length === 1 ? '' : 's'}`, '#/invoices?f=sent'),
        // The money that is actually late: on a payment plan the installment
        // whose date has passed, not the whole balance — the Reports table
        // and the client's statement count it the same way.
        statTile('Overdue', moneyLines(sumBy(overdue, (d) => overdueAmount(d, today)), zero),
          overdue.length ? `${overdue.length} need${overdue.length === 1 ? 's' : ''} a nudge` : 'Nothing late',
          '#/invoices?f=overdue', overdue.length ? 'bad' : null),
        statTile('Collected, last 30 days', moneyLines(paid30Sum, zero),
          collectedCaption(paid30), '#/receipts'),
        statTile('Awaiting answer', moneyLines(sumBy(openQuotes, (d) => docTotals(d).total), zero),
          `${openQuotes.length} estimate${openQuotes.length === 1 ? '' : 's'} out`, '#/quotes?f=sent')),

      attentionCard(today, docs),

      el('section.card.list-card', {},
        el('div.card-head', {},
          el('h2.card-title', {}, 'Recent'),
          // Recent mixes invoices and estimates, which live on two different
          // pages, so "View all" promised a page that leaves half these rows
          // out. Name the destination instead — the same reason the card
          // above says "6 of 12 shown" rather than offering one way to see
          // three kinds of thing.
          el('a.card-link', { href: '#/invoices' }, 'All invoices')),
        el('div.doc-list', {}, docs.slice(0, 6).map((d) => docRow(d)))),
    ]);
    restoreFocus();
  }

  function statTile(label, valueNode, sub, href, tone = null) {
    return el(`a.stat-tile${tone ? `.tone-${tone}` : ''}`, { href },
      el('span.stat-label', {}, label),
      el('span.stat-value', {}, valueNode),
      el('span.stat-sub', {}, sub));
  }

  function attentionCard(today, docs) {
    const rows = [];
    for (const d of docs) {
      const s = docStatus(d, today);
      if (s === 'overdue') {
        // Late against the date the status was derived from — on a payment
        // plan that is the earliest installment still open, not the invoice's
        // own final date, which may still be months away and read as
        // "-118 days overdue".
        const days = daysLate(d, today);
        // On a payment plan only the part whose date has passed is late; the
        // rest is owed but not yet due, and "$1,980.00 due" beside "8 days
        // overdue" read as though all of it were. Whether this one has been
        // chased already is the difference between "needs a nudge" and
        // "needs a phone call".
        const { balance } = docTotals(d);
        const late = overdueAmount(d, today);
        const owed = late < balance - 0.005
          ? `${fmtMoney(late, d.currency)} of ${fmtMoney(balance, d.currency)} due`
          : `${fmtMoney(balance, d.currency)} due`;
        rows.push(attnRow(d, 'alert', 'bad',
          `${days} day${days === 1 ? '' : 's'} overdue · ${owed} · ${reminderNote(d, today)}`));
      } else if (d.kind === 'quote' && s === 'sent' && d.validUntil
        && daysBetween(today, d.validUntil) <= 7) {
        const days = daysBetween(today, d.validUntil);
        rows.push(attnRow(d, 'hourglass', 'warn',
          days === 0 ? 'Expires today' : `Expires in ${days} day${days === 1 ? '' : 's'}`));
      }
    }
    for (const r of store.recurring) {
      // A completed schedule drafts nothing, so it is not upcoming news.
      if (r.paused || ruleCompleted(r) || !r.nextDue) continue;
      const days = daysBetween(today, r.nextDue);
      if (days >= 0 && days <= 7) {
        const left = remainingOccurrences(r);
        rows.push(el('a.attn-row', { href: '#/recurring' },
          el('span.attn-ic.tone-info', { html: icon('repeat', 17, 1.6) }),
          el('span.attn-main', {},
            el('span.attn-title', {}, r.name || 'Recurring invoice'),
            el('span.attn-sub', {},
              `${freqLabel(r.freq)} · next on ${fmtDate(r.nextDue)}`
              + (left !== null ? ` · ${left} left` : ''))),
          el('span', { html: icon('chevR', 17), style: { color: 'var(--ink-3)' } })));
      }
    }
    if (!rows.length) return null;
    // The card is a summary, not the list, so it stops at six — but stopping
    // silently reads as "this is everything", and a card headed "needs
    // attention" hiding eight more things is the one place that must not.
    // No single "view all" is honest either: these rows are overdue invoices,
    // expiring estimates, and schedules coming due, which live on three
    // different pages. Say the count instead.
    const SHOWN = 6;
    return el('section.card.list-card', {},
      el('div.card-head', {},
        el('h2.card-title', {}, 'Needs attention'),
        rows.length > SHOWN
          ? el('span.side-note', {}, `${SHOWN} of ${rows.length} shown`)
          : null),
      el('div.doc-list', {}, rows.slice(0, SHOWN)));
  }

  /** "3 payments · 1 refund": the sum nets refunds, so the caption says
   *  they are in it rather than counting one as a payment. */
  function collectedCaption(paid30) {
    const payments = paid30.filter((p) => p.amount > 0).length;
    const refunds = paid30.length - payments;
    const words = [`${payments} payment${payments === 1 ? '' : 's'}`];
    if (refunds) words.push(`${refunds} refund${refunds === 1 ? '' : 's'}`);
    return words.join(' · ');
  }

  function attnRow(d, ic, tone, subText) {
    const client = store.client(d.clientId);
    return el('a.attn-row', { href: `#/doc/${d.id}` },
      el(`span.attn-ic.tone-${tone}`, { html: icon(ic, 17, 1.6) }),
      el('span.attn-main', {},
        el('span.attn-title', {}, `${d.number} · ${client ? (client.company || client.name || 'Client') : 'No client'}`),
        el('span.attn-sub', {}, subText)),
      el('span', { html: icon('chevR', 17), style: { color: 'var(--ink-3)' } }));
  }

  store.addEventListener('change', render);
  root.destroy = () => store.removeEventListener('change', render);
  render();
  return root;
}

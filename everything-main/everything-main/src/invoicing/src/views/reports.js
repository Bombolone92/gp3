/**
 * Reports: what was invoiced, what was collected, how much tax came with it,
 * and which clients it came from — for a year, a quarter, or a month.
 *
 * All arithmetic lives in lib/reports.js; this file only picks a period and
 * draws the result. Money is never summed across currencies: the tiles stack
 * one line per currency, and the tables show one currency at a time.
 */

import { el, clear, append } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { emptyState, moneyLines, download, keepFocus } from '../ui/bits.js';
import { store } from '../lib/store.js';
import { fmtMoney } from '../lib/money.js';
import { todayISO, yearOf, fmtDate } from '../lib/dates.js';
import {
  PERIOD_KINDS, reportFor, reportYears, reportCsv, summaryLines, periodLabel,
} from '../lib/reports.js';
import { AGING_BUCKETS, AGING_KEYS, aging } from '../lib/aging.js';

const MONTH_LABELS = Array.from({ length: 12 }, (_, i) => {
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'long' }).format(new Date(2026, i, 1));
  } catch {
    return `Month ${i + 1}`;
  }
});

export function reportsView({ params = {}, replaceParams = () => {} } = {}) {
  const root = el('div.view');
  const today = todayISO();

  // Default to the current year: the period a freelancer is living in — or
  // the period in the address, which is how Back from an aging cell's list
  // finds Q2 2025 still chosen instead of this year again.
  const kind = PERIOD_KINDS.some((k) => k.value === params.kind) ? params.kind : 'year';
  const year = /^\d{4}$/.test(String(params.year || '')) ? Number(params.year) : Number(yearOf(today));
  const index = Number(params.index);
  const period = {
    kind,
    year,
    index: Number.isInteger(index) && index >= 1 && index <= (kind === 'month' ? 12 : 4)
      ? index
      : kind === 'month' ? Number(today.slice(5, 7)) : Math.ceil(Number(today.slice(5, 7)) / 3),
  };
  let currency = /^[A-Z]{3}$/.test(String(params.cur || '')) ? params.cur : null; // which currency the tables show

  /** The period and currency, in the address: what Back comes back to. */
  function syncHash() {
    replaceParams({
      kind: period.kind === 'year' ? undefined : period.kind,
      year: period.year === Number(yearOf(today)) ? undefined : period.year,
      index: period.kind === 'year' ? undefined : period.index,
      cur: currency || undefined,
    });
  }

  // The currency the account thinks in. Read at render time, never snapshotted:
  // Settings can change it while this page is open.
  const baseCurrency = () => store.settings.baseCurrency || store.settings.currency || 'USD';

  const controls = el('div.rep-controls');
  const bodyWrap = el('div');

  function renderControls(years) {
    clear(controls);
    const kindSeg = el('div.segmented', { role: 'group', 'aria-label': 'Period type' },
      PERIOD_KINDS.map(({ value, label }) => el('button', {
        type: 'button',
        className: period.kind === value ? 'active' : '',
        'aria-pressed': period.kind === value ? 'true' : 'false',
        onclick: () => {
          if (period.kind === value) return;
          const from = period.kind;
          period.kind = value;
          // Moving to a shorter period keeps the part of "now" it needs —
          // and, in any other year, the part of the period it was on: Q3
          // opens on July, November on Q4. (Q3 used to keep index 3 and open
          // on March; November, past the fourth quarter, fell back to Q1.)
          if (period.year === Number(yearOf(today)) && value !== 'year') {
            const month = Number(today.slice(5, 7));
            period.index = value === 'month' ? month : Math.ceil(month / 3);
          } else if (value === 'month' && from === 'quarter') {
            period.index = (period.index - 1) * 3 + 1;
          } else if (value === 'quarter' && from === 'month') {
            period.index = Math.ceil(period.index / 3);
          } else if (period.index > (value === 'quarter' ? 4 : 12)) {
            period.index = 1;
          }
          render();
        },
      }, label)));

    const yearSelect = el('select.select', {
      'aria-label': 'Year',
      onchange: (e) => { period.year = Number(e.target.value); render(); },
    }, years.map((y) => el('option', { value: y, selected: Number(y) === period.year }, y)));

    const parts = period.kind === 'quarter'
      ? [1, 2, 3, 4].map((q) => [q, `Q${q}`])
      : MONTH_LABELS.map((label, i) => [i + 1, label]);
    const partSelect = el('select.select', {
      'aria-label': period.kind === 'quarter' ? 'Quarter' : 'Month',
      onchange: (e) => { period.index = Number(e.target.value); render(); },
    }, parts.map(([value, label]) => el('option', { value, selected: value === period.index }, label)));

    append(controls, [
      kindSeg,
      el('div.rep-selects', {},
        period.kind !== 'year' ? el('div.select-wrap', {}, partSelect) : null,
        el('div.select-wrap', {}, yearSelect)),
    ]);
  }

  function render() {
    // Every control here triggers the render that rebuilds it, and a store
    // change (a draft landing in the background) rebuilds it unasked — which
    // would drop keyboard focus to <body>. The shared helper finds the
    // rebuilt twin by name, then by position; its selector covers the aging
    // table's links and the keyboard-scrollable region, which the bespoke
    // version here (buttons and selects only) let fall through.
    const restoreFocus = keepFocus(root);

    const docs = store.docs();
    const years = reportYears(docs, today);
    if (!years.includes(String(period.year))) period.year = Number(years[0]);
    renderControls(years);

    const report = reportFor(docs, store.clients, period, { baseCurrency: baseCurrency() });
    // Aged as of the end of the period, or today when the period has not
    // ended yet: "60 days overdue" has to be counted from a real date, and
    // for the year you are living in that date is today.
    const aged = aging(docs, store.clients, {
      asOf: report.end < today ? report.end : today,
      // The same slice the "Still open" tile counts — everything issued up to
      // the end of the period — or a post-dated invoice sits in that figure
      // and is missing from the table underneath it.
      issuedThrough: report.end,
    });
    if (!currency || !report.currencies.includes(currency)) currency = report.currencies[0] || null;
    syncHash();

    clear(bodyWrap);
    exportBtn.disabled = !report.currencies.length;

    if (!report.currencies.length) {
      bodyWrap.append(emptyState('chart', `Nothing in ${report.label}`,
        'No invoices were issued, no payments came in, and nothing was left open. Try another period.'));
      restoreFocus();
      return;
    }

    const zero = { zero: fmtMoney(0, store.settings.currency) };
    // Counts belong to no currency, so they cover every one the tiles show.
    const invoiceCount = report.currencies.reduce((n, c) => n + report.totals[c].invoiceCount, 0);
    const paymentCount = report.currencies.reduce((n, c) => n + report.totals[c].paymentCount, 0);
    // append(): the currency chips and both cards may be null.
    append(bodyWrap, [
      el(`div.stat-grid${writtenOffAny(report) ? '.five' : ''}`, {},
        tile('Invoiced', summaryLines(report, 'invoiced'),
          `${invoiceCount} invoice${invoiceCount === 1 ? '' : 's'} issued in ${report.label}`, zero),
        tile('Collected', summaryLines(report, 'collected'),
          `${paymentCount} payment${paymentCount === 1 ? '' : 's'} received`, zero),
        tile('Tax collected', summaryLines(report, 'taxCollected'), 'On the part actually paid', zero),
        tile('Still open', summaryLines(report, 'open'), `Owed on documents up to ${fmtDate(report.end)}`, zero),
        // Only when there is one: a figure that reads $0.00 for every account
        // that has never written anything off is a tile earning no space.
        writtenOffAny(report)
          ? tile('Written off', summaryLines(report, 'writtenOff'),
            `Invoiced in ${report.label} and given up on`, zero)
          : null),
      el('p.rep-note', {},
        'Invoiced counts documents issued in the period; collected counts payments received in it. '
        + 'Tax collected is each invoice’s tax prorated by how much of it has been paid.'
        + (writtenOffAny(report)
          ? ' Written off is the part of what you invoiced that you have decided will never arrive; it stays invoiced and no longer counts as open.'
          : '')),
      baseCard(report),
      report.currencies.length > 1 ? currencyChips(report) : null,
      seriesCard(report),
      agingCard(aged, report.end),
      taxCard(report),
      clientsCard(report),
    ]);
    restoreFocus();
  }

  /**
   * The one figure a tax return wants and the per-currency tables cannot
   * give: everything in the user's own money, converted at the rate stored
   * on each document. Only for an account that bills in more than one
   * currency — otherwise it would restate the table above it — and it never
   * hides what it had to leave out.
   */
  function baseCard(report) {
    const b = report.base;
    if (!b?.foreign) return null;
    const row = (label, value) => el('div.rep-client', {},
      el('span.rep-client-main', {}, el('span.rep-client-name', {}, label)),
      el('span.rep-client-amount', {}, fmtMoney(value, b.currency)));
    const missing = [
      b.missingInvoiced && `${b.missingInvoiced} invoice${b.missingInvoiced === 1 ? '' : 's'}`,
      b.missingCollected && `${b.missingCollected} payment${b.missingCollected === 1 ? '' : 's'}`,
      b.missingOpen && `${b.missingOpen} open balance${b.missingOpen === 1 ? '' : 's'}`,
    ].filter(Boolean).join(', ');
    return el('section.card.list-card', {},
      el('div.card-head', {},
        el('h2.card-title', {}, `All currencies in ${b.currency}`),
        el('span.side-note', {}, 'Converted per document')),
      el('div.rep-rows', {},
        row('Invoiced', b.invoiced),
        row('Collected', b.collected),
        row('Tax collected', b.taxCollected),
        row('Still open', b.open)),
      el('p.rep-note.age-note', {},
        'Converted at the exchange rate stored on each document, which you enter when you bill in '
        + 'another currency — nothing is fetched from the internet.',
        missing
          ? el('strong', {}, ` ${missing} carry no rate and are left out of these four figures.`)
          : null));
  }

  /**
   * Outstanding by age: buckets across, clients down, per currency. The one
   * table here that changes what you do next — money that is ninety days out
   * is a phone call, not a line in a report — so every cell is a link to the
   * invoices behind it.
   */
  function agingCard(aged, issuedThrough) {
    const rows = aged.clients[currency] || [];
    if (!rows.length) return null;
    const totals = aged.totals[currency];
    // The totals row belongs to no one client, so it carries no name of its
    // own: its cells have to borrow the heading the row shows, or every link
    // on the bottom line announces itself as “… undefined”.
    const ALL = 'All clients';
    const cell = (row, key, isTotal) => {
      const value = row[key];
      const label = AGING_BUCKETS.find((b) => b.key === key).label;
      if (Math.abs(value) <= 0.005) {
        return el('td.age-cell.age-zero', {}, el('span', {}, '—'),
          el('span.sr-only', {}, `${label}: nothing`));
      }
      const text = fmtMoney(value, currency);
      // Every figure is a way into the invoices it stands for, with the
      // client carried along so a row's cell lands on that client's slice —
      // and, for a period that has ended, the date the table is aged as of.
      // The list buckets by today unless told otherwise, and today's buckets
      // are not last quarter's: an invoice this table shows as not yet due
      // on the last day of July is thirty days late by the time it is looked
      // up, and the cell opened a list that could not find it.
      const asOf = aged.asOf !== today ? `&asof=${aged.asOf}` : '';
      // A period still running is aged as of today but cut at its own end,
      // so an invoice post-dated past the end is in neither the tile nor
      // this table — and was in the list the cell opened, which bounded
      // issue dates only when an as-of date came along.
      const through = issuedThrough !== aged.asOf ? `&through=${issuedThrough}` : '';
      const href = `#/invoices?f=sent&age=${key}${isTotal ? '' : `&client=${encodeURIComponent(row.id)}`}${asOf}${through}`;
      return el('td.age-cell', {},
        el('a.age-link', {
          href, 'aria-label': `${text} ${label}, ${isTotal ? ALL : row.name}`,
        }, text));
    };
    const bodyRow = (row, isTotal) => el(`tr${isTotal ? '.age-total-row' : ''}`, {},
      el(isTotal ? 'th' : 'td', isTotal ? { scope: 'row' } : {},
        isTotal ? ALL : row.name),
      ...AGING_KEYS.map((key) => cell(row, key, isTotal)),
      el('td.age-cell.age-sum', {}, fmtMoney(row.total, currency)));

    return el('section.card.list-card', {},
      el('div.card-head', {},
        el('h2.card-title', {}, `Outstanding by age · ${currency}`),
        el('span.side-note', {}, `As of ${fmtDate(aged.asOf)}`)),
      // Keyboard-scrollable in its own right: at 320px (or 400% zoom) the
      // last columns are out of view, and nothing inside is focusable.
      el('div.age-scroll', { tabindex: '0', role: 'region', 'aria-label': `Outstanding by age, ${currency}` },
        el('table.age-table', {},
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col' }, 'Client'),
            ...AGING_BUCKETS.map((b) => el('th.age-cell', { scope: 'col' }, b.label)),
            el('th.age-cell', { scope: 'col' }, 'Total'))),
          el('tbody', {},
            rows.map((r) => bodyRow(r, false)),
            rows.length > 1 ? bodyRow(totals, true) : null))),
      el('p.rep-note.age-note', {},
        'Counted from each invoice’s due date — each installment’s own, on a payment plan — on what '
        + 'is still unpaid. Drafts, void, written-off, and settled invoices are not here.'));
  }

  /**
   * Tax collected, one line per named rate — what a GST + PST filer copies
   * into each return. With a single rate the tile already says it all.
   */
  function taxCard(report) {
    const rows = Object.entries(report.totals[currency]?.taxByLabel || {})
      .filter(([, v]) => Math.abs(v) > 0.005);
    if (rows.length < 2) return null;
    return el('section.card.list-card', {},
      el('div.card-head', {},
        el('h2.card-title', {}, `Tax collected by rate · ${currency}`),
        el('span.side-note', {}, 'Prorated by what was paid')),
      el('div.rep-rows', {}, rows.map(([label, v]) => el('div.rep-client', {},
        el('span.rep-client-main', {}, el('span.rep-client-name', {}, label)),
        el('span.rep-client-amount', {}, fmtMoney(v, currency))))));
  }

  /** Has anything in this period been written off? */
  const writtenOffAny = (report) => report.currencies
    .some((c) => Math.abs(report.totals[c].writtenOff) > 0.005);

  function tile(label, lines, sub, zero) {
    return el('div.stat-tile.static', {},
      el('span.stat-label', {}, label),
      el('span.stat-value', {}, moneyLines(lines, zero)),
      el('span.stat-sub', {}, sub));
  }

  function currencyChips(report) {
    const row = el('div.chip-row', { role: 'group', 'aria-label': 'Currency' });
    for (const code of report.currencies) {
      row.append(el('button.chip', {
        type: 'button',
        className: `chip${code === currency ? ' active' : ''}`,
        'aria-pressed': code === currency ? 'true' : 'false',
        onclick: () => { currency = code; render(); },
      }, code));
    }
    return row;
  }

  /**
   * Month by month, as a table with the bars beside the numbers: two series,
   * so the legend is always there and every value is also written out.
   */
  function seriesCard(report) {
    const rows = report.series[currency] || [];
    if (rows.length < 2) return null;
    const peak = Math.max(...rows.flatMap((r) => [Math.abs(r.invoiced), Math.abs(r.collected)]), 0);
    const width = (v) => (peak > 0 ? `${Math.max(Math.abs(v) / peak * 100, v ? 1.5 : 0)}%` : '0%');

    return el('section.card.list-card', {},
      el('div.card-head', {},
        el('h2.card-title', {}, `Month by month · ${currency}`),
        el('div.rep-legend', {},
          el('span.rep-key', {}, el('span.rep-swatch.s1'), 'Invoiced'),
          el('span.rep-key', {}, el('span.rep-swatch.s2'), 'Collected'))),
      el('div.rep-rows', {}, rows.map((r) => el('div.rep-row', {},
        el('span.rep-month', {}, r.label),
        el('span.rep-bars', {},
          el('span.rep-bar.s1', { style: { width: width(r.invoiced) } }),
          el('span.rep-bar.s2', { style: { width: width(r.collected) } })),
        // Which figure is which lived in a title tooltip and in the colour of
        // the bar beside it — nothing a screen reader or a finger can reach.
        // The words go in the cell, the way the aging table's empty cells say
        // "nothing" out loud.
        el('span.rep-val', { title: `Invoiced in ${r.label}` },
          el('span.sr-only', {}, 'Invoiced '), fmtMoney(r.invoiced, currency)),
        el('span.rep-val.rep-val-2', { title: `Collected in ${r.label}` },
          el('span.sr-only', {}, 'Collected '), fmtMoney(r.collected, currency))))));
  }

  function clientsCard(report) {
    const rows = report.clients[currency] || [];
    if (!rows.length) return null;
    const peak = Math.max(...rows.map((r) => Math.abs(r.collected)), 0);
    return el('section.card.list-card', {},
      el('div.card-head', {},
        el('h2.card-title', {}, `By client · ${currency}`),
        el('span.side-note', {}, 'Ranked by what they paid')),
      el('div.rep-rows', {}, rows.map((r) => el('div.rep-client', {},
        el('span.rep-client-main', {},
          el('span.rep-client-name', {}, r.name),
          el('span.rep-client-sub', {},
            `${fmtMoney(r.invoiced, currency)} invoiced`,
            Math.abs(r.open) > 0.005 ? ` · ${fmtMoney(r.open, currency)} open` : ''),
          el('span.rep-client-track', {},
            el('span.rep-bar.s2', {
              style: { width: peak > 0 ? `${Math.max(Math.abs(r.collected) / peak * 100, r.collected ? 1.5 : 0)}%` : '0%' },
            }))),
        el('span.rep-client-amount', {}, fmtMoney(r.collected, currency))))));
  }

  const exportBtn = el('button.btn', {
    html: icon('download', 16, 1.6),
    onclick: () => {
      const docs = store.docs();
      const report = reportFor(docs, store.clients, period, { baseCurrency: baseCurrency() });
      if (!report.currencies.length) {
        toast('Nothing to export in this period', { icon: 'alert' });
        return;
      }
      const aged = aging(docs, store.clients, {
        asOf: report.end < today ? report.end : today,
        issuedThrough: report.end,
      });
      download(`invoicing-report-${periodLabel(period).replace(/\s+/g, '-')}.csv`,
        reportCsv(report, aged), 'text/csv');
      toast('Report exported', { icon: 'download' });
    },
  }, ' Export CSV');

  root.append(
    el('div.page-head', {},
      el('div', {},
        el('h1.page-title', {}, 'Reports'),
        el('p.page-sub', {}, 'Income, tax collected, and where it came from')),
      el('div.page-actions', {}, exportBtn)),
    controls,
    bodyWrap);

  render();
  store.addEventListener('change', render);
  root.destroy = () => store.removeEventListener('change', render);
  return root;
}

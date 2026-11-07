/**
 * Reports: the three things an auditor, a tax preparer, or counsel asks a
 * cap table for at year end, computed from records the app already holds.
 *
 *  - Stock-based compensation (ASC 718): what every option grant and RSU
 *    award was worth on its grant date, and how much of that cost belongs to
 *    the fiscal period being reported.
 *  - Rule 701: whether the last twelve months of compensatory grants fit the
 *    exemption they were sold under, and whether the enhanced-disclosure
 *    threshold has been crossed.
 *  - Form 3921: one row per ISO exercise in a calendar year, in the shape the
 *    form's boxes ask for, with the deadlines that follow.
 *
 * Each tab keeps its controls out of the part it re-renders, the way the cap
 * table view does, so changing a period never takes focus with it. The
 * period, as-of date, and year are module state so they survive the store-
 * driven re-render a save triggers, and reset when the dataset changes.
 */

import { el, append } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { viewHead, segmented, statTile, holderCell, emptyState } from '../ui/bits.js';
import { openSecurityForm } from '../ui/securityform.js';
import { openCertifyForm } from '../ui/grantactions.js';
import { openReportingForm, MONTH_NAMES } from '../ui/reportingform.js';
import { openValuationForm } from '../ui/valuationform.js';
import { store } from '../lib/store.js';
import {
  reportingOf, expenseReady, expenseReport, fiscalPeriod, fiscalYearOf, fiscalYearsAvailable,
  rule701Report, compensatorySales, form3921Report, RULE_701, DEFAULT_CONTRACT_YEARS,
} from '../lib/reports.js';
import {
  money, moneyWhole, moneyCompact, sharePrice, shares, sharesLabel, dateLong, currencyCode,
} from '../lib/format.js';
import { toCSV, downloadFile, todayISO, round2, monthsBetween } from '../lib/util.js';

const TABS = [
  { value: 'expense', label: 'Stock comp expense' },
  { value: 'rule701', label: 'Rule 701' },
  { value: 'form3921', label: 'Form 3921' },
];

/* Rule 701's figures are written in US dollars whatever the company banks
   in, so they are printed as dollars rather than run through the company's
   own currency formatter - which would relabel a $1,000,000 floor as
   £1,000,000 and mean something the rule never said. */
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdCompact = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1,
});

let tab = 'expense';
let fyYear = null;
let quarter = 0;
let asOfInput = '';
let year3921 = null;
let epoch = null;

export function reportsView() {
  if (epoch !== store.dataEpoch) {
    epoch = store.dataEpoch;
    fyYear = null;
    quarter = 0;
    asOfInput = '';
    year3921 = null;
  }

  /* One export button for the view; each tab hands it the spreadsheet it
     currently shows, or nothing with the reason on the button. */
  let exporter = null;
  const exportBtn = el('button.btn.btn-ghost', {
    html: icon('download', 15, 2), onclick: () => exporter?.(),
  }, ' Export CSV');
  const setExporter = (fn, reason = 'Nothing to export yet') => {
    exporter = fn;
    exportBtn.disabled = !fn;
    if (fn) exportBtn.removeAttribute('title');
    else exportBtn.title = reason;
  };

  const body = el('div');
  const tabs = segmented(TABS, {
    label: 'Report', value: tab, extraClass: 'seg-scroll',
    onSelect: (value) => { tab = value; render(); },
  });

  function render() {
    const ctx = { setExporter };
    // A tab hands back a node or a list of them; append flattens either.
    body.replaceChildren();
    append(body, [
      tab === 'expense' ? expenseTab(ctx)
        : tab === 'rule701' ? rule701Tab(ctx)
          : form3921Tab(ctx),
    ]);
  }

  render();
  /* The controls stay off the paper: a printed report carried its Export
     button, its tabs, its period pickers and its Edit button, the way no
     other printable page here does. */
  return el('div', {},
    viewHead('Reports', 'Stock comp expense, Rule 701, and Form 3921', el('div.no-print', {}, exportBtn)),
    el('div.no-print', { style: { marginBottom: '14px' } }, tabs),
    body,
    el('p.small.muted', { style: { textAlign: 'center', margin: '18px 0 20px' } },
      'Cap Table is a tool, not accounting, tax, or legal advice. Confirm anything that matters with your auditor and counsel.'));
}

/* ---------- Shared pieces ---------- */

/** The assumptions in force, one row each, with the sheet that edits them. */
function assumptionsCard(rows) {
  const editBtn = el('button.btn.btn-ghost.no-print', {
    html: icon('pencil', 15, 2), onclick: () => openReportingForm(),
    'aria-label': 'Edit reporting assumptions',
    dataset: { focusKey: 'reports:assumptions' },
  }, ' Edit');
  return el('div.settings-card', { style: { marginBottom: '16px' } },
    rows.map(([title, sub], i) => el('div.settings-row', {},
      el('div.grow', {}, el('div.t', {}, title), sub ? el('div.s', {}, sub) : null),
      i === 0 ? editBtn : null)));
}

const th = (label, num = false) => el(num ? 'th.num' : 'th', { scope: 'col' }, label);

function holderLink(stakeholderId, sub = null) {
  const holder = store.stakeholder(stakeholderId);
  return holderCell(holder, sub, {
    href: holder ? `#/stakeholders/${encodeURIComponent(holder.id)}` : null,
  });
}

const holderName = (id) => store.stakeholder(id)?.name || 'Unknown holder';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* replaceChildren() writes a null child out as the word "null"; append()
   skips it, the way every other view here builds optional cards. */
function fill(node, ...children) {
  node.replaceChildren();
  append(node, children);
}

/* ---------- Stock-based compensation ---------- */

function expenseTab({ setExporter }) {
  const db = store.db;
  const reporting = reportingOf(db.company);
  const today = todayISO();
  const awards = db.securities.filter((s) => s.kind === 'option' || s.kind === 'rsu');

  const assumptions = assumptionsCard([
    ['Option valuation', reporting.volatility > 0
      ? [
        `${reporting.volatility}% volatility`,
        `${reporting.riskFreeRate}% risk-free rate`,
        reporting.expectedTermYears > 0
          ? `${reporting.expectedTermYears}-year expected term`
          : 'expected term by the simplified method',
      ].join(' · ')
      : 'Volatility and risk-free rate not set'],
    ['Attribution', `${reporting.attribution === 'graded' ? 'Graded, tranche by tranche' : 'Straight-line over each award'}`
      + ` · fiscal year ends in ${MONTH_NAMES[reporting.fiscalYearEnd - 1]}`],
  ]);

  if (!awards.length) {
    setExporter(null, 'Grant an option or RSU first');
    return [assumptions, el('div.card', {}, emptyState({
      icon: 'chart',
      title: 'No awards to expense yet',
      text: 'Option grants and RSU awards are valued on their grant date and their cost spread over vesting. Grant one and the schedule appears here.',
      cta: 'Issue security',
      onCta: () => openSecurityForm(),
    }))];
  }
  if (!expenseReady(db)) {
    setExporter(null, 'Set the valuation assumptions first');
    return [assumptions, el('div.card', {}, emptyState({
      icon: 'landmark',
      title: 'Set your valuation assumptions',
      text: 'An option is valued with Black-Scholes, which needs an expected volatility and a risk-free rate. Your auditor or 409A provider will have both.',
      cta: 'Set assumptions',
      onCta: () => openReportingForm(),
    }))];
  }

  const years = fiscalYearsAvailable(db, today, reporting.fiscalYearEnd);
  if (!years.includes(fyYear)) fyYear = fiscalYearOf(today, reporting.fiscalYearEnd);
  if (!years.includes(fyYear)) fyYear = years[years.length - 1];

  const resultWrap = el('div');

  function renderResult() {
    const period = fiscalPeriod(fyYear, reporting.fiscalYearEnd, quarter);
    const report = expenseReport(db, period);
    const t = report.totals;
    const forfeitedRows = report.rows.filter((r) => r.forfeitedInPeriod > 0).length;
    const code = currencyCode();

    /* Two words per caveat, with the whole sentence on hover and in the CSV:
       a column of full sentences stacked the table three lines tall per row. */
    const FLAG_LABEL = {
      'strike-as-fmv': 'Strike as share price',
      'term-assumed': `${DEFAULT_CONTRACT_YEARS}-year term assumed`,
      unvalued: 'No 409A at grant',
      'service-at-grant': 'Service starts at grant (assumed)',
    };
    /* What the cumulative column is through: the period's end, which is
       ahead of today for the current fiscal year, behind it for an earlier
       one - and "to date" only when the two coincide. Said either way, since
       a past period's figure is not what has been recognized by today. */
    const recognized = period.end > today ? 'Recognized by period end'
      : period.end < today ? 'Recognized through period end' : 'Recognized to date';
    const rows = report.rows.map((r) => {
      const s = r.security;
      const caveats = r.flags.map((f, i) => el('div.small.muted', { title: r.notes[i] || null }, FLAG_LABEL[f] || f));
      /* One line per forfeiture, with its size: "Forfeited Jun 1" on a
         grant that lost 10,000 of 90,000 read as the whole award gone, and
         a second cancellation was filed under the first one's date. The
         period's own forfeitures are the ones flagged. */
      for (const f of r.forfeitures) {
        const inPeriod = f.date >= period.start && f.date <= period.end;
        caveats.push(el(`div.small${inPeriod ? '.warn' : '.muted'}`, {},
          `${shares(f.quantity)} forfeited ${dateLong(f.date)}`));
      }
      return el('tr', {},
        el('td', {}, holderLink(r.stakeholderId)),
        el('td', { style: { minWidth: '170px' } },
          el('div', {}, el('span.kind-pill', {}, s.kind === 'rsu' ? 'RSU' : 'Options'), ` ${s.label}`),
          caveats),
        el('td', { style: { whiteSpace: 'nowrap' } }, dateLong(r.granted)),
        el('td.num', {}, shares(r.units)),
        el('td.num', {}, r.perUnit === null ? el('span.warn', {}, 'Not valued') : sharePrice(r.perUnit)),
        el('td.num', {}, money(r.fairValue)),
        el(`td.num${r.expense < -0.005 ? '.neg' : ''}`, {}, money(r.expense)),
        el('td.num', {}, money(r.cumulative)),
        el('td.num', {}, money(r.unrecognized)));
    });

    fill(resultWrap,
      el('div.stat-grid', {},
        statTile({
          label: `Expense · ${period.label}`, icon: 'coins',
          value: moneyCompact(t.expense),
          sub: forfeitedRows
            ? `${money(t.expense)} · ${plural(forfeitedRows, 'forfeiture')} reversed this period`
            : `${money(t.expense)} · ${dateLong(period.start)} to ${dateLong(period.end)}`,
        }),
        /* The current fiscal year is the default period and runs past
           today, so the figure is what will have been recognized by its end,
           not what has been: a "to date" tile through a future date said
           otherwise. */
        statTile({
          label: recognized, icon: 'check',
          value: moneyCompact(t.cumulative),
          sub: period.end > today
            ? `Through ${dateLong(period.end)} · ${plural(Math.max(1, monthsBetween(today, period.end)), 'month')} still to come`
            : `Through ${dateLong(period.end)}`,
        }),
        statTile({
          label: 'Unrecognized cost', icon: 'clock',
          value: moneyCompact(t.unrecognized),
          sub: t.unrecognized > 0
            ? `Over ${t.remainingYears.toFixed(1)} years, weighted average`
            : report.rows.length ? 'Every award granted is fully recognized'
              : `No awards granted by ${dateLong(period.end)}`,
        }),
        statTile({
          label: 'Grant-date fair value', icon: 'pie',
          value: moneyCompact(t.fairValue),
          sub: plural(report.rows.length, 'award') + ' granted by the period end',
        })),
      el('div.table-wrap', { tabindex: 0, role: 'region', 'aria-label': 'Stock-based compensation table' },
        el('table.data', { style: { minWidth: '900px' } },
          el('caption.visually-hidden', {}, `Stock-based compensation, ${period.label}`),
          el('thead', {}, el('tr', {},
            th('Holder'), th('Award'), th('Granted'), th('Units', true),
            th('Fair value per unit', true), th('Grant-date value', true),
            th(`Expense ${period.label}`, true), th(recognized, true), th('Unrecognized', true))),
          el('tbody', {}, rows.length ? rows : el('tr', {}, el('td.muted', { colSpan: 9 },
            `No awards granted by ${dateLong(period.end)}`))),
          el('tfoot', {}, el('tr', {},
            el('td', { colSpan: 5 }, 'Total'),
            el('td.num', {}, money(t.fairValue)),
            el(`td.num${t.expense < -0.005 ? '.neg' : ''}`, {}, money(t.expense)),
            el('td.num', {}, money(t.cumulative)),
            el('td.num', {}, money(t.unrecognized)))))),
      el('p.small.muted', { style: { marginTop: '12px' } },
        'Grant-date fair value is Black-Scholes for options, with the 409A in force on the grant date as the share price and no dividends, '
        + 'and the 409A price itself for RSUs. The expected term follows the simplified method unless a term is set, and a grant with no '
        + `expiration is taken to run ${DEFAULT_CONTRACT_YEARS} years. Cost is attributed from the grant date, and a cancellation forfeits `
        + 'whatever had not vested, reversing its cost in that period. Not modeled: modifications and repricings, performance conditions, '
        + `liquidity conditions on RSUs, and tax effects. Amounts in ${code}.`));

    // Nothing to hand anyone for a period with no awards: the file would be
    // a header and a row of zeros.
    setExporter(report.rows.length ? () => exportExpense(report, period, reporting) : null,
      `No awards granted by ${dateLong(period.end)}`);
  }

  /* Named after the caption it sits beside, the way the cap table's date
     field starts with "As of": the bar's one visible word is "Period", and a
     select announced as "Fiscal year" alone had no name a voice-control user
     could read off the screen. */
  const yearSelect = el('select.select', {
    'aria-label': 'Period, fiscal year',
    onchange: (e) => { fyYear = Number(e.target.value); renderResult(); },
  }, years.map((y) => el('option', { value: String(y), selected: y === fyYear }, `FY${y}`)));
  const quarterSeg = segmented([
    { value: 0, label: 'Full year' },
    { value: 1, label: 'Q1' }, { value: 2, label: 'Q2' }, { value: 3, label: 'Q3' }, { value: 4, label: 'Q4' },
  ], {
    label: 'Period', value: quarter, extraClass: 'seg-scroll',
    onSelect: (value) => { quarter = value; renderResult(); },
  });

  renderResult();
  return [
    assumptions,
    el('div.asof-bar.no-print', {},
      el('span.small.muted.asof-label', {}, 'Period'),
      el('div.select-wrap', {}, yearSelect),
      quarterSeg),
    resultWrap,
  ];
}

function exportExpense(report, period, reporting) {
  const code = currencyCode();
  const term = reporting.expectedTermYears > 0 ? `${reporting.expectedTermYears}-year expected term` : 'simplified-method expected term';
  const rows = [
    [`${store.company.name || 'Company'} - stock-based compensation (ASC 718) - ${period.label} - ${period.start} to ${period.end} - amounts in ${code}`],
    [`Assumptions: ${reporting.volatility}% volatility, ${reporting.riskFreeRate}% risk-free rate, ${term}, ${reporting.attribution === 'graded' ? 'graded' : 'straight-line'} attribution, forfeitures as they occur`],
    [],
    ['Holder', 'Award', 'Type', 'Grant date', 'Units', `Fair value per unit (${code})`, `Grant-date fair value (${code})`,
      `Expense ${period.label} (${code})`, `Recognized through ${period.end} (${code})`, `Unrecognized (${code})`,
      'Remaining years', 'Forfeited on', 'Notes'],
  ];
  for (const r of report.rows) {
    rows.push([
      holderName(r.stakeholderId),
      r.security.label,
      r.security.kind === 'rsu' ? 'RSU' : (r.security.optionType === 'iso' ? 'Options (ISO)' : 'Options (NSO)'),
      r.granted,
      r.units,
      r.perUnit === null ? '' : r.perUnit.toFixed(4),
      r.fairValue.toFixed(2),
      /* A number, not a fixed-decimal string: the expense is the one column
         here that can be negative (a forfeiture reversal), and the CSV
         writer prefixes a string that opens with a minus sign with an
         apostrophe to defuse formulas - which would turn the figure into
         text a spreadsheet cannot sum. */
      round2(r.expense),
      r.cumulative.toFixed(2),
      r.unrecognized.toFixed(2),
      r.unrecognized > 0 ? r.remainingYears.toFixed(2) : '',
      r.forfeitures.map((f) => `${f.date} (${f.quantity})`).join('; '),
      r.notes.join('; '),
    ]);
  }
  const t = report.totals;
  rows.push(['Total', '', '', '', '', '', t.fairValue.toFixed(2), round2(t.expense), t.cumulative.toFixed(2),
    t.unrecognized.toFixed(2), t.unrecognized > 0 ? t.remainingYears.toFixed(2) : '', '', '']);
  downloadFile(`stock-comp-${period.label.replace(/\s+/g, '-')}.csv`, toCSV(rows), 'text/csv');
}

/* ---------- Rule 701 ---------- */

function rule701Tab({ setExporter }) {
  const db = store.db;
  const reporting = reportingOf(db.company);
  const today = todayISO();
  const asOf = () => asOfInput || today;

  const assumptions = assumptionsCard([
    ['Total assets', reporting.totalAssets > 0
      ? `${moneyWhole(reporting.totalAssets)} at the last fiscal year end · fiscal year ends in ${MONTH_NAMES[reporting.fiscalYearEnd - 1]}`
      : `Not set, so the 15%-of-assets ceiling is skipped · fiscal year ends in ${MONTH_NAMES[reporting.fiscalYearEnd - 1]}`],
  ]);

  if (!compensatorySales(db).length) {
    setExporter(null, 'No compensatory sales to report');
    return [assumptions, el('div.card', {}, emptyState({
      icon: 'landmark',
      title: 'No compensatory sales yet',
      text: 'Rule 701 counts option grants at their strike, RSU awards at the 409A price, and stock sold to employees and advisors. Grant one and the trailing twelve months appear here.',
      cta: 'Issue security',
      onCta: () => openSecurityForm(),
    }))];
  }

  const resultWrap = el('div');

  function renderResult() {
    const report = rule701Report(db, { asOf: asOf() });
    const { limits, passes } = report;
    const foreign = report.currency !== 'USD';
    const via = passes.floor ? `Under the ${usd.format(RULE_701.floor)} floor`
      : passes.assets ? 'Under 15% of total assets'
        : passes.classShares ? 'Under 15% of the outstanding class'
          : 'Over every ceiling';

    const check = (ok, text, detail) => el('div.activity-item', {},
      el(`span.activity-ic${ok === null ? '' : ok ? '.pos' : '.neg'}`, {
        html: icon(ok === null ? 'info' : ok ? 'check' : 'x', 15, 2.2),
      }),
      el('span.grow', {}, el('div', {}, text), detail ? el('div.small.muted', {}, detail) : null),
      el(`span.activity-time${ok === false ? '.warn' : ''}`, {}, ok === null ? 'Not set' : ok ? 'Within' : 'Exceeded'));

    const salesRows = report.sales.map((s) => el('tr', {},
      el('td', {}, dateLong(s.date)),
      el('td', {}, holderLink(s.stakeholderId)),
      el('td', {},
        el('span.kind-pill', {}, s.security.kind === 'option' ? 'Options' : s.security.kind === 'rsu' ? 'RSU' : 'Shares'),
        ` ${s.security.label}`),
      el('td.num', {}, shares(s.shares)),
      el('td.num', {}, s.price === null ? el('span.warn', {}, 'No 409A at grant') : money(s.price)),
      el('td', {}, s.basis === 'strike' ? 'Strike at grant' : s.basis === 'fmv' ? '409A at grant' : 'Issue price')));

    const flagged = report.history.filter((h) => !h.compliant || h.disclosureRequired);

    fill(resultWrap,
      el('div.stat-grid', {},
        statTile({
          label: 'Sales price, trailing 12 months', icon: 'coins',
          value: moneyCompact(report.salesPrice),
          sub: `${sharesLabel(report.sharesSold)} · ${dateLong(report.windowStart)} to ${dateLong(report.asOf)}`,
        }),
        statTile({
          label: 'Exemption', icon: 'shield',
          value: report.compliant ? 'Within' : 'Exceeded',
          sub: via,
        }),
        statTile({
          label: 'Disclosure threshold', icon: 'alert',
          value: report.disclosureRequired ? 'Crossed' : usdCompact.format(Math.max(0, RULE_701.disclosure - report.salesPrice)),
          sub: report.disclosureRequired
            ? 'Financial statements and risk factors go to every recipient'
            : `Of headroom under ${usdCompact.format(RULE_701.disclosure)} in any twelve months`,
        }),
        report.peak ? statTile({
          label: 'Highest trailing total', icon: 'trending-up',
          value: moneyCompact(report.peak.salesPrice),
          sub: `Twelve months ending ${dateLong(report.peak.date)}`,
        }) : null),

      el('div.card', { style: { marginBottom: '16px' } },
        el('h2.card-title', {}, 'Ceilings'),
        el('p.card-sub', { style: { marginBottom: '6px' } },
          'Any one of the three is enough. The outstanding class is measured at the last fiscal year end, as the rule directs'),
        el('div.activity-list', {},
          check(passes.floor, `${usd.format(RULE_701.floor)} in any twelve months`,
            `Aggregate sales price ${money(report.salesPrice)}`),
          check(limits.assets === null ? null : passes.assets, '15% of total assets',
            limits.assets === null
              ? 'Record total assets in the assumptions to test this ceiling'
              : `${moneyWhole(limits.assets)} against ${money(report.salesPrice)} sold`),
          check(passes.classShares, '15% of the outstanding class',
            `${sharesLabel(limits.classShares)} against ${shares(report.sharesSold)} sold · `
            + `${shares(report.classOutstanding)} outstanding on ${dateLong(report.measuredAt)}, warrants included, Rule 701 options excluded`)),
        foreign ? el('p.small.warn', { style: { marginTop: '10px' } },
          `Your figures are in ${report.currency}. The rule’s thresholds are in US dollars and are not converted here.`) : null,
        report.unpriced > 0 ? el('p.small.warn', { style: { marginTop: '10px' } },
          `${plural(report.unpriced, 'RSU award')} in the window had no 409A in force on the grant date and ${report.unpriced === 1 ? 'is' : 'are'} counted at nothing above.`) : null),

      el('div.table-wrap', { tabindex: 0, role: 'region', 'aria-label': 'Compensatory sales table' },
        el('table.data', { style: { minWidth: '720px' } },
          el('caption.visually-hidden', {}, `Compensatory sales in the twelve months ending ${report.asOf}`),
          el('thead', {}, el('tr', {},
            th('Date'), th('Holder'), th('Security'), th('Shares', true), th('Sales price', true), th('Measured at'))),
          el('tbody', {}, salesRows.length ? salesRows : el('tr', {}, el('td.muted', { colSpan: 6 },
            'No compensatory sales in this window'))),
          el('tfoot', {}, el('tr', {},
            el('td', { colSpan: 3 }, 'Trailing twelve months'),
            el('td.num', {}, shares(report.sharesSold)),
            el('td.num', {}, money(report.salesPrice)),
            el('td', {}, ''))))),

      flagged.length ? el('div.card', { style: { marginTop: '16px' } },
        el('h2.card-title', {}, 'Windows that needed attention'),
        el('p.card-sub', { style: { marginBottom: '6px' } },
          'The rule binds on every consecutive twelve-month period, so each sale date closes one'),
        el('div.activity-list', {}, flagged.map((h) => el('div.activity-item', {},
          el('span.activity-ic.neg', { html: icon('alert', 15, 2.2) }),
          el('span.grow', {}, `Twelve months ending ${dateLong(h.date)} · ${money(h.salesPrice)} · ${sharesLabel(h.sharesSold)}`),
          el('span.activity-time.warn', {}, [
            !h.compliant ? 'over every ceiling' : null,
            h.disclosureRequired ? 'disclosure' : null,
          ].filter(Boolean).join(' · ')))))) : null,

      el('p.small.muted', { style: { marginTop: '12px' } },
        'Options count at their strike on the grant date, not on exercise; RSUs at the 409A in force on the grant date; stock sold to employees '
        + 'and advisors at its issue price. Founder stock and investor rounds are not compensatory, and SAFEs and notes have no share count '
        + 'until a round prices them, so they are left out of the outstanding class. Over the disclosure threshold, option holders must '
        + 'receive the disclosure a reasonable time before they exercise.'));

    setExporter(() => exportRule701(report));
  }

  // Said when the date moves, as the cap table's as-of date is: the report
  // rebuilt under a screen reader with nothing to say which window it covers.
  const status = el('div.visually-hidden', { role: 'status', 'aria-live': 'polite' });
  const setAsOf = (value) => {
    // A keystroke inside the year, not a date - see the cap table's as-of field.
    if (value && !/^(19|2\d)\d\d-\d\d-\d\d$/.test(value)) return;
    asOfInput = value && value !== today ? value : '';
    dateInput.value = asOf();
    status.textContent = asOfInput ? `Twelve months ending ${dateLong(asOfInput)}` : 'Twelve months ending today';
    /* The button hides itself once today is back in force, and a hidden
       control cannot hold focus: pressed by keyboard, it dropped focus on
       the document body. The date field it puts right is where focus goes. */
    if (!asOfInput && document.activeElement === todayBtn) dateInput.focus();
    todayBtn.hidden = !asOfInput;
    renderResult();
  };
  const dateInput = el('input.input.asof-input', {
    type: 'date', value: asOf(), 'aria-label': 'Twelve months ending on this date',
    onchange: (e) => setAsOf(e.target.value),
  });
  /* Built once and shown only while a past date is in force: deciding at
     build time left the way back invisible after the first date picked. */
  const todayBtn = el('button.btn.btn-ghost', {
    hidden: !asOfInput, onclick: () => setAsOf(''),
  }, 'Back to today');

  renderResult();
  return [
    assumptions,
    el('div.asof-bar.no-print', {},
      el('span.small.muted.asof-label', {}, 'Twelve months ending'),
      dateInput,
      todayBtn),
    status,
    resultWrap,
  ];
}

function exportRule701(report) {
  const code = currencyCode();
  const { limits, passes } = report;
  const rows = [
    [`${store.company.name || 'Company'} - Rule 701 - twelve months ending ${report.asOf} (${report.windowStart} to ${report.asOf}) - amounts in ${code}`],
    [`Aggregate sales price ${report.salesPrice.toFixed(2)}; shares sold ${report.sharesSold}; `
      + `${usd.format(RULE_701.floor)} floor ${passes.floor ? 'within' : 'exceeded'}; `
      + `15% of total assets ${limits.assets === null ? 'not set' : `${limits.assets.toFixed(2)} ${passes.assets ? 'within' : 'exceeded'}`}; `
      + `15% of outstanding class ${limits.classShares} shares (${report.classOutstanding} outstanding on ${report.measuredAt}) ${passes.classShares ? 'within' : 'exceeded'}; `
      + `disclosure threshold ${usd.format(RULE_701.disclosure)} ${report.disclosureRequired ? 'crossed' : 'not crossed'}`],
    [],
    ['Date', 'Holder', 'Security', 'Type', 'Shares', `Sales price (${code})`, 'Measured at'],
  ];
  for (const s of report.sales) {
    rows.push([
      s.date,
      holderName(s.stakeholderId),
      s.security.label,
      s.security.kind === 'option' ? 'Options' : s.security.kind === 'rsu' ? 'RSU' : 'Shares',
      s.shares,
      s.price === null ? '' : s.price.toFixed(2),
      s.basis === 'strike' ? 'Strike at grant' : s.basis === 'fmv' ? '409A at grant' : 'Issue price',
    ]);
  }
  if (report.history.length) {
    rows.push([], ['Trailing twelve months ending on each sale date'],
      ['Window ends', `Sales price (${code})`, 'Shares sold', 'Within a ceiling', 'Disclosure required']);
    for (const h of report.history) {
      rows.push([h.date, h.salesPrice.toFixed(2), h.sharesSold, h.compliant ? 'yes' : 'no', h.disclosureRequired ? 'yes' : 'no']);
    }
  }
  downloadFile(`rule-701-${report.asOf}.csv`, toCSV(rows), 'text/csv');
}

/* ---------- Form 3921 ---------- */

function form3921Tab({ setExporter }) {
  const db = store.db;
  const today = todayISO();
  const thisYear = Number(today.slice(0, 4));
  const all = form3921Report(db, { year: thisYear });

  if (!all.years.length && !all.undated.length) {
    setExporter(null, 'No ISO exercises to report');
    return el('div.card', {}, emptyState({
      icon: 'landmark',
      title: 'No ISO exercises to report',
      text: 'Form 3921 is filed for every exercise of an incentive stock option. Mark a grant as an ISO and record its exercises with a certificate, and the rows appear here.',
    }));
  }

  /* The year the form is most likely wanted for: this one while it has
     exercises, otherwise the latest that does - which in January is last
     year, with the filing due at the end of the month. */
  const years = [...new Set([...all.years, thisYear])].sort((a, b) => a - b);
  if (!years.includes(year3921)) {
    year3921 = all.years.includes(thisYear) || !all.years.length ? thisYear : all.years[all.years.length - 1];
  }

  const resultWrap = el('div');

  function renderResult() {
    const report = form3921Report(db, { year: year3921 });
    const d = report.deadlines;
    const furnishPast = today > d.furnish;

    const rows = report.rows.map((r) => el('tr', {},
      el('td', {}, holderLink(r.stakeholderId, store.stakeholder(r.stakeholderId)?.email || null)),
      el('td', {}, el('div', {}, r.grant.label), el('div.small.muted', {}, `Granted ${dateLong(r.grantDate)}`)),
      el('td', {}, dateLong(r.exerciseDate), r.early ? el('div.small.muted', {}, 'Early exercise') : null),
      el('td.num', {}, sharePrice(r.strike)),
      el('td.num', {}, r.fmv === null ? el('span.warn', {}, 'No 409A on file') : sharePrice(r.fmv)),
      el('td.num', {}, shares(r.shares)),
      el('td', {}, r.certificate.label)));

    fill(resultWrap,
      el('div.stat-grid', {},
        statTile({
          label: `ISO exercises in ${report.year}`, icon: 'file-text',
          value: String(report.rows.length),
          sub: report.rows.length ? 'One Form 3921 per exercise, per holder' : 'Nothing to file for this year',
        }),
        statTile({
          label: 'Shares transferred', icon: 'table',
          value: shares(report.shares),
          sub: 'Box 5, across every exercise',
        }),
        statTile({
          label: 'Furnish Copy B by', icon: 'calendar',
          value: dateLong(d.furnish),
          sub: report.rows.length && furnishPast ? 'Past due for holders who have not received theirs' : 'To each holder who exercised',
        }),
        statTile({
          label: 'File Copy A by', icon: 'landmark',
          value: dateLong(d.filePaper),
          sub: `On paper · ${dateLong(d.fileElectronic)} electronically`,
        })),

      report.missingFmv > 0 ? el('div.card', { style: { marginBottom: '16px' } },
        el('div.row', { style: { justifyContent: 'space-between', flexWrap: 'wrap' } },
          el('div.grow', {},
            el('div', { style: { fontWeight: 560 } },
              `${plural(report.missingFmv, 'exercise')} had no 409A in force on the exercise date`),
            el('div.small.muted', {}, 'Box 4 wants the fair market value per share that day. Record the valuation that covered it.')),
          el('button.btn.btn-ghost.no-print', { html: icon('scale', 15, 2), onclick: () => openValuationForm() }, ' Record a 409A'))) : null,

      el('div.table-wrap', { tabindex: 0, role: 'region', 'aria-label': 'Form 3921 table' },
        el('table.data', { style: { minWidth: '780px' } },
          el('caption.visually-hidden', {}, `Form 3921 rows for ${report.year}`),
          el('thead', {}, el('tr', {},
            th('Holder'), th('Grant · box 1'), th('Exercised · box 2'), th('Exercise price · box 3', true),
            th('FMV at exercise · box 4', true), th('Shares · box 5', true), th('Certificate'))),
          el('tbody', {}, rows.length ? rows : el('tr', {}, el('td.muted', { colSpan: 7 },
            `No ISO exercises recorded in ${report.year}`))),
          rows.length ? el('tfoot', {}, el('tr', {},
            el('td', { colSpan: 5 }, `${plural(report.rows.length, 'exercise')}`),
            el('td.num', {}, shares(report.shares)),
            el('td', {}, ''))) : null)),

      report.undated.length ? el('div.card', { style: { marginTop: '16px' } },
        el('h2.card-title', {}, 'Exercises with no certificate'),
        el('p.card-sub', { style: { marginBottom: '6px' } },
          'These were recorded on the grant alone, so nothing dates them or says what was paid. Issue the certificate and they join the year it belongs to'),
        el('div.activity-list', {}, report.undated.map((u) => el('div.activity-item', {},
          el('span.activity-ic.neg', { html: icon('alert', 15, 2.2) }),
          el('span.grow', {}, `${u.grant.label} · ${shares(u.quantity)} exercised by ${holderName(u.grant.stakeholderId)}`),
          /* The one action that resolves the row: the grant's own edit sheet
             has no exercise fields, so "Open" led nowhere. */
          el('button.btn.btn-ghost.no-print', {
            title: 'Issue the certificate for this exercise',
            onclick: () => openCertifyForm(u.grant),
          }, 'Issue certificate'))))) : null,

      el('p.small.muted', { style: { marginTop: '12px' } },
        'Box 3 is the strike the certificate was issued at and box 4 the 409A in force on the exercise date. Box 6 is left blank when the '
        + 'corporation itself transferred the shares. The company’s EIN and each holder’s taxpayer number and address come from your payroll '
        + 'records. NSO exercises are not reported on Form 3921; their spread runs through payroll instead.'));

    setExporter(report.rows.length ? () => exportForm3921(report) : null, `No ISO exercises recorded in ${report.year}`);
  }

  const yearSelect = el('select.select', {
    'aria-label': 'Calendar year',
    onchange: (e) => { year3921 = Number(e.target.value); renderResult(); },
  }, years.map((y) => el('option', { value: String(y), selected: y === year3921 }, String(y))));

  renderResult();
  return [
    el('div.asof-bar.no-print', {},
      el('span.small.muted.asof-label', {}, 'Calendar year'),
      el('div.select-wrap', {}, yearSelect)),
    resultWrap,
  ];
}

function exportForm3921(report) {
  const code = currencyCode();
  const rows = [
    [`${store.company.name || 'Company'} - Form 3921 - ISO exercises in ${report.year} - amounts in ${code}`],
    [`Furnish Copy B to holders by ${report.deadlines.furnish}; file Copy A by ${report.deadlines.filePaper} on paper or ${report.deadlines.fileElectronic} electronically`],
    [],
    ['Holder', 'Email', 'Box 1 Date option granted', 'Box 2 Date option exercised',
      `Box 3 Exercise price per share (${code})`, `Box 4 Fair market value per share on exercise date (${code})`,
      'Box 5 Number of shares transferred', 'Grant', 'Certificate', 'Early exercise'],
  ];
  for (const r of report.rows) {
    const holder = store.stakeholder(r.stakeholderId);
    rows.push([
      holder?.name || 'Unknown holder',
      holder?.email || '',
      r.grantDate,
      r.exerciseDate,
      r.strike.toFixed(4),
      r.fmv === null ? '' : r.fmv.toFixed(4),
      r.shares,
      r.grant.label,
      r.certificate.label,
      r.early ? 'yes' : 'no',
    ]);
  }
  downloadFile(`form-3921-${report.year}.csv`, toCSV(rows), 'text/csv');
}

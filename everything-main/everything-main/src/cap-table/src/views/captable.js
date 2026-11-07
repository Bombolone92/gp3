import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { viewHead, holderCell, emptyState, segmented, flagInvalid } from '../ui/bits.js';
import { toast } from '../ui/toast.js';
import { openSecurityForm } from '../ui/securityform.js';
import { splitsSincePhrase } from '../ui/split.js';
import { store } from '../lib/store.js';
import {
  sharesOutstanding, fullyDiluted, optionsDiluted, convertibles,
  convertibleValue, countsInDiluted, dilutedShares,
  grantDiluted, certifiedByGrant, dbAsOf, issuanceHistory, isISO, isClosed,
  ownershipByStakeholder, ownershipByClass, capitalRaised, impliedValuation,
  currentFMV, rsuDiluted, certifiedByRsu, rsusDiluted, certifiedIndexes, planBalances, poolRows,
} from '../lib/captable.js';
import {
  shares, sharesLabel, pct, money, moneyWhole, sharePrice, dateLong, dateShort, currencyCode, decimalValue,
} from '../lib/format.js';
import { toCSV, downloadFile, todayISO } from '../lib/util.js';

/* Module-level so the toggles survive store-driven re-renders.
   `asOfInput` is empty for "today" rather than today's date, so leaving the
   view open overnight doesn't quietly turn into a historical view. */
let base = 'diluted';        // 'outstanding' | 'diluted'
let includePool = true;
let asOfInput = '';
/* The basis and the pool toggle mean the same thing in any company, so they
   travel. The as-of date does not: it was picked against one dataset's own
   history. Carried across a company switch, a wipe, or an import, a cap table
   opened for the first time renders as a snapshot of a date out of someone
   else's past - and its empty state loses the "issue a security" way out,
   because it reads as "nothing had been issued yet" on that date instead of
   "no securities yet". */
let asOfEpoch = null;

/* How many financing dates the jump strip offers before it just gets long. */
const HISTORY_CHIPS = 8;

/* The print report is built just-in-time: beforeprint fires for the Print
   button's window.print() and for the browser's own print command alike.
   One listener, pointed at the live view - building the report during
   ordinary renders would add two ownership tables' worth of work (and a DOM
   row per holder) to every keystroke, for a document nobody sees on screen. */
let prepareReport = null;
window.addEventListener('beforeprint', () => prepareReport?.());

export function capTableView() {
  if (asOfEpoch !== store.dataEpoch) {
    asOfEpoch = store.dataEpoch;
    asOfInput = '';
  }
  const tableWrap = el('div');
  /* A change of date rebuilds the table under a field or chip that keeps
     focus, so a screen reader heard the press and nothing of the snapshot it
     opened. Set only when the date moves; the page's arrival has its heading. */
  const status = el('div.visually-hidden', { role: 'status', 'aria-live': 'polite' });
  /* The board-ready report: only on paper, where the interactive view - one
     basis at a time, controls, scroll containers - would make a poor
     document. Built when printing starts, so it always reflects the as-of
     date and pool toggle in force when the user hits print. */
  const reportWrap = el('div.print-only');
  const root = el('div');

  const asOfDate = () => asOfInput || todayISO();

  // Whether the last render found nothing outstanding on the date in force.
  let nothingToReport = false;
  prepareReport = () => {
    // A newer view instance (or another view entirely) may own the page now.
    if (!root.isConnected) return;
    const asOf = asOfDate();
    const db = dbAsOf(store.db, asOf);
    /* The browser's own print command bypasses the disabled Print button: on
       a cap table with nothing to report it printed the zero summary over two
       tables of column headings. The sentence the view shows goes on paper. */
    if (!db.securities.length || nothingToReport) {
      reportWrap.replaceChildren(el('p', {}, asOfInput
        ? (db.securities.length ? `Nothing was outstanding on ${dateLong(asOf)}.` : `Nothing had been issued on ${dateLong(asOf)}.`)
        : (db.securities.length ? 'Nothing is outstanding.' : 'No securities have been issued yet.')));
      return;
    }
    reportWrap.replaceChildren(...buildReport(db, asOf, { includePool }));
  };

  function denominator(db) {
    return base === 'outstanding'
      ? sharesOutstanding(db.securities)
      : fullyDiluted(db.securities, db.company, { includePool });
  }

  function render() {
    const asOf = asOfDate();
    const db = dbAsOf(store.db, asOf);
    tableWrap.replaceChildren();

    const hidden = store.db.securities.length - db.securities.length;
    if (asOfInput) {
      /* The units the table reads in, when they are not today's: a date
         before a split shows every count a split factor away from the live
         cap table, and nothing else on the page said why. */
      const units = unitsNote(store.db.company, asOf);
      tableWrap.append(el('div.sample-banner', {},
        el('span.sample-banner-ic', { html: icon('clock', 14, 2.2) }),
        el('span.grow', {}, [
          `As of ${dateLong(asOf)}`,
          hidden > 0
            ? `${hidden} later ${hidden === 1 ? 'security is' : 'securities are'} excluded`
            : 'vesting and interest computed to this date',
          units,
        ].filter(Boolean).join(' · ')),
        /* The banner is rebuilt with the table, this button in it, so a press
           by keyboard dropped focus on the document body. The date field the
           press puts back to today is the control that stays. */
        el('button', { onclick: () => { setAsOf(''); dateInput.focus(); } }, 'Back to today')));
    } else if (hidden > 0) {
      /* Future records remain available in Securities, but are not part of
         today's ownership figures on the dashboard or in statements. */
      tableWrap.append(el('div.sample-banner', {},
        el('span.sample-banner-ic', { html: icon('clock', 14, 2.2) }),
        el('span.grow', {},
          `${hidden} ${hidden === 1 ? 'security is' : 'securities are'} dated after today and not counted yet`)));
    }

    if (!db.securities.length) {
      syncActions(db, asOf);
      /* Only when there is something the date is looking back past. With
         nothing on file at all, a past date typed into the field read
         "Nothing had been issued yet ... pick a later date to see the cap
         table fill in", and no date fills anything in: the way in is issuing
         a security, which is what the empty company's own state offers. */
      tableWrap.append(el('div.card', {}, asOfInput && store.db.securities.length
        ? emptyState({
          icon: 'clock',
          title: 'Nothing had been issued yet',
          text: `No securities existed on ${dateLong(asOf)}. Pick a later date to see the cap table fill in.`,
        })
        : hidden > 0
          /* Everything issued is dated ahead: the banner above says so, and
             "No securities yet" under it contradicted it. */
          ? emptyState({
            icon: 'clock',
            title: 'Nothing is issued yet',
            text: `${hidden === 1 ? 'The one security on file is' : `All ${hidden} securities on file are`} dated after today, `
              + 'so the cap table is empty until then. The securities list shows them now.',
          })
          : emptyState({
            icon: 'table',
            title: 'No securities yet',
            text: 'Issue founder shares, grant options, or record a SAFE and your cap table builds itself.',
            cta: 'Issue security',
            onCta: () => openSecurityForm(),
          })));
      return;
    }

    const total = denominator(db);
    const rows = [];

    /* Share classes, in creation order, each as its own section. Closed
       certificates are history, not holdings - their successors are the
       rows that count. */
    for (const cls of db.classes) {
      const certs = db.securities.filter((s) => s.kind === 'shares' && s.classId === cls.id && !isClosed(s));
      if (!certs.length) continue;
      const classTotal = certs.reduce((a, s) => a + s.quantity, 0);
      rows.push(el('tr.section-row', {}, el('td', { colSpan: 5 },
        `${cls.name} · ${sharesLabel(classTotal)}`)));
      for (const s of [...certs].sort((a, b) => b.quantity - a.quantity)) {
        rows.push(certRow(db, s, s.quantity, total));
      }
    }

    /* Option grants (count toward the diluted base only). Grants that are
       fully cancelled or fully exercised into certificates contribute
       nothing and would only read as a row of zeroes. */
    if (base === 'diluted') {
      const certified = certifiedByGrant(db.securities);
      const grants = db.securities
        .filter((s) => s.kind === 'option')
        .map((s) => ({ s, n: grantDiluted(s, certified) }))
        .filter((g) => g.n > 0);
      if (grants.length) {
        rows.push(el('tr.section-row', {}, el('td', { colSpan: 5 },
          `Options granted · ${shares(optionsDiluted(db.securities))}`)));
        for (const g of [...grants].sort((a, b) => b.n - a.n)) {
          rows.push(certRow(db, g.s, g.n, total));
        }
      }
      /* RSUs dilute like options and draw the same pool; they just have
         nothing to pay in when they settle. */
      const certifiedRsu = certifiedByRsu(db.securities);
      const awards = db.securities
        .filter((s) => s.kind === 'rsu')
        .map((s) => ({ s, n: rsuDiluted(s, certifiedRsu) }))
        .filter((a) => a.n > 0);
      if (awards.length) {
        rows.push(el('tr.section-row', {}, el('td', { colSpan: 5 },
          `RSUs outstanding · ${shares(rsusDiluted(db.securities))}`)));
        for (const a of [...awards].sort((x, y) => y.n - x.n)) {
          rows.push(certRow(db, a.s, a.n, total));
        }
      }
      /* Read remaining rights on this snapshot's date, just like the total,
         CSV and printed report. Original quantities include rights that were
         exercised, cancelled or have expired. */
      const warrantCertificates = certifiedIndexes(db.securities);
      const warrants = db.securities.filter((s) => s.kind === 'warrant')
        .map((s) => ({ s, n: dilutedShares(s, warrantCertificates) }))
        .filter((w) => w.n > 0);
      if (warrants.length) {
        rows.push(el('tr.section-row', {}, el('td', { colSpan: 5 },
          `Warrants · ${shares(warrants.reduce((sum, w) => sum + w.n, 0))}`)));
        for (const w of [...warrants].sort((a, b) => b.n - a.n)) {
          rows.push(certRow(db, w.s, w.n, total));
        }
      }
      /* The unallocated reserve, one row per plan that holds any, named
         after the plan: a company with an older plan and its successor sees
         which reserve the shares sit in, and one plan reads as it always did. */
      if (includePool) {
        for (const r of poolRows(planBalances(db), total)) {
          rows.push(el('tr', {},
            el('td', {}, el('div.holder-cell', {},
              el('span.avatar', { 'aria-hidden': 'true', style: { background: 'var(--surface-2)', color: 'var(--ink-3)' } }, '-'),
              el('div', {}, el('div.t', {}, r.name), el('div.s', {}, 'Unallocated')))),
            el('td', {}, ''),
            el('td', {}, ''),
            el('td.num', {}, shares(r.shares)),
            el('td.num', {}, pct(r.pct))
          ));
        }
      }
    }

    /* Records on file, and not one of them a holding on this date: every
       certificate repurchased, every grant cancelled. The record count said
       the table had something to show, so it rendered its headings over an
       empty body and a footer reading zero, with Export and Print offering a
       spreadsheet of column names and a report of zeroes. */
    const convs = convertibles(db.securities);
    const dilutedTotal = base === 'diluted'
      ? total
      : fullyDiluted(db.securities, db.company, { includePool });
    const nothing = !rows.length && !convs.length && dilutedTotal <= 0;
    nothingToReport = nothing;
    syncActions(db, asOf, nothing);
    if (nothing) {
      tableWrap.append(el('div.card', {}, emptyState({
        icon: 'table',
        title: 'Nothing outstanding',
        text: asOfInput
          ? `Every certificate on file had been repurchased and every grant cancelled by ${dateLong(asOf)}. Pick another date to see what stood before.`
          : 'Every certificate on file has been repurchased and every grant cancelled, so nobody holds anything right now.',
        cta: asOfInput ? null : 'Issue security',
        onCta: () => openSecurityForm(),
      })));
      return;
    }
    /* Nothing on this basis, but something on the page: grants ahead of the
       first certificate, or convertibles waiting on a priced round. The
       footer's zero is right; the body says why, as the report tables do. */
    if (!rows.length) {
      rows.push(el('tr', {}, el('td.muted', { colSpan: 5 }, base === 'outstanding' && dilutedTotal > 0
        ? 'No shares outstanding yet. Option grants, RSUs, and warrants count on the fully diluted basis.'
        : 'No shares issued yet. The convertible instruments below convert at your next priced round.')));
    }

    const table = el('table.data', {},
      el('caption.visually-hidden', {}, `Capitalization table, ${base === 'outstanding' ? 'outstanding' : 'fully diluted'} basis`),
      el('thead', {}, el('tr', {},
        el('th.col-holder', { scope: 'col' }, 'Stakeholder'),
        el('th', { scope: 'col' }, 'Security'),
        el('th', { scope: 'col' }, 'Date'),
        el('th.num', { scope: 'col' }, 'Shares'),
        el('th.num', { scope: 'col' }, 'Ownership')
      )),
      el('tbody', {}, rows),
      el('tfoot', {}, el('tr', {},
        el('td', { colSpan: 3 }, base === 'outstanding' ? 'Total outstanding' : 'Total fully diluted'),
        el('td.num', {}, shares(total)),
        el('td.num', {}, total > 0 ? '100.00%' : '0.00%')
      ))
    );

    tableWrap.append(el('div.table-wrap', {
      tabindex: 0, role: 'region', 'aria-label': 'Ownership table',
    }, table));

    /* Convertible instruments - real dollars, undetermined shares. */
    if (convs.length) {
      tableWrap.append(el('div.card', { style: { marginTop: '16px' } },
        el('h2.card-title', {}, 'Convertible instruments'),
        el('p.card-sub', { style: { marginBottom: '10px' } },
          'These convert at your next priced round. Model it under Round modeling'),
        el('div.table-wrap', {
          tabindex: 0, role: 'region', 'aria-label': 'Convertible instruments table',
          style: { border: 'none' },
        },
          el('table.data', { style: { minWidth: '480px' } },
            el('thead', {}, el('tr', {},
              el('th', { scope: 'col' }, 'Holder'),
              el('th', { scope: 'col' }, 'Instrument'),
              // Not "Principal": a note's figure is its principal plus the
              // interest accrued to the as-of date, which is the amount that
              // actually converts.
              el('th.num', { scope: 'col' }, 'Balance'),
              el('th.num', { scope: 'col' }, 'Cap'),
              el('th.num', { scope: 'col' }, 'Discount')
            )),
            el('tbody', {}, convs.map((s) => el('tr', {},
              el('td', {}, store.stakeholder(s.stakeholderId)?.name || 'Unknown'),
              // One line: squeezed on a phone the label broke after its hyphen ("CN-" / "1").
              el('td', { style: { whiteSpace: 'nowrap' } }, el('span.kind-pill', {}, s.kind === 'safe' ? 'SAFE' : 'Note'), ` ${s.label}`),
              el('td.num', {}, moneyWhole(convertibleValue(s, asOf))),
              el('td.num', {}, s.valuationCap > 0
                ? el('div', {},
                  el('div', {}, moneyWhole(s.valuationCap)),
                  s.kind === 'safe'
                    ? el('div.small.muted', {}, s.safeType === 'post' ? 'post-money' : 'pre-money')
                    : null)
                : '-'),
              el('td.num', {}, s.discount > 0 ? `${s.discount}%` : '-')
            )))
          ))
      ));
    }
  }

  function certRow(db, s, quantity, total) {
    const holder = store.stakeholder(s.stakeholderId);
    return el('tr', {},
      el('td.col-holder', {}, holderCell(holder)),
      el('td', {}, s.label),
      /* One line, as every other date cell in the app: squeezed on a phone
         this column broke "Jun 1, 2026" across two lines while the same
         date sat whole in the securities list, and the table scrolls inside
         its card either way. */
      el('td', { style: { whiteSpace: 'nowrap' } }, dateLong(s.date || s.grantDate)),
      el('td.num', {}, shares(quantity)),
      el('td.num', {}, pct(total > 0 ? quantity / total : 0))
    );
  }

  function exportCSV() {
    const asOf = asOfDate();
    const db = dbAsOf(store.db, asOf);
    const out = sharesOutstanding(db.securities);
    /* The same basis the table on screen and the printed report are reading.
       Ignoring the pool toggle here handed out a spreadsheet whose ownership
       percentages disagreed with the ones the user was looking at, with
       nothing on the file to say why. */
    const fd = fullyDiluted(db.securities, db.company, { includePool });
    // The date the numbers describe travels with the file, not just its name -
    // a CSV outlives the moment it was exported.
    /* The currency travels with the numbers, in the header line and on every
       money column: a spreadsheet handed to an accountant carries no app
       around it to say which money these figures are in. And so does the
       basis, the way the report's own header carries it. */
    const code = currencyCode();
    const units = unitsNote(store.db.company, asOf);
    const rows = [
      [`${db.company.name || 'Cap table'} - capitalization as of ${asOf} - amounts in ${code}`
        + (includePool ? '' : ' - unallocated pool excluded')
        + (units ? ` - ${units}` : '')],
      [],
      ['Stakeholder', 'Security', 'Type', 'Class', 'Date', 'Shares', `Price per share (${code})`, '% outstanding', '% fully diluted'],
    ];
    const CSV_TYPE = { shares: 'Shares', option: 'Options', rsu: 'RSU', warrant: 'Warrant' };
    const certified = certifiedIndexes(db.securities);
    for (const s of db.securities) {
      if (!countsInDiluted(s)) continue;
      const n = dilutedShares(s, certified);
      if (n <= 0) continue;
      rows.push([
        store.stakeholder(s.stakeholderId)?.name || 'Unknown',
        s.label,
        s.kind === 'option' ? (isISO(s) ? 'Options (ISO)' : 'Options (NSO)') : CSV_TYPE[s.kind],
        s.kind === 'option' ? 'Option grant' : (store.shareClass(s.classId)?.name || ''),
        s.date || s.grantDate || '',
        n,
        // An RSU has no per-share price of any kind to report. Written out
        // in full: String(1e-7) is "1e-7", which spreadsheets read and the
        // CSV wizard's own number parser refuses.
        s.kind === 'shares' ? decimalValue(s.pricePerShare) : (s.kind === 'rsu' ? '' : decimalValue(s.strike)),
        out > 0 && s.kind === 'shares' ? ((n / out) * 100).toFixed(4) : '',
        fd > 0 ? ((n / fd) * 100).toFixed(4) : '',
      ]);
    }
    if (includePool) {
      for (const r of poolRows(planBalances(db), fd)) {
        rows.push([`${r.name} (unallocated)`, '', 'Pool', '', '', r.shares, '', '', fd > 0 ? ((r.shares / fd) * 100).toFixed(4) : '']);
      }
    }

    /* Outstanding convertibles, in their own block. They hold no share count
       yet, so they can't join the table above - but the view and the printed
       report both carry them, and a CSV that quietly dropped them would hand
       counsel a cap table missing real money. */
    const convs = convertibles(db.securities);
    if (convs.length) {
      rows.push([], ['Outstanding convertible instruments - shares undetermined until a priced round'],
        ['Holder', 'Instrument', 'Type', 'Date', `Balance (${code})`, `Valuation cap (${code})`, 'Cap basis', 'Discount %', 'Interest %', 'Maturity']);
      for (const s of convs) {
        rows.push([
          store.stakeholder(s.stakeholderId)?.name || 'Unknown',
          s.label,
          s.kind === 'safe' ? 'SAFE' : 'Note',
          s.date || '',
          convertibleValue(s, asOf).toFixed(2),
          s.valuationCap > 0 ? s.valuationCap : '',
          s.kind === 'safe' ? (s.safeType === 'post' ? 'post-money' : 'pre-money') : '',
          s.discount > 0 ? s.discount : '',
          s.kind === 'note' && s.interestRate > 0 ? s.interestRate : '',
          s.kind === 'note' ? (s.maturityDate || '') : '',
        ]);
      }
    }
    downloadFile(`cap-table-${asOf}.csv`, toCSV(rows), 'text/csv');
  }

  /* The pool toggle only means anything on the diluted basis, so it hides
     rather than being rebuilt away: everything in this row keeps its identity
     - and its keyboard focus - across a change of basis. */
  const poolToggle = el('label.check-row', {},
    el('input', {
      type: 'checkbox', checked: includePool, dataset: { focusKey: 'captable-pool' },
      onchange: (e) => { includePool = e.target.checked; render(); },
    }),
    el('span.small', {}, 'Include pool'));

  const baseSeg = segmented([
    { value: 'diluted', label: 'Fully diluted' },
    { value: 'outstanding', label: 'Outstanding' },
  ], {
    label: 'Share basis', value: base,
    onSelect: (value) => { base = value; syncPoolToggle(); render(); },
  });
  function syncPoolToggle() {
    poolToggle.hidden = base !== 'diluted';
  }
  syncPoolToggle();

  const exportBtn = el('button.btn.btn-ghost', {
    html: icon('file-down', 15, 2), onclick: exportCSV,
  }, ' Export CSV');
  const printBtn = el('button.btn.btn-primary', {
    html: icon('printer', 15, 2), onclick: () => window.print(),
  }, ' Print report');

  /* Nothing to hand anyone. On an empty cap table - or an as-of date before
     the first issuance - these two produce a spreadsheet of column headings
     and a board report of zeroes, while the card below them is busy saying
     there is nothing here yet. They go quiet with the reason on them, the way
     the share class delete button and the split button already do. */
  function syncActions(db, asOf, nothing = false) {
    const empty = !db.securities.length || nothing;
    const hidden = store.db.securities.length - db.securities.length;
    for (const b of [exportBtn, printBtn]) {
      b.disabled = empty;
      if (!empty) b.removeAttribute('title');
      else if (db.securities.length) {
        b.title = asOfInput ? `Nothing was outstanding on ${dateLong(asOf)}` : 'Nothing is outstanding';
      } else {
        b.title = asOfInput
          ? `Nothing had been issued on ${dateLong(asOf)}`
          : hidden > 0 ? 'Nothing is issued yet' : 'Issue a security first';
      }
    }
  }

  const controls = el('div.row', { style: { flexWrap: 'wrap' } },
    baseSeg,
    poolToggle,
    exportBtn,
    printBtn);

  const today = todayISO();
  /* Past dates only, like the date field's own max. Securities issued today
     are already the "Today" chip's view - a second chip for the same date
     could never even show itself as selected, because picking today's date
     normalizes back to "today" - and a chip for a security dated next month
     would drive the field past a date it refuses to be typed. */
  /* Each summary is read off the snapshot its own chip opens, not off the
     live records. A split restates every quantity, so the live history
     describes a 2023 issuance in today's shares - and the table the chip
     opens reads it in the units of 2023, ten times smaller. The tooltip and
     the table it belongs to have to be the same number. Only worth the extra
     snapshots when a split has actually been recorded; without one the two
     readings are identical. */
  const restated = (store.db.company.splits || []).length > 0;
  const history = issuanceHistory(store.db)
    .filter((h) => h.date < today)
    .slice(0, HISTORY_CHIPS)
    .map((h) => (restated
      ? issuanceHistory(dbAsOf(store.db, h.date)).find((x) => x.date === h.date) || h
      : h));

  function setAsOf(value) {
    /* Chrome fires change on a date field for every keystroke that leaves a
       valid value, so a year typed as "2026" arrives as 0002, 0020, 0202 and
       2026: four snapshots rebuilt and four announcements for one date, the
       first three "as of Sep 8, 1". A year before 1900 is a keystroke, not
       a date this cap table could be read as of. */
    if (value && !/^(19|2\d)\d\d-\d\d-\d\d$/.test(value)) return;
    /* `max` on a date field only marks a typed-past-it value invalid; it
       still arrives here, and nothing was checking. A date in the future is
       not a snapshot of anything: vesting and note interest run on to it,
       securities dated between today and then are quietly counted with no
       line to say so - the "dated after today and not counted yet" banner is
       exactly what goes missing - and the printed report comes out headed
       "as of" a day that has not happened. */
    if (value > today) {
      flagInvalid(dateInput);
      dateInput.value = asOfDate();
      toast('The cap table reads back to any past date; today is as far as it goes',
        { icon: 'clock' });
      return;
    }
    asOfInput = value === today ? '' : value;
    dateInput.value = asOfDate();
    chips.select(asOfInput || today);
    render();
    status.textContent = asOfInput ? `Cap table as of ${dateLong(asOfInput)}` : 'Cap table as of today';
  }

  /* A date field for any date, plus one chip per financing so the common
     case - "what did this look like the day the round closed" - is a tap.
     The two drive each other rather than being re-rendered together, so
     whichever one the user is working in keeps focus. */
  /* A focus key, like the chips and basis buttons: a change arriving from
     elsewhere (a toast's Undo, another tab) re-renders the view, and the
     shell hands focus back only to controls that name themselves. */
  const dateInput = el('input.input.asof-input', {
    type: 'date', value: asOfDate(), max: today, 'aria-label': 'Show the cap table as of this date',
    dataset: { focusKey: 'captable-asof' },
    onchange: (e) => setAsOf(e.target.value || today),
  });
  const chips = segmented([
    { value: today, label: 'Today' },
    ...history.map((h) => ({ value: h.date, label: dateShort(h.date, today), title: historyTitle(h) })),
  ], {
    label: 'Jump to a financing date', value: asOfInput || today,
    extraClass: 'seg-scroll', onSelect: setAsOf,
  });

  const asOfBar = el('div.asof-bar', {},
    el('span.small.muted.asof-label', {}, 'As of'),
    dateInput,
    history.length ? chips : null);

  root.append(
    el('div.no-print', {},
      viewHead('Cap table', 'Who owns what, on any date and either share basis', controls),
      asOfBar,
      tableWrap,
      status),
    reportWrap
  );
  render();
  return root;
}

/* ---------- The printable report ---------- */

/**
 * The board-ready cap table document: company header, summary figures,
 * ownership by class and by holder on both bases, outstanding convertibles,
 * the option pool, and the financing history - everything "send me the
 * current cap table" is actually asking for. Print-to-PDF is the delivery
 * mechanism, exactly as it is for the stakeholder statement.
 */
function buildReport(db, asOf, { includePool }) {
  const today = todayISO();
  const out = sharesOutstanding(db.securities);
  const fd = fullyDiluted(db.securities, db.company, { includePool });
  const raised = capitalRaised(db.securities);
  const valuation = impliedValuation(db);
  const fmv = currentFMV(db.company, asOf);
  const reserves = planBalances(db).plans.filter((r) => r.authorized > 0 || r.committed > 0);
  const convs = convertibles(db.securities);
  const history = issuanceHistory(db);

  const metric = (label, value) => el('div.round-metric', {}, el('span', {}, label), el('span.v', {}, value));
  const section = (title, ...children) => el('div', { style: { marginBottom: '18px' } },
    el('h3.card-title', { style: { marginBottom: '8px' } }, title),
    children);
  const th = (label, num = false) => el(num ? 'th.num' : 'th', { scope: 'col' }, label);

  /* Ownership rows merged across both bases, keyed by holder or class, in
     the diluted ordering with outstanding-only rows appended. */
  const merged = (dilRows, outRows, key) => {
    const rows = new Map();
    for (const r of dilRows) rows.set(key(r), { name: r.name, dil: r });
    for (const r of outRows) {
      const k = key(r);
      if (rows.has(k)) rows.get(k).out = r;
      else rows.set(k, { name: r.name, out: r });
    }
    return [...rows.values()];
  };

  const ownershipTable = (rows) => el('div.table-wrap', { style: { border: 'none' } },
    el('table.data', {},
      el('thead', {}, el('tr', {},
        th(''), th('Outstanding', true), th('%', true),
        th('Fully diluted', true), th('%', true))),
      el('tbody', {}, rows.map((r) => el('tr', {},
        el('td', {}, r.name),
        el('td.num', {}, r.out ? shares(r.out.shares) : '-'),
        el('td.num', {}, r.out ? pct(r.out.pct) : '-'),
        el('td.num', {}, r.dil ? shares(r.dil.shares) : '-'),
        el('td.num', {}, r.dil ? pct(r.dil.pct) : '-'))))));

  const byHolder = merged(
    ownershipByStakeholder(db, { base: 'diluted', includePool }).rows,
    ownershipByStakeholder(db, { base: 'outstanding' }).rows,
    (r) => r.stakeholderId ?? '__pool__');
  const byClass = merged(
    ownershipByClass(db, { base: 'diluted', includePool }).rows,
    ownershipByClass(db, { base: 'outstanding' }).rows,
    (r) => r.classId);

  return [
    el('div.statement-head', {},
      el('div.statement-co', {}, db.company.name || 'Capitalization table'),
      el('div.statement-meta', {},
        [
          'Capitalization table',
          `as of ${dateLong(asOf)}`,
          db.company.entityType,
          db.company.jurisdiction,
          `amounts in ${currencyCode()}`,
          includePool ? null : 'unallocated pool excluded',
          unitsNote(db.company, asOf),
        ].filter(Boolean).join(' · ')),
      el('div.statement-meta', {}, `Generated ${dateLong(today)}`)),

    section('Summary',
      metric('Shares outstanding', shares(out)),
      metric('Fully diluted shares', shares(fd)),
      metric('Capital raised', moneyWhole(raised)),
      valuation ? metric('Implied valuation', moneyWhole(valuation)) : null,
      fmv ? metric('Fair market value (409A)', `${sharePrice(fmv.fmvPerShare)} per share, set ${dateLong(fmv.date)}`) : null,
      reserves.map((r) => metric(r.name,
        `${shares(r.authorized)} authorized · ${shares(r.committed)} committed · `
        // A retired plan's balance is not counted, so it is not unallocated; the tables above say the same.
        + (r.eligible ? `${shares(r.unallocated)} unallocated` : `${shares(Math.max(0, r.available))} not counted, retired`)))),

    section('Ownership by share class', ownershipTable(byClass)),
    section('Ownership by stakeholder', ownershipTable(byHolder)),

    convs.length ? section('Outstanding convertible instruments',
      el('div.table-wrap', { style: { border: 'none' } },
        el('table.data', {},
          el('thead', {}, el('tr', {},
            th('Holder'), th('Instrument'), th('Balance', true), th('Terms'))),
          el('tbody', {}, convs.map((s) => el('tr', {},
            el('td', {}, db.stakeholders.find((h) => h.id === s.stakeholderId)?.name || 'Unknown'),
            el('td', {}, `${s.kind === 'safe' ? 'SAFE' : 'Note'} ${s.label}`),
            el('td.num', {}, moneyWhole(convertibleValue(s, asOf))),
            el('td', {}, [
              s.valuationCap > 0 ? `${moneyWhole(s.valuationCap)} ${s.kind === 'safe' ? (s.safeType === 'post' ? 'post-money ' : 'pre-money ') : ''}cap` : null,
              s.discount > 0 ? `${s.discount}% discount` : null,
              s.kind === 'note' && s.interestRate > 0 ? `${s.interestRate}% interest` : null,
            ].filter(Boolean).join(' · ') || '-'))))))) : null,

    history.length ? section('Issuance history',
      history.map((h) => metric(dateLong(h.date), [
        `${h.count} ${h.count === 1 ? 'security' : 'securities'}`,
        h.shares > 0 ? `${sharesLabel(h.shares)}` : null,
        h.amount > 0 ? issuanceAmount(h.amount) : null,
      ].filter(Boolean).join(' · ')))) : null,

    el('p.small.muted.statement-footer', { style: { textAlign: 'center', margin: '18px 0 8px' } },
      'Cap Table is a tool, not legal advice. Confirm anything that matters with your counsel.'),
  ].filter(Boolean);
}

/**
 * How a past date's share counts relate to today's, when a split has come
 * between them: "pre-split units, before the 10-for-1 split of Aug 1, 2026",
 * or "pre-split units, before 2 later splits". Empty when the date reads in
 * the units the live cap table uses. The snapshot itself already reads in
 * the units of its day; this is the line that says so, on the screen, in
 * the export, and on the printed report - the three places a reader puts
 * the figures beside today's.
 */
function unitsNote(company, asOf) {
  const since = splitsSincePhrase(company, asOf);
  return since ? `pre-split units, before ${since}` : '';
}

/* The money an issuance day brought in. Whole dollars for a financing; a
   founder issuance at par is real money too, and rounded to the dollar it
   printed "1,000 shares · $0" on the board report. Under a dollar the cents
   are the figure, as the dashboard's tiles already read it. */
const issuanceAmount = (amount) => (amount >= 1 ? moneyWhole(amount) : money(amount));

/** Tooltip for a financing chip: what actually happened that day. */
function historyTitle(h) {
  const parts = [];
  if (h.shares > 0) parts.push(`${sharesLabel(h.shares)}`);
  if (h.amount > 0) parts.push(issuanceAmount(h.amount));
  return `${dateLong(h.date)} · ${h.count} ${h.count === 1 ? 'security' : 'securities'}${parts.length ? ` · ${parts.join(' · ')}` : ''}`;
}

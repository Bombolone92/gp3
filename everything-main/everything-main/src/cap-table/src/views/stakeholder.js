import { openWarrantActions } from '../ui/warrantactions.js';
/**
 * One stakeholder, in full: profile, ownership on both bases, every security
 * they hold, and their slice of the activity log.
 *
 * Doubles as a printable equity statement - the thing a founder hands to the
 * holder or to counsel during diligence. Printing is deliberately the browser's
 * own print-to-PDF rather than a generated document: it needs no dependency,
 * it respects the reader's paper size, and the page is already the statement.
 * This stays single-user by design; it is a document you print, not a portal.
 */

import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { statTile, initials, expiryNote, grantWindowNote, vestingMeter, emptyState, departureNote } from '../ui/bits.js';
import { toast } from '../ui/toast.js';
import { openSecurityForm } from '../ui/securityform.js';
import {
  openGrantActions, grantStatusLabel, openRsuActions, rsuStatusLabel,
} from '../ui/grantactions.js';
import { openStakeholderForm } from '../ui/stakeholderform.js';
import { store } from '../lib/store.js';
import { openDepartureFlow } from '../ui/departure.js';
import { vestingForecastCard } from '../ui/vestingcard.js';
import {
  warrantRemaining, warrantExercised, stakeholderKindInfo, ownershipByStakeholder, vestedQuantity, hasVesting,
  grantOutstanding, grantExercised, grantStatus, grantDiluted, rsuDiluted, convertibleValue, unvestedQuantity,
  postMoneyOwnership, isConverted, unvestedTotal, isISO, status83b,
  isClosed, repurchaseTerms, rsuOutstanding, rsuSettled, rsuStatus, hasLiquidityCondition,
  exerciseEconomics, isMatured,
  plansOf, awardPlanId, dbAsOf,
} from '../lib/captable.js';
import {
  shares, sharesLabel, pct, sharePrice, money, moneyWhole, dateLong, timeAgo, currencyCode, decimalValue, countLabel,
} from '../lib/format.js';
import { toCSV, downloadFile, todayISO } from '../lib/util.js';

/** The stakeholder id in `#/stakeholders/:id`, or null on the list route. */
export function stakeholderIdFromHash(hash = location.hash) {
  const m = /^#\/stakeholders\/([^/?]+)/.exec((hash || '').split('?')[0]);
  if (!m) return null;
  // A hand-typed hash can hold a malformed escape ('%'), which makes
  // decodeURIComponent throw - and an exception here takes down the whole
  // view render. The raw segment matches no stakeholder, so the detail
  // view's "that stakeholder is gone" state handles it gracefully.
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

const KIND_LABEL = {
  shares: 'Shares', option: 'Options', rsu: 'RSU', warrant: 'Warrant', safe: 'SAFE', note: 'Note',
};

/* The plan an award draws from, once there is more than one it could be. */
function planNote(s) {
  const plans = plansOf(store.company);
  if (plans.length <= 1 && !s.outsidePlan) return null;
  return plans.find((p) => p.id === awardPlanId(s, plans))?.name || 'outside any plan';
}

export function stakeholderView({ navigate, id }) {
  const holder = store.stakeholder(id);
  if (!holder) {
    return el('div', {},
      el('div.card', {}, emptyState({
        icon: 'users',
        title: 'That stakeholder is gone',
        text: 'They may have been deleted. Head back to the list to see who is on the cap table.',
      })),
      el('div.row.row-end', { style: { marginTop: '12px' } },
        el('button.btn.btn-ghost', { onclick: () => navigate('#/stakeholders') }, 'Back to stakeholders')));
  }

  const today = todayISO();
  const db = dbAsOf(store.db, today);
  const held = db.securities
    .filter((s) => s.stakeholderId === holder.id)
    .sort((a, b) => (b.date || b.grantDate || '').localeCompare(a.date || a.grantDate || ''));
  const later = store.securities.filter((s) => s.stakeholderId === holder.id).length - held.length;

  const diluted = ownershipByStakeholder(db, { base: 'diluted', includePool: true });
  const outstanding = ownershipByStakeholder(db, { base: 'outstanding' });
  const dilutedRow = diluted.rows.find((r) => r.stakeholderId === holder.id);
  const outstandingRow = outstanding.rows.find((r) => r.stakeholderId === holder.id);
  const unvested = unvestedTotal(held, today);
  /* Whether anything here vests at all. "Everything held is vested" was the
     tile's word for any zero, so a SAFE-only investor and a leaver whose one
     grant was cancelled both read as fully vested holders. */
  const vests = held.some((s) => !isClosed(s) && (
    (s.kind === 'shares' && s.quantity > 0)
    || (s.kind === 'option' && grantOutstanding(s) > 0)
    || (s.kind === 'rsu' && rsuOutstanding(s) > 0)));

  function exportCSV() {
    // Which money these figures are in, on the file itself - see the cap
    // table export.
    const code = currencyCode();
    const rows = [
      [`${db.company.name || 'Company'} - holdings for ${holder.name}, as of ${today} - amounts in ${code}`],
      [],
      ['Security', 'Type', 'Class', 'Date', 'Quantity or balance', `Price, strike, or cap (${code})`, 'Vested', 'Status'],
    ];
    for (const s of held) rows.push(csvRow(s, today, db.securities));
    const slug = holder.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'holder';
    downloadFile(`holdings-${slug}-${today}.csv`, toCSV(rows), 'text/csv');
    toast('Holdings exported');
  }

  const root = el('div', {
    dataset: { viewTitle: holder.name },
  },
    /* Statement header: only on paper, where there is no app around it. */
    el('div.print-only.statement-head', {},
      el('div.statement-co', {}, db.company.name || 'Capitalization statement'),
      el('div.statement-meta', {},
        `Equity holdings statement for ${holder.name} · as of ${dateLong(today)} · amounts in ${currencyCode()}`)),

    el('div.no-print', {},
      el('button.btn.btn-ghost.back-link', {
        onclick: () => navigate('#/stakeholders'),
        html: icon('chevL', 15, 2.2),
      }, ' All stakeholders')),

    el('div.holder-head', {},
      el('span.avatar.avatar-lg', { 'aria-hidden': 'true' }, initials(holder.name)),
      el('div.grow', {},
        el('h1.view-title', {}, holder.name),
        el('p.view-sub', {},
          [
            stakeholderKindInfo(holder.kind).label,
            holder.email,
            departureNote(holder, today),
          ].filter(Boolean).join(' · '))),
      el('div.row.no-print', { style: { flexWrap: 'wrap' } },
        el('a.btn.btn-ghost', { href: `#/history?record=${encodeURIComponent(holder.id)}`, html: icon('clock', 15, 2) }, ' History'),
        el('button.btn.btn-ghost', {
          html: icon('pencil', 15, 2), onclick: () => openStakeholderForm(holder),
        }, ' Edit'),
        !holder.departed ? el('button.btn.btn-ghost', {
          html: icon('logout', 15, 2), onclick: () => openDepartureFlow(holder),
        }, ' Mark departed') : null,
        el('button.btn.btn-ghost', {
          html: icon('file-down', 15, 2), onclick: exportCSV,
        }, ' Export CSV'),
        el('button.btn.btn-primary', {
          html: icon('printer', 15, 2), onclick: () => window.print(),
        }, ' Print or save as PDF'))),

    later > 0 ? el('div.sample-banner.no-print', {},
      el('span.grow', {}, `${later} future-dated ${later === 1 ? 'security is' : 'securities are'} excluded from today’s statement.`),
      el('a', { href: '#/securities' }, 'View all securities')) : null,

    el('div.stat-grid', {},
      statTile({
        label: 'Fully diluted', icon: 'pie',
        value: dilutedRow ? pct(dilutedRow.pct) : '0.00%',
        sub: `${shares(dilutedRow?.shares || 0)} of ${sharesLabel(diluted.total)}`,
      }),
      statTile({
        label: 'Outstanding', icon: 'table',
        value: outstandingRow ? pct(outstandingRow.pct) : '0.00%',
        sub: outstandingRow
          ? `${shares(outstandingRow.shares)} of ${countLabel(outstanding.total, 'issued share')}`
          : 'Holds no issued shares',
      }),
      statTile({
        label: 'Unvested', icon: 'clock',
        value: shares(unvested),
        sub: unvested > 0 ? 'Still being earned' : vests ? 'Everything held is vested' : 'No vesting to track',
      }),
      statTile({
        label: 'Securities', icon: 'file-text',
        value: String(held.length),
        sub: held.length ? summarize(held) : 'Nothing issued yet',
      })),

    holdingsCard(held, today, db.securities),
    /* The employee's own version of the curve, on the page - and on the
       statement, which is where they read what they are still earning. */
    unvested > 0
      ? el('div', { style: { marginBottom: '16px' } },
        vestingForecastCard({ securities: held, scope: holder.name }))
      : null,
    activityCard(holder),

    el('p.small.muted.statement-footer', { style: { textAlign: 'center', margin: '18px 0 20px' } },
      'Cap Table is a tool, not legal advice. Confirm anything that matters with your counsel.')
  );

  return root;
}

/** "2 share certificates, 1 option grant" - the shape of what they hold. */
function summarize(held) {
  const counts = new Map();
  for (const s of held) counts.set(s.kind, (counts.get(s.kind) || 0) + 1);
  const label = {
    shares: 'certificate', option: 'option grant', rsu: 'RSU award',
    warrant: 'warrant', safe: 'SAFE', note: 'note',
  };
  return [...counts.entries()]
    .map(([kind, n]) => `${n} ${label[kind]}${n === 1 ? '' : 's'}`)
    .join(' · ');
}

/* `snapshot` is the securities list the holdings were read from: today's
   table, the one the tiles above and the cap table count. A warrant nets
   the exercise certificates in the list it is handed, and handed the live
   register it netted an exercise dated next month that the banner above
   had just called excluded - 600 rights on the row under a tile counting
   1,000, while the cap table read 1,000 as well. */
function holdingsCard(held, today, snapshot) {
  if (!held.length) {
    return el('div.card', { style: { marginBottom: '16px' } },
      el('h2.card-title', {}, 'Holdings'),
      el('p.card-sub', {}, 'Nothing has been issued to this stakeholder yet.'));
  }

  return el('div.card', { style: { marginBottom: '16px' } },
    el('h2.card-title', {}, 'Holdings'),
    el('p.card-sub', { style: { marginBottom: '10px' } },
      `Every instrument held, as of ${dateLong(today)}`),
    el('div.table-wrap', { tabindex: 0, role: 'region', 'aria-label': 'Holdings table', style: { border: 'none' } },
      el('table.data', { style: { minWidth: '620px' } },
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col' }, 'Security'),
          el('th', { scope: 'col' }, 'Date'),
          el('th.num', { scope: 'col' }, 'Quantity'),
          el('th.num', { scope: 'col' }, 'Terms'),
          el('th', { scope: 'col' }, 'Status'),
          el('th.no-print', { scope: 'col' }, el('span.visually-hidden', {}, 'Actions')))),
        el('tbody', {}, held.map((s) => holdingRow(s, today, snapshot))))));
}

/**
 * What an exercise looked like on the day it happened: the fair market value
 * in force, the bargain spread it produced, and - on an ISO - the date a
 * qualifying disposition becomes possible. This statement is the document the
 * holder reads those numbers off, so they belong on the certificate rather
 * than only in the sheet that recorded the exercise.
 *
 * A transfer successor inherits `fromOptionId` but not the exercise: that
 * happened on the certificate it came from, under that certificate's date.
 */
function exerciseNote(cert) {
  if (!cert.fromOptionId || cert.fromTransferId) return null;
  const grant = store.security(cert.fromOptionId);
  const e = exerciseEconomics(store.db, grant, {
    quantity: cert.quantity, date: cert.date, strike: cert.pricePerShare,
  });
  if (!e.fmv) return el('div.small.muted', {}, 'No 409A on file for the exercise date');
  return el('div', {},
    el('div.small.muted', {}, `${sharePrice(e.fmv.fmvPerShare)} FMV at exercise`),
    e.spread > 0
      ? el('div.small', {}, `${moneyWhole(e.spread)} spread${e.iso ? ' (AMT)' : ' (income)'}`)
      : el('div.small.muted', {}, 'No spread at exercise'),
    e.iso && e.qualifyingDate
      ? el('div.small.muted', {}, `Qualifying from ${dateLong(e.qualifyingDate)}`)
      : null);
}

function holdingRow(s, today, snapshot) {
  const cls = store.shareClass(s.classId);
  let quantity;
  let terms;
  let status;

  if (s.kind === 'shares') {
    quantity = shares(s.quantity);
    terms = s.pricePerShare > 0 ? `${sharePrice(s.pricePerShare)} per share` : '-';
    /* A certificate bought in a secondary carries the seller's issue price -
       that is what the liquidation preference returns - so the statement
       would otherwise read back a price this holder never paid. */
    if (s.transferPricePerShare > 0) {
      terms = el('div', {},
        el('div', {}, terms),
        el('div.small.muted', {}, `${sharePrice(s.transferPricePerShare)} per share paid`));
    }
    const exercise = exerciseNote(s);
    if (exercise) terms = el('div', {}, el('div', {}, terms), exercise);
    if (isClosed(s)) {
      const bought = repurchaseTerms(s);
      status = el('span.small.muted', {},
        `${s.closedReason === 'repurchase' ? 'Repurchased' : 'Transferred'} ${dateLong(s.closedAt)}`
        + (bought ? ` · ${shares(bought.quantity)} for ${money(bought.consideration)}` : ''));
    } else {
      // The statement is the document diligence reads, so the 83(b) status
      // line rides with every certificate the election applies to.
      const st = status83b(s, today);
      const line83b = !st ? null
        : st.state === 'filed' ? el('div.small.muted', {}, `83(b) filed ${dateLong(st.date)}`)
          : st.state === 'open' ? el('div.small.warn', {}, `83(b) due ${dateLong(st.deadline)}`)
            : el('div.small.muted', {}, st.acknowledged ? '83(b) never filed' : '83(b) not filed');
      status = hasVesting(s)
        ? el('div', {}, vestingMeter(vestedQuantity(s, today), s.quantity, cls?.name || null), line83b)
        : el('span.small.muted', {}, cls?.name || 'Fully vested');
    }
  } else if (s.kind === 'option') {
    const outstanding = grantOutstanding(s);
    /* The figure is what the grant still puts in the diluted base, which is
       what the tiles above and the cap table count for it; the options
       already turned into certificates are on those certificates' rows.
       Reading the whole surviving grant here, the rows summed to more than
       the tile: 120,000 beside a 10,000-share exercise certificate under a
       tile of 120,000. Exercised options without a certificate yet are still
       on the grant, and the line says so. */
    const diluted = grantDiluted(s, snapshot);
    const exercised = grantExercised(s);
    const uncertified = Math.max(0, diluted - (outstanding - exercised));
    quantity = el('div', {},
      el('div', {}, shares(diluted)),
      exercised > 0 ? el('div.small.muted', {},
        `${shares(exercised)} exercised${uncertified > 0 ? `, ${shares(uncertified)} without a certificate` : ''}`) : null);
    terms = [s.strike > 0 ? `${sharePrice(s.strike)} strike` : null, isISO(s) ? 'ISO' : 'NSO', planNote(s)]
      .filter(Boolean).join(' · ');
    /* The deadline line follows the securities view: it shows wherever
       something is still exercisable (or just lapsed) - a departed holder
       with a partially exercised grant needs their post-termination window
       on the statement they're handed, not only "Partially exercised". */
    const gs = grantStatus(s, today);
    /* The meter is sized to the figure beside it - what the grant still puts
       in the diluted base - and its vested count is netted the same way
       (unvestedQuantity: the options already turned into certificates read
       their vesting on those rows). Measured on the whole surviving grant,
       a row showed 62,500 vested of 60,000 beside an early-exercise
       certificate holding the rest, and its unvested balance contradicted
       the tile above. */
    const vestedHere = Math.max(0, diluted - unvestedQuantity(s, today, snapshot));
    status = el('div', {},
      diluted > 0
        ? vestingMeter(vestedHere, diluted)
        : outstanding > 0 ? null : el('span.small.muted', {}, 'Nothing outstanding'),
      // The window note below already reads "Expired <date>" for a lapsed grant; the label said it twice.
      gs !== 'active' && gs !== 'expired' ? el('div.small.muted', {}, grantStatusLabel(s, today)) : null,
      gs === 'active' || gs === 'partially-exercised' || gs === 'expired'
        ? grantWindowNote(s, today)
        : null);
  } else if (s.kind === 'rsu') {
    const outstanding = rsuOutstanding(s);
    const settled = rsuSettled(s);
    // Units still in the diluted base, as the option row reads its grant.
    const diluted = rsuDiluted(s, snapshot);
    const uncertified = Math.max(0, diluted - (outstanding - settled));
    quantity = el('div', {},
      el('div', {}, shares(diluted)),
      settled > 0 ? el('div.small.muted', {},
        `${shares(settled)} settled${uncertified > 0 ? `, ${shares(uncertified)} without a certificate` : ''}`) : null);
    terms = [
      'No strike',
      hasLiquidityCondition(s) ? 'liquidity condition' : null,
      planNote(s),
    ].filter(Boolean).join(' · ');
    const rs = rsuStatus(s, today);
    // Netted against the settled units, as the option row is - see above.
    const vestedHere = Math.max(0, diluted - unvestedQuantity(s, today, snapshot));
    status = el('div', {},
      diluted > 0
        ? vestingMeter(vestedHere, diluted, cls?.name || null)
        : outstanding > 0 ? null : el('span.small.muted', {}, 'Nothing outstanding'),
      rs !== 'active' ? el('div.small.muted', {}, rsuStatusLabel(s, today)) : null,
      hasLiquidityCondition(s)
        ? el('div.small.muted', {}, 'Settles on a liquidity event')
        : null);
  } else if (s.kind === 'warrant') {
    const exercised = warrantExercised(s, snapshot);
    const spent = s.quantity - (s.cancelled || 0) - exercised <= 0;
    quantity = shares(warrantRemaining(s, snapshot, today));
    terms = s.strike > 0 ? `${sharePrice(s.strike)} exercise price` : '-';
    // What left the rights, the way an option row says what was exercised and cancelled.
    const movements = [exercised > 0 ? `${shares(exercised)} exercised` : null,
      s.cancelled > 0 ? `${shares(s.cancelled)} cancelled` : null].filter(Boolean).join(' · ');
    status = el('div', {},
      el('div.small.muted', {}, cls?.name || '-'),
      movements ? el('div.small.muted', {}, movements) : null,
      // No expiry line on rights that no longer exist.
      spent ? null : expiryNote(s.expires, today));
  } else {
    quantity = moneyWhole(convertibleValue(s, today));
    const parts = [];
    if (s.valuationCap > 0) {
      parts.push(`${moneyWhole(s.valuationCap)} ${s.kind === 'safe' ? `${s.safeType === 'post' ? 'post' : 'pre'}-money ` : ''}cap`);
    }
    if (s.discount > 0) parts.push(`${s.discount}% discount`);
    if (s.kind === 'note' && s.interestRate > 0) parts.push(`${s.interestRate}% interest`);
    terms = parts.join(' · ') || '-';
    const guaranteed = postMoneyOwnership(s);
    status = isConverted(s)
      ? el('span.small.muted', {}, `Converted ${dateLong(s.convertedAt)}`)
      : el('div', {},
        el('div.small.muted', {}, 'Converts at next round'),
        guaranteed !== null ? el('div.small', {}, `${pct(guaranteed)} post-money`) : null,
        isMatured(s)
          ? el('div.small.muted', {}, `Matured, settled ${dateLong(s.maturedAt)}`)
          : expiryNote(s.maturityDate, today, { verb: 'Matures', past: 'Matured' }));
  }

  return el('tr', {},
    el('td', {}, el('div', {},
      el('div', { style: { fontWeight: '570' } }, s.label),
      el('span.kind-pill', {}, KIND_LABEL[s.kind]),
      // Documentation status travels with the statement: counsel sees at a
      // glance which records carry their paper.
      s.attachments?.length ? el('span.small.muted', {
        style: { display: 'inline-flex', alignItems: 'center', gap: '2px', marginLeft: '6px', verticalAlign: 'middle' },
        title: `${s.attachments.length} attachment${s.attachments.length === 1 ? '' : 's'}`,
      },
        el('span', { html: icon('paperclip', 12, 2), style: { display: 'inline-flex' } }),
        String(s.attachments.length),
        // The paperclip is decorative, so the count says what it counts.
        el('span.visually-hidden', {}, s.attachments.length === 1 ? ' attachment' : ' attachments')) : null)),
    el('td', { style: { whiteSpace: 'nowrap' } }, dateLong(s.date || s.grantDate)),
    el('td.num', {}, quantity),
    el('td.num', {}, terms),
    el('td', {}, status),
    el('td.no-print', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
      s.kind === 'option' ? el('button.icon-btn', {
        html: icon('more', 16, 2), 'aria-label': `Lifecycle actions for ${s.label}`,
        title: 'Exercise or cancel',
        'aria-haspopup': 'dialog',
        onclick: () => openGrantActions(store.security(s.id)),
      }) : null,
      s.kind === 'warrant' ? el('button.icon-btn', {
          html: icon('more', 16, 2), 'aria-label': `Lifecycle actions for ${s.label}`,
          title: 'Exercise or cancel warrant', 'aria-haspopup': 'dialog',
          onclick: () => openWarrantActions(store.security(s.id)),
        }) : null,
        s.kind === 'rsu' ? el('button.icon-btn', {
        html: icon('more', 16, 2), 'aria-label': `Lifecycle actions for ${s.label}`,
        title: 'Settle or cancel',
        'aria-haspopup': 'dialog',
        onclick: () => openRsuActions(store.security(s.id)),
      }) : null,
      el('button.icon-btn', {
        html: icon('pencil', 16, 2), 'aria-label': `Edit ${s.label}`,
        onclick: () => openSecurityForm({ existing: store.security(s.id) }),
      })));
}

/* The activity log is free text, so a holder's slice is the entries that
   name them - by the name they have now, or by one they had before a rename
   (see Store.updateStakeholder), since the lines written then still carry
   it. One name can sit inside another's ("Beacon Angels" inside "Beacon
   Angels Fund II"), and this page prints as a statement handed to the holder
   - so a mention only counts where no longer stakeholder name covers it,
   keeping the fund's checks off the person's page. */
function activityCard(holder) {
  const needles = [holder.name, ...(holder.formerNames || [])].map((n) => n.toLowerCase());
  const others = store.stakeholders.filter((h) => h.id !== holder.id).map((h) => h.name.toLowerCase());
  const mentions = (text) => {
    const t = text.toLowerCase();
    for (const needle of needles) {
      const longer = others.filter((name) => name.length > needle.length && name.includes(needle));
      const covered = [];
      for (const name of longer) {
        for (let i = t.indexOf(name); i !== -1; i = t.indexOf(name, i + 1)) {
          covered.push([i, i + name.length]);
        }
      }
      for (let i = t.indexOf(needle); i !== -1; i = t.indexOf(needle, i + 1)) {
        if (!covered.some(([a, b]) => i >= a && i + needle.length <= b)) return true;
      }
    }
    return false;
  };
  const entries = store.activity.filter((a) => mentions(a.text)).slice(0, 10);
  if (!entries.length) return null;
  return el('div.card', {},
    el('h2.card-title', { style: { marginBottom: '6px' } }, 'History'),
    el('div.activity-list', {}, entries.map((a) => el('div.activity-item', {},
      el('span.activity-ic', { html: icon(a.icon || 'activity', 15, 1.9) }),
      el('span.grow', {}, a.text),
      el('span.activity-time', {}, timeAgo(a.at))))));
}

function csvRow(s, today, snapshot) {
  const cls = store.shareClass(s.classId)?.name || '';
  if (s.kind === 'shares') {
    const st = status83b(s, today);
    const bought = repurchaseTerms(s);
    const status = isClosed(s)
      ? `${s.closedReason === 'repurchase' ? 'Repurchased' : 'Transferred'} ${s.closedAt}`
        // Money, to the cent, as every other money cell in this file: the raw product printed 0.21000000000000002.
        + (bought ? ` · ${bought.quantity} shares for ${bought.consideration.toFixed(2)}` : '')
      : !st ? 'Issued'
        : st.state === 'filed' ? `Issued · 83(b) filed ${st.date}`
          : st.state === 'open' ? `Issued · 83(b) due ${st.deadline}`
            : 'Issued · 83(b) not filed';
    // A zero price is a figure (anti-dilution shares, par-less stock), as the cap table's export prints it.
    return [s.label, 'Shares', cls, s.date || '', s.quantity,
      // Written out in full, as the cap table's export does: String(1e-7) is "1e-7".
      s.pricePerShare == null ? '' : decimalValue(s.pricePerShare), hasVesting(s) ? vestedQuantity(s, today) : s.quantity, status];
  }
  if (s.kind === 'option') {
    // The figure the row shows: what the grant still puts in the diluted base.
    // Vested on the same base as the quantity column, as the row's meter reads it.
    const diluted = grantDiluted(s, snapshot);
    return [s.label, isISO(s) ? 'Options (ISO)' : 'Options (NSO)', 'Option grant',
      s.grantDate || s.date || '', diluted,
      s.strike ? decimalValue(s.strike) : '', Math.max(0, diluted - unvestedQuantity(s, today, snapshot)), grantStatusLabel(s, today)];
  }
  if (s.kind === 'rsu') {
    const diluted = rsuDiluted(s, snapshot);
    return [s.label, 'RSU', cls, s.grantDate || s.date || '', diluted,
      '', Math.max(0, diluted - unvestedQuantity(s, today, snapshot)),
      [rsuStatusLabel(s, today),
        hasLiquidityCondition(s) ? 'liquidity condition' : null].filter(Boolean).join(' · ')];
  }
  if (s.kind === 'warrant') {
    // The same reading the holdings table gives the row: past its date, a warrant has expired.
    const exercised = warrantExercised(s, snapshot);
    const spent = s.quantity - (s.cancelled || 0) - exercised <= 0;
    const state = spent
      ? (exercised > 0 && !(s.cancelled > 0) ? 'Fully exercised' : !exercised && s.cancelled > 0 ? 'Cancelled' : 'Nothing outstanding')
      : s.expires ? `${s.expires < today ? 'Expired' : 'Expires'} ${s.expires}` : 'Outstanding';
    // The strike as a plain decimal, like every other price in this file - `||` wrote 1e-7 and dropped a $0 strike.
    return [s.label, 'Warrant', cls, s.date || '', warrantRemaining(s, snapshot, today), s.strike ? decimalValue(s.strike) : '', '', state];
  }
  const convertibleStatus = isConverted(s) ? `Converted ${s.convertedAt}`
    : isMatured(s) ? `Matured, settled ${s.maturedAt}`
      : s.maturityDate && s.maturityDate < today ? `Matured ${s.maturityDate}`
        : 'Outstanding';
  return [s.label, s.kind === 'safe' ? 'SAFE' : 'Note', '', s.date || '',
    convertibleValue(s, today).toFixed(2), s.valuationCap || '', '', convertibleStatus];
}

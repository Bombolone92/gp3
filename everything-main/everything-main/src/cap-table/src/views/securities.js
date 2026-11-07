import { openWarrantActions } from '../ui/warrantactions.js';
import { financingTermsRows } from '../lib/financing.js';
import { toCSV, downloadFile } from '../lib/util.js';
import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { viewHead, holderCell, emptyState, expiryNote, grantWindowNote, vestingMeter, segmented } from '../ui/bits.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { openSecurityForm } from '../ui/securityform.js';
import {
  openGrantActions, grantStatusLabel, openRsuActions, rsuStatusLabel,
} from '../ui/grantactions.js';
import { openTransferForm } from '../ui/transfer.js';
import { attachmentChoiceDialog } from '../ui/attachments.js';
import { store, successorsStand, retiredLegStands, isRefusal } from '../lib/store.js';
import {
  warrantRemaining, warrantExercised, convertibleValue, postMoneyOwnership, hasVesting, vestedQuantity,
  grantOutstanding, grantVested, grantExercised, grantStatus, isConverted,
  isISO, isoGrantOverYears, isoOverLimitYears, ISO_ANNUAL_LIMIT, status83b, isClosed,
  cancellationHistory, repurchaseTerms,
  rsuOutstanding, rsuVested, rsuSettled, rsuStatus, hasLiquidityCondition, isMatured,
  isAntiDilutionShares, plansOf, awardPlanId,
} from '../lib/captable.js';
import { shares, sharesLabel, pct, sharePrice, money, moneyWhole, moneyUSD, dateLong } from '../lib/format.js';
import { todayISO } from '../lib/util.js';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'shares', label: 'Shares' },
  { value: 'option', label: 'Options' },
  { value: 'rsu', label: 'RSUs' },
  { value: 'warrant', label: 'Warrants' },
  { value: 'convertible', label: 'SAFEs & notes' },
];

const KIND_LABEL = {
  shares: 'Shares', option: 'Options', rsu: 'RSU', warrant: 'Warrant', safe: 'SAFE', note: 'Note',
};

/* The day nothing was left: an award forfeited in stages - a departure, then
   the expiration of what stayed exercisable - was cancelled on the last of
   those days, not the first, which is where its vesting stopped. */
const fullyCancelledOn = (award) => cancellationHistory(award).at(-1)?.date || '';
/* "Cancels Nov 1, 2026" while the day is still ahead: the cap table and the
   holder statement count the units until then, and "Cancelled" beside them
   read as a contradiction. The departure note keeps the same tense. */
const cancelledNote = (award, today) => {
  const on = fullyCancelledOn(award);
  return `${on > today ? 'Cancels' : 'Cancelled'} ${dateLong(on)}`;
};

/* The exercise certificates an award or warrant has that are dated after
   today: their shares, and the first of their days. The register nets them
   now and says so in the future tense, as the cap table counts the rights
   until that day. */
/* Indexed once per render: asked per row, every option and warrant row
   rescanned the whole register, a twentieth of a second at two thousand
   grants. An RSU's settlement certificates are read the same way. */
let aheadIndex = new Map();
function indexAhead(today) {
  const map = new Map();
  for (const c of store.securities) {
    if (c.kind !== 'shares' || c.fromTransferId || !(c.date > today)) continue;
    const id = c.fromWarrantId || c.fromRsuId || c.fromOptionId;
    if (!id) continue;
    const hit = map.get(id) || { quantity: 0, date: '' };
    hit.quantity += Math.max(0, Math.round(Number(c.quantity) || 0));
    if (!hit.date || c.date < hit.date) hit.date = c.date;
    map.set(id, hit);
  }
  return map;
}
function exercisedAhead(source) {
  return aheadIndex.get(source.id) || { quantity: 0, date: '' };
}

/* Module-level so the choice survives store-driven re-renders. */
let filter = 'all';
/* But not a change of dataset: a kind picked in one company arrived pressed
   in the next - "Options" over a company holding one certificate read
   "Nothing matches this filter" over an empty table. The cap table's as-of
   date resets the same way. */
let filterEpoch = null;

export function securitiesView() {
  if (filterEpoch !== store.dataEpoch) {
    filterEpoch = store.dataEpoch;
    filter = 'all';
  }
  const listWrap = el('div');
  /* The filter rebuilds the list under a control that keeps focus, so a
     screen reader heard the press and nothing of what it did - the same
     silence the search dialog's result count fills. Set on a filter change
     only: the page's own arrival is announced by its heading. */
  const status = el('div.visually-hidden', { role: 'status', 'aria-live': 'polite' });
  let shown = 0;

  function matches(s) {
    if (filter === 'all') return true;
    if (filter === 'convertible') return s.kind === 'safe' || s.kind === 'note';
    return s.kind === filter;
  }

  /* The holder's ISO years over the limit, worked out once per holder per
     render: it scans every grant of the holder, and asked once per grant it
     made the list quadratic in a holder's ISOs - a tenth of a second on top
     of every render at two thousand grants. */
  let isoOverByHolder = new Map();
  function render() {
    const db = store.db;
    isoOverByHolder = new Map();
    listWrap.replaceChildren();
    const items = db.securities.filter(matches)
      .sort((a, b) => (b.date || b.grantDate || '').localeCompare(a.date || a.grantDate || '') || b.createdAt - a.createdAt);
    shown = items.length;

    if (!items.length) {
      listWrap.append(el('div.card', {}, emptyState({
        icon: 'file-text',
        title: db.securities.length ? 'Nothing matches this filter' : 'No securities yet',
        text: db.securities.length
          ? 'Try another filter, or issue a new security.'
          : 'Share certificates, option grants, RSU awards, SAFEs, and convertible notes all live here.',
        cta: 'Issue security',
        onCta: () => openSecurityForm(),
      })));
      return;
    }

    const today = todayISO();
    aheadIndex = indexAhead(today);
    const table = el('table.data', { style: { minWidth: '820px' } },
      el('caption.visually-hidden', {}, 'Securities'),
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Security'),
        el('th.col-holder', { scope: 'col' }, 'Stakeholder'),
        el('th', { scope: 'col' }, 'Date'),
        el('th.num', { scope: 'col' }, 'Quantity / balance'),
        el('th.num', { scope: 'col' }, 'Price / terms'),
        el('th', { scope: 'col' }, 'Vesting'),
        el('th.no-print', { scope: 'col' }, el('span.visually-hidden', {}, 'Actions'))
      )),
      el('tbody', {}, items.map((s) => securityRow(s, today)))
    );
    listWrap.append(el('div.table-wrap', { tabindex: 0, role: 'region', 'aria-label': 'Securities table' }, table));
  }

  function securityRow(s, today) {
    const holder = store.stakeholder(s.stakeholderId);
    const kindLabel = KIND_LABEL[s.kind];
    /* Forfeitures already made, and ones dated ahead: the register applies
       a cancellation dated ahead live, by design, and the words keep its
       tense - "cancelled as of Jan 15" beside a cap table that counts the
       options until then, the way the exercise lines read a certificate
       dated ahead. */
    const cancelledLines = () => {
      const history = cancellationHistory(s);
      const past = history.filter((c) => !(c.date > today)).reduce((a, c) => a + c.quantity, 0);
      const later = history.filter((c) => c.date > today);
      const ahead = later.reduce((a, c) => a + c.quantity, 0);
      return [
        past > 0 ? el('div.small.muted', {}, `${shares(past)} cancelled`) : null,
        ahead > 0 ? el('div.small.muted', {}, `${shares(ahead)} cancelled as of ${dateLong(later.map((c) => c.date).sort()[0])}`) : null,
      ];
    };

    let qtyCell, priceCell, vestCell, note = null, taxNote = null;
    if (s.kind === 'shares') {
      const cls = store.shareClass(s.classId);
      qtyCell = shares(s.quantity);
      priceCell = s.pricePerShare > 0 ? sharePrice(s.pricePerShare) : '-';
      vestCell = isClosed(s)
        ? el('span.small.muted', {}, cls?.name || '-')
        : hasVesting(s)
          ? vestingMeter(vestedQuantity(s, today), s.quantity, cls?.name || null)
          : el('span.small.muted', {}, cls?.name || '-');
      // Where these shares came from, when they came from an exercise or a
      // transfer - and where they went, once a transfer closed them.
      const exercised = (s.fromOptionId || s.fromWarrantId) && store.security(s.fromOptionId || s.fromWarrantId);
      const settledFrom = s.fromRsuId && store.security(s.fromRsuId);
      const converted = s.fromConvertibleId && store.security(s.fromConvertibleId);
      const transferred = s.fromTransferId && store.security(s.fromTransferId);
      if (transferred) {
        /* Which leg this is. A transfer issues two: the buyer's, and the one
           the seller keeps. Both read "Transferred from", so the shares that
           stayed put - and every share a repurchase left with its holder -
           were described as having moved, which is exactly what did not
           happen to them. The remainder is the holder's own certificate
           continuing on a new label. */
        const remainder = s.stakeholderId === transferred.stakeholderId;
        const event = transferred.closedReason === 'repurchase' ? 'repurchase' : 'transfer';
        // The consideration the transfer form records on the buyer's leg. The
        // price column above carries the inherited issue price - what the
        // preference returns - so what the buyer actually paid reads here.
        const paid = s.transferPricePerShare > 0
          ? ` · ${sharePrice(s.transferPricePerShare)} per share paid`
          : '';
        note = el('div.small.muted', {}, remainder
          ? `Remainder of ${transferred.label} after a ${event}`
          : `Transferred from ${transferred.label}${paid}`);
      }
      else if (isAntiDilutionShares(s)) {
        note = el('div.small.muted', {}, `Anti-dilution adjustment · ${cls?.name || 'preferred'}`);
      }
      else if (exercised) note = el('div.small.muted', {}, `Exercised from ${exercised.label}`);
      else if (settledFrom) note = el('div.small.muted', {}, `Settled from ${settledFrom.label}`);
      else if (converted) note = el('div.small.muted', {}, `Converted from ${converted.label}`);
      if (isClosed(s)) {
        // A repurchase has no buyer certificate to read its terms off, so
        // what the company took back and paid is said here.
        const bought = repurchaseTerms(s);
        taxNote = el('div.small.neg', {},
          `${s.closedReason === 'repurchase' ? 'Repurchased' : 'Transferred'} ${dateLong(s.closedAt)}`
          + (bought ? ` · ${shares(bought.quantity)} for ${money(bought.consideration)}` : ''));
      } else {
        // The 83(b) clock on restricted stock: loud while the window is open,
        // quiet once it has lapsed unfiled. A closed certificate stops
        // reporting it - the shares are off the books, and its successors
        // carry whatever schedule (and election) survived.
        const st = status83b(s, today);
        if (st?.state === 'open') {
          /* The last day of the window reads "today", not "in 0 days" - the
             same vocabulary expiryNote and the dashboard's countdown use. A
             30-day statutory deadline that cannot be extended is the last
             place to say "0 days left", which reads as gone rather than as
             the one day still left to file. */
          taxNote = el('div.small.warn', {}, st.daysLeft === 0
            ? '83(b) due today'
            : `83(b) due in ${st.daysLeft} day${st.daysLeft === 1 ? '' : 's'}`);
        } else if (st?.state === 'missed') {
          // An acknowledged miss is the same fact, minus the nagging.
          taxNote = el('div.small.muted', {},
            st.acknowledged ? '83(b) never filed' : '83(b) not filed');
        }
      }
    } else if (s.kind === 'rsu') {
      const cls = store.shareClass(s.classId);
      const outstanding = rsuOutstanding(s);
      const settled = rsuSettled(s);
      const status = rsuStatus(s, today);
      // The counter is dateless; a settlement certificate dated ahead says which part of it is not yet today's, as the option row reads its exercises.
      const ahead = exercisedAhead(s, today);
      const byToday = Math.max(0, settled - ahead.quantity);
      qtyCell = el('div', {},
        el('div', {}, shares(outstanding)),
        cancelledLines(),
        byToday > 0 ? el('div.small.muted', {}, `${shares(byToday)} settled`) : null,
        ahead.quantity > 0 ? el('div.small.muted', {}, `${shares(Math.min(settled, ahead.quantity))} settled as of ${dateLong(ahead.date)}`) : null);
      // An RSU has no strike; what its terms say is where the units land.
      priceCell = el('div.small.muted', {}, 'No strike');
      vestCell = el('div', {},
        outstanding > 0
          ? vestingMeter(rsuVested(s, today), outstanding, cls?.name || null)
          : el('span.small.muted', {}, 'Nothing outstanding'),
        hasLiquidityCondition(s)
          ? el('div.small.muted', {}, 'Settles on a liquidity event')
          : null);
      if (status !== 'active') {
        note = el(`div.small.${status === 'cancelled' ? 'neg' : 'muted'}`, {},
          status === 'cancelled' && fullyCancelledOn(s)
            ? cancelledNote(s, today)
            : (status === 'settled' || status === 'partially-settled') && byToday === 0 && ahead.quantity > 0
              ? `${rsuStatusLabel(s, today)} as of ${dateLong(ahead.date)}`
              : rsuStatusLabel(s, today));
      }
    } else if (s.kind === 'warrant') {
      const cls = store.shareClass(s.classId);
      const exercised = warrantExercised(s, store.securities);
      /* The register nets an exercise dated ahead today, by design; the words
         keep its tense. "25,000 exercised" beside a certificate dated next
         month contradicted the cap table, which counts the rights until then. */
      const byToday = warrantExercised(s, store.securities, today);
      const ahead = exercisedAhead(s, today);
      const spent = s.quantity - (s.cancelled || 0) - exercised <= 0;
      /* What left the rights, the way an option row says it: the balance
         read "60,000 / 120,000 originally issued · 40,000 exercised" with the
         20,000 cancelled that reconcile it unsaid. */
      qtyCell = el('div', {},
        el('div', {}, shares(warrantRemaining(s, store.securities, today))),
        cancelledLines(),
        byToday > 0 ? el('div.small.muted', {}, `${shares(byToday)} exercised`) : null,
        ahead.quantity > 0 ? el('div.small.muted', {}, `${shares(ahead.quantity)} exercised as of ${dateLong(ahead.date)}`) : null);
      priceCell = s.strike > 0 ? sharePrice(s.strike) : '-';
      vestCell = el('div', {},
        el('div.small.muted', {}, cls?.name || '-'),
        // No expiry line on rights that no longer exist.
        spent ? null : expiryNote(s.expires, today));
      if (spent) {
        note = exercised > 0 && !(s.cancelled > 0)
          ? el('div.small.muted', {}, byToday > 0 ? 'Fully exercised' : `Fully exercised as of ${dateLong(ahead.date)}`)
          : !exercised && s.cancelled > 0 ? el('div.small.neg', {}, cancelledNote(s, today))
            : el('div.small.muted', {}, 'Nothing outstanding');
      }
    } else if (s.kind === 'option') {
      const outstanding = grantOutstanding(s);
      const exercised = grantExercised(s);
      const status = grantStatus(s, today);
      // The counter is dateless; the certificates dated ahead say which part of it is not yet today's.
      const ahead = exercisedAhead(s, today);
      const byToday = Math.max(0, exercised - ahead.quantity);
      qtyCell = el('div', {},
        el('div', {}, shares(outstanding)),
        cancelledLines(),
        byToday > 0 ? el('div.small.muted', {}, `${shares(byToday)} exercised`) : null,
        ahead.quantity > 0 ? el('div.small.muted', {}, `${shares(Math.min(exercised, ahead.quantity))} exercised as of ${dateLong(ahead.date)}`) : null);
      priceCell = s.strike > 0 ? sharePrice(s.strike) : '-';
      vestCell = el('div', {},
        outstanding > 0
          ? vestingMeter(grantVested(s, today), outstanding)
          : el('span.small.muted', {}, 'Nothing outstanding'),
        // An expiry only matters while there is still something to exercise;
        // the cutoff is the term or a post-termination window, whichever
        // closes first.
        status === 'active' || status === 'partially-exercised' || status === 'expired'
          ? grantWindowNote(s, today) : null);
      if (status !== 'active') {
        note = el(`div.small.${status === 'cancelled' || status === 'expired' ? 'neg' : 'muted'}`, {},
          status === 'cancelled' && fullyCancelledOn(s)
            ? cancelledNote(s, today)
            : (status === 'exercised' || status === 'partially-exercised') && byToday === 0 && ahead.quantity > 0
              ? `${grantStatusLabel(s, today)} as of ${dateLong(ahead.date)}`
              : grantStatusLabel(s, today));
      }
      if (isISO(s) && !isoOverByHolder.has(s.stakeholderId)) {
        isoOverByHolder.set(s.stakeholderId, isoOverLimitYears(store.db, s.stakeholderId));
      }
      const overYears = isoGrantOverYears(store.db, s, isoOverByHolder.get(s.stakeholderId) || []);
      if (overYears.length) {
        taxNote = el('div.small.warn', {},
          `Over the ${moneyUSD(ISO_ANNUAL_LIMIT)} ISO limit in ${overYears.map((o) => o.year).join(', ')}`
          + (overYears.some((o) => o.estimated) ? ' (measured at the strike)' : ''));
      }
    } else {
      qtyCell = moneyWhole(convertibleValue(s, today));
      const terms = [];
      if (s.valuationCap > 0) {
        terms.push(`${moneyWhole(s.valuationCap)} ${s.kind === 'safe' ? `${s.safeType === 'post' ? 'post' : 'pre'}-money ` : ''}cap`);
      }
      if (s.discount > 0) terms.push(`${s.discount}% disc`);
      if (s.kind === 'note' && s.interestRate > 0) terms.push(`${s.interestRate}% int`);
      priceCell = terms.join(' · ') || '-';
      // A post-money cap fixes the holder's percentage the day it's signed,
      // so it's reportable long before any round prices.
      const guaranteed = postMoneyOwnership(s);
      const cert = isConverted(s) && store.security(s.convertedToId);
      vestCell = isConverted(s)
        ? el('div', {},
          el('div.small.muted', {}, cert ? `Converted into ${cert.label}` : 'Converted'),
          el('div.small.muted', {}, dateLong(s.convertedAt)))
        : el('div', {},
          el('div.small.muted', {}, 'Converts at next round'),
          guaranteed !== null
            ? el('div.small', { style: { marginTop: '2px' } }, `${pct(guaranteed)} post-money`)
            : null,
          // A maturity that was dealt with says so, instead of warning forever.
          isMatured(s)
            ? el('div.small.muted', {}, `Matured, settled ${dateLong(s.maturedAt)}`)
            : expiryNote(s.maturityDate, today, { verb: 'Matures', past: 'Matured' }));
      if (isConverted(s)) note = el('div.small.muted', {}, 'Converted');
    }

    /* Which plan an award draws from, said once the answer is not the only
       one there is: with several plans the label alone leaves the reader
       guessing which reserve a grant came out of, and an award outside every
       plan is the odd one worth marking. */
    const plans = plansOf(store.company);
    const planNote = (s.kind === 'option' || s.kind === 'rsu') && (plans.length > 1 || s.outsidePlan)
      ? el('div.small.muted', {}, plans.find((p) => p.id === awardPlanId(s, plans))?.name || 'Outside any plan')
      : null;
    return el('tr', {},
      el('td', {}, el('div', {},
        el('div', { style: { fontWeight: '570' } }, s.label),
        el('span.kind-pill', {}, kindLabel),
        s.kind === 'option'
          ? el('span.kind-pill', { style: { marginLeft: '4px' } }, isISO(s) ? 'ISO' : 'NSO')
          : null,
        planNote,
        // The paperclip makes documentation gaps visible at a glance.
        s.attachments?.length ? el('span.small.muted', {
          style: { display: 'inline-flex', alignItems: 'center', gap: '2px', marginLeft: '6px', verticalAlign: 'middle' },
          title: `${s.attachments.length} attachment${s.attachments.length === 1 ? '' : 's'}`,
        },
          el('span', { html: icon('paperclip', 12, 2), style: { display: 'inline-flex' } }),
          String(s.attachments.length),
          // The paperclip is decorative, so the count says what it counts.
          el('span.visually-hidden', {}, s.attachments.length === 1 ? ' attachment' : ' attachments')) : null,
        note,
        taxNote)),
      el('td.col-holder', {}, holderCell(holder)),
      el('td', { style: { whiteSpace: 'nowrap' } }, dateLong(s.date || s.grantDate)),
      el('td.num', {}, qtyCell),
      el('td.num', {}, priceCell),
      el('td', {}, vestCell),
      el('td.no-print', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
        s.kind === 'option' ? el('button.icon-btn', {
          html: icon('more', 16, 2), 'aria-label': `Lifecycle actions for ${s.label}`,
          title: 'Exercise or cancel',
          'aria-haspopup': 'dialog',
          onclick: () => openGrantActions(s),
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
          onclick: () => openRsuActions(s),
        }) : null,
        s.kind === 'shares' && !isClosed(s) ? el('button.icon-btn', {
          html: icon('refresh', 16, 2), 'aria-label': `Transfer ${s.label}`,
          title: 'Transfer or repurchase',
          'aria-haspopup': 'dialog',
          onclick: () => openTransferForm(s),
        }) : null,
        el('button.icon-btn', {
          html: icon('pencil', 16, 2), 'aria-label': `Edit ${s.label}`,
          onclick: () => openSecurityForm({ existing: s }),
        }),
        el('button.icon-btn', {
          html: icon('trash', 16, 2), 'aria-label': `Delete ${s.label}`,
          onclick: () => removeSecurity(s),
        }))
    );
  }

  async function removeSecurity(s) {
    /* An award that has been exercised or settled is the pool's record of
       where those shares came from; the store refuses to delete it while the
       certificates stand, and the reason is better read here than as a
       failed write. */
    const issued = store.certificatesFrom(s.id);
    if (issued.length) {
      toast(`${s.label} was ${s.kind === 'rsu' ? 'settled' : 'exercised'} into ${issued.map((c) => c.label).join(', ')}. `
        + 'Delete those certificates first, or cancel what is left of the award instead', { icon: 'alert' });
      return;
    }
    /* Likewise a certificate a transfer drew successors off: they were sized
       and dated against it, and the exercise behind it nets against it. */
    const successors = store.successorsOf(s.id);
    if (successors.length) {
      toast(successorsStand(s, successors), { icon: 'alert' });
      return;
    }
    /* A leg since repurchased in full, while the certificate it came off
       still stands closed against it: the store refuses it too, for the
       reason retiredLegStands gives. */
    if (s.kind === 'shares' && s.fromTransferId && isClosed(s)) {
      const source = store.security(s.fromTransferId);
      if (source && isClosed(source)) {
        toast(retiredLegStands(s, source), { icon: 'alert' });
        return;
      }
    }
    /* And a converted SAFE or note while the shares it became stand: the
       store refuses it too, and deleting the certificate is the way to undo
       a conversion - it puts the instrument back among the convertibles. */
    const became = store.convertedInto(s);
    if (became) {
      toast(`${s.label} was converted into ${became.label}. Delete that certificate first, `
        + `which makes the ${s.kind === 'safe' ? 'SAFE' : 'note'} an outstanding convertible again`, { icon: 'alert' });
      return;
    }
    /* A conversion certificate is the shares a SAFE or note became. Deleting
       it puts the instrument back among the outstanding convertibles, which
       is a consequence worth reading before the press rather than after. */
    const source = s.kind === 'shares' && s.fromConvertibleId
      ? store.security(s.fromConvertibleId) : null;
    const reopens = source && source.convertedToId === s.id
      ? ` ${source.label} goes back to being an outstanding ${source.kind === 'safe' ? 'SAFE' : 'note'}, converting at the next round.`
      : '';
    /* A settlement certificate is the units arriving as shares. Deleting it
       hands the units back to the award - the store's rule - which is worth
       saying, since they reappear as vested and unsettled the moment it goes. */
    const award = s.kind === 'shares' && s.fromRsuId && !s.fromTransferId
      ? store.security(s.fromRsuId) : null;
    const unsettles = award?.kind === 'rsu'
      ? ` The ${shares(s.quantity)} units it settled go back onto ${award.label} as unsettled.`
      : '';
    /* An exercise certificate works the other way round - the store's rule,
       said before the press as the RSU one is: the exercise stays on the
       grant, and the certificate can be issued for it again. Deleting one
       left the diluted count unchanged and the grant offering to certify the
       same exercise, with nothing here to say that would happen. */
    const grant = s.kind === 'shares' && s.fromOptionId && !s.fromTransferId
      ? store.security(s.fromOptionId) : null;
    const uncertifies = grant?.kind === 'option'
      ? ` The exercise of ${shares(s.quantity)} options stays recorded on ${grant.label}; the certificate can be issued for it again from the grant’s actions.`
      : '';
    /* A warrant's exercise is its certificate - there is no counter on the
       warrant - so deleting the certificate undoes the exercise: the rights
       come back outstanding, and an expired warrant lapses unexercised again. */
    const warrant = s.kind === 'shares' && s.fromWarrantId && !s.fromTransferId
      ? store.security(s.fromWarrantId) : null;
    const unexercises = warrant?.kind === 'warrant'
      ? ` It is the record of ${warrant.label}’s exercise: the ${shares(s.quantity)} rights go back onto the warrant, `
        + `${warrant.expires && warrant.expires < todayISO() ? 'lapsed unexercised' : 'outstanding again'}.`
      : '';
    /* A transfer leg is one half of an event: deleting it undoes the transfer,
       so the other leg goes with it and the certificate they came off reopens
       - the store's rule, said before the press. The same two things stand in
       the way here as there: a leg transferred on, and a leg since bought
       back. */
    const transfer = store.transferOf(s);
    const siblings = transfer ? transfer.legs.filter((c) => c.id !== s.id) : [];
    for (const leg of siblings) {
      const onward = store.successorsOf(leg.id);
      if (onward.length) {
        toast(successorsStand(leg, onward, { subject: `${leg.label}, issued by the same transfer,` }), { icon: 'alert' });
        return;
      }
      if (isClosed(leg)) {
        toast(`${leg.label}, issued by the same transfer, was since repurchased, so the transfer can’t be undone here. `
          + 'Restore the point taken before it instead', { icon: 'alert' });
        return;
      }
    }
    const event = transfer?.source.closedReason === 'repurchase' ? 'repurchase' : 'transfer';
    const undoes = transfer
      ? ` ${s.label} came off ${transfer.source.label} in a ${event} on ${dateLong(transfer.source.closedAt)}. `
        + `Deleting it undoes that ${event}: `
        + (siblings.length
          ? `${siblings.map((c) => c.label).join(' and ')} ${siblings.length === 1 ? 'goes' : 'go'} with it, and `
          : '')
        + `${transfer.source.label} reopens with its ${sharesLabel(transfer.source.quantity)}.`
      : '';
    // Every record about to go, and the paper behind each of them.
    const going = transfer ? transfer.legs : [s];
    const attachments = going.flatMap((c) => c.attachments || []);
    // A record with paper behind it never deletes silently: the user picks
    // what happens to the files.
    let deleteFiles = false;
    if (attachments.length) {
      const choice = await attachmentChoiceDialog({
        title: `Delete ${s.label}?`,
        count: attachments.length,
        message: reopens || unsettles || uncertifies || unexercises || undoes
          ? `${going.length > 1 ? 'These records carry' : 'This record carries'} ${attachments.length} `
            + `attachment${attachments.length === 1 ? '' : 's'} in your Puter cloud.${reopens}${unsettles}${uncertifies}${unexercises}${undoes} `
            + `Undo restores the record${going.length > 1 ? 's' : ''}, but never a deleted file.`
          : null,
      });
      if (!choice) return;
      deleteFiles = choice === 'delete';
    } else {
      const ok = await confirmDialog({
        title: `Delete ${s.label}?`,
        message: `This removes the security and changes your cap table.${reopens}${unsettles}${uncertifies}${unexercises}${undoes}`,
        confirmLabel: 'Delete',
      });
      if (!ok) return;
    }
    try {
      const { undo, removed, reopened } = await store.deleteSecurity(s.id);
      if (deleteFiles) await store.deleteAttachmentFiles(attachments);
      store.logActivity(reopened
        ? `${removed.map((c) => c.label).join(', ')} deleted; the ${event} of ${reopened.label} was undone`
        : `${s.label} deleted`, 'trash');
      toast(reopened
        ? `${event === 'repurchase' ? 'Repurchase' : 'Transfer'} undone · ${reopened.label} reopened`
        : 'Security deleted', {
        icon: 'trash',
        /* The store's own reason when it declined - the cap table moved on, the
           company changed - rather than a connection message for both. */
        action: {
          label: 'Undo',
          // Logged, so the feed does not go on saying the record was deleted.
          onClick: () => undo()
            .then(() => store.logActivity(`${removed.map((c) => c.label).join(', ')} restored`, 'refresh'))
            .catch((err) => toast(isRefusal(err) ? err.message : 'Couldn’t undo. Check your connection',
              { icon: isRefusal(err) ? 'alert' : 'wifiOff' })),
        },
      });
    } catch (err) {
      console.error(err);
      toast(isRefusal(err) ? err.message : 'Couldn’t delete. Check your connection',
        { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
    }
  }

  const seg = segmented(FILTERS, {
    label: 'Filter securities', value: filter, extraClass: 'seg-scroll',
    onSelect: (value) => {
      filter = value;
      render();
      status.textContent = shown
        ? `${shown} ${shown === 1 ? 'security' : 'securities'} shown`
        // The card below says the same: on an empty company there is nothing to filter.
        : store.securities.length ? 'Nothing matches this filter' : 'No securities yet';
    },
  });

  const root = el('div', {},
    viewHead('Securities', 'Every instrument on your cap table',
      el('div.row', { style: { flexWrap: 'wrap' } },
        seg,
        // Only where there is something to export: a table without negotiated terms has an empty report.
        financingTermsRows(store.db).length > 1
          ? el('button.btn.btn-ghost', {
            onclick: () => downloadFile(`financing-terms-${todayISO()}.csv`, toCSV(financingTermsRows(store.db)), 'text/csv'),
          }, 'Export financing terms')
          : null,
        el('button.btn.btn-primary', {
          html: icon('plus', 15, 2.2),
          onclick: () => openSecurityForm(),
        }, ' Issue security'))),
    listWrap,
    status
  );
  render();
  return root;
}

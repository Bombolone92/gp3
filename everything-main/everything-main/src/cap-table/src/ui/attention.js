import { openWarrantActions } from './warrantactions.js';
/**
 * The needs-attention list: records whose date has passed while their
 * recorded state says otherwise, each with the action that settles it.
 *
 * `upcomingEvents` only looks forward, so an item dropped off the dashboard's
 * coming-up card at exactly the moment it started to matter. This is the other
 * half: a grant that expired and is still diluting, a note past maturity, an
 * 83(b) window that closed unfiled, a 409A that has gone stale.
 *
 * Every row offers; none of them sweeps. Resolving reuses the flows that
 * already exist - cancelling a grant back to the pool, recording a 409A - so
 * there is one way each of those things happens.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { field, emptyState, flagInvalid } from './bits.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { openCancelForm, cancelDayFor } from './grantactions.js';
import { openSecurityForm } from './securityform.js';
import { openValuationForm } from './valuationform.js';
import { openRetirePlanForm, forfeitureDestination } from './planform.js';
// As the search dialog does: a class has no page of its own, only its sheet.
import { openClassForm } from '../views/classes.js';
import { store, isRefusal } from '../lib/store.js';
import { attentionItems, convertibleValue, deadline83b, DAYS_83B, currentFMV, dbAsOf } from '../lib/captable.js';
import { shares, moneyWhole, dateLong } from '../lib/format.js';
import { todayISO, daysBetween, monthsBetween, addDaysISO } from '../lib/util.js';

const ITEM_ICON = {
  'grant-expired': 'alert',
  'warrant-expired': 'alert',
  'note-matured': 'coins',
  '83b-missed': 'alert',
  'fmv-stale': 'scale',
  'rsu-departed': 'logout',
  'grant-departed': 'logout',
  'plan-expired': 'wallet',
  'class-over-authorized': 'layers',
};

/** What each row's action button says, and what it does. */
function actionFor(item, { onDone }) {
  if (item.type === 'grant-expired') {
    const grant = store.security(item.securityId);
    if (!grant) return null;
    return {
      label: 'Cancel',
      title: `Cancel ${shares(item.quantity)} lapsed options`,
      /* The same two answers the bulk cancel above commits: everything still
         unexercised, as of the day the window actually closed. */
      run: () => openCancelForm(grant, { quantity: item.quantity, date: item.date }),
    };
  }
  if (item.type === 'rsu-departed' || item.type === 'grant-departed') {
    const award = store.security(item.securityId);
    if (!award) return null;
    /* The cancel sheet the departure flow pointed at, opened on the day the
       holder left with the units unvested that day filled in. */
    return {
      label: 'Cancel',
      title: `Cancel ${shares(item.quantity)} unvested ${item.type === 'rsu-departed' ? 'units' : 'options'}`,
      run: () => openCancelForm(award, { quantity: item.quantity, date: cancelDayFor(award, item.date) }),
    };
  }
  if (item.type === 'note-matured') {
    const note = store.security(item.securityId);
    if (!note) return null;
    return { label: 'Resolve', title: 'Record the maturity or extend it', run: () => openMaturityForm(note) };
  }
  if (item.type === '83b-missed') {
    const cert = store.security(item.securityId);
    if (!cert) return null;
    return { label: 'Record', title: 'Record the election as filed, or as never filed', run: () => open83bForm(cert) };
  }
  if (item.type === 'warrant-expired') {
    const warrant = store.security(item.securityId);
    if (!warrant) return null;
    return {
      label: 'Open',
      title: 'Review warrant exercises and cancellations',
      run: () => openWarrantActions(warrant),
    };
  }
  if (item.type === 'fmv-stale') {
    return { label: 'Record 409A', title: 'Record a new valuation', run: () => openValuationForm({ onSaved: onDone }) };
  }
  if (item.type === 'plan-expired') {
    const plan = store.plan(item.planId);
    if (!plan) return null;
    /* Two honest answers: the plan is done, so retire it (and pour what is
       left into a successor), or the board extended it, so move the date. */
    return { label: 'Retire', title: 'Retire the plan, or edit it to extend the expiration', run: () => openRetirePlanForm(plan) };
  }
  if (item.type === 'class-over-authorized') {
    const cls = store.shareClass(item.classId);
    if (!cls) return null;
    // The charter amendment is the cure; the class sheet is where its count is raised.
    return { label: 'Edit class', title: 'Raise the authorized shares', run: () => openClassForm(cls) };
  }
  /* Named types only. As a fallthrough this handed every future item type the
     409A button - the one action on this list with nothing to do with the
     record it would be sitting beside. */
  return null;
}

/**
 * The figure the row is about, formatted here rather than in the math: an
 * item's size is a display decision (thousands separators, the company's
 * currency) and lib/captable.js has no business holding either.
 */
function figureFor(item) {
  if (item.type === 'grant-expired') return `${shares(item.quantity)} unexercised`;
  if (item.type === 'warrant-expired') {
    return `${shares(item.quantity)} expired rights excluded from dilution`;
  }
  if (item.type === 'note-matured') return `${moneyWhole(item.amount)} at maturity`;
  if (item.type === '83b-missed') return `${shares(item.quantity)} restricted shares`;
  if (item.type === 'rsu-departed') return `${shares(item.quantity)} unvested units still on the award`;
  if (item.type === 'grant-departed') return `${shares(item.quantity)} unvested options still on the grant`;
  if (item.type === 'plan-expired') return `${shares(item.quantity)} still reserved and counted as fully diluted`;
  if (item.type === 'class-over-authorized') {
    return `${shares(item.quantity)} over: ${shares(item.issued)} issued against ${shares(item.authorized)} authorized`;
  }
  return null;
}

/** "3 months overdue", or the date once that stops being the useful part. */
function overdueText(item, today) {
  const days = Math.max(0, daysBetween(item.date, today));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 60) return `${days} days ago`;
  /* Calendar months, not days over 30. A row can carry both counts at once -
     "The 409A on file is 31 months old" beside "32 months ago", off by one
     about the same date - and a reader who spots that trusts neither figure
     again. `monthsBetween` is what the 409A's own age is measured with. */
  const months = monthsBetween(item.date, today);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

/**
 * A note past maturity: either the maturity was dealt with (repaid, rolled
 * into a round, settled in writing) or the date moved. Both are real records;
 * neither is guessed at.
 */
function openMaturityForm(note) {
  const today = todayISO();
  const holder = store.stakeholder(note.stakeholderId)?.name || 'the holder';
  const dateInput = el('input.input', {
    type: 'date', value: note.maturityDate || today, min: note.date || null,
    'aria-label': 'Date the maturity was settled',
  });
  const extendInput = el('input.input', {
    // An extension reaches forward: the save refuses today or earlier, and
    // the picker should not offer it.
    type: 'date', value: '', 'aria-label': 'New maturity date', min: addDaysISO(today, 1),
  });

  const saveMatured = el('button.btn.btn-primary.btn-block', { style: { padding: '12px' } },
    'Record as matured');
  const saveExtended = el('button.btn.btn-ghost.btn-block', { style: { padding: '12px' } },
    'Extend maturity');
  /* The two answers contradict each other, so both go quiet while either is
     being written: pressing one and then the other while the first was in
     flight queued both, and the last to land won. */
  const setBusy = (busy) => { saveMatured.disabled = busy; saveExtended.disabled = busy; };
  saveMatured.addEventListener('click', async () => {
    const settled = dateInput.value || today;
    /* Nothing is settled before the note exists. `min` only marks a typed
       date invalid; the value still arrives here. The store refuses it too;
       said here it points at the field. */
    if (note.date && settled < note.date) {
      // With the reason on the field, as every other sheet's refusals carry it - see flagInvalid.
      const message = `${note.label} was issued on ${dateLong(note.date)}, so it can’t have been settled before that`;
      flagInvalid(dateInput, message);
      dateInput.focus();
      toast(message, { icon: 'alert' });
      return;
    }
    setBusy(true);
    try {
      await store.updateSecurity(note.id, { maturedAt: settled });
      store.logActivity(`${note.label} recorded as matured`, 'coins');
      toast('Maturity recorded');
      modal.close();
    } catch (err) {
      console.error(err);
      toast(isRefusal(err) ? err.message : 'Couldn’t save. Check your connection',
        { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
      setBusy(false);
    }
  });

  saveExtended.addEventListener('click', async () => {
    const next = extendInput.value;
    if (!next || next <= today) {
      const message = 'Pick a new maturity date in the future';
      flagInvalid(extendInput, message);
      extendInput.focus();
      toast(message, { icon: 'alert' });
      return;
    }
    setBusy(true);
    try {
      await store.updateSecurity(note.id, { maturityDate: next, maturedAt: '' });
      store.logActivity(`${note.label} maturity extended to ${dateLong(next)}`, 'calendar');
      toast('Maturity extended');
      modal.close();
    } catch (err) {
      console.error(err);
      toast(isRefusal(err) ? err.message : 'Couldn’t save. Check your connection',
        { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
      setBusy(false);
    }
  });

  const modal = openModal({
    title: `${note.label} matured`,
    content: el('div', {},
      el('p.confirm-message', {},
        `${moneyWhole(convertibleValue(note, note.maturityDate || today))} was owed to ${holder} `
        + `on ${dateLong(note.maturityDate)}. Recording the maturity says the date was dealt with - `
        + 'repaid, rolled into a round, or settled in writing. The note itself is left exactly as it is.'),
      field('Settled on', dateInput),
      saveMatured,
      el('p.field-hint', { style: { margin: '14px 0 6px' } },
        'Or, if the maturity date moved, record the new one instead.'),
      field('New maturity date', extendInput),
      saveExtended),
  });
}

/**
 * An 83(b) window that closed: either the election was filed and never
 * recorded here, or it was not filed at all. The second is worth recording -
 * it is a fact about the shares, and it stops the app asking again.
 */
function open83bForm(cert) {
  const today = todayISO();
  const holder = store.stakeholder(cert.stakeholderId)?.name || 'the holder';
  /* The window runs from the original purchase - a transfer remainder carries
     that date as `date83b` - so the default and the checks below anchor there,
     exactly as the certificate's own edit sheet does. */
  const anchor = cert.date83b || cert.date;
  const deadline = deadline83b(cert);
  const dateInput = el('input.input', {
    type: 'date', value: anchor || today, min: anchor || null, max: deadline || null,
    'aria-label': '83(b) filing date',
  });

  const saveFiled = el('button.btn.btn-primary.btn-block', { style: { padding: '12px' } },
    'Record as filed');
  const saveMissed = el('button.btn.btn-ghost.btn-block', { style: { padding: '12px', marginTop: '10px' } },
    'Record as never filed');
  // Contradictory answers, held together - see the maturity form above.
  const setBusy = (busy) => { saveFiled.disabled = busy; saveMissed.disabled = busy; };
  saveFiled.addEventListener('click', async () => {
    /* The same two refusals the security form makes. The window is statutory
       and never extends, so a date outside it is a typo or a late election -
       and this sheet only ever opens on a window that has already closed,
       which made "filed today" the one date a reader was most likely to
       leave in the box and the one that can never be a valid filing. */
    const filed = dateInput.value || anchor || today;
    if (anchor && filed < anchor) {
      const message = 'The 83(b) can’t be filed before the shares were issued';
      flagInvalid(dateInput, message);
      dateInput.focus();
      toast(message, { icon: 'alert' });
      return;
    }
    if (deadline && filed > deadline) {
      const message = `An 83(b) election is filed within ${DAYS_83B} days of issuance, by ${dateLong(deadline)}`;
      flagInvalid(dateInput, message);
      dateInput.focus();
      toast(message, { icon: 'alert' });
      return;
    }
    setBusy(true);
    try {
      await store.updateSecurity(cert.id, { filed83b: filed, missed83b: false });
      store.logActivity(`83(b) election recorded as filed for ${cert.label}`, 'check');
      toast('Election recorded');
      modal.close();
    } catch (err) {
      console.error(err);
      toast(isRefusal(err) ? err.message : 'Couldn’t save. Check your connection',
        { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
      setBusy(false);
    }
  });

  saveMissed.addEventListener('click', async () => {
    setBusy(true);
    try {
      await store.updateSecurity(cert.id, { missed83b: true, filed83b: '' });
      store.logActivity(`83(b) election recorded as never filed for ${cert.label}`, 'alert');
      toast('Recorded. The certificate still shows no election');
      modal.close();
    } catch (err) {
      console.error(err);
      toast(isRefusal(err) ? err.message : 'Couldn’t save. Check your connection',
        { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
      setBusy(false);
    }
  });

  const modal = openModal({
    title: `83(b) for ${cert.label}`,
    content: el('div', {},
      el('p.confirm-message', {},
        `The 30-day window on ${shares(cert.quantity)} restricted shares held by ${holder} closed. `
        + 'If the election was filed, record the date. If it was not, record that too: the window '
        + 'cannot be reopened, and the certificate will keep showing no election either way.'),
      field('Filed on', dateInput),
      saveFiled,
      saveMissed),
  });
}

/** Cancel every expired grant on the list, in one commit. */
async function bulkCancel(items) {
  const grants = items.filter((i) => i.type === 'grant-expired');
  if (!grants.length) return;
  const total = grants.reduce((a, i) => a + i.quantity, 0);
  /* Where the lapsed options go is each grant's plan's expiration rule to
     say; one answer is said, several are left to the plans. */
  const where = [...new Set(grants.map((i) => store.security(i.securityId)).filter(Boolean)
    .map((grant) => forfeitureDestination(grant, 'expiration').they))];
  /* One destination for several grants takes the plural: the phrase is
     written for one award, and "as the grant is outside any plan" under a
     title counting two grants named neither. */
  const destination = where.length !== 1 ? 'go where each grant’s plan sends lapsed options'
    : grants.length > 1 ? where[0].replace(/as the grant is outside any plan$/, 'as the grants are outside any plan') : where[0];
  const ok = await confirmDialog({
    title: `Cancel ${grants.length} expired grant${grants.length === 1 ? '' : 's'}?`,
    message: `${shares(total)} unexercised options leave the fully diluted count and `
      + `${destination}. `
      + 'Each grant is cancelled as of the day its own window closed. '
      + 'A restore point is taken first.',
    confirmLabel: 'Cancel grants',
    danger: false,
  });
  if (!ok) return;
  try {
    const { cancelled, quantity } = await store.cancelLapsedGrants(grants.map((i) => i.securityId));
    store.logActivity(
      `${shares(quantity)} expired options cancelled across ${cancelled} grant${cancelled === 1 ? '' : 's'}`, 'x');
    toast(`${cancelled} grant${cancelled === 1 ? '' : 's'} cancelled`);
  } catch (err) {
    console.error(err);
    toast(isRefusal(err) ? err.message : 'Couldn’t cancel. Check your connection',
      { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
  }
}

/**
 * The card. `limit` truncates the list (the dashboard shows a few, the view
 * shows all) and `onMore` is the link out to the full list.
 */
export function attentionCard({ limit = null, onMore = null, db = null } = {}) {
  const today = todayISO();
  const current = db || dbAsOf(store.db, today);
  const items = attentionItems(current, { asOf: today });
  const shown = limit ? items.slice(0, limit) : items;
  const expired = items.filter((i) => i.type === 'grant-expired');

  if (!items.length) {
    // Only a stale 409A is flagged, so a company with none read as having a current one.
    const fmv = currentFMV(current.company, today);
    return el('div.card', {}, emptyState({
      icon: 'check',
      title: 'Nothing needs attention',
      /* Worth saying plainly: "nothing is overdue" is the answer a founder
         wants to be able to trust, and an empty card says it ambiguously. */
      text: 'No expired grants or forfeited units are still diluting, no note is past maturity, '
        + `every 83(b) window is accounted for, and ${fmv ? 'the 409A on file is current' : 'no 409A has been recorded yet'}.`,
    }));
  }

  const rows = shown.map((item) => {
    const action = actionFor(item, { onDone: null });
    return el('div.attention-row', {},
      el('span.attention-ic', { html: icon(ITEM_ICON[item.type] || 'alert', 16, 2) }),
      el('div.grow', {},
        el('div.t', {}, item.title),
        el('div.s', {}, [item.detail, figureFor(item), overdueText(item, today)]
          .filter(Boolean).join(' · '))),
      /* Named for the record it acts on: the visible word repeats down the
         list ("Cancel", "Record"), so a screen reader walking the buttons
         alone heard the same name three times with nothing to tell them
         apart. The visible label leads, so the name still matches it. */
      action
        ? el('button.btn.btn-ghost', {
          title: action.title, 'aria-label': `${action.label}: ${item.title}`, onclick: action.run,
        }, action.label)
        : null);
  });

  return el('div.card', {},
    el('div.card-head', {},
      el('div', {},
        el('h2.card-title', {}, 'Needs attention'),
        el('p.card-sub', {}, `${items.length} record${items.length === 1 ? '' : 's'} whose date has `
          + 'passed while the cap table still counts them as they were')),
      /* The bulk case, and the only one worth a button: one termination
         lapsing several grants on the same day. */
      expired.length > 1
        ? el('button.btn.btn-ghost', {
          onclick: () => bulkCancel(items),
        }, `Cancel ${expired.length} expired grants`)
        : null),
    // A sized container, so a row wraps for the width it has - see views.css.
    el('div.attention-list', {}, rows),
    limit && items.length > shown.length && onMore
      ? el('div.row.row-end', { style: { marginTop: '10px' } },
        el('button.btn.btn-ghost', { onclick: onMore },
          `See all ${items.length}`))
      : null);
}

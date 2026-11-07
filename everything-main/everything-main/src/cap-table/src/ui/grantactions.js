/**
 * Plan awards after issuance: exercising an option grant, settling an RSU
 * award into shares, and cancelling what a departing holder never earned.
 *
 * All three are deliberately explicit actions rather than fields on the edit
 * form. "Exercised: 12,000" typed into a text box says nothing about when it
 * happened or whether a certificate was ever issued for it, and an award that
 * can only be deleted leaks its shares out of the option pool forever.
 *
 * Options and RSUs share the cancellation form: the arithmetic is the same
 * (cancelled units go back to the pool, surviving units keep vesting), and only
 * the vocabulary differs.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { field, flagInvalid, authorizedWarning } from './bits.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { ensureShareClass } from './securityform.js';
import { forfeitureDestination } from './planform.js';
import { store, isRefusal } from '../lib/store.js';
import {
  grantOutstanding, grantExercised, grantStatus, vestedQuantity,
  isISO, isoGrantOverYears, isoBasisNote, ISO_ANNUAL_LIMIT, exerciseEconomics, exerciseCutoff,
  cancellationHistory, vestingCeiling, exerciseRoom,
  rsuOutstanding, rsuSettled, rsuStatus, hasLiquidityCondition,
  plansOf, awardPlanId, recyclingRule,
} from '../lib/captable.js';
import {
  shares as fmtShares, sharePrice, money, moneyWhole, moneyUSD, dateLong, amountValue, countLabel,
} from '../lib/format.js';
import { parseNum, todayISO } from '../lib/util.js';

const numInput = (attrs = {}) => el('input.input', {
  type: 'text', inputmode: 'numeric', autocomplete: 'off', ...attrs,
});

const invalid = (input, message) => {
  flagInvalid(input, message);
  input?.focus();
  toast(message, { icon: 'alert' });
};

/**
 * Why an exercise or settlement dated `when` is held to `room`: the vesting
 * of its own day, or - when an exercise already on file after it is what
 * binds - that exercise, which the new one would put ahead of its schedule.
 * The refusal names the day either way. See exerciseRoom.
 */
const ROOM_WORDS = {
  option: { verb: 'exercised', event: 'exercise' },
  unit: { verb: 'settled', event: 'settlement' },
};
function roomMessage({ room, on }, when, noun) {
  const { verb, event } = ROOM_WORDS[noun];
  if (on > when) {
    return `${room > 0 ? `Only ${countLabel(room, noun)} can be` : 'Nothing can be'} ${verb} on ${dateLong(when)} `
      + `without putting the ${event} of ${dateLong(on)} ahead of its vesting`;
  }
  return room > 0
    ? `Only ${countLabel(room, noun)} ${room === 1 ? 'was' : 'were'} vested and un${verb} on ${dateLong(when)}`
    : `Nothing was vested on ${dateLong(when)}`;
}

/* ---------- Action sheet ---------- */

const STATUS_LABEL = {
  active: 'Active',
  'partially-exercised': 'Partially exercised',
  exercised: 'Fully exercised',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export function grantStatusLabel(grant, asOf) {
  return STATUS_LABEL[grantStatus(grant, asOf)];
}

const RSU_STATUS_LABEL = {
  active: 'Active',
  'partially-settled': 'Partially settled',
  settled: 'Fully settled',
  cancelled: 'Cancelled',
};

export function rsuStatusLabel(award, asOf) {
  return RSU_STATUS_LABEL[rsuStatus(award, asOf)];
}

/* What each kind of award calls its own units, and what leaving the award
   is called. The cancellation form is shared, so its copy comes from here. */
const WORDS = {
  option: { unit: 'options', one: 'option', gone: 'exercised', goneVerb: 'exercised' },
  rsu: { unit: 'units', one: 'unit', gone: 'settled', goneVerb: 'settled' },
};

/** Units of an award that already became shares and can never be cancelled. */
const claimed = (award) => (award.kind === 'rsu' ? rsuSettled(award) : grantExercised(award));

/**
 * The day a lifecycle sheet opens on: today, held inside the award's own
 * life. Not after the right to exercise ended - a lapsed grant can still
 * record an exercise made while it was live, dated the last day that
 * qualifies - and not before the award exists. A grant dated for next month's
 * board meeting opened every sheet on today, a day the store refuses and the
 * date field's own `min` blocked before the app could say why: the sheet
 * proposed a date it could not submit, and the browser's bubble was the only
 * explanation. The award's date is the earliest day anything can happen to
 * it, so it is what the sheet opens on.
 */
function openingDate(award, { cutoff = '' } = {}) {
  const today = todayISO();
  const granted = award.grantDate || award.date || '';
  const when = cutoff && cutoff < today ? cutoff : today;
  return granted > when ? granted : when;
}

/*
 * The share class an exercise certificate is proposed in: the one the
 * grant's plan is written for (see the plan sheet), when the plan names a
 * class still on file, and otherwise the first common class.
 */
function exerciseClassId(grant) {
  const plans = plansOf(store.company);
  const plan = plans.find((p) => p.id === awardPlanId(grant, plans));
  if (plan?.classId && store.shareClass(plan.classId)) return plan.classId;
  return (store.classes.find((c) => c.kind === 'common') || store.classes[0])?.id;
}

/** The lifecycle menu for one grant: exercise, cancel. */
export function openGrantActions(grant) {
  const today = todayISO();
  const status = grantStatus(grant, today);
  const remaining = grantOutstanding(grant);
  /* Measured on the day the exercise form opens on - the last day the grant
     could still be exercised, or its own date for a grant not yet in effect.
     The schedule keeps running past an expiration in the arithmetic, so a
     lapsed grant read here as having more vested and exercisable than the
     form beneath would then accept. */
  const cutoff = exerciseCutoff(grant);
  const latest = openingDate(grant, { cutoff });
  const vestedFree = exerciseRoom(grant, store.securities, latest).room;
  // Early-exercise grants let the holder buy ahead of the schedule.
  const exercisable = grant.earlyExercise
    ? Math.max(0, remaining - grantExercised(grant))
    : vestedFree;
  // What the cancel form will actually accept: exercised options were
  // bought and can never be cancelled back.
  const cancellable = Math.max(0, remaining - grantExercised(grant));
  // Exercises recorded on the grant alone, with no certificate to date them.
  const uncertified = store.uncertifiedExercises(grant);

  const row = ({ ic, title, sub, disabled, onclick }) => el('button.more-row', {
    disabled: !!disabled,
    onclick: disabled ? null : () => { modal.close(); onclick(); },
  },
    el('span.more-ic', { html: icon(ic, 18, 1.9) }),
    el('span.grow', {},
      el('div.t', {}, title),
      el('div.s', {}, sub)),
    disabled ? null : el('span', { html: icon('chevR', 16, 2), style: { color: 'var(--ink-3)', display: 'inline-flex' } })
  );

  const overYears = isoGrantOverYears(store.db, grant);
  const content = el('div', {},
    el('p.small.muted', { style: { marginBottom: '10px' } },
      `${fmtShares(remaining)} outstanding · ${fmtShares(grantExercised(grant))} exercised · ${isISO(grant) ? 'ISO' : 'NSO'} · ${STATUS_LABEL[status]}`),
    overYears.length ? el('p.small.warn', { style: { marginBottom: '10px' } },
      `This holder’s ISOs first exercisable in ${overYears.map((o) => o.year).join(', ')} exceed the ${moneyUSD(ISO_ANNUAL_LIMIT)} limit${isoBasisNote(overYears)}; the excess is treated as an NSO by law.`) : null,
    row({
      ic: 'coins',
      title: 'Record exercise',
      sub: exercisable > 0
        ? (grant.earlyExercise && exercisable > vestedFree
          ? `${fmtShares(vestedFree)} vested · up to ${fmtShares(exercisable)} with early exercise`
          : `${fmtShares(exercisable)} vested and unexercised`)
        : (grant.earlyExercise ? 'Nothing is left to exercise' : 'Nothing vested is left to exercise'),
      disabled: exercisable <= 0,
      onclick: () => openExerciseForm(grant),
    }),
    /* Only while there is something to paper: an exercise recorded without
       its certificate has left the exercisable balance, so the row above can
       never issue it, and nothing dates it for Form 3921 until this does. */
    uncertified > 0 ? row({
      ic: 'file-text',
      title: 'Issue exercise certificate',
      sub: `${fmtShares(uncertified)} exercised options have no certificate yet`,
      onclick: () => openCertifyForm(grant),
    }) : null,
    row({
      ic: 'x',
      title: 'Cancel grant',
      // Where they go is the grant's plan's rule to say - see forfeitureDestination.
      sub: cancellable > 0
        ? (status === 'expired'
          ? `Lapsed options ${forfeitureDestination(grant, 'expiration').they}`
          : `Unvested options ${forfeitureDestination(grant, 'cancellation').they}`)
        : remaining > 0
          ? 'Everything left is already exercised'
          : 'This grant is already fully cancelled',
      disabled: cancellable <= 0,
      onclick: () => openCancelForm(grant),
    })
  );

  const modal = openModal({ title: `${grant.label} actions`, content });
  return modal;
}

/* ---------- Record exercise ---------- */

export function openExerciseForm(grant) {
  /* The right to exercise ends at the expiration or the post-termination
     deadline, whichever comes first. A grant past that day can still record
     an exercise that happened while it was live, so the form stays open and
     dates itself to the last day that qualifies - see openingDate. */
  const cutoff = exerciseCutoff(grant);
  const latest = openingDate(grant, { cutoff });
  const alreadyExercised = grantExercised(grant);
  /* Vesting is measured on the exercise date - the store enforces exactly
     this - so a backdated exercise checks against that day's balance, not
     today's larger one: net of what had been exercised by that day rather
     than of every exercise on file, and against the exercises already dated
     after it. See exerciseRoom. */
  const roomOn = (when) => exerciseRoom(grant, store.securities, when);
  const vestedFreeOn = (when) => roomOn(when).room;
  const vestedFree = vestedFreeOn(latest);
  // Early-exercise grants can buy the unvested balance too; the certificate
  // then reverse-vests on the grant's own schedule.
  const exercisable = grant.earlyExercise
    ? Math.max(0, grantOutstanding(grant) - alreadyExercised)
    : vestedFree;

  const qtyInput = numInput({
    value: amountValue(vestedFree > 0 ? vestedFree : exercisable),
    'aria-label': 'Options exercised',
  });
  const granted = grant.grantDate || grant.date || '';
  const dateInput = el('input.input', {
    type: 'date', value: latest, 'aria-label': 'Exercise date',
    ...(granted ? { min: granted } : {}),
    ...(cutoff ? { max: cutoff } : {}),
  });
  const issueCheck = el('input', { type: 'checkbox', checked: true });
  /* The class the grant's plan says its options exercise into, when the
     plan names one that is still on file; otherwise plan shares are common,
     so common is the default - but only the first one. Marking every common
     class selected leaves the browser holding the last, which on a cap table
     with a founders' class is the wrong one. */
  const defaultClassId = exerciseClassId(grant);
  const classSelect = store.classes.length
    ? el('select.select', { 'aria-label': 'Share class for the new certificate' },
      store.classes.map((c) => el('option', { value: c.id, selected: c.id === defaultClassId }, c.name)))
    : null;

  /* Cost is the smaller of the two numbers that matter; the spread is the
     other one, and the one that surprises people. Both are shown, with the
     409A they come from named, and neither is a tax calculation. */
  const costLine = el('p.field-hint', {});
  const spreadBlock = el('div');
  // A status region, as the issue sheet's typed warnings are: it appears under a field that keeps focus.
  const earlyLine = el('p.field-hint.warn', { role: 'status', style: { display: 'none' } },
    'This exercises unvested options: the certificate reverse-vests on the grant’s schedule, and an 83(b) election is due within 30 days of issuance.');
  const syncCost = () => {
    const n = parseNum(qtyInput.value) ?? 0;
    const when = dateInput.value || latest;
    // The strike is a share price; the cost is money and rounds like money.
    costLine.textContent = n > 0 && grant.strike > 0
      ? `Exercise cost at ${sharePrice(grant.strike)} per share: ${money(n * grant.strike)}`
      : '';
    spreadBlock.replaceChildren(...(n > 0 ? spreadLines(store.db, grant, n, when) : []));
    // Only where the grant allows buying ahead: on any other grant the
    // submit below refuses the count, and the line promised a certificate.
    earlyLine.style.display = grant.earlyExercise && n > vestedFreeOn(when) ? '' : 'none';
  };
  qtyInput.addEventListener('input', syncCost);
  dateInput.addEventListener('change', syncCost);
  syncCost();

  /* The certificate's class past its authorized count, said here as the
     round close says it - the classes table only says so afterwards. */
  const overrun = authorizedWarning();
  const syncOverrun = () => {
    if (!classSelect || !issueCheck.checked) { overrun.sync(store.db, '', 0); return; }
    overrun.sync(store.db, classSelect.value, parseNum(qtyInput.value) ?? 0);
  };
  qtyInput.addEventListener('input', syncOverrun);
  classSelect?.addEventListener('change', syncOverrun);
  const certBlock = el('div', {},
    classSelect
      ? field('Share class', el('div.select-wrap', {}, classSelect),
        'The certificate is issued at the strike price')
      : el('p.field-hint', { style: { marginBottom: '12px' } },
        'A Common Stock class is created for the certificate; set its authorized count under Share classes.'),
    overrun.node);
  const syncCert = () => { certBlock.style.display = issueCheck.checked ? '' : 'none'; syncOverrun(); };
  issueCheck.addEventListener('change', syncCert);
  syncCert();

  const saveBtn = el('button.btn.btn-primary.btn-block', { type: 'submit', style: { padding: '12px' } },
    'Record exercise');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const n = parseNum(qtyInput.value) ?? 0;
      if (parseNum(qtyInput.value) === null && qtyInput.value.trim()) return invalid(qtyInput, 'The option count must be a number, like 1,000');
      if (!(n > 0)) return invalid(qtyInput, 'Enter how many options were exercised');
      /* Whole options, here and on the settle and cancel forms below: the
         store rounds a fraction on the way in, so "10.5" exercised 11 and
         issued a certificate for 11 under a toast naming the exercise done. */
      if (!Number.isInteger(n)) return invalid(qtyInput, 'Options are exercised in whole numbers');
      /* Against what the grant has left, whatever the date. The vested
         balance is a matter of the exercise date, and is checked against it
         below: measured on today instead, an exercise dated ahead - which
         the store takes, as the settle sheet does - was refused for
         outrunning today's smaller balance. */
      const left = Math.max(0, grantOutstanding(grant) - alreadyExercised);
      if (n > left) return invalid(qtyInput, `Only ${countLabel(left, 'option')} ${left === 1 ? 'is' : 'are'} left to exercise`);
      const when = dateInput.value || latest;
      if (when < (grant.grantDate || grant.date || when)) {
        return invalid(dateInput, 'The exercise date can’t precede the grant');
      }
      // The store refuses this too; said here it names the day it ended.
      if (cutoff && when > cutoff) {
        return invalid(dateInput, `These options could not be exercised after ${dateLong(cutoff)}`);
      }
      // The rule the store enforces, said with the date in it: without this,
      // a backdated exercise fails deep in the commit and surfaces as a
      // connection problem.
      const room = roomOn(when);
      if (!grant.earlyExercise && n > room.room) return invalid(qtyInput, roomMessage(room, when, 'option'));

      saveBtn.disabled = true;
      try {
        // The class may need creating first (harmless on its own), but the
        // grant update and the certificate land in one commit - a failed
        // write must never record the exercise and lose its certificate.
        let classId = null;
        if (issueCheck.checked) {
          classId = classSelect?.value;
          if (!classId) classId = (await ensureShareClass()).id;
        }
        const cert = await store.exerciseOption(grant.id, { quantity: n, date: when, classId });
        const holder = store.stakeholder(grant.stakeholderId)?.name || 'the holder';
        const certLabel = cert?.label || null;
        store.logActivity(certLabel
          ? `${holder} exercised ${countLabel(n, 'option')} from ${grant.label} into ${certLabel}`
          : `${holder} exercised ${countLabel(n, 'option')} from ${grant.label}`, 'coins');
        toast(certLabel ? `Exercise recorded · ${certLabel} issued` : 'Exercise recorded');
        modal.close();
      } catch (err) {
        console.error(err);
        toast(isRefusal(err) ? err.message : 'Couldn’t save. Check your connection',
          { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
        saveBtn.disabled = false;
      }
    },
  },
    el('p.confirm-message', {},
      grant.earlyExercise && exercisable > vestedFree
        ? `${fmtShares(vestedFree)} of ${grant.label} are vested and unexercised; early exercise allows up to ${fmtShares(exercisable)}.`
        : `${fmtShares(exercisable)} of ${grant.label} are vested and unexercised.`),
    el('div.form-grid', {},
      field('Options exercised', qtyInput),
      field('Exercise date', dateInput)),
    costLine,
    spreadBlock,
    earlyLine,
    isISO(grant) ? el('p.field-hint', { style: { marginBottom: '12px' } },
      'This is an ISO exercise: the company must file Form 3921 for the calendar year it happens in.') : null,
    el('label.check-row', { style: { margin: '4px 0 12px' } }, issueCheck,
      el('span', {}, 'Also issue the share certificate')),
    certBlock,
    saveBtn);

  const modal = openModal({ title: `Exercise ${grant.label}`, content: form });
}

/**
 * Issue the certificate for an exercise recorded without one.
 *
 * The exercise form can issue a certificate only for options it is
 * exercising, and these have already left the exercisable balance - so an
 * exercise recorded with the certificate box unticked, or a cap table
 * imported with its counters but not its certificates, had no way to be
 * papered afterwards, while the Form 3921 report went on saying to issue
 * the certificate. The counter does not move here: the exercise happened.
 * The certificate is dated the day it did, and held to the same rules an
 * exercise is - see Store.certifyExercise.
 */
export function openCertifyForm(grant) {
  const cutoff = exerciseCutoff(grant);
  const latest = openingDate(grant, { cutoff });
  const granted = grant.grantDate || grant.date || '';
  const uncertified = store.uncertifiedExercises(grant);
  /* Vested on a date, net of what had been exercised by then - what the
     exercise form would have measured this one against on the day. The
     options being certified leave the undated balance as they gain a day.
     See exerciseRoom. */
  const roomOn = (when, n) => exerciseRoom(grant, store.securities, when, { certifying: n });
  const vestedFreeOn = (when, n) => roomOn(when, n).room;

  const qtyInput = numInput({ value: amountValue(uncertified), 'aria-label': 'Options to certify' });
  const dateInput = el('input.input', {
    type: 'date', value: latest, 'aria-label': 'Exercise date',
    ...(granted ? { min: granted } : {}),
    ...(cutoff ? { max: cutoff } : {}),
  });
  const defaultClassId = exerciseClassId(grant);
  const classSelect = store.classes.length
    ? el('select.select', { 'aria-label': 'Share class for the certificate' },
      store.classes.map((c) => el('option', { value: c.id, selected: c.id === defaultClassId }, c.name)))
    : null;

  const costLine = el('p.field-hint', {});
  const spreadBlock = el('div');
  const earlyLine = el('p.field-hint.warn', { role: 'status', style: { display: 'none' } },
    'Not all of these options were vested on this date, so the certificate reverse-vests on the grant’s schedule, and its 83(b) window is measured from the exercise date.');
  const syncCost = () => {
    const n = parseNum(qtyInput.value) ?? 0;
    const when = dateInput.value || latest;
    costLine.textContent = n > 0 && grant.strike > 0
      ? `Issued at the strike of ${sharePrice(grant.strike)} per share: ${money(n * grant.strike)} paid`
      : '';
    spreadBlock.replaceChildren(...(n > 0 ? spreadLines(store.db, grant, n, when) : []));
    earlyLine.style.display = grant.earlyExercise && n > 0 && n > vestedFreeOn(when, n) ? '' : 'none';
  };
  qtyInput.addEventListener('input', syncCost);
  dateInput.addEventListener('change', syncCost);
  syncCost();

  const overrun = authorizedWarning();
  const syncOverrun = () => {
    if (classSelect) overrun.sync(store.db, classSelect.value, parseNum(qtyInput.value) ?? 0);
  };
  qtyInput.addEventListener('input', syncOverrun);
  classSelect?.addEventListener('change', syncOverrun);
  syncOverrun();

  const saveBtn = el('button.btn.btn-primary.btn-block', { type: 'submit', style: { padding: '12px' } },
    'Issue certificate');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const n = parseNum(qtyInput.value) ?? 0;
      if (!(n > 0)) return invalid(qtyInput, 'Enter how many exercised options the certificate covers');
      if (!Number.isInteger(n)) return invalid(qtyInput, 'A certificate covers a whole number of shares');
      if (n > uncertified) {
        return invalid(qtyInput, `Only ${fmtShares(uncertified)} exercised options are without a certificate`);
      }
      const when = dateInput.value || latest;
      if (granted && when < granted) {
        return invalid(dateInput, 'The exercise date can’t precede the grant');
      }
      if (cutoff && when > cutoff) {
        return invalid(dateInput, `These options could not be exercised after ${dateLong(cutoff)}`);
      }
      const { room, on } = roomOn(when, n);
      if (!grant.earlyExercise && n > room) {
        return invalid(dateInput, on > when
          ? `${room > 0 ? `Only ${fmtShares(room)} of these options can be dated` : 'These options can’t be dated'} `
            + `${dateLong(when)} without putting the exercise of ${dateLong(on)} ahead of its vesting`
          : (room > 0
            ? `Only ${fmtShares(room)} of these options were vested on ${dateLong(when)}`
            : `Nothing was vested on ${dateLong(when)}`));
      }

      saveBtn.disabled = true;
      try {
        const classId = classSelect?.value || (await ensureShareClass()).id;
        const cert = await store.certifyExercise(grant.id, { quantity: n, date: when, classId });
        const holder = store.stakeholder(grant.stakeholderId)?.name || 'the holder';
        store.logActivity(
          `${cert.label} issued to ${holder} for ${countLabel(n, 'option')} exercised from ${grant.label}`, 'file-text');
        toast(`${cert.label} issued`);
        modal.close();
      } catch (err) {
        console.error(err);
        toast(isRefusal(err) ? err.message : 'Couldn’t save. Check your connection',
          { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
        saveBtn.disabled = false;
      }
    },
  },
    el('p.confirm-message', {},
      `${fmtShares(uncertified)} of ${grant.label}’s exercised options have no certificate. `
      + 'Issue one dated the day they were exercised. The exercise itself is already recorded and does not change.'),
    el('div.form-grid', {},
      field('Options covered', qtyInput),
      field('Exercise date', dateInput)),
    costLine,
    spreadBlock,
    earlyLine,
    isISO(grant) ? el('p.field-hint', { style: { marginBottom: '12px' } },
      'This is an ISO exercise: once dated, it joins the Form 3921 return for that calendar year.') : null,
    classSelect
      ? field('Share class', el('div.select-wrap', {}, classSelect),
        'The certificate is issued at the strike price')
      : el('p.field-hint', { style: { marginBottom: '12px' } },
        'A Common Stock class is created for the certificate; set its authorized count under Share classes.'),
    overrun.node,
    saveBtn);

  const modal = openModal({ title: `Certify ${grant.label} exercise`, content: form });
}

/**
 * The spread on an exercise, in words: the FMV in force on the date, the
 * bargain element, and what that element is for this grant type - ordinary
 * income on an NSO, an AMT preference item on an ISO. Plus, for an ISO, the
 * date a qualifying disposition becomes possible, which is worth seeing
 * before the decision rather than after it.
 *
 * Returns an array of nodes so callers can drop it into a sheet or a
 * statement row unchanged.
 */
export function spreadLines(db, grant, quantity, date) {
  const e = exerciseEconomics(db, grant, { quantity, date });
  if (!e.fmv) {
    return [el('p.field-hint', {},
      'No 409A is on file for this date, so the spread can’t be estimated. '
      + 'Record the valuation your provider gave you under Settings.')];
  }
  const lines = [
    el('p.field-hint', {},
      `Fair market value on ${dateLong(date)}: ${sharePrice(e.fmv.fmvPerShare)} per share `
      + `(409A set ${dateLong(e.fmv.date)}).`),
  ];
  if (e.spread > 0) {
    lines.push(el('p.field-hint', {},
      `Bargain spread: ${money(e.spread)} (${sharePrice(e.spreadPerShare)} per share `
      + `× ${fmtShares(e.quantity)}). `
      + (e.iso
        ? 'On an ISO this is an AMT preference item at exercise, not ordinary income.'
        : 'On an NSO this is ordinary income at exercise, subject to withholding.')));
  } else if (e.spread < 0) {
    lines.push(el('p.field-hint', {},
      'The strike is above the fair market value on this date, so there is no bargain '
      + 'element to report.'));
  } else {
    lines.push(el('p.field-hint', {},
      'The strike equals the fair market value on this date, so there is no bargain element.'));
  }
  if (e.iso && e.qualifyingDate) {
    lines.push(el('p.field-hint', {},
      `A qualifying disposition needs the shares held until ${dateLong(e.qualifyingDate)}: `
      + 'two years from the grant and one year from the exercise, whichever is later.'));
  }
  lines.push(el('p.field-hint', { style: { marginBottom: '12px' } },
    'Estimates from the 409A on file and the arithmetic above. Cap Table records inputs, '
    + 'not a tax position: no rates, brackets, or withholding are applied.'));
  return lines;
}

/* ---------- RSU awards ---------- */

/** The lifecycle menu for one RSU award: settle, cancel. */
export function openRsuActions(award) {
  const today = todayISO();
  const remaining = rsuOutstanding(award);
  const settled = rsuSettled(award);
  // An RSU has no early settlement: nothing but vested units can be settled -
  // measured on the day the settle sheet opens on.
  const settleable = exerciseRoom(award, store.securities, openingDate(award)).room;
  const cancellable = Math.max(0, remaining - settled);

  const row = ({ ic, title, sub, disabled, onclick }) => el('button.more-row', {
    disabled: !!disabled,
    onclick: disabled ? null : () => { modal.close(); onclick(); },
  },
    el('span.more-ic', { html: icon(ic, 18, 1.9) }),
    el('span.grow', {},
      el('div.t', {}, title),
      el('div.s', {}, sub)),
    disabled ? null : el('span', { html: icon('chevR', 16, 2), style: { color: 'var(--ink-3)', display: 'inline-flex' } })
  );

  const content = el('div', {},
    el('p.small.muted', { style: { marginBottom: '10px' } },
      `${fmtShares(remaining)} outstanding · ${fmtShares(settled)} settled · ${rsuStatusLabel(award, today)}`),
    /* A liquidity condition is the reason a fully vested award still holds no
       shares, so it is said here rather than left to be inferred from a
       settlement button that looks available. */
    hasLiquidityCondition(award) ? el('p.small.warn', { style: { marginBottom: '10px' } },
      'These units settle only on a liquidity event. Record the settlement when that happens.') : null,
    row({
      ic: 'coins',
      title: 'Record settlement',
      sub: settleable > 0
        ? `${fmtShares(settleable)} vested and unsettled`
        : 'Nothing vested is left to settle',
      disabled: settleable <= 0,
      onclick: () => openSettleForm(award),
    }),
    row({
      ic: 'x',
      title: 'Cancel units',
      sub: cancellable > 0
        ? `Unvested units ${forfeitureDestination(award, 'cancellation').they}`
        : remaining > 0
          ? 'Everything left is already settled'
          : 'This award is already fully cancelled',
      disabled: cancellable <= 0,
      onclick: () => openCancelForm(award),
    })
  );

  const modal = openModal({ title: `${award.label} actions`, content });
  return modal;
}

/**
 * Settle vested units into shares. Unlike an exercise there is nothing to
 * pay and nothing optional about the certificate: settlement *is* the shares
 * arriving, so the form asks how many and when, and the store writes both
 * halves in one commit.
 */
export function openSettleForm(award) {
  // Today, or the award's own date for one not yet in effect - see openingDate.
  const today = openingDate(award);
  const already = rsuSettled(award);
  /* Vested on the settlement date, net of the units settled by then rather
     than of every settlement on file - see exerciseRoom. */
  const roomOn = (when) => exerciseRoom(award, store.securities, when);
  const settleableOn = (when) => roomOn(when).room;
  const settleable = settleableOn(today);

  const qtyInput = numInput({ value: amountValue(settleable), 'aria-label': 'Units settled' });
  // Floored at the award date, as the exercise picker is at the grant's: the
  // submit refuses an earlier day either way, but the picker should not offer it.
  const granted = award.grantDate || award.date || '';
  const dateInput = el('input.input', {
    type: 'date', value: today, 'aria-label': 'Settlement date',
    ...(granted ? { min: granted } : {}),
  });
  const cls = store.shareClass(award.classId);
  /* The award names the class it settles into, so this is a read-out rather
     than a picker - changing it would settle a promise of one class into
     another. */
  const classSelect = store.classes.length
    ? el('select.select', { 'aria-label': 'Share class settled into' },
      store.classes.map((c) => el('option', {
        value: c.id, selected: c.id === award.classId,
      }, c.name)))
    : null;

  const summary = el('p.field-hint', {});
  const syncSummary = () => {
    const n = parseNum(qtyInput.value) ?? 0;
    const on = settleableOn(dateInput.value || today);
    summary.textContent = n > 0
      ? `${countLabel(n, 'share')} ${n === 1 ? 'is' : 'are'} issued at no cost; ${countLabel(Math.max(0, rsuOutstanding(award) - already - n), 'unit')} ${Math.max(0, rsuOutstanding(award) - already - n) === 1 ? 'stays' : 'stay'} outstanding.`
      : `${countLabel(on, 'unit')} ${on === 1 ? 'was' : 'were'} vested and unsettled on this date.`;
  };
  qtyInput.addEventListener('input', syncSummary);
  dateInput.addEventListener('change', syncSummary);
  syncSummary();

  const overrun = authorizedWarning();
  const syncOverrun = () => overrun.sync(store.db, classSelect?.value || award.classId, parseNum(qtyInput.value) ?? 0);
  qtyInput.addEventListener('input', syncOverrun);
  classSelect?.addEventListener('change', syncOverrun);
  syncOverrun();

  const saveBtn = el('button.btn.btn-primary.btn-block', { type: 'submit', style: { padding: '12px' } },
    'Record settlement');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const n = parseNum(qtyInput.value) ?? 0;
      if (parseNum(qtyInput.value) === null && qtyInput.value.trim()) return invalid(qtyInput, 'The unit count must be a number, like 1,000');
      if (!(n > 0)) return invalid(qtyInput, 'Enter how many units settled');
      if (!Number.isInteger(n)) return invalid(qtyInput, 'Units settle in whole numbers');
      const when = dateInput.value || today;
      if (when < (award.grantDate || award.date || when)) {
        return invalid(dateInput, 'The settlement date can’t precede the award');
      }
      // The rule the store enforces, said with the date in it - otherwise a
      // backdated settlement fails deep in the commit and surfaces as a
      // connection problem.
      const room = roomOn(when);
      if (n > room.room) return invalid(qtyInput, roomMessage(room, when, 'unit'));

      saveBtn.disabled = true;
      try {
        const cert = await store.settleRSU(award.id, {
          quantity: n, date: when, classId: classSelect?.value || award.classId,
        });
        const holder = store.stakeholder(award.stakeholderId)?.name || 'the holder';
        store.logActivity(
          `${countLabel(n, 'unit')} of ${award.label} settled for ${holder} into ${cert.label}`, 'coins');
        toast(`Settlement recorded · ${cert.label} issued`);
        modal.close();
      } catch (err) {
        console.error(err);
        toast(isRefusal(err) ? err.message : 'Couldn’t save. Check your connection',
          { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
        saveBtn.disabled = false;
      }
    },
  },
    el('p.confirm-message', {},
      `${fmtShares(settleable)} of ${award.label} are vested and unsettled. Settling issues `
      + `a certificate in ${cls?.name || 'the award’s share class'} and links it back to this award.`),
    el('div.form-grid', {},
      field('Units settled', qtyInput),
      field('Settlement date', dateInput)),
    summary,
    classSelect
      ? field('Settles into', el('div.select-wrap', {}, classSelect),
        'The class the award promised. Changing it settles into a different class.')
      : null,
    overrun.node,
    el('p.field-hint', { style: { marginBottom: '12px' } },
      'Withholding, sell-to-cover, and net settlement are not modeled: this records the '
      + 'shares the holder received.'),
    saveBtn);

  const modal = openModal({ title: `Settle ${award.label}`, content: form });
}

/* ---------- Cancel an award ---------- */

/**
 * The day a departed holder's award is cancelled on: the departure, where the
 * units unvested that day are what the plan forfeited - unless more has been
 * settled or exercised since than had vested by then. The departure flow
 * leaves RSU awards to the cancel sheet, so an award can go on vesting and
 * settling after the holder left, and a cancellation dated on the departure
 * would then freeze its vesting below what was settled, which the store
 * refuses. It is dated on the last settlement instead, the first day the
 * schedule covers what was claimed (today, when nothing dated does). The
 * needs-attention row and the award's own actions sheet both open the cancel
 * sheet on it; the sheet used to open on the departure day from the actions
 * menu and refuse its own default.
 */
export function cancelDayFor(award, left) {
  if (award.kind === 'option' && award.earlyExercise) return left;
  const claimed = award.kind === 'rsu' ? rsuSettled(award) : grantExercised(award);
  const vestedOn = (day) => vestedQuantity({ ...award, cancelledDate: '', vestingStoppedAt: '' }, day);
  if (claimed <= vestedOn(left)) return left;
  const latest = store.securities
    .filter((s) => s.kind === 'shares' && !s.fromTransferId && s.date
      && (award.kind === 'rsu' ? s.fromRsuId : s.fromOptionId) === award.id)
    .reduce((a, s) => (a && a >= s.date ? a : s.date), '');
  const today = todayISO();
  if (latest && latest > left && latest <= today && claimed <= vestedOn(latest)) return latest;
  return today;
}

/**
 * Put back exactly the cancellation the toast is offering to undo.
 *
 * Read fresh and matched against what was written, so anything cancelled on
 * the same award since - by another sheet, in the seconds the toast is up -
 * is left alone rather than being rolled back along with it. Putting back an
 * empty history drops the cancellation date with it, which is what the
 * sanitizer does and what "never cancelled" means.
 */
async function undoCancel(grant, { n, previously, history, words }) {
  const now = store.security(grant.id);
  const current = Math.max(0, Math.round(Number(now?.cancelled) || 0));
  if (!now || current !== previously + n) {
    toast(`${grant.label} has changed since - nothing was undone`, { icon: 'alert' });
    return;
  }
  try {
    await store.updateSecurity(grant.id, { cancelled: 0, cancelledDate: '', cancellations: history });
    store.logActivity(
      `${countLabel(n, words.one)} put back on ${grant.label}`, 'refresh');
    toast(grant.kind === 'rsu' ? 'Units restored' : 'Cancellation undone', { icon: 'refresh' });
  } catch (err) {
    console.error(err);
    toast(isRefusal(err) ? err.message : 'Couldn’t undo. Check your connection',
      { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
  }
}

export function openCancelForm(grant, { quantity = null, date = null } = {}) {
  const today = todayISO();
  const remaining = grantOutstanding(grant);
  const words = WORDS[grant.kind] || WORDS.option;

  /* A grant whose window has closed lapses whole: everything still
     unexercised goes back, as of the day the right to exercise ended. The
     needs-attention row opens this sheet with exactly that filled in, but the
     grant's own actions sheet opened it on today's unvested balance - which
     on a grant that vested in full years before it expired is zero, so the
     sheet offered to return nothing and dated the lapse today. The same two
     answers now, whichever way in. */
  const cutoff = grant.kind === 'option' ? exerciseCutoff(grant) : '';
  const lapsed = !!cutoff && cutoff < today;
  if (lapsed && quantity === null) quantity = remaining - claimed(grant);
  if (lapsed && !date) date = cutoff;

  /* An award of a holder who has departed opens on the day they left: that
     is the day the plan forfeited the unvested units, and the departure flow
     leaves RSU awards to this sheet. An option grant the flow covered
     carries its vesting stop and opens on today - the departure already took
     its unvested balance, and whatever is cancelled from it afterwards (a
     lapse) is dated by its own event. One it never covered (added or
     backdated since) has no stop, and opens on the departure day with that
     day's unvested balance, as the needs-attention row for it does; opened
     on today it offered the smaller balance of a schedule still running for
     a holder long gone. */
  const holder = store.stakeholder(grant.stakeholderId);
  const granted = grant.grantDate || grant.date || '';
  const uncovered = grant.kind === 'rsu' || (grant.kind === 'option' && !grant.vestingStoppedAt);
  const leaverDay = uncovered && holder?.departed && holder.departed >= granted && holder.departed <= today
    ? cancelDayFor(grant, holder.departed) : '';
  const dateInput = el('input.input', {
    // Otherwise today, held to the award's own date - see openingDate.
    type: 'date', value: date || leaverDay || openingDate(grant), 'aria-label': 'Cancellation date',
    // Same floor as the settlement and exercise pickers.
    ...(granted ? { min: granted } : {}),
  });
  const qtyInput = numInput({ 'aria-label': `${words.unit} cancelled` });
  const summary = el('p.field-hint', {});
  /* Where the cancelled units go is the award's plan's rule to say: back
     into that plan's reserve, out of the reserve for good, or into a
     successor plan. An award outside every plan returns them nowhere. */
  const plans = plansOf(store.company);
  const plan = plans.find((p) => p.id === awardPlanId(grant, plans)) || null;
  /* An expiration when the forfeiture is dated the day the window closed, a
     cancellation on any other day - the reading the plan's ledger makes of
     it (see forfeitureEvent in lib/captable.js) - so a lapsed grant whose
     date is moved off the cutoff is told the rule the movement will follow. */
  const forfeiture = () => (cutoff && (dateInput.value || today) === cutoff ? 'expiration' : 'cancellation');
  /* Where the cancelled units go, as a verb phrase ("return to Plan A",
     "pour over into Plan B", "stay drawn from Plan A"): the same words the
     actions menu and the departure review use. Built here as a noun phrase
     and glued onto "go", a pour-over read "go poured over into Plan B". */
  const destination = () => forfeitureDestination(grant, forfeiture()).they;

  /* The default is the unvested balance on the cancellation date - the
     standard leaver outcome - and it moves when that date moves.

     Unless the caller named the balance. The needs-attention list opens this
     on a grant whose exercise window has already closed, where the answer is
     everything still unexercised rather than whatever happens to be unvested
     today - and on a grant that vested in full before it lapsed, the unvested
     default is zero, so the row that offered to return 100,000 options to the
     pool opened a form that returned none. A named count stands rather than
     following the date, since that is what it was computed against. */
  let qtyEdited = quantity !== null;
  if (qtyEdited) qtyInput.value = amountValue(Math.max(0, Math.round(quantity)));
  const unvestedOn = (when) => {
    /* Measured against the original schedule, and never proposing to cancel
       what the holder already has: options they bought, or units that already
       settled into shares. */
    const vested = vestedQuantity({ ...grant, cancelledDate: '', vestingStoppedAt: '' }, when);
    return Math.max(0, remaining - Math.max(vested, claimed(grant)));
  };
  /* The opening sentence names the destination too, and follows the date
     with the summary: built once, it went on saying "return to" under a
     summary that had switched to "stay drawn from" the moment a lapse was
     moved off the cutoff day. */
  const intro = el('p.confirm-message', {});
  const syncDefaults = () => {
    const when = dateInput.value || today;
    if (!qtyEdited) qtyInput.value = amountValue(unvestedOn(when));
    const n = Math.min(remaining, Math.max(0, parseNum(qtyInput.value) ?? 0));
    summary.textContent = n > 0
      ? `${countLabel(n, words.one)} ${destination()}; ${fmtShares(remaining - n)} ${remaining - n === 1 ? 'stays' : 'stay'} outstanding.`
      : 'Nothing is cancelled.';
    intro.textContent = lapsed
      ? `${grant.label}’s exercise window closed on ${dateLong(cutoff)}, so everything still unexercised lapses. `
        + `Lapsed options leave the fully diluted count and ${destination()}.`
      : `Cancelled ${words.unit} leave the fully diluted count and ${destination()}. Partial cancellations remove the last unvested installments; the remaining ${words.unit} keep their vesting schedule.`;
  };
  qtyInput.addEventListener('input', () => { qtyEdited = true; syncDefaults(); });
  dateInput.addEventListener('change', syncDefaults);
  syncDefaults();

  const saveBtn = el('button.btn.btn-danger.btn-block', { type: 'submit', style: { padding: '12px' } },
    grant.kind === 'rsu' ? 'Cancel units' : 'Cancel grant');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      /* Read fresh at submit, not as the sheet opened: a toast's Undo is
         pressable while the sheet is up (Cmd/Ctrl-Z reaches it), and it
         rewrites the very history this write appends to. Built from the
         record as opened, the save put the undone cancellation back beside
         the new one, and the new toast's Undo took only the new one off. */
      const now = store.security(grant.id);
      if (!now || now.kind !== grant.kind) {
        toast(`${grant.label} is no longer on the cap table`, { icon: 'alert' });
        modal.close();
        return;
      }
      const held = grantOutstanding(now);
      const when = dateInput.value || today;
      // Same guard the exercise form applies: a lifecycle event can't
      // precede the award it happens to.
      if (when < (now.grantDate || now.date || when)) {
        return invalid(dateInput, 'The cancellation date can’t precede the grant');
      }
      const n = parseNum(qtyInput.value) ?? 0;
      if (!(n > 0)) return invalid(qtyInput, `Enter how many ${words.unit} are cancelled`);
      if (!Number.isInteger(n)) return invalid(qtyInput, `Only whole ${words.unit} can be cancelled`);
      if (n > held) {
        return invalid(qtyInput, `${grant.label} only has ${fmtShares(held)} ${words.unit} outstanding`);
      }
      const gone = claimed(now);
      if (held - n < gone) {
        return invalid(qtyInput,
          `${fmtShares(gone)} ${words.unit} were already ${words.goneVerb} and can’t be cancelled`);
      }
      const previously = Math.max(0, Math.round(Number(now.cancelled) || 0));
      /* A forfeiture cannot remove units that were already earned and
         exercised. Check the entire history, including this cancellation;
         a partial forfeiture leaves surviving installments vesting. */
      const stop = now.cancelledDate && now.cancelledDate < when ? now.cancelledDate : when;
      const ceiling = vestingCeiling({ ...now, cancelled: previously + n, cancelledDate: stop,
        cancellations: [...cancellationHistory(now), { quantity: n, date: when }].sort((a, b) => a.date.localeCompare(b.date)) });
      if (!now.earlyExercise && gone > ceiling && ceiling < vestingCeiling(now)) {
        return invalid(dateInput, `${fmtShares(gone)} ${words.unit} were already ${words.goneVerb}, `
          + `but only ${fmtShares(ceiling)} had vested by ${dateLong(when)}`);
      }

      saveBtn.disabled = true;
      try {
        /* Appended, not overwritten: a grant cancelled twice forfeited each
           part on its own day, and a snapshot between the two dates has to
           show only the first. */
        const history = cancellationHistory(now);
        await store.updateSecurity(grant.id, {
          cancellations: [...history, { quantity: n, date: when }],
        });
        const holder = store.stakeholder(grant.stakeholderId)?.name || 'holder';
        store.logActivity(
          `${fmtShares(n)} ${words.unit} cancelled on ${grant.label} (${holder}); they ${destination()}`, 'x');
        /* A cancellation permanently changes the diluted count and the pool,
           and no form puts it back - the edit sheet has no cancelled field.
           The bulk "cancel expired grants" path takes a restore point; one
           grant at a time had nothing at all, so a mistyped count or a
           misclicked row was final. */
        // A partial cancellation leaves the grant standing, so the toast says the count.
        toast(grant.kind === 'rsu' ? 'Units cancelled' : n < held ? `${countLabel(n, 'option')} cancelled` : 'Grant cancelled', {
          action: { label: 'Undo', onClick: () => undoCancel(grant, { n, previously, history, words }) },
        });
        modal.close();
      } catch (err) {
        console.error(err);
        toast(isRefusal(err) ? err.message : 'Couldn’t save. Check your connection',
          { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
        saveBtn.disabled = false;
      }
    },
  },
    intro,
    el('div.form-grid', {},
      field('Cancellation date', dateInput),
      field(grant.kind === 'rsu' ? 'Units cancelled' : 'Options cancelled', qtyInput)),
    summary,
    el('div', { style: { height: '12px' } }),
    saveBtn);

  const modal = openModal({ title: `Cancel ${grant.label}`, content: form });
}

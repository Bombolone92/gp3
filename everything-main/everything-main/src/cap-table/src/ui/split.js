/**
 * Recording a stock split - typically a forward split right before a priced
 * round, or a reverse split when the share count got unwieldy. One ratio,
 * one effective date, a live before/after preview built from the exact
 * arithmetic the commit will run, and everything per-share-denominated
 * moves atomically.
 */

import { el } from './dom.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { field, flagInvalid } from './bits.js';
import { store, Store, MAX_STOCK_SPLITS, isRefusal } from '../lib/store.js';
import {
  sharesOutstanding, fullyDiluted, currentFMV, securityDate, plansOf, planReserve, scalePlanReserve, issuedInClass,
} from '../lib/captable.js';
import { shares as fmtShares, sharePrice, dateLong } from '../lib/format.js';
import { parseNum, todayISO } from '../lib/util.js';

/**
 * The splits recorded after `date`, as the phrase a sentence about units
 * needs: "the 2-for-1 split of Jul 1, 2025", or "2 later splits". Empty when
 * nothing has split since, or there is no date. A record dated before a
 * split is stored in today's units and read back in its own day's - see
 * recordSplit - and the as-of cap table, the valuation sheet and the
 * securities sheet all say which split stands between the two, one way.
 */
export function splitsSincePhrase(company, date) {
  const later = date ? (company?.splits || []).filter((sp) => sp.date > date) : [];
  if (!later.length) return '';
  if (later.length > 1) return `${later.length} later splits`;
  const [sp] = later;
  return `the ${sp.num}-for-${sp.den} split of ${dateLong(sp.date)}`;
}

export function openSplitForm({ onDone = null } = {}) {
  const today = todayISO();

  const numInputEl = el('input.input', {
    type: 'text', inputmode: 'numeric', value: '10', 'aria-label': 'New shares',
  });
  const denInputEl = el('input.input', {
    type: 'text', inputmode: 'numeric', value: '1', 'aria-label': 'For every old shares',
  });
  /* Today at the latest. Recording a split restates every stored quantity,
     strike and price on the spot - there is nowhere to hold "will be" - while
     `dbAsOf` reads any date before the effective one back in pre-split units.
     Dated ahead, those two rules pull apart: the cap table (a snapshot of
     today) rewinds the restatement while the dashboard, the securities list,
     the round model and the exit waterfall all read the records as they now
     stand, so the app reports two fully diluted counts a split factor apart
     with nothing on screen to say why. */
  const dateInput = el('input.input', {
    type: 'date', value: today, max: today, 'aria-label': 'Effective date',
  });

  const preview = el('div', { style: { marginBottom: '4px' } });
  const line = (label, value) => el('div.round-metric', {}, el('span', {}, label), el('span.v', {}, value));

  /* Both sides stay exactly as typed - rounding "1.5" to 2 here would record
     a different split than the one on screen. A fractional ratio is entered
     in whole numbers instead (3-for-2, not 1.5-for-1). */
  const ratio = () => ({
    num: parseNum(numInputEl.value) ?? 0,
    den: parseNum(denInputEl.value) ?? 0,
  });
  const wholeSides = ({ num, den }) => Number.isInteger(num) && Number.isInteger(den);

  const syncPreview = () => {
    const { num, den } = ratio();
    preview.replaceChildren();
    if (store.company.splits.length >= MAX_STOCK_SPLITS) {
      preview.append(el('p.field-hint.warn', {},
        `This company has reached the limit of ${MAX_STOCK_SPLITS} stock splits. Another split cannot be recorded.`));
      return;
    }
    if ((num > 0 && den > 0) && !wholeSides({ num, den })) {
      preview.append(el('p.field-hint', {},
        'Use whole numbers on both sides: a 1.5x split is recorded as 3-for-2.'));
      return;
    }
    if (!(num > 0) || !(den > 0) || num === den) {
      preview.append(el('p.field-hint', {}, num === den && num > 0
        ? 'A 1-for-1 split changes nothing.'
        : 'Enter the ratio: how many new shares replace how many old.'));
      return;
    }
    const f = num / den;
    // The same arithmetic the commit runs, so the preview is the outcome.
    const { securities: after, drift } = Store.applySplit(store.securities, { num, den });
    const outBefore = sharesOutstanding(store.securities);
    const outAfter = sharesOutstanding(after);
    /* Each plan's reserve rounds on its own, the way the commit rounds it. */
    const plansAfter = plansOf(store.company).map((p) => ({
      ...p, reserve: scalePlanReserve(planReserve(p), f),
    }));
    const poolBefore = store.company.poolAuthorized;
    const poolAfter = plansAfter.reduce((a, p) => a + p.reserve, 0);
    const fdBefore = fullyDiluted(store.securities, store.company);
    const fdAfter = fullyDiluted(after, { ...store.company, plans: plansAfter, poolAuthorized: poolAfter });
    const when = dateInput.value || today;
    const fmv = currentFMV(store.company, when);
    /* Every record is restated, whatever its date: the app has no way to
       tell a certificate entered in pre-split units from one entered in the
       units of its own, post-split day. A split recorded months after the
       fact, over grants that had been entered since in the new units,
       multiplied those grants a second time - and the preview's totals
       looked exactly right while it did. Said before the write, with the
       count, rather than found in the securities list afterwards. */
    // Only the kinds a split touches: a SAFE or note is a dollar amount and
    // reads the same before and after, whatever its date.
    const laterSecurities = store.securities.filter((s) => (
      s.kind !== 'safe' && s.kind !== 'note' && securityDate(s) > when)).length;
    const laterValuations = (store.company.valuations || []).filter((v) => v.date > when).length;
    /* The authorized count rounds once while each certificate rounds on its
       own, so a reverse split alone can leave a fully issued class past its
       count: twenty 5-share certificates under 100 authorized went 1-for-3 to
       40 against 33, and the classes table said "7 over authorized" with no
       issuance to explain it. Said here, beside the drift it comes from; a
       class already over before the split is the table's to say. */
    const overAuthorized = store.classes.map((c) => {
      if (!(c.authorized > 0) || issuedInClass(store.securities, c.id) > c.authorized) return null;
      const authorized = Math.max(1, Math.round(c.authorized * f));
      const issued = issuedInClass(after, c.id);
      return issued > authorized ? { name: c.name, over: issued - authorized, issued, authorized } : null;
    }).filter(Boolean);
    const later = [
      laterSecurities > 0 ? `${fmtShares(laterSecurities)} securit${laterSecurities === 1 ? 'y' : 'ies'}` : null,
      laterValuations > 0 ? `${fmtShares(laterValuations)} valuation${laterValuations === 1 ? '' : 's'}` : null,
    ].filter(Boolean);
    preview.append(...[
      line('Shares outstanding', `${fmtShares(outBefore)} → ${fmtShares(outAfter)}`),
      line('Fully diluted', `${fmtShares(fdBefore)} → ${fmtShares(fdAfter)}`),
      ...plansOf(store.company).filter((p) => planReserve(p) !== 0).map((p) => line(
        plansAfter.length > 1 ? `${p.name} reserve` : 'Plan reserve',
        `${fmtShares(planReserve(p))} → ${fmtShares(plansAfter.find((after) => after.id === p.id).reserve)}`)),
      fmv ? line('409A per share', `${sharePrice(fmv.fmvPerShare)} → ${sharePrice(fmv.fmvPerShare / f)}`) : null,
      /* Rounded after the sign is dropped: Math.round(-0.5) is -0, so a
         half-share drift downward read "adds 0 shares" and the toast below
         never fired for the share it added. */
      Math.abs(drift) >= 0.5
        ? el('p.field-hint.warn', { style: { marginTop: '8px' } },
          `Whole-share rounding ${drift > 0 ? 'removes' : 'adds'} ${fmtShares(Math.round(Math.abs(drift)))} share${Math.round(Math.abs(drift)) === 1 ? '' : 's'} across the cap table. Cash-in-lieu isn’t modeled.`)
        : null,
      later.length
        ? el('p.field-hint.warn', { style: { marginTop: '8px' } },
          `${later.join(' and ')} ${laterSecurities + laterValuations === 1 ? 'is' : 'are'} dated after `
          + `${dateLong(when)} and ${laterSecurities + laterValuations === 1 ? 'is' : 'are'} restated with everything else. `
          + 'If any were already entered in post-split units, correct them after recording.')
        : null,
      ...overAuthorized.map((o) => el('p.field-hint.warn', { style: { marginTop: '8px' } },
        `${o.name} will hold ${fmtShares(o.over)} more ${o.over === 1 ? 'share' : 'shares'} than its authorized count after rounding `
        + `(${fmtShares(o.issued)} against ${fmtShares(o.authorized)}). That is what a charter amendment is for; `
        + 'raise the authorized shares under Share classes once it is signed.')),
    ].filter(Boolean));
  };
  for (const i of [numInputEl, denInputEl]) i.addEventListener('input', syncPreview);
  dateInput.addEventListener('change', syncPreview);
  /* And whenever the records move under the sheet: a toast's Undo is
     pressable while it is up, and the before/after figures were computed
     from the records as the sheet opened while the split itself runs on the
     records as they stand. Unsubscribed with the sheet. */
  store.addEventListener('change', syncPreview);
  syncPreview();

  const saveBtn = el('button.btn.btn-primary.btn-block', {
    type: 'submit', disabled: store.company.splits.length >= MAX_STOCK_SPLITS, style: { padding: '12px' },
  },
    'Record split');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const { num, den } = ratio();
      /* Flag and focus, as every other sheet's refusal does: flagged alone,
         the field was announced as invalid while focus stayed on the button
         the user had just pressed. */
      const invalid = (input, message) => {
        flagInvalid(input, message);
        input.focus();
        toast(message, { icon: 'alert' });
      };
      if (!(num > 0)) return invalid(numInputEl, 'Enter how many new shares each old share becomes');
      if (!(den > 0)) return invalid(denInputEl, 'Enter the old share count side of the ratio');
      if (!wholeSides({ num, den })) {
        return invalid(Number.isInteger(num) ? denInputEl : numInputEl, 'Use whole numbers: a 1.5x split is 3-for-2');
      }
      if (num === den) return invalid(numInputEl, 'A 1-for-1 split changes nothing');
      if ((dateInput.value || today) > today) return invalid(dateInput, 'A split can’t take effect later than today');
      saveBtn.disabled = true;
      try {
        const { drift } = await store.recordSplit({ num, den, date: dateInput.value || today });
        store.logActivity(`${num}-for-${den} stock split recorded, effective ${dateInput.value || today}`, 'layers');
        // The same singular the preview line above gives a one-share drift.
        const moved = Math.round(Math.abs(drift));
        toast(moved >= 1
          ? `Split recorded · rounding ${drift > 0 ? 'removed' : 'added'} ${fmtShares(moved)} share${moved === 1 ? '' : 's'}`
          : 'Split recorded');
        modal.close();
        onDone?.();
      } catch (err) {
        console.error(err);
        toast(isRefusal(err) ? err.message : 'Couldn’t save. Check your connection',
          { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
        saveBtn.disabled = store.company.splits.length >= MAX_STOCK_SPLITS;
      }
    },
  },
    el('p.confirm-message', {},
      'Every per-share number moves together: quantities, strikes, prices, class terms, every plan’s reserve, and recorded 409As. Dates before the split keep reading in pre-split units. A restore point is taken first, so a split can be rolled back from Settings.'),
    el('div.form-grid', {},
      field('New shares', numInputEl, 'Each old share becomes this many'),
      field('For every', denInputEl, '10-for-1 is a forward split; 1-for-10 reverse')),
    field('Effective date', dateInput,
      'Today or earlier. Every record is restated the moment the split is recorded, so it cannot take effect later.'),
    preview,
    el('div', { style: { height: '10px' } }),
    saveBtn);

  const modal = openModal({
    title: 'Record stock split', content: form,
    onClose: () => store.removeEventListener('change', syncPreview),
  });
}

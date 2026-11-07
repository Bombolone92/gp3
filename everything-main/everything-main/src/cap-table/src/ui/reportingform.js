/**
 * The assumptions the Reports view runs on: what an option is valued with
 * (volatility, risk-free rate, expected term), how its cost is attributed,
 * when the fiscal year ends, and the total assets Rule 701 measures against.
 *
 * Its own module because two tabs ask for it - the expense report needs the
 * valuation inputs, the Rule 701 report needs the balance sheet figure - and
 * one sheet holding all of them means one place they can disagree with
 * nothing. CapTable records these numbers; your auditor or 409A provider
 * chooses them.
 */

import { el } from './dom.js';
import { field, segmented, flagInvalid } from './bits.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { ATTRIBUTION_METHODS, reportingOf } from '../lib/reports.js';
import { currencySymbol, amountValue } from '../lib/format.js';
import { parseNum } from '../lib/util.js';

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function openReportingForm({ onSaved = null } = {}) {
  const r = reportingOf(store.company);

  const volInput = el('input.input', {
    type: 'text', inputmode: 'decimal', placeholder: '60',
    value: r.volatility > 0 ? String(r.volatility) : '',
    'aria-label': 'Expected volatility, percent per year',
  });
  const rateInput = el('input.input', {
    type: 'text', inputmode: 'decimal', placeholder: '4.2',
    value: r.riskFreeRate ? String(r.riskFreeRate) : '',
    'aria-label': 'Risk-free rate, percent per year',
  });

  /* The expected term is either derived per grant (the simplified method)
     or one number for every grant. The years field only shows for the
     latter, so the sheet never asks for a figure it would then ignore. */
  let termMode = r.expectedTermYears > 0 ? 'fixed' : 'simplified';
  const termInput = el('input.input', {
    type: 'text', inputmode: 'decimal', placeholder: '6.25',
    value: r.expectedTermYears > 0 ? String(r.expectedTermYears) : '',
    'aria-label': 'Expected term in years',
  });
  const termField = field('Expected term (years)', termInput, 'Applied to every option grant');
  const termSeg = segmented([
    { value: 'simplified', label: 'Simplified method' },
    { value: 'fixed', label: 'Set a term' },
  ], {
    label: 'Expected term', value: termMode, wide: true,
    onSelect: (value) => { termMode = value; syncTerm(); },
  });
  function syncTerm() {
    termField.hidden = termMode !== 'fixed';
  }
  syncTerm();

  let attribution = r.attribution;
  const attrSeg = segmented(ATTRIBUTION_METHODS, {
    label: 'Attribution', value: attribution, wide: true,
    onSelect: (value) => { attribution = value; },
  });

  const fyeSelect = el('select.select', { 'aria-label': 'Fiscal year ends in' },
    MONTH_NAMES.map((name, i) => el('option', {
      value: String(i + 1), selected: i + 1 === r.fiscalYearEnd,
    }, name)));

  const assetsInput = el('input.input', {
    type: 'text', inputmode: 'decimal', placeholder: '2,000,000',
    value: r.totalAssets > 0 ? amountValue(r.totalAssets) : '',
    'aria-label': 'Total assets at the last fiscal year end',
  });

  const saveBtn = el('button.btn.btn-primary.btn-block', { type: 'submit', style: { padding: '12px' } },
    'Save assumptions');

  /* An emptied field means "not set" and reads back as zero; anything typed
     has to read as a number in range, or the sheet points at it. */
  const readPercent = (input, { min = 0, max = 500, allowZero = false } = {}) => {
    const raw = input.value.trim();
    if (!raw) return 0;
    const v = parseNum(raw);
    if (!Number.isFinite(v) || v < min || v > max || (!allowZero && v === 0)) return null;
    return v;
  };

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const volatility = readPercent(volInput);
      if (volatility === null) {
        flagInvalid(volInput);
        volInput.focus();
        toast('Volatility is a percentage above zero, like 60', { icon: 'alert' });
        return;
      }
      const riskFreeRate = readPercent(rateInput, { min: -10, max: 100, allowZero: true });
      if (riskFreeRate === null) {
        flagInvalid(rateInput);
        rateInput.focus();
        toast('Enter the risk-free rate as a percentage, like 4.2', { icon: 'alert' });
        return;
      }
      let expectedTermYears = 0;
      if (termMode === 'fixed') {
        /* Blank reads as "not set" everywhere else on this sheet; here it
           would quietly save as the simplified method the user just switched
           away from, so a term has to be typed. */
        expectedTermYears = termInput.value.trim() ? readPercent(termInput, { min: 0, max: 50 }) : null;
        if (expectedTermYears === null) {
          flagInvalid(termInput);
          termInput.focus();
          toast('Enter the expected term in years, like 6.25', { icon: 'alert' });
          return;
        }
      }
      let totalAssets = 0;
      if (assetsInput.value.trim()) {
        totalAssets = parseNum(assetsInput.value);
        if (!Number.isFinite(totalAssets) || totalAssets < 0) {
          flagInvalid(assetsInput);
          assetsInput.focus();
          toast('Total assets is an amount, like 2,000,000', { icon: 'alert' });
          return;
        }
      }
      saveBtn.disabled = true;
      try {
        await store.updateCompany({
          reporting: {
            volatility, riskFreeRate, expectedTermYears, attribution,
            fiscalYearEnd: Number(fyeSelect.value), totalAssets,
          },
        });
        store.logActivity('Reporting assumptions updated', 'landmark');
        toast('Assumptions saved');
        modal.close();
        onSaved?.();
      } catch (err) {
        console.error(err);
        toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
        saveBtn.disabled = false;
      }
    },
  },
    el('p.confirm-message', {},
      'Cap Table values awards with the inputs you record here. It does not choose them: '
      + 'your auditor or 409A provider will.'),
    el('h3.card-title', { style: { margin: '4px 0 8px' } }, 'Option valuation'),
    el('div.form-grid', {},
      field('Expected volatility (%)', volInput, 'Per year, from comparable public companies'),
      field('Risk-free rate (%)', rateInput, 'A Treasury yield matching the expected term')),
    field('Expected term', termSeg,
      'The simplified method takes the midpoint of each vesting date and the end of the option’s term'),
    termField,
    el('h3.card-title', { style: { margin: '10px 0 8px' } }, 'Expense attribution'),
    field('Attribution', attrSeg,
      'Straight-line spreads the whole award evenly to its last vesting date; graded expenses each tranche over its own period'),
    field('Fiscal year ends in', el('div.select-wrap', {}, fyeSelect)),
    el('h3.card-title', { style: { margin: '10px 0 8px' } }, 'Rule 701'),
    field(`Total assets (${currencySymbol()})`, assetsInput,
      'At your last fiscal year end. Optional: without it the 15%-of-assets ceiling is skipped'),
    saveBtn);

  const modal = openModal({ title: 'Reporting assumptions', content: form });
  return modal;
}

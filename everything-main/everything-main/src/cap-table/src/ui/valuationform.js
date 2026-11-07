/**
 * Recording a 409A: the number a valuation provider handed you, so option
 * strikes have something to be checked against.
 *
 * Its own module because two places ask for it - the 409A card in Settings,
 * and the needs-attention row that says the one on file has gone stale.
 * CapTable records a valuation; it never computes one.
 */

import { el } from './dom.js';
import { field, flagInvalid } from './bits.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { splitsSincePhrase } from './split.js';
import { store, isRefusal, VALUATIONS_MAX } from '../lib/store.js';
import { unsplitFactor } from '../lib/captable.js';
import { sharePrice, currencySymbol, dateLong } from '../lib/format.js';
import { parseNum, todayISO } from '../lib/util.js';

export function openValuationForm({ onSaved = null } = {}) {
  const dateInput = el('input.input', { type: 'date', value: todayISO(), 'aria-label': 'Valuation date' });
  const priceInput = el('input.input', {
    type: 'text', inputmode: 'decimal', placeholder: '0.09', 'aria-label': 'Fair market value per share',
  });
  const noteInput = el('input.input', {
    type: 'text', maxlength: 120, placeholder: 'e.g. Carta 409A, post-Seed', 'aria-label': 'Note',
  });
  /* Every price is stored in today's units: a split restates the whole 409A
     history, whatever each valuation's date, and the as-of view reads earlier
     dates back through it (see recordSplit) - so a valuation backfilled
     behind a split is typed as it reads today, not as the provider's report
     of that day put it. Nothing said so, and a $10 409A from before a 2-for-1
     split, typed as $10, read $20 on its own date - with the RSUs granted
     against it expensed at twice their cost. Said once the date falls before
     a split, naming it, with the typed price read back in the units of the
     day so the figure on the report can be checked against it. A status
     region, as the strike warning is: it changes under a field that keeps
     focus. */
  const unitsHint = el('p.field-hint.warn', { role: 'status', style: { display: 'none', marginTop: '-4px' } });
  const syncUnits = () => {
    const date = dateInput.value || todayISO();
    const since = splitsSincePhrase(store.company, date);
    const price = parseNum(priceInput.value);
    let next = '';
    if (since) {
      next = `Dated before ${since}: enter the price in today's post-split units.`;
      if (price > 0) {
        next += ` ${sharePrice(price)} today reads as ${sharePrice(price / unsplitFactor(store.company, date))} per share on ${dateLong(date)}.`;
      }
    }
    if (unitsHint.textContent !== next) unitsHint.textContent = next;
    unitsHint.style.display = next ? '' : 'none';
  };
  for (const evt of ['change', 'input']) dateInput.addEventListener(evt, syncUnits);
  priceInput.addEventListener('input', syncUnits);
  syncUnits();
  /* A full history is said before the form is filled in, the way the split
     sheet says so about its own limit: the store refuses a 41st valuation,
     and the refusal used to arrive after the price, date and note were typed. */
  const full = store.company.valuations.length >= VALUATIONS_MAX;
  const saveBtn = el('button.btn.btn-primary.btn-block', {
    type: 'submit', disabled: full, style: { padding: '12px' },
    title: full ? `This company already holds ${VALUATIONS_MAX} valuations` : null,
  }, 'Save valuation');
  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const price = parseNum(priceInput.value);
      if (!price || price <= 0) {
        flagInvalid(priceInput);
        priceInput.focus();
        toast('Enter the fair market value per share', { icon: 'alert' });
        return;
      }
      saveBtn.disabled = true;
      try {
        await store.addValuation({
          date: dateInput.value || todayISO(), fmvPerShare: price, note: noteInput.value,
        });
        store.logActivity(`409A recorded at ${sharePrice(price)} per share`, 'scale');
        toast('Valuation recorded');
        modal.close();
        onSaved?.();
      } catch (err) {
        console.error(err);
        // A full history is a refusal with something to do about it, not a
        // connection problem, so it is reported in its own words.
        toast(isRefusal(err) ? err.message : 'Couldn’t save. Check your connection',
          { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
        saveBtn.disabled = false;
      }
    },
  },
    el('p.confirm-message', {},
      'Cap Table records the 409A your valuation provider gave you. It does not compute one.'),
    full ? el('p.small.warn', { style: { marginBottom: '10px' } },
      `This company already holds ${VALUATIONS_MAX} valuations, the most it can keep. `
      + 'Delete one from the 409A history before recording another.') : null,
    el('div.form-grid', {},
      field(`Fair market value (${currencySymbol()} per share)`, priceInput),
      field('Effective date', dateInput)),
    unitsHint,
    field('Note', noteInput, 'Optional - the provider, or what triggered it'),
    saveBtn);
  const modal = openModal({ title: 'Record a 409A valuation', content: form });
  return modal;
}

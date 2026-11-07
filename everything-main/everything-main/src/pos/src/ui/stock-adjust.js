/**
 * The "Adjust stock" sheet: a delivery arrived, a recount found fewer, the
 * milk went off. One signed movement with a reason, recorded in the ledger -
 * the honest alternative to silently overwriting the count.
 */

import { el, clear, keepFocus } from './dom.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store, ADJUST_REASONS } from '../lib/store.js';

/** Signed for 'other', magnitude elsewhere; 3 decimals only by measure. */
function parseDelta(text, { signed = false, measured = false } = {}) {
  const s = String(text ?? '').trim().replace(/,/g, '.');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (!signed && n < 0) return null;
  if (Math.abs(n) > 9_999_999) return null;
  return measured ? Math.round(n * 1000) / 1000 : Math.round(n);
}

/**
 * openStockAdjust(product, { onDone }) - `onDone(entry)` fires after the
 * movement is recorded, so the opener can refresh what it shows.
 */
export function openStockAdjust(product, { onDone = null } = {}) {
  const measured = product.soldBy === 'measure';
  const unit = measured ? product.unit : null;
  const amountLabel = (base) => (unit ? `${base} (${unit})` : base);
  let reason = 'received';
  let saving = false;

  const chips = el('div.chip-row', { role: 'radiogroup', 'aria-label': 'Reason' });
  const amountField = el('div.field');
  const preview = el('div.pay-change', { 'aria-live': 'polite' });
  const noteInput = el('input.input', {
    type: 'text', maxLength: 80, placeholder: 'Optional note',
    'aria-label': 'Note',
  });

  const amountInput = el('input.input.pay-tender', {
    type: 'text', inputmode: 'decimal', placeholder: measured ? '0.000' : '0',
    'aria-label': 'Amount',
  });
  amountInput.addEventListener('input', renderPreview);

  /** The signed movement the current inputs describe, or null. */
  function pendingDelta() {
    const current = Number(product.stock) || 0;
    if (reason === 'received') {
      const n = parseDelta(amountInput.value, { measured });
      return n ? n : null;
    }
    if (reason === 'damage') {
      const n = parseDelta(amountInput.value, { measured });
      return n ? -n : null;
    }
    if (reason === 'recount') {
      const counted = parseDelta(amountInput.value, { measured });
      if (counted === null) return null;
      const delta = Math.round((counted - current) * 1000) / 1000;
      return delta || null;
    }
    return parseDelta(amountInput.value, { signed: true, measured }) || null;
  }

  /**
   * What each reason wants typed, said back when what's there isn't it.
   *
   * Only "Other" takes a sign; the rest read as a magnitude and turn it the
   * right way themselves. A '-3' under "Received delivery" - the obvious
   * thing to type if you think of the field as a delta - therefore parses to
   * nothing, and used to leave a blank preview under a Record movement
   * button that simply didn't respond.
   */
  const ASK = {
    received: 'Enter how many arrived, as a plain number',
    recount: 'Enter the counted amount as a plain number',
    damage: 'Enter how many were lost, as a plain number',
    other: 'Enter the change as a plain number, with − to remove',
  };

  function renderPreview() {
    const current = Number(product.stock) || 0;
    const delta = pendingDelta();
    clear(preview);
    if (delta === null) {
      // Nothing typed yet is not a mistake - the sheet opens that way.
      if (!String(amountInput.value).trim()) return;
      const parsed = parseDelta(amountInput.value, { signed: reason === 'other', measured });
      if (parsed === null) {
        preview.append(el('span.pay-short', {}, ASK[reason] || ASK.other));
      } else if (reason === 'recount') {
        preview.append(el('span', {}, 'Counted matches the current level, so there is nothing to record.'));
      } else {
        preview.append(el('span', {}, 'Nothing to record.'));
      }
      return;
    }
    const level = Math.round((current + delta) * 1000) / 1000;
    preview.append(
      el('span', {}, `${delta > 0 ? '+' : ''}${delta}${unit ? ` ${unit}` : ''} → `),
      el('strong', {}, `${level}${unit ? ` ${unit}` : ''} on hand`)
    );
  }

  // Picking a reason rebuilds the chip row it was pressed in, and relabels
  // the amount field by re-appending the very input that may hold focus.
  // Both hand focus back rather than dropping it to <body>.
  function renderChips() {
    keepFocus(chips, paintChips);
  }

  function paintChips() {
    clear(chips);
    for (const r of ADJUST_REASONS) {
      chips.append(el('button.chip', {
        type: 'button',
        className: `chip${reason === r.value ? ' active' : ''}`,
        role: 'radio', 'aria-checked': reason === r.value ? 'true' : 'false',
        onclick: () => {
          reason = r.value;
          renderChips();
          renderAmount();
          renderPreview();
        },
      }, r.label));
    }
  }

  function renderAmount() {
    keepFocus(amountField, paintAmount);
  }

  function paintAmount() {
    clear(amountField);
    const labels = {
      received: amountLabel('Amount received'),
      recount: amountLabel('Counted on the shelf'),
      damage: amountLabel('Amount lost'),
      other: amountLabel('Change (use − to remove)'),
    };
    amountField.append(el('label.label', {}, labels[reason]), amountInput);
    noteInput.placeholder = reason === 'other' ? 'What happened?' : 'Optional note';
  }

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const delta = pendingDelta();
      if (delta === null) {
        // The preview already names the problem for anything typed; an
        // untouched field has nothing to name, so say what's missing.
        if (!String(amountInput.value).trim()) toast('Enter an amount', { icon: 'alert' });
        renderPreview();
        amountInput.focus();
        return;
      }
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      saving = true;
      let entry;
      try {
        entry = await store.adjustStock({ productId: product.id, delta, reason, note: noteInput.value });
      } catch (err) {
        console.error(err);
        saving = false;
        btn.disabled = false;
        toast(/amount|track|no longer/.test(err.message || '')
          ? err.message
          : 'Couldn’t record it. Check your connection', { icon: 'wifiOff' });
        return;
      }
      saving = false;
      modal.close();
      toast(`Stock adjusted · ${entry.delta > 0 ? '+' : ''}${entry.delta}${unit ? ` ${unit}` : ''}`, { icon: 'package' });
      onDone?.(entry);
    },
  },
    el('p.small.muted', { style: { marginBottom: '14px' } },
      `${product.name} · ${product.stock}${unit ? ` ${unit}` : ''} on hand. `
      + 'The change and its reason go in the movement ledger.'),
    chips,
    amountField,
    preview,
    el('div.field', {}, el('label.label', {}, 'Note'), noteInput),
    el('button.btn.btn-primary.btn-block', { type: 'submit' }, 'Record movement')
  );

  renderChips();
  renderAmount();
  const modal = openModal({ title: 'Adjust stock', content: form, canClose: () => !saving });
  amountInput.focus();
  return modal;
}

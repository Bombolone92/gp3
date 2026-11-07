/**
 * Transferring a share certificate: a secondary sale to another holder, a
 * move into a trust or estate, or a company repurchase that retires the
 * shares. The original certificate closes as of the date and successor
 * certificates are issued in one commit - faking any of this by deleting and
 * re-adding certificates would destroy the label chain, the cost basis, and
 * the point-in-time history.
 */

import { el } from './dom.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { field, flagInvalid, holderOptionLabel, holderNamed } from './bits.js';
import { store, Store, isRefusal } from '../lib/store.js';
import { STAKEHOLDER_KINDS, hasVesting, vestedQuantity } from '../lib/captable.js';
import { shares as fmtShares, money, currencySymbol, amountValue, countLabel } from '../lib/format.js';
import { parseNum, todayISO } from '../lib/util.js';

const NEW_HOLDER = '__new__';
const COMPANY = '__company__';

export function openTransferForm(cert, { onDone = null } = {}) {
  /* Today, or the certificate's own date when that is still ahead: nothing
     moves shares before they exist, and a sheet opened on a day the store
     refuses - and the date field's `min` blocked before the app could say
     why - proposed a date it could not submit. */
  const today = cert.date > todayISO() ? cert.date : todayISO();
  const seller = store.stakeholder(cert.stakeholderId);

  // Floored at the certificate's own date, as the lifecycle pickers are at
  // their award's: the submit refuses an earlier day either way, but the
  // picker should not offer one.
  const dateInput = el('input.input', {
    type: 'date', value: today, 'aria-label': 'Transfer date',
    ...(cert.date ? { min: cert.date } : {}),
  });
  const qtyInput = el('input.input', {
    type: 'text', inputmode: 'numeric', autocomplete: 'off',
    value: amountValue(cert.quantity), 'aria-label': 'Shares transferred',
  });
  const priceInput = el('input.input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off',
    placeholder: '1.25', 'aria-label': 'Price per share',
  });

  /* Receiving party: another holder, someone new, or the company.

     Nobody is chosen until someone is. The picker used to open on whichever
     other holder happened to be first, so a sheet opened and confirmed without
     touching it moved the whole certificate to that person - the same default
     the round close refuses to make for its lead investor. */
  const toSelect = el('select.select', { 'aria-label': 'Receiving party' },
    el('option', { value: '', disabled: true, selected: true }, 'Choose who receives the shares…'),
    store.stakeholders
      .filter((h) => h.id !== cert.stakeholderId)
      .map((h) => el('option', { value: h.id }, holderOptionLabel(h))),
    el('option', { value: NEW_HOLDER }, '+ New stakeholder…'),
    el('option', { value: COMPANY }, 'The company (repurchase)'));
  const newName = el('input.input', {
    type: 'text', placeholder: 'Full name', maxlength: 120, 'aria-label': 'New stakeholder name',
  });
  const newKind = el('select.select', { 'aria-label': 'New stakeholder type' },
    STAKEHOLDER_KINDS.map((k) => el('option', { value: k.value, selected: k.value === 'entity' }, k.label)));
  const newRow = el('div.form-grid', { style: { display: 'none' } },
    field('Name', newName),
    field('Type', el('div.select-wrap', {}, newKind)));

  const summary = el('p.field-hint', {});
  /* Whose money the price is, said for the recipient chosen. One hint
     served both: "what the buyer pays, recorded on the new certificate" sat
     under the field with the company chosen as the recipient - a repurchase
     has no buyer, and issues no certificate for the shares it retires; the
     terms are recorded against the certificate it closes. */
  const priceHint = el('p.field-hint', {});
  const syncPriceHint = () => {
    priceHint.textContent = toSelect.value === COMPANY
      ? 'What the company pays per share. Recorded on the certificate it closes; the shares are retired.'
      : 'What the buyer pays per share. Recorded on the new certificate; preferences keep following the original issue price.';
  };
  /* A sale hands the buyer a certificate with no schedule on it and leaves the
     seller a pro-rata slice of the balance, so part of what was unvested stops
     being reported as unvested - the dashboard's figure drops, and nothing
     said why. It is a real consequence of recording the sale, not an error, so
     it is stated here rather than blocked. */
  // A status region: it appears as the user types under a field that keeps focus.
  const releaseLine = el('p.field-hint.warn', { role: 'status', style: { display: 'none' } });
  let qtyEdited = false;

  const unvestedOn = (when) => Math.max(0, cert.quantity - vestedQuantity(cert, when));

  /* The remainder exactly as transferShares will write it, so the figure
     below is the one the cap table ends up with. */
  const remainderOf = (kept) => {
    const next = { ...cert, quantity: kept };
    if (cert.vestingTranches) {
      next.vestingTranches = Store.scaleTranches(cert.vestingTranches, kept, cert.quantity);
    } else if (cert.vestingBase > 0) {
      next.vestingBase = Math.round((cert.vestingBase * kept) / cert.quantity);
      // The installments earlier certificates own scale with the base they are taken off.
      if (cert.vestingOffset > 0) next.vestingOffset = Math.round((cert.vestingOffset * kept) / cert.quantity);
    }
    return next;
  };

  /** Unvested shares a sale of `n` on `when` stops counting as unvested. */
  const releasedBy = (n, when) => {
    if (!hasVesting(cert) || !(n > 0) || n > cert.quantity) return 0;
    const kept = cert.quantity - n;
    const after = kept > 0
      ? Math.max(0, kept - vestedQuantity(remainderOf(kept), when))
      : 0;
    return Math.max(0, unvestedOn(when) - after);
  };

  const sync = () => {
    const isRepurchase = toSelect.value === COMPANY;
    newRow.style.display = toSelect.value === NEW_HOLDER ? '' : 'none';
    // Choosing someone new is the start of typing their name, as the issue
    // sheet and the close-round rows already treat it.
    if (toSelect.value === NEW_HOLDER && document.activeElement === toSelect) newName.focus();
    syncPriceHint();
    /* A repurchase is usually the company buying back what a departed
       founder never earned, so it pre-fills with the unvested balance. */
    if (!qtyEdited) {
      qtyInput.value = amountValue(isRepurchase && hasVesting(cert)
        ? unvestedOn(dateInput.value || today) || cert.quantity
        : cert.quantity);
    }
    const n = Math.max(0, parseNum(qtyInput.value) ?? 0);
    const kept = Math.max(0, cert.quantity - n);
    const price = Math.max(0, parseNum(priceInput.value) ?? 0);
    const consideration = price > 0 && n > 0 ? ` for ${money(n * price)}` : '';
    if (!(n > 0) || n > cert.quantity) {
      summary.textContent = `${cert.label} holds ${countLabel(cert.quantity, 'share')}.`;
    } else if (!toSelect.value) {
      summary.textContent = `${cert.label} holds ${countLabel(cert.quantity, 'share')}. Pick who receives ${cert.quantity === 1 ? 'it' : 'them'}.`;
    } else if (isRepurchase) {
      summary.textContent = `${countLabel(n, 'share')} ${n === 1 ? 'is' : 'are'} repurchased${consideration} and retired; outstanding drops accordingly.`
        + (kept > 0 ? ` ${seller?.name || 'The holder'} keeps ${fmtShares(kept)} on a new certificate.` : '');
    } else {
      const buyer = toSelect.value === NEW_HOLDER
        ? (newName.value.trim() || 'the new holder')
        : (store.stakeholder(toSelect.value)?.name || 'the recipient');
      summary.textContent = `${countLabel(n, 'share')} ${n === 1 ? 'moves' : 'move'} to ${buyer}${consideration} on a new certificate`
        + (kept > 0 ? `; ${seller?.name || 'the holder'} keeps ${fmtShares(kept)}.` : '.');
    }
    const released = isRepurchase ? 0 : releasedBy(n, dateInput.value || today);
    releaseLine.style.display = released > 0 ? '' : 'none';
    if (released > 0) {
      releaseLine.textContent = `${fmtShares(unvestedOn(dateInput.value || today))} of these shares are `
        + `unvested on this date. The buyer’s certificate carries no schedule, so `
        + `${fmtShares(released)} stop being reported as unvested.`;
    }
  };
  qtyInput.addEventListener('input', () => { qtyEdited = true; sync(); });
  for (const c of [toSelect, dateInput, priceInput]) c.addEventListener('change', sync);
  priceInput.addEventListener('input', sync);
  newName.addEventListener('input', sync);
  sync();

  const saveBtn = el('button.btn.btn-primary.btn-block', { type: 'submit', style: { padding: '12px' } },
    'Record transfer');

  const invalid = (input, message) => {
    flagInvalid(input, message);
    input?.focus();
    toast(message, { icon: 'alert' });
  };

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const n = parseNum(qtyInput.value) ?? 0;
      // Something typed that does not read is a typo, not a blank - see the issue sheet.
      if (parseNum(qtyInput.value) === null && qtyInput.value.trim()) return invalid(qtyInput, 'The share count must be a number, like 1,000');
      if (!(n > 0)) return invalid(qtyInput, 'Enter how many shares transfer');
      /* The store rounds a fraction on the way in, so "10.5" closed the
         certificate against 11 shares and issued the remainder for 989 -
         two records neither of which said what was typed. */
      if (!Number.isInteger(n)) return invalid(qtyInput, 'Shares transfer in whole numbers');
      if (n > cert.quantity) {
        return invalid(qtyInput, `${cert.label} only holds ${countLabel(cert.quantity, 'share')}`);
      }
      const when = dateInput.value || today;
      if (cert.date && when < cert.date) {
        return invalid(dateInput, 'The transfer can’t precede the certificate it moves');
      }
      /* Blank is a gift or a repurchase for nothing; a price that is typed
         and does not read is a typo, and was being stored as nothing paid -
         the buyer's certificate then showed no consideration at all, with
         nothing on screen to say the number had been dropped. Same rule as
         every other money field in the app. */
      const priceRaw = priceInput.value.trim();
      const price = priceRaw ? parseNum(priceRaw) : 0;
      if (price === null) return invalid(priceInput, 'The price must be a number, like 1.25');
      if (price < 0) return invalid(priceInput, 'The price can’t be negative');
      // The store refuses this too; said here, it points at the picker.
      if (!toSelect.value) return invalid(toSelect, 'Pick who receives the shares');
      let to;
      if (toSelect.value === COMPANY) to = 'company';
      else if (toSelect.value === NEW_HOLDER) {
        if (!newName.value.trim()) return invalid(newName, 'Give the receiving party a name');
        /* Someone already in the picker, typed in as new - see holderNamed.
           The seller is the one name the picker leaves out, and the shares
           are theirs already. */
        const twin = holderNamed(newName.value, store.stakeholders);
        if (twin) {
          return invalid(newName, twin.id === cert.stakeholderId
            ? `${twin.name} already holds these shares`
            : `${twin.name} is already on the cap table. Pick them from the list above`);
        }
        to = { newHolder: { name: newName.value, kind: newKind.value } };
      } else {
        to = { stakeholderId: toSelect.value };
      }

      saveBtn.disabled = true;
      try {
        const result = await store.transferShares(cert.id, {
          date: when, quantity: n, pricePerShare: price, to,
        });
        const sellerName = seller?.name || 'holder';
        if (result.repurchase) {
          store.logActivity(
            `${cert.label}: ${countLabel(n, 'share')} repurchased from ${sellerName}`
            + `${price > 0 ? ` for ${money(n * price)}` : ''} and retired`, 'refresh');
          toast('Repurchase recorded');
        } else {
          const buyerName = store.stakeholder(result.buyerId)?.name || 'new holder';
          store.logActivity(
            `${cert.label}: ${countLabel(n, 'share')} transferred from ${sellerName} to ${buyerName} (${result.buyerCert.label})`, 'refresh');
          toast(`Transfer recorded · ${result.buyerCert.label} issued`);
        }
        modal.close();
        onDone?.();
      } catch (err) {
        console.error(err);
        toast(isRefusal(err) ? err.message : 'Couldn’t save. Check your connection',
          { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
        saveBtn.disabled = false;
      }
    },
  },
    el('p.confirm-message', {},
      `${cert.label} · ${countLabel(cert.quantity, 'share')} held by ${seller?.name || 'unknown holder'}. The certificate closes on the transfer date and successors are issued in its place.`),
    field('Receiving party', el('div.select-wrap', {}, toSelect)),
    newRow,
    el('div.form-grid', {},
      field('Shares transferred', qtyInput),
      field('Transfer date', dateInput)),
    field(`Price per share (${currencySymbol()})`, priceInput, priceHint),
    summary,
    releaseLine,
    el('div', { style: { height: '12px' } }),
    saveBtn);
  /* Linked by hand, as the strike hint is: field() only wires a plain
     string, and this hint is a node whose text follows the recipient, so
     "what the company pays per share" sat under the box unannounced. */
  priceHint.id = `${priceInput.id}-hint`;
  priceInput.setAttribute('aria-describedby', priceHint.id);

  const modal = openModal({ title: `Transfer ${cert.label}`, content: form });
}

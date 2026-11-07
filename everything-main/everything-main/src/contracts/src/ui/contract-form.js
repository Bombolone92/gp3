import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { store, CONTRACT_TYPES, CONTRACT_STATUSES, BILLING_PERIODS } from '../lib/store.js';
import { renewalInfo, formatDate, isTermEnd } from '../lib/dates.js';
import { COMMON_CURRENCIES, normalizeCurrency } from '../lib/money.js';
import { field, textInput, select, switchControl, formSnapshot } from './bits.js';
import { openContactForm } from './contact-form.js';

/**
 * Create/edit a contract in a sheet.
 * openContractForm({ contract?, contactId?, onSaved? })
 */
export function openContractForm({ contract = null, contactId = null, onSaved = null } = {}) {
  const isEdit = !!contract;
  let autoRenew = contract ? !!contract.autoRenew : true;

  const title = textInput({
    value: contract?.title || '', required: true, maxLength: 120,
    placeholder: 'e.g. Cloud hosting subscription',
  });
  const type = select(CONTRACT_TYPES, contract?.type || 'service');
  const status = select(CONTRACT_STATUSES, contract?.status || 'active');

  /* Counterparty select rebuilds after inline contact creation. */
  const contactSel = el('select.select');
  function fillContacts(selectedId) {
    clear(contactSel);
    contactSel.append(el('option', { value: '' }, 'No contact'));
    for (const c of store.contacts) {
      contactSel.append(el('option', {
        value: c.id, selected: c.id === selectedId,
      }, c.company ? `${c.name} (${c.company})` : c.name));
    }
    // The linked contact may be in the trash. Keep the option so saving the
    // contract doesn't quietly drop a link that a restore would bring back.
    if (selectedId && !store.contactById(selectedId)) {
      contactSel.append(el('option', { value: selectedId, selected: true }, 'Contact in the trash'));
    }
  }
  fillContacts(contract?.contactId || contactId || '');
  const newContactBtn = el('button.btn.btn-ghost.btn-compact', {
    type: 'button', html: icon('plus', 14, 2.2),
    onclick: () => openContactForm({ onSaved: (c) => fillContacts(c.id) }),
  }, ' New');

  const value = textInput({
    value: contract?.value ?? '', type: 'number', min: '0', step: '0.01',
    inputmode: 'decimal', placeholder: '0', id: 'cf-value',
  });
  /* Currency travels with the amount, so a EUR lease is never typed under a
     USD label. Free text (with suggestions) rather than a select: three-letter
     codes are universal and the list of them is not. */
  const currency = textInput({
    value: normalizeCurrency(contract?.currency || store.settings.currency),
    maxLength: 3, pattern: '[A-Za-z]{3}', required: true,
    list: 'cf-currency-codes', autocomplete: 'off', spellcheck: false,
    className: 'input currency-input', 'aria-label': 'Currency code',
    title: 'Three-letter currency code, e.g. USD',
  });
  currency.addEventListener('blur', () => {
    currency.value = currency.value.trim().toUpperCase();
  });
  const currencyList = el('datalist', { id: 'cf-currency-codes' },
    COMMON_CURRENCIES.map((c) => el('option', { value: c })));
  const billing = select(BILLING_PERIODS, contract?.billing || 'monthly');
  const startDate = textInput({ value: contract?.startDate || '', type: 'date' });
  const endDate = textInput({ value: contract?.endDate || '', type: 'date' });
  /* On a contract that has already rolled over, this field holds the first
     term's end — the anchor, not today's deadline. Saying so stops it looking
     like a stale date somebody forgot to update. */
  const rolledTo = contract ? renewalInfo(contract).date : null;
  const endHint = rolledTo && rolledTo !== contract.endDate
    ? `The current term ends ${formatDate(rolledTo)}. This is where the first term ended, which every renewal since is counted from.`
    : null;
  // An "end before start" error makes native validation block the submit
  // event from ever firing again, so it must clear when either date changes
  // — clearing it inside onsubmit would never run.
  const clearDateOrderError = () => endDate.setCustomValidity('');
  startDate.addEventListener('input', clearDateOrderError);
  endDate.addEventListener('input', clearDateOrderError);
  const termMonths = textInput({
    value: contract?.termMonths || 12, type: 'number', min: '1', max: '120', inputmode: 'numeric',
  });
  const noticeDays = textInput({
    value: contract?.noticeDays ?? store.settings.noticeDefault ?? 30,
    type: 'number', min: '0', max: '365', inputmode: 'numeric',
  });
  const tags = textInput({
    value: (contract?.tags || []).join(', '), placeholder: 'legal, critical',
    autocomplete: 'off',
  });
  const notes = el('textarea.input', { rows: 4, maxLength: 20000 }, contract?.notes || '');

  const renewRow = el('div.field-row');
  function renderRenewRow() {
    clear(renewRow);
    if (autoRenew) renewRow.append(field('Renewal term (months)', termMonths, { grow: true }));
    renewRow.append(field('Notice period (days)', noticeDays, {
      grow: true,
      hint: autoRenew
        ? 'Days before renewal you can still cancel or renegotiate.'
        : 'Days of heads-up you want before the end date.',
    }));
  }
  renderRenewRow();

  const save = el('button.btn.btn-primary.btn-block', { type: 'submit' },
    isEdit ? 'Save changes' : 'Add contract');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      if (startDate.value && endDate.value && endDate.value < startDate.value) {
        endDate.setCustomValidity('End date must be after the start date');
        form.reportValidity();
        return;
      }
      save.disabled = true;
      const data = {
        title: title.value,
        type: type.value,
        status: status.value,
        contactId: contactSel.value || null,
        value: value.value === '' ? null : Number(value.value),
        currency: normalizeCurrency(currency.value, contract?.currency || store.settings.currency),
        billing: billing.value,
        startDate: startDate.value || null,
        endDate: endDate.value || null,
        autoRenew,
        termMonths: Number(termMonths.value) || 12,
        noticeDays: Number(noticeDays.value) || 0,
        tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean),
        notes: notes.value,
      };
      // A recorded decision answers for one term end. If this edit moved the
      // schedule so that date is no longer a term end — a corrected end date,
      // a different renewal term, auto-renew switched — the decision would sit
      // on the record answering a question nobody is asking any more, and the
      // renewal would come back as undecided with nothing to say why. It is
      // cleared here, and the toast says so.
      const orphaned = !!contract?.decision?.forTermEnd
        && !isTermEnd({ ...contract, ...data }, contract.decision.forTermEnd);
      if (orphaned) data.decision = null;
      try {
        const saved = isEdit
          ? await store.updateContract(contract.id, data)
          : await store.addContract(data);
        modal.close();
        if (orphaned) {
          toast('Contract updated. Its renewal decision was about a term end that has moved, so it was cleared',
            { icon: 'info', duration: 6000 });
        } else {
          toast(isEdit ? 'Contract updated' : 'Contract added');
        }
        onSaved?.(saved);
      } catch (err) {
        console.error(err);
        save.disabled = false;
        toast('Could not save. Check your connection', { icon: 'wifiOff' });
      }
    },
  },
    field('Title', title),
    el('div.field-row', {},
      field('Type', type, { grow: true }),
      field('Status', status, { grow: true })
    ),
    el('div.field', {},
      el('label.field-label', { htmlFor: 'cf-contact' }, 'Counterparty'),
      el('div.row', {},
        el('div.select-wrap.grow', {}, Object.assign(contactSel, { id: 'cf-contact' })),
        newContactBtn
      )
    ),
    el('div.field-row', {},
      el('div.field.grow', {},
        el('label.field-label', { htmlFor: 'cf-value' }, 'Value'),
        el('div.money-input', {}, currency, value),
        currencyList
      ),
      field('Billing', billing, { grow: true })
    ),
    el('div.field-row', {},
      field('Start date', startDate, { grow: true }),
      field('End date', endDate, { grow: true, hint: endHint })
    ),
    el('div.field.switch-field', {},
      el('div', {},
        el('span.field-label', {}, 'Auto-renews'),
        el('p.field-hint', {}, 'Rolls forward by its term until cancelled.')
      ),
      switchControl(autoRenew, (v) => { autoRenew = v; renderRenewRow(); }, 'Auto-renews')
    ),
    renewRow,
    field('Tags', tags, { hint: 'Comma-separated, used in search.' }),
    field('Notes', notes),
    save
  );

  const initial = formSnapshot(form);
  const modal = openModal({
    title: isEdit ? 'Edit contract' : 'New contract',
    content: form,
    beforeClose: () => formSnapshot(form) === initial || confirmDialog({
      title: 'Discard changes?',
      message: isEdit
        ? 'Your unsaved edits to this contract will be lost.'
        : 'This contract has not been saved yet.',
      confirmLabel: 'Discard',
    }),
  });
  return modal;
}

/** Customer and vendor forms: a full drawer, and a quick-add dialog for pickers. */
import { el } from '../ui/dom.js';
import { openDialog } from '../ui/dialog.js';
import { field, textInput, textArea, selectInput, checkbox, segmented } from '../ui/fields.js';
import { combobox } from '../ui/combobox.js';
import { toast } from '../ui/toast.js';
import { store } from '../lib/store.js';
import { ACCOUNT_TYPES } from '../lib/accounts.js';

function addressFields(addr, label) {
  const a = addr || {};
  const f = (k, l, opts = {}) => {
    const i = textInput({ value: a[k] || '', autocomplete: opts.ac || 'off' });
    i.addEventListener('input', () => { a[k] = i.value; });
    return field(l, i, { className: opts.span ? 'span-2' : '' });
  };
  return {
    value: a,
    node: el('fieldset.fieldset', {}, el('legend', {}, label),
      el('div.form-grid', {}, f('line1', 'Street address', { span: true, ac: 'address-line1' }), f('line2', 'Address line 2', { span: true, ac: 'address-line2' }), f('city', 'City', { ac: 'address-level2' }), f('state', 'State or region', { ac: 'address-level1' }), f('zip', 'ZIP or postal code', { ac: 'postal-code' }), f('country', 'Country', { ac: 'country-name' }))),
  };
}

/**
 * Open the full customer or vendor drawer. Resolves to the saved contact, or
 * null if cancelled.
 */
export function openContactForm({ kind = 'customer', contact = null, name = '' } = {}) {
  return new Promise((resolve) => {
    const c = contact ? structuredClone(contact) : { kind, displayName: name, active: true, terms: store.settings.defaultTerms };
    let dirty = false;
    let saved = null;
    const touch = () => { dirty = true; };
    const bind = (key, opts = {}) => {
      const i = opts.area ? textArea({ value: c[key] || '', rows: 3 }) : textInput({ value: c[key] || '', type: opts.type || 'text', autocomplete: opts.ac || 'off', inputMode: opts.inputMode });
      i.addEventListener('input', () => { c[key] = i.value; touch(); if (opts.after) opts.after(); });
      return i;
    };
    const display = bind('displayName');
    const suggest = () => {
      if (c._displayEdited) return;
      const auto = c.company || [c.firstName, c.lastName].filter(Boolean).join(' ');
      if (auto) { c.displayName = auto; display.value = auto; }
    };
    display.addEventListener('input', () => { c._displayEdited = true; });
    if (contact) c._displayEdited = true;
    const bill = addressFields(c.billAddr || (c.billAddr = {}), 'Billing address');
    const ship = addressFields(c.shipAddr || (c.shipAddr = {}), 'Shipping address');
    const sameBox = checkbox({ checked: c.shipSame !== false, label: 'Same as billing address', onChange: (v) => { c.shipSame = v; ship.node.hidden = v; touch(); } });
    ship.node.hidden = c.shipSame !== false;

    const terms = selectInput({ options: [['', 'None'], ...(store.settings.terms || []).map((t) => [t.id, t.name])], value: c.terms || '', onChange: (v) => { c.terms = v || null; touch(); } });
    const kindToggle = segmented({ options: [['customer', 'Customer'], ['vendor', 'Vendor']], value: c.kind, ariaLabel: 'Type', onChange: (v) => { c.kind = v; touch(); renderKind(); } });
    const defaultAcct = combobox({
      value: c.defaultAccountId || null,
      placeholder: 'Choose a category',
      ariaLabel: 'Default expense category',
      labelOf: (id) => store.accountName(id),
      options: () => store.chart().map((r) => r.account).filter((a) => ['expense', 'cogs', 'otherExpense', 'fixedAsset', 'otherCurrentAsset'].includes(a.type)).map((a) => ({ id: a.id, label: store.accountName(a.id), group: ACCOUNT_TYPES[a.type].label })),
      onChange: (v) => { c.defaultAccountId = v; touch(); },
    });
    const taxable = checkbox({ checked: c.taxable !== false, label: 'This customer is taxable', onChange: (v) => { c.taxable = v; touch(); } });
    const kindExtras = el('div.form-grid');
    function renderKind() {
      kindExtras.replaceChildren();
      if (c.kind === 'vendor') {
        kindExtras.append(field('Default category', defaultAcct, { hint: 'New expenses and bills for this vendor start with it.' }), field('Business ID or tax ID', bind('taxId')), field('Account number', bind('accountNo'), { hint: 'Your account number with this vendor' }));
      } else {
        kindExtras.append(el('div.field.span-2', {}, taxable));
      }
    }
    renderKind();
    const active = checkbox({ checked: c.active !== false, label: 'Active', onChange: (v) => { c.active = v; touch(); } });

    const body = el('div.stack', {},
      contact ? null : field('Type', kindToggle),
      el('fieldset.fieldset', {}, el('legend', {}, 'Name and contact'),
        el('div.form-grid', {},
          field('First name', bind('firstName', { ac: 'given-name', after: suggest })),
          field('Last name', bind('lastName', { ac: 'family-name', after: suggest })),
          field('Company name', bind('company', { ac: 'organization', after: suggest }), { className: 'span-2' }),
          field('Display name', display, { required: true, className: 'span-2', hint: 'How the name appears on transactions and lists.' }),
          field('Email', bind('email', { type: 'email', ac: 'email' })),
          field('Phone', bind('phone', { type: 'tel', ac: 'tel' })),
          field('Mobile', bind('mobile', { type: 'tel' })),
          field('Website', bind('website', { type: 'url', ac: 'url' })))),
      bill.node,
      el('div', {}, sameBox),
      ship.node,
      el('fieldset.fieldset', {}, el('legend', {}, 'Payments'), el('div.form-grid', {}, field('Terms', terms)), kindExtras),
      el('fieldset.fieldset', {}, el('legend', {}, 'Notes'), field('Notes', bind('notes', { area: true }))),
      contact ? active : null);

    const err = el('p.field-error', { role: 'alert', hidden: true });
    const saveBtn = el('button.btn.btn-primary', { type: 'button' }, 'Save');
    saveBtn.addEventListener('click', () => {
      try {
        const rec = { ...c };
        delete rec._displayEdited;
        saved = store.saveContact(rec);
        toast(`${saved.kind === 'vendor' ? 'Vendor' : 'Customer'} saved`);
        dirty = false;
        dlg.close();
      } catch (e) {
        err.hidden = false;
        err.textContent = e.message;
      }
    });
    const dlg = openDialog({
      title: contact ? `Edit ${c.kind}` : `New ${c.kind === 'vendor' ? 'vendor' : 'customer'}`,
      drawer: true,
      body: [err, body],
      footer: el('div.end', {}, el('button.btn', { type: 'button', onclick: () => dlg.layer.requestClose() }, 'Cancel'), saveBtn),
      beforeClose: async () => {
        if (!dirty) return true;
        const { confirmDialog } = await import('../ui/dialog.js');
        return confirmDialog({ title: 'Discard changes?', message: 'This contact has unsaved changes.', confirmLabel: 'Discard', danger: true });
      },
      onClose: () => resolve(saved),
    });
  });
}

/** A small "add new" dialog used from pickers. */
export function quickContact(kind, name) {
  return new Promise((resolve) => {
    let saved = null;
    let handedOff = false;
    const input = textInput({ value: name || '' });
    const err = el('p.field-error', { role: 'alert', hidden: true });
    const save = () => {
      try {
        saved = store.saveContact({ kind, displayName: input.value.trim(), terms: store.settings.defaultTerms });
        dlg.close();
      } catch (e) {
        err.hidden = false;
        err.textContent = e.message;
      }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    const dlg = openDialog({
      title: `New ${kind}`,
      body: [field(kind === 'vendor' ? 'Vendor display name' : 'Customer display name', input, { required: true }), err],
      footer: [
        el('button.btn.btn-ghost', { type: 'button', onclick: () => { handedOff = true; dlg.close(); openContactForm({ kind, name: input.value }).then(resolve); } }, 'Add details'),
        el('div.end', {}, el('button.btn', { type: 'button', onclick: () => dlg.close() }, 'Cancel'), el('button.btn.btn-primary', { type: 'button', onclick: save }, 'Save')),
      ],
      initialFocus: input,
      onClose: () => { if (!handedOff) resolve(saved); },
    });
  });
}

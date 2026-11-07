/** Product and service form (drawer). */
import { el } from '../ui/dom.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { field, textInput, textArea, moneyInput, checkbox, segmented } from '../ui/fields.js';
import { combobox } from '../ui/combobox.js';
import { toast } from '../ui/toast.js';
import { store } from '../lib/store.js';
import { ACCOUNT_TYPES } from '../lib/accounts.js';

function acctCombo(value, types, onChange, label) {
  return combobox({
    value, ariaLabel: label, placeholder: 'Choose an account', onChange,
    labelOf: (id) => store.accountName(id),
    options: () => store.chart().map((r) => r.account).filter((a) => types.includes(a.type)).map((a) => ({ id: a.id, label: store.accountName(a.id), group: ACCOUNT_TYPES[a.type].label })),
  });
}

export function openItemForm({ item = null, name = '' } = {}) {
  return new Promise((resolve) => {
    const it = item ? structuredClone(item) : {
      kind: 'service', name, active: true, taxable: false, sold: true, purchased: false,
      incomeAccountId: store.roleAccount('sales'), expenseAccountId: null,
    };
    let dirty = false;
    let saved = null;
    const touch = () => { dirty = true; };
    const bind = (key, area = false) => {
      const i = area ? textArea({ value: it[key] || '', rows: 2 }) : textInput({ value: it[key] || '' });
      i.addEventListener('input', () => { it[key] = i.value; touch(); });
      return i;
    };
    const kind = segmented({ options: [['service', 'Service'], ['nonInventory', 'Non-inventory']], value: it.kind, ariaLabel: 'Item type', onChange: (v) => { it.kind = v; touch(); } });
    const price = moneyInput({ value: it.price ?? null, ariaLabel: 'Sales price or rate', onChange: (v) => { it.price = v || 0; touch(); } });
    const cost = moneyInput({ value: it.cost ?? null, ariaLabel: 'Cost', onChange: (v) => { it.cost = v || 0; touch(); } });
    const income = acctCombo(it.incomeAccountId, ['income', 'otherIncome'], (v) => { it.incomeAccountId = v; touch(); }, 'Income account');
    const expense = acctCombo(it.expenseAccountId, ['expense', 'cogs', 'otherExpense', 'otherCurrentAsset', 'fixedAsset'], (v) => { it.expenseAccountId = v; touch(); }, 'Expense account');
    const purchasedWrap = el('div.form-grid', { hidden: !it.purchased },
      field('Purchase description', bind('purchaseDesc', true), { className: 'span-2' }),
      field('Cost', cost),
      field('Expense account', expense));
    const sold = checkbox({ checked: it.sold !== false, label: 'I sell this product or service to my customers', onChange: (v) => { it.sold = v; touch(); } });
    const purchased = checkbox({ checked: !!it.purchased, label: 'I purchase this product or service from a vendor', onChange: (v) => { it.purchased = v; purchasedWrap.hidden = !v; touch(); } });
    const taxable = checkbox({ checked: !!it.taxable, label: 'Taxable', onChange: (v) => { it.taxable = v; touch(); } });
    const active = checkbox({ checked: it.active !== false, label: 'Active', onChange: (v) => { it.active = v; touch(); } });

    const err = el('p.field-error', { role: 'alert', hidden: true });
    const body = el('div.stack', {},
      field('Type', kind),
      el('div.form-grid', {}, field('Name', bind('name'), { required: true, className: 'span-2' }), field('SKU', bind('sku'))),
      el('fieldset.fieldset', {}, el('legend', {}, 'Sales'),
        el('div', {}, sold),
        el('div.form-grid', {}, field('Description on sales forms', bind('desc', true), { className: 'span-2' }), field('Sales price or rate', price), field('Income account', income), el('div.field', {}, taxable))),
      el('fieldset.fieldset', {}, el('legend', {}, 'Purchasing'), el('div', {}, purchased), purchasedWrap),
      item ? active : null);
    const saveBtn = el('button.btn.btn-primary', { type: 'button' }, 'Save');
    saveBtn.addEventListener('click', () => {
      try {
        saved = store.saveItem(it);
        toast('Product or service saved');
        dirty = false;
        dlg.close();
      } catch (e) {
        err.hidden = false;
        err.textContent = e.message;
      }
    });
    const dlg = openDialog({
      title: item ? 'Edit product or service' : 'New product or service',
      drawer: true,
      body: [err, body],
      footer: el('div.end', {}, el('button.btn', { type: 'button', onclick: () => dlg.layer.requestClose() }, 'Cancel'), saveBtn),
      beforeClose: () => (dirty ? confirmDialog({ title: 'Discard changes?', message: 'This item has unsaved changes.', confirmLabel: 'Discard', danger: true }) : true),
      onClose: () => resolve(saved),
    });
  });
}

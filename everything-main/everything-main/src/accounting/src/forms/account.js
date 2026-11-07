/** New or edit account dialog, with an opening balance for balance-sheet accounts. */
import { el } from '../ui/dom.js';
import { openDialog } from '../ui/dialog.js';
import { field, textInput, textArea, selectInput, moneyInput, dateInput, checkbox } from '../ui/fields.js';
import { toast } from '../ui/toast.js';
import { store } from '../lib/store.js';
import { ACCOUNT_TYPES, TYPE_KEYS, isBalanceSheet, typeInfo } from '../lib/accounts.js';
import { today } from '../lib/dates.js';

export function openAccountForm({ account = null, name = '', type = 'expense', types = null } = {}) {
  return new Promise((resolve) => {
    const a = account ? structuredClone(account) : { name, type: types?.includes(type) ? type : types?.[0] || type, number: '', description: '', parentId: null, active: true };
    let saved = null;
    let opening = 0;
    let openingDate = today();
    const nameIn = textInput({ value: a.name });
    nameIn.addEventListener('input', () => { a.name = nameIn.value; });
    const numIn = textInput({ value: a.number || '', inputMode: 'numeric' });
    numIn.addEventListener('input', () => { a.number = numIn.value.trim(); });
    const desc = textArea({ value: a.description || '', rows: 2 });
    desc.addEventListener('input', () => { a.description = desc.value; });
    const allowed = (types || TYPE_KEYS).filter((k) => !(a.role && k !== a.type));
    const typeSel = selectInput({ options: allowed.map((k) => [k, ACCOUNT_TYPES[k].label]), value: a.type, onChange: (v) => { a.type = v; fillParents(); obWrap.hidden = account || !isBalanceSheet(v); } });
    if (a.role) typeSel.disabled = true;
    const parentSel = el('select.select', { 'aria-label': 'Parent account' });
    const subBox = checkbox({ checked: !!a.parentId, label: 'Make this a sub-account', onChange: (v) => { parentSel.disabled = !v; if (!v) a.parentId = null; else a.parentId = parentSel.value || null; } });
    parentSel.disabled = !a.parentId;
    parentSel.addEventListener('change', () => { a.parentId = parentSel.value || null; });
    function fillParents() {
      parentSel.replaceChildren();
      const cls = typeInfo(a.type).cls;
      for (const { account: p } of store.chart()) {
        if (p.id === a.id || typeInfo(p.type).cls !== cls) continue;
        parentSel.append(el('option', { value: p.id }, store.accountName(p.id)));
      }
      if (a.parentId) parentSel.value = a.parentId;
      else if (!parentSel.disabled) a.parentId = parentSel.value || null;
    }
    fillParents();
    const ob = moneyInput({ value: null, allowNegative: true, ariaLabel: 'Opening balance', onChange: (v) => { opening = v || 0; } });
    const obDate = dateInput({ value: openingDate, ariaLabel: 'As of', onChange: (v) => { openingDate = v; } });
    const obWrap = el('div.form-grid', { hidden: !!account || !isBalanceSheet(a.type) },
      field('Opening balance', ob, { hint: 'What the account held before you started these books.' }),
      field('As of', obDate));

    const err = el('p.field-error', { role: 'alert', hidden: true });
    const body = el('div.stack', {},
      err,
      el('div.form-grid', {}, field('Account name', nameIn, { required: true, className: 'span-2' }), field('Account number', numIn), field('Account type', typeSel)),
      el('div', {}, subBox),
      field('Parent account', parentSel),
      field('Description', desc),
      obWrap,
      a.role ? el('p.field-hint', {}, 'The books rely on this account. You can rename it but not change its type or delete it.') : null);
    const save = () => {
      try {
        if (opening && !account && store.isLocked(openingDate)) throw new Error(`The opening balance date is in the closed period (through ${store.settings.closeDate}).`);
        saved = store.saveAccount(a);
        a.id = saved.id;
        if (opening && !account) {
          const sign = typeInfo(saved.type).sign;
          const obe = store.roleAccount('openingBalance');
          store.saveTxn({ type: 'journal', date: openingDate, num: store.nextNumber('journal'), memo: `Opening balance for ${saved.name}`, lines: [
            { accountId: saved.id, debit: sign > 0 ? Math.max(opening, 0) : Math.max(-opening, 0), credit: sign > 0 ? Math.max(-opening, 0) : Math.max(opening, 0), desc: 'Opening balance' },
            { accountId: obe, debit: sign > 0 ? Math.max(-opening, 0) : Math.max(opening, 0), credit: sign > 0 ? Math.max(opening, 0) : Math.max(-opening, 0), desc: 'Opening balance' },
          ] }, { allowLocked: false });
        }
        toast(account ? 'Account saved' : 'Account created');
        dlg.close();
      } catch (e) {
        // A new account whose opening balance failed is taken back out, so
        // trying again does not trip over its own name.
        if (!account && saved && !store.accountInUse(saved.id)) { store.remove('accounts', saved.id); delete a.id; saved = null; }
        err.hidden = false;
        err.textContent = e.message;
      }
    };
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    const dlg = openDialog({
      title: account ? 'Edit account' : 'New account',
      body,
      footer: el('div.end', {}, el('button.btn', { type: 'button', onclick: () => dlg.close() }, 'Cancel'), el('button.btn.btn-primary', { type: 'button', onclick: save }, 'Save')),
      initialFocus: nameIn,
      onClose: () => resolve(saved),
    });
  });
}

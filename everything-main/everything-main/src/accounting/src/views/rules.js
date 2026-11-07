/** Bank rules: categorize statement lines automatically. */
import { el, clear, swap } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { field, textInput, selectInput, moneyInput, checkbox } from '../ui/fields.js';
import { dataTable } from '../ui/table.js';
import { toast } from '../ui/toast.js';
import { pageHead, emptyState } from './page.js';
import { accountPicker, contactPicker } from '../forms/common.js';
import { store } from '../lib/store.js';
import { RULE_OPS, ruleMatches } from '../lib/banking.js';
import { formatMoney } from '../lib/money.js';

function describe(rule) {
  const parts = (rule.conditions || []).map((c) => {
    const op = (RULE_OPS[c.field] || []).find((o) => o[0] === c.op)?.[1] || c.op;
    return `${c.field === 'amount' ? 'Amount' : 'Description'} ${op} ${c.field === 'amount' ? formatMoney(c.value || 0) : `"${c.value}"`}`;
  });
  return parts.join(rule.match === 'any' ? ' or ' : ' and ');
}

export function renderRules(main) {
  const rows = [...store.rules.values()].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.name.localeCompare(b.name));
  const reviewLines = [...store.bankLines.values()].filter((l) => l.status === 'review');
  const columns = [
    { key: 'priority', label: 'Priority', render: (r) => String(rows.indexOf(r) + 1), sortable: false },
    { key: 'name', label: 'Rule name', primary: true, render: (r) => el('span.cell-main', {}, r.name), sortable: false },
    { key: 'applies', label: 'Applied to', hideMobile: true, render: (r) => (r.direction === 'out' ? 'Money out' : r.direction === 'in' ? 'Money in' : 'Money in or out'), sortable: false },
    { key: 'cond', label: 'Conditions', render: (r) => describe(r), sortable: false },
    { key: 'set', label: 'Settings', hideMobile: true, render: (r) => [r.set?.transferAccountId ? `Transfer: ${store.accountName(r.set.transferAccountId)}` : r.set?.categoryId ? `Category: ${store.accountName(r.set.categoryId)}` : '', r.set?.contactId ? ` · Payee: ${store.contactName(r.set.contactId)}` : ''].join(''), sortable: false },
    { key: 'hits', label: 'Matching now', align: 'right', render: (r) => String(reviewLines.filter((l) => ruleMatches(r, l)).length), sortable: false },
    { key: 'status', label: 'Status', render: (r) => el(`span.badge${r.active === false ? '' : '.badge-positive'}`, {}, r.active === false ? 'Inactive' : r.autoAdd ? 'Auto-add' : 'Active'), sortable: false },
    {
      key: 'action', label: 'Action', srLabel: 'Action', className: 'actions-cell', sortable: false,
      render: (r) => el('div.row', { style: { justifyContent: 'flex-end' } },
        el('button.icon-btn', { type: 'button', 'aria-label': `Move ${r.name} up`, html: icon('up', 16), disabled: rows.indexOf(r) === 0, onclick: () => move(r, -1) }),
        el('button.icon-btn', { type: 'button', 'aria-label': `Move ${r.name} down`, html: icon('down', 16), disabled: rows.indexOf(r) === rows.length - 1, onclick: () => move(r, 1) }),
        el('button.icon-btn', { type: 'button', 'aria-label': `Delete ${r.name}`, html: icon('trash', 16), onclick: async () => { if (await confirmDialog({ title: `Delete rule ${r.name}?`, message: 'Transactions already categorized by it are not changed.', confirmLabel: 'Delete', danger: true })) { store.remove('rules', r.id); toast('Rule deleted'); } } })),
    },
  ];
  function move(r, dir) {
    const i = rows.indexOf(r);
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const order = rows.slice();
    [order[i], order[j]] = [order[j], order[i]];
    store.batch(({ put }) => order.forEach((x, k) => put('rules', { ...x, priority: k })));
  }
  const table = dataTable({
    columns, rows, ariaLabel: 'Bank rules', onRowClick: (r) => openRuleForm({ rule: r }),
    empty: emptyState({ iconName: 'rules', title: 'No rules yet', text: 'Rules categorize bank transactions as they arrive, for example everything with "Pixel Cloud" in the description goes to Software.', action: el('button.btn.btn-primary', { type: 'button', onclick: () => openRuleForm() }, 'Create a rule') }),
  });
  swap(main, el('div.page', {},
    pageHead({ title: 'Rules', crumbs: [['Accounting', 'banking'], ['Rules']], actions: [el('button.btn.btn-primary', { type: 'button', onclick: () => openRuleForm() }, 'New rule')] }),
    el('p.field-hint', { style: { marginBottom: '12px' } }, 'Rules run top to bottom; the first one that matches a transaction is used.'),
    table.root));
}

export function openRuleForm({ rule = null, fromLine = null, draft = null } = {}) {
  const r = rule ? structuredClone(rule) : {
    name: fromLine ? fromLine.desc.split(/\s+/).slice(0, 3).join(' ') : '',
    direction: fromLine ? (fromLine.amount < 0 ? 'out' : 'in') : 'out',
    accountIds: fromLine ? [fromLine.accountId] : [],
    match: 'all',
    conditions: [{ field: 'desc', op: 'contains', value: fromLine ? fromLine.desc.split(/\s+/).slice(0, 2).join(' ') : '' }],
    set: { categoryId: draft?.categoryId || null, contactId: draft?.contactId || null, memo: '', transferAccountId: null },
    autoAdd: false, active: true, priority: store.rules.size,
  };
  const name = textInput({ value: r.name });
  name.addEventListener('input', () => { r.name = name.value; });
  const dir = selectInput({ options: [['out', 'Money out'], ['in', 'Money in'], ['both', 'Money in or out']], value: r.direction, ariaLabel: 'Apply this to transactions that are', onChange: (v) => { r.direction = v; } });
  const accts = selectInput({ options: [['', 'All bank accounts'], ...store.accountsOfType('bank', 'creditCard').map((a) => [a.id, a.name])], value: r.accountIds?.[0] || '', ariaLabel: 'In', onChange: (v) => { r.accountIds = v ? [v] : []; } });
  const match = selectInput({ options: [['all', 'all'], ['any', 'any']], value: r.match, ariaLabel: 'Match', onChange: (v) => { r.match = v; } });
  const condBox = el('div.stack');
  function paintConds() {
    clear(condBox);
    r.conditions.forEach((c, i) => {
      const fieldSel = selectInput({ options: [['desc', 'Description'], ['amount', 'Amount']], value: c.field, ariaLabel: `Condition ${i + 1} field`, onChange: (v) => { c.field = v; c.op = RULE_OPS[v][0][0]; c.value = ''; paintConds(); } });
      const opSel = selectInput({ options: RULE_OPS[c.field], value: c.op, ariaLabel: `Condition ${i + 1} operator`, onChange: (v) => { c.op = v; } });
      let val;
      if (c.field === 'amount') val = moneyInput({ value: c.value || null, ariaLabel: `Condition ${i + 1} amount`, onChange: (v) => { c.value = v || 0; } }).root;
      else { val = textInput({ value: c.value || '', ariaLabel: `Condition ${i + 1} text` }); val.addEventListener('input', () => { c.value = val.value; }); }
      condBox.append(el('div.rule-cond', {}, fieldSel, opSel, val, r.conditions.length > 1 ? el('button.icon-btn', { type: 'button', 'aria-label': `Remove condition ${i + 1}`, html: icon('x', 16), onclick: () => { r.conditions.splice(i, 1); paintConds(); } }) : null));
    });
    condBox.append(el('button.btn.btn-sm', { type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => { r.conditions.push({ field: 'desc', op: 'contains', value: '' }); paintConds(); } }, 'Add a condition'));
  }
  paintConds();
  const cat = accountPicker({ value: r.set.categoryId, ariaLabel: 'Category', onChange: (v) => { r.set.categoryId = v; } });
  const payee = contactPicker({ kind: 'any', value: r.set.contactId, ariaLabel: 'Payee', onChange: (v) => { r.set.contactId = v; } });
  const transfer = accountPicker({ value: r.set.transferAccountId, types: ['bank', 'creditCard', 'otherCurrentAsset', 'otherCurrentLiability', 'longTermLiability', 'equity'], ariaLabel: 'Transfer account', onChange: (v) => { r.set.transferAccountId = v; } });
  const memo = textInput({ value: r.set.memo || '' });
  memo.addEventListener('input', () => { r.set.memo = memo.value; });
  const kindSel = selectInput({ options: [['cat', 'Categorize'], ['transfer', 'Record as a transfer']], value: r.set.transferAccountId ? 'transfer' : 'cat', ariaLabel: 'Assign', onChange: (v) => { catWrap.hidden = v !== 'cat'; tWrap.hidden = v !== 'transfer'; if (v === 'cat') r.set.transferAccountId = null; else r.set.categoryId = null; } });
  const catWrap = el('div.form-grid', { hidden: !!r.set.transferAccountId }, field('Category', cat), field('Payee', payee));
  const tWrap = el('div.form-grid', { hidden: !r.set.transferAccountId }, field('Transfer account', transfer));
  const auto = checkbox({ checked: !!r.autoAdd, label: 'Automatically add matching transactions to my books', onChange: (v) => { r.autoAdd = v; } });
  const active = checkbox({ checked: r.active !== false, label: 'Rule is active', onChange: (v) => { r.active = v; } });
  const err = el('p.field-error', { role: 'alert', hidden: true });
  const save = () => {
    if (!r.name.trim()) { err.hidden = false; err.textContent = 'Name the rule.'; return; }
    if (!r.conditions.some((c) => c.value)) { err.hidden = false; err.textContent = 'Add at least one condition with a value.'; return; }
    if (!r.set.categoryId && !r.set.transferAccountId && !r.set.contactId) { err.hidden = false; err.textContent = 'Choose what the rule assigns.'; return; }
    store.put('rules', r);
    toast('Rule saved');
    dlg.close();
  };
  const dlg = openDialog({
    title: rule ? 'Edit rule' : 'Create rule',
    drawer: true,
    body: el('div.stack', {}, err,
      field('Rule name', name, { required: true }),
      el('div.form-grid', {}, field('Apply this to transactions that are', dir), field('In', accts)),
      el('div.row', {}, el('span', {}, 'and include'), match, el('span', {}, 'of the following:')),
      condBox,
      el('fieldset.fieldset', {}, el('legend', {}, 'Then'), field('Transaction type', kindSel), catWrap, tWrap, field('Memo', memo)),
      auto, active),
    footer: el('div.end', {}, el('button.btn', { type: 'button', onclick: () => dlg.close() }, 'Cancel'), el('button.btn.btn-primary', { type: 'button', onclick: save }, 'Save')),
    initialFocus: name,
  });
  return dlg;
}

/** Budgets by property and year, with year-to-date variance. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, dataTable, emptyState, field, select } from '../../ui/components.js';
import { formDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { navigate } from '../../ui/router.js';
import { budgetVsActual, incomeStatement, budgetForMonth } from '../../core/financials.js';
import { money, propertySelect } from '../common.js';
import { stmtCell } from './shared.js';

/** Totals of a budget for a whole year. */
export function budgetTotals(budget) {
  let income = 0;
  let expense = 0;
  for (const line of budget.lines || []) {
    const a = lookup.account(line.accountId);
    let year = 0;
    for (let m = 1; m <= 12; m++) year += budgetForMonth(line, m);
    if (a?.type === 'income') income += year;
    else if (a?.type === 'expense') expense += year;
  }
  return { income, expense, net: income - expense };
}

export function render(ctx) {
  const store = app.store;

  const body = ctx.live(() => {
    const today = app.today();
    const rows = store
      .all('budgets')
      .slice()
      .sort((a, b) => b.year - a.year || (lookup.property(a.propertyId)?.name || '').localeCompare(lookup.property(b.propertyId)?.name || ''))
      .map((b) => {
        const t = budgetTotals(b);
        const y = String(b.year);
        const to = today.slice(0, 4) === y ? today : `${y}-12-31`;
        const bva = String(b.year) <= today.slice(0, 4) ? budgetVsActual(store, { budgetId: b.id, from: `${y}-01-01`, to }) : null;
        const variance = bva ? bva.totals.net.actual - bva.totals.net.budget : 0;
        return { b, ...t, variance, ytd: !!bva };
      });
    return h(
      'section.card.list-card',
      { 'aria-label': 'Budgets' },
      dataTable({
        caption: 'Budgets',
        rows,
        rowHref: (r) => `#/budgets/${r.b.id}`,
        columns: [
          { id: 'prop', label: 'Property', render: (r) => h('span.primary-link', lookup.property(r.b.propertyId)?.name || 'Deleted property') },
          { id: 'year', label: 'Year', render: (r) => String(r.b.year) },
          { id: 'inc', label: 'Budgeted income', align: 'r', render: (r) => h('span.num', money(r.income)) },
          { id: 'exp', label: 'Budgeted expenses', align: 'r', render: (r) => h('span.num', money(r.expense)) },
          { id: 'net', label: 'Budgeted net', align: 'r', render: (r) => stmtCell(r.net, { strong: true }) },
          { id: 'var', label: 'Net variance to date', align: 'r', render: (r) => (r.ytd ? h(`span.num.${r.variance >= 0 ? 'acct-good' : 'acct-bad'}`, `${r.variance >= 0 ? '+' : '-'}${money(Math.abs(r.variance))}`) : h('span.subtle', 'Not started')) },
        ],
        mobile: (r) =>
          h('a.mobile-row', { href: `#/budgets/${r.b.id}` }, h('div.grow', h('div.m-title', lookup.property(r.b.propertyId)?.name || 'Deleted property'), h('div.m-sub', `${r.b.year} · Net ${money(r.net)}`)), h('div.m-end', r.ytd ? h(`span.num.${r.variance >= 0 ? 'acct-good' : 'acct-bad'}`, money(r.variance)) : null)),
        empty: emptyState({
          icon: 'calculator',
          title: 'No budgets yet',
          text: 'Plan each property’s income and expenses for the year, then track how actual results compare.',
          headingLevel: 3,
          actions: [h('button.btn.primary', { type: 'button', onClick: newBudget }, icon('plus', 16), 'New budget')],
        }),
      }),
    );
  }, ['budgets', 'transactions', 'accounts', 'properties']);

  return {
    node: h('div.page.acct-page', pageHeader({ title: 'Budgets', actions: [h('button.btn.primary', { type: 'button', onClick: newBudget }, icon('plus', 16), 'New budget')] }), body),
    title: 'Budgets',
  };
}

/** Create a budget; offers to start from last year's actual results. */
export async function newBudget({ propertyId = '' } = {}) {
  const store = app.store;
  const thisYear = Number(app.today().slice(0, 4));
  const property = propertySelect({ name: 'propertyId', value: propertyId });
  const year = select({ name: 'year', value: String(thisYear), options: [thisYear - 1, thisYear, thisYear + 1].map((y) => ({ value: String(y), label: String(y) })) });
  const start = select({
    name: 'start',
    value: 'actuals',
    options: [
      { value: 'actuals', label: 'Last year’s actual income and expenses' },
      { value: 'copy', label: 'A copy of last year’s budget' },
      { value: 'blank', label: 'Blank' },
    ],
  });
  const res = await formDialog({
    title: 'New budget',
    submitLabel: 'Create budget',
    body: h('div.form-grid', field('Property', property, { required: true, span2: true }), field('Year', year), field('Start from', start)),
    onSubmit: () => {
      const y = Number(year.value);
      const pid = property.value;
      const id = `bg-${pid}-${y}`;
      if (store.get('budgets', id)) {
        toast('That property already has a budget for this year. Opening it.');
        return store.get('budgets', id);
      }
      let lines = [];
      if (start.value === 'copy') {
        const prev = store.get('budgets', `bg-${pid}-${y - 1}`);
        lines = prev ? structuredClone(prev.lines || []) : [];
        if (!prev) toast('There is no budget for last year, so this one starts blank.');
      } else if (start.value === 'actuals') {
        const is = incomeStatement(store, { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, propertyIds: [pid] });
        lines = [...is.income, ...is.expense].map((r) => ({ accountId: r.accountId, monthly: Math.round(r.amount / 1200) * 100 }));
      }
      return store.put('budgets', { id, propertyId: pid, year: y, lines });
    },
  });
  if (res && res !== true) navigate(`/budgets/${res.id}`);
  return res;
}

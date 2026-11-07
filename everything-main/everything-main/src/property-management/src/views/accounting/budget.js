/**
 * One budget: a month-by-month plan per account, and budget vs actual.
 * The plan grid saves each cell as you leave it and updates totals in place,
 * so typing is never interrupted by a redraw.
 */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, card, select, field, moneyInput, stat, moreButton } from '../../ui/components.js';
import { formDialog, confirmDialog } from '../../ui/dialog.js';
import { openMenu } from '../../ui/menu.js';
import { toast } from '../../ui/toast.js';
import { currentRoute, navigate } from '../../ui/router.js';
import { centsToInput, parseMoney } from '../../core/money.js';
import { compareAccounts } from '../../core/accounts.js';
import { budgetVsActual, budgetForMonth } from '../../core/financials.js';
import { money, detailTabs, accountSelect, exportCSV, csvMoney } from '../common.js';
import { stmtCell, notFound } from './shared.js';
import { budgetTotals } from './budgets.js';

const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString(undefined, { month: 'short' }));

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  const budget = store.get('budgets', id);
  if (!budget) return notFound('Budget', { href: '#/budgets', label: 'Go to budgets' });
  const propertyName = lookup.property(budget.propertyId)?.name || 'Deleted property';

  const head = ctx.live(() => {
    const b = store.get('budgets', id);
    if (!b) return null;
    const t = budgetTotals(b);
    return [
      pageHeader({
        title: `${propertyName} · ${b.year}`,
        crumbs: [{ label: 'Budgets', href: '#/budgets' }],
        subtitle: 'Annual budget',
        actions: [
          moreButton((btn) =>
            openMenu(btn, [
              { label: 'Export to CSV', icon: 'download', run: () => exportBudget(b) },
              { separator: true },
              { label: 'Delete budget', icon: 'trash', danger: true, run: () => removeBudget(b) },
            ]),
          ),
        ],
      }),
      h('div.stats', stat({ label: 'Budgeted income', value: money(t.income) }), stat({ label: 'Budgeted expenses', value: money(t.expense) }), stat({ label: 'Budgeted net', value: money(t.net), tone: t.net < 0 ? 'danger' : 'success' })),
    ];
  }, ['budgets', 'accounts']);

  let period = 'ytd'; // budget vs actual period, kept across redraws
  const tabs = detailTabs(
    { query: currentRoute().query },
    [
      { id: 'plan', label: 'Plan' },
      { id: 'actual', label: 'Budget vs actual' },
    ],
    (tab) => (tab === 'plan' ? planTab() : actualTab()),
    { label: 'Budget sections' },
  );

  async function removeBudget(b) {
    const ok = await confirmDialog({ title: 'Delete this budget?', message: `The ${b.year} budget for ${propertyName} will be removed. Your transactions are not affected.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const removed = store.remove('budgets', b.id);
    navigate('/budgets');
    toast('Budget deleted', { action: { label: 'Undo', run: () => store.restore('budgets', removed) } });
  }

  function exportBudget(b) {
    const lines = sortedLines(b);
    exportCSV(
      `budget-${propertyName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${b.year}`,
      [{ label: 'Account', value: (l) => lookup.account(l.accountId)?.name || '' }, ...MONTHS.map((m, i) => ({ label: m, value: (l) => csvMoney(budgetForMonth(l, i + 1)) })), { label: 'Total', value: (l) => csvMoney(yearOf(l)) }],
      lines,
    );
  }

  // ---- Plan grid -------------------------------------------------------------------------

  function sortedLines(b) {
    return (b.lines || []).filter((l) => lookup.account(l.accountId)).sort((x, y) => compareAccounts(lookup.account(x.accountId), lookup.account(y.accountId)));
  }

  const yearOf = (line) => {
    let s = 0;
    for (let m = 1; m <= 12; m++) s += budgetForMonth(line, m);
    return s;
  };

  /** Update one line with fn(months[]) and save. */
  function saveLine(accountId, fn) {
    store.patch('budgets', id, (b) => {
      b.lines = (b.lines || []).map((l) => {
        if (l.accountId !== accountId) return l;
        const months = Array.from({ length: 12 }, (_, i) => budgetForMonth(l, i + 1));
        return { accountId, months: fn(months) };
      });
      return b;
    });
  }

  function planTab() {
    const wrap = h('div.stack.acct-stack');
    const draw = () => wrap.replaceChildren(...planContent(store.get('budgets', id), draw));
    draw();
    return wrap;
  }

  function planContent(b, redraw) {
    const lines = sortedLines(b);
    const totalCells = { income: [], expense: [], net: [] };
    const rowTotals = new Map();
    const values = new Map(lines.map((l) => [l.accountId, Array.from({ length: 12 }, (_, i) => budgetForMonth(l, i + 1))]));

    function refreshTotals() {
      for (const kind of ['income', 'expense', 'net']) {
        for (let m = 0; m <= 12; m++) {
          let v = 0;
          for (const l of lines) {
            const t = lookup.account(l.accountId).type;
            const months = values.get(l.accountId);
            const cell = m === 12 ? months.reduce((s, x) => s + x, 0) : months[m];
            if (kind === 'net') v += t === 'income' ? cell : -cell;
            else if (t === kind) v += cell;
          }
          totalCells[kind][m].replaceChildren(stmtCell(v, { strong: true }));
        }
      }
      for (const [accId, el] of rowTotals) el.replaceChildren(h('span.num.strong', money(values.get(accId).reduce((s, x) => s + x, 0))));
    }

    const cellInput = (accountId, m, label) => {
      const months = values.get(accountId);
      const input = h('input.input.num.acct-cell', { type: 'text', inputmode: 'decimal', value: months[m] ? centsToInput(months[m]) : '', placeholder: '0', 'aria-label': label, autocomplete: 'off' });
      input.addEventListener('change', () => {
        const c = parseMoney(input.value) ?? 0;
        input.value = c ? centsToInput(c) : '';
        months[m] = c;
        saveLine(accountId, (arr) => ((arr[m] = c), arr));
        refreshTotals();
      });
      input.addEventListener('keydown', (e) => {
        // Enter moves down like a spreadsheet.
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const inputs = [...input.closest('table').querySelectorAll(`input[data-m="${m}"]`)];
        inputs[inputs.indexOf(input) + 1]?.focus();
      });
      input.dataset.m = String(m);
      return input;
    };

    const fill = async (accountId, name) => {
      const amt = moneyInput({ name: 'amount' });
      const res = await formDialog({
        title: `Same amount every month`,
        submitLabel: 'Fill all months',
        body: h('div.stack', h('p.muted', `Set ${name} to one amount for all twelve months.`), field('Monthly amount', amt, { required: true })),
        onSubmit: () => amt.cents,
      });
      if (res === null || res === true) return;
      saveLine(accountId, () => Array(12).fill(res));
      redraw();
    };

    const removeLine = (accountId) => {
      store.patch('budgets', id, (bb) => ((bb.lines = (bb.lines || []).filter((l) => l.accountId !== accountId)), bb));
      redraw();
    };

    const section = (type, title) => {
      const rows = lines.filter((l) => lookup.account(l.accountId).type === type);
      return [
        h('tr.acct-grid-section', h('th', { scope: 'rowgroup', colspan: 15 }, title)),
        rows.length
          ? rows.map((l) => {
              const a = lookup.account(l.accountId);
              const totalEl = h('td.r');
              rowTotals.set(l.accountId, totalEl);
              return h(
                'tr',
                h('th.acct-grid-name', { scope: 'row' }, h('span.truncate', a.name)),
                MONTHS.map((mLabel, m) => h('td', cellInput(l.accountId, m, `${a.name}, ${mLabel}`))),
                totalEl,
                h(
                  'td.acct-act',
                  h('button.icon-btn.sm', {
                    type: 'button',
                    'aria-label': `Actions for ${a.name}`,
                    onClick: (e) =>
                      openMenu(e.currentTarget, [
                        { label: 'Same amount every month', icon: 'repeat', run: () => fill(l.accountId, a.name) },
                        { label: 'Remove from budget', icon: 'trash', danger: true, run: () => removeLine(l.accountId) },
                      ]),
                  }, icon('more', 16)),
                ),
              );
            })
          : h('tr', h('td.subtle', { colspan: 15 }, `No ${type} accounts in this budget yet.`)),
      ];
    };

    const totalRow = (kind, label) => {
      for (let m = 0; m <= 12; m++) totalCells[kind][m] = h('td.r');
      return h(`tr.acct-grid-total${kind === 'net' ? '.net' : ''}`, h('th', { scope: 'row' }, label), totalCells[kind].slice(0, 12), totalCells[kind][12], h('td'));
    };

    const used = new Set(lines.map((l) => l.accountId));
    const addSel = accountSelect({ value: '', empty: 'Add an account to the budget', filter: (a) => (a.type === 'income' || a.type === 'expense') && !used.has(a.id), 'aria-label': 'Account to add' });
    const addBtn = h('button.btn.sm', {
      type: 'button',
      onClick: () => {
        if (!addSel.value) return addSel.focus();
        const accountId = addSel.value;
        store.patch('budgets', id, (bb) => ((bb.lines = [...(bb.lines || []), { accountId, months: Array(12).fill(0) }]), bb));
        redraw();
        requestAnimationFrame(() => document.querySelector(`.acct-budget-grid input[aria-label^="${CSS.escape(lookup.account(accountId).name)}"]`)?.focus());
      },
    }, icon('plus', 14), 'Add');

    const table = h(
      'table.table.acct-budget-grid',
      h('caption.sr-only', 'Monthly budget by account'),
      h('thead', h('tr', h('th', { scope: 'col' }, 'Account'), MONTHS.map((m) => h('th.r', { scope: 'col' }, m)), h('th.r', { scope: 'col' }, 'Total'), h('th', { scope: 'col' }, h('span.sr-only', 'Actions')))),
      h('tbody', section('income', 'Income'), totalRow('income', 'Total income'), section('expense', 'Expenses'), totalRow('expense', 'Total expenses')),
      h('tfoot', totalRow('net', 'Net')),
    );
    refreshTotals();
    return [
      card({
        title: 'Monthly plan',
        flush: true,
        actions: h('div.row.acct-wrap', addSel, addBtn),
        body: [h('div.table-wrap', { tabindex: '0', role: 'region', 'aria-label': 'Monthly budget grid' }, table), h('p.acct-hint', 'Amounts save as you move between cells. Press Enter to move down a column.')],
      }),
    ];
  }

  // ---- Budget vs actual -------------------------------------------------------------------

  function actualTab() {
    const region = ctx.live(() => actualContent(), ['transactions', 'budgets', 'accounts']);
    return region;

    function actualContent() {
      const b = store.get('budgets', id);
      if (!b) return null;
      const y = Number(b.year);
      const today = app.today();
      const ranges = {
        ytd: [`${y}-01-01`, today.slice(0, 4) === String(y) ? today : `${y}-12-31`],
        year: [`${y}-01-01`, `${y}-12-31`],
        q1: [`${y}-01-01`, `${y}-03-31`],
        q2: [`${y}-04-01`, `${y}-06-30`],
        q3: [`${y}-07-01`, `${y}-09-30`],
        q4: [`${y}-10-01`, `${y}-12-31`],
      };
      // A year that has not started has no year to date yet.
      const future = y > Number(today.slice(0, 4));
      const shown = future && period === 'ytd' ? 'year' : period;
      const sel = select({
        value: shown,
        'aria-label': 'Period',
        options: [
          ...(future ? [] : [{ value: 'ytd', label: 'Year to date' }]),
          { value: 'year', label: 'Full year' },
          { value: 'q1', label: 'First quarter' },
          { value: 'q2', label: 'Second quarter' },
          { value: 'q3', label: 'Third quarter' },
          { value: 'q4', label: 'Fourth quarter' },
        ],
      });
      sel.addEventListener('change', () => {
        period = sel.value;
        region.redraw();
        region.querySelector('select')?.focus();
      });
      // Year to date compares whole months: the budget for the current
      // month counts in full once the month has started.
      const [from, to] = ranges[shown];
      const r = budgetVsActual(store, { budgetId: id, from, to });
      const varCell = (v) => h(`span.num.${v >= 0 ? 'acct-good' : 'acct-bad'}`, `${v >= 0 ? '+' : '-'}${money(Math.abs(v))}`);
      const pctCell = (row) => (row.pct === null ? h('span.subtle', 'Not budgeted') : h('span.num', `${Math.round(row.pct * 100)}%`));
      const group = (type, title) => {
        const rows = r.rows.filter((x) => x.type === type);
        const t = r.totals[type];
        const v = type === 'income' ? t.actual - t.budget : t.budget - t.actual;
        return [
          h('tr.acct-grid-section', h('th', { scope: 'rowgroup', colspan: 5 }, title)),
          rows.map((x) => h('tr', h('th', { scope: 'row' }, h('a', { href: `#/accounts/${x.accountId}` }, x.name)), h('td.r', h('span.num', money(x.budget))), h('td.r', h('span.num', money(x.actual))), h('td.r', varCell(x.variance)), h('td.r', pctCell(x)))),
          h('tr.acct-grid-total', h('th', { scope: 'row' }, `Total ${title.toLowerCase()}`), h('td.r', stmtCell(t.budget, { strong: true })), h('td.r', stmtCell(t.actual, { strong: true })), h('td.r', varCell(v)), h('td.r', t.budget ? h('span.num', `${Math.round((t.actual / t.budget) * 100)}%`) : '')),
        ];
      };
      const netVar = r.totals.net.actual - r.totals.net.budget;
      return card({
        title: 'Budget vs actual',
        flush: true,
        actions: sel,
        body: h(
          'div.table-wrap',
          { tabindex: '0', role: 'region', 'aria-label': 'Budget vs actual' },
          h(
            'table.table.acct-bva',
            h('caption.sr-only', 'Budget vs actual'),
            h('thead', h('tr', h('th', { scope: 'col' }, 'Account'), h('th.r', { scope: 'col' }, 'Budget'), h('th.r', { scope: 'col' }, 'Actual'), h('th.r', { scope: 'col' }, 'Variance'), h('th.r', { scope: 'col' }, 'Of budget'))),
            h('tbody', group('income', 'Income'), group('expense', 'Expenses')),
            h('tfoot', h('tr.acct-grid-total.net', h('th', { scope: 'row' }, 'Net'), h('td.r', stmtCell(r.totals.net.budget, { strong: true })), h('td.r', stmtCell(r.totals.net.actual, { strong: true })), h('td.r', varCell(netVar)), h('td'))),
          ),
        ),
      });
    }
  }

  return { node: h('div.page.acct-page', h('div.stack.acct-stack', head, tabs.node)), title: `${propertyName} budget` };
}

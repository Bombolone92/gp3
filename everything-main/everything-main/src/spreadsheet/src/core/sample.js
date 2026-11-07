/**
 * The sample workbook offered on first run: a household budget with live
 * formulas and a second sheet that leans on lookups and conditional sums,
 * so someone exploring sees formatting, cross-sheet references and the
 * function library all working at once.
 */

import { Workbook } from './workbook.js';
import { parseInput } from './format.js';
import { parseCellRef, cellKey } from './cell.js';

function put(sheet, a1, input, style) {
  const { r, c } = parseCellRef(a1);
  const { v, f, fmt, cur } = parseInput(input, 'en-US');
  const s = { ...(fmt ? { fmt } : {}), ...(cur ? { cur } : {}), ...(style || {}) };
  sheet.cells.set(cellKey(r, c), { v, f, s: Object.keys(s).length ? s : undefined });
}

export function sampleWorkbook() {
  const wb = new Workbook({
    sheets: [
      { name: 'Budget', colWidths: { 0: 170, 1: 110, 2: 110, 3: 110, 4: 90 } },
      { name: 'Expenses', colWidths: { 0: 110, 1: 190, 2: 130, 3: 110 } },
    ],
  });
  const [budget, expenses] = wb.sheets;
  const head = { bold: true, bg: '#eef2ff', color: '#1e3a8a' };
  const money = { fmt: 'currency', dec: 0 };
  const money2 = { fmt: 'currency', dec: 2 };

  /* ---- Budget ---- */
  put(budget, 'A1', 'Monthly budget', { bold: true });
  put(budget, 'A2', 'Plan against what actually left the account. Edit any blue cell.', { color: '#6b6964' });

  put(budget, 'A4', 'Category', head);
  put(budget, 'B4', 'Planned', { ...head, align: 'right' });
  put(budget, 'C4', 'Actual', { ...head, align: 'right' });
  put(budget, 'D4', 'Difference', { ...head, align: 'right' });
  put(budget, 'E4', 'Used', { ...head, align: 'right' });

  const rows = [
    ['Rent', 1500],
    ['Groceries', 450],
    ['Utilities', 180],
    ['Transport', 120],
    ['Dining out', 200],
    ['Subscriptions', 60],
    ['Savings', 500],
  ];
  rows.forEach(([name, planned], i) => {
    const r = 5 + i;
    put(budget, `A${r}`, name);
    put(budget, `B${r}`, String(planned), { ...money, color: '#0a63f0' });
    put(budget, `C${r}`, `=SUMIF(Expenses!$A$2:$A$40,A${r},Expenses!$C$2:$C$40)`, money);
    put(budget, `D${r}`, `=B${r}-C${r}`, money);
    put(budget, `E${r}`, `=IF(B${r}=0,0,C${r}/B${r})`, { fmt: 'percent', dec: 0 });
  });

  const totalRow = 5 + rows.length;
  put(budget, `A${totalRow}`, 'Total', { bold: true });
  put(budget, `B${totalRow}`, `=SUM(B5:B${totalRow - 1})`, { ...money, bold: true });
  put(budget, `C${totalRow}`, `=SUM(C5:C${totalRow - 1})`, { ...money, bold: true });
  put(budget, `D${totalRow}`, `=B${totalRow}-C${totalRow}`, { ...money, bold: true });
  put(budget, `E${totalRow}`, `=IF(B${totalRow}=0,0,C${totalRow}/B${totalRow})`, { fmt: 'percent', dec: 0, bold: true });

  put(budget, `A${totalRow + 2}`, 'Income', { bold: true });
  put(budget, `B${totalRow + 2}`, '4200', { ...money, color: '#0a63f0' });
  put(budget, `A${totalRow + 3}`, 'Left over');
  put(budget, `B${totalRow + 3}`, `=B${totalRow + 2}-C${totalRow}`, money);
  put(budget, `A${totalRow + 4}`, 'Biggest category');
  put(budget, `B${totalRow + 4}`, `=INDEX(A5:A${totalRow - 1},MATCH(MAX(C5:C${totalRow - 1}),C5:C${totalRow - 1},0))`);
  put(budget, `A${totalRow + 5}`, 'Over budget');
  put(budget, `B${totalRow + 5}`, `=COUNTIF(D5:D${totalRow - 1},"<0")&" of "&ROWS(D5:D${totalRow - 1})`);

  /* ---- Expenses ---- */
  put(expenses, 'A1', 'Category', head);
  put(expenses, 'B1', 'Description', head);
  put(expenses, 'C1', 'Amount', { ...head, align: 'right' });
  put(expenses, 'D1', 'Date', head);

  const items = [
    ['Rent', 'Apartment', 1500, '2026-08-01'],
    ['Groceries', 'Weekly shop', 96.4, '2026-08-02'],
    ['Utilities', 'Electricity', 118, '2026-08-04'],
    ['Transport', 'Transit pass', 85, '2026-08-05'],
    ['Dining out', 'Dinner with friends', 64.5, '2026-08-06'],
    ['Subscriptions', 'Music', 11.99, '2026-08-07'],
    ['Groceries', 'Market', 72.25, '2026-08-09'],
    ['Savings', 'Transfer to savings', 500, '2026-08-10'],
    ['Dining out', 'Lunch', 18.75, '2026-08-12'],
    ['Groceries', 'Weekly shop', 104.1, '2026-08-16'],
    ['Utilities', 'Internet', 55, '2026-08-18'],
    ['Subscriptions', 'Streaming', 15.99, '2026-08-19'],
    ['Transport', 'Taxi', 24, '2026-08-21'],
    ['Groceries', 'Weekly shop', 88.6, '2026-08-23'],
    ['Dining out', 'Coffee', 9.5, '2026-08-25'],
    ['Groceries', 'Market', 61.3, '2026-08-27'],
  ];
  items.forEach(([cat, desc, amount, date], i) => {
    const r = 2 + i;
    put(expenses, `A${r}`, cat);
    put(expenses, `B${r}`, desc);
    put(expenses, `C${r}`, String(amount), money2);
    put(expenses, `D${r}`, date);
  });
  const last = 1 + items.length;
  put(expenses, `A${last + 2}`, 'Total', { bold: true });
  put(expenses, `C${last + 2}`, `=SUM(C2:C${last})`, { ...money2, bold: true });
  put(expenses, `A${last + 3}`, 'Average');
  put(expenses, `C${last + 3}`, `=AVERAGE(C2:C${last})`, money2);
  put(expenses, `A${last + 4}`, 'Largest');
  put(expenses, `C${last + 4}`, `=MAX(C2:C${last})`, money2);
  put(expenses, `A${last + 5}`, 'Entries');
  put(expenses, `C${last + 5}`, `=COUNTA(A2:A${last})`);

  wb.activeSheetId = budget.id;
  wb.dirty = false;
  return wb;
}

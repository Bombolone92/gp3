import { toCSV } from './csv.js';
import { STATUS_LABEL } from './reports.js';

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Rows for a spreadsheet: one expense per line. */
export function expensesToRows(expenses, { categories = [], reports = [] } = {}) {
  const cat = (id) => categories.find((c) => c.id === id)?.name || '';
  const rep = (id) => reports.find((r) => r.id === id);
  const header = ['Date', 'Merchant', 'Amount', 'Currency', 'Category', 'Payment method', 'Report', 'Report status', 'Reconciled', 'Receipt', 'Notes'];
  const rows = expenses.map((e) => {
    const r = rep(e.reportId);
    return [
      e.date, e.merchant, e.amount.toFixed(2), e.currency, cat(e.categoryId), e.paymentMethod || '',
      r?.title || '', r ? STATUS_LABEL[r.status] : '', e.reconciled ? 'Yes' : 'No', e.receiptPath ? 'Yes' : 'No', e.notes || '',
    ];
  });
  return [header, ...rows];
}

export function expensesToCSV(expenses, ctx) {
  // BOM so Excel opens UTF-8 correctly.
  return `﻿${toCSV(expensesToRows(expenses, ctx))}`;
}

export function exportJSONFile(data, filename = `expenses-backup-${new Date().toISOString().slice(0, 10)}.json`) {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename);
}

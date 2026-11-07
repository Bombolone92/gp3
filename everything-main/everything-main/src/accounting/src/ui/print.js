/**
 * Print a transaction as a clean paper document (or save it as PDF from the
 * browser's print dialog). The document is built in a dedicated print root
 * that print.css shows on its own.
 */
import { el } from './dom.js';
import { store } from '../lib/store.js';
import { TXN_TYPES, lineTotal, SALES_DOCS } from '../lib/txn.js';
import { formatMoney } from '../lib/money.js';
import { formatDate } from '../lib/dates.js';

function companyBlock() {
  const c = store.settings.company || {};
  const a = c.address || {};
  return el('div.p-company', {},
    el('div.p-company-name', {}, c.name || 'My Company'),
    [a.line1, a.line2, [a.city, a.state, a.zip].filter(Boolean).join(' '), a.country, c.phone, c.email, c.website].filter(Boolean).map((l) => el('div', {}, l)));
}

const TITLES = { invoice: 'Invoice', estimate: 'Estimate', salesReceipt: 'Sales receipt', creditMemo: 'Credit memo', refundReceipt: 'Refund receipt', bill: 'Bill', purchaseOrder: 'Purchase order', check: 'Check', expense: 'Expense', vendorCredit: 'Vendor credit' };

export function buildPaper(t) {
  const sales = SALES_DOCS.has(t.type);
  const contact = store.contact(t.contactId);
  const meta = [
    [`${TITLES[t.type] || TXN_TYPES[t.type].label} no.`, t.num || ''],
    ['Date', formatDate(t.date)],
    t.dueDate ? ['Due date', formatDate(t.dueDate)] : null,
    t.expiryDate ? ['Expiration date', formatDate(t.expiryDate)] : null,
    t.terms ? ['Terms', (store.settings.terms || []).find((x) => x.id === t.terms)?.name || ''] : null,
  ].filter(Boolean);
  const lines = (t.lines || []).filter((l) => lineTotal(l) || l.desc || l.itemId || l.accountId);
  const totals = sales ? store.salesTotals(t) : { total: lines.reduce((s, l) => s + lineTotal(l), 0) };
  const open = t.id && store.txn(t.id) && (t.type === 'invoice' || t.type === 'bill') ? store.openBalance(t.id) : null;
  return el('article.paper', {},
    el('header.p-head', {},
      companyBlock(),
      el('div.p-title', {}, el('h1', {}, (TITLES[t.type] || TXN_TYPES[t.type].label).toUpperCase()), el('dl.p-meta', {}, meta.map(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])))),
    el('section.p-parties', {},
      el('div', {}, el('h2', {}, sales ? 'Bill to' : 'Vendor'), el('pre.p-address', {}, t.billTo || t.address || contact?.displayName || ''))),
    el('table.p-lines', {},
      el('thead', {}, el('tr', {}, el('th', {}, sales || t.lines?.some((l) => l.itemId) ? 'Product or service' : 'Category'), el('th', {}, 'Description'), el('th.num', {}, 'Qty'), el('th.num', {}, 'Rate'), el('th.num', {}, 'Amount'))),
      el('tbody', {}, lines.map((l) => el('tr', {},
        el('td', {}, l.itemId ? store.item(l.itemId)?.name || '' : l.accountId ? store.accountName(l.accountId, { withNumber: false }) : ''),
        el('td', {}, l.desc || ''),
        el('td.num', {}, l.qty !== '' && l.qty !== undefined ? String(l.qty) : ''),
        el('td.num', {}, l.rate !== '' && l.rate !== undefined ? formatMoney(l.rate) : ''),
        el('td.num', {}, formatMoney(lineTotal(l))))))),
    el('section.p-bottom', {},
      el('div.p-message', {}, t.message || ''),
      el('dl.p-totals', {},
        sales ? [el('dt', {}, 'Subtotal'), el('dd', {}, formatMoney(totals.subtotal))] : null,
        sales && totals.discount ? [el('dt', {}, 'Discount'), el('dd', {}, `-${formatMoney(totals.discount)}`)] : null,
        sales && totals.tax ? [el('dt', {}, 'Tax'), el('dd', {}, formatMoney(totals.tax))] : null,
        el('dt.p-total', {}, 'Total'), el('dd.p-total', {}, formatMoney(totals.total)),
        open !== null ? [el('dt', {}, 'Payments'), el('dd', {}, formatMoney(totals.total - open)), el('dt.p-total', {}, 'Balance due'), el('dd.p-total', {}, formatMoney(open))] : null)));
}

export function printTxn(t) {
  printNode(buildPaper(t));
}

export function printNode(node) {
  let root = document.getElementById('print-root');
  if (!root) {
    root = el('div', { id: 'print-root' });
    document.body.append(root);
  }
  root.replaceChildren(node);
  document.body.classList.add('print-doc');
  const done = () => {
    document.body.classList.remove('print-doc');
    root.replaceChildren();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 30);
}

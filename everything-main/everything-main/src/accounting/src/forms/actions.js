/**
 * The "More" menu on a saved transaction: duplicate, void, delete, journal,
 * and follow-ups. `close()` closes the form, asking first about unsaved
 * changes, and resolves false when the user stays.
 */
import { el } from '../ui/dom.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { toast, toastError } from '../ui/toast.js';
import { store } from '../lib/store.js';
import { TXN_TYPES } from '../lib/txn.js';
import { formatMoney } from '../lib/money.js';

async function forms() {
  return import('./index.js');
}

export function txnMoreActions(existing, { reopen, close } = {}) {
  if (!existing) return [];
  const t = existing;
  const meta = TXN_TYPES[t.type];
  const items = [];
  const leave = async () => (close ? (await close()) !== false : true);
  if (t.type === 'estimate') {
    items.push({ label: 'Convert to invoice', icon: 'invoice', onClick: async () => { if (!(await leave())) return; (await import('./sales.js')).convertEstimate(store.txn(t.id)); } });
  }
  if (t.type === 'invoice' && store.openBalance(t.id) > 0) {
    items.push({ label: 'Record payment', icon: 'handCoins', onClick: async () => { if (!(await leave())) return; (await forms()).openTxnForm({ type: 'payment', draft: { contactId: t.contactId, preselect: t.id } }); } });
  }
  if (t.type === 'bill' && store.openBalance(t.id) > 0) {
    items.push({ label: 'Pay this bill', icon: 'wallet', onClick: async () => { if (!(await leave())) return; (await forms()).openTxnForm({ type: 'billPayment', draft: { contactId: t.contactId, preselect: t.id } }); } });
  }
  if (t.type === 'purchaseOrder') {
    items.push({ label: 'Copy to bill', icon: 'receipt', onClick: async () => { if (!(await leave())) return; (await forms()).openTxnForm({ type: 'bill', draft: { contactId: t.contactId, lines: structuredClone(t.lines || []), poId: t.id, memo: `From purchase order #${t.num || ''}` } }); } });
  }
  items.push({ label: 'Duplicate', icon: 'copy', onClick: async () => {
    if (!(await leave())) return;
    const copy = store.duplicateTxn(t.id);
    (await forms()).openTxnForm({ type: t.type, draft: copy });
  } });
  if (!meta.nonPosting) items.push({ label: 'Transaction journal', icon: 'journal', onClick: () => showJournal(store.txn(t.id)) });
  items.push('sep');
  if (!meta.nonPosting && !t.voided) {
    items.push({ label: 'Void', icon: 'ban', onClick: async () => {
      const ok = await confirmDialog({ title: `Void this ${meta.label.toLowerCase()}?`, message: 'Its amounts become zero but it stays in your records with its number. Any payments applied to it are unapplied.', confirmLabel: 'Void', danger: true });
      if (!ok) return null;
      try {
        store.voidTxn(t.id);
        toast(`${meta.label} voided`);
        return 'close';
      } catch (err) { toastError(err); return null; }
    } });
  }
  items.push({ label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
    const ok = await confirmDialog({ title: `Delete this ${meta.label.toLowerCase()}?`, message: 'This removes it from your books. Payments or deposits that refer to it are adjusted.', confirmLabel: 'Delete', danger: true });
    if (!ok) return null;
    try {
      const before = store.deleteTxn(t.id);
      toast(`${meta.label} deleted`, { action: { label: 'Undo', onClick: () => { store.restore(before); reopen?.(before.txns[0]); } } });
      return 'close';
    } catch (err) { toastError(err); return null; }
  } });
  return items;
}

export function showJournal(t) {
  if (!t) return;
  const ps = store.ledgerPostingsOf(t);
  let d = 0; let c = 0;
  const rows = ps.map((p) => {
    if (p.amount > 0) d += p.amount; else c -= p.amount;
    return el('tr', {},
      el('td', {}, store.accountName(p.accountId)),
      el('td', {}, store.contactName(p.contactId) || ''),
      el('td', {}, p.memo || ''),
      el('td.num', {}, p.amount > 0 ? formatMoney(p.amount) : ''),
      el('td.num', {}, p.amount < 0 ? formatMoney(-p.amount) : ''));
  });
  openDialog({
    title: 'Transaction journal',
    wide: true,
    body: el('div.table-wrap', {}, el('table.grid', {},
      el('caption.sr-only', {}, 'Debits and credits of this transaction'),
      el('thead', {}, el('tr', {}, ['Account', 'Name', 'Memo'].map((h) => el('th', { scope: 'col' }, h)), el('th.num', { scope: 'col' }, 'Debit'), el('th.num', { scope: 'col' }, 'Credit'))),
      el('tbody', {}, rows),
      el('tfoot', {}, el('tr', {}, el('td', { colSpan: 3 }, 'Total'), el('td.num', {}, formatMoney(d)), el('td.num', {}, formatMoney(c)))))),
  });
}

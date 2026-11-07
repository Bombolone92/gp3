/** Open the right form for a transaction type, a route name, or a saved transaction. */
import { TXN_TYPES } from '../lib/txn.js';
import { store } from '../lib/store.js';
import { toast } from '../ui/toast.js';
import { openSalesForm } from './sales.js';
import { openPurchaseForm } from './purchase.js';
import { openPaymentForm, openPayBills } from './payment.js';
import { openDepositForm, openTransferForm, openJournalForm } from './other.js';

const ROUTE_TO_TYPE = Object.fromEntries(Object.entries(TXN_TYPES).map(([type, m]) => [m.route, type]));

export function typeFromRoute(route) {
  return ROUTE_TO_TYPE[route] || null;
}

export function openTxnForm({ type, id = null, draft = null, onSaved = null } = {}) {
  if (store.readOnly && !id) {
    toast('You are offline. This copy of your books is read-only.');
    return null;
  }
  switch (type) {
    case 'invoice': case 'estimate': case 'salesReceipt': case 'creditMemo': case 'refundReceipt':
      return openSalesForm({ type, id, draft, onSaved });
    case 'expense': case 'check': case 'bill': case 'vendorCredit': case 'ccCredit': case 'purchaseOrder':
      return openPurchaseForm({ type, id, draft, onSaved });
    case 'payment': case 'billPayment':
      return openPaymentForm({ type, id, draft, onSaved });
    case 'deposit':
      return openDepositForm({ id, draft, onSaved });
    case 'transfer': case 'ccPayment':
      return openTransferForm({ type, id, draft, onSaved });
    case 'journal':
      return openJournalForm({ id, draft, onSaved });
    default:
      toast('Unknown transaction type');
      return null;
  }
}

export function openTxn(id) {
  const t = store.txn(id);
  if (!t) { toast('That transaction no longer exists.'); return null; }
  return openTxnForm({ type: t.type, id });
}

export function openNew(route, draft) {
  if (route === 'pay-bills') return openPayBills();
  const type = typeFromRoute(route) || (TXN_TYPES[route] ? route : null);
  if (!type) { toast('Unknown form'); return null; }
  return openTxnForm({ type, draft });
}

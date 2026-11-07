/** The "Create" menu, shared by the rail button, the palette and the N key. */
import { navigate } from '../ui/router.js';

export function createActions() {
  return [
    { label: 'Client', icon: 'user-plus', run: () => navigate('/clients/new') },
    { label: 'Request', icon: 'inbox', run: () => navigate('/requests/new') },
    { label: 'Quote', icon: 'file-pen', run: () => navigate('/quotes/new') },
    { label: 'Job', icon: 'hammer', run: () => navigate('/jobs/new') },
    { label: 'Invoice', icon: 'receipt-text', run: () => navigate('/invoices/new') },
    { label: 'Payment', icon: 'wallet', run: () => import('./payments.js').then((m) => m.recordPaymentDialog()) },
    { label: 'Expense', icon: 'receipt', run: () => import('./expenses.js').then((m) => m.expenseDialog()) },
    { label: 'Task or event', icon: 'calendar-plus', run: () => import('./schedule.js').then((m) => m.eventDialog()) },
  ];
}

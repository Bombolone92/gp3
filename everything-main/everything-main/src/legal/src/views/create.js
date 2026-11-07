/** Everything the "Create new" menu and the command palette can create. */
import { navigate, currentRoute } from '../ui/router.js';

/** The matter in view, so new records default to it. */
function contextMatter() {
  const r = currentRoute();
  return r.name === 'matter' ? r.params.id : '';
}

export function createActions() {
  const matterId = contextMatter();
  return [
    { id: 'time', label: 'Time entry', icon: 'clock', hint: 'T', run: () => import('./dialogs.js').then((m) => m.openActivityDialog({ kind: 'time', matterId })) },
    { id: 'expense', label: 'Expense entry', icon: 'receipt', run: () => import('./dialogs.js').then((m) => m.openActivityDialog({ kind: 'expense', matterId })) },
    { id: 'flat', label: 'Flat fee entry', icon: 'dollar', run: () => import('./dialogs.js').then((m) => m.openActivityDialog({ kind: 'flat', matterId })) },
    { separator: true },
    { id: 'matter', label: 'Matter', icon: 'briefcase', run: () => navigate('/matters/new') },
    { id: 'contact', label: 'Contact', icon: 'contact', run: () => navigate('/contacts/new') },
    { id: 'task', label: 'Task', icon: 'square-check', run: () => import('./dialogs.js').then((m) => m.openTaskDialog({ matterId })) },
    { id: 'event', label: 'Calendar event', icon: 'calendar-plus', run: () => import('./dialogs.js').then((m) => m.openEventDialog({ matterId })) },
    { separator: true },
    { id: 'payment', label: 'Payment', icon: 'hand-coins', run: () => import('./money-dialogs.js').then((m) => m.openPaymentDialog({ matterId: matterId || null })) },
    { id: 'trust', label: 'Trust deposit', icon: 'vault', run: () => import('./money-dialogs.js').then((m) => m.openTrustDialog({ type: 'deposit', matterId })) },
    { id: 'bill', label: 'Bills', icon: 'receipt-text', run: () => navigate(matterId ? `/billing/new?matter=${matterId}` : '/billing/new') },
    { separator: true },
    { id: 'phone', label: 'Phone log', icon: 'phone', run: () => import('./dialogs.js').then((m) => m.openLogDialog({ kind: 'phone', matterId })) },
    { id: 'email', label: 'Email log', icon: 'mail', run: () => import('./dialogs.js').then((m) => m.openLogDialog({ kind: 'email', matterId })) },
    { id: 'message', label: 'Internal message', icon: 'message', run: () => import('./dialogs.js').then((m) => m.openLogDialog({ kind: 'message', matterId })) },
    { id: 'note', label: 'Note', icon: 'sticky-note', run: () => import('./dialogs.js').then((m) => m.openNoteDialog({ matterId })) },
    { id: 'document', label: 'Document', icon: 'file-up', run: () => navigate(matterId ? `/matters/${matterId}?tab=documents&upload=1` : '/documents?upload=1') },
    { separator: true },
    { id: 'conflict', label: 'Conflict check', icon: 'shield-check', run: () => import('./dialogs.js').then((m) => m.openConflictCheck()) },
  ];
}

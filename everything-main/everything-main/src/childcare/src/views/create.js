/** "Log or add" actions, shared by the create menu, search, and shortcuts. */
import { navigate } from '../ui/router.js';
import { isFamily, isManager } from '../app.js';
import { ACTIVITY_TYPES } from '../core/activities.js';

export function createActions() {
  if (isFamily()) return [];
  const log = (type) => () => import('./log.js').then((m) => m.openLogActivity({ type }));
  const quick = ['photo', 'meal', 'nap', 'toilet', 'note'].map((id) => {
    const t = ACTIVITY_TYPES.find((x) => x.id === id);
    return { label: `Log ${(t.short || t.label).toLowerCase()}`, icon: t.icon, run: log(id) };
  });
  return [
    { label: 'Log an activity', icon: 'notebook-pen', run: () => import('./log.js').then((m) => m.openLogActivity()), hint: 'N' },
    ...quick,
    { separator: true },
    { label: 'Check in or out', icon: 'user-check', run: () => navigate('/attendance') },
    { label: 'Add a child', icon: 'baby', run: () => navigate('/children/new') },
    { label: 'Add a family member', icon: 'user-plus', run: () => import('./families.js').then((m) => m.openGuardianForm()) },
    isManager() ? { label: 'Add staff', icon: 'id-card', run: () => import('./staff.js').then((m) => m.openStaffForm()) } : null,
    { label: 'Add an event', icon: 'calendar-plus', run: () => import('./calendar.js').then((m) => m.openEventForm()) },
    { label: 'Post an announcement', icon: 'megaphone', run: () => import('./messages.js').then((m) => m.openAnnouncementForm()) },
    isManager() ? { label: 'New statement', icon: 'receipt', run: () => import('./billing.js').then((m) => m.openInvoiceForm()) } : null,
    isManager() ? { label: 'Record a payment', icon: 'wallet', run: () => import('./billing.js').then((m) => m.openPaymentForm()) } : null,
  ].filter(Boolean);
}

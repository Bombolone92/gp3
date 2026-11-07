/** The "New" menu, shared by the rail button, the palette and the N key. */
import { navigate } from '../ui/router.js';

const tx = () => import('./transactions/dialogs.js');

export function createActions() {
  return [
    {
      heading: 'Rentals',
      items: [
        { label: 'Property', icon: 'building', run: () => navigate('/properties/new') },
        { label: 'Lease', icon: 'file-signature', run: () => navigate('/leases/new') },
        { label: 'Tenant', icon: 'user-plus', run: () => navigate('/tenants/new') },
        { label: 'Applicant', icon: 'contact', run: () => navigate('/applicants/new') },
      ],
    },
    {
      heading: 'Money',
      items: [
        { label: 'Receive payment', icon: 'hand-coins', run: () => tx().then((m) => m.receivePaymentDialog()) },
        { label: 'Charge a tenant', icon: 'receipt-text', run: () => tx().then((m) => m.chargeDialog()) },
        { label: 'Bill', icon: 'receipt', run: () => tx().then((m) => m.billDialog()) },
        { label: 'Expense', icon: 'wallet', run: () => tx().then((m) => m.expenseDialog()) },
        { label: 'Journal entry', icon: 'book', run: () => tx().then((m) => m.journalDialog()) },
      ],
    },
    {
      heading: 'Operations',
      items: [
        { label: 'Work order', icon: 'wrench', run: () => navigate('/work-orders/new') },
        { label: 'Task', icon: 'list-checks', run: () => navigate('/tasks/new') },
        { label: 'Vendor', icon: 'truck', run: () => navigate('/vendors/new') },
        { label: 'Rental owner', icon: 'briefcase', run: () => navigate('/owners/new') },
      ],
    },
  ];
}

/** Flat list for the command palette. */
export function createActionList() {
  return createActions().flatMap((g) => g.items);
}

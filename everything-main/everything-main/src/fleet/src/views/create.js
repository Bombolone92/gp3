import { navigate } from '../ui/router.js';

/** Everything that can be added from the quick add menu and the palette. */
export function createActions() {
  // navigate() shows the page again even when the address is unchanged,
  // so a second quick add from the same page still opens its dialog.
  const go = (href) => () => navigate(href);
  return [
    { group: 'daily', coll: 'inspections', label: 'Start inspection', icon: 'clipboard-check', run: go('#/inspections/start') },
    { group: 'daily', coll: 'issues', label: 'Issue', icon: 'warning', run: go('#/issues/new') },
    { group: 'daily', coll: 'fuel', label: 'Fuel entry', icon: 'fuel', run: go('#/fuel/new') },
    { group: 'daily', coll: 'meters', label: 'Meter reading', icon: 'gauge', run: go('#/meters?new=1') },
    { group: 'service', coll: 'workOrders', label: 'Work order', icon: 'clipboard', run: go('#/work-orders/new') },
    { group: 'service', coll: 'serviceEntries', label: 'Service entry', icon: 'wrench', run: go('#/service/new') },
    { group: 'service', coll: 'reminders', label: 'Service reminder', icon: 'bell', run: go('#/reminders/new') },
    { group: 'service', coll: 'renewals', label: 'Renewal reminder', icon: 'calendar-clock', run: go('#/renewals?new=1') },
    { group: 'service', coll: 'expenses', label: 'Expense', icon: 'receipt', run: go('#/expenses?new=1') },
    { group: 'records', coll: 'vehicles', label: 'Vehicle', icon: 'truck', run: go('#/vehicles/new') },
    { group: 'records', coll: 'contacts', label: 'Contact', icon: 'user', run: go('#/contacts/new') },
    { group: 'records', coll: 'vendors', label: 'Vendor', icon: 'store', run: go('#/vendors/new') },
    { group: 'records', coll: 'parts', label: 'Part', icon: 'package', run: go('#/parts/new') },
    { group: 'records', coll: 'purchaseOrders', label: 'Purchase order', icon: 'cart', run: go('#/purchase-orders/new') },
  ];
}

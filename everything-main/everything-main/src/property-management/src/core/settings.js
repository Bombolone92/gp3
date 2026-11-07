/** Company-wide settings, stored as one small KV item. */

export function defaultSettings() {
  return {
    company: {
      name: '',
      phone: '',
      email: '',
      website: '',
      address: '',
    },
    currency: 'USD',
    weekStart: 0,
    numbering: { lease: 1, workOrder: 1, task: 1 },
    accounting: {
      // Bank account that receives payments when a property has none set.
      defaultBankId: 'acc-operating',
      depositBankId: 'acc-deposits',
      fiscalYearStart: 1, // month, 1-12
      autoPost: true, // post recurring charges and late fees when the app opens
      postDaysAhead: 0, // post recurring charges this many days before they are due
    },
    leases: {
      type: 'fixed-rollover',
      termMonths: 12,
      rentDay: 1,
      noticeDays: 60, // leases ending within this many days count as expiring
    },
    lateFee: {
      enabled: true,
      graceDays: 5,
      kind: 'flat', // flat | percent
      amount: 5000,
      percent: 5,
      minBalance: 100, // only charge when at least this much rent is late
    },
    lists: {
      vendorCategories: ['Plumbing', 'Electrical', 'HVAC', 'Appliance repair', 'General contractor', 'Landscaping', 'Cleaning', 'Painting', 'Roofing', 'Pest control', 'Locksmith', 'Insurance', 'Legal', 'Utilities', 'Supplies', 'Other'],
      taskCategories: ['General', 'Maintenance', 'Complaint', 'Lease question', 'Payment question', 'Move in', 'Move out', 'Inspection', 'Other'],
      leadSources: ['Website', 'Listing site', 'Referral', 'Walk-in', 'Sign', 'Social media', 'Other'],
    },
    receipts: {
      footer: 'Thank you for your payment.',
    },
    onboarded: false,
  };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Deep merge for plain objects; arrays and scalars replace. */
export function mergeSettings(base, changes) {
  const out = { ...base };
  for (const [k, v] of Object.entries(changes || {})) {
    out[k] = isObj(v) && isObj(base?.[k]) ? mergeSettings(base[k], v) : v;
  }
  return out;
}

export const PAYMENT_METHODS = [
  { id: 'check', label: 'Check' },
  { id: 'cash', label: 'Cash' },
  { id: 'money-order', label: 'Money order' },
  { id: 'cashiers-check', label: 'Cashier’s check' },
  { id: 'ach', label: 'Bank transfer (ACH)' },
  { id: 'card', label: 'Credit or debit card' },
  { id: 'online', label: 'Online payment' },
  { id: 'other', label: 'Other' },
];

export function methodLabel(id) {
  return PAYMENT_METHODS.find((m) => m.id === id)?.label || '';
}

export const PROPERTY_TYPES = [
  { id: 'single-family', label: 'Single-family home', group: 'Residential' },
  { id: 'multi-family', label: 'Multi-family', group: 'Residential' },
  { id: 'condo', label: 'Condo', group: 'Residential' },
  { id: 'townhome', label: 'Townhome', group: 'Residential' },
  { id: 'office', label: 'Office', group: 'Commercial' },
  { id: 'retail', label: 'Retail', group: 'Commercial' },
  { id: 'industrial', label: 'Industrial', group: 'Commercial' },
  { id: 'mixed-use', label: 'Mixed use', group: 'Commercial' },
  { id: 'storage', label: 'Storage', group: 'Commercial' },
  { id: 'parking', label: 'Parking', group: 'Commercial' },
];

export function propertyTypeLabel(id) {
  return PROPERTY_TYPES.find((t) => t.id === id)?.label || 'Property';
}

export function propertyGroup(id) {
  return PROPERTY_TYPES.find((t) => t.id === id)?.group || 'Residential';
}

export const LEASE_TYPES = [
  { id: 'fixed', label: 'Fixed term' },
  { id: 'fixed-rollover', label: 'Fixed, then month-to-month' },
  { id: 'at-will', label: 'Month-to-month' },
];

export function leaseTypeLabel(id) {
  return LEASE_TYPES.find((t) => t.id === id)?.label || '';
}

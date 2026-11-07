/** School-wide settings, stored as one small KV item. */

export function defaultSettings() {
  return {
    school: {
      name: '',
      phone: '',
      email: '',
      website: '',
      address: '',
      licenseNumber: '',
    },
    currency: 'USD',
    weekStart: 0,
    hours: { open: '07:00', close: '18:00' },
    numbering: { invoice: 1001 },
    access: {
      staffOnlyByDefault: false, // new activities hidden from families until shared
      parentsCanEditInfo: true, // allergies, medications, doctor, address
      parentsCanReportAbsence: true,
      parentsCanMessage: true,
    },
    billing: {
      dueDays: 7,
      lateFeeCents: 0,
      message: 'Thank you! Please reach out with any questions about this statement.',
    },
    mealTypes: ['Breakfast', 'AM snack', 'Lunch', 'PM snack', 'Dinner'],
    absenceReasons: ['Sick', 'Vacation', 'Appointment', 'Family', 'Other'],
    incidentTypes: ['Bump or bruise', 'Scrape or cut', 'Bite', 'Fall', 'Allergic reaction', 'Behavior', 'Other'],
    kioskPinHash: '',
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
  { id: 'cash', label: 'Cash' },
  { id: 'check', label: 'Check' },
  { id: 'card', label: 'Credit or debit card' },
  { id: 'bank', label: 'Bank transfer' },
  { id: 'subsidy', label: 'Subsidy' },
  { id: 'other', label: 'Other' },
];

export const BILLING_FREQUENCIES = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
];

/** Business-wide settings, stored as one small KV item. */

export function defaultSettings() {
  return {
    company: {
      name: '',
      phone: '',
      email: '',
      website: '',
      address: '',
      taxId: '',
    },
    currency: 'USD',
    weekStart: 0,
    workday: { start: '07:00', end: '18:00' },
    taxes: [],
    defaultTaxId: null,
    numbering: { quote: 1, job: 1, invoice: 1, request: 1 },
    quotes: {
      validDays: 30,
      message: 'Thank you for the opportunity to quote on this work. Let us know if you have any questions.',
      disclaimer: 'This quote is valid for the next 30 days, after which values may be subject to change.',
    },
    invoices: {
      terms: 'net30',
      message: 'Thank you for your business. Please contact us with any questions regarding this invoice.',
      disclaimer: '',
    },
    jobs: { defaultBilling: 'on_completion' },
    leadSources: ['Referral', 'Google', 'Website', 'Social media', 'Flyer', 'Repeat client', 'Other'],
    expenseCategories: ['Materials', 'Fuel', 'Equipment', 'Subcontractor', 'Office', 'Vehicle', 'Other'],
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

export const PAYMENT_TERMS = [
  { id: 'receipt', label: 'Due upon receipt', days: 0 },
  { id: 'net7', label: 'Net 7', days: 7 },
  { id: 'net15', label: 'Net 15', days: 15 },
  { id: 'net30', label: 'Net 30', days: 30 },
  { id: 'net45', label: 'Net 45', days: 45 },
  { id: 'net60', label: 'Net 60', days: 60 },
  { id: 'custom', label: 'Custom date', days: null },
];

export function termDays(terms) {
  return PAYMENT_TERMS.find((t) => t.id === terms)?.days ?? 30;
}

export const PAYMENT_METHODS = [
  { id: 'cash', label: 'Cash' },
  { id: 'check', label: 'Check' },
  { id: 'card', label: 'Credit or debit card' },
  { id: 'bank', label: 'Bank transfer' },
  { id: 'other', label: 'Other' },
];

export function taxRateFor(settings, taxId) {
  const t = (settings.taxes || []).find((x) => x.id === taxId);
  return t ? Number(t.rate) || 0 : 0;
}

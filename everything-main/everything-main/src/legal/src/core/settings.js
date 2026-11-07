/**
 * Firm-wide settings, stored as one small KV item. Lists that grow with use
 * (firm users, task list templates, document templates, bank accounts) are
 * collections of their own so this item stays small.
 */

const PRACTICE_AREAS = [
  ['pa-corp', 'Corporate'],
  ['pa-crim', 'Criminal defense'],
  ['pa-emp', 'Employment'],
  ['pa-estate', 'Estate planning'],
  ['pa-family', 'Family'],
  ['pa-imm', 'Immigration'],
  ['pa-ip', 'Intellectual property'],
  ['pa-lit', 'Litigation'],
  ['pa-pi', 'Personal injury'],
  ['pa-re', 'Real estate'],
];

const DEFAULT_STAGES = [
  ['st-intake', 'Intake'],
  ['st-investigation', 'Investigation'],
  ['st-active', 'In progress'],
  ['st-negotiation', 'Negotiation'],
  ['st-closing', 'Closing'],
];

export function defaultSettings() {
  return {
    firm: {
      name: '',
      phone: '',
      email: '',
      website: '',
      street: '',
      city: '',
      region: '',
      postal: '',
      country: '',
      taxId: '',
    },
    currency: 'USD',
    weekStart: 0,
    workday: { start: '08:00', end: '18:00' },
    practiceAreas: PRACTICE_AREAS.map(([id, name]) => ({ id, name })),
    // Stages apply to every practice area unless one defines its own list.
    stages: DEFAULT_STAGES.map(([id, name]) => ({ id, name })),
    activityCategories: [
      { id: 'ac-research', name: 'Legal research', kind: 'time' },
      { id: 'ac-draft', name: 'Drafting', kind: 'time' },
      { id: 'ac-call', name: 'Phone call', kind: 'time' },
      { id: 'ac-meeting', name: 'Client meeting', kind: 'time' },
      { id: 'ac-court', name: 'Court appearance', kind: 'time' },
      { id: 'ac-review', name: 'Document review', kind: 'time' },
      { id: 'ac-corr', name: 'Correspondence', kind: 'time' },
      { id: 'ac-travel', name: 'Travel', kind: 'time' },
      { id: 'ac-filing', name: 'Filing fee', kind: 'expense' },
      { id: 'ac-courier', name: 'Courier', kind: 'expense' },
      { id: 'ac-copies', name: 'Copies and printing', kind: 'expense' },
      { id: 'ac-mileage', name: 'Mileage', kind: 'expense' },
      { id: 'ac-expert', name: 'Expert fees', kind: 'expense' },
    ],
    documentCategories: ['Pleadings', 'Correspondence', 'Contracts', 'Evidence', 'Court orders', 'Research', 'Billing', 'Other'],
    customFields: [], // [{ id, entity: 'matter' | 'contact', label, type, options }]
    relationships: ['Opposing party', 'Opposing counsel', 'Witness', 'Expert', 'Judge', 'Co-counsel', 'Insurer', 'Beneficiary', 'Other'],
    billing: {
      increment: 6, // minutes; 6 = tenths of an hour
      defaultRateCents: 25000,
      termsDays: 30,
      taxRate: 0, // percent, applied to fees only
      taxName: 'Tax',
      taxExpenses: false,
      message: 'Thank you for the opportunity to work with you. Payment is due within the terms shown above.',
      showTimekeeper: true,
    },
    numbering: { matter: 1, bill: 1, format: 'number-client' },
    trust: { requireMinimum: true },
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

export const MATTER_STATUSES = [
  { id: 'open', label: 'Open' },
  { id: 'pending', label: 'Pending' },
  { id: 'closed', label: 'Closed' },
];

export const BILLING_METHODS = [
  { id: 'hourly', label: 'Hourly' },
  { id: 'flat', label: 'Flat fee' },
  { id: 'contingency', label: 'Contingency' },
];

export const PAYMENT_METHODS = [
  { id: 'check', label: 'Check' },
  { id: 'card', label: 'Credit or debit card' },
  { id: 'bank', label: 'Bank transfer' },
  { id: 'cash', label: 'Cash' },
  { id: 'trust', label: 'From trust' },
  { id: 'other', label: 'Other' },
];

export const NUMBER_FORMATS = [
  { id: 'number-client', label: '00012-Lopez' },
  { id: 'number', label: '00012' },
  { id: 'year-number', label: '2026-00012' },
];

export const USER_ROLES = [
  { id: 'lawyer', label: 'Lawyer' },
  { id: 'paralegal', label: 'Paralegal' },
  { id: 'assistant', label: 'Legal assistant' },
  { id: 'admin', label: 'Administrator' },
];

export const PRIORITIES = [
  { id: 'high', label: 'High' },
  { id: 'normal', label: 'Normal' },
  { id: 'low', label: 'Low' },
];

export function practiceAreaName(settings, id) {
  return settings.practiceAreas.find((p) => p.id === id)?.name || '';
}

/** Stages for a practice area: its own list when it has one, else the default list. */
export function stagesFor(settings, practiceAreaId) {
  const pa = settings.practiceAreas.find((p) => p.id === practiceAreaId);
  return pa?.stages?.length ? pa.stages : settings.stages;
}

export function stageName(settings, practiceAreaId, stageId) {
  if (!stageId) return '';
  return stagesFor(settings, practiceAreaId).find((s) => s.id === stageId)?.name || settings.stages.find((s) => s.id === stageId)?.name || '';
}

export function categoryName(settings, id) {
  return settings.activityCategories.find((c) => c.id === id)?.name || '';
}

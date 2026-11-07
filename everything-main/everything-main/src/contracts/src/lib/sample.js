/**
 * Sample dataset for "explore with sample data": a believable small-company
 * contract book with renewals landing at varied distances from today, shaped
 * exactly like an export so store.importAll() installs and wipes it through
 * the normal path.
 */

import { uid } from './util.js';
import { todayISO, addDays, addMonths } from './dates.js';
import { normalizeCurrency } from './money.js';
import { repeatAnchor } from './store.js';

export function sampleDataset(store) {
  const today = todayISO();
  const currency = normalizeCurrency(store.settings.currency);
  // One contract in a second currency, because most real books have one and
  // the dashboard must be seen to keep them apart rather than adding them up.
  const foreign = currency === 'EUR' ? 'USD' : 'EUR';

  const person = (name, company, role, email, phone, notes = '') => ({
    id: uid(), name, company, role, email, phone, notes, createdAt: Date.now(),
  });

  const contacts = [
    person('Maya Lindqvist', 'Northwind Cloud', 'Account Executive', 'maya@northwindcloud.example', '+1 555 0142'),
    person('Daniel Okafor', 'Brightpath Legal', 'Partner', 'd.okafor@brightpath.example', '+1 555 0177',
      'Handles all our commercial reviews. Prefers redlines in Word.'),
    person('Sofia Reyes', 'Castle & Main Properties', 'Leasing Manager', 'sreyes@castlemain.example', '+1 555 0114'),
    person('Tom Becker', 'Beacon Analytics', 'CTO', 'tom@beaconanalytics.example', '+1 555 0198'),
    person('Priya Nair', 'Atlas Staffing', 'Director', 'priya@atlasstaffing.example', '+1 555 0155'),
  ];
  const by = (name) => contacts.find((c) => c.name === name).id;

  const ob = (text, owner, due = null, done = false) => ({
    id: uid(), text, owner, due, done, repeat: null, history: [], createdAt: Date.now(),
  });

  /**
   * A repeating duty: one live occurrence, the rest scheduled from the anchor.
   * The anchor sits `history.length` periods before the live due date, so the
   * next occurrence lands one period on rather than skipping ahead.
   */
  const repeating = (text, owner, due, every, history = []) => ({
    id: uid(), text, owner, due, done: false, createdAt: Date.now(),
    repeat: {
      every, anchor: repeatAnchor(due, every, history.length),
      until: null, count: null, contractEnd: true,
    },
    history: history.map((d) => ({ due: d, doneAt: Date.now() })),
  });

  const contracts = [
    {
      id: uid(),
      title: 'Cloud infrastructure subscription',
      contactId: by('Maya Lindqvist'),
      type: 'license', status: 'active',
      value: 2400, currency, billing: 'monthly',
      startDate: addMonths(today, -10), endDate: addDays(today, 18),
      autoRenew: true, termMonths: 12, noticeDays: 30,
      tags: ['infrastructure', 'critical'],
      notes: 'Enterprise tier, 99.9% SLA. Renewal auto-uplifts 5% unless renegotiated before the notice deadline.',
      obligations: [
        repeating('Pay monthly subscription invoice within 15 days of receipt', 'us',
          addDays(today, 9), 'monthly', [addMonths(addDays(today, 9), -2), addMonths(addDays(today, 9), -1)]),
        ob('Provide 30 days written notice to cancel before auto-renewal', 'us', addDays(today, -12)),
        ob('Maintain 99.9% uptime SLA with monthly service credits', 'them'),
      ],
      documents: [],
    },
    {
      id: uid(),
      title: 'Office lease, 4th floor Fulton Street',
      contactId: by('Sofia Reyes'),
      type: 'lease', status: 'active',
      value: 8500, currency, billing: 'monthly',
      startDate: addMonths(today, -22), endDate: addMonths(today, 14),
      autoRenew: false, termMonths: 36, noticeDays: 90,
      tags: ['facilities'],
      notes: 'Option to extend 24 months at market rate. Landlord covers HVAC maintenance.',
      obligations: [
        repeating('Pay rent by the 1st of each month', 'us', addDays(today, 26), 'monthly',
          [addMonths(addDays(today, 26), -2), addMonths(addDays(today, 26), -1)]),
        repeating('Provide certificate of insurance annually', 'us', addMonths(today, 2), 'annually'),
        ob('Give 90 days notice to exercise the extension option', 'us'),
      ],
      documents: [],
    },
    {
      id: uid(),
      title: 'Data platform services agreement',
      contactId: by('Tom Becker'),
      type: 'service', status: 'active',
      value: 18000, currency: foreign, billing: 'quarterly',
      startDate: addMonths(today, -4), endDate: addDays(today, 52),
      autoRenew: true, termMonths: 6, noticeDays: 45,
      tags: ['data', 'analytics'],
      notes: 'Quarterly business reviews required. Includes 40 hours/quarter of engineering support.',
      obligations: [
        repeating('Deliver quarterly usage and performance report', 'them', addDays(today, 11), 'quarterly'),
        ob('Schedule quarterly business review', 'mutual', addDays(today, 21)),
        repeating('Pay quarterly service fee net 30', 'us', addDays(today, 38), 'quarterly'),
      ],
      documents: [],
    },
    {
      id: uid(),
      title: 'Mutual NDA with Beacon Analytics',
      contactId: by('Tom Becker'),
      type: 'nda', status: 'active',
      value: null, currency, billing: 'one-time',
      startDate: addMonths(today, -4), endDate: addMonths(today, 20),
      autoRenew: false, termMonths: 24, noticeDays: 0,
      tags: ['legal'],
      notes: 'Covers the data platform evaluation and integration work. Survives 3 years past termination.',
      obligations: [
        ob('Keep shared technical documentation confidential', 'mutual'),
        ob('Return or destroy confidential materials on request', 'mutual'),
      ],
      documents: [],
    },
    {
      id: uid(),
      title: 'Staffing services master agreement',
      contactId: by('Priya Nair'),
      type: 'vendor', status: 'active',
      value: 5200, currency, billing: 'monthly',
      // Already through one auto-renewal, so the term history has something
      // real in it: the first term ended and rolled forward by itself.
      startDate: addMonths(today, -21), endDate: addMonths(today, -9),
      autoRenew: true, termMonths: 12, noticeDays: 60,
      tags: ['hr'],
      notes: 'Covers contract engineering placements. Conversion fee waived after 6 months on assignment.',
      obligations: [
        ob('Submit approved timesheets by Friday each week', 'us'),
        ob('Provide replacement within 10 business days if a placement ends early', 'them'),
      ],
      documents: [],
    },
    {
      id: uid(),
      title: 'Outside counsel retainer',
      contactId: by('Daniel Okafor'),
      type: 'service', status: 'active',
      value: 3000, currency, billing: 'monthly',
      startDate: addMonths(today, -13), endDate: null,
      autoRenew: false, termMonths: 12, noticeDays: 0,
      tags: ['legal'],
      notes: 'Evergreen retainer, 10 hours/month included, terminable by either party with 30 days notice.',
      obligations: [
        repeating('Pay monthly retainer invoice net 15', 'us', addDays(today, 6), 'monthly',
          [addMonths(addDays(today, 6), -1)]),
        ob('Provide monthly summary of hours used', 'them'),
      ],
      documents: [],
    },
    {
      id: uid(),
      title: 'Website redesign statement of work',
      contactId: by('Tom Becker'),
      type: 'service', status: 'terminated',
      value: 42000, currency, billing: 'one-time',
      startDate: addMonths(today, -9), endDate: addMonths(today, -2),
      autoRenew: false, termMonths: 7, noticeDays: 0,
      tags: ['marketing'],
      notes: 'Delivered and closed out. Final acceptance signed.',
      obligations: [
        ob('Deliver final design system and source files', 'them', addMonths(today, -2), true),
        ob('Pay final milestone invoice', 'us', addMonths(today, -2), true),
      ],
      documents: [],
    },
    {
      id: uid(),
      title: 'Equipment maintenance plan',
      contactId: null,
      type: 'vendor', status: 'active',
      value: 1800, currency, billing: 'annual',
      startDate: addMonths(today, -11), endDate: addDays(today, 34),
      autoRenew: true, termMonths: 12, noticeDays: 14,
      tags: ['facilities'],
      notes: 'Covers printers and conference room AV. No named account manager yet.',
      obligations: [
        ob('Complete annual preventive maintenance visit', 'them', addDays(today, 30)),
      ],
      documents: [],
    },
  ];

  return {
    settings: { ...store.settings, sampleData: true, onboarded: true },
    contracts,
    contacts,
  };
}

/** One-tap exit from sample mode: everything gone, onboarding reopens. */
export async function wipeSampleData(store) {
  await store.importAll({
    settings: { ...store.settings, sampleData: false, onboarded: false },
    contracts: [],
    contacts: [],
  });
}

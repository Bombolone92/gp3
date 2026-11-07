/**
 * A realistic sample firm for the signed-out demo and for "Load sample data"
 * in settings. Deterministic (seeded) and anchored to `today`, so the demo
 * always has fresh time entries, upcoming hearings, and overdue bills.
 * Every person and company here is fictional.
 */
import { defaultSettings } from './settings.js';
import { addDays, startOfWeek, weekday, minutesToTime } from './dates.js';
import { displayNumber } from './matters.js';
import { activityAmount, lineFromActivity, billTotals } from './finance.js';
import { roundUpMinutes } from './duration.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const USERS = [
  ['u-hartley', 'Eleanor Hartley', 'lawyer', 42500, '#2a5bd7', 100],
  ['u-okafor', 'Daniel Okafor', 'lawyer', 32500, '#0f7b6c', 120],
  ['u-reyes', 'Sofia Reyes', 'lawyer', 29500, '#7a3fc2', 120],
  ['u-lindqvist', 'Marcus Lindqvist', 'paralegal', 14500, '#b4441c', 110],
  ['u-chen', 'Priya Chen', 'paralegal', 13500, '#b0306a', 100],
  ['u-baptiste', 'Jonah Baptiste', 'assistant', 9500, '#4b6b16', 60],
];

const PEOPLE = [
  ['Amara', 'Lopez', 'amara.lopez@example.com', '(555) 201-4410', '418 Willow Lane', 'Riverton', 'OR', '97301'],
  ['Thomas', 'Whitfield', 'twhitfield@example.com', '(555) 201-8832', '72 Harbor View Rd', 'Riverton', 'OR', '97302'],
  ['Grace', 'Nakamura', 'grace.n@example.com', '(555) 340-1187', '1290 Elm Street, Apt 4', 'Salem Falls', 'OR', '97310'],
  ['Ibrahim', 'Haddad', 'ibrahim.haddad@example.com', '(555) 340-7720', '55 Orchard Court', 'Riverton', 'OR', '97301'],
  ['Clara', 'Benedetti', 'clara.benedetti@example.com', '(555) 410-2251', '9 Cedar Point', 'Lakeshore', 'OR', '97035'],
  ['Wesley', 'Grant', 'wes.grant@example.com', '(555) 410-6619', '301 Pine Ridge Dr', 'Lakeshore', 'OR', '97034'],
  ['Hannah', 'Okonkwo', 'hannah.ok@example.com', '(555) 512-3398', '88 Meadow Way', 'Riverton', 'OR', '97304'],
  ['Mateo', 'Alvarez', 'mateo.alvarez@example.com', '(555) 512-9045', '640 Sunset Blvd', 'Salem Falls', 'OR', '97312'],
  ['Evelyn', 'Marsh', 'evelyn.marsh@example.com', '(555) 623-1174', '17 Lighthouse Rd', 'Port Ellis', 'OR', '97420'],
  ['Rohan', 'Kapoor', 'rohan.kapoor@example.com', '(555) 623-5530', '2045 Granite Ave', 'Riverton', 'OR', '97306'],
  ['Lucy', 'Fairbanks', 'lucy.fairbanks@example.com', '(555) 734-2286', '5 Juniper Close', 'Lakeshore', 'OR', '97035'],
  ['Samuel', 'Osei', 'samuel.osei@example.com', '(555) 734-8812', '930 Industrial Pkwy', 'Port Ellis', 'OR', '97420'],
  ['Nadia', 'Petrova', 'nadia.petrova@example.com', '(555) 845-0193', '44 Birchwood Dr', 'Riverton', 'OR', '97301'],
  ['George', 'Abernathy', 'g.abernathy@example.com', '(555) 845-6627', '1200 Ridgeline Rd', 'Salem Falls', 'OR', '97310'],
  ['Mei', 'Tanaka', 'mei.tanaka@example.com', '(555) 956-3341', '77 Lotus Lane', 'Lakeshore', 'OR', '97034'],
  ['Oliver', 'Brennan', 'oliver.brennan@example.com', '(555) 956-7708', '310 Quarry St', 'Riverton', 'OR', '97302'],
];

const COMPANIES = [
  ['Northwind Logistics LLC', 'legal@northwind.example.com', '(555) 600-1000', '1 Commerce Plaza', 'Riverton', 'OR', '97301'],
  ['Bluefin Software Inc.', 'counsel@bluefin.example.com', '(555) 600-2200', '480 Innovation Way', 'Lakeshore', 'OR', '97035'],
  ['Harborline Properties', 'office@harborline.example.com', '(555) 600-3300', '22 Dockside Ave', 'Port Ellis', 'OR', '97420'],
  ['Copperleaf Bakery Co.', 'hello@copperleaf.example.com', '(555) 600-4400', '15 Market Square', 'Riverton', 'OR', '97304'],
  ['Summit Mutual Insurance', 'claims@summitmutual.example.com', '(555) 600-5500', '900 Tower Center', 'Salem Falls', 'OR', '97310'],
  ['Greystone & Pike LLP', 'info@greystonepike.example.com', '(555) 600-6600', '400 Court Street, Suite 12', 'Riverton', 'OR', '97301'],
];

// [client index (P = person, C = company), description, practice area, stage, status, responsible, method, extra]
const MATTERS = [
  ['P0', 'Lopez v. Kestrel Motors: product liability', 'pa-pi', 'st-investigation', 'open', 'u-hartley', 'contingency', { contingencyPct: 33, sol: 21 }],
  ['P1', 'Whitfield estate plan and revocable trust', 'pa-estate', 'st-active', 'open', 'u-reyes', 'flat', { flatFeeCents: 350000 }],
  ['C0', 'Northwind Logistics: master services agreement', 'pa-corp', 'st-negotiation', 'open', 'u-okafor', 'hourly', { budgetCents: 1800000 }],
  ['P2', 'Nakamura dissolution of marriage', 'pa-family', 'st-active', 'open', 'u-reyes', 'hourly', { trustMin: 250000 }],
  ['C1', 'Bluefin Software: trademark portfolio', 'pa-ip', 'st-active', 'open', 'u-okafor', 'hourly', {}],
  ['P3', 'Haddad employment claim (wrongful termination)', 'pa-emp', 'st-investigation', 'open', 'u-hartley', 'hourly', { sol: 74, trustMin: 300000 }],
  ['C2', 'Harborline Properties: Dockside lease dispute', 'pa-lit', 'st-active', 'open', 'u-hartley', 'hourly', { budgetCents: 2500000 }],
  ['P4', 'Benedetti home purchase, 9 Cedar Point', 'pa-re', 'st-closing', 'open', 'u-okafor', 'flat', { flatFeeCents: 180000 }],
  ['P5', 'State v. Grant: DUII defense', 'pa-crim', 'st-active', 'open', 'u-hartley', 'flat', { flatFeeCents: 450000 }],
  ['P6', 'Okonkwo family-based visa petition', 'pa-imm', 'st-intake', 'pending', 'u-reyes', 'flat', { flatFeeCents: 220000 }],
  ['C3', 'Copperleaf Bakery: commercial kitchen lease review', 'pa-re', 'st-active', 'open', 'u-okafor', 'hourly', {}],
  ['P7', 'Alvarez v. Summit Mutual: insurance bad faith', 'pa-lit', 'st-intake', 'open', 'u-hartley', 'contingency', { contingencyPct: 30, sol: 12 }],
  ['P8', 'Marsh guardianship petition', 'pa-family', 'st-active', 'open', 'u-reyes', 'hourly', {}],
  ['P9', 'Kapoor LLC formation and operating agreement', 'pa-corp', 'st-closing', 'open', 'u-okafor', 'flat', { flatFeeCents: 150000 }],
  ['P10', 'Fairbanks slip and fall, Lakeshore Mall', 'pa-pi', 'st-negotiation', 'open', 'u-hartley', 'contingency', { contingencyPct: 33, sol: 140 }],
  ['P11', 'Osei workers compensation appeal', 'pa-emp', 'st-active', 'open', 'u-reyes', 'hourly', {}],
  ['P12', 'Petrova will and powers of attorney', 'pa-estate', 'st-closing', 'closed', 'u-reyes', 'flat', { flatFeeCents: 120000 }],
  ['P13', 'Abernathy boundary dispute', 'pa-re', 'st-active', 'open', 'u-okafor', 'hourly', { trustMin: 200000 }],
  ['P14', 'Tanaka H-1B transfer', 'pa-imm', 'st-active', 'open', 'u-reyes', 'flat', { flatFeeCents: 280000 }],
  ['C1', 'Bluefin Software: employee equity plan', 'pa-corp', 'st-intake', 'pending', 'u-okafor', 'hourly', {}],
  ['P15', 'Brennan landlord-tenant defense', 'pa-lit', 'st-active', 'open', 'u-hartley', 'hourly', {}],
  ['C0', 'Northwind Logistics: warehouse injury defense', 'pa-pi', 'st-investigation', 'open', 'u-hartley', 'hourly', { trustMin: 500000 }],
];

const WORK = {
  'pa-pi': [
    'Reviewed medical records and billing summaries',
    'Drafted demand letter to insurer',
    'Interviewed client regarding incident timeline',
    'Requested police report and witness statements',
    'Analyzed product recall notices',
    'Call with treating physician',
  ],
  'pa-estate': [
    'Drafted revocable living trust',
    'Prepared pour-over will',
    'Meeting with client to review asset schedule',
    'Prepared funding instructions for accounts',
    'Revised durable power of attorney',
  ],
  'pa-corp': [
    'Revised indemnification and limitation of liability clauses',
    'Call with opposing counsel re: payment terms',
    'Drafted redline of master services agreement',
    'Reviewed data protection addendum',
    'Prepared closing checklist',
  ],
  'pa-family': [
    'Prepared financial disclosure statement',
    'Drafted parenting plan proposal',
    'Mediation session preparation',
    'Correspondence with opposing counsel re: support',
    'Reviewed tax returns and pay stubs',
  ],
  'pa-ip': ['Trademark clearance search and analysis', 'Prepared response to office action', 'Docketed renewal deadlines', 'Drafted cease and desist letter'],
  'pa-emp': ['Reviewed personnel file and termination letter', 'Drafted administrative complaint', 'Research on retaliation standards', 'Prepared client for deposition'],
  'pa-lit': [
    'Drafted answer and affirmative defenses',
    'Prepared discovery requests',
    'Reviewed document production',
    'Legal research on lease interpretation',
    'Drafted motion for summary judgment',
    'Attended case management conference',
  ],
  'pa-re': ['Reviewed title commitment and exceptions', 'Drafted lease amendment', 'Coordinated closing with escrow', 'Reviewed survey and easements'],
  'pa-crim': ['Reviewed police report and dashcam footage', 'Motion to suppress research', 'Attended arraignment', 'Negotiation with prosecutor'],
  'pa-imm': ['Prepared petition forms and supporting evidence', 'Reviewed civil documents and translations', 'Client interview re: eligibility'],
};

const EXPENSES = [
  ['ac-filing', 'Court filing fee', 43500],
  ['ac-courier', 'Courier delivery to opposing counsel', 4500],
  ['ac-copies', 'Copies and binding of exhibits', 6800],
  ['ac-mileage', 'Mileage to courthouse', 3900],
  ['ac-expert', 'Medical records retrieval', 12500],
];

const TASKS = [
  ['Calendar response deadline', 'high'],
  ['Send engagement letter for signature', 'normal'],
  ['Collect signed HIPAA authorizations', 'normal'],
  ['Prepare witness list', 'high'],
  ['Follow up on outstanding discovery', 'normal'],
  ['Review settlement offer with client', 'high'],
  ['Order certified copies of deed', 'low'],
  ['Draft status update email to client', 'normal'],
  ['Confirm mediation date with all parties', 'normal'],
  ['File proof of service', 'high'],
  ['Request updated medical bills', 'normal'],
  ['Prepare closing binder', 'low'],
];

export function buildSampleData(today) {
  const r = rng(20261012);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const settings = defaultSettings();
  settings.firm = {
    ...settings.firm,
    name: 'Hartley Okafor & Reyes LLP',
    phone: '(555) 600-0100',
    email: 'office@hor-law.example.com',
    website: 'hor-law.example.com',
    street: '400 Court Street, Suite 300',
    city: 'Riverton',
    region: 'OR',
    postal: '97301',
    country: 'United States',
    taxId: '00-0000000',
  };
  settings.onboarded = true;
  settings.numbering = { ...settings.numbering, matter: 1, bill: 1 };
  const created = `${addDays(today, -200)}T09:00:00.000Z`;

  const users = USERS.map(([id, name, role, rateCents, color, targetHours]) => ({
    id,
    name,
    role,
    rateCents,
    color,
    targetHours,
    email: `${name.split(' ')[0].toLowerCase()}@hor-law.example.com`,
    active: true,
    createdAt: created,
  }));

  const contacts = [];
  PEOPLE.forEach(([firstName, lastName, email, phone, street, city, region, postal], i) => {
    contacts.push({
      id: `p-${i}`,
      type: 'person',
      firstName,
      lastName,
      emails: [{ address: email, type: 'personal', primary: true }],
      phones: [{ number: phone, type: 'mobile', primary: true }],
      addresses: [{ street, city, region, postal, country: 'United States', type: 'home', primary: true }],
      tags: i % 5 === 0 ? ['Referral'] : [],
      createdAt: created,
    });
  });
  COMPANIES.forEach(([companyName, email, phone, street, city, region, postal], i) => {
    contacts.push({
      id: `c-${i}`,
      type: 'company',
      companyName,
      emails: [{ address: email, type: 'work', primary: true }],
      phones: [{ number: phone, type: 'work', primary: true }],
      addresses: [{ street, city, region, postal, country: 'United States', type: 'work', primary: true }],
      tags: [],
      website: '',
      createdAt: created,
    });
  });
  // Opposing parties, counsel, and a judge, for related contacts and conflict checks.
  const extra = [
    ['x-kestrel', 'company', 'Kestrel Motors Corp.'],
    ['x-judge', 'person', 'Hon. Patricia', 'Delgado', 'Judge'],
    ['x-oc1', 'person', 'Victor', 'Sorensen', 'Partner, Greystone & Pike LLP', 'c-5'],
    ['x-oc2', 'person', 'Leah', 'Whitmore', 'Associate, Greystone & Pike LLP', 'c-5'],
    ['x-adj', 'person', 'Kevin', 'Lowell', 'Claims adjuster', 'c-4'],
    ['x-spouse', 'person', 'Daniel', 'Nakamura', ''],
    ['x-expert', 'person', 'Dr. Ingrid', 'Solberg', 'Orthopedic surgeon'],
  ];
  for (const [id, type, a, b, title, companyId] of extra) {
    contacts.push(
      type === 'company'
        ? { id, type, companyName: a, emails: [], phones: [], addresses: [], tags: ['Opposing party'], createdAt: created }
        : {
            id,
            type,
            firstName: a,
            lastName: b,
            jobTitle: title || '',
            companyId: companyId || null,
            emails: [{ address: `${a.replace(/[^a-z]/gi, '').toLowerCase()}.${b.toLowerCase()}@example.com`, type: 'work', primary: true }],
            phones: [],
            addresses: [],
            tags: [],
            createdAt: created,
          },
    );
  }
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  const accounts = [
    { id: 'acct-op', name: 'Operating account', type: 'operating', institution: 'Riverton Community Bank', last4: '4417', openingBalanceCents: 4200000, isDefault: true, createdAt: created },
    { id: 'acct-trust', name: 'Client trust account (IOLTA)', type: 'trust', institution: 'Riverton Community Bank', last4: '9032', openingBalanceCents: 0, isDefault: true, createdAt: created },
  ];

  const matters = [];
  MATTERS.forEach(([ci, description, pa, stage, status, resp, method, x], i) => {
    const clientId = ci[0] === 'P' ? `p-${ci.slice(1)}` : `c-${ci.slice(1)}`;
    const number = i + 1;
    // The longest-running matters reach back about a year.
    const openDate = addDays(today, -Math.round(30 + r() * 320));
    const m = {
      id: `m-${number}`,
      number,
      clientId,
      description,
      practiceAreaId: pa,
      stageId: stage,
      status,
      openDate,
      closedDate: status === 'closed' ? addDays(today, -12) : '',
      pendingDate: status === 'pending' ? addDays(today, -3) : '',
      responsibleId: resp,
      originatingId: i % 4 === 0 ? 'u-hartley' : resp,
      staffId: pick(['u-lindqvist', 'u-chen', '']),
      clientRef: i % 3 === 0 ? `CR-${1000 + i * 7}` : '',
      location: pick(['Riverton', 'Lakeshore', 'Salem Falls', 'Port Ellis']),
      solDate: x.sol ? addDays(today, x.sol) : '',
      solSatisfied: false,
      tags: i % 4 === 1 ? ['Priority'] : [],
      related: [],
      billing: { billable: true, method, rateCents: null, flatFeeCents: x.flatFeeCents || 0, contingencyPct: x.contingencyPct || 0, budgetCents: x.budgetCents || 0 },
      trustMinimumCents: x.trustMin || 0,
      createdAt: `${openDate}T10:00:00.000Z`,
    };
    m.displayNumber = displayNumber(number, { format: settings.numbering.format, client: contactById.get(clientId), openDate });
    matters.push(m);
  });
  matters[0].related = [
    { id: 'rel-1', contactId: 'x-kestrel', relationship: 'Opposing party' },
    { id: 'rel-2', contactId: 'x-expert', relationship: 'Expert' },
  ];
  matters[3].related = [{ id: 'rel-3', contactId: 'x-spouse', relationship: 'Opposing party' }];
  matters[6].related = [
    { id: 'rel-4', contactId: 'x-oc1', relationship: 'Opposing counsel' },
    { id: 'rel-5', contactId: 'x-judge', relationship: 'Judge' },
  ];
  matters[11].related = [
    { id: 'rel-6', contactId: 'c-4', relationship: 'Opposing party' },
    { id: 'rel-7', contactId: 'x-adj', relationship: 'Insurer' },
  ];
  settings.numbering.matter = matters.length + 1;

  // ---- Activities: about four months of time and expenses ----
  const activities = [];
  const userById = new Map(users.map((u) => [u.id, u]));
  let aid = 0;
  const workdays = [];
  for (let d = 0; d < 365; d++) {
    const day = addDays(today, -d);
    const wd = weekday(day);
    if (wd !== 0 && wd !== 6) workdays.push(day);
  }
  const active = matters.filter((m) => m.status !== 'closed' || r() < 0.3);
  for (const day of workdays) {
    // Roughly five billable hours a day per lawyer, across the firm.
    const entries = 12 + Math.floor(r() * 8);
    for (let k = 0; k < entries; k++) {
      const m = pick(active);
      if (day < m.openDate) continue;
      const userId = r() < 0.65 ? m.responsibleId : pick(['u-lindqvist', 'u-chen', m.staffId || 'u-lindqvist']);
      const u = userById.get(userId);
      const minutes = roundUpMinutes(12 + Math.floor(r() * 200), 6);
      const a = {
        id: `a-${++aid}`,
        kind: 'time',
        date: day,
        userId,
        matterId: m.id,
        categoryId: pick(['ac-research', 'ac-draft', 'ac-call', 'ac-review', 'ac-corr', 'ac-meeting']),
        description: pick(WORK[m.practiceAreaId] || WORK['pa-lit']),
        minutes,
        rateCents: u.rateCents,
        billable: m.billing.method === 'hourly' ? r() > 0.06 : r() > 0.7,
        billId: null,
        createdAt: `${day}T17:00:00.000Z`,
      };
      a.amountCents = activityAmount(a);
      activities.push(a);
    }
    if (r() < 0.22) {
      const m = pick(active.filter((x) => x.billing.method !== 'flat'));
      if (day >= m.openDate) {
        const [cat, desc, price] = pick(EXPENSES);
        const a = {
          id: `a-${++aid}`,
          kind: 'expense',
          date: day,
          userId: m.responsibleId,
          matterId: m.id,
          categoryId: cat,
          description: desc,
          qty: 1,
          priceCents: price,
          billable: true,
          billId: null,
          createdAt: `${day}T17:00:00.000Z`,
        };
        a.amountCents = activityAmount(a);
        activities.push(a);
      }
    }
  }
  // A little unassigned admin time.
  for (let i = 0; i < 8; i++) {
    const day = workdays[i * 3];
    const a = {
      id: `a-${++aid}`,
      kind: 'time',
      date: day,
      userId: 'u-baptiste',
      matterId: null,
      categoryId: 'ac-corr',
      description: 'Firm administration and intake calls',
      minutes: 60,
      rateCents: 0,
      billable: false,
      billId: null,
      createdAt: `${day}T17:00:00.000Z`,
    };
    a.amountCents = 0;
    activities.push(a);
  }

  // ---- Bills for work older than this month ----
  const bills = [];
  const payments = [];
  const transactions = [];
  let billNo = 0;
  // Monthly billing cycles over the past year; the newest closed 24 days ago.
  const cutoffs = Array.from({ length: 11 }, (_, i) => addDays(today, -((11 - i) * 30 - 6)));
  // Cycles outermost so bill numbers run in date order across the firm.
  for (const [ci, cutoff] of cutoffs.entries()) {
    for (const m of matters) {
      if (m.billing.method === 'contingency') continue;
      const from = ci === 0 ? '' : addDays(cutoffs[ci - 1], 1);
      const acts = activities
        .filter((a) => a.matterId === m.id && !a.billId && a.billable !== false && a.date <= cutoff && (!from || a.date >= from))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const flatDue = m.billing.method === 'flat' && !m.billing.flatFeeBilled && m.openDate <= cutoff;
      if (m.billing.method === 'flat' ? !flatDue : !acts.length) continue;
      const id = `b-${++billNo}`;
      const issueDate = addDays(cutoff, 2);
      const lines = acts.map((a) => ({ ...lineFromActivity(a), id: `bl-${a.id}` }));
      if (m.billing.method === 'flat') {
        lines.unshift({ id: `bl-${id}`, activityId: null, kind: 'flat', date: issueDate, description: `Flat fee: ${m.description}`, userId: m.responsibleId, amountCents: m.billing.flatFeeCents });
        m.billing.flatFeeBilled = true;
      }
      for (const a of acts) a.billId = id;
      const bill = {
        id,
        number: billNo,
        matterId: m.id,
        clientId: m.clientId,
        issueDate,
        dueDate: addDays(issueDate, 30),
        status: 'issued',
        lines,
        discount: { type: 'percent', value: 0 },
        taxRate: 0,
        taxName: 'Tax',
        taxExpenses: false,
        message: settings.billing.message,
        periodFrom: acts[0]?.date || issueDate,
        periodTo: cutoff,
        sentAt: `${issueDate}T12:00:00.000Z`,
        createdAt: `${issueDate}T12:00:00.000Z`,
      };
      bills.push(bill);
      const total = billTotals(bill).total;
      // Older bills are mostly paid; recent ones are mostly open.
      const roll = r();
      const age = cutoffs.length - 1 - ci; // 0 = the newest cycle
      const paidShare = age >= 3 ? (roll < 0.97 ? 1 : 0.5) : age === 2 ? (roll < 0.88 ? 1 : 0.5) : age === 1 ? (roll < 0.7 ? 1 : roll < 0.85 ? 0.5 : 0) : roll < 0.2 ? 1 : 0;
      if (paidShare > 0) {
        const date = addDays(issueDate, 8 + Math.floor(r() * 20));
        if (date <= today) {
          const amountCents = Math.round(total * paidShare);
          const pid = `pay-${id}`;
          payments.push({
            id: pid,
            date,
            billId: id,
            matterId: m.id,
            contactId: m.clientId,
            amountCents,
            method: pick(['check', 'bank', 'card']),
            reference: `${1000 + billNo * 3}`,
            accountId: 'acct-op',
            createdAt: `${date}T15:00:00.000Z`,
          });
          transactions.push({
            id: `tx-${pid}`,
            accountId: 'acct-op',
            type: 'deposit',
            date,
            amountCents,
            matterId: m.id,
            contactId: m.clientId,
            description: `Payment for bill #${billNo}`,
            paymentId: pid,
            billId: id,
            createdAt: `${date}T15:00:00.000Z`,
          });
        }
      }
    }
  }
  // One draft bill awaiting review.
  {
    const m = matters[2];
    const acts = activities.filter((a) => a.matterId === m.id && !a.billId && a.billable !== false && a.date <= addDays(today, -5)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (acts.length) {
      const id = `b-${++billNo}`;
      for (const a of acts) a.billId = id;
      bills.push({
        id,
        number: billNo,
        matterId: m.id,
        clientId: m.clientId,
        issueDate: today,
        dueDate: addDays(today, 30),
        status: 'draft',
        lines: acts.map((a) => ({ ...lineFromActivity(a), id: `bl-${a.id}` })),
        discount: { type: 'percent', value: 5 },
        taxRate: 0,
        taxName: 'Tax',
        taxExpenses: false,
        message: settings.billing.message,
        periodFrom: acts[0].date,
        periodTo: acts[acts.length - 1].date,
        createdAt: `${today}T09:00:00.000Z`,
      });
    }
  }
  settings.numbering.bill = billNo + 1;

  // ---- Trust: retainers deposited, some applied to bills ----
  const retainers = [
    ['m-4', 500000, 60],
    ['m-6', 750000, 90],
    ['m-14', 300000, 40],
    ['m-18', 400000, 75],
    ['m-22', 1000000, 50],
    ['m-9', 450000, 100],
    ['m-15', 200000, 30],
  ];
  for (const [mid, amount, ago] of retainers) {
    const m = matters.find((x) => x.id === mid);
    if (!m) continue;
    const date = addDays(today, -ago);
    transactions.push({
      id: `tx-ret-${mid}`,
      accountId: 'acct-trust',
      type: 'deposit',
      date,
      amountCents: amount,
      matterId: mid,
      contactId: m.clientId,
      description: 'Retainer deposit',
      method: 'bank',
      reference: `W${Math.floor(r() * 900000 + 100000)}`,
      createdAt: `${date}T11:00:00.000Z`,
    });
  }
  // Pay one open bill from trust.
  {
    const retainerDate = transactions.find((t) => t.id === 'tx-ret-m-6')?.date || today;
    const target = bills.find((b) => b.matterId === 'm-6' && b.status === 'issued' && b.issueDate > retainerDate && !payments.some((p) => p.billId === b.id));
    if (target) {
      const amountCents = Math.min(billTotals(target).total, 300000);
      const date = addDays(target.issueDate, 5);
      const pid = `pay-trust-${target.id}`;
      payments.push({
        id: pid,
        date,
        billId: target.id,
        matterId: 'm-6',
        contactId: target.clientId,
        amountCents,
        method: 'trust',
        reference: '',
        accountId: 'acct-trust',
        createdAt: `${date}T14:00:00.000Z`,
      });
      transactions.push({
        id: `tx-w-${pid}`,
        accountId: 'acct-trust',
        type: 'withdrawal',
        date,
        amountCents,
        matterId: 'm-6',
        contactId: target.clientId,
        description: `Payment for bill #${target.number}`,
        paymentId: pid,
        billId: target.id,
        createdAt: `${date}T14:00:00.000Z`,
      });
      transactions.push({
        id: `tx-d-${pid}`,
        accountId: 'acct-op',
        type: 'deposit',
        date,
        amountCents,
        matterId: 'm-6',
        contactId: target.clientId,
        description: `Payment for bill #${target.number}`,
        paymentId: pid,
        billId: target.id,
        createdAt: `${date}T14:00:00.000Z`,
      });
    }
  }
  // Firm expenses out of operating.
  for (let i = 0; i < 4; i++) {
    const date = addDays(today, -(i * 30 + 3));
    transactions.push({
      id: `tx-rent-${i}`,
      accountId: 'acct-op',
      type: 'withdrawal',
      date,
      amountCents: 650000,
      matterId: null,
      description: 'Office rent',
      payee: 'Court Street Holdings',
      createdAt: `${date}T09:00:00.000Z`,
    });
  }

  // ---- Tasks ----
  const tasks = [];
  let tid = 0;
  for (const m of matters.filter((x) => x.status !== 'closed')) {
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const [name, priority] = pick(TASKS);
      const offset = Math.floor(r() * 24) - 6;
      const done = offset < -2 && r() < 0.5;
      tasks.push({
        id: `t-${++tid}`,
        name,
        description: '',
        matterId: m.id,
        assigneeId: r() < 0.6 ? m.responsibleId : pick(['u-lindqvist', 'u-chen']),
        dueDate: addDays(today, offset),
        priority,
        done,
        completedAt: done ? `${addDays(today, offset)}T16:00:00.000Z` : null,
        createdAt: created,
      });
    }
  }
  tasks.push({
    id: `t-${++tid}`,
    name: 'Renew professional liability insurance',
    description: 'Policy renews at the end of the month.',
    matterId: null,
    assigneeId: 'u-hartley',
    dueDate: addDays(today, 9),
    priority: 'normal',
    done: false,
    createdAt: created,
  });
  tasks.push({
    id: `t-${++tid}`,
    name: 'Monthly trust account reconciliation',
    description: '',
    matterId: null,
    assigneeId: 'u-chen',
    dueDate: addDays(today, 2),
    priority: 'high',
    done: false,
    createdAt: created,
  });

  // ---- Calendar events ----
  const events = [];
  let eid = 0;
  const weekStart = startOfWeek(today, 0);
  const evTemplates = [
    ['Client meeting', 'meeting', 60],
    ['Deposition', 'court', 180],
    ['Case management conference', 'court', 60],
    ['Mediation', 'meeting', 240],
    ['Call with opposing counsel', 'call', 30],
    ['Closing', 'meeting', 90],
    ['Hearing on motion', 'court', 90],
    ['Strategy session', 'meeting', 60],
  ];
  for (let d = -7; d < 28; d++) {
    const day = addDays(weekStart, d);
    const wd = weekday(day);
    if (wd === 0 || wd === 6) continue;
    const count = Math.floor(r() * 3);
    for (let k = 0; k < count; k++) {
      const [title, kind, len] = pick(evTemplates);
      const m = pick(matters.filter((x) => x.status !== 'closed'));
      const start = 8 * 60 + Math.floor(r() * 16) * 30;
      events.push({
        id: `e-${++eid}`,
        title: `${title}: ${contactById.get(m.clientId)?.lastName || contactById.get(m.clientId)?.companyName?.split(' ')[0] || ''}`.trim(),
        kind,
        date: day,
        allDay: false,
        start: minutesToTime(start),
        end: minutesToTime(Math.min(start + len, 19 * 60)),
        matterId: m.id,
        location: kind === 'court' ? 'Riverton County Courthouse, Room 3B' : kind === 'call' ? 'Phone' : 'Conference room A',
        attendeeIds: [m.responsibleId, ...(r() < 0.4 ? [m.staffId || 'u-chen'] : [])],
        description: '',
        reminder: 60,
        createdAt: created,
      });
    }
  }
  events.push({
    id: `e-${++eid}`,
    title: 'Response to motion due',
    kind: 'deadline',
    date: addDays(today, 3),
    allDay: true,
    start: '',
    end: '',
    matterId: 'm-7',
    location: '',
    attendeeIds: ['u-hartley'],
    description: '',
    createdAt: created,
  });
  events.push({
    id: `e-${++eid}`,
    title: 'Firm meeting',
    kind: 'meeting',
    date: today,
    allDay: false,
    start: '08:30',
    end: '09:15',
    matterId: null,
    location: 'Conference room A',
    attendeeIds: users.map((u) => u.id),
    description: 'Weekly docket review',
    createdAt: created,
  });

  // ---- Notes and communications ----
  const notes = [
    {
      id: 'n-1',
      matterId: 'm-1',
      subject: 'Initial consultation',
      body: 'Client purchased the vehicle new. Airbag failed to deploy in a frontal collision at roughly 30 mph. Preserve the vehicle; send spoliation letter to the manufacturer and the tow yard.',
      date: addDays(today, -40),
      authorId: 'u-hartley',
    },
    {
      id: 'n-2',
      matterId: 'm-4',
      subject: 'Custody preferences',
      body: 'Client prefers a 2-2-3 schedule during the school year. Opposing party has proposed alternating weeks. Mediation is likely.',
      date: addDays(today, -18),
      authorId: 'u-reyes',
    },
    {
      id: 'n-3',
      matterId: 'm-3',
      subject: 'Key negotiation points',
      body: 'Liability cap at 12 months of fees. Mutual indemnity for IP claims. Client will accept net 45 payment terms if late fees are removed.',
      date: addDays(today, -9),
      authorId: 'u-okafor',
    },
  ].map((n) => ({ ...n, contactId: null, createdAt: `${n.date}T12:00:00.000Z` }));
  const communications = [];
  let cid = 0;
  for (let i = 0; i < 40; i++) {
    const m = pick(matters);
    const kind = pick(['phone', 'phone', 'email', 'email', 'meeting', 'message']);
    const date = addDays(today, -Math.floor(r() * 45));
    const subj = { phone: 'Call re: case status', email: 'Email re: documents requested', meeting: 'Meeting re: next steps', message: 'Please prepare the exhibit binder' }[kind];
    communications.push({
      id: `cm-${++cid}`,
      kind,
      subject: subj,
      date,
      time: minutesToTime(9 * 60 + Math.floor(r() * 16) * 30),
      matterId: m.id,
      contactId: kind === 'message' ? null : m.clientId,
      toUserId: kind === 'message' ? m.staffId || 'u-lindqvist' : null,
      fromUserId: m.responsibleId,
      direction: kind === 'phone' || kind === 'email' ? pick(['in', 'out']) : null,
      minutes: kind === 'message' ? 0 : roundUpMinutes(6 + Math.floor(r() * 40), 6),
      body: '',
      createdAt: `${date}T12:00:00.000Z`,
    });
  }

  // ---- Documents (text only in the demo) ----
  const docs = [
    ['m-1', 'Spoliation letter to Kestrel Motors.txt', 'Correspondence', 'Please preserve the vehicle and all related records.'],
    ['m-1', 'Medical records index.txt', 'Evidence', 'Index of medical records received to date.'],
    ['m-2', 'Trust agreement draft v3.txt', 'Contracts', 'Draft revocable living trust agreement.'],
    ['m-3', 'MSA redline round 2.txt', 'Contracts', 'Redline of master services agreement, round 2.'],
    ['m-7', 'Complaint.txt', 'Pleadings', 'Complaint for breach of lease.'],
    ['m-7', 'Answer and affirmative defenses.txt', 'Pleadings', 'Answer filed on behalf of Harborline Properties.'],
    ['m-8', 'Title commitment.txt', 'Research', 'Title commitment and schedule B exceptions.'],
    ['m-4', 'Financial disclosure.txt', 'Court orders', 'Financial disclosure statement.'],
  ];
  const documents = docs.map(([matterId, name, category, text], i) => ({
    id: `d-${i + 1}`,
    matterId,
    name,
    category,
    folder: '',
    description: '',
    authorId: matters.find((m) => m.id === matterId)?.responsibleId || 'u-hartley',
    file: { path: `demo/${i}`, name, type: 'text/plain', size: text.length, demoText: text },
    createdAt: `${addDays(today, -(i * 5 + 3))}T12:00:00.000Z`,
  }));

  const taskLists = [
    {
      id: 'tl-pi',
      name: 'Personal injury intake',
      practiceAreaId: 'pa-pi',
      items: [
        { id: 'tli-1', name: 'Send engagement and contingency agreement', dueOffset: 1, priority: 'high', assignee: 'responsible' },
        { id: 'tli-2', name: 'Collect HIPAA authorizations', dueOffset: 3, priority: 'normal', assignee: 'staff' },
        { id: 'tli-3', name: 'Request police report', dueOffset: 5, priority: 'normal', assignee: 'staff' },
        { id: 'tli-4', name: 'Send preservation letter', dueOffset: 2, priority: 'high', assignee: 'responsible' },
        { id: 'tli-5', name: 'Calendar statute of limitations', dueOffset: 0, priority: 'high', assignee: 'responsible' },
      ],
    },
    {
      id: 'tl-estate',
      name: 'Estate plan',
      practiceAreaId: 'pa-estate',
      items: [
        { id: 'tli-6', name: 'Send asset questionnaire', dueOffset: 1, priority: 'normal', assignee: 'staff' },
        { id: 'tli-7', name: 'Draft trust and pour-over will', dueOffset: 14, priority: 'normal', assignee: 'responsible' },
        { id: 'tli-8', name: 'Schedule signing ceremony', dueOffset: 21, priority: 'normal', assignee: 'staff' },
        { id: 'tli-9', name: 'Prepare funding instructions', dueOffset: 28, priority: 'low', assignee: 'responsible' },
      ],
    },
  ].map((t) => ({ ...t, createdAt: created }));

  const templates = [
    {
      id: 'tpl-engagement',
      name: 'Engagement letter',
      category: 'Correspondence',
      body: `{{today}}

{{client.name}}
{{client.address}}

Re: {{matter.description}} (Matter {{matter.number}})

Dear {{client.first_name}},

Thank you for choosing {{firm.name}}. This letter confirms that we will represent you in the matter described above. {{matter.responsible_lawyer}} will be the lawyer responsible for your matter.

Our fees will be billed as agreed, and you will receive a detailed statement of the work performed. Please review, sign, and return a copy of this letter so we can begin work.

Sincerely,

{{user.name}}
{{firm.name}}
{{firm.address}}
{{firm.phone}}`,
    },
    {
      id: 'tpl-status',
      name: 'Matter status update',
      category: 'Correspondence',
      body: `{{today}}

Dear {{client.first_name}},

I am writing with an update on {{matter.description}}.

[Summarize recent developments and next steps here.]

Please call me at {{firm.phone}} with any questions.

Best regards,

{{user.name}}`,
    },
    {
      id: 'tpl-closing',
      name: 'Matter closing letter',
      category: 'Correspondence',
      body: `{{today}}

Dear {{client.first_name}},

Our work on {{matter.description}} (Matter {{matter.number}}) is complete, and we are closing our file. Thank you for the opportunity to represent you.

We will keep your file for the period required by our records policy. Please contact us if you need copies of any documents.

Sincerely,

{{user.name}}
{{firm.name}}`,
    },
  ].map((t) => ({ ...t, createdAt: created }));

  return {
    settings,
    collections: { users, contacts, matters, activities, bills, payments, transactions, accounts, tasks, events, notes, communications, documents, taskLists, templates },
  };
}

/**
 * A believable demo business: a small home-services company with a team of
 * four, recurring maintenance work, and a pipeline in every stage. Dates are
 * generated relative to `today` so the demo always looks current.
 */
import { addDays, addMonths, startOfWeek, weekday } from './dates.js';
import { newId } from './ids.js';
import { generateVisitDates } from './recurrence.js';
import { TEAM_COLORS } from './format.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const FIRST = ['Maya', 'Daniel', 'Priya', 'Owen', 'Sofia', 'Marcus', 'Elena', 'Jamal', 'Hannah', 'Lucas', 'Grace', 'Theo', 'Amara', 'Noah', 'Ines', 'Caleb', 'Rosa', 'Felix', 'Leila', 'Victor', 'Nora', 'Samuel', 'Aiko', 'Diego'];
const LAST = ['Bennett', 'Okafor', 'Sharma', 'Fitzgerald', 'Moreno', 'Hughes', 'Novak', 'Reyes', 'Lindqvist', 'Park', 'Adeyemi', 'Costa', 'Walsh', 'Nakamura', 'Duarte', 'Kowalski', 'Haddad', 'Brennan', 'Silva', 'Chen'];
const STREETS = ['Maple Ave', 'Cedar Ln', 'Riverside Dr', 'Oak St', 'Willow Way', 'Hillcrest Rd', 'Juniper Ct', 'Lakeview Blvd', 'Birch St', 'Sunset Ave', 'Elm Pl', 'Harbor Rd'];
const CITIES = [
  ['Springfield', 'OR', '97477'],
  ['Eugene', 'OR', '97401'],
  ['Salem', 'OR', '97301'],
  ['Corvallis', 'OR', '97330'],
];
const COMPANIES = ['Northwind Property Group', 'Brightside Dental', 'Harbor View HOA', 'Copperleaf Cafe', 'Summit Fitness'];

export function buildSampleData(today) {
  const rand = rng(20261012);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  // Local wall-clock time on that date, as an ISO timestamp.
  const ts = (iso, hour = 10) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d, hour, Math.floor(rand() * 60)).toISOString();
  };

  const team = [
    { id: newId(), name: 'Alex Morgan', email: 'alex@example.com', phone: '(541) 555-0100', role: 'owner', color: TEAM_COLORS[0], laborRate: 4500, active: true },
    { id: newId(), name: 'Jordan Lee', email: 'jordan@example.com', phone: '(541) 555-0101', role: 'worker', color: TEAM_COLORS[1], laborRate: 3200, active: true },
    { id: newId(), name: 'Sam Rivera', email: 'sam@example.com', phone: '(541) 555-0102', role: 'worker', color: TEAM_COLORS[2], laborRate: 3000, active: true },
    { id: newId(), name: 'Taylor Brooks', email: 'taylor@example.com', phone: '(541) 555-0103', role: 'admin', color: TEAM_COLORS[3], laborRate: 2800, active: true },
  ];
  const crew = team.slice(1, 3);

  const products = [
    { name: 'Lawn mowing', kind: 'service', description: 'Mow, trim, and edge all lawn areas. Clippings blown off hard surfaces.', unitPrice: 6500, unitCost: 1800, taxable: true },
    { name: 'Spring cleanup', kind: 'service', description: 'Remove leaves and debris, cut back perennials, refresh bed edges.', unitPrice: 32500, unitCost: 9000, taxable: true },
    { name: 'Fall cleanup', kind: 'service', description: 'Leaf removal from lawn and beds, gutter check, final mow.', unitPrice: 29500, unitCost: 8500, taxable: true },
    { name: 'Hedge trimming', kind: 'service', description: 'Shape and trim hedges and shrubs up to 8 ft.', unitPrice: 18000, unitCost: 5000, taxable: true },
    { name: 'Mulch installation', kind: 'service', description: 'Supply and spread premium bark mulch, per cubic yard.', unitPrice: 9500, unitCost: 4200, taxable: true },
    { name: 'Gutter cleaning', kind: 'service', description: 'Clear gutters and downspouts, flush and check flow.', unitPrice: 17500, unitCost: 4000, taxable: true },
    { name: 'Irrigation tune-up', kind: 'service', description: 'Inspect zones, adjust heads, set controller schedule.', unitPrice: 12500, unitCost: 2500, taxable: true },
    { name: 'Sprinkler head', kind: 'product', description: 'Pop-up rotor sprinkler head, installed.', unitPrice: 2400, unitCost: 900, taxable: true },
    { name: 'Aeration and overseeding', kind: 'service', description: 'Core aeration with premium seed blend.', unitPrice: 21000, unitCost: 7000, taxable: true },
    { name: 'Labor (per hour)', kind: 'service', description: 'General labor, billed hourly.', unitPrice: 6500, unitCost: 3000, taxable: false },
    { name: 'Snow removal visit', kind: 'service', description: 'Plow driveway and shovel walkways.', unitPrice: 8500, unitCost: 2500, taxable: true },
    { name: 'Disposal fee', kind: 'product', description: 'Green waste disposal, per load.', unitPrice: 4500, unitCost: 3000, taxable: false },
  ].map((p) => ({ id: newId(), active: true, ...p }));
  const product = (name) => products.find((p) => p.name === name);
  const item = (name, qty = 1) => {
    const p = product(name);
    return { id: newId(), productId: p.id, name: p.name, description: p.description, qty, unitPrice: p.unitPrice, unitCost: p.unitCost, taxable: p.taxable };
  };

  const clients = [];
  for (let i = 0; i < 24; i++) {
    const [city, region, postal] = pick(CITIES);
    const first = FIRST[i % FIRST.length];
    const last = LAST[(i * 7) % LAST.length];
    const isCompany = i % 6 === 5;
    const created = addDays(today, -Math.floor(rand() * 300) - 5);
    clients.push({
      id: newId(),
      firstName: first,
      lastName: last,
      company: isCompany ? COMPANIES[(i / 6) | 0] : '',
      useCompanyName: isCompany,
      phones: [{ label: 'Mobile', number: `(541) 555-${String(1200 + i * 37).slice(-4)}` }],
      emails: [{ label: 'Main', address: `${first}.${last}@example.com`.toLowerCase() }],
      properties: [
        {
          id: newId(),
          street1: `${100 + Math.floor(rand() * 8800)} ${pick(STREETS)}`,
          street2: '',
          city,
          region,
          postal,
          country: 'United States',
        },
      ],
      billingSame: true,
      leadSource: pick(['Referral', 'Google', 'Website', 'Repeat client', 'Flyer']),
      tags: i % 4 === 0 ? ['Recurring'] : i % 5 === 0 ? ['Commercial'] : [],
      notes: i === 0 ? 'Gate code 4412. Dog in backyard, friendly.' : '',
      createdAt: ts(created),
      updatedAt: ts(created),
    });
  }

  const jobs = [];
  const quotes = [];
  const invoices = [];
  const payments = [];
  const requests = [];
  let jobNo = 1;
  let quoteNo = 1;
  let invoiceNo = 1;
  let requestNo = 1;

  const mkVisit = (date, start, durMin, assignees, completed) => ({
    id: newId(),
    date,
    start,
    end: start ? addMinutes(start, durMin) : '',
    assignees,
    completedAt: completed ? ts(date, 17) : null,
  });

  // Recurring weekly mowing for six clients.
  for (let i = 0; i < 6; i++) {
    const c = clients[i * 4];
    const start = addDays(startOfWeek(today), -21 + (i % 5) + 1);
    const dates = generateVisitDates({ start, repeat: 'weekly', interval: 1, end: { type: 'count', count: 16 } });
    const hour = 8 + (i % 4) * 2;
    const visits = dates.map((d) => mkVisit(d, `${String(hour).padStart(2, '0')}:00`, 60, [crew[i % 2].id], d < today));
    jobs.push({
      id: newId(),
      number: jobNo++,
      clientId: c.id,
      propertyId: c.properties[0].id,
      title: 'Weekly lawn maintenance',
      instructions: 'Mow front and back, edge driveway and sidewalk. Blow off patio.',
      schedule: { start, repeat: 'weekly', interval: 1, end: { type: 'count', count: 16 }, startTime: `${String(hour).padStart(2, '0')}:00`, endTime: `${String(hour + 1).padStart(2, '0')}:00` },
      assignees: [crew[i % 2].id],
      items: [item('Lawn mowing', 1)],
      billing: 'per_visit',
      visits,
      createdAt: ts(addDays(start, -7)),
    });
  }

  // One-off jobs in all states.
  const oneOffs = [
    { title: 'Spring cleanup and mulch', items: [item('Spring cleanup'), item('Mulch installation', 6)], offset: -18, done: true, invoiced: 'paid' },
    { title: 'Gutter cleaning', items: [item('Gutter cleaning')], offset: -12, done: true, invoiced: 'past_due' },
    { title: 'Hedge trimming, front yard', items: [item('Hedge trimming'), item('Disposal fee')], offset: -9, done: true, invoiced: 'awaiting' },
    { title: 'Irrigation repair', items: [item('Irrigation tune-up'), item('Sprinkler head', 4)], offset: -4, done: true, invoiced: null },
    { title: 'Aeration and overseeding', items: [item('Aeration and overseeding')], offset: -2, done: false, invoiced: null },
    { title: 'Fall cleanup', items: [item('Fall cleanup'), item('Disposal fee', 2)], offset: 0, done: false, invoiced: null },
    { title: 'Backyard regrade', items: [item('Labor (per hour)', 6), item('Disposal fee')], offset: 1, done: false, invoiced: null },
    { title: 'Hedge trimming and cleanup', items: [item('Hedge trimming'), item('Labor (per hour)', 2)], offset: 3, done: false, invoiced: null },
    { title: 'Gutter cleaning', items: [item('Gutter cleaning')], offset: 6, done: false, invoiced: null },
    { title: 'Mulch refresh', items: [item('Mulch installation', 4)], offset: 9, done: false, invoiced: null },
    { title: 'Commercial grounds walkthrough', items: [item('Labor (per hour)', 3)], offset: null, done: false, invoiced: null },
  ];
  oneOffs.forEach((o, i) => {
    const c = clients[(i * 5 + 1) % clients.length];
    const date = o.offset === null ? null : addDays(today, o.offset);
    const hour = 9 + (i % 4) * 2;
    const assignees = [crew[i % 2].id, ...(i % 3 === 0 ? [team[0].id] : [])];
    const quote = {
      id: newId(),
      number: quoteNo++,
      clientId: c.id,
      propertyId: c.properties[0].id,
      title: o.title,
      items: o.items.map((x) => ({ ...x, id: newId() })),
      taxRate: 0,
      status: 'approved',
      sentAt: ts(addDays(date || today, -14)),
      approvedAt: ts(addDays(date || today, -10)),
      createdAt: ts(addDays(date || today, -15)),
    };
    const job = {
      id: newId(),
      number: jobNo++,
      clientId: c.id,
      propertyId: c.properties[0].id,
      title: o.title,
      instructions: '',
      schedule: date ? { start: date, repeat: 'none', startTime: `${String(hour).padStart(2, '0')}:00`, endTime: `${String(hour + 3).padStart(2, '0')}:00` } : { start: null, repeat: 'none' },
      assignees,
      items: o.items,
      billing: 'on_completion',
      quoteId: quote.id,
      visits: date ? [mkVisit(date, `${String(hour).padStart(2, '0')}:00`, 180, assignees, o.done)] : [{ id: newId(), date: null, start: '', end: '', assignees, completedAt: null }],
      createdAt: quote.approvedAt,
    };
    quote.jobId = job.id;
    quotes.push(quote);
    jobs.push(job);
    if (o.invoiced) {
      const issue = addDays(date, 1);
      const inv = {
        id: newId(),
        number: invoiceNo++,
        clientId: c.id,
        propertyId: c.properties[0].id,
        jobIds: [job.id],
        subject: `For services rendered: ${o.title}`,
        items: o.items.map((x) => ({ ...x, id: newId() })),
        taxRate: 0,
        issueDate: issue,
        terms: o.invoiced === 'past_due' ? 'net7' : 'net30',
        dueDate: addDays(issue, o.invoiced === 'past_due' ? 7 : 30),
        sentAt: ts(issue, 16),
        createdAt: ts(issue, 15),
      };
      invoices.push(inv);
      if (o.invoiced === 'paid') {
        const total = inv.items.reduce((s, it) => s + Math.round(it.qty * it.unitPrice), 0);
        payments.push({ id: newId(), invoiceId: inv.id, clientId: c.id, amount: total, method: 'card', date: addDays(issue, 3), reference: '', createdAt: ts(addDays(issue, 3)) });
      }
    }
  });

  // Invoices for completed recurring visits, most paid, a few open.
  for (const job of jobs.filter((j) => j.billing === 'per_visit')) {
    const done = job.visits.filter((v) => v.completedAt);
    done.forEach((v, idx) => {
      const issue = v.date;
      const inv = {
        id: newId(),
        number: invoiceNo++,
        clientId: job.clientId,
        propertyId: job.propertyId,
        jobIds: [job.id],
        visitIds: [v.id],
        subject: `Lawn maintenance, ${issue}`,
        items: job.items.map((x) => ({ ...x, id: newId() })),
        taxRate: 0,
        issueDate: issue,
        terms: 'net15',
        dueDate: addDays(issue, 15),
        sentAt: ts(issue, 18),
        createdAt: ts(issue, 18),
      };
      invoices.push(inv);
      v.invoiceId = inv.id;
      if (idx < done.length - 1 || rand() < 0.4) {
        const method = pick(['card', 'cash', 'check', 'bank']);
        // Paid a few days later, but never after today.
        const paid = addDays(issue, Math.floor(rand() * 6) + 1);
        const date = paid < today ? paid : today;
        payments.push({ id: newId(), invoiceId: inv.id, clientId: job.clientId, amount: 6500, method, date, reference: '', createdAt: ts(date) });
      }
    });
  }

  // Historical revenue over the past months so reports have shape.
  for (let m = 6; m >= 1; m--) {
    const count = 3 + Math.floor(rand() * 4);
    for (let k = 0; k < count; k++) {
      const c = pick(clients);
      const issue = addDays(addMonths(today, -m), Math.floor(rand() * 25) - 12);
      const its = [item(pick(['Spring cleanup', 'Hedge trimming', 'Gutter cleaning', 'Irrigation tune-up', 'Aeration and overseeding', 'Fall cleanup']))];
      const inv = {
        id: newId(),
        number: invoiceNo++,
        clientId: c.id,
        propertyId: c.properties[0].id,
        jobIds: [],
        subject: its[0].name,
        items: its,
        taxRate: 0,
        issueDate: issue,
        terms: 'net30',
        dueDate: addDays(issue, 30),
        sentAt: ts(issue, 12),
        createdAt: ts(issue, 12),
      };
      invoices.push(inv);
      payments.push({ id: newId(), invoiceId: inv.id, clientId: c.id, amount: its[0].qty * its[0].unitPrice, method: pick(['card', 'check', 'bank']), date: addDays(issue, Math.floor(rand() * 12) + 2), reference: '', createdAt: ts(issue) });
    }
  }

  // Quotes waiting on the client, a draft, and one with changes requested.
  const openQuotes = [
    { title: 'Full yard renovation', items: [item('Spring cleanup'), item('Mulch installation', 10), item('Labor (per hour)', 8)], status: 'awaiting_response', sent: -5 },
    { title: 'Seasonal maintenance package', items: [item('Spring cleanup'), item('Fall cleanup'), { ...item('Aeration and overseeding'), optional: true }], status: 'awaiting_response', sent: -2 },
    { title: 'Irrigation system upgrade', items: [item('Irrigation tune-up'), item('Sprinkler head', 12)], status: 'changes_requested', sent: -8 },
    { title: 'Snow removal, winter season', items: [item('Snow removal visit', 10)], status: 'draft', sent: null },
    { title: 'Hedge and tree trimming', items: [item('Hedge trimming', 2), item('Disposal fee')], status: 'approved', sent: -3 },
  ];
  openQuotes.forEach((q, i) => {
    const c = clients[(i * 3 + 2) % clients.length];
    quotes.push({
      id: newId(),
      number: quoteNo++,
      clientId: c.id,
      propertyId: c.properties[0].id,
      title: q.title,
      items: q.items,
      taxRate: 0,
      status: q.status,
      sentAt: q.sent === null ? null : ts(addDays(today, q.sent)),
      approvedAt: q.status === 'approved' ? ts(addDays(today, -1)) : null,
      message: '',
      createdAt: ts(addDays(today, (q.sent ?? 0) - 1)),
    });
  });

  // Incoming requests.
  const reqs = [
    { title: 'Leaves everywhere, need a cleanup', details: 'Large maple tree out front. Would like leaves cleared from lawn and gutters before the rain.', assess: null, offset: 0 },
    { title: 'Quote for weekly mowing', details: 'About a quarter acre, front and back. Looking to start next spring.', assess: null, offset: -1 },
    { title: 'Drainage issue in backyard', details: 'Water pools by the fence after heavy rain. Need someone to look at grading.', assess: 2, offset: -3 },
    { title: 'Commercial landscape contract', details: 'Three buildings, monthly service. Please send a proposal.', assess: -1, offset: -6 },
    { title: 'Sprinkler not turning on', details: 'Zone 3 stopped working last week.', assess: -4, done: true, offset: -8 },
  ];
  reqs.forEach((r, i) => {
    const c = clients[(i * 5 + 3) % clients.length];
    requests.push({
      id: newId(),
      number: requestNo++,
      clientId: c.id,
      propertyId: c.properties[0].id,
      title: r.title,
      details: r.details,
      source: pick(['Website', 'Phone', 'Email']),
      availability: { dates: [addDays(today, 3), addDays(today, 5)], times: ['morning'] },
      assessment: r.assess === null ? null : { date: addDays(today, r.assess), start: '10:00', end: '11:00', assignees: [team[0].id], completedAt: r.done ? ts(addDays(today, r.assess), 11) : null },
      createdAt: ts(addDays(today, r.offset), 9 + i),
    });
  });

  // Expenses and time entries.
  const expenses = [];
  const cats = ['Materials', 'Fuel', 'Equipment', 'Disposal'];
  for (let i = 0; i < 14; i++) {
    const date = addDays(today, -Math.floor(rand() * 40));
    const cat = pick(cats);
    const job = rand() < 0.5 ? pick(jobs) : null;
    expenses.push({
      id: newId(),
      date,
      title: { Materials: 'Bark mulch, 6 yards', Fuel: 'Truck fuel', Equipment: 'Trimmer line and blades', Disposal: 'Green waste dump fee' }[cat],
      category: cat === 'Disposal' ? 'Other' : cat,
      amount: Math.round((20 + rand() * 180) * 100),
      jobId: job?.id || null,
      paidBy: pick(team).id,
      notes: '',
      createdAt: ts(date),
    });
  }

  const timeEntries = [];
  for (let d = -13; d <= 0; d++) {
    const date = addDays(today, d);
    const wd = weekday(date);
    if (wd === 0 || wd === 6) continue;
    for (const m of crew) {
      const startH = 7 + Math.floor(rand() * 2);
      const lengthMin = 7 * 60 + Math.floor(rand() * 90);
      if (d === 0) {
        // Today: one person is still on the clock.
        if (m === crew[0]) timeEntries.push({ id: newId(), memberId: m.id, date, start: `${date}T${String(startH).padStart(2, '0')}:00`, end: null, jobId: null, notes: '', createdAt: ts(date) });
        continue;
      }
      timeEntries.push({
        id: newId(),
        memberId: m.id,
        date,
        start: `${date}T${String(startH).padStart(2, '0')}:00`,
        end: `${date}T${addMinutes(`${String(startH).padStart(2, '0')}:00`, lengthMin)}`,
        jobId: null,
        notes: '',
        createdAt: ts(date),
      });
    }
  }

  const events = [
    { id: newId(), kind: 'task', title: 'Order mulch for next week', date: addDays(today, 1), start: '', end: '', assignees: [team[3].id], completedAt: null, notes: '' },
    { id: newId(), kind: 'event', title: 'Equipment service at dealer', date: addDays(today, 2), start: '13:00', end: '15:00', assignees: [team[0].id], completedAt: null, notes: '' },
    { id: newId(), kind: 'task', title: 'Follow up on irrigation quote', date: today, start: '', end: '', assignees: [team[0].id], completedAt: null, notes: '' },
  ];

  const settings = {
    company: {
      name: 'Greenline Outdoor Services',
      phone: '(541) 555-0199',
      email: 'hello@greenline.example',
      website: 'greenline.example',
      address: '410 Mill St, Springfield, OR 97477',
      taxId: '',
    },
    taxes: [{ id: 'tax-state', name: 'Sales tax', rate: 0 }],
    defaultTaxId: null,
    onboarded: true,
  };

  return { settings, collections: { team, products, clients, jobs, quotes, invoices, payments, requests, expenses, timeEntries, events } };
}

function addMinutes(time, min) {
  const [h, m] = time.split(':').map(Number);
  const t = Math.min(23 * 60 + 59, h * 60 + m + min);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

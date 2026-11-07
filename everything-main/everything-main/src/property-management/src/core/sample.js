/**
 * A realistic sample portfolio for the demo and for "Load sample data":
 * five properties, a year of rent history posted through the same logic the
 * app uses, vendor bills, work orders, tasks, applicants and listings. All
 * dates are relative to `today` so the demo always looks current.
 */
import { ACC, defaultAccounts } from './accounts.js';
import { defaultSettings, mergeSettings } from './settings.js';
import { addDays, addMonths, pad } from './dates.js';
import { computeIndex, buildCharge, buildPayment, buildBill, buildBillPayment, buildExpense, buildOwnerTransaction, suggestAllocation } from './ledger.js';
import { computePostings, newRecurring } from './leases.js';

function rng(seed = 7) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Maya', 'Jonah', 'Priya', 'Luis', 'Hannah', 'Omar', 'Grace', 'Theo', 'Imani', 'Caleb', 'Sofia', 'Ethan', 'Nadia', 'Marcus', 'Leah', 'Ravi', 'Chloe', 'Daniel', 'Aisha', 'Felix', 'Rosa', 'Kenji', 'Bianca', 'Samuel'];
const LAST = ['Alvarez', 'Bennett', 'Chandra', 'Delgado', 'Ellison', 'Farouk', 'Gallagher', 'Huang', 'Ibarra', 'Jensen', 'Kowalski', 'Lindqvist', 'Moreau', 'Nakamura', 'Okafor', 'Petrov', 'Quintero', 'Russo', 'Sandoval', 'Tanaka', 'Underwood', 'Varga', 'Whitfield', 'Yilmaz'];

let counter = 0;
const sid = (p) => `s${p}${(++counter).toString(36).padStart(4, '0')}`;

export function buildSampleData(today) {
  counter = 0;
  const rand = rng(11);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const monthStart = `${today.slice(0, 7)}-01`;

  const settings = mergeSettings(defaultSettings(), {
    company: { name: 'Brightside Property Co.', phone: '(503) 555-0142', email: 'office@brightside.example', website: 'brightside.example', address: '410 SW Alder St, Suite 300\nPortland, OR 97204' },
    onboarded: true,
  });
  const accounts = defaultAccounts();

  const team = [
    { id: 'tm-1', name: 'Jordan Ellis', role: 'Property manager', email: 'jordan@brightside.example', phone: '(503) 555-0170', color: '#1f5bd0' },
    { id: 'tm-2', name: 'Casey Romero', role: 'Leasing agent', email: 'casey@brightside.example', phone: '(503) 555-0171', color: '#0f7b6c' },
    { id: 'tm-3', name: 'Morgan Price', role: 'Maintenance coordinator', email: 'morgan@brightside.example', phone: '(503) 555-0172', color: '#b4441c' },
  ];

  const owners = [
    { id: 'ow-1', kind: 'person', firstName: 'Elena', lastName: 'Marsh', emails: ['elena.marsh@example.com'], phones: ['(503) 555-0110'], address: { street: '88 NW Hoyt St', city: 'Portland', state: 'OR', zip: '97209' }, managementFee: 8, agreementStart: addMonths(today, -30) },
    { id: 'ow-2', kind: 'company', company: 'Northgate Holdings LLC', firstName: 'Victor', lastName: 'Hale', emails: ['accounts@northgate.example'], phones: ['(503) 555-0111'], address: { street: '1200 NE Broadway', city: 'Portland', state: 'OR', zip: '97232' }, managementFee: 7, agreementStart: addMonths(today, -40) },
    { id: 'ow-3', kind: 'person', firstName: 'Samir', lastName: 'Okonkwo', emails: ['samir.o@example.com'], phones: ['(503) 555-0112'], address: { street: '15 Garden Way', city: 'Beaverton', state: 'OR', zip: '97005' }, managementFee: 10, agreementStart: addMonths(today, -18) },
  ];

  const P = (id, name, type, street, city, zip, ownerIds, extra = {}) => ({
    id,
    name,
    type,
    address: { street, city, state: 'OR', zip },
    owners: ownerIds.map(([ownerId, pct]) => ({ ownerId, pct })),
    managerId: 'tm-1',
    bankAccountId: ACC.operating,
    reserve: 100000,
    active: true,
    yearBuilt: 1990 + Math.floor(rand() * 30),
    ...extra,
  });

  const properties = [
    P('pr-maple', 'Maple Court Apartments', 'multi-family', '2215 SE Maple St', 'Portland', '97214', [['ow-2', 100]], { description: 'Two-story garden apartments around a shared courtyard, with on-site laundry and covered bike storage.', amenities: ['Laundry room', 'Bike storage', 'Courtyard', 'Off-street parking'] }),
    P('pr-harbor', 'Harbor View Duplex', 'multi-family', '730 N Harbor Dr', 'Portland', '97217', [['ow-1', 100]], { description: 'Side-by-side duplex with river views and private yards.', amenities: ['Private yard', 'Garage'] }),
    P('pr-linden', '14 Linden Lane', 'single-family', '14 Linden Ln', 'Beaverton', '97005', [['ow-3', 100]], { singleUnit: true, description: 'Three-bedroom craftsman on a quiet street near parks and schools.', amenities: ['Fenced yard', 'Dishwasher', 'Fireplace'] }),
    P('pr-cedar', 'Cedar Row Townhomes', 'townhome', '501 Cedar Row', 'Lake Oswego', '97034', [['ow-1', 60], ['ow-3', 40]], { description: 'Four modern townhomes with attached garages.', amenities: ['Attached garage', 'Washer and dryer', 'Patio'] }),
    P('pr-river', 'Riverside Commerce Center', 'retail', '1840 SE Water Ave', 'Portland', '97214', [['ow-2', 100]], { description: 'Street-level retail suites in a busy riverfront district.', amenities: ['Storefront signage', 'Loading area'] }),
  ];

  const units = [];
  const U = (propertyId, name, beds, baths, sqft, marketRent, extra = {}) => {
    const u = { id: sid('u'), propertyId, name, beds, baths, sqft, marketRent, ...extra };
    units.push(u);
    return u;
  };
  for (const [floor, letters] of [['1', 'ABCD'], ['2', 'ABCD']]) for (const l of letters) U('pr-maple', `${floor}${l}`, l === 'A' || l === 'D' ? 2 : 1, 1, l === 'A' || l === 'D' ? 860 : 640, l === 'A' || l === 'D' ? 165000 : 129500);
  U('pr-harbor', 'North', 2, 1.5, 1050, 189500);
  U('pr-harbor', 'South', 2, 1.5, 1050, 189500);
  U('pr-linden', 'Home', 3, 2, 1620, 245000);
  for (const n of ['501', '503', '505', '507']) U('pr-cedar', n, 3, 2.5, 1480, 235000);
  U('pr-river', 'Suite 100', 0, 1, 1800, 360000);
  U('pr-river', 'Suite 110', 0, 1, 1200, 255000);
  U('pr-river', 'Suite 120', 0, 1, 950, 210000);

  const tenants = [];
  const usedNames = new Set();
  const person = () => {
    let first;
    let last;
    do {
      first = pick(FIRST);
      last = pick(LAST);
    } while (usedNames.has(first + last));
    usedNames.add(first + last);
    const t = {
      id: sid('t'),
      firstName: first,
      lastName: last,
      emails: [`${first}.${last}@example.com`.toLowerCase()],
      phones: [`(503) 555-${String(1000 + Math.floor(rand() * 8999))}`],
      emergency: { name: `${pick(FIRST)} ${last}`, phone: `(503) 555-${String(1000 + Math.floor(rand() * 8999))}`, relation: pick(['Parent', 'Sibling', 'Partner', 'Friend']) },
    };
    tenants.push(t);
    return t;
  };

  // Which units are vacant (with a listing), and lease shapes for the rest.
  const vacant = new Set([units[3].id, units[7].id, units[17].id]);
  const leases = [];
  let leaseNo = 1000;
  const late = new Set(); // leases that pay late or not at all recently
  units.forEach((u, i) => {
    if (vacant.has(u.id)) return;
    const commercial = u.propertyId === 'pr-river';
    const monthsAgo = 2 + Math.floor(rand() * 20);
    const start = addMonths(monthStart, -monthsAgo);
    const term = commercial ? 36 : 12;
    const end = addDays(addMonths(start, term), -1);
    const rent = Math.round((u.marketRent * (0.92 + rand() * 0.08)) / 500) * 500;
    const people = commercial ? [person()] : rand() < 0.4 ? [person(), person()] : [person()];
    if (commercial) {
      const t = people[0];
      t.company = pick(['Northwind Coffee Roasters', 'Fern & Field Florals']);
    }
    const type = commercial ? 'fixed' : rand() < 0.15 ? 'at-will' : 'fixed-rollover';
    const lease = {
      id: sid('l'),
      number: ++leaseNo,
      propertyId: u.propertyId,
      unitId: u.id,
      tenantIds: people.map((p) => p.id),
      type,
      start,
      end: type === 'at-will' ? null : end,
      deposit: commercial ? rent * 2 : rent,
      recurring: [newRecurring({ accountId: ACC.rent, amount: rent, day: 1, start })],
      lateFee: { enabled: false },
      signedOn: addDays(start, -12),
    };
    if (u.propertyId === 'pr-maple' && i % 3 === 0) lease.recurring.push(newRecurring({ accountId: 'acc-parking', amount: 7500, day: 1, start, memo: 'Parking space' }));
    if (u.propertyId === 'pr-cedar' && i % 2 === 0) lease.recurring.push(newRecurring({ accountId: 'acc-pet-fees', amount: 3500, day: 1, start, memo: 'Pet rent' }));
    if (i === 1 || i === 9 || i === 13) late.add(lease.id);
    leases.push(lease);
  });
  // One future lease (signed, moves in next month) on a vacant Maple unit.
  {
    const u = units[7];
    const start = addMonths(monthStart, 1);
    const t = person();
    leases.push({
      id: sid('l'),
      number: ++leaseNo,
      propertyId: u.propertyId,
      unitId: u.id,
      tenantIds: [t.id],
      type: 'fixed-rollover',
      start,
      end: addDays(addMonths(start, 12), -1),
      deposit: 129500,
      recurring: [newRecurring({ accountId: ACC.rent, amount: 129500, day: 1, start })],
      lateFee: { enabled: false },
      signedOn: addDays(today, -6),
    });
    vacant.delete(u.id);
  }
  // A past lease, to show history on a currently vacant unit.
  {
    const u = units[3];
    const start = addMonths(monthStart, -14);
    const t = person();
    leases.push({
      id: sid('l'),
      number: ++leaseNo,
      propertyId: u.propertyId,
      unitId: u.id,
      tenantIds: [t.id],
      type: 'fixed',
      start,
      end: addDays(addMonths(start, 12), -1),
      deposit: 125000,
      recurring: [newRecurring({ accountId: ACC.rent, amount: 125000, day: 1, start })],
      lateFee: { enabled: false },
      moveOut: { date: addDays(addMonths(start, 12), -1), noticeDate: addMonths(start, 10), reason: 'Relocating for work' },
    });
  }
  // Renewal pipeline: a few leases ending soon with different statuses.
  const expiring = leases.filter((l) => l.type === 'fixed-rollover').slice(0, 4);
  expiring.forEach((l, i) => {
    l.start = addMonths(monthStart, -11 + i * 0);
    l.end = addDays(addMonths(l.start, 12), 15 + i * 20);
    l.recurring[0].start = l.start;
    for (const r of l.recurring) r.start = l.start;
    l.renewal = [{ status: 'not-started' }, { status: 'offered', offerRent: Math.round(l.recurring[0].amount * 1.03), offerEnd: addMonths(l.end, 12), offeredOn: addDays(today, -9) }, { status: 'accepted', offerRent: Math.round(l.recurring[0].amount * 1.025), offerEnd: addMonths(l.end, 12) }, { status: 'declined', notes: 'Buying a home' }][i];
  });

  // ---- Ledger --------------------------------------------------------------
  const txs = [];
  const add = (t) => (txs.push(t), t);
  const accountsById = new Map(accounts.map((a) => [a.id, a]));

  // Security deposits charged and paid at move-in.
  for (const l of leases) {
    if (l.start > today) continue;
    const date = l.signedOn || l.start;
    add(buildCharge({ lease: l, date, memo: 'Security deposit', items: [{ accountId: ACC.depositsHeld, amount: l.deposit }] }));
    add(buildPayment({ lease: l, date, amount: l.deposit, method: 'check', ref: String(2000 + Math.floor(rand() * 7000)), bankAccountId: ACC.depositsBank, allocations: [{ accountId: ACC.depositsHeld, amount: l.deposit }], memo: 'Security deposit' }));
  }

  // Monthly charges through today, using the real posting logic.
  const base = computePostings({ leases, index: computeIndex([]), settings: { ...settings, lateFee: { enabled: false } }, today, accountsById });
  for (const t of base.transactions) add(t);
  for (const [id, ch] of base.leasePatches) Object.assign(leases.find((l) => l.id === id), ch);

  // Payments: most pay in the first days of the month; a few are behind.
  for (const l of leases) {
    const charges = txs.filter((t) => t.leaseId === l.id && t.kind === 'charge' && t.auto).sort((a, b) => (a.date < b.date ? -1 : 1));
    const byMonth = new Map();
    const owedByMonth = new Map(); // month -> Map(accountId -> cents)
    for (const c of charges) {
      const m = c.date.slice(0, 7);
      byMonth.set(m, (byMonth.get(m) || 0) + c.lines[0].amount);
      if (!owedByMonth.has(m)) owedByMonth.set(m, new Map());
      const owed = owedByMonth.get(m);
      owed.set(c.lines[0].forAccountId, (owed.get(c.lines[0].forAccountId) || 0) + c.lines[0].amount);
    }
    const months = [...byMonth.keys()];
    months.forEach((m, idx) => {
      const isLast = idx === months.length - 1;
      const isPrev = idx === months.length - 2;
      if (late.has(l.id) && (isLast || (isPrev && l.id === [...late][0]))) return; // unpaid
      let amount = byMonth.get(m);
      if (late.has(l.id) && idx === months.length - 3) amount = Math.round(amount * 0.6);
      const day = late.has(l.id) ? 6 + Math.floor(rand() * 8) : 1 + Math.floor(rand() * 4);
      const date = `${m}-${pad(day)}`;
      if (date > today) return;
      // Pay that month's charges (not later ones), as a tenant would.
      const owed = owedByMonth.get(m);
      add(
        buildPayment({
          lease: l,
          date,
          amount,
          method: pick(['check', 'ach', 'ach', 'online', 'money-order']),
          ref: String(1000 + Math.floor(rand() * 9000)),
          allocations: suggestAllocation(owed, amount, accountsById),
          memo: 'Rent payment',
        }),
      );
    });
  }

  // Late fees where rent was late, computed from the history above.
  const lateLeases = leases.map((l) => (late.has(l.id) ? { ...l, lateFee: { enabled: true } } : l));
  const fees = computePostings({ leases: lateLeases, index: computeIndex(txs), settings, today, accountsById });
  for (const t of fees.transactions) if (t.id.startsWith('lf-')) add(t);
  for (const [id, ch] of fees.leasePatches) if (ch.lateFeesThrough) leases.find((l) => l.id === id).lateFeesThrough = ch.lateFeesThrough;
  for (const l of leases) l.lateFee = late.has(l.id) ? { enabled: true } : {};

  // ---- Vendors, bills, expenses ------------------------------------------------
  const V = (id, company, category, accountId, first, last) => ({
    id,
    company,
    firstName: first,
    lastName: last,
    category,
    accountId,
    emails: [`${company.split(' ')[0].toLowerCase()}@vendors.example`],
    phones: [`(503) 555-${String(2000 + Math.floor(rand() * 7000))}`],
    insuranceExpires: addMonths(today, Math.floor(rand() * 14) - 2),
    active: true,
  });
  const vendors = [
    V('vn-flow', 'FlowRight Plumbing', 'Plumbing', ACC.repairs, 'Tess', 'Romero'),
    V('vn-volt', 'Voltline Electric', 'Electrical', ACC.repairs, 'Dev', 'Sharma'),
    V('vn-green', 'Greenleaf Grounds', 'Landscaping', 'acc-landscaping', 'Paulo', 'Reyes'),
    V('vn-shine', 'Shine Turnover Cleaning', 'Cleaning', 'acc-cleaning', 'Mina', 'Cho'),
    V('vn-cascade', 'Cascade Mutual Insurance', 'Insurance', 'acc-insurance', 'Agent', 'Desk'),
    V('vn-pdx', 'City Water and Sewer', 'Utilities', 'acc-utilities', null, null),
    V('vn-cool', 'Coolbreeze HVAC', 'HVAC', ACC.repairs, 'Ari', 'Benson'),
    V('vn-fix', 'Handy Hands Repair', 'General contractor', ACC.repairs, 'Lou', 'Garcia'),
  ];

  const bills = [];
  const B = (vendorId, date, dueDate, items, memo, ref) => {
    const b = add(buildBill({ vendorId, date, dueDate, items, memo, ref }));
    bills.push(b);
    return b;
  };
  for (let m = -5; m <= 0; m++) {
    const d = addMonths(monthStart, m);
    B('vn-green', addDays(d, 2), addDays(d, 32), [{ accountId: 'acc-landscaping', amount: 42000, propertyId: 'pr-maple' }, { accountId: 'acc-landscaping', amount: 18000, propertyId: 'pr-cedar' }], 'Monthly grounds service', `GL-${4100 + m + 10}`);
    B('vn-pdx', addDays(d, 9), addDays(d, 30), [{ accountId: 'acc-utilities', amount: 61000 + Math.floor(rand() * 9000), propertyId: 'pr-maple' }, { accountId: 'acc-utilities', amount: 14000 + Math.floor(rand() * 4000), propertyId: 'pr-harbor' }], 'Water and sewer', `WS-${88200 + m + 10}`);
  }
  B('vn-cascade', addMonths(monthStart, -3), addDays(today, 18), [{ accountId: 'acc-insurance', amount: 284000, propertyId: 'pr-maple' }, { accountId: 'acc-insurance', amount: 96000, propertyId: 'pr-linden' }], 'Annual property insurance', 'POL-77120');
  B('vn-flow', addDays(today, -26), addDays(today, -6), [{ accountId: ACC.repairs, amount: 38500, propertyId: 'pr-maple', unitId: units[1].id, memo: 'Replace kitchen faucet cartridge' }], 'Kitchen faucet repair', 'FR-2291');
  B('vn-shine', addDays(today, -12), addDays(today, 3), [{ accountId: 'acc-cleaning', amount: 32500, propertyId: 'pr-maple', unitId: units[3].id, memo: 'Move-out clean' }], 'Unit turnover clean', 'ST-551');
  B('vn-cool', addDays(today, -4), addDays(today, 26), [{ accountId: ACC.repairs, amount: 74000, propertyId: 'pr-cedar', unitId: units[13].id }], 'Furnace igniter replacement', 'CB-1180');

  // Pay the older bills.
  for (const b of bills) {
    if (b.dueDate > addDays(today, -10) || b.ref === 'FR-2291') continue;
    const total = -b.lines.filter((l) => l.accountId === ACC.ap).reduce((s, l) => s + l.amount, 0);
    add(buildBillPayment({ vendorId: b.vendorId, date: addDays(b.dueDate, -3), method: 'check', ref: String(5100 + bills.indexOf(b)), allocations: [{ billId: b.id, amount: total }], bills: new Map([[b.id, b]]) }));
  }
  add(buildExpense({ payee: 'Hardware Depot', date: addDays(today, -15), method: 'card', items: [{ accountId: 'acc-supplies', amount: 8750, propertyId: 'pr-maple', memo: 'Light bulbs and filters' }], memo: 'Maintenance supplies' }));
  // Monthly owner draws: most of each month's rent goes to the owners on the
  // 10th of the next month, split by ownership, keeping a cushion in the bank.
  for (let m = -24; m <= -1; m++) {
    const month = addMonths(monthStart, m).slice(0, 7);
    const payDate = `${addMonths(monthStart, m + 1).slice(0, 7)}-10`;
    if (payDate > today) continue;
    for (const p of properties) {
      let rent = 0;
      for (const t of txs) if (t.kind === 'charge' && t.auto && t.propertyId === p.id && t.date.startsWith(month)) rent += t.lines[0].amount;
      const draw = Math.round((rent * 0.75) / 10000) * 10000;
      if (!draw) continue;
      for (const o of p.owners) add(buildOwnerTransaction({ kind: 'distribution', ownerId: o.ownerId, propertyId: p.id, date: payDate, amount: Math.round((draw * o.pct) / 100), method: 'ach', memo: `Owner draw for ${month}` }));
    }
  }
  add(buildOwnerTransaction({ kind: 'contribution', ownerId: 'ow-3', propertyId: 'pr-linden', date: addMonths(monthStart, -4), amount: 150000, method: 'check', memo: 'Reserve top-up' }));

  // ---- Maintenance and tasks -------------------------------------------------------
  const occupied = (unitId) => leases.find((l) => l.unitId === unitId && l.start <= today && !l.moveOut);
  const tenantOf = (unitId) => occupied(unitId)?.tenantIds?.[0] || null;
  let woNo = 0;
  const WO = (title, unit, vendorId, status, priority, dueOffset, description, extra = {}) => ({
    id: sid('w'),
    number: ++woNo,
    title,
    description,
    propertyId: unit.propertyId,
    unitId: unit.id,
    vendorId,
    assigneeId: 'tm-3',
    status,
    priority,
    dueDate: addDays(today, dueOffset),
    entry: 'allowed',
    requestedBy: tenantOf(unit.id),
    ...extra,
  });
  const workOrders = [
    WO('Kitchen faucet dripping', units[1], 'vn-flow', 'completed', 'normal', -20, 'Constant drip from the kitchen faucet. Tenant says it started last week.', { completedOn: addDays(today, -21), cost: 38500 }),
    WO('Furnace not igniting', units[13], 'vn-cool', 'in-progress', 'urgent', 1, 'No heat since this morning. Pilot will not stay lit.'),
    WO('Bathroom fan noisy', units[5], 'vn-volt', 'assigned', 'low', 9, 'Exhaust fan rattles loudly when running.'),
    WO('Turnover: paint and patch', units[3], 'vn-fix', 'in-progress', 'normal', 4, 'Patch nail holes, paint living room and bedroom, replace two blinds.'),
    WO('Gutter cleaning', units[11], 'vn-green', 'new', 'normal', 14, 'Seasonal gutter cleaning for all four townhomes.', { unitId: null }),
    WO('Storefront door closer', units[16], 'vn-fix', 'new', 'high', 2, 'Door slams shut; closer arm needs adjusting or replacing.'),
  ];

  let taskNo = 0;
  const T = (title, kind, status, priority, dueOffset, extra = {}) => ({ id: sid('k'), number: ++taskNo, title, kind, status, priority, dueDate: dueOffset === null ? null : addDays(today, dueOffset), assigneeId: 'tm-1', category: 'General', ...extra });
  const tasks = [
    T('Hallway light out near unit 2C', 'resident', 'new', 'normal', 3, { propertyId: 'pr-maple', unitId: units[6].id, tenantId: tenantOf(units[6].id), category: 'Maintenance', description: 'The ceiling light outside 2C has been out for two days.' }),
    T('Question about parking space', 'resident', 'new', 'low', 5, { propertyId: 'pr-maple', unitId: units[0].id, tenantId: tenantOf(units[0].id), category: 'Lease question', description: 'Can I switch to a covered space?' }),
    T('Send renewal offers for expiring leases', 'todo', 'in-progress', 'high', 2, { category: 'General' }),
    T('Review Q3 owner statements', 'owner', 'new', 'normal', 7, { ownerId: 'ow-2', category: 'General' }),
    T('Schedule annual smoke detector checks', 'todo', 'new', 'normal', 21, { propertyId: 'pr-cedar', category: 'Inspection' }),
    T('Follow up on late rent', 'todo', 'new', 'high', -1, { leaseId: [...late][0], category: 'Payment question' }),
    T('Update insurance certificate for Voltline', 'todo', 'completed', 'low', -10, { category: 'General' }),
  ];

  const applicants = [
    { id: sid('a'), firstName: 'Iris', lastName: 'Calloway', email: 'iris.calloway@example.com', phone: '(503) 555-3301', unitId: units[3].id, propertyId: 'pr-maple', status: 'new', appliedOn: addDays(today, -1), moveIn: addDays(today, 20), income: 620000, employer: 'Riverbend Clinic', source: 'Listing site' },
    { id: sid('a'), firstName: 'Mateo', lastName: 'Fischer', email: 'mateo.f@example.com', phone: '(503) 555-3302', unitId: units[3].id, propertyId: 'pr-maple', status: 'screening', appliedOn: addDays(today, -4), moveIn: addDays(today, 14), income: 540000, employer: 'Pine Street Studio', source: 'Website' },
    { id: sid('a'), firstName: 'Ruth', lastName: 'Adeyemi', email: 'ruth.a@example.com', phone: '(503) 555-3303', unitId: units[17].id, propertyId: 'pr-river', status: 'approved', appliedOn: addDays(today, -9), moveIn: addDays(today, 30), income: 1500000, employer: 'Adeyemi Tailoring', source: 'Sign' },
    { id: sid('a'), firstName: 'Colin', lastName: 'Barrow', email: 'colin.b@example.com', phone: '(503) 555-3304', unitId: units[3].id, propertyId: 'pr-maple', status: 'rejected', appliedOn: addDays(today, -15), moveIn: addDays(today, 5), income: 210000, source: 'Walk-in' },
  ];

  // Listings on vacant units.
  for (const u of units) {
    if (u.id === units[3].id) u.listing = { listed: true, rent: u.marketRent, available: addDays(today, 7), description: 'Bright one-bedroom on the first floor, freshly painted, steps from the courtyard.', listedOn: addDays(today, -10) };
    if (u.id === units[17].id) u.listing = { listed: true, rent: u.marketRent, available: today, description: 'Corner retail suite with large windows and rear loading access.', listedOn: addDays(today, -30) };
  }

  const events = [
    { id: sid('e'), title: 'Annual fire inspection', date: addDays(today, 6), start: '10:00', end: '12:00', propertyId: 'pr-maple', notes: 'Fire marshal walkthrough of common areas.' },
    { id: sid('e'), title: 'Owner meeting with Northgate', date: addDays(today, 3), start: '14:00', end: '15:00', propertyId: null },
  ];

  const inspections = [
    { id: sid('i'), propertyId: 'pr-maple', unitId: units[3].id, type: 'move-out', date: addDays(today, -13), inspectorId: 'tm-3', status: 'completed', areas: [{ name: 'Living room', condition: 'fair', notes: 'Nail holes, scuffed wall by door' }, { name: 'Kitchen', condition: 'good', notes: '' }, { name: 'Bedroom', condition: 'fair', notes: 'Blinds damaged' }, { name: 'Bathroom', condition: 'good', notes: '' }] },
  ];

  const budgets = [
    {
      id: `bg-pr-maple-${today.slice(0, 4)}`,
      propertyId: 'pr-maple',
      year: Number(today.slice(0, 4)),
      lines: [
        { accountId: ACC.rent, monthly: 1100000 },
        { accountId: 'acc-parking', monthly: 22500 },
        { accountId: ACC.repairs, monthly: 60000 },
        { accountId: 'acc-utilities', monthly: 70000 },
        { accountId: 'acc-landscaping', monthly: 42000 },
        { accountId: 'acc-insurance', monthly: 24000 },
      ],
    },
  ];

  const messages = [
    { id: sid('m'), kind: 'announcement', subject: 'Water shutoff Thursday morning', body: 'Water will be off from 9 to 11 AM on Thursday for a valve replacement. Thank you for your patience.', to: [{ name: 'All residents, Maple Court Apartments', email: '' }], propertyId: 'pr-maple', at: `${addDays(today, -8)}T16:20:00.000Z`, status: 'logged' },
  ];

  const stamp = `${addDays(today, -400)}T12:00:00.000Z`;
  // Requests and work orders were opened about a week before they are due.
  const recent = (due) => `${due && addDays(due, -7) < today ? addDays(due, -7) : addDays(today, -2)}T15:00:00.000Z`;
  const withStamps = (list) => list.map((r) => ({ createdAt: stamp, updatedAt: stamp, ...r }));

  return {
    settings,
    collections: {
      accounts: withStamps(accounts),
      team: withStamps(team),
      owners: withStamps(owners),
      properties: withStamps(properties),
      units: withStamps(units),
      tenants: withStamps(tenants),
      leases: withStamps(leases),
      vendors: withStamps(vendors),
      workOrders: withStamps(workOrders.map((w) => ({ createdAt: recent(w.dueDate), ...w }))),
      tasks: withStamps(tasks.map((t) => ({ createdAt: recent(t.dueDate), ...t }))),
      applicants: withStamps(applicants),
      events: withStamps(events),
      inspections: withStamps(inspections),
      budgets: withStamps(budgets),
      messages: withStamps(messages),
      transactions: withStamps(txs),
    },
  };
}

/**
 * A realistic sample fleet for the demo and for "Load sample data".
 * Deterministic (seeded) and relative to `today`, so it always looks
 * current: recent fuel, upcoming reminders, a few things overdue.
 */
import { addDays, addMonths, diffDays } from './dates.js';
import { defaultSettings, mergeSettings } from './settings.js';
import { fuelTotal } from './fuel.js';
import { starterForm } from './inspections.js';

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

export function buildSampleData(today, { seed = 7 } = {}) {
  const rand = rng(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const between = (a, b) => a + rand() * (b - a);
  let n = 0;
  const id = (p) => `s${p}${(++n).toString(36).padStart(4, '0')}`;
  const ts = `${today}T08:00:00.000Z`;
  const stamp = (r) => ({ createdAt: ts, updatedAt: ts, ...r });

  const groups = [
    { id: 'g-north', name: 'North depot' },
    { id: 'g-south', name: 'South depot' },
    { id: 'g-yard', name: 'Yard and warehouse' },
  ];

  const settings = mergeSettings(defaultSettings(), {
    company: { name: 'Riverside Logistics' },
    groups,
    numbering: { issue: 1, workOrder: 1, purchaseOrder: 1 },
    onboarded: true,
  });

  // ---- Contacts ----
  const people = [
    ['Maya', 'Okafor', ['manager', 'employee'], 'g-north'],
    ['Daniel', 'Reyes', ['operator', 'employee'], 'g-north'],
    ['Priya', 'Natarajan', ['operator', 'employee'], 'g-south'],
    ['Tom', 'Becker', ['operator', 'employee'], 'g-south'],
    ['Lena', 'Kowalski', ['operator', 'employee'], 'g-north'],
    ['Sam', 'Whitfield', ['technician', 'employee'], 'g-yard'],
    ['Grace', 'Liu', ['technician', 'employee'], 'g-yard'],
    ['Omar', 'Haddad', ['operator', 'employee'], 'g-yard'],
  ];
  const contacts = people.map(([firstName, lastName, roles, groupId], i) =>
    stamp({
      id: `c${i + 1}`,
      firstName,
      lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
      phone: `(555) 01${String(20 + i).padStart(2, '0')}-${String(1000 + i * 137).slice(0, 4)}`,
      roles,
      groupId,
      jobTitle: roles.includes('manager') ? 'Fleet manager' : roles.includes('technician') ? 'Mechanic' : 'Driver',
      employeeNumber: `E-${1040 + i}`,
      license: roles.includes('operator') ? { number: `D${7000000 + i * 3911}`, class: i % 2 ? 'B' : 'A', state: 'OR' } : null,
      hourlyRate: roles.includes('technician') ? 4800 + i * 100 : null,
      startDate: addMonths(today, -(14 + i * 5)),
      archived: false,
      attachments: [],
    }),
  );

  // ---- Vendors ----
  const vendorList = [
    ['Harbor Fuel Stop', ['fuel'], '1200 Harbor Way'],
    ['Summit Gas and Diesel', ['fuel'], '88 Summit Ave'],
    ['Precision Auto Repair', ['service'], '415 Elm St'],
    ['Northside Tire Center', ['tires', 'service'], '22 Industrial Pkwy'],
    ['Bay Truck Parts', ['parts'], '9 Commerce Ct'],
    ['VoltPoint Charging', ['charging'], '310 Grid Rd'],
  ];
  const vendors = vendorList.map(([name, kinds, street], i) =>
    stamp({ id: `vd${i + 1}`, name, kinds, address: `${street}, Portland, OR`, phone: `(555) 02${String(10 + i)}-4${String(100 + i * 7).slice(0, 3)}`, email: '', website: '', contactName: '', archived: false }),
  );
  const fuelVendors = ['vd1', 'vd2'];

  // ---- Vehicles ----
  const fleet = [
    ['101', 2022, 'Ford', 'Transit 250', 'Van', 'Gasoline', 'g-north', 'active', 'white', 41200, 'mi', 18.2, 25],
    ['102', 2021, 'Ford', 'Transit 250', 'Van', 'Gasoline', 'g-north', 'active', 'white', 58750, 'mi', 17.5, 25],
    ['103', 2020, 'Ram', 'ProMaster 2500', 'Van', 'Gasoline', 'g-south', 'in_shop', 'white', 77400, 'mi', 16.1, 24],
    ['201', 2023, 'Chevrolet', 'Silverado 1500', 'Pickup truck', 'Gasoline', 'g-south', 'active', 'silver', 22900, 'mi', 19.4, 24],
    ['202', 2019, 'Toyota', 'Tacoma', 'Pickup truck', 'Gasoline', 'g-north', 'active', 'gray', 88300, 'mi', 20.3, 21],
    ['301', 2018, 'Isuzu', 'NPR-HD', 'Box truck', 'Diesel', 'g-yard', 'active', 'white', 132600, 'mi', 11.2, 30],
    ['401', 2017, 'Freightliner', 'Cascadia', 'Semi truck', 'Diesel', 'g-yard', 'out_of_service', 'blue', 612400, 'mi', 6.4, 150],
    ['501', 2024, 'Tesla', 'Model Y', 'SUV', 'Electric', 'g-north', 'active', 'black', 9800, 'mi', 3.6, 75],
    ['502', 2022, 'Toyota', 'Prius', 'Car', 'Hybrid', 'g-south', 'active', 'blue', 35400, 'mi', 52, 11.3],
    ['601', 2016, 'Great Dane', 'Reefer 53 ft', 'Trailer', null, 'g-yard', 'inactive', 'white', null, 'mi', null, null],
    ['701', 2019, 'Toyota', '8FGCU25 Forklift', 'Forklift', 'Propane', 'g-yard', 'active', 'orange', 3120, 'hr', 0.9, 8],
  ];
  const vinChars = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
  const vin = () => Array.from({ length: 17 }, () => pick(vinChars.split(''))).join('');
  const vehicles = fleet.map(([num, year, make, model, type, fuelType, groupId, status, color, meter, unit, econ, tank], i) =>
    stamp({
      id: `v${num}`,
      name: `${num} ${make} ${model}`,
      vin: type === 'Forklift' ? `FL${num}${year}X${i}` : vin(),
      plate: type === 'Forklift' ? '' : `${pick(['7', '8', '9'])}${pick(['K', 'L', 'M', 'R'])}${pick(['A', 'B', 'T', 'Z'])}${Math.floor(between(100, 999))}`,
      registrationState: type === 'Forklift' ? '' : 'OR',
      type,
      fuelType,
      year,
      make,
      model,
      trim: '',
      color,
      status,
      groupId,
      ownership: i === 6 ? 'leased' : 'owned',
      operatorId: null,
      meterUnit: unit,
      meter: null,
      meterDate: null,
      inServiceDate: `${year}-0${1 + (i % 8)}-15`,
      inServiceMeter: 0,
      estServiceLifeMonths: type === 'Semi truck' ? 120 : 96,
      estServiceLifeMeter: type === 'Semi truck' ? 1000000 : unit === 'hr' ? 15000 : 250000,
      estResaleValue: Math.round(between(4000, 22000)) * 100,
      purchase: { date: `${year}-0${1 + (i % 8)}-10`, price: Math.round(between(28000, type === 'Semi truck' ? 140000 : 52000)) * 100, vendorName: `${make} dealer` },
      specs: { fuelCapacity: tank, econ, engine: fuelType === 'Electric' ? 'Dual motor' : fuelType === 'Diesel' ? 'Turbo diesel' : '' },
      labels: i % 4 === 0 ? ['Priority'] : [],
      notes: '',
      archived: false,
      attachments: [],
      _start: meter,
    }),
  );

  // ---- Assignments ----
  const assignments = [];
  const operatorFor = { v101: 'c2', v102: 'c5', v201: 'c3', v202: 'c4', v301: 'c8', v501: 'c1', v502: 'c3' };
  for (const [vid, cid] of Object.entries(operatorFor)) {
    if (vid === 'v502') {
      assignments.push(stamp({ id: id('as'), vehicleId: vid, contactId: 'c4', start: addMonths(today, -9), end: addMonths(today, -3), notes: '' }));
      continue;
    }
    assignments.push(stamp({ id: id('as'), vehicleId: vid, contactId: cid, start: addMonths(today, -Math.floor(between(2, 10))), end: null, notes: '' }));
    vehicles.find((v) => v.id === vid).operatorId = cid;
  }

  // ---- Fuel and meter history (last 6 months) ----
  const fuel = [];
  const meters = [];
  const start = addMonths(today, -6);
  for (const v of vehicles) {
    if (v._start === null) continue;
    let meter = v._start;
    const perDay = v.meterUnit === 'hr' ? 6 : v.type === 'Semi truck' ? 0 : v.type === 'Box truck' ? 95 : between(35, 70);
    const econ = v.specs.econ;
    const isEv = v.fuelType === 'Electric';
    let d = addDays(start, Math.floor(between(0, 5)));
    const step = v.meterUnit === 'hr' ? 10 : isEv ? 6 : Math.max(4, Math.round((v.specs.fuelCapacity * econ * 0.7) / Math.max(perDay, 1)));
    while (d <= today && perDay > 0) {
      const usage = perDay * step * between(0.85, 1.15);
      meter = Math.round(meter + usage);
      const volume = v.meterUnit === 'hr' ? Math.round((usage * econ) * 1000) / 1000 : Math.round((usage / (econ * between(0.9, 1.08))) * 1000) / 1000;
      const price = isEv ? Math.round(between(0.28, 0.42) * 1000) / 1000 : v.fuelType === 'Diesel' ? Math.round(between(3.9, 4.6) * 1000) / 1000 : v.fuelType === 'Propane' ? 2.89 : Math.round(between(3.4, 4.1) * 1000) / 1000;
      const fid = id('f');
      fuel.push(
        stamp({
          id: fid,
          vehicleId: v.id,
          kind: isEv ? 'charge' : 'fuel',
          date: d,
          time: `${String(Math.floor(between(6, 18))).padStart(2, '0')}:${pick(['05', '15', '30', '42', '55'])}`,
          meter,
          volume,
          price,
          total: fuelTotal(volume, price),
          fuelType: v.fuelType,
          vendorId: isEv ? 'vd6' : pick(fuelVendors),
          partial: rand() < 0.08,
          reset: false,
          reference: '',
          notes: '',
          by: v.operatorId ? contacts.find((c) => c.id === v.operatorId)?.firstName : '',
          attachments: [],
        }),
      );
      meters.push(stamp({ id: id('m'), vehicleId: v.id, date: d, value: meter, source: { type: 'fuel', id: fid }, note: '', void: false }));
      d = addDays(d, Math.max(2, Math.round(step * between(0.8, 1.2))));
    }
    if (perDay === 0) {
      // Out of service: last reading a while ago.
      meters.push(stamp({ id: id('m'), vehicleId: v.id, date: addDays(today, -40), value: meter, source: null, note: 'Parked for repairs', void: false }));
    }
    v.meter = meter;
    v.meterDate = meters.filter((m) => m.vehicleId === v.id).reduce((a, m) => (m.date > a ? m.date : a), '') || null;
    delete v._start;
  }
  for (const v of vehicles) delete v._start;

  // The meter on a date, read off the vehicle's fuel history, so service
  // and inspection readings line up with it instead of going backwards.
  const meterOn = (v, date) => {
    const list = meters.filter((m) => m.vehicleId === v.id).sort((a, b) => a.date.localeCompare(b.date));
    if (!list.length) return v.meter;
    const next = list.find((m) => m.date > date);
    const prev = list.filter((m) => m.date <= date).pop();
    if (prev && next) return Math.round(prev.value + ((next.value - prev.value) * diffDays(prev.date, date)) / diffDays(prev.date, next.date));
    if (prev) return prev.value;
    const last = list[list.length - 1];
    const rate = last === next ? 0 : (last.value - next.value) / diffDays(next.date, last.date);
    return Math.max(0, Math.round(next.value - rate * diffDays(date, next.date)));
  };

  // ---- Service tasks ----
  const taskList = [
    ['Engine oil and filter replacement', 'Engine', 'oil'],
    ['Tire rotation', 'Tires and wheels', 'rot'],
    ['Brake inspection', 'Brakes', 'brk'],
    ['Brake pad replacement', 'Brakes', 'pad'],
    ['Air filter replacement', 'Engine', 'air'],
    ['Cabin air filter replacement', 'HVAC', 'cab'],
    ['Transmission fluid service', 'Transmission', 'trn'],
    ['Coolant flush', 'Fluids', 'cool'],
    ['Battery test', 'Electrical', 'bat'],
    ['Wiper blade replacement', 'Body', 'wip'],
    ['Annual DOT inspection', 'Inspection', 'dot'],
    ['Wheel alignment', 'Tires and wheels', 'aln'],
    ['Tire replacement', 'Tires and wheels', 'tire'],
    ['Spark plug replacement', 'Engine', 'spk'],
    ['Propane tank inspection', 'Inspection', 'lp'],
    ['DEF fluid top-off', 'Fluids', 'def'],
  ];
  const serviceTasks = taskList.map(([name, category, key]) => stamp({ id: `t-${key}`, name, category, description: '', archived: false }));

  // ---- Parts ----
  const partList = [
    ['OF-1029', 'Oil filter, light duty', 'Filters', 'FilterPro', 'each', 899, 14, 5],
    ['OF-2210', 'Oil filter, diesel', 'Filters', 'FilterPro', 'each', 2450, 4, 3],
    ['AF-3301', 'Engine air filter', 'Filters', 'FilterPro', 'each', 2199, 6, 2],
    ['CF-1180', 'Cabin air filter', 'Filters', 'FilterPro', 'each', 1499, 8, 2],
    ['MO-5W30', 'Motor oil 5W-30', 'Fluids', 'Lubrico', 'quart', 649, 48, 20],
    ['MO-15W40', 'Diesel engine oil 15W-40', 'Fluids', 'Lubrico', 'gallon', 2799, 6, 4],
    ['BP-7720', 'Brake pad set, front', 'Brakes', 'StopRight', 'each', 6895, 3, 2],
    ['WB-22', 'Wiper blade 22 in', 'Other', 'ClearView', 'each', 1295, 1, 4],
    ['BAT-65', 'Battery group 65', 'Electrical', 'PowerCell', 'each', 18999, 2, 1],
    ['DEF-25', 'Diesel exhaust fluid 2.5 gal', 'Fluids', 'BlueFlow', 'each', 1599, 10, 4],
    ['HL-9005', 'Headlight bulb 9005', 'Lighting', 'BrightLine', 'each', 1899, 5, 2],
  ];
  const parts = partList.map(([number, description, category, manufacturer, unit, unitCost, qty, reorderPoint], i) =>
    stamp({
      id: `p${i + 1}`,
      number,
      description,
      category,
      manufacturer,
      mpn: `${manufacturer.slice(0, 3).toUpperCase()}-${number}`,
      unit,
      unitCost,
      locations: [{ location: 'Main shop', qty, aisle: `A${1 + (i % 4)}-${String(i + 1).padStart(2, '0')}`, reorderPoint }],
      archived: false,
      attachments: [],
    }),
  );

  // ---- Service programs and reminders ----
  const lightDuty = ['v101', 'v102', 'v103', 'v201', 'v202', 'v502'];
  const program = stamp({
    id: 'sp-light',
    name: 'Light duty maintenance',
    description: 'Standard schedule for vans, pickups, and cars.',
    vehicleIds: lightDuty,
    schedules: [
      { id: 'ps1', taskId: 't-oil', interval: { every: 6, unit: 'months' }, meterInterval: 7500 },
      { id: 'ps2', taskId: 't-rot', interval: { every: 6, unit: 'months' }, meterInterval: 7500 },
      { id: 'ps3', taskId: 't-brk', interval: { every: 12, unit: 'months' }, meterInterval: 15000 },
      { id: 'ps4', taskId: 't-cab', interval: { every: 12, unit: 'months' }, meterInterval: null },
    ],
    archived: false,
  });
  const heavy = stamp({
    id: 'sp-heavy',
    name: 'Heavy duty maintenance',
    description: 'Diesel trucks and tractors.',
    vehicleIds: ['v301', 'v401'],
    schedules: [
      { id: 'ph1', taskId: 't-oil', interval: { every: 3, unit: 'months' }, meterInterval: 15000 },
      { id: 'ph2', taskId: 't-dot', interval: { every: 1, unit: 'years' }, meterInterval: null },
      { id: 'ph3', taskId: 't-def', interval: { every: 1, unit: 'months' }, meterInterval: null },
    ],
    archived: false,
  });
  const servicePrograms = [program, heavy];
  const reminders = [];
  for (const p of servicePrograms) {
    for (const vid of p.vehicleIds) {
      const v = vehicles.find((x) => x.id === vid);
      for (const s of p.schedules) {
        // Spread last completions so some are overdue, some due soon.
        const ageFrac = between(0.3, 1.25);
        const months = s.interval.unit === 'years' ? 12 * s.interval.every : s.interval.every;
        const lastDate = addDays(today, -Math.round(months * 30.4 * ageFrac));
        const lastMeter = s.meterInterval && v.meter ? Math.max(0, Math.round(v.meter - s.meterInterval * ageFrac * between(0.6, 1.1))) : (v.meter ?? null);
        reminders.push(
          stamp({
            id: id('r'),
            vehicleId: vid,
            taskId: s.taskId,
            programId: p.id,
            scheduleId: s.id,
            interval: s.interval,
            meterInterval: s.meterInterval,
            lastDate,
            lastMeter,
            startDate: lastDate,
            startMeter: lastMeter,
            history: [{ date: lastDate, meter: lastMeter, entryId: null, onTime: rand() > 0.25 }],
          }),
        );
      }
    }
  }
  reminders.push(
    stamp({ id: id('r'), vehicleId: 'v701', taskId: 't-lp', programId: null, interval: { every: 3, unit: 'months' }, meterInterval: 250, lastDate: addDays(today, -80), lastMeter: (vehicles.find((v) => v.id === 'v701').meter || 0) - 240, history: [] }),
  );

  // ---- Renewals ----
  const renewals = [];
  for (const v of vehicles) {
    if (v.type === 'Forklift') continue;
    renewals.push(stamp({ id: id('rn'), kind: 'vehicle', vehicleId: v.id, type: 'Registration', dueDate: addDays(today, Math.round(between(-12, 300))), repeat: { every: 1, unit: 'years' }, notes: '', history: [] }));
    if (rand() < 0.5) renewals.push(stamp({ id: id('rn'), kind: 'vehicle', vehicleId: v.id, type: 'Emission test', dueDate: addDays(today, Math.round(between(-20, 90))), repeat: { every: 2, unit: 'years' }, notes: '', history: [] }));
  }
  renewals.push(stamp({ id: id('rn'), kind: 'vehicle', vehicleId: 'v401', type: 'Insurance', dueDate: addDays(today, 9), repeat: { every: 6, unit: 'months' }, notes: 'Fleet policy', history: [] }));
  for (const c of contacts) {
    if (!c.license) continue;
    renewals.push(stamp({ id: id('rn'), kind: 'contact', contactId: c.id, type: 'Driver license', dueDate: addDays(today, Math.round(between(-5, 700))), repeat: { every: 4, unit: 'years' }, notes: '', history: [] }));
    if (c.license.class === 'A') renewals.push(stamp({ id: id('rn'), kind: 'contact', contactId: c.id, type: 'Medical card', dueDate: addDays(today, Math.round(between(5, 200))), repeat: { every: 2, unit: 'years' }, notes: '', history: [] }));
  }

  // ---- Service history ----
  const serviceEntries = [];
  const laborRate = 9500;
  const li = (taskId, hours, partsUsed = []) => ({
    id: id('li'),
    taskId,
    description: '',
    laborHours: hours,
    laborRate,
    laborCost: 0,
    parts: partsUsed.map(([pid, qty]) => {
      const p = parts.find((x) => x.id === pid);
      return { id: id('lp'), partId: pid, name: p.description, qty, unitCost: p.unitCost };
    }),
  });
  const svc = [
    ['v101', 75, 'vd3', [li('t-oil', 0.6, [['p1', 1], ['p5', 6]]), li('t-rot', 0.5)]],
    ['v102', 140, null, [li('t-oil', 0.6, [['p1', 1], ['p5', 6]]), li('t-cab', 0.3, [['p4', 1]])]],
    ['v103', 20, 'vd3', [li('t-brk', 0.8), li('t-pad', 1.6, [['p7', 1]])]],
    ['v201', 95, 'vd4', [li('t-rot', 0.5), li('t-aln', 1.0)]],
    ['v202', 160, null, [li('t-oil', 0.6, [['p1', 1], ['p5', 5]]), li('t-air', 0.3, [['p3', 1]]), li('t-wip', 0.2, [['p8', 2]])]],
    ['v301', 50, 'vd3', [li('t-oil', 1.2, [['p2', 1], ['p6', 4]]), li('t-def', 0.2, [['p10', 2]])]],
    ['v401', 120, 'vd3', [li('t-dot', 2.5), li('t-bat', 0.4, [['p9', 1]])]],
    ['v502', 60, 'vd4', [li('t-tire', 1.5)]],
    ['v701', 30, null, [li('t-lp', 0.5)]],
    ['v101', 170, null, [li('t-bat', 0.3), li('t-wip', 0.2, [['p8', 2]])]],
  ];
  for (const [vid, daysAgo, vendorId, lineItems] of svc) {
    const v = vehicles.find((x) => x.id === vid);
    const date = addDays(today, -daysAgo);
    const meterAt = v.meter ? meterOn(v, date) : null;
    const eid = id('se');
    if (vendorId === 'vd4' && vid === 'v502') lineItems[0].laborCost = 0;
    serviceEntries.push(
      stamp({
        id: eid,
        vehicleId: vid,
        date,
        startDate: date,
        meter: meterAt,
        vendorId,
        repairClass: rand() < 0.75 ? 'scheduled' : 'non_scheduled',
        reference: vendorId ? `INV-${Math.floor(between(10000, 99999))}` : '',
        workOrderId: null,
        lineItems,
        discount: null,
        taxPercent: vendorId ? 8 : 0,
        issueIds: [],
        reminderIds: [],
        notes: '',
        attachments: [],
      }),
    );
    if (meterAt) meters.push(stamp({ id: id('m'), vehicleId: vid, date, value: meterAt, source: { type: 'service', id: eid }, note: '', void: false }));
  }

  // ---- Issues ----
  const issueSpecs = [
    ['v103', 'Grinding noise when braking', 'Front left, worse at low speed.', 'high', 'open', 6, 'c3', 'c6', 3],
    ['v401', 'Coolant leak under engine', 'Puddle after parking overnight.', 'critical', 'open', 42, 'c8', 'c7', -30],
    ['v202', 'Check engine light on', 'Came on during highway driving.', 'medium', 'open', 3, 'c4', null, 10],
    ['v101', 'Passenger mirror cracked', '', 'low', 'open', 12, 'c2', null, null],
    ['v301', 'Liftgate slow to raise', 'Hydraulic pressure seems low.', 'medium', 'open', 20, 'c8', 'c6', 2],
    ['v502', 'Rear tire low pressure', 'Slow leak, rear right.', 'medium', 'resolved', 61, 'c3', 'c7', null],
    ['v102', 'Wiper streaking', '', 'low', 'resolved', 140, 'c5', null, null],
    ['v201', 'Rattle from dashboard', 'Only on rough roads.', 'none', 'closed', 90, 'c3', null, null],
  ];
  let issueNo = 0;
  const issues = issueSpecs.map(([vehicleId, summary, description, priority, status, daysAgo, reporter, assignee, dueIn]) =>
    stamp({
      id: id('is'),
      number: ++issueNo,
      vehicleId,
      summary,
      description,
      priority,
      status,
      reportedDate: addDays(today, -daysAgo),
      reportedBy: contacts.find((c) => c.id === reporter) ? `${contacts.find((c) => c.id === reporter).firstName} ${contacts.find((c) => c.id === reporter).lastName}` : '',
      assigneeId: assignee,
      dueDate: dueIn === null ? null : addDays(today, dueIn),
      labels: [],
      attachments: [],
      resolvedAt: status === 'resolved' ? addDays(today, -daysAgo + 3) : null,
      resolution: status === 'resolved' ? { type: 'note', note: 'Fixed', date: addDays(today, -daysAgo + 3) } : null,
    }),
  );

  // ---- Work orders ----
  let woNo = 0;
  const workOrders = [
    stamp({
      id: id('wo'),
      number: ++woNo,
      vehicleId: 'v103',
      status: 'in_progress',
      repairClass: 'non_scheduled',
      issueDate: addDays(today, -4),
      startDate: addDays(today, -2),
      dueDate: addDays(today, 1),
      assigneeId: 'c6',
      vendorId: null,
      meter: vehicles.find((v) => v.id === 'v103').meter,
      lineItems: [li('t-brk', 0.8), li('t-pad', 1.6, [['p7', 1]])],
      issueIds: [issues[0].id],
      reminderIds: [],
      discount: null,
      taxPercent: 0,
      notes: 'Waiting on rotor measurement before ordering.',
      attachments: [],
    }),
    stamp({
      id: id('wo'),
      number: ++woNo,
      vehicleId: 'v401',
      status: 'on_hold',
      repairClass: 'emergency',
      issueDate: addDays(today, -38),
      startDate: addDays(today, -36),
      dueDate: addDays(today, -20),
      assigneeId: 'c7',
      vendorId: 'vd3',
      meter: vehicles.find((v) => v.id === 'v401').meter,
      lineItems: [li('t-cool', 3.0)],
      issueIds: [issues[1].id],
      reminderIds: [],
      discount: null,
      taxPercent: 8,
      notes: 'Water pump on backorder.',
      attachments: [],
    }),
    stamp({
      id: id('wo'),
      number: ++woNo,
      vehicleId: 'v301',
      status: 'open',
      repairClass: 'non_scheduled',
      issueDate: addDays(today, -1),
      startDate: addDays(today, 2),
      dueDate: addDays(today, 4),
      assigneeId: 'c6',
      vendorId: null,
      meter: null,
      lineItems: [{ id: id('li'), taskId: null, description: 'Inspect liftgate hydraulics', laborHours: 1.5, laborRate, laborCost: 0, parts: [] }],
      issueIds: [issues[4].id],
      reminderIds: [],
      discount: null,
      taxPercent: 0,
      notes: '',
      attachments: [],
    }),
  ];

  // ---- Inspections ----
  const form = { ...starterForm(() => id('it')), id: 'if-pretrip', archived: false };
  const inspectionForms = [stamp(form)];
  const inspections = [];
  const driven = ['v101', 'v102', 'v201', 'v202', 'v301', 'v501', 'v502'];
  for (let d = 13; d >= 0; d--) {
    const date = addDays(today, -d);
    const day = new Date(`${date}T12:00:00`).getDay();
    if (day === 0 || day === 6) continue;
    for (const vid of driven) {
      if (rand() < 0.22) continue;
      const v = vehicles.find((x) => x.id === vid);
      const op = contacts.find((c) => c.id === v.operatorId);
      const results = form.items
        .filter((it) => it.type !== 'section')
        .map((it) => {
          let value = null;
          let pass = null;
          if (it.type === 'passfail') {
            const fail = rand() < 0.025;
            value = fail ? 'fail' : 'pass';
            pass = !fail;
          } else if (it.type === 'meter') value = v.meter ? meterOn(v, date) : null;
          else if (it.type === 'choice') {
            value = pick(['Full', '3/4', '1/2', '1/4']);
            pass = true;
          } else if (it.type === 'signature') value = 'signed';
          return { itemId: it.id, label: it.label, type: it.type, value, pass, note: pass === false ? 'Needs a look' : '', photos: [] };
        });
      const h = 6 + Math.floor(rand() * 3);
      const startedAt = `${date}T${String(h).padStart(2, '0')}:${String(Math.floor(rand() * 50)).padStart(2, '0')}:00`;
      inspections.push(
        stamp({
          id: id('in'),
          formId: form.id,
          formName: form.name,
          vehicleId: vid,
          date,
          startedAt,
          submittedAt: new Date(new Date(startedAt).getTime() + between(4, 14) * 60000).toISOString(),
          by: op ? `${op.firstName} ${op.lastName}` : '',
          meter: results.find((r) => r.type === 'meter')?.value ?? null,
          results,
          failed: results.filter((r) => r.pass === false).length,
        }),
      );
    }
  }

  // ---- Expenses ----
  const expenses = [];
  for (const v of vehicles) {
    if (v.type === 'Forklift' || v.type === 'Trailer') continue;
    for (let m = 0; m < 6; m++) {
      const date = addDays(addMonths(today, -m), -Math.floor(between(0, 20)));
      if (date > today) continue;
      if (rand() < 0.5) expenses.push(stamp({ id: id('ex'), vehicleId: v.id, date, type: 'Tolls', amount: Math.round(between(8, 60)) * 100, vendorId: null, notes: '', attachments: [] }));
      expenses.push(stamp({ id: id('ex'), vehicleId: v.id, date: addDays(addMonths(today, -m), -Math.min(10, Number(today.slice(8)) - 1)), type: 'Insurance', amount: Math.round(between(90, 160)) * 100, vendorId: null, notes: 'Monthly premium', attachments: [] }));
      if (rand() < 0.15) expenses.push(stamp({ id: id('ex'), vehicleId: v.id, date, type: 'Parking', amount: Math.round(between(10, 45)) * 100, vendorId: null, notes: '', attachments: [] }));
    }
  }

  // ---- Purchase orders ----
  let poNo = 0;
  const purchaseOrders = [
    stamp({
      id: id('po'),
      number: ++poNo,
      vendorId: 'vd5',
      status: 'ordered',
      date: addDays(today, -3),
      expectedDate: addDays(today, 4),
      location: 'Main shop',
      items: [
        { id: id('pi'), partId: 'p8', qty: 10, unitCost: 1195, received: 0 },
        { id: id('pi'), partId: 'p7', qty: 4, unitCost: 6650, received: 0 },
      ],
      taxPercent: 8,
      shipping: 2500,
      notes: '',
    }),
  ];

  settings.numbering = { issue: issueNo + 1, workOrder: woNo + 1, purchaseOrder: poNo + 1 };

  return {
    settings,
    collections: {
      vehicles,
      contacts,
      vendors,
      assignments,
      meters,
      fuel,
      expenses,
      issues,
      inspectionForms,
      inspections,
      serviceTasks,
      servicePrograms,
      reminders,
      renewals,
      serviceEntries,
      workOrders,
      parts,
      purchaseOrders,
      comments: [],
    },
  };
}

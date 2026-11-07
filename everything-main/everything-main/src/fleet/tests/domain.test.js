import { describe, it, expect } from 'vitest';
import { fuelDerived, fuelSummary, fuelTotal, unitPrice, fuelWarnings } from '../src/core/fuel.js';
import { reminderState, completeReminder, compliance, renewalState, completeRenewal, describeSchedule } from '../src/core/reminders.js';
import { docTotals, lineLabor, partsUsed, poTotals } from '../src/core/totals.js';
import { evaluate, buildResults, missingRequired, inspectionsDue, starterForm } from '../src/core/inspections.js';
import { costLines, monthlyCosts, costsByVehicle, usageByVehicle } from '../src/core/costs.js';
import { checkVin, vinYear, economyValue, formatEconomy, vehicleName, initials, matches } from '../src/core/format.js';
import { addInterval, relativeDays, lastMonths } from '../src/core/dates.js';
import { issueOverdue } from '../src/core/status.js';

describe('fuel', () => {
  it('computes totals and unit prices in cents', () => {
    expect(fuelTotal(10.5, 3.459)).toBe(3632);
    expect(unitPrice(3632, 10.5)).toBe(3.459);
    expect(unitPrice(100, 0)).toBe(null);
  });

  it('measures economy between full fill-ups, counting partial fills', () => {
    const entries = [
      { id: 'a', meter: 1000, volume: 10, total: 3500, date: '2026-01-01' },
      { id: 'b', meter: 1150, volume: 4, total: 1400, date: '2026-01-04', partial: true },
      { id: 'c', meter: 1300, volume: 8, total: 2800, date: '2026-01-08' },
      { id: 'd', meter: 1550, volume: 10, total: 3500, date: '2026-01-12' },
    ];
    const d = fuelDerived(entries, 'mi', 'gal');
    expect(d.get('a').economy).toBe(null);
    expect(d.get('b').economy).toBe(null);
    expect(d.get('c').economy).toBeCloseTo(300 / 12);
    expect(d.get('d').economy).toBeCloseTo(25);
    expect(d.get('c').usage).toBe(150);
    expect(d.get('c').costPerMeter).toBe(Math.round(2800 / 150));
    const s = fuelSummary(entries, d, { meterUnit: 'mi', volumeUnit: 'gal' });
    expect(s.cost).toBe(11200);
    expect(s.volume).toBe(32);
    expect(s.avgEconomy).toBeCloseTo(550 / 22);
  });

  it('restarts the measurement after a missed fill-up', () => {
    const entries = [
      { id: 'a', meter: 1000, volume: 10, date: '2026-01-01' },
      { id: 'b', meter: 1600, volume: 9, date: '2026-01-09', reset: true },
      { id: 'c', meter: 1800, volume: 8, date: '2026-01-12' },
    ];
    const d = fuelDerived(entries, 'mi', 'gal');
    expect(d.get('b').economy).toBe(null);
    expect(d.get('c').economy).toBeCloseTo(25);
  });

  it('shows consumption for metric fleets', () => {
    expect(economyValue(500, 40, 'km', 'L')).toBeCloseTo(8);
    expect(formatEconomy(8, 'km', 'L')).toBe('8 L/100 km');
    expect(economyValue(10, 8, 'hr', 'gal')).toBeCloseTo(0.8);
  });

  it('warns about a lower odometer and an overfilled tank', () => {
    const others = [{ id: 'x', vehicleId: 'v', date: '2026-01-01', meter: 5000 }];
    const w = fuelWarnings({ vehicleId: 'v', date: '2026-01-05', meter: 4000, volume: 40 }, { specs: { fuelCapacity: 20 } }, others);
    expect(w).toHaveLength(2);
  });
});

describe('service reminders', () => {
  const rem = { interval: { every: 6, unit: 'months' }, meterInterval: 5000, lastDate: '2026-01-15', lastMeter: 10000 };

  it('is due by date or meter, whichever comes first', () => {
    expect(reminderState(rem, { meter: 11000 }, '2026-03-01').status).toBe('upcoming');
    expect(reminderState(rem, { meter: 14700 }, '2026-03-01').status).toBe('due_soon');
    expect(reminderState(rem, { meter: 15000 }, '2026-03-01').status).toBe('overdue');
    expect(reminderState(rem, { meter: 11000 }, '2026-07-10').status).toBe('due_soon');
    expect(reminderState(rem, { meter: 11000 }, '2026-07-16').status).toBe('overdue');
    const s = reminderState(rem, { meter: 12000 }, '2026-03-01');
    expect(s.nextDate).toBe('2026-07-15');
    expect(s.nextMeter).toBe(15000);
    expect(s.meterLeft).toBe(3000);
  });

  it('respects snoozing and manual next-due overrides', () => {
    expect(reminderState({ ...rem, snoozedUntil: '2026-08-01' }, { meter: 11000 }, '2026-07-20').status).toBe('snoozed');
    expect(reminderState({ ...rem, nextDate: '2026-02-01' }, { meter: 11000 }, '2026-03-01').status).toBe('overdue');
  });

  it('restarts from a completion and tracks on-time compliance', () => {
    const late = completeReminder(rem, { date: '2026-08-01', meter: 15500, entryId: 'e1' }, { meter: 15500 }, {});
    expect(late.lastDate).toBe('2026-08-01');
    expect(late.lastMeter).toBe(15500);
    expect(late.history.at(-1).onTime).toBe(false);
    const ok = completeReminder(late, { date: '2026-10-01', meter: 17000, entryId: 'e2' }, { meter: 17000 }, {});
    expect(ok.history.at(-1).onTime).toBe(true);
    expect(compliance(ok)).toBe(0.5);
    expect(describeSchedule(rem)).toBe('Every 6 months or 5,000 mi');
  });

  it('rolls renewals forward by their repeat interval', () => {
    const ren = { dueDate: '2026-10-20', repeat: { every: 1, unit: 'years' } };
    expect(renewalState(ren, '2026-10-12').status).toBe('due_soon');
    expect(renewalState(ren, '2026-10-21').status).toBe('overdue');
    expect(renewalState(ren, '2026-08-01').status).toBe('upcoming');
    const done = completeRenewal(ren, { date: '2026-10-15' });
    expect(done.dueDate).toBe('2027-10-20');
    expect(done.history).toHaveLength(1);
    expect(completeRenewal({ dueDate: '2026-10-20' }, { date: '2026-10-15' }).done).toBe(true);
  });
});

describe('totals', () => {
  const doc = {
    lineItems: [
      { laborHours: 1.5, laborRate: 10000, parts: [{ partId: 'p1', qty: 2, unitCost: 1250 }] },
      { laborCost: 5000, parts: [{ partId: 'p1', qty: 1, unitCost: 1250 }, { partId: 'p2', qty: 1, unitCost: 999 }] },
    ],
    discount: { type: 'percent', value: 10 },
    taxPercent: 8,
  };

  it('adds labor and parts, then discount and tax', () => {
    expect(lineLabor(doc.lineItems[0])).toBe(15000);
    const t = docTotals(doc);
    expect(t.labor).toBe(20000);
    expect(t.parts).toBe(4749);
    expect(t.subtotal).toBe(24749);
    expect(t.discount).toBe(2475);
    expect(t.tax).toBe(Math.round((24749 - 2475) * 0.08));
    expect(t.total).toBe(24749 - 2475 + t.tax);
    expect([...partsUsed(doc)]).toEqual([
      ['p1', 3],
      ['p2', 1],
    ]);
  });

  it('caps an amount discount at the subtotal', () => {
    expect(docTotals({ lineItems: [{ laborCost: 100 }], discount: { type: 'amount', value: 500 } }).total).toBe(0);
  });

  it('totals purchase orders', () => {
    expect(poTotals({ items: [{ qty: 2, unitCost: 500 }], taxPercent: 10, shipping: 300 })).toEqual({ subtotal: 1000, tax: 100, shipping: 300, total: 1400 });
  });
});

describe('inspections', () => {
  it('evaluates pass conditions per item type', () => {
    expect(evaluate({ type: 'passfail' }, 'pass')).toBe(true);
    expect(evaluate({ type: 'passfail' }, 'fail')).toBe(false);
    expect(evaluate({ type: 'passfail' }, null)).toBe(null);
    expect(evaluate({ type: 'choice', passOptions: ['Good'] }, 'Bad')).toBe(false);
    expect(evaluate({ type: 'choice' }, 'Bad')).toBe(null);
    expect(evaluate({ type: 'number', min: 30, max: 40 }, '35')).toBe(true);
    expect(evaluate({ type: 'number', min: 30 }, '20')).toBe(false);
    expect(evaluate({ type: 'text' }, 'hi')).toBe(null);
  });

  it('finds required items left blank and builds results', () => {
    let i = 0;
    const form = starterForm(() => `i${++i}`);
    const firstPf = form.items.find((x) => x.type === 'passfail');
    const missing = missingRequired(form, { [firstPf.id]: { value: 'pass' } });
    expect(missing.some((m) => m.id === firstPf.id)).toBe(false);
    expect(missing.length).toBeGreaterThan(3);
    const results = buildResults(form, { [firstPf.id]: { value: 'fail', note: 'Broken' } });
    expect(results.find((r) => r.itemId === firstPf.id)).toMatchObject({ pass: false, note: 'Broken' });
    expect(results.some((r) => r.type === 'section')).toBe(false);
  });

  it('lists scheduled inspections that are due', () => {
    const forms = [{ id: 'f', schedule: { every: 1, unit: 'days' }, vehicleIds: [] }];
    const vehicles = [{ id: 'a' }, { id: 'b' }];
    const subs = [{ formId: 'f', vehicleId: 'a', date: '2026-10-11' }];
    const due = inspectionsDue(forms, vehicles, subs, '2026-10-12', addInterval);
    expect(due.find((d) => d.vehicle.id === 'a')).toMatchObject({ dueDate: '2026-10-12', overdue: false });
    expect(due.find((d) => d.vehicle.id === 'b')).toMatchObject({ lastDate: null, overdue: false });
    const later = inspectionsDue(forms, vehicles, subs, '2026-10-14', addInterval);
    expect(later.find((d) => d.vehicle.id === 'a').overdue).toBe(true);
  });
});

describe('costs', () => {
  const lines = costLines({
    fuel: [{ vehicleId: 'a', date: '2026-09-02', total: 5000 }],
    serviceEntries: [{ vehicleId: 'a', date: '2026-10-01', lineItems: [{ laborCost: 10000 }] }],
    expenses: [{ vehicleId: 'b', date: '2026-10-05', amount: 2500, type: 'Tolls' }],
  });

  it('groups costs by month and kind', () => {
    const s = monthlyCosts(lines, ['2026-09', '2026-10']);
    expect(s.fuel).toEqual([5000, 0]);
    expect(s.service).toEqual([0, 10000]);
    expect(s.other).toEqual([0, 2500]);
  });

  it('totals costs per vehicle in a range', () => {
    const m = costsByVehicle(lines, '2026-10-01', '2026-10-31');
    expect(m.get('a')).toEqual({ fuel: 0, service: 10000, other: 0, total: 10000 });
    expect(m.get('b').total).toBe(2500);
  });

  it('measures meter usage from readings', () => {
    const readings = [
      { vehicleId: 'a', date: '2026-09-28', value: 1000 },
      { vehicleId: 'a', date: '2026-10-10', value: 1300 },
      { vehicleId: 'a', date: '2026-10-20', value: 1500 },
      { vehicleId: 'b', date: '2026-10-20', value: 50, void: true },
    ];
    expect(usageByVehicle(readings, '2026-10-01', '2026-10-31').get('a')).toBe(500);
    expect(usageByVehicle(readings, '2026-10-01', '2026-10-31').has('b')).toBe(false);
  });
});

describe('formatting', () => {
  it('validates VIN check digits', () => {
    expect(checkVin('1M8GDM9AXKP042788')).toBe('ok');
    expect(checkVin('1M8GDM9A1KP042788')).toBe('checkdigit');
    expect(checkVin('123')).toBe('invalid');
    expect(checkVin('1M8GDM9AXKP04278O')).toBe('invalid');
    expect(vinYear('1M8GDM9AXKP042788', 2026)).toBe(2019);
  });

  it('names vehicles and people', () => {
    expect(vehicleName({ year: 2020, make: 'Ford', model: 'F-150' })).toBe('2020 Ford F-150');
    expect(vehicleName({ name: 'Unit 7' })).toBe('Unit 7');
    expect(initials('Maya Okafor')).toBe('MO');
    expect(matches('Ford Transit 250', 'trans ford')).toBe(true);
  });

  it('formats relative dates and intervals', () => {
    expect(relativeDays('2026-10-15', '2026-10-12')).toBe('in 3 days');
    expect(relativeDays('2026-09-12', '2026-10-12')).toBe('4 weeks ago');
    expect(addInterval('2026-01-31', { every: 1, unit: 'months' })).toBe('2026-02-28');
    expect(addInterval('2026-01-01', { every: 2, unit: 'weeks' })).toBe('2026-01-15');
    expect(lastMonths('2026-10-12', 3)).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('flags open issues past due', () => {
    expect(issueOverdue({ status: 'open', dueDate: '2026-10-01' }, '2026-10-12')).toBe(true);
    expect(issueOverdue({ status: 'resolved', dueDate: '2026-10-01' }, '2026-10-12')).toBe(false);
    expect(issueOverdue({ status: 'open', dueMeter: 5000 }, '2026-10-12', { meter: 5100 })).toBe(true);
  });
});

describe('VIN decoding', async () => {
  const { parseVpic, decodeVin } = await import('../src/core/vin.js');
  const row = { ModelYear: '2016', Make: 'FORD', Model: 'F-150', Trim: '', Series: 'XL', BodyClass: 'Pickup', VehicleType: 'TRUCK', FuelTypePrimary: 'Gasoline', DisplacementL: '3.5', EngineCylinders: '6', DriveType: '4WD/4-Wheel Drive/4x4', GVWR: 'Class 2F: 7,001 - 8,000 lb (3,175 - 3,629 kg)', ErrorCode: '0', ErrorText: '0 - VIN decoded clean.' };

  it('maps vPIC fields to vehicle fields', () => {
    expect(parseVpic(row)).toMatchObject({ year: 2016, make: 'Ford', model: 'F-150', trim: 'XL', type: 'Pickup truck', fuelType: 'Gasoline', engine: '3.5L 6 cylinder', gvwr: '7,001 - 8,000 lb (3,175 - 3,629 kg)', ok: true });
    expect(parseVpic({ ...row, BodyClass: 'Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)', ElectrificationLevel: 'BEV (Battery Electric Vehicle)', FuelTypePrimary: 'Electric' })).toMatchObject({ type: 'SUV', fuelType: 'Electric' });
    expect(parseVpic({ ...row, BodyClass: 'Truck-Tractor', FuelTypePrimary: 'Diesel' })).toMatchObject({ type: 'Semi truck', fuelType: 'Diesel' });
    expect(parseVpic({ ...row, ElectrificationLevel: 'Strong HEV (Hybrid Electric Vehicle)' }).fuelType).toBe('Hybrid');
  });

  it('decodes through the service and reports failures', async () => {
    const ok = await decodeVin('1ftfw1eg3gfa31822', async (url) => {
      expect(url).toContain('1FTFW1EG3GFA31822');
      return { ok: true, json: async () => ({ Results: [row] }) };
    });
    expect(ok.make).toBe('Ford');
    await expect(decodeVin('123', async () => ({}))).rejects.toThrow(/11 characters/);
    await expect(decodeVin('1FTFW1EG3GFA31822', async () => ({ ok: true, json: async () => ({ Results: [{}] }) }))).rejects.toThrow(/No vehicle/);
    await expect(decodeVin('1FTFW1EG3GFA31822', async () => { throw new Error('net'); })).rejects.toThrow(/could not be reached/);
  });
});

describe('recalls', async () => {
  const { parseRecalls, fetchRecalls } = await import('../src/core/recalls.js');
  it('parses and sorts recalls, newest first', () => {
    const list = parseRecalls({ results: [{ NHTSACampaignNumber: '21V001', ReportReceivedDate: '01/05/2021', Component: 'BRAKES', parkIt: false }, { NHTSACampaignNumber: '23V777', ReportReceivedDate: '20/07/2023', Component: 'ELECTRICAL', parkIt: true }, { Component: 'no campaign' }] });
    expect(list.map((r) => r.campaign)).toEqual(['23V777', '21V001']);
    expect(list[0]).toMatchObject({ date: '2023-07-20', parkIt: true });
  });
  it('needs year, make, and model', async () => {
    await expect(fetchRecalls({ make: 'Ford' })).rejects.toThrow(/year, make, and model/);
    const list = await fetchRecalls({ year: 2021, make: 'Ford', model: 'Transit' }, async (url) => {
      expect(url).toContain('modelYear=2021');
      return { ok: true, json: async () => ({ results: [] }) };
    });
    expect(list).toEqual([]);
  });
});

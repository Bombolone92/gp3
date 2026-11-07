import { describe, it, expect, beforeEach } from 'vitest';
import { formatMoney, laborCost } from '../src/core/payroll.js';
import { timesheetRows, timesheetCSV, employeeSummaries } from '../src/core/timesheet.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { weekDates } from '../src/lib/time.js';

describe('laborCost', () => {
  const employees = [
    { id: 'e1', name: 'Ava', hourlyRate: 20 },
    { id: 'e2', name: 'Liam', hourlyRate: null },
  ];
  const shifts = [
    // 8h minus 30m break at $20 = $150
    { id: 's1', date: '2026-08-03', start: '09:00', end: '17:00', role: 'Floor', assigneeId: 'e1', breakMinutes: 30 },
    // 4h at $20 = $80
    { id: 's2', date: '2026-08-04', start: '09:00', end: '13:00', role: 'Floor', assigneeId: 'e1' },
    // No rate: excluded from cost, counted for coverage note
    { id: 's3', date: '2026-08-04', start: '09:00', end: '13:00', role: 'Floor', assigneeId: 'e2' },
    // Open and out-of-range shifts never count
    { id: 's4', date: '2026-08-04', start: '09:00', end: '13:00', role: 'Floor', assigneeId: null },
    { id: 's5', date: '2026-08-20', start: '09:00', end: '13:00', role: 'Floor', assigneeId: 'e1' },
  ];

  it('sums net hours times rate over the given dates', () => {
    const result = laborCost(shifts, employees, weekDates('2026-08-03'));
    expect(result.cost).toBe(230);
    expect(result.ratedCount).toBe(1);
    expect(result.employeeCount).toBe(2);
  });

  it('reports zero rated employees when nobody has a rate', () => {
    const result = laborCost(shifts, [{ id: 'e1', name: 'Ava' }], weekDates('2026-08-03'));
    expect(result.ratedCount).toBe(0);
    expect(result.cost).toBe(0);
  });
});

describe('formatMoney', () => {
  it('formats with the currency and survives bad codes', () => {
    expect(formatMoney(1234.5, 'USD')).toMatch(/1,?234\.50/);
    expect(formatMoney(10, 'NOPE')).toContain('NOPE');
  });
});

describe('timesheet pay columns', () => {
  const state = {
    employees: [
      { id: 'e1', name: 'Ava', hourlyRate: 20 },
      { id: 'e2', name: 'Liam' },
    ],
    shifts: [
      { id: 's1', date: '2026-08-03', start: '09:00', end: '17:00', role: 'Floor', assigneeId: 'e1', breakMinutes: 30 },
      { id: 's2', date: '2026-08-04', start: '09:00', end: '13:00', role: 'Floor', assigneeId: 'e1' },
      { id: 's3', date: '2026-08-05', start: '09:00', end: '13:00', role: 'Floor', assigneeId: 'e1' },
      { id: 's4', date: '2026-08-05', start: '09:00', end: '13:00', role: 'Floor', assigneeId: 'e2' },
    ],
    attendance: {
      s1: { status: 'present', clockIn: '09:00', clockOut: '18:00' }, // 9h gross - 0.5h break = 8.5h
      s2: { status: 'absent', clockIn: '', clockOut: '' },
    },
  };

  it('pays worked hours when recorded, scheduled otherwise, nothing when absent', () => {
    const rows = timesheetRows(state, '2026-08-03', '2026-08-09');
    const [worked, absent, scheduled, noRate] = rows;
    expect(worked).toMatchObject({ hourlyRate: 20, workedHours: 8.5, pay: 170 });
    expect(absent).toMatchObject({ pay: 0 });
    expect(scheduled).toMatchObject({ workedHours: '', pay: 80 });
    expect(noRate).toMatchObject({ hourlyRate: '', pay: '' });
  });

  it('totals pay per employee, leaving unrated employees blank', () => {
    const summaries = employeeSummaries(timesheetRows(state, '2026-08-03', '2026-08-09'));
    expect(summaries.find((s) => s.employee === 'Ava').pay).toBe(250);
    expect(summaries.find((s) => s.employee === 'Liam').pay).toBe('');
  });

  it('exposes rate and pay in the CSV', () => {
    const csv = timesheetCSV(state, '2026-08-03', '2026-08-09');
    const header = csv.split('\r\n')[0];
    expect(header).toContain('Hourly rate');
    expect(header).toContain('Pay');
  });
});

describe('store hourlyRate handling', () => {
  let store;

  beforeEach(async () => {
    store = createStore(createMemoryBackend());
    await store.init();
  });

  it('normalizes and validates rates', async () => {
    const emp = await store.addEmployee({ name: 'Ava', hourlyRate: '17.5' });
    expect(emp.hourlyRate).toBe(17.5);
    await store.updateEmployee(emp.id, { hourlyRate: '' });
    expect(store.state.employees[0].hourlyRate).toBeNull();
    await expect(store.addEmployee({ name: 'Bo', hourlyRate: -2 })).rejects.toThrow(/rate/i);
  });

  it('defaults the currency setting', () => {
    expect(store.state.settings.currency).toBe('USD');
  });
});

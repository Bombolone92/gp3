import { describe, it, expect, beforeEach } from 'vitest';
import { cleanCell, parseCSV, parseCSVTable } from '../src/core/csv.js';
import {
  EMPLOYEE_FIELDS,
  SHIFT_FIELDS,
  describeImport,
  detectMapping,
  parseImportDate,
  parseImportTime,
  parseNameList,
  planEmployeeImport,
  planShiftImport,
} from '../src/core/import.js';
import { timesheetCSV } from '../src/core/timesheet.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';

describe('parseCSV', () => {
  it('reads plain rows', () => {
    expect(parseCSV('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles quotes, doubled quotes, commas, and newlines inside cells', () => {
    const text = 'name,note\n"Torres, Liam","said ""hi""\nthen left"';
    expect(parseCSV(text)).toEqual([
      ['name', 'note'],
      ['Torres, Liam', 'said "hi"\nthen left'],
    ]);
  });

  it('takes CRLF as one line break and drops a byte-order mark', () => {
    expect(parseCSV('﻿a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      [''],
    ]);
  });

  it('reads an unterminated quote to the end rather than throwing', () => {
    expect(parseCSV('a,b\n"oops,2')).toEqual([
      ['a', 'b'],
      ['oops,2'],
    ]);
  });

  it('takes the exporter’s anti-formula apostrophe back off', () => {
    expect(cleanCell("'=cmd()")).toBe('=cmd()');
    expect(cleanCell('  spaced  ')).toBe('spaced');
  });

  it('splits a table into headers and rows, ignoring blank lines', () => {
    const table = parseCSVTable('h1,h2\r\n\r\na,b\r\nc,d\r\n');
    expect(table.headers).toEqual(['h1', 'h2']);
    expect(table.rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(table.lineNumbers).toEqual([3, 4]);
  });
});

describe('reading the app’s own timesheet export', () => {
  const state = {
    employees: [{ id: 'e1', name: 'Torres, Liam', role: 'Barista', active: true, hourlyRate: 10 }],
    shifts: [
      { id: 's1', date: '2026-08-17', start: '09:00', end: '17:00', role: 'Barista', assigneeId: 'e1', breakMinutes: 30 },
    ],
    attendance: { s1: { status: 'present', clockIn: '09:00', clockOut: '17:00' } },
    availability: {},
    settings: {},
  };

  it('round-trips the detail table, comma in the name included', () => {
    const table = parseCSVTable(timesheetCSV(state, '2026-08-17', '2026-08-17'));
    expect(table.headers[0]).toBe('Date');
    expect(table.rows[0][1]).toBe('Torres, Liam');
    // The summary block rides along as ordinary rows; the mapper is what
    // decides they are not shifts.
    expect(table.rows.length).toBeGreaterThan(1);
  });

  it('maps its columns onto shift fields without help', () => {
    const table = parseCSVTable(timesheetCSV(state, '2026-08-17', '2026-08-17'));
    const mapping = detectMapping(table.headers, SHIFT_FIELDS);
    expect(table.headers[mapping.date]).toBe('Date');
    expect(table.headers[mapping.start]).toBe('Scheduled start');
    expect(table.headers[mapping.end]).toBe('Scheduled end');
    expect(table.headers[mapping.assignee]).toBe('Employee');
    expect(table.headers[mapping.breakMinutes]).toBe('Break minutes');
  });
});

describe('detectMapping', () => {
  it('matches headers whatever their case and punctuation', () => {
    const mapping = detectMapping(['Full Name', 'JOB TITLE', 'e-mail', 'Hourly Rate'], EMPLOYEE_FIELDS);
    expect(mapping).toMatchObject({ name: 0, role: 1, email: 2, hourlyRate: 3 });
    expect(mapping.phone).toBeNull();
  });

  it('prefers an exact alias over a header that merely contains one', () => {
    const mapping = detectMapping(['Start date', 'Start', 'End'], SHIFT_FIELDS);
    expect(mapping.start).toBe(1);
    expect(mapping.date).toBe(0);
  });

  it('never gives one column to two fields', () => {
    const mapping = detectMapping(['Name'], SHIFT_FIELDS);
    const used = Object.values(mapping).filter((v) => v !== null);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe('cell parsing', () => {
  it('reads ISO dates as they stand', () => {
    expect(parseImportDate('2026-08-17')).toBe('2026-08-17');
    expect(parseImportDate('2026-8-7')).toBe('2026-08-07');
    expect(parseImportDate('2026-02-30')).toBeNull();
    expect(parseImportDate('')).toBeNull();
    expect(parseImportDate('next Tuesday')).toBeNull();
  });

  it('reads slashed dates in the order it is told', () => {
    expect(parseImportDate('03/04/2026', 'mdy')).toBe('2026-03-04');
    expect(parseImportDate('03/04/2026', 'dmy')).toBe('2026-04-03');
    expect(parseImportDate('3.4.26', 'dmy')).toBe('2026-04-03');
    expect(parseImportDate('2026/08/17')).toBe('2026-08-17');
  });

  it('reads times on both clocks', () => {
    expect(parseImportTime('09:00')).toBe('09:00');
    expect(parseImportTime('9:00')).toBe('09:00');
    expect(parseImportTime('5:30 PM')).toBe('17:30');
    expect(parseImportTime('12 am')).toBe('00:00');
    expect(parseImportTime('12pm')).toBe('12:00');
    expect(parseImportTime('0900')).toBe('09:00');
    expect(parseImportTime('17')).toBe('17:00');
    expect(parseImportTime('25:00')).toBeNull();
    expect(parseImportTime('lunchtime')).toBeNull();
  });

  it('reads a pasted list of names, dropping blanks and repeats', () => {
    expect(parseNameList('Ava Chen\n\nLiam Torres\nava chen\n  \nNoor Haddad,Barista')).toEqual([
      'Ava Chen',
      'Liam Torres',
      'Noor Haddad',
    ]);
  });
});

describe('planEmployeeImport', () => {
  const state = { employees: [{ id: 'e1', name: 'Ava Chen', active: true }], settings: { roles: [{ id: 'r1', name: 'Barista' }] } };

  it('builds records, flags duplicates, and lists row problems', () => {
    const table = parseCSVTable(
      [
        'Name,Role,Email,Phone,Target,Max,Rate',
        'Liam Torres,Barista,liam@example.com,+1 555 0102,32,40,17.5',
        'Ava Chen,Kitchen,,,,,',
        ',Kitchen,,,,,',
        'Bad Numbers,Kitchen,,,fifty,40,',
        'Bad Email,Kitchen,not-an-address,,,,',
      ].join('\r\n')
    );
    const mapping = detectMapping(table.headers, EMPLOYEE_FIELDS);
    const plan = planEmployeeImport(table, mapping, state);

    expect(plan.entries).toHaveLength(5);
    expect(plan.usable.map((e) => e.data.name)).toEqual(['Liam Torres']);
    expect(plan.entries[0].data).toMatchObject({
      name: 'Liam Torres',
      role: 'Barista',
      email: 'liam@example.com',
      targetHours: 32,
      maxHours: 40,
      hourlyRate: 17.5,
    });
    expect(plan.entries[1].duplicate).toBe(true);
    expect(plan.entries[2].problems[0]).toMatch(/No name/);
    expect(plan.entries[3].problems[0]).toMatch(/Target hours/);
    expect(plan.entries[4].problems[0]).toMatch(/email address/);
    // Only roles the managed list does not have yet, from usable rows.
    expect(plan.roles).toEqual([]);
  });

  it('collects the roles an import would add', () => {
    const table = parseCSVTable('Name,Role\nLiam,Kitchen\nNoor,barista\nMax,Kitchen');
    const plan = planEmployeeImport(table, detectMapping(table.headers, EMPLOYEE_FIELDS), state);
    expect(plan.roles).toEqual(['Kitchen']);
  });

  it('strips a rate written as money', () => {
    const table = parseCSVTable('Name,Hourly rate\nLiam,"$1,250.50"');
    const plan = planEmployeeImport(table, detectMapping(table.headers, EMPLOYEE_FIELDS), state);
    expect(plan.entries[0].data.hourlyRate).toBe(1250.5);
  });
});

describe('planShiftImport', () => {
  const state = {
    employees: [
      { id: 'e1', name: 'Ava Chen', active: true },
      { id: 'e2', name: 'Liam Torres', active: true },
    ],
    settings: { roles: [{ id: 'r1', name: 'Opening' }] },
  };
  const csv = [
    'Date,Start,End,Role,Employee,Break,Note',
    '2026-08-17,7:00 AM,3:00 PM,Opening,Ava Chen,30,Bring keys',
    '2026-08-18,22:00,06:00,Night,Nobody Here,0,',
    'not a date,09:00,17:00,Floor,Liam Torres,,',
    '2026-08-19,09:00,09:00,Floor,Liam Torres,,',
    '2026-08-20,09:00,17:00,,Liam Torres,,',
  ].join('\r\n');

  const table = parseCSVTable(csv);
  const mapping = detectMapping(table.headers, SHIFT_FIELDS);

  it('reads the rows it can and reports the rest', () => {
    const plan = planShiftImport(table, mapping, state);
    expect(plan.entries).toHaveLength(5);
    expect(plan.entries[0].data).toMatchObject({
      date: '2026-08-17',
      start: '07:00',
      end: '15:00',
      role: 'Opening',
      breakMinutes: 30,
      note: 'Bring keys',
    });
    expect(plan.entries[0].assignee).toMatchObject({ kind: 'existing', id: 'e1' });
    expect(plan.entries[2].problems[0]).toMatch(/not a date/);
    expect(plan.entries[3].problems[0]).toMatch(/End time must differ/);
    // A missing role is the editor's own error message, not a new one.
    expect(plan.entries[4].problems[0]).toMatch(/role or label/i);
    expect(plan.usable.map((e) => e.line)).toEqual([2, 3]);
  });

  it('offers an unknown name as a new employee or leaves the shift open', () => {
    const asOpen = planShiftImport(table, mapping, state);
    expect(asOpen.unknownNames).toEqual(['Nobody Here']);
    expect(asOpen.entries[1].assignee).toEqual({ kind: 'open', name: 'Nobody Here' });

    const asNew = planShiftImport(table, mapping, state, { createMissing: true });
    expect(asNew.entries[1].assignee).toEqual({ kind: 'new', name: 'Nobody Here' });
  });

  it('leaves a shift naming an archived person open, and never mistakes them for a new name', () => {
    const withArchived = {
      ...state,
      employees: [...state.employees, { id: 'e3', name: 'Nobody Here', active: false }],
    };
    const asOpen = planShiftImport(table, mapping, withArchived);
    expect(asOpen.entries[1].assignee).toEqual({ kind: 'archived', id: 'e3', name: 'Nobody Here' });
    expect(asOpen.unknownNames).toEqual([]);
    // With unknown names becoming employees, an archived name still is
    // not one: that would create a second person by the same name.
    const asNew = planShiftImport(table, mapping, withArchived, { createMissing: true });
    expect(asNew.entries[1].assignee.kind).toBe('archived');
    expect(asNew.unknownNames).toEqual([]);
    // Where an archived and an active person share a name, the active
    // one answers to it.
    const shared = {
      ...state,
      employees: [{ id: 'e9', name: 'Ava Chen', active: false }, ...state.employees],
    };
    expect(planShiftImport(table, mapping, shared).entries[0].assignee).toMatchObject({
      kind: 'existing',
      id: 'e1',
    });
  });

  it('ignores a name on a row it is going to skip', () => {
    // The unreadable-date row names Liam, who is on the team, so use a
    // stranger: creating an employee for a row that never arrives would
    // leave somebody on the team with no shift and nobody who asked.
    const table = parseCSVTable(
      [
        'Date,Start,End,Role,Employee',
        'not a date,09:00,17:00,Floor,Ghost Person',
        '2026-08-21,09:00,17:00,Floor,Real Person',
      ].join('\r\n')
    );
    const plan = planShiftImport(table, detectMapping(table.headers, SHIFT_FIELDS), state, {
      createMissing: true,
    });
    expect(plan.usable).toHaveLength(1);
    expect(plan.unknownNames).toEqual(['Real Person']);
  });

  it('keeps an overnight shift, since the app has always allowed those', () => {
    const plan = planShiftImport(table, mapping, state);
    expect(plan.entries[1].problems).toEqual([]);
    expect(plan.entries[1].data).toMatchObject({ start: '22:00', end: '06:00' });
  });

  it('follows the date order it is given', () => {
    const dmy = parseCSVTable('Date,Start,End,Role\n03/04/2026,09:00,17:00,Floor');
    const plan = planShiftImport(dmy, detectMapping(dmy.headers, SHIFT_FIELDS), state, {
      dateOrder: 'dmy',
    });
    expect(plan.entries[0].data.date).toBe('2026-04-03');
  });

  it('describes what it would do', () => {
    const plan = planShiftImport(table, mapping, state);
    expect(describeImport(plan, 'shift')).toBe('2 shifts, 3 rows skipped');
  });
});

describe('store.importRecords', () => {
  let store;
  let backend;

  beforeEach(async () => {
    backend = createMemoryBackend();
    store = createStore(backend, { now: () => '2026-08-20T09:00:00.000Z', today: () => '2026-08-20' });
    await store.init();
  });

  it('adds people and shifts, links them by name, and adds their roles', async () => {
    const existing = await store.addEmployee({ name: 'Ava Chen', role: 'Opening' });
    const result = await store.importRecords({
      employees: [{ name: 'Liam Torres', role: 'Barista', targetHours: 32, hourlyRate: '17.5' }],
      shifts: [
        { date: '2026-08-21', start: '09:00', end: '17:00', role: 'Barista', assigneeName: 'liam torres' },
        { date: '2026-08-21', start: '07:00', end: '15:00', role: 'Opening', assigneeName: 'Ava Chen' },
        { date: '2026-08-21', start: '12:00', end: '20:00', role: 'Close', assigneeName: 'Nobody' },
      ],
    });

    expect(result).toMatchObject({ employeesAdded: 1, shiftsAdded: 3, openedShifts: 1 });
    const liam = store.state.employees.find((e) => e.name === 'Liam Torres');
    expect(liam).toMatchObject({ targetHours: 32, hourlyRate: 17.5, active: true });
    expect(store.state.availability[liam.id].days).toHaveLength(7);
    const byRole = new Map(store.state.shifts.map((s) => [s.role, s.assigneeId]));
    expect(byRole.get('Barista')).toBe(liam.id);
    expect(byRole.get('Opening')).toBe(existing.id);
    expect(byRole.get('Close')).toBeNull();
    expect((store.state.settings.roles ?? []).map((r) => r.name)).toEqual(['Barista', 'Close', 'Opening']);
    expect(backend.peek('shifts')).toHaveLength(3);
  });

  it('leaves a shift open when the name it carries belongs to somebody archived', async () => {
    const ava = await store.addEmployee({ name: 'Ava Chen' });
    await store.archiveEmployee(ava.id);
    const result = await store.importRecords({
      shifts: [{ date: '2026-08-21', start: '07:00', end: '15:00', role: 'Opening', assigneeName: 'Ava Chen' }],
    });
    expect(result).toMatchObject({ shiftsAdded: 1, openedShifts: 1 });
    expect(store.state.shifts[0].assigneeId).toBeNull();
    // An id pointing at them is refused outright, like every other write.
    await expect(
      store.importRecords({
        shifts: [{ date: '2026-08-22', start: '07:00', end: '15:00', role: 'Opening', assigneeId: ava.id }],
      })
    ).rejects.toThrow(/archived/);
  });

  it('undoes the whole import, roles and availability included', async () => {
    await store.addEmployee({ name: 'Ava Chen', role: 'Opening' });
    const before = {
      employees: store.state.employees.length,
      shifts: store.state.shifts.length,
      roles: (store.state.settings.roles ?? []).length,
    };
    const { undo } = await store.importRecords({
      employees: [{ name: 'Liam Torres', role: 'Barista' }],
      shifts: [{ date: '2026-08-21', start: '09:00', end: '17:00', role: 'Barista', assigneeName: 'Liam Torres' }],
    });
    await undo();

    expect(store.state.employees).toHaveLength(before.employees);
    expect(store.state.shifts).toHaveLength(before.shifts);
    expect(store.state.settings.roles).toHaveLength(before.roles);
    expect(Object.keys(store.state.availability)).toHaveLength(before.employees);
    expect(backend.peek('employees')).toHaveLength(before.employees);
  });

  it('writes nothing when a row is unusable', async () => {
    await expect(
      store.importRecords({ shifts: [{ date: 'nope', start: '09:00', end: '17:00', role: 'Floor' }] })
    ).rejects.toThrow(/valid date/i);
    expect(store.state.shifts).toEqual([]);

    await expect(store.importRecords({})).rejects.toThrow(/nothing to import/i);
  });

  it('leaves everything already there alone', async () => {
    const ava = await store.addEmployee({ name: 'Ava Chen' });
    const shift = await store.addShift({ date: '2026-08-20', start: '09:00', end: '17:00', role: 'Floor', assigneeId: ava.id });
    await store.importRecords({ employees: [{ name: 'Liam Torres' }] });
    expect(store.state.employees.map((e) => e.name)).toEqual(['Ava Chen', 'Liam Torres']);
    expect(store.state.shifts.map((s) => s.id)).toEqual([shift.id]);
  });
});

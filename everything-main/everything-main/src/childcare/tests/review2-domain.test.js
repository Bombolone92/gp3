import { describe, it, expect } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { invoiceTotal, account, planBillingRun } from '../src/core/billing.js';
import { attendanceName, checkIn, moveRoom, removeEvent, updateEvent, minutesPresent, statusOf, currentRoom, roomRatios, staffClockIn, staffMoveRoom, checkOut } from '../src/core/attendance.js';
import { sendMessage, markRead, isUnread } from '../src/core/messages.js';
import { toICS } from '../src/core/calendar.js';
import { toCSV, parseCSV } from '../src/core/csv.js';
import { exportRosterCSV, importRosterCSV, parseDate } from '../src/core/roster.js';
import { parseMoney } from '../src/core/money.js';
import { ageInMonths, ageLabel, nextBirthday, addMonths } from '../src/core/dates.js';
import { buildSampleData } from '../src/core/sample.js';
import { initials } from '../src/core/format.js';

const DAY = '2026-10-12';
async function store() {
  const s = createStore({ backend: createMemoryBackend(), flushDelay: 10_000 });
  await s.init();
  return s;
}


describe('invoice totals with a quantity of zero', () => {
  it('counts a zero-quantity line as nothing, like the statement shows it', () => {
    expect(invoiceTotal({ items: [{ amountCents: 5000, qty: 0 }, { amountCents: 1000, qty: 2 }] })).toBe(2000);
  });
  it('still treats a missing quantity as one', () => {
    expect(invoiceTotal({ items: [{ amountCents: 5000 }, { amountCents: 100, qty: null }, { amountCents: 7, qty: '' }] })).toBe(5107);
  });
  it('balances a statement whose only line has quantity zero as paid', () => {
    const a = account('k1', [{ id: 'i1', studentId: 'k1', dueDate: '2026-10-01', items: [{ amountCents: 5000, qty: 0 }], status: 'open' }], [], DAY);
    expect(a.balance).toBe(0);
    expect(a.overdue).toBe(0);
  });
});

describe('attendance: a room move is not a check-in', () => {
  it('does not show a child as here after their check-in is removed', async () => {
    const s = await store();
    checkIn(s, DAY, 'k1', { roomId: 'r1', at: '08:00' });
    moveRoom(s, DAY, 'k1', 'r2', { at: '10:00' });
    // Edit times: the check-in was a mistaken tap.
    const rec = removeEvent(s, DAY, 's-k1', 0);
    expect(rec.events.map((e) => e.type)).toEqual(['move']);
    expect(statusOf(rec)).toBe('none');
    expect(currentRoom(rec)).toBeNull();
    const { rows } = roomRatios([{ id: 'r2', ratio: 4 }], s.all(attendanceName(DAY)));
    expect(rows[0].students).toBe(0);
  });
  it('a move recorded after a check-out does not bring the child back', async () => {
    const s = await store();
    checkIn(s, DAY, 'k1', { roomId: 'r1', at: '08:00' });
    checkOut(s, DAY, 'k1', { at: '12:00' });
    moveRoom(s, DAY, 'k1', 'r2', { at: '12:05' });
    const rec = s.get(attendanceName(DAY), 's-k1');
    expect(statusOf(rec)).toBe('out');
    expect(currentRoom(rec)).toBeNull();
  });
  it('still follows moves while checked in, for children and staff', async () => {
    const s = await store();
    checkIn(s, DAY, 'k1', { roomId: 'r1', at: '08:00' });
    moveRoom(s, DAY, 'k1', 'r2', { at: '09:00' });
    staffClockIn(s, DAY, 'm1', { roomId: 'r1', at: '07:00' });
    staffMoveRoom(s, DAY, 'm1', 'r2', { at: '09:00' });
    const { rows } = roomRatios([{ id: 'r1', ratio: 4 }, { id: 'r2', ratio: 4 }], s.all(attendanceName(DAY)));
    expect(rows.map((r) => [r.students, r.staff])).toEqual([[0, 0], [1, 1]]);
  });
});

describe('messages: reading with a clock behind the sender', () => {
  it('marks a conversation read even when this device clock is behind the last message', async () => {
    const s = await store();
    sendMessage(s, { studentId: 'k1', text: 'Hi', from: 'family', author: 'Mia', authorUuid: 'u1', at: '2026-10-12T08:00:00.000Z' });
    markRead(s, 'k1', { role: 'staff', at: '2026-10-12T07:58:00.000Z' });
    expect(isUnread(s.get('threads', 'k1'), { role: 'staff' })).toBe(false);
    // The thread view calls markRead after every render: it must settle, not write forever.
    const before = s.get('threads', 'k1');
    markRead(s, 'k1', { role: 'staff', at: '2026-10-12T07:58:30.000Z' });
    expect(s.get('threads', 'k1')).toBe(before);
    sendMessage(s, { studentId: 'k1', text: 'Hello', from: 'staff', author: 'Tess', at: '2026-10-12T08:10:00.000Z' });
    markRead(s, 'k1', { role: 'family', uuid: 'u1', at: '2026-10-12T08:09:00.000Z' });
    expect(isUnread(s.get('threads', 'k1'), { role: 'family', uuid: 'u1' })).toBe(false);
  });
});

describe('iCalendar export', () => {
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  it('never splits an emoji when folding long lines', () => {
    for (let n = 55; n < 80; n++) {
      const ics = toICS([{ id: 'e', title: `${'a'.repeat(n)}😀🎃 party`, date: DAY }]);
      for (const line of ics.split('\r\n')) {
        expect(lone.test(line), `n=${n}: ${line}`).toBe(false);
        expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
      }
      const unfolded = ics.replace(/\r\n /g, '');
      expect(unfolded).toContain(`SUMMARY:${'a'.repeat(n)}😀🎃 party`);
    }
  });
  it('escapes a bare carriage return so it cannot end the line', () => {
    const ics = toICS([{ id: 'e', title: 'One\rTwo', date: DAY, description: 'a\r\nb\rc' }]);
    expect(ics.replace(/\r\n/g, '')).not.toContain('\r');
    expect(ics).toContain('SUMMARY:One\\nTwo');
    expect(ics).toContain('DESCRIPTION:a\\nb\\nc');
  });
  it('never writes an end before the start of a timed event', () => {
    const ics = toICS([{ id: 'e', title: 'Drill', date: DAY, allDay: false, start: '10:00', end: '09:30' }, { id: 'f', title: 'Quick', date: DAY, allDay: false, start: '10:00', end: '' }]);
    expect(ics).not.toContain('DTEND:20261012T093000');
    const ends = [...ics.matchAll(/DTEND:(\S+)/g)].map((m) => m[1]);
    for (const e of ends) expect(e > '20261012T100000').toBe(true);
    expect(toICS([{ id: 'g', title: 'Party', date: DAY, allDay: false, start: '10:00', end: '11:30' }])).toContain('DTEND:20261012T113000');
  });
});

describe('CSV export of negative amounts', () => {
  it('keeps negative numbers and credits as numbers, not text', () => {
    expect(toCSV([[-5, '-12.50', '-$1,234.50']])).toBe('-5,-12.50,"-$1,234.50"\r\n');
  });
  it('still neutralizes formulas that start with a minus or plus', () => {
    expect(toCSV([['-2+3', '+SUM(A1)', '-A1', '=1', '@cmd']])).toBe("'-2+3,'+SUM(A1),'-A1,'=1,'@cmd\r\n");
  });
});

describe('roster CSV round trip', () => {
  it('keeps phone numbers that start with + and names that start with -', () => {
    const csv = exportRosterCSV({
      students: [{ id: 'k1', firstName: '-Ana', lastName: 'Ruiz', status: 'active' }],
      guardians: [{ id: 'g1', firstName: 'Eva', lastName: 'Ruiz', phone: '+1 541 555 0100', email: 'eva@example.com', studentIds: ['k1'], primary: true }],
      rooms: [],
    });
    expect(csv).toContain("'+1 541 555 0100");
    const res = importRosterCSV(csv);
    expect(res.students[0].firstName).toBe('-Ana');
    expect(res.guardians[0].phone).toBe('+1 541 555 0100');
  });
  it('rejects impossible ISO dates', () => {
    expect(parseDate('2022-02-30')).toBe('');
    expect(parseDate('2022-13-01')).toBe('');
    expect(parseDate('2024-02-29')).toBe('2024-02-29');
  });
  it('reads two-digit years in the past, not 70 years ahead', () => {
    expect(parseDate('3/7/95')).toBe('1995-03-07');
    expect(parseDate('3/7/22')).toBe('2022-03-07');
  });
});

describe('parseMoney with comma decimals', () => {
  it('reads a comma decimal the way European locales type it', () => {
    expect(parseMoney('12,50')).toBe(1250);
    expect(parseMoney('1.234,50')).toBe(123450);
    expect(parseMoney('1 234,5')).toBe(123450);
    expect(parseMoney('12,5 €')).toBe(1250);
    expect(parseMoney('1.234.567')).toBe(123456700);
  });
  it('keeps reading comma thousands separators', () => {
    expect(parseMoney('1,234')).toBe(123400);
    expect(parseMoney('1,234.50')).toBe(123450);
    expect(parseMoney('1,234,567')).toBe(123456700);
    expect(parseMoney('$12')).toBe(1200);
    expect(parseMoney('-3')).toBe(-300);
    expect(parseMoney('0.125')).toBe(13);
  });
  it('reads a minus after the currency symbol', () => {
    expect(parseMoney('$-3.00')).toBe(-300);
    expect(parseMoney('-$3.00')).toBe(-300);
  });
});

describe('age at the end of a short month', () => {
  it('a Feb 29 child turns a year older on Feb 28, as the birthday list says', () => {
    expect(nextBirthday('2024-02-29', '2027-02-01')).toBe('2027-02-28');
    expect(ageInMonths('2024-02-29', '2027-02-28')).toBe(36);
    expect(ageLabel('2024-02-29', '2027-02-28')).toBe('3 yr');
    expect(ageInMonths('2024-02-29', '2027-02-27')).toBe(35);
  });
  it('agrees with addMonths for month-end birthdays', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(ageInMonths('2026-01-31', '2026-02-28')).toBe(1);
    expect(ageInMonths('2026-01-31', '2026-02-27')).toBe(0);
    expect(ageInMonths('2026-03-31', '2026-04-30')).toBe(1);
    expect(ageInMonths('2026-03-30', '2026-04-29')).toBe(0);
  });
});

describe('billing runs and start dates', () => {
  const plans = [{ id: 'p', name: 'Tuition', amountCents: 100000, frequency: 'monthly' }, { id: 'w', name: 'Part time', amountCents: 20000, frequency: 'weekly' }];
  it('does not bill a child for a period before they start', () => {
    const students = [
      { id: 'a', status: 'active', startDate: '2026-11-01', plans: [{ planId: 'p' }] },
      { id: 'b', status: 'active', startDate: '2026-10-31', plans: [{ planId: 'p' }] },
      { id: 'c', status: 'active', plans: [{ planId: 'p' }] },
    ];
    const { drafts } = planBillingRun({ students, plans, invoices: [] }, { frequency: 'monthly', day: '2026-10-12' });
    expect(drafts.map((d) => d.studentId)).toEqual(['b', 'c']);
  });
  it('uses the week end for weekly plans', () => {
    const students = [
      { id: 'a', status: 'active', startDate: '2026-10-18', plans: [{ planId: 'w' }] },
      { id: 'b', status: 'active', startDate: '2026-10-19', plans: [{ planId: 'w' }] },
    ];
    const { drafts } = planBillingRun({ students, plans, invoices: [] }, { frequency: 'weekly', day: '2026-10-14' });
    expect(drafts.map((d) => d.studentId)).toEqual(['a']);
  });
});

describe('demo data consistency', () => {
  const data = buildSampleData(DAY, { now: new Date(2026, 9, 12, 10, 0) });
  const C = data.collections;
  it('has no nap today that ends after the current time', () => {
    for (const a of C[`activities:${DAY}`] || []) if (a.type === 'nap' && a.details.end) expect(a.details.end <= '10:00', JSON.stringify(a.details)).toBe(true);
  });
  it('never starts a child before they were born', () => {
    for (const s of C.students) if (s.startDate && s.birthday) expect(s.startDate >= s.birthday, `${s.birthday} ${s.startDate}`).toBe(true);
  });
  it('picks children up with people on their family list', () => {
    const names = new Set(C.guardians.map((g) => `${g.firstName} ${g.lastName}`));
    for (const [k, recs] of Object.entries(C)) {
      if (!k.startsWith('attendance:')) continue;
      for (const r of recs) for (const e of r.events || []) if (e.person) expect(names.has(e.person), e.person).toBe(true);
    }
  });
  it('puts Thanksgiving on the fourth Thursday of November next year', () => {
    const d = buildSampleData('2029-12-03', { now: new Date(2029, 11, 3, 10, 0) });
    expect(d.collections.events.find((e) => e.title === 'Closed: Thanksgiving').date).toBe('2030-11-28');
    for (const [day, want] of [['2026-10-12', '2026-11-26'], ['2026-11-26', '2026-11-26'], ['2026-11-27', '2027-11-25'], ['2027-01-04', '2027-11-25']]) {
      expect(buildSampleData(day, { now: new Date(2026, 0, 1) }).collections.events.find((e) => e.title === 'Closed: Thanksgiving').date).toBe(want);
    }
  });
});

describe('initials from whole characters', () => {
  it('keeps letters outside the BMP whole', () => {
    expect(initials('𠮷田 花子')).toBe('𠮷花');
    expect(initials('𠮷田')).toBe('𠮷田');
  });
  it('keeps a decomposed accent with its letter', () => {
    expect(initials('Émile')).toBe('ÉM');
    expect(initials('Émile Zola')).toBe('ÉZ');
  });
});

describe('attendance: clearing a time while editing', () => {
  it('keeps the recorded time instead of erasing it', async () => {
    const s = await store();
    checkIn(s, DAY, 'k1', { roomId: 'r1', at: '08:00' });
    checkOut(s, DAY, 'k1', { at: '12:00' });
    const rec = updateEvent(s, DAY, 's-k1', 0, { at: '' });
    expect(rec.events[0].at).toBe('08:00');
    expect(minutesPresent(rec)).toBe(240);
    expect(updateEvent(s, DAY, 's-k1', 0, { at: '08:30' }).events[0].at).toBe('08:30');
  });
});

describe('CSV: a stray quote inside an unquoted field', () => {
  it('reads it literally instead of swallowing the rest of the file', () => {
    expect(parseCSV('a,5" tall,c\nd,e,f')).toEqual([['a', '5" tall', 'c'], ['d', 'e', 'f']]);
    expect(parseCSV('Ava,O"Brien\r\nNoah,Chen')).toEqual([['Ava', 'O"Brien'], ['Noah', 'Chen']]);
  });
  it('still reads quoted fields, empty quoted fields and a BOM', () => {
    expect(parseCSV('﻿"a","",x\n"b ""q""","multi\nline",y')).toEqual([['a', '', 'x'], ['b "q"', 'multi\nline', 'y']]);
  });
});

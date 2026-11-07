import { describe, it, expect } from 'vitest';
import { importRosterCSV, exportRosterCSV, parseDate } from '../src/core/roster.js';

describe('roster CSV', () => {
  it('parses common date formats', () => {
    expect(parseDate('2022-03-07')).toBe('2022-03-07');
    expect(parseDate('3/7/2022')).toBe('2022-03-07');
    expect(parseDate('25/12/2021')).toBe('2021-12-25');
    expect(parseDate('2/30/2022')).toBe('');
    expect(parseDate('soon')).toBe('');
  });

  it('imports children, creates rooms by name, and shares parents between siblings', () => {
    const csv = ['Child name,DOB,Classroom,Allergies,Parent name,Parent email,Parent phone', 'Ava Chen,3/7/2022,Toddlers,Peanuts,Lin Chen,lin@example.com,555', 'Leo Chen,1/2/2020,Preschool,,Lin Chen,LIN@example.com,555', ',,,,,,'].join('\n');
    const res = importRosterCSV(csv, { rooms: [{ id: 'r1', name: 'toddlers' }] });
    expect(res.students.map((s) => [s.firstName, s.lastName, s.birthday, s.allergies])).toEqual([
      ['Ava', 'Chen', '2022-03-07', 'Peanuts'],
      ['Leo', 'Chen', '2020-01-02', ''],
    ]);
    expect(res.students[0].roomId).toBe('r1');
    expect(res.rooms.map((r) => r.name)).toEqual(['Preschool']);
    expect(res.guardians).toHaveLength(1);
    expect(res.guardians[0].studentIds).toHaveLength(2);
  });

  it('round-trips through export', () => {
    const rooms = [{ id: 'r1', name: 'Bees' }];
    const students = [{ id: 's1', firstName: 'Ava', lastName: 'Chen', birthday: '2022-03-07', status: 'active', roomId: 'r1', allergies: 'Peanuts, eggs' }];
    const guardians = [{ id: 'g1', firstName: 'Lin', lastName: 'Chen', relation: 'Mother', email: 'lin@example.com', phone: '555', studentIds: ['s1'] }];
    const back = importRosterCSV(exportRosterCSV({ students, guardians, rooms }), { rooms });
    expect(back.students[0]).toMatchObject({ firstName: 'Ava', allergies: 'Peanuts, eggs', roomId: 'r1', birthday: '2022-03-07' });
    expect(back.guardians[0]).toMatchObject({ firstName: 'Lin', relation: 'Mother', email: 'lin@example.com' });
  });
});

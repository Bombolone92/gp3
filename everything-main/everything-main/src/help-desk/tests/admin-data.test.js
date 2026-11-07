import { describe, it, expect } from 'vitest';
import { csvCell, ticketsCsv } from '../src/views/admin-data.js';

describe('ticket CSV export', () => {
  it('quotes cells and neutralizes spreadsheet formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell(['x', 'y'])).toBe('x y');
    expect(csvCell(null)).toBe('');
  });

  it('writes one row per ticket in id order', () => {
    const csv = ticketsCsv([
      { id: 2, subject: 'Second', status: 'open', priority: 'high', type: null, via: 'portal', requester: 7, org: null, assignee: 'u1', group: 'g', tags: ['a', 'b'], createdAt: 0, updatedAt: 0 },
      { id: 1, subject: 'First, with comma', status: 'solved', priority: null, type: 'question', via: 'web', requester: 8, org: 3, assignee: null, group: null, tags: [], createdAt: 0, updatedAt: 0, csat: { score: 'good' } },
    ], { userName: (id) => `User ${id}`, memberName: () => 'Agent A', groupName: () => 'Support', orgName: () => 'Org' });
    const lines = csv.split('\r\n');
    expect(lines[0].startsWith('ID,Subject,Status')).toBe(true);
    expect(lines[1]).toContain('1,"First, with comma",Solved');
    expect(lines[1]).toContain('Org');
    expect(lines[1].endsWith(',good')).toBe(true);
    expect(lines[2]).toContain('2,Second,Open,High');
    expect(lines[2]).toContain('Agent A,Support,a b');
  });
});

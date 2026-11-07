import { describe, it, expect } from 'vitest';
import { displayNumber, clientKey, conflictSearch, matterDescriptionHits, tasksFromList, matterParties, solDaysLeft } from '../src/core/matters.js';
import { contactName, matches, normalize, padNumber } from '../src/core/format.js';

const lopez = { id: 'c1', type: 'person', firstName: 'Amara', lastName: 'López', emails: [{ address: 'amara@example.com' }], phones: [{ number: '555 201 4410' }] };
const acme = { id: 'c2', type: 'company', companyName: 'Acme Freight LLC', emails: [], phones: [] };
const opp = { id: 'c3', type: 'person', firstName: 'Victor', lastName: 'Sorensen' };

describe('matter numbers', () => {
  it('formats by firm preference', () => {
    expect(displayNumber(12, { client: lopez })).toBe('00012-López');
    expect(displayNumber(12, { client: acme })).toBe('00012-Acme');
    expect(displayNumber(12, { format: 'number' })).toBe('00012');
    expect(displayNumber(12, { format: 'year-number', openDate: '2026-03-01' })).toBe('2026-00012');
    expect(displayNumber(3, { client: null })).toBe('00003');
  });

  it('strips punctuation from the client key', () => {
    expect(clientKey({ type: 'person', lastName: "O'Brien-Smith" })).toBe('OBrien-Smith');
    expect(padNumber(7)).toBe('00007');
  });
});

describe('conflict search', () => {
  const matters = [
    { id: 'm1', clientId: 'c1', description: 'López v. Kestrel Motors', related: [{ contactId: 'c3', relationship: 'Opposing counsel' }] },
    { id: 'm2', clientId: 'c2', description: 'Freight contract', related: [{ contactId: 'c1', relationship: 'Witness' }] },
  ];
  const contacts = [lopez, acme, opp];

  it('finds people ignoring accents and case, with every matter they touch', () => {
    const hits = conflictSearch('amara lopez', { contacts, matters });
    expect(hits[0].contact.id).toBe('c1');
    expect(hits[0].matters.map((x) => `${x.matter.id}:${x.relationship}`)).toEqual(['m1:Client', 'm2:Witness']);
  });

  it('matches emails and phone numbers, and partial words', () => {
    expect(conflictSearch('amara@example', { contacts, matters })[0].contact.id).toBe('c1');
    expect(conflictSearch('soren', { contacts, matters })[0].contact.id).toBe('c3');
    expect(conflictSearch('acme', { contacts, matters })[0].matters[0].relationship).toBe('Client');
  });

  it('ranks an exact name first and ignores short queries', () => {
    expect(conflictSearch('Victor Sorensen', { contacts, matters })[0].score).toBe(100);
    expect(conflictSearch('a', { contacts, matters })).toEqual([]);
  });

  it('also searches matter descriptions', () => {
    expect(matterDescriptionHits('kestrel', matters).map((m) => m.id)).toEqual(['m1']);
    expect(matterParties(matters[0])).toHaveLength(2);
  });
});

describe('task lists', () => {
  it('creates tasks with due dates from the start date and role assignees', () => {
    const list = {
      id: 'tl',
      items: [
        { name: 'Send letter', dueOffset: 2, assignee: 'staff', priority: 'high' },
        { name: 'Open file', dueOffset: null },
      ],
    };
    const tasks = tasksFromList(list, { id: 'm1', responsibleId: 'u1', staffId: 'u2' }, '2026-10-30');
    expect(tasks[0]).toMatchObject({ name: 'Send letter', dueDate: '2026-11-01', assigneeId: 'u2', priority: 'high', matterId: 'm1', done: false, listId: 'tl' });
    expect(tasks[1]).toMatchObject({ dueDate: '', assigneeId: 'u1', priority: 'normal' });
    expect(tasks[0].id).not.toBe(tasks[1].id);
  });
});

describe('format helpers', () => {
  it('names contacts', () => {
    expect(contactName(lopez)).toBe('Amara López');
    expect(contactName(acme)).toBe('Acme Freight LLC');
    expect(contactName({ type: 'person' })).toBe('Unnamed contact');
  });

  it('matches every word, ignoring accents', () => {
    expect(matches('Amara López estate', 'lopez amara')).toBe(true);
    expect(matches('Amara López', 'smith')).toBe(false);
    expect(normalize('Ça')).toBe('ca');
  });

  it('counts down to the statute of limitations', () => {
    expect(solDaysLeft({ solDate: '2026-10-20' }, '2026-10-10')).toBe(10);
    expect(solDaysLeft({ solDate: '2026-10-20', solSatisfied: true }, '2026-10-10')).toBeNull();
    expect(solDaysLeft({}, '2026-10-10')).toBeNull();
  });
});

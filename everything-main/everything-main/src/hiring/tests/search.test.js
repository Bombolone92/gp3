import { describe, it, expect } from 'vitest';
import { quickFind } from '../src/core/search.js';

const NOW = new Date('2026-03-10T10:00:00');

const state = {
  jobs: [
    { id: 'j1', title: 'Frontend Engineer', status: 'open', location: 'Berlin' },
    { id: 'j2', title: 'Designer', status: 'closed', location: '' },
  ],
  candidates: [
    { id: 'c1', name: 'Dana Frost', email: 'dana@frost.dev', jobId: 'j1', status: 'active' },
    { id: 'c2', name: 'Alex Fondaner', email: 'alex@x.io', jobId: 'j2', status: 'rejected' },
    { id: 'c3', name: 'Bo Chen', email: 'bo@chen.dev', jobId: 'j1', status: 'active' },
  ],
  interviews: [
    { id: 'i1', candidateId: 'c1', jobId: 'j1', date: '2026-03-12', start: '10:00', end: '11:00', type: 'video', interviewers: ['Sam Frost'] },
  ],
};

describe('quickFind', () => {
  it('is empty for a blank query', () => {
    expect(quickFind(state, '')).toEqual([]);
    expect(quickFind(state, '   ')).toEqual([]);
  });

  it('finds candidates by name and email, case-insensitively', () => {
    expect(quickFind(state, 'DANA', { now: NOW })[0]).toMatchObject({ type: 'candidate', route: 'candidates/c1' });
    expect(quickFind(state, 'bo@chen', { now: NOW })[0]).toMatchObject({ route: 'candidates/c3' });
  });

  it('ranks prefix matches above word starts above substrings', () => {
    const results = quickFind(state, 'f', { now: NOW });
    // 'Frontend Engineer' (job, prefix) vs 'Dana Frost' (word start) vs 'Alex Fondaner' (word start)
    expect(results[0].title).toBe('Frontend Engineer');
    const dana = results.findIndex((r) => r.title === 'Dana Frost');
    expect(dana).toBeGreaterThan(-1);
  });

  it('candidates outrank jobs at equal score', () => {
    const results = quickFind(state, 'd', { now: NOW });
    // Dana (candidate, prefix on name) before Designer (job, prefix).
    expect(results[0]).toMatchObject({ type: 'candidate', title: 'Dana Frost' });
    expect(results[1]).toMatchObject({ type: 'job', title: 'Designer' });
  });

  it('marks archived candidates and closed jobs', () => {
    const results = quickFind(state, 'alex', { now: NOW });
    expect(results[0].archived).toBe(true);
    expect(quickFind(state, 'designer', { now: NOW })[0].archived).toBe(true);
  });

  it('finds interviews by interviewer and routes to the candidate', () => {
    const results = quickFind(state, 'sam frost', { now: NOW });
    expect(results[0]).toMatchObject({ type: 'interview', route: 'candidates/c1' });
    expect(results[0].subtitle).toMatch(/Mar 12/);
  });

  it('finds candidates by tag, and says which tag matched', () => {
    const tagged = {
      ...state,
      candidates: [
        { id: 'c1', name: 'Dana Frost', email: 'dana@frost.dev', jobId: 'j1', status: 'active', tags: ['needs sponsorship'] },
        { id: 'c2', name: 'Alex Fondaner', email: 'alex@x.io', jobId: 'j2', status: 'rejected', pool: { tags: ['silver medalist'] } },
      ],
    };
    const sponsorship = quickFind(tagged, 'sponsorship', { now: NOW });
    expect(sponsorship[0]).toMatchObject({ route: 'candidates/c1' });
    expect(sponsorship[0].subtitle).toMatch(/tagged “needs sponsorship”/);
    // A label an old pool entry carried is still findable.
    expect(quickFind(tagged, 'silver', { now: NOW })[0]).toMatchObject({ route: 'candidates/c2' });
  });

  it('finds candidates by note text, with the matching phrase in the row', () => {
    const noted = {
      ...state,
      candidates: [
        { id: 'c1', name: 'Dana Frost', email: 'dana@frost.dev', jobId: 'j1', status: 'active', notes: 'Ten years of great Rust experience, wants to lead.' },
      ],
    };
    const results = quickFind(noted, 'rust', { now: NOW });
    expect(results[0]).toMatchObject({ route: 'candidates/c1' });
    expect(results[0].subtitle).toMatch(/Rust experience/);
  });

  it('ranks a note match below every field match', () => {
    const mixed = {
      ...state,
      jobs: [{ id: 'j1', title: 'Frontend Engineer', status: 'open' }],
      candidates: [
        { id: 'c1', name: 'Zoe Rust', email: '', jobId: 'j1', status: 'active' },
        { id: 'c2', name: 'Bo Chen', email: '', jobId: 'j1', status: 'active', notes: 'Rust all day' },
      ],
      interviews: [],
    };
    expect(quickFind(mixed, 'rust', { now: NOW }).map((r) => r.title)).toEqual(['Zoe Rust', 'Bo Chen']);
  });

  it('caps the result count', () => {
    const many = {
      ...state,
      candidates: Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, name: `Zed ${i}`, email: '', jobId: 'j1', status: 'active' })),
    };
    expect(quickFind(many, 'zed', { limit: 5 })).toHaveLength(5);
  });

  it('escapes regex specials in the query', () => {
    expect(() => quickFind(state, 'a(b', { now: NOW })).not.toThrow();
  });
});

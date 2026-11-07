import { describe, it, expect } from 'vitest';
import { archivedAt, retentionDue } from '../src/core/retention.js';

const NOW = new Date('2026-03-10T10:00:00Z');

function archived(id, at, extra = {}) {
  return {
    id,
    name: id,
    status: 'rejected',
    stage: 'screen',
    stageChangedAt: at,
    createdAt: at,
    history: [{ at, type: 'rejected', reason: '' }],
    ...extra,
  };
}

describe('archivedAt', () => {
  it('prefers the last archive event, falling back to stageChangedAt', () => {
    const c = archived('a', '2025-01-01T00:00:00Z');
    c.history.push({ at: '2025-06-01T00:00:00Z', type: 'restored' });
    c.history.push({ at: '2025-07-01T00:00:00Z', type: 'withdrawn' });
    expect(archivedAt(c)).toBe('2025-07-01T00:00:00Z');
    expect(archivedAt({ stageChangedAt: '2025-02-02T00:00:00Z', history: [] })).toBe('2025-02-02T00:00:00Z');
  });
});

describe('retentionDue', () => {
  const state = (candidates, retentionMonths) => ({ settings: { retentionMonths }, candidates });

  it('is empty when retention is off', () => {
    const old = archived('old', '2024-01-01T00:00:00Z');
    expect(retentionDue(state([old], null), NOW)).toEqual([]);
    expect(retentionDue(state([old], 0), NOW)).toEqual([]);
  });

  it('lists archived candidates past the window, oldest first', () => {
    const ancient = archived('ancient', '2025-01-01T00:00:00Z');
    const old = archived('old', '2025-08-01T00:00:00Z');
    const recent = archived('recent', '2026-01-01T00:00:00Z');
    const due = retentionDue(state([recent, old, ancient], 6), NOW);
    expect(due.map((d) => d.candidate.id)).toEqual(['ancient', 'old']);
  });

  it('does not overflow into the next month at a month end', () => {
    // Six months before Aug 31 is Feb 28, not "Feb 31" (= Mar 3).
    const now = new Date(2026, 7, 31, 12, 0);
    const inside = archived('inside', new Date(2026, 2, 1, 12, 0).toISOString());
    const past = archived('past', new Date(2026, 1, 27, 12, 0).toISOString());
    expect(retentionDue(state([inside, past], 6), now).map((d) => d.candidate.id)).toEqual(['past']);
  });

  it('never lists active candidates or talent-pool members', () => {
    const active = { ...archived('active', '2024-01-01T00:00:00Z'), status: 'active' };
    const pooled = archived('pooled', '2024-01-01T00:00:00Z', { pool: { addedAt: '2024-02-01T00:00:00Z', tags: [] } });
    expect(retentionDue(state([active, pooled], 6), NOW)).toEqual([]);
  });
});

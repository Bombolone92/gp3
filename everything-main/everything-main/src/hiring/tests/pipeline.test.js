import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STAGES,
  STAGES,
  activeCandidates,
  daysInStage,
  funnelCounts,
  isValidStage,
  nextStage,
  onActiveCandidates,
  stageIndex,
  stageLabel,
  stagesFrom,
  staleCandidates,
} from '../src/core/pipeline.js';

const NOW = new Date('2026-03-20T12:00:00Z');

const candidate = (stage, status = 'active', stageChangedAt = '2026-03-18T12:00:00Z', jobId = 'j1') => ({
  stage,
  status,
  stageChangedAt,
  createdAt: stageChangedAt,
  jobId,
});

describe('stage helpers', () => {
  it('orders stages applied → hired', () => {
    expect(STAGES.map((s) => s.key)).toEqual(['applied', 'screen', 'interview', 'offer', 'hired']);
  });

  it('validates and indexes stages', () => {
    expect(isValidStage('screen')).toBe(true);
    expect(isValidStage('limbo')).toBe(false);
    expect(stageIndex('interview')).toBe(2);
    expect(stageLabel('offer')).toBe('Offer');
  });

  it('walks to the next stage and stops at the end', () => {
    expect(nextStage('applied')).toBe('screen');
    expect(nextStage('offer')).toBe('hired');
    expect(nextStage('hired')).toBeNull();
    expect(nextStage('unknown')).toBeNull();
  });
});

describe('funnelCounts', () => {
  it('counts only active candidates, with zeroes for empty stages', () => {
    const counts = funnelCounts([
      candidate('applied'),
      candidate('applied'),
      candidate('screen', 'rejected'),
      candidate('hired'),
    ]);
    expect(counts).toEqual({ applied: 2, screen: 0, interview: 0, offer: 0, hired: 1 });
  });

  it('scopes to a job when given one', () => {
    const counts = funnelCounts(
      [candidate('applied', 'active', undefined, 'j1'), candidate('applied', 'active', undefined, 'j2')],
      'j2'
    );
    expect(counts.applied).toBe(1);
  });
});

describe('activeCandidates', () => {
  it('filters archived candidates out', () => {
    const list = [candidate('applied'), candidate('screen', 'withdrawn'), candidate('offer', 'rejected')];
    expect(activeCandidates(list)).toHaveLength(1);
  });
});

describe('onActiveCandidates', () => {
  const people = [
    { id: 'c1', status: 'active', stage: 'interview' },
    { id: 'c2', status: 'rejected', stage: 'interview' },
    { id: 'c3', status: 'withdrawn', stage: 'offer' },
  ];

  it('keeps only records whose candidate is still on the board', () => {
    const records = [{ candidateId: 'c1' }, { candidateId: 'c2' }, { candidateId: 'c3' }];
    expect(onActiveCandidates(records, people).map((r) => r.candidateId)).toEqual(['c1']);
  });

  it('keeps a record whose candidate is gone entirely', () => {
    const records = [{ candidateId: 'ghost' }, { candidateId: 'c2' }];
    expect(onActiveCandidates(records, people).map((r) => r.candidateId)).toEqual(['ghost']);
  });

  it('returns an empty list for no records, and never mutates its input', () => {
    const records = [{ candidateId: 'c2' }, { candidateId: 'c1' }];
    expect(onActiveCandidates([], people)).toEqual([]);
    onActiveCandidates(records, people);
    expect(records.map((r) => r.candidateId)).toEqual(['c2', 'c1']);
  });
});

describe('configurable stages', () => {
  const settings = {
    stages: [
      { key: 'applied', label: 'Applied' },
      { key: 'screen', label: 'Phone screen' },
      { key: 'stg_take', label: 'Take-home' },
      { key: 'offer', label: 'Offer' },
      { key: 'hired', label: 'Hired' },
    ],
  };

  it('falls back to the defaults when nothing is configured', () => {
    expect(stagesFrom(null)).toEqual(DEFAULT_STAGES);
    expect(stagesFrom({})).toEqual(DEFAULT_STAGES);
    expect(stagesFrom({ stages: [] })).toEqual(DEFAULT_STAGES);
  });

  it('applies renames and custom stages, and drops removed defaults', () => {
    const list = stagesFrom(settings);
    expect(list.map((s) => s.key)).toEqual(['applied', 'screen', 'stg_take', 'offer', 'hired']);
    expect(list[1].label).toBe('Phone screen');
    expect(list[1].icon).toBe('phone-call');
    expect(list[2].icon).toBe('milestone');
    expect(list[2].color).toContain('--stage-custom-1');
  });

  it('pins applied, hired, and offer even when a hand-edited config drops them', () => {
    const list = stagesFrom({ stages: [{ key: 'stg_only', label: 'Only stage' }] });
    expect(list[0].key).toBe('applied');
    expect(list.at(-1).key).toBe('hired');
    expect(list.some((s) => s.key === 'offer')).toBe(true);
  });

  it('drops malformed, blank, and duplicate entries', () => {
    const list = stagesFrom({
      stages: [
        { key: 'bad key!', label: 'Nope' },
        { key: 'stg_a', label: '   ' },
        { key: 'stg_b', label: 'Good' },
        { key: 'stg_b', label: 'Twin' },
        { key: 'offer', label: 'Offer' },
      ],
    });
    expect(list.map((s) => s.key)).toEqual(['applied', 'stg_b', 'offer', 'hired']);
  });

  it('validates, labels, and walks the configured order', () => {
    expect(isValidStage('stg_take', settings)).toBe(true);
    expect(isValidStage('interview', settings)).toBe(false);
    expect(nextStage('stg_take', settings)).toBe('offer');
    expect(nextStage('screen', settings)).toBe('stg_take');
    expect(stageLabel('screen', settings)).toBe('Phone screen');
  });

  it('labels removed stages from retiredStages, then the defaults', () => {
    const withRetired = { ...settings, retiredStages: { stg_gone: 'Trial day' } };
    expect(stageLabel('stg_gone', withRetired)).toBe('Trial day');
    expect(stageLabel('interview', settings)).toBe('Interview');
    expect(stageLabel('stg_unknown', settings)).toBe('stg_unknown');
  });

  it('counts the funnel over configured stages', () => {
    const counts = funnelCounts([candidate('stg_take'), candidate('applied')], null, settings);
    expect(counts).toEqual({ applied: 1, screen: 0, stg_take: 1, offer: 0, hired: 0 });
  });
});

describe('daysInStage / staleCandidates', () => {
  it('counts whole days in the current stage', () => {
    expect(daysInStage(candidate('screen', 'active', '2026-03-15T09:00:00Z'), NOW)).toBe(5);
  });

  it('flags long-stuck active candidates, most-stuck first, ignoring hires', () => {
    const fresh = candidate('screen', 'active', '2026-03-18T12:00:00Z');
    const stuck = { ...candidate('screen', 'active', '2026-03-01T12:00:00Z'), name: 'stuck' };
    const stucker = { ...candidate('applied', 'active', '2026-02-01T12:00:00Z'), name: 'stucker' };
    const hired = candidate('hired', 'active', '2026-01-01T12:00:00Z');
    const rejected = candidate('screen', 'rejected', '2026-01-01T12:00:00Z');
    const result = staleCandidates([fresh, stuck, stucker, hired, rejected], { thresholdDays: 14, now: NOW });
    expect(result.map((c) => c.name)).toEqual(['stucker', 'stuck']);
  });
});

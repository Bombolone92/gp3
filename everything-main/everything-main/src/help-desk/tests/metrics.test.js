// Day boundaries are checked in a zone with daylight saving time.
process.env.TZ = 'America/New_York';

import { describe, it, expect } from 'vitest';
import {
  computeReport, resolveRange, median, delta, toCsv, csvCell, startOfDay, startOfWeek, addDays, daysBetween,
  dayKey, parseDay, included, articleStats, firstReplyTarget,
} from '../src/client/metrics.js';
import { DEFAULT_SLA } from '../src/shared/rules.js';

const H = 3600000;
const local = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime();
const NOW = local(2026, 10, 12, 15, 0);

let seq = 0;
function ticket(over = {}) {
  seq++;
  return {
    id: seq, status: 'open', priority: 'normal', type: null, via: 'portal', assignee: 'a1', group: 'support',
    tags: [], createdAt: NOW - 2 * H, updatedAt: NOW, solvedAt: null, firstReplyAt: null, lastAgentReplyAt: null,
    csat: null, deleted: null, spam: false, mergedInto: null, ...over,
  };
}

function report(tickets, preset = '7d', extra = {}) {
  const range = resolveRange(preset, NOW);
  return computeReport(tickets, { ...range, sla: DEFAULT_SLA, ...extra });
}

describe('dates', () => {
  it('works in local days, including across daylight saving changes', () => {
    // US daylight saving time ended on 2026-11-01.
    const before = local(2026, 10, 31, 12);
    expect(dayKey(addDays(before, 1))).toBe('2026-11-01');
    expect(dayKey(addDays(before, 2))).toBe('2026-11-02');
    expect(new Date(addDays(before, 2)).getHours()).toBe(0);
    expect(daysBetween(local(2026, 10, 30), local(2026, 11, 3))).toBe(4);
  });

  it('starts weeks on Monday', () => {
    const sunday = local(2026, 10, 11, 22);
    expect(dayKey(startOfWeek(sunday))).toBe('2026-10-05');
    expect(dayKey(startOfWeek(local(2026, 10, 12, 1)))).toBe('2026-10-12');
  });

  it('resolves presets to whole local days including today', () => {
    const r = resolveRange('7d', NOW);
    expect(r.days).toBe(7);
    expect(dayKey(r.from)).toBe('2026-10-06');
    expect(r.to).toBe(startOfDay(local(2026, 10, 13)));
    expect(r.prevTo).toBe(r.from);
    expect(daysBetween(r.prevFrom, r.prevTo)).toBe(7);
    const m = resolveRange('month', NOW);
    expect(dayKey(m.from)).toBe('2026-10-01');
    expect(m.days).toBe(12);
  });

  it('orders a custom range and falls back when it is incomplete', () => {
    const r = resolveRange('custom', NOW, { from: '2026-10-10', to: '2026-10-01' });
    expect(dayKey(r.from)).toBe('2026-10-01');
    expect(r.days).toBe(10);
    expect(resolveRange('custom', NOW, { from: 'nope' }).days).toBe(30);
    expect(parseDay('2026-02-30')).not.toBe(null);
    expect(parseDay('x')).toBe(null);
  });
});

describe('helpers', () => {
  it('computes medians of odd, even and empty lists', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(null);
  });

  it('describes changes with the right sense of better', () => {
    expect(delta(10, 5)).toMatchObject({ dir: 'up', good: true, pct: 1 });
    expect(delta(10, 5, 'down')).toMatchObject({ dir: 'up', good: false });
    expect(delta(3, 3)).toMatchObject({ dir: 'flat', good: null });
    expect(delta(4, 0).pct).toBe(null);
    expect(delta(null, 3)).toBe(null);
  });

  it('writes safe CSV', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe('"\'=SUM(A1)"');
    expect(csvCell(-5)).toBe('-5');
    expect(toCsv([['a', 1], ['b', null]])).toBe('a,1\r\nb,');
  });

  it('leaves out deleted, spam and merged tickets and applies filters', () => {
    expect(included(ticket({ deleted: 1 }))).toBe(false);
    expect(included(ticket({ spam: true }))).toBe(false);
    expect(included(ticket({ mergedInto: 3 }))).toBe(false);
    expect(included(ticket({ priority: null }), { priority: 'none' })).toBe(true);
    expect(included(ticket({ via: 'email' }), { channel: 'portal' })).toBe(false);
    expect(included(ticket({ assignee: null }), { agent: 'a1' })).toBe(false);
  });

  it('knows first reply targets per priority', () => {
    expect(firstReplyTarget({ priority: 'urgent' }, DEFAULT_SLA)).toBe(60 * 60000);
    expect(firstReplyTarget({ priority: null }, DEFAULT_SLA)).toBe(DEFAULT_SLA.targets.normal.first * 60000);
    expect(firstReplyTarget({ priority: 'high' }, { enabled: false })).toBe(null);
  });
});

describe('computeReport', () => {
  it('handles no tickets', () => {
    const r = report([]);
    expect(r.current.created).toBe(0);
    expect(r.current.medianFirstReply).toBe(null);
    expect(r.current.csat.score).toBe(null);
    expect(r.daily).toHaveLength(7);
    expect(r.heat.flat().every((v) => v === 0)).toBe(true);
  });

  it('counts created and solved per local day and compares with the previous period', () => {
    const tickets = [
      ticket({ createdAt: local(2026, 10, 12, 0, 30) }),
      ticket({ createdAt: local(2026, 10, 11, 23, 30), status: 'solved', solvedAt: local(2026, 10, 12, 9), firstReplyAt: local(2026, 10, 12, 1, 30) }),
      ticket({ createdAt: local(2026, 10, 1, 10) }), // previous period
      ticket({ createdAt: local(2026, 10, 12, 8), deleted: 5 }),
    ];
    const r = report(tickets);
    expect(r.current.created).toBe(2);
    expect(r.previous.created).toBe(1);
    expect(r.current.solved).toBe(1);
    const byDay = Object.fromEntries(r.daily.map((d) => [dayKey(d.day), d]));
    expect(byDay['2026-10-12']).toMatchObject({ created: 1, solved: 1 });
    expect(byDay['2026-10-11']).toMatchObject({ created: 1, solved: 0 });
    expect(r.current.medianFirstReply).toBe(2 * H);
    expect(r.current.medianResolution).toBe(9.5 * H);
  });

  it('ignores a solvedAt left on a reopened ticket', () => {
    const r = report([ticket({ status: 'open', solvedAt: NOW - H })]);
    expect(r.current.solved).toBe(0);
  });

  it('measures one-touch resolution and the first reply target', () => {
    const created = NOW - 30 * H;
    const tickets = [
      // One reply, within the 8 hour normal target.
      ticket({ createdAt: created, status: 'solved', solvedAt: NOW - H, firstReplyAt: created + H, lastAgentReplyAt: created + H }),
      // Two replies, first one late.
      ticket({ createdAt: created, status: 'closed', solvedAt: NOW - H, firstReplyAt: created + 9 * H, lastAgentReplyAt: created + 20 * H }),
      // Urgent, no reply at all: counts against the target.
      ticket({ createdAt: created, priority: 'urgent', status: 'solved', solvedAt: NOW - H }),
    ];
    const r = report(tickets);
    expect(r.current.oneTouchRate).toBe(0.5);
    expect(r.current.slaRate).toBeCloseTo(1 / 3);
    expect(r.current.slaBase).toBe(3);
  });

  it('counts backlog by status and open tickets per agent', () => {
    const r = report([ticket({ status: 'new', assignee: null }), ticket({ status: 'pending' }), ticket({ status: 'hold' }), ticket({ status: 'solved', solvedAt: NOW })]);
    expect(r.backlog).toEqual({ new: 1, open: 0, pending: 1, hold: 1 });
    expect(r.current.backlog).toBe(3);
    expect(r.agents.find((a) => a.uuid === 'a1').open).toBe(2);
  });

  it('buckets by channel, priority, tag and hour of the local day', () => {
    const r = report([
      ticket({ via: 'email', priority: 'high', tags: ['billing', 'refund'], createdAt: local(2026, 10, 12, 9, 15) }),
      ticket({ via: 'email', priority: null, tags: ['billing'], createdAt: local(2026, 10, 11, 9, 45) }),
      ticket({ via: 'phone', priority: 'normal', createdAt: local(2026, 10, 10, 18) }),
    ]);
    expect(r.byChannel).toEqual({ email: 2, phone: 1 });
    expect(r.byPriority).toMatchObject({ high: 1, normal: 1, none: 1, urgent: 0 });
    expect(r.tags).toEqual([{ tag: 'billing', count: 2 }, { tag: 'refund', count: 1 }]);
    expect(r.heat[0][9]).toBe(1); // Monday 9:00
    expect(r.heat[6][9]).toBe(1); // Sunday 9:00
    expect(r.heat[5][18]).toBe(1); // Saturday 18:00
  });

  it('rates satisfaction by when the rating was given, per week and per agent', () => {
    const r = report([
      ticket({ status: 'solved', solvedAt: NOW - 3 * H, csat: { score: 'good', at: local(2026, 10, 12, 10) } }),
      ticket({ status: 'solved', solvedAt: NOW - 3 * H, csat: { score: 'bad', at: local(2026, 10, 7, 10) } }),
      ticket({ status: 'solved', solvedAt: NOW - 3 * H, csat: { score: 'good', at: local(2026, 9, 1) } }),
    ]);
    expect(r.current.csat).toMatchObject({ good: 1, bad: 1, rated: 2, score: 0.5 });
    expect(r.weekly.map((w) => [dayKey(w.week), w.good, w.bad])).toEqual([['2026-10-05', 0, 1], ['2026-10-12', 1, 0]]);
    expect(r.agents[0]).toMatchObject({ rated: 2, csat: 0.5 });
  });

  it('applies filters to everything', () => {
    const r = report([ticket({ group: 'billing' }), ticket({ group: 'support', status: 'pending' })], '7d', { filters: { group: 'billing' } });
    expect(r.current.created).toBe(1);
    expect(r.current.backlog).toBe(1);
  });
});

describe('articleStats', () => {
  it('ranks published articles by views with their helpful share', () => {
    const out = articleStats([
      { id: 1, title: 'A', status: 'published', views: 3, up: 3, down: 1 },
      { id: 2, title: 'B', status: 'draft', views: 99 },
      { id: 3, title: 'C', status: 'published', views: 10 },
    ]);
    expect(out.map((a) => a.id)).toEqual([3, 1]);
    expect(out[1].helpful).toBe(0.75);
    expect(out[0].helpful).toBe(null);
  });
});

describe('tickets an agent opened', () => {
  it('measure the first reply from the customer\'s answer, like the ticket\'s target', () => {
    const opened = NOW - 30 * H;
    // The agent wrote first; the customer answered a day later, the agent an hour after that.
    const answered = ticket({ via: 'web', createdAt: opened, lastAgentReplyAt: NOW - 5 * H, firstReplyAt: NOW - 5 * H, firstReplyFrom: NOW - 6 * H, lastCustomerAt: NOW - 6 * H, status: 'solved', solvedAt: NOW - 4 * H });
    // The customer never wrote back: no reply was due.
    const outbound = ticket({ via: 'web', createdAt: opened, lastAgentReplyAt: opened, status: 'solved', solvedAt: NOW - 4 * H });
    const r = report([answered, outbound]);
    expect(r.current.medianFirstReply).toBe(H);
    expect(r.current.slaRate).toBe(1);
  });
});

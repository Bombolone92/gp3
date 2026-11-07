import { describe, it, expect } from 'vitest';
import {
  escapeText, foldLine, icsDate, icsStamp, sequenceFor, buildCalendar,
  contractEvents, bookEvents,
} from '../src/lib/ical.js';
import { addDays } from '../src/lib/dates.js';
import { randomToken } from '../src/lib/util.js';

const TODAY = '2026-08-05';

function contract(overrides = {}) {
  return {
    id: 'k1', title: 'Cloud hosting', status: 'active',
    value: 2400, currency: 'USD', billing: 'monthly',
    startDate: '2025-01-01', endDate: addDays(TODAY, 40),
    autoRenew: true, termMonths: 12, noticeDays: 30,
    obligations: [], documents: [], tags: [],
    updatedAt: Date.UTC(2026, 7, 1), decision: null,
    ...overrides,
  };
}

const lines = (text) => text.split('\r\n');

describe('escapeText', () => {
  it('escapes what RFC 5545 requires, and nothing else', () => {
    expect(escapeText('Lease, 4th floor; unit 2')).toBe('Lease\\, 4th floor\\; unit 2');
    expect(escapeText('back\\slash')).toBe('back\\\\slash');
    expect(escapeText('one\ntwo\r\nthree')).toBe('one\\ntwo\\nthree');
    expect(escapeText("O'Brien & Sons")).toBe("O'Brien & Sons");
  });
});

describe('foldLine', () => {
  it('leaves short lines alone', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('folds at 75 octets with a leading space on continuations', () => {
    const folded = foldLine(`SUMMARY:${'a'.repeat(200)}`);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(2);
    expect(new TextEncoder().encode(parts[0]).length).toBeLessThanOrEqual(75);
    for (const part of parts.slice(1)) {
      expect(part.startsWith(' ')).toBe(true);
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    }
    // Unfolding puts it back exactly.
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(`SUMMARY:${'a'.repeat(200)}`);
  });

  it('counts bytes, not characters, and never splits one', () => {
    const line = `SUMMARY:${'é'.repeat(60)}`;
    for (const part of foldLine(line).split('\r\n')) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
      expect(part).not.toContain('�');
    }
  });
});

describe('date and sequence helpers', () => {
  it('formats DATE values and stamps', () => {
    expect(icsDate('2026-03-12')).toBe('20260312');
    expect(icsStamp(Date.UTC(2026, 2, 12, 9, 30, 15))).toBe('20260312T093015Z');
  });

  it('gives a rising, valid SEQUENCE', () => {
    const early = sequenceFor(Date.UTC(2026, 0, 1));
    const later = sequenceFor(Date.UTC(2026, 0, 2));
    expect(later).toBeGreaterThan(early);
    expect(Number.isInteger(early)).toBe(true);
    expect(early).toBeLessThan(2 ** 31 - 1);
    expect(sequenceFor(undefined)).toBe(0);
  });
});

describe('buildCalendar', () => {
  const event = {
    uid: 'u1@test', date: '2026-03-12', sequence: 5,
    summary: 'Cancel Cloud hosting', description: 'Line one\nLine two',
    url: 'https://example.test/#/contracts/k1', alarms: [7, 1],
  };

  it('wraps events in a valid VCALENDAR', () => {
    const out = lines(buildCalendar([event], { stamp: '20260301T000000Z' }));
    expect(out[0]).toBe('BEGIN:VCALENDAR');
    expect(out).toContain('VERSION:2.0');
    expect(out).toContain('METHOD:PUBLISH');
    expect(out).toContain('X-WR-CALNAME:Contract deadlines');
    expect(out[out.length - 2]).toBe('END:VCALENDAR');
    expect(out[out.length - 1]).toBe('');
  });

  it('writes an all-day event with an exclusive DTEND', () => {
    const out = lines(buildCalendar([event]));
    expect(out).toContain('DTSTART;VALUE=DATE:20260312');
    // The day after, or calendars show a two-day event.
    expect(out).toContain('DTEND;VALUE=DATE:20260313');
  });

  it('carries the uid, sequence, url and escaped description', () => {
    const out = lines(buildCalendar([event]));
    expect(out).toContain('UID:u1@test');
    expect(out).toContain('SEQUENCE:5');
    expect(out).toContain('URL:https://example.test/#/contracts/k1');
    expect(out).toContain('DESCRIPTION:Line one\\nLine two');
  });

  it('adds one VALARM per reminder', () => {
    const out = lines(buildCalendar([event]));
    expect(out.filter((l) => l === 'BEGIN:VALARM')).toHaveLength(2);
    expect(out).toContain('TRIGGER:-P7D');
    expect(out).toContain('TRIGGER:-P1D');
    expect(out.filter((l) => l === 'END:VALARM')).toHaveLength(2);
  });

  it('is still valid with no events at all', () => {
    const out = lines(buildCalendar([]));
    expect(out).toContain('BEGIN:VCALENDAR');
    expect(out.some((l) => l === 'BEGIN:VEVENT')).toBe(false);
  });
});

describe('contractEvents', () => {
  const opts = { today: TODAY, baseUrl: 'https://example.test/' };

  it('emits the notice deadline, this term end, and future renewals', () => {
    const events = contractEvents(contract(), opts);
    const summaries = events.map((e) => e.summary);
    expect(summaries.some((s) => s.startsWith('Cancel or renegotiate'))).toBe(true);
    expect(summaries.filter((s) => s === 'Cloud hosting renews')).toHaveLength(3);
  });

  it('anchors future renewals on the original month-end, without drift', () => {
    const events = contractEvents(contract({
      endDate: '2026-01-31', termMonths: 1, noticeDays: 0,
    }), { ...opts, today: '2026-06-05' });
    // The next term end is clamped to Jun 30; the ones after it are not.
    expect(events.map((e) => e.date)).toEqual(['2026-06-30', '2026-07-31', '2026-08-31']);
  });

  it('gives every event a stable, unique uid', () => {
    const events = contractEvents(contract(), opts);
    const uids = events.map((e) => e.uid);
    expect(new Set(uids).size).toBe(uids.length);
    // Same input, same uids: re-importing updates instead of duplicating.
    expect(contractEvents(contract(), opts).map((e) => e.uid)).toEqual(uids);
    for (const u of uids) expect(u).toContain('@contract-manager.puter');
  });

  it('emits one end event for a fixed term', () => {
    const events = contractEvents(contract({ autoRenew: false }), opts);
    expect(events.filter((e) => e.summary === 'Cloud hosting ends')).toHaveLength(1);
  });

  it('drops the notice event once a decision is recorded', () => {
    const c = contract({
      decision: { kind: 'renewing', date: TODAY, forTermEnd: addDays(TODAY, 40), note: '' },
    });
    expect(contractEvents(c, opts).some((e) => e.summary.startsWith('Cancel'))).toBe(false);
  });

  it('stops at the term when notice was given', () => {
    const c = contract({
      decision: { kind: 'notice-given', date: TODAY, forTermEnd: addDays(TODAY, 40), note: '' },
    });
    const events = contractEvents(c, opts);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe('Cloud hosting ends');
  });

  it('says why the term is the last one, in the words of the decision', () => {
    const term = addDays(TODAY, 40);
    const notice = contractEvents(contract({
      decision: { kind: 'notice-given', date: TODAY, forTermEnd: term, note: '' },
    }), opts);
    expect(notice[0].description).toContain('Notice was given');
    // Declining a renewal sends nothing; the export must not claim it did.
    const declined = contractEvents(contract({
      decision: { kind: 'not-renewing', date: TODAY, forTermEnd: term, note: '' },
    }), opts);
    expect(declined).toHaveLength(1);
    expect(declined[0].summary).toBe('Cloud hosting ends');
    expect(declined[0].description).toContain('Renewal was declined');
    expect(declined[0].description).not.toContain('Notice was given');
  });

  it('says nothing for draft, terminated or deleted contracts', () => {
    expect(contractEvents(contract({ status: 'draft' }), opts)).toEqual([]);
    expect(contractEvents(contract({ status: 'terminated' }), opts)).toEqual([]);
    expect(contractEvents(contract({ deletedAt: Date.now() }), opts)).toEqual([]);
  });

  it('includes dated obligations, and overdue ones', () => {
    const c = contract({
      obligations: [
        { id: 'o1', text: 'Pay invoice', owner: 'us', due: addDays(TODAY, 9), done: false, history: [] },
        { id: 'o2', text: 'Overdue thing', owner: 'us', due: addDays(TODAY, -4), done: false, history: [] },
        { id: 'o3', text: 'Finished', owner: 'us', due: addDays(TODAY, 3), done: true, history: [] },
        { id: 'o4', text: 'No date', owner: 'them', due: null, done: false, history: [] },
      ],
    });
    const summaries = contractEvents(c, opts).map((e) => e.summary);
    expect(summaries).toContain('Pay invoice (Cloud hosting)');
    expect(summaries).toContain('Overdue thing (Cloud hosting)');
    expect(summaries.some((s) => s.startsWith('Finished'))).toBe(false);
    expect(summaries.some((s) => s.startsWith('No date'))).toBe(false);
  });

  it('emits a bounded run of a repeating obligation', () => {
    const due = addDays(TODAY, 9);
    const c = contract({
      endDate: null,
      obligations: [{
        id: 'o1', text: 'Pay rent', owner: 'us', due, done: false, history: [],
        repeat: { every: 'monthly', anchor: due, until: null, count: null, contractEnd: false },
      }],
    });
    const events = contractEvents(c, { ...opts, occurrences: 4 });
    expect(events).toHaveLength(4);
    expect(new Set(events.map((e) => e.date)).size).toBe(4);
  });

  it('respects the series end when repeating', () => {
    const due = addDays(TODAY, 9);
    const c = contract({
      obligations: [{
        id: 'o1', text: 'Pay rent', owner: 'us', due, done: false, history: [],
        repeat: { every: 'monthly', anchor: due, until: null, count: 2, contractEnd: false },
      }],
    });
    const obEvents = contractEvents(c, opts).filter((e) => e.summary.startsWith('Pay rent'));
    expect(obEvents).toHaveLength(2);
  });

  it('links back to the contract and names the counterparty', () => {
    const [first] = contractEvents(contract(), { ...opts, contactName: 'Maya, Northwind' });
    expect(first.url).toBe('https://example.test/#/contracts/k1');
    expect(first.description).toContain('Maya, Northwind');
  });
});

describe('bookEvents', () => {
  it('merges every contract in date order', () => {
    const events = bookEvents([
      contract({ id: 'a', title: 'Later', endDate: addDays(TODAY, 200), noticeDays: 0, autoRenew: false }),
      contract({ id: 'b', title: 'Sooner', endDate: addDays(TODAY, 10), noticeDays: 0, autoRenew: false }),
    ], { today: TODAY });
    expect(events.map((e) => e.summary)).toEqual(['Sooner ends', 'Later ends']);
  });

  it('can name each contract\'s counterparty through a callback', () => {
    const events = bookEvents([contract({ noticeDays: 0, autoRenew: false })], {
      today: TODAY,
      contactName: (c) => `Owner of ${c.title}`,
    });
    expect(events[0].description).toContain('Owner of Cloud hosting');
  });
});

describe('feed subdomain tokens', () => {
  it('is drawn from the CSPRNG, not the clock', () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).toHaveLength(24);
    expect(a).toMatch(/^[a-z2-9]+$/);
    // uid() ends in the timestamp, so two ids made in the same tick share a
    // tail. A token must not: every character has to carry entropy.
    expect(a).not.toBe(b);
    expect(a.slice(-6)).not.toBe(b.slice(-6));
  });

  it('spreads across the whole alphabet', () => {
    const seen = new Set([...Array(200)].flatMap(() => [...randomToken()]));
    expect(seen.size).toBeGreaterThan(28);
  });
});

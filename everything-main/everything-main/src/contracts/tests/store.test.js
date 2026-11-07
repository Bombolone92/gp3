import { describe, it, expect, beforeEach } from 'vitest';
import {
  Store, annualizedValue, searchContracts, upcomingRenewals,
  dueObligations, allObligations, contractStats, annualByCurrency, liveDocuments,
  termReconciliation, occurrenceDue, repeatAnchor, advanceOccurrence, rewindOccurrence, endedOn,
} from '../src/lib/store.js';
import { sampleDataset } from '../src/lib/sample.js';
import { addDays, addMonths, todayISO, needsAttention } from '../src/lib/dates.js';

const TODAY = '2026-08-05';

/** In-memory stand-in for the Puter SDK (kv + fs + auth). */
function mockPuter() {
  const kv = new Map();
  const files = new Map();
  return {
    kv: {
      async get(k) { return kv.has(k) ? structuredClone(kv.get(k)) : null; },
      async set(k, v) { kv.set(k, structuredClone(v)); },
    },
    fs: {
      async read(path) {
        if (!files.has(path)) {
          const err = new Error(`No such file: ${path}`);
          err.code = 'subject_does_not_exist';
          throw err;
        }
        return new Blob([files.get(path)]);
      },
      async write(path, data) {
        files.set(path, typeof data === 'string' ? data : await new Blob([data]).text());
      },
      async delete(path) {
        for (const k of [...files.keys()]) {
          if (k === path || k.startsWith(`${path}/`)) files.delete(k);
        }
      },
    },
    auth: {
      async getUser() { return { username: 'tester' }; },
    },
    _files: files,
  };
}

function contract(overrides = {}) {
  return {
    title: 'Test agreement', type: 'service', status: 'active',
    value: 100, currency: 'USD', billing: 'monthly',
    startDate: '2026-01-01', endDate: addDays(TODAY, 40),
    autoRenew: true, termMonths: 12, noticeDays: 10,
    obligations: [], documents: [], tags: [],
    ...overrides,
  };
}

describe('annualizedValue', () => {
  it('normalizes each billing period to a yearly figure', () => {
    expect(annualizedValue(contract({ value: 100, billing: 'monthly' }))).toBe(1200);
    expect(annualizedValue(contract({ value: 100, billing: 'quarterly' }))).toBe(400);
    expect(annualizedValue(contract({ value: 100, billing: 'annual' }))).toBe(100);
    expect(annualizedValue(contract({ value: 100, billing: 'one-time' }))).toBe(0);
  });

  it('treats missing or non-positive values as 0', () => {
    expect(annualizedValue(contract({ value: null }))).toBe(0);
    expect(annualizedValue(contract({ value: -5 }))).toBe(0);
  });
});

describe('searchContracts', () => {
  const contactsById = new Map([['c1', { id: 'c1', name: 'Maya Lindqvist', company: 'Northwind' }]]);
  const list = [
    contract({ title: 'Cloud hosting', contactId: 'c1', tags: ['infra'] }),
    contract({ title: 'Office lease', notes: 'Fulton Street building' }),
  ];

  it('matches title, tags, notes, and counterparty', () => {
    expect(searchContracts(list, 'cloud', contactsById)).toHaveLength(1);
    expect(searchContracts(list, 'infra', contactsById)).toHaveLength(1);
    expect(searchContracts(list, 'fulton', contactsById)).toHaveLength(1);
    expect(searchContracts(list, 'northwind', contactsById)).toHaveLength(1);
    expect(searchContracts(list, 'MAYA', contactsById)).toHaveLength(1);
  });

  it('returns everything for an empty query and nothing for a miss', () => {
    expect(searchContracts(list, '  ', contactsById)).toHaveLength(2);
    expect(searchContracts(list, 'zebra', contactsById)).toHaveLength(0);
  });
});

describe('upcomingRenewals', () => {
  it('keeps only dated contracts inside the window, soonest first', () => {
    const list = [
      contract({ title: 'far', endDate: addDays(TODAY, 200), autoRenew: false }),
      contract({ title: 'near', endDate: addDays(TODAY, 5), autoRenew: false }),
      contract({ title: 'mid', endDate: addDays(TODAY, 50), autoRenew: false }),
      contract({ title: 'evergreen', endDate: null }),
      contract({ title: 'past', endDate: addDays(TODAY, -10), autoRenew: false }),
    ];
    const out = upcomingRenewals(list, { days: 90, today: TODAY });
    expect(out.map((e) => e.contract.title)).toEqual(['near', 'mid']);
  });
});

describe('dueObligations', () => {
  it('includes overdue and near-due open items, skips done and undated', () => {
    const c = contract({
      title: 'obligations',
      obligations: [
        { id: '1', text: 'overdue', due: addDays(TODAY, -3), done: false },
        { id: '2', text: 'soon', due: addDays(TODAY, 10), done: false },
        { id: '3', text: 'done', due: addDays(TODAY, 2), done: true },
        { id: '4', text: 'undated', due: null, done: false },
        { id: '5', text: 'far', due: addDays(TODAY, 90), done: false },
      ],
    });
    const out = dueObligations([c], { days: 30, today: TODAY });
    expect(out.map((o) => o.obligation.text)).toEqual(['overdue', 'soon']);
    expect(out[0].daysLeft).toBe(-3);
  });

  it('ignores inactive contracts', () => {
    const c = contract({
      status: 'terminated',
      obligations: [{ id: '1', text: 'x', due: TODAY, done: false }],
    });
    expect(dueObligations([c], { today: TODAY })).toHaveLength(0);
  });
});

describe('allObligations', () => {
  const book = [
    contract({
      title: 'A',
      obligations: [
        { id: '1', text: 'far off', due: addDays(TODAY, 200), done: false },
        { id: '2', text: 'overdue', due: addDays(TODAY, -3), done: false },
      ],
    }),
    contract({
      title: 'B',
      obligations: [
        { id: '3', text: 'undated', due: null, done: false },
        { id: '4', text: 'finished', due: addDays(TODAY, 1), done: true },
      ],
    }),
    contract({ title: 'C', status: 'terminated', obligations: [{ id: '5', text: 'closed out', done: false }] }),
  ];

  it('returns the whole open list, most urgent first, undated last', () => {
    const out = allObligations(book, { today: TODAY });
    expect(out.map((o) => o.obligation.text)).toEqual(['overdue', 'far off', 'undated']);
    expect(out[0].daysLeft).toBe(-3);
    expect(out[2].daysLeft).toBeNull();
  });

  it('includes completed items only when asked, and sinks them', () => {
    const out = allObligations(book, { today: TODAY, includeDone: true });
    expect(out.map((o) => o.obligation.text)).toEqual(['overdue', 'far off', 'undated', 'finished']);
  });

  it('leaves obligations on inactive contracts out', () => {
    const out = allObligations(book, { today: TODAY, includeDone: true });
    expect(out.some((o) => o.obligation.text === 'closed out')).toBe(false);
  });

  it('agrees with dueObligations on the near-term slice', () => {
    const near = dueObligations(book, { days: 30, today: TODAY });
    expect(near.map((o) => o.obligation.text)).toEqual(['overdue']);
  });
});

describe('contractStats', () => {
  it('counts active, expiring, obligations, and annual value', () => {
    const list = [
      contract({ value: 100, billing: 'monthly', endDate: addDays(TODAY, 30), obligations: [
        { id: '1', text: 'open', done: false }, { id: '2', text: 'closed', done: true },
      ] }),
      contract({ value: 1000, billing: 'annual', endDate: addDays(TODAY, 300), autoRenew: false }),
      contract({ status: 'terminated', value: 99, billing: 'monthly' }),
      contract({ endDate: addDays(TODAY, -5), autoRenew: false }), // expired
    ];
    const stats = contractStats(list, TODAY);
    expect(stats.active).toBe(2);
    expect(stats.expiring60).toBe(1);
    expect(stats.openObligations).toBe(1);
    expect(stats.annualByCurrency).toEqual({ USD: 2200 });
    expect(stats.expired).toBe(1);
  });

  it('still counts what is owed under a term that has lapsed', () => {
    const lapsed = contract({
      endDate: addDays(TODAY, -5), autoRenew: false,
      obligations: [{ id: '1', text: 'Pay the final invoice', done: false }],
    });
    const stats = contractStats([lapsed], TODAY);
    expect(stats.active).toBe(0);
    expect(stats.expired).toBe(1);
    // The dashboard lists this one as due right below the tile, and the nav
    // badge counts it once it is overdue. The tile has to agree with both.
    expect(stats.openObligations).toBe(1);
    expect(allObligations([lapsed], { today: TODAY })).toHaveLength(1);
  });

  it('never merges currencies into one figure', () => {
    const list = [
      contract({ value: 1000, billing: 'annual', currency: 'USD' }),
      contract({ value: 2000, billing: 'annual', currency: 'EUR' }),
      contract({ value: 500, billing: 'annual', currency: 'eur' }),
    ];
    const stats = contractStats(list, TODAY);
    expect(stats.annualByCurrency).toEqual({ USD: 1000, EUR: 2500 });
  });
});

describe('annualByCurrency', () => {
  it('groups by currency and skips unpriced contracts', () => {
    expect(annualByCurrency([
      contract({ value: 100, billing: 'monthly', currency: 'GBP' }),
      contract({ value: null, currency: 'GBP' }),
      contract({ value: 300, billing: 'one-time', currency: 'GBP' }),
      contract({ value: 50, billing: 'quarterly', currency: 'CHF' }),
    ])).toEqual({ GBP: 1200, CHF: 200 });
  });

  it('falls back to USD for a contract with a broken currency code', () => {
    expect(annualByCurrency([contract({ value: 10, billing: 'annual', currency: 'X$' })]))
      .toEqual({ USD: 10 });
  });
});

describe('recurring obligations', () => {
  const monthly = (extra = {}) => ({
    every: 'monthly', anchor: '2026-01-31', until: null, count: null, contractEnd: false, ...extra,
  });
  const ob = (extra = {}) => ({
    id: 'o1', text: 'Pay rent', owner: 'us', due: '2026-01-31', done: false, history: [], ...extra,
  });

  it('anchors every occurrence to the original date instead of the previous one', () => {
    const r = monthly();
    // Jan 31 → Feb 28 → Mar 31: the month-end anchor must not drift after a clamp.
    expect(occurrenceDue(r, 0)).toBe('2026-01-31');
    expect(occurrenceDue(r, 1)).toBe('2026-02-28');
    expect(occurrenceDue(r, 2)).toBe('2026-03-31');
    expect(occurrenceDue(r, 12)).toBe('2027-01-31');
  });

  it('keeps advancing once the occurrence history starts falling off the front', async () => {
    globalThis.puter = mockPuter();
    const store = new Store();
    await store.init();
    const c = await store.addContract(contract({
      title: 'Ten-year lease', endDate: null, autoRenew: false,
      obligations: [{
        text: 'Pay rent', owner: 'us', due: '2020-01-01',
        repeat: { every: 'monthly', anchor: '2020-01-01' },
      }],
    }));
    const obId = store.contractById(c.id).obligations[0].id;

    // Only the last 120 completions are kept, and an occurrence's number is
    // its place in that history — so past the cap the series used to stop
    // moving and every further tick re-recorded the same date.
    const dues = [];
    for (let i = 0; i < 126; i++) {
      dues.push(store.contractById(c.id).obligations[0].due);
      await store.setObligation(c.id, obId, { done: true });
    }
    expect(new Set(dues).size).toBe(dues.length);
    expect(dues[125]).toBe('2030-06-01');

    const saved = store.contractById(c.id).obligations[0];
    expect(saved.history).toHaveLength(120);
    expect(occurrenceDue(saved.repeat, saved.history.length)).toBe(saved.due);
  });

  it('computes the anchor that puts a due date at a given occurrence', () => {
    expect(repeatAnchor('2026-03-31', 'monthly', 2)).toBe('2026-01-31');
    expect(repeatAnchor('2026-03-31', 'monthly', 0)).toBe('2026-03-31');
    expect(repeatAnchor('2027-01-01', 'quarterly', 4)).toBe('2026-01-01');
  });

  it('keeps a month-end anchor when an edit is saved from a clamped occurrence', () => {
    const existing = monthly(); // anchored 2026-01-31
    // The form shows Feb 28 as the live date after one completion; rebuilding
    // the anchor from it gave Jan 28, and every month after landed on the 28th.
    expect(repeatAnchor('2026-02-28', 'monthly', 1, existing)).toBe('2026-01-31');
    expect(repeatAnchor('2036-02-29', 'monthly', 121, existing)).toBe('2026-01-31');
    // A date the schedule does not explain is a correction: the anchor follows it.
    expect(repeatAnchor('2026-02-15', 'monthly', 1, existing)).toBe('2026-01-15');
    // As does a change of cadence.
    expect(repeatAnchor('2026-02-28', 'quarterly', 1, existing)).toBe('2025-11-28');
    // And nothing to go on rebuilds as before.
    expect(repeatAnchor('2026-02-28', 'monthly', 1)).toBe('2026-01-28');
  });

  it('completing an occurrence records it and schedules the next', () => {
    const next = advanceOccurrence(contract(), ob({ repeat: monthly() }));
    expect(next.done).toBe(false);
    expect(next.due).toBe('2026-02-28');
    expect(next.history).toEqual([expect.objectContaining({ due: '2026-01-31' })]);
  });

  it('stops after the requested number of occurrences', () => {
    let current = ob({ repeat: monthly({ count: 2 }) });
    current = advanceOccurrence(contract(), current);
    expect(current.due).toBe('2026-02-28');
    current = advanceOccurrence(contract(), current);
    // Series complete: the obligation itself is done, not scheduled again.
    expect(current.done).toBe(true);
    expect(current.due).toBe('2026-02-28');
    expect(current.history).toHaveLength(2);
  });

  it('stops at an end date', () => {
    let current = ob({ repeat: monthly({ until: '2026-02-15' }) });
    current = advanceOccurrence(contract(), current);
    expect(current.done).toBe(true);
    expect(current.history).toHaveLength(1);
  });

  it('stops when the contract does', () => {
    const c = contract({ endDate: '2026-03-01', autoRenew: false });
    let current = ob({ repeat: monthly({ contractEnd: true }) });
    current = advanceOccurrence(c, current);
    expect(current.due).toBe('2026-02-28');
    current = advanceOccurrence(c, current);
    expect(current.done).toBe(true);
  });

  /*
   * A renewal is not an ending. Measured against the term end, a monthly
   * invoice on an auto-renewing contract closed itself at the next renewal
   * date: the tick that should have scheduled the following month marked the
   * whole duty done, and nobody was reminded of the payment after it.
   */
  it('keeps repeating past a renewal the contract rolls through', () => {
    const c = contract({ endDate: addDays(todayISO(), 20), autoRenew: true, termMonths: 12 });
    const due = addDays(todayISO(), 5);
    let current = ob({ due, repeat: { every: 'monthly', anchor: due, contractEnd: true } });
    current = advanceOccurrence(c, current);
    expect(current.done).toBe(false);
    expect(current.due).toBe(addMonths(due, 1));
    current = advanceOccurrence(c, current);
    expect(current.done).toBe(false);
    expect(current.due).toBe(addMonths(due, 2));
  });

  it('stops at the term end once notice has been given', () => {
    const end = addDays(todayISO(), 20);
    const c = contract({
      endDate: end, autoRenew: true, termMonths: 12,
      decision: { kind: 'notice-given', date: todayISO(), forTermEnd: end },
    });
    const due = addDays(todayISO(), 5);
    let current = ob({ due, repeat: { every: 'monthly', anchor: due, contractEnd: true } });
    current = advanceOccurrence(c, current);
    // The next occurrence falls after the term this notice ends.
    expect(current.done).toBe(true);
    expect(current.history).toHaveLength(1);
  });

  it('keeps running when the end date moved out from under a notice', () => {
    // Notice given for the term ending in 20 days, then the end date was
    // corrected to 60 days out. The stale Sep-style date used to read as the
    // agreement's end and close the series at the next tick.
    const c = contract({
      endDate: addDays(todayISO(), 60), autoRenew: true, termMonths: 12,
      decision: { kind: 'notice-given', date: todayISO(), forTermEnd: addDays(todayISO(), 20) },
    });
    const due = addDays(todayISO(), 5);
    let current = ob({ due, repeat: { every: 'monthly', anchor: due, contractEnd: true } });
    current = advanceOccurrence(c, current);
    expect(current.done).toBe(false);
    expect(current.due).toBe(addMonths(due, 1));
  });

  it('un-ticking brings the last completed occurrence back', () => {
    const advanced = advanceOccurrence(contract(), ob({ repeat: monthly() }));
    const back = rewindOccurrence(advanced);
    expect(back.due).toBe('2026-01-31');
    expect(back.done).toBe(false);
    expect(back.history).toEqual([]);
  });

  it('reopens a finished series once an edit gives it room again', async () => {
    globalThis.puter = mockPuter();
    const store = new Store();
    await store.init();
    const c = await store.addContract(contract({
      endDate: null, autoRenew: false,
      obligations: [{
        id: 'o1', text: 'Pay rent', owner: 'us', due: '2026-01-15',
        repeat: { every: 'monthly', anchor: '2026-01-15', count: 2 },
      }],
    }));
    await store.setObligation(c.id, 'o1', { done: true });
    await store.setObligation(c.id, 'o1', { done: true });
    let saved = store.contractById(c.id).obligations[0];
    expect(saved.done).toBe(true);
    expect(saved.due).toBe('2026-02-15');

    // The edit form's patch: same schedule, count raised from 2 to 12. It
    // used to leave the duty under Completed with ten occurrences to run.
    await store.setObligation(c.id, 'o1', {
      text: 'Pay rent', owner: 'us', due: saved.due,
      repeat: { every: 'monthly', anchor: repeatAnchor(saved.due, 'monthly', 1), until: null, count: 12, contractEnd: false },
    });
    saved = store.contractById(c.id).obligations[0];
    expect(saved.done).toBe(false);
    expect(saved.due).toBe('2026-03-15');
    expect(saved.history.map((h) => h.due)).toEqual(['2026-01-15', '2026-02-15']);
    expect(occurrenceDue(saved.repeat, saved.history.length)).toBe(saved.due);

  });

  it('leaves a finished series finished when the edit gives it no room', async () => {
    globalThis.puter = mockPuter();
    const store = new Store();
    await store.init();
    const c = await store.addContract(contract({
      endDate: null, autoRenew: false,
      obligations: [{
        id: 'o1', text: 'Pay rent', owner: 'us', due: '2026-01-15',
        repeat: { every: 'monthly', anchor: '2026-01-15', count: 2 },
      }],
    }));
    await store.setObligation(c.id, 'o1', { done: true });
    await store.setObligation(c.id, 'o1', { done: true });
    // Reworded, same two-occurrence schedule: nothing left to run.
    await store.setObligation(c.id, 'o1', { text: 'Pay the rent', owner: 'us', due: '2026-02-15',
      repeat: { every: 'monthly', anchor: '2026-01-15', until: null, count: 2, contractEnd: false } });
    const saved = store.contractById(c.id).obligations[0];
    expect(saved.done).toBe(true);
    expect(saved.due).toBe('2026-02-15');
    expect(saved.text).toBe('Pay the rent');
  });

  it('un-ticking a finished series reopens its last occurrence', () => {
    let current = ob({ repeat: monthly({ count: 1 }) });
    current = advanceOccurrence(contract(), current);
    expect(current.done).toBe(true);
    current = rewindOccurrence(current);
    expect(current.done).toBe(false);
    expect(current.due).toBe('2026-01-31');
  });

  it('counts only the live occurrence in the dashboard numbers', () => {
    const c = contract({
      obligations: [ob({ repeat: monthly(), history: [{ due: '2025-12-31', doneAt: 1 }, { due: '2026-01-31', doneAt: 2 }] })],
    });
    expect(contractStats([c], TODAY).openObligations).toBe(1);
    expect(allObligations([c], { today: TODAY })).toHaveLength(1);
  });
});

describe('termReconciliation', () => {
  it('does nothing while the term is still running', () => {
    expect(termReconciliation(contract({ endDate: addDays(TODAY, 30) }), TODAY)).toBeNull();
  });

  it('records an auto-renewal that rolled over by itself', () => {
    const c = contract({
      startDate: '2024-06-02', endDate: '2025-06-01', autoRenew: true, termMonths: 12,
      value: 500, currency: 'EUR', termHistory: [],
    });
    const patch = termReconciliation(c, TODAY);
    expect(patch.termHistory).toHaveLength(2);
    expect(patch.termHistory[0]).toMatchObject({
      start: '2024-06-02', end: '2025-06-01', ended: 'renewed', value: 500, currency: 'EUR',
    });
    expect(patch.status).toBeUndefined();
  });

  it('closes out a contract on the term end its notice was given for', () => {
    const c = contract({
      startDate: '2025-06-02', endDate: '2026-06-01', autoRenew: true, termMonths: 12,
      decision: { kind: 'notice-given', date: '2026-04-01', forTermEnd: '2026-06-01', note: 'emailed' },
    });
    const patch = termReconciliation(c, TODAY);
    expect(patch.status).toBe('terminated');
    expect(patch.termHistory).toEqual([expect.objectContaining({
      end: '2026-06-01', ended: 'notice-given', note: 'emailed',
    })]);
    // The decision applied to a term that is over; the record keeps it, the
    // live contract does not.
    expect(patch.decision).toBeNull();
  });

  it('clears a decision whose term has passed without ending the contract', () => {
    const c = contract({
      startDate: '2025-06-02', endDate: '2026-06-01', autoRenew: true, termMonths: 12,
      decision: { kind: 'renewing', date: '2026-05-01', forTermEnd: '2026-06-01' },
    });
    const patch = termReconciliation(c, TODAY);
    expect(patch.status).toBeUndefined();
    expect(patch.decision).toBeNull();
    expect(patch.termHistory[0].ended).toBe('renewed');
  });

  it('never records the same term twice', () => {
    const c = contract({
      startDate: '2024-06-02', endDate: '2025-06-01', autoRenew: true, termMonths: 12,
    });
    const first = termReconciliation(c, TODAY);
    const settled = { ...c, termHistory: first.termHistory };
    expect(termReconciliation(settled, TODAY)).toBeNull();
  });

  it('leaves terminated and draft contracts alone', () => {
    const base = { endDate: '2025-01-01', autoRenew: false };
    expect(termReconciliation(contract({ ...base, status: 'terminated' }), TODAY)).toBeNull();
    expect(termReconciliation(contract({ ...base, status: 'draft' }), TODAY)).toBeNull();
  });
});

describe('endedOn', () => {
  it('is the end date of a fixed term', () => {
    expect(endedOn(contract({ status: 'terminated', endDate: '2026-06-01', autoRenew: false })))
      .toBe('2026-06-01');
  });

  it('is the last recorded term, not the first term\'s end, once a contract has rolled', () => {
    // endDate is the anchor every renewal was counted from; the notice given
    // two renewals later ended the contract on 2026-06-01.
    const c = contract({
      status: 'terminated', endDate: '2024-06-01', autoRenew: true, termMonths: 12,
      termHistory: [
        { start: '2023-06-02', end: '2024-06-01', ended: 'renewed' },
        { start: '2024-06-02', end: '2025-06-01', ended: 'renewed' },
        { start: '2025-06-02', end: '2026-06-01', ended: 'notice-given' },
      ],
    });
    expect(endedOn(c)).toBe('2026-06-01');
  });

  it('has nothing to say for an evergreen agreement closed by hand', () => {
    expect(endedOn(contract({ status: 'terminated', endDate: null }))).toBeNull();
  });

  it('agrees with what the store records when notice closes a contract out', async () => {
    globalThis.puter = mockPuter();
    const store = new Store();
    await store.init();
    const c = await store.addContract(contract({
      startDate: '2023-06-02', endDate: '2024-06-01', autoRenew: true, termMonths: 12,
      decision: { kind: 'notice-given', date: '2026-04-01', forTermEnd: '2026-06-01', note: '' },
    }));
    await store.reconcileTerms(TODAY);
    const saved = store.contractById(c.id);
    expect(saved.status).toBe('terminated');
    expect(saved.endDate).toBe('2024-06-01');
    expect(endedOn(saved)).toBe('2026-06-01');
  });
});

describe('Store CRUD (mocked Puter)', () => {
  let store;

  beforeEach(async () => {
    globalThis.puter = mockPuter();
    store = new Store();
    await store.init();
  });

  it('boots with defaults on an empty account', () => {
    expect(store.settings.theme).toBe('system');
    expect(store.contracts).toEqual([]);
    expect(store.contacts).toEqual([]);
    expect(store.user.username).toBe('tester');
  });

  it('normalizes a currency code that reached settings from storage', async () => {
    // Anything here ends up in Intl.NumberFormat, which throws on a non-code.
    globalThis.puter = mockPuter();
    await puter.kv.set('cm:settings:v1', { currency: '12', reportingCurrency: 'eur' });
    const store2 = new Store();
    await store2.init();
    expect(store2.settings.currency).toBe('USD');
    expect(store2.settings.reportingCurrency).toBe('EUR');

    // And through a restored export, which is just as unvetted.
    await store2.importAll({ settings: { currency: '€' }, contracts: [], contacts: [] });
    expect(store2.settings.currency).toBe('USD');
    expect(store2.settings.reportingCurrency).toBeNull();
  });

  it('normalizes bad input when adding a contract', async () => {
    const c = await store.addContract({
      title: '  Spaced  ', type: 'nonsense', status: 'bogus',
      value: '250', endDate: 'not-a-date', termMonths: -3, noticeDays: 'abc',
      tags: ['a', '', null, 'b'],
    });
    expect(c.title).toBe('Spaced');
    expect(c.type).toBe('other');
    expect(c.status).toBe('active');
    expect(c.value).toBe(250);
    expect(c.endDate).toBeNull();
    expect(c.termMonths).toBe(12);
    expect(c.noticeDays).toBe(0);
    expect(c.tags).toEqual(['a', 'b']);
  });

  it('persists across a reload', async () => {
    await store.addContract(contract({ title: 'Persisted' }));
    await store.addContact({ name: 'Ada' });
    const store2 = new Store();
    await store2.init();
    expect(store2.contracts.map((c) => c.title)).toEqual(['Persisted']);
    expect(store2.contacts.map((c) => c.name)).toEqual(['Ada']);
  });

  it('updates a contract in place, preserving id and createdAt', async () => {
    const c = await store.addContract(contract({ title: 'Before' }));
    const updated = await store.updateContract(c.id, { title: 'After' });
    expect(updated.id).toBe(c.id);
    expect(updated.createdAt).toBe(c.createdAt);
    expect(store.contracts).toHaveLength(1);
    expect(store.contractById(c.id).title).toBe('After');
  });

  it('manages obligations end to end', async () => {
    const c = await store.addContract(contract());
    const added = await store.addObligations(c.id, [
      { text: 'Pay rent', owner: 'us', due: addDays(TODAY, 3) },
      { text: '', owner: 'us' },                    // dropped: empty
      { text: 'Weird', owner: 'nobody', due: 'yes' }, // normalized
    ]);
    expect(added).toHaveLength(2);
    expect(added[1].owner).toBe('us');
    expect(added[1].due).toBeNull();

    await store.setObligation(c.id, added[0].id, { done: true });
    expect(store.contractById(c.id).obligations[0].done).toBe(true);

    await store.deleteObligation(c.id, added[0].id);
    expect(store.contractById(c.id).obligations).toHaveLength(1);
  });

  it('attaches, reads, and deletes documents', async () => {
    const c = await store.addContract(contract());
    const file = new File(['agreement body'], 'msa.txt', { type: 'text/plain' });
    const doc = await store.attachDocument(c.id, file);
    expect(store.contractById(c.id).documents).toHaveLength(1);

    const blob = await store.readDocument(doc);
    expect(await blob.text()).toBe('agreement body');

    await store.deleteDocument(c.id, doc.id);
    expect(liveDocuments(store.contractById(c.id))).toHaveLength(0);
  });

  /*
   * contracts.json is normally written only by this app, but "Restore from a
   * backup" reads a file the user was handed. A document pointer is a path the
   * app reads, downloads, and — on a permanent delete — removes.
   */
  it('keeps only document pointers that aim inside the contract\'s own folder', async () => {
    await store.importAll({
      contracts: [contract({
        id: 'abc123def456',
        documents: [
          { id: 'd1', name: 'msa.pdf', path: 'contract-manager/docs/abc123def456/1-msa.pdf' },
          { id: 'd2', name: 'looks innocent', path: 'private/ssh-key' },
          { id: 'd3', name: 'up and out', path: 'contract-manager/docs/abc123def456/../../contacts.json' },
          { id: 'd4', name: 'the folder itself', path: 'contract-manager/docs/abc123def456/..' },
          { id: 'd5', name: 'no path at all' },
        ],
      })],
      contacts: [],
    });
    expect(store.contracts[0].documents.map((d) => d.path))
      .toEqual(['contract-manager/docs/abc123def456/1-msa.pdf']);
  });

  it('drops what is not a record from a restored file instead of refusing all of it', async () => {
    await store.importAll({
      settings: {},
      contracts: [null, 'not a contract', 42, ['nested'], contract({ title: 'Real' })],
      contacts: [undefined, { name: 'Ada' }, 'Bob'],
    });
    expect(store.contracts.map((c) => c.title)).toEqual(['Real']);
    expect(store.contacts.map((c) => c.name)).toEqual(['Ada']);
  });

  it('refuses a contract id that would aim a purge outside the docs folder', async () => {
    await store.importAll({ contracts: [contract({ id: '../..' })], contacts: [] });
    expect(store.contracts[0].id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it('normalizes document metadata a backup could have mangled', async () => {
    await store.importAll({
      contracts: [contract({
        id: 'abc123def456',
        documents: [{
          id: 'd1', path: 'contract-manager/docs/abc123def456/1-msa.pdf',
          name: '', size: 'huge', addedAt: 'yesterday', deletedAt: 'yes',
        }],
      })],
      contacts: [],
    });
    const doc = store.contracts[0].documents[0];
    expect(doc.name).toBe('1-msa.pdf');
    expect(doc.size).toBe(0);
    expect(Number.isFinite(doc.addedAt)).toBe(true);
    // Not a timestamp is not a deletion: it must not leave a row stuck in the trash.
    expect(doc.deletedAt).toBeNull();
    expect(store.trashEntries()).toHaveLength(0);
  });

  it('keeps both documents when two uploads overlap', async () => {
    const c = await store.addContract(contract());
    const [a, b] = await Promise.all([
      store.attachDocument(c.id, new File(['a'], 'a.txt', { type: 'text/plain' })),
      store.attachDocument(c.id, new File(['b'], 'b.txt', { type: 'text/plain' })),
    ]);
    expect(store.contractById(c.id).documents.map((d) => d.id)).toEqual([a.id, b.id]);
  });

  it('cleans up the upload when the contract vanishes mid-flight', async () => {
    const c = await store.addContract(contract());
    const write = puter.fs.write.bind(puter.fs);
    puter.fs.write = async (path, data) => {
      await write(path, data);
      if (path.includes('/docs/')) await store.deleteContract(c.id);
    };
    const file = new File(['x'], 'x.txt', { type: 'text/plain' });
    await expect(store.attachDocument(c.id, file)).rejects.toThrow(`No contract ${c.id}`);
    const orphans = [...puter._files.keys()].filter((k) => k.includes('/docs/'));
    expect(orphans).toEqual([]);
  });

  it('hides a deleted contact from its contracts but keeps the link for a restore', async () => {
    const linkedContact = await store.addContact({ name: 'Linked' });
    const c = await store.addContract(contract({ contactId: linkedContact.id }));
    expect(store.contractsForContact(linkedContact.id)).toHaveLength(1);

    await store.deleteContact(linkedContact.id);
    expect(store.contacts).toHaveLength(0);
    expect(store.contactById(linkedContact.id)).toBeNull();
    // The contract keeps its pointer, so nothing has to be re-linked by hand.
    expect(store.contractById(c.id).contactId).toBe(linkedContact.id);

    await store.restoreContact(linkedContact.id);
    expect(store.contactById(linkedContact.id).name).toBe('Linked');
    expect(store.contractsForContact(linkedContact.id)).toHaveLength(1);
  });

  it('detaches contracts only when a contact is deleted for good', async () => {
    const linkedContact = await store.addContact({ name: 'Linked' });
    const c = await store.addContract(contract({ contactId: linkedContact.id }));
    await store.deleteContact(linkedContact.id);
    await store.purgeTrashEntry(store.trashEntries()[0]);
    expect(store.trashEntries()).toHaveLength(0);
    expect(store.contractById(c.id).contactId).toBeNull();
  });

  it('keeps every sample repeat anchored to its completed history', async () => {
    // The live occurrence must be the one after the completed ones, or ticking
    // it off skips a period.
    for (const c of sampleDataset(store).contracts) {
      for (const ob of c.obligations) {
        if (!ob.repeat) continue;
        expect(occurrenceDue(ob.repeat, ob.history.length)).toBe(ob.due);
      }
    }
  });

  it('round-trips the sample dataset through importAll', async () => {
    await store.importAll(sampleDataset(store));
    expect(store.settings.sampleData).toBe(true);
    expect(store.contracts.length).toBeGreaterThanOrEqual(6);
    expect(store.contacts.length).toBeGreaterThanOrEqual(4);
    // Every sample contract survives normalization intact.
    for (const c of store.contracts) {
      expect(c.id).toBeTruthy();
      expect(c.title).not.toBe('Untitled contract');
    }
    // Sample data is date-anchored: something always needs a look soon.
    const stats = contractStats(store.contracts);
    expect(stats.active).toBeGreaterThan(0);
    expect(stats.openObligations).toBeGreaterThan(0);

    // Wiping restores a clean slate.
    const { wipeSampleData } = await import('../src/lib/sample.js');
    await wipeSampleData(store);
    expect(store.contracts).toEqual([]);
    expect(store.settings.sampleData).toBe(false);
  });

  it('rolls back an add when the write fails, so a retry cannot duplicate', async () => {
    puter.fs.write = async () => { throw new Error('offline'); };
    await expect(store.addContract(contract({ title: 'Ghost' }))).rejects.toThrow('offline');
    expect(store.contracts).toHaveLength(0);
    await expect(store.addContact({ name: 'Ghost' })).rejects.toThrow('offline');
    expect(store.contacts).toHaveLength(0);
  });

  it('rolls back an update when the write fails', async () => {
    const c = await store.addContract(contract({ title: 'Before' }));
    puter.fs.write = async () => { throw new Error('offline'); };
    await expect(store.updateContract(c.id, { title: 'After' })).rejects.toThrow('offline');
    expect(store.contractById(c.id).title).toBe('Before');
  });

  it('restores a contract when its delete fails to persist', async () => {
    const a = await store.addContract(contract({ title: 'A' }));
    const b = await store.addContract(contract({ title: 'B' }));
    puter.fs.write = async () => { throw new Error('offline'); };
    await expect(store.deleteContract(a.id)).rejects.toThrow('offline');
    expect(store.contracts.map((c) => c.title)).toEqual(['B', 'A']);
    expect(store.contractById(a.id)).not.toBeNull();
    expect(b).toBeTruthy();
  });

  it('never lets a later write carry a rolled-back edit into storage', async () => {
    const a = await store.addContract(contract({ title: 'A' }));
    const b = await store.addContract(contract({ title: 'B' }));
    const write = puter.fs.write.bind(puter.fs);
    let failNext = true;
    puter.fs.write = async (path, data) => {
      if (failNext && path.endsWith('contracts.json')) {
        failNext = false;
        throw new Error('offline');
      }
      return write(path, data);
    };

    // Two edits in flight at once, which is one ticked checkbox and one saved
    // form apart. The first fails and is rolled back; the second succeeds.
    const first = store.updateContract(a.id, { title: 'A-edited' }).catch(() => 'failed');
    const second = store.updateContract(b.id, { title: 'B-edited' });
    expect(await first).toBe('failed');
    await second;

    expect(store.contractById(a.id).title).toBe('A');
    expect(store.contractById(b.id).title).toBe('B-edited');
    // What is on disk has to be what is on screen: the edit the user was told
    // did not save must not come back on the next boot.
    const saved = JSON.parse(await (await puter.fs.read('contract-manager/contracts.json')).text());
    expect(saved.find((c) => c.id === a.id).title).toBe('A');
    expect(saved.find((c) => c.id === b.id).title).toBe('B-edited');
  });

  it('restores the contact and its links when a contact delete fails', async () => {
    const contact1 = await store.addContact({ name: 'Linked' });
    const c = await store.addContract(contract({ contactId: contact1.id }));
    puter.fs.write = async () => { throw new Error('offline'); };
    await expect(store.deleteContact(contact1.id)).rejects.toThrow('offline');
    expect(store.contactById(contact1.id)).not.toBeNull();
    expect(store.contractById(c.id).contactId).toBe(contact1.id);
  });

  /* --- trash --- */

  it('keeps a deleted contract out of every read path but restorable', async () => {
    const a = await store.addContract(contract({
      title: 'Gone', value: 100, billing: 'monthly',
      obligations: [{ id: 'o1', text: 'Pay', due: TODAY, done: false }],
    }));
    await store.addContract(contract({ title: 'Stays' }));
    await store.deleteContract(a.id);

    expect(store.contracts.map((c) => c.title)).toEqual(['Stays']);
    expect(store.contractById(a.id)).toBeNull();
    expect(searchContracts(store.contracts, 'gone')).toHaveLength(0);
    expect(dueObligations(store.contracts, { today: TODAY })).toHaveLength(0);
    expect(upcomingRenewals(store.contracts, { today: TODAY })).toHaveLength(1);
    expect(contractStats(store.contracts, TODAY).active).toBe(1);

    await store.restoreContract(a.id);
    expect(store.contractById(a.id).title).toBe('Gone');
    expect(dueObligations(store.contracts, { today: TODAY })).toHaveLength(1);
  });

  it('survives a reload with the trash intact', async () => {
    const a = await store.addContract(contract({ title: 'Trashed' }));
    await store.deleteContract(a.id);
    const store2 = new Store();
    await store2.init();
    expect(store2.contracts).toHaveLength(0);
    expect(store2.trashEntries().map((e) => e.title)).toEqual(['Trashed']);
  });

  it('keeps a deleted contract\'s documents in storage until it is purged', async () => {
    const c = await store.addContract(contract());
    const doc = await store.attachDocument(c.id, new File(['signed'], 'msa.txt', { type: 'text/plain' }));
    await store.deleteContract(c.id);
    // The file survives the delete, so a restore brings the agreement back.
    expect(await (await store.readDocument(doc)).text()).toBe('signed');

    await store.restoreContract(c.id);
    expect(store.contractById(c.id).documents).toHaveLength(1);

    await store.deleteContract(c.id);
    await store.purgeTrashEntry(store.trashEntries()[0]);
    expect([...puter._files.keys()].filter((k) => k.includes('/docs/'))).toEqual([]);
  });

  it('trashes a document without touching its file, and restores it in place', async () => {
    const c = await store.addContract(contract());
    const a = await store.attachDocument(c.id, new File(['a'], 'a.txt', { type: 'text/plain' }));
    const b = await store.attachDocument(c.id, new File(['b'], 'b.txt', { type: 'text/plain' }));
    await store.deleteDocument(c.id, a.id);

    expect(liveDocuments(store.contractById(c.id)).map((d) => d.name)).toEqual(['b.txt']);
    expect(store.trashEntries().map((e) => e.kind)).toEqual(['document']);
    expect(await (await store.readDocument(a)).text()).toBe('a');

    await store.restoreDocument(c.id, a.id);
    expect(liveDocuments(store.contractById(c.id)).map((d) => d.name)).toEqual(['a.txt', 'b.txt']);
    expect(b).toBeTruthy();
  });

  it('purges a document without disturbing its neighbours', async () => {
    const c = await store.addContract(contract());
    const a = await store.attachDocument(c.id, new File(['a'], 'a.txt', { type: 'text/plain' }));
    await store.attachDocument(c.id, new File(['b'], 'b.txt', { type: 'text/plain' }));
    await store.deleteDocument(c.id, a.id);
    await store.purgeTrashEntry(store.trashEntries()[0]);
    expect(store.contractById(c.id).documents.map((d) => d.name)).toEqual(['b.txt']);
    expect([...puter._files.keys()].filter((k) => k.includes('/docs/'))).toHaveLength(1);
  });

  it('deletes an obligation with everything an undo needs', async () => {
    const c = await store.addContract(contract());
    const added = await store.addObligations(c.id, [
      { text: 'First', owner: 'us' }, { text: 'Second', owner: 'them' }, { text: 'Third', owner: 'us' },
    ]);
    const removed = await store.deleteObligation(c.id, added[1].id);
    expect(removed.index).toBe(1);
    expect(removed.obligation.text).toBe('Second');

    await store.restoreObligation(c.id, removed.obligation, removed.index);
    expect(store.contractById(c.id).obligations.map((o) => o.text)).toEqual(['First', 'Second', 'Third']);

    // Undoing twice must not duplicate the row.
    await store.restoreObligation(c.id, removed.obligation, removed.index);
    expect(store.contractById(c.id).obligations).toHaveLength(3);
  });

  it('empties the trash and leaves live records alone', async () => {
    const gone = await store.addContract(contract({ title: 'Gone' }));
    const kept = await store.addContract(contract({ title: 'Kept' }));
    const contact1 = await store.addContact({ name: 'Gone too' });
    await store.deleteContract(gone.id);
    await store.deleteContact(contact1.id);
    expect(store.trashCount()).toBe(2);

    await store.emptyTrash();
    expect(store.trashCount()).toBe(0);
    expect(store.contracts.map((c) => c.title)).toEqual(['Kept']);
    expect(kept).toBeTruthy();
  });

  it('purges only what has outstayed its 30 days', async () => {
    const old = await store.addContract(contract({ title: 'Old' }));
    const fresh = await store.addContract(contract({ title: 'Fresh' }));
    await store.deleteContract(old.id);
    await store.deleteContract(fresh.id);
    // Backdate one deletion past the window, as if the app had been closed.
    const path = 'contract-manager/contracts.json';
    const saved = JSON.parse(await (await puter.fs.read(path)).text());
    for (const c of saved) if (c.title === 'Old') c.deletedAt = Date.now() - 31 * 86400000;
    await puter.fs.write(path, JSON.stringify(saved));

    const store2 = new Store();
    await store2.init();
    await store2.purgeExpiredTrash();
    expect(store2.trashEntries().map((e) => e.title)).toEqual(['Fresh']);
  });

  /* --- renewal decisions --- */

  it('records a decision against the term end in front of the user', async () => {
    const c = await store.addContract(contract({
      endDate: addDays(todayISO(), 20), noticeDays: 30, autoRenew: true,
    }));
    await store.recordDecision(c.id, { kind: 'notice-given', note: 'emailed Maya' });
    const saved = store.contractById(c.id);
    expect(saved.decision).toMatchObject({
      kind: 'notice-given', note: 'emailed Maya', forTermEnd: addDays(todayISO(), 20),
    });
    // Quiet in every list that used to shout.
    expect(needsAttention(saved)).toBe(false);
    expect(saved.status).toBe('active');

    await store.clearDecision(c.id);
    expect(store.contractById(c.id).decision).toBeNull();
    expect(needsAttention(store.contractById(c.id))).toBe(true);
  });

  it('closes out an already-expired contract as soon as the decision is recorded', async () => {
    const c = await store.addContract(contract({
      startDate: addMonths(todayISO(), -14), endDate: addDays(todayISO(), -20),
      autoRenew: false, noticeDays: 30,
    }));
    expect(needsAttention(store.contractById(c.id))).toBe(true);

    await store.recordDecision(c.id, { kind: 'not-renewing' });
    const saved = store.contractById(c.id);
    expect(saved.status).toBe('terminated');
    expect(saved.termHistory).toHaveLength(1);
    expect(saved.termHistory[0].ended).toBe('expired');
  });

  it('keeps a snooze recorded against a term that has already run out', async () => {
    const c = await store.addContract(contract({
      startDate: addMonths(todayISO(), -14), endDate: addDays(todayISO(), -20),
      autoRenew: false, noticeDays: 30,
    }));
    expect(needsAttention(store.contractById(c.id))).toBe(true);

    const until = addDays(todayISO(), 14);
    await store.recordDecision(c.id, { kind: 'snoozed', note: 'chasing legal', until });
    const saved = store.contractById(c.id);
    // A lapsed fixed term does not roll forward, so the snooze still answers
    // the deadline on screen and has to survive the term being recorded.
    expect(saved.decision).toMatchObject({ kind: 'snoozed', until });
    expect(saved.status).toBe('active');
    expect(saved.termHistory).toHaveLength(1);
    expect(needsAttention(saved)).toBe(false);

    // And it settles: a later reconciliation has nothing left to change.
    expect(termReconciliation(saved, todayISO())).toBeNull();
  });

  it('keeps "renewing" recorded against a term that has already run out', async () => {
    const c = await store.addContract(contract({
      startDate: addMonths(todayISO(), -14), endDate: addDays(todayISO(), -20),
      autoRenew: false, noticeDays: 30,
    }));
    await store.recordDecision(c.id, { kind: 'renewing', note: 'new SOW signed' });
    const saved = store.contractById(c.id);
    expect(saved.decision).toMatchObject({ kind: 'renewing', note: 'new SOW signed' });
    expect(saved.status).toBe('active');
    expect(needsAttention(saved)).toBe(false);
  });

  it('still drops a decision once an auto-renewing term has rolled past it', async () => {
    const c = await store.addContract(contract({
      startDate: addMonths(todayISO(), -25), endDate: addMonths(todayISO(), -13),
      autoRenew: true, termMonths: 12, noticeDays: 30,
      decision: {
        kind: 'renewing', date: addMonths(todayISO(), -14),
        forTermEnd: addMonths(todayISO(), -13),
      },
    }));
    await store.reconcileTerms();
    expect(store.contractById(c.id).decision).toBeNull();
  });

  it('rejects a snooze with no date, so nothing is silently dismissed', async () => {
    const c = await store.addContract(contract({ endDate: addDays(todayISO(), 20), noticeDays: 30 }));
    await store.recordDecision(c.id, { kind: 'snoozed', until: null });
    expect(store.contractById(c.id).decision).toBeNull();
    expect(needsAttention(store.contractById(c.id))).toBe(true);
  });

  it('reconciles terms that ended while the app was closed', async () => {
    const c = await store.addContract(contract({
      startDate: addMonths(todayISO(), -25), endDate: addMonths(todayISO(), -13),
      autoRenew: true, termMonths: 12,
    }));
    // Written straight to storage so init() meets it cold, unreconciled.
    const store2 = new Store();
    await store2.init();
    await store2.reconcileTerms();
    const saved = store2.contractById(c.id);
    expect(saved.termHistory.map((t) => t.ended)).toEqual(['renewed', 'renewed']);
    expect(saved.status).toBe('active');
    // Idempotent: a second boot adds nothing.
    await store2.reconcileTerms();
    expect(store2.contractById(c.id).termHistory).toHaveLength(2);
  });

  it('leaves the trash out of an export', async () => {
    const c = await store.addContract(contract({ title: 'Kept' }));
    const doc = await store.attachDocument(c.id, new File(['x'], 'x.txt', { type: 'text/plain' }));
    await store.deleteDocument(c.id, doc.id);
    const gone = await store.addContract(contract({ title: 'Gone' }));
    await store.deleteContract(gone.id);

    const dump = store.exportAll();
    expect(dump.contracts.map((x) => x.title)).toEqual(['Kept']);
    expect(dump.contracts[0].documents).toEqual([]);
  });

  it('rolls back settings when the KV write fails', async () => {
    puter.kv.set = async () => { throw new Error('offline'); };
    await expect(store.updateSettings({ currency: 'EUR' })).rejects.toThrow('offline');
    expect(store.settings.currency).toBe('USD');
  });

  it('rolls back a failed restore instead of showing a backup that was not saved', async () => {
    const kept = await store.addContract(contract({ title: 'Already here' }));
    await store.addContact({ name: 'Already here too' });
    await store.updateSettings({ currency: 'GBP' });

    puter.fs.write = async () => { throw new Error('offline'); };
    await expect(store.importAll({
      settings: { currency: 'JPY' },
      contracts: [contract({ title: 'From the backup' })],
      contacts: [{ name: 'From the backup' }],
    })).rejects.toThrow('offline');

    // Everything the user had is still in front of them, unchanged.
    expect(store.contracts.map((c) => c.title)).toEqual(['Already here']);
    expect(store.contracts[0].id).toBe(kept.id);
    expect(store.contacts.map((c) => c.name)).toEqual(['Already here too']);
    expect(store.settings.currency).toBe('GBP');
  });

  it('exportAll captures the full dataset', async () => {
    await store.addContract(contract({ title: 'Exported' }));
    const dump = store.exportAll();
    expect(dump.app).toBe('contract-manager');
    expect(dump.contracts).toHaveLength(1);
    expect(dump.settings.theme).toBe('system');
  });

  /* --- the published calendar feed is a credential, not exportable data --- */

  const FEED = { subdomain: 'cm-secret', url: 'https://cm-secret.puter.site/deadlines.ics', createdAt: 1 };

  it('keeps the feed link out of an export', async () => {
    await store.updateSettings({ feed: FEED, currency: 'EUR' });
    const dump = store.exportAll();
    expect(dump.settings.feed).toBeUndefined();
    expect(JSON.stringify(dump)).not.toContain('cm-secret');
    // Everything else about the settings still travels.
    expect(dump.settings.currency).toBe('EUR');
  });

  it('leaves a live feed alone when a backup is restored', async () => {
    await store.updateSettings({ feed: FEED });
    // A backup taken before the feed existed must not silently forget it:
    // the URL would keep serving deadlines with no way left to revoke it.
    await store.importAll({ settings: { currency: 'GBP' }, contracts: [], contacts: [] });
    expect(store.settings.feed).toEqual(FEED);
    expect(store.settings.currency).toBe('GBP');
  });

  it('does not resurrect a feed that has since been revoked', async () => {
    await store.importAll({
      settings: { currency: 'USD', feed: FEED },
      contracts: [],
      contacts: [],
    });
    expect(store.settings.feed).toBeNull();
  });
});

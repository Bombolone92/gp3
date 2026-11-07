import { describe, it, expect } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { logActivity, activityName, describe as describeActivity, dailyReport, countByType, openNaps, updateActivity, durationLabel } from '../src/core/activities.js';

const DAY = '2026-10-12';

describe('activities', () => {
  it('logs one record per child, sharing a group and the same photos', async () => {
    const s = createStore({ backend: createMemoryBackend(), flushDelay: 10_000 });
    await s.init();
    const media = [{ path: 'media/2026-10/p.jpg' }];
    const recs = logActivity(s, { type: 'photo', day: DAY, at: '10:00', studentIds: ['a', 'b'], roomOf: () => 'r1', media, note: '  Painting  ', details: { empty: '' } });
    expect(recs).toHaveLength(2);
    expect(s.all(activityName(DAY))).toHaveLength(2);
    expect(recs[0].groupId).toBeTruthy();
    expect(recs[0].groupId).toBe(recs[1].groupId);
    expect(recs[0]).toMatchObject({ roomId: 'r1', note: 'Painting', media });
    expect(recs[0].details).toEqual({});
    const single = logActivity(s, { type: 'note', day: DAY, at: '11:00', studentIds: ['a'] });
    expect(single[0].groupId).toBeUndefined();
    expect(() => logActivity(s, { type: 'bogus', day: DAY, at: '11:00', studentIds: ['a'] })).toThrow();
  });

  it('describes each kind of entry in plain words', () => {
    expect(describeActivity({ type: 'meal', details: { meal: 'Lunch', amount: 'most', items: 'Pasta' } })).toBe('Lunch · Ate most · Pasta');
    expect(describeActivity({ type: 'meal', details: { kind: 'bottle', amount: '5', unit: 'oz', contents: 'Formula' } })).toBe('Bottle 5 oz of formula');
    expect(describeActivity({ type: 'nap', details: { start: '12:30', end: '14:00' } })).toMatch(/1 hr 30 min/);
    expect(describeActivity({ type: 'nap', details: { start: '12:30' } })).toMatch(/^Fell asleep/);
    expect(describeActivity({ type: 'toilet', details: { kind: 'diaper', wet: true, bm: true, cream: true } })).toBe('Diaper: wet, BM · Cream applied');
    expect(describeActivity({ type: 'health', details: { result: 'concern', temperature: '100.4' } })).toBe('Needs attention · Temperature 100.4 F');
    expect(describeActivity({ type: 'kudos', details: { category: 'Sharing' } })).toBe('Kudos for sharing');
  });

  it('builds a daily report with total sleep', () => {
    const list = [
      { type: 'nap', at: '12:30', details: { start: '12:30', end: '13:45' } },
      { type: 'nap', at: '09:00', details: { start: '09:00', end: '09:30' } },
      { type: 'meal', at: '11:30', details: { meal: 'Lunch' } },
      { type: 'toilet', at: '10:00', details: { kind: 'diaper' } },
      { type: 'photo', at: '10:30', media: [{ path: 'x' }] },
    ];
    const r = dailyReport(list);
    expect(r.sleepMinutes).toBe(105);
    expect(r.naps.map((a) => a.at)).toEqual(['09:00', '12:30']);
    expect(r.meals).toHaveLength(1);
    expect(r.photos).toHaveLength(1);
    expect(r.other).toHaveLength(1);
    expect(countByType(list).map((c) => [c.type.id, c.count])).toEqual([['photo', 1], ['meal', 1], ['nap', 2], ['toilet', 1]]);
  });

  it('finds naps in progress and ends them', async () => {
    const s = createStore({ backend: createMemoryBackend(), flushDelay: 10_000 });
    await s.init();
    const [nap] = logActivity(s, { type: 'nap', day: DAY, at: '12:00', studentIds: ['a'], details: { start: '12:00' } });
    expect(openNaps(s.all(activityName(DAY)))).toHaveLength(1);
    updateActivity(s, nap, { details: { end: '13:10' } });
    expect(openNaps(s.all(activityName(DAY)))).toHaveLength(0);
    expect(s.get(activityName(DAY), nap.id).details).toEqual({ start: '12:00', end: '13:10' });
    expect(durationLabel(70)).toBe('1 hr 10 min');
  });
});

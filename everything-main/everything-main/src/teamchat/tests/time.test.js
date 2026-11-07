import { describe, it, expect } from 'vitest';
import { dayLabel, relativeShort, relativeLong, isContinuation, isActive, sameDay, presenceState, LEAVING_GRACE_MS, PRESENCE_WINDOW_MS } from '../src/lib/time.js';
import { parseHash, buildHash, parseInviteInput } from '../src/lib/router.js';
import { mergeMessages } from '../src/lib/store.js';

const NOW = new Date(2026, 7, 26, 15, 30).getTime(); // a Wednesday
const H = 3600_000;
const D = 24 * H;

describe('time', () => {
  it('labels days relative to now', () => {
    expect(dayLabel(NOW - H, NOW)).toBe('Today');
    expect(dayLabel(NOW - D, NOW)).toBe('Yesterday');
    expect(dayLabel(NOW + D, NOW)).toBe('Tomorrow');
    expect(dayLabel(NOW - 3 * D, NOW, 'en-US')).toBe('Sunday');
    expect(dayLabel(NOW - 30 * D, NOW, 'en-US')).toMatch(/Jul 27/);
    expect(dayLabel(NOW - 400 * D, NOW, 'en-US')).toMatch(/2025/);
  });

  it('relativeLong counts calendar days', () => {
    expect(relativeLong(NOW - 30_000, NOW)).toBe('just now');
    expect(relativeLong(NOW - 5 * 60_000, NOW)).toBe('5 minutes ago');
    expect(relativeLong(NOW - 3 * H, NOW, 'en-US')).toBe('today at 12:30 PM');
    expect(relativeLong(NOW - D, NOW, 'en-US')).toBe('yesterday at 3:30 PM');
    // One in the morning on Wednesday: Monday 11 p.m. is two days ago, not "yesterday".
    const late = new Date(2026, 7, 26, 1, 0).getTime();
    expect(relativeLong(new Date(2026, 7, 24, 23, 0).getTime(), late, 'en-US')).toBe('Monday at 11:00 PM');
    expect(relativeLong(new Date(2026, 7, 25, 23, 0).getTime(), late, 'en-US')).toBe('yesterday at 11:00 PM');
  });

  it('relativeShort', () => {
    expect(relativeShort(NOW - 10_000, NOW)).toBe('now');
    expect(relativeShort(NOW - 5 * 60_000, NOW)).toBe('5m');
    expect(relativeShort(NOW - 3 * H, NOW)).toBe('3h');
    expect(relativeShort(NOW - 2 * D, NOW)).toBe('2d');
    expect(relativeShort(NOW - 20 * D, NOW, 'en-US')).toMatch(/Aug 6/);
  });

  it('groups consecutive messages by the same author within five minutes', () => {
    const a = { user: 'u', ts: NOW, kind: 'msg' };
    expect(isContinuation(a, { user: 'u', ts: NOW + 60_000, kind: 'msg' })).toBe(true);
    expect(isContinuation(a, { user: 'u', ts: NOW + 6 * 60_000, kind: 'msg' })).toBe(false);
    expect(isContinuation(a, { user: 'v', ts: NOW + 1000, kind: 'msg' })).toBe(false);
    expect(isContinuation(a, { user: 'u', ts: NOW + 1000, kind: 'sys' })).toBe(false);
    expect(isContinuation(null, a)).toBe(false);
  });

  it('presence window', () => {
    // Expressed against the window itself: it is sized to clear a lost poll
    // or two at the safety cadence (see PRESENCE_WINDOW_MS), so a fixed
    // number here would pin the cadence by accident.
    expect(isActive(NOW - 30_000, NOW)).toBe(true);
    expect(isActive(NOW - (PRESENCE_WINDOW_MS - 1000), NOW)).toBe(true);
    expect(isActive(NOW - (PRESENCE_WINDOW_MS + 1000), NOW)).toBe(false);
    expect(isActive(undefined, NOW)).toBe(false);
  });

  it('derives a presence state from the heartbeat and its flag', () => {
    expect(presenceState(NOW - 30_000, null, NOW)).toBe('active');
    expect(presenceState(NOW - 30_000, 'dnd', NOW)).toBe('dnd');
    expect(presenceState(NOW - 3 * H, null, NOW)).toBe('away');
    expect(presenceState(NOW - 3 * H, 'dnd', NOW)).toBe('away'); // a stale dnd flag is just away
    expect(presenceState(NOW - 2 * D, null, NOW)).toBe('offline');
    expect(presenceState(undefined, null, NOW)).toBe('offline');
    // A tab that said it was closing: away once the word has stood for the
    // grace (a reload says goodbye and hello within it), offline after a day.
    expect(presenceState(NOW - 1000, 'off', NOW)).toBe('active');
    expect(presenceState(NOW - LEAVING_GRACE_MS, 'off', NOW)).toBe('away');
    expect(presenceState(NOW - 30_000, 'off', NOW)).toBe('away');
    expect(presenceState(NOW - 2 * D, 'off', NOW)).toBe('offline');
  });

  it('sameDay respects local midnight', () => {
    const d = new Date(2026, 0, 1, 23, 59).getTime();
    expect(sameDay(d, d + 60_000)).toBe(false);
    expect(sameDay(d, d - 60_000)).toBe(true);
  });
});

describe('router', () => {
  it('parses and builds routes symmetrically', () => {
    const cases = [
      { ws: 'abc' },
      { ws: 'abc', conv: 'ch1' },
      { ws: 'abc', conv: 'ch1', thread: 42 },
      { ws: 'abc', conv: 'dm_x', details: true },
    ];
    for (const c of cases) {
      const r = parseHash(buildHash(c));
      expect(r.ws).toBe(c.ws);
      expect(r.conv).toBe(c.conv || null);
      expect(r.thread).toBe(c.thread ?? null);
      expect(r.details).toBe(!!c.details);
    }
    expect(parseHash('')).toMatchObject({ name: 'home' });
    expect(parseHash('#/join/ABC-DEF-GHJ')).toMatchObject({ name: 'join', code: 'ABC-DEF-GHJ' });
    expect(parseHash('#/garbage/x')).toMatchObject({ name: 'home' });
    expect(parseHash('#/ws/a/c/b/t/notanumber').thread).toBeNull();
  });

  it('extracts codes from pasted links', () => {
    expect(parseInviteInput('https://x.y/app/#/join/ABC-DEF-GHJ').code).toBe('ABC-DEF-GHJ');
    expect(parseInviteInput(' abc-def-ghj ').code).toBe('ABC-DEF-GHJ');
  });
});

describe('mergeMessages', () => {
  it('retires a queued placeholder once the message it stands for has arrived with its client id', () => {
    const queued = { seq: null, tempId: 'c_abc', cid: 'c_abc', text: 'hello', queued: true };
    const other = { seq: null, tempId: 'c_def', cid: 'c_def', text: 'later', queued: true };
    const out = mergeMessages([{ seq: 1 }, queued, other], [{ seq: 2, cid: 'c_abc', text: 'hello' }]);
    expect(out.map((m) => m.seq ?? m.cid)).toEqual([1, 2, 'c_def']);
  });

  it('merges ordered windows, dedupes by seq, keeps pending last', () => {
    const pending = { seq: null, text: 'p' };
    const out = mergeMessages([{ seq: 1 }, { seq: 3 }, pending], [{ seq: 2 }, { seq: 3, text: 'newer' }]);
    expect(out.map((m) => m.seq)).toEqual([1, 2, 3, null]);
    expect(out[2].text).toBe('newer');
    expect(out[3]).toBe(pending);
  });
});

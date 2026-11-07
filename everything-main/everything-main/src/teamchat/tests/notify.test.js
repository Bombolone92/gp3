/**
 * Notification policy: which events notify under which per-conversation
 * setting, and quiet hours arithmetic. Pure functions, no browser.
 */
import { describe, it, expect } from 'vitest';
import { shouldNotify, inQuietHours, notificationsPaused, startOfTomorrow, defaultLevel } from '../src/lib/notify.js';

describe('shouldNotify', () => {
  it('defaults are unchanged: mentions and direct messages only', () => {
    expect(defaultLevel('channel')).toBe('mentions');
    expect(defaultLevel('dm')).toBe('all');
    expect(shouldNotify({ event: 'message', kind: 'channel' })).toBe(false);
    expect(shouldNotify({ event: 'mention', kind: 'channel' })).toBe(true);
    expect(shouldNotify({ event: 'message', kind: 'dm' })).toBe(true);
  });

  it('follows the chosen level', () => {
    expect(shouldNotify({ event: 'message', setting: { level: 'all' } })).toBe(true);
    expect(shouldNotify({ event: 'message', setting: { level: 'mentions' } })).toBe(false);
    expect(shouldNotify({ event: 'mention', setting: { level: 'mentions' } })).toBe(true);
    expect(shouldNotify({ event: 'mention', setting: { level: 'nothing' } })).toBe(false);
    expect(shouldNotify({ event: 'message', setting: { level: 'nothing' }, kind: 'dm' })).toBe(false);
    expect(shouldNotify({ event: 'reply', setting: { level: 'mentions' } })).toBe(true);
  });

  it('mute silences everything, whatever the level', () => {
    for (const level of ['all', 'mentions', 'nothing', undefined]) {
      expect(shouldNotify({ event: 'mention', setting: { level, mute: true } })).toBe(false);
      expect(shouldNotify({ event: 'message', setting: { level, mute: true }, kind: 'dm' })).toBe(false);
    }
  });
});

describe('quiet hours', () => {
  const at = (h, m = 0) => new Date(2026, 7, 26, h, m).getTime();

  it('handles same-day and overnight windows', () => {
    const day = { enabled: true, from: '09:00', to: '17:00' };
    expect(inQuietHours(day, at(12))).toBe(true);
    expect(inQuietHours(day, at(8, 59))).toBe(false);
    expect(inQuietHours(day, at(17))).toBe(false);
    const night = { enabled: true, from: '22:00', to: '08:00' };
    expect(inQuietHours(night, at(23))).toBe(true);
    expect(inQuietHours(night, at(3))).toBe(true);
    expect(inQuietHours(night, at(8))).toBe(false);
    expect(inQuietHours(night, at(12))).toBe(false);
  });

  it('ignores disabled, empty, or malformed windows', () => {
    expect(inQuietHours({ enabled: false, from: '00:00', to: '23:59' }, at(12))).toBe(false);
    expect(inQuietHours({ enabled: true, from: '10:00', to: '10:00' }, at(10))).toBe(false);
    expect(inQuietHours({ enabled: true, from: 'soon', to: '10:00' }, at(9))).toBe(false);
    expect(inQuietHours(null, at(9))).toBe(false);
  });

  it('pausing wins until it expires, and "tomorrow" is local midnight', () => {
    const now = at(15);
    expect(notificationsPaused({ pauseUntil: now + 1000 }, now)).toBe(true);
    expect(notificationsPaused({ pauseUntil: now - 1000 }, now)).toBe(false);
    expect(notificationsPaused({ dnd: { enabled: true, from: '14:00', to: '16:00' } }, now)).toBe(true);
    expect(notificationsPaused({}, now)).toBe(false);
    const tomorrow = new Date(startOfTomorrow(now));
    expect(tomorrow.getHours()).toBe(0);
    expect(tomorrow.getDate()).toBe(27);
  });
});

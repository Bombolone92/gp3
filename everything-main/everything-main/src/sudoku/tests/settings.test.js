import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, THEMES, normalizeSettings, resolveTheme } from '../src/game/settings.js';

describe('defaults', () => {
  it('follows the system theme out of the box', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('system');
    expect(THEMES).toContain('system');
  });

  it('starts every solving aid on, so nothing has to be discovered', () => {
    expect(DEFAULT_SETTINGS.checkAsYouGo).toBe(true);
    expect(DEFAULT_SETTINGS.highlightPeers).toBe(true);
    expect(DEFAULT_SETTINGS.highlightSame).toBe(true);
    expect(DEFAULT_SETTINGS.autoClearNotes).toBe(true);
    expect(DEFAULT_SETTINGS.showTimer).toBe(true);
    expect(DEFAULT_SETTINGS.showRemaining).toBe(true);
  });
});

describe('normalizeSettings', () => {
  it('falls back to the defaults for anything unreadable', () => {
    for (const junk of [null, undefined, 'nope', 42, []]) {
      expect(normalizeSettings(junk)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('keeps stored preferences', () => {
    const stored = { theme: 'dark', checkAsYouGo: false, showTimer: false };
    const settings = normalizeSettings(stored);
    expect(settings.theme).toBe('dark');
    expect(settings.checkAsYouGo).toBe(false);
    expect(settings.showTimer).toBe(false);
    expect(settings.highlightPeers).toBe(true); // untouched, so still the default
  });

  it('rejects a theme it does not know', () => {
    expect(normalizeSettings({ theme: 'sepia' }).theme).toBe('system');
    expect(normalizeSettings({ theme: 7 }).theme).toBe('system');
  });

  it('ignores non-boolean values for switches', () => {
    const settings = normalizeSettings({ checkAsYouGo: 'yes', showTimer: 0, autoClearNotes: null });
    expect(settings.checkAsYouGo).toBe(true);
    expect(settings.showTimer).toBe(true);
    expect(settings.autoClearNotes).toBe(true);
  });

  it('drops keys it does not recognise', () => {
    const settings = normalizeSettings({ cheatMode: true });
    expect(settings).not.toHaveProperty('cheatMode');
    expect(Object.keys(settings).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it('does not alias the defaults, so one call cannot poison the next', () => {
    const first = normalizeSettings({});
    first.showTimer = false;
    expect(normalizeSettings({}).showTimer).toBe(true);
  });
});

describe('resolveTheme', () => {
  it('honours an explicit choice whatever the system says', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the system when set to system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('treats an unknown value as system rather than failing', () => {
    expect(resolveTheme(undefined, true)).toBe('dark');
    expect(resolveTheme('sepia', false)).toBe('light');
  });
});

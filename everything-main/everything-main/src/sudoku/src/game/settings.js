/**
 * Player preferences, and the reasoning behind each default.
 *
 * These live only on the device. They describe how someone likes to play on
 * this screen (a phone and a desktop reasonably differ), so unlike stats and
 * saves they are deliberately not synced.
 */

export const THEMES = ['light', 'dark', 'system'];

export const DEFAULT_SETTINGS = {
  /** System, so the app matches the OS the first time it is opened. */
  theme: 'system',
  /** Dim the row, column and box of the selected cell: the scan a player is
   *  doing anyway, and the single biggest reduction in visual work. */
  highlightPeers: true,
  /** Light up every cell holding the selected digit: how you spot where a
   *  digit can still go. */
  highlightSame: true,
  /** Flag a wrong digit as it is entered. On by default because the
   *  alternative is discovering it twenty moves later with no way back. Off
   *  is the purist setting, and it is one tap away. */
  checkAsYouGo: true,
  /** Placing a digit rubs it out of its peers' pencil marks: the bookkeeping
   *  a player would otherwise do by hand. */
  autoClearNotes: true,
  /** Show the clock. Some people find it motivating and some find it stressful. */
  showTimer: true,
  /** Show how many of each digit are left, on the keypad. */
  showRemaining: true,
};

/** Merge stored preferences over the defaults, ignoring anything unexpected. */
export function normalizeSettings(raw) {
  const settings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return settings;
  if (THEMES.includes(raw.theme)) settings.theme = raw.theme;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key === 'theme') continue;
    if (typeof raw[key] === 'boolean') settings[key] = raw[key];
  }
  return settings;
}

/**
 * The theme actually in force: 'system' resolved against the OS setting.
 * @param {string} theme
 * @param {boolean} prefersDark
 */
export const resolveTheme = (theme, prefersDark) =>
  theme === 'light' || theme === 'dark' ? theme : prefersDark ? 'dark' : 'light';

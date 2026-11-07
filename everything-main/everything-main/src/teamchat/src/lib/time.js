/** Time helpers for message lists. All accept epoch milliseconds. */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function sameDay(a, b) {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function formatTime(ts, locale) {
  return new Date(ts).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/** "Today", "Yesterday", "Tomorrow", weekday within a week, else a date. */
export function dayLabel(ts, now = Date.now(), locale) {
  const today = startOfDay(now);
  const day = startOfDay(ts);
  const diff = Math.round((today - day) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff === -1) return 'Tomorrow';
  const d = new Date(ts);
  if (diff > 1 && diff < 7) return d.toLocaleDateString(locale, { weekday: 'long' });
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date(now).getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(locale, opts);
}

/** Compact relative time: "now", "5m", "3h", "2d", or a short date. */
export function relativeShort(ts, now = Date.now(), locale) {
  const diff = Math.max(0, now - ts);
  if (diff < MIN) return 'now';
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;
  return new Date(ts).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/** Longer relative phrase for tooltips and thread summaries. */
export function relativeLong(ts, now = Date.now(), locale) {
  const diff = Math.max(0, now - ts);
  if (diff < MIN) return 'just now';
  if (diff < HOUR) {
    const m = Math.floor(diff / MIN);
    return `${m} minute${m === 1 ? '' : 's'} ago`;
  }
  // Calendar days, not 24-hour spans: at one in the morning, the evening
  // before last is two days ago, whatever the hour count says.
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / DAY);
  if (days === 0) return `today at ${formatTime(ts, locale)}`;
  if (days === 1) return `yesterday at ${formatTime(ts, locale)}`;
  return `${dayLabel(ts, now, locale)} at ${formatTime(ts, locale)}`;
}

/**
 * When something set to clear or land does so: the time alone today, the
 * day before it otherwise ("Tomorrow, 12:00 AM", "Sat, Sep 5, 3:14 PM"),
 * since a bare time reads as today's.
 */
export function untilText(ts, now = Date.now(), locale) {
  const day = dayLabel(ts, now, locale);
  return day === 'Today' ? formatTime(ts, locale) : `${day}, ${formatTime(ts, locale)}`;
}

export function fullDateTime(ts, locale) {
  return new Date(ts).toLocaleString(locale, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/**
 * Should `msg` render as a continuation of `prev` (no avatar, no name)?
 * Same author, within five minutes, same day, and neither is a system line
 * nor a reminder: a reminder that came due is the app's line, not something
 * its member said, though it is filed under them (they set it). Grouped, a
 * note written under one within five minutes lost its name and time and
 * read as part of the reminder, and a reminder due within five minutes of a
 * note lost the time it came due.
 */
const APP_LINES = new Set(['sys', 'rem']);
export function isContinuation(prev, msg) {
  if (!prev || !msg) return false;
  if (APP_LINES.has(prev.kind) || APP_LINES.has(msg.kind)) return false;
  if (prev.user !== msg.user) return false;
  if (!sameDay(prev.ts, msg.ts)) return false;
  return msg.ts - prev.ts < 5 * MIN;
}

/**
 * How long a heartbeat keeps someone shown as active. Wide enough that a
 * poll or two may be lost without the person flickering away: heartbeats
 * ride on the poll, and under a healthy events subscription that runs at
 * POLL_SAFETY_MS, so this has to clear a couple of those (see the store's
 * scheduler). A tab that closes cleanly says so at once (`presenceBye`), so
 * this window only governs a tab that went away without a word.
 */
export const PRESENCE_WINDOW_MS = 150_000;

/** Presence: "active" if seen within the window. */
export function isActive(lastSeen, now = Date.now(), window = PRESENCE_WINDOW_MS) {
  return typeof lastSeen === 'number' && now - lastSeen < window;
}

/**
 * A tab that closes says so ('off' beside its last heartbeat). The word is
 * believed after this long: a reload says goodbye and hello within a second
 * or two, and nobody should see the person flicker away in between.
 */
export const LEAVING_GRACE_MS = 5000;

/**
 * Presence as a state: 'dnd' when the person has paused notifications and
 * is around, 'active' with a recent heartbeat, 'away' when seen in the last
 * day, else 'offline'. Derived from the heartbeat the poll already carries,
 * and from the word a closing tab leaves beside it (see LEAVING_GRACE_MS).
 */
export function presenceState(lastSeen, flag = null, now = Date.now()) {
  const left = flag === 'off' && typeof lastSeen === 'number' && now - lastSeen >= LEAVING_GRACE_MS;
  const active = !left && isActive(lastSeen, now);
  if (active && flag === 'dnd') return 'dnd';
  if (active) return 'active';
  if (typeof lastSeen === 'number' && now - lastSeen < DAY) return 'away';
  return 'offline';
}

export const PRESENCE_LABELS = { active: 'Active now', dnd: 'Do not disturb', away: 'Away', offline: 'Offline' };

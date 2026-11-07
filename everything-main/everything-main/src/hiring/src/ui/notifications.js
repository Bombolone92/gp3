/**
 * Browser notification delivery. Permission-gated, off by default, and
 * deduped per reminder key in localStorage so nothing fires twice even
 * across reloads. Runs only while a tab is open (there is no server).
 */
import { computeReminders, reminderSettings } from '../core/reminders.js';

const NOTIFIED_KEY = 'hiring.notified.v1';
const CHECK_EVERY_MS = 60_000;

/** How many keys of history to keep beyond the ones due right now. */
const KEEP_KEYS = 300;

function loadNotified() {
  try {
    const raw = JSON.parse(localStorage.getItem(NOTIFIED_KEY));
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function saveNotified(keys) {
  try {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(keys));
  } catch {}
}

export function notificationsSupported() {
  return typeof Notification !== 'undefined';
}

/** Ask for permission (must be called from a user gesture). */
export async function requestNotificationPermission() {
  if (!notificationsSupported()) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export function startNotifications(ctx) {
  const check = () => {
    const prefs = reminderSettings(ctx.store.state.settings);
    if (!prefs.browser || !notificationsSupported() || Notification.permission !== 'granted') return;
    const due = computeReminders(ctx.store.state);
    if (due.length === 0) return;
    const notified = loadNotified();
    for (const reminder of due) {
      if (notified.has(reminder.key)) continue;
      notified.add(reminder.key);
      try {
        const notification = new Notification(reminder.title, { body: reminder.body, tag: reminder.key });
        notification.onclick = () => {
          window.focus();
          ctx.navigate(reminder.route);
          notification.close();
        };
      } catch {
        // Some embedded contexts expose Notification but refuse construction.
      }
    }
    // Rebuild the store instead of appending and trimming the tail: every
    // key that is due right now has to survive, because dropping one
    // re-notifies it on the very next tick. With more reminders due than
    // the cap — a fortnight of interviews still missing scorecards, a
    // backlog of overdue follow-ups — a blind tail cut turned "nothing
    // fires twice" into the same banners every minute, forever. Keys that
    // have stopped being due age out ahead of them.
    const dueKeys = due.map((r) => r.key);
    const stillDue = new Set(dueKeys);
    const older = [...notified].filter((key) => !stillDue.has(key));
    saveNotified([...older, ...dueKeys].slice(-Math.max(KEEP_KEYS, dueKeys.length)));
  };
  check();
  const timer = setInterval(check, CHECK_EVERY_MS);
  return () => clearInterval(timer);
}

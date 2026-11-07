import { store } from '../lib/store.js';
import { todayISO, fmtShort } from '../lib/dates.js';
import { collectReminders } from '../lib/reminders.js';
import { agendaDueCount } from '../views/today.js';
import { taskHash } from '../lib/routes.js';
import { toast } from './toast.js';

/**
 * The reminder pass.
 *
 * Three surfaces, in order of how much they ask of the user:
 *
 *  1. the document title, which needs no permission at all and is what a
 *     pinned tab or a Puter desktop window shows;
 *  2. an in-app toast, when the app is on screen and a reminder comes due —
 *     a system notification for something you are already looking at is
 *     noise;
 *  3. a system notification when it is not, and only if permission was
 *     granted from Settings. It is never requested on load.
 *
 * A reminder is stamped with the day it fired, so a reload does not replay
 * it and nothing nags twice.
 */

const BASE_TITLE = typeof document !== 'undefined' ? document.title : '';
const IDLE_DELAY = 1500;

export function notificationSupported() {
  return typeof Notification !== 'undefined';
}

export function notificationState() {
  if (!notificationSupported()) return 'unsupported';
  return Notification.permission;
}

/** Only ever called from a Settings button — never on load. */
export async function requestNotificationPermission() {
  if (!notificationSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

function syncTitle() {
  const count = agendaDueCount();
  document.title = count > 0 ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
}

function markShown(rows) {
  const today = todayISO();
  const byProject = new Map();
  for (const row of rows) {
    if (!byProject.has(row.projectId)) byProject.set(row.projectId, []);
    byProject.get(row.projectId).push(row.task.id);
  }
  for (const [projectId, ids] of byProject) {
    store.markRemindersShown(projectId, ids, today);
  }
}

function notify(rows) {
  const single = rows.length === 1 ? rows[0] : null;
  const title = single
    ? single.task.title
    : `${rows.length} tasks need attention`;
  const body = single
    ? `${single.projectName}, due ${fmtShort(single.task.dueDate)}`
    : rows.slice(0, 3).map((r) => `${r.task.title} (${fmtShort(r.task.dueDate)})`).join('\n');

  try {
    const note = new Notification(title, { body, tag: 'pm-reminders', renotify: false });
    note.onclick = () => {
      window.focus();
      location.hash = single ? taskHash(single.projectId, single.task.id) : '#/today';
      note.close();
    };
  } catch {
    // Some environments throw on construction (iOS Safari, embedded views);
    // the title count and the in-app toast still carry the reminder.
  }
}

function announce(rows) {
  if (!rows.length) return;
  markShown(rows);

  if (document.visibilityState === 'visible') {
    const single = rows.length === 1 ? rows[0] : null;
    toast(single
      ? `${single.task.title}, due ${fmtShort(single.task.dueDate)}`
      : `${rows.length} tasks are due`, {
      icon: 'calendarClock',
      duration: 9000,
      action: {
        label: 'Open',
        onClick: () => {
          location.hash = single ? taskHash(single.projectId, single.task.id) : '#/today';
        },
      },
    });
    return;
  }
  if (notificationState() === 'granted') notify(rows);
}

/**
 * Reminders can only report on documents that are in memory, so the first
 * pass pulls every project in — once per session, off the critical path, the
 * same read the Today view and search already pay for.
 */
export function initReminders() {
  let loaded = false;
  let lastRun = null;

  async function check() {
    if (!loaded) {
      // collectReminders() skips archived projects, so reading them would be
      // a round trip each for nothing.
      await store.loadAllProjects({ archived: false });
      loaded = true;
    }
    const today = todayISO();
    const sources = store.projects
      .map((entry) => ({ entry, doc: store.getDoc(entry.id) }))
      .filter((s) => s.doc);
    announce(collectReminders(sources, today));
    lastRun = today;
    syncTitle();
  }

  const idle = window.requestIdleCallback
    ? (fn) => window.requestIdleCallback(fn, { timeout: IDLE_DELAY })
    : (fn) => setTimeout(fn, IDLE_DELAY);

  idle(() => check().catch((err) => console.error(err)));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    // Coming back is when a reminder is worth raising — and crossing
    // midnight with the tab open is exactly the case a single boot-time
    // pass would miss.
    if (lastRun !== todayISO()) check().catch((err) => console.error(err));
    else syncTitle();
  });

  store.addEventListener('change', (e) => {
    const scope = e.detail?.scope;
    if (scope === 'doc' || scope === 'loaded' || scope === 'projects') syncTitle();
  });

  syncTitle();
  return { check };
}

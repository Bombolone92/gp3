/**
 * Hash routes:
 *   #/                       projects overview
 *   #/today                  cross-project agenda
 *   #/all                    cross-project task list
 *   #/p/<id>                 board
 *   #/p/<id>/t/<taskId>      board with a task sheet open
 *   #/p/<id>/timeline        timeline    (+ ?task=<taskId>)
 *   #/p/<id>/milestones      milestones  (+ ?task=<taskId>)
 *   #/p/<id>/list            list        (+ ?task=<taskId>)
 *   #/settings               settings
 *
 * Parsing stays free of the DOM so it can be unit-tested; the shell is the
 * only place that reads or writes location.
 */

export const PROJECT_TABS = ['board', 'timeline', 'milestones', 'list'];

export function parseRoute(hash) {
  const raw = String(hash ?? '#/').replace(/^#/, '');
  const [path, search = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'today') return { name: 'today' };
  if (parts[0] === 'all') return { name: 'all' };
  if (parts[0] === 'p' && parts[1]) {
    const tab = PROJECT_TABS.includes(parts[2]) ? parts[2] : 'board';
    // The board keeps an open task in the path (the shortest link people
    // paste); the other tabs own their segment, so they carry it as a query.
    const fromPath = parts[2] === 't' && parts[3] ? decode(parts[3]) : null;
    const taskId = fromPath || new URLSearchParams(search).get('task') || null;
    return { name: 'project', id: decode(parts[1]), tab, taskId };
  }
  return { name: 'home' };
}

export function projectHash(id, tab = 'board') {
  return tab && tab !== 'board' ? `#/p/${id}/${tab}` : `#/p/${id}`;
}

export function taskHash(projectId, taskId, tab = 'board') {
  return tab && tab !== 'board'
    ? `#/p/${projectId}/${tab}?task=${encodeURIComponent(taskId)}`
    : `#/p/${projectId}/t/${encodeURIComponent(taskId)}`;
}

/** A malformed escape must not throw the router; fall back to the raw text. */
function decode(part) {
  try { return decodeURIComponent(part); } catch { return part; }
}

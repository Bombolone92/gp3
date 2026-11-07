import { el, clear } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import { columnTasks } from '../lib/board.js';
import { buildAgenda, AGENDA_GROUPS } from '../lib/agenda.js';
import { fmtShort, fmtLong, todayISO } from '../lib/dates.js';
import { priorityBadge, emptyState } from '../ui/bits.js';
import { taskHash } from '../lib/routes.js';
import { toast } from '../ui/toast.js';
import { isRecurring } from '../lib/recurrence.js';
import { menuButton } from '../ui/navdrawer.js';
import { spawnedBy, dropSpawned } from '../ui/history.js';

/**
 * "What should I be doing today?" across every project — the honest,
 * backend-free answer to notifications: an agenda you can act on, with a
 * checkbox that moves a task into its own project's done column.
 */
export function todayView() {
  const list = el('div.agenda');
  const root = el('section.view.today-view', {},
    el('header.view-head', {},
      menuButton(),
      el('a.icon-btn.back-btn', { href: '#/', 'aria-label': 'All projects', html: icon('arrowL', 20, 2) }),
      el('div.grow', {},
        el('h1.view-title', {}, 'Today'),
        el('p.form-hint.today-date', {}, fmtLong(todayISO()))
      )
    ),
    list
  );

  let loading = true;

  function markDone(row) {
    const doc = store.getDoc(row.projectId);
    if (!doc) return;
    const doneCol = doc.columns.find((c) => c.done) ?? doc.columns[doc.columns.length - 1];
    if (!doneCol) return;
    const from = { columnId: row.task.columnId, index: columnTasks(doc.tasks, row.task.columnId)
      .findIndex((t) => t.id === row.task.id) };
    // Finishing a recurring task also starts its successor, so the undo has
    // to take that back out as well as put the task back where it was.
    const { spawned } = spawnedBy(row.projectId, () => store.moveTask(
      row.projectId, row.task.id, doneCol.id, columnTasks(doc.tasks, doneCol.id).length,
    ));
    toast(`Done: ${row.task.title}`, {
      icon: 'taskDone',
      duration: 6000,
      action: {
        label: 'Undo',
        onClick: () => {
          store.moveTask(row.projectId, row.task.id, from.columnId, Math.max(0, from.index));
          dropSpawned(row.projectId, spawned);
        },
      },
    });
  }

  function rowEl(row) {
    const { task } = row;
    const box = el('input.agenda-check', {
      type: 'checkbox',
      'aria-label': `Mark "${task.title}" done`,
      onchange: () => { if (box.checked) markDone(row); },
    });

    return el('div.agenda-row', {},
      box,
      el('a.agenda-main', { href: taskHash(row.projectId, task.id) },
        el('span.agenda-title', {}, task.title || 'Untitled task'),
        el('span.agenda-meta', {},
          el('span.dot', { style: { background: row.projectColor }, 'aria-hidden': 'true' }),
          el('span.agenda-project', {}, row.projectName),
          row.column && el('span.agenda-column', {}, row.column.name)
        )
      ),
      el('span.agenda-badges', {},
        isRecurring(task) && el('span.card-count', {
          html: icon('repeat', 12, 2), title: 'Repeats when done',
        }),
        priorityBadge(task.priority),
        el('span.agenda-due', {}, fmtShort(task.dueDate))
      )
    );
  }

  function render() {
    clear(list);
    if (loading) {
      list.append(el('div.view-loading', { role: 'status', 'aria-label': 'Loading your projects' },
        el('span.spinner')));
      return;
    }

    const sources = store.projects
      .map((entry) => ({ entry, doc: store.getDoc(entry.id) }))
      .filter((s) => s.doc);
    const { groups, counts } = buildAgenda(sources);

    if (!counts.total) {
      list.append(emptyState({
        icon: 'calendarClock',
        title: store.projects.length ? 'Nothing scheduled' : 'No projects yet',
        sub: store.projects.length
          ? 'Give a task a due date and it shows up here, across every project.'
          : 'Create a project and the work you date lands on this page.',
      }));
      return;
    }

    for (const group of AGENDA_GROUPS) {
      const rows = groups[group.key];
      if (!rows.length) continue;
      list.append(el('section.agenda-group', {},
        el('h2.section-title', {},
          el(`span.agenda-dot.${group.tone || 'none'}`, { 'aria-hidden': 'true' }),
          `${group.label} (${rows.length})`),
        el('div.agenda-rows', {}, rows.map(rowEl))
      ));
    }
  }

  render();

  // Every project you have not archived is needed to answer "what is due";
  // they are cached afterwards, so this is a one-time cost per session — and
  // running it again when the set of projects changes costs one read for the
  // project that just appeared (restored from the trash, unarchived, or
  // created in another tab) rather than leaving its dated work off the page.
  function load() {
    store.loadAllProjects({ archived: false })
      .then(() => { loading = false; render(); });
  }
  load();

  const onChange = (e) => {
    if (loading) return;
    if (e.detail?.scope === 'projects') { load(); return; }
    if (e.detail?.scope === 'doc') render();
  };
  store.addEventListener('change', onChange);
  root.destroy = () => store.removeEventListener('change', onChange);

  return root;
}

/**
 * Count for the sidebar badge, from documents already in memory — a badge
 * must never trigger a fan-out of reads, so it fills in as projects load.
 */
export function agendaDueCount() {
  const sources = store.projects
    .map((entry) => ({ entry, doc: store.getDoc(entry.id) }))
    .filter((s) => s.doc);
  return buildAgenda(sources).counts.due;
}

/** Rows a reminder pass cares about: overdue plus due today. */
export function dueSoonRows() {
  const sources = store.projects
    .map((entry) => ({ entry, doc: store.getDoc(entry.id) }))
    .filter((s) => s.doc);
  const { groups } = buildAgenda(sources);
  return [...groups.overdue, ...groups.today];
}

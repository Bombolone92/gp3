import { el, clear } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { store, PRIORITIES } from '../lib/store.js';
import { matchesFilter, isFilterActive } from '../lib/filters.js';
import { LIST_SORTS, sortTasks } from '../lib/list.js';
import { crossContext, groupCrossTasks, localFilter, CROSS_GROUPS } from '../lib/crosslist.js';
import { isRecurring } from '../lib/recurrence.js';
import { todayISO, addDays, fmtShort, fmtLong, dueStatus } from '../lib/dates.js';
import { relativeTime } from '../lib/util.js';
import { openMenu } from '../ui/menu.js';
import { promptDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { openTaskSheet } from '../ui/tasksheet.js';
import { filterBar, filterFor } from '../ui/filterbar.js';
import { viewStateFor } from '../ui/viewstate.js';
import { savedViewsBar } from '../ui/savedviews.js';
import { menuButton } from '../ui/navdrawer.js';
import { offlineNotice } from '../ui/offlinebar.js';
import { avatarStack, labelChip, emptyState } from '../ui/bits.js';

/**
 * All tasks: the list view's questions asked across every project.
 *
 * Today answers "what is due", and only that, by design. This answers the
 * rest — everything tagged #design, every urgent task anywhere, the whole
 * undated backlog — which is otherwise unaskable outside a single board, and
 * invisible everywhere in the app when the work has no date on it.
 *
 * The arranging is not reimplemented: `sortTasks` and `matchesFilter` are
 * reused as they are, and src/lib/crosslist.js supplies the source that spans
 * documents plus the grouping that has to work by name rather than by id.
 *
 * What a cross-project edit *means* is the other half. Due dates, priorities,
 * duplication, archiving and deleting all mean the same thing in any project,
 * so they stay. Moving between columns, or setting a label, assignee, or
 * milestone, are project-scoped — they are offered as disabled, with the
 * reason, rather than quietly missing.
 */

/* The cross-project view has its own filter and its own arrangement, held for
   the session beside the per-project ones. 'all' can never collide with a
   project id (those are generated). */
const SCOPE = 'all';

/* Enough rows to work with; a filter is the way to see a different set. The
   note below the table says when it is holding some back. */
const MAX_ROWS = 500;

/** Board order plus every field-based sort; "column" means nothing here. */
const CROSS_SORTS = LIST_SORTS.filter((s) => s.key !== 'column');

const HEADERS = [
  { label: 'Project', cls: 'col-proj' },
  { label: 'Task', sort: 'title', cls: 'col-task' },
  { label: 'Column', cls: 'col-col' },
  { label: 'Due', sort: 'due', cls: 'col-due' },
  { label: 'Priority', sort: 'priority', cls: 'col-prio' },
  { label: 'Assignees', cls: 'col-people' },
  { label: 'Labels', cls: 'col-labels' },
  { label: 'Milestone', cls: 'col-ms' },
  { label: 'Updated', sort: 'updated', cls: 'col-when' },
];

const plural = (n) => (n === 1 ? 'task' : 'tasks');

/** Why an action that only makes sense inside one project is not offered. */
const PROJECT_SCOPED = {
  column: 'Columns belong to one project, so there is no column to move to across projects',
  label: 'Labels belong to one project, so the same label cannot be set across projects',
  assignee: 'Members belong to one project, so the same person cannot be assigned across projects',
  milestone: 'Milestones belong to one project, so one cannot be set across projects',
};

export function allTasksView() {
  const filter = filterFor(SCOPE);
  const state = viewStateFor(SCOPE);
  const selected = new Set();
  let lastClicked = null;

  /* Documents arrive one at a time, the way home fills in its cards, so the
     table is useful before the slowest project has been read. The source set
     is read from the store on every render rather than kept in step by hand:
     a project opened, renamed, reordered, or archived anywhere else is then
     never something this view can be wrong about. */
  const sources = () => store.projects
    .filter((p) => !p.archived)
    .map((entry) => ({ entry, doc: store.getDoc(entry.id) }))
    .filter((s) => s.doc);

  let pending = 0;
  /* Which projects are being read, and which could not be — by id, so a
     re-run neither double-counts a read already on its way nor keeps adding
     to a failure tally it retries. */
  const reading = new Set();
  const failedIds = new Set();
  let destroyed = false;
  let ctx = crossContext([], todayISO());
  let rows = [];
  let groups = [];
  let capped = 0;

  const table = el('table.list-table', { 'aria-label': 'Tasks in every project' });
  const scroller = el('div.list-scroll', {}, table);
  const bulkBar = el('div.bulk-bar', { role: 'region', 'aria-label': 'Bulk actions' });
  const count = el('span.list-count', { role: 'status', 'aria-live': 'polite' });
  const note = el('p.form-hint.list-note');
  const offline = offlineNotice();

  /* The filter bar wants a document; across projects it gets the union, by
     name, with the number of projects a shared name spans on its label. */
  const facetDoc = () => ({
    labels: ctx.labels.map((l) => ({ id: l.id, name: l.label, color: l.color })),
    members: ctx.members.map((m) => ({ id: m.id, name: m.label, color: m.color })),
  });
  const bar = filterBar({
    projectId: SCOPE, doc: facetDoc, onChange: () => { savedViews.sync(); render(); },
  });
  /* Saved views work here too: the scope is 'all', and the facets it prunes
     against are the unioned names rather than one project's ids. */
  const savedViews = savedViewsBar({
    scope: SCOPE,
    // Null while nothing is loaded yet: pruning a view against an empty union
    // would drop every label it names and call them gone.
    available: () => (ctx.projects.length ? {
      labelIds: ctx.labels.map((l) => l.id),
      assigneeIds: ctx.members.map((m) => m.id),
    } : null),
    onChange: () => { bar.syncFromFilter(); render(); },
  });
  /* The views bar may have just restored the view this scope was last looked
     at through, which rewrites the filter *after* the bar above read it. Pull
     the bar back into line before anyone renders through it, or a restored
     text filter hides cards with an empty search box to explain why. */
  bar.syncFromFilter();

  const groupBtn = el('button.btn.btn-ghost.btn-sm.list-pick', {
    type: 'button',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    onclick: () => openMenu(groupBtn, CROSS_GROUPS.map((g) => ({
      label: g.label,
      checked: () => state.group === g.key,
      onClick: () => { state.group = g.key; render(); },
    }))),
  });

  const sortBtn = el('button.btn.btn-ghost.btn-sm.list-pick', {
    type: 'button',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    onclick: () => openMenu(sortBtn, [
      ...CROSS_SORTS.map((s) => ({
        label: s.key === 'board' ? 'Project order' : s.label,
        checked: () => state.sort.key === s.key,
        onClick: () => {
          state.sort = { key: s.key, dir: s.key === state.sort.key ? state.sort.dir : 'asc' };
          render();
        },
      })),
      'sep',
      {
        label: state.sort.dir === 'desc' ? 'Ascending' : 'Descending',
        icon: state.sort.dir === 'desc' ? 'arrowUp' : 'arrowDown',
        disabled: state.sort.key === 'board',
        onClick: () => {
          state.sort = { ...state.sort, dir: state.sort.dir === 'desc' ? 'asc' : 'desc' };
          render();
        },
      },
    ]),
  });

  const root = el('section.view.list-view.all-view', {},
    el('header.view-head', {},
      menuButton(),
      el('a.icon-btn.back-btn', { href: '#/', 'aria-label': 'All projects', html: icon('arrowL', 20, 2) }),
      el('div.grow', {},
        el('h1.view-title', {}, 'All tasks'),
        el('p.form-hint.today-date', {}, 'Every project, in one list')
      )
    ),
    offline,
    savedViews,
    bar,
    el('div.list-toolbar', {},
      el('span.list-toolbar-label', {}, 'Group'), groupBtn,
      el('span.list-toolbar-label', {}, 'Sort'), sortBtn,
      el('span.grow'),
      count
    ),
    scroller,
    note,
    bulkBar
  );

  // ---- arrangement ---------------------------------------------------------

  function build() {
    ctx = crossContext(sources(), todayISO());
    const matching = [];
    for (const { doc, doneIds } of ctx.projects) {
      // A project with no label of that name contributes nothing, which is
      // not the same as "no label facet is set".
      const local = localFilter(filter, doc);
      if (!local) continue;
      for (const task of doc.tasks) {
        if (matchesFilter(task, local, { doneIds, today: ctx.today })) matching.push(task);
      }
    }
    const sorted = sortTasks(matching, state.sort, ctx);
    capped = Math.max(0, sorted.length - MAX_ROWS);
    const shown = capped ? sorted.slice(0, MAX_ROWS) : sorted;
    groups = groupCrossTasks(shown, state.group, ctx);
    rows = [...new Map(groups.flatMap((g) => g.tasks).map((t) => [t.id, t])).values()];
    const alive = new Set(rows.map((t) => t.id));
    for (const id of [...selected]) if (!alive.has(id)) selected.delete(id);
    return { total: ctx.projects.reduce((n, p) => n + p.doc.tasks.length, 0), matched: sorted.length };
  }

  const selectedTasks = () => rows.filter((t) => selected.has(t.id));

  /** Bulk work is done one project at a time: every store call takes one. */
  function byProject(tasks) {
    const map = new Map();
    for (const task of tasks) {
      const id = ctx.projectEntry(task)?.id;
      if (!id) continue;
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(task);
    }
    return map;
  }

  // ---- selection -----------------------------------------------------------

  function selectRange(fromId, toId) {
    const a = rows.findIndex((t) => t.id === fromId);
    const b = rows.findIndex((t) => t.id === toId);
    if (a < 0 || b < 0) return;
    for (const t of rows.slice(Math.min(a, b), Math.max(a, b) + 1)) selected.add(t.id);
  }

  function onRowCheck(task, e) {
    if (e.shiftKey && lastClicked && lastClicked !== task.id) selectRange(lastClicked, task.id);
    else if (e.currentTarget.checked) selected.add(task.id);
    else selected.delete(task.id);
    lastClicked = task.id;
    syncSelection();
  }

  function syncSelection() {
    for (const tr of table.querySelectorAll('tr[data-task-id]')) {
      const on = selected.has(tr.dataset.taskId);
      tr.classList.toggle('is-selected', on);
      const box = tr.querySelector('.list-check');
      if (box) box.checked = on;
    }
    const all = table.querySelector('.list-check-all');
    if (all) syncSelectAll(all);
    renderBulkBar();
  }

  // ---- cells ---------------------------------------------------------------

  function focusKey() {
    const cell = document.activeElement?.closest?.('[data-cell]');
    const row = document.activeElement?.closest?.('tr[data-task-id]');
    return cell && row ? `${row.dataset.taskId}:${cell.dataset.cell}` : null;
  }

  function restoreFocus(key) {
    if (!key) return;
    const [taskId, cell] = key.split(':');
    table.querySelector(`tr[data-task-id="${CSS.escape(taskId)}"] [data-cell="${cell}"]`)?.focus();
  }

  /** Reads as a date, edits as a date input — the list view's own bargain. */
  function dueCell(task, projectId, isDone) {
    const cell = el('span.list-duecell');
    const status = dueStatus(task.dueDate, isDone);
    const tone = status === 'overdue' ? ' overdue'
      : status === 'today' || status === 'soon' ? ' soon' : '';

    function showButton({ focus = false } = {}) {
      const btn = el('button.list-cell-btn', {
        type: 'button',
        dataset: { cell: 'due' },
        className: `list-cell-btn${tone}${task.dueDate ? '' : ' empty'}`,
        'aria-label': task.dueDate
          ? `Due ${fmtLong(task.dueDate)}. Change the due date`
          : `Set a due date for ${task.title}`,
        onclick: showInput,
      }, task.dueDate ? fmtShort(task.dueDate) : '—');
      cell.replaceChildren(btn);
      if (focus) btn.focus();
    }

    function showInput() {
      const input = el('input.list-inline.list-due', {
        type: 'date',
        value: task.dueDate || '',
        'aria-label': `Due date for ${task.title}`,
        dataset: { cell: 'due' },
        onchange: () => store.updateTask(projectId, task.id, { dueDate: input.value || null }),
        onblur: () => { if (input.isConnected) showButton(); },
        onkeydown: (e) => {
          if (e.key === 'Escape') { e.stopPropagation(); showButton({ focus: true }); }
        },
      });
      cell.replaceChildren(input);
      input.focus();
      try { input.showPicker?.(); } catch { /* not allowed here: typing works */ }
    }

    showButton();
    return cell;
  }

  function priorityCell(task, projectId) {
    return el('select.list-inline', {
      'aria-label': `Priority for ${task.title}`,
      dataset: { cell: 'priority' },
      className: `list-inline${task.priority ? ` list-prio-${task.priority}` : ''}`,
      onchange: (e) => store.updateTask(projectId, task.id, { priority: e.target.value || null }),
    },
      el('option', { value: '', selected: !task.priority }, '—'),
      PRIORITIES.map((p) => el('option', {
        value: p.value, selected: p.value === task.priority,
      }, p.label))
    );
  }

  function rowEl(task) {
    const source = ctx.projectOf(task);
    if (!source) return null;
    const { entry, doc } = source;
    const isDone = source.doneIds.has(task.columnId);
    const column = doc.columns.find((c) => c.id === task.columnId);
    const labels = (task.labelIds ?? []).map((id) => doc.labels.find((l) => l.id === id)).filter(Boolean);
    const people = (task.assigneeIds ?? []).map((id) => doc.members.find((m) => m.id === id)).filter(Boolean);
    const milestone = task.milestoneId ? doc.milestones.find((m) => m.id === task.milestoneId) : null;
    const dash = () => el('span.list-dash', { 'aria-hidden': 'true' }, '—');

    return el('tr', {
      dataset: { taskId: task.id },
      className: selected.has(task.id) ? 'is-selected' : '',
    },
      el('td.col-pick', {},
        el('input.list-check', {
          type: 'checkbox',
          checked: selected.has(task.id),
          'aria-label': `Select ${task.title}`,
          onclick: (e) => onRowCheck(task, e),
        })
      ),
      el('td.col-proj', {},
        el('a.list-project', { href: `#/p/${entry.id}`, title: `Open ${entry.name}` },
          el('span.dot', { style: { background: entry.color }, 'aria-hidden': 'true' }),
          el('span.list-project-name', {}, entry.name)
        )
      ),
      el('td.col-task', {},
        el('button.list-title', {
          type: 'button',
          dataset: { cell: 'title' },
          className: `list-title${isDone ? ' done' : ''}`,
          onclick: () => openTaskSheet(entry.id, task.id),
        }, task.title || 'Untitled task'),
        isRecurring(task) && el('span.list-flag', {
          html: icon('repeat', 12, 2), title: 'Repeats when done', role: 'img',
          'aria-label': 'Repeats when done',
        })
      ),
      // Read-only across projects: a column belongs to one board.
      el('td.col-col', {}, column
        ? el('span.list-colname', { className: `list-colname${isDone ? ' done' : ''}` }, column.name)
        : dash()),
      el('td.col-due', {}, dueCell(task, entry.id, isDone)),
      el('td.col-prio', {}, priorityCell(task, entry.id)),
      el('td.col-people', {}, people.length ? avatarStack(people, { size: 22, max: 3 }) : dash()),
      el('td.col-labels', {}, labels.length
        ? el('span.list-labels', {}, labels.map((l) => labelChip(l)))
        : dash()),
      el('td.col-ms', {}, milestone
        ? el('span.list-ms', { title: `${milestone.name}: ${fmtLong(milestone.date)}` },
          el('span.list-ms-ic', { html: icon('flag', 12, 2), 'aria-hidden': 'true' }),
          milestone.name)
        : dash()),
      el('td.col-when', {
        title: new Date(task.updatedAt ?? task.createdAt ?? Date.now()).toLocaleString(),
      }, relativeTime(task.updatedAt ?? task.createdAt ?? Date.now()))
    );
  }

  // ---- header --------------------------------------------------------------

  function sortHeader(h) {
    if (!h.sort) return el(`th.${h.cls}`, { scope: 'col' }, h.label);
    const active = state.sort.key === h.sort;
    const dir = active ? state.sort.dir : null;
    return el(`th.${h.cls}`, {
      scope: 'col',
      'aria-sort': active ? (dir === 'desc' ? 'descending' : 'ascending') : 'none',
    },
      el('button.list-sort', {
        type: 'button',
        className: `list-sort${active ? ' active' : ''}`,
        title: active
          ? (dir === 'asc' ? 'Sort descending' : 'Back to project order')
          : `Sort by ${h.label.toLowerCase()}`,
        onclick: () => {
          state.sort = !active ? { key: h.sort, dir: 'asc' }
            : dir === 'asc' ? { key: h.sort, dir: 'desc' }
            : { key: 'board', dir: 'asc' };
          render();
        },
      },
        el('span', {}, h.label),
        active && el('span.list-sort-ic', {
          html: icon(dir === 'desc' ? 'arrowDown' : 'arrowUp', 12, 2.6),
          'aria-hidden': 'true',
        })
      )
    );
  }

  /** True when every row on screen is selected — the header box's own state. */
  function everythingSelected() {
    return rows.length > 0 && selected.size === rows.length;
  }

  /**
   * The header checkbox says what it will do next, so its label has to move
   * with the selection rather than being fixed when the table was built.
   */
  function syncSelectAll(box) {
    const all = everythingSelected();
    box.checked = all;
    box.indeterminate = selected.size > 0 && !all;
    box.setAttribute('aria-label', all ? 'Clear selection' : 'Select every task shown');
  }

  function headEl() {
    const box = el('input.list-check.list-check-all', {
      type: 'checkbox',
      // Read the selection at click time, not at build time: syncSelection()
      // keeps this box in step without rebuilding the table, so a captured
      // "everything is selected" would still say false on the second click
      // and the box could never be used to clear what it had just selected.
      onclick: () => {
        if (everythingSelected()) selected.clear();
        else for (const t of rows) selected.add(t.id);
        lastClicked = null;
        syncSelection();
      },
    });
    syncSelectAll(box);
    return el('thead', {}, el('tr', {},
      el('th.col-pick', { scope: 'col' }, box),
      HEADERS.map(sortHeader)
    ));
  }

  // ---- bulk actions --------------------------------------------------------

  function done(message, undo) {
    toast(message, {
      icon: 'listTodo',
      duration: 7000,
      action: undo ? { label: 'Undo', onClick: undo } : null,
    });
  }

  const snapshot = (tasks, keys) => tasks.map((t) =>
    Object.fromEntries([['id', t.id], ...keys.map((k) => [k, t[k] ?? null])]));

  /** One mutation per project, one undo that walks the same grouping back. */
  function bulkEdit({ patch, keys, label }) {
    const tasks = selectedTasks();
    if (!tasks.length) return;
    const groupsByProject = byProject(tasks);
    const before = new Map();
    for (const [projectId, list] of groupsByProject) {
      before.set(projectId, snapshot(list, keys));
      store.bulkUpdateTasks(projectId, list.map((t) => t.id), patch);
    }
    done(`${tasks.length} ${plural(tasks.length)} ${label}`, () => {
      for (const [projectId, patches] of before) store.bulkPatchTasks(projectId, patches);
    });
  }

  function dueMenu(anchor) {
    const today = todayISO();
    const set = (iso) => bulkEdit({
      patch: { dueDate: iso },
      keys: ['dueDate'],
      label: iso ? `due ${fmtShort(iso)}` : 'left without a due date',
    });
    openMenu(anchor, [
      { label: 'Today', onClick: () => set(today) },
      { label: 'Tomorrow', onClick: () => set(addDays(today, 1)) },
      { label: 'In a week', onClick: () => set(addDays(today, 7)) },
      {
        label: 'Pick a date…',
        onClick: async () => {
          const value = await promptDialog({
            title: `Due date for ${selected.size} ${plural(selected.size)}`,
            label: 'Due date',
            type: 'date',
            confirmLabel: 'Set due date',
          });
          if (value) set(value);
        },
      },
      'sep',
      { label: 'Clear due date', onClick: () => set(null) },
    ]);
  }

  function renderBulkBar() {
    clear(bulkBar);
    bulkBar.hidden = selected.size === 0;
    document.body.classList.toggle('bulk-open', selected.size > 0);
    if (!selected.size) return;

    const action = (label, iconName, onClick, disabledReason = null) =>
      el('button.btn.btn-ghost.btn-sm', {
        type: 'button',
        disabled: !!disabledReason,
        // Disabled with the reason attached, as the filter facets do: a
        // missing button teaches nothing.
        title: disabledReason,
        'aria-haspopup': disabledReason ? null : 'menu',
        'aria-expanded': disabledReason ? null : 'false',
        html: icon(iconName, 14, 2),
        onclick: onClick,
      }, ` ${label}`);

    const dueBtn = action('Due', 'calendar', () => dueMenu(dueBtn));

    const prioBtn = action('Priority', 'medium', () => openMenu(prioBtn, [
      ...PRIORITIES.map((p) => ({
        label: p.label,
        prefix: el('span.filter-prio', { html: icon(p.value, 13, 2.2), 'aria-hidden': 'true' }),
        onClick: () => bulkEdit({
          patch: { priority: p.value }, keys: ['priority'], label: `set to ${p.label}`,
        }),
      })),
      'sep',
      {
        label: 'No priority',
        onClick: () => bulkEdit({
          patch: { priority: null }, keys: ['priority'], label: 'left without a priority',
        }),
      },
    ]));

    const moreBtn = action('More', 'more', () => openMenu(moreBtn, [
      {
        label: 'Duplicate',
        icon: 'copy',
        onClick: () => {
          const copies = new Map();
          let total = 0;
          for (const [projectId, list] of byProject(selectedTasks())) {
            const made = list.map((t) => store.duplicateTask(projectId, t.id)).filter(Boolean);
            copies.set(projectId, made.map((c) => c.id));
            total += made.length;
          }
          selected.clear();
          for (const ids of copies.values()) for (const id of ids) selected.add(id);
          render();
          done(`${total} ${plural(total)} duplicated`, () => {
            // A copy that never existed does not belong in the trash.
            for (const [projectId, ids] of copies) {
              store.bulkDeleteTasks(projectId, ids);
              store.bulkPurgeTasks(projectId, ids);
            }
          });
        },
      },
      {
        label: 'Archive',
        icon: 'archive',
        onClick: () => {
          const archived = new Map();
          let total = 0;
          for (const [projectId, list] of byProject(selectedTasks())) {
            const ids = store.bulkArchiveTasks(projectId, list.map((t) => t.id));
            archived.set(projectId, ids);
            total += ids.length;
          }
          selected.clear();
          done(`${total} ${plural(total)} archived`, () => {
            for (const [projectId, ids] of archived) {
              store.bulkRestoreTasks(projectId, ids, 'archive');
            }
          });
        },
      },
      'sep',
      {
        label: 'Delete',
        icon: 'trash',
        danger: true,
        onClick: () => {
          const deleted = new Map();
          let total = 0;
          for (const [projectId, list] of byProject(selectedTasks())) {
            const ids = store.bulkDeleteTasks(projectId, list.map((t) => t.id));
            deleted.set(projectId, ids);
            total += ids.length;
          }
          selected.clear();
          done(`${total} ${plural(total)} moved to trash`, () => {
            for (const [projectId, ids] of deleted) {
              store.bulkRestoreTasks(projectId, ids, 'trash');
            }
          });
        },
      },
    ]));

    bulkBar.append(
      el('span.bulk-count', {}, `${selected.size} selected`),
      el('div.bulk-actions', {},
        dueBtn,
        prioBtn,
        action('Move to', 'board', null, PROJECT_SCOPED.column),
        action('Labels', 'tag', null, PROJECT_SCOPED.label),
        action('Assign', 'users', null, PROJECT_SCOPED.assignee),
        moreBtn
      ),
      el('button.btn.btn-ghost.btn-sm.bulk-clear', {
        type: 'button',
        onclick: () => { selected.clear(); lastClicked = null; syncSelection(); },
      }, 'Clear')
    );
  }

  // ---- render --------------------------------------------------------------

  function groupHead(group) {
    return el('tr.list-group-row', {},
      el('th.list-group-head', { colSpan: HEADERS.length + 1, scope: 'colgroup' },
        group.tone !== undefined
          && el(`span.agenda-dot.${group.tone || 'none'}`, { 'aria-hidden': 'true' }),
        group.entry && el('span.dot', {
          style: { background: group.entry.color }, 'aria-hidden': 'true',
        }),
        el('span.list-group-name', {}, group.label),
        // A column name shared by several boards says so, so nobody reads one
        // group as one project's column.
        group.projects?.length > 1 && el('span.list-group-scope', {},
          `${group.projects.length} projects`),
        el('span.list-group-count', {}, String(group.tasks.length))
      )
    );
  }

  function render() {
    const focused = focusKey();
    const scrollTop = scroller.scrollTop;
    const { total, matched } = build();

    groupBtn.textContent = CROSS_GROUPS.find((g) => g.key === state.group).label;
    const sortLabel = state.sort.key === 'board'
      ? 'Project order'
      : CROSS_SORTS.find((s) => s.key === state.sort.key)?.label ?? 'Project order';
    sortBtn.textContent = state.sort.key === 'board'
      ? sortLabel
      : `${sortLabel} ${state.sort.dir === 'desc' ? '↓' : '↑'}`;

    clear(table);
    if (!rows.length) {
      table.append(el('tbody', {}, el('tr', {}, el('td', { colSpan: HEADERS.length + 1 },
        pending ? el('div.view-loading', { role: 'status', 'aria-label': 'Loading your projects' },
          el('span.spinner'))
          : isFilterActive(filter)
            ? emptyState({
              icon: 'search',
              title: 'No tasks match the filter',
              sub: 'Clear a facet above, or widen the search.',
              action: el('button.btn.btn-ghost.btn-sm', { onclick: () => bar.reset() }, 'Clear filters'),
            })
            : emptyState({
              icon: 'listTodo',
              title: store.projects.length ? 'No tasks yet' : 'No projects yet',
              sub: store.projects.length
                ? 'Add tasks on any board and every one of them shows up here.'
                : 'Create a project and its work lands in this list.',
            })
      ))));
    } else {
      table.append(headEl());
      for (const group of groups) {
        const body = el('tbody.list-group');
        if (state.group !== 'none') body.append(groupHead(group));
        for (const task of group.tasks) body.append(rowEl(task));
        table.append(body);
      }
    }

    count.textContent = pending
      ? `${rows.length} of ${total} ${plural(total)} · loading ${pending} more`
      : matched === total
        ? `${total} ${plural(total)} in ${ctx.projects.length} project${ctx.projects.length === 1 ? '' : 's'}`
        : `${matched} of ${total} ${plural(total)}`;

    // Nothing is dropped quietly: a cap and a failed read both say so.
    const notes = [];
    if (capped) {
      notes.push(`Showing the first ${MAX_ROWS} of ${matched} matching tasks. `
        + 'Narrow the filter to see the rest.');
    }
    if (failedIds.size) {
      const one = failedIds.size === 1;
      notes.push(`${failedIds.size} project${one ? '' : 's'} could not be read, so `
        + `${one ? 'its' : 'their'} tasks are missing from this list.`);
    }
    note.textContent = notes.join(' ');
    note.hidden = !notes.length;

    renderBulkBar();
    scroller.scrollTop = scrollTop;
    restoreFocus(focused);
    bar.update({ shown: matched, total });
  }

  // ---- loading -------------------------------------------------------------

  /* Archived projects are left out: that is what archiving is for. The rest
     load in parallel and land as they arrive, so a slow project never blocks
     the ones already read — including the ones the mirror answers offline.
     Run again whenever the set of projects changes: one restored from the
     trash, unarchived, or created in another tab has to be read, or its tasks
     are quietly missing from a list that claims to hold every one of them. */
  function load() {
    const missing = store.projects.filter((p) =>
      !p.archived && !store.getDoc(p.id) && !reading.has(p.id));
    for (const entry of missing) reading.add(entry.id);
    pending = reading.size;
    for (const entry of missing) {
      store.loadProject(entry.id).then(() => {
        failedIds.delete(entry.id);
      }).catch((err) => {
        console.error(err);
        failedIds.add(entry.id);
      }).finally(() => {
        reading.delete(entry.id);
        pending = reading.size;
        if (!destroyed) render();
      });
    }
    render();
  }

  const onChange = (e) => {
    const scope = e.detail?.scope;
    // A project appearing or coming back out of the archive is one this view
    // has never read.
    if (scope === 'projects') { load(); return; }
    // 'loaded' is a project arriving in memory, which this view is made of.
    if (scope === 'doc' || scope === 'loaded') render();
  };
  store.addEventListener('change', onChange);

  root.destroy = () => {
    destroyed = true;
    store.removeEventListener('change', onChange);
    savedViews.destroy();
    offline.destroy();
    document.body.classList.remove('bulk-open');
  };

  load();
  return root;
}

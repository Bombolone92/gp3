import { el, clear } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { store, PRIORITIES } from '../lib/store.js';
import { columnTasks } from '../lib/board.js';
import { matchesFilter, isFilterActive } from '../lib/filters.js';
import { isRecurring } from '../lib/recurrence.js';
import { LIST_GROUPS, LIST_SORTS, listContext, sortTasks, groupTasks } from '../lib/list.js';
import { todayISO, addDays, fmtShort, fmtLong, dueStatus } from '../lib/dates.js';
import { relativeTime } from '../lib/util.js';
import { openMenu } from '../ui/menu.js';
import { promptDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { openTaskSheet } from '../ui/tasksheet.js';
import { filterBar, filterFor } from '../ui/filterbar.js';
import { viewStateFor } from '../ui/viewstate.js';
import { savedViewsBar } from '../ui/savedviews.js';
import { record, spawnedBy, dropSpawned } from '../ui/history.js';
import { avatar, avatarStack, labelChip, emptyState } from '../ui/bits.js';

/**
 * The list view: one dense row per task, arranged however the question of
 * the moment needs, with multi-select for the bulk work a board is a poor
 * tool for.
 *
 * Sort and group live in ui/viewstate.js, per project for the session like the
 * filter is — and are never written into a task's `order`, so the board's
 * manual arrangement survives whatever the list is showing. A saved view is
 * that state, named.
 */

/** Table columns, in render order; `sort` marks the ones with a sort header. */
const HEADERS = [
  { label: 'Task', sort: 'title', cls: 'col-task' },
  { label: 'Column', sort: 'column', cls: 'col-col' },
  { label: 'Due', sort: 'due', cls: 'col-due' },
  { label: 'Priority', sort: 'priority', cls: 'col-prio' },
  { label: 'Assignees', cls: 'col-people' },
  { label: 'Labels', cls: 'col-labels' },
  { label: 'Milestone', cls: 'col-ms' },
  { label: 'Updated', sort: 'updated', cls: 'col-when' },
];

const plural = (n) => (n === 1 ? 'task' : 'tasks');

/** The fields a bulk edit is about to overwrite, so Undo can put them back. */
const snapshot = (tasks, keys) => tasks.map((t) =>
  Object.fromEntries([['id', t.id], ...keys.map((k) => [k, t[k] ?? null])]));

export function listView({ projectId }) {
  const state = viewStateFor(projectId);
  const filter = filterFor(projectId);
  const selected = new Set();
  let lastClicked = null; // anchor for shift-click range selection

  const doc = () => store.getDoc(projectId);

  const bar = filterBar({ projectId, doc, onChange: () => { views.sync(); render(); } });
  const views = savedViewsBar({
    scope: projectId,
    available: () => ({
      labelIds: (doc()?.labels ?? []).map((l) => l.id),
      assigneeIds: (doc()?.members ?? []).map((m) => m.id),
    }),
    onChange: () => { bar.syncFromFilter(); render(); },
  });
  /* The views bar may have just restored the view this scope was last looked
     at through, which rewrites the filter *after* the bar above read it. Pull
     the bar back into line before anyone renders through it, or a restored
     text filter hides cards with an empty search box to explain why. */
  bar.syncFromFilter();
  const table = el('table.list-table', { 'aria-label': 'Tasks' });
  const scroller = el('div.list-scroll', {}, table);
  const bulkBar = el('div.bulk-bar', { role: 'region', 'aria-label': 'Bulk actions' });

  const groupBtn = el('button.btn.btn-ghost.btn-sm.list-pick', {
    type: 'button',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    onclick: () => openMenu(groupBtn, LIST_GROUPS.map((g) => ({
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
      ...LIST_SORTS.map((s) => ({
        label: s.label,
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

  const count = el('span.list-count');

  const root = el('div.list-wrap', {},
    views,
    bar,
    el('div.list-toolbar', {},
      el('span.list-toolbar-label', {}, 'Group'), groupBtn,
      el('span.list-toolbar-label', {}, 'Sort'), sortBtn,
      el('span.grow'),
      count
    ),
    scroller,
    bulkBar
  );

  // ---- arrangement ---------------------------------------------------------

  let rows = [];    // every visible task, flat, in render order
  let groups = [];

  function build() {
    const d = doc();
    const ctx = listContext(d, todayISO());
    const visible = d.tasks.filter((t) => matchesFilter(t, filter, {
      doneIds: ctx.doneIds, today: ctx.today,
    }));
    groups = groupTasks(sortTasks(visible, state.sort, ctx), state.group, ctx);
    // Grouping by assignee lists a shared task under each of its people, so
    // the flat row list is deduped before anything counts or selects it.
    rows = [...new Map(groups.flatMap((g) => g.tasks).map((t) => [t.id, t])).values()];
    // A task deleted elsewhere, or filtered away, can no longer be acted on.
    const alive = new Set(rows.map((t) => t.id));
    for (const id of [...selected]) if (!alive.has(id)) selected.delete(id);
    return { d, ctx };
  }

  const selectedTasks = () => rows.filter((t) => selected.has(t.id));
  const ids = () => selectedTasks().map((t) => t.id);

  // ---- selection -----------------------------------------------------------

  function selectRange(fromId, toId) {
    const a = rows.findIndex((t) => t.id === fromId);
    const b = rows.findIndex((t) => t.id === toId);
    if (a < 0 || b < 0) return;
    for (const t of rows.slice(Math.min(a, b), Math.max(a, b) + 1)) selected.add(t.id);
  }

  function onRowCheck(task, e) {
    // Shift extends from the last row ticked, the one thing that makes
    // selecting thirty rows bearable.
    if (e.shiftKey && lastClicked && lastClicked !== task.id) selectRange(lastClicked, task.id);
    else if (e.currentTarget.checked) selected.add(task.id);
    else selected.delete(task.id);
    lastClicked = task.id;
    syncSelection();
  }

  /**
   * Selection changes touch the checkboxes and the action bar only:
   * rebuilding a hundred rows to tick one box would lose the scroll position
   * and feel like a page load.
   */
  function syncSelection() {
    for (const tr of table.querySelectorAll('tr[data-task-id]')) {
      const on = selected.has(tr.dataset.taskId);
      tr.classList.toggle('is-selected', on);
      const box = tr.querySelector('.list-check');
      if (box) box.checked = on;
    }
    const all = table.querySelector('.list-check-all');
    if (all) syncSelectAll(all);
    renderBulkBar(doc());
  }

  // ---- inline cell editors -------------------------------------------------

  /** Which cell held focus, so a re-render can hand it back. */
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

  function columnCell(task, d) {
    const sel = el('select.list-inline', {
      'aria-label': `Column for ${task.title}`,
      dataset: { cell: 'column' },
      onchange: () => {
        const from = {
          columnId: task.columnId,
          index: columnTasks(d.tasks, task.columnId).findIndex((t) => t.id === task.id),
        };
        const to = sel.value;
        const toName = d.columns.find((c) => c.id === to)?.name ?? 'another column';
        // moveTask rather than a field write: reaching a done column is what
        // completes a task, recurrence and all.
        store.moveTask(projectId, task.id, to, columnTasks(d.tasks, to).length);
        record(projectId, {
          label: `move of “${task.title}” to ${toName}`,
          undo: () => store.moveTask(projectId, task.id, from.columnId, Math.max(0, from.index)),
          redo: () => store.moveTask(projectId, task.id, to, columnTasks(doc().tasks, to).length),
        });
      },
    }, d.columns.map((c) => el('option', {
      value: c.id, selected: c.id === task.columnId,
    }, c.name)));
    return sel;
  }

  /**
   * The due cell reads as a date and edits as a date input. A native date
   * field per row would fill the column with "yyyy-mm-dd" placeholders and
   * ISO text, which is the opposite of scannable — so the input only appears
   * once the cell is actually being edited.
   */
  function dueCell(task, isDone) {
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
        onchange: () => {
          const before = task.dueDate ?? null;
          const next = input.value || null;
          if (next === before) return;
          store.updateTask(projectId, task.id, { dueDate: next });
          record(projectId, {
            label: `due date of “${task.title}”`,
            undo: () => store.updateTask(projectId, task.id, { dueDate: before }),
            redo: () => store.updateTask(projectId, task.id, { dueDate: next }),
          });
        },
        onblur: () => { if (input.isConnected) showButton(); },
        onkeydown: (e) => {
          if (e.key === 'Escape') { e.stopPropagation(); showButton({ focus: true }); }
        },
      });
      cell.replaceChildren(input);
      input.focus();
      // The click that opened the cell is the gesture the picker needs.
      try { input.showPicker?.(); } catch { /* not allowed here: typing works */ }
    }

    showButton();
    return cell;
  }

  function priorityCell(task) {
    return el('select.list-inline', {
      'aria-label': `Priority for ${task.title}`,
      dataset: { cell: 'priority' },
      className: `list-inline${task.priority ? ` list-prio-${task.priority}` : ''}`,
      onchange: (e) => {
        const before = task.priority ?? null;
        const next = e.target.value || null;
        store.updateTask(projectId, task.id, { priority: next });
        record(projectId, {
          label: `priority of “${task.title}”`,
          undo: () => store.updateTask(projectId, task.id, { priority: before }),
          redo: () => store.updateTask(projectId, task.id, { priority: next }),
        });
      },
    },
      el('option', { value: '', selected: !task.priority }, '—'),
      PRIORITIES.map((p) => el('option', {
        value: p.value, selected: p.value === task.priority,
      }, p.label))
    );
  }

  // ---- rows ----------------------------------------------------------------

  function rowEl(task, d, ctx) {
    const isDone = ctx.doneIds.has(task.columnId);
    const labels = (task.labelIds ?? []).map((id) => d.labels.find((l) => l.id === id)).filter(Boolean);
    const people = (task.assigneeIds ?? []).map((id) => d.members.find((m) => m.id === id)).filter(Boolean);
    const milestone = task.milestoneId ? d.milestones.find((m) => m.id === task.milestoneId) : null;
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
      el('td.col-task', {},
        el('button.list-title', {
          type: 'button',
          dataset: { cell: 'title' },
          className: `list-title${isDone ? ' done' : ''}`,
          onclick: () => openTaskSheet(projectId, task.id),
        }, task.title || 'Untitled task'),
        isRecurring(task) && el('span.list-flag', {
          html: icon('repeat', 12, 2), title: 'Repeats when done', role: 'img',
          'aria-label': 'Repeats when done',
        })
      ),
      el('td.col-col', {}, columnCell(task, d)),
      el('td.col-due', {}, dueCell(task, isDone)),
      el('td.col-prio', {}, priorityCell(task)),
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
        // A third click returns to board order, so the manual arrangement is
        // always one click away instead of a trip through the menu.
        title: active
          ? (dir === 'asc' ? 'Sort descending' : 'Back to board order')
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

  /** Every bulk edit is reversible: it says what it did and offers it back. */
  function bulkEdit({ patch, keys, label }) {
    const tasks = selectedTasks();
    if (!tasks.length) return;
    const ids = tasks.map((t) => t.id);
    const before = snapshot(tasks, keys);
    store.bulkUpdateTasks(projectId, ids, patch);
    // One gesture, one entry — the same one the toast implies.
    record(projectId, {
      label: `${tasks.length} ${plural(tasks.length)} ${label}`,
      undo: () => store.bulkPatchTasks(projectId, before),
      redo: () => store.bulkUpdateTasks(projectId, ids, patch),
    });
    done(`${tasks.length} ${plural(tasks.length)} ${label}`,
      () => store.bulkPatchTasks(projectId, before));
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

  /** Labels and assignees share one rule: on when every selected task has it. */
  function refMenu(anchor, { items, field, empty, prefix }) {
    if (!items.length) {
      openMenu(anchor, [{ label: empty, disabled: true }]);
      return;
    }
    openMenu(anchor, items.map((item) => ({
      label: item.name,
      prefix: prefix(item),
      keepOpen: true,
      checked: () => {
        const tasks = selectedTasks();
        return tasks.length > 0 && tasks.every((t) => (t[field] ?? []).includes(item.id));
      },
      onClick: () => {
        const tasks = selectedTasks();
        const on = !tasks.every((t) => (t[field] ?? []).includes(item.id));
        const targets = tasks.map((t) => t.id);
        const touched = store.bulkToggleTaskRef(projectId, targets, field, item.id, on);
        if (!touched.length) return;
        done(`${item.name} ${on ? 'added to' : 'removed from'} ${touched.length} ${plural(touched.length)}`,
          () => store.bulkToggleTaskRef(projectId, touched, field, item.id, !on));
      },
    })));
  }

  function moveTo(column) {
    const tasks = selectedTasks();
    const before = snapshot(tasks, ['columnId', 'order']);
    /* Moving into a done column completes the tasks, and every recurring one
       among them starts its successor. That makes the gesture two changes and
       one action, so the inverse has to take the successors back out as well
       as put the cards back — otherwise undoing it leaves copies behind. */
    const complete = () => spawnedBy(projectId,
      () => store.bulkMoveTasks(projectId, tasks.map((t) => t.id), column.id));
    const first = complete();
    const moved = first.result;
    let spawned = first.spawned;
    const revert = () => {
      store.bulkPatchTasks(projectId, before);
      dropSpawned(projectId, spawned);
    };
    record(projectId, {
      label: `move of ${moved.length} ${plural(moved.length)} to ${column.name}`,
      undo: revert,
      // Replaying it spawns fresh successors, so the entry has to learn them.
      redo: () => { spawned = complete().spawned; },
    });
    done(`${moved.length} ${plural(moved.length)} moved to ${column.name}`, revert);
  }

  function renderBulkBar(d) {
    clear(bulkBar);
    bulkBar.hidden = selected.size === 0;
    // Toasts sit where the bar sits; the flag lifts them clear of it.
    document.body.classList.toggle('bulk-open', selected.size > 0);
    if (!selected.size || !d) return;

    const action = (label, iconName, onClick) => el('button.btn.btn-ghost.btn-sm', {
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      html: icon(iconName, 14, 2),
      onclick: onClick,
    }, ` ${label}`);

    const columnBtn = action('Move to', 'board', () => openMenu(columnBtn,
      d.columns.map((c) => ({ label: c.name, onClick: () => moveTo(c) }))));

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

    const labelBtn = action('Labels', 'tag', () => refMenu(labelBtn, {
      items: d.labels,
      field: 'labelIds',
      empty: 'No labels in this project yet',
      prefix: (l) => el('span.dot', { style: { background: l.color }, 'aria-hidden': 'true' }),
    }));

    const peopleBtn = action('Assign', 'users', () => refMenu(peopleBtn, {
      items: d.members,
      field: 'assigneeIds',
      empty: 'No members in this project yet',
      prefix: (m) => avatar(m, 18),
    }));

    const moreBtn = action('More', 'more', () => openMenu(moreBtn, [
      {
        label: 'Set milestone…',
        icon: 'flag',
        disabled: !d.milestones.length,
        onClick: () => openMenu(moreBtn, [
          ...[...d.milestones]
            .sort((a, b) => String(a.date).localeCompare(String(b.date)))
            .map((m) => ({
              label: `${m.name} (${fmtShort(m.date)})`,
              onClick: () => bulkEdit({
                patch: { milestoneId: m.id }, keys: ['milestoneId'], label: `added to ${m.name}`,
              }),
            })),
          'sep',
          {
            label: 'No milestone',
            onClick: () => bulkEdit({
              patch: { milestoneId: null }, keys: ['milestoneId'], label: 'left without a milestone',
            }),
          },
        ]),
      },
      {
        label: 'Duplicate',
        icon: 'copy',
        onClick: () => {
          const copies = ids().map((id) => store.duplicateTask(projectId, id)).filter(Boolean);
          const copyIds = copies.map((c) => c.id);
          selected.clear();
          for (const id of copyIds) selected.add(id);
          render();
          done(`${copies.length} ${plural(copies.length)} duplicated`, () => {
            // A copy that never existed does not belong in the trash.
            store.bulkDeleteTasks(projectId, copyIds);
            store.bulkPurgeTasks(projectId, copyIds);
          });
        },
      },
      {
        label: 'Archive',
        icon: 'archive',
        onClick: () => {
          const archived = store.bulkArchiveTasks(projectId, ids());
          selected.clear();
          done(`${archived.length} ${plural(archived.length)} archived`,
            () => store.bulkRestoreTasks(projectId, archived, 'archive'));
        },
      },
      'sep',
      {
        label: 'Delete',
        icon: 'trash',
        danger: true,
        // No confirm, like everywhere else: the toast undoes it, and the
        // tasks are in the project trash either way.
        onClick: () => {
          const deleted = store.bulkDeleteTasks(projectId, ids());
          selected.clear();
          done(`${deleted.length} ${plural(deleted.length)} moved to trash`,
            () => store.bulkRestoreTasks(projectId, deleted, 'trash'));
        },
      },
    ]));

    bulkBar.append(
      el('span.bulk-count', {}, `${selected.size} selected`),
      el('div.bulk-actions', {}, columnBtn, dueBtn, prioBtn, labelBtn, peopleBtn, moreBtn),
      el('button.btn.btn-ghost.btn-sm.bulk-clear', {
        type: 'button',
        onclick: () => { selected.clear(); lastClicked = null; syncSelection(); },
      }, 'Clear')
    );
  }

  // ---- render --------------------------------------------------------------

  function render() {
    const d = doc();
    if (!d) return;
    const focused = focusKey();
    const scrollTop = scroller.scrollTop;
    const { ctx } = build();

    groupBtn.textContent = LIST_GROUPS.find((g) => g.key === state.group).label;
    const sortLabel = LIST_SORTS.find((s) => s.key === state.sort.key)?.label ?? 'Board order';
    sortBtn.textContent = state.sort.key === 'board'
      ? sortLabel
      : `${sortLabel} ${state.sort.dir === 'desc' ? '↓' : '↑'}`;

    clear(table);
    if (!rows.length) {
      table.append(el('tbody', {}, el('tr', {}, el('td', { colSpan: HEADERS.length + 1 },
        isFilterActive(filter)
          ? emptyState({
            icon: 'search',
            title: 'No tasks match the filter',
            sub: 'Clear a facet above, or widen the search.',
            action: el('button.btn.btn-ghost.btn-sm', { onclick: () => bar.reset() }, 'Clear filters'),
          })
          : emptyState({
            icon: 'listTodo',
            title: 'No tasks yet',
            sub: 'Add tasks on the board and every one of them shows up here.',
          })
      ))));
    } else {
      table.append(headEl());
      for (const group of groups) {
        const body = el('tbody.list-group');
        if (state.group !== 'none') {
          body.append(el('tr.list-group-row', {},
            el('th.list-group-head', { colSpan: HEADERS.length + 1, scope: 'colgroup' },
              group.tone !== undefined
                && el(`span.agenda-dot.${group.tone || 'none'}`, { 'aria-hidden': 'true' }),
              group.member && avatar(group.member, 18),
              el('span.list-group-name', {}, group.label),
              el('span.list-group-count', {}, String(group.tasks.length))
            )
          ));
        }
        for (const task of group.tasks) body.append(rowEl(task, d, ctx));
        table.append(body);
      }
    }

    const total = d.tasks.length;
    count.textContent = rows.length === total
      ? `${total} ${plural(total)}`
      : `${rows.length} of ${total} ${plural(total)}`;

    renderBulkBar(d);
    scroller.scrollTop = scrollTop;
    restoreFocus(focused);
    bar.update({ shown: rows.length, total });
  }

  const onChange = (e) => {
    if (e.detail?.scope === 'doc' && e.detail.projectId === projectId) render();
  };
  store.addEventListener('change', onChange);
  root.destroy = () => {
    store.removeEventListener('change', onChange);
    views.destroy();
    document.body.classList.remove('bulk-open');
  };

  render();
  return root;
}

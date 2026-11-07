import { el, clear, requireValue } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { store, checklistProgress, PRIORITIES } from '../lib/store.js';
import { columnTasks, doneColumnIds, realDropIndex } from '../lib/board.js';
import { COLUMN_SORTS, planColumnSort, wipState } from '../lib/columns.js';
import { matchesFilter, isFilterActive } from '../lib/filters.js';
import { fmtShort, dueStatus } from '../lib/dates.js';
import { isRecurring, describeRecurrence } from '../lib/recurrence.js';
import { openMenu } from '../ui/menu.js';
import { promptDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { initBoardDnd } from '../ui/dnd.js';
import { openTaskSheet } from '../ui/tasksheet.js';
import { quickAddChips, quickAddHint, applyQuickAdd, rememberQuickAddTarget } from '../ui/quickadd.js';
import { registerShortcutAction } from '../ui/shortcuts.js';
import { filterBar, filterFor } from '../ui/filterbar.js';
import { briefPanel } from '../ui/brief.js';
import { savedViewsBar } from '../ui/savedviews.js';
import { record, spawnedBy, dropSpawned } from '../ui/history.js';
import { openColumnSettings } from '../ui/columnsettings.js';
import { avatarStack, labelChip, priorityBadge, dueBadge } from '../ui/bits.js';

// The empty-board tip is a one-time nudge, not a recurring announcement:
// without this guard it re-fired on every visit to an empty board.
let emptyTipShown = false;

export function boardView({ projectId }) {
  const board = el('div.board', { 'aria-label': 'Kanban board' });
  const live = el('div.sr-only', { 'aria-live': 'polite' });

  const doc = () => store.getDoc(projectId);
  const announce = (msg) => { live.textContent = msg; };

  /* The bar keeps its own DOM: rebuilding it inside render() would pull
     focus out of the input on every keystroke. */
  const filter = filterFor(projectId);
  const bar = filterBar({ projectId, doc, onChange: () => { savedViews.sync(); render(); } });
  /* Saved views are chips above the filter bar: the board only reads the
     filter half of a view, and carries the arrangement for the list. */
  const savedViews = savedViewsBar({
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
  /* The brief sits above the board rather than inside it: it is the ground
     rules for the work, not one more card of it. Like the filter bar, it
     keeps its own DOM so a re-render never interrupts an edit. */
  const brief = briefPanel({ projectId });
  const root = el('div.board-wrap', {}, brief, savedViews, bar, board, live);

  const filterCtx = () => ({ doneIds: doneColumnIds(doc()) });
  const visible = (columnId) =>
    columnTasks(doc().tasks, columnId).filter((t) => matchesFilter(t, filter, filterCtx()));

  // The open composer survives re-renders (every store mutation rebuilds
  // the board), so adding tasks back-to-back never closes it and a draft
  // typed mid-drag is not lost. The chip strip is a stable node moved into
  // each freshly built composer, so its "keep as text" choices survive too.
  let composerFor = null;
  let composerDraft = '';
  let showComposerHint = false;
  const chips = quickAddChips({ doc, onChange: () => chips.update(composerDraft) });

  function focusComposer(columnId, revealNewest = false) {
    if (revealNewest) {
      const colBody = board.querySelector(`.col-body[data-col-id="${columnId}"]`);
      if (colBody) colBody.scrollTop = colBody.scrollHeight;
    }
    board.querySelector(`.col[data-col-id="${columnId}"] .composer-input`)?.focus();
  }

  // ---- cards -----------------------------------------------------------

  function cardEl(task, colIdx, cardIdx) {
    const d = doc();
    const isDone = doneColumnIds(d).has(task.columnId);
    const labels = task.labelIds.map((id) => d.labels.find((l) => l.id === id)).filter(Boolean);
    const assignees = task.assigneeIds.map((id) => d.members.find((m) => m.id === id)).filter(Boolean);
    const milestone = task.milestoneId ? d.milestones.find((m) => m.id === task.milestoneId) : null;
    const checks = checklistProgress(task);

    const meta = el('div.card-row', {},
      priorityBadge(task.priority),
      dueBadge(task, isDone),
      task.comments.length > 0 && el('span.card-count', {
        html: icon('comment', 12, 2), title: `${task.comments.length} comments`,
      }, ` ${task.comments.length}`),
      task.attachments.length > 0 && el('span.card-count', {
        html: icon('paperclip', 12, 2), title: `${task.attachments.length} attachments`,
      }, ` ${task.attachments.length}`),
      checks.total > 0 && el('span.card-count', {
        className: `card-count${checks.done === checks.total ? ' complete' : ''}`,
        html: icon('taskDone', 12, 2),
        title: `Checklist: ${checks.done} of ${checks.total} done`,
      }, ` ${checks.done}/${checks.total}`),
      milestone && el('span.card-count', {
        html: icon('flag', 12, 2), title: `Milestone: ${milestone.name}`,
      }),
      isRecurring(task) && el('span.card-count', {
        html: icon('repeat', 12, 2),
        title: `${describeRecurrence(task.recurrence)}. Repeats when done`,
        role: 'img',
        'aria-label': describeRecurrence(task.recurrence),
      }),
      el('span.grow'),
      avatarStack(assignees, { size: 22, max: 3 })
    );

    const card = el('div.card', {
      dataset: { taskId: task.id },
      tabindex: 0,
      role: 'button',
      // Nothing inside a role="button" is announced on its own, and every
      // badge on a card is an icon, a colour, or a pair of initials — so
      // whatever the card *shows* has to be said out loud here or it does not
      // exist for anyone using a screen reader.
      'aria-label': cardLabel(task, {
        column: d.columns[colIdx].name, position: cardIdx + 1, isDone, labels, assignees, checks,
      }),
      onclick: () => openTaskSheet(projectId, task.id),
      onkeydown: (e) => onCardKey(e, task),
    },
      labels.length > 0 && el('div.card-labels', {},
        labels.map((l) => labelChip(l, { small: true }))),
      el('div.card-title', { className: `card-title${isDone ? ' done' : ''}` }, task.title),
      (meta.childElementCount > 1 || task.priority || task.dueDate) && meta
    );
    return card;
  }

  /**
   * What a card says out loud: its title and where it sits, then the state
   * that changes what you do next — priority, when it is due and whether that
   * is late, who it is for, its labels, and how far its checklist has got.
   */
  function cardLabel(task, { column, position, isDone, labels, assignees, checks }) {
    const status = dueStatus(task.dueDate, isDone);
    const priorityLabel = (value) => {
      const info = PRIORITIES.find((prio) => prio.value === value);
      return info ? `${info.label} priority.` : null;
    };
    const parts = [
      `${task.title || 'Untitled task'}.`,
      `${column}, position ${position}.`,
      priorityLabel(task.priority),
      task.dueDate
        ? `Due ${fmtShort(task.dueDate)}${status === 'overdue' ? ', overdue' : ''}.`
        : null,
      assignees.length ? `Assigned to ${assignees.map((m) => m.name).join(', ')}.` : null,
      labels.length ? `Labels: ${labels.map((l) => l.name).join(', ')}.` : null,
      checks.total ? `Checklist ${checks.done} of ${checks.total} done.` : null,
      // "Every week" on its own says nothing about what repeats; in speech it
      // has to name the behaviour the icon stands for.
      isRecurring(task)
        ? `Repeats ${describeRecurrence(task.recurrence).toLowerCase()}, when done.`
        : null,
      'Enter to open, Alt plus arrows to move.',
    ];
    return parts.filter(Boolean).join(' ');
  }

  function onCardKey(e, task) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openTaskSheet(projectId, task.id);
      return;
    }
    if (!e.altKey || !e.key.startsWith('Arrow')) return;
    e.preventDefault();
    const d = doc();
    const colIdx = d.columns.findIndex((c) => c.id === task.columnId);
    const inCol = visible(task.columnId);
    const idx = inCol.findIndex((t) => t.id === task.id);

    if (e.key === 'ArrowUp' && idx > 0) {
      moveToVisibleIndex(task, task.columnId, idx - 1);
    } else if (e.key === 'ArrowDown' && idx < inCol.length - 1) {
      moveToVisibleIndex(task, task.columnId, idx + 1);
    } else if (e.key === 'ArrowLeft' && colIdx > 0) {
      const to = d.columns[colIdx - 1];
      moveToVisibleIndex(task, to.id, Math.min(idx, visible(to.id).length));
    } else if (e.key === 'ArrowRight' && colIdx < d.columns.length - 1) {
      const to = d.columns[colIdx + 1];
      moveToVisibleIndex(task, to.id, Math.min(idx, visible(to.id).length));
    }
    refocusCard(task.id);
  }

  /**
   * Both drags and keyboard moves land "where the user saw the gap", which
   * with a filter on is a position among the visible cards, not the nth task
   * in the column.
   */
  function moveToVisibleIndex(task, toColumnId, visibleIndex) {
    const d = doc();
    const full = columnTasks(d.tasks, toColumnId).filter((t) => t.id !== task.id);
    const visibleIds = visible(toColumnId).filter((t) => t.id !== task.id).map((t) => t.id);
    // Where it was, before it is not there any more.
    const from = {
      columnId: task.columnId,
      index: columnTasks(d.tasks, task.columnId).findIndex((t) => t.id === task.id),
      order: task.order,
    };
    const toIndex = realDropIndex(full, visibleIds, visibleIndex);
    /* Picked up and put back is not a move. Going through the store anyway
       stamped the task as updated (re-sorting a list ordered by last change
       under whoever was reading it), cost a write, and announced a move that
       never happened — so the no-op is answered before anything is touched. */
    if (from.columnId === toColumnId && from.index === toIndex) return;
    /* A move into a done column completes the task, which for a recurring one
       also creates its successor — so the gesture has to remember what it
       spawned, or its inverse would put the card back and leave the copy. */
    let spawned = spawnedBy(projectId,
      () => store.moveTask(projectId, task.id, toColumnId, toIndex)).spawned;
    announceMove(task, toColumnId, visibleIndex);
    /* One entry per gesture, whatever it rewrote inside the column. The
       inverse is the same mutation, aimed backwards. */
    const toName = d.columns.find((c) => c.id === toColumnId)?.name ?? 'another column';
    const complete = () => {
      spawned = spawnedBy(projectId,
        () => store.moveTask(projectId, task.id, toColumnId, toIndex)).spawned;
    };
    record(projectId, {
      label: from.columnId === toColumnId
        ? `move of “${task.title}”`
        : `move of “${task.title}” to ${toName}`,
      undo: () => {
        store.moveTask(projectId, task.id, from.columnId, Math.max(0, from.index));
        dropSpawned(projectId, spawned);
      },
      // Replaying the completion spawns a fresh successor, so the entry has to
      // learn the new one — otherwise undoing twice would strand it.
      redo: complete,
    });
  }

  function announceMove(task, toColumnId, index) {
    const d = doc();
    const col = d.columns.find((c) => c.id === toColumnId);
    const count = visible(toColumnId).length;
    announce(`Moved "${task.title}" to ${col.name}, position ${index + 1} of ${count}`);
  }

  function refocusCard(taskId) {
    requestAnimationFrame(() => {
      board.querySelector(`.card[data-task-id="${taskId}"]`)?.focus();
    });
  }

  // ---- columns ---------------------------------------------------------

  function composer(column) {
    const wrap = el('div.col-foot');

    if (composerFor !== column.id) {
      wrap.append(el('button.add-card-btn', {
        html: icon('plus', 15, 2.2),
        onclick: () => {
          composerFor = column.id;
          composerDraft = '';
          render();
          focusComposer(column.id);
        },
      }, ' Add task'));
      return wrap;
    }

    const input = el('textarea.input.composer-input', {
      rows: 2,
      // Titles are capped at 200; the extra room is for the tokens that get
      // parsed back out of the text before it becomes one.
      maxLength: 300,
      placeholder: 'Task title. Try "tomorrow", "!high", "#label"',
      value: composerDraft,
      'aria-label': `New task in ${column.name}`,
      oninput: () => { composerDraft = input.value; chips.update(composerDraft); },
      onkeydown: (e) => {
        // Enter/Escape while an IME composition is open confirm or cancel
        // the composition, not the composer.
        if (e.isComposing) return;
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
        if (e.key === 'Escape') closeComposer();
      },
    });

    function submit() {
      if (!requireValue(input, 'A task needs a title.')) return;
      const parsed = chips.parse(input.value);
      composerDraft = '';
      chips.reset();
      // addTask re-renders the board with a fresh, still-open composer;
      // put the caret back and keep the newest card in view.
      const task = applyQuickAdd(projectId, column.id, parsed);
      rememberQuickAddTarget(projectId, column.id);
      // Silently dropping the new card behind the filter would read as a
      // failure to add it.
      if (isFilterActive(filter) && !matchesFilter(task, filter, filterCtx())) {
        toast('Task added, but the current filter hides it', {
          icon: 'search',
          action: { label: 'Clear filters', onClick: () => bar.reset() },
        });
      }
      focusComposer(column.id, true);
    }

    function closeComposer() {
      composerFor = null;
      composerDraft = '';
      chips.reset();
      render();
      board.querySelector(`.col[data-col-id="${column.id}"] .add-card-btn`)?.focus();
    }

    chips.update(composerDraft);
    wrap.append(el('div.composer', {},
      input,
      chips.node,
      el('div.row', {},
        el('button.btn.btn-primary.btn-sm', { onclick: submit }, 'Add task'),
        el('button.icon-btn', {
          html: icon('help', 18),
          'aria-label': 'What can I type here?',
          'aria-expanded': showComposerHint ? 'true' : 'false',
          onclick: () => { showComposerHint = !showComposerHint; render(); focusComposer(column.id); },
        }),
        el('span.grow'),
        el('button.icon-btn', { html: icon('x', 18), 'aria-label': 'Cancel', onclick: closeComposer })
      ),
      showComposerHint && quickAddHint()
    ));
    return wrap;
  }

  function columnEl(column, colIdx) {
    const d = doc();
    const total = columnTasks(d.tasks, column.id).length;
    const tasks = visible(column.id);
    const hidden = total - tasks.length;
    const body = el('div.col-body', { dataset: { colId: column.id } },
      tasks.map((t, i) => cardEl(t, colIdx, i)),
      // Only when a filter emptied the column: a genuinely empty column
      // reads fine with just its composer.
      !tasks.length && total > 0 && el('p.col-empty-hint', {}, 'No matches')
    );

    const menuBtn = el('button.icon-btn.small', {
      html: icon('more', 17, 2),
      'aria-label': `Options for ${column.name}`,
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      onclick: () => openColumnMenu(menuBtn, column, colIdx),
    });

    /* Two things want the same little box: how much a filter is hiding, and
       how the column is doing against its own limit. The filter is the more
       urgent of the two — it explains why cards are missing — so it wins the
       label, and the limit moves into the tooltip behind it. */
    const wip = wipState(column, total);
    const limitNote = wip.limit === null ? '' : `Limit ${wip.limit}`;
    const countLabel = hidden ? `${tasks.length}/${total}`
      : wip.limit !== null ? `${total} / ${wip.limit}`
      : String(total);

    const head = el('div.col-head', {},
      el('h2.col-name', {}, column.name),
      column.done && el('span.col-done-ic', { html: icon('check', 13, 2.6), title: 'Tasks here count as done', role: 'img', 'aria-label': 'Done column' }),
      column.autoArchiveDays > 0 && column.done && el('span.col-auto-ic', {
        html: icon('archive', 12, 2),
        role: 'img',
        title: `Tasks that have sat here for ${column.autoArchiveDays} `
          + `day${column.autoArchiveDays === 1 ? '' : 's'} are archived on project open`,
        'aria-label': `Archives tasks after ${column.autoArchiveDays} days`,
      }),
      el('span.col-count', {
        className: `col-count${hidden ? ' filtered' : ''}${wip.over && !hidden ? ' over' : ''}`,
        title: hidden
          ? `${tasks.length} of ${total} tasks match the filter`
            + (limitNote ? `. ${limitNote}` : '')
          : wip.over ? `${total} tasks, over the limit of ${wip.limit}`
          : limitNote || null,
      }, countLabel),
      el('span.grow'),
      menuBtn
    );

    return el('div.col', {
      dataset: { colId: column.id },
      role: 'group',
      'aria-label': hidden
        ? `${column.name}, ${tasks.length} of ${total} tasks shown`
        : wip.over
          ? `${column.name}, ${total} tasks, over its limit of ${wip.limit}`
          : `${column.name}, ${total} tasks`,
    }, head, body, composer(column));
  }

  /**
   * One-shot: rewrite this column's order and say so, with the previous
   * arrangement one click away. Deliberately not a sticky sort — the board is
   * manually ordered by design, and a column that re-sorted itself would
   * fight the person dragging cards in it.
   */
  function sortColumn(column, sort) {
    const rewrites = planColumnSort(doc().tasks, column.id, sort.key);
    if (!rewrites.length) {
      toast(`${column.name} is already sorted by ${sort.label.toLowerCase()}`,
        { icon: 'check' });
      return;
    }
    const before = rewrites.map(({ id }) => ({
      id, order: doc().tasks.find((t) => t.id === id)?.order ?? 0,
    }));
    store.setTaskOrders(projectId, rewrites);
    announce(`${column.name} sorted by ${sort.label.toLowerCase()}`);
    record(projectId, {
      label: `sort of ${column.name} by ${sort.label.toLowerCase()}`,
      undo: () => store.setTaskOrders(projectId, before),
      redo: () => store.setTaskOrders(projectId, rewrites),
    });
    toast(`${column.name} sorted by ${sort.label.toLowerCase()}`, {
      icon: 'listTodo',
      duration: 7000,
      action: { label: 'Undo', onClick: () => store.setTaskOrders(projectId, before) },
    });
  }

  function openColumnMenu(anchor, column, colIdx) {
    const d = doc();
    openMenu(anchor, [
      {
        label: 'Rename column', icon: 'pencil',
        onClick: async () => {
          const name = await promptDialog({ title: 'Rename column', label: 'Column name', value: column.name });
          if (!name || name === column.name) return;
          const before = column.name;
          store.updateColumn(projectId, column.id, { name });
          record(projectId, {
            label: `rename of ${before}`,
            undo: () => store.updateColumn(projectId, column.id, { name: before }),
            redo: () => store.updateColumn(projectId, column.id, { name }),
          });
        },
      },
      {
        label: column.done ? 'Unmark as done column' : 'Mark as done column',
        icon: 'taskDone',
        onClick: () => store.updateColumn(projectId, column.id, { done: !column.done }),
      },
      {
        label: 'Column settings…', icon: 'gear',
        onClick: () => openColumnSettings(projectId, column.id),
      },
      {
        label: 'Sort tasks by…',
        icon: 'arrowDown',
        disabled: columnTasks(d.tasks, column.id).length < 2,
        onClick: () => openMenu(anchor, COLUMN_SORTS.map((s) => ({
          label: s.label,
          onClick: () => sortColumn(column, s),
        }))),
      },
      // Clearing out finished work is the everyday reason to archive, so the
      // action lives on the done column that accumulates it.
      column.done && {
        label: `Archive tasks here${columnTasks(d.tasks, column.id).length
          ? ` (${columnTasks(d.tasks, column.id).length})` : ''}`,
        icon: 'archive',
        disabled: !columnTasks(d.tasks, column.id).length,
        onClick: () => {
          const ids = store.archiveTasksIn(projectId, column.id);
          if (!ids?.length) return;
          toast(`${ids.length} task${ids.length === 1 ? '' : 's'} archived`, {
            icon: 'archive',
            duration: 7000,
            action: {
              label: 'Undo',
              onClick: () => { for (const id of ids) store.unarchiveTask(projectId, id); },
            },
          });
        },
      },
      'sep',
      colIdx > 0 && {
        label: 'Move left', icon: 'arrowL',
        onClick: () => store.moveColumn(projectId, column.id, colIdx - 1),
      },
      colIdx < d.columns.length - 1 && {
        label: 'Move right', icon: 'arrowR',
        onClick: () => store.moveColumn(projectId, column.id, colIdx + 1),
      },
      'sep',
      {
        label: 'Delete column', icon: 'trash', danger: true,
        disabled: d.columns.length <= 1,
        // No confirm: the toast says where the tasks went and undoes it.
        onClick: () => {
          const removed = store.deleteColumn(projectId, column.id);
          if (!removed) return;
          const n = removed.moved.length;
          toast(n
            ? `Column deleted. ${n} task${n === 1 ? '' : 's'} moved to ${removed.fallbackName}`
            : 'Column deleted', {
            icon: 'trash',
            duration: 7000,
            action: {
              label: 'Undo',
              onClick: () => store.restoreColumn(projectId, removed),
            },
          });
        },
      },
    ]);
  }

  // ---- board -----------------------------------------------------------

  function render() {
    const d = doc();
    if (!d) return;
    // Preserve focus across the rebuild (keyboard moves re-render).
    const focusedId = document.activeElement?.closest?.('.card')?.dataset?.taskId;

    clear(board);
    d.columns.forEach((c, i) => board.append(columnEl(c, i)));
    board.append(el('div.add-col', {},
      el('button.add-col-btn', {
        html: icon('plus', 16, 2.2),
        onclick: async () => {
          const name = await promptDialog({ title: 'Add column', label: 'Column name', placeholder: 'e.g. In review', confirmLabel: 'Add column' });
          if (name) store.addColumn(projectId, name);
        },
      }, ' Add column')
    ));
    if (focusedId) board.querySelector(`.card[data-task-id="${focusedId}"]`)?.focus();

    bar.update({
      shown: d.tasks.filter((t) => matchesFilter(t, filter, filterCtx())).length,
      total: d.tasks.length,
    });
  }

  /* `n` belongs to the board while it is on screen: opening the composer in
     the column the user is looking at beats a dialog. */
  const unregisterNewTask = registerShortcutAction('new-task', () => {
    const d = doc();
    if (!d?.columns.length) return false;
    const focused = document.activeElement?.closest?.('.col')?.dataset?.colId;
    const columnId = d.columns.some((c) => c.id === focused) ? focused : d.columns[0].id;
    if (composerFor !== columnId) {
      composerFor = columnId;
      composerDraft = '';
      chips.reset();
      render();
    }
    focusComposer(columnId, true);
    return true;
  });

  const dnd = initBoardDnd(board, {
    onDropCard(taskId, toColumnId, toIndex) {
      const d = doc();
      const task = d.tasks.find((t) => t.id === taskId);
      if (!task) return;
      moveToVisibleIndex(task, toColumnId, toIndex);
    },
    onDropColumn(columnId, toIndex) {
      store.moveColumn(projectId, columnId, toIndex);
      const col = doc().columns.find((c) => c.id === columnId);
      if (col) announce(`Moved column "${col.name}" to position ${toIndex + 1}`);
    },
  });

  const onChange = (e) => {
    if (e.detail?.scope === 'doc' && e.detail.projectId === projectId) render();
  };
  store.addEventListener('change', onChange);

  root.destroy = () => {
    dnd.destroy();
    unregisterNewTask();
    brief.destroy();
    savedViews.destroy();
    store.removeEventListener('change', onChange);
  };

  render();

  // Nudge first-time users somewhere obvious, once per session.
  if (!doc().tasks.length && !emptyTipShown) {
    emptyTipShown = true;
    toast('Tip: add your first task with the button under a column', { icon: 'listTodo', duration: 4000 });
  }
  return root;
}

/**
 * Tasks: outstanding and completed work across the firm, filtered by due
 * date, assignee, and priority, with bulk complete, reassign, and delete.
 * Task list templates can be applied to a matter in one step.
 */
import '../styles/calendar-tasks.css';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup, meId } from '../app.js';
import { pageHeader, segmented, searchBox, select, dataTable, emptyState, field, textInput } from '../ui/components.js';
import { setQuery } from '../ui/router.js';
import { openMenu } from '../ui/menu.js';
import { formDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { matterLink, userChip, dueLabel, priorityPill, matterPicker, rememberSort, saveSort } from './common.js';
import { openTaskDialog, toggleTask } from './dialogs.js';
import { matches, pluralize } from '../core/format.js';
import { addDays, namedRange, formatDate, today as dayOf } from '../core/dates.js';
import { tasksFromList } from '../core/matters.js';

const DUE_OPTIONS = [
  { value: 'all', label: 'All dates' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'due', label: 'Today or overdue' },
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'none', label: 'No due date' },
];

const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };

export function render(ctx) {
  const store = app.store;
  const state = {
    status: ctx.query.status === 'completed' ? 'completed' : 'outstanding',
    due: DUE_OPTIONS.some((o) => o.value === ctx.query.due) ? ctx.query.due : 'all',
    who: ctx.query.who || (meId() ? 'me' : 'all'),
    priority: ctx.query.priority || '',
    q: ctx.query.q || '',
  };

  const header = pageHeader({
    title: 'Tasks',
    actions: [
      h('button.btn', { type: 'button', onClick: () => applyTaskList() }, icon('list-todo', 16), h('span.hide-sm', 'Apply task list')),
      h(
        'button.btn.primary',
        { type: 'button', onClick: () => openTaskDialog({ assigneeId: state.who !== 'me' && state.who !== 'all' && state.who !== 'none' ? state.who : undefined }) },
        icon('plus', 16),
        'New task',
      ),
    ],
  });

  // ---- Filters ------------------------------------------------------------------

  const statusWrap = h('div');
  const dueSel = select({ name: 'due', value: state.due, 'aria-label': 'Due date', options: DUE_OPTIONS });
  dueSel.addEventListener('change', () => {
    state.due = dueSel.value;
    setQuery({ due: state.due === 'all' ? '' : state.due });
    refresh();
  });
  const whoSel = select({
    name: 'who',
    value: state.who,
    'aria-label': 'Assignee',
    options: [
      { value: 'me', label: 'Assigned to me' },
      { value: 'all', label: 'Anyone' },
      { value: 'none', label: 'Unassigned' },
      ...lookup.activeUsers().map((u) => ({ value: u.id, label: u.name })),
    ],
  });
  whoSel.addEventListener('change', () => {
    state.who = whoSel.value;
    setQuery({ who: state.who });
    refresh();
  });
  const prioSel = select({
    name: 'priority',
    value: state.priority,
    'aria-label': 'Priority',
    options: [
      { value: '', label: 'Any priority' },
      { value: 'high', label: 'High' },
      { value: 'normal', label: 'Normal' },
      { value: 'low', label: 'Low' },
    ],
  });
  prioSel.addEventListener('change', () => {
    state.priority = prioSel.value;
    setQuery({ priority: state.priority });
    refresh();
  });
  const search = searchBox({
    value: state.q,
    placeholder: 'Search tasks',
    label: 'Search tasks',
    onInput: (v) => {
      state.q = v;
      setQuery({ q: v });
      setRows();
    },
  });

  function dueMatch(t, today) {
    const d = t.dueDate;
    switch (state.due) {
      case 'overdue':
        return !!d && d < today && !t.done;
      case 'due':
        return !!d && d <= today && !t.done;
      case 'today':
        return d === today;
      case 'tomorrow':
        return d === addDays(today, 1);
      case 'week':
      case 'month': {
        const [a, b] = namedRange(state.due, today, app.settings().weekStart);
        return !!d && d >= a && d <= b;
      }
      case 'none':
        return !d;
      default:
        return true;
    }
  }

  function rows() {
    const today = app.today();
    const me = meId();
    return store.all('tasks').filter((t) => {
      if (state.status === 'completed' ? !t.done : t.done) return false;
      if (state.who === 'me' && t.assigneeId !== me) return false;
      if (state.who === 'none' && t.assigneeId) return false;
      if (state.who !== 'me' && state.who !== 'all' && state.who !== 'none' && t.assigneeId !== state.who) return false;
      if (state.priority && (t.priority || 'normal') !== state.priority) return false;
      if (!dueMatch(t, today)) return false;
      if (state.q) {
        const m = t.matterId ? lookup.matter(t.matterId) : null;
        if (!matches(`${t.name} ${t.description || ''} ${m ? `${m.displayNumber} ${m.description}` : ''}`, state.q)) return false;
      }
      return true;
    });
  }

  // ---- Table -------------------------------------------------------------------------

  const checkBtn = (t) =>
    h(
      `button.task-check${t.done ? '.done' : ''}`,
      {
        type: 'button',
        'aria-pressed': String(!!t.done),
        'aria-label': `${t.done ? 'Mark not done' : 'Mark complete'}: ${t.name}`,
        title: t.done ? 'Mark not done' : 'Mark complete',
        onClick: () => toggleTask(t),
      },
      icon('check', 14),
    );

  const nameCell = (t) =>
    h(
      'button.task-name',
      { type: 'button', onClick: () => openTaskDialog({ task: t }), title: t.description || t.name },
      h(`span.task-title${t.done ? '.done' : ''}`, t.name),
      t.description ? h('span.task-desc', t.description) : null,
    );

  const columns = [
    { id: 'done', label: '', srLabel: 'Complete', fixed: true, width: '48px', render: checkBtn },
    { id: 'name', label: 'Task', fixed: true, width: '34%', render: nameCell, sort: (t) => t.name.toLowerCase() },
    { id: 'matter', label: 'Matter', render: (t) => (t.matterId ? matterLink(t.matterId) : h('span.subtle', 'None')), sort: (t) => lookup.matter(t.matterId)?.displayNumber || '' },
    { id: 'assignee', label: 'Assignee', render: (t) => userChip(t.assigneeId), sort: (t) => lookup.userName(t.assigneeId) },
    { id: 'due', label: 'Due', render: (t) => dueLabel(t, app.today()), sort: (t) => t.dueDate || '' },
    { id: 'priority', label: 'Priority', render: (t) => priorityPill(t.priority) || h('span.subtle', 'Normal'), sort: (t) => PRIORITY_RANK[t.priority || 'normal'] },
    { id: 'completed', label: 'Completed', hidden: true, render: (t) => (t.completedAt ? formatDate(dayOf(new Date(t.completedAt))) : ''), sort: (t) => t.completedAt || '' },
  ];

  const bulk = h('div.bulk-bar', { hidden: true });
  const table = dataTable({
    caption: 'Tasks',
    columns,
    columnsKey: 'tasks',
    sort: rememberSort('tasks', { id: 'due', dir: 'asc' }),
    onSort: (s) => saveSort('tasks', s),
    selectable: true,
    onSelectionChange: drawBulk,
    rowClass: (t) => (!t.done && t.dueDate && t.dueDate < app.today() ? 'overdue' : ''),
    mobile: (t) =>
      h(
        'div.task-row',
        checkBtn(t),
        h(
          'button.task-name.grow',
          { type: 'button', onClick: () => openTaskDialog({ task: t }) },
          h(`span.task-title${t.done ? '.done' : ''}`, t.name),
          h('span.task-desc', [t.matterId ? lookup.matter(t.matterId)?.displayNumber : '', lookup.userName(t.assigneeId)].filter(Boolean).join(' · ')),
        ),
        h('span.task-due', dueLabel(t, app.today())),
      ),
    empty: () =>
      store.all('tasks').length
        ? emptyState({
            compact: true,
            icon: state.status === 'completed' ? 'check-check' : 'circle-check',
            title: state.status === 'completed' ? 'No completed tasks match' : 'Nothing to do here',
            text: state.status === 'completed' ? 'Try a different date, assignee, or search.' : 'No outstanding tasks match these filters.',
            headingLevel: 3,
          })
        : emptyState({
            icon: 'list-checks',
            title: 'No tasks yet',
            text: 'Track deadlines and follow-ups for every matter. Apply a task list to add a whole checklist at once.',
            actions: [h('button.btn.primary', { type: 'button', onClick: () => openTaskDialog() }, icon('plus', 16), 'New task')],
            headingLevel: 3,
          }),
    footer: (list) => {
      const today = app.today();
      const overdue = list.filter((t) => !t.done && t.dueDate && t.dueDate < today).length;
      return [h('span', h('strong', String(list.length)), list.length === 1 ? ' task' : ' tasks'), overdue ? h('span.text-danger', h('strong', String(overdue)), ' overdue') : null];
    },
  });

  function drawBulk(sel) {
    bulk.hidden = !sel.size;
    if (!sel.size) return;
    const chosen = () => [...sel].map((id) => store.get('tasks', id)).filter(Boolean);
    // Redrawn on every refresh, so keep keyboard focus on the same button.
    const focused = bulk.contains(document.activeElement) ? document.activeElement.textContent : null;
    bulk.replaceChildren(
      h('span', `${sel.size} selected`),
      h('div.spacer'),
      state.status === 'outstanding'
        ? h('button.btn.sm', { type: 'button', onClick: () => bulkComplete(chosen(), true) }, icon('check', 15), 'Complete')
        : h('button.btn.sm', { type: 'button', onClick: () => bulkComplete(chosen(), false) }, icon('rotate-ccw', 15), 'Reopen'),
      h(
        'button.btn.sm',
        {
          type: 'button',
          onClick: (e) =>
            openMenu(e.currentTarget, [
              { heading: 'Assign to' },
              ...lookup.activeUsers().map((u) => ({ label: u.name, run: () => bulkAssign(chosen(), u.id) })),
              { separator: true },
              { label: 'Unassigned', run: () => bulkAssign(chosen(), null) },
            ]),
        },
        icon('user', 15),
        'Reassign',
        icon('chevron-down', 14),
      ),
      h('button.btn.sm.danger-text', { type: 'button', onClick: () => bulkDelete(chosen()) }, icon('trash', 15), 'Delete'),
      h('button.btn.sm.ghost', { type: 'button', onClick: () => table.clearSelection() }, 'Clear'),
    );
    if (focused !== null) ([...bulk.querySelectorAll('button')].find((x) => x.textContent === focused) || bulk.querySelector('button'))?.focus();
  }

  function bulkComplete(list, done) {
    const me = meId();
    const prev = list.map((t) => ({ id: t.id, done: t.done, completedAt: t.completedAt || null, completedBy: t.completedBy || null }));
    for (const t of list) store.patch('tasks', t.id, { done, completedAt: done ? new Date().toISOString() : null, completedBy: done ? me : null });
    table.clearSelection();
    toast(`${pluralize(list.length, 'task')} ${done ? 'completed' : 'reopened'}`, { action: { label: 'Undo', run: () => prev.forEach((p) => store.patch('tasks', p.id, p)) } });
  }

  function bulkAssign(list, userId) {
    const prev = list.map((t) => ({ id: t.id, assigneeId: t.assigneeId || null }));
    for (const t of list) store.patch('tasks', t.id, { assigneeId: userId });
    table.clearSelection();
    toast(`${pluralize(list.length, 'task')} assigned to ${userId ? lookup.userName(userId) : 'nobody'}`, { action: { label: 'Undo', run: () => prev.forEach((p) => store.patch('tasks', p.id, p)) } });
  }

  function bulkDelete(list) {
    store.bulkRemove(
      'tasks',
      list.map((t) => t.id),
    );
    table.clearSelection();
    toast(`${pluralize(list.length, 'task')} deleted`, { action: { label: 'Undo', run: () => list.forEach((t) => store.restore('tasks', t)) } });
  }

  function drawStatus() {
    const all = store.all('tasks');
    let open = 0;
    for (const t of all) if (!t.done) open++;
    const focused = statusWrap.contains(document.activeElement);
    statusWrap.replaceChildren(
      segmented({
        label: 'Task status',
        value: state.status,
        items: [
          { value: 'outstanding', label: 'Outstanding', count: open },
          { value: 'completed', label: 'Completed', count: all.length - open },
        ],
        onChange: (v) => {
          state.status = v;
          setQuery({ status: v === 'outstanding' ? '' : v });
          table.clearSelection();
          refresh();
        },
      }),
    );
    // The switcher is rebuilt with fresh counts; keep keyboard focus on it.
    if (focused) statusWrap.querySelector('[aria-checked="true"]')?.focus();
  }

  /** The table drops selected rows that left the list, so the bulk bar redraws with it. */
  function setRows() {
    table.setRows(rows());
    drawBulk(table.selected);
  }

  function refresh() {
    drawStatus();
    setRows();
  }
  refresh();
  ctx.watch(['tasks', 'matters', 'users'], refresh);

  return {
    title: 'Tasks',
    node: h(
      'div.page.fill',
      header,
      h('section.card.list-card', { 'aria-label': 'Task list' }, h('div.toolbar', statusWrap, search, h('div.spacer'), dueSel, whoSel, prioSel, table.columnsButton()), bulk, table.node),
    ),
  };
}

/** Pick a task list template and a matter, then create its tasks. */
export function applyTaskList({ matterId = '' } = {}) {
  const store = app.store;
  const lists = store.all('taskLists');
  if (!lists.length) {
    toast('There are no task lists yet. Create one in Settings, Task lists.', { type: 'info', duration: 6000 });
    return Promise.resolve(null);
  }
  const matter = matterPicker({ value: matterId, required: true, includeClosed: false });
  const listSel = select({ name: 'listId', value: lists[0].id, options: lists.map((l) => ({ value: l.id, label: `${l.name} (${pluralize((l.items || []).length, 'task')})` })) });
  const preview = h('ul.tasklist-preview');
  const drawPreview = () => {
    const l = store.get('taskLists', listSel.value);
    preview.replaceChildren(
      ...(l?.items || []).map((it) =>
        h(
          'li',
          icon('square', 14),
          h('span.grow', it.name),
          it.dueOffset === null || it.dueOffset === undefined || it.dueOffset === '' ? null : h('span.subtle.small', Number(it.dueOffset) === 0 ? 'Same day' : `Day ${it.dueOffset}`),
        ),
      ),
    );
  };
  listSel.addEventListener('change', drawPreview);
  drawPreview();
  return formDialog({
    title: 'Apply a task list',
    subtitle: 'Creates every task in the list on a matter, with due dates counted from the start date.',
    body: h(
      'div.stack',
      field('Task list', listSel, { required: true }),
      field('Matter', matter, { required: true }),
      field('Start date', textInput({ name: 'start', type: 'date', value: app.today() }), { required: true }),
      preview,
    ),
    submitLabel: 'Create tasks',
    onSubmit: (fd) => {
      const m = store.get('matters', matter.value);
      if (!m) {
        matter.input.setAttribute('aria-invalid', 'true');
        matter.input.focus();
        return false;
      }
      const list = store.get('taskLists', fd.get('listId'));
      const tasks = tasksFromList(list, m, fd.get('start') || app.today(), (id) => lookup.user(id)?.active !== false);
      store.bulkPut('tasks', tasks);
      toast(`${pluralize(tasks.length, 'task')} added to ${m.displayNumber || 'the matter'}`);
      return tasks;
    },
  });
}

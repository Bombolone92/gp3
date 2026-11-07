/**
 * Task list templates: reusable checklists (for example "Personal injury
 * intake") that can be applied to a matter to create its tasks at once.
 */
import '../styles/settings.css';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app } from '../app.js';
import { formDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { field, textInput, select, card, emptyState } from '../ui/components.js';
import { openMenu } from '../ui/menu.js';
import { PRIORITIES, practiceAreaName } from '../core/settings.js';
import { newId } from '../core/ids.js';

const ASSIGNEES = [
  { value: 'responsible', label: 'Responsible lawyer' },
  { value: 'originating', label: 'Originating lawyer' },
  { value: 'staff', label: 'Responsible staff' },
];

export function openTaskListDialog(list = null) {
  let items = (list?.items || []).map((x) => ({ ...x }));
  if (!items.length) items.push({ id: `tli-${newId()}`, name: '', dueOffset: '', priority: 'normal', assignee: 'responsible' });
  const rows = h('ol.tl-items', { 'aria-label': 'Tasks in this list' });

  function draw(focusIndex = null) {
    rows.replaceChildren(
      ...items.map((it, i) => {
        const name = h('input.input', { type: 'text', value: it.name, placeholder: 'Task name', 'aria-label': `Task ${i + 1} name` });
        name.addEventListener('input', () => (it.name = name.value));
        const due = h('input.input.num', {
          type: 'number',
          min: '0',
          step: '1',
          value: it.dueOffset === null || it.dueOffset === undefined ? '' : String(it.dueOffset),
          placeholder: 'None',
          'aria-label': `Task ${i + 1} due, days after the list is applied`,
        });
        due.addEventListener('input', () => (it.dueOffset = due.value === '' ? '' : Math.max(0, Math.round(Number(due.value) || 0))));
        const pri = select({ name: `p${i}`, value: it.priority || 'normal', 'aria-label': `Task ${i + 1} priority`, options: PRIORITIES.map((p) => ({ value: p.id, label: p.label })) });
        pri.addEventListener('change', () => (it.priority = pri.value));
        const who = select({ name: `a${i}`, value: it.assignee || 'responsible', 'aria-label': `Task ${i + 1} assignee`, options: ASSIGNEES });
        who.addEventListener('change', () => (it.assignee = who.value));
        return h(
          'li.tl-item',
          h('div.tl-name', name),
          h('label.tl-due', h('span.small.subtle', 'Due after'), due, h('span.small.subtle', 'days')),
          h('div.tl-pri', pri),
          h('div.tl-who', who),
          h(
            'div.tl-actions',
            h(
              'button.icon-btn.sm',
              { type: 'button', 'aria-label': `Move task ${i + 1} up`, disabled: i === 0 || null, onClick: () => (([items[i - 1], items[i]] = [items[i], items[i - 1]]), draw(i - 1)) },
              icon('arrow-up', 15),
            ),
            h(
              'button.icon-btn.sm',
              {
                type: 'button',
                'aria-label': `Move task ${i + 1} down`,
                disabled: i === items.length - 1 || null,
                onClick: () => (([items[i + 1], items[i]] = [items[i], items[i + 1]]), draw(i + 1)),
              },
              icon('arrow-down', 15),
            ),
            h('button.icon-btn.sm', { type: 'button', 'aria-label': `Remove task ${i + 1}`, onClick: () => ((items = items.filter((_, k) => k !== i)), draw(Math.max(0, i - 1))) }, icon('trash', 15)),
          ),
        );
      }),
    );
    // With no rows left, focus goes to "Add task" instead of falling out of the dialog.
    if (focusIndex !== null) (rows.children[focusIndex]?.querySelector('input') || addBtn).focus();
  }
  const addBtn = h(
    'button.btn',
    { type: 'button', onClick: () => (items.push({ id: `tli-${newId()}`, name: '', dueOffset: '', priority: 'normal', assignee: 'responsible' }), draw(items.length - 1)) },
    icon('plus', 15),
    'Add task',
  );
  draw();

  return formDialog({
    title: list ? 'Edit task list' : 'New task list',
    size: 'full',
    body: h(
      'div.stack',
      h(
        'div.grid-2',
        field('List name', textInput({ name: 'name', value: list?.name || '', autofocus: true, placeholder: 'For example, Estate plan' }), { required: true }),
        field(
          'Practice area',
          select({
            name: 'practiceAreaId',
            value: list?.practiceAreaId || '',
            options: [{ value: '', label: 'Any practice area' }, ...app.settings().practiceAreas.map((p) => ({ value: p.id, label: p.name }))],
          }),
        ),
      ),
      h(
        'div.stack-sm',
        h('h3.small-head', 'Tasks'),
        rows,
        h('div', addBtn),
      ),
      h('p.subtle.small', 'Due dates count from the day the list is applied to a matter. Leave the days empty for no due date.'),
    ),
    submitLabel: list ? 'Save list' : 'Create list',
    onSubmit: (fd) => {
      const clean = items
        .filter((it) => String(it.name || '').trim())
        .map((it) => ({ ...it, name: it.name.trim(), dueOffset: it.dueOffset === '' || it.dueOffset === undefined ? null : Number(it.dueOffset) }));
      if (!clean.length) {
        toast('Add at least one task to the list.', { type: 'error' });
        rows.querySelector('input')?.focus();
        return false;
      }
      const rec = app.store.put('taskLists', { ...(list || {}), name: String(fd.get('name')).trim(), practiceAreaId: fd.get('practiceAreaId') || '', items: clean });
      toast(list ? 'Task list saved' : 'Task list created');
      return rec;
    },
  });
}

async function deleteTaskList(t) {
  const ok = await confirmDialog({ title: `Delete "${t.name}"?`, message: 'Tasks already created from this list stay on their matters.', confirmLabel: 'Delete list', danger: true });
  if (!ok) return;
  app.store.remove('taskLists', t.id);
  toast('Task list deleted', { action: { label: 'Undo', run: () => app.store.restore('taskLists', t) } });
}

export function taskListsSection(ctx) {
  const body = h('div');
  function draw() {
    const lists = [...app.store.all('taskLists')].sort((a, b) => a.name.localeCompare(b.name));
    body.replaceChildren(
      lists.length
        ? h(
            'ul.settings-cards',
            lists.map((t) =>
              h(
                'li.settings-card',
                h('span.settings-card-icon', icon('list-todo', 18)),
                h(
                  'div.grow',
                  h('button.link-btn.settings-card-title', { type: 'button', onClick: () => openTaskListDialog(t) }, t.name),
                  h(
                    'div.subtle.small',
                    [practiceAreaName(app.settings(), t.practiceAreaId) || 'Any practice area', `${(t.items || []).length} ${(t.items || []).length === 1 ? 'task' : 'tasks'}`].join(' · '),
                  ),
                ),
                h(
                  'button.icon-btn.sm',
                  {
                    type: 'button',
                    'aria-label': `Actions for ${t.name}`,
                    onClick: (e) =>
                      openMenu(e.currentTarget, [
                        { label: 'Edit', icon: 'pencil', run: () => openTaskListDialog(t) },
                        {
                          label: 'Duplicate',
                          icon: 'copy',
                          run: () => app.store.put('taskLists', { name: `${t.name} (copy)`, practiceAreaId: t.practiceAreaId, items: (t.items || []).map((x) => ({ ...x, id: `tli-${newId()}` })) }),
                        },
                        { separator: true },
                        { label: 'Delete', icon: 'trash', danger: true, run: () => deleteTaskList(t) },
                      ]),
                  },
                  icon('more', 16),
                ),
              ),
            ),
          )
        : emptyState({
            compact: true,
            icon: 'list-todo',
            title: 'No task lists yet',
            text: 'Build a checklist once, then apply it to any matter to create all its tasks with due dates.',
            headingLevel: 3,
          }),
    );
  }
  draw();
  ctx.watch(['taskLists'], draw);
  return card({
    title: 'Task lists',
    actions: h('button.btn.primary.sm', { type: 'button', onClick: () => openTaskListDialog() }, icon('plus', 15), 'New task list'),
    body,
  });
}

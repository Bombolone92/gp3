import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderList, fieldFilter } from '../ui/grid.js';
import { openFormDialog } from '../ui/form.js';
import { app, canEdit } from '../app.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { dash, money, archiveBulk } from './common.js';
import { docTotals } from '../core/totals.js';

export function render(ctx) {
  const store = app.store;
  const editable = canEdit('serviceTasks');
  const usage = () => {
    const m = new Map();
    for (const e of store.all('serviceEntries')) for (const li of e.lineItems || []) if (li.taskId) m.set(li.taskId, (m.get(li.taskId) || 0) + 1);
    return m;
  };
  let used = usage();
  ctx.onDispose(store.subscribe((c) => c.has('serviceEntries') && (used = usage())));
  const remCount = (t) => store.all('reminders').filter((r) => r.taskId === t.id).length;
  return renderList(ctx, {
    key: 'service-tasks',
    title: 'Service tasks',
    intro: 'The catalog of maintenance and repair work used on reminders, work orders, and service entries.',
    coll: 'serviceTasks',
    watch: ['reminders', 'serviceEntries'],
    csvName: 'service-tasks',
    actions: editable ? [h('button.btn.primary', { type: 'button', onClick: () => openTaskDialog({}) }, icon('plus', 16), 'Add service task')] : [],
    tabs: [
      { id: 'active', label: 'Active', filter: (t) => !t.archived },
      { id: 'archived', label: 'Archived', filter: (t) => t.archived },
    ],
    filters: [fieldFilter('category', 'Category', 'category', () => app.settings().serviceCategories.map((c) => ({ value: c, label: c })))],
    defaultSort: { id: 'name', dir: 'asc' },
    search: (t) => [t.name, t.category, t.description].join(' '),
    columns: [
      { id: 'name', label: 'Name', fixed: true, render: (t) => (editable ? h('button.link-btn.strong', { type: 'button', onClick: () => openTaskDialog(t) }, t.name) : h('strong', t.name)), sort: (t) => t.name },
      { id: 'category', label: 'Category', render: (t) => t.category || dash(), sort: (t) => t.category || '' },
      { id: 'description', label: 'Description', render: (t) => h('span.truncate', t.description || ''), sort: (t) => t.description || '' },
      { id: 'reminders', label: 'Reminders', align: 'r', render: (t) => String(remCount(t)), sort: remCount },
      { id: 'entries', label: 'Times performed', align: 'r', render: (t) => String(used.get(t.id) || 0), sort: (t) => used.get(t.id) || 0 },
    ],
    mobile: (t) => h('div.grow', h('strong', t.name), h('div.subtle', t.category || '')),
    bulk: editable ? [archiveBulk('serviceTasks', 'task')] : null,
    empty: { icon: 'wrench', title: 'No service tasks', text: 'Add the maintenance and repairs you track, like oil changes and tire rotations.' },
  });
}

export function openTaskDialog(t) {
  const store = app.store;
  const s = app.settings();
  const existing = t.id ? store.get('serviceTasks', t.id) : null;
  return openFormDialog({
    title: existing ? 'Edit service task' : 'New service task',
    record: { category: s.serviceCategories[0], ...t },
    fields: [
      { id: 'name', label: 'Name', required: true, span: 2 },
      { id: 'category', label: 'Category', type: 'select', options: () => s.serviceCategories },
      { id: 'description', label: 'Description', type: 'textarea', rows: 3, span: 2 },
    ],
    extraFooter: existing
      ? ({ close }) =>
          h(
            'button.btn.subtle-danger',
            {
              type: 'button',
              onClick: async () => {
                const onLine = (d) => (d.lineItems || []).some((li) => li.taskId === existing.id);
                const inUse = store.all('reminders').some((r) => r.taskId === existing.id) || store.all('serviceEntries').some(onLine) || store.all('workOrders').some(onLine) || store.all('servicePrograms').some((p) => (p.schedules || []).some((x) => x.taskId === existing.id));
                if (inUse || existing.archived) {
                  store.patch('serviceTasks', existing.id, { archived: !existing.archived });
                  toast(existing.archived ? 'Task restored' : 'Task archived. It is used in history, so it was archived instead of deleted.');
                  return close();
                }
                if (await confirmDialog({ title: 'Delete service task?', message: `${existing.name} will be deleted.`, confirmLabel: 'Delete', danger: true })) {
                  store.remove('serviceTasks', existing.id);
                  close();
                }
              },
            },
            icon(existing.archived ? 'unarchive' : 'trash', 15),
            existing.archived ? 'Restore' : 'Delete',
          )
      : null,
    onSave: (v) => {
      const saved = store.put('serviceTasks', { archived: false, ...(existing || {}), ...v });
      toast(existing ? 'Service task saved' : 'Service task added');
      return saved;
    },
  });
}

export { money, docTotals };

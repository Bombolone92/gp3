/** Change several tickets at once from a view. */
import { h, uid } from '../ui/dom.js';
import { openDialog } from '../ui/dialog.js';
import { selectField, tagsInput, field } from '../ui/components.js';
import { toast, toastError } from '../ui/toast.js';
import { plural } from '../ui/format.js';
import { app } from '../app.js';
import { statusOptions, priorityOptions, typeOptions, assigneeOptions, splitAssignee } from './options.js';

const KEEP = '__keep__';

export function bulkEditDialog(ids, done) {
  const keep = { value: KEEP, label: 'No change' };
  const state = { status: KEEP, priority: KEEP, type: KEEP, assignee: KEEP, addTags: [], removeTags: [] };
  const mk = (key, opts) => selectField({ id: uid(key), value: KEEP, options: () => [keep, ...opts()], onChange: (v) => { state[key] = v; } });
  const status = mk('status', statusOptions);
  const priority = mk('priority', priorityOptions);
  const type = mk('type', typeOptions);
  const assignee = mk('assignee', assigneeOptions);
  const tagSuggest = () => [...new Set([...app.replica.tickets.values()].flatMap((t) => t.tags || []))].sort();
  const add = tagsInput({ id: uid('add'), onChange: (v) => { state.addTags = v; }, suggestions: tagSuggest, label: 'Add tags' });
  const remove = tagsInput({ id: uid('rm'), onChange: (v) => { state.removeTags = v; }, suggestions: tagSuggest, label: 'Remove tags' });
  openDialog({
    title: `Edit ${plural(ids.length, 'ticket')}`,
    description: 'Only the fields you change are updated.',
    body: h('div.form-grid',
      field('Status', status), field('Priority', priority), field('Type', type), field('Assignee', assignee),
      field('Add tags', add), field('Remove tags', remove)),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Update tickets', primary: true,
        run: async () => {
          const base = {};
          if (state.status !== KEEP) base.status = state.status;
          if (state.priority !== KEEP) base.priority = state.priority;
          if (state.type !== KEEP) base.type = state.type;
          if (state.assignee !== KEEP) Object.assign(base, splitAssignee(state.assignee));
          const tagsChange = state.addTags.length || state.removeTags.length;
          if (!Object.keys(base).length && !tagsChange) return true;
          let failed = 0;
          try {
            if (tagsChange) {
              // Tags differ per ticket, so each ticket gets its own list. One
              // that cannot change (a closed ticket) does not stop the rest.
              let first = null;
              for (const id of ids) {
                const t = app.replica.tickets.get(id);
                const tags = [...new Set([...(t?.tags || []), ...state.addTags])].filter((x) => !state.removeTags.includes(x));
                try {
                  await app.updateTicket(id, { patch: { ...base, tags } });
                } catch (e) {
                  failed++;
                  first ||= e;
                }
              }
              if (failed) toastError({ message: `${plural(failed, 'ticket')} could not be updated: ${first.message}` });
            } else {
              // app.bulk reports the tickets that failed.
              const res = await app.bulk(ids, { patch: base });
              failed = (res.results || []).filter((r) => r.error).length;
            }
          } catch (e) {
            toastError(e);
            return false;
          }
          // Nothing changed: stay open to try again.
          if (failed === ids.length) return false;
          toast(`${plural(ids.length - failed, 'ticket')} updated.`, { kind: 'success' });
          done?.();
          return true;
        },
      },
    ],
  });
}

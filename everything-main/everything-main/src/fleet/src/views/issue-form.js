import { formPage } from '../ui/form.js';
import { app, lookup, myName } from '../app.js';
import { navigate, back } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { ISSUE_PRIORITIES } from '../core/status.js';
import { createIssue, recordMeter } from '../core/actions.js';
import { options, emptyPage, meterUnitLabel } from './common.js';

export function render(ctx) {
  const store = app.store;
  const existing = ctx.params.id ? store.get('issues', ctx.params.id) : null;
  if (ctx.params.id && !existing) return emptyPage('Issue not found', 'It may have been deleted.');
  const rec = existing || { vehicleId: ctx.query.vehicle || null, priority: 'none', reportedDate: app.today(), reportedBy: myName(), labels: [] };
  // The unit of the vehicle chosen in the form, not the one it opened with.
  const unit = (vals) => meterUnitLabel(lookup.vehicle(vals?.vehicleId ?? rec.vehicleId));
  const page = formPage({
    title: existing ? `Edit issue #${existing.number}` : 'New issue',
    crumbs: [{ label: 'Issues', href: '#/issues' }, existing ? { label: `#${existing.number}`, href: `#/issues/${existing.id}` } : { label: 'New' }],
    record: rec,
    saveLabel: existing ? 'Save issue' : 'Add issue',
    sections: [
      {
        id: 'details',
        title: 'Details',
        fields: [
          { id: 'vehicleId', label: 'Vehicle', type: 'picker', required: true, options: options.vehicles({ keep: rec.vehicleId }), span: 2 },
          { id: 'summary', label: 'Summary', required: true, placeholder: 'e.g. Brake light out', span: 2, maxlength: 140 },
          { id: 'description', label: 'Description', type: 'textarea', span: 2, rows: 4 },
          { id: 'priority', label: 'Priority', type: 'select', required: true, options: () => ISSUE_PRIORITIES.map((p) => ({ value: p.id, label: p.label })) },
          { id: 'labels', label: 'Labels', type: 'tags', options: () => [...new Set(store.all('issues').flatMap((i) => i.labels || []))] },
          { id: 'reportedDate', label: 'Reported on', type: 'date', required: true },
          { id: 'reportedBy', label: 'Reported by' },
          { id: 'meter', label: 'Meter at report', type: 'number', min: 0, unit, hint: 'Optional. Recorded as a meter reading.' },
        ],
      },
      {
        id: 'assignment',
        title: 'Assignment and due date',
        fields: [
          { id: 'assigneeId', label: 'Assigned to', type: 'picker', options: options.contacts(null, rec.assigneeId), placeholder: 'Unassigned', span: 2 },
          { id: 'dueDate', label: 'Due date', type: 'date' },
          { id: 'dueMeter', label: 'Due at meter', type: 'number', min: 0, unit },
        ],
      },
    ],
    onCancel: () => back(existing ? `/issues/${existing.id}` : '/issues'),
    onSave: async (v) => {
      // Build on the stored record, not the one the form opened with: files
      // and other changes may have arrived meanwhile.
      const cur = existing && store.get('issues', existing.id);
      if (existing && !cur) {
        toast('This issue was deleted, so the changes were not saved.', { type: 'error' });
        return false;
      }
      const data = { ...v, assigneeId: v.assigneeId || null, dueDate: v.dueDate || null };
      let saved;
      if (existing) saved = store.put('issues', { ...cur, ...data });
      else saved = await createIssue(store, data);
      // A cleared meter removes the reading this issue recorded.
      if (v.meter != null || existing) recordMeter(store, { vehicleId: v.vehicleId, value: v.meter, date: v.reportedDate, source: { type: 'issue', id: saved.id } });
      page.form.markClean();
      toast(existing ? 'Issue saved' : `Issue #${saved.number} added`);
      navigate(`/issues/${saved.id}`, { replace: !existing });
    },
  });
  return { node: page.node, title: existing ? 'Edit issue' : 'New issue', dirty: () => page.form.dirty() };
}

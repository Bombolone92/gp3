import { formPage } from '../ui/form.js';
import { app, canEdit } from '../app.js';
import { navigate, back } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { contactName } from '../core/format.js';
import { options, emptyPage, noPermissionPage } from './common.js';

export function render(ctx) {
  const store = app.store;
  const existing = ctx.params.id ? store.get('contacts', ctx.params.id) : null;
  if (ctx.params.id && !existing) return emptyPage('Contact not found', 'It may have been deleted.');
  if (!canEdit('contacts')) return noPermissionPage('contacts');
  const rec = existing ? { ...existing, licenseNumber: existing.license?.number, licenseClass: existing.license?.class, licenseState: existing.license?.state } : { roles: ['operator', 'employee'] };
  const page = formPage({
    title: existing ? `Edit ${contactName(existing)}` : 'New contact',
    crumbs: [{ label: 'Contacts', href: '#/contacts' }, { label: existing ? contactName(existing) : 'New' }],
    record: rec,
    saveLabel: existing ? 'Save contact' : 'Add contact',
    sections: [
      {
        id: 'basic',
        title: 'Basic details',
        fields: [
          { id: 'firstName', label: 'First name', required: true, autocomplete: 'given-name' },
          { id: 'lastName', label: 'Last name', autocomplete: 'family-name' },
          { id: 'email', label: 'Email', inputType: 'email', autocomplete: 'email', validate: (v) => (v && !/^\S+@\S+\.\S+$/.test(v) ? 'Enter a valid email address.' : null) },
          { id: 'phone', label: 'Phone', inputType: 'tel', autocomplete: 'tel' },
          { id: 'roles', label: 'Roles', type: 'multipicker', options: options.roles(), span: 2, hint: 'Operators can be assigned vehicles; technicians can be assigned work orders.' },
          { id: 'groupId', label: 'Group', type: 'picker', options: options.groups(), placeholder: 'No group' },
          { id: 'jobTitle', label: 'Job title' },
        ],
      },
      {
        id: 'employment',
        title: 'Employment',
        fields: [
          { id: 'employeeNumber', label: 'Employee number' },
          { id: 'hourlyRate', label: 'Labor rate per hour', type: 'money', hint: 'Used as the default labor rate on work orders.' },
          { id: 'startDate', label: 'Start date', type: 'date' },
          { id: 'leaveDate', label: 'Leave date', type: 'date', validate: (v, vals) => (v && vals.startDate && v < vals.startDate ? 'The leave date must be on or after the start date.' : null) },
        ],
      },
      {
        id: 'license',
        title: 'Driver license',
        intro: 'Track the expiry under Contact renewals to get reminded before it lapses.',
        fields: [
          { id: 'licenseNumber', label: 'License number' },
          { id: 'licenseClass', label: 'Class' },
          { id: 'licenseState', label: 'Issuing state or province' },
        ],
      },
      { id: 'notes', title: 'Notes', fields: [{ id: 'notes', label: 'Notes', type: 'textarea', span: 2, rows: 3 }] },
    ],
    onCancel: () => back(existing ? `/contacts/${existing.id}` : '/contacts'),
    onSave: (v) => {
      const { licenseNumber, licenseClass, licenseState, ...rest } = v;
      const cur = existing && store.get('contacts', existing.id);
      if (existing && !cur) {
        toast('This contact was deleted, so the changes were not saved.', { type: 'error' });
        return false;
      }
      const saved = store.put('contacts', { ...(cur || { archived: false, attachments: [] }), ...rest, groupId: v.groupId || null, license: licenseNumber || licenseClass || licenseState ? { number: licenseNumber, class: licenseClass, state: licenseState } : null });
      page.form.markClean();
      toast(existing ? 'Contact saved' : 'Contact added');
      navigate(`/contacts/${saved.id}`, { replace: !existing });
    },
  });
  return { node: page.node, title: existing ? 'Edit contact' : 'New contact', dirty: () => page.form.dirty() };
}

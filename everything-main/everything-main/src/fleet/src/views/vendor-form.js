import { formPage } from '../ui/form.js';
import { app, canEdit } from '../app.js';
import { navigate, back } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { VENDOR_KINDS } from '../core/status.js';
import { emptyPage, noPermissionPage } from './common.js';

export function render(ctx) {
  const store = app.store;
  const existing = ctx.params.id ? store.get('vendors', ctx.params.id) : null;
  if (ctx.params.id && !existing) return emptyPage('Vendor not found', 'It may have been deleted.');
  if (!canEdit('vendors')) return noPermissionPage('vendors');
  const page = formPage({
    title: existing ? `Edit ${existing.name}` : 'New vendor',
    crumbs: [{ label: 'Vendors', href: '#/vendors' }, { label: existing ? existing.name : 'New' }],
    record: existing || { kinds: ['service'] },
    saveLabel: existing ? 'Save vendor' : 'Add vendor',
    sections: [
      {
        id: 'vendor',
        title: 'Vendor',
        fields: [
          { id: 'name', label: 'Name', required: true, span: 2 },
          { id: 'kinds', label: 'Classification', type: 'multipicker', span: 2, options: () => VENDOR_KINDS.map((k) => ({ value: k.id, label: k.label })) },
          { id: 'contactName', label: 'Contact person' },
          { id: 'phone', label: 'Phone', inputType: 'tel' },
          { id: 'email', label: 'Email', inputType: 'email', validate: (v) => (v && !/^\S+@\S+\.\S+$/.test(v) ? 'Enter a valid email address.' : null) },
          { id: 'website', label: 'Website', inputType: 'url', placeholder: 'https://' },
          { id: 'address', label: 'Address', type: 'textarea', rows: 2, span: 2 },
          { id: 'accountNumber', label: 'Account number' },
          { id: 'notes', label: 'Notes', type: 'textarea', rows: 2, span: 2 },
        ],
      },
    ],
    onCancel: () => back(existing ? `/vendors/${existing.id}` : '/vendors'),
    onSave: (v) => {
      const cur = existing && store.get('vendors', existing.id);
      if (existing && !cur) {
        toast('This vendor was deleted, so the changes were not saved.', { type: 'error' });
        return false;
      }
      const saved = store.put('vendors', { ...(cur || { archived: false, attachments: [] }), ...v });
      page.form.markClean();
      toast(existing ? 'Vendor saved' : 'Vendor added');
      navigate(`/vendors/${saved.id}`, { replace: !existing });
    },
  });
  return { node: page.node, title: existing ? 'Edit vendor' : 'New vendor', dirty: () => page.form.dirty() };
}

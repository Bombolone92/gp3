import { h, uid } from '../ui/dom.js';
import { openDialog } from '../ui/dialog.js';
import { createEditor } from '../ui/editor.js';
import { toast, toastError } from '../ui/toast.js';
import { app } from '../app.js';

/** Edit your display name and reply signature on this help desk. */
export function profileDialog() {
  const me = app.me;
  const nameId = uid('name');
  const name = h(`input#${nameId}.input`, { value: me?.name || '', maxlength: 80, autocomplete: 'name' });
  const sig = createEditor({ label: 'Signature', placeholder: 'Added to the end of your public replies (optional)', minHeight: 70 });
  sig.setHtml(me?.signature || '');
  openDialog({
    title: 'Your profile',
    description: 'How you appear to teammates and customers on this help desk.',
    body: h('div.stack',
      h('div.field', h('label.field-label', { for: nameId }, 'Display name'), name),
      h('div.field', h('span.field-label', 'Signature'), sig.el)),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save', primary: true,
        run: async () => {
          if (!name.value.trim()) {
            name.setAttribute('aria-invalid', 'true');
            name.focus();
            return false;
          }
          try {
            const res = await app.api.post(`/members/${me.uuid}`, { name: name.value.trim(), signature: sig.getHtml() });
            app.replica.setMembers({ ...app.replica.members, [me.uuid]: res.member });
            toast('Profile saved', { kind: 'success' });
            return true;
          } catch (e) {
            toastError(e);
            return false;
          }
        },
      },
    ],
  });
}

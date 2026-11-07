import { el } from './dom.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { field, textInput, formSnapshot } from './bits.js';

/**
 * Create/edit a contact in a sheet. openContactForm({ contact?, onSaved? })
 * Resolves through onSaved(contact) so callers (e.g. the contract form's
 * inline "New contact") can pick up the result.
 */
export function openContactForm({ contact = null, onSaved = null } = {}) {
  const isEdit = !!contact;

  const name = textInput({ value: contact?.name || '', required: true, autocomplete: 'off', maxLength: 80 });
  const company = textInput({ value: contact?.company || '', autocomplete: 'organization', maxLength: 80 });
  const role = textInput({ value: contact?.role || '', maxLength: 80 });
  const email = textInput({ value: contact?.email || '', type: 'email', autocomplete: 'off', inputmode: 'email' });
  const phone = textInput({ value: contact?.phone || '', type: 'tel', autocomplete: 'off', inputmode: 'tel' });
  const notes = el('textarea.input', { rows: 3, maxLength: 2000 }, contact?.notes || '');

  const save = el('button.btn.btn-primary.btn-block', { type: 'submit' },
    isEdit ? 'Save changes' : 'Add contact');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      save.disabled = true;
      const data = {
        name: name.value, company: company.value, role: role.value,
        email: email.value, phone: phone.value, notes: notes.value,
      };
      try {
        const saved = isEdit
          ? await store.updateContact(contact.id, data)
          : await store.addContact(data);
        modal.close();
        toast(isEdit ? 'Contact updated' : 'Contact added');
        onSaved?.(saved);
      } catch (err) {
        console.error(err);
        save.disabled = false;
        toast('Could not save. Check your connection', { icon: 'wifiOff' });
      }
    },
  },
    field('Name', name),
    el('div.field-row', {},
      field('Company', company, { grow: true }),
      field('Role', role, { grow: true })
    ),
    el('div.field-row', {},
      field('Email', email, { grow: true }),
      field('Phone', phone, { grow: true })
    ),
    field('Notes', notes),
    save
  );

  const initial = formSnapshot(form);
  const modal = openModal({
    title: isEdit ? 'Edit contact' : 'New contact',
    content: form,
    beforeClose: () => formSnapshot(form) === initial || confirmDialog({
      title: 'Discard changes?',
      message: isEdit
        ? 'Your unsaved edits to this contact will be lost.'
        : 'This contact has not been saved yet.',
      confirmLabel: 'Discard',
    }),
  });
  return modal;
}

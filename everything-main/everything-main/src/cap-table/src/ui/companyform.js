/**
 * Creating a company slot: a serial founder's next venture, a holding
 * company, a spun-out subsidiary. One name field; everything else is the
 * normal setup flow inside the new, empty cap table.
 */

import { el } from './dom.js';
import { field, flagInvalid } from './bits.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';

export function openNewCompanyForm({ onCreated = null } = {}) {
  const nameInput = el('input.input', {
    type: 'text', placeholder: 'Acme Robotics, Inc.', maxlength: 120, 'aria-label': 'Company name',
  });
  const saveBtn = el('button.btn.btn-primary.btn-block', { type: 'submit', style: { padding: '12px' } },
    'Create company');
  /* The slot is created and activated on the first attempt; if naming it
     fails, a retry must finish the naming, not mint another company. */
  let created = false;
  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      /* Refused, as the profile and onboarding sheets refuse it: an empty
         submit created and switched to a company called nothing, and the
         switcher listed it as "Untitled company". */
      if (!name) {
        flagInvalid(nameInput, 'Give the company a name');
        nameInput.focus();
        toast('Give the company a name', { icon: 'alert' });
        return;
      }
      saveBtn.disabled = true;
      try {
        if (!created) {
          await store.createCompany(name);
          created = true;
        }
        if (name) {
          await store.updateCompany({ name });
        }
        toast('Company created');
        modal.close();
        onCreated?.();
      } catch (err) {
        console.error(err);
        toast(created
          ? 'The company was created but not named. Retry to finish naming it'
          : 'Couldn’t create. Check your connection', { icon: 'wifiOff' });
        saveBtn.disabled = false;
      }
    },
  },
    el('p.confirm-message', {},
      'A new, empty cap table under the same Puter account. Everything stays scoped per company; nothing is shared between them.'),
    field('Company name', nameInput),
    saveBtn);
  /* Focus is the dialog's to place, as on every other sheet: the name field
     on a pointer-width screen, the dialog itself on a phone, where focusing a
     text box throws the keyboard over the sheet. Focusing the field here as
     well put the keyboard up and then, a microtask later when the dialog took
     focus back, straight down again. */
  const modal = openModal({ title: 'New company', content: form });
}

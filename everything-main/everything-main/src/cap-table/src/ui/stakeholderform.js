/**
 * Add or edit a stakeholder. Lives in ui/ rather than beside the list view
 * so both the list and the per-holder detail can open it without the two
 * views importing each other.
 */

import { el } from './dom.js';
import { field, flagInvalid, holderNamed } from './bits.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store, isRefusal } from '../lib/store.js';
import { STAKEHOLDER_KINDS, stakeholderKindInfo, EMAIL_MAX } from '../lib/captable.js';

export function openStakeholderForm(existing = null) {
  const nameInput = el('input.input', {
    type: 'text', value: existing?.name || '', placeholder: 'Full name or entity',
    maxlength: 120, required: true, 'aria-label': 'Name',
  });
  /* "Optional" belongs in the hint, not the placeholder: a placeholder is
     gone the moment the field has anything in it, so the one time it was
     being read - by someone who had already started typing and was wondering
     whether they had to finish - it wasn't there. Every other optional field
     in the app says so in its hint. */
  const emailInput = el('input.input', {
    type: 'email', value: existing?.email || '', placeholder: 'name@example.com',
    maxlength: EMAIL_MAX, 'aria-label': 'Email',
  });
  /* Said, not refused: this sheet is where a genuine namesake is added on
     purpose (the inline new-holder paths refuse one). But the activity feed
     finds a holder's lines by name, so two holders under one name read each
     other's history, and nothing here mentioned the name was taken. */
  // A status region, since it appears as the name is typed; field() links only a plain hint, so the link is made below.
  const twinHint = el('p.field-hint.warn', { role: 'status', hidden: true });
  const syncTwin = () => {
    const twin = holderNamed(nameInput.value, store.stakeholders.filter((h) => h.id !== existing?.id));
    twinHint.hidden = !twin;
    twinHint.textContent = twin
      ? `${twin.name} is already on the cap table. A second holder under the same name is kept apart everywhere `
        + 'except the activity feed, which reads its lines by name.'
      : '';
  };
  nameInput.addEventListener('input', syncTwin);
  syncTwin();
  const kindSelect = el('select.select', { 'aria-label': 'Type' },
    STAKEHOLDER_KINDS.map((k) => el('option', {
      value: k.value, selected: k.value === (existing?.kind || 'employee'),
    }, k.label)));

  const saveBtn = el('button.btn.btn-primary.btn-block', { type: 'submit', style: { padding: '12px' } },
    existing ? 'Save changes' : 'Add stakeholder');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (!name) {
        /* Said, as every other refusal here is: `required` catches the empty
           box with the browser's own bubble, but a box holding only spaces
           satisfies it and landed here, where a red border was the whole
           answer. */
        flagInvalid(nameInput);
        nameInput.focus();
        toast('Give the stakeholder a name', { icon: 'alert' });
        return;
      }
      saveBtn.disabled = true;
      const input = { name, email: emailInput.value.trim(), kind: kindSelect.value };
      try {
        if (existing) {
          await store.updateStakeholder(existing.id, input);
          toast('Stakeholder updated');
        } else {
          await store.addStakeholder(input);
          store.logActivity(`${name} added as ${stakeholderKindInfo(input.kind).label.toLowerCase()}`, 'users');
          toast('Stakeholder added');
        }
        modal.close();
      } catch (err) {
        console.error(err);
        // A record gone meanwhile is a refusal in the store's words, not a
        // connection problem - see isRefusal.
        toast(isRefusal(err) ? err.message : 'Couldn’t save. Check your connection',
          { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
        saveBtn.disabled = false;
      }
    },
  },
    field('Name', nameInput, twinHint),
    el('div.form-grid', {},
      field('Type', el('div.select-wrap', {}, kindSelect)),
      field('Email', emailInput, 'Optional')),
    saveBtn
  );
  twinHint.id = `${nameInput.id}-hint`;
  nameInput.setAttribute('aria-describedby', twinHint.id);

  const modal = openModal({
    title: existing ? `Edit ${existing.name}` : 'Add stakeholder',
    content: form,
  });
}

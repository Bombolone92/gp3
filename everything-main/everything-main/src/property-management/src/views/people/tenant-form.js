/** Create or edit a tenant. `?leaseId=` adds the new tenant to that lease. */
import { h } from '../../ui/dom.js';
import { app, lookup } from '../../app.js';
import { pageHeader, field, textInput, textarea, emptyState } from '../../ui/components.js';
import { navigate } from '../../ui/router.js';
import { toast } from '../../ui/toast.js';
import { personName } from '../../core/format.js';
import { newId } from '../../core/ids.js';
import { listEditor } from '../common.js';
import { rowsEditor, cleanRows, safeNext } from './form-parts.js';

export function render(ctx) {
  const store = app.store;
  const existing = ctx.params.id ? store.get('tenants', ctx.params.id) : null;
  if (ctx.params.id && !existing) {
    return h('div.page', emptyState({ icon: 'users', title: 'Tenant not found', text: 'This tenant may have been deleted.', headingLevel: 1, actions: [h('a.btn.primary', { href: '#/tenants' }, 'Back to tenants')] }));
  }
  const lease = !existing && ctx.query.leaseId ? store.get('leases', ctx.query.leaseId) : null;
  const draft = existing ? structuredClone(existing) : { firstName: '', lastName: '', company: '', emails: [], phones: [], dob: '', emergency: {}, vehicles: [], pets: [] };
  draft.emergency ??= {};
  draft.vehicles = [...(draft.vehicles || [])];
  draft.pets = [...(draft.pets || [])];
  let saved = false;

  const first = textInput({ name: 'firstName', value: draft.firstName, autocomplete: 'off', autofocus: !existing || null });
  const last = textInput({ name: 'lastName', value: draft.lastName, autocomplete: 'off' });
  const company = textInput({ name: 'company', value: draft.company, autocomplete: 'off' });
  const dob = textInput({ name: 'dob', type: 'date', value: draft.dob || '' });
  const emails = listEditor({ values: draft.emails || [], type: 'email', label: 'Email', addLabel: 'Add email' });
  const phones = listEditor({ values: draft.phones || [], type: 'tel', label: 'Phone', addLabel: 'Add phone' });
  const eName = textInput({ value: draft.emergency.name || '' });
  const ePhone = textInput({ type: 'tel', value: draft.emergency.phone || '' });
  const eRel = textInput({ value: draft.emergency.relation || '', placeholder: 'e.g. Parent' });
  const note = existing ? null : textarea({ rows: 3, placeholder: 'Anything your team should know' });
  const nameError = h('span.error-text', { role: 'alert', hidden: true }, 'Enter a first name, last name or company.');

  const personal = h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Tenant')),
    h(
      'div.card-body.stack',
      h('div.form-grid', field('First name', first), field('Last name', last), field('Company', company, { hint: 'For commercial tenants' }), field('Date of birth', dob)),
      nameError,
    ),
  );
  const contact = h('section.card', h('div.card-head', h('h2.grow', 'Contact')), h('div.card-body.form-grid', field('Email', emails), field('Phone', phones)));
  const emergency = h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Emergency contact')),
    h('div.card-body.form-grid', field('Name', eName), field('Phone', ePhone), field('Relationship', eRel)),
  );
  const extras = h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Vehicles and pets')),
    h(
      'div.card-body.stack',
      h('div', h('div.field-label', 'Vehicles'), rowsEditor(draft.vehicles, [{ key: 'make', label: 'Make' }, { key: 'model', label: 'Model' }, { key: 'color', label: 'Color' }, { key: 'plate', label: 'Plate' }], { noun: 'vehicle', addLabel: 'Add vehicle' })),
      h('div', h('div.field-label', 'Pets'), rowsEditor(draft.pets, [{ key: 'name', label: 'Name' }, { key: 'type', label: 'Type', placeholder: 'e.g. Dog' }, { key: 'notes', label: 'Notes' }], { noun: 'pet', addLabel: 'Add pet' })),
    ),
  );
  const notesCard = note ? h('section.card', h('div.card-head', h('h2.grow', 'Note')), h('div.card-body', field('Internal note', note, { hint: 'Only visible to your team' }))) : null;

  const back = existing ? `#/tenants/${existing.id}` : lease ? `#/leases/${lease.id}` : '#/tenants';
  const form = h(
    'form.rn-form',
    { novalidate: true },
    lease ? h('div.notice.accent', h('span', `This tenant will be added to the lease for ${lookup.leaseLabel(lease)}.`)) : null,
    h('div.rn-form-cols', h('div.stack', personal, contact, notesCard), h('div.stack', emergency, extras)),
    h('div.rn-form-actions', h('div.spacer'), h('a.btn', { href: back }, 'Cancel'), h('button.btn.primary', { type: 'submit' }, existing ? 'Save changes' : lease ? 'Add tenant to lease' : 'Save tenant')),
  );

  const snapshot = () => JSON.stringify([first.value, last.value, company.value, dob.value, emails.values, phones.values, eName.value, ePhone.value, eRel.value, draft.vehicles, draft.pets, note?.value]);
  const initial = snapshot();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!first.value.trim() && !last.value.trim() && !company.value.trim()) {
      nameError.hidden = false;
      first.setAttribute('aria-invalid', 'true');
      first.focus();
      return;
    }
    const emergencyRec = { name: eName.value.trim(), phone: ePhone.value.trim(), relation: eRel.value.trim() };
    const rec = {
      ...draft,
      firstName: first.value.trim(),
      lastName: last.value.trim(),
      company: company.value.trim(),
      dob: dob.value || '',
      emails: emails.values,
      phones: phones.values,
      emergency: Object.values(emergencyRec).some(Boolean) ? emergencyRec : {},
      vehicles: cleanRows(draft.vehicles),
      pets: cleanRows(draft.pets),
    };
    if (note?.value.trim()) rec.notes = [{ id: newId(), text: note.value.trim(), at: new Date().toISOString(), by: app.user?.username || '' }];
    const t = store.put('tenants', rec);
    if (lease && !(lease.tenantIds || []).includes(t.id)) store.patch('leases', lease.id, (l) => ((l.tenantIds = [...(l.tenantIds || []), t.id]), l));
    saved = true;
    toast(existing ? 'Tenant saved' : lease ? `${personName(t)} added to the lease` : `${personName(t)} added`);
    const next = safeNext(ctx.query.next);
    if (next) navigate(`${next}${next.includes('?') ? '&' : '?'}tenantId=${t.id}`);
    else navigate(lease ? `/leases/${lease.id}` : `/tenants/${t.id}`);
  });

  const title = existing ? `Edit ${personName(existing)}` : 'New tenant';
  return {
    node: h('div.page', pageHeader({ title, crumbs: [{ label: 'Tenants', href: '#/tenants' }, ...(existing ? [{ label: personName(existing), href: `#/tenants/${existing.id}` }] : [])] }), form),
    title,
    dirty: () => !saved && snapshot() !== initial,
  };
}

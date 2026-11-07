/** Create or edit a rental owner. `?next=` returns to the page that asked (e.g. a property form). */
import { h } from '../../ui/dom.js';
import { app } from '../../app.js';
import { pageHeader, field, textInput, textarea, segmented, emptyState } from '../../ui/components.js';
import { formDialog } from '../../ui/dialog.js';
import { navigate } from '../../ui/router.js';
import { toast } from '../../ui/toast.js';
import { displayName } from '../../core/format.js';
import { newId } from '../../core/ids.js';
import { listEditor, addressFields } from '../common.js';
import { safeNext } from './form-parts.js';

export function render(ctx) {
  const store = app.store;
  const existing = ctx.params.id ? store.get('owners', ctx.params.id) : null;
  if (ctx.params.id && !existing) {
    return h('div.page', emptyState({ icon: 'briefcase', title: 'Owner not found', text: 'This owner may have been deleted.', headingLevel: 1, actions: [h('a.btn.primary', { href: '#/owners' }, 'Back to rental owners')] }));
  }
  const draft = existing ? structuredClone(existing) : { kind: 'person', firstName: '', lastName: '', company: '', emails: [], phones: [], address: {}, managementFee: '', agreementStart: '', agreementEnd: '' };
  let kind = draft.kind || 'person';
  let saved = false;

  const first = textInput({ value: draft.firstName || '', autofocus: !existing || null });
  const last = textInput({ value: draft.lastName || '' });
  const company = textInput({ value: draft.company || '', autocomplete: 'organization' });
  const emails = listEditor({ values: draft.emails || [], type: 'email', label: 'Email', addLabel: 'Add email' });
  const phones = listEditor({ values: draft.phones || [], type: 'tel', label: 'Phone', addLabel: 'Add phone' });
  const addr = addressFields(draft.address || {});
  const fee = textInput({ type: 'number', min: 0, max: 100, step: 'any', value: draft.managementFee ?? '', cls: 'num' });
  const aStart = textInput({ type: 'date', value: draft.agreementStart || '' });
  const aEnd = textInput({ type: 'date', value: draft.agreementEnd || '' });
  const note = existing ? null : textarea({ rows: 3, placeholder: 'Anything your team should know' });
  const nameError = h('span.error-text', { role: 'alert', hidden: true }, 'Enter a name or company.');

  const companyField = field('Company name', company);
  const nameGrid = h('div.form-grid');
  const paintKind = () => {
    nameGrid.replaceChildren(
      ...(kind === 'company' ? [h('div.span-2', companyField), field('Contact first name', first), field('Contact last name', last)] : [field('First name', first), field('Last name', last), h('div.span-2', field('Company (optional)', company))]),
    );
  };
  paintKind();

  const who = h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Owner')),
    h(
      'div.card-body.stack',
      segmented({
        label: 'Owner type',
        value: kind,
        items: [
          { value: 'person', label: 'Individual', icon: 'user' },
          { value: 'company', label: 'Company', icon: 'building' },
        ],
        onChange: (v) => {
          kind = v;
          paintKind();
        },
      }),
      nameGrid,
      nameError,
    ),
  );
  const contact = h('section.card', h('div.card-head', h('h2.grow', 'Contact')), h('div.card-body.stack', h('div.form-grid', field('Email', emails), field('Phone', phones)), h('div.form-grid', ...addr.node)));
  const agreement = h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Management agreement')),
    h('div.card-body.form-grid', withSuffix(field('Management fee', fee, { hint: 'Percent of rent collected' }), fee, '%'), h('div'), field('Agreement start', aStart), field('Agreement end', aEnd)),
  );
  const noteCard = note ? h('section.card', h('div.card-head', h('h2.grow', 'Note')), h('div.card-body', field('Internal note', note, { hint: 'Only visible to your team' }))) : null;

  const next = safeNext(ctx.query.next);
  const back = existing ? `#/owners/${existing.id}` : next ? `#${next}` : '#/owners';
  const form = h(
    'form.rn-form',
    { novalidate: true },
    h('div.rn-form-cols', h('div.stack', who, contact), h('div.stack', agreement, noteCard)),
    h('div.rn-form-actions', h('div.spacer'), h('a.btn', { href: back }, 'Cancel'), h('button.btn.primary', { type: 'submit' }, existing ? 'Save changes' : 'Save owner')),
  );

  const snapshot = () => JSON.stringify([kind, first.value, last.value, company.value, emails.values, phones.values, addr.value(), fee.value, aStart.value, aEnd.value, note?.value]);
  const initial = snapshot();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const needCompany = kind === 'company';
    if (needCompany ? !company.value.trim() : !first.value.trim() && !last.value.trim() && !company.value.trim()) {
      nameError.textContent = needCompany ? 'Enter the company name.' : 'Enter a name.';
      nameError.hidden = false;
      (needCompany ? company : first).setAttribute('aria-invalid', 'true');
      (needCompany ? company : first).focus();
      return;
    }
    if (aStart.value && aEnd.value && aEnd.value < aStart.value) {
      toast('The agreement cannot end before it starts.', { type: 'error' });
      aEnd.focus();
      return;
    }
    const rec = {
      ...draft,
      kind,
      firstName: first.value.trim(),
      lastName: last.value.trim(),
      company: company.value.trim(),
      emails: emails.values,
      phones: phones.values,
      address: addr.value(),
      managementFee: fee.value === '' ? null : Math.max(0, Math.min(100, Number(fee.value) || 0)),
      agreementStart: aStart.value || '',
      agreementEnd: aEnd.value || '',
    };
    if (note?.value.trim()) rec.notes = [{ id: newId(), text: note.value.trim(), at: new Date().toISOString(), by: app.user?.username || '' }];
    const o = store.put('owners', rec);
    saved = true;
    toast(existing ? 'Owner saved' : `${displayName(o)} added`);
    if (next) navigate(`${next}${next.includes('?') ? '&' : '?'}ownerId=${o.id}`);
    else navigate(`/owners/${o.id}`);
  });

  const title = existing ? `Edit ${displayName(existing)}` : 'New rental owner';
  return {
    node: h('div.page', pageHeader({ title, crumbs: [{ label: 'Rental owners', href: '#/owners' }, ...(existing ? [{ label: displayName(existing), href: `#/owners/${existing.id}` }] : [])] }), form),
    title,
    dirty: () => !saved && snapshot() !== initial,
  };
}

/** Put a unit label ("%") after an input that is already inside a field. */
export function withSuffix(fieldNode, input, suffix) {
  const wrap = h('div.input-affix.rn-suffix');
  input.replaceWith(wrap);
  wrap.append(input, h('span.affix-end', { 'aria-hidden': 'true' }, suffix));
  return fieldNode;
}

/** Add a rental owner without leaving the current form. Resolves the owner or null. */
export async function quickOwnerDialog() {
  let created = null;
  await formDialog({
    title: 'New rental owner',
    submitLabel: 'Add owner',
    body: h(
      'div.form-grid',
      field('First name', textInput({ name: 'firstName' })),
      field('Last name', textInput({ name: 'lastName' })),
      field('Company', textInput({ name: 'company', autocomplete: 'organization' }), { span2: true, hint: 'Leave the names blank for a company owner' }),
      field('Email', textInput({ name: 'email', type: 'email' })),
      field('Phone', textInput({ name: 'phone', type: 'tel' })),
    ),
    onSubmit: (fd, form) => {
      const g = (k) => String(fd.get(k) || '').trim();
      if (!g('firstName') && !g('lastName') && !g('company')) {
        form.querySelector('[name=firstName]').setAttribute('aria-invalid', 'true');
        form.querySelector('[name=firstName]').focus();
        toast('Enter a name or company.', { type: 'error' });
        return false;
      }
      created = app.store.put('owners', {
        kind: !g('firstName') && !g('lastName') ? 'company' : 'person',
        firstName: g('firstName'),
        lastName: g('lastName'),
        company: g('company'),
        emails: g('email') ? [g('email')] : [],
        phones: g('phone') ? [g('phone')] : [],
        address: {},
      });
      toast(`${displayName(created)} added`);
      return created;
    },
  });
  return created;
}

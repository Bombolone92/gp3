/** New and edit applicant. */
import { h } from '../../ui/dom.js';
import { app, lookup } from '../../app.js';
import { pageHeader, field, textInput, select, moneyInput, emptyState } from '../../ui/components.js';
import { navigate } from '../../ui/router.js';
import { toast } from '../../ui/toast.js';
import { propertyUnitFields } from '../common.js';
import { personName } from '../../core/format.js';

export function render(ctx) {
  const store = app.store;
  const existing = ctx.params.id ? store.get('applicants', ctx.params.id) : null;
  if (ctx.params.id && !existing) {
    return h('div.page', emptyState({ icon: 'contact', title: 'Applicant not found', headingLevel: 1, text: 'It may have been deleted.', actions: [h('a.btn.primary', { href: '#/applicants' }, 'Back to applicants')] }));
  }
  const unit0 = ctx.query.unitId ? lookup.unit(ctx.query.unitId) : null;
  const a = existing || { status: 'new', appliedOn: app.today(), propertyId: unit0?.propertyId || '', unitId: unit0?.id || '' };
  let saved = false;

  const first = textInput({ name: 'firstName', value: a.firstName, autocomplete: 'given-name' });
  const last = textInput({ name: 'lastName', value: a.lastName, autocomplete: 'family-name' });
  const email = textInput({ name: 'email', type: 'email', value: a.email, autocomplete: 'email' });
  const phone = textInput({ name: 'phone', type: 'tel', value: a.phone, autocomplete: 'tel' });
  const place = propertyUnitFields({ propertyId: a.propertyId || '', unitId: a.unitId || '', unitEmpty: 'Any unit' });
  const applied = textInput({ name: 'appliedOn', type: 'date', value: a.appliedOn || app.today() });
  const moveIn = textInput({ name: 'moveIn', type: 'date', value: a.moveIn || '' });
  const income = moneyInput({ name: 'income', cents: a.income || 0 });
  const employer = textInput({ name: 'employer', value: a.employer });
  const sources = app.settings().lists?.leadSources || [];
  const source = select({ name: 'source', value: a.source || '', options: [{ value: '', label: 'Not recorded' }, ...[...new Set([...sources, ...(a.source ? [a.source] : [])])].map((s) => ({ value: s, label: s }))] });
  const error = h('span.error-text', { role: 'alert', hidden: true }, 'Enter a first or last name.');

  const snapshot = () => JSON.stringify([first.value, last.value, email.value, phone.value, place.propertyId, place.unitId, applied.value, moveIn.value, income.value, employer.value, source.value]);

  const form = h(
    'form.pm-form',
    { novalidate: true },
    h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Applicant')),
      h('div.card-body.stack', h('div.form-grid', field('First name', first), field('Last name', last), field('Email', email), field('Phone', phone)), error),
    ),
    h('section.card', h('div.card-head', h('h2.grow', 'Unit and dates')), h('div.card-body', h('div.form-grid', place.node, field('Application date', applied), field('Desired move-in', moveIn)))),
    h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Income and source')),
      h('div.card-body', h('div.form-grid', field('Monthly income', income, { hint: 'Gross income before taxes, used for the income-to-rent ratio.' }), field('Employer', employer), field('How they found you', source))),
    ),
    h(
      'div.form-actions',
      h('div.spacer'),
      h('a.btn', { href: existing ? `#/applicants/${existing.id}` : '#/applicants' }, 'Cancel'),
      h('button.btn.primary', { type: 'submit' }, existing ? 'Save changes' : 'Add applicant'),
    ),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!first.value.trim() && !last.value.trim()) {
      error.hidden = false;
      first.focus();
      return;
    }
    const unit = place.unitId ? lookup.unit(place.unitId) : null;
    const rec = store.put('applicants', {
      ...a,
      firstName: first.value.trim(),
      lastName: last.value.trim(),
      email: email.value.trim(),
      phone: phone.value.trim(),
      propertyId: unit?.propertyId || place.propertyId || null,
      unitId: unit?.id || null,
      appliedOn: applied.value || app.today(),
      moveIn: moveIn.value || null,
      income: income.cents || 0,
      employer: employer.value.trim(),
      source: source.value || null,
    });
    saved = true;
    toast(existing ? 'Applicant updated' : `${personName(rec)} added`);
    navigate(`/applicants/${rec.id}`);
  });

  const initial = snapshot();
  const title = existing ? `Edit ${personName(existing)}` : 'New applicant';
  return {
    node: h('div.page.narrow', pageHeader({ title, crumbs: [{ label: 'Applicants', href: '#/applicants' }] }), form),
    title,
    dirty: () => !saved && snapshot() !== initial,
  };
}

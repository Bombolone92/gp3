/** New and edit vendor. */
import { h } from '../../ui/dom.js';
import { app } from '../../app.js';
import { pageHeader, field, textInput, select, emptyState } from '../../ui/components.js';
import { navigate } from '../../ui/router.js';
import { toast } from '../../ui/toast.js';
import { listEditor, addressFields, accountSelect } from '../common.js';
import { expenseAccounts } from '../../core/accounts.js';
import { displayName } from '../../core/format.js';

export function render(ctx) {
  const store = app.store;
  const existing = ctx.params.id ? store.get('vendors', ctx.params.id) : null;
  if (ctx.params.id && !existing) {
    return h('div.page', emptyState({ icon: 'truck', title: 'Vendor not found', headingLevel: 1, text: 'It may have been deleted.', actions: [h('a.btn.primary', { href: '#/vendors' }, 'Back to vendors')] }));
  }
  const v = existing || { active: true, emails: [], phones: [], address: {} };
  let saved = false;

  const company = textInput({ name: 'company', value: v.company, autocomplete: 'organization', placeholder: 'e.g. Northside Plumbing' });
  const first = textInput({ name: 'firstName', value: v.firstName, autocomplete: 'given-name' });
  const last = textInput({ name: 'lastName', value: v.lastName, autocomplete: 'family-name' });
  const cats = app.settings().lists?.vendorCategories || [];
  const category = select({ name: 'category', value: v.category || '', options: [{ value: '', label: 'Choose a category' }, ...[...new Set([...cats, ...(v.category ? [v.category] : [])])].map((c) => ({ value: c, label: c }))] });
  const expenseIds = new Set(expenseAccounts(store.all('accounts')).map((a) => a.id));
  const account = accountSelect({ name: 'accountId', value: v.accountId || '', empty: 'No default', filter: (a) => expenseIds.has(a.id) || a.id === v.accountId });
  const emails = listEditor({ values: v.emails || [], type: 'email', label: 'Email', addLabel: 'Add email' });
  const phones = listEditor({ values: v.phones || [], type: 'tel', label: 'Phone', addLabel: 'Add phone' });
  const website = textInput({ name: 'website', value: v.website, type: 'url', placeholder: 'https://' });
  const addr = addressFields(v.address || {});
  const insurance = textInput({ name: 'insuranceExpires', type: 'date', value: v.insuranceExpires || '' });
  const active = h('input', { type: 'checkbox', checked: v.active !== false });
  const error = h('span.error-text', { role: 'alert', hidden: true }, 'Enter a company or contact name.');

  const values = () => ({
    company: company.value.trim(),
    firstName: first.value.trim(),
    lastName: last.value.trim(),
    category: category.value || null,
    accountId: account.value || null,
    emails: emails.values,
    phones: phones.values,
    website: website.value.trim(),
    address: addr.value(),
    insuranceExpires: insurance.value || null,
    active: active.checked,
  });

  const form = h(
    'form.pm-form',
    { novalidate: true },
    h('section.card', h('div.card-head', h('h2.grow', 'Vendor')), h('div.card-body.stack', h('div.form-grid', field('Company', company, { span2: true }), field('Contact first name', first), field('Contact last name', last), field('Category', category), field('Default expense account', account, { hint: 'Bills from this vendor start with this account.' })), error)),
    h('section.card', h('div.card-head', h('h2.grow', 'Contact')), h('div.card-body', h('div.form-grid', h('div.field', h('span.field-label', 'Email'), emails), h('div.field', h('span.field-label', 'Phone'), phones), field('Website', website, { span2: true }), addr.node))),
    h('section.card', h('div.card-head', h('h2.grow', 'Compliance')), h('div.card-body.stack', field('Insurance certificate expires', insurance, { hint: 'You will see a warning 30 days before it expires.' }), h('label.check', active, 'Active vendor'))),
    h('div.form-actions', h('div.spacer'), h('a.btn', { href: existing ? `#/vendors/${existing.id}` : '#/vendors' }, 'Cancel'), h('button.btn.primary', { type: 'submit' }, existing ? 'Save changes' : 'Add vendor')),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = values();
    if (!val.company && !val.firstName && !val.lastName) {
      error.hidden = false;
      company.focus();
      return;
    }
    const rec = store.put('vendors', { ...v, ...val });
    saved = true;
    toast(existing ? 'Vendor updated' : `${displayName(rec)} added`);
    navigate(ctx.query.back ? decodeURIComponent(ctx.query.back).replace(/^#/, '') : `/vendors/${rec.id}`);
  });

  const initial = JSON.stringify(values());
  const title = existing ? `Edit ${displayName(existing)}` : 'New vendor';
  return {
    node: h('div.page.narrow', pageHeader({ title, crumbs: [{ label: 'Vendors', href: '#/vendors' }] }), form),
    title,
    dirty: () => !saved && JSON.stringify(values()) !== initial,
  };
}

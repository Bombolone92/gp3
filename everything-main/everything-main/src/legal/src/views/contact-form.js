/**
 * Create or edit a contact: a full-page form split into sections, with a
 * section index on wide screens and a sticky action bar.
 */
import '../styles/contacts.css';
import { h, uniqueId, debounce } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app } from '../app.js';
import { field, textInput, textarea, select, segmented, moneyInput, tagInput, recordPicker, emptyState } from '../ui/components.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { contactName, contactSortName } from '../core/format.js';
import { conflictSearch } from '../core/matters.js';
import { looksLikeEmail } from '../core/contacts-io.js';
import { allContactTags } from './contacts-shared.js';
import { customFieldInputs } from './custom-fields.js';

const EMAIL_TYPES = ['work', 'personal', 'other'];
const PHONE_TYPES = ['mobile', 'work', 'home', 'fax', 'other'];
const ADDRESS_TYPES = ['work', 'home', 'billing', 'other'];
const PREFIXES = ['', 'Mr.', 'Ms.', 'Mrs.', 'Mx.', 'Dr.', 'Hon.', 'Prof.'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

export function render(ctx) {
  const store = app.store;
  const existing = ctx.params.id ? store.get('contacts', ctx.params.id) : null;
  if (ctx.params.id && !existing) {
    return h(
      'div.page',
      emptyState({ icon: 'search', title: 'Contact not found', text: 'It may have been deleted.', headingLevel: 1, actions: [h('a.btn.primary', { href: '#/contacts' }, 'Back to contacts')] }),
    );
  }
  const src = existing ? structuredClone(existing) : {};
  let type = src.type || (ctx.query.type === 'company' ? 'company' : 'person');
  const prefill = String(ctx.query.name || '').trim();
  let saved = false;

  // ---- Identity ----
  const prefix = select({ name: 'prefix', value: src.prefix || '', options: PREFIXES.map((p) => ({ value: p, label: p || 'None' })) });
  const nameParts = prefill.split(/\s+/);
  const first = textInput({
    name: 'firstName',
    value: src.firstName ?? (type === 'person' && nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : type === 'person' ? prefill : ''),
    autocomplete: 'given-name',
  });
  const middle = textInput({ name: 'middleName', value: src.middleName || '', autocomplete: 'additional-name' });
  const last = textInput({ name: 'lastName', value: src.lastName ?? (type === 'person' && nameParts.length > 1 ? nameParts[nameParts.length - 1] : ''), autocomplete: 'family-name' });
  const companyName = textInput({ name: 'companyName', value: src.type === 'company' ? src.companyName || '' : type === 'company' ? prefill : '', autocomplete: 'organization' });
  const jobTitle = textInput({ name: 'jobTitle', value: src.jobTitle || '', autocomplete: 'organization-title' });
  const companies = () =>
    store
      .all('contacts')
      .filter((c) => c.type === 'company' && c.id !== src.id)
      .sort((a, b) => contactSortName(a).localeCompare(contactSortName(b)));
  // "Add person" on a company's page links the new person to it.
  const presetCompany = !existing && store.get('contacts', ctx.query.company)?.type === 'company' ? ctx.query.company : '';
  const companyPicker = recordPicker({
    name: 'companyId',
    value: src.type !== 'company' ? src.companyId || presetCompany : '',
    label: 'Company',
    placeholder: 'Find or add a company',
    getItems: companies,
    labelOf: (c) => (c ? contactName(c) : ''),
    footerAction: {
      label: (q) => (q.trim() ? `Add company "${q.trim()}"` : 'Type a company name to add it'),
      run: (q) => {
        const n = q.trim();
        if (!n) return null;
        const rec = store.put('contacts', { type: 'company', companyName: n, emails: [], phones: [], addresses: [], tags: [] });
        toast(`${n} added to contacts`);
        return rec;
      },
    },
  });
  // A person imported with a company typed as text keeps that text until linked.
  const legacyCompany = src.type !== 'company' && !src.companyId && src.companyName ? h('p.hint.subtle', `Imported company: ${src.companyName}. Choose or add it above to link it.`) : null;

  const personFields = h(
    'div.form-grid',
    field('Prefix', prefix, { cls: 'f-prefix' }),
    field('First name', first),
    field('Middle name', middle),
    field('Last name', last),
    field('Job title', jobTitle),
    h('div.field', h('label', { for: '' }, 'Company'), companyPicker, legacyCompany),
  );
  // Label the company picker's input properly.
  const companyLabel = personFields.querySelector('.field:last-child > label');
  companyPicker.id = uniqueId('f');
  companyLabel.setAttribute('for', companyPicker.id);
  const companyFields = h('div.form-grid', field('Company name', companyName, { required: true, span: 2 }));
  const nameError = h('p.error-text', { role: 'alert', hidden: true });
  const dupNotice = h('div', { 'aria-live': 'polite' });

  const typeSeg = segmented({
    label: 'Contact type',
    value: type,
    items: [
      { value: 'person', label: 'Person', icon: 'user' },
      { value: 'company', label: 'Company', icon: 'building' },
    ],
    onChange: (v) => {
      type = v;
      syncType();
      checkDuplicates();
      if (!existing) heading.textContent = type === 'company' ? 'New company' : 'New contact';
    },
  });
  function syncType() {
    personFields.hidden = type !== 'person';
    companyFields.hidden = type !== 'company';
    nameError.hidden = true;
  }
  syncType();

  // ---- Repeating rows (emails, phones, addresses) ----
  function rowList({ key, items, blank, types, renderInputs, addLabel, emptyText }) {
    let list = items.length ? items.map((x) => ({ ...x })) : [];
    const radioName = uniqueId(`${key}-primary`);
    const wrap = h('div.multi');
    function draw() {
      if (list.length && !list.some((x) => x.primary)) list[0].primary = true;
      wrap.replaceChildren(
        list.length
          ? h(
              'div.multi-rows',
              list.map((item, i) => row(item, i)),
            )
          : h('p.subtle.small', emptyText),
        h('button.btn.sm.ghost.add-row', { type: 'button', onClick: () => add() }, icon('plus', 15), addLabel),
      );
    }
    function row(item, i) {
      const typeSel = select({
        value: item.type || types[0],
        options: types.map((t) => ({ value: t, label: cap(t) })),
        'aria-label': `${addLabel.replace('Add ', '')} ${i + 1} type`,
        cls: 'multi-type',
      });
      typeSel.addEventListener('change', () => (item.type = typeSel.value));
      const radio = h('input', { type: 'radio', name: radioName, checked: !!item.primary, 'aria-label': `Primary ${addLabel.replace('Add ', '')}` });
      radio.addEventListener('change', () => list.forEach((x) => (x.primary = x === item)));
      return h(
        'div.multi-row',
        renderInputs(item, i),
        typeSel,
        h('label.check.multi-primary', radio, h('span', 'Primary')),
        h('button.icon-btn.sm', { type: 'button', 'aria-label': `Remove ${addLabel.replace('Add ', '')} ${i + 1}`, title: 'Remove', onClick: () => remove(item) }, icon('trash', 15)),
      );
    }
    function add() {
      list.push({ ...blank(), type: types[0], primary: !list.length });
      draw();
      wrap.querySelectorAll('.multi-row')[list.length - 1]?.querySelector('input')?.focus();
    }
    function remove(item) {
      list = list.filter((x) => x !== item);
      draw();
      wrap.querySelector('.add-row')?.focus();
    }
    draw();
    return { node: wrap, get: () => list };
  }

  const emails = rowList({
    key: 'email',
    items: src.emails || [],
    blank: () => ({ address: '' }),
    types: EMAIL_TYPES,
    addLabel: 'Add email',
    emptyText: 'No email addresses.',
    renderInputs: (item, i) => {
      const input = textInput({ type: 'email', value: item.address || '', placeholder: 'name@example.com', 'aria-label': `Email address ${i + 1}`, autocomplete: 'email', cls: 'multi-main' });
      input.addEventListener('input', () => {
        item.address = input.value;
        input.removeAttribute('aria-invalid');
      });
      input.addEventListener('blur', () => input.toggleAttribute('aria-invalid', !!input.value.trim() && !looksLikeEmail(input.value)));
      return input;
    },
  });
  const phones = rowList({
    key: 'phone',
    items: src.phones || [],
    blank: () => ({ number: '' }),
    types: PHONE_TYPES,
    addLabel: 'Add phone',
    emptyText: 'No phone numbers.',
    renderInputs: (item, i) => {
      const input = textInput({ type: 'tel', value: item.number || '', placeholder: '(555) 555-0100', 'aria-label': `Phone number ${i + 1}`, autocomplete: 'tel', cls: 'multi-main' });
      input.addEventListener('input', () => (item.number = input.value));
      return input;
    },
  });
  const addresses = rowList({
    key: 'address',
    items: src.addresses || [],
    blank: () => ({ street: '', street2: '', city: '', region: '', postal: '', country: '' }),
    types: ADDRESS_TYPES,
    addLabel: 'Add address',
    emptyText: 'No addresses.',
    renderInputs: (item, i) => {
      const n = i + 1;
      const inp = (key, label, ac, cls) => {
        const el = textInput({ value: item[key] || '', placeholder: label, 'aria-label': `Address ${n} ${label.toLowerCase()}`, autocomplete: ac, cls });
        el.addEventListener('input', () => (item[key] = el.value));
        return el;
      };
      return h(
        'div.addr-grid.multi-main',
        inp('street', 'Street', 'address-line1', 'addr-street'),
        inp('street2', 'Unit, suite, or floor', 'address-line2', 'addr-street'),
        inp('city', 'City', 'address-level2'),
        inp('region', 'State or region', 'address-level1'),
        inp('postal', 'Postal code', 'postal-code'),
        inp('country', 'Country', 'country-name'),
      );
    },
  });

  // ---- Other details ----
  const website = textInput({ name: 'website', type: 'url', value: src.website || '', placeholder: 'https://', autocomplete: 'url' });
  const dob = textInput({ name: 'dob', type: 'date', value: src.dob || '' });
  const tags = tagInput({ name: 'tags', tags: src.tags || [], suggestions: allContactTags() });
  const rate = moneyInput({ name: 'rateCents', cents: src.rateCents || 0, placeholder: 'Firm default' });
  const notes = textarea({ name: 'notes', value: src.notes || '', rows: 5, placeholder: 'Background, preferences, or anything the firm should know' });
  const dobField = field('Date of birth', dob);

  // ---- Duplicate detection ----
  function currentName() {
    return type === 'company'
      ? companyName.value.trim()
      : [first.value, last.value]
          .map((s) => s.trim())
          .filter(Boolean)
          .join(' ');
  }
  const checkDuplicates = debounce(() => {
    const name = currentName();
    if (name.length < 3) return dupNotice.replaceChildren();
    const hits = conflictSearch(name, { contacts: store.all('contacts').filter((c) => c.id !== src.id && c.type === type), matters: [] })
      .filter((r) => r.score >= 60)
      .slice(0, 3);
    dupNotice.replaceChildren(
      hits.length
        ? h(
            'div.notice.warning',
            icon('warning', 16),
            h(
              'span',
              h('strong', hits.length === 1 ? 'A contact with a similar name exists: ' : 'Contacts with similar names exist: '),
              hits.map((r, i) => [i ? ', ' : '', h('a', { href: `#/contacts/${r.contact.id}`, target: '_blank', rel: 'noopener' }, contactName(r.contact))]),
              '. Check that you are not creating a duplicate.',
            ),
          )
        : '',
    );
  }, 250);
  for (const el of [first, last, companyName]) el.addEventListener('input', checkDuplicates);
  if (!existing && prefill) checkDuplicates();

  const custom = customFieldInputs('contact', src.custom);

  // ---- Assemble ----
  const sections = [
    { id: uniqueId('sec'), title: 'Contact information', body: h('div.stack', h('div', typeSeg), personFields, companyFields, nameError, dupNotice) },
    { id: uniqueId('sec'), title: 'Email', body: emails.node },
    { id: uniqueId('sec'), title: 'Phone', body: phones.node },
    { id: uniqueId('sec'), title: 'Address', body: addresses.node },
    {
      id: uniqueId('sec'),
      title: 'Details',
      body: h(
        'div.form-grid',
        field('Website', website),
        dobField,
        field('Tags', tags, { span: 2 }),
        field('Custom hourly rate', rate, { hint: 'Used for this contact when no matter or user rate applies.' }),
      ),
    },
    custom.count ? { id: uniqueId('sec'), title: 'Custom fields', body: custom.node } : null,
    { id: uniqueId('sec'), title: 'Notes', body: field('Notes', notes) },
  ].filter(Boolean);
  // Companies have no date of birth.
  const syncDob = () => (dobField.hidden = type === 'company');
  syncDob();
  typeSeg.addEventListener('click', syncDob);

  const form = h('form.form-page-body', { novalidate: true, 'aria-label': existing ? 'Edit contact' : 'New contact' });
  form.append(
    h(
      'nav.form-index',
      { 'aria-label': 'Form sections' },
      h('div.menu-label', 'Sections'),
      sections.map((s) => h('button.form-index-link', { type: 'button', onClick: () => document.getElementById(s.id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }) }, s.title)),
    ),
    h(
      'div.form-sections',
      sections.map((s) => h('section.card.form-section', { id: s.id, 'aria-labelledby': `${s.id}-h` }, h('div.card-head', h('h2.grow', { id: `${s.id}-h` }, s.title)), h('div.card-body', s.body))),
    ),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });

  const cancelHref = existing ? `#/contacts/${existing.id}` : '#/contacts';
  const heading = h('h1', existing ? `Edit ${contactName(existing)}` : type === 'company' ? 'New company' : 'New contact');
  const bar = h(
    'div.form-bar',
    h(
      'div.grow',
      h(
        'nav.crumbs',
        { 'aria-label': 'Breadcrumb' },
        h('a', { href: '#/contacts' }, 'Contacts'),
        icon('chevron-right', 14),
        existing ? h('a', { href: `#/contacts/${existing.id}` }, contactName(existing)) : null,
      ),
      heading,
    ),
    h('a.btn', { href: cancelHref }, 'Cancel'),
    h('button.btn.primary', { type: 'submit', form: (form.id = uniqueId('contact-form')) }, icon('save', 16), existing ? 'Save changes' : 'Create contact'),
  );

  function collect() {
    const clean = (list, key) => list.filter((x) => String(x[key] || '').trim()).map((x) => ({ ...x, [key]: String(x[key]).trim() }));
    const addrs = addresses
      .get()
      .filter((a) => ['street', 'street2', 'city', 'region', 'postal', 'country'].some((k) => String(a[k] || '').trim()))
      .map((a) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])));
    const fixPrimary = (list) => (list.length && !list.some((x) => x.primary) ? list.map((x, i) => ({ ...x, primary: i === 0 })) : list);
    const isPerson = type === 'person';
    return {
      ...src,
      type,
      prefix: isPerson ? prefix.value : '',
      firstName: isPerson ? first.value.trim() : '',
      middleName: isPerson ? middle.value.trim() : '',
      lastName: isPerson ? last.value.trim() : '',
      jobTitle: isPerson ? jobTitle.value.trim() : '',
      companyId: isPerson ? companyPicker.value || null : null,
      companyName: isPerson ? (companyPicker.value ? '' : src.companyName || '') : companyName.value.trim(),
      emails: fixPrimary(clean(emails.get(), 'address')),
      phones: fixPrimary(clean(phones.get(), 'number')),
      addresses: fixPrimary(addrs),
      website: website.value.trim(),
      dob: isPerson ? dob.value : '',
      tags: tags.tags,
      rateCents: rate.cents || null,
      notes: notes.value.trim(),
      custom: custom.read(),
    };
  }
  const initial = JSON.stringify(collect());

  function save() {
    const rec = collect();
    nameError.hidden = true;
    if (type === 'person' && !rec.firstName && !rec.lastName) {
      nameError.textContent = 'Enter a first or last name.';
      nameError.hidden = false;
      first.setAttribute('aria-invalid', 'true');
      first.focus();
      return;
    }
    if (type === 'company' && !rec.companyName) {
      companyName.setAttribute('aria-invalid', 'true');
      companyName.focus();
      return;
    }
    const badEmail = rec.emails.find((e) => !looksLikeEmail(e.address));
    if (badEmail) {
      const input = [...form.querySelectorAll('input[type=email]')].find((i) => i.value.trim() === badEmail.address);
      input?.setAttribute('aria-invalid', 'true');
      input?.focus();
      toast(`"${badEmail.address}" does not look like an email address.`, { type: 'error' });
      return;
    }
    const out = store.put('contacts', rec);
    saved = true;
    toast(existing ? 'Contact updated' : `${contactName(out)} added to contacts`);
    navigate(`/contacts/${out.id}`);
  }

  return {
    title: existing ? `Edit ${contactName(existing)}` : 'New contact',
    node: h('div.page.form-page.contact-form', bar, form),
    dirty: () => !saved && JSON.stringify(collect()) !== initial,
  };
}

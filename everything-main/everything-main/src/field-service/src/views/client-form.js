/** Create or edit a client, plus a compact "quick add" dialog. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app } from '../app.js';
import { pageHeader, field, textInput, textarea, select } from '../ui/components.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { formDialog } from '../ui/dialog.js';
import { newId } from '../core/ids.js';
import { clientName, docLabel } from '../core/format.js';
import { applyEdits } from '../core/workflow.js';

const PHONE_LABELS = ['Main', 'Mobile', 'Work', 'Home', 'Other'];
const EMAIL_LABELS = ['Main', 'Work', 'Personal', 'Billing', 'Other'];
const TITLES = ['', 'Mr.', 'Ms.', 'Mrs.', 'Mx.', 'Dr.'];

function blankClient() {
  return {
    title: '',
    firstName: '',
    lastName: '',
    company: '',
    useCompanyName: false,
    phones: [{ label: 'Main', number: '' }],
    emails: [{ label: 'Main', address: '' }],
    properties: [{ id: newId(), street1: '', street2: '', city: '', region: '', postal: '', country: '' }],
    billingSame: true,
    billing: { street1: '', street2: '', city: '', region: '', postal: '', country: '' },
    leadSource: '',
    tags: [],
    notes: '',
  };
}

export function render(ctx) {
  const store = app.store;
  const existing = ctx.params.id ? store.get('clients', ctx.params.id) : null;
  if (ctx.params.id && !existing) return h('div.page', pageHeader({ title: 'Client not found' }), h('a.btn', { href: '#/clients' }, 'Back to clients'));
  const draft = existing ? structuredClone(existing) : blankClient();
  if (!draft.properties?.length) draft.properties = [{ id: newId(), street1: '', street2: '', city: '', region: '', postal: '', country: '' }];
  draft.billing ??= { street1: '', street2: '', city: '', region: '', postal: '', country: '' };
  if (draft.billingSame === undefined) draft.billingSame = true;
  if (!draft.phones?.length) draft.phones = [{ label: 'Main', number: '' }];
  if (!draft.emails?.length) draft.emails = [{ label: 'Main', address: '' }];
  let saved = false;

  const form = h('form.doc-form', { novalidate: true });
  const bind = (obj, key, input) => {
    input.addEventListener('input', () => {
      obj[key] = input.type === 'checkbox' ? input.checked : input.value;
    });
    return input;
  };

  // ---- Details -------------------------------------------------------------
  const first = bind(draft, 'firstName', textInput({ value: draft.firstName, autocomplete: 'given-name', autofocus: !existing || null }));
  const last = bind(draft, 'lastName', textInput({ value: draft.lastName, autocomplete: 'family-name' }));
  const company = bind(draft, 'company', textInput({ value: draft.company, autocomplete: 'organization' }));
  const title = bind(draft, 'title', select({ value: draft.title, options: TITLES.map((t) => ({ value: t, label: t || 'None' })) }));
  const useCompany = h('input', { type: 'checkbox', checked: !!draft.useCompanyName });
  bind(draft, 'useCompanyName', useCompany);
  const nameError = h('span.error-text', { role: 'alert', hidden: true }, 'Enter a first name, last name, or company name.');
  for (const el of [first, last, company]) el.addEventListener('input', () => el.value.trim() && (nameError.hidden = true));

  const details = h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Client details')),
    h(
      'div.card-body.stack',
      h(
        'div.form-grid.client-name-grid',
        field('Title', title),
        field('First name', first),
        field('Last name', last),
      ),
      h('div.form-grid', field('Company name', company, { span2: true })),
      h('label.check', useCompany, 'Use company name as the primary name'),
      nameError,
    ),
  );

  // ---- Contact ---------------------------------------------------------------
  function repeatList(list, { labels, key, placeholder, type, addLabel, autocomplete }) {
    const wrap = h('div.repeat-group');
    const noun = addLabel.replace('Add ', '');
    const Noun = noun[0].toUpperCase() + noun.slice(1);
    const draw = () => {
      wrap.replaceChildren(
        ...list.map((entry, i) => {
          const sel = select({ value: entry.label, options: labels, 'aria-label': `${Noun} ${i + 1} type` });
          sel.addEventListener('change', () => (entry.label = sel.value));
          const inp = textInput({ value: entry[key], placeholder, type, autocomplete, 'aria-label': `${Noun} ${i + 1}` });
          inp.addEventListener('input', () => (entry[key] = inp.value));
          return h(
            'div.repeat-row',
            sel,
            inp,
            h(
              'button.icon-btn',
              {
                type: 'button',
                'aria-label': `Remove ${noun} ${i + 1}`,
                disabled: list.length === 1 || null,
                onClick: () => {
                  list.splice(i, 1);
                  draw();
                  wrap.querySelectorAll('input')[Math.min(i, list.length - 1)]?.focus();
                },
              },
              icon('x', 16),
            ),
          );
        }),
        h(
          'div',
          h(
            'button.btn.sm.ghost',
            {
              type: 'button',
              onClick: () => {
                list.push({ label: labels[1] || labels[0], [key]: '' });
                draw();
                wrap.querySelectorAll('input')[list.length - 1]?.focus();
              },
            },
            icon('plus', 14),
            addLabel,
          ),
        ),
      );
    };
    draw();
    return wrap;
  }

  // Keep a source no longer in Settings (or from an import) selectable, so it is shown and kept.
  const sources = [...new Set([...(store.state.settings.leadSources || []), draft.leadSource].filter(Boolean))];
  const leadSource = bind(draft, 'leadSource', select({ value: draft.leadSource || '', options: [{ value: '', label: 'Not specified' }, ...sources.map((s) => ({ value: s, label: s }))] }));

  const contact = h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Contact details')),
    h(
      'div.card-body.stack',
      h('div.field', h('span.field-label', 'Phone numbers'), repeatList(draft.phones, { labels: PHONE_LABELS, key: 'number', placeholder: '(555) 555-0100', type: 'tel', addLabel: 'Add phone number', autocomplete: 'tel' })),
      h('div.field', h('span.field-label', 'Email addresses'), repeatList(draft.emails, { labels: EMAIL_LABELS, key: 'address', placeholder: 'name@example.com', type: 'email', addLabel: 'Add email address', autocomplete: 'email' })),
      h('div.form-grid', field('Lead source', leadSource), field('Tags', tagInput(draft.tags), { hint: 'Press Enter or comma to add a tag' })),
    ),
  );

  // ---- Properties --------------------------------------------------------------
  function addressFields(obj, prefix) {
    const f = (label, key, opts = {}) => field(label, bind(obj, key, textInput({ value: obj[key] || '', autocomplete: opts.ac ? `${prefix} ${opts.ac}` : 'off' })), { span2: !!opts.span2 });
    return h(
      'div.form-grid',
      f('Street 1', 'street1', { span2: true, ac: 'address-line1' }),
      f('Street 2', 'street2', { span2: true, ac: 'address-line2' }),
      f('City', 'city', { ac: 'address-level2' }),
      f('State or province', 'region', { ac: 'address-level1' }),
      f('Zip or postal code', 'postal', { ac: 'postal-code' }),
      f('Country', 'country', { ac: 'country-name' }),
    );
  }

  const propsWrap = h('div.stack');
  const drawProps = () => {
    propsWrap.replaceChildren(
      ...draft.properties.map((p, i) =>
        h(
          'div.stack',
          draft.properties.length > 1
            ? h(
                'div.row',
                h('span.form-section-title.grow', icon('pin', 16), `Property ${i + 1}`),
                h(
                  'button.btn.sm.ghost.subtle-danger',
                  {
                    type: 'button',
                    'aria-label': `Remove property ${i + 1}`,
                    onClick: () => {
                      draft.properties.splice(i, 1);
                      drawProps();
                      focusProperty(Math.min(i, draft.properties.length - 1));
                    },
                  },
                  'Remove',
                ),
              )
            : null,
          addressFields(p, 'section-prop' + i + ' shipping'),
        ),
      ),
      h(
        'div',
        h(
          'button.btn.sm',
          {
            type: 'button',
            onClick: () => {
              draft.properties.push({ id: newId(), street1: '', street2: '', city: '', region: '', postal: '', country: '' });
              drawProps();
              focusProperty(draft.properties.length - 1);
            },
          },
          icon('plus', 14),
          'Add another property',
        ),
      ),
    );
  };
  // Its first field, so keyboard users carry on where the property is.
  const focusProperty = (i) => propsWrap.children[i]?.querySelector('input')?.focus();
  drawProps();

  const billingSame = h('input', { type: 'checkbox', checked: draft.billingSame !== false });
  const billingFields = h('div', { hidden: draft.billingSame !== false }, addressFields(draft.billing, 'billing'));
  billingSame.addEventListener('change', () => {
    draft.billingSame = billingSame.checked;
    billingFields.hidden = billingSame.checked;
  });

  const props = h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Property address')),
    h('div.card-body.stack', propsWrap, h('hr.divider'), h('label.check', billingSame, 'Billing address is the same as the property address'), billingFields),
  );

  const notes = h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Notes')),
    h('div.card-body', field('Internal notes', bind(draft, 'notes', textarea({ value: draft.notes, rows: 3, placeholder: 'Gate codes, pets, preferences...' })), { hint: 'Only visible to your team' })),
  );

  const actions = h(
    'div.form-actions',
    existing ? null : h('span.subtle.hide-mobile', 'You can add quotes and jobs after saving.'),
    h('div.spacer'),
    h('a.btn', { href: existing ? `#/clients/${existing.id}` : '#/clients' }, 'Cancel'),
    h('button.btn.primary', { type: 'submit' }, existing ? 'Save changes' : 'Save client'),
  );

  form.append(h('div.client-form-cols', h('div.stack', details, contact), h('div.stack', props, notes)), actions);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!draft.firstName.trim() && !draft.lastName.trim() && !draft.company.trim()) {
      nameError.hidden = false;
      first.setAttribute('aria-invalid', 'true');
      first.focus();
      return;
    }
    const rec = {
      ...draft,
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      company: draft.company.trim(),
      phones: draft.phones.filter((p) => p.number.trim()),
      emails: draft.emails.filter((x) => x.address.trim()),
      properties: draft.properties.filter((p) => ['street1', 'city', 'postal', 'region'].some((k) => (p[k] || '').trim())),
    };
    // A property still used by work cannot go: those records would quietly
    // switch to another address.
    const gone = new Set((existing?.properties || []).map((p) => p.id).filter((id) => !rec.properties.some((p) => p.id === id)));
    if (gone.size) {
      const using = ['requests', 'quotes', 'jobs', 'invoices'].flatMap((c) => store.all(c).filter((r) => r.clientId === existing.id && gone.has(r.propertyId)).map((r) => docLabel(c, r)));
      if (using.length) {
        toast(`A property you removed is used by ${using[0]}${using.length > 1 ? ` and ${using.length - 1} more` : ''}. Give ${using.length > 1 ? 'them' : 'it'} another property first.`, { type: 'error', duration: 8000 });
        return;
      }
    }
    const savedRec = store.put('clients', existing ? applyEdits(store.get('clients', existing.id) || existing, JSON.parse(initial), rec) : rec);
    saved = true;
    toast(existing ? 'Client updated' : `${clientName(savedRec)} added`);
    const next = ctx.query.next;
    navigate(next ? `${next}${next.includes('?') ? '&' : '?'}client=${savedRec.id}` : `/clients/${savedRec.id}`);
  });

  const header = pageHeader({
    title: existing ? `Edit ${clientName(existing)}` : 'New client',
    crumbs: [{ label: 'Clients', href: '#/clients' }, ...(existing ? [{ label: clientName(existing), href: `#/clients/${existing.id}` }] : [])],
  });

  // Snapshot after the form is built: building it may normalize the draft.
  const initial = JSON.stringify(draft);
  return {
    node: h('div.page', header, form),
    title: existing ? `Edit ${clientName(existing)}` : 'New client',
    dirty: () => !saved && JSON.stringify(draft) !== initial,
  };
}

/** Chips-style tag editor. Mutates the array. */
export function tagInput(tags) {
  const wrap = h('div.tag-input');
  const input = h('input', { type: 'text', placeholder: tags.length ? '' : 'Add tags', 'aria-label': 'Add a tag', autocomplete: 'off' });
  const draw = () => {
    wrap.replaceChildren(
      ...tags.map((t, i) =>
        h(
          'span.tag',
          t,
          h(
            'button',
            {
              type: 'button',
              'aria-label': `Remove tag ${t}`,
              onClick: () => {
                tags.splice(i, 1);
                draw();
                input.focus();
              },
            },
            icon('x', 12),
          ),
        ),
      ),
      input,
    );
    input.placeholder = tags.length ? '' : 'Add tags';
  };
  const commit = () => {
    const v = input.value.replace(/,/g, '').trim();
    if (v && !tags.includes(v)) tags.push(v);
    input.value = '';
    draw();
    input.focus();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !input.value && tags.length) {
      tags.pop();
      draw();
      input.focus();
    }
  });
  input.addEventListener('blur', () => input.value.trim() && commit());
  wrap.addEventListener('click', (e) => e.target === wrap && input.focus());
  draw();
  // Let the field() helper label the inner input, by its own label rather
  // than "Add a tag" (two tag fields on one page would sound the same).
  Object.defineProperty(wrap, 'id', {
    get: () => input.id,
    set: (v) => {
      input.id = v;
      input.removeAttribute('aria-label');
    },
  });
  return wrap;
}

/** Create a client without leaving the current form. Resolves the client or null. */
export async function quickClientDialog(prefill = '') {
  const parts = prefill.trim().split(/\s+/);
  const firstGuess = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '';
  const lastGuess = parts.length > 1 ? parts.at(-1) : '';
  let created = null;
  await formDialog({
    title: 'New client',
    submitLabel: 'Create client',
    body: h(
      'div.form-grid',
      field('First name', textInput({ name: 'firstName', value: firstGuess, autocomplete: 'given-name' })),
      field('Last name', textInput({ name: 'lastName', value: lastGuess, autocomplete: 'family-name' })),
      field('Company name', textInput({ name: 'company', autocomplete: 'organization' }), { span2: true }),
      field('Phone', textInput({ name: 'phone', type: 'tel', autocomplete: 'tel' })),
      field('Email', textInput({ name: 'email', type: 'email', autocomplete: 'email' })),
      field('Street', textInput({ name: 'street1', autocomplete: 'address-line1' }), { span2: true }),
      field('City', textInput({ name: 'city', autocomplete: 'address-level2' })),
      field('State or province', textInput({ name: 'region', autocomplete: 'address-level1' })),
      field('Zip or postal code', textInput({ name: 'postal', autocomplete: 'postal-code' })),
    ),
    onSubmit: (fd, form) => {
      const g = (k) => String(fd.get(k) || '').trim();
      if (!g('firstName') && !g('lastName') && !g('company')) {
        form.querySelector('[name=firstName]').setAttribute('aria-invalid', 'true');
        form.querySelector('[name=firstName]').focus();
        toast('Enter a name or company', { type: 'error' });
        return false;
      }
      const hasAddr = g('street1') || g('city');
      created = app.store.put('clients', {
        firstName: g('firstName'),
        lastName: g('lastName'),
        company: g('company'),
        useCompanyName: !g('firstName') && !g('lastName'),
        phones: g('phone') ? [{ label: 'Main', number: g('phone') }] : [],
        emails: g('email') ? [{ label: 'Main', address: g('email') }] : [],
        properties: hasAddr ? [{ id: newId(), street1: g('street1'), street2: '', city: g('city'), region: g('region'), postal: g('postal'), country: '' }] : [],
        billingSame: true,
        tags: [],
        notes: '',
      });
      toast(`${clientName(created)} added`);
      return created;
    },
  });
  return created;
}

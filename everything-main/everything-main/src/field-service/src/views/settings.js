/** Settings: business, products and services, team, taxes, documents, data. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app } from '../app.js';
import { pageHeader, field, textInput, textarea, select, moneyInput, segmented, avatar, emptyState, moreButton, statusPill } from '../ui/components.js';
import { openMenu } from '../ui/menu.js';
import { formDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { getThemeMode, setThemeMode } from '../ui/theme.js';
import { navigate } from '../ui/router.js';
import { showShortcuts } from '../ui/shell.js';
import { PAYMENT_TERMS, defaultSettings } from '../core/settings.js';
import { TEAM_COLORS, pluralize } from '../core/format.js';
import { parseMoney, parseDecimal } from '../core/money.js';
import { COLLECTIONS } from '../core/store.js';
import { validateBackup } from '../core/backup.js';
import { removeTeamMember } from '../core/workflow.js';
import { toLocalStamp } from './timesheets-core.js';
import { money } from './common.js';
import { tagInput } from './client-form.js';
import { downloadText } from '../core/csv.js';
import { newId } from '../core/ids.js';
import { teamAccessCard } from './team-access.js';
import { deleteAttachments } from '../files.js';

const REPO_URL = 'https://github.com/heyputer/everything';

const SECTIONS = [
  { id: 'business', label: 'Business', icon: 'building' },
  { id: 'products', label: 'Products and services', icon: 'package' },
  { id: 'team', label: 'Team', icon: 'users' },
  { id: 'taxes', label: 'Taxes', icon: 'percent' },
  { id: 'documents', label: 'Quotes and invoices', icon: 'file' },
  { id: 'lists', label: 'Lists', icon: 'list' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'data', label: 'Data', icon: 'database' },
  { id: 'about', label: 'About', icon: 'info' },
];

// Set by the section on screen that has a form, to warn before its unsaved
// edits are lost by leaving the page.
let unsaved = null;

/**
 * The settings in `next` that differ from `before`. A form saves only these,
 * so it cannot put back an older value of a setting someone changed on
 * another device while the form was open.
 */
function changedSettings(next, before) {
  const out = {};
  for (const [k, v] of Object.entries(next)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sub = changedSettings(v, before?.[k] || {});
      if (Object.keys(sub).length) out[k] = sub;
    } else if (JSON.stringify(v) !== JSON.stringify(before?.[k])) out[k] = v;
  }
  return out;
}

/** Tracks a settings form's edits; call the returned function after saving. */
function trackForm(form) {
  const values = () => JSON.stringify([...new FormData(form)]);
  let saved = values();
  unsaved = () => values() !== saved;
  return () => (saved = values());
}

export function render(ctx) {
  unsaved = null;
  const section = SECTIONS.some((s) => s.id === ctx.params.section) ? ctx.params.section : 'business';
  const meta = SECTIONS.find((s) => s.id === section);
  // Forms are not live (a sync must never wipe what someone is typing).
  const WATCH = { products: ['products', 'settings'], team: ['team'], taxes: ['settings'], data: [...COLLECTIONS, 'settings'] };
  const content = ctx.live(() => RENDER[section](), WATCH[section] || []);
  const nav = h(
    'nav.settings-nav',
    { 'aria-label': 'Settings sections' },
    SECTIONS.map((s) => h('a', { href: `#/settings/${s.id}`, 'aria-current': s.id === section ? 'page' : null }, icon(s.icon, 17), s.label)),
  );
  requestAnimationFrame(() => nav.querySelector('[aria-current]')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  return {
    node: h('div.page', pageHeader({ title: 'Settings' }), h('div.settings-layout', nav, h('div.stack', { style: { gap: '16px', minWidth: '0' } }, h('h2.sr-only', meta.label), content))),
    title: `${meta.label} settings`,
    dirty: () => !!unsaved?.(),
  };
}

// ---------------------------------------------------------------------------

function saveBar(onSave) {
  return h('div.row', { style: { justifyContent: 'flex-end' } }, h('button.btn.primary', { type: 'submit' }, 'Save changes'));
}

function businessSection() {
  const s = app.settings();
  const c = s.company;
  const f = (label, key, opts = {}) => field(label, textInput({ name: key, value: c[key] || '', type: opts.type || 'text', autocomplete: opts.ac || 'off' }), { span2: opts.span2 });
  const form = h(
    'form.stack',
    { novalidate: true, style: { gap: '16px' } },
    h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Company details')),
      h(
        'div.card-body.stack',
        h('p.subtle', 'Shown on quotes and invoices.'),
        h(
          'div.form-grid',
          f('Business name', 'name', { span2: true, ac: 'organization' }),
          f('Phone', 'phone', { type: 'tel', ac: 'tel' }),
          f('Email', 'email', { type: 'email', ac: 'email' }),
          f('Website', 'website', { ac: 'url' }),
          f('Tax or business number', 'taxId'),
          field('Address', textarea({ name: 'address', value: c.address || '', rows: 2, autocomplete: 'street-address' }), { span2: true }),
        ),
      ),
    ),
    h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Regional and schedule')),
      h(
        'div.card-body.form-grid',
        field('Currency', select({ name: 'currency', value: s.currency, options: ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'ZAR', 'INR', 'MXN', 'BRL', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK'].map((x) => ({ value: x, label: x })) })),
        field('Week starts on', select({ name: 'weekStart', value: String(s.weekStart || 0), options: [{ value: '0', label: 'Sunday' }, { value: '1', label: 'Monday' }, { value: '6', label: 'Saturday' }] })),
        field('Workday starts', textInput({ name: 'workStart', type: 'time', value: s.workday?.start || '07:00' })),
        field('Workday ends', textInput({ name: 'workEnd', type: 'time', value: s.workday?.end || '18:00' })),
      ),
    ),
    saveBar(),
  );
  const read = () => {
    const fd = new FormData(form);
    const g = (k) => String(fd.get(k) || '').trim();
    return {
      company: { name: g('name'), phone: g('phone'), email: g('email'), website: g('website'), taxId: g('taxId'), address: g('address') },
      currency: g('currency'),
      weekStart: Number(g('weekStart')),
      workday: { start: g('workStart') || '07:00', end: g('workEnd') || '18:00' },
    };
  };
  let shown = read();
  const markSaved = trackForm(form);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const next = read();
    app.store.saveSettings(changedSettings(next, shown));
    shown = next;
    markSaved();
    toast('Business settings saved');
  });
  return form;
}

function productsSection() {
  const store = app.store;
  const list = [...store.all('products')].sort((a, b) => (a.active === false) - (b.active === false) || a.name.localeCompare(b.name));
  return h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Products and services', h('span.count', ` ${list.length}`)), h('button.btn.sm.primary', { type: 'button', onClick: () => productDialog() }, icon('plus', 14), 'Add item')),
    h(
      'div.card-body.flush',
      list.length
        ? h(
            'div.table-wrap',
            { tabindex: '0', role: 'region', 'aria-label': 'Products and services' },
            h(
              'table.table',
              h('caption.sr-only', 'Products and services'),
              h('thead', h('tr', h('th', { scope: 'col' }, 'Name'), h('th', { scope: 'col' }, 'Type'), h('th.r', { scope: 'col' }, 'Price'), h('th.r', { scope: 'col' }, 'Cost'), h('th.r', { scope: 'col' }, 'Margin'), h('th.r', { scope: 'col' }, h('span.sr-only', 'Actions')))),
              h(
                'tbody',
                list.map((p) =>
                  h(
                    'tr',
                    h('td', h('button.link-btn', { type: 'button', style: { color: 'var(--text)', textAlign: 'left' }, onClick: () => productDialog(p) }, p.name), p.active === false ? h('span.pill.plain', { style: { marginLeft: '8px' } }, 'Inactive') : null, p.description ? h('div.sub.truncate', { style: { maxWidth: '420px' } }, p.description) : null),
                    h('td', p.kind === 'product' ? 'Product' : 'Service'),
                    h('td.r.money', money(p.unitPrice)),
                    h('td.r.money.subtle', p.unitCost ? money(p.unitCost) : '-'),
                    h('td.r', p.unitPrice ? `${Math.round(((p.unitPrice - (p.unitCost || 0)) / p.unitPrice) * 100)}%` : '-'),
                    h(
                      'td.r',
                      moreButton(
                        (btn) =>
                          openMenu(
                            btn,
                            [
                              { label: 'Edit', icon: 'pencil', run: () => productDialog(p) },
                              { label: p.active === false ? 'Mark active' : 'Mark inactive', icon: 'archive', run: () => store.patch('products', p.id, { active: p.active === false }) },
                              {
                                label: 'Delete',
                                icon: 'trash',
                                danger: true,
                                run: async () => {
                                  if (!(await confirmDialog({ title: `Delete ${p.name}?`, message: 'Existing quotes, jobs and invoices keep their copy of this item.', confirmLabel: 'Delete', danger: true }))) return;
                                  const removed = store.remove('products', p.id);
                                  toast('Item deleted', { action: { label: 'Undo', run: () => store.restore('products', removed) } });
                                },
                              },
                            ],
                            { align: 'end' },
                          ),
                        `Actions for ${p.name}`,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          )
        : emptyState({ compact: true, icon: 'package', title: 'Build your price list', text: 'Saved items fill in names, descriptions and prices on quotes, jobs and invoices.', actions: [h('button.btn.primary', { type: 'button', onClick: () => productDialog() }, icon('plus', 16), 'Add item')], headingLevel: 3 }),
    ),
  );
}

function productDialog(p = null) {
  return formDialog({
    title: p ? 'Edit item' : 'New product or service',
    submitLabel: p ? 'Save' : 'Add item',
    body: h(
      'div.form-grid',
      field('Name', textInput({ name: 'name', value: p?.name || '', required: true }), { span2: true }),
      field('Type', select({ name: 'kind', value: p?.kind || 'service', options: [{ value: 'service', label: 'Service' }, { value: 'product', label: 'Product' }] })),
      h('div.field', h('span.field-label', 'Tax'), h('label.check', { style: { minHeight: '38px' } }, h('input', { type: 'checkbox', name: 'taxable', checked: p ? p.taxable !== false : true }), 'Taxable')),
      field('Unit price', moneyInput({ name: 'price', cents: p?.unitPrice || 0 })),
      field('Unit cost', moneyInput({ name: 'cost', cents: p?.unitCost || 0 }), { hint: 'Used for profit estimates. Never shown to clients.' }),
      field('Description', textarea({ name: 'description', value: p?.description || '', rows: 3 }), { span2: true }),
    ),
    onSubmit: (fd) => {
      const rec = {
        ...(p || { active: true }),
        name: String(fd.get('name')).trim(),
        kind: String(fd.get('kind')),
        taxable: fd.get('taxable') === 'on',
        unitPrice: parseMoney(String(fd.get('price'))) ?? 0,
        unitCost: parseMoney(String(fd.get('cost'))) ?? 0,
        description: String(fd.get('description') || '').trim(),
      };
      app.store.put('products', rec);
      toast(p ? 'Item updated' : `${rec.name} added`);
    },
  });
}

function teamSection() {
  const store = app.store;
  const list = [...store.all('team')].sort((a, b) => (a.active === false) - (b.active === false) || a.name.localeCompare(b.name));
  return h(
    'div.stack',
    { style: { gap: '16px' } },
    h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Team members', h('span.count', ` ${list.length}`)), h('button.btn.sm.primary', { type: 'button', onClick: () => memberDialog() }, icon('user-plus', 14), 'Add member')),
      h(
        'div.card-body.flush',
        list.length
          ? h(
              'ul.list',
              list.map((m) =>
                h(
                  'li',
                  h(
                    'div.list-item',
                    avatar(m.name, { color: m.color }),
                    h('div.grow', { style: { minWidth: '0' } }, h('div.title', m.name, m.active === false ? h('span.pill.plain', { style: { marginLeft: '8px' } }, 'Inactive') : null), h('div.meta.truncate', [ROLE_LABEL[m.role] || 'Worker', m.email, m.laborRate ? `${money(m.laborRate)}/hr` : ''].filter(Boolean).join(' · '))),
                    h('button.btn.sm', { type: 'button', onClick: () => memberDialog(m) }, 'Edit'),
                  ),
                ),
              ),
            )
          : emptyState({ compact: true, icon: 'users', title: 'Add your crew', text: 'Assign visits to people, color-code the schedule, and track their hours.', headingLevel: 3 }),
      ),
    ),
    h('p.subtle', { style: { fontSize: '13px' } }, 'Team members are the people you schedule and track time for. To let them sign in and use the app themselves, turn on team sign-in below.'),
    teamAccessCard(),
  );
}

const ROLE_LABEL = { owner: 'Owner', admin: 'Office manager', worker: 'Field worker' };

function memberDialog(m = null) {
  const store = app.store;
  let color = m?.color || TEAM_COLORS[store.all('team').length % TEAM_COLORS.length];
  const swatches = h(
    'div.color-swatches',
    { role: 'radiogroup', 'aria-label': 'Schedule color' },
    TEAM_COLORS.map((c, i) =>
      h('button', {
        type: 'button',
        role: 'radio',
        'aria-checked': String(c === color),
        'aria-label': `Color ${i + 1}`,
        style: { '--sw': c },
        onClick: (e) => {
          color = c;
          for (const b of swatches.children) b.setAttribute('aria-checked', String(b === e.currentTarget));
        },
      }),
    ),
  );
  return formDialog({
    title: m ? `Edit ${m.name}` : 'Add team member',
    submitLabel: m ? 'Save' : 'Add member',
    body: h(
      'div.form-grid',
      field('Full name', textInput({ name: 'name', value: m?.name || '', required: true, autocomplete: 'name' }), { span2: true }),
      field('Email', textInput({ name: 'email', type: 'email', value: m?.email || '' })),
      field('Phone', textInput({ name: 'phone', type: 'tel', value: m?.phone || '' })),
      field('Role', select({ name: 'role', value: m?.role || 'worker', options: Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label })) })),
      field('Labour cost per hour', moneyInput({ name: 'rate', cents: m?.laborRate || 0 }), { hint: 'For job costing and timesheets' }),
      h('div.field.span-2', h('span.field-label', 'Schedule color'), swatches),
      m ? h('label.check.span-2', h('input', { type: 'checkbox', name: 'active', checked: m.active !== false }), 'Active (shows on the schedule and in pickers)') : null,
    ),
    extraFooter: m
      ? ({ close }) =>
          h(
            'button.btn.ghost.subtle-danger',
            {
              type: 'button',
              onClick: async () => {
                close();
                if (!(await confirmDialog({ title: `Remove ${m.name}?`, message: 'They are taken off upcoming visits and events, and clocked out if they are working. Past visits and time entries keep their history. To keep them in reports, mark them inactive instead.', confirmLabel: 'Remove', danger: true }))) return;
                const undo = removeTeamMember(store, m.id, { today: app.today(), stamp: toLocalStamp(new Date()) });
                toast(`${m.name} removed`, { action: { label: 'Undo', run: undo } });
              },
            },
            'Remove',
          )
      : null,
    onSubmit: (fd) => {
      store.put('team', {
        ...(m || {}),
        name: String(fd.get('name')).trim(),
        email: String(fd.get('email') || '').trim(),
        phone: String(fd.get('phone') || '').trim(),
        role: String(fd.get('role')),
        laborRate: parseMoney(String(fd.get('rate'))) ?? 0,
        color,
        active: m ? fd.get('active') === 'on' : true,
      });
      toast(m ? 'Team member updated' : 'Team member added');
    },
  });
}

function taxesSection() {
  const store = app.store;
  const s = app.settings();
  const taxes = s.taxes || [];
  const edit = (t = null) =>
    formDialog({
      title: t ? 'Edit tax rate' : 'New tax rate',
      submitLabel: t ? 'Save' : 'Add tax rate',
      body: h('div.form-grid', field('Name', textInput({ name: 'name', value: t?.name || '', placeholder: 'e.g. State sales tax', required: true })), field('Rate (%)', textInput({ name: 'rate', value: t ? String(t.rate) : '', inputmode: 'decimal', required: true, cls: 'num' }))),
      onSubmit: (fd) => {
        const rate = parseDecimal(String(fd.get('rate')));
        if (rate === null || rate < 0 || rate > 100) {
          toast('Enter a rate between 0 and 100', { type: 'error' });
          return false;
        }
        const rec = { id: t?.id || newId(), name: String(fd.get('name')).trim(), rate };
        const next = t ? taxes.map((x) => (x.id === t.id ? rec : x)) : [...taxes, rec];
        store.saveSettings({ taxes: next, defaultTaxId: s.defaultTaxId || (!t && taxes.length === 0 ? rec.id : s.defaultTaxId) });
        toast('Tax rates saved');
      },
    });
  return h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Tax rates'), h('button.btn.sm.primary', { type: 'button', onClick: () => edit() }, icon('plus', 14), 'Add tax rate')),
    h(
      'div.card-body.flush',
      taxes.length
        ? h(
            'ul.list',
            taxes.map((t) =>
              h(
                'li',
                h(
                  'div.list-item',
                  h('div.grow', h('div.title', t.name, s.defaultTaxId === t.id ? h('span.pill.accent.plain', { style: { marginLeft: '8px' } }, 'Default') : null), h('div.meta', `${t.rate}%`)),
                  s.defaultTaxId === t.id ? null : h('button.btn.sm.ghost', { type: 'button', onClick: () => store.saveSettings({ defaultTaxId: t.id }) }, 'Make default'),
                  h('button.btn.sm', { type: 'button', onClick: () => edit(t) }, 'Edit'),
                  h(
                    'button.icon-btn.sm',
                    {
                      type: 'button',
                      'aria-label': `Delete ${t.name}`,
                      onClick: async () => {
                        if (!(await confirmDialog({ title: `Delete ${t.name}?`, message: 'Documents that already use this rate keep it.', confirmLabel: 'Delete', danger: true }))) return;
                        store.saveSettings({ taxes: taxes.filter((x) => x.id !== t.id), defaultTaxId: s.defaultTaxId === t.id ? null : s.defaultTaxId });
                      },
                    },
                    icon('trash', 15),
                  ),
                ),
              ),
            ),
          )
        : emptyState({ compact: true, icon: 'percent', title: 'No tax rates', text: 'Add the sales tax you charge. The default rate is applied to new quotes, jobs and invoices.', headingLevel: 3 }),
    ),
  );
}

function documentsSection() {
  const s = app.settings();
  const form = h(
    'form.stack',
    { novalidate: true, style: { gap: '16px' } },
    h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Quotes')),
      h(
        'div.card-body.form-grid',
        field('Valid for (days)', textInput({ name: 'validDays', type: 'number', min: 1, value: String(s.quotes.validDays || 30), cls: 'num' })),
        field('Next quote number', textInput({ name: 'nQuote', type: 'number', min: 1, value: String(s.numbering?.quote || 1), cls: 'num' }), { hint: 'Used when it is higher than your last quote' }),
        field('Default client message', textarea({ name: 'qMessage', value: s.quotes.message || '', rows: 3 }), { span2: true }),
        field('Default terms', textarea({ name: 'qDisclaimer', value: s.quotes.disclaimer || '', rows: 3 }), { span2: true }),
      ),
    ),
    h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Invoices')),
      h(
        'div.card-body.form-grid',
        field('Default payment terms', select({ name: 'terms', value: s.invoices.terms, options: PAYMENT_TERMS.filter((t) => t.id !== 'custom').map((t) => ({ value: t.id, label: t.label })) })),
        field('Next invoice number', textInput({ name: 'nInvoice', type: 'number', min: 1, value: String(s.numbering?.invoice || 1), cls: 'num' })),
        field('Default client message', textarea({ name: 'iMessage', value: s.invoices.message || '', rows: 3 }), { span2: true }),
        field('Payment instructions and notes', textarea({ name: 'iDisclaimer', value: s.invoices.disclaimer || '', rows: 3, placeholder: 'e.g. Pay by bank transfer to...' }), { span2: true }),
      ),
    ),
    h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Jobs')),
      h(
        'div.card-body.form-grid',
        field('Default invoice reminder', select({ name: 'billing', value: s.jobs?.defaultBilling || 'on_completion', options: [{ value: 'on_completion', label: 'When the job is complete' }, { value: 'per_visit', label: 'After each visit' }, { value: 'none', label: 'Do not remind me' }] })),
        field('Next job number', textInput({ name: 'nJob', type: 'number', min: 1, value: String(s.numbering?.job || 1), cls: 'num' })),
      ),
    ),
    saveBar(),
  );
  const read = () => {
    const fd = new FormData(form);
    const g = (k) => String(fd.get(k) || '');
    const n = (k) => Math.max(1, Math.floor(Number(g(k)) || 1));
    return {
      quotes: { validDays: n('validDays'), message: g('qMessage'), disclaimer: g('qDisclaimer') },
      invoices: { terms: g('terms'), message: g('iMessage'), disclaimer: g('iDisclaimer') },
      jobs: { defaultBilling: g('billing') },
      numbering: { quote: n('nQuote'), invoice: n('nInvoice'), job: n('nJob') },
    };
  };
  let shown = read();
  const markSaved = trackForm(form);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const next = read();
    app.store.saveSettings(changedSettings(next, shown));
    shown = next;
    markSaved();
    toast('Document settings saved');
  });
  return form;
}

function listsSection() {
  const store = app.store;
  const s = app.settings();
  const sources = [...(s.leadSources || [])];
  const cats = [...(s.expenseCategories || [])];
  const srcInput = tagInput(sources);
  const catInput = tagInput(cats);
  const values = () => JSON.stringify([sources, cats, ...[srcInput, catInput].map((x) => x.querySelector('input').value.trim())]);
  let saved = values();
  unsaved = () => values() !== saved;
  let shown = { leadSources: [...sources], expenseCategories: [...cats] };
  const save = () => {
    const next = { leadSources: [...sources], expenseCategories: [...cats] };
    store.saveSettings(changedSettings(next, shown));
    shown = next;
    saved = values();
    toast('Lists saved');
  };
  return h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Lists')),
    h('div.card-body.stack', field('Lead sources', srcInput, { hint: 'Where new clients hear about you' }), field('Expense categories', catInput), h('div.row', { style: { justifyContent: 'flex-end' } }, h('button.btn.primary', { type: 'button', onClick: save }, 'Save lists'))),
  );
}

function appearanceSection() {
  return h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Appearance')),
    h(
      'div.card-body.stack',
      h('div.field', h('span.field-label', 'Theme'), segmented({ label: 'Theme', value: getThemeMode(), items: [{ value: 'system', label: 'System', icon: 'monitor' }, { value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }], onChange: (v) => setThemeMode(v) })),
      h('p.subtle', 'System follows your device setting. This preference is saved on this device.'),
      h('div', h('button.btn', { type: 'button', onClick: () => showShortcuts() }, icon('keyboard', 16), 'Keyboard shortcuts')),
    ),
  );
}

function dataSection() {
  const store = app.store;
  const s = app.settings();
  const counts = COLLECTIONS.map((c) => [c, store.all(c).length]);
  const total = counts.reduce((a, [, n]) => a + n, 0);
  const hasSample = COLLECTIONS.some((c) => store.all(c).some((r) => r.sample));

  const exportJSON = () => {
    const data = { format: 'field-service-backup', version: 1, exportedAt: new Date().toISOString(), settings: s, collections: Object.fromEntries(COLLECTIONS.map((c) => [c, store.all(c)])) };
    downloadText(`field-service-backup-${app.today()}.json`, JSON.stringify(data, null, 1), 'application/json');
    toast('Backup downloaded');
  };

  const importJSON = () => {
    const input = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        toast('That file is not valid JSON.', { type: 'error' });
        return;
      }
      // Check everything first, so a damaged file cannot leave a half-replaced account.
      const problem = validateBackup(data);
      if (problem) {
        toast(problem, { type: 'error' });
        return;
      }
      const n = Object.values(data.collections).reduce((a, l) => a + (Array.isArray(l) ? l.length : 0), 0);
      const ok = await confirmDialog({ title: 'Restore this backup?', message: `This replaces everything currently in your account (${pluralize(total, 'record')}) with the ${pluralize(n, 'record')} in the backup.`, confirmLabel: 'Replace and restore', danger: true });
      if (!ok) return;
      for (const c of COLLECTIONS) {
        store.bulkRemove(c, store.all(c).map((r) => r.id));
        if (Array.isArray(data.collections[c])) store.bulkPut(c, data.collections[c]);
      }
      if (data.settings) store.saveSettings({ ...data.settings, onboarded: true });
      toast(`Restored ${pluralize(n, 'record')}`);
    });
    document.body.append(input);
    input.click();
  };

  let adding = false;
  const loadSample = async () => {
    // Loading the sample data takes a moment; a second click must not add it twice.
    if (adding) return;
    adding = true;
    try {
      if (total && !(await confirmDialog({ title: 'Add sample data?', message: 'Sample clients, jobs and invoices are added next to your own records. You can remove them later from here.', confirmLabel: 'Add sample data' }))) return;
      await addSample();
    } finally {
      adding = false;
    }
  };

  const addSample = async () => {
    const { buildSampleData } = await import('../core/sample.js');
    const data = buildSampleData(app.today());
    for (const [c, recs] of Object.entries(data.collections)) {
      // Number sample quotes, jobs and invoices after your own, never as duplicates of them.
      const offset = store.all(c).reduce((max, r) => Math.max(max, Number(r.number) || 0), 0);
      store.bulkPut(c, recs.map((r) => ({ ...r, ...(r.number ? { number: r.number + offset } : null), sample: true })));
    }
    if (!s.company.name) store.saveSettings({ company: data.settings.company });
    toast('Sample data added');
  };

  const clearSample = async () => {
    if (!(await confirmDialog({ title: 'Remove sample data?', message: 'Only records that came from the sample data are deleted. Your own records stay.', confirmLabel: 'Remove sample data', danger: true }))) return;
    const removed = COLLECTIONS.flatMap((c) => store.all(c).filter((r) => r.sample));
    for (const c of COLLECTIONS) store.bulkRemove(c, store.all(c).filter((r) => r.sample).map((r) => r.id));
    deleteFilesOf(removed);
    // The sample business details go too, unless you have changed them since.
    const { buildSampleData } = await import('../core/sample.js');
    const sampleCompany = buildSampleData(app.today()).settings.company;
    const company = app.settings().company;
    if (company.name === sampleCompany.name && company.email === sampleCompany.email) store.saveSettings({ company: defaultSettings().company });
    toast('Sample data removed');
  };

  const deleteAll = async () => {
    const ok = await confirmDialog({ title: 'Delete all data?', message: `This permanently deletes ${total === 1 ? 'the only record' : `all ${total} records`} and resets settings. Download a backup first if you might need anything.`, confirmLabel: 'Delete everything', danger: true });
    if (!ok) return;
    const removed = COLLECTIONS.flatMap((c) => store.all(c));
    for (const c of COLLECTIONS) store.bulkRemove(c, store.all(c).map((r) => r.id));
    deleteFilesOf(removed);
    store.saveSettings({ ...defaultSettings(), onboarded: true });
    toast('All data deleted');
    navigate('/');
  };

  return h(
    'div.stack',
    { style: { gap: '16px' } },
    h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Your data')),
      h(
        'div.card-body.stack',
        h('p.muted', app.demo ? 'This is a demo. Nothing is saved to the cloud.' : 'Your records are stored in your own Puter account and cached on this device so the app works offline.'),
        h('dl.kv', counts.filter(([, n]) => n).map(([c, n]) => [h('dt', LABELS[c] || c), h('dd', String(n))])),
        h('div.row', { style: { flexWrap: 'wrap' } }, h('button.btn', { type: 'button', onClick: exportJSON }, icon('download', 16), 'Download backup'), h('button.btn', { type: 'button', onClick: importJSON }, icon('upload', 16), 'Restore from backup')),
        h('p.subtle', { style: { fontSize: '13px' } }, 'CSV exports are available from the Clients, Invoices, Payments, Expenses, Timesheets and Reports pages.'),
      ),
    ),
    h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Sample data')),
      h('div.card-body.stack', h('p.muted', 'Explore with a realistic sample business, then clear it when you are ready to start.'), h('div.row', hasSample ? h('button.btn', { type: 'button', onClick: clearSample }, icon('trash', 16), 'Remove sample data') : h('button.btn', { type: 'button', onClick: loadSample }, icon('sparkles', 16), 'Add sample data'))),
    ),
    h(
      'section.card',
      { style: { borderColor: 'color-mix(in srgb, var(--danger) 40%, var(--border))' } },
      h('div.card-head', h('h2.grow', 'Danger zone')),
      h('div.card-body.row', { style: { flexWrap: 'wrap' } }, h('p.grow.muted', 'Permanently delete every record and reset settings.'), h('button.btn.danger', { type: 'button', onClick: deleteAll }, 'Delete all data')),
    ),
  );
}

/** Delete the photos, documents and receipts of removed records (unless a remaining record uses them). */
function deleteFilesOf(records) {
  deleteAttachments([...records, ...records.filter((r) => r.receipt).map((r) => ({ attachments: [r.receipt] }))]);
}

const LABELS = { clients: 'Clients', requests: 'Requests', quotes: 'Quotes', jobs: 'Jobs', invoices: 'Invoices', payments: 'Payments', expenses: 'Expenses', timeEntries: 'Time entries', events: 'Tasks and events', team: 'Team members', products: 'Products and services' };

function aboutSection() {
  return h(
    'section.card',
    h('div.card-head', h('h2.grow', 'About Field Service')),
    h(
      'div.card-body.stack',
      h('div.row', h('img', { src: './icons/icon-192.png', alt: '', width: 48, height: 48, style: { borderRadius: '12px' } }), h('div', h('div', { style: { fontWeight: '700', fontSize: '16px' } }, 'Field Service'), h('div.subtle', 'Early alpha'))),
      h('p.muted', 'Free and open-source field service management, part of the Everything project. Built with vanilla JavaScript and Puter.'),
      h('div.notice.warning', icon('warning'), h('span', 'This app is in early development. Features may change and data could be lost, so keep backups and do not rely on it for real business records yet.')),
      h('div.row', { style: { flexWrap: 'wrap' } }, h('a.btn', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, icon('github', 16), 'Source code on GitHub'), h('a.btn.ghost', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener noreferrer' }, 'Powered by Puter', icon('external', 14))),
    ),
  );
}

const RENDER = {
  business: businessSection,
  products: productsSection,
  team: teamSection,
  taxes: taxesSection,
  documents: documentsSection,
  lists: listsSection,
  appearance: appearanceSection,
  data: dataSection,
  about: aboutSection,
};

export { statusPill };

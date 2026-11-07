/**
 * Settings: company, accounting, lease defaults, late fees, lists, team,
 * team sign-in, appearance, data, about. Every change saves on its own.
 */
import { h, uniqueId } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app } from '../app.js';
import { pageHeader, field, textInput, textarea, select, moneyInput, segmented } from '../ui/components.js';
import { getThemeMode, setThemeMode } from '../ui/theme.js';
import { LEASE_TYPES } from '../core/settings.js';
import { bankAccounts } from '../core/accounts.js';
import { money } from './common.js';
import { teamAccessCard } from './team-access.js';
import { teamSection } from './settings/team.js';
import { dataSection } from './settings/data.js';
import { listsSection } from './settings/lists.js';
import pkg from '../../package.json';

const REPO_URL = 'https://github.com/heyputer/everything';

export const SECTIONS = [
  { id: 'company', label: 'Company', icon: 'building' },
  { id: 'accounting', label: 'Accounting', icon: 'landmark' },
  { id: 'leases', label: 'Lease defaults', icon: 'file-signature' },
  { id: 'late-fees', label: 'Late fees', icon: 'percent' },
  { id: 'lists', label: 'Lists', icon: 'list' },
  { id: 'team', label: 'Team members', icon: 'users' },
  { id: 'access', label: 'Team sign-in', icon: 'lock' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'data', label: 'Data and backup', icon: 'database' },
  { id: 'about', label: 'About', icon: 'info' },
];

export function render(ctx) {
  const section = SECTIONS.some((s) => s.id === ctx.params.section) ? ctx.params.section : 'company';
  const meta = SECTIONS.find((s) => s.id === section);
  // Forms are not live: a sync must never wipe what someone is typing.
  const WATCH = { team: ['team'], data: ['properties', 'units', 'leases', 'tenants', 'owners', 'vendors', 'transactions', 'accounts', 'settings'], lists: [] };
  const content = ctx.live(() => RENDER[section](), WATCH[section] || []);
  const nav = h(
    'nav.settings-nav',
    { 'aria-label': 'Settings sections' },
    SECTIONS.map((s) => h('a', { href: `#/settings/${s.id}`, 'aria-current': s.id === section ? 'page' : null }, icon(s.icon, 17), s.label)),
  );
  requestAnimationFrame(() => nav.querySelector('[aria-current]')?.scrollIntoView?.({ inline: 'center', block: 'nearest' }));
  return {
    node: h('div.page.settings-page', pageHeader({ title: 'Settings' }), h('div.settings-layout', nav, h('div.stack.settings-content', h('h2.sr-only', meta.label), content))),
    title: `${meta.label} settings`,
  };
}

// ---- Saving ------------------------------------------------------------------------

/**
 * A card whose fields save on change. collect(form) returns the settings
 * patch. Shows "Saved" briefly in the card header.
 */
function autoCard({ title, intro, body, collect, after }) {
  const status = h('span.save-status', { role: 'status', 'aria-live': 'polite' });
  const form = h('form.card-body.stack', { novalidate: true, onSubmit: (e) => e.preventDefault() }, intro ? h('p.subtle', intro) : null, body, after || null);
  let timer;
  form.addEventListener('change', () => {
    const patch = collect(form);
    if (!patch) return;
    app.store.saveSettings(patch);
    status.replaceChildren(icon('check', 14), 'Saved');
    clearTimeout(timer);
    timer = setTimeout(() => status.replaceChildren(), 1800);
  });
  return h('section.card', h('div.card-head', h('h2.grow', title), status), form);
}

const val = (form, name) => String(new FormData(form).get(name) ?? '').trim();
const int = (form, name, min, max, fallback) => {
  const n = Math.floor(Number(val(form, name)));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function switchField(name, label, checked, hint) {
  const id = uniqueId('sw');
  return h('div.field.span-2', h('label.switch', { for: id }, h('input', { type: 'checkbox', role: 'switch', name, id, checked: !!checked }), h('span', label)), hint ? h('span.hint', hint) : null);
}

// ---- Sections ------------------------------------------------------------------------

function companySection() {
  const s = app.settings();
  const c = s.company || {};
  const f = (label, key, opts = {}) => field(label, textInput({ name: key, value: c[key] || '', type: opts.type || 'text', autocomplete: opts.ac || 'off' }), { span2: opts.span2 });
  return h(
    'div.stack.settings-stack',
    autoCard({
      title: 'Company details',
      intro: 'Shown on receipts, statements and printed reports.',
      body: h(
        'div.form-grid',
        f('Company name', 'name', { span2: true, ac: 'organization' }),
        f('Phone', 'phone', { type: 'tel', ac: 'tel' }),
        f('Email', 'email', { type: 'email', ac: 'email' }),
        f('Website', 'website', { ac: 'url' }),
        field('Mailing address', textarea({ name: 'address', value: c.address || '', rows: 3, autocomplete: 'street-address' }), { span2: true }),
      ),
      collect: (form) => ({ company: { name: val(form, 'name'), phone: val(form, 'phone'), email: val(form, 'email'), website: val(form, 'website'), address: String(new FormData(form).get('address') || '').trim() } }),
    }),
    autoCard({
      title: 'Regional',
      body: h(
        'div.form-grid',
        field('Currency', select({ name: 'currency', value: s.currency, options: ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'ZAR', 'INR', 'MXN', 'BRL', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK'].map((x) => ({ value: x, label: x })) })),
        field('Week starts on', select({ name: 'weekStart', value: String(s.weekStart || 0), options: [{ value: '0', label: 'Sunday' }, { value: '1', label: 'Monday' }, { value: '6', label: 'Saturday' }] })),
      ),
      collect: (form) => ({ currency: val(form, 'currency'), weekStart: Number(val(form, 'weekStart')) || 0 }),
    }),
  );
}

const MONTHS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: new Date(Date.UTC(2026, i, 1)).toLocaleDateString(undefined, { month: 'long', timeZone: 'UTC' }) }));

function accountingSection() {
  const a = app.settings().accounting || {};
  const banks = bankAccounts(app.store.all('accounts'));
  const bankOptions = banks.length ? banks.map((b) => ({ value: b.id, label: b.name })) : [{ value: '', label: 'No bank accounts yet' }];
  return autoCard({
    title: 'Accounting',
    intro: 'Books are kept on the accrual basis: rent counts as income when it is charged, and bills count as expenses when they are entered.',
    body: h(
      'div.form-grid',
      field('Operating bank account', select({ name: 'defaultBankId', value: a.defaultBankId || banks[0]?.id || '', options: bankOptions }), { hint: 'Receives rent when a property has no account of its own' }),
      field('Security deposit bank account', select({ name: 'depositBankId', value: a.depositBankId || banks[0]?.id || '', options: bankOptions }), { hint: 'Suggested when a deposit is received' }),
      field('Fiscal year starts in', select({ name: 'fiscalYearStart', value: String(a.fiscalYearStart || 1), options: MONTHS })),
      field('Post charges this many days early', textInput({ name: 'postDaysAhead', type: 'number', min: 0, max: 31, value: String(a.postDaysAhead ?? 0), cls: 'num' }), { hint: '0 posts each charge on its due date' }),
      switchField('autoPost', 'Post recurring charges automatically', a.autoPost !== false, 'Rent and other monthly charges are added to each lease when they come due, the next time anyone opens the app.'),
    ),
    collect: (form) => ({
      accounting: {
        defaultBankId: val(form, 'defaultBankId') || a.defaultBankId,
        depositBankId: val(form, 'depositBankId') || a.depositBankId,
        fiscalYearStart: int(form, 'fiscalYearStart', 1, 12, 1),
        postDaysAhead: int(form, 'postDaysAhead', 0, 31, 0),
        autoPost: form.querySelector('[name=autoPost]').checked,
      },
    }),
    after: banks.length ? null : h('p.subtle', 'Add a bank account under Accounting, Banking.'),
  });
}

function leasesSection() {
  const l = app.settings().leases || {};
  return autoCard({
    title: 'Lease defaults',
    intro: 'Used to fill in new leases. You can change them on each lease.',
    body: h(
      'div.form-grid',
      field('Lease type', select({ name: 'type', value: l.type || 'fixed-rollover', options: LEASE_TYPES.map((t) => ({ value: t.id, label: t.label })) })),
      field('Term in months', textInput({ name: 'termMonths', type: 'number', min: 1, max: 120, value: String(l.termMonths || 12), cls: 'num' })),
      field('Rent is due on day', select({ name: 'rentDay', value: String(l.rentDay || 1), options: Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: ordinal(i + 1) })) }), { hint: 'Of each month' }),
      field('Expiring lease window', select({ name: 'noticeDays', value: String(l.noticeDays || 60), options: [30, 45, 60, 90, 120].map((n) => ({ value: String(n), label: `${n} days` })) }), { hint: 'Leases ending within this window show on Renewals' }),
    ),
    collect: (form) => ({ leases: { type: val(form, 'type'), termMonths: int(form, 'termMonths', 1, 120, 12), rentDay: int(form, 'rentDay', 1, 28, 1), noticeDays: int(form, 'noticeDays', 1, 365, 60) } }),
  });
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function lateFeesSection() {
  const lf = app.settings().lateFee || {};
  const rentDay = app.settings().leases?.rentDay || 1;
  let kind = lf.kind === 'percent' ? 'percent' : 'flat';
  const amount = moneyInput({ name: 'amount', cents: lf.amount ?? 5000 });
  const percent = textInput({ name: 'percent', type: 'number', min: 0, max: 100, step: '0.5', value: String(lf.percent ?? 5), cls: 'num' });
  const amountField = field('Fee amount', amount);
  const percentField = field('Percent of monthly rent', percent);
  const example = h('div.notice.accent.late-example');
  const kindInput = h('input', { type: 'hidden', name: 'kind', value: kind });

  const paint = (form) => {
    amountField.hidden = kind !== 'flat';
    percentField.hidden = kind !== 'percent';
    const grace = int(form, 'graceDays', 0, 31, 5);
    const enabled = form.querySelector('[name=enabled]').checked;
    const rent = 150000;
    const fee = kind === 'percent' ? Math.round((rent * (Number(percent.value) || 0)) / 100) : amount.cents;
    example.replaceChildren(
      icon('info'),
      h('span', enabled ? `Example: rent of ${money(rent)} is due on the ${ordinal(rentDay)}. If at least ${money(Math.max(1, form.querySelector('[name=minBalance]').cents))} of it is still unpaid after the ${ordinal(Math.min(28, rentDay + grace))}, a ${money(fee)} late fee is added on the next day. At most one late fee is charged per month.` : 'Late fees are off. No late fees are charged automatically. You can still charge one by hand from a lease.'),
    );
  };

  const card = autoCard({
    title: 'Late fees',
    intro: 'Charged automatically when rent is still unpaid after the grace period. Each lease can turn late fees off or use its own amounts.',
    body: h(
      'div.form-grid',
      switchField('enabled', 'Charge late fees automatically', lf.enabled !== false),
      field('Grace period in days', textInput({ name: 'graceDays', type: 'number', min: 0, max: 31, value: String(lf.graceDays ?? 5), cls: 'num' }), { hint: 'Days after the due date before a fee is charged' }),
      h(
        'div.field',
        h('span.field-label', 'Fee type'),
        segmented({
          label: 'Fee type',
          value: kind,
          items: [
            { value: 'flat', label: 'Flat amount' },
            { value: 'percent', label: 'Percent of rent' },
          ],
          onChange: (v) => {
            kind = v;
            kindInput.value = v;
            kindInput.dispatchEvent(new Event('change', { bubbles: true }));
          },
        }),
        kindInput,
      ),
      amountField,
      percentField,
      field('Only when at least this much is unpaid', moneyInput({ name: 'minBalance', cents: lf.minBalance ?? 100 }), { hint: 'Avoids fees over a few cents' }),
    ),
    collect: (form) => {
      paint(form);
      return {
        lateFee: {
          enabled: form.querySelector('[name=enabled]').checked,
          graceDays: int(form, 'graceDays', 0, 31, 5),
          kind,
          amount: amount.cents,
          percent: Math.min(100, Math.max(0, Number(percent.value) || 0)),
          minBalance: form.querySelector('[name=minBalance]').cents,
        },
      };
    },
    after: example,
  });
  queueMicrotask(() => paint(card.querySelector('form')));
  amount.addEventListener('input', () => paint(card.querySelector('form')));
  percent.addEventListener('input', () => paint(card.querySelector('form')));
  return card;
}

function appearanceSection() {
  return h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Appearance')),
    h(
      'div.card-body.stack',
      h('div.field', h('span.field-label', 'Theme'), segmented({ label: 'Theme', value: getThemeMode(), items: [{ value: 'system', label: 'System', icon: 'monitor' }, { value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }], onChange: (v) => setThemeMode(v) })),
      h('p.subtle', 'System follows your device setting. This preference is saved on this device.'),
      h('div', h('button.btn', { type: 'button', onClick: () => import('../ui/shell.js').then((m) => m.showShortcuts()) }, icon('keyboard', 16), 'Keyboard shortcuts')),
    ),
  );
}

function accessSection() {
  return h(
    'div.stack.settings-stack',
    h('p.subtle.settings-lead', 'Let property managers, leasing agents and bookkeepers sign in with their own Puter accounts and work on the same company. Everyone sees the same properties, leases and books.'),
    teamAccessCard(),
  );
}

function aboutSection() {
  return h(
    'section.card',
    h('div.card-head', h('h2.grow', 'About Property Management')),
    h(
      'div.card-body.stack',
      h('div.row', h('img', { src: './icons/icon-192.png', alt: '', width: 48, height: 48, style: { borderRadius: '12px' } }), h('div', h('div.about-name', 'Property Management'), h('div.subtle', `Version ${pkg.version} · Early alpha`))),
      h('p.muted', 'Free and open-source property management: properties, leases, rent, accounting, maintenance and reports. Part of the Everything project, built with plain JavaScript and Puter.'),
      h('div.notice.warning', icon('warning'), h('span', 'This app is in early development. Features may change and data could be lost, so keep backups and do not use it for real tenant, lease or accounting records yet.')),
      h(
        'div.row.wrap',
        h('a.btn', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, icon('github', 16), 'Source code on GitHub'),
        h('a.btn.ghost', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener noreferrer' }, 'Powered by Puter', icon('external', 14)),
      ),
      h('h3.about-sub', 'Open-source components'),
      h('ul.about-list', h('li', 'Lucide icons, ISC license')),
    ),
  );
}

const RENDER = {
  company: companySection,
  accounting: accountingSection,
  leases: leasesSection,
  'late-fees': lateFeesSection,
  lists: listsSection,
  team: teamSection,
  access: accessSection,
  appearance: appearanceSection,
  data: dataSection,
  about: aboutSection,
};

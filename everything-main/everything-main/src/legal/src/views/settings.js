/**
 * Settings: firm details, users, billing rules, practice areas and stages,
 * categories, task lists, lists, team sign-in, appearance, and data.
 * Changes save automatically.
 */
import '../styles/settings.css';
import { h, debounce } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app } from '../app.js';
import { navigate } from '../ui/router.js';
import { confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { pageHeader, card, field, textInput, textarea, select, moneyInput, toggle, segmented } from '../ui/components.js';
import { getThemeMode, setThemeMode } from '../ui/theme.js';
import { NUMBER_FORMATS } from '../core/settings.js';
import { displayNumber } from '../core/matters.js';
import { usersSection } from './settings-users.js';
import { practiceSection, categoriesSection, listsSection } from './settings-practice.js';
import { taskListsSection } from './settings-tasks.js';
import { teamSection } from './settings-team.js';
import { dataSection } from './settings-data.js';
import { CURRENCIES } from './settings-currencies.js';
import { customFieldsSection } from './settings-fields.js';

const SECTIONS = [
  { id: 'firm', label: 'Firm', icon: 'building' },
  { id: 'users', label: 'Users', icon: 'users' },
  { id: 'billing', label: 'Billing', icon: 'receipt-text' },
  { id: 'practice', label: 'Practice areas and stages', icon: 'scale' },
  { id: 'categories', label: 'Activity categories', icon: 'tag' },
  { id: 'tasks', label: 'Task lists', icon: 'list-todo' },
  { id: 'lists', label: 'Documents and contacts', icon: 'list' },
  { id: 'fields', label: 'Custom fields', icon: 'sliders' },
  { id: 'team', label: 'Team sign-in', icon: 'shield-check' },
  { id: 'appearance', label: 'Appearance', icon: 'sun' },
  { id: 'data', label: 'Data and backup', icon: 'database' },
];

export function render(ctx) {
  const section = SECTIONS.find((s) => s.id === ctx.params.section) || SECTIONS[0];
  const saved = h('span.save-state.subtle.small', { role: 'status', 'aria-live': 'polite' }, 'Changes save automatically');
  let savedTimer;
  const markSaved = () => {
    saved.textContent = 'Saved';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (saved.textContent = 'Changes save automatically'), 2500);
  };

  const nav = h(
    'nav.settings-nav',
    { 'aria-label': 'Settings sections' },
    h(
      'ul',
      SECTIONS.map((s) => h('li', h('a.settings-link', { href: `#/settings/${s.id}`, 'aria-current': s.id === section.id ? 'page' : null }, icon(s.icon, 17), h('span', s.label)))),
    ),
  );
  const navSelect = select({ name: 'section', value: section.id, 'aria-label': 'Settings section', options: SECTIONS.map((s) => ({ value: s.id, label: s.label })) });
  navSelect.addEventListener('change', () => navigate(`/settings/${navSelect.value}`));

  let content;
  let dispose = null;
  switch (section.id) {
    case 'users':
      content = usersSection(ctx);
      break;
    case 'billing':
      content = billingSection(markSaved);
      break;
    case 'practice': {
      const out = practiceSection();
      content = out.node;
      dispose = out.dispose || null;
      break;
    }
    case 'categories':
      content = categoriesSection();
      break;
    case 'tasks':
      content = taskListsSection(ctx);
      break;
    case 'lists':
      content = listsSection();
      break;
    case 'fields':
      content = customFieldsSection(ctx);
      break;
    case 'team':
      content = teamSection(ctx);
      break;
    case 'appearance':
      content = appearanceSection();
      break;
    case 'data':
      content = dataSection();
      break;
    default:
      content = firmSection(markSaved);
  }

  return {
    title: `${section.label} settings`,
    dispose,
    node: h(
      'div.page.settings-page',
      pageHeader({ title: 'Settings', after: saved }),
      h('div.settings-mobile-nav', field('Section', navSelect)),
      h('div.settings-layout', nav, h('div.settings-content', h('h2.settings-section-title', icon(section.icon, 18), section.label), content)),
    ),
  };
}

/** Save a settings patch after typing pauses, and right away on change. */
function autosave(el, toPatch, markSaved, { event = 'input', delay = 450 } = {}) {
  const run = () => {
    const patch = toPatch(el);
    if (patch) {
      app.store.saveSettings(patch);
      markSaved();
    }
  };
  if (event === 'input') {
    const later = debounce(run, delay);
    el.addEventListener('input', later);
    el.addEventListener('change', () => {
      later.cancel();
      run();
    });
  } else el.addEventListener(event, run);
  return el;
}

// ---- Firm --------------------------------------------------------------------------------

function firmSection(markSaved) {
  const s = app.settings();
  const f = s.firm;
  const text = (key, label, opts = {}) => {
    const input = textInput({ name: key, value: f[key] || '', ...opts });
    autosave(input, (el) => ({ firm: { [key]: el.value.trim() } }), markSaved);
    return field(label, input, opts.hint ? { hint: opts.hint } : {});
  };
  const currency = select({
    name: 'currency',
    value: s.currency,
    options: CURRENCIES.some(([c]) => c === s.currency)
      ? CURRENCIES.map(([c, n]) => ({ value: c, label: `${c}, ${n}` }))
      : [{ value: s.currency, label: s.currency }, ...CURRENCIES.map(([c, n]) => ({ value: c, label: `${c}, ${n}` }))],
  });
  autosave(currency, (el) => ({ currency: el.value }), markSaved, { event: 'change' });
  const week = select({
    name: 'weekStart',
    value: String(s.weekStart || 0),
    options: [
      { value: '0', label: 'Sunday' },
      { value: '1', label: 'Monday' },
      { value: '6', label: 'Saturday' },
    ],
  });
  autosave(week, (el) => ({ weekStart: Number(el.value) }), markSaved, { event: 'change' });
  const dayStart = textInput({ name: 'start', type: 'time', value: s.workday?.start || '08:00' });
  const dayEnd = textInput({ name: 'end', type: 'time', value: s.workday?.end || '18:00' });
  const saveDay = (el) => {
    if (!dayStart.value || !dayEnd.value) return null;
    const ok = dayStart.value < dayEnd.value;
    for (const x of [dayStart, dayEnd]) x.removeAttribute('aria-invalid');
    if (!ok) {
      el.setAttribute('aria-invalid', 'true');
      toast('The workday must end after it starts.', { type: 'error' });
      return null;
    }
    return { workday: { start: dayStart.value, end: dayEnd.value } };
  };
  autosave(dayStart, saveDay, markSaved, { event: 'change' });
  autosave(dayEnd, saveDay, markSaved, { event: 'change' });
  return h(
    'div.stack',
    card({
      title: 'Firm details',
      body: h(
        'div.stack',
        h('p.subtle', 'Shown on bills, statements, and generated documents.'),
        h('div.grid-2', text('name', 'Firm name', { autocomplete: 'organization' }), text('taxId', 'Tax ID')),
        h('div.grid-2', text('phone', 'Phone', { type: 'tel', autocomplete: 'tel' }), text('email', 'Email', { type: 'email', autocomplete: 'email' })),
        text('website', 'Website', { type: 'url', placeholder: 'example.com' }),
      ),
    }),
    card({
      title: 'Address',
      body: h(
        'div.stack',
        text('street', 'Street address', { autocomplete: 'street-address' }),
        h('div.grid-2', text('city', 'City'), text('region', 'State or province')),
        h('div.grid-2', text('postal', 'Postal code', { autocomplete: 'postal-code' }), text('country', 'Country', { autocomplete: 'country-name' })),
      ),
    }),
    card({
      title: 'Regional',
      body: h(
        'div.stack',
        h('div.grid-2', field('Currency', currency, { hint: 'Used for every amount in the app.' }), field('Week starts on', week)),
        h('div.grid-2', field('Workday starts', dayStart), field('Workday ends', dayEnd, { hint: 'The calendar opens to these hours.' })),
      ),
    }),
  );
}

// ---- Billing -------------------------------------------------------------------------------

function billingSection(markSaved) {
  const s = app.settings();
  const b = s.billing;
  const inc = select({
    name: 'increment',
    value: String(b.increment || 6),
    options: [
      { value: '1', label: '1 minute (exact)' },
      { value: '6', label: '6 minutes (tenth of an hour)' },
      { value: '10', label: '10 minutes (sixth of an hour)' },
      { value: '15', label: '15 minutes (quarter hour)' },
    ],
  });
  autosave(inc, (el) => ({ billing: { increment: Number(el.value) } }), markSaved, { event: 'change' });
  const rate = moneyInput({ name: 'rate', cents: b.defaultRateCents || 0 });
  autosave(
    rate,
    (el) => {
      // A negative rate would turn every new time entry into a credit.
      const bad = el.cents < 0;
      if (bad) {
        el.setAttribute('aria-invalid', 'true');
        toast('The default hourly rate cannot be negative.', { type: 'error' });
      } else el.removeAttribute('aria-invalid');
      return bad ? null : { billing: { defaultRateCents: el.cents } };
    },
    markSaved,
    { event: 'change' },
  );
  const terms = textInput({ name: 'terms', type: 'number', min: '0', max: '365', step: '1', value: String(b.termsDays ?? 30), cls: 'num' });
  autosave(terms, (el) => (el.value === '' ? null : { billing: { termsDays: Math.max(0, Math.min(365, Math.round(Number(el.value) || 0))) } }), markSaved);
  const taxName = textInput({ name: 'taxName', value: b.taxName || 'Tax' });
  autosave(taxName, (el) => ({ billing: { taxName: el.value.trim() || 'Tax' } }), markSaved);
  const taxRate = textInput({ name: 'taxRate', type: 'number', min: '0', max: '100', step: '0.01', value: String(b.taxRate || 0), cls: 'num' });
  autosave(taxRate, (el) => (el.value === '' ? null : { billing: { taxRate: Math.max(0, Math.min(100, Number(el.value) || 0)) } }), markSaved);
  const taxExp = toggle({ name: 'taxExpenses', label: 'Also tax expenses', checked: !!b.taxExpenses, onChange: (v) => (app.store.saveSettings({ billing: { taxExpenses: v } }), markSaved()) });
  const keeper = toggle({
    name: 'showTimekeeper',
    label: 'Show who did the work on each bill line',
    checked: b.showTimekeeper !== false,
    onChange: (v) => (app.store.saveSettings({ billing: { showTimekeeper: v } }), markSaved()),
  });
  const message = textarea({ name: 'message', value: b.message || '', rows: 3 });
  autosave(message, (el) => ({ billing: { message: el.value } }), markSaved);

  const n = s.numbering || {};
  const fmt = select({ name: 'format', value: n.format || 'number-client', options: NUMBER_FORMATS.map((x) => ({ value: x.id, label: x.label })) });
  autosave(fmt, (el) => ({ numbering: { format: el.value } }), markSaved, { event: 'change' });
  const nextMatter = textInput({ name: 'nextMatter', type: 'number', min: '1', step: '1', value: String(n.matter || 1), cls: 'num' });
  autosave(nextMatter, (el) => (Number(el.value) >= 1 ? { numbering: { matter: Math.round(Number(el.value)) } } : null), markSaved);
  const nextBill = textInput({ name: 'nextBill', type: 'number', min: '1', step: '1', value: String(n.bill || 1), cls: 'num' });
  autosave(nextBill, (el) => (Number(el.value) >= 1 ? { numbering: { bill: Math.round(Number(el.value)) } } : null), markSaved);

  const renumber = async () => {
    const matters = app.store.all('matters');
    if (!matters.length) return;
    const format = app.settings().numbering?.format || 'number-client';
    const ok = await confirmDialog({
      title: 'Update existing matter numbers?',
      message: `All ${matters.length} matters will show their number in the "${NUMBER_FORMATS.find((x) => x.id === format)?.label}" format. The numbers themselves do not change.`,
      confirmLabel: 'Update numbers',
    });
    if (!ok) return;
    const changed = matters
      .map((m) => ({ ...m, displayNumber: displayNumber(m.number, { format, client: app.store.get('contacts', m.clientId), openDate: m.openDate }) }))
      .filter((m, i) => m.displayNumber !== matters[i].displayNumber);
    if (changed.length) app.store.bulkPut('matters', changed);
    toast(changed.length ? `${changed.length} matter numbers updated` : 'Matter numbers already match this format');
  };

  return h(
    'div.stack',
    card({
      title: 'Time and rates',
      body: h(
        'div.stack',
        h(
          'div.grid-2',
          field('Billing increment', inc, { hint: 'Time entries round up to this increment.' }),
          field('Default hourly rate', rate, { hint: 'Used when neither the matter nor the user has a rate.' }),
        ),
      ),
    }),
    card({
      title: 'Bills',
      body: h(
        'div.stack',
        h('div.grid-2', field('Payment terms (days)', terms, { hint: 'Bills are due this many days after they are issued.' }), field('Tax name', taxName)),
        h('div.grid-2', field('Tax rate (%)', taxRate, { hint: 'Applied to fees after discounts. Use 0 for no tax.' }), h('div.field.toggle-field', taxExp)),
        keeper,
        field('Default message on bills', message),
      ),
    }),
    card({
      title: 'Numbering',
      body: h(
        'div.stack',
        h('div.grid-3', field('Matter number format', fmt), field('Next matter number', nextMatter), field('Next bill number', nextBill)),
        h('p.subtle.small', 'Numbers never go backwards: if a higher number is already in use, the next one continues after it.'),
        h('div', h('button.btn', { type: 'button', onClick: renumber }, icon('refresh', 15), 'Apply format to existing matters')),
      ),
    }),
  );
}

// ---- Appearance --------------------------------------------------------------------------------

function appearanceSection() {
  return card({
    title: 'Theme',
    body: h(
      'div.stack',
      h('p.subtle', 'System follows your device and switches automatically between light and dark.'),
      segmented({
        label: 'Theme',
        value: getThemeMode(),
        items: [
          { value: 'system', label: 'System', icon: 'monitor' },
          { value: 'light', label: 'Light', icon: 'sun' },
          { value: 'dark', label: 'Dark', icon: 'moon' },
        ],
        onChange: (v) => setThemeMode(v),
      }),
      h('p.subtle.small', 'The theme is remembered on this device.'),
    ),
  });
}

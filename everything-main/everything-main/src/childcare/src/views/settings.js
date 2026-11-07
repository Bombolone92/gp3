/** Settings: school details, access and privacy, staff and family access, billing, lists, kiosk, appearance, and data. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { pageHeader, card, field, textInput, textarea, select, segmented, moneyInput } from '../ui/components.js';
import { confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { navigate } from '../ui/router.js';
import { app, isFamily, isManager } from '../app.js';
import { getThemeMode, setThemeMode } from '../ui/theme.js';
import { COLLECTIONS, PARTITIONED, monthMetaKey, PREFIX } from '../core/keys.js';
import { addMonths, startOfMonth } from '../core/dates.js';
import { downloadText } from '../core/csv.js';
import { personName } from '../core/format.js';
import { accessCard } from './access.js';
import { sha256Hex } from './kiosk.js';

const REPO_URL = 'https://github.com/heyputer/everything';

const SECTIONS = [
  { id: 'school', label: 'School', icon: 'school', manager: true },
  { id: 'access', label: 'Staff and family access', icon: 'key' },
  { id: 'privacy', label: 'Family permissions', icon: 'shield', manager: true },
  { id: 'billing', label: 'Billing', icon: 'wallet', manager: true },
  { id: 'lists', label: 'Lists', icon: 'list', manager: true },
  { id: 'kiosk', label: 'Kiosk', icon: 'tablet', manager: true },
  { id: 'profile', label: 'My contact details', icon: 'user', family: true },
  { id: 'appearance', label: 'Appearance', icon: 'sun' },
  { id: 'data', label: 'Backup and data', icon: 'database', manager: true },
  { id: 'about', label: 'About', icon: 'info' },
];

export function render(ctx) {
  const visible = SECTIONS.filter((s) => (!s.manager || isManager()) && (!s.family || isFamily()) && !(isFamily() && s.id === 'access' && !app.team));
  const section = visible.find((s) => s.id === ctx.params.section) || visible[0];
  const nav = h(
    'nav.settings-nav',
    { 'aria-label': 'Settings sections' },
    visible.map((s) => h('a', { href: `#/settings/${s.id}`, 'aria-current': s.id === section.id ? 'page' : null }, icon(s.icon, 17), s.label)),
  );
  // Every save (and every sync) redraws the section: keep focus, and any
  // typing not saved yet, on the same control.
  let content;
  content = ctx.live(() => {
    const keep = content && snapshot(content);
    const out = SECTION_VIEWS[section.id]();
    if (keep) queueMicrotask(() => restore(content, keep));
    return out;
  }, section.id === 'access' ? ['settings'] : ['settings', 'guardians']);
  content.addEventListener('input', (e) => (e.target.dataset.unsaved = '1'));
  content.addEventListener('change', (e) => delete e.target.dataset.unsaved);
  return { node: h('div.page', pageHeader({ title: 'Settings' }), h('div.settings', nav, h('div.settings-body', content))), title: `${section.label} · Settings` };
}

const CONTROLS = 'input, select, textarea, button, a[href]';

function snapshot(root) {
  const el = document.activeElement;
  if (!el || !root.contains(el)) return null;
  const typed = el.dataset.unsaved ? { value: el.value, start: el.selectionStart, end: el.selectionEnd } : null;
  return { index: [...root.querySelectorAll(CONTROLS)].indexOf(el), typed };
}

function restore(root, { index, typed }) {
  const el = root.querySelectorAll(CONTROLS)[index];
  if (!el) return;
  // The live region may already have focused the same control; its typing still needs putting back.
  const active = document.activeElement;
  if (active !== el && root.contains(active) && active !== root) return;
  if (typed && 'value' in el) {
    el.value = typed.value;
    el.dataset.unsaved = '1';
    try {
      el.setSelectionRange(typed.start, typed.end);
    } catch {
      /* email and number inputs have no selection */
    }
  }
  el.focus({ preventScroll: true });
}

function save(changes, msg = 'Saved') {
  app.store.saveSettings(changes);
  toast(msg);
}

/** A text field that saves on change. path: ['school', 'name'] */
function bound(path, opts = {}) {
  const s = app.settings();
  const cur = path.reduce((o, k) => o?.[k], s);
  const i = opts.multiline ? textarea({ value: cur ?? '', rows: 3 }) : textInput({ value: cur ?? '', ...opts });
  i.addEventListener('change', () => {
    // Whole numbers no lower than the field's min: a negative due days would make statements due before they are issued.
    const val = opts.type === 'number' ? Math.max(Number(opts.min) || 0, Math.round(Number(i.value) || 0)) : i.value.trim();
    const patch = path.length === 1 ? { [path[0]]: val } : { [path[0]]: { [path[1]]: val } };
    save(patch);
  });
  return i;
}

const SECTION_VIEWS = {
  school() {
    const s = app.settings();
    const currency = select({ options: ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'MXN', 'INR', 'ZAR', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'BRL'].map((c) => ({ value: c, label: c })), value: s.currency });
    currency.addEventListener('change', () => save({ currency: currency.value }));
    const week = select({ options: [{ value: '0', label: 'Sunday' }, { value: '1', label: 'Monday' }], value: String(s.weekStart ?? 0) });
    week.addEventListener('change', () => save({ weekStart: Number(week.value) }));
    return [
      card({
        title: 'School details',
        body: h('div.form-grid', field('School name', bound(['school', 'name'], { placeholder: 'Sunny Days Early Learning' }), { span2: true }), field('Phone', bound(['school', 'phone'], { type: 'tel' })), field('Email', bound(['school', 'email'], { type: 'email' })), field('Website', bound(['school', 'website'])), field('License number', bound(['school', 'licenseNumber'])), field('Address', bound(['school', 'address']), { span2: true })),
      }),
      card({ title: 'Hours and region', body: h('div.form-grid', field('Opens', bound(['hours', 'open'], { type: 'time' })), field('Closes', bound(['hours', 'close'], { type: 'time' }), { hint: 'Children still checked in after closing are flagged on Home.' }), field('Currency', currency), field('Week starts on', week)) }),
    ];
  },
  access() {
    return accessCard();
  },
  privacy() {
    const a = app.settings().access || {};
    const sw = (key, label, hint) => {
      const c = h('input', { type: 'checkbox', checked: !!a[key], onChange: () => save({ access: { [key]: c.checked } }) });
      return h('label.switch-row', h('span.grow', h('span.switch-label', label), h('span.hint', hint)), h('span.switch', c));
    };
    return card({
      title: 'What families can do',
      body: h(
        'div.switch-list',
        sw('staffOnlyByDefault', 'New activities are staff only', 'Teachers share each entry with families when it is ready. Incidents and medications are always shared.'),
        sw('parentsCanEditInfo', 'Families can update health details', 'Allergies, medications, conditions, doctor, and address.'),
        sw('parentsCanReportAbsence', 'Families can report absences', 'From the family app, before the child arrives.'),
        sw('parentsCanMessage', 'Families can send messages', 'Turn off to make conversations read-only for families.'),
      ),
    });
  },
  billing() {
    const s = app.settings();
    const late = moneyInput({ cents: s.billing?.lateFeeCents || 0 });
    late.addEventListener('change', () => save({ billing: { lateFeeCents: late.cents } }));
    const msg = textarea({ value: s.billing?.message || '', rows: 3 });
    msg.addEventListener('change', () => save({ billing: { message: msg.value.trim() } }));
    return card({
      title: 'Statements',
      body: h('div.form-grid', field('Days until due', bound(['billing', 'dueDays'], { type: 'number', min: '0' })), field('Next statement number', bound(['numbering', 'invoice'], { type: 'number', min: '1' })), field('Late fee', late, { hint: 'Add it to a statement as a line when needed.' }), field('Message on statements', msg, { span2: true, hint: 'How to pay: bank details, check payable to, or a payment link.' })),
    });
  },
  lists() {
    const list = (key, label, hint) => {
      const t = textarea({ value: (app.settings()[key] || []).join('\n'), rows: 6 });
      t.addEventListener('change', () => {
        const items = [...new Set(t.value.split('\n').map((x) => x.trim()).filter(Boolean))];
        if (items.length) return save({ [key]: items });
        // Meals, reasons, and incident types are picked from these lists, so one cannot be emptied.
        t.value = (app.settings()[key] || []).join('\n');
        delete t.dataset.unsaved;
        toast(`${label} needs at least one item. The list was not changed.`, { type: 'error' });
      });
      return field(label, t, { hint });
    };
    return card({ title: 'Lists', body: h('div.form-grid', list('mealTypes', 'Meals', 'One per line, in the order of the day.'), list('absenceReasons', 'Absence reasons', 'One per line.'), list('incidentTypes', 'Incident types', 'One per line.')) });
  },
  kiosk() {
    const s = app.settings();
    const pin = textInput({ type: 'password', inputmode: 'numeric', maxlength: '4', pattern: '[0-9]{4}', placeholder: '4 digits', autocomplete: 'new-password' });
    return card({
      title: 'Check-in kiosk',
      body: h(
        'div.stack',
        h('p', 'Put a tablet at the door, open the kiosk, and families check their children in and out with their own 4-digit PIN. You can find each family\'s PIN on the child\'s Family tab.'),
        h('div.row', h('a.btn.primary', { href: '#/kiosk' }, icon('tablet', 16), 'Open the kiosk')),
        field('Exit PIN', h('div.row', pin, h('button.btn', { type: 'button', onClick: async () => { if (!/^\d{4}$/.test(pin.value)) return toast('Enter 4 digits.', { type: 'error' }); save({ kioskPinHash: await sha256Hex(pin.value) }, 'Exit PIN set'); pin.value = ''; } }, 'Set PIN'), s.kioskPinHash ? h('button.btn.ghost', { type: 'button', onClick: () => save({ kioskPinHash: '' }, 'Exit PIN removed') }, 'Remove') : null), { hint: s.kioskPinHash ? 'Leaving the kiosk asks for this PIN.' : 'Optional. Without it, anyone can leave the kiosk.' }),
      ),
    });
  },
  profile() {
    const store = app.store;
    const g = store.get('guardians', app.me.guardianId);
    if (!g) return card({ title: 'My contact details', body: h('p.subtle', 'Your school has not linked your account to a family profile yet.') });
    const inp = (k, type) => {
      const i = textInput({ value: g[k] || '', type });
      i.addEventListener('change', () => (store.patch('guardians', g.id, { [k]: i.value.trim() }), toast('Saved')));
      return i;
    };
    return card({ title: 'My contact details', body: h('div.stack', h('p.subtle', `${personName(g)}${g.relation ? `, ${g.relation}` : ''}. The school uses these to reach you.`), h('div.form-grid', field('Phone', inp('phone', 'tel')), field('Email', inp('email', 'email'))), g.pin ? h('p', 'Your kiosk PIN: ', h('strong.pin', g.pin)) : null) });
  },
  appearance() {
    return card({
      title: 'Appearance',
      body: h('div.field', h('span.field-label', 'Theme'), segmented({ label: 'Theme', items: [{ value: 'system', label: 'System', icon: 'monitor' }, { value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }], value: getThemeMode(), onChange: (v) => setThemeMode(v) })),
    });
  },
  data() {
    return [
      card({
        title: 'Backup',
        body: h('div.stack', h('p', 'Download everything (children, families, staff, attendance, activity logs, messages, and billing) as a single file. Photos and documents are not included.'), h('div.row', h('button.btn', { type: 'button', onClick: exportBackup }, icon('download', 16), 'Download backup'), h('button.btn', { type: 'button', onClick: importBackup }, icon('upload', 16), 'Restore from backup'))),
      }),
      app.store.all('students').length === 0 && !app.demo
        ? card({ title: 'Try it with sample data', body: h('div.stack', h('p', 'Fill your empty school with a sample center to explore. You can delete it later by restoring an empty backup.'), h('div.row', h('button.btn', { type: 'button', onClick: loadSample }, icon('sprout', 16), 'Load sample data'))) })
        : null,
    ];
  },
  about() {
    return card({
      title: 'About',
      body: h(
        'div.stack',
        h('p', 'Childcare is free and open-source childcare center management, part of the Everything project. Your data is stored in your own Puter account.'),
        h('div.notice.warning', icon('warning'), h('span', 'This app is in early development. Features may change and data could be lost, so keep backups and do not rely on it for real records yet.')),
        h('div.row', h('a.btn', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, icon('github', 16), 'Source code on GitHub'), h('a.btn.ghost', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener noreferrer' }, 'Powered by Puter')),
      ),
    });
  },
};

/** Every partition known from the versions, back to the oldest record (and at least two years). */
async function allPartitions() {
  const store = app.store;
  const month = startOfMonth(app.today());
  let oldest = addMonths(month, -23);
  for (const c of COLLECTIONS) {
    for (const r of store.all(c)) {
      for (const d of [r.createdAt, r.date, r.issueDate]) {
        const day = typeof d === 'string' ? d.slice(0, 10) : '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day < oldest) oldest = day;
      }
    }
  }
  const keys = [`${PREFIX}meta:m`];
  for (let m = month; m >= startOfMonth(oldest) && keys.length <= 600; m = addMonths(m, -1)) keys.push(monthMetaKey(m.slice(0, 7)));
  // Without the versions the backup would quietly leave out whatever is not loaded here.
  if (!(await store.peekMeta(keys))) throw new Error('The backup could not read all your records. Check your connection and try again.');
  return PARTITIONED.flatMap((b) => store.knownPartitions(b));
}

async function exportBackup() {
  const store = app.store;
  toast('Preparing backup...', { type: 'info' });
  try {
    const parts = await allPartitions();
    const data = await store.read(parts);
    const backup = { format: 'childcare-backup', version: 1, exportedAt: new Date().toISOString(), settings: store.state.settings, collections: { ...Object.fromEntries(COLLECTIONS.map((c) => [c, store.all(c)])), ...data } };
    downloadText(`childcare-backup-${app.today()}.json`, JSON.stringify(backup), 'application/json');
    toast('Backup downloaded');
  } catch (err) {
    toast(err.message || 'The backup could not be created.', { type: 'error' });
  }
}

function importBackup() {
  const input = h('input', { type: 'file', accept: '.json,application/json' });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return toast('That file could not be read.', { type: 'error' });
    }
    if (data?.format !== 'childcare-backup' || !data.collections) return toast('That file is not a Childcare backup.', { type: 'error' });
    const n = Object.values(data.collections).reduce((s, l) => s + (Array.isArray(l) ? l.length : 0), 0);
    const ok = await confirmDialog({ title: 'Restore this backup?', message: `This adds or replaces ${n} records from the backup. Records that are not in the backup stay as they are.`, confirmLabel: 'Restore', danger: true });
    if (!ok) return;
    const store = app.store;
    for (const [name, list] of Object.entries(data.collections)) {
      if (!Array.isArray(list) || !list.length) continue;
      try {
        store.bulkPut(name, list.filter((r) => r && r.id));
      } catch {
        /* unknown collection in a newer backup */
      }
    }
    if (data.settings) store.saveSettings(data.settings);
    toast(`Restored ${n} records`);
  });
  input.click();
}

async function loadSample() {
  const { buildSampleData } = await import('../core/sample.js');
  const sample = buildSampleData(app.today());
  const store = app.store;
  for (const [name, list] of Object.entries(sample.collections)) store.bulkPut(name, list);
  store.saveSettings({ ...sample.settings, school: { ...sample.settings.school } });
  toast('Sample school loaded');
  navigate('/');
}

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, canManageSettings } from '../app.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { confirmDialog, openDialog } from '../ui/dialog.js';
import { buildForm } from '../ui/form.js';
import { segmented } from '../ui/components.js';
import { getThemeMode, setThemeMode } from '../ui/theme.js';
import { CURRENCIES, STATUS_COLORS, defaultSettings } from '../core/settings.js';
import { COLLECTIONS } from '../core/schema.js';
import { newId } from '../core/ids.js';
import { downloadText } from '../core/csv.js';
import { teamAccessCard } from './team-access.js';
import { loadSampleData, removeSampleData, sampleCount } from './sample-data.js';
import { REPO_URL } from '../ui/shell.js';

const SECTIONS = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'vehicles', label: 'Vehicles', icon: 'truck' },
  { id: 'lists', label: 'Lists', icon: 'list' },
  { id: 'team', label: 'Team access', icon: 'users' },
  { id: 'appearance', label: 'Appearance', icon: 'sun' },
  { id: 'data', label: 'Data', icon: 'database' },
];

export function render(ctx) {
  const section = SECTIONS.some((s) => s.id === ctx.params.section) ? ctx.params.section : 'general';
  const nav = h(
    'nav.settings-nav',
    { 'aria-label': 'Settings sections' },
    h('ul', SECTIONS.map((s) => h('li', h('a', { href: `#/settings/${s.id}`, 'aria-current': s.id === section ? 'page' : null }, icon(s.icon, 16), s.label)))),
  );
  const readOnly = !canManageSettings() && section !== 'appearance' && section !== 'team';
  dirtyCheck = null;
  const body = { general, vehicles, lists, team, appearance, data }[section](readOnly);
  return {
    node: h('div.page.settings-page', h('header.page-header', h('div.titles', h('h1', 'Settings'))), h('div.settings-layout', nav, h('div.settings-body', readOnly ? h('div.notice.warning', icon('lock'), h('span', 'Only the fleet owner and admins can change these settings.')) : null, body))),
    title: 'Settings',
    dirty: () => dirtyCheck?.() || false,
  };
}

let dirtyCheck = null;

function saveBar(form, onSave) {
  dirtyCheck = () => form.dirty();
  return h('div.settings-save', h('button.btn.primary', { type: 'button', onClick: () => form.validate() && (onSave(form.values()), form.markClean(), toast('Settings saved')) }, 'Save changes'));
}

function general(readOnly) {
  const s = app.settings();
  const form = buildForm({
    record: { name: s.company.name, distance: s.units.distance, volume: s.units.volume, currency: s.currency, weekStart: String(s.weekStart), laborRate: s.laborRate, dueDays: s.dueSoon.days, dueMeter: s.dueSoon.meter, fromInspections: s.issues?.fromInspections !== false },
    sections: [
      { id: 'fleet', title: 'Fleet', fields: [{ id: 'name', label: 'Fleet or company name', span: 2 }] },
      {
        id: 'units',
        title: 'Units and currency',
        columns: 3,
        intro: 'Changing units relabels numbers; it does not convert values you already entered.',
        fields: [
          { id: 'distance', label: 'Distance', type: 'select', required: true, options: () => [{ value: 'mi', label: 'Miles' }, { value: 'km', label: 'Kilometers' }] },
          { id: 'volume', label: 'Fuel volume', type: 'select', required: true, options: () => [{ value: 'gal', label: 'Gallons (US)' }, { value: 'L', label: 'Liters' }] },
          { id: 'currency', label: 'Currency', type: 'select', required: true, options: () => CURRENCIES },
          { id: 'weekStart', label: 'Week starts on', type: 'select', required: true, options: () => [{ value: '0', label: 'Sunday' }, { value: '1', label: 'Monday' }] },
        ],
      },
      {
        id: 'maintenance',
        title: 'Maintenance defaults',
        fields: [
          { id: 'laborRate', label: 'Shop labor rate per hour', type: 'money', hint: 'Prefilled on new work order and service lines.' },
          { id: 'dueDays', label: 'Due soon, days before', type: 'number', min: 0, required: true },
          { id: 'dueMeter', label: 'Due soon, meter before', type: 'number', min: 0, required: true },
          { id: 'fromInspections', label: 'Inspections', type: 'switch', checkLabel: 'Open an issue for every failed inspection item', span: 2 },
        ],
      },
    ],
  });
  if (readOnly) form.node.querySelectorAll('input,select,textarea,button').forEach((el) => (el.disabled = true));
  return h(
    'div',
    form.node,
    readOnly
      ? null
      : saveBar(form, (v) =>
          app.store.saveSettings({ company: { name: v.name }, units: { distance: v.distance, volume: v.volume }, currency: v.currency, weekStart: Number(v.weekStart), laborRate: v.laborRate, dueSoon: { days: v.dueDays, meter: v.dueMeter }, issues: { fromInspections: v.fromInspections } }),
        ),
  );
}

/** Editable list of strings (types, categories). */
function stringList(title, key, intro, readOnly) {
  let list = [...(app.settings()[key] || [])];
  const ul = h('ul.edit-list');
  const draw = () =>
    ul.replaceChildren(
      ...list.map((v, i) => {
        const inp = h('input.input.sm', { type: 'text', value: v, 'aria-label': `${title} ${i + 1}`, disabled: readOnly || null });
        inp.addEventListener('change', () => {
          const next = inp.value.trim();
          // An emptied name is not saved, so show the saved one again.
          if (!next) return (inp.value = list[i]);
          if (list.some((x, j) => j !== i && x === next)) {
            toast(`${next} is already in the list.`, { type: 'error' });
            return (inp.value = list[i]);
          }
          list[i] = next;
          save();
        });
        return h('li', inp, readOnly ? null : h('button.icon-btn.sm', { type: 'button', 'aria-label': `Remove ${v}`, onClick: () => (list.splice(i, 1), save(), draw()) }, icon('x', 15)));
      }),
    );
  const add = h('input.input.sm', { type: 'text', placeholder: `Add ${title.toLowerCase().replace(/s$/, '')}`, 'aria-label': `Add to ${title}`, disabled: readOnly || null });
  add.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = add.value.trim();
    if (!v || list.includes(v)) return;
    list.push(v);
    add.value = '';
    save();
    draw();
  });
  function save() {
    app.store.saveSettings({ [key]: list });
  }
  draw();
  return h('section.card.panel', h('div.card-head', h('h2.grow', title)), h('div.card-body', intro ? h('p.muted.form-intro', intro) : null, ul, readOnly ? null : h('div.edit-add', add, h('span.subtle.small', 'Press Enter to add'))));
}

function vehicles(readOnly) {
  const s = app.settings();
  // Statuses: label and color editable; ids stay stable so records keep them.
  let statuses = structuredClone(s.vehicleStatuses);
  const sl = h('ul.edit-list');
  const drawStatuses = () =>
    sl.replaceChildren(
      ...statuses.map((st, i) => {
        const inp = h('input.input.sm', { type: 'text', value: st.label, 'aria-label': `Status ${i + 1} name`, disabled: readOnly || null });
        inp.addEventListener('change', () => (inp.value.trim() ? ((st.label = inp.value.trim()), saveStatuses()) : (inp.value = st.label)));
        const color = h('select.select.sm', { 'aria-label': `Status ${i + 1} color`, disabled: readOnly || null }, STATUS_COLORS.map((c) => h('option', { value: c }, c[0].toUpperCase() + c.slice(1))));
        color.value = st.color;
        color.addEventListener('change', () => ((st.color = color.value), saveStatuses(), drawStatuses()));
        const used = app.store.all('vehicles').filter((v) => v.status === st.id).length;
        return h(
          'li',
          h(`span.dot-status.${st.color}`, { 'aria-hidden': 'true' }),
          inp,
          color,
          h('span.subtle.small.nowrap', `${used} vehicle${used === 1 ? '' : 's'}`),
          readOnly || used || statuses.length <= 1 ? h('span.icon-spacer') : h('button.icon-btn.sm', { type: 'button', 'aria-label': `Remove ${st.label}`, onClick: () => (statuses.splice(i, 1), saveStatuses(), drawStatuses()) }, icon('x', 15)),
        );
      }),
    );
  const saveStatuses = () => app.store.saveSettings({ vehicleStatuses: statuses });
  drawStatuses();
  const addStatus = h('button.btn.sm', { type: 'button', disabled: readOnly || null, onClick: () => (statuses.push({ id: newId(), label: 'New status', color: 'gray' }), saveStatuses(), drawStatuses()) }, icon('plus', 15), 'Add status');

  // Groups: renaming keeps the id; a group in use cannot be removed.
  let groups = structuredClone(s.groups || []);
  const gl = h('ul.edit-list');
  const drawGroups = () =>
    gl.replaceChildren(
      ...groups.map((g, i) => {
        const inp = h('input.input.sm', { type: 'text', value: g.name, 'aria-label': `Group ${i + 1}`, disabled: readOnly || null });
        inp.addEventListener('change', () => (inp.value.trim() ? ((g.name = inp.value.trim()), app.store.saveSettings({ groups })) : (inp.value = g.name)));
        const used = app.store.all('vehicles').filter((v) => v.groupId === g.id).length + app.store.all('contacts').filter((c) => c.groupId === g.id).length;
        return h('li', inp, h('span.subtle.small.nowrap', `${used} in use`), readOnly ? null : h('button.icon-btn.sm', { type: 'button', 'aria-label': `Remove ${g.name}`, onClick: async () => {
          if (used && !(await confirmDialog({ title: `Remove ${g.name}?`, message: `${used} vehicles and contacts are in this group. They will have no group.`, confirmLabel: 'Remove', danger: true }))) return;
          for (const v of app.store.all('vehicles').filter((x) => x.groupId === g.id)) app.store.patch('vehicles', v.id, { groupId: null });
          for (const c of app.store.all('contacts').filter((x) => x.groupId === g.id)) app.store.patch('contacts', c.id, { groupId: null });
          groups.splice(i, 1);
          app.store.saveSettings({ groups });
          drawGroups();
        } }, icon('x', 15)));
      }),
    );
  drawGroups();
  const addGroup = h('input.input.sm', { type: 'text', placeholder: 'Add a group, like a depot or department', 'aria-label': 'Add group', disabled: readOnly || null });
  addGroup.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !addGroup.value.trim()) return;
    e.preventDefault();
    groups.push({ id: newId(), name: addGroup.value.trim() });
    addGroup.value = '';
    app.store.saveSettings({ groups });
    drawGroups();
  });
  return h(
    'div.stack',
    h('section.card.panel', h('div.card-head', h('h2.grow', 'Vehicle statuses'), readOnly ? null : addStatus), h('div.card-body', h('p.muted.form-intro', 'Statuses in use cannot be removed. Rename them freely; vehicles keep their status.'), sl)),
    h('section.card.panel', h('div.card-head', h('h2.grow', 'Groups')), h('div.card-body', h('p.muted.form-intro', 'Group vehicles and people by depot, region, or department to filter lists and reports.'), gl, readOnly ? null : h('div.edit-add', addGroup, h('span.subtle.small', 'Press Enter to add')))),
    stringList('Vehicle types', 'vehicleTypes', null, readOnly),
    stringList('Fuel types', 'fuelTypes', null, readOnly),
  );
}

function lists(readOnly) {
  return h(
    'div.stack',
    stringList('Expense types', 'expenseTypes', 'Used on expense entries.', readOnly),
    stringList('Vehicle renewal types', 'vehicleRenewalTypes', 'Registration, insurance, and other dated obligations.', readOnly),
    stringList('Contact renewal types', 'contactRenewalTypes', 'Licenses and certifications people need to keep current.', readOnly),
    stringList('Service task categories', 'serviceCategories', null, readOnly),
    stringList('Part categories', 'partCategories', null, readOnly),
    stringList('Inventory locations', 'partLocations', 'Shops or storerooms where parts are kept.', readOnly),
  );
}

function team() {
  return teamAccessCard();
}

function appearance() {
  return h(
    'section.card.panel',
    h('div.card-head', h('h2.grow', 'Appearance')),
    h(
      'div.card-body.stack',
      h('p.muted', 'Choose a theme for this device. System follows your operating system setting.'),
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
    ),
  );
}

function data(readOnly) {
  const store = app.store;
  const input = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      const backup = JSON.parse(await f.text());
      if (backup?.app !== 'fleet' || !backup.collections) throw new Error('This is not a Fleet backup file.');
      const counts = Object.values(backup.collections).reduce((a, l) => a + (Array.isArray(l) ? l.length : 0), 0);
      if (!(await confirmDialog({ title: 'Restore this backup?', message: `${counts} records will be added or replace records with the same id. Records not in the backup are kept.`, confirmLabel: 'Restore' }))) return;
      for (const c of COLLECTIONS) if (Array.isArray(backup.collections[c]) && backup.collections[c].length) store.bulkPut(c, backup.collections[c]);
      if (backup.settings) store.saveSettings(backup.settings);
      toast(`Restored ${counts} records`);
    } catch (err) {
      toast(err.message || 'The backup could not be read.', { type: 'error' });
    }
  });
  const backup = () => {
    const out = { app: 'fleet', version: 1, exportedAt: new Date().toISOString(), settings: store.state.settings, collections: Object.fromEntries(COLLECTIONS.map((c) => [c, store.all(c)])) };
    downloadText(`fleet-backup-${app.today()}.json`, JSON.stringify(out, null, 1), 'application/json');
  };
  const nSample = sampleCount();
  const deleteAll = async () => {
    const ok = await confirmDialog({ title: 'Delete all fleet data?', message: 'Every vehicle, record, and setting in this fleet will be permanently deleted. Download a backup first if you might need it. Files you uploaded stay in your Puter drive.', confirmLabel: 'Delete everything', danger: true });
    if (!ok) return;
    for (const c of COLLECTIONS) store.bulkRemove(c, store.all(c).map((r) => r.id));
    store.saveSettings({ ...defaultSettings(), onboarded: true });
    toast('All fleet data deleted');
    navigate('/');
  };
  return h(
    'div.stack',
    input,
    h('section.card.panel', h('div.card-head', h('h2.grow', 'Backup')), h('div.card-body.stack', h('p.muted', 'Download everything as a JSON file you can keep or restore later. Lists also export to CSV from their More menu.'), h('div.row.wrap', h('button.btn', { type: 'button', onClick: backup }, icon('download', 15), 'Download backup'), readOnly ? null : h('button.btn', { type: 'button', onClick: () => input.click() }, icon('upload', 15), 'Restore from backup')))),
    readOnly
      ? null
      : h(
          'section.card.panel',
          h('div.card-head', h('h2.grow', 'Sample data')),
          h(
            'div.card-body.stack',
            h('p.muted', nSample ? `${nSample} sample records are in this fleet. Remove them before you start using it for real.` : 'Add a sample fleet with vehicles, fuel, service, and inspections to try every feature.'),
            h('div.row', nSample ? h('button.btn', { type: 'button', onClick: async () => (await confirmDialog({ title: 'Remove sample data?', message: 'Only records marked as sample are removed.', confirmLabel: 'Remove', danger: true })) && (removeSampleData(), toast('Sample data removed'), navigate('/settings/data')) }, icon('trash', 15), 'Remove sample data') : h('button.btn', { type: 'button', onClick: () => (loadSampleData(), toast('Sample fleet added'), navigate('/')) }, icon('sparkles', 15), 'Add sample data')),
          ),
        ),
    h(
      'section.card.panel',
      h('div.card-head', h('h2.grow', 'Where your data lives')),
      h(
        'div.card-body.stack',
        h('p.muted', app.demo ? 'You are in the demo. Nothing is saved.' : app.team ? 'This fleet is shared through a team server in its owner’s Puter account. Records and files are stored there.' : 'Records are stored in your own Puter account. Photos and documents are files in this app’s folder in your Puter drive. A copy is kept on this device so the app works offline.'),
        h('p', h('a', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Fleet is open source on GitHub'), '.'),
      ),
    ),
    readOnly || app.team?.role && app.team.role !== 'owner'
      ? null
      : h('section.card.panel.danger-zone', h('div.card-head', h('h2.grow', 'Delete all data')), h('div.card-body.stack', h('p.muted', 'Permanently delete every record in this fleet.'), h('div.row', h('button.btn.danger', { type: 'button', onClick: deleteAll }, icon('trash', 15), 'Delete all data')))),
  );
}

export { openDialog };

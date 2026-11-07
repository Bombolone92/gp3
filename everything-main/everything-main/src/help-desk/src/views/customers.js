/**
 * Customers: everyone who has asked for help. A filterable, sortable list
 * with search, CSV export and (for administrators) CSV import, plus the
 * "Add customer" dialog used across the app.
 */
import { h, clear, uid, debounce, announce, preserveFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog } from '../ui/dialog.js';
import { selectField, tagsInput, field, emptyState } from '../ui/components.js';
import { toast, toastError } from '../ui/toast.js';
import { relTime, fullDate, plural, localDay } from '../ui/format.js';
import { go } from '../ui/router.js';
import { bind } from '../ui/shortcuts.js';
import { app } from '../app.js';
import { ticketCounts, customersToCsv, parseCsv, decodeCsv, guessMapping, buildImportRows, orgKey, IMPORT_FIELDS, collator } from './people-data.js';
import { dataTable, downloadText, orgOptions, personCell, segmented } from './people-ui.js';

const FILTERS = {
  all: { label: 'All customers', short: 'All', icon: 'users', test: (u) => !u.suspended },
  open: { label: 'With open tickets', short: 'Open tickets', icon: 'inbox', test: (u, c) => !u.suspended && (c.byUser.get(u.id)?.open || 0) > 0 },
  recent: { label: 'Added in the last 30 days', short: 'New', icon: 'user-plus', test: (u) => !u.suspended && Date.now() - (u.createdAt || 0) < 30 * 86400000 },
  suspended: { label: 'Suspended', short: 'Suspended', icon: 'ban', test: (u) => !!u.suspended },
};

function matches(u, words, orgs) {
  if (!words.length) return true;
  const org = u.org ? orgs.get(u.org)?.name || '' : '';
  const hay = `${u.name} ${u.email || ''} ${u.phone || ''} ${(u.tags || []).join(' ')} ${org}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function mount(main, { route }) {
  let filter = FILTERS[route.query.filter] ? route.query.filter : 'all';
  let query = route.query.q || '';
  let counts = ticketCounts(app.replica.tickets.values());

  const side = h('nav.side-nav', { 'aria-label': 'Customer lists' });
  const titleEl = h('h1#people-title');
  const subEl = h('p.page-sub', { role: 'status', 'aria-live': 'polite' });
  const searchId = uid('cust-q');
  const search = h(`input#${searchId}.input`, { type: 'search', placeholder: 'Search by name, email, phone or tag', value: query, autocomplete: 'off', 'aria-label': 'Search customers' });
  const exportBtn = h('button.btn', { type: 'button', onclick: exportCsv, title: 'Download the customers in this list as a CSV file' }, icon('download', { size: 15 }), h('span.btn-text', 'Export'));
  const importBtn = app.isAdmin ? h('button.btn', { type: 'button', onclick: () => importDialog() }, icon('upload', { size: 15 }), h('span.btn-text', 'Import')) : null;
  const addBtn = h('button.btn.btn-primary', { type: 'button', onclick: () => newCustomerDialog() }, icon('user-plus', { size: 15 }), h('span.btn-text', 'Add customer'));
  const seg = segmented({
    label: 'Customer lists',
    value: filter,
    items: Object.entries(FILTERS).map(([k, f]) => ({ value: k, label: f.short })),
    onChange: (v) => setFilter(v),
  });
  const table = dataTable({
    label: 'Customers',
    href: (u) => `#/customers/${u.id}`,
    onOpen: (u) => go(`/customers/${u.id}`),
    sort: { id: 'name', dir: 'asc' },
    columns: [
      { id: 'name', label: 'Name', sort: (u) => u.name, render: (u) => h('a.row-link', { href: `#/customers/${u.id}`, tabindex: '-1' }, personCell(u.name, u.email || '')) },
      { id: 'email', label: 'Email', cls: 'hide-md', width: 230, sort: (u) => u.email || '', render: (u) => (u.email ? h('span.ellipsis', u.email) : h('span.subtle', '-')) },
      { id: 'org', label: 'Organization', cls: 'hide-sm', width: 180, sort: (u) => (u.org ? app.replica.orgs.get(u.org)?.name || '' : ''), render: (u) => {
        const o = u.org ? app.replica.orgs.get(u.org) : null;
        return o ? h('span.ellipsis', o.name) : h('span.subtle', '-');
      } },
      { id: 'tags', label: 'Tags', cls: 'hide-md', width: 170, render: (u) => h('div.chips.chips-nowrap', (u.tags || []).slice(0, 3).map((t) => h('span.chip.static', t)), (u.tags || []).length > 3 ? h('span.subtle', `+${u.tags.length - 3}`) : null) },
      { id: 'open', label: 'Open tickets', numeric: true, width: 120, defaultDir: 'desc', sort: (u) => counts.byUser.get(u.id)?.open || 0, render: (u) => {
        const n = counts.byUser.get(u.id)?.open || 0;
        return n ? h('span.open-count', String(n)) : h('span.subtle', '0');
      } },
      { id: 'updated', label: 'Updated', cls: 'hide-sm', width: 130, defaultDir: 'desc', sort: (u) => u.updatedAt || 0, render: (u) => h('span', { title: fullDate(u.updatedAt) }, relTime(u.updatedAt)) },
    ],
  });
  const emptyEl = h('div.people-empty');
  const content = h('section.people-main', { 'aria-labelledby': 'people-title' },
    h('header.people-head',
      h('div.people-title', titleEl, subEl),
      h('div.people-actions', exportBtn, importBtn, addBtn)),
    h('div.people-tools', h('div.search-input', icon('search', { size: 15 }), search), seg),
    table.el,
    emptyEl);
  main.append(h('div.split-page', side, content));

  function list() {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const test = FILTERS[filter].test;
    const out = [];
    for (const u of app.replica.users.values()) if (test(u, counts) && matches(u, words, app.replica.orgs)) out.push(u);
    return out;
  }

  function paintSide() {
    clear(side);
    const n = Object.fromEntries(Object.keys(FILTERS).map((k) => [k, 0]));
    for (const u of app.replica.users.values()) for (const [k, f] of Object.entries(FILTERS)) if (f.test(u, counts)) n[k]++;
    side.append(h('div.side-nav-head', h('h2', 'Customers'), h('button.icon-btn', { type: 'button', 'aria-label': 'Add customer', title: 'Add customer', onclick: () => newCustomerDialog() }, icon('plus', { size: 16 }))));
    for (const [k, f] of Object.entries(FILTERS)) {
      if (k === 'suspended') side.append(h('div.side-sep'));
      side.append(h('a.side-link', {
        href: `#/customers?filter=${k}`,
        'aria-current': filter === k ? 'page' : undefined,
        onclick: (e) => {
          e.preventDefault();
          setFilter(k);
        },
      }, icon(f.icon, { size: 16 }), h('span.ellipsis', f.label), h('span.count', String(n[k]))));
    }
    side.append(h('div.side-sep'), h('a.side-link', { href: '#/orgs' }, icon('building', { size: 16 }), h('span.ellipsis', 'Organizations'), h('span.count', String(app.replica.orgs.size))));
    seg.setCounts?.(n);
  }

  function setFilter(k) {
    filter = k;
    syncUrl();
    paintSide();
    for (const b of seg.querySelectorAll('.seg')) {
      const on = b.textContent.startsWith(FILTERS[k].short);
      b.setAttribute('aria-checked', String(on));
      // Tab reaches the checked choice of a radio group.
      b.tabIndex = on ? 0 : -1;
    }
    refresh();
  }

  function syncUrl() {
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('filter', filter);
    if (query) params.set('q', query);
    const qs = params.toString();
    history.replaceState(null, '', `#/customers${qs ? `?${qs}` : ''}`);
  }

  function refresh() {
    const rows = list();
    titleEl.textContent = FILTERS[filter].label;
    subEl.textContent = query ? `${plural(rows.length, 'customer')} matching "${query}"` : plural(rows.length, 'customer');
    table.update(rows);
    table.el.hidden = rows.length === 0;
    clear(emptyEl);
    if (!rows.length) {
      emptyEl.append(query
        ? emptyState({ glyph: 'search', title: 'No customers match your search', text: 'Try a different name, email address or tag.', action: h('button.btn', { type: 'button', onclick: () => { search.value = ''; query = ''; syncUrl(); refresh(); search.focus(); } }, 'Clear search') })
        : filter === 'all'
          ? emptyState({ glyph: 'users', title: 'No customers yet', text: 'Customers are added automatically when they send a request. You can also add them yourself or import a list.', action: h('div.row', importBtn ? h('button.btn', { type: 'button', onclick: () => importDialog() }, icon('upload', { size: 14 }), 'Import CSV') : null, h('button.btn.btn-primary', { type: 'button', onclick: () => newCustomerDialog() }, icon('user-plus', { size: 14 }), 'Add customer')) })
          : emptyState({ glyph: FILTERS[filter].icon, title: `No customers in "${FILTERS[filter].label}"` }));
    }
  }

  function exportCsv() {
    const rows = list().sort((a, b) => collator.compare(a.name, b.name));
    if (!rows.length) {
      toast('There are no customers in this list to export.');
      return;
    }
    const name = `${(app.replica.meta?.name || 'help-desk').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-customers-${localDay()}.csv`;
    downloadText(name, customersToCsv(rows, app.replica.orgs));
    toast(`Exported ${plural(rows.length, 'customer')}.`, { kind: 'success' });
  }

  const onSearch = debounce(() => {
    query = search.value.trim();
    syncUrl();
    refresh();
  }, 120);
  search.addEventListener('input', onSearch);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      table.focusFirst();
    } else if (e.key === 'Escape' && search.value) {
      e.preventDefault();
      search.value = '';
      onSearch();
    }
  });

  const onChange = (e) => {
    const k = e.detail?.kinds;
    if (!k || k.has('u') || k.has('o') || k.has('t')) {
      counts = ticketCounts(app.replica.tickets.values());
      preserveFocus(main, () => {
        paintSide();
        refresh();
      });
    }
  };
  app.replica.addEventListener('change', onChange);
  const unbind = bind('customers', {
    '/': () => search.focus(),
    j: () => table.focusFirst(),
  });
  paintSide();
  refresh();
  document.title = 'Customers - Help Desk';
  return () => {
    app.replica.removeEventListener('change', onChange);
    unbind();
    table.destroy();
    document.title = 'Help Desk';
  };
}

/**
 * Add a customer. Resolves to the created customer (or null). An email that
 * already belongs to someone offers to open that customer instead.
 */
export function newCustomerDialog({ org = null, name = '', email = '', navigate = true } = {}) {
  return new Promise((resolve) => {
    const ids = { name: uid('cn'), email: uid('ce'), phone: uid('cp'), org: uid('co'), tags: uid('ct'), notes: uid('cnotes') };
    const nameIn = h(`input#${ids.name}.input`, { value: name, maxlength: 120, autocomplete: 'off', required: true });
    const emailIn = h(`input#${ids.email}.input`, { type: 'email', value: email, maxlength: 254, autocomplete: 'off' });
    const phoneIn = h(`input#${ids.phone}.input`, { type: 'tel', maxlength: 40, autocomplete: 'off' });
    let orgValue = org;
    const orgSel = selectField({ id: ids.org, value: orgValue, options: orgOptions, label: 'Organization', placeholder: 'No organization', onChange: (v) => { orgValue = v; orgTouched = true; } });
    let orgTouched = !!org;
    let tags = [];
    const tagsEl = tagsInput({ id: ids.tags, label: 'Tags', placeholder: 'vip, beta', onChange: (v) => { tags = v; }, suggestions: () => [...new Set([...app.replica.users.values()].flatMap((u) => u.tags || []))].sort() });
    const notesIn = h(`textarea#${ids.notes}.textarea`, { rows: 3, maxlength: 4000, placeholder: 'Anything teammates should know' });
    const nameErr = h('p.field-error', { role: 'alert' });
    const emailErr = h('p.field-error', { role: 'alert' });
    const formErr = h('p.field-error', { role: 'alert' });
    // Suggest the organization from the email domain while the user types.
    emailIn.addEventListener('input', () => {
      emailIn.removeAttribute('aria-invalid');
      emailErr.textContent = '';
      if (orgTouched) return;
      const domain = emailIn.value.split('@')[1]?.toLowerCase().trim();
      const match = domain ? [...app.replica.orgs.values()].find((o) => (o.domains || []).includes(domain)) : null;
      orgValue = match ? match.id : null;
      orgSel.setValue(orgValue);
    });
    let created = null;
    const formId = uid('new-cust');
    const form = h(`form#${formId}.form-grid.people-form`, { onsubmit: (e) => { e.preventDefault(); save(); }, novalidate: true },
      h('div.span-2', field('Name', nameIn, { id: ids.name, error: nameErr })),
      field('Email', emailIn, { id: ids.email, error: emailErr }),
      field('Phone', phoneIn, { id: ids.phone }),
      h('div.span-2', field('Organization', orgSel, { id: ids.org, hint: 'Filled in from the email domain when it matches an organization.' })),
      h('div.span-2', field('Tags', tagsEl, { id: ids.tags })),
      h('div.span-2', field('Notes', notesIn, { id: ids.notes })),
      formErr);
    let dlg = null;
    let busy = false;

    async function save() {
      if (busy) return;
      nameErr.textContent = '';
      emailErr.textContent = '';
      formErr.textContent = '';
      const n = nameIn.value.trim();
      const em = emailIn.value.trim();
      if (!n && !em) {
        nameErr.textContent = 'Enter a name or an email address';
        nameIn.setAttribute('aria-invalid', 'true');
        nameIn.focus();
        return;
      }
      if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) {
        emailErr.textContent = 'That email address does not look right';
        emailIn.setAttribute('aria-invalid', 'true');
        emailIn.focus();
        return;
      }
      busy = true;
      const submit = dlg.el.querySelector('.dialog-foot .btn-primary');
      if (submit) submit.disabled = true;
      try {
        const res = await app.api.post('/users', { name: n, email: em, phone: phoneIn.value.trim(), org: orgValue, tags, notes: notesIn.value });
        app.replica.upsert('u', res.user);
        created = res.user;
        dlg.close('created');
        toast(`${res.user.name} was added.`, { kind: 'success', action: navigate ? null : { label: 'Open', run: () => go(`/customers/${res.user.id}`) } });
        if (navigate) go(`/customers/${res.user.id}`);
      } catch (e) {
        if (e.code === 'exists' && e.current) {
          app.replica.upsert('u', e.current);
          clear(emailErr);
          emailErr.append(`${e.current.name} already uses this email address. `, h('a', { href: `#/customers/${e.current.id}`, onclick: () => dlg.close(null) }, 'Open their profile'));
          emailIn.setAttribute('aria-invalid', 'true');
          emailIn.focus();
        } else if (e.field === 'email') {
          emailErr.textContent = e.message;
          emailIn.setAttribute('aria-invalid', 'true');
          emailIn.focus();
        } else if (e.field === 'name') {
          nameErr.textContent = e.message;
          nameIn.focus();
        } else formErr.textContent = e.message || 'Could not add the customer';
      } finally {
        busy = false;
        if (submit) submit.disabled = false;
      }
    }

    dlg = openDialog({
      title: 'Add customer',
      description: 'Customers are the people who ask your team for help.',
      body: form,
      actions: [{ label: 'Cancel' }, { label: 'Add customer', primary: true, submit: true, form: formId }],
      onClose: () => resolve(created),
      initialFocus: `#${name ? ids.email : ids.name}`,
    });
  });
}

/* ------------------------------------------------------------- import */

function importDialog() {
  const fileId = uid('csv');
  const fileIn = h(`input#${fileId}.sr-only`, { type: 'file', accept: '.csv,text/csv,text/plain' });
  const drop = h('label.drop-zone', { for: fileId },
    icon('upload', { size: 22 }),
    h('strong', 'Choose a CSV file'),
    h('span.muted', 'or drop it here. The first row should name the columns, for example Name, Email, Phone, Organization, Tags.'));
  const body = h('div.import-body', fileIn, drop);
  let parsed = null;
  let mapping = null;
  let createOrgs = true;
  let stage = 'pick';
  let dlg = null;

  const readFile = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toastError({ message: 'That file is larger than 5 MB. Split it into smaller files.' });
      return;
    }
    const text = decodeCsv(await file.arrayBuffer());
    const rows = parseCsv(text);
    if (rows.length < 2) {
      toastError({ message: 'That file has no data rows. The first row should name the columns.' });
      return;
    }
    parsed = { name: file.name, header: rows[0], data: rows.slice(1) };
    mapping = guessMapping(parsed.header);
    stage = 'map';
    paint();
  };
  fileIn.addEventListener('change', () => readFile(fileIn.files[0]));
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    readFile(e.dataTransfer.files[0]);
  });

  function orgIndex() {
    const map = new Map();
    for (const o of app.replica.orgs.values()) map.set(orgKey(o.name), o.id);
    return map;
  }

  function paint() {
    clear(body);
    if (stage === 'pick') {
      // Back to choosing a file: nothing to import yet, and the same file
      // can be chosen again.
      fileIn.value = '';
      body.append(fileIn, drop);
      const btn = dlg?.el.querySelector('.dialog-foot .btn-primary');
      if (btn) {
        btn.textContent = 'Import';
        btn.disabled = true;
      }
      return;
    }
    if (stage === 'map') {
      const plan = buildImportRows(parsed.data, mapping, orgIndex());
      const colOptions = () => [{ value: -1, label: 'Do not import' }, ...parsed.header.map((name, i) => ({ value: i, label: name || `Column ${i + 1}` }))];
      const grid = h('div.map-grid');
      for (const f of IMPORT_FIELDS) {
        const id = uid(`map-${f.id}`);
        grid.append(h('label.field-label', { for: id }, f.label), selectField({ id, value: mapping[f.id], options: colOptions, label: f.label, onChange: (v) => { mapping[f.id] = v; paint(); } }));
      }
      const preview = h('div.preview-wrap', h('table.table.preview', { 'aria-label': 'Preview of the first rows' },
        h('thead', h('tr', ['Name', 'Email', 'Organization', 'Tags'].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', plan.rows.slice(0, 5).map((r) => h('tr', h('td', r.name), h('td', r.email || ''), h('td', r.orgName || app.replica.orgs.get(r.org)?.name || ''), h('td', (r.tags || []).join(', ')))))));
      const orgCheck = plan.orgNames.length
        ? h('label.checkbox', h('input', { type: 'checkbox', checked: createOrgs, onchange: (e) => { createOrgs = e.target.checked; } }), plan.orgNames.length === 1 ? `Also create the organization "${plan.orgNames[0]}"` : `Also create ${plan.orgNames.length} missing organizations (${plan.orgNames.slice(0, 3).join(', ')}${plan.orgNames.length > 3 ? ', and more' : ''})`)
        : null;
      body.append(
        h('p.import-file', icon('file-text', { size: 15 }), h('strong', parsed.name), h('span.muted', ` · ${plural(parsed.data.length, 'row')}`), h('button.link-btn', { type: 'button', onclick: () => { stage = 'pick'; parsed = null; paint(); } }, 'Choose another file')),
        h('h3.import-h', 'Match the columns'),
        grid,
        h('h3.import-h', 'Preview'),
        plan.rows.length ? preview : h('p.muted', 'No rows have a name or an email address with these columns.'),
        h('p.import-summary', { role: 'status' },
          `${plural(plan.rows.length, 'customer')} ready to import`,
          plan.skipped ? `, ${plural(plan.skipped, 'row')} will be skipped (no name or a bad email address)` : '',
          '. Customers whose email address is already known are skipped.'),
        orgCheck,
      );
      const btn = dlg?.el.querySelector('.dialog-foot .btn-primary');
      if (btn) {
        btn.textContent = `Import ${plural(plan.rows.length, 'customer')}`;
        btn.disabled = !plan.rows.length;
      }
      return;
    }
    if (stage === 'running' || stage === 'done') body.append(progressEl);
  }

  const progress = h('progress.import-progress', { max: 100, value: 0, 'aria-label': 'Import progress' });
  const progressText = h('p', { role: 'status', 'aria-live': 'polite' }, 'Starting');
  const progressEl = h('div.import-run', progress, progressText);

  async function run() {
    if (!parsed) return false;
    const plan = buildImportRows(parsed.data, mapping, orgIndex());
    if (!plan.rows.length) return false;
    stage = 'running';
    paint();
    const foot = dlg.el.querySelector('.dialog-foot');
    foot.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    let created = 0;
    let skipped = plan.skipped;
    try {
      if (createOrgs && plan.orgNames.length) {
        progressText.textContent = `Creating ${plural(plan.orgNames.length, 'organization')}`;
        for (const name of plan.orgNames) {
          const res = await app.api.post('/orgs', { name });
          app.replica.upsert('o', res.org);
        }
      }
      const idx = orgIndex();
      const rows = plan.rows.map(({ orgName, ...r }) => (orgName && idx.get(orgKey(orgName)) ? { ...r, org: idx.get(orgKey(orgName)) } : r));
      for (let i = 0; i < rows.length; i += 200) {
        const res = await app.api.post('/users-import', { rows: rows.slice(i, i + 200) });
        // One update per batch: one per customer redrew the list each time.
        app.replica.upsertMany('u', res.created);
        created += (res.created || []).length;
        skipped += res.skipped || 0;
        progress.value = Math.round(((i + 200) / rows.length) * 100);
        progressText.textContent = `Imported ${created.toLocaleString()} of ${rows.length.toLocaleString()}`;
      }
      progress.value = 100;
      stage = 'done';
      progressText.textContent = `Done. ${plural(created, 'customer')} added${skipped ? `, ${plural(skipped, 'row')} skipped` : ''}.`;
      announce(progressText.textContent);
      toast(progressText.textContent, { kind: 'success' });
    } catch (e) {
      progressText.textContent = `Stopped after ${plural(created, 'customer')}: ${e.message}`;
      toastError(e);
    }
    clear(foot);
    foot.append(h('button.btn.btn-primary', { type: 'button', onclick: () => dlg.close(true) }, 'Done'));
    foot.querySelector('button').focus();
    return false;
  }

  dlg = openDialog({
    title: 'Import customers',
    description: 'Add many customers at once from a spreadsheet saved as CSV.',
    size: 'lg',
    body,
    actions: [{ label: 'Cancel' }, { label: 'Import', primary: true, disabled: true, run }],
  });
  dlg.el.querySelector('.dialog-foot .btn-primary').disabled = true;
}

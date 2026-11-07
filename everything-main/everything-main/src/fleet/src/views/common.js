/** Building blocks shared by the screens. */
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup, canEdit, myName } from '../app.js';
import { formatMoney } from '../core/money.js';
import { vehicleName, vehicleDescription, contactName, formatMeter, METER_UNITS, formatBytes, initials, colorFor } from '../core/format.js';
import { formatDate, timeAgo, relativeDays } from '../core/dates.js';
import { vehicleStatusMeta, VENDOR_KINDS, CONTACT_ROLES } from '../core/status.js';
import { pill, dotStatus, emptyState, avatar } from '../ui/components.js';
import { saveFile, fileUrl, deleteFile, isImage } from '../files.js';
import { toast } from '../ui/toast.js';
import { confirmDialog, openDialog } from '../ui/dialog.js';
import { openMenu } from '../ui/menu.js';
import { onLeave } from '../ui/viewhost.js';
import { removeMeterFor, recomputeVehicleMeter } from '../core/actions.js';

export const money = (c) => (c === null || c === undefined || c === '' ? '' : formatMoney(Number(c), app.settings().currency));

export const dash = () => h('span.subtle', { 'aria-label': 'None' }, '-');

export function dateCell(iso) {
  return iso ? h('span.nowrap', formatDate(iso)) : dash();
}

// ---- Vehicles ---------------------------------------------------------------------

const TYPE_ICONS = { Car: 'car', SUV: 'car', 'Pickup truck': 'truck', Van: 'truck', 'Box truck': 'truck', 'Semi truck': 'truck', Bus: 'bus', Trailer: 'trailer', Forklift: 'forklift', Equipment: 'tractor' };

export function vehicleIcon(v) {
  return TYPE_ICONS[v?.type] || 'truck';
}

/** Square thumbnail: the vehicle photo, or an icon for its type. */
export function vehicleThumb(v, size = 'md') {
  const node = h(`span.thumb.${size}`, { 'aria-hidden': 'true' }, icon(vehicleIcon(v), size === 'lg' ? 34 : size === 'sm' ? 15 : 18));
  if (v?.photo?.path) loadImage(node, v.photo);
  return node;
}

/** Fill a node with an image once its URL is available. */
export function loadImage(node, att, alt = '') {
  fileUrl(att)
    .then((url) => node.replaceChildren(h('img', { src: url, alt, loading: 'lazy', decoding: 'async' })))
    .catch(() => {});
}

export function vehicleStatusPill(id, { dot = false } = {}) {
  const m = vehicleStatusMeta(app.settings(), id);
  return dot ? dotStatus(m.label, m.tone) : pill(m.label, m.tone);
}

/** Vehicle name with thumbnail and a muted description, linking to it. */
export function vehicleCell(vOrId, { link = true, sub = true } = {}) {
  const v = typeof vOrId === 'string' ? lookup.vehicle(vOrId) : vOrId;
  if (!v) return h('span.subtle', 'Deleted vehicle');
  const name = h('span.cell-title', vehicleName(v));
  const inner = [vehicleThumb(v, 'sm'), h('span.cell-text', name, sub ? h('span.cell-sub', [vehicleDescription(v) !== vehicleName(v) ? vehicleDescription(v) : '', v.plate].filter(Boolean).join(' · ')) : null)];
  return link ? h('a.cell-vehicle', { href: `#/vehicles/${v.id}` }, inner) : h('span.cell-vehicle', inner);
}

export function meterUnit(v) {
  return v?.meterUnit || app.settings().units.distance;
}

export function meterText(value, v) {
  if (value === null || value === undefined || value === '') return '';
  return formatMeter(value, meterUnit(v));
}

export function meterUnitLabel(v) {
  return METER_UNITS[meterUnit(v)]?.short || meterUnit(v);
}

/** How far off a service reminder is: "in 5 days or 300 mi left". */
export function dueText(st, veh, today) {
  const parts = [];
  if (st.nextDate) parts.push(relativeDays(st.nextDate, today));
  if (st.meterLeft != null) parts.push(st.meterLeft < 0 ? `${meterText(-st.meterLeft, veh)} over` : `${meterText(st.meterLeft, veh)} left`);
  return parts.join(' or ');
}

/** Where a meter reading came from, linked to that record. */
export function sourceLink(m) {
  const s = m.source;
  if (!s) return h('span.subtle', 'Manual');
  const map = { fuel: ['Fuel entry', `#/fuel/${s.id}`], service: ['Service entry', `#/service/${s.id}`], inspection: ['Inspection', `#/inspections/${s.id}`], assignment: ['Assignment', `#/assignments?tab=all&f_vehicle=${m.vehicleId}`] };
  const [label, href] = map[s.type] || [s.type, null];
  return href ? h('a', { href }, label) : label;
}

// ---- People and vendors ---------------------------------------------------------

let operators = null;

/**
 * Who drives a vehicle today, from its assignments. vehicle.operatorId is
 * only refreshed when an assignment is saved, so it goes stale as days
 * pass: an assignment starting tomorrow, or one ending today. A vehicle
 * with no assignments at all keeps its stored operator.
 */
export function operatorOf(v) {
  if (!v) return null;
  const list = app.store.all('assignments');
  const today = app.today();
  if (operators?.list !== list || operators.today !== today) {
    const current = new Map();
    const assigned = new Set();
    for (const a of list) {
      assigned.add(a.vehicleId);
      if (a.start <= today && (!a.end || a.end >= today) && !(current.get(a.vehicleId)?.start > a.start)) current.set(a.vehicleId, a);
    }
    operators = { list, today, current, assigned };
  }
  return operators.assigned.has(v.id) ? operators.current.get(v.id)?.contactId || null : v.operatorId || null;
}

export function contactCell(id, { link = true } = {}) {
  const c = lookup.contact(id);
  if (!c) return dash();
  const name = contactName(c);
  const inner = [avatar(name, { color: colorFor(c.id), size: 'sm', img: null }), h('span.truncate', name)];
  return link ? h('a.cell-person', { href: `#/contacts/${c.id}` }, inner) : h('span.cell-person', inner);
}

export function vendorCell(id) {
  const v = lookup.vendor(id);
  return v ? h('a', { href: `#/vendors/${v.id}` }, v.name) : dash();
}

/**
 * A list's bulk Archive action. On the Archived tab it is Restore, since
 * every row there is archived already.
 */
export function archiveBulk(coll, noun) {
  const restore = (tab) => tab === 'archived';
  return {
    label: (tab) => (restore(tab) ? 'Restore' : 'Archive'),
    icon: (tab) => (restore(tab) ? 'unarchive' : 'archive'),
    run: (rows, button, tab) => {
      const archived = !restore(tab);
      for (const r of rows) app.store.patch(coll, r.id, { archived });
      toast(`${rows.length} ${noun}${rows.length === 1 ? '' : 's'} ${archived ? 'archived' : 'restored'}`);
    },
  };
}

// ---- Picker options ---------------------------------------------------------------------

// `keep` is the value already in the field (or a list of them): it stays
// listed even when archived, so editing an old record does not show the
// field as empty.
const kept = (keep, id) => (Array.isArray(keep) ? keep.includes(id) : id === keep);
export const options = {
  vehicles: ({ includeArchived = false, keep = null } = {}) => () =>
    app.store
      .all('vehicles')
      .filter((v) => includeArchived || !v.archived || kept(keep, v.id))
      .map((v) => ({ value: v.id, label: vehicleName(v), sub: [vehicleDescription(v) !== vehicleName(v) ? vehicleDescription(v) : '', v.plate].filter(Boolean).join(' · '), search: `${v.vin || ''} ${v.plate || ''}` }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
  contacts: (role = null, keep = null) => () =>
    app.store
      .all('contacts')
      .filter((c) => c.id === keep || (!c.archived && (!role || (c.roles || []).includes(role))))
      .map((c) => ({ value: c.id, label: contactName(c), sub: c.jobTitle || '' }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  vendors: (kind = null, keep = null) => () =>
    app.store
      .all('vendors')
      .filter((v) => !v.archived || v.id === keep)
      .map((v) => ({ value: v.id, label: v.name, sub: (v.kinds || []).map((k) => VENDOR_KINDS.find((x) => x.id === k)?.label).filter(Boolean).join(', '), rank: kind && (v.kinds || []).includes(kind) ? 0 : 1 }))
      .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label)),
  tasks: (keep = null) => () =>
    app.store
      .all('serviceTasks')
      .filter((t) => !t.archived || t.id === keep)
      .map((t) => ({ value: t.id, label: t.name, sub: t.category || '' }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  parts: () => () =>
    app.store
      .all('parts')
      .filter((p) => !p.archived)
      .map((p) => ({ value: p.id, label: p.description || p.number, sub: p.number }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  groups: () => () => (app.settings().groups || []).map((g) => ({ value: g.id, label: g.name })),
  list: (arr) => () => arr.map((x) => (typeof x === 'string' ? { value: x, label: x } : { value: x.id ?? x.value, label: x.label })),
  roles: () => () => CONTACT_ROLES.map((r) => ({ value: r.id, label: r.label })),
};

// ---- Detail page header ---------------------------------------------------------------

/**
 * Header for record pages: back link, optional thumbnail, title, a meta
 * line of small facts, and actions on the right.
 */
export function detailHeader({ back, thumb, title, sub, meta = [], actions = [], after = null }) {
  return h(
    'header.detail-header',
    back ? h('a.back-link', { href: back.href }, icon('arrow-left', 15), back.label) : null,
    h(
      'div.detail-head-row',
      thumb || null,
      h(
        'div.detail-titles',
        h('h1', title),
        sub ? h('div.detail-sub', sub) : null,
        meta.filter(Boolean).length ? h('div.detail-meta', meta.filter(Boolean).map((m) => h('span.meta-item', m))) : null,
        after,
      ),
      h('div.detail-actions', actions.filter(Boolean)),
    ),
  );
}

/** Key/value rows for a "Details" card. Empty values show a dash. */
export function kvList(pairs) {
  return h(
    'dl.kv-list',
    pairs
      .filter(Boolean)
      .map(([k, v]) => h('div.kv-row', h('dt', k), h('dd', v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) ? dash() : v))),
  );
}

export function sectionCard(title, body, { actions = null, flush = false, count = null, id = null } = {}) {
  return h(
    'section.card.panel',
    { id, 'aria-label': typeof title === 'string' ? title : null },
    h('div.card-head', h('h2.grow', title, count !== null ? h('span.count', ` ${count}`) : null), actions),
    h(`div.card-body${flush ? '.flush' : ''}`, body),
  );
}

export function miniEmpty(text, action = null) {
  return h('div.mini-empty', h('p', text), action);
}

export function moreMenuButton(items, label = 'More actions') {
  return h('button.icon-btn.bordered', { type: 'button', 'aria-label': label, title: label, onClick: (e) => openMenu(e.currentTarget, items.filter(Boolean), { align: 'end' }) }, icon('more'));
}

/**
 * Delete with confirmation and an Undo toast. onUndo(removed, extraResult)
 * puts back what extra() changed. meterSource names the source type of the
 * meter reading the record made ('inspection', 'issue'): it is removed with
 * the record and comes back with it.
 */
export async function deleteWithUndo(coll, rec, { label, message, onDeleted, extra, onUndo, meterSource = null } = {}) {
  const ok = await confirmDialog({ title: `Delete ${label}?`, message: message || `This permanently deletes the ${label}.`, confirmLabel: 'Delete', danger: true });
  if (!ok) return false;
  const removed = app.store.remove(coll, rec.id);
  // Deleted meanwhile (another device, a teammate): nothing to undo.
  if (!removed) {
    onDeleted?.();
    toast(`${label[0].toUpperCase()}${label.slice(1)} was already deleted`);
    return true;
  }
  const reading = meterSource ? removeMeterFor(app.store, meterSource, rec.id) : null;
  const more = extra?.(removed);
  onDeleted?.();
  const undo = () => {
    app.store.restore(coll, removed);
    if (reading) {
      app.store.restore('meters', reading);
      recomputeVehicleMeter(app.store, reading.vehicleId);
    }
    onUndo?.(removed, more);
  };
  toast(`${label[0].toUpperCase()}${label.slice(1)} deleted`, { action: { label: 'Undo', run: undo } });
  return true;
}

// ---- Attachments ------------------------------------------------------------------------

/**
 * Photos and documents on a record. Images show as a grid of thumbnails
 * (open full size in a viewer), other files as a list.
 */
export function attachmentsPanel(coll, recordId, { title = 'Photos and documents', folder = coll } = {}) {
  const editable = canEdit(coll);
  const input = h('input', { type: 'file', multiple: true, hidden: true, accept: 'image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt' });
  const body = h('div.attach-body');
  const panel = sectionCard(title, body, {
    actions: editable ? h('button.btn.sm', { type: 'button', onClick: () => input.click() }, icon('upload', 15), 'Upload') : null,
  });
  panel.append(input);

  async function upload(files) {
    const list = [...files];
    if (!list.length) return;
    const t = toast(`Uploading ${list.length} file${list.length === 1 ? '' : 's'}`, { type: 'info', duration: 60000 });
    const added = [];
    for (const f of list) {
      try {
        added.push(await saveFile(f, `files/${folder}`));
      } catch (err) {
        toast(err.message || `Could not upload ${f.name}`, { type: 'error' });
      }
    }
    t();
    if (!added.length) return;
    app.store.patch(coll, recordId, (r) => ({ ...r, attachments: [...(r.attachments || []), ...added] }));
    toast(`${added.length} file${added.length === 1 ? '' : 's'} added`);
  }
  input.addEventListener('change', () => {
    upload(input.files);
    input.value = '';
  });
  if (editable) {
    panel.addEventListener('dragover', (e) => {
      if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
      e.preventDefault();
      panel.classList.add('drop-target');
    });
    panel.addEventListener('dragleave', (e) => {
      if (!panel.contains(e.relatedTarget)) panel.classList.remove('drop-target');
    });
    panel.addEventListener('drop', (e) => {
      e.preventDefault();
      panel.classList.remove('drop-target');
      upload(e.dataTransfer.files);
    });
  }

  function draw() {
    const rec = app.store.get(coll, recordId);
    const files = rec?.attachments || [];
    const images = files.filter((a) => isImage(a.type));
    const docs = files.filter((a) => !isImage(a.type));
    if (!files.length) {
      body.replaceChildren(
        editable
          ? h('button.drop-zone', { type: 'button', onClick: () => input.click() }, icon('upload', 20), h('span', h('strong', 'Drop files here'), ' or click to upload'), h('span.subtle', 'Photos are resized before upload'))
          : miniEmpty('No files yet.'),
      );
      return;
    }
    // mount() skips the nulls; replaceChildren() would print them as "null".
    mount(
      body,
      images.length
        ? h(
            'ul.photo-grid',
            images.map((a) => {
              const thumb = h('span.photo-thumb', icon('image', 20));
              loadImage(thumb, a, a.name);
              return h('li', h('button.photo-btn', { type: 'button', 'aria-label': `View ${a.name}`, onClick: () => viewImage(a, images) }, thumb));
            }),
          )
        : null,
      docs.length
        ? h(
            'ul.file-list',
            docs.map((a) =>
              h(
                'li.file-row',
                icon('file', 18),
                h('span.grow.truncate', h('button.link-btn', { type: 'button', onClick: () => openFile(a) }, a.name)),
                h('span.subtle.nowrap', formatBytes(a.size)),
                editable ? h('button.icon-btn.sm', { type: 'button', 'aria-label': `Remove ${a.name}`, onClick: () => removeFile(a) }, icon('trash', 15)) : null,
              ),
            ),
          )
        : null,
    );
  }

  async function removeFile(att) {
    const ok = await confirmDialog({ title: 'Remove file?', message: `${att.name} will be deleted.`, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    app.store.patch(coll, recordId, (r) => ({ ...r, attachments: (r.attachments || []).filter((a) => a.id !== att.id) }));
    deleteFile(att).catch(() => {});
  }

  function viewImage(att, all) {
    let i = all.indexOf(att);
    const img = h('div.viewer-img');
    const caption = h('div.viewer-caption');
    const show = () => {
      const a = all[i];
      img.replaceChildren(icon('loader', 24, 'spin'));
      loadImage(img, a, a.name);
      caption.replaceChildren(h('span.grow.truncate', a.name), h('span.subtle', `${i + 1} of ${all.length}`));
    };
    const dlg = openDialog({
      title: 'Photo',
      size: 'wide',
      body: h('div.viewer', img, caption),
      footer: ({ close }) => [
        editable ? h('button.btn.subtle-danger', { type: 'button', onClick: () => (close(), removeFile(all[i])) }, icon('trash', 15), 'Delete') : null,
        h('div.spacer'),
        all.length > 1 ? h('button.btn', { type: 'button', onClick: () => ((i = (i - 1 + all.length) % all.length), show()) }, icon('chevron-left', 16), 'Previous') : null,
        all.length > 1 ? h('button.btn', { type: 'button', onClick: () => ((i = (i + 1) % all.length), show()) }, 'Next', icon('chevron-right', 16)) : null,
        h('button.btn', { type: 'button', onClick: () => openFile(all[i]) }, icon('external', 15), 'Open'),
      ],
    });
    dlg.dialog.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' && all.length > 1) ((i = (i + 1) % all.length), show());
      if (e.key === 'ArrowLeft' && all.length > 1) ((i = (i - 1 + all.length) % all.length), show());
    });
    show();
  }

  draw();
  onLeave(app.store.subscribe((c) => c.has(coll) && draw()));
  return panel;
}

export async function openFile(att) {
  try {
    const url = await fileUrl(att);
    const a = h('a', { href: url, target: '_blank', rel: 'noopener', download: isImage(att.type) || att.type === 'application/pdf' ? null : att.name });
    document.body.append(a);
    a.click();
    a.remove();
  } catch {
    toast('This file is not available.', { type: 'error' });
  }
}

// ---- Comments ---------------------------------------------------------------------------

export function commentsPanel(parentType, parentId) {
  const list = h('ul.comments');
  const text = h('textarea.textarea', { rows: 2, placeholder: 'Add a comment', 'aria-label': 'Add a comment' });
  const post = () => {
    const v = text.value.trim();
    if (!v) return;
    app.store.put('comments', { parentType, parentId, text: v, author: myName(), authorUuid: app.user?.uuid || null });
    text.value = '';
  };
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      post();
    }
  });
  const form = canEdit('comments') ? h('div.comment-form', text, h('div.row.comment-actions', h('span.subtle.grow', 'Ctrl+Enter to post'), h('button.btn.sm.primary', { type: 'button', onClick: post }, 'Post'))) : null;

  function draw() {
    const items = app.store
      .all('comments')
      .filter((c) => c.parentType === parentType && c.parentId === parentId)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    list.replaceChildren(
      ...items.map((c) =>
        h(
          'li.comment',
          avatar(c.author || '?', { color: colorFor(c.author), size: 'sm' }),
          h(
            'div.grow',
            h('div.comment-head', h('strong', c.author || 'Someone'), h('span.subtle', { title: c.createdAt }, timeAgo(c.createdAt)), mine(c) ? h('button.link-btn.comment-del', { type: 'button', onClick: () => remove(c), 'aria-label': 'Delete comment' }, 'Delete') : null),
            h('p.comment-text', c.text),
          ),
        ),
      ),
    );
    if (!items.length) list.replaceChildren(h('li.mini-empty', h('p', 'No comments yet.')));
  }
  const mine = (c) => (app.demo ? true : c.authorUuid && c.authorUuid === app.user?.uuid);
  // One click deletes; the toast's Undo puts it back.
  function remove(c) {
    const removed = app.store.remove('comments', c.id);
    if (!removed) return;
    if (form) text.focus();
    toast('Comment deleted', { action: { label: 'Undo', run: () => app.store.restore('comments', removed) } });
  }
  draw();
  const panel = sectionCard('Comments', h('div', list, form));
  onLeave(app.store.subscribe((c) => c.has('comments') && draw()));
  return panel;
}

// ---- Misc ------------------------------------------------------------------------------

export function personInitials(name) {
  return initials(name);
}

/** Tabs that switch content in place (detail pages). */
export function viewTabs(items, selected, onSelect, label) {
  const bar = h('div.tabs.detail-tabs', { role: 'tablist', 'aria-label': label });
  const btns = items.map((t) =>
    h(
      'button',
      { type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-selected': String(t.id === selected), tabindex: t.id === selected ? '0' : '-1', onClick: () => onSelect(t.id) },
      t.label,
      t.count ? h('span.tab-count', String(t.count)) : null,
    ),
  );
  bar.append(...btns);
  bar.addEventListener('keydown', (e) => {
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    let n = null;
    if (e.key === 'ArrowRight') n = (i + 1) % btns.length;
    if (e.key === 'ArrowLeft') n = (i - 1 + btns.length) % btns.length;
    if (e.key === 'Home') n = 0;
    if (e.key === 'End') n = btns.length - 1;
    if (n !== null) {
      e.preventDefault();
      btns[n].focus();
      btns[n].click();
    }
  });
  return bar;
}

/** Shown in place of a record page when the record is deleted while open (another device, a teammate). */
export function deletedNotice(label, back) {
  return emptyState({ icon: 'trash', title: `This ${label} was deleted`, text: 'It may have been deleted on another device or by someone on your team.', headingLevel: 1, actions: [h('a.btn.primary', { href: back.href }, back.label)] });
}

/** In place of a form the person's role may not use (a driver in a shared fleet). */
export function noPermissionPage(what) {
  return h('div.page', emptyState({ icon: 'lock', title: `You can't change ${what}`, text: `Your role in this fleet does not have permission to add or edit ${what}. Ask the fleet owner or an admin.`, headingLevel: 1, actions: [h('a.btn.primary', { href: '#/' }, 'Go to dashboard')] }));
}

export function emptyPage(title, text) {
  return h('div.page', emptyState({ icon: 'search', title, text, headingLevel: 1, actions: [h('a.btn.primary', { href: '#/' }, 'Go to dashboard')] }));
}

const sortCmp = (a, b) => (a === b ? 0 : a === null || a === undefined || a === '' ? 1 : b === null || b === undefined || b === '' ? -1 : typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true }));

/** Rows in a table's sort order ({ id, dir } of a column with sort(row)); empty values last. */
export function sortRows(rows, columns, sort) {
  const col = sort && columns.find((c) => c.id === sort.id);
  return col?.sort ? [...rows].sort((a, b) => sortCmp(col.sort(a), col.sort(b)) * (sort.dir === 'desc' ? -1 : 1)) : rows;
}

/**
 * A compact table for lists embedded in detail pages: sortable headers,
 * "Show more" paging, and a card layout on phones.
 * columns: [{ id, label, render(row), sort?(row), align }]
 * onSort(sort) hears each header click, so a screen that redraws the
 * table can pass the person's choice back in as defaultSort.
 */
export function simpleTable({ rows, columns, rowHref, mobile, empty = 'Nothing yet.', caption = 'Records', pageSize = 25, defaultSort = null, onSort = null }) {
  const wrap = h('div.simple-table');
  let shown = pageSize;
  let sort = defaultSort;
  // A redraw replaces the header and the Show more button. Put keyboard
  // focus back on the same control, or on the first row Show more revealed.
  function redraw(fk, firstNew = -1) {
    draw();
    // The table on wider screens, the cards on phones: only one is visible.
    const row = (sel) => (firstNew >= 0 ? wrap.querySelectorAll(sel)[firstNew]?.querySelector('a, button') : null);
    for (const el of [wrap.querySelector(`[data-fk="${fk}"]`), row('tbody tr'), row('ul.grid-cards > li')]) {
      el?.focus({ preventScroll: firstNew < 0 });
      if (el && document.activeElement === el) return;
    }
  }
  function draw() {
    if (!rows.length) return wrap.replaceChildren(miniEmpty(empty));
    const list = sortRows(rows, columns, sort);
    const visible = list.slice(0, shown);
    mount(
      wrap,
      h(
        'div.table-wrap.hide-mobile',
        h(
          'table.table.compact',
          h('caption.sr-only', caption),
          h(
            'thead',
            h(
              'tr',
              columns.map((c) => {
                const active = sort?.id === c.id;
                return h(
                  `th${c.align === 'r' ? '.r' : ''}`,
                  { scope: 'col', 'aria-sort': active ? (sort.dir === 'desc' ? 'descending' : 'ascending') : null },
                  c.sort ? h('button.sort', { type: 'button', dataset: { fk: `sort:${c.id}` }, onClick: () => ((sort = { id: c.id, dir: active && sort.dir === 'asc' ? 'desc' : 'asc' }), onSort?.(sort), redraw(`sort:${c.id}`)) }, c.label, icon(active ? (sort.dir === 'desc' ? 'arrow-down' : 'arrow-up') : 'sort', 13)) : c.label,
                );
              }),
            ),
          ),
          h(
            'tbody',
            visible.map((r) => {
              const href = rowHref?.(r);
              const tr = h(
                `tr${href ? '.clickable' : ''}`,
                columns.map((c, i) => h(`td${c.align === 'r' ? '.r' : ''}`, i === 0 && href ? h('a.row-link', { href }, c.render(r)) : c.render(r))),
              );
              if (href) tr.addEventListener('click', (e) => !e.target.closest('a,button,input') && (location.hash = href.slice(1)));
              return tr;
            }),
          ),
        ),
      ),
      h('ul.list.grid-cards.show-mobile', visible.map((r) => h('li', rowHref?.(r) ? h('a.list-item.grid-card', { href: rowHref(r) }, (mobile || defaultMobile)(r)) : h('div.list-item.grid-card', (mobile || defaultMobile)(r))))),
      list.length > shown ? h('div.show-more', h('button.btn.sm', { type: 'button', dataset: { fk: 'more' }, onClick: () => ((shown += pageSize), redraw('more', shown - pageSize)) }, `Show ${Math.min(pageSize, list.length - shown)} more`)) : null,
    );
  }
  const defaultMobile = (r) => h('div.card-rows', columns.map((c) => h('div.card-row', h('span.subtle', c.label), h('span', c.render(r)))));
  draw();
  return wrap;
}

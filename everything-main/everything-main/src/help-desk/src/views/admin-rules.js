/**
 * Admin: the rules that shape how work flows. Macros (saved replies and
 * actions), shared views, triggers, custom ticket fields and service level
 * targets. Each section is a list with an editor; editors are deep-linked
 * (#/admin/<section>/<id> or /new) so the browser's back button works.
 */
import './admin-rules.css';
import { h, clear, uid, debounce, announce, composing } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openMenu } from '../ui/popover.js';
import { confirmDialog } from '../ui/dialog.js';
import { selectField, emptyState } from '../ui/components.js';
import { createEditor } from '../ui/editor.js';
import { toast, toastError } from '../ui/toast.js';
import { go } from '../ui/router.js';
import { guardUnsaved } from './admin-common.js';
import { SYSTEM_VIEWS, DEFAULT_COLUMNS, DEFAULT_SLA, inView, renderPlaceholders } from '../shared/rules.js';
import { PRIORITIES, PRIORITY_LABEL, FIELD_TYPES } from '../shared/model.js';
import { escapeHtml, sanitizeHtml } from '../shared/html.js';
import { app } from '../app.js';
import { COLUMNS, GROUPS } from './ticket-table.js';
import { conditionBuilder, actionBuilder, placeholderButton, customFields, names } from './rules-builders.js';
import {
  newId, describeConditions, describeActions, describeTrigger, validateMacro, validateView, validateTrigger,
  validateField, optionValue, move, duplicateTitle, splitMinutes, joinMinutes, formatMinutes,
} from './rules-logic.js';

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ------------------------------------------------------------- pieces */

function head(title, desc, ...actions) {
  return h('header.ar-head',
    h('div.ar-head-text', h('h1#admin-title.ar-title', title), desc ? h('p.ar-desc', desc) : null),
    actions.length ? h('div.ar-head-actions', actions) : null);
}

function switchInput({ checked, label, onChange, id = uid('sw') }) {
  return h(`input#${id}.switch`, { type: 'checkbox', role: 'switch', checked: !!checked, 'aria-label': label, onchange: (e) => onChange(e.target.checked) });
}

function moreButton(label, items) {
  const btn = h('button.icon-btn', { type: 'button', 'aria-label': label, title: 'More actions', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => openMenu(btn, items(), { align: 'end', label }) }, icon('ellipsis', { size: 18 }));
  return btn;
}

function searchBox(placeholder, onInput) {
  const id = uid('q');
  const input = h(`input#${id}.input`, { type: 'search', placeholder, autocomplete: 'off', oninput: debounce(() => onInput(input.value.trim().toLowerCase()), 80) });
  return h('div.search-input.ar-search', h('label.sr-only', { for: id }, placeholder), icon('search', { size: 14 }), input);
}

function callout(glyph, ...content) {
  return h('div.ar-callout', icon(glyph, { size: 16 }), h('div', content));
}

async function saveKind(kind, list, message, { undo = null } = {}) {
  try {
    await app.saveConfig(kind, list);
    if (message) {
      toast(message, {
        kind: 'success',
        action: undo ? { label: 'Undo', run: () => app.saveConfig(kind, undo).then(() => toast('Restored.')).catch(toastError) } : null,
      });
    }
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

/**
 * Change a settings list, one change at a time per kind, each applied to
 * the list as the last save left it. Quick toggles, moves and deletes would
 * otherwise each start from the same old copy and undo one another.
 */
const pending = {};
function editList(kind, edit, message, opts) {
  const run = () => saveKind(kind, edit(app.replica.cfg[kind] || []), message, opts);
  pending[kind] = (pending[kind] || Promise.resolve()).then(run, run);
  return pending[kind];
}

function byId(list, id, d) {
  const i = list.findIndex((x) => x.id === id);
  return i === -1 ? list : move(list, i, d);
}

/**
 * An editor page: sticky bar with back, title and save; a body for fields.
 * `getDraft()` compared with its value at `ready()` drives the unsaved state.
 */
function editorFrame(root, { backTo, backLabel, title, isNew, getDraft, onSave, extra = null }) {
  let baseline = null;
  const error = h('div.ar-error', { role: 'alert', hidden: true });
  const status = h('span.ar-dirty', { 'aria-live': 'polite' });
  const save = h('button.btn.btn-primary', { type: 'submit', form: undefined }, isNew ? 'Create' : 'Save');
  const cancel = h('button.btn', { type: 'button', onclick: () => leave() }, 'Cancel');
  const body = h('div.ar-editor-body');
  const form = h('form.ar-editor', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      await submit();
    },
    oninput: () => refresh(),
    onchange: () => refresh(),
  },
  h('div.ar-editor-bar',
    h('button.icon-btn', { type: 'button', 'aria-label': `Back to ${backLabel}`, title: `Back to ${backLabel}`, onclick: () => leave() }, icon('arrow-left', { size: 18 })),
    h('div.ar-editor-title', h('span.ar-crumb', backLabel), h('h1#admin-title', title)),
    status, extra, cancel, save),
  error,
  body);
  root.append(form);

  function changed() {
    return baseline !== null && JSON.stringify(getDraft()) !== baseline;
  }

  // Leaving with unsaved changes asks first, however the agent leaves. The
  // guard retires itself once the editor is gone.
  const unguard = guardUnsaved(() => {
    if (!form.isConnected) {
      unguard();
      return false;
    }
    return changed();
  });

  function refresh() {
    status.textContent = !isNew && changed() ? 'Unsaved changes' : '';
    save.disabled = !isNew && !changed();
  }

  function leave() {
    go(backTo);
  }

  async function submit() {
    error.hidden = true;
    save.disabled = true;
    const label = save.textContent;
    save.textContent = 'Saving';
    try {
      const before = location.hash;
      const problem = await onSave();
      // A save that moved on succeeded: what is on screen is now saved.
      if (!problem && location.hash !== before) baseline = JSON.stringify(getDraft());
      if (problem) {
        error.hidden = false;
        clear(error);
        error.append(icon('triangle-alert', { size: 16 }), h('span', problem));
        // The error box is an alert: screen readers read it once as it appears.
        error.scrollIntoView({ block: 'nearest' });
      }
    } finally {
      save.textContent = label;
      if (form.isConnected) refresh();
    }
  }

  return {
    body,
    refresh,
    form,
    /** Call once the editor is built: what counts as "no changes". */
    ready() {
      baseline = JSON.stringify(getDraft());
      refresh();
    },
  };
}

function textField(labelText, value, { onInput, hint = null, placeholder = '', maxlength = 120, required = false } = {}) {
  const id = uid('tf');
  const input = h(`input#${id}.input`, { type: 'text', value: value || '', placeholder, maxlength, required, 'aria-required': required ? 'true' : undefined, oninput: (e) => onInput(e.target.value) });
  return { el: h('div.field', h('label.field-label', { for: id }, labelText, required ? h('span.ar-req', { 'aria-hidden': 'true' }, '*') : null), input, hint ? h('p.field-hint', hint) : null), input };
}

function editorSection(title, desc, ...body) {
  const id = uid('sec');
  return h('section.ar-section', { 'aria-labelledby': id },
    h('div.ar-section-head', h(`h2#${id}`, title), desc ? h('p.ar-section-desc', desc) : null),
    h('div.ar-section-body', body));
}

function activeRow(checked, onChange, labelText = 'Active', desc = '') {
  const id = uid('act');
  return h('div.ar-toggle-row', h('div', h('label.field-label', { for: id }, labelText), desc ? h('p.field-hint', desc) : null), switchInput({ id, checked, label: labelText, onChange }));
}

/** A visible label for a select-like button that still reads its value. */
function selectBlock(text, btn) {
  const labelId = uid('lbl');
  const value = btn.querySelector('.value');
  if (value) {
    value.id ||= uid('val');
    btn.setAttribute('aria-labelledby', `${labelId} ${value.id}`);
  }
  return h('div.field', h(`span#${labelId}.field-label`, text), btn);
}

function notAdmin(root) {
  root.append(emptyState({ glyph: 'shield', title: 'Administrators only', text: 'Ask an administrator of this help desk to change these settings.' }));
}

/* ------------------------------------------------------------- macros */

function macroSummary(m) {
  const acts = describeActions(m.actions, names(), customFields());
  if (m.comment?.html) acts.push(m.comment.public ? 'Adds a public reply' : 'Adds an internal note');
  return acts.join(' · ') || 'Does nothing yet';
}

function macrosList(root) {
  const list = () => app.replica.cfg.macros || [];
  let q = '';
  const items = h('ul.ar-list', { 'aria-label': 'Macros' });
  const count = h('p.ar-count');
  root.append(
    head('Macros', 'Saved replies and actions that agents apply to a ticket in one step. Use placeholders to personalize the text.',
      h('a.btn.btn-primary', { href: '#/admin/macros/new' }, icon('plus', { size: 15 }), 'New macro')),
    h('div.ar-toolbar', searchBox('Search macros', (v) => { q = v; paint(); })),
    items, count,
  );
  function paint() {
    clear(items);
    const all = list();
    const shown = all.filter((m) => !q || `${m.title} ${m.desc || ''}`.toLowerCase().includes(q));
    count.textContent = all.length ? `${shown.length} of ${all.length} macros` : '';
    if (!all.length) {
      items.append(h('li', emptyState({ glyph: 'zap', title: 'No macros yet', text: 'Create a macro for replies you send often, like asking for details or closing a solved request.', action: h('a.btn.btn-primary', { href: '#/admin/macros/new' }, 'Create a macro') })));
      return;
    }
    if (!shown.length) items.append(h('li.ar-none', 'No macros match your search.'));
    for (const m of shown) {
      items.append(h(`li.ar-item${m.active === false ? '.inactive' : ''}`,
        h('a.ar-item-main', { href: `#/admin/macros/${m.id}` },
          h('span.ar-item-icon', icon(m.comment?.html ? (m.comment.public ? 'reply' : 'lock') : 'zap', { size: 16 })),
          h('span.ar-item-text', h('span.ar-item-title', m.title, m.active === false ? h('span.badge', 'Inactive') : null), h('span.ar-item-sub', m.desc || macroSummary(m)))),
        switchInput({ checked: m.active !== false, label: `${m.title} active`, onChange: (on) => editList('macros', (l) => l.map((x) => (x.id === m.id ? { ...x, active: on } : x)), on ? `"${m.title}" is active.` : `"${m.title}" is turned off.`) }),
        moreButton(`Actions for ${m.title}`, () => [
          { label: 'Edit', icon: 'pencil', run: () => go(`/admin/macros/${m.id}`) },
          { label: 'Duplicate', icon: 'copy', run: () => duplicate(m) },
          { separator: true },
          { label: 'Delete', icon: 'trash', danger: true, run: () => remove(m) },
        ])));
    }
  }
  async function duplicate(m) {
    const copy = { ...clone(m), id: newId(), title: duplicateTitle(m.title, list()) };
    if (await editList('macros', (l) => [...l, copy], `Duplicated "${m.title}".`)) go(`/admin/macros/${copy.id}`);
  }
  async function remove(m) {
    const ok = await confirmDialog({ title: `Delete "${m.title}"?`, message: 'Agents will no longer be able to apply this macro.', confirmLabel: 'Delete macro', danger: true });
    if (!ok) return;
    const before = clone(list());
    await editList('macros', (l) => l.filter((x) => x.id !== m.id), `Deleted "${m.title}".`, { undo: before });
  }
  const onChange = (e) => {
    if (!e.detail?.kinds || e.detail.kinds.has('c')) repaintKeepingFocus(root, paint);
  };
  app.replica.addEventListener('change', onChange);
  paint();
  return () => app.replica.removeEventListener('change', onChange);
}

function sampleData() {
  const t = [...app.replica.tickets.values()].find((x) => app.replica.users.get(x.requester)) || null;
  const requester = t ? app.replica.users.get(t.requester) : { name: 'Alex Morgan', email: 'alex@example.com' };
  return {
    ticket: t || { id: 1042, subject: 'Unable to sign in', status: 'open', priority: 'normal' },
    requester,
    agent: app.me || { name: 'You' },
    desk: app.replica.meta || { name: 'Help desk' },
    link: app.helpCenterUrl() ? `${app.helpCenterUrl()}/requests/${t?.id || 1042}` : 'https://help.example.com/requests/1042',
  };
}

function macroEditor(root, id) {
  const isNew = id === 'new';
  const existing = (app.replica.cfg.macros || []).find((m) => m.id === id);
  if (!isNew && !existing) {
    root.append(emptyState({ glyph: 'zap', title: 'This macro no longer exists', action: h('a.btn', { href: '#/admin/macros' }, 'Back to macros') }));
    return null;
  }
  const original = existing ? clone(existing) : { id: newId(), title: '', desc: '', active: true, actions: [], comment: null };
  const draft = clone(original);
  // Most macros are replies, so a new one starts with the comment on.
  let commentOn = isNew || !!draft.comment?.html;
  let commentPublic = draft.comment ? draft.comment.public !== false : true;

  const frame = editorFrame(root, {
    backTo: '/admin/macros', backLabel: 'Macros', title: isNew ? 'New macro' : original.title, isNew,
    getDraft: () => current(),
    onSave: async () => {
      const value = current();
      const problem = validateMacro(value);
      if (problem) return problem;
      const list = clone(app.replica.cfg.macros || []);
      const i = list.findIndex((m) => m.id === value.id);
      if (i === -1) list.push(value);
      else list[i] = value;
      if (await saveKind('macros', list, isNew ? `Created "${value.title}".` : `Saved "${value.title}".`)) go('/admin/macros');
      return null;
    },
  });

  function current() {
    const html = commentOn ? editor.getHtml() : '';
    return { ...draft, title: draft.title.trim(), desc: (draft.desc || '').trim(), comment: html ? { html, public: commentPublic } : null };
  }

  const title = textField('Title', draft.title, { onInput: (v) => { draft.title = v; }, placeholder: 'Ask for more details', required: true });
  const desc = textField('Description', draft.desc, { onInput: (v) => { draft.desc = v; }, placeholder: 'When to use it (optional)', maxlength: 300, hint: 'Helps teammates pick the right macro.' });
  const actions = actionBuilder({ kind: 'macro', value: draft.actions, onChange: (v) => { draft.actions = v; frame.refresh(); }, emptyText: 'No actions. A macro can also only add a comment.' });

  const preview = h('div.ar-preview-body.prose', { 'aria-live': 'polite' });
  let editor = null;
  editor = createEditor({ label: 'Macro comment', placeholder: 'Hi {{requester.first_name}}, ...', minHeight: 140, onChange: () => { if (!editor) return; paintPreview(); frame.refresh(); } });
  if (draft.comment?.html) editor.setHtml(draft.comment.html);
  const insertPh = placeholderButton(() => null, { onInsert: (code) => editor.insertHtml(escapeHtml(code)) });

  const modeName = uid('mode');
  const modeGroup = h('div.ar-segment', { role: 'radiogroup', 'aria-label': 'Comment type' },
    [['public', 'reply', 'Public reply'], ['internal', 'lock', 'Internal note']].map(([v, ic, label]) => {
      const rid = uid('r');
      return h('label.ar-seg', { for: rid },
        h(`input#${rid}`, { type: 'radio', name: modeName, value: v, checked: (v === 'public') === commentPublic, onchange: () => { commentPublic = v === 'public'; commentWrap.classList.toggle('internal', !commentPublic); frame.refresh(); } }),
        icon(ic, { size: 14 }), label);
    }));
  const commentWrap = h(`div.ar-comment${commentPublic ? '' : '.internal'}`, h('div.ar-comment-tools', modeGroup, h('span.spacer'), insertPh), editor.el);
  const previewCard = h('aside.ar-preview', { 'aria-label': 'Preview' }, h('div.ar-preview-head', icon('eye', { size: 14 }), 'Preview with a sample ticket'), preview);
  const commentBody = h('div.ar-comment-grid', commentWrap, previewCard);
  const commentSwitchId = uid('csw');
  const commentToggle = h('div.ar-toggle-row',
    h('div', h('label.field-label', { for: commentSwitchId }, 'Add a comment'), h('p.field-hint', 'Inserted into the reply box, where the agent can edit it before sending.')),
    switchInput({ id: commentSwitchId, checked: commentOn, label: 'Add a comment', onChange: (on) => { commentOn = on; commentBody.hidden = !on; frame.refresh(); if (on) editor.focus(); } }));
  commentBody.hidden = !commentOn;

  function paintPreview() {
    const html = editor.getHtml();
    clear(preview);
    if (!html) {
      preview.append(h('p.subtle', 'The comment will appear here with placeholders filled in.'));
      return;
    }
    preview.innerHTML = sanitizeHtml(renderPlaceholders(html, sampleData(), { escape: escapeHtml }));
  }
  frame.body.append(
    editorSection('Details', null, h('div.ar-grid-2', title.el, desc.el), activeRow(draft.active !== false, (on) => { draft.active = on; frame.refresh(); }, 'Active', 'Inactive macros are hidden from agents.')),
    editorSection('Actions', 'Field changes made when an agent applies the macro. They are saved when the agent submits the ticket.', actions.el),
    editorSection('Comment', null, commentToggle, commentBody),
  );
  paintPreview();
  frame.ready();
  if (isNew) title.input.focus();
  return null;
}

/* -------------------------------------------------------------- views */

function viewCount(view) {
  const ctx = { me: app.me?.uuid, now: Date.now() };
  let n = 0;
  for (const t of app.replica.tickets.values()) if (inView({ ...view, special: null }, t, ctx)) n++;
  return n;
}

function viewsList(root) {
  const list = () => app.replica.cfg.views || [];
  const sys = h('ul.ar-list', { 'aria-label': 'Built-in views' });
  const shared = h('ul.ar-list', { 'aria-label': 'Shared views' });
  root.append(
    head('Views', 'Saved ticket lists every agent sees in Views. Views update as tickets change.',
      h('a.btn.btn-primary', { href: '#/admin/views/new' }, icon('plus', { size: 15 }), 'New view')),
    h('h2.ar-subhead', 'Shared views'), shared,
    h('h2.ar-subhead', 'Built in', h('span.ar-subhead-note', 'Always available. Create a shared view to customize one.')), sys,
  );
  function paint() {
    clear(sys);
    clear(shared);
    for (const v of SYSTEM_VIEWS) {
      sys.append(h('li.ar-item.readonly',
        h('a.ar-item-main', { href: `#/views/${v.id}` },
          h('span.ar-item-icon', icon('inbox', { size: 16 })),
          h('span.ar-item-text', h('span.ar-item-title', v.title, h('span.badge', 'Built in')), h('span.ar-item-sub', describeConditions(v.conditions, names())))),
        h('span.ar-item-count', { title: 'Tickets in this view now' }, String(viewCount(v))),
        moreButton(`Actions for ${v.title}`, () => [
          { label: 'Open view', icon: 'external-link', run: () => go(`/views/${v.id}`) },
          { label: 'Copy as a shared view', icon: 'copy', run: () => duplicate({ ...v, columns: DEFAULT_COLUMNS, active: true, groupBy: null }) },
        ])));
    }
    const views = list();
    if (!views.length) {
      shared.append(h('li', emptyState({ glyph: 'inbox', title: 'No shared views yet', text: 'Create views for your team, like urgent tickets, a queue per group, or tickets waiting on a third party.', action: h('a.btn.btn-primary', { href: '#/admin/views/new' }, 'Create a view') })));
    }
    views.forEach((v, i) => {
      shared.append(h(`li.ar-item${v.active === false ? '.inactive' : ''}`,
        reorder(i, views.length, v.title, (d) => editList('views', (l) => byId(l, v.id, d), null).then(() => announce(`${v.title} moved ${d < 0 ? 'up' : 'down'}`))),
        h('a.ar-item-main', { href: `#/admin/views/${v.id}` },
          h('span.ar-item-icon', icon('layout-list', { size: 16 })),
          h('span.ar-item-text', h('span.ar-item-title', v.title, v.active === false ? h('span.badge', 'Inactive') : null), h('span.ar-item-sub', describeConditions(v.conditions, names(), customFields())))),
        h('span.ar-item-count', { title: 'Tickets in this view now' }, String(viewCount(v))),
        switchInput({ checked: v.active !== false, label: `${v.title} active`, onChange: (on) => editList('views', (l) => l.map((x) => (x.id === v.id ? { ...x, active: on } : x)), on ? `"${v.title}" is shown in Views.` : `"${v.title}" is hidden from Views.`) }),
        moreButton(`Actions for ${v.title}`, () => [
          { label: 'Edit', icon: 'pencil', run: () => go(`/admin/views/${v.id}`) },
          { label: 'Open view', icon: 'external-link', run: () => go(`/views/${v.id}`) },
          { label: 'Duplicate', icon: 'copy', run: () => duplicate(v) },
          { separator: true },
          { label: 'Delete', icon: 'trash', danger: true, run: () => remove(v) },
        ])));
    });
  }
  async function duplicate(v) {
    const copy = { ...clone(v), id: newId(), title: duplicateTitle(v.title, [...list(), ...SYSTEM_VIEWS]) };
    delete copy.special;
    if (await editList('views', (l) => [...l, copy], `Created "${copy.title}".`)) go(`/admin/views/${copy.id}`);
  }
  async function remove(v) {
    const ok = await confirmDialog({ title: `Delete "${v.title}"?`, message: 'The view disappears for every agent. Tickets are not affected.', confirmLabel: 'Delete view', danger: true });
    if (!ok) return;
    const before = clone(list());
    await editList('views', (l) => l.filter((x) => x.id !== v.id), `Deleted "${v.title}".`, { undo: before });
  }
  const onChange = debounce(() => repaintKeepingFocus(root, paint), 200);
  app.replica.addEventListener('change', onChange);
  paint();
  return () => app.replica.removeEventListener('change', onChange);
}

/**
 * Repaint a list and keep keyboard focus on the button that was used: its
 * replacement has the same name. A move button that cannot move any further
 * (now first or last) hands focus to the opposite one.
 */
function repaintKeepingFocus(root, paint) {
  const was = document.activeElement;
  const label = was && root.contains(was) ? was.getAttribute('aria-label') : null;
  paint();
  if (!label || was.isConnected) return;
  const find = (l) => [...root.querySelectorAll('button[aria-label]')].find((e) => e.getAttribute('aria-label') === l && !e.disabled);
  (find(label) || find(label.replace(/ (up|down)$/, (m, d) => (d === 'up' ? ' down' : ' up'))))?.focus();
}

/** Focus the control with `data-focus` key after a repaint, the same way. */
function focusOn(root, key) {
  if (!key) return;
  const find = (k) => root.querySelector(`[data-focus="${k}"]`);
  let el = find(key);
  if (el?.disabled) el = find(key.replace(/^([ud])-/, (m, d) => (d === 'u' ? 'd-' : 'u-')));
  el?.focus();
}

function reorder(i, n, title, onMove) {
  return h('div.ar-reorder',
    h('button.icon-btn.sm', { type: 'button', disabled: i === 0, 'aria-label': `Move ${title} up`, title: 'Move up', onclick: () => onMove(-1) }, icon('arrow-up', { size: 14 })),
    h('button.icon-btn.sm', { type: 'button', disabled: i === n - 1, 'aria-label': `Move ${title} down`, title: 'Move down', onclick: () => onMove(1) }, icon('arrow-down', { size: 14 })));
}

function columnsChooser(value, onChange) {
  let cols = [...value];
  const el = h('div.ar-columns');
  function paint(focusKey) {
    clear(el);
    const chosen = h('ol.ar-col-list', { 'aria-label': 'Shown columns, in order' });
    cols.forEach((c, i) => {
      const id = uid('col');
      chosen.append(h('li.ar-col.on',
        h(`input#${id}`, { type: 'checkbox', checked: true, dataset: { focus: `c-${c}` }, onchange: () => { cols = cols.filter((x) => x !== c); onChange(cols); paint(`c-${c}`); } }),
        h('label', { for: id }, COLUMNS[c]?.label || c),
        h('span.ar-col-moves',
          h('button.icon-btn.sm', { type: 'button', disabled: i === 0, 'aria-label': `Move ${COLUMNS[c]?.label} up`, dataset: { focus: `u-${c}` }, onclick: () => { cols = move(cols, i, -1); onChange(cols); paint(`u-${c}`); } }, icon('arrow-up', { size: 13 })),
          h('button.icon-btn.sm', { type: 'button', disabled: i === cols.length - 1, 'aria-label': `Move ${COLUMNS[c]?.label} down`, dataset: { focus: `d-${c}` }, onclick: () => { cols = move(cols, i, 1); onChange(cols); paint(`d-${c}`); } }, icon('arrow-down', { size: 13 })))));
    });
    const others = h('ul.ar-col-list.others', { 'aria-label': 'Hidden columns' });
    for (const c of Object.keys(COLUMNS).filter((x) => !cols.includes(x))) {
      const id = uid('col');
      others.append(h('li.ar-col',
        h(`input#${id}`, { type: 'checkbox', checked: false, dataset: { focus: `c-${c}` }, onchange: () => { cols = [...cols, c]; onChange(cols); paint(`c-${c}`); } }),
        h('label', { for: id }, COLUMNS[c].label)));
    }
    el.append(h('div.ar-col-block', h('h3', 'Shown, in order'), cols.length ? chosen : h('p.rb-empty', 'Choose at least one column.')), h('div.ar-col-block', h('h3', 'Available'), others));
    focusOn(el, focusKey);
  }
  paint();
  return { el, get: () => cols };
}

function viewEditor(root, id) {
  const isNew = id === 'new';
  const existing = (app.replica.cfg.views || []).find((v) => v.id === id);
  if (!isNew && !existing) {
    root.append(emptyState({ glyph: 'layout-list', title: 'This view no longer exists', action: h('a.btn', { href: '#/admin/views' }, 'Back to views') }));
    return null;
  }
  const original = existing ? clone(existing) : {
    id: newId(), title: '', active: true,
    conditions: { all: [{ field: 'status', op: 'less_than', value: 'solved' }], any: [] },
    columns: [...DEFAULT_COLUMNS], sort: { field: 'updatedAt', dir: 'desc' }, groupBy: null,
  };
  const draft = clone(original);
  const openBtn = !isNew ? h('a.btn.btn-ghost', { href: `#/views/${draft.id}` }, icon('external-link', { size: 14 }), 'Open view') : null;
  const frame = editorFrame(root, {
    backTo: '/admin/views', backLabel: 'Views', title: isNew ? 'New view' : original.title, isNew,
    getDraft: () => ({ ...draft, title: draft.title.trim() }),
    extra: openBtn,
    onSave: async () => {
      const value = { ...draft, title: draft.title.trim() };
      const problem = validateView(value);
      if (problem) return problem;
      if (!value.columns.includes(value.sort.field) && !['updatedAt', 'createdAt'].includes(value.sort.field)) value.sort = { field: 'updatedAt', dir: value.sort.dir };
      const list = clone(app.replica.cfg.views || []);
      const i = list.findIndex((v) => v.id === value.id);
      if (i === -1) list.push(value);
      else list[i] = value;
      if (await saveKind('views', list, null)) {
        toast(isNew ? `Created "${value.title}".` : `Saved "${value.title}".`, { kind: 'success', action: { label: 'Open view', run: () => go(`/views/${value.id}`) } });
        go('/admin/views');
      }
      return null;
    },
  });
  const title = textField('Title', draft.title, { onInput: (v) => { draft.title = v; }, placeholder: 'Urgent and unassigned', required: true });
  const countEl = h('p.ar-live', { role: 'status', 'aria-live': 'polite' });
  const paintCount = debounce(() => {
    const n = viewCount(draft);
    clear(countEl);
    countEl.append(icon('inbox', { size: 15 }), h('span', h('strong', String(n)), ` ticket${n === 1 ? '' : 's'} match right now`));
  }, 120);
  const conds = conditionBuilder({ kind: 'view', value: draft.conditions, onChange: (v) => { draft.conditions = v; paintCount(); frame.refresh(); } });
  const cols = columnsChooser(draft.columns, (v) => { draft.columns = v; frame.refresh(); });

  const sortOpts = () => Object.entries(COLUMNS).map(([k, c]) => ({ value: k, label: c.label }));
  const sortField = selectField({ value: draft.sort.field, options: sortOpts, label: 'Sort by', onChange: (v) => { draft.sort = { ...draft.sort, field: v }; frame.refresh(); } });
  const sortDir = selectField({ value: draft.sort.dir, options: [{ value: 'desc', label: 'Newest or highest first' }, { value: 'asc', label: 'Oldest or lowest first' }], label: 'Sort direction', search: false, onChange: (v) => { draft.sort = { ...draft.sort, dir: v }; frame.refresh(); } });
  const groupBy = selectField({ value: draft.groupBy || '', options: [{ value: '', label: 'No grouping' }, ...Object.entries(GROUPS).map(([k, g]) => ({ value: k, label: g.label }))], label: 'Group by', search: false, onChange: (v) => { draft.groupBy = v || null; frame.refresh(); } });

  frame.body.append(
    editorSection('Details', null, title.el, activeRow(draft.active !== false, (on) => { draft.active = on; frame.refresh(); }, 'Show in Views', 'Inactive views are hidden from agents but kept here.')),
    editorSection('Conditions', 'Which tickets appear in this view. Suspended and deleted tickets never appear.', countEl, conds.el),
    editorSection('Layout', 'How the ticket table looks. Agents can change sorting and grouping for themselves.',
      cols.el,
      h('div.ar-grid-3', selectBlock('Sort by', sortField), selectBlock('Direction', sortDir), selectBlock('Group by', groupBy))),
  );
  paintCount();
  frame.ready();
  if (isNew) title.input.focus();
  return null;
}

/* ----------------------------------------------------------- triggers */

function triggersList(root) {
  const list = () => app.replica.cfg.triggers || [];
  const items = h('ol.ar-list.numbered', { 'aria-label': 'Triggers, in the order they run' });
  root.append(
    head('Triggers', null, h('a.btn.btn-primary', { href: '#/admin/triggers/new' }, icon('plus', { size: 15 }), 'New trigger')),
    callout('workflow',
      h('p', h('strong', 'Triggers act on tickets automatically. '), 'Each time a ticket is created or updated, active triggers are checked from top to bottom. When a trigger\'s conditions match, its actions run, such as setting a priority, assigning a group or emailing the requester.'),
      h('p.subtle', 'A trigger runs at most once per update, and later triggers see the changes earlier ones made, so order matters.')),
    items,
  );
  function paint() {
    clear(items);
    const triggers = list();
    if (!triggers.length) {
      items.append(h('li', emptyState({ glyph: 'workflow', title: 'No triggers', text: 'Without triggers nobody is emailed automatically. Create one to confirm new requests or send replies to customers.', action: h('a.btn.btn-primary', { href: '#/admin/triggers/new' }, 'Create a trigger') })));
      return;
    }
    triggers.forEach((t, i) => {
      items.append(h(`li.ar-item${t.active === false ? '.inactive' : ''}`,
        h('span.ar-order', { 'aria-hidden': 'true' }, String(i + 1)),
        reorder(i, triggers.length, t.title, (d) => editList('triggers', (l) => byId(l, t.id, d), null).then(() => announce(`${t.title} moved ${d < 0 ? 'up' : 'down'}`))),
        h('a.ar-item-main', { href: `#/admin/triggers/${t.id}` },
          h('span.ar-item-text', h('span.ar-item-title', t.title, t.active === false ? h('span.badge', 'Inactive') : null), h('span.ar-item-sub', describeTrigger(t, names(), customFields())))),
        switchInput({ checked: t.active !== false, label: `${t.title} active`, onChange: (on) => editList('triggers', (l) => l.map((x) => (x.id === t.id ? { ...x, active: on } : x)), on ? `"${t.title}" is on.` : `"${t.title}" is off.`) }),
        moreButton(`Actions for ${t.title}`, () => [
          { label: 'Edit', icon: 'pencil', run: () => go(`/admin/triggers/${t.id}`) },
          { label: 'Duplicate', icon: 'copy', desc: 'The copy starts turned off', run: () => duplicate(t) },
          { separator: true },
          { label: 'Delete', icon: 'trash', danger: true, run: () => remove(t) },
        ])));
    });
  }
  async function duplicate(t) {
    const copy = { ...clone(t), id: newId(), title: duplicateTitle(t.title, list()), active: false };
    if (await editList('triggers', (l) => [...l, copy], `Duplicated "${t.title}". The copy is turned off.`)) go(`/admin/triggers/${copy.id}`);
  }
  async function remove(t) {
    const ok = await confirmDialog({ title: `Delete "${t.title}"?`, message: 'Its actions will stop running on new updates. Past tickets are not changed.', confirmLabel: 'Delete trigger', danger: true });
    if (!ok) return;
    const before = clone(list());
    await editList('triggers', (l) => l.filter((x) => x.id !== t.id), `Deleted "${t.title}".`, { undo: before });
  }
  const onChange = (e) => {
    if (!e.detail?.kinds || e.detail.kinds.has('c') || e.detail.kinds.has('m')) repaintKeepingFocus(root, paint);
  };
  app.replica.addEventListener('change', onChange);
  paint();
  return () => app.replica.removeEventListener('change', onChange);
}

function triggerEditor(root, id) {
  const isNew = id === 'new';
  const existing = (app.replica.cfg.triggers || []).find((t) => t.id === id);
  if (!isNew && !existing) {
    root.append(emptyState({ glyph: 'workflow', title: 'This trigger no longer exists', action: h('a.btn', { href: '#/admin/triggers' }, 'Back to triggers') }));
    return null;
  }
  const original = existing ? clone(existing) : {
    id: newId(), title: '', active: true, event: 'created',
    conditions: { all: [{ field: 'actor', op: 'is', value: 'customer' }], any: [] },
    actions: [],
  };
  const draft = clone(original);
  const frame = editorFrame(root, {
    backTo: '/admin/triggers', backLabel: 'Triggers', title: isNew ? 'New trigger' : original.title, isNew,
    getDraft: () => ({ ...draft, title: draft.title.trim() }),
    onSave: async () => {
      const value = { ...draft, title: draft.title.trim() };
      const problem = validateTrigger(value);
      if (problem) return problem;
      const list = clone(app.replica.cfg.triggers || []);
      const i = list.findIndex((t) => t.id === value.id);
      if (i === -1) list.push(value);
      else list[i] = value;
      if (await saveKind('triggers', list, isNew ? `Created "${value.title}". It runs after the triggers above it.` : `Saved "${value.title}".`)) go('/admin/triggers');
      return null;
    },
  });
  const summary = h('p.ar-live.ar-summary', { role: 'status', 'aria-live': 'polite' });
  const paintSummary = debounce(() => {
    clear(summary);
    summary.append(icon('info', { size: 15 }), h('span', describeTrigger(draft, names(), customFields())));
  }, 120);
  const title = textField('Title', draft.title, { onInput: (v) => { draft.title = v; }, placeholder: 'Notify the requester when we reply', required: true });

  const evName = uid('ev');
  const events = h('div.ar-choices', { role: 'radiogroup', 'aria-label': 'Runs when' },
    [['created', 'A ticket is created'], ['updated', 'A ticket is updated'], ['any', 'A ticket is created or updated']].map(([v, label]) => {
      const rid = uid('r');
      return h('label.ar-choice', { for: rid }, h(`input#${rid}`, { type: 'radio', name: evName, value: v, checked: draft.event === v, onchange: () => { draft.event = v; paintSummary(); frame.refresh(); } }), h('span', label));
    }));
  const conds = conditionBuilder({ kind: 'trigger', value: draft.conditions, onChange: (v) => { draft.conditions = v; paintSummary(); frame.refresh(); } });
  const acts = actionBuilder({ kind: 'trigger', value: draft.actions, onChange: (v) => { draft.actions = v; paintSummary(); frame.refresh(); } });
  frame.body.append(
    editorSection('Details', null, title.el, activeRow(draft.active !== false, (on) => { draft.active = on; frame.refresh(); }, 'Active', 'Inactive triggers are skipped.')),
    editorSection('Runs when', null, events),
    editorSection('Conditions', 'Use "Updated by" and "Comment" to react to who made the change and whether they wrote a message.', conds.el),
    editorSection('Actions', 'What happens when the conditions match. Email actions use the help desk\'s email settings.', acts.el),
    h('div.ar-summary-wrap', summary),
  );
  paintSummary();
  frame.ready();
  if (isNew) title.input.focus();
  return null;
}

/* ------------------------------------------------------------- fields */

const FIELD_TYPE_INFO = {
  text: ['text-cursor-input', 'Text', 'A single line of text'],
  textarea: ['file-text', 'Multi-line text', 'Longer notes'],
  number: ['hash', 'Number', 'Whole or decimal numbers'],
  date: ['calendar', 'Date', 'A calendar date'],
  checkbox: ['square-check', 'Checkbox', 'Yes or no'],
  dropdown: ['list', 'Dropdown', 'One choice from a list'],
};

function fieldsList(root) {
  const list = () => app.replica.cfg.fields || [];
  const items = h('ul.ar-list', { 'aria-label': 'Ticket fields' });
  root.append(
    head('Ticket fields', 'Extra details to record on every ticket, like plan, product or order number. Fields appear in the ticket\'s properties panel, and you can use them in views, triggers and macros.',
      h('a.btn.btn-primary', { href: '#/admin/fields/new' }, icon('plus', { size: 15 }), 'New field')),
    items,
  );
  function paint() {
    clear(items);
    const fields = list();
    if (!fields.length) {
      items.append(h('li', emptyState({ glyph: 'text-cursor-input', title: 'No custom fields', text: 'Tickets already have status, priority, type, assignee and tags. Add fields for anything else your team needs to track.', action: h('a.btn.btn-primary', { href: '#/admin/fields/new' }, 'Create a field') })));
      return;
    }
    fields.forEach((f, i) => {
      const [ic, typeLabel] = FIELD_TYPE_INFO[f.type] || FIELD_TYPE_INFO.text;
      items.append(h(`li.ar-item${f.active === false ? '.inactive' : ''}`,
        reorder(i, fields.length, f.title, (d) => editList('fields', (l) => byId(l, f.id, d), null).then(() => announce(`${f.title} moved ${d < 0 ? 'up' : 'down'}`))),
        h('a.ar-item-main', { href: `#/admin/fields/${f.id}` },
          h('span.ar-item-icon', icon(ic, { size: 16 })),
          h('span.ar-item-text',
            h('span.ar-item-title', f.title, f.active === false ? h('span.badge', 'Inactive') : null),
            h('span.ar-item-sub', [typeLabel, f.type === 'dropdown' ? `${f.options?.length || 0} options` : null, f.required ? 'Required to solve' : null, f.portal ? 'In the help center' : null].filter(Boolean).join(' · ')))),
        switchInput({ checked: f.active !== false, label: `${f.title} active`, onChange: (on) => editList('fields', (l) => l.map((x) => (x.id === f.id ? { ...x, active: on } : x)), on ? `"${f.title}" is shown on tickets.` : `"${f.title}" is hidden from tickets.`) }),
        moreButton(`Actions for ${f.title}`, () => [
          { label: 'Edit', icon: 'pencil', run: () => go(`/admin/fields/${f.id}`) },
          { separator: true },
          { label: 'Delete', icon: 'trash', danger: true, run: () => remove(f) },
        ])));
    });
  }
  async function remove(f) {
    // Rules keep their conditions and actions on a deleted field, and keep
    // matching the values stored on tickets, so say which ones use it.
    const key = `field:${f.id}`;
    const uses = (r) => [...(r.conditions?.all || []), ...(r.conditions?.any || []), ...(r.actions || [])].some((x) => x.field === key);
    const counts = [['view', 'views'], ['macro', 'macros'], ['trigger', 'triggers']]
      .map(([one, kind]) => [one, (app.replica.cfg[kind] || []).filter(uses).length])
      .filter(([, n]) => n);
    const using = counts.map(([one, n]) => `${n} ${one}${n === 1 ? '' : 's'}`).join(', ').replace(/, ([^,]*)$/, ' and $1');
    const verb = counts.length === 1 && counts[0][1] === 1 ? 'uses' : 'use';
    const ok = await confirmDialog({
      title: `Delete "${f.title}"?`,
      message: `Values already saved on tickets stay stored, but they will no longer be shown or editable.${using ? ` ${using} still ${verb} this field and keep working on those values until you edit them.` : ''} To keep the values visible, turn the field off instead.`,
      confirmLabel: 'Delete field', danger: true,
    });
    if (!ok) return;
    const before = clone(list());
    await editList('fields', (l) => l.filter((x) => x.id !== f.id), `Deleted "${f.title}".`, { undo: before });
  }
  const onChange = (e) => {
    if (!e.detail?.kinds || e.detail.kinds.has('c')) repaintKeepingFocus(root, paint);
  };
  app.replica.addEventListener('change', onChange);
  paint();
  return () => app.replica.removeEventListener('change', onChange);
}

function optionsEditor(value, onChange) {
  let opts = (value || []).map((o) => ({ ...o }));
  const el = h('div.ar-options');
  function emit() {
    onChange(opts.map((o) => ({ label: o.label, value: o.value || optionValue(o.label) })));
  }
  function paint(focusKey) {
    clear(el);
    const list = h('ol.ar-opt-list', { 'aria-label': 'Options' });
    opts.forEach((o, i) => {
      const id = uid('opt');
      const stored = h('span.ar-opt-value.mono', { 'aria-hidden': 'true' }, o.value || optionValue(o.label) || '');
      const input = h(`input#${id}.input`, {
        type: 'text', value: o.label, maxlength: 100, placeholder: `Option ${i + 1}`, dataset: { focus: `o-${i}` },
        oninput: (e) => {
          o.label = e.target.value;
          if (o.fresh) o.value = optionValue(o.label);
          stored.textContent = o.value || optionValue(o.label);
          emit();
        },
        onkeydown: (e) => {
          if (e.key === 'Enter' && !composing(e)) {
            e.preventDefault();
            opts.splice(i + 1, 0, { label: '', value: '', fresh: true });
            emit();
            paint(`o-${i + 1}`);
          }
        },
      });
      list.append(h('li.ar-opt',
        h('label.sr-only', { for: id }, `Option ${i + 1}`), input, stored,
        h('span.ar-opt-tools',
          h('button.icon-btn.sm', { type: 'button', disabled: i === 0, 'aria-label': `Move option ${i + 1} up`, dataset: { focus: `u-${i}` }, onclick: () => { opts = move(opts, i, -1); emit(); paint(`u-${i - 1}`); } }, icon('arrow-up', { size: 13 })),
          h('button.icon-btn.sm', { type: 'button', disabled: i === opts.length - 1, 'aria-label': `Move option ${i + 1} down`, dataset: { focus: `d-${i}` }, onclick: () => { opts = move(opts, i, 1); emit(); paint(`d-${i + 1}`); } }, icon('arrow-down', { size: 13 })),
          h('button.icon-btn.sm', { type: 'button', 'aria-label': `Remove option ${i + 1}`, dataset: { focus: `r-${i}` }, onclick: () => { opts.splice(i, 1); emit(); paint(opts.length ? `r-${Math.min(i, opts.length - 1)}` : 'o-add'); } }, icon('x', { size: 14 })))));
    });
    el.append(opts.length ? list : h('p.rb-empty', 'No options yet.'),
      h('button.btn.btn-sm.rb-add', { type: 'button', dataset: { focus: 'o-add' }, onclick: () => { opts.push({ label: '', value: '', fresh: true }); emit(); paint(`o-${opts.length - 1}`); } }, icon('plus', { size: 14 }), 'Add option'),
      h('p.field-hint', 'Press Enter in an option to add another below it. The stored value shown on the right is used in views and triggers; it does not change when you rename an option.'));
    focusOn(el, focusKey);
  }
  paint();
  return { el };
}

function fieldEditor(root, id) {
  const isNew = id === 'new';
  const existing = (app.replica.cfg.fields || []).find((f) => f.id === id);
  if (!isNew && !existing) {
    root.append(emptyState({ glyph: 'text-cursor-input', title: 'This field no longer exists', action: h('a.btn', { href: '#/admin/fields' }, 'Back to ticket fields') }));
    return null;
  }
  const original = existing ? clone(existing) : { id: newId(), title: '', type: 'dropdown', desc: '', active: true, portal: false, required: false, options: [] };
  if (!original.options) original.options = [];
  const draft = clone(original);
  const value = () => {
    const out = { ...draft, title: draft.title.trim(), desc: (draft.desc || '').trim() };
    if (out.type === 'dropdown') out.options = draft.options.filter((o) => String(o.label || '').trim()).map((o) => ({ label: o.label.trim(), value: o.value || optionValue(o.label) }));
    else delete out.options;
    return out;
  };
  const frame = editorFrame(root, {
    backTo: '/admin/fields', backLabel: 'Ticket fields', title: isNew ? 'New ticket field' : original.title, isNew,
    getDraft: value,
    onSave: async () => {
      const v = value();
      const list = clone(app.replica.cfg.fields || []);
      const problem = validateField(v, list);
      if (problem) return problem;
      const i = list.findIndex((f) => f.id === v.id);
      if (i === -1) list.push(v);
      else list[i] = v;
      if (await saveKind('fields', list, isNew ? `Created "${v.title}".` : `Saved "${v.title}".`)) go('/admin/fields');
      return null;
    },
  });
  const title = textField('Title', draft.title, { onInput: (v) => { draft.title = v; }, placeholder: 'Plan', maxlength: 80, required: true });
  const desc = textField('Description', draft.desc, { onInput: (v) => { draft.desc = v; }, placeholder: 'Shown under the field (optional)', maxlength: 300 });

  const typeName = uid('type');
  const optionsWrap = h('div.ar-options-wrap');
  const typeCards = h('div.ar-types', { role: 'radiogroup', 'aria-label': 'Field type' },
    (isNew ? FIELD_TYPES : [original.type]).map((t) => {
      const [ic, label, hint] = FIELD_TYPE_INFO[t];
      const rid = uid('t');
      return h(`label.ar-type${isNew ? '' : '.fixed'}`, { for: rid },
        h(`input#${rid}`, { type: 'radio', name: typeName, value: t, checked: draft.type === t, onchange: () => { draft.type = t; paintOptions(); frame.refresh(); } }),
        h('span.ar-type-icon', icon(ic, { size: 18 })), h('span.ar-type-text', h('span.ar-type-label', label), h('span.ar-type-hint', hint)));
    }));
  function paintOptions() {
    clear(optionsWrap);
    if (draft.type !== 'dropdown') return;
    optionsWrap.append(editorSection('Options', null, optionsEditor(draft.options, (v) => { draft.options = v; frame.refresh(); }).el));
  }
  const portalId = uid('p');
  const reqId = uid('rq');
  frame.body.append(
    editorSection('Details', null, h('div.ar-grid-2', title.el, desc.el), activeRow(draft.active !== false, (on) => { draft.active = on; frame.refresh(); }, 'Active', 'Inactive fields are hidden from tickets; their values are kept.')),
    editorSection('Type', isNew ? null : 'The type cannot change after a field is created, so existing values stay valid.', typeCards),
    optionsWrap,
    editorSection('Behavior', null,
      h('label.ar-check', { for: portalId }, h(`input#${portalId}`, { type: 'checkbox', checked: !!draft.portal, onchange: (e) => { draft.portal = e.target.checked; frame.refresh(); } }),
        h('span', h('span.ar-check-label', 'Customers can see and fill it in the help center'), h('span.field-hint', 'Shown on the help center request form.'))),
      h('label.ar-check', { for: reqId }, h(`input#${reqId}`, { type: 'checkbox', checked: !!draft.required, onchange: (e) => { draft.required = e.target.checked; frame.refresh(); } }),
        h('span', h('span.ar-check-label', 'Required to solve'), h('span.field-hint', 'Agents must fill it in before submitting a ticket as Solved.')))),
  );
  paintOptions();
  frame.ready();
  if (isNew) title.input.focus();
  return null;
}

/* ---------------------------------------------------------------- SLA */

/** Extra hint under a target: days for long ones, or that it is off. */
function slaHint(minutes) {
  const text = formatMinutes(minutes);
  return /day|No target/.test(text) ? text : '';
}

function slaSection(root) {
  const stored = app.replica.cfg.sla || DEFAULT_SLA;
  let original = clone({ enabled: stored.enabled !== false, targets: stored.targets || DEFAULT_SLA.targets });
  let draft = clone(original);
  const METRICS = [['first', 'First reply', 'From the request to the first public reply'], ['next', 'Next reply', 'From a customer\'s reply to the agent\'s answer'], ['resolve', 'Resolution', 'From the request until it is solved']];
  const status = h('span.ar-dirty', { 'aria-live': 'polite' });
  const save = h('button.btn.btn-primary', { type: 'submit' }, 'Save');
  const reset = h('button.btn', { type: 'button', onclick: () => { draft = clone({ enabled: true, targets: DEFAULT_SLA.targets }); enabled.checked = true; paint(); refresh(); announce('Targets reset to the defaults. Save to keep them.'); } }, icon('rotate-ccw', { size: 14 }), 'Reset to defaults');
  const table = h('div.ar-sla-wrap');
  const enabledId = uid('sla');
  const enabled = switchInput({ id: enabledId, checked: draft.enabled, label: 'Track service level targets', onChange: (on) => { draft.enabled = on; table.classList.toggle('off', !on); refresh(); } });
  const form = h('form.ar-sla-form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      save.disabled = true;
      if (await saveKind('sla', draft, 'Service level targets saved.')) {
        original = clone(draft);
      }
      refresh();
    },
  },
  head('Service levels', 'Response and resolution targets per priority. Tickets show the time left on the next target, and turn red once it is missed.', reset, save),
  h('div.ar-toggle-row.card-like', h('div', h('label.field-label', { for: enabledId }, 'Track service level targets'), h('p.field-hint', 'When off, no targets are shown on tickets or in views.')), enabled),
  table,
  callout('timer',
    h('p', h('strong', 'Pausing. '), 'Reply targets pause while a ticket is Pending (waiting on the customer) or On hold (waiting on someone else), and start again when the ticket is reopened. The resolution target keeps counting until the ticket is solved.'),
    h('p.subtle', 'Targets count calendar time, around the clock. Leave a target empty to not track it.')),
  status);

  function refresh() {
    const dirty = !same(draft, original);
    save.disabled = !dirty;
    status.textContent = dirty ? 'Unsaved changes' : '';
  }

  function paint() {
    clear(table);
    table.classList.toggle('off', !draft.enabled);
    const grid = h('table.ar-sla-table');
    grid.append(h('caption.sr-only', 'Targets per priority, in hours and minutes'));
    grid.append(h('thead', h('tr', h('th', { scope: 'col' }, 'Priority'), METRICS.map(([, label, hint]) => h('th', { scope: 'col' }, h('span', label), h('span.ar-th-hint', hint))))));
    const body = h('tbody');
    for (const p of [...PRIORITIES].reverse()) {
      const row = h('tr', h('th', { scope: 'row' }, h(`span.pri.${p}`, PRIORITY_LABEL[p])));
      for (const [m, label] of METRICS) {
        const cur = splitMinutes(draft.targets[p]?.[m]);
        const hid = uid('h');
        const mid = uid('m');
        const set = () => {
          draft.targets[p] = { ...draft.targets[p], [m]: joinMinutes(hIn.value, mIn.value) };
          out.textContent = slaHint(draft.targets[p][m]);
          refresh();
        };
        const hIn = h(`input#${hid}.input.ar-num`, { type: 'number', min: 0, max: 8760, step: 1, inputmode: 'numeric', value: cur.h, placeholder: '0', oninput: set });
        const mIn = h(`input#${mid}.input.ar-num`, { type: 'number', min: 0, max: 59, step: 5, inputmode: 'numeric', value: cur.m, placeholder: '0', oninput: set });
        const out = h('span.ar-sla-out', slaHint(draft.targets[p]?.[m]));
        row.append(h('td', { 'data-label': label },
          h('div.ar-hm',
            h('label.sr-only', { for: hid }, `${PRIORITY_LABEL[p]} ${label} hours`), hIn, h('span.ar-unit', { 'aria-hidden': 'true' }, 'h'),
            h('label.sr-only', { for: mid }, `${PRIORITY_LABEL[p]} ${label} minutes`), mIn, h('span.ar-unit', { 'aria-hidden': 'true' }, 'm')),
          out));
      }
      body.append(row);
    }
    grid.append(body);
    table.append(grid);
  }
  root.append(form);
  paint();
  refresh();
  // Leaving with unsaved targets asks first, like the other editors.
  return guardUnsaved(() => form.isConnected && !same(draft, original));
}

/* ------------------------------------------------------------ routing */

const SECTIONS = {
  macros: { list: macrosList, editor: macroEditor },
  views: { list: viewsList, editor: viewEditor },
  triggers: { list: triggersList, editor: triggerEditor },
  fields: { list: fieldsList, editor: fieldEditor },
  sla: { list: slaSection, editor: null },
};

/**
 * Render one of the rule sections into `container`. Returns a cleanup
 * function. `route.path` is ['admin', section, id?].
 */
export function renderSection(container, { section, route } = {}) {
  const def = SECTIONS[section];
  const root = h(`div.ar.ar-${section}`);
  container.append(root);
  if (!def) return null;
  if (!app.isAdmin) {
    notAdmin(root);
    return null;
  }
  const sub = route?.path?.[2] || null;
  const cleanup = sub && def.editor ? def.editor(root, sub) : def.list(root);
  return () => {
    if (typeof cleanup === 'function') cleanup();
  };
}

export const RULE_SECTIONS = Object.keys(SECTIONS);

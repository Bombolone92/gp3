/**
 * The expanded record: every field of one record, with comments. Opens
 * from any view; previous and next follow the view's order.
 */
import { h, announce, modKey, fill } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { timeAgo, formatDate } from '../lib/format.js';
import { newId } from '../lib/ids.js';
import { TYPES, toText } from '../data/fields.js';
import { visibleFields, orderedFields } from '../data/views.js';
import { openDialog } from './dialog.js';
import { openMenu } from './menu.js';
import { toast } from './toast.js';
import { fieldInput } from './editors.js';
import { openFieldEditor, fieldMenuItems } from './fieldeditor.js';
import { avatar } from './app.js';
import { copyText, recordUrl } from './links.js';

export function openRecordDialog(page, table, recordId, { list, onNavigate, onClose }) {
  const base = page.base;
  let recId = recordId;
  let showHidden = false;
  const titleEl = h('h2.record-title');
  const pos = h('span.record-pos.muted');
  const prev = h('button.icon-btn', { type: 'button', 'aria-label': 'Previous record', 'data-tip': 'Previous record', 'data-kbd': `${modLabel()}Shift+,`, onclick: () => step(-1) }, icon('chevronUp', 18));
  const next = h('button.icon-btn', { type: 'button', 'aria-label': 'Next record', 'data-tip': 'Next record', 'data-kbd': `${modLabel()}Shift+.`, onclick: () => step(1) }, icon('chevronDown', 18));
  const more = h('button.icon-btn', { type: 'button', 'aria-label': 'Record actions', 'aria-haspopup': 'menu', 'data-tip': 'More' }, icon('more', 18));
  const close = h('button.icon-btn', { type: 'button', 'aria-label': 'Close record', 'data-tip': 'Close', 'data-kbd': 'Esc' }, icon('x', 18));
  const fieldsEl = h('div.record-fields');
  const commentsEl = h('div.record-comments');
  const body = h('div.record', h('div.record-head', h('div.record-nav', prev, next), pos, h('div.grow'), more, close), h('div.record-body', h('div.record-main', titleEl, fieldsEl), h('aside.record-side', { 'aria-label': 'Comments' }, commentsEl)));
  const dlg = openDialog({ body, className: 'xwide record-dialog', closeButton: false, label: 'Record', onClose: (o) => onClose?.(o) });
  dlg.el.querySelector('.dialog-head')?.remove();
  const record = () => base.table(table.id)?.record(recId);
  const view = page.view;
  // Where the record was in the view: an edit can filter it out, and
  // stepping then goes on from there.
  let lastIndex = -1;

  /** The index to step to, or -1. */
  function target(ids, d) {
    const i = ids.indexOf(recId);
    // Out of the view: the next record is the one that took its place.
    const j = i >= 0 ? i + d : lastIndex >= 0 ? lastIndex + (d > 0 ? 0 : -1) : -1;
    return j >= 0 && j < ids.length ? j : -1;
  }

  function step(d) {
    const ids = list();
    const j = target(ids, d);
    if (j < 0) return;
    show(ids[j]);
    announce(`Record ${j + 1} of ${ids.length}`);
  }

  /** Shows another record, keeping focus on the same field. */
  function show(id) {
    const active = document.activeElement;
    const focusedField = fieldsEl.contains(active) ? active.closest('[data-field]')?.dataset.field : null;
    const controls = (field) => [...(fieldsEl.querySelector(`[data-field="${field}"]`)?.querySelectorAll('input, textarea, [tabindex="0"], button') || [])];
    // The same control of the field (its input, not its label's info icon).
    const at = focusedField ? controls(focusedField).indexOf(active) : -1;
    // Leaving the field saves what was typed to the record it belongs to,
    // and the field is then drawn afresh for the next one.
    if (focusedField) active.blur();
    recId = id;
    render();
    onNavigate?.(id);
    if (focusedField) (controls(focusedField)[at] || fieldsEl.querySelector(`[data-field="${focusedField}"] .record-input :is(input, textarea, [tabindex="0"], button)`))?.focus();
  }

  function render() {
    const rec = record();
    if (!rec) {
      dlg.close();
      return;
    }
    const ids = list();
    const i = ids.indexOf(recId);
    if (i >= 0) lastIndex = i;
    pos.textContent = i >= 0 ? `${i + 1} of ${ids.length}` : '';
    prev.disabled = target(ids, -1) < 0;
    next.disabled = target(ids, 1) < 0;
    titleEl.textContent = base.recordName(table.id, recId);
    dlg.el.setAttribute('aria-label', `Record: ${titleEl.textContent}`);
    renderFields(rec);
    renderComments(rec);
  }

  function renderFields(rec) {
    // The field being typed in, or whose picker is open (focus returns to
    // it when the picker closes), is kept.
    const focusedField = document.activeElement?.closest?.('[data-field]')?.dataset.field || fieldsEl.querySelector('[aria-expanded="true"]')?.closest('[data-field]')?.dataset.field;
    const shown = view ? visibleFields(table, view) : table.fields;
    const shownIds = new Set(shown.map((f) => f.id));
    const hidden = (view ? orderedFields(table, view) : []).filter((f) => !shownIds.has(f.id));
    const fieldRow = (f) => {
      const id = `rf-${f.id}`;
      const label = h('label.record-label', { for: id }, icon(TYPES[f.type].icon, 14), h('span', f.name), f.description ? h('span.info-dot', { 'data-tip': f.description, tabindex: '0', 'aria-label': `About ${f.name}: ${f.description}` }, icon('info', 12)) : null);
      label.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openMenu({ x: e.clientX, y: e.clientY }, fieldMenuItems(page, table, f, { onEdit: () => openFieldEditor(label, page, table, { field: f }), view }));
      });
      const input = fieldInput(page, table, f, rec, {
        id,
        onChange: (v) => {
          const before = record()?.c[f.id];
          if (JSON.stringify(before ?? null) === JSON.stringify(v ?? null)) return;
          base.setCell(table.id, recId, f.id, v);
        },
      });
      return h('div.record-field', { dataset: { field: f.id } }, label, h('div.record-input', input));
    };
    // Re-render everything but the input someone is typing in.
    if (focusedField && fieldsEl.querySelector(`[data-field="${focusedField}"]`)) {
      for (const el of fieldsEl.querySelectorAll('.record-field')) {
        if (el.dataset.field === focusedField) continue;
        const f = table.field(el.dataset.field);
        if (f) el.replaceWith(fieldRow(f));
      }
      return;
    }
    fill(fieldsEl,
      ...shown.map(fieldRow),
      hidden.length
        ? h('button.link-btn.muted.hidden-toggle', { type: 'button', 'aria-expanded': String(showHidden), onclick: () => {
          showHidden = !showHidden;
          renderFields(record());
        } }, icon(showHidden ? 'chevronDown' : 'chevronRight', 14), `${hidden.length} field${hidden.length === 1 ? '' : 's'} hidden in this view`)
        : null,
      ...(showHidden ? hidden.map(fieldRow) : []),
      h('button.link-btn.add-field-btn', { type: 'button', onclick: (e) => openFieldEditor(e.currentTarget, page, table, {}) }, icon('plus', 14), 'Add a field to this table'),
    );
  }

  // The comment box is built once: changes elsewhere in the base re-render
  // the activity and comments, never a comment being written.
  const commentInput = h('textarea.textarea.comment-input', { rows: 2, placeholder: 'Leave a comment', 'aria-label': 'New comment' });
  const send = () => {
    const text = commentInput.value.trim();
    if (!text) return;
    const cm = [...(record()?.cm || []), { id: newId('cmt'), by: page.store.user || 'You', at: Date.now(), text }];
    base.apply({ t: 'rec.meta', table: table.id, id: recId, patch: { cm } }, { undoable: false });
    commentInput.value = '';
    announce('Comment added');
  };
  commentInput.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && (modKey(e) || !e.shiftKey)) {
      e.preventDefault();
      send();
    }
  });
  const activityEl = h('div.record-feed');
  commentsEl.append(activityEl, h('div.comment-compose', commentInput, h('button.btn.small.primary', { type: 'button', onclick: send }, 'Comment')));
  let draftFor = recId;

  function renderComments(rec) {
    const comments = rec.cm || [];
    // A draft belongs to its record.
    if (draftFor !== recId) {
      commentInput.value = '';
      draftFor = recId;
    }
    const creator = rec.cb ? ` by ${rec.cb}` : '';
    const activity = h('div.record-activity',
      h('p', icon('fCreatedTime', 14), h('span', `Created ${timeAgo(rec.ct)}${creator}`), h('span.muted', formatDate(new Date(rec.ct).toISOString(), { includeTime: true }))),
      rec.mt && rec.mt !== rec.ct ? h('p', icon('fModifiedTime', 14), h('span', `Last changed ${timeAgo(rec.mt)}${rec.mb ? ` by ${rec.mb}` : ''}`)) : null);
    const history = (rec.h || []).slice().reverse().map((e) => {
      const f = table.field(e.f);
      if (!f) return null;
      const what = e.to && e.from ? [' changed ', h('strong', f.name), ` from \u201c${e.from}\u201d to \u201c${e.to}\u201d`] : e.to ? [' set ', h('strong', f.name), ` to \u201c${e.to}\u201d`] : [' cleared ', h('strong', f.name)];
      return h('li.history-item', h('span', h('strong', e.by || 'Someone'), ...what), h('span.muted', timeAgo(e.t)));
    }).filter(Boolean);
    fill(activityEl,
      h('h3.side-title', 'Activity'),
      activity,
      history.length ? h('ul.history-list', { 'aria-label': 'Changes' }, history) : null,
      h('h3.side-title', 'Comments'),
      comments.length
        ? h('ul.comment-list', comments.map((c) => h('li.comment',
          avatar(c.by, c.by === page.store.user ? page.app.picture : null, 'small'),
          h('div.comment-body', h('div.comment-meta', h('strong', c.by), h('span.muted', timeAgo(c.at))), h('p.comment-text', c.text)),
          c.by === (page.store.user || 'You') ? h('button.icon-btn', { type: 'button', 'aria-label': 'Delete comment', onclick: () => {
            base.apply({ t: 'rec.meta', table: table.id, id: recId, patch: { cm: (record()?.cm || []).filter((x) => x.id !== c.id) } }, { undoable: false });
          } }, icon('trash', 14)) : null)))
        : h('p.muted.no-comments', 'No comments yet.'),
    );
  }

  more.addEventListener('click', () => {
    openMenu(more, [
      { label: 'Copy record link', icon: 'link', onSelect: () => copyText(recordUrl(page, recId), 'Link copied') },
      { label: 'Duplicate record', icon: 'copy', onSelect: () => {
        const [id] = base.duplicateRecords(table.id, [recId]);
        if (id) show(id);
      } },
      { label: 'Print record', icon: 'printer', onSelect: () => printRecord(page, table, record()) },
      { type: 'sep' },
      { label: 'Delete record', icon: 'trash', danger: true, onSelect: () => {
        const id = recId;
        const ids = list();
        const i = ids.indexOf(id);
        base.deleteRecords(table.id, [id]);
        page.toastUndo('Record deleted');
        const nextId = ids[i + 1] || ids[i - 1];
        if (nextId && base.table(table.id).record(nextId)) show(nextId);
        else dlg.close();
      } },
    ], { label: 'Record actions' });
  });
  close.addEventListener('click', () => dlg.close());
  dlg.el.addEventListener('keydown', (e) => {
    // Keys in a picker open over the record belong to the picker.
    if (e.target.closest?.('.popover')) return;
    if (modKey(e) && e.shiftKey && (e.key === ',' || e.key === '<')) {
      e.preventDefault();
      step(-1);
    } else if (modKey(e) && e.shiftKey && (e.key === '.' || e.key === '>')) {
      e.preventDefault();
      step(1);
    }
  });
  render();
  requestAnimationFrame(() => {
    const first = fieldsEl.querySelector('input, textarea, [tabindex="0"], button');
    (first || close).focus();
  });
  return {
    get recordId() {
      return recId;
    },
    update: render,
    close: (o) => dlg.close(o),
  };
}

function printRecord(page, table, rec) {
  if (!rec) return;
  const base = page.base;
  const rows = table.fields.map((f) => [f.name, toText(f, base.compute.value(table, rec, f), base.compute.ctx)]);
  const win = window.open('', '_blank');
  if (!win) return;
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(base.recordName(table.id, rec.id))}</title><style>body{font:13px system-ui,sans-serif;margin:32px}h1{font-size:20px}dt{font-weight:600;margin-top:12px;color:#444}dd{margin:2px 0 0;white-space:pre-wrap}</style></head><body><h1>${esc(base.recordName(table.id, rec.id))}</h1><dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v) || '<span style="color:#888">Empty</span>'}</dd>`).join('')}</dl></body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 200);
}

function modLabel() {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '') ? '⌘' : 'Ctrl+';
}

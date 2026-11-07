/**
 * Inspection form builder: name, who it applies to, schedule, and the
 * ordered list of items. Items can be reordered by dragging the handle or
 * with the move buttons (keyboard).
 */
import { h, uniqueId } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { formPage, multiPicker } from '../ui/form.js';
import { app } from '../app.js';
import { navigate, back } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { openMenu } from '../ui/menu.js';
import { newId } from '../core/ids.js';
import { INTERVAL_UNITS } from '../core/dates.js';
import { parseDecimal } from '../core/money.js';
import { ITEM_TYPES, itemTypeMeta } from '../core/inspections.js';
import { options, emptyPage } from './common.js';

export function render(ctx) {
  const store = app.store;
  const existing = ctx.params.id ? store.get('inspectionForms', ctx.params.id) : null;
  if (ctx.params.id && !existing) return emptyPage('Form not found', 'It may have been deleted.');
  let items = structuredClone(existing?.items || [{ id: newId(), type: 'meter', label: 'Odometer reading', required: true, help: '' }]);
  const list = h('ol.builder-list');
  let dragFrom = null;

  function draw(focusId) {
    list.replaceChildren(...items.map((it, i) => itemRow(it, i)));
    if (focusId) list.querySelector(`[data-id="${focusId}"] input`)?.focus();
  }

  function itemRow(it, i) {
    const meta = itemTypeMeta(it.type);
    const labelId = uniqueId('lbl');
    const label = h('input.input.sm', { id: labelId, type: 'text', value: it.label, placeholder: it.type === 'section' ? 'Section name' : 'What to check', 'aria-label': `Item ${i + 1} label` });
    label.addEventListener('input', () => (it.label = label.value));
    const help = h('input.input.sm', { type: 'text', value: it.help || '', placeholder: 'Instructions (optional)', 'aria-label': `Item ${i + 1} instructions` });
    help.addEventListener('input', () => (it.help = help.value));
    const req = h('input', { type: 'checkbox', checked: Boolean(it.required) });
    req.addEventListener('change', () => (it.required = req.checked));
    let extra = null;
    if (it.type === 'choice') {
      const opts = h('input.input.sm', { type: 'text', value: (it.options || []).join(', '), placeholder: 'Options, separated by commas', 'aria-label': `Item ${i + 1} options` });
      const pass = h('div.pass-opts');
      const drawPass = () => {
        pass.replaceChildren(
          h('span.subtle.small', 'Passing answers:'),
          ...(it.options || []).map((o) => {
            const cb = h('input', { type: 'checkbox', checked: (it.passOptions || []).includes(o) });
            cb.addEventListener('change', () => (it.passOptions = cb.checked ? [...new Set([...(it.passOptions || []), o])] : (it.passOptions || []).filter((x) => x !== o)));
            return h('label.check.small', cb, o);
          }),
        );
      };
      const readOpts = () => {
        it.options = opts.value.split(',').map((s) => s.trim()).filter(Boolean);
        it.passOptions = (it.passOptions || []).filter((o) => it.options.includes(o));
      };
      // Saved as typed, so Ctrl+S in the field keeps the latest options.
      opts.addEventListener('input', readOpts);
      opts.addEventListener('change', () => (readOpts(), drawPass()));
      drawPass();
      extra = h('div.builder-extra', opts, pass);
    } else if (it.type === 'number') {
      const min = h('input.input.sm.num', { type: 'text', inputmode: 'decimal', value: it.min ?? '', placeholder: 'Min', 'aria-label': 'Minimum passing value' });
      const max = h('input.input.sm.num', { type: 'text', inputmode: 'decimal', value: it.max ?? '', placeholder: 'Max', 'aria-label': 'Maximum passing value' });
      const unit = h('input.input.sm', { type: 'text', value: it.unit || '', placeholder: 'Unit, e.g. psi', 'aria-label': 'Unit' });
      min.addEventListener('input', () => (it.min = parseDecimal(min.value)));
      max.addEventListener('input', () => (it.max = parseDecimal(max.value)));
      unit.addEventListener('input', () => (it.unit = unit.value));
      extra = h('div.builder-extra.row', h('span.subtle.small', 'Passes between'), min, h('span.subtle.small', 'and'), max, unit);
    }
    const move = (d) => {
      const j = i + d;
      if (j < 0 || j >= items.length) return;
      [items[i], items[j]] = [items[j], items[i]];
      draw();
      list.querySelector(`[data-id="${it.id}"] .move-${d < 0 ? 'up' : 'down'}`)?.focus();
    };
    // Focus moves to the item that takes this one's place, so keyboard
    // users are not dropped back at the top of the page.
    const remove = () => {
      items.splice(i, 1);
      draw();
      const next = items[i] || items[i - 1];
      (next ? list.querySelector(`[data-id="${next.id}"] .remove-item`) : addBtn).focus();
    };
    const row = h(
      `li.builder-item${it.type === 'section' ? '.is-section' : ''}`,
      { dataset: { id: it.id }, draggable: 'false' },
      h('span.drag-handle', { title: 'Drag to reorder', 'aria-hidden': 'true' }, icon('grip', 16)),
      h('span.builder-type', { title: meta.label }, icon(meta.icon, 16), h('span.small', meta.label)),
      h('div.builder-main', label, it.type === 'section' ? null : help, extra),
      it.type === 'section' ? h('span') : h('label.check.small.builder-req', req, 'Required'),
      h(
        'div.builder-btns',
        h('button.icon-btn.sm.move-up', { type: 'button', 'aria-label': `Move item ${i + 1} up`, disabled: i === 0 || null, onClick: () => move(-1) }, icon('chevron-up', 15)),
        h('button.icon-btn.sm.move-down', { type: 'button', 'aria-label': `Move item ${i + 1} down`, disabled: i === items.length - 1 || null, onClick: () => move(1) }, icon('chevron-down', 15)),
        h('button.icon-btn.sm.remove-item', { type: 'button', 'aria-label': `Remove item ${i + 1}`, onClick: remove }, icon('trash', 15)),
      ),
    );
    const handle = row.querySelector('.drag-handle');
    handle.addEventListener('pointerdown', () => (row.draggable = true));
    // A click on the handle without a drag must not leave the row draggable,
    // or selecting text in its fields would drag the whole row.
    handle.addEventListener('pointerup', () => (row.draggable = false));
    row.addEventListener('dragstart', (e) => {
      dragFrom = i;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', it.id);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      // Also runs when the drag is cancelled or dropped elsewhere.
      dragFrom = null;
      row.draggable = false;
      row.classList.remove('dragging');
      for (const r of list.querySelectorAll('.drop-before, .drop-after')) r.classList.remove('drop-before', 'drop-after');
    });
    // The lower half of the last row drops after it, so an item can be
    // dragged to the end of the list.
    const dropAfter = (e) => {
      if (i !== items.length - 1) return false;
      const r = row.getBoundingClientRect();
      return e.clientY > r.top + r.height / 2;
    };
    row.addEventListener('dragover', (e) => {
      if (dragFrom === null) return;
      e.preventDefault();
      const after = dropAfter(e);
      row.classList.toggle('drop-before', !after);
      row.classList.toggle('drop-after', after);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drop-before', 'drop-after');
      const to = dropAfter(e) ? i + 1 : i;
      if (dragFrom === null || dragFrom === to || dragFrom === to - 1) return;
      const [m] = items.splice(dragFrom, 1);
      items.splice(dragFrom < to ? to - 1 : to, 0, m);
      dragFrom = null;
      draw();
    });
    return row;
  }

  const addBtn = h('button.btn.sm', { type: 'button', onClick: (e) => openMenu(e.currentTarget, ITEM_TYPES.map((t) => ({ label: t.label, icon: t.icon, run: () => addItem(t.id) })), { label: 'Item type' }) }, icon('plus', 15), 'Add item', icon('chevron-down', 14));
  function addItem(type) {
    const it = { id: newId(), type, label: '', help: '', required: type !== 'section' && type !== 'photo' && type !== 'text' };
    if (type === 'choice') Object.assign(it, { options: ['Good', 'Fair', 'Poor'], passOptions: ['Good', 'Fair'] });
    items.push(it);
    draw(it.id);
  }
  draw();
  const builder = h('div.builder', list, h('div.builder-add', addBtn));
  Object.defineProperty(builder, 'value', { get: () => JSON.stringify(items) });
  const vehicles = multiPicker({ items: options.vehicles({ keep: existing?.vehicleIds }), value: existing?.vehicleIds || [], label: 'Vehicles', placeholder: 'Add vehicle' });

  const page = formPage({
    title: existing ? existing.name : 'New inspection form',
    crumbs: [{ label: 'Inspection forms', href: '#/inspection-forms' }, { label: existing ? 'Edit' : 'New' }],
    record: existing ? { ...existing, scheduled: Boolean(existing.schedule?.every), every: existing.schedule?.every || 1, unit: existing.schedule?.unit || 'days' } : { scheduled: false, every: 1, unit: 'days' },
    saveLabel: existing ? 'Save form' : 'Create form',
    sections: [
      { id: 'about', title: 'Form', fields: [{ id: 'name', label: 'Name', required: true, span: 2, placeholder: 'e.g. Pre-trip inspection' }, { id: 'description', label: 'Description', type: 'textarea', rows: 2, span: 2 }] },
      { id: 'items', title: 'Items', intro: 'Pass or fail items and multiple choice answers that do not pass open an issue when the inspection is submitted.', fields: [{ id: 'items', label: 'Items', type: 'custom', noLabel: true, span: 2, render: () => builder }] },
      {
        id: 'where',
        title: 'Vehicles and schedule',
        fields: [
          { id: 'veh', label: 'Applies to', type: 'custom', span: 2, render: () => vehicles, hint: 'Leave empty to use this form on every vehicle.' },
          { id: 'scheduled', label: 'Schedule', type: 'switch', checkLabel: 'Inspect on a schedule', span: 2 },
          { id: 'every', label: 'Every', type: 'number', min: 1, show: (v) => v.scheduled },
          { id: 'unit', label: 'Unit', type: 'select', required: true, options: () => INTERVAL_UNITS.map((u) => ({ value: u.id, label: u.label })), show: (v) => v.scheduled },
        ],
      },
    ],
    onCancel: () => back('/inspection-forms'),
    onSave: (v) => {
      // Build on the stored record, not the one the form opened with: files
      // and other changes may have arrived meanwhile.
      const cur = existing && store.get('inspectionForms', existing.id);
      if (existing && !cur) {
        toast('This form was deleted, so the changes were not saved.', { type: 'error' });
        return false;
      }
      const clean = items.filter((it) => it.label.trim());
      if (!clean.some((it) => it.type !== 'section')) {
        toast('Add at least one item with a label.', { type: 'error' });
        return false;
      }
      // A choice item without options can never be answered, so a required
      // one would block every inspection on this form.
      const noOptions = clean.find((it) => it.type === 'choice' && !it.options?.length);
      if (noOptions) {
        toast(`Add at least one option to "${noOptions.label.trim()}".`, { type: 'error' });
        list.querySelector(`[data-id="${noOptions.id}"] .builder-extra input`)?.focus();
        return false;
      }
      // A range that is not a number, or with nothing between min and max,
      // would fail the item on every inspection.
      const badRange = clean.find((it) => it.type === 'number' && (Number.isNaN(it.min) || Number.isNaN(it.max) || (it.min != null && it.max != null && it.min > it.max)));
      if (badRange) {
        toast(Number.isNaN(badRange.min) || Number.isNaN(badRange.max) ? `Enter numbers for the passing range of "${badRange.label.trim()}".` : `The minimum of "${badRange.label.trim()}" is more than its maximum.`, { type: 'error' });
        list.querySelector(`[data-id="${badRange.id}"] .builder-extra input`)?.focus();
        return false;
      }
      const f = store.put('inspectionForms', { ...(cur || { archived: false, color: 'blue' }), name: v.name, description: v.description, items: clean, vehicleIds: vehicles.value, schedule: v.scheduled && v.every ? { every: v.every, unit: v.unit } : null });
      page.form.markClean();
      toast(existing ? 'Form saved' : 'Form created');
      navigate('/inspection-forms', { replace: !existing });
      return f;
    },
  });
  return { node: page.node, title: existing ? existing.name : 'New form', dirty: () => page.form.dirty() };
}

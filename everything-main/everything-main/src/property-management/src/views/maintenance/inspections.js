/** Inspections: scheduled and completed unit inspections. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, chips, dataTable, emptyState, statusPill, field, textInput, select } from '../../ui/components.js';
import { formDialog } from '../../ui/dialog.js';
import { navigate, setQuery } from '../../ui/router.js';
import { toast } from '../../ui/toast.js';
import { date, propertyUnitFields, memberSelect } from '../common.js';
import { STANDARD_AREAS, INSPECTION_TYPES, inspectionTypeLabel, filterSelect, propertyOptions } from './shared.js';

/** Open the "New inspection" dialog; resolves to the created record or null. */
export async function newInspectionDialog({ propertyId = '', unitId = '', type = 'routine' } = {}) {
  const place = propertyUnitFields({ propertyId, unitId, required: true, unitEmpty: 'Common areas' });
  const kind = select({ name: 'type', value: type, options: INSPECTION_TYPES });
  const day = textInput({ type: 'date', name: 'date', value: app.today() });
  const inspector = memberSelect({ name: 'inspectorId', value: app.store.all('team')[0]?.id || '' });
  const areaList = h('div.area-picks');
  const areas = [...STANDARD_AREAS];
  const drawAreas = () =>
    areaList.replaceChildren(
      ...areas.map((a, i) =>
        h('span.tag', a, h('button', { type: 'button', 'aria-label': `Remove ${a}`, onClick: () => (areas.splice(i, 1), drawAreas()) }, icon('x', 12))),
      ),
    );
  drawAreas();
  const newArea = textInput({ placeholder: 'Add an area, e.g. Garage', 'aria-label': 'New area' });
  const addArea = () => {
    const v = newArea.value.trim();
    if (v && !areas.some((a) => a.toLowerCase() === v.toLowerCase())) areas.push(v);
    newArea.value = '';
    drawAreas();
    newArea.focus();
  };
  newArea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addArea();
    }
  });
  let created = null;
  await formDialog({
    title: 'New inspection',
    submitLabel: 'Create inspection',
    body: h(
      'div.stack',
      h('div.form-grid', place.node, field('Type', kind), field('Date', day), field('Inspector', inspector)),
      h('div.field', h('span.field-label', 'Areas to inspect'), areaList, h('div.row', newArea, h('button.btn.sm', { type: 'button', onClick: addArea }, 'Add'))),
    ),
    onSubmit: () => {
      if (!place.propertyId) {
        place.property.focus();
        return false;
      }
      const unit = place.unitId ? lookup.unit(place.unitId) : null;
      created = app.store.put('inspections', {
        propertyId: unit?.propertyId || place.propertyId,
        unitId: unit?.id || null,
        type: kind.value,
        date: day.value || app.today(),
        inspectorId: inspector.value || null,
        status: 'scheduled',
        areas: areas.map((name) => ({ name, condition: null, notes: '' })),
      });
      toast('Inspection created');
    },
  });
  if (created) navigate(`/inspections/${created.id}`);
  return created;
}

export function inspectionPlace(i) {
  return i.unitId ? lookup.unitLabel(i.unitId) : `${lookup.property(i.propertyId)?.name || 'Property'} · common areas`;
}

export function render(ctx) {
  const store = app.store;
  const state = { filter: ctx.query.status || 'all', property: ctx.query.property || '' };
  const body = ctx.live(() => {
    const all = store.all('inspections');
    if (!all.length) {
      return h('section.card', emptyState({ icon: 'clipboard-check', title: 'No inspections yet', text: 'Record move-in, move-out and routine inspections area by area, with photos.', headingLevel: 2, actions: [h('button.btn.primary', { type: 'button', onClick: () => newInspectionDialog() }, icon('plus', 16), 'New inspection')] }));
    }
    const base = all.filter((i) => !state.property || i.propertyId === state.property);
    const filters = [
      { id: 'all', label: 'All', match: () => true },
      { id: 'scheduled', label: 'Scheduled', match: (i) => i.status !== 'completed' },
      { id: 'completed', label: 'Completed', match: (i) => i.status === 'completed' },
    ];
    const f = filters.find((x) => x.id === state.filter) || filters[0];
    const rows = base.filter(f.match);
    return h(
      'section.card.list-card',
      { 'aria-label': 'Inspections' },
      h(
        'div.toolbar',
        chips({ label: 'Status', selected: f.id, onSelect: (id) => ((state.filter = id), setQuery({ status: id === 'all' ? '' : id }), body.redraw()), items: filters.map((x) => ({ id: x.id, label: x.label, count: base.filter(x.match).length })) }),
        h('div.grow'),
        filterSelect({ label: 'Property', value: state.property, options: propertyOptions(), onChange: (v) => ((state.property = v), setQuery({ property: v }), body.redraw()) }),
      ),
      dataTable({
        caption: 'Inspections',
        rows,
        sort: { id: 'date', dir: 'desc' },
        rowHref: (i) => `#/inspections/${i.id}`,
        columns: [
          { id: 'date', label: 'Date', sort: (i) => i.date, render: (i) => h('span.nowrap', date(i.date)) },
          { id: 'unit', label: 'Unit', cls: 'primary-cell', render: (i) => inspectionPlace(i) },
          { id: 'type', label: 'Type', render: (i) => inspectionTypeLabel(i.type) },
          { id: 'inspector', label: 'Inspector', render: (i) => lookup.member(i.inspectorId)?.name || h('span.subtle', 'None') },
          { id: 'issues', label: 'Issues', align: 'r', render: (i) => issuesCell(i) },
          { id: 'status', label: 'Status', render: (i) => statusPill(i.status === 'completed' ? 'completed' : 'scheduled') },
        ],
        mobile: (i) => h('a.mobile-row', { href: `#/inspections/${i.id}` }, h('div.grow', { style: { minWidth: '0' } }, h('div.m-title', inspectionPlace(i)), h('div.m-sub', `${inspectionTypeLabel(i.type)} · ${date(i.date)}`)), h('div.m-end', statusPill(i.status === 'completed' ? 'completed' : 'scheduled'))),
        empty: emptyState({ compact: true, icon: 'search', title: 'No matching inspections', headingLevel: 3 }),
      }),
    );
  }, ['inspections', 'units', 'team']);
  return {
    node: h('div.page', pageHeader({ title: 'Inspections', actions: [h('button.btn.primary', { type: 'button', onClick: () => newInspectionDialog() }, icon('plus', 16), 'New inspection')] }), body),
    title: 'Inspections',
  };
}

function issuesCell(i) {
  const n = (i.areas || []).filter((a) => a.condition === 'poor' || a.condition === 'damaged').length;
  return n ? h('span.overdue', String(n)) : h('span.subtle', i.status === 'completed' ? '0' : 'None yet');
}

/** One inspection: condition and notes per area, comparison with the last one. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, statusPill, emptyState, moreButton, card, segmented, textarea, textInput, select, field } from '../../ui/components.js';
import { openMenu } from '../../ui/menu.js';
import { confirmDialog, formDialog } from '../../ui/dialog.js';
import { navigate } from '../../ui/router.js';
import { toast } from '../../ui/toast.js';
import { date, kvList, notesCard, deleteWithUndo, memberSelect } from '../common.js';
import { attachmentsCard } from '../attachments.js';
import { CONDITIONS, compareInspections, inspectionTypeLabel, INSPECTION_TYPES, printNode, printHeader } from './shared.js';
import { inspectionPlace } from './inspections.js';

const CONDITION_LABEL = Object.fromEntries(CONDITIONS.map((c) => [c.value, c.label]));

// On one day, an outgoing tenant's move-out comes before the next tenant's move-in.
const TYPE_ORDER = { 'move-out': 0, routine: 1, 'move-in': 2 };
const order = (i) => [i.date || '', TYPE_ORDER[i.type] ?? 1, i.createdAt || '', i.id];
const before = (a, b) => {
  const x = order(a);
  const y = order(b);
  for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] < y[k];
  return false;
};

/** The most recent completed inspection of the same place before this one. */
export function previousInspection(all, current) {
  let best = null;
  for (const i of all) {
    if (i.id === current.id || i.status !== 'completed' || i.propertyId !== current.propertyId || (i.unitId || null) !== (current.unitId || null)) continue;
    // Strictly earlier: two inspections on one day must not each be the other's previous.
    if (before(i, current) && (!best || before(best, i))) best = i;
  }
  return best;
}

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  let refocus = null; // data-fk of the control to focus after a redraw

  const save = (fn, fk) => {
    refocus = fk || document.activeElement?.closest('[data-fk]')?.dataset.fk || null;
    store.patch('inspections', id, (x) => (fn(x), x));
  };

  const body = ctx.live(() => {
    const ins = store.get('inspections', id);
    if (!ins) return emptyState({ icon: 'clipboard-check', title: 'Inspection not found', headingLevel: 1, text: 'It may have been deleted.', actions: [h('a.btn.primary', { href: '#/inspections' }, 'Back to inspections')] });
    const done = ins.status === 'completed';
    const prev = previousInspection(store.all('inspections'), ins);
    const changes = prev ? compareInspections(prev, ins) : [];
    const rated = (ins.areas || []).filter((a) => a.condition).length;
    const total = (ins.areas || []).length;

    const complete = async () => {
      if (rated < total) {
        const ok = await confirmDialog({ title: 'Complete with unrated areas?', message: `${total - rated} of ${total} areas have no condition yet.`, confirmLabel: 'Complete anyway' });
        if (!ok) return;
      }
      save((x) => ((x.status = 'completed'), (x.completedOn = app.today())));
      toast('Inspection completed');
    };

    const areaRow = (a, i) => {
      const notes = textarea({ value: a.notes || '', rows: 2, placeholder: 'Notes', 'aria-label': `${a.name} notes` });
      notes.dataset.fk = `notes-${i}`;
      notes.addEventListener('change', () => save((x) => (x.areas[i].notes = notes.value), `notes-${i}`));
      const seg = segmented({
        label: `${a.name} condition`,
        value: a.condition || '',
        items: CONDITIONS.map((c) => ({ value: c.value, label: c.label })),
        onChange: (v) => save((x) => (x.areas[i].condition = v), `cond-${i}`),
      });
      seg.dataset.fk = `cond-${i}`;
      seg.classList.add('condition-seg');
      const change = changes.find((c) => c.name === a.name);
      const bad = a.condition === 'poor' || a.condition === 'damaged';
      return h(
        `li.area${a.condition ? `.cond-${a.condition}` : ''}`,
        h(
          'div.area-head',
          h('h3.area-name', a.name),
          change && change.change === 'worse' ? h('span.change.worse', icon('trending-down', 13), `Was ${CONDITION_LABEL[change.before].toLowerCase()}`) : null,
          change && change.change === 'better' ? h('span.change.better', icon('trending-up', 13), `Was ${CONDITION_LABEL[change.before].toLowerCase()}`) : null,
          h('div.grow'),
          bad ? h('a.btn.sm.ghost', { href: `#/work-orders/new?${new URLSearchParams({ ...(ins.unitId ? { unitId: ins.unitId } : { propertyId: ins.propertyId }), title: `${a.name}: repair after ${inspectionTypeLabel(ins.type).toLowerCase()} inspection` })}` }, icon('wrench', 14), 'Work order') : null,
          h('button.icon-btn.sm', { type: 'button', 'aria-label': `Remove ${a.name}`, onClick: () => removeArea(i) }, icon('trash', 15)),
        ),
        seg,
        notes,
      );
    };

    const removeArea = (i) => {
      const area = ins.areas[i];
      save((x) => x.areas.splice(i, 1), null);
      toast(`${area.name} removed`, { action: { label: 'Undo', run: () => store.patch('inspections', id, (x) => (x.areas.splice(i, 0, area), x)) } });
    };
    const newArea = textInput({ placeholder: 'Add an area, e.g. Garage', 'aria-label': 'New area' });
    newArea.dataset.fk = 'new-area';
    const addArea = () => {
      const v = newArea.value.trim();
      if (!v) return;
      save((x) => (x.areas = [...(x.areas || []), { name: v, condition: null, notes: '' }]), 'new-area');
    };
    newArea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addArea();
      }
    });

    const more = moreButton((btn) =>
      openMenu(btn, [
        { label: 'Edit details', icon: 'pencil', run: () => editDetails(ins) },
        { label: 'Print', icon: 'printer', run: () => printInspection(ins, prev) },
        done ? { label: 'Reopen', icon: 'undo', run: () => save((x) => ((x.status = 'scheduled'), (x.completedOn = null))) } : null,
        { separator: true },
        { label: 'Delete', icon: 'trash', danger: true, run: () => deleteWithUndo('inspections', ins, { title: 'Delete this inspection?', label: 'Inspection deleted', after: () => navigate('/inspections') }) },
      ]),
    );

    const main = h(
      'div.detail-main',
      h(
        'section.card',
        h('div.card-head', h('h2.grow', 'Areas', h('span.count', ` ${rated} of ${total} rated`))),
        h('div.card-body', total ? h('ul.areas', ins.areas.map(areaRow)) : h('p.subtle', 'No areas yet. Add the first one below.'), h('div.row.add-area', newArea, h('button.btn.sm', { type: 'button', onClick: addArea }, icon('plus', 14), 'Add area'))),
      ),
      notesCard('inspections', ins),
      attachmentsCard('inspections', ins, { title: 'Photos', folder: 'files/inspections' }),
    );
    const worse = changes.filter((c) => c.change === 'worse');
    const aside = h(
      'div.detail-aside',
      card({
        title: 'Details',
        body: kvList([
          ['Place', ins.unitId ? h('a', { href: `#/units/${ins.unitId}` }, inspectionPlace(ins)) : inspectionPlace(ins)],
          ['Type', inspectionTypeLabel(ins.type)],
          ['Date', date(ins.date)],
          ['Inspector', lookup.member(ins.inspectorId)?.name || 'None'],
          ['Completed', ins.completedOn ? date(ins.completedOn) : null],
        ]),
      }),
      card({
        title: 'Compared with last time',
        body: prev
          ? h(
              'div.stack',
              h('p.subtle', h('a', { href: `#/inspections/${prev.id}` }, `${inspectionTypeLabel(prev.type)} inspection, ${date(prev.date)}`)),
              worse.length ? h('ul.change-list', worse.map((c) => h('li', h('strong', c.name), ` ${CONDITION_LABEL[c.before].toLowerCase()} to ${CONDITION_LABEL[c.after].toLowerCase()}`))) : h('p', changes.some((c) => c.after) ? 'No area is in worse condition.' : 'Rate areas to compare them.'),
              changes.filter((c) => c.change === 'better').length ? h('p.subtle', `${changes.filter((c) => c.change === 'better').length} improved.`) : null,
            )
          : h('p.subtle', 'No earlier completed inspection of this place.'),
      }),
    );
    const view = h(
      'div',
      pageHeader({
        title: `${inspectionTypeLabel(ins.type)} inspection`,
        crumbs: [{ label: 'Inspections', href: '#/inspections' }],
        after: h('div.row.header-pills', statusPill(done ? 'completed' : 'scheduled'), h('span.subtle', `${inspectionPlace(ins)} · ${date(ins.date)}`)),
        actions: [more, !done ? h('button.btn.primary', { type: 'button', onClick: complete }, icon('check', 16), 'Complete inspection') : h('button.btn', { type: 'button', onClick: () => printInspection(ins, prev) }, icon('printer', 16), 'Print')],
      }),
      h('div.detail', main, aside),
    );
    if (refocus) {
      const key = refocus;
      refocus = null;
      requestAnimationFrame(() => {
        const el = view.querySelector(`[data-fk="${key}"]`);
        if (!el) return;
        (el.matches('.seg') ? el.querySelector('[aria-checked="true"]') || el.querySelector('button') : el).focus();
      });
    }
    return view;
  }, ['inspections', 'team']);
  return { node: h('div.page', body), title: 'Inspection' };
}

async function editDetails(ins) {
  const type = select({ value: ins.type, options: INSPECTION_TYPES });
  const day = textInput({ type: 'date', value: ins.date });
  const inspector = memberSelect({ value: ins.inspectorId || '' });
  await formDialog({
    title: 'Inspection details',
    body: h('div.form-grid', field('Type', type), field('Date', day), field('Inspector', inspector)),
    onSubmit: () => {
      app.store.patch('inspections', ins.id, { type: type.value, date: day.value || ins.date, inspectorId: inspector.value || null });
      toast('Inspection updated');
    },
  });
}

function printInspection(ins, prev) {
  const changes = prev ? compareInspections(prev, ins) : [];
  printNode(
    h(
      'div.print-sheet',
      printHeader(`${inspectionTypeLabel(ins.type)} inspection`, `${inspectionPlace(ins)} · ${date(ins.date)}`),
      h(
        'dl.print-kv',
        [
          ['Inspector', lookup.member(ins.inspectorId)?.name || ''],
          ['Status', ins.status === 'completed' ? `Completed ${ins.completedOn ? date(ins.completedOn) : ''}` : 'Scheduled'],
          ['Previous inspection', prev ? date(prev.date) : 'None'],
        ].map(([k, v]) => [h('dt', k), h('dd', v)]),
      ),
      h(
        'table.table',
        h('thead', h('tr', h('th', 'Area'), h('th', 'Condition'), prev ? h('th', 'Last time') : null, h('th', 'Notes'))),
        h(
          'tbody',
          (ins.areas || []).map((a) => {
            const c = changes.find((x) => x.name === a.name);
            return h('tr', h('td', a.name), h('td', a.condition ? CONDITION_LABEL[a.condition] : 'Not rated'), prev ? h('td', c?.before ? CONDITION_LABEL[c.before] : '') : null, h('td', a.notes || ''));
          }),
        ),
      ),
      h('section.print-sign', h('div', 'Inspector signature'), h('div', 'Tenant signature')),
    ),
    `Inspection ${inspectionPlace(ins)} ${ins.date}`,
  );
}

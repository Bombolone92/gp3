import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { formPage } from '../ui/form.js';
import { app } from '../app.js';
import { navigate, back } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { parseDecimal } from '../core/money.js';
import { emptyPage } from './common.js';

const UNITS = ['each', 'quart', 'gallon', 'liter', 'pair', 'set', 'box', 'foot', 'meter', 'pound', 'kilogram'];

export function render(ctx) {
  const store = app.store;
  const s = app.settings();
  const existing = ctx.params.id ? store.get('parts', ctx.params.id) : null;
  if (ctx.params.id && !existing) return emptyPage('Part not found', 'It may have been deleted.');
  let locs = structuredClone(existing?.locations?.length ? existing.locations : [{ location: s.partLocations[0] || 'Main shop', qty: 0, aisle: '', reorderPoint: null }]);
  const locList = h('div.loc-list');
  function draw() {
    locList.replaceChildren(
      ...locs.map((l, i) => {
        const where = h('select.select.sm', { 'aria-label': `Location ${i + 1}` }, [...new Set([...s.partLocations, l.location].filter(Boolean))].map((x) => h('option', { value: x }, x)));
        where.value = l.location;
        const qty = h('input.input.sm.num', { type: 'text', inputmode: 'decimal', value: l.qty ?? 0, 'aria-label': `Quantity at location ${i + 1}` });
        const aisle = h('input.input.sm', { type: 'text', value: l.aisle || '', placeholder: 'Aisle, row, bin', 'aria-label': `Aisle at location ${i + 1}` });
        const reorder = h('input.input.sm.num', { type: 'text', inputmode: 'decimal', value: l.reorderPoint ?? '', placeholder: 'None', 'aria-label': `Reorder point at location ${i + 1}` });
        const num = (el) => {
          const n = parseDecimal(el.value);
          Number.isNaN(n) ? el.setAttribute('aria-invalid', 'true') : el.removeAttribute('aria-invalid');
          return n;
        };
        const upd = () => Object.assign(l, { location: where.value, qty: num(qty) ?? 0, aisle: aisle.value, reorderPoint: num(reorder) });
        for (const el of [where, qty, aisle, reorder]) el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', upd);
        return h('div.loc-row', h('label.li-mini', h('span', 'Location'), where), h('label.li-mini', h('span', 'On hand'), qty), h('label.li-mini', h('span', 'Aisle'), aisle), h('label.li-mini', h('span', 'Reorder at'), reorder), locs.length > 1 ? h('button.icon-btn.sm', { type: 'button', 'aria-label': `Remove location ${i + 1}`, onClick: () => removeLoc(i) }, icon('trash', 15)) : h('span'));
      }),
      ...(s.partLocations.length > locs.length ? [h('button.btn.sm', { type: 'button', onClick: addLoc }, icon('plus', 15), 'Add location')] : []),
    );
  }
  function addLoc() {
    locs.push({ location: s.partLocations.find((x) => !locs.some((l) => l.location === x)), qty: 0, aisle: '', reorderPoint: null });
    draw();
    locList.children[locs.length - 1]?.querySelector('select')?.focus();
  }
  // Keep keyboard focus in the list: on the remove button of the row that
  // took this one's place, or on the location of the row that is left.
  function removeLoc(i) {
    locs.splice(i, 1);
    draw();
    const row = locList.children[Math.min(i, locs.length - 1)];
    (row?.querySelector('button.icon-btn') || row?.querySelector('select'))?.focus();
  }
  draw();
  Object.defineProperty(locList, 'value', { get: () => JSON.stringify(locs) });
  const page = formPage({
    title: existing ? `Edit part ${existing.number}` : 'New part',
    crumbs: [{ label: 'Parts', href: '#/parts' }, { label: existing ? existing.number : 'New' }],
    record: existing || { unit: 'each', category: s.partCategories[0] },
    saveLabel: existing ? 'Save part' : 'Add part',
    sections: [
      {
        id: 'details',
        title: 'Details',
        fields: [
          { id: 'number', label: 'Part number', required: true, validate: (v) => (store.all('parts').some((p) => p.number?.toLowerCase() === v.toLowerCase() && p.id !== existing?.id) ? 'Another part already uses this number.' : null) },
          { id: 'description', label: 'Description', required: true },
          { id: 'category', label: 'Category', type: 'select', options: () => s.partCategories },
          { id: 'unit', label: 'Unit of measure', type: 'select', required: true, options: () => UNITS },
          { id: 'manufacturer', label: 'Manufacturer' },
          { id: 'mpn', label: 'Manufacturer part number' },
          { id: 'upc', label: 'UPC or barcode' },
          { id: 'unitCost', label: 'Unit cost', type: 'money' },
          { id: 'notes', label: 'Notes', type: 'textarea', rows: 2, span: 2 },
        ],
      },
      { id: 'stock', title: 'Stock', intro: existing ? 'Changing quantities here records an adjustment. Normally stock moves through work orders and purchase orders.' : 'Starting quantity at each location.', fields: [{ id: 'locs', label: 'Locations', type: 'custom', noLabel: true, span: 2, render: () => locList }] },
    ],
    onCancel: () => back(existing ? `/parts/${existing.id}` : '/parts'),
    onSave: (v) => {
      // Build on the stored part, not the one the form opened with: work
      // orders, purchase orders, and other devices may have moved its stock,
      // cost, or files meanwhile.
      const cur = existing && store.get('parts', existing.id);
      if (existing && !cur) {
        toast('This part was deleted, so the changes were not saved.', { type: 'error' });
        return false;
      }
      if (locs.some((l) => Number.isNaN(l.qty) || Number.isNaN(l.reorderPoint))) {
        toast('Enter quantities and reorder points as numbers.', { type: 'error' });
        return false;
      }
      if (new Set(locs.map((l) => l.location)).size < locs.length) {
        toast('Each location can be listed only once.', { type: 'error' });
        return false;
      }
      const { locs: _, ...rest } = v;
      const saved = store.put('parts', { ...(cur || { archived: false, attachments: [] }), ...rest, unitCost: cur && (v.unitCost || 0) === (existing.unitCost || 0) ? cur.unitCost || 0 : v.unitCost || 0, locations: cur ? mergeStock(existing.locations || [], locs, cur.locations || []) : locs });
      page.form.markClean();
      toast(existing ? 'Part saved' : 'Part added');
      navigate(`/parts/${saved.id}`, { replace: !existing });
    },
  });
  return { node: page.node, title: existing ? 'Edit part' : 'New part', dirty: () => page.form.dirty() };
}

/**
 * The locations to save for an edited part: the quantity typed at each
 * location counts as a change from what the form opened with, applied to
 * the stock there now. Locations added elsewhere meanwhile are kept.
 */
function mergeStock(opened, edited, stored) {
  const was = new Map(opened.map((l) => [l.location, Number(l.qty) || 0]));
  const now = new Map(stored.map((l) => [l.location, Number(l.qty) || 0]));
  const out = edited.map((l) => (was.has(l.location) && now.has(l.location) ? { ...l, qty: Math.round((now.get(l.location) + l.qty - was.get(l.location)) * 1000) / 1000 } : l));
  for (const l of stored) if (!was.has(l.location) && !edited.some((x) => x.location === l.location)) out.push(l);
  return out;
}

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { formPage, picker } from '../ui/form.js';
import { app, lookup } from '../app.js';
import { navigate, back } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { newId } from '../core/ids.js';
import { centsToInput, parseMoney, parseDecimal } from '../core/money.js';
import { poTotals } from '../core/totals.js';
import { stockOnHand } from '../core/actions.js';
import { statusMeta } from '../core/status.js';
import { options, emptyPage, money } from './common.js';

export function render(ctx) {
  const store = app.store;
  const s = app.settings();
  const existing = ctx.params.id ? store.get('purchaseOrders', ctx.params.id) : null;
  if (ctx.params.id && !existing) return emptyPage('Purchase order not found', 'It may have been deleted.');
  const first = ctx.query.part ? lookup.part(ctx.query.part) : null;
  let items = structuredClone(existing?.items || (first ? [{ id: newId(), partId: first.id, qty: 1, unitCost: first.unitCost || 0, received: 0 }] : []));
  const totalsNode = h('dl.totals.readonly');
  const list = h('div.po-items');
  let shipping = existing?.shipping || 0;
  let tax = existing?.taxPercent || 0;
  const drawTotals = () => {
    const t = poTotals({ items, shipping, taxPercent: tax });
    totalsNode.replaceChildren(h('div', h('dt', 'Subtotal'), h('dd.money', money(t.subtotal))), h('div', h('dt', 'Tax'), h('dd.money', money(t.tax))), h('div', h('dt', 'Shipping'), h('dd.money', money(t.shipping))), h('div.grand', h('dt', 'Total'), h('dd.money', money(t.total))));
  };
  function draw() {
    list.replaceChildren(
      ...items.map((it, i) => {
        const part = lookup.part(it.partId);
        const qty = h('input.input.sm.num', { type: 'text', inputmode: 'decimal', value: it.qty ?? '', 'aria-label': `Quantity of ${part?.description || 'part'}` });
        const cost = h('input.input.sm.num', { type: 'text', inputmode: 'decimal', value: it.unitCost ? centsToInput(it.unitCost) : '', 'aria-label': `Unit cost of ${part?.description || 'part'}` });
        const line = h('span.money.li-amount', money(Math.round((Number(it.qty) || 0) * (Number(it.unitCost) || 0))));
        const upd = () => {
          it.qty = parseDecimal(qty.value) || 0;
          it.unitCost = parseMoney(cost.value) || 0;
          for (const [el, bad] of [[qty, !(it.qty > 0)], [cost, it.unitCost < 0]]) bad ? el.setAttribute('aria-invalid', 'true') : el.removeAttribute('aria-invalid');
          line.textContent = money(Math.round(it.qty * it.unitCost));
          drawTotals();
        };
        qty.addEventListener('input', upd);
        cost.addEventListener('input', upd);
        return h('div.li-part', icon('package', 15), h('span.grow.truncate', part?.description || 'Part', h('span.cell-sub', `${part?.number || ''}${part ? ` · ${stockOnHand(part)} on hand` : ''}`)), h('label.li-mini', h('span', 'Qty'), qty), h('label.li-mini', h('span', 'Unit cost'), cost), line, h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Remove item', onClick: () => (items.splice(i, 1), draw()) }, icon('x', 15)));
      }),
    );
    if (!items.length) list.append(h('p.mini-empty', 'No parts on this order yet.'));
    drawTotals();
  }
  const add = picker({
    label: 'Add part',
    placeholder: 'Add part',
    items: options.parts(),
    allowClear: false,
    onChange: (pid) => {
      if (!pid) return;
      const part = lookup.part(pid);
      items.push({ id: newId(), partId: pid, qty: 1, unitCost: part?.unitCost || 0, received: 0 });
      add.value = null;
      draw();
    },
  });
  draw();
  const editor = h('div', list, h('div.li-part-add', add), totalsNode);
  Object.defineProperty(editor, 'value', { get: () => JSON.stringify(items) });

  const page = formPage({
    title: existing ? `Edit purchase order #${existing.number}` : 'New purchase order',
    crumbs: [{ label: 'Purchase orders', href: '#/purchase-orders' }, { label: existing ? `#${existing.number}` : 'New' }],
    record: existing || { status: 'draft', date: app.today(), location: s.partLocations[0], vendorId: null },
    saveLabel: existing ? 'Save purchase order' : 'Create purchase order',
    sections: [
      {
        id: 'details',
        title: 'Details',
        fields: [
          { id: 'vendorId', label: 'Vendor', type: 'picker', required: true, options: options.vendors('parts', existing?.vendorId), span: 2 },
          { id: 'status', label: 'Status', type: 'select', required: true, options: () => [{ value: 'draft', label: 'Draft' }, { value: 'ordered', label: 'Ordered' }, ...(existing && ['partial', 'received', 'cancelled'].includes(existing.status) ? [{ value: existing.status, label: statusMeta('po', existing.status).label }] : []), { value: 'cancelled', label: 'Cancelled' }].filter((x, i, a) => a.findIndex((y) => y.value === x.value) === i) },
          { id: 'location', label: 'Receive into', type: 'select', required: true, options: () => s.partLocations },
          { id: 'date', label: 'Order date', type: 'date', required: true },
          { id: 'expectedDate', label: 'Expected delivery', type: 'date' },
          { id: 'notes', label: 'Notes', type: 'textarea', rows: 2, span: 2 },
        ],
      },
      {
        id: 'items',
        title: 'Parts',
        fields: [
          { id: 'items', label: 'Parts', type: 'custom', noLabel: true, span: 2, render: () => editor },
          { id: 'taxPercent', label: 'Tax', type: 'number', min: 0, step: '0.01', unit: '%' },
          { id: 'shipping', label: 'Shipping', type: 'money' },
        ],
      },
    ],
    onChange: (v, fid) => {
      if (fid === 'taxPercent' || fid === 'shipping') {
        tax = Number(v.taxPercent) || 0;
        shipping = Number(v.shipping) || 0;
        drawTotals();
      }
    },
    onCancel: () => back(existing ? `/purchase-orders/${existing.id}` : '/purchase-orders'),
    onSave: async (v) => {
      // Build on the stored record, not the one the form opened with: files
      // and other changes may have arrived meanwhile.
      const cur = existing && store.get('purchaseOrders', existing.id);
      if (existing && !cur) {
        toast('This purchase order was deleted, so the changes were not saved.', { type: 'error' });
        return false;
      }
      if (!items.length) {
        toast('Add at least one part.', { type: 'error' });
        return false;
      }
      if (items.some((it) => !(Number(it.qty) > 0) || Number(it.unitCost) < 0)) {
        toast('Each part needs a quantity above zero and a cost of zero or more.', { type: 'error' });
        return false;
      }
      const short = items.find((it) => Number(it.qty) < (Number(it.received) || 0));
      if (short) {
        toast(`${lookup.part(short.partId)?.description || 'A part'} already has ${short.received} received. Order at least that many.`, { type: 'error' });
        return false;
      }
      const data = { ...(cur || {}), ...v, items, taxPercent: Number(v.taxPercent) || 0, shipping: v.shipping || 0 };
      // A partly received order with nothing left to receive is complete.
      if (data.status === 'partial' && items.every((it) => (Number(it.received) || 0) >= Number(it.qty))) Object.assign(data, { status: 'received', receivedDate: data.receivedDate || app.today() });
      delete data.items_;
      const saved = existing ? store.put('purchaseOrders', data) : store.put('purchaseOrders', { ...data, number: await store.nextNumber('purchaseOrders') });
      page.form.markClean();
      toast(existing ? 'Purchase order saved' : `Purchase order #${saved.number} created`);
      navigate(`/purchase-orders/${saved.id}`, { replace: !existing });
    },
  });
  return { node: page.node, title: 'Purchase order', dirty: () => page.form.dirty() };
}

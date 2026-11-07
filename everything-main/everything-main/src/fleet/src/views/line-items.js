/**
 * Editors shared by service entries and work orders: line items (service
 * task + labor + parts), the totals block (discount, tax), and checklists
 * of open issues and reminders the work resolves.
 */
import { h, uniqueId } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { picker } from '../ui/form.js';
import { app, lookup } from '../app.js';
import { newId } from '../core/ids.js';
import { centsToInput, parseMoney, parseDecimal } from '../core/money.js';
import { lineLabor, lineParts, docTotals } from '../core/totals.js';
import { reminderState } from '../core/reminders.js';
import { stockOnHand } from '../core/actions.js';
import { formatDecimal } from '../core/format.js';
import { formatDate, relativeDays } from '../core/dates.js';
import { statusPill } from '../ui/components.js';
import { openFormDialog } from '../ui/form.js';
import { money, options, dueText } from './common.js';

/**
 * After a row is removed, keep keyboard focus nearby rather than letting it
 * fall back to the page: on the next row's remove button, or a fallback.
 */
function focusAfterRemove(row, selector, fallback) {
  const target = row?.querySelector(selector) || fallback?.querySelector?.('button') || fallback;
  target?.focus?.();
}

/** Flag an amount that is not a number of zero or more; it counts as empty. */
function guard(n, read) {
  const check = () => {
    const bad = n.value.trim() !== '' && read() === null;
    if (bad) n.setAttribute('aria-invalid', 'true');
    else n.removeAttribute('aria-invalid');
  };
  n.addEventListener('input', check);
  check();
}

function numInput({ value, label, step = 'any', placeholder = '', cls = '' }) {
  const n = h(`input.input.sm.num${cls ? '.' + cls : ''}`, { type: 'text', inputmode: 'decimal', 'aria-label': label, placeholder, autocomplete: 'off' });
  n.value = value === null || value === undefined || value === '' ? '' : String(value);
  const read = () => {
    const x = parseDecimal(n.value);
    return x === null || Number.isNaN(x) || x < 0 ? null : x;
  };
  Object.defineProperty(n, 'num', { get: read });
  guard(n, read);
  return n;
}

// `credit` allows a negative amount (a warranty credit as a flat labor cost).
function moneyIn({ cents, label, placeholder = '0.00', credit = false }) {
  const n = h('input.input.sm.num', { type: 'text', inputmode: 'decimal', 'aria-label': label, placeholder, autocomplete: 'off' });
  n.value = cents ? centsToInput(cents) : '';
  const read = () => {
    const c = parseMoney(n.value);
    return c !== null && (credit || c >= 0) ? c : null;
  };
  n.addEventListener('blur', () => {
    const c = read();
    if (c !== null) n.value = centsToInput(c);
  });
  Object.defineProperty(n, 'cents', { get: () => read() ?? 0 });
  guard(n, read);
  return n;
}

/**
 * Line items editor. Returns a node with `.value` (the items) and calls
 * onChange(items) whenever something changes.
 */
export function lineItemsEditor(initial = [], { onChange } = {}) {
  let items = structuredClone(initial || []);
  const s = app.settings();
  const list = h('div.li-list');
  const addBtn = h('button.btn.sm', { type: 'button', onClick: () => add() }, icon('plus', 15), 'Add service task');
  const wrap = h(
    'div.li-editor',
    list,
    h(
      'div.li-add',
      addBtn,
      h('button.btn.sm.ghost', { type: 'button', onClick: () => add({ taskId: null, description: '' }, true) }, icon('text', 15), 'Add custom line'),
    ),
  );

  function emit() {
    onChange?.(items);
  }

  function add(li = {}, custom = false) {
    items.push({ id: newId(), taskId: null, description: '', laborHours: null, laborRate: s.laborRate || null, laborCost: null, parts: [], custom, ...li });
    draw();
    emit();
    // Focus the new row's first control.
    list.lastElementChild?.querySelector('button.picker-btn, input')?.focus();
  }

  function lineNode(li, idx) {
    const taskPick = picker({
      label: `Service task for line ${idx + 1}`,
      placeholder: 'Choose a service task',
      items: options.tasks(),
      value: li.taskId,
      allowClear: false,
      create: {
        label: (q) => (q ? `Create task "${q}"` : 'Create a new service task'),
        run: (q, done) => quickTask(q).then((t) => t && (li.taskId = t.id, done(t.id), emit())),
      },
      onChange: (v) => {
        li.taskId = v;
        emit();
      },
    });
    const desc = h('input.input.sm', { type: 'text', value: li.description || '', placeholder: li.taskId || !li.custom ? 'Notes for this line (optional)' : 'What was done', 'aria-label': `Description for line ${idx + 1}` });
    desc.addEventListener('input', () => {
      li.description = desc.value;
      emit();
    });
    const hours = numInput({ value: li.laborHours, label: 'Labor hours', placeholder: '0' });
    const rate = moneyIn({ cents: li.laborRate, label: 'Labor rate per hour' });
    const flat = moneyIn({ cents: li.laborHours && li.laborRate ? null : li.laborCost, label: 'Labor cost', credit: true });
    const laborTotal = h('span.li-amount.money');
    const partsTotal = h('span.li-amount.money');
    const lineTotal = h('strong.money');
    const refresh = () => {
      laborTotal.textContent = money(lineLabor(li));
      partsTotal.textContent = money(lineParts(li));
      lineTotal.textContent = money(lineLabor(li) + lineParts(li));
      flat.disabled = Boolean(li.laborHours && li.laborRate);
    };
    for (const inp of [hours, rate, flat]) {
      inp.addEventListener('input', () => {
        li.laborHours = hours.num;
        li.laborRate = rate.cents || null;
        li.laborCost = flat.cents || null;
        refresh();
        emit();
      });
    }

    const partsList = h('div.li-parts');
    const drawParts = () => {
      partsList.replaceChildren(
        ...li.parts.map((p, pi) => {
          const part = lookup.part(p.partId);
          const qty = numInput({ value: p.qty, label: `Quantity of ${p.name || 'part'}`, placeholder: '1' });
          const cost = moneyIn({ cents: p.unitCost, label: `Unit cost of ${p.name || 'part'}` });
          const on = part ? stockOnHand(part) : null;
          const total = h('span.li-amount.money', money(Math.round((Number(p.qty) || 0) * (Number(p.unitCost) || 0))));
          const upd = () => {
            p.qty = qty.num;
            p.unitCost = cost.cents;
            total.textContent = money(Math.round((Number(p.qty) || 0) * (Number(p.unitCost) || 0)));
            refresh();
            emit();
          };
          qty.addEventListener('input', upd);
          cost.addEventListener('input', upd);
          // A part not in inventory keeps an editable name.
          let nameIn = null;
          if (!p.partId) {
            nameIn = h('input.input.sm', { type: 'text', value: p.name === 'Other part' ? '' : p.name || '', placeholder: 'Part name', 'aria-label': 'Part name' });
            nameIn.addEventListener('input', () => ((p.name = nameIn.value), emit()));
          }
          return h(
            'div.li-part',
            icon('package', 15),
            nameIn ? h('span.grow', nameIn) : h('span.grow.truncate', p.name || part?.description || 'Part', part ? h('span.cell-sub', `${part.number}${on !== null ? ` · ${formatDecimal(on, 2)} in stock` : ''}`) : null),
            h('label.li-mini', h('span', 'Qty'), qty),
            h('label.li-mini', h('span', 'Unit cost'), cost),
            total,
            h('button.icon-btn.sm', { type: 'button', 'aria-label': `Remove ${p.name || 'part'}`, onClick: () => (li.parts.splice(pi, 1), drawParts(), refresh(), emit(), focusAfterRemove(partsList.children[pi] || partsList.lastElementChild, 'button.icon-btn', partPick)) }, icon('x', 15)),
          );
        }),
      );
    };
    drawParts();
    const partPick = picker({
      label: 'Add a part',
      placeholder: 'Add part',
      items: options.parts(),
      value: null,
      allowClear: false,
      onChange: (pid) => {
        if (!pid) return;
        const part = lookup.part(pid);
        li.parts.push({ id: newId(), partId: pid, name: part?.description || part?.number || 'Part', qty: 1, unitCost: part?.unitCost || 0 });
        partPick.value = null;
        drawParts();
        refresh();
        emit();
      },
    });
    const addOtherPart = h(
      'button.link-btn.sm-text',
      {
        type: 'button',
        onClick: () => {
          li.parts.push({ id: newId(), partId: null, name: 'Other part', qty: 1, unitCost: 0 });
          drawParts();
          emit();
          partsList.lastElementChild?.querySelector('input[aria-label="Part name"]')?.focus();
        },
      },
      'Part not in inventory',
    );
    refresh();
    const id = uniqueId('li');
    return h(
      'section.li-row',
      { 'aria-labelledby': id },
      h('div.li-head', h('span.li-num', { id }, `Line ${idx + 1}`), li.custom && !li.taskId ? null : h('div.li-task', taskPick), h('div.grow'), lineTotal, h('button.icon-btn.sm', { type: 'button', 'aria-label': `Remove line ${idx + 1}`, onClick: () => (items.splice(idx, 1), draw(), emit(), focusAfterRemove(items.length ? list.children[Math.min(idx, items.length - 1)] : null, '.li-head > button.icon-btn', addBtn)) }, icon('trash', 15))),
      desc,
      h(
        'div.li-labor',
        h('span.li-label', icon('wrench', 14), 'Labor'),
        h('label.li-mini', h('span', 'Hours'), hours),
        h('label.li-mini', h('span', 'Rate'), rate),
        h('span.subtle.li-or', 'or'),
        h('label.li-mini', h('span', 'Flat cost'), flat),
        h('span.grow'),
        laborTotal,
      ),
      h('div.li-parts-wrap', h('span.li-label', icon('package', 14), 'Parts'), partsList, h('div.li-part-add', partPick, addOtherPart), h('div.li-parts-total', partsTotal)),
    );
  }

  function draw() {
    list.replaceChildren(...(items.length ? items.map(lineNode) : [h('p.mini-empty', 'No line items yet. Add the service tasks performed, with labor and parts.')]));
  }
  draw();
  Object.defineProperty(wrap, 'value', { get: () => items.map(({ custom, ...li }) => li) });
  wrap.setItems = (next) => {
    items = structuredClone(next);
    draw();
    emit();
  };
  wrap.addTask = (taskId) => {
    if (items.some((li) => li.taskId === taskId)) return;
    add({ taskId });
  };
  return wrap;
}

/** Create a service task on the fly from a picker. */
export function quickTask(name) {
  const s = app.settings();
  return openFormDialog({
    title: 'New service task',
    record: { name, category: s.serviceCategories[0] },
    fields: [
      { id: 'name', label: 'Name', required: true, span: 2 },
      { id: 'category', label: 'Category', type: 'select', options: () => s.serviceCategories },
      { id: 'description', label: 'Description', type: 'textarea', rows: 2, span: 2 },
    ],
    onSave: (v) => app.store.put('serviceTasks', { ...v, archived: false }),
  });
}

/** Discount and tax inputs plus the computed totals. */
export function totalsEditor(doc, { onChange } = {}) {
  const state = { discount: doc.discount ? { ...doc.discount } : { type: 'percent', value: null }, taxPercent: doc.taxPercent ?? null };
  const dType = h('select.select.sm', { 'aria-label': 'Discount type' }, h('option', { value: 'percent' }, '%'), h('option', { value: 'amount' }, 'Amount'));
  dType.value = state.discount.type || 'percent';
  const dVal = h('input.input.sm.num', { type: 'text', inputmode: 'decimal', 'aria-label': 'Discount', placeholder: '0' });
  dVal.value = state.discount.value ? (state.discount.type === 'amount' ? centsToInput(state.discount.value) : String(state.discount.value)) : '';
  const tax = h('input.input.sm.num', { type: 'text', inputmode: 'decimal', 'aria-label': 'Tax percent', placeholder: '0' });
  tax.value = state.taxPercent ? String(state.taxPercent) : '';
  const out = h('dl.totals');
  let items = doc.lineItems || [];
  const pct = (el) => {
    const x = parseDecimal(el.value.replace(/%/g, ''));
    return Number.isFinite(x) && x > 0 ? x : null;
  };
  const read = () => {
    const amount = parseMoney(dVal.value);
    state.discount = { type: dType.value, value: dType.value === 'amount' ? (amount > 0 ? amount : null) : pct(dVal) };
    state.taxPercent = pct(tax);
  };
  guard(dVal, () => (Number(dVal.value) === 0 || (dType.value === 'amount' ? parseMoney(dVal.value) > 0 : pct(dVal)) ? 0 : null));
  guard(tax, () => (Number(tax.value) === 0 ? 0 : pct(tax)));
  const draw = () => {
    const t = docTotals({ lineItems: items, discount: state.discount, taxPercent: state.taxPercent });
    out.replaceChildren(
      h('div', h('dt', 'Labor'), h('dd.money', money(t.labor))),
      h('div', h('dt', 'Parts'), h('dd.money', money(t.parts))),
      h('div', h('dt', 'Subtotal'), h('dd.money', money(t.subtotal))),
      h('div', h('dt', h('span', 'Discount'), h('span.totals-in', dVal, dType)), h('dd.money', t.discount ? `-${money(t.discount)}` : money(0))),
      h('div', h('dt', h('span', 'Tax'), h('span.totals-in', tax, h('span.subtle', '%'))), h('dd.money', money(t.tax))),
      h('div.grand', h('dt', 'Total'), h('dd.money', money(t.total))),
    );
  };
  for (const el of [dType, dVal, tax]) el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => (read(), draw(), onChange?.()));
  draw();
  const node = h('div.totals-wrap', out);
  Object.defineProperty(node, 'value', { get: () => (read(), { discount: state.discount.value ? state.discount : null, taxPercent: state.taxPercent }) });
  node.setItems = (next) => {
    items = next;
    draw();
  };
  return node;
}

/**
 * Checklists of the vehicle's open issues and service reminders. Reminders
 * whose task appears in the line items are checked automatically.
 */
export function linksEditor({ issueIds = [], reminderIds = [], vehicleId = null, docId = null } = {}) {
  const chosen = { issues: new Set(issueIds), reminders: new Set(reminderIds) };
  const autoRem = new Set();
  let vid = vehicleId;
  let tasks = new Set();
  const issuesNode = h('div.link-group');
  const remNode = h('div.link-group');
  function draw() {
    const today = app.today();
    const store = app.store;
    const issues = vid ? store.all('issues').filter((i) => i.vehicleId === vid && (i.status === 'open' || chosen.issues.has(i.id))) : [];
    const v = lookup.vehicle(vid);
    const rems = vid ? store.all('reminders').filter((r) => r.vehicleId === vid && !r.archived) : [];
    for (const r of rems) {
      if (tasks.has(r.taskId) && !autoRem.has(r.id) && !(r.history || []).some((x) => x.entryId === docId)) {
        autoRem.add(r.id);
        chosen.reminders.add(r.id);
      }
    }
    issuesNode.replaceChildren(
      h('h3.link-title', 'Issues resolved by this work'),
      issues.length
        ? h(
            'ul.check-list',
            issues.map((i) => {
              const cb = h('input', { type: 'checkbox', checked: chosen.issues.has(i.id) });
              cb.addEventListener('change', () => (cb.checked ? chosen.issues.add(i.id) : chosen.issues.delete(i.id)));
              return h('li', h('label.check', cb, h('span.grow', h('strong', `#${i.number} `), i.summary), statusPill('priority', i.priority)));
            }),
          )
        : h('p.subtle.small', vid ? 'This vehicle has no open issues.' : 'Choose a vehicle first.'),
    );
    remNode.replaceChildren(
      h('h3.link-title', 'Service reminders completed by this work'),
      rems.length
        ? h(
            'ul.check-list',
            rems.map((r) => {
              const st = reminderState(r, v, today, app.settings());
              const cb = h('input', { type: 'checkbox', checked: chosen.reminders.has(r.id) });
              cb.addEventListener('change', () => (cb.checked ? chosen.reminders.add(r.id) : chosen.reminders.delete(r.id)));
              return h('li', h('label.check', cb, h('span.grow', lookup.taskName(r.taskId) || 'Service', h('span.cell-sub', dueText(st, v, today) || (r.lastDate ? `Last done ${formatDate(r.lastDate)}` : ''))), statusPill('reminder', st.status)));
            }),
          )
        : h('p.subtle.small', vid ? 'No service reminders on this vehicle.' : 'Choose a vehicle first.'),
    );
  }
  draw();
  const node = h('div.links-editor', issuesNode, remNode);
  Object.defineProperty(node, 'value', { get: () => ({ issueIds: [...chosen.issues], reminderIds: [...chosen.reminders] }) });
  node.setVehicle = (next) => {
    if (next === vid) return;
    vid = next;
    chosen.issues.clear();
    chosen.reminders.clear();
    autoRem.clear();
    draw();
  };
  // Editing saved work: its lines' reminders were ticked or not on purpose,
  // so only tasks added from now on tick theirs automatically.
  let seeded = !docId;
  node.setTasks = (next) => {
    tasks = new Set(next.filter(Boolean));
    if (!seeded) {
      seeded = true;
      for (const r of app.store.all('reminders')) if (r.vehicleId === vid && tasks.has(r.taskId)) autoRem.add(r.id);
    }
    draw();
  };
  node.relative = relativeDays;
  return node;
}

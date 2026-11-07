/** Building blocks shared by several views. */
import { h, uniqueId, keepFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { avatar, avatarStack, combobox, moneyInput, textInput, textarea, field } from '../ui/components.js';
import { openMenu } from '../ui/menu.js';
import { openDialog } from '../ui/dialog.js';
import { clientName, clientSecondary, formatAddress, matches, primaryEmail, primaryPhone, telHref, directionsUrl } from '../core/format.js';
import { formatMoney, centsToInput, parseMoney, parseDecimal } from '../core/money.js';
import { computeTotals, lineTotal, isIncluded } from '../core/totals.js';
import { blankItem } from '../core/workflow.js';
import { navigate } from '../ui/router.js';

export const money = (c) => formatMoney(c, app.settings().currency);

export function clientLink(client, { sub = true } = {}) {
  if (!client) return h('span.subtle', 'No client');
  return h(
    'span.row',
    { style: { gap: '10px', minWidth: '0' } },
    avatar(clientName(client), { size: 'sm' }),
    h(
      'span.truncate',
      h('a', { href: `#/clients/${client.id}`, class: 'primary-link' }, clientName(client)),
      sub && clientSecondary(client) ? h('span.sub', { style: { display: 'block' } }, clientSecondary(client)) : null,
    ),
  );
}

export function teamAvatars(ids) {
  return avatarStack(lookup.members(ids));
}

export function teamNames(ids) {
  const m = lookup.members(ids);
  return m.length ? m.map((x) => x.name).join(', ') : 'Unassigned';
}

/** Card with the client's contact details and the job site. */
export function clientCard(client, propertyId, { title = 'Client' } = {}) {
  if (!client) return null;
  const property = lookup.property(client, propertyId);
  const phone = primaryPhone(client);
  const email = primaryEmail(client);
  const dir = directionsUrl(property);
  return h(
    'section.card',
    { 'aria-label': title },
    h(
      'div.card-body.stack',
      h(
        'div.row',
        avatar(clientName(client), { size: 'lg' }),
        h(
          'div.grow',
          h('a', { href: `#/clients/${client.id}`, style: { fontWeight: '700', fontSize: '16px' } }, clientName(client)),
          clientSecondary(client) ? h('div.subtle', clientSecondary(client)) : null,
        ),
      ),
      property
        ? h(
            'div.row',
            { style: { alignItems: 'flex-start' } },
            icon('pin', 16, 'subtle'),
            h('div.grow', { style: { whiteSpace: 'pre-line' } }, formatAddress(property, { multiline: true })),
            dir ? h('a.btn.sm', { href: dir, target: '_blank', rel: 'noopener noreferrer' }, icon('navigation', 14), 'Directions') : null,
          )
        : null,
      phone ? h('div.row', icon('phone', 16, 'subtle'), h('a', { href: telHref(phone) }, phone)) : null,
      email ? h('div.row', icon('mail', 16, 'subtle'), h('a.truncate', { href: `mailto:${email}` }, email)) : null,
    ),
  );
}

/**
 * Client picker field. onChange(client). Offers to create a client in a
 * dialog without leaving the form.
 */
export function clientPicker({ value, onChange, autofocus = false }) {
  const wrap = h('div');
  function draw(clientId) {
    wrap.replaceChildren();
    const client = lookup.client(clientId);
    if (client) {
      wrap.append(
        h(
          'div.picked-client',
          avatar(clientName(client), { size: '' }),
          h(
            'div.grow',
            h('div', { style: { fontWeight: '600' } }, clientName(client)),
            h('div.subtle', { style: { fontSize: '13px' } }, [primaryEmail(client), primaryPhone(client)].filter(Boolean).join(' · ') || 'No contact details'),
          ),
          h(
            'button.btn.sm',
            {
              type: 'button',
              onClick: () => {
                onChange(null);
                draw(null);
                wrap.querySelector('input')?.focus();
              },
            },
            'Change',
          ),
        ),
      );
      return;
    }
    const cb = combobox({
      placeholder: 'Search clients by name, email, phone or address',
      label: 'Client',
      items: () => app.store.all('clients').filter((c) => !c.archived),
      filter: (c, q) => matches([clientName(c), c.company, primaryEmail(c), primaryPhone(c), ...(c.properties || []).map((p) => formatAddress(p))].join(' '), q),
      renderItem: (c) => [
        avatar(clientName(c), { size: 'sm' }),
        h('span.grow.truncate', h('span', { style: { fontWeight: '600' } }, clientName(c)), h('span.subtle', { style: { display: 'block', fontSize: '12px' } }, formatAddress(c.properties?.[0]) || primaryEmail(c))),
      ],
      onSelect: (c) => {
        onChange(c);
        draw(c.id);
      },
      footerAction: {
        label: (q) => (q ? `Create client "${q}"` : 'Create new client'),
        run: async (q) => {
          const { quickClientDialog } = await import('./client-form.js');
          const c = await quickClientDialog(q);
          if (c) {
            onChange(c);
            draw(c.id);
          }
        },
      },
    });
    if (autofocus) setTimeout(() => cb.input.focus());
    wrap.append(cb);
  }
  draw(value);
  return wrap;
}

export function propertySelect(client, value, onChange) {
  const props = client?.properties || [];
  if (props.length <= 1) return null;
  const sel = h(
    'select.select',
    { onChange: (e) => onChange(e.target.value) },
    props.map((p) => h('option', { value: p.id }, formatAddress(p) || 'Unnamed property')),
  );
  sel.value = value || props[0].id;
  return sel;
}

// ---------------------------------------------------------------------------
// Line items editor
// ---------------------------------------------------------------------------

/**
 * Editable line items. Mutates `doc.items` in place and calls onChange()
 * after every edit so the caller can refresh totals and mark the form
 * dirty. Product names autocomplete from Products & Services.
 */
export function lineItemsEditor(doc, { onChange, allowOptional = false, showCost = true }) {
  const root = h('div.items-editor');
  const body = h('div.items-rows');
  const products = () => app.store.all('products').filter((p) => p.active !== false);

  function rowFor(item, index) {
    const nameInput = textInput({ value: item.name, placeholder: 'Name', 'aria-label': `Item ${index + 1} name`, cls: 'item-name' });
    const descInput = textarea({ value: item.description, placeholder: 'Description', rows: 2, 'aria-label': `Item ${index + 1} description` });
    const qtyInput = textInput({ value: String(item.qty ?? 1), inputmode: 'decimal', 'aria-label': `Item ${index + 1} quantity`, cls: 'num' });
    const priceInput = moneyInput({ cents: item.unitPrice, 'aria-label': `Item ${index + 1} unit price` });
    const costInput = moneyInput({ cents: item.unitCost, 'aria-label': `Item ${index + 1} unit cost` });
    const total = h('div.item-total.money', money(lineTotal(item)));

    const sync = () => {
      item.name = nameInput.value;
      item.description = descInput.value;
      item.qty = parseDecimal(qtyInput.value) ?? 0;
      item.unitPrice = parseMoney(priceInput.value) ?? 0;
      item.unitCost = parseMoney(costInput.value) ?? 0;
      total.textContent = money(lineTotal(item));
      onChange();
    };
    for (const el of [nameInput, descInput, qtyInput, priceInput, costInput]) el.addEventListener('input', sync);

    // Product suggestions under the name field.
    const suggest = h('ul.combo-list', { id: uniqueId('products'), role: 'listbox', 'aria-label': 'Products and services', hidden: true });
    nameInput.setAttribute('role', 'combobox');
    nameInput.setAttribute('aria-controls', suggest.id);
    nameInput.setAttribute('aria-autocomplete', 'list');
    nameInput.setAttribute('aria-expanded', 'false');
    let opts = [];
    let act = -1;
    const showSuggest = () => {
      const q = nameInput.value;
      opts = products().filter((p) => matches(p.name, q)).slice(0, 8);
      suggest.replaceChildren(
        ...opts.map((p, i) =>
          h(
            'li',
            { id: `${suggest.id}-${i}`, role: 'option', 'aria-selected': String(i === act), onMousedown: (e) => (e.preventDefault(), applyProduct(p)) },
            h('span.grow.truncate', h('span', { style: { fontWeight: '600' } }, p.name), p.description ? h('span.subtle', { style: { display: 'block', fontSize: '12px' } }, p.description) : null),
            h('span.money.subtle', money(p.unitPrice)),
          ),
        ),
      );
      suggest.hidden = !opts.length;
      nameInput.setAttribute('aria-expanded', String(!suggest.hidden));
      // Focus stays in the input, so point screen readers at the active option.
      if (act >= 0 && opts[act]) nameInput.setAttribute('aria-activedescendant', `${suggest.id}-${act}`);
      else nameInput.removeAttribute('aria-activedescendant');
    };
    const hideSuggest = () => {
      suggest.hidden = true;
      act = -1;
      nameInput.setAttribute('aria-expanded', 'false');
      nameInput.removeAttribute('aria-activedescendant');
    };
    const applyProduct = (p) => {
      item.productId = p.id;
      item.name = p.name;
      item.description = p.description || '';
      item.unitPrice = p.unitPrice || 0;
      item.unitCost = p.unitCost || 0;
      item.taxable = p.taxable !== false;
      nameInput.value = item.name;
      descInput.value = item.description;
      priceInput.cents = item.unitPrice;
      costInput.cents = item.unitCost;
      taxableBox.checked = item.taxable;
      total.textContent = money(lineTotal(item));
      hideSuggest();
      onChange();
      qtyInput.focus();
      qtyInput.select();
    };
    nameInput.addEventListener('focus', showSuggest);
    nameInput.addEventListener('input', () => {
      act = -1;
      showSuggest();
    });
    nameInput.addEventListener('blur', () => setTimeout(hideSuggest, 120));
    nameInput.addEventListener('keydown', (e) => {
      if (suggest.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        act = Math.max(0, Math.min(opts.length - 1, act + (e.key === 'ArrowDown' ? 1 : -1)));
        showSuggest();
      } else if (e.key === 'Enter' && act >= 0) {
        e.preventDefault();
        applyProduct(opts[act]);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        hideSuggest();
      }
    });

    const taxableBox = h('input', {
      type: 'checkbox',
      checked: item.taxable !== false,
      onChange: (e) => {
        item.taxable = e.target.checked;
        onChange();
      },
    });
    const flags = h(
      'div.item-flags',
      allowOptional
        ? h(
            'label.check',
            h('input', {
              type: 'checkbox',
              checked: !!item.optional,
              onChange: (e) => {
                item.optional = e.target.checked;
                if (!item.optional) delete item.selected;
                onChange();
                // Rows are rebuilt: stay on this box.
                keepFocus(body, redraw);
              },
            }),
            'Optional',
          )
        : null,
      allowOptional && item.optional
        ? h(
            'label.check',
            h('input', {
              type: 'checkbox',
              checked: !!item.selected,
              onChange: (e) => {
                item.selected = e.target.checked;
                onChange();
              },
            }),
            'Include in total',
          )
        : null,
      h('label.check', taxableBox, 'Taxable'),
    );

    const remove = h(
      'button.icon-btn.sm.remove-item',
      {
        type: 'button',
        'aria-label': `Remove item ${index + 1}`,
        title: 'Remove item',
        onClick: () => {
          const i = doc.items.indexOf(item);
          doc.items.splice(i, 1);
          onChange();
          redraw();
          // The button is gone: keep focus on the row that took its place.
          const rows = body.querySelectorAll('.item-row');
          (rows[Math.min(i, rows.length - 1)]?.querySelector('.remove-item') || addBtn).focus();
        },
      },
      icon('trash', 16),
    );

    const move = (dir) => {
      const i = doc.items.indexOf(item);
      const j = i + dir;
      if (j < 0 || j >= doc.items.length) return;
      [doc.items[i], doc.items[j]] = [doc.items[j], doc.items[i]];
      onChange();
      redraw();
      // At the top or bottom that button is disabled: use the other one.
      const row = body.querySelectorAll('.item-row')[j];
      const btn = row?.querySelector('.move-' + (dir < 0 ? 'up' : 'down'));
      (btn && !btn.disabled ? btn : row?.querySelector('.move-' + (dir < 0 ? 'down' : 'up')))?.focus();
    };

    return h(
      `div.item-row${item.optional ? '.optional' : ''}`,
      h(
        'div.item-main',
        h('div.combo.item-name-wrap', nameInput, suggest),
        descInput,
        flags,
      ),
      h(
        'div.item-nums',
        h('div.field', h('label.field-label', { for: qtyInput.id || (qtyInput.id = `q-${item.id}`) }, 'Qty'), qtyInput),
        h('div.field', h('label.field-label', { for: priceInput.id || (priceInput.id = `p-${item.id}`) }, 'Unit price'), priceInput),
        showCost ? h('div.field.cost-field', h('label.field-label', { for: costInput.id || (costInput.id = `c-${item.id}`) }, 'Unit cost'), costInput) : null,
        h('div.field', h('span.field-label', 'Total'), total),
      ),
      h(
        'div.item-tools',
        h('button.icon-btn.sm.move-up', { type: 'button', 'aria-label': `Move item ${index + 1} up`, title: 'Move up', disabled: index === 0 || null, onClick: () => move(-1) }, icon('chevron-up', 16)),
        h('button.icon-btn.sm.move-down', { type: 'button', 'aria-label': `Move item ${index + 1} down`, title: 'Move down', disabled: index === doc.items.length - 1 || null, onClick: () => move(1) }, icon('chevron-down', 16)),
        remove,
      ),
    );
  }

  function redraw() {
    body.replaceChildren(...doc.items.map((it, i) => rowFor(it, i)));
    if (!doc.items.length) body.append(h('p.subtle.items-empty', 'No line items yet. Add a product or service below.'));
  }

  const addBtn = h(
    'button.btn',
    {
      type: 'button',
      onClick: () => {
        doc.items.push(blankItem());
        onChange();
        redraw();
        body.lastElementChild?.querySelector('.item-name')?.focus();
      },
    },
    icon('plus', 16),
    'Add line item',
  );
  const addProductBtn = h(
    'button.btn.ghost',
    {
      type: 'button',
      onClick: (e) => {
        const list = products();
        if (!list.length) {
          navigate('/settings/products');
          return;
        }
        openMenu(
          e.currentTarget,
          list.slice(0, 40).map((p) => ({
            label: p.name,
            description: money(p.unitPrice),
            icon: p.kind === 'product' ? 'package' : 'wrench',
            run: () => {
              doc.items.push(blankItem(p));
              onChange();
              redraw();
            },
          })),
          { label: 'Add from products and services' },
        );
      },
    },
    icon('package', 16),
    'Add from catalog',
  );

  redraw();
  root.append(body, h('div.row.items-add', addBtn, addProductBtn));
  root.redraw = redraw;
  return root;
}

/** Subtotal / discount / tax / total block, editable or read-only. */
export function totalsBlock(doc, { editable = false, onChange, showDeposit = false, paid = null } = {}) {
  const wrap = h('div.totals');
  function draw() {
    const t = computeTotals(doc);
    wrap.replaceChildren();
    const row = (label, value, cls = '', control = null) =>
      h(`div.totals-row${cls ? '.' + cls : ''}`, h('span.grow', label, control), h('span.money', value));
    wrap.append(row('Subtotal', money(t.subtotal)));
    if (editable) {
      wrap.append(
        row('Discount', t.discount ? `-${money(t.discount)}` : money(0), '', discountControl()),
        row('Tax', money(t.tax), '', taxControl()),
      );
    } else {
      if (t.discount) wrap.append(row(doc.discount?.type === 'pct' ? `Discount (${doc.discount.value}%)` : 'Discount', `-${money(t.discount)}`));
      if (t.tax || doc.taxRate) wrap.append(row(`Tax (${Number(doc.taxRate) || 0}%)`, money(t.tax)));
    }
    wrap.append(row('Total', money(t.total), 'grand'));
    if (showDeposit) {
      if (editable) wrap.append(row('Required deposit', money(t.deposit), '', depositControl()));
      else if (t.deposit) wrap.append(row('Required deposit', money(t.deposit)));
    }
    if (paid !== null) {
      if (paid > 0) wrap.append(row('Paid', `-${money(paid)}`));
      wrap.append(row('Balance due', money(Math.max(0, t.total - paid)), 'grand'));
    }
  }

  function pctOrAmt(obj, onSet, label) {
    const type = obj?.type || 'pct';
    const input = h('input.input.sm.num', {
      value: obj?.value ? (type === 'pct' ? String(obj.value) : centsToInput(obj.value)) : '',
      placeholder: '0',
      inputmode: 'decimal',
      'aria-label': `${label} amount`,
      style: { width: '84px' },
    });
    const sel = h('select.select.sm', { 'aria-label': `${label} type`, style: { width: '76px', paddingRight: '22px', backgroundPosition: 'right 4px center' } }, h('option', { value: 'pct' }, '%'), h('option', { value: 'amt' }, app.settings().currency === 'USD' ? '$' : app.settings().currency));
    sel.value = type;
    const apply = () => {
      const t = sel.value;
      const raw = input.value.trim();
      if (!raw) onSet(null);
      else onSet({ type: t, value: t === 'pct' ? Math.max(0, Math.min(100, parseDecimal(raw) ?? 0)) : parseMoney(raw) ?? 0 });
      onChange?.();
      updateValuesOnly();
    };
    input.addEventListener('input', apply);
    sel.addEventListener('change', apply);
    return h('span.totals-control', input, sel);
  }

  function discountControl() {
    return pctOrAmt(doc.discount, (v) => (doc.discount = v), 'Discount');
  }

  function depositControl() {
    return pctOrAmt(doc.deposit, (v) => (doc.deposit = v), 'Deposit');
  }

  function taxControl() {
    const taxes = app.settings().taxes || [];
    const sel = h(
      'select.select.sm',
      { 'aria-label': 'Tax rate', style: { width: 'auto', maxWidth: '180px' } },
      h('option', { value: '0' }, 'No tax'),
      taxes.map((t) => h('option', { value: String(t.rate) }, `${t.name} (${t.rate}%)`)),
      h('option', { value: 'custom' }, 'Custom rate'),
    );
    const known = ['0', ...taxes.map((t) => String(t.rate))];
    const current = String(Number(doc.taxRate) || 0);
    const custom = h('input.input.sm.num', { value: current, inputmode: 'decimal', 'aria-label': 'Custom tax rate percent', style: { width: '70px' } });
    sel.value = known.includes(current) ? current : 'custom';
    const pct = h('span.subtle', '%');
    custom.hidden = pct.hidden = sel.value !== 'custom';
    sel.addEventListener('change', () => {
      custom.hidden = pct.hidden = sel.value !== 'custom';
      if (sel.value !== 'custom') doc.taxRate = Number(sel.value);
      else {
        // Start from the rate in effect, which is what the totals show.
        custom.value = String(Number(doc.taxRate) || 0);
        custom.focus();
      }
      onChange?.();
      updateValuesOnly();
    });
    custom.addEventListener('input', () => {
      doc.taxRate = Math.max(0, Math.min(100, parseDecimal(custom.value) ?? 0));
      onChange?.();
      updateValuesOnly();
    });
    return h('span.totals-control', sel, custom, pct);
  }

  // Update the numbers without rebuilding inputs (keeps focus while typing).
  function updateValuesOnly() {
    const t = computeTotals(doc);
    const rows = wrap.querySelectorAll('.totals-row .money');
    const vals = [money(t.subtotal)];
    if (editable) vals.push(t.discount ? `-${money(t.discount)}` : money(0), money(t.tax));
    vals.push(money(t.total));
    if (showDeposit && editable) vals.push(money(t.deposit));
    rows.forEach((el, i) => {
      if (vals[i] !== undefined) el.textContent = vals[i];
    });
  }

  draw();
  wrap.refresh = updateValuesOnly;
  wrap.redraw = draw;
  return wrap;
}

/** Read-only line items for detail pages and print. */
export function lineItemsTable(items, { showCost = false, showOptional = true } = {}) {
  const visible = (items || []).filter((it) => showOptional || isIncluded(it));
  if (!visible.length) return h('p.subtle', { style: { padding: '16px 18px' } }, 'No line items.');
  return h(
    'div.table-wrap',
    { tabindex: '0', role: 'region', 'aria-label': 'Line items' },
    h(
      'table.table.items-table',
      h(
        'thead',
        h(
          'tr',
          h('th', { scope: 'col' }, 'Product or service'),
          h('th.r', { scope: 'col' }, 'Qty'),
          h('th.r', { scope: 'col' }, 'Unit price'),
          showCost ? h('th.r.hide-print', { scope: 'col' }, 'Unit cost') : null,
          h('th.r', { scope: 'col' }, 'Total'),
        ),
      ),
      h(
        'tbody',
        visible.map((it) =>
          h(
            `tr${it.optional && !it.selected ? '.excluded' : ''}`,
            h(
              'td',
              h('div', { style: { fontWeight: '600' } }, it.name || 'Untitled item', it.optional ? h('span.pill.plain', { style: { marginLeft: '8px', height: '20px' } }, it.selected ? 'Optional, included' : 'Optional') : null),
              it.description ? h('div.sub', { style: { whiteSpace: 'pre-line' } }, it.description) : null,
            ),
            h('td.r.num', String(it.qty ?? 0)),
            h('td.r.money', money(it.unitPrice)),
            showCost ? h('td.r.money.subtle.hide-print', money(it.unitCost)) : null,
            h('td.r.money', money(lineTotal(it))),
          ),
        ),
      ),
    ),
  );
}

/** Multi-select team assignment as a button + popover with checkboxes. */
export function assigneePicker(selected, onChange, { label = 'Assign team' } = {}) {
  const btn = h('button.btn.assign-btn', { type: 'button', 'aria-haspopup': 'dialog' });
  const draw = () => {
    const members = lookup.members(selected);
    btn.replaceChildren(
      members.length ? avatarStack(members, { max: 4 }) : icon('user-plus', 16),
      h('span.truncate', members.length ? members.map((m) => m.name.split(' ')[0]).join(', ') : label),
      icon('chevron-down', 14),
    );
  };
  btn.addEventListener('click', async () => {
    const { openPopover } = await import('../ui/menu.js');
    // Inactive people stay listed while assigned, so they can be taken off.
    const team = app.store.all('team').filter((m) => m.active !== false || selected.includes(m.id));
    openPopover(
      btn,
      ({ close }) =>
        h(
          'div',
          { role: 'group', 'aria-label': label },
          h('div.menu-label', 'Team members'),
          team.length
            ? team.map((m) =>
                h(
                  'label.menu-item',
                  h('input', {
                    type: 'checkbox',
                    checked: selected.includes(m.id),
                    onChange: (e) => {
                      if (e.target.checked) selected.push(m.id);
                      else selected.splice(selected.indexOf(m.id), 1);
                      draw();
                      onChange(selected);
                    },
                  }),
                  avatar(m.name, { color: m.color, size: 'sm' }),
                  h('span.grow', m.name, m.active === false ? h('span.subtle', ' (inactive)') : null),
                ),
              )
            : h('p.subtle', { style: { padding: '8px 10px' } }, 'No team members yet.'),
          h('div.menu-sep'),
          h('a.menu-item', { href: '#/settings/team', onClick: () => close() }, icon('user-plus', 16), 'Manage team'),
        ),
      { label },
    );
  });
  draw();
  return btn;
}

/** Notes card that saves on blur. */
export function notesCard(coll, record, { title = 'Internal notes', hint = 'Only visible to your team' } = {}) {
  const ta = textarea({ value: record.notes || '', placeholder: 'Add a note for yourself or your team', rows: 4, 'aria-label': title });
  const status = h('span.subtle', { style: { fontSize: '12px' }, 'aria-live': 'polite' });
  // On blur rather than change: text carried over by a redraw (see
  // ctx.live) does not fire change, but must still be saved.
  ta.addEventListener('blur', () => {
    if (ta.value === (app.store.get(coll, record.id)?.notes || '')) return;
    app.store.patch(coll, record.id, { notes: ta.value });
    status.textContent = 'Saved';
    setTimeout(() => (status.textContent = ''), 1800);
  });
  return h(
    'section.card',
    h('div.card-head', h('h2.grow', title), status),
    h('div.card-body.stack', ta, h('span.subtle', { style: { fontSize: '12px' } }, hint)),
  );
}

export function sectionEmpty(text, action) {
  return h('div.section-empty', h('span', text), action || null);
}

/** Simple sort-state persistence per list in sessionStorage. */
export function rememberSort(key, initial) {
  try {
    const v = JSON.parse(sessionStorage.getItem(`fs.sort.${key}`) || 'null');
    if (v?.id) return v;
  } catch {}
  return initial;
}

export function saveSort(key, sort) {
  try {
    sessionStorage.setItem(`fs.sort.${key}`, JSON.stringify(sort));
  } catch {}
}

export { field, openDialog };

/** Simple checklist on a record (job steps, things to bring). */
export function checklistCard(coll, record, { title = 'Checklist' } = {}) {
  const store = app.store;
  const items = record.checklist || [];
  const done = items.filter((i) => i.done).length;
  const save = (fn) => store.patch(coll, record.id, (r) => ((r.checklist = fn([...(r.checklist || [])])), r));
  const input = h('input.input', { type: 'text', placeholder: 'Add an item and press Enter', 'aria-label': `Add to ${title.toLowerCase()}` });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    save((l) => [...l, { id: Math.random().toString(36).slice(2, 10), text, done: false }]);
    // The card re-renders; keep typing in the new input.
    requestAnimationFrame(() => document.querySelector('.checklist-card input.input')?.focus());
  });
  return h(
    'section.card.checklist-card',
    h('div.card-head', h('h2.grow', title, items.length ? h('span.count', ` ${done} of ${items.length}`) : null)),
    h(
      'div.card-body.stack',
      items.length
        ? h(
            'ul.checklist',
            items.map((it) =>
              h(
                'li',
                h('label.check.grow', h('input', { type: 'checkbox', checked: !!it.done, onChange: (e) => save((l) => l.map((x) => (x.id === it.id ? { ...x, done: e.target.checked } : x))) }), h(`span${it.done ? '.done-text' : ''}`, it.text)),
                h('button.icon-btn.sm', { type: 'button', 'aria-label': `Remove ${it.text}`, onClick: () => save((l) => l.filter((x) => x.id !== it.id)) }, icon('x', 14)),
              ),
            ),
          )
        : null,
      input,
    ),
  );
}

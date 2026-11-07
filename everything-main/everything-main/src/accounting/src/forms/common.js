/** Building blocks shared by the transaction forms. */
import { el, clear, nextId } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { combobox } from '../ui/combobox.js';
import { field } from '../ui/fields.js';
import { toast, toastError } from '../ui/toast.js';
import { store } from '../lib/store.js';
import { ACCOUNT_TYPES } from '../lib/accounts.js';
import { formatMoney, parseQty } from '../lib/money.js';
import { sdk } from '../lib/puter.js';
import { openContactForm, quickContact } from './contact.js';
import { openItemForm } from './item.js';
import { openAccountForm } from './account.js';

// ---------------------------------------------------------------- pickers

export function accountOptions(types = null, { exclude = [] } = {}) {
  return store.chart()
    .map((r) => r.account)
    .filter((a) => (!types || types.includes(a.type)) && !exclude.includes(a.id))
    .map((a) => ({ id: a.id, label: store.accountName(a.id), group: ACCOUNT_TYPES[a.type].label }));
}

export function accountPicker({ value, types = null, onChange, placeholder = 'Choose an account', ariaLabel, exclude = [], defaultType = null }) {
  return combobox({
    value, placeholder, ariaLabel, onChange,
    options: () => accountOptions(types, { exclude }),
    labelOf: (id) => store.accountName(id),
    addNewLabel: 'Add new account',
    onAddNew: async (name) => {
      const a = await openAccountForm({ name, type: defaultType || types?.[0] || 'expense', types });
      return a?.id || null;
    },
  });
}

export function contactPicker({ kind, value, onChange, placeholder, ariaLabel }) {
  return combobox({
    value, ariaLabel, onChange,
    placeholder: placeholder || (kind === 'vendor' ? 'Choose a vendor' : kind === 'customer' ? 'Choose a customer' : 'Choose a payee'),
    options: () => store.contactsOf(kind).map((c) => ({ id: c.id, label: c.displayName, sub: kind === 'any' ? (c.kind === 'vendor' ? 'Vendor' : 'Customer') : '', group: kind === 'any' ? (c.kind === 'vendor' ? 'Vendors' : 'Customers') : null })),
    labelOf: (id) => store.contactName(id),
    addNewLabel: kind === 'vendor' ? 'Add new vendor' : kind === 'customer' ? 'Add new customer' : 'Add new',
    onAddNew: async (name) => {
      const c = await quickContact(kind === 'any' ? 'vendor' : kind, name);
      return c?.id || null;
    },
  });
}

export function itemPicker({ value, onChange, ariaLabel, purchase = false }) {
  return combobox({
    value, ariaLabel, onChange, placeholder: 'Product or service',
    options: () => store.itemsList().map((i) => ({ id: i.id, label: i.name, sub: formatMoney(purchase ? i.cost || 0 : i.price || 0) })),
    labelOf: (id) => store.item(id)?.name || '',
    addNewLabel: 'Add new',
    onAddNew: async (name) => {
      const i = await openItemForm({ name });
      return i?.id || null;
    },
  });
}

export function taxRateSelect({ value, bp = null, onChange }) {
  const s = el('select.select', { 'aria-label': 'Sales tax rate' });
  // The document's own rate is listed even if made inactive since (so it can
  // be changed to "No tax"), at the percentage saved with the document, which
  // is what its tax uses, until another choice switches to current rates.
  const docRate = value;
  let docBp = Number.isFinite(bp) ? bp : null;
  const pct = (n) => `${(n / 100).toFixed(n % 100 ? 2 : 0)}%`;
  const fill = () => {
    s.replaceChildren(el('option', { value: '' }, 'No tax'));
    const rates = store.taxRateList();
    const saved = docRate && !rates.some((r) => r.id === docRate) ? store.taxRates.get(docRate) : null;
    for (const r of saved ? [...rates, saved] : rates) {
      const n = r.id === docRate && docBp !== null ? docBp : r.rate || 0;
      s.append(el('option', { value: r.id }, `${r.name} (${pct(n)})${r === saved ? ' (inactive)' : ''}`));
    }
    s.value = value || '';
  };
  fill();
  s.addEventListener('change', () => {
    value = s.value || null;
    if (docBp !== null) { docBp = null; fill(); }
    onChange(value);
  });
  return s;
}

// ------------------------------------------------------------ line grid

/**
 * An editable table of lines. Each column: { key, label, width, align, cell(line, row) }
 * where cell returns a node, and row = { changed(), index }. Calling changed()
 * re-runs every column's `refresh(line, node)` in that row and onChange().
 * The last row is always blank, ready to type into.
 */
export function lineGrid({ columns, lines, makeLine, onChange, ariaLabel = 'Lines', minRows = 2, isBlank }) {
  const table = el('table.lines-table', { 'aria-label': ariaLabel });
  const thead = el('thead', {}, el('tr', {},
    el('th.line-num', { scope: 'col' }, el('span.sr-only', {}, 'Line'), '#'),
    columns.map((c) => el(`th${c.align === 'right' ? '.num' : ''}`, { scope: 'col', style: c.width ? { width: c.width } : null }, c.label)),
    el('th.line-del', { scope: 'col' }, el('span.sr-only', {}, 'Delete'))));
  const tbody = el('tbody');
  table.append(thead, tbody);
  const blank = isBlank || ((l) => !l.itemId && !l.accountId && !l.desc && !l.amount && !l.debit && !l.credit && !l.paymentId && !l.qty && !l.rate);

  function ensureTrailing() {
    while (lines.length < minRows) lines.push(makeLine());
    if (!blank(lines[lines.length - 1])) lines.push(makeLine());
  }

  function rowNode(line) {
    const tr = el('tr', {});
    const refreshers = [];
    const num = el('td.line-num');
    const row = {
      get index() { return lines.indexOf(line); },
      changed() {
        for (const fn of refreshers) fn();
        onChange?.();
        // Typing into the last row grows the table by one blank row, without
        // re-rendering (and so without stealing focus from the field).
        if (lines[lines.length - 1] === line && !blank(line)) {
          const next = makeLine();
          lines.push(next);
          tbody.append(rowNode(next));
          renumber();
        }
      },
    };
    tr.append(num);
    for (const c of columns) {
      const td = el(`td${c.align === 'right' ? '.num' : ''}`, { 'data-label': c.label });
      const node = c.cell(line, row);
      td.append(node);
      if (c.refresh) refreshers.push(() => c.refresh(line, node));
      tr.append(td);
    }
    const del = el('button.icon-btn.line-del-btn', { type: 'button', html: icon('trash', 16) });
    del.addEventListener('click', () => {
      const i = lines.indexOf(line);
      lines.splice(i, 1);
      onChange?.();
      render(Math.min(i, lines.length - 1));
    });
    tr.append(el('td.line-del', {}, del));
    return tr;
  }

  function renumber() {
    [...tbody.children].forEach((tr, i) => {
      tr.firstChild.textContent = String(i + 1);
      tr.lastChild.firstChild.setAttribute('aria-label', `Delete line ${i + 1}`);
    });
  }

  function render(focusRow = -1, focusCol = 0) {
    ensureTrailing();
    clear(tbody);
    for (const line of lines) tbody.append(rowNode(line));
    renumber();
    if (focusRow >= 0) {
      const tr = tbody.children[focusRow];
      tr?.querySelectorAll('input, select, textarea')[focusCol]?.focus();
    }
  }

  const addBtn = el('button.btn.btn-sm', { type: 'button' }, 'Add lines');
  addBtn.addEventListener('click', () => {
    for (let k = 0; k < 4; k++) lines.push(makeLine());
    render(lines.length - 4);
  });
  const clearBtn = el('button.btn.btn-sm', { type: 'button' }, 'Clear all lines');
  clearBtn.addEventListener('click', () => {
    lines.splice(0, lines.length);
    onChange?.();
    render(0);
  });
  render();
  const root = el('div.lines', {}, el('div.lines-scroll', {}, table), el('div.lines-actions', {}, addBtn, clearBtn));
  /** Move to the blank line at the end (there always is one), for the Add a line shortcut. */
  function addLine() {
    if (!blank(lines[lines.length - 1])) {
      const next = makeLine();
      lines.push(next);
      tbody.append(rowNode(next));
      renumber();
    }
    tbody.lastElementChild?.querySelector('input, select, textarea')?.focus();
  }
  return { root, render, addLine };
}

/** Lines that carry something (the trailing blank row is dropped). */
export function filledLines(lines, isBlank) {
  const blank = isBlank || ((l) => !l.itemId && !l.accountId && !l.desc && !l.amount && !l.debit && !l.credit && !l.paymentId && !(l.qty && l.rate));
  return lines.filter((l) => !blank(l)).map((l) => {
    const c = { ...l };
    delete c._key;
    return c;
  });
}

// ------------------------------------------------------------ attachments

/**
 * Files attached to a transaction live in the user's Puter drive, under
 * attachments/<transaction id>/, never in the key-value store. The record
 * only keeps their names and paths.
 */
export function attachmentsBlock(doc, onChange) {
  const removed = [];
  const list = el('ul.attach-list');
  const input = el('input', { type: 'file', multiple: true, tabIndex: -1, 'aria-hidden': 'true', style: { display: 'none' } });
  const addBtn = el('button.btn.btn-sm', { type: 'button' }, el('span', { html: icon('paperclip', 15) }), 'Add attachment');
  const status = el('span.field-hint', { 'aria-live': 'polite' });
  const render = () => {
    clear(list);
    for (const a of doc.attachments || []) {
      const open = el('button.link-btn', { type: 'button' }, a.name);
      open.addEventListener('click', async () => {
        try {
          const blob = await sdk().fs.read(a.path);
          const url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: a.type || 'application/octet-stream' }));
          window.open(url, '_blank', 'noopener');
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (err) {
          toastError(`Could not open ${a.name}: ${err.message || err}`);
        }
      });
      const rm = el('button.icon-btn', { type: 'button', 'aria-label': `Remove ${a.name}`, html: icon('x', 15) });
      rm.addEventListener('click', () => {
        // The file is deleted when the transaction is saved; cancelling keeps it.
        doc.attachments = doc.attachments.filter((x) => x !== a);
        removed.push(a.path);
        render();
        onChange?.();
      });
      list.append(el('li', {}, el('span', { html: icon('paperclip', 14) }), open, el('span.muted', {}, ` ${Math.max(1, Math.round((a.size || 0) / 1024))} KB`), rm));
    }
  };
  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    status.textContent = `Uploading ${files.length} file${files.length > 1 ? 's' : ''}`;
    try {
      for (const f of files) {
        if (f.size > 25 * 1024 * 1024) { toast(`${f.name} is larger than 25 MB and was skipped.`); continue; }
        const safe = f.name.replace(/[\\/:*?"<>|]/g, '_');
        const item = await sdk().fs.write(`attachments/${doc.id}/${safe}`, f, { createMissingParents: true, dedupeName: true });
        doc.attachments = [...(doc.attachments || []), { name: item?.name || safe, path: item?.path || `attachments/${doc.id}/${safe}`, size: f.size, type: f.type }];
      }
      status.textContent = 'Uploaded';
      render();
      onChange?.();
    } catch (err) {
      status.textContent = '';
      toastError(`Upload failed: ${err.message || err}`);
    }
  });
  addBtn.addEventListener('click', () => input.click());
  render();
  const node = el('div.attachments', {}, el('div.field-label', {}, 'Attachments'), list, el('div.row', {}, addBtn, status), input);
  /** Call after the transaction is saved: removes the files taken off it. */
  node.commit = () => {
    for (const path of removed.splice(0)) sdk().fs.delete(path).catch(() => {});
  };
  return node;
}

/** On phones the footer has no room for Print and Make recurring; they move to More. */
export function mobileExtras({ onPrint, onRecurring }) {
  if (!window.matchMedia('(max-width: 767px)').matches) return [];
  return [
    onPrint ? { label: 'Print or download', icon: 'printer', onClick: onPrint } : null,
    onRecurring ? { label: 'Make recurring', icon: 'repeat', onClick: onRecurring } : null,
    'sep',
  ].filter(Boolean);
}

// ------------------------------------------------------------------ misc

/** A labelled field whose control id is linked for screen readers. */
export function labelled(label, control, opts) {
  return field(label, control, opts);
}

/** "Balance due $1,234.00" style headline in the form header area. */
export function headline(label) {
  const amount = el('div.doc-amount', {}, formatMoney(0));
  const node = el('div.doc-headline', {}, el('div.doc-headline-label', {}, label), amount);
  return { node, set(v) { amount.textContent = formatMoney(v); }, setLabel(t) { node.firstChild.textContent = t; } };
}

/** Recent transactions of a type, for the header's history menu. */
export function recentMenu(type, open) {
  return () => {
    const list = store.txnList((t) => t.type === type).slice(0, 10);
    if (!list.length) return [{ label: 'No recent transactions', disabled: true }];
    return list.map((t) => ({
      label: `${t.num ? `#${t.num} ` : ''}${store.contactName(t.contactId) || t.memo || ''} ${formatMoney(store.total(t))}`.trim(),
      onClick: () => open(t.id),
    }));
  };
}

export { nextId, openContactForm, parseQty };

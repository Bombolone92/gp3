/**
 * The price list: the line items this account bills over and over, with the
 * rate, unit, and tax treatment a new line should start from.
 *
 * The list fills itself — every saved document teaches it what was billed at
 * what rate — and this page is where that memory can be corrected: a stale
 * rate fixed, a typo removed, an entry added before it has ever been used.
 */

import { el, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import {
  emptyState, field, selectWrap, debounceInput, keepFocus, refocus,
} from '../ui/bits.js';
import { store } from '../lib/store.js';
import { UNIT_SUGGESTIONS, fmtMoney, unitForm } from '../lib/money.js';
import { settingsTaxes } from '../lib/doc.js';

/** How a saved item's stored tax treatment reads in one short phrase. */
function taxSummary(item) {
  if (!Array.isArray(item.taxes)) return '';
  if (!item.taxes.length) return 'No tax';
  return item.taxes.map((t) => `${t.label || 'Tax'} (${t.rate}%)`).join(' + ');
}

/** Add or edit one saved item. onSaved(item) fires after it is stored. */
export function openItemForm(item = null, onSaved = null) {
  const name = el('input.input', { value: item?.name || '', required: true });
  const rate = el('input.input', {
    type: 'number', min: '0', step: 'any', inputmode: 'decimal',
    value: item?.rate ?? '', placeholder: '0.00',
    // A price list holds prices; a credit is a negative quantity on the
    // line. The box declared min 0 but stored whatever was typed, so a
    // stray minus made a rate the editor would then suggest. Pinned on
    // change, the way every clamped number box in the app is.
    onchange: (e) => {
      if (e.target.value === '') return;
      e.target.value = Math.max(0, Number(e.target.value) || 0);
    },
  });
  const unit = el('input.input', {
    value: item?.unit || '', placeholder: 'hours, days, each…',
    list: 'saved-unit-suggestions', maxlength: '24',
  });
  const unitList = el('datalist', { id: 'saved-unit-suggestions' },
    UNIT_SUGGESTIONS.map((u) => el('option', { value: u })));

  // The same three answers a line item's own picker offers: follow the
  // document, charge nothing, or always charge one named rate.
  const choices = settingsTaxes(store.settings);
  const matches = (c) => Array.isArray(item?.taxes) && item.taxes.length === 1
    && String(item.taxes[0].label || '') === c.label && Number(item.taxes[0].rate) === c.rate;
  const custom = Array.isArray(item?.taxes) && item.taxes.length > 0 && !choices.some(matches);
  const tax = el('select.select', {},
    el('option', { value: '', selected: !Array.isArray(item?.taxes) }, 'Whatever the document charges'),
    el('option', { value: 'none', selected: Array.isArray(item?.taxes) && !item.taxes.length }, 'No tax'),
    choices.map((c, ci) => el('option', { value: String(ci), selected: matches(c) },
      `${c.label || 'Tax'} (${c.rate}%) only`)),
    // A treatment Settings no longer offers still has to read as what it is.
    custom ? el('option', { value: 'custom', selected: true, disabled: true },
      item.taxes.map((t) => `${t.label || 'Tax'} (${t.rate}%)`).join(' + ')) : null);

  const saveBtn = el('button.btn.btn-primary.btn-block', {
    onclick: async () => {
      if (!name.value.trim()) {
        toast('A description is required', { icon: 'alert' });
        name.focus();
        return;
      }
      const clash = store.items.find((i) => i.id !== item?.id
        && String(i.name || '').toLowerCase() === name.value.trim().toLowerCase());
      if (clash) {
        // Names are the key the editor fills a line from, so two entries
        // sharing one would make the rate it fills a coin toss. Saving
        // replaces the other entry, which is worth saying out loud first.
        const ok = await confirmDialog({
          title: `Replace “${clash.name}”?`,
          message: 'Another saved item already has that description. Saving keeps this one and removes the other.',
          confirmLabel: 'Replace it',
          danger: false,
        });
        if (!ok) {
          name.focus();
          return;
        }
      }
      saveBtn.disabled = true;
      const v = tax.value;
      const data = {
        id: item?.id,
        name: name.value,
        rate: rate.value === '' ? '' : Math.max(0, Number(rate.value) || 0),
        unit: unit.value,
        ...(v === '' ? {}
          : v === 'none' ? { taxes: [] }
          : v === 'custom' ? { taxes: item.taxes }
          : { taxes: [{ ...choices[Number(v)] }] }),
      };
      try {
        const saved = await store.saveItem(data);
        modal.close();
        toast(item ? 'Saved item updated' : `“${saved.name}” saved`);
        onSaved?.(saved);
      } catch (err) {
        console.error(err);
        toast('Could not save. Check your connection', { icon: 'wifiOff' });
        saveBtn.disabled = false;
        refocus(saveBtn);
      }
    },
  }, item ? 'Save changes' : 'Add item');

  const modal = openModal({
    title: item ? 'Edit saved item' : 'New saved item',
    content: el('div', {},
      field('Description', name),
      el('div.field-grid', {},
        field(`Rate (${store.settings.currency})`, rate),
        field('Unit', unit, { hint: '(optional)' })),
      unitList,
      field('Tax treatment', selectWrap(tax), { hint: 'when a line starts from this item' }),
      saveBtn),
  });
}

export function itemsView() {
  const root = el('div.view');
  let query = '';

  const listWrap = el('div');
  const search = debounceInput((value) => { query = value; renderList(); });
  const searchInput = el('input.input.search-input', {
    type: 'search',
    placeholder: 'Search saved items…',
    'aria-label': 'Search saved items',
    oninput: (e) => search(e.target.value.trim().toLowerCase()),
  });
  const toolbar = el('div.toolbar', {},
    el('div.search-wrap', { html: icon('search', 17, 1.6) }, searchInput));

  function renderList() {
    const restoreFocus = keepFocus(listWrap);
    clear(listWrap);
    const items = [...store.items].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || '')));
    // The search box only appears once the list is long enough to need it —
    // and a query cannot outlive the box that holds it: deleting entries until
    // the box goes away used to leave the list filtered by a term with nothing
    // on screen to say so, and no way to clear it.
    toolbar.hidden = items.length < 8;
    const term = toolbar.hidden ? '' : query;
    const shown = term
      ? items.filter((i) => `${i.name} ${i.unit || ''}`.toLowerCase().includes(term))
      : items;

    if (!items.length) {
      listWrap.append(emptyState('tag', 'No saved items yet',
        'Every line you save on a document is remembered here with its latest rate, so the next one fills itself in. You can also add one by hand — a service, a product, or a timekeeper: a person’s name with their hourly rate.',
        store.readOnly ? null : el('button.btn.btn-primary', { onclick: () => openItemForm() }, 'Add an item')));
      restoreFocus();
      return;
    }
    if (!shown.length) {
      listWrap.append(emptyState('search', 'No matches', 'Try a different search.'));
      restoreFocus();
      return;
    }

    listWrap.append(el('div.doc-list.card-list', {}, shown.map((it) => {
      const label = it.name || 'Saved item';
      const sub = [
        it.unit ? `per ${unitForm(it.unit, 1)}` : '',
        taxSummary(it),
      ].filter(Boolean).join(' · ');
      return el('div.doc-row.rule-row', {},
        el('span.doc-row-ic', { html: icon('tag', 17, 1.5) }),
        el('span.doc-row-main', {},
          el('span.doc-row-title', {}, el('span.doc-row-number', {}, label)),
          sub && el('span.doc-row-sub', {}, sub)),
        el('span.doc-row-end.rule-end', {},
          el('span.doc-row-amount', {}, fmtMoney(it.rate, store.settings.currency)),
          // Nothing here can be written from a device showing a saved copy, so
          // the row reads rather than offering an edit that would be refused.
          !store.readOnly && el('span.rule-actions', {},
            el('button.icon-btn', {
              html: icon('pencil', 16, 1.6), 'aria-label': `Edit ${label}`, title: 'Edit',
              onclick: () => openItemForm(it),
            }),
            el('button.icon-btn', {
              html: icon('trash', 16, 1.6), 'aria-label': `Delete ${label}`, title: 'Delete',
              onclick: async () => {
                const ok = await confirmDialog({
                  title: `Delete “${label}”?`,
                  message: 'It stops being suggested in the editor. Documents that already use it are untouched — and billing it again teaches it back.',
                });
                if (!ok) return;
                try {
                  await store.deleteItem(it.id);
                  toast('Saved item deleted', { icon: 'trash' });
                } catch (err) {
                  console.error(err);
                  toast('Could not delete. Check your connection', { icon: 'wifiOff' });
                }
              },
            }))));
    })));
    restoreFocus();
  }

  root.append(
    el('div.page-head', {},
      el('div', {},
        el('h1.page-title', {}, 'Saved items'),
        el('p.page-sub', {}, 'Tasks and timekeepers with their rates and units, filled in for you by the editor')),
      el('div.page-actions', {},
        el('button.btn.btn-primary', {
          html: icon('plus', 16, 1.8),
          disabled: store.readOnly,
          title: store.readOnly ? 'Reconnect to add a saved item' : null,
          onclick: () => openItemForm(),
        }, ' New item'))),
    toolbar,
    listWrap);

  renderList();
  store.addEventListener('change', renderList);
  root.destroy = () => {
    search.cancel();
    store.removeEventListener('change', renderList);
  };
  return root;
}

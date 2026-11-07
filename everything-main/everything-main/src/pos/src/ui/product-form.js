/**
 * The product form and the category manager, shared by the Products view and
 * by the register (an unknown barcode offers to create the product with its
 * SKU already filled in).
 */

import { el, clear, keepFocus } from './dom.js';
import { icon } from './icons.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { openCameraScanner } from './scanner.js';
import { openStockAdjust } from './stock-adjust.js';
import { photoBlob } from './image.js';
import { productPhotoUrl } from './product-photos.js';
import { store, PRODUCT_SLOTS, DEFAULT_LOW_STOCK } from '../lib/store.js';
import { parseAmount } from '../lib/money.js';
import { cameraScanSupported, findBySku } from '../lib/scan.js';
import { groupSummary } from '../lib/options.js';
import { marginPercent } from '../lib/profit.js';
import { formatMoney } from '../lib/money.js';
import { uid, plural } from '../lib/util.js';
import { todayISO, formatDay, formatTime } from '../lib/dates.js';

/** How a ledger entry names itself in the product's history list. */
const MOVEMENT_LABELS = {
  sale: 'Sale', refund: 'Refund', void: 'Void',
  received: 'Received delivery', recount: 'Recount', damage: 'Damage / waste',
  stocktake: 'Stocktake', other: 'Adjustment',
};

function movementLabel(m) {
  const base = MOVEMENT_LABELS[m.reason] || 'Adjustment';
  const name = m.receiptNumber ? `${base} #${m.receiptNumber}` : base;
  return m.note ? `${name} · ${m.note}` : name;
}

/** Other products already using this SKU - a scan of it would be ambiguous. */
export function skuClashes(sku, selfId = null) {
  return findBySku(store.products, sku).filter((p) => p.id !== selfId);
}

/**
 * openProductForm(existing?, { prefill, onSaved })
 *
 * `prefill` seeds a new product (currently { sku }); `onSaved(product)` fires
 * after a successful write, which is how a scan-to-create lands the new
 * product straight in the cart.
 */
export function openProductForm(existing = null, { prefill = null, onSaved = null } = {}) {
  // The visible .label sits beside the field rather than wrapping it, so it
  // names nothing for a screen reader; every field carries its own name, as
  // the rest of the app's inputs do.
  const nameInput = el('input.input', {
    type: 'text', value: existing?.name || '', maxLength: 60, required: true, 'aria-label': 'Name',
  });
  const priceInput = el('input.input', {
    type: 'text', inputmode: 'decimal', 'aria-label': 'Price',
    // Two decimals, like every other place this app shows money: a $3.80
    // product opened its own price field reading "3.8", the one screen where
    // a price didn't look like one - and a lost trailing digit is exactly
    // what that reads as. The option editor's deltas already do this.
    value: existing ? (Number(existing.price) || 0).toFixed(2) : '', placeholder: '0.00',
  });
  /* Cost: optional, and invisible in its consequences until it's filled in.
     The margin is spelled out live under the two fields, because "is 4.20 on
     1.10 a good price?" is the question this field exists to answer. */
  const costInput = el('input.input', {
    type: 'text', inputmode: 'decimal', 'aria-label': 'Cost',
    value: existing?.cost !== null && existing?.cost !== undefined
      ? (Number(existing.cost) || 0).toFixed(2) : '',
    placeholder: 'Optional',
  });
  const marginNote = el('p.small.field-note.margin-note', { 'aria-live': 'polite' });
  const renderMargin = () => {
    const price = parseAmount(priceInput.value);
    const costText = String(costInput.value).trim();
    const cost = costText ? parseAmount(costText) : null;
    const cash = (n) => formatMoney(n, store.settings.currency);
    clear(marginNote);
    marginNote.classList.remove('field-note-warn');
    if (!costText) {
      marginNote.append(el('span', {}, 'Cost is optional. Fill it in and Reports can show profit and margin.'));
      return;
    }
    if (cost === null || price === null) {
      marginNote.classList.add('field-note-warn');
      marginNote.append(el('span', {}, 'Enter the cost as a plain number, or clear the field.'));
      return;
    }
    const pct = marginPercent(price, cost);
    const per = soldBy === 'measure' ? ` per ${unit}` : '';
    if (pct === null) {
      marginNote.append(el('span', {}, `Cost ${cash(cost)}${per}. Set a price above zero to see the margin.`));
      return;
    }
    const profit = Math.round((price - cost) * 100) / 100;
    marginNote.classList.toggle('field-note-warn', profit <= 0);
    marginNote.append(el('span', {}, profit < 0
      ? `${cash(price)} − ${cash(cost)} = −${cash(Math.abs(profit))}${per}. This sells below cost.`
      : profit === 0
        ? `${cash(price)} − ${cash(cost)} = ${cash(0)}${per}. This sells at cost.`
        : `${cash(price)} − ${cash(cost)} = ${cash(profit)}${per} · ${pct}% margin`));
  };
  priceInput.addEventListener('input', renderMargin);
  costInput.addEventListener('input', renderMargin);

  // The length cap matches Store.#cleanProduct's, and the camera path
  // below applies it too - a code the store would shorten must not look
  // scannable in full here.
  const skuInput = el('input.input', {
    type: 'text', value: existing?.sku || prefill?.sku || '', maxLength: 128, placeholder: 'Optional',
    'aria-label': 'SKU or barcode',
  });

  /* SKU: warn about clashes as they happen, and offer the camera where it works. */
  const skuNote = el('p.small.field-note');
  const renderSkuNote = () => {
    const clashes = skuClashes(skuInput.value, existing?.id);
    clear(skuNote);
    skuNote.classList.toggle('field-note-warn', clashes.length > 0);
    if (clashes.length) {
      skuNote.append(el('span', {},
        `Also used by ${clashes.length === 1 ? `“${clashes[0].name}”` : `${clashes.length} other products`}. Scanning it won’t know which you mean.`));
    }
  };
  skuInput.addEventListener('input', renderSkuNote);

  const skuField = el('div.field', {},
    el('label.label', {}, 'SKU / barcode'),
    cameraScanSupported()
      ? el('div.row', {},
        el('div.grow', {}, skuInput),
        el('button.icon-btn.input-side-btn', {
          type: 'button', html: icon('scan', 18, 1.8),
          title: 'Scan a barcode into this field',
          'aria-label': 'Scan a barcode into this field',
          onclick: () => openCameraScanner({
            title: 'Scan SKU',
            // Programmatic assignment bypasses maxLength; cap like the store does.
            onCode: (code) => { skuInput.value = code.slice(0, 128); renderSkuNote(); skuInput.focus(); },
          }),
        }))
      : skuInput,
    skuNote
  );
  renderSkuNote();

  let categoryId = existing?.categoryId || null;
  const catSelect = el('select.select', {
    'aria-label': 'Category',
    onchange: (e) => {
      if (e.target.value === '__new') {
        renderCatOptions(); // snap back while the dialog is open
        const input = el('input.input', { type: 'text', placeholder: 'e.g. Drinks', 'aria-label': 'Category name' });
        const mini = openModal({
          title: 'New category',
          content: el('form', {
            onsubmit: async (ev) => {
              ev.preventDefault();
              if (!input.value.trim()) {
                input.focus();
                toast('Enter a category name', { icon: 'alert' });
                return;
              }
              const btn = ev.target.querySelector('button[type=submit]');
              btn.disabled = true;
              let cat;
              try {
                cat = await store.addCategory(input.value);
              } catch (err) {
                console.error(err);
                btn.disabled = false;
                toast('Couldn’t add the category. Check your connection', { icon: 'wifiOff' });
                return;   // leave the dialog up with the name still typed in
              }
              if (cat) categoryId = cat.id;
              mini.close();
              renderCatOptions();
            },
          },
            el('div.field', {}, input),
            el('button.btn.btn-primary.btn-block', { type: 'submit' }, 'Add category')
          ),
        });
        input.focus();
      } else {
        categoryId = e.target.value || null;
      }
    },
  });
  const renderCatOptions = () => {
    clear(catSelect);
    catSelect.append(
      el('option', { value: '', selected: !categoryId }, 'Uncategorized'),
      ...store.categories.map((c) => el('option', { value: c.id, selected: c.id === categoryId }, c.name)),
      el('option', { value: '__new' }, '+ New category…')
    );
  };
  renderCatOptions();

  let taxId = existing?.taxId ?? null;
  const defaultTax = store.tax(store.settings.defaultTaxId);
  const taxSelect = el('select.select', {
    'aria-label': 'Tax',
    onchange: (e) => { taxId = e.target.value === 'default' ? null : e.target.value; },
  },
    el('option', { value: 'default', selected: taxId === null },
      defaultTax ? `Default · ${defaultTax.name} ${defaultTax.rate}%` : 'Default · no tax'),
    ...store.taxes.map((t) => el('option', { value: t.id, selected: taxId === t.id }, `${t.name} · ${t.rate}%`)),
    el('option', { value: 'none', selected: taxId === 'none' }, 'Tax-free')
  );

  /* Photo: picked now, written to fs only after the product itself saves -
     a new product has no id to file it under until then. undefined means
     untouched; null means "remove"; a Blob is the new picture. */
  let pendingPhoto;
  let pendingPhotoUrl = null;
  const photoField = el('div.field');
  // Removing or replacing the picture rebuilds the row those buttons are in.
  function renderPhotoField() {
    keepFocus(photoField, paintPhotoField);
  }

  function paintPhotoField() {
    clear(photoField);
    const hasStored = !!existing?.photo && pendingPhoto === undefined;
    const hasNew = pendingPhoto instanceof Blob;
    const preview = el('span.photo-preview', {},
      hasNew ? el('img', { src: pendingPhotoUrl, alt: '' })
        : el('span', { html: icon('image', 20, 1.6) }));
    if (hasStored) {
      productPhotoUrl(existing)?.then((url) => {
        if (url && preview.isConnected && pendingPhoto === undefined) {
          preview.replaceChildren(el('img', { src: url, alt: '' }));
        }
      });
    }
    const pick = () => {
      // No `capture`: it would jump straight to the live camera on phones
      // and tablets, with no way to pick a photo the shop already has. The
      // picker's own sheet still offers the camera as one of the options.
      const input = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
      const done = () => input.remove();
      input.addEventListener('cancel', done, { once: true });
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        done();
        if (!file) return;
        let blob;
        try {
          blob = await photoBlob(file);
        } catch (err) {
          toast(err.message || 'Couldn’t read that image', { icon: 'alert', duration: 5000 });
          return;
        }
        if (pendingPhotoUrl) URL.revokeObjectURL(pendingPhotoUrl);
        pendingPhoto = blob;
        pendingPhotoUrl = URL.createObjectURL(blob);
        renderPhotoField();
      }, { once: true });
      document.body.append(input);
      input.click();
    };
    photoField.append(
      el('label.label', {}, 'Photo'),
      el('div.row', {},
        preview,
        el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: pick },
          hasStored || hasNew ? 'Replace' : 'Add photo'),
        (hasStored || hasNew) && el('button.btn.btn-ghost.btn-sm.btn-danger-ghost', {
          type: 'button',
          onclick: () => {
            if (pendingPhotoUrl) URL.revokeObjectURL(pendingPhotoUrl);
            pendingPhotoUrl = null;
            pendingPhoto = existing?.photo ? null : undefined;
            renderPhotoField();
          },
        }, 'Remove')),
      el('p.small.field-note', {},
        'Shown on the register tile and in the catalog; the tile color stands in wherever the photo is missing. Photos aren’t part of JSON backups.')
    );
  }
  renderPhotoField();

  let slot = existing?.slot || PRODUCT_SLOTS[(store.products.length) % PRODUCT_SLOTS.length];
  const slotRow = el('div.slot-row', { role: 'radiogroup', 'aria-label': 'Tile color' });
  const renderSlots = () => keepFocus(slotRow, () => {
    clear(slotRow);
    for (const s of PRODUCT_SLOTS) {
      slotRow.append(el('button.slot-swatch', {
        type: 'button',
        className: `slot-swatch slot-${s}${slot === s ? ' active' : ''}`,
        role: 'radio', 'aria-checked': slot === s ? 'true' : 'false', 'aria-label': `Color ${s}`,
        onclick: () => { slot = s; renderSlots(); },
      }, slot === s ? el('span', { html: icon('check', 14, 3) }) : null));
    }
  });
  renderSlots();

  /* Sold by: the each (default), or a measure - weight, volume, length.
     Measured products price per unit, take decimal quantities at the
     register, and have no option groups (a per-kilo delta has no honest
     meaning), so the options editor hides when measure is picked. */
  const UNITS = ['kg', 'g', 'lb', 'oz', 'L', 'm'];
  let soldBy = existing?.soldBy === 'measure' ? 'measure' : 'each';
  let unit = existing?.unit || UNITS[0];
  const soldBySeg = el('div.seg', { role: 'group', 'aria-label': 'Sold by' });
  const renderSoldBy = () => keepFocus(soldBySeg, () => {
    clear(soldBySeg);
    for (const [v, label] of [['each', 'Each'], ['measure', 'Weight / measure']]) {
      soldBySeg.append(el('button.seg-btn', {
        type: 'button',
        className: `seg-btn${soldBy === v ? ' active' : ''}`,
        'aria-pressed': soldBy === v ? 'true' : 'false',
        onclick: () => { soldBy = v; renderSoldBy(); syncSoldBy(); },
      }, label));
    }
  });
  renderSoldBy();

  const customUnit = !existing || UNITS.includes(unit) ? false : soldBy === 'measure';
  const unitText = el('input.input', {
    type: 'text', maxLength: 12, placeholder: 'e.g. yd',
    value: customUnit ? unit : '', 'aria-label': 'Custom unit',
    style: { display: customUnit ? '' : 'none' },
  });
  unitText.addEventListener('input', () => { unit = unitText.value.trim() || 'unit'; });
  const unitSelect = el('select.select', {
    'aria-label': 'Unit of measure',
    onchange: (e) => {
      const v = e.target.value;
      if (v === '__custom') {
        unitText.style.display = '';
        unit = unitText.value.trim() || 'unit';
        unitText.focus();
      } else {
        unitText.style.display = 'none';
        unit = v;
      }
    },
  },
    UNITS.map((u) => el('option', { value: u, selected: !customUnit && unit === u }, u)),
    el('option', { value: '__custom', selected: customUnit }, 'Other…')
  );
  const unitField = el('div.field', {},
    el('label.label', {}, 'Unit'),
    el('div.row', {}, el('div.select-wrap', {}, unitSelect), el('div.grow', {}, unitText)));

  const soldByField = el('div.field', {},
    el('label.label', {}, 'Sold by'),
    el('div.row', {}, soldBySeg),
    el('p.small.field-note', {},
      'By measure, the register asks for the amount: 0.735 kg at the price per kg.'));

  /* Option groups live in a dedicated editor - a menu's worth of sizes and
     add-ons needs room, and most products never open it. */
  let options = structuredClone(existing?.options || []);
  const optionsBtn = el('button.btn.btn-ghost.btn-block.options-btn', {
    type: 'button',
    onclick: () => openOptionsEditor(options, (next) => { options = next; renderOptionsBtn(); }),
  });
  const renderOptionsBtn = () => {
    clear(optionsBtn);
    const choices = options.reduce((a, g) => a + g.choices.length, 0);
    optionsBtn.append(
      el('span.options-btn-ic', { html: icon('sliders', 17, 1.9) }),
      el('span.options-btn-text', {},
        el('span.options-btn-title', {}, options.length ? groupSummary(options) : 'Add options'),
        el('span.options-btn-sub', {}, options.length
          ? `${plural(options.length, 'group')} · ${plural(choices, 'choice')}`
          : 'Sizes, milks, and extras that change the price')),
      el('span.options-btn-go', { html: icon('chevR', 16, 2) })
    );
  };
  renderOptionsBtn();

  const tracked = existing?.stock !== null && existing?.stock !== undefined;
  const trackToggle = el('input', {
    type: 'checkbox', id: 'track-stock',
    checked: tracked,
  });
  const stockInput = el('input.input', {
    type: 'text', inputmode: 'numeric',
    value: existing?.stock ?? '', placeholder: '0',
    'aria-label': 'Stock on hand',
  });
  // Whether the human actually retyped the count. The prefill is a snapshot
  // from when the form opened; the register keeps selling while it's open,
  // and only a deliberate entry may overwrite the live level.
  let stockEdited = false;
  stockInput.addEventListener('input', () => { stockEdited = true; });
  const stockLabel = el('label.label', {}, 'On hand');
  const lowInput = el('input.input', {
    type: 'text', inputmode: 'numeric',
    value: existing?.lowStock ?? '', placeholder: String(DEFAULT_LOW_STOCK),
    'aria-label': 'Low-stock alert threshold',
  });

  /* An existing tracked product adjusts its count through the ledger, and
     shows the last few movements - "why is this number wrong?" answered. */
  const movementsWrap = el('div.movement-list', { style: { marginTop: '10px' } });
  async function renderMovements() {
    clear(movementsWrap);
    let moves;
    try {
      moves = await store.stockMovementsFor(existing.id, { limit: 5 });
    } catch (err) {
      console.error(err);
      return;
    }
    if (!moves.length) {
      movementsWrap.append(el('p.small.muted', {}, 'No recorded movements yet. Sales, refunds, and adjustments land here.'));
      return;
    }
    for (const m of moves) {
      movementsWrap.append(el('div.movement-row', {},
        el('span.movement-time', {}, `${formatDay(todayISO(new Date(m.at)))} ${formatTime(m.at)}`),
        el('span.grow', {}, movementLabel(m)),
        el('span.movement-amount', {
          className: `movement-amount${m.delta < 0 ? ' out' : ''}`,
        }, `${m.delta > 0 ? '+' : '−'}${Math.abs(m.delta)}${m.unit ? ` ${m.unit}` : ''} → ${m.level}`)
      ));
    }
  }
  const stockExtras = existing && tracked
    ? el('div.field', {},
      el('button.btn.btn-ghost.btn-sm', {
        type: 'button', html: icon('package', 15, 2),
        onclick: () => openStockAdjust(store.product(existing.id) || existing, {
          onDone: () => {
            const live = store.product(existing.id);
            if (live) stockInput.value = String(live.stock ?? '');
            renderMovements();
          },
        }),
      }, ' Adjust stock…'),
      movementsWrap)
    : null;
  if (stockExtras) renderMovements();

  const stockField = el('div', {},
    el('div.form-grid', {},
      el('div.field', {}, stockLabel, stockInput),
      el('div.field', {}, el('label.label', {}, 'Low-stock alert at'), lowInput)
    ),
    stockExtras);
  const syncStock = () => { stockField.style.display = trackToggle.checked ? '' : 'none'; };
  trackToggle.addEventListener('change', syncStock);
  syncStock();

  /* Everything that changes when the product is sold by measure. */
  const priceLabel = el('label.label', {}, 'Price');
  const costLabel = el('label.label', {}, 'Cost');
  const optionsField = el('div.field', {}, el('label.label', {}, 'Options'), optionsBtn);
  const syncSoldBy = () => {
    const measured = soldBy === 'measure';
    unitField.style.display = measured ? '' : 'none';
    optionsField.style.display = measured ? 'none' : '';
    priceLabel.textContent = measured ? `Price per ${unit}` : 'Price';
    priceInput.setAttribute('aria-label', priceLabel.textContent);
    costLabel.textContent = measured ? `Cost per ${unit}` : 'Cost';
    costInput.setAttribute('aria-label', costLabel.textContent);
    renderMargin();
    stockLabel.textContent = measured ? `On hand (${unit})` : 'On hand';
    stockInput.inputMode = measured ? 'decimal' : 'numeric';
    lowInput.inputMode = measured ? 'decimal' : 'numeric';
  };
  unitSelect.addEventListener('change', syncSoldBy);
  unitText.addEventListener('input', syncSoldBy);
  syncSoldBy();

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const price = parseAmount(priceInput.value);
      // A name of nothing but spaces satisfies the browser's own `required`
      // check, so this is all that stands between it and a nameless product.
      // It used to hand the field back without a word, which on a tablet -
      // where the keyboard covers the field it just focused - is a Save
      // button that simply doesn't work.
      if (!nameInput.value.trim()) {
        nameInput.focus();
        toast('Give the product a name', { icon: 'alert' });
        return;
      }
      if (price === null) { priceInput.focus(); toast('Enter a valid price', { icon: 'alert' }); return; }
      // An empty cost field is a real answer - most shops keep no costs. A
      // figure that can't be read is not: stored as nothing, it would report
      // the product's whole price as margin and say nothing about it.
      const costText = String(costInput.value).trim();
      const cost = costText ? parseAmount(costText) : null;
      if (costText && cost === null) {
        costInput.focus();
        toast('Enter the cost as a plain number, or clear the field', { icon: 'alert' });
        return;
      }

      // A duplicate SKU makes barcode lookup ambiguous - say so, but let the
      // shopkeeper decide; they may be mid-way through renumbering.
      const clashes = skuClashes(skuInput.value, existing?.id);
      if (clashes.length) {
        const ok = await confirmDialog({
          title: 'SKU already in use',
          message: `${clashes.length === 1 ? `“${clashes[0].name}” uses` : `${clashes.length} other products use`} the SKU ${skuInput.value.trim()}. Scanning it will show a filtered list instead of ringing the item up.`,
          confirmLabel: 'Save anyway',
          danger: false,
        });
        if (!ok) { skuInput.focus(); return; }
      }

      // Not parseAmount: that's for money and refuses signs, and stock can
      // legitimately be negative (an oversell is recorded, never blocked).
      const stockText = String(stockInput.value).trim().replace(/,/g, '.');
      const typedStock = stockText === '' ? NaN : Number(stockText);
      // A tracked count that doesn't parse ('4o', a stray unit suffix, a
      // cleared field) is re-asked, never quietly written as zero.
      if (trackToggle.checked && stockText !== '' && !Number.isFinite(typedStock)) {
        stockInput.focus();
        toast('Enter a number for the stock on hand', { icon: 'alert' });
        return;
      }
      // The threshold gets the same treatment as the count beside it. A
      // figure that isn't a number (or a negative one) was stored as "no
      // threshold", so the product quietly went back to warning at the app
      // default and nothing said the typed figure had been thrown away.
      const lowText = String(lowInput.value).trim().replace(/,/g, '.');
      const typedLow = lowText === '' ? NaN : Number(lowText);
      if (trackToggle.checked && lowText !== '' && !(Number.isFinite(typedLow) && typedLow >= 0)) {
        lowInput.focus();
        toast('Enter a number for the low-stock alert', { icon: 'alert' });
        return;
      }
      const input = {
        name: nameInput.value, price, cost, categoryId, sku: skuInput.value,
        taxId, slot, options, soldBy, unit,
        // The stamp is managed by set/removeProductPhoto below; edits must
        // carry the current value through so a plain save can't drop it.
        photo: existing?.photo ?? null,
        trackStock: trackToggle.checked,
        // A count the human retyped is a recount and lands as typed. An
        // untouched (or emptied) field means "whatever it is now" - the
        // *live* level, not the prefill: a sale rung up while this form sat
        // open must not be put back on the shelf by saving a rename.
        stock: Number.isFinite(typedStock) && (stockEdited || !existing)
          ? typedStock
          : (existing ? (store.product(existing.id)?.stock ?? existing.stock) : 0),
        // Empty means "use the app default", which cleanProduct stores as null.
        lowStock: typedLow,
      };
      // Disabled while the write is out - a double-tap on a tablet must not
      // put the same product in the catalog twice.
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      let saved;
      try {
        saved = existing
          ? await store.updateProduct(existing.id, input)
          : await store.addProduct(input);
      } catch (err) {
        console.error(err);
        btn.disabled = false;
        toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
        return;
      }
      // The picture rides after the product: a photo that fails to upload
      // costs a retry from the form, never the sale of the product itself.
      if (saved && pendingPhoto instanceof Blob) {
        try {
          saved = await store.setProductPhoto(saved.id, pendingPhoto);
        } catch (err) {
          console.error(err);
          toast('Saved, but the photo couldn’t be uploaded. Try it again from the product.', { icon: 'alert', duration: 6000 });
        }
      } else if (saved && pendingPhoto === null && existing?.photo) {
        try {
          await store.removeProductPhoto(saved.id);
        } catch (err) {
          console.error(err);
        }
      }
      modal.close();
      toast(existing ? 'Product updated' : 'Product added');
      if (saved) onSaved?.(saved);
    },
  },
    el('div.field', {}, el('label.label', {}, 'Name'), nameInput),
    el('div.form-grid', {},
      el('div.field', {}, priceLabel, priceInput),
      el('div.field', {}, costLabel, costInput)
    ),
    marginNote,
    skuField,
    el('div.form-grid', {},
      soldByField,
      unitField
    ),
    el('div.form-grid', {},
      el('div.field', {}, el('label.label', {}, 'Category'), el('div.select-wrap', {}, catSelect)),
      el('div.field', {}, el('label.label', {}, 'Tax'), el('div.select-wrap', {}, taxSelect))
    ),
    el('div.field', {}, el('label.label', {}, 'Tile color'), slotRow),
    photoField,
    optionsField,
    el('div.field.check-field', {},
      trackToggle,
      el('label', { htmlFor: 'track-stock' }, 'Track stock for this product')
    ),
    stockField,
    el('div.row.form-actions', {},
      existing && el('button.btn.btn-ghost.btn-danger-ghost', {
        type: 'button',
        onclick: async () => {
          const ok = await confirmDialog({
            title: 'Delete product?',
            message: `“${existing.name}” is removed from the catalog. Past receipts keep it.`,
          });
          if (!ok) return;
          let undo;
          try {
            ({ undo } = await store.deleteProduct(existing.id));
          } catch (err) {
            console.error(err);
            toast('Couldn’t delete. Check your connection', { icon: 'wifiOff' });
            return;
          }
          modal.close();
          toast('Product deleted', {
            icon: 'trash',
            action: {
              label: 'Undo',
              onClick: () => undo().catch((err) => {
                console.error(err);
                toast('Couldn’t bring it back. Check your connection', { icon: 'wifiOff' });
              }),
            },
          });
        },
      }, 'Delete'),
      el('button.btn.btn-primary.grow', { type: 'submit' }, existing ? 'Save changes' : 'Add product')
    )
  );
  const modal = openModal({
    title: existing ? 'Edit product' : 'New product',
    content: form,
    // The preview URL pins the picked blob in memory; the form closing (save
    // or cancel) is the last moment anything can still show it.
    onClose: () => { if (pendingPhotoUrl) URL.revokeObjectURL(pendingPhotoUrl); },
  });
  if (prefill?.sku && !existing) nameInput.focus();
  return modal;
}

/**
 * Build a product's option groups: "Size — required, choose one: Small,
 * Medium +$0.50, Large +$1.00".
 *
 * Edits apply to a working copy and are handed back on Done, so backing out
 * leaves the product untouched. Empty groups and nameless choices are dropped
 * on the way out (the store enforces the same rule), which is what makes the
 * "add a blank row and type into it" flow safe.
 */
export function openOptionsEditor(initial, onDone) {
  const groups = structuredClone(initial || []);
  const body = el('div');

  // Every toggle, every "Add choice", every removal rebuilds the editor, so
  // focus follows the pressed control's replacement instead of falling to
  // <body> between edits.
  const render = () => keepFocus(body, paint);

  /** '+0.70' / '-0.40' / '' - a delta reads as the money it moves. */
  const showDelta = (d) => (d ? `${d > 0 ? '+' : ''}${d.toFixed(2)}` : '');

  const newGroup = () => ({
    id: uid(), name: '', required: true, multi: false,
    choices: [{ id: uid(), name: '', delta: 0 }],
  });

  /** Drop what a register could not ask about. */
  const usable = () => groups
    .map((g) => ({ ...g, choices: g.choices.filter((c) => String(c.name).trim()) }))
    .filter((g) => String(g.name).trim() && g.choices.length);

  function paint() {
    clear(body);

    if (!groups.length) {
      body.append(el('div.empty', { style: { padding: '18px 10px 10px' } },
        el('div.empty-icon', { html: icon('sliders', 24) }),
        el('h3', {}, 'No options yet'),
        el('p', {}, 'A group asks one question at checkout (“Size”, “Milk”, “Extras”), and each choice can change the price.')
      ));
    }

    for (const [gi, group] of groups.entries()) {
      const nameInput = el('input.input', {
        type: 'text', value: group.name, maxLength: 30, placeholder: 'e.g. Size',
        'aria-label': `Group ${gi + 1} name`,
      });
      nameInput.addEventListener('input', () => { group.name = nameInput.value; });

      const toggle = (label, on, onToggle) => el('button.chip', {
        type: 'button',
        className: `chip${on ? ' active' : ''}`,
        'aria-pressed': on ? 'true' : 'false',
        onclick: () => { onToggle(); render(); },
      }, label);

      const choiceRows = group.choices.map((choice, ci) => {
        const cName = el('input.input', {
          type: 'text', value: choice.name, maxLength: 30, placeholder: 'Choice',
          'aria-label': `Choice ${ci + 1} name`,
        });
        cName.addEventListener('input', () => { choice.name = cName.value; });
        const cDelta = el('input.input', {
          type: 'text', inputmode: 'decimal', value: showDelta(choice.delta),
          placeholder: '+0.00', 'aria-label': `Choice ${ci + 1} price difference`,
        });
        // Signed on purpose: "-0.40" is a smaller size that costs less. The
        // magnitude still goes through parseAmount, so a delta obeys the same
        // cap as every other typed amount - cent math must stay exact.
        cDelta.addEventListener('change', () => {
          const raw = String(cDelta.value).trim().replace(/,/g, '.').replace(/^\+/, '');
          const sign = raw.startsWith('-') ? -1 : 1;
          const magnitude = parseAmount(raw.replace(/^-/, ''));
          choice.delta = magnitude ? sign * magnitude : 0;
          cDelta.value = showDelta(choice.delta);
        });
        return el('div.row.opt-choice-row', {},
          el('div.grow', {}, cName),
          el('div.opt-delta', {}, cDelta),
          el('button.icon-btn', {
            type: 'button', html: icon('x', 16, 2),
            'aria-label': `Remove choice ${ci + 1}`,
            disabled: group.choices.length <= 1,
            onclick: () => { group.choices.splice(ci, 1); render(); },
          })
        );
      });

      body.append(el('section.opt-editor-group', {},
        el('div.row', {},
          el('div.grow', {}, nameInput),
          el('button.icon-btn', {
            type: 'button', html: icon('trash', 17, 2),
            'aria-label': `Remove ${group.name || `group ${gi + 1}`}`,
            onclick: () => { groups.splice(gi, 1); render(); },
          })
        ),
        el('div.chip-row', {},
          toggle('Required', group.required, () => { group.required = !group.required; }),
          toggle('Choose several', group.multi, () => { group.multi = !group.multi; })
        ),
        ...choiceRows,
        el('button.btn.btn-ghost.btn-sm', {
          type: 'button', html: icon('plus', 14, 2.2),
          onclick: () => { group.choices.push({ id: uid(), name: '', delta: 0 }); render(); },
        }, ' Add choice')
      ));
    }

    body.append(
      el('button.btn.btn-ghost.btn-block', {
        type: 'button', html: icon('plus', 16, 2.2), style: { marginTop: '4px' },
        onclick: () => { groups.push(newGroup()); render(); },
      }, ' Add option group'),
      el('button.btn.btn-primary.btn-block', {
        type: 'button', style: { marginTop: '10px' },
        onclick: () => { onDone(usable()); modal.close(); },
      }, 'Done')
    );
  }

  const modal = openModal({ title: 'Options', content: body, wide: true });
  render();
  return modal;
}

export function openCategoryManager() {
  const body = el('div');
  const modal = openModal({ title: 'Categories', content: body });

  // Rejected writes are rolled back in the store, so the change never happened
  // anywhere - re-render from what the store actually holds, and say so.
  const failed = (err) => {
    console.error(err);
    render();
    toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
  };

  function render() {
    clear(body);
    const rows = store.categories.map((c) => {
      const input = el('input.input.cat-input', { type: 'text', value: c.name, 'aria-label': `Rename ${c.name}` });
      input.addEventListener('change', () => {
        // The store refuses a nameless category, quietly - so clearing the
        // box left it empty on screen while the category kept the name it
        // always had, and the next tap on the register showed a chip the
        // manager thought they had just renamed away. Put the name back and
        // say why it wouldn't take.
        if (!input.value.trim()) {
          input.value = c.name;
          toast('A category needs a name', { icon: 'alert' });
          input.focus();
          return;
        }
        store.renameCategory(c.id, input.value).catch(failed);
      });
      return el('div.row.cat-row', {},
        el('div.grow', {}, input),
        el('button.icon-btn', {
          html: icon('trash', 17, 2), 'aria-label': `Delete ${c.name}`,
          onclick: async () => {
            const ok = await confirmDialog({
              title: 'Delete category?',
              message: `Products in “${c.name}” become uncategorized.`,
            });
            if (!ok) return;
            try {
              await store.deleteCategory(c.id);
            } catch (err) {
              failed(err);
              return;
            }
            render();
          },
        })
      );
    });
    const newInput = el('input.input', { type: 'text', placeholder: 'New category', 'aria-label': 'New category name' });
    body.append(
      ...(rows.length ? rows : [el('p.muted.small', { style: { marginBottom: '12px' } }, 'No categories yet. They become filter chips on the register.')]),
      el('form.row', {
        onsubmit: async (e) => {
          e.preventDefault();
          if (!newInput.value.trim()) {
            newInput.focus();
            toast('Enter a category name', { icon: 'alert' });
            return;
          }
          const btn = e.target.querySelector('button[type=submit]');
          btn.disabled = true;
          try {
            await store.addCategory(newInput.value);
          } catch (err) {
            btn.disabled = false;
            failed(err);
            return;
          }
          render();
        },
      },
        el('div.grow', {}, newInput),
        el('button.btn.btn-primary', { type: 'submit' }, 'Add')
      )
    );
  }
  render();
  return modal;
}

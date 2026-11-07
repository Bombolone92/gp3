import { el, clear, append, keepFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { store, cleanRegistrations, cleanQuickNotes, STORE_TEXT_MAX } from '../lib/store.js';
import { CURRENCIES, parseAmount, parseRate, formatMoney, discountTypeChoices } from '../lib/money.js';
import { logoDataUrl } from '../ui/image.js';
import { validPin, makePinRecord } from '../lib/pin.js';
import { requirePin, pinUnlocked, grantPinGrace, relockPin } from '../ui/pin-gate.js';
import { applyTheme, currentTheme } from '../ui/theme.js';
import { isPuterApp } from '../lib/env.js';
import { todayISO, formatMonth, formatDay, formatDayFull, formatTime } from '../lib/dates.js';
import { readBackupFile, BackupError, summarizeBackup } from '../lib/backup.js';
import {
  SNAPSHOT_REASONS, formatBytes, snapshotHolds, KEEP_RECENT, KEEP_WEEKS,
} from '../lib/snapshots.js';
import { plural } from '../lib/util.js';
import { loyaltyScheme, LOYALTY_MONTHS } from '../lib/loyalty.js';
import {
  printerSupport, printerConfig, setPrinterConfig, choosePrinter,
  kickDrawer, testDoc, printDocBytes, TRANSPORTS, PAPER_WIDTHS, PrinterError,
} from '../lib/printer.js';
import { downloadBlob } from '../ui/download.js';
import { openCsvExport } from '../ui/csv-export.js';
import { openProductImport, exportCatalogCsv } from '../ui/product-import.js';

export async function confirmSignOut() {
  // "Your data is safe in your account" is not yet true of sales still in
  // the offline outbox - those exist only on this device until they sync.
  const pending = store.pendingSync;
  const ok = await confirmDialog({
    title: 'Sign out?',
    message: pending
      ? `${plural(pending, 'sale hasn’t', 'sales haven’t')} reached your cloud yet. `
        + 'They stay saved on this device and finish syncing after you sign back in with this account here; '
        + 'you can also wait for the sync bar to clear before signing out.'
      : 'Your data stays safe in your Puter account and is here when you sign back in.',
    confirmLabel: 'Sign out',
    danger: pending > 0,
  });
  if (!ok) return;
  // The offline-boot snapshot holds the whole store - catalog, customers,
  // the PIN record - and must not outlive the account that wrote it. (The
  // outbox stays: it is account-scoped, and queued sales finish syncing
  // when this account signs back in.)
  store.clearBootCache();
  puter.auth.signOut();
  location.reload();
}

/**
 * Settings itself sits behind the PIN when one is set: it's where the PIN,
 * the dataset, and the money rules live. The gate prompts on arrival, and
 * a dismissal leaves an honest locked screen rather than a blank page.
 */
export function settingsView() {
  const wrap = el('div');
  let inner = null;
  const mount = () => {
    inner?.destroy?.();
    clear(wrap);
    inner = buildSettings();
    wrap.append(inner.node);
  };
  if (pinUnlocked()) {
    mount();
  } else {
    // The PIN prompt resolves long after this function returned. If the
    // route changed in the meantime, the view is detached - mounting into
    // it would register a store listener nothing will ever remove (the
    // shell's destroy() reaches the *current* view, not this one).
    const tryUnlock = () => requirePin('open Settings').then((ok) => { if (ok && wrap.isConnected) mount(); });
    clear(wrap);
    wrap.append(el('div.view', {},
      el('header.view-head', {}, el('div', {}, el('h1.view-title', {}, 'Settings'))),
      el('div.empty', {},
        el('div.empty-icon', { html: icon('lock', 28) }),
        el('h3', {}, 'Locked'),
        el('p', {}, 'Settings ask for the manager PIN.'),
        el('button.btn.btn-primary', { onclick: tryUnlock }, 'Unlock')
      )
    ));
    tryUnlock();
  }

  /**
   * A wholesale dataset replacement rewrites the very settings these controls
   * were built from - and it can be started from the sample banner sitting
   * directly above this page. The tax and preset lists follow the store's
   * change event, but the store name, address, footer, registrations, logo,
   * currency and the tax-inclusive and tips toggles are snapshots taken when
   * the page was built: after a wipe they went on showing the old shop next
   * to an emptied tax list, and blurring a field nobody had touched wrote
   * that stale value straight back over the fresh one.
   */
  const onReplace = () => { if (inner && wrap.isConnected) mount(); };
  store.addEventListener('replace', onReplace);

  return {
    node: wrap,
    destroy: () => {
      store.removeEventListener('replace', onReplace);
      inner?.destroy?.();
    },
  };
}

function buildSettings() {
  const money = (n) => formatMoney(n, store.settings.currency);

  /**
   * A rejected write has already been rolled back in the store, so the change
   * is not saved anywhere - saying nothing would leave the shopkeeper believing
   * a rate or a currency had been set. `after` re-renders the control that was
   * touched, since it is showing the value that just went away.
   */
  const saved = (promise, after = null) => promise
    .then(() => toast('Saved'))
    .catch((err) => {
      console.error(err);
      after?.();
      toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
    });

  /* ---------- Store details ---------- */

  function textSetting(label, key, placeholder, { multi = false } = {}) {
    // Capped from STORE_TEXT_MAX, the one place those ceilings live: a
    // restored backup is held to the same figure this field is, so the two
    // can't drift apart.
    // textarea.type is a read-only property, so only inputs get `type`.
    const maxLength = STORE_TEXT_MAX[key] ?? 60;
    const input = multi
      ? el('textarea.input', { value: store.settings[key] || '', placeholder, rows: 2, maxLength, 'aria-label': label })
      : el('input.input', { type: 'text', value: store.settings[key] || '', placeholder, maxLength, 'aria-label': label });
    input.addEventListener('change', () => {
      saved(store.updateSettings({ [key]: input.value.trim() }),
        () => { input.value = store.settings[key] || ''; });
    });
    return el('div.field', {}, el('label.label', {}, label), input);
  }

  /* Registration numbers: label + number pairs printed under the address.
     Two rows, saved together on any change; a row without a number is not a
     registration and quietly drops out. */
  function registrationRows() {
    const stored = (i) => cleanRegistrations(store.settings.registrations)[i] || { label: '', number: '' };
    const rows = [0, 1].map((i) => {
      const labelInput = el('input.input', {
        type: 'text', value: stored(i).label, maxLength: 40,
        placeholder: i === 0 ? 'e.g. VAT No.' : 'Label',
        'aria-label': `Registration ${i + 1} label`,
      });
      const numberInput = el('input.input', {
        type: 'text', value: stored(i).number, maxLength: 60,
        placeholder: 'Number as it should print',
        'aria-label': `Registration ${i + 1} number`,
      });
      return { labelInput, numberInput };
    });
    const restore = () => rows.forEach((row, i) => {
      row.labelInput.value = stored(i).label;
      row.numberInput.value = stored(i).number;
    });
    const commit = () => {
      const registrations = cleanRegistrations(rows.map((row) => ({
        label: row.labelInput.value, number: row.numberInput.value,
      })));
      saved(store.updateSettings({ registrations }), restore);
    };
    for (const row of rows) {
      row.labelInput.addEventListener('change', commit);
      row.numberInput.addEventListener('change', commit);
    }
    return el('div.field', {},
      el('label.label', {}, 'Registration numbers'),
      ...rows.map((row) => el('div.row', { style: { marginBottom: '8px' } },
        el('div', { style: { width: '140px' } }, row.labelInput),
        el('div.grow', {}, row.numberInput))),
      el('p.small.muted', {},
        'A tax or registration number receipts must carry: “VAT No.”, “ABN”, “Steuernummer”. Printed under the address.')
    );
  }

  /* Logo: picked, downscaled client-side, stored inline with the settings. */
  const logoField = el('div.field');
  // Add / Replace / Remove all rebuild the row they sit in.
  function renderLogoField() {
    keepFocus(logoField, paintLogoField);
  }

  function paintLogoField() {
    clear(logoField);
    const logo = store.settings.logo;
    const pick = () => {
      const input = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
      const done = () => input.remove();
      input.addEventListener('cancel', done, { once: true });
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        done();
        if (!file) return;
        let dataUrl;
        try {
          dataUrl = await logoDataUrl(file);
        } catch (err) {
          toast(err.message || 'Couldn’t read that image', { icon: 'alert', duration: 5000 });
          return;
        }
        saved(store.updateSettings({ logo: dataUrl }), renderLogoField).then(renderLogoField);
      }, { once: true });
      document.body.append(input);
      input.click();
    };
    logoField.append(
      el('label.label', {}, 'Logo'),
      el('div.row', {},
        logo
          ? el('img.logo-preview', { src: logo, alt: 'Receipt logo' })
          : el('span.logo-preview.logo-empty', { html: icon('image', 20, 1.6) }),
        el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: pick },
          logo ? 'Replace' : 'Add logo'),
        logo && el('button.btn.btn-ghost.btn-sm.btn-danger-ghost', {
          type: 'button',
          onclick: () => saved(store.updateSettings({ logo: null }), renderLogoField).then(renderLogoField),
        }, 'Remove')
      ),
      el('p.small.muted', { style: { marginTop: '6px' } },
        'Printed at the top of receipts and on the customer’s shared copy. Small and simple prints best; it’s downscaled and stored with your settings.')
    );
  }
  renderLogoField();

  const storeCard = el('section.card', { 'aria-label': 'Store details' },
    el('div.card-head', {}, el('h2.card-title', {}, 'Store')),
    textSetting('Store name', 'storeName', 'Shown on receipts and in the sidebar'),
    textSetting('Address', 'address', 'Optional, printed on receipts', { multi: true }),
    textSetting('Receipt footer', 'receiptFooter', 'A thank-you line at the bottom of receipts'),
    registrationRows(),
    logoField,
    el('div.field', {},
      el('label.label', {}, 'Currency'),
      el('div.select-wrap', {}, el('select.select', {
        'aria-label': 'Currency',
        onchange: (e) => {
          const select = e.currentTarget;
          saved(store.updateSettings({ currency: select.value }),
            () => { select.value = store.settings.currency; });
        },
      }, CURRENCIES.map((c) => el('option', {
        value: c.code, selected: c.code === store.settings.currency,
      }, `${c.code} · ${c.name}`)))),
      el('p.small.muted', {}, 'Changes how new sales are recorded and shown. Past receipts keep their currency.')
    )
  );

  /* ---------- Appearance ---------- */

  const themeSeg = el('div.seg.seg-block', { role: 'group', 'aria-label': 'Theme' });
  function renderThemeSeg() {
    clear(themeSeg);
    // What this device is actually wearing (the stamp applyTheme sets), not
    // the pre-write settings value: reading the store here marked the OLD
    // theme active until the view was rebuilt, because the re-render runs
    // before the settings write and nothing repaints the control after it.
    const current = currentTheme();
    for (const [v, label, ic] of [['light', 'Light', 'sun'], ['system', 'System', 'monitor'], ['dark', 'Dark', 'moon']]) {
      themeSeg.append(el('button.seg-btn', {
        type: 'button',
        className: `seg-btn${current === v ? ' active' : ''}`,
        'aria-pressed': current === v ? 'true' : 'false',
        html: icon(ic, 15, 2),
        onclick: () => {
          applyTheme(v);
          renderThemeSeg();
          // The pressed button was just rebuilt; keep keyboard focus on it.
          themeSeg.querySelector('.seg-btn.active')?.focus();
          // The theme also lives in localStorage, so it holds on this device
          // whatever the cloud says; only the sync across devices is missed.
          store.updateSettings({ theme: v }).catch((err) => console.error(err));
        },
      }, ` ${label}`));
    }
  }
  renderThemeSeg();

  const appearanceCard = el('section.card', { 'aria-label': 'Appearance' },
    el('div.card-head', {}, el('h2.card-title', {}, 'Appearance')),
    themeSeg
  );

  /* ---------- Taxes ---------- */

  const taxList = el('div');
  // Making a rate the default (or deleting one) rebuilds this list from the
  // store's change event, taking the pressed button with it - focus goes to
  // its replacement instead of to <body>. Same for the preset list below.
  function renderTaxes() {
    keepFocus(taxList, paintTaxes);
  }

  function paintTaxes() {
    clear(taxList);
    if (!store.taxes.length) {
      taxList.append(el('p.small.muted', { style: { marginBottom: '12px' } },
        'No tax rates yet. Without one, sales are recorded tax-free.'));
    }
    for (const t of store.taxes) {
      const isDefault = store.settings.defaultTaxId === t.id;
      taxList.append(el('div.row.setting-row', {},
        el('button.default-pick', {
          type: 'button',
          className: `default-pick${isDefault ? ' active' : ''}`,
          'aria-pressed': isDefault ? 'true' : 'false',
          title: isDefault ? 'Default rate' : 'Make default',
          html: icon(isDefault ? 'circleCheck' : 'check', 16, 2),
          onclick: () => saved(store.updateSettings({ defaultTaxId: t.id })),
        }),
        el('div.grow', {},
          el('div.card-title', {}, `${t.name} · ${t.rate}%`),
          isDefault && el('div.card-sub', {}, 'Default for new products')),
        el('button.icon-btn', {
          html: icon('pencil', 16, 2), 'aria-label': `Edit ${t.name}`,
          onclick: () => openTaxForm(t),
        }),
        el('button.icon-btn', {
          html: icon('trash', 16, 2), 'aria-label': `Delete ${t.name}`,
          onclick: async () => {
            const ok = await confirmDialog({
              title: 'Delete tax rate?',
              message: `Products using “${t.name}” fall back to the default rate. Past receipts are unchanged.`,
            });
            if (ok) saved(store.deleteTax(t.id));
          },
        })
      ));
    }
  }

  function openTaxForm(existing = null) {
    // The visible .label sits beside the field, so it names nothing for a
    // screen reader; both carry their own, like the rest of the app's inputs.
    const nameInput = el('input.input', { type: 'text', value: existing?.name || '', placeholder: 'e.g. Sales tax', maxLength: 40, 'aria-label': 'Tax name' });
    const rateInput = el('input.input', { type: 'text', inputmode: 'decimal', value: existing?.rate ?? '', placeholder: '0', 'aria-label': 'Rate percent' });
    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const rate = parseRate(rateInput.value);
        if (rate === null) {
          toast('Enter a rate between 0 and 100', { icon: 'alert' });
          rateInput.focus();
          return;
        }
        // A double-tap must not create the same rate twice.
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          if (existing) await store.updateTax(existing.id, { name: nameInput.value, rate });
          else await store.addTax({ name: nameInput.value, rate });
        } catch {
          btn.disabled = false;
          toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
          return;
        }
        modal.close();
      },
    },
      el('div.form-grid', {},
        el('div.field', {}, el('label.label', {}, 'Name'), nameInput),
        el('div.field', {}, el('label.label', {}, 'Rate %'), rateInput)
      ),
      el('button.btn.btn-primary.btn-block', { type: 'submit' }, existing ? 'Save changes' : 'Add tax rate')
    );
    const modal = openModal({ title: existing ? 'Edit tax rate' : 'New tax rate', content: form });
  }

  const inclToggle = el('input', { type: 'checkbox', id: 'incl-tax', checked: !!store.settings.pricesIncludeTax });
  inclToggle.addEventListener('change', () => {
    // Whether prices carry tax changes every total on the register, so a
    // failed write has to take the tick back with it.
    saved(store.updateSettings({ pricesIncludeTax: inclToggle.checked }),
      () => { inclToggle.checked = !!store.settings.pricesIncludeTax; });
  });

  const taxCard = el('section.card', { 'aria-label': 'Taxes' },
    el('div.card-head', {},
      el('h2.card-title', {}, 'Taxes'),
      el('button.btn.btn-ghost.btn-sm', { html: icon('plus', 14, 2.2), onclick: () => openTaxForm() }, ' Add rate')),
    taxList,
    el('div.field.check-field', { style: { marginTop: '4px' } },
      inclToggle,
      el('label', { htmlFor: 'incl-tax' }, 'Prices include tax (tax is shown as a portion of the price, not added on top)')
    )
  );

  /* ---------- Discount presets ---------- */

  const discList = el('div');
  function renderDiscounts() {
    keepFocus(discList, paintDiscounts);
  }

  function paintDiscounts() {
    clear(discList);
    if (!store.discounts.length) {
      discList.append(el('p.small.muted', { style: { marginBottom: '12px' } },
        'Presets show up as one-tap chips at checkout.'));
    }
    for (const d of store.discounts) {
      discList.append(el('div.row.setting-row', {},
        el('span.disc-ic', { html: icon('badgePercent', 17, 1.8) }),
        el('div.grow', {}, el('div.card-title', {},
          `${d.name} · ${d.type === 'percent' ? `${d.value}%` : money(d.value)}`)),
        el('button.icon-btn', {
          html: icon('trash', 16, 2), 'aria-label': `Delete ${d.name}`,
          onclick: () => saved(store.deleteDiscount(d.id)),
        })
      ));
    }
  }

  function openDiscountForm() {
    const nameInput = el('input.input', { type: 'text', placeholder: 'e.g. Staff', maxLength: 40, 'aria-label': 'Preset name' });
    const valueInput = el('input.input', { type: 'text', inputmode: 'decimal', placeholder: '0', 'aria-label': 'Discount value' });
    let type = 'percent';
    const typeSeg = el('div.seg', { role: 'group', 'aria-label': 'Discount type' });
    const renderSeg = () => keepFocus(typeSeg, () => {
      clear(typeSeg);
      for (const { value, label, name } of discountTypeChoices(store.settings.currency)) {
        typeSeg.append(el('button.seg-btn', {
          type: 'button',
          className: `seg-btn${type === value ? ' active' : ''}`,
          'aria-pressed': type === value ? 'true' : 'false',
          'aria-label': name,
          onclick: () => { type = value; renderSeg(); },
        }, label));
      }
    });
    renderSeg();
    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const value = parseAmount(valueInput.value);
        // Same as everywhere else a figure is typed: say why the form didn't
        // move, rather than let Add look broken.
        if (!value) {
          toast('Enter the value as a plain number above zero', { icon: 'alert' });
          valueInput.focus();
          return;
        }
        // A double-tap must not create the same preset twice.
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          await store.addDiscount({ name: nameInput.value, type, value });
        } catch {
          btn.disabled = false;
          toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
          return;
        }
        modal.close();
      },
    },
      el('div.field', {}, el('label.label', {}, 'Name'), nameInput),
      el('div.field', {},
        el('label.label', {}, 'Value'),
        el('div.row', {}, typeSeg, el('div.grow', {}, valueInput))),
      el('button.btn.btn-primary.btn-block', { type: 'submit' }, 'Add preset')
    );
    const modal = openModal({ title: 'New discount preset', content: form });
    nameInput.focus();
  }

  const discCard = el('section.card', { 'aria-label': 'Discount presets' },
    el('div.card-head', {},
      el('h2.card-title', {}, 'Discount presets'),
      el('button.btn.btn-ghost.btn-sm', { html: icon('plus', 14, 2.2), onclick: openDiscountForm }, ' Add preset')),
    discList
  );

  /* ---------- Tips ---------- */

  const tipToggle = el('input', { type: 'checkbox', id: 'tips-on', checked: !!store.settings.tipsEnabled });
  tipToggle.addEventListener('change', () => {
    saved(store.updateSettings({ tipsEnabled: tipToggle.checked }),
      () => { tipToggle.checked = !!store.settings.tipsEnabled; });
  });

  const tipsCard = el('section.card', { 'aria-label': 'Tips' },
    el('div.card-head', {}, el('h2.card-title', {}, 'Tips')),
    el('div.field.check-field', {},
      tipToggle,
      el('label', { htmlFor: 'tips-on' }, 'Record tips at payment')
    ),
    el('p.small.muted', { style: { marginTop: '4px' } },
      'A typed tip on a card payment, or one tap to keep the change on a cash overpay. '
      + 'Tips ride on the payment, never in sales totals or tax, and report by method; '
      + 'a cash tip kept in the drawer counts toward expected cash at day close.')
  );

  /* ---------- Manager PIN ---------- */

  const pinBody = el('div');

  function openPinForm(existingChange = false) {
    const pinInput = el('input.input', {
      type: 'password', inputmode: 'numeric', maxLength: 6, autocomplete: 'off',
      placeholder: '4–6 digits', 'aria-label': 'New PIN',
    });
    const confirmInput = el('input.input', {
      type: 'password', inputmode: 'numeric', maxLength: 6, autocomplete: 'off',
      placeholder: 'Repeat it', 'aria-label': 'Confirm PIN',
    });
    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!validPin(pinInput.value)) {
          toast('The PIN must be 4–6 digits', { icon: 'alert' });
          pinInput.focus();
          return;
        }
        if (pinInput.value !== confirmInput.value) {
          toast('The two entries don’t match', { icon: 'alert' });
          confirmInput.focus();
          return;
        }
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true;
        // Hashing can fail too (crypto.subtle only exists in secure
        // contexts) - it must re-enable the form, not strand it disabled.
        let record;
        try {
          record = await makePinRecord(pinInput.value);
        } catch (err) {
          console.error(err);
          btn.disabled = false;
          toast('This browser couldn’t secure the PIN', { icon: 'alert' });
          return;
        }
        try {
          await store.updateSettings({ pin: record });
        } catch (err) {
          console.error(err);
          btn.disabled = false;
          toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
          return;
        }
        // Whoever just typed the PIN twice doesn't need it a third time.
        grantPinGrace();
        modal.close();
        renderPinCard();
        toast(existingChange ? 'PIN changed' : 'Manager PIN set', { icon: 'lock' });
      },
    },
      el('p.small.muted', { style: { marginBottom: '14px' } },
        'Asked for on refunds, voids, cash in/out, day close, exports, and Settings. Selling never asks.'),
      el('div.form-grid', {},
        el('div.field', {}, el('label.label', {}, 'New PIN'), pinInput),
        el('div.field', {}, el('label.label', {}, 'Confirm'), confirmInput)
      ),
      el('button.btn.btn-primary.btn-block', { type: 'submit' }, existingChange ? 'Change PIN' : 'Set PIN')
    );
    const modal = openModal({ title: existingChange ? 'Change manager PIN' : 'Set a manager PIN', content: form });
    pinInput.focus();
  }

  // Setting, changing, or removing the PIN rebuilds the card's own buttons.
  function renderPinCard() {
    keepFocus(pinBody, paintPinCard);
  }

  function paintPinCard() {
    clear(pinBody);
    const has = !!store.settings.pin?.hash;
    // append() (not pinBody.append) so the recovery note drops out with no
    // PIN set, instead of stringifying under the button that sets one.
    append(pinBody, [
      el('p.small.muted', { style: { marginBottom: '12px' } },
        has
          ? 'On. Refunds, voids, cash in/out, day close, exports, and Settings ask for the PIN; a correct entry holds for 5 minutes. Selling, holds, and browsing receipts stay open.'
          : 'Lock refunds, voids, cash in/out, day close, exports, and Settings behind a 4–6 digit code. Selling stays fast and open.'),
      el('div.row.wrap', {},
        has
          ? [
            el('button.btn.btn-ghost', {
              onclick: async () => { if (await requirePin('change the PIN')) openPinForm(true); },
            }, 'Change PIN'),
            el('button.btn.btn-ghost.btn-danger-ghost', {
              onclick: async () => {
                if (!(await requirePin('remove the PIN'))) return;
                try {
                  await store.updateSettings({ pin: null });
                } catch (err) {
                  console.error(err);
                  toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
                  return;
                }
                relockPin();
                renderPinCard();
                toast('PIN removed', { icon: 'lock' });
              },
            }, 'Remove PIN'),
          ]
          : el('button.btn.btn-ghost', {
            html: icon('lock', 16, 2), onclick: () => openPinForm(false),
          }, ' Set a manager PIN')),
      has && el('p.small.muted', { style: { marginTop: '12px' } },
        'Forgot it? Signing out and back in with your Puter account removes the PIN. The account is the real authority; this is a counter-height barrier, not a vault.'),
    ]);
  }
  renderPinCard();

  const pinCard = el('section.card', { 'aria-label': 'Manager PIN' },
    el('div.card-head', {}, el('h2.card-title', {}, 'Manager PIN')),
    pinBody
  );

  /* ---------- Data & session ---------- */

  async function downloadExport() {
    const data = await store.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `point-of-sale-${todayISO()}.json`);
  }

  async function exportData(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await downloadExport();
      toast('Export downloaded', { icon: 'fileDown' });
    } catch (err) {
      console.error(err);
      toast('Couldn’t export. Check your connection', { icon: 'wifiOff' });
    }
    btn.disabled = false;
  }

  /* Restore: pick a file, validate it, preview it, then replace everything. */

  function pickBackup() {
    const input = el('input', {
      type: 'file', accept: 'application/json,.json', style: { display: 'none' },
    });
    const done = () => input.remove();
    input.addEventListener('cancel', done, { once: true });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      done();
      if (!file) return;
      try {
        const { data, summary } = await readBackupFile(file);
        openRestorePreview(file, data, summary);
      } catch (err) {
        if (err instanceof BackupError) {
          toast(err.message, { icon: 'alert', duration: 6000 });
        } else {
          console.error(err);
          toast('Couldn’t read that file', { icon: 'alert' });
        }
      }
    }, { once: true });
    document.body.append(input);
    input.click();
  }

  function monthSpan(months) {
    if (!months.length) return null;
    const first = formatMonth(months[0]);
    const last = formatMonth(months[months.length - 1]);
    return first === last ? first : `${first} – ${last}`;
  }

  function openRestorePreview(file, data, sum) {
    const row = (label, value) => el('div.kv-row', {},
      el('span', {}, label), el('span.kv-value', {}, value));
    /**
     * Dismissal is refused while the replacement is out, exactly as the
     * payment, hold and refund sheets refuse it. This is the one write that
     * rewrites the whole account: an Escape that looked like a cancel would
     * leave it finishing behind a Settings page the shopkeeper is free to
     * navigate away from, or to start a second restore from.
     */
    let restoring = false;

    const span = monthSpan(sum.months);
    const salesText = sum.receipts
      ? `${plural(sum.receipts, 'receipt')} · ${plural(sum.months.length, 'month')}`
      : 'None';

    // What restoring costs *here* - an empty account has nothing to warn about.
    // Months still waiting to sync count: a restore discards them too. So do
    // customers: a directory-only account is not one where "nothing" is lost.
    const held = store.monthsWithSales().length;
    const empty = !store.products.length && !held && !store.customers.length;
    const losingParts = [
      store.products.length ? plural(store.products.length, 'product') : null,
      store.customers.length ? plural(store.customers.length, 'customer') : null,
      held ? `${plural(held, 'month')} of sales` : null,
    ].filter(Boolean);
    const losing = losingParts.length > 1
      ? `${losingParts.slice(0, -1).join(', ')} and ${losingParts[losingParts.length - 1]}`
      : losingParts[0];

    const body = el('div', {},
      el('p.small.muted', { style: { marginBottom: '14px' } },
        el('strong', {}, file.name), ` · ${formatBytes(file.size)}`),
      el('div.kv-list', { style: { marginBottom: '16px' } },
        row('Store', sum.storeName || 'Unnamed store'),
        row('Currency', sum.currency),
        row('Products', String(sum.products)),
        row('Categories', String(sum.categories)),
        row('Tax rates', String(sum.taxes)),
        row('Discount presets', String(sum.discounts)),
        sum.customers > 0 && row('Customers', String(sum.customers)),
        sum.creditEntries > 0 && row('Store credit entries', String(sum.creditEntries)),
        row('Sales', salesText),
        sum.drawerDays > 0 && row('Drawer days', String(sum.drawerDays)),
        sum.stockMoves > 0 && row('Stock movements', String(sum.stockMoves)),
        sum.stocktakes > 0 && row('Stocktakes', String(sum.stocktakes)),
        span && row('Covering', span),
        sum.exportedAt && row('Exported', formatDayFull(todayISO(new Date(sum.exportedAt)))),
        sum.nextReceipt && row('Next receipt', `#${sum.nextReceipt}`)
      ),
      sum.sampleData && el('p.small.muted', { style: { marginBottom: '14px' } },
        'This backup was taken while sample data was loaded, so the sample banner comes back with it.'),
      sum.photos > 0 && el('p.small.muted', { style: { marginBottom: '14px' } },
        `Product photos aren’t inside a JSON backup (${plural(sum.photos, 'product has one', 'products have them')}). `
        + 'Photos already in this account’s files keep working; on a different account, tiles fall back to their colors.'),
      empty
        ? el('div.callout.callout-accent', {},
          el('span.callout-ic', { html: icon('circleCheck', 16, 2) }),
          el('span', {}, 'This account has no products, customers, or sales yet, so nothing is overwritten.'))
        : el('div.callout.callout-danger', {},
          el('span.callout-ic', { html: icon('alert', 16, 2) }),
          el('span', {},
            el('strong', {}, 'This replaces everything in this account'), ': ',
            `${losing} are removed and cannot be recovered.`)),
      el('div.row.form-actions', {},
        el('button.btn.btn-ghost', {
          type: 'button', html: icon('fileDown', 16, 2),
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              await downloadExport();
              toast('Current data downloaded', { icon: 'fileDown' });
            } catch (err) {
              console.error(err);
              toast('Couldn’t export. Check your connection', { icon: 'wifiOff' });
            }
            btn.disabled = false;
          },
        }, ' Back up current data'),
        el('button.btn.btn-danger.grow', {
          type: 'button',
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            restoring = true;
            try {
              await store.importAll(data);
            } catch (err) {
              console.error(err);
              restoring = false;
              btn.disabled = false;
              // Not "nothing was changed": a restore writes the data files,
              // then the indexes that name them, then the collections, then
              // the settings, and a failure part-way through leaves the
              // account somewhere along that line. Running it again is the
              // way out - it replaces everything from the top.
              toast('Couldn’t finish restoring. Check your connection and run it again',
                { icon: 'wifiOff', duration: 6000 });
              return;
            }
            restoring = false;
            // The backup carries its own theme and currency; adopt them, then
            // land on a freshly built register rather than a stale settings view.
            applyTheme(store.settings.theme || 'system');
            modal.close();
            toast(`Restored ${plural(sum.products, 'product')} and ${plural(sum.receipts, 'receipt')}`, { icon: 'circleCheck', duration: 5000 });
            location.hash = '#/';
          },
        }, 'Replace all data')
      )
    );
    const modal = openModal({ title: 'Restore from backup', content: body, canClose: () => !restoring });
  }

  /* ---------- Loyalty ---------- */

  const loyaltyBody = el('div');
  /** The working copy the controls edit; written on every change. */
  const loyaltyOf = () => ({
    enabled: false, type: 'stamps', stamps: 10, percent: 5, threshold: 5,
    rewardName: '', productId: null, categoryId: null,
    ...(store.settings.loyalty || {}),
  });

  const saveLoyalty = (patch) => {
    const next = { ...loyaltyOf(), ...patch };
    saved(store.updateSettings({ loyalty: next }), renderLoyalty).then(renderLoyalty);
  };

  // Every toggle and every field rebuilds this card (the shape of the form
  // depends on the scheme), so focus is handed to the replacement.
  function renderLoyalty() {
    keepFocus(loyaltyBody, paintLoyalty);
  }

  function paintLoyalty() {
    clear(loyaltyBody);
    const l = loyaltyOf();
    const onToggle = el('input', { type: 'checkbox', id: 'loyalty-on', checked: !!l.enabled });
    onToggle.addEventListener('change', () => saveLoyalty({ enabled: onToggle.checked }));

    const parts = [
      el('div.field.check-field', {}, onToggle,
        el('label', { htmlFor: 'loyalty-on' }, 'Run a loyalty card')),
    ];

    if (l.enabled) {
      const typeSeg = el('div.seg.seg-block', { role: 'group', 'aria-label': 'Scheme' });
      for (const [value, label] of [['stamps', 'Stamps'], ['spend', 'Spend']]) {
        typeSeg.append(el('button.seg-btn', {
          type: 'button',
          className: `seg-btn${l.type === value ? ' active' : ''}`,
          'aria-pressed': l.type === value ? 'true' : 'false',
          onclick: () => saveLoyalty({ type: value }),
        }, label));
      }
      parts.push(el('div.field', {}, el('label.label', {}, 'Scheme'), typeSeg));

      const rewardInput = el('input.input', {
        type: 'text', value: l.rewardName || '', maxLength: 40,
        placeholder: l.type === 'stamps' ? 'e.g. a free coffee' : 'e.g. money off',
        'aria-label': 'What the reward is called',
      });
      rewardInput.addEventListener('change', () => saveLoyalty({ rewardName: rewardInput.value.trim() }));

      if (l.type === 'stamps') {
        /* What earns a stamp: one product, or a whole category. */
        const scopeSelect = el('select.select', {
          'aria-label': 'What earns a stamp',
          onchange: (e) => {
            const [kind, id] = e.target.value.split(':');
            saveLoyalty(kind === 'cat'
              ? { categoryId: id, productId: null }
              : { productId: id, categoryId: null });
          },
        },
          el('option', { value: '', selected: !l.productId && !l.categoryId }, 'Choose a product or category…'),
          ...store.categories.map((c) => el('option', {
            value: `cat:${c.id}`, selected: l.categoryId === c.id,
          }, `Any ${c.name}`)),
          ...[...store.products]
            .sort((a, b) => String(a.name).localeCompare(String(b.name)))
            .map((p) => el('option', { value: `prod:${p.id}`, selected: l.productId === p.id }, p.name))
        );
        const stampsInput = el('input.input', {
          type: 'text', inputmode: 'numeric', value: l.stamps ?? 10,
          'aria-label': 'Stamps needed',
        });
        stampsInput.addEventListener('change', () => {
          const n = Math.round(Number(String(stampsInput.value).trim()));
          if (!Number.isFinite(n) || n < 2 || n > 50) {
            stampsInput.value = l.stamps ?? 10;
            toast('Enter a whole number from 2 to 50', { icon: 'alert' });
            return;
          }
          saveLoyalty({ stamps: n });
        });
        parts.push(
          el('div.field', {}, el('label.label', {}, 'Stamped by'), el('div.select-wrap', {}, scopeSelect)),
          el('div.form-grid', {},
            el('div.field', {}, el('label.label', {}, 'Stamps for a reward'), stampsInput),
            el('div.field', {}, el('label.label', {}, 'The reward'), rewardInput))
        );
      } else {
        const percentInput = el('input.input', {
          type: 'text', inputmode: 'decimal', value: l.percent ?? 5,
          'aria-label': 'Percent earned back',
        });
        percentInput.addEventListener('change', () => {
          const v = parseRate(percentInput.value);
          if (v === null || v < 0.5 || v > 50) {
            percentInput.value = l.percent ?? 5;
            toast('Enter a percentage from 0.5 to 50', { icon: 'alert' });
            return;
          }
          saveLoyalty({ percent: v });
        });
        const thresholdInput = el('input.input', {
          type: 'text', inputmode: 'decimal', value: (l.threshold ?? 0).toFixed
            ? Number(l.threshold ?? 0).toFixed(2) : l.threshold,
          'aria-label': 'Amount that unlocks the reward',
        });
        thresholdInput.addEventListener('change', () => {
          const v = parseAmount(thresholdInput.value);
          if (v === null) {
            thresholdInput.value = Number(l.threshold ?? 0).toFixed(2);
            toast('Enter the amount as a plain number', { icon: 'alert' });
            return;
          }
          saveLoyalty({ threshold: v });
        });
        parts.push(
          el('div.form-grid', {},
            el('div.field', {}, el('label.label', {}, 'Earned back (%)'), percentInput),
            el('div.field', {}, el('label.label', {}, 'Spendable from'), thresholdInput)),
          el('div.field', {}, el('label.label', {}, 'The reward'), rewardInput)
        );
      }

      const scheme = loyaltyScheme({ ...store.settings, loyalty: l }, store);
      parts.push(scheme
        ? el('div.callout.callout-accent', {},
          el('span.callout-ic', { html: icon('circleCheck', 16, 2) }),
          el('span', {}, scheme.type === 'stamps'
            ? `Every ${scheme.target} earns ${scheme.rewardName}. Attach a customer at checkout and their card shows there.`
            : `${scheme.percent}% of each sale comes back, spendable from ${money(scheme.threshold)}.`))
        : el('div.callout.callout-warn', {},
          el('span.callout-ic', { html: icon('alert', 16, 2) }),
          el('span', {}, 'Not running yet: choose what earns a stamp.')));
    }

    append(loyaltyBody, parts);
  }

  const loyaltyCard = el('section.card', { 'aria-label': 'Loyalty card' },
    el('div.card-head', {}, el('h2.card-title', {}, 'Loyalty card')),
    el('p.small.muted', { style: { marginBottom: '12px' } },
      'Reward the regulars you already know. Progress is worked out from the sales '
      + `attached to a customer — the last ${LOYALTY_MONTHS} months of them — so there is nothing to keep `
      + 'in step, and a refunded sale takes its stamps back with it. Nothing is ever '
      + 'applied without a tap at checkout.'),
    loyaltyBody
  );

  /* ---------- Quick notes ---------- */

  const notesList = el('div');
  // Adding or removing a note rebuilds the chip row it was pressed in.
  function renderQuickNotes() {
    keepFocus(notesList, paintQuickNotes);
  }

  function paintQuickNotes() {
    clear(notesList);
    const notes = cleanQuickNotes(store.settings.quickNotes);
    if (!notes.length) {
      notesList.append(el('p.small.muted', { style: { marginBottom: '10px' } },
        'Nothing yet. A note you add here becomes a one-tap chip at the register.'));
    } else {
      const row = el('div.chip-row', {});
      for (const note of notes) {
        row.append(el('span.chip.chip-static', {},
          note,
          el('button.chip-x', {
            type: 'button',
            html: icon('x', 13, 2.4),
            'aria-label': `Remove the quick note ${note}`,
            onclick: () => {
              const next = notes.filter((n) => n !== note);
              saved(store.updateSettings({ quickNotes: next }), renderQuickNotes)
                .then(renderQuickNotes);
            },
          })));
      }
      notesList.append(row);
    }
    const input = el('input.input', {
      type: 'text', maxLength: 32, placeholder: 'e.g. to go',
      'aria-label': 'New quick note',
    });
    notesList.append(el('form.row', {
      style: { marginTop: '10px' },
      onsubmit: (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) {
          input.focus();
          toast('Type the note first', { icon: 'alert' });
          return;
        }
        if (notes.length >= 12) {
          toast('Twelve quick notes is the most a chip row can hold', { icon: 'alert' });
          return;
        }
        if (notes.some((n) => n.toLowerCase() === text.toLowerCase())) {
          input.value = '';
          toast('That note is already here', { icon: 'alert' });
          return;
        }
        saved(store.updateSettings({ quickNotes: [...notes, text] }), renderQuickNotes)
          .then(renderQuickNotes);
      },
    },
      el('div.grow', {}, input),
      el('button.btn.btn-primary', { type: 'submit' }, 'Add')
    ));
  }

  const notesCard = el('section.card', { 'aria-label': 'Quick notes' },
    el('div.card-head', {}, el('h2.card-title', {}, 'Quick notes')),
    el('p.small.muted', { style: { marginBottom: '12px' } },
      'Phrases a counter taps instead of typing: “to go”, “no ice”, “gift”. They appear '
      + 'as chips on an item’s note and on the sale’s note at payment. Changing them '
      + 'later never changes a receipt — notes are copied onto the sale.'),
    notesList
  );

  /* ---------- Receipt printer and cash drawer ---------- */

  const printerBody = el('div');
  // Choosing, forgetting, and every toggle rebuild this card.
  function renderPrinter() {
    keepFocus(printerBody, paintPrinter);
  }

  const savePrinter = (patch) => {
    setPrinterConfig({ ...printerConfig(), ...patch });
    renderPrinter();
  };

  function paintPrinter() {
    clear(printerBody);
    const support = printerSupport();
    const config = printerConfig();

    // Honest first: browser hardware access is uneven, and a shop should be
    // told what *this* device can do rather than shown a button that fails.
    if (!support.any) {
      append(printerBody, [
        el('div.callout.callout-warn', {},
          el('span.callout-ic', { html: icon('alert', 16, 2) }),
          el('span', {},
            el('strong', {}, 'This device can’t talk to a printer directly'),
            '. Safari and iPadOS don’t allow it at all, and it needs a secure (https) '
            + 'page everywhere else. Receipts still print through the browser’s own print '
            + 'dialog, which works with any printer your device already has.')),
      ]);
      return;
    }

    if (!config) {
      append(printerBody, [
        el('p.small.muted', { style: { marginBottom: '12px' } },
          'Print straight to a thermal receipt printer — no dialog, no preview — and open '
          + 'the cash drawer wired to it. Choose how this printer is attached:'),
        el('div.row.wrap', {}, TRANSPORTS.filter((t) => support[t.value]).map((t) =>
          el('button.btn.btn-ghost', {
            html: icon('printer', 16, 2),
            onclick: async (e) => {
              const btn = e.currentTarget;
              btn.disabled = true;
              try {
                await choosePrinter(t.value);
              } catch (err) {
                btn.disabled = false;
                // Dismissing the browser's own picker is not an error.
                if (!(err instanceof PrinterError) || !err.cancelled) {
                  console.error(err);
                  toast(err.message || 'Couldn’t reach that printer', { icon: 'alert', duration: 6000 });
                }
                return;
              }
              renderPrinter();
              toast('Printer connected. Try a test print', { icon: 'printer' });
            },
          }, ` ${t.label}`))),
        el('p.small.muted', { style: { marginTop: '12px' } },
          'The printer belongs to this device, not to your account — each tablet behind '
          + 'the counter chooses its own. Until one is chosen, everything prints through '
          + 'the browser’s print dialog as before.'),
      ]);
      return;
    }

    const widthSelect = el('select.select', {
      'aria-label': 'Paper width',
      onchange: (e) => savePrinter({ columns: Number(e.target.value) }),
    }, PAPER_WIDTHS.map((w) => el('option', {
      value: String(w.columns), selected: config.columns === w.columns,
    }, w.label)));

    const autoToggle = el('input', { type: 'checkbox', id: 'auto-print', checked: config.autoPrint });
    autoToggle.addEventListener('change', () => savePrinter({ autoPrint: autoToggle.checked }));
    const kickToggle = el('input', { type: 'checkbox', id: 'kick-drawer', checked: config.kickOnCash });
    kickToggle.addEventListener('change', () => savePrinter({ kickOnCash: kickToggle.checked }));

    append(printerBody, [
      el('div.callout.callout-accent', {},
        el('span.callout-ic', { html: icon('printer', 16, 2) }),
        el('span', {},
          el('strong', {}, config.name || 'Printer'), ' · ',
          TRANSPORTS.find((t) => t.value === config.transport)?.label || config.transport)),
      el('div.field', { style: { marginTop: '14px' } },
        el('label.label', {}, 'Paper width'), el('div.select-wrap', {}, widthSelect)),
      el('div.field.check-field', {},
        autoToggle,
        el('label', { htmlFor: 'auto-print' }, 'Print every sale as it completes')),
      el('div.field.check-field', {},
        kickToggle,
        el('label', { htmlFor: 'kick-drawer' }, 'Open the cash drawer on cash sales')),
      el('div.row.wrap', {},
        el('button.btn.btn-ghost', {
          html: icon('printer', 16, 2),
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              await printDocBytes(testDoc(store.settings.storeName, config.columns));
              toast('Test print sent', { icon: 'printer' });
            } catch (err) {
              console.error(err);
              toast(err.message || 'The printer didn’t answer', { icon: 'alert', duration: 6000 });
            }
            btn.disabled = false;
          },
        }, ' Test print'),
        el('button.btn.btn-ghost', {
          html: icon('coins', 16, 2),
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              await kickDrawer();
              toast('Drawer pulse sent', { icon: 'coins' });
            } catch (err) {
              console.error(err);
              toast(err.message || 'The printer didn’t answer', { icon: 'alert', duration: 6000 });
            }
            btn.disabled = false;
          },
        }, ' Test the drawer'),
        el('button.btn.btn-ghost.btn-danger-ghost', {
          onclick: async () => {
            const ok = await confirmDialog({
              title: 'Forget this printer?',
              message: 'This device goes back to printing through the browser’s print dialog. Nothing else changes.',
              confirmLabel: 'Forget it',
            });
            if (!ok) return;
            setPrinterConfig(null);
            renderPrinter();
            toast('Printer forgotten', { icon: 'printer' });
          },
        }, 'Forget printer'),
      ),
      el('p.small.muted', { style: { marginTop: '14px' } },
        'Opening the drawer without a sale is on the drawer sheet, under “No sale”, and is '
        + 'recorded in the day’s movements. If the printer doesn’t answer, receipts fall back '
        + 'to the browser’s print dialog on their own — a sale is never held up by hardware.'),
    ]);
  }

  const printerCard = el('section.card', { 'aria-label': 'Receipt printer' },
    el('div.card-head', {}, el('h2.card-title', {}, 'Receipt printer')),
    printerBody
  );

  /* ---------- Catalog (CSV in, CSV out) ---------- */

  const catalogCard = el('section.card', { 'aria-label': 'Catalog' },
    el('div.card-head', {}, el('h2.card-title', {}, 'Catalog')),
    el('p.small.muted', { style: { marginBottom: '12px' } },
      'Bring a product list in from a spreadsheet instead of typing it out — your own '
      + 'export, or one from another till. Products already here are matched by SKU and '
      + 'updated, so a price change is a spreadsheet edit and a re-import.'),
    el('div.row.wrap', {},
      el('button.btn.btn-ghost', {
        html: icon('fileUp', 16, 2),
        onclick: () => openProductImport(),
      }, ' Import products (CSV)'),
      el('button.btn.btn-ghost', {
        html: icon('fileSheet', 16, 2),
        onclick: exportCatalogCsv,
      }, ' Export catalog (CSV)')
    ),
    el('p.small.muted', { style: { marginTop: '14px' } },
      `${plural(store.products.length, 'product')} in the catalog. The export doubles as the `
      + 'import template; photos, option groups, and sales history aren’t part of either.')
  );

  /* ---------- Restore points (automatic snapshots) ---------- */

  const snapshotBody = el('div');
  function renderSnapshots() {
    keepFocus(snapshotBody, paintSnapshots);
  }

  function paintSnapshots() {
    clear(snapshotBody);
    const on = store.snapshotsOn;
    const failure = store.snapshotError();
    const toggle = el('input', { type: 'checkbox', id: 'auto-snapshot', checked: on });
    toggle.addEventListener('change', () => {
      saved(store.updateSettings({ autoSnapshot: toggle.checked }),
        () => { toggle.checked = store.snapshotsOn; }).then(renderSnapshots);
    });

    const rows = el('div.card-list', { style: { margin: '12px 0 0' } });
    for (const entry of store.snapshots) {
      rows.append(el('div.snapshot-row', {},
        el('span.pay-ic', { html: icon('cloudUp', 18, 1.8) }),
        el('span.card-main', {},
          // The time, not only the date: a busy day holds a daily snapshot
          // and one before every destructive act, and four rows reading
          // "Friday, August 21" tell a shopkeeper nothing about which is which.
          el('span.card-title', {},
            `${formatDay(todayISO(new Date(entry.at)))} · ${formatTime(entry.at)}`),
          el('span.card-sub', {}, [
            SNAPSHOT_REASONS[entry.reason],
            snapshotHolds(entry),
            formatBytes(entry.bytes),
          ].join(' · '))),
        el('button.btn.btn-ghost.btn-sm', {
          type: 'button',
          onclick: () => openSnapshotRestore(entry),
        }, 'Restore'),
        el('button.icon-btn', {
          type: 'button',
          html: icon('trash', 16, 2),
          'aria-label': `Delete the restore point from ${formatDay(todayISO(new Date(entry.at)))} at ${formatTime(entry.at)}`,
          onclick: async () => {
            const ok = await confirmDialog({
              title: 'Delete this restore point?',
              message: 'The snapshot file is removed. Your live data isn’t touched.',
            });
            if (!ok) return;
            try {
              await store.deleteSnapshot(entry.file);
            } catch (err) {
              console.error(err);
              toast('Couldn’t delete it. Check your connection', { icon: 'wifiOff' });
              return;
            }
            renderSnapshots();
          },
        })
      ));
    }

    append(snapshotBody, [
      el('div.field.check-field', {},
        toggle,
        el('label', { htmlFor: 'auto-snapshot' }, 'Keep automatic restore points')),
      el('p.small.muted', { style: { margin: '-6px 0 0' } },
        `Once a day, at every day close, and before anything destructive — a restore, `
        + `a catalog import, a posted stocktake. The newest ${KEEP_RECENT} are kept, then one `
        + `a week for ${KEEP_WEEKS} weeks; the rest are pruned. They live in your own Puter `
        + 'account, under pos-data/snapshots.'),
      // A backup that quietly stopped working is worse than none.
      failure && el('div.callout.callout-warn', { style: { marginTop: '14px' } },
        el('span.callout-ic', { html: icon('alert', 16, 2) }),
        el('span', {},
          el('strong', {}, 'Snapshots are failing'), ': ', failure.why,
          ` (last tried ${formatDayFull(todayISO(new Date(failure.at)))}).`)),
      store.snapshots.length
        ? el('p.small.muted', { style: { marginTop: '14px' } },
          `${plural(store.snapshots.length, 'restore point')} · ${formatBytes(store.snapshotBytes())} of storage`)
        : el('p.small.muted', { style: { marginTop: '14px' } }, on
          ? 'None yet. The first one is taken shortly after you open the app.'
          : 'None. Turn restore points on and one is taken shortly after each start.'),
      store.snapshots.length ? rows : null,
      el('div.row.wrap', { style: { marginTop: '14px' } },
        el('button.btn.btn-ghost', {
          html: icon('cloudUp', 16, 2),
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              await store.takeSnapshot('manual');
              toast('Restore point saved', { icon: 'circleCheck' });
            } catch (err) {
              console.error(err);
              toast('Couldn’t save a restore point. Check your connection', { icon: 'wifiOff' });
            }
            btn.disabled = false;
            renderSnapshots();
          },
        }, ' Take one now')),
    ]);
  }

  /**
   * Restoring from a snapshot goes through the same previewed, validated path
   * a file restore does - the same summary, the same warning, the same
   * replacement. A restore point is only worth having if restoring it is the
   * safe, boring operation the file restore already is.
   */
  async function openSnapshotRestore(entry) {
    let data;
    try {
      data = await store.readSnapshot(entry.file);
    } catch (err) {
      console.error(err);
      toast('Couldn’t read that restore point. Check your connection', { icon: 'wifiOff' });
      return;
    }
    let summary;
    try {
      summary = summarizeBackup(data);
    } catch (err) {
      toast(err instanceof BackupError ? err.message : 'That restore point is damaged',
        { icon: 'alert', duration: 6000 });
      return;
    }
    openRestorePreview(
      {
        name: `${SNAPSHOT_REASONS[entry.reason]} · ${formatDayFull(todayISO(new Date(entry.at)))} at ${formatTime(entry.at)}`,
        size: entry.bytes,
      },
      data,
      summary,
    );
  }

  const snapshotCard = el('section.card', { 'aria-label': 'Restore points' },
    el('div.card-head', {}, el('h2.card-title', {}, 'Restore points')),
    snapshotBody
  );

  const dataCard = el('section.card', { 'aria-label': 'Your data' },
    el('div.card-head', {}, el('h2.card-title', {}, 'Your data')),
    el('p.small.muted', { style: { marginBottom: '12px' } },
      `Everything lives in your own Puter account. Next receipt number: #${store.settings.nextReceipt}.`),
    el('div.row.wrap', {},
      el('button.btn.btn-ghost', { html: icon('fileDown', 16, 2), onclick: exportData }, ' Export JSON'),
      el('button.btn.btn-ghost', { html: icon('fileUp', 16, 2), onclick: pickBackup }, ' Restore backup')
    ),
    el('p.small.muted', { style: { margin: '16px 0 12px' } },
      'For a bookkeeper or a tax filing, export any date range as spreadsheet files instead.'),
    el('div.row.wrap', {},
      el('button.btn.btn-ghost', {
        html: icon('fileSheet', 16, 2),
        onclick: () => openCsvExport({ from: `${todayISO().slice(0, 7)}-01`, to: todayISO() }),
      }, ' Export CSV')
    ),
    // Inside a Puter app window the platform owns the session - no sign-out.
    !isPuterApp() && el('div.card-divider'),
    !isPuterApp() && el('div.row.wrap', {},
      el('button.btn.btn-ghost', { html: icon('logout', 16, 2), onclick: confirmSignOut }, ' Sign out')
    ),
    el('p.small.muted', { style: { marginTop: '14px' } },
      'Point of Sale · Powered by ',
      el('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Puter'))
  );

  const node = el('div.view.settings', {},
    el('header.view-head', {},
      el('div', {},
        el('h1.view-title', {}, 'Settings'),
        el('p.view-sub', {}, store.user?.username ? `Signed in as ${store.user.username}` : ''))
    ),
    storeCard, appearanceCard, taxCard, discCard, loyaltyCard, notesCard,
    tipsCard, printerCard, catalogCard, pinCard, snapshotCard, dataCard
  );

  /** The catalog count in the card's footnote follows the catalog. */
  const catalogNote = catalogCard.lastElementChild;
  const renderCatalogNote = () => {
    catalogNote.textContent = `${plural(store.products.length, 'product')} in the catalog. `
      + 'The export doubles as the import template; photos, option groups, and sales '
      + 'history aren’t part of either.';
  };

  const onChange = () => {
    renderTaxes();
    renderDiscounts();
    renderCatalogNote();
    renderSnapshots();
  };
  store.addEventListener('change', onChange);
  renderTaxes();
  renderDiscounts();
  renderLoyalty();
  renderQuickNotes();
  renderPrinter();
  renderSnapshots();

  return { node, destroy: () => store.removeEventListener('change', onChange) };
}

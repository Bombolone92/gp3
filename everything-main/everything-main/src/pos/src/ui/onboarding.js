/**
 * First-run onboarding: one decision (set up / sample data / skip), a short
 * setup step (store name, currency, tax), and the offer to bring a catalog in
 * from a spreadsheet - the moment a shop moving off another till still has the
 * file in hand. Gated on an empty dataset; closing at any point marks
 * onboarding done - everything here can also be changed later in Settings.
 */

import { el, clear, append } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store, STORE_TEXT_MAX } from '../lib/store.js';
import { CURRENCIES, parseRate } from '../lib/money.js';
import { sampleDataset } from '../lib/sample.js';
import { openProductImport } from './product-import.js';

export function shouldOnboard(store) {
  return !store.settings.onboarded && !store.settings.sampleData
    && store.products.length === 0 && store.months.length === 0;
}

export function openOnboarding() {
  const body = el('div');

  const markDone = () => {
    if (!store.settings.onboarded) {
      store.updateSettings({ onboarded: true }).catch(() => {});
    }
  };
  /**
   * Installing the sample data replaces the whole dataset, the same write a
   * restore makes. The welcome screen holds still while it is out rather
   * than handing back a register the install is still writing under.
   */
  let installing = false;
  const modal = openModal({
    title: 'Welcome', content: body, onClose: markDone, canClose: () => !installing,
  });

  const skipBtn = (label = 'Skip for now') => el('button.btn.btn-ghost.btn-block', {
    type: 'button', style: { marginTop: '10px' },
    onclick: () => { markDone(); modal.close(); },
  }, label);

  /* Step 0 - welcome */
  function renderWelcome() {
    clear(body);
    append(body, [
      el('div.empty', { style: { padding: '10px 8px 4px' } },
        el('div.empty-icon', {
          html: icon('store', 30),
          style: { background: 'var(--accent-wash)', color: 'var(--accent)' },
        }),
        el('h3', { style: { fontSize: '19px' } }, 'Your register, your cloud'),
        el('p', {}, 'Ring up sales, print receipts, and watch your numbers. Everything is stored in your own Puter account.')
      ),
      el('button.btn.btn-primary.btn-block', {
        type: 'button', style: { padding: '13px' },
        onclick: renderSetup,
      }, 'Set up my store'),
      el('button.btn.btn-ghost.btn-block', {
        type: 'button', style: { marginTop: '10px', border: '1px dashed var(--hairline-strong)' },
        html: icon('sparkle', 15, 2),
        onclick: useSampleData,
      }, ' Explore with sample data'),
      skipBtn()
    ]);
  }

  async function useSampleData(e) {
    // currentTarget, not target: the tap usually lands on the button's icon,
    // and disabling an <svg> leaves the button live for a second tap - which
    // would install a whole second dataset over the first.
    const btn = e.currentTarget;
    btn.disabled = true;
    installing = true;
    try {
      await store.importAll(sampleDataset(store));
    } catch (err) {
      console.error(err);
      installing = false;
      toast('Couldn’t load the sample data. Check your connection', { icon: 'wifiOff' });
      btn.disabled = false;
      return;
    }
    installing = false;
    modal.close();
    toast('Sample data loaded. Wipe it anytime from the banner', { icon: 'sparkle' });
  }

  /* Step 1 - store details, then straight to the register */
  function renderSetup() {
    clear(body);
    const nameInput = el('input.input', {
      type: 'text', placeholder: 'e.g. Corner Roast Café', maxLength: STORE_TEXT_MAX.storeName,
      autocomplete: 'organization', 'aria-label': 'Store name',
    });
    let picked = store.settings.currency;
    const taxName = el('input.input', { type: 'text', value: 'Sales tax', maxLength: 40, 'aria-label': 'Tax name' });
    const taxRate = el('input.input', {
      type: 'text', inputmode: 'decimal', placeholder: '0', 'aria-label': 'Tax rate percent',
    });
    // Remembered across retries: if the rate landed but the settings write
    // behind it failed, tapping the button again must not add it twice.
    let taxAdded = false;

    append(body, [
      el('h3.onboard-h', {}, 'Tell us about your store'),
      el('p.onboard-p', {}, 'The name appears on receipts. Add products and more tax rates later, whenever you like.'),
      el('div.field', {}, el('label.label', {}, 'Store name'), nameInput),
      el('div.field', {},
        el('label.label', {}, 'Currency'),
        el('div.select-wrap', {},
          el('select.select', {
            'aria-label': 'Currency',
            onchange: (ev) => { picked = ev.target.value; },
          }, CURRENCIES.map((c) =>
            el('option', { value: c.code, selected: c.code === picked }, `${c.code} · ${c.name}`)))
        )
      ),
      el('div.field', {},
        el('label.label', {}, 'Tax rate (optional)'),
        el('div.row', {},
          el('div.grow', {}, taxName),
          el('div', { style: { width: '110px', position: 'relative' } },
            taxRate,
            el('span.input-suffix', { 'aria-hidden': 'true' }, '%'))
        )
      ),
      el('button.btn.btn-primary.btn-block', {
        type: 'button', style: { padding: '13px', marginTop: '6px' },
        onclick: async (ev) => {
          const btn = ev.currentTarget;
          // The rate parser, not the money parser: '8.875' must keep its
          // third decimal, not round to 8.88 on every sale thereafter.
          const rate = parseRate(taxRate.value);
          // The field is optional, but a typed rate that didn't parse must
          // not be skipped in silence - the register would ring up every
          // sale tax-free and nobody would know why.
          if (taxRate.value.trim() && rate === null) {
            toast('Enter a tax rate between 0 and 100', { icon: 'alert' });
            taxRate.focus();
            return;
          }
          btn.disabled = true;
          try {
            if (rate && !taxAdded) {
              await store.addTax({ name: taxName.value || 'Sales tax', rate });
              taxAdded = true;
            }
            await store.updateSettings({
              storeName: nameInput.value.trim(),
              currency: picked,
              onboarded: true,
            });
          } catch (err) {
            console.error(err);
            btn.disabled = false;
            toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
            return;
          }
          renderProducts();
        },
      }, 'Next'),
      skipBtn()
    ]);
    nameInput.focus();
  }

  /* Step 2 - the catalog. A shop moving off another till has its product list
     in a spreadsheet already, and this is the moment they have it in hand;
     typing three hundred products into a form one at a time is where a trial
     ends. Skipping is one tap and costs nothing. */
  function renderProducts() {
    clear(body);
    append(body, [
      el('h3.onboard-h', {}, 'Bring your products in'),
      el('p.onboard-p', {}, 'Already have your catalog in a spreadsheet? Import it now — a name and a price per row is all it needs. You can also add products one at a time later.'),
      el('button.btn.btn-primary.btn-block', {
        type: 'button', style: { padding: '13px', marginTop: '6px' },
        html: icon('fileUp', 16, 2),
        onclick: () => {
          // The import sheet opens over this one and closes it on success, so
          // the shopkeeper lands on a register that already has their tiles.
          openProductImport({ onDone: () => { markDone(); modal.close(); } });
        },
      }, ' Import a CSV file'),
      el('button.btn.btn-ghost.btn-block', {
        type: 'button', style: { marginTop: '10px' },
        onclick: () => {
          markDone();
          modal.close();
          toast('You’re set. Add your first product from the Products tab', { icon: 'circleCheck' });
        },
      }, 'Open the register'),
    ]);
  }

  renderWelcome();
}

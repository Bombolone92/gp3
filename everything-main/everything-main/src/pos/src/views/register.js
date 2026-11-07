import { el, clear, append, keepFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openModal, confirmDialog, chooseDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import {
  store, PAYMENT_METHODS, CASH_METHODS, CREDIT_METHOD, paymentMethodInfo,
  receiptChange, receiptTip, MAX_NOTE, cleanQuickNotes,
} from '../lib/store.js';
import { formatTime, formatAgo, todayISO, daysAgoISO } from '../lib/dates.js';
import { formatMoney, parseAmount, discountTypeChoices } from '../lib/money.js';
import {
  computeCart, changeDue, tenderSuggestions, validDiscount, discountCents, toCents, fromCents,
} from '../lib/totals.js';
import { matches, plural, round2 } from '../lib/util.js';
import { printReceipt, receiptNode } from '../ui/receipt.js';
import { printerConfig, kickDrawer, hasPrinter } from '../lib/printer.js';
import { openProductForm } from '../ui/product-form.js';
import { openCameraScanner } from '../ui/scanner.js';
import { openDrawerSheet, drawerStartedOn } from '../ui/drawer-sheet.js';
import { openCustomerPicker } from '../ui/customer-picker.js';
import { requirePin } from '../ui/pin-gate.js';
import { dressTile } from '../ui/product-photos.js';
import { shareActionLabel } from '../ui/receipt-image.js';
import { handOverReceipt } from '../ui/hand-over.js';
import { createWedgeReader, findBySku, looksLikeBarcode, cameraScanSupported } from '../lib/scan.js';
import {
  loyaltyScheme, loyaltyProgress, progressText, progressSnapshot, rewardForCart,
  sentence, LOYALTY_MONTHS,
} from '../lib/loyalty.js';
import {
  hasOptions, optionUnitPrice, optionsKey, optionsLabel, groupSummary, formatDelta,
  defaultSelection, selectionValid, selectionOptions, optionsToSelection,
} from '../lib/options.js';

/**
 * Asked at most once per app run: reopening the register between sales must
 * not nag about the opening float.
 */
let promptedForFloat = false;

/** Sold by weight/volume/length: the tile asks for a quantity, not +1. */
const isMeasured = (p) => p?.soldBy === 'measure';

/**
 * A typed measure quantity: positive, three decimal places (what shop scales
 * print), same ceiling as whole-unit quantities.
 */
function parseQty(text) {
  const s = String(text ?? '').trim().replace(/,/g, '.');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > 9999.999) return null;
  return Math.round(n * 1000) / 1000;
}

/**
 * The discount a value field describes: null when the field is empty or the
 * figure comes to nothing, `false` when what's typed isn't a number this app
 * will use.
 *
 * That last case has to be re-asked, not quietly become "no discount".
 * parseAmount refuses '1,000' precisely because it can't tell a thousand from
 * one, and a mistyped figure would otherwise close the sheet looking applied -
 * with the customer charged full price, or an existing discount silently gone.
 */
function readDiscount(input, type) {
  const text = String(input.value).trim();
  if (!text) return null;
  const value = parseAmount(text);
  if (value === null) return false;
  const discount = { type, value: type === 'percent' ? Math.min(100, value) : value };
  return validDiscount(discount) ? discount : null;
}

/**
 * True when a rejection already says something a cashier can act on - one of
 * the store's own refusals - rather than being a failed request to paper over.
 *
 * These messages are written for the counter, and the store-credit ones are
 * written to be read out loud: "Take the balance another way." Reported as
 * "check your connection" they sent a cashier to look at the Wi-Fi while a
 * customer waited, over a balance another till had spent a moment earlier.
 */
function explains(err) {
  return /nothing to charge|cover the total|exceed the total|store credit|waiting to sync|on this device/i
    .test(err?.message || '');
}

/**
 * The register: product grid on one side, the running sale on the other.
 * On narrow screens the sale collapses into a bottom bar that opens as a
 * sheet. Cart state lives here and resets after each completed sale.
 */
export function registerView() {
  /** [{ productId, name, unitPrice, qty, taxRate, taxName, discount }] */
  let cart = [];
  let orderDiscount = null;
  let search = '';
  /** 'all' | 'fav' | a category id. */
  let activeCat = store.products.some((p) => p.favorite) ? 'fav' : 'all';
  /** Cart line to pulse once after a hands-free add, so a scan is visible. */
  let flashLine = null;
  /**
   * A loyalty reward being cashed in on the sale in progress: the discount is
   * already on the cart, this is the record of *why*. Lives with the cart, so
   * reopening the payment sheet doesn't lose it, and is cleared wherever the
   * cart is.
   */
  let redeeming = null;
  /**
   * What that reward actually discounted: the cart line (a stamps card) or
   * the order-discount object (a spend scheme).
   *
   * Held by identity, never by position. The reward used to carry the index
   * of its line, and nothing renumbered it: remove an earlier line and the
   * index pointed at a different one, so Undo took the discount off the wrong
   * item and completing the sale priced the reward from whatever discount
   * happened to sit there - or from none, giving the item away and leaving
   * the card unspent.
   */
  let redeemingOn = null;
  /**
   * Who this sale is for, once a cashier attaches somebody.
   *
   * Part of the sale, like the cart and the reward above it - not part of the
   * payment sheet. It lived in the sheet, and a sheet closed to add one more
   * item came back with the customer gone while the reward they had just
   * cashed in stayed on the cart: the free coffee was given away, the receipt
   * named nobody, and their card - which is read from receipts - still said a
   * free one was ready. Kept here, closing the sheet costs nothing.
   */
  let customer = null;
  /**
   * Put the card back: the discount the reward added comes off again. Cart
   * state, not payment-sheet state - the sheet is only where it is offered.
   */
  function undoReward() {
    if (!redeeming) return;
    // Only ever the reward's own discount: an order discount a cashier
    // applied over it belongs to them, not to the card.
    if (redeeming.kind === 'spend') {
      if (orderDiscount === redeemingOn) orderDiscount = null;
    } else if (cart.includes(redeemingOn)) {
      delete redeemingOn.discount;
    }
    redeeming = null;
    redeemingOn = null;
  }

  /**
   * A reward is only being cashed in while the discount it put on is still
   * there. A line removed, its discount cleared, an order discount replaced
   * by a preset - each leaves the card nothing to have paid for, and a sale
   * that recorded one anyway would spend a stamp for nothing. Checked
   * wherever the cart is re-read, so the payment sheet re-offers it instead.
   */
  function checkReward() {
    if (!redeeming) return;
    const standing = redeeming.kind === 'spend'
      ? orderDiscount === redeemingOn
      : cart.includes(redeemingOn) && !!redeemingOn.discount;
    if (standing) return;
    redeeming = null;
    redeemingOn = null;
  }

  /**
   * The reward as the store and the draft record it. Which line it sits on is
   * a position, so the position is read at the moment of writing rather than
   * remembered from the moment of applying.
   */
  function redeemingRecord() {
    if (!redeeming) return null;
    if (redeeming.kind !== 'stamps') return redeeming;
    const at = cart.indexOf(redeemingOn);
    return at < 0 ? null : { ...redeeming, lineIndex: at };
  }

  /** True while the grid is being rearranged rather than sold from. */
  let arranging = false;
  /** The tile currently under the finger, if any - see beginDrag. */
  let drag = null;

  const money = (n) => formatMoney(n, store.settings.currency);
  const cartTotals = () => computeCart(cart, {
    orderDiscount,
    pricesIncludeTax: store.settings.pricesIncludeTax,
  });

  /**
   * The quick notes a shop typed once in Settings, as chips over a note
   * field. Tapping appends rather than replaces, so "to go" and "no ice" can
   * both be said; tapping one already there takes it back out. Mid-rush,
   * typing is the enemy.
   */
  function quickNoteChips(input) {
    // Read defensively, like the registration rows: settings can carry
    // whatever a hand-edited backup put there.
    const notes = cleanQuickNotes(store.settings.quickNotes);
    if (!notes.length) return null;
    const row = el('div.chip-row', { role: 'group', 'aria-label': 'Quick notes' });
    const parts = () => input.value.split(',').map((s) => s.trim()).filter(Boolean);
    const paint = () => keepFocus(row, () => {
      clear(row);
      const on = new Set(parts().map((p) => p.toLowerCase()));
      for (const note of notes) {
        const active = on.has(note.toLowerCase());
        row.append(el('button.chip', {
          type: 'button',
          className: `chip chip-sm${active ? ' active' : ''}`,
          'aria-pressed': active ? 'true' : 'false',
          onclick: () => {
            const next = active
              ? parts().filter((p) => p.toLowerCase() !== note.toLowerCase())
              : [...parts(), note];
            input.value = next.join(', ').slice(0, MAX_NOTE);
            input.dispatchEvent(new Event('input'));
            paint();
          },
        }, note));
      }
    });
    paint();
    return row;
  }

  /** Say so and hand the field back, rather than save a discount that isn't. */
  const rejectDiscount = (input) => {
    toast('Enter the discount as a plain number, or clear the field', { icon: 'alert' });
    input.focus();
  };

  /* ---------- Catalog side ---------- */

  const searchInput = el('input.input.search-input', {
    type: 'search', placeholder: 'Search or scan', 'aria-label': 'Search products or scan a barcode',
    oninput: () => { search = searchInput.value; renderGrid(); },
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      submitSearch();
    },
  });
  const chipRow = el('div.chip-row', { role: 'group', 'aria-label': 'Filter by category' });
  const grid = el('div.product-grid');
  const arrangeBar = el('div.arrange-bar');

  /** Tiles a shop has pinned - for most counters, the only page they use. */
  const favorites = () => store.products.filter((p) => p.favorite);

  function renderChips() {
    // The filtered category can be deleted out from under us; fall back
    // to All instead of filtering by a ghost id. Favorites can empty out the
    // same way - the last pinned tile unpinned - and then it isn't a page.
    if (activeCat === 'fav' && !favorites().length && !arranging) activeCat = 'all';
    if (activeCat !== 'all' && activeCat !== 'fav' && !store.category(activeCat)) activeCat = 'all';
    keepFocus(chipRow, () => {
      clear(chipRow);
      const chips = [
        // First in the row, because it is the page a counter lives on.
        ...(favorites().length || activeCat === 'fav' ? [{ id: 'fav', name: 'Favorites' }] : []),
        { id: 'all', name: 'All' },
        ...store.categories,
      ];
      for (const c of chips) {
        chipRow.append(el('button.chip', {
          type: 'button',
          className: `chip${activeCat === c.id ? ' active' : ''}${c.id === 'fav' ? ' chip-fav' : ''}`,
          'aria-pressed': activeCat === c.id ? 'true' : 'false',
          html: c.id === 'fav' ? icon('star', 13, 2.2) : null,
          onclick: () => { activeCat = c.id; renderChips(); renderGrid(); },
        }, c.id === 'fav' ? ` ${c.name}` : c.name));
      }
      // Last, like the catalog's own "Edit categories": a shopkeeper's tool
      // sitting at the end of the cashier's row, out of the way of a queue.
      if (store.products.length > 1) {
        chipRow.append(el('button.chip.chip-ghost', {
          type: 'button',
          className: `chip chip-ghost${arranging ? ' active' : ''}`,
          'aria-pressed': arranging ? 'true' : 'false',
          html: icon('arrange', 13, 2),
          onclick: () => (arranging ? stopArranging() : startArranging()),
        }, arranging ? ' Done' : ' Arrange'));
      }
    });
  }

  /** Products the grid is currently showing, in the shop's own order. */
  function filteredProducts() {
    return store.productsInOrder().filter((p) =>
      (activeCat === 'all' || (activeCat === 'fav' ? p.favorite : p.categoryId === activeCat))
      && (matches(p.name, search) || matches(p.sku, search)));
  }

  /* ---------- Arrange mode ---------- */

  async function startArranging() {
    // Behind the same PIN as Settings, when one is set: the layout belongs to
    // the shop, and a cashier reshuffling it mid-shift is exactly what a
    // manager PIN is for.
    if (!(await requirePin('arrange the register'))) {
      renderChips();
      return;
    }
    arranging = true;
    // A filtered grid can still be arranged (the order of a subset lands
    // inside the whole one), but a *search* narrows it to a handful of
    // unrelated tiles, which is a confusing thing to drag things around in.
    search = '';
    searchInput.value = '';
    renderChips();
    renderGrid();
    grid.querySelector('.tile-move')?.focus();
  }

  function stopArranging() {
    arranging = false;
    drag = null;
    renderChips();
    renderGrid();
    chipRow.querySelector('.chip-ghost')?.focus();
  }

  /**
   * A tile, found again after the grid was rebuilt, so focus can follow the
   * button that was pressed.
   *
   * The id goes through CSS.escape because product ids are not always this
   * app's own - a restored backup carries whatever ids the file happened to
   * hold, which is why nothing here builds a *path* out of one unchecked
   * either. One containing a quote closed the attribute selector early and
   * threw a SyntaxError out of an async handler: the arrangement had already
   * saved, but the press ended in an unhandled rejection with focus on
   * nothing.
   */
  const tileControl = (id, control) =>
    grid.querySelector(`.product-tile[data-id="${CSS.escape(id)}"] .${control}`);

  /** Move one tile one place earlier or later within what the grid shows. */
  async function nudge(product, dir) {
    const list = filteredProducts();
    const at = list.findIndex((p) => p.id === product.id);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= list.length) return;
    const ids = list.map((p) => p.id);
    ids.splice(to, 0, ids.splice(at, 1)[0]);
    try {
      await store.reorderProducts(ids);
    } catch (err) {
      console.error(err);
      toast('Couldn’t save the arrangement. Check your connection', { icon: 'wifiOff' });
      return;
    }
    renderGrid();
    // The button that was pressed has moved with its tile; follow it, or a
    // keyboard user walks the grid one Tab at a time after every step.
    tileControl(product.id, `tile-move-${dir > 0 ? 'later' : 'earlier'}`)?.focus();
  }

  async function toggleFavorite(product) {
    try {
      await store.setFavorite(product.id, !product.favorite);
    } catch (err) {
      console.error(err);
      toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
      return;
    }
    renderChips();
    renderGrid();
    tileControl(product.id, 'tile-star')?.focus();
  }

  /**
   * Drag a tile with a finger or a mouse. Pointer events rather than HTML5
   * drag-and-drop, which does nothing at all on a touch screen - and this is
   * a tablet app. The DOM is reordered live under the pointer and committed
   * once on release; Move earlier / Move later do the same job for anyone not
   * using a pointer at all.
   */
  function beginDrag(e, product, tile) {
    if (!arranging || (e.button !== undefined && e.button !== 0)) return;
    // The tile's own controls are buttons; a press on one is not a drag.
    if (e.target instanceof Element && e.target.closest('button')) return;
    drag = { id: product.id, tile, x: e.clientX, y: e.clientY, moved: false, pointerId: e.pointerId };
    tile.setPointerCapture?.(e.pointerId);
  }

  function moveDrag(e) {
    if (!drag) return;
    if (!drag.moved) {
      // A few pixels of slop, so a tap that wobbles isn't a rearrangement.
      if (Math.abs(e.clientX - drag.x) < 6 && Math.abs(e.clientY - drag.y) < 6) return;
      drag.moved = true;
      drag.tile.classList.add('dragging');
      grid.classList.add('dragging-grid');
    }
    e.preventDefault();
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const target = under instanceof Element ? under.closest('.product-tile') : null;
    if (!target || target === drag.tile || target.parentElement !== grid) return;
    // Which side to land on: whichever way the tile is travelling.
    const after = drag.tile.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING;
    grid.insertBefore(drag.tile, after ? target.nextSibling : target);
  }

  async function endDrag() {
    if (!drag) return;
    const { tile, moved } = drag;
    drag = null;
    tile.classList.remove('dragging');
    grid.classList.remove('dragging-grid');
    if (!moved) return;
    const ids = [...grid.querySelectorAll('.product-tile[data-id]')].map((n) => n.dataset.id);
    try {
      await store.reorderProducts(ids);
    } catch (err) {
      console.error(err);
      toast('Couldn’t save the arrangement. Check your connection', { icon: 'wifiOff' });
      renderGrid();   // back to the order the cloud actually holds
      return;
    }
    renderGrid();
  }

  /**
   * One tap for a shop that would rather not arrange anything by hand. The
   * data is already in the month files Top products reads.
   */
  async function sortByBestSelling(btn) {
    const ok = await confirmDialog({
      title: 'Sort by best-selling?',
      message: 'The grid is arranged by what actually sold over the last 30 days, best first. This replaces the arrangement you have now.',
      confirmLabel: 'Sort the grid',
      danger: false,
    });
    if (!ok) return;
    btn.disabled = true;
    let sales;
    try {
      sales = await store.salesInRange(daysAgoISO(29), todayISO());
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      toast('Couldn’t read your sales. Check your connection', { icon: 'wifiOff' });
      return;
    }
    const sold = new Map();
    for (const s of sales) {
      if (s.voidedAt) continue;
      for (const l of s.lines || []) {
        // Refund lines carry negative quantities, so a returned item counts
        // itself back out - the same arithmetic Top products uses.
        if (l.productId) sold.set(l.productId, (sold.get(l.productId) || 0) + l.qty);
      }
    }
    const ordered = store.productsInOrder();
    const rank = new Map(ordered.map((p, i) => [p.id, i]));
    const ids = [...ordered]
      // Anything that didn't sell keeps the order it already had, after
      // everything that did - a quiet product isn't shuffled at random.
      .sort((a, b) => (sold.get(b.id) || 0) - (sold.get(a.id) || 0) || rank.get(a.id) - rank.get(b.id))
      .map((p) => p.id);
    try {
      await store.reorderProducts(ids);
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      toast('Couldn’t save the arrangement. Check your connection', { icon: 'wifiOff' });
      return;
    }
    btn.disabled = false;
    renderGrid();
    toast(sold.size ? 'Grid sorted by best-selling' : 'No sales in the last 30 days, so nothing moved',
      { icon: sold.size ? 'circleCheck' : 'alert' });
  }

  function renderArrangeBar() {
    clear(arrangeBar);
    arrangeBar.classList.toggle('open', arranging);
    if (!arranging) return;
    const sortBtn = el('button.btn.btn-ghost.btn-sm', {
      type: 'button', html: icon('chart', 14, 2),
      onclick: (e) => sortByBestSelling(e.currentTarget),
    }, ' Sort by best-selling');
    arrangeBar.append(
      el('span.arrange-say', {},
        el('strong', {}, 'Arranging'),
        ' — drag a tile, or use its arrows. Tap the star to pin it to Favorites.'),
      el('div.row', { style: { flex: 'none' } },
        sortBtn,
        el('button.btn.btn-primary.btn-sm', { type: 'button', onclick: stopArranging }, 'Done'))
    );
  }

  function renderGrid() {
    // A tile is mid-flight under somebody's finger; rebuilding the grid would
    // yank it out of their hand (a store event can land at any moment).
    if (drag) return;
    clear(grid);
    renderArrangeBar();
    const list = filteredProducts();

    if (!store.products.length) {
      grid.append(el('div.empty.grid-empty', {},
        el('div.empty-icon', { html: icon('packageOpen', 28) }),
        el('h3', {}, 'No products yet'),
        el('p', {}, 'Add your catalog in the Products tab, or ring up a one-off item below.'),
        el('a.btn.btn-primary', { href: '#/products', style: { marginTop: '4px' } }, 'Add products')
      ));
    } else if (!list.length) {
      grid.append(emptyGrid());
    }

    list.forEach((p, at) => {
      grid.append(arranging ? arrangeTile(p, at, list.length) : sellTile(p));
    });

    // Not while arranging: a one-off item has no place in the catalog's
    // order, and the tile would be one more thing to try to drag.
    if (!arranging) {
      grid.append(el('button.product-tile.tile-custom', {
        type: 'button', onclick: openCustomItem,
        'aria-label': 'Add a custom item',
      },
        el('span.tile-plus', { html: icon('plus', 20, 2) }),
        el('span.tile-name', {}, 'Custom item')
      ));
    }
  }

  /**
   * Why the grid is empty, and what to do about it. A search that matches
   * nothing *here* while matching elsewhere is the common case now that
   * Favorites is a six-tile page: saying "nothing matches" would be a lie
   * about the catalog.
   */
  function emptyGrid() {
    if (activeCat === 'fav' && !search) {
      return el('div.empty.grid-empty', {},
        el('div.empty-icon', { html: icon('star', 26) }),
        el('h3', {}, 'No favorites yet'),
        el('p', {}, 'Arrange the grid and tap a tile’s star to pin the things you sell all day.'),
        el('button.btn.btn-ghost', { onclick: startArranging, style: { marginTop: '4px' } }, 'Arrange the grid'));
    }
    const elsewhere = search
      ? store.products.filter((p) => matches(p.name, search) || matches(p.sku, search)).length
      : 0;
    if (!elsewhere) {
      return el('div.empty.grid-empty', {}, el('p', {}, 'Nothing matches your search.'));
    }
    return el('div.empty.grid-empty', {},
      el('p', {}, `Nothing here matches, but ${plural(elsewhere, 'product')} elsewhere in your catalog ${elsewhere === 1 ? 'does' : 'do'}.`),
      el('button.btn.btn-ghost', {
        style: { marginTop: '4px' },
        onclick: () => { activeCat = 'all'; renderChips(); renderGrid(); },
      }, 'Search all products'));
  }

  /** The tile as a cashier uses it: one tap, one line in the sale. */
  function sellTile(p) {
    const out = p.stock !== null && p.stock !== undefined && p.stock <= 0;
    // An aria-label stands in for everything inside the tile, so a badge it
    // doesn't repeat is a badge a screen reader never reaches: the grid
    // announced "Add Ceramic mug, $16.00" over a tile that said, in red,
    // that there were none left.
    const action = isMeasured(p)
      ? `Weigh ${p.name}, ${money(p.price)} per ${p.unit}`
      : hasOptions(p)
        ? `Choose options for ${p.name}, from ${money(p.price)}`
        : `Add ${p.name}, ${money(p.price)}`;
    const tile = el('button.product-tile', {
      type: 'button',
      className: `product-tile slot-${p.slot || 1}${out ? ' out' : ''}`,
      dataset: { id: p.id },
      onclick: () => pickProduct(p),
      'aria-label': out ? `${action}, out of stock` : action,
    },
      el('span.tile-name', {}, p.name),
      el('span.tile-foot', {},
        el('span.tile-price', {}, isMeasured(p) ? `${money(p.price)}/${p.unit}` : money(p.price)),
        hasOptions(p) && el('span.tile-opts', {
          html: icon('sliders', 13, 2), title: groupSummary(p.options),
        })),
      out && el('span.tile-badge', {}, 'Out of stock')
    );
    // The photo arrives when it arrives; the colored tile stands until then.
    dressTile(tile, p);
    return tile;
  }

  /**
   * The same tile while arranging: a div rather than a button, because the
   * controls on it are buttons and a button cannot hold buttons. The tile
   * itself is the drag handle; the three buttons are what a keyboard or a
   * screen reader uses, and they say the product's name so the grid doesn't
   * read as thirty identical "Move earlier"s.
   *
   * `at` and `count` are the tile's place in the grid the caller is already
   * walking. The tile used to work them out itself, which meant sorting and
   * filtering the whole catalog once per tile: at 800 products a single
   * arrange render spent 51ms doing nothing but that, and the cost is
   * quadratic - past a thousand or so, every tap of an arrow froze the
   * register for the better part of a second (twice, since the store's own
   * change event re-renders the grid as well).
   */
  function arrangeTile(p, at, count) {
    const tile = el('div.product-tile.arranging', {
      className: `product-tile arranging slot-${p.slot || 1}`,
      dataset: { id: p.id },
      onpointerdown: (e) => beginDrag(e, p, tile),
      onpointermove: moveDrag,
      onpointerup: endDrag,
      onpointercancel: endDrag,
    },
      el('button.icon-btn.tile-star', {
        type: 'button',
        className: `icon-btn tile-star${p.favorite ? ' on' : ''}`,
        html: icon('star', 16, 2),
        title: p.favorite ? 'Unpin from Favorites' : 'Pin to Favorites',
        'aria-label': `${p.favorite ? 'Unpin' : 'Pin'} ${p.name} ${p.favorite ? 'from' : 'to'} Favorites`,
        'aria-pressed': p.favorite ? 'true' : 'false',
        onclick: () => toggleFavorite(p),
      }),
      el('span.tile-name', {}, p.name),
      el('span.tile-foot.tile-arrange-foot', {},
        el('button.icon-btn.tile-move.tile-move-earlier', {
          type: 'button',
          html: icon('chevL', 16, 2.4),
          title: 'Move earlier',
          'aria-label': `Move ${p.name} earlier in the grid`,
          disabled: at <= 0,
          onclick: () => nudge(p, -1),
        }),
        el('span.tile-pos', {}, `${at + 1}`),
        el('button.icon-btn.tile-move.tile-move-later', {
          type: 'button',
          html: icon('chevR', 16, 2.4),
          title: 'Move later',
          'aria-label': `Move ${p.name} later in the grid`,
          disabled: at >= count - 1,
          onclick: () => nudge(p, 1),
        }))
    );
    dressTile(tile, p);
    return tile;
  }

  /**
   * Add one of `product`, with an option combination if it has any. Identical
   * combinations merge into one line; different ones stay apart.
   */
  function addToCart(product, options = null) {
    const tax = store.taxFor(product);
    const unitPrice = options?.length ? optionUnitPrice(product.price, options) : product.price;
    const key = optionsKey(options);
    // A line with a note stays its own line: two flat whites, one of them
    // decaf, are two lines - merging them would lose which was which.
    const existing = cart.find((l) => l.productId === product.id
      && !l.discount && !l.note && l.unitPrice === unitPrice && optionsKey(l.options) === key);
    if (existing) {
      existing.qty++;
    } else {
      cart.push({
        productId: product.id, name: product.name, unitPrice,
        qty: 1, taxRate: tax?.rate || 0, taxName: tax?.name || '', discount: null,
        ...(options?.length ? { options } : {}),
      });
    }
    const line = existing || cart[cart.length - 1];
    flashLine = line;
    renderCart();
    return line;
  }

  /**
   * A tile tap: straight into the cart, into the option picker, or - for
   * products sold by measure - into the quantity pad, since "+1" of a
   * per-kilo product is a question, not an answer.
   */
  function pickProduct(product) {
    if (isMeasured(product)) openQuantityPad(product);
    else if (hasOptions(product)) openOptionPicker(product);
    else addToCart(product);
  }

  /**
   * The weight/measure entry pad. The cashier types what the scale says;
   * the line total is shown live and computed exactly once, in cents. Every
   * weighing is its own line - two batches of apples don't merge.
   */
  function openQuantityPad(product) {
    const tax = store.taxFor(product);
    const unit = product.unit || 'unit';
    const qtyInput = el('input.input.pay-tender', {
      type: 'text', inputmode: 'decimal', placeholder: '0.000',
      'aria-label': `Quantity in ${unit}`,
    });
    const totalRow = el('div.pay-change', { 'aria-live': 'polite' });
    const addBtn = el('button.btn.btn-primary.btn-block.charge-btn', { type: 'submit' }, 'Add');
    const renderTotal = () => {
      const qty = parseQty(qtyInput.value);
      addBtn.disabled = qty === null;
      clear(totalRow);
      if (qty === null) {
        addBtn.textContent = 'Add';
        return;
      }
      const total = fromCents(Math.round(toCents(product.price) * qty));
      totalRow.append(el('span', {}, `${qty} ${unit} × ${money(product.price)}/${unit} = `), el('strong', {}, money(total)));
      addBtn.textContent = `Add · ${money(total)}`;
    };
    qtyInput.addEventListener('input', renderTotal);

    const form = el('form', {
      onsubmit: (e) => {
        e.preventDefault();
        const qty = parseQty(qtyInput.value);
        if (qty === null) { qtyInput.focus(); return; }
        cart.push({
          productId: product.id, name: product.name, unitPrice: product.price,
          qty, unit, taxRate: tax?.rate || 0, taxName: tax?.name || '', discount: null,
        });
        flashLine = cart[cart.length - 1];
        modal.close();
        renderCart();
      },
    },
      el('p.small.muted', { style: { marginBottom: '14px' } },
        `${money(product.price)} per ${unit}. Type the amount from the scale.`),
      el('div.field', {}, el('label.label', {}, `Quantity (${unit})`), qtyInput),
      totalRow,
      addBtn
    );
    const modal = openModal({ title: product.name, content: form });
    qtyInput.focus();
    renderTotal();
  }

  /**
   * One screen, one decision per group. Required groups arrive preselected so
   * the common case is a single tap on Add; the button carries the live price
   * so a delta is never a surprise at the total.
   */
  function openOptionPicker(product, { selection: initial = null, onPick = null } = {}) {
    let selection = initial ? structuredClone(initial) : defaultSelection(product);
    const body = el('div');
    const modal = openModal({ title: product.name, content: body });

    // Every chip rebuilds the whole picker, so the chip just pressed is gone
    // by the time the press finishes - keepFocus hands focus to its
    // replacement instead of dropping it to <body> on every choice.
    const render = () => keepFocus(body, paint);

    function paint() {
      clear(body);
      for (const group of product.options) {
        const chips = el('div.chip-row.opt-chips', { role: group.multi ? 'group' : 'radiogroup', 'aria-label': group.name });
        const picked = selection[group.id] || [];

        // Optional single-select needs a way back to nothing at all.
        if (!group.required && !group.multi) {
          chips.append(el('button.chip', {
            type: 'button',
            className: `chip${picked.length ? '' : ' active'}`,
            role: 'radio', 'aria-checked': picked.length ? 'false' : 'true',
            onclick: () => { selection[group.id] = []; render(); },
          }, 'None'));
        }

        for (const choice of group.choices) {
          const on = picked.includes(choice.id);
          const delta = formatDelta(choice.delta, money);
          chips.append(el('button.chip', {
            type: 'button',
            className: `chip${on ? ' active' : ''}`,
            role: group.multi ? null : 'radio',
            'aria-checked': group.multi ? null : (on ? 'true' : 'false'),
            'aria-pressed': group.multi ? (on ? 'true' : 'false') : null,
            onclick: () => {
              if (group.multi) {
                selection[group.id] = on ? picked.filter((id) => id !== choice.id) : [...picked, choice.id];
              } else {
                // Tapping the chosen one again clears it, unless it's required.
                selection[group.id] = on && !group.required ? [] : [choice.id];
              }
              render();
            },
          }, delta ? `${choice.name} ${delta}` : choice.name));
        }

        body.append(el('div.opt-group', {},
          el('div.opt-head', {},
            el('span.opt-name', {}, group.name),
            el('span.opt-rule', {}, [
              group.required ? 'Required' : 'Optional',
              group.multi ? 'choose any' : 'choose one',
            ].join(' · '))
          ),
          chips
        ));
      }

      const options = selectionOptions(product, selection);
      const unitPrice = optionUnitPrice(product.price, options);
      const valid = selectionValid(product, selection);
      body.append(
        options.length
          ? el('p.opt-picked', {}, optionsLabel(options))
          : el('p.opt-picked.muted', {}, 'No options chosen'),
        el('button.btn.btn-primary.btn-block.charge-btn', {
          type: 'button',
          disabled: !valid,
          onclick: () => {
            modal.close();
            if (onPick) onPick(options, unitPrice);
            else addToCart(product, options);
          },
        }, valid ? `${onPick ? 'Save' : 'Add'} · ${money(unitPrice)}` : 'Choose the required options')
      );
    }
    render();
  }

  /* ---------- Barcode scanning ---------- */

  /**
   * One code, from a wedge scanner, the camera, or Enter in the search box.
   * An exact SKU rings up hands-free; duplicates fall back to the filtered
   * grid (the app can't guess which product was meant); an unknown code
   * offers the two things a cashier can actually do about it.
   */
  function handleScan(code) {
    const found = findBySku(store.products, code);

    if (found.length === 1) {
      const product = found[0];
      // A barcode names the product, not the size, the milk, or the weight -
      // those still have to be asked, so the right sheet opens instead of
      // guessing.
      if (isMeasured(product) || hasOptions(product)) {
        clearSearch();
        pickProduct(product);
        return;
      }
      const line = addToCart(product);
      // Tracked stock the cart has already outrun is worth flagging, but never
      // worth blocking - the item is in the customer's hand either way.
      const tracked = product.stock !== null && product.stock !== undefined;
      const short = tracked && line.qty > product.stock;
      toast(`${product.name} · ${line.qty} in cart${short ? ' · over stock' : ''}`, {
        icon: short ? 'alert' : 'scan',
        duration: 1600,
      });
      clearSearch();
      return;
    }

    if (found.length > 1) {
      search = code;
      searchInput.value = code;
      // The clashing products may all live outside the active category
      // filter - a grid showing none of them under a toast that says N
      // products share the code would read as a lie.
      if (activeCat !== 'all') {
        activeCat = 'all';
        renderChips();
      }
      renderGrid();
      toast(`${found.length} products share the code ${code}`, { icon: 'alert' });
      return;
    }

    openUnknownCode(code);
  }

  function clearSearch() {
    if (!search) return;
    search = '';
    searchInput.value = '';
    renderGrid();
  }

  /**
   * Enter in the search box. A scanned code lands here when the box happens
   * to hold focus, so an exact SKU (or the single remaining match) rings up;
   * a half-typed word is left alone, since the grid already answers it.
   */
  function submitSearch() {
    const text = search.trim();
    if (!text) return;
    if (findBySku(store.products, text).length) { handleScan(text); return; }
    const shown = filteredProducts();
    if (shown.length === 1) {
      if (isMeasured(shown[0]) || hasOptions(shown[0])) {
        const product = shown[0];
        clearSearch();
        pickProduct(product);
        return;
      }
      const line = addToCart(shown[0]);
      toast(`${shown[0].name} · ${line.qty} in cart`, { icon: 'scan', duration: 1600 });
      clearSearch();
      return;
    }
    if (!shown.length && looksLikeBarcode(text)) openUnknownCode(text);
  }

  function openUnknownCode(code) {
    const body = el('div', {},
      el('div.scan-code', {}, code),
      el('p.small.muted', { style: { marginBottom: '16px' } },
        'No product in your catalog uses this code.'),
      el('button.btn.btn-primary.btn-block', {
        type: 'button',
        html: icon('package', 16, 2),
        onclick: () => {
          modal.close();
          // Created here, sold immediately - that's the whole point of the flow.
          openProductForm(null, {
            prefill: { sku: code },
            onSaved: (product) => {
              clearSearch();
              renderGrid();
              // Made with options or a measure in the same breath: the
              // register still has to ask, exactly as a tile tap would.
              if (isMeasured(product) || hasOptions(product)) {
                pickProduct(product);
                return;
              }
              const line = addToCart(product);
              toast(`${product.name} · ${line.qty} in cart`, { icon: 'scan', duration: 1600 });
            },
          });
        },
      }, ' Add a product with this SKU'),
      el('button.btn.btn-ghost.btn-block', {
        type: 'button', style: { marginTop: '10px' },
        html: icon('plus', 16, 2),
        onclick: () => { modal.close(); clearSearch(); openCustomItem(); },
      }, ' Ring up as a one-off item')
    );
    const modal = openModal({ title: 'Unknown barcode', content: body });
  }

  function openCustomItem() {
    // The visible .label is a sibling, not a wrapper: without these the field
    // announces as its placeholder, or as nothing at all.
    const nameInput = el('input.input', { type: 'text', placeholder: 'Custom item', maxLength: 60, 'aria-label': 'Name' });
    const priceInput = el('input.input', { type: 'text', inputmode: 'decimal', placeholder: '0.00', required: true, 'aria-label': 'Price' });
    const defaultTax = store.tax(store.settings.defaultTaxId);
    let taxChoice = defaultTax?.id || 'none';

    const form = el('form', {
      onsubmit: (e) => {
        e.preventDefault();
        const price = parseAmount(priceInput.value);
        // Say why nothing happened. A figure parseAmount won't take - '1,000',
        // which is a thousand on one keyboard and one on another - otherwise
        // left the cashier tapping "Add to sale" at a sheet that just sat there.
        if (price === null) {
          toast('Enter the price as a plain number', { icon: 'alert' });
          priceInput.focus();
          return;
        }
        const tax = taxChoice === 'none' ? null : store.tax(taxChoice);
        cart.push({
          productId: null, name: nameInput.value.trim() || 'Custom item',
          unitPrice: price, qty: 1,
          taxRate: tax?.rate || 0, taxName: tax?.name || '', discount: null,
        });
        modal.close();
        renderCart();
      },
    },
      el('div.field', {}, el('label.label', {}, 'Name'), nameInput),
      el('div.field', {}, el('label.label', {}, 'Price'), priceInput),
      store.taxes.length ? el('div.field', {},
        el('label.label', {}, 'Tax'),
        el('div.select-wrap', {}, el('select.select', {
          'aria-label': 'Tax rate',
          onchange: (e) => { taxChoice = e.target.value; },
        },
          store.taxes.map((t) => el('option', {
            value: t.id, selected: t.id === taxChoice,
          }, `${t.name} · ${t.rate}%`)),
          el('option', { value: 'none', selected: taxChoice === 'none' }, 'Tax-free')
        ))
      ) : null,
      el('button.btn.btn-primary.btn-block', { type: 'submit', style: { marginTop: '6px' } }, 'Add to sale')
    );
    const modal = openModal({ title: 'Custom item', content: form });
    priceInput.focus();
  }

  /* ---------- Cart side ---------- */

  const cartLines = el('div.cart-lines');
  const cartFoot = el('div.cart-foot');

  const clearBtn = el('button.btn.btn-ghost.btn-sm.cart-clear', {
    onclick: () => {
      if (!cart.length) return;
      const prevCart = cart;
      const prevDiscount = orderDiscount;
      const prevRedeeming = redeeming;
      const prevRedeemingOn = redeemingOn;
      const prevCustomer = customer;
      cart = []; orderDiscount = null; redeeming = null; redeemingOn = null; customer = null;
      renderCart();
      toast('Sale cleared', {
        icon: 'trash',
        action: {
          label: 'Undo',
          onClick: () => {
            // Only restore while nothing new was rung up - undo must
            // never eat a sale that started in the meantime.
            if (cart.length) return;
            cart = prevCart;
            orderDiscount = prevDiscount;
            redeeming = prevRedeeming;
            redeemingOn = prevRedeemingOn;
            customer = prevCustomer;
            renderCart();
          },
        },
      });
    },
  }, 'Clear');

  const holdBtn = el('button.btn.btn-ghost.btn-sm', {
    html: icon('pause', 14, 2.2),
    title: 'Park this sale and serve the next customer',
    onclick: openHoldForm,
  }, ' Hold');

  const cartPanel = el('aside.reg-cart', { 'aria-label': 'Current sale' },
    el('div.cart-head', {},
      el('h2.cart-title', {}, 'Current sale'),
      el('button.icon-btn.cart-close', {
        html: icon('chevD', 20), 'aria-label': 'Close cart', onclick: () => toggleSheet(false),
      }),
      holdBtn,
      clearBtn
    ),
    cartLines,
    cartFoot
  );
  const scrim = el('div.cart-scrim', { onclick: () => toggleSheet(false) });
  const cartBar = el('button.cart-bar', { type: 'button', onclick: () => toggleSheet(true) });

  /** Narrow enough that the cart is a bottom sheet, not a docked panel. */
  const sheetMedia = matchMedia('(max-width: 999px)');
  /** Wide enough that the sidebar shows - and stays outside the sheet's scrim. */
  const sidebarMedia = matchMedia('(min-width: 920px)');

  /**
   * Everything the cart scrim covers: every sibling of the sheet's own
   * ancestors, up to the app root. The scrim blocks all of it to the pointer,
   * so the keyboard has to be blocked too - Tab used to walk out of the open
   * sheet into the dimmed product grid behind it, where thirty-odd tiles were
   * still focusable and Enter still rang them up.
   */
  function behindSheet() {
    const nodes = [];
    for (let n = cartPanel; n.parentElement && n.parentElement !== document.body; n = n.parentElement) {
      for (const sibling of n.parentElement.children) {
        if (sibling === n || sibling === scrim) continue;
        // In the 920-999px band the scrim starts at the sidebar's edge, so
        // navigation stays live there and must stay reachable.
        if (sidebarMedia.matches && sibling.classList.contains('sidebar')) continue;
        nodes.push(sibling);
      }
    }
    return nodes;
  }

  /** What this sheet has made inert, so it can hand every bit of it back. */
  let inerted = [];
  function holdFocusInSheet(on) {
    for (const n of inerted) n.removeAttribute('inert');
    inerted = on ? behindSheet() : [];
    for (const n of inerted) n.setAttribute('inert', '');
  }

  function toggleSheet(open) {
    const wasOpen = cartPanel.classList.contains('open');
    cartPanel.classList.toggle('open', open);
    scrim.classList.toggle('open', open);
    holdFocusInSheet(open && sheetMedia.matches);
    if (open) cartPanel.querySelector('.cart-close')?.focus();
    else if (wasOpen && cartBar.isConnected && !cartBar.classList.contains('hidden')) cartBar.focus();
  }

  // A rotation or a resize can dock the open sheet beside the grid, and a
  // docked cart covers nothing: whatever it was holding goes back.
  const onSheetMedia = () => holdFocusInSheet(sheetMedia.matches && cartPanel.classList.contains('open'));
  sheetMedia.addEventListener('change', onSheetMedia);
  sidebarMedia.addEventListener('change', onSheetMedia);

  // Escape closes the mobile cart sheet, unless a dialog is open above it
  // (the dialog owns Escape then).
  const onSheetKey = (e) => {
    if (e.key !== 'Escape' || !cartPanel.classList.contains('open')) return;
    if (document.querySelector('.modal-root:not(.closing)')) return;
    toggleSheet(false);
  };
  document.addEventListener('keydown', onSheetKey);

  /**
   * Wedge scanners type into whatever has focus, so the register listens at
   * the document while it is on screen. Typing in a field is left to that
   * field (the search box handles its own Enter); a dialog on top owns the
   * keyboard entirely.
   */
  const wedge = createWedgeReader({ onScan: handleScan });
  const onWedgeKey = (e) => {
    if (document.querySelector('.modal-root:not(.closing)')) { wedge.reset(); return; }
    const t = e.target;
    if (t instanceof HTMLElement
      && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
    if (wedge.handle(e, e.timeStamp || performance.now())) e.preventDefault();
  };
  document.addEventListener('keydown', onWedgeKey);

  function editLine(index) {
    const l = cart[index];
    // The row was rendered from the cart as it stood; a dataset replacement
    // (sample data in or out) can empty it before the tap lands.
    if (!l) return;
    const measured = !!l.unit;
    let qty = l.qty;
    let discount = l.discount ? { ...l.discount } : null;

    const qtyInput = el(measured ? 'input.input' : 'input.qty-input', {
      type: 'text', inputmode: measured ? 'decimal' : 'numeric',
      value: String(l.qty), 'aria-label': measured ? `Quantity in ${l.unit}` : 'Quantity',
    });
    // Typed values commit on change/blur and before every save or step;
    // anything unusable snaps back to the last good quantity.
    const commitQty = () => {
      if (measured) {
        const n = parseQty(qtyInput.value);
        if (n !== null) qty = n;
      } else {
        const n = Math.round(Number(qtyInput.value));
        if (Number.isFinite(n) && n >= 1) qty = Math.min(n, 9999);
      }
      qtyInput.value = String(qty);
    };
    qtyInput.addEventListener('change', commitQty);

    const discValue = el('input.input', {
      type: 'text', inputmode: 'decimal', placeholder: '0',
      value: discount?.value ?? '', 'aria-label': 'Discount value',
    });
    let discType = discount?.type || 'percent';
    const typeBtns = el('div.seg', { role: 'group', 'aria-label': 'Discount type' });
    const renderTypes = () => keepFocus(typeBtns, () => {
      clear(typeBtns);
      for (const { value, label, name } of discountTypeChoices(store.settings.currency)) {
        typeBtns.append(el('button.seg-btn', {
          type: 'button',
          className: `seg-btn${discType === value ? ' active' : ''}`,
          'aria-pressed': discType === value ? 'true' : 'false',
          'aria-label': name,
          onclick: () => { discType = value; renderTypes(); },
        }, label));
      }
    });
    renderTypes();

    const presetRow = store.discounts.length ? el('div.chip-row', {},
      store.discounts.map((d) => el('button.chip', {
        type: 'button',
        onclick: () => {
          discType = d.type;
          discValue.value = String(d.value);
          renderTypes();
        },
      }, d.name))
    ) : null;

    /* Chosen options, changeable while the product still offers them. The
       picker replaces this line in place, keeping quantity and discount. */
    const product = l.productId ? store.product(l.productId) : null;
    const optionsField = l.options?.length || hasOptions(product)
      ? el('div.field', {},
        el('label.label', {}, 'Options'),
        el('div.row', {},
          el('span.grow.small', { className: `grow small${l.options?.length ? '' : ' muted'}` },
            l.options?.length ? optionsLabel(l.options) : 'None chosen'),
          hasOptions(product) && el('button.btn.btn-ghost.btn-sm', {
            type: 'button',
            onclick: () => {
              commitQty();
              const pending = readDiscount(discValue, discType);
              if (pending === false) { rejectDiscount(discValue); return; }
              // The typed quantity, discount and note land now, as edits in
              // their own right: they used to ride along on onPick, so
              // dismissing the picker with Escape or the scrim silently
              // discarded them - and the note was discarded even when the
              // picker was seen through, since only the other two were
              // carried. Written onto the line itself rather than over its
              // slot - the object is what a cashed-in reward points at.
              const note = noteInput.value.trim().slice(0, MAX_NOTE);
              l.qty = qty;
              l.discount = pending;
              if (note) l.note = note;
              else delete l.note;
              renderCart();
              modal.close();
              openOptionPicker(product, {
                selection: optionsToSelection(product, l.options),
                onPick: (options, unitPrice) => {
                  l.unitPrice = unitPrice;
                  if (options.length) l.options = options;
                  else delete l.options;
                  renderCart();
                },
              });
            },
          }, 'Change'))
      )
      : null;

    /* "No ice", "for Sam", "gift wrap" - what option groups can't enumerate.
       It follows the line onto the receipt and the customer's copy. */
    const noteInput = el('input.input', {
      type: 'text', maxLength: MAX_NOTE, value: l.note || '',
      placeholder: 'e.g. no ice, extra hot',
      'aria-label': `Note for ${l.name}`,
    });

    const form = el('form', {
      onsubmit: (e) => {
        e.preventDefault();
        commitQty();
        const next = readDiscount(discValue, discType);
        if (next === false) { rejectDiscount(discValue); return; }
        const note = noteInput.value.trim().slice(0, MAX_NOTE);
        l.qty = qty;
        l.discount = next;
        if (note) l.note = note;
        else delete l.note;
        modal.close();
        renderCart();
      },
    },
      el('div.field', {},
        el('label.label', {}, measured ? `Quantity (${l.unit})` : 'Quantity'),
        // Steppers count things; a weighed line takes the scale's figure.
        measured ? qtyInput : el('div.qty-stepper', {},
          el('button.icon-btn.qty-btn', {
            type: 'button', html: icon('minus', 18, 2), 'aria-label': 'Decrease quantity',
            onclick: () => { commitQty(); qty = Math.max(1, qty - 1); qtyInput.value = String(qty); },
          }),
          qtyInput,
          el('button.icon-btn.qty-btn', {
            type: 'button', html: icon('plus', 18, 2), 'aria-label': 'Increase quantity',
            onclick: () => { commitQty(); qty = Math.min(9999, qty + 1); qtyInput.value = String(qty); },
          })
        )
      ),
      el('div.field', {},
        el('label.label', {}, 'Line discount'),
        el('div.row', {}, typeBtns, el('div.grow', {}, discValue))
      ),
      presetRow,
      optionsField,
      el('div.field', {},
        el('label.label', {}, 'Note'),
        noteInput,
        quickNoteChips(noteInput)),
      el('div.row.form-actions', {},
        el('button.btn.btn-ghost.btn-danger-ghost', {
          type: 'button',
          onclick: () => {
            // By identity, not by the position the sheet opened on.
            const at = cart.indexOf(l);
            if (at >= 0) cart.splice(at, 1);
            modal.close();
            renderCart();
          },
        }, 'Remove item'),
        el('button.btn.btn-primary.grow', { type: 'submit' }, 'Save')
      )
    );
    const modal = openModal({ title: l.name, content: form });
  }

  /* ---------- Held sales (parked orders) ---------- */

  /** Totals of a stored hold, re-derived from its lines at today's settings. */
  const holdTotals = (hold) => computeCart(hold.lines, {
    orderDiscount: hold.orderDiscount,
    pricesIncludeTax: store.settings.pricesIncludeTax,
  });

  /** '14:32 · $8.50' - enough to recognize a sale without naming it. */
  const autoLabel = (totals) => `${formatTime(Date.now())} · ${money(totals.total)}`;

  function openHoldForm() {
    if (!cart.length) return;
    const totals = cartTotals();
    // Dismissing the form mid-write would hand the register back while the
    // hold still lands: anything rung up in that window would be wiped when
    // it did. The sheet holds still until the write settles.
    let holding = false;
    const nameInput = el('input.input', {
      type: 'text', maxLength: 40, placeholder: 'e.g. blue jacket lady',
      'aria-label': 'Name for this held sale',
    });

    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true;
        holding = true;
        try {
          await store.addHold({
            label: autoLabel(totals),
            name: nameInput.value,
            lines: cart,
            orderDiscount,
          });
        } catch (err) {
          console.error(err);
          holding = false;
          btn.disabled = false;
          toast(err.message === 'Too many held sales.'
            ? 'Too many sales on hold. Resume or discard one first'
            : 'Couldn’t hold the sale. Check your connection', { icon: 'wifiOff' });
          return;
        }
        holding = false;
        cart = [];
        orderDiscount = null;
        // A held sale's reward is offered again when it is resumed: the card
        // is re-read from receipts then, so nothing is lost by dropping it.
        // The customer goes with it, for the same reason.
        redeeming = null;
        redeemingOn = null;
        customer = null;
        modal.close();
        renderCart();
        toast('Sale held. Resume it from Held sales', { icon: 'pause' });
      },
    },
      el('p.small.muted', { style: { marginBottom: '14px' } },
        `${plural(totals.itemCount, 'item')} · ${money(totals.total)}, parked until you pick it back up. The register clears for the next customer.`),
      el('div.field', {}, el('label.label', {}, 'Name (optional)'), nameInput),
      el('button.btn.btn-primary.btn-block', { type: 'submit' }, 'Hold sale')
    );
    const modal = openModal({ title: 'Hold this sale', content: form, canClose: () => !holding });
    nameInput.focus();
  }

  /** Park whatever is in the register right now, without asking for a name. */
  async function holdCurrentSilently() {
    const totals = cartTotals();
    await store.addHold({ label: autoLabel(totals), lines: cart, orderDiscount });
  }

  async function resumeHold(hold) {
    if (cart.length) {
      // Two carts, one register: the cashier decides, nothing is merged or
      // dropped behind their back.
      const choice = await chooseDialog({
        title: 'A sale is already open',
        message: `The register has ${plural(cartTotals().itemCount, 'item')} in it. What should happen to them?`,
        options: [
          { value: 'hold', label: 'Hold it too, then resume', primary: true, hint: 'Both sales stay available' },
          { value: 'discard', label: 'Discard it and resume', danger: true, hint: 'The open sale is lost' },
        ],
      });
      if (!choice) return;
      if (choice === 'hold') {
        try {
          await holdCurrentSilently();
        } catch (err) {
          console.error(err);
          toast('Couldn’t hold the open sale. Nothing was changed', { icon: 'wifiOff' });
          return;
        }
      }
    }

    // Deep-copied so editing the resumed cart can't reach back into the store.
    cart = structuredClone(hold.lines);
    orderDiscount = hold.orderDiscount ? { ...hold.orderDiscount } : null;
    redeeming = null;
    redeemingOn = null;
    customer = null;
    renderCart();
    toggleSheet(true);
    try {
      await store.removeHold(hold.id);
    } catch (err) {
      console.error(err);
      toast('Resumed, but the held copy couldn’t be cleared', { icon: 'alert' });
      return;
    }
    toast(`Resumed ${hold.name || hold.label}`, { icon: 'play' });
  }

  function openHeldSales() {
    const body = el('div');
    const modal = openModal({ title: 'Held sales', content: body });

    // Discarding a hold rebuilds the list the discard button lives in.
    const render = () => keepFocus(body, paint);

    function paint() {
      clear(body);
      if (!store.holds.length) {
        body.append(el('div.empty', {},
          el('div.empty-icon', { html: icon('pause', 24) }),
          el('h3', {}, 'Nothing on hold'),
          el('p', {}, 'Park a sale with Hold when a customer steps away, and it waits here.')));
        return;
      }
      const list = el('div.card-list');
      for (const hold of store.holds) {
        const totals = holdTotals(hold);
        list.append(el('div.hold-row', {},
          el('button.hold-main', {
            type: 'button',
            onclick: () => { modal.close(); resumeHold(hold); },
            'aria-label': `Resume ${hold.name || hold.label}, ${money(totals.total)}`,
          },
            el('span.card-main', {},
              el('span.card-title', {}, hold.name || hold.label),
              el('span.card-sub', {}, [
                hold.name ? hold.label : null,
                plural(totals.itemCount, 'item'),
                formatAgo(hold.createdAt),
              ].filter(Boolean).join(' · '))
            ),
            el('span.card-amount', {}, money(totals.total))
          ),
          el('button.icon-btn', {
            type: 'button',
            html: icon('trash', 17, 2),
            'aria-label': `Discard ${hold.name || hold.label}`,
            title: 'Discard this held sale',
            onclick: async () => {
              const ok = await confirmDialog({
                // The auto label already carries the total; don't say it twice.
                title: 'Discard held sale?',
                message: `${hold.name ? `${hold.name} · ${money(totals.total)}` : hold.label} is thrown away, along with its ${plural(totals.itemCount, 'item')}. This can’t be undone.`,
                confirmLabel: 'Discard',
              });
              if (!ok) return;
              try {
                await store.removeHold(hold.id);
              } catch (err) {
                console.error(err);
                toast('Couldn’t discard. Check your connection', { icon: 'wifiOff' });
                return;
              }
              render();
              // Nothing left to hold: the sheet goes, and so does the
              // button that opened it, so focus has nowhere of its own to
              // return to - hand it to the register's search box.
              if (!store.holds.length) {
                modal.close();
                setTimeout(() => searchInput.focus(), 220);
              }
            },
          })
        ));
      }
      body.append(list);
    }
    render();
  }

  const heldBtn = el('button.btn.btn-ghost.held-btn', {
    type: 'button',
    onclick: openHeldSales,
  });

  /* ---------- Cash drawer ---------- */

  const drawerBtn = el('button.btn.btn-ghost.drawer-btn', {
    type: 'button',
    html: icon('coins', 18, 1.8),
    'aria-label': 'Cash drawer',
    title: 'Cash drawer',
    onclick: () => openDrawerSheet(),
  });

  /**
   * The day's float is worth asking for once, not demanding. An unstarted day
   * marks the drawer button and says so in a dismissible toast; selling is
   * never blocked on the ceremony.
   */
  async function checkDrawer() {
    let started = false;
    try {
      started = await drawerStartedOn();
    } catch (err) {
      console.error(err);
      return;
    }
    drawerBtn.classList.toggle('needs-start', !started);
    if (started || promptedForFloat) return;
    // Toasts paint above the modal layer, so never nudge over an open dialog -
    // on first run this fired on top of the welcome screen, asking for a cash
    // float before the store existed. The marker stays; the toast waits for a
    // quiet moment (the flag isn't spent, so the next check shows it).
    if (document.querySelector('.modal-root:not(.closing)')) return;
    promptedForFloat = true;
    toast('Start the day with an opening float to reconcile the drawer tonight', {
      icon: 'coins',
      duration: 8000,
      action: { label: 'Start', onClick: () => openDrawerSheet() },
    });
  }

  function renderHeld() {
    const n = store.holds.length;
    clear(heldBtn);
    heldBtn.append(
      // 18 at 1.8, like the drawer and camera glyphs it stands between:
      // at 17 and a heavier stroke it read as the bolder of the three.
      el('span.held-ic', { html: icon('pause', 18, 1.8) }),
      el('span.held-count', {}, String(n))
    );
    heldBtn.title = `${plural(n, 'sale')} on hold`;
    heldBtn.setAttribute('aria-label', `Held sales, ${plural(n, 'sale')} on hold`);
    // No holds, no button: the Hold action in the cart is what teaches this.
    heldBtn.classList.toggle('hidden', n === 0);
  }

  function openOrderDiscount() {
    let discType = orderDiscount?.type || 'percent';
    const discValue = el('input.input', {
      type: 'text', inputmode: 'decimal', placeholder: '0',
      value: orderDiscount?.value ?? '', 'aria-label': 'Discount value',
    });
    const typeBtns = el('div.seg', { role: 'group', 'aria-label': 'Discount type' });
    const renderTypes = () => keepFocus(typeBtns, () => {
      clear(typeBtns);
      for (const { value, label, name } of discountTypeChoices(store.settings.currency)) {
        typeBtns.append(el('button.seg-btn', {
          type: 'button',
          className: `seg-btn${discType === value ? ' active' : ''}`,
          'aria-pressed': discType === value ? 'true' : 'false',
          'aria-label': name,
          onclick: () => { discType = value; renderTypes(); },
        }, label));
      }
    });
    renderTypes();

    const form = el('form', {
      onsubmit: (e) => {
        e.preventDefault();
        const next = readDiscount(discValue, discType);
        if (next === false) { rejectDiscount(discValue); return; }
        orderDiscount = next;
        modal.close();
        renderCart();
      },
    },
      store.discounts.length ? el('div.field', {},
        el('label.label', {}, 'Presets'),
        el('div.chip-row', {}, store.discounts.map((d) => el('button.chip', {
          type: 'button',
          onclick: () => {
            orderDiscount = { type: d.type, value: d.value, name: d.name };
            modal.close();
            renderCart();
          },
        }, `${d.name} · ${d.type === 'percent' ? `${d.value}%` : money(d.value)}`)))
      ) : null,
      el('div.field', {},
        el('label.label', {}, 'Custom discount'),
        el('div.row', {}, typeBtns, el('div.grow', {}, discValue))
      ),
      el('div.row.form-actions', {},
        orderDiscount && el('button.btn.btn-ghost.btn-danger-ghost', {
          type: 'button',
          onclick: () => { orderDiscount = null; modal.close(); renderCart(); },
        }, 'Remove'),
        el('button.btn.btn-primary.grow', { type: 'submit' }, 'Apply')
      )
    );
    const modal = openModal({ title: 'Discount on sale', content: form });
    discValue.focus();
  }

  function renderCart() {
    // Before anything is priced, shown, or autosaved: an edit may have taken
    // away the discount a reward was standing on.
    checkReward();
    const totals = cartTotals();
    clear(cartLines);
    if (!cart.length) {
      cartLines.append(el('div.cart-empty', {},
        el('span', { html: icon('cart', 24, 1.6) }),
        el('p', {}, 'Tap products to start a sale')));
    }
    cart.forEach((l, i) => {
      const computed = totals.lines[i];
      // The line's own discount only. computed.discountAmount also folds in
      // the order discount's prorated share - subtracting that here shrank
      // every row while the same money showed again as the chip and the
      // Discounts total, and the rows stopped summing to the Subtotal line.
      // The printed receipt keeps lines whole too.
      const ownDiscount = fromCents(discountCents(toCents(computed.subtotal), l.discount));
      const flashed = l === flashLine;
      cartLines.append(el('button.cart-line', {
        type: 'button',
        className: `cart-line${flashed ? ' flash' : ''}`,
        onclick: () => editLine(i),
        // The row's own contents are unreachable behind this label, and two
        // lines of the same product differ only by their options - without
        // them the sale read as "Latte" twice, at no stated price.
        'aria-label': [
          `Edit ${l.name}`,
          l.options?.length ? optionsLabel(l.options) : null,
          l.note || null,
          `quantity ${l.qty}${l.unit ? ` ${l.unit}` : ''}`,
          money(computed.subtotal - ownDiscount),
        ].filter(Boolean).join(', '),
      },
        el('span.cart-qty', {}, l.unit ? `${l.qty} ${l.unit}` : `${l.qty}×`),
        el('span.cart-mid', {},
          el('span.cart-name', {},
            l.name,
            // A fixed discount is capped at the line (a $50 discount takes
            // $5 off a $5 line); the badge shows what actually comes off.
            l.discount && el('span.cart-line-disc', {},
              l.discount.type === 'percent'
                ? `−${l.discount.value}%`
                : `−${money(Math.min(l.discount.value, computed.subtotal))}`)),
          l.options?.length && el('span.cart-opts', {}, optionsLabel(l.options)),
          l.note && el('span.cart-note', {}, l.note)),
        el('span.cart-amount', {}, money(computed.subtotal - ownDiscount))
      ));
    });

    clear(cartFoot);
    const discountBtn = el('button.cart-disc-btn', {
      type: 'button', onclick: openOrderDiscount,
      html: icon('badgePercent', 16, 2),
    }, orderDiscount
      // Same rule as the line badges: the chip names what actually comes
      // off, which for a fixed discount is capped at the discounted lines.
      ? ` ${orderDiscount.name || 'Discount'} · ${orderDiscount.type === 'percent' ? `${orderDiscount.value}%` : money(totals.orderDiscountAmount)}`
      : ' Add discount');

    const rows = el('dl.totals', {},
      trow('Subtotal', money(totals.subtotal)),
      totals.discountTotal > 0 && trow('Discounts', `−${money(totals.discountTotal)}`),
      ...totals.taxes.map((t) => trow(
        `${t.name || 'Tax'} ${t.rate}%${store.settings.pricesIncludeTax ? ' (incl.)' : ''}`,
        money(t.tax))),
      trow('Total', money(totals.total), true)
    );

    if (cart.length) cartFoot.append(discountBtn);
    cartFoot.append(
      rows,
      el('button.btn.btn-primary.charge-btn', {
        type: 'button',
        disabled: !cart.length,
        onclick: () => openPayment(totals),
      }, cart.length ? `Charge ${money(totals.total)}` : 'Charge')
    );

    clear(cartBar);
    cartBar.append(
      el('span.cart-bar-count', {}, String(totals.itemCount)),
      el('span.grow', {}, totals.itemCount === 1 ? '1 item' : `${totals.itemCount} items`),
      el('span.cart-bar-total', {}, money(totals.total))
    );
    cartBar.classList.toggle('hidden', !cart.length);
    // Toasts mount on <body>, so they can't see the bar they would land on
    // top of; this is how the stylesheet lifts them clear of it.
    document.body.classList.toggle('cart-bar-up', cart.length > 0);
    if (!cart.length) toggleSheet(false);
    holdBtn.disabled = !cart.length;
    clearBtn.disabled = !cart.length;
    // The pulse is a one-shot: any later render must not repeat it.
    flashLine = null;
    persistDraft();
  }

  /**
   * Every cart change funnels through renderCart, so this is the one place
   * the in-progress sale needs saving from - no mutation path can forget.
   * Unchanged carts (a store event, a re-render) write nothing.
   */
  let lastDraft = null;
  function persistDraft() {
    const draft = cart.length
      // The customer rides along by id: a restored reward has to come back
      // attached to the same person, or the sale records one and not the other.
      ? { lines: cart, orderDiscount, redeeming: redeemingRecord(), customerId: customer?.id || null }
      : null;
    const json = JSON.stringify(draft);
    if (json === lastDraft) return;
    lastDraft = json;
    store.queueDraft(draft);
  }

  function trow(label, value, strong = false) {
    return el(`div.trow${strong ? '.trow-total' : ''}`, {},
      el('dt', {}, label), el('dd', {}, value));
  }

  /* ---------- Payment ---------- */

  /**
   * The payment sheet. One tender is the fast path and looks exactly as it
   * always did; Split payment turns the same sheet into a tender-by-tender
   * ledger with a live remaining balance, because "twenty in cash, rest on
   * card" is a normal request and ringing it up twice corrupts both the
   * receipt and the payments report.
   */
  function openPayment(totals, { note: initialNote = '' } = {}) {
    const totalCents = toCents(totals.total);
    /** Recorded tenders (split mode only). */
    const tenders = [];
    let method = 'cash';
    /** Raw text of the amount / cash-received field. */
    let typed = '';
    /** Tips, when the shop records them: a typed gratuity on a card/other
        tender, or one tap turning a cash overpay's change into the tip. */
    const tipsOn = !!store.settings.tipsEnabled;
    let tipTyped = '';
    let keepChange = false;
    /** A note on the whole sale - "for Sam", "gift wrap" - printed on it. */
    let saleNote = initialNote;

    /**
     * The customer's punch card. Read from their own receipts, so it can't
     * drift - and read only once a customer is actually attached, since it
     * costs a scan of their recent months. `null` means "not looked up yet".
     */
    const scheme = loyaltyScheme(store.settings, store);
    let progress = null;
    let loadingLoyalty = false;
    let loyaltyFor = null;

    /** Their history, kept so the card's state *after* this sale can be read. */
    let loyaltySales = null;

    const loadLoyalty = (rerender) => {
      if (!scheme || !customer || loyaltyFor === customer.id || loadingLoyalty) return;
      loadingLoyalty = true;
      const wanted = customer.id;
      store.salesForCustomer(wanted, { monthsToScan: LOYALTY_MONTHS })
        .then(({ sales }) => {
          loadingLoyalty = false;
          // The cashier may have swapped the customer while this was out.
          if (!customer || customer.id !== wanted) return;
          loyaltyFor = wanted;
          loyaltySales = sales;
          progress = loyaltyProgress(sales, scheme, store);
          rerender();
        })
        .catch((err) => {
          console.error(err);
          loadingLoyalty = false;
          if (customer?.id === wanted) {
            loyaltyFor = wanted;
            loyaltySales = null;
            progress = null;
            rerender();
          }
        });
    };

    /**
     * The card as it will stand once this sale is rung up - the figures the
     * receipt prints. Read the same way the chip above it is: from receipts,
     * with this sale standing in as one more of them.
     */
    const postSaleLoyalty = () => {
      if (!scheme || !customer || !loyaltySales) return null;
      const now = cartTotals();
      const pending = {
        lines: now.lines.map((l) => ({
          productId: l.productId || null, qty: l.qty, total: l.total, tax: l.tax,
        })),
      };
      const reward = redeemingRecord();
      if (reward) {
        const line = now.lines[reward.lineIndex];
        pending.reward = {
          kind: reward.kind,
          value: reward.kind === 'spend'
            ? now.orderDiscountAmount
            : fromCents(discountCents(toCents(line?.subtotal || 0), line?.discount)),
        };
      }
      return progressSnapshot(loyaltyProgress([...loyaltySales, pending], scheme, store));
    };

    /**
     * What a reward would actually take off this cart.
     *
     * A spend reward is offered as the whole accrued balance, but the discount
     * it becomes can only ever take the discounted lines down to zero - so a
     * customer with $70.90 saved up, buying one $3.20 espresso, was offered
     * "Use it · −$70.90" and then had $3.20 taken off. The figure is priced
     * through the very cart math the tap runs, so the button can't promise
     * money the sale has no room for. (A stamps reward is one unit of a line
     * it is already on, which the line always has room for.)
     */
    const rewardTakesOff = (offer) => {
      if (!offer) return 0;
      if (offer.kind !== 'spend') return offer.amount;
      return computeCart(cart, {
        orderDiscount: { type: 'fixed', value: offer.amount },
        pricesIncludeTax: store.settings.pricesIncludeTax,
      }).orderDiscountAmount;
    };

    /**
     * The card at checkout: where it stands, and - when a reward is ready and
     * this basket can take it - one tap to give it. Never applied on its own:
     * the cashier taps, and the sheet reopens on the new total.
     */
    const loyaltyRow = (rerender) => {
      if (!scheme || !customer) return null;
      // Their history is wanted either way: to offer a reward, and - once one
      // has been taken - to print the card as it stands after this sale.
      // Taking one reopens this sheet, so the reward arrives already applied
      // in a sheet that never looked the card up: the slip then carried no
      // card line at all, on the one sale where the customer most wants to
      // read it.
      loadLoyalty(rerender);
      // Already taken on this sale: the discount is on the cart, so the row's
      // job is to say so - and to offer the way back out, since a card cashed
      // in by mistake is otherwise only undone by clearing the sale.
      if (redeeming) {
        return el('div.loyalty-row', {},
          el('span.loyalty-say', { html: icon('star', 13, 2.2) },
            // The shop names its own reward, often starting with an article;
            // here it opens the sentence, so it is capitalized like one.
            ` ${sentence(redeeming.name)} — applied to this sale`),
          el('button.btn.btn-ghost.btn-sm', {
            type: 'button',
            onclick: () => {
              undoReward();
              completing = false;
              modal.close();
              renderCart();
              openPayment(cartTotals(), { note: saleNote });
            },
          }, 'Undo'));
      }
      if (loyaltyFor !== customer.id) {
        return el('p.small.field-note', {}, 'Checking their loyalty card…');
      }
      if (!progress) return null;
      const offer = rewardForCart(cart, progress, scheme, store);
      const takesOff = rewardTakesOff(offer);
      const row = el('div.loyalty-row', {},
        el('span.loyalty-say', { html: icon('star', 13, 2.2) }, ` ${progressText(progress, money)}`)
      );
      if (progress.ready && !(takesOff > 0)) {
        row.append(el('span.small.muted', {}, scheme.type === 'stamps'
          ? `Add ${scheme.rewardName} to the sale to use it`
          : 'Nothing to take it off yet'));
      } else if (offer) {
        row.append(el('button.btn.btn-ghost.btn-sm', {
          type: 'button',
          onclick: () => {
            if (!applyReward(offer)) return;
            // The cart changed, so the sheet's totals have: reopen on the
            // new ones, keeping the note already typed.
            completing = false;
            modal.close();
            renderCart();
            openPayment(cartTotals(), { note: saleNote });
          },
        }, `Use it · −${money(takesOff)}`));
      }
      return row;
    };

    /**
     * Give the reward: a fixed discount on the line the card is for, or on the
     * whole sale for a spend scheme. Ordinary cart discounts, so every total,
     * every tax figure, and the receipt need no special case - and the store
     * reads back what it actually took off.
     */
    function applyReward(offer) {
      if (offer.kind === 'spend') {
        if (orderDiscount) {
          toast('Remove the discount on this sale first, then use the reward', { icon: 'alert' });
          return false;
        }
        orderDiscount = { type: 'fixed', value: offer.amount, name: offer.name };
        redeeming = { kind: 'spend', name: offer.name };
        redeemingOn = orderDiscount;
        return true;
      }
      const line = cart[offer.lineIndex];
      if (!line) return false;
      if (line.discount) {
        toast('That line already has a discount. Remove it to use the reward', { icon: 'alert' });
        return false;
      }
      // One unit free: a fixed discount of its unit price leaves the rest of
      // the line chargeable, which is what "the next one is free" means.
      line.discount = { type: 'fixed', value: offer.amount };
      redeeming = { kind: 'stamps', name: offer.name };
      redeemingOn = line;
      return true;
    }

    /**
     * Store credit is offered only when there is a balance to draw on, and
     * only with a connection: the spend has to be durable before the customer
     * walks out, or it could be spent again from another till. Nothing about
     * selling depends on it - cash and card are always there.
     */
    const creditAvailable = () => {
      if (!customer) return 0;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
      const spent = tenders
        .filter((t) => t.method === 'credit')
        .reduce((a, t) => a + toCents(t.amount), 0);
      return Math.max(0, toCents(store.creditBalance(customer.id)) - spent);
    };
    /** The methods the sheet may offer right now, credit last when it can. */
    const methodsNow = () => (creditAvailable() > 0 ? [...CASH_METHODS, CREDIT_METHOD] : CASH_METHODS);
    /** Keep a chosen method that has stopped being on offer from lingering. */
    const settleMethod = () => {
      if (!methodsNow().some((m) => m.value === method)) method = 'cash';
    };

    const customerRow = (rerender) => el('div.pay-customer', {},
      customer
        // The name is its own element so a long one can be truncated without
        // taking the ✕ - the only way back off this sale - with it.
        ? el('button.chip.active.pay-customer-chip', {
          type: 'button',
          title: 'Remove the customer from this sale',
          'aria-label': `Remove ${customer.name} from this sale`,
          onclick: () => { customer = null; rerender(); },
        },
          el('span.pay-customer-name', {}, customer.name),
          el('span', { 'aria-hidden': 'true' }, '✕'))
        : el('button.chip', {
          type: 'button',
          html: icon('userPlus', 13, 2),
          onclick: () => openCustomerPicker({ onPick: (c) => { customer = c; rerender(); } }),
        }, ' Customer')
    );
    /**
     * While the sale is being written the sheet must not be dismissable:
     * Escape or a scrim tap would leave the write finishing out of sight
     * with the cart still on screen, and a second Charge would record the
     * same sale twice.
     */
    let completing = false;

    const body = el('div');
    const modal = openModal({ title: 'Payment', content: body, canClose: () => !completing });

    const paidCents = () => tenders.reduce((a, t) => a + toCents(t.amount), 0);
    const remainingCents = () => Math.max(0, totalCents - paidCents());
    const remaining = () => fromCents(remainingCents());

    const methodSeg = (onPick) => {
      settleMethod();
      const shown = methodsNow();
      const seg = el('div.seg.seg-block', {
        role: 'group',
        'aria-label': 'Payment method',
        className: `seg seg-block${shown.length > 3 ? ' seg-wrap' : ''}`,
      });
      for (const m of shown) {
        seg.append(el('button.seg-btn', {
          type: 'button',
          className: `seg-btn${method === m.value ? ' active' : ''}`,
          'aria-pressed': method === m.value ? 'true' : 'false',
          html: icon(m.icon, 16, 2),
          onclick: () => { method = m.value; typed = ''; tipTyped = ''; keepChange = false; onPick(); },
        }, ` ${m.label}`));
      }
      return seg;
    };

    /**
     * The sale's own note. Built fresh on every repaint (both sheets rebuild
     * wholesale), so it carries whatever has been typed so far.
     */
    const noteField = (rerender) => {
      const input = el('input.input', {
        type: 'text', maxLength: MAX_NOTE, value: saleNote,
        placeholder: 'e.g. for Sam, gift wrap',
        'aria-label': 'Note on this sale',
        oninput: (e) => { saleNote = e.target.value; },
      });
      // A chip changes the field's value, which the rebuild has to see.
      const chips = quickNoteChips(input);
      if (chips) input.addEventListener('input', () => { saleNote = input.value; });
      return el('div.field', { style: { marginTop: '4px' } },
        el('label.label', {}, 'Note (optional)'), input, chips);
    };

    /** 'Store credit — $18.40 available', the moment a customer is attached. */
    const creditNote = () => {
      const available = creditAvailable();
      if (!available) return null;
      return el('p.small.field-note.credit-note', {},
        el('span', { html: icon('ticket', 13, 2) }),
        ` Store credit — ${money(fromCents(available))} available`);
    };

    /** Record one tender against the balance. Cash may overshoot into change. */
    function addTender(forMethod, amountText) {
      const due = remaining();
      // The fields on screen belong to the selected method. A "Rest on …"
      // chip adds a different one, so whatever is typed there can't come
      // along: an amount or a tip adopted would be filed against the wrong
      // tender, and dropped silently the chip would put the *whole* balance
      // on the other method - the typed cash already on the counter gone
      // from the receipt, and from the drawer it has to reconcile against.
      if (forMethod !== method && (String(typed).trim() || String(tipTyped).trim())) {
        toast(`Add the ${paymentMethodInfo(method).label.toLowerCase()} tender you typed first, or clear it`,
          { icon: 'alert' });
        return false;
      }
      const entered = parseAmount(amountText);
      if (entered === null || entered <= 0) {
        toast('Enter an amount for this tender', { icon: 'alert' });
        return false;
      }
      if (forMethod === 'cash') {
        // Cash over the balance is change, not an overpayment - unless the
        // customer just said to keep it, in which case it's the tip.
        const amount = Math.min(entered, due);
        const tender = { method: 'cash', amount };
        if (entered > amount) {
          tender.tendered = entered;
          if (keepChange) tender.tip = round2(entered - amount);
          else tender.change = round2(entered - amount);
        }
        tenders.push(tender);
      } else {
        if (toCents(entered) > remainingCents()) {
          toast(`A ${paymentMethodInfo(forMethod).label.toLowerCase()} tender can’t exceed the ${money(due)} still due`, { icon: 'alert' });
          return false;
        }
        // Credit can only spend what the balance holds - and the balance
        // shrinks as tenders are added, so it is re-read here.
        if (forMethod === 'credit' && toCents(entered) > creditAvailable()) {
          toast(`Store credit has ${money(fromCents(creditAvailable()))} available`, { icon: 'alert' });
          return false;
        }
        const tip = parseAmount(tipTyped);
        if (tipTyped.trim() && (tip === null || tip < 0)) {
          toast('Enter a valid tip amount', { icon: 'alert' });
          return false;
        }
        const tender = { method: forMethod, amount: entered };
        if (tip > 0) tender.tip = tip;
        tenders.push(tender);
      }
      typed = '';
      tipTyped = '';
      keepChange = false;
      return true;
    }

    async function complete(btn, payments) {
      btn.disabled = true;
      completing = true;
      const label = btn.textContent;
      btn.textContent = 'Recording…';
      try {
        const receipt = await store.completeSale({
          lines: cart,
          orderDiscount,
          payments,
          note: saleNote,
          customerId: customer?.id || null,
          reward: redeemingRecord(),
          loyalty: postSaleLoyalty(),
        });
        completing = false;
        modal.close();
        cart = [];
        orderDiscount = null;
        redeeming = null;
        redeemingOn = null;
        customer = null;
        renderCart();
        renderGrid(); // stock counts may have moved
        checkDrawer(); // the marker tracks the day, and a sale may be its first
        showSuccess(receipt);
        // The paper and the drawer, after the success screen is up: a sale is
        // recorded whatever the hardware does, and the cashier should never
        // be waiting on a printer to serve the next customer.
        afterSaleHardware(receipt, payments);
      } catch (err) {
        console.error(err);
        completing = false;
        btn.disabled = false;
        btn.textContent = label;
        const said = explains(err);
        toast(said ? err.message : 'Couldn’t record the sale. Check your connection',
          { icon: said ? 'alert' : 'wifiOff', duration: said ? 6000 : undefined });
      }
    }

    /* ---- Single tender: the two-tap path ---- */

    /** What Complete will actually record - the typed tip included, so the
        label survives any re-render (picking a customer rebuilds the sheet
        while the tip field still holds its value). */
    const completeLabel = () => {
      if (method === 'credit' && creditAvailable() < totalCents) return 'Not enough store credit';
      const tip = method !== 'cash' && method !== 'credit' ? parseAmount(tipTyped) : null;
      return tip > 0
        ? `Complete sale · ${money(round2(totals.total + tip))} incl. tip`
        : `Complete sale · ${money(totals.total)}`;
    };

    // Both modes rebuild the whole sheet on every method tap, tender added,
    // or customer picked. keepFocus puts focus back on the replacement of
    // whatever was pressed, rather than dropping it to <body> mid-payment.
    function renderSingle() {
      keepFocus(body, paintSingle);
    }

    function paintSingle() {
      clear(body);
      const parts = [
        el('div.pay-total', {},
          el('span.pay-total-label', {}, 'Total due'),
          el('span.pay-total-value', {}, money(totals.total))),
        customerRow(renderSingle),
        loyaltyRow(renderSingle),
        methodSeg(renderSingle),
        creditNote(),
      ].filter(Boolean);

      if (method === 'cash') {
        const tenderInput = el('input.input.pay-tender', {
          type: 'text', inputmode: 'decimal', placeholder: money(totals.total),
          value: typed, 'aria-label': 'Cash received',
          oninput: () => { typed = tenderInput.value; renderChange(); },
        });
        const changeRow = el('div.pay-change', { 'aria-live': 'polite' });
        // The "Keep as tip" chip lives in this row and rebuilds it when
        // pressed, so it needs the same focus hand-back as the rest.
        const renderChange = () => keepFocus(changeRow, () => {
          const amt = parseAmount(typed);
          const change = amt === null ? null : changeDue(totals.total, amt);
          clear(changeRow);
          if (typed && amt !== null && change === null) {
            changeRow.append(el('span.pay-short', {},
              `Short ${money(totals.total - amt)}`));
          } else if (change !== null && typed) {
            // append() (not changeRow.append) so the tip chip drops out when
            // the shop doesn't record tips, instead of stringifying into the
            // line the cashier reads the change off.
            append(changeRow, [
              el('span', {}, keepChange && change > 0 ? 'Tip ' : 'Change '),
              el('strong', {}, money(change)),
              // "Keep the change" is a sentence said across every counter;
              // one tap records it truthfully instead of corrupting the count.
              tipsOn && change > 0 && el('button.chip.tip-keep-chip', {
                type: 'button',
                className: `chip tip-keep-chip${keepChange ? ' active' : ''}`,
                'aria-pressed': keepChange ? 'true' : 'false',
                onclick: () => { keepChange = !keepChange; renderChange(); },
              }, keepChange ? 'Kept as tip' : 'Keep as tip'),
            ]);
          }
        });
        parts.push(
          el('div.field', {},
            el('label.label', {}, 'Cash received'),
            tenderInput,
            el('div.chip-row', {}, tenderSuggestions(totals.total).map((v) =>
              el('button.chip', {
                type: 'button',
                onclick: () => { typed = String(v); tenderInput.value = String(v); renderChange(); },
              }, money(v))))
          ),
          changeRow
        );
        renderChange();
      } else if (method === 'credit') {
        const available = creditAvailable();
        parts.push(el('div.field', {},
          el('label.label', {}, 'Store credit'),
          el('div.pay-change', {},
            available >= totalCents
              ? el('span', {}, `${money(totals.total)} comes off ${customer.name}’s balance, leaving `,
                el('strong', {}, money(fromCents(available - totalCents))))
              : el('span.pay-short', {},
                `Store credit covers ${money(fromCents(available))} of ${money(totals.total)}. Split the payment to take the rest another way.`))
        ));
      } else if (tipsOn) {
        // "The terminal slip says +2.00" - recorded where it happened, on
        // this tender, without touching the sale's own totals.
        const tipInput = el('input.input', {
          type: 'text', inputmode: 'decimal', placeholder: money(0),
          value: tipTyped, 'aria-label': 'Tip',
          oninput: () => {
            tipTyped = tipInput.value;
            completeBtn.textContent = completeLabel();
          },
        });
        parts.push(el('div.field', {}, el('label.label', {}, 'Tip (optional)'), tipInput));
      }

      const shortOfCredit = method === 'credit' && creditAvailable() < totalCents;
      const completeBtn = el('button.btn.btn-primary.btn-block.charge-btn', {
        type: 'button',
        disabled: shortOfCredit,
        onclick: (e) => {
          const tender = { method, amount: totals.total };
          if (method === 'cash') {
            // Empty input means exact cash; anything typed must cover the
            // total, or the receipt would record a tender that never happened.
            const amt = parseAmount(typed);
            if (String(typed).trim()) {
              // A figure the parser refuses is a typo, not a shortfall.
              // Both used to say the cash didn't cover the total, so a
              // cashier who typed '1,000' at a $5 counter - the one shape
              // parseAmount won't guess at - was told the two twenties in
              // their hand weren't enough.
              if (amt === null) {
                toast('Enter the cash received as a plain number, or clear the field', { icon: 'alert' });
                body.querySelector('.pay-tender')?.focus();
                return;
              }
              if (toCents(amt) < totalCents) {
                toast('Cash received doesn’t cover the total', { icon: 'alert' });
                return;
              }
            }
            tender.tendered = amt === null ? totals.total : amt;
            if (keepChange && amt !== null && toCents(amt) > totalCents) {
              tender.tip = fromCents(toCents(amt) - totalCents);
            }
          } else {
            const tip = parseAmount(tipTyped);
            if (tipTyped.trim() && (tip === null || tip < 0)) {
              toast('Enter a valid tip amount', { icon: 'alert' });
              return;
            }
            if (tip > 0) tender.tip = tip;
          }
          complete(e.currentTarget, [tender]);
        },
      }, completeLabel());

      parts.push(
        noteField(renderSingle),
        completeBtn,
        totalCents > 0 && el('button.btn.btn-ghost.btn-block.pay-split-btn', {
          type: 'button',
          html: icon('split', 15, 2),
          // A typed partial amount carries over: it's usually why the cashier
          // reached for this in the first place.
          onclick: () => { paintSplit(); focusNextStep(); },
        }, ' Split payment')
      );

      body.append(...parts.filter(Boolean));
    }

    /* ---- Split: tender by tender, until nothing is left to cover ---- */
    function renderSplit() {
      keepFocus(body, paintSplit);
    }

    /**
     * Where focus goes when a rebuild removed the control that was pressed
     * outright, so there is no replacement to hand it to: a tender that
     * covered the balance takes the whole "Add a tender" section with it,
     * and switching between the one-tender and split sheets swaps the body
     * for a different one. The amount field, or Complete once nothing is
     * left to cover, is where the cashier is heading either way.
     */
    const focusNextStep = () => {
      body.querySelector('.pay-tender, .charge-btn:not(:disabled)')?.focus();
    };

    /** Rebuild the split sheet, keeping focus somewhere it can be used. */
    const refreshSplit = () => {
      renderSplit();
      if (!document.activeElement || document.activeElement === document.body) focusNextStep();
    };

    function paintSplit() {
      clear(body);
      const due = remaining();
      const settled = remainingCents() === 0;

      const list = el('div.tender-list');
      tenders.forEach((t, i) => {
        const info = paymentMethodInfo(t.method);
        list.append(el('div.tender-row', {},
          el('span.tender-ic', { html: icon(info.icon, 17, 1.8) }),
          el('span.tender-main', {},
            el('span.tender-label', {}, info.label),
            t.change > 0 && el('span.tender-sub', {},
              `${money(t.tendered)} received · ${money(t.change)} change`),
            t.tip > 0 && el('span.tender-sub', {},
              t.tendered !== undefined ? `${money(t.tendered)} received · ${money(t.tip)} kept as tip` : `+${money(t.tip)} tip`)),
          el('span.tender-amount', {}, money(t.amount)),
          el('button.icon-btn', {
            type: 'button', html: icon('x', 16, 2),
            'aria-label': `Remove ${info.label} tender of ${money(t.amount)}`,
            onclick: () => { tenders.splice(i, 1); refreshSplit(); },
          })
        ));
      });

      const parts = [
        el('div.pay-total', {},
          el('span.pay-total-label', {}, settled ? 'Fully covered' : 'Remaining'),
          el('span.pay-total-value', {
            className: `pay-total-value${settled ? ' settled' : ''}`,
          }, money(due)),
          el('span.pay-total-sub', {}, `of ${money(totals.total)} total`)),
        customerRow(renderSplit),
        loyaltyRow(renderSplit),
        tenders.length ? list : null,
      ];

      if (!settled) {
        const amountInput = el('input.input.pay-tender', {
          type: 'text', inputmode: 'decimal', placeholder: money(due),
          value: typed, 'aria-label': method === 'cash' ? 'Cash received' : 'Amount',
          oninput: () => { typed = amountInput.value; renderHint(); },
          onkeydown: (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (addTender(method, amountInput.value || String(due))) refreshSplit();
          },
        });
        const addBtn = el('button.btn.btn-ghost.btn-block', {
          type: 'button',
          onclick: () => { if (addTender(method, typed || String(due))) refreshSplit(); },
        });
        const hint = el('div.pay-change', { 'aria-live': 'polite' });
        // The "Keep as tip" chip rebuilds this row from inside it, so it gets
        // the same focus hand-back as every other rebuilt control.
        const renderHint = () => keepFocus(hint, () => {
          const amt = parseAmount(typed);
          // A figure the parser refuses is not the same as an empty field:
          // the button went on offering the whole balance over text it was
          // never going to accept, and pressing it only then said no.
          const unreadable = !!String(typed).trim() && amt === null;
          // The button names the figure a tap will actually add, so it has to
          // follow the typing - a stale "Add $9.96" over a typed $5 lies.
          addBtn.innerHTML = icon('plus', 15, 2.2);
          addBtn.append(unreadable ? ' Add tender' : ` Add ${money(amt ?? due)}`);
          clear(hint);
          if (unreadable) {
            hint.append(el('span.pay-short', {}, 'Enter the amount as a plain number'));
            return;
          }
          if (amt === null) return;
          if (method === 'cash' && toCents(amt) > remainingCents()) {
            // append() (not hint.append), same as the single-tender row.
            append(hint, [
              el('span', {}, keepChange ? 'Tip ' : 'Change '),
              el('strong', {}, money(amt - due)),
              tipsOn && el('button.chip.tip-keep-chip', {
                type: 'button',
                className: `chip tip-keep-chip${keepChange ? ' active' : ''}`,
                'aria-pressed': keepChange ? 'true' : 'false',
                onclick: () => { keepChange = !keepChange; renderHint(); },
              }, keepChange ? 'Kept as tip' : 'Keep as tip'),
            ]);
          } else if (toCents(amt) < remainingCents()) {
            hint.append(el('span', {}, `${money(due - amt)} would still be due`));
          }
        });

        parts.push(
          el('h3.pay-section', {}, 'Add a tender'),
          methodSeg(renderSplit),
          creditNote(),
          el('div.field', {},
            el('label.label', {}, method === 'cash' ? 'Cash received' : 'Amount'),
            amountInput,
            method === 'cash' && el('div.chip-row', {}, tenderSuggestions(due).map((v) =>
              el('button.chip', {
                type: 'button',
                onclick: () => { typed = String(v); amountInput.value = String(v); renderHint(); },
              }, money(v))))
          ),
          method !== 'cash' && method !== 'credit' && tipsOn && el('div.field', {},
            el('label.label', {}, 'Tip (optional)'),
            el('input.input', {
              type: 'text', inputmode: 'decimal', placeholder: money(0),
              value: tipTyped, 'aria-label': 'Tip on this tender',
              oninput: (e) => { tipTyped = e.target.value; },
            })
          ),
          hint,
          addBtn,
          // The whole point of the flow: one tap puts the balance on another
          // method without typing the figure out again. Credit can only offer
          // what the balance holds, so it says the figure rather than "rest".
          el('div.chip-row', {}, methodsNow()
            .filter((m) => m.value !== method)
            .map((m) => {
              const offer = m.value === 'credit'
                ? Math.min(remainingCents(), creditAvailable())
                : remainingCents();
              if (offer <= 0) return null;
              return el('button.chip', {
                type: 'button',
                onclick: () => { if (addTender(m.value, String(fromCents(offer)))) refreshSplit(); },
              }, m.value === 'credit' && offer < remainingCents()
                ? `Credit ${money(fromCents(offer))}`
                : `Rest on ${m.label.toLowerCase()}`);
            })
            .filter(Boolean))
        );
        renderHint();
      }

      parts.push(
        noteField(renderSplit),
        el('button.btn.btn-primary.btn-block.charge-btn', {
          type: 'button',
          disabled: !settled,
          onclick: (e) => complete(e.currentTarget, tenders),
        }, settled ? `Complete sale · ${money(totals.total)}` : `${money(due)} still to cover`));

      if (!tenders.length) {
        parts.push(el('button.btn.btn-ghost.btn-block.pay-split-btn', {
          type: 'button',
          onclick: () => { paintSingle(); focusNextStep(); },
        }, 'One payment instead'));
      }

      body.append(...parts.filter(Boolean));
    }

    renderSingle();
  }

  /**
   * What the counter's hardware does once a sale is in: print the slip if this
   * device is set to, and kick the drawer on a cash sale if it is wired to.
   *
   * Deliberately fire-and-forget and deliberately last. The sale is already
   * recorded and the success screen is already up; a printer that is off, out
   * of paper, or simply absent must cost the shop nothing but a toast.
   */
  function afterSaleHardware(receipt, payments) {
    const config = printerConfig();
    if (!config) return;
    const tookCash = (payments || []).some((t) => t.method === 'cash');
    const kick = !!config.kickOnCash && tookCash;
    if (config.autoPrint) {
      // One job: the slip and the drawer pulse ride the same connection.
      printReceipt(receipt, store, { kick }).catch((err) => console.error(err));
      return;
    }
    if (kick) {
      kickDrawer().catch((err) => {
        console.error(err);
        toast(err.message || 'Couldn’t open the drawer', { icon: 'alert' });
      });
    }
  }

  function showSuccess(receipt) {
    const change = receiptChange(receipt);
    const tip = receiptTip(receipt);
    const body = el('div.sale-done', {},
      el('div.sale-done-icon', { html: icon('circleCheck', 34, 1.8) }),
      el('h3.sale-done-title', {}, `Sale complete · ${money(receipt.total)}`),
      change > 0
        ? el('p.sale-done-change', {}, 'Change due ', el('strong', {}, money(change)))
        : el('p.sale-done-sub', {}, `Receipt #${receipt.number}`),
      tip > 0 && el('p.sale-done-sub', {}, `Tip ${money(tip)} recorded`),
      // The sale is recorded either way; say where it is rather than pretend.
      receipt.pendingSync && el('p.sale-done-sub', {},
        'Saved on this device. It syncs when you’re back online'),
      // Wrapping, like the same three actions in the receipt detail sheet.
      // Held to one line, the middle button was 82px wide around a 86px
      // "Download" - the label a browser without file sharing shows - and
      // the word sat across its own border on a 320px phone.
      el('div.row.wrap', { style: { marginTop: '18px' } },
        el('button.btn.btn-ghost.grow', {
          html: icon('printer', 16, 2),
          onclick: () => printReceipt(receipt, store),
        }, ' Print'),
        // The customer's copy, for the many counters with no printer at all.
        el('button.btn.btn-ghost.grow', {
          html: icon('share', 16, 2),
          onclick: (e) => handOverReceipt(receipt, e.currentTarget),
        }, ` ${shareActionLabel()}`),
        el('button.btn.btn-ghost.grow', {
          html: icon('receipt', 16, 2),
          onclick: () => {
            openModal({ title: `Receipt #${receipt.number}`, content: receiptNode(receipt, store) });
          },
        }, ' View')
      ),
      el('button.btn.btn-primary.btn-block', {
        style: { marginTop: '10px' },
        onclick: () => modal.close(),
      }, 'New sale')
    );
    const modal = openModal({ title: 'Done', content: body });
  }

  /* ---------- Assemble ---------- */

  const node = el('div.view.register', {},
    // Every other view opens with an h1; the register spends that strip of
    // screen on the grid instead, so it had no page heading at all - and it
    // is the route the app opens on. Jumping by heading landed on "Current
    // sale", which is a panel inside the register, not the register.
    //
    // Named without being drawn: the sidebar, the tab bar and the window
    // title all already say Register to anyone who can see them, and the
    // grid keeps every pixel it had. Out of flow, so the two-column grid
    // beside it is untouched.
    el('h1.sr-only', {}, 'Register'),
    el('section.reg-catalog', { 'aria-label': 'Product catalog' },
      el('div.reg-toolbar', {},
        el('div.search-wrap', { html: icon('search', 17, 2) }, searchInput),
        drawerBtn,
        heldBtn,
        // Camera scanning is a progressive enhancement: no BarcodeDetector,
        // no button - hardware scanners need no button at all.
        cameraScanSupported() && el('button.btn.btn-ghost.scan-btn', {
          type: 'button',
          html: icon('scan', 18, 1.8),
          'aria-label': 'Scan a barcode with the camera',
          title: 'Scan a barcode with the camera',
          onclick: () => openCameraScanner({ onCode: handleScan }),
        })
      ),
      chipRow,
      arrangeBar,
      grid
    ),
    cartPanel,
    scrim,
    cartBar
  );

  const onStoreChange = () => {
    renderChips(); renderGrid(); renderCart(); renderHeld();
    // Starting or closing the day emits, so the marker keeps up with it.
    checkDrawer();
  };
  store.addEventListener('change', onStoreChange);
  // A wholesale dataset replacement (sample data in or out, a restored
  // backup) takes the cart's catalog with it. Lines kept across it would
  // ring up products the new dataset never held - and the next render
  // would save them as that dataset's open draft.
  const onReplace = () => {
    if (!cart.length && !orderDiscount) return;
    cart = [];
    orderDiscount = null;
    redeeming = null;
    redeemingOn = null;
    // The directory was replaced as well; this customer may not be in it.
    customer = null;
    renderCart();
  };
  store.addEventListener('replace', onReplace);
  checkDrawer();

  // Pick the sale back up: after a tab switch it's plain continuity, after a
  // reload or a crash it's the order that would otherwise have been lost.
  if (store.draft?.lines?.length) {
    cart = structuredClone(store.draft.lines);
    orderDiscount = store.draft.orderDiscount ? { ...store.draft.orderDiscount } : null;
    // A reward already given on this cart comes back with it, so the sale
    // still records it - and the card still gets spent. So does the customer
    // it belongs to: a reward with nobody attached is one nobody's card pays
    // for. Gone from the directory since, they are simply not attached.
    redeeming = store.draft.redeeming ? { ...store.draft.redeeming } : null;
    redeemingOn = redeeming
      ? (redeeming.kind === 'spend' ? orderDiscount : cart[redeeming.lineIndex] || null)
      : null;
    customer = store.draft.customerId ? store.customer(store.draft.customerId) : null;
    // A reward with nobody to spend the card is not a reward this register
    // can give: it comes off the cart rather than being handed over free.
    if (!customer) undoReward();
    if (store.consumeRestoredDraft()) {
      toast('Picked up where you left off', { icon: 'cart', duration: 3200 });
    }
  }

  // A tab closing mid-sale still gets its last cart state out the door.
  const onPageHide = () => store.flushDraft();
  window.addEventListener('pagehide', onPageHide);

  renderChips();
  renderGrid();
  renderCart();
  renderHeld();

  return {
    node,
    destroy: () => {
      // The bar goes with the view; the body flag it sets must not outlive it.
      document.body.classList.remove('cart-bar-up');
      // Nor may the sheet's hold on the tab bar and the shell around it.
      holdFocusInSheet(false);
      sheetMedia.removeEventListener('change', onSheetMedia);
      sidebarMedia.removeEventListener('change', onSheetMedia);
      store.removeEventListener('change', onStoreChange);
      store.removeEventListener('replace', onReplace);
      document.removeEventListener('keydown', onSheetKey);
      document.removeEventListener('keydown', onWedgeKey);
      window.removeEventListener('pagehide', onPageHide);
      store.flushDraft();
    },
  };
}

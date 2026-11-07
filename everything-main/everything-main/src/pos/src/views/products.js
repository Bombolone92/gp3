import { el, clear, keepFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openProductForm, openCategoryManager } from '../ui/product-form.js';
import { store, DEFAULT_LOW_STOCK } from '../lib/store.js';
import { dressDot } from '../ui/product-photos.js';
import { formatMoney } from '../lib/money.js';
import { matches, initialOf, plural } from '../lib/util.js';
import { groupSummary } from '../lib/options.js';
import { marginPercent, stockAtCost } from '../lib/profit.js';
import { openStocktake, trackedProducts, openSessionLabel } from '../ui/stocktake.js';

/** A recorded cost, distinguished from the absence of one (null is not zero). */
const hasCost = (p) => p?.cost !== null && p?.cost !== undefined && Number.isFinite(Number(p.cost));

/** Tracked and at or below its threshold - what a reorder list is made of. */
function isLowStock(p) {
  if (p.stock === null || p.stock === undefined) return false;
  return p.stock <= (p.lowStock ?? DEFAULT_LOW_STOCK);
}

export function productsView() {
  let search = '';
  let activeCat = 'all';
  let lowOnly = false;
  const money = (n) => formatMoney(n, store.settings.currency);

  const searchInput = el('input.input.search-input', {
    type: 'search', placeholder: 'Search name or SKU', 'aria-label': 'Search products',
    oninput: () => { search = searchInput.value; renderList(); },
  });
  const chipRow = el('div.chip-row', { role: 'group', 'aria-label': 'Filter by category' });
  const list = el('div.card-list');

  function stockBadge(p) {
    if (p.stock === null || p.stock === undefined) return null;
    // Measured products count their stock in their own unit ('2.4 kg').
    const amount = p.soldBy === 'measure' && p.unit ? `${p.stock} ${p.unit}` : String(p.stock);
    if (p.stock <= 0) return el('span.badge.badge-danger', {}, 'Out of stock');
    if (isLowStock(p)) return el('span.badge.badge-warn', {}, `Low · ${amount}`);
    return el('span.badge', {}, `${amount} in stock`);
  }

  /**
   * Selling at or under what it cost is the one thing about a margin worth
   * interrupting for - a mistyped price, or a supplier rise nobody passed on.
   * A healthy margin is stated quietly in the row's sub-line instead.
   */
  function costBadge(p) {
    if (!hasCost(p) || !(p.price > 0)) return null;
    if (p.cost > p.price) return el('span.badge.badge-danger', {}, 'Below cost');
    if (p.cost === p.price) return el('span.badge.badge-warn', {}, 'At cost');
    return null;
  }

  function renderChips() {
    // The filtered category can be deleted out from under us (category
    // manager); fall back to All instead of filtering by a ghost id.
    if (activeCat !== 'all' && !store.category(activeCat)) activeCat = 'all';
    keepFocus(chipRow, () => {
      clear(chipRow);
      const chips = [{ id: 'all', name: 'All' }, ...store.categories];
      for (const c of chips) {
        chipRow.append(el('button.chip', {
          type: 'button',
          className: `chip${activeCat === c.id ? ' active' : ''}`,
          'aria-pressed': activeCat === c.id ? 'true' : 'false',
          onclick: () => { activeCat = c.id; renderChips(); renderList(); },
        }, c.name));
      }
      chipRow.append(el('button.chip.chip-ghost', {
        type: 'button', html: icon('squarePen', 13, 2),
        onclick: openCategoryManager,
      }, ' Edit categories'));
      // The reorder list: tracked products at or below their threshold. Only
      // offered when something is tracked - shops without stock never see it.
      const low = store.products.filter(isLowStock).length;
      if (low || lowOnly) {
        chipRow.append(el('button.chip', {
          type: 'button',
          className: `chip${lowOnly ? ' active' : ''}`,
          'aria-pressed': lowOnly ? 'true' : 'false',
          onclick: () => { lowOnly = !lowOnly; renderChips(); renderList(); },
        }, `Low stock · ${low}`));
      }
    });
  }

  function renderList() {
    clear(list);
    const items = store.products
      .filter((p) => (activeCat === 'all' || p.categoryId === activeCat)
        && (!lowOnly || isLowStock(p))
        && (matches(p.name, search) || matches(p.sku, search)))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (!store.products.length) {
      list.append(el('div.empty', {},
        el('div.empty-icon', { html: icon('packageOpen', 28) }),
        el('h3', {}, 'Build your catalog'),
        el('p', {}, 'Products you add here become tappable tiles on the register.'),
        el('button.btn.btn-primary', { onclick: () => openProductForm() }, 'Add your first product')
      ));
      return;
    }
    if (!items.length) {
      list.append(el('div.empty', {}, el('p', {}, 'Nothing matches your filters.')));
      return;
    }

    for (const p of items) {
      const cat = store.category(p.categoryId);
      const tax = p.taxId === 'none' ? null : store.taxFor(p);
      const dot = el('span.product-dot', { className: `product-dot slot-${p.slot || 1}` }, initialOf(p.name));
      dressDot(dot, p);
      const badge = stockBadge(p);
      const cost = costBadge(p);
      const margin = hasCost(p) ? marginPercent(p.price, p.cost) : null;
      const price = p.soldBy === 'measure' ? `${money(p.price)} per ${p.unit}` : money(p.price);
      list.append(el('button.card-row', {
        type: 'button', onclick: () => openProductForm(p),
        // An aria-label replaces the row's contents outright, so the price and
        // the stock badge beside the name were announced to nobody: the
        // catalog read as a list of bare names, and the reorder list - the
        // whole point of the Low stock filter - said nothing at all.
        'aria-label': [`Edit ${p.name}`, price, cost?.textContent, badge?.textContent]
          .filter(Boolean).join(', '),
      },
        dot,
        el('span.card-main', {},
          el('span.card-title', {}, p.name),
          el('span.card-sub', {}, [
            cat?.name,
            p.sku || null,
            p.options?.length ? groupSummary(p.options) : null,
            // Only where a cost is kept, and never where it is the warning
            // the badge beside it already carries.
            margin !== null && margin > 0 ? `${margin}% margin` : null,
            p.taxId === 'none' ? 'Tax-free' : tax ? `${tax.name} ${tax.rate}%` : null,
          ].filter(Boolean).join(' · ') || 'Uncategorized')
        ),
        cost,
        badge,
        el('span.card-amount', {}, p.soldBy === 'measure' ? `${money(p.price)}/${p.unit}` : money(p.price))
      ));
    }
  }

  /* ---------- Assemble ---------- */

  /**
   * 'Stock at cost $1,284' - the year-end figure, and the only sensible home
   * for it: it describes the shelf as it stands, not a period. Silent for
   * shops that track no stock or keep no costs, and honest about the products
   * it had to leave out.
   */
  function headerSub() {
    const parts = [`${store.products.length} in catalog`];
    const { value, counted, unknown } = stockAtCost(store.products);
    if (counted) {
      parts.push(unknown
        ? `stock at cost ${money(value)} (${plural(unknown, 'tracked product')} without a cost)`
        : `stock at cost ${money(value)}`);
    }
    return parts.join(' · ');
  }

  /**
   * A count left open is the one thing on this page that is waiting on
   * somebody - counting is a half-hour job and the tablet sleeps - so it says
   * so above everything else rather than hiding behind a button.
   */
  const stocktakeRow = el('div');
  function renderStocktakeRow() {
    clear(stocktakeRow);
    if (!store.stocktake) return;
    stocktakeRow.append(el('button.callout.callout-warn.callout-btn', {
      type: 'button',
      onclick: () => openStocktake(),
    },
      el('span.callout-ic', { html: icon('clipboard', 16, 2) }),
      el('span', {},
        el('strong', {}, 'A stocktake is open'), ': ', openSessionLabel(),
        '. Pick it back up — nothing has moved yet.')
    ));
  }
  renderStocktakeRow();

  /* Only for shops that track stock: nothing to count otherwise. */
  const stocktakeBtn = el('button.btn.btn-ghost', {
    html: icon('clipboard', 16, 2),
    onclick: () => openStocktake(),
  }, ' Stocktake');
  const renderStocktakeBtn = () => {
    stocktakeBtn.classList.toggle('hidden', !trackedProducts().length && !store.stocktake);
  };
  renderStocktakeBtn();

  const node = el('div.view', {},
    el('header.view-head', {},
      el('div', {},
        el('h1.view-title', {}, 'Products'),
        el('p.view-sub', {}, headerSub())
      ),
      el('div.row.wrap', { style: { flex: 'none' } },
        stocktakeBtn,
        el('button.btn.btn-primary', {
          html: icon('plus', 16, 2.2),
          onclick: () => openProductForm(),
        }, ' New product'))
    ),
    stocktakeRow,
    el('div.reg-toolbar', {}, el('div.search-wrap', { html: icon('search', 17, 2) }, searchInput)),
    chipRow,
    list
  );

  const onChange = () => {
    node.querySelector('.view-sub').textContent = headerSub();
    renderStocktakeRow();
    renderStocktakeBtn();
    renderChips();
    renderList();
  };
  store.addEventListener('change', onChange);
  renderChips();
  renderList();

  return { node, destroy: () => store.removeEventListener('change', onChange) };
}

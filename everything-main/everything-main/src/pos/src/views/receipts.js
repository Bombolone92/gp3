import { el, clear, append, keepFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import {
  store, paymentMethodInfo, paymentKindOf, receiptPayments, receiptTip,
  PAYMENT_METHODS, PENDING_SYNC_MESSAGE,
} from '../lib/store.js';
import { formatMoney } from '../lib/money.js';
import { monthKey, monthKeyOf, formatMonth, formatDay, formatTime } from '../lib/dates.js';
import { receiptMatches, hasCriteria } from '../lib/receipt-search.js';
import { plural } from '../lib/util.js';
import { receiptNode, printReceipt } from '../ui/receipt.js';
import { shareActionLabel } from '../ui/receipt-image.js';
import { handOverReceipt } from '../ui/hand-over.js';
import { requirePin } from '../ui/pin-gate.js';
import { openCustomerPicker } from '../ui/customer-picker.js';
import { formatMoney as fmtMoney } from '../lib/money.js';
import { optionsLabel } from '../lib/options.js';
import {
  isRefund, canRefund, refundState, refundPlan, refundableQty, refundedQty, fullRefundPicks,
} from '../lib/refunds.js';

/**
 * True when a rejection already says something the cashier can act on (the
 * store's own refusals), rather than being a failed request to paper over.
 */
function explains(err) {
  const message = err?.message || '';
  return message === PENDING_SYNC_MESSAGE
    || /refunded|voided|refund can|no longer|selected|has a refund/.test(message);
}

/** How far one tap of the scan reaches: months read, or matches gathered. */
const SEARCH_MONTH_CHUNK = 3;
const SEARCH_HIT_TARGET = 30;

export function receiptsView() {
  let month = store.months[0] && store.months[0] > monthKey() ? store.months[0] : monthKey();
  let search = '';
  let method = null;
  let from = null;
  let to = null;
  let filtersOpen = false;
  // Receipts keep the currency they were rung up in; a row about a receipt
  // formats with the receipt's own, or the row claims €10 was $10.
  const money = (n, currency = store.settings.currency) => formatMoney(n, currency);
  const receiptMoney = (s, n) => money(n, s.currency || store.settings.currency);

  const criteria = () => ({ text: search, method, from, to });
  const searching = () => hasCriteria(criteria());

  const label = el('h2.month-label', { 'aria-live': 'polite' });
  const listWrap = el('div');
  const monthNav = el('div.month-nav');
  const filterRow = el('div.receipt-filters');

  /**
   * The furthest month there is anything to browse to: this one, or a later
   * one that actually holds sales (an import, or a till whose clock ran
   * ahead). Past it, Next walked forward for ever through months that cannot
   * yet hold a sale, each one reading "No sales this month" exactly as a
   * quiet Tuesday in March would.
   */
  const latestMonth = () => {
    const newest = store.monthsWithSales()[0];
    const now = monthKey();
    return newest && newest > now ? newest : now;
  };

  /**
   * And the furthest back: the oldest month that holds sales. Behind it lies
   * the same walk Next used to take, in the other direction - months before
   * the shop had a till, each reading "No sales this month" as though it were
   * simply a quiet one. Empty months *inside* the history stay reachable:
   * "we took nothing that April" is a real thing to go and check.
   */
  const earliestMonth = () => {
    const keys = store.monthsWithSales();
    const oldest = keys[keys.length - 1];
    const now = monthKey();
    return oldest && oldest < now ? oldest : now;
  };

  const shift = (dir) => {
    if (dir > 0 && month >= latestMonth()) return;
    if (dir < 0 && month <= earliestMonth()) return;
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    renderMonth();
  };

  /** Typing re-arms the scan; a burst of keys runs it once. */
  let debounce = null;
  const searchInput = el('input.input.search-input', {
    type: 'search', placeholder: 'Search # · product · amount · customer',
    'aria-label': 'Search receipts by number, product, amount, or customer',
    oninput: () => {
      search = searchInput.value.trim();
      clearTimeout(debounce);
      debounce = setTimeout(update, 250);
    },
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      clearTimeout(debounce);
      update();
    },
  });

  /** How many of the method/date filters are actually narrowing the list. */
  const filterCount = () => [method, from, to].filter(Boolean).length;

  /** One tap back to the whole month, however many filters are set. */
  const clearFiltersBtn = el('button.btn.btn-ghost.btn-sm', {
    type: 'button',
    style: { marginTop: '10px' },
    onclick: () => {
      method = null;
      from = null;
      to = null;
      renderFilters();
      update();
    },
  }, 'Clear filters');

  /**
   * The toggle reflects the filters, not just the panel. Collapsing the row
   * left a method or a date still filtering with nothing on screen saying
   * so - the month nav gone, rows missing, and no hint of why.
   */
  function renderFilterBtn() {
    const n = filterCount();
    filterBtn.setAttribute('aria-expanded', filtersOpen ? 'true' : 'false');
    filterBtn.classList.toggle('active', filtersOpen || n > 0);
    const described = n
      ? `Payment and date filters · ${plural(n, 'filter')} applied`
      : 'Payment and date filters';
    filterBtn.setAttribute('aria-label', described);
    filterBtn.title = described;
    clearFiltersBtn.style.display = n ? '' : 'none';
  }

  // A method chip rebuilds the row it lives in, so focus is handed to the
  // chip's replacement rather than dropped to <body> on every narrowing.
  function renderFilters() {
    keepFocus(filterRow, paintFilters);
  }

  function paintFilters() {
    clear(filterRow);
    filterRow.style.display = filtersOpen ? '' : 'none';
    renderFilterBtn();
    if (!filtersOpen) return;
    const methodChips = el('div.chip-row', { role: 'group', 'aria-label': 'Payment method' },
      [[null, 'Any method'], ...PAYMENT_METHODS.map((m) => [m.value, m.label])].map(([value, text]) =>
        el('button.chip', {
          type: 'button',
          className: `chip${method === value ? ' active' : ''}`,
          'aria-pressed': method === value ? 'true' : 'false',
          onclick: () => { method = value; renderFilters(); update(); },
        }, text)));
    const dateInput = (value, aria, set) => {
      const input = el('input.input', { type: 'date', value: value || '', max: '2999-12-31', 'aria-label': aria });
      // Only the button state is refreshed here: rebuilding the row would
      // pull focus out of the date field the moment it was committed.
      input.addEventListener('change', () => { set(input.value || null); renderFilterBtn(); update(); });
      return input;
    };
    filterRow.append(
      methodChips,
      el('div.form-grid', { style: { marginTop: '8px' } },
        el('div.field', {}, el('label.label', {}, 'From'), dateInput(from, 'Sold on or after', (v) => { from = v; })),
        el('div.field', {}, el('label.label', {}, 'To'), dateInput(to, 'Sold on or before', (v) => { to = v; }))
      ),
      clearFiltersBtn
    );
  }

  let sales = [];
  /**
   * Stepping through months (or firing searches) faster than they load
   * starts a second read while the first is still out. Only the newest may
   * fill the list, or the heading ends up naming one month over another
   * month's receipts - and a stale scan would paint dead results.
   */
  let generation = 0;

  /** One receipt as a list row; search hits carry their date up front. */
  function receiptRow(s, { showDate = false } = {}) {
    const refund = isRefund(s);
    const pay = refund
      ? { icon: 'refund', label: 'Refund' }
      : paymentMethodInfo(paymentKindOf(s));
    const state = refundState(s);
    const items = Math.abs(s.itemCount);
    return el('button.card-row', {
      type: 'button',
      className: `card-row${s.voidedAt ? ' voided' : ''}${refund ? ' refunded-row' : ''}`,
      onclick: () => openDetail(s),
      // Everything inside the row sits behind this label, badges included -
      // so a sale already refunded, or one still waiting to reach the cloud,
      // announced exactly like any other until the sheet was opened and the
      // Refund and Void actions turned out not to be there.
      'aria-label': [
        `${refund ? 'Refund' : 'Receipt'} ${s.number}`,
        receiptMoney(s, s.total),
        s.voidedAt ? 'voided' : null,
        state === 'full' ? 'refunded' : state === 'partial' ? 'part refunded' : null,
        s.pendingSync ? 'pending sync' : null,
      ].filter(Boolean).join(', '),
    },
      el('span.pay-ic', { html: icon(pay.icon, 18, 1.8), title: pay.label }),
      el('span.card-main', {},
        el('span.card-title', {}, `#${s.number}`,
          s.voidedAt && el('span.badge.badge-danger', { style: { marginLeft: '8px' } }, 'Void'),
          refund && el('span.badge.badge-danger', { style: { marginLeft: '8px' } }, 'Refund'),
          state === 'full' && el('span.badge', { style: { marginLeft: '8px' } }, 'Refunded'),
          state === 'partial' && el('span.badge', { style: { marginLeft: '8px' } }, 'Part refunded'),
          // Rung up while offline: in history, not yet in the cloud.
          s.pendingSync && el('span.badge.badge-warn', { style: { marginLeft: '8px' } }, 'Pending sync')),
        el('span.card-sub', {}, [
          showDate ? formatDay(s.date) : null,
          formatTime(s.at),
          `${items} item${items === 1 ? '' : 's'}`,
          s.customerName || null,
          refund ? `of #${s.refundOfNumber}` : null,
        ].filter(Boolean).join(' · '))
      ),
      el('span.card-amount', {}, receiptMoney(s, s.total))
    );
  }

  /** Browse or search, whichever the inputs currently describe. */
  function update() {
    monthNav.style.display = searching() ? 'none' : '';
    if (searching()) startSearch();
    else renderMonth();
  }

  async function renderMonth() {
    const mine = ++generation;
    label.textContent = formatMonth(month);
    renderMonthNav();
    clear(listWrap);
    listWrap.append(el('div.loading', {}, 'Loading…'));
    let loaded;
    try {
      loaded = await store.loadMonth(month);
    } catch (err) {
      console.error(err);
      if (mine !== generation) return;
      clear(listWrap);
      listWrap.append(el('div.empty', {}, el('p', {}, 'Couldn’t load this month. Check your connection.')));
      return;
    }
    if (mine !== generation) return;
    sales = loaded;
    renderList();
  }

  function renderList() {
    clear(listWrap);
    const shown = sales;

    if (!shown.length) {
      listWrap.append(el('div.empty', {},
        el('div.empty-icon', { html: icon('receipt', 28) }),
        el('h3', {}, 'No sales this month'),
        el('p', {}, 'Completed sales appear here, newest first.')
      ));
      return;
    }

    // Group by day, newest day first; each day shows its (non-void) take -
    // refund totals are negative, so a day's figure is what it actually took.
    const byDay = new Map();
    for (const s of shown) {
      (byDay.get(s.date) || byDay.set(s.date, []).get(s.date)).push(s);
    }

    for (const [date, daySales] of byDay) {
      // Summed per currency: a day straddling a currency switch must not
      // add euros to dollars under one symbol.
      const sums = new Map();
      for (const s of daySales.filter((x) => !x.voidedAt)) {
        const cur = s.currency || store.settings.currency;
        sums.set(cur, (sums.get(cur) || 0) + s.total);
      }
      listWrap.append(el('div.day-head', {},
        el('span', {}, formatDay(date)),
        el('span.day-total', {}, [...sums].map(([cur, total]) => money(total, cur)).join(' + '))
      ));
      const group = el('div.card-list');
      for (const s of daySales) group.append(receiptRow(s));
      listWrap.append(group);
    }
  }

  /* ---------- Cross-month search ---------- */

  /**
   * Scans month files newest first, a bounded chunk per tap, streaming what
   * it finds - the one-file-per-month layout keeps each step cheap, and the
   * "keep searching" affordance is the honest alternative to an unbounded
   * scan of years of history.
   */
  const scan = { results: [], monthIdx: 0, scannedTo: null, exhausted: false, running: false };

  function startSearch() {
    scan.results = [];
    scan.monthIdx = 0;
    scan.scannedTo = null;
    scan.exhausted = false;
    continueSearch();
  }

  async function continueSearch() {
    const mine = ++generation;
    const crit = criteria();
    scan.running = true;
    renderSearch();
    const months = store.monthsWithSales();
    let scanned = 0;
    let hits = 0;
    while (scan.monthIdx < months.length && scanned < SEARCH_MONTH_CHUNK && hits < SEARCH_HIT_TARGET) {
      const key = months[scan.monthIdx];
      // The date filters bound the scan itself, not just the matches.
      if (crit.to && key > monthKeyOf(crit.to)) { scan.monthIdx++; continue; }
      if (crit.from && key < monthKeyOf(crit.from)) { scan.monthIdx = months.length; break; }
      let monthSales;
      try {
        monthSales = await store.loadMonth(key);
      } catch (err) {
        console.error(err);
        if (mine !== generation) return;
        scan.running = false;
        renderSearch('Couldn’t read a month. Check your connection.');
        return;
      }
      if (mine !== generation) return;
      for (const s of monthSales) {
        if (receiptMatches(s, crit)) { scan.results.push(s); hits++; }
      }
      scan.scannedTo = key;
      scan.monthIdx++;
      scanned++;
      renderSearch();
    }
    if (mine !== generation) return;
    scan.exhausted = scan.monthIdx >= months.length;
    scan.running = false;
    renderSearch();
    // The last chunk takes the button that was pressed away with it - there
    // is nothing left to search. The box it came from is where to go next.
    if (!document.activeElement || document.activeElement === document.body) searchInput.focus();
  }

  /**
   * A store change while results are showing - a void from the detail
   * sheet, the outbox draining in the background - must refresh what's on
   * screen without losing the scan's depth: restarting from the first
   * chunk threw away every "Keep searching" tap. Re-filter the months
   * already searched (they're cached, so this is instant) and continue
   * from where the scan stood.
   */
  async function refreshSearch() {
    const mine = ++generation;
    const crit = criteria();
    const months = store.monthsWithSales();
    // By name, not index: a month appearing at the front (the first sale
    // of a new month syncing in) would otherwise shift the window.
    const upto = scan.scannedTo ? months.indexOf(scan.scannedTo) : -1;
    const keys = upto >= 0 ? months.slice(0, upto + 1) : months.slice(0, scan.monthIdx);
    const results = [];
    for (const key of keys) {
      let monthSales;
      try {
        monthSales = await store.loadMonth(key);
      } catch {
        continue;   // already-scanned months are cached; nothing to lose here
      }
      if (mine !== generation) return;
      for (const s of monthSales) {
        if (receiptMatches(s, crit)) results.push(s);
      }
    }
    if (mine !== generation) return;
    scan.results = results;
    scan.monthIdx = keys.length;
    scan.running = false;
    renderSearch();
  }

  // "Keep searching" rebuilds the list it sits under, so a keyboard user
  // paging deeper into history keeps hold of the button they're pressing.
  function renderSearch(error = null) {
    keepFocus(listWrap, () => paintSearch(error));
  }

  function paintSearch(error) {
    clear(listWrap);

    if (!scan.results.length && scan.running) {
      listWrap.append(el('div.loading', {}, 'Searching…'));
      return;
    }

    if (!scan.results.length) {
      listWrap.append(el('div.empty', {},
        el('div.empty-icon', { html: icon('search', 28) }),
        el('h3', {}, 'No matches yet'),
        el('p', {}, scan.exhausted
          ? 'Nothing in your whole history matches. Try a product name, an exact amount, or a receipt number.'
          : `Nothing ${scan.scannedTo ? `back to ${formatMonth(scan.scannedTo)}` : 'yet'}. Older months haven’t been searched.`)
      ));
    } else {
      const group = el('div.card-list');
      for (const s of scan.results) group.append(receiptRow(s, { showDate: true }));
      listWrap.append(group);
    }

    listWrap.append(el('div.search-foot', {},
      el('span.small.muted', { 'aria-live': 'polite' }, error || [
        plural(scan.results.length, 'match', 'matches'),
        scan.scannedTo ? `searched back to ${formatMonth(scan.scannedTo)}` : null,
        scan.exhausted ? 'that’s everything' : null,
      ].filter(Boolean).join(' · ')),
      // aria-disabled, not disabled: pressing it rebuilds this row, and a
      // truly disabled replacement can't be handed the focus the press was
      // holding - the keyboard user would land on <body> every time they
      // reached further back. It stays reachable and says it is busy; the
      // handler is what refuses a second run.
      !scan.exhausted && el('button.btn.btn-ghost.btn-sm', {
        type: 'button',
        'aria-disabled': scan.running ? 'true' : 'false',
        onclick: () => { if (!scan.running) continueSearch(); },
      }, scan.running ? 'Searching…' : 'Keep searching')
    ));
  }

  function openDetail(sale) {
    // Everything in this sheet is about this sale: its currency, throughout.
    const money = (n) => formatMoney(n, sale.currency || store.settings.currency);
    const state = refundState(sale);
    const refundable = canRefund(sale);
    // Until it reaches the cloud, a sale can't be voided or refunded - the
    // month file it would be written to leaves queued sales out on purpose.
    const waiting = !!sale.pendingSync;

    const body = el('div', {},
      receiptNode(sale, store),
      waiting && el('div.callout.callout-warn', { style: { marginTop: '16px' } },
        el('span.callout-ic', { html: icon('cloudUp', 16, 2) }),
        el('span', {},
          el('strong', {}, 'Saved on this device'),
          '. It syncs on its own. Void and refund wait until it has.')),
      // The refunds raised against this sale, each openable in its own right.
      sale.refunds?.length ? el('div.detail-links', {},
        el('h3.detail-links-head', {}, state === 'full' ? 'Refunded in full' : 'Refunded in part'),
        ...sale.refunds.map((r) => el('button.detail-link', {
          type: 'button',
          onclick: async () => {
            const found = (await store.loadMonth(monthKeyOf(r.date)).catch(() => []))
              .find((s) => s.id === r.id);
            if (!found) { toast('That refund isn’t here any more', { icon: 'alert' }); return; }
            modal.close();
            openDetail(found);
          },
        },
          el('span.detail-link-ic', { html: icon('refund', 15, 2) }),
          el('span.grow', {}, `Refund #${r.number} · ${formatDay(r.date)}`),
          el('span.card-amount', {}, money(r.total))
        ))
      ) : null,
      el('div.row.wrap', { style: { marginTop: '16px' } },
        el('button.btn.btn-ghost.grow', {
          html: icon('printer', 16, 2),
          onclick: () => printReceipt(sale, store),
        }, ' Print'),
        // Voided and refunded copies carry their markings, so a shared image
        // can never pass for a live sale.
        el('button.btn.btn-ghost.grow', {
          html: icon('share', 16, 2),
          onclick: (e) => handOverReceipt(sale, e.currentTarget),
        }, ` ${shareActionLabel()}`),
        refundable && el('button.btn.btn-ghost.grow', {
          html: icon('refund', 16, 2),
          onclick: async () => {
            if (!(await requirePin('refund a sale'))) return;
            modal.close();
            openRefund(sale);
          },
        }, ' Refund'),
        // Void is for "I rang this up by mistake"; once money has moved, a
        // refund is the honest record and voiding would double-count it.
        !sale.voidedAt && !isRefund(sale) && !sale.refunds?.length && !waiting
          && el('button.btn.btn-ghost.btn-danger-ghost.grow', {
            html: icon('ban', 16, 2),
            onclick: async () => {
              if (!(await requirePin('void a sale'))) return;
              const ok = await confirmDialog({
                title: `Void receipt #${sale.number}?`,
                message: 'Use this for a sale rung up by mistake: it stays in history, is excluded from reports as though it never happened, and tracked stock goes back on the shelf. If money actually changed hands, refund it instead so the till still balances.',
                confirmLabel: 'Void sale',
              });
              if (!ok) return;
              try {
                await store.voidSale(sale.id, sale.date);
              } catch (err) {
                console.error(err);
                toast(explains(err) ? err.message : 'Couldn’t void. Check your connection',
                  { icon: 'wifiOff', duration: 5000 });
                return;
              }
              modal.close();
              // No repaint here: the store's change event already refreshed
              // whichever mode is showing. Painting the month list now would
              // clobber active search results with another month's rows.
              toast(`Receipt #${sale.number} voided`, { icon: 'ban' });
            },
          }, ' Void')
      )
    );
    const modal = openModal({
      title: isRefund(sale) ? `Refund #${sale.number}` : `Receipt #${sale.number}`,
      content: body,
    });
  }

  /**
   * Return some or all of a sale. Opens on everything still refundable, so the
   * common "they brought the whole thing back" case is one tap.
   */
  function openRefund(sale) {
    // A refund is that sale coming back: priced and shown in its currency.
    const money = (n) => formatMoney(n, sale.currency || store.settings.currency);
    const picks = fullRefundPicks(sale).reduce((map, p) => map.set(p.index, p.qty), new Map());
    // Money goes back the way it came. Opening on cash for a card sale was a
    // silent till error waiting to happen: one tap through the sheet booked
    // cash out of a drawer nothing had come into, leaving the close short by
    // the refund and crediting the wrong tender in reports. A split sale has
    // no single answer, so it still opens on cash and asks.
    const [onlyTender, ...otherTenders] = receiptPayments(sale);
    let method = !otherTenders.length && PAYMENT_METHODS.some((m) => m.value === onlyTender?.method)
      ? onlyTender.method
      : 'cash';
    let restock = true;
    /**
     * Who the credit belongs to. The sale's own customer to begin with; a
     * refund to credit on a sale that never had one asks for one, because a
     * balance has to belong to somebody.
     */
    let creditTo = sale.customerId ? store.customer(sale.customerId) : null;
    const noteInput = el('input.input', {
      type: 'text', maxLength: 80, placeholder: 'e.g. wrong size',
      'aria-label': 'Reason for the refund',
    });

    const body = el('div');
    // Dismissal is refused while the write is out, exactly like the payment
    // and hold sheets: an Escape that looked like a cancel, retried on a slow
    // connection, would hand the same units back twice.
    let refunding = false;
    const modal = openModal({
      title: `Refund receipt #${sale.number}`,
      content: body,
      canClose: () => !refunding,
    });

    /** Products on the picked lines that actually track stock. */
    const tracksStock = () => sale.lines.some((l, i) => {
      if (!(picks.get(i) > 0) || !l.productId) return false;
      const p = store.product(l.productId);
      return p && p.stock !== null && p.stock !== undefined;
    });

    // Every ± on a line, and every method tap, rebuilds the whole sheet.
    // Without the hand-back a cashier returning three of something had to
    // Tab in from the top of the dialog between each press.
    function render() {
      keepFocus(body, paint);
    }

    function paint() {
      clear(body);
      const plan = refundPlan(sale, [...picks].map(([index, qty]) => ({ index, qty })));
      const nothing = !plan.lines.length;

      const rows = el('div.refund-lines');
      sale.lines.forEach((line, i) => {
        const max = refundableQty(line);
        const already = refundedQty(line);
        const qty = picks.get(i) || 0;
        const step = (delta) => {
          picks.set(i, Math.min(max, Math.max(0, qty + delta)));
          render();
        };
        // A measured line ('0.735 kg') takes a typed amount back, not ±1.
        const measuredPicker = () => {
          const input = el('input.input.refund-measure', {
            type: 'text', inputmode: 'decimal', value: String(qty),
            'aria-label': `Amount of ${line.name} to refund, up to ${max} ${line.unit}`,
          });
          input.addEventListener('change', () => {
            const n = Number(String(input.value).trim().replace(/,/g, '.'));
            const clean = Number.isFinite(n) && n > 0 ? Math.min(max, Math.round(n * 1000) / 1000) : 0;
            picks.set(i, clean);
            render();
          });
          return el('div.row', { style: { flex: 'none' } },
            input,
            el('span.refund-qty', { 'aria-live': 'polite' }, `/ ${max} ${line.unit}`));
        };
        rows.append(el('div.refund-line', { className: `refund-line${max ? '' : ' spent'}` },
          el('div.refund-line-main', {},
            el('span.refund-name', {}, line.name),
            el('span.refund-sub', {}, [
              line.unit ? `${money(line.unitPrice)}/${line.unit}` : `${money(line.unitPrice)} each`,
              line.options?.length ? optionsLabel(line.options) : null,
              already ? `${already}${line.unit ? ` ${line.unit}` : ''} of ${line.qty}${line.unit ? ` ${line.unit}` : ''} already refunded` : null,
            ].filter(Boolean).join(' · '))
          ),
          max
            ? (line.unit ? measuredPicker() : el('div.qty-stepper.refund-stepper', {},
              el('button.icon-btn.qty-btn', {
                type: 'button', html: icon('minus', 16, 2),
                'aria-label': `Refund fewer ${line.name}`,
                disabled: qty <= 0,
                onclick: () => step(-1),
              }),
              el('span.refund-qty', { 'aria-live': 'polite' }, `${qty}/${max}`),
              el('button.icon-btn.qty-btn', {
                type: 'button', html: icon('plus', 16, 2),
                'aria-label': `Refund more ${line.name}`,
                disabled: qty >= max,
                onclick: () => step(1),
              })
            ))
            : el('span.badge', {}, 'Refunded')
        ));
      });

      const seg = el('div.seg.seg-block.seg-wrap', { role: 'group', 'aria-label': 'Refund method' });
      for (const m of PAYMENT_METHODS) {
        seg.append(el('button.seg-btn', {
          type: 'button',
          className: `seg-btn${method === m.value ? ' active' : ''}`,
          'aria-pressed': method === m.value ? 'true' : 'false',
          html: icon(m.icon, 16, 2),
          onclick: () => { method = m.value; render(); },
        }, ` ${m.label}`));
      }

      /* Store credit keeps the money in the shop, and needs somebody to keep
         it for. Nothing is written until Refund, so picking a customer here
         only fills in this field. */
      const creditRow = method !== 'credit' ? null : el('div.field', {},
        el('label.label', {}, 'Credit goes to'),
        creditTo
          ? el('div.row', {},
            el('div.grow.small', {},
              el('strong', {}, creditTo.name),
              ` · ${fmtMoney(store.creditBalance(creditTo.id), store.settings.currency)} on the balance now`),
            el('button.btn.btn-ghost.btn-sm', {
              type: 'button',
              onclick: () => openCustomerPicker({ onPick: (c) => { creditTo = c; render(); } }),
            }, 'Change'))
          : el('button.btn.btn-ghost.btn-block', {
            type: 'button',
            html: icon('userPlus', 15, 2),
            onclick: () => openCustomerPicker({ onPick: (c) => { creditTo = c; render(); } }),
          }, ' Choose a customer'),
        el('p.small.field-note', {},
          creditTo
            ? `${money(Math.abs(plan.total))} goes onto their balance to spend on a later sale. The refund receipt prints it.`
            : 'A balance has to belong to a customer. Attach one, or refund another way.')
      );

      const restockToggle = el('input', { type: 'checkbox', id: 'refund-restock', checked: restock });
      restockToggle.addEventListener('change', () => { restock = restockToggle.checked; });

      // append() (not node.append) so the conditional rows drop out rather
      // than stringifying into the sheet.
      append(body, [
        el('p.small.muted', { style: { marginBottom: '14px' } },
          `Sold ${formatDay(sale.date)} · ${money(sale.total)}. Pick what came back; the customer is owed what they paid, including any discount and the tax rate of that day.`),
        rows,
        el('dl.totals.refund-totals', {},
          trow('Refund subtotal', money(plan.subtotal)),
          plan.discountTotal !== 0 && trow('Discounts', money(plan.discountTotal)),
          ...plan.taxes.map((t) => trow(
            `${t.name || 'Tax'} ${t.rate}%${sale.pricesIncludeTax ? ' (incl.)' : ''}`, money(t.tax))),
          trow('Refund total', money(plan.total), true)
        ),
        // The tip rode on the payment, not the sale, and refunds return the
        // sale. Say so, and point at the drawer's own tool for the cash.
        receiptTip(sale) > 0 && el('p.small.muted', { style: { margin: '10px 0 0' } },
          `The ${money(receiptTip(sale))} tip isn’t included in a refund. If you hand it back in cash, record it as cash out in the drawer.`),
        el('h3.pay-section', {}, 'Refund with'),
        seg,
        creditRow,
        tracksStock() ? el('div.field.check-field', { style: { margin: '14px 0' } },
          restockToggle,
          el('label', { htmlFor: 'refund-restock' }, 'Put the returned items back in stock')
        ) : null,
        el('div.field', {}, el('label.label', {}, 'Reason (optional)'), noteInput),
        el('button.btn.btn-danger.btn-block.charge-btn', {
          type: 'button',
          // Credit with nobody to hold it is not a refund anyone can make.
          disabled: nothing || (method === 'credit' && !creditTo),
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            refunding = true;
            let refund;
            try {
              refund = await store.refundSale({
                receiptId: sale.id,
                date: sale.date,
                picks: [...picks].map(([index, qty]) => ({ index, qty })),
                method,
                restock,
                note: noteInput.value,
                customerId: method === 'credit' ? creditTo?.id || null : null,
              });
            } catch (err) {
              console.error(err);
              refunding = false;
              btn.disabled = false;
              toast(explains(err) ? err.message : 'Couldn’t record the refund. Check your connection',
                { icon: 'wifiOff', duration: 5000 });
              return;
            }
            refunding = false;
            modal.close();
            // The refund is filed under today, which may not be the month on
            // screen - jump there (or re-run the search) so it's visible.
            month = monthKey();
            update();
            toast(refund.creditIssued
              ? `${money(refund.creditIssued)} added to ${refund.customerName}’s store credit · receipt #${refund.number}`
              : `Refunded ${money(Math.abs(refund.total))} · receipt #${refund.number}`, {
              icon: refund.creditIssued ? 'ticket' : 'refund', duration: 5000,
            });
            openDetail(refund);
          },
        }, nothing ? 'Nothing selected'
          : method === 'credit' && !creditTo ? 'Choose who the credit is for'
            : method === 'credit' ? `Credit ${money(Math.abs(plan.total))}`
              : `Refund ${money(Math.abs(plan.total))}`),
      ]);
    }
    render();
  }

  function trow(label, value, strong = false) {
    return el(`div.trow${strong ? '.trow-total' : ''}`, {},
      el('dt', {}, label), el('dd', {}, value));
  }

  const prevBtn = el('button.icon-btn', {
    html: icon('chevL', 20), 'aria-label': 'Previous month', onclick: () => shift(-1),
  });
  const nextBtn = el('button.icon-btn', {
    html: icon('chevR', 20), 'aria-label': 'Next month', onclick: () => shift(1),
  });
  /**
   * aria-disabled, not disabled: the arrows keep their place in the tab order,
   * so a keyboard user paging through history isn't dropped to <body> the
   * moment they reach either end of it. `shift` is what refuses.
   */
  const renderMonthNav = () => {
    prevBtn.setAttribute('aria-disabled', month <= earliestMonth() ? 'true' : 'false');
    nextBtn.setAttribute('aria-disabled', month >= latestMonth() ? 'true' : 'false');
  };
  monthNav.append(prevBtn, label, nextBtn);

  const filterBtn = el('button.btn.btn-ghost.filter-btn', {
    type: 'button',
    html: icon('sliders', 18, 1.8),
    'aria-label': 'Payment and date filters',
    title: 'Payment and date filters',
    'aria-expanded': 'false',
    onclick: () => {
      filtersOpen = !filtersOpen;
      renderFilters();
    },
  });

  const node = el('div.view', {},
    el('header.view-head', {},
      el('div', {},
        el('h1.view-title', {}, 'Receipts'),
        el('p.view-sub', {}, 'Every completed sale · search spans months')
      )
    ),
    monthNav,
    el('div.reg-toolbar', {},
      el('div.search-wrap', { html: icon('search', 17, 2) }, searchInput),
      filterBtn
    ),
    filterRow,
    listWrap
  );
  renderFilters();

  // A store change re-filters in place while a search is up (update()
  // would restart the scan from scratch); browsing just re-reads the month.
  const onChange = () => {
    if (searching()) refreshSearch();
    else update();
  };
  store.addEventListener('change', onChange);
  update();

  return {
    node,
    destroy: () => {
      store.removeEventListener('change', onChange);
      clearTimeout(debounce);
      generation++;   // a load still out must not paint into a dead view
    },
  };
}

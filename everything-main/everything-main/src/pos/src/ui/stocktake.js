/**
 * Stocktake: count the shop and post every variance in one pass.
 *
 * The alternative it replaces is the Adjust stock sheet, one product at a
 * time - 200 products means 200 sheets, 200 writes, and no record that the
 * shop was counted on the 3rd.
 *
 * Three panes: pick the scope, work down the sheet, then read what will be
 * posted before anything moves. Counted *quantities* are typed, never deltas -
 * a cashier holding six mugs types 6 and the app works out the −2 - and the
 * session is written as it goes, because counting is a half-hour job on a
 * shop floor and the tablet will sleep.
 */

import { el, clear, append, keepFocus } from './dom.js';
import { icon } from './icons.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { formatMoney } from '../lib/money.js';
import { formatDay, formatTime, formatAgo, todayISO } from '../lib/dates.js';
import { matches, plural } from '../lib/util.js';
import { requirePin } from './pin-gate.js';
import { openCameraScanner } from './scanner.js';
import { createWedgeReader, findBySku, cameraScanSupported } from '../lib/scan.js';

/** Products a count could cover at all: the ones that track stock. */
export const trackedProducts = () => store.products.filter((p) => p.stock !== null && p.stock !== undefined);

/** '−2' / '+3' - a variance always wears its sign, and the app's own minus. */
export function signed(n, unit = '') {
  const v = Math.round((Number(n) || 0) * 1000) / 1000;
  const mark = v < 0 ? '−' : '+';
  return `${mark}${Math.abs(v)}${unit ? ` ${unit}` : ''}`;
}

/**
 * A counted quantity: a plain non-negative number, to 3 places for measured
 * products. Null for an empty field ("not counted"), NaN for anything typed
 * that isn't a count - which is re-asked rather than stored as zero, since
 * zero is a real and consequential answer here.
 */
export function parseCount(text, { measured = false } = {}) {
  const s = String(text ?? '').trim().replace(/,/g, '.');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 9_999_999) return NaN;
  return measured ? Math.round(n * 1000) / 1000 : Math.round(n);
}

export function openStocktake() {
  const money = (n) => formatMoney(n, store.settings.currency);
  const body = el('div');
  /** Blocks dismissal while the post is out - it writes three files. */
  let posting = false;
  /** Listeners this sheet owns; run when it closes, however it closes. */
  const teardown = [];
  const modal = openModal({
    title: 'Stocktake',
    content: body,
    wide: true,
    canClose: () => !posting,
    onClose: () => {
      // A count in progress is worth its last write even on a dismissal.
      store.flushStocktake();
      for (const off of teardown.splice(0)) off();
    },
  });

  let search = '';
  /** The row to pulse and focus after a scan, so a hands-free count is visible. */
  let flashId = null;

  /* ---------- Pane 1: start, or pick up where the count left off ---------- */

  function paintStart() {
    clear(body);
    const tracked = trackedProducts();
    if (!tracked.length) {
      body.append(el('div.empty', {},
        el('div.empty-icon', { html: icon('package', 26) }),
        el('h3', {}, 'Nothing tracks stock yet'),
        el('p', {}, 'Turn on stock tracking for a product and it can be counted here.')));
      return;
    }

    let categoryId = null;
    let blind = false;

    const catSelect = el('select.select', {
      'aria-label': 'What to count',
      onchange: (e) => { categoryId = e.target.value || null; },
    },
      el('option', { value: '' }, `Everything tracked · ${plural(tracked.length, 'product')}`),
      ...store.categories
        .map((c) => ({ c, n: tracked.filter((p) => p.categoryId === c.id).length }))
        .filter(({ n }) => n > 0)
        .map(({ c, n }) => el('option', { value: c.id }, `${c.name} · ${plural(n, 'product')}`))
    );

    const blindToggle = el('input', { type: 'checkbox', id: 'stocktake-blind' });
    blindToggle.addEventListener('change', () => { blind = blindToggle.checked; });

    append(body, [
      el('p.small.muted', { style: { marginBottom: '14px' } },
        'Work down the sheet typing what is actually on the shelf. Nothing moves until you post '
        + 'the count, and the sheet is saved as you go — you can close it and come back.'),
      el('div.field', {}, el('label.label', {}, 'Count'), el('div.select-wrap', {}, catSelect)),
      el('div.field.check-field', {},
        blindToggle,
        el('label', { htmlFor: 'stocktake-blind' }, 'Blind count — hide the expected figure')
      ),
      el('p.small.muted', { style: { margin: '-8px 0 16px' } },
        'A number on the screen is a number people talk themselves into. The variance is shown at the end either way.'),
      el('button.btn.btn-primary.btn-block', {
        type: 'button',
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            await store.startStocktake({ categoryId, blind });
          } catch (err) {
            console.error(err);
            btn.disabled = false;
            toast(err.message === 'A count is already open.' ? err.message
              : 'Couldn’t start the count. Check your connection', { icon: 'wifiOff' });
            return;
          }
          paintCount();
        },
      }, 'Start counting'),
      pastCounts(),
    ]);
  }

  /** Past counts, browsable the way day closes are. */
  function pastCounts() {
    const wrap = el('div', { style: { marginTop: '18px' } });
    if (!store.stocktakeMonths.length) return wrap;
    wrap.append(el('h3.pay-section', {}, 'Past counts'), el('div.loading', {}, 'Loading…'));
    store.recentStocktakes({ limit: 8 }).then((records) => {
      if (!wrap.isConnected) return;
      clear(wrap);
      if (!records.length) return;
      wrap.append(el('h3.pay-section', {}, 'Past counts'));
      const list = el('div.card-list');
      for (const r of records) {
        const cur = (n) => formatMoney(n, r.currency || store.settings.currency);
        list.append(el('button.card-row', {
          type: 'button',
          onclick: () => openPastCount(r),
          'aria-label': `Count of ${formatDay(r.date)}, ${plural(r.varianceCount, 'variance')}`,
        },
          el('span.pay-ic', { html: icon('clipboard', 18, 1.8) }),
          el('span.card-main', {},
            el('span.card-title', {}, `${formatDay(r.date)}${r.categoryName ? ` · ${r.categoryName}` : ''}`),
            el('span.card-sub', {}, [
              `${plural(r.counted, 'product')} counted`,
              r.varianceCount ? `${plural(r.varianceCount, 'variance')}` : 'no variances',
              r.blind ? 'blind' : null,
            ].filter(Boolean).join(' · '))),
          el('span.card-amount', {
            className: `card-amount${r.value < 0 ? ' short' : r.value > 0 ? ' over' : ''}`,
          }, r.varianceCount ? cur(r.value) : '—')
        ));
      }
      wrap.append(list);
    }).catch((err) => {
      console.error(err);
      if (!wrap.isConnected) return;
      clear(wrap);
      wrap.append(el('h3.pay-section', {}, 'Past counts'),
        el('p.small.muted', {}, 'Couldn’t read past counts. Check your connection.'));
    });
    return wrap;
  }

  /* ---------- Pane 2: the sheet ---------- */

  const rowsWrap = el('div.count-list');
  const progress = el('p.small.muted', { 'aria-live': 'polite' });

  function paintCount() {
    clear(body);
    const session = store.stocktake;
    if (!session) { paintStart(); return; }
    const scope = store.stocktakeScope(session);
    const category = session.categoryId ? store.category(session.categoryId) : null;

    const searchInput = el('input.input.search-input', {
      type: 'search', placeholder: 'Search or scan to jump to a product',
      'aria-label': 'Search the count sheet, or scan a barcode',
      value: search,
      oninput: (e) => { search = e.target.value; renderRows(); },
      onkeydown: (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const found = findBySku(scope, search.trim());
        if (found.length === 1) jumpTo(found[0].id);
      },
    });

    append(body, [
      el('p.small.muted', { style: { marginBottom: '12px' } },
        `Counting ${category ? category.name : 'everything tracked'} · started ${formatAgo(session.startedAt)}`,
        session.blind ? ' · blind' : ''),
      el('div.reg-toolbar', {},
        el('div.search-wrap', { html: icon('search', 17, 2) }, searchInput),
        cameraScanSupported() && el('button.btn.btn-ghost.scan-btn', {
          type: 'button',
          html: icon('scan', 18, 1.8),
          'aria-label': 'Scan a barcode with the camera',
          title: 'Scan a barcode with the camera',
          onclick: () => openCameraScanner({ onCode: handleScan }),
        })),
      progress,
      rowsWrap,
      el('div.row.form-actions', {},
        el('button.btn.btn-ghost.btn-danger-ghost', {
          type: 'button',
          onclick: async () => {
            const ok = await confirmDialog({
              title: 'Discard this count?',
              message: 'Everything counted so far is thrown away. No stock level has been changed yet.',
              confirmLabel: 'Discard the count',
            });
            if (!ok) return;
            try {
              await store.cancelStocktake();
            } catch (err) {
              console.error(err);
              toast('Couldn’t discard. Check your connection', { icon: 'wifiOff' });
              return;
            }
            toast('Count discarded', { icon: 'trash' });
            paintStart();
          },
        }, 'Discard'),
        el('button.btn.btn-ghost', {
          type: 'button',
          onclick: () => { store.flushStocktake(); modal.close(); toast('Count saved. Pick it up from Products', { icon: 'clipboard' }); },
        }, 'Save and close'),
        el('button.btn.btn-primary.grow', {
          type: 'button',
          onclick: paintReview,
        }, 'Review the count')
      ),
    ]);
    renderRows();
  }

  /** A scan jumps to that product's row - counting with the shop's own scanner. */
  function handleScan(code) {
    const scope = store.stocktakeScope();
    const found = findBySku(scope, code);
    if (found.length === 1) { jumpTo(found[0].id); return; }
    if (found.length > 1) {
      toast(`${found.length} products in this count share the code ${code}`, { icon: 'alert' });
      return;
    }
    // Off-sheet, not unknown: saying "no such product" would be wrong when
    // the product exists but this count doesn't cover it.
    const anywhere = findBySku(store.products, code);
    toast(anywhere.length
      ? `${anywhere[0].name} isn’t in this count`
      : `No product uses the code ${code}`, { icon: 'alert' });
  }

  /** Show a product's row, clear whatever is hiding it, and focus its field. */
  function jumpTo(productId) {
    if (search) {
      search = '';
      const input = body.querySelector('.search-input');
      if (input) input.value = '';
    }
    flashId = productId;
    renderRows();
    // Escaped, like every other id this app turns into a selector or a path:
    // a restored backup carries whatever ids its file held, and one with a
    // quote in it closed the attribute selector early and threw out of the
    // scan handler instead of jumping to the row.
    const field = rowsWrap.querySelector(`.count-row[data-id="${CSS.escape(productId)}"] input`);
    field?.scrollIntoView({ block: 'center' });
    field?.focus();
    field?.select?.();
  }

  function renderRows() {
    keepFocus(rowsWrap, paintRows);
  }

  function paintRows() {
    clear(rowsWrap);
    const session = store.stocktake;
    if (!session) return;
    const scope = store.stocktakeScope(session);
    const shown = scope.filter((p) => matches(p.name, search) || matches(p.sku, search));
    const done = scope.filter((p) => session.counts[p.id]).length;

    clear(progress);
    progress.append(el('span', {},
      `${done} of ${scope.length} counted`,
      done < scope.length ? ' · uncounted products are left exactly as they are' : ' · every product on the sheet has a count'));

    if (!shown.length) {
      rowsWrap.append(el('div.empty', { style: { padding: '20px 10px' } },
        el('p', {}, scope.length ? 'Nothing on this sheet matches your search.' : 'Nothing in this count tracks stock any more.')));
      return;
    }

    for (const p of shown) {
      const entry = session.counts[p.id];
      const measured = p.soldBy === 'measure';
      const unit = measured ? p.unit || '' : '';
      const input = el('input.input.count-input', {
        type: 'text',
        inputmode: measured ? 'decimal' : 'numeric',
        value: entry ? String(entry.counted) : '',
        placeholder: measured ? '0.000' : '0',
        'aria-label': `Counted ${p.name}${unit ? ` in ${unit}` : ''}`,
      });
      // Committed on change/blur, not per keystroke: a half-typed "1" of 12
      // would otherwise be saved as a variance of −11 and shown as one.
      input.addEventListener('change', () => {
        const counted = parseCount(input.value, { measured });
        if (Number.isNaN(counted)) {
          toast(`Enter what you counted of ${p.name} as a plain number`, { icon: 'alert' });
          input.value = entry ? String(entry.counted) : '';
          input.focus();
          return;
        }
        store.queueStocktakeCount(p.id, counted);
        renderRows();
      });

      const delta = entry ? Math.round((entry.counted - entry.expected) * 1000) / 1000 : null;
      rowsWrap.append(el('div.count-row', {
        className: `count-row${entry ? ' counted' : ''}${flashId === p.id ? ' flash' : ''}`,
        dataset: { id: p.id },
      },
        el('div.count-main', {},
          el('span.count-name', {}, p.name),
          el('span.count-sub', {}, [
            // Hidden while blind: the whole point is not to see it.
            session.blind ? null : `${p.stock}${unit ? ` ${unit}` : ''} expected`,
            p.sku || null,
          ].filter(Boolean).join(' · ') || 'On the sheet')
        ),
        el('div.count-entry', {},
          input,
          unit ? el('span.count-unit', {}, unit) : null,
          entry && el('button.icon-btn', {
            type: 'button',
            html: icon('x', 15, 2),
            title: `Clear the count for ${p.name}`,
            'aria-label': `Clear the count for ${p.name}`,
            onclick: () => { store.queueStocktakeCount(p.id, null); renderRows(); },
          })
        ),
        // Live, and never while blind - it would give the expected away.
        el('span.count-delta', {
          className: `count-delta${delta === null || session.blind ? ' none' : delta === 0 ? ' ok' : delta < 0 ? ' short' : ' over'}`,
        }, delta === null || session.blind ? '' : delta === 0 ? 'Matches' : signed(delta, unit))
      ));
    }
    flashId = null;
  }

  /* ---------- Pane 3: what posting will do ---------- */

  function paintReview() {
    const plan = store.stocktakePlan();
    if (!plan) { paintStart(); return; }
    clear(body);

    const kv = (label, value) => el('div.kv-row', {},
      el('span', {}, label), el('span.kv-value', {}, value));

    const varianceRows = plan.variances.length
      ? el('div.table-scroll', {},
        el('table.data-table', {},
          el('caption.sr-only', {}, 'Variances to post'),
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col' }, 'Product'),
            el('th.num', { scope: 'col' }, 'Expected'),
            el('th.num', { scope: 'col' }, 'Counted'),
            el('th.num', { scope: 'col' }, 'Variance'),
            el('th.num', { scope: 'col' }, 'Value'))),
          el('tbody', {}, plan.variances.map((l) => el('tr', {},
            el('td', {}, l.name),
            el('td.num', {}, `${l.expected}${l.unit ? ` ${l.unit}` : ''}`),
            el('td.num', {}, `${l.counted}${l.unit ? ` ${l.unit}` : ''}`),
            el('td.num', {
              className: `num ${l.delta < 0 ? 'count-short' : 'count-over'}`,
            }, signed(l.delta, l.unit)),
            // A product with no cost has no value to put here, and a dash is
            // the honest answer - not a zero that would sum.
            el('td.num', {}, l.value === null ? '—' : money(l.value))))),
          el('tfoot', {}, el('tr', {},
            el('th', { scope: 'row' }, 'Net'),
            el('td.num', {}, ''),
            el('td.num', {}, ''),
            el('td.num', {}, `${plan.unitsOver ? `+${plan.unitsOver}` : ''}${plan.unitsOver && plan.unitsShort ? ' / ' : ''}${plan.unitsShort ? `−${plan.unitsShort}` : ''}` || '0'),
            el('td.num', {}, money(plan.value))))
        ))
      : null;

    append(body, [
      el('p.small.muted', { style: { marginBottom: '14px' } },
        'Nothing has moved yet. Posting records every variance below in the movement ledger, '
        + 'against the level as it stands now — a sale rung up while you were counting stays counted.'),
      el('div.kv-list', { style: { marginBottom: '16px' } },
        kv('Counted', plural(plan.counted, 'product')),
        plan.skipped > 0 && kv('Not counted', `${plural(plan.skipped, 'product')} · left as they are`),
        kv('Variances', plan.variances.length ? plural(plan.variances.length, 'product') : 'None — the shelf matches'),
        plan.variances.length > 0 && kv('Worth', money(plan.value))
      ),
      varianceRows,
      plan.unknownCost > 0 && el('p.small.muted', { style: { marginTop: '10px' } },
        `${plural(plan.unknownCost, 'product')} with a variance ${plan.unknownCost === 1 ? 'has' : 'have'} no cost recorded, so ${plan.unknownCost === 1 ? 'it is' : 'they are'} not in the value above.`),
      !plan.variances.length && el('div.callout.callout-accent', { style: { marginTop: '10px' } },
        el('span.callout-ic', { html: icon('circleCheck', 16, 2) }),
        el('span', {}, 'Every count matches what the app expected. Posting files the count itself, so there is a record that the shop was counted.')),
      el('div.row.form-actions', {},
        el('button.btn.btn-ghost', { type: 'button', onclick: paintCount }, 'Back to the sheet'),
        el('button.btn.btn-primary.grow', {
          type: 'button',
          onclick: async (e) => {
            const btn = e.currentTarget;
            if (!(await requirePin('post a stocktake'))) return;
            btn.disabled = true;
            posting = true;
            let record;
            try {
              record = await store.postStocktake();
            } catch (err) {
              console.error(err);
              posting = false;
              btn.disabled = false;
              toast(/already been posted|open count|counted yet/.test(err.message || '')
                ? err.message
                : 'Couldn’t post the count. Check your connection and try again',
              { icon: 'wifiOff', duration: 6000 });
              return;
            }
            posting = false;
            modal.close();
            toast(record.varianceCount
              ? `Count posted · ${plural(record.varianceCount, 'variance')} recorded`
              : 'Count posted · nothing to correct', { icon: 'circleCheck', duration: 5000 });
          },
        }, plan.variances.length
          ? `Post ${plural(plan.variances.length, 'variance')}`
          : 'Post the count')
      ),
    ]);
  }

  /* A count in progress opens on the sheet; otherwise on the scope picker. */
  if (store.stocktake) paintCount();
  else paintStart();

  /**
   * Wedge scanners type into whatever has focus. While the sheet is up, a
   * scan that didn't land in a field jumps to that product's row - counting a
   * shop with the scanner it already owns.
   */
  const wedge = createWedgeReader({ onScan: handleScan });
  const onKey = (e) => {
    if (!store.stocktake) return;
    // Another dialog on top (a confirm, the PIN gate) owns the keyboard.
    const stack = document.querySelectorAll('.modal-root:not(.closing)');
    if (stack[stack.length - 1] !== modal.panel.parentElement) { wedge.reset(); return; }
    const t = e.target;
    if (t instanceof HTMLElement
      && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
    if (wedge.handle(e, e.timeStamp || performance.now())) e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  teardown.push(() => document.removeEventListener('keydown', onKey));
  // A tablet going to sleep mid-count still gets its last row out the door.
  const onPageHide = () => store.flushStocktake();
  window.addEventListener('pagehide', onPageHide);
  teardown.push(() => window.removeEventListener('pagehide', onPageHide));
  return modal;
}

/** A posted count, read-only: what was counted, and what it corrected. */
export function openPastCount(record) {
  const money = (n) => formatMoney(n, record.currency || store.settings.currency);
  const variances = (record.lines || []).filter((l) => l.delta !== 0);
  const kv = (label, value) => el('div.kv-row', {},
    el('span', {}, label), el('span.kv-value', {}, value));

  const body = el('div', {},
    el('p.small.muted', { style: { marginBottom: '14px' } },
      `${formatDay(record.date)} · ${formatTime(record.at)}`
      + `${record.categoryName ? ` · ${record.categoryName}` : ' · everything tracked'}`
      + `${record.blind ? ' · blind count' : ''}`),
    el('div.kv-list', { style: { marginBottom: '16px' } },
      kv('Counted', plural(record.counted, 'product')),
      record.skipped > 0 && kv('Not counted', plural(record.skipped, 'product')),
      kv('Variances', variances.length ? plural(variances.length, 'product') : 'None'),
      variances.length > 0 && kv('Worth', money(record.value))
    ),
    variances.length ? el('div.table-scroll', {},
      el('table.data-table', {},
        el('caption.sr-only', {}, 'Variances posted by this count'),
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col' }, 'Product'),
          el('th.num', { scope: 'col' }, 'Expected'),
          el('th.num', { scope: 'col' }, 'Counted'),
          el('th.num', { scope: 'col' }, 'Variance'),
          el('th.num', { scope: 'col' }, 'Value'))),
        el('tbody', {}, variances.map((l) => el('tr', {},
          el('td', {}, l.name),
          el('td.num', {}, `${l.expected}${l.unit ? ` ${l.unit}` : ''}`),
          el('td.num', {}, `${l.counted}${l.unit ? ` ${l.unit}` : ''}`),
          el('td.num', {
            className: `num ${l.delta < 0 ? 'count-short' : 'count-over'}`,
          }, signed(l.delta, l.unit)),
          el('td.num', {}, l.value === null ? '—' : money(l.value)))))
      )
    ) : el('p.small.muted', {}, 'Every count matched what the app expected.')
  );
  return openModal({ title: `Count · ${formatDay(record.date)}`, content: body, wide: true });
}

/** 'Counting · 12 of 34' - what the Products view says about an open session. */
export function openSessionLabel() {
  const session = store.stocktake;
  if (!session) return null;
  const scope = store.stocktakeScope(session);
  const done = scope.filter((p) => session.counts[p.id]).length;
  return `${done} of ${scope.length} counted${session.startedAt ? ` · started ${formatAgo(session.startedAt)}` : ''}`;
}

/** True when today already holds a posted count - a nicety for the button. */
export async function countedToday() {
  const today = todayISO();
  const records = await store.recentStocktakes({ limit: 4 }).catch(() => []);
  return records.some((r) => r.date === today);
}

import { el, clear, svgEl } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { store, PAYMENT_METHODS, receiptPayments, paymentMethodInfo } from '../lib/store.js';
import { receiptTip } from '../lib/payments.js';
import { isRefund } from '../lib/refunds.js';
import { profitSummary, lineNetCents, lineCostCents } from '../lib/profit.js';
import { taxSummary, taxRowLabel } from '../lib/tax-report.js';
import { taxSummaryCsv, csvBlob } from '../lib/csv.js';
import { printTaxDoc } from '../ui/tax-doc.js';
import { downloadBlob } from '../ui/download.js';
import { overShortLabel } from '../lib/drawer.js';
import { closedDaysInRange, openZReport } from '../ui/drawer-sheet.js';
import { openCsvExport } from '../ui/csv-export.js';
import { requirePin } from '../ui/pin-gate.js';
import { formatMoney } from '../lib/money.js';
import { todayISO, daysAgoISO, monthKey, monthKeyOf, datesInRange, formatDay, formatDayShort } from '../lib/dates.js';
import { round2, plural } from '../lib/util.js';

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'month', label: 'This month' },
  // The ranges a filing actually uses, beside the ones a counter does.
  { id: 'quarter', label: 'This quarter' },
  { id: 'year', label: 'This year' },
];

/** Past this many days the chart buckets by week, so columns stay readable. */
const WEEKLY_PAST_DAYS = 90;

const CHIP_DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const CHIP_DAY_YEAR = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** 'Jan 1 – Aug 5' (year shown when it isn't this year) - the custom chip's label. */
function customChipLabel({ from, to }) {
  const fmt = (iso) => (iso.slice(0, 4) === String(new Date().getFullYear()) ? CHIP_DAY : CHIP_DAY_YEAR)
    .format(new Date(`${iso}T12:00:00`));
  return from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
}

function rangeBounds(id) {
  const to = todayISO();
  if (id === 'today') return { from: to, to };
  if (id === '7d') return { from: daysAgoISO(6), to };
  if (id === '30d') return { from: daysAgoISO(29), to };
  if (id === 'quarter') {
    const now = new Date();
    return { from: todayISO(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)), to };
  }
  if (id === 'year') return { from: `${new Date().getFullYear()}-01-01`, to };
  return { from: `${monthKey()}-01`, to };
}

/** The equal-length period immediately before [from, to] (for deltas). */
function previousBounds({ from, to }) {
  const ms = 24 * 60 * 60 * 1000;
  const days = Math.round((new Date(`${to}T12:00`) - new Date(`${from}T12:00`)) / ms) + 1;
  const prevTo = new Date(`${from}T12:00`); prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - days + 1);
  return { from: todayISO(prevFrom), to: todayISO(prevTo) };
}

/**
 * Voided sales are excluded; refunds are not. A refund's amounts are stored
 * negative, so revenue, tax, and discounts net out by simply adding up, while
 * counts stay separate - a refund is not a sale.
 */
function summarize(sales) {
  const live = sales.filter((s) => !s.voidedAt);
  const sold = live.filter((s) => !isRefund(s));
  const refunds = live.filter((s) => isRefund(s));
  const gross = round2(sold.reduce((a, s) => a + s.total, 0));
  const refunded = round2(-refunds.reduce((a, s) => a + s.total, 0));
  return {
    live,
    revenue: round2(gross - refunded),
    gross,
    refunded,
    count: sold.length,
    refundCount: refunds.length,
    avg: sold.length ? round2(gross / sold.length) : 0,
    tax: round2(live.reduce((a, s) => a + s.taxTotal, 0)),
    discounts: round2(live.reduce((a, s) => a + s.discountTotal, 0)),
    // Gratuities ride on payments, outside revenue; summed apart.
    tips: round2(live.reduce((a, s) => a + receiptTip(s), 0)),
    // Loyalty rewards given: a discount given is money forgone, and a shop
    // running a card should see what the card costs it.
    rewards: round2(live.reduce((a, s) => a + (Number(s.reward?.value) || 0), 0)),
    rewardCount: live.filter((s) => s.reward).length,
    // Cost and margin, on whatever share of the trade records a cost.
    profit: profitSummary(live),
  };
}

/** 'cost known for 82% of sales' - never a margin quoted as if it were whole. */
function coverageNote(p) {
  if (p.coverage >= 0.995) return null;
  return `cost known for ${Math.max(1, Math.round(p.coverage * 100))}% of sales`;
}

export function reportsView() {
  let range = '7d';
  /** The applied from/to of the Custom chip, once one has been picked. */
  let custom = null;
  let showTable = false;
  /** 'revenue' | 'profit' - what Top products ranks by. */
  let topSort = 'revenue';
  const money = (n) => formatMoney(n, store.settings.currency);

  /** The bounds of whatever chip is active, custom included. */
  const bounds = () => (range === 'custom' && custom ? { ...custom } : rangeBounds(range));

  const chipRow = el('div.chip-row', { role: 'group', 'aria-label': 'Date range' });
  const content = el('div');

  /**
   * A render is two awaits long, and a tap on another range - or a store
   * change mid-flight - starts a second one. Only the newest may touch the
   * page, or a slow request could repaint the range the cashier just left, or
   * append its day-closes card under someone else's numbers.
   */
  let generation = 0;
  /** The live chart's resize observer, dropped with the chart it belongs to. */
  let chartObserver = null;

  const dropChart = () => {
    chartObserver?.disconnect();
    chartObserver = null;
  };

  function renderChips() {
    clear(chipRow);
    for (const r of RANGES) {
      chipRow.append(el('button.chip', {
        type: 'button',
        className: `chip${range === r.id ? ' active' : ''}`,
        'aria-pressed': range === r.id ? 'true' : 'false',
        onclick: () => {
          range = r.id;
          renderChips();
          // The chip that was tapped no longer exists; keep focus on its
          // replacement instead of dropping it to <body>.
          chipRow.querySelector('.chip.active')?.focus();
          render();
        },
      }, r.label));
    }
    // The active custom chip is labelled with the dates it shows, and tapping
    // it again reopens the picker - adjusting a range you're looking at is the
    // normal move, not a special case.
    const active = range === 'custom';
    chipRow.append(el('button.chip', {
      type: 'button',
      className: `chip${active ? ' active' : ''}`,
      'aria-pressed': active ? 'true' : 'false',
      onclick: openRangePicker,
    }, active && custom ? customChipLabel(custom) : 'Custom…'));
  }

  /**
   * From/to pickers for the Custom chip - the same pattern as the CSV export
   * sheet, with the bookkeeping ranges the fixed chips don't cover. Nothing
   * changes until Apply, so backing out keeps the range on screen.
   */
  function openRangePicker() {
    const current = bounds();
    const fromInput = el('input.input', { type: 'date', value: current.from, max: '2999-12-31', 'aria-label': 'From date' });
    const toInput = el('input.input', { type: 'date', value: current.to, max: '2999-12-31', 'aria-label': 'To date' });
    const warn = el('div.export-summary', { 'aria-live': 'polite' });
    const applyBtn = el('button.btn.btn-primary.btn-block', { type: 'submit' }, 'Show this range');

    const check = () => {
      const from = fromInput.value;
      const to = toInput.value;
      const bad = !from || !to || from > to;
      clear(warn);
      if (bad) {
        warn.append(el('span.export-warn', {}, !from || !to
          ? 'Pick a start and an end date.'
          : 'The start date is after the end date.'));
      }
      applyBtn.disabled = bad;
      return bad ? null : { from, to };
    };
    fromInput.addEventListener('change', check);
    toInput.addEventListener('change', check);

    const today = new Date();
    const quarterStart = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
    const quick = [
      ['Last month', () => {
        const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const end = new Date(today.getFullYear(), today.getMonth(), 0);
        return [todayISO(start), todayISO(end)];
      }],
      ['This quarter', () => [todayISO(quarterStart), todayISO()]],
      // The range a quarterly return is actually filed for: the last one
      // that finished, start to end, not the one still running.
      ['Previous quarter', () => {
        const start = new Date(quarterStart);
        start.setMonth(start.getMonth() - 3);
        const end = new Date(quarterStart);
        end.setDate(0);
        return [todayISO(start), todayISO(end)];
      }],
      ['This year', () => [`${today.getFullYear()}-01-01`, todayISO()]],
      ['Last year', () => [`${today.getFullYear() - 1}-01-01`, `${today.getFullYear() - 1}-12-31`]],
    ];

    const form = el('form', {
      onsubmit: (e) => {
        e.preventDefault();
        const picked = check();
        if (!picked) return;
        custom = picked;
        range = 'custom';
        modal.close();
        renderChips();
        // The dialog's opener chip was rebuilt, so the modal's own focus
        // return has nowhere to land - claim it for the new chip.
        chipRow.querySelector('.chip.active')?.focus();
        render();
      },
    },
      el('div.form-grid', {},
        el('div.field', {}, el('label.label', {}, 'From'), fromInput),
        el('div.field', {}, el('label.label', {}, 'To'), toInput)
      ),
      el('div.chip-row', {}, quick.map(([label, get]) => el('button.chip', {
        type: 'button',
        onclick: () => {
          const [f, t] = get();
          fromInput.value = f;
          toInput.value = t;
          check();
        },
      }, label))),
      warn,
      applyBtn
    );
    const modal = openModal({ title: 'Custom date range', content: form });
    check();
  }

  async function render() {
    const mine = ++generation;
    const current = () => mine === generation;
    dropChart();
    clear(content);
    content.append(el('div.loading', {}, 'Loading…'));
    const period = bounds();
    let sales, prevSales;
    try {
      [sales, prevSales] = await Promise.all([
        store.salesInRange(period.from, period.to),
        store.salesInRange(...Object.values(previousBounds(period))),
      ]);
    } catch (err) {
      console.error(err);
      if (!current()) return;
      clear(content);
      content.append(el('div.empty', {}, el('p', {}, 'Couldn’t load report data. Check your connection.')));
      return;
    }
    if (!current()) return;
    const cur = summarize(sales);
    const prev = summarize(prevSales);
    const outstanding = store.outstandingCredit();
    const holders = store.creditHolders().filter((row) => row.balance > 0).length;
    clear(content);

    /* ---- KPI row ---- */
    content.append(el('div.stat-grid', {},
      statTile('Revenue', money(cur.revenue), delta(cur.revenue, prev.revenue)),
      statTile('Sales', String(cur.count), delta(cur.count, prev.count)),
      statTile('Average sale', money(cur.avg)),
      // Only shown when there were any: a clean row for shops with no returns.
      cur.refundCount > 0 && statTile('Refunds', `−${money(cur.refunded)}`, null,
        `${plural(cur.refundCount, 'refund')} · revenue is net`),
      statTile('Tax collected', money(cur.tax)),
      statTile('Discounts given', money(cur.discounts)),
      // Only for shops that record costs. Profit is measured on revenue net
      // of tax - tax was never the shop's money - and only over the lines
      // whose cost is known, which the note says out loud.
      cur.profit.any && statTile('Gross profit', money(cur.profit.profit),
        delta(cur.profit.profit, prev.profit.profit), coverageNote(cur.profit)),
      cur.profit.any && cur.profit.margin !== null
        && statTile('Margin', `${cur.profit.margin}%`, null, 'of sales net of tax'),
      // Only for shops that record any: tips are not revenue, and the tile
      // says so rather than let the two figures look addable.
      cur.tips > 0 && statTile('Tips', money(cur.tips), null, 'not counted in revenue'),
      // Only for shops running a card. It is part of Discounts given above;
      // the tile says what share of it the card accounted for.
      cur.rewards > 0 && statTile('Loyalty rewards', money(cur.rewards),
        delta(cur.rewards, prev.rewards),
        `${plural(cur.rewardCount, 'reward')} given · inside discounts`),
      // Not a figure about this period at all: it is what the shop owes right
      // now, and it says so. Credit is a liability moving, never revenue -
      // issuing it is a refund and spending it is a tender, and both are
      // already counted above.
      outstanding > 0 && statTile('Store credit out', money(outstanding), null,
        `owed to ${plural(holders, 'customer')} now`)
    ));

    if (!cur.count && !cur.refundCount) {
      content.append(el('div.empty', {},
        el('div.empty-icon', { html: icon('chart', 28) }),
        el('h3', {}, 'No sales in this period'),
        el('p', {}, 'Ring up a sale on the register and it lands here instantly.')
      ));
      return;
    }

    /* ---- Revenue chart (single series → one validated hue) ---- */
    const { unit, buckets } = bucketize(cur.live, period);
    const card = el('section.card.chart-card', { 'aria-label': 'Revenue over time' });
    const head = el('div.card-head', {},
      el('h2.card-title', {}, { hour: 'Revenue by hour', day: 'Revenue by day', week: 'Revenue by week' }[unit]),
      el('button.icon-btn', {
        html: icon(showTable ? 'chart' : 'table', 18, 1.8),
        'aria-label': showTable ? 'Show chart' : 'Show as table',
        title: showTable ? 'Show chart' : 'Show as table',
        onclick: async () => {
          showTable = !showTable;
          // The rebuild replaces this very button; without a hand-back a
          // keyboard user's focus falls to <body> and Tab starts over.
          await render();
          content.querySelector('.chart-card .icon-btn')?.focus();
        },
      })
    );
    card.append(head, showTable ? bucketTable(buckets, money) : columnChart(buckets, money));
    content.append(card);

    /* ---- Breakdowns ---- */
    content.append(el('div.report-cols', {},
      topProductsCard(cur.live, money),
      el('div.report-stack', {},
        categoriesCard(cur.live, money),
        paymentsCard(cur.live, money)
      )
    ));

    /* ---- Tax summary: the shape a return is filed in ---- */
    const taxes = taxSummary(cur.live);
    if (taxes.any) content.append(taxCard(taxes, period));

    /* ---- Day closes: over/short patterns over time ---- */
    const closes = await closedDaysInRange(period.from, period.to).catch((err) => {
      console.error(err);
      return [];
    });
    if (closes.length && current()) content.append(closesCard(closes, money));
  }

  /**
   * Tax collected by rate, with the tax-free and zero-rated trade a return
   * asks about on their own rows, and a total that reconciles with the Tax
   * collected tile above. Printable and exportable, because the point of the
   * card is to be handed to somebody.
   */
  function taxCard(summary, period) {
    const inclusive = summary.inclusive;
    const table = el('div.table-scroll', {},
      el('table.data-table', {},
        el('caption.sr-only', {}, 'Tax collected by rate'),
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col' }, 'Rate'),
          el('th.num', { scope: 'col' }, 'Taxable'),
          el('th.num', { scope: 'col' }, 'Tax'),
          // A tax-inclusive shop reads its return off the gross it took, so
          // that column leads for them and is a check for everyone else.
          el('th.num', { scope: 'col' }, inclusive ? 'Gross taken' : 'Gross'))),
        el('tbody', {}, summary.rows.map((r) => el('tr', {},
          el('td', {}, taxRowLabel(r)),
          el('td.num', {}, money(r.base)),
          el('td.num', {}, money(r.tax)),
          el('td.num', {}, money(r.gross))))),
        el('tfoot', {}, el('tr', {},
          el('th', { scope: 'row' }, 'Total'),
          el('td.num', {}, money(summary.base)),
          el('td.num', {}, money(summary.tax)),
          el('td.num', {}, money(summary.gross))))
      )
    );

    return el('section.card', { 'aria-label': 'Tax summary' },
      el('div.card-head', {},
        el('h2.card-title', {}, 'Tax summary'),
        el('div.row', { style: { flex: 'none' } },
          el('button.icon-btn', {
            html: icon('printer', 17, 1.9),
            'aria-label': 'Print the tax summary',
            title: 'Print the tax summary',
            onclick: () => printTaxDoc(summary, period, store),
          }),
          el('button.icon-btn', {
            html: icon('fileSheet', 17, 1.9),
            'aria-label': 'Export the tax summary as CSV',
            title: 'Export the tax summary as CSV',
            onclick: async () => {
              if (!(await requirePin('export data'))) return;
              const text = taxSummaryCsv(summary, {
                from: period.from,
                to: period.to,
                currency: store.settings.currency,
                storeName: store.settings.storeName,
              });
              downloadBlob(csvBlob(text), `tax-summary-${period.from}_${period.to}.csv`);
              toast('Tax summary CSV downloaded', { icon: 'fileSheet' });
            },
          }))),
      table,
      el('p.small.muted', { style: { marginTop: '10px' } },
        [
          inclusive
            ? 'Prices include tax, so Gross taken is what customers paid and Tax is the portion within it.'
            : 'Tax is added at the till, so Gross is Taxable plus Tax.',
          'Refunds are netted out at the rate their sale was rung up at, and voided sales are excluded.',
          summary.mixed ? 'Tax-inclusive pricing changed during this period; each sale is counted as it was rung up.' : null,
        ].filter(Boolean).join(' '))
    );
  }

  function closesCard(closes, money) {
    return el('section.card', { 'aria-label': 'Day closes' },
      el('div.card-head', {},
        el('h2.card-title', {}, 'Day closes'),
        el('span.card-sub', {}, 'Counted against expected')),
      el('div.card-list', { style: { margin: 0, border: 0 } }, closes.map((day) => {
        const diff = day.close.diff || 0;
        return el('button.card-row', {
          type: 'button',
          onclick: () => openZReport(day),
          'aria-label': `Z-report for ${formatDay(day.date)}, ${overShortLabel(diff, money)}`,
        },
          el('span.pay-ic', { html: icon('coins', 18, 1.8) }),
          el('span.card-main', {},
            el('span.card-title', {}, formatDay(day.date)),
            el('span.card-sub', {}, `Expected ${money(day.close.expected)} · counted ${money(day.close.counted)}`)
          ),
          el('span.card-amount', {
            className: `card-amount${diff === 0 ? '' : diff > 0 ? ' over' : ' short'}`,
          }, overShortLabel(diff, money))
        );
      }))
    );
  }

  function delta(now, before) {
    if (!before) return null;
    // Divide by the magnitude: a refund-heavy period can leave `before`
    // negative, and dividing by it flipped the arrow - revenue climbing out
    // of a net-negative week read as a drop.
    const pct = Math.round(((now - before) / Math.abs(before)) * 100);
    if (!Number.isFinite(pct) || pct === 0) return null;
    return { pct, up: pct > 0 };
  }

  /**
   * A tile may carry both a delta and a note: gross profit needs the trend
   * *and* the caveat about how much of the trade records a cost, and quietly
   * dropping the caveat under a trend arrow would overstate the figure.
   */
  function statTile(label, value, d = null, note = null) {
    return el('div.stat-tile', {},
      el('span.stat-label', {}, label),
      el('span.stat-value', {}, value),
      d && el('span.stat-delta', {
        className: `stat-delta ${d.up ? 'up' : 'down'}`,
      }, `${d.up ? '↑' : '↓'} ${Math.abs(d.pct)}% vs previous period`),
      note && el('span.stat-note', {}, note)
    );
  }

  /* ---- Bucketing: hourly for one day, daily up to ~3 months, then weekly ---- */
  function bucketize(live, period) {
    if (period.from === period.to) {
      const byHour = new Map();
      for (const s of live) byHour.set(new Date(s.at).getHours(), (byHour.get(new Date(s.at).getHours()) || 0) + s.total);
      const hours = [...byHour.keys()];
      const min = Math.min(8, ...hours);
      const max = Math.max(18, ...hours);
      const out = [];
      for (let h = min; h <= max; h++) {
        const label = new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });
        out.push({ label, long: label, value: round2(byHour.get(h) || 0) });
      }
      return { unit: 'hour', buckets: out };
    }
    const byDay = new Map();
    for (const s of live) byDay.set(s.date, (byDay.get(s.date) || 0) + s.total);
    const days = datesInRange(period.from, period.to);
    if (days.length > WEEKLY_PAST_DAYS) {
      const buckets = [];
      for (let i = 0; i < days.length; i += 7) {
        const week = days.slice(i, i + 7);
        const last = week[week.length - 1];
        buckets.push({
          label: formatDayShort(week[0]),
          long: week.length === 1 ? formatDay(week[0]) : `${formatDay(week[0])} – ${formatDay(last)}`,
          value: round2(week.reduce((a, d) => a + (byDay.get(d) || 0), 0)),
        });
      }
      return { unit: 'week', buckets };
    }
    // A custom range can cross months, where a bare day-of-month repeats.
    const oneMonth = monthKeyOf(period.from) === monthKeyOf(period.to);
    return {
      unit: 'day',
      buckets: days.map((d) => ({
        label: oneMonth ? d.slice(8).replace(/^0/, '') : formatDayShort(d),
        long: formatDay(d),
        value: round2(byDay.get(d) || 0),
      })),
    };
  }

  /* ---- Column chart: thin bars, rounded data-end, hover + focus tooltip ---- */
  function columnChart(buckets, money) {
    const wrap = el('div.chart-wrap');
    const tip = el('div.chart-tip', { role: 'status' });
    wrap.append(tip);

    const draw = () => {
      wrap.querySelector('svg')?.remove();
      // Only ever as wide as the card it sits in. A hard 280px minimum drew
      // the chart into a 239px card on a 320px phone: it bled over the card's
      // edge and gave the whole page a horizontal scrollbar. What is left is
      // below any real viewport, and only guards the arithmetic below from a
      // width narrower than its own axis gutter.
      const width = Math.max(140, wrap.clientWidth || 640);
      const height = 230;
      const pad = { top: 12, right: 8, bottom: 26, left: 44 };
      const innerW = width - pad.left - pad.right;
      const innerH = height - pad.top - pad.bottom;
      const max = Math.max(...buckets.map((b) => b.value), 1);
      const { top: nice, parts } = niceAxis(max);
      const y = (v) => pad.top + innerH - (v / nice) * innerH;
      const step = innerW / buckets.length;
      const barW = Math.min(24, Math.max(3, step * 0.58));

      // A group, not an image: every column below carries its own label and
      // sits in the tab order, and the contents of a role="img" are
      // presentational by definition - a screen reader dropped all of them
      // and a keyboard user tabbed through a column per day hearing nothing.
      const svg = svgEl('svg', {
        width, height, viewBox: `0 0 ${width} ${height}`,
        role: 'group', 'aria-label': 'Revenue chart, one column per period. The table view lists the same figures.',
      });

      // Gridlines + ticks (recessive hairlines; baseline slightly stronger).
      for (let i = 0; i <= parts; i++) {
        const v = (nice / parts) * i;
        const yy = y(v);
        svg.append(svgEl('line', {
          x1: pad.left, x2: width - pad.right, y1: yy, y2: yy,
          stroke: i === 0 ? 'var(--baseline)' : 'var(--grid)', 'stroke-width': 1,
        }));
        svg.append(svgEl('text', {
          x: pad.left - 8, y: yy + 4, 'text-anchor': 'end',
          class: 'chart-tick',
        }, compact(v)));
      }

      // X labels, thinned so they never collide - dated labels ('Aug 14')
      // need more room than bare days or hours.
      const labelStep = Math.max(42, 8 + 7 * Math.max(...buckets.map((b) => b.label.length)));
      const every = Math.ceil(buckets.length / Math.max(1, Math.floor(innerW / labelStep)));
      buckets.forEach((b, i) => {
        if (i % every !== 0) return;
        svg.append(svgEl('text', {
          x: pad.left + step * i + step / 2, y: height - 8,
          'text-anchor': 'middle', class: 'chart-tick',
        }, b.label));
      });

      // Bars: square at the baseline, 4px rounded data-end.
      buckets.forEach((b, i) => {
        const cx = pad.left + step * i + step / 2;
        const barH = Math.max(0, pad.top + innerH - y(b.value));
        if (b.value > 0) {
          const r = Math.min(4, barH, barW / 2);
          const x0 = cx - barW / 2;
          const yTop = y(b.value);
          svg.append(svgEl('path', {
            d: `M ${x0} ${pad.top + innerH} V ${yTop + r} Q ${x0} ${yTop} ${x0 + r} ${yTop} H ${x0 + barW - r} Q ${x0 + barW} ${yTop} ${x0 + barW} ${yTop + r} V ${pad.top + innerH} Z`,
            fill: 'var(--chart-series)', class: 'chart-bar', 'data-i': i,
          }));
        }
        // Full-height transparent hit target, keyboard-focusable.
        const hit = svgEl('rect', {
          x: pad.left + step * i, y: pad.top, width: step, height: innerH,
          fill: 'transparent', tabindex: 0, role: 'img',
          'aria-label': `${b.long}: ${money(b.value)}`,
        });
        const show = () => {
          for (const bar of svg.querySelectorAll('.chart-bar.hover')) bar.classList.remove('hover');
          svg.querySelector(`.chart-bar[data-i="${i}"]`)?.classList.add('hover');
          tip.replaceChildren(
            el('span.tip-value', {}, money(b.value)),
            el('span.tip-label', {}, b.long)
          );
          tip.classList.add('show');
          const left = Math.min(Math.max(cx - pad.left, 40), innerW - 40);
          tip.style.left = `${pad.left + left}px`;
          tip.style.top = `${Math.max(y(b.value) - 14, 8)}px`;
        };
        const hide = () => {
          tip.classList.remove('show');
          svg.querySelector(`.chart-bar[data-i="${i}"]`)?.classList.remove('hover');
        };
        hit.addEventListener('pointerenter', show);
        hit.addEventListener('pointerleave', hide);
        hit.addEventListener('focus', show);
        hit.addEventListener('blur', hide);
        svg.append(hit);
      });

      wrap.append(svg);
    };

    // One observer at a time: every render replaces the chart, and an observer
    // left watching a discarded one would keep it - and its SVG - alive.
    dropChart();
    chartObserver = new ResizeObserver(() => draw());
    chartObserver.observe(wrap);
    queueMicrotask(draw);
    return wrap;
  }

  function bucketTable(buckets, money) {
    return el('div.table-scroll', {},
      el('table.data-table', {},
        el('caption.sr-only', {}, 'Revenue by period'),
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col' }, 'Period'),
          el('th.num', { scope: 'col' }, 'Revenue'))),
        el('tbody', {}, buckets.map((b) => el('tr', {},
          el('td', {}, b.long),
          el('td.num', {}, money(b.value)))))
      )
    );
  }

  /* ---- Breakdown cards ---- */

  function topProductsCard(live, money) {
    // Refund lines carry negative quantity and money, so a returned item
    // subtracts itself here without any special case.
    const agg = new Map();
    for (const s of live) {
      for (const l of s.lines) {
        const key = l.productId || `custom:${l.name}`;
        const row = agg.get(key)
          || { name: l.name, qty: 0, revenue: 0, unit: l.unit || '', profitCents: 0, costed: true };
        row.qty += l.qty;
        row.revenue = round2(row.revenue + l.total);
        // A product with one uncosted line has no honest profit figure at
        // all - it is marked unknown rather than shown short by that line.
        const cost = lineCostCents(l);
        if (cost === null) row.costed = false;
        else row.profitCents += lineNetCents(l) - cost;
        agg.set(key, row);
      }
    }
    const rows = [...agg.values()].map((r) => ({
      ...r, profit: r.costed ? round2(r.profitCents / 100) : null,
    }));
    // The whole point of the toggle: "what earns most" is a different list
    // from "what sells most", and it is usually the more useful one.
    const anyProfit = rows.some((r) => r.profit !== null);
    const byProfit = topSort === 'profit' && anyProfit;
    const value = (r) => (byProfit ? (r.profit ?? 0) : r.revenue);
    const top = [...rows].sort((a, b) => value(b) - value(a)).slice(0, 6);
    const max = Math.max(...top.map((p) => Math.abs(value(p))), 1);
    // Measured products sell by amount, not count: '12.4 kg sold'.
    const soldLabel = (p) => `${Math.round(p.qty * 1000) / 1000}${p.unit ? ` ${p.unit}` : ''} sold`;
    /** The figure the bar isn't showing, so both are always on the row. */
    const otherLabel = (p) => {
      if (!byProfit) return p.profit === null ? null : `${money(p.profit)} profit`;
      return `${money(p.revenue)} revenue`;
    };

    const sortChip = (id, label) => el('button.chip.chip-sm', {
      type: 'button',
      className: `chip chip-sm${topSort === id ? ' active' : ''}`,
      'aria-pressed': topSort === id ? 'true' : 'false',
      onclick: async () => {
        if (topSort === id) return;
        topSort = id;
        await render();
        content.querySelector('.rank-sort .chip.active')?.focus();
      },
    }, label);

    return el('section.card', { 'aria-label': 'Top products' },
      el('div.card-head', {},
        el('h2.card-title', {}, 'Top products'),
        anyProfit
          ? el('div.chip-row.rank-sort', { role: 'group', 'aria-label': 'Rank top products by' },
            sortChip('revenue', 'Revenue'), sortChip('profit', 'Profit'))
          : null),
      el('div.rank-list', {}, top.map((p) => el('div.rank-row', {},
        el('div.rank-meta', {},
          el('span.rank-name', {}, p.name),
          el('span.rank-sub', {}, [soldLabel(p), otherLabel(p)].filter(Boolean).join(' · '))),
        el('div.rank-bar-track', {},
          el('div.rank-bar', {
            className: `rank-bar${value(p) < 0 ? ' negative' : ''}`,
            style: { width: `${Math.max(2, Math.min(100, (Math.abs(value(p)) / max) * 100))}%` },
          })),
        el('span.rank-value', {}, byProfit && p.profit === null ? '—' : money(value(p)))
      )))
    );
  }

  /**
   * The bucket a sold line belongs to. Receipts snapshot the product's name
   * and price but not its category, so a line whose product has since been
   * deleted has no category to name - and it is emphatically not a custom
   * item: discontinuing a product used to move its whole sales history into
   * "Custom items", where it sat mixed in with genuine one-offs. The CSV
   * export has always kept the two apart; this now agrees with it.
   */
  const bucketOf = (line) => {
    if (!line.productId) return 'Custom items';
    const product = store.product(line.productId);
    if (!product) return 'Removed products';
    return store.category(product.categoryId)?.name || 'Uncategorized';
  };

  function categoriesCard(live, money) {
    const agg = new Map();
    for (const s of live) {
      for (const l of s.lines) {
        const cat = bucketOf(l);
        agg.set(cat, round2((agg.get(cat) || 0) + l.total));
      }
    }
    const rows = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    return el('section.card', { 'aria-label': 'Sales by category' },
      el('div.card-head', {}, el('h2.card-title', {}, 'By category')),
      el('div.kv-list', {}, rows.map(([name, v]) => el('div.kv-row', {},
        el('span', {}, name), el('span.kv-value', {}, money(v))
      )))
    );
  }

  function paymentsCard(live, money) {
    // Amounts per method, not sales per method: a split sale puts $20 against
    // Cash and $14.50 against Card, and the card still reconciles with revenue.
    const agg = new Map();
    const tips = new Map();
    for (const s of live) {
      for (const t of receiptPayments(s)) {
        const row = agg.get(t.method) || { count: 0, total: 0 };
        row.count++;
        row.total = round2(row.total + (Number(t.amount) || 0));
        agg.set(t.method, row);
        const tip = Math.max(0, Number(t.tip) || 0);
        if (tip > 0) tips.set(t.method, round2((tips.get(t.method) || 0) + tip));
      }
    }
    const splits = live.filter((s) => receiptPayments(s).length > 1).length;
    return el('section.card', { 'aria-label': 'Payment methods' },
      el('div.card-head', {}, el('h2.card-title', {}, 'Payments')),
      el('div.kv-list', {}, PAYMENT_METHODS.filter((m) => agg.has(m.value)).map((m) => {
        const row = agg.get(m.value);
        return el('div.kv-row', {},
          el('span.kv-ic', { html: icon(m.icon, 16, 1.8) }, ` ${m.label}`),
          el('span.kv-sub', {}, `${row.count}×`),
          el('span.kv-value', {}, money(row.total))
        );
      }),
      // Tips per method, apart from takings, so a card batch that includes
      // gratuities still checks out against this card.
      [...tips.entries()].map(([method, amount]) => el('div.kv-row', {},
        el('span', {}, `Tips · ${paymentMethodInfo(method).label.toLowerCase()}`),
        el('span.kv-value', {}, money(amount))
      ))),
      splits > 0 && el('p.small.muted', { style: { marginTop: '10px' } },
        `Includes ${plural(splits, 'sale')} settled across more than one tender.`)
    );
  }

  const node = el('div.view', {},
    el('header.view-head', {},
      el('div', {},
        el('h1.view-title', {}, 'Reports'),
        el('p.view-sub', {}, 'Net of refunds · voided sales excluded')
      ),
      el('button.btn.btn-ghost', {
        html: icon('fileSheet', 16, 2),
        title: 'Export this range as CSV',
        // Opens on the range currently on screen; the dialog can widen it.
        onclick: async () => { if (await requirePin('export data')) openCsvExport(bounds()); },
      }, ' Export CSV')
    ),
    chipRow,
    content
  );

  const onChange = () => render();
  store.addEventListener('change', onChange);
  renderChips();
  render();

  return {
    node,
    destroy: () => {
      store.removeEventListener('change', onChange);
      // Leaving the view cancels whatever render is still in flight.
      generation++;
      dropChart();
    },
  };
}

/**
 * The axis top - the smallest "nice" ceiling (1/2/2.5/5 × 10^n) at or above
 * v - and how many equal parts to divide it into.
 *
 * Four is the usual number of parts, and for the 1, 2 and 10 rungs it lands
 * on round money. Quartering 2.5 and 5 does not: the gridlines fall on
 * 0.625/1.25/1.875 and 1.25/2.5/3.75 of the decade, which on a money axis
 * reads as "62.5" and "187.5" - and on a quiet day's small figures the
 * labels round to a cent that is no longer where the line was drawn (0.625
 * printed as "0.63"). Those two rungs divide exactly into five: 250 becomes
 * 50/100/150/200/250, and 50 becomes 10/20/30/40/50.
 */
function niceAxis(v) {
  const base = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (v <= m * base) return { top: m * base, parts: m === 2.5 || m === 5 ? 5 : 4 };
  }
  return { top: 10 * base, parts: 4 };
}

/** Compact axis figure: 1200 → 1.2K. */
function compact(v) {
  if (v >= 1000) return `${Math.round(v / 100) / 10}K`;
  return String(Math.round(v * 100) / 100);
}

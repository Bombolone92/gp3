/**
 * The cash drawer sheet: start the day with a float, record cash in and out,
 * and close the day against a physical count.
 *
 * Nothing here gates selling. A day that never gets opened simply has no
 * record, and a day that never gets closed can still be closed the next
 * morning - the flow is offered, not enforced.
 */

import { el, clear, append } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { formatMoney, parseAmount } from '../lib/money.js';
import { formatDay, formatTime, todayISO, monthKeyOf, monthKeysInRange } from '../lib/dates.js';
import { overShortLabel } from '../lib/drawer.js';
import { zReportNode, printZReport } from './zreport.js';
import { requirePin } from './pin-gate.js';
import { hasPrinter, kickDrawer, printerSaid } from '../lib/printer.js';
import { plural } from '../lib/util.js';

/** How far back to look for a day left open. */
const OPEN_DAY_LOOKBACK = 14;

/** Days that were started but never closed, oldest first, excluding `date`. */
export async function unclosedDaysBefore(date) {
  const from = new Date(`${date}T12:00`);
  from.setDate(from.getDate() - OPEN_DAY_LOOKBACK);
  const days = await store.drawerDaysInRange(todayISO(from), date).catch(() => []);
  return days.filter((d) => d.date < date && !d.close).reverse();
}

export function openDrawerSheet({ date = todayISO() } = {}) {
  const money = (n) => formatMoney(n, store.settings.currency);
  const body = el('div');
  const modal = openModal({ title: 'Cash drawer', content: body });

  async function render() {
    clear(body);
    body.append(el('div.loading', {}, 'Loading…'));

    let summary;
    let stale = [];
    try {
      [summary, stale] = await Promise.all([
        store.drawerSummary(date),
        unclosedDaysBefore(date),
      ]);
    } catch (err) {
      console.error(err);
      clear(body);
      body.append(el('div.empty', {}, el('p', {}, 'Couldn’t read the drawer. Check your connection.')));
      return;
    }

    clear(body);
    const isToday = date === todayISO();
    const heading = isToday ? 'Today' : formatDay(date);

    /* ---- A day left open earlier: offer to close it from here ---- */
    const staleRows = stale.map((day) => el('button.callout.callout-warn.callout-btn', {
      type: 'button',
      onclick: () => { modal.close(); openDrawerSheet({ date: day.date }); },
    },
      el('span.callout-ic', { html: icon('alert', 16, 2) }),
      el('span', {},
        el('strong', {}, `${formatDay(day.date)} was never closed`),
        '. Count it now so its takings reconcile.')
    ));

    /* ---- Not started ---- */
    if (!summary.opened) {
      const floatInput = el('input.input.pay-tender', {
        type: 'text', inputmode: 'decimal', placeholder: money(0),
        'aria-label': 'Opening float',
      });
      append(body, [
        ...staleRows,
        el('p.small.muted', { style: { margin: '4px 0 14px' } },
          `${heading} hasn’t been started. Enter the cash you put in the drawer and the day’s expected total is tracked from there.`),
        el('form', {
          onsubmit: async (e) => {
            e.preventDefault();
            // An empty field is a real answer - plenty of days start with an
            // empty till. A figure that can't be read is not: booking it as
            // zero left the drawer expecting the whole float less than it
            // held, so the night's count came out over by exactly the money
            // that was put in, with nothing on screen saying why.
            const typed = floatInput.value.trim();
            const float = typed ? parseAmount(typed) : 0;
            if (float === null) {
              floatInput.focus();
              toast('Enter the opening float as a plain number, or leave it empty', { icon: 'alert' });
              return;
            }
            const btn = e.target.querySelector('button[type=submit]');
            btn.disabled = true;
            try {
              await store.openDrawer({ date, float });
            } catch (err) {
              console.error(err);
              btn.disabled = false;
              toast(err.message === 'That day is already started.' ? err.message
                : 'Couldn’t start the day. Check your connection', { icon: 'wifiOff' });
              return;
            }
            toast('Day started', { icon: 'coins' });
            render();
          },
        },
          el('div.field', {}, el('label.label', {}, 'Opening float'), floatInput),
          el('button.btn.btn-primary.btn-block', { type: 'submit' }, 'Start the day')
        ),
      ]);
      floatInput.focus();
      return;
    }

    /* ---- Closed: show the Z-report ---- */
    if (summary.closed) {
      const day = { date, openedAt: summary.openedAt, movements: summary.movements, close: summary.close };
      append(body, [
        el('div.callout.callout-accent', {},
          el('span.callout-ic', { html: icon('circleCheck', 16, 2) }),
          el('span', {},
            el('strong', {}, `${heading} is closed`), ': ',
            `${overShortLabel(summary.close.diff, money).toLowerCase()} on ${money(summary.close.expected)} expected.`)),
        el('div.zreport-wrap', {}, zReportNode(day, store)),
        el('button.btn.btn-ghost.btn-block', {
          type: 'button', html: icon('printer', 16, 2), style: { marginTop: '14px' },
          onclick: () => printZReport(day, store),
        }, ' Print Z-report'),
      ]);
      return;
    }

    /* ---- Open: the running drawer ---- */
    const line = (label, value, strong = false) => el(`div.trow${strong ? '.trow-total' : ''}`, {},
      el('dt', {}, label), el('dd', {}, value));

    const movements = summary.movements.length
      ? el('div.movement-list', {}, summary.movements.map((m) => el('div.movement-row', {},
        el('span.movement-time', {}, formatTime(m.at)),
        el('span.grow', {}, m.reason || (m.amount > 0 ? 'Paid in' : 'Paid out')),
        el('span.movement-amount', {
          className: `movement-amount${m.amount < 0 ? ' out' : ''}`,
          // A drawer opened for no sale moved no money: a signed zero would
          // read as though it had.
        }, m.amount === 0 ? '—' : `${m.amount > 0 ? '+' : '−'}${money(Math.abs(m.amount))}`)
      )))
      : null;

    append(body, [
      ...staleRows,
      el('dl.totals.drawer-totals', {},
        line('Opening float', money(summary.float)),
        line('Cash sales', money(summary.cashSales)),
        summary.cashTips > 0 && line('Cash tips', money(summary.cashTips)),
        summary.cashRefunds > 0 && line('Cash refunds', `−${money(summary.cashRefunds)}`),
        summary.paidIn > 0 && line('Paid in', money(summary.paidIn)),
        summary.paidOut > 0 && line('Paid out', `−${money(summary.paidOut)}`),
        line('Expected in drawer', money(summary.expected), true)
      ),
      movements,
      el('div.row.wrap', { style: { marginBottom: '14px' } },
        el('button.btn.btn-ghost.grow', {
          type: 'button', html: icon('plus', 15, 2.2),
          onclick: async () => { if (await requirePin('record cash in')) openMovement(+1); },
        }, ' Cash in'),
        el('button.btn.btn-ghost.grow', {
          type: 'button', html: icon('minus', 15, 2.2),
          onclick: async () => { if (await requirePin('record cash out')) openMovement(-1); },
        }, ' Cash out'),
        // Only where the drawer can actually be opened from here. Without a
        // printer wired to it there is nothing to pulse, and a button that
        // did nothing would be worse than none.
        hasPrinter() && el('button.btn.btn-ghost.grow', {
          type: 'button', html: icon('coins', 15, 2.2),
          title: 'Open the drawer without a sale',
          onclick: async () => { if (await requirePin('open the drawer')) openNoSale(); },
        }, ' No sale')
      ),
      el('p.small.muted', { style: { marginBottom: '10px' } },
        `${plural(summary.salesCount, 'sale')} today${summary.refundCount ? ` · ${plural(summary.refundCount, 'refund')}` : ''}.`),
      el('button.btn.btn-primary.btn-block.charge-btn', {
        type: 'button',
        onclick: async () => { if (await requirePin('close the day')) openClose(); },
      }, 'Close the day'),
    ]);
  }

  /**
   * "No sale": open the drawer to make change, and say so in the history.
   * The record is written first - if the pulse fails the shopkeeper knows why
   * nothing happened, and if the record fails the drawer stays shut rather
   * than opening unaccounted for.
   */
  function openNoSale() {
    const reasonInput = el('input.input', {
      type: 'text', maxLength: 60, placeholder: 'e.g. change for a twenty',
      'aria-label': 'Why the drawer was opened',
    });
    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          await store.recordNoSale({ date, reason: reasonInput.value });
        } catch (err) {
          console.error(err);
          btn.disabled = false;
          toast(/closed|Start the day/.test(err.message || '')
            ? err.message
            : 'Couldn’t record it. Check your connection', { icon: 'wifiOff' });
          return;
        }
        try {
          await kickDrawer();
        } catch (err) {
          console.error(err);
          // Recorded either way: the note explains an opening that may have
          // been done by hand, which is better than no note at all.
          sub.close();
          toast(`${printerSaid(err)} — the opening is recorded`,
            { icon: 'alert', duration: 6000 });
          render();
          return;
        }
        sub.close();
        toast('Drawer opened · recorded as no sale', { icon: 'coins' });
        render();
      },
    },
      el('p.small.muted', { style: { marginBottom: '14px' } },
        'Opens the drawer through the receipt printer without recording a sale. '
        + 'The opening goes in the day’s movements, so the count still explains itself.'),
      el('div.field', {}, el('label.label', {}, 'Reason'), reasonInput),
      el('button.btn.btn-primary.btn-block', { type: 'submit' }, 'Open the drawer')
    );
    const sub = openModal({ title: 'No sale', content: form });
    reasonInput.focus();
  }

  /** Paid in (dir +1) or paid out (dir −1). */
  function openMovement(dir) {
    const amountInput = el('input.input.pay-tender', {
      type: 'text', inputmode: 'decimal', placeholder: money(0),
      'aria-label': dir > 0 ? 'Amount paid in' : 'Amount paid out',
    });
    const reasonInput = el('input.input', {
      type: 'text', maxLength: 60,
      placeholder: dir > 0 ? 'e.g. float top-up' : 'e.g. paid the courier',
      'aria-label': 'Reason',
    });
    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const amount = parseAmount(amountInput.value);
        if (!amount) { amountInput.focus(); toast('Enter an amount', { icon: 'alert' }); return; }
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          await store.addCashMovement({ date, amount: dir * amount, reason: reasonInput.value });
        } catch (err) {
          console.error(err);
          btn.disabled = false;
          toast(/closed|Start the day|amount/.test(err.message || '')
            ? err.message
            : 'Couldn’t record it. Check your connection', { icon: 'wifiOff' });
          return;
        }
        sub.close();
        toast(dir > 0 ? 'Cash in recorded' : 'Cash out recorded', { icon: 'coins' });
        render();
      },
    },
      el('p.small.muted', { style: { marginBottom: '14px' } },
        dir > 0
          ? 'Money added to the drawer that isn’t a sale.'
          : 'Money taken out of the drawer that isn’t a refund. A mistake is corrected with an offsetting entry.'),
      el('div.field', {}, el('label.label', {}, 'Amount'), amountInput),
      el('div.field', {}, el('label.label', {}, 'Reason'), reasonInput),
      el('button.btn.btn-primary.btn-block', { type: 'submit' }, dir > 0 ? 'Record cash in' : 'Record cash out')
    );
    const sub = openModal({ title: dir > 0 ? 'Cash in' : 'Cash out', content: form });
    amountInput.focus();
  }

  /** The count. Expected is recomputed by the store when it records the close. */
  async function openClose() {
    let summary;
    try {
      summary = await store.drawerSummary(date);
    } catch (err) {
      console.error(err);
      toast('Couldn’t read the drawer. Check your connection', { icon: 'wifiOff' });
      return;
    }

    const countedInput = el('input.input.pay-tender', {
      type: 'text', inputmode: 'decimal', placeholder: money(summary.expected),
      'aria-label': 'Counted cash',
    });
    const diffRow = el('div.pay-change', { 'aria-live': 'polite' });
    const renderDiff = () => {
      clear(diffRow);
      const counted = parseAmount(countedInput.value);
      if (counted === null) return;
      const diff = Math.round((counted - summary.expected) * 100) / 100;
      diffRow.append(el('span', {
        className: `drawer-diff${diff === 0 ? ' ok' : diff > 0 ? ' over' : ' short'}`,
      }, diff === 0 ? 'Balanced' : `${overShortLabel(diff, money)}`));
    };
    countedInput.addEventListener('input', renderDiff);

    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const counted = parseAmount(countedInput.value);
        if (counted === null) { countedInput.focus(); toast('Enter the counted cash', { icon: 'alert' }); return; }
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true;
        let day;
        try {
          day = await store.closeDrawer({ date, counted });
        } catch (err) {
          console.error(err);
          btn.disabled = false;
          toast(/closed|never started/.test(err.message || '')
            ? err.message
            : 'Couldn’t close the day. Check your connection', { icon: 'wifiOff' });
          return;
        }
        sub.close();
        toast(`Day closed · ${overShortLabel(day.close.diff, money).toLowerCase()}`, {
          icon: 'coins', duration: 5000,
        });
        render();
      },
    },
      el('dl.totals.drawer-totals', {},
        el('div.trow', {}, el('dt', {}, 'Opening float'), el('dd', {}, money(summary.float))),
        el('div.trow', {}, el('dt', {}, 'Cash sales'), el('dd', {}, money(summary.cashSales))),
        summary.cashTips > 0 && el('div.trow', {}, el('dt', {}, 'Cash tips'), el('dd', {}, money(summary.cashTips))),
        summary.cashRefunds > 0 && el('div.trow', {}, el('dt', {}, 'Cash refunds'), el('dd', {}, `−${money(summary.cashRefunds)}`)),
        summary.paidIn > 0 && el('div.trow', {}, el('dt', {}, 'Paid in'), el('dd', {}, money(summary.paidIn))),
        summary.paidOut > 0 && el('div.trow', {}, el('dt', {}, 'Paid out'), el('dd', {}, `−${money(summary.paidOut)}`)),
        el('div.trow.trow-total', {}, el('dt', {}, 'Expected in drawer'), el('dd', {}, money(summary.expected)))
      ),
      el('div.field', {}, el('label.label', {}, 'Counted in the drawer'), countedInput),
      diffRow,
      el('button.btn.btn-primary.btn-block.charge-btn', { type: 'submit' }, 'Close the day')
    );
    const sub = openModal({ title: `Close ${date === todayISO() ? 'today' : formatDay(date)}`, content: form });
    countedInput.focus();
  }

  render();
  return modal;
}

/** Past closes for a range, newest first - the Reports view browses these. */
export async function closedDaysInRange(fromISO, toISO) {
  const keys = monthKeysInRange(fromISO, toISO);
  if (!keys.some((k) => store.drawerMonths.includes(k))) return [];
  const days = await store.drawerDaysInRange(fromISO, toISO);
  return days.filter((d) => d.close);
}

/** A read-only Z-report dialog, for a day picked out of Reports. */
export function openZReport(day) {
  const body = el('div', {},
    el('div.zreport-wrap', {}, zReportNode(day, store)),
    el('button.btn.btn-ghost.btn-block', {
      type: 'button', html: icon('printer', 16, 2), style: { marginTop: '14px' },
      onclick: () => printZReport(day, store),
    }, ' Print Z-report')
  );
  return openModal({ title: `Z-report · ${formatDay(day.date)}`, content: body, wide: true });
}

/** Whether a date's drawer has been started (for the register's badge). */
export async function drawerStartedOn(date = todayISO()) {
  if (!store.drawerMonths.includes(monthKeyOf(date))) return false;
  return !!(await store.drawerDay(date).catch(() => null));
}

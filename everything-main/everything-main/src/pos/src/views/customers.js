/**
 * The customer directory: put a name on a sale, and answer "what did they
 * buy in March?" without paging months by eye. Lightweight on purpose -
 * name and how to reach them - and stored only in the shopkeeper's own
 * Puter account.
 */

import { el, clear, append, keepFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { store, paymentMethodInfo, paymentKindOf } from '../lib/store.js';
import { formatMoney, parseAmount } from '../lib/money.js';
import { formatDay, formatTime, todayISO } from '../lib/dates.js';
import { requirePin } from '../ui/pin-gate.js';
import { matches, plural, initialOf } from '../lib/util.js';
import { isRefund } from '../lib/refunds.js';
import { loyaltyScheme, loyaltyProgress, progressText } from '../lib/loyalty.js';
import { receiptNode, printReceipt } from '../ui/receipt.js';
import { shareActionLabel } from '../ui/receipt-image.js';
import { handOverReceipt } from '../ui/hand-over.js';

export function customersView() {
  let search = '';
  // Receipts keep the currency they were rung up in; rows about a receipt
  // format with the receipt's own, or history relabels €10 as $10.
  const money = (n, currency = store.settings.currency) => formatMoney(n, currency);
  const receiptMoney = (s, n) => money(n, s.currency || store.settings.currency);

  const searchInput = el('input.input.search-input', {
    type: 'search', placeholder: 'Search name, phone, or email', 'aria-label': 'Search customers',
    oninput: () => { search = searchInput.value; renderList(); },
  });
  const list = el('div.card-list');

  function renderList() {
    clear(list);
    const items = store.customers
      .filter((c) => matches(c.name, search) || matches(c.phone, search) || matches(c.email, search))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (!store.customers.length) {
      list.append(el('div.empty', {},
        el('div.empty-icon', { html: icon('users', 28) }),
        el('h3', {}, 'No customers yet'),
        el('p', {}, 'Attach a customer at checkout, or add your regulars here. Everything stays in your own Puter account.'),
        el('button.btn.btn-primary', { onclick: () => openCustomerForm() }, 'Add a customer')
      ));
      return;
    }
    if (!items.length) {
      list.append(el('div.empty', {}, el('p', {}, 'Nothing matches your search.')));
      return;
    }

    for (const c of items) {
      // A balance is money the shop owes: it belongs on the row, not two taps
      // in - the cashier has to be able to see who is owed at a glance.
      const balance = store.creditBalance(c.id);
      list.append(el('button.card-row', {
        type: 'button', onclick: () => openDetail(c.id),
        'aria-label': [`Open ${c.name}`, balance ? `store credit ${money(balance)}` : null]
          .filter(Boolean).join(', '),
      },
        el('span.user-avatar.customer-avatar', {}, initialOf(c.name)),
        el('span.card-main', {},
          el('span.card-title', {}, c.name),
          el('span.card-sub', {}, [c.phone, c.email].filter(Boolean).join(' · ') || c.note || 'No contact details')
        ),
        balance ? el('span.badge.badge-credit', { html: icon('ticket', 12, 2.2) }, ` ${money(balance)}`) : null
      ));
    }
  }

  /** Add or edit the directory entry itself. */
  function openCustomerForm(existing = null, onSaved = null) {
    // The visible .label is a sibling, not a wrapper, so it names nothing for
    // a screen reader: without these, Phone and Email both announced as
    // "Optional" and the Name field as nothing at all.
    const nameInput = el('input.input', { type: 'text', value: existing?.name || '', maxLength: 60, required: true, 'aria-label': 'Name' });
    const phoneInput = el('input.input', { type: 'tel', value: existing?.phone || '', maxLength: 30, placeholder: 'Optional', 'aria-label': 'Phone' });
    const emailInput = el('input.input', { type: 'email', value: existing?.email || '', maxLength: 80, placeholder: 'Optional', 'aria-label': 'Email' });
    const noteInput = el('input.input', { type: 'text', value: existing?.note || '', maxLength: 120, placeholder: 'e.g. always the oat flat white', 'aria-label': 'Note' });

    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        // Spaces pass the browser's `required` check; say what's missing
        // rather than hand the field back in silence.
        if (!nameInput.value.trim()) {
          nameInput.focus();
          toast('Give the customer a name', { icon: 'alert' });
          return;
        }
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true;
        const input = {
          name: nameInput.value, phone: phoneInput.value,
          email: emailInput.value, note: noteInput.value,
        };
        let saved;
        try {
          saved = existing
            ? await store.updateCustomer(existing.id, input)
            : await store.addCustomer(input);
        } catch (err) {
          console.error(err);
          btn.disabled = false;
          toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
          return;
        }
        modal.close();
        toast(existing ? 'Customer updated' : 'Customer added');
        onSaved?.(saved);
      },
    },
      el('div.field', {}, el('label.label', {}, 'Name'), nameInput),
      el('div.form-grid', {},
        el('div.field', {}, el('label.label', {}, 'Phone'), phoneInput),
        el('div.field', {}, el('label.label', {}, 'Email'), emailInput)
      ),
      el('div.field', {}, el('label.label', {}, 'Note'), noteInput),
      el('div.row.form-actions', {},
        existing && el('button.btn.btn-ghost.btn-danger-ghost', {
          type: 'button',
          onclick: async () => {
            // Store credit is money the shop owes and only this customer can
            // spend it, so it can't be deleted out from under itself. Said
            // before the destructive dialog, with the figure, and pointing at
            // the one control that settles it - the Adjust button on the page
            // this form sits over.
            const held = store.creditByCurrency(existing.id);
            if (held.length) {
              const balance = held.map((b) => money(b.amount, b.currency)).join(' + ');
              const ok = await confirmDialog({
                title: 'Settle the balance first',
                message: `“${existing.name}” still holds ${balance} in store credit. Take it off under Store credit → Adjust — the write-off stays in the ledger — and then delete them.`,
                confirmLabel: 'Show the balance',
                danger: false,
              });
              if (ok) modal.close();
              return;
            }
            const ok = await confirmDialog({
              title: 'Delete customer?',
              message: `“${existing.name}” is removed from the directory. Past receipts keep the name they were rung up with.`,
            });
            if (!ok) return;
            try {
              await store.deleteCustomer(existing.id);
            } catch (err) {
              console.error(err);
              toast(/store credit/i.test(err.message || '')
                ? err.message
                : 'Couldn’t delete. Check your connection', { icon: 'wifiOff' });
              return;
            }
            modal.close();
            toast('Customer deleted', { icon: 'trash' });
            onSaved?.(null);
          },
        }, 'Delete'),
        el('button.btn.btn-primary.grow', { type: 'submit' }, existing ? 'Save changes' : 'Add customer')
      )
    );
    const modal = openModal({ title: existing ? 'Edit customer' : 'New customer', content: form });
    nameInput.focus();
  }

  /** The customer page: details plus purchase history from the month files. */
  function openDetail(customerId) {
    const body = el('div');
    const modal = openModal({ title: store.customer(customerId)?.name || 'Customer', content: body });
    let history = [];
    let nextMonth = 0;
    let exhausted = false;
    let loading = false;

    const historyWrap = el('div');
    /** Its own node, so more months landing repaints it without rebuilding
        the sheet - and without dropping focus from the button just pressed. */
    const loyaltyWrap = el('div');

    function renderHead() {
      const customer = store.customer(customerId);
      if (!customer) { modal.close(); return; }
      // The sheet's title was set once at open; a rename rebuilds the body
      // but left the header (and the dialog's accessible name) on the old one.
      const title = modal.panel.querySelector('.modal-title');
      if (title) title.textContent = customer.name;
      modal.panel.setAttribute('aria-label', customer.name);
      clear(body);
      append(body, [
        el('div.row', { style: { marginBottom: '14px' } },
          el('div.grow', {},
            el('p.small.muted', {},
              [customer.phone, customer.email].filter(Boolean).join(' · ') || 'No contact details'),
            customer.note && el('p.small.muted', {}, customer.note)),
          el('button.btn.btn-ghost.btn-sm', {
            type: 'button', html: icon('pencil', 14, 2),
            onclick: () => openCustomerForm(customer, (saved) => {
              if (!saved) { modal.close(); return; }
              renderHead();
            }),
          }, ' Edit')
        ),
        creditCard(customer),
        loyaltyWrap,
        el('h3.pay-section', {}, 'Purchases'),
        historyWrap,
      ]);
    }

    /**
     * The card, worked out from the purchases loaded below - which is why it
     * says how far back it has looked. Nothing here is stored: the receipts
     * are the record, so this and the chip at checkout can't disagree.
     */
    function renderLoyalty() {
      clear(loyaltyWrap);
      const scheme = loyaltyScheme(store.settings, store);
      if (!scheme) return;
      const progress = loyaltyProgress(history, scheme, store);
      if (!progress) return;
      loyaltyWrap.style.marginBottom = '16px';
      append(loyaltyWrap, [
        el('h3.pay-section', { style: { marginTop: 0 } }, 'Loyalty card'),
        el('p.credit-balance', {}, progressText(progress, (n) => money(n))),
        el('p.small.muted', {}, [
          progress.redeemed
            ? `${plural(progress.redeemed, 'reward')} redeemed · ${money(progress.redeemedValue)}`
            : 'No rewards redeemed yet',
          exhausted ? 'from their whole history' : 'from the months searched so far',
        ].join(' · ')),
      ]);
    }

    /**
     * The balance, and the entries behind it. Never a lone number: the rows
     * are what the figure is, so "why do they have $12?" is one look away.
     */
    function creditCard(customer) {
      const balances = store.creditByCurrency(customer.id);
      const entries = store.creditEntries(customer.id);
      const label = { issued: 'Issued', spent: 'Spent', adjusted: 'Adjusted' };
      const wrap = el('div', { style: { marginBottom: '16px' } },
        el('div.row', {},
          el('div.grow', {},
            el('h3.pay-section', { style: { marginTop: 0 } }, 'Store credit'),
            el('p.credit-balance', {}, balances.length
              ? balances.map((b) => money(b.amount, b.currency)).join(' + ')
              : money(0)),
            el('p.small.muted', {}, entries.length
              ? 'Spendable at the till when this customer is on the sale.'
              : 'A refund to store credit, or a goodwill gesture, starts a balance here.')),
          el('button.btn.btn-ghost.btn-sm', {
            type: 'button',
            html: icon('ticket', 14, 2),
            onclick: async () => {
              // Money the shop owes, moved by hand: the same gate as a refund.
              if (await requirePin('adjust store credit')) openCreditForm(customer);
            },
          }, ' Adjust'))
      );
      if (entries.length) {
        const rows = el('div.movement-list', { style: { marginTop: '10px' } });
        for (const e of entries.slice(0, 6)) {
          rows.append(el('div.movement-row', {},
            // todayISO, not toISOString: a movement recorded at 11pm local
            // would otherwise be dated tomorrow, in UTC.
            el('span.movement-time', {}, formatDay(todayISO(new Date(e.at)))),
            el('span.grow', {}, [
              label[e.type] || 'Adjusted',
              // Truthy, not non-null: receipt numbers start at 1001, so a 0
              // is a movement with no receipt behind it, however it got there.
              e.receiptNumber ? `#${e.receiptNumber}` : null,
              e.note || null,
            ].filter(Boolean).join(' · ')),
            el('span.movement-amount', {
              className: `movement-amount${e.amount < 0 ? ' out' : ''}`,
            }, `${e.amount > 0 ? '+' : '−'}${money(Math.abs(e.amount), e.currency || store.settings.currency)}`)
          ));
        }
        wrap.append(rows);
        if (entries.length > 6) {
          wrap.append(el('p.small.muted', { style: { marginTop: '8px' } },
            `Showing the last 6 of ${plural(entries.length, 'movement')}.`));
        }
      }
      return wrap;
    }

    /** Issue or take back credit by hand, with a reason the ledger keeps. */
    function openCreditForm(customer) {
      let dir = 1;
      const amountInput = el('input.input.pay-tender', {
        type: 'text', inputmode: 'decimal', placeholder: money(0),
        'aria-label': 'Amount',
      });
      const noteInput = el('input.input', {
        type: 'text', maxLength: 80, placeholder: 'e.g. goodwill for a wrong order',
        'aria-label': 'Reason',
      });
      const seg = el('div.seg.seg-block', { role: 'group', 'aria-label': 'Direction' });
      const preview = el('div.pay-change', { 'aria-live': 'polite' });
      const renderPreview = () => {
        clear(preview);
        const amount = parseAmount(amountInput.value);
        const balance = store.creditBalance(customer.id);
        if (amount === null) {
          if (amountInput.value.trim()) {
            preview.append(el('span.pay-short', {}, 'Enter the amount as a plain number'));
          }
          return;
        }
        const next = Math.round((balance + dir * amount) * 100) / 100;
        if (next < 0) {
          preview.append(el('span.pay-short', {},
            `That is more than the ${money(balance)} on the balance`));
          return;
        }
        preview.append(el('span', {}, 'Balance becomes '), el('strong', {}, money(next)));
      };
      const renderSeg = () => keepFocus(seg, () => {
        clear(seg);
        for (const [value, text] of [[1, 'Add credit'], [-1, 'Take off']]) {
          seg.append(el('button.seg-btn', {
            type: 'button',
            className: `seg-btn${dir === value ? ' active' : ''}`,
            'aria-pressed': dir === value ? 'true' : 'false',
            onclick: () => { dir = value; renderSeg(); renderPreview(); },
          }, text));
        }
      });
      renderSeg();
      amountInput.addEventListener('input', renderPreview);

      const form = el('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          const amount = parseAmount(amountInput.value);
          if (!amount) {
            amountInput.focus();
            toast('Enter an amount above zero', { icon: 'alert' });
            return;
          }
          const btn = e.target.querySelector('button[type=submit]');
          btn.disabled = true;
          try {
            await store.adjustCredit({ customerId: customer.id, amount: dir * amount, note: noteInput.value });
          } catch (err) {
            console.error(err);
            btn.disabled = false;
            toast(/amount|balance|no longer|too large/.test(err.message || '')
              ? err.message
              : 'Couldn’t save. Check your connection', { icon: 'wifiOff' });
            return;
          }
          sub.close();
          renderHead();
          toast(dir > 0 ? `${money(amount)} added to store credit` : `${money(amount)} taken off store credit`,
            { icon: 'ticket' });
        },
      },
        el('p.small.muted', { style: { marginBottom: '14px' } },
          `${customer.name} has ${money(store.creditBalance(customer.id))} on the balance. `
          + 'The movement is added to the ledger — nothing is ever edited away.'),
        el('div.field', {}, el('label.label', {}, 'Direction'), seg),
        el('div.field', {}, el('label.label', {}, 'Amount'), amountInput),
        preview,
        el('div.field', {}, el('label.label', {}, 'Reason'), noteInput),
        el('button.btn.btn-primary.btn-block', { type: 'submit' }, 'Record movement')
      );
      const sub = openModal({ title: 'Adjust store credit', content: form });
      amountInput.focus();
    }

    // "Look further back" rebuilds the list it sits under, twice per tap
    // (once to say Searching…, once with what came back).
    function renderHistory() {
      keepFocus(historyWrap, paintHistory);
    }

    function paintHistory() {
      clear(historyWrap);
      if (!history.length) {
        historyWrap.append(el('p.small.muted', {},
          exhausted ? 'No purchases on record.' : 'Nothing in the months searched so far.'));
      } else {
        const rows = el('div.card-list');
        for (const s of history) {
          const refund = isRefund(s);
          const pay = refund ? { icon: 'refund', label: 'Refund' } : paymentMethodInfo(paymentKindOf(s));
          rows.append(el('button.card-row', {
            type: 'button',
            className: `card-row${s.voidedAt ? ' voided' : ''}`,
            onclick: () => openReceipt(s),
            // The Void badge lives inside the row, which this label replaces.
            'aria-label': [
              `${refund ? 'Refund' : 'Receipt'} ${s.number}`,
              receiptMoney(s, s.total),
              s.voidedAt ? 'voided' : null,
            ].filter(Boolean).join(', '),
          },
            el('span.pay-ic', { html: icon(pay.icon, 18, 1.8), title: pay.label }),
            el('span.card-main', {},
              el('span.card-title', {}, `#${s.number}`,
                s.voidedAt && el('span.badge.badge-danger', { style: { marginLeft: '8px' } }, 'Void'),
                refund && el('span.badge.badge-danger', { style: { marginLeft: '8px' } }, 'Refund')),
              el('span.card-sub', {}, `${formatDay(s.date)} · ${formatTime(s.at)}`)
            ),
            el('span.card-amount', {}, receiptMoney(s, s.total))
          ));
        }
        historyWrap.append(rows);
        // Netted per currency: a history straddling a currency switch must
        // not add euros to dollars under one symbol.
        const nets = new Map();
        for (const s of history.filter((x) => !x.voidedAt)) {
          const cur = s.currency || store.settings.currency;
          nets.set(cur, (nets.get(cur) || 0) + s.total);
        }
        const net = [...nets].map(([cur, total]) => money(total, cur)).join(' + ') || money(0);
        historyWrap.append(el('p.small.muted', { style: { marginTop: '10px' } },
          `${plural(history.filter((s) => !isRefund(s)).length, 'sale')} in the months searched · ${net} net`));
      }
      if (!exhausted) {
        // aria-disabled, not disabled: the press rebuilds this row, and a
        // disabled replacement can't take back the focus the press held.
        historyWrap.append(el('button.btn.btn-ghost.btn-block', {
          type: 'button', style: { marginTop: '10px' },
          'aria-disabled': loading ? 'true' : 'false',
          onclick: () => { if (!loading) loadMore(); },
        }, loading ? 'Searching…' : 'Look further back'));
      }
    }

    async function loadMore() {
      loading = true;
      renderHistory();
      let batch;
      try {
        batch = await store.salesForCustomer(customerId, { fromMonth: nextMonth });
      } catch (err) {
        console.error(err);
        loading = false;
        renderHistory();
        toast('Couldn’t read older months. Check your connection', { icon: 'wifiOff' });
        return;
      }
      history = [...history, ...batch.sales];
      nextMonth = batch.nextMonth;
      exhausted = batch.exhausted;
      loading = false;
      // The card is derived from `history`, so it is repainted when more
      // months land - in place, so the button just pressed keeps its focus.
      renderLoyalty();
      renderHistory();
      // Once there is nothing older to look for, the button that was
      // pressed is gone; keep focus in the sheet rather than on <body>.
      if (!document.activeElement || document.activeElement === document.body) {
        modal.panel.focus({ preventScroll: true });
      }
    }

    function openReceipt(sale) {
      openModal({
        title: `${isRefund(sale) ? 'Refund' : 'Receipt'} #${sale.number}`,
        content: el('div', {},
          receiptNode(sale, store),
          el('div.row', { style: { marginTop: '16px' } },
            el('button.btn.btn-ghost.grow', {
              html: icon('printer', 16, 2),
              onclick: () => printReceipt(sale, store),
            }, ' Print'),
            el('button.btn.btn-ghost.grow', {
              html: icon('share', 16, 2),
              onclick: (e) => handOverReceipt(sale, e.currentTarget),
            }, ` ${shareActionLabel()}`)
          )
        ),
      });
    }

    renderHead();
    renderLoyalty();
    loadMore();
  }

  const node = el('div.view', {},
    el('header.view-head', {},
      el('div', {},
        el('h1.view-title', {}, 'Customers'),
        el('p.view-sub', {}, 'Names on sales · stored only in your account')
      ),
      el('button.btn.btn-primary', {
        html: icon('plus', 16, 2.2),
        onclick: () => openCustomerForm(),
      }, ' New customer')
    ),
    el('div.reg-toolbar', {}, el('div.search-wrap', { html: icon('search', 17, 2) }, searchInput)),
    list
  );

  const onChange = () => renderList();
  store.addEventListener('change', onChange);
  renderList();

  return { node, destroy: () => store.removeEventListener('change', onChange) };
}

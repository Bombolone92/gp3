/**
 * Attach a customer at checkout: search-or-create in one box, never blocking
 * the fast path. Typing filters the directory by name, phone, or email; when
 * nothing matches exactly, the same text is one tap from becoming a new
 * customer - the cashier never leaves the sheet.
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { formatMoney } from '../lib/money.js';
import { matches, initialOf, plural } from '../lib/util.js';

const MAX_ROWS = 8;

export function openCustomerPicker({ onPick }) {
  let query = '';
  let creating = false;

  const searchInput = el('input.input.search-input', {
    type: 'search', placeholder: 'Name, phone, or email',
    'aria-label': 'Search or add a customer',
    oninput: () => { query = searchInput.value; render(); },
  });
  const results = el('div.card-list', { style: { marginTop: '12px' } });
  /** Outside the list, so the rows keep their own hairlines between them. */
  const foot = el('p.small.muted', { style: { margin: '0 4px' } });

  const pick = (customer) => {
    onPick(customer);
    modal.close();
  };

  async function createFromQuery() {
    if (creating) return;
    creating = true;
    let customer;
    try {
      customer = await store.addCustomer({ name: query });
    } catch (err) {
      console.error(err);
      creating = false;
      toast(err.message === 'A customer needs a name.' ? err.message
        : 'Couldn’t add the customer. Check your connection', { icon: 'wifiOff' });
      return;
    }
    creating = false;
    toast(`${customer.name} added`, { icon: 'circleCheck' });
    pick(customer);
  }

  function render() {
    clear(results);
    clear(foot);
    const q = query.trim();
    const all = store.customers
      .filter((c) => matches(c.name, q) || matches(c.phone, q) || matches(c.email, q))
      .sort((a, b) => a.name.localeCompare(b.name));
    const isExact = (c) => c.name.toLowerCase() === q.toLowerCase();
    // The row the cashier typed in full cannot be the one the page cap cuts.
    // Sorted by name, a directory holding "Maria Sanchez" alongside eight
    // "<first name> Maria Sanchez" pushed the exact match off the end of the
    // list - and the create row below, which only ever looked at the rows
    // that fit, then offered to make a second Maria Sanchez. Attaching that
    // one splits her history across two records, quietly.
    const exact = q ? all.findIndex(isExact) : -1;
    if (exact > 0) all.unshift(...all.splice(exact, 1));
    const found = all.slice(0, MAX_ROWS);

    for (const c of found) {
      // The balance is half the reason to attach somebody at the till, so the
      // row says it rather than making the cashier attach and then find out.
      const balance = store.creditBalance(c.id);
      results.append(el('button.card-row', {
        type: 'button', onclick: () => pick(c),
        'aria-label': [`Attach ${c.name}`, balance ? `store credit ${formatMoney(balance, store.settings.currency)}` : null]
          .filter(Boolean).join(', '),
      },
        el('span.user-avatar.customer-avatar', {}, initialOf(c.name)),
        el('span.card-main', {},
          el('span.card-title', {}, c.name),
          el('span.card-sub', {}, [c.phone, c.email].filter(Boolean).join(' · ') || c.note || '')
        ),
        balance ? el('span.badge.badge-credit', {
          html: icon('ticket', 12, 2.2),
        }, ` ${formatMoney(balance, store.settings.currency)}`) : null
      ));
    }

    if (!found.length && !q) {
      results.append(el('p.small.muted', { style: { padding: '10px 4px' } },
        store.customers.length
          ? 'Type to search your customers.'
          : 'No customers yet. Type a name to add the first one.'));
    }

    // The create action rides under the results whenever there's a name
    // typed that isn't already an exact match - anywhere in the directory,
    // not merely among the rows on screen.
    if (q && !all.some(isExact)) {
      results.append(el('button.card-row', {
        type: 'button', onclick: createFromQuery,
      },
        el('span.pay-ic', { html: icon('plus', 18, 2) }),
        el('span.card-main', {},
          el('span.card-title', {}, `Add “${q}” as a new customer`),
          el('span.card-sub', {}, 'Phone and email can be filled in later'))
      ));
    }

    // A cut list says so. Silently showing eight of eleven reads as "she
    // isn't in here", which is the one thing it doesn't mean. With nothing
    // typed the eight are a starting page of the directory, not matches.
    if (all.length > found.length) {
      foot.append(el('span', {}, q
        ? `${found.length} of ${all.length} matches shown. Keep typing to narrow it down.`
        : `First ${found.length} of ${plural(all.length, 'customer')}. Type to find someone.`));
    }
  }

  const modal = openModal({
    title: 'Attach a customer',
    content: el('div', {},
      el('div.search-wrap', { html: icon('search', 17, 2) }, searchInput),
      results,
      foot
    ),
  });
  render();
  searchInput.focus();
  return modal;
}

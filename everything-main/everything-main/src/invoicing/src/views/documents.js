/** Invoice and estimate lists: one factory, two flavors. */

import { el, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import { docStatus } from '../lib/doc.js';
import { docTotals, fmtMoney } from '../lib/money.js';
import { todayISO, fmtDate } from '../lib/dates.js';
import { docRow, emptyState, moneyLines, debounceInput, keepFocus } from '../ui/bits.js';
import { AGING_BUCKETS, agingParts, overdueAmount } from '../lib/aging.js';
import { isOpenInvoice } from '../lib/doc.js';

const FILTERS = {
  invoice: [
    { value: 'all', label: 'All' },
    { value: 'draft', label: 'Draft' },
    { value: 'sent', label: 'Open' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'paid', label: 'Paid' },
    { value: 'writtenOff', label: 'Written off' },
    { value: 'void', label: 'Void' },
  ],
  quote: [
    { value: 'all', label: 'All' },
    { value: 'draft', label: 'Draft' },
    { value: 'sent', label: 'Awaiting' },
    { value: 'accepted', label: 'Accepted' },
    { value: 'invoiced', label: 'Invoiced' },
    { value: 'declined', label: 'Declined' },
    { value: 'expired', label: 'Expired' },
  ],
};

/** Does a document's derived status satisfy a filter chip? */
export function matchesFilter(status, filter) {
  if (filter === 'all') return true;
  if (filter === 'sent') return status === 'sent' || status === 'partial' || status === 'overdue';
  return status === filter;
}

function documentsView(kind, { navigate, params, replaceParams = () => {} }) {
  const root = el('div.view');
  let filter = params.f && FILTERS[kind].some((f) => f.value === params.f) ? params.f : 'all';
  let query = '';
  // Arrived from a cell of the Reports aging table: this slice is one age
  // bucket of open invoices, optionally for one client. It shows as a
  // removable chip above the list rather than as a hidden filter.
  let age = kind === 'invoice' && AGING_BUCKETS.some((b) => b.key === params.age) ? params.age : null;
  // '' is a real answer here — the aging table's "No client" row links with an
  // empty client — so the filter keys off whether the parameter is there at
  // all. Treating '' as "no filter" made that row's figure open a list of
  // every client's invoices in the band, which is not what it counted.
  let ageClient = age && params.client !== undefined ? String(params.client) : null;
  // The date the band was counted as of, when the table it came from was not
  // aged as of today — the Reports page ages a finished period as of its last
  // day. Without it the slice is re-cut by today's calendar, and a figure
  // clicked in last quarter's table opens a list that leaves half of it out.
  let ageAsOf = age && /^\d{4}-\d{2}-\d{2}$/.test(String(params.asof || '')) ? params.asof : null;
  // The last issue date the table counted. A period still running is aged as
  // of today but cut at its own end, so the two dates differ and the bound
  // has to travel on its own — or an invoice post-dated past the period's
  // end shows up in a list opened from a cell that left it out.
  let ageThrough = age && /^\d{4}-\d{2}-\d{2}$/.test(String(params.through || '')) ? params.through : null;
  const isInvoice = kind === 'invoice';
  const title = isInvoice ? 'Invoices' : 'Estimates';

  const listWrap = el('div');

  const search = debounceInput((value) => { query = value; renderList(); });
  const searchInput = el('input.input.search-input', {
    type: 'search',
    placeholder: `Search ${title.toLowerCase()}, clients…`,
    'aria-label': `Search ${title.toLowerCase()}`,
    oninput: (e) => search(e.target.value.trim().toLowerCase()),
  });

  const chipRow = el('div.chip-row', { role: 'group', 'aria-label': 'Filter by status' });
  const ageWrap = el('div');

  function renderChips() {
    clear(chipRow);
    for (const f of FILTERS[kind]) {
      chipRow.append(el('button.chip', {
        type: 'button',
        className: `chip${filter === f.value ? ' active' : ''}`,
        'aria-pressed': filter === f.value ? 'true' : 'false',
        onclick: () => {
          filter = f.value;
          // Picking a status is picking a slice: an age filter left running
          // underneath would silently empty "Paid" and look like a bug.
          clearAge();
          syncHash();
          renderChips();
          renderList();
          // The rebuild destroyed the pressed chip; keep focus on its twin.
          chipRow.querySelector('.chip.active')?.focus();
        },
      }, f.label));
    }
  }

  /** The removable "31–60 days" pill, or nothing when no age filter is on. */
  function renderAgeChip() {
    clear(ageWrap);
    if (!age) return;
    const bucket = AGING_BUCKETS.find((b) => b.key === age);
    const client = ageClient ? store.client(ageClient) : null;
    // The slice may be the invoices with no client at all, which the pill has
    // to say out loud — otherwise it reads as the whole age band.
    const who = client
      ? ` · ${client.company || client.name || 'Client'}`
      : (ageClient === '' ? ' · No client' : '');
    ageWrap.append(el('div.age-filter', {},
      el('span.age-filter-text', {},
        el('strong', {}, bucket.key === 'current' ? 'Not yet due' : `${bucket.label} overdue`),
        who,
        // Aged as of a day other than today: say which, or a band that reads
        // "1–30 days overdue" beside an invoice sixty days late looks wrong.
        ageAsOf ? ` · as of ${fmtDate(ageAsOf)}` : '',
        ageThrough && ageThrough !== ageAsOf ? ` · issued by ${fmtDate(ageThrough)}` : ''),
      el('button.btn.btn-ghost.age-filter-clear', {
        type: 'button',
        html: icon('x', 15, 1.8),
        onclick: () => {
          clearAge();
          syncHash();
          renderAgeChip();
          renderList();
          // The pill removed itself from under the pointer (and the caret):
          // hand focus to the search box, which is where this slice's next
          // narrowing would come from.
          searchInput.focus();
        },
      }, ' Clear')));
  }

  /** The slice, in the address: what Back (and a reload) come back to. */
  function syncHash() {
    replaceParams({
      f: filter === 'all' ? undefined : filter,
      age: age || undefined,
      // '' is a real value here (the "No client" band); only absence is absence.
      client: age && ageClient !== null ? ageClient : undefined,
      asof: ageAsOf || undefined,
      through: ageThrough || undefined,
    });
  }

  function clearAge() {
    if (!age) return;
    age = null;
    ageClient = null;
    ageAsOf = null;
    ageThrough = null;
    renderAgeChip();
  }

  function renderList() {
    // The list repaints on any store change, asked for or not — a recurring
    // invoice drafted at boot, a share page finishing its save — and the
    // rebuild destroys the row a keyboard user was standing on. The search
    // box and the chips live outside this wrap and survive, so only the rows
    // need carrying; a repaint triggered from either of those leaves focus
    // where it is and this is a no-op.
    const restoreFocus = keepFocus(listWrap);
    clear(listWrap);
    const today = todayISO();
    const docs = store.docs().filter((d) => d.kind === kind);
    // The slice is cut exactly as the aging table cut it: open as of the
    // day it was aged, issued by then, and with money in this band on that
    // day — on a payment plan that is any installment due in the band, so an
    // invoice can sit in two of them, exactly as the table counts it.
    const agedOn = ageAsOf || today;
    // Issued by the day it was aged unless the cell said otherwise, which is
    // aging()'s own default: on the last day of a period the link carries
    // neither date, and without a bound here a post-dated invoice the cell
    // had left out was in the list and its footer.
    const issuedBy = ageThrough || agedOn;
    const inBand = (d) => agingParts(d, agedOn).some((p) => p.bucket === age);
    const shown = docs.filter((d) => {
      if (age && !(isOpenInvoice(d, agedOn) && inBand(d)
        && (!issuedBy || String(d.issueDate || '') <= issuedBy))) return false;
      if (ageClient !== null && (d.clientId || '') !== ageClient) return false;
      if (!matchesFilter(docStatus(d, today), filter)) return false;
      if (!query) return true;
      const client = store.client(d.clientId);
      const hay = `${d.number} ${d.reference || ''} ${client?.name || ''} ${client?.company || ''} ${(d.items || []).map((i) => i.name).join(' ')}`.toLowerCase();
      return hay.includes(query);
    });

    if (!docs.length) {
      listWrap.append(emptyState(isInvoice ? 'invoice' : 'quote',
        isInvoice ? 'No invoices yet' : 'No estimates yet',
        isInvoice
          ? 'Invoices you create appear here with their payment status.'
          : 'Estimates are quotes your client can accept before any invoice exists.',
        // Nothing to create from a device showing a saved copy, exactly as the
        // button above the list and the FAB already know.
        store.readOnly ? null
          : el('button.btn.btn-primary', { onclick: () => navigate(`#/new/${kind}`) },
            isInvoice ? 'New invoice' : 'New estimate')));
      restoreFocus();
      return;
    }
    if (!shown.length) {
      // A search that matches nothing inside an age band is the search's
      // doing, not the band's: blaming the band told the user to clear the
      // very slice they had opened from Reports.
      listWrap.append(emptyState('search', 'No matches',
        age && !query
          ? 'Nothing is outstanding in that age band any more. Clear the age filter to see the rest.'
          : 'Try a different search or status filter.'));
      restoreFocus();
      return;
    }

    // A quiet total line for the current slice, per currency.
    const totals = {};
    for (const d of shown) {
      const t = docTotals(d);
      // What the slice is about. An age band holds the part of each balance
      // that is that old — on a payment plan, the installments due in it —
      // so the line agrees with the Reports cell that opened it; the overdue
      // slice holds what is past due, which the Home tile that leads here
      // also counts; an open or written-off slice is about money still
      // unpaid; anything else about what the invoices came to.
      const v = !isInvoice ? t.total
        : age ? agingParts(d, agedOn).filter((p) => p.bucket === age).reduce((a, p) => a + p.amount, 0)
        : filter === 'overdue' ? overdueAmount(d, today)
        : ['sent', 'writtenOff'].includes(filter) ? t.balance
        : t.total;
      totals[d.currency] = Math.round(((totals[d.currency] || 0) + v) * 100) / 100;
    }
    // What the slice adds up to, in the footer of the box that lists it —
    // the same place a table says how many rows it is showing.
    listWrap.append(el('div.doc-list.card-list', {},
      shown.map((d) => docRow(d)),
      el('div.list-foot', {},
        el('span', {}, `${shown.length} ${shown.length === 1 ? 'document' : 'documents'}`),
        el('span', {}, moneyLines(totals, { zero: fmtMoney(0, store.settings.currency) })))));
    restoreFocus();
  }

  root.append(
    el('div.page-head', {},
      el('div', {},
        el('h1.page-title', {}, title),
        el('p.page-sub', {}, isInvoice ? 'Everything you have billed' : 'Quotes waiting to become work')),
      el('div.page-actions', {},
        // The next invoice is usually last month's with new numbers: seed
        // the editor from the most recent one, everything editable, nothing
        // saved (not even a number) until Create is pressed.
        (() => {
          if (!isInvoice) return null;
          const last = store.docs().find((d) => d.kind === 'invoice');
          if (!last) return null;
          return el('button.btn.btn-quiet', {
            html: icon('copy', 15, 1.6),
            disabled: store.readOnly,
            title: store.readOnly
              ? 'Reconnect to create documents'
              : `Start a new invoice from ${last.number}`,
            onclick: () => navigate(`#/new/invoice?from=${last.id}`),
          }, ' New from last');
        })(),
        el('button.btn.btn-primary', {
          html: icon('plus', 16, 1.8),
          disabled: store.readOnly,
          title: store.readOnly ? 'Reconnect to create documents' : null,
          onclick: () => navigate(`#/new/${kind}`),
        }, isInvoice ? ' New invoice' : ' New estimate'))),
    el('div.toolbar', {},
      el('div.search-wrap', { html: icon('search', 17, 1.6) }, searchInput),
    ),
    chipRow,
    ageWrap,
    listWrap
  );

  renderChips();
  renderAgeChip();
  renderList();
  store.addEventListener('change', renderList);
  root.destroy = () => {
    search.cancel();
    store.removeEventListener('change', renderList);
  };
  return root;
}

export const invoicesView = (ctx) => documentsView('invoice', ctx);
export const quotesView = (ctx) => documentsView('quote', ctx);

/**
 * One client's page: how you stand with them, everything you have ever sent
 * them, and the statement of account they will eventually ask for.
 *
 * The clients grid is a set of doorways; this is the room. Editing, deleting,
 * and starting new documents live here rather than on the card.
 */

import { el, clear, append } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { docRow, emptyState, moneyLines, copyText, debounceInput, keepFocus } from '../ui/bits.js';
import { statementHTML } from '../ui/paper.js';
import { store, TRASH_DAYS } from '../lib/store.js';
import { isOpenInvoice, clientTotals, matchesClientFilter, dueDateFor } from '../lib/doc.js';
import { overdueAmount } from '../lib/aging.js';
import { docTotals, fmtMoney } from '../lib/money.js';
import { todayISO, fmtDate } from '../lib/dates.js';
import { mailtoUrl } from '../lib/message.js';
import { savePdf } from '../ui/pdf-action.js';
import { openClientForm } from './clients.js';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'paid', label: 'Paid' },
  { value: 'draft', label: 'Drafts' },
  { value: 'quote', label: 'Estimates' },
];

export function clientView({ navigate, params, replaceParams = () => {} }) {
  const root = el('div.view');
  let filter = FILTERS.some((f) => f.value === params.f) ? params.f : 'all';
  let query = '';
  // Each render builds a fresh list painter; the search box outlives them, so
  // it calls whichever one is current.
  let renderList = () => {};
  const search = debounceInput((value) => { query = value; renderList(); });

  // The search box outlives every render (documents.js keeps its search the
  // same way): rebuilding it inside render() meant any store change landing
  // mid-typing — a recurring draft after boot, a slow save settling —
  // replaced the input, discarding focus and the text as typed in favor of
  // the trimmed, lowercased query.
  const searchInput = el('input.input.search-input', {
    type: 'search',
    placeholder: 'Search their documents…',
    'aria-label': 'Search this client’s documents',
    oninput: (e) => search(e.target.value.trim().toLowerCase()),
  });
  const chipRow = el('div.chip-row', { role: 'group', 'aria-label': 'Filter documents' });

  function renderChips() {
    clear(chipRow);
    for (const f of FILTERS) {
      chipRow.append(el('button.chip', {
        type: 'button',
        className: `chip${filter === f.value ? ' active' : ''}`,
        'aria-pressed': filter === f.value ? 'true' : 'false',
        onclick: () => {
          filter = f.value;
          // In the address, so Back from a document lands on this slice.
          replaceParams({ f: filter === 'all' ? undefined : filter });
          renderChips();
          renderList();
          // The rebuild destroyed the pressed chip; keep focus on its twin.
          chipRow.querySelector('.chip.active')?.focus();
        },
      }, f.label));
    }
  }

  function render() {
    const had = document.activeElement;
    // The two controls below outlive the rebuild and are matched by identity;
    // everything else here — the action row, the document rows — is built
    // fresh each time, so it needs its replacement found the way every other
    // list finds one.
    const restoreFocus = keepFocus(root);
    clear(root);
    const client = store.client(params.id);
    if (!client) {
      append(root, [
        el('div.page-head', {}, el('div', {},
          el('div.back-row', {},
            el('a.back-link', { href: '#/clients', html: icon('back', 16, 1.8) }, ' Clients')),
          el('h1.page-title', {}, 'Client not found'))),
        emptyState('clients', 'This client no longer exists',
          'They may have been deleted. Their documents are still in your records.'),
      ]);
      // Deleting a client repaints this page into the stub above before the
      // navigation lands, and the row of actions that held focus went with
      // it: hand focus on rather than leaving a keyboard user on <body>.
      restoreFocus();
      return;
    }

    const today = todayISO();
    const docs = store.docsForClient(client.id);
    const totals = clientTotals(docs, today);
    const openInvoices = docs.filter((d) => isOpenInvoice(d, today));
    // The count under "Billed" counts the invoices whose money is in the
    // number above it: like clientTotals, drafts (nothing sent yet) and
    // void invoices (count for nothing) stay out.
    const invoiceCount = docs.filter((d) =>
      d.kind === 'invoice' && d.status !== 'draft' && d.status !== 'void').length;
    const zero = { zero: fmtMoney(0, store.settings.currency) };
    // Same fallback the paper uses: a restored client may have no name.
    const title = client.company || client.name || 'Client';

    /* ----- Header ----- */
    // Statement, print, and PDF all work from the copy saved on this device;
    // creating, editing, and deleting need the cloud, so offline they are
    // left out rather than offered and then refused — the same allowlist the
    // document page keeps.
    const actions = store.readOnly ? [
      el('button.btn', {
        html: icon('receipt', 15, 1.6),
        onclick: () => openStatement(client, openInvoices, today),
      }, ' Statement'),
    ] : [
      el('button.btn.btn-primary', {
        html: icon('plus', 16, 1.8),
        onclick: () => navigate(`#/new/invoice?client=${client.id}`),
      }, ' New invoice'),
      el('button.btn', {
        html: icon('quote', 15, 1.6),
        onclick: () => navigate(`#/new/quote?client=${client.id}`),
      }, ' New estimate'),
      el('button.btn', {
        html: icon('receipt', 15, 1.6),
        onclick: () => openStatement(client, openInvoices, today),
      }, ' Statement'),
      el('button.btn', {
        html: icon('pencil', 15, 1.6),
        onclick: () => openClientForm(client),
      }, ' Edit'),
      el('button.btn.btn-danger', {
        html: icon('trash', 15, 1.6),
        onclick: async () => {
          const ok = await confirmDialog({
            title: `Delete ${title}?`,
            message: (docs.length
              ? `Their ${docs.length} document${docs.length === 1 ? ' stays' : 's stay'} in your records without a client attached. `
              : '')
              + `They move to the trash, recoverable for ${TRASH_DAYS} days — restoring re-attaches every document.`,
          });
          if (!ok) return;
          try {
            // deleteClient removes the client from memory and emits before
            // the write settles, re-rendering this view into its "client no
            // longer exists" stub — leave as soon as that state exists. A
            // failed write rolls the client back and the catch reports it.
            const done = store.deleteClient(client.id);
            if (root.isConnected) navigate('#/clients');
            await done;
            toast(`${title} moved to the trash`, {
              icon: 'trash',
              action: {
                label: 'Undo',
                onClick: async () => {
                  try {
                    await store.restoreClient(client.id);
                    toast(`${title} restored`, { icon: 'undo' });
                  } catch (err) {
                    console.error(err);
                    toast('Could not restore. Check your connection', { icon: 'wifiOff' });
                  }
                },
              },
            });
          } catch (err) {
            console.error(err);
            toast('Could not delete. Check your connection', { icon: 'wifiOff' });
          }
        },
      }, ' Delete'),
    ];

    const contact = [
      // Each row's text sits in its own span: text-overflow only ever acts on
      // a box's own inline content, and the row is a flex container, so a long
      // address left as a bare text node was sliced off mid-word with no
      // ellipsis to say so.
      client.email && el('a.client-meta-row', { href: mailtoUrl({ to: client.email }), html: icon('mail', 14, 1.6) }, el('span', {}, client.email)),
      client.phone && el('a.client-meta-row', { href: `tel:${client.phone.replace(/[^\d+]/g, '')}`, html: icon('phone', 14, 1.6) }, el('span', {}, client.phone)),
      client.address && el('span.client-meta-row.multiline', { html: icon('building', 14, 1.6) }, el('span', {}, client.address)),
      client.taxId && el('span.client-meta-row', { html: icon('receipt', 14, 1.6) }, el('span', {}, `Tax ID: ${client.taxId}`)),
    ].filter(Boolean);

    /* ----- Document list ----- */
    const listWrap = el('div');

    renderList = () => {
      clear(listWrap);
      const shown = docs.filter((d) => {
        if (!matchesClientFilter(d, filter, today)) return false;
        if (!query) return true;
        const hay = `${d.number} ${d.reference || ''} ${(d.items || []).map((i) => i.name).join(' ')} ${d.notes || ''}`.toLowerCase();
        return hay.includes(query);
      });
      if (!docs.length) {
        listWrap.append(emptyState('invoice', 'Nothing billed yet',
          `Invoices and estimates for ${title} will appear here.`,
          store.readOnly ? null : el('div.empty-actions', {},
            el('button.btn.btn-primary', {
              onclick: () => navigate(`#/new/invoice?client=${client.id}`),
            }, 'New invoice'),
            el('button.btn', {
              onclick: () => navigate(`#/new/quote?client=${client.id}`),
            }, 'New estimate'))));
        return;
      }
      if (!shown.length) {
        listWrap.append(emptyState('search', 'No matches', 'Try a different search or filter.'));
        return;
      }
      listWrap.append(el('div.doc-list.card-list', {},
        shown.map((d) => docRow(d, { showClient: false }))));
    };

    renderChips();
    renderList();

    append(root, [
      el('div.page-head', {},
        el('div', {},
          el('div.back-row', {},
            el('a.back-link', { href: '#/clients', html: icon('back', 16, 1.8) }, ' Clients')),
          el('div.client-head', {},
            el('span.user-avatar.big', { 'aria-hidden': 'true' }, title.charAt(0).toUpperCase()),
            el('div', {},
              el('h1.page-title', {}, title),
              // The contact person, when the company holds the heading. A
              // client billed under their own name has no second line to
              // give: the grid card already leaves it out, and the word
              // "Client" under "Tom Aldana" told nobody anything.
              client.company && client.name
                ? el('p.page-sub', {}, client.name)
                : null))),
      ),
      el('div.detail-actions', {}, actions),
      contact.length ? el('div.client-contact', {}, contact) : null,
      el('div.stat-grid.stat-grid-3', {},
        statTile('Billed', moneyLines(totals.billed, zero),
          `${invoiceCount} invoice${invoiceCount === 1 ? '' : 's'}`),
        statTile('Collected', moneyLines(totals.collected, zero), 'Payments received'),
        statTile('Open', moneyLines(totals.open, zero),
          openInvoices.length ? `${openInvoices.length} invoice${openInvoices.length === 1 ? '' : 's'} awaiting payment` : 'Nothing outstanding')),
      el('div.toolbar', {}, el('div.search-wrap', { html: icon('search', 17, 1.6) }, searchInput)),
      chipRow,
      listWrap,
    ]);

    // clear(root) detached whatever held focus; hand it back. The search box
    // is the same node, so its text and state survive with it.
    if (had === searchInput) searchInput.focus();
    else if (had?.classList?.contains('chip')) {
      [...chipRow.querySelectorAll('.chip')]
        .find((c) => c.textContent === had.textContent)?.focus();
    } else {
      restoreFocus();
    }
  }

  function statTile(label, valueNode, sub) {
    return el('div.stat-tile.static', {},
      el('span.stat-label', {}, label),
      el('span.stat-value', {}, valueNode),
      el('span.stat-sub', {}, sub));
  }

  store.addEventListener('change', render);
  root.destroy = () => {
    search.cancel();
    store.removeEventListener('change', render);
  };
  render();
  return root;
}

/**
 * The statement, as paper. Printing hides the app around the modal, the same
 * way a receipt prints, so what comes out of the printer is the page the
 * client asked for.
 */
export function openStatement(client, openInvoices, today) {
  const paper = el('div.paper.statement-paper', {
    html: statementHTML(client, openInvoices, store.settings, { today }),
  });
  const summary = openInvoices.length
    ? `${openInvoices.length} open invoice${openInvoices.length === 1 ? '' : 's'}`
    : 'Nothing outstanding';

  const modal = openModal({
    title: `Statement · ${client.company || client.name || 'Client'}`,
    wide: true,
    content: el('div', {},
      paper,
      el('div.side-actions', { style: { marginTop: '14px' } },
        el('button.btn.btn-primary', {
          html: icon('printer', 15, 1.6),
          onclick: () => {
            document.body.classList.add('print-paper');
            const done = () => document.body.classList.remove('print-paper');
            window.addEventListener('afterprint', done, { once: true });
            window.print();
            setTimeout(done, 1000);
          },
        }, ' Print'),
        el('button.btn', {
          html: icon('download', 15, 1.6),
          onclick: () => savePdf((mods) => mods.statementSpec(client, openInvoices, store.settings, { today })),
        }, ' Download PDF'),
        client.email ? el('a.btn', {
          href: mailtoUrl({ to: client.email, subject: `Statement of account · ${summary}` }),
          target: '_blank', rel: 'noopener',
          html: icon('mail', 15, 1.6),
        }, ' Email client') : null,
        el('button.btn.btn-ghost', {
          html: icon('copy', 15, 1.6),
          onclick: () => copyText(statementText(client, openInvoices, today), 'Statement copied as text'),
        }, ' Copy as text'))),
  });
  return modal;
}

/** The same statement as plain text, for pasting into a message. */
export function statementText(client, openInvoices, today) {
  const lines = [`Statement of account · ${client.company || client.name || 'Client'}`, `As of ${fmtDate(today)}`, ''];
  const due = {};
  const overdue = {};
  const add = (map, currency, amount) => {
    map[currency] = Math.round(((map[currency] || 0) + amount) * 100) / 100;
  };
  // The same rows in the same order as the printed statement, oldest first.
  const rows = [...openInvoices]
    .sort((a, b) => (a.issueDate < b.issueDate ? -1 : a.issueDate > b.issueDate ? 1 : 0));
  for (const doc of rows) {
    const t = docTotals(doc);
    // The date the printed statement and the PDF quote: on an invoice split
    // into installments that is the earliest one still open, not the final
    // date months away. Pasting this into a message used to tell a client an
    // invoice the paper flags as overdue was not due until December.
    const on = dueDateFor(doc);
    add(due, doc.currency, t.balance);
    // Flagged and totalled exactly as the paper does it: the row that is
    // late says so, and the late part — on a payment plan the installment
    // whose date has passed, not the whole balance — is added up below.
    const late = overdueAmount(doc, today);
    if (late > 0.005) add(overdue, doc.currency, late);
    lines.push(`${doc.number} · issued ${fmtDate(doc.issueDate)} · due ${on ? fmtDate(on) : 'on receipt'}`
      + `${on && on < today ? ' · overdue' : ''} · ${fmtMoney(t.balance, doc.currency)} outstanding`);
  }
  if (!openInvoices.length) lines.push('Nothing outstanding. Every invoice is settled.');
  lines.push('');
  for (const [currency, amount] of Object.entries(due)) {
    lines.push(`Total due: ${fmtMoney(amount, currency)}`);
  }
  for (const [currency, amount] of Object.entries(overdue)) {
    lines.push(`Of which overdue: ${fmtMoney(amount, currency)}`);
  }
  return lines.join('\n');
}

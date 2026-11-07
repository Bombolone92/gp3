import { el, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store, annualByCurrency, TRASH_DAYS } from '../lib/store.js';
import { renewalInfo } from '../lib/dates.js';
import { sortedTotals } from '../lib/money.js';
import { formatMoney, debounce, DOT, joinDot } from '../lib/util.js';
import { avatar, emptyState, contractRow } from '../ui/bits.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { openContactForm } from '../ui/contact-form.js';
import { openContractForm } from '../ui/contract-form.js';

export function contactsView({ param = null } = {}) {
  const root = el('div.view');
  let query = '';

  const runSearch = debounce(() => { query = search.value; renderList(); }, 120);
  const search = el('input.input.search-input', {
    type: 'search', placeholder: 'Search contacts',
    'aria-label': 'Search contacts',
    oninput: runSearch,
  });

  const listWrap = el('div');

  function renderList() {
    clear(listWrap);
    const q = query.trim().toLowerCase();
    const matches = store.contacts.filter((c) =>
      !q || [c.name, c.company, c.role, c.email].filter(Boolean).join(' ').toLowerCase().includes(q));

    if (!store.contacts.length) {
      listWrap.append(emptyState({
        icon: 'users',
        title: 'No contacts yet',
        sub: 'Contacts are the people and companies behind your agreements.',
        action: el('button.btn.btn-primary', { onclick: () => openContactForm() }, 'Add a contact'),
      }));
      return;
    }
    if (!matches.length) {
      listWrap.append(emptyState({ icon: 'search', title: 'Nothing matches', sub: 'Try a different search.' }));
      return;
    }

    // Grouped in one pass; every row asking the book for its own contracts
    // meant a full scan of it per row.
    const byContact = new Map();
    for (const c of store.contracts) {
      const list = byContact.get(c.contactId);
      if (list) list.push(c);
      else byContact.set(c.contactId, [c]);
    }

    listWrap.append(el('div.card', {},
      el('div.list', {}, matches.map((contact) => {
        const linked = byContact.get(contact.id) || [];
        const sub = joinDot([
          [contact.role, contact.company].filter(Boolean).join(', '),
          `${linked.length} contract${linked.length === 1 ? '' : 's'}`,
        ]);
        return el('button.list-row.as-button', {
          type: 'button',
          onclick: () => openContactDetail(contact.id),
        },
          avatar(contact.name),
          el('div.grow.min0', {},
            el('div.row-title', {}, contact.name),
            el('div.row-sub', {}, sub)
          ),
          el('span.row-chev', { html: icon('chevR', 18) })
        );
      }))
    ));
  }

  function openContactDetail(contactId) {
    const bodyEl = el('div');
    const modal = openModal({ title: 'Contact', content: bodyEl });

    function renderDetail() {
      const contact = store.contactById(contactId);
      if (!contact) { modal.close(); return; }
      const linked = store.contractsForContact(contact.id);
      clear(bodyEl);

      bodyEl.append(
        el('div.contact-hero', {},
          avatar(contact.name),
          el('div.grow.min0', {},
            el('h3.contact-name', {}, contact.name),
            // Wrapped, not cut: this sheet is the contact's record, so
            // "Account Executive, Northwind Cloud" has nowhere else to be
            // read once a phone has trimmed it to "Account Executive, N…".
            (contact.role || contact.company) && el('p.row-sub.wrap', {},
              [contact.role, contact.company].filter(Boolean).join(', '))
          ),
          el('button.btn.btn-ghost.btn-compact', {
            html: icon('pencil', 14, 2),
            onclick: () => openContactForm({ contact, onSaved: renderDetail }),
          }, ' Edit')
        ),
        el('div.contact-lines', {},
          contact.email && contactLine('mail', el('a', { href: `mailto:${contact.email}` }, contact.email)),
          contact.phone && contactLine('phone', el('a', { href: `tel:${contact.phone.replace(/\s+/g, '')}` }, contact.phone)),
          contact.notes && contactLine('notes', contact.notes)
        ),
        el('div.card-head', { style: { marginTop: '18px' } },
          el('div', {},
            el('h3.card-title', {}, `Contracts (${linked.length})`),
            // Per-currency, like every other total in the app.
            yearlyTotals(linked)
          ),
          el('button.btn.btn-ghost.btn-compact', {
            html: icon('plus', 14, 2.2),
            onclick: () => {
              modal.close();
              openContractForm({ contactId: contact.id });
            },
          }, ' New')
        ),
        linked.length
          ? el('div.list', {}, linked.map((c) => {
            const row = contractRow(c, renewalInfo(c));
            row.addEventListener('click', () => modal.close());
            return row;
          }))
          : el('p.quiet-note', {}, 'No contracts linked yet.'),
        el('button.btn.btn-ghost.btn-block.btn-danger-ghost', {
          style: { marginTop: '16px' },
          onclick: async () => {
            const n = linked.length;
            const ok = await confirmDialog({
              title: 'Delete this contact?',
              message: n
                ? `${contact.name} moves to the trash and drops off ${n === 1 ? 'the linked contract' : `all ${n} linked contracts`}. Restoring the contact puts the link${n === 1 ? '' : 's'} back.`
                : `${contact.name} moves to the trash. You can restore them there for ${TRASH_DAYS} days.`,
              confirmLabel: 'Delete',
            });
            if (!ok) return;
            try {
              await store.deleteContact(contact.id);
              modal.close();
              toast('Contact deleted', {
                icon: 'trash',
                action: {
                  label: 'Undo',
                  onClick: () => {
                    store.restoreContact(contact.id)
                      .catch(() => toast('Could not restore. Check your connection', { icon: 'wifiOff' }));
                  },
                },
              });
            } catch (err) {
              console.error(err);
              toast('Could not delete. Check your connection', { icon: 'wifiOff' });
            }
          },
        }, 'Delete contact')
      );
    }

    /** "$12,000 · €3,600 per year" across this contact's active contracts. */
    function yearlyTotals(linked) {
      const totals = sortedTotals(annualByCurrency(linked.filter((c) => c.status === 'active')));
      if (!totals.length) return null;
      return el('p.card-sub', {},
        `${totals.map((t) => formatMoney(t.amount, t.currency)).join(DOT)} per year`);
    }

    function contactLine(ic, content) {
      return el('div.contact-line', { html: icon(ic, 16, 1.8) }, el('span.min0', {}, content));
    }

    renderDetail();
  }

  root.append(
    el('div.page-head', {},
      el('div', {},
        el('h1.page-title', {}, 'Contacts'),
        el('p.page-sub', {}, 'The people behind your agreements')
      ),
      el('button.btn.btn-primary.head-add', {
        html: icon('plus', 16, 2.2),
        onclick: () => openContactForm(),
      }, ' New contact')
    ),
    el('div.toolbar', {},
      el('div.search-wrap', { html: icon('search', 16, 2) }, search)
    ),
    listWrap
  );

  renderList();
  // Arrived from a contract's counterparty line: open that contact rather than
  // leaving someone to find the name they just tapped in a list of everyone.
  // A contact that has since been deleted just leaves the list showing.
  if (param && store.contactById(param)) openContactDetail(param);
  store.addEventListener('change', renderList);
  root.destroy = () => store.removeEventListener('change', renderList);
  return root;
}

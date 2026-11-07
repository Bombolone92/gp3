import { el, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store, searchContracts } from '../lib/store.js';
import { renewalInfo, needsAttention } from '../lib/dates.js';
import { contractRow, emptyState, renewalLine, rowSubtitle } from '../ui/bits.js';
import { openContractForm } from '../ui/contract-form.js';
import { debounce, joinDot } from '../lib/util.js';

const FILTERS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'active', label: 'Active', match: (c, info) => c.status === 'active' && info.phase !== 'expired' },
  { key: 'attention', label: 'Needs attention', match: (c, info) => needsAttention(c, info) },
  { key: 'draft', label: 'Drafts', match: (c) => c.status === 'draft' },
  { key: 'closed', label: 'Ended', match: (c, info) => c.status === 'terminated' || (c.status === 'active' && info.phase === 'expired') },
];

export function contractsView() {
  const root = el('div.view');
  let query = '';
  let filterKey = 'all';

  // Each keystroke rebuilds the whole list, which is the expensive half of a
  // search on a large book. Waiting for a pause in the typing turns a word into
  // one render instead of one per letter, and 120ms is under the threshold
  // where a filter starts to feel slow.
  const runSearch = debounce(() => { query = search.value; renderList(); }, 120);
  const search = el('input.input.search-input', {
    type: 'search', placeholder: 'Search contracts, contacts, tags',
    'aria-label': 'Search contracts',
    oninput: runSearch,
  });

  const chips = el('div.chip-row', { role: 'group', 'aria-label': 'Filter contracts' });
  const listWrap = el('div');

  function renderChips() {
    // Rebuilding drops focus; put keyboard users back on the active chip.
    const hadFocus = chips.contains(document.activeElement);
    clear(chips);
    for (const f of FILTERS) {
      chips.append(el('button.chip', {
        type: 'button',
        className: `chip${f.key === filterKey ? ' active' : ''}`,
        'aria-pressed': String(f.key === filterKey),
        onclick: () => { filterKey = f.key; renderChips(); renderList(); },
      }, f.label));
    }
    if (hadFocus) chips.querySelector('.chip.active')?.focus();
  }

  function renderList() {
    clear(listWrap);
    const contactsById = store.contactsById();
    const filter = FILTERS.find((f) => f.key === filterKey) || FILTERS[0];
    const matches = searchContracts(store.contracts, query, contactsById)
      .map((c) => ({ contract: c, info: renewalInfo(c) }))
      .filter(({ contract, info }) => filter.match(contract, info))
      .sort((a, b) => {
        // Soonest deadline first; undated after, newest first.
        const ad = a.info.daysLeft ?? Infinity;
        const bd = b.info.daysLeft ?? Infinity;
        return ad - bd || b.contract.updatedAt - a.contract.updatedAt;
      });

    if (!store.contracts.length) {
      listWrap.append(emptyState({
        icon: 'scroll',
        title: 'No contracts yet',
        sub: 'Add your first agreement to start tracking renewals and obligations.',
        action: el('button.btn.btn-primary', { onclick: () => openContractForm() }, 'Add a contract'),
      }));
      return;
    }
    if (!matches.length) {
      listWrap.append(emptyState({
        icon: 'search',
        title: 'Nothing matches',
        sub: 'Try a different search or filter.',
      }));
      return;
    }

    listWrap.append(el('div.card', {},
      el('div.list', {}, matches.map(({ contract, info }) => {
        // The map search already built, rather than a scan of every contact per
        // row: the two together were a full pass over the book for each row.
        const contact = contactsById.get(contract.contactId);
        // A live contract's line is its clock; a draft's or a closed one's is
        // its standing, the same words the dashboard rows use. Without the
        // second half an ended contract showed nothing but its counterparty,
        // as if it had no history to speak of.
        const standing = contract.status === 'active'
          ? renewalLine(contract, info) : rowSubtitle(contract, info);
        const bits = joinDot([contact ? (contact.company || contact.name) : null, standing]);
        return contractRow(contract, info, { sub: bits || 'No end date' });
      }))
    ));
  }

  function render() {
    renderChips();
    renderList();
  }

  root.append(
    el('div.page-head', {},
      el('div', {},
        el('h1.page-title', {}, 'Contracts'),
        el('p.page-sub', {}, 'Every agreement in one place')
      ),
      el('button.btn.btn-primary.head-add', {
        html: icon('plus', 16, 2.2),
        onclick: () => openContractForm(),
      }, ' New contract')
    ),
    el('div.toolbar', {},
      el('div.search-wrap', { html: icon('search', 16, 2) }, search),
      chips
    ),
    listWrap
  );

  render();
  store.addEventListener('change', render);
  root.destroy = () => store.removeEventListener('change', render);
  return root;
}

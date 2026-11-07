/**
 * Every obligation, across every contract, grouped by urgency.
 *
 * Obligations were a first-class concept that could only be worked one
 * contract at a time: there was nowhere to answer "what do I owe this week?"
 * or "what do they owe us?". This is that page.
 */

import { el, clear, preservingFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store, allObligations } from '../lib/store.js';
import { emptyState, obligationRow } from '../ui/bits.js';
import { toast } from '../ui/toast.js';
import { openObligationForm } from '../ui/obligation-form.js';
import { debounce } from '../lib/util.js';

const OWNER_FILTERS = [
  { key: 'all', label: 'Everyone', match: () => true },
  { key: 'us', label: 'Ours', match: (ob) => (ob.owner || 'us') === 'us' },
  { key: 'them', label: 'Theirs', match: (ob) => ob.owner === 'them' },
  { key: 'mutual', label: 'Mutual', match: (ob) => ob.owner === 'mutual' },
];

const GROUPS = [
  { key: 'overdue', title: 'Overdue', sub: 'Past their due date and still open' },
  { key: 'week', title: 'This week' },
  { key: 'month', title: 'This month' },
  { key: 'later', title: 'Later' },
  { key: 'undated', title: 'No due date', sub: 'Standing duties with no deadline attached' },
  { key: 'done', title: 'Completed' },
];

function groupOf({ obligation, daysLeft }) {
  if (obligation.done) return 'done';
  if (daysLeft === null) return 'undated';
  if (daysLeft < 0) return 'overdue';
  if (daysLeft <= 7) return 'week';
  if (daysLeft <= 31) return 'month';
  return 'later';
}

export function obligationsView() {
  const root = el('div.view');
  let query = '';
  let ownerKey = 'all';
  let showDone = false;

  const runSearch = debounce(() => { query = search.value; renderList(); }, 120);
  const search = el('input.input.search-input', {
    type: 'search', placeholder: 'Search obligations and contracts',
    'aria-label': 'Search obligations',
    oninput: runSearch,
  });

  const chips = el('div.chip-row', { role: 'group', 'aria-label': 'Filter obligations' });
  const listWrap = el('div');

  function renderChips() {
    // Rebuilding drops focus. There are two independent choices on this row —
    // whose duty, and whether completed ones show — so "the active chip" is
    // not one chip: putting focus there sent a keyboard user who had just
    // pressed Completed back to Everyone, four chips away. The position is
    // fixed, so that is what focus follows.
    const focused = [...chips.children].indexOf(document.activeElement);
    clear(chips);
    for (const f of OWNER_FILTERS) {
      chips.append(el('button.chip', {
        type: 'button',
        className: `chip${f.key === ownerKey ? ' active' : ''}`,
        'aria-pressed': String(f.key === ownerKey),
        onclick: () => { ownerKey = f.key; renderChips(); renderList(); },
      }, f.label));
    }
    // Completed items are out of the way but never hidden for good.
    chips.append(el('button.chip', {
      type: 'button',
      className: `chip${showDone ? ' active' : ''}`,
      'aria-pressed': String(showDone),
      html: icon('done', 13, 2.2),
      onclick: () => { showDone = !showDone; renderChips(); renderList(); },
    }, ' Completed'));
    if (focused > -1) chips.children[focused]?.focus();
  }

  function renderList() {
    clear(listWrap);
    const owner = OWNER_FILTERS.find((f) => f.key === ownerKey) || OWNER_FILTERS[0];
    const q = query.trim().toLowerCase();
    const entries = allObligations(store.contracts, { includeDone: showDone })
      .filter(({ contract, obligation }) => owner.match(obligation)
        && (!q || `${obligation.text} ${contract.title}`.toLowerCase().includes(q)));

    const anyAtAll = allObligations(store.contracts, { includeDone: true }).length > 0;
    if (!anyAtAll) {
      listWrap.append(emptyState({
        icon: 'checklist',
        title: 'No obligations yet',
        sub: 'Obligations are what each side owes: payments, deliverables, notices. Add them on a contract, or let AI read the agreement text and suggest them.',
        action: store.contracts.length
          ? el('a.btn.btn-primary', { href: '#/contracts' }, 'Pick a contract')
          : null,
      }));
      return;
    }
    if (!entries.length) {
      listWrap.append(emptyState({
        icon: 'search',
        title: 'Nothing matches',
        sub: showDone ? 'Try a different search or filter.' : 'Try a different search, or show completed ones.',
      }));
      return;
    }

    for (const g of GROUPS) {
      const members = entries.filter((e) => groupOf(e) === g.key);
      if (!members.length) continue;
      listWrap.append(el('section.card', {},
        el('div.card-head', {},
          el('div', {},
            el('h2.card-title', {}, `${g.title} (${members.length})`),
            g.sub && el('p.card-sub', {}, g.sub)
          )
        ),
        el('div.list', {}, members.map(({ contract, obligation }) =>
          obligationRow(contract, obligation, {
            withContract: true,
            onToggle: (done) => {
              store.setObligation(contract.id, obligation.id, { done })
                .catch(() => toast('Could not save. Check your connection', { icon: 'wifiOff' }));
            },
            onEdit: () => openObligationForm({ contract, obligation }),
            onDelete: () => removeObligation(contract, obligation),
          })))
      ));
    }
  }

  async function removeObligation(contract, obligation) {
    let removed;
    try {
      removed = await store.deleteObligation(contract.id, obligation.id);
    } catch {
      toast('Could not delete. Check your connection', { icon: 'wifiOff' });
      return;
    }
    if (!removed) return;
    toast('Obligation deleted', {
      icon: 'trash',
      action: {
        label: 'Undo',
        onClick: () => {
          store.restoreObligation(contract.id, removed.obligation, removed.index)
            .catch(() => toast('Could not restore. Check your connection', { icon: 'wifiOff' }));
        },
      },
    });
  }

  function render() {
    // Ticking a duty rebuilds this whole list from under the checkbox that
    // did it, so the keyboard has to be put back on it (or on whatever took
    // its place, when completing it moved it out of view).
    preservingFocus(root, () => { renderChips(); renderList(); }, { fallback: '.ob-check' });
  }

  root.append(
    el('div.page-head', {},
      el('div', {},
        el('h1.page-title', {}, 'Obligations'),
        el('p.page-sub', {}, 'What each side owes, across your active contracts')
      )
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

import { el, clear } from '../ui/dom.js';
import { store } from '../lib/store.js';
import { renewalInfo, formatDate, relativeDays, needsAttention } from '../lib/dates.js';
import { contractRow, emptyState, attentionLine } from '../ui/bits.js';
import { openDecisionSheet, decisionSummary } from '../ui/decision.js';

/**
 * The renewal timeline: every active contract with a clock, grouped by how
 * soon it lands. Groups appear only when they have members.
 */
const GROUPS = [
  { key: 'attention', title: 'Needs attention', sub: 'Waiting on a decision from you' },
  { key: 'decided', title: 'Decided', sub: 'Still coming up, but you have already said what happens' },
  { key: 'd30', title: 'Next 30 days' },
  { key: 'd90', title: '31 to 90 days' },
  { key: 'later', title: 'Later' },
  { key: 'evergreen', title: 'No end date', sub: 'Evergreen agreements with no renewal clock' },
];

function groupOf({ contract, info }) {
  if (needsAttention(contract, info)) return 'attention';
  if (info.handled) return 'decided';
  if (info.phase === 'evergreen') return 'evergreen';
  if (info.daysLeft === null) return null;
  if (info.daysLeft <= 30) return 'd30';
  if (info.daysLeft <= 90) return 'd90';
  return 'later';
}

export function renewalsView() {
  const root = el('div.view');
  const body = el('div');

  function render() {
    clear(body);
    const entries = store.contracts
      .filter((c) => c.status === 'active')
      .map((contract) => ({ contract, info: renewalInfo(contract) }))
      .sort((a, b) => (a.info.daysLeft ?? Infinity) - (b.info.daysLeft ?? Infinity));

    if (!entries.length) {
      body.append(emptyState({
        icon: 'calendar-clock',
        title: 'No active contracts',
        sub: 'Renewal deadlines show up here as soon as you add agreements with end dates.',
      }));
      return;
    }

    for (const g of GROUPS) {
      const members = entries.filter((e) => groupOf(e) === g.key);
      if (!members.length) continue;
      body.append(el('section.card', {},
        el('div.card-head', {},
          el('div', {},
            // Counted in the heading, the way the Obligations groups are: the
            // two pages group the same way and were read the same way, so a
            // count on one and not the other was the odd thing.
            el('h2.card-title', {}, `${g.title} (${members.length})`),
            g.sub && el('p.card-sub', {}, g.sub)
          )
        ),
        el('div.list', {}, members.map(({ contract, info }) => {
          const row = contractRow(contract, info, { sub: subtitleFor(contract, info) });
          // The decision belongs where the deadline is seen. A button inside
          // the row's link would be nested interactive content, so the
          // attention rows get their own wrapper with the action beside it.
          if (g.key !== 'attention') return row;
          return el('div.renewal-row', {},
            row,
            el('button.btn.btn-primary.btn-compact.renewal-decide', {
              onclick: () => openDecisionSheet(contract, info),
            }, 'Record decision')
          );
        }))
      ));
    }
  }

  function subtitleFor(contract, info) {
    if (info.handled) return decisionSummary(info);
    // The same words the dashboard uses for the same rows: both lists answer
    // "what is this one waiting on", so they should not answer differently.
    if (info.phase === 'expired' || info.phase === 'notice') return attentionLine(contract, info);
    if (info.phase === 'evergreen') return 'No end date';
    return `${contract.autoRenew ? 'Renews' : 'Expires'} ${formatDate(info.date)} (${relativeDays(info.daysLeft)})`;
  }

  root.append(
    el('div.page-head', {},
      el('div', {},
        el('h1.page-title', {}, 'Renewals'),
        el('p.page-sub', {}, 'Every deadline, soonest first')
      )
    ),
    body
  );

  render();
  store.addEventListener('change', render);
  root.destroy = () => store.removeEventListener('change', render);
  return root;
}

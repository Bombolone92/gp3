/**
 * The needs-attention list on a page of its own: the same card the dashboard
 * carries, in full, with the counts that say what is overdue and why it
 * matters to the numbers.
 */

import { el } from '../ui/dom.js';
import { viewHead, statTile } from '../ui/bits.js';
import { attentionCard } from '../ui/attention.js';
import { store } from '../lib/store.js';
import { attentionItems, dbAsOf } from '../lib/captable.js';
import { shares, moneyWhole } from '../lib/format.js';
import { todayISO } from '../lib/util.js';

export function attentionView() {
  const today = todayISO();
  /* Today's snapshot, the table the card below reads: read live, the tiles
     counted a future-dated cancellation as already made and read no items
     over a card listing one. */
  const items = attentionItems(dbAsOf(store.db, today), { asOf: today });
  const matured = items.filter((i) => i.type === 'note-matured');
  const missed = items.filter((i) => i.type === '83b-missed');

  // Expired warrants already leave dilution; only unresolved plan awards remain.
  const lapsed = items.filter((i) => ['grant-expired', 'rsu-departed', 'grant-departed'].includes(i.type));
  const stillDiluting = lapsed.reduce((a, i) => a + (i.quantity || 0), 0);
  const owed = matured.reduce((a, i) => a + (i.amount || 0), 0);

  return el('div', {},
    viewHead('Needs attention',
      'Records whose date has passed while the cap table still counts them as they were'),

    items.length
      ? el('div.stat-grid', {},
        statTile({
          label: 'Open items', icon: 'alert',
          value: String(items.length),
          sub: items.length === 1 ? 'One record to settle' : 'Records to settle',
        }),
        stillDiluting > 0
          ? statTile({
            label: 'Still diluting', icon: 'pie',
            value: shares(stillDiluting),
            sub: lapsed.every((i) => i.type === 'grant-expired')
              ? 'Expired, yet in the diluted base and drawn from the pool'
              : 'Expired or forfeited, yet in the fully diluted base',
          })
          : null,
        owed > 0
          ? statTile({
            label: 'Matured notes', icon: 'coins',
            value: moneyWhole(owed),
            sub: 'Principal plus interest at maturity',
          })
          : null,
        missed.length
          ? statTile({
            label: '83(b) windows closed', icon: 'clock',
            value: String(missed.length),
            sub: 'No election on file, unacknowledged',
          })
          : null)
      : null,

    attentionCard());
}

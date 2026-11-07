/** Safety recalls card for a vehicle, checked on demand. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, canEdit } from '../app.js';
import { fetchRecalls } from '../core/recalls.js';
import { formatDate } from '../core/dates.js';
import { pill } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { sectionCard } from './common.js';

const cache = new Map(); // year|make|model -> recalls, for this session

export function recallsCard(vehicleId) {
  const body = h('div.recalls');
  const btn = h('button.btn.sm', { type: 'button', onClick: () => check(true) }, icon('refresh', 15), 'Check');
  const card = sectionCard('Safety recalls', body, { actions: btn });
  const key = (v) => `${v.year}|${String(v.make).toLowerCase()}|${String(v.model).toLowerCase()}`;

  async function check(force = false) {
    const v = app.store.get('vehicles', vehicleId);
    if (!v) return;
    if (!v.year || !v.make || !v.model) {
      body.replaceChildren(h('p.mini-empty', 'Add the year, make, and model to check this vehicle for open safety recalls.'));
      return;
    }
    let list = cache.get(key(v));
    if (!list) {
      if (!force) {
        body.replaceChildren(h('p.mini-empty', 'Check the US safety recall database for this year, make, and model.'));
        return;
      }
      btn.disabled = true;
      body.replaceChildren(h('p.mini-empty', 'Checking...'));
      try {
        list = await fetchRecalls(v);
        cache.set(key(v), list);
      } catch (err) {
        body.replaceChildren(h('p.mini-empty', err.message));
        return;
      } finally {
        btn.disabled = false;
      }
    }
    draw(v, list);
  }

  function draw(v, list) {
    const done = v.recallsDone || {};
    if (!list.length) return body.replaceChildren(h('p.mini-empty', `No recalls found for the ${v.year} ${v.make} ${v.model}.`));
    const open = list.filter((r) => !done[r.campaign]).length;
    body.replaceChildren(
      h('p.recall-note', open ? `${open} recall${open === 1 ? '' : 's'} not marked as completed. Recalls apply to the model; check the VIN with the manufacturer to confirm this vehicle is affected.` : 'All recalls are marked as completed.'),
      h(
        'ul.recall-list',
        list.map((r) =>
          h(
            'li',
            h(
              'details.recall',
              h('summary', h('span.grow', h('strong', r.component || 'Recall'), h('span.cell-sub', `Campaign ${r.campaign}${r.date ? ` · ${formatDate(r.date)}` : ''}`)), done[r.campaign] ? pill('Completed', 'green') : r.parkIt ? pill('Do not drive', 'red') : pill('Open', 'orange')),
              h('div.recall-body', r.summary ? h('p', r.summary) : null, r.consequence ? h('p', h('strong', 'Risk: '), r.consequence) : null, r.remedy ? h('p', h('strong', 'Remedy: '), r.remedy) : null,
                canEdit('vehicles')
                  ? h('button.btn.sm', { type: 'button', onClick: () => {
                      const next = { ...(app.store.get('vehicles', vehicleId).recallsDone || {}) };
                      if (next[r.campaign]) delete next[r.campaign];
                      else next[r.campaign] = app.today();
                      app.store.patch('vehicles', vehicleId, { recallsDone: next });
                      toast(next[r.campaign] ? 'Recall marked as completed' : 'Recall marked as open');
                      draw(app.store.get('vehicles', vehicleId), list);
                    } }, done[r.campaign] ? 'Mark as open' : 'Mark as completed')
                  : null),
            ),
          ),
        ),
      ),
    );
  }

  check(false);
  return card;
}

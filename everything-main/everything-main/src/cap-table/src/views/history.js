import { el } from '../ui/dom.js';
import { field, viewHead } from '../ui/bits.js';
import { openModal } from '../ui/modal.js';
import { store } from '../lib/store.js';
import { auditCSV, auditActionLabel } from '../lib/audit.js';
import { downloadFile } from '../lib/util.js';
import { countLabel, dateLong } from '../lib/format.js';

/* A transaction's outcome in the user's words. The journal's own names
   (compensated, pending) say what the protocol did; the reader wants to know
   whether the change stood. */
const OUTCOMES = {
  completed: 'Completed', pending: 'In progress', compensating: 'Rolling back', compensated: 'Rolled back', rejected: 'Rejected',
};
const outcomeLabel = (status) => OUTCOMES[status] || OUTCOMES.pending;
const ACTIONS = { create: 'Created', update: 'Updated', delete: 'Deleted' };
const COLLECTIONS = {
  company: 'company', classes: 'share class', stakeholders: 'stakeholder', securities: 'security',
  scenarios: 'round scenario', exits: 'exit scenario', hiring: 'hiring plan',
};
/** 'Sep 9, 2026, 12:37 PM UTC': the app's date form with the time, since a
 * journal line is a moment, not a day. In UTC, the zone the "Recorded from"
 * filters read: shown in local time, a line recorded at 02:00 UTC read as
 * the evening before west of Greenwich and then fell outside a filter set
 * to that evening's date. */
function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso ?? '');
  return `${d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })} UTC`;
}
const effective = (entry) => (entry.effectiveDate ? dateLong(entry.effectiveDate)
  : entry.effectiveDates?.length ? 'several dates' : 'not specified');
const show = (value) => (value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value));

/**
 * One record's change as a table: the fields that differ for an update, every
 * recorded field for a create or a delete. The whole record as JSON stays
 * underneath for anyone who needs the exact bytes - a diff of two records
 * printed in full asked the reader to find the one changed line themselves.
 */
function changeTable(change) {
  const before = change.before || {}, after = change.after || {};
  const update = change.action === 'update';
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !update || JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  if (!keys.length) return el('p.small.muted', {}, 'Nothing recorded differs.');
  const record = change.after || change.before;
  return el('div.table-wrap.history-table', {
    tabindex: 0, role: 'region', 'aria-label': `${ACTIONS[change.action] || change.action} ${change.label}: fields`,
  }, el('table.data', {},
    el('thead', {}, el('tr', {}, el('th', {}, 'Field'),
      update ? [el('th', {}, 'Before'), el('th', {}, 'After')] : el('th', {}, 'Value'))),
    el('tbody', {}, keys.map((key) => el('tr', {}, el('td', {}, key),
      update ? [el('td', {}, show(before[key])), el('td', {}, show(after[key]))] : el('td', {}, show(record[key])))))));
}

/** A bounded page is read on demand; large before/after payloads load on click. */
export function historyView() {
  const companyId = store.activeCompanyId;
  const query = new URLSearchParams((location.hash.split('?')[1] || ''));
  const list = el('div');
  const status = el('p.small.muted', { role: 'status' });
  const record = el('input.input', { value: query.get('record') || '', placeholder: 'Record or stakeholder ID' });
  const actor = el('input.input', { placeholder: 'Name or account ID' });
  const operation = el('input.input', { placeholder: 'Action, e.g. exercise' });
  const transaction = el('input.input', { value: query.get('transaction') || '', placeholder: 'Transaction ID' });
  const from = el('input.input', { type: 'date' }), to = el('input.input', { type: 'date' });
  let cursor, generation = 0, busy = false;
  const active = () => store.activeCompanyId === companyId && root.isConnected;
  const filtered = () => [record, actor, operation, transaction, from, to].some((input) => input.value.trim());
  const more = el('button.btn.btn-ghost', { type: 'button', hidden: true, onclick: () => load(false) }, 'Load more');
  const showError = (err) => { status.textContent = err.message || 'Could not load history. Check your connection and retry.'; };

  async function detail(entry) {
    try {
      const event = await store.auditDetail(entry.id);
      if (!active()) return;
      const content = el('div', {},
        el('p', {}, `${outcomeLabel(entry.outcome?.status)} · Recorded ${when(entry.recordedAt)} · ${entry.actor?.name || 'Unknown actor'}`),
        el('p.small.muted', {}, 'Transaction ', el('span.history-id', {}, entry.id)),
        el('p', {}, entry.explanation || 'No explanation recorded.'),
        entry.operation === 'baseline' ? el('p', {}, 'This is the first observed state. Earlier actors and changes are unknown.') : null,
        event.legacyActivity?.length ? el('details.card.history-change', {},
          el('summary', {}, 'Legacy activity (incomplete)'),
          event.legacyActivity.map((line) => el('p.small', {}, `${when(line.at)} · ${line.text}`))) : null,
        event.sourceArchive ? el('div.card.history-change', {},
          el('p', {}, `This import includes ${countLabel(event.sourceArchive.events.length, 'historical event')} from company ${show(event.sourceArchive.companyId)}. They are source records, not newly verified actions in this company.`),
          el('button.btn.btn-ghost', { type: 'button', onclick: () => downloadFile(`source-history-${entry.id}.json`,
            JSON.stringify(event.sourceArchive, null, 2), 'application/json') }, 'Download source history')) : null,
        event.changes.map((change) => el('details.card.history-change', { open: event.changes.length <= 3 },
          el('summary', {}, `${ACTIONS[change.action] || change.action} ${change.label} `,
            el('span.kind-pill', {}, COLLECTIONS[change.field] || change.field)),
          el('p.small.muted', {}, `Record ${change.recordId} · Effective ${change.effectiveDate ? dateLong(change.effectiveDate) : 'not specified'}`),
          changeTable(change),
          el('details.history-json', {},
            el('summary.small.muted', {}, 'Full record as JSON'),
            el('div.form-grid', {},
              el('div', {}, el('h3', {}, 'Before'), el('pre', {}, JSON.stringify(change.before, null, 2))),
              el('div', {}, el('h3', {}, 'After'), el('pre', {}, JSON.stringify(change.after, null, 2))))))));
      openModal({ title: auditActionLabel(entry.operation), content, wide: true });
    } catch (err) { if (active()) showError(err); }
  }
  async function load(reset = true) {
    if (busy && !reset) return;
    const request = ++generation;
    busy = true; more.disabled = true;
    if (reset) { cursor = undefined; list.replaceChildren(); }
    status.textContent = 'Loading history…';
    try {
      const result = await store.auditPage({ cursor, record: record.value.trim(), actor: actor.value.trim(),
        operation: operation.value.trim(), transaction: transaction.value.trim(), from: from.value, to: to.value });
      if (!active() || request !== generation) return;
      for (const entry of result.entries) {
        const label = auditActionLabel(entry.operation);
        list.append(el('article.card.history-entry', {},
          el('div.row.history-entry-head', {},
            el('strong', {}, label), el('span.kind-pill', {}, outcomeLabel(entry.outcome?.status))),
          el('p.small.muted', {}, `Recorded ${when(entry.recordedAt)} · ${entry.actor?.name || 'Unknown actor'} · ${countLabel(entry.changeCount, 'changed record')}`),
          el('p.small', {}, `Effective ${effective(entry)}`),
          entry.explanation ? el('p', {}, entry.explanation) : null,
          el('div.row.history-entry-foot', {},
            el('button.btn.btn-ghost', {
              type: 'button', 'aria-label': `View changes: ${label}, ${when(entry.recordedAt)}`, onclick: () => detail(entry),
            }, 'View changes'),
            el('span.small.muted.history-id', {}, entry.id))));
      }
      cursor = result.cursor;
      more.hidden = !cursor;
      if (!list.childElementCount) {
        status.textContent = cursor ? 'No matches on this page. Load more to continue searching.'
          : filtered() ? 'No recorded changes match these filters.'
            : 'Nothing has been recorded yet. The first change to this company starts its history.';
      } else {
        status.textContent = cursor ? 'Older history is available.' : 'That is the whole recorded history.';
      }
    } catch (err) { if (active() && request === generation) showError(err); }
    finally { if (request === generation) { busy = false; more.disabled = false; } }
  }
  async function exportHistory(format, button) {
    button.disabled = true;
    status.textContent = 'Preparing the complete history…';
    try {
      const archive = await store.exportAudit({
        onProgress: ({ read, loaded, total }) => {
          if (active()) status.textContent = loaded ? `Preparing ${loaded} of ${total} entries…` : `Reading the index: ${read} of ${total} entries…`;
        },
      });
      if (!active()) return;
      downloadFile(`cap-table-audit-${companyId}.${format}`, format === 'json' ? JSON.stringify(archive, null, 2) : auditCSV(archive),
        format === 'json' ? 'application/json' : 'text/csv');
      status.textContent = 'Complete history exported, including outcomes and original values.';
    } catch (err) { if (active()) showError(err); }
    finally { button.disabled = false; }
  }
  const exports = ['json', 'csv'].map((format) => el('button.btn.btn-ghost', {
    type: 'button', onclick: (e) => exportHistory(format, e.currentTarget),
  }, `Export ${format.toUpperCase()}`));
  const root = el('div', {}, viewHead('History', 'Who changed what, with the original values and transaction outcomes.'),
    el('p.small.muted', {}, 'The initial baseline marks the start of complete history. Earlier activity is incomplete. Exports include the entire history, regardless of filters.'),
    el('form.card.history-filters', { onsubmit: (e) => { e.preventDefault(); load(); } },
      el('div.form-grid', {}, field('Record', record), field('Actor', actor), field('Action', operation), field('Transaction', transaction),
        field('Recorded from (UTC)', from), field('Recorded through (UTC)', to)),
      el('div.row', { style: { flexWrap: 'wrap' } }, el('button.btn.btn-primary', { type: 'submit' }, 'Apply filters'), exports)),
    list, status, more);
  load();
  return root;
}

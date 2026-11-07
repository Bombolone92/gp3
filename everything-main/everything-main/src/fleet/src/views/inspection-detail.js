import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup, canEdit, canDelete } from '../app.js';
import { navigate } from '../ui/router.js';
import { vehicleName, formatDuration, formatDecimal } from '../core/format.js';
import { formatDate, formatTime } from '../core/dates.js';
import { pill, statusPill } from '../ui/components.js';
import { detailHeader, sectionCard, vehicleCell, emptyPage, moreMenuButton, meterText, deleteWithUndo, loadImage, commentsPanel } from './common.js';
import { fileUrl } from '../files.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  if (!store.get('inspections', id)) return emptyPage('Inspection not found', 'It may have been deleted.');
  const node = ctx.live(() => {
    const s = store.get('inspections', id);
    if (!s) return null;
    const v = lookup.vehicle(s.vehicleId);
    const form = store.get('inspectionForms', s.formId);
    const results = s.results || [];
    const passed = results.filter((r) => r.pass === true).length;
    const failed = results.filter((r) => r.pass === false);
    const dur = s.startedAt && s.submittedAt ? (new Date(s.submittedAt) - new Date(s.startedAt)) / 1000 : null;
    const issueFor = (r) => (s.issueIds || []).map((iid) => store.get('issues', iid)).find((i) => i?.source?.itemId === r.itemId);
    // Group results under their section headings from the form, when known.
    const sections = [];
    let cur = { title: null, rows: [] };
    const byItem = new Map(results.map((r) => [r.itemId, r]));
    if (form) {
      for (const it of form.items || []) {
        if (it.type === 'section') {
          if (cur.rows.length || cur.title) sections.push(cur);
          cur = { title: it.label, rows: [] };
        } else if (byItem.has(it.id)) {
          cur.rows.push(byItem.get(it.id));
          byItem.delete(it.id);
        }
      }
    }
    // Items removed from the form since get their own group, not the
    // last section of the current form.
    if (form && byItem.size) {
      if (cur.rows.length) sections.push(cur);
      cur = { title: 'No longer on the form', rows: [] };
    }
    cur.rows.push(...byItem.values());
    sections.push(cur);

    return h(
      'div',
      detailHeader({
        back: { label: 'Inspection history', href: '#/inspections' },
        title: `${s.formName}`,
        sub: `${vehicleName(v)} · ${formatDate(s.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${s.submittedAt ? ` at ${formatTime(new Date(s.submittedAt).toTimeString().slice(0, 5))}` : ''}`,
        meta: [failed.length ? pill(`${failed.length} failed`, 'red') : pill('All passed', 'green'), vehicleCell(s.vehicleId, { sub: false }), s.by ? h('span.row.gap-4', icon('user', 14), s.by) : null, dur ? h('span.row.gap-4', icon('timer', 14), formatDuration(dur)) : null, s.meter != null ? h('span.row.gap-4', icon('gauge', 14), meterText(s.meter, v)) : null],
        actions: [
          h('button.btn', { type: 'button', onClick: () => print() }, icon('printer', 15), 'Print'),
          canEdit('inspections') ? h('a.btn.primary', { href: `#/inspections/start?vehicle=${s.vehicleId}&form=${s.formId}` }, icon('clipboard-check', 15), 'Inspect again') : null,
          canDelete('inspections') ? moreMenuButton([{ label: 'Delete inspection', icon: 'trash', danger: true, run: () => deleteWithUndo('inspections', s, { label: 'inspection', message: 'Issues it opened are kept.', meterSource: 'inspection', onDeleted: () => navigate('/inspections') }) }]) : null,
        ],
      }),
      h('div.metric-row.card.insp-summary', metric('Items', results.length), metric('Passed', passed, 'green'), metric('Failed', failed.length, failed.length ? 'red' : null), metric('Pass rate', results.filter((r) => r.pass !== null).length ? `${formatDecimal((passed / results.filter((r) => r.pass !== null).length) * 100, 0)}%` : '-')),
      ...sections.map((sec) =>
        h(
          'section.card.panel.insp-result-card',
          { 'aria-label': sec.title || 'Results' },
          sec.title ? h('div.card-head', h('h2.grow', sec.title)) : null,
          h(
            'ul.result-list',
            sec.rows.map((r) => {
              const issue = issueFor(r);
              return h(
                `li.result-row${r.pass === false ? '.failed' : ''}`,
                h(`span.result-icon${r.pass === false ? '.bad' : r.pass === true ? '.good' : ''}`, icon(r.pass === false ? 'circle-x' : r.pass === true ? 'circle-check' : 'circle-dot', 18)),
                h(
                  'div.grow',
                  h('div.result-label', r.label),
                  r.note ? h('p.result-note', r.note) : null,
                  r.photos?.length ? h('ul.insp-photos', r.photos.map((p) => { const t = h('span.photo-thumb', icon('image', 16)); loadImage(t, p); return h('li', h('button.photo-btn', { type: 'button', 'aria-label': `Open photo for ${r.label}`, onClick: () => fileUrl(p).then((u) => window.open(u, '_blank', 'noopener')) }, t)); })) : null,
                  issue ? h('a.result-issue', { href: `#/issues/${issue.id}` }, icon('warning', 14), `Issue #${issue.number}`, statusPill('issue', issue.status)) : null,
                ),
                h('span.result-value', valueText(r, v)),
              );
            }),
          ),
        ),
      ),
    );
  }, ['inspections', 'issues', 'vehicles', 'inspectionForms']);
  return { node: h('div.page.detail-page.narrow-page.wide-ish', node, commentsPanel('inspections', id)), title: 'Inspection' };
}

function valueText(r, v) {
  if (r.type === 'passfail') return r.value === 'pass' ? 'Pass' : r.value === 'fail' ? 'Fail' : 'Not answered';
  if (r.type === 'meter') return r.value != null ? meterText(r.value, v) : 'Not answered';
  if (r.type === 'signature') return r.value ? 'Signed' : 'Not signed';
  if (r.type === 'photo') return r.photos?.length ? `${r.photos.length} photo${r.photos.length === 1 ? '' : 's'}` : 'No photos';
  if (r.type === 'date' && r.value) return formatDate(r.value);
  return r.value === null || r.value === undefined || r.value === '' ? 'Not answered' : String(r.value);
}

function metric(label, value, tone) {
  return h(`div.metric${tone ? '.tone-' + tone : ''}`, h('span.metric-label', label), h('span.metric-value', String(value)));
}

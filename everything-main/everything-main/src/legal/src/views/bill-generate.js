/** New bills: pick a period and filters, review matters with unbilled work, generate drafts. */
import '../styles/billing.css';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup, meId } from '../app.js';
import { pageHeader, textInput, select, field, emptyState, spinner } from '../ui/components.js';
import { navigate, setQuery } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { contactPicker, matterLink, contactLink, userChip } from './common.js';
import { draftBill, billTotals } from '../core/finance.js';
import { billableMatters } from '../core/billing-ops.js';
import { formatMoney } from '../core/money.js';
import { formatHoursDecimal } from '../core/duration.js';
import { practiceAreaName } from '../core/settings.js';

export function render(ctx) {
  const store = app.store;
  const s = () => app.settings();
  const preset = ctx.query.matter ? store.get('matters', ctx.query.matter) : null;
  const state = {
    from: ctx.query.from || '',
    to: ctx.query.to || app.today(),
    clientId: preset?.clientId || '',
    matterId: preset?.id || '',
    resp: '',
    area: '',
    selected: new Set(),
    touched: false,
    busy: false,
  };

  const fromI = textInput({ name: 'from', type: 'date', value: state.from });
  const toI = textInput({ name: 'to', type: 'date', value: state.to });
  const client = contactPicker({
    name: 'client',
    value: state.clientId,
    label: 'Client',
    placeholder: 'All clients',
    allowCreate: false,
    onChange: (v) => {
      state.clientId = v;
      showAllMatters();
    },
  });
  const respSel = select({ name: 'resp', value: '', options: [{ value: '', label: 'Anyone' }, ...lookup.activeUsers().map((u) => ({ value: u.id, label: u.name }))] });
  const areaSel = select({ name: 'area', value: '', options: [{ value: '', label: 'All practice areas' }, ...s().practiceAreas.map((p) => ({ value: p.id, label: p.name }))] });
  fromI.addEventListener('change', () => ((state.from = fromI.value), setQuery({ from: state.from }), redraw()));
  toI.addEventListener('change', () => ((state.to = toI.value), setQuery({ to: state.to }), redraw()));
  respSel.addEventListener('change', () => ((state.resp = respSel.value), redraw()));
  areaSel.addEventListener('change', () => ((state.area = areaSel.value), redraw()));

  const listNode = h('div');
  const summary = h('div.gen-summary', { role: 'status', 'aria-live': 'polite' });
  const genBtn = h('button.btn.primary', { type: 'button', onClick: generate });

  function candidates() {
    const matters = store.all('matters').filter((m) => {
      if (m.billing?.billable === false) return false;
      if (m.billing?.method === 'contingency' && !state.matterId) return false;
      if (state.matterId && m.id !== state.matterId) return false;
      if (state.clientId && m.clientId !== state.clientId) return false;
      if (state.resp && m.responsibleId !== state.resp) return false;
      if (state.area && m.practiceAreaId !== state.area) return false;
      return true;
    });
    return billableMatters({ matters, activities: store.all('activities'), from: state.from, to: state.to }).sort((a, b) => b.total - a.total);
  }

  function redraw() {
    const list = candidates();
    const ids = new Set(list.map((r) => r.matter.id));
    if (!state.touched) {
      state.selected = new Set(ids);
    } else for (const id of [...state.selected]) if (!ids.has(id)) state.selected.delete(id);
    const all = h('input', { type: 'checkbox', 'aria-label': 'Select all matters', checked: list.length > 0 && state.selected.size === list.length });
    all.indeterminate = state.selected.size > 0 && state.selected.size < list.length;
    all.addEventListener('change', () => {
      state.touched = true;
      state.selected = all.checked ? new Set(ids) : new Set();
      redraw();
    });
    if (!list.length) {
      listNode.replaceChildren(
        emptyState({
          icon: 'receipt-text',
          title: 'Nothing to bill',
          text:
            state.from && state.to && state.from > state.to
              ? 'The “Work from” date is after the “Work through” date. Change one of them to choose a period.'
              : 'No matters have unbilled time, expenses, or flat fees for this period and these filters.',
          headingLevel: 2,
        }),
      );
    } else {
      listNode.replaceChildren(
        h(
          'div.table-wrap-x',
          h(
            'table.table-plain.gen-table',
            h('caption.sr-only', 'Matters ready to bill'),
            h(
              'thead',
              h(
                'tr',
                h('th.dt-check', all),
                h('th', 'Matter'),
                h('th', 'Client'),
                h('th', 'Responsible'),
                h('th.r', 'Hours'),
                h('th.r', 'Time'),
                h('th.r', 'Expenses'),
                h('th.r', 'Flat fees'),
                h('th.r', 'Total'),
              ),
            ),
            h(
              'tbody',
              list.map((r) => {
                const cb = h('input', { type: 'checkbox', checked: state.selected.has(r.matter.id), 'aria-label': `Bill ${r.matter.displayNumber}` });
                cb.addEventListener('change', () => {
                  state.touched = true;
                  if (cb.checked) state.selected.add(r.matter.id);
                  else state.selected.delete(r.matter.id);
                  redraw();
                });
                return h(
                  'tr',
                  h('td.dt-check', cb),
                  h('td', matterLink(r.matter.id), h('div.subtle.small', practiceAreaName(s(), r.matter.practiceAreaId))),
                  h('td', contactLink(r.matter.clientId)),
                  h('td', userChip(r.matter.responsibleId)),
                  h('td.r.num', formatHoursDecimal(r.minutes, 1)),
                  h('td.r.num', formatMoney(r.time)),
                  h('td.r.num', formatMoney(r.expenses)),
                  h('td.r.num', formatMoney(r.flat)),
                  h('td.r.num.strong', formatMoney(r.total)),
                );
              }),
            ),
          ),
        ),
      );
    }
    const chosen = list.filter((r) => state.selected.has(r.matter.id));
    const total = chosen.reduce((n, r) => n + r.total, 0);
    summary.replaceChildren(h('span', h('strong', String(chosen.length)), ` of ${list.length} matters selected`), h('span', 'Total ', h('strong', formatMoney(total))));
    genBtn.disabled = !chosen.length || state.busy;
    genBtn.replaceChildren(state.busy ? spinner(16) : icon('receipt-text', 16), chosen.length ? `Generate ${chosen.length} draft ${chosen.length === 1 ? 'bill' : 'bills'}` : 'Generate bills');
  }

  async function generate() {
    const chosen = candidates().filter((r) => state.selected.has(r.matter.id));
    if (!chosen.length || state.busy) return;
    state.busy = true;
    redraw();
    let made = 0;
    let total = 0;
    try {
      for (const r of chosen) {
        // Draft before drawing a number, so a matter with nothing left to
        // bill doesn't leave a gap in the bill numbers. The draft is made
        // again after the wait, from the work still unbilled by then.
        const draft = () =>
          draftBill({
            matter: store.get('matters', r.matter.id),
            activities: store.all('activities'),
            settings: s(),
            number: 0,
            issueDate: app.today(),
            from: state.from,
            to: state.to,
            userId: r.matter.responsibleId || meId(),
          });
        if (!draft()) continue;
        const number = await store.nextNumber('bills');
        const out = draft();
        if (!out) continue;
        out.bill.number = number;
        // Dated automatically: issuing it later re-dates it to that day.
        out.bill.autoDates = true;
        const bill = store.put('bills', out.bill);
        for (const id of out.activityIds) store.patch('activities', id, { billId: bill.id });
        if (out.bill.lines.some((l) => l.kind === 'flat' && !l.activityId)) store.patch('matters', r.matter.id, (cur) => ({ ...cur, billing: { ...cur.billing, flatFeeBilled: true } }));
        made++;
        total += billTotals(bill).total;
      }
    } finally {
      state.busy = false;
    }
    if (!made) {
      redraw();
      return toast('Nothing was billed. The work may have been billed in the meantime.', { type: 'info' });
    }
    toast(`${made} draft ${made === 1 ? 'bill' : 'bills'} created for ${formatMoney(total)}. Review and approve them next.`);
    navigate('/billing?status=draft');
  }

  /** Drop the matter the screen was opened for (when choosing a client, or on request). */
  function showAllMatters() {
    state.matterId = '';
    if (presetField) presetField.hidden = true;
    setQuery({ matter: '' });
    redraw();
  }

  const presetField = preset
    ? h(
        'div.field',
        h('span.field-label', 'Matter'),
        h(
          'div.gen-preset',
          matterLink(preset.id),
          h(
            'button.link-btn',
            { type: 'button', onClick: showAllMatters },
            'Show all matters',
          ),
        ),
      )
    : null;

  redraw();
  ctx.watch(['activities', 'matters', 'bills'], redraw);

  return {
    title: 'New bills',
    node: h(
      'div.page',
      pageHeader({
        title: 'New bills',
        crumbs: [{ label: 'Billing', href: '#/billing' }, { label: 'New bills' }],
        subtitle: 'Bills are created as drafts from unbilled time, expenses, and flat fees. Nothing is sent to clients until you issue them.',
      }),
      h(
        'section.card',
        { 'aria-label': 'Billing period and filters' },
        h(
          'div.card-body.gen-filters',
          field('Work from', fromI, { hint: 'Leave empty to include all earlier work' }),
          field('Work through', toI),
          presetField,
          field('Client', client),
          field('Responsible lawyer', respSel),
          field('Practice area', areaSel),
        ),
      ),
      h('section.card.list-card', { 'aria-label': 'Matters ready to bill' }, listNode, h('div.gen-foot', summary, h('div.spacer'), h('a.btn', { href: '#/billing' }, 'Cancel'), genBtn)),
    ),
  };
}

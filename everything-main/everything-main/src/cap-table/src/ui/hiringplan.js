/**
 * The hiring plan, and what it does to the option pool.
 *
 * `poolRemaining` answers what is left today and the round model tops the pool
 * up to a target percentage, and nothing connected the two - so the question a
 * founder actually has ("does the pool cover the next year of hiring, and if
 * not, how big a top-up does the round need to carry?") lived in a spreadsheet
 * beside the app, and the percentage typed into the round model was a guess
 * made in that spreadsheet.
 *
 * A planned grant is a forecast, never a record: it has its own collection, it
 * never becomes a security on its own, and nothing here counts on the cap
 * table, in the diluted base, or against the pool draw.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { field, flagInvalid, segmented, emptyState } from './bits.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { openSecurityForm } from './securityform.js';
import { monthField } from './monthpicker.js';
import { store, isRefusal, HIRING_HEADCOUNT_MAX } from '../lib/store.js';
import {
  poolForecast, plannedShares, fullyDiluted, POOL_FORECAST_MONTHS, plansOf, planIsOpen, planAccepts, planBalances,
  countsInDiluted, securityDate,
} from '../lib/captable.js';
import { planOptionLabel } from './planform.js';
import { shares, percentValue, monthLabel, amountValue } from '../lib/format.js';
import { parseNum, todayISO } from '../lib/util.js';
import { monthColumns, monthAxis } from '../charts/months.js';

/** The plan a planned grant draws from when its row names none: the most recently adopted open plan. */
export function defaultPlan(plans = plansOf(store.company).filter((p) => planIsOpen(p) && planAccepts(p, 'option'))) {
  return [...plans].sort((a, b) => (b.adopted || '').localeCompare(a.adopted || ''))[0] || null;
}

/** 'YYYY-MM' for a month input's default: the month after this one. */
function nextMonth(from = todayISO()) {
  const [y, m] = from.slice(0, 7).split('-').map(Number);
  const month = m === 12 ? 1 : m + 1;
  const year = m === 12 ? y + 1 : y;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** One planned role: what it is, how many, how big, and when it starts. */
export function openHireForm(existing = null) {
  const roleInput = el('input.input', {
    type: 'text', value: existing?.role || '', maxlength: 80,
    placeholder: 'Senior engineer', 'aria-label': 'Role',
  });
  const countInput = el('input.input', {
    type: 'text', inputmode: 'numeric', value: existing?.headcount ?? 1,
    'aria-label': 'How many hires',
  });
  /* A real month picker in every browser - see monthField.

     A stored row shows exactly what it holds, an empty month included. The
     default is for a role being planned afresh: falling back to it whenever
     the stored month was blank put next month into the picker of every
     unscheduled role, so renaming one - or fixing its share count - saved it
     scheduled for a month nobody chose, and the pool forecast moved with it. */
  const monthPick = monthField({ value: existing ? existing.startMonth : nextMonth(), label: 'Starts' });

  let sizeMode = existing?.sizeMode === 'pct' ? 'pct' : 'shares';
  const sharesInput = el('input.input', {
    type: 'text', inputmode: 'numeric',
    value: existing?.sizeMode === 'shares' && existing.shares > 0 ? amountValue(existing.shares) : '',
    placeholder: '25,000', 'aria-label': 'Shares per hire',
  });
  const pctInput = el('input.input', {
    type: 'text', inputmode: 'decimal',
    /* At its stored precision: rounded to two decimals, a 0.125% row opened
       as 0.13 and any unrelated edit (a rename, a headcount) saved the
       rounded figure back, moving every hire's shares with it. */
    value: existing?.sizeMode === 'pct' ? String(Number(((existing.pct || 0) * 100).toPrecision(10))) : '',
    placeholder: '0.25', 'aria-label': 'Percent of fully diluted per hire',
  });
  const fd = fullyDiluted(store.securities, store.company);
  /* The register as it stands, records dated ahead included: the dashboard
     and cap table count those from their dates, so "today's" figure here
     was not today's when a grant or certificate was dated ahead. */
  const ahead = store.securities.filter((s) => countsInDiluted(s) && securityDate(s) > todayISO()).length;
  const sharesField = field('Shares per hire', sharesInput);
  /* The plan the grants are expected to come from, once there is more than
     one to choose between. A row saved with none draws the default
     destination - the most recently adopted open plan - and says so. */
  const plans = plansOf(store.company).filter((p) => planIsOpen(p) && planAccepts(p, 'option'));
  const planSelect = plans.length > 1 ? el('select.select', { 'aria-label': 'Plan' },
    el('option', { value: '', selected: !existing?.planId }, `Default plan (${defaultPlan(plans)?.name || 'none'})`),
    plans.map((p) => el('option', { value: p.id, selected: p.id === existing?.planId }, planOptionLabel(p)))) : null;
  const pctField = field('Percent per hire (%)', pctInput,
    fd > 0
      ? `Measured against the ${shares(fd)} fully diluted shares on record`
        + (ahead ? `, ${ahead === 1 ? 'one dated after today included' : `${ahead} dated after today included`}` : '')
      : null);
  const sizeSeg = segmented([
    { value: 'shares', label: 'Share count' },
    { value: 'pct', label: 'Percentage' },
  ], {
    label: 'How the grant is sized', value: sizeMode, wide: true,
    onSelect: (value) => {
      sizeMode = value;
      sharesField.style.display = value === 'shares' ? '' : 'none';
      pctField.style.display = value === 'pct' ? '' : 'none';
    },
  });
  sharesField.style.display = sizeMode === 'shares' ? '' : 'none';
  pctField.style.display = sizeMode === 'pct' ? '' : 'none';

  const saveBtn = el('button.btn.btn-primary.btn-block', { type: 'submit', style: { padding: '12px' } },
    existing ? 'Save role' : 'Add role');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const invalid = (control, message) => {
        flagInvalid(control, message);
        control.focus();
        toast(message, { icon: 'alert' });
      };
      if (!roleInput.value.trim()) return invalid(roleInput, 'Give the role a name');
      const headcount = parseNum(countInput.value) ?? 0;
      if (!(headcount >= 1)) return invalid(countInput, 'Enter how many people you plan to hire');
      /* The plan stores whole hires and whole shares, and rounded a fraction
         on the way in: "2.5" hires became 3, under a toast saying the role
         was added as typed. */
      if (!Number.isInteger(headcount)) return invalid(countInput, 'Hires come in whole numbers');
      if (headcount > HIRING_HEADCOUNT_MAX) {
        return invalid(countInput, `Plan at most ${shares(HIRING_HEADCOUNT_MAX)} hires per role. Split a larger one into two roles`);
      }
      const input = {
        id: existing?.id,
        role: roleInput.value,
        headcount,
        startMonth: monthPick.value,
        sizeMode,
        planId: planSelect ? planSelect.value : (existing?.planId || ''),
      };
      if (sizeMode === 'shares') {
        const size = parseNum(sharesInput.value) ?? 0;
        if (!(size > 0)) return invalid(sharesInput, 'Enter how many shares each hire gets');
        if (!Number.isInteger(size)) return invalid(sharesInput, 'Shares per hire must be a whole number, like 25,000');
        input.shares = size;
      } else {
        const size = parseNum(pctInput.value) ?? 0;
        if (!(size > 0) || size > 50) return invalid(pctInput, 'Enter a percentage between 0 and 50');
        input.pct = size / 100;
      }
      saveBtn.disabled = true;
      try {
        await store.saveHire(input);
        toast(existing ? 'Role updated' : 'Role added to the plan');
        modal.close();
      } catch (err) {
        console.error(err);
        // A full plan is a refusal with something to do about it, not a
        // connection problem, so it is reported in its own words.
        toast(isRefusal(err) ? err.message : 'Couldn’t save. Check your connection',
          { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
        saveBtn.disabled = false;
      }
    },
  },
    el('p.confirm-message', {},
      'A planned grant is a forecast. It never reaches the cap table, the diluted count, '
      + 'or the pool draw until you actually issue it.'),
    field('Role', roleInput),
    el('div.form-grid', {},
      field('How many', countInput),
      field('Starts', monthPick.node)),
    planSelect ? field('Plan', el('div.select-wrap', {}, planSelect), 'The plan the grants are expected to draw from') : null,
    el('div.field', {}, el('span.field-label', {}, 'Grant size'), sizeSeg),
    sharesField,
    pctField,
    saveBtn);

  const modal = openModal({
    title: existing ? `Edit ${existing.role}` : 'Plan a grant',
    content: form,
  });
}

async function removeHire(row) {
  const ok = await confirmDialog({
    title: `Remove ${row.role}?`,
    message: 'The planned grant is removed from the forecast. Nothing on the cap table changes.',
    confirmLabel: 'Remove',
  });
  if (!ok) return;
  try {
    await store.deleteHire(row.id);
    toast('Role removed', { icon: 'trash' });
  } catch (err) {
    console.error(err);
    toast('Couldn’t remove. Check your connection', { icon: 'wifiOff' });
  }
}

/**
 * Issue a real grant from a planned one: the security form, prefilled with the
 * per-hire size. The plan row is deliberately left alone - a role with three
 * hires is granted three times, and only the person doing the hiring knows
 * when the row is finished.
 */
function grantFromPlan(row) {
  const per = plannedShares(store.db, { ...row, headcount: 1 });
  openSecurityForm({
    kind: 'option',
    prefill: { quantity: per, planId: row.planId || defaultPlan()?.id || '' },
    onSaved: () => toast('Granted. The planned role is still on the plan - remove it when the hiring is done'),
  });
}

/** Each plan's planned draw against its own available shares, for the plans the rows name. */
function planShortfalls(rows, fd) {
  const balances = planBalances(store.db);
  const fallback = defaultPlan();
  const byPlan = new Map();
  for (const row of rows) {
    // A row naming a plan that cannot hold an option grant (an import) draws the default, as the grant sheet will.
    const plan = (row.planId && plansOf(store.company).find((p) => p.id === row.planId && planAccepts(p, 'option'))) || fallback;
    if (!plan) continue;
    byPlan.set(plan.id, (byPlan.get(plan.id) || 0) + plannedShares(store.db, row, { fd }));
  }
  return [...byPlan.entries()].map(([planId, planned]) => {
    const row = balances.plans.find((r) => r.planId === planId);
    const available = Math.max(0, row?.available || 0);
    return { plan: row.plan, planned, available, short: Math.max(0, planned - available) };
  });
}

/** The pool drawn down month by month, with the month it runs dry named. */
function runwayChart(forecast) {
  const { rows, available, dryMonth } = forecast;
  /* The month the pool runs dry is the one thing the chart is drawn to
     show, so the summary says it too: the sentence used to sit inside the
     image, where children are presentational and nothing read it out. */
  const summary = `Option pool remaining month by month: `
    + rows.map((r) => `${monthLabel(r.month)} ${shares(r.remaining)}`).join(', ')
    + (dryMonth ? `. The pool runs dry in ${monthLabel(dryMonth)}` : '');
  return el('div', {},
    el('div.month-chart', { role: 'img', 'aria-label': summary },
      monthColumns(rows, {
        fillOf: (r) => (available > 0 ? r.remaining / available : 0),
        describe: (r) => (r.short > 0
          ? `${monthLabel(r.month)}: ${shares(r.short)} short`
          : `${monthLabel(r.month)}: ${shares(r.remaining)} left`
            + (r.granted > 0 ? `, ${shares(r.granted)} granted` : '')),
      }),
      monthAxis(rows)),
    dryMonth
      ? el('p.small.warn', { style: { marginTop: '8px' } },
        `The pool runs dry in ${monthLabel(dryMonth)}.`)
      : null);
}

/**
 * The card: the planned roles, and the runway they leave the pool.
 * `onCover` is offered when the plan needs more shares than the pool has -
 * the round model uses it to fill its own top-up field.
 */
export function hiringPlanCard({ onCover = null } = {}) {
  const plan = store.hiring;
  const forecast = poolForecast(store.db, plan, {
    from: todayISO(), months: POOL_FORECAST_MONTHS,
  });

  const addBtn = el('button.btn.btn-ghost', {
    html: icon('plus', 15, 2.2), onclick: () => openHireForm(),
  }, ' Add role');

  if (!plan.length) {
    return el('div.card', { style: { marginTop: '16px' } },
      el('div.card-head', {},
        el('div', {},
          el('h2.card-title', {}, 'Hiring plan'),
          el('p.card-sub', {}, 'What the next year and a half of hiring needs from the pool')),
        addBtn),
      emptyState({
        icon: 'briefcase',
        title: 'No planned grants yet',
        text: 'Add the roles you expect to hire and their grant sizes. The pool is drawn down '
          + 'month by month against them, so the top-up your next round needs is a number '
          + 'rather than a guess.',
        cta: 'Add a role',
        onCta: () => openHireForm(),
      }));
  }

  const summary = forecast.shortfall > 0
    ? `${shares(forecast.available)} unallocated today; the plan needs ${shares(forecast.planned)}. `
      + `${shares(forecast.shortfall)} short.`
    : `${shares(forecast.available)} unallocated today; the plan needs ${shares(forecast.planned)}. `
      + `${shares(forecast.available - forecast.planned)} would be left over.`;
  /* With several plans the aggregate can cover the whole plan while the one
     plan the grants would actually come from cannot: each plan's own draw
     against its own available shares, named where it falls short. */
  /* Measured once for the card: every percentage row is sized against the
     same fully diluted count, and each call rebuilds the plan balances over
     the whole register - a hundred rows cost a hundred passes per render. */
  const fd = fullyDiluted(store.securities, store.company);
  const perPlan = plansOf(store.company).length > 1 ? planShortfalls(plan, fd) : [];

  return el('div.card', { style: { marginTop: '16px' } },
    el('div.card-head', {},
      el('div', {},
        el('h2.card-title', {}, 'Hiring plan'),
        el('p.card-sub', {}, 'What the next year and a half of hiring needs from the pool')),
      addBtn),

    el('div.table-wrap', {
      tabindex: 0, role: 'region', 'aria-label': 'Hiring plan table',
      style: { border: 'none', marginBottom: '12px' },
    },
      el('table.data', { style: { minWidth: '520px' } },
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col' }, 'Role'),
          el('th.num', { scope: 'col' }, 'Hires'),
          el('th.num', { scope: 'col' }, 'Per hire'),
          el('th.num', { scope: 'col' }, 'Total'),
          el('th', { scope: 'col' }, 'Starts'),
          el('th', { scope: 'col' }, el('span.visually-hidden', {}, 'Actions')))),
        el('tbody', {}, plan.map((row) => {
          const per = plannedShares(store.db, { ...row, headcount: 1 }, { fd });
          const named = row.planId ? plansOf(store.company).find((p) => p.id === row.planId && planAccepts(p, 'option')) : null;
          return el('tr', {},
            el('td', {},
              el('div', { style: { fontWeight: '570' } }, row.role),
              /* Which plan the grants come from, once the answer is not the
                 only one: a row naming a plan says which, a row naming none
                 says it takes the default. */
              plansOf(store.company).length > 1
                ? el('div.small.muted', {}, named ? named.name : `${defaultPlan()?.name || 'No open plan'} (default)`)
                : null),
            el('td.num', {}, String(row.headcount)),
            el('td.num', {}, row.sizeMode === 'pct'
              ? el('div', {},
                // At its stored precision, as the sheet opens it: a 0.125% row read "0.13%" here.
                el('div', {}, `${percentValue(row.pct)}%`),
                el('div.small.muted', {}, shares(per)))
              : shares(per)),
            el('td.num', {}, shares(plannedShares(store.db, row, { fd }))),
            el('td', { style: { whiteSpace: 'nowrap' } }, row.startMonth
              ? monthLabel(row.startMonth)
              : el('span.small.muted', {}, 'unscheduled')),
            el('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
              el('button.btn.btn-ghost', {
                title: 'Issue a real grant from this planned one',
                // One "Grant" per planned role; the edit and remove buttons
                // beside it already name the role.
                'aria-label': `Grant ${row.role}`,
                onclick: () => grantFromPlan(row),
              }, 'Grant'),
              el('button.icon-btn', {
                html: icon('pencil', 16, 2), 'aria-label': `Edit ${row.role}`,
                onclick: () => openHireForm(row),
              }),
              el('button.icon-btn', {
                html: icon('trash', 16, 2), 'aria-label': `Remove ${row.role}`,
                onclick: () => removeHire(row),
              })));
        })))),

    runwayChart(forecast),
    el('p.small.muted', { style: { marginTop: '10px' } }, summary),
    perPlan.map((x) => el(`p.small.${x.short > 0 ? 'warn' : 'muted'}`, {},
      x.short > 0
        ? `${x.plan.name}: ${shares(x.planned)} planned against ${shares(x.available)} available, ${shares(x.short)} short.`
        : `${x.plan.name}: ${shares(x.planned)} planned against ${shares(x.available)} available.`)),
    forecast.unscheduled > 0
      ? el('p.small.muted', {},
        `${shares(forecast.unscheduled)} of the plan is unscheduled or already due, so it is drawn in the first month.`)
      : null,
    /* The shortfall is measured against the whole plan, and a role starting
       past the months shown is in it without a column of its own - so the
       last column's "short" figure read smaller than the line above with
       nothing to say where the difference was. */
    forecast.beyond > 0 && forecast.rows.length
      ? el('p.small.muted', {},
        `${shares(forecast.beyond)} of the plan starts after ${monthLabel(forecast.rows[forecast.rows.length - 1].month)}, `
        + 'past the months shown, and is counted in the shortfall.')
      : null,
    forecast.shortfall > 0 && onCover
      ? el('div.row.row-end', { style: { marginTop: '10px' } },
        el('button.btn.btn-ghost', {
          onclick: () => onCover(forecast),
        }, `Cover the shortfall in the round model`))
      : null);
}

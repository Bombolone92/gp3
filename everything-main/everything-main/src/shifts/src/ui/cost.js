/**
 * Labor cost on the schedule: the projection against the week's budget,
 * the breakdown that says which day and which role took it there, and
 * the dialog holding the three numbers behind it.
 *
 * Payroll is the largest controllable cost of the week for the teams
 * this app is for, and the decision that moves it is made while the rota
 * is being built. So the number lives next to the rota, not in the
 * timesheet export.
 */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { formatDate, formatHours } from '../lib/time.js';
import { budgetStatus, formatMoney, laborCost, CURRENCIES } from '../core/payroll.js';
import { openModal } from './modal.js';
import { field, showFormError } from './components.js';
import { toast } from './toast.js';

/** The overtime rule as laborCost wants it, straight off settings. */
export function costOptions(settings) {
  return {
    thresholdHours: settings?.overtimeThresholdHours ?? null,
    multiplier: settings?.overtimeMultiplier ?? null,
  };
}

/** "USD" -> "$", falling back to the code itself. */
function currencySymbol(code) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code })
      .formatToParts(0)
      .find((p) => p.type === 'currency').value;
  } catch {
    return code;
  }
}

export function openCostSettings(ctx) {
  const { store } = ctx;
  const settings = store.state.settings;

  const budgetInput = el('input', {
    class: 'input',
    type: 'number',
    min: '0',
    step: '10',
    value: settings.laborBudget ?? '',
    placeholder: 'No budget',
  });
  const thresholdInput = el('input', {
    class: 'input',
    type: 'number',
    min: '0',
    max: '168',
    step: '1',
    value: settings.overtimeThresholdHours ?? '',
    placeholder: 'Off',
  });
  const multiplierInput = el('input', {
    class: 'input',
    type: 'number',
    min: '1',
    max: '5',
    step: '0.25',
    value: settings.overtimeMultiplier ?? '',
    placeholder: 'Off',
  });
  const currencySelect = el(
    'select',
    { class: 'select', 'aria-label': 'Currency for all rates' },
    CURRENCIES.map((code) =>
      el(
        'option',
        { value: code, selected: code === (settings.currency ?? 'USD') },
        `${code}${currencySymbol(code) !== code ? ` (${currencySymbol(code)})` : ''}`
      )
    )
  );
  const errorBox = el('div', { style: { display: 'contents' } });

  const modal = openModal({
    title: 'Labor cost',
    content: [
      el(
        'p',
        { class: 'share-copy' },
        'All optional. The budget is per week and is only ever compared against the projection; nothing here changes what anyone is paid or blocks a shift.'
      ),
      el(
        'div',
        { class: 'form-grid keep-2col' },
        field('Weekly budget', budgetInput),
        field('Currency (all rates)', currencySelect)
      ),
      el('h3', { class: 'coverage-add-title' }, 'Overtime'),
      el(
        'p',
        { class: 'coverage-empty' },
        'Hours past the threshold in a week are projected at the multiplier, in the order the shifts are worked, so the cost of the fifth long shift shows up before it is worked. Both numbers are needed for the rule to apply.'
      ),
      el(
        'div',
        { class: 'form-grid keep-2col' },
        field('After (hours / week)', thresholdInput),
        field('Rate multiplier', multiplierInput)
      ),
      errorBox,
    ],
    footer: [
      el('span', { class: 'grow' }),
      el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'),
      el(
        'button',
        {
          class: 'btn btn-primary',
          onClick: async (e) => {
            errorBox.replaceChildren();
            const button = e.currentTarget;
            button.disabled = true;
            try {
              await store.updateCosting({
                laborBudget: budgetInput.value,
                overtimeThresholdHours: thresholdInput.value,
                overtimeMultiplier: multiplierInput.value,
              });
              if (currencySelect.value !== (settings.currency ?? 'USD')) {
                await store.updateSettings({ currency: currencySelect.value });
              }
            } catch (err) {
              button.disabled = false;
              showFormError(errorBox, err.message);
              return;
            }
            modal.close();
            toast('Labor cost settings saved');
          },
        },
        'Save'
      ),
    ],
  });
}

/** One line of a breakdown table. */
function breakdownRow(label, entry, currency, share) {
  return el(
    'div',
    { class: 'cost-row' },
    el('span', { class: 'cost-row-label' }, label),
    el(
      'span',
      { class: 'cost-row-bar', role: 'presentation' },
      el('span', { class: 'cost-row-fill', style: { width: `${Math.round(share * 100)}%` } })
    ),
    el('span', { class: 'cost-row-hours tnum' }, formatHours(entry.minutes)),
    el('span', { class: 'cost-row-money tnum' }, entry.cost > 0 ? formatMoney(entry.cost, currency) : '–')
  );
}

/**
 * The cost panel under the schedule header: projection, budget bar, and
 * a breakdown by day and by role. Rates stay off the printed page, so
 * the whole panel is print-hidden like the note it replaces.
 *
 * Returns null when there is nothing to say: no rates anywhere and no
 * budget set means a team that does not track cost sees no change.
 */
export function costPanel(ctx, dates) {
  const { store, ui } = ctx;
  const state = store.state;
  const currency = state.settings.currency ?? 'USD';
  const cost = laborCost(state.shifts, state.employees, dates, costOptions(state.settings));
  const budget = budgetStatus(cost.cost, state.settings.laborBudget);
  // Nobody with a rate and no budget to measure against: a team that does
  // not track cost sees nothing here. (An empty week is that case too,
  // since ratedCount can never exceed the people actually scheduled.)
  if (cost.ratedCount === 0 && budget.budget === null) return null;

  const settingsButton = el(
    'button',
    {
      class: 'btn btn-sm btn-icon',
      'aria-label': 'Labor cost settings',
      title: 'Budget, overtime, and currency',
      onClick: () => openCostSettings(ctx),
    },
    icon('sliders', 15)
  );

  const partial =
    cost.ratedCount < cost.employeeCount
      ? `${cost.ratedCount} of ${cost.employeeCount} scheduled people have rates`
      : null;

  const notes = [
    partial,
    cost.overtimeMinutes > 0
      ? `includes ${formatMoney(cost.overtimeCost, currency)} for ${formatHours(
          cost.overtimeMinutes
        )} over ${state.settings.overtimeThresholdHours}h at ${state.settings.overtimeMultiplier}x`
      : null,
  ].filter(Boolean);

  const head = el(
    'div',
    { class: 'cost-head' },
    el(
      'div',
      { class: 'cost-figures' },
      el('span', { class: 'cost-total tnum' }, formatMoney(cost.cost, currency)),
      budget.budget === null
        ? el('span', { class: 'cost-of' }, 'projected labor this week')
        : el(
            'span',
            { class: 'cost-of tnum' },
            `of ${formatMoney(budget.budget, currency)} budget`
          ),
      budget.budget === null
        ? null
        : el(
            'span',
            { class: `cost-flag${budget.over ? ' is-over' : ''}` },
            budget.over ? icon('warning', 13) : null,
            budget.over
              ? `${formatMoney(budget.difference, currency)} over`
              : `${formatMoney(-budget.difference, currency)} left`
          )
    ),
    el('span', { class: 'grow' }),
    budget.budget === null
      ? el('button', { class: 'btn btn-sm', onClick: () => openCostSettings(ctx) }, 'Set a budget')
      : null,
    el(
      'button',
      {
        class: 'btn btn-sm',
        'aria-expanded': String(Boolean(ui.costBreakdownOpen)),
        dataset: { focusKey: 'sched:cost:breakdown' },
        onClick: () => {
          ui.costBreakdownOpen = !ui.costBreakdownOpen;
          ctx.refresh();
        },
      },
      icon(ui.costBreakdownOpen ? 'chevron-down' : 'chevron-right', 15),
      'Breakdown'
    ),
    settingsButton
  );

  const bar =
    budget.budget === null
      ? null
      : el(
          'div',
          {
            class: `cost-bar${budget.over ? ' is-over' : ''}`,
            role: 'img',
            'aria-label': `${Math.round(budget.ratio * 100)}% of the weekly budget used`,
          },
          el('span', {
            class: 'cost-bar-fill',
            style: { width: `${Math.min(100, Math.round(budget.ratio * 100))}%` },
          }),
          // Where the projection is past the budget, the overshoot gets
          // its own segment rather than a bar that just sits full.
          budget.over
            ? el('span', {
                class: 'cost-bar-over',
                style: { width: `${Math.min(100, Math.round((budget.ratio - 1) * 100))}%` },
              })
            : null
        );

  const maxDay = Math.max(...cost.byDay.map((d) => d.cost), 0);
  const maxRole = Math.max(...cost.byRole.map((r) => r.cost), 0);
  const breakdown = ui.costBreakdownOpen
    ? el(
        'div',
        { class: 'cost-breakdown' },
        el(
          'div',
          {},
          el('h4', {}, 'By day'),
          cost.byDay.length === 0
            ? el('p', { class: 'coverage-empty' }, 'Nothing scheduled.')
            : cost.byDay.map((entry) =>
                breakdownRow(formatDate(entry.key), entry, currency, maxDay ? entry.cost / maxDay : 0)
              )
        ),
        el(
          'div',
          {},
          el('h4', {}, 'By role'),
          cost.byRole.length === 0
            ? el('p', { class: 'coverage-empty' }, 'Nothing scheduled.')
            : cost.byRole.map((entry) =>
                breakdownRow(entry.key, entry, currency, maxRole ? entry.cost / maxRole : 0)
              )
        )
      )
    : null;

  return el(
    'div',
    { class: 'card cost-panel print-hidden' },
    head,
    bar,
    notes.length > 0 ? el('p', { class: 'cost-notes' }, notes.join(' · ')) : null,
    breakdown
  );
}

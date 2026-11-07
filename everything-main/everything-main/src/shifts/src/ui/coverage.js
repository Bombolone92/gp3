/**
 * Coverage and limits: the minimum headcount per role and weekday, plus
 * the three optional working-time limits (see core/rules.js). Both
 * answer the same question from opposite ends, how many people a day
 * needs and how much one person may take, so they share a dialog.
 */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { dayShort, formatTimeRange } from '../lib/time.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { field, showFormError } from './components.js';
import { normalizeRules } from '../core/rules.js';
import { roleField } from './roles.js';

/** Monday-first order for day pickers; values are getDay() indices. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function describeDays(days) {
  if (days.length === 7) return 'Every day';
  return DAY_ORDER.filter((d) => days.includes(d))
    .map((d) => dayShort(d))
    .join(', ');
}

export function openCoverageEditor(ctx) {
  const { store } = ctx;
  const body = el('div', { style: { display: 'contents' } });

  function render() {
    const coverage = store.state.settings.coverage ?? [];

    const roleControl = roleField(store, '');
    const countInput = el('input', { class: 'input', type: 'number', min: '1', max: '50', step: '1', value: '1' });
    const startInput = el('input', { class: 'input', type: 'time' });
    const endInput = el('input', { class: 'input', type: 'time' });
    const selectedDays = new Set([1, 2, 3, 4, 5]);
    const dayPicker = el(
      'div',
      { class: 'day-toggles', role: 'group', 'aria-label': 'Days' },
      DAY_ORDER.map((d) =>
        el(
          'button',
          {
            type: 'button',
            class: 'day-toggle',
            'aria-pressed': String(selectedDays.has(d)),
            onClick: (e) => {
              if (selectedDays.has(d)) selectedDays.delete(d);
              else selectedDays.add(d);
              e.currentTarget.setAttribute('aria-pressed', String(selectedDays.has(d)));
            },
          },
          dayShort(d)
        )
      )
    );
    const errorBox = el('div', { style: { display: 'contents' } });

    body.replaceChildren(
      coverage.length === 0
        ? el('p', { class: 'coverage-empty' }, 'No requirements yet. The schedule flags days where a requirement is not met.')
        : el(
            'div',
            { class: 'card row-list' },
            coverage.map((req) =>
              el(
                'div',
                { class: 'item-row' },
                el(
                  'div',
                  { class: 'item-main' },
                  el('div', { class: 'item-title' }, `${req.count} × ${req.role}`),
                  el(
                    'div',
                    { class: 'item-sub' },
                    `${describeDays(req.days)}${req.start ? ` · ${formatTimeRange(req.start, req.end)}` : ' · All day'}`
                  )
                ),
                el(
                  'button',
                  {
                    class: 'btn btn-ghost btn-sm btn-icon',
                    'aria-label': `Remove ${req.role} requirement`,
                    title: 'Remove requirement',
                    onClick: async () => {
                      try {
                        await store.removeCoverage(req.id);
                        render();
                      } catch (err) {
                        toast(err.message, 'error');
                      }
                    },
                  },
                  icon('trash', 15)
                )
              )
            )
          ),
      el('h3', { class: 'coverage-add-title' }, 'Add requirement'),
      el(
        'div',
        { class: 'form-grid keep-2col' },
        el('div', { class: 'field' }, el('label', { for: roleControl.id }, 'Role / label'), roleControl.element),
        field('People needed', countInput)
      ),
      el('div', { class: 'field' }, el('label', {}, 'Days'), dayPicker),
      el(
        'div',
        { class: 'form-grid keep-2col' },
        field('Window from (optional)', startInput),
        field('Window until', endInput)
      ),
      errorBox,
      el(
        'button',
        {
          class: 'btn btn-primary btn-block',
          onClick: async (e) => {
            errorBox.replaceChildren();
            const button = e.currentTarget;
            button.disabled = true;
            const role = roleControl.getValue();
            try {
              await store.addCoverage({
                role,
                days: [...selectedDays],
                count: countInput.value,
                start: startInput.value || null,
                end: endInput.value || null,
              });
            } catch (err) {
              button.disabled = false;
              showFormError(errorBox, err.message);
              return;
            }
            // Added: reset the form before the bookkeeping below, so a
            // failure there can't hold the filled form open and invite a
            // duplicate requirement.
            toast('Requirement added');
            render();
            store.ensureRole(role).catch((err) => console.error(err));
          },
        },
        'Add requirement'
      )
    );
  }

  /**
   * The three limits, saved on change and never blocking anything. Left
   * out of render() on purpose: rewriting the dialog after every
   * keystroke would take the field being typed in with it.
   */
  function limitsSection() {
    const rules = normalizeRules(store.state.settings.rules);
    const errorBox = el('div', { style: { display: 'contents' } });

    const numberField = (key, label, { max, unit }) => {
      const input = el('input', {
        class: 'input',
        type: 'number',
        min: '1',
        max: String(max),
        step: key === 'maxConsecutiveDays' ? '1' : '0.5',
        value: rules[key] ?? '',
        placeholder: 'Off',
        onChange: async (e) => {
          errorBox.replaceChildren();
          const value = e.target.value;
          try {
            await store.updateRules({ [key]: value });
          } catch (err) {
            e.target.value = normalizeRules(store.state.settings.rules)[key] ?? '';
            showFormError(errorBox, err.message);
          }
        },
      });
      return field(`${label} (${unit})`, input);
    };

    return el(
      'div',
      {},
      el('h3', { class: 'coverage-add-title' }, 'Working-time limits'),
      el(
        'p',
        { class: 'coverage-empty' },
        'All optional and off by default. They never block a save: the schedule, swap review, and staffing suggestions warn, and the week grid flags the person’s row.'
      ),
      el(
        'div',
        { class: 'form-grid keep-2col' },
        numberField('minRestHours', 'Rest between shifts', { max: 24, unit: 'hours' }),
        numberField('maxDailyHours', 'Most in a day', { max: 24, unit: 'hours' })
      ),
      el(
        'div',
        { class: 'form-grid keep-2col' },
        numberField('maxConsecutiveDays', 'Days in a row', { max: 60, unit: 'days' })
      ),
      errorBox
    );
  }

  render();
  openModal({ title: 'Coverage & limits', content: [body, limitsSection()] });
}

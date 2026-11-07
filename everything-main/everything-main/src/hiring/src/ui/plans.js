/**
 * Onboarding templates: the checklist a signed offer stamps onto a new
 * hire. Editable, named, attachable to jobs or departments, and each task
 * can carry a day offset from the start date so the work comes due.
 */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { uid } from '../lib/id.js';
import { field, focusAfterRemoval } from './components.js';
import { confirmDialog, ignoreChanges, notifyChanged, openModal } from './modal.js';
import { toast } from './toast.js';
import {
  DEFAULT_ONBOARDING_TASKS,
  MAX_TEMPLATES,
  MAX_TEMPLATE_NAME,
  MAX_TEMPLATE_TASKS,
  offsetLabel,
  offsetShort,
  onboardingTemplates,
} from '../core/onboard.js';
import { plural } from '../lib/format.js';

/** Offsets worth offering; anything else is a number the user can type. */
const OFFSET_CHOICES = [-30, -14, -7, -3, -2, -1, 0, 1, 3, 7, 14, 30];

export function openTemplatesEditor(ctx) {
  const { store } = ctx;
  const settings = store.state.settings;
  const departments = [...new Set(store.state.jobs.map((j) => String(j.department ?? '').trim()).filter(Boolean))].sort();
  const jobs = [...store.state.jobs].sort((a, b) => String(a.title).localeCompare(String(b.title)));

  const draft = onboardingTemplates(settings).map((t) => ({
    ...t,
    tasks: t.tasks.map((task) => ({ ...task })),
    jobIds: [...t.jobIds],
    departments: [...t.departments],
  }));
  let current = draft[0]?.id ?? null;

  const body = el('div', { style: { display: 'contents' } });

  const save = el('button', { class: 'btn btn-primary' }, 'Save templates');
  save.addEventListener('click', async () => {
    const unnamed = draft.find((t) => !t.name.trim());
    if (unnamed) {
      toast('Every template needs a name.', 'error');
      return;
    }
    const empty = draft.find((t) => t.tasks.every((task) => !task.title.trim()));
    if (empty) {
      toast(`“${empty.name}” has no tasks yet. Add one, or remove the template.`, 'error');
      return;
    }
    save.disabled = true;
    try {
      await store.updateSettings({
        onboardingTemplates: draft.map((t) => ({
          id: t.id,
          name: t.name.trim(),
          jobIds: t.jobIds,
          departments: t.departments,
          tasks: t.tasks
            .filter((task) => task.title.trim())
            .map((task) => ({
              title: task.title.trim(),
              category: task.category.trim() || 'Other',
              ...(Number.isInteger(task.offsetDays) ? { offsetDays: task.offsetDays } : {}),
            })),
        })),
      });
      modal.close();
      toast('Onboarding templates saved');
    } catch (err) {
      save.disabled = false;
      toast(err.message, 'error');
    }
  });

  const modal = openModal({
    title: 'Onboarding templates',
    wide: true,
    content: body,
    footer: [el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'), save],
  });

  function addTemplate(from = null) {
    if (draft.length >= MAX_TEMPLATES) {
      toast(`Keep it to ${MAX_TEMPLATES} templates.`, 'error');
      return;
    }
    const template = {
      id: uid('tpl'),
      name: from ? `${from.name} copy` : '',
      // A new template starts from the shipped list rather than blank: the
      // usual edit is "the standard plan, plus our compliance step".
      tasks: (from?.tasks ?? DEFAULT_ONBOARDING_TASKS).map((t) => ({ ...t })),
      jobIds: [],
      departments: [],
    };
    draft.push(template);
    current = template.id;
    render();
    notifyChanged(body);
    body.querySelector('.template-name')?.focus();
  }

  function render() {
    const template = draft.find((t) => t.id === current) ?? null;

    const picker = el(
      'select',
      {
        class: 'select',
        'aria-label': 'Template',
        onChange: (e) => {
          current = e.target.value;
          render();
        },
      },
      draft.map((t) => el('option', { value: t.id, selected: t.id === current }, t.name || 'Untitled template'))
    );
    // Navigation, not an edit — keep it out of the dirty tracker.
    ignoreChanges(picker);

    const header = el(
      'div',
      { class: 'input-row wrap' },
      draft.length > 0 ? picker : el('span', { class: 'muted small' }, 'No templates yet.'),
      el('button', { class: 'btn btn-sm', onClick: () => addTemplate() }, icon('plus', 14), 'New template'),
      template ? el('button', { class: 'btn btn-sm', onClick: () => addTemplate(template) }, icon('copy', 14), 'Duplicate') : null
    );

    if (!template) {
      body.replaceChildren(header);
      return;
    }

    const name = el('input', {
      class: 'input template-name',
      type: 'text',
      value: template.name,
      // Same reason as the task title below: storage trims to this, so
      // cap it where the cut is still visible.
      maxlength: String(MAX_TEMPLATE_NAME),
      placeholder: 'e.g. Engineering onboarding',
      onInput: (e) => {
        template.name = e.target.value;
        const option = [...picker.options].find((o) => o.value === template.id);
        if (option) option.textContent = template.name || 'Untitled template';
      },
    });

    const rows = el('div', { class: 'plan-editor' });
    const tasksLabel = el('label', {}, `Tasks (${plural(template.tasks.length, 'task')})`);

    function renderRows() {
      tasksLabel.textContent = `Tasks (${plural(template.tasks.length, 'task')})`;
      rows.replaceChildren(
        ...template.tasks.map((task, i) => {
          const title = el('input', {
            class: 'input',
            type: 'text',
            value: task.title,
            maxlength: '140',
            placeholder: 'e.g. Order laptop and equipment',
            'aria-label': `Task ${i + 1}`,
            onInput: (e) => {
              task.title = e.target.value;
            },
          });
          const category = el('input', {
            class: 'input plan-category',
            type: 'text',
            value: task.category ?? '',
            maxlength: '40',
            placeholder: 'Category',
            'aria-label': `Category for task ${i + 1}`,
            list: 'plan-categories',
            onInput: (e) => {
              task.category = e.target.value;
            },
          });
          const offset = el(
            'select',
            {
              class: 'select plan-offset',
              'aria-label': `When task ${i + 1} is due`,
              onChange: (e) => {
                const value = e.target.value;
                if (value === '') delete task.offsetDays;
                else task.offsetDays = Number(value);
              },
            },
            el('option', { value: '', selected: !Number.isInteger(task.offsetDays) }, 'No date'),
            // Short in the list, spelled out in its title: three controls
            // share this row, and "7 days before the start date" truncates
            // to "7 days before the".
            OFFSET_CHOICES.map((days) =>
              el('option', { value: String(days), selected: task.offsetDays === days, title: offsetLabel(days) }, offsetShort(days))
            ),
            // A stored offset outside the list stays selectable, the way
            // optionSelect keeps an unknown value.
            Number.isInteger(task.offsetDays) && !OFFSET_CHOICES.includes(task.offsetDays)
              ? el('option', { value: String(task.offsetDays), selected: true, title: offsetLabel(task.offsetDays) }, offsetShort(task.offsetDays))
              : null
          );
          return el(
            'div',
            { class: 'plan-editor-row' },
            el('span', { class: 'slot-editor-index tnum' }, `${i + 1}.`),
            title,
            el('div', { class: 'plan-editor-meta' }, category, offset),
            el(
              'button',
              {
                class: 'btn btn-ghost btn-icon btn-sm btn-icon-danger',
                'aria-label': `Remove task ${i + 1}`,
                title: 'Remove task',
                onClick: () => {
                  template.tasks.splice(i, 1);
                  renderRows();
                  notifyChanged(rows);
                  focusAfterRemoval(rows, '.btn', i, addTask);
                },
              },
              icon('x', 14)
            )
          );
        })
      );
    }
    renderRows();

    const addTask = el(
      'button',
      {
        class: 'btn btn-sm',
        onClick: () => {
          if (template.tasks.length >= MAX_TEMPLATE_TASKS) {
            toast(`A template holds up to ${MAX_TEMPLATE_TASKS} tasks.`, 'error');
            return;
          }
          template.tasks.push({ title: '', category: template.tasks.at(-1)?.category ?? 'Other' });
          renderRows();
          notifyChanged(rows);
          rows.querySelectorAll('.plan-editor-row .input').item((template.tasks.length - 1) * 2)?.focus();
        },
      },
      icon('plus', 14),
      'Add task'
    );

    const categories = el(
      'datalist',
      { id: 'plan-categories' },
      [...new Set([...DEFAULT_ONBOARDING_TASKS.map((t) => t.category), ...draft.flatMap((t) => t.tasks.map((task) => task.category))])]
        .filter(Boolean)
        .map((c) => el('option', { value: c }))
    );

    const appliesHint = el('p', { class: 'muted small' });
    const paintApplies = () => {
      const names = [
        ...template.jobIds.map((id) => jobs.find((j) => j.id === id)?.title).filter(Boolean),
        ...template.departments,
      ];
      appliesHint.textContent = names.length
        ? `Used for: ${names.join(', ')}. A job beats a department; a template attached to nothing is the fallback.`
        : 'Attached to nothing, so this is the fallback for every hire whose job has no template of its own.';
    };

    const check = (id, label, checked, onChange) => {
      const box = el('input', { type: 'checkbox', class: 'task-check', id, checked });
      box.addEventListener('change', () => {
        onChange(box.checked);
        paintApplies();
      });
      return el('label', { class: 'task-label day-check', for: id }, box, el('span', {}, label));
    };
    paintApplies();

    const remove = el(
      'button',
      {
        class: 'btn btn-danger btn-sm',
        onClick: async () => {
          const ok = await confirmDialog({
            title: `Remove “${template.name || 'this template'}”?`,
            message: 'Checklists already stamped onto a hire keep every task they have; only the template goes.',
            confirmLabel: 'Remove template',
            danger: true,
          });
          if (!ok) return;
          draft.splice(draft.indexOf(template), 1);
          current = draft[0]?.id ?? null;
          render();
          notifyChanged(body);
        },
      },
      icon('trash', 14),
      'Remove template'
    );

    body.replaceChildren(
      header,
      field('Template name', name, 'template-name'),
      el(
        'div',
        { class: 'field' },
        tasksLabel,
        rows,
        categories,
        el('div', { class: 'input-row' }, addTask),
        el(
          'p',
          { class: 'muted small' },
          'A task with a date comes due against the hire’s start date (from their signed offer) and surfaces under “Needs attention”. Tasks group by category, in the order they appear here.'
        )
      ),
      el(
        'div',
        { class: 'field' },
        el('label', {}, 'Use this template for'),
        jobs.length > 0
          ? el('div', { class: 'day-checks' }, jobs.map((job) => check(`tpl-job-${job.id}`, job.title, template.jobIds.includes(job.id), (on) => {
              template.jobIds = on ? [...new Set([...template.jobIds, job.id])] : template.jobIds.filter((id) => id !== job.id);
            })))
          : null,
        departments.length > 0
          ? el('div', { class: 'day-checks' }, departments.map((dept) => check(`tpl-dept-${dept}`, dept, template.departments.includes(dept), (on) => {
              template.departments = on ? [...new Set([...template.departments, dept])] : template.departments.filter((d) => d !== dept);
            })))
          : null,
        appliesHint
      ),
      draft.length > 1 ? el('div', { class: 'input-row' }, remove) : null
    );
  }

  render();
}

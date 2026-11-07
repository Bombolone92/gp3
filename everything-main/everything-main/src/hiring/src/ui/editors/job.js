/** Create / edit a job posting. */
import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { uid } from '../../lib/id.js';
import { field, focusAfterRemoval } from '../components.js';
import { notifyChanged, openModal } from '../modal.js';
import { toast } from '../toast.js';
import { JOB_TYPES, WORK_MODES } from '../../core/store.js';
import { ratingFieldsForJob } from '../../core/scorecards.js';
import {
  MAX_QUESTION_LENGTH,
  MAX_SCREENING_OPTIONS,
  MAX_SCREENING_QUESTIONS,
  SCREENING_KINDS,
  screeningQuestionsForJob,
} from '../../core/screening.js';
import { CURRENCIES, errorRegion, optionSelect, parsedValue, runSave } from './form.js';
import { syncPublishedJob } from '../publish.js';

/** A labelled checkbox, sized for an editor's inline control row. */
function checkboxRow(id, labelText, checked, onChange) {
  const box = el('input', { type: 'checkbox', class: 'task-check', id, checked });
  box.addEventListener('change', () => onChange(box.checked));
  return el('label', { class: 'task-label q-check', for: id }, box, el('span', {}, labelText));
}

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open · accepting candidates' },
  { value: 'draft', label: 'Draft · not yet published' },
  { value: 'closed', label: 'Closed · no longer hiring' },
];

export function openJobEditor(ctx, job = null) {
  const isNew = !job;
  const errors = errorRegion();

  const title = el('input', { class: 'input', type: 'text', value: job?.title ?? '', placeholder: 'e.g. Senior Frontend Engineer' });
  const department = el('input', { class: 'input', type: 'text', value: job?.department ?? '', placeholder: 'e.g. Engineering' });
  const location = el('input', { class: 'input', type: 'text', value: job?.location ?? '', placeholder: 'e.g. Berlin, Germany' });
  const type = optionSelect(JOB_TYPES, job?.type ?? 'Full-time');
  const workMode = optionSelect(WORK_MODES, job?.workMode ?? 'Onsite');
  const status = optionSelect(STATUS_OPTIONS, job?.status ?? 'open');
  // Published as the posting's validThrough, so aggregators stop serving
  // the role once it has passed. Blank means "no deadline".
  const closesOn = el('input', { class: 'input', type: 'date', value: job?.closesOn ?? '' });
  // These share one visual "Salary range" label, so each needs its own name.
  const salaryMin = el('input', { class: 'input', type: 'number', min: '0', step: '1000', value: job?.salaryMin ?? '', placeholder: 'Min', 'aria-label': 'Minimum salary' });
  const salaryMax = el('input', { class: 'input', type: 'number', min: '0', step: '1000', value: job?.salaryMax ?? '', placeholder: 'Max', 'aria-label': 'Maximum salary' });
  const currency = optionSelect(CURRENCIES, job?.currency ?? 'USD');
  currency.setAttribute('aria-label', 'Currency');
  const description = el('textarea', {
    class: 'textarea',
    rows: 7,
    placeholder: 'What the role is, what they will do, and what you look for.\n\nLines starting with "- " render as bullet points on the job page.',
  });
  description.value = job?.description ?? '';

  /* Scorecard rubric: the dimensions interviewers rate for this job.
     Untouched, the job keeps following the app default rubric. */
  const rubricAtOpen = ratingFieldsForJob(job).map((f) => ({ ...f }));
  const rubricDraft = rubricAtOpen.map((f) => ({ ...f }));
  const rubricRows = el('div', { class: 'stage-editor' });

  function renderRubricRows() {
    rubricRows.replaceChildren(
      ...rubricDraft.map((f, i) =>
        el(
          'div',
          { class: 'stage-editor-row' },
          el('span', { class: 'stage-editor-icon' }, icon('star', 14)),
          el('input', {
            class: 'input',
            type: 'text',
            value: f.label,
            placeholder: 'e.g. Product sense',
            'aria-label': `Rating dimension ${i + 1}`,
            onInput: (e) => {
              f.label = e.target.value;
            },
          }),
          el(
            'button',
            {
              class: 'btn btn-ghost btn-icon btn-sm btn-icon-danger',
              'aria-label': `Remove ${f.label || 'dimension'}`,
              title: 'Remove dimension',
              onClick: () => {
                rubricDraft.splice(i, 1);
                renderRubricRows();
                notifyChanged(rubricRows);
                focusAfterRemoval(rubricRows, '.btn', i, addDimension);
              },
            },
            icon('x', 14)
          )
        )
      )
    );
  }
  renderRubricRows();

  /* Screening questions: what the public apply form asks beyond the
     standard fields. Answers already received are snapshotted onto the
     candidate, so editing these never rewrites an application. */
  const questionsAtOpen = screeningQuestionsForJob(job).map((q) => ({ ...q }));
  const questionDraft = questionsAtOpen.map((q) => ({
    ...q,
    required: Boolean(q.required),
    mustHave: Boolean(q.mustHave),
    options: (q.options ?? []).join(', '),
  }));
  const questionRows = el('div', { class: 'q-editor' });

  function renderQuestionRows() {
    questionRows.replaceChildren(
      ...questionDraft.map((q, i) => {
        const kind = optionSelect(SCREENING_KINDS, q.kind);
        kind.classList.add('q-kind');
        kind.setAttribute('aria-label', `Answer type for question ${i + 1}`);
        const options = el('input', {
          class: 'input',
          type: 'text',
          value: q.options,
          placeholder: 'Options, comma separated — e.g. 0–2 years, 3–5 years, 5+ years',
          'aria-label': `Options for question ${i + 1}`,
          onInput: (e) => {
            q.options = e.target.value;
          },
        });
        const mustHave = checkboxRow(`q-must-${i}`, 'Must be yes', q.mustHave, (checked) => {
          q.mustHave = checked;
        });
        const syncKind = () => {
          options.parentElement.hidden = q.kind !== 'choice';
          mustHave.hidden = q.kind !== 'yesno';
        };
        kind.addEventListener('change', () => {
          q.kind = kind.value;
          syncKind();
        });
        const row = el(
          'div',
          { class: 'q-editor-row' },
          el('input', {
            class: 'input',
            type: 'text',
            value: q.label,
            maxlength: String(MAX_QUESTION_LENGTH),
            placeholder: 'e.g. Are you authorized to work in Germany?',
            'aria-label': `Question ${i + 1}`,
            onInput: (e) => {
              q.label = e.target.value;
            },
          }),
          el(
            'div',
            { class: 'q-editor-controls' },
            kind,
            checkboxRow(`q-req-${i}`, 'Required', q.required, (checked) => {
              q.required = checked;
            }),
            mustHave,
            el('span', { class: 'grow' }),
            el(
              'button',
              {
                class: 'btn btn-ghost btn-icon btn-sm btn-icon-danger',
                'aria-label': `Remove ${q.label || `question ${i + 1}`}`,
                title: 'Remove question',
                onClick: () => {
                  questionDraft.splice(i, 1);
                  renderQuestionRows();
                  notifyChanged(questionRows);
                  focusAfterRemoval(questionRows, '.btn', i, addQuestion);
                },
              },
              icon('x', 14)
            )
          ),
          el('div', { class: 'q-editor-options' }, options)
        );
        syncKind();
        return row;
      })
    );
  }
  renderQuestionRows();

  const addQuestion = el(
    'button',
    {
      class: 'btn btn-sm',
      onClick: () => {
        if (questionDraft.length >= MAX_SCREENING_QUESTIONS) {
          errors.show(`An apply form can ask up to ${MAX_SCREENING_QUESTIONS} questions.`);
          return;
        }
        questionDraft.push({ id: uid('q'), label: '', kind: 'short', required: false, mustHave: false, options: '' });
        renderQuestionRows();
        notifyChanged(questionRows);
        questionRows.querySelectorAll('.q-editor-row > .input')[questionDraft.length - 1]?.focus();
      },
    },
    icon('plus', 14),
    'Add question'
  );

  const addDimension = el(
    'button',
    {
      class: 'btn btn-sm',
      onClick: () => {
        rubricDraft.push({ key: uid('dim'), label: '' });
        renderRubricRows();
        notifyChanged(rubricRows);
        rubricRows.querySelectorAll('input')[rubricDraft.length - 1]?.focus();
      },
    },
    icon('plus', 14),
    'Add dimension'
  );

  const save = el('button', { class: 'btn btn-primary' }, isNew ? 'Create job' : 'Save changes');
  save.addEventListener('click', async () => {
    if (rubricDraft.some((f) => !f.label.trim())) {
      errors.show('Every rating dimension needs a name (or remove the empty row).');
      return;
    }
    if (questionDraft.some((q) => !q.label.trim())) {
      errors.show('Every screening question needs its wording (or remove the empty row).');
      return;
    }
    const cleanQuestions = questionDraft.map((q) => ({
      id: q.id,
      label: q.label.trim(),
      kind: q.kind,
      required: q.required,
      ...(q.kind === 'yesno' && q.mustHave ? { mustHave: true } : {}),
      // Not sliced to the cap: an option typed past it was dropped in
      // silence, under a toast saying the job had saved — and the ones
      // that vanished were choices the public apply form would never
      // offer again. Refuse below instead, the way too few does.
      ...(q.kind === 'choice'
        ? { options: [...new Set(q.options.split(',').map((o) => o.trim()).filter(Boolean))] }
        : {}),
    }));
    const thin = cleanQuestions.find((q) => q.kind === 'choice' && q.options.length < 2);
    if (thin) {
      errors.show(`“${thin.label}” offers a choice, so it needs at least two comma-separated options.`);
      return;
    }
    const crowded = cleanQuestions.find((q) => q.kind === 'choice' && q.options.length > MAX_SCREENING_OPTIONS);
    if (crowded) {
      errors.show(
        `“${crowded.label}” lists ${crowded.options.length} options; an apply form asks for at most ${MAX_SCREENING_OPTIONS}. Remove ${crowded.options.length - MAX_SCREENING_OPTIONS}.`
      );
      return;
    }
    // Only a real edit makes the rubric job-specific; untouched, the job
    // keeps following the app default (rubricAtOpen shows it resolved).
    const cleanRubric = rubricDraft.map((f) => ({ key: f.key, label: f.label.trim() }));
    const rubricChanged = JSON.stringify(cleanRubric) !== JSON.stringify(rubricAtOpen);
    const ok = await runSave(save, errors, async () => {
      // Inside runSave so an unparseable salary bound (a pasted
      // "$120,000") lands in the error region instead of silently saving
      // as "not stated" — and, on a published job, stripping the pay
      // range from the live public page.
      const minValue = parsedValue(salaryMin, 'The salary minimum');
      const maxValue = parsedValue(salaryMax, 'The salary maximum');
      const data = {
        title: title.value,
        department: department.value,
        location: location.value,
        type: type.value,
        workMode: workMode.value,
        status: status.value,
        salaryMin: minValue === '' ? null : Number(minValue),
        salaryMax: maxValue === '' ? null : Number(maxValue),
        currency: currency.value,
        description: description.value,
        closesOn: parsedValue(closesOn, 'The closing date') || null,
        screeningQuestions: cleanQuestions,
        ...(rubricChanged || job?.ratingFields ? { ratingFields: cleanRubric } : {}),
      };
      if (isNew) {
        const created = await ctx.store.addJob(data);
        ctx.navigate(`jobs/${created.id}`);
      } else {
        await ctx.store.updateJob(job.id, data);
      }
    });
    if (ok) {
      modal.close();
      toast(isNew ? 'Job created' : 'Job updated');
      // The public page syncs after the save is reported: a network
      // failure here is a publish problem, not a rejected edit — the
      // record is already persisted, and re-clicking Save (which the
      // error region invites) would only repeat the same write.
      if (!isNew) {
        try {
          await syncPublishedJob(ctx, job.id);
        } catch (err) {
          console.error(err);
          toast('Saved, but the public job page couldn’t be updated. Republish it from the job page.', 'error');
        }
      }
    }
  });

  const modal = openModal({
    title: isNew ? 'New job' : 'Edit job',
    wide: true,
    content: el(
      'div',
      { class: 'form-grid' },
      el('div', { class: 'span-2' }, field('Job title', title, 'job-title')),
      field('Department', department, 'job-dept'),
      field('Location', location, 'job-loc'),
      field('Employment type', type, 'job-type'),
      field('Work mode', workMode, 'job-mode'),
      el(
        'div',
        { class: 'span-2' },
        field(
          'Salary range (per year)',
          el('div', { class: 'input-row' }, salaryMin, el('span', { class: 'input-sep', 'aria-hidden': 'true' }, '–'), salaryMax, currency)
        )
      ),
      el('div', { class: 'span-2' }, field('Job description', description, 'job-desc')),
      el(
        'div',
        { class: 'span-2 field' },
        el('label', {}, 'Scorecard rubric'),
        rubricRows,
        el('div', { class: 'input-row' }, addDimension),
        el(
          'p',
          { class: 'muted small' },
          'What interviewers rate on this job’s scorecards. Feedback already written keeps the dimensions it was rated against; remove every row to return to the default rubric.'
        )
      ),
      el(
        'div',
        { class: 'span-2 field' },
        el('label', {}, 'Screening questions'),
        questionRows,
        el('div', { class: 'input-row' }, addQuestion),
        el(
          'p',
          { class: 'muted small' },
          'Asked on the published job page, below name and email, and captured onto the candidate. Mark a yes/no question “Must be yes” to flag applications that answer otherwise — nothing is rejected automatically.'
        )
      ),
      field('Status', status, 'job-status'),
      field('Applications close', closesOn, 'job-closes'),
      el('div', { class: 'span-2' }, errors.node)
    ),
    footer: [el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'), save],
  });
}

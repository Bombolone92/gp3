/**
 * Interview guides: the settings editor, and the read-during-the-call view.
 *
 * A guide is a named list of questions, each optionally feeding one of the
 * scorecard's rating dimensions, plus the interview formats and pipeline
 * stages it should be offered for by default.
 */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { uid } from '../lib/id.js';
import { field, focusAfterRemoval } from './components.js';
import { ignoreChanges, notifyChanged, openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { guideAppliesText, guidesFrom, MAX_GUIDES, MAX_GUIDE_NAME, MAX_GUIDE_QUESTIONS, MAX_QUESTION_TEXT } from '../core/guides.js';
import { INTERVIEW_TYPES } from '../core/interviews.js';
import { stagesFrom } from '../core/pipeline.js';
import { RATING_FIELDS, ratingFieldsForJob } from '../core/scorecards.js';
import { plural } from '../lib/format.js';

/**
 * Every rating dimension a question could feed: the default rubric plus
 * whatever custom dimensions the jobs use, since a guide is shared across
 * jobs but a rubric is not.
 */
export function dimensionOptions(state) {
  const seen = new Map();
  for (const f of RATING_FIELDS) seen.set(f.key, f.label);
  for (const job of state.jobs) {
    for (const f of ratingFieldsForJob(job)) if (!seen.has(f.key)) seen.set(f.key, f.label);
  }
  return [...seen.entries()].map(([key, label]) => ({ value: key, label }));
}

/** Settings editor for the account's guides. */
export function openGuidesEditor(ctx) {
  const { store } = ctx;
  const settings = store.state.settings;
  const stages = stagesFrom(settings);
  const stageKeys = new Set(stages.map((s) => s.key));
  const dimensions = dimensionOptions(store.state);
  const dimensionKeys = new Set(dimensions.map((d) => d.value));
  const draft = guidesFrom(settings).map((g) => ({
    ...g,
    // The same story as the stages below: a rating dimension removed from
    // the job whose rubric minted it leaves its key on every question
    // that fed it, and the picker — which lists the dimensions that
    // actually exist — then showed "No dimension" for a question that
    // still carried one. The attachment is dead either way, since a new
    // dimension is minted with a new key and the default rubric's keys
    // are always listed, so nothing can match it again. Drop it, and let
    // the next save forget it.
    questions: g.questions.map((q) => ({ ...q, field: dimensionKeys.has(q.field) ? q.field : '' })),
    types: [...g.types],
    // A stage removed in Settings leaves its key behind on every guide
    // that named it, with no checkbox left to clear it — and the coverage
    // line below printed the bare id ("Currently: Onsite · stg_takehome").
    // The attachment is dead either way: a candidate's stage is always one
    // of the configured ones, so nothing can match it again. Drop it, and
    // let the next save forget it.
    stages: g.stages.filter((key) => stageKeys.has(key)),
  }));
  let current = draft[0]?.id ?? null;

  const body = el('div', { style: { display: 'contents' } });

  const save = el('button', { class: 'btn btn-primary' }, 'Save guides');
  save.addEventListener('click', async () => {
    const unnamed = draft.find((g) => !g.name.trim());
    if (unnamed) {
      toast('Every guide needs a name.', 'error');
      return;
    }
    const empty = draft.find((g) => g.questions.every((q) => !q.text.trim()));
    if (empty) {
      toast(`“${empty.name}” has no questions yet. Add one, or remove the guide.`, 'error');
      return;
    }
    save.disabled = true;
    try {
      await store.updateSettings({
        guides: draft.map((g) => ({
          id: g.id,
          name: g.name.trim(),
          types: g.types,
          stages: g.stages,
          questions: g.questions.filter((q) => q.text.trim()).map((q) => ({ id: q.id, text: q.text.trim(), field: q.field || '' })),
        })),
      });
      modal.close();
      toast('Interview guides saved');
    } catch (err) {
      save.disabled = false;
      toast(err.message, 'error');
    }
  });

  const modal = openModal({
    title: 'Interview guides',
    wide: true,
    content: body,
    footer: [el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'), save],
  });

  function addGuide() {
    if (draft.length >= MAX_GUIDES) {
      toast(`Keep it to ${MAX_GUIDES} guides.`, 'error');
      return;
    }
    const guide = { id: uid('gd'), name: '', questions: [{ id: uid('q'), text: '', field: '' }], types: [], stages: [] };
    draft.push(guide);
    current = guide.id;
    render();
    notifyChanged(body);
    body.querySelector('.guide-name')?.focus();
  }

  function render() {
    const guide = draft.find((g) => g.id === current) ?? null;

    const picker = el(
      'select',
      {
        class: 'select',
        'aria-label': 'Guide',
        onChange: (e) => {
          current = e.target.value;
          render();
        },
      },
      draft.map((g) => el('option', { value: g.id, selected: g.id === current }, g.name || 'Untitled guide'))
    );
    // Choosing which guide is on screen is navigation, not an edit — the
    // same reason the Settings template picker keeps out of the tracker.
    ignoreChanges(picker);

    const header = el(
      'div',
      { class: 'input-row wrap' },
      draft.length > 0 ? picker : el('span', { class: 'muted small' }, 'No guides yet.'),
      el('button', { class: 'btn btn-sm', onClick: addGuide }, icon('plus', 14), 'New guide')
    );

    if (!guide) {
      body.replaceChildren(
        header,
        el(
          'p',
          { class: 'muted small' },
          'A guide is the set of questions behind an interview: write one for your phone screen, attach it to that format, and every screen asks the same things — which is what makes the ratings comparable.'
        )
      );
      return;
    }

    const name = el('input', {
      class: 'input guide-name',
      type: 'text',
      value: guide.name,
      // Storage trims to this; without the cap here a longer name was
      // silently shortened on save, under a toast saying it had saved.
      maxlength: String(MAX_GUIDE_NAME),
      placeholder: 'e.g. Phone screen',
      onInput: (e) => {
        guide.name = e.target.value;
        // Keep the picker honest as the name is typed; re-rendering the
        // whole body would take the focus out of this field.
        const option = [...picker.options].find((o) => o.value === guide.id);
        if (option) option.textContent = guide.name || 'Untitled guide';
      },
    });

    const rows = el('div', { class: 'guide-editor' });
    const questionsLabel = el('label', {}, `Questions (${plural(guide.questions.length, 'question')})`);
    const appliesHint = el('p', { class: 'muted small' });
    const paintApplies = () => {
      appliesHint.textContent = `Scheduling an interview picks the best match by itself; formats win over stages. Currently: ${guideAppliesText(
        { types: guide.types, stages: guide.stages },
        (key) => stages.find((s) => s.key === key)?.label ?? key
      )}.`;
    };
    paintApplies();
    function renderRows() {
      questionsLabel.textContent = `Questions (${plural(guide.questions.length, 'question')})`;
      rows.replaceChildren(
        ...guide.questions.map((q, i) => {
          const text = el('input', {
            class: 'input',
            type: 'text',
            value: q.text,
            maxlength: String(MAX_QUESTION_TEXT),
            placeholder: 'e.g. Walk me through a system you designed end to end',
            'aria-label': `Question ${i + 1}`,
            onInput: (e) => {
              q.text = e.target.value;
            },
          });
          const dimension = el(
            'select',
            {
              class: 'select guide-dimension',
              'aria-label': `Rating dimension for question ${i + 1}`,
              onChange: (e) => {
                q.field = e.target.value;
              },
            },
            el('option', { value: '', selected: !q.field }, 'No dimension'),
            dimensions.map((d) => el('option', { value: d.value, selected: d.value === q.field }, d.label))
          );
          return el(
            'div',
            { class: 'guide-editor-row' },
            el('span', { class: 'slot-editor-index tnum' }, `${i + 1}.`),
            text,
            dimension,
            el(
              'button',
              {
                class: 'btn btn-ghost btn-icon btn-sm btn-icon-danger',
                'aria-label': `Remove question ${i + 1}`,
                title: 'Remove question',
                onClick: () => {
                  guide.questions.splice(i, 1);
                  renderRows();
                  notifyChanged(rows);
                  focusAfterRemoval(rows, '.btn', i, addQuestion);
                },
              },
              icon('x', 14)
            )
          );
        })
      );
    }
    renderRows();

    const addQuestion = el(
      'button',
      {
        class: 'btn btn-sm',
        onClick: () => {
          if (guide.questions.length >= MAX_GUIDE_QUESTIONS) {
            toast(`A guide holds up to ${MAX_GUIDE_QUESTIONS} questions.`, 'error');
            return;
          }
          guide.questions.push({ id: uid('q'), text: '', field: '' });
          renderRows();
          notifyChanged(rows);
          rows.querySelectorAll('.guide-editor-row .input').item(guide.questions.length - 1)?.focus();
        },
      },
      icon('plus', 14),
      'Add question'
    );

    const check = (id, label, checked, onChange) => {
      const box = el('input', { type: 'checkbox', class: 'task-check', id, checked });
      box.addEventListener('change', () => {
        onChange(box.checked);
        paintApplies();
      });
      return el('label', { class: 'task-label day-check', for: id }, box, el('span', {}, label));
    };

    const remove = el(
      'button',
      {
        class: 'btn btn-danger btn-sm',
        onClick: async () => {
          const ok = await confirmDialog({
            title: `Remove “${guide.name || 'this guide'}”?`,
            message: 'Feedback already written keeps the questions it was written against; only the guide itself goes.',
            confirmLabel: 'Remove guide',
            danger: true,
          });
          if (!ok) return;
          draft.splice(draft.indexOf(guide), 1);
          current = draft[0]?.id ?? null;
          render();
          notifyChanged(body);
        },
      },
      icon('trash', 14),
      'Remove guide'
    );

    body.replaceChildren(
      header,
      field('Guide name', name, 'guide-name'),
      el(
        'div',
        { class: 'field' },
        questionsLabel,
        rows,
        el('div', { class: 'input-row' }, addQuestion),
        el(
          'p',
          { class: 'muted small' },
          'Tie a question to a rating dimension and the scorecard puts them side by side, so the note and the rating are written from the same evidence.'
        )
      ),
      el(
        'div',
        { class: 'field' },
        el('label', {}, 'Offer this guide for'),
        el('div', { class: 'day-checks' }, INTERVIEW_TYPES.map((t) => check(`guide-type-${t.value}`, t.label, guide.types.includes(t.value), (on) => {
          guide.types = on ? [...new Set([...guide.types, t.value])] : guide.types.filter((v) => v !== t.value);
        }))),
        el('div', { class: 'day-checks' }, stages.map((s) => check(`guide-stage-${s.key}`, s.label, guide.stages.includes(s.key), (on) => {
          guide.stages = on ? [...new Set([...guide.stages, s.key])] : guide.stages.filter((v) => v !== s.key);
        }))),
        appliesHint
      ),
      el('div', { class: 'input-row' }, remove)
    );
  }

  render();
}

/**
 * The guide behind one interview, laid out to be read while the call is
 * happening — and printable, because that is how half of us read it.
 */
export function openGuideView(ctx, guide, { candidate = null, interview = null } = {}) {
  const dimensions = new Map(dimensionOptions(ctx.store.state).map((d) => [d.value, d.label]));
  const modal = openModal({
    title: guide.name,
    wide: true,
    content: el(
      'div',
      { class: 'guide-view' },
      candidate
        ? el(
            'p',
            { class: 'muted small' },
            [candidate.name, interview ? `${plural(guide.questions.length, 'question')}` : null].filter(Boolean).join(' · ')
          )
        : null,
      el(
        'ol',
        { class: 'guide-list' },
        guide.questions.map((q) =>
          el(
            'li',
            {},
            el('span', { class: 'guide-question' }, q.text),
            q.field && dimensions.has(q.field)
              ? el('span', { class: 'guide-dimension-tag' }, dimensions.get(q.field))
              : null
          )
        )
      )
    ),
    footer: [
      el('button', { class: 'btn', onClick: () => window.print() }, icon('printer', 15), 'Print'),
      el('span', { class: 'grow' }),
      el('button', { class: 'btn btn-primary', onClick: () => modal.close() }, 'Done'),
    ],
  });
}

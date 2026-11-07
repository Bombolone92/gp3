/** Add / edit a scorecard: per-skill ratings plus an overall recommendation. */
import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { field } from '../components.js';
import { notifyChanged, openModal } from '../modal.js';
import { toast } from '../toast.js';
import { RECOMMENDATIONS, ratingFieldsForJob, ratingFieldsForScorecard } from '../../core/scorecards.js';
import { defaultGuideFor, findGuide, MAX_GUIDE_ANSWER } from '../../core/guides.js';
import { errorRegion, runSave } from './form.js';

/**
 * Wire the ARIA radio-group pattern onto a row of role="radio" buttons:
 * Arrow/Home/End movement that checks the radio it lands on. Roving
 * tabindex (one tab stop per group) is the caller's paint duty.
 */
function radioGroupKeys(group, buttons, pick) {
  group.addEventListener('keydown', (e) => {
    const from = buttons.indexOf(e.target.closest?.('button'));
    if (from < 0) return;
    let to = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (from + 1) % buttons.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (from - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = buttons.length - 1;
    if (to === null) return;
    e.preventDefault();
    pick(to);
    buttons[to].focus();
  });
}

/** Accessible 1–5 star picker (radiogroup). Click the current value to clear. */
function starPicker(label, initial, onChange) {
  let value = initial ?? null;
  const buttons = [];
  const group = el('div', { class: 'star-picker', role: 'radiogroup', 'aria-label': label });

  const paint = () => {
    buttons.forEach((btn, i) => {
      btn.setAttribute('aria-checked', String(value === i + 1));
      btn.classList.toggle('is-filled', value !== null && i < value);
      // One tab stop per group: the checked star, or the first.
      btn.tabIndex = (value === null ? i === 0 : value === i + 1) ? 0 : -1;
    });
  };

  const select = (next) => {
    value = next;
    onChange(value);
    paint();
    // Ratings are the substance of this form; without this the dialog
    // still counts as untouched and Escape throws them away silently.
    notifyChanged(group);
  };

  for (let i = 1; i <= 5; i++) {
    const btn = el(
      'button',
      {
        type: 'button',
        role: 'radio',
        class: 'star-btn',
        'aria-label': `${i} out of 5`,
        onClick: () => select(value === i ? null : i),
      },
      icon('star', 18)
    );
    buttons.push(btn);
    group.appendChild(btn);
  }
  radioGroupKeys(group, buttons, (i) => select(i + 1));
  paint();
  return group;
}

export function openScorecardEditor(ctx, { candidate, interviewId = null, scorecard = null }) {
  const isNew = !scorecard;
  const errors = errorRegion();
  const ratings = { ...(scorecard?.ratings ?? {}) };
  let recommendation = scorecard?.recommendation ?? null;

  // New feedback rates against the job's rubric; existing feedback keeps
  // the dimensions it was written with, even if the rubric changed since.
  const job = ctx.store.state.jobs.find((j) => j.id === candidate.jobId);
  const ratingFields = isNew ? ratingFieldsForJob(job) : ratingFieldsForScorecard(scorecard);

  const author = el('input', { class: 'input', type: 'text', value: scorecard?.author ?? '', placeholder: 'Who is giving this feedback?' });
  const notes = el('textarea', { class: 'textarea', rows: 4, placeholder: 'Evidence and examples, not just impressions.' });
  notes.value = scorecard?.notes ?? '';

  /* The guide this interview was run from: its questions become note
     fields, each sitting with the dimension it feeds so the note and the
     rating are written from the same evidence. Existing feedback shows
     what it was written against, not what the guide says today. */
  const settings = ctx.store.state.settings;
  const linkedId = interviewId ?? scorecard?.interviewId ?? null;
  const interview = linkedId ? ctx.store.state.interviews.find((i) => i.id === linkedId) : null;
  const guide =
    findGuide(settings, interview?.guideId) ??
    (isNew && !interview ? defaultGuideFor(settings, { stage: candidate.stage }) : null);
  const snapshot = isNew ? null : (scorecard.guideAnswers ?? null);
  // The name stays whatever this feedback was written under; editing must
  // not re-label a record after the fact.
  const guideName = isNew ? (guide?.name ?? '') : (scorecard?.guideName ?? '');
  // Questions to ask for. New feedback asks what the guide asks now.
  // Editing asks the same — plus anything this feedback answered that the
  // guide has since dropped, so nothing already written disappears.
  //
  // An unanswered question is not stored (the snapshot holds pairs), so
  // rebuilding the form from the snapshot alone quietly removed every
  // question the reviewer had skipped: saving a half-written debrief
  // during the call and coming back to finish it left no box to finish it
  // in, and nothing on screen saying where the questions had gone.
  const guideQuestions = [];
  const key = (text) => String(text ?? '').trim().toLowerCase();
  const seenQuestions = new Set();
  const askFor = (question, field) => {
    if (!key(question) || seenQuestions.has(key(question))) return;
    seenQuestions.add(key(question));
    guideQuestions.push({ question, field: field ?? '' });
  };
  // A scorecard with no guide behind it keeps none: the first edit of
  // plain feedback must not sprout question boxes.
  if (isNew || snapshot?.length || scorecard?.guideName) {
    for (const q of guide?.questions ?? []) askFor(q.text, q.field);
  }
  for (const a of snapshot ?? []) askFor(a.question, a.field);
  // Matched loosely, so a guide reworded only in case or spacing keeps the
  // answer that was written against it instead of blanking the box.
  const answers = new Map((snapshot ?? []).map((a) => [key(a.question), a.answer]));
  const answerBoxes = guideQuestions.map((q) => {
    const box = el('textarea', {
      class: 'textarea',
      rows: 2,
      maxlength: String(MAX_GUIDE_ANSWER),
      placeholder: 'What they said',
      'aria-label': q.question,
    });
    box.value = answers.get(key(q.question)) ?? '';
    return { ...q, box };
  });
  const boxesByField = new Map();
  for (const entry of answerBoxes) {
    if (!entry.field) continue;
    const list = boxesByField.get(entry.field);
    if (list) list.push(entry);
    else boxesByField.set(entry.field, [entry]);
  }

  const questionBlock = (entry) =>
    el(
      'div',
      { class: 'guide-answer' },
      el('div', { class: 'guide-answer-q' }, entry.question),
      entry.box
    );

  const ratingRows = ratingFields.map((f) => {
    const row = el(
      'div',
      { class: 'rating-row' },
      el('span', { class: 'rating-label' }, f.label),
      starPicker(f.label, ratings[f.key] ?? null, (v) => {
        if (v === null) delete ratings[f.key];
        else ratings[f.key] = v;
      })
    );
    const asked = boxesByField.get(f.key) ?? [];
    // The dimension's row stays a single line of label and stars; its
    // questions hang below it, inside a group so neither has to change
    // shape for the other.
    return asked.length === 0
      ? row
      : el('div', { class: 'rating-group' }, row, el('div', { class: 'guide-answers' }, asked.map(questionBlock)));
  });

  // Questions tied to no dimension — or to one this job's rubric does not
  // use — still need somewhere to be answered.
  const rubricKeys = new Set(ratingFields.map((f) => f.key));
  const looseAnswers = answerBoxes.filter((entry) => !entry.field || !rubricKeys.has(entry.field));

  const recBtns = [];
  const paintRecs = () => {
    recBtns.forEach((btn, i) => {
      const checked = recommendation === RECOMMENDATIONS[i].value;
      btn.setAttribute('aria-checked', String(checked));
      // One tab stop per group: the checked option, or the first.
      btn.tabIndex = (recommendation == null ? i === 0 : checked) ? 0 : -1;
    });
  };
  const pickRec = (i) => {
    recommendation = RECOMMENDATIONS[i].value;
    paintRecs();
    notifyChanged(recButtons);
  };
  const recButtons = el(
    'div',
    { class: 'rec-picker', role: 'radiogroup', 'aria-label': 'Overall recommendation' },
    RECOMMENDATIONS.map((r, i) => {
      const btn = el(
        'button',
        { type: 'button', role: 'radio', class: `rec-btn rec-${r.value}`, onClick: () => pickRec(i) },
        r.label
      );
      recBtns.push(btn);
      return btn;
    })
  );
  radioGroupKeys(recButtons, recBtns, pickRec);
  paintRecs();

  const save = el('button', { class: 'btn btn-primary' }, isNew ? 'Save scorecard' : 'Save changes');
  save.addEventListener('click', async () => {
    const data = {
      author: author.value,
      ratings,
      recommendation,
      notes: notes.value,
      guideName,
      guideAnswers: answerBoxes.map((entry) => ({ question: entry.question, field: entry.field, answer: entry.box.value })),
    };
    const ok = await runSave(save, errors, async () => {
      if (isNew) await ctx.store.addScorecard({ candidateId: candidate.id, interviewId, ...data });
      else await ctx.store.updateScorecard(scorecard.id, data);
    });
    if (ok) {
      modal.close();
      toast('Scorecard saved');
    }
  });

  const modal = openModal({
    title: isNew ? `Scorecard for ${candidate.name}` : 'Edit scorecard',
    content: [
      field('Reviewer', author, 'sc-author'),
      guideName
        ? el('p', { class: 'muted small' }, `Guide: ${guideName}. Each question is answered beside the dimension it feeds.`)
        : null,
      el('div', { class: 'field' }, el('label', {}, 'Ratings'), el('div', { class: 'rating-grid' }, ratingRows)),
      looseAnswers.length > 0
        ? el(
            'div',
            { class: 'field' },
            el('label', {}, 'Other guide questions'),
            el('div', { class: 'guide-answers' }, looseAnswers.map(questionBlock))
          )
        : null,
      el('div', { class: 'field' }, el('label', {}, 'Overall recommendation'), recButtons),
      field('Notes', notes, 'sc-notes'),
      errors.node,
    ],
    footer: [el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'), save],
  });
}

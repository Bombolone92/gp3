/** Schedule / edit an interview, with live interviewer-conflict warnings. */
import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { field, focusAfterRemoval } from '../components.js';
import { openModal } from '../modal.js';
import { toast } from '../toast.js';
import {
  committedInterviews,
  INTERVIEW_TYPES,
  interviewConflicts,
  interviewTimeWithZone,
  isProposed,
  MAX_PROPOSAL_SLOTS,
  parseInterviewers,
  secondReading,
  suggestSlots,
} from '../../core/interviews.js';
import { isActive } from '../../core/pipeline.js';
import { addDays, formatDate, formatTime, todayISO, toMinutes } from '../../lib/dates.js';
import { browserTimeZone } from '../../lib/zones.js';
import { defaultGuideFor, guidesFrom } from '../../core/guides.js';
import { composeEmail } from '../email.js';
import { slotVars } from '../views/candidate.js';
import { errorRegion, optionSelect, runSave, linkValue, timeZoneSelect } from './form.js';

/** The time a fresh interview opens on, and the length it assumes. */
const DEFAULT_START = '10:00';
const DEFAULT_END = '11:00';

/**
 * The day a new interview opens on: today while its default time is
 * still ahead, tomorrow once it has gone by. The form used to open on
 * today at 10:00 whatever the clock said, so every interview scheduled
 * after ten in the morning was pre-filled with a time in the past — and
 * "Propose times" copies those defaults into its first two options, so a
 * candidate could be offered two slots that had already happened. The
 * app's own slot suggester refuses to offer anything less than two hours
 * out; the form should not undercut it.
 */
function defaultInterviewDate(now = new Date()) {
  const today = todayISO(now);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  return toMinutes(DEFAULT_START) > minutesNow ? today : addDays(today, 1);
}

export function openInterviewEditor(ctx, interview = null, { candidateId = null } = {}) {
  const isNew = !interview;
  const { store } = ctx;
  const errors = errorRegion();

  const fixedCandidate = candidateId
    ? store.state.candidates.find((c) => c.id === candidateId)
    : interview
      ? store.state.candidates.find((c) => c.id === interview.candidateId)
      : null;
  const eligible = fixedCandidate ? [fixedCandidate] : store.state.candidates.filter(isActive);
  if (eligible.length === 0) {
    // Having candidates and having someone to interview are different
    // problems: "add a candidate first" reads like a bug to someone
    // looking at a full archive tab, and hides the one-click fix.
    toast(
      store.state.candidates.length === 0
        ? 'Add a candidate first, then schedule their interview.'
        : 'Every candidate is archived. Restore one, or re-engage a talent-pool member, to schedule an interview.',
      'error'
    );
    return;
  }

  const candidateSelect = el(
    'select',
    { class: 'select', disabled: Boolean(fixedCandidate) },
    eligible.map((c) => {
      const job = store.state.jobs.find((j) => j.id === c.jobId);
      return el(
        'option',
        { value: c.id, selected: c.id === (fixedCandidate?.id ?? interview?.candidateId) },
        `${c.name}${job ? ` · ${job.title}` : ''}`
      );
    })
  );

  const date = el('input', { class: 'input', type: 'date', value: interview?.date ?? defaultInterviewDate() });
  // The pair shares one visual "Time" label; name each input for AT.
  const start = el('input', { class: 'input', type: 'time', value: interview?.start ?? DEFAULT_START, 'aria-label': 'Start time' });
  const end = el('input', { class: 'input', type: 'time', value: interview?.end ?? DEFAULT_END, 'aria-label': 'End time' });
  const type = optionSelect(INTERVIEW_TYPES, interview?.type ?? 'video');
  /* The zone those two times are in. New interviews follow the account
     default, and failing that this device — the answer almost every time,
     and the one the times were typed against. */
  const settings = store.state.settings;
  const zone = timeZoneSelect(interview?.timeZone || settings.timeZone || browserTimeZone());
  const interviewers = el('input', {
    class: 'input',
    type: 'text',
    value: (interview?.interviewers ?? []).join(', '),
    placeholder: 'Names, comma-separated',
  });
  const location = el('input', { class: 'input', type: 'text', value: interview?.location ?? '', placeholder: 'Office, room, or address' });
  const meetingLink = el('input', { class: 'input', type: 'url', value: interview?.meetingLink ?? '', placeholder: 'https://… (video call link)' });
  const notes = el('textarea', { class: 'textarea', rows: 2, placeholder: 'Focus areas, panel notes.' });
  notes.value = interview?.notes ?? '';

  /* The question set this interview runs from. It follows the format (and
     the candidate's stage) until the user picks one by hand — an interview
     already scheduled keeps whatever it was given. */
  const guides = guidesFrom(store.state.settings);
  let guideTouched = Boolean(interview?.guideId);
  const guideSelect = el(
    'select',
    { class: 'select', onChange: () => (guideTouched = true) },
    el('option', { value: '' }, guides.length > 0 ? 'No guide' : 'No guides yet — add them in Settings'),
    guides.map((g) => el('option', { value: g.id, selected: g.id === interview?.guideId }, g.name))
  );
  const suggestGuide = () => {
    if (guideTouched) return;
    const candidate = store.state.candidates.find((c) => c.id === candidateSelect.value);
    guideSelect.value = defaultGuideFor(store.state.settings, { type: type.value, stage: candidate?.stage })?.id ?? '';
  };

  // Non-blocking conflict warning, recomputed as the form changes.
  const conflictBox = el('div', { class: 'error-region', 'aria-live': 'polite' });
  const draftOf = () => ({
    id: interview?.id ?? 'new',
    candidateId: candidateSelect.value,
    date: date.value,
    start: start.value,
    end: end.value,
    timeZone: zone.value,
    interviewers: parseInterviewers(interviewers.value),
  });
  const checkConflicts = () => {
    conflictBox.replaceChildren();
    // Options are questions, not bookings: the warning belongs to the
    // moment one is confirmed, which is where it runs.
    if (mode === 'propose') return;
    const clashes = interviewConflicts(draftOf(), committedInterviews(store.state.interviews, store.state.candidates));
    if (clashes.length === 0) return;
    const first = clashes[0];
    const who = store.state.candidates.find((c) => c.id === first.candidateId)?.name ?? 'another candidate';
    conflictBox.appendChild(
      el(
        'div',
        { class: 'form-note' },
        icon('warning', 15),
        // Named with its zone: the clash may well be the reason two slots
        // that look an hour apart are actually the same hour.
        `Overlaps ${who}’s interview at ${interviewTimeWithZone(first, first.start, settings)} (same people or candidate). You can still save.`
      )
    );
  };

  /* What the slot reads as, in its own zone and — when we know it — on the
     candidate's clock. This is the whole point of storing a zone: the
     arithmetic stops happening in the user's head. */
  const zoneHint = el('p', { class: 'muted small' });
  const updateZoneHint = () => {
    const draft = draftOf();
    const candidate = store.state.candidates.find((c) => c.id === candidateSelect.value);
    // In propose mode the zone applies to every option, so the hint reads
    // the first one rather than the (hidden) fixed-time row.
    const first = mode === 'propose' ? slotDraft[0] : null;
    if (first) Object.assign(draft, first);
    const span =
      mode === 'propose'
        ? `${slotDraft.length} options · first: ${formatDate(draft.date)} ${formatTime(draft.start)} – ${interviewTimeWithZone(draft, draft.end, settings)}`
        : `${formatTime(draft.start)} – ${interviewTimeWithZone(draft, draft.end, settings)}`;
    const theirs = candidate?.timeZone ? secondReading(draft, candidate.timeZone, settings) : '';
    // replaceChildren stringifies null into a literal "null" text node.
    zoneHint.replaceChildren(
      ...[
        theirs ? `${span} · ${theirs} for ${candidate.name.split(' ')[0]}` : span,
        candidate && !candidate.timeZone ? ' · add their time zone on the profile to see their reading too' : null,
      ].filter(Boolean)
    );
  };
  for (const input of [candidateSelect, type]) {
    input.addEventListener('change', suggestGuide);
  }
  for (const input of [candidateSelect, date, start, end, interviewers, zone]) {
    input.addEventListener('input', () => {
      checkConflicts();
      updateZoneHint();
    });
    input.addEventListener('change', () => {
      checkConflicts();
      updateZoneHint();
    });
  }
  // Both run once the mode is known, from applyMode() at the end of this
  // function: the form opens pre-filled with a real, submittable slot
  // (today, 10:00–11:00, the profile's candidate), so a double-booking
  // saved without touching a field still warns.

  /* Two ways to book: one fixed time, or a short list of options the
     candidate picks from. Proposing is the common case for a first call —
     the round trip used to happen entirely outside the app. */
  let mode = isProposed(interview) ? 'propose' : 'fixed';
  const slotDraft = (interview?.slots ?? []).map((slot) => ({ ...slot }));
  const slotRows = el('div', { class: 'slot-editor' });

  function renderSlotRows() {
    slotRows.replaceChildren(
      ...slotDraft.map((slot, i) => {
        const dateInput = el('input', {
          class: 'input',
          type: 'date',
          value: slot.date,
          'aria-label': `Option ${i + 1} date`,
          onInput: (e) => {
            slot.date = e.target.value;
            updateZoneHint();
          },
        });
        const endInput = el('input', {
          class: 'input',
          type: 'time',
          value: slot.end,
          'aria-label': `Option ${i + 1} end time`,
          onInput: (e) => {
            slot.end = e.target.value;
            updateZoneHint();
          },
        });
        const startInput = el('input', {
          class: 'input',
          type: 'time',
          value: slot.start,
          'aria-label': `Option ${i + 1} start time`,
          onInput: (e) => {
            slot.start = e.target.value;
            // Keep the length the user chose: moving an option should not
            // silently turn a 60-minute screen into a 15-minute one.
            // The end field is written in place: re-rendering the rows
            // here would replace the very input being typed into, and a
            // time field fires `input` on each digit — the first one
            // would take the caret with it.
            const length = (toMinutes(slot.end) ?? 0) - (toMinutes(slot.start) ?? 0);
            if (length <= 0) {
              slot.end = shiftTime(slot.start, 60);
              endInput.value = slot.end;
            }
            updateZoneHint();
          },
        });
        return el(
          'div',
          { class: 'slot-editor-row' },
          el('span', { class: 'slot-editor-index tnum' }, `${i + 1}.`),
          dateInput,
          el('div', { class: 'input-row' }, startInput, el('span', { class: 'input-sep', 'aria-hidden': 'true' }, '–'), endInput),
          el(
            'button',
            {
              class: 'btn btn-ghost btn-icon btn-sm btn-icon-danger',
              'aria-label': `Remove option ${i + 1}`,
              title: 'Remove option',
              onClick: () => {
                slotDraft.splice(i, 1);
                renderSlotRows();
                updateZoneHint();
                focusAfterRemoval(slotRows, '.btn', i, addSlot);
              },
            },
            icon('x', 14)
          )
        );
      })
    );
  }

  const addSlot = el(
    'button',
    {
      class: 'btn btn-sm',
      onClick: () => {
        if (slotDraft.length >= MAX_PROPOSAL_SLOTS) {
          errors.show(`Four options is plenty — more reads as indecision than as flexibility.`);
          return;
        }
        const last = slotDraft.at(-1);
        slotDraft.push(
          last
            ? { date: last.date, start: shiftTime(last.start, 60), end: shiftTime(last.end, 60) }
            : { date: date.value, start: start.value, end: end.value }
        );
        renderSlotRows();
        updateZoneHint();
      },
    },
    icon('plus', 14),
    'Add option'
  );

  const suggest = el(
    'button',
    {
      class: 'btn btn-sm',
      title: 'Fill the options with open windows in your working week',
      onClick: () => {
        const duration = Math.max(15, (toMinutes(end.value) ?? 60) - (toMinutes(start.value) ?? 0));
        const found = suggestSlots(committedInterviews(store.state.interviews, store.state.candidates), {
          settings: store.state.settings,
          timeZone: zone.value,
          duration,
          count: 3,
        });
        if (found.length === 0) {
          errors.show('No open windows in your working hours over the next two weeks. Add options by hand, or widen the window in Settings.');
          return;
        }
        slotDraft.length = 0;
        slotDraft.push(...found);
        renderSlotRows();
        updateZoneHint();
      },
    },
    icon('sparkles', 14),
    'Suggest open times'
  );

  const sendEmail = el('input', {
    type: 'checkbox',
    class: 'task-check',
    id: 'itv-send-slots',
    checked: Boolean(store.state.candidates.find((c) => c.id === candidateSelect.value)?.email),
  });
  const emailRow = el(
    'label',
    { class: 'task-label', for: 'itv-send-slots' },
    sendEmail,
    el('span', {}, 'Open the email with these options afterwards')
  );

  // The single date belongs to the fixed-time mode: each proposed option
  // carries its own, so leaving it on screen invites editing a field that
  // no longer decides anything.
  const dateBox = field('Date', date, 'itv-date');
  const fixedBox = el(
    'div',
    { class: 'span-2' },
    field('Time', el('div', { class: 'input-row' }, start, el('span', { class: 'input-sep', 'aria-hidden': 'true' }, '–'), end))
  );
  const proposeBox = el(
    'div',
    { class: 'span-2 field' },
    el('label', {}, 'Options to offer'),
    slotRows,
    el('div', { class: 'input-row' }, addSlot, suggest),
    emailRow,
    el('p', { class: 'muted small' }, 'The candidate replies with the one that suits them; confirming it here turns this into a normal interview.')
  );

  const modeButton = (value, label) =>
    el(
      'button',
      {
        type: 'button',
        'aria-pressed': String(mode === value),
        onClick: () => {
          mode = value;
          applyMode();
        },
      },
      label
    );
  // Built once and re-labelled in place. Rebuilding the pair on every
  // switch replaced the button under the pointer, so pressing one threw
  // focus out of the dialog and onto <body> — the second press then
  // needed a fresh tab all the way in.
  const modeButtons = [modeButton('fixed', 'One fixed time'), modeButton('propose', 'Propose times')];
  const modeToggle = el(
    'div',
    { class: 'segmented', role: 'group', 'aria-label': 'How to book this interview' },
    modeButtons
  );
  const paintToggle = () => {
    modeButtons[0].setAttribute('aria-pressed', String(mode === 'fixed'));
    modeButtons[1].setAttribute('aria-pressed', String(mode === 'propose'));
  };

  function applyMode() {
    paintToggle();
    dateBox.style.display = mode === 'fixed' ? '' : 'none';
    fixedBox.style.display = mode === 'fixed' ? '' : 'none';
    proposeBox.style.display = mode === 'propose' ? '' : 'none';
    if (mode === 'propose' && slotDraft.length === 0) {
      slotDraft.push(
        { date: date.value, start: start.value, end: end.value },
        { date: date.value, start: shiftTime(start.value, 60), end: shiftTime(end.value, 60) }
      );
      renderSlotRows();
    }
    save.replaceChildren(mode === 'propose' ? (isNew ? 'Propose times' : 'Save options') : isNew ? 'Schedule' : 'Save changes');
    updateZoneHint();
    checkConflicts();
  }

  const save = el('button', { class: 'btn btn-primary' }, isNew ? 'Schedule' : 'Save changes');
  save.addEventListener('click', async () => {
    let proposed = null;
    const ok = await runSave(save, errors, async () => {
      // Inside runSave so a meeting link safeHttpUrl would reject (and
      // the Join button would therefore never show) fails the save
      // visibly instead of storing an inert value.
      const shared = {
        timeZone: zone.value,
        type: type.value,
        guideId: guideSelect.value,
        interviewers: parseInterviewers(interviewers.value),
        location: location.value,
        meetingLink: linkValue(meetingLink, 'The meeting link'),
        notes: notes.value,
      };
      if (mode === 'propose') {
        if (isNew) {
          proposed = await store.proposeInterview({ candidateId: candidateSelect.value, slots: slotDraft, ...shared });
        } else {
          proposed = await store.updateInterview(interview.id, { slots: slotDraft, ...shared });
        }
        return;
      }
      const data = { date: date.value, start: start.value, end: end.value, ...shared };
      if (isNew) await store.scheduleInterview({ candidateId: candidateSelect.value, ...data });
      // An edit that types a time into a proposal settles it: the options
      // are gone, and the record now states when the interview is.
      else await store.updateInterview(interview.id, { ...data, ...(isProposed(interview) ? { status: 'scheduled' } : {}) });
    });
    if (ok) {
      modal.close();
      toast(mode === 'propose' ? (isNew ? 'Times proposed' : 'Options updated') : isNew ? 'Interview scheduled' : 'Interview updated');
      const candidate = store.state.candidates.find((c) => c.id === (proposed?.candidateId ?? candidateSelect.value));
      if (mode === 'propose' && sendEmail.checked && candidate?.email && proposed) {
        const job = store.state.jobs.find((j) => j.id === candidate.jobId);
        composeEmail(ctx, 'slots', candidate, slotVars(proposed, job, store.state.settings));
      }
    }
  });

  const modal = openModal({
    title: isNew ? 'Schedule interview' : 'Edit interview',
    content: el(
      'div',
      { class: 'form-grid' },
      el('div', { class: 'span-2' }, field('Candidate', candidateSelect, 'itv-candidate')),
      dateBox,
      field('Format', type, 'itv-type'),
      el('div', { class: 'span-2' }, modeToggle),
      fixedBox,
      proposeBox,
      el('div', { class: 'span-2 field' }, el('label', { for: 'itv-zone' }, 'Time zone'), zone, zoneHint),
      guides.length > 0 ? el('div', { class: 'span-2' }, field('Interview guide', guideSelect, 'itv-guide')) : null,
      el('div', { class: 'span-2' }, field('Interviewers', interviewers, 'itv-people')),
      el('div', { class: 'span-2' }, field('Meeting link', meetingLink, 'itv-link')),
      el('div', { class: 'span-2' }, field('Location', location, 'itv-location')),
      el('div', { class: 'span-2' }, field('Notes', notes, 'itv-notes')),
      el('div', { class: 'span-2' }, conflictBox),
      el('div', { class: 'span-2' }, errors.node)
    ),
    footer: [el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'), save],
  });
  zone.id = 'itv-zone';
  renderSlotRows();
  applyMode();
  suggestGuide();
}

/** 'HH:MM' plus minutes, clamped to the day. */
function shiftTime(time, minutes) {
  const base = toMinutes(time);
  if (base === null) return time;
  const shifted = Math.min(23 * 60 + 59, base + minutes);
  return `${String(Math.floor(shifted / 60)).padStart(2, '0')}:${String(shifted % 60).padStart(2, '0')}`;
}

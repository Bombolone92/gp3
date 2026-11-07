/** Candidate profile: contact, interviews, scorecards, offer, onboarding, timeline. */
import { el } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import {
  addFromInput,
  avatar,
  badge,
  downloadFile,
  emptyState,
  iconButton,
  offerStatusBadge,
  progressBar,
  field,
  ratingStars,
  recommendationBadge,
  stageBadge,
  statusBadge,
  tagChip,
  tagInput,
} from '../components.js';
import { confirmDialog, openModal } from '../modal.js';
import { composeEmail } from '../email.js';
import { toast } from '../toast.js';
import { openCandidateEditor } from '../editors/candidate.js';
import { openConsiderDialog, openPoolDialog } from '../pool.js';
import { openFollowupDialog } from '../followups.js';
import { exportCandidate } from '../retention.js';
import { followupDue, sortFollowups } from '../../core/followups.js';
import { optionSelect } from '../editors/form.js';
import { openInterviewEditor } from '../editors/interview.js';
import { openScorecardEditor } from '../editors/scorecard.js';
import { openOfferEditor, openOfferLetter, openSignOffer } from '../editors/offer.js';
import { daysInStage, isActive, isHired, nextStage, stageLabel, stagesFrom } from '../../core/pipeline.js';
import {
  interviewHasEnded,
  interviewTimeLabel,
  interviewTimeWithZone,
  interviewTypeInfo,
  interviewZone,
  isProposed,
  normalizeSlots,
  secondReading,
  slotHasPassed,
  slotOptionsText,
  sortByDateTime,
} from '../../core/interviews.js';
import { averageRating, summarizeScorecards } from '../../core/scorecards.js';
import { isOpenOffer, OFFER_STATUS, offerLetterText, offerTemplate } from '../../core/offers.js';
import { EMAIL_TEMPLATES, lastContactedAt, mailtoUrl } from '../../core/emails.js';
import { screeningMismatches } from '../../core/screening.js';
import { candidateTags, parseTags } from '../../core/tags.js';
import { findGuide } from '../../core/guides.js';
import { openGuideView } from '../guides.js';
import { groupTasks, hireStartDate, onboardingProgress } from '../../core/onboard.js';
import { startDateNote, taskDue } from './onboarding.js';
import { buildICS, icsFilename } from '../../lib/ics.js';
import { safeHttpUrl } from '../../lib/url.js';
import { formatDate, formatDateLong, formatTime, formatTimestamp, relativeDays, todayISO } from '../../lib/dates.js';
import { formatBytes, formatMoney, plural } from '../../lib/format.js';

export function renderCandidate(ctx, candidateId) {
  const { store } = ctx;
  const candidate = store.state.candidates.find((c) => c.id === candidateId);
  if (!candidate) {
    return emptyState({
      iconName: 'user',
      title: 'Candidate not found',
      message: 'They may have been deleted.',
      actions: [el('button', { class: 'btn', onClick: () => ctx.navigate('pipeline') }, 'Back to pipeline')],
    });
  }
  const job = store.state.jobs.find((j) => j.id === candidate.jobId);

  return [
    el('button', { class: 'btn btn-ghost back-link', onClick: () => ctx.navigate('pipeline') }, icon('arrow-left', 15), 'Pipeline'),
    profileHeader(ctx, candidate, job),
    el(
      'div',
      { class: 'detail-grid' },
      el(
        'div',
        { class: 'detail-col' },
        aboutCard(ctx, candidate, job),
        followupsCard(ctx, candidate),
        attachmentsCard(ctx, candidate),
        offerCard(ctx, candidate),
        timelineCard(ctx, candidate)
      ),
      el(
        'div',
        { class: 'detail-col' },
        isHired(candidate) && store.state.onboarding[candidate.id] ? onboardingCard(ctx, candidate) : null,
        interviewsCard(ctx, candidate),
        scorecardsCard(ctx, candidate)
      )
    ),
  ];
}

/* ---- Header with stage controls -------------------------------------- */

function profileHeader(ctx, candidate, job) {
  const { store } = ctx;
  const settings = store.state.settings;
  const active = isActive(candidate);
  const next = nextStage(candidate.stage, settings);

  const stageSelect = el(
    'select',
    {
      class: 'select stage-select',
      'aria-label': 'Stage',
      disabled: !active,
      dataset: { focusKey: `stage-select-${candidate.id}` },
    },
    stagesFrom(settings).map((s) => el('option', { value: s.key, selected: s.key === candidate.stage }, s.label))
  );
  stageSelect.addEventListener('change', async (e) => {
    try {
      await store.moveStage(candidate.id, e.target.value);
      toast(`Moved to ${stageLabel(e.target.value, settings)}`);
    } catch (err) {
      toast(err.message, 'error');
      ctx.refresh();
    }
  });

  const actions = el('div', { class: 'view-actions' });
  // Moving a candidate re-renders the profile, which replaces these
  // buttons — and a candidate is usually advanced more than once in a
  // sitting. Without a focus key the keyboard was dropped on <body> after
  // every move, leaving the whole sidebar to tab back through; the keys
  // hand focus to each button's successor, the way the nav and the
  // board's search box already do.
  const statusKey = `profile-status-${candidate.id}`;
  if (active && next) {
    actions.appendChild(
      el(
        'button',
        {
          class: 'btn btn-primary',
          dataset: { focusKey: `profile-advance-${candidate.id}` },
          onClick: async () => {
            try {
              await store.advanceStage(candidate.id);
              toast(`Moved to ${stageLabel(next, settings)}`);
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        },
        icon('arrow-right', 15),
        `Move to ${stageLabel(next, settings)}`
      )
    );
  }
  actions.appendChild(stageSelect);
  if (active) {
    actions.appendChild(
      // "Archive…" rather than "Reject": the dialog records either outcome,
      // and it matches the bulk bar's action for the same move.
      // Archive and Restore share a focus key: they are one control — "is
      // this person still in play?" — and each turns into the other, so
      // the key has to survive the swap for focus to survive it too.
      el(
        'button',
        { class: 'btn', dataset: { focusKey: statusKey }, onClick: () => openArchiveDialog(ctx, candidate) },
        icon('ban', 15),
        'Archive…'
      )
    );
  } else {
    actions.appendChild(
      el(
        'button',
        {
          class: 'btn',
          dataset: { focusKey: statusKey },
          onClick: async () => {
            await store.restoreCandidate(candidate.id);
            toast(`${candidate.name} restored`);
          },
        },
        icon('restore', 15),
        'Restore'
      )
    );
    if (candidate.pool) {
      actions.appendChild(
        el('button', { class: 'btn', onClick: () => openConsiderDialog(ctx, candidate) }, icon('user-plus', 15), 'Consider for job…')
      );
    }
    actions.appendChild(
      el(
        'button',
        { class: 'btn', onClick: () => openPoolDialog(ctx, candidate) },
        icon('bookmark', 15),
        candidate.pool ? 'Talent pool' : 'Add to talent pool'
      )
    );
  }
  actions.appendChild(
    iconButton({
      name: 'download',
      label: 'Export this candidate’s data (JSON)',
      size: 16,
      onClick: () => exportCandidate(ctx, candidate),
    })
  );
  actions.appendChild(iconButton({ name: 'pencil', label: 'Edit candidate', size: 16, onClick: () => openCandidateEditor(ctx, candidate) }));
  actions.appendChild(
    iconButton({
      name: 'trash',
      label: 'Delete candidate',
      size: 16,
      danger: true,
      onClick: async () => {
        // Attachments live in the user's own Puter drive, not in the app's
        // storage, and deleting a candidate takes their whole directory
        // with it. The retention review's confirm says so and the wipe's
        // does; this one listed everything except the resumes, which are
        // the one thing here that cannot be re-derived from anywhere.
        const files = candidate.attachments?.length ?? 0;
        const ok = await confirmDialog({
          title: `Delete ${candidate.name}?`,
          message: [
            'Their interviews, scorecards, offers, and onboarding plan are permanently removed.',
            files > 0 ? `${plural(files, 'uploaded file')} ${files === 1 ? 'is' : 'are'} deleted from your Puter drive too.` : null,
          ]
            .filter(Boolean)
            .join(' '),
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
        await store.deleteCandidate(candidate.id);
        ctx.navigate('pipeline');
        toast('Candidate deleted');
      },
    })
  );

  return el(
    'div',
    { class: 'profile-head card card-pad' },
    el(
      'div',
      { class: 'profile-id' },
      avatar(candidate.name, 'avatar-lg'),
      el(
        'div',
        {},
        el(
          'div',
          { class: 'title-row' },
          el('h1', { class: 'profile-name' }, candidate.name),
          statusBadge(candidate, settings),
          candidate.pool ? badge('Talent pool', 'accent') : null
        ),
        el(
          'p',
          { class: 'subtitle' },
          [
            job ? job.title : 'Job no longer exists',
            job && active ? `${plural(daysInStage(candidate), 'day')} in ${stageLabel(candidate.stage, settings)}` : null,
            // "Did I already reply to her?" — answerable without digging
            // through a mail client.
            lastContactedAt(candidate) ? `last contacted ${relativeDays(lastContactedAt(candidate))}` : null,
          ]
            .filter(Boolean)
            .join(' · ')
        ),
        contactRow(candidate)
      )
    ),
    actions
  );
}

/**
 * Archive one candidate: rejected or withdrawn, an optional reason kept on
 * the timeline, and — when we are the ones passing — an optional prefilled
 * rejection draft. The two kinds mirror the bulk archive dialog, which is
 * where the withdrawn status used to be reachable from.
 */
function openArchiveDialog(ctx, candidate) {
  const { store } = ctx;
  const job = store.state.jobs.find((j) => j.id === candidate.jobId);
  const kind = optionSelect(
    [
      { value: 'rejected', label: 'Rejected (we passed)' },
      { value: 'withdrawn', label: 'Withdrawn (they pulled out)' },
    ],
    'rejected'
  );
  const reason = el('input', { class: 'input', type: 'text', placeholder: 'Optional, kept on the timeline' });
  const emailCheck = el('input', { type: 'checkbox', class: 'task-check', id: 'reject-email' });
  const emailRow = candidate.email
    ? el(
        'label',
        { class: 'task-label', for: 'reject-email' },
        emailCheck,
        el('span', {}, 'Open a rejection email draft afterwards')
      )
    : null;
  // A rejection draft only makes sense when the company is doing the
  // rejecting — the same rule the bulk dialog applies to its email queue.
  kind.addEventListener('change', () => {
    if (emailRow) emailRow.style.display = kind.value === 'rejected' ? '' : 'none';
  });

  const archive = el('button', { class: 'btn btn-danger' }, icon('ban', 15), 'Archive');
  archive.addEventListener('click', async () => {
    archive.disabled = true;
    const withdrawn = kind.value === 'withdrawn';
    try {
      await store.rejectCandidate(candidate.id, { reason: reason.value, withdrawn });
    } catch (err) {
      archive.disabled = false;
      toast(err.message, 'error');
      return;
    }
    const sendEmail = !withdrawn && emailCheck.checked;
    modal.close();
    toast(`${candidate.name} ${withdrawn ? 'marked as withdrawn' : 'rejected'}`);
    if (sendEmail) composeEmail(ctx, 'reject', candidate, { job: job?.title ?? 'the role' });
  });

  const modal = openModal({
    title: `Archive ${candidate.name}?`,
    content: [
      el('p', { class: 'confirm-message' }, 'They move to the archive. You can restore them later; nothing is deleted.'),
      field('Archive as', kind, 'reject-kind'),
      field('Reason', reason, 'reject-reason'),
      emailRow,
    ],
    footer: [el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'), archive],
  });
}

function contactRow(candidate) {
  const chips = [];
  // Through mailtoUrl, not string interpolation: the stored address is
  // whatever was typed, imported, or parsed out of a pasted application,
  // and a raw '?' in it turns the rest into mailto headers — a chip that
  // opens a draft with a subject and body the applicant chose. Encoding
  // makes the whole value the recipient, the way every templated email
  // in the app already sends. A blank-but-truthy address yields no chip.
  const mailto = mailtoUrl(candidate.email);
  if (mailto) {
    chips.push(el('a', { class: 'contact-chip', href: mailto }, icon('mail', 13), candidate.email));
  }
  if (candidate.phone) {
    chips.push(el('a', { class: 'contact-chip', href: `tel:${candidate.phone.replace(/\s+/g, '')}` }, icon('phone', 13), candidate.phone));
  }
  const link = safeHttpUrl(candidate.link);
  if (link) {
    chips.push(
      el('a', { class: 'contact-chip', href: link, target: '_blank', rel: 'noreferrer' }, icon('external-link', 13), new URL(link).hostname)
    );
  }
  return chips.length ? el('div', { class: 'contact-row' }, chips) : null;
}

/* ---- About ------------------------------------------------------------ */

function aboutCard(ctx, candidate, job) {
  const rows = [
    ['Applied', `${formatTimestamp(candidate.createdAt)} (${relativeDays(candidate.createdAt)})`],
    ['Source', candidate.source || 'Unknown'],
    ['Job', job?.title ?? 'Deleted job'],
  ];
  return el(
    'div',
    { class: 'card card-pad' },
    el('h2', { class: 'card-title' }, 'Details'),
    el(
      'dl',
      { class: 'detail-list' },
      rows.map(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])
    ),
    tagEditor(ctx, candidate),
    candidate.notes ? el('p', { class: 'candidate-notes' }, candidate.notes) : null,
    answerList(candidate, job)
  );
}

/**
 * Tags, editable in place: chips with an × each, plus an entry box whose
 * typeahead offers the tags already in use. No dialog — labelling someone
 * is a two-second thought, and a modal turns it into a task.
 */
function tagEditor(ctx, candidate) {
  const { store } = ctx;
  const tags = candidateTags(candidate);
  const { input, datalist } = tagInput(store.state.candidates, {
    label: `Add a tag for ${candidate.name}`,
    focusKey: `tag-add-${candidate.id}`,
  });
  const add = () =>
    addFromInput(input, async (text) => {
      await store.setCandidateTags(candidate.id, [...candidateTags(candidate), ...parseTags(text)]);
    });
  input.addEventListener('keydown', (e) => e.key === 'Enter' && add());

  return el(
    'div',
    { class: 'tag-editor' },
    el('h3', { class: 'answer-list-title' }, 'Tags'),
    el(
      'div',
      { class: 'tag-row' },
      tags.map((tag) =>
        tagChip(tag, async () => {
          try {
            await store.setCandidateTags(
              candidate.id,
              candidateTags(candidate).filter((t) => t !== tag)
            );
          } catch (err) {
            toast(err.message, 'error');
          }
        })
      ),
      tags.length === 0 ? el('span', { class: 'muted small' }, 'No tags yet — “senior”, “needs sponsorship”, “referred by Ada”.') : null
    ),
    el('div', { class: 'task-add' }, input, datalist, el('button', { class: 'btn btn-sm', onClick: add }, icon('plus', 14), 'Add'))
  );
}

/**
 * What the applicant answered on the job page, as asked at the time —
 * answers are snapshotted, so a question the job has since reworded (or
 * dropped) still reads the way it was put to them. A must-have answered
 * with something other than yes is flagged, never filtered.
 */
function answerList(candidate, job) {
  const answers = candidate.answers ?? [];
  if (answers.length === 0) return null;
  const flagged = new Set(screeningMismatches(candidate, job).map((q) => q.label.trim().toLowerCase()));
  return el(
    'div',
    { class: 'answer-list' },
    el('h3', { class: 'answer-list-title' }, 'Screening answers'),
    answers.map((a) => {
      const mismatch = flagged.has(String(a.label).trim().toLowerCase());
      return el(
        'div',
        { class: 'answer-item' },
        el('div', { class: 'answer-q' }, a.label),
        el(
          'div',
          { class: `answer-a${mismatch ? ' is-flagged' : ''}` },
          mismatch
            ? el('span', { class: 'answer-flag', role: 'img', 'aria-label': 'Does not meet a must-have' }, icon('circle-alert', 13))
            : null,
          el('span', {}, a.answer)
        )
      );
    })
  );
}

/* ---- Follow-ups ---------------------------------------------------------- */

function followupsCard(ctx, candidate) {
  const { store } = ctx;
  const followups = sortFollowups(candidate.followups);
  const today = todayISO();

  const dueChip = (f) => {
    if (f.done) return el('span', { class: 'muted small' }, `done ${relativeDays(f.completedAt)}`);
    const dueToday = f.dueDate === today;
    // Lateness by the clock, like the overview and the reminders: a 9:00
    // follow-up read in the afternoon is late, and the chip said "today
    // 9:00 AM" as if it were still ahead. A time that has gone by is
    // named as the time, not as a date that is still "today".
    const overdue = Boolean(followupDue(f)?.overdue);
    return el(
      'span',
      { class: `followup-due tnum${overdue ? ' is-overdue' : dueToday ? ' is-today' : ''}` },
      icon(overdue ? 'circle-alert' : 'calendar-check', 12),
      overdue
        ? `was due ${dueToday && f.dueTime ? formatTime(f.dueTime) : formatDate(f.dueDate)}`
        : dueToday
          ? `today${f.dueTime ? ` ${formatTime(f.dueTime)}` : ''}`
          : formatDate(f.dueDate)
    );
  };

  return el(
    'div',
    { class: 'card' },
    el(
      'div',
      { class: 'card-title-row' },
      el('h2', { class: 'card-title' }, 'Follow-ups'),
      el(
        'button',
        { class: 'btn btn-sm', onClick: () => openFollowupDialog(ctx, candidate) },
        icon('plus', 14),
        'Add follow-up'
      )
    ),
    followups.length === 0
      ? el('p', { class: 'card-empty' }, 'No follow-ups. Promise yourself a next step, like “call Thursday”, and it shows up on the overview when due.')
      : el(
          'div',
          { class: 'row-list' },
          followups.map((f) =>
            el(
              'div',
              { class: 'task-row followup-row' },
              el(
                'label',
                { class: `task-label${f.done ? ' is-done' : ''}` },
                el('input', {
                  type: 'checkbox',
                  class: 'task-check',
                  checked: f.done,
                  'aria-label': `Done: ${f.text}`,
                  dataset: { focusKey: `followup-check-${f.id}` },
                  onChange: () => store.toggleFollowup(candidate.id, f.id),
                }),
                el('span', {}, f.text)
              ),
              dueChip(f),
              iconButton({
                name: 'x',
                label: `Delete follow-up: ${f.text}`,
                size: 13,
                onClick: async () => {
                  try {
                    await store.deleteFollowup(candidate.id, f.id);
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                },
              })
            )
          )
        )
  );
}

/* ---- Attachments -------------------------------------------------------- */

function attachmentsCard(ctx, candidate) {
  const { store } = ctx;
  const attachments = candidate.attachments ?? [];

  const fileInput = el('input', {
    type: 'file',
    multiple: true,
    style: { display: 'none' },
    'aria-hidden': 'true',
    tabindex: -1,
  });
  const uploadKey = `attach-upload-${candidate.id}`;
  const uploadButton = el(
    'button',
    { class: 'btn btn-sm', dataset: { focusKey: uploadKey }, onClick: () => fileInput.click() },
    icon('upload', 14),
    'Upload'
  );

  /* Writing a file to the cloud takes as long as the file and the
     connection say it does, and nothing on screen used to move until it
     landed — so the obvious reading of a slow upload was that the button
     had missed the click, and the obvious response was to add the file
     twice. Every finished file re-renders the view and replaces this
     button, so the busy state is applied to whichever one is live, found
     by focus key the way render() finds it. */
  const setUploading = (busy) => {
    const live = document.querySelector(`[data-focus-key="${CSS.escape(uploadKey)}"]`) ?? uploadButton;
    live.disabled = busy;
    live.replaceChildren(icon('upload', 14), busy ? 'Uploading…' : 'Upload');
  };

  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    if (files.length === 0) return;
    let added = 0;
    try {
      for (const file of files) {
        // Re-asserted per file: each finished one re-renders the card and
        // hands us a brand-new button in its resting state, so a batch
        // would otherwise flash back to "Upload" between its files.
        setUploading(true);
        try {
          await store.addAttachment(candidate.id, { name: file.name, type: file.type, size: file.size, data: file });
          added += 1;
        } catch (err) {
          toast(`${file.name}: ${err.message}`, 'error');
        }
      }
    } finally {
      setUploading(false);
    }
    // Failures already toasted their own reason; report only real adds.
    if (added > 0) toast(plural(added, 'file') + ' added');
  });

  const download = async (attachment) => {
    try {
      const blob = await store.readAttachment(candidate.id, attachment.id);
      downloadFile(attachment.name, blob, attachment.type || 'application/octet-stream');
    } catch (err) {
      toast(err.message ?? 'Couldn’t read that file.', 'error');
    }
  };

  return el(
    'div',
    { class: 'card' },
    fileInput,
    el(
      'div',
      { class: 'card-title-row' },
      el('h2', { class: 'card-title' }, 'Attachments'),
      uploadButton
    ),
    attachments.length === 0
      ? el('p', { class: 'card-empty' }, 'No files yet. Keep the resume and portfolio here, next to the rest of the profile.')
      : el(
          'div',
          { class: 'row-list' },
          attachments.map((attachment) =>
            el(
              'div',
              { class: 'item-row' },
              el('span', { class: 'attachment-icon' }, icon('file', 16)),
              el(
                'div',
                { class: 'item-main' },
                el(
                  'button',
                  { class: 'link-button item-title', onClick: () => download(attachment), title: `Download ${attachment.name}` },
                  attachment.name
                ),
                el('div', { class: 'item-sub' }, [formatBytes(attachment.size), relativeDays(attachment.at)].filter(Boolean).join(' · '))
              ),
              el(
                'div',
                { class: 'item-actions' },
                iconButton({ name: 'download', label: `Download ${attachment.name}`, onClick: () => download(attachment) }),
                iconButton({
                  name: 'trash',
                  label: `Delete ${attachment.name}`,
                  danger: true,
                  onClick: async () => {
                    const ok = await confirmDialog({
                      title: 'Delete this file?',
                      message: `“${attachment.name}” is permanently removed from your cloud.`,
                      confirmLabel: 'Delete',
                      danger: true,
                    });
                    if (!ok) return;
                    try {
                      await store.deleteAttachment(candidate.id, attachment.id);
                      toast('Attachment deleted');
                    } catch (err) {
                      toast(err.message, 'error');
                    }
                  },
                })
              )
            )
          )
        )
  );
}

/* ---- Interviews --------------------------------------------------------- */

function interviewsCard(ctx, candidate) {
  const { store } = ctx;
  const interviews = sortByDateTime(store.state.interviews.filter((i) => i.candidateId === candidate.id));
  const job = store.state.jobs.find((j) => j.id === candidate.jobId);

  return el(
    'div',
    { class: 'card' },
    el(
      'div',
      { class: 'card-title-row' },
      el('h2', { class: 'card-title' }, 'Interviews'),
      // Archived candidates can't be scheduled (the store refuses); hide
      // the invitation the way the offers card hides "New offer".
      isActive(candidate)
        ? el(
            'button',
            { class: 'btn btn-sm', onClick: () => openInterviewEditor(ctx, null, { candidateId: candidate.id }) },
            icon('calendar-plus', 14),
            'Schedule'
          )
        : null
    ),
    interviews.length === 0
      ? el('p', { class: 'card-empty' }, 'No interviews yet.')
      : el(
          'div',
          { class: 'row-list' },
          interviews.map((itv) => {
            const type = interviewTypeInfo(itv.type);
            const theirs = secondReading(itv, candidate.timeZone, store.state.settings);
            const proposed = isProposed(itv);
            const guide = findGuide(store.state.settings, itv.guideId);
            const slots = proposed ? normalizeSlots(itv.slots) : [];
            // By the clock, not the calendar day: an interview that ended
            // this morning is over, and the row should read that way
            // (and stop offering to email its invitation).
            const isPast = interviewHasEnded(itv, interviewZone(itv, store.state.settings));
            const joinUrl = safeHttpUrl(itv.meetingLink);
            return el(
              'div',
              { class: `item-row${isPast ? ' is-muted' : ''}` },
              el('span', { class: 'itv-type-icon' }, icon(type.icon, 16)),
              el(
                'div',
                { class: 'item-main' },
                el(
                  'div',
                  { class: 'item-title tnum' },
                  // The end carries the zone for the pair: "2:00 PM – 3:00 PM
                  // GMT+1", and nothing extra when it is our own clock.
                  proposed
                    ? `${plural(slots.length, 'time')} proposed`
                    : `${formatDate(itv.date)} · ${formatTime(itv.start)} – ${interviewTimeLabel(itv, itv.end, store.state.settings)}`
                ),
                el(
                  'div',
                  { class: 'item-sub' },
                  [
                    type.label,
                    // Not when it repeats the format's own name, which is
                    // exactly what a guide called "Phone screen" would do.
                    guide && guide.name !== type.label ? guide.name : null,
                    proposed ? `sent ${relativeDays(itv.proposedAt ?? itv.createdAt)}, no reply yet` : null,
                    // What the same moment reads as where they are.
                    theirs ? `${theirs} their time` : null,
                    itv.interviewers.length ? `with ${itv.interviewers.join(', ')}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                ),
                // One click each: the whole point of proposing is that the
                // reply turns into a booking without retyping anything.
                proposed && isActive(candidate)
                  ? el(
                      'div',
                      { class: 'slot-picks' },
                      slots.map((slot, i) => {
                        // An option can go by while the reply is still
                        // outstanding — the nudge for one starts at three
                        // days, and options are usually offered for the
                        // next day or two, today included. Compared as a
                        // real instant, so an 11:00 slot read over lunch
                        // is marked gone (see slotHasPassed).
                        const passed = slotHasPassed(slot, interviewZone(itv, store.state.settings));
                        return el(
                          'button',
                          {
                            class: 'btn btn-sm',
                            title: passed ? 'This time has already passed' : 'Confirm this time',
                            // Same guard: confirming settles the interview
                            // before the save returns, so a second click
                            // answered "This interview already has a fixed
                            // time." over the confirmation it had caused.
                            onClick: async (e) => {
                              const button = e.currentTarget;
                              button.disabled = true;
                              await confirmSlot(ctx, itv, i);
                              button.disabled = false;
                            },
                          },
                          icon(passed ? 'circle-alert' : 'check', 13),
                          `${slotLabel(itv, slot, store.state.settings)}${passed ? ' · passed' : ''}`
                        );
                      })
                    )
                  : null
              ),
              el(
                'div',
                { class: 'item-actions' },
                joinUrl
                  ? el(
                      'a',
                      {
                        class: 'btn btn-ghost btn-icon btn-sm',
                        href: joinUrl,
                        target: '_blank',
                        rel: 'noreferrer',
                        'aria-label': 'Join video call',
                        title: 'Join video call',
                      },
                      icon('video', 15)
                    )
                  : null,
                // The one action a finished interview is waiting for. The
                // schedule offers it the moment the call is over; here
                // there was nothing but "Add feedback" on the scorecards
                // card below, which knows no interview — so feedback
                // written from the profile lost the link to the meeting it
                // was about, and with it the guide's questions.
                isPast && !proposed
                  ? iconButton({
                      name: 'clipboard',
                      label: 'Write the scorecard for this interview',
                      onClick: () => openScorecardEditor(ctx, { candidate, interviewId: itv.id }),
                    })
                  : null,
                // No invitation email for an archived candidate — the same
                // rule the Interviews view applies to this very record; the
                // card already hides Schedule for them.
                candidate.email && !isPast && isActive(candidate)
                  ? iconButton({
                      name: 'mail',
                      // Nothing has been agreed yet, so the draft offers the
                      // options rather than confirming a time.
                      label: proposed ? 'Email the options again' : 'Email the invitation',
                      onClick: () =>
                        proposed
                          ? composeEmail(ctx, 'slots', candidate, slotVars(itv, job, store.state.settings))
                          : composeEmail(ctx, 'invite', candidate, inviteVars(itv, job, candidate, store.state.settings)),
                    })
                  : null,
                guide
                  ? iconButton({
                      name: 'list-checks',
                      label: `Open the ${guide.name} guide`,
                      onClick: () => openGuideView(ctx, guide, { candidate, interview: itv }),
                    })
                  : null,
                proposed
                  ? null
                  : iconButton({
                      name: 'calendar-plus',
                      label: 'Download calendar invite',
                      onClick: () => downloadICS(itv, candidate, job),
                    }),
                iconButton({ name: 'pencil', label: 'Edit interview', onClick: () => openInterviewEditor(ctx, itv) }),
                iconButton({
                  name: 'trash',
                  label: 'Delete interview',
                  danger: true,
                  onClick: async () => {
                    const ok = await confirmDialog({
                      title: proposed ? 'Withdraw these options?' : 'Delete this interview?',
                      message: proposed
                        ? 'The proposal is removed. The candidate keeps the email you already sent, so tell them if it no longer stands.'
                        : 'Any scorecards written for it are kept.',
                      confirmLabel: proposed ? 'Withdraw' : 'Delete',
                      danger: true,
                    });
                    if (ok) await store.deleteInterview(itv.id);
                  },
                })
              )
            );
          })
        )
  );
}

/**
 * Template variables for an interview invitation email. {{time}} always
 * names its zone — the candidate is the one person guaranteed not to be
 * on our clock — and adds their own reading when we know where they are.
 */
export function inviteVars(interview, job, candidate = null, settings = null) {
  const theirs = secondReading(interview, candidate?.timeZone, settings);
  return {
    job: job?.title ?? 'the role',
    date: formatDateLong(interview.date),
    time: `${interviewTimeWithZone(interview, interview.start, settings)}${theirs ? ` (${theirs} your time)` : ''}`,
    where: interview.meetingLink || interview.location || 'To be confirmed',
  };
}

/**
 * Template variables for the "here are some times" email. The options are
 * rendered as a numbered list so the candidate can reply with a number.
 */
export function slotVars(interview, job, settings = null) {
  return {
    job: job?.title ?? 'the role',
    options: slotOptionsText(interview, settings),
    where: interview.meetingLink || interview.location || 'To be confirmed',
  };
}

/**
 * The candidate picked an option: confirm it in one click, then offer the
 * invitation — the confirmation email is the natural next step, but
 * opening a mail draft unasked is not.
 */
export async function confirmSlot(ctx, interview, index) {
  const { store } = ctx;
  const settings = store.state.settings;
  const slot = normalizeSlots(interview.slots)[index];
  let confirmed;
  try {
    confirmed = await store.confirmInterviewSlot(interview.id, index);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  const when = `${formatDateLong(confirmed.date)} at ${interviewTimeWithZone(confirmed, confirmed.start, settings)}`;
  toast(`Interview confirmed for ${when}`);
  const candidate = store.state.candidates.find((c) => c.id === confirmed.candidateId);
  if (!candidate?.email) return;
  const ok = await confirmDialog({
    title: 'Time confirmed',
    message: `${when}. Send ${candidate.name.split(' ')[0]} the invitation now? The calendar file is on the interview row either way.`,
    confirmLabel: 'Email the invitation',
  });
  if (!ok) return;
  const job = store.state.jobs.find((j) => j.id === candidate.jobId);
  composeEmail(ctx, 'invite', candidate, inviteVars(confirmed, job, candidate, settings));
}

/** The label a proposed option is offered under: 'Mon, Sep 7 · 2:00 PM'. */
export function slotLabel(interview, slot, settings = null) {
  const at = { ...slot, timeZone: interview.timeZone ?? '' };
  return `${formatDate(slot.date)} · ${formatTime(slot.start)} – ${interviewTimeLabel(at, slot.end, settings)}`;
}

export function downloadICS(interview, candidate, job) {
  const type = interviewTypeInfo(interview.type);
  const title = `Interview: ${candidate.name}${job ? ` (${job.title})` : ''}`;
  let ics;
  try {
    ics = buildICS({
    title,
    description: [type.label, interview.interviewers.length ? `Panel: ${interview.interviewers.join(', ')}` : '', interview.notes]
      .filter(Boolean)
      .join('\n'),
      date: interview.date,
      start: interview.start,
      end: interview.end,
      // The interview's own zone, not the reader's: a pinned instant lands
      // at the right moment in every calendar app. An interview stored
      // before zones existed has none, and stays floating local time.
      timeZone: interview.timeZone ?? '',
      location: interview.meetingLink || interview.location,
      url: safeHttpUrl(interview.meetingLink) ?? '',
      uid: `${interview.id}@hiring`,
    });
  } catch (err) {
    // A restored backup can carry an interview without a usable date;
    // downloading a file every calendar app rejects, under a success
    // toast, would send the user hunting in the wrong place.
    toast(err.message, 'error');
    return;
  }
  downloadFile(icsFilename(title), ics, 'text/calendar');
  toast('Calendar invite downloaded');
}

/* ---- Scorecards --------------------------------------------------------- */

function scorecardsCard(ctx, candidate) {
  const { store } = ctx;
  const cards = store.state.scorecards
    .filter((s) => s.candidateId === candidate.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const summary = summarizeScorecards(cards);

  return el(
    'div',
    { class: 'card' },
    el(
      'div',
      { class: 'card-title-row' },
      el('h2', { class: 'card-title' }, 'Scorecards'),
      el(
        'button',
        { class: 'btn btn-sm', onClick: () => openScorecardEditor(ctx, { candidate }) },
        icon('plus', 14),
        'Add feedback'
      )
    ),
    summary.count > 0 && summary.average !== null
      ? el(
          'div',
          { class: 'score-summary' },
          ratingStars(summary.average),
          el('span', { class: 'tnum' }, summary.average.toFixed(1)),
          el('span', { class: 'muted' }, `· ${plural(summary.count, 'review')} ·`),
          el(
            'span',
            { class: `lean lean-${summary.leaning}` },
            summary.leaning === 'hire' ? 'Leaning hire' : summary.leaning === 'no_hire' ? 'Leaning no' : 'Split panel'
          )
        )
      : null,
    cards.length === 0
      ? el('p', { class: 'card-empty' }, 'No feedback yet. Scorecards keep the debrief structured and comparable.')
      : el(
          'div',
          { class: 'row-list' },
          cards.map((sc) => {
            const avg = averageRating(sc);
            return el(
              'div',
              { class: 'scorecard-row' },
              el(
                'div',
                { class: 'scorecard-head' },
                avatar(sc.author, 'avatar-sm'),
                el('span', { class: 'scorecard-author' }, sc.author),
                recommendationBadge(sc.recommendation),
                avg !== null ? el('span', { class: 'scorecard-avg' }, ratingStars(avg)) : null,
                el('span', { class: 'grow' }),
                iconButton({ name: 'pencil', label: 'Edit scorecard', onClick: () => openScorecardEditor(ctx, { candidate, scorecard: sc }) }),
                iconButton({
                  name: 'trash',
                  label: 'Delete scorecard',
                  danger: true,
                  onClick: async () => {
                    const ok = await confirmDialog({
                      title: 'Delete this scorecard?',
                      message: `${sc.author}’s feedback will be removed.`,
                      confirmLabel: 'Delete',
                      danger: true,
                    });
                    if (ok) await store.deleteScorecard(sc.id);
                  },
                })
              ),
              sc.notes ? el('p', { class: 'scorecard-notes' }, sc.notes) : null,
              // What was asked and what came back, as recorded: the
              // debrief reads the same evidence the rating came from.
              (sc.guideAnswers ?? []).length > 0
                ? el(
                    'div',
                    { class: 'scorecard-answers' },
                    sc.guideName ? el('h4', { class: 'answer-list-title' }, sc.guideName) : null,
                    sc.guideAnswers.map((a) =>
                      el(
                        'div',
                        {},
                        el('div', { class: 'answer-q' }, a.question),
                        el('div', { class: 'answer-a' }, el('span', {}, a.answer))
                      )
                    )
                  )
                : null
            );
          })
        )
  );
}

/* ---- Offer -------------------------------------------------------------- */

function offerCard(ctx, candidate) {
  const { store } = ctx;
  const offers = store.state.offers
    .filter((o) => o.candidateId === candidate.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = offers.find(isOpenOffer);
  const shown = open ?? offers[0];

  const body = [];
  if (!shown) {
    body.push(el('p', { class: 'card-empty' }, 'No offer yet. Draft one when the panel leans hire.'));
  } else {
    body.push(
      el(
        'div',
        { class: 'offer-summary' },
        el(
          'div',
          { class: 'offer-terms' },
          el('span', { class: 'offer-salary tnum' }, `${formatMoney(shown.salary, shown.currency)} / year`),
          el(
            'span',
            { class: 'muted small' },
            [
              shown.bonus ? `${formatMoney(shown.bonus, shown.currency)} bonus` : null,
              shown.equity || null,
              `starts ${formatDate(shown.startDate)}`,
              shown.expires && shown.status === OFFER_STATUS.SENT ? `expires ${formatDate(shown.expires)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')
          )
        ),
        offerStatusBadge(shown.status)
      )
    );
    body.push(offerActions(ctx, shown));
  }

  return el(
    'div',
    { class: 'card card-pad' },
    el(
      'div',
      { class: 'card-title-row no-pad' },
      el('h2', { class: 'card-title' }, 'Offer'),
      !open && isActive(candidate)
        ? el(
            'button',
            { class: 'btn btn-sm', onClick: () => openOfferEditor(ctx, null, { candidateId: candidate.id }) },
            icon('plus', 14),
            'Draft offer'
          )
        : null
    ),
    body
  );
}

export function offerActions(ctx, offer) {
  const { store } = ctx;
  const buttons = [];
  const letter = el('button', { class: 'btn btn-sm', onClick: () => openOfferLetter(ctx, offer) }, icon('file-text', 14), 'Letter');
  // Sending and signing require an active candidate (the store throws a
  // "restore first" otherwise) — hide those the way Schedule and "Draft
  // offer" are hidden, instead of offering a dead end. Closing out the
  // offer stays available: that is bookkeeping, not a pipeline move.
  const candidate = store.state.candidates.find((c) => c.id === offer.candidateId);
  const active = candidate && isActive(candidate);

  if (offer.status === OFFER_STATUS.DRAFT) {
    buttons.push(
      active
        ? el(
            'button',
            {
              class: 'btn btn-sm btn-primary',
              // Disabled across the await, like every other one-shot
              // action: the status flips before the save finishes, so a
              // double click reported "A sent offer cannot be sent." on
              // top of the success it had just caused.
              onClick: async (e) => {
                const button = e.currentTarget;
                button.disabled = true;
                try {
                  await store.sendOffer(offer.id);
                  toast('Offer marked as sent');
                } catch (err) {
                  button.disabled = false;
                  toast(err.message, 'error');
                }
              },
            },
            icon('send', 14),
            'Send'
          )
        : null,
      el('button', { class: 'btn btn-sm', onClick: () => openOfferEditor(ctx, offer) }, icon('pencil', 14), 'Edit'),
      letter,
      el(
        'button',
        {
          class: 'btn btn-sm btn-danger',
          onClick: async () => {
            const ok = await confirmDialog({ title: 'Delete this draft?', message: 'The draft offer is removed.', confirmLabel: 'Delete', danger: true });
            if (ok) await store.deleteOffer(offer.id);
          },
        },
        icon('trash', 14),
        'Delete'
      )
    );
  } else if (offer.status === OFFER_STATUS.SENT) {
    const emailJob = store.state.jobs.find((j) => j.id === offer.jobId);
    buttons.push(
      active
        ? el('button', { class: 'btn btn-sm btn-primary', onClick: () => openSignOffer(ctx, offer) }, icon('signature', 14), 'Record signature')
        : null,
      letter,
      active && candidate?.email && emailJob
        ? el(
            'button',
            {
              class: 'btn btn-sm',
              onClick: () =>
                composeEmail(ctx, 'offer', candidate, {
                  job: emailJob.title,
                  letter: offerLetterText(offer, candidate, emailJob, {
                    companyName: store.state.settings.companyName || 'Our company',
                    template: offerTemplate(store.state.settings),
                  }),
                }),
            },
            icon('mail', 14),
            'Email offer'
          )
        : null,
      el(
        'button',
        {
          class: 'btn btn-sm',
          onClick: async () => {
            const ok = await confirmDialog({ title: 'Mark as declined?', message: 'The candidate turned this offer down.', confirmLabel: 'Mark declined', danger: true });
            if (ok) {
              await store.declineOffer(offer.id);
              toast('Offer marked declined');
            }
          },
        },
        icon('x', 14),
        // "Declined" alone was the one bare state word in a row of verbs
        // (Record signature, Letter, Email offer, Withdraw), so it read
        // as a status chip rather than the button that records the
        // outcome. Its own dialog and toast already say "Mark declined".
        'Mark declined'
      ),
      el(
        'button',
        {
          class: 'btn btn-sm',
          onClick: async () => {
            const ok = await confirmDialog({ title: 'Withdraw this offer?', message: 'The offer is taken off the table.', confirmLabel: 'Withdraw', danger: true });
            if (ok) {
              await store.withdrawOffer(offer.id);
              toast('Offer withdrawn');
            }
          },
        },
        // The only button in the row that carried no icon, sitting at the
        // end of four that do. `ban` is what the timeline already draws
        // beside a withdrawal.
        icon('ban', 14),
        'Withdraw'
      )
    );
  } else {
    buttons.push(letter);
  }
  return el('div', { class: 'offer-actions' }, buttons);
}

/* ---- Onboarding ---------------------------------------------------------- */

function onboardingCard(ctx, candidate) {
  const { store } = ctx;
  const plan = store.state.onboarding[candidate.id];
  const { done, total, pct } = onboardingProgress(plan.tasks);
  // Dated tasks come due against the start date on the signed offer, the
  // same source the Onboarding view reads. Without this the profile's copy
  // of the checklist was the one place a task that had come due said
  // nothing about it.
  const startDate = hireStartDate(store.state.offers, candidate.id);
  const today = todayISO();

  const addInput = el('input', {
    class: 'input',
    type: 'text',
    placeholder: 'Add a task…',
    'aria-label': 'New onboarding task',
    dataset: { focusKey: `task-add-${candidate.id}` },
  });
  const addTask = () => addFromInput(addInput, (title) => store.addOnboardingTask(candidate.id, title));
  addInput.addEventListener('keydown', (e) => e.key === 'Enter' && addTask());

  return el(
    'div',
    { class: 'card card-pad' },
    el(
      'div',
      { class: 'card-title-row no-pad' },
      el('h2', { class: 'card-title' }, 'Onboarding'),
      el('span', { class: 'muted small tnum' }, `${done}/${total} done`)
    ),
    progressBar(pct, 'Onboarding progress'),
    startDateNote(plan.tasks, startDate),
    el(
      'div',
      { class: 'task-groups' },
      groupTasks(plan.tasks).map(([category, tasks]) =>
        el(
          'div',
          { class: 'task-group' },
          el('h3', { class: 'task-group-title' }, category),
          tasks.map((task) =>
            el(
              'div',
              { class: 'task-row' },
              el(
                'label',
                { class: `task-label${task.done ? ' is-done' : ''}` },
                el('input', {
                  type: 'checkbox',
                  class: 'task-check',
                  checked: task.done,
                  // Toggling re-renders the view; keep focus on this box so
                  // the checklist can be worked through by keyboard.
                  dataset: { focusKey: `task-check-${task.id}` },
                  onChange: () => store.toggleOnboardingTask(candidate.id, task.id),
                }),
                el('span', {}, task.title)
              ),
              taskDue(task, startDate, today),
              iconButton({
                name: 'x',
                label: `Remove task: ${task.title}`,
                size: 13,
                onClick: () => store.removeOnboardingTask(candidate.id, task.id),
              })
            )
          )
        )
      )
    ),
    el('div', { class: 'task-add' }, addInput, el('button', { class: 'btn btn-sm', onClick: addTask }, icon('plus', 14), 'Add'))
  );
}

/* ---- Timeline ------------------------------------------------------------ */

function eventLabel(event, jobs, settings) {
  switch (event.type) {
    case 'created':
      return `Added to the pipeline (${stageLabel(event.stage ?? 'applied', settings)})`;
    case 'stage':
      return `Moved from ${stageLabel(event.from, settings)} to ${stageLabel(event.to, settings)}`;
    case 'interview':
      // Proposing times is not a booking, and the event carries a count of
      // options instead of a date — so the scheduled wording read
      // "Interview scheduled for " with nothing after it, next to a
      // timestamp that looked like the missing date.
      if (event.action === 'proposed') {
        return event.count ? `Proposed ${plural(event.count, 'time')} to choose from` : 'Proposed interview times';
      }
      return event.date
        ? `Interview scheduled for ${formatDate(event.date)}${event.start ? ` at ${formatTime(event.start)}` : ''}`
        : 'Interview scheduled';
    case 'scorecard':
      return `${event.author} left feedback`;
    case 'offer':
      return {
        created: 'Offer drafted',
        sent: 'Offer sent',
        signed: 'Offer signed',
        declined: 'Offer declined',
        withdrawn: 'Offer withdrawn',
      }[event.action] ?? 'Offer updated';
    case 'rejected':
      return event.reason ? `Rejected: ${event.reason}` : 'Rejected';
    case 'withdrawn':
      return event.reason ? `Withdrew: ${event.reason}` : 'Withdrew from the process';
    case 'restored':
      return 'Restored to the pipeline';
    case 'pool':
      return event.action === 'removed' ? 'Removed from the talent pool' : 'Added to the talent pool';
    case 'reengaged': {
      const title = jobs.find((j) => j.id === event.to)?.title;
      return title ? `Re-engaged for the ${title} job` : 'Re-engaged for another role';
    }
    case 'attachment':
      return `Attached ${event.name}`;
    case 'note':
      return event.text;
    case 'email': {
      const label = EMAIL_TEMPLATES.find((t) => t.key === event.template)?.label ?? 'Email';
      const subject = event.subject ? `: ${event.subject}` : '';
      // Honest wording: a mailto draft is all the app can witness, so a
      // draft says "opened" until the user confirms it went out.
      return event.sent ? `${label} sent${subject}` : `${label} draft opened${subject}`;
    }
    case 'job': {
      const title = jobs.find((j) => j.id === event.to)?.title;
      return title ? `Moved to the ${title} job` : 'Moved to another job';
    }
    default:
      return event.type;
  }
}

const EVENT_ICONS = {
  created: 'user-plus',
  stage: 'arrow-right',
  interview: 'calendar',
  scorecard: 'clipboard',
  offer: 'file-text',
  rejected: 'ban',
  withdrawn: 'ban',
  restored: 'restore',
  pool: 'bookmark',
  reengaged: 'user-plus',
  job: 'briefcase',
  attachment: 'paperclip',
  note: 'message',
  email: 'mail',
};

function timelineCard(ctx, candidate) {
  const { store } = ctx;
  const events = [...(candidate.history ?? [])].reverse();

  const noteInput = el('input', {
    class: 'input',
    type: 'text',
    // Matches the store's cap, so a long paste is trimmed where the user
    // can still see it rather than after the save.
    maxlength: '1000',
    placeholder: 'Add a note…',
    'aria-label': 'Add a timeline note',
    dataset: { focusKey: `note-add-${candidate.id}` },
  });
  const addNote = () => addFromInput(noteInput, (text) => store.addCandidateNote(candidate.id, text));
  noteInput.addEventListener('keydown', (e) => e.key === 'Enter' && addNote());

  return el(
    'div',
    { class: 'card card-pad' },
    el('h2', { class: 'card-title' }, 'Timeline'),
    el('div', { class: 'task-add note-add' }, noteInput, el('button', { class: 'btn btn-sm', onClick: addNote }, icon('plus', 14), 'Add')),
    events.length === 0
      ? el('p', { class: 'card-empty' }, 'No activity yet.')
      : el(
          'ol',
          { class: 'timeline' },
          events.map((event) =>
            el(
              'li',
              { class: 'timeline-item' },
              el('span', { class: `timeline-dot${event.type === 'note' ? ' is-note' : ''}` }, icon(EVENT_ICONS[event.type] ?? 'info', 12)),
              el(
                'div',
                { class: 'timeline-body' },
                el('span', { class: event.type === 'note' ? 'timeline-note' : null }, eventLabel(event, ctx.store.state.jobs, ctx.store.state.settings)),
                el('span', { class: 'timeline-when' }, relativeDays(event.at))
              ),
              event.type === 'email' && !event.sent
                ? el(
                    'button',
                    {
                      class: 'btn btn-sm timeline-action',
                      title: 'Confirm you sent this message',
                      onClick: async (e) => {
                        e.currentTarget.disabled = true;
                        try {
                          await store.markEmailSent(candidate.id, event.id);
                        } catch (err) {
                          toast(err.message, 'error');
                        }
                      },
                    },
                    icon('check', 13),
                    'Mark as sent'
                  )
                : null,
              event.type === 'note'
                ? iconButton({
                    name: 'x',
                    label: 'Delete note',
                    size: 13,
                    onClick: async () => {
                      const ok = await confirmDialog({
                        title: 'Delete this note?',
                        message: 'The note is removed from the timeline.',
                        confirmLabel: 'Delete',
                        danger: true,
                      });
                      if (!ok) return;
                      try {
                        await store.deleteCandidateNote(candidate.id, event.id);
                      } catch (err) {
                        toast(err.message, 'error');
                      }
                    },
                  })
                : null
            )
          )
        )
  );
}

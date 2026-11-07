/**
 * Recording what you decided about a renewal.
 *
 * The app was good at saying a decision was due and had no way to hear the
 * answer, so the same red row came back every day until the term rolled over
 * — which teaches people to ignore red rows. These are the four real answers,
 * and each one is dated and kept.
 */

import { el, clear, append } from './dom.js';
import { icon } from './icons.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { formatDate, relativeDays, todayISO, addDays, isValidISO, DECISION_LABELS } from '../lib/dates.js';
import { textInput, field } from './bits.js';
import { DOT } from '../lib/util.js';

const OPTIONS = [
  {
    kind: 'notice-given',
    icon: 'mail',
    title: 'Notice given',
    sub: 'You told them you are cancelling or renegotiating. The term runs to its end and does not roll forward.',
  },
  {
    kind: 'renewing',
    icon: 'renew',
    title: 'Renewing',
    sub: 'You are deliberately letting it roll forward on the same terms.',
  },
  {
    kind: 'not-renewing',
    icon: 'calendar',
    title: 'Not renewing',
    sub: 'It ends at the term end. Nothing to send, nothing to sign.',
  },
  {
    kind: 'snoozed',
    icon: 'clock',
    title: 'Not decided yet',
    sub: 'Set a date to be asked again. It stays out of the way until then, and comes back on its own.',
  },
];

/** openDecisionSheet(contract, info) — info is the contract's renewalInfo. */
export function openDecisionSheet(contract, info) {
  const body = el('div');
  let kind = info.decision?.kind || null;

  const noteInput = textInput({
    value: info.decision?.note || '',
    placeholder: 'e.g. emailed Maya, cancellation confirmed',
    maxLength: 500,
  });
  const snoozeUntilLimit = snoozeLimit(info);
  const untilInput = textInput({
    type: 'date',
    value: info.decision?.until || defaultSnooze(info),
    min: addDays(todayISO(), 1),
    max: snoozeUntilLimit,
  });
  const extras = el('div');
  const save = el('button.btn.btn-primary.btn-block');

  function renderExtras() {
    clear(extras);
    if (!kind) return;
    if (kind === 'snoozed') {
      extras.append(field('Ask me again on', untilInput, {
        hint: !info.date ? null
          : snoozeUntilLimit
            ? `The term ends ${formatDate(info.date)}, so that is as long as this can wait.`
            : `The term ends ${formatDate(info.date)}.`,
      }));
    }
    extras.append(field('Note (optional)', noteInput, {
      hint: 'Kept with the term history, so next year you know what happened.',
    }));
  }

  function renderOptions() {
    clear(list);
    for (const option of OPTIONS) {
      const active = kind === option.kind;
      list.append(el('button.choice', {
        type: 'button',
        className: `choice${active ? ' active' : ''}`,
        'aria-pressed': String(active),
        onclick: () => {
          kind = option.kind;
          renderOptions();
          renderExtras();
          updateSave();
        },
      },
        el('span.choice-ic', { html: icon(option.icon, 17, 2) }),
        el('div.grow.min0', {},
          el('div.choice-title', {}, option.title),
          el('div.choice-sub', {}, option.sub)
        ),
        el('span.choice-mark', { html: active ? icon('done', 18, 2.2) : '' })
      ));
    }
  }

  const list = el('div.choice-list', { role: 'group', 'aria-label': 'Renewal decision' });

  function updateSave() {
    save.textContent = kind ? `Record "${DECISION_LABELS[kind]}"` : 'Choose what happened';
    save.disabled = !kind;
  }

  save.addEventListener('click', async () => {
    if (!kind) return;
    if (kind === 'snoozed') {
      if (!isValidISO(untilInput.value)) {
        toast('Pick a date to be asked again', { icon: 'info' });
        untilInput.focus();
        return;
      }
      // The sheet has no form around it, so the range has to be asked for.
      if (!untilInput.reportValidity()) {
        untilInput.focus();
        return;
      }
    }
    save.disabled = true;
    try {
      await store.recordDecision(contract.id, {
        kind,
        note: noteInput.value,
        until: kind === 'snoozed' ? untilInput.value : null,
      });
      modal.close();
      toast(kind === 'snoozed'
        ? `Back on ${formatDate(untilInput.value)}`
        : `Recorded: ${DECISION_LABELS[kind]}`, { icon: 'check' });
    } catch (err) {
      console.error(err);
      save.disabled = false;
      toast('Could not save. Check your connection', { icon: 'wifiOff' });
    }
  });

  renderOptions();
  renderExtras();
  updateSave();

  // The dom helper, not node.append: a null child must vanish, not print.
  append(body, [
    el('p.modal-note', {}, deadlineSentence(contract, info)),
    list,
    extras,
    save,
    info.decision && el('button.btn.btn-ghost.btn-block.btn-danger-ghost', {
      style: { marginTop: '8px' },
      onclick: async () => {
        const ok = await confirmDialog({
          title: 'Clear this decision?',
          message: 'The renewal goes back to needing a decision, and shows up in the attention list again.',
          confirmLabel: 'Clear',
        });
        if (!ok) return;
        try {
          await store.clearDecision(contract.id);
          modal.close();
          toast('Decision cleared', { icon: 'undo' });
        } catch {
          toast('Could not save. Check your connection', { icon: 'wifiOff' });
        }
      },
    }, 'Clear the recorded decision'),
  ]);

  const modal = openModal({ title: 'Renewal decision', content: body });
  return modal;
}

/**
 * The last day a snooze can still be about this term: once it is over the
 * answer is no longer the user's to give, and "comes back on its own" would be
 * a promise to ask after the renewal already happened. Null when that day has
 * gone, where being asked again is only a reminder to record what happened.
 */
function snoozeLimit(info, today = todayISO()) {
  const earliest = addDays(today, 1);
  return isValidISO(info.date) && info.date >= earliest ? info.date : null;
}

/** Snoozing defaults to just after the notice deadline, or a week out. */
function defaultSnooze(info) {
  const today = todayISO();
  const limit = snoozeLimit(info, today);
  const wanted = isValidISO(info.noticeDate) && info.noticeDaysLeft > 1
    ? addDays(info.noticeDate, -1)
    : addDays(today, 7);
  // A week out is meaningless on something that renews in three days.
  return limit && wanted > limit ? limit : wanted;
}

function deadlineSentence(contract, info) {
  if (!info.date) return 'This contract has no end date.';
  const term = `The term ${info.daysLeft < 0 ? 'ended' : contract.autoRenew ? 'renews' : 'ends'} ${formatDate(info.date)}`;
  if (!info.noticeDate) return `${term} (${relativeDays(info.daysLeft)}).`;
  return info.noticeDaysLeft >= 0
    ? `${term} (${relativeDays(info.daysLeft)}). Notice is due by ${formatDate(info.noticeDate)}.`
    : `${term} (${relativeDays(info.daysLeft)}). The notice deadline passed ${formatDate(info.noticeDate)}.`;
}

/** "Notice given 4 Mar · term ends 12 Apr" for the callout and list rows. */
export function decisionSummary(info) {
  const d = info.decision;
  if (!d) return null;
  // A decision can be recorded against a term that has already run out, so the
  // tense follows the date rather than assuming it is still ahead.
  const past = info.daysLeft !== null && info.daysLeft < 0;
  const termLine = info.date ? `term ${past ? 'ended' : 'ends'} ${formatDate(info.date)}` : '';
  if (d.kind === 'snoozed') {
    return `Snoozed until ${formatDate(d.until)}${termLine ? `${DOT}${termLine}` : ''}`;
  }
  const label = DECISION_LABELS[d.kind];
  const when = isValidISO(d.date) ? ` ${formatDate(d.date)}` : '';
  if (!info.date) return `${label}${when}`;
  const tail = d.kind === 'renewing' && !past
    ? `renews ${formatDate(info.date)}`
    : termLine;
  return `${label}${when}${DOT}${tail}`;
}

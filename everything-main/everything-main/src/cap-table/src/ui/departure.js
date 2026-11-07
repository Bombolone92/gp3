/**
 * Marking a holder as departed.
 *
 * When someone leaves, three things happen to the cap table at once: vesting
 * stops, unvested options go back to the pool, and a post-termination
 * exercise clock starts on the vested remainder. Doing that one grant at a
 * time loses the whole picture, so this is a two-step wizard in the
 * closeround mold: step one collects the termination date and the per-grant
 * exercise deadlines (contracts vary), step two shows every record about to
 * change, and only then does anything commit - atomically.
 */

import { el, clear, append } from './dom.js';
import { field, flagInvalid } from './bits.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { forfeitureDestination } from './planform.js';
import { store, isRefusal } from '../lib/store.js';
import {
  grantOutstanding, grantExercised, vestedQuantity, hasVesting, isClosed,
  rsuOutstanding, rsuVested, rsuSettled, exerciseCutoff,
} from '../lib/captable.js';
import { shares as fmtShares, dateLong, countLabel } from '../lib/format.js';
import { todayISO, addDaysISO } from '../lib/util.js';

/** The standard post-termination exercise window. */
const PTE_DAYS = 90;

export function openDepartureFlow(holder, { onDone = null } = {}) {
  const today = todayISO();

  const state = {
    step: 'setup',
    date: today,
    /* grantId -> { exerciseBy, edited }. Deadlines follow the termination
       date until someone types their own - contracts vary per grant. */
    deadlines: new Map(),
  };

  const body = el('div');
  const modal = openModal({ title: `Mark ${holder.name} as departed`, content: body, wide: true });

  const grants = () => store.securities
    .filter((s) => s.kind === 'option' && s.stakeholderId === holder.id && grantOutstanding(s) > grantExercised(s));
  /* Live certificates only. A certificate a transfer or a repurchase has
     closed keeps its schedule for history, and its successors carry whatever
     survived - so counting it here offered the company a buyback of shares
     the holder no longer has, beside a second row for the very same shares
     under the successor's label. */
  const restrictedCerts = () => store.securities
    .filter((s) => s.kind === 'shares' && s.stakeholderId === holder.id
      && hasVesting(s) && !isClosed(s));
  const awards = () => store.securities
    .filter((s) => s.kind === 'rsu' && s.stakeholderId === holder.id && rsuOutstanding(s) > 0);

  /** What the departure does to each grant, on the chosen date. */
  const plan = () => grants().map((grant) => {
    const outstanding = grantOutstanding(grant);
    const exercised = grantExercised(grant);
    // Vesting measured on the termination date against the original
    // schedule, never proposing to cancel options already bought.
    const vested = Math.min(outstanding, vestedQuantity({ ...grant, cancelledDate: '', vestingStoppedAt: '' }, state.date));
    /* A grant whose exercise window had already closed by the termination
       date. Everything unexercised lapsed on that day, vested or not, so
       there is no deadline for this departure to set and nothing for it to
       forfeit on a day the right to exercise was already gone. Proposed
       anyway, the row filled the deadline in with the old expiry - a date
       before the termination - and the Review button then refused the very
       value the sheet had chosen. The expired-grant item on the
       needs-attention list is what clears the lapsed options, dated the day
       the window closed. */
    const cutoff = exerciseCutoff(grant);
    const lapsed = !!cutoff && cutoff < state.date;
    const cancelQty = lapsed ? 0 : Math.max(0, outstanding - Math.max(vested, exercised));
    const vestedLeft = outstanding - cancelQty - exercised;
    /* A recorded deadline is taken as given, empty included: clearing the
       field means this plan gives the holder the grant's full remaining term,
       which is an increasingly common answer. Falling back to the standard
       window whenever the value was falsy quietly re-imposed 90 days on a
       field the user had deliberately emptied - the review step and the
       record that committed both disagreed with what was on screen. */
    const entry = state.deadlines.get(grant.id);
    /* The standard window, unless the grant's own term ends first: the right
       to exercise closes at whichever comes first, so a deadline past the
       expiration never binds. Proposed anyway, the review named a window
       closing weeks after the grant had expired, and the record carried a
       deadline the window note then ignored in favour of the term. */
    const standard = addDaysISO(state.date, PTE_DAYS);
    const deadline = lapsed ? '' : entry
      ? entry.exerciseBy
      : (grant.expires && grant.expires < standard ? grant.expires : standard);
    // A typed deadline the expiration overtakes: still saved, but said.
    const expiresFirst = !!deadline && !!grant.expires && grant.expires < deadline;
    /* A grant dated after the termination cannot be affected by it - there
       was nothing to forfeit on a day the option did not exist. Measured
       anyway, the whole grant read as unvested and the review offered to
       cancel all of it under a forfeiture dated before the grant. The store
       refuses the same; this names the grant before the review does. */
    const granted = grant.grantDate || grant.date || '';
    /* An exercise certificate dated after the proposed deadline: a departure
       recorded after the fact cannot close the window on an exercise that
       already happened inside it. The store refuses the same. */
    const late = deadline && vestedLeft > 0
      ? store.securities
        .filter((c) => c.kind === 'shares' && !c.fromTransferId && c.fromOptionId === grant.id
          && c.date && c.date > deadline)
        .reduce((a, c) => (a && a.date <= c.date ? a : c), null)
      : null;
    /* A departure that cancels anything freezes vesting on its date, and a
       grant without early exercise cannot have exercised more than had
       vested by then. The store refuses the same; this names the grant
       before the review does. */
    const overClaimed = !grant.earlyExercise && cancelQty > 0 && exercised > vested;
    /* Which of the plan's rules the forfeiture is read through. A cancellation
       dated the day the window closes is an expiration to the plan's ledger
       (see forfeitureEvent in lib/captable.js), and a termination dated on
       the grant's last day is exactly that - so the sheet names the rule the
       shares will actually follow, as the cancel sheet does. */
    const event = cutoff && state.date === cutoff ? 'expiration' : 'cancellation';
    return {
      grant, cancelQty, vestedLeft, deadline, granted, late, exercised, vested, overClaimed, expiresFirst,
      lapsed, cutoff, event,
      premature: !!granted && granted > state.date,
    };
  });

  /* RSU awards and reverse-vesting stock, on the same terms: what happens
     to them is real but it is a separate write, so the sheet says what is
     left rather than committing it silently - on the setup step and again
     on the review, which otherwise mentioned neither. */
  function forfeitureNotes() {
    const rsuAwards = awards();
    const certs = restrictedCerts();
    return [
      rsuAwards.length ? el('div', { style: { marginBottom: '12px' } },
        el('h3.card-title', { style: { marginBottom: '4px' } }, 'RSU awards'),
        rsuAwards.map((a) => {
          /* Units already settled into shares are theirs whatever had vested
             by the day - the same reading the option rows take, and the
             most the award's cancel sheet will accept. Measured against
             vesting alone, a departure dated before a settlement promised to
             forfeit units that had left the award. */
          const unvested = Math.max(0, rsuOutstanding(a) - Math.max(rsuVested(a, state.date), rsuSettled(a)));
          return el('p.small.muted', { style: { margin: '2px 0' } },
            unvested > 0
              ? `${a.label}: ${fmtShares(unvested)} unvested units are forfeited on departure. Cancel them from the award; they ${forfeitureDestination(a).they}.`
              : `${a.label}: fully vested by ${dateLong(state.date)}; nothing is forfeited.`);
        })) : null,
      certs.length ? el('div', { style: { marginBottom: '12px' } },
        el('h3.card-title', { style: { marginBottom: '4px' } }, 'Reverse-vesting stock'),
        certs.map((c) => {
          const unvested = Math.max(0, c.quantity - vestedQuantity(c, state.date));
          return el('p.small.muted', { style: { margin: '2px 0' } },
            unvested > 0
              ? `${c.label}: ${fmtShares(unvested)} unvested shares are eligible for repurchase. Recording the buyback is a share transfer, tracked separately.`
              : `${c.label}: fully vested by ${dateLong(state.date)}; nothing to repurchase.`);
        })) : null,
    ];
  }

  function renderSetup() {
    const rows = plan();

    const dateInput = el('input.input', {
      type: 'date', value: state.date, 'aria-label': 'Termination date',
      // Every grant's figures are computed from this date, so changing it
      // rebuilds the step - taking this very field with it, and dropping
      // keyboard focus on the document body right after someone used it. The
      // focus key is how the shell hands focus back across its own re-renders.
      dataset: { focusKey: 'termination-date' },
      onchange: (e) => {
        state.date = e.target.value || today;
        // Un-edited deadlines follow the date; edited ones are contract terms.
        for (const [id, d] of state.deadlines) if (!d.edited) state.deadlines.delete(id);
        renderSetup();
        body.querySelector('[data-focus-key="termination-date"]')?.focus();
      },
    });

    const grantRows = rows.map((r) => {
      /* Said the moment the field runs past the term, not only on the review
         step: the row is not rebuilt on a deadline change, so the line is
         toggled in place. */
      // A status region: it appears as the deadline is typed, under a field that keeps focus.
      const expiresLine = r.grant.expires ? el('p.small.warn', {
        role: 'status', style: { margin: '-6px 0 4px' }, hidden: !r.expiresFirst,
      }, `${r.grant.label} expires on ${dateLong(r.grant.expires)}, before this deadline, so the window closes then.`) : null;
      const deadlineInput = el('input.input', {
        type: 'date', value: r.deadline, 'aria-label': `Exercise deadline for ${r.grant.label}`,
        // A window cannot close before the departure that opens it; the
        // Review button refuses the same, and the picker should not offer it.
        min: state.date,
        // The label attached below takes the aria-label with it, so the key is
        // how the Review button hands focus back to this field.
        dataset: { focusKey: `deadline:${r.grant.id}` },
        onchange: (e) => {
          state.deadlines.set(r.grant.id, { exerciseBy: e.target.value, edited: true });
          if (expiresLine) expiresLine.hidden = !(e.target.value && r.grant.expires < e.target.value);
        },
      });
      return el('div', { style: { padding: '10px 0', borderTop: '1px solid var(--hairline)' } },
        el('div', { style: { fontWeight: '570', marginBottom: '4px' } },
          `${r.grant.label} · ${fmtShares(grantOutstanding(r.grant))} outstanding`),
        r.premature
          ? el('p.small.warn', { style: { margin: '2px 0' } },
            `Granted ${dateLong(r.granted)}, after this termination date. Move the date, or correct the grant first.`)
          : r.lapsed
            ? el('p.small.warn', { style: { margin: '2px 0' } }, r.cutoff > todayISO()
              /* A termination dated ahead with the window closing between now
                 and it: the lapse is still to come, and the needs-attention
                 list will not offer the options back until it has. */
              ? `${r.grant.label}’s exercise window closes on ${dateLong(r.cutoff)}, before this termination date, so its `
                + `${countLabel(r.vestedLeft, 'unexercised option')} will lapse then. Nothing changes on it here; once the window `
                + `has closed, the needs-attention list will offer to cancel ${r.vestedLeft === 1 ? 'it, and it' : 'them, and they'} `
                + `${forfeitureDestination(r.grant, 'expiration')[r.vestedLeft === 1 ? 'it' : 'they']}.`
              : `${r.grant.label}’s exercise window closed on ${dateLong(r.cutoff)}, before this termination date, so its `
                + `${countLabel(r.vestedLeft, 'unexercised option')} lapsed then. Nothing changes on it here; the needs-attention `
                + `list offers to cancel ${r.vestedLeft === 1 ? 'it, and it' : 'them, and they'} `
                + `${forfeitureDestination(r.grant, 'expiration')[r.vestedLeft === 1 ? 'it' : 'they']}.`)
            : r.cancelQty > 0
              ? el('p.small.muted', { style: { margin: '2px 0' } },
                `${countLabel(r.cancelQty, 'unvested option')} on ${dateLong(state.date)} ${r.cancelQty === 1 ? 'is' : 'are'} cancelled and `
                + `${forfeitureDestination(r.grant, r.event)[r.cancelQty === 1 ? 'it' : 'they']}.`)
              : el('p.small.muted', { style: { margin: '2px 0' } }, 'Everything outstanding is vested.'),
        r.vestedLeft > 0 && !r.premature && !r.lapsed
          ? field(`${r.grant.label} exercise deadline`, deadlineInput,
            `${countLabel(r.vestedLeft, 'vested option')} ${r.vestedLeft === 1 ? 'stays' : 'stay'} exercisable until this date. Contracts vary; `
            + `90 days is the standard, and clearing the field leaves them exercisable for the grant’s full term.`)
          : null,
        r.vestedLeft > 0 && !r.premature && !r.lapsed ? expiresLine : null,
        r.late && !r.premature
          ? el('p.small.warn', { style: { margin: '-6px 0 4px' } },
            `${r.late.label} was exercised from this grant on ${dateLong(r.late.date)}, after this deadline. `
            + 'Move the deadline to that day or later, or clear it.')
          : null,
        r.overClaimed && !r.premature
          ? el('p.small.warn', { style: { margin: '2px 0' } },
            `${countLabel(r.exercised, 'option')} ${r.exercised === 1 ? 'was' : 'were'} exercised from this grant, but only ${fmtShares(r.vested)} `
            + `had vested by ${dateLong(state.date)}. Move the termination date to when they had, or correct the exercise first.`)
          : null);
    });

    append(clear(body), [
      el('p.confirm-message', {},
        'Vesting stops on the termination date, unvested options are cancelled and go where their plan’s cancellation rule says, and the vested remainder gets an exercise deadline.'),
      field('Termination date', dateInput),
      rows.length
        ? el('div', { style: { marginBottom: '10px' } }, grantRows)
        : el('p.field-hint', { style: { marginBottom: '12px' } },
          'No option grants are affected; this records the departure date on the profile.'),
      ...forfeitureNotes(),
      el('button.btn.btn-primary.btn-block', {
        type: 'button', style: { padding: '12px' },
        onclick: () => {
          /* Each refusal marks and focuses the field that has to move, the
             way every other sheet's refusals do; these only toasted and
             focused, so nothing said which field was wrong. */
          const refuse = (focusKey, message) => {
            const control = body.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
            // With the reason, so the field describes what is wrong with it - see flagInvalid.
            flagInvalid(control, message);
            control?.focus();
            toast(message, { icon: 'alert' });
          };
          const early = plan().find((r) => r.premature);
          if (early) {
            return refuse('termination-date',
              `${early.grant.label} was granted on ${dateLong(early.granted)}, after this termination date`);
          }
          const bad = plan().find((r) => r.vestedLeft > 0 && r.deadline && r.deadline < state.date);
          if (bad) {
            return refuse(`deadline:${bad.grant.id}`,
              `${bad.grant.label}: the exercise deadline can’t precede the termination date`);
          }
          const late = plan().find((r) => r.late && !r.premature);
          if (late) {
            return refuse(`deadline:${late.grant.id}`,
              `${late.late.label} was exercised from ${late.grant.label} on ${dateLong(late.late.date)}, after its deadline`);
          }
          const over = plan().find((r) => r.overClaimed && !r.premature);
          if (over) {
            return refuse('termination-date', `${over.grant.label}: ${countLabel(over.exercised, 'option')} ${over.exercised === 1 ? 'was' : 'were'} exercised, but only `
              + `${fmtShares(over.vested)} had vested by ${dateLong(state.date)}`);
          }
          // Freeze the proposed deadlines so review shows exactly what commits.
          for (const r of plan()) {
            if (!state.deadlines.has(r.grant.id)) {
              state.deadlines.set(r.grant.id, { exerciseBy: r.deadline, edited: false });
            }
          }
          state.step = 'review';
          render();
        },
      }, 'Review departure'),
    ]);
  }

  function renderReview() {
    const rows = plan();
    const totalCancelled = rows.reduce((a, r) => a + r.cancelQty, 0);

    const confirmBtn = el('button.btn.btn-danger.btn-block', { style: { padding: '12px' } },
      'Mark as departed');
    // Held with the confirm button while the write is in flight, like the
    // round close: Back and forward again must not offer a second commit.
    const backBtn = el('button.btn.btn-ghost', {
      type: 'button', style: { flex: '1', padding: '12px' },
      onclick: () => { state.step = 'setup'; render(); },
    }, 'Back');
    /* What the review shows, in the terms the commit is built from. */
    const shape = (list) => JSON.stringify(list.map((r) => [r.grant.id, r.cancelQty, r.deadline, r.lapsed, r.vestedLeft]));
    confirmBtn.addEventListener('click', async () => {
      /* Planned again at the moment of the commit: a toast's Undo is
         pressable while the review is up (Cmd/Ctrl-Z reaches it), and one
         that restores or reshapes a grant of this holder changes what the
         departure should do to it. Committed from the rows as rendered,
         the departure skipped that grant or under-cancelled it. */
      if (shape(plan()) !== shape(rows)) {
        toast('The cap table changed while you were reviewing. Check the review again', { icon: 'alert' });
        render();
        return;
      }
      confirmBtn.disabled = true;
      backBtn.disabled = true;
      state.busy = true;
      try {
        await store.markDeparted(holder.id, {
          date: state.date,
          /* A grant that lapsed before the departure is not sent at all:
             nothing changes on it, and an empty deadline would clear a
             stored one and reopen a window the record says has shut. */
          grants: rows.filter((r) => !r.lapsed).map((r) => ({
            id: r.grant.id,
            cancelQty: r.cancelQty,
            exerciseBy: r.vestedLeft > 0 ? r.deadline : '',
          })),
        });
        const parts = [`${holder.name} marked as departed ${dateLong(state.date)}`];
        if (totalCancelled > 0) parts.push(`${countLabel(totalCancelled, 'option')} cancelled`);
        store.logActivity(parts.join('; '), 'logout');
        toast('Departure recorded');
        modal.close();
        onDone?.();
      } catch (err) {
        console.error(err);
        toast(isRefusal(err) ? err.message : 'Couldn’t save. Check your connection',
          { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
        state.busy = false;
        confirmBtn.disabled = false;
        backBtn.disabled = false;
      }
    });

    append(clear(body), [
      el('p.confirm-message', {},
        `Departing ${dateLong(state.date)} writes the following to your cap table. Review it before confirming.`),
      rows.length ? el('div.table-wrap', {
        tabindex: 0, role: 'region', 'aria-label': 'Grants affected by the departure', style: { margin: '8px 0 16px' },
      },
        el('table.data', { style: { minWidth: '420px' } },
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col' }, 'Grant'),
            /* Where the cancelled options go is each grant's plan's rule to
               say - back to the reserve, kept drawn, or poured into a
               successor - so the column is named for the event and each row
               says the destination. "Back to pool" named one rule of three. */
            el('th.num', { scope: 'col' }, 'Cancelled'),
            el('th.num', { scope: 'col' }, 'Stay exercisable'),
            el('th', { scope: 'col' }, 'Deadline'))),
          el('tbody', {}, rows.map((r) => el('tr', {},
            el('td', {}, r.grant.label),
            el('td.num', {}, r.cancelQty > 0
              ? el('div', {},
                el('div', {}, fmtShares(r.cancelQty)),
                // One line, so the table scrolls for it rather than the row growing four lines tall on a phone.
                el('div.small.muted', { style: { whiteSpace: 'nowrap' } }, forfeitureDestination(r.grant, r.event).they))
              : '-'),
            el('td.num', {}, r.vestedLeft > 0 && !r.lapsed ? fmtShares(r.vestedLeft) : '-'),
            el('td', {}, r.lapsed
              ? el('span.small.muted', {}, `${r.cutoff > todayISO() ? 'Lapses' : 'Lapsed'} ${dateLong(r.cutoff)}`)
              : r.vestedLeft > 0
              ? (r.deadline
                ? el('div', {},
                  el('div', {}, dateLong(r.deadline)),
                  // The window closes at the term's end when that comes first.
                  r.expiresFirst
                    ? el('div.small.muted', {}, `Expires ${dateLong(r.grant.expires)}, which comes first`)
                    : null)
                : 'None · full term')
              : '-'))))))
        : el('p.field-hint', {}, 'No option grants change; the departure date is recorded on the profile.'),
      ...forfeitureNotes(),
      el('p.field-hint.warn', { style: { margin: '0 0 14px' } },
        rows.some((r) => !r.lapsed && r.vestedLeft > 0)
          ? 'This writes real records. Vested options left unexercised past their deadline read as expired.'
          : 'This writes real records.'),
      /* Back carries the same padding as the step's primary action: the two
         sit side by side, and the default 9px left it 6px shorter than the
         button it is paired with. */
      el('div.row', {},
        backBtn,
        el('div', { style: { flex: '2' } }, confirmBtn)),
    ]);
  }

  function render() {
    if (state.busy) return;
    if (state.step === 'setup') renderSetup();
    else renderReview();
    modal.panel.scrollTop = 0;
    /* A step swap replaces everything in the panel, the control that asked for
       it included - so keyboard focus lands on the document body, and a screen
       reader is left with nothing to read on the step it just moved to. The
       dialog itself is where to put it back: the next step's own first control
       is "Back", which is not where anyone means to be after pressing forward.
       Harmless on the first render, which openModal's own focus follows. */
    modal.panel.focus({ preventScroll: true });
  }

  render();
}

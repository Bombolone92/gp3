import { el, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/modal.js';
import { emptyState, keepFocus } from '../ui/bits.js';
import { store, TRASH_DAYS } from '../lib/store.js';
import { docTotals, fmtMoney } from '../lib/money.js';
import { fmtDate, freqLabel, ruleCompleted, remainingOccurrences } from '../lib/dates.js';

export function recurringView({ navigate }) {
  const root = el('div.view');

  /**
   * Pausing or resuming a schedule saves it, and the store change rebuilds
   * this whole list — destroying the pressed button and dropping keyboard
   * focus to <body>. Remember which row's control held it (by rule and
   * action, because Pause becomes Resume and the accessible name changes
   * with it) and hand focus to the rebuilt one.
   */
  let focusKey = null;
  // Everything else on the page — New schedule above the list, the empty
  // state's own button — is matched by name like every other list, and it
  // also catches the row buttons whose rule is simply gone.
  let restoreRest = () => {};
  const restoreFocus = () => {
    const buttons = [...root.querySelectorAll('.rule-actions .icon-btn')];
    const twin = focusKey && buttons.find((b) => `${b.dataset.rule}:${b.dataset.act}` === focusKey);
    focusKey = null;
    if (twin) {
      twin.focus();
      return;
    }
    restoreRest();
  };

  function render() {
    const had = document.activeElement;
    focusKey = root.contains(had) && had.dataset?.act
      ? `${had.dataset.rule}:${had.dataset.act}`
      : null;
    restoreRest = keepFocus(root);
    clear(root);
    const rules = [...store.recurring].sort((a, b) => (a.nextDue || '').localeCompare(b.nextDue || ''));
    // Counted in one pass: asking the store for every document once per rule
    // re-sorted the whole history for each row on the list.
    const generatedPerRule = new Map();
    for (const d of store.docs()) {
      if (!d.recurringId) continue;
      generatedPerRule.set(d.recurringId, (generatedPerRule.get(d.recurringId) || 0) + 1);
    }

    root.append(el('div.page-head', {},
      el('div', {},
        el('h1.page-title', {}, 'Recurring'),
        el('p.page-sub', {}, 'Invoices that draft themselves on schedule')),
      el('div.page-actions', {},
        el('button.btn.btn-primary', {
          html: icon('plus', 16, 1.8),
          disabled: store.readOnly,
          title: store.readOnly ? 'Reconnect to set up a schedule' : null,
          onclick: () => navigate('#/new/recurring'),
        }, ' New schedule'))));

    if (!rules.length) {
      root.append(emptyState('repeat', 'Nothing recurring yet',
        'Retainers, subscriptions, maintenance fees: set them once and a draft invoice appears each period, ready to review and send.',
        store.readOnly ? null
          : el('button.btn.btn-primary', { onclick: () => navigate('#/new/recurring') }, 'Set up a schedule')));
      // Deleting the last schedule leaves this page; the button that did it
      // is gone, so focus goes to what stands here now.
      restoreFocus();
      return;
    }

    root.append(el('div.doc-list.card-list', {}, rules.map((r) => {
      const client = store.client(r.clientId);
      const total = docTotals(r).total;
      const generated = generatedPerRule.get(r.id) || 0;
      // Completed is derived from the end condition, so extending it in the
      // editor brings a wound-down schedule back to life.
      const done = ruleCompleted(r);
      const left = remainingOccurrences(r);
      const cap = Math.floor(Number(r.endCount) || 0);
      const state = done ? 'Completed' : r.paused ? 'Paused' : '';
      const sub = [
        client ? client.company || client.name : '',
        freqLabel(r.freq),
        done
          ? (r.endMode === 'date' ? `ended ${fmtDate(r.endDate)}` : 'ended')
          : r.paused ? '' : `next on ${fmtDate(r.nextDue)}`,
        // "2 of 6 left" is what tells a retainer winding down from an open one.
        !done && left !== null
          ? (r.endMode === 'count' ? `${left} of ${cap} left` : `${left} left`)
          : '',
        generated ? `${generated} created` : '',
      ].filter(Boolean).join(' · ');
      return el('div.doc-row.rule-row', {},
        el(`span.doc-row-ic${done ? '.rule-done' : ''}`, { html: icon(done ? 'circleCheck' : 'repeat', 17, 1.6) }),
        el('span.doc-row-main', {},
          el('span.doc-row-title', {},
            el('span.doc-row-number', {}, r.name || 'Recurring invoice'),
            state && el(`span.status-chip.small.tone-${done ? 'ok' : 'neutral'}`,
              { style: { marginInlineStart: '8px' } }, state)),
          el('span.doc-row-sub', {}, sub)),
        el('span.doc-row-end.rule-end', {},
          el('span.doc-row-amount', {}, fmtMoney(total, r.currency)),
          // Pausing, editing, and deleting a schedule are all writes: on a
          // device showing a saved copy the row says what the schedule does
          // and leaves it at that.
          !store.readOnly && el('span.rule-actions', {},
            // A completed schedule has nothing to pause; extending its end
            // condition in the editor is what restarts it.
            !done && el('button.icon-btn', {
              html: icon(r.paused ? 'play' : 'pause', 16, 1.6),
              'aria-label': r.paused ? `Resume ${r.name || 'schedule'}` : `Pause ${r.name || 'schedule'}`,
              title: r.paused ? 'Resume' : 'Pause',
              dataset: { rule: r.id, act: 'toggle' },
              onclick: async () => {
                try {
                  const resuming = r.paused;
                  await store.saveRecurring({ ...r, paused: !r.paused });
                  toast(resuming ? 'Schedule resumed' : 'Schedule paused', { icon: resuming ? 'play' : 'pause' });
                  // A resumed schedule whose date already passed should
                  // catch up now rather than at the next reload.
                  if (resuming) {
                    const n = await store.processRecurringDue().catch(() => 0);
                    if (n) toast(`${n} invoice${n === 1 ? '' : 's'} drafted from the schedule`, { icon: 'repeat' });
                  }
                } catch (err) {
                  console.error(err);
                  toast('Could not save. Check your connection', { icon: 'wifiOff' });
                }
              },
            }),
            el('button.icon-btn', {
              html: icon('pencil', 16, 1.6), 'aria-label': `Edit ${r.name || 'schedule'}`, title: 'Edit',
              dataset: { rule: r.id, act: 'edit' },
              onclick: () => navigate(`#/edit-recurring/${r.id}`),
            }),
            el('button.icon-btn', {
              html: icon('trash', 16, 1.6), 'aria-label': `Delete ${r.name || 'schedule'}`, title: 'Delete',
              dataset: { rule: r.id, act: 'delete' },
              onclick: async () => {
                const ok = await confirmDialog({
                  title: 'Delete this schedule?',
                  message: `Invoices it already created stay; no new ones are drafted. It moves to the trash, recoverable for ${TRASH_DAYS} days.`,
                });
                if (!ok) return;
                try {
                  await store.deleteRecurring(r.id);
                  toast('Schedule moved to the trash', {
                    icon: 'trash',
                    action: {
                      label: 'Undo',
                      onClick: async () => {
                        try {
                          await store.restoreRecurring(r.id);
                          toast('Schedule restored', { icon: 'undo' });
                        } catch (err) {
                          console.error(err);
                          toast('Could not restore. Check your connection', { icon: 'wifiOff' });
                        }
                      },
                    },
                  });
                } catch (err) {
                  console.error(err);
                  toast('Could not delete. Check your connection', { icon: 'wifiOff' });
                }
              },
            }))));
    })));
    restoreFocus();
  }

  store.addEventListener('change', render);
  root.destroy = () => store.removeEventListener('change', render);
  render();
  return root;
}

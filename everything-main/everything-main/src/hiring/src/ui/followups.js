/** Quick-add dialog for a candidate follow-up (text + due date, optional time). */
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { field } from './components.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { addDays, todayISO } from '../lib/dates.js';
import { errorRegion, runSave } from './editors/form.js';

export function openFollowupDialog(ctx, candidate) {
  const errors = errorRegion();
  // The store keeps 300 characters; capping the field keeps the cut
  // visible before saving instead of silently losing the tail after.
  const text = el('input', { class: 'input', type: 'text', maxlength: '300', placeholder: 'e.g. Call about the take-home' });
  const dueDate = el('input', { class: 'input', type: 'date', value: addDays(todayISO(), 1) });
  const dueTime = el('input', { class: 'input', type: 'time', 'aria-label': 'Due time (optional)' });
  text.addEventListener('keydown', (e) => e.key === 'Enter' && save.click());

  const save = el('button', { class: 'btn btn-primary' }, icon('calendar-check', 15), 'Add follow-up');
  save.addEventListener('click', async () => {
    const ok = await runSave(save, errors, () =>
      ctx.store.addFollowup(candidate.id, { text: text.value, dueDate: dueDate.value, dueTime: dueTime.value })
    );
    if (ok) {
      modal.close();
      toast('Follow-up added');
    }
  });

  const modal = openModal({
    title: `Follow up on ${candidate.name}`,
    content: [
      field('What needs doing?', text, 'fu-text'),
      el(
        'div',
        { class: 'field' },
        el('label', { for: 'fu-date' }, 'Due'),
        el('div', { class: 'input-row' }, dueDate, dueTime)
      ),
      errors.node,
    ],
    footer: [el('span', { class: 'grow' }), el('button', { class: 'btn', onClick: () => modal.close() }, 'Cancel'), save],
  });
  dueDate.id = 'fu-date';
}

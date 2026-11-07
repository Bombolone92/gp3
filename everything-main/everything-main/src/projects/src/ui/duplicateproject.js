import { el, requireValue } from '../lib/dom.js';
import { fieldId } from '../lib/util.js';
import { store, colorName, PROJECT_COLORS } from '../lib/store.js';
import { openModal } from './modal.js';
import { radioGroupKeys } from './bits.js';
import { toast } from './toast.js';
import { projectHash } from '../lib/routes.js';

/**
 * Duplicate a project: structure always, tasks optionally. Comments and
 * attachments are never copied, which the dialog says out loud so nobody has
 * to guess what "duplicate" means here.
 */
export function openDuplicateProject(projectId) {
  const source = store.projectEntry(projectId);
  if (!source) return null;

  let color = source.color;

  const nameId = fieldId('duplicate-name');
  const nameInput = el('input.input', {
    id: nameId,
    type: 'text',
    value: `${source.name} (copy)`.slice(0, 60),
    maxLength: 60,
    required: true,
  });

  const swatches = el('div.swatch-row', { role: 'radiogroup', 'aria-label': 'Project color' });
  function renderSwatches() {
    swatches.replaceChildren(...PROJECT_COLORS.map((c) => el('button.swatch', {
      type: 'button',
      role: 'radio',
      style: { background: c },
      'aria-checked': c === color ? 'true' : 'false',
      tabindex: c === color ? 0 : -1,
      'aria-label': colorName(c),
      title: colorName(c),
      className: `swatch${c === color ? ' selected' : ''}`,
      onclick: () => { color = c; renderSwatches(); },
    })));
  }
  renderSwatches();
  radioGroupKeys(swatches, '.swatch');

  const tasksBox = el('input', { type: 'checkbox', checked: true, id: 'dup-tasks' });

  const submitBtn = el('button.btn.btn-primary', { type: 'submit' }, 'Duplicate');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const name = requireValue(nameInput, 'The copy needs a name.');
      if (!name) return;
      submitBtn.disabled = true;
      try {
        const doc = await store.duplicateProject(projectId, {
          name, color, includeTasks: tasksBox.checked,
        });
        // Navigate before close so the dialog's history entry is consumed.
        location.replace(projectHash(doc.id));
        modal.close();
        toast('Project duplicated', { icon: 'copy' });
      } catch (err) {
        console.error(err);
        submitBtn.disabled = false;
        toast('Could not duplicate. Check your connection', { icon: 'cloudOff' });
      }
    },
  },
    el('div.field', {}, el('label.label', { htmlFor: nameId }, 'Name'), nameInput),
    el('div.field', {}, el('span.label', {}, 'Color'), swatches),
    el('label.check-row', { for: 'dup-tasks' },
      tasksBox,
      el('span', {},
        el('span.check-title', {}, 'Include tasks'),
        el('span.check-sub', {}, 'Off copies only the structure: columns, labels, members, and milestones.')
      )
    ),
    el('p.form-hint', {}, 'Comments and attachments are not copied.'),
    el('div.row.row-end', {},
      el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'),
      submitBtn
    )
  );

  const modal = openModal({ title: 'Duplicate project', content: form, dismissOnBack: true });
  return modal;
}

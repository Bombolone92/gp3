/** Settings: custom fields for matters and contacts. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app } from '../app.js';
import { formDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { card, field, textInput, select, textarea, emptyState, pill } from '../ui/components.js';
import { FIELD_TYPES } from './custom-fields.js';
import { newId } from '../core/ids.js';

const ENTITIES = [
  { id: 'matter', label: 'Matters' },
  { id: 'contact', label: 'Contacts' },
];

export function customFieldsSection(ctx) {
  const wrap = ctx.live(() => draw(), ['settings']);
  return wrap;
}

// After a reorder the list is redrawn; this puts focus back on the moved field.
let refocus = null; // { id, dir }

function draw() {
  const fields = app.settings().customFields || [];
  if (refocus) {
    const { id, dir } = refocus;
    refocus = null;
    // Runs once the redrawn list is in the page.
    queueMicrotask(() => {
      const up = document.querySelector(`[data-move="${id}:-1"]`);
      const down = document.querySelector(`[data-move="${id}:1"]`);
      const want = dir < 0 ? up : down;
      (want && !want.disabled ? want : dir < 0 ? down : up)?.focus();
    });
  }
  return h(
    'div.stack',
    h('p.subtle', 'Add your own fields to matters and contacts, such as a court case number, a referral source, or a date of injury. They appear on the forms and detail pages.'),
    ...ENTITIES.map((ent) => {
      const list = fields.filter((f) => f.entity === ent.id);
      return card({
        title: ent.label,
        count: list.length,
        actions: h('button.btn.sm', { type: 'button', onClick: () => editField({ entity: ent.id }) }, icon('plus', 15), 'Add field'),
        flush: true,
        body: list.length
          ? h(
              'ul.list.compact-list',
              list.map((f, i) =>
                h(
                  'li',
                  h(
                    'div.list-item',
                    h(
                      'span.grow',
                      h('span.title', f.label),
                      h('span.sub', [FIELD_TYPES.find((t) => t.id === f.type)?.label, f.type === 'select' ? (f.options || []).join(', ') : ''].filter(Boolean).join(' · ')),
                    ),
                    pill(FIELD_TYPES.find((t) => t.id === f.type)?.label || f.type, 'neutral'),
                    h('button.icon-btn.sm', { type: 'button', 'aria-label': `Move ${f.label} up`, dataset: { move: `${f.id}:-1` }, disabled: i === 0 || null, onClick: () => move(f, -1) }, icon('arrow-up', 15)),
                    h('button.icon-btn.sm', { type: 'button', 'aria-label': `Move ${f.label} down`, dataset: { move: `${f.id}:1` }, disabled: i === list.length - 1 || null, onClick: () => move(f, 1) }, icon('arrow-down', 15)),
                    h('button.icon-btn.sm', { type: 'button', 'aria-label': `Edit ${f.label}`, onClick: () => editField(f) }, icon('pencil', 15)),
                    h('button.icon-btn.sm', { type: 'button', 'aria-label': `Delete ${f.label}`, onClick: () => removeField(f) }, icon('trash', 15)),
                  ),
                ),
              ),
            )
          : emptyState({ compact: true, icon: 'sliders', title: `No custom fields for ${ent.label.toLowerCase()}`, headingLevel: 3 }),
      });
    }),
  );
}

function save(list) {
  app.store.saveSettings({ customFields: list });
}

function move(f, dir) {
  const all = [...(app.settings().customFields || [])];
  const same = all.filter((x) => x.entity === f.entity);
  const i = same.indexOf(same.find((x) => x.id === f.id));
  const j = i + dir;
  if (j < 0 || j >= same.length) return;
  [same[i], same[j]] = [same[j], same[i]];
  refocus = { id: f.id, dir };
  save([...all.filter((x) => x.entity !== f.entity), ...same]);
}

async function removeField(f) {
  const ok = await confirmDialog({
    title: `Delete "${f.label}"?`,
    message: 'The field disappears from forms and pages. Values already entered stay stored on records and come back if you add a field with the same definition.',
    confirmLabel: 'Delete field',
    danger: true,
  });
  if (!ok) return;
  save((app.settings().customFields || []).filter((x) => x.id !== f.id));
  toast('Field deleted');
}

function editField(f) {
  const existing = f.id ? f : null;
  const type = select({ name: 'type', value: f.type || 'text', options: FIELD_TYPES.map((t) => ({ value: t.id, label: t.label })) });
  const options = textarea({ name: 'options', value: (f.options || []).join('\n'), rows: 4, placeholder: 'One choice per line' });
  const optField = field('Choices', options, { hint: 'One choice per line.' });
  const sync = () => (optField.hidden = type.value !== 'select');
  type.addEventListener('change', sync);
  sync();
  return formDialog({
    title: existing ? 'Edit custom field' : 'New custom field',
    size: 'narrow',
    body: h('div.stack', field('Label', textInput({ name: 'label', value: f.label || '', autofocus: true }), { required: true }), field('Type', type), optField),
    submitLabel: existing ? 'Save field' : 'Add field',
    onSubmit: (fd) => {
      const opts = String(fd.get('options') || '')
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean);
      if (fd.get('type') === 'select' && !opts.length) {
        options.setAttribute('aria-invalid', 'true');
        options.focus();
        return false;
      }
      const rec = { id: existing?.id || newId(), entity: f.entity, label: String(fd.get('label')).trim(), type: fd.get('type'), options: fd.get('type') === 'select' ? opts : [] };
      const all = app.settings().customFields || [];
      save(existing ? all.map((x) => (x.id === rec.id ? rec : x)) : [...all, rec]);
      toast(existing ? 'Field saved' : 'Field added');
      return rec;
    },
  });
}

/**
 * Form view: design a form (title, description, which fields, labels,
 * help text, required), then fill it in to add records.
 */
import { h, announce, fill } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { TYPES, isReadOnly, isEmpty } from '../data/fields.js';
import { fieldInput, makeThumb } from '../ui/editors.js';
import { toast } from '../ui/toast.js';

export class FormView {
  constructor(page, table, view) {
    this.page = page;
    this.base = page.base;
    this.table = table;
    this.view = view;
    this.mode = 'build';
    this.el = h('div.form-view');
  }

  mounted() {
    this.render();
  }
  destroy() {
    this.dropPreviews();
  }
  update() {
    if (this.mode !== 'build') return;
    const a = document.activeElement;
    const inside = this.el.contains(a);
    // Rebuilding would interrupt typing in a label or help text.
    if (inside && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type === 'text'))) {
      this.renderSide();
      return;
    }
    const label = inside ? a.getAttribute('aria-label') : null;
    this.render();
    // Keep focus on the same control (a Move or Required button) for keyboard users.
    if (label) [...this.el.querySelectorAll('[aria-label]')].find((x) => x.getAttribute('aria-label') === label && !x.disabled)?.focus();
  }
  focus() {
    this.el.querySelector('input, textarea, button')?.focus();
  }

  form() {
    const f = this.view.form || { title: this.table.name, description: '', fields: [], submitLabel: 'Submit', message: 'Thanks for submitting the form.', another: true };
    // Show only fields that still exist and can be filled in (a field can
    // become computed after it was added). A copy: the stored form keeps
    // them, so undoing the change brings them back.
    const fields = (f.fields || []).filter((x) => {
      const field = this.table.field(x.id);
      return field && !isReadOnly(field);
    });
    return { ...f, fields };
  }

  save(patch, label = 'Edit form') {
    // Edits to other settings leave the stored field list as it is.
    this.base.updateView(this.table.id, this.view.id, { form: { ...this.form(), fields: this.view.form?.fields || [], ...patch } }, { label });
  }

  render() {
    if (this.mode === 'fill') return this.renderFill();
    const form = this.form();
    this.side = h('aside.form-side', { 'aria-label': 'Fields' });
    const title = h('input.form-title-input', { type: 'text', value: form.title, 'aria-label': 'Form title', placeholder: 'Form title' });
    title.addEventListener('change', () => this.save({ title: title.value }));
    const desc = h('textarea.form-desc-input', { rows: 2, placeholder: 'Add a description', 'aria-label': 'Form description' });
    desc.value = form.description || '';
    desc.addEventListener('change', () => this.save({ description: desc.value }));
    const list = h('ol.form-fields');
    form.fields.forEach((ff, i) => {
      const field = this.table.field(ff.id);
      const label = h('input.form-label-input', { type: 'text', value: ff.label || '', placeholder: field.name, 'aria-label': `Label for ${field.name}` });
      label.addEventListener('change', () => this.updateField(i, { label: label.value }));
      const help = h('input.form-help-input', { type: 'text', value: ff.help || '', placeholder: 'Help text (optional)', 'aria-label': `Help text for ${field.name}` });
      help.addEventListener('change', () => this.updateField(i, { help: help.value }));
      const req = h('input.switch', { type: 'checkbox', role: 'switch', checked: !!ff.required, 'aria-label': `${field.name} is required` });
      req.addEventListener('change', () => this.updateField(i, { required: req.checked }));
      list.append(h('li.form-field-card',
        h('div.form-card-head', icon(TYPES[field.type].icon, 14), h('span.muted', field.name), h('div.grow'),
          h('label.switch-row.small', req, h('span', 'Required')),
          h('button.icon-btn', { type: 'button', 'aria-label': `Move ${field.name} up`, disabled: i === 0, onclick: () => this.moveField(i, -1) }, icon('arrowUp', 14)),
          h('button.icon-btn', { type: 'button', 'aria-label': `Move ${field.name} down`, disabled: i === form.fields.length - 1, onclick: () => this.moveField(i, 1) }, icon('arrowDown', 14)),
          h('button.icon-btn', { type: 'button', 'aria-label': `Remove ${field.name} from the form`, onclick: () => this.save({ fields: form.fields.filter((_, k) => k !== i) }, 'Remove form field') }, icon('x', 14))),
        label, help, h('div.form-preview-input', { 'aria-hidden': 'true', inert: '' }, previewInput(field))));
    });
    const submitLabel = h('input.input', { type: 'text', value: form.submitLabel || 'Submit', 'aria-label': 'Submit button label' });
    submitLabel.addEventListener('change', () => this.save({ submitLabel: submitLabel.value || 'Submit' }));
    const message = h('input.input', { type: 'text', value: form.message || '', 'aria-label': 'Message after submitting' });
    message.addEventListener('change', () => this.save({ message: message.value }));
    const another = h('input.switch', { type: 'checkbox', role: 'switch', checked: form.another !== false });
    another.addEventListener('change', () => this.save({ another: another.checked }));
    const canvas = h('div.form-canvas',
      h('div.form-sheet',
        h('div.form-bar', h('span.muted', 'Editing the form'), h('div.grow'), h('button.btn.primary.small', { type: 'button', onclick: () => {
          this.mode = 'fill';
          this.render();
        } }, icon('play', 14), 'Open form')),
        title, desc,
        form.fields.length ? list : h('div.empty', h('p', 'Add fields from the list to build your form.')),
        h('div.form-settings',
          h('div.form-row', h('label.field-label', 'Submit button'), submitLabel),
          h('div.form-row', h('label.field-label', 'Message after submitting'), message),
          h('label.switch-row', another, h('span.grow', 'Offer to submit another response')))));
    this.el.replaceChildren(this.side, canvas);
    this.renderSide();
  }

  renderSide() {
    if (!this.side) return;
    const form = this.form();
    const used = new Set(form.fields.map((x) => x.id));
    const available = this.table.fields.filter((f) => !used.has(f.id) && !isReadOnly(f));
    fill(this.side,
      h('h2.side-title', 'Fields'),
      available.length ? h('p.muted.side-hint', 'Choose fields to add to the form.') : h('p.muted.side-hint', 'Every field that can be filled in is on the form.'),
      h('ul.form-available', available.map((f) => h('li', h('button.form-add-field', { type: 'button', onclick: () => this.save({ fields: [...form.fields, { id: f.id, required: false, label: '', help: '' }] }, 'Add form field') }, icon(TYPES[f.type].icon, 14), h('span.grow', f.name), icon('plus', 14))))),
      available.length > 1 ? h('button.link-btn', { type: 'button', onclick: () => this.save({ fields: [...form.fields, ...available.map((f) => ({ id: f.id, required: false, label: '', help: '' }))] }, 'Add all fields') }, 'Add all fields') : null,
    );
  }

  updateField(i, patch) {
    const form = this.form();
    const fields = form.fields.map((x, k) => (k === i ? { ...x, ...patch } : x));
    this.save({ fields });
  }

  moveField(i, d) {
    const fields = [...this.form().fields];
    const [m] = fields.splice(i, 1);
    fields.splice(i + d, 0, m);
    this.save({ fields }, 'Reorder form');
  }

  /** Let go of the previews of images picked in the form being filled in. */
  dropPreviews() {
    for (const v of Object.values(this.values || {})) {
      if (Array.isArray(v)) for (const a of v) if (a?.preview) URL.revokeObjectURL(a.preview);
    }
    this.values = null;
  }

  renderFill() {
    this.dropPreviews();
    const form = this.form();
    const values = {};
    this.values = values;
    const errors = new Map();
    const controls = new Map();
    const fakeRecord = { id: 'form', c: values, ct: Date.now() };
    const rows = form.fields.map((ff) => {
      const field = this.table.field(ff.id);
      const id = `form-${field.id}`;
      const err = h('p.field-error', { id: `${id}-err`, role: 'alert' });
      errors.set(field.id, err);
      const input = fieldInput(this.page, this.table, field, fakeRecord, {
        id,
        form: true,
        value: values[field.id],
        onChange: (v) => {
          values[field.id] = v;
          err.textContent = '';
          control?.removeAttribute('aria-invalid');
        },
      });
      // The element with the id: the input itself, or one inside a wrapper.
      const control = input.id === id ? input : input.querySelector?.(`#${CSS.escape(id)}`);
      controls.set(field.id, control);
      // Named by the form's label (pickers and ratings aren't labelable), described by help and errors.
      control?.removeAttribute('aria-label');
      control?.setAttribute('aria-labelledby', `${id}-label`);
      control?.setAttribute('aria-describedby', ff.help ? `${id}-help ${id}-err` : `${id}-err`);
      // Text inputs report as you type, so required checks see the latest
      // value. Dates are read when complete: they are reformatted on change.
      input.addEventListener?.('input', (e) => {
        if ((e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') && !e.target.closest('.date-input')) e.target.dispatchEvent(new Event('change'));
      });
      return h('div.form-q', h('label.form-q-label', { for: id, id: `${id}-label` }, ff.label || field.name, ff.required ? h('span.req', { 'aria-hidden': 'true' }, ' *') : null, ff.required ? h('span.sr-only', ' (required)') : null), ff.help ? h('p.form-q-help', { id: `${id}-help` }, ff.help) : null, input, err);
    });
    const submit = h('button.btn.primary', { type: 'submit' }, form.submitLabel || 'Submit');
    const formEl = h('form.form-fill', { novalidate: true }, h('h1.form-fill-title', form.title || this.table.name), form.description ? h('p.form-fill-desc', form.description) : null, ...rows, h('div.form-actions', submit));
    formEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      for (const el of formEl.querySelectorAll('.date-input input')) el.dispatchEvent(new Event('change'));
      let firstBad = null;
      let invalid = false;
      for (const ff of form.fields) {
        const field = this.table.field(ff.id);
        const control = controls.get(field.id);
        const label = ff.label || field.name;
        let msg = null;
        // Text that could not be read keeps the last value that could: never submit that.
        if (control?.classList.contains('invalid')) {
          msg = `Enter a valid ${KIND[field.type] || 'value'} for ${label}.`;
          invalid = true;
        } else if (ff.required && isEmpty(values[field.id])) msg = field.type === 'checkbox' ? `${label} must be checked.` : `${label} is required.`;
        if (!msg) continue;
        errors.get(field.id).textContent = msg;
        control?.setAttribute('aria-invalid', 'true');
        firstBad ||= control;
      }
      if (firstBad) {
        // A rating group is not focusable itself: its chosen (or first) star is.
        (firstBad.getAttribute('role') === 'radiogroup' ? firstBad.querySelector('[aria-checked="true"]') || firstBad.querySelector('button') : firstBad).focus?.();
        announce(invalid ? 'Some fields need fixing.' : 'Some required fields are empty.');
        return;
      }
      submit.disabled = true;
      try {
        const cells = {};
        for (const [fid, v] of Object.entries(values)) {
          const field = this.table.field(fid);
          if (field?.type === 'attachment' && Array.isArray(v)) {
            const atts = [];
            for (const a of v) {
              if (a.file) atts.push(await this.page.store.putFile(this.page.baseId, a.file, { thumb: await makeThumb(a.file) }));
            }
            if (atts.length) cells[fid] = atts;
          } else if (!isEmpty(v)) cells[fid] = v;
        }
        this.base.createRecords(this.table.id, [cells], { label: 'Submit form' });
        this.dropPreviews();
        this.showDone(form);
      } catch {
        toast('Could not submit the form.', { error: true });
        submit.disabled = false;
      }
    });
    this.el.replaceChildren(h('div.form-canvas.fill', h('div.form-bar.sticky', h('button.btn.small', { type: 'button', onclick: () => {
      this.dropPreviews();
      this.mode = 'build';
      this.render();
    } }, icon('arrowLeft', 14), 'Back to editing')), h('div.form-sheet', formEl)));
    formEl.querySelector('input, textarea, [tabindex="0"]')?.focus();
  }

  showDone(form) {
    const again = h('button.btn.primary', { type: 'button', onclick: () => this.renderFill() }, 'Submit another response');
    this.el.replaceChildren(h('div.form-canvas.fill', h('div.form-sheet.done', { role: 'status' },
      h('div.empty-icon', icon('check', 24)),
      h('h2', form.message || 'Thanks for submitting the form.'),
      form.another !== false ? again : null,
      h('button.btn.ghost', { type: 'button', onclick: () => {
        this.mode = 'build';
        this.render();
      } }, 'Back to editing'))));
    (form.another !== false ? again : this.el.querySelector('button'))?.focus();
  }
}

// What a field's text should be, for "Enter a valid ..." errors.
const KIND = { number: 'number', currency: 'amount', percent: 'percentage', duration: 'duration', date: 'date', email: 'email address', url: 'link', phone: 'phone number' };

function previewInput(field) {
  if (field.type === 'longText') return h('div.input.fake.tall');
  if (field.type === 'checkbox') return h('span.card-check.off');
  if (field.type === 'attachment') return h('div.input.fake', icon('upload', 14), ' Upload files');
  if (field.type === 'singleSelect' || field.type === 'multipleSelect' || field.type === 'link') return h('div.input.fake', icon('chevronDown', 14));
  return h('div.input.fake');
}

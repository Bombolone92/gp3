/**
 * Firm-defined custom fields on matters and contacts. Definitions live in
 * settings.customFields: [{ id, entity: 'matter' | 'contact', label, type, options }]
 * and values on the record as record.custom = { [fieldId]: value }.
 */
import { h } from '../ui/dom.js';
import { field, textInput, select, checkbox } from '../ui/components.js';
import { formatDate } from '../core/dates.js';
import { app } from '../app.js';

export const FIELD_TYPES = [
  { id: 'text', label: 'Text' },
  { id: 'number', label: 'Number' },
  { id: 'date', label: 'Date' },
  { id: 'select', label: 'Choice list' },
  { id: 'checkbox', label: 'Yes or no' },
];

export function fieldsFor(entity) {
  return (app.settings().customFields || []).filter((f) => f.entity === entity);
}

/** Inputs for every custom field of an entity. read() returns the custom object. */
export function customFieldInputs(entity, values = {}) {
  const defs = fieldsFor(entity);
  const controls = new Map();
  const nodes = defs.map((f) => {
    const name = `cf_${f.id}`;
    const v = values?.[f.id];
    if (f.type === 'checkbox') {
      const c = checkbox({ name, label: f.label, checked: !!v });
      controls.set(f.id, () => c.querySelector('input').checked);
      return c;
    }
    let control;
    if (f.type === 'select') {
      const opts = f.options || [];
      // A value whose choice was since removed stays selectable, so saving keeps it.
      const kept = v && !opts.includes(v) ? [v] : [];
      control = select({ name, value: v ?? '', options: [{ value: '', label: 'Not set' }, ...[...opts, ...kept].map((o) => ({ value: o, label: o }))] });
    }
    else control = textInput({ name, type: f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text', value: v ?? '', step: f.type === 'number' ? 'any' : null });
    controls.set(f.id, () => (f.type === 'number' ? (control.value === '' ? null : Number(control.value)) : control.value.trim()));
    return field(f.label, control);
  });
  return {
    count: defs.length,
    node: defs.length ? h('div.grid-2', nodes) : null,
    read() {
      const out = { ...(values || {}) };
      for (const [id, get] of controls) {
        const v = get();
        if (v === '' || v === null || v === false) delete out[id];
        else out[id] = v;
      }
      return out;
    },
  };
}

/** [label, display value] pairs for a record's custom fields that have values. */
export function customFieldPairs(entity, values = {}) {
  return fieldsFor(entity)
    .filter((f) => values?.[f.id] !== undefined && values?.[f.id] !== '')
    .map((f) => {
      const v = values[f.id];
      return [f.label, f.type === 'checkbox' ? (v ? 'Yes' : 'No') : f.type === 'date' ? formatDate(v) : String(v)];
    });
}

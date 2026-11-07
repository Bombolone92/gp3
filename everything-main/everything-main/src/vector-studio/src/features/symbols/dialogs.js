/**
 * Symbol dialogs: New Symbol / Symbol Options and the question asked when
 * deleting symbols that are in use.
 */
import { h } from '../../lib/dom.js';
import { openDialog } from '../../ui/dialogs/dialog.js';
import { referencePointGrid } from '../../ui/panels/transform-section.js';
import { formatLength, parseLength } from '../../lib/units.js';

/** Registration codes for the nine points of the reference grid, row by row. */
export const REG_CODES = ['tl', 'tc', 'tr', 'cl', 'cc', 'cr', 'bl', 'bc', 'br'];

let counter = 0;

/**
 * New Symbol / Symbol Options. `values`: { name, kind, registration (code
 * or null for a custom point), slice9 (bool), insets ({ left, top, right,
 * bottom } or null), pixelAlign }. `bounds` (the master's size) enables
 * editing the 9-slice guides as insets. Resolves to the edited values or
 * null.
 */
export function symbolOptionsDialog(app, { title = 'Symbol Options', values, bounds = null, okLabel = 'OK' }) {
  const id = `symo-${++counter}`;
  const unit = app?.editor?.doc.root.units || 'pt';
  const name = h('input', { type: 'text', id: `${id}-name`, value: values.name || '', spellcheck: false, autocomplete: 'off' });
  const kindRadio = (v, label, help) =>
    h(
      'label.radio.symo-kind',
      h('input', { type: 'radio', name: `${id}-kind`, value: v, checked: (values.kind || 'dynamic') === v }),
      h('span', h('span.symo-kind-label', label), h('span.symo-help', help)),
    );
  const kinds = h(
    'div.radio-group.symo-kinds',
    { role: 'radiogroup', 'aria-labelledby': `${id}-kind-l` },
    kindRadio('dynamic', 'Dynamic', 'Instances can recolor individual parts'),
    kindRadio('static', 'Static', 'Every instance looks exactly like the master'),
  );
  let reg = values.registration ?? null;
  const regIndex = REG_CODES.indexOf(reg);
  const regGrid = referencePointGrid(regIndex, (i) => {
    reg = REG_CODES[i];
    regLabel.textContent = regName(reg);
  });
  regGrid.el.setAttribute('aria-labelledby', `${id}-reg-l`);
  // A custom point selects none of the nine; keep the grid reachable with Tab.
  if (regIndex < 0) regGrid.el.children[4].tabIndex = 0;
  regGrid.el.classList.add('symo-reg');
  const regLabel = h('span.symo-reg-label', regName(reg));
  const slice = h('input', { type: 'checkbox', id: `${id}-slice`, checked: Boolean(values.slice9) });
  const pixel = h('input', { type: 'checkbox', id: `${id}-pixel`, checked: Boolean(values.pixelAlign) });

  // 9-slice guides as distances from the artwork's edges.
  const insetFields = {};
  let insetsRow = null;
  if (bounds) {
    const ins = values.insets || { left: bounds.w / 3, top: bounds.h / 3, right: bounds.w / 3, bottom: bounds.h / 3 };
    const field = (key, label) => {
      const input = h('input', { type: 'text', id: `${id}-${key}`, value: formatLength(ins[key], unit), inputmode: 'decimal', spellcheck: false, autocomplete: 'off' });
      insetFields[key] = input;
      return h('label.symo-inset', h('span', label), input);
    };
    insetsRow = h(
      'fieldset.symo-insets',
      h('legend', 'Guides from the edges'),
      field('left', 'Left'),
      field('top', 'Top'),
      field('right', 'Right'),
      field('bottom', 'Bottom'),
    );
  }
  const syncInsets = () => {
    if (insetsRow) insetsRow.disabled = !slice.checked;
  };
  slice.addEventListener('change', syncInsets);
  syncInsets();
  const error = h('p.form-error', { role: 'alert' });

  const body = h(
    'div.form.symbol-options',
    h('div.form-row', h('label', { for: `${id}-name` }, 'Name'), name),
    h('div.form-row', h('span.form-label', { id: `${id}-kind-l` }, 'Type'), kinds),
    h('div.form-row', h('span.form-label', { id: `${id}-reg-l` }, 'Registration'), h('div.symo-reg-wrap', regGrid.el, regLabel)),
    h('div.form-row.check', slice, h('label', { for: `${id}-slice` }, 'Enable guides for 9-slice scaling')),
    insetsRow,
    h('div.form-row.check', pixel, h('label', { for: `${id}-pixel` }, 'Align to pixel grid')),
    error,
  );

  const read = () => {
    let insets = null;
    if (bounds && slice.checked) {
      insets = {};
      for (const [k, input] of Object.entries(insetFields)) insets[k] = parseLength(input.value, unit);
    }
    return {
      name: name.value.trim(),
      kind: body.querySelector(`input[name="${id}-kind"]:checked`)?.value || 'dynamic',
      registration: reg,
      slice9: slice.checked,
      insets,
      pixelAlign: pixel.checked,
    };
  };
  const validate = () => {
    const v = read();
    if (!v.name) {
      error.textContent = 'Enter a name for the symbol.';
      name.focus();
      return false;
    }
    if (v.insets) {
      const bad = Object.entries(v.insets).find(([, x]) => !Number.isFinite(x) || x < 0);
      if (bad) {
        error.textContent = 'Enter a distance of zero or more for each guide.';
        insetFields[bad[0]].focus();
        return false;
      }
      if (v.insets.left + v.insets.right > bounds.w + 1e-9 || v.insets.top + v.insets.bottom > bounds.h + 1e-9) {
        error.textContent = 'The guides cross: make the distances smaller.';
        insetFields.left.focus();
        return false;
      }
    }
    error.textContent = '';
    return true;
  };
  return openDialog({
    title,
    body,
    className: 'symbol-options-dialog',
    initialFocus: () => name,
    buttons: [
      { label: 'Cancel', value: null },
      { label: okLabel, primary: true, value: () => read(), validate },
    ],
  });
}

function regName(code) {
  if (!code) return 'Custom point';
  const row = { t: 'Top', c: 'Middle', b: 'Bottom' }[code[0]];
  const col = { l: 'left', c: 'center', r: 'right' }[code[1]];
  return code === 'cc' ? 'Center' : `${row} ${col}`;
}

/** The registration code of a point on a rect, or null when it is none of the nine. */
export function registrationCode(b, p) {
  if (!b || !p) return 'cc';
  const eps = Math.max(1e-6, Math.max(b.w, b.h) * 1e-6);
  const col = Math.abs(p.x - b.x) < eps ? 'l' : Math.abs(p.x - (b.x + b.w / 2)) < eps ? 'c' : Math.abs(p.x - (b.x + b.w)) < eps ? 'r' : null;
  const row = Math.abs(p.y - b.y) < eps ? 't' : Math.abs(p.y - (b.y + b.h / 2)) < eps ? 'c' : Math.abs(p.y - (b.y + b.h)) < eps ? 'b' : null;
  return col && row ? row + col : null;
}

/**
 * Asked before deleting symbols that are in use. Resolves to 'expand'
 * (instances become plain artwork), 'delete' (instances go too) or null.
 */
export function deleteInUseDialog({ names, count }) {
  const what = names.length === 1 ? `"${names[0]}" is` : `${names.length} of these symbols are`;
  return openDialog({
    title: 'Delete Symbol',
    body: h('p.dialog-message', `${what} used by ${count} ${count === 1 ? 'instance' : 'instances'}. Keep their artwork as plain objects, or delete them too?`),
    buttons: [
      { label: 'Cancel', value: null, left: true },
      { label: 'Delete Instances', value: 'delete', danger: true },
      { label: 'Expand Instances', value: 'expand', primary: true },
    ],
  });
}

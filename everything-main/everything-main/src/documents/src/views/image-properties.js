import { el } from '../ui/dom.js';
import { openModal } from '../ui/modal.js';
import { EMU_PER_INCH, ANGLE_PER_DEGREE, normalizedRotation, normalizeCrop, CROP_SIDES } from '../engine/images.js';

export function openImageProperties(image, apply, { canResize = false } = {}) {
  const resizeOnly = image.retainedDrawing && canResize;
  if (image.retainedDrawing && !resizeOnly) {
    const modal = openModal({ title: 'Drawing properties', content: el('div', {},
      el('p', {}, 'This drawing is preserved as a complete object. You can select, delete, and undo it. Editing its contents or appearance is not available yet.'),
      el('div.row.row-end', {}, el('button.btn.btn-primary', { type: 'button', onclick: () => modal.close() }, 'Done'))) });
    return modal;
  }
  image = { ...image };
  const pending = new AbortController();
  const decimal = value => String(Number((value / EMU_PER_INCH).toFixed(6)));
  const field = (label, control) => el('label.field', {}, el('span.field-label', {}, label), control);
  // Sizes show two decimals; the exact values behind them are what is applied unless retyped.
  const shown = inches => String(Number(Number(inches).toFixed(2)));
  const exact = { width: decimal(image.width), height: decimal(image.height) };
  const width = el('input.input', { type: 'number', min: .000001, max: 22, step: 'any', required: true, value: shown(exact.width), 'aria-label': 'Image width (in)' });
  const height = el('input.input', { type: 'number', min: .000001, max: 22, step: 'any', required: true, value: shown(exact.height), 'aria-label': 'Image height (in)' });
  const proportions = el('input', { type: 'checkbox', checked: true, disabled: image.aspectLocked, 'aria-label': 'Keep image proportions' });
  width.addEventListener('input', () => { exact.width = width.value; if (proportions.checked) { exact.height = decimal(Number(width.value) * EMU_PER_INCH * image.height / image.width); height.value = shown(exact.height); } });
  height.addEventListener('input', () => { exact.height = height.value; if (proportions.checked) { exact.width = decimal(Number(height.value) * EMU_PER_INCH * image.width / image.height); width.value = shown(exact.width); } });
  const size = (input, key) => input.value === shown(exact[key]) ? exact[key] : input.value;
  const alt = el('textarea.input', { maxLength: 2000, rows: 3, value: image.alt, 'aria-label': 'Image alt text' });
  const originalCrop = normalizeCrop(image.crop);
  const crop = Object.fromEntries(CROP_SIDES.map(side => [side, el('input.input', { type: 'number', min: -2147483.648, max: 2147483.647, step: .001, required: true, value: originalCrop[side] / 1000, 'aria-label': `Crop ${side} (%)` })]));
  const cropFields = CROP_SIDES.map(side => field(`${side[0].toUpperCase() + side.slice(1)} (%)`, crop[side]));
  const flipH = el('input', { type: 'checkbox', checked: !!image.flipH, 'aria-label': 'Flip image horizontally' });
  const flipV = el('input', { type: 'checkbox', checked: !!image.flipV, 'aria-label': 'Flip image vertically' });
  const degrees = String(Number((normalizedRotation(image.rotation) / ANGLE_PER_DEGREE).toFixed(6)));
  const rotation = el('input.input', { type: 'number', min: -360, max: 360, step: 'any', required: true, value: degrees, disabled: image.rotateWithShape === false, 'aria-label': 'Image rotation (degrees)' });
  const error = el('p.field-error', { role: 'alert', hidden: true });
  for (const control of [width, height, alt, flipH, flipV, rotation, ...Object.values(crop)]) control.addEventListener('input', () => { error.hidden = true; });
  const form = el('form.image-form', { onsubmit: e => {
    e.preventDefault();
    const patch = {};
    const w = size(width, 'width'), h = size(height, 'height');
    if (w !== decimal(image.width)) patch.width = Math.round(Number(w) * EMU_PER_INCH);
    if (h !== decimal(image.height)) patch.height = Math.round(Number(h) * EMU_PER_INCH);
    if (alt.value !== image.alt) patch.alt = alt.value;
    if (flipH.checked !== !!image.flipH) patch.flipH = flipH.checked;
    if (flipV.checked !== !!image.flipV) patch.flipV = flipV.checked;
    if (rotation.value !== degrees) patch.rotation = Math.round(Number(rotation.value) * ANGLE_PER_DEGREE);
    const offsets = Object.fromEntries(CROP_SIDES.map(side => [side, Math.round(Number(crop[side].value) * 1000)]));
    try { normalizeCrop(offsets); } catch (e) { error.textContent = e.message; error.hidden = false; return; }
    if (CROP_SIDES.some(side => offsets[side] !== originalCrop[side])) patch.crop = offsets;
    const finish = ok => {
      if (ok !== false) modal.close();
      else { error.textContent = 'These image settings could not be applied. Check its rotation, dimensions and available page space.'; error.hidden = false; }
    };
    const result = apply(patch, pending.signal);
    if (result?.then) {
      const submit=form.querySelector('[type=submit]');submit.disabled=true;
      result.then(finish).finally(()=>{submit.disabled=false;});
    } else finish(result);
  } }, el('div.canvas-page-fields', {}, field('Width (in)', width), field('Height (in)', height)),
  el('p.field-hint', {}, 'Select the picture to use its Move control or corner resize handles. Use Alt+click, or the right-click menu, to select a picture behind text.'),
  el('label.row', {}, proportions, 'Keep proportions'),
  ...(resizeOnly ? [el('p.field-hint', {}, 'Resizing preserves this picture’s crop and visual effects.')] : [
  el('div.row', {}, el('label.row', {}, flipH, 'Flip horizontally'), el('label.row', {}, flipV, 'Flip vertically')),
  field('Rotation (degrees)', rotation), el('p.field-hint', {}, image.rotateWithShape === false ? 'This picture’s fill cannot be rotated here.' : 'Positive angles turn clockwise. Width and height describe the unrotated picture; space expands to keep every corner visible.'), field('Alt text', alt),
  el('p.field-hint', {}, 'Describe what the image communicates. Leave blank for a decorative image.'),
  el('fieldset.image-crop', {}, el('legend', {}, 'Crop source image'), el('div.canvas-page-fields', {}, ...cropFields),
    el('p.field-hint', {}, 'Positive percentages trim an edge. Negative percentages add transparent space. Crop edges refer to the original image, before flipping and rotation. The frame keeps its size.'),
    el('button.btn.btn-ghost', { type: 'button', onclick: () => { for (const control of Object.values(crop)) control.value = '0'; error.hidden = true; } }, 'Reset crop'))]), error,
  el('div.row.row-end', {}, el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'), el('button.btn.btn-primary', { type: 'submit' }, 'Apply')));
  const modal = openModal({ title: 'Image properties', content: form, onClose:()=>pending.abort() }); return modal;
}

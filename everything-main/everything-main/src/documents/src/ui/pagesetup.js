/**
 * Page setup: paper size, orientation, margins, the distance of the header
 * and footer from the page edge, and where the text sits vertically on a
 * short page, for the whole document. The engine's section API measures in
 * inches; the dialog shows inches or centimeters to match the ruler's
 * measurement unit and converts back.
 */

import { el } from './dom.js';
import { openModal } from './modal.js';
import { segmented } from './segmented.js';

export const PAPER_SIZES = [
  { id: 'letter', label: 'Letter (8.5 × 11 in)', width: 8.5, height: 11 },
  { id: 'legal', label: 'Legal (8.5 × 14 in)', width: 8.5, height: 14 },
  { id: 'tabloid', label: 'Tabloid (11 × 17 in)', width: 11, height: 17 },
  { id: 'a4', label: 'A4 (210 × 297 mm)', width: 8.27, height: 11.69 },
  { id: 'a5', label: 'A5 (148 × 210 mm)', width: 5.83, height: 8.27 },
  { id: 'b5', label: 'B5 (176 × 250 mm)', width: 6.93, height: 9.84 },
];

const CM_PER_IN = 2.54;

/** Where the text sits between the top and bottom margins (vertical alignment, `w:vAlign`). */
export const VERTICAL_ALIGNMENTS = [
  { id: 'top', label: 'Top' },
  { id: 'center', label: 'Center' },
  { id: 'bottom', label: 'Bottom' },
  { id: 'both', label: 'Justified' },
];

export function toUnit(inches, unit) {
  const v = unit === 'cm' ? inches * CM_PER_IN : inches;
  return Math.round(v * 100) / 100;
}

export function fromUnit(value, unit) {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return NaN;
  return unit === 'cm' ? n / CM_PER_IN : n;
}

/** Which preset (if any) a page's portrait dimensions match. */
export function matchPaper(width, height) {
  const w = Math.min(width, height);
  const h = Math.max(width, height);
  return PAPER_SIZES.find((p) => Math.abs(p.width - w) < 0.03 && Math.abs(p.height - h) < 0.03) || null;
}

/**
 * Turn dialog values into section settings (inches). Returns
 * { pageSetup: { width, height, orientation }, margins } or an error string;
 * `headerFooter` ({ header, footer }) and `verticalAlign` are included when
 * given.
 */
export function buildPageSetup({ paper, orientation, width, height, margins, unit, headerDistance, footerDistance, verticalAlign }) {
  let w;
  let h;
  const preset = PAPER_SIZES.find((p) => p.id === paper);
  const exactW = fromUnit(width, unit), exactH = fromUnit(height, unit);
  // A page already of the chosen size keeps its exact dimensions: A4 is commonly stored as 11906 by 16838 twips, and
  // the preset's rounded inches would rewrite it as 11909 by 16834 every time the dialog is applied.
  const exact = preset && matchPaper(exactW, exactH)?.id === preset.id;
  if (exact) { w = Math.min(exactW, exactH); h = Math.max(exactW, exactH); }
  else if (preset) { w = preset.width; h = preset.height; } else {
    w = exactW;
    h = exactH;
    if (!(w >= 1 && w <= 22) || !(h >= 1 && h <= 22)) return 'Page size must be between 1 and 22 inches (2.5 to 56 cm)';
  }
  // Presets are stored portrait; landscape swaps them.
  const portrait = orientation !== 'landscape';
  const pageW = portrait ? Math.min(w, h) : Math.max(w, h);
  const pageH = portrait ? Math.max(w, h) : Math.min(w, h);
  const m = {};
  for (const side of ['top', 'bottom', 'left', 'right']) {
    const v = fromUnit(margins[side], unit);
    if (!(v >= 0)) return 'Margins must be zero or more';
    // Taken as it is: rounding to a thousandth of an inch put an untouched 2 cm margin (1134 twips) a twip off.
    m[side] = v;
  }
  if (m.left + m.right >= pageW - 0.5 || m.top + m.bottom >= pageH - 0.5) return 'Margins leave no room for text';
  // A size kept from the document stays exact; a preset's or typed size is rounded for reading.
  const round = (v) => (exact ? v : Math.round(v * 1000) / 1000);
  const out = { pageSetup: { width: round(pageW), height: round(pageH), orientation: portrait ? 'portrait' : 'landscape' }, margins: m };
  if (headerDistance !== undefined || footerDistance !== undefined) {
    const hf = {};
    for (const [key, value] of [['header', headerDistance], ['footer', footerDistance]]) {
      const v = fromUnit(value, unit);
      if (!(v >= 0)) return 'Header and footer distances must be zero or more';
      if (v >= pageH / 2) return 'Header and footer distances must fit on the page';
      hf[key] = Math.round(v * 1000) / 1000;
    }
    out.headerFooter = hf;
  }
  if (verticalAlign !== undefined) {
    if (!VERTICAL_ALIGNMENTS.some((a) => a.id === verticalAlign)) return 'Choose a vertical alignment';
    out.verticalAlign = verticalAlign;
  }
  return out;
}

/**
 * openPageSetup({ current: { width, height, orientation, margins }, unit, onApply })
 * `current` is in inches. Resolves after apply or cancel.
 */
export function openPageSetup({ current, unit = 'in', onApply }) {
  return new Promise((resolve) => {
    let done = false, applying = false, controller = null;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let u = unit === 'cm' ? 'cm' : 'in';
    const preset = matchPaper(current.width, current.height);
    const landscape = current.orientation === 'landscape' || current.width > current.height;

    const paperSel = el('select.select', { 'aria-label': 'Paper size' },
      PAPER_SIZES.map((p) => el('option', { value: p.id, selected: preset?.id === p.id }, p.label)),
      el('option', { value: 'custom', selected: !preset }, 'Custom'));

    // Each field remembers the exact measurement it shows (in inches) and the
    // text it was given. A field the user did not touch applies that exact
    // value: the displayed number is rounded for reading, and converting it
    // back would nudge 0.75 in to 0.752 in on every Apply in centimeters.
    const sources = new Map(), shown = new Map();
    const show = (input, inches, unit = u) => { sources.set(input, inches); input.value = toUnit(inches, unit); shown.set(input, input.value); };
    const inchesOf = (input, unit = u) => (input.value === shown.get(input) ? sources.get(input) : fromUnit(input.value, unit));
    // Any step: eighth-inch measurements (0.125, 0.375) must not trip the browser's step check.
    const num = (label, inches) => { const input = el('input.input', { type: 'number', step: 'any', min: '0', inputmode: 'decimal', 'aria-label': label }); show(input, inches); return input; };
    const widthIn = num('Page width', current.width);
    const heightIn = num('Page height', current.height);
    const margins = Object.fromEntries(['top', 'bottom', 'left', 'right'].map((s) => [s, num(`${s[0].toUpperCase()}${s.slice(1)} margin`, current.margins?.[s] ?? 1)]));
    const headerIn = num('Header from the top edge', current.headerFooterMargins?.header ?? 0.5);
    const footerIn = num('Footer from the bottom edge', current.headerFooterMargins?.footer ?? 0.5);
    let verticalAlign = VERTICAL_ALIGNMENTS.some((a) => a.id === current.verticalAlign) ? current.verticalAlign : 'top';
    const alignChoices = segmented(VERTICAL_ALIGNMENTS.map((a) => [a.id, a.label]), verticalAlign,
      (value) => { verticalAlign = value; }, 'Vertical alignment');

    const unitLabel = () => (u === 'cm' ? 'cm' : 'in');
    const unitTags = [];
    let unitTagCount = 0;
    // The unit shown beside a field is part of its meaning: the field points at it, so a screen reader says "Left margin, in".
    const withUnit = (input) => { const tag = el('span.unit-tag', { id: `pagesetup-unit-${Date.now().toString(36)}-${++unitTagCount}` }, unitLabel()); unitTags.push(tag); input.setAttribute('aria-describedby', tag.id); return el('div.unit-field', {}, input, tag); };

    const customRow = el('div.grid-2', {},
      el('label.field', {}, el('span.field-label', {}, 'Width'), withUnit(widthIn)),
      el('label.field', {}, el('span.field-label', {}, 'Height'), withUnit(heightIn)));
    const syncCustom = () => { customRow.hidden = paperSel.value !== 'custom'; };
    paperSel.addEventListener('change', syncCustom);
    syncCustom();

    let orientation = landscape ? 'landscape' : 'portrait';
    // A custom size and the orientation describe the same thing twice:
    // typing 11 × 8.5 turns the choice to Landscape, and choosing
    // Landscape for 8.5 × 11 swaps the two fields, so nothing is silently swapped on Apply.
    const orientChoices = segmented([['portrait', 'Portrait'], ['landscape', 'Landscape']], orientation,
      (value) => {
        orientation = value;
        if (paperSel.value !== 'custom') return;
        const w = inchesOf(widthIn), h = inchesOf(heightIn);
        if (!(w > 0) || !(h > 0) || w === h || (value === 'landscape') === (w > h)) return;
        const [wText, hText] = [widthIn.value, heightIn.value];
        const [wShown, hShown] = [shown.get(widthIn), shown.get(heightIn)];
        sources.set(widthIn, h); sources.set(heightIn, w);
        widthIn.value = hText; heightIn.value = wText;
        shown.set(widthIn, hShown); shown.set(heightIn, wShown);
      }, 'Orientation');
    const followSize = () => {
      if (paperSel.value !== 'custom') return;
      const w = fromUnit(widthIn.value, u), h = fromUnit(heightIn.value, u);
      if (!(w > 0) || !(h > 0) || w === h) return;
      orientation = w > h ? 'landscape' : 'portrait';
      orientChoices.select(orientation);
    };
    widthIn.addEventListener('input', followSize);
    heightIn.addEventListener('input', followSize);

    const unitChoices = segmented([['in', 'Inches'], ['cm', 'Centimeters']], u,
      (v) => {
        if (u === v) return;
        // Convert what is typed so the numbers follow the unit; untouched fields show their exact value in the new unit.
        for (const input of [widthIn, heightIn, headerIn, footerIn, ...Object.values(margins)]) {
          const inches = inchesOf(input);
          if (Number.isFinite(inches)) show(input, inches, v);
        }
        u = v;
        for (const t of unitTags) t.textContent = unitLabel();
      },
    'Units');

    const error = el('p.field-error', { hidden: true, role: 'alert' });
    const submit = async (e) => {
      e.preventDefault();
      if (done || applying) return;
      // Every field goes in as exact inches: untouched ones as they were read, edited ones as typed.
      const built = buildPageSetup({
        paper: paperSel.value, orientation, width: inchesOf(widthIn), height: inchesOf(heightIn), unit: 'in',
        margins: Object.fromEntries(Object.entries(margins).map(([k, i]) => [k, inchesOf(i)])),
        headerDistance: inchesOf(headerIn), footerDistance: inchesOf(footerIn), verticalAlign,
      });
      if (typeof built === 'string') { error.textContent = built; error.hidden = false; return; }
      applying = true;
      controller = new AbortController();
      error.hidden = true;
      const controls = [...content.querySelectorAll('input, select, button')].filter((control) => control !== cancelBtn);
      const disabled = controls.map((control) => control.disabled);
      controls.forEach((control) => { control.disabled = true; });
      applyBtn.textContent = 'Applying…';
      content.setAttribute('aria-busy', 'true');
      try {
        await Promise.resolve();
        if (done) return;
        const err = await onApply(built, { signal: controller.signal });
        if (done) return;
        if (err) throw new Error(err);
        finish(built);
        modal.close();
      } catch (err) {
        if (!done) { error.textContent = err?.message || 'Could not apply the page setup'; error.hidden = false; }
      } finally {
        applying = false;
        if (!done) {
          controls.forEach((control, index) => { control.disabled = disabled[index]; });
          applyBtn.textContent = 'Apply';
          content.setAttribute('aria-busy', 'false');
          if (!error.hidden) applyBtn.focus({ preventScroll: true });
        }
      }
    };
    const applyBtn = el('button.btn.btn-primary', { type: 'submit' }, 'Apply');
    const cancelBtn = el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel');
    // The dialog validates itself; a browser bubble on a hidden custom-size field would block Apply silently.
    const content = el('form.page-setup', { novalidate: true, onsubmit: submit },
      el('label.field', {}, el('span.field-label', {}, 'Paper size'), paperSel),
      customRow,
      el('div.field', {}, el('span.field-label', {}, 'Orientation'), orientChoices),
      el('div.field', {}, el('span.field-label', {}, 'Units'), unitChoices),
      el('div.field', {},
        el('span.field-label', {}, 'Margins'),
        el('div.grid-2', {},
          ...['top', 'bottom', 'left', 'right'].map((s) => el('label.field.field-inline', {}, el('span.field-label', {}, s[0].toUpperCase() + s.slice(1)), withUnit(margins[s]))))),
      el('div.field', {},
        el('span.field-label', {}, 'Header and footer from the edge'),
        el('div.grid-2', {},
          el('label.field.field-inline', {}, el('span.field-label', {}, 'Header'), withUnit(headerIn)),
          el('label.field.field-inline', {}, el('span.field-label', {}, 'Footer'), withUnit(footerIn)))),
      el('div.field', {},
        el('span.field-label', {}, 'Vertical alignment'),
        alignChoices,
        el('span.field-hint', {}, 'Where the text sits on a page that is not full: at the top, centered, at the bottom, or spread out.')),
      error,
      el('p.field-hint', {}, 'Applies to every section of the document.'),
      el('div.row.row-end', {},
        cancelBtn,
        applyBtn));
    const modal = openModal({ title: 'Page setup', content, onClose: () => { finish(null); controller?.abort(); } });
  });
}

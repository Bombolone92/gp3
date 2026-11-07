/**
 * The formatting toolbar. Every control is a native button or select bound
 * to the app's UI controller (`ui`): buttons mirror command
 * `enabled` / `active` state with `disabled` / `aria-pressed`, pickers read
 * their current value from the controller, and clicks route back through the
 * same commands the engine's own toolbar would use.
 *
 * createToolbar({ onLink, onImage, onTable, focusEditor }) -> { el, bind(ui), unbind() }
 */

import { el, MOD_KEY } from './dom.js';
import { icon, iconEl } from './icons.js';
import { openMenu, closeMenu, menuAnchor, clickClosedMenu } from './menu.js';
import { openColorMenu, TEXT_COLORS, HIGHLIGHT_COLORS, normalizeHex } from './colors.js';

export const ALIGNMENTS = [
  { value: 'left', label: 'Align left', icon: 'alignLeft', shortcut: `${MOD_KEY}+Shift+L` },
  { value: 'center', label: 'Align center', icon: 'alignCenter', shortcut: `${MOD_KEY}+Shift+E` },
  { value: 'right', label: 'Align right', icon: 'alignRight', shortcut: `${MOD_KEY}+Shift+R` },
  { value: 'justify', label: 'Justify', icon: 'alignJustify', shortcut: `${MOD_KEY}+Shift+J` },
];

export const LINE_SPACINGS = [
  { value: 1, label: 'Single' },
  { value: 1.15, label: '1.15' },
  { value: 1.5, label: '1.5' },
  { value: 2, label: 'Double' },
];

/** Actions offered while the caret is inside a table, in menu order. */
export const TABLE_ACTIONS = [
  { id: 'table-add-row-before', label: 'Insert row above', icon: 'arrowUp' },
  { id: 'table-add-row-after', label: 'Insert row below', icon: 'arrowDown' },
  { id: 'table-add-column-before', label: 'Insert column left', icon: 'back' },
  { id: 'table-add-column-after', label: 'Insert column right', icon: 'arrowRight' },
  { separator: true },
  { id: 'table-delete-row', label: 'Delete row', icon: 'rows' },
  { id: 'table-delete-column', label: 'Delete column', icon: 'cols' },
  { separator: true },
  { id: 'table-merge-cells', label: 'Merge cells', icon: 'merge' },
  { id: 'table-split-cell', label: 'Split cell', icon: 'split' },
  { id: 'table-remove-borders', label: 'Remove borders', icon: 'grid' },
  { separator: true },
  { id: 'table-delete', label: 'Delete table', icon: 'trash', danger: true },
];

import { FALLBACK_SIZES, stepFontSize } from '../lib/fontsize.js';
export { FALLBACK_SIZES, stepFontSize };

/** Alignment reported by the controller, normalized to our four values. */
export function normalizeAlignment(value) {
  const v = typeof value === 'string' ? value.toLowerCase() : '';
  if (v === 'both' || v === 'justified' || v === 'justify') return 'justify';
  if (v === 'center' || v === 'right' || v === 'left') return v;
  if (v === 'start') return 'left';
  if (v === 'end') return 'right';
  return 'left';
}

/** Style names come from the DOCX as authored ("heading 1"); show them in title case. */
export function styleLabel(name) {
  return String(name || '').replace(/(^|\s)([a-z])/g, (m, sp, ch) => sp + ch.toUpperCase());
}

/** Font size reported by the controller ("12", 12, "12pt") -> "12". */
export function normalizeFontSize(value) {
  if (value == null || value === '') return '';
  const n = Number.parseFloat(String(value));
  if (!Number.isFinite(n)) return '';
  return String(Math.round(n * 10) / 10);
}

/**
 * Whether a control should be interactive for a given command state. Inline
 * formats can report `range-selection-required` at a collapsed caret; the
 * engine still accepts the pick as a pending mark for the next typed text, so
 * the button stays usable rather than flickering as the caret moves.
 */
export function isUsable(state, { editing = true } = {}) {
  if (!state || !editing) return false;
  if (state.enabled) return true;
  return state.reason === 'range-selection-required';
}

/** Commands that never change document content (view state only). */
const NON_MUTATING = new Set(['undo', 'redo', 'zoom', 'zoom-fit-width', 'document-mode', 'measurement-unit', 'ruler', 'formatting-marks', 'copy-format']);

/** Whether a command execution result reports a change that landed. */
export function didMutate(id, result) {
  if (NON_MUTATING.has(id)) return false;
  if (result === false || result == null) return false;
  if (typeof result === 'object' && result.success === false) return false;
  return true;
}

/** App commands whose refusal the user should hear about; the engine's own formats fall back to pending marks instead. */
const REPORTED = new Set(['all-caps', 'superscript', 'subscript']);

export function createToolbar({ onLink, onImage, onTable, onSpacing = null, onListOptions = null, onTableExtras = null, imageAtCaret = null, onImageOptions = null, focusEditor = () => {}, onMutate = () => {}, onError = () => {}, readColorSelection = null, applyColor = null, onColorError = () => {} } = {}) {
  let ui = null;
  let unsubs = [];
  let editing = true;
  let colorRequest = 0;
  const renderers = [];

  /**
   * Run a command. Edits made through the Document API do not raise the
   * engine's editor-update event the way typing does, so a successful
   * mutating command reports through `onMutate` for dirty tracking.
   */
  const exec = async (id, payload, { refocus = true } = {}) => {
    if (!ui) return false;
    const handle = ui.commands.get(id);
    let result;
    try {
      result = await handle.executeAsync(payload);
    } catch (e) {
      // A command that threw changed nothing: say so, and let the selects show the document's own values again.
      console.error(e);
      onError(e?.message || 'Could not do that');
      for (const render of renderers) render();
      if (refocus) focusEditor();
      return false;
    }
    if (didMutate(id, result)) onMutate(id);
    else if (REPORTED.has(id) && result?.success === false && result.failure?.message) onError(result.failure.message);
    if (refocus) focusEditor();
    return result;
  };

  // A palette (especially its custom input) takes focus from the document.
  // Keep the settled range/caret from before it opens. Range writes use an
  // explicit target: restoring the host selection does not synchronously
  // refresh the command controller's cached selection.
  const openPalette = async (anchor, id, colors, current, label, noneLabel) => {
    // The press that just closed this palette must not reopen it once the selection read below resolves.
    if (clickClosedMenu(anchor)) return;
    const controller = ui;
    const request = ++colorRequest;
    const stillCurrent = () => ui === controller && request === colorRequest && editing;
    try {
      let snapshot = readColorSelection ? readColorSelection() : controller?.selection.getSnapshot();
      if (snapshot?.then) snapshot = await snapshot;
      if (!snapshot || !stillCurrent()) return;
      if (snapshot.status !== 'ready') throw new Error('The text selection is still updating. Try again.');
      openColorMenu({
        anchor, colors, current, label, noneLabel,
        onPick: async (hex) => {
          if (!stillCurrent()) return;
          // A late write must not take focus from a newer click, selection,
          // or popup. Document changes still need saving when it completes.
          let interacted = false;
          const onInteraction = () => { interacted = true; };
          for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, onInteraction, true);
          try {
            let result;
            if (applyColor) {
              result = await applyColor(id, hex, snapshot);
              if (ui === controller && didMutate(id, result)) onMutate(id);
              if (stillCurrent() && !interacted && !document.querySelector('.modal-root:not(.closing), [role="menu"]')) {
                // This restore is presentation only; it cannot change which
                // text receives the color, even if the UI cache is delayed.
                if (snapshot.empty) focusEditor();
                else {
                  const restored = controller.selection.restore(snapshot);
                  if (restored?.ok === true) focusEditor();
                }
              }
            } else {
              if (snapshot.selectionTarget || snapshot.target) {
                const restored = await controller.selection.restore(snapshot);
                if (!stillCurrent()) return;
                if (restored?.ok !== true) throw new Error('Could not restore the text selection. Select the text and try again.');
              }
              result = await controller.commands.get(id).executeAsync(hex);
              if (ui === controller && didMutate(id, result)) onMutate(id);
              if (stillCurrent() && !interacted && !document.querySelector('.modal-root:not(.closing), [role="menu"]')) focusEditor();
            }
            if (stillCurrent() && (result === false || result == null || (result.success === false && result.failure?.code !== 'NO_OP'))) {
              throw new Error('The color was not applied. Try again.');
            }
          } catch (error) { if (stillCurrent()) onColorError(error); }
          finally { for (const type of ['pointerdown', 'keydown']) document.removeEventListener(type, onInteraction, true); }
        },
      });
    } catch (error) { if (stillCurrent()) onColorError(error); }
  };

  /* ---------- Builders ---------- */

  const button = ({ cmd, label, ic, toggle = false, shortcut = null, onClick = null, size = 18 }) => el('button.tb-btn', {
    type: 'button',
    'aria-label': label,
    title: shortcut ? `${label} (${shortcut})` : label,
    'aria-pressed': toggle ? 'false' : null,
    dataset: { cmd },
    html: icon(ic, size, 1.9),
    onclick: (e) => (onClick ? onClick(e.currentTarget) : exec(cmd)),
  });

  const select = ({ label, cls = '', onChange }) => {
    // On Windows and in Firefox, Up and Down on a closed select pick the next option at once: the pick applies,
    // but the keyboard stays on the select to keep stepping; Enter or Escape hands it back to the document.
    // The flag lives from an arrow press to the pick it leads to; an arrow that picked nothing (the last option,
    // a dismissed native list) must not keep a later mouse pick from handing the keyboard back.
    let keyboardPick = false;
    return el(`select.tb-select${cls ? `.${cls}` : ''}`, {
      'aria-label': label, title: label,
      onkeydown: (e) => {
        if (['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) keyboardPick = true;
        if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); keyboardPick = false; focusEditor(); }
      },
      onpointerdown: () => { keyboardPick = false; },
      onblur: () => { keyboardPick = false; },
      onchange: (e) => { const refocus = !keyboardPick; keyboardPick = false; onChange(e.target.value, { refocus }); },
    });
  };

  // Each group after the first draws its own dividing line on its left (see
  // the stylesheet), so a row that wraps never starts or ends with one.
  const group = (...kids) => el('div.tb-group', {}, ...kids);
  const caret = () => el('span.tb-caret', { 'aria-hidden': 'true', html: icon('chevD', 12, 2.2) });

  /* ---------- Controls ---------- */

  const undoBtn = button({ cmd: 'undo', label: 'Undo', ic: 'undo', shortcut: `${MOD_KEY}+Z` });
  const redoBtn = button({ cmd: 'redo', label: 'Redo', ic: 'redo', shortcut: `${MOD_KEY}+Shift+Z` });

  const styleSelect = select({ label: 'Paragraph style', cls: 'tb-style', onChange: (v, options) => exec('linked-style', v, options) });
  const fontSelect = select({ label: 'Font', cls: 'tb-font', onChange: (v, options) => exec('font-family', v, options) });
  const sizeSelect = select({ label: 'Font size', cls: 'tb-size', onChange: (v, options) => exec('font-size', v, options) });

  const boldBtn = button({ cmd: 'bold', label: 'Bold', ic: 'bold', toggle: true, shortcut: `${MOD_KEY}+B` });
  const italicBtn = button({ cmd: 'italic', label: 'Italic', ic: 'italic', toggle: true, shortcut: `${MOD_KEY}+I` });
  const underlineBtn = button({ cmd: 'underline', label: 'Underline', ic: 'underline', toggle: true, shortcut: `${MOD_KEY}+U` });
  const strikeBtn = button({ cmd: 'strikethrough', label: 'Strikethrough', ic: 'strike', toggle: true, shortcut: `${MOD_KEY}+Shift+X` });
  const supBtn = button({ cmd: 'superscript', label: 'Superscript', ic: 'sup', toggle: true, shortcut: `${MOD_KEY}+.` });
  const subBtn = button({ cmd: 'subscript', label: 'Subscript', ic: 'sub', toggle: true, shortcut: `${MOD_KEY}+,` });

  let textColor = null;
  let highlightColor = null;
  const colorBtn = button({
    cmd: 'text-color', label: 'Text color', ic: 'textColor',
    onClick: (b) => openPalette(b, 'text-color', TEXT_COLORS, textColor, 'Text color', 'Automatic'),
  });
  colorBtn.classList.add('tb-color');
  colorBtn.setAttribute('aria-haspopup', 'menu');
  colorBtn.append(el('span.tb-color-bar', { 'aria-hidden': 'true' }));
  const highlightBtn = button({
    cmd: 'highlight-color', label: 'Highlight color', ic: 'highlight',
    onClick: (b) => openPalette(b, 'highlight-color', HIGHLIGHT_COLORS, highlightColor, 'Highlight color', 'No highlight'),
  });
  highlightBtn.classList.add('tb-color');
  highlightBtn.setAttribute('aria-haspopup', 'menu');
  highlightBtn.append(el('span.tb-color-bar', { 'aria-hidden': 'true' }));
  for (const control of [colorBtn, highlightBtn]) {
    control.addEventListener('mousedown', (event) => {
      if (event.button === 0) event.preventDefault();
    });
  }

  let alignment = 'left';
  const alignBtn = button({
    cmd: 'text-align', label: 'Alignment', ic: 'alignLeft',
    onClick: (b) => openMenu({
      anchor: b, label: 'Alignment', minWidth: 210,
      items: ALIGNMENTS.map((a) => ({ label: a.label, icon: a.icon, shortcut: a.shortcut, radio: true, checked: alignment === a.value, onSelect: () => exec('text-align', a.value) })),
    }),
  });
  alignBtn.setAttribute('aria-haspopup', 'menu');
  alignBtn.append(caret());

  const spacingBtn = button({
    cmd: 'line-height', label: 'Line spacing', ic: 'rows',
    onClick: (b) => openMenu({
      anchor: b, label: 'Line spacing', minWidth: 190,
      items: [
        ...LINE_SPACINGS.map((s) => ({ label: s.label, onSelect: () => exec('line-height', s.value) })),
        onSpacing && { separator: true },
        onSpacing && { label: 'Custom spacing', icon: 'settings', onSelect: () => onSpacing() },
      ],
    }),
  });
  spacingBtn.setAttribute('aria-haspopup', 'menu');
  spacingBtn.append(caret());

  const bulletsBtn = button({ cmd: 'bullet-list', label: 'Bulleted list', ic: 'bullets', toggle: true, shortcut: `${MOD_KEY}+Shift+8` });
  const numbersBtn = button({ cmd: 'numbered-list', label: 'Numbered list', ic: 'numbers', toggle: true, shortcut: `${MOD_KEY}+Shift+7` });
  // Bullet glyph, number format, restart and continue: a narrow caret next to the list toggles.
  const listMenuBtn = button({ cmd: 'list-options', label: 'List options', ic: 'chevD', size: 14, onClick: (b) => onListOptions?.(b) });
  listMenuBtn.classList.add('tb-narrow');
  listMenuBtn.setAttribute('aria-haspopup', 'menu');
  listMenuBtn.hidden = !onListOptions;
  const outdentBtn = button({ cmd: 'indent-decrease', label: 'Decrease indent', ic: 'outdent' });
  const indentBtn = button({ cmd: 'indent-increase', label: 'Increase indent', ic: 'indent' });

  const linkBtn = button({ cmd: 'link', label: 'Insert link', ic: 'link', toggle: true, shortcut: `${MOD_KEY}+K`, onClick: () => onLink?.() });
  const imageBtn = button({ cmd: 'image', label: 'Insert image', ic: 'image', onClick: (b) => onImage?.(b) });
  const tableBtn = button({ cmd: 'table-insert', label: 'Insert table', ic: 'table', onClick: () => onTable?.() });
  // Shown only while the caret is in a table; the same menu opens on right-click there.
  const tableMenuBtn = button({ cmd: 'table-options', label: 'Table options', ic: 'grid', onClick: (b) => openTableMenu({ anchor: b }) });
  tableMenuBtn.setAttribute('aria-haspopup', 'menu');
  tableMenuBtn.append(caret());
  tableMenuBtn.hidden = true;
  // Shown while the caret touches a picture: the menu a right-click on the picture opens, reachable from the keyboard.
  const imageMenuBtn = button({ cmd: 'image-options', label: 'Image options', ic: 'image', onClick: (b) => { const image = imageAtCaret?.(); if (image) onImageOptions?.(image, b); } });
  imageMenuBtn.setAttribute('aria-haspopup', 'menu');
  imageMenuBtn.append(caret());
  imageMenuBtn.hidden = true;
  const clearBtn = button({ cmd: 'clear-formatting', label: 'Clear formatting', ic: 'clearFormat', shortcut: `${MOD_KEY}+\\` });
  // Copies the selection's formatting onto the next selection; click twice to keep it on.
  const paintBtn = button({ cmd: 'copy-format', label: 'Paint format', ic: 'paint', toggle: true });
  paintBtn.title = 'Paint format: copy this formatting onto the next selection (click twice to keep painting)';

  const root = el('div.toolbar', { role: 'toolbar', 'aria-label': 'Formatting' },
    el('div.tb-rows', {},
      group(undoBtn, redoBtn),
      group(styleSelect),
      group(fontSelect, sizeSelect),
      group(boldBtn, italicBtn, underlineBtn, strikeBtn, supBtn, subBtn, colorBtn, highlightBtn),
      group(alignBtn, spacingBtn),
      group(bulletsBtn, numbersBtn, listMenuBtn, outdentBtn, indentBtn),
      group(linkBtn, imageBtn, tableBtn, tableMenuBtn, imageMenuBtn, paintBtn, clearBtn)));

  const allButtons = [...root.querySelectorAll('button')];
  const allSelects = [styleSelect, fontSelect, sizeSelect];
  const usableControls = () => [...root.querySelectorAll('button:not([disabled]), select:not([disabled])')].filter((control) => !control.closest('[hidden]'));

  // One tab stop, as a toolbar is: Tab lands on the control last used (or
  // the first usable one) and the arrows move along from there.
  let tabStop = null;
  let tabStopChosen = false; // by the user, through focus; until then the first usable control is the stop
  function syncTabStops() {
    const controls = usableControls();
    if (!tabStopChosen || !controls.includes(tabStop)) tabStop = controls[0] || null;
    for (const control of [...allButtons, ...allSelects]) control.tabIndex = control === tabStop ? 0 : -1;
  }
  root.addEventListener('focusin', (e) => {
    const control = e.target.closest?.('button, select');
    if (control && root.contains(control)) { tabStop = control; tabStopChosen = true; syncTabStops(); }
  });
  if (typeof MutationObserver === 'function') {
    new MutationObserver(syncTabStops).observe(root, { subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
  }

  // Roving focus: arrows move between controls, Home/End jump to the edges.
  root.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    // A select keeps Up, Down, Home, and End for its own options; Left and
    // Right move along the toolbar, as on a button (on Windows they would
    // otherwise pick the neighbouring style, font, or size).
    if (document.activeElement?.tagName === 'SELECT' && !['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    const controls = usableControls();
    const at = controls.indexOf(document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    let next = at;
    if (e.key === 'ArrowRight') next = (at + 1) % controls.length;
    if (e.key === 'ArrowLeft') next = (at - 1 + controls.length) % controls.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = controls.length - 1;
    controls[next].focus();
  });

  const setDisabledAll = (disabled) => {
    for (const b of allButtons) b.disabled = disabled;
    for (const s of allSelects) s.disabled = disabled;
    syncTabStops();
  };
  setDisabledAll(true);

  /* ---------- Table menu ---------- */

  let pointerTableMenu = null;
  function openTableMenu({ anchor = null, x = null, y = null } = {}) {
    if (!ui || !editing || !ui.tables?.isInTable?.()) return null;
    const ctx = ui.tables.getContext();
    const actions = TABLE_ACTIONS.map((a) => (a.separator ? a : {
      label: a.label, icon: a.icon, danger: !!a.danger,
      disabled: !ui.commands.get(a.id).getState()?.enabled,
      onSelect: () => exec(a.id),
    }));
    // A right-click opens at the pointer with no anchor: the toolbar is not
    // the control that expanded, and must not be marked as one.
    const atPointer = x != null && y != null;
    const pos = { anchor: atPointer ? null : anchor || root, x, y };
    // Appearance items (background, borders, widths) come from the host,
    // which has the Document API; they sit before the delete action.
    const extras = onTableExtras?.(ctx, pos) || [];
    const deleteAt = actions.findIndex((a) => a.danger);
    if (extras.length) actions.splice(deleteAt < 0 ? actions.length : deleteAt - 1, 0, { separator: true }, ...extras);
    const items = [ctx.rows && ctx.columns ? { header: `Table, ${ctx.rows} × ${ctx.columns}` } : { header: 'Table' }, ...actions];
    const opened = openMenu({ ...pos, items, label: 'Table', minWidth: 220 });
    if (atPointer) pointerTableMenu = opened;
    return opened;
  }

  /* ---------- Option lists ---------- */

  const fillSelect = (sel, options, current, { placeholder = '' } = {}) => {
    const wanted = options.map((o) => `${o.value}\u0000${o.label}`).join('\u0001');
    if (sel.dataset.options !== wanted) {
      sel.dataset.options = wanted;
      sel.replaceChildren(...options.map((o) => el('option', { value: o.value, style: o.previewFamily ? { fontFamily: o.previewFamily } : null }, o.label)));
    }
    const has = options.some((o) => String(o.value) === String(current));
    if (!has) {
      let ph = sel.querySelector('option[data-ph]');
      if (!ph) { ph = el('option', { value: '', dataset: { ph: '1' }, disabled: true }); sel.prepend(ph); }
      ph.textContent = current ? String(current) : placeholder;
      sel.value = '';
    } else {
      sel.querySelector('option[data-ph]')?.remove();
      sel.value = String(current);
    }
  };

  /* ---------- Binding ---------- */

  const applyState = (btn, state, { toggle = false } = {}) => {
    if (!state?.supported) { btn.disabled = true; btn.hidden = true; return; }
    btn.hidden = false;
    btn.disabled = !isUsable(state, { editing });
    if (toggle) btn.setAttribute('aria-pressed', String(!!state.active));
  };

  const TOGGLES = [[() => boldBtn, 'bold'], [() => italicBtn, 'italic'], [() => underlineBtn, 'underline'], [() => strikeBtn, 'strikethrough'],
    [() => supBtn, 'superscript'], [() => subBtn, 'subscript'],
    [() => bulletsBtn, 'bullet-list'], [() => numbersBtn, 'numbered-list'], [() => linkBtn, 'link'], [() => paintBtn, 'copy-format']];
  const PLAINS = [[() => undoBtn, 'undo'], [() => redoBtn, 'redo'], [() => outdentBtn, 'indent-decrease'], [() => indentBtn, 'indent-increase'],
    [() => imageBtn, 'image'], [() => tableBtn, 'table-insert'], [() => clearBtn, 'clear-formatting'], [() => spacingBtn, 'line-height']];


  function bind(controller) {
    unbind();
    ui = controller;
    renderers.length = 0;

    for (const [get, id] of TOGGLES) {
      const h = ui.commands.get(id);
      const render = () => applyState(get(), h.getState(), { toggle: true });
      renderers.push(render);
      unsubs.push(h.observe(render));
    }
    for (const [get, id] of PLAINS) {
      const h = ui.commands.get(id);
      const render = () => applyState(get(), h.getState());
      renderers.push(render);
      unsubs.push(h.observe(render));
    }

    const colorH = ui.commands.get('text-color');
    const renderColor = () => {
      const s = colorH.getState();
      applyState(colorBtn, s);
      textColor = normalizeHex(s?.value);
      colorBtn.querySelector('.tb-color-bar').style.background = textColor || 'currentColor';
    };
    renderers.push(renderColor);
    unsubs.push(colorH.observe(renderColor));

    const hlH = ui.commands.get('highlight-color');
    const renderHl = () => {
      const s = hlH.getState();
      applyState(highlightBtn, s);
      highlightColor = normalizeHex(s?.value);
      highlightBtn.querySelector('.tb-color-bar').style.background = highlightColor || 'transparent';
    };
    renderers.push(renderHl);
    unsubs.push(hlH.observe(renderHl));

    const alignH = ui.commands.get('text-align');
    const renderAlign = () => {
      const s = alignH.getState();
      applyState(alignBtn, s);
      alignment = normalizeAlignment(s?.value);
      const a = ALIGNMENTS.find((x) => x.value === alignment) || ALIGNMENTS[0];
      alignBtn.querySelector('svg')?.replaceWith(iconEl(a.icon, 18, 1.9));
    };
    renderers.push(renderAlign);
    unsubs.push(alignH.observe(renderAlign));

    const fontH = ui.commands.get('font-family');
    const sizeH = ui.commands.get('font-size');
    const renderFonts = () => {
      const snap = ui.fonts.getSnapshot();
      const fam = fontH.getState();
      const size = sizeH.getState();
      const families = snap.options?.length ? snap.options : [];
      fillSelect(fontSelect, families, typeof fam.value === 'string' ? fam.value : '', { placeholder: 'Font' });
      const sizes = snap.sizeOptions?.length ? snap.sizeOptions : FALLBACK_SIZES.map((v) => ({ value: v, label: v }));
      fillSelect(sizeSelect, sizes, normalizeFontSize(size.value), { placeholder: 'Size' });
      fontSelect.disabled = !isUsable(fam, { editing }) || !families.length;
      sizeSelect.disabled = !isUsable(size, { editing });
    };
    renderers.push(renderFonts);
    unsubs.push(fontH.observe(renderFonts), sizeH.observe(renderFonts), ui.fonts.observe(renderFonts));

    const styleH = ui.commands.get('linked-style');
    const renderStyles = () => {
      const snap = ui.styles.getSnapshot();
      const gallery = (snap.quickGallery || []).map((s) => ({ value: s.id, label: styleLabel(s.name || s.id) }));
      const current = snap.mixedSelection ? '' : (snap.activeParagraphStyleId || '');
      fillSelect(styleSelect, gallery, current, { placeholder: snap.mixedSelection ? 'Mixed' : 'Style' });
      styleSelect.disabled = !editing || !gallery.length || !styleH.getState().supported;
    };
    renderers.push(renderStyles);
    unsubs.push(ui.styles.observe(renderStyles), styleH.observe(renderStyles));

    const listH = ui.commands.get('bullet-list');
    const renderListMenu = () => { const st = listH.getState(); listMenuBtn.hidden = !onListOptions || !st?.supported; listMenuBtn.disabled = !isUsable(st, { editing }); };
    renderers.push(renderListMenu);
    unsubs.push(listH.observe(renderListMenu));

    const renderTable = () => {
      const inTable = editing && !!ui.tables?.isInTable?.();
      tableMenuBtn.hidden = !inTable;
      tableMenuBtn.disabled = !inTable;
    };
    renderers.push(renderTable);
    if (ui.selection?.observe) unsubs.push(ui.selection.observe(renderTable));

    const renderImage = () => {
      let image = null;
      // A look at the painted page; if it cannot be read, the rest of the toolbar must still follow the selection.
      try { image = editing && imageAtCaret && onImageOptions ? imageAtCaret() : null; } catch (e) { console.error(e); }
      imageMenuBtn.hidden = !image;
      imageMenuBtn.disabled = !image;
    };
    renderers.push(renderImage);
    if (ui.selection?.observe) unsubs.push(ui.selection.observe(renderImage));

    const renderMode = () => {
      const d = ui.document.getSnapshot();
      editing = d.mode !== 'viewing' && d.ready !== false;
      root.classList.toggle('is-readonly', !editing);
      for (const r of renderers) r();
      syncTabStops();
    };
    unsubs.push(ui.document.observe(renderMode));
    renderMode();
  }

  function unbind() {
    colorRequest++;
    if (root.contains(menuAnchor())) closeMenu();
    pointerTableMenu?.close();
    pointerTableMenu = null;
    for (const u of unsubs) { try { u(); } catch { /* already gone */ } }
    unsubs = [];
    ui = null;
    setDisabledAll(true);
  }

  return { el: root, bind, unbind, exec, openTableMenu, get ui() { return ui; } };
}

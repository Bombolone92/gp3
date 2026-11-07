/**
 * Effect > SVG Filters > Apply SVG Filter (a list of the built-in and
 * imported filters with a live preview and the filter's SVG code, which
 * can be edited into a custom filter) and Import SVG Filter (adds the
 * <filter> definitions of an SVG file to the document).
 */
import { h } from '../../lib/dom.js';
import { icon } from '../../ui/icons.js';
import { openDialog } from '../../ui/dialogs/dialog.js';
import { normalizeEffect } from '../paint/effects-model.js';
import { pickWithInput } from '../files/service.js';
import { allFilters, importFilters, compileFilter, docFilters } from './svg-filters.js';
import { filtersFromSvg } from './svg-filter-render.js';
import { EffectPreview } from './preview.js';
import { effectSession } from './session.js';

let uid = 0;

async function readSvgFile() {
  const [file] = await pickWithInput('.svg,image/svg+xml');
  return file ? file.text() : null;
}

/** Effect > SVG Filters > Apply SVG Filter. `params` / `edit` as for the other effect dialogs. */
export async function openSvgFilterDialog(app, { params = null, edit = null, select = null } = {}) {
  const ses = effectSession(app, 'svgFilter', { edit });
  if (!ses) return false;
  const id = `pxf-${++uid}`;
  // Filters imported while the dialog is open join the document on OK.
  const pending = [];
  const entries = () => {
    const list = allFilters(ses.doc).concat(pending);
    return list;
  };
  const start = ses.existing || params || app.lastEffects?.svgFilter || null;
  let current = null;
  if (select) current = entries().find((x) => x.id === select) || null;
  if (!current && start?.markup) current = entries().find((x) => x.markup === start.markup) || { id: 'custom', name: start.name || 'Custom', markup: start.markup, custom: true };
  if (!current) current = entries()[0];
  let custom = current.custom ? current : null;

  const record = () => (current && compileFilter(current.markup) ? normalizeEffect({ type: 'svgFilter', name: current.name, markup: current.markup }) : null);
  const preview = new EffectPreview({ source: () => ses.view(record()), label: 'Filter preview' });

  const list = h('ul.pxf-list', { role: 'listbox', tabindex: '0', 'aria-label': 'SVG filters' });
  const code = h('textarea.pxf-code', { id: `${id}-code`, rows: 7, spellcheck: false, autocomplete: 'off', 'aria-describedby': `${id}-codehelp` });
  const codeNote = h('p.fx-note', { id: `${id}-codehelp` }, 'Edit the code to make a custom filter. Lengths are in points.');
  const removeBtn = h('button.btn', { type: 'button', onclick: () => removeImported() }, 'Delete');
  const importBtn = h('button.btn', { type: 'button', onclick: () => importHere() }, icon('upload', 14), 'Import...');

  const options = () => {
    const out = entries();
    if (custom) out.push(custom);
    return out;
  };

  function renderList() {
    list.replaceChildren();
    let group = null;
    options().forEach((f, i) => {
      const g = f.builtin ? 'Built-in' : f.custom ? 'Custom' : 'In this document';
      if (g !== group) {
        group = g;
        list.append(h('li.pxf-group', { role: 'presentation' }, g));
      }
      const on = f === current || (f.id === current.id && f.markup === current.markup);
      list.append(h('li.pxf-item', { id: `${id}-o${i}`, role: 'option', 'aria-selected': String(on), dataset: { index: String(i) }, onclick: () => choose(f) }, f.name));
    });
    const idx = options().indexOf(current);
    if (idx >= 0) {
      list.setAttribute('aria-activedescendant', `${id}-o${idx}`);
      list.querySelector(`#${id}-o${idx}`)?.scrollIntoView?.({ block: 'nearest' });
    }
    removeBtn.disabled = Boolean(current.builtin || current.custom);
  }

  function choose(f, { keepCode = false } = {}) {
    current = f;
    if (!keepCode) {
      code.value = f.markup;
      code.removeAttribute('aria-invalid');
    }
    renderList();
    update();
  }

  function update() {
    ses.apply(record());
    preview.redraw();
  }

  code.addEventListener('input', () => {
    const markup = code.value.trim();
    if (!compileFilter(markup)?.prims?.length) {
      code.setAttribute('aria-invalid', 'true');
      return;
    }
    code.removeAttribute('aria-invalid');
    if (markup === current.markup) return;
    custom = { id: 'custom', name: 'Custom', markup, custom: true };
    choose(custom, { keepCode: true });
  });

  list.addEventListener('keydown', (e) => {
    const opts = options();
    const i = opts.indexOf(current);
    let j = i;
    if (e.key === 'ArrowDown') j = Math.min(opts.length - 1, i + 1);
    else if (e.key === 'ArrowUp') j = Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = opts.length - 1;
    else return;
    e.preventDefault();
    if (j !== i) choose(opts[j]);
  });

  async function importHere() {
    const text = await readSvgFile().catch(() => null);
    if (text == null) return;
    const found = filtersFromSvg(text).filter((f) => !entries().some((x) => x.markup === f.markup));
    if (!found.length) {
      app.notify('No new <filter> definitions were found in that file.');
      return;
    }
    for (const f of found) pending.push({ id: `pending:${pending.length}`, name: f.name, markup: f.markup, text });
    choose(pending[pending.length - found.length]);
  }

  function removeImported() {
    if (current.builtin || current.custom) return;
    const i = pending.indexOf(current);
    if (i >= 0) pending.splice(i, 1);
    else ses.doc.updateRoot({ svgFilters: docFilters(ses.doc).filter((x) => x.id !== current.id) });
    choose(entries()[0]);
  }

  code.value = current.markup;
  renderList();
  const body = h(
    'div.pxf',
    h('div.pxf-side', list, h('div.pxf-actions', importBtn, removeBtn)),
    h('div.pxf-main', h('div.pxf-view', preview.el), h('details.pxf-code-box', h('summary', 'SVG Code'), h('label.fx-label', { for: code.id }, 'Filter markup'), code, codeNote)),
  );
  const previewBox = h('input', { type: 'checkbox', id: `${id}-pv`, checked: ses.preview });
  previewBox.addEventListener('change', () => (ses.preview = previewBox.checked));
  let ok = false;
  try {
    ok = await openDialog({
      title: 'Apply SVG Filter',
      className: 'pxf-dialog',
      body,
      buttons: [
        { label: 'Cancel', value: false },
        { label: 'OK', primary: true, value: true },
      ],
      initialFocus: () => list,
      onOpen: ({ footer }) => {
        footer.prepend(h('label.fx-preview-toggle', { for: previewBox.id }, previewBox, 'Preview on canvas'));
        update();
        preview.fit();
      },
    });
  } catch (err) {
    preview.dispose();
    ses.cancel();
    throw err;
  }
  preview.dispose();
  if (!ok) {
    ses.cancel();
    return false;
  }
  const texts = [...new Set(pending.map((p) => p.text))];
  for (const t of texts) importFilters(ses.doc, t);
  const fx = record();
  ses.commit(fx);
  return Boolean(fx);
}

/** Effect > SVG Filters > Import SVG Filter. */
export async function importSvgFilterCommand(app) {
  const ed = app.editor;
  if (!ed) return false;
  let text;
  try {
    text = await readSvgFile();
  } catch {
    text = null;
  }
  if (text == null) return false;
  return importSvgFilterText(app, text);
}

/** Add the filters of SVG text to the active document, then offer them for the selection. */
export function importSvgFilterText(app, text) {
  const ed = app.editor;
  let added = [];
  ed.doc.transact('Import SVG Filters', () => {
    added = importFilters(ed.doc, text);
  });
  if (!added.length) {
    app.notify(filtersFromSvg(text).length ? 'Those filters are already in this document.' : 'No <filter> definitions were found in that file.');
    return false;
  }
  app.notify(`Imported ${added.length} SVG filter${added.length === 1 ? '' : 's'}.`, { polite: true });
  if (ed.selection.size) openSvgFilterDialog(app, { select: added[0].id });
  return true;
}

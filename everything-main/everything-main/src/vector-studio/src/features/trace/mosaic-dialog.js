/**
 * Object > Create Object Mosaic dialog: the number of tiles or their size,
 * the gap between tiles, the result size (as a length or a percentage),
 * color or grayscale tiles and whether the image is removed, with a live
 * preview on the canvas and a summary of the resulting tiles.
 */
import { h } from '../../lib/dom.js';
import { numberField } from '../../ui/widgets.js';
import { formatLength } from '../../lib/units.js';
import { scaleFactor } from '../../lib/matrix.js';
import { mosaicColors, buildMosaic, mosaicLayout, squareRows, MAX_TILES } from './image-ops.js';
import { selectedImages } from './trace-commands.js';

let uid = 0;

export async function mosaicDialog(app) {
  const ed = app.editor;
  const img = selectedImages(ed)[0];
  if (!img) return null;
  const doc = ed.doc;
  const unit = doc.root.units;
  // Lengths in the dialog are in document units (points) as placed; the image's own units differ by its scale.
  const k = scaleFactor(img.transform || [1, 0, 0, 1, 0, 0]) || 1;
  const W0 = img.width * k;
  const H0 = img.height * k;
  const saved = app.prefs.get('mosaicOptions') || {};
  const st = {
    by: saved.by === 'size' ? 'size' : 'count',
    cols: saved.cols || 20,
    rows: 0,
    tileW: saved.tileW || Math.max(1, W0 / 20),
    tileH: saved.tileH || Math.max(1, W0 / 20),
    gapX: saved.gapX ?? 0,
    gapY: saved.gapY ?? 0,
    width: W0,
    height: H0,
    percent: Boolean(saved.percent),
    gray: Boolean(saved.gray),
    deleteImage: Boolean(saved.deleteImage),
  };
  st.rows = saved.rows || squareRows(st.cols, st.width, st.height, st.gapX, st.gapY);
  const id = `mos-${++uid}`;

  // Result size.
  const wField = numberField({ label: 'Width', value: W0, unit, min: 0.01, onCommit: (v) => ((st.width = v), sync()) });
  const hField = numberField({ label: 'Height', value: H0, unit, min: 0.01, onCommit: (v) => ((st.height = v), sync()) });
  const wPct = numberField({ label: 'Width', kind: 'percent', value: 100, min: 0.1, max: 10000, onCommit: (v) => ((st.width = (W0 * v) / 100), sync()) });
  const hPct = numberField({ label: 'Height', kind: 'percent', value: 100, min: 0.1, max: 10000, onCommit: (v) => ((st.height = (H0 * v) / 100), sync()) });
  const lenRow = h('div.mosaic-pair', wField.el, hField.el);
  const pctRow = h('div.mosaic-pair', wPct.el, hPct.el);
  const pct = h('input', { type: 'checkbox', id: `${id}-pct`, checked: st.percent, onchange: () => ((st.percent = pct.checked), sync()) });
  // Tiles.
  const byName = `${id}-by`;
  const byCount = h('input', { type: 'radio', name: byName, value: 'count', checked: st.by === 'count', onchange: () => ((st.by = 'count'), sync()) });
  const bySize = h('input', { type: 'radio', name: byName, value: 'size', checked: st.by === 'size', onchange: () => ((st.by = 'size'), sync()) });
  const cols = numberField({ label: 'Across', kind: 'number', value: st.cols, min: 1, max: 1000, onCommit: (v) => ((st.cols = Math.round(v)), sync()) });
  const rows = numberField({ label: 'Down', kind: 'number', value: st.rows, min: 1, max: 1000, onCommit: (v) => ((st.rows = Math.round(v)), sync()) });
  const tw = numberField({ label: 'Tile width', value: st.tileW, unit, min: 0.01, onCommit: (v) => ((st.tileW = v), sync()) });
  const th = numberField({ label: 'Tile height', value: st.tileH, unit, min: 0.01, onCommit: (v) => ((st.tileH = v), sync()) });
  const square = h('button.btn.small', { type: 'button', onclick: () => ((st.rows = squareRows(st.cols, st.width, st.height, st.gapX, st.gapY)), sync()) }, 'Square Tiles');
  const gx = numberField({ label: 'Gap X', value: st.gapX, unit, min: 0, onCommit: (v) => ((st.gapX = v), sync()) });
  const gy = numberField({ label: 'Gap Y', value: st.gapY, unit, min: 0, onCommit: (v) => ((st.gapY = v), sync()) });
  const resName = `${id}-res`;
  const color = h('input', { type: 'radio', name: resName, checked: !st.gray, onchange: () => ((st.gray = false), sync()) });
  const gray = h('input', { type: 'radio', name: resName, checked: st.gray, onchange: () => ((st.gray = true), sync()) });
  const del = h('input', { type: 'checkbox', id: `${id}-del`, checked: st.deleteImage, onchange: () => ((st.deleteImage = del.checked), sync()) });
  const prev = h('input', { type: 'checkbox', id: `${id}-prev`, checked: true, onchange: () => preview() });
  const summary = h('p.form-help.mosaic-summary', { role: 'status', 'aria-live': 'polite' });
  const countRow = h('div.mosaic-pair', cols.el, rows.el, square);
  const sizeRow = h('div.mosaic-pair', tw.el, th.el);

  /** Columns and rows for the current settings. */
  const grid = () => {
    if (st.by === 'count') return { cols: st.cols, rows: st.rows };
    return { cols: Math.max(1, Math.floor((st.width + st.gapX) / (st.tileW + st.gapX))), rows: Math.max(1, Math.floor((st.height + st.gapY) / (st.tileH + st.gapY))) };
  };
  const params = () => {
    const g = grid();
    // Image-local units for building.
    return { cols: g.cols, rows: g.rows, width: st.width / k, height: st.height / k, gapX: st.gapX / k, gapY: st.gapY / k, gray: st.gray, deleteImage: st.deleteImage };
  };
  let colorsKey = '';
  let colors = null;
  let tx = null;
  let pending = 0;
  const valid = () => {
    const p = params();
    return p.cols * p.rows <= MAX_TILES && mosaicLayout(p);
  };
  const preview = async () => {
    const ticket = ++pending;
    if (tx) {
      tx.cancel();
      tx = null;
    }
    if (!prev.checked || !valid()) return;
    const p = params();
    const key = `${p.cols}x${p.rows}`;
    if (key !== colorsKey) {
      try {
        colors = await mosaicColors(doc, img.id, p.cols, p.rows);
      } catch (err) {
        summary.textContent = err?.message || 'The image could not be read.';
        return;
      }
      colorsKey = key;
    }
    if (ticket !== pending || !prev.checked) return;
    if (tx) tx.cancel();
    tx = doc.begin('Create Object Mosaic');
    buildMosaic(doc, img.id, colors, { ...p, deleteImage: false });
  };
  const sync = () => {
    wField.set(st.width);
    hField.set(st.height);
    wPct.set((st.width / W0) * 100);
    hPct.set((st.height / H0) * 100);
    lenRow.hidden = st.percent;
    pctRow.hidden = !st.percent;
    countRow.hidden = st.by !== 'count';
    sizeRow.hidden = st.by !== 'size';
    cols.set(st.cols);
    rows.set(st.rows);
    const p = params();
    const lay = mosaicLayout(p);
    const n = p.cols * p.rows;
    if (n > MAX_TILES) summary.textContent = `That makes ${n.toLocaleString()} tiles; the most is ${MAX_TILES.toLocaleString()}.`;
    else if (!lay) summary.textContent = 'The gaps leave no room for tiles.';
    else summary.textContent = `${p.cols} × ${p.rows} = ${n.toLocaleString()} tiles, each ${formatLength(lay.tileW * k, unit)} × ${formatLength(lay.tileH * k, unit)}.`;
    preview();
  };
  const radio = (input, label) => h('label.radio', input, label);
  const body = h(
    'div.form.mosaic-form',
    h('p.form-help', `Image size: ${formatLength(W0, unit)} × ${formatLength(H0, unit)}`),
    h('h3.form-heading', 'Result Size'),
    lenRow,
    pctRow,
    h('div.form-row.check', pct, h('label', { for: `${id}-pct` }, 'Use percentages')),
    h('h3.form-heading', 'Tiles'),
    h('div.radio-group', { role: 'radiogroup', 'aria-label': 'Tiles by' }, radio(byCount, 'Number of tiles'), radio(bySize, 'Tile size')),
    countRow,
    sizeRow,
    h('div.mosaic-pair', gx.el, gy.el),
    h('h3.form-heading', 'Result'),
    h('div.radio-group', { role: 'radiogroup', 'aria-label': 'Tile color' }, radio(color, 'Color'), radio(gray, 'Grayscale')),
    h('div.form-row.check', del, h('label', { for: `${id}-del` }, 'Delete the image')),
    h('div.form-row.check', prev, h('label', { for: `${id}-prev` }, 'Preview')),
    summary,
  );
  sync();
  const ok = await app.dialogs.open({
    title: 'Create Object Mosaic',
    body,
    className: 'mosaic-dialog',
    buttons: [
      { label: 'Cancel', value: false },
      { label: 'OK', primary: true, value: true, validate: () => Boolean(valid()) },
    ],
  });
  pending++;
  if (tx) {
    tx.cancel();
    tx = null;
  }
  if (!ok) return null;
  app.prefs.set('mosaicOptions', { by: st.by, cols: st.cols, rows: st.rows, tileW: st.tileW, tileH: st.tileH, gapX: st.gapX, gapY: st.gapY, percent: st.percent, gray: st.gray, deleteImage: st.deleteImage });
  const p = params();
  try {
    if (colorsKey !== `${p.cols}x${p.rows}`) colors = await mosaicColors(doc, img.id, p.cols, p.rows);
  } catch (err) {
    app.notify(err?.message || 'The image could not be read.', { error: true });
    return null;
  }
  let g = null;
  doc.transact('Create Object Mosaic', () => {
    g = buildMosaic(doc, img.id, colors, p);
  });
  if (g) ed.select([g.id]);
  return g;
}

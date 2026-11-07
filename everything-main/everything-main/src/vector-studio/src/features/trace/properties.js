/**
 * Properties panel sections for images and trace objects:
 *   Image      pixel size and resolution, Trace Image with a preset list,
 *              Crop Image, Object Mosaic, Embed (linked images)
 *   Trace      preset and view of a trace object, Expand and Release
 *   Cropping   the crop box size and resolution with Apply and Cancel,
 *              while cropping
 */
import { h } from '../../lib/dom.js';
import { icon } from '../../ui/icons.js';
import { numberField } from '../../ui/widgets.js';
import { PropertiesPanel } from '../../ui/panels/properties.js';
import { PRESETS, findPreset, presetOptions } from './presets.js';
import { VIEWS, updateTrace, isTrace } from './trace-live.js';
import { selectedTraces, selectedImages, traceSettings, savedPresets, traceSelection } from './trace-commands.js';
import { headerSize, effectivePpi } from './image-ops.js';
import { resolutionChoices } from './crop.js';

let uid = 0;

function presetOptionsList(app, selected, { custom = false } = {}) {
  const saved = savedPresets(app);
  return [
    custom ? h('option', { value: '', selected: !selected }, 'Custom') : null,
    h('optgroup', { label: 'Built-in' }, PRESETS.map((p) => h('option', { value: p.id, selected: p.id === selected }, p.label))),
    saved.length ? h('optgroup', { label: 'Saved' }, saved.map((p) => h('option', { value: p.id, selected: p.id === selected }, p.label))) : null,
  ];
}

function imageSection(app) {
  const info = h('p.trace-props-info');
  const sid = `tp-${++uid}`;
  const presetSel = h('select.select', { id: sid, 'aria-label': 'Trace preset' });
  const traceBtn = h('button.btn.primary', { type: 'button', onclick: () => traceSelection(app, presetSel.value ? { preset: presetSel.value, options: presetOptions(presetSel.value, savedPresets(app)) } : {}) }, icon('trace-image', 14), 'Trace Image');
  const cropBtn = h('button.btn', { type: 'button', onclick: () => app.commands.run('object.cropImage') }, icon('image-crop', 14), 'Crop Image');
  const mosaicBtn = h('button.btn', { type: 'button', onclick: () => app.commands.run('object.mosaic') }, icon('image-mosaic', 14), 'Mosaic');
  const embedBtn = h('button.btn', { type: 'button', onclick: () => app.commands.run('image.embed') }, icon('image-embed', 14), 'Embed');
  const el = h('div.trace-props', info, h('div.trace-props-trace', presetSel, traceBtn), h('div.quick-actions', cropBtn, mosaicBtn, embedBtn));
  let key = '';
  return {
    el,
    refresh() {
      const ed = app.editor;
      const img = selectedImages(ed)[0];
      if (!img) return;
      const nat = headerSize(ed.doc, img.asset);
      const ppi = effectivePpi(img, nat);
      const linked = Boolean(ed.doc.assets.get(img.asset)?.external);
      info.textContent = [nat ? `${nat.width} × ${nat.height} px` : null, ppi ? `${Math.round(ppi)} ppi` : null, linked ? 'Linked' : 'Embedded'].filter(Boolean).join(' · ');
      const s = traceSettings(app);
      const k = `${s.preset}:${savedPresets(app).length}`;
      if (k !== key) {
        key = k;
        presetSel.replaceChildren(...presetOptionsList(app, s.preset, { custom: !findPreset(s.preset, savedPresets(app)) }));
      }
      embedBtn.hidden = !linked;
      cropBtn.disabled = !app.commands.isEnabled('object.cropImage');
      traceBtn.lastChild.textContent = selectedImages(ed).length > 1 ? 'Trace Images' : 'Trace Image';
    },
  };
}

function traceSection(app) {
  const pid = `tpp-${++uid}`;
  const vid = `tpv-${++uid}`;
  const presetSel = h('select.select', {
    id: pid,
    onchange: () => {
      const id = presetSel.value;
      if (!id) return;
      const ed = app.editor;
      const options = presetOptions(id, savedPresets(app));
      ed.doc.transact('Trace Preset', () => selectedTraces(ed).forEach((n) => updateTrace(ed.doc, n.id, { preset: id, options })));
    },
  });
  const viewSel = h('select.select', { id: vid, onchange: () => {
    const ed = app.editor;
    ed.doc.transact('Trace View', () => selectedTraces(ed).forEach((n) => updateTrace(ed.doc, n.id, { view: viewSel.value })));
  } }, VIEWS.map((v) => h('option', { value: v.value }, v.label)));
  const stats = h('p.trace-props-info', { role: 'status' });
  const el = h(
    'div.trace-props',
    h('div.prop-row', h('label.prop-label', { for: pid }, 'Preset'), presetSel),
    h('div.prop-row', h('label.prop-label', { for: vid }, 'View'), viewSel),
    stats,
    h(
      'div.quick-actions',
      h('button.btn', { type: 'button', onclick: () => app.commands.run('trace.expand') }, 'Expand'),
      h('button.btn', { type: 'button', onclick: () => app.commands.run('trace.release') }, 'Release'),
      h('button.btn', { type: 'button', onclick: () => app.openPanel('traceImage') }, icon('sliders-horizontal', 14), 'Options'),
    ),
  );
  let key = '';
  return {
    el,
    refresh() {
      const ed = app.editor;
      const n = selectedTraces(ed)[0];
      if (!n) return;
      const k = `${n.live.preset}:${savedPresets(app).length}`;
      if (k !== key) {
        key = k;
        presetSel.replaceChildren(...presetOptionsList(app, n.live.preset, { custom: !findPreset(n.live.preset, savedPresets(app)) }));
      }
      presetSel.value = findPreset(n.live.preset, savedPresets(app)) ? n.live.preset : '';
      viewSel.value = n.live.view || 'result';
      const s = n.live.result?.stats;
      const busy = app.traceService?.progress(ed.doc, n.id);
      stats.textContent = busy != null ? `Tracing... ${Math.round(busy * 100)}%` : s ? `${s.paths.toLocaleString()} paths · ${s.anchors.toLocaleString()} anchors · ${s.colors} colors` : '';
    },
  };
}

function cropSection(app) {
  const unit = () => app.editor?.doc.root.units || 'pt';
  const session = () => app.cropSession;
  const tool = () => app.getTool('crop-image');
  const setSize = (patch) => {
    const s = session();
    if (!s) return;
    const img = s.doc.get(s.imageId);
    const kx = Math.hypot(img.transform[0], img.transform[1]) || 1;
    const ky = Math.hypot(img.transform[2], img.transform[3]) || 1;
    const r = { ...s.rect };
    if (patch.w != null) r.w = patch.w / kx;
    if (patch.h != null) r.h = patch.h / ky;
    tool().setRect(r);
  };
  const w = numberField({ label: 'W', value: 0, unit: unit(), min: 0.01, width: '84px', onCommit: (v) => setSize({ w: v }) });
  const hh = numberField({ label: 'H', value: 0, unit: unit(), min: 0.01, width: '84px', onCommit: (v) => setSize({ h: v }) });
  const rid = `tpr-${++uid}`;
  const res = h('select.select', { id: rid, onchange: () => session() && (session().ppi = res.value ? Number(res.value) : null) });
  const el = h(
    'div.trace-props',
    h('div.mosaic-pair', w.el, hh.el),
    h('div.prop-row', h('label.prop-label', { for: rid }, 'Resolution'), res),
    h('div.quick-actions', h('button.btn', { type: 'button', onclick: () => tool().cancelCrop() }, 'Cancel'), h('button.btn.primary', { type: 'button', onclick: () => tool().applyCrop() }, 'Apply')),
  );
  let forImage = null;
  return {
    el,
    refresh() {
      const s = session();
      if (!s) return;
      const img = s.doc.get(s.imageId);
      if (!img) return;
      w.setUnit(unit());
      hh.setUnit(unit());
      w.set(s.rect.w * (Math.hypot(img.transform[0], img.transform[1]) || 1));
      hh.set(s.rect.h * (Math.hypot(img.transform[2], img.transform[3]) || 1));
      if (forImage !== img.asset) {
        forImage = img.asset;
        res.replaceChildren(h('option', { value: '' }, 'Keep'));
        resolutionChoices(s.doc, img).then((list) => {
          res.replaceChildren(...list.map((o) => h('option', { value: o.value, selected: String(s.ppi ?? '') === o.value }, o.label)));
        });
      }
    },
  };
}

export function installPropertiesSections(app) {
  PropertiesPanel.extraSections.push(
    {
      id: 'crop-image',
      title: 'Cropping',
      when: () => Boolean(app.cropSession),
      build: cropSection,
    },
    {
      id: 'trace-image',
      title: 'Image',
      when: (ed) => !app.cropSession && selectedImages(ed).length > 0 && ed.topSelection().every((id) => ed.doc.get(id)?.type === 'image'),
      build: imageSection,
    },
    {
      id: 'trace-object',
      title: 'Traced Image',
      when: (ed) => selectedTraces(ed).length > 0 && ed.topSelection().every((id) => isTrace(ed.doc.get(id)) || isTrace(ed.doc.get(ed.doc.get(id)?.parent))),
      build: traceSection,
    },
  );
}


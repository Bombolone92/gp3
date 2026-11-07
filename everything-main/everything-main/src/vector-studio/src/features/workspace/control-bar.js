/**
 * Control bar (Window > Control): a strip under the menu bar with the
 * settings that matter for the selection: its kind, fill and stroke,
 * stroke weight, opacity and blending, X/Y/W/H, align buttons, and
 * object-specific actions (isolate a group, edit type, crop an image,
 * edit a pattern). With nothing selected it offers the document settings.
 * It reuses the Properties panel's widgets and refreshes with the chrome.
 */
import { h } from '../../lib/dom.js';
import { numberField, paintSwatch, updatePaintSwatch, selectField } from '../../ui/widgets.js';
import { icon } from '../../ui/icons.js';
import { openPaintPopover } from '../../ui/popover.js';
import { commonStyle, applyStyle } from '../../ops/paint-ops.js';
import { selectionKind, BLEND_LABELS } from '../../ui/panels/properties.js';
import { createTransformSection } from '../../ui/panels/transform-section.js';
import { BLEND_MODES } from '../../render/draw.js';

const ALIGN = [
  ['align.left', 'align-left', 'Align Left'],
  ['align.hcenter', 'align-hcenter', 'Align Horizontal Centers'],
  ['align.right', 'align-right', 'Align Right'],
  ['align.top', 'align-top', 'Align Top'],
  ['align.vcenter', 'align-vcenter', 'Align Vertical Centers'],
  ['align.bottom', 'align-bottom', 'Align Bottom'],
];

/** Object-specific actions: [command, label] shown when enabled for the selection. */
const SPECIFIC = {
  Group: [['object.isolate', 'Isolate'], ['object.ungroup', 'Ungroup']],
  'Clip Group': [['object.clipEdit', 'Edit Contents'], ['object.clipRelease', 'Release']],
  Image: [['object.cropImage', 'Crop Image'], ['trace.make', 'Trace Image'], ['edit.editOriginal', 'Edit Original']],
  'Point Type': [['panel.character', 'Character'], ['panel.paragraph', 'Paragraph'], ['type.createOutlines', 'Create Outlines']],
  'Area Type': [['panel.character', 'Character'], ['panel.paragraph', 'Paragraph'], ['type.areaOptions', 'Area Type Options']],
  'Type on a Path': [['panel.character', 'Character'], ['type.pathOptions', 'Type on a Path Options']],
  Path: [['path.simplify', 'Simplify'], ['shape.convert', 'Convert to Shape']],
  'Compound Path': [['object.compoundRelease', 'Release']],
};

export function createControlBar(app) {
  const el = h('div.control-bar', { role: 'toolbar', 'aria-label': 'Control bar', hidden: true });
  const kind = h('span.cb-kind');
  const fillSw = paintSwatch(null);
  const strokeSw = paintSwatch(null, { className: 'stroke-swatch' });
  const fillBtn = h('button.swatch-btn.cb-swatch', { type: 'button', 'aria-label': 'Fill', 'aria-haspopup': 'dialog', 'data-tip': 'Fill', onclick: (e) => openPaintPopover(app, e.currentTarget, 'fill') }, fillSw);
  const strokeBtn = h('button.swatch-btn.cb-swatch', { type: 'button', 'aria-label': 'Stroke', 'aria-haspopup': 'dialog', 'data-tip': 'Stroke', onclick: (e) => openPaintPopover(app, e.currentTarget, 'stroke') }, strokeSw);
  const weight = numberField({ label: 'Stroke weight', ariaLabel: 'Stroke weight', value: 1, unit: 'pt', min: 0, width: '60px', onCommit: (v, o) => applyStyle(app.editor, { strokeWidth: v }, 'Stroke Weight', o?.live ? 'stroke-weight' : null) });
  weight.el.querySelector('label').textContent = '';
  const opacity = numberField({ label: 'Opacity', kind: 'percent', value: 100, min: 0, max: 100, width: '56px', onCommit: (v, o) => applyStyle(app.editor, { opacity: v / 100 }, 'Opacity', o?.live ? 'opacity' : null) });
  const blend = selectField('Blending mode', BLEND_MODES.map((m) => ({ value: m, label: BLEND_LABELS[m] || m })), 'normal', (v) => applyStyle(app.editor, { blendMode: v }, 'Blending Mode'));
  const transform = createTransformSection(app, { compact: true });
  const alignBtns = ALIGN.map(([cmd, ic, label]) => h('button.icon-btn.cb-align', { type: 'button', 'aria-label': label, 'data-tip': label, onclick: () => app.commands.run(cmd) }, icon(ic, 16)));
  const specific = h('span.cb-specific');
  const docActions = h(
    'span.cb-doc',
    h('button.btn.small', { type: 'button', onclick: () => app.commands.run('file.documentSetup') }, 'Document Setup'),
    h('button.btn.small', { type: 'button', onclick: () => app.commands.run('edit.preferences') }, 'Preferences'),
  );
  const paint = h('span.cb-group', fillBtn, strokeBtn, h('span.cb-label', 'Stroke:'), weight.el);
  const look = h('span.cb-group', opacity.el, blend.el);
  const align = h('span.cb-group.cb-aligns', alignBtns);
  el.append(kind, paint, look, h('span.cb-group.cb-transform', transform.el), align, specific, docActions);

  let visible = false;
  let frame = 0;
  const refresh = () => {
    frame = 0;
    if (!visible) return;
    const ed = app.editor;
    el.classList.toggle('no-doc', !ed);
    if (!ed) {
      kind.textContent = 'No Document';
      for (const g of [paint, look, align, specific, docActions, transform.el.parentElement]) g.hidden = true;
      return;
    }
    const any = ed.selection.size > 0;
    const k = selectionKind(ed);
    kind.textContent = k;
    paint.hidden = false;
    look.hidden = !any;
    align.hidden = ed.topSelection().length < 2;
    transform.el.parentElement.hidden = !any;
    docActions.hidden = any;
    const fill = commonStyle(ed, 'fill');
    const stroke = commonStyle(ed, 'stroke');
    updatePaintSwatch(fillSw, fill === 'mixed' ? null : fill, fill === 'mixed');
    updatePaintSwatch(strokeSw, stroke === 'mixed' ? null : stroke, stroke === 'mixed');
    const sw = commonStyle(ed, 'strokeWidth');
    weight.set(sw === 'mixed' ? 'mixed' : sw ?? 1);
    if (any) {
      const nodes = ed.selectedNodes();
      const op = nodes.map((n) => n.opacity ?? 1);
      opacity.set(op.every((v) => v === op[0]) ? op[0] * 100 : 'mixed');
      const bm = nodes.map((n) => n.blendMode || 'normal');
      blend.set(bm.every((v) => v === bm[0]) ? bm[0] : '');
      transform.refresh();
    }
    specific.replaceChildren(
      ...(any ? SPECIFIC[k] || [] : [])
        .filter(([cmd]) => app.commands.get(cmd) && app.commands.isEnabled(cmd))
        .map(([cmd, label]) => h('button.btn.small', { type: 'button', onclick: () => app.commands.run(cmd) }, label)),
    );
    if (any && app.commands.get('pattern.edit') && app.commands.isEnabled('pattern.edit')) specific.append(h('button.btn.small', { type: 'button', onclick: () => app.commands.run('pattern.edit') }, 'Edit Pattern'));
    if (any && app.commands.get('color.recolor') && app.commands.isEnabled('color.recolor')) specific.append(h('button.btn.small', { type: 'button', onclick: () => app.commands.run('color.recolor') }, 'Recolor'));
  };
  const schedule = () => {
    if (!frame && visible) frame = requestAnimationFrame(refresh);
  };
  app.on('chrome', schedule);
  app.on('view', schedule);

  return {
    el,
    refresh,
    setVisible(on) {
      visible = Boolean(on);
      el.hidden = !visible;
      app.root.classList.toggle('has-control-bar', visible);
      if (visible) refresh();
    },
    get visible() {
      return visible;
    },
  };
}

/** Project settings dialog: name, aspect ratio, resolution, frame rate, background. */
import { h } from '../lib/dom.js';
import { RATIOS, FPS_OPTIONS } from '../model/project.js';
import { openDialog } from './dialog.js';
import { selectField, colorField, segmented, sliderField } from './controls.js';

export function projectSettingsFields(ctx, { onChange } = {}) {
  const { store, actions } = ctx;
  const s = store.project.settings;
  const ratioOptions = [{ value: 'original', label: 'Original (first clip)' }, ...RATIOS.map((r) => ({ value: r.id, label: `${r.label}  ${r.hint}` })), ...(s.ratio === 'custom' ? [{ value: 'custom', label: 'Custom' }] : [])];
  const ratio = selectField({
    label: 'Aspect ratio',
    options: ratioOptions,
    value: s.ratio,
    onChange: (v) => {
      const r = RATIOS.find((x) => x.id === v);
      if (r) {
        // Keep the current quality level: scale the preset so its short side matches.
        const short = Math.min(store.project.settings.width, store.project.settings.height);
        const k = short / Math.min(r.w, r.h);
        const even = (n) => Math.max(16, Math.round(n / 2) * 2);
        actions.setProjectSettings({ ratio: v, width: even(r.w * k), height: even(r.h * k) }, 'Change aspect ratio');
      } else actions.setProjectSettings({ ratio: v }, 'Change aspect ratio');
      onChange?.();
    },
  });
  const res = selectField({
    label: 'Resolution (short side)',
    // Media-sized projects can have a short side between the presets; list it as is.
    options: [...new Set([480, 720, 1080, 1440, 2160, Math.min(s.width, s.height)])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: [480, 720, 1080, 1440, 2160].includes(n) ? `${n}p` : `${n}p (from media)` })),
    value: String(Math.min(s.width, s.height)),
    onChange: (v) => {
      const cur = store.project.settings;
      const k = Number(v) / Math.min(cur.width, cur.height);
      const even = (n) => Math.max(16, Math.round(n / 2) * 2);
      actions.setProjectSettings({ width: even(cur.width * k), height: even(cur.height * k) }, 'Change resolution');
      onChange?.();
    },
  });
  const fps = selectField({
    label: 'Frame rate',
    options: FPS_OPTIONS.map((f) => ({ value: String(f), label: `${f} fps` })),
    value: String(s.fps),
    onChange: (v) => actions.setProjectSettings({ fps: Number(v) }, 'Change frame rate'),
  });
  const bgType = segmented({
    label: 'Background',
    options: [{ value: 'color', label: 'Color' }, { value: 'blur', label: 'Blur' }],
    value: s.background.type,
    onChange: (v) => actions.setProjectSettings({ background: { ...store.project.settings.background, type: v } }, 'Change background'),
  });
  const bgColor = colorField({
    label: 'Background color',
    value: s.background.color,
    onInput: (v, final) => store.update('Change background', (p) => {
      p.settings.background.color = v;
    }, { structural: false, coalesce: final ? null : 'bg-color' }),
  });
  const bgBlur = sliderField({
    label: 'Background blur',
    min: 0,
    max: 100,
    value: Math.round(s.background.blur * 100),
    onInput: (v) => store.update('Change background blur', (p) => {
      p.settings.background.blur = v / 100;
    }, { structural: false, coalesce: 'bg-blur' }),
  });
  return h('div.settings-fields', ratio.el, res.el, fps.el, h('div.field', h('span.field-label', 'Canvas background'), bgType.el), bgColor.el, bgBlur.el);
}

export function openProjectSettings(ctx) {
  openDialog({ title: 'Project settings', body: projectSettingsFields(ctx), className: 'small' });
}

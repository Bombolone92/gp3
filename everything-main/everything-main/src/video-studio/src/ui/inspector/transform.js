/**
 * Transform and blend sections shared by video, image, text and sticker
 * clips. The model keeps x and y as fractions of the canvas measured from
 * its center (y grows downward); the panel shows pixels with Y growing
 * upward, as in a standard math coordinate system.
 */
import { h, announce } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { BLEND_MODES } from '../../model/catalog.js';
import { selectField } from '../controls.js';
import { slider, propSection, pressButton, row } from './common.js';
import { scaleFields, alignRow } from './video-extras.js';

const TRANSFORM_PROPS = ['x', 'y', 'scale', 'rotation', 'sx', 'sy'];

export function transformSection(view) {
  const W = () => view.project.settings.width;
  const H = () => view.project.settings.height;
  const scale = slider(view, {
    label: 'Scale',
    min: 1,
    max: 500,
    hardMax: 5000,
    unit: '%',
    prop: 'scale',
    get: () => Math.round(view.valueOf('scale') * 100),
    set: (v, final) => view.animate('scale', Math.max(0.01, v / 100), { label: 'Scale', final }),
  });
  const posX = slider(view, {
    label: 'Position X',
    min: -4000,
    max: 4000,
    hardMin: -20000,
    hardMax: 20000,
    prop: 'x',
    className: 'centered',
    get: () => Math.round(view.valueOf('x') * W()),
    set: (v, final) => view.animate('x', v / W(), { label: 'Move', final }),
  });
  const posY = slider(view, {
    label: 'Position Y',
    min: -4000,
    max: 4000,
    hardMin: -20000,
    hardMax: 20000,
    prop: 'y',
    className: 'centered',
    get: () => Math.round(-view.valueOf('y') * H()),
    set: (v, final) => view.animate('y', -v / H(), { label: 'Move', final }),
  });
  // The position range follows the canvas so the slider stays useful.
  const fitRange = () => {
    posX.input.min = String(-W());
    posX.input.max = String(W());
    posY.input.min = String(-H());
    posY.input.max = String(H());
  };
  fitRange();
  view.bind(fitRange);
  const rotation = slider(view, {
    label: 'Rotate',
    min: -360,
    max: 360,
    hardMin: -3600,
    hardMax: 3600,
    unit: '°',
    prop: 'rotation',
    className: 'centered',
    get: () => Math.round(view.valueOf('rotation') * 10) / 10,
    decimals: 0,
    set: (v, final) => view.animate('rotation', v, { label: 'Rotate', final }),
  });
  const flipH = pressButton(view, {
    label: 'Flip horizontal',
    iconName: 'flipH',
    get: (c) => c.transform.flipH,
    set: (v) => view.edit('Flip', (c) => {
      c.transform.flipH = v;
    }),
  });
  const flipV = pressButton(view, {
    label: 'Flip vertical',
    iconName: 'flipV',
    get: (c) => c.transform.flipV,
    set: (v) => view.edit('Flip', (c) => {
      c.transform.flipV = v;
    }),
  });
  const rot90 = h('button.icon-btn.press-btn', { type: 'button', 'aria-label': 'Rotate 90 degrees clockwise', 'data-tip': 'Rotate 90°' }, icon('rotate', 16));
  rot90.addEventListener('click', () => {
    const r = view.valueOf('rotation');
    const next = ((Math.round(r / 90) * 90 + 90) % 360 + 360) % 360;
    view.animate('rotation', next, { label: 'Rotate' });
  });
  const tools = h('div.insp-tools', { role: 'group', 'aria-label': 'Flip and rotate' }, flipH, flipV, rot90);
  return propSection('Transform', [scale.el, ...scaleFields(view), posX.el, posY.el, rotation.el, row('Flip / rotate', tools), alignRow(view)], {
    onReset: () => {
      view.edit('Reset transform', (c) => {
        Object.assign(c.transform, { x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false });
        delete c.transform.sx;
        delete c.transform.sy;
        for (const p of TRANSFORM_PROPS) delete c.keyframes?.[p];
      });
      announce('Transform reset');
    },
  });
}

export function blendSection(view) {
  const opacity = slider(view, {
    label: 'Opacity',
    min: 0,
    max: 100,
    unit: '%',
    prop: 'opacity',
    get: () => Math.round(view.valueOf('opacity') * 100),
    set: (v, final) => view.animate('opacity', Math.min(1, Math.max(0, v / 100)), { label: 'Opacity', final }),
  });
  const mode = selectField({
    label: 'Mode',
    options: BLEND_MODES.map((b) => ({ value: b.id, label: b.label })),
    value: view.clip.blend || 'normal',
    onChange: (v) => view.edit('Blend mode', (c) => {
      c.blend = v;
    }),
  });
  mode.el.classList.add('insp-row');
  view.bind(() => {
    const c = view.clip;
    if (c && mode.select.value !== (c.blend || 'normal')) mode.set(c.blend || 'normal');
  });
  return propSection('Blend', [mode.el, opacity.el], {
    onReset: () => {
      view.edit('Reset blend', (c) => {
        c.blend = 'normal';
        c.opacity = 1;
        delete c.keyframes?.opacity;
      });
      announce('Blend reset');
    },
  });
}

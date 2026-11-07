/**
 * Color tab for video, image and color layer clips, with Basic (light,
 * color, detail, LUT), HSL, Curves and Wheels sub-tabs. state.colorSub
 * remembers the sub-tab across selections.
 */
import '../../styles/color.css';
import { h } from '../../lib/dom.js';
import { tabSet } from './common.js';
import { colorBasicTab } from './color-basic.js';
import { hslTab } from './hsl.js';
import { curvesTab } from './curves.js';
import { wheelsTab } from './wheels.js';

const SUBS = [
  { id: 'basic', label: 'Basic', make: colorBasicTab },
  { id: 'hsl', label: 'HSL', make: hslTab },
  { id: 'curves', label: 'Curves', make: curvesTab },
  { id: 'wheels', label: 'Wheels', make: wheelsTab },
];

export function adjustTab(view, state = {}) {
  const subs = tabSet({
    label: 'Color settings',
    className: 'subtabs',
    items: SUBS,
    value: state.colorSub || 'basic',
    onChange: (id) => {
      state.colorSub = id;
      show(id);
    },
  });
  const show = (id) => {
    view.resetScope();
    subs.panel.replaceChildren(SUBS.find((s) => s.id === id).make(view, state));
  };
  show(subs.current);
  return h('div.adjust-tab', subs.list, subs.panel);
}

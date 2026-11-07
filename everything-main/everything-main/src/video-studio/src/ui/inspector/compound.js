/**
 * Compound clip tab: what is inside, open it to edit, break it apart, and
 * the transform, blend and volume that apply to the whole nest.
 */
import { h } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { clock } from '../../lib/time.js';
import { sequenceLength } from '../../model/timeline.js';
import { propSection, note } from './common.js';
import { transformSection, blendSection } from './transform.js';
import { volumeSlider } from './audio.js';

export function compoundTab(view) {
  const c = view.clip;
  const count = c.sequence.tracks.reduce((n, t) => n + t.clips.length, 0);
  const open = h('button.btn.primary', { type: 'button' }, icon('layers', 16), 'Open to edit');
  open.addEventListener('click', () => view.ctx.actions.openCompound(c.id));
  const apart = h('button.btn', { type: 'button' }, icon('ungroup', 16), 'Break apart');
  apart.addEventListener('click', () => view.ctx.actions.breakApartCompound(c.id));
  const info = propSection('Compound clip', [
    h('p.insp-note', `${count} clip${count === 1 ? '' : 's'} on ${c.sequence.tracks.length} track${c.sequence.tracks.length === 1 ? '' : 's'}, ${clock(sequenceLength(c.sequence))} in all.`),
    h('div.insp-actions', open, apart),
    note('Effects, filters and color layers inside apply to everything below the compound clip.'),
  ]);
  return h('div', info, transformSection(view), blendSection(view), propSection('Volume', volumeSlider(view).el));
}

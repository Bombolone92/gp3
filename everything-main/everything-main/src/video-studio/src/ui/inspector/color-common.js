/**
 * Pieces shared by the Color sub-tabs: sections with an on/off checkbox
 * (bypass without losing the settings) and grade edits.
 */
import { h } from '../../lib/dom.js';
import { ensureGrade } from '../../model/color.js';
import { propSection, uidFor } from './common.js';

export const isOff = (clip, id) => Boolean(clip?.grade?.off?.[id]);

/** Edit clip.grade (created on first use). fn(grade, clip) mutates; return false to cancel. */
export function editGrade(view, label, fn, opts) {
  return view.edit(label, (c) => fn(ensureGrade(c), c), opts);
}

/**
 * Collapsible section whose header has a checkbox turning the section's
 * effect on or off, plus a reset button.
 */
export function gradeSection(view, { id, title, children, onReset, open = true, actions = null }) {
  const el = propSection(title, children, { onReset, open, actions });
  const boxId = uidFor('on');
  const box = h('input.section-check', { type: 'checkbox', id: boxId, 'aria-label': `Apply ${title.toLowerCase()}`, 'data-tip': 'Turn on or off' });
  box.addEventListener('change', () => {
    const on = box.checked;
    editGrade(view, on ? `Turn on ${title.toLowerCase()}` : `Turn off ${title.toLowerCase()}`, (g) => {
      if (on) delete g.off[id];
      else g.off[id] = true;
    });
  });
  el.querySelector('.section-head').prepend(box);
  el.classList.add('grade-section');
  const body = el.querySelector('.section-body');
  const sync = () => {
    const on = !isOff(view.clip, id);
    if (box.checked !== on) box.checked = on;
    body.classList.toggle('is-off', !on);
  };
  sync();
  view.bind(sync);
  return el;
}

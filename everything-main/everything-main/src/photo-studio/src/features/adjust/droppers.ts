// Black/gray/white point eyedropper buttons shared by Levels and Curves.
import { svg } from '../../app/icons';
import type { AdjustHost } from './host';
import { cancelPick } from './source';
import { h } from './ui';

export type DropMode = 'black' | 'gray' | 'white';
export function droppers(host: AdjustHost, apply: (mode: DropMode, color: [number, number, number]) => void) {
  const tools = h('div', { class: 'adj-tools' });
  for (const mode of ['black', 'gray', 'white'] as const) {
    const b = h('button', { type: 'button', class: `icon-button adj-dropper ${mode}`, title: `Sample in image to set ${mode} point`, 'aria-label': `Set ${mode} point`, 'aria-pressed': 'false' }, svg('pipette', 15));
    b.addEventListener('click', async () => {
      const active = b.getAttribute('aria-pressed') === 'true';
      tools.querySelectorAll('.adj-dropper').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      if (active) {
        cancelPick();
        return;
      }
      b.setAttribute('aria-pressed', 'true');
      const color = await host.pick();
      b.setAttribute('aria-pressed', 'false');
      if (!color) return;
      apply(mode, color);
      host.change(true);
      host.rerender();
    });
    tools.append(b);
  }
  return tools;
}

import { describe, it, expect } from 'vitest';
import { openEaseEditor } from '../src/ui/ease-editor.js';
import { parseCubic } from '../src/model/keyframes.js';
import { easeLabel } from '../src/ui/organize-actions.js';

describe('easing curve dialog', () => {
  it('starts from the current ease, takes presets and arrow keys, and returns a custom curve', async () => {
    const done = openEaseEditor('easeOut');
    const d = document.querySelector('dialog[open]');
    expect(d.querySelector('.ease-readout').textContent).toBe('0, 0.55, 0.45, 1');
    [...d.querySelectorAll('.ease-presets button')].find((b) => b.textContent === 'Overshoot').click();
    const [, second] = d.querySelectorAll('.ease-handle');
    second.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
    [...d.querySelectorAll('button')].find((b) => b.textContent === 'Apply').click();
    const name = await done;
    expect(parseCubic(name)).toEqual([0.34, 1.35, 0.54, 1]);
    expect(easeLabel(name)).toBe('Custom curve');
    expect(easeLabel('bounce')).toBe('Bounce');
  });

  it('returns null when cancelled', async () => {
    const done = openEaseEditor('cubic(0.1,0.2,0.3,0.4)');
    const d = document.querySelector('dialog[open]');
    expect(d.querySelector('.ease-readout').textContent).toBe('0.1, 0.2, 0.3, 0.4');
    [...d.querySelectorAll('button')].find((b) => b.textContent === 'Cancel').click();
    expect(await done).toBeNull();
  });
});

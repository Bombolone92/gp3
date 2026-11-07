/**
 * Video > Chroma key. clip.chroma = { color, strength, spill }; the
 * compositor keys only while strength > 0, and spill grays out key-colored
 * fringes left on the edge. Turning it off removes the
 * object but the panel remembers the last settings for this session.
 */
import { h, announce } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { slider, color, toggle, propSection } from './common.js';

const DEFAULT = { color: '#00ff00', strength: 40, spill: 0 };
const remembered = new Map();

export function chromaTab(view) {
  const ch = (c) => c.chroma || remembered.get(c.id) || DEFAULT;
  const setChroma = (label, key, fn, final) => view.edit(label, (c) => {
    if (!c.chroma) return false;
    fn(c.chroma);
    remembered.set(c.id, { ...c.chroma });
  }, { key: `chroma-${key}`, final });

  const enable = toggle(view, {
    label: 'Enable',
    hint: 'Make one color transparent, like a green screen.',
    get: (c) => Boolean(c.chroma),
    set: (on) => {
      view.edit(on ? 'Chroma key on' : 'Chroma key off', (c) => {
        if (on) c.chroma = { ...ch(c) };
        else {
          if (c.chroma) remembered.set(c.id, { ...c.chroma });
          delete c.chroma;
        }
      });
      announce(on ? 'Chroma key on' : 'Chroma key off');
    },
  });

  const pick = color(view, {
    label: 'Key color',
    get: (c) => ch(c).color,
    set: (v, final) => setChroma('Key color', 'color', (k) => (k.color = v), final),
  });
  const dropper = h('button.icon-btn.eyedropper', { type: 'button', 'aria-label': 'Pick key color from the screen', 'data-tip': 'Pick color from screen' }, icon('droplet', 16));
  if (typeof window.EyeDropper !== 'function') {
    dropper.disabled = true;
    dropper.setAttribute('data-tip', 'This browser cannot pick colors from the screen');
  }
  dropper.addEventListener('click', async () => {
    try {
      const res = await new window.EyeDropper().open();
      if (res?.sRGBHex && /^#[0-9a-f]{6}$/i.test(res.sRGBHex)) {
        setChroma('Key color', 'color', (k) => (k.color = res.sRGBHex.toLowerCase()), true);
        announce(`Key color ${res.sRGBHex}`);
      }
    } catch {
      /* cancelled */
    }
  });
  pick.el.querySelector('.color-row').append(dropper);

  const strength = slider(view, {
    label: 'Strength',
    min: 0,
    max: 100,
    get: (c) => Math.round(ch(c).strength),
    set: (v, final) => setChroma('Key strength', 'strength', (k) => (k.strength = v), final),
  });
  const spill = slider(view, {
    label: 'Spill removal',
    min: 0,
    max: 100,
    get: (c) => Math.round(ch(c).spill || 0),
    set: (v, final) => setChroma('Key spill', 'spill', (k) => (k.spill = v), final),
  });
  const params = h('div.chroma-params', pick.el, strength.el, spill.el);
  const render = () => {
    const c = view.clip;
    if (!c) return;
    const on = Boolean(c.chroma);
    params.classList.toggle('is-off', !on);
    params.querySelectorAll('input, button').forEach((el) => {
      if (el !== dropper || typeof window.EyeDropper === 'function') el.disabled = !on;
    });
  };
  render();
  view.bind(render);
  return h('div', propSection('Chroma key', [enable.el, params], {
    onReset: () => view.edit('Reset chroma key', (c) => {
      if (c.chroma) c.chroma = { ...DEFAULT };
      remembered.delete(c.id);
    }),
  }));
}

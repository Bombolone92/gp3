/**
 * Teleprompter for the record and voiceover dialogs: a script that scrolls
 * at a chosen reading pace while recording. The script and settings are
 * kept in preferences, so the next take starts where you left them.
 *
 * Pace is words per minute: the scroll speed comes from how tall the laid
 * out script is per word, so it matches the reading speed at any text size.
 */
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { switchField, sliderField } from './controls.js';
import { prefs, setPref } from './prefs.js';

const DEFAULTS = { on: false, text: '', wpm: 140, size: 28, mirror: false };

/** Words in a script (anything between spaces). */
export function wordCount(text) {
  return (String(text || '').match(/\S+/g) || []).length;
}

/** Scroll speed (px per second) for a laid-out script of height px holding `words` words, read at wpm. */
export function scrollRate(height, words, wpm) {
  if (!(height > 0) || !(words > 0) || !(wpm > 0)) return 0;
  return (height / words) * (wpm / 60);
}

/**
 * Create a teleprompter. Returns { controls, view, follow(state) }:
 * controls go in the dialog's settings, view over or next to the preview,
 * and follow() is called with the dialog's recording state
 * ('idle' | 'countdown' | 'recording' | 'paused' | 'saving').
 */
export function createTeleprompter({ overlay = false } = {}) {
  const o = { ...DEFAULTS, ...(prefs().teleprompter || {}) };
  const save = () => setPref('teleprompter', { ...o });

  const text = h('div.tp-text');
  const view = h(`div.tp-view${overlay ? '.tp-overlay' : ''}`, { 'aria-hidden': 'true', hidden: true }, h('div.tp-mark'), text);
  const area = h('textarea#tp-script.input.tp-script', { rows: 5, placeholder: 'Paste or type what you will say.', spellcheck: true });
  area.value = o.text;
  const count = h('span.field-hint.tp-count');
  const pace = sliderField({ label: 'Reading pace', min: 60, max: 260, step: 5, value: o.wpm, unit: ' wpm', onInput: (v) => { o.wpm = v; save(); } });
  const size = sliderField({ label: 'Text size', min: 16, max: 56, value: o.size, unit: ' px', onInput: (v) => { o.size = v; save(); layout(); } });
  const mirror = switchField({ label: 'Mirror text', hint: 'For a teleprompter glass', checked: o.mirror, onChange: (v) => { o.mirror = v; save(); layout(); } });
  const restart = h('button.btn.small', { type: 'button' }, icon('rotateLeft', 14), 'Back to start');
  const settings = h('div.tp-settings', h('div.field', h('label.field-label', { for: 'tp-script' }, 'Script'), area, count), pace.el, size.el, mirror.el, restart);
  const toggle = switchField({
    label: 'Teleprompter',
    hint: 'Scrolls your script while you record',
    checked: o.on,
    onChange: (v) => {
      o.on = v;
      save();
      layout();
    },
  });
  const controls = h('div.tp-controls', toggle.el, settings);

  let y = 0;
  let playing = false;
  let last = 0;
  let raf = 0;

  function layout() {
    settings.hidden = !o.on;
    view.hidden = !o.on || !o.text.trim();
    text.textContent = o.text;
    text.style.fontSize = `${o.size}px`;
    view.classList.toggle('mirror', o.mirror);
    count.textContent = o.text.trim() ? `${wordCount(o.text)} words, about ${Math.max(1, Math.round((wordCount(o.text) / o.wpm) * 60))} s at this pace` : '';
    place();
  }

  function place() {
    text.style.transform = `translateY(${-y}px)`;
  }

  function frame(now) {
    raf = 0;
    if (!playing) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const words = wordCount(o.text);
    const hgt = text.scrollHeight;
    y = Math.min(hgt, y + scrollRate(hgt, words, o.wpm) * dt);
    place();
    if (y < hgt) raf = requestAnimationFrame(frame);
  }

  function play() {
    if (playing || view.hidden) return;
    playing = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function pause() {
    playing = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function reset() {
    pause();
    y = 0;
    place();
  }

  area.addEventListener('input', () => {
    o.text = area.value;
    save();
    layout();
  });
  restart.addEventListener('click', reset);
  layout();

  let prev = 'idle';
  return {
    controls,
    view,
    /** Follow the dialog: start from the top on a new take, scroll while recording. */
    follow(state) {
      if (state === 'countdown' || (state === 'recording' && prev === 'idle')) reset();
      if (state === 'recording') play();
      else pause();
      area.disabled = state !== 'idle';
      prev = state;
    },
    dispose: pause,
  };
}

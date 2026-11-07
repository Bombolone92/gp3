// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { bindFormatPainter, SELECTION_KEYS } from '../src/lib/painter.js';

function fakePainter() {
  const calls = [];
  let listener = null;
  return {
    calls,
    fire: (mode) => listener?.(mode),
    formatPainter: {
      setPointerSelecting: (f) => calls.push(['pointer', f]),
      notifyPointerUp: () => calls.push(['pointerUp']),
      setKeyboardSelecting: (f) => calls.push(['key', f]),
      notifyKeyUp: () => calls.push(['keyUp']),
      cancel: () => calls.push(['cancel']),
      onModeChange: (cb) => { listener = cb; return () => { listener = null; }; },
    },
  };
}

describe('bindFormatPainter', () => {
  it('forwards selection gestures only while the painter is armed', () => {
    const ui = fakePainter();
    const host = document.createElement('div');
    const modes = [];
    const unbind = bindFormatPainter(ui, host, { onMode: (m) => modes.push(m) });
    host.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(ui.calls).toEqual([]);

    ui.fire('armed');
    expect(host.classList.contains('painting')).toBe(true);
    host.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    host.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    host.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(ui.calls).toEqual([['pointer', true], ['pointer', false], ['pointerUp'], ['key', true], ['key', false], ['keyUp']]);

    ui.calls.length = 0;
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(ui.calls).toEqual([['cancel']]);

    ui.fire('idle');
    expect(host.classList.contains('painting')).toBe(false);
    ui.calls.length = 0;
    host.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(ui.calls).toEqual([]);
    expect(modes).toEqual(['armed', 'idle']);

    ui.fire('persistent');
    unbind();
    expect(host.classList.contains('painting')).toBe(false);
    host.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(ui.calls).toEqual([]);
  });

  it('hears the release of a drag that ends outside the host', () => {
    const ui = fakePainter();
    const host = document.createElement('div');
    document.body.append(host);
    const unbind = bindFormatPainter(ui, host);
    ui.fire('armed');
    host.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    document.body.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    expect(ui.calls).toEqual([['pointer', true], ['pointer', false], ['pointerUp']]);
    // A release inside the host is reported once, not by both listeners.
    ui.calls.length = 0;
    host.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    expect(ui.calls).toEqual([['pointer', false], ['pointerUp']]);
    unbind();
    document.body.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    expect(ui.calls).toEqual([['pointer', false], ['pointerUp']]);
    host.remove();
  });

  it('is a no-op without a painter surface', () => {
    const host = document.createElement('div');
    expect(typeof bindFormatPainter({}, host)).toBe('function');
    expect(SELECTION_KEYS.has('Home')).toBe(true);
  });
});

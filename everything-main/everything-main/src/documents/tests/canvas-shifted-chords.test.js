// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { CanvasEditor } from '../src/engine/canvas-editor.js';
import { paragraph } from '../src/engine/model.js';

let editor, host;
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fontKerning: 'auto',
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    measureText: text => ({ width: [...text].length * 8 }),
    setTransform() {}, fillRect() {}, fillText() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {}, stroke() {}, setLineDash() {},
  });
  host = document.createElement('div'); document.body.append(host);
  editor = new CanvasEditor(host, { paragraphs: [paragraph('Alpha'), paragraph('Beta')], onChange: vi.fn(), onError: vi.fn() });
});
afterEach(() => { editor?.destroy(); document.body.replaceChildren(); vi.restoreAllMocks(); });

const chord = (code, init = {}) => {
  const event = new KeyboardEvent('keydown', { key: code.replace(/^Key/, '').toLowerCase(), code, metaKey: true, cancelable: true, bubbles: true, ...init });
  editor.input.dispatchEvent(event);
  return event;
};

it('leaves a shifted letter chord to the host instead of running the unshifted command', () => {
  editor.model.select(1, 1);
  const event = chord('KeyA', { shiftKey: true });
  expect(event.defaultPrevented).toBe(false);
  expect(editor.model.range).toEqual([1, 1]);
  expect(editor.model.runFormatting.bold).toBe(false);
  const bold = chord('KeyB', { shiftKey: true });
  expect(bold.defaultPrevented).toBe(false);
  expect(editor.model.runFormatting.bold).toBe(false);
});

it('still selects all, bolds and redoes with the unshifted and redo chords', () => {
  editor.model.select(1, 1);
  expect(chord('KeyA').defaultPrevented).toBe(true);
  expect(editor.model.range).toEqual([0, editor.model.text.length]);
  chord('KeyB');
  expect(editor.model.runFormatting.bold).toBe(true);
  chord('KeyZ');
  expect(editor.model.runFormatting.bold).toBe(false);
  expect(chord('KeyZ', { shiftKey: true }).defaultPrevented).toBe(true);
  expect(editor.model.runFormatting.bold).toBe(true);
});

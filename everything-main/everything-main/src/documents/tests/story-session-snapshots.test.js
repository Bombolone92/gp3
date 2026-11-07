import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { StorySession } from '../src/engine/story-session.js';

// Idle callbacks run only when the test says the browser is idle.
let idle = [];
beforeEach(() => {
  idle = [];
  vi.stubGlobal('requestIdleCallback', callback => idle.push(callback));
  vi.stubGlobal('cancelIdleCallback', () => {});
});
afterEach(() => vi.unstubAllGlobals());
const runIdle = () => { const pending = idle; idle = []; for (const callback of pending) callback(); };
const text = model => model.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n');

it('starts each command from the document copied while the browser was idle', () => {
  const model = new TextDocument([paragraph('First paragraph'), paragraph('Second paragraph')]);
  const session = new StorySession(model, null);
  runIdle();
  // A command copies the whole document (snapshot) only when no idle copy is ready.
  const copy = vi.spyOn(model, 'snapshot');
  model.select(5);
  session.run(() => model.replace(' typed'));
  expect(copy).not.toHaveBeenCalled();
  expect(text(model)).toBe('First typed paragraph\nSecond paragraph');
  runIdle();
  model.select(0, 5);
  session.run(() => model.replace('One'));
  expect(copy).not.toHaveBeenCalled();
  // Without an idle moment in between, the next command copies the document itself.
  model.select(3);
  session.run(() => model.replace('!'));
  expect(copy).toHaveBeenCalledOnce();
  session.undo();
  expect(text(model)).toBe('One typed paragraph\nSecond paragraph');
  // Undo restores the selection and text each command started from.
  session.undo();
  expect(text(model)).toBe('First typed paragraph\nSecond paragraph');
  expect(model.range).toEqual([0, 5]);
  session.undo();
  expect(text(model)).toBe('First paragraph\nSecond paragraph');
  expect(model.range).toEqual([5, 5]);
});

it('copies the document again when it changed since the idle copy', () => {
  const model = new TextDocument([paragraph('Alpha beta')]);
  const session = new StorySession(model, null);
  runIdle();
  // A change with its own revision, made outside a session command.
  model.select(5); model.replace(' gamma');
  model.select(0);
  session.run(() => model.replace('X'));
  session.undo();
  expect(text(model)).toBe('Alpha gamma beta');
});

it('refuses an idle copy of a document that changed without a new revision', () => {
  const model = new TextDocument([paragraph('Alpha beta')]);
  const session = new StorySession(model, null);
  runIdle();
  model.paragraphs[0].runs[0].text = 'Changed silently';
  expect(() => session.run(() => model.replace('X'))).toThrow('The document changed without a new revision.');
});

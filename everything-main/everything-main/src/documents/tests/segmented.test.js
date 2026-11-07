// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { segmented } from '../src/ui/segmented.js';

afterEach(() => document.body.replaceChildren());

function setup(value = 'center', onPick = vi.fn()) {
  const group = segmented([['left', 'Left'], ['center', 'Center'], ['right', 'Right']], value, onPick, 'Alignment');
  document.body.append(group);
  return { group, buttons: [...group.children], onPick };
}
function key(key, extra = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
  document.activeElement.dispatchEvent(event);
  return event;
}

it('wraps selection in both directions and skips disabled options', () => {
  const { group, buttons, onPick } = setup();
  expect(buttons.map((button) => button.tabIndex)).toEqual([-1, 0, -1]);
  buttons[1].focus();
  expect(key('ArrowDown').defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(buttons[2]);
  key('ArrowRight');
  expect(document.activeElement).toBe(buttons[0]);
  key('ArrowUp');
  expect(document.activeElement).toBe(buttons[2]);
  buttons[1].disabled = true;
  key('ArrowLeft');
  expect(document.activeElement).toBe(buttons[0]);
  expect(onPick.mock.calls.map(([value]) => value)).toEqual(['right', 'left', 'right', 'left']);
  expect(group.querySelectorAll('[aria-checked="true"]')).toHaveLength(1);
  expect(buttons.map((button) => button.tabIndex)).toEqual([0, -1, -1]);
  expect(key('Tab').defaultPrevented).toBe(false);
});

it('keeps pointer actions and choices without an initial selection working', () => {
  const { group, buttons, onPick } = setup(null);
  expect(group.querySelector('[aria-checked="true"]')).toBeNull();
  expect(buttons.map((button) => button.tabIndex)).toEqual([0, -1, -1]);
  buttons[2].click();
  expect(onPick).toHaveBeenCalledWith('right');
  expect(buttons.map((button) => button.tabIndex)).toEqual([-1, -1, 0]);
  expect(buttons[2].getAttribute('aria-checked')).toBe('true');
});

it('leaves composition and modified shortcuts alone', () => {
  const { buttons, onPick } = setup();
  buttons[1].focus();
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
    expect(key('ArrowRight', extra).defaultPrevented).toBe(false);
  }
  expect(onPick).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(buttons[1]);
});

it('keeps arrow focus in the group when pointer selection normally focuses a related field', () => {
  const input = document.createElement('input');
  document.body.append(input);
  const { buttons } = setup('center', () => input.focus());
  buttons[2].click();
  expect(document.activeElement).toBe(input);
  buttons[1].focus();
  key('ArrowLeft');
  expect(document.activeElement).toBe(buttons[0]);
});

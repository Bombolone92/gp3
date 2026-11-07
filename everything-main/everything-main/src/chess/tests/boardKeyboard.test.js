import { afterAll, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
const { BoardView } = await import('../src/ui/boardView.js');
afterAll(() => vi.unstubAllGlobals());

// Keyboard handling needs only the focused square and the view's callbacks.
function press(key, modifiers = {}) {
  const focus = vi.fn();
  const activate = vi.fn();
  const event = {
    key,
    target: { closest: () => ({ dataset: { square: 'e4' } }) },
    preventDefault: vi.fn(),
    ...modifiers,
  };
  BoardView.prototype._onKeyDown.call({
    orientation: 'w',
    _setRovingFocus: focus,
    handlers: { onSquareActivate: activate },
  }, event);
  return { event, focus, activate };
}

describe('board keyboard shortcuts', () => {
  it.each(['altKey', 'ctrlKey', 'metaKey'])('leaves %s shortcuts to the browser', (modifier) => {
    const { event, focus, activate } = press('ArrowLeft', { [modifier]: true });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it('leaves a previously handled event alone', () => {
    const { event, focus } = press('ArrowUp', { defaultPrevented: true });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it('still moves focus with an ordinary arrow key', () => {
    const { event, focus } = press('ArrowUp');
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledWith('e5');
  });

  it('still activates a square with Enter', () => {
    const { event, activate } = press('Enter');
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledWith('e4');
  });
});

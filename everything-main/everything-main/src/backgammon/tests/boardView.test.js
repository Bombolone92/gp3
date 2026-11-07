// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { BoardView } from '../src/ui/boardView.js';
import { Backgammon } from '../src/engine/backgammon.js';

let el;
let view;
let calls;

beforeEach(() => {
  document.body.innerHTML = '<div id="board"></div>';
  el = document.getElementById('board');
  calls = [];
  view = new BoardView(el, {
    onSlotPress: (slot) => calls.push(['press', slot]),
    onDrop: (from, to, moved) => calls.push(['drop', from, to, moved]),
    onSlotActivate: (slot) => calls.push(['activate', slot]),
  });
});

/** Draw the opening position with White at the bottom and nothing selected. */
function drawStart(state = {}) {
  const game = new Backgammon();
  view.render({
    points: game.points(),
    off: { w: 0, b: 0 },
    moverColor: 'w',
    selected: null,
    targets: new Map(),
    movable: new Set(),
    dice: null,
    lastMoves: [],
    ...state,
  });
  return game;
}

const slot = (key) => el.querySelector(`.slot[data-key="${key}"]`);
const checkers = (key) => slot(key).querySelectorAll('.checker, .borne');

describe('the grid', () => {
  it('is two rows of fourteen cells', () => {
    expect(el.querySelectorAll('.board-row')).toHaveLength(2);
    expect(el.querySelectorAll('.slot')).toHaveLength(28);
    expect(el.querySelectorAll('.slot-point')).toHaveLength(24);
    expect(el.querySelectorAll('.slot-bar')).toHaveLength(2);
    expect(el.querySelectorAll('.slot-tray')).toHaveLength(2);
  });

  it('puts point 1 in the bottom right and point 13 in the top left', () => {
    const rows = el.querySelectorAll('.board-row');
    expect(rows[0].children[0].dataset.slot).toBe('13');
    expect(rows[0].children[13].classList.contains('slot-tray')).toBe(true);
    expect(rows[1].children[12].dataset.slot).toBe('1');
    expect(rows[1].children[6].classList.contains('slot-bar')).toBe(true);
  });

  it('reflects the board when Black sits at the bottom', () => {
    view.setOrientation('b');
    const rows = el.querySelectorAll('.board-row');
    // Every display position now shows the point 25 - p, so Black's home
    // board (19-24) lands in the bottom right where White's used to be.
    expect(rows[1].children[12].dataset.slot).toBe('24');
    expect(rows[0].children[0].dataset.slot).toBe('12');
  });

  it('gives the bar and the tray the number belonging to their own side', () => {
    expect(slot('bar-bottom').dataset.slot).toBe('25'); // White's bar
    expect(slot('off-bottom').dataset.slot).toBe('0'); // White bears off to 0
    expect(slot('bar-top').dataset.slot).toBe('0'); // Black's bar
    expect(slot('off-top').dataset.slot).toBe('25');
  });
});

describe('drawing a position', () => {
  it('places the opening checkers on the right points, in the right colours', () => {
    drawStart();
    expect(checkers('p24')).toHaveLength(2);
    expect(checkers('p13')).toHaveLength(5);
    expect(checkers('p6')).toHaveLength(5);
    expect(checkers('p1')).toHaveLength(2);
    expect(checkers('p24')[0].dataset.color).toBe('w');
    expect(checkers('p1')[0].dataset.color).toBe('b');
    expect(checkers('p7')).toHaveLength(0);
  });

  it('squeezes a stack that will not fit, and counts it', () => {
    const points = new Array(26).fill(0);
    points[6] = 8;
    view.render({
      points,
      off: { w: 0, b: 0 },
      moverColor: 'w',
      selected: null,
      targets: new Map(),
      movable: new Set(),
      dice: null,
      lastMoves: [],
    });
    const stack = slot('p6').querySelector('.stack');
    expect(stack.style.getPropertyValue('--step')).toContain('0.5786'); // 4.05 / 7
    const drawn = checkers('p6');
    expect(drawn).toHaveLength(8);
    // The count goes on the innermost checker — the one still shown whole.
    expect(drawn[7].firstChild.textContent).toBe('8');
    expect(drawn[0].firstChild.textContent).toBe('');
  });

  it('leaves a stack of five at full pitch, with no count', () => {
    drawStart();
    const stack = slot('p6').querySelector('.stack');
    expect(stack.style.getPropertyValue('--step')).toBe('calc(var(--checker) * 1.0000)');
    expect(checkers('p6')[4].firstChild.textContent).toBe('');
  });

  it('draws borne-off checkers as flat chips in the right tray', () => {
    drawStart({ off: { w: 4, b: 2 } });
    expect(slot('off-bottom').querySelectorAll('.borne')).toHaveLength(4);
    expect(slot('off-top').querySelectorAll('.borne')).toHaveLength(2);
    expect(slot('off-bottom').querySelector('.borne').dataset.color).toBe('w');
  });

  it('shows the dice, marking the ones already played', () => {
    drawStart({ dice: { values: [3, 3, 3, 3], used: [true, false, false, false], color: 'w' } });
    const dice = el.querySelectorAll('.die');
    expect(dice).toHaveLength(4);
    expect(dice[0].classList.contains('face-3')).toBe(true);
    expect(dice[0].querySelectorAll('i')).toHaveLength(3);
    expect(dice[0].classList.contains('spent')).toBe(true);
    expect(dice[1].classList.contains('spent')).toBe(false);
  });
});

describe('the landing marker', () => {
  it('sits where the checker would join the stack', () => {
    drawStart({ targets: new Map([[8, { from: 13, to: 8, die: 5, hit: false }]]) });
    const landing = slot('p8').querySelector('.landing');
    expect(landing).not.toBe(null);
    expect(landing.style.getPropertyValue('--i')).toBe('3'); // the 8-point holds three
  });

  it('takes the place of a checker it would hit', () => {
    const points = new Array(26).fill(0);
    points[8] = -1; // a lone opposing checker
    view.render({
      points,
      off: { w: 0, b: 0 },
      moverColor: 'w',
      selected: null,
      targets: new Map([[8, { from: 13, to: 8, die: 5, hit: true }]]),
      movable: new Set(),
      dice: null,
      lastMoves: [],
    });
    expect(slot('p8').querySelector('.landing').style.getPropertyValue('--i')).toBe('0');
  });

  it('goes away when the slot stops being a target', () => {
    drawStart({ targets: new Map([[8, { from: 13, to: 8, die: 5, hit: false }]]) });
    drawStart();
    expect(slot('p8').querySelector('.landing')).toBe(null);
  });

  it('only lights the end of the board belonging to the side moving', () => {
    // Slot 0 is White's tray *and* Black's bar. With White to move it is the
    // tray that is a legal destination, and the bar must stay dark.
    drawStart({ targets: new Map([[0, { from: 3, to: 0, die: 3, hit: false }]]) });
    expect(slot('off-bottom').classList.contains('target')).toBe(true);
    expect(slot('bar-top').classList.contains('target')).toBe(false);
  });
});

describe('reporting presses', () => {
  it('reports the engine number of a point', () => {
    slot('p13').dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(calls).toEqual([['press', 13]]);
  });

  it('reports a press on a checker as a press on its point', () => {
    drawStart();
    checkers('p6')[0].dispatchEvent(
      new window.PointerEvent('pointerdown', { bubbles: true, button: 0 }),
    );
    expect(calls).toEqual([['press', 6]]);
  });

  it('ignores the far side’s bar and tray', () => {
    // White is moving; Black's bar is also numbered 0, and reporting it would
    // read to the controller as White bearing off.
    drawStart({ moverColor: 'w' });
    slot('bar-top').dispatchEvent(
      new window.PointerEvent('pointerdown', { bubbles: true, button: 0 }),
    );
    slot('off-top').dispatchEvent(
      new window.PointerEvent('pointerdown', { bubbles: true, button: 0 }),
    );
    expect(calls).toEqual([]);
    slot('off-bottom').dispatchEvent(
      new window.PointerEvent('pointerdown', { bubbles: true, button: 0 }),
    );
    expect(calls).toEqual([['press', 0]]);
  });

  it('follows the mover to the other end of the board', () => {
    drawStart({ moverColor: 'b' });
    slot('bar-top').dispatchEvent(
      new window.PointerEvent('pointerdown', { bubbles: true, button: 0 }),
    );
    expect(calls).toEqual([['press', 0]]); // Black's bar, now that Black moves
  });

  it('ignores anything but the primary button', () => {
    slot('p13').dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 2 }));
    expect(calls).toEqual([]);
  });

  it('activates a slot from the keyboard', () => {
    slot('p8').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(calls).toEqual([['activate', 8]]);
  });
});

describe('keyboard navigation', () => {
  it.each([
    { key: 'ArrowLeft', altKey: true },
    { key: 'Home', ctrlKey: true },
    { key: 'ArrowRight', metaKey: true },
    { key: 'Enter', ctrlKey: true },
    { key: ' ', altKey: true },
    { key: 'Enter', metaKey: true },
  ])('leaves browser shortcuts alone: %j', (shortcut) => {
    const start = slot('p14');
    view._setRovingFocus('p14', false);
    start.focus();
    const event = new window.KeyboardEvent('keydown', {
      ...shortcut, bubbles: true, cancelable: true,
    });
    start.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(start);
    expect(calls).toEqual([]);
  });

  it('leaves an already handled key alone', () => {
    const start = slot('p14');
    view._setRovingFocus('p14', false);
    start.focus();
    const event = new window.KeyboardEvent('keydown', {
      key: 'ArrowRight', bubbles: true, cancelable: true,
    });
    event.preventDefault();
    start.dispatchEvent(event);
    expect(document.activeElement).toBe(start);
  });

  it('keeps exactly one slot in the tab order', () => {
    const focusable = [...el.querySelectorAll('.slot')].filter((s) => s.tabIndex === 0);
    expect(focusable).toHaveLength(1);
  });

  it('moves the tab stop along the row and between rows', () => {
    const start = slot('p13');
    start.focus();
    view._setRovingFocus('p13', false);
    start.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement.dataset.key).toBe('p14');
    document.activeElement.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    expect(document.activeElement.dataset.key).toBe('p11');
  });

  it('stops at the ends of a row', () => {
    view._setRovingFocus('p13', false);
    slot('p13').focus();
    slot('p13').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.activeElement.dataset.key).toBe('p13');
  });
});

describe('labels', () => {
  it.each(['w', 'b'])('only calls %s’s own tray a legal bear-off destination', (color) => {
    const tray = color === 'w' ? 0 : 25;
    drawStart({
      moverColor: color,
      targets: new Map([[tray, { to: tray, hit: false }]]),
    });
    const own = slot(color === 'w' ? 'off-bottom' : 'off-top');
    const other = slot(color === 'w' ? 'bar-top' : 'bar-bottom');
    expect(own.classList.contains('target')).toBe(true);
    expect(own.getAttribute('aria-label')).toContain('legal move');
    expect(other.classList.contains('target')).toBe(false);
    expect(other.getAttribute('aria-label')).not.toContain('legal move');
  });

  it('name the slot, what is on it, and whether it can be played to', () => {
    drawStart({ targets: new Map([[8, { from: 13, to: 8, die: 5, hit: false }]]) });
    expect(slot('p13').getAttribute('aria-label')).toBe('Point 13, 5 White checkers');
    expect(slot('p8').getAttribute('aria-label')).toBe('Point 8, 3 White checkers, legal move');
    expect(slot('p7').getAttribute('aria-label')).toBe('Point 7, empty');
    expect(slot('bar-bottom').getAttribute('aria-label')).toBe('White bar, empty');
  });

  it('count in the singular', () => {
    const points = new Array(26).fill(0);
    points[5] = 1;
    view.render({
      points,
      off: { w: 0, b: 0 },
      moverColor: 'w',
      selected: null,
      targets: new Map(),
      movable: new Set(),
      dice: null,
      lastMoves: [],
    });
    expect(slot('p5').getAttribute('aria-label')).toBe('Point 5, 1 White checker');
  });
});

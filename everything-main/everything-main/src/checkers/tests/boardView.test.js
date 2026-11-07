// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { BoardView, pieceLabel } from '../src/ui/boardView.js';
import { squareToRowCol } from '../src/engine/geometry.js';

const mount = () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const handlers = {
    onSquarePress: vi.fn(),
    onDrop: vi.fn(),
    onSquareActivate: vi.fn(),
  };
  return { view: new BoardView(el, handlers), el, handlers };
};

const emptyBoard = () => new Array(33).fill(null);

describe('board view', () => {
  it('builds 64 cells but only 32 playable squares', () => {
    const { el } = mount();
    expect(el.querySelectorAll('.square')).toHaveLength(64);
    expect(el.querySelectorAll('.square[data-square]')).toHaveLength(32);
  });

  it('numbers the playable squares 1 to 32', () => {
    const { el } = mount();
    const nums = [...el.querySelectorAll('.square[data-square]')]
      .map((s) => Number(s.dataset.num))
      .sort((a, b) => a - b);
    expect(nums).toEqual([...Array(32)].map((_, i) => i + 1));
  });

  it('puts square 1 top-left with White at the bottom', () => {
    const { el, view } = mount();
    view.setOrientation('w');
    const playable = [...el.querySelectorAll('.square[data-square]')];
    expect(playable[0].dataset.square).toBe('1');
    expect(playable[31].dataset.square).toBe('32');
  });

  // Black's men start on 1-12, which are the top three rows unflipped — so a
  // player playing Black sees the board flipped, with 32 at top-left.
  it('flips the board when Black is at the bottom', () => {
    const { el, view } = mount();
    view.setOrientation('b');
    const playable = [...el.querySelectorAll('.square[data-square]')];
    expect(playable[0].dataset.square).toBe('32');
    expect(playable[31].dataset.square).toBe('1');
  });

  it('renders men and kings as discs', () => {
    const { el, view } = mount();
    const board = emptyBoard();
    board[1] = 'b';
    board[32] = 'W';
    view.render({ board, selected: null, targets: new Map(), lastMove: null, chained: null });
    const square1 = el.querySelector('[data-square="1"] .piece');
    expect(square1.dataset.piece).toBe('bM');
    expect(square1.querySelector('.crown')).toBe(null);
    expect(el.querySelector('[data-square="32"] .piece').dataset.piece).toBe('wK');
    expect(el.querySelector('[data-square="32"] .crown')).not.toBe(null);
  });

  it('marks hints, captures, selection, last move, and the chain', () => {
    const { el, view } = mount();
    const board = emptyBoard();
    board[11] = 'b';
    view.render({
      board,
      selected: 11,
      targets: new Map([[15, false], [18, true]]),
      lastMove: { from: 9, to: 11 },
      chained: 11,
    });
    expect(el.querySelector('[data-square="11"]').classList.contains('sel')).toBe(true);
    expect(el.querySelector('[data-square="15"]').classList.contains('hint')).toBe(true);
    expect(el.querySelector('[data-square="18"]').classList.contains('capture-hint')).toBe(true);
    expect(el.querySelector('[data-square="9"]').classList.contains('last')).toBe(true);
    expect(el.querySelector('[data-square="11"] .piece').classList.contains('chained')).toBe(true);
  });

  // animateMove defers relocating the moved piece element into its
  // destination square until the animation's completion callback (see its
  // doc comment). If a render() lands in that window it finds the
  // destination empty and draws a fresh piece there; the deferred relocation
  // then drops the original element into the same square too, leaving two
  // overlapping .piece elements. render() must collapse a square back down
  // to one element no matter how many renders and animation callbacks
  // interleave, or the duplicate survives indefinitely (not even a later
  // render of the same, correct state cleans it up).
  it('a render landing mid-animation never leaves a square holding more than one .piece', () => {
    vi.useFakeTimers();
    try {
      const { el, view } = mount();
      const board = emptyBoard();
      board[11] = 'b';
      view.render({ board, selected: null, targets: new Map(), lastMove: null, chained: null });
      expect(el.querySelectorAll('[data-square="11"] .piece')).toHaveLength(1);

      const postMoveBoard = emptyBoard();
      postMoveBoard[15] = 'b';

      // Mirrors every real call site in main.js: the completion callback's
      // first act is always a fresh render() of the authoritative post-move
      // state.
      view.animateMove(
        11,
        15,
        () => {
          view.render({
            board: postMoveBoard,
            selected: null,
            targets: new Map(),
            lastMove: null,
            chained: null,
          });
        },
        { keepPiece: true },
      );

      // A render lands squarely in the deferred-relocation window: the
      // destination square has no piece element yet (relocate() hasn't run),
      // so this used to create a second, fresh one there.
      view.render({
        board: postMoveBoard,
        selected: null,
        targets: new Map(),
        lastMove: null,
        chained: null,
      });

      // Let the deferred relocation and the completion callback's own render
      // fire (animateMove falls back to a plain 280ms timer since jsdom
      // never dispatches a real transitionend).
      vi.advanceTimersByTime(300);

      for (const squareEl of el.querySelectorAll('.square[data-square]')) {
        expect(squareEl.querySelectorAll('.piece').length).toBeLessThanOrEqual(1);
      }
      expect(el.querySelectorAll('[data-square="15"] .piece')).toHaveLength(1);
      expect(el.querySelectorAll('[data-square="11"] .piece')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('two successive renders of the same state never duplicate a square\'s piece', () => {
    const { el, view } = mount();
    const board = emptyBoard();
    board[11] = 'b';
    board[32] = 'W';
    const state = { board, selected: null, targets: new Map(), lastMove: null, chained: null };
    view.render(state);
    view.render(state);
    expect(el.querySelectorAll('[data-square="11"] .piece')).toHaveLength(1);
    expect(el.querySelectorAll('[data-square="32"] .piece')).toHaveLength(1);
  });

  it('reports a press as a square number', () => {
    const { el, handlers } = mount();
    el.querySelector('[data-square="11"]').dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
    );
    expect(handlers.onSquarePress).toHaveBeenCalledWith(11, expect.anything());
  });

  it('ignores presses on light squares', () => {
    const { el, handlers } = mount();
    el.querySelector('.square:not([data-square])').dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
    );
    expect(handlers.onSquarePress).not.toHaveBeenCalled();
  });

  it('names pieces for assistive technology', () => {
    expect(pieceLabel('b')).toBe('Black man');
    expect(pieceLabel('W')).toBe('White king');
  });
});

// Arrow-key navigation is the trickiest new logic in this module: the grid is
// a checkerboard, so stepping straight up or down a row always lands on a
// light square unless the column also shifts by one — and there are two
// equally-near dark squares to choose between when it does. These tests pin
// down the properties that make the result usable rather than merely
// plausible: navigation always lands on a playable square, left/right stay
// in the row, up/down stay one row away, and repeated presses settle into a
// stable back-and-forth instead of drifting sideways or getting stuck at an
// edge. Covered for both orientations, since a flipped board reverses which
// screen direction maps to which board direction.
describe('keyboard navigation between dark squares', () => {
  // Move the roving tab stop to `square` the same way a pointer press does,
  // without exercising a second, unrelated code path (real DOM focus, which
  // jsdom's automatic layout doesn't need for this).
  const focusSquare = (el, square) => {
    el.querySelector(`[data-square="${square}"]`).dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
    );
  };

  const currentSquare = (el) => {
    const squareEl = el.querySelector('.square[tabindex="0"]');
    return squareEl ? Number(squareEl.dataset.square) : null;
  };

  const pressKey = (el, key) => {
    el.querySelector('.square[tabindex="0"]').dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  };

  for (const orientation of ['b', 'w']) {
    it(`orientation ${orientation}: every arrow from every square lands on a playable square`, () => {
      const { el, view } = mount();
      view.setOrientation(orientation);
      for (let square = 1; square <= 32; square++) {
        for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) {
          focusSquare(el, square);
          pressKey(el, key);
          const now = currentSquare(el);
          expect(now).not.toBe(null);
          expect(now).toBeGreaterThanOrEqual(1);
          expect(now).toBeLessThanOrEqual(32);
          expect(el.querySelector(`[data-square="${now}"]`)).not.toBe(null);
        }
      }
    });

    it(`orientation ${orientation}: left/right move to the adjacent playable square in the same row`, () => {
      const { el, view } = mount();
      view.setOrientation(orientation);
      for (let square = 1; square <= 32; square++) {
        for (const key of ['ArrowLeft', 'ArrowRight']) {
          focusSquare(el, square);
          pressKey(el, key);
          const now = currentSquare(el);
          if (now === square) continue; // a no-op at the row's edge is fine
          const [row0] = squareToRowCol(square);
          const [row1] = squareToRowCol(now);
          expect(row1).toBe(row0);
          // The next dark square along a row is always the adjacent PDN
          // number — nothing else sits between them.
          expect(Math.abs(now - square)).toBe(1);
        }
      }
    });

    it(`orientation ${orientation}: up/down move to a playable square one row away`, () => {
      const { el, view } = mount();
      view.setOrientation(orientation);
      for (let square = 1; square <= 32; square++) {
        for (const key of ['ArrowUp', 'ArrowDown']) {
          focusSquare(el, square);
          pressKey(el, key);
          const now = currentSquare(el);
          if (now === square) continue; // a no-op at the top/bottom edge is fine
          const [row0] = squareToRowCol(square);
          const [row1] = squareToRowCol(now);
          expect(Math.abs(row1 - row0)).toBe(1);
        }
      }
    });

    it(`orientation ${orientation}: reversing an arrow returns to the start`, () => {
      // Whichever board row/column edge a given orientation puts at the top
      // or the left varies, so this doesn't assume a direction is "the one
      // that moves" — it only checks the round trip when the first press
      // actually did move, for all four opposite pairs.
      const { el, view } = mount();
      view.setOrientation(orientation);
      const pairs = [
        ['ArrowDown', 'ArrowUp'],
        ['ArrowUp', 'ArrowDown'],
        ['ArrowRight', 'ArrowLeft'],
        ['ArrowLeft', 'ArrowRight'],
      ];
      for (let square = 1; square <= 32; square++) {
        for (const [there, back] of pairs) {
          focusSquare(el, square);
          pressKey(el, there);
          if (currentSquare(el) === square) continue; // no-op at this edge
          pressKey(el, back);
          expect(currentSquare(el)).toBe(square);
        }
      }
    });

    it(`orientation ${orientation}: repeated Down presses settle into a two-square oscillation, never drifting`, () => {
      const { el, view } = mount();
      view.setOrientation(orientation);
      focusSquare(el, 1);
      const seen = [1];
      for (let i = 0; i < 12; i++) {
        pressKey(el, 'ArrowDown');
        seen.push(currentSquare(el));
      }
      // Once the run reaches an edge and settles, only two distinct squares
      // should appear in the tail — never a monotonically growing set, which
      // would mean the column was drifting sideways with every press.
      expect(new Set(seen.slice(-4)).size).toBeLessThanOrEqual(2);
    });

    it(`orientation ${orientation}: hitting an edge does not get stuck — the opposite arrow still moves`, () => {
      // Which board edge (row 0, row 7, or a row's near/far column) a given
      // key drives toward depends on orientation, so this drives each
      // direction to its edge first — however many presses that takes — and
      // only then checks that reversing gets off it. That's true regardless
      // of which physical key happens to be "up" for this orientation.
      const { el, view } = mount();
      view.setOrientation(orientation);
      const pairs = [
        ['ArrowUp', 'ArrowDown'],
        ['ArrowDown', 'ArrowUp'],
        ['ArrowLeft', 'ArrowRight'],
        ['ArrowRight', 'ArrowLeft'],
      ];
      for (const start of [1, 16, 32]) {
        for (const [key, opposite] of pairs) {
          focusSquare(el, start);
          for (let i = 0; i < 8; i++) pressKey(el, key); // more presses than rows/cols in play
          const stuck = currentSquare(el);
          pressKey(el, opposite);
          expect(currentSquare(el)).not.toBe(stuck);
        }
      }
    });
  }
});

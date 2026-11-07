/**
 * Renders the board DOM and translates pointer gestures (click-to-move and
 * drag-and-drop) into square-level callbacks. Owns no game state: the
 * controller passes a snapshot to render() and decides what presses mean.
 *
 * Squares here are PDN numbers 1-32, not algebraic strings: every callback
 * argument and every method parameter is a number, and `data-square` is
 * parsed with Number() on read. The grid itself is 64 cells (needed for the
 * checkerboard pattern), but only the 32 dark cells are playable — light
 * cells carry no data-square, no tabIndex, and no handlers.
 */

import { squareToRowCol, rowColToSquare } from '../engine/geometry.js';
import { colorOf, isKing } from '../engine/checkers.js';
import { Crown, createElement } from 'lucide';

// jsdom (used by this file's own test) doesn't implement matchMedia; a real
// browser always does, so this only ever falls back to "matches: false"
// under test, which just leaves animations on (nothing here tests timing).
const REDUCED_MOTION = window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };

const PIECE_CODES = { b: 'bM', B: 'bK', w: 'wM', W: 'wK' };

// Built once and cloned per king rather than reconstructed on every render.
const CROWN_TEMPLATE = createElement(Crown, { class: 'crown' });

/** Squares are numbers here, not strings — `data-square` is parsed on read. */
const pressed = (e) => {
  const el = e.target.closest('.square[data-square]');
  return el ? Number(el.dataset.square) : null;
};

export function pieceLabel(piece) {
  const color = colorOf(piece) === 'b' ? 'Black' : 'White';
  return `${color} ${isKing(piece) ? 'king' : 'man'}`;
}

export class BoardView {
  /**
   * @param {HTMLElement} el board container
   * @param {{ onSquarePress(square, event), onDrop(from, to|null, moved),
   *           onSquareActivate(square) }} handlers
   */
  constructor(el, handlers) {
    this.el = el;
    this.handlers = handlers;
    // orientation names the colour at the BOTTOM of the board, matching
    // chess's convention. Black's men (1-12) sit on the raw numbering's top
    // rows, so an unflipped board already puts White at the bottom — this
    // app defaults to the human playing Black, so the default view flips
    // that, putting Black at the bottom instead.
    this.orientation = 'b';
    this.squareEls = new Map();
    this._drag = null;
    this._focusSquare = null;
    this._buildGrid();

    el.addEventListener('pointerdown', (e) => {
      // Only the primary button plays. A right- or middle-press would otherwise
      // pick a piece up, and pressing a highlighted square would complete the
      // move — and the context menu that follows a right-press can swallow the
      // pointerup that was meant to end the drag, stranding the ghost piece.
      // (Touch and pen contacts report button 0, and a move without a button
      // change reports -1, so both still pass.)
      if (e.button > 0) return;
      const square = pressed(e);
      if (square === null) return;
      // Keep keyboard navigation anchored to the last pressed square.
      this._setRovingFocus(square, false);
      this.handlers.onSquarePress(square, e);
    });
    el.addEventListener('keydown', (e) => this._onKeyDown(e));
    window.addEventListener('pointermove', (e) => this._onPointerMove(e));
    window.addEventListener('pointerup', (e) => this._onPointerUp(e));
    window.addEventListener('pointercancel', (e) => this._onPointerCancel(e));
    el.addEventListener('dragstart', (e) => e.preventDefault());
  }

  setOrientation(color) {
    if (color === this.orientation) return;
    this.orientation = color;
    this._buildGrid();
  }

  _buildGrid() {
    this.el.innerHTML = '';
    this.squareEls.clear();
    let rowEl = null;
    for (let pos = 0; pos < 64; pos++) {
      if ((pos & 7) === 0) {
        rowEl = document.createElement('div');
        rowEl.className = 'board-row';
        rowEl.setAttribute('role', 'row');
        this.el.appendChild(rowEl);
      }
      // Display position -> board (row, col); a flipped board reverses both
      // axes. Black's men (1-12) sit on the raw numbering's top rows, so the
      // unflipped board (orientation 'w') already puts White at the bottom;
      // orientation 'b' flips it so Black is at the bottom instead.
      const idx = this.orientation === 'w' ? pos : 63 - pos;
      const row = idx >> 3;
      const col = idx & 7;
      const square = rowColToSquare(row, col); // 0 for a light square
      const squareEl = document.createElement('div');
      squareEl.className = `square ${square ? 'dark' : 'light'}`;
      if (square) {
        squareEl.dataset.square = square;
        squareEl.dataset.num = square;
        squareEl.setAttribute('role', 'gridcell');
        squareEl.setAttribute('aria-label', String(square));
        squareEl.tabIndex = -1;
        const mark = document.createElement('span');
        mark.className = 'mark';
        squareEl.appendChild(mark);
        this.squareEls.set(square, squareEl);
      } else {
        // Light squares exist only to complete the checkerboard pattern:
        // no handlers, no tab stop, and hidden from assistive tech.
        squareEl.setAttribute('aria-hidden', 'true');
      }
      rowEl.appendChild(squareEl);
    }
    // One square stays in the tab order (roving tabindex); start at the
    // bottom-left corner as seen by the player. That corner is always dark:
    // flipping the board is a point reflection, which preserves the parity
    // that makes a square playable.
    const idx = this.orientation === 'w' ? 56 : 7;
    this._setRovingFocus(rowColToSquare(idx >> 3, idx & 7), false);
  }

  /** Move the tab stop (and optionally focus) to `square`. */
  _setRovingFocus(square, focus = true) {
    if (this._focusSquare && this._focusSquare !== square) {
      const prev = this.squareEls.get(this._focusSquare);
      if (prev) prev.tabIndex = -1;
    }
    this._focusSquare = square;
    const squareEl = this.squareEls.get(square);
    if (squareEl) {
      squareEl.tabIndex = 0;
      if (focus) squareEl.focus();
    }
  }

  /**
   * Step from (row, col) to the nearest dark square one row away, keeping the
   * same "slot" within the row (its position among that row's four dark
   * squares). Consecutive rows offset their dark columns by exactly one, so
   * stepping straight up or down always lands on a light square unless the
   * column shifts by one too — this keeps that shift minimal and, crucially,
   * consistent: repeated presses oscillate between two columns rather than
   * drifting sideways with every step.
   */
  _stepRow(row, col, rowDelta) {
    const newRow = row + rowDelta;
    if (newRow < 0 || newRow > 7) return 0;
    const offset = row % 2 === 0 ? 1 : 0;
    const slot = (col - offset) / 2;
    const newOffset = newRow % 2 === 0 ? 1 : 0;
    return rowColToSquare(newRow, slot * 2 + newOffset);
  }

  _onKeyDown(e) {
    const squareEl = e.target.closest('.square[data-square]');
    if (!squareEl) return;
    const square = Number(squareEl.dataset.square);
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.handlers.onSquareActivate(square);
      return;
    }
    const [row, col] = squareToRowCol(square);
    // A flipped board (orientation other than 'w', i.e. Black at the bottom)
    // mirrors both axes, so the on-screen meaning of every arrow reverses
    // relative to the board's own rows/cols.
    const flip = this.orientation !== 'w';
    let target = 0;
    switch (e.key) {
      case 'ArrowUp':
        target = this._stepRow(row, col, flip ? 1 : -1);
        break;
      case 'ArrowDown':
        target = this._stepRow(row, col, flip ? -1 : 1);
        break;
      case 'ArrowLeft':
        target = rowColToSquare(row, col + (flip ? 2 : -2));
        break;
      case 'ArrowRight':
        target = rowColToSquare(row, col + (flip ? -2 : 2));
        break;
      case 'Home': {
        const firstCol = row % 2 === 0 ? 1 : 0;
        const lastCol = row % 2 === 0 ? 7 : 6;
        target = rowColToSquare(row, flip ? lastCol : firstCol);
        break;
      }
      case 'End': {
        const firstCol = row % 2 === 0 ? 1 : 0;
        const lastCol = row % 2 === 0 ? 7 : 6;
        target = rowColToSquare(row, flip ? firstCol : lastCol);
        break;
      }
      default:
        return;
    }
    e.preventDefault();
    if (target) this._setRovingFocus(target);
  }

  /**
   * @param {{ board: (string|null)[], selected: number|null,
   *           targets: Map<number, boolean>, lastMove: {from, to}|null,
   *           chained: number|null, idle: Set<number> }} state
   *   `idle` holds squares whose piece cannot legally move right now. The
   *   controller decides when that is worth showing; this only draws it.
   */
  render(state) {
    for (const [square, squareEl] of this.squareEls) {
      const piece = state.board[square];
      // animateMove's deferred relocation (see its doc comment) can land a
      // piece element into this square in between two renders, or a render
      // caught mid-animation can have already created a fresh one here —
      // either order can leave more than one `.piece` under a square. Only
      // `querySelector`'s first match used to be managed, so a second one
      // was invisible to this function and never got cleaned up (not even by
      // a later New game, since the grid itself isn't rebuilt for that).
      // Collapsing to at most one element per square, on every render
      // regardless of how many are actually there, is what makes this
      // self-healing rather than just harder to trigger.
      const pieceEls = squareEl.querySelectorAll('.piece');
      let pieceEl = pieceEls[0] || null;
      for (let i = 1; i < pieceEls.length; i++) pieceEls[i].remove();
      if (piece) {
        const code = PIECE_CODES[piece];
        if (!pieceEl) {
          pieceEl = document.createElement('div');
          pieceEl.className = 'piece';
          squareEl.appendChild(pieceEl);
        }
        if (pieceEl.dataset.piece !== code) {
          pieceEl.dataset.piece = code;
          pieceEl.textContent = '';
          if (isKing(piece)) pieceEl.appendChild(CROWN_TEMPLATE.cloneNode(true));
        }
        // A render can land mid-drag (the computer's reply finishing its
        // slide, a remote move, Escape clearing the selection). The piece
        // under the pointer keeps its faded origin, or it would show up solid
        // on its old square while the ghost is still following the cursor.
        pieceEl.classList.toggle('drag-origin', this._drag?.piece === pieceEl);
        // A piece locked into a jump chain: the turn is not over and no other
        // piece may be picked up, which is worth saying on the piece itself.
        pieceEl.classList.toggle('chained', state.chained === square);
        pieceEl.classList.toggle('idle', !!state.idle && state.idle.has(square));
        pieceEl.style.transform = '';
        pieceEl.style.transition = '';
      } else if (pieceEl) {
        pieceEl.remove();
      }
      squareEl.classList.remove('lift');
      squareEl.classList.toggle('sel', state.selected === square);
      squareEl.classList.toggle(
        'last',
        !!state.lastMove && (state.lastMove.from === square || state.lastMove.to === square),
      );
      const target = state.targets ? state.targets.get(square) : undefined;
      squareEl.classList.toggle('hint', target === false);
      squareEl.classList.toggle('capture-hint', target === true);

      let label = piece ? `${square}, ${pieceLabel(piece)}` : `${square}, empty`;
      if (target === true) label += ', capture';
      else if (target === false) label += ', legal move';
      squareEl.setAttribute('aria-label', label);
      if (state.selected === square) squareEl.setAttribute('aria-selected', 'true');
      else squareEl.removeAttribute('aria-selected');
    }
  }

  /** Abandon a drag in progress without treating it as a drop. */
  cancelDrag() {
    this._endDrag(null, true);
  }

  /** Begin dragging the piece on `square`, following the given pointer. */
  startDrag(square, event) {
    this._endDrag(null, true);
    const squareEl = this.squareEls.get(square);
    const pieceEl = squareEl && squareEl.querySelector('.piece');
    if (!pieceEl) return;
    // Measure the piece, not its square: a piece is inset within its square,
    // so sizing the ghost to the square would hand the pointer something
    // visibly bigger than the piece that was picked up.
    const rect = pieceEl.getBoundingClientRect();
    // Deep clone: a king's crown is a child element, and the ghost dragged
    // under the pointer needs to carry it too.
    const ghost = pieceEl.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    // The ghost lives on <body>, outside any `.square` — and a piece's border
    // is sized in `cqw`, against the square as its query container. With no
    // container in scope those units resolve against the viewport instead, so
    // the ghost came out with a border tens of pixels thick that swallowed the
    // piece whole and drew as a plain white disc. Copy the resolved width.
    ghost.style.borderWidth = getComputedStyle(pieceEl).borderWidth;
    document.body.appendChild(ghost);
    pieceEl.classList.add('drag-origin');
    this._drag = {
      from: square,
      // A drag belongs to the contact that started it. On a touch screen a
      // second finger (or a resting thumb) reports its own pointerId, and
      // without this every later event would be taken for this one's: the
      // ghost would jump to the other finger, and lifting it would drop the
      // piece on whatever square it happened to be over.
      pointerId: event.pointerId,
      ghost,
      piece: pieceEl,
      size: rect.width,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    this._positionGhost(event.clientX, event.clientY);
    event.preventDefault();
  }

  _positionGhost(x, y) {
    const { ghost, size } = this._drag;
    ghost.style.left = `${x - size / 2}px`;
    ghost.style.top = `${y - size / 2}px`;
  }

  _onPointerMove(e) {
    if (!this._drag || e.pointerId !== this._drag.pointerId) return;
    if (
      Math.abs(e.clientX - this._drag.startX) > 4 ||
      Math.abs(e.clientY - this._drag.startY) > 4
    ) {
      this._drag.moved = true;
    }
    this._positionGhost(e.clientX, e.clientY);
  }

  _onPointerUp(e) {
    // A drag ends when the contact and button that began it end — not on any
    // other pointer going up, and not on a secondary button released mid-drag.
    if (!this._drag || e.pointerId !== this._drag.pointerId || e.button > 0) return;
    this._endDrag(this._squareFromPoint(e.clientX, e.clientY), false);
  }

  _onPointerCancel(e) {
    if (!this._drag || e.pointerId !== this._drag.pointerId) return;
    this._endDrag(null, true);
  }

  _endDrag(to, silent) {
    if (!this._drag) return;
    const { from, ghost, piece, moved } = this._drag;
    ghost.remove();
    piece.classList.remove('drag-origin');
    this._drag = null;
    if (!silent) this.handlers.onDrop(from, to, moved);
  }

  _squareFromPoint(x, y) {
    const rect = this.el.getBoundingClientRect();
    const c = Math.floor(((x - rect.left) / rect.width) * 8);
    const r = Math.floor(((y - rect.top) / rect.height) * 8);
    if (c < 0 || c > 7 || r < 0 || r > 7) return null;
    const pos = r * 8 + c;
    const idx = this.orientation === 'w' ? pos : 63 - pos;
    return rowColToSquare(idx >> 3, idx & 7) || null;
  }

  /**
   * Slide the piece currently shown on `from` over to `to`, then call `done`
   * (which is expected to re-render). Falls back to an immediate `done` if
   * there is nothing to animate.
   *
   * @param {{ keepPiece?: boolean }} [opts] With `keepPiece`, the piece
   *   element is moved into the destination square rather than left for the
   *   next render to place — so a following leg of a jump chain has
   *   something to slide.
   */
  animateMove(from, to, done, { keepPiece = false } = {}) {
    const fromEl = this.squareEls.get(from);
    const toEl = this.squareEls.get(to);
    const pieceEl = fromEl && fromEl.querySelector('.piece');
    const relocate = () => {
      if (keepPiece && pieceEl && toEl) toEl.appendChild(pieceEl);
    };
    if (!pieceEl || !toEl || REDUCED_MOTION.matches) {
      relocate();
      done();
      return;
    }
    // The move is already made: the pick-up marks describe a choice that has
    // been taken, so drop them rather than let the piece slide onto its own
    // hint dot with its origin still lit up. The render in `done` puts the
    // authoritative highlights back.
    for (const squareEl of this.squareEls.values()) {
      squareEl.classList.remove('sel', 'hint', 'capture-hint');
    }
    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    fromEl.classList.add('lift');
    pieceEl.style.transition = 'transform 170ms cubic-bezier(0.2, 0.7, 0.3, 1)';
    pieceEl.style.transform = `translate(${b.left - a.left}px, ${b.top - a.top}px)`;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      pieceEl.style.transition = '';
      pieceEl.style.transform = '';
      fromEl.classList.remove('lift');
      relocate();
      done();
    };
    pieceEl.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 280);
  }

  /**
   * Slide a piece along a whole jump path, one leg at a time, then re-render.
   * Chains arriving from the computer or a peer come as a finished turn, so
   * this is what shows the player what happened rather than the piece simply
   * appearing at the far end.
   */
  animatePath(path, done) {
    if (REDUCED_MOTION.matches || path.length < 2) {
      done();
      return;
    }
    let leg = 1;
    const next = () => {
      if (leg >= path.length) {
        done();
        return;
      }
      const from = path[leg - 1];
      const to = path[leg];
      leg += 1;
      this.animateMove(from, to, next, { keepPiece: true });
    };
    next();
  }
}

/**
 * Renders the board DOM and translates pointer gestures (click-to-move and
 * drag-and-drop) into square-level callbacks. Owns no game state: the
 * controller passes a snapshot to render() and decides what presses mean.
 */

import { squareToIndex, indexToSquare } from '../engine/chess.js';

const PIECE_BASE = `${import.meta.env.BASE_URL}pieces/`;
const TYPE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

export function pieceUrl(piece) {
  const color = piece.charCodeAt(0) < 97 ? 'w' : 'b';
  return `${PIECE_BASE}${color}${piece.toUpperCase()}.svg`;
}

export function pieceLabel(piece) {
  const color = piece.charCodeAt(0) < 97 ? 'White' : 'Black';
  return `${color} ${TYPE_NAMES[piece.toLowerCase()]}`;
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
    this.orientation = 'w';
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
      const squareEl = e.target.closest('.square');
      if (!squareEl) return;
      // Keep keyboard navigation anchored to the last pressed square.
      this._setRovingFocus(squareEl.dataset.square, false);
      this.handlers.onSquarePress(squareEl.dataset.square, e);
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
      // Display position -> board index; a flipped board reverses both axes.
      const idx = this.orientation === 'w' ? pos : 63 - pos;
      const square = indexToSquare(idx);
      const squareEl = document.createElement('div');
      const shade = (((idx & 7) + (idx >> 3)) & 1) === 0 ? 'light' : 'dark';
      squareEl.className = `square ${shade}`;
      squareEl.dataset.square = square;
      squareEl.setAttribute('role', 'gridcell');
      squareEl.setAttribute('aria-label', square);
      squareEl.tabIndex = -1;
      if (pos >> 3 === 7) squareEl.dataset.file = square[0];
      if ((pos & 7) === 0) squareEl.dataset.rank = square[1];
      const mark = document.createElement('span');
      mark.className = 'mark';
      squareEl.appendChild(mark);
      rowEl.appendChild(squareEl);
      this.squareEls.set(square, squareEl);
    }
    // One square stays in the tab order (roving tabindex); start at the
    // bottom-left corner as seen by the player.
    this._setRovingFocus(this.orientation === 'w' ? 'a1' : 'h8', false);
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

  _onKeyDown(e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const squareEl = e.target.closest('.square');
    if (!squareEl) return;
    const square = squareEl.dataset.square;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.handlers.onSquareActivate(square);
      return;
    }
    const pos = this.orientation === 'w'
      ? squareToIndex(square)
      : 63 - squareToIndex(square);
    let row = pos >> 3;
    let col = pos & 7;
    switch (e.key) {
      case 'ArrowUp': row -= 1; break;
      case 'ArrowDown': row += 1; break;
      case 'ArrowLeft': col -= 1; break;
      case 'ArrowRight': col += 1; break;
      case 'Home': col = 0; break;
      case 'End': col = 7; break;
      default: return;
    }
    e.preventDefault();
    if (row < 0 || row > 7 || col < 0 || col > 7) return;
    const next = row * 8 + col;
    this._setRovingFocus(indexToSquare(this.orientation === 'w' ? next : 63 - next));
  }

  /**
   * @param {{ board: (string|null)[], selected: string|null,
   *           targets: Map<string, boolean>, lastMove: {from, to}|null,
   *           checkSquare: string|null }} state
   */
  render(state) {
    for (const [square, squareEl] of this.squareEls) {
      const piece = state.board[squareToIndex(square)];
      let img = squareEl.querySelector('.piece');
      if (piece) {
        if (!img) {
          img = document.createElement('img');
          img.className = 'piece';
          img.draggable = false;
          squareEl.appendChild(img);
        }
        if (img.dataset.piece !== piece) {
          img.src = pieceUrl(piece);
          img.alt = pieceLabel(piece);
          img.dataset.piece = piece;
        }
        // A render can land mid-drag (the computer's reply finishing its
        // slide, a remote move, Escape clearing the selection). The piece
        // under the pointer keeps its faded origin, or it would show up solid
        // on its old square while the ghost is still following the cursor.
        img.classList.toggle('drag-origin', this._drag?.img === img);
        img.style.transform = '';
        img.style.transition = '';
      } else if (img) {
        img.remove();
      }
      squareEl.classList.remove('lift');
      squareEl.classList.toggle('sel', state.selected === square);
      squareEl.classList.toggle(
        'last',
        !!state.lastMove && (state.lastMove.from === square || state.lastMove.to === square),
      );
      squareEl.classList.toggle('check', state.checkSquare === square);
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
    const img = squareEl && squareEl.querySelector('.piece');
    if (!img) return;
    const rect = squareEl.getBoundingClientRect();
    const ghost = img.cloneNode();
    ghost.classList.add('drag-ghost');
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.appendChild(ghost);
    img.classList.add('drag-origin');
    this._drag = {
      from: square,
      // A drag belongs to the contact that started it. On a touch screen a
      // second finger (or a resting thumb) reports its own pointerId, and
      // without this every later event would be taken for this one's: the
      // ghost would jump to the other finger, and lifting it would drop the
      // piece on whatever square it happened to be over.
      pointerId: event.pointerId,
      ghost,
      img,
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
    const { from, ghost, img, moved } = this._drag;
    ghost.remove();
    img.classList.remove('drag-origin');
    this._drag = null;
    if (!silent) this.handlers.onDrop(from, to, moved);
  }

  _squareFromPoint(x, y) {
    const rect = this.el.getBoundingClientRect();
    const c = Math.floor(((x - rect.left) / rect.width) * 8);
    const r = Math.floor(((y - rect.top) / rect.height) * 8);
    if (c < 0 || c > 7 || r < 0 || r > 7) return null;
    const pos = r * 8 + c;
    return indexToSquare(this.orientation === 'w' ? pos : 63 - pos);
  }

  /**
   * Slide the piece currently shown on `from` over to `to`, then call `done`
   * (which is expected to re-render). Falls back to an immediate `done` if
   * there is nothing to animate.
   */
  animateMove(from, to, done) {
    const fromEl = this.squareEls.get(from);
    const toEl = this.squareEls.get(to);
    const img = fromEl && fromEl.querySelector('.piece');
    if (!img || !toEl || REDUCED_MOTION.matches) {
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
    img.style.transition = 'transform 170ms cubic-bezier(0.2, 0.7, 0.3, 1)';
    img.style.transform = `translate(${b.left - a.left}px, ${b.top - a.top}px)`;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      done();
    };
    img.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 280);
  }
}

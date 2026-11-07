/**
 * Renders the board and turns pointer and keyboard gestures into slot-level
 * callbacks. Owns no game state: the controller passes a snapshot to render()
 * and decides what a press means.
 *
 * ## Slots
 *
 * Everything a checker can sit on or move to is a "slot", named by the engine
 * number the *colour that owns that part of the board* uses for it:
 *
 *   1-24  the points
 *   25/0  the bar — 25 is White's, 0 is Black's
 *   0/25  the tray — 0 is where White bears off to, 25 where Black does
 *
 * The two ends double up, which sounds worse than it is: White's tray and
 * Black's bar are both "0", but they are different elements on screen, and a
 * move is always read with a colour in hand — 0 as a destination is White
 * bearing off, 0 as an origin is Black coming in. Callbacks report the number
 * belonging to whichever colour owns the element that was pressed, so the
 * controller never has to work out which end of the board it is looking at.
 *
 * ## Geometry
 *
 * The board is one 14-column, 2-row CSS grid: six points, the bar, six more
 * points, and the tray, top and bottom. The bar and the tray look like single
 * columns because their two halves are drawn identically, but each half is its
 * own cell, which is what lets the grid stay a grid and the ARIA stay honest.
 *
 * Sizes are all derived from one unit — the width of a point — which the
 * stylesheet computes from the board's own width. This file only ever sets
 * how tightly a stack is squeezed, as a multiple of that unit.
 */

import { BAR, OFF, opponent } from '../engine/backgammon.js';

// jsdom (used by this file's own test) doesn't implement matchMedia; a real
// browser always does, so this only ever falls back to "matches: false"
// under test, which just leaves animations on (nothing here tests timing).
const REDUCED_MOTION = window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };

/** Checkers shown at full spacing before a stack starts to overlap. */
const STACK_LIMIT = 5;
/** How much of a point's length a full stack may fill, in checker widths. */
const STACK_SPAN = 5.05;

const MOVE_MS = 210;

/** The point at display position `i` (0-24) with White at the bottom. */
function displayPoint(row, column) {
  // Top row runs 13-18 then 19-24 left to right; the bottom row runs 12 down
  // to 7 and then 6 down to 1, so that 1 sits in the bottom right corner.
  if (row === 0) return column < 6 ? 13 + column : 19 + (column - 7);
  return column < 6 ? 12 - column : 6 - (column - 7);
}

export class BoardView {
  /**
   * @param {HTMLElement} el board container
   * @param {{ onSlotPress(slot, event), onDrop(from, to|null, moved),
   *           onSlotActivate(slot) }} handlers
   */
  constructor(el, handlers) {
    this.el = el;
    this.handlers = handlers;
    /** The colour shown along the bottom edge. */
    this.bottom = 'w';
    /**
     * The colour whose move is being built right now. It settles which end of
     * the board a shared number means: with White at the bottom, "0" is both
     * White's tray and Black's bar, and only the mover's own end can be
     * pressed, dropped on, or animated to.
     */
    this.mover = 'w';
    /** key ('p13' | 'bar-top' | 'off-bottom') -> element */
    this.slotEls = new Map();
    /** key -> the engine slot number that element stands for */
    this.slotNumbers = new Map();
    this._drag = null;
    this._focusKey = null;
    this._order = []; // keys in keyboard-navigation order
    this._buildGrid();

    el.addEventListener('pointerdown', (e) => {
      // Only the primary button plays. A right- or middle-press would otherwise
      // pick a checker up, and the context menu that follows can swallow the
      // pointerup that was meant to end the drag, stranding the ghost.
      if (e.button > 0) return;
      const key = keyOf(e.target);
      if (!key) return;
      this._setRovingFocus(key, false);
      const slot = this._numberFor(key);
      if (slot !== null) this.handlers.onSlotPress(slot, e);
    });
    el.addEventListener('keydown', (e) => this._onKeyDown(e));
    window.addEventListener('pointermove', (e) => this._onPointerMove(e));
    window.addEventListener('pointerup', (e) => this._onPointerUp(e));
    window.addEventListener('pointercancel', (e) => this._onPointerCancel(e));
    el.addEventListener('dragstart', (e) => e.preventDefault());
  }

  /** Which colour sits along the bottom edge; the board flips to suit. */
  setOrientation(color) {
    if (color === this.bottom) return;
    this.bottom = color;
    this._buildGrid();
  }

  _buildGrid() {
    const top = opponent(this.bottom);
    this.el.replaceChildren();
    this.slotEls.clear();
    this.slotNumbers.clear();
    this._order = [];
    this._focusKey = null;

    for (let row = 0; row < 2; row++) {
      const rowEl = document.createElement('div');
      rowEl.className = 'board-row';
      rowEl.setAttribute('role', 'row');
      const side = row === 0 ? 'top' : 'bottom';
      const color = row === 0 ? top : this.bottom;
      for (let column = 0; column < 14; column++) {
        let el;
        if (column === 6) {
          el = this._makeSlot(`bar-${side}`, BAR[color], 'bar', `${nameOf(color)} bar`);
          el.classList.add(`bar-${side}`);
        } else if (column === 13) {
          el = this._makeSlot(`off-${side}`, OFF[color], 'tray', `${nameOf(color)} tray`);
          el.classList.add(`tray-${side}`);
        } else {
          const point = displayPoint(row, column);
          const engine = this.bottom === 'w' ? point : 25 - point;
          el = this._makeSlot(`p${point}`, engine, 'point', `Point ${engine}`);
          el.classList.add(row === 0 ? 'point-top' : 'point-bottom');
          el.classList.add((point & 1) === 0 ? 'point-even' : 'point-odd');
          el.dataset.num = String(engine);
        }
        rowEl.appendChild(el);
      }
      this.el.appendChild(rowEl);
    }

    // The dice live in the strip of felt the points do not reach.
    this.diceEl = document.createElement('div');
    this.diceEl.className = 'dice';
    this.diceEl.setAttribute('aria-hidden', 'true'); // the sidebar says the roll
    this.el.appendChild(this.diceEl);

    // Keyboard order: along the top row, then along the bottom.
    this._order = [...this.slotEls.keys()];
    this._setRovingFocus(this._order[this._order.length - 2], false);
  }

  _makeSlot(key, number, kind, label) {
    const el = document.createElement('div');
    el.className = `slot slot-${kind}`;
    el.dataset.slot = String(number);
    el.dataset.key = key;
    el.setAttribute('role', 'gridcell');
    el.setAttribute('aria-label', label);
    el.tabIndex = -1;
    const stack = document.createElement('div');
    stack.className = 'stack';
    el.appendChild(stack);
    this.slotEls.set(key, el);
    this.slotNumbers.set(key, number);
    return el;
  }

  /** Move the tab stop (and optionally focus) to `key`. */
  _setRovingFocus(key, focus = true) {
    if (!this.slotEls.has(key)) return;
    if (this._focusKey && this._focusKey !== key) {
      const previous = this.slotEls.get(this._focusKey);
      if (previous) previous.tabIndex = -1;
    }
    this._focusKey = key;
    const el = this.slotEls.get(key);
    el.tabIndex = 0;
    if (focus) el.focus();
  }

  _onKeyDown(e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = keyOf(e.target);
    if (!key) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const slot = this._numberFor(key);
      if (slot !== null) this.handlers.onSlotActivate(slot);
      return;
    }
    const index = this._order.indexOf(key);
    if (index === -1) return;
    const width = 14;
    const row = Math.floor(index / width);
    const column = index % width;
    let next = index;
    switch (e.key) {
      case 'ArrowLeft':
        next = row * width + Math.max(0, column - 1);
        break;
      case 'ArrowRight':
        next = row * width + Math.min(width - 1, column + 1);
        break;
      case 'ArrowUp':
        next = column; // the same column in the top row
        break;
      case 'ArrowDown':
        next = width + column;
        break;
      case 'Home':
        next = row * width;
        break;
      case 'End':
        next = row * width + width - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    this._setRovingFocus(this._order[next]);
  }

  /**
   * Draw a position.
   *
   * @param {{
   *   points: number[],                 the engine's 26-slot board
   *   off: {w: number, b: number},
   *   selected: number|null,            the slot a checker has been lifted from
   *   targets: Map<number, object>,     where it may go, by slot
   *   movable: Set<number>,             slots this player may pick up from
   *   dice: {values: number[], used: boolean[], color: string}|null,
   *   lastMoves: {from: number, to: number}[],
   *   moverColor: string,               whose end of the board is in play
   * }} state
   */
  render(state) {
    this.mover = state.moverColor || this.mover;
    const top = opponent(this.bottom);
    const highlighted = new Set();
    for (const move of state.lastMoves || []) {
      highlighted.add(move.from);
      highlighted.add(move.to);
    }

    for (const [key, el] of this.slotEls) {
      const number = this.slotNumbers.get(key);
      const color = key.endsWith('-top') ? top : this.bottom;
      let count = 0;
      let checkerColor = color;
      if (key.startsWith('p')) {
        const n = state.points[number];
        count = Math.abs(n);
        checkerColor = n > 0 ? 'w' : 'b';
      } else if (key.startsWith('bar')) {
        count = Math.abs(state.points[BAR[color]]);
      } else {
        count = state.off[color];
      }
      const target = state.targets ? state.targets.get(number) : undefined;
      // A destination is only meaningful for the side to move, and the two
      // ends of the board share their numbers — so a tray only lights up for
      // the colour it belongs to, and likewise the bar.
      const owns = key.startsWith('p') || color === this.mover;
      this._drawStack(el, key, checkerColor, count, key.startsWith('off'), owns ? target : null);

      el.classList.toggle('target', !!target && owns);
      el.classList.toggle('selected', state.selected === number && owns);
      el.classList.toggle('movable', !!state.movable && state.movable.has(number) && owns);
      el.classList.toggle('last', highlighted.has(number) && key.startsWith('p'));
      el.setAttribute(
        'aria-label',
        this._label(key, number, color, count, checkerColor, owns ? target : null),
      );
    }

    this._drawDice(state.dice);
  }

  /**
   * Lay a stack of checkers into a slot.
   *
   * Up to five sit at full width; beyond that they overlap far enough to keep
   * the whole stack inside the point, and the outermost one carries the count
   * so a squeezed stack is still countable at a glance.
   */
  _drawStack(el, key, color, count, isTray, target) {
    const stack = el.querySelector('.stack');
    // The bar squeezes sooner than a point does: its stack grows toward the
    // middle of the board, where the doubling cube sits.
    const span = key.startsWith('bar') ? 3.4 : STACK_SPAN;
    const limit = key.startsWith('bar') ? 3 : STACK_LIMIT;
    if (!isTray) {
      // The tray stacks flat chips at a fixed pitch of its own; only a point
      // or the bar has to squeeze a stack into a fixed length.
      const factor = count > limit ? (span - 1) / (count - 1) : 1;
      stack.style.setProperty('--step', `calc(var(--checker) * ${factor.toFixed(4)})`);
    }
    const wanted = Math.min(count, 15);
    const checkers = stack.querySelectorAll('.checker, .borne');
    for (let i = wanted; i < checkers.length; i++) checkers[i].remove();
    for (let i = checkers.length; i < wanted; i++) {
      const checker = document.createElement('span');
      checker.className = isTray ? 'borne' : 'checker';
      checker.appendChild(document.createElement('b')); // holds the count
      stack.appendChild(checker);
    }
    const drawn = stack.querySelectorAll('.checker, .borne');
    for (let i = 0; i < drawn.length; i++) {
      drawn[i].dataset.color = color;
      drawn[i].style.setProperty('--i', String(i));
      // The count goes on the innermost checker — the one a squeezed stack
      // still shows whole.
      drawn[i].firstChild.textContent =
        !isTray && count > limit && i === count - 1 ? String(count) : '';
    }

    // The landing ring goes exactly where the next checker would sit, which
    // says how the point will look rather than merely that it is legal.
    let landing = stack.querySelector('.landing');
    if (target) {
      if (!landing) {
        landing = document.createElement('span');
        landing.className = 'landing';
        stack.appendChild(landing);
      }
      // A checker landing on a lone opponent sends it to the bar, so it takes
      // that checker's place rather than stacking on top of it.
      landing.style.setProperty('--i', String(Math.min(target.hit ? 0 : count, 14)));
    } else if (landing) {
      landing.remove();
    }
  }

  _label(key, number, color, count, checkerColor, target) {
    const who = nameOf(checkerColor);
    let where;
    if (key.startsWith('p')) where = `Point ${number}`;
    else if (key.startsWith('bar')) where = `${nameOf(color)} bar`;
    else where = `${nameOf(color)} tray`;
    const held =
      count === 0 ? 'empty' : `${count} ${who} checker${count === 1 ? '' : 's'}`;
    return `${where}, ${held}${target ? ', legal move' : ''}`;
  }

  _drawDice(dice) {
    if (!dice) {
      this.diceEl.replaceChildren();
      this.diceEl.classList.add('hidden');
      return;
    }
    this.diceEl.classList.remove('hidden');
    this.diceEl.dataset.color = dice.color;
    const faces = dice.values.map((value, i) => {
      const die = document.createElement('span');
      die.className = `die face-${value}`;
      die.classList.toggle('spent', !!dice.used[i]);
      for (let pip = 0; pip < value; pip++) die.appendChild(document.createElement('i'));
      return die;
    });
    this.diceEl.replaceChildren(...faces);
  }

  /* ---------------------------------------------------------------- */
  /* Dragging                                                          */
  /* ---------------------------------------------------------------- */

  /** Abandon a drag in progress without treating it as a drop. */
  cancelDrag() {
    this._endDrag(null, true);
  }

  /** Begin dragging the outermost checker on `slot`, following the pointer. */
  startDrag(slot, event) {
    this._endDrag(null, true);
    const checker = this._topChecker(slot);
    if (!checker) return;
    const rect = checker.getBoundingClientRect();
    const ghost = checker.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.appendChild(ghost);
    checker.classList.add('drag-origin');
    this._drag = {
      from: slot,
      // A drag belongs to the contact that started it. On a touch screen a
      // second finger (or a resting thumb) reports its own pointerId, and
      // without this every later event would be taken for this one's.
      pointerId: event.pointerId,
      ghost,
      checker,
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
    if (!this._drag || e.pointerId !== this._drag.pointerId || e.button > 0) return;
    this._endDrag(this._slotFromPoint(e.clientX, e.clientY), false);
  }

  _onPointerCancel(e) {
    if (!this._drag || e.pointerId !== this._drag.pointerId) return;
    this._endDrag(null, true);
  }

  _endDrag(to, silent) {
    if (!this._drag) return;
    const { from, ghost, checker, moved } = this._drag;
    ghost.remove();
    checker.classList.remove('drag-origin');
    this._drag = null;
    if (!silent) this.handlers.onDrop(from, to, moved);
  }

  /**
   * Which slot is under the pointer. Asking the document rather than doing the
   * arithmetic keeps this honest about a board whose columns are not all the
   * same width, and the ghost cannot get in the way — it is pointer-inert.
   */
  _slotFromPoint(x, y) {
    const key = keyOf(document.elementFromPoint(x, y));
    return key === null ? null : this._numberFor(key);
  }

  /**
   * The engine number a slot element stands for, or null when it is the wrong
   * end of the board for whoever is moving. Without that guard, dropping a
   * White checker on Black's bar would read as the number 0 — which for White
   * means "borne off".
   */
  _numberFor(key) {
    if (key.startsWith('p')) return this.slotNumbers.get(key);
    const side = this.mover === this.bottom ? 'bottom' : 'top';
    return key.endsWith(`-${side}`) ? this.slotNumbers.get(key) : null;
  }

  /** The element holding `slot` for the colour currently moving. */
  _slotEl(slot) {
    if (slot >= 1 && slot <= 24) {
      return this.slotEls.get(`p${this.bottom === 'w' ? slot : 25 - slot}`);
    }
    const side = this.mover === this.bottom ? 'bottom' : 'top';
    return this.slotEls.get(slot === BAR[this.mover] ? `bar-${side}` : `off-${side}`);
  }

  /** The checker a player would pick up from `slot`: the outermost one. */
  _topChecker(slot) {
    const el = this._slotEl(slot);
    const checkers = el ? el.querySelectorAll('.checker, .borne') : [];
    return checkers.length ? checkers[checkers.length - 1] : null;
  }

  /* ---------------------------------------------------------------- */
  /* Animation                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Play a turn out on screen, one checker at a time.
   *
   * Each step carries its own `draw`, which the controller uses to put the
   * board into the position *after* that move. The trick is the order: the
   * checker's starting rectangle is measured first, the board is redrawn, and
   * the checker that has just appeared at the far end is measured too — so the
   * flight lands exactly where the checker belongs rather than at the middle
   * of a slot, however deep the stack it joins.
   *
   * @param {{from: number, to: number, draw: () => void}[]} steps
   * @param {() => void} done
   * @param {string} color whose end of the board these moves belong to
   */
  animatePlay(steps, done, color = this.mover) {
    this.mover = color;
    if (REDUCED_MOTION.matches || steps.length === 0) {
      for (const step of steps) step.draw();
      done();
      return;
    }
    let index = 0;
    const next = () => {
      if (index >= steps.length) {
        done();
        return;
      }
      this._flyOne(steps[index++], next);
    };
    next();
  }

  _flyOne(step, done) {
    const source = this._topChecker(step.from);
    const a = source ? source.getBoundingClientRect() : null;
    step.draw();
    const landed = this._topChecker(step.to);
    const b = landed ? landed.getBoundingClientRect() : null;
    if (!a || !b) {
      done();
      return;
    }
    const ghost = landed.cloneNode(true);
    ghost.classList.add('drag-ghost', 'flying');
    ghost.style.width = `${b.width}px`;
    ghost.style.height = `${b.height}px`;
    ghost.style.left = `${a.left}px`;
    ghost.style.top = `${a.top}px`;
    document.body.appendChild(ghost);
    landed.style.visibility = 'hidden';
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      ghost.remove();
      landed.style.visibility = '';
      done();
    };
    requestAnimationFrame(() => {
      ghost.style.transition = `transform ${MOVE_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1)`;
      ghost.style.transform = `translate(${b.left - a.left}px, ${b.top - a.top}px)`;
    });
    ghost.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, MOVE_MS + 120);
  }
}

/** The slot key an event target belongs to, or null. */
function keyOf(target) {
  const el = target instanceof Element ? target.closest('.slot[data-key]') : null;
  return el ? el.dataset.key : null;
}

export const nameOf = (color) => (color === 'w' ? 'White' : 'Black');

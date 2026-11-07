/**
 * The rules engine for American checkers: board position, whole-turn move
 * generation, and game endings.
 *
 * The invariant that shapes this module: the engine deals only in complete
 * turns, never a partial jump sequence. A multi-jump capture is generated,
 * applied, and undone as a single Move carrying a full path from origin to
 * final landing square — never as several moves chained together by a caller.
 */

import { STEPS, JUMPS, DIRS_BLACK, DIRS_WHITE, DIRS_KING, isCrowningSquare } from './geometry.js';

export const START_FEN =
  'B:W21,22,23,24,25,26,27,28,29,30,31,32:B1,2,3,4,5,6,7,8,9,10,11,12';

export const colorOf = (piece) => (piece === 'b' || piece === 'B' ? 'b' : 'w');
export const isKing = (piece) => piece === 'B' || piece === 'W';

export class Checkers {
  constructor(fen = START_FEN) {
    this.load(fen);
  }

  load(fen) {
    const parts = String(fen).split(':');
    if (parts.length !== 3) throw new Error(`Bad FEN: ${fen}`);
    const turn = parts[0].toUpperCase();
    if (turn !== 'B' && turn !== 'W') throw new Error(`Bad FEN side: ${parts[0]}`);
    const board = new Array(33).fill(null);
    for (const group of parts.slice(1)) {
      const color = group[0].toUpperCase();
      if (color !== 'B' && color !== 'W') throw new Error(`Bad FEN group: ${group}`);
      const body = group.slice(1);
      if (!body) continue;
      for (const entry of body.split(',')) {
        const king = entry[0].toUpperCase() === 'K';
        const num = Number(king ? entry.slice(1) : entry);
        if (!Number.isInteger(num) || num < 1 || num > 32) {
          throw new Error(`Bad FEN square: ${entry}`);
        }
        const letter = color === 'B' ? 'b' : 'w';
        board[num] = king ? letter.toUpperCase() : letter;
      }
    }
    this._board = board;
    this._turn = turn === 'B' ? 'b' : 'w';
    this._history = [];
    this._quietPlies = 0;      // Task 5: the 40-move counter
    this._positions = new Map(); // Task 5: repetition counts
    this._countPosition();
  }

  reset() {
    this.load(START_FEN);
  }

  fen() {
    const group = (color) => {
      const squares = [];
      for (let n = 1; n <= 32; n++) {
        const piece = this._board[n];
        if (piece && colorOf(piece) === color) {
          squares.push(isKing(piece) ? `K${n}` : String(n));
        }
      }
      return (color === 'w' ? 'W' : 'B') + squares.join(',');
    };
    return `${this._turn === 'b' ? 'B' : 'W'}:${group('w')}:${group('b')}`;
  }

  turn() { return this._turn; }
  board() { return this._board.slice(); }
  get(square) { return this._board[square] ?? null; }

  /** Directions a piece may travel, by its letter. */
  _dirsFor(piece) {
    if (isKing(piece)) return DIRS_KING;
    return colorOf(piece) === 'b' ? DIRS_BLACK : DIRS_WHITE;
  }

  /**
   * Every legal turn for the side to move. Capture is mandatory, so a jump
   * anywhere on the board suppresses every quiet move.
   */
  moves({ square = null } = {}) {
    const color = this._turn;
    const jumps = [];
    for (let from = 1; from <= 32; from++) {
      const piece = this._board[from];
      if (!piece || colorOf(piece) !== color) continue;
      this._collectJumps(from, piece, [from], [], jumps);
    }
    const all = jumps.length ? jumps : this._quietMoves(color);
    return square === null ? all : all.filter((m) => m.path[0] === square);
  }

  /**
   * Is the side to move obliged to jump? Asked at every node of the AI's
   * quiescence search, so it stops at the first jump it finds rather than
   * building every capture sequence on the board the way moves() would.
   */
  mustCapture() {
    const color = this._turn;
    for (let from = 1; from <= 32; from++) {
      const piece = this._board[from];
      if (!piece || colorOf(piece) !== color) continue;
      for (const dir of this._dirsFor(piece)) {
        const jump = JUMPS[from][dir];
        if (!jump) continue;
        const target = this._board[jump.over];
        if (target && colorOf(target) !== color && !this._board[jump.land]) return true;
      }
    }
    return false;
  }

  _quietMoves(color) {
    const out = [];
    for (let from = 1; from <= 32; from++) {
      const piece = this._board[from];
      if (!piece || colorOf(piece) !== color) continue;
      for (const dir of this._dirsFor(piece)) {
        const to = STEPS[from][dir];
        if (!to || this._board[to]) continue;
        out.push(this._buildMove(color, [from, to], [], !isKing(piece) && isCrowningSquare(to, color)));
      }
    }
    return out;
  }

  /**
   * Depth-first walk of a jump sequence. The jumped piece is lifted for the
   * duration of the recursion so it cannot be taken twice, and the moving
   * piece is lifted from its origin so it cannot block its own landing square.
   * Crowning ends the turn, so a man that reaches the far row stops here even
   * with another jump available.
   */
  _collectJumps(from, piece, path, captured, out) {
    const color = colorOf(piece);
    for (const dir of this._dirsFor(piece)) {
      const jump = JUMPS[from][dir];
      if (!jump) continue;
      const target = this._board[jump.over];
      if (!target || colorOf(target) === color) continue;
      if (this._board[jump.land]) continue;
      const crowns = !isKing(piece) && isCrowningSquare(jump.land, color);
      this._board[jump.over] = null;
      const origin = this._board[from];
      this._board[from] = null;
      const nextPath = [...path, jump.land];
      const nextCaptured = [...captured, jump.over];
      if (crowns) {
        out.push(this._buildMove(color, nextPath, nextCaptured, true));
      } else {
        const before = out.length;
        this._collectJumps(jump.land, piece, nextPath, nextCaptured, out);
        if (out.length === before) {
          out.push(this._buildMove(color, nextPath, nextCaptured, false));
        }
      }
      this._board[from] = origin;
      this._board[jump.over] = target;
    }
  }

  /** Build a Move record. Named apart from `move()`, which applies one. */
  _buildMove(color, path, captured, crowned) {
    return {
      color,
      path,
      captured,
      crowned,
      pdn: path.join(captured.length ? 'x' : '-'),
    };
  }

  move({ path } = {}) {
    if (!Array.isArray(path) || path.length < 2) return null;
    const legal = this.moves().find(
      (m) => m.path.length === path.length && m.path.every((sq, i) => sq === path[i]),
    );
    if (!legal) return null;
    const from = legal.path[0];
    const to = legal.path[legal.path.length - 1];
    const piece = this._board[from];
    const undo = {
      move: legal,
      piece,
      taken: legal.captured.map((sq) => this._board[sq]),
      quietPlies: this._quietPlies,
    };
    this._board[from] = null;
    for (const sq of legal.captured) this._board[sq] = null;
    this._board[to] = legal.crowned ? piece.toUpperCase() : piece;
    // The 40-move rule counts turns in which nothing irreversible happened:
    // no capture, and no man moved (only kings shuffling).
    this._quietPlies =
      legal.captured.length || !isKing(piece) ? 0 : this._quietPlies + 1;
    this._turn = this._turn === 'b' ? 'w' : 'b';
    this._history.push(undo);
    this._countPosition();
    return legal;
  }

  undo() {
    const undo = this._history.pop();
    if (!undo) return null;
    this._discountPosition();
    const { move, piece, taken } = undo;
    const to = move.path[move.path.length - 1];
    this._board[to] = null;
    this._board[move.path[0]] = piece;
    move.captured.forEach((sq, i) => {
      this._board[sq] = taken[i];
    });
    this._quietPlies = undo.quietPlies;
    this._turn = move.color;
    return move;
  }

  history() {
    return this._history.map((entry) => entry.move);
  }

  lastMove() {
    const entry = this._history[this._history.length - 1];
    return entry ? entry.move : null;
  }

  /**
   * The board as it would look partway through a jump sequence. Read-only and
   * used for rendering alone: the engine's own position does not advance until
   * the whole turn is applied, so the controller needs this to draw a chain in
   * progress. An unrecognized path simply returns the current board.
   */
  preview(path) {
    const board = this._board.slice();
    if (!Array.isArray(path) || path.length < 2) return board;
    const piece = board[path[0]];
    if (!piece) return board;
    const color = colorOf(piece);
    board[path[0]] = null;
    let crowned = false;
    for (let i = 1; i < path.length; i++) {
      const from = path[i - 1];
      const to = path[i];
      for (const dir of DIRS_KING) {
        const jump = JUMPS[from][dir];
        if (jump && jump.land === to) board[jump.over] = null;
      }
      if (!isKing(piece) && isCrowningSquare(to, color)) crowned = true;
    }
    board[path[path.length - 1]] = crowned ? piece.toUpperCase() : piece;
    return board;
  }

  _positionKey() {
    return `${this._turn}${this._board.slice(1).map((p) => p || '-').join('')}`;
  }

  _countPosition() {
    const key = this._positionKey();
    this._positions.set(key, (this._positions.get(key) || 0) + 1);
  }

  _discountPosition() {
    const key = this._positionKey();
    const count = this._positions.get(key) || 0;
    if (count <= 1) this._positions.delete(key);
    else this._positions.set(key, count - 1);
  }

  isThreefoldRepetition() {
    return (this._positions.get(this._positionKey()) || 0) >= 3;
  }

  isFortyMoveRule() {
    return this._quietPlies >= 80;
  }

  isDraw() {
    return this.isThreefoldRepetition() || this.isFortyMoveRule();
  }

  isGameOver() {
    return this.isDraw() || this.moves().length === 0;
  }

  /**
   * How the game stands. A side with no legal move loses — checkers has no
   * stalemate, and a side with no pieces has no move either, so both losses
   * come out of the same test.
   */
  status() {
    const turn = this._turn;
    const mustCapture = this.mustCapture();
    if (this.isThreefoldRepetition()) {
      return { over: true, turn, result: '1/2-1/2', reason: 'threefold repetition', mustCapture };
    }
    if (this.isFortyMoveRule()) {
      return { over: true, turn, result: '1/2-1/2', reason: '40-move rule', mustCapture };
    }
    if (this.moves().length === 0) {
      // The side to move has lost; the first score in the token is White's.
      return {
        over: true,
        turn,
        result: turn === 'b' ? '1-0' : '0-1',
        reason: 'no moves',
        mustCapture: false,
      };
    }
    return { over: false, turn, result: '*', reason: null, mustCapture };
  }
}

/** Count the leaf nodes `depth` turns deep. Used to validate generation. */
export function perft(game, depth) {
  if (depth === 0) return 1;
  const moves = game.moves();
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const move of moves) {
    game.move({ path: move.path });
    nodes += perft(game, depth - 1);
    game.undo();
  }
  return nodes;
}

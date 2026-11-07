/**
 * Writing a game down: the standard backgammon move notation, and the `.mat`
 * match file every backgammon program reads.
 *
 * Backgammon has no PGN. What it has instead is the plain notation players
 * have always used at the board — `8/5`, `bar/20*`, `6/off` — and the Jellyfish
 * `.mat` transcript, which is that notation laid out in two columns with the
 * dice in front of each turn. Both are written here; nothing in this file
 * touches the DOM or the engine.
 */

import { BAR, OFF } from '../engine/backgammon.js';

/** `.mat` wraps nothing, but the two columns are laid out on a fixed grid. */
const COLUMN_WIDTH = 30;

/** How a single point is written: the bar and the tray have names, not numbers. */
function pointName(color, p) {
  if (p === BAR[color]) return 'bar';
  if (p === OFF[color]) return 'off';
  return String(p);
}

/**
 * The moves of one turn, in the notation a player would speak.
 *
 * Two things happen here, both of them what a human writing the game down
 * would do without thinking about it:
 *
 *  - **A checker moved twice is written once.** `24/18 18/13` is one checker
 *    going from 24 to 13, so it reads `24/13`. The middle point is kept only
 *    when something happened there — "bar/22 star slash 17" says a checker
 *    was hit on the way past, which `bar/17` would lose. (Spelled out because
 *    the notation for it would end this comment.)
 *  - **Two checkers doing the same thing are counted.** `8/5 8/5` is
 *    `8/5(2)`.
 */
export function movesNotation(color, moves) {
  const chains = [];
  for (const move of moves) {
    // Only a *consecutive* pair can be the same checker: the moves arrive in
    // the order they were played, and anything in between belongs to another
    // checker, whose move would then be written out of sequence.
    const last = chains[chains.length - 1];
    if (last && last.to === move.from && last.to !== OFF[color]) {
      if (last.hit) last.via.push(`${pointName(color, last.to)}*`);
      last.to = move.to;
      last.hit = move.hit;
      continue;
    }
    chains.push({ from: move.from, to: move.to, hit: move.hit, via: [] });
  }
  const parts = [];
  for (const chain of chains) {
    const text = [
      pointName(color, chain.from),
      ...chain.via,
      `${pointName(color, chain.to)}${chain.hit ? '*' : ''}`,
    ].join('/');
    const previous = parts.find((p) => p.text === text);
    if (previous) previous.count += 1;
    else parts.push({ text, count: 1 });
  }
  return parts.map((p) => (p.count > 1 ? `${p.text}(${p.count})` : p.text)).join(' ');
}

/** The dice in front of a turn: `31`, `66`. Order is high die first. */
export function rollNotation(roll) {
  const [a, b] = roll;
  return a >= b ? `${a}${b}` : `${b}${a}`;
}

/** One history entry as a single cell of the transcript. */
export function entryNotation(entry) {
  switch (entry.kind) {
    case 'move': {
      const moves = movesNotation(entry.color, entry.moves);
      // A turn with no legal play still happened, and a reader who cannot see
      // the board needs to be told why the dice changed hands.
      return `${rollNotation(entry.roll)}: ${moves || '(no play)'}`;
    }
    case 'double':
      return ` Doubles => ${entry.to}`;
    case 'take':
      return ' Takes';
    case 'drop':
      return ' Drops';
    case 'resign':
      return ` Resigns ${entry.multiplier}`;
    default:
      return '';
  }
}

/** How a finished game is described in the file's last line. */
function winLine(result) {
  if (!result || !result.winner) return null;
  const points = result.points;
  return `      Wins ${points} point${points === 1 ? '' : 's'}`;
}

const pad = (text) => text + ' '.repeat(Math.max(1, COLUMN_WIDTH - text.length));

/**
 * Build a `.mat` transcript of one game.
 *
 * The header says `0 point match`, which is how the format spells money play —
 * a single game with a live cube rather than a race to a target score. That is
 * what this app plays, so it is what it writes.
 *
 * @param {{
 *   history: object[],                  the engine's history, oldest first
 *   white: string, black: string,       player names
 *   result: {winner: string, points: number}|null,
 *   date: Date,
 *   control?: {initial: number, increment: number}|null,
 * }} game
 */
export function buildMat({
  history,
  white,
  black,
  result,
  date,
  control = null,
  site = 'backgammon.puter.com',
}) {
  const lines = [
    `; [Site "${clean(site)}"]`,
    `; [Date "${matDate(date)}"]`,
    `; [Variation "Backgammon"]`,
  ];
  if (control) {
    const seconds = Math.round(control.initial / 1000);
    const increment = Math.round(control.increment / 1000);
    lines.push(`; [TimeControl "${seconds}+${increment}"]`);
  }
  lines.push('', '0 point match', '', ' Game 1', ` ${pad(clean(white))}${clean(black)}`);

  const rows = [];
  for (const entry of history) {
    const column = entry.color === 'w' ? 0 : 1;
    let row = rows[rows.length - 1];
    if (!row || row[column] !== null) {
      row = [null, null];
      rows.push(row);
    }
    row[column] = entryNotation(entry);
  }
  rows.forEach((row, i) => {
    const number = `${String(i + 1).padStart(3, ' ')}) `;
    lines.push(`${number}${pad(row[0] || '')}${row[1] || ''}`.trimEnd());
  });

  const win = winLine(result);
  if (win) lines.push(win);
  return `${lines.join('\n')}\n`;
}

/** Tag values are quoted; names come off the wire, so cap and strip them. */
function clean(value) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/["\\]/g, '')
    .trim()
    .slice(0, 28);
}

/** `YYYY.MM.DD` in local time. */
export function matDate(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}.${p(date.getMonth() + 1)}.${p(date.getDate())}`;
}

/** A filesystem-safe name for a downloaded game. */
export function matFilename(date) {
  const p = (n) => String(n).padStart(2, '0');
  return [
    'backgammon-',
    date.getFullYear(),
    p(date.getMonth() + 1),
    p(date.getDate()),
    '-',
    p(date.getHours()),
    p(date.getMinutes()),
    '.mat',
  ].join('');
}

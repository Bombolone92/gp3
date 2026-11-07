/**
 * PDN export (Portable Draughts Notation, the format every draughts program
 * reads). Checkers' counterpart to chess's PGN.
 *
 * A tag pair section carrying the mandatory seven-tag roster — with Black
 * before White, since Black moves first in checkers — plus PDN's own
 * GameType tag, then the moves with the result as the final token. Nothing
 * here touches the DOM or the engine: it takes the PDN move list the move
 * log already holds, plus whatever the app knows about the players and how
 * the game ended.
 */

/** PDN wraps movetext at 80 columns; long lines are legal but discourteous. */
const LINE_WIDTH = 80;

/**
 * PDN's code for the game being recorded. 8x8 English draughts — the ruleset
 * this app implements (men that cannot fly, kings that move one square at a
 * time) — has its own number, distinct from International draughts on 10x10
 * (20) and from American pool checkers (23), a different flying-capture
 * variant that happens to share the same board size.
 *
 * Wieger Wesselink, "PDN 3.0 Standard — GameType tag":
 * https://wiegerw.github.io/pdn/gametype.html — type 21 is listed as
 * "English draughts", full spec `[GameType "21,B,8,8,N1,0"]`.
 */
const GAME_TYPE = '21';

/**
 * Tag values are quoted strings in which `"` and `\` must be escaped, and
 * which cannot contain newlines. Opponent names come off the wire, so this
 * also caps the length rather than trusting it.
 */
function tagValue(value) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 120)
    .replace(/[\\"]/g, (ch) => `\\${ch}`);
}

/** `YYYY.MM.DD` in local time, the PDN date format. */
export function pdnDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

/** PDN's TimeControl tag: seconds+increment, or "-" for an untimed game. */
function timeControlTag(control) {
  if (!control) return '-';
  return `${Math.round(control.initial / 1000)}+${Math.round(control.increment / 1000)}`;
}

/** `1. 11-15 23-19 2. 8-11` … wrapped at LINE_WIDTH, with the result appended. */
function movetext(moves, result) {
  const tokens = [];
  moves.forEach((move, i) => {
    if (i % 2 === 0) tokens.push(`${i / 2 + 1}.`);
    tokens.push(move);
  });
  tokens.push(result);

  const lines = [];
  let line = '';
  for (const token of tokens) {
    if (line && line.length + 1 + token.length > LINE_WIDTH) {
      lines.push(line);
      line = token;
    } else {
      line = line ? `${line} ${token}` : token;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

/**
 * Build a complete PDN game.
 *
 * @param {{
 *   moves: string[],                moves in PDN notation ('11-15', '23x14x5')
 *   result: string,                 "1-0" | "0-1" | "1/2-1/2" | "*"
 *   black: string, white: string,   player names
 *   date: Date,
 *   control?: {initial: number, increment: number}|null,
 *   termination?: string,           PDN Termination, omitted when "normal"
 *   event?: string, site?: string,
 * }} game
 */
export function buildPdn({
  moves,
  result,
  black,
  white,
  date,
  control = null,
  termination = 'normal',
  event = 'Casual game',
  site = 'checkers.puter.com',
}) {
  const tags = [
    ['Event', event],
    ['Site', site],
    ['Date', pdnDate(date)],
    ['Round', '-'],
    ['Black', black],
    ['White', white],
    ['Result', result],
    ['GameType', GAME_TYPE],
    ['TimeControl', timeControlTag(control)],
  ];
  // Termination is optional and "normal" is the default reading, so only a
  // game that ended some other way is worth spelling out.
  if (termination && termination !== 'normal') tags.push(['Termination', termination]);

  const header = tags.map(([key, value]) => `[${key} "${tagValue(value)}"]`).join('\n');
  return `${header}\n\n${movetext(moves, result)}\n`;
}

/** A filesystem-safe name for a downloaded game. */
export function pdnFilename(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return [
    'checkers-',
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    '.pdn',
  ].join('');
}

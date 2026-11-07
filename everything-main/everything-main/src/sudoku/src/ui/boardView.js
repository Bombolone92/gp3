/**
 * The board's DOM.
 *
 * Built once and then patched. Every render walks all 81 cells and assigns
 * classes and text: cheap at this size, and it means there is one code path
 * for "draw the board" rather than a set of incremental updates that can drift
 * out of step with the game state.
 *
 * Two things are deliberate. Cells carry the ARIA grid pattern (rows, column
 * indices, one roving tabindex) so a keyboard or screen-reader user navigates
 * the grid as a grid rather than as 81 loose buttons. And the value and the
 * pencil marks are separate child elements, always present, so switching
 * between them never inserts or removes a node, which is what would make the
 * digits jump.
 */

import { PEERS, SIZE, colOf, digitsOf, rowOf } from '../engine/grid.js';

const DIGIT_LABEL = ['empty', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function createBoardView(root, { onSelect }) {
  const cells = [];

  for (let r = 0; r < SIZE; r++) {
    const row = document.createElement('div');
    row.className = 'board-row';
    row.setAttribute('role', 'row');
    row.setAttribute('aria-rowindex', String(r + 1));

    for (let c = 0; c < SIZE; c++) {
      const index = r * SIZE + c;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-colindex', String(c + 1));
      // One cell in the grid is tabbable at a time; arrow keys move it. Without
      // this, tabbing through the page means 81 stops.
      cell.tabIndex = -1;
      cell.dataset.index = String(index);

      const value = document.createElement('span');
      value.className = 'cell-value';

      const notes = document.createElement('span');
      notes.className = 'cell-notes';
      notes.hidden = true;
      const noteSpans = [];
      for (let d = 1; d <= 9; d++) {
        const mark = document.createElement('span');
        noteSpans.push(mark);
        notes.append(mark);
      }

      cell.append(value, notes);
      row.append(cell);
      cells.push({ el: cell, value, notes, noteSpans, index });
    }
    root.append(row);
  }

  root.addEventListener('click', (event) => {
    const cell = event.target.closest('.cell');
    if (cell) onSelect(Number(cell.dataset.index));
  });

  /**
   * Draw `game` in the given view state.
   *
   * @param {object} game
   * @param {object} view
   * @param {number|null} view.selected Focused cell, or null.
   * @param {boolean} view.highlightPeers Wash the selected cell's row/column/box.
   * @param {boolean} view.highlightSame Pick out every copy of the selected digit.
   * @param {Set<number>} view.wrong Cells whose digit contradicts the solution.
   * @param {Set<number>} view.conflicts Cells whose digit repeats a peer's.
   * @param {Set<number>} view.hintFocus Cells the current hint is reading.
   * @param {number|null} view.hintTarget The cell the current hint concludes about.
   */
  function render(game, view) {
    const { selected } = view;
    const selectedDigit = selected === null ? 0 : game.values[selected];
    const peerSet = selected === null || !view.highlightPeers ? null : new Set(PEERS[selected]);

    for (const cell of cells) {
      const i = cell.index;
      const digit = game.values[i];
      const given = game.puzzle[i] !== 0;
      const noteMask = digit ? 0 : game.notes[i];

      // Class list assembled in one string: one style recalculation per cell,
      // and no chance of a stale class surviving a re-render.
      let className = 'cell';
      if (given) className += ' given';
      if (peerSet?.has(i)) className += ' peer';
      if (view.highlightSame && selectedDigit && digit === selectedDigit && i !== selected) {
        className += ' same';
      }
      if (view.hintFocus.has(i)) className += ' hint';
      if (view.conflicts.has(i)) className += ' conflict';
      if (view.wrong.has(i)) className += ' wrong';
      if (i === selected) className += ' selected';
      if (i === view.hintTarget) className += ' hint-target';
      if (cell.el.className !== className) cell.el.className = className;

      const text = digit ? String(digit) : '';
      if (cell.value.textContent !== text) cell.value.textContent = text;

      const showNotes = noteMask !== 0;
      if (cell.notes.hidden === showNotes) cell.notes.hidden = !showNotes;
      if (showNotes) {
        const marks = digitsOf(noteMask);
        for (let d = 1; d <= 9; d++) {
          const span = cell.noteSpans[d - 1];
          const shown = marks.includes(d) ? String(d) : '';
          if (span.textContent !== shown) span.textContent = shown;
          const highlight = shown !== '' && d === selectedDigit;
          span.classList.toggle('note-same', highlight);
        }
      }

      const tabbable = i === selected || (selected === null && i === 0);
      cell.el.tabIndex = tabbable ? 0 : -1;
      cell.el.setAttribute('aria-selected', i === selected ? 'true' : 'false');
      cell.el.setAttribute('aria-label', labelFor(i, digit, given, noteMask, view));
      // Clues are not editable, and saying so is more use than a disabled
      // button that cannot be selected to highlight its digit.
      cell.el.setAttribute('aria-readonly', given ? 'true' : 'false');
    }
  }

  function labelFor(i, digit, given, noteMask, view) {
    const where = `row ${rowOf(i) + 1}, column ${colOf(i) + 1}`;
    if (digit) {
      const kind = given ? 'clue' : view.wrong.has(i) ? 'wrong' : 'your entry';
      // A duplicate is drawn as a red wash and nothing else, so leaving it out
      // of the name would be the one thing on this board said in colour alone.
      // It is reported on both cells involved, the clue among them, which is
      // what tells a player which digit theirs is clashing with.
      const clash = view.conflicts.has(i) ? ', duplicate' : '';
      return `${where}, ${digit}, ${kind}${clash}`;
    }
    if (noteMask) return `${where}, pencil marks ${digitsOf(noteMask).join(', ')}`;
    return `${where}, ${DIGIT_LABEL[0]}`;
  }

  /** Move focus to the cell the roving tabindex is on. */
  function focusCell(index) {
    cells[index]?.el.focus();
  }

  return { render, focusCell, cells };
}

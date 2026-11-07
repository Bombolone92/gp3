// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PEERS, indexOf } from '../src/engine/grid.js';
import { generate } from '../src/engine/generator.js';
import { createGame, setValue, toggleNote } from '../src/game/state.js';
import { createBoardView } from '../src/ui/boardView.js';

const { puzzle, solution } = generate({ difficulty: 'medium', seed: 'boardview-tests' });

/** The view state the app passes in, with everything switched on. */
const view = (overrides = {}) => ({
  selected: null,
  highlightPeers: true,
  highlightSame: true,
  wrong: new Set(),
  conflicts: new Set(),
  hintFocus: new Set(),
  hintTarget: null,
  ...overrides,
});

let root;
let board;
let game;
let onSelect;

beforeEach(() => {
  document.body.innerHTML = '<div id="board" role="grid"></div>';
  root = document.getElementById('board');
  onSelect = vi.fn();
  board = createBoardView(root, { onSelect });
  game = createGame({ puzzle, solution, difficulty: 'medium' });
});

const cellAt = (index) => root.querySelectorAll('.cell')[index];
const firstEmpty = () => [...game.values].findIndex((v) => v === 0);
const firstGiven = () => [...game.puzzle].findIndex((v) => v !== 0);

describe('structure', () => {
  it('builds nine rows of nine cells', () => {
    expect(root.querySelectorAll('.board-row')).toHaveLength(9);
    expect(root.querySelectorAll('.cell')).toHaveLength(81);
  });

  it('carries the ARIA grid pattern, so the grid reads as a grid', () => {
    const rows = root.querySelectorAll('.board-row');
    expect(rows[0].getAttribute('role')).toBe('row');
    expect(rows[3].getAttribute('aria-rowindex')).toBe('4');
    expect(cellAt(0).getAttribute('role')).toBe('gridcell');
    expect(cellAt(5).getAttribute('aria-colindex')).toBe('6');
  });

  it('reports the cell that was clicked', () => {
    cellAt(42).click();
    expect(onSelect).toHaveBeenCalledWith(42);
  });

  it('reports a click that lands on a cell’s inner element', () => {
    // Taps often land on the digit or the pencil marks rather than the button.
    cellAt(7).querySelector('.cell-value').click();
    expect(onSelect).toHaveBeenCalledWith(7);
  });

  it('ignores a click on the gap between cells', () => {
    root.click();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('digits', () => {
  it('shows clues, marked as clues and not editable', () => {
    board.render(game, view());
    const given = firstGiven();
    expect(cellAt(given).textContent).toContain(String(game.puzzle[given]));
    expect(cellAt(given).classList.contains('given')).toBe(true);
    expect(cellAt(given).getAttribute('aria-readonly')).toBe('true');
    expect(cellAt(given).getAttribute('aria-label')).toContain('clue');
  });

  it('shows a player’s entry differently from a clue', () => {
    const cell = firstEmpty();
    setValue(game, cell, solution[cell]);
    board.render(game, view());
    expect(cellAt(cell).classList.contains('given')).toBe(false);
    expect(cellAt(cell).getAttribute('aria-readonly')).toBe('false');
    expect(cellAt(cell).getAttribute('aria-label')).toContain('your entry');
  });

  it('names an empty cell by its position', () => {
    board.render(game, view());
    expect(cellAt(indexOf(2, 3)).getAttribute('aria-label')).toContain('row 3, column 4');
  });

  it('clears a digit from the DOM when the cell is emptied', () => {
    const cell = firstEmpty();
    setValue(game, cell, 5);
    board.render(game, view());
    expect(cellAt(cell).textContent).toContain('5');
    game.values[cell] = 0;
    board.render(game, view());
    expect(cellAt(cell).querySelector('.cell-value').textContent).toBe('');
  });
});

describe('pencil marks', () => {
  it('hides the marks grid when there are none', () => {
    board.render(game, view());
    expect(cellAt(firstEmpty()).querySelector('.cell-notes').hidden).toBe(true);
  });

  it('shows each mark in its own fixed position', () => {
    const cell = firstEmpty();
    toggleNote(game, cell, 1);
    toggleNote(game, cell, 5);
    toggleNote(game, cell, 9);
    board.render(game, view());

    const marks = [...cellAt(cell).querySelectorAll('.cell-notes span')].map((s) => s.textContent);
    // A digit always sits in the same slot, which is what makes marks scannable.
    expect(marks).toEqual(['1', '', '', '', '5', '', '', '', '9']);
    expect(cellAt(cell).querySelector('.cell-notes').hidden).toBe(false);
  });

  it('lists the marks for a screen reader', () => {
    const cell = firstEmpty();
    toggleNote(game, cell, 4);
    toggleNote(game, cell, 7);
    board.render(game, view());
    expect(cellAt(cell).getAttribute('aria-label')).toContain('pencil marks 4, 7');
  });

  it('picks out the mark matching the selected digit', () => {
    const cell = firstEmpty();
    toggleNote(game, cell, 3);
    // A cell the marked one cannot see, so placing a 3 there does not tidy the
    // mark away before it can be highlighted.
    const elsewhere = [...Array(81).keys()].find(
      (i) => i !== cell && !game.values[i] && !PEERS[cell].includes(i),
    );
    setValue(game, elsewhere, 3);
    board.render(game, view({ selected: elsewhere }));

    const three = cellAt(cell).querySelectorAll('.cell-notes span')[2];
    expect(three.textContent).toBe('3');
    expect(three.classList.contains('note-same')).toBe(true);
  });

  it('hides the marks once a digit is entered', () => {
    const cell = firstEmpty();
    toggleNote(game, cell, 3);
    board.render(game, view());
    expect(cellAt(cell).querySelector('.cell-notes').hidden).toBe(false);
    setValue(game, cell, 5);
    board.render(game, view());
    expect(cellAt(cell).querySelector('.cell-notes').hidden).toBe(true);
  });
});

describe('highlighting', () => {
  it('marks the selected cell and moves the tabbable cell with it', () => {
    board.render(game, view({ selected: 40 }));
    expect(cellAt(40).classList.contains('selected')).toBe(true);
    expect(cellAt(40).getAttribute('aria-selected')).toBe('true');
    // Exactly one cell in the grid is tabbable, so Tab does not stop 81 times.
    const tabbable = [...root.querySelectorAll('.cell')].filter((c) => c.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toBe(cellAt(40));
  });

  it('washes the selected cell’s row, column and box', () => {
    board.render(game, view({ selected: 40 }));
    for (const peer of PEERS[40]) expect(cellAt(peer).classList.contains('peer')).toBe(true);
    expect(cellAt(0).classList.contains('peer')).toBe(false);
  });

  it('leaves peers alone when that setting is off', () => {
    board.render(game, view({ selected: 40, highlightPeers: false }));
    expect(cellAt(PEERS[40][0]).classList.contains('peer')).toBe(false);
  });

  it('picks out other cells holding the selected digit', () => {
    const digit = game.values[firstGiven()];
    const others = [...Array(81).keys()].filter(
      (i) => game.values[i] === digit && i !== firstGiven(),
    );
    board.render(game, view({ selected: firstGiven() }));
    for (const other of others) expect(cellAt(other).classList.contains('same')).toBe(true);
    // Never the selected cell itself: it already reads as selected.
    expect(cellAt(firstGiven()).classList.contains('same')).toBe(false);
  });

  it('marks a wrong digit and says so in its label', () => {
    const cell = firstEmpty();
    setValue(game, cell, (solution[cell] % 9) + 1);
    board.render(game, view({ wrong: new Set([cell]) }));
    expect(cellAt(cell).classList.contains('wrong')).toBe(true);
    expect(cellAt(cell).getAttribute('aria-label')).toContain('wrong');
  });

  it('marks a rule-breaking duplicate', () => {
    board.render(game, view({ conflicts: new Set([3, 7]) }));
    expect(cellAt(3).classList.contains('conflict')).toBe(true);
    expect(cellAt(7).classList.contains('conflict')).toBe(true);
  });

  it('says a duplicate in its label, since the wash is the only other sign', () => {
    const cell = firstEmpty();
    setValue(game, cell, (solution[cell] % 9) + 1);
    board.render(game, view({ conflicts: new Set([cell]) }));
    expect(cellAt(cell).getAttribute('aria-label')).toContain('duplicate');
  });

  it('says it on the clue involved too, so the clash can be found', () => {
    board.render(game, view({ conflicts: new Set([firstGiven()]) }));
    const label = cellAt(firstGiven()).getAttribute('aria-label');
    expect(label).toContain('clue');
    expect(label).toContain('duplicate');
  });

  it('says nothing about a duplicate when there is none', () => {
    const cell = firstEmpty();
    setValue(game, cell, solution[cell]);
    board.render(game, view());
    expect(cellAt(cell).getAttribute('aria-label')).not.toContain('duplicate');
  });

  it('marks the cells a hint is reading and the one it concludes about', () => {
    board.render(game, view({ hintFocus: new Set([10, 11, 12]), hintTarget: 12 }));
    expect(cellAt(10).classList.contains('hint')).toBe(true);
    expect(cellAt(12).classList.contains('hint-target')).toBe(true);
    expect(cellAt(13).classList.contains('hint')).toBe(false);
  });

  it('drops a highlight once the state that caused it is gone', () => {
    board.render(game, view({ selected: 40, hintFocus: new Set([41]) }));
    expect(cellAt(41).classList.contains('hint')).toBe(true);
    board.render(game, view({ selected: 40 }));
    expect(cellAt(41).classList.contains('hint')).toBe(false);
    expect(cellAt(40).classList.contains('selected')).toBe(true);
  });

  it('renders with nothing selected', () => {
    expect(() => board.render(game, view({ selected: null }))).not.toThrow();
    expect(root.querySelectorAll('.cell.selected')).toHaveLength(0);
    // Something must stay reachable by Tab, or the grid cannot be entered.
    expect([...root.querySelectorAll('.cell')].filter((c) => c.tabIndex === 0)).toHaveLength(1);
  });
});

describe('focusCell', () => {
  it('moves focus to a cell', () => {
    board.render(game, view({ selected: 12 }));
    board.focusCell(12);
    expect(document.activeElement).toBe(cellAt(12));
  });

  it('ignores an index outside the grid', () => {
    expect(() => board.focusCell(999)).not.toThrow();
  });
});

/**
 * Keyboard movement over a picker's grids of buttons (special characters,
 * emoji). Each grid is one Tab stop; inside it the arrow keys step by one
 * or by a row, Home and End jump to the ends, and Up/Down at a grid's edge
 * move into the neighboring grid. Without this every one of hundreds of
 * characters was its own Tab stop.
 */

const GRID = '.symbol-grid';

const visible = (node) => !node.disabled && !node.closest('[hidden]');

/** The buttons of a grid that can take focus, in order. */
const items = (grid) => [...grid.querySelectorAll('button')].filter(visible);

/** How many buttons share the grid's first row; the layout decides, one when it is not laid out yet. */
function columnsOf(grid) {
  const buttons = items(grid);
  if (!buttons.length) return 1;
  const top = buttons[0].offsetTop;
  const wrap = buttons.findIndex((button) => button.offsetTop !== top);
  return wrap < 1 ? buttons.length : wrap;
}

/** One Tab stop per grid: the remembered (or first) button is tabbable, the rest are reached with the arrow keys. */
export function settleGridTabs(root) {
  for (const grid of root.querySelectorAll(GRID)) {
    const buttons = items(grid);
    const current = buttons.find((button) => button.dataset.gridCurrent === '') || buttons[0];
    for (const button of buttons) button.tabIndex = button === current ? 0 : -1;
  }
}

/** Wire the arrow keys and roving Tab stop on every grid under `root`, now and after re-renders (call `settleGridTabs` then). */
export function keyboardGrids(root) {
  settleGridTabs(root);
  root.addEventListener('focusin', (e) => {
    const button = e.target.closest(`${GRID} button`);
    if (!button || !root.contains(button)) return;
    const grid = button.closest(GRID);
    for (const other of grid.querySelectorAll('[data-grid-current]')) { delete other.dataset.gridCurrent; other.tabIndex = -1; }
    button.dataset.gridCurrent = ''; button.tabIndex = 0;
  });
  root.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const button = e.target.closest(`${GRID} button`);
    if (!button || !root.contains(button)) return;
    const grid = button.closest(GRID), buttons = items(grid), index = buttons.indexOf(button);
    if (index < 0) return;
    const grids = [...root.querySelectorAll(GRID)].filter((g) => items(g).length), at = grids.indexOf(grid);
    const columns = columnsOf(grid), column = index % columns;
    let next = null;
    if (e.key === 'ArrowRight') next = buttons[index + 1] || items(grids[at + 1] || grid)[0];
    else if (e.key === 'ArrowLeft') next = buttons[index - 1] || (at > 0 ? items(grids[at - 1]).at(-1) : null);
    else if (e.key === 'ArrowDown') {
      if (index + columns < buttons.length) next = buttons[index + columns];
      else if (grids[at + 1]) { const below = items(grids[at + 1]); next = below[Math.min(column, below.length - 1)]; }
    } else if (e.key === 'ArrowUp') {
      if (index - columns >= 0) next = buttons[index - columns];
      else if (at > 0) {
        const above = items(grids[at - 1]), aboveColumns = columnsOf(grids[at - 1]), lastRow = Math.floor((above.length - 1) / aboveColumns) * aboveColumns;
        next = above[Math.min(lastRow + column, above.length - 1)];
      }
    } else if (e.key === 'Home') next = e.shiftKey ? items(grids[0])[0] : buttons[0];
    else if (e.key === 'End') next = e.shiftKey ? items(grids.at(-1)).at(-1) : buttons.at(-1);
    else return;
    if (!next || next === button) { if (next) e.preventDefault(); return; }
    e.preventDefault();
    next.focus();
  });
}

/** The first button a picker's grids offer, for a search field's Enter or Down arrow. */
export function firstGridButton(root) {
  return [...root.querySelectorAll(`${GRID} button`)].find(visible) || null;
}

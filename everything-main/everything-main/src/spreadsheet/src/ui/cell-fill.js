import { fillColorCss } from '../core/fill-color.js';
/** A fill hides the cell's gridlines, including white, but No fill does not. */
export function paintCellFill(node, color, paper = null) {
  const paint = fillColorCss(color);
  const noFill = !paint || paint === 'transparent';
  node.style.backgroundColor = noFill && paper ? paper : paint;
  const bg = node.style.backgroundColor;
  const filled = !noFill && !!bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg);
  node.classList.toggle('filled', filled);
}

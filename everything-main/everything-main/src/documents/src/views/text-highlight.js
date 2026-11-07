import { openColorPalette } from '../ui/color-palette.js';
import { HIGHLIGHTS, highlightLabel } from '../engine/backgrounds.js';

const choices = [
  'yellow', 'green', 'cyan', 'magenta', 'blue', 'red', 'white', 'black',
  'darkYellow', 'darkGreen', 'darkCyan', 'darkMagenta', 'darkBlue', 'darkRed', 'lightGray', 'darkGray',
].map(value => ({ value, color: `#${HIGHLIGHTS[value]}`, label: highlightLabel(value) }));

export function openTextHighlight(value, apply, options) {
  return openColorPalette({ ...options, label: 'Text highlight', value, choices,
    reset: { value: 'none', label: 'No highlight' }, onPick: apply });
}

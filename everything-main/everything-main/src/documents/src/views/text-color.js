import { openColorPalette } from '../ui/color-palette.js';
import { COLOR_NAMES } from '../ui/colors.js';

// Neutral, vivid, pale, medium and dark rows keep related hues in columns.
export const TEXT_COLORS = [
  '000000', '434343', '666666', '999999', 'b7b7b7', 'cccccc', 'efefef', 'ffffff',
  'ff0000', 'ff9900', 'ffff00', '00ff00', '00ffff', '0000ff', '9900ff', 'ff00ff',
  'f4cccc', 'fce5cd', 'fff2cc', 'd9ead3', 'd0e0e3', 'cfe2f3', 'd9d2e9', 'ead1dc',
  'e06666', 'f6b26b', 'ffd966', '93c47d', '76a5af', '6fa8dc', '8e7cc3', 'c27ba0',
  'cc0000', 'e69138', 'f1c232', '6aa84f', '45818e', '3d85c6', '674ea7', 'a64d79',
  '990000', 'b45f06', 'bf9000', '38761d', '134f5c', '0b5394', '351c75', '741b47',
].map(hex => ({ value: hex.toUpperCase(), color: `#${hex}`, label: COLOR_NAMES[`#${hex}`] }));
const recent = [];

export function openTextColor(value, apply, options) {
  return openColorPalette({ ...options, label: 'Text color', value, choices: TEXT_COLORS,
    reset: { value: 'auto', label: 'Automatic', indicator: 'A' }, custom: true, recent,
    onPick: color => {
      if (color !== 'auto' && !TEXT_COLORS.some(choice => choice.value === color)) {
        const at = recent.findIndex(choice => choice.value === color);
        if (at !== -1) recent.splice(at, 1);
        recent.unshift({ value: color, color: `#${color}`, label: `#${color}` });
        recent.splice(8);
      }
      apply(color);
    },
  });
}

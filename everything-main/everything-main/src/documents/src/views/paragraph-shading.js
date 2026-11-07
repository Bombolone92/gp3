import { openColorPalette } from '../ui/color-palette.js';
import { TEXT_COLORS } from './text-color.js';

export const paragraphShadingLabel = value => value === null ? 'Mixed' : value === 'auto' ? 'No fill' : value === 'foreground' ? 'Automatic foreground' : '#' + value;

export function openParagraphShading(value, apply, options = {}) {
  return openColorPalette({ ...options, label: 'Paragraph shading', value, choices: TEXT_COLORS,
    reset: { value: 'auto', label: 'No fill' }, extra: [{ value: 'foreground', label: 'Automatic foreground' }],
    custom: true, customLabel: 'paragraph fill', onPick: apply });
}

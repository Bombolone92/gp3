import { expect, it } from 'vitest';
import { stylesheet, declared } from './helpers/css.js';

// The sheet-tab bar is --surface-2, the very fill an icon button's hover gives: Add sheet, All sheets and the
// scroll arrows showed no hover at all there, where the tabs beside them were given --surface-3 for the purpose.
it('gives the sheet-tab bar’s icon buttons a hover fill that shows on the bar, and none to a spent scroll arrow', () => {
  const editor = stylesheet('editor.css');
  const components = stylesheet('components.css');
  expect(declared(editor, '.sheet-tabs', false).background).toBe('var(--surface-2)');
  expect(declared(components, '.icon-btn:hover', 'hover: hover').background).toBe('var(--surface-2)');
  expect(declared(editor, '.sheet-tabs .icon-btn:hover:not([aria-disabled="true"])', 'hover: hover').background).toBe('var(--surface-3)');
  expect(declared(editor, '.tab:hover', 'hover: hover').background).toBe('var(--surface-3)');
});

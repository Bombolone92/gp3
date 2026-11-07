import { expect, it } from 'vitest';
import { stylesheet, parseRules, declarations } from './helpers/css.js';

// The command palette lives beside the app root, fixed over everything, and was missing from the
// list of chrome the print stylesheet hides: the browser's own Print command while the palette was
// open printed it over the sheet.
it('hides the command palette with the rest of the chrome when printing', () => {
  const rules = parseRules(stylesheet('editor.css'))
    .filter((r) => r.media.some((m) => m.includes('print')) && r.selectors.includes('body.printing .palette-root'));
  expect(rules).toHaveLength(1);
  expect(declarations(rules[0].body).display).toBe('none !important');
  expect(rules[0].selectors).toEqual(expect.arrayContaining(['body.printing .app', 'body.printing .toast-root', 'body.printing .menu', 'body.printing .modal-root']));
});

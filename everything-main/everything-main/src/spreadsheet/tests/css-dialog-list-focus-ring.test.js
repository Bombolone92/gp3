import { expect, it } from 'vitest';
import { stylesheet, declared } from './helpers/css.js';

const base = stylesheet('base.css');
const editor = stylesheet('editor.css');
const components = stylesheet('components.css');
const views = stylesheet('views.css');

// The named-range, conditional-format, validation and protected-range managers all scroll their rows
// in a box with overflow-y: auto, which computes overflow-x to auto too, and each row is exactly as
// wide as that box. The app's ring is drawn 2px outside the element, so arrowing through those rows
// left two horizontal strokes with the sides — and the first row's top — clipped away.
it('draws the focus ring inside the rows of the dialog list scrollers', () => {
  const ring = declared(base, ':focus-visible');
  expect(ring.outline).toBe('2px solid var(--accent)');
  expect(ring['outline-offset']).toBe('2px');
  for (const sel of ['.names-list', '.cf-list']) {
    expect(declared(editor, sel)['overflow-y'], sel).toBe('auto');
    expect(declared(editor, sel).padding, sel).toBeUndefined(); // no room for a ring on either side
    expect(declared(editor, `${sel} :focus-visible`)['outline-offset'], sel).toBe('-2px');
  }
  // Descendant, not child: the focusable parts of a row are the button and the icon buttons inside it.
  expect(declared(editor, '.names-list > :focus-visible')['outline-offset']).toBeUndefined();
  // The lists that solved this first.
  expect(declared(components, '.settings-list > :focus-visible')['outline-offset']).toBe('-2px');
  expect(declared(views, '.file-main:focus-visible')['outline-offset']).toBe('-2px');
});

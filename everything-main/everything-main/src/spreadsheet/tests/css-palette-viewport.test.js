import { expect, it } from 'vitest';
import { stylesheet, declared, rulesFor } from './helpers/css.js';

// On a phone 100vh is the height with the browser's bars retracted, and it ignores the keyboard the
// palette's search field brings up, so a 70vh panel could run under both. The modal already sizes
// itself in dvh with a vh fallback for browsers without it; the palette does the same.
it('sizes the command palette to the visible viewport, with a vh fallback', () => {
  const css = stylesheet('components.css');
  const base = rulesFor(css, '.palette-panel', false);
  expect(base).toHaveLength(1);
  expect(base[0].body).toMatch(/max-height:\s*70vh;[^}]*max-height:\s*70dvh;/);
  expect(declared(css, '.palette-panel', false)['max-height']).toBe('70dvh');
  const narrow = rulesFor(css, '.palette-panel', 'max-width: 639px');
  expect(narrow).toHaveLength(1);
  expect(narrow[0].body).toMatch(/max-height:\s*80vh;\s*max-height:\s*80dvh;/);
});

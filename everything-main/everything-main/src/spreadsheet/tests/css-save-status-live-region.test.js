import { expect, it } from 'vitest';
import { stylesheet, declared } from './helpers/css.js';

// The save pill is a polite live region whose text is its label ("Saved", "Unsaved changes").
// Under 640px the label was display: none, which takes it out of the accessibility tree too, so
// on a phone the region went silent. It is now hidden the way .visually-hidden hides things.
it('keeps the save label in the live region on narrow screens, only out of sight', () => {
  const css = stylesheet('editor.css');
  const narrow = declared(css, '.save-status:not(.signed-out) .save-label', 'max-width: 640px');
  expect(narrow.display).toBeUndefined();
  expect(narrow.position).toBe('absolute');
  expect(narrow.width).toBe('1px');
  expect(narrow.height).toBe('1px');
  expect(narrow.overflow).toBe('hidden');
  expect(narrow.clip).toBe('rect(0, 0, 0, 0)');
  expect(narrow['white-space']).toBe('nowrap');
  // Nothing hides it at full width.
  expect(declared(css, '.save-status:not(.signed-out) .save-label', false)).toEqual({});
});

// Signed out, the pill is a button whose only text is "Sign in to save": hidden with the status
// labels, a phone showed a bare cloud icon with nothing to say what it was for.
it('leaves the signed-out pill its "Sign in to save" text on narrow screens', () => {
  const css = stylesheet('editor.css');
  for (const selector of ['.save-status .save-label', '.save-status.signed-out .save-label']) {
    expect(declared(css, selector, 'max-width: 640px'), selector).toEqual({});
    expect(declared(css, selector, false), selector).toEqual({});
  }
});

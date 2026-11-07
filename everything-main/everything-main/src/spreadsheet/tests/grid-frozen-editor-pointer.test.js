import { describe, expect, it } from 'vitest';
import { stylesheet, declared, rulesFor } from './helpers/css.js';

// jsdom applies no stylesheet, so the rules are checked as text.
const css = stylesheet('grid.css');

describe('the in-cell editor of a frozen cell', () => {
  it('takes pointer events, so a click inside it moves the caret instead of committing through to the cells', () => {
    // The frozen layers let pointer events pass through to the viewport beneath them; the editor
    // is not inside one: the grid hosts it, over the panes, and no rule puts it in a pane's track.
    expect(declared(css, '.frz-layer', false)['pointer-events']).toBe('none');
    expect(rulesFor(css, '.frz-track .grid-editor')).toHaveLength(0);
    expect(Number(declared(css, '.grid > .grid-editor', false)['z-index'])).toBeGreaterThan(Number(declared(css, '.frz-layer', false)['z-index']));
    expect(declared(css, '.grid > .grid-editor', false)['pointer-events']).toBeUndefined();
  });
});

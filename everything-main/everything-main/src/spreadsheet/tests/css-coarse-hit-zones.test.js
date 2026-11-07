import { describe, expect, it } from 'vitest';
import { stylesheet, declared } from './helpers/css.js';

const editor = stylesheet('editor.css');
const components = stylesheet('components.css');
const COARSE = 'pointer: coarse';

// Only .icon-btn and .tb-btn had a taller touch zone under a coarse pointer; the menu titles (26px), the
// name box's names button, the formula bar's expander, the active tab's options button (24px) and the zoom
// controls (24px) were left at their drawn size. They get the same kind of zone, drawn as before.
// The formula bar's Cancel and Apply (30px) came later and were missed; they show while an entry is pending,
// which on a phone is when they are tapped.
const CONTROLS = ['.menubar-btn', '.name-menu-btn', '.fx-expand', '.fx-action', '.tab-menu-btn', '.zoom-btn', '.zoom-label'];

describe('under a coarse pointer', () => {
  it('gives each small bar control a 40px-tall touch zone, shaped like the toolbar buttons’ own', () => {
    const reference = declared(components, '.tb-btn::after', COARSE);
    expect(reference.content).toBe('""');
    for (const sel of CONTROLS) {
      const zone = declared(editor, `${sel}::after`, COARSE);
      expect(zone.content, sel).toBe('""');
      expect(zone.position, sel).toBe('absolute');
      expect(zone.top, sel).toBe(reference.top);
      expect(zone.left, sel).toBe(reference.left);
      expect(zone.transform, sel).toBe(reference.transform);
      expect(zone.height, sel).toBe('max(100%, 40px)');
    }
  });

  it('gives the toast’s Undo and Dismiss the same 44px zone the icon buttons have', () => {
    // Dismiss is drawn at 28px, six pixels from Undo, and is in neither of the two lists above.
    expect(declared(components, '.toast-close', false).height).toBe('28px');
    const reference = declared(components, '.icon-btn::after', COARSE);
    expect(reference.height).toBe('max(100%, 44px)');
    for (const sel of ['.toast-action', '.toast-close']) {
      expect(declared(components, `${sel}::after`, COARSE), sel).toEqual(reference);
      expect(declared(components, sel, COARSE).position, sel).toBe('relative');
      // Drawn as before: only the zone grows.
      const coarse = declared(components, sel, COARSE);
      expect(coarse.width, sel).toBeUndefined();
      expect(coarse.height, sel).toBeUndefined();
      expect(coarse.padding, sel).toBeUndefined();
    }
  });

  it('anchors each zone to its control', () => {
    for (const sel of ['.menubar-btn', '.name-menu-btn', '.fx-expand', '.zoom-btn', '.zoom-label']) {
      expect(declared(editor, sel, false).position || declared(editor, sel, COARSE).position, sel).toBe('relative');
    }
    expect(declared(editor, '.tab-list > .tab-menu-btn', false).position).toBe('absolute');
  });

  it('lets a zone grow sideways only where the room beside the control is its own', () => {
    // The options button sits in the active chip's 32px of padding; a zoom button has the bar's gap beside it.
    expect(declared(editor, '.tab-item.active', false)['padding-right']).toBe('32px');
    expect(declared(editor, '.tab-menu-btn::after', COARSE).width).toBe('max(100%, 32px)');
    expect(declared(editor, '.zoom-btn::after', COARSE).width).toBe('max(100%, 32px)');
    for (const sel of ['.menubar-btn', '.name-menu-btn', '.fx-expand', '.zoom-label']) expect(declared(editor, `${sel}::after`, COARSE).width, sel).toBe('100%');
  });

  it('leaves the drawn sizes as they were', () => {
    expect(declared(editor, '.menubar-btn', false).height).toBe('26px');
    expect(declared(editor, '.name-menu-btn', false).width).toBe('24px');
    expect(declared(editor, '.fx-expand', false).width).toBe('30px');
    expect(declared(editor, '.tab-menu-btn', false).height).toBe('24px');
    expect(declared(editor, '.zoom-btn', false).height).toBe('24px');
    expect(declared(editor, '.zoom-label', false)['min-height']).toBe('24px');
    for (const sel of CONTROLS) {
      const coarse = declared(editor, sel, COARSE);
      expect(coarse.width, sel).toBeUndefined();
      expect(coarse.height, sel).toBeUndefined();
      expect(coarse.padding, sel).toBeUndefined();
    }
  });
});

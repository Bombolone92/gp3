// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { headingsFromBlocks, createOutline } from '../src/ui/outline.js';

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('headingsFromBlocks', () => {
  it('keeps headings and titles with their levels, skipping body text', () => {
    const blocks = [
      { nodeId: 'a', nodeType: 'paragraph', textPreview: 'Body' },
      { nodeId: 't', nodeType: 'paragraph', styleId: 'Title', textPreview: 'My report' },
      { nodeId: 'h1', nodeType: 'heading', styleId: 'Heading1', textPreview: 'Intro' },
      { nodeId: 'h2', nodeType: 'heading', level: 2, styleId: 'Heading2', textPreview: '' },
      { nodeId: 'h3', nodeType: 'paragraph', styleId: 'heading 3', textPreview: 'Deep￼' },
      // The engine reports the level a custom style's outline level gives, not a digit in its name.
      { nodeId: 'h4', nodeType: 'heading', headingLevel: 2, styleId: 'ChapterHead', textPreview: 'Chapter' },
      { nodeId: 'tb', nodeType: 'table' },
    ];
    expect(headingsFromBlocks(blocks)).toEqual([
      { nodeId: 't', text: 'My report', level: 0, empty: false },
      { nodeId: 'h1', text: 'Intro', level: 1, empty: false },
      { nodeId: 'h2', text: 'Untitled heading', level: 2, empty: true },
      { nodeId: 'h3', text: 'Deep', level: 3, empty: false },
      { nodeId: 'h4', text: 'Chapter', level: 2, empty: false },
    ]);
    expect(headingsFromBlocks()).toEqual([]);
  });
});

describe('createOutline', () => {
  it('keeps keyboard focus on the same heading when a refresh reorders the outline', () => {
    const outline = createOutline();
    document.body.append(outline.el); outline.open();
    const a = { nodeId: 'a', text: 'One', level: 1 }, b = { nodeId: 'b', text: 'Two', level: 1 };
    outline.update([a, b]);
    outline.el.querySelector('[data-node-id="b"]').focus();
    outline.update([{ ...b, text: 'Updated' }, a]);
    expect(document.activeElement).toBe(outline.el.querySelector('[data-node-id="b"]'));
    outline.update([a]);
    expect(document.activeElement).toBe(outline.el.querySelector('[data-node-id="a"]'));
    outline.update([]);
    expect(document.activeElement).toBe(outline.el.querySelector('[aria-label="Close outline"]'));
  });

  it('does not move focus into the outline when updating it from the editor', () => {
    const editor = document.createElement('textarea'), outline = createOutline();
    document.body.append(editor, outline.el); outline.open(); editor.focus();
    outline.update([{ nodeId: 'a', text: 'New heading', level: 1 }]);
    expect(document.activeElement).toBe(editor);
  });

  it('renders items by level, marks the active one, and jumps on click', () => {
    const store = new Map();
    vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) });
    const jumped = [];
    const o = createOutline({ onJump: (h) => jumped.push(h.nodeId) });
    document.body.append(o.el);
    expect(o.el.hidden).toBe(true);
    expect(o.el.querySelector('.outline-empty').hidden).toBe(false);
    // The list fills the panel's height, so the hint must come before it to sit under the title.
    expect(o.el.querySelector('.outline-empty').nextElementSibling).toBe(o.el.querySelector('.outline-list'));
    o.update([{ nodeId: 'a', text: 'One', level: 1 }, { nodeId: 'b', text: 'Two', level: 2 }]);
    const items = [...o.el.querySelectorAll('.outline-item')];
    expect(items.map((i) => i.textContent)).toEqual(['One', 'Two']);
    expect(items[1].classList.contains('level-2')).toBe(true);
    expect(o.el.querySelector('.outline-empty').hidden).toBe(true);
    o.setActive('b');
    expect(items[1].getAttribute('aria-current')).toBe('true');
    expect(items[0].hasAttribute('aria-current')).toBe(false);
    items[0].click();
    expect(jumped).toEqual(['a']);
    let toggles = 0;
    o.onToggle(() => toggles++);
    o.toggle();
    expect(o.isOpen).toBe(true);
    expect(localStorage.getItem('documents:outline')).toBe('1');
    o.close();
    expect(o.isOpen).toBe(false);
    expect(toggles).toBe(2);
  });
});

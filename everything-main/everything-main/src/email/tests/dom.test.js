import { describe, it, expect } from 'vitest';
import { el, append, clear } from '../src/ui/dom.js';

describe('el', () => {
  it('sets classes from the tag spec', () => {
    const node = el('button.btn.btn-primary');
    expect(node.tagName).toBe('BUTTON');
    expect(node.className).toBe('btn btn-primary');
  });

  it('writes a style object as a declaration', () => {
    const node = el('span', { style: { color: 'red' } });
    expect(node.style.color).toBe('red');
  });

  it('writes a CSS custom property, which plain assignment never does', () => {
    const node = el('span', { style: { '--hue': 137 } });
    expect(node.style.getPropertyValue('--hue')).toBe('137');
    expect(node.getAttribute('style')).toContain('--hue');
  });

  it('drops attributes that are null, undefined or false', () => {
    const node = el('span', { title: null, hidden: false, 'aria-label': undefined });
    expect(node.hasAttribute('title')).toBe(false);
    expect(node.hidden).toBe(false);
    expect(node.hasAttribute('aria-label')).toBe(false);
  });

  it('writes a true attribute as an empty one', () => {
    expect(el('div', { 'aria-hidden': true }).getAttribute('aria-hidden')).toBe('');
  });
});

describe('append', () => {
  it('skips every falsy value a short-circuited child can yield', () => {
    const node = append(el('div'), [false, null, undefined, '', 0, el('b')]);
    expect(node.childNodes).toHaveLength(1);
  });

  it('flattens nested arrays of children', () => {
    expect(append(el('div'), [[el('b'), el('i')], el('u')]).childNodes).toHaveLength(3);
  });
});

describe('clear', () => {
  it('empties a node and returns it', () => {
    const node = el('div', {}, el('b'), el('i'));
    expect(clear(node)).toBe(node);
    expect(node.childNodes).toHaveLength(0);
  });
});

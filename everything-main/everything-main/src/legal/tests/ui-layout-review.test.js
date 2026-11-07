import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Layout cannot be measured in jsdom; these check the rules that measured
// right in Chrome (see the commit messages for the numbers).
const shell = readFileSync(`${process.cwd()}/src/styles/shell.css`, 'utf8');
const mediaBlock = (query) => {
  const at = shell.indexOf(`@media (${query}) {`);
  let depth = 0;
  for (let i = shell.indexOf('{', at); i < shell.length; i++) {
    if (shell[i] === '{') depth++;
    else if (shell[i] === '}' && --depth === 0) return shell.slice(at, i);
  }
  return '';
};
const rule = (css, sel) => css.split(`${sel} {`)[1]?.split('}')[0] || '';
const prop = (text, name) => text.match(new RegExp(`(?:^|[;\\s])${name}:\\s*([^;]+);`))?.[1].trim();

describe('top bar layout', () => {
  it('keeps the search box at full width on tablets instead of splitting the room with the empty spacer', () => {
    // The search box may shrink to nothing (so the timer is never clipped);
    // if it also grew, it would take only half the free room on tablets.
    expect(prop(rule(shell, '\n.search-trigger'), 'min-width')).toBe('0');
    const tablet = rule(mediaBlock('max-width: 1100px'), '.search-trigger');
    expect(Number(prop(tablet, 'flex').split(/\s+/)[0])).toBe(0);
  });

  it('keeps the brand logo on phones wide enough for it, such as 390 px iPhones', () => {
    const [, width] = shell.match(/@media \(max-width: (\d+)px\) \{[^@]*?\.mobile-brand \{\s*display: none;/) || [];
    expect(Number(width)).toBeGreaterThan(0);
    expect(Number(width)).toBeLessThan(390);
  });
});

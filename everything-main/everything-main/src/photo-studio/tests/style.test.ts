import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Feature sections are appended to one stylesheet by parallel work; an
// unclosed block silently drops every later rule in the browser.
describe('workspace stylesheet', () => {
  it('closes every block before the next top-level rule', () => {
    const lines = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8').split('\n');
    let depth = 0;
    const problems: number[] = [];
    lines.forEach((line, i) => {
      const t = line.trim();
      if (depth > 0 && line && !/^\s/.test(line) && !t.startsWith('}') && !t.startsWith('/*')) problems.push(i + 1);
      for (const ch of line) depth += ch === '{' ? 1 : ch === '}' ? -1 : 0;
      if (depth < 0) problems.push(i + 1);
    });
    expect(problems).toEqual([]);
    expect(depth).toBe(0);
  });
  it('contains no leftover merge markers', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    expect(css).not.toMatch(/^(<<<<<<<|=======|>>>>>>>)/m);
  });
});

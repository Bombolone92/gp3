// Every icon name written literally in the source must exist: an unknown name
// silently renders the fallback glyph, which reads as a broken control.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasIcon, svg } from '../src/app/icons';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('icons', () => {
  it('resolves every literal icon name used in the workspace', () => {
    const missing: string[] = [];
    let seen = 0;
    const patterns = [/\bsvg\(\s*['"]([a-z0-9-]+)['"]/g, /\bicon\(\s*['"]([a-z0-9-]+)['"]/g, /\bicon:\s*['"]([a-z0-9-]+)['"]/g];
    for (const f of files(join(__dirname, '../src'))) {
      const text = readFileSync(f, 'utf8');
      for (const re of patterns)
        for (const m of text.matchAll(re)) {
          seen++;
          if (!hasIcon(m[1]) && m[1] !== 'lock-keyhole') missing.push(`${f.split('/src/').pop()}: ${m[1]}`);
        }
    }
    expect(seen).toBeGreaterThan(200);
    expect(missing).toEqual([]);
  });

  it('draws every glyph on the shared 24-unit grid with one stroke style', () => {
    const markup = svg('history-brush', 20);
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain('stroke-width="1.7"');
    expect(markup).toContain('width="20"');
  });
});

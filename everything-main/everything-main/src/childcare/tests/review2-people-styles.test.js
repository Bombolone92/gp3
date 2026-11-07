/** Second adversarial review: dark mode must look the same whether it is chosen or comes from the system. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = (f) => readFileSync(new URL(`../src/styles/${f}`, import.meta.url), 'utf8');

describe('dark mode styles', () => {
  it('every explicit dark override in the shared styles also applies to system dark mode', () => {
    for (const f of ['base.css', 'components.css', 'shell.css']) {
      const text = css(f);
      const explicit = [...text.matchAll(/\[data-theme='dark'\]\s+([^{,]+)\{/g)].map((m) => m[1].trim());
      for (const sel of explicit) expect(text, `${f}: ${sel}`).toContain(`:root:not([data-theme='light']) ${sel}`);
    }
  });

  it('danger buttons use a text color that reads on the dark-mode red', () => {
    // #fff on the dark --danger #ff7b7b is 2.5:1; --text-inverse there is #0f1216 (7.5:1).
    expect(css('components.css')).toMatch(/\.btn\.danger \{[^}]*color: var\(--text-inverse\)/);
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { icon } from '../src/ui/icons.js';

describe('icon', () => {
  it('renders the same markup for the same request and distinct markup otherwise', () => {
    const a = icon('check', 15, 2);
    expect(a).toBe(icon('check', 15, 2));
    expect(a).toContain('width="15"');
    expect(a).toContain('stroke-width="2"');
    expect(a).toContain('aria-hidden="true"');
    expect(icon('check', 16, 2)).not.toBe(a);
    expect(icon('trash', 15, 2)).not.toBe(a);
    // Unknown names, and names off the prototype chain, fall back to one icon.
    expect(icon('constructor')).toBe(icon('no-such-icon'));
    expect(icon('constructor')).not.toBe(icon('check'));
  });
});

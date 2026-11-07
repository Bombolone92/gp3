import { beforeAll, afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseHwpx } from '../src/lib/hwp/hwpx.js';
import { LIMITS } from '../src/lib/hwp/binary.js';
import { hwpx } from './helpers/hwp-fixtures.js';

const limits = { ...LIMITS };
beforeAll(() => { globalThis.DOMParser = new JSDOM('').window.DOMParser; });
afterEach(() => { Object.assign(LIMITS, limits); vi.restoreAllMocks(); });

it.each(['elements', 'depth'])('rejects excessive XML %s before allocating its DOM', (kind) => {
  LIMITS.records = 50;
  LIMITS.depth = 10;
  const content = kind === 'elements' ? '<hp:t/>'.repeat(60) : '<hp:t>'.repeat(12) + '</hp:t>'.repeat(12);
  const source = hwpx({ sections: [`<hp:p><hp:run>${content}</hp:run></hp:p>`] });
  const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');
  expect(() => parseHwpx(source)).toThrow();
  // The package and header are small; the oversized section must never reach DOMParser.
  expect(parse.mock.calls.some(([text]) => text.includes(content))).toBe(false);
});

it('does not count markup inside comments, CDATA, processing instructions, or quoted attributes', () => {
  LIMITS.records = 30;
  LIMITS.depth = 4;
  const literal = '<example/>'.repeat(40);
  const source = hwpx({ sections: [`<hp:p><hp:run><!--${literal}--><?example ${literal}?><hp:t hint="a > b"><![CDATA[${literal}]]></hp:t></hp:run></hp:p>`] });
  const model = parseHwpx(source);
  expect(model.sections[0].blocks[0].runs[0].text).toBe(literal);
});

it('allows the exact limits and counts elements across package parts', () => {
  // Six package elements, five header elements, and four section elements.
  const source = hwpx();
  LIMITS.records = 15;
  LIMITS.depth = 3;
  expect(() => parseHwpx(source)).not.toThrow();
  LIMITS.records--;
  const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');
  expect(() => parseHwpx(source)).toThrow(/too many XML elements/);
  expect(parse).toHaveBeenCalledTimes(2);
});

it('rejects a tag with an unreasonable number of attributes before allocating its DOM', () => {
  LIMITS.attributes = 100;
  const attributes = Array.from({ length: 120 }, (_, i) => `a${i}=""`).join(' ');
  const source = hwpx({ sections: [`<hp:p><hp:run><hp:t ${attributes}>x</hp:t></hp:run></hp:p>`] });
  const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');
  expect(() => parseHwpx(source)).toThrow(/attributes/);
  expect(parse.mock.calls.some(([text]) => text.includes(attributes))).toBe(false);
  // Equals signs inside quoted values are text, not attributes.
  const quoted = hwpx({ sections: [`<hp:p><hp:run><hp:t hint="${'='.repeat(200)}">x</hp:t></hp:run></hp:p>`] });
  expect(parseHwpx(quoted).sections[0].blocks[0].runs[0].text).toBe('x');
});

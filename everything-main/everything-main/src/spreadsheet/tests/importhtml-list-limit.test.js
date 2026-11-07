// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { rowsFromHtml } from '../src/core/importrange.js';
import { parseInput } from '../src/core/format.js';

it('accepts the list cell limit and rejects the next item with bounded value parsing', () => {
  // Reuse one real parsed DOM for both boundaries to avoid parsing the
  // large fixture twice. All list traversal uses the real DOM APIs.
  const doc = new DOMParser().parseFromString(`<ul>${'<li>1</li>'.repeat(200000)}</ul>`, 'text/html');
  const parser = vi.spyOn(DOMParser.prototype, 'parseFromString').mockReturnValue(doc);
  let calls = 0;
  const typed = (text) => { calls++; return parseInput(text); };
  try {
    const rows = rowsFromHtml('', 'list', 1, typed);
    expect(rows).toHaveLength(200000);
    expect(rows[0]).toEqual([1]);
    expect(rows.at(-1)).toEqual([1]);
    const extra = doc.createElement('li');
    extra.textContent = '2';
    doc.querySelector('ul').append(extra);
    calls = 0;
    expect(rowsFromHtml('', 'list', 1, typed)).toEqual({ error: '#NUM!' });
    expect(calls).toBeLessThanOrEqual(200000);
  } finally { parser.mockRestore(); }
}, 180000);

it('counts only direct list items and keeps list selection and typed text behavior', () => {
  const html = '<ul><li>Outer<ol><li>Nested</li></ol></li><li>=1+2</li></ul>'
    + '<ol><li>3</li><script>ignored</script><li>4</li></ol>';
  expect(rowsFromHtml(html, 'list', 1, parseInput)).toEqual([['Outer Nested'], ['=1+2']]);
  expect(rowsFromHtml(html, 'list', 2, parseInput)).toEqual([[3], [4]]);
  expect(rowsFromHtml('<ul></ul>', 'list', 1, parseInput)).toEqual({ error: '#N/A' });
});

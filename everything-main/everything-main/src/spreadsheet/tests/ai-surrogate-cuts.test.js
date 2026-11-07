import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { cutText } from '../src/core/cell.js';
import { requestMessages, workbookSnapshot } from '../src/core/aiagent.js';
import { textBlock, MAX_TEXT_CHARS } from '../src/core/aiattach.js';
import { runTool } from '../src/core/aitools.js';

// A lone surrogate in a request is refused by the model's API ("no low surrogate in string"): every request after
// would carry it, so a cut must never split an emoji in two.
const lone = (s) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

describe('text cut for the AI keeps surrogate pairs whole', () => {
  it('cuts before an emoji that straddles the limit', () => {
    expect(cutText('ab😀', 3)).toBe('ab');
    expect(cutText('ab😀', 4)).toBe('ab😀');
    expect(cutText('abc', 2)).toBe('ab');
    expect(cutText(null, 2)).toBe('');
  });

  it('an earlier turn\'s long tool result', () => {
    const result = `${'x'.repeat(1499)}😀${'y'.repeat(2000)}`;
    const sent = requestMessages([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_range', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: result },
      { role: 'assistant', content: 'done' },
      { role: 'user', content: 'two' },
    ]);
    const tool = sent.find((m) => m.role === 'tool');
    expect(tool.content.length).toBeLessThan(result.length);
    expect(lone(tool.content)).toBe(false);
  });

  it('a snapshot cell and a selection of cells', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, `${'x'.repeat(59)}😀 end`);
    wb.setInput(id, 1, 0, 'b');
    const one = workbookSnapshot(wb, { sheetId: id, selection: { sheetId: id, range: { r1: 0, c1: 0, r2: 0, c2: 0 } } });
    const many = workbookSnapshot(wb, { sheetId: id, selection: { sheetId: id, range: { r1: 0, c1: 0, r2: 1, c2: 0 } } });
    expect(lone(one)).toBe(false);
    expect(lone(many)).toBe(false);
  });

  it('a long text attachment and a read of long cells', () => {
    expect(lone(textBlock('a.txt', `${'x'.repeat(MAX_TEXT_CHARS - 1)}😀more`).text)).toBe(false);
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, `${'x'.repeat(299)}😀 end`);
    const env = { sheetId: () => id, selection: () => null };
    expect(lone(runTool(wb, 'read_range', { range: 'A1' }, env).content)).toBe(false);
    expect(lone(runTool(wb, 'find', { query: 'x' }, env).content)).toBe(false);
  });
});

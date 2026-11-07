import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';

// The app makes a typed web or e-mail address a link by reading the text every time, so Remove link,
// which rewrote the cell with the same text, changed nothing: the cell stayed underlined and clickable,
// and Ctrl+K went on offering "Edit link". Once its link is removed, the text now stays plain.
describe('Remove link on an address the app detected in plain text', () => {
  const linked = (text = 'www.example.com') => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, text);
    expect(wb.linkAt(id, 0, 0)).toBeTruthy();
    return { wb, id };
  };

  it('makes the text plain, in one undo step, and undo brings the link back', () => {
    const { wb, id } = linked();
    const steps = wb.undoLabels().length;
    wb.removeLink(id, 0, 0);
    expect(wb.linkAt(id, 0, 0)).toBeNull();
    expect(wb.getValue(id, 0, 0)).toBe('www.example.com');
    expect(wb.getDisplay(id, 0, 0)).toBe('www.example.com');
    expect(wb.undoLabels().length).toBe(steps + 1);
    expect(wb.undoLabel()).toBe('Remove link');
    wb.undo();
    expect(wb.linkAt(id, 0, 0)?.url).toBe('https://www.example.com');
    wb.redo();
    expect(wb.linkAt(id, 0, 0)).toBeNull();
  });

  it('works for an e-mail address and for a HYPERLINK whose label is itself an address', () => {
    const { wb, id } = linked('someone@example.com');
    wb.removeLink(id, 0, 0);
    expect(wb.linkAt(id, 0, 0)).toBeNull();
    wb.setLink(id, 1, 0, 'https://elsewhere.test', 'www.example.com');
    expect(wb.linkAt(id, 1, 0).url).toBe('https://elsewhere.test');
    wb.removeLink(id, 1, 0);
    expect(wb.getValue(id, 1, 0)).toBe('www.example.com');
    expect(wb.linkAt(id, 1, 0)).toBeNull(); // not a link to www.example.com now either
    // A removed number-labelled link keeps its number and needs no mark.
    wb.setLink(id, 2, 0, 'https://elsewhere.test', 1000);
    wb.removeLink(id, 2, 0);
    expect(wb.getCell(id, 2, 0)).toEqual({ v: 1000, f: null });
  });

  it('a new entry may be a link again, whichever way it arrives', () => {
    const { wb, id } = linked();
    wb.removeLink(id, 0, 0);
    wb.setInput(id, 0, 0, 'www.example.com'); // retyped
    expect(wb.linkAt(id, 0, 0)?.url).toBe('https://www.example.com');
    wb.removeLink(id, 0, 0);
    wb.setInput(id, 0, 0, 'plain words');
    expect(wb.getCell(id, 0, 0).s).toBeUndefined(); // the mark went with the entry it belonged to
    wb.setInput(id, 0, 0, 'www.example.com');
    wb.removeLink(id, 0, 0);
    wb.pasteValues(id, [['www.other.org']], 0, 0);
    expect(wb.linkAt(id, 0, 0)?.url).toBe('https://www.other.org');
    wb.removeLink(id, 0, 0);
    wb.fillInput(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, 'www.filled.org', { r: 0, c: 0 });
    expect(wb.linkAt(id, 0, 0)?.url).toBe('https://www.filled.org');
    wb.removeLink(id, 0, 0);
    wb.setLink(id, 0, 0, 'https://elsewhere.test', 'go'); // the link dialog over a plain address
    expect(wb.linkAt(id, 0, 0).url).toBe('https://elsewhere.test');
    expect(wb.getCell(id, 0, 0).s).toBeUndefined();
  });

  it('survives formatting, clearing formats, a pasted format, and the file', async () => {
    const { wb, id } = linked();
    wb.removeLink(id, 0, 0);
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bold: true });
    expect(wb.linkAt(id, 0, 0)).toBeNull();
    wb.clearRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { contents: false, styles: true });
    expect(wb.getCell(id, 0, 0).s?.bold).toBeUndefined();
    expect(wb.linkAt(id, 0, 0)).toBeNull();
    // Painting this cell's format onto another address does not remove that address's link.
    wb.setInput(id, 1, 0, 'www.second.org');
    wb.pasteStyles(id, wb.copyRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 }), 1, 0);
    expect(wb.linkAt(id, 1, 0)?.url).toBe('https://www.second.org');
    // And painting a linked cell's format onto the plain one does not bring its link back.
    wb.pasteStyles(id, wb.copyRange(id, { r1: 1, c1: 0, r2: 1, c2: 0 }), 0, 0);
    expect(wb.linkAt(id, 0, 0)).toBeNull();
    const again = new Workbook(JSON.parse(JSON.stringify(wb.toJSON())));
    expect(again.linkAt(again.sheets[0].id, 0, 0)).toBeNull();
    expect(again.linkAt(again.sheets[0].id, 1, 0)).toBeTruthy();
    const file = await workbookToXlsx(wb);
    const opened = await workbookFromFile(file, 'links.xlsx');
    expect(opened.linkAt(opened.sheets[0].id, 0, 0)).toBeNull();
    expect(opened.linkAt(opened.sheets[0].id, 1, 0)?.url).toBe('https://www.second.org');
  });
});

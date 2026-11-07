// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { downloadText } from '../src/core/csv.js';

async function captured(fn) {
  let blob = null;
  const create = vi.fn((b) => ((blob = b), 'blob:x'));
  URL.createObjectURL = create;
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fn();
  const buf = await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsArrayBuffer(blob);
  });
  return new Uint8Array(buf);
}

describe('CSV download', () => {
  it('starts CSV files with a byte order mark so Excel reads them as UTF-8', async () => {
    const bytes = await captured(() => downloadText('x.csv', 'Name\r\nMüller\r\n'));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toBe('Name\r\nMüller\r\n');
  });

  it('leaves other files alone', async () => {
    const bytes = await captured(() => downloadText('x.json', '{}', 'application/json'));
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)).toBe('{}');
  });
});

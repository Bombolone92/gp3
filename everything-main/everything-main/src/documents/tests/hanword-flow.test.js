// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hwp, paragraph } from './helpers/hwp-fixtures.js';
import { homeView } from '../src/views/home.js';
import { closeAllModals } from '../src/ui/modal.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

describe('home Hanword import flow', () => {
  let fs, writes, view, finished, importing;
  beforeEach(() => {
    fs = new Map(); writes = []; importing = false;
    let complete;
    finished = new Promise((resolve) => { complete = resolve; });
    toast.mockImplementation((message) => {
      if (/^Imported \d/.test(message)) complete();
      return { dismiss() {} };
    });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    vi.stubGlobal('puter', { fs: {
      mkdir: async () => {},
      readdir: async () => [],
      stat: async (p) => fs.has(p) ? { path: p } : null,
      write: async (p, b, options = {}) => {
        if (options.dedupeName) {
          const stem = p.replace(/\.docx$/i, '');
          let n = 1;
          while (fs.has(p)) p = `${stem} (${n++}).docx`;
        }
        fs.set(p, b); writes.push({ path: p, blob: b }); return { path: p };
      },
    } });
  });
  afterEach(async () => {
    // Do not replace the filesystem mocks while an earlier batch is writing.
    if (importing) await finished;
    view?.destroy(); closeAllModals(); document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  });
  function setup(importFile = vi.fn()) {
    view = homeView({ openPath: vi.fn(), newDoc: vi.fn(), importFile }); document.body.append(view.el);
    return importFile;
  }
  function pick(files) {
    importing = files.length > 1;
    const input = view.el.querySelector('input[type=file]'); Object.defineProperty(input, 'files', { configurable: true, value: files }); input.dispatchEvent(new Event('change'));
  }
  it('sends a single HWP file to the editor conversion route', () => {
    const open = setup(); const f = new File([hwp()], '한글.hwp'); pick([f]); expect(open).toHaveBeenCalledWith(f); expect(writes).toEqual([]);
  });
  it('converts every HWP in a mixed batch before saving DOCX bytes', async () => {
    setup();
    const bytes = hwp(), slowFile = new File([bytes], '같은.hwp');
    // A valid conversion may take longer than waitFor's one-second default.
    slowFile.arrayBuffer = async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    };
    pick([slowFile, new File([hwp({ compressed: false, sections: [paragraph('두 번째')] })], '같은.HWP'), new File(['word bytes'], 'native.docx')]);
    await finished;
    expect(writes).toHaveLength(3);
    expect(writes.map((w) => w.path)).toEqual(['Documents/같은.docx', 'Documents/같은 2.docx', 'Documents/native.docx']);
    expect(writes[0].blob.type).toContain('wordprocessingml.document');
    expect(writes[1].blob.type).toContain('wordprocessingml.document');
    expect(writes[0].blob.size).toBeGreaterThan(500);
  });
  it('continues after a bad HWP and reports the file that failed', async () => {
    setup(); const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    pick([new File(['bad'], 'broken.hwp'), new File([hwp()], 'good.hwp')]);
    await finished;
    expect(document.body.textContent).toContain('broken.hwp: This file is not a valid Hanword');
    expect(writes.map((w) => w.path)).toEqual(['Documents/good.docx']); errors.mockRestore();
  });
  it('preserves a file created after the batch checks for available names', async () => {
    setup();
    const existing = new Blob(['Work saved in another tab']);
    // Another tab writes the file after uniqueName has checked the destination and before this write lands.
    const write = puter.fs.write;
    puter.fs.write = async (...args) => { if (!fs.has('Documents/collision.docx')) fs.set('Documents/collision.docx', existing); return write(...args); };
    pick([new File([hwp()], 'collision.hwp'), new File(['word bytes'], 'other.docx')]);
    await finished;
    expect(writes).toHaveLength(2);
    expect(fs.get('Documents/collision.docx')).toBe(existing);
    expect(writes.map((w) => w.path)).toEqual(['Documents/collision (1).docx', 'Documents/other.docx']);
    expect(writes[0].blob.type).toContain('wordprocessingml.document');
  });
});

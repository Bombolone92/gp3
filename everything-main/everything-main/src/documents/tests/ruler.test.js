// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { bindRulerMargins } from '../src/lib/ruler.js';

const MISSING_API = { status: 'rejected', reason: 'host-not-ready', detail: 'doc-api-missing' };

/** A controller whose ruler commits are rejected when the document API is missing. */
function fakeController({ commit = async () => MISSING_API, sections, epochs = [7, 8] } = {}) {
  let read = 0;
  const doc = {
    sections: {
      list: vi.fn(async () => ({ items: [{ id: 'section-0', index: 0, address: { kind: 'section', sectionId: 'section-0' } }] })),
      setPageMargins: vi.fn(async () => ({ success: true })),
      ...sections,
    },
  };
  const pageLayout = {
    setMargins: vi.fn(commit),
    getActiveRulerContext: () => ({ renderEpoch: epochs[Math.min(read++, epochs.length - 1)] }),
  };
  return { activeEditor: { doc, pageLayout } };
}

describe('ruler margins', () => {
  it('writes a rejected margin through the document API and reports it committed', async () => {
    const controller = fakeController();
    bindRulerMargins(controller);
    const result = await controller.activeEditor.pageLayout.setMargins({ sectionId: 'section-0', left: 1.25 });
    expect(controller.activeEditor.doc.sections.setPageMargins).toHaveBeenCalledWith({
      target: { kind: 'section', sectionId: 'section-0' }, left: 1.25,
    });
    expect(result).toMatchObject({ status: 'committed', sectionId: 'section-0', sectionIndex: 0, applied: { left: 1.25 } });
  });

  it('hands the ruler an epoch the relaid-out page has reached', async () => {
    const controller = fakeController({ epochs: [7, 7, 9] });
    bindRulerMargins(controller);
    const result = await controller.activeEditor.pageLayout.setMargins({ sectionId: 'section-0', right: 2 });
    expect(result.renderEpoch).toBe(9);
    expect(controller.activeEditor.pageLayout.getActiveRulerContext().renderEpoch).toBeGreaterThanOrEqual(result.renderEpoch);
  });

  it('tells the document the margin changed', async () => {
    const onCommit = vi.fn();
    const controller = fakeController();
    bindRulerMargins(controller, { onCommit });
    await controller.activeEditor.pageLayout.setMargins({ sectionId: 'section-0', left: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('leaves a commit the engine made itself alone', async () => {
    const committed = { status: 'committed', sectionId: 'section-0', sectionIndex: 0, renderEpoch: 3 };
    const controller = fakeController({ commit: async () => committed });
    bindRulerMargins(controller);
    expect(await controller.activeEditor.pageLayout.setMargins({ sectionId: 'section-0', left: 1 })).toBe(committed);
    expect(controller.activeEditor.doc.sections.setPageMargins).not.toHaveBeenCalled();
  });

  it('leaves every other rejection standing', async () => {
    const rejection = { status: 'rejected', reason: 'host-saving', detail: 'state=saving' };
    const controller = fakeController({ commit: async () => rejection });
    bindRulerMargins(controller);
    expect(await controller.activeEditor.pageLayout.setMargins({ sectionId: 'section-0', left: 1 })).toBe(rejection);
    expect(controller.activeEditor.doc.sections.setPageMargins).not.toHaveBeenCalled();
  });

  it.each([
    ['the section is gone', { list: vi.fn(async () => ({ items: [] })) }],
    ['the write fails', { setPageMargins: vi.fn(async () => ({ success: false, failure: { code: 'FORBIDDEN' } })) }],
    ['the write throws', { setPageMargins: vi.fn(async () => { throw new Error('no'); }) }],
  ])('lets the ruler spring back when %s', async (_label, sections) => {
    const onCommit = vi.fn();
    const controller = fakeController({ sections });
    bindRulerMargins(controller, { onCommit });
    expect(await controller.activeEditor.pageLayout.setMargins({ sectionId: 'section-0', left: 1 })).toEqual(MISSING_API);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('treats a margin already at the dragged value as committed', async () => {
    const controller = fakeController({ sections: { setPageMargins: vi.fn(async () => ({ success: false, failure: { code: 'NO_OP' } })) } });
    bindRulerMargins(controller);
    expect(await controller.activeEditor.pageLayout.setMargins({ sectionId: 'section-0', left: 1 })).toMatchObject({ status: 'committed' });
  });

  it('takes the section by index, and the only section when the drag names neither', async () => {
    const controller = fakeController();
    bindRulerMargins(controller);
    expect(await controller.activeEditor.pageLayout.setMargins({ sectionIndex: 0, top: 0.5 })).toMatchObject({ status: 'committed' });
    expect(await controller.activeEditor.pageLayout.setMargins({ bottom: 0.5 })).toMatchObject({ status: 'committed' });
    expect(await controller.activeEditor.pageLayout.setMargins({ sectionId: 'section-9', left: 1 })).toEqual(MISSING_API);
  });

  it('ignores a commit carrying no margin', async () => {
    const controller = fakeController();
    bindRulerMargins(controller);
    expect(await controller.activeEditor.pageLayout.setMargins({ sectionId: 'section-0' })).toEqual(MISSING_API);
    expect(controller.activeEditor.doc.sections.list).not.toHaveBeenCalled();
  });

  it('puts the engine back when the editor closes, and binds nothing without a ruler', async () => {
    const controller = fakeController();
    const engine = controller.activeEditor.pageLayout.setMargins;
    bindRulerMargins(controller)();
    await controller.activeEditor.pageLayout.setMargins({ sectionId: 'section-0', left: 1 });
    expect(engine).toHaveBeenCalledTimes(1);
    expect(controller.activeEditor.doc.sections.setPageMargins).not.toHaveBeenCalled();
    expect(() => bindRulerMargins({ activeEditor: { doc: {} } })()).not.toThrow();
  });
});

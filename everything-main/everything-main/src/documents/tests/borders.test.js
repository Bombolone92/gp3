import { describe, it, expect } from 'vitest';
import { borderPayload, applyParagraphBorders, shadeParagraphs, isEmptyParagraph, insertHorizontalRule, BORDER_SIDE_PRESETS, BORDER_STYLES, BORDER_WIDTHS } from '../src/lib/borders.js';

const fakeApi = () => {
  const calls = [];
  const rec = (name) => async (input) => { calls.push({ name, ...input }); return { success: true }; };
  return {
    calls,
    format: { paragraph: { setBorder: rec('setBorder'), clearBorder: rec('clearBorder'), setShading: rec('setShading'), clearShading: rec('clearShading') } },
  };
};

describe('borderPayload', () => {
  it('converts points to eighths and a missing color to automatic', () => {
    expect(borderPayload({ style: 'double', widthPt: 1.5, color: '#ff0000', spacePt: 1 })).toEqual({ style: 'double', size: 12, space: 1, color: 'ff0000' });
    expect(borderPayload({})).toEqual({ style: 'single', size: 6, space: 1, color: 'auto' });
    expect(borderPayload({ widthPt: 0, spacePt: -2 }).size).toBe(6);
    expect(borderPayload({ widthPt: 0.1 }).size).toBe(2);
  });

  it('offers sane presets', () => {
    expect(BORDER_SIDE_PRESETS.find((p) => p.id === 'all').sides).toEqual(['top', 'bottom', 'left', 'right']);
    expect(BORDER_SIDE_PRESETS.find((p) => p.id === 'none').sides).toEqual([]);
    expect(BORDER_STYLES.map((s) => s.id)).toContain('dashed');
    expect(BORDER_WIDTHS).toContain(0.75);
  });
});

describe('applyParagraphBorders', () => {
  it('clears old lines then draws the preset sides on every paragraph', async () => {
    const api = fakeApi();
    await applyParagraphBorders(api, ['p1', 'p2'], { preset: 'topBottom', style: 'dashed', widthPt: 1, color: '#0000ff' });
    const p1 = api.calls.filter((c) => c.target.nodeId === 'p1');
    expect(p1.map((c) => `${c.name}:${c.side}`)).toEqual(['clearBorder:all', 'setBorder:top', 'setBorder:bottom']);
    expect(p1[1]).toMatchObject({ style: 'dashed', size: 8, color: '0000ff', target: { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' } });
    expect(api.calls.filter((c) => c.target.nodeId === 'p2')).toHaveLength(3);
  });

  it('"none" only clears', async () => {
    const api = fakeApi();
    await applyParagraphBorders(api, ['p1'], { preset: 'none' });
    expect(api.calls.map((c) => c.name)).toEqual(['clearBorder']);
  });

  it('tolerates a no-op clear but surfaces real failures', async () => {
    const api = fakeApi();
    api.format.paragraph.clearBorder = async () => ({ success: false, failure: { code: 'NO_OP' } });
    await expect(applyParagraphBorders(api, ['p1'], { preset: 'bottom' })).resolves.toBeUndefined();
    api.format.paragraph.setBorder = async () => ({ success: false, failure: { code: 'INVALID', message: 'bad side' } });
    await expect(applyParagraphBorders(api, ['p1'], { preset: 'bottom' })).rejects.toThrow('bad side');
  });
});

describe('shadeParagraphs', () => {
  it('fills or clears', async () => {
    const api = fakeApi();
    await shadeParagraphs(api, ['p1'], '#ffff00');
    await shadeParagraphs(api, ['p2'], null);
    expect(api.calls).toEqual([
      { name: 'setShading', target: { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' }, fill: 'ffff00', pattern: 'clear' },
      { name: 'clearShading', target: { kind: 'block', nodeType: 'paragraph', nodeId: 'p2' } },
    ]);
  });
});

describe('insertHorizontalRule', () => {
  /**
   * A paragraph model: `text` per block, caret as [blockId, offset]. Enter
   * splits like the engine does; the caret stays with the text after it.
   */
  const fakeEditor = (texts, caret, kind = 'paragraph', story) => {
    const api = fakeApi();
    let blocks = texts.map((text, i) => ({ nodeId: `p${i + 1}`, text }));
    let [caretId, offset] = caret;
    let n = blocks.length;
    const enters = [];
    api.selection = { current: async () => ({ selectionTarget: { start: { blockId: caretId }, ...(story ? { story } : {}) } }) };
    api.getNodeById = async ({ nodeId }) => { const b = blocks.find((x) => x.nodeId === nodeId); return { node: { [kind]: { inlines: b?.text ? [{ kind: 'run', run: { text: b.text } }] : [] } } }; };
    api.blocks = { list: async () => ({ blocks: blocks.map((b) => ({ nodeId: b.nodeId })) }) };
    if (story) {
      const read = api.getNodeById;
      api.getNodeById = async () => { throw new Error('Not in the body'); };
      api.getNode = async (target) => { expect(target.story).toEqual(story); return read(target); };
      const list = api.blocks.list;
      api.blocks.list = async (input) => { expect(input).toEqual({ in: story }); return list(); };
    }
    const ed = {
      doc: api,
      editCommands: { text: { enter: async () => {
        enters.push(caretId);
        const at = blocks.findIndex((b) => b.nodeId === caretId);
        const cur = blocks[at];
        const head = cur.text.slice(0, offset);
        const tail = cur.text.slice(offset);
        const fresh = { nodeId: `p${++n}`, text: tail };
        cur.text = head;
        blocks.splice(at + 1, 0, fresh);
        caretId = fresh.nodeId; offset = 0;
        return { status: 'committed' };
      } } },
    };
    return { ed, api, enters, texts: () => blocks.map((b) => `${b.nodeId}:${b.text}`), caret: () => caretId };
  };
  const borders = (api) => api.calls.filter((c) => c.name === 'setBorder').map((c) => `${c.target.nodeId}:${c.side}`);

  describe.each([
    { kind: 'story', storyType: 'footnote', noteId: '1' },
    { kind: 'story', storyType: 'headerFooterPart', refId: 'rIdHeader' },
  ])('horizontal lines in $storyType', (story) => {
    it.each([
      ['', 0, ['p1:', 'p2:'], 'p1:bottom'],
      ['words', 5, ['p1:words', 'p2:', 'p3:'], 'p2:bottom'],
      ['head tail', 4, ['p1:head', 'p2:', 'p3: tail'], 'p2:bottom'],
    ])('inserts at offset %s/%s within the selected story', async (text, offset, expected, border) => {
      const f = fakeEditor([text], ['p1', offset], 'paragraph', story);
      expect(await insertHorizontalRule(f.ed)).toBe(true);
      expect(f.texts()).toEqual(expected);
      expect(borders(f.api)).toEqual([border]);
      for (const call of f.api.calls) expect(call.target.story).toEqual(story);
      expect(f.caret()).toBe(expected.at(-1).split(':')[0]);
    });
  });

  it('borders a blank line and moves the caret below it', async () => {
    const f = fakeEditor(['', 'more'], ['p1', 0]);
    expect(await insertHorizontalRule(f.ed)).toBe(true);
    expect(borders(f.api)).toEqual(['p1:bottom']);
    expect(f.api.calls[0]).toMatchObject({ style: 'single', size: 6, color: 'auto' });
    expect(f.texts()).toEqual(['p1:', 'p3:', 'p2:more']);
    expect(f.caret()).toBe('p3');
    expect(f.api.calls.some((c) => c.name === 'clearBorder' && c.target.nodeId === 'p3')).toBe(true);
  });

  it('at the end of a paragraph, opens a new line for the rule and another below', async () => {
    const f = fakeEditor(['words'], ['p1', 5]);
    expect(await insertHorizontalRule(f.ed)).toBe(true);
    expect(f.texts()).toEqual(['p1:words', 'p2:', 'p3:']);
    expect(borders(f.api)).toEqual(['p2:bottom']);
    expect(f.caret()).toBe('p3');
  });

  it('in the middle of a paragraph, puts the rule between the two halves', async () => {
    const f = fakeEditor(['head tail'], ['p1', 4]);
    expect(await insertHorizontalRule(f.ed)).toBe(true);
    // The engine keeps the id on the text before the split; the tail moves to a new block.
    expect(f.texts()).toEqual(['p1:head', 'p2:', 'p3: tail']);
    expect(borders(f.api)).toEqual(['p2:bottom']);
    expect(f.caret()).toBe('p3');
    expect(f.enters).toEqual(['p1', 'p2']);
  });

  it('in the middle of a heading, inserts a separate rule without bordering the heading text', async () => {
    const f = fakeEditor(['head tail'], ['p1', 4], 'heading');
    expect(await insertHorizontalRule(f.ed)).toBe(true);
    expect(f.texts()).toEqual(['p1:head', 'p2:', 'p3: tail']);
    expect(borders(f.api)).toEqual(['p2:bottom']);
    expect(f.caret()).toBe('p3');
  });

  it.each(['rejected', 'missing', 'unsupported'])('does not change a paragraph when its content cannot be read (%s)', async (failure) => {
    const f = fakeEditor(['Keep this text'], ['p1', 4]);
    f.api.getNodeById = async () => {
      if (failure === 'rejected') throw new Error('Read failed');
      return failure === 'missing' ? null : { node: { kind: 'table', table: {} } };
    };
    await expect(insertHorizontalRule(f.ed)).rejects.toThrow(/read/i);
    expect(f.api.calls).toEqual([]);
    expect(f.enters).toEqual([]);
    expect(f.texts()).toEqual(['p1:Keep this text']);
  });

  it('does not add a border if reading the text after the split fails', async () => {
    const f = fakeEditor(['head tail'], ['p1', 4]);
    const read = f.api.getNodeById;
    f.api.getNodeById = async (input) => {
      if (input.nodeId === 'p2') throw new Error('Read failed');
      return read(input);
    };
    await expect(insertHorizontalRule(f.ed)).rejects.toThrow('Read failed');
    expect(f.api.calls).toEqual([]);
    expect(f.texts()).toEqual(['p1:head', 'p2: tail']);
    expect(f.enters).toEqual(['p1']);
  });

  it('reports when there is no caret paragraph', async () => {
    const f = fakeEditor([''], ['p1', 0]);
    f.api.selection.current = async () => null;
    expect(await insertHorizontalRule(f.ed)).toBe(false);
  });
});

describe('isEmptyParagraph', () => {
  it('sees text and non-run inlines as content', () => {
    expect(isEmptyParagraph({ node: { paragraph: { inlines: [] } } })).toBe(true);
    expect(isEmptyParagraph({ node: { paragraph: { inlines: [{ kind: 'run', run: { text: '' } }] } } })).toBe(true);
    expect(isEmptyParagraph({ node: { paragraph: { inlines: [{ kind: 'run', run: { text: 'a' } }] } } })).toBe(false);
    expect(isEmptyParagraph({ node: { paragraph: { inlines: [{ kind: 'image' }] } } })).toBe(false);
    expect(isEmptyParagraph({ node: { heading: { inlines: [{ kind: 'run', run: { text: 'Title' } }] } } })).toBe(false);
    expect(isEmptyParagraph({ node: { heading: { inlines: [] } } })).toBe(true);
    expect(isEmptyParagraph(null)).toBe(false);
  });
});

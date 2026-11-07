import { describe, expect, it, vi } from 'vitest';
import { findImageCaption } from '../src/lib/images.js';

const paragraph = (paraId, text, styleRef = null) => ({ kind: 'paragraph', paragraphIds: { paraId }, paragraph: { inlines: [{ kind: 'run', run: { text } }], ...(styleRef ? { styleRef } : {}) } });

describe('findImageCaption', () => {
  it('reads the neighbor from the block list for a picture in the body, without loading the whole document', async () => {
    const get = vi.fn();
    const api = {
      get,
      blocks: { list: vi.fn(async () => ({ blocks: [{ nodeId: 'p1', nodeType: 'paragraph' }, { nodeId: 'cap', nodeType: 'paragraph' }, { nodeId: 'p3', nodeType: 'paragraph' }] })) },
      getNodeById: vi.fn(async ({ nodeId }) => ({ node: paragraph(nodeId, nodeId === 'cap' ? 'Figure 1: A fox' : 'Text', nodeId === 'cap' ? 'Caption' : null) })),
    };
    expect(await findImageCaption(api, { anchorRef: { blockId: 'p1' } })).toEqual({ nodeId: 'cap', text: 'Figure 1: A fox' });
    // A table's caption under the picture belongs to the table below it.
    api.captions = { get: async () => ({ label: 'Table', number: 1, text: 'A fox' }) };
    expect(await findImageCaption(api, { anchorRef: { blockId: 'p1' } })).toBeNull();
    api.captions = { get: async () => { throw new Error('no field'); } };
    expect(await findImageCaption(api, { anchorRef: { blockId: 'p1' } })).toEqual({ nodeId: 'cap', text: 'Figure 1: A fox' });
    delete api.captions;
    expect(await findImageCaption(api, { anchorRef: { blockId: 'cap' } })).toBeNull();
    expect(await findImageCaption(api, { anchorRef: { blockId: 'p3' } })).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it('falls back to the document model for a picture inside a table cell or another story', async () => {
    const body = [{ kind: 'table', rows: [{ cells: [{ blocks: [paragraph('cell-p', 'Picture'), paragraph('cell-cap', 'Figure 2: In a cell', 'Caption')] }] }] }];
    const api = {
      get: vi.fn(async () => ({ body })),
      blocks: { list: vi.fn(async () => ({ blocks: [{ nodeId: 'p1', nodeType: 'paragraph' }] })) },
      getNodeById: vi.fn(),
    };
    expect(await findImageCaption(api, { anchorRef: { blockId: 'cell-p' } })).toEqual({ nodeId: 'cell-cap', text: 'Figure 2: In a cell' });
    expect(api.getNodeById).not.toHaveBeenCalled();
    const story = { kind: 'story', storyType: 'footnote', noteId: '1' };
    expect(await findImageCaption(api, { anchorRef: { blockId: 'cell-p', story } })).toEqual({ nodeId: 'cell-cap', text: 'Figure 2: In a cell', story });
    expect(api.get).toHaveBeenLastCalledWith({ in: story });
    await expect(findImageCaption(api, { anchorRef: {} })).rejects.toThrow('No image paragraph');
  });
});

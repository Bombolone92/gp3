import { describe, expect, it, vi } from 'vitest';
import { editCaption, captionImage } from '../src/lib/images.js';

describe('captions the engine does not recognize', () => {
  it('rewrites a hand-typed caption and gives it a number field when the engine cannot read it', async () => {
    const replace = vi.fn(async () => ({ success: true })), insertField = vi.fn(async () => ({ success: true }));
    const api = {
      captions: { get: vi.fn(async () => { throw new Error('caption 00000001 was not found'); }) },
      fields: { list: vi.fn(async () => ({ items: [] })), insert: insertField },
      replace, insert: vi.fn(async () => ({ success: true })),
    };
    const changes = [];
    await editCaption(api, { nodeId: '00000001', text: 'Table 3: Old words' }, 'New words', { onChange: () => changes.push(1) });
    expect(replace).toHaveBeenCalledWith(expect.objectContaining({ text: 'Table 3: New words' }));
    expect(insertField).toHaveBeenCalledWith(expect.objectContaining({ instruction: 'SEQ Table \\* ARABIC', cachedResultText: '3' }));
    expect(changes).toHaveLength(2);
  });

  it('says that pictures in headers and footers cannot be captioned', async () => {
    const api = { captions: { insert: vi.fn() }, images: { list: vi.fn() } };
    await expect(captionImage(api, { imageId: 'img:1:word_header1.xml:rId1', anchorRef: { blockId: 'ABCDEF01' } }, 'Logo')).rejects.toThrow('Captions are not available in headers and footers');
    expect(api.captions.insert).not.toHaveBeenCalled();
  });
});

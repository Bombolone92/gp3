// Files picked from disk are copied into memory at open, so a later change to
// the file on disk cannot break reads of the open document's assets.
import { describe, expect, it } from 'vitest';
import { inMemoryFile } from '../src/features/files/open';

// Chromium reads slices of a disk-backed File lazily and rejects them once the
// file changes on disk. Node's File is in memory, so this one imitates that.
class DiskFile extends File {
  changed = false;
  slice(start?: number, end?: number, type?: string): Blob {
    const part = super.slice(start, end, type);
    const read = <T>(f: () => Promise<T>) => (this.changed ? Promise.reject(new DOMException('The file changed on disk.', 'NotReadableError')) : f());
    return Object.assign(part, { arrayBuffer: () => read(() => Blob.prototype.arrayBuffer.call(part)), text: () => read(() => Blob.prototype.text.call(part)) });
  }
}

describe('inMemoryFile', () => {
  it('keeps slices readable after the file on disk changes', async () => {
    const disk = new DiskFile(['PHOTO001 project bytes'], 'test.photo', { type: 'application/x-photo', lastModified: 1234 });
    const copy = await inMemoryFile(disk);
    const part = copy.slice(9, 16);
    disk.changed = true;
    await expect(disk.slice(9, 16).text()).rejects.toThrow('changed on disk');
    expect(await part.text()).toBe('project');
    expect(await copy.slice(0, 8).text()).toBe('PHOTO001');
    expect(copy).toBeInstanceOf(File);
    expect([(copy as File).name, copy.type, (copy as File).lastModified]).toEqual(['test.photo', 'application/x-photo', 1234]);
  });

  it('leaves blobs that are not files untouched', async () => {
    const blob = new Blob(['cloud bytes']);
    expect(await inMemoryFile(blob)).toBe(blob);
  });
});

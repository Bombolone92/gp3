import { describe, it, expect } from 'vitest';
import { isImage, isVideo, isMedia, canOpenInTab } from '../src/lib/files.js';

describe('attachment types', () => {
  it('previews the image types inline', () => {
    for (const t of ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml']) {
      expect(isImage(t)).toBe(true);
    }
    for (const t of ['text/html', 'application/pdf', 'image/png; charset=x', '', undefined]) {
      expect(isImage(t)).toBe(false);
    }
  });

  it('plays the video types a <video> element can, and nothing else', () => {
    for (const t of ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-m4v']) {
      expect(isVideo(t)).toBe(true);
      expect(isMedia(t)).toBe(true);
    }
    for (const t of ['video/x-msvideo', 'video/mp4; codecs=avc1', 'audio/mp4', 'image/png', '', undefined]) {
      expect(isVideo(t)).toBe(false);
    }
    expect(isMedia('image/png')).toBe(true);
    expect(isMedia('application/pdf')).toBe(false);
  });

  it('never opens a scriptable type in a tab (object URLs keep our origin)', () => {
    expect(canOpenInTab('image/svg+xml')).toBe(false);
    expect(canOpenInTab('text/html')).toBe(false);
    expect(canOpenInTab('application/xhtml+xml')).toBe(false);
    expect(canOpenInTab('image/png')).toBe(true);
    expect(canOpenInTab('image/jpeg')).toBe(true);
  });
});

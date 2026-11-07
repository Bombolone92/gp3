import { describe, it, expect, vi, afterEach } from 'vitest';
import { BACKDROPS, BACKDROP_GROUPS, drawBackdrop } from '../src/media/backdrops.js';
import { videoRecorderMime, extForVideoMime, captureErrorMessage, mixStreams } from '../src/media/capture.js';
import {
  buildPrompt, aspectForSize, txt2imgOptions, imageErrorMessage, imageFileName, dataUrlToBlob, imageBlobFrom, generateImage, IMAGE_STYLES,
} from '../src/media/imagegen.js';
import { EditorStore } from '../src/model/store.js';
import { createActions } from '../src/ui/actions.js';
import { findClip } from '../src/model/timeline.js';
import { fixture } from './helpers.js';
import { mockContext } from './canvas-mock.js';

describe('backdrops', () => {
  it('has two dozen backdrops with unique ids in known groups', () => {
    expect(BACKDROPS.length).toBeGreaterThanOrEqual(24);
    expect(new Set(BACKDROPS.map((b) => b.id)).size).toBe(BACKDROPS.length);
    const groups = new Set(BACKDROP_GROUPS.map((g) => g.id));
    for (const b of BACKDROPS) expect(groups.has(b.group), b.id).toBe(true);
    expect(BACKDROPS.filter((b) => b.group === 'pattern').length).toBeGreaterThanOrEqual(8);
  });

  for (const b of BACKDROPS) {
    it(`${b.id} draws at tile and full size with finite values`, () => {
      for (const [w, hh] of [[160, 90], [1080, 1920]]) {
        const g = mockContext();
        drawBackdrop(g, b.id, w, hh);
        expect(g.bad).toEqual([]);
        expect(g.calls.some(([n]) => n === 'fillRect' || n === 'fill')).toBe(true);
      }
    });
  }

  it('is deterministic and rejects unknown ids', () => {
    const a = mockContext();
    const b = mockContext();
    drawBackdrop(a, 'bokeh', 320, 180);
    drawBackdrop(b, 'bokeh', 320, 180);
    expect(JSON.stringify(a.calls)).toBe(JSON.stringify(b.calls));
    expect(() => drawBackdrop(mockContext(), 'nope', 10, 10)).toThrow();
  });
});

describe('camera and screen capture helpers', () => {
  it('prefers WebM, then MP4, else lets the browser choose', () => {
    expect(videoRecorderMime((m) => m.startsWith('video/webm'))).toBe('video/webm;codecs=vp9,opus');
    expect(videoRecorderMime((m) => m === 'video/mp4')).toBe('video/mp4');
    expect(videoRecorderMime(() => false)).toBe('');
    expect(extForVideoMime('video/mp4;codecs=avc1')).toBe('mp4');
    expect(extForVideoMime('video/webm')).toBe('webm');
    expect(extForVideoMime('')).toBe('webm');
  });

  it('explains capture errors', () => {
    expect(captureErrorMessage({ name: 'NotAllowedError' }, 'camera')).toMatch(/Camera access is blocked/);
    expect(captureErrorMessage({ name: 'NotAllowedError' }, 'screen')).toMatch(/cancelled or is blocked/);
    expect(captureErrorMessage({ name: 'NotFoundError' }, 'camera')).toMatch(/No camera/);
    expect(captureErrorMessage({ name: 'NotReadableError' }, 'screen')).toMatch(/in use/);
    expect(captureErrorMessage({ message: 'Odd' })).toBe('Odd');
  });

  it('passes a single audio source straight through', () => {
    const track = (kind) => ({ kind });
    const stream = (v, a) => ({ getVideoTracks: () => v, getAudioTracks: () => a });
    globalThis.MediaStream ||= class {
      constructor(tracks) {
        this.tracks = tracks;
      }
    };
    const out = mixStreams(stream([track('video')], []), [stream([], [track('audio')]), null]);
    expect(out.stream.tracks.map((t) => t.kind)).toEqual(['video', 'audio']);
    expect(mixStreams(stream([track('video')], []), []).stream.tracks.map((t) => t.kind)).toEqual(['video']);
  });
});

describe('AI pictures', () => {
  afterEach(() => {
    delete globalThis.puter;
  });

  it('builds prompts with a style phrase', () => {
    expect(buildPrompt('  a red fox  ')).toBe('a red fox');
    expect(buildPrompt('a red fox', 'watercolor')).toMatch(/^a red fox\. Style: watercolor/);
    expect(buildPrompt('', 'photo')).toBe('');
    expect(IMAGE_STYLES[0].id).toBe('none');
  });

  it('matches the project shape and sends the ratio', () => {
    expect(aspectForSize(1920, 1080).id).toBe('16:9');
    expect(aspectForSize(1080, 1920).id).toBe('9:16');
    expect(aspectForSize(1080, 1350).id).toBe('3:4');
    expect(aspectForSize(2560, 1080).id).toBe('16:9');
    expect(txt2imgOptions('1:1')).toEqual({ ratio: { w: 1, h: 1 } });
    expect(txt2imgOptions('x', { testMode: true })).toEqual({ ratio: { w: 16, h: 9 }, test_mode: true });
  });

  it('names files and explains errors', () => {
    expect(imageFileName('a foggy pine forest at sunrise over a lake')).toBe('a foggy pine forest at sunrise.png');
    expect(imageFileName('', 'jpg')).toBe('Generated picture.jpg');
    expect(imageFileName('what/is:this?')).toBe('what is this.png');
    expect(imageErrorMessage({ code: 'moderation_flagged' })).toMatch(/content filter/);
    expect(imageErrorMessage({ code: 'insufficient_funds' })).toMatch(/balance/);
    expect(imageErrorMessage({ message: 'Boom' })).toBe('Boom');
  });

  it('reads data URLs and downloaded pictures', async () => {
    const blob = dataUrlToBlob('data:image/png;base64,iVBORw0KGgo=');
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(8);
    expect(dataUrlToBlob('https://x/y.png')).toBe(null);
    const fromImg = await imageBlobFrom({ src: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(fromImg.size).toBe(8);
    const fetched = await imageBlobFrom('https://x/y.png', async () => ({ ok: true, blob: async () => new Blob(['abc'], { type: 'image/jpeg' }) }));
    expect(fetched.type).toBe('image/jpeg');
    await expect(imageBlobFrom('https://x/y.png', async () => ({ ok: false }))).rejects.toThrow(/downloaded/);
    await expect(imageBlobFrom('https://x/y.txt', async () => ({ ok: true, blob: async () => new Blob(['abc'], { type: 'text/html' }) }))).rejects.toThrow(/not a picture/);
    await expect(imageBlobFrom(null)).rejects.toThrow(/No picture/);
  });

  it('generates through puter.ai.txt2img and reports failures readably', async () => {
    await expect(generateImage('a cat')).rejects.toThrow(/needs Puter/);
    await expect(generateImage('   ')).rejects.toThrow(/Describe/);
    const txt2img = vi.fn(async () => ({ src: 'data:image/png;base64,iVBORw0KGgo=' }));
    globalThis.puter = { ai: { txt2img } };
    const out = await generateImage('a cat', { aspect: '9:16', style: 'photo' });
    expect(out.blob.size).toBe(8);
    expect(out.prompt).toBe('a cat');
    expect(txt2img).toHaveBeenCalledWith(expect.stringMatching(/^a cat\. Style: photorealistic/), { ratio: { w: 9, h: 16 } });
    globalThis.puter = { ai: { txt2img: async () => { throw { code: 'moderation_flagged' }; } } };
    await expect(generateImage('x')).rejects.toThrow(/content filter/);
  });
});

describe('graphic actions', () => {
  it('adds multi-color graphics with their original colors', () => {
    const store = new EditorStore(fixture());
    const actions = createActions({ store });
    const face = actions.addSticker('face-smile', { color: '#ffc93c' });
    expect(face.colorMode).toBe('original');
    const star = actions.addSticker('star', { color: '#ff0000' });
    expect(star.colorMode).toBeUndefined();
    const custom = actions.addSticker('face-smile', { color: '#00ff00', colorMode: 'custom' });
    expect(findClip(store.project, custom.id).clip.colorMode).toBeUndefined();
  });
});

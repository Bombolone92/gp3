// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { imageElementFrom, imageAtCaret, domImageId, matchImage, currentWrap, contentWidthPx, sizeToWidth, applyWrap, captionImage, WRAP_OPTIONS, replaceImage, normalizeImageUrl, imageNameFromUrl, fetchImageFromUrl, imageFilesFrom, TRANSFORM_OPTIONS, currentTransform, transformImage } from '../src/lib/images.js';
import { embeddableImage } from '../src/lib/images.js';

describe('image lookup', () => {
  it('finds the painted image under a target and its short id', () => {
    const host = document.createElement('div');
    host.innerHTML = '<div class="document-fragment document-image-fragment" data-image-id="7"><img alt=""></div><p>text</p>';
    const img = host.querySelector('img');
    expect(imageElementFrom(img, host)).toBe(img);
    expect(domImageId(img)).toBe('7');
    expect(imageElementFrom(host.querySelector('p'), host)).toBeNull();
    const outside = document.createElement('img');
    expect(imageElementFrom(outside, host)).toBeNull();
  });

  it('matches the API list by exact id, short segment, or the only image', () => {
    const a = { imageId: 'img:1:word_document.xml:rId9' };
    const b = { imageId: 'img:2:word_document.xml:rId10' };
    expect(matchImage([a, b], '2')).toBe(b);
    expect(matchImage([a, b], 'img:1:word_document.xml:rId9')).toBe(a);
    expect(matchImage([a, b], '9')).toBeNull();
    expect(matchImage([a], null)).toBe(a);
    expect(matchImage([a], '2')).toBeNull();
    expect(matchImage([a], 'img:2:word_document.xml:rId10')).toBeNull();
    expect(matchImage([], '1')).toBeNull();
  });
});

describe('wrap and size helpers', () => {
  it('names the current wrapping', () => {
    expect(currentWrap({ placement: 'inline' })).toBe('inline');
    expect(currentWrap({ placement: 'floating', wrap: { type: 'Square' }, anchorData: { alignH: 'right' } })).toBe('right');
    expect(currentWrap({ placement: 'floating', wrap: { type: 'TopAndBottom' } })).toBe('center');
    expect(currentWrap({ placement: 'floating', wrap: { type: 'Tight' }, anchorData: {} })).toBeNull();
    expect(WRAP_OPTIONS.map((o) => o.id)).toEqual(['inline', 'left', 'right', 'center']);
  });

  it('computes the text column and fits a size into it', () => {
    expect(contentWidthPx({ pageSetup: { width: 8.5 }, margins: { left: 1, right: 1 } })).toBe(624);
    expect(contentWidthPx(null)).toBe(624);
    expect(contentWidthPx({ pageSetup: { width: 8.27 }, margins: { left: 0.79, right: 0.79 } })).toBe(642);
    expect(sizeToWidth(300, 150, 624)).toEqual({ width: 624, height: 312, unit: 'px' });
    expect(sizeToWidth(0, 150, 624)).toBeNull();
  });
});

describe('applyWrap', () => {
  const fakeApi = () => {
    const calls = [];
    const ok = (name) => async (input) => { calls.push([name, input]); return { success: true }; };
    return { calls, images: { convertToInline: ok('inline'), convertToFloating: ok('floating'), setWrapType: ok('wrap'), setPosition: ok('position') } };
  };

  it('floats an inline image and positions it for side wrapping', async () => {
    const api = fakeApi();
    await applyWrap(api, { imageId: 'i', properties: { placement: 'inline' } }, 'right');
    expect(api.calls.map((c) => c[0])).toEqual(['floating', 'wrap', 'position']);
    expect(api.calls[1][1].type).toBe('Square');
    expect(api.calls[2][1].position.alignH).toBe('right');
  });

  it('uses top-and-bottom for centered and goes back inline in one step', async () => {
    const api = fakeApi();
    await applyWrap(api, { imageId: 'i', properties: { placement: 'floating' } }, 'center');
    expect(api.calls.map((c) => c[0])).toEqual(['wrap', 'position']);
    expect(api.calls[0][1].type).toBe('TopAndBottom');
    await applyWrap(api, { imageId: 'i', properties: { placement: 'floating' } }, 'inline');
    expect(api.calls[2][0]).toBe('inline');
    await applyWrap(api, { imageId: 'i', properties: { placement: 'inline' } }, 'inline');
    expect(api.calls.length).toBe(3);
  });

  it('throws on a rejected step', async () => {
    const api = fakeApi();
    api.images.setWrapType = async () => ({ success: false, failure: { message: 'no' } });
    await expect(applyWrap(api, { imageId: 'i', properties: { placement: 'floating' } }, 'left')).rejects.toThrow('no');
  });
});

describe('captionImage', () => {
  it('inserts descriptions with automatic numbering and reports rejected insertions', async () => {
    const calls = [];
    const api = {
      get: async () => ({ body: [{ kind: 'paragraph', paragraphIds: { paraId: 'p1' }, paragraph: { inlines: [] } }] }),
      captions: { insert: async (input) => { calls.push(input); return { success: true }; } },
    };
    const image = { imageId: 'i', anchorRef: { blockId: 'p1' }, properties: {} };
    await captionImage(api, image, 'Figure 1: A fox');
    expect(calls).toEqual([{ adjacentTo: { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' }, position: 'below', label: 'Figure', text: 'A fox' }]);
    api.captions.insert = async () => ({ success: false, failure: { message: 'no room' } });
    await expect(captionImage(api, image, 'A fox')).rejects.toThrow('no room');
  });
});

describe('replaceImage', () => {
  const fake = () => { const calls = []; const ok = (name) => async (input) => { calls.push([name, input]); return { success: true }; }; return { calls, images: { replaceSource: ok('replace'), setSize: ok('size') } }; };

  it('swaps the source and fits the new picture to the old width', async () => {
    const api = fake();
    await replaceImage(api, { imageId: 'img:1', properties: { size: { width: 300, height: 100, unit: 'px' } } }, { src: 'data:image/png;base64,AAAA', width: 600, height: 300 });
    expect(api.calls).toEqual([
      ['replace', { imageId: 'img:1', src: 'data:image/png;base64,AAAA', resetSize: true }],
      ['size', { imageId: 'img:1', size: { width: 300, height: 150, unit: 'px' } }],
    ]);
  });

  it('keeps the intrinsic size when the old width or new dimensions are unknown', async () => {
    const api = fake();
    await replaceImage(api, { imageId: 'img:1', properties: {} }, { src: 'data:x', width: 10, height: 10 });
    await replaceImage(api, { imageId: 'img:1', properties: { size: { width: 200 } } }, { src: 'data:x' });
    expect(api.calls.map((c) => c[0])).toEqual(['replace', 'replace']);
    await expect(replaceImage(api, { imageId: 'img:1' }, {})).rejects.toThrow('No image');
  });
});

describe('images from the web', () => {
  it.each([
    ['https://[2001:db8::1]/photo.png', 'https://[2001:db8::1]/photo.png'],
    ['[2001:db8::1]:8443/photo.png', 'https://[2001:db8::1]:8443/photo.png'],
    ['http://[::1]:5173/photo.png', 'http://[::1]:5173/photo.png'],
    ['[::1]/photo.png', 'https://[::1]/photo.png'],
  ])('accepts a valid IPv6 image address: %s', (input, expected) => {
    expect(normalizeImageUrl(input)).toBe(expected);
  });

  it.each(['https://[invalid]/photo.png', 'https://[2001:db8::1/photo.png', '[::1]:70000/photo.png', 'ftp://[::1]/photo.png'])('rejects an invalid or unsupported IPv6 image address: %s', (input) => {
    expect(normalizeImageUrl(input)).toBeNull();
  });

  it.each([
    ['example.com:8443/a.png', 'https://example.com:8443/a.png'],
    ['localhost:5173/photo.png', 'https://localhost:5173/photo.png'],
    ['example.com:8443?image=1', 'https://example.com:8443/?image=1'],
    ['example.com:443', 'https://example.com/'],
  ])('accepts a scheme-less image address with a port: %s', (input, expected) => {
    expect(normalizeImageUrl(input)).toBe(expected);
  });

  it.each(['javascript:alert(1)', 'javascript:1234/foo', 'mailto:user@example.com', 'data:image/png;base64,AAAA', 'ftp://example.com/a.png', 'example.com:70000/a.png'])('rejects unsupported schemes and invalid ports: %s', (input) => {
    expect(normalizeImageUrl(input)).toBeNull();
  });

  it('fetches the normalized address when a port is supplied without a scheme', async () => {
    let fetched;
    const fetchFn = async (href) => {
      fetched = href;
      return new Response('image', { headers: { 'Content-Type': 'image/png' } });
    };
    const file = await fetchImageFromUrl('localhost:5173/photo.png', { fetchFn });
    expect(fetched).toBe('https://localhost:5173/photo.png');
    expect(file.name).toBe('photo.png');
    expect(file.size).toBe(5);
  });

  it('accepts http(s) addresses, adding the scheme when it is missing', () => {
    expect(normalizeImageUrl('example.com/a.png')).toBe('https://example.com/a.png');
    expect(normalizeImageUrl('http://example.com/a.png?x=1')).toBe('http://example.com/a.png?x=1');
    expect(normalizeImageUrl('ftp://example.com/a.png')).toBeNull();
    expect(normalizeImageUrl('data:image/png;base64,AAAA')).toBeNull();
    expect(normalizeImageUrl('')).toBeNull();
  });

  it('names the file after the last path segment', () => {
    expect(imageNameFromUrl('https://example.com/pics/Sunset%20Beach.jpg?size=large')).toBe('Sunset Beach.jpg');
    expect(imageNameFromUrl('https://example.com/')).toBe('image');
    expect(imageNameFromUrl('not a url')).toBe('image');
  });

  it('fetches a picture into a typed File', async () => {
    const fetchFn = async (url, opts) => ({ ok: true, status: 200, url, opts, blob: async () => new Blob(['abc'], { type: 'image/jpeg' }) });
    const file = await fetchImageFromUrl('https://example.com/photo', { fetchFn });
    expect(file.name).toBe('photo.jpg');
    expect(file.type).toBe('image/jpeg');
    expect(file.size).toBe(3);
  });

  it('stops oversized downloads as soon as they exceed the limit', async () => {
    let chunksRead = 0;
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) {
        chunksRead += 1;
        controller.enqueue(new Uint8Array(1024));
        if (chunksRead === 100) controller.close();
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const fetchFn = async () => new Response(body, { headers: { 'Content-Type': 'image/png' } });
    await expect(fetchImageFromUrl('https://example.com/large.png', { fetchFn, maxBytes: 2048 })).rejects.toThrow('15 MB');
    expect(chunksRead).toBe(3);
    expect(cancelled).toBe(true);
  });

  it('rejects a declared oversized response before reading any body chunks', async () => {
    let read = false;
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) { read = true; controller.close(); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const fetchFn = async () => new Response(body, { headers: { 'Content-Length': '100', 'Content-Type': 'image/png' } });
    await expect(fetchImageFromUrl('https://example.com/a.png', { fetchFn, maxBytes: 10 })).rejects.toThrow('15 MB');
    expect(read).toBe(false);
    expect(cancelled).toBe(true);
  });

  it('preserves a streamed picture at the size limit even without Content-Length', async () => {
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4]));
      controller.close();
    } });
    const fetchFn = async () => new Response(body, { headers: { 'Content-Type': 'image/jpeg' } });
    const file = await fetchImageFromUrl('https://example.com/photo', { fetchFn, maxBytes: 4 });
    expect(file.size).toBe(4);
    expect(file.type).toBe('image/jpeg');
    expect(file.name).toBe('photo.jpg');
    const bytes = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve([...new Uint8Array(reader.result)]);
      reader.readAsArrayBuffer(file);
    });
    expect(bytes).toEqual([1, 2, 3, 4]);
  });

  it('rejects errors, non-pictures, oversized files, and blocked reads with readable messages', async () => {
    await expect(fetchImageFromUrl('nope', { fetchFn: async () => ({ ok: true }) })).rejects.toThrow('valid web address');
    await expect(fetchImageFromUrl('https://example.com/a.png', { fetchFn: async () => ({ ok: false, status: 404 }) })).rejects.toThrow('404');
    await expect(fetchImageFromUrl('https://example.com/page', { fetchFn: async () => ({ ok: true, blob: async () => new Blob(['<html>'], { type: 'text/html' }) }) })).rejects.toThrow('not a picture');
    await expect(fetchImageFromUrl('https://example.com/a.png', { fetchFn: async () => ({ ok: true, blob: async () => new Blob(['xx'], { type: 'image/png' }) }), maxBytes: 1 })).rejects.toThrow('15 MB');
    await expect(fetchImageFromUrl('https://example.com/a.png', { fetchFn: async () => { throw new TypeError('Failed to fetch'); } })).rejects.toThrow('does not let the browser');
  });

  it('names the picture by its extension when the server sends no image type', async () => {
    const fetchFn = async () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'application/octet-stream' }) });
    const file = await fetchImageFromUrl('https://example.com/logo.webp', { fetchFn });
    expect(file.name).toBe('logo.webp');
    expect(file.type).toBe('image/webp');
    expect((await fetchImageFromUrl('https://example.com/photo.JPG', { fetchFn })).type).toBe('image/jpeg');
  });

  it('refuses a picture in a format the document cannot hold, by name', async () => {
    const svg = async () => ({ ok: true, blob: async () => new Blob(['<svg/>'], { type: 'image/svg+xml' }) });
    await expect(fetchImageFromUrl('https://example.com/logo.svg', { fetchFn: svg })).rejects.toThrow('not supported');
    const avif = async () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'image/avif' }) });
    await expect(fetchImageFromUrl('https://example.com/photo', { fetchFn: avif })).rejects.toThrow('PNG, JPEG, GIF, WebP, or BMP');
    const jpeg = async () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'image/jpeg; charset=binary' }) });
    expect((await fetchImageFromUrl('https://example.com/photo', { fetchFn: jpeg })).name).toBe('photo.jpg');
  });
});

describe('dropped files', () => {
  it('keeps only the pictures, by type or extension', () => {
    const files = [
      new File(['a'], 'photo.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'notes.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
      new File(['c'], 'scan.PNG', { type: '' }),
      new File(['d'], 'readme.txt', { type: 'text/plain' }),
    ];
    expect(imageFilesFrom({ files }).map((f) => f.name)).toEqual(['photo.jpg', 'scan.PNG']);
    expect(imageFilesFrom(null)).toEqual([]);
    expect(imageFilesFrom({})).toEqual([]);
  });
});

describe('rotation and flips', () => {
  const fake = () => {
    const calls = [];
    return { calls, images: { rotate: async (i) => { calls.push(['rotate', i.angle]); return { success: true }; }, flip: async (i) => { calls.push(['flip', i.horizontal, i.vertical]); return { success: true }; } } };
  };
  it('reads the current transform, normalizing the angle', () => {
    expect(currentTransform(null)).toEqual({ rotation: 0, horizontalFlip: false, verticalFlip: false });
    expect(currentTransform({ transform: { rotation: -90, horizontalFlip: true } })).toEqual({ rotation: 270, horizontalFlip: true, verticalFlip: false });
    expect(currentTransform({ transform: { rotation: 450 } }).rotation).toBe(90);
    expect(TRANSFORM_OPTIONS.map((o) => o.id)).toEqual(['rotateRight', 'rotateLeft', 'flipH', 'flipV', 'reset']);
  });

  it('turns from the current angle and toggles flips as absolute states', async () => {
    const api = fake();
    const image = { imageId: 'i1', properties: { transform: { rotation: 270, horizontalFlip: true } } };
    await transformImage(api, image, 'rotateRight');
    await transformImage(api, image, 'rotateLeft');
    await transformImage(api, image, 'flipH');
    await transformImage(api, image, 'flipV');
    await transformImage(api, image, 'reset');
    expect(api.calls).toEqual([['rotate', 0], ['rotate', 180], ['flip', false, undefined], ['flip', undefined, true], ['rotate', 0], ['flip', false, false]]);
    await expect(transformImage(api, image, 'spin')).rejects.toThrow('Unknown transform');
  });

  it('skips the reset writes for an untouched picture', async () => {
    const api = fake();
    await transformImage(api, { imageId: 'i1', properties: {} }, 'reset');
    expect(api.calls).toEqual([]);
  });
});

describe('distance from text', () => {
  it('reads the closest distance choice and whether text wraps', async () => {
    const { IMAGE_DISTANCES, currentDistance, wrapsText, setImageDistance } = await import('../src/lib/images.js');
    expect(IMAGE_DISTANCES.map((d) => d.id)).toEqual(['none', 'small', 'medium', 'large']);
    // The engine reports pixels (EMU / 9525): 0.2 in is 19.2 px, the default 0.125 in is 12 px.
    expect(currentDistance({ wrap: { type: 'Square', attrs: { distTop: 19.2, distBottom: 19.2, distLeft: 19.2, distRight: 19.2 } } })).toBe('medium');
    expect(currentDistance({ wrap: { type: 'Square', attrs: { distTop: 12, distBottom: 12, distLeft: 12, distRight: 12 } } })).toBe('small');
    expect(currentDistance({ wrap: { type: 'Square', attrs: { distTop: 38.4 } } })).toBe('small');
    expect(currentDistance({ wrap: { type: 'Square', attrs: { distTop: 0.4, distBottom: 0.4, distLeft: 0.4, distRight: 0.4 } } })).toBe('none');
    expect(currentDistance({})).toBe('none');
    expect(wrapsText({ placement: 'floating', wrap: { type: 'Square' } })).toBe(true);
    expect(wrapsText({ placement: 'inline', wrap: { type: 'Inline' } })).toBe(false);
    const calls = [];
    const api = { images: { setWrapDistances: async (i) => { calls.push(i); return { success: true }; } } };
    const image = { imageId: 'img9', properties: {} };
    await setImageDistance(api, image, 'large');
    // 0.4 in, sent as the pixels the engine expects.
    expect(calls[0]).toEqual({ imageId: 'img9', distances: { distTop: 38.4, distBottom: 38.4, distLeft: 38.4, distRight: 38.4 } });
    await expect(setImageDistance(api, image, 'huge')).rejects.toThrow('Unknown distance');
    await expect(setImageDistance({ images: { setWrapDistances: async () => ({ success: false, failure: { message: 'no' } }) } }, image, 'small')).rejects.toThrow('no');
  });
});

describe('embeddableImage', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
  it('keeps a PNG or JPEG as it is, labelled by its bytes rather than its file type', async () => {
    expect(await embeddableImage(png)).toBe(png);
    expect(await embeddableImage(png.replace('image/png', 'application/octet-stream'))).toBe(png);
    expect(await embeddableImage('https://example.com/photo.jpg')).toBe('https://example.com/photo.jpg');
  });
  it('gives up on a GIF where there is no canvas to redraw it with, and leaves unknown bytes to the engine', async () => {
    const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    expect(await embeddableImage(gif)).toBeNull();
    expect(await embeddableImage('data:image/png;base64,AQID')).toBe('data:image/png;base64,AQID');
  });
});

describe('the image at the caret', () => {
  const paint = () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="document-fragment" data-source-node-id="p1" data-pm-start="1" data-pm-end="40">
        <div class="document-line"><img class="document-inline-image" data-image-id="1" data-pm-start="1" data-pm-end="2">text</div>
        <div class="document-line"><img class="document-inline-image" data-image-id="2" data-pm-start="12" data-pm-end="13"></div>
      </div>
      <div class="document-fragment" data-source-node-id="p2" data-pm-start="60" data-pm-end="80"></div>
      <div class="document-fragment" data-source-node-id="p2" data-pm-start="80" data-pm-end="120">
        <div class="document-line"><img class="document-inline-image" data-image-id="3" data-pm-start="90" data-pm-end="91"></div>
      </div>`;
    return host;
  };
  const caret = (blockId, offset, extra = {}) => ({ empty: true, selectionTarget: { start: { kind: 'text', blockId, offset }, end: { kind: 'text', blockId, offset } }, ...extra });
  const id = (el) => el?.getAttribute('data-image-id') ?? null;

  it('finds the picture just before the caret, else the one just after it', () => {
    const host = paint();
    expect(id(imageAtCaret(host, caret('p1', 0)))).toBe('1');
    expect(id(imageAtCaret(host, caret('p1', 1)))).toBe('1');
    expect(id(imageAtCaret(host, caret('p1', 2)))).toBe(null);
    expect(id(imageAtCaret(host, caret('p1', 11)))).toBe('2');
    expect(id(imageAtCaret(host, caret('p1', 12)))).toBe('2');
  });

  it('measures a paragraph split across pages from its first fragment', () => {
    const host = paint();
    expect(id(imageAtCaret(host, caret('p2', 30)))).toBe('3');
    expect(id(imageAtCaret(host, caret('p2', 31)))).toBe('3');
    expect(id(imageAtCaret(host, caret('p2', 29)))).toBe(null);
  });

  it('answers nothing for a range, an unpainted paragraph, or no selection', () => {
    const host = paint();
    expect(imageAtCaret(host, { empty: false, selectionTarget: { start: { kind: 'text', blockId: 'p1', offset: 1 } } })).toBe(null);
    expect(imageAtCaret(host, caret('missing', 1))).toBe(null);
    expect(imageAtCaret(host, null)).toBe(null);
    expect(imageAtCaret(host, { empty: true, selectionTarget: null })).toBe(null);
    expect(imageAtCaret(null, caret('p1', 1))).toBe(null);
  });
});

describe('embeddableImage redrawing through a canvas', () => {
  const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  /** A canvas whose encodings are as long as the test says, painted with the given alpha. */
  function fakeCanvas({ pngLength, jpegLength, alpha = 255, width = 3000, height = 2000 }) {
    const calls = [];
    const canvas = {
      width: 0, height: 0,
      getContext: () => ({
        drawImage() {},
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(alpha) }),
      }),
      toDataURL: (type, quality) => { calls.push([type, quality]); return `data:${type};base64,${'A'.repeat(type === 'image/png' ? pngLength : jpegLength)}`; },
    };
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? canvas : create(tag)));
    vi.stubGlobal('Image', class { set src(_) { queueMicrotask(() => this.onload?.()); } get naturalWidth() { return width; } get naturalHeight() { return height; } });
    vi.stubGlobal('CanvasRenderingContext2D', class {});
    return calls;
  }
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('keeps a small or a transparent picture as a PNG without trying a JPEG', async () => {
    let calls = fakeCanvas({ pngLength: 100000, jpegLength: 100 });
    expect((await embeddableImage(gif)).startsWith('data:image/png')).toBe(true);
    expect(calls).toEqual([['image/png', undefined]]);
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    calls = fakeCanvas({ pngLength: 3000000, jpegLength: 100, alpha: 200 });
    expect((await embeddableImage(gif)).startsWith('data:image/png')).toBe(true);
    expect(calls).toEqual([['image/png', undefined]]);
  });

  it('puts a large opaque picture in as a JPEG when that is smaller, else keeps the PNG', async () => {
    let calls = fakeCanvas({ pngLength: 3000000, jpegLength: 400000 });
    expect((await embeddableImage(gif)).startsWith('data:image/jpeg')).toBe(true);
    expect(calls).toEqual([['image/png', undefined], ['image/jpeg', 0.92]]);
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    // A large flat drawing: its PNG is the smaller file and stays.
    calls = fakeCanvas({ pngLength: 3000000, jpegLength: 3500000 });
    expect((await embeddableImage(gif)).startsWith('data:image/png')).toBe(true);
    expect(calls.length).toBe(2);
  });
});

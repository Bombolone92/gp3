import { parseDataUrl } from './imagegen.js';
import { imageInsertionText, MAX_IMAGE_BYTES, embeddableImage, contentWidthPx, sizeToWidth } from './images.js';
import { imageFormat, imageSize, IMAGE_MIMES } from './hwp/image.js';

const pixelSize = value => /^(?:\d+(?:\.\d*)?|\.\d+)(?:px)?$/i.test(value || '') && Number.parseFloat(value) > 0 ? Number.parseFloat(value) : null;
function base64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

export function imageImportState(value) {
  let prefix;
  do { prefix = `SDIMPORTIMAGE${crypto.randomUUID().replaceAll('-', '')}X`; } while (value.includes(prefix));
  return { prefix, images: [], sources: new Map() };
}

/** Native HTML insertion omits images. Keep their exact inline positions as text. */
export function prepareHtmlImages(value, state = null, { inlineMarkers = false, imagesOnly = false } = {}) {
  if (typeof DOMParser === 'undefined') return null;
  const document = new DOMParser().parseFromString(value, 'text/html');
  if (imagesOnly && [...document.body.childNodes].some(node => node.nodeType === 1 ? node.localName !== 'img' : node.nodeType === 3 && node.textContent.trim())) return null;
  if (imagesOnly) for (const node of [...document.body.childNodes]) if (node.nodeType === 8) node.remove();
  state ??= imageImportState(document.body.textContent);
  const { images, sources, prefix } = state, before = images.length;
  for (const image of document.querySelectorAll('img')) {
    const source = image.getAttribute('src') || '';
    if (!/^data:image\//i.test(source)) continue;
    if (!sources.has(source)) {
      let resource = null;
      try {
        const comma = source.indexOf(','), header = source.slice(0, comma);
        const data = comma < 0 ? null : parseDataUrl(`${header.split(';')[0]}${/;base64$/i.test(header) ? ';base64' : ''}${source.slice(comma)}`, { maxBytes: MAX_IMAGE_BYTES });
        const format = data && imageFormat(data.bytes), dimensions = data && imageSize(data.bytes);
        if (['png', 'jpg', 'gif', 'webp', 'bmp'].includes(format) && dimensions && dimensions.width * dimensions.height <= 40000000) {
          resource = { src: `data:${IMAGE_MIMES[format]};base64,${base64(data.bytes)}`, ...dimensions };
        }
      } catch { /* Leave unsupported or invalid sources to the existing importer. */ }
      sources.set(source, resource);
    }
    const resource = sources.get(source);
    if (!resource) continue;
    let width = pixelSize(image.style.width) || pixelSize(image.getAttribute('width'));
    let height = pixelSize(image.style.height) || pixelSize(image.getAttribute('height'));
    // A page that sizes its pictures in pixels is followed; one that does not (a photo sized by a
    // stylesheet, or not at all) leaves the size to the engine, which fits the picture to the text column.
    const sized = !!(width || height);
    if (!width) width = height ? height * resource.width / resource.height : resource.width;
    if (!height) height = width * resource.height / resource.width;
    if (width > 1000000 || height > 1000000) { width = resource.width; height = resource.height; }
    const marker = `${prefix}${images.length}Z`;
    images.push({ marker, src: resource.src, ...imageInsertionText(image.getAttribute('alt') || image.getAttribute('title') || ''), ...(sized ? { size: { width, height, unit: 'px' } } : {}) });
    const replacement = inlineMarkers ? document.createElement('span') : document.createTextNode(marker);
    if (inlineMarkers) replacement.textContent = marker;
    image.replaceWith(replacement);
  }
  return images.length > before ? { value: document.body.innerHTML, ...state } : null;
}

const checked = result => {
  if (result == null || result.success === false) throw new Error(result?.failure?.message || 'Could not import an embedded picture');
};

/**
 * Turn the prepared pictures into ones the engine can hold: a GIF, WebP, or
 * BMP is redrawn as a PNG where a canvas is at hand, and dropped (its marker
 * removed, the drop counted) where there is none. Resolves the number dropped.
 */
export async function embedImportedImages(prepared) {
  let dropped = 0;
  for (const image of prepared.images) {
    if (image.dropped) { dropped += 1; continue; }
    const src = await embeddableImage(image.src);
    if (src) image.src = src;
    else { image.dropped = true; dropped += 1; }
  }
  return dropped;
}

/** Read positions once, then replace markers from right to left in each paragraph. */
export async function restoreImportedImages(api, prepared) {
  const locations = [], blocks = new Set(), found = new Set();
  const pattern = new RegExp(`${prepared.prefix}(\\d+)Z`, 'g');
  let offset = 0;
  while (true) {
    const result = await api.find({ select: { type: 'text', pattern: prepared.prefix, caseSensitive: true }, limit: 1000, offset });
    const items = result.items || [];
    for (const item of items) {
      if (blocks.has(item.address?.nodeId)) continue;
      blocks.add(item.address?.nodeId);
      const inlines = (item.node?.paragraph || item.node?.heading)?.inlines;
      if (!inlines || inlines.some(inline => inline.kind !== 'run')) throw new Error('Could not locate an embedded picture');
      const text = inlines.map(inline => inline.run?.text || '').join('');
      for (const match of text.matchAll(pattern)) {
        const image = prepared.images[Number(match[1])];
        if (!image || image.marker !== match[0] || found.has(image.marker)) throw new Error('Could not locate an embedded picture');
        found.add(image.marker);
        locations.push({ image, address: item.address, offset: match.index });
      }
    }
    offset += items.length;
    if (!items.length || offset >= result.total) break;
  }
  if (found.size !== prepared.images.length) throw new Error('Could not locate an embedded picture');
  // A page sizes its pictures for its own width; one wider than the text column here is fitted to the column, as a dropped picture is.
  let column = null;
  try { column = api.sections?.list ? contentWidthPx((await api.sections.list())?.items?.[0]) : null; } catch { column = null; }
  for (const { image, address, offset } of locations.reverse()) {
    const { marker, dropped, size, ...rest } = image;
    const properties = size ? { ...rest, size: column && size.width > column ? sizeToWidth(size.width, size.height, column) : size } : rest;
    const target = (start, end) => ({ kind: 'selection',
      start: { kind: 'text', blockId: address.nodeId, offset: start }, end: { kind: 'text', blockId: address.nodeId, offset: end } });
    // A picture the engine cannot hold leaves only its marker to remove.
    if (dropped) { checked(await api.delete({ target: target(offset, offset + marker.length) })); continue; }
    // An interior insertion stays inside an existing hyperlink. Deleting the
    // two text ranges independently retains that image and its surrounding runs.
    checked(await api.create.image({ ...properties, at: { kind: 'inParagraph', target: address, offset: offset + 1 } }));
    checked(await api.delete({ target: target(offset + 1, offset + marker.length) }));
    checked(await api.delete({ target: target(offset, offset + 1) }));
  }
}

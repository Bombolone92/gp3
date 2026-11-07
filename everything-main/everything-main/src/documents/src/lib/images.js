/**
 * Options for an image already in the document: how text wraps around it,
 * its size, alt text, and removal. The engine paints each image with a short
 * `data-image-id`; the Document API addresses the same image by a longer
 * id that carries that short id in its second segment.
 */

import { escapeHtml } from './importers.js';
import { imageFormat } from './hwp/image.js';

const CSS_PX_PER_INCH = 96;

/** Preserve the description while giving the engine a safe image object name. */
export function imageInsertionText(description) {
  const text = String(description || '');
  // Creation uses `alt` for the object name; angle brackets make its lookup
  // fail after inserting the image. `title` writes the exact description.
  return { alt: text ? text.replace(/[<>]/g, '').trim() || 'Picture' : '', title: text };
}

export const WRAP_OPTIONS = [
  { id: 'inline', label: 'In line with text', icon: 'text' },
  { id: 'left', label: 'Wrap text, image on the left', icon: 'alignLeft' },
  { id: 'right', label: 'Wrap text, image on the right', icon: 'alignRight' },
  { id: 'center', label: 'Own line, centered', icon: 'alignCenter' },
];

/** The image element (or its fragment) under a pointer event target, or null. */
export function imageElementFrom(target, host) {
  const el = target?.closest?.('img, .document-image-fragment, .document-inline-image');
  if (!el || (host && !host.contains(el))) return null;
  return el;
}

/**
 * The painted image the caret touches, for the keyboard: the collapsed caret's
 * paragraph is found by its block id among the painted fragments, and an image
 * whose position (the painter stamps document positions on fragments and
 * images alike) is just before the caret wins over one just after it, since a
 * click on an image leaves the caret after it. Null with a range selected.
 */
export function imageAtCaret(host, snapshot) {
  const start = snapshot?.selectionTarget?.start;
  if (!host || snapshot?.empty !== true || !start || start.kind !== 'text' || start.blockId == null || !Number.isFinite(start.offset)) return null;
  const blockId = String(start.blockId);
  const fragments = [...host.querySelectorAll('[data-source-node-id][data-pm-start]')].filter((f) => f.dataset.sourceNodeId === blockId);
  if (!fragments.length) return null;
  // A paragraph split across pages has a fragment per page; the first one starts where the paragraph's text does.
  const paragraphStart = Math.min(...fragments.map((f) => Number(f.dataset.pmStart)));
  let before = null, after = null;
  for (const fragment of fragments) {
    for (const image of fragment.querySelectorAll('img[data-pm-start], .document-image-fragment[data-pm-start]')) {
      const offset = Number(image.dataset.pmStart) - paragraphStart;
      if (offset + 1 === start.offset) before ||= image;
      else if (offset === start.offset) after ||= image;
    }
  }
  return before || after;
}

/** The short id the painter stamps on an image element or its fragment. */
export function domImageId(el) {
  const carrier = el?.closest?.('[data-image-id]');
  return carrier?.getAttribute('data-image-id') || null;
}

/**
 * Match a painted image to the Document API's list. Exact id first, then the
 * short id in the middle segment ("img:1:word_document.xml:rId9" -> "1"),
 * and when no id is available and the document has a single image, that one.
 */
export function matchImage(items, shortId) {
  const list = Array.isArray(items) ? items : [];
  if (shortId != null && String(shortId) !== '') {
    const exact = list.find((i) => i.imageId === shortId);
    if (exact) return exact;
    const bySegment = list.find((i) => String(i.imageId || '').split(':')[1] === String(shortId));
    if (bySegment) return bySegment;
    // A stale painted image must not resolve to a different surviving image.
    return null;
  }
  return list.length === 1 ? list[0] : null;
}

/** Which wrap option an image's properties correspond to. */
export function currentWrap(props) {
  if (!props || props.placement !== 'floating') return 'inline';
  const type = props.wrap?.type;
  if (type === 'TopAndBottom') return 'center';
  const align = props.anchorData?.alignH;
  if (align === 'right') return 'right';
  if (align === 'left') return 'left';
  return null;
}

/** Width of the text column in CSS pixels for a section's page setup. */
export function contentWidthPx(section) {
  const width = section?.pageSetup?.width ?? 8.5;
  const left = section?.margins?.left ?? 1;
  const right = section?.margins?.right ?? 1;
  return Math.max(48, Math.round((width - left - right) * CSS_PX_PER_INCH));
}

/** A size that fills `maxWidth` keeping the aspect ratio of `width` x `height`. */
export function sizeToWidth(width, height, maxWidth) {
  if (!(width > 0) || !(height > 0) || !(maxWidth > 0)) return null;
  return { width: Math.round(maxWidth), height: Math.max(1, Math.round((height * maxWidth) / width)), unit: 'px' };
}

const ok = (r, what) => {
  if (r == null || (r.success === false && r.failure?.code !== 'NO_OP')) throw new Error(r?.failure?.message || `${what} failed`);
  return r;
};

/** Apply one of WRAP_OPTIONS to an image. */
export async function applyWrap(api, image, option, { onChange = () => {}, beforeWrite = () => {} } = {}) {
  const imageId = image.imageId;
  const written = (result, label) => {
    ok(result, label);
    if (result.success !== false) onChange();
  };
  if (option === 'inline') {
    if (image.properties?.placement !== 'inline') {
      beforeWrite();
      written(await api.images.convertToInline({ imageId }), 'Wrap');
    }
    return;
  }
  // Placement and wrap changes remain applied if a later position write fails.
  if (image.properties?.placement !== 'floating') {
    beforeWrite();
    written(await api.images.convertToFloating({ imageId }), 'Wrap');
  }
  beforeWrite();
  written(await api.images.setWrapType({ imageId, type: option === 'center' ? 'TopAndBottom' : 'Square' }), 'Wrap');
  beforeWrite();
  written(await api.images.setPosition({ imageId, position: { hRelativeFrom: 'margin', alignH: option === 'center' ? 'center' : option, vRelativeFrom: 'paragraph' } }), 'Position');
}

export async function resizeImage(api, image, size) {
  ok(await api.images.setSize({ imageId: image.imageId, size }), 'Resize');
}

export async function scaleImage(api, image, factor) {
  ok(await api.images.scale({ imageId: image.imageId, factor }), 'Resize');
}

export async function setImageAltText(api, image, description) {
  ok(await api.images.setAltText({ imageId: image.imageId, description }), 'Alt text');
}

/** Crop the image to the given edge insets (percentages), or clear the crop. */
export async function cropImage(api, image, crop) {
  const trims = crop && (crop.left || crop.top || crop.right || crop.bottom);
  if (trims) ok(await api.images.crop({ imageId: image.imageId, crop }), 'Crop');
  else ok(await api.images.resetCrop({ imageId: image.imageId }), 'Crop');
}

/** Find the full caption and its paragraph address, including inside table cells. */
export async function findImageCaption(api, image) {
  const blockId = image.anchorRef?.blockId;
  if (!blockId) throw new Error('No image paragraph');
  const story = image.anchorRef.story;
  // A picture in the body's own flow: its neighbor comes from the block list,
  // which costs nothing next to reading the whole document below.
  let node = null;
  if (!story && api.blocks?.list && api.getNodeById) {
    const blocks = (await api.blocks.list({}))?.blocks || [];
    const at = blocks.findIndex((block) => block.nodeId === blockId);
    if (at >= 0) {
      const next = blocks[at + 1];
      if (next?.nodeType !== 'paragraph') return null;
      node = (await api.getNodeById({ nodeId: next.nodeId }))?.node || null;
      if (node && !node.paragraphIds?.paraId && !node.id) node = { ...node, id: next.nodeId };
    }
  }
  if (!node) node = find((await api.get(story ? { in: story } : {})).body);
  // Caption paragraphs immediately follow their image's paragraph, including
  // inside table cells and other containers. Block previews truncate long text.
  function find(value) {
    if (!value || typeof value !== 'object') return null;
    if (Array.isArray(value)) {
      const at = value.findIndex((node) => node?.paragraphIds?.paraId === blockId || (node?.kind === 'paragraph' && node.id === blockId));
      if (at >= 0) return value[at + 1] || null;
    }
    for (const child of Object.values(value)) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  }
  const caption = node?.paragraph;
  if (caption?.styleRef?.toLowerCase() !== 'caption') return null;
  const nodeId = node.paragraphIds?.paraId || node.id;
  if (!nodeId) throw new Error('No caption address');
  const text = captionInlinesText(caption.inlines || []);
  // A table's caption sitting right under a picture belongs to the table, not to the picture.
  if (!(await captionHasLabel(api, nodeId, text, 'Figure'))) return null;
  return { nodeId, text, ...(image.anchorRef.story ? { story: image.anchorRef.story } : {}) };
}

/** Whether a caption paragraph is numbered under `label` ("Figure", "Table"), by its field or, failing that, its text. */
export async function captionHasLabel(api, nodeId, text, label) {
  try {
    const info = api.captions?.get && await api.captions.get({ target: { kind: 'block', nodeType: 'paragraph', nodeId } });
    if (typeof info?.label === 'string') return info.label.toLowerCase() === label.toLowerCase();
  } catch { /* judged by the text below */ }
  return new RegExp(`^\\s*${label}\\b`, 'i').test(String(text || ''));
}

/** The displayed text of a caption paragraph's inlines (runs, tabs, breaks, and fields by their results). */
export function captionInlinesText(inlines) {
  return inlines.map((node) => {
    if (node.kind === 'run') return node.run.text;
    if (node.kind === 'tab') return '\t';
    if (node.kind === 'lineBreak') return '\n';
    const content = node[node.kind];
    if (Array.isArray(content?.inlines)) return captionInlinesText(content.inlines);
    const result = content?.resultText ?? content?.resolvedText ?? content?.displayText ?? content?.display;
    if (typeof result === 'string') return result;
    throw new Error('Could not read the complete caption');
  }).join('');
}

/** Read the full caption immediately following an image's paragraph. */
export async function readImageCaption(api, image) {
  const caption = await findImageCaption(api, image);
  if (!caption) throw new Error('No caption paragraph');
  return caption.text;
}

/** Accept either the displayed caption or just its description. Numbers are automatic. */
export function captionDescription(text, label) {
  const value = String(text || '').trim();
  if (value.slice(0, label.length).toLowerCase() !== label.toLowerCase()) return value;
  const prefix = value.slice(label.length).match(/^[ \t]+(?:\d+|[ivxlcdm]+)(?::[ \t]?|[ \t]+|$)/i);
  return prefix ? value.slice(label.length + prefix[0].length) : value;
}

/** Keep the description outside the SEQ field so updating numbers cannot erase it. */
export async function captionImage(api, image, text, { canApply = () => true, onChange = () => {} } = {}) {
  // A picture in a header or footer has no body paragraph to caption; the engine's own message names a paragraph id.
  if (/:word_(?:header|footer)\d*\.xml:/i.test(String(image?.imageId || ''))) throw new Error('Captions are not available in headers and footers');
  const caption = await findImageCaption(api, image);
  if (caption) return editCaption(api, caption, text, { canApply, onChange });
  if (!canApply()) return false;
  const result = ok(await api.captions.insert({
    adjacentTo: { kind: 'block', nodeType: 'paragraph', nodeId: image.anchorRef.blockId },
    position: 'below', label: 'Figure', text: captionDescription(text, 'Figure'),
  }), 'Caption');
  if (result.success !== false) onChange();
}

/**
 * Rewrite an existing caption (`{ nodeId, text, story? }`, as found next to
 * an image or a table) to describe `text`, keeping its number field and the
 * description outside that field so updating numbers cannot erase it.
 */
export async function editCaption(api, caption, text, { canApply = () => true, onChange = () => {} } = {}) {
  const written = (result, label) => {
    ok(result, label);
    if (result.success !== false) onChange();
  };
  const target = { kind: 'block', nodeType: 'paragraph', nodeId: caption.nodeId };
  // A caption typed by hand ("Table 3: Old"), styled Caption but without a number field, is not one to the
  // engine, whose lookup throws; its label and number are read from the text, and it gains its field below.
  let info;
  try { info = await api.captions.get({ target }); } catch { info = null; }
  if (!info) {
    const typed = /^\s*(Figure|Table|Equation)\s+(\d+)\b\s*:?\s*/i.exec(caption.text || '');
    const label = typed ? typed[1][0].toUpperCase() + typed[1].slice(1).toLowerCase() : 'Figure';
    info = { label, number: typed ? Number(typed[2]) : 1, text: '', instruction: `SEQ ${label} \\* ARABIC` };
  }
  const fields = await api.fields.list();
  const sequence = fields.items?.find((field) => field.address?.blockId === caption.nodeId && field.fieldType === 'SEQ' && !field.nested);
  const description = captionDescription(text, info.label);
  const selection = (start, end) => ({
    kind: 'selection',
    start: { kind: 'text', blockId: caption.nodeId, offset: start },
    end: { kind: 'text', blockId: caption.nodeId, offset: end },
    ...(caption.story ? { story: caption.story } : {}),
  });
  const content = (value, key) => /[\r\n]/.test(value)
    ? { type: 'html', value: `<p>${escapeHtml(value).replace(/\r\n?|\n/g, '<br>')}</p>` }
    : { [key]: value };
  const replace = (start, end, value) => api.replace({ target: selection(start, end), ...content(value, 'text') });
  const insert = (at, value) => api.insert({ target: selection(at, at), ...content(value, 'value') });
  if (!canApply()) return false;
  if (sequence && (sequence.resolvedText === caption.text || sequence.resolvedText.startsWith(`${info.label} `))) {
    // Legacy captions put the whole caption in the SEQ cache. Add the new
    // static text before rebuilding that cache, so a rejected write cannot
    // erase the original. Recognize partial repairs so retrying is safe.
    const prefix = `${info.label} `;
    const hasPrefix = caption.text.startsWith(prefix + sequence.resolvedText);
    if (!hasPrefix && !caption.text.startsWith(sequence.resolvedText)) throw new Error('Could not locate the caption field');
    const end = (hasPrefix ? prefix.length : 0) + sequence.resolvedText.length;
    const suffix = `: ${description}`;
    if (caption.text.slice(end) !== suffix) {
      written(await (end === caption.text.length ? insert(end, suffix) : replace(end, caption.text.length, suffix)), 'Caption');
    }
    if (!canApply()) return false;
    if (!hasPrefix) written(await insert(0, prefix), 'Caption');
    if (!canApply()) return false;
    written(await api.fields.rebuild({ target: sequence.address }), 'Caption');
    return;
  }
  if (sequence && sequence.resolvedText !== caption.text) {
    // Replace only the description; the caption-update operation appends to
    // nonempty descriptions instead of replacing them in this engine version.
    if (!info.text) written(await api.captions.update({ target, patch: { text: description } }), 'Caption');
    else {
      const numberPrefix = `${info.label} ${sequence.resolvedText}`;
      let start;
      if (caption.text.startsWith(numberPrefix)) {
        start = numberPrefix.length;
        if (caption.text[start] === ':') start += 1;
        if (caption.text[start] === ' ') start += 1;
      } else if (caption.text.trimEnd().endsWith(info.text)) start = caption.text.trimEnd().length - info.text.length;
      else throw new Error('Could not locate the caption description');
      written(await replace(start, caption.text.length, description), 'Caption');
    }
    return;
  }
  // Captions without a number field gain one in the existing paragraph.
  const number = String(info.number);
  const prefix = `${info.label} ${number}: `;
  written(await replace(0, caption.text.length, prefix + description), 'Caption');
  if (!canApply()) return false;
  written(await api.fields.insert({
    at: { kind: 'text', segments: [{ blockId: caption.nodeId, range: { start: info.label.length + 1, end: info.label.length + 1 + number.length } }] },
    mode: 'raw', instruction: info.instruction,
    updatePolicy: 'preserveCached', cachedResultText: number,
  }), 'Caption');
}

export async function deleteImage(api, image) {
  ok(await api.images.delete({ imageId: image.imageId }), 'Delete');
}

/**
 * Swap the picture for another (`src` a data URL) and keep the space it
 * takes: the new picture is fitted to the old width, with its own aspect
 * ratio when `width` and `height` (its natural size) are known.
 */
export async function replaceImage(api, image, { src, width = 0, height = 0 } = {}, { onChange = () => {}, beforeWrite = () => {} } = {}) {
  if (!src) throw new Error('No image');
  const imageId = image.imageId;
  const oldWidth = image.properties?.size?.width;
  beforeWrite();
  const replaced = ok(await api.images.replaceSource({ imageId, src, resetSize: true }), 'Replace');
  // The new source remains in the document even if fitting its size fails.
  if (replaced.success !== false) onChange();
  const fitted = oldWidth > 0 ? sizeToWidth(width, height, oldWidth) : null;
  if (fitted) {
    beforeWrite();
    const resized = ok(await api.images.setSize({ imageId, size: fitted }), 'Resize');
    if (resized.success !== false) onChange();
  }
}

/* ---------- What the engine can hold ---------- */

/** The bytes at the start of a base64 data URL, enough to tell the picture format. */
function dataUrlHead(src) {
  const comma = src.indexOf(',');
  if (comma < 0 || !/;base64$/i.test(src.slice(0, comma))) return null;
  try { return Uint8Array.from(atob(src.slice(comma + 1, comma + 1 + 128)), (c) => c.charCodeAt(0)); } catch { return null; }
}

// A redrawn picture whose PNG is this long (about a megabyte of bytes) is a photo more often than a
// drawing; PNG stores a photo at three or four bytes a pixel, so a JPEG is tried too for one with no
// transparent pixel, and the smaller of the two goes in.
const JPEG_WORTH_TRYING = 1.5 * 1024 * 1024;
const JPEG_QUALITY = 0.92;

/** Whether every pixel is fully opaque, read a strip at a time so a large picture never needs its whole bitmap at once. */
function fullyOpaque(context, width, height) {
  const rows = Math.max(1, Math.floor(1000000 / width));
  for (let y = 0; y < height; y += rows) {
    const data = context.getImageData(0, y, width, Math.min(rows, height - y)).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return false;
  }
  return true;
}

/**
 * The engine embeds PNG and JPEG pictures and refuses the rest ("Image
 * dimensions could not be determined"). A GIF, WebP, or BMP is redrawn (its
 * first frame) through a canvas as a PNG, or as a JPEG when the picture is
 * large, has no transparency and comes out smaller that way; a PNG or JPEG
 * whose file was typed otherwise is relabelled. Resolves the data URL to
 * insert, or null when the picture cannot be read or there is no canvas to
 * redraw it with.
 */
export async function embeddableImage(src) {
  if (typeof src !== 'string' || !src.startsWith('data:')) return src;
  const head = dataUrlHead(src);
  const format = head && imageFormat(head);
  if (format === 'png' || format === 'jpg') return src.replace(/^data:[^;,]*/, `data:image/${format === 'jpg' ? 'jpeg' : 'png'}`);
  // Bytes of no known picture format are left to the engine to judge.
  if (!format) return src;
  if (typeof document === 'undefined' || typeof Image === 'undefined' || typeof CanvasRenderingContext2D === 'undefined') return null;
  const img = await new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
  if (!img?.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 40000000) return null;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const context = canvas.getContext?.('2d');
  if (!context) return null;
  try {
    context.drawImage(img, 0, 0);
    const png = canvas.toDataURL('image/png');
    if (png.length < JPEG_WORTH_TRYING || !fullyOpaque(context, canvas.width, canvas.height)) return png;
    const jpeg = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    return jpeg.startsWith('data:image/jpeg') && jpeg.length < png.length ? jpeg : png;
  } catch { return null; }
}

/* ---------- Images from the web ---------- */

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;
const IMAGE_TYPES_BY_EXTENSION = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

/** A typed web address for a picture (http or https), or null. */
export function normalizeImageUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  try {
    const hostWithPort = /^[^/?#:@\s]+:\d+(?:[/?#]|$)/.test(raw);
    const hasScheme = !hostWithPort && /^[a-z][a-z0-9+.-]*:/i.test(raw);
    const u = new URL(hasScheme ? raw : `https://${raw}`);
    if (!/^https?:$/.test(u.protocol)) return null;
    // URL has already validated bracketed IPv6 literals.
    if (!u.hostname.includes('.') && u.hostname !== 'localhost' && !u.hostname.startsWith('[')) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** A file name for a picture fetched from `url`: its last path segment, or "image". */
export function imageNameFromUrl(url) {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
    const clean = last.replace(/[/\\]/g, '').trim();
    return clean && clean.length <= 120 ? clean : 'image';
  } catch {
    return 'image';
  }
}

/**
 * Fetch a picture from the web as a File the page can take. Rejects with a
 * readable message when the address does not serve an image, the file is too
 * large, or the site does not allow the browser to read it (CORS).
 */
export async function fetchImageFromUrl(url, { fetchFn = globalThis.fetch, maxBytes = MAX_IMAGE_BYTES, signal } = {}) {
  const href = normalizeImageUrl(url);
  if (!href) throw new Error('Enter a valid web address');
  let res;
  try {
    res = await fetchFn(href, { mode: 'cors', credentials: 'omit', ...(signal ? { signal } : {}) });
  } catch {
    throw new Error('That site does not let the browser read the picture. Save it to your device and insert it from there');
  }
  if (!res?.ok) throw new Error(`The address returned an error (${res?.status || 'no response'})`);
  const blob = await readImageBlob(res, maxBytes);
  const name = imageNameFromUrl(href);
  const extension = name.match(IMAGE_EXT)?.[1]?.toLowerCase();
  // A server that sends no picture type (an octet-stream download) leaves the extension to name it.
  const type = blob.type && blob.type.startsWith('image/') ? blob.type.split(';')[0].trim().toLowerCase() : (extension ? IMAGE_TYPES_BY_EXTENSION[extension] : null);
  if (!type) throw new Error('That address is not a picture');
  if (!Object.values(IMAGE_TYPES_BY_EXTENSION).includes(type)) throw new Error('That picture format is not supported. Use a PNG, JPEG, GIF, WebP, or BMP picture');
  return new File([blob], extension ? name : `${name}.${type.split('/')[1].replace('jpeg', 'jpg')}`, { type });
}

/** Read image bytes with a streaming limit, including responses without a declared size. */
export async function readImageBlob(res, maxBytes = MAX_IMAGE_BYTES) {
  const tooLarge = () => new Error('Images must be under 15 MB');
  if (Number(res.headers?.get('content-length')) > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  let blob;
  if (res.body?.getReader) {
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => {});
          throw tooLarge();
        }
        chunks.push(value);
      }
      blob = new Blob(chunks, { type: res.headers?.get('content-type') || '' });
    } finally {
      reader.releaseLock();
    }
  } else {
    blob = await res.blob();
  }
  if (blob.size > maxBytes) throw tooLarge();
  return blob;
}

/** The picture files among a drag-and-drop payload, in order. */
export function imageFilesFrom(dataTransfer) {
  return [...(dataTransfer?.files || [])].filter((f) => f && (String(f.type).startsWith('image/') || IMAGE_EXT.test(f.name || '')));
}

/* ---------- Rotation and flipping ---------- */

/** Items for turning and mirroring an image, in menu order. */
export const TRANSFORM_OPTIONS = [
  { id: 'rotateRight', label: 'Rotate right 90°', icon: 'redo' },
  { id: 'rotateLeft', label: 'Rotate left 90°', icon: 'undo' },
  { id: 'flipH', label: 'Flip horizontally', icon: 'cols' },
  { id: 'flipV', label: 'Flip vertically', icon: 'rows' },
  { id: 'reset', label: 'Reset rotation and flips', icon: 'x' },
];

/** The angle (0 to 359) and flips an image currently carries. */
export function currentTransform(props) {
  const t = props?.transform || {};
  const raw = Number(t.rotation) || 0;
  return { rotation: ((Math.round(raw) % 360) + 360) % 360, horizontalFlip: !!t.horizontalFlip, verticalFlip: !!t.verticalFlip };
}

/**
 * Apply one of TRANSFORM_OPTIONS. The engine stores an absolute angle and
 * absolute flip states, so each step is computed from the current transform.
 */
export async function transformImage(api, image, option, { onChange = () => {}, beforeWrite = () => {} } = {}) {
  const imageId = image.imageId;
  const cur = currentTransform(image.properties);
  const written = (result, label) => {
    ok(result, label);
    if (result.success !== false) onChange();
  };
  if (option === 'rotateRight' || option === 'rotateLeft') {
    const angle = (cur.rotation + (option === 'rotateRight' ? 90 : 270)) % 360;
    beforeWrite();
    written(await api.images.rotate({ imageId, angle }), 'Rotate');
  } else if (option === 'flipH') {
    beforeWrite();
    written(await api.images.flip({ imageId, horizontal: !cur.horizontalFlip }), 'Flip');
  } else if (option === 'flipV') {
    beforeWrite();
    written(await api.images.flip({ imageId, vertical: !cur.verticalFlip }), 'Flip');
  } else if (option === 'reset') {
    // Rotation stays reset even if clearing the flips fails afterward.
    if (cur.rotation) {
      beforeWrite();
      written(await api.images.rotate({ imageId, angle: 0 }), 'Rotate');
    }
    if (cur.horizontalFlip || cur.verticalFlip) {
      beforeWrite();
      written(await api.images.flip({ imageId, horizontal: false, vertical: false }), 'Flip');
    }
  } else {
    throw new Error('Unknown transform');
  }
}

/* ---------- The space around a picture ---------- */

/** How far text stays from a picture it wraps around, in inches. The engine measures in CSS pixels. */
const PX_PER_INCH = 96;
export const IMAGE_DISTANCES = [
  { id: 'none', label: 'None', inches: 0 },
  { id: 'small', label: 'Small (0.1 in)', inches: 0.1 },
  { id: 'medium', label: 'Medium (0.2 in)', inches: 0.2 },
  { id: 'large', label: 'Large (0.4 in)', inches: 0.4 },
];

/** The distance choice closest to what the image carries (pixels from the engine, rounded through EMUs). */
export function currentDistance(props) {
  const a = props?.wrap?.attrs || {};
  const values = [a.distTop, a.distBottom, a.distLeft, a.distRight].map((v) => Number(v) || 0);
  const avg = values.reduce((s, v) => s + v, 0) / 4 / PX_PER_INCH;
  let best = IMAGE_DISTANCES[0];
  for (const d of IMAGE_DISTANCES) if (Math.abs(d.inches - avg) < Math.abs(best.inches - avg)) best = d;
  return best.id;
}

/** Whether the picture's text wraps around it, so a distance means something. */
export function wrapsText(props) {
  return props?.placement === 'floating' && props.wrap?.type !== 'Inline';
}

/** Put the same distance on every side of a wrapped picture. */
export async function setImageDistance(api, image, choiceId) {
  const choice = IMAGE_DISTANCES.find((d) => d.id === choiceId);
  if (!choice) throw new Error('Unknown distance');
  const d = Math.round(choice.inches * PX_PER_INCH * 1000) / 1000;
  ok(await api.images.setWrapDistances({ imageId: image.imageId, distances: { distTop: d, distBottom: d, distLeft: d, distRight: d } }), 'Distance');
}

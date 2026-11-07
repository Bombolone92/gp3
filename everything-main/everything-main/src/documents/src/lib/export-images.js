import { unzipSync, strFromU8 } from 'fflate';
import { bytesFromBase64 } from './bytes.js';
import { escapeHtml } from './importers.js';
import { hyperlinkReplacements } from './export-hyperlinks.js';
import { hiddenReplacements, hiddenRun } from './export-hidden.js';
import { fieldPictureOwners } from './export-field-pictures.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const V = 'urn:schemas-microsoft-com:vml';
const O = 'urn:schemas-microsoft-com:office:office';
const OPEN = '<span data-document-placeholder="image">';
const PICTURE_PARTS = new Set(['word/document.xml', 'word/_rels/document.xml.rels', '[Content_Types].xml']);
const CLOSE = '</span>';
const first = (node, ns, name) => node.getElementsByTagNameNS(ns, name)[0];
const number = (node, name) => {
  const value = Number(node?.getAttribute(name));
  return Number.isFinite(value) ? value : 0;
};

function xml(bytes) {
  if (!bytes) throw new Error('Could not read the exported pictures');
  const document = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new Error('Could not read the exported pictures');
  return document;
}

function base64(bytes) {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return btoa(binary);
}

function pictureHtml(drawing, src) {
  const props = first(drawing, WP, 'docPr');
  const extent = first(drawing, WP, 'extent');
  const width = number(extent, 'cx') / 9525, height = number(extent, 'cy') / 9525;
  const alt = props?.getAttribute('descr') || props?.getAttribute('title') || '';
  const crop = first(drawing, A, 'srcRect');
  const [left, top, right, bottom] = ['l', 't', 'r', 'b'].map((key) => number(crop, key) / 100000);
  const transform = first(drawing, A, 'xfrm');
  const rotation = number(transform, 'rot') / 60000;
  const flip = (key) => /^(1|true)$/i.test(transform?.getAttribute(key) || '');
  const style = rotation || flip('flipH') || flip('flipV')
    ? `transform:rotate(${rotation}deg) scale(${flip('flipH') ? -1 : 1},${flip('flipV') ? -1 : 1});` : '';
  const attrs = `src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"`;
  if (width > 0 && height > 0 && (left || top || right || bottom) && left + right < 1 && top + bottom < 1) {
    const x = 1 - left - right, y = 1 - top - bottom;
    return `<span style="display:inline-block;position:relative;overflow:hidden;width:${width}px;max-width:100%;aspect-ratio:${width}/${height};${style}"><img ${attrs} style="position:absolute;max-width:none;width:${100 / x}%;height:${100 / y}%;left:${-100 * left / x}%;top:${-100 * top / y}%;"></span>`;
  }
  const sized = width > 0 && height > 0;
  const imageStyle = `${sized ? `aspect-ratio:${width}/${height};` : ''}${style}`;
  return `<img ${attrs}${sized ? ` width="${width}" height="${height}"` : ''}${imageStyle ? ` style="${imageStyle}"` : ''}>`;
}

/** A legacy (VML) picture: `w:pict` or an embedded object, drawn from its image data. */
function vmlPictureHtml(shape, src) {
  const style = shape?.getAttribute('style') || '';
  const pt = (name) => { const m = style.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([\\d.]+)(pt|px|in|cm|mm)?`)); return m ? Number(m[1]) * ({ px: 1, pt: 96 / 72, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 }[m[2] || 'pt']) : 0; };
  const width = pt('width'), height = pt('height');
  const alt = first(shape, V, 'imagedata')?.getAttributeNS(O, 'title') || shape?.getAttribute('alt') || '';
  const sized = width > 0 && height > 0;
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${sized ? ` width="${width}" height="${height}" style="aspect-ratio:${width}/${height};"` : ''}>`;
}

const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const isElement = (node, ns, name) => node?.namespaceURI === ns && node.localName === name;
/** Picture types a browser can show; anything else (EMF, WMF, TIFF) would be a broken image on the page. */
const WEB_IMAGE = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml|avif)$/i;
/** Whether the node sits inside a markup compatibility choice (a shape or text box written twice, for newer and older readers). */
const inAlternateContent = (node) => { for (let p = node.parentElement; p; p = p.parentElement) if (isElement(p, MC, 'AlternateContent')) return true; return false; };
/** The nearest `w:drawing` above this node, if it sits inside one (a picture in a text box). */
const enclosingDrawing = (node) => { for (let p = node.parentElement; p; p = p.parentElement) if (isElement(p, W, 'drawing')) return p; return null; };

/**
 * Pictures in final document order, grouped by the paragraph IDs in the
 * projection. Every drawing and legacy picture counts, since the projection
 * writes a placeholder for each of them: a text box or shape without a
 * picture of its own leaves nothing behind rather than failing the export.
 */
function picturesByParagraph(files) {
  const document = xml(files['word/document.xml']);
  const fieldOwners = fieldPictureOwners(document);
  const relations = new Map([...xml(files['word/_rels/document.xml.rels']).getElementsByTagNameNS('*', 'Relationship')].map((node) => [node.getAttribute('Id'), node]));
  const types = [...xml(files['[Content_Types].xml']).documentElement.children];
  const pictures = new Map(), sources = new Map(), hyperlinkGroups = new Map();
  // The projection stands in for a shape or text box written inside a compatibility choice with
  // "[unsupported content]", not "[image]": such graphics take no picture slot.
  const graphics = [...document.getElementsByTagNameNS(W, '*')].filter((node) => ['drawing', 'pict', 'object'].includes(node.localName) && !enclosingDrawing(node) && !inAlternateContent(node));
  for (const drawing of graphics) {
    let paragraph = drawing.parentElement, hyperlink = null;
    while (paragraph && !(paragraph.namespaceURI === W && paragraph.localName === 'p')) {
      if (paragraph.namespaceURI === W && paragraph.localName === 'hyperlink') hyperlink = paragraph;
      paragraph = paragraph.parentElement;
    }
    const id = paragraph?.getAttributeNS(W14, 'paraId');
    if (!id) continue;
    if (!pictures.has(id)) pictures.set(id, []);
    const legacy = drawing.localName !== 'drawing';
    // A text box or shape: the picture inside one belongs to the box, not the paragraph.
    const picture = legacy ? first(drawing, V, 'imagedata') : [...drawing.getElementsByTagNameNS(PIC, 'pic')].find((pic) => enclosingDrawing(pic) === drawing);
    if (!picture) { pictures.get(id).push({ html: '', hyperlink: undefined, field: undefined }); continue; }
    const blip = legacy ? null : first(picture, A, 'blip');
    const relationship = relations.get(legacy ? picture.getAttributeNS(R, 'id') : (blip?.getAttributeNS(R, 'embed') || blip?.getAttributeNS(R, 'link')));
    // Linked ("Link to File") pictures point at a path on someone's disk
    // (file:///C:/...), which no reader of the page can reach. Such a picture
    // is left out of the export rather than failing the whole export.
    const target = relationship?.getAttribute('Target');
    let src = target == null ? null : sources.get(target);
    if (!relationship) src = null;
    else if (!src) {
      if (relationship.getAttribute('TargetMode') === 'External') {
        let url = null;
        try { url = new URL(target); } catch { /* not an address at all */ }
        src = url && /^https?:$/.test(url.protocol) ? url.href : null;
      } else {
        const path = decodeURIComponent(new URL(target, 'https://document.invalid/word/document.xml').pathname).slice(1);
        const bytes = files[path];
        const extension = path.split('.').pop().toLowerCase();
        const type = types.find((node) => node.localName === 'Override' && node.getAttribute('PartName') === `/${path}`)
          || types.find((node) => node.localName === 'Default' && node.getAttribute('Extension')?.toLowerCase() === extension);
        const mime = type?.getAttribute('ContentType');
        if (!bytes || !/^image\/[a-z0-9.+-]+$/i.test(mime || '')) throw new Error('Could not read an exported picture');
        // A metafile or TIFF stays in the document, but no browser shows it: the page carries its description instead.
        src = WEB_IMAGE.test(mime) ? `data:${mime};base64,${base64(bytes)}` : null;
      }
      if (src) sources.set(target, src);
    }
    let link;
    if (hyperlink) {
      const anchor = hyperlink.getAttributeNS(W, 'anchor');
      const href = relations.get(hyperlink.getAttributeNS(R, 'id'))?.getAttribute('Target');
      if (anchor || href) {
        if (!hyperlinkGroups.has(hyperlink)) hyperlinkGroups.set(hyperlink, hyperlinkGroups.size);
        const otherContent = [...hyperlink.getElementsByTagNameNS(W, 't')].some(node => node.textContent.length)
          || ['br', 'cr', 'tab', 'ptab', 'sym', 'noBreakHyphen', 'softHyphen', 'footnoteReference', 'endnoteReference', 'fldSimple', 'instrText', 'pict', 'object'].some(name => first(hyperlink, W, name))
          || [...hyperlink.getElementsByTagNameNS(W, 'drawing')].some(node => !first(node, PIC, 'pic'));
        const text = [...hyperlink.getElementsByTagNameNS(W, 't')].filter(node => node.textContent.length);
        link = { href, anchor, group: hyperlinkGroups.get(hyperlink), empty: !otherContent,
          textBefore: text.some(node => node.compareDocumentPosition(drawing) & 4),
          textAfter: text.some(node => node.compareDocumentPosition(drawing) & 2) };
      }
    }
    // A hidden picture (its run has the hidden effect) is not shown and leaves nothing behind.
    const hidden = isElement(drawing.parentElement, W, 'r') && hiddenRun(drawing.parentElement);
    const description = legacy ? (first(drawing, V, 'imagedata')?.getAttributeNS(O, 'title') || '') : (first(drawing, WP, 'docPr')?.getAttribute('descr') || first(drawing, WP, 'docPr')?.getAttribute('title') || '');
    const html = hidden ? '' : src ? (legacy ? vmlPictureHtml(first(drawing, V, 'shape') || drawing, src) : pictureHtml(drawing, src))
      : description && relationship && relationship.getAttribute('TargetMode') !== 'External' ? `<span class="picture-description">[${escapeHtml(description)}]</span>` : '';
    pictures.get(id).push({ html, hyperlink: link, field: fieldOwners.get(drawing) });
  }
  return pictures;
}

/** Restore pictures that the engine's semantic HTML/Markdown projection replaces with placeholders. */
export async function projectWithImages(api, format) {
  const project = format === 'html' ? api.projectHtml : api.projectMarkdown;
  if (!project) return format === 'html' ? api.getHtml({}) : api.getMarkdown({});
  const projection = await project({ includeSourceMap: true });
  if (projection.status === 'failed' || typeof projection.content !== 'string') throw new Error('Could not export the document');
  const placeholders = (projection.sourceMap?.entries || []).filter((entry) => entry.kind === 'synthetic' && entry.role === 'placeholder'
    && projection.content.slice(entry.output.start - OPEN.length, entry.output.end + CLOSE.length) === `${OPEN}[image]${CLOSE}`);
  let replacements = [];
  if (placeholders.length) {
    // Final mode removes deleted pictures before matching placeholders in the
    // final projection. Media stays inside the downloaded/published file.
    const exported = await api.export.toDocx({ mode: 'final' });
    if (api.info && String((await api.info({})).revision) !== String(projection.evaluatedRevision)) throw new Error('The document changed while exporting. Try again');
    // Only the parts the pictures are read from are inflated: a package can carry media nothing refers to.
    const files = unzipSync(bytesFromBase64(exported.contentBase64), { filter: (file) => PICTURE_PARTS.has(file.name) || file.name.startsWith('word/media/') });
    const pictures = picturesByParagraph(files);
    const imageCounts = new Map();
    const imageRanges = new Map();
    for (const diagnostic of projection.diagnostics || []) {
      if (diagnostic.code !== 'projection-placeholder-emitted' || diagnostic.construct !== 'image' || !diagnostic.source?.range) continue;
      const { blockId, range } = diagnostic.source;
      if (!imageRanges.has(blockId)) imageRanges.set(blockId, []);
      imageRanges.get(blockId).push(range);
    }
    for (const ranges of imageRanges.values()) ranges.sort((a, b) => a.start - b.start);
    replacements = placeholders.map((entry) => {
      // A placeholder without a drawing behind it (a construct the exporter does not carry) leaves nothing behind.
      const picture = pictures.get(entry.blockId)?.shift() || { html: '' };
      const index = imageCounts.get(entry.blockId) || 0;
      imageCounts.set(entry.blockId, index + 1);
      return { start: entry.output.start - OPEN.length, end: entry.output.end + CLOSE.length, ...picture, blockId: entry.blockId, index, sourceRange: imageRanges.get(entry.blockId)?.[index] };
    });
  }
  const links = await hyperlinkReplacements(api, projection, replacements);
  replacements = replacements.filter(image => !links.some(link => image.start >= link.start && image.end <= link.end));
  // Hidden text goes, unless the API given already projects without it (the export pipeline cuts it before
  // links and notes are read); a hidden run inside a link or picture the export rewrites is left to that rewrite.
  const hidden = api.hiddenRunsApplied ? [] : (await hiddenReplacements(api, projection)).filter(cut => ![...replacements, ...links].some(other => cut.start < other.end && cut.end > other.start));
  const headings = await headingMarks(api, projection);
  let content = projection.content;
  for (const replacement of [...replacements, ...links, ...hidden, ...headings].sort((a, b) => b.start - a.start || b.end - a.end)) content = content.slice(0, replacement.start) + replacement.html + content.slice(replacement.end);
  return content;
}

/**
 * Headings may be numbered through a list, and the projection writes such a
 * heading as a list item. The block list still knows the heading's level:
 * each such item is marked with it, for the HTML and Markdown exporters to
 * turn back into a heading (export-headings.js, export-markdown-lists.js).
 */
async function headingMarks(api, projection) {
  const entries = projection.sourceMap?.entries;
  if (!api.blocks?.list || !Array.isArray(entries) || !projection.content.includes('data-document-list-labels="explicit"')) return [];
  let blocks;
  try { blocks = (await api.blocks.list())?.blocks || []; } catch { return []; }
  const levels = new Map(blocks.filter((b) => b.headingLevel >= 1 && b.headingLevel <= 6).map((b) => [b.nodeId, b.headingLevel]));
  if (!levels.size) return [];
  const content = projection.content, marks = new Map();
  for (const entry of entries) {
    const level = entry.kind === 'text' ? levels.get(entry.blockId) : null;
    if (!level || !entry.output) continue;
    const li = content.lastIndexOf('<li', entry.output.start);
    if (li < 0 || marks.has(li)) continue;
    // The item's own text: nothing closes the item, or opens a list inside it, between its tag and the text.
    const between = content.slice(li, entry.output.start);
    if (!/^<li[\s>]/.test(between) || /<\/li>|<(?:ul|ol)\b/i.test(between)) continue;
    marks.set(li, { start: li + 3, end: li + 3, html: ` data-heading-level="${level}"` });
  }
  return [...marks.values()];
}

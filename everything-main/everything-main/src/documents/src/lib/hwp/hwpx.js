/** HWPX (OWPML): package spine, definitions, and section contents. */
import { Reader, check, inflate, budget, LIMITS, HwpError, TOO_MANY_CELLS } from './binary.js';
import { hyperlinkTarget, namedNumberFormats, underlineStyles, borderStyles, tabLeader, textDirection, hanwordSymbolText, legacyTabUnits, clickHereGuide, hasContent, showFieldGuides, emphasisMark } from './formatting.js';
import { imageResource, imageCrop, imageDimensions } from './image.js';
import { composeDrawingMatrices, groupPlacement, arcPath, curvePath, textArtLines, textArtSize } from './drawing.js';
import { oleImage } from './ole.js';
import { formatNumber } from './numbering.js';
import { resolvePageHiding } from './layout.js';

const children = (n, name) => [...(n?.children || [])].filter((c) => !name || c.localName === name);
const descendants = (n, name) => [...(n?.getElementsByTagNameNS('*', name) || [])];
const one = (n, name) => descendants(n, name)[0];
const attr = (n, key, fallback = '') => n?.getAttribute(key) ?? fallback;
const num = (n, key, fallback = 0) => { const a = attr(n, key); if (a === '') return fallback; const v = Number(a); check(Number.isFinite(v) && Math.abs(v) <= 0xffffffff); return v; };
// Some Hanword versions serialize negative HWPUNIT offsets as unsigned DWORDs.
const signed = (n, key) => { const value = num(n, key); return value > 0x7fffffff ? value - 0x100000000 : value; };
const yes = (n, key) => /^(1|true)$/i.test(attr(n, key));
const color = (s) => /^#[a-f\d]{6,8}$/i.test(s) ? s.slice(-6) : null;
const margins = (n) => Object.fromEntries(['left', 'right', 'top', 'bottom'].map((k) => [k, num(n, k)]));
/** A Hanword enumeration attribute as the DOCX value it maps to; anything unknown takes the default, since readers refuse invalid values. */
const enumAttr = (n, key, table, fallback) => table[String(attr(n, key, '')).toUpperCase()] || fallback;
const TAB_ALIGN = { LEFT: 'left', RIGHT: 'right', CENTER: 'center', DECIMAL: 'decimal' };
const HORIZONTAL = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFY: 'both', DISTRIBUTE: 'distribute' };
const VERTICAL = { TOP: 'top', CENTER: 'center', BOTTOM: 'bottom' };
const indexed = (nodes, read) => { const out = []; for (const n of nodes) { const id = num(n, 'id'); check(Number.isInteger(id) && id >= 0 && id <= 65535 && !out[id]); out[id] = read(n); } return out; };

/** Bound tree allocation and reject declarations before handing XML to DOMParser. */
function checkXmlStructure(text, countElement) {
  let pos = 0, depth = 0, attributes = 0;
  while ((pos = text.indexOf('<', pos)) !== -1) {
    const delimiter = text.startsWith('<!--', pos) ? '-->' : text.startsWith('<![CDATA[', pos) ? ']]>' : text.startsWith('<?', pos) ? '?>' : null;
    if (delimiter) {
      // Advancing to each terminator once keeps malformed input linear as well.
      const end = text.indexOf(delimiter, pos + (delimiter === '-->' ? 4 : delimiter === ']]>' ? 9 : 2));
      check(end !== -1, 'The HWPX XML is damaged.');
      pos = end + delimiter.length;
    } else {
      check(!/^<!(DOCTYPE|ENTITY)/i.test(text.slice(pos, pos + 9)), 'HWPX documents with XML entity declarations are not supported.');
      check(text[pos + 1] !== '!', 'The HWPX XML is damaged.');
      const closing = text[pos + 1] === '/';
      if (!closing) {
        countElement();
        check(depth <= LIMITS.depth, 'The HWPX XML is nested too deeply.');
      }
      // A quoted attribute may contain ">". Scan each tag once, skipping quotes,
      // so neither attributes nor literal markup count as extra tree nodes.
      let end = pos + 1, quote = null;
      for (; end < text.length; end++) {
        const c = text[end];
        if (quote) { if (c === quote) quote = null; }
        else if (c === '"' || c === "'") quote = c;
        else if (c === '>') break;
        // Attributes allocate too; a tag with a million of them is not a document.
        else if (c === '=') check(++attributes <= LIMITS.attributes, 'The HWPX XML has too many attributes.');
      }
      check(end < text.length, 'The HWPX XML is damaged.');
      if (closing) { check(depth > 0, 'The HWPX XML is damaged.'); depth--; }
      else if (text[end - 1] !== '/') depth++;
      pos = end + 1;
    }
  }
  check(depth === 0, 'The HWPX XML is damaged.');
}

const crcTable = Array.from({ length: 256 }, (_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
/** Validate ZIP sizes before decompressing, and verify actual output and CRC. */
export function hwpxArchive(bytes) {
  const r = new Reader(bytes); let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) if (r.view.getUint32(p, true) === 0x06054b50 && p + 22 + r.view.getUint16(p + 20, true) === bytes.length) { end = p; break; }
  check(end >= 0, 'This HWPX archive is damaged or incomplete.');
  r.pos = end + 4; check(r.u16() === 0 && r.u16() === 0); const diskCount = r.u16(), count = r.u16(); check(count === diskCount && count > 0 && count <= 4096);
  const size = r.u32(), start = r.u32(); check(start + size === end); r.pos = start;
  const entries = new Map(), consume = budget(); let expanded = 0;
  for (let i = 0; i < count; i++) {
    check(r.u32() === 0x02014b50); r.skip(4); const flags = r.u16(), method = r.u16(); r.skip(4);
    if (flags & 1) throw new HwpError('This HWPX file is encrypted. Save an unprotected copy in Hanword before importing.');
    const crc = r.u32(), packed = r.u32(), unpacked = r.u32(), n = r.u16(), extra = r.u16(), comment = r.u16();
    check(r.u16() === 0); r.skip(6); const offset = r.u32();
    const name = new TextDecoder().decode(bytes.subarray(r.take(n), r.pos)); r.skip(extra + comment);
    check(!entries.has(name) && !name.startsWith('/') && !name.includes('\\') && !name.split('/').includes('..'));
    check(offset + 30 <= start && packed <= bytes.length && unpacked <= LIMITS.expanded);
    expanded += unpacked; check(expanded <= LIMITS.expanded, 'This HWPX file expands beyond the 96 MB import limit.');
    entries.set(name, { flags, method, crc, packed, unpacked, offset });
  }
  check(r.pos === end); const cache = new Map();
  return { names: [...entries.keys()], has: (name) => entries.has(name), read(name) {
    if (cache.has(name)) return cache.get(name);
    const e = entries.get(name); check(e, `The HWPX document is missing ${name}.`);
    r.pos = e.offset; check(r.u32() === 0x04034b50); r.skip(2); check(r.u16() === e.flags && r.u16() === e.method); r.skip(16);
    const n = r.u16(), extra = r.u16(); const localName = new TextDecoder().decode(bytes.subarray(r.take(n), r.pos)); r.skip(extra); check(localName === name && r.pos + e.packed <= start);
    const packed = bytes.subarray(r.take(e.packed), r.pos); let out;
    if (e.method === 0) { consume(packed.length); out = packed; }
    else { check(e.method === 8, 'The HWPX archive uses unsupported compression.'); out = inflate(packed, consume); }
    check(out.length === e.unpacked && crc32(out) === e.crc, 'The HWPX archive contains damaged data.'); cache.set(name, out); return out;
  } };
}

export function parseHwpx(bytes) {
  const zip = hwpxArchive(bytes), warnings = new Set();
  check(zip.has('mimetype') && new TextDecoder().decode(zip.read('mimetype')).trim() === 'application/hwp+zip', 'This file is not a Hanword HWPX document.');
  let elementCount = 0;
  function readXml(name) {
    const bytes = zip.read(name);
    const encoding = bytes[0] === 255 && bytes[1] === 254 || bytes[0] === 60 && bytes[1] === 0 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 || bytes[0] === 0 && bytes[1] === 60 ? 'utf-16be' : 'utf-8';
    let text;
    try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
    catch { check(false, `The HWPX part ${name} is not in a readable encoding.`); }
    checkXmlStructure(text, () => check(++elementCount <= LIMITS.records, 'This HWPX file contains too many XML elements.'));
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    check(!doc.getElementsByTagName('parsererror').length && doc.documentElement, `The HWPX XML in ${name} is damaged.`);
    // OWPML switch branches are alternatives. Hanword's HwpUnitChar branch
    // carries HWPUNIT values; the default branch repeats them in legacy units
    // (tab positions in half units). Branches we cannot read (OOXML charts)
    // fall back to the default, which holds the object's OLE form.
    for (const s of descendants(doc, 'switch')) {
      const cases = children(s, 'case');
      const selected = cases.find((c) => [...c.attributes].some((a) => a.localName === 'required-namespace' && /\/2016\/HwpUnitChar$/i.test(a.value)))
        || children(s, 'default')[0] || cases[0];
      if (selected) s.replaceWith(...selected.childNodes); else s.remove();
    }
    return doc.documentElement;
  }
  if (zip.has('META-INF/manifest.xml')) {
    const manifest = readXml('META-INF/manifest.xml');
    check(!descendants(manifest, 'encryption-data').length, 'This HWPX file is encrypted. Save an unprotected copy in Hanword before importing.');
  }
  const packagePath = 'Contents/content.hpf', pkg = readXml(packagePath), items = new Map();
  function resolve(href) {
    if (/^[a-z][\w+.-]*:/i.test(href) || href.startsWith('//')) return null;
    try { href = decodeURIComponent(href); } catch { check(false, 'The HWPX package contains an invalid resource URI.'); }
    const path = href.replace(/^\//, ''); if (zip.has(path)) return path;
    const segments = packagePath.split('/').slice(0, -1);
    for (const segment of path.split('/')) { if (segment === '..') { if (!segments.length) return null; segments.pop(); } else if (segment && segment !== '.') segments.push(segment); }
    return segments.join('/');
  }
  for (const item of descendants(pkg, 'item')) { const id = attr(item, 'id'); check(id && !items.has(id)); items.set(id, { path: resolve(attr(item, 'href')), type: attr(item, 'media-type') }); }
  const headerPath = items.get('header')?.path || [...items.values()].find((i) => i.type === 'application/xml' && /(?:^|\/)header\.xml$/.test(i.path))?.path || 'Contents/header.xml', header = readXml(headerPath);
  const fonts = new Map(descendants(header, 'fontface').map((f) => [attr(f, 'lang'), indexed(children(f, 'font'), (n) => attr(n, 'face'))]));
  const fontFallbacks = new Map();
  for (const font of descendants(header, 'font')) {
    const name = attr(font, 'face'), fallback = attr(one(font, 'substFont'), 'face');
    if (fallback) fontFallbacks.set(name, [...new Set([...(fontFallbacks.get(name) || []), fallback])].slice(0, 16));
  }
  const borders = indexed(descendants(header, 'borderFill'), (n) => {
    const b = {};
    // Widths are millimeters; DOCX borders go up to 12 points, and a width the file broke is the thin default.
    const width = (s) => { const mm = parseFloat(attr(s, 'width')); return Number.isFinite(mm) && mm > 0 ? Math.min(mm, 12 * 25.4 / 72) : 0.1; };
    const line = (s) => ({ style: borderStyles[attr(s, 'type')] || 'single', size: Math.max(2, Math.round(width(s) * 72 / 25.4 * 8)), color: color(attr(s, 'color')) });
    for (const side of ['left', 'right', 'top', 'bottom']) { const s = one(n, side + 'Border'); if (s) b[side] = line(s); }
    // Slash and backslash diagonals share one line definition; DOCX cells hold one of each.
    const diagonal = one(n, 'diagonal');
    if (diagonal && attr(diagonal, 'type', 'NONE') !== 'NONE') {
      if (attr(one(n, 'slash'), 'type', 'NONE') !== 'NONE') b.tr2bl = line(diagonal);
      if (attr(one(n, 'backSlash'), 'type', 'NONE') !== 'NONE') b.tl2br = line(diagonal);
    }
    b.fill = color(attr(one(n, 'winBrush'), 'faceColor'));
    const gradient = one(n, 'gradation');
    if (gradient) {
      b.gradient = { type: attr(gradient, 'type', 'LINEAR'), angle: num(gradient, 'angle'), centerX: num(gradient, 'centerX', 50), centerY: num(gradient, 'centerY', 50), blur: num(gradient, 'step', 100), center: num(gradient, 'stepCenter', 50), colors: children(gradient, 'color').map((c) => color(attr(c, 'value')) || '000000'), positions: [] };
      b.fill ||= b.gradient.colors[0];
    }
    // The picture itself is resolved where the fill is used: an empty cell can show it.
    if (one(n, 'imgBrush')) b.pictureFill = attr(one(one(n, 'imgBrush'), 'img'), 'binaryItemIDRef') || true;
    return b;
  });
  const chars = indexed(descendants(header, 'charPr'), (n) => {
    const face = one(n, 'fontRef'), size = num(n, 'height', 1000), underline = one(n, 'underline'), strike = one(n, 'strikeout');
    return { font: fonts.get('LATIN')?.[num(face, 'latin')], eastAsia: fonts.get('HANGUL')?.[num(face, 'hangul')], size,
      bold: !!one(n, 'bold'), italic: !!one(n, 'italic'), underline: attr(underline, 'type') === 'BOTTOM' ? underlineStyles[attr(underline, 'shape')] || 'single' : false, underlineColor: color(attr(underline, 'color')),
      strike: (!!strike && attr(strike, 'shape') !== 'NONE') || attr(underline, 'type') === 'CENTER', doubleStrike: attr(strike, 'shape') === 'DOUBLE_SLIM', vert: one(n, 'supscript') ? 'superscript' : one(n, 'subscript') ? 'subscript' : null,
      outline: !!one(n, 'outline') && attr(one(n, 'outline'), 'type') !== 'NONE', shadow: !!one(n, 'shadow') && attr(one(n, 'shadow'), 'type') !== 'NONE', emboss: !!one(n, 'emboss'), imprint: !!one(n, 'engrave'),
      color: color(attr(n, 'textColor')), shade: color(attr(n, 'shadeColor')), scale: num(one(n, 'ratio'), 'hangul', 100), spacing: num(one(n, 'spacing'), 'hangul') * size / 100,
      position: num(one(n, 'offset'), 'hangul') * size / 100, relativeSize: num(one(n, 'relSz'), 'hangul', 100), kerning: yes(n, 'useKerning'),
      emphasis: emphasisMark(attr(n, 'symMark', 'NONE')), border: borders[num(n, 'borderFillIDRef')] };
  });
  const tabs = indexed(descendants(header, 'tabPr'), (n) => descendants(n, 'tabItem').map((t) => ({ pos: attr(t, 'unit') === 'HWPUNIT' ? num(t, 'pos') : legacyTabUnits(num(t, 'pos')), align: enumAttr(t, 'type', TAB_ALIGN, 'left'), leader: tabLeader(attr(t, 'leader', 'NONE')) })));
  const paras = indexed(descendants(header, 'paraPr'), (n) => {
    const margin = one(n, 'margin'), line = one(n, 'lineSpacing'), flow = one(n, 'breakSetting'), heading = one(n, 'heading');
    return { align: ({ JUSTIFY: 'both', LEFT: 'left', RIGHT: 'right', CENTER: 'center', DISTRIBUTE: 'distribute', DISTRIBUTE_SPACE: 'distribute' })[attr(one(n, 'align'), 'horizontal')],
      left: num(one(margin, 'left'), 'value'), right: num(one(margin, 'right'), 'value'), indent: num(one(margin, 'intent'), 'value'), before: num(one(margin, 'prev'), 'value'), after: num(one(margin, 'next'), 'value'),
      line: num(line, 'value'), lineType: ({ PERCENT: 0, FIXED: 1, BETWEEN_LINES: 2, AT_LEAST: 3 })[attr(line, 'type')] || 0,
      keepNext: yes(flow, 'keepWithNext'), keepLines: yes(flow, 'keepLines'), widow: yes(flow, 'widowOrphan'), pageBreak: yes(flow, 'pageBreakBefore'),
      border: borders[num(one(n, 'border'), 'borderFillIDRef')], borderOffset: Object.fromEntries(['left', 'right', 'top', 'bottom'].map((side) => [side, num(one(n, 'border'), 'offset' + side[0].toUpperCase() + side.slice(1))])),
      autoSpaceLatin: yes(one(n, 'autoSpacing'), 'eAsianEng'), autoSpaceNumber: yes(one(n, 'autoSpacing'), 'eAsianNum'), snapToGrid: attr(n, 'snapToGrid') === '' ? undefined : yes(n, 'snapToGrid'), suppressLineNumbers: yes(n, 'suppressLineNumbers'),
      tabs: tabs[num(n, 'tabPrIDRef')], heading: ({ OUTLINE: 1, NUMBER: 2, BULLET: 3 })[attr(heading, 'type')] || 0, numbering: num(heading, 'idRef'), level: Math.max(0, num(heading, 'level') || 0) };
  });
  const styles = indexed(descendants(header, 'style'), (n) => ({ name: attr(n, 'name'), type: attr(n, 'type') === 'CHAR' ? 'character' : 'paragraph', para: num(n, 'paraPrIDRef'), char: num(n, 'charPrIDRef') }));
  const listDefinitions = {};
  const formats = namedNumberFormats;
  for (const n of descendants(header, 'numbering')) listDefinitions[`n${num(n, 'id')}`] = children(n, 'paraHead').slice(0, 9).map((l, level) => ({ level, start: Math.max(1, num(l, 'start', num(n, 'start', 1))), format: formats[attr(l, 'numFormat')] || 'decimal', text: l.textContent, align: enumAttr(l, 'align', HORIZONTAL, 'left'), char: num(l, 'charPrIDRef') }));
  for (const b of descendants(header, 'bullet')) listDefinitions[`b${num(b, 'id')}`] = Array.from({ length: 7 }, (_, level) => ({ level, start: 1, format: 'bullet', text: hanwordSymbolText(attr(b, 'char', '•')) }));
  const images = new Map(), model = { sections: [], chars, paras, styles, warnings, images, listDefinitions, fontFallbacks }; let cells = 0, hiddenCommentId = 0;
  const masterPages = [];
  // Manifest aliases must share the same media object. Otherwise one
  // budgeted ZIP entry can be copied into the DOCX arbitrarily often.
  function pictureResource(id) {
    const item = items.get(id); if (!item?.path || !zip.has(item.path)) return null;
    if (!images.has(item.path)) {
      // One damaged picture entry must not fail the whole import; it becomes a missing picture.
      try { images.set(item.path, imageResource(zip.read(item.path), item.path.split('.').pop(), item.type)); } catch (e) {
        if (!(e instanceof HwpError)) throw e;
        warnings.add('An embedded picture could not be read.'); images.set(item.path, null);
      }
    }
    return images.get(item.path);
  }
  /** A picture fill (shape or cell background) as an image run the media pipeline can prepare. */
  function pictureFill(brush, width, height) {
    const img = one(brush, 'img'), resource = pictureResource(attr(img, 'binaryItemIDRef'));
    if (!resource) { warnings.add('A picture fill refers to a missing picture; its base color is used.'); return null; }
    if (!/^(TOTAL|)$/.test(attr(brush, 'mode', 'TOTAL'))) warnings.add('Tiled and centered picture fills are stretched over their shape.');
    return { kind: 'image', image: resource, width, height, alt: 'Picture fill', effects: {}, adjustments: { brightness: num(img, 'bright'), contrast: num(img, 'contrast'), effect: attr(img, 'effect', 'REAL_PIC'), transparency: num(img, 'alpha') } };
  }
  function shapeFill(shape, brush) {
    const fill = one(brush, 'winBrush'), gradient = one(brush, 'gradation'), image = one(brush, 'imgBrush');
    shape.fill = color(attr(fill, 'faceColor'));
    if (attr(fill, 'hatchStyle', 'NONE') !== 'NONE' && shape.fill) shape.hatch = { color: color(attr(fill, 'hatchColor')) || '000000' };
    if (gradient) {
      shape.gradient = { type: attr(gradient, 'type', 'LINEAR'), angle: num(gradient, 'angle'), centerX: num(gradient, 'centerX', 50), centerY: num(gradient, 'centerY', 50), blur: num(gradient, 'step', 255), center: num(gradient, 'stepCenter', 50), colors: children(gradient, 'color').map((c) => color(attr(c, 'value'))).filter(Boolean), positions: [] };
      shape.fill ||= shape.gradient.colors[0];
    }
    if (image) shape.pictureFill = pictureFill(image, shape.width, shape.height);
  }
  const oleCache = new Map();
  /** The picture an embedded OLE object shows, decoded once per package entry. */
  function oleResource(id) {
    const item = items.get(id); if (!item?.path || !zip.has(item.path)) return null;
    if (!oleCache.has(item.path)) {
      // One damaged object entry must not fail the whole import; a placeholder names the object.
      try { const bytes = oleImage(zip.read(item.path)); oleCache.set(item.path, bytes ? imageResource(bytes) : null); } catch (e) {
        if (!(e instanceof HwpError)) throw e;
        warnings.add('An embedded object could not be read.'); oleCache.set(item.path, null);
      }
    }
    return oleCache.get(item.path);
  }
  const authors = new Map(descendants(header, 'trackChangeAuthor').map((n) => [attr(n, 'id'), attr(n, 'name')]));
  const revisions = new Map(descendants(header, 'trackChange').map((n) => [attr(n, 'id'), { author: authors.get(attr(n, 'authorID')) || '', date: attr(n, 'date') }]));
  const metadata = one(pkg, 'metadata');
  model.metadata = Object.fromEntries(['title', 'subject', 'creator', 'description', 'language'].map((key) => [key, one(metadata, key)?.textContent || '']));
  for (const meta of descendants(metadata, 'meta')) {
    const key = { title: 'title', subject: 'subject', creator: 'creator', description: 'description', keyword: 'keywords', keywords: 'keywords', lastsaveby: 'lastModifiedBy' }[attr(meta, 'name').toLowerCase()];
    if (key) model.metadata[key] = meta.textContent || (attr(meta, 'content') !== 'text' ? attr(meta, 'content') : '');
  }
  function blocks(n, section) {
    const local = { ...section, headers: [], footers: [], nested: true };
    return children(n, 'p').map((p) => paragraph(p, local));
  }
  /** An object's caption as blocks placed before (top/left captions) or after (bottom/right) it in the flow. */
  function captionBlocks(n, section) {
    const caption = children(n, 'caption')[0];
    if (!caption) return { before: [], after: [], side: null };
    const side = attr(caption, 'side', 'BOTTOM').toUpperCase(), content = { kind: 'blocks', blocks: blocks(one(caption, 'subList'), section) };
    if (side === 'LEFT' || side === 'RIGHT') warnings.add('Captions beside an object are placed above or below it.');
    return side === 'TOP' || side === 'LEFT' ? { before: [content], after: [], side } : { before: [], after: [content], side };
  }
  function objectProperties(n, section, fallback = {}, inGroup = false) {
    const size = children(n, 'sz')[0], current = children(n, 'curSz')[0], original = children(n, 'orgSz')[0];
    const dimension = (key, fallback) => {
      // A zero extent is meaningful for horizontal/vertical lines. curSz=0
      // on other objects means "use orgSz", especially inside groups.
      const line = n.localName === 'line';
      let value = line ? num(size, key, num(current, key, num(original, key, fallback)))
        : num(size, key) || num(current, key) || num(original, key) || fallback;
      if (line && !value && num(original, key) > 0 && !size) value = num(original, key);
      const relative = attr(size, key + 'RelTo', 'ABSOLUTE'), page = section.page;
      if (relative !== 'ABSOLUTE' && page) {
        const available = key === 'width' ? page.width - page.left - page.right : page.height - page.top - page.bottom;
        value = value / 10000 * (relative === 'PAPER' ? page[key] : relative === 'COLUMN' && key === 'width' ? available / (section.columns || 1) : available);
      }
      return value > 0 || line && value === 0 ? value : undefined;
    };
    const pos = children(n, 'pos')[0], margin = children(n, 'outMargin')[0];
    let layout;
    if (pos && !yes(pos, 'treatAsChar')) {
      const horizontal = { PAPER: 'page', PAGE: 'margin', COLUMN: 'column', PARA: 'column' }, vertical = { PAPER: 'page', PAGE: 'margin', PARA: 'paragraph' };
      const wrap = attr(n, 'textWrap');
      layout = { h: horizontal[attr(pos, 'horzRelTo')] || 'column', v: vertical[attr(pos, 'vertRelTo')] || 'paragraph', x: signed(pos, 'horzOffset'), y: signed(pos, 'vertOffset'), hAlign: attr(pos, 'horzAlign', 'LEFT').toLowerCase(), vAlign: attr(pos, 'vertAlign', 'TOP').toLowerCase(), wrap: wrap === 'SQUARE' || wrap === 'TIGHT' || wrap === 'THROUGH' ? 'square' : wrap === 'TOP_AND_BOTTOM' ? 'topAndBottom' : 'none', wrapText: { LEFT_ONLY: 'left', RIGHT_ONLY: 'right', LARGEST_ONLY: 'largest' }[attr(n, 'textFlow')] || 'bothSides', behind: wrap === 'BEHIND_TEXT', margins: margins(margin), overlap: attr(pos, 'allowOverlap', '1') !== '0', inCell: attr(pos, 'flowWithText', '1') !== '0', zOrder: num(n, 'zOrder') };
      if (wrap === 'TIGHT' || wrap === 'THROUGH') warnings.add('Contour wrapping is approximated with rectangular wrapping.');
    }
    const properties = { width: dimension('width', fallback.width ?? 14400), height: dimension('height', fallback.height ?? 14400), layout, alt: children(n, 'shapeComment')[0]?.textContent || '', rotation: num(children(n, 'rotationInfo')[0], 'angle'), flipH: yes(children(n, 'flip')[0], 'horizontal'), flipV: yes(children(n, 'flip')[0], 'vertical'), ...hyperlinkTarget(attr(n, 'href')) };
    if (inGroup) {
      const matrices = children(children(n, 'renderingInfo')[0]).filter((m) => ['transMatrix', 'scaMatrix', 'rotMatrix'].includes(m.localName));
      if (matrices.length) {
        const matrix = composeDrawingMatrices(matrices.map((m) => Array.from({ length: 6 }, (_, i) => num(m, `e${i + 1}`, i === 0 || i === 4 ? 1 : 0))));
        Object.assign(properties, groupPlacement(matrix, num(original, 'width', properties.width), num(original, 'height', properties.height), warnings));
      } else {
        const offset = children(n, 'offset')[0];
        Object.assign(properties, { x: signed(offset, 'x'), y: signed(offset, 'y') });
      }
      delete properties.layout;
    }
    return properties;
  }
  function paragraph(n, section) {
    const p = { kind: 'p', para: num(n, 'paraPrIDRef'), style: num(n, 'styleIDRef'), pageBreak: yes(n, 'pageBreak'), columnBreak: yes(n, 'columnBreak'), runs: [] };
    const segments = children(children(n, 'linesegarray')[0], 'lineseg');
    if (!section.nested) p.sourceLinePositions = segments.map((line) => num(line, 'vertpos'));
    for (const run of children(n, 'run')) for (const child of children(run)) p.runs.push(...content(child, num(run, 'charPrIDRef'), section));
    // Like the binary reader: percentage spacing rests on Hanword's text height, which the DOCX
    // multiplier does not reproduce with substitute fonts. Text-only paragraphs keep the
    // recorded line height (vertsize plus spacing); objects still need automatic height.
    if (paras[p.para]?.lineType === 0 && segments.length && p.runs.every((run) => ['text', 'fieldStart', 'fieldEnd', 'bookmark', 'field', 'ruby', 'pageHiding', 'highlight'].includes(run.kind))) {
      const heights = segments.map((line) => num(line, 'vertsize') + num(line, 'spacing')).filter((height) => height > 0 && height <= 1000000);
      if (heights.length) p.lineHeight = heights.reduce((a, b) => Math.max(a, b), 0);
    }
    // Highlighter marks bracket runs and objects, and a mark over a table
    // highlights all of its text. An unterminated mark ends with the paragraph.
    let highlight = null;
    p.runs = p.runs.filter((run) => {
      if (run.kind === 'highlight') { highlight = run.color; return false; }
      if (highlight) applyHighlight(run, highlight);
      return true;
    });
    showFieldGuides(p.runs);
    return p;
  }
  function applyHighlight(run, highlight, depth = 0) {
    check(depth <= LIMITS.depth);
    if (run.kind === 'text') run.highlight = highlight;
    for (const cell of run.cells || []) for (const block of cell.blocks) for (const inner of block.runs || []) applyHighlight(inner, highlight, depth + 1);
  }
  function pictureEffects(n) {
    const effects = {};
    for (const child of children(n)) {
      const kind = child.localName; if (!['shadow', 'glow', 'softEdge', 'reflection'].includes(kind)) continue;
      const skew = children(child, 'skew')[0], scale = children(child, 'scale')[0], alpha = children(child, 'alpha')[0], pos = children(child, 'pos')[0];
      const item = { style: attr(child, 'style'), radius: num(child, 'radius'), transparency: num(child, 'alpha'), direction: num(child, 'direction'), distance: num(child, 'distance'), align: attr(child, 'alignStyle', 'CENTER'), rotate: yes(child, 'rotationStyle'), skewX: num(skew, 'x'), skewY: num(skew, 'y'), scaleX: num(scale, 'x', 1), scaleY: num(scale, 'y', 1), startAlpha: num(alpha, 'start'), endAlpha: num(alpha, 'end', 1), startPos: num(pos, 'start'), endPos: num(pos, 'end', 1), fadeDirection: num(child, 'fadeDirection', 90) };
      const c = children(child, 'effectsColor')[0], rgb = children(c, 'rgb')[0];
      if (rgb) item.color = { value: ['r', 'g', 'b'].map((key) => Math.max(0, Math.min(255, Math.round(num(rgb, key)))).toString(16).padStart(2, '0')).join(''), transforms: children(c, 'effect').map((e) => ({ name: attr(e, 'type').toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase()), value: num(e, 'value') })) };
      else if (c) warnings.add('A picture effect color uses an unsupported color space.');
      effects[kind] = item;
    }
    return effects;
  }
  function content(n, char, section, inGroup = false) {
    // A carriage return written as a character reference is a line break; written raw, parsers normalize it away inside the run.
    const text = (s) => [{ kind: 'text', text: hanwordSymbolText(String(s).replace(/\r\n?/g, '\n')), char }];
    switch (n.localName) {
      case 't': return [...n.childNodes].flatMap((c) => c.nodeType === 3 || c.nodeType === 4 ? text(c.textContent) : c.nodeType === 1 ? content(c, char, section) : []);
      case 'lineBreak': return text('\n'); case 'tab': return text('\t'); case 'nbSpace': return text('\u00a0'); case 'fwSpace': return text('\u2007'); case 'hyphen': return text('\u00ad');
      case 'secPr': {
        const page = one(n, 'pagePr'), m = one(page, 'margin');
        if (page) { let width = num(page, 'width'), height = num(page, 'height'); if (attr(page, 'landscape') === 'NARROWLY') [width, height] = [height, width];
          section.page = { width, height, ...margins(m), top: num(m, 'top') + num(m, 'header'), bottom: num(m, 'bottom') + num(m, 'footer'), header: num(m, 'top'), footer: num(m, 'bottom'), gutter: num(m, 'gutter') }; }
        const start = one(n, 'startNum'), visibility = one(n, 'visibility');
        section.pageStart = num(start, 'page'); section.breakType = ({ EVEN: 'evenPage', ODD: 'oddPage' })[attr(start, 'pageStartsOn')];
        section.hideFirstHeader = yes(visibility, 'hideFirstHeader'); section.hideFirstFooter = yes(visibility, 'hideFirstFooter'); section.hideFirstPageNum = yes(visibility, 'hideFirstPageNum');
        section.direction = textDirection(attr(n, 'textDirection'));
        section.defaultTab = attr(n, 'tabStopUnit') === 'HWPUNIT' && attr(n, 'tabStopVal') !== '' ? num(n, 'tabStopVal') : legacyTabUnits(num(n, 'tabStop'));
        for (const kind of ['footNote', 'endNote']) {
          const note = one(n, kind + 'Pr'); if (!note) continue;
          const numbering = one(note, 'numbering');
          section[kind] = { format: formats[attr(one(note, 'autoNumFormat'), 'type')] || 'decimal', start: num(numbering, 'newNum', 1), restart: ({ CONTINUOUS: 'continuous', ON_SECTION: 'eachSect', ON_PAGE: 'eachPage' })[attr(numbering, 'type')] || 'continuous' };
        }
        // Line numbers: 1 continuous, 2 restarting each page, 3 restarting each section.
        const numbers = one(n, 'lineNumberShape'), restart = num(numbers, 'restartType');
        if (restart && attr(visibility, 'showLineNumber', '1') !== '0') section.lineNumbers = { restart: ['continuous', 'continuous', 'newPage', 'newSection'][restart] || 'continuous', countBy: Math.max(1, num(numbers, 'countBy', 1)), distance: num(numbers, 'distance'), start: Math.max(1, num(numbers, 'startNumber', 1)) };
        const pageBorders = descendants(n, 'pageBorderFill'), pageBorder = pageBorders.find((b) => attr(b, 'type', 'BOTH') === 'BOTH') || pageBorders[0];
        if (pageBorder && borders[num(pageBorder, 'borderFillIDRef')]) section.pageBorder = { border: borders[num(pageBorder, 'borderFillIDRef')], offset: margins(one(pageBorder, 'offset')), fromText: attr(pageBorder, 'textBorder', 'PAPER') !== 'PAPER' };
        for (const master of children(n, 'masterPage')) masterPages.push({ section, id: attr(master, 'idRef') });
        return [];
      }
      case 'ctrl': return children(n).flatMap((c) => content(c, char, section));
      case 'fieldBegin': {
        const command = descendants(n, 'stringParam').find((p) => attr(p, 'name') === 'Command')?.textContent || '';
        const id = attr(n, 'id'), type = attr(n, 'type');
        if (type === 'HYPERLINK') {
          const target = hyperlinkTarget(command);
          if (target.href || target.anchor) return [{ kind: 'fieldStart', id, ...target }];
        }
        if (type === 'BOOKMARK') return [{ kind: 'fieldStart', id, bookmark: attr(n, 'name') || command }];
        if (type === 'CLICK_HERE') {
          // An empty click-here field shows its guide text; a filled one is ordinary text.
          const guide = descendants(n, 'stringParam').find((p) => attr(p, 'name') === 'Direction')?.textContent || clickHereGuide(command);
          return [{ kind: 'fieldStart', id, char, placeholder: guide.trim() }];
        }
        if (type === 'FORMULA') { warnings.add('Table formulas are imported as their last calculated values.'); return [{ kind: 'fieldStart', id }]; }
        if (['DATE', 'DOCDATE', 'PATH', 'USER_INFO', 'SUMMARY', 'MAILMERGE', 'CROSSREF', 'TABLEOFCONTENTS', 'PRIVATE_INFO_SECURITY'].includes(type)) {
          warnings.add('Date, path, cross-reference and similar fields are imported as their displayed text.'); return [{ kind: 'fieldStart', id }];
        }
        if (type === 'MEMO') {
          const list = one(n, 'subList');
          if (list) {
            const parameters = new Map(descendants(n, 'stringParam').map((p) => [attr(p, 'name'), p.textContent]));
            return [{ kind: 'fieldStart', id, comment: { author: parameters.get('Author') || '', date: parameters.get('CreateDateTime') || parameters.get('Date') || '', blocks: blocks(list, section) } }];
          }
        }
        warnings.add('Some fields or internal hyperlinks were converted to plain text.'); return [{ kind: 'fieldStart', id }];
      }
      case 'fieldEnd': return [{ kind: 'fieldEnd', id: attr(n, 'beginIDRef') }];
      case 'bookmark': return [{ kind: 'bookmark', name: attr(n, 'name') }];
      case 'insertBegin': case 'deleteBegin': return [{ kind: 'revisionStart', id: attr(n, 'Id'), revision: { type: n.localName === 'insertBegin' ? 'ins' : 'del', ...revisions.get(attr(n, 'TcId')) } }];
      case 'insertEnd': case 'deleteEnd': return [{ kind: 'revisionEnd', id: attr(n, 'Id') }];
      case 'colPr': {
        section.columns = num(n, 'colCount', 1); section.columnGap = num(n, 'sameGap', 3600);
        if (section.nested && section.columns > 1) warnings.add('Columns inside tables or text boxes are simplified.');
        section.columnSizes = children(n, 'colSz').map((c) => ({ width: num(c, 'width'), gap: num(c, 'gap') }));
        section.columnSeparator = !!one(n, 'colLine') && attr(one(n, 'colLine'), 'type') !== 'NONE';
        if (section.columns > 1 && attr(n, 'type', 'NEWSPAPER') !== 'NEWSPAPER') warnings.add('Balanced or parallel columns may paginate differently.');
        return [];
      }
      case 'pageNum': section.pageNumber = { position: attr(n, 'pos'), format: formats[attr(n, 'formatType')] || 'decimal', prefix: attr(n, 'sideChar'), suffix: attr(n, 'sideChar'), char }; return [];
      case 'newNum': if (attr(n, 'numType') === 'PAGE') section.pageStart = num(n, 'num', 1); else warnings.add('Some counter restarts are not preserved.'); return [];
      case 'pageNumCtrl': section.breakType = ({ EVEN: 'evenPage', ODD: 'oddPage' })[attr(n, 'pageStartsOn')]; return [];
      case 'pageHiding':
        return [{ kind: 'pageHiding', hideFirstHeader: yes(n, 'hideHeader'), hideFirstFooter: yes(n, 'hideFooter'), hideFirstPageNum: yes(n, 'hidePageNum') }];
      case 'header': case 'footer': {
        const apply = attr(n, 'applyPageType');
        section[n.localName === 'header' ? 'headers' : 'footers'].push({ type: apply === 'EVEN' ? 'even' : apply === 'ODD' ? 'odd' : 'default', blocks: blocks(one(n, 'subList'), section) }); return [];
      }
      case 'footNote': case 'endNote': return [{ kind: 'note', end: n.localName === 'endNote', blocks: blocks(one(n, 'subList'), section) }];
      case 'tbl': {
        const rows = num(n, 'rowCnt'), cols = num(n, 'colCnt'); check(Number.isInteger(rows) && Number.isInteger(cols) && rows > 0 && cols > 0);
        check(rows * cols <= LIMITS.cells, TOO_MANY_CELLS); cells += rows * cols; check(cells <= LIMITS.documentCells, TOO_MANY_CELLS);
        const pos = children(n, 'pos')[0];
        const table = { kind: 'table', rows, cols, border: borders[num(n, 'borderFillIDRef')], padding: margins(children(n, 'inMargin')[0]), repeatHeader: yes(n, 'repeatHeader'), cellSpacing: num(n, 'cellSpacing'), cantSplit: attr(n, 'pageBreak') === 'NONE', align: enumAttr(pos, 'horzAlign', HORIZONTAL, 'left'), cells: [] };
        for (const row of children(n, 'tr')) for (const cell of children(row, 'tc')) {
          const address = children(cell, 'cellAddr')[0], span = children(cell, 'cellSpan')[0], size = children(cell, 'cellSz')[0], list = children(cell, 'subList')[0];
          const border = borders[num(cell, 'borderFillIDRef')];
          const item = { col: num(address, 'colAddr'), row: num(address, 'rowAddr'), colSpan: num(span, 'colSpan', 1), rowSpan: num(span, 'rowSpan', 1), width: num(size, 'width'), height: num(size, 'height'), header: yes(cell, 'header'), padding: yes(cell, 'hasMargin') ? margins(children(cell, 'cellMargin')[0]) : undefined, align: enumAttr(list, 'vertAlign', VERTICAL, 'top'), direction: textDirection(attr(list, 'textDirection')), border, blocks: blocks(list, section) };
          if (typeof border?.pictureFill === 'string') { const resource = pictureResource(border.pictureFill); if (resource) item.pictureFill = { kind: 'image', image: resource, width: item.width, height: item.height, alt: 'Cell background', effects: {}, adjustments: {} }; }
          table.cells.push(item);
        }
        const caption = children(n, 'caption')[0];
        if (caption) { table.caption = blocks(one(caption, 'subList'), section); table.captionSide = attr(caption, 'side', 'BOTTOM').toUpperCase(); if (/^(LEFT|RIGHT)$/.test(table.captionSide)) warnings.add('Captions beside an object are placed above or below it.'); }
        return [table];
      }
      case 'pic': {
        const img = children(n, 'img')[0], id = attr(img, 'binaryItemIDRef'), item = items.get(id);
        const caption = captionBlocks(n, section);
        // One damaged picture entry becomes a missing picture, as it does for a fill; it must not fail the whole import.
        const resource = item?.path && zip.has(item.path) ? pictureResource(id) : null;
        if (!resource) {
          if (!item?.path || !zip.has(item.path)) warnings.add('An external or missing picture could not be imported.');
          const result = text(`[Missing picture${children(n, 'shapeComment')[0]?.textContent ? ': ' + children(n, 'shapeComment')[0].textContent : ''}]`);
          if (inGroup) Object.assign(result[0], objectProperties(n, section, {}, true));
          return [...caption.before, ...result, ...caption.after];
        }
        const dim = children(n, 'imgDim')[0], clip = children(n, 'imgClip')[0];
        const dimensions = { width: num(dim, 'dimwidth') || (resource.dimensions?.width || 0) * 75, height: num(dim, 'dimheight') || (resource.dimensions?.height || 0) * 75 };
        const crop = imageCrop(clip && { left: signed(clip, 'left'), top: signed(clip, 'top'), right: attr(clip, 'right') === '' ? dimensions.width : signed(clip, 'right'), bottom: attr(clip, 'bottom') === '' ? dimensions.height : signed(clip, 'bottom') }, dimensions, warnings);
        const line = children(n, 'lineShape')[0];
        const picture = { kind: 'image', image: resource, ...objectProperties(n, section, { width: 0, height: 0 }, inGroup), crop,
          adjustments: { brightness: num(img, 'bright'), contrast: num(img, 'contrast'), effect: attr(img, 'effect', 'REAL_PIC'), transparency: num(img, 'alpha') },
          line: line ? { color: color(attr(line, 'color')), width: num(line, 'width'), style: attr(line, 'style', 'SOLID'), transparency: num(line, 'alpha') } : null, effects: pictureEffects(children(n, 'effects')[0]) };
        Object.assign(picture, imageDimensions(picture));
        if (children(children(n, 'effects')[0]).length) warnings.add('Advanced picture effects (shadow, glow, soft edges and reflection) may differ in the editor.');
        return [...caption.before, picture, ...caption.after];
      }
      case 'rect': case 'ellipse': case 'line': case 'polygon': case 'arc': case 'curve': case 'connectLine': try {
        const properties = objectProperties(n, section, {}, inGroup), line = children(n, 'lineShape')[0], brush = children(n, 'fillBrush')[0], drawText = children(n, 'drawText')[0];
        const shape = { kind: 'shape', shape: n.localName === 'rect' && num(n, 'ratio') ? 'roundRect' : n.localName, ...properties,
          line: { color: color(attr(line, 'color')) || '000000', width: num(line, 'width', 33), style: attr(line, 'style', 'SOLID'), cap: attr(line, 'endCap', 'FLAT'), head: attr(line, 'headStyle'), tail: attr(line, 'tailStyle'), headSize: attr(line, 'headSz'), tailSize: attr(line, 'tailSz'), headFill: attr(line, 'headfill') === '' ? true : yes(line, 'headfill'), tailFill: attr(line, 'tailfill') === '' ? true : yes(line, 'tailfill') },
          blocks: drawText ? blocks(one(drawText, 'subList'), section) : [], padding: margins(one(drawText, 'textMargin')), textAlign: attr(one(drawText, 'subList'), 'vertAlign', 'TOP').toLowerCase() };
        shapeFill(shape, brush);
        if (shape.shape === 'roundRect') shape.roundness = num(n, 'ratio');
        const shadow = children(n, 'shadow')[0];
        if (shadow && attr(shadow, 'type', 'NONE') !== 'NONE') shape.shadow = { color: color(attr(shadow, 'color')) || '808080', x: signed(shadow, 'offsetX'), y: signed(shadow, 'offsetY'), transparency: num(shadow, 'alpha') / 100 };
        // Path coordinates use the original size; the shape box may since have been resized.
        const org = children(n, 'orgSz')[0]; shape.coordWidth = num(org, 'width') || properties.width; shape.coordHeight = num(org, 'height') || properties.height;
        const point = (name) => { const p = one(n, name); return { x: signed(p, 'x'), y: signed(p, 'y') }; };
        if (n.localName === 'polygon') shape.points = children(n, 'pt').map((p) => ({ x: num(p, 'x'), y: num(p, 'y') }));
        if (n.localName === 'arc') {
          const type = attr(n, 'type', 'NORMAL').toUpperCase();
          shape.shape = 'custom'; shape.path = arcPath(type, point('center'), point('ax1'), point('ax2'));
          if (type !== 'PIE' && type !== 'CHORD') { shape.fill = null; delete shape.gradient; delete shape.pictureFill; }
        }
        if (n.localName === 'curve') {
          const segments = children(n, 'seg');
          check(segments.length > 0, 'A Hanword curve has no segments.');
          const points = [{ x: signed(segments[0], 'x1'), y: signed(segments[0], 'y1') }, ...segments.map((s) => ({ x: signed(s, 'x2'), y: signed(s, 'y2') }))];
          const { path, closed } = curvePath(points, segments.map((s) => attr(s, 'type', 'CURVE').toUpperCase()));
          shape.shape = 'custom'; shape.path = path;
          if (!closed) { shape.fill = null; delete shape.gradient; delete shape.pictureFill; }
          warnings.add('Curves are smoothed through their points; Hanword’s exact curvature can differ.');
        }
        if (n.localName === 'connectLine') {
          shape.shape = 'custom'; shape.path = [{ kind: 'move', ...point('startPt') }, { kind: 'line', ...point('endPt') }]; shape.fill = null;
          if (!/^STRAIGHT/i.test(attr(n, 'type', 'STRAIGHT_NOARROW'))) warnings.add('Bent and curved connectors are drawn as straight lines.');
        }
        if (n.localName === 'line') {
          const start = one(n, 'startPt'), end = one(n, 'endPt'); shape.flipV = (num(end, 'y') < num(start, 'y')) !== shape.flipV;
          shape.flipH = (num(end, 'x') < num(start, 'x')) !== shape.flipH;
        }
        const caption = captionBlocks(n, section);
        return [...caption.before, shape, ...caption.after];
      } catch (e) {
        // One drawing collapsed to nothing (an arc of no radius, a curve without segments, a member scaled to zero) is left out.
        if (!(e instanceof HwpError)) throw e;
        warnings.add('A drawing with an invalid geometry was left out.');
        return [];
      }
      case 'equation': return [{ kind: 'equation', text: one(n, 'script')?.textContent || '', size: num(n, 'baseUnit', 1000), color: color(attr(n, 'textColor')), char }];
      case 'dutmal': return [{ kind: 'ruby', text: one(n, 'mainText')?.textContent || '', ruby: one(n, 'subText')?.textContent || '', below: attr(n, 'posType') === 'BOTTOM', char }];
      case 'compose': warnings.add('Overlapping characters are imported as text.'); return text(attr(n, 'composeText') || attr(n, 'char'));
      case 'titleMark': return []; // A contents-entry marker prints nothing.
      case 'markpenBegin': return [{ kind: 'highlight', color: color(attr(n, 'color')) || 'FFFF00' }];
      case 'markpenEnd': return [{ kind: 'highlight', color: null }];
      case 'hiddenComment': {
        // A hidden comment is a non-printing note at a point in the text; a DOCX comment is the same kind of annotation.
        const content = blocks(one(n, 'subList'), section);
        if (!hasContent(content)) return [];
        warnings.add('Hidden comments are imported as comments.');
        const id = `hidden${++hiddenCommentId}`;
        return [{ kind: 'fieldStart', id, comment: { author: '', date: '', blocks: content } }, { kind: 'fieldEnd', id }];
      }
      case 'checkBtn': case 'radioBtn': case 'button': case 'btn': case 'edit': case 'comboBox': case 'listBox': {
        warnings.add('Form controls are imported as their visible text and selection state.');
        const mark = n.localName === 'checkBtn' ? (attr(n, 'value') === 'CHECKED' ? '☑ ' : '☐ ') : n.localName === 'radioBtn' ? (attr(n, 'value') === 'CHECKED' ? '◉ ' : '○ ') : '';
        return text(mark + (one(n, 'text')?.textContent || attr(n, 'caption') || attr(n, 'text') || attr(n, 'name')));
      }
      case 'textart': {
        // Text art keeps its words, font and color in a plain text box; the warped outline is not reproduced.
        const properties = objectProperties(n, section, {}, inGroup), pr = one(n, 'textartPr'), brush = children(n, 'fillBrush')[0];
        const lines = textArtLines(attr(n, 'text')), style = attr(pr, 'fontStyle', ''), font = attr(pr, 'fontName') || undefined, lineSpacing = num(pr, 'lineSpacing', 120);
        const props = { font, eastAsia: font, bold: /진하게|bold/i.test(style), italic: /기울임|italic/i.test(style), color: color(attr(one(brush, 'winBrush'), 'faceColor')) || '000000', relativeSize: 100, scale: 100, spacing: 0, position: 0 };
        const align = enumAttr(pr, 'align', HORIZONTAL, 'center');
        warnings.add('Text art is imported as text in a box; its curved outline is not reproduced.');
        return [{ kind: 'shape', shape: 'rect', ...properties, fill: null, line: { style: 'NONE', width: 0 }, textAlign: 'center', padding: { left: 0, right: 0, top: 0, bottom: 0 },
          blocks: lines.map((line) => {
            const size = textArtSize(line, lines.length, properties.width, properties.height, lineSpacing);
            return { kind: 'p', props: { align, line: Math.round(size * Math.max(50, lineSpacing) / 100), lineType: 1 }, runs: [{ kind: 'text', text: hanwordSymbolText(line), char, props: { ...props, size } }] };
          }) }];
      }
      case 'ole': case 'chart': {
        const properties = objectProperties(n, section, {}, inGroup), comment = children(n, 'shapeComment')[0]?.textContent?.trim() || '';
        const resource = n.localName === 'ole' ? oleResource(attr(n, 'binaryItemIDRef')) : null;
        if (resource) {
          warnings.add('Embedded objects are imported as the pictures they display.');
          const run = { kind: 'image', image: resource, ...properties, alt: comment, adjustments: {}, effects: {} };
          return [Object.assign(run, imageDimensions(run))];
        }
        warnings.add('An embedded object or chart has no picture that can be shown; a placeholder names it.');
        const result = text(`[${n.localName === 'chart' ? 'Chart' : 'Embedded object'}${comment ? ': ' + comment.split('\n')[0] : ''}]`);
        if (inGroup) Object.assign(result[0], properties);
        return result;
      }
      case 'video': {
        const properties = objectProperties(n, section, {}, inGroup), comment = children(n, 'shapeComment')[0]?.textContent?.trim() || '';
        const resource = pictureResource(attr(n, 'imageIDRef'));
        if (resource) {
          warnings.add('Videos are imported as their poster pictures.');
          const run = { kind: 'image', image: resource, ...properties, alt: `Video${comment ? ': ' + comment : ''}`, adjustments: {}, effects: {} };
          return [Object.assign(run, imageDimensions(run))];
        }
        warnings.add('A video has no poster picture; a placeholder names it.');
        const result = text(`[Video${comment ? ': ' + comment : ''}]`);
        if (inGroup) Object.assign(result[0], properties);
        return result;
      }
      case 'container': {
        // Like binary HWP, each leaf carries its full matrix sequence. Flatten
        // nested containers in paint order without applying ancestor matrices twice.
        const drawingChildren = [], following = [];
        function collect(container) {
          for (const child of children(container)) {
            if (child.localName === 'container') { collect(child); continue; }
            if (!['pic', 'tbl', 'equation', 'rect', 'ellipse', 'line', 'polygon', 'curve', 'arc', 'connectLine', 'ole', 'chart', 'video', 'textart'].includes(child.localName)) continue;
            for (const run of content(child, char, section, true)) {
              if (['image', 'shape'].includes(run.kind) || run.kind === 'text' && run.width !== undefined) drawingChildren.push(run);
              else { following.push(run); warnings.add('Some unsupported group content follows its drawing in the document flow.'); }
            }
          }
        }
        collect(n);
        const caption = captionBlocks(n, section);
        return [...caption.before, ...(drawingChildren.length ? [{ kind: 'group', ...objectProperties(n, section), children: drawingChildren }] : []), ...following, ...caption.after];
      }
      case 'autoNum': {
        const type = attr(n, 'numType');
        if (type === 'PAGE' || type === 'TOTAL_PAGE') return [{ kind: 'field', instruction: type === 'PAGE' ? 'PAGE' : 'NUMPAGES', text: attr(n, 'num', '1') }];
        if (type === 'FOOTNOTE' || type === 'ENDNOTE') return [];
        // Figure, table and equation numbers become SEQ fields showing Hanword's last value in its format.
        const format = one(n, 'autoNumFormat'), sequence = { PICTURE: 'Figure', TABLE: 'Table', EQUATION: 'Equation' }[type];
        const label = attr(format, 'prefixChar') + formatNumber(formats[attr(format, 'type')] || 'decimal', num(n, 'num', 1)) + attr(format, 'suffixChar');
        if (!sequence) { warnings.add('Some counters are imported as text.'); return text(label); }
        return [{ kind: 'field', instruction: `SEQ ${sequence} \\* ARABIC`, text: hanwordSymbolText(label), char }];
      }
      default: {
        const subs = descendants(n, 'subList').filter((s) => { for (let p = s.parentElement; p && p !== n; p = p.parentElement) if (p.localName === 'subList') return false; return true; });
        if (subs.length) { warnings.add('Text boxes are placed in the document flow.'); return [{ kind: 'blocks', blocks: subs.flatMap((sub) => blocks(sub, section)) }]; }
        warnings.add('Some fields, drawings, or layout controls are not preserved.');
        if (['ole', 'chart', 'video', 'rect', 'ellipse', 'line', 'polygon', 'curve', 'arc', 'textart'].includes(n.localName)) return text(`[Unsupported ${n.localName} object]`);
        return [];
      }
    }
  }
  /**
   * Hanword writes two script parts into every file it saves: a header naming the document objects and a
   * source with empty event handlers. Only code beyond those stubs is worth a note to the user.
   */
  function scriptHasCode(path) {
    if (!path || !zip.has(path)) return false;
    let text;
    try {
      const bytes = zip.read(path);
      // The stubs are a few hundred bytes; a script part far longer than that holds code, and is not scanned.
      if (bytes.length > 64 * 1024) return true;
      const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes.length > 1 && bytes[1] === 0 && bytes[0] !== 0);
      text = new TextDecoder(utf16 ? 'utf-16le' : 'utf-8').decode(bytes);
    } catch { return true; }
    // Every pattern is bounded: a stray "function a(" repeated through a script must not cost a rescan of the rest per occurrence.
    const code = withoutScriptComments(text)
      .replace(/\bvar\s+\w+\s*=\s*\w+(?:\.\w+)*\s*;?/g, '')
      .replace(/\bfunction\s+\w+\s*\([^)\n]{0,256}\)\s*\{\s{0,256}\}/g, '')
      .trim();
    return code.length > 0;
  }
  /** The script without its comments, found in one pass: an unclosed comment runs to the end. */
  function withoutScriptComments(text) {
    let out = '', i = 0;
    while (i < text.length) {
      const slash = text.indexOf('/', i);
      if (slash < 0) return out + text.slice(i);
      const next = text[slash + 1];
      if (next === '*') { out += text.slice(i, slash); const end = text.indexOf('*/', slash + 2); if (end < 0) return out; i = end + 2; }
      else if (next === '/') { out += text.slice(i, slash); const end = text.indexOf('\n', slash); if (end < 0) return out; i = end; }
      else { out += text.slice(i, slash + 1); i = slash + 1; }
    }
    return out;
  }
  const order = descendants(pkg, 'itemref').flatMap((n) => {
    const item = items.get(attr(n, 'idref')); check(item?.path, 'The HWPX reading order references a missing part.');
    if (item.path === headerPath) return [];
    // Hanword includes script parts in the spine of otherwise ordinary files.
    // They are auxiliary parts, never body XML and never executable content.
    if (/javascript/i.test(item.type) || /^Scripts\//i.test(item.path || '')) { if (scriptHasCode(item.path)) warnings.add('Document scripts are not imported.'); return []; }
    if (attr(n, 'idref') === 'bibliography' && /^Custom\//.test(item.path || '')) { warnings.add('Bibliography database records are not imported; visible citations remain in the document.'); return []; }
    return [item.path];
  });
  check(order.length > 0 && order.length <= 1000 && new Set(order).size === order.length, 'This HWPX file has no valid section reading order.');
  for (const path of order) {
    const root = readXml(path); check(['sec', 'section'].includes(root.localName), 'The HWPX reading order contains an invalid section.');
    let section = { blocks: [], headers: [], footers: [], counters: {} }; model.sections.push(section);
    for (const p of children(root, 'p')) {
      const controls = children(p, 'run').flatMap((r) => children(r).flatMap((c) => c.localName === 'ctrl' ? children(c) : [c]));
      if (section.blocks.length && controls.some((c) => c.localName === 'colPr')) {
        section = { ...section, blocks: [], headers: [], footers: [], pageStart: 0, hideFirstHeader: false, hideFirstFooter: false, hideFirstPageNum: false, breakType: 'continuous' }; model.sections.push(section); check(model.sections.length <= 1000);
      }
      section.blocks.push(paragraph(p, section));
    }
    check(section.blocks.length > 0);
  }
  check(num(header, 'secCnt', order.length) === order.length, 'The HWPX document has missing body sections.');
  // Master pages hold page backgrounds: anchored pictures and shapes drawn on
  // every page (or every even/odd page). DOCX expresses the same through a header's
  // anchored drawings, so they join the section's header of the matching type.
  const masterCache = new Map();
  for (const { section, id } of masterPages.slice(0, 1000)) {
    const item = items.get(id);
    if (!item?.path || !zip.has(item.path)) { warnings.add('A master page could not be found; its background is not preserved.'); continue; }
    if (!masterCache.has(item.path)) {
      const root = readXml(item.path), type = attr(root, 'type', 'BOTH').toUpperCase();
      const local = { ...section, headers: [], footers: [], nested: true }, blocks = children(one(root, 'subList'), 'p').map((p) => paragraph(p, local));
      const anchored = [], dropped = { inline: false, text: false };
      for (const p of blocks) for (const run of p.runs) {
        if (['image', 'shape', 'group'].includes(run.kind) && run.layout) anchored.push({ ...run, layout: { ...run.layout, v: run.layout.v === 'paragraph' ? 'margin' : run.layout.v } });
        else if (['image', 'shape', 'group', 'table'].includes(run.kind)) dropped.inline = true;
        else if (run.kind === 'text' && run.text.trim()) dropped.text = true;
      }
      if (dropped.inline || dropped.text) warnings.add('Master-page text and inline objects are not preserved; only its anchored pictures and shapes are.');
      masterCache.set(item.path, { type, anchored });
    }
    const { type, anchored } = masterCache.get(item.path);
    if (!anchored.length) continue;
    if (!['BOTH', 'EVEN', 'ODD'].includes(type)) { warnings.add('A master page applying to one page only is not preserved.'); continue; }
    // One line of the smallest height carries the drawings so the header keeps its height.
    const carrier = { kind: 'p', props: { line: 1, lineType: 1 }, runs: anchored.map((run) => ({ ...run })) };
    const kind = type === 'EVEN' ? 'even' : type === 'ODD' ? 'odd' : 'default';
    const existing = section.headers.find((h) => h.type === kind);
    if (existing) existing.blocks.unshift(carrier); else section.headers.push({ type: kind, blocks: [carrier] });
    if (kind === 'default' && section.headers.some((h) => h.type === 'even')) section.headers.find((h) => h.type === 'even').blocks.unshift({ ...carrier, runs: anchored.map((run) => ({ ...run })) });
    warnings.add('Master-page backgrounds are placed in the page header as anchored drawings.');
  }
  resolvePageHiding(model);
  return model;
}

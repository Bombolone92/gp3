/** HWP 5 record decoder. Field layouts and interoperability notes: docs/hwp.md. */
import { Reader, HwpError, check, compoundFile, records, inflate, budget, LIMITS, TOO_MANY_CELLS } from './binary.js';
import { hyperlinkTarget, numberFormats, binaryUnderlines, binaryBorderStyles, pagePositions, hanwordSymbolText, legacyTabUnits, clickHereGuide, hasContent, showFieldGuides, binaryEmphasis } from './formatting.js';
import { imageResource, imageCrop, imageDimensions, imageFormat } from './image.js';
import { binaryPictureTail } from './picture-effects.js';
import { summaryMetadata } from './metadata.js';
import { drawingMatrix, groupPlacement, polygonPoints, binaryLine, arcPath, curvePath, textArtLines, textArtSize } from './drawing.js';
import { binaryGradient } from './fill.js';
import { oleImage } from './ole.js';
import { formatNumber } from './numbering.js';
import { resolvePageHiding } from './layout.js';

const TAG = { properties: 16, ids: 17, bin: 18, font: 19, border: 20, char: 21, tabs: 22, numbering: 23, bullet: 24, para: 25, style: 26, p: 66, text: 67, runs: 68, ctrl: 71, list: 72, page: 73, table: 77, picture: 85, equation: 88 };
const rgb = (v) => v === 0xffffffff ? null : [v & 255, (v >>> 8) & 255, (v >>> 16) & 255].map((n) => n.toString(16).padStart(2, '0')).join('');
const ctrlId = (data, offset = 0) => String.fromCharCode(...data.subarray(offset, offset + 4).slice().reverse());
const all = (nodes, tag) => nodes.flatMap((n) => [...(n.tag === tag ? [n] : []), ...all(n.children, tag)]);
// Paragraphs own the objects in their text. A shape must not extract a nested
// paragraph's pictures/tables independently or skip the containing paragraph.
const shapeRecords = (nodes, tag) => nodes.flatMap((n) => n.tag === tag ? [n] : n.tag === TAG.p ? [] : shapeRecords(n.children, tag));
const borderTypes = binaryBorderStyles;
const widths = [0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 1, 1.5, 2, 3, 4, 5];
const borderLine = (r) => ({ style: borderTypes[r.u8()] || 'single', size: Math.max(2, Math.round((widths[r.u8()] || 0.1) * 72 / 25.4 * 8)), color: rgb(r.u32()) });
/**
 * HWP fill information, shared by border fills and drawing shapes: flags, then
 * a solid brush (color, hatch color, hatch type), a gradient, a picture brush,
 * and an extension block whose first byte is the gradient's blend center.
 */
function fillInfo(r) {
  const info = {};
  if (r.remaining < 4) return info;
  const flags = r.u32();
  if (flags & 1) { info.fill = rgb(r.u32()); const hatchColor = rgb(r.u32()), hatch = r.i32(); if (hatch >= 0 && info.fill) info.hatch = { color: hatchColor || '000000' }; }
  if (flags & 4) { info.gradient = binaryGradient(r); info.fill ||= info.gradient.colors[0]; }
  if (flags & 2) { info.pictureFill = { mode: r.u8(), brightness: r.i8(), contrast: r.i8(), effect: ['REAL_PIC', 'GRAY_SCALE', 'BLACK_WHITE'][r.u8()] || 'REAL_PIC', id: r.u16() }; }
  if ((flags & 6) && r.remaining >= 4) {
    const extra = r.u32();
    if (extra >= 1 && extra <= r.remaining) { if (info.gradient) info.gradient.center = r.u8(); else r.skip(1); r.skip(extra - 1); }
    else check(extra === 0 || !info.gradient || info.pictureFill, 'The Hanword fill information is damaged.');
  }
  return info;
}
const margins = (r) => ({ left: r.u16(), right: r.u16(), top: r.u16(), bottom: r.u16() });
/** The side of a caption list header: paragraph count, list flags, then caption flags whose low two bits are left, right, top, bottom. */
const captionSide = (list) => list && list.data.length >= 12 ? ['LEFT', 'RIGHT', 'TOP', 'BOTTOM'][new DataView(list.data.buffer, list.data.byteOffset).getUint32(8, true) & 3] : 'BOTTOM';

export function parseHwp5(bytes) {
  const cfb = compoundFile(bytes), consume = budget(), warnings = new Set();
  const symbolText = (text) => hanwordSymbolText(text);
  let recordCount = 0;
  const countRecord = () => check(++recordCount <= LIMITS.records, 'This Hanword file contains too many document records.');
  const header = cfb.read('FileHeader');
  check(header.length >= 256 && new TextDecoder().decode(header.subarray(0, 17)) === 'HWP Document File', 'This file does not contain a valid Hanword HWP header.');
  const h = new Reader(header); h.pos = 32; const version = h.u32(), flags = h.u32();
  check(version >>> 24 === 5, 'This HWP version is not supported. Save it as HWP 5 or HWPX in Hanword first.');
  // FileHeader bit 9 is signature reservation, not certificate encryption (bit 8).
  if (flags & (2 | 4 | 16 | 256 | 1024)) throw new HwpError('This Hanword file is password-protected, distribution-only, or DRM-protected. Save an unprotected copy in Hanword before importing.');
  if (flags & (128 | 512)) warnings.add('Digital signature information is not preserved in the editable DOCX copy.');
  const compressed = !!(flags & 1);
  const stream = (name, zip = compressed) => { const b = cfb.read(name); if (zip) return inflate(b, consume); consume(b.length); return b; };
  const info = records(stream('DocInfo'), countRecord);
  const definitions = (tag) => all(info, tag).map((n) => new Reader(n.data));
  const counts = definitions(TAG.ids)[0]; const fontCounts = [];
  if (counts) { counts.skip(4); for (let i = 0; i < 7; i++) fontCounts.push(counts.u32()); }
  const fontFallbacks = new Map();
  const fontNames = definitions(TAG.font).map((r) => {
    const flags = r.u8(), name = r.string(), fallbacks = [];
    if (flags & 0x80) { r.skip(1); fallbacks.push(r.string()); }
    if (flags & 0x40) r.skip(10);
    if (flags & 0x20) fallbacks.push(r.string());
    if (fallbacks.length) fontFallbacks.set(name, [...new Set([...(fontFallbacks.get(name) || []), ...fallbacks.filter(Boolean)])].slice(0, 16));
    return name;
  });
  const fonts = []; let fontOffset = 0;
  for (let i = 0; i < 7; i++) { fonts.push(fontNames.slice(fontOffset, fontOffset + (fontCounts[i] || 0))); fontOffset += fontCounts[i] || 0; }
  const borders = [null, ...definitions(TAG.border).map((r) => {
    const flags = r.u16(), b = {};
    // In real files each side is a {type,width,color} tuple (not parallel arrays).
    for (const side of ['left', 'right', 'top', 'bottom']) b[side] = borderLine(r);
    // Bits 2-4 and 5-7 select a slash and a backslash diagonal drawn with the
    // diagonal line that follows the four sides. DOCX cells hold one line each way.
    const diagonal = borderLine(r);
    if (diagonal.style !== 'nil') { if ((flags >>> 2) & 7) b.tr2bl = diagonal; if ((flags >>> 5) & 7) b.tl2br = diagonal; }
    const { fill, gradient, pictureFill } = fillInfo(r);
    if (fill) b.fill = fill;
    if (gradient) b.gradient = gradient;
    // The picture is resolved where the fill is used: an empty cell can show it.
    if (pictureFill) b.pictureFill = pictureFill.id;
    return b;
  })];
  const chars = definitions(TAG.char).map((r) => {
    const faces = Array.from({ length: 7 }, () => r.u16());
    const scale = r.u8(); r.skip(6); const spacing = r.i8(); r.skip(6); const relativeSize = r.u8(); r.skip(6); const position = r.i8(); r.skip(6);
    const size = r.i32(), attr = r.u32(); r.skip(2);
    const color = rgb(r.u32()), underlineColor = rgb(r.u32()), shade = rgb(r.u32());
    // Shadow color, then (from 5.0.2.1) the character border fill and (from 5.0.3.0) the strikeout color.
    if (r.remaining >= 4) r.skip(4);
    const border = r.remaining >= 2 ? borders[r.u16()] : undefined;
    return { font: fonts[1]?.[faces[1]] || fonts[0]?.[faces[0]], eastAsia: fonts[0]?.[faces[0]], size, scale, spacing: size * spacing / 100, emphasis: binaryEmphasis((attr >>> 21) & 15), border,
      bold: !!(attr & 2), italic: !!(attr & 1), underline: ((attr >>> 2) & 3) === 1 ? binaryUnderlines[(attr >>> 4) & 15] || 'single' : false, underlineColor,
      strike: !!((attr >>> 18) & 7), doubleStrike: !!((attr >>> 18) & 7) && ((attr >>> 26) & 15) === 7,
      outline: !!((attr >>> 8) & 7), shadow: !!((attr >>> 11) & 3), emboss: !!(attr & 8192), imprint: !!(attr & 16384), relativeSize, position: size * position / 100, kerning: !!(attr & 0x40000000),
      vert: attr & 32768 ? 'superscript' : attr & 65536 ? 'subscript' : null, color, shade };
  });
  const tabs = definitions(TAG.tabs).map((r) => {
    r.skip(4); const n = r.u32(); check(n <= 1000); return Array.from({ length: n }, () => {
      const pos = legacyTabUnits(r.u32()), align = ['left', 'right', 'center', 'decimal'][r.u8()] || 'left', leader = r.u8(); r.skip(2);
      return { pos, align, leader: leader === 0 ? 'none' : leader === 1 || leader === 8 ? 'underscore' : leader === 2 || leader === 6 ? 'hyphen' : 'dot' };
    });
  });
  const paras = definitions(TAG.para).map((r) => {
    const attr = r.u32();
    const p = { align: ['both', 'left', 'right', 'center', 'distribute', 'distribute'][(attr >>> 2) & 7] || 'left', left: r.i32() / 2, right: r.i32() / 2, indent: r.i32() / 2, before: r.i32() / 2, after: r.i32() / 2, line: r.i32(), lineType: attr & 3,
      keepNext: !!(attr & (1 << 17)), keepLines: !!(attr & (1 << 18)), widow: !!(attr & (1 << 16)), pageBreak: !!(attr & (1 << 19)), heading: (attr >>> 23) & 3, level: (attr >>> 25) & 7 };
    p.tabs = tabs[r.u16()]; p.numbering = r.u16(); p.border = borders[r.u16()];
    const i16 = () => (r.u16() << 16) >> 16;
    p.borderOffset = { left: i16(), right: i16(), top: i16(), bottom: i16() };
    p.snapToGrid = !!(attr & 256);
    // Property set 2: bits 4 and 5 are automatic spacing between Korean and Latin text or numbers.
    if (r.remaining >= 4) { const attr2 = r.u32(); p.autoSpaceLatin = !!(attr2 & 16); p.autoSpaceNumber = !!(attr2 & 32); }
    if (r.remaining >= 8) { p.lineType = r.u32() & 31; p.line = r.u32(); }
    return p;
  });
  const styles = definitions(TAG.style).map((r) => {
    const name = r.string(); r.string(); const type = r.u8(); r.skip(3);
    return { name, type: type & 1 ? 'character' : 'paragraph', para: r.u16(), char: r.u16() };
  });
  const listDefinitions = {};
  definitions(TAG.numbering).forEach((r, index) => {
    const levels = Array.from({ length: 7 }, (_, level) => { const a = r.u32(); r.skip(4); const char = r.u32(); return { level, char, format: numberFormats[(a >>> 5) & 255] || 'decimal', text: r.string(), align: ['left', 'center', 'right'][a & 3] || 'left' }; });
    const start = r.u16(); for (const l of levels) l.start = Math.max(1, start);
    if (r.remaining >= 28) for (const l of levels) l.start = Math.max(1, r.u32());
    listDefinitions[`n${index + 1}`] = levels;
  });
  definitions(TAG.bullet).forEach((r, index) => { r.skip(8); const char = r.u32(), text = symbolText(String.fromCharCode(r.u16())); listDefinitions[`b${index + 1}`] = Array.from({ length: 7 }, (_, level) => ({ level, char, text, format: 'bullet', start: 1 })); });
  const bins = [null, ...definitions(TAG.bin).map((r) => {
    const attr = r.u16(), type = attr & 15;
    if (type === 0) return null;
    const id = r.u16(), ext = type === 1 ? r.string().toLowerCase() : 'ole';
    return { id, ext, compressed: ((attr >>> 4) & 3) === 0 ? compressed : ((attr >>> 4) & 3) === 1 };
  })];
  const images = new Map();
  /**
   * A picture's bytes. One stream that does not inflate (stored raw against
   * the file's word, or damaged) must not fail the whole import: raw bytes of
   * a known picture format are taken as they are, anything else yields null.
   */
  function pictureStream(name, zip) {
    try { return stream(name, zip); } catch (e) {
      if (!(e instanceof HwpError)) throw e;
      const raw = cfb.read(name);
      consume(raw.length);
      return imageFormat(raw) ? raw : null;
    }
  }
  // The BinData stream for a picture id, found once per id instead of by a scan of every stream per picture.
  let binNames = null;
  function binName(prefix) {
    if (!binNames) {
      binNames = new Map();
      for (const n of cfb.names) { const key = n.toLowerCase().slice(0, prefix.length); if (!binNames.has(key)) binNames.set(key, n); }
    }
    return binNames.get(prefix) || null;
  }
  function image(id, size) {
    const bin = bins[id];
    if (!bin) { warnings.add('An external or missing picture could not be imported.'); return { ...size, kind: 'text', text: '[Missing picture]' }; }
    if (!images.has(bin.id)) {
      const prefix = `bindata/bin${bin.id.toString(16).padStart(4, '0')}.`;
      const name = binName(prefix);
      if (!name) { warnings.add('An embedded picture is missing.'); return { ...size, kind: 'text', text: '[Missing picture]' }; }
      const data = pictureStream(name, bin.compressed);
      if (!data) { warnings.add('An embedded picture could not be read.'); return { ...size, kind: 'text', text: '[Missing picture]' }; }
      images.set(bin.id, imageResource(data, bin.ext));
    }
    const run = { kind: 'image', image: images.get(bin.id), ...size };
    return Object.assign(run, imageDimensions(run));
  }
  /** An embedded OLE object as the picture it displays, or a placeholder naming it. */
  function oleRun(id, size) {
    const bin = bins[id], prefix = bin && `bindata/bin${bin.id.toString(16).padStart(4, '0')}.`;
    const name = prefix && binName(prefix);
    if (name) {
      const key = `ole:${bin.id}`;
      if (!images.has(key)) { const raw = pictureStream(name, bin.compressed); const bytes = raw && oleImage(raw); if (bytes) images.set(key, imageResource(bytes)); else if (!raw) warnings.add('An embedded object could not be read.'); }
      if (images.has(key)) {
        warnings.add('Embedded objects are imported as the pictures they display.');
        const run = { kind: 'image', image: images.get(key), ...size, alt: 'Embedded object', adjustments: {}, effects: {} };
        return Object.assign(run, imageDimensions(run));
      }
    }
    warnings.add('An embedded object or chart has no picture that can be shown; a placeholder names it.');
    return { kind: 'text', text: '[Embedded object]', width: size.width, height: size.height };
  }
  /** A cell or shape background picture as an image run the media pipeline can prepare. */
  function backgroundPicture(fill, width, height) {
    const run = image(fill.id, { width, height });
    if (run.kind !== 'image') return null;
    if (fill.mode !== undefined && fill.mode !== 5) warnings.add('Tiled and centered picture fills are stretched over their shape.');
    return Object.assign(run, { alt: 'Picture fill', effects: {}, adjustments: { brightness: fill.brightness || 0, contrast: fill.contrast || 0, effect: fill.effect || 'REAL_PIC' } });
  }
  const model = { sections: [], chars, paras, styles, warnings, images, listDefinitions, fontFallbacks };
  for (const name of ['\x05SummaryInformation', '\x05HwpSummaryInformation']) if (cfb.names.includes(name)) {
    try { model.metadata = { ...model.metadata, ...summaryMetadata(cfb.read(name)) }; }
    catch { warnings.add('Some document summary properties could not be decoded.'); }
  }
  let cellCount = 0, hiddenCommentId = 0, revisionId = 0, memoQueue = [];
  // Open tracked-change ranges by control id, so an end marker closes the range its control opened.
  const openRevisions = new Map();
  // Simple insert and delete are tracked changes; attach, transfer and the other proofreading marks are not.
  const REVISIONS = { '%%*e': 'ins', '%%*d': 'del' };
  function paragraph(node, section) {
    const r = new Reader(node.data); r.skip(8);
    const para = r.u16(), style = r.u8(), breaks = r.u8();
    const p = { kind: 'p', para, style, pageBreak: !!(breaks & 4), columnBreak: !!(breaks & 8), runs: [] };
    if (!section.nested) {
      p.sourceLinePositions = [];
      for (const n of node.children.filter((n) => n.tag === 69)) {
        const lr = new Reader(n.data);
        while (lr.remaining >= 36) { lr.skip(4); p.sourceLinePositions.push(lr.i32()); lr.skip(28); }
      }
    }
    const changes = node.children.filter((n) => n.tag === TAG.runs).flatMap((n) => {
      const rr = new Reader(n.data), values = []; while (rr.remaining) values.push({ pos: rr.u32(), char: rr.u32() }); return values;
    });
    check(changes.every((v, i) => !i || v.pos >= changes[i - 1].pos));
    p.char = changes[0]?.char ?? styles[style]?.char ?? 0;
    const controls = node.children.filter((n) => n.tag === TAG.ctrl), used = new Set(); let position = 0, shape = 0;
    const centeredBreaks = new Set();
    if (paras[para]?.align === 'center' && !controls.length) for (const n of node.children.filter((n) => n.tag === 69)) {
      const lr = new Reader(n.data);
      while (lr.remaining >= 36) { const start = lr.u32(); lr.skip(32); if (start > 0) centeredBreaks.add(start); }
    }
    // A memo's text follows the paragraph as a MEMO_LIST record (memo shape index, then its list
    // header and paragraphs); the %%me field in the text only marks the commented range. Memos
    // are taken in order as their fields are met, as hwplib reads them. A nested paragraph (a
    // footnote or a table cell met before the field) reads its own memos, then this one's return.
    const outerMemos = memoQueue;
    memoQueue = node.children.filter((n) => n.tag === 93).map((memo) => lists(memo.children, section).flatMap((l) => l.blocks));
    const controlQueues = new Map();
    for (const ctrl of controls) {
      const id = ctrlId(ctrl.data);
      if (!controlQueues.has(id)) controlQueues.set(id, { nodes: [], next: 0 });
      controlQueues.get(id).nodes.push(ctrl);
    }
    // Range tags of kind 2 are highlighter marks over [start, end) text positions, colored in their low 24 bits.
    const highlights = [];
    for (const n of node.children.filter((n) => n.tag === 70)) {
      const tr = new Reader(n.data);
      while (tr.remaining >= 12) { const start = tr.u32(), end = tr.u32(), tag = tr.u32(); if (tag >>> 24 === 2 && end > start) highlights.push({ start, end, color: rgb(tag & 0xffffff) || 'FFFF00' }); }
    }
    // Positions only grow through the paragraph, so the ranges are walked once with a cursor
    // instead of searched for every character.
    highlights.sort((a, b) => a.start - b.start);
    let nextHighlight = 0;
    const highlightAt = (index) => {
      while (nextHighlight < highlights.length && highlights[nextHighlight].end <= index) nextHighlight++;
      const h = highlights[nextHighlight];
      return h && h.start <= index ? h.color : undefined;
    };
    function add(text, highlight) {
      text = symbolText(text);
      const char = changes[shape]?.char ?? styles[style]?.char ?? 0, last = p.runs.at(-1);
      // The second half of a character outside the Basic Multilingual Plane stays with its first half,
      // whatever formatting change the file recorded between them.
      // Read by code unit, not by a regular expression over the run so far: that ran once per character over a growing run, a quadratic cost.
      const lastCode = last?.kind === 'text' ? last.text.charCodeAt(last.text.length - 1) : 0, firstCode = text.charCodeAt(0);
      const joinsSurrogate = lastCode >= 0xd800 && lastCode <= 0xdbff && firstCode >= 0xdc00 && firstCode <= 0xdfff;
      if (last?.kind === 'text' && ((last.char === char && last.highlight === highlight) || joinsSurrogate)) last.text += text;
      else p.runs.push(highlight ? { kind: 'text', text, char, highlight } : { kind: 'text', text, char });
    }
    for (const n of node.children.filter((n) => n.tag === TAG.text)) {
      const rr = new Reader(n.data);
      while (rr.remaining) {
        while (shape + 1 < changes.length && changes[shape + 1].pos <= position) shape++;
        const code = rr.u16(); position++;
        if (code >= 32) {
          // Keep source wrapping in centered headings/cells when substitute
          // fonts would otherwise leave an orphaned word on the second line.
          if (centeredBreaks.has(position - 1) && p.runs.length && !p.runs.at(-1).text?.endsWith('\n')) add('\n');
          add(String.fromCharCode(code), highlights.length ? highlightAt(position - 1) : undefined); continue;
        }
        if (code > 0 && code < 24 && code !== 10 && code !== 13) {
          const offset = rr.pos; rr.skip(14); position += 7;
          if (code === 9) { add('\t'); continue; }
          if (code === 4) {
            // The end marker names its control: a tracked-change field closes a revision, any other a field.
            const endId = ctrlId(n.data, offset), open = openRevisions.get(endId);
            if (REVISIONS[endId]) { if (open?.length) p.runs.push({ kind: 'revisionEnd', id: open.pop() }); continue; }
            p.runs.push({ kind: 'fieldEnd' }); continue;
          }
          const queue = controlQueues.get(ctrlId(n.data, offset));
          const ctrl = queue && queue.nodes[queue.next++];
          if (ctrl) { used.add(ctrl); p.runs.push(...control(ctrl, section, changes[shape]?.char ?? styles[style]?.char ?? 0)); }
        } else if (code === 10) add('\n');
        else if (code === 24) add('\u00ad');
        else if (code === 30) add('\u00a0');
        else if (code === 31) add('\u2007');
      }
    }
    for (const c of controls) if (!used.has(c)) p.runs.push(...control(c, section));
    showFieldGuides(p.runs);
    if (paras[para]?.lineType === 0 && p.runs.every((run) => ['text', 'fieldStart', 'fieldEnd', 'bookmark', 'field', 'ruby', 'pageHiding'].includes(run.kind))) {
      // HWP percentage spacing is based on its text height. The DOCX multiplier
      // uses font line metrics, which can be much taller for Korean fallbacks.
      // Keep the recorded baseline spacing for text-only paragraphs; inline
      // drawings still need automatic height so the object is not clipped.
      const heights = [];
      for (const n of node.children.filter((n) => n.tag === 69)) {
        const lr = new Reader(n.data);
        while (lr.remaining >= 36) { lr.skip(8); const height = lr.i32(); lr.skip(8); const gap = lr.i32(); lr.skip(12); if (height > 0 && height + gap > 0) heights.push(height + gap); }
      }
      // A reduce rather than a spread: a damaged record can list far more lines than a call takes arguments.
      if (heights.length) p.lineHeight = heights.reduce((a, b) => Math.max(a, b), 0);
    }
    memoQueue = outerMemos;
    return p;
  }
  function paragraphs(nodes, section) { const local = { ...section, headers: [], footers: [], nested: true }; return nodes.filter((n) => n.tag === TAG.p).map((n) => paragraph(n, local)); }
  function lists(nodes, section) {
    const result = [];
    for (let i = 0; i < nodes.length; i++) if (nodes[i].tag === TAG.list) {
      const node = nodes[i], children = [...node.children];
      while (nodes[i + 1]?.tag === TAG.p) children.push(nodes[++i]);
      result.push({ node, blocks: paragraphs(children, section) });
    }
    return result;
  }
  function control(node, section, paragraphChar) {
    const id = ctrlId(node.data), r = new Reader(node.data); r.skip(4);
    if (id.startsWith('%')) {
      r.skip(5); const command = r.string();
      if (id === '%hlk') { const target = hyperlinkTarget(command); if (target.href || target.anchor) return [{ kind: 'fieldStart', ...target }]; }
      if (REVISIONS[id]) {
        // Inserted and deleted ranges become tracked changes; Hanword stores no author in the field itself.
        const revision = `rev${++revisionId}`;
        if (!openRevisions.has(id)) openRevisions.set(id, []);
        openRevisions.get(id).push(revision);
        warnings.add('Tracked insertions and deletions are imported without their author and date.');
        return [{ kind: 'revisionStart', id: revision, revision: { type: REVISIONS[id], author: '', date: '' } }];
      }
      if (id.startsWith('%%*') || id === '%%mr' || id === '%spl' || id === '%sig') { warnings.add('Review marks other than insertions and deletions are imported as plain text.'); return [{ kind: 'fieldStart' }]; }
      if (id === '%%me') {
        // The paragraph's next memo list holds this field's text; the range the field marks becomes the comment range.
        const blocks = memoQueue.shift() || lists(node.children, section).flatMap((l) => l.blocks);
        if (!hasContent(blocks)) { warnings.add('A memo without readable content was left out.'); return [{ kind: 'fieldStart' }]; }
        warnings.add('Memos are imported as comments without their author and date.');
        return [{ kind: 'fieldStart', comment: { author: '', date: '', blocks } }];
      }
      // A click-here field shows its guide text while empty; other fields keep their displayed result.
      if (id === '%clk') return [{ kind: 'fieldStart', placeholder: clickHereGuide(command) }];
      if (id === '%fmu') { warnings.add('Table formulas are imported as their last calculated values.'); return [{ kind: 'fieldStart' }]; }
      if (['%dte', '%ddt', '%pat', '%usr', '%smr', '%mmg', '%xrf', '%toc', '%bmk'].includes(id)) { warnings.add('Date, path, cross-reference and similar fields are imported as their displayed text.'); return [{ kind: 'fieldStart' }]; }
      warnings.add('Some fields or internal hyperlinks were converted to plain text.'); return [{ kind: 'fieldStart' }];
    }
    if (id === 'secd') {
      if (r.remaining >= 20) {
        const flags = r.u32(); r.skip(6); section.defaultTab = legacyTabUnits(r.u32()); r.skip(2); section.pageStart = r.u16();
        section.hideFirstHeader = !!(flags & 1); section.hideFirstFooter = !!(flags & 2); section.hideFirstPageNum = !!(flags & 32);
        section.direction = (flags >>> 16) & 7 ? 'tbRl' : undefined;
      }
      const page = all(node.children, TAG.page)[0];
      if (page) { const pr = new Reader(page.data); const values = Array.from({ length: 10 }, () => pr.u32()); const [width, height, left, right, top, bottom, header, footer, gutter, attr] = values;
        section.page = { width: attr & 1 ? height : width, height: attr & 1 ? width : height, left, right, top: top + header, bottom: bottom + footer, header: top, footer: bottom, gutter }; }
      // Page border records follow for both/even/odd pages; the first one that names a border is drawn.
      for (const border of all(node.children, 75)) {
        if (border.data.length < 14) continue;
        const br = new Reader(border.data), attr = br.u32(), offset = { left: br.u16(), right: br.u16(), top: br.u16(), bottom: br.u16() }, fill = borders[br.u16()];
        if (fill && ['left', 'right', 'top', 'bottom'].some((side) => fill[side]?.style !== 'nil')) { section.pageBorder = { border: fill, offset, fromText: !(attr & 1) }; break; }
      }
      for (const [index, note] of all(node.children, 74).entries()) {
        if (index > 1) break;
        const nr = new Reader(note.data), flags = nr.u32(); nr.skip(6);
        section[index ? 'endNote' : 'footNote'] = { format: numberFormats[flags & 255] || 'decimal', start: nr.u16(), restart: ['continuous', 'eachSect', 'eachPage'][(flags >>> 10) & 3] || 'continuous' };
      }
      return [];
    }
    if (id === 'cold') {
      const a = r.u16(); section.columns = Math.max(1, (a >>> 2) & 255);
      if (section.nested && section.columns > 1) warnings.add('Columns inside tables or text boxes are simplified.');
      if (r.remaining >= 2) section.columnGap = r.u16();
      section.columnSizes = [];
      if (!(a & 4096) && r.remaining >= (2 * section.columns - 1) * 2 + 8) {
        section.columnSizes.push({ width: r.u16(), gap: 0 });
        for (let i = 1; i < section.columns; i++) { section.columnSizes[i - 1].gap = r.u16(); section.columnSizes.push({ width: r.u16(), gap: 0 }); }
      }
      if (r.remaining >= 8) { r.skip(2); section.columnSeparator = r.u8() !== 0; }
      if (section.columns > 1 && (a & 3) !== 0) warnings.add('Balanced or parallel columns may paginate differently.');
      return [];
    }
    if (id === 'nwno') { const kind = r.u32() & 15, start = r.u16(); if (kind === 0) section.pageStart = start; else warnings.add('Some counter restarts are not preserved.'); return []; }
    if (id === 'pgnp') {
      const flags = r.u32(); r.skip(2); const prefix = r.u16(), suffix = r.u16();
      section.pageNumber = { position: pagePositions[(flags >>> 8) & 15], format: numberFormats[flags & 255] || 'decimal', prefix: prefix ? String.fromCharCode(prefix) : '', suffix: suffix ? String.fromCharCode(suffix) : '' }; return [];
    }
    if (id === 'pgct') { section.breakType = { 1: 'evenPage', 2: 'oddPage' }[r.u32() & 3]; return []; }
    if (id === 'pghd') {
      const flags = r.u16();
      return [{ kind: 'pageHiding', hideFirstHeader: !!(flags & 1), hideFirstFooter: !!(flags & 2), hideFirstPageNum: !!(flags & 32) }];
    }
    if (id === 'bokm') {
      // Bookmark names are stored in a control-data ParameterSet (string item). Real files
      // write a 0x4000 word between the item id and its type; older ones do not.
      const data = node.children.find((n) => n.tag === 87);
      if (data) { const pr = new Reader(data.data); pr.skip(2); const count = pr.u16();
        for (let i = 0; i < count && pr.remaining >= 4; i++) { pr.skip(2); let type = pr.u16(); if (type === 0x4000 && pr.remaining >= 2) type = pr.u16(); if (type === 1) return [{ kind: 'bookmark', name: pr.string().replace(/\0+$/, '') }]; if (type <= 9) pr.skip(4); else break; }
      }
      warnings.add('A bookmark name could not be decoded.'); return [];
    }
    if (id === 'idxm') return []; // An index entry marker prints nothing.
    if (id === 'tcps') {
      // Overlapping letters: a character count and the letters drawn over one another; they read as consecutive text.
      const count = r.u16(); check(count <= 64);
      const text = Array.from({ length: count }, () => String.fromCharCode(r.u16())).join('');
      warnings.add('Overlapping characters are imported as text.');
      return [{ kind: 'text', text: symbolText(text), char: paragraphChar }];
    }
    if (id === 'tdut') { const text = r.string(), ruby = r.string(), below = r.remaining >= 4 && r.u32() === 1; return [{ kind: 'ruby', text, ruby, below }]; }
    if (id === 'head' || id === 'foot') {
      const apply = r.remaining >= 4 ? r.u32() & 3 : 0;
      section[id === 'head' ? 'headers' : 'footers'].push({ type: apply === 1 ? 'even' : apply === 2 ? 'odd' : 'default', blocks: lists(node.children, section).flatMap((l) => l.blocks) }); return [];
    }
    if (id === 'fn  ' || id === 'en  ') return [{ kind: 'note', end: id === 'en  ', blocks: lists(node.children, section).flatMap((l) => l.blocks) }];
    if (id === 'tcmt') {
      // A hidden comment is a non-printing note at a point in the text; a DOCX comment is the same kind of annotation.
      const blocks = lists(node.children, section).flatMap((l) => l.blocks);
      if (!hasContent(blocks)) return [];
      warnings.add('Hidden comments are imported as comments.');
      const fieldId = `hidden${++hiddenCommentId}`;
      return [{ kind: 'fieldStart', id: fieldId, comment: { author: '', date: '', blocks } }, { kind: 'fieldEnd', id: fieldId }];
    }
    if (id === 'tbl ') {
      const t = node.children.find((n) => n.tag === TAG.table); check(t, 'The Hanword document contains an incomplete table.');
      const tr = new Reader(t.data), attr = tr.u32(), rows = tr.u16(), cols = tr.u16();
      check(rows > 0 && cols > 0); check(rows * cols <= LIMITS.cells, TOO_MANY_CELLS); cellCount += rows * cols; check(cellCount <= LIMITS.documentCells, TOO_MANY_CELLS);
      const cellSpacing = tr.u16(), padding = margins(tr); tr.skip(2 * rows); const border = borders[tr.u16()];
      const table = { kind: 'table', rows, cols, padding, border, cellSpacing, cantSplit: (attr & 3) === 0, repeatHeader: !!(attr & 4), cells: [] };
      // A caption list header (22 bytes) names its side in bits 0-1 of the word after the list flags.
      const captionOf = (list, blocks) => { table.caption = blocks; table.captionSide = captionSide(list); if (/^(LEFT|RIGHT)$/.test(table.captionSide)) warnings.add('Captions beside an object are placed above or below it.'); };
      for (const { node: list, blocks } of lists(node.children, section)) {
        if (node.children.indexOf(list) < node.children.indexOf(t)) { captionOf(list, blocks); continue; }
        // Modern LIST_HEADER uses a UINT32 count; early 30/32-byte cells use UINT16.
        const lr = new Reader(list.data); lr.skip(list.data.length === 30 || list.data.length === 32 ? 2 : 4);
        const align = ['top', 'center', 'bottom'][(lr.u32() >>> 5) & 3] || 'top';
        if (lr.remaining < 24) { captionOf(list, blocks); continue; }
        const cell = { col: lr.u16(), row: lr.u16(), colSpan: lr.u16(), rowSpan: lr.u16(), width: lr.u32(), height: lr.u32(), padding: margins(lr), align, blocks };
        cell.border = lr.remaining >= 2 ? borders[lr.u16()] : border;
        if (cell.border?.pictureFill) cell.pictureFill = backgroundPicture({ id: cell.border.pictureFill }, cell.width, cell.height) || undefined;
        table.cells.push(cell);
      }
      return [table];
    }
    if (id === 'gso ' || id === '$pic' || id === 'eqed') {
      let size = { width: 14400, height: 14400 };
      if (r.remaining >= 20) {
        const flags = r.u32(), y = r.i32(), x = r.i32(); size = { width: r.u32(), height: r.u32() };
        if (!(flags & 1)) {
          const wrap = (flags >>> 21) & 7;
          size.layout = { h: ['page', 'margin', 'column', 'column'][(flags >>> 8) & 3], v: ['page', 'margin', 'paragraph'][(flags >>> 3) & 3] || 'paragraph', x, y, hAlign: ['left', 'center', 'right', 'inside', 'outside'][(flags >>> 10) & 7] || 'left', vAlign: ['top', 'center', 'bottom', 'inside', 'outside'][(flags >>> 5) & 7] || 'top', wrap: wrap < 3 ? 'square' : wrap === 3 ? 'topAndBottom' : 'none', behind: wrap === 4 };
          size.layout.wrapText = ['bothSides', 'left', 'right', 'largest'][(flags >>> 24) & 3];
          size.layout.overlap = !!(flags & 16384) && !(flags & 8192);
          if (wrap === 1 || wrap === 2) warnings.add('Contour wrapping is approximated with rectangular wrapping.');
        }
        if (r.remaining >= 12) { const zOrder = r.i32(), margin = margins(r); if (size.layout) Object.assign(size.layout, { margins: margin, zOrder }); }
        if (r.remaining >= 10) { r.skip(8); size.alt = r.string(); }
      }
      const components = [], owners = new Map(), paintOrder = new Map(), sourceRecord = new Map();
      const grouped = node.children.some((n) => n.tag === 76 && ctrlId(n.data) === '$con');
      function componentTree(nodes) {
        for (const n of nodes) {
          if (n.tag === TAG.p) continue;
          paintOrder.set(n, paintOrder.size);
          if (n.tag === 76 && n.data.length >= 48) {
            const sr = new Reader(n.data), shapeId = ctrlId(n.data); sr.skip(ctrlId(n.data, 4) === shapeId ? 8 : 4); sr.skip(12);
            // The angle is a signed 16-bit value: a shape turned 36 degrees counterclockwise stores -36, not 65500.
            const initialWidth = sr.u32(), initialHeight = sr.u32(), width = sr.u32(), height = sr.u32(), flags = sr.u32(), rotation = (sr.u16() << 16) >> 16; sr.skip(8);
            const count = sr.u16(), matrix = drawingMatrix(sr, count);
            const properties = { ...size, width: width || initialWidth || size.width, height: height || initialHeight || size.height, rotation, flipH: !!(flags & 1), flipV: !!(flags & 2) };
            if (grouped && shapeId !== '$con') {
              // A member scaled to nothing is left out of the group, not the whole document.
              try { Object.assign(properties, groupPlacement(matrix, initialWidth, initialHeight, warnings)); } catch (e) {
                if (!(e instanceof HwpError)) throw e;
                warnings.add('A drawing with an invalid geometry was left out.'); continue;
              }
              delete properties.layout;
            }
            components.push({ node: n, reader: sr, properties, initialWidth, initialHeight });
            for (const child of n.children) if (child.tag === TAG.picture) owners.set(child, properties);
          }
          componentTree(n.children);
        }
      }
      componentTree(node.children);
      const pics = shapeRecords(node.children, TAG.picture);
      const contents = pics.map((pic) => {
        const pr = new Reader(pic.data), color = rgb(pr.u32()), lineWidth = pr.i32(), lineFlags = pr.u32(); pr.skip(32);
        const clip = { left: pr.i32(), top: pr.i32(), right: pr.i32(), bottom: pr.i32() }; pr.skip(8);
        const adjustments = { brightness: pr.i8(), contrast: pr.i8(), effect: ['REAL_PIC', 'GRAY_SCALE', 'BLACK_WHITE'][pr.u8()] || 'REAL_PIC' };
        const run = image(pr.u16(), owners.get(pic) || size);
        run.line = { color, width: lineWidth, style: ['NONE', 'SOLID', 'DASH', 'DOT', 'DASH_DOT', 'DASH_DOT_DOT', 'LONG_DASH'][lineFlags & 63] || 'SOLID', transparency: pr.remaining ? pr.u8() / 255 : 0 };
        run.adjustments = adjustments;
        const tail = binaryPictureTail(pr, warnings); let dimensions = tail.dimensions;
        run.effects = tail.effects; if (tail.transparency !== undefined) adjustments.transparency = tail.transparency;
        const intrinsic = run.image?.dimensions;
        if (!(dimensions?.width > 0 && dimensions?.height > 0)) dimensions = intrinsic && { width: intrinsic.width * 75, height: intrinsic.height * 75 };
        run.crop = imageCrop(clip, dimensions, warnings);
        sourceRecord.set(run, pic);
        return run;
      });
      const ownedParagraphs = new Set();
      for (const { node: component, reader: sr, properties, initialWidth, initialHeight } of components) {
        const geometry = component.children.find((n) => [78, 79, 80, 81, 82, 83, 84, 90].includes(n.tag));
        const video = component.children.find((n) => n.tag === 98);
        if (video && !component.children.some((n) => n.tag === TAG.picture)) {
          // A video keeps its poster picture; the clip itself has no DOCX form.
          let run;
          try {
            const vr = new Reader(video.data), type = vr.u32(); if (type === 0) vr.skip(2); else vr.string();
            run = image(vr.u16(), { width: properties.width, height: properties.height }); run.alt = 'Video';
            if (run.kind === 'image') { Object.assign(run, properties, { alt: 'Video' }); warnings.add('Videos are imported as their poster pictures.'); }
          } catch { run = null; }
          if (run?.kind !== 'image') { run = { kind: 'text', text: '[Video]', ...properties }; warnings.add('A video has no poster picture; a placeholder names it.'); }
          contents.push(run); sourceRecord.set(run, video); continue;
        }
        if (!geometry) continue;
        const gr = new Reader(geometry.data);
        if (geometry.tag === 84) {
          let run;
          try { gr.skip(12); run = oleRun(gr.u16(), { width: properties.width, height: properties.height }); Object.assign(run, properties); }
          catch { run = { kind: 'text', text: '[Embedded object]', ...properties }; warnings.add('An embedded object or chart has no picture that can be shown; a placeholder names it.'); }
          contents.push(run); sourceRecord.set(run, geometry); continue;
        }
        const fill = sr.remaining >= 17 ? (() => { const color = rgb(sr.u32()), width = sr.i32(), flags = sr.u32(); sr.skip(1); return { line: binaryLine(color, width, flags), ...fillInfo(sr) }; })() : { line: { style: 'NONE', width: 0 } };
        if (geometry.tag === 90) {
          // Text art keeps its words, font and color in a plain text box; the warped outline is not reproduced.
          const lines = textArtLines(gr.string()), font = {}; gr.skip(32);
          try { font.name = gr.string(); font.style = gr.string(); gr.string(); gr.skip(4); font.lineSpacing = gr.u32(); gr.skip(4); font.align = ['left', 'center', 'right', 'both', 'distribute'][gr.u32()]; } catch { /* older records end after the outline points */ }
          const spacing = Math.max(50, font.lineSpacing || 120);
          const props = { font: font.name, eastAsia: font.name, bold: /진하게|bold/i.test(font.style || ''), italic: /기울임|italic/i.test(font.style || ''), color: fill.fill || '000000', relativeSize: 100, scale: 100, spacing: 0, position: 0 };
          warnings.add('Text art is imported as text in a box; its curved outline is not reproduced.');
          const art = { kind: 'shape', shape: 'rect', ...properties, fill: null, line: { style: 'NONE', width: 0 }, textAlign: 'center', padding: { left: 0, right: 0, top: 0, bottom: 0 },
            blocks: lines.map((line) => {
              const size = textArtSize(line, lines.length, properties.width, properties.height, spacing);
              return { kind: 'p', props: { align: font.align || 'center', line: Math.round(size * spacing / 100), lineType: 1 }, runs: [{ kind: 'text', text: symbolText(line), props: { ...props, size } }] };
            }) };
          contents.push(art); sourceRecord.set(art, geometry); continue;
        }
        const shape = { kind: 'shape', shape: { 78: 'line', 79: 'rect', 80: 'ellipse', 81: 'custom', 82: 'polygon', 83: 'custom' }[geometry.tag], ...properties, line: fill.line, blocks: [], fill: fill.fill, coordWidth: initialWidth, coordHeight: initialHeight };
        if (fill.gradient) shape.gradient = fill.gradient;
        if (fill.hatch) shape.hatch = fill.hatch;
        if (fill.pictureFill) shape.pictureFill = backgroundPicture(fill.pictureFill, properties.width, properties.height) || undefined;
        if (geometry.tag === 79) { const ratio = gr.u8(); if (ratio) { shape.shape = 'roundRect'; shape.roundness = ratio; } }
        if (geometry.tag === 78) { const x1 = gr.i32(), y1 = gr.i32(), x2 = gr.i32(), y2 = gr.i32(); shape.flipH = (x2 < x1) !== shape.flipH; shape.flipV = (y2 < y1) !== shape.flipV; }
        if (geometry.tag === 80 && gr.remaining >= 4 && gr.u32() & 2) warnings.add('Elliptical arcs are drawn as whole ellipses.');
        if (geometry.tag === 82) shape.points = polygonPoints(gr);
        try {
        if (geometry.tag === 81) {
          // Arc type (a byte in current files, a DWORD in some), then the ellipse center and two semi-axis endpoints.
          const type = gr.remaining % 4 === 1 ? gr.u8() : gr.remaining >= 28 ? gr.u32() : 0;
          const point = () => ({ x: gr.i32(), y: gr.i32() }), center = point(), ax1 = point(), ax2 = point();
          shape.path = arcPath(['NORMAL', 'PIE', 'CHORD'][type] || 'NORMAL', center, ax1, ax2);
          if (type !== 1 && type !== 2) { shape.fill = null; delete shape.gradient; delete shape.pictureFill; }
        }
        if (geometry.tag === 83) {
          // A point count (WORD in older files, DWORD in current ones), the points, one segment type per span, then a DWORD tail.
          const length = gr.remaining, fits = (header, count) => count > 1 && [0, 4].some((tail) => header + count * 8 + (count - 1) + tail === length);
          let count = gr.u16(); if (!fits(2, count)) { gr.pos = 0; count = gr.u32(); check(fits(4, count), 'A Hanword curve has an invalid geometry.'); }
          const points = Array.from({ length: count }, () => ({ x: gr.i32(), y: gr.i32() })), types = Array.from({ length: count - 1 }, () => gr.u8() === 0 ? 'LINE' : 'CURVE');
          const { path, closed } = curvePath(points, types); shape.path = path;
          if (!closed) { shape.fill = null; delete shape.gradient; delete shape.pictureFill; }
          warnings.add('Curves are smoothed through their points; Hanword’s exact curvature can differ.');
        }
        } catch (e) {
          // An arc of no radius or a curve without points is left out, not the whole document.
          if (!(e instanceof HwpError)) throw e;
          warnings.add('A drawing with an invalid geometry was left out.'); continue;
        }
        const text = shapeRecords(component.children, TAG.p); for (const p of text) ownedParagraphs.add(p);
        const textList = component.children.find((n) => n.tag === TAG.list);
        if (textList?.data.length >= 20) {
          const lr = new Reader(textList.data); lr.skip(4);
          shape.textAlign = ['top', 'center', 'bottom'][(lr.u32() >>> 5) & 3] || 'top';
          shape.padding = margins(lr);
        }
        shape.blocks = paragraphs(text, section); contents.push(shape); sourceRecord.set(shape, geometry);
      }
      contents.sort((a, b) => paintOrder.get(sourceRecord.get(a)) - paintOrder.get(sourceRecord.get(b)));
      const eq = shapeRecords(node.children, TAG.equation)[0];
      if (eq) { const er = new Reader(eq.data); er.skip(4); const text = er.string(), size = er.remaining >= 4 ? er.u32() : 1000, color = er.remaining >= 4 ? rgb(er.u32()) : null; contents.push({ kind: 'equation', text, size, color }); }
      // A LIST_HEADER directly under the control, with its paragraphs beside it,
      // is the object's caption; text nested in a component is its text box.
      const captionList = node.children.find((n) => n.tag === TAG.list);
      const captionParagraphs = new Set(captionList ? node.children.filter((n) => n.tag === TAG.p) : []);
      const unowned = shapeRecords(node.children, TAG.p).filter((p) => !ownedParagraphs.has(p));
      const caption = paragraphs(unowned.filter((p) => captionParagraphs.has(p)), section);
      const text = paragraphs(unowned.filter((p) => !captionParagraphs.has(p)), section);
      if (grouped && contents.length && contents.every((item) => ['shape', 'image'].includes(item.kind) || item.kind === 'text' && sourceRecord.has(item))) {
        // Leaves are in source paint order and use the root group's coordinate
        // space. Keep one inline/anchored object, including text and pictures.
        const children = contents.splice(0);
        contents.push({ kind: 'group', ...size, children });
      }
      if (text.length) { contents.push({ kind: 'blocks', blocks: text }); warnings.add('Text boxes are placed in the document flow.'); }
      if (caption.length) {
        const side = captionSide(captionList);
        if (/^(LEFT|RIGHT)$/.test(side)) warnings.add('Captions beside an object are placed above or below it.');
        if (side === 'TOP' || side === 'LEFT') contents.unshift({ kind: 'blocks', blocks: caption }); else contents.push({ kind: 'blocks', blocks: caption });
      }
      if (!contents.length) { contents.push({ kind: 'text', text: '[Unsupported drawing object]' }); warnings.add('Some drawing, chart, or embedded objects could not be converted.'); }
      return contents;
    }
    if (id === 'atno') {
      const flags = r.u32(), type = flags & 15, number = r.u16();
      if (type === 0 || type === 6) return [{ kind: 'field', instruction: type === 0 ? 'PAGE' : 'NUMPAGES', text: String(number) }];
      if (type === 1 || type === 2) return []; // Note labels are generated below.
      // Bits 4-11 hold the number format; the user symbol, prefix and suffix characters follow the number.
      r.skip(2); const prefix = r.u16(), suffix = r.u16();
      const label = (prefix ? String.fromCharCode(prefix) : '') + formatNumber(numberFormats[(flags >>> 4) & 255] || 'decimal', number) + (suffix ? String.fromCharCode(suffix) : '');
      const sequence = { 3: 'Figure', 4: 'Table', 5: 'Equation' }[type];
      if (!sequence) { warnings.add('Some counters are imported as text.'); return [{ kind: 'text', text: symbolText(label) }]; }
      return [{ kind: 'field', instruction: `SEQ ${sequence} \\* ARABIC`, text: symbolText(label) }];
    }
    warnings.add('Some fields, bookmarks, or layout controls are not preserved.');
    return [];
  }
  const names = cfb.names.filter((n) => /^BodyText\/Section\d+$/.test(n)).sort((a, b) => Number(a.match(/\d+$/)[0]) - Number(b.match(/\d+$/)[0]));
  check(names.length > 0 && names.length <= 1000, 'This Hanword document has no readable body sections.');
  const properties = definitions(TAG.properties)[0];
  if (properties) check(properties.u16() === names.length, 'The Hanword document has missing body sections.');
  for (const name of names) {
    let section = { blocks: [], headers: [], footers: [], counters: {} };
    model.sections.push(section);
    for (const p of records(stream(name), countRecord).filter((n) => n.tag === TAG.p)) {
      if (section.blocks.length && p.children.some((n) => n.tag === TAG.ctrl && ctrlId(n.data) === 'cold')) {
        section = { ...section, blocks: [], headers: [], footers: [], pageStart: 0, hideFirstHeader: false, hideFirstFooter: false, hideFirstPageNum: false, breakType: 'continuous' };
        model.sections.push(section); check(model.sections.length <= 1000);
      }
      section.blocks.push(paragraph(p, section));
    }
    check(section.blocks.length > 0);
  }
  if (flags & 8) warnings.add('Document scripts are not imported.');
  resolvePageHiding(model);
  return model;
}

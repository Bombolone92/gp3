import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFStream,
  StandardFontEmbedder,
  StandardFonts,
} from 'pdf-lib';
import { decode } from './text-edit.js';

/**
 * Glyph codes and advances for every font kind a content stream can select, read from the font
 * dictionary itself so redaction and sanitizing can place each glyph without PDF.js. Simple
 * fonts use /Widths (or the standard 14 metrics when a writer omitted them), composite fonts
 * their CMap and /W array, and Type 3 fonts their own FontMatrix. Where a predefined CMap leaves
 * the code-to-CID mapping unknown, widths are estimates and every glyph says so.
 */

const get = (dict, key) => dict?.lookup(PDFName.of(key));
const numbers = (value) =>
  value instanceof PDFArray ? value.asArray().map((_, i) => value.lookup(i)?.asNumber?.()) : null;

// StandardEncoding is the built-in encoding of the standard Latin faces (PDF 32000, D.2).
const ascii = (quote, grave) =>
  [
    'space exclam quotedbl numbersign dollar percent ampersand',
    quote,
    'parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six',
    'seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O',
    'P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore',
    grave,
    'a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde',
  ]
    .join(' ')
    .split(' ');
const STANDARD_HIGH = {
  161: 'exclamdown cent sterling fraction yen florin section currency quotesingle quotedblleft guillemotleft guilsinglleft guilsinglright fi fl',
  177: 'endash dagger daggerdbl periodcentered',
  182: 'paragraph bullet quotesinglbase quotedblbase quotedblright guillemotright ellipsis perthousand',
  191: 'questiondown',
  193: 'grave acute circumflex tilde macron breve dotaccent dieresis',
  202: 'ring cedilla',
  205: 'hungarumlaut ogonek caron emdash',
  225: 'AE',
  227: 'ordfeminine',
  232: 'Lslash Oslash OE ordmasculine',
  241: 'ae',
  245: 'dotlessi',
  248: 'lslash oslash oe germandbls',
};
function table(names, high = {}) {
  const map = new Map(names.map((n, i) => [32 + i, n]));
  for (const [start, list] of Object.entries(high))
    list.split(' ').forEach((n, i) => map.set(Number(start) + i, n));
  return map;
}
const fromEncoding = (encoding) =>
  new Map(Object.values(encoding.unicodeMappings).map(([code, name]) => [code, name]));
let encodings;
function namedEncodings() {
  encodings ??= {
    StandardEncoding: table(ascii('quoteright', 'quoteleft'), STANDARD_HIGH),
    WinAnsiEncoding: fromEncoding(StandardFontEmbedder.for(StandardFonts.Helvetica).encoding),
    // Only the ASCII half of MacRoman is tabulated; other codes fall back to an estimate.
    MacRomanEncoding: table(ascii('quotesingle', 'grave')),
    Symbol: fromEncoding(StandardFontEmbedder.for(StandardFonts.Symbol).encoding),
    ZapfDingbats: fromEncoding(StandardFontEmbedder.for(StandardFonts.ZapfDingbats).encoding),
  };
  return encodings;
}

// Glyph names to text, for simple fonts without a ToUnicode map.
let glyphText;
function nameToText(name) {
  if (!glyphText) {
    glyphText = new Map();
    for (const encoding of [namedEncodings().WinAnsiEncoding, namedEncodings().StandardEncoding])
      for (const [code, glyph] of encoding)
        if (code < 128 && !glyphText.has(glyph)) glyphText.set(glyph, String.fromCharCode(code));
    // WinAnsi also maps the soft hyphen (U+00AD) to the glyph "hyphen"; an ASCII reading
    // found above wins, so "hyphen" reads as "-" and patterns such as ID numbers match.
    for (const [code, [, glyph]] of Object.entries(
      StandardFontEmbedder.for(StandardFonts.Helvetica).encoding.unicodeMappings,
    ))
      if (!glyphText.has(glyph)) glyphText.set(glyph, String.fromCodePoint(Number(code)));
    const extras = {
      fi: 'fi',
      fl: 'fl',
      ff: 'ff',
      ffi: 'ffi',
      ffl: 'ffl',
      dotlessi: 'ı',
      Lslash: 'Ł',
      lslash: 'ł',
      fraction: '⁄',
      minus: '−',
      nbspace: '\u00a0',
    };
    for (const [glyph, text] of Object.entries(extras)) glyphText.set(glyph, text);
  }
  if (glyphText.has(name)) return glyphText.get(name);
  const uni = name.match(/^uni((?:[0-9A-F]{4})+)$/);
  if (uni) return String.fromCharCode(...uni[1].match(/.{4}/g).map((h) => parseInt(h, 16)));
  const u = name.match(/^u([0-9A-F]{4,6})$/);
  if (u) return String.fromCodePoint(parseInt(u[1], 16));
  if (/^[A-Za-z]$/.test(name)) return name;
  return '';
}

/** Code-to-text pairs from a ToUnicode CMap (bfchar and bfrange). */
function parseToUnicode(source) {
  const map = new Map();
  const bytes = (hex) =>
    hex.replace(/\s/g, '').replace(/../g, (h) => String.fromCharCode(parseInt(h, 16)));
  const text = (hex) => {
    const clean = hex.replace(/\s/g, '');
    let out = '';
    for (let i = 0; i + 3 < clean.length; i += 4)
      out += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16));
    if (clean.length % 4) out += String.fromCharCode(parseInt(clean.slice(-2), 16));
    return out;
  };
  const blocks = (name) =>
    [...source.matchAll(new RegExp(`begin${name}([\\s\\S]*?)end${name}`, 'g'))].map((m) => m[1]);
  for (const body of blocks('bfchar'))
    for (const m of body.matchAll(/<([\da-f\s]+)>\s*<([\da-f\s]*)>/gi))
      map.set(bytes(m[1]), text(m[2]));
  for (const body of blocks('bfrange'))
    for (const m of body.matchAll(
      /<([\da-f\s]+)>\s*<([\da-f\s]+)>\s*(<[\da-f\s]*>|\[[^\]]*\])/gi,
    )) {
      const low = parseInt(m[1].replace(/\s/g, ''), 16),
        high = parseInt(m[2].replace(/\s/g, ''), 16);
      const width = m[1].replace(/\s/g, '').length / 2;
      if (!(high >= low) || high - low > 65535) continue;
      const list = m[3].startsWith('[')
        ? [...m[3].matchAll(/<([\da-f\s]*)>/gi)].map((x) => text(x[1]))
        : null;
      const first = list ? null : text(m[3].slice(1, -1));
      if (!list && !first) continue;
      for (let code = low; code <= high; code++) {
        const key = bytes(code.toString(16).padStart(width * 2, '0'));
        if (list) map.set(key, list[code - low] ?? '');
        else
          map.set(
            key,
            first.slice(0, -1) +
              String.fromCharCode(first.charCodeAt(first.length - 1) + code - low),
          );
      }
    }
  return map;
}
function toUnicodeOf(font) {
  const stream = get(font, 'ToUnicode');
  if (!(stream instanceof PDFStream)) return null;
  try {
    return parseToUnicode(decode(stream));
  } catch {
    return null;
  }
}

/** The standard 14 face a font name means, including the common platform aliases. */
export function standardFace(baseFont) {
  const name = baseFont.replace(/^[A-Z]{6}\+/, '');
  if (Object.values(StandardFonts).includes(name)) return name;
  const match = name
    .replace(/[,_]/g, '-')
    .replace(/\s/g, '')
    .match(
      /^(Arial|Helvetica|TimesNewRoman|Times|CourierNew|Courier)(?:PS)?(?:MT)?(?:-(Roman|Regular|Bold|Italic|Oblique|BoldItalic|BoldOblique)(?:MT)?)?$/,
    );
  if (!match) return null;
  const family = match[1].startsWith('Times')
    ? 'Times'
    : match[1].startsWith('Courier')
      ? 'Courier'
      : 'Helvetica';
  const style = match[2] || '';
  const bold = style.includes('Bold'),
    slanted = /Italic|Oblique/.test(style);
  if (family === 'Times')
    return bold && slanted
      ? 'Times-BoldItalic'
      : bold
        ? 'Times-Bold'
        : slanted
          ? 'Times-Italic'
          : 'Times-Roman';
  return family + (bold || slanted ? '-' : '') + (bold ? 'Bold' : '') + (slanted ? 'Oblique' : '');
}

/** Code-to-glyph-name map for a simple font: its base encoding plus /Differences. */
function simpleEncoding(font, face) {
  const all = namedEncodings();
  const builtIn =
    face === 'Symbol' ? all.Symbol : face === 'ZapfDingbats' ? all.ZapfDingbats : null;
  const value = get(font, 'Encoding');
  let base = builtIn || all.StandardEncoding;
  let differences = null;
  if (value instanceof PDFName) base = all[value.decodeText()] || base;
  else if (value instanceof PDFDict) {
    const name = get(value, 'BaseEncoding');
    if (name instanceof PDFName) base = all[name.decodeText()] || base;
    differences = get(value, 'Differences');
  }
  const map = new Map(base);
  if (differences instanceof PDFArray) {
    let code = 0;
    for (let i = 0; i < differences.size(); i++) {
      const item = differences.lookup(i);
      if (item?.asNumber) code = item.asNumber();
      else if (item instanceof PDFName) map.set(code++, item.decodeText());
    }
  }
  return map;
}

/** Codespace ranges, CID mappings, and writing mode from an embedded CMap stream. */
function parseCMap(source) {
  const hexValue = (h) => parseInt(h, 16);
  const ranges = [],
    cids = [];
  const block = (name) =>
    [...source.matchAll(new RegExp(`begin${name}([\\s\\S]*?)end${name}`, 'g'))].map((m) => m[1]);
  for (const body of block('codespacerange'))
    for (const m of body.matchAll(/<([\da-f]+)>\s*<([\da-f]+)>/gi))
      ranges.push({ bytes: m[1].length / 2, low: hexValue(m[1]), high: hexValue(m[2]) });
  for (const body of block('cidrange'))
    for (const m of body.matchAll(/<([\da-f]+)>\s*<([\da-f]+)>\s*(\d+)/gi))
      cids.push({ low: hexValue(m[1]), high: hexValue(m[2]), cid: Number(m[3]) });
  for (const body of block('cidchar'))
    for (const m of body.matchAll(/<([\da-f]+)>\s*(\d+)/gi))
      cids.push({ low: hexValue(m[1]), high: hexValue(m[1]), cid: Number(m[2]) });
  const usecmap = source.match(/\/([^\s/]+)\s+usecmap/);
  return {
    ranges,
    cids,
    usecmap: usecmap?.[1],
    vertical: /\/WMode\s+1/.test(source),
  };
}

/** Widths keyed by CID from a /W (or /W2 with three numbers per CID) array. */
function cidWidths(array, stride) {
  const map = new Map();
  if (!(array instanceof PDFArray)) return map;
  const items = array.asArray().map((_, i) => array.lookup(i));
  for (let i = 0; i < items.length;) {
    const first = items[i]?.asNumber?.();
    if (!Number.isInteger(first)) break;
    if (items[i + 1] instanceof PDFArray) {
      const list = numbers(items[i + 1]);
      for (let k = 0; k + stride <= list.length; k += stride)
        map.set(first + k / stride, list.slice(k, k + stride));
      i += 2;
    } else {
      const last = items[i + 1]?.asNumber?.();
      const values = items.slice(i + 2, i + 2 + stride).map((n) => n?.asNumber?.());
      if (!Number.isInteger(last) || values.some((n) => !Number.isFinite(n))) break;
      // Bound pathological ranges; widths past the cap fall back to the default.
      for (let cid = first; cid <= Math.min(last, first + 65535); cid++) map.set(cid, values);
      i += 2 + stride;
    }
  }
  return map;
}

function descriptorExtent(descriptor, fallback = [0.8, -0.2]) {
  let ascent = get(descriptor, 'Ascent')?.asNumber?.() / 1000;
  let descent = get(descriptor, 'Descent')?.asNumber?.() / 1000;
  const bbox = numbers(get(descriptor, 'FontBBox'));
  if (!(ascent > 0) && bbox?.[3] > 0) ascent = bbox[3] / 1000;
  if (!(descent < 0) && bbox?.[1] < 0) descent = bbox[1] / 1000;
  // Many fonts declare line-spacing values here (ascent 1.05, descent -0.35). Clamp to the band
  // glyph ink actually occupies, so boxes do not reach into the neighbouring lines.
  return [
    Number.isFinite(ascent) && ascent > 0 ? Math.min(Math.max(ascent, 0.5), 0.9) : fallback[0],
    Number.isFinite(descent) && descent < 0 ? Math.max(descent, -0.25) : fallback[1],
  ];
}

const cache = new WeakMap();
/**
 * Metrics for a font dictionary. `split(bytes)` cuts a shown string into glyph codes; each code
 * has `width` (horizontal advance per unit of font size), `vertical` displacement data for
 * vertical fonts, `space` (single-byte code 32, which word spacing widens), and `estimated`.
 */
export function fontMetrics(font) {
  if (!(font instanceof PDFDict)) return unknownFont();
  let metrics = cache.get(font);
  if (!metrics) {
    try {
      metrics = readFont(font);
    } catch {
      metrics = unknownFont();
    }
    cache.set(font, metrics);
  }
  return metrics;
}

function unknownFont() {
  return {
    kind: 'unknown',
    vertical: false,
    ascent: 0.8,
    descent: -0.2,
    split: (bytes) => [...bytes],
    glyph: (code) => ({ code, width: 0.6, space: code === ' ', estimated: true }),
    unicode: () => '',
  };
}

function readFont(font) {
  const subtype = get(font, 'Subtype')?.decodeText?.();
  if (subtype === 'Type0') return compositeFont(font);
  if (subtype === 'Type3') return type3Font(font);
  return simpleFont(font);
}

function simpleFont(font) {
  const widths = numbers(get(font, 'Widths'));
  const first = get(font, 'FirstChar')?.asNumber?.() ?? 0;
  const descriptor = get(font, 'FontDescriptor');
  const missing = get(descriptor, 'MissingWidth')?.asNumber?.();
  const face = standardFace(get(font, 'BaseFont')?.decodeText?.() || '');
  const afm = face ? StandardFontEmbedder.for(face).font : null;
  const names = simpleEncoding(font, face);
  const toUnicode = toUnicodeOf(font);
  const hasEncoding = font.has(PDFName.of('Encoding'));
  const [ascent, descent] = descriptor
    ? descriptorExtent(descriptor)
    : afm
      ? [(afm.Ascender || afm.FontBBox[3]) / 1000, (afm.Descender || afm.FontBBox[1]) / 1000]
      : [0.8, -0.2];
  const glyphs = new Map();
  return {
    kind: 'simple',
    vertical: false,
    ascent,
    descent,
    split: (bytes) => [...bytes],
    glyph(code) {
      let glyph = glyphs.get(code);
      if (glyph) return glyph;
      const byte = code.charCodeAt(0);
      let width = widths?.[byte - first],
        estimated = false;
      if (!Number.isFinite(width)) {
        // PDF.js measures a standard face without /Widths from its AFM metrics.
        const name = names.get(byte);
        const standard = name && afm?.getWidthOfGlyph(name);
        if (Number.isFinite(standard)) width = standard;
        else if (widths && Number.isFinite(missing)) width = missing;
        else if (widths) width = 0;
        else {
          width = Number.isFinite(missing) && missing > 0 ? missing : 500;
          estimated = true;
        }
      }
      glyph = { code, width: width / 1000, space: byte === 32, estimated };
      glyphs.set(code, glyph);
      return glyph;
    },
    unicode(code) {
      if (toUnicode?.has(code)) return toUnicode.get(code);
      const name = (hasEncoding || face) && names.get(code.charCodeAt(0));
      // Symbolic fonts without an encoding usually draw their codes as Latin-1 text.
      return name ? nameToText(name) : code;
    },
  };
}

function type3Font(font) {
  const widths = numbers(get(font, 'Widths')) || [];
  const first = get(font, 'FirstChar')?.asNumber?.() ?? 0;
  const fontMatrix = numbers(get(font, 'FontMatrix')) || [0.001, 0, 0, 0.001, 0, 0];
  const bbox = numbers(get(font, 'FontBBox'));
  // Type 3 glyph space maps to text space through the font's own matrix.
  const corners = bbox?.every(Number.isFinite)
    ? [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[1]],
        [bbox[0], bbox[3]],
        [bbox[2], bbox[3]],
      ].map(([x, y]) => fontMatrix[1] * x + fontMatrix[3] * y + fontMatrix[5])
    : [];
  const top = Math.max(...corners),
    bottom = Math.min(...corners);
  const toUnicode = toUnicodeOf(font);
  const names = simpleEncoding(font, null);
  const usable = corners.length && top > bottom && top - bottom < 4;
  return {
    kind: 'type3',
    vertical: false,
    ascent: usable ? top : 0.8,
    descent: usable ? Math.min(bottom, 0) : -0.2,
    split: (bytes) => [...bytes],
    glyph(code) {
      const w = widths[code.charCodeAt(0) - first];
      return {
        code,
        width: (Number.isFinite(w) ? w : 0) * fontMatrix[0],
        space: code === ' ',
        estimated: !Number.isFinite(w),
      };
    },
    unicode(code) {
      if (toUnicode?.has(code)) return toUnicode.get(code);
      const name = names.get(code.charCodeAt(0));
      return name ? nameToText(name) : '';
    },
  };
}

function compositeFont(font) {
  const descendants = get(font, 'DescendantFonts');
  const cidFont = descendants instanceof PDFArray ? descendants.lookup(0) : null;
  if (!(cidFont instanceof PDFDict)) throw new Error('Missing descendant font');
  const encoding = get(font, 'Encoding');
  let ranges = [{ bytes: 2, low: 0, high: 0xffff }],
    toCid = (code) => code,
    vertical = false,
    estimated = false;
  if (encoding instanceof PDFName) {
    const name = encoding.decodeText();
    vertical = /-V$/.test(name);
    // Only the Identity CMaps map codes to CIDs without data the file does not carry.
    if (!/^Identity-[HV]$/.test(name)) estimated = true;
  } else if (encoding instanceof PDFStream) {
    const cmap = parseCMap(decode(encoding));
    vertical = cmap.vertical || get(encoding.dict, 'WMode')?.asNumber?.() === 1;
    const parent = get(encoding.dict, 'UseCMap')?.decodeText?.() || cmap.usecmap;
    if (cmap.ranges.length) ranges = cmap.ranges;
    if (parent && !/^Identity-[HV]$/.test(parent)) estimated = true;
    else if (cmap.cids.length || !parent)
      toCid = (code) => {
        for (const r of cmap.cids) if (code >= r.low && code <= r.high) return r.cid + code - r.low;
        return parent ? code : 0;
      };
  } else estimated = true;
  ranges.sort((a, b) => a.bytes - b.bytes);
  const defaultWidth = get(cidFont, 'DW')?.asNumber?.() ?? 1000;
  const widths = cidWidths(get(cidFont, 'W'), 1);
  const dw2 = numbers(get(cidFont, 'DW2')) || [880, -1000];
  const verticals = vertical ? cidWidths(get(cidFont, 'W2'), 3) : null;
  const [ascent, descent] = descriptorExtent(get(cidFont, 'FontDescriptor'), [0.88, -0.12]);
  const toUnicode = toUnicodeOf(font);
  const glyphs = new Map();
  return {
    kind: 'composite',
    vertical,
    ascent,
    descent,
    split(bytes) {
      const codes = [];
      for (let i = 0; i < bytes.length;) {
        let taken = 0;
        // Shortest codespace match first, as the CMap rules require.
        for (const range of ranges) {
          if (i + range.bytes > bytes.length) continue;
          let value = 0;
          for (let k = 0; k < range.bytes; k++) value = value * 256 + bytes.charCodeAt(i + k);
          if (value >= range.low && value <= range.high) {
            taken = range.bytes;
            break;
          }
        }
        if (!taken) taken = Math.min(ranges[0].bytes, bytes.length - i) || 1;
        codes.push(bytes.slice(i, i + taken));
        i += taken;
      }
      return codes;
    },
    glyph(code) {
      let glyph = glyphs.get(code);
      if (glyph) return glyph;
      let value = 0;
      for (let k = 0; k < code.length; k++) value = value * 256 + code.charCodeAt(k);
      const cid = toCid(value);
      const width = (widths.get(cid)?.[0] ?? defaultWidth) / 1000;
      const v = verticals?.get(cid);
      glyph = {
        code,
        width,
        // Vertical displacement and the position vector from the vertical origin (PDF 9.7.4.3).
        vertical: vertical
          ? {
              advance: (v ? v[0] : dw2[1]) / 1000,
              vx: (v ? v[1] : (width * 1000) / 2) / 1000,
              vy: (v ? v[2] : dw2[0]) / 1000,
            }
          : null,
        space: code.length === 1 && code === ' ',
        estimated,
      };
      glyphs.set(code, glyph);
      return glyph;
    },
    unicode: (code) => toUnicode?.get(code) ?? '',
  };
}

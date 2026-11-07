/**
 * Embedding substitutes for the standard 14 fonts, which PDF/A forbids leaving unembedded
 * (ISO 19005-1 6.3.4, ISO 19005-2/3 6.2.11.4.1). The substitutes are the fonts PDF.js itself
 * draws the standard 14 with: Liberation Sans 1.07.4 (GPL v2 with the font exception, which
 * allows embedding in documents) for Helvetica and Arial, and PDFium's Foxit faces (BSD) for
 * Times, Courier, Symbol, and ZapfDingbats. Both are metric-compatible with the fonts they
 * replace, so text keeps its positions, but the glyph shapes are the substitute's.
 *
 * Only simple fonts whose encoding is a known name table are replaced; each font dictionary is
 * rewritten in place so every page that shares it is updated together.
 */
import { PDFArray, PDFDict, PDFName, PDFNumber } from 'pdf-lib';
import {
  CFF_STANDARD_STRINGS,
  STANDARD_ENCODING,
  SYMBOL_ENCODING,
  WIN_ANSI_ENCODING,
  ZAPF_DINGBATS_ENCODING,
} from './pdfa-font-tables.js';

const name = PDFName.of;
const get = (dict, key) => dict?.lookup(name(key));

const FAMILIES = {
  sans: {
    regular: 'LiberationSans-Regular.ttf',
    bold: 'LiberationSans-Bold.ttf',
    italic: 'LiberationSans-Italic.ttf',
    boldItalic: 'LiberationSans-BoldItalic.ttf',
  },
  serif: {
    regular: 'FoxitSerif.pfb',
    bold: 'FoxitSerifBold.pfb',
    italic: 'FoxitSerifItalic.pfb',
    boldItalic: 'FoxitSerifBoldItalic.pfb',
  },
  mono: {
    regular: 'FoxitFixed.pfb',
    bold: 'FoxitFixedBold.pfb',
    italic: 'FoxitFixedItalic.pfb',
    boldItalic: 'FoxitFixedBoldItalic.pfb',
  },
  symbol: { regular: 'FoxitSymbol.pfb' },
  dingbats: { regular: 'FoxitDingbats.pfb' },
};
// Descriptor metrics for the CFF faces, from the Adobe Core 14 AFM files they replace.
const METRICS = {
  serif: { Ascent: 683, Descent: -217, CapHeight: 662, StemV: 84 },
  mono: { Ascent: 629, Descent: -157, CapHeight: 562, StemV: 51 },
  symbol: { Ascent: 1010, Descent: -293, CapHeight: 1010, StemV: 85 },
  dingbats: { Ascent: 820, Descent: -143, CapHeight: 820, StemV: 90 },
};

/** The standard 14 font a font name stands for (with the Arial/Times New Roman/Courier New aliases). */
const STANDARD_NAMES = [
  ['sans', /^Helvetica(-Bold|-Oblique|-BoldOblique)?$/],
  ['serif', /^Times-(Roman|Bold|Italic|BoldItalic)$/],
  ['mono', /^Courier(-Bold|-Oblique|-BoldOblique)?$/],
  ['sans', /^Arial(?:MT|,(Bold|Italic|BoldItalic)|-(Bold|Italic|BoldItalic)MT)?$/],
  ['serif', /^TimesNewRoman(?:PSMT|,(Bold|Italic|BoldItalic)|PS-(Bold|Italic|BoldItalic)MT)?$/],
  ['mono', /^CourierNew(?:PSMT|,(Bold|Italic|BoldItalic)|PS-(Bold|Italic|BoldItalic)MT)?$/],
];
export function standardFontKey(baseFont) {
  if (typeof baseFont !== 'string') return null;
  const value = baseFont.replace(/\s+/g, '');
  if (value === 'Symbol') return { family: 'symbol', style: 'regular' };
  if (value === 'ZapfDingbats') return { family: 'dingbats', style: 'regular' };
  for (const [family, pattern] of STANDARD_NAMES) {
    const match = value.match(pattern);
    if (!match) continue;
    const style = match.slice(1).find(Boolean) || '';
    const bold = style.includes('Bold'),
      italic = /Italic|Oblique/.test(style);
    return {
      family,
      style: bold ? (italic ? 'boldItalic' : 'bold') : italic ? 'italic' : 'regular',
    };
  }
  return null;
}

/** Glyph name to Unicode for every name in the WinAnsi and Standard encodings. */
let unicodeNames;
function unicodeOf(glyph) {
  if (!unicodeNames) {
    unicodeNames = new Map();
    const cp1252 = new TextDecoder('windows-1252');
    WIN_ANSI_ENCODING.forEach((glyphName, code) => {
      if (!glyphName || unicodeNames.has(glyphName)) return;
      const char = cp1252.decode(new Uint8Array([code]));
      if (
        char.codePointAt(0) >= 0x20 &&
        !(code >= 0x7f && code <= 0x9f && char.codePointAt(0) < 0xa0)
      )
        unicodeNames.set(glyphName, char.codePointAt(0));
    });
    for (const [glyphName, code] of Object.entries({
      quoteright: 0x2019,
      quoteleft: 0x2018,
      fraction: 0x2044,
      fi: 0xfb01,
      fl: 0xfb02,
      breve: 0x2d8,
      dotaccent: 0x2d9,
      ring: 0x2da,
      hungarumlaut: 0x2dd,
      ogonek: 0x2db,
      caron: 0x2c7,
      dotlessi: 0x131,
      Lslash: 0x141,
      lslash: 0x142,
      minus: 0x2212,
    }))
      if (!unicodeNames.has(glyphName)) unicodeNames.set(glyphName, code);
  }
  if (unicodeNames.has(glyph)) return unicodeNames.get(glyph);
  const uni = glyph.match(/^uni([\dA-F]{4})$/) || glyph.match(/^u([\dA-F]{4,6})$/);
  return uni ? parseInt(uni[1], 16) : undefined;
}

// ---------------------------------------------------------------------------------------------
// A compact CFF reader: glyph names, built-in encoding, and advance widths (CFF spec, Type 2).

function cffIndex(bytes, at) {
  const count = (bytes[at] << 8) | bytes[at + 1];
  if (!count) return { items: [], end: at + 2 };
  const size = bytes[at + 2];
  const offset = (i) => {
    let value = 0;
    for (let k = 0; k < size; k++) value = value * 256 + bytes[at + 3 + i * size + k];
    return value;
  };
  const base = at + 3 + (count + 1) * size - 1;
  const items = [];
  for (let i = 0; i < count; i++)
    items.push(bytes.subarray(base + offset(i), base + offset(i + 1)));
  return { items, end: base + offset(count) };
}
function cffDict(bytes) {
  const dict = new Map();
  let operands = [];
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    if (b <= 21) {
      const key = b === 12 ? 1200 + bytes[i + 1] : b;
      i += b === 12 ? 2 : 1;
      dict.set(key, operands);
      operands = [];
    } else if (b === 28) {
      operands.push(((bytes[i + 1] << 24) | (bytes[i + 2] << 16)) >> 16);
      i += 3;
    } else if (b === 29) {
      operands.push(
        (bytes[i + 1] << 24) | (bytes[i + 2] << 16) | (bytes[i + 3] << 8) | bytes[i + 4],
      );
      i += 5;
    } else if (b === 30) {
      let text = '';
      i++;
      outer: while (i < bytes.length) {
        for (const nibble of [bytes[i] >> 4, bytes[i] & 15]) {
          if (nibble === 15) break outer;
          text += ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', 'E', 'E-', '', '-'][
            nibble
          ];
        }
        i++;
      }
      i++;
      operands.push(Number(text));
    } else if (b >= 32 && b <= 246) {
      operands.push(b - 139);
      i++;
    } else if (b >= 247 && b <= 250) {
      operands.push((b - 247) * 256 + bytes[i + 1] + 108);
      i += 2;
    } else if (b >= 251 && b <= 254) {
      operands.push(-(b - 251) * 256 - bytes[i + 1] - 108);
      i += 2;
    } else throw new Error('Unsupported CFF data.');
  }
  return dict;
}
const bias = (subrs) => (subrs.length < 1240 ? 107 : subrs.length < 33900 ? 1131 : 32768);
/** The advance width coded at the start of a Type 2 charstring, or undefined for the default. */
function charstringWidth(code, gsubrs, subrs) {
  const stack = [];
  let depth = 0;
  const run = (bytes) => {
    if (++depth > 10) throw new Error('Unsupported CFF data.');
    for (let i = 0; i < bytes.length;) {
      const b = bytes[i];
      if (b === 28) {
        stack.push(((bytes[i + 1] << 24) | (bytes[i + 2] << 16)) >> 16);
        i += 3;
      } else if (b >= 32 && b <= 246) {
        stack.push(b - 139);
        i++;
      } else if (b >= 247 && b <= 250) {
        stack.push((b - 247) * 256 + bytes[i + 1] + 108);
        i += 2;
      } else if (b >= 251 && b <= 254) {
        stack.push(-(b - 251) * 256 - bytes[i + 1] - 108);
        i += 2;
      } else if (b === 255) {
        stack.push(
          ((bytes[i + 1] << 24) | (bytes[i + 2] << 16) | (bytes[i + 3] << 8) | bytes[i + 4]) /
            65536,
        );
        i += 5;
      } else if (b === 10 || b === 29) {
        const list = b === 10 ? subrs : gsubrs;
        const subr = list[stack.pop() + bias(list)];
        if (!subr) throw new Error('Unsupported CFF data.');
        const result = run(subr);
        if (result !== null) return result;
        i++;
      } else if (b === 11) {
        depth--;
        return null;
      } else {
        // The first stack-clearing operator tells whether an extra width operand was given.
        const pairs = [1, 3, 18, 23, 19, 20].includes(b);
        const odd =
          (pairs && stack.length % 2 === 1) ||
          (b === 21 && stack.length > 2) ||
          ((b === 22 || b === 4) && stack.length > 1) ||
          (b === 14 && (stack.length === 1 || stack.length === 5));
        if (pairs || [21, 22, 4, 14].includes(b))
          return odd ? { width: stack[0] } : { width: undefined };
        throw new Error('Unsupported CFF data.');
      }
    }
    depth--;
    return null;
  };
  return run(code)?.width;
}

/** Parse a bare CFF (Type1C) font: its PostScript name, glyph widths by name, and encoding. */
export function readCff(bytes) {
  if (bytes[0] !== 1) throw new Error('Unsupported CFF data.');
  const names = cffIndex(bytes, bytes[2]);
  const top = cffIndex(bytes, names.end);
  const strings = cffIndex(bytes, top.end);
  const gsubrs = cffIndex(bytes, strings.end).items;
  const dict = cffDict(top.items[0]);
  if (dict.has(1230)) throw new Error('CID-keyed CFF fonts are not supported here.');
  const sid = (value) =>
    value < CFF_STANDARD_STRINGS.length
      ? CFF_STANDARD_STRINGS[value]
      : String.fromCharCode(...(strings.items[value - CFF_STANDARD_STRINGS.length] || []));
  const charStrings = cffIndex(bytes, dict.get(17)[0]).items;
  const [privateSize, privateOffset] = dict.get(18) || [0, 0];
  const privateDict = cffDict(bytes.subarray(privateOffset, privateOffset + privateSize));
  const subrs = privateDict.has(19)
    ? cffIndex(bytes, privateOffset + privateDict.get(19)[0]).items
    : [];
  const defaultWidth = privateDict.get(20)?.[0] ?? 0,
    nominalWidth = privateDict.get(21)?.[0] ?? 0;
  const scale = (dict.get(1207)?.[0] ?? 0.001) * 1000;
  // Glyph names come from the charset (gid 0 is always .notdef).
  const glyphNames = ['.notdef'];
  const charset = dict.get(15)?.[0] ?? 0;
  if (charset === 0) for (let g = 1; g < charStrings.length; g++) glyphNames.push(sid(g));
  else if (charset > 2) {
    let at = charset + 1;
    const format = bytes[charset];
    while (glyphNames.length < charStrings.length) {
      if (format === 0) {
        glyphNames.push(sid((bytes[at] << 8) | bytes[at + 1]));
        at += 2;
      } else {
        const first = (bytes[at] << 8) | bytes[at + 1];
        const left = format === 1 ? bytes[at + 2] : (bytes[at + 2] << 8) | bytes[at + 3];
        at += format === 1 ? 3 : 4;
        for (let k = 0; k <= left && glyphNames.length < charStrings.length; k++)
          glyphNames.push(sid(first + k));
      }
    }
  } else throw new Error('Unsupported CFF data.');
  const widths = new Map();
  charStrings.forEach((code, gid) => {
    const coded = charstringWidth(code, gsubrs, subrs);
    widths.set(
      glyphNames[gid],
      Math.round((coded === undefined ? defaultWidth : nominalWidth + coded) * scale),
    );
  });
  // The built-in encoding: Standard (0), or a custom table with optional supplements.
  let encoding = STANDARD_ENCODING.slice();
  const encodingOffset = dict.get(16)?.[0] ?? 0;
  if (encodingOffset === 1) throw new Error('Unsupported CFF data.');
  if (encodingOffset > 1) {
    encoding = Array(256).fill('');
    const format = bytes[encodingOffset];
    let at = encodingOffset + 1;
    if ((format & 0x7f) === 0) {
      const count = bytes[at++];
      for (let g = 1; g <= count; g++) encoding[bytes[at++]] = glyphNames[g] || '';
    } else {
      const ranges = bytes[at++];
      let g = 1;
      for (let r = 0; r < ranges; r++, at += 2)
        for (let k = 0; k <= bytes[at + 1]; k++) encoding[bytes[at] + k] = glyphNames[g++] || '';
    }
    if (format & 0x80) {
      const count = bytes[at++];
      for (let s = 0; s < count; s++, at += 3)
        encoding[bytes[at]] = sid((bytes[at + 1] << 8) | bytes[at + 2]);
    }
  }
  return {
    fontName: String.fromCharCode(...names.items[0]),
    widths,
    encoding,
    bbox: (dict.get(5) || [0, 0, 1000, 1000]).map((v) => Math.round(v * scale)),
    italicAngle: dict.get(1202)?.[0] ?? 0,
  };
}

// ---------------------------------------------------------------------------------------------

/** The glyph name for each code, or null when the font's encoding is not a plain name table. */
function encodingNames(dict, builtin) {
  const value = get(dict, 'Encoding');
  const base = (entry) =>
    entry === undefined
      ? builtin
      : entry === name('WinAnsiEncoding')
        ? WIN_ANSI_ENCODING
        : entry === name('StandardEncoding')
          ? STANDARD_ENCODING
          : null;
  if (!(value instanceof PDFDict)) return base(value)?.slice() ?? null;
  const names = base(get(value, 'BaseEncoding'))?.slice();
  if (!names) return null;
  const differences = get(value, 'Differences');
  if (differences instanceof PDFArray) {
    let code = 0;
    for (const entry of differences.asArray()) {
      const item = dict.context.lookup(entry);
      if (item instanceof PDFNumber) code = item.asNumber();
      else if (item instanceof PDFName && code >= 0 && code < 256) {
        // .notdef draws nothing: the code is simply unused.
        const glyph = item.decodeText();
        names[code++] = glyph === '.notdef' ? '' : glyph;
      } else return null;
    }
  }
  return names;
}

/** Why a font cannot get a substitute (before loading anything), or null when it can. */
function substitutionProblem(dict, part) {
  const subtype = get(dict, 'Subtype');
  if (subtype !== name('Type1') && subtype !== name('TrueType')) return 'it is not a simple font';
  const key = standardFontKey(get(dict, 'BaseFont')?.decodeText?.());
  if (!key) return 'no substitute is bundled for it';
  const symbolic = key.family === 'symbol' || key.family === 'dingbats';
  if (symbolic && get(dict, 'Encoding') !== undefined) return 'it re-encodes a symbol font';
  const names = encodingNames(
    dict,
    key.family === 'symbol'
      ? SYMBOL_ENCODING
      : key.family === 'dingbats'
        ? ZAPF_DINGBATS_ENCODING
        : STANDARD_ENCODING,
  );
  if (!names) return 'its encoding is not supported';
  if (key.family === 'sans') {
    if (part === 1 && get(dict, 'Encoding') !== name('WinAnsiEncoding'))
      return 'PDF/A-1 allows only the WinAnsi encoding for its TrueType substitute';
    const unnamed = names.find((glyph) => glyph && unicodeOf(glyph) === undefined);
    if (unnamed) return `its glyph “${unnamed}” has no Unicode value`;
  }
  return null;
}
/** Whether `embedStandardSubstitute` can replace this font for PDF/A part `part`. */
export const canSubstituteStandardFont = (dict, part) => !substitutionProblem(dict, part);

const LOADED = new WeakMap();
/** Load and parse a substitute once per document; the font file object is shared. */
function substitute(doc, file, loadAsset) {
  let files = LOADED.get(doc);
  if (!files) LOADED.set(doc, (files = new Map()));
  if (!files.has(file))
    files.set(
      file,
      (async () => {
        const bytes = new Uint8Array(await loadAsset(`standard_fonts/${file}`));
        if (file.endsWith('.ttf')) {
          // Loaded on demand, as for text editing: fontkit is large.
          const { default: fontkit } = await import('@pdf-lib/fontkit');
          const font = fontkit.create(bytes);
          const stream = doc.context.flateStream(bytes, {
            Length1: bytes.length,
          });
          return {
            kind: 'TrueType',
            font,
            ref: doc.context.register(stream),
            name: font.postscriptName,
          };
        }
        const cff = readCff(bytes);
        const stream = doc.context.flateStream(bytes, { Subtype: 'Type1C' });
        return {
          kind: 'Type1C',
          cff,
          ref: doc.context.register(stream),
          name: cff.fontName,
        };
      })(),
    );
  return files.get(file);
}

/**
 * Replace a non-embedded standard 14 simple font with an embedded substitute, in place.
 * Returns the substitute's name, or a reason string in `{ reason }` when it cannot be done.
 * `part` decides whether a TrueType substitute may carry an encoding with Differences
 * (PDF/A-1 6.3.7 requires the plain WinAnsi or MacRoman name for non-symbolic TrueType).
 */
export async function embedStandardSubstitute(doc, dict, { part, loadAsset }) {
  const problem = substitutionProblem(dict, part);
  if (problem) return { reason: problem };
  const baseFont = get(dict, 'BaseFont').decodeText();
  const key = standardFontKey(baseFont);
  const file = FAMILIES[key.family][key.style];
  const symbolic = key.family === 'symbol' || key.family === 'dingbats';
  let loaded;
  try {
    loaded = await substitute(doc, file, loadAsset);
  } catch {
    return { reason: 'the substitute font could not be loaded' };
  }
  // The Foxit symbol faces carry a Standard built-in encoding: name their codes explicitly.
  const builtin =
    key.family === 'symbol'
      ? SYMBOL_ENCODING
      : key.family === 'dingbats'
        ? ZAPF_DINGBATS_ENCODING
        : STANDARD_ENCODING;
  const names = encodingNames(dict, builtin);
  if (!names) return { reason: 'its encoding is not supported' };
  const context = doc.context;
  const widths = Array(256).fill(0);
  let flags = symbolic ? 4 : 32;
  if (/italic/i.test(key.style)) flags |= 64;
  if (key.family === 'serif') flags |= 2;
  if (key.family === 'mono') flags |= 1;
  const descriptor = {
    Type: 'FontDescriptor',
    FontName: loaded.name,
    Flags: flags,
  };
  if (loaded.kind === 'TrueType') {
    const font = loaded.font,
      scale = 1000 / font.unitsPerEm;
    const winAnsi = names.every(
      (glyph, code) => !glyph || code < 32 || glyph === WIN_ANSI_ENCODING[code],
    );
    const plainWinAnsi = get(dict, 'Encoding') === name('WinAnsiEncoding');
    for (let code = 0; code < 256; code++) {
      if (!names[code]) continue;
      const unicode = unicodeOf(names[code]);
      const glyph = font.glyphForCodePoint(unicode);
      widths[code] = glyph?.id ? Math.round(glyph.advanceWidth * scale) : 0;
    }
    if (!plainWinAnsi) {
      const differences = [];
      names.forEach((glyph, code) => {
        if (glyph && glyph !== WIN_ANSI_ENCODING[code]) differences.push(code, name(glyph));
      });
      dict.set(
        name('Encoding'),
        winAnsi && !differences.length
          ? name('WinAnsiEncoding')
          : context.obj({
              Type: 'Encoding',
              BaseEncoding: 'WinAnsiEncoding',
              Differences: differences,
            }),
      );
    }
    Object.assign(descriptor, {
      FontBBox: [font.bbox.minX, font.bbox.minY, font.bbox.maxX, font.bbox.maxY].map((v) =>
        Math.round(v * scale),
      ),
      ItalicAngle: font.italicAngle || 0,
      Ascent: Math.round(font.ascent * scale),
      Descent: Math.round(font.descent * scale),
      CapHeight: Math.round((font.capHeight || font.ascent) * scale),
      StemV: /bold/i.test(key.style) ? 140 : 80,
    });
  } else {
    const { cff } = loaded;
    if (symbolic) {
      const differences = [];
      names.forEach((glyph, code) => glyph && differences.push(code, name(glyph)));
      dict.set(name('Encoding'), context.obj({ Type: 'Encoding', Differences: differences }));
    }
    for (let code = 0; code < 256; code++)
      if (names[code]) widths[code] = cff.widths.get(names[code]) ?? cff.widths.get('.notdef') ?? 0;
    const metrics = METRICS[key.family];
    Object.assign(descriptor, {
      FontBBox: cff.bbox,
      ItalicAngle: cff.italicAngle,
      ...metrics,
      StemV: /bold/i.test(key.style) ? Math.round(metrics.StemV * 1.6) : metrics.StemV,
    });
  }
  const used = names.map((glyph, code) => (glyph ? code : -1)).filter((code) => code >= 0);
  const first = Math.min(...used),
    last = Math.max(...used);
  const fontDescriptor = context.obj(descriptor);
  fontDescriptor.set(name(loaded.kind === 'TrueType' ? 'FontFile2' : 'FontFile3'), loaded.ref);
  dict.set(name('Subtype'), name(loaded.kind === 'TrueType' ? 'TrueType' : 'Type1'));
  dict.set(name('BaseFont'), name(loaded.name));
  dict.set(name('FirstChar'), PDFNumber.of(first));
  dict.set(name('LastChar'), PDFNumber.of(last));
  dict.set(name('Widths'), context.obj(widths.slice(first, last + 1)));
  dict.set(name('FontDescriptor'), context.register(fontDescriptor));
  return { substitute: loaded.name, original: baseFont };
}

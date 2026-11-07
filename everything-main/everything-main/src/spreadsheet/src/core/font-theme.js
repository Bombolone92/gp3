import { MAX_TEXT } from './cell.js';

const text = value => typeof value === 'string' && value.length <= MAX_TEXT
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(value) ? value : null;
// DrawingML CT_TextFont uses signed bytes, unlike SpreadsheetML's charset.
const byte = value => (typeof value === 'number' || typeof value === 'string' && /^-?\d+$/.test(value))
  && Number.isInteger(Number(value)) && Number(value) >= -128 && Number(value) <= 127;

/** DrawingML font schemes also carry East Asian, complex-script and fallback faces. */
export function normalizeFontTheme(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = { name: text(raw.name) ?? '' };
  for (const key of ['major', 'minor']) {
    const source = raw[key];
    if (!source || typeof source !== 'object') return null;
    const collection = {};
    for (const slot of ['latin', 'ea', 'cs']) {
      const font = source[slot];
      if (!font || text(font.typeface) == null) return null;
      const face = { typeface: font.typeface };
      if (/^[\da-f]{20}$/i.test(font.panose || '')) face.panose = font.panose;
      for (const attr of ['pitchFamily', 'charset']) if (font[attr] != null && byte(font[attr])) face[attr] = Number(font[attr]);
      collection[slot] = face;
    }
    collection.fonts = (Array.isArray(source.fonts) ? source.fonts : []).slice(0, MAX_TEXT)
      .filter(font => font && /^[A-Za-z]{4}$/.test(font.script) && text(font.typeface) != null)
      .map(font => ({ script: font.script, typeface: font.typeface }));
    out[key] = collection;
  }
  return out;
}

const unescape = value => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (all, key) => {
  if (key[0] !== '#') return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[key.toLowerCase()];
  const n = /^#x/i.test(key) ? parseInt(key.slice(2), 16) : Number(key.slice(1));
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
});
const attrs = tag => Object.fromEntries([...(tag || '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
  .map(m => [m[1], unescape(m[2] ?? m[3])]));
// A greater-than sign is legal inside an XML attribute value.
const tagAttributes = `(?:"[^"]*"|'[^']*'|[^'">])*`;
const opening = (xml, tag) => xml?.match(new RegExp(`<(?:[\\w.-]+:)?${tag}\\b${tagAttributes}>`))?.[0];
const element = (xml, tag) => xml?.match(new RegExp(`<(?:[\\w.-]+:)?${tag}\\b${tagAttributes}?(?:/>|>[\\s\\S]*?</(?:[\\w.-]+:)?${tag}>)`))?.[0];

export function readFontTheme(xml) {
  if (typeof xml !== 'string') return null;
  const scheme = element(xml.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g, ''), 'fontScheme');
  if (!scheme) return null;
  const out = { name: attrs(opening(scheme, 'fontScheme')).name };
  for (const key of ['major', 'minor']) {
    const body = element(scheme, `${key}Font`);
    if (!body) return null;
    out[key] = Object.fromEntries(['latin', 'ea', 'cs'].map(slot => [slot, attrs(opening(body, slot))]));
    out[key].fonts = [...body.matchAll(new RegExp(`<(?:[\\w.-]+:)?font\\b${tagAttributes}>`, 'g'))].map(m => attrs(m[0]));
  }
  return normalizeFontTheme(out);
}

const escape = value => String(value).replace(/[&<>"\r\n\t]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\r': '&#13;', '\n': '&#10;', '\t': '&#9;' })[ch]);
const tag = (name, attributes, body) => `<a:${name}${Object.entries(attributes).map(([key, value]) => ` ${key}="${escape(value)}"`).join('')}${body == null ? '/>' : `>${body}</a:${name}>`}`;

export function fontThemeXml(raw) {
  const theme = normalizeFontTheme(raw);
  return theme ? tag('fontScheme', { name: theme.name }, ['major', 'minor'].map(key => {
    const fonts = theme[key];
    return tag(`${key}Font`, {}, ['latin', 'ea', 'cs'].map(slot => tag(slot, fonts[slot])).join('')
      + fonts.fonts.map(font => tag('font', font)).join(''));
  }).join('')) : '';
}

// The app's default font scheme, matching the historical XLSX writer.
// Keep its defaults explicit so export and draft comparison use one context.
const DEFAULT_SCRIPT_FONTS = [
  ["Jpan", "ＭＳ Ｐゴシック"],
  ["Hang", "맑은 고딕"],
  ["Hans", "宋体"],
  ["Hant", "新細明體"],
  ["Arab", "Times New Roman", "Arial"],
  ["Hebr", "Times New Roman", "Arial"],
  ["Thai", "Tahoma"],
  ["Ethi", "Nyala"],
  ["Beng", "Vrinda"],
  ["Gujr", "Shruti"],
  ["Khmr", "MoolBoran", "DaunPenh"],
  ["Knda", "Tunga"],
  ["Guru", "Raavi"],
  ["Cans", "Euphemia"],
  ["Cher", "Plantagenet Cherokee"],
  ["Yiii", "Microsoft Yi Baiti"],
  ["Tibt", "Microsoft Himalaya"],
  ["Thaa", "MV Boli"],
  ["Deva", "Mangal"],
  ["Telu", "Gautami"],
  ["Taml", "Latha"],
  ["Syrc", "Estrangelo Edessa"],
  ["Orya", "Kalinga"],
  ["Mlym", "Kartika"],
  ["Laoo", "DokChampa"],
  ["Sinh", "Iskoola Pota"],
  ["Mong", "Mongolian Baiti"],
  ["Viet", "Times New Roman", "Arial"],
  ["Uigh", "Microsoft Uighur"],
  ["Geor", "Sylfaen"],
 ];
export function effectiveFontTheme(raw) {
  return normalizeFontTheme(raw) || {
    name: 'Office',
    ...Object.fromEntries(['major', 'minor'].map((key, index) => [key, {
      latin: { typeface: index ? 'Calibri' : 'Cambria' }, ea: { typeface: '' }, cs: { typeface: '' },
      fonts: DEFAULT_SCRIPT_FONTS.map(([script, major, minor]) => ({ script, typeface: index ? minor || major : major })),
    }])),
  };
}

/** SpreadsheetML major/minor schemes override the cached Latin family name.
 * Empty or unavailable theme slots fall back to that name. Script-specific
 * theme collections remain intact for native export. */
export function resolveThemeFont(name, scheme, theme) {
  const face = ['major', 'minor'].includes(scheme) && theme?.[scheme]?.latin?.typeface;
  return typeof face === 'string' && face.trim() ? face : name;
}

// Reuse the writer default in per-cell copy/export paths. Model themes are
// already normalized; resolving a face must not clone every script collection.
const defaultFontTheme = effectiveFontTheme();

/** A copied font can carry a binding from another workbook. Retain the binding
 * only when this theme resolves it to the same face; otherwise keep its family. */
export function exportFontScheme(name, scheme, theme) {
  if (scheme === 'none') return 'none';
  if (!['major', 'minor'].includes(scheme)) return null;
  const face = resolveThemeFont(null, scheme, theme ?? defaultFontTheme);
  return face?.toLowerCase() === name?.toLowerCase() ? scheme : null;
}

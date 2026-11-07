/**
 * The PDF editor's command icons, in the glass idiom the Spreadsheet app's command icons use
 * (src/spreadsheet/src/ui/office-icons.js): rounded ink outlines over top-lit gradient fills in the
 * system palette, drawn on a 20-unit grid with strokes that do not scale. They are original
 * drawings. The builders below and every icon the two apps share are copied verbatim from the
 * Spreadsheet's set, so a shared command looks the same in both; only the PDF's own tools are new.
 * Colours come from the --ico-* tokens and the #ico-g-* gradients (glass-icons.css, index.html).
 *
 * Classes: o outline, of outline on paper, s solid ink, and per accent x ∈ {b, g, r, y, n, p}:
 * x stroke only, xf soft fill with stroke, xs solid fill, xw soft fill without stroke.
 *
 * Only command and tool names have a drawing here; interface glyphs (chevrons, close, arrows, menus,
 * status) stay Lucide line icons (lib/ui.js).
 */

import { ICON_GLYPHS } from './icon-glyphs.js';

/* ---- Builders, verbatim from the Spreadsheet's office-icons.js ---- */
const p = (d, c = 'o') => `<path class="${c}" d="${d}"/>`;
/** Outlined rectangles (frames, sheets, tiles) get softly rounded corners unless `rx` says otherwise; fills laid inside a frame stay square. */
const ROUND = 1.6;
const rounds = (c) => /(^| )(o|of|[bgrynp]f)( |$)/.test(c) && !c.includes('dash');
const r = (x, y, w, h, c = 'o', rx = rounds(c) ? +Math.min(ROUND, w / 4, h / 4).toFixed(2) : 0) => `<rect class="${c}" x="${x}" y="${y}" width="${w}" height="${h}"${rx ? ` rx="${rx}"` : ''}/>`;
const ci = (cx, cy, rad, c = 'o') => `<circle class="${c}" cx="${cx}" cy="${cy}" r="${rad}"/>`;
/**
 * Lettering as outlines from the bundled fonts (icon-glyphs.js), never SVG text: text would be read
 * out as part of a button's or menu item's text, and would depend on the fonts installed.
 */
const t = (x, y, text, size, { weight = 400, italic = false, serif = false, anchor = 'middle', c = 'tx' } = {}) => {
  const font = ICON_GLYPHS[serif ? (italic ? 'serifItalic' : 'serif') : weight >= 600 ? 'sansBold' : 'sans'];
  const scale = size / 1000;
  const chars = [...text].map((ch) => font[ch]);
  if (chars.some((g) => !g)) throw new Error(`office-icons: no outline for "${text}"; run dev/generate-icon-glyphs.py`);
  const width = chars.reduce((sum, [adv]) => sum + adv, 0) * scale;
  const x0 = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  let at = 0;
  const parts = chars.map(([adv, d]) => { const part = `<path d="${d}" transform="translate(${at} 0)"/>`; at += adv; return part; });
  return `<g class="${c}" transform="translate(${+x0.toFixed(2)} ${y}) scale(${+scale.toFixed(5)})">${parts.join('')}</g>`;
};

/* ---- Shared pieces ---- */
/** A sheet of cells: a frame with `cols` × `rows` cells, optionally a soft header row. */
function cells(x, y, w, h, cols, rows, { head = null, frame = 'of' } = {}) {
  let out = r(x, y, w, h, frame);
  // The header row follows the frame's rounded top corners.
  const k = +Math.min(ROUND, w / 4, h / 4).toFixed(2);
  if (head) out += p(`M${x} ${y + h / rows}V${y + k}a${k} ${k} 0 0 1 ${k}-${k}H${x + w - k}a${k} ${k} 0 0 1 ${k} ${k}V${y + h / rows}z`, head);
  let d = '';
  for (let i = 1; i < cols; i++) d += `M${x + (w * i) / cols} ${y}v${h}`;
  for (let j = 1; j < rows; j++) d += `M${x} ${y + (h * j) / rows}h${w}`;
  return out + p(d, 'o ln');
}
const page = (x = 4.5, y = 2.5, w = 11, h = 15, fold = 3, k = 1.2) => p(`M${x + k} ${y}h${w - fold - k}l${fold} ${fold}v${h - fold - k}a${k} ${k} 0 0 1-${k} ${k}h-${w - 2 * k}a${k} ${k} 0 0 1-${k}-${k}v-${h - 2 * k}a${k} ${k} 0 0 1 ${k}-${k}z`, 'of') + (fold ? p(`M${x + w - fold} ${y}v${fold}h${fold}z`, 'bf') : '');
const lines = (x, y, w, n, gap = 2.5, c = 'o ln') => p(Array.from({ length: n }, (_, i) => `M${x} ${y + i * gap}h${w}`).join(''), c);
const arrowDown = (x, y, len, c = 'b') => p(`M${x} ${y}v${len}M${x - 2.5} ${y + len - 2.5}l2.5 2.5 2.5-2.5`, c);
const arrowRight = (x, y, len, c = 'b') => p(`M${x} ${y}h${len}M${x + len - 2.5} ${y - 2.5}l2.5 2.5-2.5 2.5`, c);
const brush = (dx = 0, dy = 0) => `<g transform="translate(${dx} ${dy})">${p('M17.5 8.5 13 13', 'o')}${p('M11.6 12.4l1.9 1.9-1.4 1.4-1.9-1.9z', 'bs')}${p('M10.2 13.8l1.9 1.9c-.8 1.8-2.6 2.6-4.6 2.3.6-1.7 1.4-3.2 2.7-4.2z', 'ys')}</g>`;
const lock = (x, y) => r(x - 1, y - 4.5, 10, 11.5, 'knock', 2.5) + p(`M${x + 1.5} ${y}v-2a2.5 2.5 0 0 1 5 0v2`, 'o thick') + r(x, y, 8, 6, 'ns', 1.4) + ci(x + 4, y + 3, 0.9, 'glint');
const magnifier = (cx, cy, rad, fill = 'bw') => ci(cx, cy, rad, fill) + ci(cx, cy, rad, 'o') + p(`M${cx + rad * 0.78} ${cy + rad * 0.78}l${rad * 0.85} ${rad * 0.85}`, 'o grip');
const funnel = (x, y, s = 1) => p(`M${x} ${y}h${10 * s}l-${3.8 * s} ${4.6 * s}v${4 * s}l-${2.4 * s} ${1.4 * s}v-${5.4 * s}z`, 'bf');
const az = (x, y, first = 'A', second = 'Z') => t(x, y, first, 6.5, { weight: 600, c: 'txb' }) + t(x, y + 7, second, 6.5, { weight: 600 });
/** Signs drawn in white on a badge: each a path about (x, y) with half-size `k`. */
const SIGNS = {
  plus: (x, y, k) => `M${x - k} ${y}h${2 * k}M${x} ${y - k}v${2 * k}`,
  minus: (x, y, k) => `M${x - k} ${y}h${2 * k}`,
  x: (x, y, k) => `M${x - k * 0.8} ${y - k * 0.8}l${k * 1.6} ${k * 1.6}M${x + k * 0.8} ${y - k * 0.8}l-${k * 1.6} ${k * 1.6}`,
  check: (x, y, k) => `M${x - k} ${y + 0.1}l${k * 0.7} ${k * 0.7} ${k * 1.3}-${k * 1.5}`,
};
/** A round solid badge carrying a white sign, cut out of the drawing under it by a ring of the surface colour. */
const badge = (cx, cy, sign, hue = 'g', rad = 3.4) => ci(cx, cy, rad + 0.9, 'knock') + ci(cx, cy, rad, `${hue}s`) + p(SIGNS[sign](cx, cy, rad * 0.48), 'wh thick');
const sheetPlus = badge(15, 15, 'plus');
const chartAxes = p('M3.5 3v13.5H17', 'o ln');
const borderIcon = (solid) => {
  const edges = { top: 'M3.5 3.5h13', bottom: 'M3.5 16.5h13', left: 'M3.5 3.5v13', right: 'M16.5 3.5v13', h: 'M3.5 10h13', v: 'M10 3.5v13' };
  const dashed = Object.keys(edges).filter((k) => !solid.includes(k)).map((k) => edges[k]).join('');
  return (dashed ? p(dashed, 'o dash ln') : '') + (solid.length ? p(solid.map((k) => edges[k]).join(''), 'b thick') : '');
};
/** A small printer, its top-left corner at (x, y): paper in, the body, paper out. */
const printerBadge = (x, y) => r(x + 2, y, 5, 2.5, 'of') + r(x, y + 2.5, 9, 4.5, 'of', 1) + r(x + 2, y + 5, 5, 3.5, 'of') + p(`M${x + 3.2} ${y + 6.8}h2.6`, 'o ln');
/** A table of three columns and four rows with `fills` laid under its lines. */
const tableShaded = (fills) => cells(2.5, 3.5, 15, 13, 3, 4) + fills + cells(2.5, 3.5, 15, 13, 3, 4, { frame: 'o' });
/** Chart marks are solid glass: a soft class (bf) is drawn as its solid (bs), with rounded ends. */
const solid = (c) => c.replace(/^([bgrynp])f$/, '$1s');
const columns = (bars, x0 = 5, w = 2.6, gap = 1.4, base = 16.5) => bars.map(([h, c], i) => r(x0 + i * (w + gap), base - h, w, h, solid(c), 0.7)).join('');

/* ---- Icons the PDF shares with the Spreadsheet: the same keys and bodies, verbatim ---- */
const SHARED = {
  paste: r(3, 3.5, 11, 14, 'nf', 2) + r(5.5, 2, 6, 3.2, 'of', 1.2) + page(8.5, 7, 9, 11, 2.5) + lines(10.3, 11.5, 5, 3, 2),
  cut: p('M7.4 11.8 14 2.5M12.6 11.8 6 2.5', 'o') + ci(10, 8.6, 0.7, 's') + ci(6.2, 14.6, 2.7, 'bs') + ci(6.2, 14.6, 1.2, 'knock') + ci(13.8, 14.6, 2.7, 'bs') + ci(13.8, 14.6, 1.2, 'knock'),
  copy: r(2.5, 2.5, 10, 12, 'bf glassy', 2) + r(7.5, 5.5, 10, 12, 'of', 2) + lines(9.7, 9.5, 5.6, 4, 2),
  eraser: p('M7 16.5 2.8 12.3a1 1 0 0 1 0-1.4l7.4-7.4a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-7.1 7.1z', 'pf') + p('M2.8 12.3a1 1 0 0 1 0-1.4l3-3 6.4 6.4-2.5 2.5H7z', 'of') + p('M11 18.5h6.5', 'o'),
  calendar: r(3, 3.5, 14, 14, 'of', 2.4) + p('M3 7.5V5.9a2.4 2.4 0 0 1 2.4-2.4h9.2A2.4 2.4 0 0 1 17 5.9v1.6z', 'rs') + t(10, 15.4, '31', 7, { weight: 600 }),
  find: magnifier(8.5, 8.5, 5.5),
  pictures: r(2.5, 3.5, 15, 13, 'bf', 2) + p('M2.5 14l4.5-5 3.5 3.5 2.5-2.5 4.5 4.5v.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z', 'gs') + ci(13, 7.5, 1.7, 'ys'),
  image: r(2.5, 3.5, 15, 13, 'bf', 2) + p('M2.5 14l4.5-5 3.5 3.5 2.5-2.5 4.5 4.5v.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z', 'gs') + ci(13, 7.5, 1.7, 'ys'),
  shapes: ci(7.5, 7.5, 5, 'bs') + r(8.5, 8.5, 9, 9, 'nf glassy', 2),
  link: p('M8.5 11.5a3 3 0 0 0 4.2 0l3-3a3 3 0 0 0-4.2-4.2l-1 1', 'b thick') + p('M11.5 8.5a3 3 0 0 0-4.2 0l-3 3a3 3 0 0 0 4.2 4.2l1-1', 'o thick'),
  unlink: p('M12 6.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M8 13.5l-1 1a2.5 2.5 0 0 1-3.5-3.5l1-1', 'o thick') + p('M4 4l2 2M16 16l-2-2M7.5 2.5v2M12.5 17.5v-2', 'r'),
  note: p('M3.5 3.5h13v9l-4 4h-9z', 'yf') + p('M16.5 12.5h-4v4', 'o') + lines(6, 7, 7, 2, 2.5),
  comment: p('M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H9.5l-4 3v-3H5a2 2 0 0 1-2-2z', 'bs') + p('M10 6v5.5M7.25 8.75h5.5', 'wh thick'),
  textBox: r(3.5, 4.5, 13, 11, 'of', 1.6) + ci(3.5, 4.5, 1.2, 'bs') + ci(16.5, 4.5, 1.2, 'bs') + ci(3.5, 15.5, 1.2, 'bs') + ci(16.5, 15.5, 1.2, 'bs') + t(10, 14, 'A', 9),
  headerFooter: page(4.5, 2.5, 11, 15) + r(6, 4.5, 8, 2.5, 'bw') + r(6, 13.5, 8, 2, 'bw') + lines(6.5, 9, 7, 2, 2),
  printer: r(5.5, 2.5, 9, 5, 'of') + r(2.5, 7, 15, 7.5, 'bs', 2) + r(5.5, 11.5, 9, 6, 'of', 0.8) + lines(7, 14, 6, 2, 2) + ci(15, 9.3, 0.7, 'glint'),
  pageSetup: page(4.5, 2.5, 11, 15) + lines(6.5, 6.5, 5, 3, 2) + ci(14, 14, 3.9, 'knock') + ci(14, 14, 3, 'ns') + ci(14, 14, 1, 'knock'),
  lockSheet: page(2.5, 2.5, 10, 14) + lock(9.5, 11.5),
  unprotect: page(2.5, 2.5, 10, 14) + p('M11 11.5v-2a2.5 2.5 0 0 1 5 0', 'o') + r(9.5, 11.5, 8, 6, 'nf', 1),
  share: p('M3.5 9.5v7h13v-7', 'o') + p('M10 12.5v-10M7 5.5l3-3 3 3', 'b thick'),
  reset: p('M16.5 7.5a7 7 0 0 0-12.5-1.5M4 3v3h3', 'g thick') + p('M3.5 12.5a7 7 0 0 0 12.5 1.5M16 17v-3h-3', 'g thick'),
  zoomIn: magnifier(8.5, 8.5, 5.5) + p('M6 8.5h5M8.5 6v5', 'o'),
  zoomOut: magnifier(8.5, 8.5, 5.5) + p('M6 8.5h5', 'o'),
  fullscreen: r(2.5, 3.5, 15, 10, 'of', 1.6) + r(3.8, 4.8, 12.4, 7.4, 'bs', 0.8) + p('M7 17.5h6M10 13.5v4', 'o'),
  save: p('M5 3.5h9l2.5 2.5V15a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15V5A1.5 1.5 0 0 1 5 3.5z', 'bs') + r(6, 3.5, 7, 4.5, 'of', 0.6) + r(6, 11, 8, 5.5, 'of', 0.6),
  undo: p('M7 4.5 3.5 8 7 11.5', 'o thick') + p('M3.5 8h8.5a4.5 4.5 0 0 1 0 9H8', 'o thick'),
  redo: p('M13 4.5 16.5 8 13 11.5', 'o thick') + p('M16.5 8H8a4.5 4.5 0 0 0 0 9h4', 'o thick'),
  folderOpen: p('M2.5 15.5v-10a1 1 0 0 1 1-1h4l1.5 1.5h7a1 1 0 0 1 1 1v2', 'bf') + p('M2.5 15.5l2.3-6.2a1 1 0 0 1 .9-.6h12l-2.3 6.2a1 1 0 0 1-.9.6z', 'bs'),
  filePlus: page(4.5, 2.5, 11, 15) + badge(14.5, 14.5, 'plus'),
  download: p('M3.5 13.5v3h13v-3', 'o') + arrowDown(10, 3, 10),
  external: p('M15.5 11.5v5h-12v-12h5', 'o') + p('M11.5 3.5h5v5M16.5 3.5l-7 7', 'b thick'),
  deleteItem: p('M3.5 5.5h13M8 5.5V3.5h4v2', 'o') + p('M5 5.5l1 11a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-11', 'of') + p('M8.5 8.5v6M11.5 8.5v6', 'r'),
  accessibility: ci(8, 4, 1.8, 'bs') + p('M3 7.5h10M8 7.5v5M8 12.5l-3 5M8 12.5l3 5', 'o thick') + badge(15, 15, 'check'),
  checkbox: r(3.5, 3.5, 13, 13, 'gs', 3) + p('M6.8 10.3l2.3 2.3 4.2-5', 'wh thick'),
  dropdown: r(2.5, 6.5, 15, 7, 'of', 1) + p('M13.5 6.5v7', 'o') + p('M14.5 9.5l1 1 1-1', 'o'),
  bold: t(10, 16.2, 'B', 17, { weight: 700 }),
  italic: t(10, 16.2, 'I', 18, { italic: true, serif: true }),
  underline: t(10, 14, 'U', 15) + p('M4.5 17.2h11', 'o thick'),
  strike: t(10, 15.5, 'S', 16) + p('M4 10.5h12', 'o'),
  inkSelect: p('M5.5 2.5v13.2l3.3-3.2 2.3 5 2.3-1.1-2.3-4.9h4.6z', 'of'),
  inkEraser: p('M11.8 3.2l4.9 4.9-6.6 6.6H6.3l-2.4-2.4v-2.5z', 'rf') + p('M8.4 6.6l4.9 4.9', 'o') + p('M3.9 12.3v-2.5l4.5-3.2 4.9 4.9-3.2 3.2H6.3z', 'of') + p('M12 17.5h5.5', 'o ln'),
  inkPen: p('M14.6 2.4a1.8 1.8 0 0 1 2.5 0l.5.5a1.8 1.8 0 0 1 0 2.5L9.2 13.8l-3-3z', 'inkf') + p('M13.4 3.6l3 3', 'o ln') + p('M6.2 10.8l3 3-4.6 1.7-.2-.2z', 'of') + p('M3.4 15.6l1 1-2 .8z', 'ink'),
  inkPencil: p('M14.6 2.2l3.2 3.2-9.7 9.7-3.2-3.2z', 'inkf') + p('M14.6 2.2l1-1 3.2 3.2-1 1', 'rf') + p('M4.9 11.9l3.2 3.2-5.3 2.1z', 'nf') + p('M3.6 15.7l.7.7-1.5.8z', 'ink'),
  inkHighlighter: p('M12.7 2.5l4.8 4.8-6 6-4.8-4.8z', 'of') + p('M6.7 8.5l4.8 4.8-1.8 1.8-4.8-4.8z', 'inkf') + p('M4.9 10.3l4.8 4.8-1.6 1.6-3.8-1z', 'inkf') + r(2, 17, 9, 1.8, 'ink'),
  fileDown: page(4.5, 2.5, 11, 15) + r(2.5, 10.5, 10, 5, 'rs', 1) + t(7.5, 14.5, 'PDF', 4.6, { weight: 700, c: 'txw' }),
};

/* ---- The PDF's own pieces, in the same language ---- */
Object.assign(SIGNS, {
  down: (x, y, k) => `M${x} ${y - k}v${2 * k}M${x - k * 0.8} ${y + k * 0.2}l${k * 0.8} ${k * 0.8} ${k * 0.8}-${k * 0.8}`,
  info: (x, y, k) => `M${x} ${y - k * 0.15}v${k * 1.1}M${x} ${y - k * 0.95}v0.05`,
});
/** A fountain-pen nib centred on (x, y), tip first along `rot` degrees (45: tip to the lower left). */
const nib = (x, y, rot = 45, hue = 'p') => `<g transform="translate(${x} ${y}) rotate(${rot})">`
  + p('M0 7.5-3.2 1.2C-3.2-1.4-2.2-2.8-1.7-3.4h3.4C2.2-2.8 3.2-1.4 3.2 1.2z', `${hue}s`)
  + p('M0 7.2V2.4', 'wh') + ci(0, 1.6, 0.9, 'knock') + r(-2.4, -6.4, 4.8, 3, 'of', 0.9) + '</g>';
/** A handwritten signature over its line. */
const scrawl = (c = 'b thick') => p('M2.5 15.2c1-2.8 2.3-4.4 3.1-3.8.9.7-1.1 3.6.2 3.9 1.1.2 1.9-2.1 2.8-1.9.8.2.3 1.7 1.1 1.8.7.1 1.4-.7 2-1.2', c);
const signLine = p('M2.5 17.5h15', 'o ln');
/** A small solid tile at the corner, as a file format's badge: (x, y) its top-left corner. */
const tile = (x, y, hue, mark, s = 7.5) => r(x - 0.9, y - 0.9, s + 1.8, s + 1.8, 'knock', 2.6) + r(x, y, s, s, hue ? `${hue}s` : 'of', 1.8) + mark;
const exportDoc = (mark) => page(2.5, 2.5, 11, 15) + lines(4.5, 8, 6, 3, 2.5) + mark;
const pages2 = page(6.5, 1.5, 10, 13.5, 2.5) + page(3.5, 4.5, 10, 13.5, 2.5) + lines(5.5, 10, 6, 3, 2);
const rotateArrow = (cw) => cw
  ? p('M10.5 3h2a4.5 4.5 0 0 1 4.5 4.5V10M15 8.2l2 2 2-2', 'g thick')
  : p('M9.5 3h-2A4.5 4.5 0 0 0 3 7.5V10M1 8.2l2 2 2-2', 'g thick');
const cropMarks = r(6, 6, 8, 8, 'bw') + p('M6 2.5V14h11.5', 'o thick') + p('M2.5 6H14v11.5', 'b thick');
const drop = p('M10 7.2c1.9 2.4 2.9 4 2.9 5.3a2.9 2.9 0 0 1-5.8 0c0-1.3 1-2.9 2.9-5.3z', 'bs glassy') + ci(9, 12.7, 0.6, 'glint');
const pill = (x, y, w, text) => r(x, y, w, 4.2, 'bs', 1.4) + t(x + w / 2, y + 3.2, text, 3.8, { weight: 700, c: 'txw' });
const fieldBox = (x = 2, y = 6, w = 16, h = 8) => r(x, y, w, h, 'of', 1.6);
const polygon = 'M3.5 7 10.5 2.5l6 5.5-2.5 9h-9z';
const diamond = (y, c) => p(`M10 ${y}l7.5 3.5-7.5 3.5-7.5-3.5z`, c);
const scanCorners = p('M2.5 6V3.5a1 1 0 0 1 1-1H6M14 2.5h2.5a1 1 0 0 1 1 1V6M17.5 14v2.5a1 1 0 0 1-1 1H14M6 17.5H3.5a1 1 0 0 1-1-1V14', 'b thick');
const speaker = p('M2.5 7.5h3l4-3.5v12l-4-3.5h-3z', 'bs') + ci(4.2, 8.6, 0.6, 'glint');
const pencil = (dx = 0, dy = 0) => `<g transform="translate(${dx} ${dy})">${p('M14.6 2.2l3.2 3.2-9.7 9.7-3.2-3.2z', 'bs') + p('M14.6 2.2l1-1 3.2 3.2-1 1', 'rf') + p('M4.9 11.9l3.2 3.2-5.3 2.1z', 'nf') + p('M3.6 15.7l.7.7-1.5.8z', 's')}</g>`;
const pen = (color, body) => `<g style="--pen-color: var(${color})">${body}</g>`;

const PDF = {
  /* Select and navigate */
  hand: p('M7.4 18c-1.7-1.4-2.9-3.4-3.9-5.1a1.2 1.2 0 0 1 2-1.3L6.6 13V5.6a1.2 1.2 0 0 1 2.4 0V10V3.9a1.2 1.2 0 0 1 2.4 0V10V4.7a1.2 1.2 0 0 1 2.4 0v5.6V6.6a1.2 1.2 0 0 1 2.4 0v5.9c0 3-1.6 5.5-4.6 5.5z', 'nf'),
  readMode: p('M10 5.5C8 4 5.5 3.4 2.5 3.7v11.8c3-.3 5.5.3 7.5 1.8z', 'of') + p('M10 5.5c2-1.5 4.5-2.1 7.5-1.8v11.8c-3-.3-5.5.3-7.5 1.8z', 'bf') + p('M10 5.5v11.8', 'o') + p('M4.5 7.2c1.3 0 2.5.2 3.5.7M4.5 10c1.3 0 2.5.2 3.5.7', 'o ln') + p('M12 7.9c1-.5 2.2-.7 3.5-.7M12 10.7c1-.5 2.2-.7 3.5-.7', 'b'),
  readAloud: speaker + p('M12.5 7.5a3.5 3.5 0 0 1 0 5M15 5a7 7 0 0 1 0 10', 'b thick'),

  /* Side panels */
  thumbnails: r(2.5, 2.5, 6.5, 7, 'of') + r(11, 2.5, 6.5, 7, 'bf') + r(2.5, 11, 6.5, 7, 'of') + r(11, 11, 6.5, 7, 'of') + r(11, 2.5, 6.5, 7, 'b thick', 1.6),
  outline: p('M2.5 3.6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5.2L4.5 7.4 2.5 8.8z', 'rs') + p('M9 5h8.5', 'o thick') + p('M4.5 11v6M4.5 13h3M4.5 17h3', 'o ln') + p('M9.5 13h8M9.5 17h8', 'o'),
  bookmark: p('M6.7 2.5h6.6a1.2 1.2 0 0 1 1.2 1.2V17.5L10 14l-4.5 3.5V3.7a1.2 1.2 0 0 1 1.2-1.2z', 'rs') + p('M7.6 4.6v5', 'wh ln'),
  attachments: page(3, 2.5, 11, 15) + lines(5, 8, 5, 3, 2.5) + p('M15.5 6.5v7a3 3 0 0 1-6 0V5.5a2 2 0 0 1 4 0v8a1 1 0 0 1-2 0V7.5', 'b thick'),
  layers: diamond(10.8, 'bs') + diamond(6.6, 'gs glassy') + diamond(2.5, 'nf glassy'),
  signatures: scrawl() + signLine + badge(14.5, 6, 'check', 'g'),
  documentProperties: page(4.5, 2.5, 11, 15) + lines(6.5, 6.5, 5, 3, 2) + badge(14.5, 14.5, 'info', 'b'),

  /* Comment and mark up */
  callout: r(7.5, 2.5, 10, 8, 'yf', 1.6) + lines(9.5, 5.3, 6, 2, 2.5, 'o') + p('M8.5 10.5 3.5 16', 'o') + ci(3.5, 16, 1.3, 's'),
  ellipse: '<ellipse class="bf" cx="10" cy="10" rx="7.5" ry="5.5"/>',
  stamp: p('M8.3 7.4h3.4l.9 4.3H7.4z', 'rs') + ci(10, 5, 2.8, 'rs') + ci(9.1, 4.1, 0.8, 'glint') + r(3, 11.5, 14, 3.5, 'of', 1.2) + p('M4.5 17.6h11', 'r thick'),
  measure: p('M2.5 13.5 13.5 2.5l4 4-11 11z', 'nf') + p('M5.4 10.6l1.5 1.5M7.6 8.4l1 1M9.8 6.2l1.5 1.5M12 4l1 1', 'o'),
  measureDistance: p('M4 16 16 4', 'b thick') + p('M2.5 14.5l3 3M14.5 2.5l3 3', 'o') + ci(4, 16, 1.3, 'bs') + ci(16, 4, 1.3, 'bs'),
  measurePerimeter: p(polygon, 'b thick') + [[3.5, 7], [10.5, 2.5], [16.5, 8], [14, 17], [5, 17]].map(([x, y]) => ci(x, y, 1.3, 'bs')).join(''),
  measureArea: p(polygon, 'bf') + p('M6 14.5 13 7.5M8.5 16 14.5 10M4.8 11 9.5 6.3', 'b ln'),

  /* Fill & Sign and digital IDs */
  sign: nib(13.2, 6.8) + scrawl() + signLine,
  certificate: r(2, 3, 16, 11, 'of', 1.6) + lines(4.5, 6.5, 6.5, 3, 2.5) + p('M12.2 13l-1.1 5.3 2.4-1.3 2.4 1.3-1.1-5.3z', 'rs') + ci(13.5, 11.5, 3.2, 'ns') + ci(13.5, 11.5, 1.9, 'yf') + ci(12.6, 10.5, 0.6, 'glint'),
  form: r(2.5, 2.5, 15, 15, 'of', 2) + p('M4.8 6h2.4M4.8 10.5h2.4', 'o') + r(8.8, 4.5, 6.7, 3, 'bf', 0.8) + r(8.8, 9, 6.7, 3, 'bf', 0.8) + r(4.6, 13.2, 3, 3, 'gs', 0.8) + p('M5.3 14.7l.7.7 1.2-1.4', 'wh') + p('M9 14.7h6', 'o ln'),
  fieldText: fieldBox() + p('M6 7.8v4.4M4.9 7.8h2.2M4.9 12.2h2.2', 'b thick') + p('M9 11.6h6', 'o ln'),
  fieldRadio: ci(10, 10, 6.5, 'of') + ci(10, 10, 3.6, 'bs') + ci(9, 9, 0.9, 'glint'),
  fieldListbox: r(3, 2.5, 14, 15, 'of', 1.6) + r(3, 7.4, 14, 4.2, 'bw') + p('M3 7.4h14M3 11.6h14', 'b ln') + lines(5, 5, 8, 4, 4.2, 'o ln') + p('M5 9.5h8', 'b'),
  fieldButton: r(2, 6, 16, 8, 'bs', 4) + p('M5.5 7.6h9', 'glint wh ln') + p('M7 10.4h6', 'wh thick'),
  fieldSignature: fieldBox(1.5, 4.5, 17, 11) + p('M3.6 6.7l1.6 1.6M5.2 6.7 3.6 8.3', 'o') + p('M4 12.2c1-2.6 2.2-4 2.9-3.4.8.6-1 3.3.2 3.6 1 .2 1.8-1.9 2.6-1.8.8.2.3 1.6 1 1.7.7.1 1.3-.6 1.9-1.1', 'b thick') + p('M3.6 13.6h12.8', 'o ln'),

  /* Edit and organize */
  edit: page(2.5, 2.5, 11, 15) + lines(4.5, 7, 5, 3, 2.5) + pencil(2, 1.2),
  organize: r(2.5, 2.5, 6.5, 7, 'of') + r(11, 2.5, 6.5, 7, 'of') + r(2.5, 11, 6.5, 7, 'of') + r(11, 11, 6.5, 7, 'gs', 1.6) + ci(12.6, 12.6, 0.7, 'glint'),
  combine: page(2, 2, 9, 12, 2.5) + lines(3.8, 7, 5, 3, 2) + page(9, 6, 9, 12, 2.5) + lines(10.8, 11, 5, 3, 2) + badge(4.5, 15.5, 'plus', 'p'),
  split: p('M5.7 2.5h6.8l3 3v3.3h-11V3.7a1.2 1.2 0 0 1 1.2-1.2z', 'of') + p('M12.5 2.5v3h3z', 'bf') + p('M4.5 11.2h11v5.1a1.2 1.2 0 0 1-1.2 1.2H5.7a1.2 1.2 0 0 1-1.2-1.2z', 'of') + p('M1.5 10h17', 'r dash'),
  pages: pages2,
  insertPages: pages2 + badge(15, 15, 'plus'),
  extract: page(2.5, 4.5, 10, 13, 2.5) + lines(4.5, 10, 5, 3, 2) + p('M9.5 10.5l7-7M11.8 3.5h4.7v4.7', 'b thick'),
  rotateCw: page(3, 5.5, 10, 12.5, 2.5) + rotateArrow(true),
  rotateCcw: page(7, 5.5, 10, 12.5, 2.5) + rotateArrow(false),
  crop: cropMarks,
  removeCrop: cropMarks + badge(15.5, 15.5, 'x', 'r', 3),
  watermark: page(4.5, 2.5, 11, 15) + drop,
  removeWatermark: page(3.5, 2.5, 11, 15) + p('M9 7.2c1.9 2.4 2.9 4 2.9 5.3a2.9 2.9 0 0 1-5.8 0c0-1.3 1-2.9 2.9-5.3z', 'bs glassy') + badge(15, 15, 'x', 'r'),
  pageNumbers: page(4.5, 2.5, 11, 15) + lines(6.5, 6.5, 7, 2, 2.5) + pill(7, 11.8, 6, '1'),
  bates: page(4.5, 2.5, 11, 15) + lines(6.5, 6.5, 7, 2, 2.5) + pill(6.5, 11.8, 7.5, '001'),
  background: page(4.5, 2.5, 11, 15) + p('M5.5 6.5h9v9.7a.8.8 0 0 1-.8.8H6.3a.8.8 0 0 1-.8-.8z', 'gw') + lines(7, 9, 6, 3, 2.5),
  flatten: diamond(2.5, 'of') + p('M10 10v3.2M8.3 11.5 10 13.2l1.7-1.7', 'b thick') + p('M10 14.2l7.5 2-7.5 2-7.5-2z', 'bs'),
  compress: page(4.5, 6, 11, 8, 2) + lines(6.5, 9.5, 7, 2, 2) + p('M10 .5v4M7.6 2.6 10 5l2.4-2.4M10 19.5v-4M7.6 17.4 10 15l2.4 2.4', 'r thick'),

  /* Protect, redact, recognize */
  redact: page(3.5, 2.5, 11, 15) + r(5.5, 6.5, 7.5, 2.6, 's', 0.6) + lines(5.5, 11, 6.5, 1) + r(5.5, 12.5, 5, 2.6, 's', 0.6) + badge(15, 15, 'minus', 'r'),
  ocr: scanCorners + t(10, 12.3, 'Abc', 7.5) + p('M1.5 14.6h17', 'r'),
  standards: page(3.5, 2.5, 11, 15) + lines(5.5, 7, 7, 3, 2.5) + badge(15, 15, 'check'),
  compare: r(1.5, 3, 8, 14, 'of', 1.6) + r(10.5, 3, 8, 14, 'of', 1.6) + lines(3, 6, 5, 4, 2.5) + lines(12, 6, 5, 4, 2.5) + r(3, 7.8, 5, 2, 'bs', 0.6) + r(12, 10.3, 5, 2, 'ns', 0.6),

  /* Create, convert, export */
  exportPdf: page(2.5, 2.5, 11, 15) + lines(4.5, 7, 5, 3, 2.5) + p('M9 10.6h4.2V8l4.8 4.2-4.8 4.2v-2.6H9z', 'bs'),
  convert: p('M4 6.5h10.5M12 4l2.5 2.5L12 9', 'b thick') + p('M16 13.5H5.5M8 11l-2.5 2.5L8 16', 'n thick'),
  exportDocx: exportDoc(tile(11, 10.5, 'b', p('M12.8 12.9h3.9M12.8 14.4h3.9M12.8 15.9h2.6', 'wh'))),
  exportXlsx: exportDoc(tile(11, 10.5, 'g', p('M12.6 13.1h4.3M12.6 15.4h4.3M14.75 12v5', 'wh'))),
  exportPptx: exportDoc(tile(11, 10.5, 'n', p('M14.75 14.25v-2.1a2.1 2.1 0 1 1-2.1 2.1z', 'txw') + p('M14.75 14.25h2.1', 'wh'))),
  exportRtf: exportDoc(tile(11, 10.5, 'p', t(14.75, 16.5, 'A', 5.8, { weight: 700, c: 'txw' }))),
  exportHtml: exportDoc(tile(11, 10.5, 'b', ci(14.75, 14.25, 2.3, 'wh') + p('M12.45 14.25h4.6M14.75 11.95c-1.2 1.4-1.2 3.2 0 4.6 1.2-1.4 1.2-3.2 0-4.6z', 'wh'))),
  exportTxt: exportDoc(tile(11, 10.5, null, lines(12.6, 12.9, 4.3, 3, 1.5, 'o'))),
  exportImage: exportDoc(tile(11, 10.5, 'g', p('M12.3 16.5l1.6-2 1.2 1.1 1-1 1.4 1.9z', 'txw') + ci(16.6, 12.8, 0.8, 'txw'))),
  batch: page(6.5, 1.5, 10, 13.5, 2.5) + page(3.5, 4.5, 10, 13.5, 2.5) + ci(15, 15, 4.3, 'knock') + ci(15, 15, 3.4, 'ns') + p('M14 13.2v3.6l2.9-1.8z', 'txw'),
  allTools: r(2.5, 2.5, 6.5, 6.5, 'bs', 1.8) + r(11, 2.5, 6.5, 6.5, 'gs', 1.8) + r(2.5, 11, 6.5, 6.5, 'ns', 1.8) + r(11, 11, 6.5, 6.5, 'rs', 1.8) + [[3.8, 3.8], [12.3, 3.8], [3.8, 12.3], [12.3, 12.3]].map(([x, y]) => ci(x + 0.3, y + 0.3, 0.6, 'glint')).join(''),
  fileText: page(4.5, 2.5, 11, 15) + lines(6.5, 8, 7, 4),
  addImage: SHARED.pictures + badge(15.5, 15.5, 'plus'),
  pageImage: SHARED.pictures + badge(15.5, 15.5, 'down', 'b'),
  cloud: p('M5.6 15.5a3.6 3.6 0 0 1-.5-7.2 5.2 5.2 0 0 1 9.9-1.2 4.2 4.2 0 0 1 .3 8.4z', 'bs') + ci(8.2, 8.6, 0.9, 'glint'),
  cloudUpload: p('M5.6 15.5a3.6 3.6 0 0 1-.5-7.2 5.2 5.2 0 0 1 9.9-1.2 4.2 4.2 0 0 1 .3 8.4z', 'bs') + p('M10 14V9.2M7.9 11.1 10 9l2.1 2.1', 'wh thick'),
  saveToFolder: SHARED.folderOpen + badge(15.5, 5, 'down', 'b', 3),
};

/**
 * Every name the app asks for that has a drawing: the Lucide names its menus, toolbars and panels
 * use for commands, and the tool names of the tools pane (shell/icons.js).
 */
export const GLASS_ICONS = {
  /* Lucide names (lib/ui.js icon()) */
  FolderOpen: SHARED.folderOpen,
  FolderInput: PDF.saveToFolder,
  Cloud: PDF.cloud,
  CloudUpload: PDF.cloudUpload,
  Save: SHARED.save,
  Download: SHARED.download,
  Upload: SHARED.share,
  Printer: SHARED.printer,
  Undo2: SHARED.undo,
  Redo2: SHARED.redo,
  Copy: SHARED.copy,
  Scissors: PDF.split,
  ZoomIn: SHARED.zoomIn,
  ZoomOut: SHARED.zoomOut,
  Image: SHARED.image,
  Images: SHARED.pictures,
  ImageDown: PDF.pageImage,
  MousePointer2: SHARED.inkSelect,
  Hand: PDF.hand,
  Type: SHARED.textBox,
  Highlighter: pen('--ico-yellow', SHARED.inkHighlighter),
  Pencil: pen('--ico-blue', SHARED.inkPencil),
  Square: SHARED.shapes,
  Circle: PDF.ellipse,
  StickyNote: SHARED.note,
  Signature: PDF.sign,
  ListChecks: PDF.form,
  Stamp: PDF.stamp,
  Link: SHARED.link,
  Unlink: SHARED.unlink,
  ExternalLink: SHARED.external,
  Lock: SHARED.lockSheet,
  LockOpen: SHARED.unprotect,
  Crop: PDF.crop,
  Expand: PDF.removeCrop,
  Droplets: PDF.watermark,
  Shrink: PDF.compress,
  Trash2: SHARED.deleteItem,
  RotateCw: PDF.rotateCw,
  RotateCcw: PDF.rotateCcw,
  FilePlus2: SHARED.filePlus,
  FileInput: PDF.insertPages,
  FileOutput: PDF.extract,
  Files: PDF.pages,
  FileText: PDF.fileText,
  BookOpen: PDF.readMode,
  Volume2: PDF.readAloud,
  Bookmark: PDF.bookmark,
  Layers: PDF.layers,
  ListTree: PDF.outline,
  LayoutGrid: PDF.thumbnails,
  MessageSquareText: SHARED.comment,
  Paperclip: PDF.attachments,
  Accessibility: SHARED.accessibility,
  Maximize: SHARED.fullscreen,
  Hash: PDF.pageNumbers,
  PanelTopBottomDashed: SHARED.headerFooter,
  RefreshCw: SHARED.reset,
  Bold: SHARED.bold,
  Italic: SHARED.italic,
  Underline: SHARED.underline,
  Strikethrough: SHARED.strike,
  /* Commands named by what they do (menu items and tools-pane commands) */
  find: SHARED.find,
  eraser: SHARED.eraser,
  sanitize: SHARED.eraser,
  cut: SHARED.cut,
  paste: SHARED.paste,
  calendar: SHARED.calendar,
  pdfFile: SHARED.fileDown,
  'sticky-note': SHARED.note,
  callout: PDF.callout,
  'field-text': PDF.fieldText,
  'field-checkbox': SHARED.checkbox,
  'field-radio': PDF.fieldRadio,
  'field-dropdown': SHARED.dropdown,
  'field-listbox': PDF.fieldListbox,
  'field-date': SHARED.calendar,
  'field-button': PDF.fieldButton,
  'field-signature': PDF.fieldSignature,
  'measure-distance': PDF.measureDistance,
  'measure-perimeter': PDF.measurePerimeter,
  'measure-area': PDF.measureArea,
  'export-docx': PDF.exportDocx,
  'export-xlsx': PDF.exportXlsx,
  'export-pptx': PDF.exportPptx,
  'export-rtf': PDF.exportRtf,
  'export-html': PDF.exportHtml,
  'export-txt': PDF.exportTxt,
  'export-image': PDF.exportImage,
  'remove-watermark': PDF.removeWatermark,
  'remove-header-footer': SHARED.headerFooter + badge(15, 15, 'x', 'r'),
  /* Tool names (shell/icons.js toolIcon()) */
  export: PDF.exportPdf,
  edit: PDF.edit,
  create: SHARED.filePlus,
  combine: PDF.combine,
  organize: PDF.organize,
  comment: SHARED.comment,
  'fill-sign': PDF.sign,
  certificate: PDF.certificate,
  ocr: PDF.ocr,
  protect: SHARED.lockSheet,
  redact: PDF.redact,
  compress: PDF.compress,
  form: PDF.form,
  compare: PDF.compare,
  accessibility: SHARED.accessibility,
  stamp: PDF.stamp,
  watermark: PDF.watermark,
  'header-footer': SHARED.headerFooter,
  bates: PDF.bates,
  'page-numbers': PDF.pageNumbers,
  background: PDF.background,
  batch: PDF.batch,
  standards: PDF.standards,
  print: SHARED.printer,
  split: PDF.split,
  'insert-pages': PDF.insertPages,
  extract: PDF.extract,
  rotate: PDF.rotateCw,
  crop: PDF.crop,
  link: SHARED.link,
  'add-text': SHARED.textBox,
  'add-image': PDF.addImage,
  measure: PDF.measure,
  flatten: PDF.flatten,
  'read-aloud': PDF.readAloud,
  attachments: PDF.attachments,
  layers: PDF.layers,
  signatures: PDF.signatures,
  'document-properties': SHARED.pageSetup,
  'all-tools': PDF.allTools,
  convert: PDF.convert,
};

export const hasGlassIcon = (name) => Object.hasOwn(GLASS_ICONS, name);

/** The icon as markup, as the Spreadsheet's officeIcon() returns it; null when there is no drawing. */
export function glassIconMarkup(name, size = 18) {
  const body = GLASS_ICONS[name];
  if (body == null) return null;
  return `<svg class="ico" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="${size}" height="${size}" aria-hidden="true" focusable="false">${body}</svg>`;
}

const NS = 'http://www.w3.org/2000/svg';
/** The icon as an <svg> element, for the DOM helpers; null when there is no drawing. */
export function glassIcon(name, size = 18) {
  const body = GLASS_ICONS[name];
  if (body == null) return null;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = body;
  return svg;
}

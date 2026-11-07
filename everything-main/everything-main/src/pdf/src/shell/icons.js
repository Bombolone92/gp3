/**
 * Original two-tone tool icons. Each glyph is drawn on a 24-unit grid: the outline uses the
 * current text color and one accent shape takes the tool's own color, so the tool list reads
 * as a set of colored tools without borrowing anyone's artwork.
 */
import { glassIcon } from '../lib/glass-icons.js';

const NS = 'http://www.w3.org/2000/svg';

/** A page with a folded corner, the base of most document tools. */
const PAGE = 'M6.5 2.75h7.75l4.25 4.25v14.25H6.5z M14.25 2.75V7h4.25';
const SMALL_PAGE = 'M4.75 4.75h6.5l3 3v10.5h-9.5z';

/**
 * name: [outline path(s), accent path(s), accent kind]. The accent kind is "fill" for solid
 * shapes and "stroke" for lines drawn in the accent color.
 */
const GLYPHS = {
  export: [PAGE, 'M11 14.5h9.25 M17.25 11.5l3 3-3 3', 'stroke'],
  edit: [PAGE, 'M10 18.5l.6-2.6 6.9-6.9 2 2-6.9 6.9z', 'fill'],
  create: [PAGE, 'M12.5 11v7 M9 14.5h7', 'stroke'],
  combine: [
    'M3.75 6.75h6.5v10.5h-6.5z M13.75 6.75h6.5v10.5h-6.5z',
    'M8.5 12h7 M13.25 9.75 15.5 12l-2.25 2.25',
    'stroke',
  ],
  organize: ['M4 4h6.5v7H4z M13.5 4H20v7h-6.5z M4 13.5h6.5v7H4z', 'M13.5 13.5H20v7h-6.5z', 'fill'],
  comment: [
    'M4 5.5A1.75 1.75 0 0 1 5.75 3.75h12.5A1.75 1.75 0 0 1 20 5.5v9a1.75 1.75 0 0 1-1.75 1.75H10l-4.5 4v-4H5.75A1.75 1.75 0 0 1 4 14.5z',
    'M8 8.25h8 M8 11.75h5',
    'stroke',
  ],
  'fill-sign': [
    'M3.5 20.25h17',
    'M6 16.5c2.2-4.5 3.6-6.5 4.6-6.2 1.2.4-1.6 6 .2 6.2 1.4.1 2.6-3.3 3.7-3.1.9.2.3 2.6 1.4 2.7.8.1 1.5-1 2.1-1.6',
    'stroke',
  ],
  certificate: [
    'M4.5 4.25h15v11h-15z M7.5 8h6 M7.5 11h4',
    'M16.5 13.25a2.5 2.5 0 1 1 0 .01z M15.25 15.5l-.75 4.25 2-1.25 2 1.25-.75-4.25',
    'fill',
  ],
  ocr: [
    'M3.75 8V4.75a1 1 0 0 1 1-1H8 M16 3.75h3.25a1 1 0 0 1 1 1V8 M20.25 16v3.25a1 1 0 0 1-1 1H16 M8 20.25H4.75a1 1 0 0 1-1-1V16',
    'M8.5 8.25h7 M12 8.25v7.5',
    'stroke',
  ],
  protect: [
    'M12 3.25 19 6v5.5c0 4.5-3 7.75-7 9.25-4-1.5-7-4.75-7-9.25V6z',
    'M10.25 11.25V10a1.75 1.75 0 0 1 3.5 0v1.25 M9.25 11.25h5.5v4h-5.5z',
    'stroke',
  ],
  redact: [PAGE, 'M9 10.25h6.75v2.5H9z M9 15h4.5v2.5H9z', 'fill'],
  compress: [PAGE, 'M12.5 9v4 M10.5 11l2 2 2-2 M12.5 20v-3.5 M10.5 18.5l2-2 2 2', 'stroke'],
  form: [
    'M4 4.25h16v15.5H4z M7 8h4 M7 12.25h4 M7 16.25h4',
    'M13 7h4v2h-4z M13 11.25h4v2h-4z M13 15.25h4v2h-4z',
    'fill',
  ],
  compare: [
    'M3.75 4.75h6.5v14.5h-6.5z M13.75 4.75h6.5v14.5h-6.5z',
    'M6 9h2 M6 12h2 M16 9h2 M16 14.5h2',
    'stroke',
  ],
  accessibility: [
    'M12 3.25a8.75 8.75 0 1 1 0 17.5 8.75 8.75 0 0 1 0-17.5z',
    'M12 6.5a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z M7.5 10.5 12 11.5l4.5-1 M12 11.5V14l-2 3.75 M12 14l2 3.75',
    'stroke',
  ],
  stamp: ['M4.5 15.5h15v3h-15z M5.5 20.5h13', 'M9.5 15.5l.75-5a2.5 2.5 0 1 1 3.5 0l.75 5z', 'fill'],
  watermark: [
    PAGE,
    'M12.5 9.5c1.8 2.3 2.75 3.9 2.75 5.1a2.75 2.75 0 0 1-5.5 0c0-1.2.95-2.8 2.75-5.1z',
    'fill',
  ],
  'header-footer': [PAGE, 'M8.75 5.25h4 M8.75 18.75h7.5', 'stroke'],
  bates: [PAGE, 'M10.5 10.5 9.75 18 M14.25 10.5 13.5 18 M8.75 12.75h6.5 M8.5 15.75h6.5', 'stroke'],
  'page-numbers': [PAGE, 'M14.5 16.25v-4.5l-1.25.75 M13.25 16.25h2.5', 'stroke'],
  background: [PAGE, 'M7.75 21.25V12.5l5.5-3.5 5.25 4v8.25z', 'fill'],
  batch: ['M4 5.25h11 M4 9.75h11 M4 14.25h7', 'M14.5 13.25v7.5l6-3.75z', 'fill'],
  standards: [PAGE, 'M9.25 14.25l2.25 2.25 4.25-4.5', 'stroke'],
  print: [
    'M7 8.25V3.75h10v4.5 M5.5 17.25H4.25V9.75a1.5 1.5 0 0 1 1.5-1.5h12.5a1.5 1.5 0 0 1 1.5 1.5v7.5H18.5',
    'M7 14h10v6.25H7z',
    'fill',
  ],
  split: [PAGE, 'M4 13h2.25 M8.25 13h2.5 M12.75 13h2.5 M17.25 13h3', 'stroke'],
  'insert-pages': ['M4.25 4.75h8.5v14.5h-8.5z', 'M17.25 8.75v6.5 M14 12h6.5', 'stroke'],
  extract: [SMALL_PAGE, 'M13.75 12.75h6.5 M17.25 9.75l3 3-3 3', 'stroke'],
  rotate: [PAGE, 'M15.5 13a3 3 0 1 1-1-2.25 M15.5 9.5v2h-2', 'stroke'],
  crop: ['M7 3.25V17h13.75 M3.25 7H17v13.75', 'M10 10h4v4h-4z', 'fill'],
  link: [
    'M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1',
    'M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1',
    'stroke',
  ],
  'add-text': ['M4.25 4.25h15.5v15.5H4.25z', 'M8.25 8.25h7.5 M12 8.25v8', 'stroke'],
  'add-image': [
    'M3.75 5.25h16.5v13.5H3.75z',
    'M5.75 16.75l4.25-4.5 3 3 2-2 3.25 3.5z M15.5 8.25a1.25 1.25 0 1 1 0 .01z',
    'fill',
  ],
  measure: [
    'M3.5 15.5 15.5 3.5l5 5-12 12z',
    'M7.5 14.5l1.5 1.5 M10 12l1.5 1.5 M12.5 9.5 14 11 M15 7l1.5 1.5',
    'stroke',
  ],
  flatten: [
    'M12 3.5 20.5 8 12 12.5 3.5 8z',
    'M3.5 12.25 12 16.75l8.5-4.5 M3.5 16.25 12 20.75l8.5-4.5',
    'stroke',
  ],
  'read-aloud': [
    'M4 9.5h3.25L11.5 6v12l-4.25-3.5H4z',
    'M15 9a4.25 4.25 0 0 1 0 6 M17.5 6.5a7.75 7.75 0 0 1 0 11',
    'stroke',
  ],
  attachments: [
    'M17.5 11.5 11 18a4 4 0 0 1-5.66-5.66l7.07-7.07a2.75 2.75 0 0 1 3.9 3.9l-6.72 6.72a1.5 1.5 0 0 1-2.12-2.12L13.5 7.75',
    '',
    'stroke',
  ],
  layers: ['M12 3.5 20.5 8 12 12.5 3.5 8z', 'M3.5 12.25 12 16.75l8.5-4.5', 'stroke'],
  signatures: ['M3.5 20.25h17', 'M6 16.25 15.75 6.5l2.25 2.25-9.75 9.75H6z', 'fill'],
  'document-properties': [PAGE, 'M12.5 11.75v5 M12.5 9.25v.01', 'stroke'],
  'all-tools': [
    'M4.5 4.5h6v6h-6z M13.5 4.5h6v6h-6z M4.5 13.5h6v6h-6z',
    'M16.5 13.25v6.5 M13.25 16.5h6.5',
    'stroke',
  ],
  convert: [
    'M4.25 6.75h11.5 M12.5 3.5l3.25 3.25-3.25 3.25',
    'M19.75 17.25H8.25 M11.5 20.5l-3.25-3.25L11.5 14',
    'stroke',
  ],
};

/** Accent colors, chosen for contrast on white and on the dark theme's panels. */
export const TOOL_COLORS = {
  export: '#d43f8d',
  edit: '#e0457b',
  create: '#dc3c3c',
  combine: '#7a5af5',
  organize: '#2d9d5c',
  comment: '#e6a10a',
  'fill-sign': '#7a5af5',
  certificate: '#2f7bd9',
  ocr: '#2d9d5c',
  protect: '#5a62e6',
  redact: '#dc3c3c',
  compress: '#dc3c3c',
  form: '#8e4fd6',
  compare: '#2f7bd9',
  accessibility: '#2f7bd9',
  stamp: '#e6a10a',
  watermark: '#2f9cc7',
  'header-footer': '#e0457b',
  bates: '#5a62e6',
  'page-numbers': '#5a62e6',
  background: '#2d9d5c',
  batch: '#e07a1f',
  standards: '#2d9d5c',
  print: '#5f6b7a',
  split: '#2d9d5c',
  'insert-pages': '#2d9d5c',
  extract: '#2d9d5c',
  rotate: '#2d9d5c',
  crop: '#e0457b',
  link: '#2f7bd9',
  'add-text': '#e0457b',
  'add-image': '#e0457b',
  measure: '#e07a1f',
  flatten: '#5f6b7a',
  'read-aloud': '#2f7bd9',
  attachments: '#5f6b7a',
  layers: '#5f6b7a',
  signatures: '#7a5af5',
  'document-properties': '#5f6b7a',
  'all-tools': '#dc3c3c',
  convert: '#d43f8d',
};

export const hasToolIcon = (name) => name in GLYPHS;

/** An inline SVG for a tool. `color: false` draws the accent in the text color too. */
export function toolIcon(name, size = 20, { color = true } = {}) {
  // Tools drawn in the glass set (lib/glass-icons.js) use that drawing; the two-tone glyphs
  // below remain for any other name, and for a monochrome request.
  const glass = color && glassIcon(name, size);
  if (glass) {
    glass.classList.add('tool-icon');
    return glass;
  }
  const [outline, accent, kind] = GLYPHS[name] || GLYPHS.edit;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'tool-icon');
  const tint = color ? TOOL_COLORS[name] || 'currentColor' : 'currentColor';
  const line = document.createElementNS(NS, 'path');
  line.setAttribute('d', outline);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'currentColor');
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-linejoin', 'round');
  line.setAttribute('stroke-linecap', 'round');
  svg.append(line);
  if (accent) {
    const mark = document.createElementNS(NS, 'path');
    mark.setAttribute('d', accent);
    mark.setAttribute('stroke-linejoin', 'round');
    mark.setAttribute('stroke-linecap', 'round');
    if (kind === 'fill') {
      mark.setAttribute('fill', tint);
      mark.setAttribute('stroke', tint);
      mark.setAttribute('stroke-width', '1');
    } else {
      mark.setAttribute('fill', 'none');
      mark.setAttribute('stroke', tint);
      mark.setAttribute('stroke-width', '1.75');
    }
    svg.append(mark);
  }
  return svg;
}

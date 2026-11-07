// Icons: Lucide for general actions plus original drawings for design tools,
// drawn on the same 24 unit grid with round strokes so they sit together.

import {
  createElement, FilePlus, FolderOpen, Save, Undo2, Redo2, Search, Sun, Moon, Monitor, LogIn, LogOut, User, X, Plus, Minus,
  ChevronDown, ChevronRight, ChevronLeft, ChevronUp, Check, Settings, Layers, Eye, EyeOff, Lock, Unlock, Trash2, Copy, Scissors,
  ClipboardPaste, MousePointer2, Move, RotateCw, RotateCcw, FlipHorizontal2, FlipVertical2, ZoomIn, ZoomOut, Maximize, Grid3x3,
  Magnet, Ruler, Type, Box, Cpu, Download, Upload, Share2, Printer, FileText, FileCode, Files, File, Folder, Info, TriangleAlert,
  CircleAlert, CircleCheck, CircleX, Menu, PanelLeft, PanelRight, PanelBottom, Ellipsis, Keyboard, CircleHelp, Command, Pencil,
  Square, Circle, Crosshair, Filter, ListTree, List, Table, Package, Library, WandSparkles, History, Cloud, CloudOff, HardDrive,
  ExternalLink, GripVertical, Highlighter, AlignStartVertical, LayoutGrid, Hash, Tag, RefreshCw, ListChecks, ShieldCheck, Network,
  Image, Focus, Orbit,
} from 'lucide';

const LUCIDE = {
  new: FilePlus, open: FolderOpen, save: Save, undo: Undo2, redo: Redo2, search: Search, sun: Sun, moon: Moon, monitor: Monitor,
  login: LogIn, logout: LogOut, user: User, x: X, plus: Plus, minus: Minus, 'chevron-down': ChevronDown, 'chevron-right': ChevronRight,
  'chevron-left': ChevronLeft, 'chevron-up': ChevronUp, check: Check, settings: Settings, layers: Layers, eye: Eye, 'eye-off': EyeOff,
  lock: Lock, unlock: Unlock, trash: Trash2, copy: Copy, cut: Scissors, paste: ClipboardPaste, pointer: MousePointer2, move: Move,
  'rotate-cw': RotateCw, 'rotate-ccw': RotateCcw, 'flip-h': FlipHorizontal2, 'flip-v': FlipVertical2, 'zoom-in': ZoomIn,
  'zoom-out': ZoomOut, fit: Maximize, grid: Grid3x3, magnet: Magnet, ruler: Ruler, text: Type, cube: Box, chip: Cpu,
  download: Download, upload: Upload, share: Share2, print: Printer, 'file-text': FileText, 'file-code': FileCode, files: Files,
  file: File, folder: Folder, info: Info, warning: TriangleAlert, error: CircleAlert, ok: CircleCheck, 'circle-x': CircleX,
  menu: Menu, 'panel-left': PanelLeft, 'panel-right': PanelRight, 'panel-bottom': PanelBottom, more: Ellipsis, keyboard: Keyboard,
  help: CircleHelp, command: Command, pencil: Pencil, square: Square, circle: Circle, crosshair: Crosshair, filter: Filter,
  tree: ListTree, list: List, table: Table, package: Package, library: Library, wand: WandSparkles, history: History,
  cloud: Cloud, 'cloud-off': CloudOff, drive: HardDrive, external: ExternalLink, grip: GripVertical, highlight: Highlighter,
  align: AlignStartVertical, 'layout-grid': LayoutGrid, hash: Hash, tag: Tag, refresh: RefreshCw, 'list-checks': ListChecks,
  shield: ShieldCheck, network: Network, image: Image, focus: Focus, orbit: Orbit,
};

const p = (d, extra = {}) => ['path', { d, ...extra }];
const c = (cx, cy, r, extra = {}) => ['circle', { cx, cy, r, ...extra }];
const filled = { fill: 'currentColor', stroke: 'none' };

/** Original tool icons. */
const ORIGINAL = {
  wire: [p('M3 18h8V6h10'), c(3, 18, 1.6, filled), c(21, 6, 1.6, filled)],
  bus: [p('M3 17h8V7h10', { 'stroke-width': 3.5 })],
  part: [p('M8 4h8v16H8z'), p('M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4'), c(10.5, 6.5, 0.9, filled)],
  power: [p('M12 21V10'), p('M6 10h12'), p('M9 6.5l3-3.5 3 3.5')],
  ground: [p('M12 3v9'), p('M5 12h14'), p('M8 15.5h8'), p('M10.5 19h3')],
  'net-label': [p('M3 19h18'), p('M7 15V6l6 9V6'), p('M16 15h4')],
  port: [p('M3 7.5h12l5 4.5-5 4.5H3z'), p('M7 12h5')],
  junction: [p('M3 12h18M12 3v18'), c(12, 12, 3, filled)],
  'no-erc': [p('M6 6l12 12M18 6L6 18')],
  'sheet-entry': [p('M4 4h16v16H4z'), p('M4 12h6l2 2-2 2H4')],
  route: [p('M4 21v-6l6-6h10'), c(4, 21, 1.8), c(20, 9, 1.8), p('M14 3.5l2 2')],
  'route-diff': [p('M3 20v-5l5-5h12'), p('M7 21v-4l4-4h9')],
  via: [c(12, 12, 7), c(12, 12, 2.6)],
  pad: [['rect', { x: 4, y: 7, width: 16, height: 10, rx: 2.5 }], c(12, 12, 2)],
  pour: [p('M4 6l9-2 7 6-2 10H6z'), p('M8 9l-2 2M12 8l-5.5 5.5M16 8.5l-9 9M18.5 10.5L10 19M18 15l-4 4')],
  fill: [['rect', { x: 4, y: 6, width: 16, height: 12, rx: 1 }], p('M4 12l6-6M4 18L16 6M10 18l10-10M16 18l4-4')],
  region: [p('M5 5h10l4 6-3 8H5z')],
  keepout: [['rect', { x: 4, y: 4, width: 16, height: 16, rx: 1, 'stroke-dasharray': '3 2.5' }], p('M9 9l6 6M15 9l-6 6')],
  board: [p('M5 4h11l3 3v13H5z'), c(8, 7.5, 1.2), c(16, 17, 1.2)],
  dimension: [p('M4 6v12M20 6v12'), p('M4 12h16'), p('M7 9.5L4 12l3 2.5M17 9.5l3 2.5-3 2.5')],
  component: [['rect', { x: 7, y: 6, width: 10, height: 12, rx: 1 }], p('M4 9h3M4 12h3M4 15h3M17 9h3M17 12h3M17 15h3'), c(9.5, 8.5, 0.9, filled)],
  'arc-tool': [p('M4 19A15 15 0 0 1 19 4')],
  'line-tool': [p('M5 19L19 5')],
  measure: [p('M3 17l14-14 4 4L7 21z'), p('M7 13l2 2M10 10l2 2M13 7l2 2')],
  drc: [p('M4 4h12v8'), p('M4 4v16h7'), p('M14 18l2.5 2.5L21 15')],
  erc: [p('M13 3L6 13h5l-1 8 7-10h-5z')],
  gerber: [p('M12 3l9 4.5-9 4.5-9-4.5z'), p('M3 12l9 4.5 9-4.5'), p('M3 16.5L12 21l9-4.5')],
  'view-2d': [['rect', { x: 4, y: 4, width: 16, height: 16, rx: 1.5 }], p('M4 10h16M10 4v16')],
  'select-rect': [['rect', { x: 4, y: 4, width: 16, height: 16, rx: 1, 'stroke-dasharray': '3 2.5' }]],
  autoroute: [p('M3 20v-5l5-5h6'), p('M14 10h7'), p('M17 3l.8 1.7L19.5 5.5l-1.7.8L17 8l-.8-1.7-1.7-.8 1.7-.8z', filled)],
  annotate: [p('M3 8.5V4h4.5L20 16.5 16.5 20z'), p('M9 11l2-2M11.5 13.5l2-2')],
  ratsnest: [c(5, 6, 2), c(19, 8, 2), c(9, 19, 2), p('M7 6.4l10 1.2M6.5 8l1.8 9M17.6 9.6l-7 8', { 'stroke-dasharray': '2 2' })],
  'single-layer': [p('M12 4l9 4.5-9 4.5-9-4.5z'), p('M3 15.5l9 4.5 9-4.5', { 'stroke-dasharray': '2 2.5' })],
  flip: [p('M12 3v18'), p('M8 7L4 12l4 5z'), p('M16 7l4 5-4 5z', filled)],
  'highlight-net': [p('M3 16h5l3-8h10'), c(14, 8, 2.2, filled)],
  'cross-probe': [p('M4 12h7'), p('M13 12h7'), p('M9 8l4 4-4 4'), c(4, 12, 1.5, filled), c(20, 12, 1.5, filled)],
  sync: [p('M4 9a8 8 0 0 1 14-3l2 2'), p('M20 4v4h-4'), p('M20 15a8 8 0 0 1-14 3l-2-2'), p('M4 20v-4h4')],
  bom: [p('M6 3h9l4 4v14H6z'), p('M9 11h6M9 14h6M9 17h4')],
  symbol: [p('M6 5h12v14H6z'), p('M2 9h4M2 15h4M18 12h4')],
  footprint: [['rect', { x: 5, y: 3, width: 6, height: 7, rx: 1 }], ['rect', { x: 13, y: 3, width: 6, height: 7, rx: 1 }], ['rect', { x: 5, y: 14, width: 6, height: 7, rx: 1 }], ['rect', { x: 13, y: 14, width: 6, height: 7, rx: 1 }]],
  pin: [p('M3 12h11'), c(17, 12, 3), c(3, 12, 1.4, filled)],
  'layer-up': [p('M12 4l9 4.5-9 4.5-9-4.5z'), p('M12 21v-6M9 18l3 3 3-3')],
  github: null,
};

const GITHUB_PATH = 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z';

function githubMark(size) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', GITHUB_PATH);
  svg.append(path);
  return svg;
}

/** Creates an icon element; the parent control carries the accessible name. */
export function icon(name, size = 16, extraClass = '') {
  let el;
  if (name === 'github') el = githubMark(size);
  else {
    const node = ORIGINAL[name] ? ['svg', {}, ORIGINAL[name]] : null;
    el = createElement(node ? ORIGINAL[name] : LUCIDE[name] || Square);
    if (node) {
      el.setAttribute('viewBox', '0 0 24 24');
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', 'currentColor');
      el.setAttribute('stroke-linecap', 'round');
      el.setAttribute('stroke-linejoin', 'round');
    }
    el.setAttribute('stroke-width', '1.75');
  }
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  el.setAttribute('class', `icon${extraClass ? ` ${extraClass}` : ''}`);
  return el;
}

export const hasIcon = (name) => !!(ORIGINAL[name] || LUCIDE[name] || name === 'github');

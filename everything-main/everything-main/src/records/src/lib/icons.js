/**
 * Icons are Lucide (ISC license), imported by name so only what is used
 * ships. icon('name') returns an inline SVG hidden from screen readers
 * (buttons carry their own names); iconImage() gives a cached image of an
 * icon in a color, for painting on the grid canvas.
 */
import * as L from 'lucide';

const SET = {
  // Field types
  fText: L.Type, fLongText: L.TextAlignStart, fAttachment: L.Paperclip, fCheckbox: L.SquareCheck, fMulti: L.ListChecks,
  fSingle: L.CircleChevronDown, fDate: L.Calendar, fPhone: L.Phone, fEmail: L.Mail, fUrl: L.Globe, fNumber: L.Hash,
  fCurrency: L.DollarSign, fPercent: L.Percent, fDuration: L.Timer, fRating: L.Star, fBarcode: L.ScanBarcode, fLink: L.ArrowLeftRight,
  fLookup: L.TextSearch, fRollup: L.Sigma, fCount: L.Tally5, fFormula: L.SquareFunction, fAutonumber: L.ListOrdered,
  fCreatedTime: L.CalendarClock, fModifiedTime: L.History, fCreatedBy: L.UserRound, fModifiedBy: L.UserPen, fButton: L.MousePointerClick,
  // Views
  vGrid: L.Sheet, vKanban: L.SquareKanban, vCalendar: L.CalendarDays, vGallery: L.LayoutGrid, vTimeline: L.ChartGantt, vList: L.ListTree, vForm: L.ClipboardList,
  // Interface
  plus: L.Plus, search: L.Search, x: L.X, check: L.Check, chevronDown: L.ChevronDown, chevronRight: L.ChevronRight, chevronLeft: L.ChevronLeft,
  chevronUp: L.ChevronUp, arrowUpDown: L.ArrowUpDown, arrowUp: L.ArrowUp, arrowDown: L.ArrowDown, arrowLeft: L.ArrowLeft, arrowRight: L.ArrowRight,
  eyeOff: L.EyeOff, eye: L.Eye, filter: L.ListFilter, group: L.Rows3, rowHeight: L.Rows2, color: L.PaintBucket, palette: L.Palette, share: L.Share2,
  download: L.Download, upload: L.Upload, more: L.Ellipsis, moreVertical: L.EllipsisVertical, grip: L.GripVertical, gripH: L.GripHorizontal,
  trash: L.Trash2, copy: L.Copy, pencil: L.Pencil, expand: L.Maximize2, collapse: L.Minimize2, undo: L.Undo2, redo: L.Redo2, menu: L.Menu,
  panelLeft: L.PanelLeft, panelLeftClose: L.PanelLeftClose, home: L.House, settings: L.Settings, sun: L.Sun, moon: L.Moon, monitor: L.Monitor,
  logOut: L.LogOut, keyboard: L.Keyboard, help: L.CircleHelp, info: L.Info, alert: L.TriangleAlert, cloud: L.Cloud, cloudOff: L.CloudOff,
  cloudCheck: L.CloudCheck, refresh: L.RefreshCw, loader: L.Loader, star: L.Star, starOff: L.StarOff, restore: L.ArchiveRestore, archive: L.Archive,
  inbox: L.Inbox, fileText: L.FileText, fileSpreadsheet: L.FileSpreadsheet, fileUp: L.FileUp, fileDown: L.FileDown, image: L.Image, file: L.File,
  lock: L.Lock, unlock: L.LockOpen, freeze: L.Snowflake, enter: L.CornerDownLeft, columns: L.Columns3, database: L.Database, table: L.Table,
  printer: L.Printer, external: L.ExternalLink, layers: L.Layers, sparkles: L.Sparkles, wrap: L.WrapText, minus: L.Minus, message: L.MessageSquareText,
  send: L.Send, circle: L.Circle, circlePlus: L.CirclePlus, arrowUpRight: L.ArrowUpRight, listPlus: L.ListPlus, template: L.LayoutTemplate,
  clock: L.Clock, link: L.Link, insertLeft: L.ArrowLeftToLine, insertRight: L.ArrowRightToLine, insertAbove: L.ArrowUpToLine, insertBelow: L.ArrowDownToLine,
  sortAsc: L.ArrowDownAZ, sortDesc: L.ArrowDownZA, user: L.CircleUser, heart: L.Heart, thumbsUp: L.ThumbsUp, flag: L.Flag, smile: L.Smile, zap: L.Zap,
  bell: L.Bell, sigma: L.Sigma, clipboard: L.ClipboardPaste, scissors: L.Scissors, play: L.Play, today: L.CalendarCheck, move: L.Move,
};

/** Icons offered for bases, in picker order. */
export const BASE_ICONS = [
  'table', 'database', 'rocket', 'briefcase', 'users', 'package', 'shoppingCart', 'megaphone', 'clapperboard', 'bookOpen', 'graduationCap',
  'heartPulse', 'wrench', 'building', 'target', 'zap', 'lightbulb', 'flag', 'calendar', 'checklist', 'truck', 'plane', 'chart', 'wallet',
  'receipt', 'calculator', 'heart', 'music', 'camera', 'film', 'gamepad', 'globe', 'map', 'tag', 'bell', 'clock', 'code', 'palette', 'star', 'inbox',
];

const BASE = {
  table: L.Table, database: L.Database, rocket: L.Rocket, briefcase: L.Briefcase, users: L.Users, package: L.Package, shoppingCart: L.ShoppingCart,
  megaphone: L.Megaphone, clapperboard: L.Clapperboard, bookOpen: L.BookOpen, graduationCap: L.GraduationCap, heartPulse: L.HeartPulse,
  wrench: L.Wrench, building: L.Building2, target: L.Target, zap: L.Zap, lightbulb: L.Lightbulb, flag: L.Flag, calendar: L.Calendar,
  checklist: L.ListTodo, truck: L.Truck, plane: L.Plane, chart: L.ChartColumn, wallet: L.Wallet, receipt: L.Receipt, calculator: L.Calculator,
  heart: L.Heart, music: L.Music, camera: L.Camera, film: L.Film, gamepad: L.Gamepad2, globe: L.Globe, map: L.Map, tag: L.Tag, bell: L.Bell,
  clock: L.Clock, code: L.Code, palette: L.Palette, star: L.Star, inbox: L.Inbox,
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function nodeFor(name) {
  return SET[name] || BASE[name] || null;
}

export function hasIcon(name) {
  return !!nodeFor(name);
}

/** The GitHub mark, filled (brand icons are not part of Lucide). */
const GITHUB_PATH = 'M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57l-.02-2.04c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.42.36.81 1.1.81 2.22l-.01 3.29c0 .31.2.69.82.57A12 12 0 0 0 12 .3';

export function githubIcon(size = 16) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'icon');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', GITHUB_PATH);
  svg.appendChild(path);
  return svg;
}

export const REPO_URL = 'https://github.com/HeyPuter/everything';

/** An inline SVG icon element. */
export function icon(name, size = 16, opts = {}) {
  if (name === 'github') return githubIcon(size);
  const node = nodeFor(name) || L.Circle;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', opts.fill || 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', opts.strokeWidth || 2);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon${opts.className ? ` ${opts.className}` : ''}`);
  for (const [tag, attrs] of node) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}

function escapeAttr(v) {
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** SVG markup for an icon, for images. */
export function iconMarkup(name, color = '#000', size = 16, { fill = 'none', strokeWidth = 2 } = {}) {
  const node = nodeFor(name) || L.Circle;
  const inner = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ')}/>`).join('');
  return `<svg xmlns="${SVG_NS}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

const images = new Map();

/**
 * An image of an icon for canvas drawing. Returns null until it has loaded;
 * onLoad runs once it is ready (to repaint).
 */
export function iconImage(name, color, size, onLoad, opts) {
  // Drawn at the screen's density (at least twice the size) to stay sharp.
  const scale = Math.max(2, Math.ceil(globalThis.devicePixelRatio || 1));
  const key = `${name}|${color}|${size}|${scale}|${opts?.fill || ''}|${opts?.strokeWidth || ''}`;
  let entry = images.get(key);
  if (!entry) {
    const img = new Image();
    entry = { img, ready: false, waiters: new Set() };
    images.set(key, entry);
    img.onload = () => {
      entry.ready = true;
      for (const fn of entry.waiters) fn();
      entry.waiters.clear();
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconMarkup(name, color, size * scale, opts))}`;
  }
  if (entry.ready) return entry.img;
  if (onLoad) entry.waiters.add(onLoad);
  return null;
}

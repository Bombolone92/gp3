/**
 * Icons: Lucide (ISC license) for UI chrome, rendered as inline SVG so they
 * inherit currentColor and scale with text. Only the icons listed here are
 * bundled; Lucide's ESM build is tree-shaken.
 */
import {
  createElement,
  CircleDot, SquareCheck, SquareChevronDown, Star, Gauge, Grid3x3, SlidersHorizontal, ListOrdered,
  TextCursorInput, AlignLeft, Rows3, Contact, CalendarClock, Type,
  Plus, Search, X, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Ellipsis, EllipsisVertical, Pencil,
  Trash2, Sun, Moon, Monitor, LogOut, Check, Copy, ExternalLink, Eye, Folder, FolderPlus, FolderOpen,
  LayoutTemplate, Sparkles, Upload, Download, Link, QrCode, Code, Settings, Palette, GitBranch,
  Undo2, Redo2, GripVertical, ArrowUp, ArrowDown, FileText, ChartBar, ChartColumn, ChartPie, Table, Filter,
  Users, Clock, Lock, Share2, Send, CircleAlert, CircleCheck, Info, Keyboard, Menu, Smartphone, Tablet, Laptop,
  RefreshCw, Heart, ThumbsUp, Circle, Inbox, Calendar, CornerDownRight, Split, Merge, Shuffle, Printer,
  CopyPlus, House, ArrowLeft, ArrowRight, Globe, CircleHelp, WandSparkles, ClipboardList, MessageSquareText,
  Hash, Square,
} from 'lucide';

const ICONS = {
  // Question types (keys match QUESTION_TYPES[].icon)
  single: CircleDot,
  multi: SquareCheck,
  dropdown: SquareChevronDown,
  rating: Star,
  nps: Gauge,
  matrix: Grid3x3,
  slider: SlidersHorizontal,
  ranking: ListOrdered,
  text: TextCursorInput,
  textarea: AlignLeft,
  multitext: Rows3,
  contact: Contact,
  datetime: CalendarClock,
  statement: Type,
  // Chrome
  plus: Plus,
  search: Search,
  x: X,
  chevLeft: ChevronLeft,
  chevRight: ChevronRight,
  chevDown: ChevronDown,
  chevUp: ChevronUp,
  more: Ellipsis,
  moreV: EllipsisVertical,
  edit: Pencil,
  trash: Trash2,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  logout: LogOut,
  check: Check,
  copy: Copy,
  external: ExternalLink,
  eye: Eye,
  folder: Folder,
  folderPlus: FolderPlus,
  folderOpen: FolderOpen,
  template: LayoutTemplate,
  sparkles: Sparkles,
  upload: Upload,
  download: Download,
  link: Link,
  qr: QrCode,
  code: Code,
  settings: Settings,
  palette: Palette,
  logic: GitBranch,
  undo: Undo2,
  redo: Redo2,
  grip: GripVertical,
  up: ArrowUp,
  down: ArrowDown,
  file: FileText,
  chartBar: ChartBar,
  chartColumn: ChartColumn,
  chartPie: ChartPie,
  table: Table,
  filter: Filter,
  users: Users,
  clock: Clock,
  lock: Lock,
  share: Share2,
  send: Send,
  alert: CircleAlert,
  ok: CircleCheck,
  info: Info,
  keyboard: Keyboard,
  menu: Menu,
  phone: Smartphone,
  tablet: Tablet,
  laptop: Laptop,
  refresh: RefreshCw,
  heart: Heart,
  thumb: ThumbsUp,
  circle: Circle,
  inbox: Inbox,
  calendar: Calendar,
  branch: CornerDownRight,
  split: Split,
  merge: Merge,
  shuffle: Shuffle,
  print: Printer,
  duplicate: CopyPlus,
  home: House,
  left: ArrowLeft,
  right: ArrowRight,
  globe: Globe,
  help: CircleHelp,
  wand: WandSparkles,
  clipboard: ClipboardList,
  comment: MessageSquareText,
  hash: Hash,
  square: Square,
};

/** An inline SVG icon. Decorative (aria-hidden) unless `label` is given. */
export function icon(name, { size = 16, label = '', strokeWidth = 1.75, className = '' } = {}) {
  const def = ICONS[name] || ICONS.square;
  const el = createElement(def);
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('stroke-width', String(strokeWidth));
  el.setAttribute('class', `icon${className ? ` ${className}` : ''}`);
  if (label) {
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label);
  } else {
    el.setAttribute('aria-hidden', 'true');
  }
  el.setAttribute('focusable', 'false');
  return el;
}

/** The app's icon, beside its name in the app bar and on sign-in. */
export function brandMark(size = 24) {
  const img = document.createElement('img');
  // Relative, like the page's own icon links: the app may live in a folder.
  img.src = 'icons/icon-192.png';
  img.width = size;
  img.height = size;
  img.alt = '';
  img.className = 'brand-mark';
  return img;
}

export const REPO_URL = 'https://github.com/heyputer/everything';

/** The GitHub mark, for linking to the source repository. */
export function githubMark(size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  svg.innerHTML =
    '<path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>';
  return svg;
}

/**
 * Icons used by the app, from Lucide (ISC license). Import only what is
 * used so the bundle stays small. `icon('inbox')` returns an <svg> element.
 */
import {
  House,
  Inbox,
  Users,
  Building,
  BookOpen,
  ChartColumn,
  Settings,
  Search,
  Bell,
  Plus,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Ellipsis,
  EllipsisVertical,
  Check,
  ListFilter,
  RefreshCw,
  Play,
  Mail,
  Globe,
  Phone,
  MessageSquare,
  Lock,
  Paperclip,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Link,
  Code,
  Quote,
  Image,
  Zap,
  Sparkles,
  User,
  UserPlus,
  Tag,
  Clock,
  TriangleAlert,
  Info,
  Trash,
  RotateCcw,
  GitMerge,
  Copy,
  ExternalLink,
  Download,
  Upload,
  Eye,
  ThumbsUp,
  ThumbsDown,
  Sun,
  Moon,
  Monitor,
  LogOut,
  Keyboard,
  CircleQuestionMark,
  PanelLeft,
  PanelRight,
  Menu,
  ArrowLeft,
  Send,
  Folder,
  FileText,
  Shield,
  Flag,
  RotateCcwClock,
  Printer,
  Ban,
  Workflow,
  Timer,
  UsersRound,
  SlidersHorizontal,
  GripVertical,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Calendar,
  Hash,
  AtSign,
  Reply,
  StickyNote,
  Pencil,
  CircleCheck,
  CircleX,
  LoaderCircle,
  WifiOff,
  Server,
  Cloud,
  KeyRound,
  Columns3,
  SquareCheck,
  Minus,
  LifeBuoy,
  Headset,
  TextCursorInput,
  ChartLine,
  CircleDot,
  ListChecks,
  LayoutList,
  Funnel,
  Star,
  Archive,
  ArchiveRestore,
  Heading2,
  Eraser,
  Maximize2,
  Minimize2,
  SquarePen,
} from 'lucide';

const NODES = {
  'house': House,
  'inbox': Inbox,
  'users': Users,
  'building': Building,
  'book-open': BookOpen,
  'chart-column': ChartColumn,
  'settings': Settings,
  'search': Search,
  'bell': Bell,
  'plus': Plus,
  'x': X,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'ellipsis': Ellipsis,
  'ellipsis-vertical': EllipsisVertical,
  'check': Check,
  'list-filter': ListFilter,
  'refresh-cw': RefreshCw,
  'play': Play,
  'mail': Mail,
  'globe': Globe,
  'phone': Phone,
  'message-square': MessageSquare,
  'lock': Lock,
  'paperclip': Paperclip,
  'bold': Bold,
  'italic': Italic,
  'underline': Underline,
  'strikethrough': Strikethrough,
  'list': List,
  'list-ordered': ListOrdered,
  'link': Link,
  'code': Code,
  'quote': Quote,
  'image': Image,
  'zap': Zap,
  'sparkles': Sparkles,
  'user': User,
  'user-plus': UserPlus,
  'tag': Tag,
  'clock': Clock,
  'triangle-alert': TriangleAlert,
  'info': Info,
  'trash': Trash,
  'rotate-ccw': RotateCcw,
  'git-merge': GitMerge,
  'copy': Copy,
  'external-link': ExternalLink,
  'download': Download,
  'upload': Upload,
  'eye': Eye,
  'thumbs-up': ThumbsUp,
  'thumbs-down': ThumbsDown,
  'sun': Sun,
  'moon': Moon,
  'monitor': Monitor,
  'log-out': LogOut,
  'keyboard': Keyboard,
  'circle-question-mark': CircleQuestionMark,
  'panel-left': PanelLeft,
  'panel-right': PanelRight,
  'menu': Menu,
  'arrow-left': ArrowLeft,
  'send': Send,
  'folder': Folder,
  'file-text': FileText,
  'shield': Shield,
  'flag': Flag,
  'rotate-ccw-clock': RotateCcwClock,
  'printer': Printer,
  'ban': Ban,
  'workflow': Workflow,
  'timer': Timer,
  'users-round': UsersRound,
  'sliders-horizontal': SlidersHorizontal,
  'grip-vertical': GripVertical,
  'arrow-up-down': ArrowUpDown,
  'arrow-up': ArrowUp,
  'arrow-down': ArrowDown,
  'calendar': Calendar,
  'hash': Hash,
  'at-sign': AtSign,
  'reply': Reply,
  'sticky-note': StickyNote,
  'pencil': Pencil,
  'circle-check': CircleCheck,
  'circle-x': CircleX,
  'loader-circle': LoaderCircle,
  'wifi-off': WifiOff,
  'server': Server,
  'cloud': Cloud,
  'key-round': KeyRound,
  'columns-3': Columns3,
  'square-check': SquareCheck,
  'minus': Minus,
  'life-buoy': LifeBuoy,
  'headset': Headset,
  'text-cursor-input': TextCursorInput,
  'chart-line': ChartLine,
  'circle-dot': CircleDot,
  'list-checks': ListChecks,
  'layout-list': LayoutList,
  'funnel': Funnel,
  'star': Star,
  archive: Archive,
  'archive-restore': ArchiveRestore,
  'heading-2': Heading2,
  'eraser': Eraser,
  'maximize-2': Maximize2,
  'minimize-2': Minimize2,
  'square-pen': SquarePen,
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function build([tag, attrs, children]) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (children) for (const c of children) el.appendChild(build(c));
  return el;
}

/**
 * Filled marks that Lucide does not ship. The GitHub mark is used only to
 * link to the project's source code, as GitHub's logo guidelines allow.
 */
const FILLED = {
  github: 'M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z',
};

/** An inline icon. Decorative by default; pass `label` to make it meaningful. */
export function icon(name, { size = 16, label = null, stroke = 2, cls = '' } = {}) {
  if (FILLED[name]) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('class', `icon${cls ? ` ${cls}` : ''}`);
    if (label) {
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', label);
    } else svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', FILLED[name]);
    svg.appendChild(path);
    return svg;
  }
  const node = NODES[name] || NODES['circle-dot'];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(stroke));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', `icon${cls ? ` ${cls}` : ''}`);
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
  }
  for (const child of node) svg.appendChild(build(child));
  return svg;
}

export const ICON_NAMES = Object.keys(NODES);

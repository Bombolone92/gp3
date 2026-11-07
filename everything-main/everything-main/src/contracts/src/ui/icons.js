import {
  createElement,
  // Navigation and chrome
  LayoutDashboard, FileText, Users, CalendarClock, Settings, Plus, Search, X,
  ChevronLeft, ChevronRight, Pencil, Trash2, Sun, Moon, Monitor, LogOut,
  Check, Sparkles, WifiOff, Cloud, Download, Upload, Paperclip, ListChecks,
  CircleAlert, TriangleAlert, Clock, RefreshCw, ArrowRight, Filter, Info,
  // Entity icons
  Handshake, Package, ShieldCheck, Briefcase, Building2, KeyRound, Mail,
  Phone, UserRound, CircleCheck, CalendarDays, Banknote, Tag, FileUp,
  ScrollText, NotebookPen, Link2, RotateCcw, Trash, Image as ImageIcon,
} from 'lucide';

const ICONS = {
  dashboard: LayoutDashboard,
  'file-text': FileText,
  users: Users,
  'calendar-clock': CalendarClock,
  gear: Settings,
  plus: Plus,
  search: Search,
  x: X,
  chevL: ChevronLeft,
  chevR: ChevronRight,
  pencil: Pencil,
  trash: Trash2,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  logout: LogOut,
  check: Check,
  sparkle: Sparkles,
  wifiOff: WifiOff,
  cloud: Cloud,
  download: Download,
  upload: Upload,
  paperclip: Paperclip,
  checklist: ListChecks,
  alert: CircleAlert,
  warning: TriangleAlert,
  clock: Clock,
  renew: RefreshCw,
  arrowR: ArrowRight,
  filter: Filter,
  info: Info,

  // Contract types
  handshake: Handshake,
  package: Package,
  shield: ShieldCheck,
  briefcase: Briefcase,
  building: Building2,
  key: KeyRound,

  mail: Mail,
  phone: Phone,
  user: UserRound,
  done: CircleCheck,
  calendar: CalendarDays,
  money: Banknote,
  tag: Tag,
  fileUp: FileUp,
  scroll: ScrollText,
  notes: NotebookPen,
  link: Link2,
  undo: RotateCcw,
  trashBin: Trash,
  image: ImageIcon,
};

/*
 * Every list row asks for the same two or three icons, so a long list rebuilds
 * an identical SVG hundreds of times — building the element, then serializing
 * it, for a string that never differs. The app draws from a fixed handful of
 * (name, size, stroke) combinations, so the cache is small and never evicted.
 */
const rendered = new Map();

/** Render a Lucide icon as an HTML string. Unknown names fall back to a file. */
export function icon(name, size = 20, strokeWidth = 1.8) {
  const key = `${name}|${size}|${strokeWidth}`;
  let html = rendered.get(key);
  if (html === undefined) {
    const svg = createElement(ICONS[name] || FileText);
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('stroke-width', strokeWidth);
    svg.setAttribute('aria-hidden', 'true');
    html = svg.outerHTML;
    rendered.set(key, html);
  }
  return html;
}

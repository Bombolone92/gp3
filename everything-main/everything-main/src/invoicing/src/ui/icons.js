import {
  createElement,
  House, FileText, FilePen, Users, Repeat, ReceiptText, Settings,
  Plus, X, Search, Ellipsis, ChevronLeft, ChevronRight, Pencil, Trash2,
  Sun, Moon, Monitor, LogOut, Check, Sparkles, WifiOff, Copy, Link, Share2,
  Send, Printer, Download, Upload, CreditCard, Banknote, CircleCheck, Clock,
  CircleAlert, Pause, Play, ArrowRight, ArrowLeft, Building2, Mail, Phone,
  CalendarClock, ExternalLink, CircleDollarSign, Ban, HandCoins, CircleX,
  Hourglass, Globe, Inbox, RotateCcw, ChartColumn, Tag, Paperclip,
} from 'lucide';

const ICONS = {
  home: House,
  invoice: FileText,
  quote: FilePen,
  clients: Users,
  repeat: Repeat,
  receipt: ReceiptText,
  gear: Settings,
  plus: Plus,
  x: X,
  search: Search,
  more: Ellipsis,
  chevL: ChevronLeft,
  chevR: ChevronRight,
  back: ArrowLeft,
  arrowR: ArrowRight,
  pencil: Pencil,
  trash: Trash2,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  logout: LogOut,
  check: Check,
  sparkle: Sparkles,
  wifiOff: WifiOff,
  copy: Copy,
  link: Link,
  share: Share2,
  send: Send,
  printer: Printer,
  download: Download,
  upload: Upload,
  card: CreditCard,
  banknote: Banknote,
  circleCheck: CircleCheck,
  clock: Clock,
  alert: CircleAlert,
  pause: Pause,
  play: Play,
  building: Building2,
  mail: Mail,
  phone: Phone,
  calendarClock: CalendarClock,
  external: ExternalLink,
  dollar: CircleDollarSign,
  ban: Ban,
  handCoins: HandCoins,
  circleX: CircleX,
  hourglass: Hourglass,
  globe: Globe,
  inbox: Inbox,
  undo: RotateCcw,
  chart: ChartColumn,
  tag: Tag,
  paperclip: Paperclip,
};

/**
 * Inline SVG markup for a named icon (decorative by default).
 *
 * Markup is memoized per name and size: building an element and serializing it
 * is not free, the app draws the same handful of icons over and over, and a
 * list of a few hundred rows asks for one on every row.
 */
const cache = new Map();
export function icon(name, size = 17, strokeWidth = 1.6) {
  const key = `${name}|${size}|${strokeWidth}`;
  let markup = cache.get(key);
  if (markup === undefined) {
    const def = ICONS[name] || ICONS.invoice;
    const node = createElement(def);
    node.setAttribute('width', size);
    node.setAttribute('height', size);
    node.setAttribute('stroke-width', strokeWidth);
    node.setAttribute('aria-hidden', 'true');
    node.setAttribute('focusable', 'false');
    markup = node.outerHTML;
    cache.set(key, markup);
  }
  return markup;
}

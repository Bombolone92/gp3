import {
  createElement,
  // UI chrome
  House, Table2, Users, FileText, Layers, TrendingUp, Settings, Plus, X,
  ChevronLeft, ChevronRight, ChevronDown, Ellipsis, Pencil, Trash2,
  Sun, Moon, Monitor, Download, Upload, LogOut, Check, Sparkles, WifiOff,
  Activity, Clock, Percent, Building2, Briefcase, Landmark, Crown, Compass,
  PieChart, CircleAlert, Info, Search, ArrowRight, Scale, Coins, FileDown,
  CalendarDays, Wallet, ShieldCheck, RefreshCw, Copy, ChartColumn, Paperclip,
  Printer,
} from 'lucide';

const ICONS = {
  home: House,
  table: Table2,
  users: Users,
  'file-text': FileText,
  layers: Layers,
  'trending-up': TrendingUp,
  gear: Settings,
  plus: Plus,
  x: X,
  chevL: ChevronLeft,
  chevR: ChevronRight,
  chevDown: ChevronDown,
  more: Ellipsis,
  pencil: Pencil,
  trash: Trash2,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  download: Download,
  printer: Printer,
  upload: Upload,
  logout: LogOut,
  check: Check,
  sparkle: Sparkles,
  wifiOff: WifiOff,
  activity: Activity,
  clock: Clock,
  percent: Percent,
  building: Building2,
  briefcase: Briefcase,
  landmark: Landmark,
  crown: Crown,
  compass: Compass,
  pie: PieChart,
  alert: CircleAlert,
  info: Info,
  search: Search,
  arrowR: ArrowRight,
  scale: Scale,
  coins: Coins,
  'file-down': FileDown,
  calendar: CalendarDays,
  wallet: Wallet,
  shield: ShieldCheck,
  refresh: RefreshCw,
  copy: Copy,
  chart: ChartColumn,
  paperclip: Paperclip,
};

/* One string per icon, size and stroke: the markup is the same every time,
   and building the SVG node to serialize it again was most of a render of
   the securities register, three to five icons a row across thousands of
   rows. A few dozen distinct keys ever occur. */
const rendered = new Map();

/** Render a Lucide icon as an HTML string. Unknown names fall back to Info. */
export function icon(name, size = 20, strokeWidth = 1.8) {
  // Own-property lookup: names can come from stored data (activity entries
  // carry an icon name, and imports can carry anything). A name off the
  // prototype chain like 'constructor' is truthy, dodges the fallback, and
  // crashes lucide mid-render - taking the whole view, nav included, with it.
  const known = Object.hasOwn(ICONS, name);
  const key = `${known ? name : ''}|${size}|${strokeWidth}`;
  const hit = rendered.get(key);
  if (hit) return hit;
  const svg = createElement(known ? ICONS[name] : Info);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('stroke-width', strokeWidth);
  svg.setAttribute('aria-hidden', 'true');
  const html = svg.outerHTML;
  rendered.set(key, html);
  return html;
}

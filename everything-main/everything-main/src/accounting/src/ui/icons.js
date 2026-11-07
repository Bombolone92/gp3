import {
  createElement,
  House, ChartLine, ChartColumn, Plus, CirclePlus, Search, Settings, CircleHelp, Keyboard, Landmark, Receipt,
  ReceiptText, FileText, FilePen, FileCheck, Users, UserRound, Store, Package, Wallet, CreditCard, Banknote,
  ArrowLeftRight, BookOpen, Scale, Repeat, Percent, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  PanelLeftClose, PanelLeftOpen, Menu, X, Check, Ellipsis, EllipsisVertical, Pencil, Trash2, Copy, Printer,
  Download, Upload, Paperclip, History, Star, Sun, Moon, Monitor, LogOut, CloudOff, Cloud, RefreshCw, Filter,
  ArrowUp, ArrowDown, ArrowUpDown, ArrowRight, ArrowLeft, Calendar, CalendarClock, CircleCheck, CircleAlert,
  TriangleAlert, Info, Ban, Undo2, ExternalLink, Mail, Phone, Globe, MapPin, Building2, Tag, ListChecks, Wand,
  Sparkles, Eye, EyeOff, GripVertical, Columns3, SlidersHorizontal, HandCoins, PiggyBank, Lock, LockOpen,
  ShieldCheck, Inbox, Link, Unlink, FileSpreadsheet, FileUp, CircleDollarSign, Truck, ShoppingCart, Briefcase,
  ClipboardList, Activity, Database, LayoutGrid, Minus,
} from 'lucide';

const ICONS = {
  home: House, reports: ChartLine, chart: ChartColumn, plus: Plus, create: CirclePlus, search: Search,
  settings: Settings, help: CircleHelp, keyboard: Keyboard, bank: Landmark, receipt: Receipt, receiptText: ReceiptText,
  invoice: FileText, estimate: FilePen, fileCheck: FileCheck, users: Users, user: UserRound, vendor: Store,
  item: Package, wallet: Wallet, card: CreditCard, cash: Banknote, transfer: ArrowLeftRight, journal: BookOpen,
  scale: Scale, repeat: Repeat, percent: Percent, chevDown: ChevronDown, chevUp: ChevronUp, chevL: ChevronLeft,
  chevR: ChevronRight, panelClose: PanelLeftClose, panelOpen: PanelLeftOpen, menu: Menu, x: X, check: Check,
  more: Ellipsis, moreV: EllipsisVertical, pencil: Pencil, trash: Trash2, copy: Copy, printer: Printer,
  download: Download, upload: Upload, paperclip: Paperclip, history: History, star: Star, sun: Sun, moon: Moon,
  monitor: Monitor, logout: LogOut, offline: CloudOff, cloud: Cloud, refresh: RefreshCw, filter: Filter,
  up: ArrowUp, down: ArrowDown, sort: ArrowUpDown, arrowR: ArrowRight, arrowL: ArrowLeft, calendar: Calendar,
  calendarClock: CalendarClock, ok: CircleCheck, alert: CircleAlert, warn: TriangleAlert, info: Info, ban: Ban,
  undo: Undo2, external: ExternalLink, mail: Mail, phone: Phone, globe: Globe, pin: MapPin, building: Building2,
  tag: Tag, rules: ListChecks, wand: Wand, sparkles: Sparkles, eye: Eye, eyeOff: EyeOff, grip: GripVertical,
  columns: Columns3, sliders: SlidersHorizontal, handCoins: HandCoins, piggy: PiggyBank, lock: Lock,
  unlock: LockOpen, shield: ShieldCheck, inbox: Inbox, link: Link, unlink: Unlink, sheet: FileSpreadsheet,
  fileUp: FileUp, dollar: CircleDollarSign, truck: Truck, cart: ShoppingCart, briefcase: Briefcase,
  clipboard: ClipboardList, activity: Activity, database: Database, apps: LayoutGrid, minus: Minus,
};

const cache = new Map();

/** Inline SVG markup for a named icon, decorative (aria-hidden). Memoized. */
export function icon(name, size = 18, strokeWidth = 1.75) {
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

/** The app icon (public/app-icon.png) as an HTML string. Decorative: callers label the surrounding element. */
export function appMark(size = 32) {
  return `<img class="app-icon" src="./app-icon.png" alt="" width="${size}" height="${size}" decoding="async" draggable="false" />`;
}

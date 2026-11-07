import {
  createElement,
  House, List, FolderOpen, Scale, Settings, Plus, Search, X, ChevronLeft, ChevronRight, ChevronDown, Ellipsis,
  Pencil, Trash2, Sun, Moon, Monitor, Download, Upload, LogOut, Check, CheckCheck, Sparkles, Cloud, WifiOff,
  Camera, ScanLine, Receipt, FileText, Image, ImageOff, Link2, Unlink, Filter, ArrowRight, Send, BadgeCheck,
  Banknote, Info, TriangleAlert, CircleAlert, LoaderCircle, Calendar, CreditCard, Wallet, Undo2, Printer,
  ExternalLink, FileDown, FileUp, FileSpreadsheet, ListChecks, SlidersHorizontal, ZoomIn, Eye, Files, Layers,
  CircleCheck, CircleDashed, ClipboardCheck, Store, Hash, ArrowLeftRight, RotateCcw, Square, SquareCheck, Tag,
  // Category icons
  Utensils, Plane, Bed, Car, Paperclip, Laptop, Wine, Coffee, Bus, Train, Fuel, Hotel, ShoppingBag, Gift, Phone,
  Wifi, Briefcase, Ticket, BookOpen, Stethoscope, Dumbbell, Music, Shirt, Building2, Landmark,
} from 'lucide';

const ICONS = {
  // UI chrome
  home: House,
  list: List,
  folder: FolderOpen,
  scale: Scale,
  gear: Settings,
  plus: Plus,
  search: Search,
  x: X,
  chevL: ChevronLeft,
  chevR: ChevronRight,
  chevD: ChevronDown,
  more: Ellipsis,
  pencil: Pencil,
  trash: Trash2,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  download: Download,
  upload: Upload,
  logout: LogOut,
  check: Check,
  checkCheck: CheckCheck,
  sparkle: Sparkles,
  cloud: Cloud,
  wifiOff: WifiOff,
  camera: Camera,
  scan: ScanLine,
  receipt: Receipt,
  file: FileText,
  image: Image,
  imageOff: ImageOff,
  link: Link2,
  unlink: Unlink,
  filter: Filter,
  arrowR: ArrowRight,
  send: Send,
  badge: BadgeCheck,
  banknote: Banknote,
  info: Info,
  warn: TriangleAlert,
  alert: CircleAlert,
  spinner: LoaderCircle,
  calendar: Calendar,
  card: CreditCard,
  wallet: Wallet,
  undo: Undo2,
  printer: Printer,
  external: ExternalLink,
  fileDown: FileDown,
  fileUp: FileUp,
  sheet: FileSpreadsheet,
  listChecks: ListChecks,
  sliders: SlidersHorizontal,
  zoom: ZoomIn,
  eye: Eye,
  files: Files,
  layers: Layers,
  circleCheck: CircleCheck,
  circleDashed: CircleDashed,
  clipboard: ClipboardCheck,
  store: Store,
  hash: Hash,
  swap: ArrowLeftRight,
  reset: RotateCcw,
  square: Square,
  squareCheck: SquareCheck,
  tag: Tag,

  // Category icons (kebab-case names are stored in user data)
  utensils: Utensils,
  plane: Plane,
  bed: Bed,
  car: Car,
  paperclip: Paperclip,
  laptop: Laptop,
  wine: Wine,
  coffee: Coffee,
  bus: Bus,
  train: Train,
  fuel: Fuel,
  hotel: Hotel,
  'shopping-bag': ShoppingBag,
  gift: Gift,
  phone: Phone,
  wifi: Wifi,
  briefcase: Briefcase,
  ticket: Ticket,
  'book-open': BookOpen,
  stethoscope: Stethoscope,
  dumbbell: Dumbbell,
  music: Music,
  shirt: Shirt,
  building: Building2,
  landmark: Landmark,
  'credit-card': CreditCard,
};

/** Icon names offered in the category icon picker. */
export const CATEGORY_ICON_CHOICES = [
  'utensils', 'coffee', 'wine', 'plane', 'train', 'bus', 'car', 'fuel', 'bed', 'hotel', 'paperclip', 'laptop',
  'phone', 'wifi', 'shopping-bag', 'gift', 'briefcase', 'ticket', 'book-open', 'stethoscope', 'dumbbell',
  'music', 'shirt', 'building', 'landmark', 'credit-card', 'banknote', 'tag',
];

/** Resolve any stored icon value to a known name. hasOwn keeps prototype keys out. */
export function normalizeIconName(name) {
  return Object.hasOwn(ICONS, name) ? name : 'tag';
}

/** Same as icon(), as a live element. */
export function iconEl(name, size = 22, strokeWidth = 1.8) {
  const svg = createElement(ICONS[normalizeIconName(name)]);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('stroke-width', strokeWidth);
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

/** Render a Lucide icon as an HTML string. Unknown names fall back to a tag. */
export function icon(name, size = 22, strokeWidth = 1.8) {
  return iconEl(name, size, strokeWidth).outerHTML;
}

import {
  createElement,
  Store, ShoppingCart, Package, ReceiptText, ChartColumn, Settings,
  Plus, Minus, X, Search, Check, Pencil, Trash2,
  ChevronLeft, ChevronRight, ChevronDown,
  Sun, Moon, Monitor, LogOut, Printer, BadgePercent, Tag,
  Banknote, CreditCard, Wallet, Sparkles, WifiOff,
  CircleAlert, Ban, FileDown, FileUp, FileSpreadsheet,
  PackageOpen, Table2, CircleCheck, SquarePen,
  ScanBarcode, CameraOff, Pause, Play, SlidersHorizontal, Split, Undo2, Coins,
  CloudUpload, Share2, Image as ImageIcon, Lock, Users, UserPlus,
  Star, Move, ClipboardList, Ticket,
} from 'lucide';

const ICONS = {
  store: Store,
  cart: ShoppingCart,
  package: Package,
  packageOpen: PackageOpen,
  receipt: ReceiptText,
  chart: ChartColumn,
  gear: Settings,
  plus: Plus,
  minus: Minus,
  x: X,
  search: Search,
  check: Check,
  circleCheck: CircleCheck,
  pencil: Pencil,
  squarePen: SquarePen,
  trash: Trash2,
  chevL: ChevronLeft,
  chevR: ChevronRight,
  chevD: ChevronDown,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  logout: LogOut,
  printer: Printer,
  badgePercent: BadgePercent,
  tag: Tag,
  banknote: Banknote,
  creditCard: CreditCard,
  wallet: Wallet,
  sparkle: Sparkles,
  wifiOff: WifiOff,
  alert: CircleAlert,
  ban: Ban,
  fileDown: FileDown,
  fileUp: FileUp,
  fileSheet: FileSpreadsheet,
  table: Table2,
  scan: ScanBarcode,
  cameraOff: CameraOff,
  pause: Pause,
  play: Play,
  sliders: SlidersHorizontal,
  split: Split,
  refund: Undo2,
  coins: Coins,
  cloudUp: CloudUpload,
  share: Share2,
  image: ImageIcon,
  lock: Lock,
  users: Users,
  userPlus: UserPlus,
  star: Star,
  arrange: Move,
  clipboard: ClipboardList,
  ticket: Ticket,
};

/** Render a Lucide icon as an HTML string. Unknown names fall back to a tag. */
export function icon(name, size = 22, strokeWidth = 1.8) {
  const node = ICONS[name] || Tag;
  const svg = createElement(node);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('stroke-width', strokeWidth);
  svg.setAttribute('aria-hidden', 'true');
  return svg.outerHTML;
}

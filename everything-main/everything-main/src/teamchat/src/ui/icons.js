import {
  createElement,
  Hash, Lock, LockOpen, Plus, X, Search, Settings, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Ellipsis, Pencil, Trash2, Sun, Moon, Monitor, LogOut, Check, CheckCheck, Bell, BellOff, Users, UserPlus,
  MessageSquare, MessageSquareText, MessagesSquare, Reply, Send, Paperclip, Smile, AtSign, Info,
  PanelRight, PanelRightClose, Menu, ArrowDown, ArrowLeft, CornerDownLeft, Copy, Link, Archive, ArchiveRestore,
  Sparkles, Cloud, WifiOff, CircleAlert, Download, FileText, Image, Film, Music, File, ExternalLink, Circle,
  ThumbsUp, Heart, Laugh, PartyPopper, Eye, Rocket, Flame, Shield, ShieldCheck, Crown, Building2, LogIn,
  Keyboard, Type, Bold, Italic, Code, Quote, RefreshCw, DoorOpen, Trash, Layers, Megaphone, MessageSquareOff,
  Pin, PinOff, Bookmark, BookmarkPlus, ArrowUp, GripVertical, Clock, AlarmClock, CalendarClock, Bot, Webhook, KeyRound, Plug,
  Strikethrough, SquareCode, Star, StarOff, Forward, Inbox, House, Files, Calendar, ArrowRight, ListFilter, Upload, BookUser, Folder, FolderPlus, FolderInput,
  Share2, Unplug, Headphones, Mic, MicOff, Video, VideoOff, ScreenShare, ScreenShareOff, PhoneOff, Maximize2, Minimize2, Play,
  Mail,
} from 'lucide';

const ICONS = {
  hash: Hash, lock: Lock, lockOpen: LockOpen, plus: Plus, x: X, search: Search, gear: Settings,
  chevDown: ChevronDown, chevLeft: ChevronLeft, chevRight: ChevronRight, chevUp: ChevronUp,
  more: Ellipsis, pencil: Pencil, trash: Trash2, trashPlain: Trash, sun: Sun, moon: Moon, monitor: Monitor,
  logout: LogOut, login: LogIn, check: Check, checkCheck: CheckCheck, bell: Bell, bellOff: BellOff, users: Users, userPlus: UserPlus,
  message: MessageSquare, messageText: MessageSquareText, messages: MessagesSquare, reply: Reply, send: Send,
  paperclip: Paperclip, smilePlus: Smile, at: AtSign, info: Info, panelRight: PanelRight, panelRightClose: PanelRightClose, mail: Mail,
  menu: Menu, arrowDown: ArrowDown, arrowLeft: ArrowLeft, enter: CornerDownLeft, copy: Copy, link: Link,
  archive: Archive, unarchive: ArchiveRestore, sparkle: Sparkles, cloud: Cloud, wifiOff: WifiOff, alert: CircleAlert,
  download: Download, fileText: FileText, image: Image, film: Film, music: Music, file: File, external: ExternalLink, play: Play,
  circle: Circle, shield: Shield, shieldCheck: ShieldCheck, crown: Crown, building: Building2, keyboard: Keyboard,
  type: Type, bold: Bold, italic: Italic, code: Code, quote: Quote, refresh: RefreshCw, doorOpen: DoorOpen, layers: Layers,
  megaphone: Megaphone, messageOff: MessageSquareOff, pin: Pin, pinOff: PinOff, bookmark: Bookmark, bookmarkPlus: BookmarkPlus,
  arrowUp: ArrowUp, grip: GripVertical, clock: Clock, alarm: AlarmClock, calendarClock: CalendarClock,
  bot: Bot, webhook: Webhook, key: KeyRound, plug: Plug,
  strike: Strikethrough, codeBlock: SquareCode, star: Star, starOff: StarOff, forward: Forward, inbox: Inbox, home: House,
  files: Files, calendar: Calendar, arrowRight: ArrowRight, filter: ListFilter, upload: Upload, contact: BookUser, folder: Folder, folderPlus: FolderPlus, folderInput: FolderInput,
  shared: Share2, unplug: Unplug,
  headphones: Headphones, mic: Mic, micOff: MicOff, video: Video, videoOff: VideoOff, screenShare: ScreenShare, screenShareOff: ScreenShareOff,
  phoneOff: PhoneOff, maximize: Maximize2, minimize: Minimize2,
  // Legacy reactions (keys match LEGACY_REACTION_KEYS in shared/reactions.js)
  'thumbs-up': ThumbsUp, heart: Heart, laugh: Laugh, 'party-popper': PartyPopper, eye: Eye, rocket: Rocket, flame: Flame,
};

/** Render a Lucide icon as an HTML string. Decorative by default. */
export function icon(name, size = 20, strokeWidth = 1.9) {
  const node = Object.hasOwn(ICONS, name) ? ICONS[name] : Circle;
  const svg = createElement(node);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('stroke-width', strokeWidth);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  return svg.outerHTML;
}

/** The same, as a live element. */
export function iconEl(name, size, strokeWidth) {
  const tpl = document.createElement('template');
  tpl.innerHTML = icon(name, size, strokeWidth);
  return tpl.content.firstElementChild;
}

/** Icon for an attachment by MIME type. */
export function fileIcon(type = '') {
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'film';
  if (type.startsWith('audio/')) return 'music';
  if (type.startsWith('text/') || /pdf|document|sheet|presentation/.test(type)) return 'fileText';
  return 'file';
}

/**
 * Icon for a channel row: a lock when private (being invisible to most of
 * the workspace outranks every other trait), the shared mark
 * when another workspace is in it (hosted here or elsewhere), a megaphone
 * when only admins may post, else a hash.
 */
export function channelIcon(channel) {
  // An entry for a channel hosted elsewhere whose connection is over (see the
  // store's `lost`) shows as unplugged wherever it is listed.
  if (channel?.lost) return 'unplug';
  if (channel?.private) return 'lock';
  if (isSharedChannel(channel)) return 'shared';
  if (channel?.postPolicy === 'admins') return 'megaphone';
  return 'hash';
}

/** Shared with another workspace: an entry for a channel hosted elsewhere, or a channel here with connections. */
export function isSharedChannel(channel) {
  return !!channel && (!!channel.shared || Object.keys(channel.connections || {}).length > 0);
}

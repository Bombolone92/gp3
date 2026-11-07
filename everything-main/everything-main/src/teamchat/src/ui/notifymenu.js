/**
 * The notification menu for one conversation, shared by the sidebar row,
 * the conversation header, and the details panel: a level (All messages,
 * Mentions only, Nothing) and a mute switch. Changes apply at once and are
 * saved to the member document, so they follow the user across devices.
 */
import { openMenu } from './menu.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { startOfTomorrow } from '../lib/notify.js';
import { untilText } from '../lib/time.js';
import { settingsDialog, leaveChannelFlow, leaveOffered } from './dialogs.js';
import { copyToClipboard } from './clipboard.js';
import { navigate, absoluteLink } from '../lib/router.js';

export const LEVEL_LABELS = { all: 'All messages', mentions: 'Mentions only', nothing: 'Nothing' };

export function notifySummary(convId) {
  const s = store.notifySetting(convId);
  if (s.mute) return 'Muted';
  return LEVEL_LABELS[s.level] || 'Mentions only';
}

function save(convId, patch, done) {
  store.setNotify(convId, patch).then(() => done?.()).catch((e) => {
    toast(e.message || 'Could not save', { icon: 'alert' });
    store.refreshWorkspace().catch(() => {});
  });
}

/** Items for openMenu; `extra` items are appended after a separator. */
export function notifyMenuItems(convId, { onChange, extra = [] } = {}) {
  const s = store.notifySetting(convId);
  const kind = store.convKind(convId);
  const starred = store.isStarred(convId);
  const items = [
    {
      label: starred ? 'Remove star' : kind === 'dm' ? 'Star conversation' : 'Star channel', icon: starred ? 'starOff' : 'star',
      onSelect: () => store.toggleStar(convId).then((on) => { toast(on ? 'Starred' : 'Star removed', { icon: 'star' }); onChange?.(); }).catch((e) => toast(e.message, { icon: 'alert' })),
    },
    'sep',
    { header: 'Notify me about' },
    ...['all', 'mentions', 'nothing'].map((level) => ({
      label: LEVEL_LABELS[level],
      sub: level === 'all' ? 'Every new message' : level === 'mentions' ? (kind === 'dm' ? 'Only when named' : 'When you are named or @channel is used') : 'No notifications, but unread still shows',
      checked: !s.mute && s.level === level,
      disabled: s.mute || null,
      onSelect: () => save(convId, { level }, onChange),
    })),
    'sep',
    {
      label: s.mute ? 'Unmute' : 'Mute', icon: s.mute ? 'bell' : 'bellOff',
      sub: s.mute ? null : 'Dimmed, never bold, no notifications, not counted in the tab title',
      onSelect: () => {
        save(convId, { mute: !s.mute }, onChange);
        toast(s.mute ? `Unmuted ${store.convTitle(convId)}` : `Muted ${store.convTitle(convId)}`, { icon: s.mute ? 'bell' : 'bellOff' });
      },
    },
  ];
  // Read state, the other thing people want from a row's menu.
  const latest = store.latestSeq(convId);
  const unread = store.unreadCount(convId) > 0 || store.mentionCount(convId) > 0;
  items.push('sep', unread
    ? { label: 'Mark as read', icon: 'checkCheck', onSelect: () => { store.markRead(convId, latest); store.me.reads[convId] = latest; store.emit('activity'); onChange?.(); } }
    : { label: 'Mark as unread', icon: 'eye', disabled: !latest || null, onSelect: () => store.markUnread(convId, latest).then(onChange).catch((e) => toast(e.message, { icon: 'alert' })) });
  if (extra.length) items.push('sep', ...extra);
  return items;
}

export function openNotifyMenu(anchor, convId, opts = {}) {
  return openMenu(anchor, notifyMenuItems(convId, opts), { align: opts.align || 'end', label: 'Notifications' });
}

/**
 * The menu on a sidebar row (its kebab, or a right-click), in this order:
 * details, copy, star, then "Notify you about" with the three
 * choices that matter there, read state, and the way out.
 */
export function rowMenuItems(convId, { onChange, extra = [] } = {}) {
  const s = store.notifySetting(convId);
  const kind = store.convKind(convId);
  const ch = store.channel(convId);
  const starred = store.isStarred(convId);
  // Through copyToClipboard, which has the older way for a browser without
  // a clipboard of its own and rejects when neither works: asked of the
  // browser's clipboard alone, the whole chain fell silent where there was
  // none, and Copy link copied nothing and said nothing, as the message's
  // and the conversation's copies once did.
  const copy = (text, done) => copyToClipboard(text).then(() => toast(done)).catch(() => toast('Could not copy', { icon: 'alert' }));
  const pick = (patch) => save(convId, patch, onChange);
  const items = [
    { label: ch ? 'Channel details' : 'Conversation details', icon: 'info', onSelect: () => navigate({ ws: store.wsId, conv: convId, details: true }) },
    { label: 'Copy link', icon: 'link', onSelect: () => copy(absoluteLink({ ws: store.wsId, conv: convId }), 'Link copied') },
    ch && { label: 'Copy name', icon: 'copy', onSelect: () => copy(`#${ch.name}`, 'Name copied') },
    {
      label: starred ? 'Remove star' : kind === 'dm' ? 'Star conversation' : 'Star channel', icon: starred ? 'starOff' : 'star',
      onSelect: () => store.toggleStar(convId).then((on) => { toast(on ? 'Starred' : 'Star removed', { icon: 'star' }); onChange?.(); }).catch((e) => toast(e.message, { icon: 'alert' })),
    },
    ...extra,
    'sep',
    { header: 'Notify you about…' },
    { label: 'All new posts', icon: 'bell', checked: !s.mute && s.level === 'all', onSelect: () => pick({ level: 'all', mute: false }) },
    { label: 'Just mentions', icon: 'at', checked: !s.mute && s.level === 'mentions', onSelect: () => pick({ level: 'mentions', mute: false }) },
    s.level === 'nothing' && !s.mute && { label: 'Nothing', icon: 'bellOff', checked: true, onSelect: () => {} },
    {
      label: 'Mute', icon: 'bellOff', checked: !!s.mute, sub: s.mute ? null : 'Dimmed, never bold, no notifications',
      onSelect: () => { pick({ mute: !s.mute }); toast(s.mute ? `Unmuted ${store.convTitle(convId)}` : `Muted ${store.convTitle(convId)}`, { icon: s.mute ? 'bell' : 'bellOff' }); },
    },
  ];
  const latest = store.latestSeq(convId);
  const unread = store.unreadCount(convId) > 0 || store.mentionCount(convId) > 0;
  items.push('sep', unread
    ? { label: 'Mark as read', icon: 'checkCheck', onSelect: () => { store.markRead(convId, latest); store.me.reads[convId] = latest; store.emit('activity'); onChange?.(); } }
    : { label: 'Mark as unread', icon: 'eye', disabled: !latest || null, onSelect: () => store.markUnread(convId, latest).then(onChange).catch((e) => toast(e.message, { icon: 'alert' })) });
  // Not offered to a guest whose only channel this is (see leaveOffered).
  if (leaveOffered(ch)) {
    items.push('sep', { label: 'Leave channel', icon: 'doorOpen', danger: true, onSelect: () => leaveChannelFlow(ch) });
  }
  return items;
}

export function openRowMenu(anchor, convId, opts = {}) {
  return openMenu(anchor, rowMenuItems(convId, opts), { align: opts.align || 'end', label: `${store.convTitle(convId)} options`, onClose: opts.onClose });
}

/** Items for the global pause: resume, a few durations, and quiet hours. */
export function pauseMenuItems({ onChange } = {}) {
  const prefs = store.profile?.prefs || {};
  const until = prefs.pauseUntil && prefs.pauseUntil > Date.now() ? prefs.pauseUntil : null;
  // untilText names the day when it is not today: "Until tomorrow" ends at
  // "Tomorrow, 12:00 AM", and a bare "12:00 AM" would read as today's.
  const fmt = (ts) => untilText(ts);
  const pause = async (ts) => {
    try {
      await store.updatePrefs({ pauseUntil: ts });
      toast(ts ? `Notifications paused until ${fmt(ts)}` : 'Notifications resumed', { icon: ts ? 'bellOff' : 'bell' });
      onChange?.();
    } catch (e) {
      toast(e.message, { icon: 'alert' });
    }
  };
  const items = [{ header: until ? `Paused until ${fmt(until)}` : 'Pause notifications' }];
  if (until) items.push({ label: 'Resume notifications', icon: 'bell', onSelect: () => pause(null) }, 'sep');
  items.push(
    { label: 'For 30 minutes', onSelect: () => pause(Date.now() + 30 * 60_000) },
    { label: 'For 1 hour', onSelect: () => pause(Date.now() + 60 * 60_000) },
    { label: 'For 2 hours', onSelect: () => pause(Date.now() + 2 * 60 * 60_000) },
    { label: 'Until tomorrow', onSelect: () => pause(startOfTomorrow()) },
    'sep',
    { label: 'Quiet hours', icon: 'moon', sub: prefs.dnd?.enabled ? `${prefs.dnd.from} to ${prefs.dnd.to}, every day` : 'Set a daily window in settings', onSelect: () => settingsDialog({ section: 'quiet' }) });
  return items;
}

export function openPauseMenu(anchor, opts = {}) {
  return openMenu(anchor, pauseMenuItems(opts), { align: opts.align || 'end', label: 'Pause notifications' });
}

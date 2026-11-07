import { el } from './dom.js';
import { icon } from './icons.js';
import { initials, graphemes } from '../lib/format.js';
import { avatarUrl, workspaceIconUrl } from '../lib/avatars.js';
import { store } from '../lib/store.js';

/**
 * Avatar for a member: their photo when they have one (initials show until
 * it loads, and stay if it cannot), otherwise initials on their colour.
 * `presence` true/false adds the dot (null hides it); `state` names it
 * exactly ('active' | 'dnd' | 'away' | 'offline'). size: xs | sm | md | lg | xl.
 */
export function avatar(member, { size = 'md', presence = null, paused = false, state = null } = {}) {
  const node = el(`div.avatar${size !== 'md' ? `.avatar-${size}` : ''}`, {
    dataset: { color: String(member?.color || 8) },
    'aria-hidden': 'true',
  }, initials(member?.name || member?.username));
  if (member?.avatar && member?.uuid && store.wsId && !member.gone) {
    const img = el('img.avatar-img', { alt: '', hidden: true, draggable: false });
    node.append(img);
    // Someone met through a shared channel has their photo on that channel's host.
    avatarUrl(member.photoRef || store.wsId, member.uuid, member.avatar).then((url) => {
      img.src = url;
      img.hidden = false;
      node.classList.add('has-photo');
    }).catch(() => img.remove());
  }
  if (paused) node.append(el('span.presence.dnd'));
  else if (state) node.append(el(`span.presence.${state}`));
  else if (presence !== null) node.append(el(`span.presence${presence ? '.online' : ''}`));
  return node;
}

/**
 * A workspace's mark: its icon when it has one (the name's first letter
 * shows until the icon loads, and stays if it cannot), otherwise the letter
 * on the accent colour. Fills `node`, a `.rail-mark` button or a `.ws-mark`
 * span, which carry the sizes, so callers keep their own element and its
 * label. `ref` says which worker holds the icon: the open workspace's
 * unless the mark is another workspace's, in the switcher.
 */
export function workspaceMark(node, ws, ref = store.wsId) {
  // The name's first character as the reader sees it, not its first UTF-16
  // code unit: for a name that opens with an emoji ("🚀 Rockets") that unit
  // is half of one, and the mark drew the replacement glyph. An emoji
  // written as a sequence (a face with a skin tone, a family) is one
  // character, as the initials on an avatar already have it.
  const first = graphemes(String(ws?.name || '').trim())[0];
  node.replaceChildren(el('span.ws-letter', { 'aria-hidden': 'true' }, first ? first.toUpperCase() : 'W'));
  node.classList.remove('has-icon');
  if (ws?.icon && ref) {
    const img = el('img.ws-icon', { alt: '', hidden: true, draggable: false });
    node.append(img);
    workspaceIconUrl(ref, ws.icon).then((url) => {
      img.src = url;
      img.hidden = false;
      node.classList.add('has-icon');
    }).catch(() => img.remove());
  }
  return node;
}

/** A 2x2 mosaic for group conversations. */
export function groupAvatar(members, { size = 'md' } = {}) {
  const wrap = el(`div.avatar.avatar-group${size !== 'md' ? `.avatar-${size}` : ''}`, { 'aria-hidden': 'true' });
  for (const m of members.slice(0, 4)) wrap.append(avatar(m, { size: 'xs' }));
  return wrap;
}

/**
 * A member's status as a small inline chip: the emoji, and the text where
 * there is room (`compact` shows the emoji only, with the text as a title).
 * Null when they have none or it has expired.
 */
export function statusChip(uuid, { compact = false } = {}) {
  const st = store.statusOf(uuid);
  if (!st) return null;
  const label = [st.emoji, st.text].filter(Boolean).join(' ');
  return el(`span.status-chip${compact ? '.compact' : ''}`, { title: label, 'aria-label': `Status: ${label}` },
    st.emoji && el('span.status-emoji', { 'aria-hidden': 'true' }, st.emoji),
    (!compact || !st.emoji) && st.text && el('span.status-text', {}, st.text));
}

/**
 * How someone is, in words, for the accessible name of a row that draws
 * their dot and their status chip (a direct message in the sidebar or the
 * Direct messages list, a card in the Directory, a person among the search
 * results): "active", "away" or "do not disturb", then their status ("on
 * vacation", or the emoji alone when the status is only an emoji), joined
 * with commas to go after their name and before the row's own words
 * ("Ana Rocha, active, in a meeting, 2 unread"). Nothing for someone
 * offline, as the dot itself says nothing then. The row's label is the whole
 * of what a screen reader hears of it (a label on the row names the row,
 * not its parts), so the chip's own words never reached anyone.
 */
const PRESENCE_WORDS = { active: 'active', dnd: 'do not disturb', away: 'away' };
export function presenceWords(uuid) {
  const parts = [];
  const word = PRESENCE_WORDS[store.presenceOf(uuid)];
  if (word) parts.push(word);
  const st = store.statusOf(uuid);
  const status = st ? String(st.text || st.emoji || '').trim() : '';
  if (status) parts.push(status);
  return parts.join(', ');
}

/** A row's accessible name: the person's name, then how they are (see presenceWords), then the row's own words. */
export function personLabel(name, uuid, rest = '') {
  const how = presenceWords(uuid);
  return `${name}${how ? `, ${how}` : ''}${rest}`;
}

/** "Guest", the name of someone's own workspace (for people in a shared channel), "Admin", or "Owner" as a pill; null for plain members. */
export function rolePill(uuid, { compact = false } = {}) {
  const m = store.member(uuid);
  const role = m.role;
  if (role === 'external') {
    const org = m.org?.name || 'another workspace';
    return el(`span.pill.pill-org${compact ? '.pill-inline' : ''}`, { title: `From ${org}, a workspace this channel is shared with` }, el('span', { html: icon('building', 11, 2.2), 'aria-hidden': 'true' }), org);
  }
  if (role === 'guest') return el(`span.pill.pill-guest${compact ? '.pill-inline' : ''}`, { title: 'A guest: sees only the channels they were invited to' }, 'Guest');
  if (role === 'owner' || role === 'admin') return el(`span.pill${compact ? '.pill-inline' : '.pill-accent'}`, {}, role === 'owner' ? 'Owner' : 'Admin');
  return null;
}

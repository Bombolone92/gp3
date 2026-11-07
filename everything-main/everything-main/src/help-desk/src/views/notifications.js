/**
 * In-app notifications, worked out from the change feed: a ticket assigned
 * to you by someone else, a customer reply on a ticket you are assigned to
 * or follow, and internal notes that mention you. Kept per desk on this
 * device.
 */
import { h, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { relTime } from '../ui/format.js';
import { go } from '../ui/router.js';
import { app } from '../app.js';

const MAX = 60;

class Notifications {
  constructor() {
    this.items = [];
    this.replica = null;
    this.btn = null;
    this.badge = null;
    this.closePanel = null;
    this.onActivity = (e) => this.consider(e.detail.change, e.detail.ticket);
    // Another tab read or received notifications: follow its list.
    this.onStorage = (e) => {
      if (e.key !== this.key()) return;
      this.load();
      this.paint();
    };
  }

  key() {
    return `help-desk:notifications:${app.ref}`;
  }

  stored() {
    try {
      const list = JSON.parse(localStorage.getItem(this.key()) || '[]');
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  load() {
    this.items = this.stored();
  }

  /**
   * Other tabs of this desk keep their own list and save it too, so merge
   * with what is stored rather than overwrite it: every notification is
   * kept, and one read anywhere stays read.
   */
  save() {
    const byId = new Map(this.stored().map((n) => [n.id, n]));
    for (const n of this.items) {
      const other = byId.get(n.id);
      byId.set(n.id, other ? { ...n, read: n.read || other.read } : n);
    }
    this.items = [...byId.values()].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, MAX);
    try {
      localStorage.setItem(this.key(), JSON.stringify(this.items));
    } catch {
      /* ignore */
    }
    this.paint();
  }

  attach(replica) {
    if (this.replica) this.replica.removeEventListener('activity', this.onActivity);
    this.replica = replica;
    this.load();
    replica.addEventListener('activity', this.onActivity);
    window.removeEventListener('storage', this.onStorage);
    window.addEventListener('storage', this.onStorage);
    this.paint();
  }

  consider(change, t) {
    const me = app.me;
    if (!me || !t) return;
    const ev = change.ev || {};
    if (ev.by === me.uuid) return;
    // Suspended tickets (a suspended customer's requests) and the trash are
    // kept out of sight, notifications included.
    if (t.spam || t.deleted) return;
    let text = null;
    let kind = null;
    if (ev.assigned === me.uuid) {
      kind = 'assigned';
      text = `${app.memberName(ev.by) || 'Someone'} assigned you #${t.id}`;
    } else if (ev.byType === 'customer' && ev.comment && (t.assignee === me.uuid || (t.followers || []).includes(me.uuid))) {
      kind = 'reply';
      text = `${app.userName(t.requester)} replied on #${t.id}`;
    } else if (ev.comment && !ev.comment.public && ((ev.comment.mentions && mentionedIn(ev.comment.mentions, me)) || mentions(ev.comment.preview, me))) {
      kind = 'mention';
      text = `${app.memberName(ev.by)} mentioned you on #${t.id}`;
    } else if (ev.byType === 'customer' && !t.assignee && change.at - t.createdAt < 2000 && app.isAdmin) {
      kind = 'new';
      text = `New request #${t.id} from ${app.userName(t.requester)}`;
    }
    if (!text) return;
    this.items.unshift({ id: `${change.r}`, kind, text, subject: t.subject, ticket: t.id, at: change.at || Date.now(), read: false });
    this.items = this.items.slice(0, MAX);
    this.save();
  }

  unread() {
    return this.items.filter((n) => !n.read).length;
  }

  button() {
    this.badge = h('span.bell-badge', { hidden: true });
    this.btn = h('button.icon-btn.bell', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => this.open() }, icon('bell', { size: 18 }), this.badge);
    this.paint();
    return this.btn;
  }

  paint() {
    if (!this.btn) return;
    const n = this.unread();
    this.badge.hidden = n === 0;
    this.badge.textContent = n > 9 ? '9+' : String(n);
    this.btn.setAttribute('aria-label', n ? `Notifications, ${n} unread` : 'Notifications');
  }

  open() {
    // The bell toggles: a second click closes the open panel.
    if (this.closePanel) {
      this.closePanel();
      return;
    }
    this.load();
    const panel = h('div.popover.notif-panel', { role: 'dialog', 'aria-label': 'Notifications' });
    const close = () => {
      this.closePanel = null;
      panel.remove();
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', onKey, true);
      this.btn.setAttribute('aria-expanded', 'false');
      this.btn.focus();
    };
    const outside = (e) => {
      if (!panel.contains(e.target) && !this.btn.contains(e.target)) close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    const render = () => {
      clear(panel);
      panel.append(h('div.notif-head', h('h2', 'Notifications'), this.items.length ? h('button.link-btn', { type: 'button', onclick: () => { this.items.forEach((n) => { n.read = true; }); this.save(); render(); } }, 'Mark all as read') : null));
      if (!this.items.length) {
        panel.append(h('p.notif-empty', 'You are all caught up. Assignments, customer replies on your tickets and mentions will show up here.'));
        return;
      }
      const list = h('ul.notif-list');
      for (const n of this.items) {
        list.append(h('li', h(`a.notif${n.read ? '' : '.unread'}`, {
          href: `#/tickets/${n.ticket}`,
          onclick: () => {
            n.read = true;
            this.save();
            close();
          },
        }, h('span.notif-icon', icon(n.kind === 'assigned' ? 'user-plus' : n.kind === 'mention' ? 'at-sign' : n.kind === 'new' ? 'inbox' : 'reply', { size: 15 })),
        h('span.notif-body', h('span.notif-text', n.text), h('span.notif-sub.ellipsis', n.subject), h('span.notif-time', relTime(n.at))))));
      }
      panel.append(list);
    };
    render();
    document.body.append(panel);
    const r = this.btn.getBoundingClientRect();
    panel.style.top = `${r.bottom + 6}px`;
    panel.style.left = `${Math.max(8, Math.min(r.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 8))}px`;
    this.btn.setAttribute('aria-expanded', 'true');
    this.closePanel = close;
    setTimeout(() => {
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
    (panel.querySelector('a, button') || panel).focus();
  }
}

/** Whether a note mentions you: @username or @firstname as a whole word. */
export function mentions(text, me) {
  const t = String(text || '').toLowerCase();
  const names = [me.username, me.name?.split(' ')[0]].filter(Boolean).map((n) => n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // "@al" must not match "@alice" or "@al.b" (another handle), but does
  // match at the end of a sentence ("Thanks @al.").
  return names.some((n) => new RegExp(`@${n}(?![\\p{L}\\p{N}_]|[.-][\\p{L}\\p{N}_])`, 'u').test(t));
}

/** Whether a note's @handles (see the server's mentionsIn) include this agent. */
export function mentionedIn(handles, me) {
  const names = [me.username, me.name?.split(' ')[0]].filter(Boolean).map((n) => n.toLowerCase());
  return names.some((n) => handles.includes(n));
}

export const notifications = new Notifications();
export { go };

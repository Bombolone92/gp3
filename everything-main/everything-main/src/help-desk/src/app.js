/**
 * The running app: who is signed in, which help desk is open, its local
 * copy, open ticket tabs, and the helpers views use to change data. Views
 * import `app` and listen to `app.replica` for changes.
 */
import { DeskApi, LOCAL, serverApi, accessRevoked } from './client/api.js';
import { Replica } from './client/replica.js';
import { clearDesk } from './client/cache.js';
import { loadUserDoc, rememberDesk, deskRef, setLast, forgetDesk } from './client/userdoc.js';
import { toastError } from './ui/toast.js';

/**
 * The app's public address without the query string, which can carry
 * Puter session parameters that must never end up in shared links.
 */
export function appBaseUrl() {
  return `${location.origin}${location.pathname}`;
}

const DEFAULT_LIST_ROUTE = '#/views/sys-mine';

class App extends EventTarget {
  constructor() {
    super();
    this.user = null;
    this.doc = null;
    this.api = null;
    this.replica = null;
    this.ref = null;
    this.tabs = [];
    this.drafts = new Map();
    // Drafts are kept per desk: ticket numbers start at 1 in every desk, so
    // a reply typed on one desk's #1 must never show up on another's.
    this.deskDrafts = new Map();
    this.lastListRoute = DEFAULT_LIST_ROUTE;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get me() {
    return this.replica?.me || null;
  }

  get isAdmin() {
    return !!this.replica?.isAdmin();
  }

  get server() {
    return this.api?.server || null;
  }

  async loadDoc() {
    this.doc = await loadUserDoc();
    return this.doc;
  }

  desks() {
    return Object.values(this.doc?.desks || {}).sort((a, b) => (b.at || 0) - (a.at || 0));
  }

  /** Open a help desk and its local copy. */
  async openDesk(server, desk) {
    if (this.replica) this.replica.close();
    this.api = new DeskApi(server, desk);
    this.ref = deskRef(server, desk);
    if (!this.deskDrafts.has(this.ref)) this.deskDrafts.set(this.ref, new Map());
    this.drafts = this.deskDrafts.get(this.ref);
    this.lastListRoute = DEFAULT_LIST_ROUTE;
    this.replica = new Replica(this.api, this.ref, server === LOCAL ? { pollMs: 5000, hiddenPollMs: 60000 } : {});
    this.loadTabs();
    this.emit('desk', { ref: this.ref });
    try {
      await this.replica.open();
    } catch (e) {
      if (accessRevoked(e)) {
        // The desk is gone or this agent was removed: keep none of it here.
        this.replica.close({ save: false });
        await clearDesk(this.ref);
        await forgetDesk(this.ref).catch(() => {});
        delete this.doc.desks[this.ref];
      }
      throw e;
    }
    const entry = this.doc?.desks?.[this.ref];
    const name = this.replica.meta?.name;
    const role = this.replica.me?.role;
    if (!entry || entry.name !== name || entry.role !== role) {
      await rememberDesk({ server, desk, name, role }).catch(() => {});
      this.doc.desks[this.ref] = { server, desk, name, role, at: Date.now() };
    } else if (this.doc.last !== this.ref) {
      setLast(this.ref).catch(() => {});
    }
    this.doc.last = this.ref;
    const { ref, replica } = this;
    replica.addEventListener('removed', () => {
      // Only the desk that lost access, and only while it is still the open one.
      replica.close({ save: false });
      clearDesk(ref);
      if (this.replica === replica) this.emit('removed');
    });
    return this.replica;
  }

  async createDesk({ name, agentName }) {
    const res = await serverApi.createDesk(LOCAL, {
      name,
      agentName,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      appUrl: appBaseUrl(),
    });
    await rememberDesk({ server: LOCAL, desk: res.desk, name, role: 'owner' });
    this.doc.desks[deskRef(LOCAL, res.desk)] = { server: LOCAL, desk: res.desk, name, role: 'owner', at: Date.now() };
    return res.desk;
  }

  /* ----------------------------------------------------------- tabs */

  tabsKey() {
    return `help-desk:tabs:${this.ref}`;
  }

  loadTabs() {
    try {
      this.tabs = JSON.parse(sessionStorage.getItem(this.tabsKey()) || '[]').filter((t) => t && t.id);
    } catch {
      this.tabs = [];
    }
    this.emit('tabs');
  }

  saveTabs() {
    try {
      sessionStorage.setItem(this.tabsKey(), JSON.stringify(this.tabs.slice(0, 20)));
    } catch {
      /* ignore */
    }
    this.emit('tabs');
  }

  openTab(tab) {
    if (!this.tabs.some((t) => t.id === tab.id)) {
      this.tabs.push(tab);
      if (this.tabs.length > 12) this.tabs.splice(0, this.tabs.length - 12);
      this.saveTabs();
    }
  }

  closeTab(id) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i === -1) return null;
    this.tabs.splice(i, 1);
    this.drafts.delete(id);
    this.saveTabs();
    return this.tabs[i] || this.tabs[i - 1] || null;
  }

  replaceTab(oldId, tab) {
    const i = this.tabs.findIndex((t) => t.id === oldId);
    if (i === -1) this.openTab(tab);
    else {
      this.tabs[i] = tab;
      this.saveTabs();
    }
  }

  /* -------------------------------------------------------- mutations */

  async updateTicket(id, body) {
    const res = await this.api.post(`/tickets/${id}`, body);
    if (res.ticket) this.replica.upsert('t', res.ticket);
    return res;
  }

  async ticketAction(id, action, body) {
    const res = await this.api.post(`/tickets/${id}/${action}`, body);
    if (res.ticket) this.replica.upsert('t', res.ticket);
    return res;
  }

  async bulk(ids, body) {
    const res = await this.api.post('/tickets-bulk', { ids, ...body });
    for (const r of res.results || []) if (r.ticket) this.replica.upsert('t', r.ticket);
    const failed = (res.results || []).filter((r) => r.error);
    if (failed.length) toastError({ message: `${failed.length} ticket${failed.length === 1 ? '' : 's'} could not be updated: ${failed[0].error}` });
    return res;
  }

  async saveConfig(kind, value) {
    const res = await this.api.put(`/cfg/${kind}`, { value });
    this.replica.setConfig(kind, res.value);
    return res.value;
  }

  async saveMeta(patch) {
    const res = await this.api.put('/meta', patch);
    this.replica.setMeta(res.meta);
    return res.meta;
  }

  /* ---------------------------------------------------------- helpers */

  memberName(uuid) {
    if (!uuid) return '';
    const m = this.replica?.members?.[uuid];
    return m ? m.name : 'Former agent';
  }

  userName(id) {
    return this.replica?.users.get(id)?.name || 'Unknown customer';
  }

  helpCenterUrl() {
    const meta = this.replica?.meta;
    if (!meta?.portal?.enabled || this.server === LOCAL) return null;
    return `${appBaseUrl()}#/help/${this.server}/${this.api.desk}`;
  }
}

export const app = new App();

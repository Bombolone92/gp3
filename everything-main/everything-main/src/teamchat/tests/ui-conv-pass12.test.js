/**
 * Conversation UI (review pass 12), driven in node on a small fake DOM:
 * enough of Element, Document and Event (a tree, attributes, classes,
 * focus, bubbling events, a selector engine for the selectors the modules
 * use) for the dialogs, the composer, the message rows and the conversation
 * view to be built and pressed. Puter is faked at `puter.workers.exec` where
 * a test reaches the worker; the toast, the theme and the modal layer are
 * mocked, since they paint the page at import.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const dom = vi.hoisted(() => {
  const state = { coarse: false };
  let doc = null;

  class FakeEvent {
    constructor(type, init = {}) {
      Object.assign(this, init);
      this.type = type;
      this.bubbles = !!init.bubbles;
      this.defaultPrevented = false;
      this.target = null;
      this.currentTarget = null;
      this._stop = false;
      this._stopNow = false;
    }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this._stop = true; }
    stopImmediatePropagation() { this._stop = true; this._stopNow = true; }
  }

  const fixFocus = () => { if (doc && !doc.activeElement.isConnected) doc.activeElement = doc.body; };

  class FakeNode {
    constructor() { this.parentNode = null; this.childNodes = []; this._listeners = new Map(); }
    get parentElement() { return this.parentNode instanceof FakeElement ? this.parentNode : null; }
    get firstChild() { return this.childNodes[0] || null; }
    get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
    get nextSibling() { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) + 1] || null; }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === doc; }
    contains(node) { for (let n = node; n; n = n.parentNode) if (n === this) return true; return false; }
    _insert(child, index) {
      if (child === null || child === undefined) return 0;
      let c = child;
      if (!(c instanceof FakeNode)) c = new FakeText(String(c));
      if (c instanceof FakeFragment) {
        const kids = c.childNodes.splice(0);
        kids.forEach((k, i) => { k.parentNode = this; this.childNodes.splice(index + i, 0, k); });
        return kids.length;
      }
      if (c.parentNode) c.parentNode.childNodes.splice(c.parentNode.childNodes.indexOf(c), 1);
      c.parentNode = this;
      this.childNodes.splice(index, 0, c);
      return 1;
    }
    append(...kids) { for (const k of kids) this._insert(k, this.childNodes.length); }
    appendChild(kid) { this._insert(kid, this.childNodes.length); return kid; }
    prepend(...kids) { let i = 0; for (const k of kids) i += this._insert(k, i); }
    remove() {
      const p = this.parentNode;
      if (!p) return;
      p.childNodes.splice(p.childNodes.indexOf(this), 1);
      this.parentNode = null;
      fixFocus();
    }
    replaceChildren(...kids) {
      for (const k of this.childNodes) k.parentNode = null;
      this.childNodes = [];
      this.append(...kids);
      fixFocus();
    }
    replaceWith(node) {
      const p = this.parentNode;
      if (!p) return;
      const i = p.childNodes.indexOf(this);
      p.childNodes.splice(i, 1);
      this.parentNode = null;
      p._insert(node, i);
      fixFocus();
    }
    after(node) { const p = this.parentNode; if (p) p._insert(node, p.childNodes.indexOf(this) + 1); }
    get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
    set textContent(v) { this.replaceChildren(); if (v !== '' && v != null) this.append(new FakeText(String(v))); }
    addEventListener(type, fn, opts) {
      const cap = opts === true || !!opts?.capture;
      let list = this._listeners.get(type);
      if (!list) this._listeners.set(type, (list = []));
      if (!list.some((l) => l.fn === fn && l.cap === cap)) list.push({ fn, cap, once: !!opts?.once });
    }
    removeEventListener(type, fn, opts) {
      const cap = opts === true || !!opts?.capture;
      const list = this._listeners.get(type) || [];
      const i = list.findIndex((l) => l.fn === fn && l.cap === cap);
      if (i > -1) list.splice(i, 1);
    }
    dispatchEvent(ev) {
      // A real Event (the modules' own `new Event('input')`) is read here as
      // one of ours: node's has a read-only target and is never looked at
      // again by its dispatcher.
      if (!(ev instanceof FakeEvent)) {
        const init = {};
        for (const k of ['bubbles', 'key', 'code', 'keyCode', 'isComposing', 'shiftKey', 'metaKey', 'ctrlKey', 'altKey', 'repeat', 'clientX', 'clientY', 'detail']) if (ev[k] !== undefined) init[k] = ev[k];
        ev = new FakeEvent(ev.type, init);
      }
      ev.target = this;
      const path = [];
      for (let n = this; n; n = n.parentNode) path.push(n);
      const call = (node, cap) => {
        for (const l of [...(node._listeners.get(ev.type) || [])]) {
          if (l.cap !== cap) continue;
          if (l.once) node.removeEventListener(ev.type, l.fn, l.cap);
          ev.currentTarget = node;
          l.fn.call(node, ev);
          if (ev._stopNow) return;
        }
      };
      for (let i = path.length - 1; i > 0 && !ev._stop; i--) call(path[i], true);
      if (!ev._stop) { call(this, true); if (!ev._stopNow) call(this, false); }
      if (ev.bubbles) for (let i = 1; i < path.length && !ev._stop; i++) call(path[i], false);
      ev.currentTarget = null;
      return !ev.defaultPrevented;
    }
  }

  class FakeText extends FakeNode {
    constructor(data) { super(); this.nodeType = 3; this.data = data; }
    get textContent() { return this.data; }
    set textContent(v) { this.data = String(v); }
  }

  class FakeFragment extends FakeNode {
    constructor() { super(); this.nodeType = 11; }
  }

  class FakeElement extends FakeNode {
    constructor(tag) {
      super();
      this.nodeType = 1;
      this.localName = tag.toLowerCase();
      this.tagName = tag.toUpperCase();
      this._attrs = new Map();
      this.dataset = {};
      this.style = {};
      this._html = null;
      this._value = '';
      this.checked = false;
      this.selectionStart = 0;
      this.selectionEnd = 0;
      this.scrollTop = 0;
      this.scrollHeight = 0;
      this.clientHeight = 0;
      this.clientWidth = 0;
      this.offsetWidth = 0;
    }
    /** A stand-in for layout: every text line is 20px tall and boxes stack, so two bodies of different content measure differently. */
    get offsetHeight() { return this.hidden ? 0 : this.childNodes.reduce((n, c) => n + (c instanceof FakeElement ? c.offsetHeight : 20), 0); }
    set offsetHeight(v) { Object.defineProperty(this, 'offsetHeight', { value: v, writable: true, configurable: true }); }
    get id() { return this.getAttribute('id') || ''; }
    set id(v) { this.setAttribute('id', v); }
    get className() { return this.getAttribute('class') || ''; }
    set className(v) { this.setAttribute('class', v); }
    get classList() {
      const self = this;
      const get = () => (self.getAttribute('class') || '').split(/\s+/).filter(Boolean);
      const set = (arr) => self.setAttribute('class', arr.join(' '));
      return {
        add(...c) { const cur = get(); for (const x of c) if (!cur.includes(x)) cur.push(x); set(cur); },
        remove(...c) { set(get().filter((x) => !c.includes(x))); },
        contains(c) { return get().includes(c); },
        toggle(c, force) {
          const has = get().includes(c);
          const want = force === undefined ? !has : !!force;
          if (want && !has) this.add(c);
          if (!want && has) this.remove(c);
          return want;
        },
      };
    }
    get hidden() { return this.hasAttribute('hidden'); }
    set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
    get disabled() { return this.hasAttribute('disabled'); }
    set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
    get title() { return this.getAttribute('title') || ''; }
    set title(v) { this.setAttribute('title', v); }
    get tabIndex() { return Number(this.getAttribute('tabindex') ?? -1); }
    set tabIndex(v) { this.setAttribute('tabindex', v); }
    get value() { return this._value; }
    set value(v) { this._value = String(v); this.selectionStart = this.selectionEnd = this._value.length; }
    get innerHTML() { return this._html ?? this.childNodes.map((c) => (c instanceof FakeElement ? c.outerHTML : c.textContent)).join(''); }
    set innerHTML(v) { this._html = String(v); this.replaceChildren(); }
    get outerHTML() { return `<${this.localName}${[...this._attrs].map(([k, v]) => ` ${k}="${v}"`).join('')}>${this.innerHTML}</${this.localName}>`; }
    get children() { return this.childNodes.filter((c) => c instanceof FakeElement); }
    setAttribute(k, v) { this._attrs.set(k, String(v)); }
    getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; }
    getAttributeNames() { return [...this._attrs.keys()]; }
    get attributes() { return [...this._attrs].map(([name, value]) => ({ name, value })); }
    hasAttribute(k) { return this._attrs.has(k); }
    removeAttribute(k) { this._attrs.delete(k); }
    focus() { if (this.isConnected && !this.disabled) doc.activeElement = this; }
    blur() { if (doc.activeElement === this) doc.activeElement = doc.body; }
    click() { this.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true })); }
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }; }
    getClientRects() { return this.isConnected && !this.hidden ? [{}] : []; }
    get offsetParent() { return this.isConnected && !this.hidden ? this.parentElement : null; }
    scrollIntoView() {}
    setSelectionRange(s, e) { this.selectionStart = s; this.selectionEnd = e; }
    setRangeText(text, start = this.selectionStart, end = this.selectionEnd, mode = 'preserve') {
      this._value = this._value.slice(0, start) + text + this._value.slice(end);
      if (mode === 'end') this.selectionStart = this.selectionEnd = start + text.length;
      else if (mode === 'start') this.selectionStart = this.selectionEnd = start;
      else if (mode === 'select') { this.selectionStart = start; this.selectionEnd = start + text.length; }
    }
    matches(sel) { return matchesList(this, sel, null); }
    closest(sel) { for (let n = this; n instanceof FakeElement; n = n.parentNode) if (n.matches(sel)) return n; return null; }
    querySelectorAll(sel) { return queryAll(this, sel); }
    querySelector(sel) { return queryAll(this, sel)[0] || null; }
  }

  class FakeDocument extends FakeNode {
    constructor() {
      super();
      this.nodeType = 9;
      this.documentElement = new FakeElement('html');
      this.documentElement.parentNode = this;
      this.childNodes.push(this.documentElement);
      this.body = new FakeElement('body');
      this.documentElement.append(this.body);
      this.activeElement = this.body;
      this.hidden = false;
      this.baseURI = 'https://app.example/';
    }
    createElement(tag) { return new FakeElement(tag); }
    createElementNS(ns, tag) { return new FakeElement(tag); }
    createTextNode(t) { return new FakeText(t); }
    createDocumentFragment() { return new FakeFragment(); }
    getElementById(id) { return queryAll(this.documentElement, `[id="${id}"]`)[0] || null; }
    querySelectorAll(sel) { return queryAll(this.documentElement, sel); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    elementFromPoint() { return null; }
  }

  /* ---- selectors: tag, .class, #id, [attr], [attr="v"], :not(), :scope, ' ' and '>' , lists ---- */
  const parsed = new Map();
  function splitTop(s, sep) {
    const out = [];
    let depth = 0;
    let buf = '';
    for (const ch of s) {
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth--;
      if (depth === 0 && ch === sep) { out.push(buf); buf = ''; } else buf += ch;
    }
    out.push(buf);
    return out;
  }
  function parseCompound(s) {
    const parts = [];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '*') { i++; continue; }
      if (ch === '.' || ch === '#') {
        const m = /^[\w-]+/.exec(s.slice(i + 1));
        parts.push({ t: ch === '.' ? 'class' : 'id', v: m[0] });
        i += 1 + m[0].length;
      } else if (ch === '[') {
        const j = s.indexOf(']', i);
        const inner = s.slice(i + 1, j);
        const eq = inner.indexOf('=');
        if (eq < 0) parts.push({ t: 'attr', n: inner.trim() });
        else parts.push({ t: 'attr', n: inner.slice(0, eq).trim(), v: inner.slice(eq + 1).trim().replace(/^["']|["']$/g, '') });
        i = j + 1;
      } else if (ch === ':') {
        const m = /^:([\w-]+)/.exec(s.slice(i));
        i += m[0].length;
        if (s[i] === '(') {
          let depth = 1;
          let j = i + 1;
          while (j < s.length && depth) { if (s[j] === '(') depth++; else if (s[j] === ')') depth--; j++; }
          parts.push({ t: 'pseudo', name: m[1], inner: parseCompound(s.slice(i + 1, j - 1)) });
          i = j;
        } else parts.push({ t: 'pseudo', name: m[1] });
      } else {
        const m = /^[a-zA-Z][\w-]*/.exec(s.slice(i));
        if (!m) throw new Error(`fake dom: cannot parse selector "${s}"`);
        parts.push({ t: 'tag', v: m[0].toLowerCase() });
        i += m[0].length;
      }
    }
    return parts;
  }
  function parseComplex(s) {
    const out = [];
    let buf = '';
    let pending = null;
    let depth = 0;
    const flush = () => { if (buf.trim()) { out.push({ parts: parseCompound(buf.trim()), comb: pending }); buf = ''; pending = null; } };
    for (const ch of s) {
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth--;
      if (depth === 0 && (ch === ' ' || ch === '>')) {
        flush();
        if (ch === '>') pending = '>';
        else if (out.length && !pending) pending = ' ';
        continue;
      }
      buf += ch;
    }
    flush();
    return out;
  }
  function parse(sel) {
    if (!parsed.has(sel)) parsed.set(sel, splitTop(sel, ',').map((s) => parseComplex(s.trim())).filter((c) => c.length));
    return parsed.get(sel);
  }
  function matchSimple(el, p, scope) {
    if (p.t === 'tag') return el.localName === p.v;
    if (p.t === 'class') return el.classList.contains(p.v);
    if (p.t === 'id') return el.id === p.v;
    if (p.t === 'attr') return el.hasAttribute(p.n) && (p.v === undefined || el.getAttribute(p.n) === p.v);
    if (p.name === 'not') return !p.inner.every((q) => matchSimple(el, q, scope));
    if (p.name === 'scope') return el === scope;
    if (p.name === 'focus') return doc.activeElement === el;
    return false; // :hover, :focus-visible, :focus-within
  }
  function matchComplex(el, complex, i, scope) {
    if (!complex[i].parts.every((p) => matchSimple(el, p, scope))) return false;
    if (i === 0) return true;
    if (complex[i].comb === '>') return el.parentNode instanceof FakeElement && matchComplex(el.parentNode, complex, i - 1, scope);
    for (let p = el.parentNode; p instanceof FakeElement; p = p.parentNode) if (matchComplex(p, complex, i - 1, scope)) return true;
    return false;
  }
  function matchesList(el, sel, scope) {
    return parse(sel).some((complex) => matchComplex(el, complex, complex.length - 1, scope));
  }
  function queryAll(root, sel) {
    const out = [];
    const walk = (n) => { for (const c of n.childNodes) { if (c instanceof FakeElement) { if (matchesList(c, sel, root)) out.push(c); walk(c); } } };
    walk(root);
    return out;
  }

  doc = new FakeDocument();
  const storage = new Map();
  Object.assign(globalThis, {
    Node: FakeNode, Element: FakeElement, HTMLElement: FakeElement,
    document: doc,
    window: globalThis,
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    matchMedia: (q) => ({ matches: q.includes('pointer: coarse') ? state.coarse : q.includes('min-width') ? !state.coarse : false, addEventListener() {}, removeEventListener() {} }),
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k), clear: () => storage.clear() },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    location: { hash: '', href: 'https://app.example/', origin: 'https://app.example', pathname: '/' },
  });
  return {
    doc,
    Event: FakeEvent,
    setCoarse(v) { state.coarse = v; },
    /** A fresh page: everything off the body, focus on it. */
    reset() { doc.body.replaceChildren(); doc.activeElement = doc.body; state.coarse = false; storage.clear(); },
  };
});

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/ui/theme.js', () => ({ applyTheme: vi.fn(), currentTheme: () => 'system', isDark: () => false }));
vi.mock('../src/ui/modal.js', () => ({
  confirmDialog: vi.fn(async () => true),
  closeAllModals: vi.fn(),
  // The dialog's content goes onto the page as it would inside a panel; close takes it off and tells the opener.
  openModal: vi.fn(({ content, onClose }) => {
    document.body.append(content);
    const close = vi.fn(() => { content.remove(); onClose?.(); });
    return { close, panel: content, root: content };
  }),
}));
vi.mock('../src/lib/router.js', async (importOriginal) => ({ ...(await importOriginal()), navigate: vi.fn() }));
// The email worker is deployed, so the invite dialogs have their Invite link | Email switch.
vi.mock('../src/lib/email.js', async (importOriginal) => ({ ...(await importOriginal()), emailAvailable: () => true }));

import { store } from '../src/lib/store.js';
import { navigate } from '../src/lib/router.js';
import { toast } from '../src/ui/toast.js';
import { openModal, confirmDialog } from '../src/ui/modal.js';
import { openDetailsDialog } from '../src/ui/details.js';
import { leaveChannelFlow, newDmDialog, membersDialog, confirmBroadcast, inviteDialog, guestInviteDialog, transferDialog, acceptTransferDialog } from '../src/ui/dialogs.js';
import { createConversationView } from '../src/ui/conversation.js';
import { renderThreadPanel } from '../src/ui/panel.js';
import { createMessageList } from '../src/ui/messagelist.js';
import { openEmojiPicker } from '../src/ui/emojipicker.js';
import { renderMessage, startInlineEdit } from '../src/ui/message.js';
import { createComposer } from '../src/ui/composer.js';
import { bookmarksDialog } from '../src/ui/bookmarks.js';
import { api } from '../src/lib/api.js';

const REF = 'abc123def0@teamchat-test';
const tick = (ms = 2) => new Promise((r) => setTimeout(r, ms));

/** A workspace with two channels the member is in and a teammate. */
function openPlain() {
  store.wsId = REF;
  store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  store.ws = {
    id: 'abc123def0', name: 'Globex',
    channels: { c1: { id: 'c1', name: 'general', def: true, count: 2 }, c2: { id: 'c2', name: 'random', count: 2 } },
    members: { 'u-me': { role: 'member', name: 'Me', username: 'me', color: 1 }, u2: { role: 'member', name: 'Ana Rocha', username: 'ana', color: 2 }, u3: { role: 'member', name: 'Ben Ito', username: 'ben', color: 3 } },
  };
  store.me = { role: 'member', channels: ['c1', 'c2'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
  store.act = { c: {}, p: {}, w: 0, u: 0 };
}

beforeEach(() => {
  dom.reset();
  vi.clearAllMocks();
  openPlain();
});

afterEach(() => {
  vi.restoreAllMocks();
  store.stopPolling();
  store.wsId = null;
  store.ws = null;
  store.me = null;
  store.profile = null;
  store.convs.clear();
  delete globalThis.puter;
});

describe('leaving a channel', () => {
  it('moves the reader on only when the channel left is the one on screen', async () => {
    vi.spyOn(store, 'leaveChannel').mockResolvedValue({});
    vi.spyOn(store, 'joinedChannels').mockReturnValue([{ id: 'c1' }]);
    // Reading #general, leaving #random from its sidebar row: #general stays open.
    location.hash = `#/ws/${REF}/c/c1`;
    expect(await leaveChannelFlow({ id: 'c2', name: 'random' })).toBe(true);
    expect(store.leaveChannel).toHaveBeenCalledWith('c2');
    expect(toast).toHaveBeenCalledWith('Left #random');
    expect(navigate).not.toHaveBeenCalled();
    // In the Threads view, likewise.
    location.hash = `#/ws/${REF}/threads`;
    await leaveChannelFlow({ id: 'c2', name: 'random' });
    expect(navigate).not.toHaveBeenCalled();
    // Leaving the channel being read (or one of its threads) lands on the first channel still joined.
    location.hash = `#/ws/${REF}/c/c2/t/12`;
    await leaveChannelFlow({ id: 'c2', name: 'random' });
    expect(navigate).toHaveBeenCalledWith({ ws: REF, conv: 'c1' });
  });
});

describe('the people picker (New message)', () => {
  const open = () => {
    newDmDialog();
    const content = openModal.mock.calls.at(-1)[0].content;
    return { content, search: content.querySelector('input[type="search"]'), items: () => content.querySelectorAll('.pick-item') };
  };

  it('on a phone, a tap on a person leaves the focus where the tap left it, so the keyboard stays down', () => {
    dom.setCoarse(true);
    const { content, search, items } = open();
    expect(items().length).toBe(2); // Ana and Ben; never oneself
    // A tap on a button focuses nothing on a touch screen: the page body keeps the focus.
    items()[0].click();
    expect(content.querySelectorAll('.chip').length).toBe(1);
    expect(items()[0].getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).not.toBe(search);
    // Nor does taking the chip off again.
    content.querySelector('.chip button').click();
    expect(content.querySelectorAll('.chip').length).toBe(0);
    expect(document.activeElement).not.toBe(search);
  });

  it('with a keyboard, the last chip removed hands the focus to the search box rather than the page body', () => {
    const { content, search, items } = open();
    items()[0].focus();
    items()[0].click();
    const remove = content.querySelector('.chip button');
    remove.focus();
    remove.click();
    expect(content.querySelectorAll('.chip').length).toBe(0);
    expect(document.activeElement).toBe(search);
  });

  it('finds accented names from what is typed in ASCII, as the mention list does', () => {
    store.ws.members.u4 = { role: 'member', name: 'José Álvarez', username: 'jalvarez', color: 4 };
    store.ws.members.u5 = { role: 'member', name: 'Hanna Müller', username: 'hmueller', color: 5 };
    const { content, search, items } = open();
    const type = (q) => { search.value = q; search.dispatchEvent(new Event('input')); };
    const names = () => [...items()].map((n) => n.querySelector('strong').textContent);
    type('jose');
    expect(names()).toEqual(['José Álvarez']);
    type('muller');
    expect(names()).toEqual(['Hanna Müller']);
    type('alvarez');
    expect(names()).toEqual(['José Álvarez']);
    type('zzz');
    expect(names()).toEqual([]);
    expect(content.querySelector('.empty p').textContent).toBe('Nobody matches');
  });
});

describe('the broadcast question', () => {
  const ask = async (convId) => {
    const answer = confirmBroadcast(convId, '@channel are you there?');
    const content = openModal.mock.calls.at(-1)[0].content;
    const words = content.querySelector('p').textContent;
    content.querySelector('.modal-actions .btn-ghost').click(); // Cancel
    expect(await answer).toBe(false);
    return words;
  };

  it('speaks of the conversation, not the channel, in a direct message', async () => {
    store.me.dms.d1 = { id: 'd1', members: ['u-me', 'u2'] };
    const dm = await ask('d1');
    expect(dm).toContain('@channel will notify 1 person in this conversation');
    expect(dm).toContain('muted the conversation');
    expect(dm).not.toContain('the channel');
    const channel = await ask('c2');
    expect(channel).toContain('in #random');
    expect(channel).toContain('muted the channel');
  });
});

describe('the invite dialogs', () => {
  /** The tabbed body under the strip: the strip's next sibling. */
  const parts = (content) => {
    const strip = content.querySelector('.seg');
    const body = strip.nextSibling;
    return { strip, body, tabOf: (label) => [...strip.querySelectorAll('button')].find((b) => b.textContent.trim() === label) };
  };
  const heightOf = (body) => body.offsetHeight;
  const minOf = (body) => parseInt(body.style.minHeight, 10);

  it('keep the height of their taller tab whichever tab shows, so the strip stands still', () => {
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    Object.assign(store.ws, { invite: 'ABCD-EFGH-IJKL', inviteExp: Date.now() + 86_400_000 });
    inviteDialog();
    const content = openModal.mock.calls.at(-1)[0].content;
    let { body, tabOf } = parts(content);
    expect(content.querySelector('textarea')).toBeNull(); // the link tab is up
    const link = heightOf(body);
    const emailMin = minOf(body);
    expect(emailMin).toBeGreaterThan(0);
    tabOf('Email').click();
    ({ body, tabOf } = parts(content));
    expect(content.querySelector('textarea')).toBeTruthy(); // the email tab is up, and the probe is gone
    expect(content.querySelectorAll('textarea').length).toBe(1);
    expect(content.querySelectorAll('[inert]').length).toBe(0);
    const email = heightOf(body);
    const linkMin = minOf(body);
    // Each tab is held at least as tall as the other: the same height either way.
    expect(emailMin).toBe(email);
    expect(linkMin).toBe(link);
    expect(Math.max(link, emailMin)).toBe(Math.max(email, linkMin));
    expect(email).not.toBe(link); // the two do differ, which is what moved the strip
  });

  it('do the same for a channel\'s guest invite', () => {
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    guestInviteDialog(store.ws.channels.c2);
    const content = openModal.mock.calls.at(-1)[0].content;
    let { body, tabOf } = parts(content);
    const link = heightOf(body);
    const emailMin = minOf(body);
    tabOf('Email').click();
    ({ body } = parts(content));
    expect(content.querySelectorAll('textarea').length).toBe(1);
    expect(emailMin).toBe(heightOf(body));
    expect(minOf(body)).toBe(link);
  });
});

describe('the transfer dialogs', () => {
  it('say that webhooks and bot tokens stay behind, on both sides of the handover', async () => {
    store.ws.owner = 'u-me';
    store.ws.members['u-me'].role = 'owner';
    store.me.role = 'owner';
    store.ws.members.u2.role = 'admin';
    transferDialog();
    let content = openModal.mock.calls.at(-1)[0].content;
    expect(content.querySelector('p').textContent).toContain('Webhooks and bot tokens do not move: the new owner makes them again from Workspace settings');
    // The nominee's side.
    store.ws.owner = 'u2';
    store.ws.members.u2.role = 'owner';
    store.ws.members['u-me'].role = 'admin';
    store.me.role = 'admin';
    store.ws.transferTo = 'u-me';
    await acceptTransferDialog();
    content = openModal.mock.calls.at(-1)[0].content;
    expect(content.querySelector('p').textContent).toContain('Webhooks and bot tokens stay behind: make them again from Workspace settings');
  });
});

describe('the members dialog', () => {
  it('finds accented names from what is typed in ASCII', () => {
    store.ws.members.u4 = { role: 'member', name: 'José Álvarez', username: 'jalvarez', color: 4 };
    membersDialog();
    const content = openModal.mock.calls.at(-1)[0].content;
    const search = content.querySelector('input[type="search"]');
    const names = () => [...content.querySelectorAll('.pick-item strong')].map((n) => n.textContent);
    expect(names()).toEqual(['Ana Rocha', 'Ben Ito', 'José Álvarez', 'Me (you)']);
    search.value = 'jose';
    search.dispatchEvent(new Event('input'));
    expect(names()).toEqual(['José Álvarez']);
  });
});

describe('the details dialog', () => {
  it('takes one press at a time on a row whose action asks and then waits on the worker', async () => {
    let release;
    vi.spyOn(store, 'leaveChannel').mockImplementation(() => new Promise((r) => { release = r; }));
    vi.spyOn(store, 'joinedChannels').mockReturnValue([{ id: 'c1' }]);
    location.hash = `#/ws/${REF}/c/c2`;
    const dialog = openDetailsDialog('c2');
    const content = openModal.mock.calls.at(-1)[0].content;
    const leave = [...content.querySelectorAll('button.details-row')].find((b) => b.textContent.includes('Leave channel'));
    expect(leave).toBeTruthy();
    // Two presses before the question is even answered: one question, one leave.
    leave.click();
    leave.click();
    await tick();
    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(store.leaveChannel).toHaveBeenCalledTimes(1);
    expect(leave.getAttribute('aria-busy')).toBe('true');
    release({});
    await tick();
    expect(navigate).toHaveBeenCalledWith({ ws: REF, conv: 'c1' });
    dialog.close();
  });

  it('follows a star given elsewhere while it stands open', () => {
    const dialog = openDetailsDialog('c2');
    const content = openModal.mock.calls.at(-1)[0].content;
    const star = () => content.querySelector('.details-star');
    expect(star().textContent.trim()).toBe('Star');
    expect(star().getAttribute('aria-pressed')).toBe('false');
    // Starred from another tab: the profile's preferences come back with it, and the workspace event follows.
    store.profile.prefs.starred = { [REF]: ['c2'] };
    store.emit('workspace');
    expect(star().textContent.trim()).toBe('Starred');
    expect(star().getAttribute('aria-pressed')).toBe('true');
    dialog.close();
  });
});

describe('the bookmarks dialog', () => {
  const B = { Roadmap: 'https://a.example/', Tracker: 'https://b.example/', Dashboard: 'https://c.example/' };
  const list = (...labels) => labels.map((label) => ({ label, url: B[label] }));

  it('moves a bookmark two places for two quick presses of its arrow, and lets the earlier answer stand down', async () => {
    store.ws.channels.c1.bookmarks = list('Roadmap', 'Tracker', 'Dashboard');
    const written = [];
    const answers = [];
    vi.spyOn(api, 'updateChannel').mockImplementation((ws, id, patch) => {
      written.push(patch.bookmarks.map((b) => b.label));
      return new Promise((r) => answers.push(r));
    });
    vi.spyOn(store, 'refreshAfterChange').mockResolvedValue();
    bookmarksDialog(store.ws.channels.c1);
    const content = openModal.mock.calls.at(-1)[0].content;
    const labels = () => [...content.querySelectorAll('.bm-row strong')].map((n) => n.textContent);
    const up = () => content.querySelector('[aria-label="Move Dashboard up"]');
    up().click();
    up().click();
    expect(written).toEqual([['Roadmap', 'Dashboard', 'Tracker'], ['Dashboard', 'Roadmap', 'Tracker']]);
    expect(labels()).toEqual(['Dashboard', 'Roadmap', 'Tracker']);
    expect(up().disabled).toBe(true); // at the top now
    // The first answer lands: it must not undo the second press.
    answers[0]({ channel: { bookmarks: list('Roadmap', 'Dashboard', 'Tracker') } });
    await tick();
    expect(labels()).toEqual(['Dashboard', 'Roadmap', 'Tracker']);
    answers[1]({ channel: { bookmarks: list('Dashboard', 'Roadmap', 'Tracker') } });
    await tick();
    expect(labels()).toEqual(['Dashboard', 'Roadmap', 'Tracker']);
    expect(toast).not.toHaveBeenCalledWith(expect.anything(), { icon: 'alert' });
  });

  it('puts the list back when the worker refuses', async () => {
    store.ws.channels.c1.bookmarks = list('Roadmap', 'Tracker');
    vi.spyOn(api, 'updateChannel').mockRejectedValue(new Error('Only admins can change bookmarks'));
    vi.spyOn(store, 'refreshAfterChange').mockResolvedValue();
    bookmarksDialog(store.ws.channels.c1);
    const content = openModal.mock.calls.at(-1)[0].content;
    const labels = () => [...content.querySelectorAll('.bm-row strong')].map((n) => n.textContent);
    content.querySelector('[aria-label="Remove Tracker"]').click();
    expect(labels()).toEqual(['Roadmap']);
    await tick();
    expect(labels()).toEqual(['Roadmap', 'Tracker']);
    expect(toast).toHaveBeenCalledWith('Only admins can change bookmarks', { icon: 'alert' });
  });
});

describe('the strips above the messages', () => {
  it('keep the keyboard on the pinned bar toggle when the channel changes under them', () => {
    store.act.c.c1 = { pc: 2 };
    Object.assign(store.conv('c1'), { loaded: true, seq: 0, hasMore: false, messages: [] });
    const view = createConversationView('c1', { onOpenThread() {}, onOpenDetails() {} });
    document.body.append(view.el);
    const toggle = view.el.querySelector('.pin-bar-toggle');
    expect(toggle.textContent).toBe('2 pinned');
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    // A teammate joins the channel: its count moves, and the strips are redrawn.
    store.ws.channels.c1.count = 3;
    store.emit('workspace');
    const again = view.el.querySelector('.pin-bar-toggle');
    // The bar itself is kept through the redraw (its list stays as the reader
    // left it); the toggle is the same one, back in the redrawn strips.
    expect(again).toBe(toggle);
    expect(again.textContent).toBe('2 pinned');
    expect(document.activeElement).toBe(again);
    view.destroy();
  });
});

describe('the message list', () => {
  const message = (seq) => ({ seq, user: 'u2', text: `m${seq}`, ts: 1_700_000_000_000 + seq, kind: 'msg', attachments: [], mentions: [], reactions: {} });

  it('keeps a conversation marked unread from here while the reader stays put, until a message arrives under them', async () => {
    Object.assign(store.conv('c1'), { loaded: true, seq: 5, hasMore: false, messages: [1, 2, 3, 4, 5].map(message) });
    store.me.reads.c1 = 5;
    store.act.c.c1 = { s: 5 };
    const markRead = vi.spyOn(store, 'markRead').mockImplementation(() => {});
    vi.spyOn(api, 'markUnread').mockResolvedValue({});
    const list = createMessageList({ convId: 'c1', onOpenThread() {}, onShowMember() {} });
    document.body.append(list.el);
    await tick(); // lands at the bottom, which is read
    expect(markRead).toHaveBeenCalledWith('c1', 5);
    markRead.mockClear();
    // "Mark unread from here" on m3: the cursor goes back to m2.
    await store.markUnread('c1', 3);
    expect(store.me.reads.c1).toBe(2);
    // Still at the bottom: a scroll event, a redraw, the tab shown again are not a read.
    list.scroller.dispatchEvent(new Event('scroll'));
    store.emit('messages', { conv: 'c1', reason: 'range' });
    await tick();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(markRead).not.toHaveBeenCalled();
    // A message arrives while the reader is at the bottom: now they are reading, and it is read.
    store.conv('c1').messages.push(message(6));
    store.conv('c1').seq = 6;
    store.emit('messages', { conv: 'c1', reason: 'newer', added: [message(6)] });
    await tick();
    expect(markRead).toHaveBeenCalledWith('c1', 6);
    list.destroy();
  });
});

describe('the thread panel', () => {
  it('moves the keyboard to Close, and says why, when the thread\'s message is deleted under a reply being typed', async () => {
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    const root = { seq: 5, user: 'u2', text: 'root', ts: 1_700_000_000_000, kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0 };
    Object.assign(store.conv('c1'), { loaded: true, seq: 5, hasMore: false, messages: [root] });
    Object.assign(store.conv('c1_t5'), { loaded: true, seq: 0, hasMore: false, messages: [] });
    const panel = document.createElement('div');
    document.body.append(panel);
    const thread = renderThreadPanel(panel, { convId: 'c1', seq: 5, onClose() {} });
    const textarea = panel.querySelector('textarea');
    expect(textarea).toBeTruthy();
    textarea.focus();
    textarea.value = 'a reply in progress';
    textarea.dispatchEvent(new Event('input'));
    expect(document.activeElement).toBe(textarea);
    // The message the thread hangs from is deleted elsewhere.
    root.deleted = true;
    store.emit('messages', { conv: 'c1', reason: 'range' });
    expect(panel.querySelector('textarea')).toBeNull();
    const note = panel.querySelector('.composer-blocked');
    expect(note.getAttribute('role')).toBe('status');
    expect(document.activeElement).toBe(panel.querySelector('.panel-head [aria-label="Close panel"]'));
    await tick();
    expect(note.textContent).toBe('This thread is closed: its message was deleted');
    thread.destroy();
  });
});

describe('right-to-left text', () => {
  it('takes its direction from its own letters in a message, in the edit box and in the composer', () => {
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    const msg = { seq: 7, user: 'u-me', text: 'שלום https://example.com/x עולם', ts: 1_700_000_000_000, kind: 'msg', attachments: [], mentions: [], reactions: {} };
    const row = renderMessage(msg, { convId: 'c1', membersByUsername: store.membersByUsername(), onOpenThread() {}, onShowMember() {} });
    document.body.append(row);
    expect(row.querySelector('.msg-text').getAttribute('dir')).toBe('auto');
    expect(startInlineEdit(row)).toBe(true);
    expect(row.querySelector('.msg-edit-input').getAttribute('dir')).toBe('auto');
    const composer = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1' });
    expect(composer.textarea.getAttribute('dir')).toBe('auto');
    composer.destroy();
  });
});

describe('the emoji picker', () => {
  it('walks the skin tones with the arrow keys, Home and End', () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const pop = openEmojiPicker(anchor, { onPick() {} });
    pop.node.querySelector('.emoji-tone').click();
    const tones = [...pop.node.querySelectorAll('.emoji-tones button')];
    expect(tones.length).toBe(6);
    expect(document.activeElement).toBe(tones[0]);
    const press = (key) => document.activeElement.dispatchEvent(new dom.Event('keydown', { key, bubbles: true }));
    press('ArrowRight');
    expect(document.activeElement).toBe(tones[1]);
    press('ArrowDown');
    expect(document.activeElement).toBe(tones[2]);
    press('ArrowLeft');
    expect(document.activeElement).toBe(tones[1]);
    press('End');
    expect(document.activeElement).toBe(tones[5]);
    press('ArrowRight'); // round to the start
    expect(document.activeElement).toBe(tones[0]);
    press('ArrowUp');
    expect(document.activeElement).toBe(tones[5]);
    press('Home');
    expect(document.activeElement).toBe(tones[0]);
    pop.close();
  });
});

describe('the message shortcuts', () => {
  const message = () => ({ seq: 5, user: 'u2', text: 'hello', ts: 1_700_000_000_000, kind: 'msg', attachments: [], mentions: [], reactions: {} });
  const rowFor = (msg) => {
    const row = renderMessage(msg, { convId: 'c1', membersByUsername: store.membersByUsername(), onOpenThread() {}, onShowMember() {} });
    document.body.append(row);
    row.focus();
    return row;
  };
  const press = (node, key, extra = {}) => node.dispatchEvent(new dom.Event('keydown', { key, bubbles: true, ...extra }));

  it('save a message once while the first save is out, and not at all for a held key\'s repeats', async () => {
    let release;
    const save = vi.spyOn(store, 'save').mockImplementation(() => new Promise((r) => { release = r; }));
    const row = rowFor(message());
    press(row, 's');
    press(row, 's');
    press(row, 's', { repeat: true });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('c1', 5);
    release();
    await tick();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('Saved for later', { icon: 'bookmark' });
    // Answered: the next press is a toggle of its own.
    press(row, 's');
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('pin a message once from two quick presses of P', async () => {
    let release;
    const pin = vi.spyOn(store, 'pin').mockImplementation(() => new Promise((r) => { release = r; }));
    const row = rowFor(message());
    press(row, 'p');
    press(row, 'p');
    expect(pin).toHaveBeenCalledTimes(1);
    release({});
    await tick();
    expect(toast).toHaveBeenCalledTimes(1);
  });
});

describe('the composer', () => {
  it('says how far @channel, @here and @everyone reach, the sender left out, and that nobody else is active rather than "about 0"', () => {
    vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    store.ws.members['u-me'].role = 'admin'; // #general is admins-only for broadcasts, and the only place @everyone works
    store.me.role = 'admin';
    store.ws.channels.c1.count = 2; // me and one other
    const composer = createComposer({ onSend: vi.fn(), convId: 'c1', typingConv: 'c1' });
    document.body.append(composer.el);
    const { textarea } = composer;
    textarea.value = '@';
    textarea.dispatchEvent(new Event('input'));
    const rows = () => [...composer.el.querySelectorAll('.mention-pop .pick-item')].map((n) => [...n.querySelectorAll('.pick-text span')].map((s) => s.textContent).join(''));
    expect(rows().slice(0, 3)).toEqual([
      'Notify everyone in #general, 1 person',
      'Notify people active now, nobody else active now',
      'Notify the whole workspace, 2 people',
    ]);
    // The line wraps where the popup is narrow, rather than being cut short; a person's handle does not.
    expect([...composer.el.querySelectorAll('.mention-pop .pick-item')].slice(0, 3).every((n) => n.querySelector('.pick-text span').classList.contains('pick-wrap'))).toBe(true);
    expect(composer.el.querySelectorAll('.mention-pop .pick-item')[3].querySelector('.pick-text span').classList.contains('pick-wrap')).toBe(false);
    // Someone else active: an estimate, not "about 0".
    store.act.p.u2 = Date.now();
    textarea.value = '@h';
    textarea.dispatchEvent(new Event('input'));
    expect(rows()[0]).toBe('Notify people active now, about 1 active now');
    composer.destroy();
  });

  it('stops the typing signal when the message is put aside with Send later', async () => {
    const noteTyping = vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
    const stopTyping = vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
    const onSendLater = vi.fn(async () => ({ id: 's1' }));
    const composer = createComposer({ onSend: vi.fn(), onSendLater, convId: 'c1', typingConv: 'c1' });
    document.body.append(composer.el);
    const { textarea } = composer;
    textarea.value = 'later, then';
    textarea.dispatchEvent(new Event('input'));
    expect(noteTyping).toHaveBeenCalledWith('c1');
    expect(stopTyping).not.toHaveBeenCalled();
    // Send later, at the first time its menu offers.
    const later = composer.el.querySelector('.send-later');
    expect(later.disabled).toBe(false);
    later.click();
    const preset = document.querySelector('.menu .menu-item');
    expect(preset).toBeTruthy();
    preset.click();
    await tick();
    expect(onSendLater).toHaveBeenCalledTimes(1);
    expect(onSendLater.mock.calls[0][0]).toBe('later, then');
    expect(textarea.value).toBe('');
    expect(stopTyping).toHaveBeenCalledWith('c1');
    composer.destroy();
  });
});

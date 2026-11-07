/**
 * Huddles in the UI: the headphones toggle in a conversation's header, the
 * "Ana and Ben are in a huddle" bar above its messages, and the dock, a
 * small window at the bottom of the sidebar with the people in the call,
 * who is speaking, and the mic, camera,
 * screen, and leave controls. The dock belongs to the app, not to a
 * conversation: it stays while the user reads elsewhere, and it grows into
 * a tile grid when someone turns a camera or a screen on.
 */
import { el, focusables, coarsePointer } from './dom.js';
import { icon } from './icons.js';
import { avatar } from './avatar.js';
import { toast } from './toast.js';
import { confirmDialog } from './modal.js';
import { store } from '../lib/store.js';
import { navigate } from '../lib/router.js';
import { huddleLine } from '../shared/huddle.js';

/** Start or join the huddle of a conversation, asking first when it means leaving another. */
export async function joinHuddleFlow(convId) {
  const cur = store.huddleInfo;
  if (cur && !(cur.ws === store.wsId && cur.conv === convId)) {
    const ok = await confirmDialog({
      title: `Leave the huddle in ${cur.title}?`,
      message: `You can only be in one huddle at a time. Leaving it joins the one in ${store.convTitle(convId)}.`,
      confirmLabel: 'Leave and join', danger: false,
    });
    if (!ok) return false;
  }
  try {
    await store.joinHuddle(convId);
    return true;
  } catch (e) {
    toast(e?.message || 'Could not join the huddle', { icon: 'alert', duration: 6000 });
    return false;
  }
}

/** Faces of the first few people in a conversation's huddle. */
function faces(convId, max = 3) {
  const uuids = store.huddleMembers(convId);
  const shown = uuids.slice(0, max).map((u) => avatar(store.member(u), { size: 'xs' }));
  const more = uuids.length - shown.length;
  return el('span.face-stack.huddle-faces', { 'aria-hidden': 'true' }, ...shown, more > 0 && el('span.face-more', {}, `+${more}`));
}

/**
 * The header toggle: headphones to start one; the faces in it and a count
 * to join the one in progress; pressed while the user is in this one
 * (clicking then leaves). One class and one label
 * stem whatever the state (the state is `data-state` and aria-pressed), so
 * the header's redraw, which replaces the button as the seat changes, finds
 * it again for the keyboard.
 */
export function huddleButton(convId) {
  if (!store.canHuddle(convId)) return null;
  const live = store.huddleIn(convId);
  const inIt = store.inHuddle(convId);
  const n = live ? Object.keys(live.m || {}).length : 0;
  const label = inIt ? 'Huddle: you are in it' : live ? `Huddle: ${n} in it` : 'Huddle';
  let busy = false;
  const btn = el('button.huddle-btn', {
    type: 'button', 'aria-pressed': String(inIt), 'aria-label': label, title: inIt ? 'Leave huddle' : live ? 'Join huddle' : 'Start a huddle',
    dataset: { state: inIt ? 'on' : live ? 'live' : 'off' },
    onclick: async () => {
      if (busy) return;
      // Busy, not disabled, while the seat is taken or given up: disabling
      // a focused button drops its focus.
      busy = true;
      btn.setAttribute('aria-busy', 'true');
      try {
        if (inIt) await store.leaveHuddle();
        else await joinHuddleFlow(convId);
      } finally {
        busy = false;
        btn.removeAttribute('aria-busy');
      }
    },
  },
  live && !inIt ? faces(convId) : null,
  el('span.huddle-btn-icon', { html: icon('headphones', 18, 2) }),
  live && !inIt ? el('span.huddle-btn-count', {}, String(n)) : null);
  return btn;
}

/**
 * The bar above a conversation's messages while a huddle the user is not
 * in is in progress there: who is in it, since when, and Join. When the
 * user's own seat is in it, taken from another tab or device, it says so,
 * and Join moves the seat here.
 *
 * The bar is a status region, so a screen reader hears of the huddle when
 * the bar appears and when who is in it changes, and of nothing else: the
 * elapsed time, which moves every half minute, is written in place and
 * kept out of the accessible tree, and the faces, redrawn as profiles
 * change, are decoration.
 */
export function createHuddleBar(convId) {
  const node = el('div.huddle-bar', { role: 'status', hidden: true });
  const since = el('span.muted.huddle-bar-since', { 'aria-hidden': 'true' });
  let facesNode = null;
  let timer = null;
  let built = null; // what the bar's text and button were last built for
  let startedAt = null;
  function tick() {
    const t = startedAt ? ` · ${elapsed(startedAt)}` : '';
    if (since.textContent !== t) since.textContent = t;
  }
  function render() {
    clearTimeout(timer);
    const live = store.huddleIn(convId);
    if (!live || store.inHuddle(convId)) {
      node.hidden = true;
      node.replaceChildren();
      built = null;
      facesNode = null;
      return;
    }
    const uuids = store.huddleMembers(convId);
    const elsewhere = uuids.includes(store.uuid);
    const others = uuids.filter((u) => u !== store.uuid).map((u) => store.member(u).name);
    const text = !elsewhere ? huddleLine(others)
      : !others.length ? 'You are in this huddle in another tab'
        : `You are in this huddle in another tab, with ${others.length === 1 ? others[0] : others.length === 2 ? `${others[0]} and ${others[1]}` : `${others[0]} and ${others.length - 1} others`}`;
    startedAt = live.at || null;
    const key = JSON.stringify([text, elsewhere, uuids]);
    if (key !== built) {
      built = key;
      let busy = false;
      const join = el('button.btn.btn-sm.btn-primary.huddle-bar-join', {
        type: 'button', html: icon('headphones', 15, 2.2), title: elsewhere ? 'Move the huddle to this tab' : 'Join the huddle',
        onclick: async () => {
          if (busy) return;
          busy = true;
          join.setAttribute('aria-busy', 'true');
          const hadFocus = document.activeElement === join;
          try {
            // In: the bar goes, and a keyboard's focus moves on to the huddle's own controls.
            if (await joinHuddleFlow(convId) && hadFocus) document.querySelector('.huddle-dock .huddle-ctl-mic')?.focus();
          } finally {
            busy = false;
            join.removeAttribute('aria-busy');
          }
        },
      }, elsewhere ? ' Join here' : ' Join');
      // Rebuilt as the roster moves: a Join under the keyboard stays under it.
      const hadFocus = node.contains(document.activeElement);
      facesNode = faces(convId, 4);
      node.replaceChildren(
        el('span.huddle-bar-icon', { html: icon('headphones', 16, 2.2) }),
        facesNode,
        el('span.huddle-bar-text', {}, text, since),
        join);
      if (hadFocus) join.focus({ preventScroll: true });
    }
    tick();
    node.hidden = false;
    timer = setTimeout(render, 30_000); // the elapsed time moves on its own
  }
  /** A profile or the workspace changed: the faces may have; the words and the button stand. */
  function refaces() {
    if (node.hidden || !facesNode) return render();
    const next = faces(convId, 4);
    facesNode.replaceWith(next);
    facesNode = next;
    return render();
  }
  const off = [store.on('huddle', render), store.on('workspace', refaces), store.on('profile', refaces)];
  render();
  return {
    el: node,
    destroy() {
      clearTimeout(timer);
      off.forEach((f) => f());
    },
  };
}

/** Set an attribute only when it changes (null removes it), so a redraw that changes nothing touches nothing. */
function setAttr(node, name, value) {
  if (value == null) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
  } else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

/**
 * "3 min" / "1 hr 5 min" since a timestamp, for the bar; "0:42" / "12:04" /
 * "1:02:33" for the dock. The timestamp is the worker's, so the clock it is
 * measured against is the worker's too (the store keeps the offset): read
 * against the device's, a clock a minute behind showed 0:00 for a minute
 * after joining, one ahead showed a minute on entry.
 */
function elapsed(at) {
  const m = Math.floor(Math.max(0, store.serverNow() - at) / 60_000);
  if (m < 1) return 'just started';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} hr ${m % 60 ? `${m % 60} min` : ''}`.trim();
}
function clock(at) {
  const s = Math.floor(Math.max(0, store.serverNow() - at) / 1000);
  const two = (n) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`;
}

/**
 * The dock. Mounted once; shows while the user is in a huddle. Its head,
 * its controls, and each participant's tile are built once and updated in
 * place: a button keeps its focus through the clock's tick and through the
 * redraw its own press brings, and a video keeps playing through a redraw.
 */
export function mountHuddleDock() {
  const root = el('section.huddle-dock', { hidden: true, 'aria-label': 'Huddle' });
  document.body.append(root);
  const tileNodes = new Map(); // key -> tile
  let expanded = false;
  let userSized = false; // the user chose a size; it no longer follows the video
  let tick = null;
  let shownFor = null; // the Huddle instance the dock is drawn for
  let faceGen = 0; // bumped when an avatar may have changed (a profile, the workspace)

  const title = el('button.huddle-title', {
    dir: 'auto',
    type: 'button',
    onclick: () => {
      const info = store.huddleInfo;
      if (!info) return;
      navigate(store.wsId === info.ws ? { ws: info.ws, conv: info.conv, view: null } : { ws: info.ws, conv: info.conv });
    },
  });
  const headFaces = el('span.huddle-head-faces', { 'aria-hidden': 'true' });
  // A timer, so the label is read with the figure ("Elapsed, 0:42"): a plain
  // span may not carry a name, and a screen reader said the figure alone.
  const timer = el('span.huddle-timer', { role: 'timer', 'aria-label': 'Elapsed' });
  const sizeBtn = el('button.icon-btn.icon-btn-sm.huddle-size', {
    type: 'button',
    onclick: () => {
      expanded = !expanded;
      userSized = true;
      render();
    },
  });
  const head = el('div.huddle-head', {}, el('span.huddle-head-icon', { html: icon('headphones', 16, 2.2) }), title, headFaces, timer, sizeBtn);
  const tiles = el('div.huddle-tiles', { role: 'list', 'aria-label': 'In the huddle' });
  const status = el('div.huddle-status', { role: 'status' });
  const ctl = {
    mic: control('mic', (h) => h.setMic(!h.mic)),
    cam: control('cam', (h) => h.setCam(!h.cam)),
    share: control('share', (h) => (h.screen ? h.stopShare() : h.shareScreen())),
    leave: control('leave', () => store.leaveHuddle()),
  };
  const controls = el('div.huddle-controls', {}, ctl.mic.node, ctl.cam.node, ctl.share.node, ctl.leave.node);
  // Joins and leaves, said for a screen reader: the tiles are a list, and a
  // list changing under a listener says nothing on its own, so with three or
  // more people nobody heard that someone came or went (the status line only
  // speaks for the first other person, and for connecting).
  const live = el('div.visually-hidden', { 'aria-live': 'polite' });
  let known = null; // who was here at the last render of this huddle; null before the first
  root.append(head, tiles, status, controls, live);

  /**
   * The dock sits over the bottom of the sidebar; while small, the sidebar
   * is told its height (--huddle-dock-h) and makes room, so its last rows
   * and the unread pill are not hidden under it. Larger, it is a floating
   * window and takes no room.
   */
  const reserve = () => {
    const h = root.hidden || expanded ? 0 : root.offsetHeight + 16;
    document.documentElement.style.setProperty('--huddle-dock-h', `${h}px`);
  };
  const sizer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(reserve) : null;
  sizer?.observe(root);

  /** One control, kept for the life of the dock; `set` draws its state. The press acts on the huddle of the moment. */
  function control(name, onClick) {
    const node = el(`button.huddle-ctl.huddle-ctl-${name}`, { type: 'button' });
    let busy = false;
    node.addEventListener('click', async () => {
      const h = store.huddle;
      if (busy || !h) return;
      // Busy, not disabled, while the device is asked for: disabling a
      // focused button drops its focus.
      busy = true;
      node.setAttribute('aria-busy', 'true');
      try {
        await onClick(h);
      } finally {
        busy = false;
        node.removeAttribute('aria-busy');
      }
    });
    return {
      node,
      set({ on = null, icon: name, label, title: tip, danger = false, disabled = false }) {
        node.classList.toggle('on', !!on);
        node.classList.toggle('danger', danger);
        setAttr(node, 'aria-pressed', on == null ? null : String(on));
        setAttr(node, 'aria-label', label);
        setAttr(node, 'title', tip);
        if (node.dataset.icon !== name) {
          node.dataset.icon = name;
          node.innerHTML = icon(name, 18, 2);
        }
        if (node.disabled !== disabled) node.disabled = disabled;
      },
    };
  }

  function render() {
    const h = store.huddle;
    const info = store.huddleInfo;
    if (!h || !info) {
      // Leave pressed from the dock's own keyboard: hiding the dock with
      // the button under focus would drop focus to the page body and the
      // next Tab would start from the top. It goes back to the headphones
      // in the header (the way in, and the way to a new one), else to the
      // composer; only when it was in the dock, so nothing is taken from
      // anyone typing elsewhere when a huddle ends on its own. Not to a
      // text box under a finger: a tap puts the keyboard on Leave too
      // (Chrome focuses a tapped button), and the message box focused in
      // its place brought the phone's keyboard up over the page for a press
      // that asked for nothing to be typed. On a touch screen the keyboard
      // goes to the column's first control that is not a text box.
      if (root.contains(document.activeElement)) {
        const main = document.querySelector('.main') || document.body;
        const back = document.querySelector('.huddle-btn')
          || (coarsePointer() ? focusables(main).find((n) => !/^(input|textarea)$/.test(n.localName)) : document.querySelector('.main textarea'));
        back?.focus({ preventScroll: true });
      }
      root.hidden = true;
      document.body.classList.remove('in-huddle');
      clearInterval(tick);
      tick = null;
      for (const t of tileNodes.values()) detachVideo(t);
      tileNodes.clear();
      tiles.replaceChildren();
      shownFor = null;
      known = null;
      live.textContent = '';
      reserve();
      return;
    }
    if (shownFor !== h) {
      shownFor = h;
      known = null;
      expanded = false;
      userSized = false;
      for (const t of tileNodes.values()) detachVideo(t);
      tileNodes.clear();
      tiles.replaceChildren();
    }
    root.hidden = false;
    document.body.classList.add('in-huddle');
    if (!tick) tick = setInterval(renderHead, 1000);

    // Who is here: the roster (names, order) and the peers (links, streams),
    // the user first.
    const inWs = store.wsId === info.ws;
    const roster = inWs ? store.huddleMembers(info.conv) : [];
    const people = new Map();
    people.set(store.uuid, { uuid: store.uuid, self: true });
    for (const u of roster) if (u !== store.uuid) people.set(u, { uuid: u, peer: h.peers.get(u) || null });
    for (const p of h.visiblePeers()) if (!people.has(p.uuid)) people.set(p.uuid, { uuid: p.uuid, peer: p });
    for (const [u, entry] of people) if (entry.peer?.gone) people.delete(u);
    announce(people);

    // Someone's camera or screen is on (their word for it; the frames
    // follow): the grid is wanted, and the window grows for it; once the
    // last of it is off, it shrinks back to the corner it came from. A size
    // the user chose stands either way.
    const anyVideo = h.cam || h.screen || [...people.values()].some((e) => e.peer?.cam || e.peer?.screen || e.peer?.streams?.has('screen'));
    if (!userSized) expanded = anyVideo;
    root.classList.toggle('expanded', expanded);
    root.classList.toggle('has-video', anyVideo);

    renderHead(people);
    renderTiles(people, h);
    renderStatus(people, h);
    renderControls(h);
    reserve();
  }

  /** The head: the conversation, who is in it (on a phone), the clock, and the size toggle. Text and attributes only; the nodes stay. */
  function renderHead(people = null) {
    const info = store.huddleInfo;
    if (!info) return;
    const name = store.wsId === info.ws ? store.convTitle(info.conv) : info.title;
    if (title.textContent !== name) title.textContent = name;
    setAttr(title, 'title', `Open ${name}`);
    const t = info.at ? clock(info.at) : '';
    if (timer.textContent !== t) timer.textContent = t;
    const ic = expanded ? 'minimize' : 'maximize';
    if (sizeBtn.dataset.icon !== ic) {
      sizeBtn.dataset.icon = ic;
      sizeBtn.innerHTML = icon(ic, 15, 2.2);
    }
    setAttr(sizeBtn, 'aria-label', expanded ? 'Make the huddle window smaller' : 'Make the huddle window larger');
    setAttr(sizeBtn, 'title', expanded ? 'Smaller' : 'Larger');
    if (people) {
      const others = [...people.keys()].filter((u) => u !== store.uuid);
      const key = `${others.join(',')}:${faceGen}`;
      if (headFaces.dataset.key !== key) {
        headFaces.dataset.key = key;
        const shown = others.slice(0, 3).map((u) => avatar(store.member(u), { size: 'xs' }));
        headFaces.replaceChildren(el('span.face-stack', {}, ...shown, others.length > 3 && el('span.face-more', {}, `+${others.length - 3}`)));
        headFaces.hidden = !others.length;
      }
    }
  }

  function renderTiles(people, h) {
    const keys = new Set();
    const ordered = [];
    for (const entry of people.values()) {
      const camKey = `${entry.uuid}:camera`;
      keys.add(camKey);
      ordered.push([camKey, entry, 'camera']);
      const screen = entry.self ? h.screenStream : entry.peer?.streams?.get('screen');
      if (screen) {
        const k = `${entry.uuid}:screen`;
        keys.add(k);
        ordered.unshift([k, entry, 'screen']); // a shared screen leads
      }
    }
    for (const [key, t] of tileNodes) {
      if (!keys.has(key)) {
        detachVideo(t);
        t.node.remove();
        tileNodes.delete(key);
      }
    }
    let prev = null;
    for (const [key, entry, kind] of ordered) {
      let t = tileNodes.get(key);
      if (!t) {
        t = newTile(kind);
        tileNodes.set(key, t);
      }
      updateTile(t, entry, kind, h);
      // Keep the DOM in roster order without re-inserting what is in place.
      if (prev ? prev.nextSibling !== t.node : tiles.firstChild !== t.node) {
        if (prev) prev.after(t.node);
        else tiles.prepend(t.node);
      }
      prev = t.node;
    }
    tiles.classList.toggle('many', people.size > 4);
  }

  /** A tile's parts, made once: the face (an avatar, or the video when there is one), the name with its badges, the connecting dots. */
  function newTile(kind) {
    const face = el('span.huddle-tile-face');
    const name = el('span.huddle-tile-name-text', { dir: 'auto' });
    const badges = el('span.huddle-tile-badges');
    const wait = el('span.huddle-tile-wait', { 'aria-hidden': 'true', hidden: true }, el('i'), el('i'), el('i'));
    // A list item, so the label that says who this is and how they are (muted, connecting, speaking) is read out: a plain div is not named.
    const node = el('div.huddle-tile', { role: 'listitem', dataset: { kind } }, face, el('span.huddle-tile-name', {}, name, badges), wait);
    return { node, face, name, badges, wait, video: null, avatar: null, avatarKey: null, badgeKey: null, kind };
  }

  function updateTile(t, entry, kind, h) {
    const m = store.member(entry.uuid);
    const name = entry.self ? 'You' : m.name || entry.peer?.name || 'Someone';
    const stream = entry.self ? (kind === 'screen' ? h.screenStream : h.camStream) : entry.peer?.streams?.get(kind) || null;
    const hasVideo = kind === 'screen' ? !!stream : entry.self ? h.cam : !!(entry.peer?.cam && stream?.getVideoTracks().length);
    const speaking = entry.self ? h.speaking && h.mic : !!entry.peer?.speaking;
    const micOn = entry.self ? h.mic : !!entry.peer?.mic;
    const connected = entry.self ? h.state === 'live' : !!entry.peer?.open;
    t.node.classList.toggle('speaking', speaking && kind === 'camera');
    t.node.classList.toggle('self', !!entry.self);
    t.node.classList.toggle('connecting', !connected);
    t.node.classList.toggle('video', hasVideo);
    // What the tile shows, in words: a screen tile is the share alone (the
    // ring and the mute badge are on its owner's camera tile).
    setAttr(t.node, 'aria-label', kind === 'screen'
      ? `${name}, sharing ${entry.self ? 'your' : 'their'} screen`
      : `${name}${micOn ? '' : ', muted'}${connected ? '' : ', connecting'}${speaking ? ', speaking' : ''}`);
    let face;
    if (hasVideo && stream) {
      if (!t.video) {
        t.video = el('video.huddle-video', { autoplay: true, playsinline: true, muted: true });
        t.video.muted = true; // the attribute alone does not mute a srcObject
        if (entry.self && kind === 'camera') t.video.classList.add('mirror');
      }
      if (t.video.srcObject !== stream) {
        t.video.srcObject = stream;
        t.video.play?.().catch?.(() => {});
      }
      face = t.video;
    } else {
      detachVideo(t);
      const key = `${entry.uuid}:${expanded ? 'lg' : 'md'}:${faceGen}`;
      if (t.avatarKey !== key) {
        t.avatarKey = key;
        t.avatar = avatar(m, { size: expanded ? 'lg' : 'md' });
      }
      face = t.avatar;
    }
    if (t.face !== face) {
      t.face.replaceWith(face);
      t.face = face;
    }
    if (t.name.textContent !== name) t.name.textContent = name;
    const badgeKey = `${kind}:${micOn}`;
    if (t.badgeKey !== badgeKey) {
      t.badgeKey = badgeKey;
      t.badges.replaceChildren();
      if (kind === 'camera' && !micOn) t.badges.append(el('span.huddle-badge.muted', { html: icon('micOff', 11, 2.4), title: 'Muted' }));
      if (kind === 'screen') t.badges.append(el('span.huddle-badge', { html: icon('screenShare', 11, 2.4), title: 'Sharing' }));
    }
    t.wait.hidden = connected || kind !== 'camera';
  }

  function detachVideo(t) {
    if (!t.video) return;
    t.video.srcObject = null;
    t.video = null;
  }

  function announce(people) {
    const present = new Set([...people.keys()].filter((u) => u !== store.uuid));
    if (known) {
      const who = (u) => store.member(u).name || 'Someone';
      const said = [];
      for (const u of present) if (!known.has(u)) said.push(`${who(u)} joined the huddle`);
      for (const u of known) if (!present.has(u)) said.push(`${who(u)} left the huddle`);
      // The same words twice in a row (someone leaving and coming back) are
      // not a change to a live region: a trailing space makes them one.
      if (said.length) live.textContent = said.join('. ') + (live.textContent.endsWith(' ') ? '' : ' ');
    }
    known = present;
  }

  function renderStatus(people, h) {
    const others = [...people.values()].filter((e) => !e.self);
    const connected = others.filter((e) => e.peer?.open).length;
    let text = '';
    if (h.state === 'connecting') text = 'Starting the huddle…';
    else if (!others.length) text = 'You are the only one here. Others can join from the conversation.';
    else if (connected < others.length) text = `Connecting to ${others.length - connected} ${others.length - connected === 1 ? 'person' : 'people'}…`;
    else if (!h.micAvailable) text = 'No microphone: you can listen, not speak.';
    if (status.textContent !== text) status.textContent = text;
    status.hidden = !text;
  }

  /**
   * The labels say the state first, then the action, and aria-pressed is
   * that state (the follow bell's pattern: "Following this thread.
   * Unfollow", pressed): a toggle whose label named the action alone read,
   * with the microphone live, as "Mute your microphone, pressed", which a
   * screen reader's listener took for a muted microphone while everyone on
   * the call could hear them; the camera's read "Turn your camera off,
   * pressed" the same way. The tooltips stay the short action.
   */
  function renderControls(h) {
    ctl.mic.set({
      on: h.mic, icon: h.mic ? 'mic' : 'micOff', label: h.mic ? 'Microphone on. Mute' : h.micAvailable ? 'Microphone off. Unmute' : 'Microphone off. Turn on',
      title: h.mic ? 'Mute' : 'Unmute',
    });
    ctl.cam.set({ on: h.cam, icon: h.cam ? 'video' : 'videoOff', label: h.cam ? 'Camera on. Turn off' : 'Camera off. Turn on', title: h.cam ? 'Camera off' : 'Camera on' });
    ctl.share.set({
      on: h.screen, icon: h.screen ? 'screenShareOff' : 'screenShare', label: h.screen ? 'Sharing your screen. Stop sharing' : 'Share your screen', title: h.screen ? 'Stop sharing' : 'Share screen',
      disabled: typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia,
    });
    ctl.leave.set({ icon: 'phoneOff', label: 'Leave the huddle', title: 'Leave', danger: true });
  }

  const refresh = () => {
    faceGen += 1;
    render();
  };
  // The roster and the seat come as 'huddle'; who is speaking, a stream, a
  // device as 'huddle-media', which is the dock's business alone.
  const offs = [store.on('huddle', render), store.on('huddle-media', render), store.on('workspace', refresh), store.on('profile', refresh)];
  render();
  return {
    el: root,
    destroy() {
      offs.forEach((f) => f());
      clearInterval(tick);
      sizer?.disconnect();
      document.documentElement.style.removeProperty('--huddle-dock-h');
      document.body.classList.remove('in-huddle');
      root.remove();
    },
  };
}

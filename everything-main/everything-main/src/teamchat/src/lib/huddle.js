/**
 * A huddle session: the media side of a huddle. The roster (who is in it,
 * and the invite code each participant serves) lives on the worker and is
 * described in src/shared/huddle.js; this class turns that roster into
 * links that carry audio, and camera or screen video when someone turns
 * them on.
 *
 * Every participant runs a Puter Peer server of their own
 * (`puter.peer.serve()`) and publishes its invite code in the roster; the
 * others dial it with `puter.peer.connect()`. So the media is a full mesh,
 * and nobody hosts: whoever leaves, the rest stay connected. A newcomer
 * dials everyone already listed; beyond that, when two participants both
 * know of each other and have no link, the one with the greater id dials
 * (shouldDial), which also decides which connection survives when both
 * dialled at once. Identity comes from the signaller, not from the wire:
 * a server learns who connected from `event.user.uuid`, a dialler learns
 * whose server answered from `conn.owner.uuid`, and both are checked
 * against the workspace's members before a link carries anything.
 *
 * On each link the Puter data channel carries a small JSON protocol
 * (hello, state, signal, bye) and a MediaLink (lib/rtc.js) puts the tracks
 * on the RTCPeerConnection under it.
 *
 * Events (an EventTarget; `detail` carries the payload):
 *   'change'    something to redraw: peers, streams, who is speaking, own devices
 *   'invite'    { inviteCode }  the server is (re)registered under this code; publish it
 *   'replaced'  the roster lists this member under a server that is not ours: another tab took the seat
 *   'error'     { kind: 'mic' | 'cam' | 'screen' | 'server', message }
 *   'ended'     { reason }
 */
import { MediaLink, cameraSendProfile } from './rtc.js';
import { shouldDial } from '../shared/huddle.js';

export const PROTOCOL_VERSION = 1;
/** How long a dial may take to open before it is given up and tried again later. */
export const DIAL_TIMEOUT_MS = 15_000;
/** Redial backoff: 3 s, 6 s, 12 s, ... up to half a minute, while the roster still lists the peer. */
export function backoffMs(attempts) {
  return Math.min(30_000, 3000 * 2 ** Math.max(0, attempts - 1));
}
/** A frame larger than this is dropped unread (an SDP is tens of kilobytes at most). */
const MAX_FRAME_CHARS = 262_144;
const MAX_NAME = 60;

/** Parse and validate a frame from the data channel; null drops it. */
export function parseMessage(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_FRAME_CHARS) return null;
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object' || msg.v !== PROTOCOL_VERSION) return null;
  const streams = (s) => ({
    camera: typeof s?.camera === 'string' && s.camera.length <= 128 ? s.camera : null,
    screen: typeof s?.screen === 'string' && s.screen.length <= 128 ? s.screen : null,
  });
  switch (msg.t) {
    case 'hello':
      if (typeof msg.uuid !== 'string' || !msg.uuid || msg.uuid.length > 128) return null;
      return {
        t: 'hello', uuid: msg.uuid, name: cleanName(msg.name), mic: !!msg.mic, cam: !!msg.cam, screen: !!msg.screen, streams: streams(msg.streams),
        // The invite code of the server the sender runs: which seat this link is to.
        inv: typeof msg.inv === 'string' && msg.inv && msg.inv.length <= 64 ? msg.inv : null,
      };
    case 'state':
      return { t: 'state', name: cleanName(msg.name), mic: !!msg.mic, cam: !!msg.cam, screen: !!msg.screen, streams: streams(msg.streams) };
    case 'signal':
      if (!msg.sdp && !msg.candidate && msg.candidate !== null) return null;
      return { t: 'signal', sdp: msg.sdp, candidate: msg.candidate };
    case 'bye':
      return { t: 'bye' };
    default:
      return null;
  }
}

function cleanName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

const encode = (msg) => JSON.stringify({ v: PROTOCOL_VERSION, ...msg });

export class Huddle extends EventTarget {
  /** 'idle' | 'connecting' | 'live' | 'ended' */
  state = 'idle';
  /** @type {Map<string, object>} uuid -> peer record */
  peers = new Map();
  inviteCode = null;
  mic = false;
  micAvailable = false;
  cam = false;
  screen = false;
  speaking = false;
  /** The mic and camera, in one stream whose id the others are told. */
  camStream = new MediaStream();
  /** @type {MediaStream|null} */
  screenStream = null;

  #uuid;
  #name;
  #isMember;
  #peerApi;
  #media;
  #server = null;
  #served = new Set(); // every invite code this session has served under
  #left = false;
  #roster = {};
  #redialTimer = null;
  #reserveTimer = null;
  #reserveAttempts = 0;
  #monitor = new AudioLevelMonitor((id, speaking) => this.#onSpeaking(id, speaking));
  #sink = null;
  #pending = new Set(); // inbound connections not yet identified

  /**
   * @param {object} opts
   * @param {string} opts.uuid       this member
   * @param {string} opts.name       shown to peers before the roster names them
   * @param {(uuid: string) => boolean} opts.isMember  may this account take part?
   * @param {() => object} [opts.peer]  the Puter Peer API (defaults to puter.peer)
   * @param {object} [opts.media]       navigator.mediaDevices
   */
  constructor({ uuid, name, isMember, peer = () => globalThis.puter?.peer, media = globalThis.navigator?.mediaDevices } = {}) {
    super();
    this.#uuid = String(uuid);
    this.#name = cleanName(name);
    this.#isMember = isMember || (() => true);
    this.#peerApi = peer;
    this.#media = media;
  }

  get uuid() {
    return this.#uuid;
  }

  on(type, fn) {
    const handler = (e) => fn(e.detail);
    this.addEventListener(type, handler);
    return () => this.removeEventListener(type, handler);
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /** Peers to show: everyone with a record who has not said goodbye. */
  visiblePeers() {
    return [...this.peers.values()].filter((p) => !p.gone);
  }

  /**
   * Take the microphone and start serving. Resolves with the invite code
   * to publish (also announced as 'invite'). Works without a microphone:
   * the huddle is then listen-only until one is allowed.
   */
  async start() {
    if (this.state !== 'idle') return this.inviteCode;
    this.state = 'connecting';
    this.emit('change');
    const api = this.#peerApi();
    if (!api || typeof api.serve !== 'function') {
      this.state = 'ended';
      throw new Error('Huddles need a newer Puter.js; reload the app and try again.');
    }
    api.ensureTurnRelays?.().catch?.(() => {});
    await this.#acquireMic();
    if (this.#left) return null;
    let server;
    try {
      server = await api.serve();
    } catch (e) {
      this.state = 'ended';
      this.#stopLocalTracks();
      throw new Error(e?.message ? `Could not start the huddle: ${e.message}` : 'Could not start the huddle');
    }
    if (this.#left) {
      closeServer(server);
      return null;
    }
    this.#adoptServer(server);
    this.state = 'live';
    this.emit('change');
    this.emit('invite', { inviteCode: this.inviteCode });
    return this.inviteCode;
  }

  /**
   * The roster as the worker has it (`m`: uuid -> { at, j, inv }). Dials
   * whoever needs dialling, forgets whoever is gone. `dialAll` on the first
   * roster after joining: a newcomer dials everyone already there.
   */
  syncRoster(m, { dialAll = false } = {}) {
    if (this.#left) return;
    this.#roster = m || {};
    const now = Date.now();
    let changed = false;
    const seen = new Set();
    for (const [uuid, entry] of Object.entries(this.#roster)) {
      if (uuid === this.#uuid) {
        // Our seat under a server that is not ours: another tab of this
        // account joined, and the roster is theirs now.
        if (entry?.inv && this.#served.size && !this.#served.has(entry.inv)) this.emit('replaced');
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      seen.add(uuid);
      let p = this.peers.get(uuid);
      if (!p) {
        p = this.#newPeer(uuid);
        this.peers.set(uuid, p);
        changed = true;
      }
      if (entry.inv && p.invite !== entry.inv) {
        // They serve under a new code (a reconnect, or they came back on
        // another device): a link dialled to the old one is stale, and so
        // is the wait that dials to the old one failing had earned (up to
        // half a minute): the new code is fresh word of where they are, and
        // is tried at once.
        const had = p.invite;
        p.invite = entry.inv;
        // The stale link goes first, and the wait is cleared after it:
        // closing the link runs its close handler, which arms the wait a
        // link's closing earns (see #onConnClosed) and asks for a redial
        // when it is up. Cleared before the drop, that wait stood over the
        // fresh code, and the new server was dialled a few seconds on rather
        // than at once, the redial timer doing what this pass was meant to.
        if (had && p.conn && !p.inbound) this.#dropLink(p, 'peer re-served');
        p.retryAt = 0;
        p.attempts = 0;
      }
      if (typeof entry.j === 'number' && entry.j !== p.joinedAt) {
        // A (re)join: whatever we knew about their leaving is over.
        p.joinedAt = entry.j;
        p.retryAt = 0;
        p.attempts = 0;
        if (p.gone) {
          p.gone = false;
          changed = true;
        }
      }
      if (p.gone && p.goneInv && p.invite && p.invite !== p.goneInv) {
        // They said goodbye on a link to one server and the roster lists
        // them under another: their seat moved to another tab or device,
        // which keeps the join time, so this is the rejoin.
        p.gone = false;
        p.retryAt = 0;
        p.attempts = 0;
        changed = true;
      }
      if (!p.conn && !p.dialing && !p.gone && p.invite && (dialAll || shouldDial(this.#uuid, uuid)) && now >= p.retryAt) this.#dial(p);
    }
    for (const [uuid, p] of this.peers) {
      // Off the roster with no link: gone. (One still connected stays; the
      // roster may lag their heartbeat.)
      if (!seen.has(uuid) && !p.conn && !p.dialing) {
        this.peers.delete(uuid);
        changed = true;
      }
    }
    if (changed) this.emit('change');
  }

  /* ---- devices ---------------------------------------------------------- */

  async setMic(on) {
    if (this.#left) return;
    if (on && !this.micAvailable) await this.#acquireMic();
    const track = this.camStream.getAudioTracks()[0];
    if (track) track.enabled = !!on;
    this.mic = !!on && !!track;
    this.#broadcastState();
    this.emit('change');
  }

  async setCam(on) {
    if (this.#left) return;
    const current = this.camStream.getVideoTracks()[0];
    if (!on) {
      if (current) {
        current.stop();
        this.camStream.removeTrack(current);
      }
      this.cam = false;
      this.#syncLocalMedia();
      this.#broadcastState();
      this.emit('change');
      return;
    }
    if (current) return;
    let stream;
    try {
      stream = await this.#media.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 }, facingMode: 'user' } });
    } catch (e) {
      this.emit('error', { kind: 'cam', message: deviceMessage(e, 'camera') });
      return;
    }
    if (this.#left) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const track = stream.getVideoTracks()[0];
    track.addEventListener('ended', () => {
      if (this.camStream.getVideoTracks()[0] === track) this.setCam(false);
    });
    this.camStream.addTrack(track);
    this.cam = true;
    this.#syncLocalMedia();
    this.#broadcastState();
    this.emit('change');
  }

  async shareScreen() {
    if (this.#left || this.screenStream) return;
    let stream;
    try {
      stream = await this.#media.getDisplayMedia({ video: { frameRate: { ideal: 12 } }, audio: false });
    } catch (e) {
      // Dismissing the picker is not an error worth a message.
      if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') this.emit('error', { kind: 'screen', message: deviceMessage(e, 'screen') });
      return;
    }
    if (this.#left) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.screenStream = stream;
    this.screen = true;
    const track = stream.getVideoTracks()[0];
    track.addEventListener('ended', () => {
      if (this.screenStream === stream) this.stopShare();
    });
    this.#syncLocalMedia();
    this.#broadcastState();
    this.emit('change');
  }

  stopShare() {
    if (!this.screenStream) return;
    this.screenStream.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.screen = false;
    this.#syncLocalMedia();
    this.#broadcastState();
    this.emit('change');
  }

  /** Leave: say goodbye on every link, close everything, release the devices. */
  leave(reason = 'left') {
    if (this.#left) return;
    this.#left = true;
    this.state = 'ended';
    clearTimeout(this.#redialTimer);
    clearTimeout(this.#reserveTimer);
    const bye = encode({ t: 'bye' });
    for (const p of this.peers.values()) {
      if (p.conn && p.open) sendOn(p.conn, bye);
      this.#dropLink(p, reason, { quiet: true });
    }
    for (const rec of this.#pending) closeConn(rec.conn, reason);
    this.#pending.clear();
    closeServer(this.#server);
    this.#server = null;
    this.#stopLocalTracks();
    this.#monitor.close();
    this.#sink?.remove();
    this.#sink = null;
    this.emit('change');
    this.emit('ended', { reason });
  }

  /* ---- the server: the side others dial ------------------------------- */

  #adoptServer(server) {
    this.#server = server;
    this.inviteCode = server.inviteCode;
    this.#served.add(server.inviteCode);
    server.addEventListener('connection', (event) => this.#onInbound(event));
    server.addEventListener('reconnect', (event) => {
      if (this.#left || this.#server !== server) return;
      const code = event?.inviteCode || server.inviteCode;
      if (code && code !== this.inviteCode) {
        this.inviteCode = code;
        this.#served.add(code);
        this.emit('invite', { inviteCode: code });
      }
    });
    server.addEventListener('close', () => {
      // Stopped accepting on its own (the signaller let go): the links up
      // stay up; newcomers need a server, so serve again.
      if (!this.#left && this.#server === server) this.#reserve();
    });
  }

  #reserve() {
    clearTimeout(this.#reserveTimer);
    const attempt = this.#reserveAttempts + 1;
    // The first try comes soon; while the signaller stays away the wait
    // grows (3, 6, 12 s, up to half a minute), and the failure is reported
    // once per outage rather than on every try.
    this.#reserveTimer = setTimeout(async () => {
      if (this.#left) return;
      try {
        const server = await this.#peerApi().serve();
        if (this.#left) {
          closeServer(server);
          return;
        }
        this.#reserveAttempts = 0;
        this.#adoptServer(server);
        this.emit('invite', { inviteCode: this.inviteCode });
      } catch (e) {
        this.#reserveAttempts = attempt;
        if (attempt === 1) this.emit('error', { kind: 'server', message: e?.message || 'Could not reach the signaller' });
        this.#reserve();
      }
    }, backoffMs(attempt));
  }

  #onInbound(event) {
    if (this.#left) return;
    const conn = event?.conn;
    if (!conn) return;
    const claimed = event.user?.uuid ? String(event.user.uuid) : null;
    if (claimed && (claimed === this.#uuid || !this.#isMember(claimed))) {
      closeConn(conn, 'not a member of this conversation');
      return;
    }
    // Known already from the signaller, or identified by its hello.
    this.#wire(conn, { inbound: true, uuid: claimed, claimed });
  }

  /* ---- dialling --------------------------------------------------------- */

  async #dial(p) {
    p.dialing = true;
    p.attempts += 1;
    const invite = p.invite;
    let conn;
    try {
      conn = await this.#peerApi().connect(invite);
    } catch (e) {
      p.dialing = false;
      p.retryAt = Date.now() + backoffMs(p.attempts);
      this.#redialSoon(backoffMs(p.attempts));
      this.emit('change');
      return;
    }
    if (this.#left || this.peers.get(p.uuid) !== p || p.invite !== invite) {
      closeConn(conn, 'stale');
      p.dialing = false;
      return;
    }
    if (p.conn) {
      // They dialled us meanwhile and that link is up.
      closeConn(conn, 'duplicate');
      p.dialing = false;
      return;
    }
    this.#wire(conn, { inbound: false, uuid: p.uuid, peer: p, inv: invite });
  }

  /** Re-run the dial rule soon, without waiting for the next poll. */
  #redialSoon(ms = 2000) {
    clearTimeout(this.#redialTimer);
    this.#redialTimer = setTimeout(() => {
      this.#redialTimer = null;
      if (!this.#left) this.syncRoster(this.#roster);
    }, ms + 50);
  }

  /* ---- links ------------------------------------------------------------ */

  #newPeer(uuid) {
    return {
      uuid, invite: null, joinedAt: null, conn: null, link: null, inbound: false, open: false, dialing: false,
      attempts: 0, retryAt: 0, gone: false, name: '', mic: false, cam: false, screen: false,
      streamIds: { camera: null, screen: null }, streams: new Map(), speaking: false,
      // The invite code of the server the link up is to (dialled, or told in
      // their hello), and of the one they said goodbye from.
      linkInv: null, goneInv: null,
    };
  }

  /**
   * Listen on a connection. Outbound ones know their peer (and `inv`, the
   * code dialled); inbound ones are bound once they are identified (the
   * signaller's word, or a hello that agrees with it), and, when the peer
   * has a link up already, once their hello says which server this one is
   * from. Nothing carries media until it is bound. A connection the peer's
   * link has moved on from (replaced by a newer one) is no longer current:
   * what arrives on it, a goodbye included, is not the peer's.
   */
  #wire(conn, { inbound, uuid = null, claimed = null, peer = null, inv = null }) {
    const rec = { conn, inbound, uuid, claimed, peer, inv, link: null, opened: false, bound: false, signals: [], timer: null };
    if (inbound) this.#pending.add(rec);
    else {
      peer.conn = conn;
      peer.inbound = false;
      peer.open = false;
    }
    const current = () => {
      if (this.#left) return false;
      if (rec.bound) return rec.peer?.conn === conn; // the peer's link, until a newer one replaces it
      return inbound ? this.#pending.has(rec) : rec.peer?.conn === conn;
    };
    rec.timer = setTimeout(() => {
      // Never opened, or opened and never identified: given up.
      if (!rec.bound && current()) {
        closeConn(conn, 'timeout');
        this.#onConnClosed(rec, 'timeout');
      }
    }, DIAL_TIMEOUT_MS);
    conn.addEventListener('open', () => {
      if (!current()) return;
      rec.opened = true;
      // Whose server answered: the signaller says. It must be who the roster said.
      const owner = conn.owner?.uuid ? String(conn.owner.uuid) : null;
      if (!inbound && owner && owner !== rec.uuid) {
        closeConn(conn, 'unexpected server owner');
        this.#onConnClosed(rec, 'identity');
        return;
      }
      sendOn(conn, this.#helloFrame());
      // An inbound connection from someone with a link up already waits for
      // its hello, which says whether this is a second server of theirs
      // (their seat moved) or the same one dialling at the same time.
      if (rec.uuid && !rec.bound && !(inbound && this.peers.get(rec.uuid)?.conn)) this.#bind(rec);
    });
    conn.addEventListener('message', (e) => {
      if (current()) this.#onMessage(rec, e.data);
    });
    conn.addEventListener('close', (e) => {
      if (current()) this.#onConnClosed(rec, e?.reason || 'closed');
    });
    conn.addEventListener('error', (e) => {
      if (!current()) return;
      // A refusal from the signaller (invalid_invite, no_host) is followed
      // by close; a transport error mid-link is handled by MediaLink. Only a
      // dial that never opened is settled here.
      if (!rec.opened) {
        closeConn(conn, 'error');
        this.#onConnClosed(rec, e?.error?.code || 'error');
      }
    });
    // The library may hand over a connection that is open already.
    if (conn.connected) conn.dispatchEvent?.(new Event('open'));
  }

  /** Bind an identified, open connection to its peer record and put media on it. */
  #bind(rec) {
    if (rec.bound || this.#left) return;
    const uuid = rec.uuid;
    let p = this.peers.get(uuid);
    if (!p) {
      // The roster has not shown them to us yet (it lags a poll); the
      // signaller vouched for them, so they get a seat now.
      p = this.#newPeer(uuid);
      this.peers.set(uuid, p);
    }
    if (p.conn && p.conn !== rec.conn) {
      // A second connection to the same account. From a server other than
      // the one the link up is to, their seat moved (another tab took it,
      // or they served anew): the newer connection stands, the old one is
      // as good as gone. From the same server, both dialled at once: the
      // connection dialled by the greater id stays.
      const moved = rec.inv && p.linkInv && rec.inv !== p.linkInv;
      const keepNew = moved || (rec.inbound ? !shouldDial(this.#uuid, uuid) : shouldDial(this.#uuid, uuid));
      if (!keepNew) {
        closeConn(rec.conn, 'duplicate');
        this.#pending.delete(rec);
        return;
      }
      this.#dropLink(p, moved ? 'peer re-served' : 'duplicate', { quiet: true });
    }
    clearTimeout(rec.timer);
    rec.bound = true;
    rec.peer = p;
    this.#pending.delete(rec);
    p.conn = rec.conn;
    p.inbound = rec.inbound;
    p.linkInv = rec.inv;
    p.open = true;
    p.dialing = false;
    p.attempts = 0;
    p.retryAt = 0;
    p.gone = false;
    const link = new MediaLink({ conn: rec.conn, polite: rec.inbound, sendSignal: (payload) => sendOn(rec.conn, encode({ t: 'signal', ...payload })) });
    p.link = link;
    rec.link = link;
    link.addEventListener('remote-stream', (e) => {
      if (p.link === link) this.#onRemoteStream(p, e.detail.stream);
    });
    link.addEventListener('remote-stream-removed', (e) => {
      if (p.link === link) this.#onRemoteStreamRemoved(p, e.detail.stream);
    });
    link.addEventListener('lost', () => {
      if (p.link === link) this.#onLinkLost(p);
    });
    for (const s of rec.signals.splice(0)) link.handleSignal(s);
    this.#syncLocalMedia();
    this.emit('change');
  }

  #onMessage(rec, raw) {
    const msg = parseMessage(raw);
    if (!msg) return;
    if (msg.t === 'hello') {
      if (rec.uuid && msg.uuid !== rec.uuid) {
        closeConn(rec.conn, 'identity mismatch');
        this.#onConnClosed(rec, 'identity');
        return;
      }
      if (!rec.uuid) {
        if (msg.uuid === this.#uuid || !this.#isMember(msg.uuid)) {
          closeConn(rec.conn, 'not a member of this conversation');
          this.#pending.delete(rec);
          return;
        }
        rec.uuid = msg.uuid;
      }
      if (rec.inbound && msg.inv) rec.inv = msg.inv;
      if (rec.opened && !rec.bound) this.#bind(rec);
      if (rec.bound) {
        if (rec.inbound && msg.inv) rec.peer.linkInv = msg.inv;
        this.#applyState(rec.peer, msg);
      }
      return;
    }
    if (msg.t === 'state') {
      if (rec.bound) this.#applyState(rec.peer, msg);
      return;
    }
    if (msg.t === 'signal') {
      if (rec.link) rec.link.handleSignal(msg);
      else rec.signals.push(msg);
      return;
    }
    if (msg.t === 'bye' && rec.bound) {
      const p = rec.peer;
      p.gone = true;
      p.goneInv = p.linkInv;
      this.#dropLink(p, 'left', { quiet: true });
      this.emit('change');
    }
  }

  #applyState(p, msg) {
    if (msg.name) p.name = msg.name;
    p.mic = msg.mic;
    p.cam = msg.cam;
    p.screen = msg.screen;
    p.streamIds = msg.streams;
    // A stream that arrived before we knew what it was can be filed now.
    const unknown = p.streams.get('unknown');
    if (unknown) {
      p.streams.delete('unknown');
      this.#onRemoteStream(p, unknown);
    }
    if (!p.mic) this.#monitor.mute(p.uuid);
    this.emit('change');
  }

  #onConnClosed(rec, reason) {
    clearTimeout(rec.timer);
    if (!rec.bound) {
      this.#pending.delete(rec);
      if (!rec.inbound && rec.peer && rec.peer.conn === rec.conn) {
        // A dial that never opened: try again later, if the roster still lists them.
        const p = rec.peer;
        p.conn = null;
        p.dialing = false;
        p.open = false;
        p.retryAt = Date.now() + backoffMs(p.attempts);
        this.#redialSoon(backoffMs(p.attempts));
        this.emit('change');
      }
      return;
    }
    const p = rec.peer;
    if (p.conn !== rec.conn) return;
    // The link closed under us (their tab went, or the path died). If the
    // roster still lists them, a dial follows from whichever side the rule
    // names; a goodbye that came first has already marked them gone.
    this.#dropLink(p, reason);
    if (!p.gone) {
      p.retryAt = Date.now() + 1500;
      this.#redialSoon(1500);
    }
    this.emit('change');
  }

  #onLinkLost(p) {
    // The transport under a link that still looks open is dead: rebuild it.
    this.#dropLink(p, 'lost');
    p.retryAt = Date.now() + 500;
    this.#redialSoon(500);
    this.emit('change');
  }

  #dropLink(p, reason, { quiet = false } = {}) {
    p.link?.close();
    p.link = null;
    if (p.conn) closeConn(p.conn, reason);
    p.conn = null;
    p.open = false;
    p.dialing = false;
    for (const stream of p.streams.values()) this.#detachStream(p, stream);
    p.streams.clear();
    if (p.speaking) {
      p.speaking = false;
      this.#monitor.unwatch(p.uuid);
    }
    if (!quiet) this.emit('change');
  }

  /* ---- media ------------------------------------------------------------ */

  async #acquireMic() {
    if (!this.#media?.getUserMedia) {
      this.micAvailable = false;
      this.emit('error', { kind: 'mic', message: 'This browser cannot open a microphone here.' });
      return;
    }
    try {
      const stream = await this.#media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const track = stream.getAudioTracks()[0];
      if (this.#left) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      for (const old of this.camStream.getAudioTracks()) {
        old.stop();
        this.camStream.removeTrack(old);
      }
      this.camStream.addTrack(track);
      this.micAvailable = true;
      this.mic = true;
      track.addEventListener('ended', () => {
        if (this.camStream.getAudioTracks()[0] !== track) return;
        this.camStream.removeTrack(track);
        this.micAvailable = false;
        this.mic = false;
        this.#broadcastState();
        this.emit('error', { kind: 'mic', message: 'Your microphone was disconnected.' });
        this.emit('change');
      });
      this.#monitor.watch(this.#uuid, this.camStream);
      this.#syncLocalMedia();
    } catch (e) {
      this.micAvailable = false;
      this.mic = false;
      this.emit('error', { kind: 'mic', message: deviceMessage(e, 'microphone') });
    }
  }

  /** Every bound link carries the current local tracks and the send profile for this many peers. */
  #syncLocalMedia() {
    const open = [...this.peers.values()].filter((p) => p.link);
    const profile = { camera: cameraSendProfile(open.length) };
    const screenTrack = this.screenStream?.getVideoTracks()[0] ?? null;
    for (const p of open) {
      p.link.setSendProfile(profile);
      p.link.setCamStream(this.camStream);
      p.link.setScreenTrack(screenTrack, this.screenStream);
    }
  }

  #helloFrame() {
    return encode({ t: 'hello', uuid: this.#uuid, name: this.#name, inv: this.inviteCode, ...this.#stateFields() });
  }

  #stateFields() {
    return { mic: this.mic, cam: this.cam, screen: this.screen, streams: { camera: this.camStream.id, screen: this.screenStream?.id || null } };
  }

  #broadcastState() {
    const frame = encode({ t: 'state', name: this.#name, ...this.#stateFields() });
    for (const p of this.peers.values()) if (p.conn && p.open) sendOn(p.conn, frame);
  }

  #onRemoteStream(p, stream) {
    let kind = p.streamIds.screen === stream.id ? 'screen' : p.streamIds.camera === stream.id ? 'camera' : null;
    if (!kind) {
      // Not announced yet: an audio track means the camera stream; a
      // video-only one is the screen when the camera is already known.
      if (stream.getAudioTracks().length) kind = 'camera';
      else if (p.streams.has('camera') && p.streams.get('camera') !== stream) kind = 'screen';
      else kind = 'unknown';
    }
    for (const [k, s] of p.streams) if (s === stream && k !== kind) p.streams.delete(k);
    p.streams.set(kind, stream);
    if (kind === 'camera') {
      this.#play(p.uuid, stream);
      this.#monitor.watch(p.uuid, stream);
    }
    this.emit('change');
  }

  #onRemoteStreamRemoved(p, stream) {
    this.#detachStream(p, stream);
    for (const [k, s] of p.streams) if (s === stream) p.streams.delete(k);
    this.emit('change');
  }

  #detachStream(p, stream) {
    const audio = this.#sink?.querySelector(`audio[data-peer="${cssEscape(p.uuid)}"]`);
    if (audio && audio.srcObject === stream) {
      audio.srcObject = null;
      audio.remove();
    }
    // The speaking ring listens to the stream with the voice on it, the
    // camera's; a screen going away leaves it listening.
    if (p.streams.get('camera') === stream || stream.getAudioTracks().length) {
      this.#monitor.unwatch(p.uuid);
      if (p.speaking) p.speaking = false;
    }
  }

  /** Remote audio plays through a hidden element per peer, whatever the dock shows. */
  #play(uuid, stream) {
    if (typeof document === 'undefined') return;
    if (!this.#sink) {
      this.#sink = document.createElement('div');
      this.#sink.className = 'huddle-sink';
      this.#sink.hidden = true;
      document.body.append(this.#sink);
    }
    let audio = this.#sink.querySelector(`audio[data-peer="${cssEscape(uuid)}"]`);
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.dataset.peer = uuid;
      this.#sink.append(audio);
    }
    if (audio.srcObject !== stream) audio.srcObject = stream;
    audio.play?.().catch?.(() => {});
  }

  #onSpeaking(id, speaking) {
    if (id === this.#uuid) {
      if (this.speaking === speaking) return;
      this.speaking = speaking && this.mic;
    } else {
      const p = this.peers.get(id);
      if (!p || p.speaking === speaking) return;
      p.speaking = speaking;
    }
    this.emit('change');
  }

  #stopLocalTracks() {
    for (const t of this.camStream.getTracks()) {
      t.stop();
      this.camStream.removeTrack(t);
    }
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.mic = false;
    this.cam = false;
    this.screen = false;
  }
}

/**
 * Who is speaking, from WebAudio analysers with a little hysteresis: on
 * above one level, off only after staying below a lower one for a while,
 * so the ring does not flicker between words.
 */
class AudioLevelMonitor {
  #ctx = null;
  #entries = new Map();
  #timer = null;
  #onChange;

  constructor(onChange) {
    this.#onChange = onChange;
  }

  watch(id, stream) {
    const track = stream?.getAudioTracks?.()[0] ?? null;
    if (!track) return;
    if (this.#entries.get(id)?.track === track) return;
    this.unwatch(id);
    try {
      const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!Ctx) return;
      if (!this.#ctx) this.#ctx = new Ctx();
      if (this.#ctx.state === 'suspended') this.#ctx.resume().catch(() => {});
      const source = this.#ctx.createMediaStreamSource(stream);
      const analyser = this.#ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      this.#entries.set(id, { source, analyser, data: new Uint8Array(analyser.fftSize), track, speaking: false, belowSince: null });
      if (!this.#timer) this.#timer = setInterval(() => this.#sample(), 200);
    } catch {
      /* no analyser for this stream; the ring simply stays off */
    }
  }

  /** A muted peer is not speaking, whatever a trailing sample says. */
  mute(id) {
    const e = this.#entries.get(id);
    if (e?.speaking) {
      e.speaking = false;
      e.belowSince = null;
      this.#onChange(id, false);
    }
  }

  unwatch(id) {
    const e = this.#entries.get(id);
    if (!e) return;
    try {
      e.source.disconnect();
    } catch {
      /* already gone */
    }
    this.#entries.delete(id);
    if (e.speaking) this.#onChange(id, false);
    if (!this.#entries.size && this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  close() {
    for (const id of [...this.#entries.keys()]) this.unwatch(id);
    this.#ctx?.close().catch(() => {});
    this.#ctx = null;
  }

  #sample() {
    const now = Date.now();
    for (const [id, e] of this.#entries) {
      e.analyser.getByteTimeDomainData(e.data);
      let sum = 0;
      for (let i = 0; i < e.data.length; i++) {
        const v = (e.data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / e.data.length);
      const was = e.speaking;
      if (rms >= 0.02) {
        e.speaking = true;
        e.belowSince = null;
      } else if (e.speaking && rms < 0.01) {
        e.belowSince ??= now;
        if (now - e.belowSince >= 900) {
          e.speaking = false;
          e.belowSince = null;
        }
      } else e.belowSince = null;
      if (was !== e.speaking) this.#onChange(id, e.speaking);
    }
  }
}

function sendOn(conn, frame) {
  try {
    conn.send(frame);
  } catch {
    /* closed under us; the close event follows */
  }
}

function closeConn(conn, reason) {
  try {
    conn?.close?.(reason);
  } catch {
    /* already closed */
  }
}

function closeServer(server) {
  try {
    server?.close?.();
  } catch {
    /* already closed */
  }
}

function cssEscape(s) {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
}

/** What to tell the user when a device could not be opened. */
export function deviceMessage(error, device) {
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return `Allow the ${device} in your browser's site settings to use it here.`;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `No ${device} was found.`;
  if (name === 'NotReadableError' || name === 'AbortError') return `The ${device} is in use by another app.`;
  return `The ${device} could not be opened.`;
}

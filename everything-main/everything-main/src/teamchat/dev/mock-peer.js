/**
 * A stand-in for puter.peer for /mock.html: real RTCPeerConnections between
 * tabs of this origin (or within one), signalled over a BroadcastChannel in
 * place of Puter's signaller. Enough of the API for huddles: serve() with
 * generated codes or room names, connect(), a server's `connection` event
 * carrying the connector's identity, `conn.owner`, `conn.peerconnection`,
 * send/close and the open/message/close/error events.
 *
 * Nothing leaves the machine, so no ICE servers are needed: host candidates
 * connect the two peer connections directly.
 */
const CHANNEL = 'teamchat:mock:peer';
const NO_HOST_MS = 2000;
const rand = (n = 6) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');

function ev(type, props = {}) {
  return Object.assign(new Event(type), props);
}

class MockConn extends EventTarget {
  constructor(pc, { owner = null, room } = {}) {
    super();
    this.peerconnection = pc;
    this.owner = owner;
    this.room = room;
    this.connected = false;
    this.closed = false;
    this._dc = null;
    pc.addEventListener('connectionstatechange', () => {
      if ((pc.connectionState === 'failed' || pc.connectionState === 'closed') && !this.closed) this._onClosed('connection ' + pc.connectionState);
    });
  }

  attachChannel(dc) {
    this._dc = dc;
    dc.onopen = () => {
      if (this.closed) return;
      this.connected = true;
      this.dispatchEvent(ev('open'));
    };
    dc.onmessage = (e) => this.dispatchEvent(ev('message', { data: e.data }));
    dc.onclose = () => this._onClosed('channel closed');
    if (dc.readyState === 'open') dc.onopen();
  }

  send(data) {
    if (!this.connected || !this._dc || this._dc.readyState !== 'open') throw new Error('Connection is not open');
    this._dc.send(data);
  }

  close(reason) {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    try {
      this._dc?.close();
    } catch {
      /* already closed */
    }
    try {
      this.peerconnection.close();
    } catch {
      /* already closed */
    }
    this.dispatchEvent(ev('close', { reason }));
  }

  _onClosed(reason) {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    try {
      this.peerconnection.close();
    } catch {
      /* already closed */
    }
    this.dispatchEvent(ev('close', { reason }));
  }
}

class MockServer extends EventTarget {
  constructor(code) {
    super();
    this.inviteCode = code;
    this.connections = new Map();
    this.closed = false;
  }

  setGuestGrant() {}

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const c of this.connections.values()) c.close('server closed');
    this.connections.clear();
    this._onClose?.();
  }
}

export function createMockPeer({ user }) {
  const bus = new BroadcastChannel(CHANNEL);
  const servers = new Map(); // code -> MockServer (served from this tab)
  const dials = new Map(); // connId -> { pc, conn, queued, timer }
  const serving = new Map(); // connId -> { pc, conn, queued }
  const RTC = { iceServers: [] };

  const post = (msg) => {
    bus.postMessage(msg);
    // A BroadcastChannel never delivers to its own port: a tab serving and
    // dialling at once (or dialling itself) still needs to hear it.
    handle(msg);
  };
  bus.onmessage = (e) => handle(e.data);

  const feedIce = async (rec, candidate) => {
    if (!rec.pc.remoteDescription) {
      rec.queued.push(candidate);
      return;
    }
    try {
      await rec.pc.addIceCandidate(candidate ?? undefined);
    } catch {
      /* a candidate for a closed connection */
    }
  };
  const flushIce = async (rec) => {
    for (const c of rec.queued.splice(0)) await feedIce(rec, c);
  };

  async function handle(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'dial') {
      const srv = servers.get(msg.code);
      if (!srv || srv.closed) return;
      const pc = new RTCPeerConnection(RTC);
      const conn = new MockConn(pc, { owner: { ...user }, room: /^[a-z]/.test(msg.code) ? msg.code : undefined });
      const rec = { pc, conn, queued: [] };
      serving.set(msg.connId, rec);
      pc.ondatachannel = (e) => conn.attachChannel(e.channel);
      pc.onicecandidate = (e) => post({ t: 'ice', connId: msg.connId, to: 'dialer', candidate: e.candidate ? e.candidate.toJSON() : null });
      conn.addEventListener('close', () => {
        serving.delete(msg.connId);
        srv.connections.delete(msg.connId);
      });
      try {
        await pc.setRemoteDescription(msg.offer);
        await pc.setLocalDescription(await pc.createAnswer());
      } catch (e) {
        conn.close('bad offer');
        return;
      }
      srv.connections.set(msg.connId, conn);
      post({ t: 'answer', connId: msg.connId, answer: pc.localDescription.toJSON(), owner: { ...user } });
      await flushIce(rec);
      srv.dispatchEvent(ev('connection', { conn, user: msg.from ? { ...msg.from } : undefined }));
      return;
    }
    if (msg.t === 'answer') {
      const rec = dials.get(msg.connId);
      if (!rec || rec.answered) return;
      rec.answered = true;
      clearTimeout(rec.timer);
      rec.conn.owner = msg.owner || null;
      try {
        await rec.pc.setRemoteDescription(msg.answer);
      } catch {
        rec.conn.close('bad answer');
        return;
      }
      await flushIce(rec);
      return;
    }
    if (msg.t === 'ice') {
      const rec = msg.to === 'dialer' ? dials.get(msg.connId) : serving.get(msg.connId);
      if (rec) await feedIce(rec, msg.candidate);
    }
  }

  return {
    async serve(opts = {}) {
      if (opts.name !== undefined && !/^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/.test(String(opts.name))) throw new TypeError('Not a valid room name');
      const code = opts.name || `MK-${rand()}`;
      // The same identity serving a name again takes it over, as Puter does.
      servers.get(code)?.close();
      const server = new MockServer(code);
      server._onClose = () => {
        if (servers.get(code) === server) servers.delete(code);
      };
      servers.set(code, server);
      return server;
    },
    async connect(code) {
      const pc = new RTCPeerConnection(RTC);
      const connId = rand(8);
      const conn = new MockConn(pc, { owner: null, room: /^[a-z]/.test(String(code)) ? code : undefined });
      conn.attachChannel(pc.createDataChannel('puter'));
      const rec = { pc, conn, queued: [], answered: false, timer: null };
      dials.set(connId, rec);
      conn.addEventListener('close', () => {
        clearTimeout(rec.timer);
        dials.delete(connId);
      });
      pc.onicecandidate = (e) => post({ t: 'ice', connId, to: 'server', candidate: e.candidate ? e.candidate.toJSON() : null });
      await pc.setLocalDescription(await pc.createOffer());
      rec.timer = setTimeout(() => {
        if (rec.answered || conn.closed) return;
        const error = Object.assign(new Error('Invalid invite code'), { code: 'invalid_invite' });
        conn.dispatchEvent(ev('error', { error }));
        conn.close('invalid_invite');
      }, NO_HOST_MS);
      post({ t: 'dial', code: String(code), connId, from: { uuid: user.uuid, username: user.username }, offer: pc.localDescription.toJSON() });
      return conn;
    },
    async ensureTurnRelays() {},
    async createGuestGrant() {
      return { grant: 'mock-grant', expiresAt: Math.floor(Date.now() / 1000) + 3600 };
    },
  };
}

/**
 * ?fakemic=1: a microphone (a quiet tone) and a camera (a moving colour on
 * a canvas) that need no permission, so a huddle can be exercised in tabs
 * the automation drives. Screen sharing gets the same canvas.
 */
export function installFakeDevices() {
  let ctx = null;
  const fakeAudioTrack = () => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    ctx ??= new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    const dest = ctx.createMediaStreamDestination();
    osc.frequency.value = 220 + Math.random() * 220;
    osc.connect(gain).connect(dest);
    osc.start();
    ctx.resume().catch(() => {});
    const track = dest.stream.getAudioTracks()[0];
    const stop = track.stop.bind(track);
    track.stop = () => {
      try {
        osc.stop();
      } catch {
        /* stopped */
      }
      stop();
    };
    return track;
  };
  const fakeVideoTrack = (label) => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const g = canvas.getContext('2d');
    let hue = Math.floor(Math.random() * 360);
    const timer = setInterval(() => {
      hue = (hue + 2) % 360;
      g.fillStyle = `hsl(${hue} 60% 45%)`;
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = '#fff';
      g.font = '20px system-ui';
      g.fillText(label, 16, 100);
    }, 100);
    const track = canvas.captureStream(10).getVideoTracks()[0];
    const stop = track.stop.bind(track);
    track.stop = () => {
      clearInterval(timer);
      stop();
    };
    return track;
  };
  const md = navigator.mediaDevices || {};
  md.getUserMedia = async (constraints = {}) => {
    const stream = new MediaStream();
    if (constraints.audio) stream.addTrack(fakeAudioTrack());
    if (constraints.video) stream.addTrack(fakeVideoTrack('camera'));
    return stream;
  };
  md.getDisplayMedia = async () => new MediaStream([fakeVideoTrack('screen')]);
  if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: md });
}

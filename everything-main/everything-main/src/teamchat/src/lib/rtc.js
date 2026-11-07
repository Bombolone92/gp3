/**
 * MediaLink: media tracks layered onto a Puter Peer connection.
 *
 * puter.peer.connect() / serve() give us a WebRTC data channel with the
 * signalling and TURN relays taken care of. A huddle needs audio (and, when
 * someone turns it on, a camera or a screen) on the same connection, and
 * the library leaves the underlying RTCPeerConnection open for exactly
 * that: `conn.peerconnection`. This wrapper adds and removes local tracks
 * on it and runs the renegotiation those changes need over the data channel
 * that is already open (the "perfect negotiation" pattern, with one side
 * polite so simultaneous offers settle).
 *
 * It also watches the transport. The Puter connection reports `close` only
 * when its data channel closes, and a data channel does not close when the
 * network path under it dies; it just stops delivering. So a link whose ICE
 * has failed (a network switch, sleep and wake, a relay allocation lapsing)
 * looks open while every track on it is frozen. The link reports that as
 * 'lost' so the huddle can dial again; there is no in-place recovery, since
 * an ICE restart's offer would have to travel over the very channel that
 * stopped delivering.
 *
 * Events (an EventTarget; `detail` carries the payload):
 *   'remote-stream'          { stream }   a stream (or a new track in one) from the other side
 *   'remote-stream-removed'  { stream }   every track of it has ended
 *   'lost'                   {}           the transport is gone
 *   'restored'               {}           it came back on its own after 'lost'
 *
 * Adapted from Puter Meetings' rtc.js.
 */

/** Camera encoding for a huddle with `peerCount` others: a mesh sends every stream to everyone, so cap the upload. */
export function cameraSendProfile(peerCount) {
  if (peerCount <= 1) return { maxBitrate: 900_000, maxFramerate: 24, scaleResolutionDownBy: 1, degradationPreference: 'maintain-framerate' };
  if (peerCount <= 3) return { maxBitrate: 500_000, maxFramerate: 20, scaleResolutionDownBy: 1.5, degradationPreference: 'maintain-framerate' };
  if (peerCount <= 6) return { maxBitrate: 300_000, maxFramerate: 15, scaleResolutionDownBy: 2, degradationPreference: 'maintain-framerate' };
  return { maxBitrate: 180_000, maxFramerate: 12, scaleResolutionDownBy: 2, degradationPreference: 'maintain-framerate' };
}

/** Screen sharing: sharpness over motion, and there is rarely more than one presenter. */
export const SCREEN_SEND_PROFILE = Object.freeze({ maxBitrate: 2_000_000, maxFramerate: 12, scaleResolutionDownBy: 1, degradationPreference: 'maintain-resolution' });

/**
 * How long a link may sit in 'disconnected' before it is given up as lost.
 * A Wi-Fi blip drops a connection to 'disconnected' and heals in a second
 * or two; a dead path never heals, and browsers take half a minute or more
 * to say 'failed' (some never do). Ten seconds of silence is plenty.
 */
export const LINK_DISCONNECT_GRACE_MS = 10_000;

export class MediaLink extends EventTarget {
  /** @type {RTCPeerConnection} */
  pc;
  polite;
  #sendSignal;
  #makingOffer = false;
  #ignoreOffer = false;
  #needsNegotiation = false;
  #audioSender = null;
  #videoSender = null;
  #screenSender = null;
  #announced = new Set();
  #listeners = [];
  #closed = false;
  #lost = false;
  #disconnectTimer = null;
  #profile = { camera: cameraSendProfile(1), screen: SCREEN_SEND_PROFILE };

  /**
   * @param {object} opts
   * @param {object} opts.conn   a PuterPeerConnection exposing `.peerconnection`
   * @param {boolean} opts.polite  which side yields on offer glare (must differ per side)
   * @param {(payload: object) => void} opts.sendSignal  carries { sdp } / { candidate } to the peer
   */
  constructor({ conn, polite, sendSignal }) {
    super();
    this.polite = !!polite;
    this.#sendSignal = sendSignal;
    this.pc = conn?.peerconnection;
    if (!this.pc) throw new Error('This Puter connection does not expose its peer connection; media cannot be added to it.');
    this.#listen(this.pc, 'negotiationneeded', () => this.#negotiate());
    this.#listen(this.pc, 'icecandidate', (e) => this.#sendSignal({ candidate: e.candidate ? candidateJson(e.candidate) : null }));
    this.#listen(this.pc, 'track', (e) => this.#onTrack(e));
    this.#listen(this.pc, 'connectionstatechange', () => this.#onConnectionState(this.pc.connectionState));
    // Sender encodings exist only once a negotiation has settled: re-apply
    // the send profile after each one.
    this.#listen(this.pc, 'signalingstatechange', () => {
      if (this.pc.signalingState !== 'stable') return;
      this.#applyProfiles();
      if (this.#needsNegotiation) {
        this.#needsNegotiation = false;
        queueMicrotask(() => this.#negotiate());
      }
    });
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /** Update outgoing encoding limits (when the participant count changes). */
  setSendProfile(profile) {
    this.#profile = { ...this.#profile, ...profile };
    this.#applyProfiles();
  }

  /** Make the outgoing mic and camera senders match the stream's live tracks (replaceTrack where possible: no renegotiation). */
  setCamStream(stream) {
    if (this.#closed) return;
    const audio = stream.getAudioTracks().find((t) => t.readyState === 'live') ?? null;
    const video = stream.getVideoTracks().find((t) => t.readyState === 'live') ?? null;
    this.#audioSender = this.#syncSender(this.#audioSender, audio, stream);
    this.#videoSender = this.#syncSender(this.#videoSender, video, stream);
  }

  /** Start or stop sending the screen track. */
  setScreenTrack(track, stream) {
    if (this.#closed) return;
    if (track) {
      if (this.#screenSender) this.#screenSender.replaceTrack(track).catch(() => {});
      else {
        this.#screenSender = this.pc.addTrack(track, stream);
        this.#applyParams(this.#screenSender, this.#profile.screen);
      }
    } else if (this.#screenSender) {
      try {
        this.pc.removeTrack(this.#screenSender);
      } catch {
        /* already closed */
      }
      this.#screenSender = null;
    }
  }

  /** Handle an incoming { sdp } or { candidate } from the other side. */
  async handleSignal(msg) {
    if (this.#closed) return;
    const { pc } = this;
    try {
      if (msg.sdp) {
        const description = msg.sdp;
        const collision = description.type === 'offer' && (this.#makingOffer || pc.signalingState !== 'stable');
        this.#ignoreOffer = !this.polite && collision;
        if (this.#ignoreOffer) return;
        await pc.setRemoteDescription(description); // rolls back an offer of ours when needed
        if (description.type === 'offer') {
          await pc.setLocalDescription();
          this.#sendSignal({ sdp: descriptionJson(pc.localDescription) });
        }
      } else if (msg.candidate !== undefined) {
        try {
          await pc.addIceCandidate(msg.candidate ?? undefined);
        } catch (err) {
          if (!this.#ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.error('[huddle] signal handling failed', err);
    }
  }

  get lost() {
    return this.#lost;
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#disconnectTimer);
    this.#disconnectTimer = null;
    for (const sender of [this.#audioSender, this.#videoSender, this.#screenSender]) sender?.replaceTrack?.(null).catch?.(() => {});
    for (const [target, type, fn] of this.#listeners) target.removeEventListener?.(type, fn);
    this.#listeners = [];
  }

  /* ---- internals -------------------------------------------------------- */

  #onConnectionState(state) {
    if (this.#closed) return;
    if (state === 'connected') {
      clearTimeout(this.#disconnectTimer);
      this.#disconnectTimer = null;
      this.#applyProfiles();
      if (this.#lost) {
        this.#lost = false;
        this.emit('restored');
      }
    } else if (state === 'disconnected') {
      if (this.#lost || this.#disconnectTimer) return;
      this.#disconnectTimer = setTimeout(() => {
        this.#disconnectTimer = null;
        this.#markLost();
      }, LINK_DISCONNECT_GRACE_MS);
    } else if (state === 'failed') {
      clearTimeout(this.#disconnectTimer);
      this.#disconnectTimer = null;
      this.#markLost();
    }
  }

  #markLost() {
    if (this.#closed || this.#lost) return;
    this.#lost = true;
    this.emit('lost');
  }

  #listen(target, type, fn) {
    target.addEventListener(type, fn);
    this.#listeners.push([target, type, fn]);
  }

  async #negotiate() {
    if (this.#closed) return;
    if (this.pc.signalingState !== 'stable') {
      this.#needsNegotiation = true;
      return;
    }
    try {
      this.#makingOffer = true;
      await this.pc.setLocalDescription();
      this.#sendSignal({ sdp: descriptionJson(this.pc.localDescription) });
    } catch (err) {
      console.error('[huddle] negotiation failed', err);
    } finally {
      this.#makingOffer = false;
    }
  }

  #syncSender(sender, track, stream) {
    if (track) {
      if (sender) {
        if (sender.track !== track) sender.replaceTrack(track).catch(() => {});
        return sender;
      }
      const created = this.pc.addTrack(track, stream);
      if (track.kind === 'video') this.#applyParams(created, this.#profile.camera);
      return created;
    }
    // Keep the sender but send nothing: the camera coming back then needs
    // no renegotiation round trip.
    if (sender) sender.replaceTrack(null).catch(() => {});
    return sender;
  }

  #applyProfiles() {
    this.#applyParams(this.#videoSender, this.#profile.camera);
    this.#applyParams(this.#screenSender, this.#profile.screen);
  }

  async #applyParams(sender, cfg) {
    if (!sender || !cfg || this.#closed) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) return; // appear once a negotiation settles; re-applied then
      const enc = params.encodings[0];
      enc.maxBitrate = cfg.maxBitrate;
      enc.maxFramerate = cfg.maxFramerate;
      enc.scaleResolutionDownBy = cfg.scaleResolutionDownBy;
      params.degradationPreference = cfg.degradationPreference;
      await sender.setParameters(params);
    } catch {
      /* an unsupported field or a transient state; the next stable negotiation retries */
    }
  }

  #onTrack(event) {
    for (const stream of event.streams?.length ? event.streams : []) {
      if (!this.#announced.has(stream.id)) {
        this.#announced.add(stream.id);
        stream.addEventListener?.('removetrack', () => {
          if (stream.getTracks().length === 0) this.#dropStream(stream);
        });
      }
      // Announced again for every track that lands in it: consumers adopt
      // idempotently and get to look at the stream again when a second
      // track (video after audio) arrives.
      this.emit('remote-stream', { stream });
      event.track.addEventListener?.('ended', () => {
        if (stream.getTracks().every((t) => t.readyState === 'ended')) this.#dropStream(stream);
      });
    }
  }

  #dropStream(stream) {
    if (!this.#announced.has(stream.id)) return;
    this.#announced.delete(stream.id);
    this.emit('remote-stream-removed', { stream });
  }
}

function descriptionJson(description) {
  if (!description) return description;
  return typeof description.toJSON === 'function' ? description.toJSON() : { type: description.type, sdp: description.sdp };
}

function candidateJson(candidate) {
  return typeof candidate.toJSON === 'function' ? candidate.toJSON() : { candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex, usernameFragment: candidate.usernameFragment };
}

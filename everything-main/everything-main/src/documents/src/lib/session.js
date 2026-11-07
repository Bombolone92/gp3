/**
 * Per-session state that is not part of any document: whether anyone is
 * signed in to Puter, who, and the theme preference. Views subscribe to
 * 'change' to re-render the pieces that show these. The theme lives in
 * localStorage so the pre-paint script in index.html can apply it before the
 * first frame.
 *
 * Nobody has to sign in to write. The editor runs in the browser; Puter is
 * where documents are saved, so a sign-in is asked for at the first action
 * that needs the cloud (saving, opening a file, listing the documents). Until
 * init() has asked the SDK, the state is 'unknown' and nothing is gated.
 */

import { applyTheme, currentTheme } from '../ui/theme.js';
import * as P from './puter.js';

class Session extends EventTarget {
  constructor() {
    super();
    this.user = null;
    /** 'unknown' before the SDK was asked; then 'in' or 'out'. */
    this.state = 'unknown';
    this._signingIn = null;
    this._pictureCache = null;
  }

  async init() {
    applyTheme(currentTheme());
    await this.refresh();
  }

  /** Ask the SDK who is signed in (nobody, possibly) and tell the views. */
  async refresh() {
    const signedIn = await P.isSignedIn();
    this.user = signedIn ? await P.getUser() : null;
    this.state = signedIn ? 'in' : 'out';
    this._emit();
  }

  /** The SDK signed the user in on its own (before an AI request, say). */
  signedInAs(user) {
    this.user = user || this.user;
    this.state = 'in';
    this._emit();
  }

  get signedIn() {
    return this.state === 'in';
  }

  /** Known to have no Puter session: cloud actions ask for a sign-in first. */
  get signedOut() {
    return this.state === 'out';
  }

  /**
   * Open Puter's sign-in dialog. Resolves true once signed in, false when the
   * dialog was dismissed. Concurrent callers share one dialog.
   */
  signIn() {
    if (this.state === 'in') return Promise.resolve(true);
    if (!this._signingIn) {
      this._signingIn = (async () => {
        try { await P.signIn(); } catch { return false; }
        await this.refresh();
        return this.state === 'in';
      })().finally(() => { this._signingIn = null; });
    }
    return this._signingIn;
  }

  /** The name to show and to sign comments with. */
  get username() {
    return this.user?.username || (this.state === 'out' ? 'Guest' : 'Puter user');
  }

  get accountId() {
    return this.signedIn ? this.user?.uuid || this.user?.username || null : null;
  }

  /**
   * One memory-only entry for the current account, shared by home and editor.
   * Refresh on the next render after five minutes; retry missing/failed pictures
   * after one minute. No base64 in browser storage, polling, or startup wait.
   */
  async getProfilePicture() {
    const id = this._syncPictureCache();
    if (!id) return null;
    let entry = this._pictureCache;
    if (!entry || (!entry.pending && Date.now() >= entry.expires)) {
      entry = { id, picture: null, expires: 0, pending: null };
      this._pictureCache = entry;
      entry.pending = P.getProfilePicture().then((picture) => {
        entry.picture = picture;
        entry.expires = Date.now() + (picture ? 5 * 60_000 : 60_000);
        // A response from before sign-out or an account switch belongs to nobody.
        return this._pictureCache === entry ? picture : null;
      }).finally(() => { entry.pending = null; });
    }
    return entry.pending || entry.picture;
  }

  _syncPictureCache() {
    const id = this.accountId;
    if (!id || this._pictureCache?.id !== id) this._pictureCache = null;
    return id;
  }

  get theme() {
    return currentTheme();
  }

  setTheme(mode) {
    applyTheme(mode);
    this._emit();
  }

  _emit() {
    this._syncPictureCache();
    this.dispatchEvent(new CustomEvent('change'));
  }
}

export const session = new Session();

/**
 * Where workspaces live. By default each workspace owner runs their own copy
 * of the worker, deployed by the app into their Puter account the first time
 * they create a workspace (see lib/deploy.js). The bundle the app deploys is
 * served next to it, at WORKER_BUNDLE_URL.
 *
 * A shared worker can be configured instead, for a single deployment that
 * everyone creates workspaces on, the way the first release worked:
 *
 *   ?worker=https://my-teamchat.puter.work   (remembered in localStorage)
 *   VITE_WORKER_URL=https://...              (at build time)
 *
 * With a shared worker set, creating a workspace never deploys anything and
 * the worker must allow it (PUT /api/server { open: true } by its owner).
 */

import { trustServer } from './lib/refs.js';

/**
 * A shared worker named by a link must be a puter.work worker. The app sends
 * the signed-in user's session to whatever host it calls (see lib/refs.js),
 * and anyone can hand someone a link: `?worker=https://evil.example` would
 * otherwise be remembered and given the session for good. A host elsewhere
 * is for the operator to configure at build time (VITE_WORKER_URL).
 */
function acceptableFromLink(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.endsWith('.puter.work');
  } catch {
    return false;
  }
}

function resolveSharedWorkerUrl() {
  try {
    const fromQuery = new URLSearchParams(location.search).get('worker');
    if (fromQuery !== null) {
      if (fromQuery && acceptableFromLink(fromQuery)) localStorage.setItem('teamchat:worker', fromQuery);
      else if (!fromQuery) localStorage.removeItem('teamchat:worker'); // ?worker= clears it
      const clean = new URL(location.href);
      clean.searchParams.delete('worker');
      history.replaceState(null, '', clean.toString());
    }
    const saved = localStorage.getItem('teamchat:worker');
    if (saved && acceptableFromLink(saved)) return saved;
    if (saved) localStorage.removeItem('teamchat:worker'); // remembered from before the check existed
  } catch {
    /* storage unavailable */
  }
  return import.meta.env?.VITE_WORKER_URL || null;
}

const shared = resolveSharedWorkerUrl();
export const SHARED_WORKER_URL = shared ? shared.replace(/\/+$/, '') : null;
// The one host outside puter.work the app will send the user's session to
// on its own: the operator configured it (see lib/refs.js).
if (SHARED_WORKER_URL) trustServer(SHARED_WORKER_URL);

/** The worker bundle the app ships, relative to the page (public/worker/). */
export const WORKER_BUNDLE_URL = typeof document !== 'undefined'
  ? new URL('./worker/teamchat-worker.js', document.baseURI).toString()
  : './worker/teamchat-worker.js';

/** Prefix of the worker names the app creates: teamchat-xxxxxxxxxx.puter.work */
export const WORKER_NAME_PREFIX = 'teamchat-';

/**
 * The one shared, app-owned email worker (worker/email.js), deployed once by
 * the app's developer — sending email is a capability workspace workers are
 * never given. Everyone's invitation emails go out through it, each send
 * authorized by the worker and billed to the signed-in sender.
 */
export const EMAIL_WORKER_URL = import.meta.env?.VITE_EMAIL_WORKER_URL || 'https://teamchat-email.puter.work';

export const APP_NAME = 'Teamchat';

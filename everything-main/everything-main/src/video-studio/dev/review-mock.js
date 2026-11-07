/**
 * Development harness for Share for review: runs the whole app against an
 * in-page fake Puter (dev/fake-puter.js) whose state lives in IndexedDB, so
 * an owner and reviewers in separate tabs share it the way they would share
 * Puter. The review worker's real code runs in whichever tab calls it.
 *
 *   /dev/review-mock.html?as=alice     signed in as alice (or bob, carol, dave)
 *   /dev/review-mock.html?reset=1      wipe the fake Puter
 *   /dev/review-mock.html?as=bob&signedout=1   start signed out
 *
 * Read links are answered by dev/review-mock-sw.js with Range support.
 * Nothing here talks to Puter.
 */
import { createWorld, USERS } from './fake-puter.js';
import { idbStorage } from './fake-store.js';

const params = new URLSearchParams(location.search);
const storage = idbStorage();

if (params.has('reset')) {
  await storage.clear();
  for (const k of Object.keys(localStorage)) if (k.startsWith('video-studio')) localStorage.removeItem(k);
  params.delete('reset');
  location.replace(`${location.pathname}${params.size ? `?${params}` : ''}`);
  await new Promise(() => {});
}

const who = USERS[params.get('as')] ? params.get('as') : sessionStorage.getItem('vs-mock-user') || 'alice';
sessionStorage.setItem('vs-mock-user', who);
document.title = `Video Studio (harness: ${who})`;

// The service worker must control this page before a <video> asks for a read link.
const reg = await navigator.serviceWorker.register('/dev/review-mock-sw.js', { type: 'module', scope: '/dev/' });
await navigator.serviceWorker.ready;
if (!navigator.serviceWorker.controller) {
  await new Promise((resolve) => {
    navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
    setTimeout(resolve, 3000);
  });
}
void reg;

const world = createWorld({ storage: idbStorage(), latency: 30 });
const sdk = world.sdk(USERS[who], { signedIn: !params.has('signedout') });
const signIn = sdk.auth.signIn;
sdk.auth.signIn = async () => {
  await signIn();
  params.delete('signedout');
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
  return sdk.auth.getUser();
};
window.puter = sdk;

// The bundle the app deploys is stood in for by the worker source running in this page.
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  if (/\/worker\/video-studio-review-worker\.js(\?|$)/.test(url)) return new Response('/* video-studio-review-worker build=dev at=1 */\n// harness: the worker runs from source in this page\n');
  return realFetch(input, init);
};

const reads = [];
new BroadcastChannel('review-mock-reads').addEventListener('message', (e) => reads.push(e.data));
window.__mock = { world, user: USERS[who], storage, reads };
await import('../src/main.js');

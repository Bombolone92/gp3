/**
 * The public respondent page (r/index.html). A survey link looks like
 *
 *   https://survey.puter.com/r/#<label>/<collectorId>
 *
 * where <label> names the creator's collector worker (sv-<label>.puter.work).
 * Both parts ride in the URL fragment, which browsers never send to a
 * server. The page loads no SDK: it fetches the survey from the worker and
 * posts the answers back, as CORS-simple requests (no preflight).
 *
 * ?embed=1 trims the page for an <iframe> and reports its height to the
 * parent so the frame can grow with the survey.
 */
import '../styles/respond.css';
import './page.css';
import { mountSurvey, mountMessage, applySurveyTheme, trackWidth } from './render.js';

const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const ID_RE = /^[a-z0-9]{6,32}$/;

/**
 * Survey content comes from whichever worker the link names, so the page
 * locks itself down before showing any: scripts only from this origin (no
 * inline script, no javascript: URLs, no eval), no plugins, no <base>
 * rewrites, network only to Puter workers. Local demo mode runs the worker
 * in-page with eval and stays out of this.
 */
function lockDown() {
  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self' https://*.puter.work",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  document.head.append(meta);
}

const root = document.getElementById('survey');
const params = new URLSearchParams(location.search);
const embedded = params.has('embed');
if (embedded) {
  document.documentElement.classList.add('sv-embed');
  document.body.classList.add('sv-embed');
}

function parseLink(hash) {
  const [label, cid] = String(hash || '').replace(/^#\/?/, '').split('/');
  if (!LABEL_RE.test(label || '') || !ID_RE.test(cid || '')) return null;
  return { label, cid };
}

async function getFetch(label) {
  if (label === 'local') {
    const { localWorkerFetch, LOCAL_WORKER_URL } = await import('../data/local-worker.js');
    return { fetchFn: localWorkerFetch(), base: LOCAL_WORKER_URL };
  }
  return { fetchFn: (url, init) => fetch(url, init), base: `https://sv-${label}.puter.work` };
}

function timeout(ms) {
  return typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * POST to a password-protected route. The collector counts every attempt
 * while it is checked, so when many people send the right password at the
 * same moment some briefly get "too many attempts": those try once more,
 * a moment later, before the page says the link is locked.
 */
async function postChecked(ctx, path, body, ms) {
  const send = () =>
    ctx.fetchFn(`${ctx.base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body,
      signal: timeout(ms),
    });
  const res = await send();
  if (res.status !== 429) return res;
  await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1500));
  return send();
}

function done(message) {
  root.setAttribute('aria-busy', 'false');
  return message;
}

function showStatus(title, message, info = {}) {
  done();
  document.title = info.title || title;
  mountMessage(root, { title, message, theme: info.theme, surveyTitle: info.title || '' });
}

const TOO_MANY = 'Too many wrong passwords were tried on this link. Please wait 10 minutes, then try again.';

// "Already answered" marks are keyed by the link's own address (worker and
// link id, as checked by parseLink), never by an id a worker reports: a
// survey from another worker could otherwise claim this one's id and mark
// it answered. Marks saved as just the link id still count.
const doneKey = (link) => `sv:done:${link.label}/${link.cid}`;

function alreadyAnswered(link) {
  try {
    return !!(localStorage.getItem(doneKey(link)) || localStorage.getItem(`sv:done:${link.cid}`));
  } catch {
    return false;
  }
}

function markAnswered(link) {
  try {
    localStorage.setItem(doneKey(link), String(Date.now()));
  } catch {
    /* private mode: nothing to remember with */
  }
}

function statusFor(code, info) {
  if (code === 'full') {
    return ['This survey is full', 'It has received all the responses it needs. Thank you for your interest.'];
  }
  return ['This survey is closed', (info && info.closedMessage) || 'It is no longer accepting responses.'];
}

function start({ survey, collector }, ctx) {
  done();
  document.title = survey.title || 'Survey';
  if (collector && collector.allowMultiple === false && alreadyAnswered(ctx)) {
    showStatus('You already responded', 'Thanks, your answers to this survey were recorded earlier.', survey);
    return;
  }
  mountSurvey(root, {
    survey,
    collector,
    embedded,
    onSubmit: async (payload) => {
      const res = await postChecked(ctx, `/api/c/${ctx.cid}/responses`, JSON.stringify({ ...payload, password: ctx.password || undefined, pass: ctx.pass || undefined }), 30_000);
      const data = await readJson(res);
      if (res.ok && data && data.ok) return { ok: true, outcome: data.outcome };
      if (res.status === 422 && data && data.errors) return { ok: false, errors: data.errors };
      if (res.status === 410) {
        const [title, message] = statusFor(data && data.error, data);
        return { ok: false, closed: { title, message } };
      }
      if (res.status === 413) return { ok: false, message: 'Your answers are too long to send. Please shorten your longest answers and try again.' };
      if (res.status === 429) return { ok: false, message: `Your response could not be sent. ${TOO_MANY}` };
      return { ok: false, message: 'Your response could not be sent. Please try again in a moment.' };
    },
    onFinish: () => {
      if (collector) markAnswered(ctx);
    },
  });
}

function showLock(info, ctx) {
  done();
  document.title = info.title || 'Survey';
  root.classList.add('sv-root');
  applySurveyTheme(root, info.theme || {});
  trackWidth(root);
  const input = Object.assign(document.createElement('input'), {
    type: 'password',
    className: 'sv-input',
    id: 'sv-pass',
    autocomplete: 'off',
    required: true,
  });
  const error = Object.assign(document.createElement('p'), { className: 'sv-error', id: 'sv-pass-error', hidden: true });
  error.setAttribute('role', 'alert');
  const form = document.createElement('form');
  const label = Object.assign(document.createElement('label'), { htmlFor: 'sv-pass', textContent: 'Password' });
  const button = Object.assign(document.createElement('button'), { type: 'submit', className: 'sv-btn sv-btn-primary', textContent: 'Continue' });
  form.append(label, input, error, button);
  const box = document.createElement('div');
  box.className = 'sv-lock';
  // The page's only heading.
  const h = Object.assign(document.createElement('h1'), { textContent: info.title || 'Survey' });
  const p = Object.assign(document.createElement('p'), { className: 'sv-hint', textContent: 'This survey is password protected.' });
  box.append(h, p, form);
  const shell = document.createElement('div');
  shell.className = 'sv-shell';
  const main = document.createElement('main');
  main.id = 'sv-main';
  main.append(box);
  shell.append(main);
  root.replaceChildren(shell);
  input.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    button.disabled = true;
    try {
      const res = await postChecked(ctx, `/api/c/${ctx.cid}/unlock`, JSON.stringify({ password: input.value }), 20_000);
      const data = await readJson(res);
      if (res.ok && data && data.survey) {
        ctx.password = input.value;
        ctx.pass = typeof data.pass === 'string' ? data.pass : '';
        start(data, ctx);
        // The focused password box is gone: continue at the questions.
        if (!root.contains(document.activeElement)) document.getElementById('sv-main')?.focus({ preventScroll: true });
        return;
      }
      error.textContent =
        res.status === 403 ? 'That password is not right.' : res.status === 429 ? TOO_MANY : 'Something went wrong. Please try again.';
    } catch {
      error.textContent = 'Could not reach the survey. Check your connection.';
    }
    error.hidden = false;
    // Tied to the field, so it is read with it when focus returns there.
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', error.id);
    button.disabled = false;
    input.select();
  });
}

async function boot() {
  const link = parseLink(location.hash);
  if (!link) {
    showStatus('Survey not found', 'This link is incomplete or mistyped. Check it with the person who sent it to you.');
    return;
  }
  if (link.label !== 'local') lockDown();
  const { fetchFn, base } = await getFetch(link.label);
  const ctx = { fetchFn, base, label: link.label, cid: link.cid, password: '' };
  let res;
  let data;
  try {
    res = await fetchFn(`${base}/api/c/${link.cid}`, { signal: timeout(20_000) });
    data = await readJson(res);
  } catch {
    showStatus('Could not load the survey', 'Check your internet connection and reload the page.');
    return;
  }
  if (res.status === 404) {
    showStatus('Survey not found', 'This survey may have been removed, or the link is mistyped.');
    return;
  }
  if (res.status === 410) {
    // Someone who already answered from this browser hears that, not that
    // the survey (perhaps filled by their own answer) is closed or full.
    if (alreadyAnswered(link)) {
      showStatus('You already responded', 'Thanks, your answers to this survey were recorded earlier.', data || {});
      return;
    }
    const [title, message] = statusFor(data && data.error, data);
    showStatus(title, message, data || {});
    return;
  }
  if (!res.ok || !data) {
    showStatus('Could not load the survey', 'Something went wrong on our side. Please try again later.');
    return;
  }
  if (data.locked) {
    showLock(data, ctx);
    return;
  }
  start(data, ctx);
}

// Embedded, the document is as tall as the survey (page.css), so the body's
// height is what the frame needs, growing and shrinking with each page.
if (embedded && window.parent !== window && typeof ResizeObserver !== 'undefined') {
  const report = () => window.parent.postMessage({ type: 'survey:height', height: Math.ceil(document.body.getBoundingClientRect().height) }, '*');
  new ResizeObserver(report).observe(document.body);
}

// The skip link moves focus itself: following its #sv-main would change
// the hash this page is addressed by.
document.querySelector('.skip-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  const target = document.getElementById('sv-main');
  if (!target) return;
  if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'start' });
});

// Another survey link pasted into the address bar: load that one. Any other
// hash (an in-page anchor) leaves the survey and its answers alone.
window.addEventListener('hashchange', () => {
  if (parseLink(location.hash)) location.reload();
});
boot();

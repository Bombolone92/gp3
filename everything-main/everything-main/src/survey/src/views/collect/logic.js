/**
 * The Collect step's rules, kept free of DOM so they can be tested: new
 * collectors, what the worker is sent, link state, settings validation, and
 * the share snippets (embed code, email).
 */
import { collectorId } from '../../lib/ids.js';
import { allQuestions, lintQuestion, questionCount } from '../../model/survey.js';
import { isAnswerable } from '../../shared/runtime.js';

export const MAX_RESPONSE_LIMIT = 1_000_000;

export function newCollector(sid, name, now = Date.now()) {
  return {
    id: collectorId(),
    sid,
    name,
    type: 'link',
    status: 'open',
    createdAt: now,
    closeAt: null,
    maxResponses: 0,
    allowMultiple: true,
    password: '',
    thankYou: null,
  };
}

/** "Web link N" with the first N not already taken. */
export function nextLinkName(collectors) {
  const taken = new Set(Object.values(collectors || {}).map((c) => c.name));
  let n = Object.keys(collectors || {}).length + 1;
  while (taken.has(`Web link ${n}`)) n++;
  return `Web link ${n}`;
}

/**
 * The settings the collector worker keeps for a link. The password goes
 * along only when it changed: the worker stores a salted hash, and leaving
 * `password` out keeps whatever it has.
 */
export function workerPayload(c, prev = null) {
  const out = {
    id: c.id,
    sid: c.sid,
    status: c.status === 'open' ? 'open' : 'closed',
    closeAt: c.closeAt || null,
    maxResponses: c.maxResponses || 0,
    allowMultiple: c.allowMultiple !== false,
    thankYou: c.thankYou || null,
  };
  const before = prev ? prev.password || '' : '';
  if (!prev || (c.password || '') !== before) {
    // A brand-new link with no password has nothing to send.
    if (prev || c.password) out.password = c.password || '';
  }
  return out;
}

/**
 * What a link is doing right now, for its chip: 'open', 'closed', 'ended'
 * (past its close date) or 'full' (response limit reached).
 */
export function linkState(c, count = 0, now = Date.now()) {
  if (c.status !== 'open') return 'closed';
  if (c.closeAt && now >= c.closeAt) return 'ended';
  if (c.maxResponses > 0 && count >= c.maxResponses) return 'full';
  return 'open';
}

export const LINK_STATE = {
  open: { label: 'Open', chip: 'chip-open' },
  closed: { label: 'Closed', chip: 'chip-closed' },
  ended: { label: 'Ended', chip: 'chip-closed' },
  full: { label: 'Full', chip: 'chip-warn' },
};

/** <input type="datetime-local"> value for a timestamp, in local time. */
export function toLocalInput(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Check the settings form. `form` holds raw field values; returns
 * { errors: { field: message }, value: collector } where value is the
 * collector with the form applied (only meaningful when errors is empty).
 */
export function validateSettings(collector, form) {
  const errors = {};
  const name = String(form.name || '').trim();
  if (!name) errors.name = 'Give the link a name.';
  else if (name.length > 100) errors.name = 'Use 100 characters or fewer.';

  let closeAt = null;
  if (form.closeOn) {
    closeAt = fromLocalInput(form.closeAt);
    if (!closeAt) errors.closeAt = 'Pick a date and time.';
    // A time already past would end the link the moment it is saved (a
    // slip with the date picker). One saved before, on a link that has
    // since ended, may stay while other settings change.
    else if (closeAt <= Date.now() && closeAt !== collector.closeAt) {
      errors.closeAt = 'Pick a time in the future. To stop responses now, use Close link.';
    }
  }

  let maxResponses = 0;
  if (form.limitOn) {
    const n = Number(form.maxResponses);
    if (!Number.isInteger(n) || n < 1) errors.maxResponses = 'Enter a whole number of 1 or more.';
    else if (n > MAX_RESPONSE_LIMIT) errors.maxResponses = `Enter ${MAX_RESPONSE_LIMIT.toLocaleString()} or less.`;
    else maxResponses = n;
  }

  let password = '';
  if (form.passwordOn) {
    password = String(form.password || '');
    if (!password) errors.password = 'Enter a password, or turn protection off.';
    // Guesses are limited to 20 per 10 minutes, which works through every
    // 4-digit code in days; 6 characters take years. A shorter password
    // set before may stay while other settings change.
    else if (password.length < 6 && password !== collector.password) errors.password = 'Use at least 6 characters.';
    else if (password.length > 100) errors.password = 'Use 100 characters or fewer.';
  }

  let thankYou = null;
  if (form.thankYouOn) {
    const title = String(form.tyTitle || '').trim().slice(0, 300);
    const message = String(form.tyMessage || '').trim().slice(0, 3000);
    let redirect = String(form.tyRedirect || '').trim();
    if (redirect) {
      let ok = false;
      try {
        const u = new URL(redirect);
        ok = u.protocol === 'https:';
        // The canonical form ("https:example.com" becomes
        // "https://example.com/"), which the worker's check also accepts.
        if (ok) redirect = u.href;
      } catch {
        ok = false;
      }
      if (!ok) errors.tyRedirect = 'Use a full web address starting with https://';
    }
    if (!title && !message && !redirect) errors.tyTitle = 'Add a title, a message, or a web address.';
    thankYou = { title, message, redirect: errors.tyRedirect ? '' : redirect };
  }

  return {
    errors,
    value: {
      ...collector,
      name,
      status: form.open ? 'open' : 'closed',
      closeAt,
      maxResponses,
      allowMultiple: !!form.allowMultiple,
      password,
      thankYou,
    },
  };
}

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * HTML to paste into a web page: the survey in an iframe, plus a few lines
 * that grow the frame to fit the survey (the embedded page reports its
 * height with postMessage; only messages from the survey's own origin and
 * from that very frame are believed).
 */
export function embedSnippet(url, title = 'Survey') {
  const origin = new URL(url).origin;
  const originJs = JSON.stringify(origin).replace(/</g, '\\u003c');
  return [
    `<iframe src="${escAttr(url)}" title="${escAttr(title || 'Survey')}" loading="lazy" style="width:100%;max-width:760px;height:640px;border:0"></iframe>`,
    '<script>',
    'window.addEventListener("message", function (e) {',
    `  if (e.origin !== ${originJs} || !e.data || e.data.type !== "survey:height") return;`,
    '  var frames = document.getElementsByTagName("iframe");',
    '  for (var i = 0; i < frames.length; i++) {',
    '    if (frames[i].contentWindow === e.source) frames[i].style.height = Math.ceil(Number(e.data.height) || 0) + "px";',
    '  }',
    '});',
    '</script>',
  ].join('\n');
}

export function mailtoLink({ title, url }) {
  const subject = `Please take this survey: ${title || 'Survey'}`;
  const body = `Hi,\n\nI'd appreciate a few minutes of your time for this survey:\n\n${url}\n\nThank you!`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Questions that would confuse respondents, numbered the way the builder
 * shows them. An empty survey is reported as a single survey-level issue.
 */
export function lintSurvey(survey) {
  const out = [];
  if (!questionCount(survey)) out.push({ qid: null, label: 'Survey', issues: ['Add at least one question.'] });
  let n = 0;
  for (const q of allQuestions(survey)) {
    if (isAnswerable(q)) n++;
    const issues = lintQuestion(q, survey);
    if (issues.length) {
      const label = isAnswerable(q) ? `Q${n}` : 'Text block';
      out.push({ qid: q.id, label, title: q.title, issues });
    }
  }
  return out;
}

/** A friendly message for a failed collector call. */
export function errorMessage(err) {
  switch (err && err.code) {
    case 'email_unverified':
      return 'Verify the email address on your Puter account, then try again. Sharing needs a verified account.';
    case 'verify':
    case 'cooldown':
      return 'Your response collector is still starting up. Wait a minute and try again.';
    case 'network':
      return 'Could not reach your response collector. Check your connection and try again.';
    case 'unavailable':
      return 'Sharing needs a Puter account.';
    case 'too_large':
      return 'This survey is too large to publish. Try a smaller logo or fewer questions.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

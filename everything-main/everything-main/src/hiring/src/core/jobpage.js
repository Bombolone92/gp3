/**
 * The public job page: a single self-contained HTML document published to
 * the user's own Puter site. Pure string generation so it is fully
 * testable; every job field is user-entered and therefore escaped.
 */

import { formatSalaryRange } from '../lib/format.js';
import { screeningQuestionsForJob } from './screening.js';

export function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Description text -> escaped paragraphs and bullet lists. */
export function descriptionHtml(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim());
  const out = [];
  let paragraph = [];
  let bullets = [];
  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(escapeHtml).join(' ')}</p>`);
    paragraph = [];
  };
  const flushBullets = () => {
    if (bullets.length) out.push(`<ul>${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`);
    bullets = [];
  };
  for (const line of lines) {
    if (!line) {
      flushParagraph();
      flushBullets();
    } else if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      bullets.push(line.replace(/^[-*]\s+/, ''));
    } else {
      flushBullets();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushBullets();
  return out.join('\n');
}

/**
 * The subject of a structured application email. The [job id] token is
 * what "Paste application" uses to route the candidate to the right job.
 */
export function applySubject(job) {
  return `Application: ${job.title} [${job.id}]`;
}

/** A value for a JS string literal inside an inline <script>. */
function jsString(value) {
  return JSON.stringify(String(value ?? '')).replace(/</g, '\\u003c');
}

const FIELD_LINE = /^(name|email|phone|links?|notes?)\s*:\s*(.*)$/i;
// The screening block the apply form appends: one "Q: <label>" line, then
// an "A: <answer>" that may run on over the lines below it (a long answer
// keeps its paragraphs).
const QUESTION_LINE = /^q\s*:\s*(.*)$/i;
const ANSWER_LINE = /^a\s*:\s*(.*)$/i;
const FOOTER_LINE = /^(job\s*:|sent from\b)/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/**
 * Parse a structured application email (the kind the public job page
 * composes) back into candidate fields. Best-effort on freeform text:
 * the job comes from the [job id] token, fielded lines fill the rest,
 * and a From: header or any address in the text backstops the email.
 */
export function parseApplicationEmail(text) {
  const raw = String(text ?? '').replace(/\r\n?/g, '\n');
  const result = { jobId: null, name: '', email: '', phone: '', link: '', notes: '', answers: [] };
  // Last token wins: the page puts the real routing token in the trailing
  // footer (and the subject), while the applicant's free-text note sits
  // above it — a "[job_…]" typed into the note must not reroute the
  // application to a different role.
  result.jobId = [...raw.matchAll(/\[(job_[A-Za-z0-9_-]+)\]/g)].at(-1)?.[1] ?? null;

  const noteLines = [];
  let inNotes = false;
  // The screening pair being read: a label waiting for its answer, then
  // an answer that may still grow by a line.
  let pending = null;
  let inAnswer = false;
  const flushAnswer = () => {
    if (pending?.label && pending.answer.trim()) {
      result.answers.push({ label: pending.label, answer: pending.answer.trim() });
    }
    pending = null;
    inAnswer = false;
  };

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    const question = QUESTION_LINE.exec(line);
    if (question) {
      flushAnswer();
      inNotes = false;
      pending = { label: question[1].trim(), answer: '' };
      continue;
    }
    const answer = pending && !inAnswer ? ANSWER_LINE.exec(line) : null;
    if (answer) {
      pending.answer = answer[1];
      inAnswer = true;
      continue;
    }
    const match = FIELD_LINE.exec(line);
    if (inAnswer) {
      // What ends an answer is the next block: another "Q:" (handled
      // above), a fielded line, or the footer. A blank line does not —
      // the form's answer box takes 600 characters and people write
      // paragraphs in it, so treating one as the end silently threw away
      // everything after an applicant's first empty line, with a
      // truncated answer on the profile as the only trace.
      if (match || FOOTER_LINE.test(line)) flushAnswer();
      else {
        pending.answer += `\n${rawLine}`;
        continue;
      }
    }
    if (inNotes) {
      // The notes section runs until the trailing Job:/footer lines or
      // another fielded line (someone pasted fields below their note).
      if (/^job\s*:/i.test(line) || /^sent from\b/i.test(line)) {
        inNotes = false;
        continue;
      }
      if (!match || match[1].toLowerCase().startsWith('note')) {
        noteLines.push(rawLine);
        continue;
      }
      inNotes = false;
    }
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key.startsWith('note')) {
      inNotes = true;
      if (value) noteLines.push(value);
    } else if (key.startsWith('link')) {
      result.link = result.link || value;
    } else if (!result[key]) {
      result[key] = value;
    }
  }
  // An email that ends on its last answer never met a terminator.
  flushAnswer();
  result.notes = noteLines.join('\n').trim();

  if (!result.email) result.email = raw.match(EMAIL_RE)?.[0] ?? '';
  if (!result.name) {
    result.name = raw.match(/^from\s*:\s*"?([^"<\n]+?)"?\s*</im)?.[1].trim() ?? '';
  }
  return result;
}

/** Base for the public subdomain, derived from the company name. */
export function subdomainBase(companyName) {
  const slug = String(companyName ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  return slug || 'jobs';
}

const PAGE_CSS = `
:root { --bg:#f7f7f8; --surface:#ffffff; --border:#e4e4e8; --text:#1a1a1e; --text-2:#55555e; --text-3:#797983; --brand:#fad319; --brand-strong:#e9c308; --on-brand:#221c03; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg:#101013; --surface:#18181c; --border:#26262c; --text:#f0f0f2; --text-2:#a5a5af; --text-3:#7d7d88; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; line-height:1.6; }
main { max-width:720px; margin:0 auto; padding:48px 24px 72px; }
.company { font-size:14px; font-weight:600; color:var(--text-2); letter-spacing:0.01em; }
h1 { font-size:32px; letter-spacing:-0.02em; margin:6px 0 10px; line-height:1.2; }
.meta { color:var(--text-3); font-size:14.5px; margin:0 0 6px; }
.salary { display:inline-block; margin:10px 0 0; padding:6px 12px; border:1px solid var(--border); border-radius:999px; background:var(--surface); font-size:14px; font-weight:600; font-variant-numeric:tabular-nums; }
.desc { margin-top:28px; font-size:15.5px; color:var(--text-2); overflow-wrap:anywhere; }
.desc p { margin:0 0 14px; }
.desc ul { margin:0 0 14px; padding-left:22px; }
.desc li { margin-bottom:6px; }
.apply-section { margin-top:36px; padding:24px; border:1px solid var(--border); border-radius:14px; background:var(--surface); }
.apply-section h2 { font-size:19px; margin:0 0 16px; letter-spacing:-0.01em; }
.apply-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
@media (max-width: 560px) { .apply-grid { grid-template-columns:1fr; } }
.apply-field { display:flex; flex-direction:column; gap:5px; font-size:13.5px; font-weight:600; color:var(--text-2); }
.apply-field .opt { font-weight:400; color:var(--text-3); }
.apply-field input, .apply-field textarea { font:inherit; font-weight:400; color:var(--text); padding:9px 12px; border:1px solid var(--border); border-radius:9px; background:var(--bg); }
.apply-field input:focus, .apply-field textarea:focus { outline:2px solid var(--brand); outline-offset:0; border-color:transparent; }
.apply-field textarea { resize:vertical; min-height:84px; }
.apply-field select { font:inherit; font-weight:400; color:var(--text); padding:9px 12px; border:1px solid var(--border); border-radius:9px; background:var(--bg); }
.apply-questions { display:flex; flex-direction:column; gap:14px; margin-top:14px; }
.apply-note { margin-top:14px; }
.closes { margin:20px 0 0; font-size:14px; color:var(--text-3); }
.apply-btn { display:inline-block; margin-top:16px; padding:13px 26px; border:0; border-radius:10px; background:var(--brand); color:var(--on-brand); font:inherit; font-size:15.5px; font-weight:650; text-decoration:none; cursor:pointer; }
.apply-btn:hover { background:var(--brand-strong); }
.hint { margin-top:10px; font-size:13px; color:var(--text-3); }
footer { margin-top:56px; padding-top:18px; border-top:1px solid var(--border); font-size:12.5px; color:var(--text-3); }
`;

/**
 * The application form section: fielded inputs whose submission opens the
 * applicant's own mail client with a structured email — a recognizable
 * subject token plus fielded body lines that "Paste application" in the
 * app parses back into a candidate. No new infrastructure involved.
 */
function applyFormHtml(job, applyEmail, closes = false) {
  const questions = screeningQuestionsForJob(job);
  // Marked when the posting has a closing date: the script at the end of
  // the page takes the form down once that date has passed.
  return `<section class="apply-section"${closes ? ' data-when-open' : ''}>
<h2>Apply for this role</h2>
<form id="apply-form">
<div class="apply-grid">
<label class="apply-field"><span>Name</span><input name="name" required autocomplete="name"></label>
<label class="apply-field"><span>Email</span><input name="email" type="email" required autocomplete="email"></label>
<label class="apply-field"><span>Phone <span class="opt">(optional)</span></span><input name="phone" type="tel" autocomplete="tel"></label>
<label class="apply-field"><span>Link <span class="opt">(optional)</span></span><input name="link" type="url" placeholder="LinkedIn, portfolio, …"></label>
</div>
${screeningFieldsHtml(questions)}
<label class="apply-field apply-note"><span>Anything you’d like us to know <span class="opt">(optional)</span></span><textarea name="note" maxlength="600"></textarea></label>
<button class="apply-btn" type="submit">Apply by email</button>
<p class="hint">Submitting opens your own email app with the application addressed to ${escapeHtml(applyEmail)}. Attach your resume there and hit send.</p>
<p class="hint" data-apply-fallback hidden>Your email app should be opening now. If nothing happened — some browsers have no mail app to hand — send your application to <a href="mailto:${escapeHtml(applyEmail)}">${escapeHtml(applyEmail)}</a> yourself; what you typed above is still here.</p>
</form>
<script>
(function () {
  var TITLE = ${jsString(job.title)};
  var SUBJECT = ${jsString(applySubject(job))};
  var FOOTER = 'Job: ' + TITLE + ' [' + ${jsString(job.id)} + ']';
  var QUESTIONS = [${questions.map((q, i) => `{n:${jsString(questionField(i))},l:${jsString(q.label)}}`).join(',')}];
  var form = document.getElementById('apply-form');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = function (n) { return form.elements[n].value.trim(); };
    var lines = ['New application: ' + TITLE, '', 'Name: ' + v('name'), 'Email: ' + v('email')];
    if (v('phone')) lines.push('Phone: ' + v('phone'));
    if (v('link')) lines.push('Link: ' + v('link'));
    // Fielded question/answer pairs: the app parses these straight back
    // onto the candidate, so an unanswered optional question is left out
    // rather than sent as an empty one.
    QUESTIONS.forEach(function (q) {
      if (v(q.n)) lines.push('', 'Q: ' + q.l, 'A: ' + v(q.n));
    });
    if (v('note')) lines.push('', 'Notes:', v('note'));
    lines.push('', FOOTER);
    location.href = 'mailto:' + encodeURIComponent(${jsString(applyEmail)}) +
      '?subject=' + encodeURIComponent(SUBJECT) + '&body=' + encodeURIComponent(lines.join('\\n'));
    // A mailto: hand-off is invisible when the browser has no mail app
    // registered: the click did nothing, said nothing, and the applicant
    // had no other way to reach anyone. Reveal the address after the
    // attempt, so there is always a next step.
    var fallback = form.querySelector('[data-apply-fallback]');
    if (fallback) fallback.hidden = false;
  });
})();
</script>
</section>`;
}

/** The form control name for the nth screening question. */
function questionField(index) {
  return `q${index}`;
}

/**
 * The job's own screening questions, rendered under the standard fields.
 * Each kind gets the control that asks it most plainly; the answers travel
 * in the same email as everything else, so no server is involved.
 */
function screeningFieldsHtml(questions) {
  if (questions.length === 0) return '';
  const rows = questions.map((q, i) => {
    const name = escapeHtml(questionField(i));
    const req = q.required ? ' required' : '';
    const label = `<span>${escapeHtml(q.label)}${q.required ? '' : ' <span class="opt">(optional)</span>'}</span>`;
    let control;
    if (q.kind === 'long') {
      control = `<textarea name="${name}" maxlength="600"${req}></textarea>`;
    } else if (q.kind === 'yesno' || q.kind === 'choice') {
      const options = q.kind === 'yesno' ? ['Yes', 'No'] : (q.options ?? []);
      // A required select needs an empty option that cannot be chosen, or
      // the browser counts it as answered before the applicant touches it.
      const blank = q.required
        ? '<option value="" disabled selected>Choose…</option>'
        : '<option value="">No answer</option>';
      control = `<select name="${name}"${req}>${blank}${options.map((o) => `<option>${escapeHtml(o)}</option>`).join('')}</select>`;
    } else {
      control = `<input name="${name}" maxlength="200"${req}>`;
    }
    return `<label class="apply-field">${label}${control}</label>`;
  });
  return `<div class="apply-questions">\n${rows.join('\n')}\n</div>`;
}

/* ---- Findability ------------------------------------------------------- */

/**
 * The site's own address, without a trailing slash. Absent before the
 * account has reserved its subdomain (a local preview), which is why
 * every absolute-URL tag below is conditional.
 */
function siteBase(siteUrl) {
  return String(siteUrl ?? '').trim().replace(/\/+$/, '');
}

const companyText = (companyName) => String(companyName ?? '').trim() || 'We are hiring';

/** One line of prose, cut on a word boundary. */
function truncate(text, max) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[.,;:–—-]+$/, '')}…`;
}

/**
 * What a search result and a pasted link show. The role and where it is
 * come first — they are what someone scanning results decides on — then
 * as much of the description as fits.
 */
export function jobMetaDescription(job, companyName) {
  const facts = [job.location, job.workMode, job.type].filter(Boolean).join(' · ');
  // Bullet markers are layout, not prose: "- Ship code" reads as a stray
  // dash in a one-line summary.
  const body = String(job.description ?? '').replace(/^[-*]\s+/gm, '');
  const parts = [`${String(job.title ?? '')} at ${companyText(companyName)}`, facts, truncate(body, 180)];
  return truncate(parts.filter(Boolean).join(' · '), 300);
}

const EMPLOYMENT_TYPES = {
  'Full-time': 'FULL_TIME',
  'Part-time': 'PART_TIME',
  Contract: 'CONTRACTOR',
  Internship: 'INTERN',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The schema.org JobPosting for one job, built only from fields the app
 * actually stores — Google Jobs, Bing, and every aggregator that reads
 * structured data need this to see the page at all. Fields with nothing
 * behind them are left out rather than guessed.
 */
export function jobPostingJsonLd(job, { companyName = '', siteUrl = '' } = {}) {
  const base = siteBase(siteUrl);
  const data = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: String(job.title ?? ''),
    description: descriptionHtml(job.description) || escapeHtml(`${job.title} at ${companyText(companyName)}`),
    hiringOrganization: {
      '@type': 'Organization',
      name: companyText(companyName),
      ...(base ? { sameAs: `${base}/` } : {}),
    },
  };
  const posted = String(job.createdAt ?? '').slice(0, 10);
  if (ISO_DATE.test(posted)) data.datePosted = posted;
  // Applications close at the end of the day they close on, not at its
  // first second — a posting is served all day.
  if (ISO_DATE.test(String(job.closesOn ?? ''))) data.validThrough = `${job.closesOn}T23:59:59`;
  if (EMPLOYMENT_TYPES[job.type]) data.employmentType = EMPLOYMENT_TYPES[job.type];
  if (base) data.url = `${base}/${job.id}.html`;
  if (job.department) data.industry = String(job.department);
  const location = String(job.location ?? '').trim();
  // Remote roles need jobLocationType plus where applicants may live;
  // anything else needs a place. A hybrid role is both — it has an office
  // and it is where the office is.
  if (job.workMode === 'Remote') {
    data.jobLocationType = 'TELECOMMUTE';
    if (location) data.applicantLocationRequirements = { '@type': 'Country', name: location };
  } else if (location) {
    data.jobLocation = {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: location },
    };
  }
  const min = Number(job.salaryMin);
  const max = Number(job.salaryMax);
  const hasMin = Number.isFinite(min) && job.salaryMin !== null && job.salaryMin !== '';
  const hasMax = Number.isFinite(max) && job.salaryMax !== null && job.salaryMax !== '';
  if (hasMin || hasMax) {
    data.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: String(job.currency ?? 'USD'),
      value: {
        '@type': 'QuantitativeValue',
        ...(hasMin ? { minValue: min } : {}),
        ...(hasMax ? { maxValue: max } : {}),
        unitText: 'YEAR',
      },
    };
  }
  return data;
}

/**
 * The head tags that make a page shareable and indexable: a canonical
 * address (only once the site has one), a summary, and the Open Graph /
 * Twitter pair every chat app and social network reads.
 */
function metaTagsHtml({ title, description, company, canonical }) {
  const tag = (attr, name, content) => `<meta ${attr}="${name}" content="${escapeHtml(content)}">`;
  return [
    tag('name', 'description', description),
    canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : null,
    tag('property', 'og:type', 'website'),
    tag('property', 'og:site_name', company),
    tag('property', 'og:title', title),
    tag('property', 'og:description', description),
    canonical ? tag('property', 'og:url', canonical) : null,
    tag('name', 'twitter:card', 'summary'),
    tag('name', 'twitter:title', title),
    tag('name', 'twitter:description', description),
  ]
    .filter(Boolean)
    .join('\n');
}

/** A JSON-LD block that cannot break out of its own script element. */
function jsonLdHtml(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

const CLOSES_FMT = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

/** 'September 30, 2026' — the public page is English, like its copy. */
function formatCloses(isoDate) {
  if (!ISO_DATE.test(String(isoDate ?? ''))) return '';
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? '' : CLOSES_FMT.format(date);
}

/**
 * The published page is a static file: nothing rewrites it when its
 * closing date passes, so a posting stating "applications close on June 1"
 * kept inviting them all summer — the form worked, the mail arrived, and
 * the only remedy was the recruiter remembering to unpublish. The page
 * closes itself instead, on the reader's own clock, at the end of the day
 * it names (the same instant validThrough carries).
 */
function closesScript(isoDate) {
  return `<script>
(function () {
  var CLOSES = ${jsString(isoDate)};
  var now = new Date();
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  if (now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) <= CLOSES) return;
  var gone = document.querySelectorAll('[data-when-open]');
  for (var i = 0; i < gone.length; i++) gone[i].hidden = true;
  var closed = document.querySelector('[data-when-closed]');
  if (closed) closed.hidden = false;
})();
</script>`;
}

/** The complete standalone page for one job. */
export function buildJobPageHtml(job, { companyName = '', applyEmail = '', siteUrl = '' } = {}) {
  // Coerced, not just defaulted: the default only covers undefined, and
  // these render whatever settings hold.
  const company = companyText(companyName);
  const meta = [job.department, job.location, job.workMode, job.type].filter(Boolean).join(' · ');
  const salary = formatSalaryRange(job.salaryMin, job.salaryMax, job.currency);
  const base = siteBase(siteUrl);
  const pageTitle = `${job.title} · ${company}`;
  const description = jobMetaDescription(job, companyName);
  const closes = formatCloses(job.closesOn);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(pageTitle)}</title>
${metaTagsHtml({ title: pageTitle, description, company, canonical: base ? `${base}/${job.id}.html` : '' })}
${jsonLdHtml(jobPostingJsonLd(job, { companyName, siteUrl }))}
<style>${PAGE_CSS}</style>
</head>
<body>
<main>
<p class="company">${escapeHtml(company)}</p>
<h1>${escapeHtml(job.title)}</h1>
${meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ''}
${salary ? `<span class="salary">${escapeHtml(salary)} per year</span>` : ''}
<div class="desc">
${descriptionHtml(job.description) || '<p>Get in touch to hear more about this role.</p>'}
</div>
${closes ? `<p class="closes" data-when-open>Applications close on ${escapeHtml(closes)}.</p>` : ''}
${applyEmail ? applyFormHtml(job, applyEmail, Boolean(closes)) : ''}
${closes ? `<p class="closes" data-when-closed hidden>Applications for this role closed on ${escapeHtml(closes)}.</p>` : ''}
<footer>Published with Hiring on Puter.</footer>
${closes ? closesScript(job.closesOn) : ''}
</main>
</body>
</html>
`;
}

/**
 * The same self-closing trick as `closesScript`, for the list of roles.
 * The index is a static file too, so a posting that had stopped taking
 * applications — its own page says so, and shows no form — was still
 * being advertised under "Open roles" on the site's front door, one
 * click from a dead end. Rows carry their closing date and take
 * themselves down at the end of the day they name, the same instant the
 * posting itself uses.
 */
function indexClosesScript() {
  return `<script>
(function () {
  var now = new Date();
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  var rows = document.querySelectorAll('li[data-closes]');
  for (var i = 0; i < rows.length; i++) {
    if (today > rows[i].getAttribute('data-closes')) rows[i].hidden = true;
  }
  var list = document.querySelector('ul.jobs');
  var left = list ? list.querySelectorAll('li:not([hidden])').length : 0;
  if (left > 0) return;
  if (list) list.hidden = true;
  var empty = document.querySelector('[data-empty]');
  if (empty) empty.hidden = false;
})();
</script>`;
}

/** A minimal index for the site root, listing every published open job. */
export function buildSiteIndexHtml(jobs, { companyName = '', siteUrl = '' } = {}) {
  // Coerced, not just defaulted: the default only covers undefined, and
  // these render whatever settings hold.
  const company = companyText(companyName);
  const closing = jobs.some((job) => ISO_DATE.test(String(job.closesOn ?? '')));
  const items = jobs
    .map(
      (job) =>
        `<li${ISO_DATE.test(String(job.closesOn ?? '')) ? ` data-closes="${escapeHtml(job.closesOn)}"` : ''}><a href="./${escapeHtml(job.id)}.html">${escapeHtml(job.title)}</a>${
          job.location ? `<span class="meta"> · ${escapeHtml(job.location)}</span>` : ''
        }</li>`
    )
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<title>Open roles · ${escapeHtml(company)}</title>
${metaTagsHtml({
  title: `Open roles · ${company}`,
  description: jobs.length
    ? `${jobs.length === 1 ? '1 open role' : `${jobs.length} open roles`} at ${company}: ${jobs
        .map((j) => j.title)
        .join(', ')}`
    : `Open roles at ${company}.`,
  company,
  canonical: siteBase(siteUrl) ? `${siteBase(siteUrl)}/` : '',
})}
<style>${PAGE_CSS}
ul.jobs { list-style:none; padding:0; margin-top:24px; }
ul.jobs li { padding:14px 0; border-bottom:1px solid var(--border); font-size:16px; }
ul.jobs a { color:var(--text); font-weight:650; text-decoration:none; }
ul.jobs a:hover { text-decoration:underline; }
ul.jobs li[hidden], ul.jobs[hidden] { display:none; }
.meta { color:var(--text-3); font-size:14px; }
</style>
</head>
<body>
<main>
<p class="company">${escapeHtml(company)}</p>
<h1>Open roles</h1>
${items ? `<ul class="jobs">\n${items}\n</ul>` : ''}
<p class="meta" data-empty${items ? ' hidden' : ''}>No open roles right now. Check back soon.</p>
<footer>Published with Hiring on Puter.</footer>
${closing ? indexClosesScript() : ''}
</main>
</body>
</html>
`;
}

/* ---- Sitemap and robots ------------------------------------------------ */

const escapeXml = (text) =>
  String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

/**
 * Every address a crawler should know about: the index and one entry per
 * published job. No lastmod — the app has no honest per-page modification
 * date, and a made-up one is worse than none.
 */
export function buildSitemapXml(jobs, { siteUrl = '' } = {}) {
  const base = siteBase(siteUrl);
  if (!base) return '';
  const urls = [`${base}/`, ...jobs.map((job) => `${base}/${job.id}.html`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `<url><loc>${escapeXml(url)}</loc></url>`).join('\n')}
</urlset>
`;
}

/** Crawlable, with the sitemap pointed at explicitly. */
export function buildRobotsTxt({ siteUrl = '' } = {}) {
  const base = siteBase(siteUrl);
  return `${['User-agent: *', 'Allow: /', base ? `Sitemap: ${base}/sitemap.xml` : null].filter(Boolean).join('\n')}\n`;
}

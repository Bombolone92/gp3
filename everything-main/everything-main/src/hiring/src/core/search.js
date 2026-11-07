/**
 * Quick-find: one query across candidates (name, email, tags, notes),
 * jobs (title), and interviews (candidate + interviewers). Pure function
 * over store state — everything is already in memory, so there is no
 * standing index; the per-call maps below only replace repeated linear
 * scans.
 */

import { formatDate, formatTime } from '../lib/dates.js';
import { interviewTypeInfo } from './interviews.js';
import { candidateTags } from './tags.js';

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The word-start test for one query. Built once per search: the pattern
 * depends only on the query, so compiling it per field per record just
 * made every keystroke pay for thousands of RegExp constructions.
 */
const wordStartRe = (q) => new RegExp(`\\b${escapeRegExp(q)}`);

/**
 * The matching part of a note, with a little context around it, so a hit
 * in free text explains itself instead of looking like a mystery.
 */
function noteSnippet(notes, q, width = 60) {
  const text = String(notes ?? '').replace(/\s+/g, ' ').trim();
  const at = text.toLowerCase().indexOf(q);
  if (at === -1) return '';
  const from = Math.max(0, at - Math.floor((width - q.length) / 2));
  const slice = text.slice(from, from + width);
  return `${from > 0 ? '…' : ''}${slice}${from + width < text.length ? '…' : ''}`;
}

/** 0 = prefix, 1 = word start, 2 = substring, -1 = no match. */
function matchScore(text, q, wordStart) {
  const value = String(text ?? '').toLowerCase();
  if (!value.includes(q)) return -1;
  if (value.startsWith(q)) return 0;
  return wordStart.test(value) ? 1 : 2;
}

function bestScore(fields, q, wordStart) {
  let best = -1;
  for (const field of fields) {
    const s = matchScore(field, q, wordStart);
    if (s === -1) continue;
    if (best === -1 || s < best) best = s;
  }
  return best;
}

/**
 * Matches for `query`, best first: [{ type, route, title, subtitle,
 * archived }]. Candidates outrank jobs, jobs outrank interviews, and
 * within a type prefix matches come first.
 */
export function quickFind(state, query, { limit = 12, now = new Date() } = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  const results = [];
  const wordStart = wordStartRe(q);

  // Indexed, not scanned: this runs on every keystroke, so a find per
  // record turns the lookups into candidates × jobs and interviews ×
  // candidates comparisons per character typed.
  const jobsById = new Map(state.jobs.map((j) => [j.id, j]));
  const candidatesById = new Map(state.candidates.map((c) => [c.id, c]));
  const jobTitle = (id) => jobsById.get(id)?.title;

  for (const c of state.candidates) {
    const tags = candidateTags(c);
    const score = bestScore([c.name, c.email, ...tags], q, wordStart);
    // Notes are searched too — "great Rust experience" was unreachable the
    // moment the candidate scrolled off the board — but they never beat a
    // name or a tag, and the row says where the match came from.
    const inNotes = score === -1 ? matchScore(c.notes, q, wordStart) : -1;
    if (score === -1 && inNotes === -1) continue;
    const matchedTag = score !== -1 ? tags.find((t) => t.toLowerCase().includes(q)) : null;
    results.push({
      type: 'candidate',
      route: `candidates/${c.id}`,
      title: c.name,
      subtitle: [
        jobTitle(c.jobId) ?? 'Unknown job',
        inNotes !== -1 ? noteSnippet(c.notes, q) : matchedTag ? `tagged “${matchedTag}”` : c.email || null,
      ]
        .filter(Boolean)
        .join(' · '),
      archived: c.status !== 'active',
      // A note match is the weakest kind: it ranks below every field match
      // rather than jumping ahead of a name that merely matches later on.
      score: score === -1 ? 3 : score,
      order: 0,
    });
  }

  for (const job of state.jobs) {
    const score = matchScore(job.title, q, wordStart);
    if (score === -1) continue;
    results.push({
      type: 'job',
      route: `jobs/${job.id}`,
      title: job.title,
      subtitle: [job.status === 'open' ? 'Open' : job.status === 'draft' ? 'Draft' : 'Closed', job.location || null]
        .filter(Boolean)
        .join(' · '),
      archived: job.status === 'closed',
      score,
      order: 1,
    });
  }

  for (const itv of state.interviews) {
    const candidate = candidatesById.get(itv.candidateId);
    const score = bestScore([candidate?.name, ...(itv.interviewers ?? [])], q, wordStart);
    if (score === -1) continue;
    results.push({
      type: 'interview',
      route: `candidates/${itv.candidateId}`,
      title: `${candidate?.name ?? 'Unknown candidate'} · ${interviewTypeInfo(itv.type).label}`,
      subtitle: `${formatDate(itv.date, now)} · ${formatTime(itv.start)}`,
      archived: false,
      score,
      order: 2,
      date: itv.date,
    });
  }

  return results
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.order - b.order ||
        // Newer interviews above older ones; otherwise alphabetical.
        String(b.date ?? '').localeCompare(String(a.date ?? '')) ||
        a.title.localeCompare(b.title)
    )
    .slice(0, limit);
}

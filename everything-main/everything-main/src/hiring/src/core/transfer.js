/** Import/export: CSV views of the data and a full JSON backup format. */

import { toCSV } from '../lib/csv.js';
import { isSafeId } from '../lib/id.js';
import { stageLabel } from './pipeline.js';
import { lastContactedAt } from './emails.js';
import { interviewZone, isProposed } from './interviews.js';
import { candidateTags } from './tags.js';

export const BACKUP_VERSION = 1;
const ARRAY_COLLECTIONS = ['jobs', 'candidates', 'interviews', 'scorecards', 'offers'];

/* ---- CSV exports ------------------------------------------------------ */

const jobTitle = (state, id) => state.jobs.find((j) => j.id === id)?.title ?? '';

export function candidatesCSV(state) {
  const rows = [['Name', 'Email', 'Phone', 'Job', 'Stage', 'Status', 'Source', 'Link', 'Notes', 'Tags', 'Created', 'Last contacted']];
  for (const c of state.candidates) {
    rows.push([
      c.name,
      c.email,
      c.phone,
      jobTitle(state, c.jobId),
      stageLabel(c.stage, state.settings),
      c.status,
      c.source,
      c.link,
      c.notes,
      candidateTags(c).join('; '),
      c.createdAt,
      lastContactedAt(c) ?? '',
    ]);
  }
  return toCSV(rows);
}

/**
 * The schedule as a spreadsheet. Two columns exist because the times
 * alone do not say enough: every interview is read on a clock (a row
 * saying 10:00 can be nine hours from the row above it), and a proposal
 * mirrors its earliest option, so without a status a choice of times
 * nobody has accepted exported as a settled booking.
 */
export function interviewsCSV(state) {
  const candidateName = (id) => state.candidates.find((c) => c.id === id)?.name ?? '';
  const rows = [
    ['Date', 'Start', 'End', 'Time zone', 'Status', 'Candidate', 'Job', 'Type', 'Interviewers', 'Location', 'Meeting link', 'Notes'],
  ];
  for (const i of state.interviews) {
    rows.push([
      i.date,
      i.start,
      i.end,
      // The zone the app itself reads these times in: the interview's own,
      // else the account default, else this device's.
      interviewZone(i, state.settings),
      isProposed(i) ? 'proposed' : 'scheduled',
      candidateName(i.candidateId),
      jobTitle(state, i.jobId),
      i.type,
      (i.interviewers ?? []).join('; '),
      i.location,
      i.meetingLink,
      i.notes,
    ]);
  }
  return toCSV(rows);
}

export function offersCSV(state) {
  const candidateName = (id) => state.candidates.find((c) => c.id === id)?.name ?? '';
  const rows = [['Candidate', 'Job', 'Status', 'Salary', 'Currency', 'Bonus', 'Equity', 'Start date', 'Expires', 'Sent', 'Signed']];
  for (const o of state.offers) {
    rows.push([
      candidateName(o.candidateId),
      jobTitle(state, o.jobId),
      o.status,
      o.salary,
      o.currency,
      o.bonus ?? '',
      o.equity,
      o.startDate,
      o.expires ?? '',
      o.sentAt ?? '',
      o.signedAt ?? '',
    ]);
  }
  return toCSV(rows);
}

/* ---- Candidate import mapping ----------------------------------------- */

export const IMPORT_FIELDS = [
  { key: 'name', label: 'Name', required: true, match: /name/i },
  { key: 'email', label: 'Email', match: /mail/i },
  { key: 'phone', label: 'Phone', match: /phone|tel|mobile/i },
  { key: 'source', label: 'Source', match: /source|origin|channel/i },
  { key: 'link', label: 'Link', match: /link|url|linkedin|portfolio|website/i },
  { key: 'notes', label: 'Notes', match: /note|comment/i },
  // Exported by candidatesCSV, so it has to come back: a spreadsheet
  // round-trip that silently dropped everyone's labels was the one
  // column the app could write and not read.
  { key: 'tags', label: 'Tags', match: /tag|label/i },
];

/** Best-guess column index for a field from the header row, or -1. */
export function guessColumn(headers, field) {
  return headers.findIndex((h) => field.match.test(String(h)));
}

/**
 * Does the first row look like column names rather than a person? Every
 * alternative matches the whole cell — a substring match would classify
 * data rows as headers (a LinkedIn URL contains "link", "Sourced"
 * contains "source") and silently swallow the first candidate.
 */
export function looksLikeHeader(row) {
  return row.some((cell) =>
    /^(full ?)?name$|^e-?mail( address)?$|^(tele)?phone( number)?$|^mobile$|^source$|^origin$|^channel$|^(profile |linkedin |portfolio )?(link|url)$|^linkedin$|^website$|^portfolio$|^notes?$|^comments?$|^tags?$|^labels?$/i.test(
      String(cell).trim()
    )
  );
}

/* ---- Per-candidate export ---------------------------------------------- */

/**
 * One person's complete file — profile, history, follow-ups, interviews,
 * scorecards, offers, onboarding, and the attachment list (files
 * themselves live in the user's cloud). A direct answer to a data-access
 * request.
 */
export function candidateExport(state, candidateId, now = new Date()) {
  const candidate = state.candidates.find((c) => c.id === candidateId);
  if (!candidate) throw new Error('Candidate not found.');
  const job = state.jobs.find((j) => j.id === candidate.jobId);
  return {
    app: 'hiring',
    kind: 'candidate',
    exportedAt: now.toISOString(),
    candidate,
    job: job ? { id: job.id, title: job.title } : null,
    interviews: state.interviews.filter((i) => i.candidateId === candidateId),
    scorecards: state.scorecards.filter((s) => s.candidateId === candidateId),
    offers: state.offers.filter((o) => o.candidateId === candidateId),
    onboarding: state.onboarding?.[candidateId] ?? null,
  };
}

/* ---- Backup ------------------------------------------------------------ */

export function buildBackup(state, now = new Date()) {
  return {
    app: 'hiring',
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    data: {
      jobs: state.jobs,
      candidates: state.candidates,
      interviews: state.interviews,
      scorecards: state.scorecards,
      offers: state.offers,
      onboarding: state.onboarding,
      settings: state.settings,
    },
  };
}

/** Structural validation; returns human-readable problems, empty when ok. */
export function validateBackup(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') return ['This is not a backup file.'];
  if (payload.app !== 'hiring') errors.push('This file was not exported by this app.');
  if (!Number.isInteger(payload.version) || payload.version > BACKUP_VERSION) {
    errors.push('This backup is from a newer version of the app.');
  }
  const data = payload.data;
  if (!data || typeof data !== 'object') return [...errors, 'The backup holds no data.'];
  for (const key of ARRAY_COLLECTIONS) {
    if (!Array.isArray(data[key])) errors.push(`The backup is missing its ${key}.`);
  }
  if (errors.length > 0) return errors;

  // Job and candidate ids become file paths in the user's cloud
  // ("hiring-public/<id>.html", attachment directories); an id that could
  // step outside those paths must never make it into the store.
  if (data.jobs.some((j) => !isSafeId(j?.id) || !j?.title)) errors.push('A job record is malformed.');
  if (data.candidates.some((c) => !isSafeId(c?.id) || !c?.name)) errors.push('A candidate record is malformed.');
  // The cross-checks below dereference every record; once one is known to
  // be malformed, stop here — this function reports problems, never throws.
  if (errors.length > 0) return errors;
  const jobIds = new Set(data.jobs.map((j) => j.id));
  if (data.candidates.some((c) => !jobIds.has(c.jobId))) {
    errors.push('A candidate references a job that is not in the backup.');
  }
  if (data.onboarding !== undefined && (typeof data.onboarding !== 'object' || Array.isArray(data.onboarding))) {
    errors.push('The onboarding data is malformed.');
  }
  return errors;
}

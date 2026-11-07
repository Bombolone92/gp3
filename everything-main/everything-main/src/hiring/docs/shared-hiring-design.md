# Shared hiring: design exploration

Status: proposal · Owner: app maintainers · Scope: issue #8

## Problem

Interview panels are inherently multi-user, but every record in this app
lives in one Puter account's private KV store. Consequences today:

- Scorecard authorship is a free-text name typed by the account owner,
  usually on someone else's behalf. Secondhand feedback is lossy and
  arrives late.
- A teammate cannot see the pipeline, the schedule, or a candidate's
  profile without borrowing the owner's account.
- Nothing in the data model records *who* performed an action; the
  timeline is implicitly first-person.

## Constraints

1. No server of ours. Everything must run on Puter primitives plus static
   pages. This rules out invitation emails with magic tokens that a
   backend would validate, and any central queue.
2. `puter.kv` is scoped per user per app. It cannot be shared, so full
   collaboration cannot keep KV as the source of truth.
3. `puter.fs` supports sharing directories with other Puter users
   (read or read-write), and files can also be served publicly through
   `puter.hosting`. This is the only primitive that lets two accounts see
   the same mutable data today.
4. Unauthenticated writes do not exist. Any contributor must have a Puter
   account. An anonymous "submit feedback" form is out of scope until the
   platform offers a drop-box primitive.

## Options considered

### A. Full shared workspace (fs-backed store)

Move the source of truth from KV to JSON documents in an fs directory
(`hiring-workspace/`), one file per collection, mirroring the existing
backend interface (the store already talks to a backend abstraction, and
file operations were added to it for attachments). The owner shares the
directory read-write with teammates; a teammate's app instance detects a
shared workspace and mounts it instead of its own.

- Pros: real collaboration everywhere: pipeline, scheduling, offers.
  One mental model. The backend interface needs no new verbs, only a new
  adapter (`createSharedFsBackend`).
- Cons: concurrency. Two writers doing read-modify-write on
  `candidates.json` will lose updates. Meaningful merge work is needed:
  per-collection version counters and a compare-and-retry loop at
  minimum, or per-record files (one JSON per candidate) to shrink the
  conflict surface. Polling (or fs change notifications, if available)
  is needed for freshness. Offline behavior gets harder.
- Unknowns to validate: sharing API ergonomics (`puter.sharing` /
  `puter.fs.share`), whether a shared path can be opened by path from
  another account's app instance, latency, and quota accounting.

### B. Scorecard request links (narrow write path)

Keep the owner's dataset private. For one interview, the owner creates a
"feedback drop": a per-interview directory shared read-write with the
interviewer's Puter account, seeded with a `request.json` describing the
candidate, role, and rating dimensions (but nothing else from the
pipeline). The interviewer opens a lightweight "give feedback" route in
this same app, which reads the request and writes `scorecard-<user>.json`
into the drop. The owner's app polls its outstanding drops, imports
completed files as scorecards (stamped with the interviewer's username),
and retires the drop.

- Pros: solves the highest-value slice (feedback from the actual
  interviewer, attributed) with almost no concurrency risk: each writer
  owns a distinct file. The import path reuses `addScorecard` untouched.
  No change to the owner's source of truth.
- Cons: teammates still need Puter accounts; the interviewer sees only
  what the owner shares (this is also a feature); the owner's app must
  poll while open (same constraint as notifications, acceptable).

### C. Export/import feedback files (no platform dependency)

The owner exports a "scorecard request" file; the interviewer opens it in
their app (or a plain form page), fills it, sends the resulting file
back through any channel; the owner imports it.

- Pros: works today with zero unknowns; builds on the CSV/backup
  machinery from issue #4.
- Cons: clunky enough that busy interviewers will fall back to Slack
  messages; no attribution guarantees; two manual hops per scorecard.

## Recommendation

Phase the work; do not attempt A first.

1. **Phase 1: scorecard request drops (option B).** Highest value per
   unit of risk, no migration, and it forces us to build the two pieces
   any deeper sharing also needs: identity stamping (`puter.auth
   .getUser().username` on events and scorecards) and a poll-and-import
   loop. Ship behind a "Shared feedback" section on the interview row.
   Fall back to option C's file flow automatically when sharing APIs are
   unavailable, since the request/response payloads are identical.
2. **Phase 2: shared workspace (option A)** only after Phase 1 validates
   the sharing primitives in production. Migrate collections from KV to
   per-record fs files at that point (the backup format from issue #4 is
   the migration vehicle), with last-write-wins per record, version
   counters for detection, and a visible "someone else edited this"
   refresh path rather than silent merges.

Attribution rules from Phase 1 onward: every history event gains an
optional `by` field (username). Absence means "the workspace owner", so
existing data needs no migration.

## API dependencies to confirm before Phase 1

- Sharing a directory read-write with a named Puter user from the SDK,
  and revoking it.
- Whether the recipient can resolve the shared path from a link the app
  can construct (deep link into this app with the drop path as a route
  param).
- Failure modes: share to a non-existent username, revoked mid-write,
  quota ownership of files written by the recipient.

## Out of scope

- Roles and permissions beyond owner/contributor.
- Anonymous applicants writing into the dataset (tracked with the job
  page work instead).
- Real-time presence; polling freshness is sufficient at this team size.

# Permanent audit history

History records business changes separately from the dashboard's recent activity
feed. It retains complete before/after records, the authenticated Puter account
identifier when available, recording time in UTC, business dates present in the
changed records, action, source, and transaction ID. Security edits can include an
optional explanation. An ordinary edit with no explicit business date says
“not specified”; it does not invent an effective date from the recording time.

The first business write captures an **initial observed baseline**. It also keeps
the available legacy activity, explicitly marked incomplete. This cannot recover
earlier edits, missing actors, or historical versions that the old app never kept.
The baseline's actor is the observer, not the author of the pre-existing records.

## Coverage and retention

Company profiles, pool changes, valuations, classes, stakeholders, securities,
exercises, RSU settlements, cancellations, departures, transfers, repurchases,
splits, round closes, scenarios, hiring plans, imports, restores, and attachment
metadata go through the business commit boundary. One operation has one ID even
when it touches several records or collections. Undo creates another transaction;
it does not delete the original event. Appearance settings, the activity display,
and restore-point rotation are not equity transactions.

Draft input rejected before a business intent is prepared never changes the cap
table and is not recorded. A prepared operation ends as completed, rejected
(no observed business publication), or compensated (published data restored).
An unresolved operation remains visibly pending/compensating. It never masquerades
as a completed transaction.

Wiping records, importing a replacement, and restoring a snapshot retain the
native history. Settings exports include an `auditArchive`; standalone History
exports are also available in JSON and CSV. Imported archives are retained inside
the import event as `sourceArchive` provenance, with their original company IDs,
actors, and outcomes. They do not overwrite or impersonate the destination
company's native events. Provenance is deduplicated: events the destination
company recorded itself are not repeated inside the import event, and an event
already kept at a shallower depth is not repeated below it, so a backup imported
back into the company it came from adds one small event rather than a second
copy of the whole history (the import event says how many events were left out). Restore points remain bounded snapshots of the business
dataset and do not copy the growing journal into every point.

Explicit **company deletion** removes its indexed journal and document data and
leaves storage tombstones to fence delayed writers. Its confirmation explains
that an export is needed to retain history. As with existing company cleanup,
storage/network failures can prevent physical cleanup and must be retried; this
is not a regulatory retention service. History has no automatic age/count limit.

## Publication protocol

`src/lib/audit.js` owns the journal. `Store.#commitNow` remains the only business
mutation boundary. Existing cap table and reporting math is unchanged.

1. Validate dependencies and compute the proposed in-memory change using the
   existing mutation code. Capture each business key's expected storage revision
   and allocate its next revision ID before any publication.
2. Store the versioned event (the record changes) and, beside it, the recovery
   intent: each touched collection's before-state and the revision allocated to
   each write. Publish the entry in the company's conditional journal index. No
   business write is permitted before the entry is reachable. The event, the
   intent, the first decision and the index node are written together, since
   nothing reads any of them before the index names the entry.
3. Publish business keys against exactly those captured revisions, using the
   existing chunked collection writer. Recheck both ordinary dependencies and
   whether a dependency came from another unfinished transaction.
4. Conditionally change the intent's decision from pending to completed. A
   completion and an abort cannot both win. Remove the completed ID from the
   index's pending set; if cleanup fails, its durable decision still establishes
   completion and a later read can clean the index.
5. On failure, claim the compensating decision. Restore only a key still at the
   original or this transaction's allocated revision. An original revision is
   fenced even if its bytes never changed, so a delayed original publication
   cannot land after recovery. A later transaction's revision is never overwritten,
   even when its payload is identical. Record the terminal decision and clear the
   pending index entry.
6. Once the decision is terminal, discard the intent. A completed transaction is
   read back from the collections themselves and a compensated one has put them
   back, so the before-state has no reader left; kept, every save would store
   another copy of everything it wrote. The event, its node and its decision are
   permanent. Discarding is best-effort and finished by the next reader that
   finds a decided entry still marked pending.

Recovery does not depend on an expiring lock or a browser that remains alive.
Before-states and publication identities are durable for as long as the
transaction is undecided. Concurrent recoverers use
the same conditional decisions and storage revisions. Idempotent receipts for an
already accepted publication do not make it the current value again: readers
follow its successor chain to the recovery or later transaction.

## Reading while another session saves

A loader examines the pending index before reading company collections. Unfinished
transactions are projected as their before-state instead of displaying half a
transfer or a holderless certificate. It rechecks journal progress while loading.
A completed decision is authoritative, including when its index cleanup was lost.

Reading must not cancel a live writer. An unfinished operation is therefore
shown with the existing recovery banner. Automatic retries finish known local
failures and observe completed operations; they do not abort a foreign pending
writer. **Retry now** explicitly recovers unfinished operations and may cancel a
save still running elsewhere. A new edit composed from an unresolved foreign
snapshot requires recovery and a refresh before proceeding. This distinction
avoids timers/leases and preserves normal concurrent reads.

## Storage and export format

The head is `captable:<companyId>:audit:v1`, containing schema version, latest
transaction ID, count, pending IDs, and the IDs of the latest hundred entries.
Linked summary nodes allow bounded pagination without loading all historic
payloads on company open; where the head lists the way ahead, a page reads its
nodes in one batch and falls back to the chain where the list ends or disagrees
with it. Each event has an immutable chunked blob and a conditional decision
record, plus an intent blob while it is undecided. Summary nodes are also chunked
when a large import's record index exceeds one KV value. Blobs carry SHA-256
digests so missing or altered parts fail visibly.

Pages return at most 100 entries and scan at most 100 nodes, with an explicit
continuation cursor even if filters found no matches. Filters include recording
date, actor, operation, record/holder ID, and transaction ID. Detail payloads load
only when opened. Full export traverses the complete index and preserves IDs and
schema versions; CSV produces one row per record change. JSON is the lossless
format, including legacy activity and imported archive provenance. Internal
recovery instructions are excluded from public exports.

Storage grows with the records changed, not with the size of the collections
they live in: the before-state a save stores for recovery is removed once the
save is decided. Journaling adds storage requests to each business save, and
three conditional publications (the entry, its completion, the business key)
where a save on its own needed one. Exports load the requested complete history
into memory, a batch of entries at a time; normal cap table loading reads only
the head and unfinished operations. A maximum of 100 simultaneously pending intents prevents an unbounded
head; recovery is required before accepting more.

## Trust and compatibility

This is an application-level append-only journal in the user's Puter account.
It is not tamper-proof against the storage owner, old application versions, or
another program with the same account credentials. The content digest detects
damage, not malicious replacement by an authorized owner. Do not claim independent
certification, legal compliance, or server-enforced multi-user permissions.

Access is the existing authenticated account boundary, including audit exports
and attachment metadata. There are no public share links. Future shared access
(#90) must enforce authorization at a trusted boundary for the journal as well as
the business records; client-side hidden controls are insufficient. Reload older
app sessions when deploying this change so their writes use the journal.

## Verification

`tests/audit.test.js` covers retention, pagination, filters, provenance, grouped
operations, chunk integrity, company isolation/deletion, interrupted publications,
decisions, fencing, and dependency validation against unfinished transactions.
`tests/history.test.js` checks the DOM flows, escaping, full exports, stale filter
responses, and company switching. Existing math, reports, lifecycle, persistence,
and separate-process concurrency tests remain part of the full suite.

Some persistence expectations intentionally become stronger: a failed delayed
write cannot resurrect itself after recovery; a reload displays the durable
before-state while a rollback is unfinished; and accepting a later edit first
recovers the entire prior transaction. The conditional KV test double carries
publication identity so identical bytes do not stand in for revision ownership.
